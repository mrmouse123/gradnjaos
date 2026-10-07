-- ============================================================
-- Migracija 14 (2026-10-07): sest uloga + dokumenti + sifrarnik + brisanje (super)
--   uloge: direktor (super: sve + delete + dodela uloga), admin (sve bez delete + dodela
--          uloga, ne dira direktore), rukovodilac (svoja gradilista; finansije po zastavici
--          vidi_finansije = "Rukovodilac 1"), radnik (gradilista gde je u timu; svoji unosi i
--          dokumenta), spoljni (kao radnik, vezan za podizvodjaci.id kroz saradnik_id)
--   helperi (disjunktna znacenja):
--     je_super()        = direktor                      -> delete polise, dodela 'direktor'
--     je_direktor()     = direktor | admin = UPRAVA     (ime ostaje — 60 polisa ga koristi)
--     vidi_finansije()  = uprava | profili.vidi_finansije
--     vodim_gradiliste(gid) = uprava | rukovodilac gradilista   -> PISANJE
--     moje_gradiliste(gid)  = vodim | clan tima | saradnik na gradilistu -> CITANJE
--   radnik/spoljni pisu samo: dnevnik (svoj red: insert/update/delete), zadaci (svoj: samo
--   kolona kol — trigger), dokumenti (svoj). Sve ostalo pisanje = vodim_gradiliste.
--   dokumenti: `data` (data-URL) nema SELECT grant — cita se kroz dokument_podaci(id); lista
--   kroz dokumenti_v (bez data). sifrarnik: mere/pozicije za kreiranje gradilista (uprava).
--   obrisi_gradiliste(gid): super brise gradiliste sa svim zavisnim redovima.
-- Idempotentna. Postojeci profili (direktor, rukovodilac) rade nepromenjeno.
-- ============================================================

-- ---------- 1) profili ----------
alter table profili drop constraint if exists profili_uloga_check;
alter table profili add constraint profili_uloga_check check (uloga in ('direktor','admin','rukovodilac','radnik','spoljni'));
alter table profili add column if not exists vidi_finansije boolean not null default false;
alter table profili add column if not exists saradnik_id text;

-- ---------- 2) helperi ----------
create or replace function moja_uloga() returns text
language sql stable security definer set search_path = public as $$
  select uloga from profili where user_id = auth.uid();
$$;
create or replace function je_super() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profili where user_id = auth.uid() and uloga = 'direktor');
$$;
create or replace function je_direktor() returns boolean   -- UPRAVA (direktor | admin)
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profili where user_id = auth.uid() and uloga in ('direktor','admin'));
$$;
create or replace function vidi_finansije() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profili where user_id = auth.uid() and (uloga in ('direktor','admin') or vidi_finansije));
$$;
create or replace function moj_saradnik() returns text
language sql stable security definer set search_path = public as $$
  select saradnik_id from profili where user_id = auth.uid();
$$;
create or replace function vodim_gradiliste(gid text) returns boolean
language sql stable security definer set search_path = public as $$
  select je_direktor()
      or exists (select 1 from gradilista g where g.id = gid and g.rukovodilac = moj_zaposleni() and moja_uloga() = 'rukovodilac');
$$;
create or replace function moje_gradiliste(gid text) returns boolean
language sql stable security definer set search_path = public as $$
  select vodim_gradiliste(gid)
      or exists (select 1 from zaposleni_gradiliste zg where zg.gradiliste_id = gid and zg.aktivan and zg.zaposleni_id = moj_zaposleni() and moja_uloga() = 'radnik')
      or exists (select 1 from podizvodjac_gradiliste pg where pg.gradiliste_id = gid and pg.podizvodjac_id = moj_saradnik() and moja_uloga() = 'spoljni');
$$;
create or replace function moj_klijent(cid text) returns boolean
language sql stable security definer set search_path = public as $$
  select je_direktor()
      or exists (select 1 from gradilista g where g.klijent = cid and vodim_gradiliste(g.id));
$$;
create or replace function moj_podizvodjac(pid text) returns boolean
language sql stable security definer set search_path = public as $$
  select je_direktor()
      or pid = moj_saradnik()
      or exists (select 1 from podizvodjac_gradiliste pg where pg.podizvodjac_id = pid and moje_gradiliste(pg.gradiliste_id));
