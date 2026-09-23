-- ============================================================
-- Migracija 10: Supabase Auth + RLS po ulogama (F4) — 2026-09-23
-- Za POSTOJEĆU bazu. Sveža baza dobija isto iz schema.sql.
-- Idempotentna: može se pokrenuti više puta.
--
-- Šta menja:
--  1) profili         — ko je ko: user_id (auth.users) -> uloga + zaposleni_id
--  2) helper funkcije — je_direktor(), moj_zaposleni(), moje_gradiliste(gid)...
--                       security definer da polise ne rekurziraju kroz RLS
--  3) join tabele     — zaposleni_gradiliste / podizvodjac_gradiliste
--                       (nizovi grs[]/bivsi[] se ne mogu ograničiti RLS-om);
--                       backfill iz nizova, pa brisanje kolona-nizova
--  4) polise          — pilot_full (anon, sve) -> polise za 'authenticated':
--                       bez profila = nula; direktor = sve; rukovodilac = samo
--                       redovi svojih gradilišta (isto što i smemNa() u app-u)
--  5) povezi_profil() — spaja email iz auth.users sa ulogom (samo iz SQL editora)
-- ============================================================

-- ---------- 1) profili ----------
create table if not exists profili (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  zaposleni_id text,                               -- null za direktora koji nije u zaposleni
  uloga        text not null check (uloga in ('direktor','rukovodilac')),
  ime          text,
  created_at   timestamptz default now()
);
alter table profili enable row level security;

-- Join tabele idu PRE helpera: moj_podizvodjac() je `language sql`, pa Postgres
-- proverava telo pri kreiranju i traži da podizvodjac_gradiliste već postoji.
create table if not exists zaposleni_gradiliste (
  zaposleni_id  text not null references zaposleni(id)  on delete cascade,
  gradiliste_id text not null references gradilista(id) on delete cascade,
  aktivan       boolean not null default true,        -- true = grs, false = bivsi (istorija)
  primary key (zaposleni_id, gradiliste_id)
);
create table if not exists podizvodjac_gradiliste (
  podizvodjac_id text not null references podizvodjaci(id) on delete cascade,
  gradiliste_id  text not null references gradilista(id)   on delete cascade,
  primary key (podizvodjac_id, gradiliste_id)
);
alter table zaposleni_gradiliste   enable row level security;
alter table podizvodjac_gradiliste enable row level security;

-- ---------- 2) helperi (security definer: čitaju profili/gradilista mimo RLS-a) ----------
create or replace function ima_profil() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profili where user_id = auth.uid());
$$;

create or replace function je_direktor() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profili where user_id = auth.uid() and uloga = 'direktor');
$$;

create or replace function moj_zaposleni() returns text
language sql stable security definer set search_path = public as $$
  select zaposleni_id from profili where user_id = auth.uid();
$$;

-- Isto pravilo kao smemNa(grId) u index.html: direktor sve, rukovodilac svoje.
create or replace function moje_gradiliste(gid text) returns boolean
language sql stable security definer set search_path = public as $$
  select je_direktor()
      or exists (select 1 from gradilista g where g.id = gid and g.rukovodilac = moj_zaposleni());
$$;

create or replace function moj_klijent(cid text) returns boolean
language sql stable security definer set search_path = public as $$
  select je_direktor()
      or exists (select 1 from gradilista g where g.klijent = cid and g.rukovodilac = moj_zaposleni());
$$;

create or replace function moj_podizvodjac(pid text) returns boolean
language sql stable security definer set search_path = public as $$
  select je_direktor()
      or exists (select 1 from podizvodjac_gradiliste pg
                 join gradilista g on g.id = pg.gradiliste_id
                 where pg.podizvodjac_id = pid and g.rukovodilac = moj_zaposleni());
$$;

-- ---------- 3) backfill join tabela iz nizova + brisanje kolona-nizova ----------
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema='public' and table_name='zaposleni' and column_name='grs') then
    insert into zaposleni_gradiliste (zaposleni_id, gradiliste_id, aktivan)
      select z.id, g, true from zaposleni z, unnest(coalesce(z.grs, '{}')) as g
      where exists (select 1 from gradilista x where x.id = g)
      on conflict do nothing;
    insert into zaposleni_gradiliste (zaposleni_id, gradiliste_id, aktivan)
      select z.id, g, false from zaposleni z, unnest(coalesce(z.bivsi, '{}')) as g
      where exists (select 1 from gradilista x where x.id = g)
      on conflict do nothing;
    alter table zaposleni drop column grs, drop column bivsi;
  end if;

  if exists (select 1 from information_schema.columns
             where table_schema='public' and table_name='podizvodjaci' and column_name='grs') then
    insert into podizvodjac_gradiliste (podizvodjac_id, gradiliste_id)
      select p.id, g from podizvodjaci p, unnest(coalesce(p.grs, '{}')) as g
      where exists (select 1 from gradilista x where x.id = g)
      on conflict do nothing;
    alter table podizvodjaci drop column grs;
  end if;
end $$;

