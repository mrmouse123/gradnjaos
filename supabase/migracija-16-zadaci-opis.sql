-- ============================================================
-- Migracija 16 (2026-10-08): zadaci.opis — duzi opis zadatka (forma + kartica + log tajmera)
-- Idempotentna. zadaci imaju table-level SELECT grant, pa je nova kolona odmah citljiva.
-- ============================================================
alter table zadaci add column if not exists opis text;
-- radnik/spoljni na svom zadatku i dalje menjaju samo kol (trigger iz migracije 14, dopunjen za opis)
create or replace function zastiti_kolone_zadaci() returns trigger language plpgsql as $$
begin
  if auth.uid() is not null and not vodim_gradiliste(new.gr) then
    new.naziv := old.naziv; new.gr := old.gr; new.zad := old.zad; new.prio := old.prio; new.rok := old.rok; new.opis := old.opis;
  end if;
  return new;
end $$;
