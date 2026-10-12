-- ============================================================
-- GradnjaOS — šema baze za Supabase (SVEŽA baza)
-- Pokreni ceo fajl u: Supabase konzola -> SQL Editor -> New query
-- Postojeća baza: NE ovo, nego migracija-01..24.sql redom.
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
  opis  text,           -- duži opis (migracija 16)
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

-- ============================================================
-- Migracija 15 (identican sadrzaj) — rad na zadatku (tajmer) + angazovanost
-- ============================================================
create table if not exists rad_na_zadatku (
  id        text primary key,
  zadatak   text not null,
  gr        text not null,
  osoba     text not null,                  -- zaposleni.id | podizvodjaci.id
  start     timestamptz not null default now(),
  kraj      timestamptz,
  minuta    int,
  napomena  text
);
create index if not exists rad_na_zadatku_osoba on rad_na_zadatku (osoba, start desc);
create index if not exists rad_na_zadatku_zadatak on rad_na_zadatku (zadatak);
alter table rad_na_zadatku enable row level security;
drop policy if exists p_sel on rad_na_zadatku; drop policy if exists p_ins on rad_na_zadatku;
drop policy if exists p_upd on rad_na_zadatku; drop policy if exists p_del on rad_na_zadatku;
create policy p_sel on rad_na_zadatku for select to authenticated using (moje_gradiliste(gr));
create policy p_ins on rad_na_zadatku for insert to authenticated with check (moje_gradiliste(gr) and (je_direktor() or osoba = moj_autor()));
create policy p_upd on rad_na_zadatku for update to authenticated using (je_direktor() or osoba = moj_autor()) with check (je_direktor() or osoba = moj_autor());
create policy p_del on rad_na_zadatku for delete to authenticated using (je_super());
revoke all on rad_na_zadatku from anon;
grant select, insert, update, delete on rad_na_zadatku to authenticated;

-- minuta se racuna na serveru kad se upise kraj (klijent ne moze da "doda" sate)
create or replace function rad_minuta() returns trigger language plpgsql as $$
begin
  if new.kraj is not null then
    if new.kraj < new.start then new.kraj := new.start; end if;
    new.minuta := greatest(0, floor(extract(epoch from (new.kraj - new.start)) / 60))::int;
  else
    new.minuta := null;
  end if;
  return new;
end $$;
drop trigger if exists trg_rad_minuta on rad_na_zadatku;
create trigger trg_rad_minuta before insert or update on rad_na_zadatku
  for each row execute function rad_minuta();

-- Angazovanost (uprava): sati po osobi i gradilistu u periodu
create or replace function angazovanost(p_od date default (current_date - 30), p_do date default current_date)
returns table (osoba text, gr text, sesija bigint, minuta bigint, poslednji timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not je_direktor() then raise exception 'Samo uprava vidi angažovanost.'; end if;
  return query
    select r.osoba, r.gr, count(*)::bigint,
           coalesce(sum(coalesce(r.minuta, greatest(0, floor(extract(epoch from (now() - r.start)) / 60))::int)),0)::bigint,
           max(coalesce(r.kraj, r.start))
    from rad_na_zadatku r
    where r.start::date between p_od and p_do
    group by r.osoba, r.gr order by r.osoba, r.gr;
end $$;
revoke execute on function angazovanost(date, date) from public, anon;
grant  execute on function angazovanost(date, date) to authenticated;

-- dopuna migracije 14 (2026-10-08): dokumenti.data bez SELECT granta (table-level select se mora ukinuti)
revoke select on dokumenti from authenticated;
grant select (id, gr, autor, autor_uid, datum, naziv, tip, velicina, opis) on dokumenti to authenticated;

-- ============================================================
-- Migracija 16 (identican sadrzaj) — zadaci.opis
-- ============================================================
alter table zadaci add column if not exists opis text;
-- radnik/spoljni na svom zadatku i dalje menjaju samo kol (trigger iz migracije 14, dopunjen za opis)
create or replace function zastiti_kolone_zadaci() returns trigger language plpgsql as $$
begin
  if auth.uid() is not null and not vodim_gradiliste(new.gr) then
    new.naziv := old.naziv; new.gr := old.gr; new.zad := old.zad; new.prio := old.prio; new.rok := old.rok; new.opis := old.opis;
  end if;
  return new;
end $$;

-- ============================================================
-- Migracija 17 (identican sadrzaj) — vidljivost zadataka po ulozi
-- ============================================================
drop policy if exists p_sel on zadaci;
create policy p_sel on zadaci for select to authenticated
  using (vodim_gradiliste(gr) or (moje_gradiliste(gr) and zad = moj_autor()));

-- ============================================================
-- Migracija 18 (identican sadrzaj) — modul po nalogu (profili.moduli)
-- ============================================================
-- ============================================================
-- Migracija 18 (2026-10-11): modul po nalogu (odluka klijenta)
--   profili.moduli text[] ⊆ {projektovanje, izvodjenje}:
--     rukovodilac: 1 ili 2 modula (projektovanje, izvodjenje ili oba) + vidi_finansije kao do sad
--     radnik:      TACNO 1 modul (radnik projektovanja meri zadatke; radnik izvodjenja nema zadatke)
--     uprava / spoljni: oba (kolona se ignorise)
--   Server: modul_dozvoljen(gid) je deo vodim_gradiliste / moje_gradiliste (ne-uprava grane),
--   pa sve polise, view-ovi i RPC-ovi (zadaci, dnevnik, dokumenti, rad_na_zadatku, zdravlja_mojih,
--   moj_klijent, moj_podizvodjac) nasledjuju ogranicenje. Klijent: MODULI / modulDozvoljen().
--   dodeli_ulogu dobija p_moduli (nova 6-arg signatura; stara 5-arg ostaje kao omotac dok se
--   klijent ne osvezi). nalozi_pregled vraca moduli. Idempotentna.
-- ============================================================

-- ---------- 1) profili.moduli ----------
alter table profili add column if not exists moduli text[] not null default '{projektovanje,izvodjenje}';
alter table profili drop constraint if exists profili_moduli_check;
alter table profili add constraint profili_moduli_check
  check (moduli <@ array['projektovanje','izvodjenje']::text[] and cardinality(moduli) between 1 and 2);

