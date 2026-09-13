-- Migracija 04: dvonivovski moduli (Projektovanje / Izvodjenje radova)
-- Pokreni ako baza postoji od ranije. Bezbedno za ponovno pokretanje.
alter table gradilista add column if not exists modul text default 'izvodjenje';
-- Postojeci projekti ostaju 'izvodjenje'; projektantske oznaci rucno, npr:
-- update gradilista set modul='projektovanje', tip=null where id in ('g8','g9');
