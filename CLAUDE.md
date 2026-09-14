# GradnjaOS — kontekst projekta za Claude Code

## Šta je ovo
Pilot PM alat za građevinsku firmu (klijent u fazi requirements/assessment).
Ceo alat je JEDAN fajl: `index.html` (vanilla JS, bez build koraka) — namerno,
radi brzine iteracija dok se zahtevi ne slegnu. Jezik UI-ja: srpski (latinica).

## Arhitektura
- `index.html`: CSS + HTML ljuska + sav JS u jednom <script> bloku
- Storage adapter (troslojni): Supabase (konstante SUPABASE_URL/SUPABASE_ANON_KEY
  u bloku "KONFIGURACIJA ZA DEPLOYMENT", trenutno PRAZNE — namerno) →
  window.storage → memorija. `saveState()` debounce 400ms → `doSave()` (guard
  protiv preklapanja + `saveErr` vidljiv u footeru), flush na pagehide/
  visibilitychange. `pushAll` seed-uje demo pri praznoj bazi (proverava SVE
  tabele, ne samo gradilišta) i ne prekida se na prvoj grešci. Brisanje reda je
  eksplicitno (`obrisiRed(tabela,id)`), ne diff — `pushAll` i dalje samo upsertuje.
- `supabase/schema.sql` = kompletna šema za SVEŽU bazu (13 tabela);
  `migracija-01..09.sql` samo za postojeće baze.
- `supabase/functions/posalji-trebovanje/`: Edge Function (Deno + Resend) za
  pravo slanje mejla trebovanja. Neaktivna dok nije deploy-ovana i dok
  RESEND_API_KEY nije podešen — do tada `posaljiMejlNabavci()` tiho pada na
  mailto (isto ponašanje kao danas).
- Render: svaki pogled je `viewX()` funkcija koja vraća HTML string; `render()`
  ubacuje u #main. Globalno stanje: ROLE (simulacija uloge), MODUL/PODTIP, current (tab).

## Ključni domeni (redosled u kodu)
moduli (projektovanje | izvodjenje→visoko/nisko), gradilišta (+adm, nivo, površina, nadzor),
zaposleni (grs[] više projekata, bivsi[] istorija), zadaci (kanban), dnevnik, situacije (naplata),
narudzbe (UI: "Trebovanje", mailto/Edge Function na NABAVKA_EMAIL), troskovi_st (izvor za
potroseno(g); opciono `prilog` = faktura kao PDF/slika, data-URL u pilotu),
podizvodjaci (UI u Projektovanju: "Spoljni saradnici"), predmer (i "Specifikacija usluga" za
projektovanje; NIVOI_DOK šablon: IDR/IDP-PGD/PZI auto-popuna; SABLONI_FAZA šablon za
Izvođenje: 8 faza × zadaci po tipu visoko/niskogradnja, `primeniSablonFaza()`), resursi
(istek → upozorenja), magacin + mag_promene, izveštaji (openIzvestaj=za investitora bez
finansija, openPresek=interni sa finansijama, openKumulativ=izvedene količine).

## Pravila koja NE kršiti
1. Rukovodilac NIKAD ne vidi: marže, cene, jedinične cene, naplatu, kumulativ,
   tabove Klijenti/Naplata. Direktor (ROLE==='all') vidi sve.
2. SVAKA mutirajuća I čitajuća funkcija koja prima `grId` spolja ima na početku
   `smemNa(grId)` (ili ekvivalentnu proveru) — funkcije su globalne, sakriveno
   dugme nije zaštita. To je priprema za Supabase Auth + RLS.
3. Svi korisnički unosi kroz `esc()` pre upisa u DATA (escape-on-write, ne
   escape-on-render — 800+ mesta u kodu se oslanja na to da je DATA već čist).
   Izlazi koji NISU HTML (CSV, telo mejla, ime fajla) moraju ići kroz `unesc()`
   pre slanja — inače `Petrović & Sinovi` postane `Petrović &amp; Sinovi`.
4. Brojevi iz korisničkog unosa (posebno paste-iz-Excela i "izvedeno") idu kroz
   zajednički `broj()` (srpski zapis `1.234,50` i engleski `1234.50`/`12.5`) —
   ne `+String(x).replace(',','.')` ad-hoc, to je pravilo pre revizije v0.5 lomilo
   hiljade i decimale naizmenično.
5. izračunate vrednosti: potroseno(g) iz troskovi_st stavki (fallback g.potroseno),
   naplSum(g) iz situacija — ne uvoditi paralelne izvore istine.
6. Datum polje koje se svuda čita kao `dParse(x.rok)`/`daysBetween(...)` (npr.
   zadatak.rok, gradilište.pocetak/rok) NE SME dobiti `null` kao default kad je
   input prazan — default na smislen datum (isti kao u samoj formi). Jedini
   legitimno null-safe datum je `resursi.istice` (ima namenski sentinel u
   `resIstice()`). Prazan string (`''`) ne sme ići u Postgres `date` kolonu ni
   pod kojim uslovima — Postgres to odbija (22007) i ranije je tiho obarao
   upis svih tabela iza te u nizu `TABLES`.

