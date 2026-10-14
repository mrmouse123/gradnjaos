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
  `zadatak_start/zadatak_pauza/zadatak_kraj`). **Pauza (2026-10-09):** `pauzirajZadatak` zatvara
  SVOJU sesiju, `kol` ostaje `inprogress`; „▶ Nastavi" = `pocniZadatak` (nova sesija, server ih
  sabira); `zavrsiZadatak` → `done` BEZ confirm-a, dozvoljen i bez sesije za zadatak u toku, tuđa
  otvorena sesija blokira (alert). Bez migracije. T36 a2. **Tajmer SAMO u Projektovanju**
  (odluka 2026-10-10): `tajmerZa(t)` = `jePro(grById[t.gr])` je prvi uslov u `mogaTajmer` i
  `tajmerLinija` — na Izvođenju nema dugmadi za START, `pocniZadatak`/`zavrsiZadatak` su no-op.
  IZUZETAK (2026-10-10, review): SVOJA otvorena sesija se uvek može zaustaviti (`pauzirajZadatak`
  traži samo svoju sesiju + `vidimGr`; kartica tada nudi „⏸ Zaustavi tajmer" i na Izvođenju i na
  done zadatku; `dropTask` u done zatvara svoju sesiju) — inače sesija ostaje zaglavljena i
  blokira svaki novi start. Ne uklanjati taj izlaz. T36 0, a2.
- **„Razno" u Projektovanju (2026-10-09):** `sifrarnikChecklist('projektovanje')` ispod svih svezaka
  nudi `#raznoBox` + `dodajRaznoRed()` (`f_nr_k`/`f_nrz_k`, brojač `RAZNO_N` — NE `getElementById`
  petlja, dom-stub vraća element za svaki id); `saveSite` pravi redove specifikacije
  `Razno — <naziv>` (esc, prazne preskače). Samo pri kreiranju. T40.
- **Kontrolna tabla (2026-10-09):** rokovi, dnevnik i „najrizičniji projekat" imaju
  `onclick="openSite"` (red tabele ga je već imao). T41.
- **XLSX pisač bez biblioteke** (2026-10-11): `napraviXlsx([{ime, redovi}])` → Uint8Array (OOXML minimum: Content_Types,
  rels, workbook, sheet-ovi; broj → `<v>`, ostalo inlineStr sa `xmlEsc`; ZIP STORED + `crc32`), `preuzmiXlsx(ime, listovi)`
  pravi `<a download>` sa `data:…;base64` (nema Blob/URL u stubu; test dekodira base64 i čita nazad kroz `citajXlsx`).
  `izvozPredmer` (uprava) daje .xlsx u šablonu situacije (br. poz | opis | JM | ugovoreno kol/cena/ukupno | izvedeno
  kol/vrednost | preostalo + red UKUPNO). Tekst iz DATA ide kroz `unesc` PRE `xmlEsc` (inače dupli escape). T48.
  Kumulativni pregled: `.rpt-page.siroka` (1040px). Stub: `TextEncoder/btoa/atob` prosleđeni (dom-stub).
- **Zdravlje u Izvođenju na DVA načina** (2026-10-12, odluka klijenta): (1) status/skor `zdravlje(g)`; (2) „Ugovoreno vs
  situacije" = `realizacijaSituacija(g)`: ugovoreno Σ kol×cena predmera vs Σ `iznos` privremenih situacija (server ih
  računa iz stavki — NE uvoditi četvrtu formulu) vs okončana = Σ SVIH situacija (količine situacija su prirasti, pa je
  okončana konačni obračun; null dok okončane nema), % od ugovorenog (`realizacijaHtml`,
  >100% crveno). Samo `canFinance()` (iznos je inače null) i samo Izvođenje. Mesta: kolona „Ugov. vs situacije" na tabli
  (`sitKol`, sort `sit`, `NCOLS` +1, kad `MODUL!=='projektovanje'`), stat u fioci, blok u preseku. T52.