-- ---------- 2) helperi ----------
create or replace function moji_moduli() returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce((select moduli from profili where user_id = auth.uid()), array['projektovanje','izvodjenje']::text[]);
$$;
-- modul gradilista dozvoljen nalogu (uprava: uvek)
create or replace function modul_dozvoljen(gid text) returns boolean
language sql stable security definer set search_path = public as $$
  select je_direktor()
      or exists (select 1 from gradilista g where g.id = gid and coalesce(g.modul,'izvodjenje') = any(moji_moduli()));
$$;
create or replace function vodim_gradiliste(gid text) returns boolean
language sql stable security definer set search_path = public as $$
  select je_direktor()
      or (modul_dozvoljen(gid)
          and exists (select 1 from gradilista g where g.id = gid and g.rukovodilac = moj_zaposleni() and moja_uloga() = 'rukovodilac'));
$$;
create or replace function moje_gradiliste(gid text) returns boolean
language sql stable security definer set search_path = public as $$
  select vodim_gradiliste(gid)
      or (modul_dozvoljen(gid) and (
             exists (select 1 from zaposleni_gradiliste zg where zg.gradiliste_id = gid and zg.aktivan and zg.zaposleni_id = moj_zaposleni() and moja_uloga() = 'radnik')
          or exists (select 1 from podizvodjac_gradiliste pg where pg.gradiliste_id = gid and pg.podizvodjac_id = moj_saradnik() and moja_uloga() = 'spoljni')));
$$;
revoke execute on function moji_moduli(), modul_dozvoljen(text) from public, anon;

-- ---------- 3) nalozi_pregled: + moduli ----------
drop function if exists nalozi_pregled();
create function nalozi_pregled()
returns table (user_id uuid, email text, uloga text, zaposleni_id text, saradnik_id text, vidi_finansije boolean,
               moduli text[], ime text, kreiran timestamptz, poslednja_prijava timestamptz, bez_profila boolean)
language plpgsql stable security definer set search_path = public, auth as $$
begin
  if not je_direktor() then raise exception 'Samo uprava vidi naloge.'; end if;
  return query
    select u.id, u.email::text, p.uloga, p.zaposleni_id, p.saradnik_id, coalesce(p.vidi_finansije,false),
           coalesce(p.moduli, array['projektovanje','izvodjenje']::text[]), p.ime,
           u.created_at, u.last_sign_in_at, (p.user_id is null) as bez_profila
    from auth.users u left join profili p on p.user_id = u.id
    order by (p.user_id is null), u.email;
end $$;
revoke execute on function nalozi_pregled() from public, anon;
grant  execute on function nalozi_pregled() to authenticated;

-- ---------- 4) dodeli_ulogu: + p_moduli ----------
drop function if exists dodeli_ulogu(text, text, text, boolean, text, text[]);
create function dodeli_ulogu(p_email text, p_uloga text, p_zaposleni_id text default null,
                             p_vidi_finansije boolean default false, p_saradnik_id text default null,
                             p_moduli text[] default null)
returns text language plpgsql security definer set search_path = public, auth as $$
declare uid uuid; stara text; ja text; zid text; sid text; fin boolean; mods text[];
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
  -- moduli: rukovodilac 1–2, radnik tacno 1, ostali oba
  mods := (select array_agg(distinct m) from unnest(coalesce(p_moduli, array['projektovanje','izvodjenje']::text[])) m
           where m in ('projektovanje','izvodjenje'));
  if mods is null or cardinality(mods) = 0 then raise exception 'Izaberi bar jedan modul (projektovanje / izvođenje).'; end if;
  if p_uloga = 'radnik' and cardinality(mods) <> 1 then raise exception 'Radnik se vezuje za tačno jedan modul.'; end if;
  if p_uloga not in ('rukovodilac','radnik') then mods := array['projektovanje','izvodjenje']::text[]; end if;
  if stara = 'direktor' and p_uloga <> 'direktor' and (select count(*) from profili where uloga = 'direktor') <= 1 then
    raise exception 'Ovo je poslednji direktor — prvo dodeli ulogu direktora nekom drugom.';
  end if;
  insert into profili (user_id, zaposleni_id, saradnik_id, uloga, vidi_finansije, moduli, ime)
    values (uid, zid, sid, p_uloga, fin, mods,
            coalesce((select z.ime from zaposleni z where z.id = zid), (select p.naziv from podizvodjaci p where p.id = sid), p_email))
    on conflict (user_id) do update
      set zaposleni_id = excluded.zaposleni_id, saradnik_id = excluded.saradnik_id, uloga = excluded.uloga,
          vidi_finansije = excluded.vidi_finansije, moduli = excluded.moduli, ime = excluded.ime;
  select email into ja from auth.users where id = auth.uid();
  insert into log_koriscenja (user_id, email, uloga, dogadjaj, detalj)
    values (auth.uid(), ja, moja_uloga(), 'uloga_promena',
            jsonb_build_object('email', lower(p_email), 'stara', stara, 'nova', p_uloga, 'zaposleni_id', zid, 'saradnik_id', sid,
                               'vidi_finansije', fin, 'moduli', to_jsonb(mods)));
  return case when stara is null then 'dodeljeno' else 'izmenjeno' end;
end $$;
revoke execute on function dodeli_ulogu(text, text, text, boolean, text, text[]) from public, anon;
grant  execute on function dodeli_ulogu(text, text, text, boolean, text, text[]) to authenticated;
-- NEMA 5-arg omotaca: PostgREST ne moze da izabere izmedju 5-arg i 6-arg (sa default-om) → PGRST203
-- (provereno 2026-10-11 curl-om). 6-arg sa `p_moduli default null` je sama po sebi unazad kompatibilna.
drop function if exists dodeli_ulogu(text, text, text, boolean, text);

