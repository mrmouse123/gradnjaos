-- migracija 33 (2026-10-23, pregled tačnosti novog koda):
--   1) angazovanost(): otvorena sesija se broji do granice auto-pauze (least(now(), granica)), ne do now() — inače do 15 min
--      viška između 16:00 i sledećeg cron otkucaja (klijent minSesije već odseca). Guard ostaje je_puna_uprava (migracija 28).
--   2) mejl_direktora_izvodjenja(): samo nalozi SA profilom (nalog bez profila ne vidi ništa, pa ni ovaj mejl).
create or replace function angazovanost(p_od date default (current_date - 30), p_do date default current_date)
returns table (osoba text, gr text, sesija bigint, minuta bigint, poslednji timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not je_puna_uprava() then raise exception 'Samo direktor i admin vide angažovanost.'; end if;
  return query
    select r.osoba, r.gr, count(*)::bigint,
           coalesce(sum(coalesce(r.minuta, greatest(0, floor(extract(epoch from (least(now(), granica_auto_pauze(r.start)) - r.start)) / 60))::int)),0)::bigint,
           max(coalesce(r.kraj, r.start))
    from rad_na_zadatku r
    where r.start::date between p_od and p_do
    group by r.osoba, r.gr order by r.osoba, r.gr;
end $$;

create or replace function mejl_direktora_izvodjenja() returns text
language sql stable security definer set search_path = public, auth as $$
  select u.email::text from profili p join auth.users u on u.id = p.user_id
   where p.uloga = 'direktor_izvodjenja'
     and exists (select 1 from profili me where me.user_id = auth.uid())
   order by p.created_at limit 1
$$;
