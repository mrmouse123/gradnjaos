-- ============================================================
-- Migracija 28 (2026-10-14), odluka klijenta: ADMIN KOKPIT (nalozi, uloge, angažovanost, log) vidi SAMO puna uprava
--   (direktor i admin). Direktor projektovanja / direktor izvođenja NEMAJU pristup: ni tab u aplikaciji, ni RPC-ove
--   nalozi_pregled / dodeli_ulogu / ukloni_pristup / angazovanost, ni SELECT na log_koriscenja.
--   dodeli_ulogu / ukloni_pristup: grana „direktor modula dodeljuje samo svoj modul" (migracija 27) je uklonjena — guard
--   je sada je_puna_uprava(); pravilo „direktorske uloge samo direktor" ostaje (admin ih ne dira).
-- Idempotentna.
-- ============================================================
drop policy if exists p_sel on log_koriscenja;
create policy p_sel on log_koriscenja for select to authenticated using (je_puna_uprava());

create or replace function nalozi_pregled()
returns table (user_id uuid, email text, uloga text, zaposleni_id text, saradnik_id text, vidi_finansije boolean,
               moduli text[], ime text, kreiran timestamptz, poslednja_prijava timestamptz, bez_profila boolean)
language plpgsql stable security definer set search_path = public, auth as $$
begin
  if not je_puna_uprava() then raise exception 'Samo direktor i admin vide naloge.'; end if;
  return query
    select u.id, u.email::text, p.uloga, p.zaposleni_id, p.saradnik_id, coalesce(p.vidi_finansije,false),
           coalesce(p.moduli, array['projektovanje','izvodjenje']::text[]), p.ime,
           u.created_at, u.last_sign_in_at, (p.user_id is null) as bez_profila
    from auth.users u left join profili p on p.user_id = u.id
    order by (p.user_id is null), u.email;
end $$;

create or replace function angazovanost(p_od date default (current_date - 30), p_do date default current_date)
returns table (osoba text, gr text, sesija bigint, minuta bigint, poslednji timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not je_puna_uprava() then raise exception 'Samo direktor i admin vide angažovanost.'; end if;
  return query
    select r.osoba, r.gr, count(*)::bigint,
           coalesce(sum(coalesce(r.minuta, greatest(0, floor(extract(epoch from (now() - r.start)) / 60))::int)),0)::bigint,
           max(coalesce(r.kraj, r.start))
    from rad_na_zadatku r
    where r.start::date between p_od and p_do
    group by r.osoba, r.gr order by r.osoba, r.gr;
end $$;

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
  -- direktorske uloge dodeljuje i menja SAMO direktor (admin ne)
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
  -- moduli: rukovodilac 1–2, radnik tačno 1, direktor modula = njegov modul, ostali oba
  mods := (select array_agg(distinct m) from unnest(coalesce(p_moduli, array['projektovanje','izvodjenje']::text[])) m
           where m in ('projektovanje','izvodjenje'));
  if mods is null or cardinality(mods) = 0 then raise exception 'Izaberi bar jedan modul (projektovanje / izvođenje).'; end if;
  if p_uloga = 'radnik' and cardinality(mods) <> 1 then raise exception 'Radnik se vezuje za tačno jedan modul.'; end if;
  if    p_uloga = 'direktor_projektovanja' then mods := array['projektovanje']::text[];
  elsif p_uloga = 'direktor_izvodjenja'    then mods := array['izvodjenje']::text[];
  elsif p_uloga not in ('rukovodilac','radnik') then mods := array['projektovanje','izvodjenje']::text[];
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

create or replace function ukloni_pristup(p_email text) returns void
language plpgsql security definer set search_path = public, auth as $$
declare uid uuid; stara text; ja text;
begin
  if not je_puna_uprava() then raise exception 'Pristup uklanjaju samo direktor i admin.'; end if;
  select id into uid from auth.users where lower(email) = lower(p_email);
  if uid is null then raise exception 'Nema naloga %.', p_email; end if;
  if uid = auth.uid() then raise exception 'Sopstveni pristup ne možeš da ukloniš.'; end if;
  select uloga into stara from profili where user_id = uid;
  if stara is null then return; end if;
  if stara in ('direktor','direktor_projektovanja','direktor_izvodjenja') and moja_uloga() <> 'direktor' then
    raise exception 'Samo direktor može da ukloni direktorsku ulogu.';
  end if;
  if stara = 'direktor' and (select count(*) from profili where uloga = 'direktor') <= 1 then
    raise exception 'Ovo je poslednji direktor.';
  end if;
  delete from profili where user_id = uid;
  select email into ja from auth.users where id = auth.uid();
  insert into log_koriscenja (user_id, email, uloga, dogadjaj, detalj)
    values (auth.uid(), ja, moja_uloga(), 'pristup_uklonjen', jsonb_build_object('email', lower(p_email), 'stara', stara));
end $$;
