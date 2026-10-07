-- ============================================================
-- GradnjaOS — šema baze za Supabase (SVEŽA baza)
-- Pokreni ceo fajl u: Supabase konzola -> SQL Editor -> New query
-- Postojeća baza: NE ovo, nego migracija-01..14.sql redom.
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
  uloga        text not null check (uloga in ('direktor','admin','rukovodilac','radnik','spoljni')),
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


-- ============================================================
-- Migracija 12 (identican sadrzaj) — nalozi i log koriscenja
-- ============================================================

create table if not exists log_koriscenja (
  id        bigserial primary key,
  ts        timestamptz not null default now(),
  user_id   uuid default auth.uid(),
  email     text,
  uloga     text,
  dogadjaj  text not null,          -- prijava | odjava | otvaranje | cuvanje | uloga_promena | pristup_uklonjen
  detalj    jsonb default '{}'
);
create index if not exists log_koriscenja_ts on log_koriscenja (ts desc);
alter table log_koriscenja enable row level security;
drop policy if exists p_sel on log_koriscenja;
drop policy if exists p_ins on log_koriscenja;
create policy p_sel on log_koriscenja for select to authenticated using (je_direktor());
create policy p_ins on log_koriscenja for insert to authenticated with check (user_id = auth.uid());
revoke all on log_koriscenja from anon;
grant select, insert on log_koriscenja to authenticated;
grant usage, select on sequence log_koriscenja_id_seq to authenticated;

-- Pregled naloga: profili + auth.users (email, poslednja prijava). Samo direktor.
create or replace function nalozi_pregled()
returns table (user_id uuid, email text, uloga text, zaposleni_id text, ime text,
               kreiran timestamptz, poslednja_prijava timestamptz, bez_profila boolean)
language plpgsql stable security definer set search_path = public, auth as $$
begin
  if not je_direktor() then raise exception 'Samo direktor vidi naloge.'; end if;
  return query
    select u.id, u.email::text, p.uloga, p.zaposleni_id, p.ime,
           u.created_at, u.last_sign_in_at, (p.user_id is null) as bez_profila
    from auth.users u
    left join profili p on p.user_id = u.id
    order by (p.user_id is null), u.email;
end $$;
revoke execute on function nalozi_pregled() from public, anon;
grant  execute on function nalozi_pregled() to authenticated;

-- Dodela/izmena uloge postojecem auth korisniku. Samo direktor; ne sebi.
create or replace function dodeli_ulogu(p_email text, p_uloga text, p_zaposleni_id text default null)
returns text language plpgsql security definer set search_path = public, auth as $$
declare uid uuid; stara text; ja text;
begin
  if not je_direktor() then raise exception 'Samo direktor dodeljuje uloge.'; end if;
  select id into uid from auth.users where lower(email) = lower(p_email);
  if uid is null then
    raise exception 'Nema naloga %. Napravi ga prvo u Supabase → Authentication → Users (Add user), pa ponovi.', p_email;
  end if;
  if uid = auth.uid() then raise exception 'Sopstvenu ulogu ne možeš da menjaš — zamoli drugog direktora.'; end if;
  if p_uloga not in ('direktor','rukovodilac') then raise exception 'Nepoznata uloga: %', p_uloga; end if;
  if p_uloga = 'rukovodilac' and (p_zaposleni_id is null or not exists (select 1 from zaposleni where id = p_zaposleni_id)) then
    raise exception 'Rukovodilac mora biti vezan za postojećeg zaposlenog.';
  end if;
  if p_uloga = 'direktor' then p_zaposleni_id := null; end if;
  select uloga into stara from profili where user_id = uid;
  if stara = 'direktor' and p_uloga <> 'direktor' and (select count(*) from profili where uloga = 'direktor') <= 1 then
    raise exception 'Ovo je poslednji direktor — prvo dodeli ulogu direktora nekom drugom.';
  end if;
  insert into profili (user_id, zaposleni_id, uloga, ime)
    values (uid, p_zaposleni_id, p_uloga, coalesce((select z.ime from zaposleni z where z.id = p_zaposleni_id), p_email))
    on conflict (user_id) do update
      set zaposleni_id = excluded.zaposleni_id, uloga = excluded.uloga, ime = excluded.ime;
  select email into ja from auth.users where id = auth.uid();
  insert into log_koriscenja (user_id, email, uloga, dogadjaj, detalj)
    values (auth.uid(), ja, 'direktor', 'uloga_promena',
            jsonb_build_object('email', lower(p_email), 'stara', stara, 'nova', p_uloga, 'zaposleni_id', p_zaposleni_id));
  return case when stara is null then 'dodeljeno' else 'izmenjeno' end;
