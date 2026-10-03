# Masovni uvoz projekata iz Excela

Jedan fajl puni celu bazu: aktuelne i istorijske projekte, klijente, zaposlene, timove,
predmere, zadatke, dnevnik, troškove, situacije, podizvođače, resurse i magacin.

## Fajlovi
- `GradnjaOS-uvoz-sablon.xlsx` — šablon za klijenta (list „Uputstvo" objašnjava popunjavanje;
  žuto = popunjava se, narandžasto = obavezno, red 2 = primer; padajući meniji za sve šifarnike).
- `napravi-sablon.py` — regeneriše šablon (`python uvoz/napravi-sablon.py`). Menjati OVDE, ne u Excelu.
- `uvezi.py` — proverava popunjen fajl i pravi `uvoz.sql`.

## Postupak (kad klijent vrati popunjen fajl)
```bash
python uvoz/uvezi.py "putanja/do/popunjen.xlsx" --provera     # samo provera, bez SQL-a
python uvoz/uvezi.py "putanja/do/popunjen.xlsx"               # pravi uvoz.sql pored fajla
```
Bilo koja greška (nepoznata vrednost u padajućem meniju, šifra koja ne postoji u drugom listu,
loš datum, prazna obavezna kolona) → ispis liste grešaka sa listom i redom, **bez SQL-a**.

`uvoz.sql` je jedna transakcija sa `INSERT … ON CONFLICT (id) DO UPDATE`: ponovni uvoz istog
(ispravljenog) fajla samo osvežava redove, ne duplira ih; ništa se ne briše. Pokreće se kao
vlasnik baze (Supabase → SQL Editor, ili kroz Claude `execute_sql`) — zato upsert prolazi i
na tabelama sa finansijskim kolonama (kroz API ne bi, v. CLAUDE.md pravilo 8).

Pre pravog uvoza: isti SQL sa `rollback;` umesto `commit;` pokazuje da li baza prihvata sve
(provereno 2026-10-04 sa primer-redovima šablona na živoj bazi).

## Pravila koja šablon i uvoz poštuju (iz CLAUDE.md)
- Tekst se escape-uje pri upisu (`&` → `&amp;` …) kao što radi aplikacija (escape-on-write).
- Datumi nikad prazni tamo gde ih aplikacija čita (`pocetak`, `rok`, `datum`…); jedino
  `resursi.istice` i `adm[k].vazi_do` smeju da budu prazni.
- `gradilista.rukovodilac` je obavezan — to je osnov RLS-a (ko vidi projekat).
- Završen (istorijski) projekat: `status=zavrseno` → `napredak` se postavlja na 100; tim sa
  `aktivan=NE` ulazi u istoriju zaposlenog (`bivsi`).
- Nizovi `zaposleni.grs`/`podizvodjaci.grs` ne postoje u bazi — uvoz piše join tabele
  (`zaposleni_gradiliste`, `podizvodjac_gradiliste`), aplikacija ih sama sastavlja pri učitavanju.
