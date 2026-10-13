-- ============================================================
-- Migracija 25 (2026-10-13): PREGLED SITUACIJA (odluka klijenta): rukovodilac sacuva situaciju → "na pregledu";
--   uprava (direktor/admin) je ODOBRI ili VRATI rukovodiocu uz komentar; rukovodilac vracenu ispravi i posalje
--   ponovo (vracena → na_pregledu). Odobrena je zakljucana za ne-upravu (zaglavlje i stavke).
--   Istorija odluka je SERVERSKA: trigger upisuje pregledao/pregledano/istorija pri svakoj promeni `pregled`
--   (klijent sta god posalje — prepisuje se). Postojece situacije = 'odobrena' (default = backfill).
--   Tek odobrena situacija ulazi u naplatu (valuta/kasni/placeno) i u "Ugovoreno vs situacije" — klijent.
--   preracunaj_situacije (kumulativ, razlika, iznos) i dalje racuna SVE situacije (dokument u nizu i dok ceka).
-- Idempotentna.
-- ============================================================
alter table situacije
  add column if not exists pregled    text not null default 'odobrena',
  add column if not exists komentar   text,
  add column if not exists pregledao  text,
  add column if not exists pregledano timestamptz,
  add column if not exists istorija   jsonb not null default '[]'::jsonb;
alter table situacije drop constraint if exists situacije_pregled_chk;
alter table situacije add constraint situacije_pregled_chk check (pregled in ('na_pregledu','odobrena','vracena'));
grant select (pregled, komentar, pregledao, pregledano, istorija) on situacije to authenticated;

drop view if exists situacije_v;
create view situacije_v with (security_barrier = true) as
  select id, gr, br, opis, izdato, valuta, status, vrsta, autor, napomena, pregled, komentar, pregledao, pregledano, istorija,
         case when vidi_finansije() then iznos end as iznos
  from situacije where vodim_gradiliste(gr) or (vidi_finansije() and moje_gradiliste(gr));
revoke all on situacije_v from public, anon; grant select on situacije_v to authenticated;

create or replace function zastiti_kolone_situacije() returns trigger language plpgsql as $$
begin
  if pg_trigger_depth() > 1 then return new; end if;   -- preracunaj_situacije (server) sme da upise iznos
  if tg_op = 'INSERT' then
    if not je_direktor() then
      new.iznos := 0; new.status := 'ceka'; new.autor := moj_autor();
      new.pregled := 'na_pregledu'; new.komentar := null; new.pregledao := null; new.pregledano := null; new.istorija := '[]'::jsonb;
    end if;
    if new.autor is null then new.autor := 'direkcija'; end if;
    if new.pregled is null then new.pregled := case when je_direktor() then 'odobrena' else 'na_pregledu' end; end if;
    if je_direktor() and new.pregled = 'odobrena' then new.pregledao := coalesce(moj_autor(), 'direkcija'); new.pregledano := now(); end if;
    return new;
  end if;
  new.pregledao := old.pregledao; new.pregledano := old.pregledano; new.istorija := old.istorija;   -- istoriju pise SAMO server (ispod), za svaku ulogu
  if not je_direktor() then
    new.iznos := old.iznos; new.status := old.status; new.gr := old.gr; new.autor := old.autor;
    new.komentar := old.komentar;
    if old.pregled = 'odobrena' then
      if new.pregled is distinct from old.pregled
         or row(new.br, new.opis, new.izdato, new.valuta, new.vrsta, new.napomena) is distinct from row(old.br, old.opis, old.izdato, old.valuta, old.vrsta, old.napomena) then
        raise exception 'Odobrena situacija se ne menja (samo uprava).';
      end if;
    elsif new.pregled is distinct from old.pregled and not (old.pregled = 'vracena' and new.pregled = 'na_pregledu') then
      raise exception 'Rukovodilac može samo da vraćenu situaciju pošalje ponovo na pregled.';
    end if;
  end if;
  if new.pregled is distinct from old.pregled then
    new.pregledao := coalesce(moj_autor(), 'direkcija'); new.pregledano := now();
    new.istorija := coalesce(old.istorija, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
      'kad', now(), 'ko', new.pregledao, 'odluka', new.pregled,
      'komentar', case when new.pregled = 'na_pregledu' then null else new.komentar end));
  end if;
  return new;
end $$;

-- stavke odobrene situacije ne-uprava ne dira (insert/update/delete); server (preracunaj, depth>1) i SQL editor prolaze
create or replace function zastiti_stavke_situacije() returns trigger language plpgsql security definer set search_path = public as $$
declare p text;
begin
  if pg_trigger_depth() > 1 or auth.uid() is null or je_direktor() then return coalesce(new, old); end if;
  select pregled into p from situacije where id = coalesce(new.sit, old.sit);
  if p = 'odobrena' then raise exception 'Stavke odobrene situacije se ne menjaju (samo uprava).'; end if;
  return coalesce(new, old);
end $$;
drop trigger if exists trg_zastiti_stavke on situacija_stavke;
create trigger trg_zastiti_stavke before insert or update or delete on situacija_stavke
  for each row execute function zastiti_stavke_situacije();
