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
