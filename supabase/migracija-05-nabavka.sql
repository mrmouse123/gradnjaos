-- Migracija 05: nabavka materijala (tabela narudzbe)
-- Pokreni ako baza postoji od ranije. Bezbedno za ponovno pokretanje.
create table if not exists narudzbe (
  id text primary key, gr text, autor text, datum date, rok date,
  status text, napomena text, stavke jsonb default '[]'
);
alter table narudzbe enable row level security;
drop policy if exists pilot_full on narudzbe;
create policy pilot_full on narudzbe for all to anon using (true) with check (true);
