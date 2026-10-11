-- ============================================================
-- Migracija 19 (2026-10-11): sifarnik artikala + situacije sa stavkama (zahtev klijenta)
--   1) sifrarnik.sifra + 81 artikal "ELOM projekt" (PDF Sifarnik artikala + 3 dopune: 46, 47, M029);
--      predmer.sifra (snimak sifre pri izboru iz sifarnika) → predmer_v + column grant.
--   2) situacije: vrsta (privremena|okoncana), autor, napomena; iznos postaje FIN kolona
--      (column grant + situacije_v sa CASE vidi_finansije) → rukovodilac BEZ finansija pravi
--      situaciju i vidi je bez iznosa. Polise: select/insert vodim_gradiliste (+ fin & moje);
--      update uprava ili autor svoje dok nije placena; delete super. Trigger zastiti_kolone_situacije:
--      ne-uprava ne dira iznos/status/gr/autor.
--   3) situacija_stavke(sit, gr, predmer_id, sifra, poz, jm, kol, kol_ugovoreno, kumulativ, razlika)
--      BEZ cena. preracunaj_situacije(gid) (security definer — ima cene): kol_ugovoreno iz predmera,
--      kumulativ po artiklu kroz situacije (izdato, id), razlika = max(0, kumulativ - ugovoreno),
--      situacije.iznos = Σ kol × predmer.cena (samo situacije koje imaju stavke). Trigeri na stavkama
--      i na situacije(izdato); pg_trigger_depth() cuva od rekurzije. Idempotentna.
-- ============================================================

-- ---------- 1) sifra ----------
alter table sifrarnik add column if not exists sifra text;
alter table predmer add column if not exists sifra text;
grant select (sifra) on predmer to authenticated;
drop view if exists predmer_v;
create view predmer_v with (security_barrier = true) as
  select id, gr, poz, jm, kol, izv, zaduzen, sifra, case when vidi_finansije() then cena end as cena
  from predmer where moje_gradiliste(gr);
revoke all on predmer_v from public, anon; grant select on predmer_v to authenticated;