end $$;
revoke execute on function dodeli_ulogu(text, text, text) from public, anon;
grant  execute on function dodeli_ulogu(text, text, text) to authenticated;

-- Skidanje pristupa: profil se brise, auth nalog ostaje (vidi nula podataka). Ne sebi, ne poslednjem direktoru.
create or replace function ukloni_pristup(p_email text)
returns void language plpgsql security definer set search_path = public, auth as $$
declare uid uuid; stara text; ja text;
begin
  if not je_direktor() then raise exception 'Samo direktor uklanja pristup.'; end if;
  select id into uid from auth.users where lower(email) = lower(p_email);
  if uid is null then raise exception 'Nema naloga %.', p_email; end if;
  if uid = auth.uid() then raise exception 'Sopstveni pristup ne možeš da ukloniš.'; end if;
  select uloga into stara from profili where user_id = uid;
  if stara is null then return; end if;
  if stara = 'direktor' and (select count(*) from profili where uloga = 'direktor') <= 1 then
    raise exception 'Ovo je poslednji direktor.';
  end if;
  delete from profili where user_id = uid;
  select email into ja from auth.users where id = auth.uid();
  insert into log_koriscenja (user_id, email, uloga, dogadjaj, detalj)
    values (auth.uid(), ja, 'direktor', 'pristup_uklonjen', jsonb_build_object('email', lower(p_email), 'stara', stara));
end $$;
revoke execute on function ukloni_pristup(text) from public, anon;
grant  execute on function ukloni_pristup(text) to authenticated;

-- ============================================================
-- Migracija 13 (identican sadrzaj) — napredak iz predmera (ugovoreno × izvedeno)
-- ============================================================
create or replace function napredak_iz_predmera(p_gr text) returns int
language sql stable security definer set search_path = public as $$
  select case
    when count(*) = 0 then null
    when coalesce(sum(kol * cena), 0) > 0 then floor(100.0 * sum(least(coalesce(izv,0), kol) * cena) / sum(kol * cena) + 0.5)::int
    when coalesce(sum(kol), 0) > 0 then floor(100.0 * sum(least(coalesce(izv,0), kol)) / sum(kol) + 0.5)::int
    else 0 end
  from predmer where gr = p_gr;
$$;
revoke execute on function napredak_iz_predmera(text) from public, anon;
grant  execute on function napredak_iz_predmera(text) to authenticated;

create or replace function osvezi_napredak(p_gr text) returns void
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if p_gr is null then return; end if;
  select napredak_iz_predmera(p_gr) into n;
  if n is not null then
    update gradilista set napredak = least(100, greatest(0, n)) where id = p_gr and napredak is distinct from least(100, greatest(0, n));
  end if;
end $$;

create or replace function trg_predmer_napredak() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then perform osvezi_napredak(old.gr);
  else
    perform osvezi_napredak(new.gr);
    if tg_op = 'UPDATE' and old.gr is distinct from new.gr then perform osvezi_napredak(old.gr); end if;
  end if;
  return null;
end $$;
drop trigger if exists predmer_napredak on predmer;
create trigger predmer_napredak after insert or update or delete on predmer
  for each row execute function trg_predmer_napredak();

-- zdravlja_mojih: + napredak (promena tipa rezultata → drop pa create)
drop function if exists zdravlja_mojih();
create function zdravlja_mojih() returns table (id text, zdravlje int, napredak int)
language sql stable security definer set search_path = public as $$
  select g.id, zdravlje_gradilista(g.id), g.napredak from gradilista g where moje_gradiliste(g.id) order by g.id;
$$;
revoke execute on function zdravlja_mojih() from public, anon;
grant  execute on function zdravlja_mojih() to authenticated;

-- jednokratno: "aplikuj na sva gradilista"
update gradilista g set napredak = napredak_iz_predmera(g.id)
 where exists (select 1 from predmer p where p.gr = g.id)
   and napredak is distinct from napredak_iz_predmera(g.id);

-- ============================================================
-- Migracija 14 (identican sadrzaj) — sest uloga, dokumenti, sifrarnik, brisanje
-- ============================================================
-- ---------- 1) profili ----------
alter table profili drop constraint if exists profili_uloga_check;
alter table profili add constraint profili_uloga_check check (uloga in ('direktor','admin','rukovodilac','radnik','spoljni'));
alter table profili add column if not exists vidi_finansije boolean not null default false;
alter table profili add column if not exists saradnik_id text;

