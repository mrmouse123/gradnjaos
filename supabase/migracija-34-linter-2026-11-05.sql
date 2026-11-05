-- migracija 34 (2026-11-05): nalazi Supabase Security Advisor-a.
--   1) "Security Definer View" za gradilista_v/predmer_v/podizvodjaci_v/situacije_v/dokumenti_v je PO DIZAJNU (F4b, migracija 11):
--      view radi kao vlasnik da bi mogao da čita finansijske kolone koje nemaju SELECT grant, a SAM ponavlja filter redova
--      (moje_gradiliste/vodim_gradiliste) i maskira finansije (CASE vidi_finansije()). security_invoker bi ne-upravi dao
--      "permission denied" na kolonu. Nalaz se NE ispravlja — u dashboardu se označi kao prihvaćen. Jedino predmer_v nije imao
--      security_barrier kao ostali (sprečava da se "curenje" kroz korisničke funkcije u WHERE izvrši pre filtera) → dodato.
--   2) "Function Search Path Mutable": 8 funkcija bez fiksnog search_path → set search_path = public.
--   3) "Public/Signed-in can execute SECURITY DEFINER function": trigger-funkcije i osvezi_napredak nemaju šta da rade preko
--      /rest/v1/rpc → EXECUTE oduzet od public/anon/authenticated. Trigeri i dalje rade (privilegija se proverava samo pri
--      CREATE TRIGGER; probа kao Petar: update predmer/gradilista/situacije prolazi). Helperi (je_direktor, moje_gradiliste…)
--      i RPC-ovi sa sopstvenim guardom ostaju dostupni authenticated — to je namerno.
alter view predmer_v set (security_barrier = true);

alter function danas_bg() set search_path = public;
alter function granica_auto_pauze(timestamptz) set search_path = public;
alter function rad_minuta() set search_path = public;
alter function zastiti_kolone_gradilista() set search_path = public;
alter function zastiti_kolone_magacin() set search_path = public;
alter function zastiti_kolone_predmer() set search_path = public;
alter function zastiti_kolone_situacije() set search_path = public;
alter function zastiti_kolone_zadaci() set search_path = public;

revoke execute on function
  trg_predmer_napredak(), trg_predmer_preracun_sit(), trg_situacije_preracun(), trg_stavke_preracun(),
  trg_zadatak_sveska_izv(), zastiti_stavke_situacije(), rad_minuta(),
  zastiti_kolone_gradilista(), zastiti_kolone_magacin(), zastiti_kolone_predmer(), zastiti_kolone_situacije(), zastiti_kolone_zadaci(),
  osvezi_napredak(text)
from public, anon, authenticated;