$$;
-- autor svog reda: zaposleni ili spoljni saradnik
create or replace function moj_autor() returns text
language sql stable security definer set search_path = public as $$
  select coalesce(zaposleni_id, saradnik_id) from profili where user_id = auth.uid();
$$;
revoke execute on function moja_uloga(), je_super(), vidi_finansije(), moj_saradnik(), vodim_gradiliste(text), moj_autor() from public, anon;
grant  execute on function moja_uloga(), je_super(), vidi_finansije(), moj_saradnik(), vodim_gradiliste(text), moj_autor() to authenticated;

-- ---------- 3) nove tabele ----------
create table if not exists dokumenti (
  id        text primary key,
  gr        text not null,
  autor     text,                         -- zaposleni.id | podizvodjaci.id | 'uprava'
  autor_uid uuid default auth.uid(),
  datum     date default current_date,
  naziv     text not null,
  tip       text,                         -- mime
  velicina  int default 0,
  opis      text,
  data      text                          -- data-URL (pilot; kasnije Storage) — BEZ select granta
);
create index if not exists dokumenti_gr on dokumenti (gr);
alter table dokumenti enable row level security;

create table if not exists sifrarnik (
  id       text primary key,
  naziv    text not null,
  jm       text default 'kom',
  grupa    text,                          -- npr. 'Zemljani radovi' | 'IDR'
  modul    text,                          -- 'izvodjenje' | 'projektovanje' | null = oba
  redosled int default 0,
  aktivan  boolean not null default true
);
alter table sifrarnik enable row level security;

-- ---------- 4) polise (sve tabele, ponovo) ----------
do $$
declare t text;
begin
  foreach t in array array['clijenti','zaposleni','gradilista','zadaci','dnevnik','situacije',
                           'narudzbe','troskovi_st','podizvodjaci','mag_promene','magacin','resursi','predmer',
                           'profili','zaposleni_gradiliste','podizvodjac_gradiliste','dokumenti','sifrarnik'] loop
    execute format('drop policy if exists p_sel on %I', t);
    execute format('drop policy if exists p_ins on %I', t);
    execute format('drop policy if exists p_upd on %I', t);
    execute format('drop policy if exists p_del on %I', t);
  end loop;
end $$;

create policy p_sel on profili for select to authenticated using (user_id = auth.uid() or je_direktor());

create policy p_sel on gradilista for select to authenticated using (moje_gradiliste(id));
create policy p_ins on gradilista for insert to authenticated with check (je_direktor());
create policy p_upd on gradilista for update to authenticated using (vodim_gradiliste(id)) with check (vodim_gradiliste(id));
create policy p_del on gradilista for delete to authenticated using (je_super());

create policy p_sel on zadaci for select to authenticated using (moje_gradiliste(gr));
create policy p_ins on zadaci for insert to authenticated with check (vodim_gradiliste(gr));
create policy p_upd on zadaci for update to authenticated using (vodim_gradiliste(gr) or zad = moj_autor()) with check (vodim_gradiliste(gr) or zad = moj_autor());
create policy p_del on zadaci for delete to authenticated using (je_super());

create policy p_sel on dnevnik for select to authenticated using (moje_gradiliste(gr));
create policy p_ins on dnevnik for insert to authenticated with check (moje_gradiliste(gr) and (je_direktor() or autor = moj_autor()));
create policy p_upd on dnevnik for update to authenticated using (je_direktor() or autor = moj_autor()) with check (je_direktor() or autor = moj_autor());
create policy p_del on dnevnik for delete to authenticated using (je_super() or autor = moj_autor());

create policy p_sel on narudzbe for select to authenticated using (moje_gradiliste(gr));
create policy p_ins on narudzbe for insert to authenticated with check (vodim_gradiliste(gr) and (je_direktor() or autor = moj_zaposleni()));
create policy p_upd on narudzbe for update to authenticated using (vodim_gradiliste(gr)) with check (vodim_gradiliste(gr));
create policy p_del on narudzbe for delete to authenticated using (je_super());

create policy p_sel on predmer for select to authenticated using (moje_gradiliste(gr));
create policy p_ins on predmer for insert to authenticated with check (je_direktor());
create policy p_upd on predmer for update to authenticated using (vodim_gradiliste(gr)) with check (vodim_gradiliste(gr));
create policy p_del on predmer for delete to authenticated using (je_super());

