-- ============================================================
-- GradnjaOS — šema baze za Supabase (SVEŽA baza)
-- Pokreni ceo fajl u: Supabase konzola -> SQL Editor -> New query
-- Postojeća baza: NE ovo, nego migracija-01..11.sql redom.
-- Stanje: posle migracije 11 (Auth + RLS + hardening finansija, 2026-09-23)
-- ============================================================

create table if not exists clijenti (
  id     text primary key,
  naziv  text not null,
  tip    text,
  osoba  text,
  tel    text,
  mail   text
);

create table if not exists zaposleni (
  id     text primary key,
  ime    text not null,
  poz    text,
  status text,                 -- 'Na terenu' | 'Kancelarija' | 'Odsutan'
  tel    text,
  opis   text                  -- opis posla
  -- grs[]/bivsi[] su zamenjeni tabelom zaposleni_gradiliste (RLS ne može da ograniči niz)
);

create table if not exists gradilista (
  id          text primary key,
  naziv       text not null,
  modul       text default 'izvodjenje',     -- 'projektovanje' | 'izvodjenje'
  tip         text default 'visokogradnja',  -- za izvodjenje: 'visokogradnja' | 'niskogradnja'
  lok         text,
  klijent     text,     -- id klijenta
  rukovodilac text,     -- id zaposlenog — OSNOV ZA RLS: rukovodilac vidi samo gde je on ovde
  pocetak     date,
  rok         date,
  napredak    int     default 0,
  status      text,     -- 'u toku' | 'kasni' | 'zavrseno' | 'planirano'
  faza        text,
  povrsina    numeric,
  nivo        text,               -- projektovanje: IDR | IDP/PGD | PZI
  nadzor      text,
  adm         jsonb default '{}',
  budzet      numeric default 0,   -- ugovorena cena
  troskovi    numeric default 0,   -- planirani troškovi (plan. marža = budzet - troskovi)
  potroseno   numeric default 0,   -- fallback; stvarno se računa iz troskovi_st
  naplaceno   numeric default 0    -- fallback; stvarna naplata se računa iz tabele situacije
);

create table if not exists zadaci (
  id    text primary key,
  naziv text not null,
  gr    text,           -- id gradilišta
  zad   text,           -- id zaduženog zaposlenog
  prio  text,           -- 'high' | 'mid' | 'low'
  kol   text,           -- 'todo' | 'inprogress' | 'hold' | 'done'
  rok   date
);

create table if not exists dnevnik (
  id    text primary key,
  datum date,
  gr    text,
  autor text,           -- id zaposlenog
  tekst text
);

create table if not exists narudzbe (
  id       text primary key,
  gr       text,             -- id gradilišta
  autor    text,             -- id zaposlenog ili 'direkcija'
  datum    date,
  rok      date,             -- potrebno na gradilištu do
  status   text,             -- 'poslato' | 'isporuceno'
  napomena text,
  stavke   jsonb default '[]'  -- [{naziv, kolicina, jm}]
);

create table if not exists troskovi_st (
  id    text primary key,
  gr    text,              -- id gradilišta
  datum date,
  opis  text,
  kat   text,              -- Materijal | Radna snaga | Mehanizacija | Podizvođači | Ostalo
  iznos numeric default 0,
  dobavljac text,
  fakt text,
  prilog jsonb            -- {name, datum, data} — faktura kao PDF/slika, data-URL u pilotu (do Supabase Storage)
);

create table if not exists podizvodjaci (
  id        text primary key,
  naziv     text not null,
  delatnost text,
  osoba     text,
  tel       text,
  cena      numeric default 0,    -- ugovorena vrednost
  status    text                  -- 'aktivan' | 'zavrsen'
  -- grs[] je zamenjen tabelom podizvodjac_gradiliste
);

create table if not exists predmer (
  id text primary key, gr text, poz text, jm text,
  kol numeric default 0, cena numeric default 0, izv numeric default 0,
  zaduzen text  -- id zaposlenog ili spoljnog saradnika
);