insert into sifrarnik (id, naziv, jm, grupa, modul, redosled, aktivan, sifra) values
  ('sf-a-001', 'PEGASUS HO 6W 24v IP65Warm White Medium Titan', 'kom', 'Artikli (ELOM)', 'izvodjenje', 201, true, '01-1'),
  ('sf-a-002', 'PEGASUS Antiglare Accessory Titan', 'kom', 'Artikli (ELOM)', 'izvodjenje', 202, true, '01-2'),
  ('sf-a-003', 'Picket for PEGASUS', 'kom', 'Artikli (ELOM)', 'izvodjenje', 203, true, '01-3'),
  ('sf-a-004', 'Connector 4-pole IP68', 'kom', 'Artikli (ELOM)', 'izvodjenje', 204, true, '01-4'),
  ('sf-a-005', 'DRIVER LED 24V DC/60W IP 67 162,5x42,5x32', 'kom', 'Artikli (ELOM)', 'izvodjenje', 205, true, '01-5'),
  ('sf-a-006', 'Svetiljka I-TRON ZERO 5p5 STU-M 7040.100-1M,19.1W,4000k,2890lm AEC ILLUMINAZIONE', 'kom', 'Artikli (ELOM)', 'izvodjenje', 206, true, '1'),
  ('sf-a-007', 'Dekorativni aluminijumski stup zip POLE RX2 ALLUMINIUM 5.0 5000MM sa dve lire', 'kom', 'Artikli (ELOM)', 'izvodjenje', 207, true, '10'),
  ('sf-a-008', 'Priključna ploča za jedan osigurač TERMINAL BOARD FOR RX ALLUMINIUM POLE,1 FUSE', 'kom', 'Artikli (ELOM)', 'izvodjenje', 208, true, '11'),
  ('sf-a-009', 'Priključna ploča za dva osigurača TERMINAL BOARD FOR RX ALLUMINIUM POLE,2 FUSE', 'kom', 'Artikli (ELOM)', 'izvodjenje', 209, true, '12'),
  ('sf-a-010', 'Set za ankerisanje M18', 'kom', 'Artikli (ELOM)', 'izvodjenje', 210, true, '13'),
  ('sf-a-011', 'S-PREVIDIA-C200LG', 'kom', 'Artikli (ELOM)', 'izvodjenje', 211, true, '14'),
  ('sf-a-012', 'S-PREVIDIA-CDIAL', 'kom', 'Artikli (ELOM)', 'izvodjenje', 212, true, '15'),
  ('sf-a-013', 'ULTRA 12150', 'kom', 'Artikli (ELOM)', 'izvodjenje', 213, true, '16'),
  ('sf-a-014', 'S-WD100', 'kom', 'Artikli (ELOM)', 'izvodjenje', 214, true, '17'),
  ('sf-a-015', 'S-WC0010', 'kom', 'Artikli (ELOM)', 'izvodjenje', 215, true, '18'),
  ('sf-a-016', 'S-EWT100', 'kom', 'Artikli (ELOM)', 'izvodjenje', 216, true, '19'),
  ('sf-a-017', 'Svetiljka I-TRON ZERO 5P5 STU-M 7040.140-2M,52.3W,4000K,7930lm AEC ILLUMINAZIONE', 'kom', 'Artikli (ELOM)', 'izvodjenje', 217, true, '2'),
  ('sf-a-018', 'S-XWT100', 'kom', 'Artikli (ELOM)', 'izvodjenje', 218, true, '20'),
  ('sf-a-019', 'S-SPS24060S', 'kom', 'Artikli (ELOM)', 'izvodjenje', 219, true, '21'),
  ('sf-a-020', 'ULTRA 1270', 'kom', 'Artikli (ELOM)', 'izvodjenje', 220, true, '22'),
  ('sf-a-021', 'S-WS2010RE', 'kom', 'Artikli (ELOM)', 'izvodjenje', 221, true, '23'),
  ('sf-a-022', 'S-WM110', 'kom', 'Artikli (ELOM)', 'izvodjenje', 222, true, '24'),
  ('sf-a-023', 'S-WM202SR', 'kom', 'Artikli (ELOM)', 'izvodjenje', 223, true, '25'),
  ('sf-a-024', 'Vrata za stubove serije RX-2', 'kom', 'Artikli (ELOM)', 'izvodjenje', 224, true, '26'),
  ('sf-a-025', 'Obojena kapa za stub', 'kom', 'Artikli (ELOM)', 'izvodjenje', 225, true, '27'),
  ('sf-a-026', 'Set za montazu', 'kom', 'Artikli (ELOM)', 'izvodjenje', 226, true, '28'),
  ('sf-a-027', 'S-L-MC-SG', 'kom', 'Artikli (ELOM)', 'izvodjenje', 227, true, '29'),
  ('sf-a-028', 'Svetiljka ALO 1 2AB10 ASW 7040.350-22M ES OT30 240W,400K AEC ILLUMINAZIONE', 'kom', 'Artikli (ELOM)', 'izvodjenje', 228, true, '3'),
  ('sf-a-029', 'S-L-OP-SG', 'kom', 'Artikli (ELOM)', 'izvodjenje', 229, true, '30'),
  ('sf-a-030', 'S-SGCP200', 'kom', 'Artikli (ELOM)', 'izvodjenje', 230, true, '31'),
  ('sf-a-031', 'S-VW2W100', 'kom', 'Artikli (ELOM)', 'izvodjenje', 231, true, '32'),
  ('sf-a-032', 'S-SGWE100', 'kom', 'Artikli (ELOM)', 'izvodjenje', 232, true, '33'),
  ('sf-a-033', 'S-CWS100', 'kom', 'Artikli (ELOM)', 'izvodjenje', 233, true, '34'),
  ('sf-a-034', 'S-SGWS-MOD', 'kom', 'Artikli (ELOM)', 'izvodjenje', 234, true, '35'),
  ('sf-a-035', 'Čelični nož TB 30', 'kom', 'Artikli (ELOM)', 'izvodjenje', 235, true, '36'),
  ('sf-a-036', 'Čelični nož TB 31', 'kom', 'Artikli (ELOM)', 'izvodjenje', 236, true, '37'),
  ('sf-a-037', 'Adresabilna centrala za dojavu pozara PREVIDIA-C-100LG INIM', 'kom', 'Artikli (ELOM)', 'izvodjenje', 237, true, '38'),
  ('sf-a-038', 'Antres P 62 7,stubovi ,VALMONT', 'kom', 'Artikli (ELOM)', 'izvodjenje', 238, true, '39'),
  ('sf-a-039', 'Svetiljka I-TRON ZERO 5p5 STU-M 7040.140-4M Cl.2 AEC ILLUMINAZIONE', 'kom', 'Artikli (ELOM)', 'izvodjenje', 239, true, '4'),
  ('sf-a-040', 'Electric connecting box TB-2', 'kom', 'Artikli (ELOM)', 'izvodjenje', 240, true, '40'),
  ('sf-a-041', 'Gumeni orebljeni podmetac 300x300', 'kom', 'Artikli (ELOM)', 'izvodjenje', 241, true, '41'),
  ('sf-a-042', 'ITALO 1 5P5 STA 7040.100-3M CL.2 Grafite', 'kom', 'Artikli (ELOM)', 'izvodjenje', 242, true, '42'),
  ('sf-a-043', 'Svetiljka ECO RAYS TP 5P5 S05 7040.100-1M Cl.2 F grafite', 'kom', 'Artikli (ELOM)', 'izvodjenje', 243, true, '43'),
  ('sf-a-044', 'MX PRO 2 5P5 AS-45W 7040.120-7M Cl.2F Vin E1 120mA', 'kom', 'Artikli (ELOM)', 'izvodjenje', 244, true, '44'),
  ('sf-a-045', 'Svetiljka I-TRON ZERO 5P5STE-M 7040.140-2M CL.2 F Vin E1 140mA Grafite', 'kom', 'Artikli (ELOM)', 'izvodjenje', 245, true, '45'),
  ('sf-a-046', 'Svetiljka I-TRON ZERO 5P5 STU-M 7040.140-3M CL.2 AEC ILLUMINAZIONE', 'kom', 'Artikli (ELOM)', 'izvodjenje', 246, true, '5'),
  ('sf-a-047', 'Svetiljka ECO RAYS TP 5P5 STA 7040.100-2M AEC ILLUMINAZIONE', 'kom', 'Artikli (ELOM)', 'izvodjenje', 247, true, '6'),
  ('sf-a-048', 'Kapica cap for nema socket JL-208 IP66 AEC ILLUMINAZIONE', 'kom', 'Artikli (ELOM)', 'izvodjenje', 248, true, '7'),
  ('sf-a-049', 'Svetiljka tipa MOD 2.0 URBAN 200 RX2 (500) 0F2H1 S05 4,7-1m CR170 cl.2 FIX AEC ILLUMINAZIONE', 'kom', 'Artikli (ELOM)', 'izvodjenje', 249, true, '8'),
  ('sf-a-050', 'Dekorativni aluminijumski stub tip POLE RX2 ALLUMINIUM 5.0 5000MM sa jednom lirom', 'kom', 'Artikli (ELOM)', 'izvodjenje', 250, true, '9'),
  ('sf-a-051', 'Elektronski prihvatnik 6-14 V AC/DC za blokadu/deblokadu', 'kom', 'Artikli (ELOM)', 'izvodjenje', 251, true, 'M001'),
  ('sf-a-052', 'Razvodni orman sistema tehnicke zastite', 'kom', 'Artikli (ELOM)', 'izvodjenje', 252, true, 'M002'),
  ('sf-a-053', 'Modul kontrole pristupasa 20RFID kartica', 'kom', 'Artikli (ELOM)', 'izvodjenje', 253, true, 'M003'),
  ('sf-a-054', 'Citac RFID/NFC kartica i tagova', 'kom', 'Artikli (ELOM)', 'izvodjenje', 254, true, 'M004'),
  ('sf-a-055', 'Svetiljka DN142B 10S/840 PSU-E WR Philips', 'kom', 'Artikli (ELOM)', 'izvodjenje', 255, true, 'M005'),
  ('sf-a-056', 'AWEX panik svetiljka EXIT S1 WIP65', 'kom', 'Artikli (ELOM)', 'izvodjenje', 256, true, 'M006'),
  ('sf-a-057', 'ANSEC samostojeci rek ormar 33U', 'kom', 'Artikli (ELOM)', 'izvodjenje', 257, true, 'M007'),
  ('sf-a-058', 'ANSEC zidni rek ormar 15U', 'kom', 'Artikli (ELOM)', 'izvodjenje', 258, true, 'M008'),
  ('sf-a-059', 'Parapet 210x90', 'm', 'Artikli (ELOM)', 'izvodjenje', 259, true, 'M009'),
  ('sf-a-060', 'GA-OTRW poklopac za parapet', 'm', 'Artikli (ELOM)', 'izvodjenje', 260, true, 'M010'),
  ('sf-a-061', 'svetiljka WL060V LED 17S/840 PSU Philips', 'kom', 'Artikli (ELOM)', 'izvodjenje', 261, true, 'M011'),
  ('sf-a-062', 'Svetiljka WL070V GEN2 11_17S/830_860 PSU PHILIPS', 'kom', 'Artikli (ELOM)', 'izvodjenje', 262, true, 'M012'),
  ('sf-a-063', 'Svetiljka WT065C G3 LED 68S/840 PSU', 'kom', 'Artikli (ELOM)', 'izvodjenje', 263, true, 'M013'),
  ('sf-a-064', 'AWEX panik svetiljka EXIT S IP65 LED 1W', 'kom', 'Artikli (ELOM)', 'izvodjenje', 264, true, 'M014'),
  ('sf-a-065', 'Svetiljka RC065B G5 LED 41S/840 PSU W60L60 PHILIPS', 'kom', 'Artikli (ELOM)', 'izvodjenje', 265, true, 'M015'),
  ('sf-a-066', 'Nadrgradni ram 600x600x70mm', 'kom', 'Artikli (ELOM)', 'izvodjenje', 266, true, 'M016'),
  ('sf-a-067', 'Svetiljka LL24x 80S/840 NE PSU a BV WH PHILIPS', 'kom', 'Artikli (ELOM)', 'izvodjenje', 267, true, 'M017'),
  ('sf-a-068', 'SAM NADGRADNA PANIK SVETILJKA 20M 4,8W3H', 'kom', 'Artikli (ELOM)', 'izvodjenje', 268, true, 'M018'),
  ('sf-a-069', 'Gromobran sa ranim startovanjem D368425-60M', 'kom', 'Artikli (ELOM)', 'izvodjenje', 269, true, 'M019'),
  ('sf-a-070', 'Svetiljka DN145B LED 20S/830 840 PSUWh+RAM PHILIPS', 'kom', 'Artikli (ELOM)', 'izvodjenje', 270, true, 'M020'),
  ('sf-a-071', 'Svetiljka RC065B G5 41S/840 PSU W60L60 NOC PHILIPS', 'kom', 'Artikli (ELOM)', 'izvodjenje', 271, true, 'M021'),
  ('sf-a-072', 'Svetiljka Sm060C G2 34_ 40S/840 PSU W20L120 NOC PHILIPS', 'kom', 'Artikli (ELOM)', 'izvodjenje', 272, true, 'M022'),
  ('sf-a-073', 'Svetiljka WL070V GEN2 11_17S/830 840 860 PSU PHILIPS', 'kom', 'Artikli (ELOM)', 'izvodjenje', 273, true, 'M023'),
  ('sf-a-074', 'AJAX Hub2 WH', 'kom', 'Artikli (ELOM)', 'izvodjenje', 274, true, 'M024'),
  ('sf-a-075', 'AJAX Keypad WH', 'kom', 'Artikli (ELOM)', 'izvodjenje', 275, true, 'M025'),
  ('sf-a-076', 'AJAX DoorProtect WH', 'kom', 'Artikli (ELOM)', 'izvodjenje', 276, true, 'M026'),
  ('sf-a-077', 'AJAX MOtionProtect WH', 'kom', 'Artikli (ELOM)', 'izvodjenje', 277, true, 'M027'),
  ('sf-a-078', 'AJAX HomeSiren WH', 'kom', 'Artikli (ELOM)', 'izvodjenje', 278, true, 'M028'),
  ('sf-a-079', 'Svetiljka ITALO 1 5P5 7040.120-3M 65.6W AEC ILLUMINAZIONE', 'kom', 'Artikli (ELOM)', 'izvodjenje', 279, true, '46'),
  ('sf-a-080', 'Svetiljka ITALO 1 5P5 7040.200-3M 113W AEC ILLUMINAZIONE', 'kom', 'Artikli (ELOM)', 'izvodjenje', 280, true, '47'),
  ('sf-a-081', 'Svetiljka RC132V G6 36S/840 PSU W60L60', 'kom', 'Artikli (ELOM)', 'izvodjenje', 281, true, 'M029')