create policy p_sel on troskovi_st for select to authenticated using (vidi_finansije() and moje_gradiliste(gr));
create policy p_ins on troskovi_st for insert to authenticated with check (je_direktor());
create policy p_upd on troskovi_st for update to authenticated using (je_direktor()) with check (je_direktor());
create policy p_del on troskovi_st for delete to authenticated using (je_super());

create policy p_sel on situacije for select to authenticated using (vidi_finansije() and moje_gradiliste(gr));
create policy p_ins on situacije for insert to authenticated with check (je_direktor());
create policy p_upd on situacije for update to authenticated using (je_direktor()) with check (je_direktor());
create policy p_del on situacije for delete to authenticated using (je_super());

create policy p_sel on resursi for select to authenticated using (ima_profil() and (gr is null or moje_gradiliste(gr)));
create policy p_ins on resursi for insert to authenticated with check (je_direktor());
create policy p_upd on resursi for update to authenticated using (je_direktor()) with check (je_direktor());
create policy p_del on resursi for delete to authenticated using (je_super());

create policy p_sel on magacin for select to authenticated using (ima_profil());
create policy p_ins on magacin for insert to authenticated with check (je_direktor());
create policy p_upd on magacin for update to authenticated using (je_direktor() or moja_uloga() = 'rukovodilac') with check (je_direktor() or moja_uloga() = 'rukovodilac');
create policy p_del on magacin for delete to authenticated using (je_super());

create policy p_sel on mag_promene for select to authenticated using (ima_profil() and (gr is null or moje_gradiliste(gr)));
create policy p_ins on mag_promene for insert to authenticated with check (je_direktor() or (tip = 'izlaz' and vodim_gradiliste(gr)));
create policy p_upd on mag_promene for update to authenticated using (je_direktor()) with check (je_direktor());
create policy p_del on mag_promene for delete to authenticated using (je_super());

create policy p_sel on clijenti for select to authenticated using (moj_klijent(id));
create policy p_ins on clijenti for insert to authenticated with check (je_direktor());
create policy p_upd on clijenti for update to authenticated using (je_direktor()) with check (je_direktor());
create policy p_del on clijenti for delete to authenticated using (je_super());

create policy p_sel on zaposleni for select to authenticated using (ima_profil());
create policy p_ins on zaposleni for insert to authenticated with check (je_direktor());
create policy p_upd on zaposleni for update to authenticated using (je_direktor()) with check (je_direktor());
create policy p_del on zaposleni for delete to authenticated using (je_super());

create policy p_sel on zaposleni_gradiliste for select to authenticated using (ima_profil());
create policy p_ins on zaposleni_gradiliste for insert to authenticated with check (vodim_gradiliste(gradiliste_id));
create policy p_upd on zaposleni_gradiliste for update to authenticated using (vodim_gradiliste(gradiliste_id)) with check (vodim_gradiliste(gradiliste_id));
create policy p_del on zaposleni_gradiliste for delete to authenticated using (je_super());

create policy p_sel on podizvodjaci for select to authenticated using (moj_podizvodjac(id));
create policy p_ins on podizvodjaci for insert to authenticated with check (je_direktor());
create policy p_upd on podizvodjaci for update to authenticated using (je_direktor()) with check (je_direktor());
create policy p_del on podizvodjaci for delete to authenticated using (je_super());

create policy p_sel on podizvodjac_gradiliste for select to authenticated using (ima_profil());
create policy p_ins on podizvodjac_gradiliste for insert to authenticated with check (vodim_gradiliste(gradiliste_id));
create policy p_upd on podizvodjac_gradiliste for update to authenticated using (je_direktor()) with check (je_direktor());
create policy p_del on podizvodjac_gradiliste for delete to authenticated using (je_super());

create policy p_sel on dokumenti for select to authenticated using (moje_gradiliste(gr));
create policy p_ins on dokumenti for insert to authenticated with check (moje_gradiliste(gr) and autor_uid = auth.uid());
create policy p_upd on dokumenti for update to authenticated using (je_direktor() or autor_uid = auth.uid()) with check (je_direktor() or autor_uid = auth.uid());
create policy p_del on dokumenti for delete to authenticated using (je_super() or autor_uid = auth.uid());

