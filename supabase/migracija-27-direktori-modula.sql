-- ============================================================
-- Migracija 27 (2026-10-14), odluka klijenta: DVE NOVE ULOGE — `direktor_projektovanja` i `direktor_izvodjenja`.
--   Sva ovlašćenja direktora (finansije, cene, pregled/odobravanje situacija, predmer, tim, brisanje, nalozi),
--   ali SAMO u svom modulu.
--   Dizajn: je_direktor() (= uprava) ih OBUHVATA, pa svaki postojeći „uprava" uslov važi i za njih; ograničenje
--   modula živi na JEDNOM mestu — moji_moduli() (modul se IZVODI iz imena uloge, ne iz profili.moduli, da ručno
--   izmenjen red ne može da ga proširi) → modul_dozvoljen(gid) → vodim_gradiliste(gid): uprava „vodi" gradilište
--   samo ako joj je modul dozvoljen. Polise koje su imale GOLO je_direktor()/je_super() nad tabelama sa
--   gradilištem prelaze na vodim_gradiliste(gr) / smem_brisati(gr) — za direktora i admina identično kao pre.
--   Brisanje: je_super() ostaje SAMO direktor (globalne tabele: zaposleni, klijenti, podizvođači, šifarnik, magacin);
--   redove gradilišta briše smem_brisati(gid) = direktor ILI direktor modula na svom gradilištu. Admin i dalje ne briše.
--   Nalozi: direktor modula dodeljuje/menja/uklanja SAMO rukovodioce i radnike SVOG modula; direktorske uloge
--   (direktor, direktor_projektovanja, direktor_izvodjenja) dodeljuje, menja i uklanja SAMO direktor.
--   Globalne tabele (zaposleni, klijenti, podizvođači, šifarnik, magacin, profili, log) — kao direktor.
-- Idempotentna.
-- ============================================================

-- ---------- 1) profili: uloge + modul uloge ----------
alter table profili drop constraint if exists profili_uloga_check;
alter table profili add constraint profili_uloga_check
  check (uloga in ('direktor','admin','direktor_projektovanja','direktor_izvodjenja','rukovodilac','radnik','spoljni'));
alter table profili drop constraint if exists profili_moduli_uloga_check;
alter table profili add constraint profili_moduli_uloga_check check (
      (uloga <> 'direktor_projektovanja' or moduli = array['projektovanje']::text[])
  and (uloga <> 'direktor_izvodjenja'   or moduli = array['izvodjenje']::text[]));

-- ---------- 2) helperi ----------
create or replace function je_puna_uprava() returns boolean   -- direktor | admin (oba modula)
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profili where user_id = auth.uid() and uloga in ('direktor','admin'));
$$;
create or replace function je_direktor_modula() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profili where user_id = auth.uid() and uloga in ('direktor_projektovanja','direktor_izvodjenja'));
$$;
create or replace function je_direktor() returns boolean   -- UPRAVA (direktor | admin | direktor modula)
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profili where user_id = auth.uid()
                 and uloga in ('direktor','admin','direktor_projektovanja','direktor_izvodjenja'));
$$;
-- je_super() NEPROMENJENO: samo 'direktor' (globalno brisanje, dodela direktorskih uloga)
create or replace function vidi_finansije() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profili where user_id = auth.uid()
                 and (uloga in ('direktor','admin','direktor_projektovanja','direktor_izvodjenja') or vidi_finansije));
$$;
-- moduli naloga: direktor modula → IZ IMENA ULOGE; direktor/admin → oba; ostali → profili.moduli
create or replace function moji_moduli() returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce((select case uloga
                            when 'direktor_projektovanja' then array['projektovanje']::text[]
                            when 'direktor_izvodjenja'    then array['izvodjenje']::text[]
                            when 'direktor' then array['projektovanje','izvodjenje']::text[]
                            when 'admin'    then array['projektovanje','izvodjenje']::text[]
                            else coalesce(moduli, array['projektovanje','izvodjenje']::text[]) end
                   from profili where user_id = auth.uid()),
                  array['projektovanje','izvodjenje']::text[]);
$$;
-- modul (vrednost kolone) dozvoljen nalogu — za INSERT gradilišta, gde red još ne postoji
create or replace function modul_moj(m text) returns boolean
language sql stable security definer set search_path = public as $$
  select je_puna_uprava() or coalesce(m, 'izvodjenje') = any(moji_moduli());
$$;
create or replace function modul_dozvoljen(gid text) returns boolean
language sql stable security definer set search_path = public as $$
  select je_puna_uprava()
      or exists (select 1 from gradilista g where g.id = gid and coalesce(g.modul,'izvodjenje') = any(moji_moduli()));
$$;
create or replace function vodim_gradiliste(gid text) returns boolean
language sql stable security definer set search_path = public as $$
  select (je_direktor() and modul_dozvoljen(gid))
      or (modul_dozvoljen(gid)
          and exists (select 1 from gradilista g where g.id = gid and g.rukovodilac = moj_zaposleni() and moja_uloga() = 'rukovodilac'));