-- ---------- 2) helperi ----------
create or replace function moja_uloga() returns text
language sql stable security definer set search_path = public as $$
  select uloga from profili where user_id = auth.uid();
$$;
create or replace function je_super() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profili where user_id = auth.uid() and uloga = 'direktor');
$$;
create or replace function je_direktor() returns boolean   -- UPRAVA (direktor | admin)
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profili where user_id = auth.uid() and uloga in ('direktor','admin'));
$$;
create or replace function vidi_finansije() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profili where user_id = auth.uid() and (uloga in ('direktor','admin') or vidi_finansije));
$$;
create or replace function moj_saradnik() returns text
language sql stable security definer set search_path = public as $$
  select saradnik_id from profili where user_id = auth.uid();
$$;
create or replace function vodim_gradiliste(gid text) returns boolean
language sql stable security definer set search_path = public as $$
  select je_direktor()
      or exists (select 1 from gradilista g where g.id = gid and g.rukovodilac = moj_zaposleni() and moja_uloga() = 'rukovodilac');
$$;
create or replace function moje_gradiliste(gid text) returns boolean
language sql stable security definer set search_path = public as $$
  select vodim_gradiliste(gid)
      or exists (select 1 from zaposleni_gradiliste zg where zg.gradiliste_id = gid and zg.aktivan and zg.zaposleni_id = moj_zaposleni() and moja_uloga() = 'radnik')
      or exists (select 1 from podizvodjac_gradiliste pg where pg.gradiliste_id = gid and pg.podizvodjac_id = moj_saradnik() and moja_uloga() = 'spoljni');
$$;
create or replace function moj_klijent(cid text) returns boolean
language sql stable security definer set search_path = public as $$
  select je_direktor()
      or exists (select 1 from gradilista g where g.klijent = cid and vodim_gradiliste(g.id));
$$;
create or replace function moj_podizvodjac(pid text) returns boolean
language sql stable security definer set search_path = public as $$
  select je_direktor()
      or pid = moj_saradnik()
      or exists (select 1 from podizvodjac_gradiliste pg where pg.podizvodjac_id = pid and moje_gradiliste(pg.gradiliste_id));
$$;
-- autor svog reda: zaposleni ili spoljni saradnik
create or replace function moj_autor() returns text
language sql stable security definer set search_path = public as $$
  select coalesce(zaposleni_id, saradnik_id) from profili where user_id = auth.uid();
$$;
revoke execute on function moja_uloga(), je_super(), vidi_finansije(), moj_saradnik(), vodim_gradiliste(text), moj_autor() from public, anon;
grant  execute on function moja_uloga(), je_super(), vidi_finansije(), moj_saradnik(), vodim_gradiliste(text), moj_autor() to authenticated;

-- ---------- 3) nove tabele ----------
create table if not exists dokumenti (
  id        text primary key,
  gr        text not null,
  autor     text,                         -- zaposleni.id | podizvodjaci.id | 'uprava'
  autor_uid uuid default auth.uid(),
  datum     date default current_date,
  naziv     text not null,
  tip       text,                         -- mime
  velicina  int default 0,
  opis      text,
  data      text                          -- data-URL (pilot; kasnije Storage) — BEZ select granta
);
create index if not exists dokumenti_gr on dokumenti (gr);
alter table dokumenti enable row level security;

create table if not exists sifrarnik (
  id       text primary key,
  naziv    text not null,
  jm       text default 'kom',
  grupa    text,                          -- npr. 'Zemljani radovi' | 'IDR'
  modul    text,                          -- 'izvodjenje' | 'projektovanje' | null = oba
  redosled int default 0,
  aktivan  boolean not null default true
);
alter table sifrarnik enable row level security;

-- ---------- 4) polise (sve tabele, ponovo) ----------
do $$
declare t text;
begin
  foreach t in array array['clijenti','zaposleni','gradilista','zadaci','dnevnik','situacije',
                           'narudzbe','troskovi_st','podizvodjaci','mag_promene','magacin','resursi','predmer',
                           'profili','zaposleni_gradiliste','podizvodjac_gradiliste','dokumenti','sifrarnik'] loop
    execute format('drop policy if exists p_sel on %I', t);
    execute format('drop policy if exists p_ins on %I', t);
    execute format('drop policy if exists p_upd on %I', t);
    execute format('drop policy if exists p_del on %I', t);
  end loop;
end $$;

create policy p_sel on profili for select to authenticated using (user_id = auth.uid() or je_direktor());

