-- ============================================================
-- Migracija 22 (2026-10-12): dokument uz svesku (Projektovanje — odluka klijenta: fioka projektantskog gradilista
--   nema tim ni listu zadataka, nego tipove dokumentacije (sveske = redovi predmera) PO OSOBI, sa dodelom osobe i
--   ucitavanjem dokumenata uz svaku svesku). dokumenti.predmer_id (FK → predmer, on delete set null) + view.
--   Tim projektantskog gradilista se izvodi iz dodela: ko je zaduzen za svesku, klijent ga upise u
--   zaposleni_gradiliste / podizvodjac_gradiliste (polisa insert = vodim_gradiliste) — inace radnik ne vidi gradiliste.
-- Idempotentna.
-- ============================================================
alter table dokumenti add column if not exists predmer_id text references predmer(id) on delete set null;
create index if not exists dokumenti_predmer on dokumenti (predmer_id);
grant select (predmer_id) on dokumenti to authenticated;

drop view if exists dokumenti_v;
create view dokumenti_v with (security_barrier = true) as
  select id, gr, autor, autor_uid, datum, naziv, tip, velicina, opis, predmer_id from dokumenti where moje_gradiliste(gr);
revoke all on dokumenti_v from public, anon; grant select on dokumenti_v to authenticated;