-- ---------- 4) polise ----------
-- pilot_full (anon = sve) više ne postoji: bez prijave nema pristupa.
do $$
declare t text;
begin
  foreach t in array array['clijenti','zaposleni','gradilista','zadaci','dnevnik','situacije',
                           'narudzbe','troskovi_st','podizvodjaci','mag_promene','magacin','resursi','predmer']
  loop
    execute format('drop policy if exists pilot_full on %I', t);
    execute format('drop policy if exists p_sel on %I', t);
    execute format('drop policy if exists p_ins on %I', t);
    execute format('drop policy if exists p_upd on %I', t);
    execute format('drop policy if exists p_del on %I', t);
  end loop;
  foreach t in array array['profili','zaposleni_gradiliste','podizvodjac_gradiliste'] loop
    execute format('drop policy if exists p_sel on %I', t);
    execute format('drop policy if exists p_ins on %I', t);
    execute format('drop policy if exists p_upd on %I', t);
    execute format('drop policy if exists p_del on %I', t);
  end loop;
end $$;

-- profili: svako vidi svoj red, direktor sve; upis samo kroz povezi_profil()
create policy p_sel on profili for select to authenticated using (user_id = auth.uid() or je_direktor());

-- gradilista: rukovodilac vidi i ažurira svoja; otvara/briše samo direktor
create policy p_sel on gradilista for select to authenticated using (moje_gradiliste(id));
create policy p_ins on gradilista for insert to authenticated with check (je_direktor());
create policy p_upd on gradilista for update to authenticated using (moje_gradiliste(id)) with check (moje_gradiliste(id));
create policy p_del on gradilista for delete to authenticated using (je_direktor());

-- zadaci: sve na svom gradilištu
create policy p_sel on zadaci for select to authenticated using (moje_gradiliste(gr));
create policy p_ins on zadaci for insert to authenticated with check (moje_gradiliste(gr));
create policy p_upd on zadaci for update to authenticated using (moje_gradiliste(gr)) with check (moje_gradiliste(gr));
create policy p_del on zadaci for delete to authenticated using (moje_gradiliste(gr));

-- dnevnik: unos samo pod svojim imenom (pravno relevantan dokument); izmena/brisanje direktor
create policy p_sel on dnevnik for select to authenticated using (moje_gradiliste(gr));
create policy p_ins on dnevnik for insert to authenticated with check (moje_gradiliste(gr) and (je_direktor() or autor = moj_zaposleni()));
create policy p_upd on dnevnik for update to authenticated using (je_direktor()) with check (je_direktor());
create policy p_del on dnevnik for delete to authenticated using (je_direktor());

-- narudzbe (trebovanje): rukovodilac šalje pod svojim imenom i označava isporuku
create policy p_sel on narudzbe for select to authenticated using (moje_gradiliste(gr));
create policy p_ins on narudzbe for insert to authenticated with check (moje_gradiliste(gr) and (je_direktor() or autor = moj_zaposleni()));
create policy p_upd on narudzbe for update to authenticated using (moje_gradiliste(gr)) with check (moje_gradiliste(gr));
create policy p_del on narudzbe for delete to authenticated using (je_direktor());

-- predmer: rukovodilac upisuje izvedene količine (update); pozicije/cene direktor
create policy p_sel on predmer for select to authenticated using (moje_gradiliste(gr));
create policy p_ins on predmer for insert to authenticated with check (je_direktor());
create policy p_upd on predmer for update to authenticated using (moje_gradiliste(gr)) with check (moje_gradiliste(gr));
create policy p_del on predmer for delete to authenticated using (je_direktor());

-- troskovi_st, situacije: čitanje svog gradilišta (za zdravlje(g)); upis direktor
-- NAPOMENA: rukovodilac na nivou API-ja može da pročita iznose SVOG gradilišta;
-- UI ih krije (pravilo 1). Sledeći korak hardeninga: RPC zdravlje(gid) na serveru.
create policy p_sel on troskovi_st for select to authenticated using (moje_gradiliste(gr));
create policy p_ins on troskovi_st for insert to authenticated with check (je_direktor());
create policy p_upd on troskovi_st for update to authenticated using (je_direktor()) with check (je_direktor());
create policy p_del on troskovi_st for delete to authenticated using (je_direktor());

create policy p_sel on situacije for select to authenticated using (moje_gradiliste(gr));
create policy p_ins on situacije for insert to authenticated with check (je_direktor());
create policy p_upd on situacije for update to authenticated using (je_direktor()) with check (je_direktor());
create policy p_del on situacije for delete to authenticated using (je_direktor());

-- resursi: firmski (gr null) + svoje gradilište; upis direktor
create policy p_sel on resursi for select to authenticated using (ima_profil() and (gr is null or moje_gradiliste(gr)));
create policy p_ins on resursi for insert to authenticated with check (je_direktor());
create policy p_upd on resursi for update to authenticated using (je_direktor()) with check (je_direktor());
create policy p_del on resursi for delete to authenticated using (je_direktor());

