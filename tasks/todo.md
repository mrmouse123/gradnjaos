# Revizija koda v0.4 (boris-cherny workflow)

## Plan
- [x] 1. XSS audit: esc() pokrivenost na svim unosima
- [x] 2. Permisije: guard u svakoj mutirajucoj funkciji
- [x] 3. Integritet ID-eva (Date.now() kolizije)
- [x] 4. Sync sloj: TABLES == DEMO kljucevi, normalize kompletan
- [x] 5. Mrtav kod posle refaktora modula
- [x] 6. Simetrija tabela th==td (lekcija iz lessons.md)
- [x] 7. Konzistentnost izracunatih vrednosti
- [x] 8. E2E regresija 5 uloga x 3 modula x svi pogledi

## Review
NADJENO I POPRAVLJENO:
- F1 (srednje): 3 polja pretrage renderovala su uneti tekst u value atribut bez esc()
  -> attribute injection / self-XSS. Fix: esc() na sva tri.
- F2 (srednje): 9 mutirajucih funkcija bez role-guarda (dugmad sakrivena, funkcije ne)
  -> saveSit, markPaid, saveEmp, saveClient, saveSite, saveSub, saveRaspored,
     saveUpdate (vlasnistvo), oznaciIsporuceno (vlasnistvo). U pilotu simulacija,
     ali guardovi su temelj za Supabase Auth prelaz (ista pravila sele se u RLS).
- F3 (nisko): mrtva konstanta MODULI zaostala iz refaktora modula. Uklonjena.

PROVERENO CISTO:
- esc() pravilno escapuje i navodnike i backtick
- ID generisanje: razliciti prefiksi po entitetu, nema kolizionog scenarija
- TABLES pokriva svih 9 tabela, normalize puni sve podrazumevane vrednosti
- potroseno()/marza/UKUPNO konzistentni (plan-marza svuda)
- saveNarudzba, saveTrosak, saveTim vec imali guardove (dobar presedan)

RIZICI KOJI OSTAJU (svesno, za Supabase fazu):
- Simulacija uloga: korisnik sam bira ulogu -> prava zastita tek uz Auth+RLS
- mailto nabavka zahteva klik u mail klijentu -> Edge Function kasnije
- Jedan HTML fajl ~150KB: jos udoban, ali pratiti rast


# Zahtevi klijenta — implementacija (2026-08-08)
- [x] Predmer sa jedinicnim cenama + paste-uvoz iz Excela (tab i ;)
- [x] Izvedene kolicine po poziciji + kumulativni pregled + CSV izvoz
- [x] Specifikacija usluga za Projektovanje (isti mehanizam + kolona Zaduzen: zaposleni/spoljni)
- [x] Gradiliste: povrsina, kontakt nadzora, administracija (ugovor/prijava/polisa/podugovori)
- [x] Troskovi: polja dobavljac + br. fakture
- [x] Resursi: vozila/alati/racunari/licence/polise, dodela, istek + upozorenja
- [x] Magacin: artikli, stanje, ulaz (direktor) / izlaz na gradiliste (i rukovodilac, samo svoje)
- [x] Nabavka -> Trebovanje (klijentov termin); Podizvodjaci -> Spoljni saradnici u Projektovanju
- [ ] CEKA: uvoz faktura kao PDF + pravi .xlsx upload (Supabase Storage faza)
- [ ] CEKA: sablon faza/zadataka po modulu (Jovanovi materijali)