create policy p_sel on sifrarnik for select to authenticated using (ima_profil());
create policy p_ins on sifrarnik for insert to authenticated with check (je_direktor());
create policy p_upd on sifrarnik for update to authenticated using (je_direktor()) with check (je_direktor());
create policy p_del on sifrarnik for delete to authenticated using (je_super());

drop policy if exists p_sel on log_koriscenja;
create policy p_sel on log_koriscenja for select to authenticated using (je_direktor());

-- ---------- 5) kolonski grantovi + view-ovi (finansije po vidi_finansije; dokumenti.data skriveno) ----------
revoke all on dokumenti, sifrarnik from anon;
grant select (id, gr, autor, autor_uid, datum, naziv, tip, velicina, opis), insert, update, delete on dokumenti to authenticated;
grant select, insert, update, delete on sifrarnik to authenticated;
drop view if exists dokumenti_v;
create view dokumenti_v with (security_barrier = true) as
  select id, gr, autor, autor_uid, datum, naziv, tip, velicina, opis from dokumenti where moje_gradiliste(gr);
revoke all on dokumenti_v from public, anon; grant select on dokumenti_v to authenticated;
create or replace function dokument_podaci(p_id text) returns text
language sql stable security definer set search_path = public as $$
  select data from dokumenti d where d.id = p_id and moje_gradiliste(d.gr);
$$;
revoke execute on function dokument_podaci(text) from public, anon;
grant  execute on function dokument_podaci(text) to authenticated;

drop view if exists gradilista_v; drop view if exists predmer_v; drop view if exists podizvodjaci_v;
create view gradilista_v with (security_barrier = true) as
  select id, naziv, modul, tip, lok, klijent, rukovodilac, pocetak, rok, napredak, status, faza,
         povrsina, nivo, nadzor, adm,
         case when vidi_finansije() then budzet    end as budzet,
         case when vidi_finansije() then troskovi  end as troskovi,
         case when vidi_finansije() then potroseno end as potroseno,
         case when vidi_finansije() then naplaceno end as naplaceno
  from gradilista where moje_gradiliste(id);
create view predmer_v with (security_barrier = true) as
  select id, gr, poz, jm, kol, izv, zaduzen, case when vidi_finansije() then cena end as cena
  from predmer where moje_gradiliste(gr);
create view podizvodjaci_v with (security_barrier = true) as
  select id, naziv, delatnost, osoba, tel, status, case when vidi_finansije() then cena end as cena
  from podizvodjaci where moj_podizvodjac(id);
revoke all on gradilista_v, predmer_v, podizvodjaci_v from public, anon;
grant select on gradilista_v, predmer_v, podizvodjaci_v to authenticated;

-- ---------- 6) trigger: radnik/spoljni na svom zadatku menja samo kolonu (kol) ----------
create or replace function zastiti_kolone_zadaci() returns trigger language plpgsql as $$
begin
  if auth.uid() is not null and not vodim_gradiliste(new.gr) then
    new.naziv := old.naziv; new.gr := old.gr; new.zad := old.zad; new.prio := old.prio; new.rok := old.rok;
    -- dozvoljeno: kol (status na kanbanu)
  end if;
  return new;
end $$;
drop trigger if exists trg_zastiti_zadaci on zadaci;
create trigger trg_zastiti_zadaci before update on zadaci
  for each row execute function zastiti_kolone_zadaci();

-- ---------- 7) nalozi: 5 uloga, zastavica finansija, saradnik; admin ne dira direktore ----------
drop function if exists nalozi_pregled();
create function nalozi_pregled()
returns table (user_id uuid, email text, uloga text, zaposleni_id text, saradnik_id text, vidi_finansije boolean,
               ime text, kreiran timestamptz, poslednja_prijava timestamptz, bez_profila boolean)
language plpgsql stable security definer set search_path = public, auth as $$
begin
  if not je_direktor() then raise exception 'Samo uprava vidi naloge.'; end if;
  return query
    select u.id, u.email::text, p.uloga, p.zaposleni_id, p.saradnik_id, coalesce(p.vidi_finansije,false), p.ime,
           u.created_at, u.last_sign_in_at, (p.user_id is null) as bez_profila
    from auth.users u left join profili p on p.user_id = u.id
    order by (p.user_id is null), u.email;
