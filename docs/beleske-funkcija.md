# GradnjaOS — beleške po funkcijama (datirane, hronologija odluka i implementacije)

Ovo je istorija sa detaljima: šta je urađeno, kada, zašto, koje funkcije/migracije/testovi. Preseljeno iz `CLAUDE.md`
2026-10-22 da CLAUDE.md ostane kratak (pravila i invarijante). Pre izmene neke teme pročitaj ovde njen pasus.
Pravila koja NE smeju da se krše su i dalje u `CLAUDE.md` („Invarijante po temi" + „Pravila koja NE kršiti").
Nove beleške: dodaj OVDE (pasus sa datumom, odlukom, funkcijama i T-brojem), a u CLAUDE.md samo ako menjaju invarijantu.

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
- **Projektantsko gradilište NEMA „nivo" (2026-10-14, odluka klijenta: „trenutni nivo mi ne treba, sveske i ček-liste
  ispod mi trebaju"):** `formSite` ne nudi „Trenutni nivo (faza)" ni „Nivo dokumentacije" (izmena); `saveSite` upisuje
  `nivo:null` i ne menja ga; ček-lista svezaka po nivoima (IDR/IDP-PGD/PZI) sa zaduženima i Razno OSTAJU pri kreiranju.
  `ubaciSablonNivoa` + dugme OBRISANI (zavisili od nivoa); `gradilista.nivo` kolona ostaje (stari redovi), ne prikazuje se
  (`modLab`, fioka); `formPredmerRed` je koristi samo kao podrazumevanu fazu ako postoji. T29 prilagođen, D/e) testovi uklonjeni.
- **„Razno" u Projektovanju (2026-10-09):** `sifrarnikChecklist('projektovanje')` ispod svih svezaka
  nudi `#raznoBox` + `dodajRaznoRed()` (`f_nr_k`/`f_nrz_k`, brojač `RAZNO_N` — NE `getElementById`
  petlja, dom-stub vraća element za svaki id); `saveSite` pravi redove specifikacije
  `Razno — <naziv>` (esc, prazne preskače). Samo pri kreiranju. T40.
- **Kontrolna tabla (2026-10-09):** rokovi, dnevnik i „najrizičniji projekat" imaju
  `onclick="openSite"` (red tabele ga je već imao). T41.
