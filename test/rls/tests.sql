-- RLS / grantovi / view-ovi / trigeri po ulogama, nad pravim Postgresom (uloge anon/authenticated + auth.uid() iz JWT claim-ova).
-- Ocekivanja izvedena iz pravila u CLAUDE.md (uloge, finansije, moduli), ne iz toga sta kod trenutno radi.
-- Svaka provera je nezavisna: izmene se vracaju (potpodtransakcija), pa redosled ne utice na rezultat.
create table t_rezultat (ime text, greska text);
create table t_pozivi (ime text);

-- izvrsi p_sql kao korisnik p_who ('su' = bez uloge/claim-ova, 'anon' = anon, ostali = authenticated sa sub iz t_ko); vrati prvu kolonu kao tekst
create function t_run(p_who text, p_sql text, p_vraca boolean default true) returns text language plpgsql as $$
declare v_uid uuid; got text;
begin
  select uid into v_uid from t_ko where ko = p_who;
  perform set_config('request.jwt.claims', case when v_uid is null then '' else json_build_object('sub', v_uid, 'role', 'authenticated')::text end, true);
  if p_who <> 'su' then execute 'set local role ' || case when p_who = 'anon' then 'anon' else 'authenticated' end; end if;
  begin
    if p_vraca then execute p_sql into got; else execute p_sql; got := 'izvrseno'; end if;
  exception when others then got := 'ERROR: ' || sqlerrm;
  end;
  reset role;
  return coalesce(got, '<null>');
end $$;

-- p_expect: tacna vrednost, 'ERROR' (bilo koja greska, npr. permission denied / RLS), 'OK' (bilo sta sem greske), 'NONE' (greska ILI 0 redova), '<null>'
create function t_chk(p_ime text, p_who text, p_sql text, p_expect text, p_pre_who text default null, p_pre text default null)
returns void language plpgsql as $$
declare got text;
begin
  begin
    if p_pre is not null then perform t_run(p_pre_who, p_pre, false); end if;
    got := t_run(p_who, p_sql);
    raise exception using errcode = 'P0099';   -- vrati sve izmene: svaka provera je nezavisna
  exception when sqlstate 'P0099' then null;
  end;
  insert into t_pozivi values (p_ime);
  if not (case p_expect when 'ERROR' then got like 'ERROR%' when 'OK' then got not like 'ERROR%' when 'NONE' then (got like 'ERROR%' or got = '0') else got = p_expect end) then
    insert into t_rezultat values (p_ime, format('%s: dobijeno [%s], ocekivano [%s]', p_who, got, p_expect));
  end if;
end $$;

-- ===== 1) koja gradilista ko vidi (gradilista_v; modul + tim + rukovodilac) =====
select t_chk('vidljivost gradilista', k, $$select string_agg(id, ',' order by id) from gradilista_v$$, e) from (values
  ('dir',  'g1,g10,g2,g9'), ('adm', 'g1,g10,g2,g9'),
  ('dpro', 'g10,g9'),      ('dizv', 'g1,g2'),
  ('ruki', 'g1'),          ('rukp', 'g9'),
  ('rad',  'g9'),          ('spolj', 'g9'),
  ('none', '<null>'),      ('anon', 'ERROR')) as t(k, e);

-- ===== 2) finansijske kolone: view daje samo ko sme, tabela direktno nikome =====
select t_chk('budzet kroz gradilista_v', k, $$select budzet::text from gradilista_v where id = '$$ || g || $$'$$, e) from (values
  ('dir', 'g1', '1000'), ('adm', 'g1', '1000'), ('dizv', 'g1', '1000'), ('dpro', 'g9', '500'),
  ('rukp', 'g9', '500'),                                  -- rukovodilac SA finansijama
  ('ruki', 'g1', '<null>'), ('rad', 'g9', '<null>'), ('spolj', 'g9', '<null>')) as t(k, g, e);
