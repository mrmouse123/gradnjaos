'use strict';
/* Migracije vs schema.sql: dve baze — (A) sveza iz supabase/schema.sql, (B) pocetna sema (test/fixtures/schema-v04.sql, vec ima
   migracije 01-08) + supabase/migracija-09..NN redom — pa se uporedi struktura (test/rls/fingerprint.sql). Pada ako se migracija
   ne izvrsi, ili ako schema.sql i lanac migracija daju razlicite kolone/polise/trigere/funkcije/view-ove/grantove.
   Treba Postgres sa kojim psql moze da se poveze (PGHOST/PGUSER/PGPASSWORD). Lokalno kroz Docker:
     PSQL="docker exec -i gos-pg psql -U postgres" node test/rls/replay.js
   Nova migracija: samo dodati fajl supabase/migracija-NN-*.sql i uskladiti schema.sql. */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const rd = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8').replace(/\r/g, '');
const [bin, ...pre] = (process.env.PSQL || 'psql').split(' ');
const stripCron = sql => sql.replace(/^create extension if not exists pg_cron with schema pg_catalog;/m, '-- pg_cron: stub u bootstrap.sql');

function psql(db, sql, extra = []) {
  const r = spawnSync(bin, [...pre, '-q', '-v', 'ON_ERROR_STOP=1', '-d', db, ...extra], { input: sql, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.error) throw r.error;
  return r;
}
function must(db, what, sql) {
  const r = psql(db, sql);
  if (r.status !== 0) { console.error(`NEUSPEH: ${what}\n` + r.stderr.split('\n').filter(l => !/^NOTICE/.test(l)).slice(0, 8).join('\n')); process.exit(1); }
}

const A = 'gos_schema', B = 'gos_replay';
for (const db of [A, B]) must('postgres', 'priprema baze ' + db, `drop database if exists ${db}; create database ${db};`);
const bootstrap = rd('test', 'rls', 'bootstrap.sql');

must(A, 'bootstrap + schema.sql', bootstrap + '\n' + stripCron(rd('supabase', 'schema.sql')));
must(B, 'bootstrap + pocetna sema', bootstrap + '\n' + stripCron(rd('test', 'fixtures', 'schema-v04.sql')));
const migracije = fs.readdirSync(path.join(ROOT, 'supabase')).filter(f => /^migracija-\d+-.*\.sql$/.test(f)).sort()
  .filter(f => parseInt(f.match(/^migracija-(\d+)/)[1], 10) >= 9);            // 01-08 su vec u pocetnoj semi
for (const f of migracije) must(B, 'migracija ' + f, stripCron(rd('supabase', f)));

const fp = db => { const r = psql(db, rd('test', 'rls', 'fingerprint.sql'), ['-At']); if (r.status !== 0) { console.error(r.stderr); process.exit(1); } return r.stdout.split('\n').filter(Boolean); };
const a = fp(A), b = fp(B), sa = new Set(a), sb = new Set(b);
const samoA = a.filter(x => !sb.has(x)), samoB = b.filter(x => !sa.has(x));
if (samoA.length || samoB.length) {
  console.error(`RAZLIKA: schema.sql i lanac migracija daju razlicitu strukturu (${samoA.length} samo u schema.sql, ${samoB.length} samo posle migracija)`);
  samoA.slice(0, 25).forEach(x => console.error('  schema.sql : ' + x.slice(0, 220)));
  samoB.slice(0, 25).forEach(x => console.error('  migracije  : ' + x.slice(0, 220)));
  process.exit(1);
}
console.log(`OK: ${migracije.length} migracija (${migracije[0].slice(10, 12)}-${migracije[migracije.length - 1].slice(10, 12)}) nad pocetnom semom daje istu strukturu kao schema.sql (${a.length} stavki)`);