create table if not exists resursi (
  id text primary key, tip text, naziv text, oznaka text,
  gr text, zaduzen text, istice date, napomena text
);

create table if not exists magacin (
  id text primary key, naziv text, jm text, stanje numeric default 0
);

create table if not exists mag_promene (
  id text primary key, mid text, datum date, tip text, kol numeric, gr text
);

create table if not exists situacije (
  id     text primary key,
  gr     text,
  br     text,          -- broj situacije, npr. 'PS-01/26'
  opis   text,
  iznos  numeric default 0,
  izdato date,
  valuta date,          -- rok plaćanja
  status text           -- 'placeno' | 'ceka' | 'kasni'
);

-- ============================================================
-- Auth + RLS po ulogama (migracija 10). Isti sadržaj kao u
-- migracija-10-auth-rls.sql minus backfill (sveža baza nema nizove).
-- ============================================================
create table if not exists profili (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  zaposleni_id text,
  uloga        text not null check (uloga in ('direktor','rukovodilac')),
  ime          text,
  created_at   timestamptz default now()
);

create table if not exists zaposleni_gradiliste (
  zaposleni_id  text not null references zaposleni(id)  on delete cascade,
  gradiliste_id text not null references gradilista(id) on delete cascade,
  aktivan       boolean not null default true,        -- true = trenutno (grs), false = istorija (bivsi)
  primary key (zaposleni_id, gradiliste_id)
);
create table if not exists podizvodjac_gradiliste (
  podizvodjac_id text not null references podizvodjaci(id) on delete cascade,
  gradiliste_id  text not null references gradilista(id)   on delete cascade,
  primary key (podizvodjac_id, gradiliste_id)
);

create or replace function ima_profil() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profili where user_id = auth.uid());
$$;
create or replace function je_direktor() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profili where user_id = auth.uid() and uloga = 'direktor');
$$;
create or replace function moj_zaposleni() returns text
language sql stable security definer set search_path = public as $$
  select zaposleni_id from profili where user_id = auth.uid();
$$;
create or replace function moje_gradiliste(gid text) returns boolean
language sql stable security definer set search_path = public as $$
  select je_direktor()
      or exists (select 1 from gradilista g where g.id = gid and g.rukovodilac = moj_zaposleni());
$$;
create or replace function moj_klijent(cid text) returns boolean
language sql stable security definer set search_path = public as $$
  select je_direktor()
      or exists (select 1 from gradilista g where g.klijent = cid and g.rukovodilac = moj_zaposleni());
$$;
create or replace function moj_podizvodjac(pid text) returns boolean
language sql stable security definer set search_path = public as $$
  select je_direktor()
      or exists (select 1 from podizvodjac_gradiliste pg
                 join gradilista g on g.id = pg.gradiliste_id
                 where pg.podizvodjac_id = pid and g.rukovodilac = moj_zaposleni());
$$;

alter table clijenti   enable row level security;
alter table zaposleni  enable row level security;
alter table gradilista enable row level security;
alter table zadaci     enable row level security;
alter table dnevnik    enable row level security;
alter table situacije  enable row level security;
alter table narudzbe   enable row level security;
alter table troskovi_st enable row level security;
alter table podizvodjaci enable row level security;
alter table mag_promene enable row level security;
alter table magacin enable row level security;
alter table resursi enable row level security;
alter table predmer enable row level security;
alter table profili enable row level security;
alter table zaposleni_gradiliste   enable row level security;
alter table podizvodjac_gradiliste enable row level security;

do $$
declare t text;
begin
  foreach t in array array['clijenti','zaposleni','gradilista','zadaci','dnevnik','situacije',
                           'narudzbe','troskovi_st','podizvodjaci','mag_promene','magacin','resursi','predmer',
                           'profili','zaposleni_gradiliste','podizvodjac_gradiliste'] loop
    execute format('drop policy if exists pilot_full on %I', t);
    execute format('drop policy if exists p_sel on %I', t);
    execute format('drop policy if exists p_ins on %I', t);
    execute format('drop policy if exists p_upd on %I', t);
    execute format('drop policy if exists p_del on %I', t);
  end loop;