-- ============================================================
-- Migracija 19 (identican sadrzaj) — sifarnik artikala + situacije sa stavkama
-- ============================================================
-- ============================================================
-- Migracija 19 (2026-10-11): sifarnik artikala + situacije sa stavkama (zahtev klijenta)
--   1) sifrarnik.sifra + 81 artikal "ELOM projekt" (PDF Sifarnik artikala + 3 dopune: 46, 47, M029);
--      predmer.sifra (snimak sifre pri izboru iz sifarnika) → predmer_v + column grant.
--   2) situacije: vrsta (privremena|okoncana), autor, napomena; iznos postaje FIN kolona
--      (column grant + situacije_v sa CASE vidi_finansije) → rukovodilac BEZ finansija pravi
--      situaciju i vidi je bez iznosa. Polise: select/insert vodim_gradiliste (+ fin & moje);
--      update uprava ili autor svoje dok nije placena; delete super. Trigger zastiti_kolone_situacije:
--      ne-uprava ne dira iznos/status/gr/autor.
--   3) situacija_stavke(sit, gr, predmer_id, sifra, poz, jm, kol, kol_ugovoreno, kumulativ, razlika)
--      BEZ cena. preracunaj_situacije(gid) (security definer — ima cene): kol_ugovoreno iz predmera,
--      kumulativ po artiklu kroz situacije (izdato, id), razlika = max(0, kumulativ - ugovoreno),
--      situacije.iznos = Σ kol × predmer.cena (samo situacije koje imaju stavke). Trigeri na stavkama
--      i na situacije(izdato); pg_trigger_depth() cuva od rekurzije. Idempotentna.
-- ============================================================

-- ---------- 1) sifra ----------
alter table sifrarnik add column if not exists sifra text;
alter table predmer add column if not exists sifra text;
grant select (sifra) on predmer to authenticated;
drop view if exists predmer_v;
create view predmer_v with (security_barrier = true) as
  select id, gr, poz, jm, kol, izv, zaduzen, sifra, case when vidi_finansije() then cena end as cena
  from predmer where moje_gradiliste(gr);
revoke all on predmer_v from public, anon; grant select on predmer_v to authenticated;