on conflict (id) do update set naziv = excluded.naziv, jm = excluded.jm, grupa = excluded.grupa, modul = excluded.modul, sifra = excluded.sifra;

-- ---------- 2) situacije ----------
alter table situacije add column if not exists vrsta text not null default 'privremena';
alter table situacije drop constraint if exists situacije_vrsta_check;
alter table situacije add constraint situacije_vrsta_check check (vrsta in ('privremena','okoncana'));
alter table situacije add column if not exists autor text;
alter table situacije add column if not exists napomena text;
revoke select on situacije from authenticated, anon;
grant select (id, gr, br, opis, izdato, valuta, status, vrsta, autor, napomena) on situacije to authenticated;
grant insert, update, delete on situacije to authenticated;
drop view if exists situacije_v;
create view situacije_v with (security_barrier = true) as
  select id, gr, br, opis, izdato, valuta, status, vrsta, autor, napomena, case when vidi_finansije() then iznos end as iznos
  from situacije where vodim_gradiliste(gr) or (vidi_finansije() and moje_gradiliste(gr));
revoke all on situacije_v from public, anon; grant select on situacije_v to authenticated;
drop policy if exists p_sel on situacije;
create policy p_sel on situacije for select to authenticated using (vodim_gradiliste(gr) or (vidi_finansije() and moje_gradiliste(gr)));
drop policy if exists p_ins on situacije;
create policy p_ins on situacije for insert to authenticated with check (vodim_gradiliste(gr));
drop policy if exists p_upd on situacije;
create policy p_upd on situacije for update to authenticated
  using (je_direktor() or (vodim_gradiliste(gr) and autor = moj_autor() and status <> 'placeno'))
  with check (je_direktor() or (vodim_gradiliste(gr) and autor = moj_autor() and status <> 'placeno'));
