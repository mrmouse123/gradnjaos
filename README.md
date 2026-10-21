# GradnjaOS — pilot PM alat za građevinsku firmu

Jedan HTML fajl (`index.html`) bez build koraka: kontrolna tabla sa finansijama i upozorenjima, gradilišta, klijenti, zaposleni sa opisom posla, Gantt rokovi, Kanban zadaci, dnevnik radova, naplata (privremene situacije), predmer, trebovanje, resursi, magacin. Uloge: **direktor** vidi sve, **rukovodilac** vidi samo svoja gradilišta i ne vidi finansije — i to važi i na serveru (RLS), ne samo u interfejsu.

## Pokretanje lokalno

Otvori `index.html` u pretraživaču. Ako su `SUPABASE_URL`/`SUPABASE_ANON_KEY` popunjeni (jesu, od 2026-09-14), traži se prijava i podaci idu iz baze. Ako su prazni, radi u demo režimu sa ugrađenim podacima i menijem za izbor uloge (izmene traju do osvežavanja).

## Prijava i korisnici

- Prijava: email + lozinka. „Pošalji mi link za prijavu" (magic link) radi tek kad se u Supabase → Authentication → URL Configuration postavi Site URL na adresu app-a.
- Lozinku menjaš dugmetom **Lozinka** u sidebaru. Odjava: **Odjavi se**.
- Direktor ima meni **Pogled kao** — simulacija kako app izgleda rukovodiocu (server mu svejedno daje sve). Rukovodilac nema meni.

### Dodavanje korisnika (radi direktor, ~1 minut)

1. Supabase dashboard → **Authentication → Users → Add user** → email + lozinka, uključi *Auto Confirm User*.
2. U aplikaciji, tab **Admin kokpit** (uprava): upiši email, izaberi ulogu (rukovodilac/radnik → i zaposlenog), modul (rukovodilac: projektovanje, izvođenje ili oba; radnik: tačno jedan), za rukovodioca po potrebi „vidi finansije", **Dodeli ulogu**. Nalog se pojavljuje u listi; dok nema ulogu, označen je „bez uloge".
3. Korisnik se prijavljuje lozinkom koju si mu dao (menja je dugmetom **Lozinka**). Bez dodeljene uloge nalog vidi nula podataka i dobija jasnu poruku.

U istom tabu se uloga menja (Sačuvaj) ili uklanja (**Ukloni** — nalog ostaje, vidi ništa), a ispod je **log korišćenja**: prijave, odjave, otvaranja (uređaj, verzija), čuvanja (koje tabele, koliko redova), promene uloga. Sopstvenu ulogu direktor ne može da menja, a poslednji direktor se ne može skinuti. SQL alternativa i dalje postoji: `select povezi_profil('mejl','rukovodilac','z1');` u SQL editoru.

## Uloge (šta ko sme — i na serveru, ne samo u interfejsu)