create policy p_sel on gradilista for select to authenticated using (moje_gradiliste(id));
create policy p_ins on gradilista for insert to authenticated with check (je_direktor());
create policy p_upd on gradilista for update to authenticated using (vodim_gradiliste(id)) with check (vodim_gradiliste(id));
create policy p_del on gradilista for delete to authenticated using (je_super());

create policy p_sel on zadaci for select to authenticated using (moje_gradiliste(gr));
create policy p_ins on zadaci for insert to authenticated with check (vodim_gradiliste(gr));
create policy p_upd on zadaci for update to authenticated using (vodim_gradiliste(gr) or zad = moj_autor()) with check (vodim_gradiliste(gr) or zad = moj_autor());
create policy p_del on zadaci for delete to authenticated using (je_super());

create policy p_sel on dnevnik for select to authenticated using (moje_gradiliste(gr));
create policy p_ins on dnevnik for insert to authenticated with check (moje_gradiliste(gr) and (je_direktor() or autor = moj_autor()));
create policy p_upd on dnevnik for update to authenticated using (je_direktor() or autor = moj_autor()) with check (je_direktor() or autor = moj_autor());
create policy p_del on dnevnik for delete to authenticated using (je_super() or autor = moj_autor());

create policy p_sel on narudzbe for select to authenticated using (moje_gradiliste(gr));
create policy p_ins on narudzbe for insert to authenticated with check (vodim_gradiliste(gr) and (je_direktor() or autor = moj_zaposleni()));
create policy p_upd on narudzbe for update to authenticated using (vodim_gradiliste(gr)) with check (vodim_gradiliste(gr));
create policy p_del on narudzbe for delete to authenticated using (je_super());

create policy p_sel on predmer for select to authenticated using (moje_gradiliste(gr));
create policy p_ins on predmer for insert to authenticated with check (je_direktor());
create policy p_upd on predmer for update to authenticated using (vodim_gradiliste(gr)) with check (vodim_gradiliste(gr));
create policy p_del on predmer for delete to authenticated using (je_super());

create policy p_sel on troskovi_st for select to authenticated using (vidi_finansije() and moje_gradiliste(gr));
create policy p_ins on troskovi_st for insert to authenticated with check (je_direktor());
create policy p_upd on troskovi_st for update to authenticated using (je_direktor()) with check (je_direktor());
create policy p_del on troskovi_st for delete to authenticated using (je_super());

create policy p_sel on situacije for select to authenticated using (vidi_finansije() and moje_gradiliste(gr));
create policy p_ins on situacije for insert to authenticated with check (je_direktor());
create policy p_upd on situacije for update to authenticated using (je_direktor()) with check (je_direktor());
create policy p_del on situacije for delete to authenticated using (je_super());

create policy p_sel on resursi for select to authenticated using (ima_profil() and (gr is null or moje_gradiliste(gr)));
create policy p_ins on resursi for insert to authenticated with check (je_direktor());
create policy p_upd on resursi for update to authenticated using (je_direktor()) with check (je_direktor());
create policy p_del on resursi for delete to authenticated using (je_super());

create policy p_sel on magacin for select to authenticated using (ima_profil());
create policy p_ins on magacin for insert to authenticated with check (je_direktor());
create policy p_upd on magacin for update to authenticated using (je_direktor() or moja_uloga() = 'rukovodilac') with check (je_direktor() or moja_uloga() = 'rukovodilac');
create policy p_del on magacin for delete to authenticated using (je_super());

create policy p_sel on mag_promene for select to authenticated using (ima_profil() and (gr is null or moje_gradiliste(gr)));
create policy p_ins on mag_promene for insert to authenticated with check (je_direktor() or (tip = 'izlaz' and vodim_gradiliste(gr)));
create policy p_upd on mag_promene for update to authenticated using (je_direktor()) with check (je_direktor());
create policy p_del on mag_promene for delete to authenticated using (je_super());

create policy p_sel on clijenti for select to authenticated using (moj_klijent(id));
create policy p_ins on clijenti for insert to authenticated with check (je_direktor());
create policy p_upd on clijenti for update to authenticated using (je_direktor()) with check (je_direktor());
create policy p_del on clijenti for delete to authenticated using (je_super());

create policy p_sel on zaposleni for select to authenticated using (ima_profil());
create policy p_ins on zaposleni for insert to authenticated with check (je_direktor());
create policy p_upd on zaposleni for update to authenticated using (je_direktor()) with check (je_direktor());
create policy p_del on zaposleni for delete to authenticated using (je_super());