insert into sifrarnik (id, naziv, jm, grupa, modul, redosled, aktivan, sifra) values
  ('sf-a-001', 'PEGASUS HO 6W 24v IP65Warm White Medium Titan', 'kom', 'Artikli (ELOM)', 'izvodjenje', 201, true, '01-1'),
  ('sf-a-002', 'PEGASUS Antiglare Accessory Titan', 'kom', 'Artikli (ELOM)', 'izvodjenje', 202, true, '01-2'),
  ('sf-a-003', 'Picket for PEGASUS', 'kom', 'Artikli (ELOM)', 'izvodjenje', 203, true, '01-3'),
  ('sf-a-004', 'Connector 4-pole IP68', 'kom', 'Artikli (ELOM)', 'izvodjenje', 204, true, '01-4'),
  ('sf-a-005', 'DRIVER LED 24V DC/60W IP 67 162,5x42,5x32', 'kom', 'Artikli (ELOM)', 'izvodjenje', 205, true, '01-5'),
  ('sf-a-006', 'Svetiljka I-TRON ZERO 5p5 STU-M 7040.100-1M,19.1W,4000k,2890lm AEC ILLUMINAZIONE', 'kom', 'Artikli (ELOM)', 'izvodjenje', 206, true, '1'),
  ('sf-a-007', 'Dekorativni aluminijumski stup zip POLE RX2 ALLUMINIUM 5.0 5000MM sa dve lire', 'kom', 'Artikli (ELOM)', 'izvodjenje', 207, true, '10'),
  ('sf-a-008', 'Priključna ploča za jedan osigurač TERMINAL BOARD FOR RX ALLUMINIUM POLE,1 FUSE', 'kom', 'Artikli (ELOM)', 'izvodjenje', 208, true, '11'),
  ('sf-a-009', 'Priključna ploča za dva osigurača TERMINAL BOARD FOR RX ALLUMINIUM POLE,2 FUSE', 'kom', 'Artikli (ELOM)', 'izvodjenje', 209, true, '12'),
  ('sf-a-010', 'Set za ankerisanje M18', 'kom', 'Artikli (ELOM)', 'izvodjenje', 210, true, '13'),
  ('sf-a-011', 'S-PREVIDIA-C200LG', 'kom', 'Artikli (ELOM)', 'izvodjenje', 211, true, '14'),
  ('sf-a-012', 'S-PREVIDIA-CDIAL', 'kom', 'Artikli (ELOM)', 'izvodjenje', 212, true, '15'),
  ('sf-a-013', 'ULTRA 12150', 'kom', 'Artikli (ELOM)', 'izvodjenje', 213, true, '16'),
  ('sf-a-014', 'S-WD100', 'kom', 'Artikli (ELOM)', 'izvodjenje', 214, true, '17'),
  ('sf-a-015', 'S-WC0010', 'kom', 'Artikli (ELOM)', 'izvodjenje', 215, true, '18'),
  ('sf-a-016', 'S-EWT100', 'kom', 'Artikli (ELOM)', 'izvodjenje', 216, true, '19'),
  ('sf-a-017', 'Svetiljka I-TRON ZERO 5P5 STU-M 7040.140-2M,52.3W,4000K,7930lm AEC ILLUMINAZIONE', 'kom', 'Artikli (ELOM)', 'izvodjenje', 217, true, '2'),
  ('sf-a-018', 'S-XWT100', 'kom', 'Artikli (ELOM)', 'izvodjenje', 218, true, '20'),
  ('sf-a-019', 'S-SPS24060S', 'kom', 'Artikli (ELOM)', 'izvodjenje', 219, true, '21'),
  ('sf-a-020', 'ULTRA 1270', 'kom', 'Artikli (ELOM)', 'izvodjenje', 220, true, '22'),
  ('sf-a-021', 'S-WS2010RE', 'kom', 'Artikli (ELOM)', 'izvodjenje', 221, true, '23'),
  ('sf-a-022', 'S-WM110', 'kom', 'Artikli (ELOM)', 'izvodjenje', 222, true, '24'),
  ('sf-a-023', 'S-WM202SR', 'kom', 'Artikli (ELOM)', 'izvodjenje', 223, true, '25'),
  ('sf-a-024', 'Vrata za stubove serije RX-2', 'kom', 'Artikli (ELOM)', 'izvodjenje', 224, true, '26'),
  ('sf-a-025', 'Obojena kapa za stub', 'kom', 'Artikli (ELOM)', 'izvodjenje', 225, true, '27'),
  ('sf-a-026', 'Set za montazu', 'kom', 'Artikli (ELOM)', 'izvodjenje', 226, true, '28'),
  ('sf-a-027', 'S-L-MC-SG', 'kom', 'Artikli (ELOM)', 'izvodjenje', 227, true, '29'),
  ('sf-a-028', 'Svetiljka ALO 1 2AB10 ASW 7040.350-22M ES OT30 240W,400K AEC ILLUMINAZIONE', 'kom', 'Artikli (ELOM)', 'izvodjenje', 228, true, '3'),
  ('sf-a-029', 'S-L-OP-SG', 'kom', 'Artikli (ELOM)', 'izvodjenje', 229, true, '30'),
  ('sf-a-030', 'S-SGCP200', 'kom', 'Artikli (ELOM)', 'izvodjenje', 230, true, '31'),
  ('sf-a-031', 'S-VW2W100', 'kom', 'Artikli (ELOM)', 'izvodjenje', 231, true, '32'),
  ('sf-a-032', 'S-SGWE100', 'kom', 'Artikli (ELOM)', 'izvodjenje', 232, true, '33'),
  ('sf-a-033', 'S-CWS100', 'kom', 'Artikli (ELOM)', 'izvodjenje', 233, true, '34'),
  ('sf-a-034', 'S-SGWS-MOD', 'kom', 'Artikli (ELOM)', 'izvodjenje', 234, true, '35'),
  ('sf-a-035', 'Čelični nož TB 30', 'kom', 'Artikli (ELOM)', 'izvodjenje', 235, true, '36'),
  ('sf-a-036', 'Čelični nož TB 31', 'kom', 'Artikli (ELOM)', 'izvodjenje', 236, true, '37'),
  ('sf-a-037', 'Adresabilna centrala za dojavu pozara PREVIDIA-C-100LG INIM', 'kom', 'Artikli (ELOM)', 'izvodjenje', 237, true, '38'),
  ('sf-a-038', 'Antres P 62 7,stubovi ,VALMONT', 'kom', 'Artikli (ELOM)', 'izvodjenje', 238, true, '39'),
  ('sf-a-039', 'Svetiljka I-TRON ZERO 5p5 STU-M 7040.140-4M Cl.2 AEC ILLUMINAZIONE', 'kom', 'Artikli (ELOM)', 'izvodjenje', 239, true, '4'),
  ('sf-a-040', 'Electric connecting box TB-2', 'kom', 'Artikli (ELOM)', 'izvodjenje', 240, true, '40'),
  ('sf-a-041', 'Gumeni orebljeni podmetac 300x300', 'kom', 'Artikli (ELOM)', 'izvodjenje', 241, true, '41'),
  ('sf-a-042', 'ITALO 1 5P5 STA 7040.100-3M CL.2 Grafite', 'kom', 'Artikli (ELOM)', 'izvodjenje', 242, true, '42'),
  ('sf-a-043', 'Svetiljka ECO RAYS TP 5P5 S05 7040.100-1M Cl.2 F grafite', 'kom', 'Artikli (ELOM)', 'izvodjenje', 243, true, '43'),
  ('sf-a-044', 'MX PRO 2 5P5 AS-45W 7040.120-7M Cl.2F Vin E1 120mA', 'kom', 'Artikli (ELOM)', 'izvodjenje', 244, true, '44'),
  ('sf-a-045', 'Svetiljka I-TRON ZERO 5P5STE-M 7040.140-2M CL.2 F Vin E1 140mA Grafite', 'kom', 'Artikli (ELOM)', 'izvodjenje', 245, true, '45'),
  ('sf-a-046', 'Svetiljka I-TRON ZERO 5P5 STU-M 7040.140-3M CL.2 AEC ILLUMINAZIONE', 'kom', 'Artikli (ELOM)', 'izvodjenje', 246, true, '5'),
  ('sf-a-047', 'Svetiljka ECO RAYS TP 5P5 STA 7040.100-2M AEC ILLUMINAZIONE', 'kom', 'Artikli (ELOM)', 'izvodjenje', 247, true, '6'),
  ('sf-a-048', 'Kapica cap for nema socket JL-208 IP66 AEC ILLUMINAZIONE', 'kom', 'Artikli (ELOM)', 'izvodjenje', 248, true, '7'),
  ('sf-a-049', 'Svetiljka tipa MOD 2.0 URBAN 200 RX2 (500) 0F2H1 S05 4,7-1m CR170 cl.2 FIX AEC ILLUMINAZIONE', 'kom', 'Artikli (ELOM)', 'izvodjenje', 249, true, '8'),
  ('sf-a-050', 'Dekorativni aluminijumski stub tip POLE RX2 ALLUMINIUM 5.0 5000MM sa jednom lirom', 'kom', 'Artikli (ELOM)', 'izvodjenje', 250, true, '9'),
  ('sf-a-051', 'Elektronski prihvatnik 6-14 V AC/DC za blokadu/deblokadu', 'kom', 'Artikli (ELOM)', 'izvodjenje', 251, true, 'M001'),
  ('sf-a-052', 'Razvodni orman sistema tehnicke zastite', 'kom', 'Artikli (ELOM)', 'izvodjenje', 252, true, 'M002'),
  ('sf-a-053', 'Modul kontrole pristupasa 20RFID kartica', 'kom', 'Artikli (ELOM)', 'izvodjenje', 253, true, 'M003'),
  ('sf-a-054', 'Citac RFID/NFC kartica i tagova', 'kom', 'Artikli (ELOM)', 'izvodjenje', 254, true, 'M004'),
  ('sf-a-055', 'Svetiljka DN142B 10S/840 PSU-E WR Philips', 'kom', 'Artikli (ELOM)', 'izvodjenje', 255, true, 'M005'),
  ('sf-a-056', 'AWEX panik svetiljka EXIT S1 WIP65', 'kom', 'Artikli (ELOM)', 'izvodjenje', 256, true, 'M006'),
  ('sf-a-057', 'ANSEC samostojeci rek ormar 33U', 'kom', 'Artikli (ELOM)', 'izvodjenje', 257, true, 'M007'),
  ('sf-a-058', 'ANSEC zidni rek ormar 15U', 'kom', 'Artikli (ELOM)', 'izvodjenje', 258, true, 'M008'),
  ('sf-a-059', 'Parapet 210x90', 'm', 'Artikli (ELOM)', 'izvodjenje', 259, true, 'M009'),
  ('sf-a-060', 'GA-OTRW poklopac za parapet', 'm', 'Artikli (ELOM)', 'izvodjenje', 260, true, 'M010'),
  ('sf-a-061', 'svetiljka WL060V LED 17S/840 PSU Philips', 'kom', 'Artikli (ELOM)', 'izvodjenje', 261, true, 'M011'),
  ('sf-a-062', 'Svetiljka WL070V GEN2 11_17S/830_860 PSU PHILIPS', 'kom', 'Artikli (ELOM)', 'izvodjenje', 262, true, 'M012'),
  ('sf-a-063', 'Svetiljka WT065C G3 LED 68S/840 PSU', 'kom', 'Artikli (ELOM)', 'izvodjenje', 263, true, 'M013'),
  ('sf-a-064', 'AWEX panik svetiljka EXIT S IP65 LED 1W', 'kom', 'Artikli (ELOM)', 'izvodjenje', 264, true, 'M014'),
  ('sf-a-065', 'Svetiljka RC065B G5 LED 41S/840 PSU W60L60 PHILIPS', 'kom', 'Artikli (ELOM)', 'izvodjenje', 265, true, 'M015'),
  ('sf-a-066', 'Nadrgradni ram 600x600x70mm', 'kom', 'Artikli (ELOM)', 'izvodjenje', 266, true, 'M016'),
  ('sf-a-067', 'Svetiljka LL24x 80S/840 NE PSU a BV WH PHILIPS', 'kom', 'Artikli (ELOM)', 'izvodjenje', 267, true, 'M017'),
  ('sf-a-068', 'SAM NADGRADNA PANIK SVETILJKA 20M 4,8W3H', 'kom', 'Artikli (ELOM)', 'izvodjenje', 268, true, 'M018'),
  ('sf-a-069', 'Gromobran sa ranim startovanjem D368425-60M', 'kom', 'Artikli (ELOM)', 'izvodjenje', 269, true, 'M019'),
  ('sf-a-070', 'Svetiljka DN145B LED 20S/830 840 PSUWh+RAM PHILIPS', 'kom', 'Artikli (ELOM)', 'izvodjenje', 270, true, 'M020'),
  ('sf-a-071', 'Svetiljka RC065B G5 41S/840 PSU W60L60 NOC PHILIPS', 'kom', 'Artikli (ELOM)', 'izvodjenje', 271, true, 'M021'),
  ('sf-a-072', 'Svetiljka Sm060C G2 34_ 40S/840 PSU W20L120 NOC PHILIPS', 'kom', 'Artikli (ELOM)', 'izvodjenje', 272, true, 'M022'),
  ('sf-a-073', 'Svetiljka WL070V GEN2 11_17S/830 840 860 PSU PHILIPS', 'kom', 'Artikli (ELOM)', 'izvodjenje', 273, true, 'M023'),
  ('sf-a-074', 'AJAX Hub2 WH', 'kom', 'Artikli (ELOM)', 'izvodjenje', 274, true, 'M024'),
  ('sf-a-075', 'AJAX Keypad WH', 'kom', 'Artikli (ELOM)', 'izvodjenje', 275, true, 'M025'),
  ('sf-a-076', 'AJAX DoorProtect WH', 'kom', 'Artikli (ELOM)', 'izvodjenje', 276, true, 'M026'),
  ('sf-a-077', 'AJAX MOtionProtect WH', 'kom', 'Artikli (ELOM)', 'izvodjenje', 277, true, 'M027'),
  ('sf-a-078', 'AJAX HomeSiren WH', 'kom', 'Artikli (ELOM)', 'izvodjenje', 278, true, 'M028'),
  ('sf-a-079', 'Svetiljka ITALO 1 5P5 7040.120-3M 65.6W AEC ILLUMINAZIONE', 'kom', 'Artikli (ELOM)', 'izvodjenje', 279, true, '46'),
  ('sf-a-080', 'Svetiljka ITALO 1 5P5 7040.200-3M 113W AEC ILLUMINAZIONE', 'kom', 'Artikli (ELOM)', 'izvodjenje', 280, true, '47'),
  ('sf-a-081', 'Svetiljka RC132V G6 36S/840 PSU W60L60', 'kom', 'Artikli (ELOM)', 'izvodjenje', 281, true, 'M029')