end $$;

-- Bez profila = nula pristupa. Direktor = sve. Rukovodilac = redovi svojih gradilišta.
create policy p_sel on profili for select to authenticated using (user_id = auth.uid() or je_direktor());

create policy p_sel on gradilista for select to authenticated using (moje_gradiliste(id));
create policy p_ins on gradilista for insert to authenticated with check (je_direktor());
create policy p_upd on gradilista for update to authenticated using (moje_gradiliste(id)) with check (moje_gradiliste(id));
create policy p_del on gradilista for delete to authenticated using (je_direktor());

create policy p_sel on zadaci for select to authenticated using (moje_gradiliste(gr));
create policy p_ins on zadaci for insert to authenticated with check (moje_gradiliste(gr));
create policy p_upd on zadaci for update to authenticated using (moje_gradiliste(gr)) with check (moje_gradiliste(gr));
create policy p_del on zadaci for delete to authenticated using (moje_gradiliste(gr));

create policy p_sel on dnevnik for select to authenticated using (moje_gradiliste(gr));
create policy p_ins on dnevnik for insert to authenticated with check (moje_gradiliste(gr) and (je_direktor() or autor = moj_zaposleni()));
create policy p_upd on dnevnik for update to authenticated using (je_direktor()) with check (je_direktor());
create policy p_del on dnevnik for delete to authenticated using (je_direktor());

create policy p_sel on narudzbe for select to authenticated using (moje_gradiliste(gr));
create policy p_ins on narudzbe for insert to authenticated with check (moje_gradiliste(gr) and (je_direktor() or autor = moj_zaposleni()));
create policy p_upd on narudzbe for update to authenticated using (moje_gradiliste(gr)) with check (moje_gradiliste(gr));
create policy p_del on narudzbe for delete to authenticated using (je_direktor());

create policy p_sel on predmer for select to authenticated using (moje_gradiliste(gr));
create policy p_ins on predmer for insert to authenticated with check (je_direktor());
create policy p_upd on predmer for update to authenticated using (moje_gradiliste(gr)) with check (moje_gradiliste(gr));
create policy p_del on predmer for delete to authenticated using (je_direktor());

create policy p_sel on troskovi_st for select to authenticated using (moje_gradiliste(gr));
create policy p_ins on troskovi_st for insert to authenticated with check (je_direktor());
create policy p_upd on troskovi_st for update to authenticated using (je_direktor()) with check (je_direktor());
create policy p_del on troskovi_st for delete to authenticated using (je_direktor());

create policy p_sel on situacije for select to authenticated using (moje_gradiliste(gr));
create policy p_ins on situacije for insert to authenticated with check (je_direktor());
create policy p_upd on situacije for update to authenticated using (je_direktor()) with check (je_direktor());
create policy p_del on situacije for delete to authenticated using (je_direktor());

create policy p_sel on resursi for select to authenticated using (ima_profil() and (gr is null or moje_gradiliste(gr)));
create policy p_ins on resursi for insert to authenticated with check (je_direktor());
create policy p_upd on resursi for update to authenticated using (je_direktor()) with check (je_direktor());
create policy p_del on resursi for delete to authenticated using (je_direktor());

create policy p_sel on magacin for select to authenticated using (ima_profil());
create policy p_ins on magacin for insert to authenticated with check (je_direktor());
create policy p_upd on magacin for update to authenticated using (ima_profil()) with check (ima_profil());
create policy p_del on magacin for delete to authenticated using (je_direktor());

create policy p_sel on mag_promene for select to authenticated using (ima_profil() and (gr is null or moje_gradiliste(gr)));
create policy p_ins on mag_promene for insert to authenticated with check (je_direktor() or (tip = 'izlaz' and moje_gradiliste(gr)));
create policy p_upd on mag_promene for update to authenticated using (je_direktor()) with check (je_direktor());
create policy p_del on mag_promene for delete to authenticated using (je_direktor());

