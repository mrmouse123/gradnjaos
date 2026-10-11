-- ============================================================
-- Migracija 18 (2026-10-11): modul po nalogu (odluka klijenta)
--   profili.moduli text[] ⊆ {projektovanje, izvodjenje}:
--     rukovodilac: 1 ili 2 modula (projektovanje, izvodjenje ili oba) + vidi_finansije kao do sad
--     radnik:      TACNO 1 modul (radnik projektovanja meri zadatke; radnik izvodjenja nema zadatke)
--     uprava / spoljni: oba (kolona se ignorise)
--   Server: modul_dozvoljen(gid) je deo vodim_gradiliste / moje_gradiliste (ne-uprava grane),
--   pa sve polise, view-ovi i RPC-ovi (zadaci, dnevnik, dokumenti, rad_na_zadatku, zdravlja_mojih,
--   moj_klijent, moj_podizvodjac) nasledjuju ogranicenje. Klijent: MODULI / modulDozvoljen().
--   dodeli_ulogu dobija p_moduli (nova 6-arg signatura; stara 5-arg ostaje kao omotac dok se
--   klijent ne osvezi). nalozi_pregled vraca moduli. Idempotentna.
-- ============================================================

-- ---------- 1) profili.moduli ----------
alter table profili add column if not exists moduli text[] not null default '{projektovanje,izvodjenje}';
alter table profili drop constraint if exists profili_moduli_check;
alter table profili add constraint profili_moduli_check
  check (moduli <@ array['projektovanje','izvodjenje']::text[] and cardinality(moduli) between 1 and 2);

-- ---------- 2) helperi ----------
create or replace function moji_moduli() returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce((select moduli from profili where user_id = auth.uid()), array['projektovanje','izvodjenje']::text[]);
$$;
-- modul gradilista dozvoljen nalogu (uprava: uvek)
create or replace function modul_dozvoljen(gid text) returns boolean
language sql stable security definer set search_path = public as $$
  select je_direktor()
      or exists (select 1 from gradilista g where g.id = gid and coalesce(g.modul,'izvodjenje') = any(moji_moduli()));
$$;
create or replace function vodim_gradiliste(gid text) returns boolean
language sql stable security definer set search_path = public as $$
  select je_direktor()
      or (modul_dozvoljen(gid)
          and exists (select 1 from gradilista g where g.id = gid and g.rukovodilac = moj_zaposleni() and moja_uloga() = 'rukovodilac'));
$$;
create or replace function moje_gradiliste(gid text) returns boolean
language sql stable security definer set search_path = public as $$
  select vodim_gradiliste(gid)
      or (modul_dozvoljen(gid) and (
             exists (select 1 from zaposleni_gradiliste zg where zg.gradiliste_id = gid and zg.aktivan and zg.zaposleni_id = moj_zaposleni() and moja_uloga() = 'radnik')
          or exists (select 1 from podizvodjac_gradiliste pg where pg.gradiliste_id = gid and pg.podizvodjac_id = moj_saradnik() and moja_uloga() = 'spoljni')));
$$;
revoke execute on function moji_moduli(), modul_dozvoljen(text) from public, anon;

-- ---------- 3) nalozi_pregled: + moduli ----------
drop function if exists nalozi_pregled();
create function nalozi_pregled()
returns table (user_id uuid, email text, uloga text, zaposleni_id text, saradnik_id text, vidi_finansije boolean,
               moduli text[], ime text, kreiran timestamptz, poslednja_prijava timestamptz, bez_profila boolean)
language plpgsql stable security definer set search_path = public, auth as $$
begin
  if not je_direktor() then raise exception 'Samo uprava vidi naloge.'; end if;
  return query
    select u.id, u.email::text, p.uloga, p.zaposleni_id, p.saradnik_id, coalesce(p.vidi_finansije,false),
           coalesce(p.moduli, array['projektovanje','izvodjenje']::text[]), p.ime,
           u.created_at, u.last_sign_in_at, (p.user_id is null) as bez_profila
    from auth.users u left join profili p on p.user_id = u.id
    order by (p.user_id is null), u.email;
end $$;
revoke execute on function nalozi_pregled() from public, anon;
grant  execute on function nalozi_pregled() to authenticated;

-- ---------- 4) dodeli_ulogu: + p_moduli ----------
drop function if exists dodeli_ulogu(text, text, text, boolean, text, text[]);
create function dodeli_ulogu(p_email text, p_uloga text, p_zaposleni_id text default null,
                             p_vidi_finansije boolean default false, p_saradnik_id text default null,
                             p_moduli text[] default null)
returns text language plpgsql security definer set search_path = public, auth as $$
declare uid uuid; stara text; ja text; zid text; sid text; fin boolean; mods text[];
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
  -- moduli: rukovodilac 1–2, radnik tacno 1, ostali oba
  mods := (select array_agg(distinct m) from unnest(coalesce(p_moduli, array['projektovanje','izvodjenje']::text[])) m
           where m in ('projektovanje','izvodjenje'));
  if mods is null or cardinality(mods) = 0 then raise exception 'Izaberi bar jedan modul (projektovanje / izvođenje).'; end if;
  if p_uloga = 'radnik' and cardinality(mods) <> 1 then raise exception 'Radnik se vezuje za tačno jedan modul.'; end if;
  if p_uloga not in ('rukovodilac','radnik') then mods := array['projektovanje','izvodjenje']::text[]; end if;
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
revoke execute on function dodeli_ulogu(text, text, text, boolean, text, text[]) from public, anon;
grant  execute on function dodeli_ulogu(text, text, text, boolean, text, text[]) to authenticated;
-- stara 5-arg signatura = omotac (klijent pre ove verzije), bez modula → oba
create or replace function dodeli_ulogu(p_email text, p_uloga text, p_zaposleni_id text default null,
                                        p_vidi_finansije boolean default false, p_saradnik_id text default null)
returns text language sql security definer set search_path = public, auth as $$
  select dodeli_ulogu(p_email, p_uloga, p_zaposleni_id, p_vidi_finansije, p_saradnik_id, null::text[]);
$$;
revoke execute on function dodeli_ulogu(text, text, text, boolean, text) from public, anon;
grant  execute on function dodeli_ulogu(text, text, text, boolean, text) to authenticated;
