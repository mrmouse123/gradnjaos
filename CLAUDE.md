# GradnjaOS — kontekst projekta za Claude Code

## Šta je ovo
Pilot PM alat za građevinsku firmu (klijent u fazi requirements/assessment).
Ceo alat je JEDAN fajl: `index.html` (vanilla JS, bez build koraka) — namerno,
radi brzine iteracija dok se zahtevi ne slegnu. Jezik UI-ja: srpski (latinica).

## Arhitektura
- `index.html`: CSS + HTML ljuska + sav JS u jednom <script> bloku
- **Supabase** (od 2026-09-14): projekat `gradnjaos`, ref `xqggoxrihitvqaocowlb`,
  org "jovan.miskovic@think-tech.co's Org", eu-central-1, **Pro plan** (od
  2026-10-08: ne pauzira se, dnevni backup 7 dana; ranije besplatan, v. lessons #10).
  Konstante SUPABASE_URL/SUPABASE_ANON_KEY u bloku "KONFIGURACIJA ZA DEPLOYMENT".
  Anon ključ u fajlu je NORMALAN Supabase model — zaštita je RLS, ne tajnost ključa.
- **Auth + RLS** (od 2026-09-23, F4): bez prijave = nula pristupa (anon nema
  nijednu polisu). Uloga dolazi iz tabele `profili` (user_id → uloga +
  zaposleni_id), ne iz menija. `initAuth()` → `PROFIL`/`SESIJA` → `ROLE`.
  Direktor zadržava meni "Pogled kao" (čisto UI simulacija — server mu ionako
  daje sve). Rukovodilac nema meni, `setRole()` ga ignoriše. Demo/memorija
  režim (prazne konstante) radi kao pre: bez prijave, sa menijem.
  Polise na serveru izražavaju ISTO pravilo kao `smemNa(grId)`: direktor sve,
  rukovodilac samo redove gradilišta gde je on `rukovodilac`. Helperi
  (`je_direktor`, `moj_zaposleni`, `moje_gradiliste`…) su `security definer`.
- **Join tabele**: `zaposleni.grs[]`/`bivsi[]` i `podizvodjaci.grs[]` NE postoje
  više u bazi (niz se ne može ograničiti RLS-om) — žive kao
  `zaposleni_gradiliste(zaposleni_id, gradiliste_id, aktivan)` (aktivan=true
  → grs, false → bivsi) i `podizvodjac_gradiliste`. U JS modelu nizovi
  OSTAJU (30+ mesta): `spojiJoinTabele()` ih izvodi pri učitavanju,
  `rowsZa()` ih pretvara nazad pri čuvanju.
- **Čuvanje = DIFF po redu**: `zapamtiSnapshot(DATA)` posle učitavanja;
  `pushAll()` šalje samo redove čiji se JSON promenio (`PUSHED[t][kljuc]`).
  Nikad "cela baza": pod RLS-om rukovodilac ne sme ni da pokuša upsert tuđih
  redova, a base64 prilozi ne idu na svaki klik. `saveState()` debounce 400ms
  → `doSave()` (guard protiv preklapanja, `saveErr` u footeru), flush na
  pagehide/visibilitychange. Brisanje reda je eksplicitno (`obrisiRed`).
  Seed demo podataka i `resetDemo()` — samo direktor.
- **Finansije van dometa rukovodioca i na nivou API-ja** (od 2026-09-23, F4b,
  migracija 11): `troskovi_st`/`situacije` čita samo direktor; finansijske
  KOLONE (`gradilista.budzet/troskovi/potroseno/naplaceno`, `predmer.cena`,
  `podizvodjaci.cena`) nemaju SELECT grant ni za koga preko API-ja — klijent
  ČITA kroz `gradilista_v`/`predmer_v`/`podizvodjaci_v` (`CITAJ_IZ`; view kao
  vlasnik, isti filter redova kao RLS, finansije `CASE je_direktor()`), a PIŠE
  u tabele. Zdravlje: rukovodilac ga dobija sa servera (`zdravlja_mojih()` RPC
  → `ZDR_SRV`, ista formula kao `zdravlje(g)`; osvežava se posle svakog
  čuvanja), direktor računa lokalno. Trigeri: ne-direktor menja samo
  napredak/status/faza, `predmer.izv`, `magacin.stanje` — šta god pošalje.
  `pushAll`: POSTOJEĆI red → `update().eq(id)`, NOV → `insert`; upsert samo za
  seed/reset (`opt.sve`). Razlog: upsert = INSERT…ON CONFLICT, a INSERT WITH
  CHECK `je_direktor()` obara rukovodiočev upsert i kad je red njegov.
- **Nalozi i log korišćenja** (od 2026-10-04, migracija 12): tab „Nalozi i log" (samo
  direktor, `dirOnly`, `viewNalozi` vraća ostale na dash). RPC-ovi `security definer` sa
  sopstvenim guardom: `nalozi_pregled()` (profili ⋈ auth.users: email, poslednja prijava,
  bez_profila), `dodeli_ulogu(email, uloga, zaposleni_id)` (POSTOJEĆEM auth nalogu; ne
  sebi; ne poslednjem direktoru), `ukloni_pristup(email)` (briše profil, nalog ostaje).
  Kreiranje korisnika i dalje u dashboardu (Add user) — pozivnice/magic link čekaju Site
  URL + odluku o self-signupu. Tabela `log_koriscenja` je **append-only i VAN
  `PUSH_TABLES`/`DATA`** (izuzetak od pravila 8, kao `profili`): RLS insert = svoj red,
  select = direktor. Klijent piše fire-and-forget `beleziLog()` (nikad ne dira `saveErr`):
  `otvaranje` (verzija, uređaj) posle `initAuth`, `prijava` (pre reload-a), `odjava` (PRE
  `signOut` — posle njega RLS odbija), `cuvanje` (`pushAll` vraća tabela→broj redova).
  Server sam piše `uloga_promena` / `pristup_uklonjen`. `ULOGE` konstanta = check
  constraint na `profili.uloga` — proširiti na oba mesta kad stignu admin/zaposleni.
  Provereno `set local role`: rukovodilac → RPC raise, log select 0, insert svog reda OK;
  direktor → lista, sebi odbijeno, uklanjanje + log. Mock: `rpc` sve tri + `limit()`,
  insert u `log_koriscenja` se loguje kao `op:'log'` (ne `upsert`). T28.
