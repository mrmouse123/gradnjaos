-- ============================================================
-- Migracija 24 (2026-10-12): MARZA UKLONJENA (odluka klijenta: "ne merimo to").
--   U bazi marza nikad nije bila kolona — zivela je samo u formuli zdravlja (plan_m / ostv_m). Sada:
--   zavrsen projekat = 100 (ranije 90 + 10/5 po planskoj marzi), nema penala "ostvarena marza < 8%".
--   Ostaju: rok, zadaci, troskovi ispred napretka (plan = gradilista.troskovi), naplata zaostaje.
--   ISTA formula kao zdravlje(g) na klijentu (index.html) — menjati oba.
-- Idempotentna.
-- ============================================================
create or replace function zdravlje_gradilista(gid text) returns int
language plpgsql stable security definer set search_path = public as $$
declare
  g gradilista%rowtype; sc int := 100; d date := danas_bg(); diff int; kasne int;
  n_tr int; n_sit int; pot numeric; napl numeric; ocek numeric; napl_pct numeric;
begin
  if not moje_gradiliste(gid) then return null; end if;
  select * into g from gradilista where id = gid;
  if not found then return null; end if;

  select count(*), coalesce(sum(iznos),0) into n_tr, pot from troskovi_st where gr = gid;
  if n_tr = 0 then pot := coalesce(g.potroseno, 0); end if;
  select count(*), coalesce(sum(iznos) filter (where status = 'placeno'),0) into n_sit, napl from situacije where gr = gid;
  if n_sit = 0 then napl := coalesce(g.naplaceno, 0); end if;

  if g.status = 'zavrseno' then return 100; end if;   -- zavrsen projekat = 100 (bez marze)

  diff := g.rok - d;
  if g.status = 'kasni' or diff < 0 then sc := sc - 35;
  elsif diff <= 30 and coalesce(g.napredak,0) < 90 then sc := sc - 15; end if;

  select count(*) into kasne from zadaci where gr = gid and kol <> 'done' and rok < d;
  sc := sc - least(15, kasne * 5);

  ocek := coalesce(g.troskovi,0) * coalesce(g.napredak,0) / 100.0;
  if coalesce(g.napredak,0) > 0 and pot > ocek * 1.1 then sc := sc - 20; end if;
  napl_pct := case when coalesce(g.budzet,0) <> 0 then floor(napl / g.budzet * 100 + 0.5) else 0 end;
  if coalesce(g.napredak,0) - napl_pct > 25 then sc := sc - 15; end if;

  return greatest(5, sc);
end $$;
revoke execute on function zdravlje_gradilista(text) from public, anon;
grant  execute on function zdravlje_gradilista(text) to authenticated;
