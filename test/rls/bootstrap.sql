-- Minimalni stub Supabase okruzenja za goli Postgres: ono sto schema.sql pretpostavlja da vec postoji.
-- Ne zamenjuje Supabase (nema GoTrue, PostgREST, Storage) — dovoljno je za proveru RLS-a, grantova, view-ova i trigera.
-- Idempotentno: pocinje od cistog public/auth/cron, pa se moze pustiti vise puta nad istom bazom.
drop schema if exists public cascade;
drop schema if exists auth cascade;
drop schema if exists cron cascade;
create schema public;

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;

-- Supabase po defaultu daje anon/authenticated sve nad novim objektima u public; schema.sql zato eksplicitno ukida (revoke).
-- Bez ovoga testovi bi propustili revoke koji u produkciji stvarno nesto radi.
grant usage on schema public to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on functions to anon, authenticated, service_role;

create schema auth;
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  created_at timestamptz default now(),
  last_sign_in_at timestamptz
);
grant usage on schema auth to anon, authenticated, service_role;
-- isto kao Supabase: sub iz JWT claim-ova (request.jwt.claims JSON ili stariji request.jwt.claim.sub)
create function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid
$$;

-- pg_cron nije u golom Postgresu: prazan cron sa istim potpisima koje schema.sql koristi
create schema cron;
create table cron.job (jobid bigserial primary key, jobname text, schedule text, command text);
create function cron.schedule(p_name text, p_schedule text, p_command text) returns bigint language sql as $$
  insert into cron.job (jobname, schedule, command) values (p_name, p_schedule, p_command) returning jobid
$$;
create function cron.unschedule(p_name text) returns boolean language sql as $$
  delete from cron.job where jobname = p_name returning true
$$;
