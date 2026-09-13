-- ============================================================
-- Migracija 01: zaposleni na više projekata (gr -> grs text[])
-- Pokreni SAMO ako si već ranije pokrenuo stari schema.sql
-- (nova instalacija ne treba ovo — novi schema.sql već ima grs).
-- Bezbedno za ponovno pokretanje.
-- ============================================================
alter table zaposleni add column if not exists grs text[] default '{}';

update zaposleni
   set grs = array[gr]
 where gr is not null
   and (grs is null or grs = '{}');

alter table zaposleni drop column if exists gr;