- **Invarijante po temi** (detalji, istorija i T-brojevi u `docs/beleske-funkcija.md` — pročitati pasus teme PRE izmene):
  - *Excel čitanje/pisanje:* `.xlsx` se čita i piše U BROWSERU bez biblioteke (`zipCitaj`/`citajXlsx`, `napraviXlsx`). Čitanje
    konvertuje ćirilicu u latinicu (`cir2lat`) i daje `red.list` + `red.izvorno`; `.xls` se ne čita. Pisač: ćelija = primitiv ili
    `{v, f, s}` (formula uz keširanu vrednost, stil); tekst iz DATA ide `unesc` PRE `xmlEsc`; dupli naziv lista dobija ` (2)`.
  - *Izvedeno iz Excela:* `primeniIzvedeno` menja SAMO `predmer.izv`; uparivanje po `normPoz` (oba pisma).
  - *Predmer iz šablona / situacija iz Excela:* `upariPredmerSablon` (stavka = JM+kol+cena iza JM; sekcija = naslov velikim slovima
    osim ako odmah iza ide stavka bez šifre → nadpoz) puni `predmer.izvor` {list, sekcija, nadpoz, cir} u originalnom pismu;
    `upariSituaciju` puni ovu situaciju kao kumulativ − dosadašnje.
  - *Situacije sa stavkama:* `situacije.iznos` je FIN kolona (klijent čita `situacije_v`); kumulativ/razlika/iznos računa server
    `preracunaj_situacije`, klijent `preracunajSituacijeLokalno` ISTO, mock isto — formula na TRI mesta. Količine situacije NE
    pišu `predmer.izv`. Samo ODOBRENA situacija (`pregledSit`) ulazi u naplatu, KPI „izdato", `realizacijaSituacija`.
  - *Pregled situacija:* `pregled ∈ {na_pregledu, odobrena, vracena}`; istoriju piše SAMO server (trigeri); ne-uprava: insert →
    na_pregledu, sme samo vracena→na_pregledu, odobrenu ne dira.
  - *Izvoz situacije (Excel za investitora):* `izvozSituacije(sitId,'lat'|'cir')`, `smemIzvozSituacije` = vidimGr ∧ imaNaplatu ∧
    (canFinance ∨ vidimCene) — JEDINI izuzetak gde rukovodilac bez finansija dobija iznose (odluka 2026-10-16). Kumulativ je
    serverov; prethodne = kumulativ − ova; stavke bez sekcije ulaze u UKUPNO lista (`bezSek`); naslovi `SIT_H` su literalni.
  - *Zdravlje:* penali na TRI mesta (`zdravlje(g)`, server `zdravlje_gradilista`, opis u `aiSistem`); Izvođenje ima i drugu meru
    „Ugovoreno vs situacije" (`realizacijaSituacija`, samo canFinance, samo Izvođenje). Marže NEMA nigde (T17 čuva reč).
  - *Projektovanje:* nema situacija ni naplate (`imaNaplatu`), nema šifarnika u UI, nema `nivo` u formi; sveske SU zadaci
    (`zadaci.predmer_id`, `sinhronizujSveske`, tim izveden iz dodela `osigurajUTimu`); ček-lista svezaka + Razno pri kreiranju;
    fioka = „Dokumentacija po osobi"; tajmer samo ovde, play na jednom zadatku, svoja sesija uvek može da se zaustavi.
  - *Izvođenje:* zadataka NEMA (`zadatakPro`), šifarnik = 81 artikal ELOM + Razno; magacin = šifarnik + Razno, red artikla nastaje
    na prvom ulazu (`'mg-'+id`), render NIKAD ne gura virtuelne redove u DATA; trebovanje iz ugovorenog predmera (`NAR_PM` mapa).
  - *Dokumenti:* `dokumenti.data` bez select granta → `dokumenti_v` + `dokument_podaci(id)`; brisanje = server PRVO pa lokalno.
  - *Adresa:* `gradilista.adresa` je u view-u, trigeru, formi, fioci, izveštajima i mejlu.
  - *Validacija id-jeva (2026-10-22):* `ocistiIdeve(DATA)` na početku `normalizeData` izbacuje red čiji id/FK (`ID_POLJA` +
    `ID_POLJA_TABELE`) nije `[A-Za-z0-9_.:|-]{1,80}` — id-jevi idu sirovi u `onclick="…('${id}')"`, pa je ovo brana od stored XSS
    kroz REST mimo app-a. `osoba` je id SAMO u `rad_na_zadatku` (u klijentima/podizvođačima je ime). T60.
  - *AI asistent (samo direktor):* Edge Function `ai-asistent` je tanki posrednik (ključ u secretu, kapija `profili.uloga='direktor'`),
    alati rade U KLIJENTU nad DATA (`aiIzvrsiAlat`, `aiBezModula`), model NIŠTA ne upisuje, tekst modela se `esc`-uje, keširanje
    prompta (`aiTelo`), log `ai_pitanje` bez sadržaja; UI = plutajuće dugme + panel (`renderAi` iz `render()`).
- `supabase/schema.sql` = kompletna šema za SVEŽU bazu (13 + 3 tabele, 5 view-ova,
  helperi, polise, trigeri, `povezi_profil`). Postojeća baza: `migracija-01..30.sql` redom.
- `supabase/functions/posalji-trebovanje/`: Edge Function (Deno + Resend) za
  pravo slanje mejla trebovanja. Neaktivna dok nije deploy-ovana — do tada
  `posaljiMejlNabavci()` tiho pada na mailto.
- **Brzina učitavanja** (2026-09-24): `loadState` učitava svih 16 tabela
  PARALELNO (`Promise.all`) — serijski je bilo ~200 ms × 16 = 2,7 s po prijavi,
  sad ~200 ms. Provera verzije (HEAD) ide paralelno sa Supabase bibliotekom;
  `<link rel=preconnect/preload>` za CDN, bazu i fontove; fontovi asinhrono
  (`media=print onload`); `#view` odmah dobija „Učitavam…". Nikad ne dodavati
  `await` u petlju preko tabela — merenje: `performance.getEntriesByType('resource')`
  filtrirano na supabase.co.