drop policy if exists p_del on situacije;
create policy p_del on situacije for delete to authenticated using (je_super());

create or replace function zastiti_kolone_situacije() returns trigger language plpgsql as $$
begin
  if pg_trigger_depth() > 1 then return new; end if;   -- preracunaj_situacije (server) sme da upise iznos
  if tg_op = 'INSERT' then
    if not je_direktor() then new.iznos := 0; new.status := 'ceka'; new.autor := moj_autor(); end if;
    if new.autor is null then new.autor := 'direkcija'; end if;
    return new;
  end if;
  if not je_direktor() then
    new.iznos := old.iznos; new.status := old.status; new.gr := old.gr; new.autor := old.autor;
  end if;
  return new;
end $$;
drop trigger if exists trg_zastiti_situacije on situacije;
create trigger trg_zastiti_situacije before insert or update on situacije
  for each row execute function zastiti_kolone_situacije();

-- ---------- 3) stavke ----------
create table if not exists situacija_stavke (
  id text primary key,
  sit text not null references situacije(id) on delete cascade,
  gr text not null references gradilista(id) on delete cascade,
  predmer_id text references predmer(id) on delete set null,
  sifra text, poz text not null, jm text,
  kol numeric not null default 0,
  kol_ugovoreno numeric not null default 0,
  kumulativ numeric not null default 0,
  razlika numeric not null default 0
);
create index if not exists situacija_stavke_sit_idx on situacija_stavke(sit);
create index if not exists situacija_stavke_gr_idx on situacija_stavke(gr);
alter table situacija_stavke enable row level security;
grant select, insert, update, delete on situacija_stavke to authenticated;
drop policy if exists p_sel on situacija_stavke;
create policy p_sel on situacija_stavke for select to authenticated using (vodim_gradiliste(gr) or (vidi_finansije() and moje_gradiliste(gr)));
drop policy if exists p_ins on situacija_stavke;
create policy p_ins on situacija_stavke for insert to authenticated with check (vodim_gradiliste(gr));
drop policy if exists p_upd on situacija_stavke;
create policy p_upd on situacija_stavke for update to authenticated using (vodim_gradiliste(gr)) with check (vodim_gradiliste(gr));
drop policy if exists p_del on situacija_stavke;
create policy p_del on situacija_stavke for delete to authenticated using (vodim_gradiliste(gr));