create policy p_sel on zaposleni_gradiliste for select to authenticated using (ima_profil());
create policy p_ins on zaposleni_gradiliste for insert to authenticated with check (vodim_gradiliste(gradiliste_id));
create policy p_upd on zaposleni_gradiliste for update to authenticated using (vodim_gradiliste(gradiliste_id)) with check (vodim_gradiliste(gradiliste_id));
create policy p_del on zaposleni_gradiliste for delete to authenticated using (je_super());

create policy p_sel on podizvodjaci for select to authenticated using (moj_podizvodjac(id));
create policy p_ins on podizvodjaci for insert to authenticated with check (je_direktor());
create policy p_upd on podizvodjaci for update to authenticated using (je_direktor()) with check (je_direktor());
create policy p_del on podizvodjaci for delete to authenticated using (je_super());

create policy p_sel on podizvodjac_gradiliste for select to authenticated using (ima_profil());
create policy p_ins on podizvodjac_gradiliste for insert to authenticated with check (vodim_gradiliste(gradiliste_id));
create policy p_upd on podizvodjac_gradiliste for update to authenticated using (je_direktor()) with check (je_direktor());
create policy p_del on podizvodjac_gradiliste for delete to authenticated using (je_super());

create policy p_sel on dokumenti for select to authenticated using (moje_gradiliste(gr));
create policy p_ins on dokumenti for insert to authenticated with check (moje_gradiliste(gr) and autor_uid = auth.uid());
create policy p_upd on dokumenti for update to authenticated using (je_direktor() or autor_uid = auth.uid()) with check (je_direktor() or autor_uid = auth.uid());
create policy p_del on dokumenti for delete to authenticated using (je_super() or autor_uid = auth.uid());

create policy p_sel on sifrarnik for select to authenticated using (ima_profil());
create policy p_ins on sifrarnik for insert to authenticated with check (je_direktor());
create policy p_upd on sifrarnik for update to authenticated using (je_direktor()) with check (je_direktor());
create policy p_del on sifrarnik for delete to authenticated using (je_super());

drop policy if exists p_sel on log_koriscenja;
create policy p_sel on log_koriscenja for select to authenticated using (je_direktor());

-- ---------- 5) kolonski grantovi + view-ovi (finansije po vidi_finansije; dokumenti.data skriveno) ----------
revoke all on dokumenti, sifrarnik from anon;
grant select (id, gr, autor, autor_uid, datum, naziv, tip, velicina, opis), insert, update, delete on dokumenti to authenticated;
grant select, insert, update, delete on sifrarnik to authenticated;
drop view if exists dokumenti_v;
create view dokumenti_v with (security_barrier = true) as
  select id, gr, autor, autor_uid, datum, naziv, tip, velicina, opis from dokumenti where moje_gradiliste(gr);
revoke all on dokumenti_v from public, anon; grant select on dokumenti_v to authenticated;
create or replace function dokument_podaci(p_id text) returns text
language sql stable security definer set search_path = public as $$
  select data from dokumenti d where d.id = p_id and moje_gradiliste(d.gr);
$$;
revoke execute on function dokument_podaci(text) from public, anon;
grant  execute on function dokument_podaci(text) to authenticated;

drop view if exists gradilista_v; drop view if exists predmer_v; drop view if exists podizvodjaci_v;
create view gradilista_v with (security_barrier = true) as
  select id, naziv, modul, tip, lok, klijent, rukovodilac, pocetak, rok, napredak, status, faza,
         povrsina, nivo, nadzor, adm,
         case when vidi_finansije() then budzet    end as budzet,
         case when vidi_finansije() then troskovi  end as troskovi,
         case when vidi_finansije() then potroseno end as potroseno,
         case when vidi_finansije() then naplaceno end as naplaceno
  from gradilista where moje_gradiliste(id);
create view predmer_v with (security_barrier = true) as
  select id, gr, poz, jm, kol, izv, zaduzen, case when vidi_finansije() then cena end as cena
  from predmer where moje_gradiliste(gr);
create view podizvodjaci_v with (security_barrier = true) as
  select id, naziv, delatnost, osoba, tel, status, case when vidi_finansije() then cena end as cena
  from podizvodjaci where moj_podizvodjac(id);
revoke all on gradilista_v, predmer_v, podizvodjaci_v from public, anon;
grant select on gradilista_v, predmer_v, podizvodjaci_v to authenticated;

