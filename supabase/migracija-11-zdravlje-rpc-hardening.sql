-- ============================================================
-- Migracija 11: hardening finansija posle F4 — 2026-09-23
-- Idempotentna. Sveža baza dobija isto iz schema.sql.
--
-- Problem: rukovodilac je na nivou API-ja mogao da PROČITA iznose svog
-- gradilišta (troskovi_st, situacije, predmer.cena, gradilista.budzet…) jer
-- zdravlje(g) na klijentu traži te brojke. UI ih je krio, server nije.
--
-- Rešenje:
--  1) zdravlje_gradilista(gid) + zdravlja_mojih() — skor se računa NA SERVERU
--     (ista formula kao u index.html), rukovodilac dobija samo broj
--  2) troskovi_st / situacije: select samo direktor
--  3) finansijske KOLONE (gradilista.budzet/troskovi/potroseno/naplaceno,
--     predmer.cena, podizvodjaci.cena): column-level grant — niko preko API-ja
--     ne može `select *` na tim tabelama; čita se kroz gradilista_v/predmer_v/
--     podizvodjaci_v (view kao vlasnik, redovi filtrirani istim pravilom kao
--     RLS, finansijske kolone CASE je_direktor()). Pisanje ide u tabele.
--     NAPOMENA: RLS polisa ne može da sakrije kolonu, a ukidanje SELECT
--     polise rukovodiocu obara i njegov UPDATE (Postgres proverava SELECT
--     polisu na redu koji se ažurira) — provereno na živoj bazi 2026-09-23.
--  4) trigeri: ne-direktor na gradilista menja samo napredak/faza/status,
--     na predmer samo izv, na magacin samo stanje — šta god klijent poslao
-- Klijent (index.html): pushAll za POSTOJEĆE redove koristi UPDATE, ne upsert —
-- INSERT WITH CHECK (je_direktor) bi rukovodiočev upsert odbio i kad je red njegov.
-- ============================================================

-- ---------- 1) zdravlje na serveru ----------
-- "Danas" po Beogradu, ne UTC — klijent koristi lokalni datum korisnika.
create or replace function danas_bg() returns date
language sql stable as $$ select (now() at time zone 'Europe/Belgrade')::date $$;

-- Ista formula kao zdravlje(g) u index.html. Zaokruživanje floor(x+0.5) = JS Math.round.
create or replace function zdravlje_gradilista(gid text) returns int
language plpgsql stable security definer set search_path = public as $$
declare
  g gradilista%rowtype; sc int := 100; d date := danas_bg(); diff int; kasne int;
  n_tr int; n_sit int; pot numeric; napl numeric; ocek numeric; plan_m numeric; ostv_m numeric; napl_pct numeric;
begin
  if not moje_gradiliste(gid) then return null; end if;
  select * into g from gradilista where id = gid;
  if not found then return null; end if;

  select count(*), coalesce(sum(iznos),0) into n_tr, pot from troskovi_st where gr = gid;
  if n_tr = 0 then pot := coalesce(g.potroseno, 0); end if;
  select count(*), coalesce(sum(iznos) filter (where status = 'placeno'),0) into n_sit, napl from situacije where gr = gid;
  if n_sit = 0 then napl := coalesce(g.naplaceno, 0); end if;

  plan_m := case when coalesce(g.budzet,0) <> 0 then floor((g.budzet - coalesce(g.troskovi,0)) / g.budzet * 1000 + 0.5) / 10 else 0 end;
  if g.status = 'zavrseno' then return least(100, 90 + case when plan_m >= 10 then 10 else 5 end); end if;

  diff := g.rok - d;
  if g.status = 'kasni' or diff < 0 then sc := sc - 35;
  elsif diff <= 30 and coalesce(g.napredak,0) < 90 then sc := sc - 15; end if;

  select count(*) into kasne from zadaci where gr = gid and kol <> 'done' and rok < d;
  sc := sc - least(15, kasne * 5);

  ocek := coalesce(g.troskovi,0) * coalesce(g.napredak,0) / 100.0;
  if coalesce(g.napredak,0) > 0 and pot > ocek * 1.1 then sc := sc - 20; end if;
  ostv_m := case when coalesce(g.budzet,0) <> 0 then floor((g.budzet - pot) / g.budzet * 1000 + 0.5) / 10 else 0 end;
  if ostv_m < 8 then sc := sc - 10; end if;
  napl_pct := case when coalesce(g.budzet,0) <> 0 then floor(napl / g.budzet * 100 + 0.5) else 0 end;
  if coalesce(g.napredak,0) - napl_pct > 25 then sc := sc - 15; end if;

  return greatest(5, sc);
end $$;

-- Sva gradilišta koja pozivalac sme da vidi, sa skorom — jedan poziv umesto N.
create or replace function zdravlja_mojih() returns table (id text, zdravlje int)
language sql stable security definer set search_path = public as $$
  select g.id, zdravlje_gradilista(g.id) from gradilista g where moje_gradiliste(g.id) order by g.id;
$$;

