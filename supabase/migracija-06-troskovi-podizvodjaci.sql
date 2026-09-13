-- Migracija 06: troskovi po stavkama + podizvodjaci
create table if not exists troskovi_st (
  id text primary key, gr text, datum date, opis text, kat text, iznos numeric default 0
);
create table if not exists podizvodjaci (
  id text primary key, naziv text not null, delatnost text, osoba text, tel text,
  grs text[] default '{}', cena numeric default 0, status text
);
alter table troskovi_st enable row level security;
alter table podizvodjaci enable row level security;
drop policy if exists pilot_full on troskovi_st;
drop policy if exists pilot_full on podizvodjaci;
create policy pilot_full on troskovi_st for all to anon using (true) with check (true);
create policy pilot_full on podizvodjaci for all to anon using (true) with check (true);