-- ---------- 6) trigger: radnik/spoljni na svom zadatku menja samo kolonu (kol) ----------
create or replace function zastiti_kolone_zadaci() returns trigger language plpgsql as $$
begin
  if auth.uid() is not null and not vodim_gradiliste(new.gr) then
    new.naziv := old.naziv; new.gr := old.gr; new.zad := old.zad; new.prio := old.prio; new.rok := old.rok;
    -- dozvoljeno: kol (status na kanbanu)
  end if;
  return new;
end $$;
drop trigger if exists trg_zastiti_zadaci on zadaci;
create trigger trg_zastiti_zadaci before update on zadaci
  for each row execute function zastiti_kolone_zadaci();

-- ---------- 7) nalozi: 5 uloga, zastavica finansija, saradnik; admin ne dira direktore ----------
drop function if exists nalozi_pregled();
create function nalozi_pregled()
returns table (user_id uuid, email text, uloga text, zaposleni_id text, saradnik_id text, vidi_finansije boolean,
               ime text, kreiran timestamptz, poslednja_prijava timestamptz, bez_profila boolean)
language plpgsql stable security definer set search_path = public, auth as $$
begin
  if not je_direktor() then raise exception 'Samo uprava vidi naloge.'; end if;
  return query
    select u.id, u.email::text, p.uloga, p.zaposleni_id, p.saradnik_id, coalesce(p.vidi_finansije,false), p.ime,
           u.created_at, u.last_sign_in_at, (p.user_id is null) as bez_profila
    from auth.users u left join profili p on p.user_id = u.id
    order by (p.user_id is null), u.email;
end $$;
revoke execute on function nalozi_pregled() from public, anon;
grant  execute on function nalozi_pregled() to authenticated;

drop function if exists dodeli_ulogu(text, text, text);
create function dodeli_ulogu(p_email text, p_uloga text, p_zaposleni_id text default null,
                             p_vidi_finansije boolean default false, p_saradnik_id text default null)
returns text language plpgsql security definer set search_path = public, auth as $$
declare uid uuid; stara text; ja text; zid text; sid text; fin boolean;
begin
  if not je_direktor() then raise exception 'Samo uprava dodeljuje uloge.'; end if;
  select id into uid from auth.users where lower(email) = lower(p_email);
  if uid is null then
    raise exception 'Nema naloga %. Napravi ga prvo u Supabase → Authentication → Users (Add user), pa ponovi.', p_email;
  end if;
  if uid = auth.uid() then raise exception 'Sopstvenu ulogu ne možeš da menjaš — zamoli drugog direktora.'; end if;
  if p_uloga not in ('direktor','admin','rukovodilac','radnik','spoljni') then raise exception 'Nepoznata uloga: %', p_uloga; end if;
  select uloga into stara from profili where user_id = uid;
  if not je_super() and (p_uloga = 'direktor' or stara = 'direktor') then
    raise exception 'Samo direktor može da dodeli ili promeni ulogu direktora.';
  end if;
  zid := p_zaposleni_id; sid := p_saradnik_id; fin := coalesce(p_vidi_finansije, false);
  if p_uloga in ('rukovodilac','radnik') and (zid is null or not exists (select 1 from zaposleni where id = zid)) then
    raise exception '% mora biti vezan za postojećeg zaposlenog.', initcap(p_uloga);
  end if;
  if p_uloga = 'spoljni' and (sid is null or not exists (select 1 from podizvodjaci where id = sid)) then
    raise exception 'Spoljni saradnik mora biti vezan za postojećeg podizvođača/saradnika.';
  end if;
  if p_uloga in ('direktor','admin') then zid := null; sid := null; fin := true; end if;
  if p_uloga <> 'spoljni' then sid := null; end if;
  if p_uloga = 'spoljni' then zid := null; end if;
  if p_uloga in ('radnik','spoljni') then fin := false; end if;
  if stara = 'direktor' and p_uloga <> 'direktor' and (select count(*) from profili where uloga = 'direktor') <= 1 then
    raise exception 'Ovo je poslednji direktor — prvo dodeli ulogu direktora nekom drugom.';
  end if;
  insert into profili (user_id, zaposleni_id, saradnik_id, uloga, vidi_finansije, ime)
    values (uid, zid, sid, p_uloga, fin,
            coalesce((select z.ime from zaposleni z where z.id = zid), (select p.naziv from podizvodjaci p where p.id = sid), p_email))
    on conflict (user_id) do update
      set zaposleni_id = excluded.zaposleni_id, saradnik_id = excluded.saradnik_id, uloga = excluded.uloga,
          vidi_finansije = excluded.vidi_finansije, ime = excluded.ime;
  select email into ja from auth.users where id = auth.uid();
  insert into log_koriscenja (user_id, email, uloga, dogadjaj, detalj)
    values (auth.uid(), ja, moja_uloga(), 'uloga_promena',
            jsonb_build_object('email', lower(p_email), 'stara', stara, 'nova', p_uloga, 'zaposleni_id', zid, 'saradnik_id', sid, 'vidi_finansije', fin));
  return case when stara is null then 'dodeljeno' else 'izmenjeno' end;