on conflict (id) do update set naziv = excluded.naziv, jm = excluded.jm, grupa = excluded.grupa, modul = excluded.modul, sifra = excluded.sifra;

-- ---------- 2) situacije ----------
alter table situacije add column if not exists vrsta text not null default 'privremena';
alter table situacije drop constraint if exists situacije_vrsta_check;
alter table situacije add constraint situacije_vrsta_check check (vrsta in ('privremena','okoncana'));
alter table situacije add column if not exists autor text;
alter table situacije add column if not exists napomena text;
revoke select on situacije from authenticated, anon;
grant select (id, gr, br, opis, izdato, valuta, status, vrsta, autor, napomena) on situacije to authenticated;
grant insert, update, delete on situacije to authenticated;
drop view if exists situacije_v;
create view situacije_v with (security_barrier = true) as
  select id, gr, br, opis, izdato, valuta, status, vrsta, autor, napomena, case when vidi_finansije() then iznos end as iznos
  from situacije where vodim_gradiliste(gr) or (vidi_finansije() and moje_gradiliste(gr));
revoke all on situacije_v from public, anon; grant select on situacije_v to authenticated;
drop policy if exists p_sel on situacije;
create policy p_sel on situacije for select to authenticated using (vodim_gradiliste(gr) or (vidi_finansije() and moje_gradiliste(gr)));
drop policy if exists p_ins on situacije;
create policy p_ins on situacije for insert to authenticated with check (vodim_gradiliste(gr));
drop policy if exists p_upd on situacije;
create policy p_upd on situacije for update to authenticated
  using (je_direktor() or (vodim_gradiliste(gr) and autor = moj_autor() and status <> 'placeno'))
  with check (je_direktor() or (vodim_gradiliste(gr) and autor = moj_autor() and status <> 'placeno'));
