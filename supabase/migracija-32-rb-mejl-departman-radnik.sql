-- migracija 32 (2026-10-23): zahtevi klijenta — pet tačaka iz poruke 2026-10-23
--   1) predmer.rb = REDNI BROJ pozicije (investitorska numeracija ili 1..n po gradilištu). Izvoz situacija (lat/ćir)
--      prikazuje rb; šifra artikla (sifrarnik.sifra) ostaje samo u alatu. sifra se NE briše (ključ uparivanja stavki).
--   2) narudzbe.mejl = dodatni primalac trebovanja (dobavljač); primarni primalac = direktor izvođenja (RPC ispod).
--   3) resursi.modul / zaposleni.departman = klasifikacija po departmanu (null = svi).
--   4) radnik postoji SAMO u Projektovanju: constraint + dodeli_ulogu; milos (z15) prebačen na projektovanje.
--   5) mejl_direktora_izvodjenja(): email naloga sa ulogom direktor_izvodjenja (trebovanje ide njemu automatski).

-- 1) redni broj pozicije
alter table predmer add column if not exists rb text;
-- backfill: uvezena investitorska numeracija stoji u sifra (nije šifra artikla) → rb; ostalo redni broj po gradilištu (po id-u)
update predmer p set rb = p.sifra
 where p.rb is null and p.sifra is not null and not exists (select 1 from sifrarnik s where s.sifra = p.sifra);
with r as (select id, row_number() over (partition by gr order by id) n from predmer where rb is null)
update predmer p set rb = r.n::text from r where r.id = p.id;
-- view: nova kolona NA KRAJU (create or replace ne menja redosled — lekcija 37)
create or replace view predmer_v as
  select id, gr, poz, jm, kol, izv, zaduzen, sifra,
         case when vidi_finansije() or (vodim_gradiliste(gr) and not gradiliste_je_pro(gr)) then cena else null::numeric end as cena,
         izvor, rb
    from predmer where moje_gradiliste(gr);
grant select (rb) on predmer to authenticated;
-- trigger: ne-uprava na Izvođenju ne menja ni rb; na Projektovanju sme (kao sifra)
create or replace function zastiti_kolone_predmer() returns trigger language plpgsql as $$
begin
  if auth.uid() is not null and not je_direktor() then
    new.gr := old.gr; new.cena := old.cena; new.izvor := old.izvor;
    if not gradiliste_je_pro(old.gr) then
      new.poz := old.poz; new.jm := old.jm; new.kol := old.kol; new.zaduzen := old.zaduzen; new.sifra := old.sifra; new.rb := old.rb;
    end if;
  end if;
  return new;
end $$;

-- 2) dodatni mejl trebovanja
alter table narudzbe add column if not exists mejl text;

-- 3) departman
alter table resursi add column if not exists modul text check (modul in ('projektovanje','izvodjenje'));
alter table zaposleni add column if not exists departman text check (departman in ('projektovanje','izvodjenje'));

-- 4) radnik samo u Projektovanju
update profili set moduli = array['projektovanje']::text[] where uloga = 'radnik' and moduli <> array['projektovanje']::text[];
alter table profili drop constraint if exists profili_moduli_uloga_check;
alter table profili add constraint profili_moduli_uloga_check check (
  (uloga <> 'direktor_projektovanja' or moduli = array['projektovanje']::text[]) and
  (uloga <> 'direktor_izvodjenja'    or moduli = array['izvodjenje']::text[]) and
  (uloga <> 'radnik'                 or moduli = array['projektovanje']::text[]));
create or replace function dodeli_ulogu(p_email text, p_uloga text, p_zaposleni_id text default null,
                                        p_vidi_finansije boolean default false, p_saradnik_id text default null,
                                        p_moduli text[] default null)
returns text language plpgsql security definer set search_path = public, auth as $$
declare uid uuid; stara text; ja text; zid text; sid text; fin boolean; mods text[];
        direktorske constant text[] := array['direktor','direktor_projektovanja','direktor_izvodjenja'];
