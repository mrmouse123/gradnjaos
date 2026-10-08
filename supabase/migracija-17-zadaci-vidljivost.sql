-- ============================================================
-- Migracija 17 (2026-10-08): vidljivost zadataka po ulozi (odluka klijenta)
--   uprava: svi; rukovodilac: svi zadaci svojih gradilista (i svojih radnika);
--   radnik/spoljni: SAMO svoji zadaci (zad = moj_autor()) na svojim gradilistima.
-- Klijent isto: zadaciVidljivi(). Idempotentna.
-- ============================================================
drop policy if exists p_sel on zadaci;
create policy p_sel on zadaci for select to authenticated
  using (vodim_gradiliste(gr) or (moje_gradiliste(gr) and zad = moj_autor()));
