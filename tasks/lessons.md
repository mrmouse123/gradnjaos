# Lekcije

- Kada zamenjuješ ceo blok koda regexom, prvo popiši sve deklaracije (let/const/function) u starom bloku i potvrdi da ih novi blok sadrži — brisanje `let DATA` je oborilo oba režima rada i uhvaćeno je tek e2e testom.

## Lekcija 4 (2026-08-08, zahtevi klijenta)
Pri velikim visestrukim patch-evima: SVAKI replace mora imati assert da je cilj nadjen.
Patch C je "uspeo" a dva replace-a tiho promasila (\u literali u cilju + sidro koje ne postoji).
Pravilo: python replace bez assert-a je replace koji ne postoji. E2E test je uhvatio oba promasaja.
