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

## Lekcija 10 (2026-09-23, Supabase pauza)
Besplatni Supabase plan PAUZIRA projekat posle 7 dana bez aktivnosti (status
INACTIVE). App tada pada u demo rezim uz alert. Podaci ostaju, treba samo
Restore (dashboard ili MCP restore_project). Pre svake sesije rada na bazi:
proveri get_project status, ne pretpostavljaj da je ziva. Poruka greske u app-u
sad to eksplicitno kaze.

## Lekcija 11 (2026-09-23, F4)
`language sql` funkcija se validira PRI KREIRANJU: telo koje pominje tabelu koja
jos ne postoji pada. U migraciji tabele idu pre helpera koji ih koriste (ili
plpgsql / check_function_bodies=off). Uhvaceno citanjem pre primene, ne padom.

## Lekcija 12 (2026-09-23, F4)
Pre nego sto test tvrdi "X je dodato pa mora nestati posle reseta", proveri da X
nije VEC u DEMO podacima. T18 je birao z2/g1 rucno — z2 u DEMO vec radi na g1,
pa je "z2/g1 prezivela reset" bio lazan pad. Pravilo: par za test birati
DINAMICKI iz podataka (prvi koji nije u grs ni bivsi), ne napamet.

## Lekcija 13 (2026-09-23, F4)
Preview panel ucitava file:// kao data: URL (opaque origin) -> nema localStorage
-> supabase-js ne moze da sacuva sesiju -> posle reload-a si odjavljen. To NIJE
bug app-a (u pravom browseru na file:// i http(s) sesija traje). Auth tok se u
panelu testira bez reload-a: signIn -> initAuth() -> loadState() -> ... rucno.
Sonda koja zove setRole()/render() na login ekranu puca jer rebuildMaps() jos
nije pozvan — globali su tada poluinicijalizovani, to je ocekivano.

## Lekcija 14 (2026-09-23, F4)
RLS na serveru se testira DIREKTNO: `begin; set local role authenticated;
set local request.jwt.claims='{"sub":"<uuid>","role":"authenticated"}'; ...`
iz execute_sql (postgres sme set role). Za upise: DO blok sa BEGIN/EXCEPTION po
slucaju + temp tabela on commit drop. Jedini nacin da se polise dokazu bez
ugadjanja. Probne redove obrisati posle (transakcija se mozda komituje).

## Lekcija 15 (2026-09-23, F4b)
RLS polisa NE MOZE da sakrije kolonu. Ukidanje SELECT polise ulozi obara i
njen UPDATE (Postgres proverava SELECT polisu na redu koji se azurira preko
WHERE) — provereno: update predmer ... where gr='g1' -> 0 redova. Kolone se
kriju column-level GRANT-om: table-level select se mora UKINUTI pa vratiti
dozvoljene kolone (kolonski revoke uz table-level grant nema efekta), a citanje
ide kroz view koji radi kao vlasnik (ne security_invoker) sa eksplicitnim
filterom redova istim kao RLS.

## Lekcija 16 (2026-09-23, F4b)
Upsert = INSERT ... ON CONFLICT DO UPDATE: Postgres proverava INSERT WITH CHECK
na predlozenom redu i kad ce doci do UPDATE putanje. Ako je INSERT polisa
je_direktor(), rukovodiocev upsert SVOG reda pada sa "new row violates RLS".
Postojeci redovi -> UPDATE, novi -> INSERT; upsert samo za seed/reset. F4 je to
imao kao latentan bug jer je testiran plain UPDATE, ne upsert kroz PostgREST.

## Lekcija 17 (2026-09-24, F4b)
Scratchpad fajlovi napisani Write alatom mogu da nestanu izmedju poteza (p13.js,
t19.js). Test blokove ubacivati DIREKTNO u test/e2e.js (Edit na sidro sekcije),
patch skripte pisati neposredno pre pokretanja. Pre pokretanja: `ls` scratchpad.
