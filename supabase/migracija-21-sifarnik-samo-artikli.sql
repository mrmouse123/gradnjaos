-- ============================================================
-- Migracija 21 (2026-10-11): sifarnik Izvodjenja = SAMO artikli (81, ELOM, migracija 19) + Razno (slobodne stavke u formi);
--   24 "pozicije radova" (sf-i-*, migracija 14) se brisu (odluka klijenta). Usluge uprava dodaje u sifarnik rucno.
--   Projektovanje NEMA sifarnik u UI: sveske su tipovi dokumentacije (IDR / IDP-PGD / PZI + poddokumenti);
--   redovi sf-p-* ostaju u tabeli kao izvor cek-liste pri kreiranju gradilista, ali se ne prikazuju u sifarniku.
-- Idempotentna.
-- ============================================================
delete from sifrarnik where id like 'sf-i-%';
