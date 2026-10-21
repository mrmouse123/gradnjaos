# Pregled arhitekture — preostala dva nalaza (2026-10-22) — GOTOVO

## Plan
- [x] 1. Validacija id-jeva pri ucitavanju: `ocistiIdeve(DATA)` na pocetku `normalizeData` (id/FK polja + grs/bivsi),
      red sa neispravnim id-jem se izbacuje i broji (console.warn), nikad se ne "popravlja". T60.
- [x] 2. CLAUDE.md: datirane beleske po funkciji (221 linija) preseljene u `docs/beleske-funkcija.md`; u CLAUDE.md
      ostaje kompaktna lista "Invarijante po temi" sa pokazivacem + sekcija "Gde sta pise". 661 → 440 linija.
- [x] 3. e2e 958/0, provera id-jeva na zivoj bazi, commit/push, Pages.

## Review
- `osoba` je u `clijenti`/`podizvodjaci` IME kontakta (slobodan tekst), a id samo u `rad_na_zadatku` — prvi nacrt sa
  globalnom listom polja izbacio je svih 10 demo klijenata/podizvodjaca (19 testova palo). Resenje: `ID_POLJA_TABELE`
  po tabeli. Lekcija: isto ime polja ne znaci isti tip podatka — proveriti DEMO pre pravila nad poljem.
- Odluka: los red se IZBACUJE, ne sanira. Saniranje bi napravilo novi id → diff bi ga poslao kao insert i duplirao red.
- Ovo je odbrana u dubinu: id-jeve pisu samo autentifikovani korisnici kroz app (esc nije primenjen na id jer ih app
  generise), pa je realan vektor samo REST poziv mimo app-a sa validnim JWT-om. Posle validacije ni to ne prolazi.

# 2026-10-21: AI asistent direktora (nivo 1)
- [x] Edge Function `ai-asistent` (kapija: JWT → direktor; prosleđuje Claude-u; bez ključa 503) — deploy kroz MCP
- [x] Klijent: tab Asistent (samo direktor), 6 alata nad DATA, petlja tool_use (cap 6), markdown-lite + linkovi, čipovi, dugme u detalju situacije, log ai_pitanje
- [x] Mock faults.ai, T59 (2 provere), e2e
- [ ] Jovan: ANTHROPIC_API_KEY u Supabase → Edge Functions → Secrets, pa proba uživo
- [ ] Nivo 2 (akcije uz potvrdu) i nivo 3 (dokumenti, prognoze) — posle probe

# 2026-10-16: izvoz situacije u investitorskom šablonu (lat/ćir), predmer.izvor
- [x] Migracija 29 (živo + schema.sql): predmer.izvor jsonb {list, sekcija, nadpoz, cir}; predmer_v (na kraju), grant, trigger
- [x] citajXlsx: imena listova (workbook.xml + rels) + red.izvorno; upariPredmerSablon puni izvor (sekcija/nadpoz heuristika sa pogledom unapred); g-osdr popunjen iz originalnog predmera
- [x] izvozSituacije lat/cir (SIT_H, lat2cir, rimski), dugmad u detalju situacije; odluka: rukovodilac bez finansija dobija iznose u izvozu
- [x] T58 (3 provere), e2e 955/0
- [ ] Obračunski list građevinske knjige (list po poziciji, mesečne količine) — ponuđeno kao sledeći korak

# 2026-10-14: direktori modula (direktor_projektovanja / direktor_izvodjenja)
- [x] Migracija 27 (živo + schema.sql): uloge + constraint modula, je_direktor() obuhvata direktore modula, modul iz imena uloge (moji_moduli), vodim_gradiliste = uprava ∧ modul_dozvoljen, smem_brisati, modul_moj za INSERT gradilišta; 24 polise sa golim je_direktor/je_super nad tabelama sa gr prepisane; obrisi_gradiliste/angazovanost/dodeli_ulogu/ukloni_pristup
- [x] Klijent: MODUL_ULOGE/DIREKTORSKE/jeUpravaUloga, primeniUlogu, jeSuper = samo direktor, smemBrisati, upravaSve, smemNa po modulu, visibleSites filter i za upravu, tabDozvoljen, setRole dirpro/dirizv, Pogled kao, Admin kokpit (smemDodelitiUlogu/smemMenjatiNalog, čekboks modula), formSite
- [x] Mock + T57 (2 provere), e2e 957/0; RLS proba na bazi kao direktor_projektovanja (admin privremeno flipovan u transakciji, vraćen)
- [ ] Jovan: napraviti test-naloge za dve nove uloge (Add user u dashboardu → Admin kokpit kao direktor)

# 2026-10-12: trebovanje iz predmera · fioka Projektovanja · cene/adresa/play · bez marže · zdravlje ×2 · pregled
- [x] Trebovanje iz ugovorenog predmera (dropdown pozicija, zaključan naziv, ugovorena kol. kao polazna, predmer_id+sifra u stavci, mejl/kartica) — 53c3353, T49
- [x] Fioka Projektovanja: bez tima i liste zadataka → „Dokumentacija po osobi" (sveske po zaduženom, status, tajmer, dodela, dokument uz svesku) — migracija 22 (dokumenti.predmer_id), tim izveden iz dodela (osigurajUTimu) — deb201d, T50
- [x] Tabla bez plan. marže; jedinične cene za rukovodioce Izvođenja (migracija 23 predmer_v, vidimCene, mock rukIzv; cene fiksira uprava); adresa gradilišta (kolona, view, trigger, forma/fioka/kartica/izveštaji/mejl/pretraga); play samo na jednom zadatku — 75213b8, T51
- [x] Tabla bez upozorenja o marži — 9a36e44
- [x] Marža uklonjena SVUDA (funkcije, CSS, tabla, kartica, fioka, presek, formula zdravlja klijent + server migracija 24: završen = 100) — 5329155; T17 čuva da reči nema u izvoru
- [x] Izvođenje: zdravlje na dva načina — status/skor + „Ugovoreno vs situacije" (predmer Σ kol×cena vs privremene vs okončana = Σ svih situacija; kolona, fioka, presek; canFinance) — 6eeadce, T52
- [x] Pregled: Karpathy (siroče `zad`, duplirana pretraga sesije → `mojaOtvorenaSesija`, mrtve `TABOVI_UPRAVA`/`moduliOsobe`; skener: 395 deklaracija, 0 bez upotrebe) + Boris Cherny (nezavisni subagent-pregled diffa, lekcije 34–36)

