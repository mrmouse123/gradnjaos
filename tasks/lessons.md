# Lekcije

- Kada zamenjuješ ceo blok koda regexom, prvo popiši sve deklaracije (let/const/function) u starom bloku i potvrdi da ih novi blok sadrži — brisanje `let DATA` je oborilo oba režima rada i uhvaćeno je tek e2e testom.

## Lekcija 4 (2026-08-08, zahtevi klijenta)
Pri velikim visestrukim patch-evima: SVAKI replace mora imati assert da je cilj nadjen.
Patch C je "uspeo" a dva replace-a tiho promasila (\u literali u cilju + sidro koje ne postoji).
Pravilo: python replace bez assert-a je replace koji ne postoji. E2E test je uhvatio oba promasaja.

## Lekcija 5 (2026-09-14, revizija v0.5)
Heredoc u ovom okruzenju pojede backslash: `\w` u <<'EOF' stigne kao `\w`, pa JS string
postane `w` i cilj zamene se ne nadje. Patch skripte pisati Write alatom, ne heredoc-om.
Assert je to uhvatio odmah — fajl nije ni dirnut jer Patcher pise tek na kraju.

## Lekcija 6 (2026-09-14, revizija v0.5)
Grubi regex nad izvorom je LOSA osnova za tvrdnju o bezbednosti. Prvi prolaz je prijavio
"~10 funkcija bez esc()" jer nije video obrazac `esc(String(v('x')).trim())`. Tacan nalaz
se dobija tek kad se uporedi i TIP kontrole u formi (input/select/date/number) sa tim
da li vrednost prolazi kroz esc(). Pravilo: pre prijave bezbednosnog nalaza — dokazi ga
izvrsavanjem kroz pravi put upisa, ne citanjem regexa.

## Lekcija 7 (2026-09-14, revizija v0.5)
esc() escapuje samo < > & " ' ` — NE i `=` ili `()`. Zato detektor XSS-a u testu ne sme
da trazi `onerror=xss()` (to prezivi i escapovano, kao bezopasan tekst) nego neescapovanu
`<img`. Prva verzija testa je zbog toga prijavila dva lazna pada.

## Lekcija 8 (2026-09-14, F3 prilog uz trosak)
Test koji broji app.g.document._created mora pamtiti duzinu niza PRE akcije i
posmatrati samo novododate elemente (.slice(preN)) — _created se akumulira kroz
CEO test fajl, ne resetuje se po testu. Prvi pokusaj je nasao file input koji je
napravio PRETHODNI (uspesan) test, pa je "guard blokira rukovodioca" lazno pao.

## Lekcija 9 (2026-09-14, F3 prilog uz trosak)
Bash -e sa ugnjezdenim template-literal backtick-ovima (JS kod unutar JS koda,
sa \${...}) je nepouzdano u ovom shell-u — quoting/escaping pravila iz bash i iz
JS se sudaraju. Za izmenu vec postojeceg test fajla koristiti Edit alat direktno
(Read pa Edit), ne node -e sa inline stringom, cim string sadrzi backtick+${.

## Lekcija 10 (2026-09-14, povezivanje Supabase)
Test harness (`boot({supabase:true})`) je trazio DOSLOVNO prazan string
(`const SUPABASE_URL = '';`) da bi simulirao povezano stanje — cim su prave
vrednosti upisane u index.html, taj match je promasio i sav T10+ blok je pukao.
Fix: regex `/const SUPABASE_URL = '[^']*';/` — radi bez obzira da li je repo u
"pre povezivanja" ili "posle povezivanja" stanju. Pravilo: kad test menja
literalni kod, ne oslanjati se na TRENUTNU vrednost polja koje ce se menjati.

## Lekcija 11 (2026-09-14, povezivanje Supabase)
Kombinovanje vise razlicitih akcija u JEDAN Bash poziv (heredoc upis fajla +
git add + git commit + node test) blokirao je auto-mode klasifikator. Kad
komanda kombinuje pisanje/commit/test u nizu, deliti je na odvojene pozive —
brze prolazi i lakse je videti koji korak je stvarno pao.