begin
  if not je_puna_uprava() then raise exception 'Uloge dodeljuju samo direktor i admin.'; end if;
  select id into uid from auth.users where lower(email) = lower(p_email);
  if uid is null then
    raise exception 'Nema naloga %. Napravi ga prvo u Supabase → Authentication → Users (Add user), pa ponovi.', p_email;
  end if;
  if uid = auth.uid() then raise exception 'Sopstvenu ulogu ne možeš da menjaš — zamoli drugog direktora.'; end if;
  if p_uloga not in ('direktor','admin','direktor_projektovanja','direktor_izvodjenja','rukovodilac','radnik','spoljni') then
    raise exception 'Nepoznata uloga: %', p_uloga;
  end if;
  select uloga into stara from profili where user_id = uid;
  if moja_uloga() <> 'direktor' and (p_uloga = any(direktorske) or stara = any(direktorske)) then
    raise exception 'Samo direktor može da dodeli ili promeni direktorsku ulogu (direktor, direktor projektovanja, direktor izvođenja).';
  end if;
  zid := p_zaposleni_id; sid := p_saradnik_id; fin := coalesce(p_vidi_finansije, false);
  if p_uloga in ('rukovodilac','radnik') and (zid is null or not exists (select 1 from zaposleni where id = zid)) then
    raise exception '% mora biti vezan za postojećeg zaposlenog.', initcap(p_uloga);
  end if;
  if p_uloga = 'spoljni' and (sid is null or not exists (select 1 from podizvodjaci where id = sid)) then
    raise exception 'Spoljni saradnik mora biti vezan za postojećeg podizvođača/saradnika.';
  end if;
  if p_uloga in ('direktor','admin','direktor_projektovanja','direktor_izvodjenja') then zid := null; sid := null; fin := true; end if;
  if p_uloga <> 'spoljni' then sid := null; end if;
  if p_uloga = 'spoljni' then zid := null; end if;
  if p_uloga in ('radnik','spoljni') then fin := false; end if;
  mods := (select array_agg(distinct m) from unnest(coalesce(p_moduli, array['projektovanje','izvodjenje']::text[])) m
           where m in ('projektovanje','izvodjenje'));
  if mods is null or cardinality(mods) = 0 then raise exception 'Izaberi bar jedan modul (projektovanje / izvođenje).'; end if;
  if p_uloga = 'radnik' and 'izvodjenje' = any(mods) and not ('projektovanje' = any(mods)) then
    raise exception 'Radnik postoji samo u Projektovanju (u Izvođenju su podizvođači).';   -- odluka klijenta 2026-10-23
  end if;
  if    p_uloga = 'direktor_projektovanja' then mods := array['projektovanje']::text[];
  elsif p_uloga = 'direktor_izvodjenja'    then mods := array['izvodjenje']::text[];
  elsif p_uloga = 'radnik'                 then mods := array['projektovanje']::text[];
  elsif p_uloga <> 'rukovodilac'           then mods := array['projektovanje','izvodjenje']::text[];
  end if;
  if stara = 'direktor' and p_uloga <> 'direktor' and (select count(*) from profili where uloga = 'direktor') <= 1 then
    raise exception 'Ovo je poslednji direktor — prvo dodeli ulogu direktora nekom drugom.';
  end if;
  insert into profili (user_id, zaposleni_id, saradnik_id, uloga, vidi_finansije, moduli, ime)
    values (uid, zid, sid, p_uloga, fin, mods,
            coalesce((select z.ime from zaposleni z where z.id = zid), (select p.naziv from podizvodjaci p where p.id = sid), p_email))
    on conflict (user_id) do update
      set zaposleni_id = excluded.zaposleni_id, saradnik_id = excluded.saradnik_id, uloga = excluded.uloga,
          vidi_finansije = excluded.vidi_finansije, moduli = excluded.moduli, ime = excluded.ime;
  select email into ja from auth.users where id = auth.uid();
  insert into log_koriscenja (user_id, email, uloga, dogadjaj, detalj)
    values (auth.uid(), ja, moja_uloga(), 'uloga_promena',
            jsonb_build_object('email', lower(p_email), 'stara', stara, 'nova', p_uloga, 'zaposleni_id', zid, 'saradnik_id', sid,
                               'vidi_finansije', fin, 'moduli', to_jsonb(mods)));
  return case when stara is null then 'dodeljeno' else 'izmenjeno' end;
end $$;

-- 5) primalac trebovanja = direktor izvođenja (email naloga sa tom ulogom; null ako ga nema → klijent pada na NABAVKA_EMAIL)
create or replace function mejl_direktora_izvodjenja() returns text
language sql stable security definer set search_path = public, auth as $$
  select u.email::text from profili p join auth.users u on u.id = p.user_id
   where p.uloga = 'direktor_izvodjenja' order by p.created_at limit 1
$$;
revoke execute on function mejl_direktora_izvodjenja() from public, anon;
grant  execute on function mejl_direktora_izvodjenja() to authenticated;
