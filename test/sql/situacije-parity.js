'use strict';
/* Formula situacija na SQL strani: izdvoji preracunaj_situacije iz supabase/schema.sql, napuni minimalne tabele
   scenarijima iz test/fixtures/situacije-parity.json (isti kao T67 u e2e.js za klijenta i mock) i proveri brojeve.
   Pise SQL na stdout; pokretanje (Postgres 14+ bez Supabase-a, dovoljan je goli server):
     node test/sql/situacije-parity.js | psql -v ON_ERROR_STOP=1 -h localhost -U postgres
   Izlaz psql-a: 0 = svi scenariji prosli, 3 = bar jedna razlika (spisak u poruci). */
const fs = require('fs');
const path = require('path');

const schema = fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', 'schema.sql'), 'utf8');
const m = schema.match(/create or replace function preracunaj_situacije[\s\S]*?\nend \$\$;/);
if (!m) { console.error('preracunaj_situacije nije nadjena u schema.sql'); process.exit(2); }
const scenariji = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'situacije-parity.json'), 'utf8')).scenariji;

const lit = v => v === null || v === undefined ? 'null' : typeof v === 'number' ? String(v) : "'" + String(v).replace(/'/g, "''") + "'";
const out = [];
out.push(`
drop table if exists situacija_stavke, situacije, predmer, rezultat cascade;
create table predmer (id text primary key, gr text, poz text, kol numeric default 0, cena numeric default 0);
create table situacije (id text primary key, gr text, iznos numeric default 0, izdato date);
create table situacija_stavke (
  id text primary key, sit text not null, gr text not null, predmer_id text, sifra text, poz text not null, kol numeric not null default 0,
  kol_ugovoreno numeric not null default 0, kumulativ numeric not null default 0, razlika numeric not null default 0);
create table rezultat (scenario text, greska text);
`);
out.push(m[0].replace(/\r/g, ''));

for (const sc of scenariji) {
  out.push(`\ntruncate predmer, situacije, situacija_stavke;`);
  for (const p of sc.predmer) out.push(`insert into predmer (id, gr, poz, kol, cena) values (${lit(p.id)}, ${lit(p.gr)}, ${lit(p.poz)}, ${lit(p.kol)}, ${lit(p.cena)});`);
  for (const s of sc.situacije) out.push(`insert into situacije (id, gr, iznos, izdato) values (${lit(s.id)}, ${lit(s.gr)}, ${lit(s.iznos)}, ${lit(s.izdato)});`);
  for (const x of sc.stavke) out.push(`insert into situacija_stavke (id, sit, gr, predmer_id, sifra, poz, kol) values (${lit(x.id)}, ${lit(x.sit)}, ${lit(x.gr)}, ${lit(x.predmer_id)}, ${lit(x.sifra)}, ${lit(x.poz)}, ${lit(x.kol)});`);
  out.push(`select preracunaj_situacije(${lit(sc.gr)});`);
  for (const [id, ex] of Object.entries(sc.ocekivano.stavke))
    for (const [k, v] of Object.entries(ex))
      out.push(`insert into rezultat select ${lit(sc.naziv)}, 'stavka ${id}.${k} = ' || coalesce((select ${k}::text from situacija_stavke where id = ${lit(id)}), 'nema reda') || ', ocekivano ${v}'
        where coalesce((select abs(${k} - ${v}) > 1e-9 from situacija_stavke where id = ${lit(id)}), true);`);
  for (const [id, v] of Object.entries(sc.ocekivano.iznos))
    out.push(`insert into rezultat select ${lit(sc.naziv)}, 'situacija ${id}.iznos = ' || coalesce((select iznos::text from situacije where id = ${lit(id)}), 'nema reda') || ', ocekivano ${v}'
      where coalesce((select abs(iznos - ${v}) > 1e-9 from situacije where id = ${lit(id)}), true);`);
}

out.push(`
do $$ declare n int; r text; begin
  select count(*), string_agg(scenario || ': ' || greska, E'\\n') into n, r from rezultat;
  if n > 0 then raise exception E'SQL se razilazi od fixture-a (% razlika):\\n%', n, r using errcode = 'P0003'; end if;
  raise notice 'SQL formula situacija: % scenarija OK', ${scenariji.length};
end $$;
`);
process.stdout.write(out.join('\n') + '\n');