drop policy if exists p_del on situacije;
create policy p_del on situacije for delete to authenticated using (je_super());

create or replace function zastiti_kolone_situacije() returns trigger language plpgsql as $$
begin
  if pg_trigger_depth() > 1 then return new; end if;   -- preracunaj_situacije (server) sme da upise iznos
  if tg_op = 'INSERT' then
    if not je_direktor() then new.iznos := 0; new.status := 'ceka'; new.autor := moj_autor(); end if;
    if new.autor is null then new.autor := 'direkcija'; end if;
    return new;
  end if;
  if not je_direktor() then
    new.iznos := old.iznos; new.status := old.status; new.gr := old.gr; new.autor := old.autor;
  end if;
  return new;
end $$;
drop trigger if exists trg_zastiti_situacije on situacije;
create trigger trg_zastiti_situacije before insert or update on situacije
  for each row execute function zastiti_kolone_situacije();

-- ---------- 3) stavke ----------
create table if not exists situacija_stavke (
  id text primary key,
  sit text not null references situacije(id) on delete cascade,
  gr text not null references gradilista(id) on delete cascade,
  predmer_id text references predmer(id) on delete set null,
  sifra text, poz text not null, jm text,
  kol numeric not null default 0,
  kol_ugovoreno numeric not null default 0,
  kumulativ numeric not null default 0,
  razlika numeric not null default 0
);
create index if not exists situacija_stavke_sit_idx on situacija_stavke(sit);
create index if not exists situacija_stavke_gr_idx on situacija_stavke(gr);
alter table situacija_stavke enable row level security;
grant select, insert, update, delete on situacija_stavke to authenticated;
drop policy if exists p_sel on situacija_stavke;
create policy p_sel on situacija_stavke for select to authenticated using (vodim_gradiliste(gr) or (vidi_finansije() and moje_gradiliste(gr)));
drop policy if exists p_ins on situacija_stavke;
create policy p_ins on situacija_stavke for insert to authenticated with check (vodim_gradiliste(gr));
drop policy if exists p_upd on situacija_stavke;
create policy p_upd on situacija_stavke for update to authenticated using (vodim_gradiliste(gr)) with check (vodim_gradiliste(gr));
drop policy if exists p_del on situacija_stavke;
create policy p_del on situacija_stavke for delete to authenticated using (vodim_gradiliste(gr));

create or replace function preracunaj_situacije(p_gid text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_gid is null then return; end if;
  update situacija_stavke st set kol_ugovoreno = coalesce((select p.kol from predmer p where p.id = st.predmer_id), 0)
   where st.gr = p_gid;
  update situacija_stavke st set kumulativ = x.kum, razlika = greatest(0, x.kum - st.kol_ugovoreno)
    from (select st2.id,
                 sum(st2.kol) over (partition by st2.gr, coalesce(st2.predmer_id, 'sifra:'||st2.sifra, 'poz:'||lower(st2.poz))
                                    order by s2.izdato, s2.id, st2.id rows between unbounded preceding and current row) as kum
            from situacija_stavke st2 join situacije s2 on s2.id = st2.sit where st2.gr = p_gid) x
   where x.id = st.id;
  update situacije s set iznos = coalesce((select sum(st.kol * coalesce(p.cena, 0)) from situacija_stavke st left join predmer p on p.id = st.predmer_id where st.sit = s.id), 0)
   where s.gr = p_gid and exists (select 1 from situacija_stavke st where st.sit = s.id);
end $$;
revoke execute on function preracunaj_situacije(text) from public, anon;

create or replace function trg_stavke_preracun() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if pg_trigger_depth() > 1 then return null; end if;
  if tg_op in ('INSERT','UPDATE') then perform preracunaj_situacije(new.gr); end if;
  if tg_op = 'DELETE' or (tg_op = 'UPDATE' and old.gr is distinct from new.gr) then perform preracunaj_situacije(old.gr); end if;
  return null;
end $$;
drop trigger if exists trg_stavke_preracun on situacija_stavke;
create trigger trg_stavke_preracun after insert or update or delete on situacija_stavke
  for each row execute function trg_stavke_preracun();

create or replace function trg_situacije_preracun() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if pg_trigger_depth() > 1 then return null; end if;
  perform preracunaj_situacije(new.gr);
  return null;
end $$;
drop trigger if exists trg_situacije_preracun on situacije;
create trigger trg_situacije_preracun after insert or update of izdato on situacije
  for each row execute function trg_situacije_preracun();


-- predmer (kol/cena) menja ugovoreno i iznos → preracun situacija tog gradilista
create or replace function trg_predmer_preracun_sit() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if pg_trigger_depth() > 1 then return null; end if;
  if tg_op = 'DELETE' then perform preracunaj_situacije(old.gr); else perform preracunaj_situacije(new.gr); end if;
  return null;
end $$;
drop trigger if exists trg_predmer_preracun_sit on predmer;
create trigger trg_predmer_preracun_sit after insert or update of kol, cena or delete on predmer
  for each row execute function trg_predmer_preracun_sit();

-- ---------- 4) obrisi_gradiliste: + stavke ----------
create or replace function obrisi_gradiliste(p_gid text) returns void
language plpgsql security definer set search_path = public, auth as $$
declare ja text; naz text;
begin
  if not je_super() then raise exception 'Samo direktor briše gradilište.'; end if;
  select naziv into naz from gradilista where id = p_gid;
  if naz is null then return; end if;
  delete from situacija_stavke where gr = p_gid;
  delete from rad_na_zadatku where gr = p_gid;
  delete from zadaci where gr = p_gid; delete from dnevnik where gr = p_gid; delete from narudzbe where gr = p_gid;
  delete from predmer where gr = p_gid; delete from troskovi_st where gr = p_gid; delete from situacije where gr = p_gid;
  delete from mag_promene where gr = p_gid; delete from dokumenti where gr = p_gid;
  update resursi set gr = null where gr = p_gid;
  delete from zaposleni_gradiliste where gradiliste_id = p_gid; delete from podizvodjac_gradiliste where gradiliste_id = p_gid;
  delete from gradilista where id = p_gid;
  select email into ja from auth.users where id = auth.uid();
  insert into log_koriscenja (user_id, email, uloga, dogadjaj, detalj)
    values (auth.uid(), ja, moja_uloga(), 'brisanje', jsonb_build_object('tabela','gradilista','id',p_gid,'naziv',naz));
