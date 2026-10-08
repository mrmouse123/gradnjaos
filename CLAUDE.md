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
- **Izvedeno iz Excela** (od 2026-10-07): `formIzvedeno(grId)` (direktor ili rukovodilac
  svog gradilišta) — `.xlsx` se čita U BROWSERU bez biblioteke (`zipCitaj`: centralni
  direktorijum ZIP-a, veličine odatle jer lokalni header uz data descriptor ima 0;
  `DecompressionStream('deflate-raw')`; `citajXlsx`: sharedStrings + prvi `sheetN.xml`
  regexom, bez DOMParser-a), CSV/nalepljeno kroz `citajCsv`. `upariIzvedeno` po
  normalizovanom imenu (redni broj samo kad ime nedostaje), klamp na `kol`, pregled pa
  `primeniIzvedeno` menja SAMO `izv` (trigger za ne-direktora ionako gazi ostalo) →
  `osveziNapredak`. Fixture `test/fixtures/izvedeno.xlsx` (openpyxl); stub prosleđuje
  `ReadableStream/DecompressionStream/Response/TextDecoder` iz Node-a. T31.
- **Dokumenti, šifarnik, brisanje, tajmer** (2026-10-08, migracije 14–15): `dokumenti`
  (data-URL u koloni `data` BEZ select granta — lista iz `dokumenti_v`, sadržaj kroz
  `dokument_podaci(id)`; `pushAll` NE šalje `data` pri update-u; briše svoje autor,
  sve super), `sifrarnik` (mere/pozicije; `sifrarnikZa(modul)`; demo = `sifrarnikDemo()`
  iz `NIVOI_DOK` + `SIFRARNIK_IZV`, ISTI sadržaj kao seed u migraciji 14; `formSite`
  ček-lista iz njega za oba modula), brisanje (`obrisiRed` = server PRVO pa lokalno,
  poruka pri odbijanju, log `brisanje`; `obrisi_gradiliste` RPC + lokalno čišćenje
  zavisnih tabela i `PUSHED`), `rad_na_zadatku` (tajmer: start/kraj, `minuta` računa
  server trigerom; `angazovanost(od,do)` RPC za upravu; klijent loguje
  `zadatak_start/zadatak_kraj`).
- `supabase/schema.sql` = kompletna šema za SVEŽU bazu (13 + 3 tabele, 3 view-a,
  helperi, polise, trigeri, `povezi_profil`). Postojeća baza: `migracija-01..17.sql` redom.
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

## Nalozi (stanje 2026-09-23)
- direktor: `miske1431@gmail.com` (profili.uloga=direktor, zaposleni_id null)
- test-rukovodilac: `petar@gradnjaos.test` → zaposleni `z1` (Petar Kovačević)
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
projektovanje; NIVOI_DOK šablon: IDR/IDP-PGD/PZI auto-popuna; SABLONI_FAZA šablon za
Izvođenje: 8 faza × zadaci po tipu visoko/niskogradnja, `primeniSablonFaza()`), resursi
(istek → upozorenja), magacin + mag_promene, izveštaji (openIzvestaj=za investitora bez
finansija, openPresek=interni sa finansijama, openKumulativ=izvedene količine), profili (auth).

## Pravila koja NE kršiti
1. **Šest uloga (od 2026-10-07, migracija 14; odluka klijenta):** `direktor` (super:
   sve + BRISANJE + dodela direktora), `admin` (sve bez brisanja; ne dira direktore),
   `rukovodilac` (svoja gradilišta; finansije SAMO uz `vidi_finansije` = „Rukovodilac 1"),
   `radnik` (gradilišta gde je u timu: čita, svoj dnevnik/zadaci/dokumenta), `spoljni`
   (kao radnik, vezan za `podizvodjaci.id`). Finansije (marže, cene, naplata, kumulativ,
   troškovi) vidi SAMO `canFinance()` = uprava ili rukovodilac sa zastavicom — nikad
   radnik/spoljni. Tabovi po ulozi: `tabDozvoljen()` (uprava sve; ostali: tabla,
   gradilišta, rokovi, zadaci, dnevnik, magacin, trebovanje; `pay` samo `canFinance`).
   Klijent: `ULOGA`/`VIDI_FIN`/`JA` + `ROLE` ('all' = uprava, inače id osobe);
   `isDirector()` = UPRAVA (direktor|admin), `jeSuper()` = direktor, `vrstaUloge()`.
   Uloge žive na 4 mesta: check constraint, `dodeli_ulogu`, `ULOGE`, mock `rpc` — menjati
   sva 4. „Pogled kao": `setRole('all'|'admin'|'<z>'|'<z>:fin'|'radnik:<z>'|'spoljni:<p>')`.
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
   Tako `zdravlje(g)` = ugovoreno × izvedeno (+ rokovi, zadaci, finansije).
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
   `potroseno(g)`, `naplSum(g)` su 0/null. Sve što ih koristi mora biti iza
   `canFinance()` ili tolerantno na null; `zdravlje(g)` za svakog ko nije uprava
   dolazi iz `ZDR_SRV` (server, `zdravlja_mojih()` + napredak), a bez servera `null` → „—"
   (`zdrTekst`/`zdrBoja(null)`), NIKAD lokalnu formulu (nad null finansijama
   daje do 25 niži skor, tiho). Direktor u „Pogled kao" računa lokalno (pune
   kolone, jedan skor za sve). RLS-polisa NE MOŽE da sakrije
   kolonu; ukidanje SELECT polise obara i UPDATE (Postgres proverava SELECT
   polisu na redu koji se ažurira) — zato column-level grant + view.

## Lekcije (vidi tasks/lessons.md — OBAVEZNO pročitati pre izmena)
26 lekcija; najvažnije za svaku izmenu:
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
- [x] GitHub publish + Pages — 2026-09-24, https://mrmouse123.github.io/gradnjaos/
- [ ] .xlsx binarni upload — svesno odloženo; PDF dokumenta uz šablone — čeka.

## Jovanove odluke (2026-09-15) — ne otvarati ponovo bez razloga
- **Zdravlje projekta = jedan skor za sve uloge.** `zdravlje(g)` uvek uračunava
  finansijske penale. Rukovodilac vidi broj, ne i obrazloženje.
- **Marža: planska + ostvarena.** `marzaPct(g)` = planska ("Plan. marža"),
  `ostvMarzaPct(g)` = ostvarena (fioka "Ostv. marža", presek "Ostvarena marža").
  Alarm: crveno < 8% ostvarene, žuto kad `potroseno(g) > g.troskovi`.
- **Tim: puna lista uz upozorenje.** `formTim` nudi sve; osoba na drugom
  gradilištu označena (`drugde()`), `saveTim` traži `confirm()`. Rukovodiocu
  se NE otkriva ime tuđeg gradilišta.

## Responsive (od 2026-09-24, izmereno na live URL-u)
Breakpointi: **1100** (Kanban 4→2), **1050** (`.row2` 2→1), **900** (tablet:
sidebar off-canvas + hamburger `toggleSide()` + zajednički scrim, KPI 4→2, touch
mete 38px, `input` 16px protiv iOS zuma, fioka/modal puna širina), **560**
(telefon: segment modula i topbar se prelamaju, gustina kartica/tabela, Gantt
150px labela / 700px min, modal na ceo ekran, Kanban 1 kolona), **400** (mali
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
