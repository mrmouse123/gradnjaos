-- ============================================================
-- Migracija 13 (2026-10-07): napredak gradilista = ugovoreno × izvedeno (iz predmera)
--   * napredak_iz_predmera(gr): vrednosno ponderisan udeo izvedenog
--       Σ min(izv,kol)·cena / Σ kol·cena  (ako su sve cene 0 → po kolicinama Σ min(izv,kol) / Σ kol)
--     NULL kad gradiliste nema predmer (tada ostaje rucni napredak).
--   * trigger na predmer (insert/update/delete) osvezava gradilista.napredak — radi kao
--     vlasnik, pa prolazi i kad rukovodilac (koji ne vidi cene) ucita izvedeno.
--   * zdravlja_mojih() vraca i napredak, da klijent rukovodioca preuzme izracunatu vrednost.
--   * jednokratno: sva postojeca gradilista sa predmerom dobijaju napredak iz predmera.
-- Ista formula je i u klijentu (napredakIzPredmera u index.html) — menjati na OBA mesta.
-- Idempotentna.
-- ============================================================

create or replace function napredak_iz_predmera(p_gr text) returns int
language sql stable security definer set search_path = public as $$
  select case
    when count(*) = 0 then null
    when coalesce(sum(kol * cena), 0) > 0 then floor(100.0 * sum(least(coalesce(izv,0), kol) * cena) / sum(kol * cena) + 0.5)::int
    when coalesce(sum(kol), 0) > 0 then floor(100.0 * sum(least(coalesce(izv,0), kol)) / sum(kol) + 0.5)::int
    else 0 end
  from predmer where gr = p_gr;
$$;
revoke execute on function napredak_iz_predmera(text) from public, anon;
grant  execute on function napredak_iz_predmera(text) to authenticated;

create or replace function osvezi_napredak(p_gr text) returns void
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if p_gr is null then return; end if;
  select napredak_iz_predmera(p_gr) into n;
  if n is not null then
    update gradilista set napredak = least(100, greatest(0, n)) where id = p_gr and napredak is distinct from least(100, greatest(0, n));
  end if;
end $$;

create or replace function trg_predmer_napredak() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then perform osvezi_napredak(old.gr);
  else
    perform osvezi_napredak(new.gr);
    if tg_op = 'UPDATE' and old.gr is distinct from new.gr then perform osvezi_napredak(old.gr); end if;
  end if;
  return null;
end $$;
drop trigger if exists predmer_napredak on predmer;
create trigger predmer_napredak after insert or update or delete on predmer
  for each row execute function trg_predmer_napredak();

-- zdravlja_mojih: + napredak (promena tipa rezultata → drop pa create)
drop function if exists zdravlja_mojih();
create function zdravlja_mojih() returns table (id text, zdravlje int, napredak int)
language sql stable security definer set search_path = public as $$
  select g.id, zdravlje_gradilista(g.id), g.napredak from gradilista g where moje_gradiliste(g.id) order by g.id;
$$;
revoke execute on function zdravlja_mojih() from public, anon;
grant  execute on function zdravlja_mojih() to authenticated;

-- jednokratno: "aplikuj na sva gradilista"
update gradilista g set napredak = napredak_iz_predmera(g.id)
 where exists (select 1 from predmer p where p.gr = g.id)
   and napredak is distinct from napredak_iz_predmera(g.id);
