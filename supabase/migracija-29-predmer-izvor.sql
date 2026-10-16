-- ============================================================
-- Migracija 29 (2026-10-16), zahtev klijenta: izvoz privremene/okončane situacije u investitorskom Excel šablonu
--   (latinica i ćirilica). Šablon traži list po vrsti radova, sekcije („4.0 ДЕМОНТАЖНИ РАДОВИ") sa međuzbirom,
--   naslov nadpozicije („4.0.1 Демонтажа постојећих…") iznad stavki i rekapitulaciju — ništa od toga nije u ravnom
--   predmeru. Zato `predmer.izvor jsonb` = snimak iz uvezenog fajla: {list, sekcija, nadpoz, cir}
--   (cir = originalni ćirilični tekst stavke; `poz` je latiničan od migracije „ćirilica → latinica").
--   Ne-finansijska kolona: SELECT grant + u predmer_v; ne-uprava je ne menja (trigger). Idempotentna.
-- ============================================================
alter table predmer add column if not exists izvor jsonb;
grant select (izvor) on predmer to authenticated;

create or replace view predmer_v as
  select id, gr, poz, jm, kol, izv, zaduzen, sifra,
         case when vidi_finansije() or (vodim_gradiliste(gr) and not gradiliste_je_pro(gr)) then cena else null end as cena,
         izvor   -- nova kolona MORA na kraj: create or replace view ne menja redosled postojećih kolona
  from predmer where moje_gradiliste(gr);
revoke all on predmer_v from public, anon; grant select on predmer_v to authenticated;

create or replace function zastiti_kolone_predmer() returns trigger
language plpgsql as $$
begin
  if auth.uid() is not null and not je_direktor() then
    new.gr := old.gr; new.cena := old.cena; new.izvor := old.izvor;
    if not gradiliste_je_pro(old.gr) then
      new.poz := old.poz; new.jm := old.jm; new.kol := old.kol; new.zaduzen := old.zaduzen; new.sifra := old.sifra;
    end if;
  end if;
  return new;
end $$;