end $$;
revoke execute on function nalozi_pregled() from public, anon;
grant  execute on function nalozi_pregled() to authenticated;

drop function if exists dodeli_ulogu(text, text, text);
create function dodeli_ulogu(p_email text, p_uloga text, p_zaposleni_id text default null,
                             p_vidi_finansije boolean default false, p_saradnik_id text default null)
returns text language plpgsql security definer set search_path = public, auth as $$
declare uid uuid; stara text; ja text; zid text; sid text; fin boolean;
begin
  if not je_direktor() then raise exception 'Samo uprava dodeljuje uloge.'; end if;
  select id into uid from auth.users where lower(email) = lower(p_email);
  if uid is null then
    raise exception 'Nema naloga %. Napravi ga prvo u Supabase → Authentication → Users (Add user), pa ponovi.', p_email;
  end if;
  if uid = auth.uid() then raise exception 'Sopstvenu ulogu ne možeš da menjaš — zamoli drugog direktora.'; end if;
  if p_uloga not in ('direktor','admin','rukovodilac','radnik','spoljni') then raise exception 'Nepoznata uloga: %', p_uloga; end if;
  select uloga into stara from profili where user_id = uid;
  if not je_super() and (p_uloga = 'direktor' or stara = 'direktor') then
    raise exception 'Samo direktor može da dodeli ili promeni ulogu direktora.';
  end if;
  zid := p_zaposleni_id; sid := p_saradnik_id; fin := coalesce(p_vidi_finansije, false);
  if p_uloga in ('rukovodilac','radnik') and (zid is null or not exists (select 1 from zaposleni where id = zid)) then
    raise exception '% mora biti vezan za postojećeg zaposlenog.', initcap(p_uloga);
  end if;
  if p_uloga = 'spoljni' and (sid is null or not exists (select 1 from podizvodjaci where id = sid)) then
    raise exception 'Spoljni saradnik mora biti vezan za postojećeg podizvođača/saradnika.';
  end if;
  if p_uloga in ('direktor','admin') then zid := null; sid := null; fin := true; end if;
  if p_uloga <> 'spoljni' then sid := null; end if;
  if p_uloga = 'spoljni' then zid := null; end if;
  if p_uloga in ('radnik','spoljni') then fin := false; end if;
  if stara = 'direktor' and p_uloga <> 'direktor' and (select count(*) from profili where uloga = 'direktor') <= 1 then
    raise exception 'Ovo je poslednji direktor — prvo dodeli ulogu direktora nekom drugom.';
  end if;
  insert into profili (user_id, zaposleni_id, saradnik_id, uloga, vidi_finansije, ime)
    values (uid, zid, sid, p_uloga, fin,
            coalesce((select z.ime from zaposleni z where z.id = zid), (select p.naziv from podizvodjaci p where p.id = sid), p_email))
    on conflict (user_id) do update
      set zaposleni_id = excluded.zaposleni_id, saradnik_id = excluded.saradnik_id, uloga = excluded.uloga,
          vidi_finansije = excluded.vidi_finansije, ime = excluded.ime;
  select email into ja from auth.users where id = auth.uid();
  insert into log_koriscenja (user_id, email, uloga, dogadjaj, detalj)
    values (auth.uid(), ja, moja_uloga(), 'uloga_promena',
            jsonb_build_object('email', lower(p_email), 'stara', stara, 'nova', p_uloga, 'zaposleni_id', zid, 'saradnik_id', sid, 'vidi_finansije', fin));
  return case when stara is null then 'dodeljeno' else 'izmenjeno' end;
end $$;
revoke execute on function dodeli_ulogu(text, text, text, boolean, text) from public, anon;
grant  execute on function dodeli_ulogu(text, text, text, boolean, text) to authenticated;