select t_chk('budzet direktno iz tabele (nema SELECT granta)', k, $$select budzet::text from gradilista limit 1$$, 'ERROR') from unnest(array['dir','adm','dizv','ruki','rukp','anon']) k;
select t_chk('cena predmera: ' || k || ' ' || p, k, $$select cena::text from predmer_v where id = '$$ || p || $$'$$, e) from (values
  ('dir', 'pm2', '40'), ('dizv', 'pm1', '20'), ('dpro', 'pm9', '30'),
  ('ruki', 'pm1', '20'),                                  -- izuzetak (migracija 23): rukovodilac Izvodjenja vidi jedinicne cene svog gradilista
  ('ruki', 'pm2', '<null>'),                              -- tudje gradiliste: red se ne vidi
  ('rukp', 'pm9', '30'), ('rad', 'pm9', '<null>'), ('spolj', 'pm9', '<null>'),
  ('dizv', 'pm9', '<null>'), ('dpro', 'pm1', '<null>')) as t(k, p, e);   -- direktor modula ne vidi tudji modul
select t_chk('iznos situacije: ' || k || ' ' || s, k, $$select iznos::text from situacije_v where id = '$$ || s || $$'$$, e) from (values
  ('dir', 's1', '100'), ('dizv', 's1', '100'), ('dpro', 's9', '300'), ('rukp', 's9', '300'),
  ('ruki', 's1', '<null>'),                               -- vidi situaciju, ne i iznos
  ('rad', 's9', '<null>'), ('dpro', 's1', '<null>')) as t(k, s, e);
select t_chk('cena saradnika: ' || k, k, $$select coalesce((select cena::text from podizvodjaci_v where id = 'p1'), '<null>')$$, e) from (values
  ('dir', '50'), ('rad', '<null>'), ('ruki', '<null>')) as t(k, e);

-- ===== 3) pisanje i brisanje gradilista =====
select t_chk('upis napretka: ' || k || ' ' || g, k, $$with u as (update gradilista set napredak = 50 where id = '$$ || g || $$' returning 1) select count(*)::text from u$$, e) from (values
  ('dir', 'g1', '1'), ('adm', 'g1', '1'), ('dizv', 'g1', '1'), ('ruki', 'g1', '1'),
  ('ruki', 'g2', '0'), ('dizv', 'g9', '0'), ('rukp', 'g1', '0'), ('rad', 'g9', '0'), ('spolj', 'g9', '0')) as t(k, g, e);
select t_chk('brisanje gradilista: ' || k || ' ' || g, k, $$with d as (delete from gradilista where id = '$$ || g || $$' returning 1) select count(*)::text from d$$, e) from (values
  ('dir', 'g1', '1'), ('dizv', 'g1', '1'), ('dpro', 'g10', '1'),
  ('adm', 'g1', '0'),                                     -- admin ne brise
  ('dpro', 'g1', '0'), ('dizv', 'g9', '0'),               -- direktor modula samo u svom modulu
  ('ruki', 'g1', '0'), ('rukp', 'g9', '0'), ('rad', 'g9', '0')) as t(k, g, e);
select t_chk('novo gradiliste: ' || k || ' ' || m, k, $$with i as (insert into gradilista (id, naziv, modul) values ('gx', 'x', '$$ || m || $$') returning 1) select count(*)::text from i$$, e) from (values
  ('dir', 'izvodjenje', '1'), ('adm', 'projektovanje', '1'),
  ('dpro', 'projektovanje', '1'), ('dpro', 'izvodjenje', 'ERROR'), ('dizv', 'izvodjenje', '1'), ('dizv', 'projektovanje', 'ERROR'),
  ('ruki', 'izvodjenje', 'ERROR'), ('rukp', 'projektovanje', 'ERROR'), ('rad', 'projektovanje', 'ERROR')) as t(k, m, e);

-- rukovodilac ne moze da prepise budzet/cene/rukovodioca: trigeri vracaju staro, sta god da posalje
select t_chk('rukovodilac ne menja budzet', 'dir', $$select budzet::text from gradilista_v where id = 'g1'$$, '1000',
             'ruki', $$update gradilista set budzet = 9999, napredak = 60 where id = 'g1'$$);
select t_chk('rukovodilac ne preuzima gradiliste', 'dir', $$select rukovodilac from gradilista_v where id = 'g2'$$, 'z2',
             'ruki', $$update gradilista set rukovodilac = 'z1' where id = 'g2'$$);