- **Bez marže nigde** (2026-10-12, odluka klijenta; v. „Jovanove odluke"): `computeAlerts` ima samo „Troškovi premašili
  plan — X od planiranih Y"; tabla: KPI i kolona marže uklonjeni (`NCOLS` 7, uprava 3 KPI kartice `kpis3`), nepoznat
  `dashSort.key` se resetuje; fioka: statovi Zdravlje · Napredak · Rok · Naplaćeno (kartice marže obrisane, bez zamene —
  % utrošenog bi bio ista mera naopačke); presek: bez redova marže;
  kartica gradilišta: „Ugovorena cena".
- **Adresa gradilišta** (2026-10-12, migracija 23): `gradilista.adresa` (ulica i broj; `lok` ostaje grad/deo grada),
  u `gradilista_v` i u `zastiti_kolone_gradilista`; forma `f_adresa` (oba puta `saveSite`, prazno = `null`),
  fioka (ispod lokacije), kartica, zaglavlje izveštaja/preseka, mejl trebovanja („Adresa:"), pretraga gradilišta.
- **Play samo na jednom zadatku** (2026-10-12): `mojaOtvorenaSesija()`; `tajmerLinija` na drugim zadacima NE nudi
  ▶ dok jedan radi (poruka „Radiš na: X — pauziraj ga", ■ Završi ostaje za zadatak u toku); `pocniZadatak` i dalje
  ima guard. T51.
- **Ćirilica → latinica pri učitavanju** (2026-10-14, odluka klijenta: rukovodioci uvek šalju ćirilicu): `cir2lat(s)`
  (srpska ćirilica, Љ/Њ/Џ → Lj/Nj/Dž, LJ/NJ/DŽ uz velika slova) se primenjuje u `citajXlsx` (sharedStrings, inlineStr,
  str) i `citajCsv` na SVAKI tekst — uvezeni predmer/situacija/izvedeno su latinični — i u `normPoz`, pa uparivanje radi
  za bilo koju kombinaciju pisama (stari ćirilični redovi u bazi i dalje se uparuju). Regexi parsera ostaju dvopisamski
  (`укупно|ukupno`, `кумулатив|kumulativ`). Dummy g-osdr je prebačen na latinicu u bazi (predmer.poz, situacija_stavke.poz). T55.
- **Pregled situacija** (2026-10-13, migracija 25, odluka klijenta): `situacije.pregled` ∈ {na_pregledu, odobrena,
  vracena} (+ `komentar`, `pregledao`, `pregledano`, `istorija jsonb[]`; sve u `situacije_v` i column grantu; stari
  redovi = odobrena). Tok: rukovodilac sačuva → `na_pregledu`; uprava (`isDirector()`, direktor I admin) `odobriSituaciju`
  ili `vratiSituaciju` (prompt, komentar obavezan) → `vracena`; rukovodilac `formSituacija(gr, sitId)` ispravi (postojeće
  stavke update, nove insert, prazne `obrisiRed` server-prvo — `saveSituacija` je async) i pošalje ponovo → `na_pregledu`.
  SERVER: `zastiti_kolone_situacije` ne-upravi forsira na_pregledu pri insertu, dozvoljava samo vracena→na_pregledu,
  diže grešku na izmenu odobrene; `zastiti_stavke_situacije` (definer) ne-upravi brani stavke odobrene situacije;
  istoriju (pregledao/pregledano/istorija) piše server pri SVAKOJ promeni `pregled` — klijent `zabeleziPregled` samo za
  trenutni prikaz. Tek ODOBRENA: `sitKasni`, `markPaid`, Naplata KPI „izdato", `realizacijaSituacija`; kumulativ/razlika
  (`preracunaj_situacije`) i dalje računaju sve situacije. Upozorenja: uprava „čeka pregled" (fin:true, `sit` → klik
  otvara `detaljSituacije`), rukovodilac „vraćena na doradu: komentar" (fin:false); brif broji oba. Log:
  `situacija_pregled` (odluka, komentar), `situacija_ponovo`. `pregledSit(s)` svuda (demo bez polja = odobrena). T54.
- **Magacin = šifarnik Izvođenja + Razno** (2026-10-12, odluka klijenta): `viewMagacin` lista SVE artikle
  `sifrarnikZa('izvodjenje')` (81 ELOM; broj se računa) sa stanjem iz `DATA.magacin` ili 0, plus sekciju „Razno" =
  redovi magacina koji nisu artikli šifarnika (demo m1–m3, `formArtikal` „Razno (van šifarnika)"). Red artikla nastaje
  tek na PRVOM ulazu (`saveMagPromena`, uprava) sa id-jem `'mg-'+sifarnik.id` (`MG_PREFIX`, `magacinArtikal(mid)` vraća
  postojeći ili virtuelan red) — render NIKAD ne gura virtuelne redove u DATA (diff bi poslao 81 insert; T53 to čuva).
  Izlaz se ne nudi na stanju 0. Filter `filtrirajMagacin` nad `#magTabela tr[data-txt]`. Tab „Magacin": uprava i
  profil sa modulom izvođenje (`tabDozvoljen`); radnik/spoljni na Izvođenju vide stanja (čitanje), ne menjaju. T53.
- **Trebovanje iz ugovorenog predmera** (2026-10-12): `formNarudzba` (široka, `kljuc:'trebovanje'`) ima dropdown
  `#nar_pm` sa pozicijama predmera izabranog gradilišta Izvođenja (`narPredmerOpcije`; Projektovanje = ništa),
  `osveziNarPredmer(grId)` na promenu gradilišta (grId = podrazumevano, jer select u stubu nema vrednost),
  „＋ Dodaj iz predmera" → `addStavka(p)`: red sa `readonly` nazivom, ugovorenom količinom kao POLAZNOM (slobodno se
  menja, nema klampa — odluka klijenta) i JM iz predmera (dodat u listu ako ga nema). `NAR_PM` = indeks reda →
  `predmer.id` (JS mapa, lekcija 32); `saveNarudzba` za takve redove čita naziv/JM/šifru iz DATA (već esc) i pamti
  `predmer_id`+`sifra` u `narudzbe.stavke` (jsonb, bez migracije). Mejl i kartica nose šifru i oznaku „predmer".
  Stub: `insertAdjacentHTML` je no-op — test proverava `stavkaRed(i,p)` direktno. T49.
- **Predmer iz investitorskog šablona** (2026-10-11): `upariPredmerSablon(redovi)` (isti način čitanja reda kao
  situacija; stavka = JM + količina + cena odmah iza JM, red bez cene se preskače; ukupno se NE čita nego računa
  kol×cena, a kad fajl ima ukupno koje odstupa >0,5 količina se uskladi sa njim i broji u `uskladjeno`; dedupe
  šifra+naziv; zbirni/recap redovi preskočeni). `predmerIzFajla(inp,cilj)` → `prikaziPredmerPripremu` →
  `PREDMER_PRIPREMA` → `dodajPredmerIzPripreme(gr)` (uprava; cena samo uz `canFinance`). Ulazi: novo gradilište
  Izvođenja (`formSite`, `pm_fajl`, primena u `saveSite` uz čekirane artikle i Razno) i „Uvezi iz Excela" na
  strani Predmer (`formPredmerImport`, `pm_fajl2`, pre nalepljenog). Fixture `test/fixtures/predmer-sablon.xlsx`;
  T47 uz pravi predmer OŠ (87 pozicija, 20.935.367 RSD) kad postoji lokalno.
- **Situacija iz Excela** (2026-10-11): `formSituacija` (Izvođenje, kad ima predmera) ima „⇧ Učitaj iz Excela" —
  `citajXlsx(buf, true)` čita SVE listove (investitorska PPS/okončana: list po vrsti radova), `upariSituaciju`
  prepoznaje stavke (JM = prvi kratak tekst posle opisa iza koga je broj; prazan opis → prethodni red; zaglavlje
  „кумулативно/kumulativ" bira kolonu, inače 4. broj posle JM; zbirni redovi „укупно" u opisu ILI šifri se
  preskaču; `broj2` traži cifru — „кол." nije 0), uparuje po `normPoz`, rezervno po jedinstvenoj `sifra`, i
  puni `st_k_<pm>` sa kumulativ − dosadašnje stavke. Fixture `test/fixtures/situacija.xlsx`; T46 uz pravu PPS
  (OŠ Dušan Radović) kad postoji lokalno: 67/67 (fajl nema list mašinskih). `.xls` se ne čita (binarni) — poruka.
  Dummy projekat `g-osdr` (87 pozicija iz predmera, cene bez PDV RSD) je na živoj bazi, rukovodilac Petar.
- `supabase/schema.sql` = kompletna šema za SVEŽU bazu (13 + 3 tabele, 3 view-a,
  helperi, polise, trigeri, `povezi_profil`). Postojeća baza: `migracija-01..26.sql` redom.
- **Šifarnik = samo Izvođenje** (2026-10-11, migracija 21, odluka klijenta): 81 artikal (ELOM) + usluge
  koje uprava doda ručno + „Razno" u formi (slobodne stavke: naziv, JM, količina, cena, zadužen →
  predmer bez šifre; `RAZNO_MODUL`, `dodajRaznoIzvodjenje`). 24 „pozicije radova" (`sf-i-*`, `SIFRARNIK_IZV`)
  su OBRISANE iz baze i iz demo-a. Projektovanje NEMA šifarnik u UI: sveske su tipovi dokumentacije
  (IDR / IDP-PGD / PZI + poddokumenti); redovi `sf-p-*` ostaju u tabeli kao izvor ček-liste, ali ih
  `sifrarnikKartica` ne prikazuje, dugme „Šifarnik artikala" se ne nudi u modulu Projektovanje, a
  `formSituacija` na projektantskom gradilištu nema „＋ iz šifarnika". Demo: 36 + 81 = 117 redova.
- **Projektovanje: sveske SU zadaci** (2026-10-11, migracija 20, odluka klijenta): svaka stavka
  specifikacije (`predmer` projektantskog gradilišta) ima zadatak sa `zadaci.predmer_id` (FK, on delete
  cascade), dodeljen `zaduzen`-u (ili rukovodiocu); čovek na njemu klikne play/pauza/stop.
  `sinhronizujSveske(gr)` (samo ko VODI: pravi zadatke koji fale, prati naziv/zaduzen, uklanja zadatke
  obrisanih stavki) zove se pri pokretanju (`sinhronizujSveskeSve` posle snapshota → diff gurne nove),
  posle `saveSite` (pro), `savePredmerRed`, `ubaciSablonNivoa`, `obrisiPredmerRed`. DEMO g8 ima t20–t24 sa
  `predmer_id` (inače bi boot-sync slao zadatke i rušio „nepromenjen DATA ne šalje ništa"). Status ↔ sveska:
  `done` → `predmer.izv=kol`, povratak iz done → `izv=0` ako je bila puna — server `trg_zadatak_sveska_izv`
  (definer, pa radi i za radnika), klijent `uskladiSveskuIzZadatka` SAMO ako vodi (radnik ne sme u predmer).
  Rukovodilac projektovanja dodaje/menja sveske (`smemPredmer`: predmer insert policy + `zastiti_kolone_predmer`
  za pro dozvoljava poz/jm/kol/zaduzen/sifra, ne cenu); Izvođenje: predmer i dalje samo uprava, zadataka nema.
  Ručni zadaci bez `predmer_id` (= „razno") i dalje postoje (`formTask`). T44.
  **Sveska = tip dokumenta, bez JM i količine (2026-10-14, odluka klijenta):** `formPredmerRed` na pro: nova = faza
  (`NIVOI_DOK` ključevi, podrazumevano `g.nivo`) + ček-lista dokumenata te faze koji još nisu u specifikaciji
  (`sveskeKandidati`, `osveziSveskeCeklistu`, `SV_KAND` k→sifrarnik.id) + jedan zadužen za sve; `savePredmerRed` dodaje
  redove `faza — naziv` sa `jm:'kom', kol:1` (napredak i done→izv=kol ostaju na snazi) i dedupe; izmena = samo zadužen
  (+ cena uz `canFinance`). Strana „Specifikacija usluga": kolone # · Sveska · Faza (`fazaSveske`) · Status (zadatak) ·
  Zadužen (· Cena), bez JM/Ugovoreno/Izvedeno/%; alati samo „Dodaj sveske" i „Ubaci šablon nivoa". T56.
  **Projektovanje NEMA situacija ni naplatu (2026-10-14, migracija 26):** `imaNaplatu(g)` = `!jePro(g)`; situacije se
  ne nude (fioka, `formSit`, `formSituacija` guard), ne listaju (Naplata, fioka, presek), ne prave upozorenja ni brif;
  tabla/kartica/fioka prikazuju „—"/ništa za naplatu; tab Naplata traži i modul izvođenje; `zdravlje(g)` i server
  `zdravlje_gradilista` preskaču penal „naplata zaostaje" za pro (formula na DVA mesta). Stare pro situacije (demo
  s20–s22, na bazi PF-01/26 g8, PF-01/26 i PF-02/26 g9) ostaju skrivene u bazi.
  **Fioka projektantskog gradilišta (2026-10-12, migracija 22, odluka klijenta):** NEMA „Tim na gradilištu" ni
  listu „Zadaci" — sekcija „Dokumentacija po osobi" (`sveskeHtml`): sveske grupisane po `zaduzen` (nedodeljene na
  kraju), status zadatka sveske, `tajmerLinija`, dokumenti uz svesku (`dokumenti.predmer_id`, FK on delete set null,
  u `dokumenti_v` i column grantu; `dodajDokument(o)` je testabilan deo `uploadDokument(gr, predmerId)`),
  „⬆ Učitaj dokument" po svesci, select „dodeli osobu" (`dodeliSvesku`, `smemPredmer`) i „＋ Nova sveska"
  (`formPredmerRed`, na pro nudi SVE ljude). Tim se IZVODI iz dodela: `sinhronizujSveske` → `osigurajUTimu`
  (z.grs / p.grs; rukovodilac se preskače) — bez toga radnik ne bi video gradilište (RLS `moje_gradiliste`). Nikoga ne
  uklanja. Opšti „Dokumenti gradilišta" na pro = samo bez `predmer_id`. `FIOKA_GR` + `osveziFioku(gr)` posle
  start/pauza/kraj tajmera i dodele. Ručni zadaci (bez `predmer_id`) se u fioci ne vide (Kanban ih i dalje ima). T50.
- **Šifarnik artikala + situacije sa stavkama** (2026-10-11, migracija 19): `sifrarnik.sifra` + 81
  artikal „ELOM projekt" (`ARTIKLI_ELOM` u index.html = seed u migraciji, ISTI sadržaj; izvor PDF
  „Sifarnik artikala" + 3 dopune 46/47/M029; `sf-a-NNN`, grupa „Artikli (ELOM)"); `predmer.sifra`
  (snimak pri izboru; `dodajIzSifarnika` dedupe po šifri, čita i cenu `f_sfc_k` kad `canFinance()`);
  ček-lista izvođenja ima filter (`filtrirajSifrarnik`, `.sf-red[data-txt]`). **Situacije:** `situacije`
  je sada FIN tabela po obrascu predmera — `iznos` bez SELECT granta, klijent čita `situacije_v`
  (`CASE vidi_finansije()`), `FIN_KOLONE.situacije=['iznos']`, NIJE više u `FIN_TABELE` (rukovodilac
  bez finansija vidi svoje situacije sa `iznos=null` → svaka suma `(b.iznos||0)`). Kolone `vrsta`
  (privremena|okoncana — samo oznaka), `autor`, `napomena`. `situacija_stavke(sit, gr, predmer_id, sifra,
  poz, jm, kol, kol_ugovoreno, kumulativ, razlika)` BEZ cena; `TABLES` je ima POSLE `predmer` (FK).
  Server `preracunaj_situacije(gid)` (definer): ugovoreno iz predmera, kumulativ po artiklu kroz situacije
  (izdato, id), razlika = max(0, kumulativ−ugovoreno), iznos = Σ kol×cena (samo situacije sa stavkama);
  trigeri na stavkama, situacije(izdato) i predmer(kol,cena), `pg_trigger_depth()` protiv rekurzije;
  `zastiti_kolone_situacije` (ne-uprava ne dira iznos/status/gr/autor, depth>1 pušta server). Klijent
  ISTO: `preracunajSituacijeLokalno` — formula na DVA mesta (+ mock `preracunSituacijeMock`), menjati sva tri.
  UI: `formSituacija(gr)` (smemNa; predmer + „＋ iz šifarnika", `SIT_DODATNE` mapa, NE skriveni input),
  `detaljSituacije`, fioka „Situacije", Naplata, `computeAlerts` fin-alert „preko ugovorene količine"
  (= uprava „dobija razliku"). `predmer.izv` se iz situacije NE menja (pravilo 5). T43.
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

## Nalozi (stanje 2026-10-11 — 6 test-profila, odluka klijenta)
- direktor: `miske1431@gmail.com` (profili.uloga=direktor, zaposleni_id null)
- admin: `admin@gradnjaos.test`
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
projektovanje; NIVOI_DOK šablon: IDR/IDP-PGD/PZI auto-popuna; SABLONI_FAZA šablon za
Izvođenje: 8 faza × zadaci po tipu visoko/niskogradnja, `primeniSablonFaza()` — od 2026-10-09 SAMO
na zahtev iz fioke `ubaciSablonFaza`, NE pri kreiranju; `fazeZa()` i dalje čita imena faza), resursi
(istek → upozorenja), magacin + mag_promene, izveštaji (openIzvestaj=za investitora bez
finansija, openPresek=interni sa finansijama, openKumulativ=izvedene količine), profili (auth).

## Pravila koja NE kršiti
1. **Šest uloga (od 2026-10-07, migracija 14; odluka klijenta):** `direktor` (super:
   sve + BRISANJE + dodela direktora), `admin` (sve bez brisanja; ne dira direktore),
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
   „Ukupno" situacije, „Plaćeno", kumulativ, izvoz — i dalje `canFinance()`. `preracunajSituacijeLokalno`
   piše `iznos` samo uz `canFinance()` (rukovodilac sa cenama ga ne računa — iznos je serverov). Tabovi po ulozi: `tabDozvoljen()` (uprava sve; ostali: tabla,
   gradilišta, rokovi, zadaci (samo modul projektovanje), dnevnik, magacin (samo modul izvođenje), trebovanje; `pay` samo `canFinance`
   I modul izvođenje — Projektovanje nema situacija).
   Klijent: `ULOGA`/`VIDI_FIN`/`JA` + `ROLE` ('all' = uprava, inače id osobe);
   `isDirector()` = UPRAVA (direktor|admin), `jeSuper()` = direktor, `vrstaUloge()`.
   Uloge žive na 4 mesta: check constraint, `dodeli_ulogu`, `ULOGE`, mock `rpc` — menjati
   sva 4. „Pogled kao": `setRole('all'|'admin'|'<z>'|'<z>:fin'|'radnik:<z>'|'spoljni:<p>')`
   + opcioni sufiks `|pro` / `|izv`.
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
   Tako `zdravlje(g)` = ugovoreno × izvedeno (+ rokovi, zadaci, finansije).
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

## Lekcije (vidi tasks/lessons.md — OBAVEZNO pročitati pre izmena)
36 lekcija; najvažnije za svaku izmenu:
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
