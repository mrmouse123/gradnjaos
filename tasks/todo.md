# GradnjaOS — v0.5: sređivanje koda + preostale funkcije

Radi se po boris-cherny workflow-u. Mreža za sigurnost: `git` (baseline commit `cda1f50`)
i `test/e2e.js` (448 asertacija na startu).

## Faza 0 — infrastruktura (gotovo)
- [x] git init + baseline commit (fajl je 189KB, lessons.md beleži tihe promašaje patch-eva)
- [x] `test/e2e.js` + `test/dom-stub.js` — trajni e2e harness umesto ad-hoc skripti
      pokriva: sintaksu, boot, 12 pogleda × 3 uloge × 5 modula, th==td simetriju,
      role-guardove, finansijsku izolaciju, XSS, integritet TABLES/DEMO/normalize

## Faza 1 — bezbednost i ispravnost ("sredi kod")
- [ ] **B1 (visoko)** Pravilo 3 iz CLAUDE.md ne važi: ~10 save-funkcija ne escapuje
      slobodna tekst-polja → stored XSS. Uzrok: svaka funkcija ima svoj `v()` helper
      i esc() se dodaje ručno. Fix: zajednički `polje()` koji escapuje po difoltu
      + `broj()`/`izbor()` za brojeve i selecte. Jedno mesto umesto 60.
- [ ] **B2 (srednje)** Duplo escapovanje kvari podatke na ne-HTML izlazima:
      `Petrović & Sinovi` → `Petrović &amp; Sinovi` u CSV izvozu i mailto trebovanju.
      Fix: `unesc()` na tim izlazima (HTML izlazi ostaju escapovani).
- [ ] **B3** Supabase sync briše samo lokalno: `pushAll` radi upsert, nikad delete →
      obrisan red se vraća pri sledećem load-u. Fix: delete po diff-u.
- [ ] **B4** Rezultati dubinske revizije (podagenti: logika, sync sloj, uloge/RLS)

## Faza 2 — preostale funkcije iz CLAUDE.md
- [ ] **F1** Šabloni faza/zadataka po modulu (visoko/nisko/projektovanje).
      Mehanizam + podrazumevani sadržaj iz standardne prakse; Jovan kasnije koriguje.
- [ ] **F2** Edge Function za slanje trebovanja mejlom (kod kompletan; deploy čeka Supabase)
- [ ] **F3** Prilozi: PDF faktura / .xlsx uz stavke (Supabase Storage + fallback na
      data-URL dok baza nije povezana)
- [ ] **F4** Auth + RLS: SQL migracija 09 (user_id, uloga, policies) + prekidač u app-u.
      Aktivira se tek kad se popune SUPABASE_URL/ANON_KEY.

## Faza 3 — nastavak sređivanja
- [ ] Mrtav kod, duplirana logika, konzistentnost izračunatih vrednosti
- [ ] Ažuriranje CLAUDE.md (e2e komanda, nove konvencije)

## BLOKIRANO — treba mi od Jovana
- **Supabase URL + anon ključ** — bez toga F2/F3/F4 mogu da se napišu i testiraju,
  ali ne i da se puste u rad. CLAUDE.md ionako kaže "ne povezivati dok Jovan ne kaže".
- **Materijali za šablone faza** (F1) — implementiram razuman default, on koriguje.

## Review
(popunjava se na kraju)
