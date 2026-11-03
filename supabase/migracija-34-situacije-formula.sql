-- migracija 34 (2026-11-03, uskladjivanje formule situacija sa klijentom i mock-om; nalaz testa T67 / test/sql):
--   preracunaj_situacije:
--   1) stavka sa praznom sifrom ('') se tretira kao stavka BEZ sifre (kljuc je poz), kao u klijentu (kljucStavke) —
--      pre toga su sve takve stavke dolazile pod kljuc 'sifra:' i kumulativ se spajao preko razlicitih pozicija;
--   2) situacije.iznos se zaokruzuje na 2 decimale (klijent: Math.round(x*100)/100) — pre toga je numeric dobijao 3.3330.
--   Aplikacija uvek upisuje sifra || null, pa (1) pogadja samo direktan upis preko REST-a; (2) menja iznose sa 3+ decimale kolicine.
--   Idempotentna. Na kraju se preracunavaju postojece situacije.
create or replace function preracunaj_situacije(p_gid text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_gid is null then return; end if;
  update situacija_stavke st set kol_ugovoreno = coalesce((select p.kol from predmer p where p.id = st.predmer_id), 0)
   where st.gr = p_gid;
  update situacija_stavke st set kumulativ = x.kum, razlika = greatest(0, x.kum - st.kol_ugovoreno)
    from (select st2.id,
                 sum(st2.kol) over (partition by st2.gr, coalesce(st2.predmer_id, 'sifra:'||nullif(st2.sifra, ''), 'poz:'||lower(st2.poz))
                                    order by s2.izdato, s2.id, st2.id rows between unbounded preceding and current row) as kum
            from situacija_stavke st2 join situacije s2 on s2.id = st2.sit where st2.gr = p_gid) x
   where x.id = st.id;
  update situacije s set iznos = round(coalesce((select sum(st.kol * coalesce(p.cena, 0)) from situacija_stavke st left join predmer p on p.id = st.predmer_id where st.sit = s.id), 0), 2)
   where s.gr = p_gid and exists (select 1 from situacija_stavke st where st.sit = s.id);
end $$;
revoke execute on function preracunaj_situacije(text) from public, anon;

-- Preracun postojecih situacija: prazan update stavki pokrece trg_stavke_preracun → preracunaj_situacije. Upis iznosa prolazi jer
-- se izvrsava iz trigera (pg_trigger_depth() > 1 u zastiti_kolone_situacije). Provereno nad punim schema.sql (test/rls/replay.js).
update situacija_stavke set kol = kol;