revoke execute on function danas_bg(), zdravlje_gradilista(text), zdravlja_mojih() from public, anon;
grant  execute on function danas_bg(), zdravlje_gradilista(text), zdravlja_mojih() to authenticated;

-- ---------- 2) finansijske tabele: čita samo direktor ----------
drop policy if exists p_sel on troskovi_st;
create policy p_sel on troskovi_st for select to authenticated using (je_direktor());
drop policy if exists p_sel on situacije;
create policy p_sel on situacije for select to authenticated using (je_direktor());

-- ---------- 3) finansijske kolone: column-level grant + view-ovi ----------
-- Polise redova ostaju kao u migraciji 10 (rukovodilac vidi svoje redove — inače ne može ni da ih ažurira).
drop policy if exists p_sel on gradilista;   create policy p_sel on gradilista   for select to authenticated using (moje_gradiliste(id));
drop policy if exists p_sel on predmer;      create policy p_sel on predmer      for select to authenticated using (moje_gradiliste(gr));
drop policy if exists p_sel on podizvodjaci; create policy p_sel on podizvodjaci for select to authenticated using (moj_podizvodjac(id));

-- Table-level SELECT se mora ukinuti da bi kolonski grant važio (PG: kolonski revoke uz table-level grant nema efekta).
revoke select on gradilista, predmer, podizvodjaci from authenticated, anon;
grant select (id, naziv, modul, tip, lok, klijent, rukovodilac, pocetak, rok, napredak, status, faza, povrsina, nivo, nadzor, adm) on gradilista to authenticated;
grant select (id, gr, poz, jm, kol, izv, zaduzen) on predmer to authenticated;
grant select (id, naziv, delatnost, osoba, tel, status) on podizvodjaci to authenticated;

-- View-ovi rade kao vlasnik (postgres) — kolone dostupne; redove filtrira eksplicitno isto pravilo kao RLS.
drop view if exists gradilista_v; drop view if exists predmer_v; drop view if exists podizvodjaci_v;
create view gradilista_v with (security_barrier = true) as
  select id, naziv, modul, tip, lok, klijent, rukovodilac, pocetak, rok, napredak, status, faza,
         povrsina, nivo, nadzor, adm,
         case when je_direktor() then budzet    end as budzet,
         case when je_direktor() then troskovi  end as troskovi,
         case when je_direktor() then potroseno end as potroseno,
         case when je_direktor() then naplaceno end as naplaceno
  from gradilista where moje_gradiliste(id);
create view predmer_v with (security_barrier = true) as
  select id, gr, poz, jm, kol, izv, zaduzen, case when je_direktor() then cena end as cena
  from predmer where moje_gradiliste(gr);
create view podizvodjaci_v with (security_barrier = true) as
  select id, naziv, delatnost, osoba, tel, status, case when je_direktor() then cena end as cena
  from podizvodjaci where moj_podizvodjac(id);
revoke all on gradilista_v, predmer_v, podizvodjaci_v from public, anon;
grant select on gradilista_v, predmer_v, podizvodjaci_v to authenticated;

-- ---------- 4) trigeri: ne-direktor menja samo dozvoljene kolone ----------
-- auth.uid() is null = SQL editor / migracije / service role: bez ograničenja.
create or replace function zastiti_kolone_gradilista() returns trigger language plpgsql as $$
begin
  if auth.uid() is not null and not je_direktor() then
    new.naziv := old.naziv; new.modul := old.modul; new.tip := old.tip; new.lok := old.lok;
    new.klijent := old.klijent; new.rukovodilac := old.rukovodilac; new.pocetak := old.pocetak;
    new.rok := old.rok; new.povrsina := old.povrsina; new.nivo := old.nivo; new.nadzor := old.nadzor;
    new.adm := old.adm; new.budzet := old.budzet; new.troskovi := old.troskovi;
    new.potroseno := old.potroseno; new.naplaceno := old.naplaceno;
    -- dozvoljeno: napredak, status, faza
  end if;
  return new;
end $$;
drop trigger if exists trg_zastiti_gradilista on gradilista;
create trigger trg_zastiti_gradilista before update on gradilista
  for each row execute function zastiti_kolone_gradilista();

create or replace function zastiti_kolone_predmer() returns trigger language plpgsql as $$
begin
  if auth.uid() is not null and not je_direktor() then
    new.gr := old.gr; new.poz := old.poz; new.jm := old.jm; new.kol := old.kol;
    new.cena := old.cena; new.zaduzen := old.zaduzen;
    -- dozvoljeno: izv
  end if;
  return new;
end $$;
drop trigger if exists trg_zastiti_predmer on predmer;
create trigger trg_zastiti_predmer before update on predmer
  for each row execute function zastiti_kolone_predmer();

create or replace function zastiti_kolone_magacin() returns trigger language plpgsql as $$
begin
  if auth.uid() is not null and not je_direktor() then
    new.naziv := old.naziv; new.jm := old.jm;
    -- dozvoljeno: stanje
  end if;
  return new;
end $$;
drop trigger if exists trg_zastiti_magacin on magacin;
create trigger trg_zastiti_magacin before update on magacin
  for each row execute function zastiti_kolone_magacin();