## Lekcije (vidi tasks/lessons.md — OBAVEZNO pročitati pre izmena)
9 lekcija u ovom trenutku; najvažnije za svaku izmenu:
- U fajlu postoje mesta sa LITERALNIM \uXXXX sekvencama u JS stringovima —
  replace sa pravim karakterima ih ne nalazi. Grep pre svake zamene.
- Svaki search-replace mora imati assert/proveru da je cilj nađen
  (`test/patch-lib.js` — `Patcher` klasa, koristi je umesto ručnog sed/replace).
- Upis fajla: temp fajl pa atomic rename (fajl je jednom truncate-ovan).
- Bezbednosni nalaz se dokazuje IZVRŠAVANJEM kroz pravi put upisa (formu), ne
  čitanjem regexa nad izvorom — dva različita "audita" su prijavila lažne
  nalaze dok test nije zaista pozvao `save*()` kroz popunjenu formu.
- `esc()` ne escapuje `=` ni `()` — detektor XSS-a u testu traži neescapovan
  `<`, ne string payload-a doslovno.

## Testiranje
`node test/e2e.js` — 500+ asertacija, bez spoljnog test framework-a (namerno).
Sastavni delovi:
- `test/dom-stub.js` — minimalan DOM (dovoljan da <script> proradi u Node-u)
- `test/patch-lib.js` — `Patcher` klasa za bezbedne izmene (replace+assert+atomic write)
- `test/supabase-mock.js` — mock Supabase klijent (select/upsert/delete +
  `functions.invoke()`), sa `faults` za simulaciju grešaka
Pokriva: sintaksu, boot, pogledi × uloge × moduli, th==td simetriju tabela,
role-guardove, VLASNIŠTVO nad gradilištem (ne samo ulogu — v. pravilo 2), XSS
kroz stvarne forme (ne direktan upis u DATA), integritet TABLES/DEMO/normalize,
Supabase sync (prazna/puna baza, greške, reset, brisanje), Edge Function
fallback lanac. Posle SVAKE izmene: `node test/e2e.js` mora vratiti 0.

## Sledeće (dogovoreno, čeka)
- [ ] Supabase povezivanje (klijent još u requirements fazi — NE povezivati dok Jovan ne kaže)
- [ ] Potom: Supabase Auth + RLS po ulogama (user_id + uloga kolone), zamena ROLE simulacije.
      `smemNa(grId)` je već izdvojen kao jedina tačka za pravilo vlasništva —
      RLS policy treba da izrazi isto pravilo na serveru, kod ostaje kao UI guard.
      NAPOMENA: `zaposleni.grs`/`podizvodjaci.grs` (array kolone) se ne mogu
      ograničiti RLS-om po gradilištu — trebaće join tabele ako se ide do kraja.
- [x] Edge Function za pravo slanje mejla trebovanja — kod gotov
      (`supabase/functions/posalji-trebovanje/`), čeka deploy + RESEND_API_KEY
- [ ] .xlsx binarni upload (Supabase Storage) — svesno odloženo, paste-iz-Excela
      (`savePredmerImport`) već pokriva praktičnu potrebu bez dodatne biblioteke
- [x] Uvoz faktura kao PDF uz stavke troška — gotovo (`uploadTrosakPrilog`,
      data-URL u pilotu, 2.5MB limit, isti obrazac kao `uploadAdmDoc`)
- [x] Šabloni faza/zadataka za Izvođenje (visoko/nisko) — gotovo
      (`SABLONI_FAZA`), sadržaj je standardna praksa; Jovan koriguje kad ima vremena
- [ ] PDF dokumenta uz šablone (pilot: repo folder; kasnije Storage)

## Otvorena pitanja za Jovana (nisu bagovi, traže odluku)
- `zdravlje(g)` daje različit skor direktoru i rukovodiocu za isti projekat
  (finansijski penali su unutar `canFinance()`) — da li je to namerno ili treba
  jedan objektivan skor + sakriveno finansijsko obrazloženje?
- "Marža" na kontrolnoj tabli/karticama je uvek PLANSKA (`budzet-troskovi`),
  nikad ostvarena (`budzet-potroseno(g)`) — samo `openPresek` je eksplicitno
  označava kao "Planirana marža". Preimenovati svuda ili dodati i ostvarenu?
- `formTim` nudi SVE zaposlene firme rukovodiocu (ne samo nezauzete) — da li
  sme da doda na svoje gradilište osobu koja je već na tuđem?

## Deployment
GitHub Desktop → GitHub Pages. Novi fajl preko starog → commit → push.
Na iPhone testirati preko live URL-a (uz ?v=N protiv keša), NE kroz Files preview.
