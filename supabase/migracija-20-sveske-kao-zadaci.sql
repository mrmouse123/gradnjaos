-- ============================================================
-- Migracija 20 (2026-10-11): Projektovanje — sveske (+ razno) iz specifikacije SU zadaci (odluka klijenta)
--   zadaci.predmer_id → svaka stavka specifikacije (sveska) ima zadatak dodeljen coveku (zaduzen);
--   covek na njemu klikne play/pauza/stop (rad_na_zadatku). Klijent ih sinhronizuje
--   (sinhronizujSveske), server prati: zadatak u 'done' → predmer.izv = kol (sveska predata),
--   povratak iz 'done' → izv = 0 ako je bila puna; napredak se preracuna (osvezi_napredak).
--   Rukovodilac (vodim) sme da DODA stavku specifikacije na projektantskom gradilistu i da joj
--   menja poz/jm/kol/zaduzen/sifra (ne cenu). Izvodjenje: nepromenjeno (bez zadataka; predmer
--   samo uprava). Idempotentna.
-- ============================================================
alter table zadaci add column if not exists predmer_id text references predmer(id) on delete cascade;
create index if not exists zadaci_predmer_idx on zadaci(predmer_id);

-- predmer: insert i za rukovodioca projektantskog gradilista
create or replace function gradiliste_je_pro(gid text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from gradilista g where g.id = gid and coalesce(g.modul,'izvodjenje') = 'projektovanje');
$$;
revoke execute on function gradiliste_je_pro(text) from public, anon;
drop policy if exists p_ins on predmer;
create policy p_ins on predmer for insert to authenticated
  with check (je_direktor() or (vodim_gradiliste(gr) and gradiliste_je_pro(gr)));

create or replace function zastiti_kolone_predmer() returns trigger language plpgsql as $$
begin
  if auth.uid() is not null and not je_direktor() then
    new.gr := old.gr; new.cena := old.cena;
    if not gradiliste_je_pro(old.gr) then
      new.poz := old.poz; new.jm := old.jm; new.kol := old.kol; new.zaduzen := old.zaduzen; new.sifra := old.sifra;
      -- izvodjenje: dozvoljeno samo izv
    end if;
    -- projektovanje: rukovodilac (vodim) menja poz/jm/kol/zaduzen/sifra/izv
  end if;
  return new;
end $$;
drop trigger if exists trg_zastiti_predmer on predmer;
create trigger trg_zastiti_predmer before update on predmer
  for each row execute function zastiti_kolone_predmer();

-- zadatak sveske → izvedeno sveske (definer: radnik ne sme direktno u predmer)
create or replace function trg_zadatak_sveska_izv() returns trigger language plpgsql security definer set search_path = public as $$
declare k numeric; i numeric;
begin
  if pg_trigger_depth() > 1 or new.predmer_id is null then return null; end if;
  if tg_op = 'UPDATE' and new.kol is not distinct from old.kol then return null; end if;
  select kol, coalesce(izv,0) into k, i from predmer where id = new.predmer_id;
  if k is null then return null; end if;
  if new.kol = 'done' then
    update predmer set izv = k where id = new.predmer_id and coalesce(izv,0) is distinct from k;
  elsif tg_op = 'UPDATE' and old.kol = 'done' and i >= k and k > 0 then
    update predmer set izv = 0 where id = new.predmer_id;
  end if;
  perform osvezi_napredak(new.gr);
  return null;
end $$;
drop trigger if exists trg_zadatak_sveska_izv on zadaci;
create trigger trg_zadatak_sveska_izv after insert or update of kol on zadaci
  for each row execute function trg_zadatak_sveska_izv();
