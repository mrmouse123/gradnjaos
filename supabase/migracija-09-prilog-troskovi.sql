-- ============================================================
-- Migracija 09: prilog uz stavku troška (faktura kao PDF/slika)
-- Samo za baze koje već postoje (nova baza dobija ovo iz schema.sql).
-- ============================================================
alter table troskovi_st add column if not exists prilog jsonb;
-- {name, datum, data} — data-URL u pilotu, do Supabase Storage faze (v. CLAUDE.md)
