-- ============================================================
-- Migracija 12 (2026-10-04): Nalozi i log koriscenja
--   * nalozi_pregled()  — direktor vidi sve naloge (profili + auth.users: email,
--                         poslednja prijava) = i spisak uloga i log prijava
--   * dodeli_ulogu()    — direktor iz aplikacije dodeljuje/menja ulogu POSTOJECEM
--                         auth korisniku (kreiranje korisnika ostaje u dashboardu)
--   * ukloni_pristup()  — direktor skida profil (nalog ostaje, vidi nula podataka)
--   * log_koriscenja    — append-only log (prijava, odjava, otvaranje, cuvanje,
--                         uloga_promena, pristup_uklonjen); cita samo direktor
-- Idempotentna. Pravila: sopstveni nalog se ne menja; poslednji direktor se ne skida.
-- ============================================================

create table if not exists log_koriscenja (
  id        bigserial primary key,
  ts        timestamptz not null default now(),
  user_id   uuid default auth.uid(),
  email     text,
  uloga     text,
  dogadjaj  text not null,          -- prijava | odjava | otvaranje | cuvanje | uloga_promena | pristup_uklonjen
  detalj    jsonb default '{}'
);
create index if not exists log_koriscenja_ts on log_koriscenja (ts desc);
alter table log_koriscenja enable row level security;
drop policy if exists p_sel on log_koriscenja;
drop policy if exists p_ins on log_koriscenja;
create policy p_sel on log_koriscenja for select to authenticated using (je_direktor());
create policy p_ins on log_koriscenja for insert to authenticated with check (user_id = auth.uid());
revoke all on log_koriscenja from anon;
grant select, insert on log_koriscenja to authenticated;
grant usage, select on sequence log_koriscenja_id_seq to authenticated;

-- Pregled naloga: profili + auth.users (email, poslednja prijava). Samo direktor.
create or replace function nalozi_pregled()
returns table (user_id uuid, email text, uloga text, zaposleni_id text, ime text,
               kreiran timestamptz, poslednja_prijava timestamptz, bez_profila boolean)
language plpgsql stable security definer set search_path = public, auth as $$
begin
  if not je_direktor() then raise exception 'Samo direktor vidi naloge.'; end if;
  return query
    select u.id, u.email::text, p.uloga, p.zaposleni_id, p.ime,
           u.created_at, u.last_sign_in_at, (p.user_id is null) as bez_profila
    from auth.users u
    left join profili p on p.user_id = u.id
    order by (p.user_id is null), u.email;
end $$;
revoke execute on function nalozi_pregled() from public, anon;
grant  execute on function nalozi_pregled() to authenticated;

-- Dodela/izmena uloge postojecem auth korisniku. Samo direktor; ne sebi.
create or replace function dodeli_ulogu(p_email text, p_uloga text, p_zaposleni_id text default null)
returns text language plpgsql security definer set search_path = public, auth as $$
declare uid uuid; stara text; ja text;
begin
  if not je_direktor() then raise exception 'Samo direktor dodeljuje uloge.'; end if;
  select id into uid from auth.users where lower(email) = lower(p_email);
  if uid is null then
    raise exception 'Nema naloga %. Napravi ga prvo u Supabase → Authentication → Users (Add user), pa ponovi.', p_email;
  end if;
  if uid = auth.uid() then raise exception 'Sopstvenu ulogu ne možeš da menjaš — zamoli drugog direktora.'; end if;
  if p_uloga not in ('direktor','rukovodilac') then raise exception 'Nepoznata uloga: %', p_uloga; end if;
  if p_uloga = 'rukovodilac' and (p_zaposleni_id is null or not exists (select 1 from zaposleni where id = p_zaposleni_id)) then
    raise exception 'Rukovodilac mora biti vezan za postojećeg zaposlenog.';
  end if;
  if p_uloga = 'direktor' then p_zaposleni_id := null; end if;
  select uloga into stara from profili where user_id = uid;
  if stara = 'direktor' and p_uloga <> 'direktor' and (select count(*) from profili where uloga = 'direktor') <= 1 then
    raise exception 'Ovo je poslednji direktor — prvo dodeli ulogu direktora nekom drugom.';
  end if;
  insert into profili (user_id, zaposleni_id, uloga, ime)
    values (uid, p_zaposleni_id, p_uloga, coalesce((select z.ime from zaposleni z where z.id = p_zaposleni_id), p_email))
    on conflict (user_id) do update
      set zaposleni_id = excluded.zaposleni_id, uloga = excluded.uloga, ime = excluded.ime;
  select email into ja from auth.users where id = auth.uid();
  insert into log_koriscenja (user_id, email, uloga, dogadjaj, detalj)
    values (auth.uid(), ja, 'direktor', 'uloga_promena',
            jsonb_build_object('email', lower(p_email), 'stara', stara, 'nova', p_uloga, 'zaposleni_id', p_zaposleni_id));
  return case when stara is null then 'dodeljeno' else 'izmenjeno' end;
end $$;
revoke execute on function dodeli_ulogu(text, text, text) from public, anon;
grant  execute on function dodeli_ulogu(text, text, text) to authenticated;

-- Skidanje pristupa: profil se brise, auth nalog ostaje (vidi nula podataka). Ne sebi, ne poslednjem direktoru.
create or replace function ukloni_pristup(p_email text)
returns void language plpgsql security definer set search_path = public, auth as $$
declare uid uuid; stara text; ja text;
begin
  if not je_direktor() then raise exception 'Samo direktor uklanja pristup.'; end if;
  select id into uid from auth.users where lower(email) = lower(p_email);
  if uid is null then raise exception 'Nema naloga %.', p_email; end if;
  if uid = auth.uid() then raise exception 'Sopstveni pristup ne možeš da ukloniš.'; end if;
  select uloga into stara from profili where user_id = uid;
  if stara is null then return; end if;
  if stara = 'direktor' and (select count(*) from profili where uloga = 'direktor') <= 1 then
    raise exception 'Ovo je poslednji direktor.';
  end if;
  delete from profili where user_id = uid;
  select email into ja from auth.users where id = auth.uid();
  insert into log_koriscenja (user_id, email, uloga, dogadjaj, detalj)
    values (auth.uid(), ja, 'direktor', 'pristup_uklonjen', jsonb_build_object('email', lower(p_email), 'stara', stara));
end $$;
revoke execute on function ukloni_pristup(text) from public, anon;
grant  execute on function ukloni_pristup(text) to authenticated;
