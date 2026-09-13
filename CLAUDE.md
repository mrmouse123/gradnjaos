# GradnjaOS — kontekst projekta za Claude Code

## Šta je ovo
Pilot PM alat za građevinsku firmu (klijent u fazi requirements/assessment).
Ceo alat je JEDAN fajl: `index.html` (vanilla JS, bez build koraka) — namerno,
radi brzine iteracija dok se zahtevi ne slegnu. Jezik UI-ja: srpski (latinica).

## Arhitektura
- `index.html`: CSS + HTML ljuska + sav JS u jednom <script> bloku
- Storage adapter (troslojni): Supabase (konstante SUPABASE_URL/SUPABASE_ANON_KEY
  u bloku "KONFIGURACIJA ZA DEPLOYMENT", trenutno PRAZNE — namerno) →
  window.storage → memorija. Debounced upsert 400ms. `pushAll` seed-uje demo pri praznoj bazi.
- `supabase/schema.sql` = kompletna šema za SVEŽU bazu (13 tabela);
  `migracija-01..08.sql` samo za postojeće baze.
- Render: svaki pogled je `viewX()` funkcija koja vraća HTML string; `render()`
  ubacuje u #main. Globalno stanje: ROLE (simulacija uloge), MODUL/PODTIP, current (tab).

## Ključni domeni (redosled u kodu)
moduli (projektovanje | izvodjenje→visoko/nisko), gradilišta (+adm, nivo, površina, nadzor),
zaposleni (grs[] više projekata, bivsi[] istorija), zadaci (kanban), dnevnik, situacije (naplata),
narudzbe (UI: "Trebovanje", mailto na NABAVKA_EMAIL), troskovi_st (izvor za potroseno(g)),
podizvodjaci (UI u Projektovanju: "Spoljni saradnici"), predmer (i "Specifikacija usluga" za
projektovanje; NIVOI_DOK šablon: IDR/IDP-PGD/PZI auto-popuna), resursi (istek → upozorenja),
magacin + mag_promene, izveštaji (openIzvestaj=za investitora bez finansija,
openPresek=interni sa finansijama, openKumulativ=izvedene količine).

## Pravila koja NE kršiti
1. Rukovodilac NIKAD ne vidi: marže, cene, jedinične cene, naplatu, kumulativ,
   tabove Klijenti/Naplata. Direktor (ROLE==='all') vidi sve.
2. SVAKA mutirajuća funkcija ima role-guard na početku (ne samo sakriveno dugme) —
   to je priprema za Supabase Auth + RLS.
3. Svi korisnički unosi kroz esc() pre upisa u DATA ili HTML.
4. izračunate vrednosti: potroseno(g) iz troskovi_st stavki (fallback g.potroseno),
   naplSum(g) iz situacija — ne uvoditi paralelne izvore istine.

## Lekcije (vidi tasks/lessons.md — OBAVEZNO pročitati pre izmena)
- U fajlu postoje mesta sa LITERALNIM \uXXXX sekvencama u JS stringovima —
  replace sa pravim karakterima ih ne nalazi. Grep pre svake zamene.
- Svaki search-replace mora imati assert/proveru da je cilj nađen.
- Upis fajla: temp fajl pa atomic rename (fajl je jednom truncate-ovan).

## Testiranje (nema test framework — namerno)
Node e2e simulacija: izvuci <script> sadržaj, eval uz stub document/window
(vidi obrasce u tasks/todo.md istoriji). Posle SVAKE izmene minimalno:
- sintaksa: new Function(script)
- pogledi × uloge × moduli bez exceptiona
- th==td simetrija tabela; guardovi (poziv mutacije kao rukovodilac)

## Sledeće (dogovoreno, čeka)
- [ ] Supabase povezivanje (klijent još u requirements fazi — NE povezivati dok Jovan ne kaže)
- [ ] Potom: Supabase Auth + RLS po ulogama (user_id + uloga kolone), zamena ROLE simulacije
- [ ] Edge Function za pravo slanje mejla trebovanja (sad mailto)
- [ ] Uvoz faktura kao PDF + .xlsx upload (Supabase Storage)
- [ ] Šabloni faza/zadataka za Izvođenje (visoko/nisko) — čekaju Jovanove materijale
- [ ] PDF dokumenta uz šablone (pilot: repo folder; kasnije Storage)

## Deployment
GitHub Desktop → GitHub Pages. Novi fajl preko starog → commit → push.
Na iPhone testirati preko live URL-a (uz ?v=N protiv keša), NE kroz Files preview.