end $$;
revoke execute on function dodeli_ulogu(text, text, text, boolean, text) from public, anon;
grant  execute on function dodeli_ulogu(text, text, text, boolean, text) to authenticated;

create or replace function ukloni_pristup(p_email text)
returns void language plpgsql security definer set search_path = public, auth as $$
declare uid uuid; stara text; ja text;
begin
  if not je_direktor() then raise exception 'Samo uprava uklanja pristup.'; end if;
  select id into uid from auth.users where lower(email) = lower(p_email);
  if uid is null then raise exception 'Nema naloga %.', p_email; end if;
  if uid = auth.uid() then raise exception 'Sopstveni pristup ne možeš da ukloniš.'; end if;
  select uloga into stara from profili where user_id = uid;
  if stara is null then return; end if;
  if stara = 'direktor' and not je_super() then raise exception 'Samo direktor može da ukloni direktora.'; end if;
  if stara = 'direktor' and (select count(*) from profili where uloga = 'direktor') <= 1 then
    raise exception 'Ovo je poslednji direktor.';
  end if;
  delete from profili where user_id = uid;
  select email into ja from auth.users where id = auth.uid();
  insert into log_koriscenja (user_id, email, uloga, dogadjaj, detalj)
    values (auth.uid(), ja, moja_uloga(), 'pristup_uklonjen', jsonb_build_object('email', lower(p_email), 'stara', stara));
end $$;

-- ---------- 8) brisanje gradilista (samo super) ----------
create or replace function obrisi_gradiliste(p_gid text) returns void
language plpgsql security definer set search_path = public, auth as $$
declare ja text; n text;
begin
  if not je_super() then raise exception 'Samo direktor briše gradilišta.'; end if;
  select naziv into n from gradilista where id = p_gid;
  if n is null then return; end if;
  delete from zadaci where gr = p_gid; delete from dnevnik where gr = p_gid; delete from narudzbe where gr = p_gid;
  delete from predmer where gr = p_gid; delete from troskovi_st where gr = p_gid; delete from situacije where gr = p_gid;
  delete from mag_promene where gr = p_gid; delete from dokumenti where gr = p_gid;
  update resursi set gr = null where gr = p_gid;
  delete from gradilista where id = p_gid;   -- join tabele: on delete cascade
  select email into ja from auth.users where id = auth.uid();
  insert into log_koriscenja (user_id, email, uloga, dogadjaj, detalj)
    values (auth.uid(), ja, 'direktor', 'brisanje', jsonb_build_object('tabela', 'gradilista', 'id', p_gid, 'naziv', n));
end $$;
revoke execute on function obrisi_gradiliste(text) from public, anon;
grant  execute on function obrisi_gradiliste(text) to authenticated;

