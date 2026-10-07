-- ============================================================
-- Migracija 15 (2026-10-08): merenje rada na zadatku (tajmer) + angazovanost
--   rad_na_zadatku: sesije rada — radnik/spoljni/rukovodilac na SVOM zadatku stisne
--   "Pocni" (start) i "Zavrsi" (kraj); minuta se racuna na serveru pri zatvaranju.
--   Vidi: ko vidi gradiliste. Pise: samo osoba sama (osoba = moj_autor()) ili uprava.
--   Svaki start/kraj ide i u log_koriscenja (klijent: zadatak_start / zadatak_kraj).
--   angazovanost(od, do): uprava — sati po osobi i gradilistu + zaduzeni resursi.
-- Idempotentna.
-- ============================================================
create table if not exists rad_na_zadatku (
  id        text primary key,
  zadatak   text not null,
  gr        text not null,
  osoba     text not null,                  -- zaposleni.id | podizvodjaci.id
  start     timestamptz not null default now(),
  kraj      timestamptz,
  minuta    int,
  napomena  text
);
create index if not exists rad_na_zadatku_osoba on rad_na_zadatku (osoba, start desc);
create index if not exists rad_na_zadatku_zadatak on rad_na_zadatku (zadatak);
alter table rad_na_zadatku enable row level security;
drop policy if exists p_sel on rad_na_zadatku; drop policy if exists p_ins on rad_na_zadatku;
drop policy if exists p_upd on rad_na_zadatku; drop policy if exists p_del on rad_na_zadatku;
create policy p_sel on rad_na_zadatku for select to authenticated using (moje_gradiliste(gr));
create policy p_ins on rad_na_zadatku for insert to authenticated with check (moje_gradiliste(gr) and (je_direktor() or osoba = moj_autor()));
create policy p_upd on rad_na_zadatku for update to authenticated using (je_direktor() or osoba = moj_autor()) with check (je_direktor() or osoba = moj_autor());
create policy p_del on rad_na_zadatku for delete to authenticated using (je_super());
revoke all on rad_na_zadatku from anon;
grant select, insert, update, delete on rad_na_zadatku to authenticated;

-- minuta se racuna na serveru kad se upise kraj (klijent ne moze da "doda" sate)
create or replace function rad_minuta() returns trigger language plpgsql as $$
begin
  if new.kraj is not null then
    if new.kraj < new.start then new.kraj := new.start; end if;
    new.minuta := greatest(0, floor(extract(epoch from (new.kraj - new.start)) / 60))::int;
  else
    new.minuta := null;
  end if;
  return new;
end $$;
drop trigger if exists trg_rad_minuta on rad_na_zadatku;
create trigger trg_rad_minuta before insert or update on rad_na_zadatku
  for each row execute function rad_minuta();

-- Angazovanost (uprava): sati po osobi i gradilistu u periodu
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
    where r.start::date between p_od and p_do
    group by r.osoba, r.gr order by r.osoba, r.gr;
end $$;
revoke execute on function angazovanost(date, date) from public, anon;
grant  execute on function angazovanost(date, date) to authenticated;
