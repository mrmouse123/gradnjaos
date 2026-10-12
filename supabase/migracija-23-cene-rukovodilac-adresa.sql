-- ============================================================
-- Migracija 23 (2026-10-12), odluke klijenta:
--   1) Jedinicne cene (predmer.cena) vidi i SVAKI rukovodilac na svom gradilistu IZVODJENJA (bez zastavice
--      vidi_finansije). Cene i dalje "fiksira" uprava: trigger zastiti_kolone_predmer ne-upravi ne dozvoljava
--      promenu cene (nepromenjen). Budzet/troskovi/naplata/iznos situacije ostaju iza vidi_finansije().
--   2) gradilista.adresa (ulica i broj) — nova kolona, u gradilista_v, zasticena za ne-upravu kao i lok.
-- Idempotentna.
-- ============================================================
drop view if exists predmer_v;
create view predmer_v with (security_barrier = true) as
  select id, gr, poz, jm, kol, izv, zaduzen, sifra,
         case when vidi_finansije() or (vodim_gradiliste(gr) and not gradiliste_je_pro(gr)) then cena end as cena
  from predmer where moje_gradiliste(gr);
revoke all on predmer_v from public, anon; grant select on predmer_v to authenticated;

alter table gradilista add column if not exists adresa text;
drop view if exists gradilista_v;
create view gradilista_v with (security_barrier = true) as
  select id, naziv, modul, tip, lok, adresa, klijent, rukovodilac, pocetak, rok, napredak, status, faza,
         povrsina, nivo, nadzor, adm,
         case when vidi_finansije() then budzet    end as budzet,
         case when vidi_finansije() then troskovi  end as troskovi,
         case when vidi_finansije() then potroseno end as potroseno,
         case when vidi_finansije() then naplaceno end as naplaceno
  from gradilista where moje_gradiliste(id);
revoke all on gradilista_v from public, anon; grant select on gradilista_v to authenticated;

create or replace function zastiti_kolone_gradilista() returns trigger language plpgsql as $$
begin
  if auth.uid() is not null and not je_direktor() then
    new.naziv := old.naziv; new.modul := old.modul; new.tip := old.tip; new.lok := old.lok; new.adresa := old.adresa;
    new.klijent := old.klijent; new.rukovodilac := old.rukovodilac; new.pocetak := old.pocetak;
    new.rok := old.rok; new.povrsina := old.povrsina; new.nivo := old.nivo; new.nadzor := old.nadzor;
    new.adm := old.adm; new.budzet := old.budzet; new.troskovi := old.troskovi;
    new.potroseno := old.potroseno; new.naplaceno := old.naplaceno;
    -- dozvoljeno: napredak, status, faza
  end if;
  return new;
end $$;