-- ---------- 9) sifrarnik: pocetni sadrzaj (idempotentno) ----------
insert into sifrarnik (id, naziv, jm, grupa, modul, redosled) values
  ('sf-p-01','PDR','kom','IDR','projektovanje',1), ('sf-p-02','UP','kom','IDR','projektovanje',2), ('sf-p-03','KTP','kom','IDR','projektovanje',3),
  ('sf-p-04','Elaborat posebnih delova','kom','IDR','projektovanje',4), ('sf-p-05','Konceptualno rešenje','kom','IDR','projektovanje',5), ('sf-p-06','IDR','kom','IDR','projektovanje',6),
  ('sf-p-11','1.0 Arhitektura','kom','IDP/PGD','projektovanje',11), ('sf-p-12','2.0 Konstrukcija','kom','IDP/PGD','projektovanje',12), ('sf-p-13','3.0 ViK','kom','IDP/PGD','projektovanje',13),
  ('sf-p-14','4.0 Elektroenergetika','kom','IDP/PGD','projektovanje',14), ('sf-p-15','5.1 Telekomunikacije i signalne inst.','kom','IDP/PGD','projektovanje',15), ('sf-p-16','5.2 Dojava požara','kom','IDP/PGD','projektovanje',16),
  ('sf-p-17','5.3 Video nadzor','kom','IDP/PGD','projektovanje',17), ('sf-p-18','6.0 Mašinske instalacije','kom','IDP/PGD','projektovanje',18), ('sf-p-19','7.0 Tehnologija','kom','IDP/PGD','projektovanje',19),
  ('sf-p-20','8.0 Saobraćaj i saobraćajna sign.','kom','IDP/PGD','projektovanje',20), ('sf-p-21','9.0 Parterno uređenje','kom','IDP/PGD','projektovanje',21), ('sf-p-22','10.0 Pripremni radovi','kom','IDP/PGD','projektovanje',22),
  ('sf-p-23','Elaborat energetske efikasnosti','kom','IDP/PGD','projektovanje',23), ('sf-p-24','Elaborat o geotehničkim uslovima','kom','IDP/PGD','projektovanje',24), ('sf-p-25','Elaborat zaštite od požara','kom','IDP/PGD','projektovanje',25),
  ('sf-p-26','Plan upravljanja otpadom','kom','IDP/PGD','projektovanje',26), ('sf-p-27','Energetski pasoš','kom','IDP/PGD','projektovanje',27),
  ('sf-p-31','1.0 Arhitektura','kom','PZI','projektovanje',31), ('sf-p-32','2.0 Konstrukcija','kom','PZI','projektovanje',32), ('sf-p-33','3.0 ViK','kom','PZI','projektovanje',33),
  ('sf-p-34','4.0 Elektroenergetika','kom','PZI','projektovanje',34), ('sf-p-35','5.1 Telekomunikacije i signalne inst.','kom','PZI','projektovanje',35), ('sf-p-36','5.2 Dojava požara','kom','PZI','projektovanje',36),
  ('sf-p-37','5.3 Video nadzor','kom','PZI','projektovanje',37), ('sf-p-38','6.0 Mašinske instalacije','kom','PZI','projektovanje',38), ('sf-p-39','7.0 Tehnologija','kom','PZI','projektovanje',39),
  ('sf-p-40','8.0 Saobraćaj i saobraćajna sign.','kom','PZI','projektovanje',40), ('sf-p-41','9.0 Parterno uređenje','kom','PZI','projektovanje',41), ('sf-p-42','Plan preventivnih mera','kom','PZI','projektovanje',42),
  ('sf-p-43','Glavni projekat zaštite od požara','kom','PZI','projektovanje',43),
  ('sf-i-01','Iskop temelja','m³','Zemljani radovi','izvodjenje',101), ('sf-i-02','Nasipanje i nabijanje','m³','Zemljani radovi','izvodjenje',102), ('sf-i-03','Odvoz viška zemlje','m³','Zemljani radovi','izvodjenje',103),
  ('sf-i-11','Temelji AB','m³','Betonski i AB radovi','izvodjenje',111), ('sf-i-12','AB zidovi','m³','Betonski i AB radovi','izvodjenje',112), ('sf-i-13','AB ploča','m³','Betonski i AB radovi','izvodjenje',113), ('sf-i-14','Armatura','kg','Betonski i AB radovi','izvodjenje',114), ('sf-i-15','Oplata','m²','Betonski i AB radovi','izvodjenje',115),
  ('sf-i-21','Zidanje blokom','m²','Zidarski radovi','izvodjenje',121), ('sf-i-22','Malterisanje','m²','Zidarski radovi','izvodjenje',122),
  ('sf-i-31','Krovna konstrukcija','m²','Krov','izvodjenje',131), ('sf-i-32','Pokrivanje','m²','Krov','izvodjenje',132), ('sf-i-33','Hidroizolacija','m²','Krov','izvodjenje',133),
  ('sf-i-41','Vodovod i kanalizacija','paušal','Instalacije','izvodjenje',141), ('sf-i-42','Elektroinstalacije','paušal','Instalacije','izvodjenje',142), ('sf-i-43','Grejanje i klimatizacija','paušal','Instalacije','izvodjenje',143),
  ('sf-i-51','Fasada','m²','Završni radovi','izvodjenje',151), ('sf-i-52','Stolarija','kom','Završni radovi','izvodjenje',152), ('sf-i-53','Podovi','m²','Završni radovi','izvodjenje',153), ('sf-i-54','Keramika','m²','Završni radovi','izvodjenje',154), ('sf-i-55','Moleraj','m²','Završni radovi','izvodjenje',155),
  ('sf-i-61','Asfaltiranje','m²','Niskogradnja','izvodjenje',161), ('sf-i-62','Ivičnjaci','m','Niskogradnja','izvodjenje',162), ('sf-i-63','Kolovozna konstrukcija','m³','Niskogradnja','izvodjenje',163)
on conflict (id) do nothing;