select t_chk('rukovodilac ne menja cenu predmera', 'dir', $$select cena::text from predmer_v where id = 'pm1'$$, '20',
             'ruki', $$update predmer set cena = 1 where id = 'pm1'$$);
select t_chk('rukovodilac ne menja iznos situacije', 'dir', $$select iznos::text from situacije_v where id = 's1'$$, '100',
             'ruki', $$update situacije set iznos = 1 where id = 's1'$$);
select t_chk('rukovodilac upisuje izvedeno', 'ruki', $$with u as (update predmer set izv = 5 where id = 'pm1' returning 1) select count(*)::text from u$$, '1');
select t_chk('rukovodilac ne dira tudji predmer', 'ruki', $$with u as (update predmer set izv = 5 where id = 'pm2' returning 1) select count(*)::text from u$$, '0');

-- ===== 4) nalozi i uloge (Admin kokpit) =====
select t_chk('nalozi_pregled: ' || k, k, $$select count(*)::text from nalozi_pregled()$$, e) from (values
  ('dir', 'OK'), ('adm', 'OK'), ('dpro', 'ERROR'), ('dizv', 'ERROR'), ('ruki', 'ERROR'), ('rukp', 'ERROR'), ('rad', 'ERROR'), ('spolj', 'ERROR'), ('anon', 'ERROR')) as t(k, e);
select t_chk('angazovanost: ' || k, k, $$select count(*)::text from angazovanost()$$, e) from (values
  ('dir', 'OK'), ('adm', 'OK'), ('dpro', 'ERROR'), ('ruki', 'ERROR'), ('anon', 'ERROR')) as t(k, e);
select t_chk('dodeli_ulogu: ' || k || ' → ' || u, k, $$select dodeli_ulogu('none@t', '$$ || u || $$', $$ || z || $$)::text$$, e) from (values
  ('dir', 'rukovodilac', '''z2''', 'OK'), ('adm', 'rukovodilac', '''z2''', 'OK'),
  ('adm', 'direktor', 'null', 'ERROR'),                   -- direktorske uloge dodeljuje samo direktor
  ('adm', 'direktor_izvodjenja', 'null', 'ERROR'),
  ('dir', 'direktor_izvodjenja', 'null', 'OK'),
  ('dpro', 'rukovodilac', '''z2''', 'ERROR'), ('ruki', 'rukovodilac', '''z2''', 'ERROR'), ('anon', 'rukovodilac', '''z2''', 'ERROR')) as t(k, u, z, e);
select t_chk('dodeli_ulogu sebi', 'dir', $$select dodeli_ulogu('dir@t', 'admin', null)::text$$, 'ERROR');
select t_chk('ukloni_pristup: ' || k, k, $$select ukloni_pristup('ruki@t')::text$$, e) from (values
  ('dir', 'OK'), ('adm', 'OK'), ('dpro', 'ERROR'), ('ruki', 'ERROR'), ('anon', 'ERROR')) as t(k, e);
select t_chk('admin ne uklanja direktora', 'adm', $$select ukloni_pristup('dir@t')::text$$, 'ERROR');
select t_chk('obrisi_gradiliste: ' || k || ' ' || g, k, $$select obrisi_gradiliste('$$ || g || $$')::text$$, e) from (values
  ('dir', 'g9', 'OK'), ('dizv', 'g1', 'OK'), ('dpro', 'g9', 'OK'),
  ('dizv', 'g9', 'ERROR'), ('dpro', 'g1', 'ERROR'), ('adm', 'g1', 'ERROR'), ('ruki', 'g1', 'ERROR'), ('anon', 'g1', 'ERROR')) as t(k, g, e);

-- ===== 5) profili: svako samo svoj, puna uprava sve =====
select t_chk('profili select: ' || k, k, $$select count(*)::text from profili$$, e) from (values
  ('dir', '8'), ('adm', '8'), ('dpro', '1'), ('dizv', '1'), ('ruki', '1'), ('rukp', '1'), ('rad', '1'), ('none', '0')) as t(k, e);