| | Direktor (IT super admin) | Admin | Direktor projektovanja / Direktor izvođenja | Rukovodilac 1 | Rukovodilac 2 | Radnik / Spoljni saradnik |
|---|---|---|---|---|---|---|
| vidi gradilišta | sva | sva | **sva u svom modulu** (samo projektovanje, odnosno samo izvođenje) | samo svoja, u svom modulu (projektovanje, izvođenje ili oba) | isto | samo ona gde je u timu / na kojima je saradnik; radnik u TAČNO jednom modulu |
| tabovi | svi | svi | svi za svoj modul (projektovanje: bez magacina i naplate; izvođenje: bez zadataka) | tabla, gradilišta, rokovi, zadaci (samo projektovanje), dnevnik, magacin (samo sa modulom izvođenje), trebovanje (naplata samo uprava) | isto | isto |
| finansije (cene, troškovi, naplata) | da | da | da (u svom modulu) | **da** (zastavica „vidi finansije") | ne | ne |
| kreira gradilišta sa merama iz šifarnika, menja osnovne podatke | da | da | da, samo u svom modulu | ne | ne | ne |
| dodeljuje ljude u tim, ažurira napredak/fazu, trebovanje, magacin izlaz, učitava izvedeno | da | da | da, u svom modulu | svoja gradilišta | svoja gradilišta | ne |
| dnevnik radova | sve | sve | sve u svom modulu | pod svojim imenom | pod svojim imenom | pod svojim imenom (svoje unose i briše) |
| zadaci (samo Projektovanje) | vidi sve | vidi sve | direktor projektovanja: vidi sve; direktor izvođenja: nema tab | vidi sve zadatke svojih projektantskih gradilišta | isto | radnik projektovanja: vidi i pomera SAMO svoje zadatke, na njima **Počni / Pauziraj / Završi** (vreme po sesiji); radnik izvođenja: nema tab Zadaci (radove nose podizvođači) |
| dokumenta / fotografije na gradilištu | sve | sve | sve u svom modulu | dodaje; briše svoje | dodaje; briše svoje | dodaje; briše svoje |
| Admin kokpit (nalozi, uloge, moduli, angažovanost, log) | da | da (ne dira direktorske uloge) | **ne** | ne | ne | ne |
| šifarnik artikala i usluga (samo Izvođenje; dugme na tabu Gradilišta) | da (i briše) | da | da (briše samo direktor) | ne | ne | ne |
| situacije (privremena / okončana) sa stavkama | pravi, vidi iznose i razlike; odobrava/vraća | isto | isto, u svom modulu | pravi na svojim gradilištima; iznose vidi samo uz finansije | pravi, bez iznosa | ne |
| **brisanje** (redovi, gradilišta) | **da** | ne | **da, samo redove i gradilišta svog modula** (zaposlene, klijente, podizvođače i šifarnik briše samo direktor) | ne | ne | samo svoje unose/dokumenta |

Rukovodilac 1 i 2 su ista uloga (`rukovodilac`) sa zastavicom „vidi finansije" u Admin kokpitu. Spoljni saradnik je vezan za podizvođača/saradnika, radnik za zaposlenog.
Direktor ima dugme **Asistent** gore desno (AI panel na svakom ekranu): jutarnji brif, pitanja nad podacima („koji projekti kasne", „koliko je naplaćeno") i pregled situacije pre odobravanja. Odgovara samo iz podataka koje direktor vidi i ništa ne menja; API ključ je u Supabase Edge Function `ai-asistent`, ne u aplikaciji.
Situaciju (privremenu i okončanu) rukovodilac Izvođenja ili uprava preuzima iz detalja situacije kao Excel u investitorskom šablonu, na latinici ili ćirilici (od 2026-10-16).
Direktor projektovanja i direktor izvođenja (od 2026-10-14) su uprava ograničena na jedan modul: modul im je u imenu uloge, a direktorske uloge (sve tri) dodeljuje i uklanja samo direktor.

Bez prijave (anon ključ sam za sebe): **nula pristupa** — zato je u redu da `index.html` sa ključem bude u javnom repou.

## Deployment

### 1. Supabase (baza)

Projekat već postoji: `gradnjaos`, region eu-central-1, **Pro plan** (ne pauzira se; Supabase pravi dnevni backup sa čuvanjem 7 dana — Database → Backups). Ako se baza ikad ne učita, app javi poruku sa koracima.

Nova baza od nule: **SQL Editor → New query** → nalepi ceo `supabase/schema.sql` → Run (16 tabela, helperi, polise, `povezi_profil`). Zatim URL i anon ključ (Project Settings → API) u blok `KONFIGURACIJA ZA DEPLOYMENT` u `index.html`.

Postojeća baza sa starijom šemom: pokreni `supabase/migracija-NN-*.sql` redom, samo one koje nedostaju (svaka je idempotentna).

### 2. GitHub Pages (hosting) — živo

**https://mrmouse123.github.io/gradnjaos/** (repo `mrmouse123/gradnjaos`, grana `main`, root) — jedan link za telefon, tablet i računar; raspored se sam prilagođava širini ekrana. Svaka sledeća izmena = commit + push (Pages objavi za ~1 min). Aplikacija pri svakom otvaranju proveri da li na serveru postoji novija verzija i sama se osveži — nema potrebe za `?v=N`; u podnožju sidebara piše „verzija od <datum vreme>".

Na telefonu se instalira kao aplikacija: Android Chrome ⋮ → „Dodaj na početni ekran", iPhone Safari → Deli → „Add to Home Screen" (otvara se preko celog ekrana, sa donjom navigacijom Tabla · Gradilišta · Zadaci · Dnevnik · Više).

Tu adresu upiši i u Supabase → Authentication → URL Configuration → **Site URL** i **Redirect URLs** (zbog magic linka i reseta lozinke). Sopstveni domen kasnije: `CNAME` fajl u repou + CNAME zapis kod registrara.

### 3. Pravo slanje mejla trebovanja (opciono)

Sad se trebovanje šalje kroz mailto (otvori mail klijent). Za pravo slanje: `supabase functions deploy posalji-trebovanje` + `supabase secrets set RESEND_API_KEY=...` (v. `supabase/functions/posalji-trebovanje/index.ts`). Dok to nije urađeno, app tiho ostaje na mailto.

## Valuta

Svi iznosi su **bez PDV, u RSD**: jedinična cena artikla iz šifarnika, ugovoreni predmer, situacije, budžet i naplata. PDV se ne obračunava u aplikaciji.

## Poznata ograničenja

- Prevlačenje zadataka (drag & drop) radi mišem; na telefonu koristi klik na karticu.
- Upis u bazu je „poslednji piše — pobeđuje" po redu: ako dvoje menja ISTI zapis istovremeno, kasniji pregazi raniji. Različite zapise više ljudi menja bez sukoba (čuva se samo ono što se promenilo).
- **Predmer iz Excela (investitorski šablon):** pri kreiranju gradilišta Izvođenja direktor ili admin učita .xlsx u formatu „ПРЕДМЕР И ПРЕДРАЧУН" (list po vrsti radova; kolone br. poz | opis | JM | količina | jed. cena bez PDV) i sve pozicije ulaze u ugovoreni predmer sa šifrom; ukupno bez PDV se računa automatski. Isti uvoz postoji i na strani Predmer postojećeg gradilišta (već postojeće pozicije se preskaču). Rukovodilac kasnije učitava privremenu ili okončanu situaciju u istom šablonu (kolona „kumulativno izvedeno").
- **Naplata po stavkama:** uprava pri kreiranju gradilišta bira artikle iz šifarnika (81 artikal ELOM, plus usluge koje uprava doda u šifarnik, plus „Razno" slobodne stavke) sa ugovorenom količinom i cenom. Projektovanje nema šifarnik: tamo su sveske tipovi dokumentacije (IDR, IDP/PGD, PZI i poddokumenti) plus Razno. Rukovodilac pravi privremenu ili okončanu situaciju iz istog predmera (plus artikli iz šifarnika kojih nema u predmeru); količine mogu da odstupe. Server računa kumulativ po stavci kroz sve situacije i **razliku preko ugovorenog**, koju uprava vidi kao upozorenje na tabli i u detalju situacije, a iznos iz ugovorenih cena. Rukovodilac bez finansija ne vidi iznose.
- Zadaci postoje samo na gradilištima Projektovanja i to su **sveske iz specifikacije** (+ razno): svaka sveska dodeljena čoveku je njegov zadatak sa Počni / Pauziraj / Završi; „Završi" označava svesku kao predatu (izvedeno = ugovoreno) i podiže napredak projekta. Rukovodilac projektovanja dodaje sveske i dodeljuje ih. Gradilišta Izvođenja nemaju zadatke (radove nose podizvođači, naplata ide po situacijama iz šifarnika). Novo gradilište (Projektovanje) nudi sve sveske po fazama + sekciju **Razno**.
- Brisanje: samo direktor (red po red, dugme u fioci); radnik/spoljni brišu svoje unose dnevnika i dokumenta.
- Prilozi (fakture, dokumenta) se čuvaju u bazi kao data-URL, limit 2.5 MB po fajlu — do prelaska na Supabase Storage.

## Struktura

```
index.html                                  # cela aplikacija (UI + logika + Supabase adapter + auth)
supabase/schema.sql                         # kompletna šema za SVEŽU bazu
supabase/migracija-01..10-*.sql             # nadogradnje postojeće baze, redom
supabase/functions/posalji-trebovanje/      # Edge Function (Deno + Resend), nije deploy-ovana
test/e2e.js                                 # node test/e2e.js — 540+ provera, bez framework-a
test/{dom-stub,supabase-mock,patch-lib}.js  # stub DOM, mock Supabase (+auth), alat za bezbedne izmene
tasks/                                      # plan rada i lekcije (interni radni dokumenti)
CLAUDE.md                                   # kontekst i pravila za rad na kodu
```