create or replace function ukloni_pristup(p_email text)
returns void language plpgsql security definer set search_path = public, auth as $$
declare uid uuid; stara text; ja text;
begin
  if not je_direktor() then raise exception 'Samo uprava uklanja pristup.'; end if;
  select id into uid from auth.users where lower(email) = lower(p_email);
  if uid is null then raise exception 'Nema naloga %.', p_email; end if;
  if uid = auth.uid() then raise exception 'Sopstveni pristup ne možeš da ukloniš.'; end if;
  select uloga into stara from profili where user_id = uid;
  if stara is null then return; end if;
  if stara = 'direktor' and not je_super() then raise exception 'Samo direktor može da ukloni direktora.'; end if;
  if stara = 'direktor' and (select count(*) from profili where uloga = 'direktor') <= 1 then
    raise exception 'Ovo je poslednji direktor.';
  end if;
  delete from profili where user_id = uid;
  select email into ja from auth.users where id = auth.uid();
  insert into log_koriscenja (user_id, email, uloga, dogadjaj, detalj)
    values (auth.uid(), ja, moja_uloga(), 'pristup_uklonjen', jsonb_build_object('email', lower(p_email), 'stara', stara));
end $$;

-- ---------- 8) brisanje gradilista (samo super) ----------
create or replace function obrisi_gradiliste(p_gid text) returns void
language plpgsql security definer set search_path = public, auth as $$
declare ja text; n text;
begin
  if not je_super() then raise exception 'Samo direktor briše gradilišta.'; end if;
  select naziv into n from gradilista where id = p_gid;
  if n is null then return; end if;
  delete from zadaci where gr = p_gid; delete from dnevnik where gr = p_gid; delete from narudzbe where gr = p_gid;
  delete from predmer where gr = p_gid; delete from troskovi_st where gr = p_gid; delete from situacije where gr = p_gid;
  delete from mag_promene where gr = p_gid; delete from dokumenti where gr = p_gid;
  update resursi set gr = null where gr = p_gid;
  delete from gradilista where id = p_gid;   -- join tabele: on delete cascade
  select email into ja from auth.users where id = auth.uid();
  insert into log_koriscenja (user_id, email, uloga, dogadjaj, detalj)
    values (auth.uid(), ja, 'direktor', 'brisanje', jsonb_build_object('tabela', 'gradilista', 'id', p_gid, 'naziv', n));
end $$;
revoke execute on function obrisi_gradiliste(text) from public, anon;
grant  execute on function obrisi_gradiliste(text) to authenticated;