select t_chk('rukovodilac se ne unapredjuje sam', 'su', $$select uloga from profili where user_id = '00000000-0000-0000-0000-000000000005'$$, 'rukovodilac',
             'ruki', $$update profili set uloga = 'direktor' where user_id = '00000000-0000-0000-0000-000000000005'$$);
select t_chk('rukovodilac ne dobija finansije sam', 'su', $$select vidi_finansije::text from profili where user_id = '00000000-0000-0000-0000-000000000005'$$, 'false',
             'ruki', $$update profili set vidi_finansije = true where user_id = '00000000-0000-0000-0000-000000000005'$$);
select t_chk('nalog se ne pravi sam sebi', 'none', $$with i as (insert into profili (user_id, uloga) values ('00000000-0000-0000-0000-000000000009', 'direktor') returning 1) select count(*)::text from i$$, 'ERROR');

-- ===== 6) log korišćenja: upis svog reda, citanje samo puna uprava =====
select t_chk('log: upis svog reda', 'ruki', $$with i as (insert into log_koriscenja (user_id, dogadjaj) values (auth.uid(), 'otvaranje') returning 1) select count(*)::text from i$$, '1');
select t_chk('log: upis tudjeg reda', 'ruki', $$with i as (insert into log_koriscenja (user_id, dogadjaj) values ('00000000-0000-0000-0000-000000000001', 'otvaranje') returning 1) select count(*)::text from i$$, 'ERROR');
select t_chk('log: rukovodilac ne cita', 'ruki', $$select count(*)::text from log_koriscenja$$, '0',
             'ruki', $$insert into log_koriscenja (user_id, dogadjaj) values (auth.uid(), 'otvaranje')$$);
select t_chk('log: direktor cita', 'dir', $$select count(*)::text from log_koriscenja$$, '1',
             'ruki', $$insert into log_koriscenja (user_id, dogadjaj) values (auth.uid(), 'otvaranje')$$);
select t_chk('log: direktor modula ne cita', 'dpro', $$select count(*)::text from log_koriscenja$$, '0',
             'ruki', $$insert into log_koriscenja (user_id, dogadjaj) values (auth.uid(), 'otvaranje')$$);

-- ===== 7) ostalo: dnevnik po gradilistu, zaposleni samo uz profil, zdravlje, anon nema nista =====
select t_chk('dnevnik: ' || k, k, $$select count(*)::text from dnevnik$$, e) from (values
  ('dir', '2'), ('dizv', '2'), ('dpro', '0'), ('ruki', '1'), ('rukp', '0'), ('rad', '0'), ('none', '0')) as t(k, e);
select t_chk('zaposleni: ' || k, k, $$select count(*)::text from zaposleni$$, e) from (values
  ('dir', '5'), ('ruki', '5'), ('rad', '5'), ('none', '0')) as t(k, e);
select t_chk('zdravlja_mojih: ' || k, k, $$select count(*)::text from zdravlja_mojih()$$, e) from (values
  ('ruki', 'OK'), ('dir', 'OK'), ('anon', 'ERROR')) as t(k, e);
select t_chk('anon ne cita ' || t, 'anon', 'select count(*)::text from ' || t, 'NONE') from unnest(array['gradilista_v','predmer_v','situacije_v','podizvodjaci_v','dokumenti_v','zaposleni','dnevnik','profili','log_koriscenja','situacija_stavke','zadaci']) t;
select t_chk('nalog bez profila ne vidi ' || t, 'none', 'select count(*)::text from ' || t, '0') from unnest(array['gradilista_v','predmer_v','situacije_v','dnevnik','zaposleni','profili','situacija_stavke','zadaci']) t;

do $$ declare n int; r text; b int;
begin
  select count(*) into b from t_pozivi;
  select count(*), string_agg(ime || ' — ' || greska, E'\n' order by ime) into n, r from t_rezultat;
  if n > 0 then raise exception E'RLS: % od % provera nije prosla:\n%', n, b, r using errcode = 'P0003'; end if;
  raise notice 'RLS: % provera OK', b;
end $$;
