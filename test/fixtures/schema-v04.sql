-- ============================================================
-- GradnjaOS — šema baze za Supabase (pilot)
-- Pokreni ceo fajl u: Supabase konzola -> SQL Editor -> New query
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
  grs    text[] default '{}',  -- id-jevi gradilišta (jedan zaposleni može biti na više projekata)
  bivsi  text[] default '{}',  -- istorija: projekti sa kojih je skinut/a (prošli angažmani)
  status text,                 -- 'Na terenu' | 'Kancelarija' | 'Odsutan'
  tel    text,
  opis   text                  -- opis posla
);

create table if not exists gradilista (
  id          text primary key,
  naziv       text not null,
  modul       text default 'izvodjenje',     -- 'projektovanje' | 'izvodjenje'
  tip         text default 'visokogradnja',  -- za izvodjenje: 'visokogradnja' | 'niskogradnja'
  lok         text,
  klijent     text,     -- id klijenta
  rukovodilac text,     -- id zaposlenog
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
  troskovi    numeric default 0,   -- planirani troškovi (marža = budzet - troskovi)
  potroseno   numeric default 0,
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
  fakt text
);

create table if not exists podizvodjaci (
  id        text primary key,
  naziv     text not null,
  delatnost text,
  osoba     text,
  tel       text,
  grs       text[] default '{}',  -- gradilišta na kojima je angažovan
  cena      numeric default 0,    -- ugovorena vrednost
  status    text                  -- 'aktivan' | 'zavrsen'
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
-- RLS za PILOT: anon ključ ima pun pristup.
-- ⚠ Ovo je svesni kompromis za interni pilot: svako ko ima link
--   i anon ključ može da čita i piše. Pre šire upotrebe uvesti
--   Supabase Auth i restriktivne polise po ulozi (v. README).
-- ============================================================
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

drop policy if exists pilot_full on clijenti;
drop policy if exists pilot_full on zaposleni;
drop policy if exists pilot_full on gradilista;
drop policy if exists pilot_full on zadaci;
drop policy if exists pilot_full on dnevnik;
drop policy if exists pilot_full on situacije;
drop policy if exists pilot_full on narudzbe;
drop policy if exists pilot_full on troskovi_st;
drop policy if exists pilot_full on podizvodjaci;
drop policy if exists pilot_full on mag_promene;
drop policy if exists pilot_full on magacin;
drop policy if exists pilot_full on resursi;
drop policy if exists pilot_full on predmer;

create policy pilot_full on clijenti   for all to anon using (true) with check (true);
create policy pilot_full on zaposleni  for all to anon using (true) with check (true);
create policy pilot_full on gradilista for all to anon using (true) with check (true);
create policy pilot_full on zadaci     for all to anon using (true) with check (true);
create policy pilot_full on dnevnik    for all to anon using (true) with check (true);
create policy pilot_full on situacije  for all to anon using (true) with check (true);
create policy pilot_full on narudzbe   for all to anon using (true) with check (true);
create policy pilot_full on troskovi_st for all to anon using (true) with check (true);
create policy pilot_full on podizvodjaci for all to anon using (true) with check (true);
create policy pilot_full on mag_promene for all to anon using (true) with check (true);
create policy pilot_full on magacin for all to anon using (true) with check (true);
create policy pilot_full on resursi for all to anon using (true) with check (true);
create policy pilot_full on predmer for all to anon using (true) with check (true);
