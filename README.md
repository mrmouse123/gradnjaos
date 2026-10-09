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
2. U aplikaciji, tab **Nalozi i log** (vidi ga samo direktor): upiši email, izaberi ulogu (rukovodilac → i zaposlenog), **Dodeli ulogu**. Nalog se pojavljuje u listi; dok nema ulogu, označen je „bez uloge".
3. Korisnik se prijavljuje lozinkom koju si mu dao (menja je dugmetom **Lozinka**). Bez dodeljene uloge nalog vidi nula podataka i dobija jasnu poruku.

U istom tabu se uloga menja (Sačuvaj) ili uklanja (**Ukloni** — nalog ostaje, vidi ništa), a ispod je **log korišćenja**: prijave, odjave, otvaranja (uređaj, verzija), čuvanja (koje tabele, koliko redova), promene uloga. Sopstvenu ulogu direktor ne može da menja, a poslednji direktor se ne može skinuti. SQL alternativa i dalje postoji: `select povezi_profil('mejl','rukovodilac','z1');` u SQL editoru.

## Uloge (šta ko sme — i na serveru, ne samo u interfejsu)

| | Direktor (IT super admin) | Admin | Rukovodilac 1 | Rukovodilac 2 | Radnik / Spoljni saradnik |
|---|---|---|---|---|---|
| vidi gradilišta | sva | sva | samo svoja | samo svoja | samo ona gde je u timu / na kojima je saradnik |
| tabovi | svi | svi | tabla, gradilišta, **naplata**, rokovi, zadaci, dnevnik, magacin, trebovanje | isto bez naplate | isto bez naplate |
| finansije (cene, marže, troškovi, naplata) | da | da | **da** (zastavica „vidi finansije") | ne | ne |
| kreira gradilišta sa merama iz šifarnika, menja osnovne podatke | da | da | ne | ne | ne |
| dodeljuje ljude u tim, ažurira napredak/fazu, trebovanje, magacin izlaz, učitava izvedeno | da | da | svoja gradilišta | svoja gradilišta | ne |
| dnevnik radova | sve | sve | pod svojim imenom | pod svojim imenom | pod svojim imenom (svoje unose i briše) |
| zadaci | vidi sve | vidi sve | vidi sve zadatke svojih gradilišta (i svojih radnika) | isto | vidi i pomera SAMO svoje zadatke na svojim gradilištima; na svom zadatku **Počni / Pauziraj / Završi** (vreme se beleži po sesiji) |
| dokumenta / fotografije na gradilištu | sve | sve | dodaje; briše svoje | dodaje; briše svoje | dodaje; briše svoje |
| Admin kokpit (nalozi, uloge, šifarnik, log) | da | da (ne dira direktore) | ne | ne | ne |
| **brisanje** (redovi, gradilišta) | **da** | ne | ne | ne | samo svoje unose/dokumenta |

Rukovodilac 1 i 2 su ista uloga (`rukovodilac`) sa zastavicom „vidi finansije" u Admin kokpitu. Spoljni saradnik je vezan za podizvođača/saradnika, radnik za zaposlenog.

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

## Poznata ograničenja

- Prevlačenje zadataka (drag & drop) radi mišem; na telefonu koristi klik na karticu.
- Upis u bazu je „poslednji piše — pobeđuje" po redu: ako dvoje menja ISTI zapis istovremeno, kasniji pregazi raniji. Različite zapise više ljudi menja bez sukoba (čuva se samo ono što se promenilo).
- Novo gradilište (Izvođenje) se pravi BEZ zadataka; šablon faza (8 faza × tipični zadaci) ubacuje se po želji dugmetom u fioci gradilišta. Novo gradilište (Projektovanje) nudi sve sveske po fazama + sekciju **Razno** za sopstvene stavke.
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
