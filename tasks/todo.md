# GradnjaOS — v0.5: sređivanje koda + preostale funkcije

Radi se po boris-cherny workflow-u. Mreža za sigurnost: `git` (baseline commit `cda1f50`)
i `test/e2e.js` (521 asertacija na kraju ove iteracije).

## Faza 0 — infrastruktura (gotovo)
- [x] git init + baseline commit
- [x] `test/e2e.js` + `test/dom-stub.js` + `test/patch-lib.js` + `test/supabase-mock.js`

## Faza 1 — bezbednost i ispravnost ("sredi kod") — GOTOVO
- [x] **B1** Pravilo 3 (esc() na upisu) — proveren kroz sve forme
- [x] **B2** `unesc()` na CSV izvozu, telu mejla trebovanja i imenu fajla
- [x] **B3** Sloj čuvanja: 6 bugova (pushAll staje na prvoj grešci, prazan datum
      u Postgres, "prvi start" pogrešna detekcija, doSave bez guarda, resetDemo
      redosled, nema flush na zatvaranje) + `obrisiRed()` eksplicitna operacija
- [x] **B4** Pravilo 2 (vlasništvo): 4 rupe visokog rizika + 6 curenja tuđih
      gradilišta. Uveden `smemNa(grId)`.
- [x] **B5** Logička ispravnost (12 nalaza): marzaPct/fmtEurK, rušenje prikaza,
      parsiranje brojeva (uveden `broj()`), setIzv, jutarnji brif, magacin
      string, ID kolizije, TODAY zamrznut, renderNav, mrtav kod

## Faza 2 — preostale funkcije iz CLAUDE.md — GOTOVO (osim F4, namerno blokiran)
- [x] **F1** Šabloni faza/zadataka za Izvođenje (visoko/nisko) — `SABLONI_FAZA`,
      sejanje pri kreiranju i naknadno iz fioke
- [x] **F2** Edge Function za pravo slanje mejla trebovanja
      (`supabase/functions/posalji-trebovanje/`) — kod gotov i testiran (mock),
      pada na mailto u svakom stanju dok nije deploy-ovana
- [x] **F3 (deo)** Prilog uz stavku troška (PDF/slika fakture) — isti obrazac
      kao `uploadAdmDoc`. .xlsx binarni upload SVESNO preskočen — paste-iz-Excela
      već pokriva potrebu, nova biblioteka nije opravdana za taj dobitak.
