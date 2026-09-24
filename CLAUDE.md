# GradnjaOS — kontekst projekta za Claude Code

## Šta je ovo
Pilot PM alat za građevinsku firmu (klijent u fazi requirements/assessment).
Ceo alat je JEDAN fajl: `index.html` (vanilla JS, bez build koraka) — namerno,
radi brzine iteracija dok se zahtevi ne slegnu. Jezik UI-ja: srpski (latinica).

## Arhitektura
- `index.html`: CSS + HTML ljuska + sav JS u jednom <script> bloku
- **Supabase** (od 2026-09-14): projekat `gradnjaos`, ref `xqggoxrihitvqaocowlb`,
  org "jovan.miskovic@think-tech.co's Org", eu-central-1, besplatan plan
  (PAUZIRA se posle 7 dana bez upotrebe → Restore u dashboardu, v. lessons #10).
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
- `supabase/schema.sql` = kompletna šema za SVEŽU bazu (13 + 3 tabele, 3 view-a,
  helperi, polise, trigeri, `povezi_profil`). Postojeća baza: `migracija-01..11.sql` redom.
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
- Render: svaki pogled je `viewX()` funkcija koja vraća HTML string; `render()`
  ubacuje u #main. Globalno stanje: ROLE, MODUL/PODTIP, current (tab), PROFIL.

## Nalozi (stanje 2026-09-23)
- direktor: `miske1431@gmail.com` (profili.uloga=direktor, zaposleni_id null)
- test-rukovodilac: `petar@gradnjaos.test` → zaposleni `z1` (Petar Kovačević)
- Lozinke su poslate Jovanu u chatu, NISU u repou. Promena: dugme "Lozinka" u sidebaru.
- Novi korisnik: Supabase → Authentication → Users → Add user (email+lozinka,
  auto confirm), pa u SQL editoru `select povezi_profil('mejl','rukovodilac','zNN');`
  (ili `'direktor'` bez trećeg argumenta). Bez profila nalog vidi nula podataka.
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
1. Rukovodilac NIKAD ne vidi: marže, cene, jedinične cene, naplatu, kumulativ,
   tabove Klijenti/Naplata. Direktor (ROLE==='all') vidi sve.
2. SVAKA mutirajuća I čitajuća funkcija koja prima `grId` spolja ima na početku
   `smemNa(grId)` (ili ekvivalentnu proveru) — funkcije su globalne, sakriveno
   dugme nije zaštita. Server sprovodi isto pravilo RLS-om; UI guard ostaje
   zbog lokalnog `DATA` keša i UX-a (bez njega bi red "postojao" do refresh-a,
   a upis tiho pao).
3. Svi korisnički unosi kroz `esc()` pre upisa u DATA (escape-on-write, ne
   escape-on-render — 800+ mesta u kodu se oslanja na to da je DATA već čist).
   Izlazi koji NISU HTML (CSV, telo mejla, ime fajla) moraju ići kroz `unesc()`.
4. Brojevi iz korisničkog unosa idu kroz zajednički `broj()` (srpski `1.234,50`
   i engleski `1234.50`/`12.5`) — ne ad-hoc `+String(x).replace(',','.')`.
5. Izračunate vrednosti: potroseno(g) iz troskovi_st stavki (fallback g.potroseno),
   naplSum(g) iz situacija — ne uvoditi paralelne izvore istine.
6. Datum polje koje se svuda čita kao `dParse(x.rok)`/`daysBetween(...)` NE SME
   dobiti `null` kao default — default na smislen datum (isti kao u formi). Jedini
   null-safe datum je `resursi.istice` (`resIstice()` sentinel). Prazan string
   `''` ne sme u Postgres `date` kolonu (22007 je ranije tiho obarao upis).
7. **DATA je PARCIJALAN pogled** (od F4): rukovodilac ima samo svoja gradilišta,
   ali SVE zaposlene i SVE veze — `z.grs`/`p.grs` sadrže id-jeve gradilišta koja
   NISU u `grById`. Nikad `grById[x].naziv` bez zaštite: koristi
   `grById[x]?grById[x].naziv:'—'` ili `.map(x=>grById[x]).filter(Boolean)`.
   T18c to lovi u mock-u. Rukovodiocu se ne otkriva IME tuđeg gradilišta, samo
   da postoji ("na drugom gradilištu").
8. Nikad ne dodavati kod koji gura celu tabelu u bazu — `pushAll` je diff.
   Nova tabela → dodaj u `TABLES` (id-tabela) ili `JOIN_TABELE` + `rowsZa`/
   `kljucReda`, i polisu u migraciji. Nova mutacija → prođe kroz `saveState()`.
   Nova finansijska kolona → i u view, i u `FIN_KOLONE`, i u trigger, i u
   column grant (4 mesta — inače curi ili se gazi NULL-om).
9. Rukovodiočev `DATA` nema finansije NI KAO KOLONE (null) — `g.budzet`,
   `x.cena`, `potroseno(g)`, `naplSum(g)` su 0/null za njega. Sve što ih
   koristi mora biti iza `canFinance()` ili tolerantno na null; `zdravlje(g)`
   za njega vraća `ZDR_SRV[g.id]` sa servera. RLS-polisa NE MOŽE da sakrije
   kolonu; ukidanje SELECT polise obara i UPDATE (Postgres proverava SELECT
   polisu na redu koji se ažurira) — zato column-level grant + view.

## Lekcije (vidi tasks/lessons.md — OBAVEZNO pročitati pre izmena)
20 lekcija; najvažnije za svaku izmenu:
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