-- magacin: svi sa profilom vide i menjaju stanje (izlaz); artikle otvara/briše direktor
create policy p_sel on magacin for select to authenticated using (ima_profil());
create policy p_ins on magacin for insert to authenticated with check (je_direktor());
create policy p_upd on magacin for update to authenticated using (ima_profil()) with check (ima_profil());
create policy p_del on magacin for delete to authenticated using (je_direktor());

-- mag_promene: ulaz direktor; izlaz na svoje gradilište
create policy p_sel on mag_promene for select to authenticated using (ima_profil() and (gr is null or moje_gradiliste(gr)));
create policy p_ins on mag_promene for insert to authenticated with check (je_direktor() or (tip = 'izlaz' and moje_gradiliste(gr)));
create policy p_upd on mag_promene for update to authenticated using (je_direktor()) with check (je_direktor());
create policy p_del on mag_promene for delete to authenticated using (je_direktor());

-- clijenti: rukovodilac vidi investitora svog gradilišta (ime u fioci), ne ceo imenik
create policy p_sel on clijenti for select to authenticated using (moj_klijent(id));
create policy p_ins on clijenti for insert to authenticated with check (je_direktor());
create policy p_upd on clijenti for update to authenticated using (je_direktor()) with check (je_direktor());
create policy p_del on clijenti for delete to authenticated using (je_direktor());

-- zaposleni: spisak vide svi sa profilom (Jovanova odluka: formTim nudi sve); menja direktor
create policy p_sel on zaposleni for select to authenticated using (ima_profil());
create policy p_ins on zaposleni for insert to authenticated with check (je_direktor());
create policy p_upd on zaposleni for update to authenticated using (je_direktor()) with check (je_direktor());
create policy p_del on zaposleni for delete to authenticated using (je_direktor());

-- zaposleni_gradiliste: rukovodilac dodaje/skida ljude SAMO na svoje gradilište
create policy p_sel on zaposleni_gradiliste for select to authenticated using (ima_profil());
create policy p_ins on zaposleni_gradiliste for insert to authenticated with check (moje_gradiliste(gradiliste_id));
create policy p_upd on zaposleni_gradiliste for update to authenticated using (moje_gradiliste(gradiliste_id)) with check (moje_gradiliste(gradiliste_id));
create policy p_del on zaposleni_gradiliste for delete to authenticated using (je_direktor());

-- podizvodjaci: rukovodilac vidi one angažovane na svom gradilištu; menja direktor
create policy p_sel on podizvodjaci for select to authenticated using (moj_podizvodjac(id));
create policy p_ins on podizvodjaci for insert to authenticated with check (je_direktor());
create policy p_upd on podizvodjaci for update to authenticated using (je_direktor()) with check (je_direktor());
create policy p_del on podizvodjaci for delete to authenticated using (je_direktor());

create policy p_sel on podizvodjac_gradiliste for select to authenticated using (ima_profil());
create policy p_ins on podizvodjac_gradiliste for insert to authenticated with check (je_direktor());
create policy p_upd on podizvodjac_gradiliste for update to authenticated using (je_direktor()) with check (je_direktor());
create policy p_del on podizvodjac_gradiliste for delete to authenticated using (je_direktor());

-- helperi: anon ne treba ni da ih zove
revoke execute on function ima_profil(), je_direktor(), moj_zaposleni(), moje_gradiliste(text),
                           moj_klijent(text), moj_podizvodjac(text) from public, anon;
grant  execute on function ima_profil(), je_direktor(), moj_zaposleni(), moje_gradiliste(text),
                           moj_klijent(text), moj_podizvodjac(text) to authenticated;

-- ---------- 5) povezi_profil — samo iz SQL editora (postgres), ne iz app-a ----------
-- Upotreba: 1) Authentication -> Users -> Add user (email + lozinka, "auto confirm")
--           2) select povezi_profil('ime@firma.rs', 'rukovodilac', 'z1');
--              select povezi_profil('direktor@firma.rs', 'direktor');
create or replace function povezi_profil(p_email text, p_uloga text, p_zaposleni_id text default null)
returns uuid language plpgsql security definer set search_path = public, auth as $$
declare uid uuid;
begin
  select id into uid from auth.users where lower(email) = lower(p_email);
  if uid is null then
    raise exception 'Nema korisnika sa emailom %. Prvo ga dodaj u Authentication -> Users.', p_email;
  end if;
  if p_uloga = 'rukovodilac' and (p_zaposleni_id is null or not exists (select 1 from zaposleni where id = p_zaposleni_id)) then
    raise exception 'Rukovodilac mora biti vezan za postojeceg zaposlenog (zaposleni.id), dobio sam: %', p_zaposleni_id;
  end if;
  insert into profili (user_id, zaposleni_id, uloga, ime)
    values (uid, p_zaposleni_id, p_uloga, coalesce((select ime from zaposleni where id = p_zaposleni_id), p_email))
    on conflict (user_id) do update
      set zaposleni_id = excluded.zaposleni_id, uloga = excluded.uloga, ime = excluded.ime;
  return uid;
end $$;
revoke execute on function povezi_profil(text, text, text) from public, anon, authenticated;