## Review (2026-10-12)
- Živa baza: migracije 22–24 primenjene; RLS probe: Sara dokument uz svesku (insert+view), Petar 87/87 cena na OŠ bez budžeta/iznosa, Sara 0 cena; zdravlje pre→posle = +10 samo gde je bio penal marže (g3, tri „planirano" test-gradilišta), završeno ostaje 100.
- Iznenađenja: (1) sopstveni komentar „Marza je UKLONJENA" oborio test koji skenira izvor; (2) okončana situacija nosi PRIRAST, pa je „okončana (ukupno)" = Σ svih situacija — savetnik uhvatio pre commit-a; (3) screenshot panel je deo dana bio isečen, fioka proverena DOM-om.
- Ostaje na odluci: `gradilista.troskovi` (planirani troškovi) + podrazumevanih 85% cene pri kreiranju — jedini preostali „profitni" ostatak; Kanban/„＋ Zadatak" i ručni zadaci u Projektovanju; radnik u fioci vidi sve sveske projekta (tajmer samo na svojoj); rukovodilac bez finansija ne vidi „Ugovoreno vs situacije" (iznos=null) — moguća varijanta po količinama; stari zadaci Izvođenja u bazi (skriveni) — brisanje čeka „da".
- Nalozi nezavisnog pregleda (subagent, diff e7dba13..HEAD) — ispravljeno: (1) kol×cena po redu i iznos stavke su bili iza `vidimCene` → sad `canFinance()` (zbir kolone bi otkrio skriveni `iznos`); (2) promena gradilišta u trebovanju ostavljala redove iz predmera STAROG gradilišta (tiho degradirani u slobodan tekst) → `osveziNarPredmer` ih uklanja + guard u `saveNarudzba`; (3) ulazak u tim pri boot sync-u nije ulazio u `n`, pa se nije čuvao → `n++`; (5) `sitKol` deklarisan posle `rowHtml` (TDZ) → pomeren; (7) mock `rukIzv` sad gleda i module naloga; (8) `dodeliSvesku` proverava da osoba postoji; (9) duplo „⏱ ukupno" u fioci. Ostavljeno: (6) reset sorta `sit` i za `:fin` rukovodioca (isti obrazac kao cena/naplata), (10) sort kolone po % privremenih. Čisto: formule klijent/server, guardovi, XSS, th/td, pravila 7/8.

# Sifarnik samo Izvodjenje (81 + Razno), Projektovanje bez sifarnika (2026-10-11)
- [x] Migracija 21: delete sf-i-* (24 pozicije radova) — zivo + schema.sql
- [x] Klijent: demo bez SIFRARNIK_IZV, kartica samo Izvodjenje (bez izbora modula), dugme skriveno u Projektovanju, Razno u Izvodjenju (naziv/JM/kol/cena/zaduzen), situacija pro bez sifarnika
- [x] Testovi: brojevi 117/81, sf-a-001, Razno izvodjenje; e2e 976/0
- [x] Docs, commit/push

# Zadaci = sveske (Projektovanje), bez zadataka u Izvodjenju (2026-10-11)
- [x] Izvodjenje: fioka bez Zadataka/sablona, Kanban/rokovi/forma samo projektantska gradilista (dd22bd8)
- [x] Migracija 20: zadaci.predmer_id, predmer insert za rukovodioca pro, trigger done→izv (zivo, SQL matrica Nikola/Sara/Petar)
- [x] Klijent: sinhronizujSveske/uskladiSveskuIzZadatka, smemPredmer, demo t20–t24, T44, e2e 975/0
- [x] Browser smoke (fioka Izvodjenja bez zadataka; rukovodilac pro: + Dodaj svesku bez cene; Kanban = sveske; radnik 3 sveske sa Pocni), commit/push, Pages

# Sifarnik artikala + situacije sa stavkama (2026-10-11)
Trazeno: PDF „Sifarnik artikala" (ELOM, 78) + 3 dopune u sifarnik Izvodjenja; uprava iz cekliste bira
materijale sa kolicinom i cenom; rukovodilac pravi privremenu/okoncanu situaciju iz istih stavki
(+ usluge), kolicine mogu odstupati; razliku dobija uprava (dogovor sa investitorom).
- [x] 1. Migracija 19 (sifra, situacije_v + FIN iznos, situacija_stavke, preracunaj_situacije, trigeri) — zivo, proverena SQL matricom (Petar/direktor/Milos)
- [x] 2. Artikli: PDF → 81 red (prelomljeni redovi, zalepljene JM) → ARTIKLI_ELOM + seed
- [x] 3. Klijent: ceklista (sifra, cena, filter), dodajIzSifarnika, predmer sifra, formSituacija/saveSituacija/detaljSituacije, fioka, Naplata, alert razlike, brisanje
- [x] 4. Mock + T43, e2e 973/0
- [x] 5. Browser smoke (demo: 105 redova + filter + cena; z7 fioka bez iznosa; detalj), docs, REST proba (Petar/direktor, pociscena), commit/push, Pages
Odluke (reci Jovanu): predmer.izv se NE menja iz situacije; okoncana = samo oznaka; stavke van predmera nemaju cenu (0 u iznosu) dok ih uprava ne doda u predmer.

# Modul po nalogu + 6 test-naloga + Admin kokpit bez sifarnika (2026-10-11)
Trazeno: rukovodilac = projektovanje | izvodjenje | oba (+ finansije da/ne); radnik = tacno jedan modul
(projektovanje: meri zadatke start/pauza/stop; izvodjenje: bez zadataka, podizvodjaci). 6 test-profila.
Iz Admin kokpita ukloniti sifarnik.
- [x] 1. Migracija 18 (profili.moduli, modul_dozvoljen u vodim/moje_gradiliste, nalozi_pregled, dodeli_ulogu 6-arg + omotac) → zivo + schema.sql
- [x] 2. Klijent: MODULI/primeniUlogu/modulDozvoljen, visibleSites, modulSeg, tabDozvoljen(tasks), bnav, setRole |pro/|izv, roleOptions
- [x] 3. Admin kokpit: moduli u formi i redovima, dodeliUlogu p_moduli, ulogaLabela; bez sifarnika → formSifrarnik modal iz Gradilista (uprava)
- [x] 4. Mock + testovi (T42), e2e 968/0
- [x] 5. Podaci: trtr/test 1 → z17; z10 u tim g9 + 3 zadatka; 4 auth naloga (admin, nikola, sara, milos) + profili
- [x] 6. Ziva provera (4× login OK; matrica: admin 12 gr, nikola 3 pro + budzeti, petar 2 izv bez budzeta, sara 2 gr + 3 svoja zadatka, milos 2 gr + 0 aktivnih): curl login ×4, set local role matrica (ruk-pro, ruk-izv, radnik-pro, radnik-izv)
- [x] 7. Docs (CLAUDE.md pravilo 1, README), memorija (nalozi bez lozinki), commit/push
Nije u opsegu (reci Jovanu): formTim filtriranje radnika po modulu (klijent ne vidi tudje profile).

# Pregled izmena 2026-10-09/10 po skilovima (2026-10-10)
Opseg: commit d7852b9..de95673 — bez auto-zadataka pri kreiranju, „Razno" ceklista
(projektovanje), Pauziraj/Nastavi/Zavrsi SAMO u Projektovanju, klikovi na kontrolnoj tabli.
Redosled: boris-cherny (plan + subagenti + verifikacija) → /code-review → /security-review.

- [x] 1a. Subagent A (explorer): 9 nalaza (1 bug, 5 rizika, 3 nita)
- [x] 1b. Subagent B (worker, worktree): mutacije 8/10 uhvacene; M4 (info-linija na Izvodjenju) i M10 (RAZNO_N reset) nisu → dodate asercije
- [x] 2. /code-review: 8 nalaza prijavljeno, 7 ispravljeno, 1 svesno preskocen (Zavrsi bez confirm-a = odluka)
- [x] 3. /security-review: 0 nalaza ≥ prag (1 kandidat 3/10: id gradilista u onclick — samo uprava pise id-jeve)
- [x] 4. Ispravke + e2e 965/0 + commit
- [x] 5. Review sekcija ispod

## Review (2026-10-10)
Ispravljeno: (1) svoja otvorena sesija se uvek moze zaustaviti — i na Izvodjenju (nasledjena) i na
zadatku prevucenom u Zavrseno („⏸ Zaustavi tajmer"); (2) `dropTask` u done zatvara svoju sesiju;
(3) `zadatak_kraj` loguje `minuta` (svoja sesija) + `ukupno` (ceo zadatak), log prikazuje oba;
(4) „Razno" samo uz eksplicitan `razno=true` (formSite), brojac se resetuje pri svakom renderu;
(5) „▶ Nastavi" samo po SVOJIM sesijama; (6) testovi: a2 blok vise ne moze tiho da se preskoci,
T41 trazi >0 klikova za rukovodioca i obavezan brif za upravu, drag-u-done test, M4/M10 asercije.
Iznenadjenje: baza nema otvorenih sesija (obe zatvorene), pa niko nije bio zaglavljen.
Preskoceno svesno: Zavrsi bez potvrde (postoji Pauziraj; vracanje = prevuci karticu nazad).

# 6 uloga (2026-10-07, odluka klijenta)

Trazeno: Direktor/IT super admin (sve + delete + dodela uloga), Admin (sve bez delete +
dodela uloga), Rukovodilac 1 (svoja gradilista + finansije + dodela ljudi), Rukovodilac 2
(isto bez finansija), Radnik (dodeljena gradilista: view/edit/delete svojih unosa +
dokumenta), Spoljni saradnik (kao radnik). "Gradilista sa merama iz sifrarnika".

Model: profili.uloga ∈ {direktor, admin, rukovodilac, radnik, spoljni} + vidi_finansije
(bool; Rukovodilac 1 = rukovodilac + true) + saradnik_id (spoljni -> podizvodjaci.id).
Serverski helperi: je_super (direktor), je_direktor = UPRAVA (direktor|admin — ime ostaje
zbog 60 polisa), vidi_finansije, moj_saradnik, moje_gradiliste (citanje: uprava |
rukovodilac | clan tima | saradnik na gradilistu), vodim_gradiliste (pisanje: uprava |
rukovodilac). Delete polise -> je_super. Radnik/spoljni: dnevnik (svoj: insert/update/
delete), zadaci (svoj: kol), dokumenti (svoj). Nove tabele: dokumenti(gr, autor, naziv,
tip, data, opis), sifrarnik(naziv, jm, grupa, modul) — uprava uredjuje.

## Faze
- [x] A. migracija 14 + schema.sql + set local role provera za 6 uloga (f81987a)
- [x] B. Klijent jezgro (de86224, 916/916): ULOGA/JA, uprava/jeSuper/canFinance/vidim/vodim, visibleSites,
      "Pogled kao" za 6 uloga (demo), Nalozi tab sa 5 uloga + finansije + saradnik, matrica testova
- [x] C1. Dokumenti (6a1b27c)  [x] C2. Sifarnik + ceklista mera (e2c8234)  [x] C3. Brisanje za super (b7dff3a)
- [x] C4. Tajmer zadatka (zahtev 2026-10-08): radnik na svom zadatku "Počni" / "Završi";
      sesije rada u tabeli rad_na_zadatku (migracija 15: osoba, zadatak, gr, start, kraj, minuta)
      + log_koriscenja (zadatak_start/zadatak_kraj); kartica zadatka pokazuje stanje i utroseno
- [x] C5. Angazovanost: direktor dodeljuje resurse radnicima (formResurs.zaduzen postoji) +
      pregled u Admin kokpitu: po radniku sati rada (iz rad_na_zadatku) i zaduzeni resursi
- [x] D. Docs (CLAUDE.md pravila 1/2/7/9 → uloge), README, memorija, commit po fazi

# Novo gradiliste + napredak iz predmera + izvedeno iz Excela (2026-10-07) — GOTOVO
Trazeno (posle sastanka sa klijentom): bez polja kontakt nadzora; projektovanje = sve 3 faze
i podfaze sa cekboksom i zaduzenim; zdravlje = ugovoreno (predmer × mere + finansije) vs
stanje koje rukovodilac ucita iz Excela, za sva gradilista.
- [x] formSite bez nadzora; nivoiChecklist (36 podfaza, zaduzeni = zaposleni + spoljni) — T29
- [x] migracija 13: napredak_iz_predmera + trigger na predmer + zdravlja_mojih.napredak;
      jednokratno na sva gradilista; klijent: napredakIzPredmera/osveziNapredak, rukovodilac
      preuzima sa servera, formUpdate bez rucnog napretka kad postoji predmer — T30
- [x] Ucitaj izvedeno (Excel): .xlsx parser u browseru bez biblioteke (ZIP centralni dir +
      DecompressionStream), CSV/nalepljeno, uparivanje po imenu (normalizovano), klamp na
      ugovoreno, pregled pre primene, menja SAMO izv; sablon CSV za preuzimanje — T31
Review: redni broj kao rezerva za uparivanje je dao lazno uparivanje (ime koje ne postoji →
treci red) — sad se koristi samo kad ime nedostaje. Rukovodilac ne moze lokalno da
racuna napredak (cene null) — zato trigger na serveru, i zato je zdravlja_mojih prosiren.
Jednokratna primena je promenila demo brojeve (g5 42%, g8 39%) — ocekivano.

# Nalozi i log koriscenja (2026-10-04) — GOTOVO (596 -> 600)

Trazeno: interfejs preko kog direktor (kasnije i admin) dodeljuje uloge + log koriscenja.
Opseg faze 1 (bez dashboard podesavanja koja Jovan jos nije uradio): dodela/izmena/
uklanjanje uloge POSTOJECIM auth korisnicima + log; kreiranje korisnika ostaje u
Supabase dashboardu. Pozivnice (magic link uz self-signup) i uloga admin — ponedeljak.

## Plan
- [x] 1. migracija-12: log_koriscenja (RLS: insert svoj, select direktor), RPC
      nalozi_pregled / dodeli_ulogu / ukloni_pristup (direktor; ne sebi; ne poslednjem
      direktoru; log na serveru). apply_migration + schema.sql.
- [x] 2. set local role provera: rukovodilac -> rpc odbijen, log select 0, insert svog ok;
      direktor -> lista; dodela sebi odbijena; poslednji direktor zasticen (rollback).
- [x] 3. Klijent: tab "Nalozi" (dirOnly): tabela naloga (email, ime, uloga, zaposleni,
      poslednja prijava, Ukloni), forma dodele (email + uloga + zaposleni) -> rpc,
      log (poslednjih 200, filter po dogadjaju). log_koriscenja NIJE u PUSH_TABLES;
      upisi fire-and-forget: prijava, odjava (pre signOut), otvaranje (verzija, uredjaj),
      cuvanje (tabela -> broj redova).
- [x] 4. Mock: rpc nalozi_pregled/dodeli_ulogu/ukloni_pristup + insert log; T28.
- [x] 5. Docs (CLAUDE.md: RPC-ovi, izuzetak od pravila 8, admin/pozivnice odlozeni;
      README: dodavanje korisnika sad iz app-a posle Add user), memorija, commit, push.

Review: zamka je bila u mocku — insert u log se logovao kao "upsert", pa su 4 stara testa
koji broje upserte pala; log je sad op:'log'. Rukovodilac na praznoj bazi ne seje demo
(pada u memoriju) pa test loga mora prvo da zaseje kao direktor. Nije radjeno: pozivnice
(magic link + self-signup) i admin uloga — ponedeljak.

# Tema + uvoz + Rokovi (2026-10-04) — GOTOVO
- [x] Rokovi: linija "danas" tacna na telefonu (CSS var --g-lab), datum na markeru, auto-skrol
      na danas, dugme "Danas", imena projekata sticky. T26.
- [x] Excel sablon za masovni uvoz (uvoz/) + uvezi.py -> uvoz.sql; provereno na zivoj bazi
      (rollback) i sa namerno pokvarenim fajlom (4 greske, bez SQL-a).
- [x] Tema svetla/tamna/auto: CSS promenljive u 3 bloka, postaviTemu + localStorage + rani
      skript bez bljeska, segment u sidebaru, theme-color meta prati; .rpt-page ostaje bela.
      Skener kroz 13 pogleda u tamnoj temi: 0 belih pozadina, 0 "tekst iste boje kao
      pozadina". Usput: pin-ikona u zaglavlju fioke bila bez dimenzija (306px). T27.
Review: jedina prava zamka bila je redosled CSS pravila (isto kao kod .bnav) i dva mesta sa
`color:#fff` na pozadini `var(--ink)` koja bi u tamnoj temi dala belo na svetlom.

# Zahtevi po modulima — popunjavanje rupa (2026-10-03)

Trazeno: "proveri da li su zahtevi (MODUL 1 Izvodjenje / MODUL 2 Projektovanje) u
CRM-u; ako nisu, dodaj u module gde pripadaju". Audit (explorer): 9/21 DA, 12/21
DELIMICNO, 0 NE. Rupe koje se zatvaraju u ovoj iteraciji (bez nove kolone u bazi —
sve ide u postojece kolone / jsonb `adm`):

## Plan
- [x] A. Izmena osnovnih podataka gradilista posle kreiranja (oba modula): naziv, lokacija,
      povrsina, nadzor (ime, tel), klijent, rukovodilac, pocetak, rok, tip/nivo, budzet/troskovi
      (fin samo direktor). Direktor-only. Dugme "Izmeni podatke" u fioci.
- [x] B. Kontakt investitora vidljiv u fioci (osoba/tel/mail klijenta) — oba modula.
- [x] C. Zaduzen po poziciji predmera i za IZVODJENJE (kolona postoji; forma+uvoz+prikaz) +
      izmena postojeceg reda predmera (opis, jm, kol, cena, zaduzen) — direktor.
- [x] D. Projektovanje: "Ubaci sablon nivoa" naknadno (kao ubaciSablonFaza za izvodjenje).
- [x] E. Troskovi: fioka prikazuje dobavljaca/br. fakture; dugme "Svi troskovi (N)" otvara
      punu listu sa prilozima (direktor).
- [x] F. Zaposleni: izmena podataka (ime, pozicija, tel, opis) + sekcija "Resursi zaduzeni"
      na stranici zaposlenog (vozila/alati/licence gde r.zaduzen===z.id, sa istekom).
- [x] G. Administracija: "vazi do" datum za ugovor/polisu/prijavu (jsonb adm[key].vazi_do),
      upozorenje 30 d pre isteka / isteklo (computeAlerts, nije fin).
- [x] Testovi T24/T24b/T24c (18 provera); 566 -> 589; e2e 0 palo; docs; commit; live provera.

- [x] H. Mobilni sloj (2026-10-04): donja navigacija, brze akcije, PWA manifest+ikonice; T25 (4); 589 -> 593

Svesno NE sada (traze novu kolonu/migraciju ili dizajn odluku): vozila km/servis,
licence po zaposlenom kao struktura, parsiranje fakture, trebovanje→magacin, situacija iz
kumulativa, xlsx upload.


## Review (2026-10-04) — zahtevi A-H, 566 → 593 asertacija

**Uradjeno u 4 runde (3 worker-a + ja), sve kroz Edit + e2e pre/posle:** izmena
osnovnih podataka gradilista (A), investitor u fioci (B), zaduzen po poziciji u oba
modula + izmena reda predmera (C), sablon nivoa naknadno (D), puna lista troskova sa
dobavljacem/fakturom (E), izmena zaposlenog + zaduzeni resursi (F), "vazi do" za
ugovor/prijavu/polisu + upozorenja (G), mobilni sloj (H: donja traka, brze akcije,
PWA). Nijedna nova kolona u bazi — sve u postojece kolone / jsonb `adm`.

**Sta sam sam pogresio i uhvatio:** osnovno `.bnav{display:none}` stavljeno POSLE
@media 900 bloka → na telefonu traka nevidljiva (ista specificnost, poslednje
pobedjuje). Uhvaceno merenjem u browseru, ne testom — T25 sad proverava redosled.
Prvi pokusaj merenja preko python http.server: ERR_CONNECTION_RESET u browser
panelu (curl radi) → node server sa MIME mapom u demo folderu.

**Dve sesije su se restartovale usred worker-a** (runda 3): delimican rad je bio na
disku (git diff), nastavljeno novim worker-om umesto ponavljanja (lekcija 26).

**Svesno NE (backlog, sa razlogom):** rukovodilac menja zaduzenog po poziciji
(trigger zastiti_kolone_predmer dozvoljava samo izv → migracija); vozila km/servis i
licence po zaposlenom (nove kolone); parsiranje fakture; trebovanje → magacin;
situacija iz kumulativa; xlsx upload (odluka od ranije).

# Revizija koda po novom setapu agenata (2026-10-03)

Trazeno: "pregledaj kod po novom setapu agenata (explorer/worker/researcher/advisor)
i ispravi sta ne valja". Baseline: 552/552, commit bdf7d34.

## Plan
- [x] 1. Advisor: pristup (uradjeno - particija po klasterima pravila iz CLAUDE.md)
- [x] 2. 5 explorer-a paralelno: (1+9 finansije) (2+7 smemNa/grById) (3+4+6 esc/broj/datum)
      (8+10+sema: pushAll/TODAY/FIN_KOLONE 4 mesta/TABLES vs schema) (responsive+head)
      Format nalaza: path:line, pravilo, scenario, "procitan put" vs "samo pattern"
- [x] 3. Trijaza: licno procitati svaki "pattern" nalaz, izbaciti lazne; advisor pre popravki
- [x] 4. Worker(i) SERIJSKI na index.html: Edit alat, grep literalnih unicode escape-ova,
      e2e pre/posle, T22+ test po defektu
- [x] 5. Researcher samo ako iskrsne spoljno pitanje
- [x] 6. e2e 0 palo, git grep lozinki, commit, advisor pre "gotovo"; Review sa laznim pozitivima


## Review (2026-10-03) — 552 → 566 asertacija, 0 palo

**Custom agenti (explorer/worker/researcher) se ucitavaju pri startu sesije** — u
ovoj su koristeni ekvivalenti (Explore/general-purpose na Sonnetu, medium) sa
istom podelom uloga; advisor (Fable) pozvan 3x (pristup, pre popravki, pre kraja).

**Ispravljeno (potvrdjeno citanjem puta + testom koji pada na starom kodu):**
- Reset demo / seed na praznu bazu PADA na pravoj bazi od migracije 11 (upsert
  cita excluded.<fin kolona> → 42501 i za direktora). Potvrdjeno `set local role`
  na zivoj bazi. Fix: tabele sa FIN_KOLONE idu insert/update i u sve-rezimu;
  mock sad odbija takav upsert (18 testova je odmah palo = dokaz).
- PUSHED se belezio po tabeli: insert prodje + update padne → dupli insert (23505)
  do refresha. Sad po uspelom zahtevu (`finally{PUSHED[t]=nx}`).
- `delete t.prilog` → PATCH bez kljuca → faktura ostaje u bazi i "vraca se". → null.
- `odjava()` nije cekala upis (signOut+reload ubijaju zahtev) → `sacuvajSve()`.
- CDN nedostupan sa podesenom bazom → app tiho u DEMO rezimu bez prijave.
  → zatvoreno: ekran greske + "Pokusaj ponovo". Boot IIFE je sad `pokreni()`.
- `zdravlje()` za pravog rukovodioca bez servera → lokalna formula nad NULL
  finansijama (do 25 nizi skor, tiho). → null/"—" (+ najrizicniji filtrira null).
- `broj()` nad `type=number` (predmer kolicina): "1.250" → 1250. → `+v`.
- Pretraga (gradilista/klijenti/zaposleni) poredila sirov upit sa escapovanim
  podacima: "Petrovic & Sinovi" nenalazivo. → `unesc` haystack.
- Prazan "Napredak" u formi azuriranja resetovao na 0% → zadrzava staru vrednost.
- `dashSort` po ceni/marzi/naplati prezivljavao "Pogled kao" rukovodilac → reset.
- `formUpdate` bez vlasnickog guarda (demo rezim, konzola); `openPredmer` bez smemNa.
- CSS: predmer KPI bez `grid` klase (kartice naslagane); Naplata/predmer inline
  3 kolone gazile media query (telefon); `.site-line` nedefinisana (bedz ispod
  imena); 8× `'Space Grotesk'` bez fallbacka (Times kad font ne stigne).
- supabase-js pinovan `2.117.2/dist/umd/supabase.js` + SRI (hash nezavisno
  izracunat lokalno) + crossorigin na oba mesta; HEAD provera verzije 4 s timeout
  i cuva `#hash` (magic link); upozorenje resursa firme vodilo na `openSite('null')`.
- CSV ime fajla gubilo c/s/z/dj (`\w` ASCII) → `\p{L}\p{N}`; podnaslov predmera
  "sa cenama" za rukovodioca.

**Lazni pozitivi / svesno NE menjano (zabelezeno, nije "ne valja"):**
- `.slice()`/`initials()` nad escapovanim stringovima (entitet se broji kao 5-6
  znakova, moguce odsecanje `&am…`) — kozmetika; `ukloniAdmDoc` koristi delete
  ali salje ceo jsonb objekat, pa je ispravno.
- Datumi NULL iz baze (red ubacen SQL-om) → `dParse(null)`; app putanje uvek
  default-uju — hardening, ne bug. 5-6-cifrena godina u date inputu — isto.
- `update(r)` salje ceo red: zastareli tab vrati tudji noviji status; magacin
  `stanje` apsolutno (dva korisnika gaze jedan drugog); `resetDemo` brise join
  tabele pre upisa — multi-user dizajn, odluka za F5.
- Serijski per-row update u redovnom cuvanju (saveTim N zahteva) — perf, kasnije.
- a11y: 0 aria/role, labeli bez `for`, modal bez focus-trap, 17 klik-divova;
  scrim ostaje posle rotacije tableta; Escape zatvara sve slojeve — posebna tema.
- Mrtvo: `obrisiRed` nema pozivaoca; `saveTimer` se ne nulira (guard bez efekta).

**Sta me je iznenadilo:** najozbiljnija greska (reset/seed pada od migracije 11)
je bila nevidljiva jer mock nije oponasao grant-ove — i to je pronasao
"schema" explorer kao PATTERN ONLY nalaz, a potvrdio jedan `set local role`
upit. Advisor je sprecio dva pogresna poteza: `!isDirector()` umesto
`jeRukovodilacNalog()` u zdravlju (simulacija bi izgubila skor) i paralelizaciju
update-a u redovnom cuvanju (promena semantike gresaka).

# GradnjaOS — F4: Supabase Auth + RLS (2026-09-23) — GOTOVO

Prethodna iteracija (v0.5 + Supabase + tri odluke) je u git istoriji
(c165744, 7038610, 8d89037). Testovi: 527 → 544 asertacija.

## Cilj (ispunjen)
1. ~~anon ključ + `pilot_full` = svako sa fajlom može sve~~ → anon nema nijednu
   polisu; provereno na bazi: `set local role anon` → 0 redova svuda
2. ~~ROLE je meni~~ → uloga iz tabele `profili`; `setRole` ignorisan za rukovodioca;
   samounapređenje u direktora odbijeno na serveru (upis u profili nema polisu)
3. ~~`grs[]` nizovi se ne mogu ograničiti RLS-om~~ → join tabele
   `zaposleni_gradiliste(aktivan)` / `podizvodjac_gradiliste`, nizovi obrisani

## Plan
- [x] 1. `migracija-10-auth-rls.sql` + novi `schema.sql` (profili, 6 helpera,
      join tabele + backfill + drop nizova, 61 polisa za `authenticated`, `povezi_profil`)
- [x] 2. Primenjeno na živu bazu; backfill: 29 aktivnih + 4 bivša + 5 podizvođačkih
- [x] 3. RLS na serveru (`set local role` + jwt claim): rukovodilac z1 vidi samo g1
      (4 zadatka, 1 klijent, 1 podizvođač, 0 tuđih troškova/situacija/resursa);
      direktor sve; anon 0. Upisi: 13 slučajeva — tuđe gradilište, tuđe ime u
      dnevniku, trošak, novo gradilište, ulaz u magacin, samounapređenje →
      odbijeno; svoje → prošlo. Probni redovi obrisani.
- [x] 4. Klijent: `initAuth`, login ekran (email+lozinka / magic link), odjava,
      promena lozinke, `renderNalog` (meni "Pogled kao" samo direktor), guardovi
- [x] 5. Klijent: `spojiJoinTabele`/`rowsZa`, `pushAll` = diff po redu (snapshot),
      seed i reset samo direktor, reset rekonstruiše join tabele
- [x] 6. Mock: `auth.*`, filteri na select, `maybeSingle`, kompozitni ključevi;
      `boot({session, users, seed.profili})`, brojači reload/prompt
- [x] 7. T18 (6) + T18b (7) + T18c (2): 15 novih asertacija
- [x] 8. Pravi login u browseru protiv prave baze — rukovodilac (samo g1, 0 grešaka
      kroz sve poglede/kartice/forme) i direktor (sve, simulacija, diff-upis
      jednog reda potvrđen čitanjem iz baze)
- [x] 9. CLAUDE.md (pravila 7-8, nalozi, hardening lista), README (korisnici,
      tabela prava, deployment), lessons 11-14

## Nalozi
- `miske1431@gmail.com` — direktor; `petar@gradnjaos.test` — rukovodilac (z1)
- Lozinke poslate Jovanu u chatu (privremene, promeniti dugmetom "Lozinka")

## BLOKIRANO / na Jovanu
- ~~GitHub publish~~ — 2026-09-24: repo mrmouse123/gradnjaos, Pages živ na
  https://mrmouse123.github.io/gradnjaos/, prijava kao Petar kroz formu + reload
  proverena na live URL-u
- Supabase dashboard: Auth → Providers → Email → "Allow new users to sign up" OFF;
  Site URL kad bude Pages adresa (zbog magic linka)
- RESEND_API_KEY + deploy edge funkcije (kad hoće pravo slanje mejla)
- Odluka o Pro planu (25 $/mes) ako pauziranje posle 7 dana smeta

## Review

**Šta je urađeno.** Tri rupe koje su postojale otkad je baza prava su zatvorene
na serveru, ne samo u UI-ju. Bez prijave nema pristupa; uloga se ne bira nego
dolazi iz `profili`; rukovodilac na serveru dobija samo redove svojih
gradilišta. Usput je čuvanje prešlo sa "gurni celu bazu" na diff po redu — što je
bilo nužno (RLS bi odbio rukovodiočev upsert tuđih redova) i usput je uklonilo
rizik "base64 prilozi na svaki klik" zabeležen u prethodnom Review-u.

**Šta me je iznenadilo.**
- RLS je uveo novu klasu rizika koje ranije nije bilo: `DATA` je sad *parcijalan*
  (rukovodilac ima sve zaposlene i sve veze, ali samo svoje gradilište), pa svako
  `grById[x].naziv` bez zaštite puca na id koji nije učitan. Kod je već bio
  disciplinovan (`.filter(Boolean)` svuda) — u pravom browseru 0 grešaka — ali
  to sad mora biti pravilo (CLAUDE.md #7) i test (T18c), ne sreća.
- Preview panel učitava fajl kao `data:` URL → nema localStorage → sesija ne
  preživi reload. Pola sata sam mislio da je to bug app-a. Nije (lessons #13).
- Sopstveni test je trivijalno prolazio jer je birao z2/g1 "napamet", a z2 u
  DEMO već radi na g1 (lessons #12). Ispravka: par se bira dinamički.
- Kreiranje auth korisnika direktno SQL-om (auth.users + auth.identities) RADI
  sa lozinkom — prijava kroz pravi supabase-js prošla iz prve.

**Svesne rupe koje ostaju (zabeleženo u CLAUDE.md "Sledeće").**
- Rukovodilac na nivou API-ja može da PROČITA iznose svog gradilišta
  (troskovi_st, situacije, predmer.cena). UI ih krije; server ne — jer
  `zdravlje(g)` je "jedan skor za sve" i traži potroseno/naplaceno na klijentu.
  Rešenje je RPC `zdravlje(gid)` na serveru; nisam ga radio u istoj iteraciji
  da ne mešam dva velika rezanja odjednom.
- Rukovodilac može da UPDATE-uje ceo red svog gradilišta (server ne razlikuje
  kolone) — UI nudi samo napredak/fazu/status. RPC bi to zatvorio.
- Self-signup je i dalje uključen u Supabase Auth (dashboard podešavanje, nemam
  pristup odavde); ublaženo time što nalog bez profila vidi nula podataka i
  `signInWithOtp` ima `shouldCreateUser:false`.

# Responsive — kompletno (2026-09-24) — GOTOVO

Trazeno: "popravi sav CSS da se adaptira na ekrane — kompletno". Izmereno na
live URL-u u iframe-ovima 320/390/768/1024/1366 (recept u lessons #19).
- [x] Nalaz pre: SVAKI pogled je na 360px prelazio ekran (380-995px) — .main
      bez min-width:0 (Gantt 820px sirio ceo layout), segment modula i datum
      bez prelamanja; hamburger ispod otvorenog sidebara (nema zatvaranja)
- [x] Patch 14-17: min-width:0, breakpointi 1100/1050/900/560/400 + landscape +
      hover:none + safe-area, toggleSide()+scrim, fioka 100%, Kanban minmax(0,1fr)
- [x] Posle: documentElement.scrollWidth <= clientWidth u SVIH 12 pogleda na
      svih 5 sirina; fioka/modal/izvestaj/predmer unutar ekrana; KPI 1/2/4
      kolone; sidebar+scrim; Kanban 1/2/4 kolone. T20 (scrim). 551/551.
- [x] CLAUDE.md sekcija "Responsive" (breakpointi, pravila, kako se meri);
      lessons 18-20

# F4b: hardening — finansije ne stizu rukovodiocu ni na nivou API-ja (2026-09-23)

Trazeno: "RPC zdravlje na serveru". Sam RPC ne zatvara rupu — budzet/troskovi su
kolone na gradilista redu, cena na predmer redu, a te redove rukovodilac MORA
da cita. Zato ceo paket iz CLAUDE.md "Hardening posle F4", jedna migracija (11).
Testovi: 544 → 550.
- [x] 1. SQL: zdravlje_gradilista(gid) + zdravlja_mojih() (ista formula, "danas"
      po Europe/Belgrade, floor(x+0.5)=Math.round); troskovi_st/situacije samo
      direktor; column-level grant (table-level select ukinut, dozvoljene kolone
      vracene) + view-ovi kao vlasnik sa filterom redova; trigeri za kolone
- [x] 2. Primenjeno na zivu bazu (dve migracije: prva verzija + ispravka).
      set local role kao rukovodilac, 17 provera: select budzet iz tabele →
      permission denied; view → NULL/62; UPDATE svog g1 uz budzet/rukovodilac →
      1 red, netaknuto; tudje g2 → 0; upsert svog g1 → odbijen (INSERT WITH
      CHECK); troskovi/situacije 0; zdravlja_mojih g1=85; magacin naziv netaknut
- [x] 3. Server == klijent za svih 9: g1=85,g2=50,g3=25,g4=100,g5=95,g6=75,
      g7=90,g8=75,g9=45 (direktor u browseru vs zdravlja_mojih)
- [x] 4. Klijent: CITAJ_IZ view-ovi, FIN_TABELE preskocene, ZDR_SRV/osveziZdravlje,
      rowsZa bez finansijskih kolona, pushAll update/insert (upsert samo seed/reset)
- [x] 5. Mock: rpc(), view aliasi, update(); T19 (6 asertacija)
- [x] 6. Browser (prava baza, Petar): iznosi null, cene null, 0 finansijskih
      redova, zdravlje 85 == direktorovo; napredak 62→63→62 kroz update bez greske
- [x] 7. Docs + commit

## Review F4b

**Dva nalaza koja su promenila plan** (oba uhvacena testom na serveru PRE
nego sto je klijent diran):
- Prvobitna ideja "rukovodiocu ukinuti SELECT polisu na gradilista/predmer,
  neka cita samo view" ne radi: Postgres proverava SELECT polisu i na redu koji
  se UPDATE-uje (WHERE id=...), pa rukovodilac vise ne moze da azurira napredak
  (0 redova). RLS polisa ne moze da sakrije kolonu — column-level GRANT moze.
  Ali kolonski revoke uz table-level grant nema efekta: mora se ukinuti
  table-level select pa vratiti dozvoljene kolone. View onda mora raditi kao
  vlasnik (ne security_invoker) sa eksplicitnim filterom redova.
- Upsert (INSERT ... ON CONFLICT DO UPDATE) pada na INSERT WITH CHECK
  je_direktor() i kad je red rukovodiocev — sto znaci da rukovodiocevo cuvanje
  gradilista/predmer/magacin u F4 NIJE radilo (latentan bug: u F4 sam ga
  testirao plain UPDATE-om i direktorskim upsertom, ne rukovodiocevim
  upsertom). Sad postojeci redovi idu kao UPDATE, novi kao INSERT.

**Sta ostaje svesno:** rukovodilac i dalje vidi `g.budzet` kao kolonu u JS
modelu — ali kao null. Kod koji sabira/deli po njoj mora biti iza canFinance()
ili tolerantan na null (pravilo 9). Direktor i dalje racuna zdravlje lokalno
(ima sve podatke); server i klijent formula su identicne i to je provereno na
9 gradilista — ako se formula menja, menja se na OBA mesta (zdravlje() u
index.html i zdravlje_gradilista() u SQL-u).
