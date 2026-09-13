# GradnjaOS — pilot PM alat za građevinsku firmu

Jedan HTML fajl (`index.html`) bez build koraka: kontrolna tabla sa finansijama i upozorenjima, gradilišta, klijenti, zaposleni sa opisom posla, Gantt rokovi, Kanban zadaci, dnevnik radova i naplata (privremene situacije). Uloge: **direktor** vidi sve, **rukovodilac** vidi samo svoja gradilišta i ne vidi finansije.

## Pokretanje lokalno

Otvori `index.html` u pretraživaču — radi odmah sa demo podacima (izmene traju do osvežavanja stranice, dok se ne poveže baza).

## Deployment — korak po korak

### 1. Supabase (baza, ~5 minuta)

1. Napravi nalog na [supabase.com](https://supabase.com) i klikni **New project** (besplatni plan je dovoljan za pilot).
2. Kada se projekat podigne, otvori **SQL Editor → New query**, nalepi ceo sadržaj `supabase/schema.sql` i klikni **Run**. Time se prave svih 6 tabela.
3. Otvori **Project Settings → API** i kopiraj:
   - **Project URL** (npr. `https://xxxx.supabase.co`)
   - **anon public** ključ
4. Otvori `index.html`, pronađi blok `KONFIGURACIJA ZA DEPLOYMENT` pri vrhu `<script>` sekcije i nalepi obe vrednosti:
   ```js
   const SUPABASE_URL = 'https://xxxx.supabase.co';
   const SUPABASE_ANON_KEY = 'eyJ...';
   ```

Pri prvom pokretanju sa praznom bazom aplikacija sama zaseje demo podatke; dugme „Vrati demo podatke" u sidebaru briše sve i vraća početno stanje. U podnožju sidebara piše u kom režimu app radi (Supabase / memorija).

### 2. GitHub + GitHub Pages (hosting, ~5 minuta)

1. Napravi novi repozitorijum na GitHub-u (može privatan — Pages radi i tada na plaćenim planovima; za besplatan plan repo mora biti javan).
2. Otpremi sadržaj ovog foldera (`index.html`, `supabase/`, `README.md`, `.gitignore`), ili preko terminala:
   ```bash
   git init
   git add .
   git commit -m "GradnjaOS pilot v0.4"
   git branch -M main
   git remote add origin https://github.com/TVOJ-NALOG/gradnjaos.git
   git push -u origin main
   ```
3. U repozitorijumu: **Settings → Pages → Source: Deploy from a branch → main / root → Save**.
4. Za ~1 minut aplikacija je dostupna na `https://TVOJ-NALOG.github.io/gradnjaos/`.

Svaka sledeća izmena = novi `git push` (Pages se sam osveži).

## ⚠ Bezbednosne napomene za pilot

- **Anon ključ u kodu je javan po dizajnu** (tako Supabase radi za browser aplikacije) — zaštitu daju RLS polise. U pilotu su polise namerno otvorene (`pilot_full`): **svako ko ima link može da čita i menja podatke**. Prihvatljivo za interni test u firmi, nije za javnu upotrebu.
- Izbor uloge (direktor/rukovodilac) je **simulacija** u interfejsu, ne prava prijava — rukovodilac tehnički može da vidi sve otvaranjem konzole.
- Sledeći korak pre šire upotrebe: **Supabase Auth** (prijava mejlom), kolona `user_id`/uloga po zaposlenom, i RLS polise koje na nivou baze filtriraju šta rukovodilac sme da vidi i menja. Tada simulaciju uloga u UI zamenjuje stvarna sesija.

## Poznata ograničenja

- Prevlačenje zadataka (drag & drop) radi mišem; na telefonu koristi klik na karticu.
- Upis u bazu je „poslednji piše — pobeđuje": ako dvoje menja isti podatak istovremeno, kasniji upis pregazi raniji. Za pilot sa par korisnika je u redu.
- Brisanje pojedinačnih stavki nije u UI (samo pun reset) — namerno, da se u pilotu ništa ne izgubi slučajno.

## Struktura

```
index.html                              # cela aplikacija (UI + logika + Supabase adapter)
supabase/schema.sql                     # šema baze + pilot RLS polise
supabase/migracija-01-vise-projekata.sql # samo za baze napravljene starim schema.sql
supabase/migracija-02-istorija-projekata.sql # dodaje istoriju projekata po zaposlenom
tasks/                                  # plan rada i lekcije (interni radni dokumenti)
```

## Nadogradnja postojeće baze

Ako si bazu napravio starijom verzijom šeme (kolona `zaposleni.gr`), pokreni
`supabase/migracija-01-vise-projekata.sql` u SQL Editoru — prebacuje raspored
u listu `grs` bez gubitka podataka. Aplikacija usput normalizuje i stare podatke
iz ugrađenog skladišta sama.
