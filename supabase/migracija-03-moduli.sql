-- Migracija 03: moduli (visokogradnja / niskogradnja)
-- Pokreni ako baza postoji od ranije. Bezbedno za ponovno pokretanje.
alter table gradilista add column if not exists tip text default 'visokogradnja';
-- Po potrebi rucno oznaci niskogradnju, npr:
-- update gradilista set tip='niskogradnja' where id in ('g3','g4');
