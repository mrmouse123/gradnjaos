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
2. **SQL Editor → New query**:
   ```sql
   select povezi_profil('ime.prezime@firma.rs', 'rukovodilac', 'z1');  -- z1 = id iz tabele zaposleni
   select povezi_profil('direktor@firma.rs', 'direktor');                 -- direktor nije vezan za zaposlenog
   ```
3. Korisnik se prijavljuje. Bez `povezi_profil` nalog postoji, ali vidi nula podataka (i dobija jasnu poruku).

Ista funkcija menja ulogu postojećem korisniku. Uklanjanje: obriši korisnika u Authentication → Users (profil se briše sam).

## Šta rukovodilac sme (i na serveru)

| | direktor | rukovodilac |
|---|---|---|
| gradilišta | sve | samo svoja (čita + ažurira napredak/fazu) |
| zadaci, dnevnik, trebovanje, izvedene količine | sve | samo na svojim gradilištima; dnevnik i trebovanje samo pod svojim imenom |
| klijenti | svi | samo investitor svog gradilišta (ime u fioci) |
| zaposleni | sve + menja | vidi spisak; tim menja samo na svom gradilištu |
| troškovi, situacije, cene, marže | sve | UI ih krije; na nivou API-ja može da pročita iznose SVOG gradilišta (v. CLAUDE.md „Hardening") |
| magacin | sve | vidi; izdaje samo na svoje gradilište |
| demo reset, novi klijent/zaposleni/gradilište, prilozi | da | ne |

Bez prijave (anon ključ sam za sebe): **nula pristupa** — zato je u redu da `index.html` sa ključem bude u javnom repou.

## Deployment

### 1. Supabase (baza)

Projekat već postoji: `gradnjaos`, region eu-central-1, besplatan plan. Besplatan plan **pauzira projekat posle 7 dana bez upotrebe** — app tada javi šta da se uradi (dashboard → Restore, minut čekanja, osveži stranicu). Ako ovo postane iritantno, Pro plan (25 $/mes) to ukida.

Nova baza od nule: **SQL Editor → New query** → nalepi ceo `supabase/schema.sql` → Run (16 tabela, helperi, polise, `povezi_profil`). Zatim URL i anon ključ (Project Settings → API) u blok `KONFIGURACIJA ZA DEPLOYMENT` u `index.html`.

Postojeća baza sa starijom šemom: pokreni `supabase/migracija-NN-*.sql` redom, samo one koje nedostaju (svaka je idempotentna).

### 2. GitHub + GitHub Pages (hosting)

1. GitHub Desktop → **Add local repository** → ovaj folder → **Publish repository**. (Cela git istorija ide sa tim.)
2. **Settings → Pages → Source: Deploy from a branch → main / root → Save.**
3. Za ~1 minut app je na `https://TVOJ-NALOG.github.io/gradnjaos/`. Tu adresu upiši i u Supabase → Authentication → URL Configuration → Site URL (zbog magic linka).

Svaka sledeća izmena = commit + push (Pages se sam osveži). Na iPhone testiraj preko live URL-a (uz `?v=N` protiv keša).

### 3. Pravo slanje mejla trebovanja (opciono)

Sad se trebovanje šalje kroz mailto (otvori mail klijent). Za pravo slanje: `supabase functions deploy posalji-trebovanje` + `supabase secrets set RESEND_API_KEY=...` (v. `supabase/functions/posalji-trebovanje/index.ts`). Dok to nije urađeno, app tiho ostaje na mailto.

## Poznata ograničenja

- Prevlačenje zadataka (drag & drop) radi mišem; na telefonu koristi klik na karticu.
- Upis u bazu je „poslednji piše — pobeđuje" po redu: ako dvoje menja ISTI zapis istovremeno, kasniji pregazi raniji. Različite zapise više ljudi menja bez sukoba (čuva se samo ono što se promenilo).
- Brisanje pojedinačnih stavki nije u UI (samo pun demo reset) — namerno.
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