- **XLSX pisač bez biblioteke** (2026-10-11; stilovi 2026-10-18): `napraviXlsx([{ime, redovi, kolone, spoji, zamrzni, stampa, visine}])` →
  Uint8Array (OOXML: Content_Types, rels, workbook (+`definedNames` print area, `calcPr fullCalcOnLoad`), `styles.xml`,
  sheet-ovi; ZIP STORED + `crc32`). Ćelija = primitiv ILI `{v, f, s}`: `f` = formula bez `=` uz `v` kao KEŠIRANU vrednost
  (`citajXlsx`/testovi je čitaju iz `<v>`, Excel preračuna), `s` = `{b, fill:'RRGGBB', h, va, wrap, fmt:'num'|'din'|'dincir'|'txt',
  bd:false}` internira se u `cellXfs` (font Century Gothic 11 za ceo dokument, tanka ivica podrazumevano za stilizovanu ćeliju;
  `XLSX_FMT`). Broj → `<v>`, tekst → inlineStr (`xmlEsc`), tekst+formula → `t="str"`. `xlsxImeLista` = ista sanitizacija imena
  lista za `<sheet name>` i za reference u formulama. `preuzmiXlsx(ime, listovi)`
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
- **Izvoz situacije u investitorskom šablonu, latinica/ćirilica** (2026-10-16, migracija 29, zahtev klijenta): dugmad
  „⬇ Excel (latinica / ćirilica)" u `detaljSituacije` + „⬇ lat · ćir" (`izvozLinkovi(s)`) uz svaku situaciju u fioci
  gradilišta i u tabu Naplata (zahtev 2026-10-16: nije se nalazilo) → `izvozSituacije(sitId, 'lat'|'cir')` (`smemIzvozSituacije` = vidi
  gradilište I cene: uprava ili rukovodilac gradilišta Izvođenja — ODLUKA 2026-10-16: dokument za investitora mora imati
  iznose, pa ih rukovodilac bez finansija ovde dobija iz jediničnih cena koje već vidi (`vidimCene`); `situacije_v.iznos`
  i UI ostaju kao pre). Šablon = isti kao ulazna PPS/okončana: list po vrsti radova, sekcija („4.0 ДЕМОНТАЖНИ РАДОВИ") +
  „UKUPNO <sekcija>", naslov nadpozicije iznad stavki, trojke kolona kol · jed. cena · ukupno za UGOVORENO ·
  KUMULATIVNO · PRETHODNE · (okončana: svaka ranija situacija I/II/…) · OVA, REKAPITULACIJA po listu + list
  REKAPITULACIJA (+ red „Preostalo"). Kumulativ je serverov (`stavka.kumulativ`), prethodne = kumulativ − ova; pozicije
  bez stavke 0; stavke bez `predmer_id` na list „VAN PREDMERA". Naslovi su DVA literalna skupa (`SIT_H.cir/lat`), ne
  transliteracija. **Izgled = investitorov fajl (2026-10-18):** Century Gothic 11, tanke ivice, naslov i sekcije siva D9D9D9,
  KUMULATIVNO žuta FFFF00, ranije situacije narandžasta FFC000, OVA zelena 92D050 (i ćelije stavki u toj trojci), spojene
  ćelije zaglavlja (naslov + svaka grupa), širine 6.6/58/8.4 + 10.7/18.7/18.3 po trojci, zamrznuto 6 redova, landscape +
  fit to width + print area, format `#,##0.00` / `#,##0.00 din.` (ćir. `дин.`). FORMULE sa keširanom vrednošću: ukupno
  `=Kol*Cena`, kumulativ `=Prethodne+Ova` (okončana: zbir svih ranijih + ova), prethodne (okončana) = zbir ranijih, cene
  kumulativa/prethodnih/ove `=E<red>`, UKUPNO sekcije `SUM` nad redovima sekcije, rekapitulacija lista referencira UKUPNO
  sekcija (+ `bezSek`: stavke lista koje nisu ni u jednoj sekciji dodaju se kao `+F<red>` u UKUPNO lista — nalaz pregleda
  2026-10-22), list REKAPITULACIJA referencira `'<list>'!<UKUPNO>`, „Preostalo" `=F−I`; dupli naziv lista dobija ` (2)`. Visine samo za zaglavlje (redovi 4–6);
  redovi stavki bez visine (Excel sam prelama wrap tekst). **`predmer.izvor jsonb`** = {list, sekcija, nadpoz, cir} u ORIGINALNOM pismu iz uvezenog fajla
  (`citajXlsx` sada daje `red.list` iz workbook.xml+rels i `red.izvorno` = ćelije pre `cir2lat`; `upariPredmerSablon`:
  naslov velikim slovima = sekcija, osim ako ODMAH iza njega ide stavka bez šifre; mešovita slova = nadpoz; stavka sa
  sopstvenom šifrom briše nadpoz; `escIzvor` pri upisu). Nije finansijska kolona (grant + `predmer_v` NA KRAJU — view ne
  menja redosled kolona), ne-uprava je ne menja (trigger). Izvoz: `T()` = unesc → ćirilica: tekst koji već jeste ćiriličan
  ostaje, inače `lat2cir` (token sa cifrom/qwxy ili iz `LAT_OSTAJE` ostaje latiničan); latinica: `cir2lat`. g-osdr je
  popunjen iz originalnog predmera (87/87, 4 lista); g-dm1..3 nemaju izvor → jedan list „PREDMER". T58.
- **Situacija iz Excela** (2026-10-11): `formSituacija` (Izvođenje, kad ima predmera) ima „⇧ Učitaj iz Excela" —
  `citajXlsx(buf, true)` čita SVE listove (investitorska PPS/okončana: list po vrsti radova), `upariSituaciju`
  prepoznaje stavke (JM = prvi kratak tekst posle opisa iza koga je broj; prazan opis → prethodni red; zaglavlje
  „кумулативно/kumulativ" bira kolonu, inače 4. broj posle JM; zbirni redovi „укупно" u opisu ILI šifri se
  preskaču; `broj2` traži cifru — „кол." nije 0), uparuje po `normPoz`, rezervno po jedinstvenoj `sifra`, i
  puni `st_k_<pm>` sa kumulativ − dosadašnje stavke. Fixture `test/fixtures/situacija.xlsx`; T46 uz pravu PPS
  (OŠ Dušan Radović) kad postoji lokalno: 67/67 (fajl nema list mašinskih). `.xls` se ne čita (binarni) — poruka.
  Dummy projekat `g-osdr` (87 pozicija iz predmera, cene bez PDV RSD) je na živoj bazi, rukovodilac Petar.
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
  posle `saveSite` (pro), `savePredmerRed`, `obrisiPredmerRed`. DEMO g8 ima t20–t24 sa
  `predmer_id` (inače bi boot-sync slao zadatke i rušio „nepromenjen DATA ne šalje ništa"). Status ↔ sveska:
  `done` → `predmer.izv=kol`, povratak iz done → `izv=0` ako je bila puna — server `trg_zadatak_sveska_izv`
  (definer, pa radi i za radnika), klijent `uskladiSveskuIzZadatka` SAMO ako vodi (radnik ne sme u predmer).
  Rukovodilac projektovanja dodaje/menja sveske (`smemPredmer`: predmer insert policy + `zastiti_kolone_predmer`
  za pro dozvoljava poz/jm/kol/zaduzen/sifra, ne cenu); Izvođenje: predmer i dalje samo uprava, zadataka nema.
  Ručni zadaci bez `predmer_id` (= „razno") i dalje postoje (`formTask`). T44.
  **Sveska = tip dokumenta, bez JM i količine (2026-10-14, odluka klijenta):** `formPredmerRed` na pro: nova = faza
  (`NIVOI_DOK` ključevi, podrazumevano staro `g.nivo` ako postoji, inače IDR) + ček-lista dokumenata te faze koji još nisu u specifikaciji
  (`sveskeKandidati`, `osveziSveskeCeklistu`, `SV_KAND` k→sifrarnik.id) + jedan zadužen za sve; `savePredmerRed` dodaje
  redove `faza — naziv` sa `jm:'kom', kol:1` (napredak i done→izv=kol ostaju na snazi) i dedupe; izmena = samo zadužen
  (+ cena uz `canFinance`). Strana „Specifikacija usluga": kolone # · Sveska · Faza (`fazaSveske`) · Status (zadatak) ·
  Zadužen (· Cena), bez JM/Ugovoreno/Izvedeno/%; alat samo „Dodaj sveske" (`ubaciSablonNivoa` obrisan 2026-10-14). T56.
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
- **AI asistent direktora** (2026-10-21, zahtev klijenta; nivo 1): NIJE tab — plutajuće dugme gore desno (`#aiDugme`,
  `.ai-dugme.vidi` samo `jeSuper()`, broj = situacije na pregledu + crvena upozorenja, `aiBroj`) otvara panel `#aiPanel`
  sa desne strane na svakom tabu (`renderAi()` iz `render()`; na ≤900 px dugme je dole desno iznad bnav-a). Panel: 4 brojke
  „danas" (klik = pitanje), razgovor, čipovi, unos; `aiOtvori/aiZatvori`, `AI_OTVOREN`. ARHITEKTURA: Edge Function `supabase/functions/ai-asistent/` je tanki posrednik ka
  Anthropic Messages API-ju — čuva `ANTHROPIC_API_KEY` (secret, NIKAD u repou/klijentu), proverava JWT → `profili.uloga='direktor'`
  (403 inače; `verify_jwt` nije dovoljan jer je anon ključ validan JWT), prosleđuje samo `system/messages/tools/max_tokens`
  (model iz `AI_MODEL`, podrazumevano `claude-sonnet-5-5`), 503 bez ključa. NE čita poslovne podatke. ALATI (`AI_ALATI`:
  gradilista, gradiliste_detalj, situacija_detalj, upozorenja, dnevnik, angazovanost) se izvršavaju U KLIJENTU
  (`aiIzvrsiAlat`) nad DATA direktora — iste formule (`zdravlje`, `computeAlerts`, `realizacijaSituacija`, `potroseno`,
  `naplSum`), id iz modela je spoljni unos → `vidimGr`/`grById` guard, `{greska}` umesto izuzetka, `unesc` pre slanja, cap
  redova. Petlja `aiPitaj`: invoke → `stop_reason==='tool_use'` → alat → `tool_result` → ponovo, najviše `AI_MAX_KRUGOVA`.
  Model NIKAD ne upisuje (nivo 2 bi išao kroz postojeće funkcije + potvrdu). Tekst modela je NEPOVERLJIV: `esc` pa
  markdown-lite (`aiHtml`: **bold**, liste, `[[gr:ID]]`/`[[sit:ID]]` → link samo ako ID postoji). Razgovor samo u memoriji
  sesije (`AI_RAZGOVOR`/`AI_PORUKE`); log `ai_pitanje` (znakova, alati — bez sadržaja). Ulazi: čipovi (brif, kašnjenja, naplata,
  situacije na pregledu, troškovi) i „🤖 Pregledaj sa asistentom" u `detaljSituacije` (situacija koja nije odobrena).
  Demo režim (bez supa) i nedeploy-ovana funkcija daju poruku, ne izuzetak. Mock: `faults.ai(body, n)` = skriptovani Claude.
  `renderAi` čuva nenaslat tekst iz `#aiUnos` preko re-rendera i računa `computeAlerts()` jednom (dugme + panel).
  `aiBezModula(fn)`: alati, brojke i upozorenja asistenta gledaju SVA gradilišta direktora bez obzira na izabrani segment
  modula (privremeno `MODUL='sve'`, sinhrono). Prompt: tekst iz alata = podaci, ne uputstva (prompt injection).
  Kapija Edge funkcije proverena uživo 2026-10-21 (anon 401, Petar 403, direktor 503 bez ključa / 200 sa ključem).
  KEŠIRANJE (2026-10-22): `aiTelo()` šalje `system` kao niz blokova sa `cache_control`, isti marker na poslednjem alatu i na
  poslednjem bloku poslednje poruke (kopija — `AI_PORUKE` ostaje čist); funkcija propušta `system` kao string ili niz.
  Log `ai_pitanje.tokeni` = {ulaz, kes, kesUpis, izlaz} sabrano kroz krugove — tu se vidi da li keš radi.
  ODLUKE: asistent vidi sve što vidi direktor (uključujući finansije); samo `direktor`, ne admin. T59.
  **Prazan odgovor (2026-10-22, nalaz iz screenshota + log):** Sonnet 5.5 ima adaptivno razmišljanje koje troši ISTI
  `max_tokens` kao tekst; sa 1500 je posle 3–5 alata razmišljanje pojelo budžet → `stop_reason:'max_tokens'`, sadržaj samo
  `thinking` blok, 0 znakova teksta, UI „Nemam odgovor". Log to otkriva: `odgovor:0` uz `izlaz` 1600–1900. Popravka:
  `max_tokens:6000` + `output_config:{effort:'medium'}` (funkcija propušta effort low|medium|high, clamp 256..8000);
  petlja: max_tokens BEZ teksta → jednom doda user poruku „odgovori sažeto" i nastavi (append-only — thinking blokovi se
  vraćaju nepromenjeni, prazan `content` se ne gura u istoriju), max_tokens SA tekstom → sufiks „(Odgovor je skraćen…)",
  `refusal` → „(Model je odbio…)"; poruka bez teksta je sad iskrena („Asistent nije vratio tekst…"). Istorija je UVEK
  append-only (nikad ne skraćivati stare tool_result-e — editovanje istorije obara thinking blokove, 400 za nove naloge);
  kad razgovor pređe 300 KB funkcija vraća 413 → „Novi razgovor". T59 nastavak.
  **Nivo 2 + streaming + potrošnja (2026-10-22, „sredi mi sve tačke"):** (1) alat `predlozi_akciju` (odobri_situaciju /
  vrati_situaciju sa komentarom / novi_zadatak / pozovi_rukovodioca) — `aiPredloziAkciju` NIŠTA ne upisuje: validira id-jeve
  (vidimGr/smemNa, `pregledSit==='na_pregledu'`, jePro), esc-uje tekst modela, dedupe tip+id, puni `AI_PREDLOZI`, modelu vraća
  „prikazano kao dugme, NIJE izvršeno"; posle petlje predlozi idu uz bot poruku (`akcije`), `aiPanelHtml` crta dugmad,
  `aiAkcija(idx,i)` ponovo proverava guardove pa zove POSTOJEĆE funkcije: `odobriSituaciju` iza `confirm`,
  `vratiSituaciju(id, predlog)` (predlog = podrazumevani tekst u promptu), `formTask(pre)` (popunjena forma, „Sačuvaj" je
  potvrda), `tel:` link; odobri/vrati se označe ✓; log `ai_akcija`. Prompt: „nikad ne tvrdi da je akcija urađena".
  (2) streaming: `AI_STREAM` (samo uz `window.fetch`; stub ide kroz invoke), `aiPozovi(telo, onTekst)` šalje `stream:true`
  fetch-om sa svežim access tokenom (`supa.auth.getSession`), `aiCitajSSE` sastavlja ISTE blokove kao non-stream odgovor
  (text, tool_use sa JSON iz `input_json_delta`, thinking sa `signature_delta`) + stop_reason/usage iz `message_delta`; tekst
  se ispisuje u `#aiTok` kako stiže; greška pre prvog događaja → fallback na invoke, posle → greška (bez duplog poziva).
  Funkcija (v6) prosleđuje `r.body` kao `text/event-stream`. Proba uživo (proba_sse.py): text/event-stream, tool_use blok iz toka vraćen
  nazad u sledeći krug → tekst; thinking+signature sastavljanje pokriveno testom (u probi model nije razmišljao). (3) kartica „Asistent — potrošnja <mesec>" u Admin kokpitu: sopstveni upit nad
  `log_koriscenja` (eq ai_pitanje, gte prvi dan meseca), `aiPotrosnjaIz` → `AI_CENE` (Sonnet 5.5 USD/M: 2/10/0,20/2,50,
  limit 30) → USD + traka; mock dobio `gte`. T59 nivo 2, T59 streaming, T28 potrošnja.
  **Ispravka prompta (2026-10-23, screenshot):** na „Gde troškovi idu ispred napretka?" model je pozvao gradilista+upozorenja
  pa predlozi_akciju i u tekstu napisao SAMO „dugme za poziv je ispod" (104 znaka) — opis alata je glasio „u tekstu samo reci
  da je dugme ispod" i model ga je uzeo doslovno. Sad: alat se zove TEK POSLE punog odgovora, „odgovor koji sadrži samo
  pominjanje dugmeta je neispravan" (prompt + opis alata).

- **Auto-pauza zaboravljenog tajmera** (2026-10-22, migracija 31 + 31a, zahtev klijenta: „ako radnik projektovanja zaboravi
  pauzu/kraj, zadatak se sam pauzira u 16:00 — ne bih da imamo zadatke od jako puno sati"): pravilo = granica sesije je
  16:00 po Beogradu na dan početka; ako je sesija počela u 16:00 ili kasnije, granica je ponoć tog dana (rad posle 16 h se
  beleži, zaboravljen tajmer ne prelazi u sutra; alternativa „do 16:00 sutra" bi vratila baš inflaciju koju klijent izbegava).
  SERVER zatvara: `granica_auto_pauze(start)` (immutable SQL), `auto_pauza_tajmera()` (definer; `for update skip locked`,
  kraj = greatest(start, granica), `napomena += ' [auto-pauza 16:00]'`, log `zadatak_pauza` sa `auto:true, razlog:'16:00'`,
  user_id iz `profili.zaposleni_id=osoba`, 'uprava' → null), pg_cron job `auto-pauza-tajmera` `*/15 * * * *` (UTC; minuta
  ne zavise od trenutka pokretanja). `rad_minuta()` trigger: na UPDATE zatvorene sesije `kraj` ostaje stari — inače bi ustajali
  tab (korisnik sutra klikne Pauziraj) poslao kraj=sad i vratio skinute sate. KLIJENT ne zatvara ništa: `AUTO_PAUZA_SAT=16`,
  `granicaAutoPauze(start)` (sat uređaja, pravilo 10), `sesijaOtvorena(s)` umesto `!s.kraj` u `mojaOtvorenaSesija`,
  `otvorenaSesija`, oba `tuda`, `angOtv`; `minSesije` odseca otvorenu sesiju na granici → dugme „▶ Nastavi", angažovanost
  ne raste, nijedan klijent ne šalje kraj posle granice; ustajali red (kraj null) diff ne dira, zameni ga sledeće učitavanje.
  Demo režim (bez baze) nema cron — red ostaje bez kraja, prikaz odsečen. Proba na bazi 2026-10-22: 10:00 → 16:00/360 min,
  17:00 → 00:00/420 min, sveža ostala otvorena, Sarin update kraj=now() na zatvorenoj ignorisan, log red upisan. Server
  `angazovanost()` RPC otvorenu sesiju i dalje broji do now() (prozor ≤15 min — ostavljeno). T61.
