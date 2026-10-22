-- migracija 31 (2026-10-22): automatska pauza zaboravljenog tajmera (zahtev klijenta: „ako radnik projektovanja
-- zaboravi pauzu/kraj, zadatak se sam pauzira u 16:00 — da nemamo zadatke od jako puno sati").
--
-- PRAVILO (isto u klijentu: AUTO_PAUZA_SAT / granicaAutoPauze — menjati oba):
--   granica sesije = 16:00 po Beogradu na dan pocetka; ako je sesija pocela u 16:00 ili kasnije, granica je ponoc
--   tog dana (rad posle 16 h se belezi, ali zaboravljen tajmer ne prelazi u sutra). Sesija koja je otvorena, a granica
--   je prosla, dobija kraj = granica (minuta racuna trigger rad_minuta). Server je JEDINI koji zatvara — klijent takvu
--   sesiju samo PRIKAZUJE kao zatvorenu (sesijaOtvorena/minSesije) i nista ne salje.
-- ZASTITA: zatvorena sesija ima nepromenljiv `kraj` (trigger) — inace bi zaboravljeni tab, kad korisnik sutra klikne
--   „Pauziraj“ na ustajalom DATA, poslao kraj = sad i vratio bas te sate koje auto-pauza skida.
-- RASPORED: pg_cron svakih 15 min (UTC; 16:00 Beograd je 14 ili 15 UTC zavisno od letnjeg vremena — minuta ne zavise
--   od trenutka pokretanja, jer je kraj uvek = granica). Ekstenzija je ukljucena migracijom 31a (create extension pg_cron).
-- LOG: svaka auto-pauza upisuje `zadatak_pauza` u log_koriscenja sa auto:true, razlog:'16:00' (user_id iz profila
--   osobe; 'uprava' nema profil po osobi -> null), istog oblika kao klijentov zapis pa ga „Nalozi i log“ prikazuje.

-- 1) zatvorena sesija: kraj se ne menja (minuta se i dalje racuna iz kraj-start)
create or replace function rad_minuta() returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' and old.kraj is not null and new.kraj is distinct from old.kraj then
    new.kraj := old.kraj;   -- zatvorena sesija je konacna (auto-pauza ne sme da bude pregazena ustajalim klijentom)
  end if;
  if new.kraj is not null then
    if new.kraj < new.start then new.kraj := new.start; end if;
    new.minuta := greatest(0, floor(extract(epoch from (new.kraj - new.start)) / 60))::int;
  else
    new.minuta := null;
  end if;
  return new;
end $$;
-- trigger trg_rad_minuta (before insert or update) vec postoji i zove ovu funkciju

-- 2) granica auto-pauze za dati pocetak (16:00 Beograd na dan pocetka, inace ponoc)
create or replace function granica_auto_pauze(p_start timestamptz) returns timestamptz
language sql immutable as $$
  select case when g <= p_start then ((d + 1)::timestamp at time zone 'Europe/Belgrade') else g end
  from (select (p_start at time zone 'Europe/Belgrade')::date as d) x,
       lateral (select (x.d + time '16:00') at time zone 'Europe/Belgrade' as g) y
$$;

-- 3) zatvaranje svih otvorenih sesija kojima je granica prosla (idempotentno; vraca broj zatvorenih)
create or replace function auto_pauza_tajmera() returns integer
language plpgsql security definer set search_path = public, auth as $$
declare r record; n integer := 0; uid uuid; z record;
begin
  for r in select s.* from rad_na_zadatku s where s.kraj is null and now() >= granica_auto_pauze(s.start)
           for update skip locked
  loop
    update rad_na_zadatku
       set kraj = greatest(start, granica_auto_pauze(start)),
           napomena = trim(both ' ' from coalesce(napomena,'') || ' [auto-pauza 16:00]')
     where id = r.id;
    select t.naziv, t.opis into z from zadaci t where t.id = r.zadatak;
    select p.user_id into uid from profili p where p.zaposleni_id = r.osoba limit 1;
    insert into log_koriscenja (user_id, email, uloga, dogadjaj, detalj)
    values (uid,
            (select u.email from auth.users u where u.id = uid),
            (select p.uloga from profili p where p.user_id = uid),
            'zadatak_pauza',
            jsonb_build_object('zadatak', r.zadatak, 'naziv', coalesce(z.naziv, r.zadatak), 'opis', coalesce(z.opis,''),
                               'gr', r.gr, 'osoba', r.osoba,
                               'minuta', (select minuta from rad_na_zadatku where id = r.id),
                               'auto', true, 'razlog', '16:00'));
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function auto_pauza_tajmera() from public, anon, authenticated;
revoke execute on function granica_auto_pauze(timestamptz) from public, anon;

-- 4) raspored: svakih 15 minuta
do $$
begin
  if exists (select 1 from cron.job where jobname = 'auto-pauza-tajmera') then
    perform cron.unschedule('auto-pauza-tajmera');
  end if;
  perform cron.schedule('auto-pauza-tajmera', '*/15 * * * *', $job$ select public.auto_pauza_tajmera(); $job$);
end $$;