end $$;
revoke execute on function obrisi_gradiliste(text) from public, anon;
grant  execute on function obrisi_gradiliste(text) to authenticated;

-- ============================================================
-- Migracija 20 (identican sadrzaj) — Projektovanje: sveske su zadaci
-- ============================================================
-- ============================================================
-- Migracija 20 (2026-10-11): Projektovanje — sveske (+ razno) iz specifikacije SU zadaci (odluka klijenta)
--   zadaci.predmer_id → svaka stavka specifikacije (sveska) ima zadatak dodeljen coveku (zaduzen);
--   covek na njemu klikne play/pauza/stop (rad_na_zadatku). Klijent ih sinhronizuje
--   (sinhronizujSveske), server prati: zadatak u 'done' → predmer.izv = kol (sveska predata),
--   povratak iz 'done' → izv = 0 ako je bila puna; napredak se preracuna (osvezi_napredak).
--   Rukovodilac (vodim) sme da DODA stavku specifikacije na projektantskom gradilistu i da joj
--   menja poz/jm/kol/zaduzen/sifra (ne cenu). Izvodjenje: nepromenjeno (bez zadataka; predmer
--   samo uprava). Idempotentna.
-- ============================================================
alter table zadaci add column if not exists predmer_id text references predmer(id) on delete cascade;
create index if not exists zadaci_predmer_idx on zadaci(predmer_id);

-- predmer: insert i za rukovodioca projektantskog gradilista
create or replace function gradiliste_je_pro(gid text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from gradilista g where g.id = gid and coalesce(g.modul,'izvodjenje') = 'projektovanje');
$$;
revoke execute on function gradiliste_je_pro(text) from public, anon;
drop policy if exists p_ins on predmer;
create policy p_ins on predmer for insert to authenticated
  with check (je_direktor() or (vodim_gradiliste(gr) and gradiliste_je_pro(gr)));

create or replace function zastiti_kolone_predmer() returns trigger language plpgsql as $$
begin
  if auth.uid() is not null and not je_direktor() then
    new.gr := old.gr; new.cena := old.cena;
    if not gradiliste_je_pro(old.gr) then
      new.poz := old.poz; new.jm := old.jm; new.kol := old.kol; new.zaduzen := old.zaduzen; new.sifra := old.sifra;
      -- izvodjenje: dozvoljeno samo izv
    end if;
    -- projektovanje: rukovodilac (vodim) menja poz/jm/kol/zaduzen/sifra/izv
  end if;
  return new;
end $$;
drop trigger if exists trg_zastiti_predmer on predmer;
create trigger trg_zastiti_predmer before update on predmer
  for each row execute function zastiti_kolone_predmer();

-- zadatak sveske → izvedeno sveske (definer: radnik ne sme direktno u predmer)
create or replace function trg_zadatak_sveska_izv() returns trigger language plpgsql security definer set search_path = public as $$
declare k numeric; i numeric;
begin
  if pg_trigger_depth() > 1 or new.predmer_id is null then return null; end if;
  if tg_op = 'UPDATE' and new.kol is not distinct from old.kol then return null; end if;
  select kol, coalesce(izv,0) into k, i from predmer where id = new.predmer_id;
  if k is null then return null; end if;
  if new.kol = 'done' then
    update predmer set izv = k where id = new.predmer_id and coalesce(izv,0) is distinct from k;
  elsif tg_op = 'UPDATE' and old.kol = 'done' and i >= k and k > 0 then
    update predmer set izv = 0 where id = new.predmer_id;
  end if;
  perform osvezi_napredak(new.gr);
  return null;
end $$;
drop trigger if exists trg_zadatak_sveska_izv on zadaci;
create trigger trg_zadatak_sveska_izv after insert or update of kol on zadaci
  for each row execute function trg_zadatak_sveska_izv();

-- ============================================================
-- Migracija 21 (identican sadrzaj) — sifarnik Izvodjenja samo artikli
-- ============================================================
-- ============================================================
-- Migracija 21 (2026-10-11): sifarnik Izvodjenja = SAMO artikli (81, ELOM, migracija 19) + Razno (slobodne stavke u formi);
--   24 "pozicije radova" (sf-i-*, migracija 14) se brisu (odluka klijenta). Usluge uprava dodaje u sifarnik rucno.
--   Projektovanje NEMA sifarnik u UI: sveske su tipovi dokumentacije (IDR / IDP-PGD / PZI + poddokumenti);
--   redovi sf-p-* ostaju u tabeli kao izvor cek-liste pri kreiranju gradilista, ali se ne prikazuju u sifarniku.
-- Idempotentna.
-- ============================================================
delete from sifrarnik where id like 'sf-i-%';