$$;
-- brisanje redova gradilišta: direktor svuda; direktor modula na svom gradilištu (gid null → samo direktor)
create or replace function smem_brisati(gid text) returns boolean
language sql stable security definer set search_path = public as $$
  select je_super() or (je_direktor_modula() and vodim_gradiliste(gid));
$$;
revoke execute on function je_puna_uprava(), je_direktor_modula(), modul_moj(text), smem_brisati(text) from public, anon;
grant  execute on function je_puna_uprava(), je_direktor_modula(), modul_moj(text), smem_brisati(text) to authenticated;

-- ---------- 3) polise sa golim je_direktor()/je_super() nad tabelama sa gradilištem ----------
drop policy if exists p_ins on gradilista;
create policy p_ins on gradilista for insert to authenticated with check (je_direktor() and modul_moj(modul));
drop policy if exists p_del on gradilista;
create policy p_del on gradilista for delete to authenticated using (smem_brisati(id));

drop policy if exists p_del on zadaci;
create policy p_del on zadaci for delete to authenticated using (smem_brisati(gr));

drop policy if exists p_upd on dnevnik;
create policy p_upd on dnevnik for update to authenticated
  using (vodim_gradiliste(gr) or autor = moj_autor()) with check (vodim_gradiliste(gr) or autor = moj_autor());
drop policy if exists p_del on dnevnik;
create policy p_del on dnevnik for delete to authenticated using (smem_brisati(gr) or autor = moj_autor());

drop policy if exists p_del on narudzbe;
create policy p_del on narudzbe for delete to authenticated using (smem_brisati(gr));

drop policy if exists p_ins on predmer;
create policy p_ins on predmer for insert to authenticated
  with check (vodim_gradiliste(gr) and (je_direktor() or gradiliste_je_pro(gr)));
drop policy if exists p_del on predmer;
create policy p_del on predmer for delete to authenticated using (smem_brisati(gr));

drop policy if exists p_ins on troskovi_st;
create policy p_ins on troskovi_st for insert to authenticated with check (je_direktor() and vodim_gradiliste(gr));
drop policy if exists p_upd on troskovi_st;
create policy p_upd on troskovi_st for update to authenticated
  using (je_direktor() and vodim_gradiliste(gr)) with check (je_direktor() and vodim_gradiliste(gr));
drop policy if exists p_del on troskovi_st;
create policy p_del on troskovi_st for delete to authenticated using (smem_brisati(gr));

drop policy if exists p_upd on situacije;
create policy p_upd on situacije for update to authenticated
  using      ((je_direktor() and vodim_gradiliste(gr)) or (vodim_gradiliste(gr) and autor = moj_autor() and status <> 'placeno'))
  with check ((je_direktor() and vodim_gradiliste(gr)) or (vodim_gradiliste(gr) and autor = moj_autor() and status <> 'placeno'));
drop policy if exists p_del on situacije;
create policy p_del on situacije for delete to authenticated using (smem_brisati(gr));

drop policy if exists p_ins on resursi;
create policy p_ins on resursi for insert to authenticated with check (je_direktor() and (gr is null or vodim_gradiliste(gr)));
drop policy if exists p_upd on resursi;
create policy p_upd on resursi for update to authenticated
  using (je_direktor() and (gr is null or vodim_gradiliste(gr))) with check (je_direktor() and (gr is null or vodim_gradiliste(gr)));
drop policy if exists p_del on resursi;
create policy p_del on resursi for delete to authenticated using (smem_brisati(gr));

drop policy if exists p_ins on mag_promene;
create policy p_ins on mag_promene for insert to authenticated
  with check ((je_direktor() and (gr is null or vodim_gradiliste(gr))) or (tip = 'izlaz' and vodim_gradiliste(gr)));
drop policy if exists p_upd on mag_promene;
create policy p_upd on mag_promene for update to authenticated
  using (je_direktor() and (gr is null or vodim_gradiliste(gr))) with check (je_direktor() and (gr is null or vodim_gradiliste(gr)));
drop policy if exists p_del on mag_promene;
create policy p_del on mag_promene for delete to authenticated using (smem_brisati(gr));

drop policy if exists p_upd on rad_na_zadatku;
create policy p_upd on rad_na_zadatku for update to authenticated
  using (vodim_gradiliste(gr) or osoba = moj_autor()) with check (vodim_gradiliste(gr) or osoba = moj_autor());
drop policy if exists p_del on rad_na_zadatku;
create policy p_del on rad_na_zadatku for delete to authenticated using (smem_brisati(gr));

drop policy if exists p_del on zaposleni_gradiliste;
create policy p_del on zaposleni_gradiliste for delete to authenticated using (smem_brisati(gradiliste_id));

drop policy if exists p_upd on podizvodjac_gradiliste;
create policy p_upd on podizvodjac_gradiliste for update to authenticated
  using (vodim_gradiliste(gradiliste_id)) with check (vodim_gradiliste(gradiliste_id));
drop policy if exists p_del on podizvodjac_gradiliste;
create policy p_del on podizvodjac_gradiliste for delete to authenticated using (smem_brisati(gradiliste_id));