create policy p_sel on clijenti for select to authenticated using (moj_klijent(id));
create policy p_ins on clijenti for insert to authenticated with check (je_direktor());
create policy p_upd on clijenti for update to authenticated using (je_direktor()) with check (je_direktor());
create policy p_del on clijenti for delete to authenticated using (je_direktor());

create policy p_sel on zaposleni for select to authenticated using (ima_profil());
create policy p_ins on zaposleni for insert to authenticated with check (je_direktor());
create policy p_upd on zaposleni for update to authenticated using (je_direktor()) with check (je_direktor());
create policy p_del on zaposleni for delete to authenticated using (je_direktor());

create policy p_sel on zaposleni_gradiliste for select to authenticated using (ima_profil());
create policy p_ins on zaposleni_gradiliste for insert to authenticated with check (moje_gradiliste(gradiliste_id));
create policy p_upd on zaposleni_gradiliste for update to authenticated using (moje_gradiliste(gradiliste_id)) with check (moje_gradiliste(gradiliste_id));
create policy p_del on zaposleni_gradiliste for delete to authenticated using (je_direktor());

create policy p_sel on podizvodjaci for select to authenticated using (moj_podizvodjac(id));
create policy p_ins on podizvodjaci for insert to authenticated with check (je_direktor());
create policy p_upd on podizvodjaci for update to authenticated using (je_direktor()) with check (je_direktor());
create policy p_del on podizvodjaci for delete to authenticated using (je_direktor());

create policy p_sel on podizvodjac_gradiliste for select to authenticated using (ima_profil());
create policy p_ins on podizvodjac_gradiliste for insert to authenticated with check (je_direktor());
create policy p_upd on podizvodjac_gradiliste for update to authenticated using (je_direktor()) with check (je_direktor());
create policy p_del on podizvodjac_gradiliste for delete to authenticated using (je_direktor());

revoke execute on function ima_profil(), je_direktor(), moj_zaposleni(), moje_gradiliste(text),
                           moj_klijent(text), moj_podizvodjac(text) from public, anon;
grant  execute on function ima_profil(), je_direktor(), moj_zaposleni(), moje_gradiliste(text),
                           moj_klijent(text), moj_podizvodjac(text) to authenticated;

-- Dodavanje korisnika: 1) Authentication -> Users -> Add user (email + lozinka, auto confirm)
--                      2) select povezi_profil('ime@firma.rs', 'rukovodilac', 'z1');
--                         select povezi_profil('direktor@firma.rs', 'direktor');
create or replace function povezi_profil(p_email text, p_uloga text, p_zaposleni_id text default null)
returns uuid language plpgsql security definer set search_path = public, auth as $$
declare uid uuid;
begin
  select id into uid from auth.users where lower(email) = lower(p_email);
  if uid is null then
    raise exception 'Nema korisnika sa emailom %. Prvo ga dodaj u Authentication -> Users.', p_email;
  end if;
  if p_uloga = 'rukovodilac' and (p_zaposleni_id is null or not exists (select 1 from zaposleni where id = p_zaposleni_id)) then
    raise exception 'Rukovodilac mora biti vezan za postojeceg zaposlenog (zaposleni.id), dobio sam: %', p_zaposleni_id;
  end if;
  insert into profili (user_id, zaposleni_id, uloga, ime)
    values (uid, p_zaposleni_id, p_uloga, coalesce((select ime from zaposleni where id = p_zaposleni_id), p_email))
    on conflict (user_id) do update
      set zaposleni_id = excluded.zaposleni_id, uloga = excluded.uloga, ime = excluded.ime;
  return uid;
end $$;
revoke execute on function povezi_profil(text, text, text) from public, anon, authenticated;

-- ============================================================
-- Migracija 11 (identican sadrzaj) — hardening finansija: zdravlje na serveru,
-- column-level grant + view-ovi za finansijske kolone, trigeri za kolone,
-- troskovi_st/situacije select samo direktor
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
