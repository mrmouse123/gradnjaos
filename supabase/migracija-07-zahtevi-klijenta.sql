-- Migracija 07: predmer, resursi, magacin, polja gradilista i faktura
create table if not exists predmer (
  id text primary key, gr text, poz text, jm text,
  kol numeric default 0, cena numeric default 0, izv numeric default 0, zaduzen text
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
alter table gradilista add column if not exists povrsina numeric;
alter table gradilista add column if not exists nadzor text;
alter table gradilista add column if not exists adm jsonb default '{}';
alter table troskovi_st add column if not exists dobavljac text;
alter table troskovi_st add column if not exists fakt text;
alter table predmer enable row level security;
alter table resursi enable row level security;
alter table magacin enable row level security;
alter table mag_promene enable row level security;
drop policy if exists pilot_full on predmer;
drop policy if exists pilot_full on resursi;
drop policy if exists pilot_full on magacin;
drop policy if exists pilot_full on mag_promene;
create policy pilot_full on predmer for all to anon using (true) with check (true);
create policy pilot_full on resursi for all to anon using (true) with check (true);
create policy pilot_full on magacin for all to anon using (true) with check (true);
create policy pilot_full on mag_promene for all to anon using (true) with check (true);
