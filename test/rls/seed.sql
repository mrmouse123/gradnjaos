-- Test podaci: po jedan nalog za svaku ulogu + gradilista oba modula. Trigeri su iskljuceni (session_replication_role)
-- da seed upise tacno ove vrednosti; testovi posle rade sa ukljucenim trigerima kao pravi korisnici.
set session_replication_role = replica;

create table t_ko (ko text primary key, uid uuid not null, email text not null);
insert into t_ko values
  ('dir',   '00000000-0000-0000-0000-000000000001', 'dir@t'),
  ('adm',   '00000000-0000-0000-0000-000000000002', 'adm@t'),
  ('dpro',  '00000000-0000-0000-0000-000000000003', 'dpro@t'),
  ('dizv',  '00000000-0000-0000-0000-000000000004', 'dizv@t'),
  ('ruki',  '00000000-0000-0000-0000-000000000005', 'ruki@t'),   -- rukovodilac Izvodjenja, BEZ finansija, vodi g1
  ('rukp',  '00000000-0000-0000-0000-000000000006', 'rukp@t'),   -- rukovodilac Projektovanja SA finansijama, vodi g9
  ('rad',   '00000000-0000-0000-0000-000000000007', 'rad@t'),    -- radnik Projektovanja, u timu g9
  ('spolj', '00000000-0000-0000-0000-000000000008', 'spolj@t'),  -- spoljni saradnik p1 na g9
  ('none',  '00000000-0000-0000-0000-000000000009', 'none@t');   -- nalog bez profila
insert into auth.users (id, email) select uid, email from t_ko;

insert into zaposleni (id, ime) values ('z1','Petar'), ('z2','Drugi'), ('z3','Treci'), ('z10','Sara'), ('z17','Nikola');
insert into gradilista (id, naziv, modul, rukovodilac, budzet, napredak) values
  ('g1',  'G1 izvodjenje',   'izvodjenje',    'z1',  1000, 10),
  ('g2',  'G2 izvodjenje',   'izvodjenje',    'z2',  2000, 10),
  ('g9',  'G9 projektovanje','projektovanje', 'z17', 500,  10),
  ('g10', 'G10 projektovanje','projektovanje','z3',  700,  10);

insert into profili (user_id, zaposleni_id, uloga, vidi_finansije, saradnik_id, moduli) values
  ('00000000-0000-0000-0000-000000000001', null,  'direktor',               false, null, '{projektovanje,izvodjenje}'),
  ('00000000-0000-0000-0000-000000000002', null,  'admin',                  false, null, '{projektovanje,izvodjenje}'),
  ('00000000-0000-0000-0000-000000000003', null,  'direktor_projektovanja', false, null, '{projektovanje}'),
  ('00000000-0000-0000-0000-000000000004', null,  'direktor_izvodjenja',    false, null, '{izvodjenje}'),
  ('00000000-0000-0000-0000-000000000005', 'z1',  'rukovodilac',            false, null, '{izvodjenje}'),
  ('00000000-0000-0000-0000-000000000006', 'z17', 'rukovodilac',            true,  null, '{projektovanje}'),
  ('00000000-0000-0000-0000-000000000007', 'z10', 'radnik',                 false, null, '{projektovanje}'),
  ('00000000-0000-0000-0000-000000000008', null,  'spoljni',                false, 'p1', '{projektovanje,izvodjenje}');

insert into zaposleni_gradiliste (zaposleni_id, gradiliste_id, aktivan) values ('z10', 'g9', true);
insert into podizvodjaci (id, naziv, cena) values ('p1', 'Saradnik 1', 50);
insert into podizvodjac_gradiliste (podizvodjac_id, gradiliste_id) values ('p1', 'g9');

insert into predmer (id, gr, poz, kol, cena, izv) values
  ('pm1', 'g1', 'Pozicija g1', 10, 20, 1),
  ('pm2', 'g2', 'Pozicija g2', 3,  40, 0),
  ('pm9', 'g9', 'Pozicija g9', 5,  30, 0);
-- autor = vlasnik situacije: rukovodilac sme da je menja (polisa), pa iznos stiti SAMO trigger — to test proverava
insert into situacije (id, gr, br, iznos, izdato, status, autor) values
  ('s1', 'g1', 'S-1', 100, '2026-01-01', 'ceka', 'z1'),
  ('s9', 'g9', 'S-9', 300, '2026-01-01', 'ceka', 'z17');
insert into dnevnik (id, datum, gr, autor, tekst) values
  ('d1', '2026-01-01', 'g1', 'z1', 'g1 unos'),
  ('d2', '2026-01-01', 'g2', 'z2', 'g2 unos');

set session_replication_role = default;
