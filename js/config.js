/* ============================================================
   STANJE + ČUVANJE
   ============================================================ */
/* ============================================================
   KONFIGURACIJA ZA DEPLOYMENT (Supabase)
   1) U Supabase konzoli: SQL Editor -> pokreni supabase/schema.sql
   2) Settings -> API -> kopiraj "Project URL" i "anon public" kljuc
   3) Nalepi ih ispod. Ako ostane prazno, app radi u demo rezimu.
   ============================================================ */
const NABAVKA_EMAIL = 'nabavka@firma.rs'; // <- promeni na pravi mejl sluzbe nabavke
const SUPABASE_URL = 'https://xqggoxrihitvqaocowlb.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhxZ2dveHJpaGl0dnFhb2Nvd2xiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkzNzAxMDMsImV4cCI6MjEwNDk0NjEwM30.1z5U3lNRbtol6ugnrR6IV7CqcEUN9MBfyfZiH2Vu7g8';