-- ---------- 9) sifrarnik: pocetni sadrzaj (idempotentno) ----------
insert into sifrarnik (id, naziv, jm, grupa, modul, redosled) values
  ('sf-p-01','PDR','kom','IDR','projektovanje',1), ('sf-p-02','UP','kom','IDR','projektovanje',2), ('sf-p-03','KTP','kom','IDR','projektovanje',3),
  ('sf-p-04','Elaborat posebnih delova','kom','IDR','projektovanje',4), ('sf-p-05','Konceptualno rešenje','kom','IDR','projektovanje',5), ('sf-p-06','IDR','kom','IDR','projektovanje',6),
  ('sf-p-11','1.0 Arhitektura','kom','IDP/PGD','projektovanje',11), ('sf-p-12','2.0 Konstrukcija','kom','IDP/PGD','projektovanje',12), ('sf-p-13','3.0 ViK','kom','IDP/PGD','projektovanje',13),
  ('sf-p-14','4.0 Elektroenergetika','kom','IDP/PGD','projektovanje',14), ('sf-p-15','5.1 Telekomunikacije i signalne inst.','kom','IDP/PGD','projektovanje',15), ('sf-p-16','5.2 Dojava požara','kom','IDP/PGD','projektovanje',16),
  ('sf-p-17','5.3 Video nadzor','kom','IDP/PGD','projektovanje',17), ('sf-p-18','6.0 Mašinske instalacije','kom','IDP/PGD','projektovanje',18), ('sf-p-19','7.0 Tehnologija','kom','IDP/PGD','projektovanje',19),
  ('sf-p-20','8.0 Saobraćaj i saobraćajna sign.','kom','IDP/PGD','projektovanje',20), ('sf-p-21','9.0 Parterno uređenje','kom','IDP/PGD','projektovanje',21), ('sf-p-22','10.0 Pripremni radovi','kom','IDP/PGD','projektovanje',22),
  ('sf-p-23','Elaborat energetske efikasnosti','kom','IDP/PGD','projektovanje',23), ('sf-p-24','Elaborat o geotehničkim uslovima','kom','IDP/PGD','projektovanje',24), ('sf-p-25','Elaborat zaštite od požara','kom','IDP/PGD','projektovanje',25),
  ('sf-p-26','Plan upravljanja otpadom','kom','IDP/PGD','projektovanje',26), ('sf-p-27','Energetski pasoš','kom','IDP/PGD','projektovanje',27),
  ('sf-p-31','1.0 Arhitektura','kom','PZI','projektovanje',31), ('sf-p-32','2.0 Konstrukcija','kom','PZI','projektovanje',32), ('sf-p-33','3.0 ViK','kom','PZI','projektovanje',33),
  ('sf-p-34','4.0 Elektroenergetika','kom','PZI','projektovanje',34), ('sf-p-35','5.1 Telekomunikacije i signalne inst.','kom','PZI','projektovanje',35), ('sf-p-36','5.2 Dojava požara','kom','PZI','projektovanje',36),
  ('sf-p-37','5.3 Video nadzor','kom','PZI','projektovanje',37), ('sf-p-38','6.0 Mašinske instalacije','kom','PZI','projektovanje',38), ('sf-p-39','7.0 Tehnologija','kom','PZI','projektovanje',39),
  ('sf-p-40','8.0 Saobraćaj i saobraćajna sign.','kom','PZI','projektovanje',40), ('sf-p-41','9.0 Parterno uređenje','kom','PZI','projektovanje',41), ('sf-p-42','Plan preventivnih mera','kom','PZI','projektovanje',42),
  ('sf-p-43','Glavni projekat zaštite od požara','kom','PZI','projektovanje',43),
  ('sf-i-01','Iskop temelja','m³','Zemljani radovi','izvodjenje',101), ('sf-i-02','Nasipanje i nabijanje','m³','Zemljani radovi','izvodjenje',102), ('sf-i-03','Odvoz viška zemlje','m³','Zemljani radovi','izvodjenje',103),
  ('sf-i-11','Temelji AB','m³','Betonski i AB radovi','izvodjenje',111), ('sf-i-12','AB zidovi','m³','Betonski i AB radovi','izvodjenje',112), ('sf-i-13','AB ploča','m³','Betonski i AB radovi','izvodjenje',113), ('sf-i-14','Armatura','kg','Betonski i AB radovi','izvodjenje',114), ('sf-i-15','Oplata','m²','Betonski i AB radovi','izvodjenje',115),
  ('sf-i-21','Zidanje blokom','m²','Zidarski radovi','izvodjenje',121), ('sf-i-22','Malterisanje','m²','Zidarski radovi','izvodjenje',122),
  ('sf-i-31','Krovna konstrukcija','m²','Krov','izvodjenje',131), ('sf-i-32','Pokrivanje','m²','Krov','izvodjenje',132), ('sf-i-33','Hidroizolacija','m²','Krov','izvodjenje',133),
  ('sf-i-41','Vodovod i kanalizacija','paušal','Instalacije','izvodjenje',141), ('sf-i-42','Elektroinstalacije','paušal','Instalacije','izvodjenje',142), ('sf-i-43','Grejanje i klimatizacija','paušal','Instalacije','izvodjenje',143),
  ('sf-i-51','Fasada','m²','Završni radovi','izvodjenje',151), ('sf-i-52','Stolarija','kom','Završni radovi','izvodjenje',152), ('sf-i-53','Podovi','m²','Završni radovi','izvodjenje',153), ('sf-i-54','Keramika','m²','Završni radovi','izvodjenje',154), ('sf-i-55','Moleraj','m²','Završni radovi','izvodjenje',155),
  ('sf-i-61','Asfaltiranje','m²','Niskogradnja','izvodjenje',161), ('sf-i-62','Ivičnjaci','m','Niskogradnja','izvodjenje',162), ('sf-i-63','Kolovozna konstrukcija','m³','Niskogradnja','izvodjenje',163)
on conflict (id) do nothing;

-- ---------- 10) dopuna 2026-10-08: dokumenti.data stvarno bez SELECT granta ----------
-- Supabase podrazumevano daje ALL na novu tabelu roli authenticated, pa kolonski grant iznad
-- nije imao efekta dok se table-level SELECT ne ukine (lekcija 15). Primenjeno na zivu bazu.
revoke select on dokumenti from authenticated;
grant select (id, gr, autor, autor_uid, datum, naziv, tip, velicina, opis) on dokumenti to authenticated;