drop policy if exists p_upd on dokumenti;
create policy p_upd on dokumenti for update to authenticated
  using (vodim_gradiliste(gr) or autor_uid = auth.uid()) with check (vodim_gradiliste(gr) or autor_uid = auth.uid());
drop policy if exists p_del on dokumenti;
create policy p_del on dokumenti for delete to authenticated using (smem_brisati(gr) or autor_uid = auth.uid());

-- ---------- 4) RPC-ovi ----------
create or replace function obrisi_gradiliste(p_gid text) returns void
language plpgsql security definer set search_path = public, auth as $$
declare ja text; naz text;
begin
  if not smem_brisati(p_gid) then raise exception 'Gradilište briše direktor (ili direktor modula na svom gradilištu).'; end if;
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

create or replace function angazovanost(p_od date default (current_date - 30), p_do date default current_date)
returns table (osoba text, gr text, sesija bigint, minuta bigint, poslednji timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not je_direktor() then raise exception 'Samo uprava vidi angažovanost.'; end if;
  return query
    select r.osoba, r.gr, count(*)::bigint,
           coalesce(sum(coalesce(r.minuta, greatest(0, floor(extract(epoch from (now() - r.start)) / 60))::int)),0)::bigint,
           max(coalesce(r.kraj, r.start))
    from rad_na_zadatku r
    where r.start::date between p_od and p_do and modul_dozvoljen(r.gr)   -- direktor modula: samo svoj modul
    group by r.osoba, r.gr order by r.osoba, r.gr;
end $$;

create or replace function dodeli_ulogu(p_email text, p_uloga text, p_zaposleni_id text default null,
                                        p_vidi_finansije boolean default false, p_saradnik_id text default null,
                                        p_moduli text[] default null)
returns text language plpgsql security definer set search_path = public, auth as $$
declare uid uuid; stara text; stari_mods text[]; ja text; zid text; sid text; fin boolean; mods text[];
        direktorske constant text[] := array['direktor','direktor_projektovanja','direktor_izvodjenja'];
begin
  if not je_direktor() then raise exception 'Samo uprava dodeljuje uloge.'; end if;
  select id into uid from auth.users where lower(email) = lower(p_email);
  if uid is null then
    raise exception 'Nema naloga %. Napravi ga prvo u Supabase → Authentication → Users (Add user), pa ponovi.', p_email;
  end if;
  if uid = auth.uid() then raise exception 'Sopstvenu ulogu ne možeš da menjaš — zamoli drugog direktora.'; end if;
  if p_uloga not in ('direktor','admin','direktor_projektovanja','direktor_izvodjenja','rukovodilac','radnik','spoljni') then
    raise exception 'Nepoznata uloga: %', p_uloga;
  end if;
  select uloga, moduli into stara, stari_mods from profili where user_id = uid;
  -- direktorske uloge dodeljuje i menja SAMO direktor (admin i direktor modula ne)
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
  -- direktor modula: samo rukovodioci i radnici SVOG modula; ne dira naloge drugog modula ni uprave
  if je_direktor_modula() then
    if p_uloga not in ('rukovodilac','radnik') or not (mods <@ moji_moduli()) then
      raise exception 'Direktor modula dodeljuje samo rukovodioce i radnike svog modula (%).', (moji_moduli())[1];
    end if;
    if stara is not null and (stara not in ('rukovodilac','radnik') or not (coalesce(stari_mods, array['projektovanje','izvodjenje']::text[]) <@ moji_moduli())) then
      raise exception 'Ovaj nalog ne pripada tvom modulu — menja ga direktor.';
    end if;
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
declare uid uuid; stara text; stari_mods text[]; ja text;
begin
  if not je_direktor() then raise exception 'Samo uprava uklanja pristup.'; end if;
  select id into uid from auth.users where lower(email) = lower(p_email);
  if uid is null then raise exception 'Nema naloga %.', p_email; end if;
  if uid = auth.uid() then raise exception 'Sopstveni pristup ne možeš da ukloniš.'; end if;
  select uloga, moduli into stara, stari_mods from profili where user_id = uid;
  if stara is null then return; end if;
  if stara in ('direktor','direktor_projektovanja','direktor_izvodjenja') and moja_uloga() <> 'direktor' then
    raise exception 'Samo direktor može da ukloni direktorsku ulogu.';
  end if;
  if je_direktor_modula() and (stara not in ('rukovodilac','radnik') or not (coalesce(stari_mods, array['projektovanje','izvodjenje']::text[]) <@ moji_moduli())) then
    raise exception 'Direktor modula uklanja samo rukovodioce i radnike svog modula.';
  end if;
  if stara = 'direktor' and (select count(*) from profili where uloga = 'direktor') <= 1 then
    raise exception 'Ovo je poslednji direktor.';
  end if;
  delete from profili where user_id = uid;
  select email into ja from auth.users where id = auth.uid();
  insert into log_koriscenja (user_id, email, uloga, dogadjaj, detalj)
    values (auth.uid(), ja, moja_uloga(), 'pristup_uklonjen', jsonb_build_object('email', lower(p_email), 'stara', stara));
end $$;