-- ============================================================
-- Migracija 22 (2026-10-12): dokument uz svesku (Projektovanje — odluka klijenta: fioka projektantskog gradilista
--   nema tim ni listu zadataka, nego tipove dokumentacije (sveske = redovi predmera) PO OSOBI, sa dodelom osobe i
--   ucitavanjem dokumenata uz svaku svesku). dokumenti.predmer_id (FK → predmer, on delete set null) + view.
--   Tim projektantskog gradilista se izvodi iz dodela: ko je zaduzen za svesku, klijent ga upise u
--   zaposleni_gradiliste / podizvodjac_gradiliste (polisa insert = vodim_gradiliste) — inace radnik ne vidi gradiliste.
-- Idempotentna.
-- ============================================================
alter table dokumenti add column if not exists predmer_id text references predmer(id) on delete set null;
create index if not exists dokumenti_predmer on dokumenti (predmer_id);
grant select (predmer_id) on dokumenti to authenticated;

drop view if exists dokumenti_v;
create view dokumenti_v with (security_barrier = true) as
  select id, gr, autor, autor_uid, datum, naziv, tip, velicina, opis, predmer_id from dokumenti where moje_gradiliste(gr);
revoke all on dokumenti_v from public, anon; grant select on dokumenti_v to authenticated;

-- ============================================================
-- Migracija 23 (2026-10-12), odluke klijenta:
--   1) Jedinicne cene (predmer.cena) vidi i SVAKI rukovodilac na svom gradilistu IZVODJENJA (bez zastavice
--      vidi_finansije). Cene i dalje "fiksira" uprava: trigger zastiti_kolone_predmer ne-upravi ne dozvoljava
--      promenu cene (nepromenjen). Budzet/troskovi/naplata/iznos situacije ostaju iza vidi_finansije().
--   2) gradilista.adresa (ulica i broj) — nova kolona, u gradilista_v, zasticena za ne-upravu kao i lok.
-- Idempotentna.
-- ============================================================
drop view if exists predmer_v;
create view predmer_v with (security_barrier = true) as
  select id, gr, poz, jm, kol, izv, zaduzen, sifra,
         case when vidi_finansije() or (vodim_gradiliste(gr) and not gradiliste_je_pro(gr)) then cena end as cena
  from predmer where moje_gradiliste(gr);
revoke all on predmer_v from public, anon; grant select on predmer_v to authenticated;

alter table gradilista add column if not exists adresa text;
drop view if exists gradilista_v;
create view gradilista_v with (security_barrier = true) as
  select id, naziv, modul, tip, lok, adresa, klijent, rukovodilac, pocetak, rok, napredak, status, faza,
         povrsina, nivo, nadzor, adm,
         case when vidi_finansije() then budzet    end as budzet,
         case when vidi_finansije() then troskovi  end as troskovi,
         case when vidi_finansije() then potroseno end as potroseno,
         case when vidi_finansije() then naplaceno end as naplaceno
  from gradilista where moje_gradiliste(id);
revoke all on gradilista_v from public, anon; grant select on gradilista_v to authenticated;

create or replace function zastiti_kolone_gradilista() returns trigger language plpgsql as $$
begin
  if auth.uid() is not null and not je_direktor() then
    new.naziv := old.naziv; new.modul := old.modul; new.tip := old.tip; new.lok := old.lok; new.adresa := old.adresa;
    new.klijent := old.klijent; new.rukovodilac := old.rukovodilac; new.pocetak := old.pocetak;
    new.rok := old.rok; new.povrsina := old.povrsina; new.nivo := old.nivo; new.nadzor := old.nadzor;
    new.adm := old.adm; new.budzet := old.budzet; new.troskovi := old.troskovi;
    new.potroseno := old.potroseno; new.naplaceno := old.naplaceno;
    -- dozvoljeno: napredak, status, faza
  end if;
  return new;
end $$;

-- ============================================================
-- Migracija 24 (2026-10-12): MARZA UKLONJENA (odluka klijenta: "ne merimo to").
--   U bazi marza nikad nije bila kolona — zivela je samo u formuli zdravlja (plan_m / ostv_m). Sada:
--   zavrsen projekat = 100 (ranije 90 + 10/5 po planskoj marzi), nema penala "ostvarena marza < 8%".
--   Ostaju: rok, zadaci, troskovi ispred napretka (plan = gradilista.troskovi), naplata zaostaje.
--   ISTA formula kao zdravlje(g) na klijentu (index.html) — menjati oba.
-- Idempotentna.
-- ============================================================
create or replace function zdravlje_gradilista(gid text) returns int
language plpgsql stable security definer set search_path = public as $$
declare
  g gradilista%rowtype; sc int := 100; d date := danas_bg(); diff int; kasne int;
  n_tr int; n_sit int; pot numeric; napl numeric; ocek numeric; napl_pct numeric;
begin
  if not moje_gradiliste(gid) then return null; end if;
  select * into g from gradilista where id = gid;
  if not found then return null; end if;

  select count(*), coalesce(sum(iznos),0) into n_tr, pot from troskovi_st where gr = gid;
  if n_tr = 0 then pot := coalesce(g.potroseno, 0); end if;
  select count(*), coalesce(sum(iznos) filter (where status = 'placeno'),0) into n_sit, napl from situacije where gr = gid;
  if n_sit = 0 then napl := coalesce(g.naplaceno, 0); end if;

  if g.status = 'zavrseno' then return 100; end if;   -- zavrsen projekat = 100 (bez marze)

  diff := g.rok - d;
  if g.status = 'kasni' or diff < 0 then sc := sc - 35;
  elsif diff <= 30 and coalesce(g.napredak,0) < 90 then sc := sc - 15; end if;

  select count(*) into kasne from zadaci where gr = gid and kol <> 'done' and rok < d;
  sc := sc - least(15, kasne * 5);

  ocek := coalesce(g.troskovi,0) * coalesce(g.napredak,0) / 100.0;
  if coalesce(g.napredak,0) > 0 and pot > ocek * 1.1 then sc := sc - 20; end if;
  napl_pct := case when coalesce(g.budzet,0) <> 0 then floor(napl / g.budzet * 100 + 0.5) else 0 end;
  if coalesce(g.napredak,0) - napl_pct > 25 then sc := sc - 15; end if;

  return greatest(5, sc);
end $$;
revoke execute on function zdravlje_gradilista(text) from public, anon;
grant  execute on function zdravlje_gradilista(text) to authenticated;
