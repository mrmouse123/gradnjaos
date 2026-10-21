-- ============================================================
-- Migracija 30 (2026-10-22), nalaz pregleda: `profili` SELECT je bio `user_id = auth.uid() or je_direktor()`, a je_direktor()
--   od migracije 27 obuhvata i direktore modula — oni su tako kroz PostgREST čitali sve profile (uloge, moduli, zastavice)
--   iako im je migracija 28 ukinula Admin kokpit. Sada: svoj red ILI puna uprava (direktor/admin). nalozi_pregled je
--   definer, klijent čita samo svoj red — ništa se ne menja za legitimne tokove. Idempotentna.
-- ============================================================
drop policy if exists p_sel on profili;
create policy p_sel on profili for select to authenticated using (user_id = auth.uid() or je_puna_uprava());
