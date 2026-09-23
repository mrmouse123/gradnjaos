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
- GitHub publish (GitHub Desktop → Add local repository → Publish); sa RLS-om
  javni repo je OK
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

# F4b: hardening — finansije ne stizu rukovodiocu ni na nivou API-ja (2026-09-23)

Trazeno: "RPC zdravlje na serveru". Sam RPC ne zatvara rupu — budzet/troskovi su
kolone na gradilista redu, cena na predmer redu, a te redove rukovodilac MORA
da cita. Zato ceo paket iz CLAUDE.md "Hardening posle F4", jedna migracija (11):
- [ ] 1. SQL: zdravlje_gradilista(gid) + zdravlja_mojih() (ista formula kao
      klijent, "danas" po Europe/Belgrade); view-ovi gradilista_v/predmer_v/
      podizvodjaci_v (security_invoker; finansijske kolone NULL osim direktoru);
      trigeri: rukovodilac na gradilista menja samo napredak/faza/status, na
      predmer samo izv, na magacin samo stanje; troskovi_st/situacije select
      samo direktor
- [ ] 2. Primena na zivu bazu + provera sa set local role (view NULL, trigger
      drzi budzet, troskovi_st = 0 redova, zdravlja_mojih samo g1)
- [ ] 3. Server score == klijent score za svih 9 gradilista (direktor u browseru)
- [ ] 4. Klijent: citanje iz view-ova, rukovodilac preskace troskovi_st/situacije,
      ZDR_SRV iz RPC-a, zdravlje(g) koristi server skor kad je rukovodilac,
      osvezavanje posle cuvanja, rowsZa skida finansijske kolone rukovodiocu
- [ ] 5. Mock: rpc(), view aliasi sa NULL kolonama za ne-direktora; T19
- [ ] 6. Browser: rukovodilac vidi zdravlje == direktorovo, bez ijednog iznosa u DATA
- [ ] 7. Docs + commit
