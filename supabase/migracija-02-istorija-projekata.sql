-- Migracija 02: istorija projekata po zaposlenom (kolona bivsi)
-- Pokreni ako ti baza postoji od ranije. Bezbedno za ponovno pokretanje.
alter table zaposleni add column if not exists bivsi text[] default '{}';