create or replace function preracunaj_situacije(p_gid text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_gid is null then return; end if;
  update situacija_stavke st set kol_ugovoreno = coalesce((select p.kol from predmer p where p.id = st.predmer_id), 0)
   where st.gr = p_gid;
  update situacija_stavke st set kumulativ = x.kum, razlika = greatest(0, x.kum - st.kol_ugovoreno)
    from (select st2.id,
                 sum(st2.kol) over (partition by st2.gr, coalesce(st2.predmer_id, 'sifra:'||st2.sifra, 'poz:'||lower(st2.poz))
                                    order by s2.izdato, s2.id, st2.id rows between unbounded preceding and current row) as kum
            from situacija_stavke st2 join situacije s2 on s2.id = st2.sit where st2.gr = p_gid) x
   where x.id = st.id;
  update situacije s set iznos = coalesce((select sum(st.kol * coalesce(p.cena, 0)) from situacija_stavke st left join predmer p on p.id = st.predmer_id where st.sit = s.id), 0)
   where s.gr = p_gid and exists (select 1 from situacija_stavke st where st.sit = s.id);
end $$;
revoke execute on function preracunaj_situacije(text) from public, anon;

create or replace function trg_stavke_preracun() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if pg_trigger_depth() > 1 then return null; end if;
  if tg_op in ('INSERT','UPDATE') then perform preracunaj_situacije(new.gr); end if;
  if tg_op = 'DELETE' or (tg_op = 'UPDATE' and old.gr is distinct from new.gr) then perform preracunaj_situacije(old.gr); end if;
  return null;
end $$;
drop trigger if exists trg_stavke_preracun on situacija_stavke;
create trigger trg_stavke_preracun after insert or update or delete on situacija_stavke
  for each row execute function trg_stavke_preracun();

create or replace function trg_situacije_preracun() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if pg_trigger_depth() > 1 then return null; end if;
  perform preracunaj_situacije(new.gr);
  return null;
end $$;
drop trigger if exists trg_situacije_preracun on situacije;
create trigger trg_situacije_preracun after insert or update of izdato on situacije
  for each row execute function trg_situacije_preracun();


-- predmer (kol/cena) menja ugovoreno i iznos → preracun situacija tog gradilista
create or replace function trg_predmer_preracun_sit() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if pg_trigger_depth() > 1 then return null; end if;
  if tg_op = 'DELETE' then perform preracunaj_situacije(old.gr); else perform preracunaj_situacije(new.gr); end if;
  return null;
end $$;
drop trigger if exists trg_predmer_preracun_sit on predmer;
create trigger trg_predmer_preracun_sit after insert or update of kol, cena or delete on predmer
  for each row execute function trg_predmer_preracun_sit();

-- ---------- 4) obrisi_gradiliste: + stavke ----------
create or replace function obrisi_gradiliste(p_gid text) returns void
language plpgsql security definer set search_path = public, auth as $$
declare ja text; naz text;
begin
  if not je_super() then raise exception 'Samo direktor briše gradilište.'; end if;
  select naziv into naz from gradilista where id = p_gid;
  if naz is null then return; end if;
  delete from situacija_stavke where gr = p_gid;
  delete from rad_na_zadatku where gr = p_gid;
  delete from zadaci where gr = p_gid; delete from dnevnik where gr = p_gid; delete from narudzbe where gr = p_gid;
  delete from predmer where gr = p_gid; delete from troskovi_st where gr = p_gid; delete from situacije where gr = p_gid;
  delete from mag_promene where gr = p_gid; delete from dokumenti where gr = p_gid;
  update resursi set gr = null where gr = p_gid;
  delete from zaposleni_gradiliste where gradiliste_id = p_gid; delete from podizvodjac_gradiliste where gradiliste_id = p_gid;
  delete from gradilista where id = p_gid;
  select email into ja from auth.users where id = auth.uid();
  insert into log_koriscenja (user_id, email, uloga, dogadjaj, detalj)
    values (auth.uid(), ja, moja_uloga(), 'brisanje', jsonb_build_object('tabela','gradilista','id',p_gid,'naziv',naz));
end $$;
revoke execute on function obrisi_gradiliste(text) from public, anon;
grant  execute on function obrisi_gradiliste(text) to authenticated;
