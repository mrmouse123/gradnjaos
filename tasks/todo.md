# GradnjaOS — v0.5: sređivanje koda + preostale funkcije

Radi se po boris-cherny workflow-u. Mreža za sigurnost: `git` (baseline commit `cda1f50`)
i `test/e2e.js` (506 asertacija u ovom trenutku, raste sa svakim nalazom).

## Faza 0 — infrastruktura (gotovo)
- [x] git init + baseline commit
- [x] `test/e2e.js` + `test/dom-stub.js` + `test/patch-lib.js` + `test/supabase-mock.js`
      — trajni harness: sintaksa, boot, pogledi × uloge × moduli, th==td simetrija,
      role-guardovi, vlasništvo nad gradilištem, finansijska izolacija, XSS kroz
      stvarne forme, integritet TABLES/DEMO/normalize, Supabase sync (mock klijent)

## Faza 1 — bezbednost i ispravnost ("sredi kod") — GOTOVO
- [x] **B1** Pravilo 3 (esc() na upisu) — proveren kroz sve forme, važio je već;
      popravljeno kvarenje na NE-HTML izlazima (CSV, mailto) — v. B2
- [x] **B2** `unesc()` na CSV izvozu, telu mejla trebovanja i imenu fajla —
      `Petrović & Sinovi` se više ne pretvara u `Petrović &amp; Sinovi`
- [x] **B3** Sloj čuvanja: 6 bugova (pushAll je stao na prvoj grešci i tiho
      nije upisivao ostatak baze; prazan `<input type=date>` slao `''` u date
      kolonu; "prvi start" se detektovao samo po tabeli gradilišta; doSave bez
      guarda protiv preklapanja; resetDemo brisao pre nego što zna da upis prolazi;
      nema flush na zatvaranje taba) — sve popravljeno + `obrisiRed()` kao
      eksplicitna operacija (pushAll i dalje ne brише automatski)
- [x] **B4** Pravilo 2 (vlasništvo): 4 rupe visokog rizika (saveTask, saveDiary,
      dropTask, saveMagPromena nisu proveravali da je gradilište/tip poznat ili
      "moje") + 6 curenja tuđih gradilišta kroz globalne funkcije (openSite,
      openIzvestaj, posaljiMejlNabavci, openEmpPage, viewPay/viewClients pozvani
      direktno, upozorenja i tab Resursi). Uveden `smemNa(grId)` kao jedno mesto
      za pravilo — tačka izmene kad dođe Supabase RLS.
- [x] **B5** Logička ispravnost (12 nalaza): marzaPct/fmtEurK kod budžeta 0 i
      negativnih iznosa; rušenje prikaza na nepoznatog autora / jednočlano ime;
      parsiranje brojeva iz Excel uvoza (srpski vs engleski zapis) — uveden
      zajednički `broj()`; setIzv bez gornje granice i bez podrške za zarez;
      jutarnji brif ignorisao filter modula; magacin stanje kao string; ID-evi
      u serijama kovali buduće Date.now() vrednosti; TODAY zamrznut na učitavanju;
      renderNav izbacivao iz Predmera; mrtav kod i dupliran normalizeData() blok.

## Faza 2 — preostale funkcije iz CLAUDE.md
- [x] **F1** Šabloni faza/zadataka za Izvođenje (visoko/nisko) — `SABLONI_FAZA`,
      sejanje pri kreiranju gradilišta (checkbox u formi) i naknadno iz fioke
      (dugme "Ubaci šablon faza", nestaje čim gradilište ima bilo koji zadatak).
      Rokovi raspoređeni proporcionalno unutar [početak, rok] gradilišta.
      Sadržaj je standardna građevinska praksa — Jovan koriguje kad stignu materijali.
- [ ] **F2** Edge Function za slanje trebovanja mejlom (kod kompletan; deploy čeka Supabase)
- [ ] **F3** Prilozi: PDF faktura / .xlsx uz stavke (Supabase Storage + fallback na
      data-URL dok baza nije povezana)
- [ ] **F4** Auth + RLS: SQL migracija 09 (user_id, uloga, policies) + prekidač u app-u.
      Aktivira se tek kad se popune SUPABASE_URL/ANON_KEY.

## Faza 3 — nastavak sređivanja
- [ ] Preostali niski nalazi iz revizije (N-serija) koji nisu bezbednosni ni
      korupcija podataka — proceniti da li vrede diranja u ovoj iteraciji
- [ ] Ažuriranje CLAUDE.md (e2e komanda, `smemNa`/`broj`/`unesc` konvencije, SABLONI_FAZA)

## BLOKIRANO — treba mi od Jovana
- **Supabase URL + anon ključ** — F2/F3/F4 su napisani i testirani (mock), ali
  ne mogu da se puste u rad. CLAUDE.md ionako kaže "ne povezivati dok Jovan ne kaže".
- **Materijali za šablone faza** (F1) — ugrađen razuman default; Jovan koriguje
  nazive faza/zadataka kad ima vremena, mehanizam ostaje isti.

## Review
(popunjava se na kraju iteracije)