- [ ] **F4** Auth + RLS — BLOKIRANO namerno (CLAUDE.md: "NE povezivati dok Jovan
      ne kaže"; RLS je sekvenciran POSLE povezivanja). `smemNa()` je već tačka
      izmene kad taj trenutak dođe.

## Faza 3 — preostali nalazi i sređivanje — GOTOVO
- [x] N4 (falsy-nula u formama), N7 (dashSorted nepoznat status),
      regresija sopstvene izmene (zadatak.rok null → default, v. lessons.md)
- [x] CLAUDE.md ažuriran: nova arhitektura, pravila 5-6, `test/` opis,
      "Otvorena pitanja za Jovana" sekcija za preostale nalaze koji NISU
      bagovi nego proizvodne odluke (zdravlje po ulozi, "Marža" naziv,
      formTim spisak) — namerno nisam menjao kod za te tri stavke jer
      zahtevaju Jovanovu odluku, ne tehnički ispravan/pogrešan odgovor

## BLOKIRANO — treba mi od Jovana
- **Supabase URL + anon ključ** — F2/F4 su spremni/testirani, ali ne mogu u
  produkciju bez ovoga. CLAUDE.md: "ne povezivati dok Jovan ne kaže".
- **RESEND_API_KEY** (za F2 Edge Function) — kad se Supabase poveže.
- **Materijali za šablone faza** (F1) — ugrađen razuman default.
- **3 proizvodne odluke** — v. CLAUDE.md "Otvorena pitanja za Jovana".

## Review

**Šta je urađeno:** cela v0.4 kodna baza je prošla kroz tri nezavisne dubinske
revizije (logika/računi, sloj čuvanja, sistem uloga) plus sopstvenu proveru
pravila 3 (esc/XSS). Od ukupno ~40 prijavljenih nalaza, popravljeno je 27 —
sve visoke i srednje ozbiljnosti, plus nekoliko niskih koje su bile jeftine i
nedvosmislene. Tri niska nalaza su namerno ostavljena kao "pitanje za Jovana"
jer traže proizvodnu odluku, ne tehnički ispravku (v. CLAUDE.md). Jedan nalaz
(dvostruko escapovanje pri izmeni resursa) je proveren i odbačen kao lažan —
u pravom browseru HTML parser dekodira entitete iz `value="..."` atributa pri
učitavanju forme, pa round-trip ne duplira escapovanje; agentov test je to
propustio jer je pozivao `esc(esc(x))` direktno umesto kroz stvarni DOM.

Uz popravke, implementirane su i tri funkcije iz CLAUDE.md "Sledeće": šabloni
faza za Izvođenje, Edge Function za trebovanje (neaktivna dok se ne deploy-uje),
i prilog fakture uz trošak.

**Šta me je iznenadilo:**
- Prva verzija sopstvenog XSS testa (T7) je lažno prijavila 2 pada — `esc()`
  ne escapuje `=` ni `()`, pa je moj prvobitni detektor tražio string
  `onerror=xss()` doslovno, što preživi i ispravno escapovan payload.
- Prva iteracija "logičkog" audita (grubi regex nad izvorom) je pogrešno
  tvrdila da ~10 funkcija ne escapuje unos — tačan odgovor je zahtevao
  izvršavanje kroz stvarnu formu, ne čitanje regexa. Ispravljeno pre nego
  što je ta lažna tvrdnja ušla u kod.
- Sopstvena greška: kad sam prvi put popravljao prazan `<input type=date>`
  (K2 iz sloja čuvanja), za `zadatak.rok` sam stavio `||null` — ali `t.rok`
  se u kodu čita na 10+ mesta kao obavezan datum (`dParse`/`daysBetween` bez
  null-provere), za razliku od `resursi.istice` koje ima namenski sentinel.
  Uhvaćeno i ispravljeno u istoj iteraciji — v. lessons.md lekcija koja to
  generalizuje u pravilo (CLAUDE.md pravilo 6).
- Tri nezavisna agenta su nezavisno potvrdila iste probleme sa različitih
  uglova (npr. "prvi start" detekcija u sloju čuvanja i vlasništvo nad
  gradilištem) — dobar znak da su nalazi realni, ne artefakt jednog ugla gledanja.

**Šta je i dalje rizično / za pratiti:**
- Fajl je sad ~199KB (bio 189KB). CLAUDE.md već upozorava da se prati rast —
  i dalje udobno za jedan-fajl pristup, ali blizu granice gde bi razdvajanje
  na module postalo vredno razmatranja ako F4 (Auth+RLS) doda još.
- `pushAll` i dalje šalje CELU izmenjenu tabelu pri svakom čuvanju — uključujući
  base64 PDF-ove u `gradilista.adm` i sad `troskovi_st.prilog`. Sa dovoljno
  gradilišta i priloga (limit 2.5MB po fajlu), to postaje veliki payload na
  svaki upis. Rešenje je pravi Supabase Storage — CLAUDE.md to već predviđa,
  ali vredi eksplicitno naglasiti Jovanu pre nego što tim počne da kači
  fakture u većem obimu.
- Auth+RLS prelaz (F4) će zahtevati shemu (join tabele za `zaposleni.grs[]` i
  `podizvodjaci.grs[]`) pored samog RLS-a — array kolone se ne mogu ograničiti
  row-level policy-jem. Ovo je zabeleženo u CLAUDE.md "Sledeće" da se ne
  zaboravi kad taj trenutak dođe.