- **supabase-js je PINOVAN + SRI** (od 2026-10-03): `@2.117.2/dist/umd/supabase.js`
  sa `integrity=sha384-…` i `crossorigin=anonymous` na OBA mesta (`<link preload>`
  u head-u i `sc.src` u `initSupa`) — razlika = preload se ne iskoristi. Bump:
  promeni verziju na oba mesta, `curl -s <url> | openssl dgst -sha384 -binary |
  openssl base64 -A` za novi hash. Ne koristiti goli `@2` URL (jsDelivr tu
  servira generisan fajl i sam upozorava „ne SRI"). Ako biblioteka ne može da
  se učita, a baza je podešena, app je **zatvoren** (`prikaziGreskuUcitavanja`,
  dugme „Pokušaj ponovo") — ne pada u demo režim. `proveriNovuVerziju` ima
  4 s timeout i čuva `location.hash` (magic link).
- Render: svaki pogled je `viewX()` funkcija koja vraća HTML string; `render()`
  ubacuje u #main. Globalno stanje: ROLE, MODUL/PODTIP, current (tab), PROFIL.

## Valuta (odluka klijenta 2026-10-11)
Sve cene su **jedinične cene BEZ PDV u RSD** (cena artikla iz šifarnika → predmer → situacija; i budžet,
troškovi, naplata). `VALUTA='RSD'` + `fmtEur`/`fmtEurK` (imena ostaju, 200+ poziva) su jedino mesto
formata; labele polja nose „bez PDV (RSD)". U fajlu ne sme biti znaka „€" (test to čuva). PDV se
nigde ne računa — ako zatreba, to je nova odluka (stopa, prikaz sa/bez).

## Nalozi (stanje 2026-10-22 — 8 test-profila, odluka klijenta)
- direktor: `miske1431@gmail.com` (profili.uloga=direktor, zaposleni_id null)
- admin: `admin@gradnjaos.test`
- direktor projektovanja: `dirpro@gradnjaos.test` (uloga `direktor_projektovanja`, moduli [projektovanje], zaposleni_id null)
- direktor izvođenja: `dirizv@gradnjaos.test` (uloga `direktor_izvodjenja`, moduli [izvodjenje], zaposleni_id null).
  Oba napravljena 2026-10-22: Jovan Add user u dashboardu, profil SQL-om. Probe `set local role`: dirpro vidi 4 pro gradilišta
  (finansije da), dirizv 12 izv; `je_direktor` true, `je_super`/`je_puna_uprava` false; profili 1 (svoj), log 0,
  `nalozi_pregled` odbijen. Uloge se kasnije menjaju samo kao direktor (Admin kokpit).
- rukovodilac PROJEKTOVANJE + finansije: `nikola@gradnjaos.test` → `z17` (Nikola Vuković; vodi g9, trtr, test 1)
- rukovodilac IZVOĐENJE bez finansija: `petar@gradnjaos.test` → `z1` (Petar Kovačević; vodi g1, Test 2)
- radnik PROJEKTOVANJE: `sara@gradnjaos.test` → `z10` (Sara Ilić; tim g9 + trtr; 3 zadatka na g9 za tajmer)
- radnik IZVOĐENJE: `milos@gradnjaos.test` → `z15` (Miloš Đukić; tim g1, g6; bez zadataka)
- Lozinke su poslate Jovanu u chatu, NISU u repou. Promena: dugme "Lozinka" u sidebaru.
- Novi korisnik: Supabase → Authentication → Users → Add user (email+lozinka,
  auto confirm), pa u aplikaciji **Admin kokpit** → dodeli ulogu (uprava; admin ne
  može da dodeli `direktor`). SQL alternativa: `povezi_profil(...)`. Bez profila nalog
  vidi nula podataka. Dodela se loguje (`uloga_promena`).
- Magic link ("Pošalji mi link") radi tek kad se u Auth → URL Configuration
  postavi Site URL na pravu adresu app-a (posle GitHub Pages deploya).

## Ključni domeni (redosled u kodu)
moduli (projektovanje | izvodjenje→visoko/nisko), gradilišta (+adm, nivo, površina, nadzor),
zaposleni (grs[] više projekata, bivsi[] istorija — v. join tabele), zadaci (kanban), dnevnik,
situacije (naplata), narudzbe (UI: "Trebovanje", mailto/Edge Function na NABAVKA_EMAIL),
troskovi_st (izvor za potroseno(g); opciono `prilog` = faktura kao PDF/slika, data-URL u pilotu),
podizvodjaci (UI u Projektovanju: "Spoljni saradnici"), predmer (i "Specifikacija usluga" za
projektovanje; NIVOI_DOK = faze svezaka IDR/IDP-PGD/PZI, ček-lista pri kreiranju; SABLONI_FAZA šablon za
Izvođenje: 8 faza × zadaci po tipu visoko/niskogradnja, `primeniSablonFaza()` — od 2026-10-09 SAMO
na zahtev iz fioke `ubaciSablonFaza`, NE pri kreiranju; `fazeZa()` i dalje čita imena faza), resursi
(istek → upozorenja), magacin + mag_promene, izveštaji (openIzvestaj=za investitora bez
finansija, openPresek=interni sa finansijama, openKumulativ=izvedene količine), profili (auth).

## Pravila koja NE kršiti
1. **Sedam uloga (od 2026-10-07, migracija 14; + direktori modula 2026-10-14, migracija 27; odluka klijenta):** `direktor` (super:
   sve + BRISANJE + dodela direktorskih uloga), `admin` (sve bez brisanja; ne dira direktore),
   **`direktor_projektovanja` / `direktor_izvodjenja`** (sva ovlašćenja direktora — finansije, cene, pregled situacija,
   predmer, tim, BRISANJE — ali SAMO u svom modulu; BEZ Admin kokpita, migracija 28; v. pasus „Direktori modula" ispod),
   `rukovodilac` (svoja gradilišta; finansije SAMO uz `vidi_finansije` = „Rukovodilac 1"),
   `radnik` (gradilišta gde je u timu: čita, svoj dnevnik/zadaci/dokumenta), `spoljni`
   (kao radnik, vezan za `podizvodjaci.id`). Finansije (cene, naplata, kumulativ,
   troškovi) vidi SAMO `canFinance()` = uprava ili rukovodilac sa zastavicom — nikad
   radnik/spoljni. **IZUZETAK (odluka 2026-10-12, migracija 23): jedinične cene predmera** (`predmer.cena`)
   vidi i SVAKI rukovodilac na svom gradilištu IZVOĐENJA — `vidimCene(grId)` (klijent: SAMO kolona jed. cena na strani
   Predmer i jed. cena po stavci u detalju situacije; kol×cena po redu / iznos stavke / ukupno ostaju `canFinance()`,
   inače bi zbir kolone dao vrednost koju `situacije_v.iznos` krije — nalaz pregleda 2026-10-12; server: `predmer_v`
   `vidi_finansije() or (vodim_gradiliste(gr) and not gradiliste_je_pro(gr))`; mock `ctx.rukIzv`). Cene
   „fiksira" uprava — `zastiti_kolone_predmer` ne-upravi ne da da ih menja, `formPredmerRed` nudi cenu samo uz
   `canFinance()`, `rowsZa` je rukovodiocu i dalje ne šalje. KPI vrednosti (ugovoreno/izvedeno/preostalo),
   „Ukupno" situacije, „Plaćeno", kumulativ, izvoz predmera — i dalje `canFinance()`. JEDINI IZUZETAK: `izvozSituacije`
   (Excel za investitora, odluka 2026-10-16) računa iznose iz jediničnih cena i za rukovodioca bez finansija
   (`smemIzvozSituacije` = vidi gradilište ∧ (`canFinance()` ∨ `vidimCene`)) — ne „popravljati" nazad na `canFinance()`. `preracunajSituacijeLokalno`
   piše `iznos` samo uz `canFinance()` (rukovodilac sa cenama ga ne računa — iznos je serverov). Tabovi po ulozi: `tabDozvoljen()` (uprava sve; ostali: tabla,
   gradilišta, rokovi, zadaci (samo modul projektovanje), dnevnik, magacin (samo modul izvođenje), trebovanje; `pay` = SAMO uprava
   (odluka 2026-10-14; rukovodilac sa finansijama situacije i dalje vidi/pravi u fioci gradilišta, `viewPay` vraća ostale na dash)).
   Klijent: `ULOGA`/`VIDI_FIN`/`JA` + `ROLE` ('all' = uprava, inače id osobe);
   `isDirector()` = UPRAVA (direktor|admin|direktor modula), `jeSuper()` = SAMO direktor, `vrstaUloge()`.
   Uloge žive na 4 mesta: check constraint, `dodeli_ulogu` (+`ukloni_pristup`), `ULOGE`, mock `rpc` — menjati
   sva 4. „Pogled kao": `setRole('all'|'admin'|'dirpro'|'dirizv'|'<z>'|'<z>:fin'|'radnik:<z>'|'spoljni:<p>')`
   + opcioni sufiks `|pro` / `|izv`.
   **Direktori modula (2026-10-14, migracija 27, odluka klijenta):** modul se IZVODI iz imena uloge (`MODUL_ULOGE`,
   server `moji_moduli()` — `profili.moduli` je samo snimak, constraint `profili_moduli_uloga_check` ga drži jednakim).
   SERVER: `je_direktor()` (= uprava) ih OBUHVATA, pa svaki postojeći „uprava" uslov (trigeri `zastiti_kolone_*`,
   view-ovi, `vidi_finansije()`) važi i za njih; ograničenje je u `modul_dozvoljen(gid)` → `vodim_gradiliste(gid)` =
   `(je_direktor() and modul_dozvoljen(gid)) or rukovodilac…`. Zato polisa sa GOLIM `je_direktor()`/`je_super()` nad
   tabelom koja ima `gr` NE SME više da postoji — koristi `vodim_gradiliste(gr)` (pisanje), `smem_brisati(gr)` (brisanje =
   `je_super() or (je_direktor_modula() and vodim_gradiliste(gr))`; `gr null` → samo direktor), `modul_moj(modul)` za INSERT
   gradilišta (red još ne postoji). `je_super()` ostaje SAMO direktor (globalne tabele: zaposleni, klijenti, podizvođači,
   šifarnik, magacin). RPC: `obrisi_gradiliste` guard `smem_brisati`, `angazovanost` filtrira `modul_dozvoljen(gr)`.
   NALOZI (migracija 28, odluka 2026-10-14): Admin kokpit vidi SAMO puna uprava — `je_puna_uprava()` guard na
   `nalozi_pregled`/`dodeli_ulogu`/`ukloni_pristup`/`angazovanost`, `log_koriscenja` select i (migracija 30) `profili` select; klijent `jePunaUprava()`
   (tab `punaUprava:true`, `viewNalozi` vraća na dash, `smemDodelitiUlogu`/`smemMenjatiNalog`). Direktor modula NEMA
   kokpit (grana „samo svoj modul" iz migracije 27 je uklonjena). Direktorske uloge (`DIREKTORSKE`) dodeljuje/menja/uklanja
   SAMO `moja_uloga()='direktor'` (ni admin). KLIJENT: `primeniUlogu` → `ROLE='all'`, `MODULI=[modul]`, `MODUL='sve'`;
   `visibleSites` filtrira po `MODULI` i za upravu; `smemNa` za upravu traži `modulDozvoljen(g.modul)` — zato NIJEDNA funkcija
   sa `grId`/id ne sme da stane na golom `isDirector()`/`canFinance()` (pregled 2026-10-22: odobri/vrati/markPaid, izvoz i uvoz
   predmera, tim, izvedeno, troškovi, resursi, presek/kumulativ/troškovi dobili `smemNa`/`vidimGr`); `smemBrisati(grId)`
   umesto `jeSuper()` za svako brisanje reda gradilišta (dugmad + `obrisi*` guardovi); `upravaSve()` = puna uprava bez
   filtera (liste bez `gr`: zaposleni, dnevnik, podizvođači, trebovanja, Kanban); `tabDozvoljen`: zadaci samo uz projektovanje,
   magacin/naplata samo uz izvođenje — i za upravu; `modulEfektivni()` (= `MODUL`, ili jedini modul naloga) bira prikazne
   grane koje su ranije gledale samo `MODUL` (naziv Spoljni saradnici/Podizvođači, dugme Šifarnik artikala, kolona „Ugov. vs
   situacije", grupisanje table) — `MODUL` sam ostaje `'sve'` (T42); `formSite` nudi samo dozvoljene module, izmena tuđeg se ne otvara;
   čekboksi modula u Admin kokpitu su uvek oba (kokpit ima samo puna uprava, migracija 28); „Pogled kao" direktoru modula
   ne nudi admina/drugog direktora/osobe drugog modula (`all` = njegova uloga). Mock: `UPRAVA`/`DIREKTORSKE`/`MODUL_ULOGE`,
   `ctx.isModDir/mojiModuli/modulDozvoljen`, ista pravila u `dodeli_ulogu`/`ukloni_pristup`/`obrisi_gradiliste`/`angazovanost`
   (redove mock i dalje NE filtrira — RLS po modulu dokazana probom na bazi 2026-10-14). T57.
   **Modul po nalogu (od 2026-10-11, migracija 18):** `profili.moduli text[]` ⊆ {projektovanje,
   izvodjenje}; rukovodilac 1–2, radnik TAČNO 1, uprava/spoljni oba. Server: `modul_dozvoljen(gid)`
   je unutar ne-uprava grana `vodim_gradiliste`/`moje_gradiliste` (sve polise/RPC-ovi nasleđuju);
   `dodeli_ulogu` 6-arg (+`p_moduli`); 5-arg je OBRISANA — omotač uz 6-arg sa default-om daje
   PGRST203 „could not choose the best candidate" za svaki poziv bez `p_moduli` (lekcija 31). Klijent: `MODULI` (`primeniUlogu` 4.
   arg, `initAuth` iz `prof.moduli`), `modulDozvoljen(m)`, `visibleSites` filtrira po modulu,
   `modulSeg()` nudi samo dozvoljene (jedan modul = bez segmenta, `MODUL='sve'`),
   `tabDozvoljen('tasks')` = false za radnika bez projektovanja (bnav tada nudi Rokove), Admin
   kokpit: čekboksi modula po redu i u formi (`nmp_/nmi_`, `n_mp/n_mi`). Mock `dodeli_ulogu`
   ista pravila. T42.
2. Dve provere, ne jedna: `smemNa(grId)` = VODIM (pisanje: uprava ili rukovodilac tog
   gradilišta) i `vidimGr(grId)` = ČITAM (+ radnik u timu, spoljni na gradilištu).
   SVAKA funkcija koja prima `grId`/id spolja počinje jednom od njih (ili `jeSuper()`
   za brisanje, `t.zad===ROLE` za svoj zadatak, `autor===ROLE` za svoj unos) — funkcije
   su globalne, sakriveno dugme nije zaštita. Server sprovodi isto: `vodim_gradiliste` /
   `moje_gradiliste` / `je_super` / `moj_autor()` u polisama; UI guard ostaje zbog
   lokalnog `DATA` keša (bez njega bi red „postojao" do refresha, a upis tiho pao).
   Dugmad za pisanje (zadatak, trebovanje, magacin izlaz, tim) iza `mogaDaUpravljam()`.
3. Svi korisnički unosi kroz `esc()` pre upisa u DATA (escape-on-write, ne
   escape-on-render — 800+ mesta u kodu se oslanja na to da je DATA već čist).
   Izlazi koji NISU HTML (CSV, telo mejla, ime fajla) moraju ići kroz `unesc()`.
4. Brojevi iz korisničkog unosa idu kroz zajednički `broj()` (srpski `1.234,50`
   i engleski `1234.50`/`12.5`) — ne ad-hoc `+String(x).replace(',','.')`.
   IZUZETAK: `<input type="number">` daje već kanoničnu vrednost (`.` decimala) —
   tu je `broj()` POGREŠAN (`"1.250"` bi postalo 1250); koristi `+v` uz proveru
   praznog/`Number.isFinite`. `broj()` je za tekstualna polja i paste iz Excela.
5. Izračunate vrednosti: potroseno(g) iz troskovi_st stavki (fallback g.potroseno),
   naplSum(g) iz situacija — ne uvoditi paralelne izvore istine.
   **Napredak iz predmera** (od 2026-10-07, migracija 13): kad gradilište ima predmer,
   `napredak` = Σ min(izv,kol)·cena / Σ kol·cena (bez cena: po količinama) — računa ga
   SERVER trigerom na `predmer` (`napredak_iz_predmera`, radi kao vlasnik pa ima cene i
   kad rukovodilac učita izvedeno); direktor isto računa lokalno (`napredakIzPredmera`,
   `osveziNapredak` posle svake izmene predmera) radi trenutnog prikaza; rukovodilac
   (cene null) ga dobija iz `zdravlja_mojih()` (`osveziZdravlje` ga upiše i uskladi
   `PUSHED` da ga diff ne šalje nazad). Ručni napredak samo bez predmera (`formUpdate`
   ga tada nudi, inače je samo prikaz). Formula na DVA mesta — menjati oba. T30.
   Tako `zdravlje(g)` = ugovoreno × izvedeno (+ rokovi, zadaci, finansije). Penali zdravlja su na TRI mesta: `zdravlje(g)`,
   server `zdravlje_gradilista` i opis u `aiSistem()` (asistent ih objašnjava direktoru) — menjati sva tri.
   Situacija (migracija 19) je dokument za naplatu: njene količine NE pišu `predmer.izv`. „Izdato"/naplata/realizacija
   = samo ODOBRENE situacije (migracija 25, `pregledSit`).
   **Zadaci postoje SAMO u Projektovanju (odluka 2026-10-11):** `zadatakPro(t)` = `jePro(grById[t.gr])`
   je prvi filter u `zadaciVidljivi()` (Kanban, brojač, fioka, rokovi na tabli, upozorenja), `formTask`
   nudi samo projektantska gradilišta (`saveTask` guard), fioka Izvođenja nema sekciju Zadaci ni dugme
   šablona faza (`ubaciSablonFaza` više nije u UI; `SABLONI_FAZA` ostaje za `fazeZa()`), „＋ Zadatak"
   u brzim akcijama samo ako ima vidljivo projektantsko gradilište, `tabDozvoljen('tasks')` = false za
   svakog ne-upravu bez modula projektovanje. Stari zadaci Izvođenja u bazi ostaju, sakriveni.
   Zaglavljenu sesiju tajmera na takvom zadatku `pocniZadatak` sam zatvori (log `zadatak_pauza`
   sa `auto:true`) umesto da blokira. T36 0.
6. Datum polje koje se svuda čita kao `dParse(x.rok)`/`daysBetween(...)` NE SME
   dobiti `null` kao default — default na smislen datum (isti kao u formi). Jedini
   null-safe datum je `resursi.istice` (`resIstice()` sentinel). Prazan string
   `''` ne sme u Postgres `date` kolonu (22007 je ranije tiho obarao upis).
   `adm[key].vazi_do` (važenje ugovora/prijave/polise) je drugi null-safe opcioni datum — svuda iza `if(st.vazi_do)`; `setAdmVazi` sa praznom vrednošću briše ključ (jsonb objekat se šalje ceo, pa je tu `delete` ispravan).
7. **DATA je PARCIJALAN pogled** (od F4): svako ko nije uprava ima samo gradilišta
   koja vidi (rukovodilac svoja, radnik tim, spoljni svoja), ali SVE zaposlene i SVE
   veze — `z.grs`/`p.grs` sadrže id-jeve gradilišta koja NISU u `grById`. Nikad
   `grById[x].naziv` bez zaštite: `grById[x]?grById[x].naziv:'—'` ili
   `.map(x=>grById[x]).filter(Boolean)`. T18c to lovi u mock-u. Ne otkriva se IME
   tuđeg gradilišta, samo da postoji ("na drugom gradilištu"). Autor unosa može biti
   i spoljni saradnik (`podizvodjaci.id`) — za ime uvek `osobaIme(id)`, nikad `zapById[id].ime`.
8. Nikad ne dodavati kod koji gura celu tabelu u bazu — `pushAll` je diff.
   Nova tabela → dodaj u `TABLES` (id-tabela) ili `JOIN_TABELE` + `rowsZa`/
   `kljucReda`, i polisu u migraciji. Nova mutacija → prođe kroz `saveState()`.
   Nova finansijska kolona → i u view, i u `FIN_KOLONE`, i u trigger, i u
   column grant (4 mesta — inače curi ili se gazi NULL-om).
   Uklanjanje polja = `x.polje=null`, NIKAD `delete x.polje`: PATCH postavlja
   samo ključeve koje nosi, pa obrisan ključ ostavlja staru vrednost u bazi
   (prilog fakture se „vraćao" posle refresha). Tabele sa `FIN_KOLONE` NIKAD
   upsert, ni za seed/reset: `INSERT…ON CONFLICT DO UPDATE SET col=excluded.col`
   čita `excluded.budzet`, što traži SELECT na koloni koji je ukinut → 42501 i
   za direktora (provereno na bazi 2026-10-03; mock to oponaša). `PUSHED` se
   beleži po USPELOM zahtevu, ne po tabeli (inače insert-pa-pad → 23505).
   Odjava ide kroz `sacuvajSve()` (čeka upis u letu + debounce), ne `flushSave()`.
10. **Datum je ŽIV**: `TODAY` je `let` koji `osveziDanas()` osvežava u `render()`, na
    povratak taba (`visibilitychange`/`focus`) i tajmerom u ponoć. Nikad ne
    keširati `new Date()` u konstantu — tab na telefonu živi danima, a
    `todayStr()` je datum NOVIH unosa. Server (`danas_bg()`) računa po
    Europe/Belgrade; klijent po satu uređaja. T21.
9. `DATA` bez `canFinance()` (rukovodilac 2, radnik, spoljni) nema finansije NI KAO
   KOLONE (null; view-ovi `CASE vidi_finansije()`) — `g.budzet`, `x.cena`,
   `potroseno(g)`, `naplSum(g)` su 0/null (izuzetak: `x.cena` predmera na gradilištu Izvođenja koje
   rukovodilac vodi — migracija 23, `vidimCene`). Sve što ih koristi mora biti iza
   `canFinance()` ili tolerantno na null; `zdravlje(g)` za svakog ko nije uprava
   dolazi iz `ZDR_SRV` (server, `zdravlja_mojih()` + napredak), a bez servera `null` → „—"
   (`zdrTekst`/`zdrBoja(null)`), NIKAD lokalnu formulu (nad null finansijama
   daje do 25 niži skor, tiho). Direktor u „Pogled kao" računa lokalno (pune
   kolone, jedan skor za sve). RLS-polisa NE MOŽE da sakrije
   kolonu; ukidanje SELECT polise obara i UPDATE (Postgres proverava SELECT
   polisu na redu koji se ažurira) — zato column-level grant + view.

## Gde šta piše
- `CLAUDE.md` (ovo): arhitektura, invarijante, pravila, nalozi, testiranje, deployment — kratko, važi uvek.
- `docs/beleske-funkcija.md`: datirane beleške po funkciji (šta/kada/zašto/koji test) — čitati pasus teme pre izmene; nove beleške idu tamo.
- `tasks/lessons.md`: lekcije iz grešaka; `tasks/todo.md`: tekući plan i review-i.

## Lekcije (vidi tasks/lessons.md — OBAVEZNO pročitati pre izmena)
38 lekcija; najvažnije za svaku izmenu:
- U fajlu postoje LITERALNE \uXXXX sekvence u JS stringovima — grep pre zamene.
- Svaki search-replace mora imati assert (`test/patch-lib.js`, `Patcher`).
- Upis fajla: temp fajl pa atomic rename.
- Bezbednosni nalaz se dokazuje IZVRŠAVANJEM kroz pravi put (formu / RLS sa
  `set local role`), ne čitanjem regexa.
- Pre nego što test tvrdi "X je dodato", proveri da X nije već u DEMO (T18
  je prvo trivijalno prolazio sa z2/g1 koji u DEMO već postoji).
- Preview panel učitava `file://` kao `data:` URL → nema localStorage → sesija
  ne preživi reload. Auth tok se u browseru testira BEZ reload-a (ručno
  `initAuth()+loadState()+…`). U pravom browseru na http(s) sesija traje.

## Testiranje
`node test/e2e.js` — 540+ asertacija, bez spoljnog test framework-a (namerno).
- `test/dom-stub.js` — minimalan DOM (+ brojači reload/prompt/confirm)
- `test/patch-lib.js` — `Patcher` (replace+assert+atomic write; `assertNoLostDeclarations([dozvoljeno])`)
- `test/supabase-mock.js` — mock klijent: select/upsert/delete (+ filteri,
  maybeSingle, kompozitni ključevi join tabela), `functions.invoke()`, `auth.*`
  (`boot({supabase:true, session, users, seed:{profili}})`; podrazumevano
  direktorska sesija; `session:null` = ekran za prijavu)
Pokriva: sintaksu, boot, pogledi × uloge × moduli, th==td, role-guardove,
vlasništvo, XSS kroz forme, integritet, Supabase sync, edge function fallback,
auth tok (T18), diff-čuvanje i join tabele (T18b), parcijalni DATA (T18c),
finansije van dometa rukovodioca + update/insert put + skor sa servera (T19).
Mock: view aliasi NULL-uju finansijske kolone ne-direktoru, `rpc('zdravlja_mojih')`
(`faults.zdravlja`), `update()` se loguje kao upsert sa `via:'update'`.
RLS na serveru se proverava DIREKTNO na bazi (recept, execute_sql):
`begin; set local role authenticated; set local request.jwt.claims =
'{"sub":"<uuid>","role":"authenticated"}'; select …` — 2026-09-23: 3 profila
čitanja + 13 provera upisa, sve po dizajnu. Posle SVAKE izmene: e2e mora vratiti 0.

## Sledeće (dogovoreno, čeka)
- [x] Supabase povezivanje — 2026-09-14
- [x] **F4 Auth + RLS po ulogama — 2026-09-23** (migracija 10, join tabele,
      diff-čuvanje, login ekran, profili). Provereno na pravoj bazi kao
      direktor i kao rukovodilac.
- [x] **F4b hardening — 2026-09-23** (migracija 11): zdravlje RPC, column-level
      grant + view-ovi, trigeri za kolone, troskovi_st/situacije samo direktor.
      Provereno na pravoj bazi kao rukovodilac: iznosi = null, tabela → permission
      denied, UPDATE svog g1 uz pokušaj budzet/rukovodilac → vrednosti netaknute,
      zdravlje 85 == direktorovo; server skor == klijent za svih 9 gradilišta.
- [ ] Auth podešavanja u dashboardu: isključiti self-signup (Auth → Providers →
      Email → "Allow new users to sign up" OFF); Site URL na Pages adresu.
- [ ] Edge Function trebovanja: deploy + RESEND_API_KEY (kad Jovan kaže)
- [x] AI asistent: funkcija `ai-asistent` deploy-ovana 2026-10-21, `ANTHROPIC_API_KEY` postavljen (workspace „Gradnja OS", limit 30 USD/mes), radi uživo 2026-10-22
- [x] Test-nalozi direktora modula `dirpro@gradnjaos.test` / `dirizv@gradnjaos.test` — 2026-10-22, RLS probe po dizajnu
- [x] GitHub publish + Pages — 2026-09-24, https://mrmouse123.github.io/gradnjaos/
- [ ] .xlsx binarni upload — svesno odloženo; PDF dokumenta uz šablone — čeka.

## Jovanove odluke (2026-09-15) — ne otvarati ponovo bez razloga
- **Zdravlje projekta = jedan skor za sve uloge.** `zdravlje(g)` uvek uračunava
  finansijske penale. Rukovodilac vidi broj, ne i obrazloženje.
- **Marža je UKLONJENA (2026-10-12, migracija 24): „ne merimo to".** Nema `marzaPct`/`ostvMarzaPct`,
  nema je ni u jednom pogledu, fioci, preseku, kartici ni upozorenju; `zdravlje(g)` i server
  `zdravlje_gradilista` nemaju penal za maržu, završen projekat = 100. Test T17 čuva da u `index.html`
  nema reči „marža". Ostaje `gradilista.troskovi` = planirani troškovi (upozorenje „Troškovi premašili
  plan", penal „troškovi ispred napretka"); podrazumevana vrednost pri kreiranju je i dalje 85% cene.
- **Tim: puna lista uz upozorenje.** `formTim` nudi sve; osoba na drugom
  gradilištu označena (`drugde()`), `saveTim` traži `confirm()`. Rukovodiocu
  se NE otkriva ime tuđeg gradilišta.

## Responsive (od 2026-09-24, izmereno na live URL-u)
Breakpointi: **1100** (Kanban 4→2), **1050** (`.row2` 2→1), **900** (tablet:
sidebar off-canvas + hamburger `toggleSide()` + zajednički scrim, KPI 4→2, touch
mete 38px, `input` 16px protiv iOS zuma, fioka/modal puna širina), **560**
(telefon: segment modula i topbar se prelamaju, gustina kartica/tabela, Gantt
150px labela / 700px min / 52px po mesecu, modal na ceo ekran, Kanban 1 kolona), **400** (mali
telefon: sve u 1 koloni), `max-height:500` (landscape), `hover:none` (bez
zalepljenih hover efekata). Nosive ispravke: `.main{min-width:0}` (grid ćelija
inače raste na min-content Gantta/tabela i širi CEO layout), `.kanban`
`minmax(0,1fr)`, `.sites-grid minmax(min(310px,100%),1fr)`, `.side` 100dvh +
skrol + safe-area, fioka `width:100%` (100vw uključuje skrol-traku).
**Mobilni sloj (od 2026-10-04):** na ≤900 px donja traka `#bnav` (Tabla · Gradilišta ·
Zadaci · Dnevnik · Više→`toggleSide()`), puni je `renderNav()` pa aktivno prati
`current`; `.main` dobija `padding-bottom:calc(72px + safe-area)`; z-index 35 (ispod
scrima 40 i modala 60). Brze akcije `.qa` na vrhu table (`brzeAkcije()`: ＋ Dnevnik,
＋ Zadatak, ＋ Trebovanje, Rokovi) — forme bez argumenata, pa su bezbedne za
rukovodioca. Osnovna pravila `.bnav{display:none}`/`.qa{display:none}` MORAJU stajati
PRE `@media(max-width:900px)` (ista specifičnost — poslednje pobeđuje; prvi pokušaj
posle bloka je dao display:none na telefonu). PWA: `manifest.webmanifest` +
`ikone/` (PNG generisane skriptom bez biblioteka, SVG, maskable) + meta u head-u →
„Dodaj na početni ekran" otvara app standalone; `start_url:"./"` radi samo dok
manifest stoji pored index.html. Bez service workera (namerno: offline bi bio lažan
uz živu bazu). iOS: magic link iz mejla otvara Safari, ne instaliranu kopiju. T25.
**Tema (od 2026-10-04):** sve boje su CSS promenljive u `:root, .rpt-page` (svetla) +
DVA identična tamna bloka (`@media (prefers-color-scheme: dark){:root:not([data-theme="light"])}`
za sistem i `:root[data-theme="dark"]` za ručni izbor) — menjati oba, T27 poredi.
`postaviTemu('system'|'light'|'dark')` → `localStorage gos_tema` + `data-theme` na `<html>`;
inline skript u `<head>` primenjuje izbor pre prvog crtanja; `theme-color` meta prati.
Segment „Tema" u sidebaru. `.rpt-page` ostaje bela (izveštaj = papir). Pravila: nikad
`color:#fff` na pozadini `var(--ink)` (u tamnoj je ink svetao) — koristi `var(--paper)`;
nova boja = nova promenljiva u SVA TRI bloka; sidebar/brif su tamno-plavi u obe teme.
Provera: u browser panelu `resize_window colorScheme:'dark'` + skener elemenata sa
`background rgb(255,255,255)` ili `color===backgroundColor` kroz sve poglede.
**Gantt osa (2026-10-08):** `.gantt-inner` dobija inline `min-width:max(--g-min, --g-lab + N*--g-col)`
(64px/52px po mesecu), kolone `minmax(0,1fr)`, `.gm{overflow:hidden}` — zaglavlje meseci
i traka MORAJU biti iste širine, inače štapići/„danas" (u % trake) klize (lekcija 28, T39).
**Modal (2026-10-11):** `openModal(html,{siroka,kljuc})` — `.siroka` = 1040px za forme sa tabelom/ček-listom
(novo gradilište, artikli iz šifarnika, situacija); na >900px `.modal{resize:horizontal}` pa korisnik vuče
donji desni ugao, širina se pamti u `localStorage gos_modal_w_<kljuc>` (mouseup) i primenjuje samo na >900px
(telefon = pun ekran). T45.
Pravila: široka tabela UVEK u `<div style="overflow-x:auto">`; nikad `1fr`
grid bez `minmax(0,…)` ako sadržaj može biti širok; nikad `white-space:nowrap`
na tekstu koji može premašiti 300px; hamburger nikad ne sme biti jedini način
da se sidebar zatvori (scrim).
Merenje: u browseru na live URL-u, iframe-ovi fiksnih širina (isti origin,
sesija se deli, media query-ji reaguju na širinu iframe-a) — `window.__meri(w)`
recept u lessons #19. Kriterijum: `documentElement.scrollWidth <= clientWidth`
za svaki pogled + fioka/modal/izveštaj unutar `clientWidth`. Preview panel
sa emuliranim viewportom je NEPOUZDAN (innerWidth ≠ clientWidth, tranzicije
zamrznute u pozadinskom tabu).

## Deployment (živo od 2026-09-24)
- **URL:** https://mrmouse123.github.io/gradnjaos/ — GitHub Pages, repo
  `github.com/mrmouse123/gradnjaos`, grana `main`, root. Javni repo je OK
  (RLS + column grant; lozinki u repou nema — `git grep` pre svakog commita).
- Izmena = commit + `git push` (remote `origin` je podešen, Git Credential
  Manager pamti prijavu) ili GitHub Desktop. Pages se sam osveži za ~1 min.
  `.nojekyll` u korenu: čist statički sajt, bez Jekyll obrade. Ako build padne
  na koraku "Deploy to GitHub Pages" (desilo se 2026-09-24, GitHub-ova strana),
  prazan/novi commit ga ponovo pokreće; status: api.github.com/repos/
  mrmouse123/gradnjaos/actions/runs (javno, bez tokena).
- Keš: `proveriNovuVerziju()` na startu radi HEAD na sopstveni URL i poredi
  `Last-Modified` sa `document.lastModified`; ako je server noviji →
  `location.replace(?v=timestamp)` (jednom po sesiji, `sessionStorage`).
  Nema više ručnog `?v=N`. Podnožje sidebara prikazuje „verzija od …"
  (`verzijaTekst()`), pa se uvek vidi šta korisnik gleda. NE testirati kroz
  Files preview.
- Prava proba prijave ide na live URL-u: forma → reload → sesija preživljava
  (u preview panelu ne, v. lessons #13). Provereno 2026-09-24 kao Petar.
- Supabase Auth → URL Configuration → Site URL i Redirect URLs =
  `https://mrmouse123.github.io/gradnjaos/` — Jovan u dashboardu (nemam alat);
  bez toga magic link / reset lozinke vode na localhost:3000.
- Domen kasnije: `CNAME` fajl u repou + CNAME zapis kod registrara
  (`gradnjaos.think-tech.co` → `mrmouse123.github.io`), HTTPS automatski.
- Šifarnik mera: od 2026-10-11 NIJE u Admin kokpitu (zahtev) — modal `formSifrarnik()` sa dugmeta
  „Šifarnik mera" na tabu Gradilišta (uprava); akcije u modalu zovu `osveziSifrarnikModal()`.
