'use strict';
/* RLS testovi nad pravim Postgresom: bootstrap (stub Supabase okruzenja) + supabase/schema.sql + seed + provere po ulogama.
   Pise SQL na stdout; goli Postgres 14+ je dovoljan:
     node test/rls/run.js | psql -v ON_ERROR_STOP=1 -h localhost -U postgres
   Izlaz psql-a: 0 = sve provere prosle, 3 = bar jedna nije (spisak u poruci). */
const fs = require('fs');
const path = require('path');
const rd = (...p) => fs.readFileSync(path.join(__dirname, ...p), 'utf8').replace(/\r/g, '');

const schema = rd('..', '..', 'supabase', 'schema.sql');
if (!/create extension if not exists pg_cron with schema pg_catalog;/.test(schema)) { console.error('schema.sql: nema pg_cron linije koju stub preskace — azurirati run.js'); process.exit(2); }
process.stdout.write([
  rd('bootstrap.sql'),
  schema.replace('create extension if not exists pg_cron with schema pg_catalog;', '-- pg_cron: stub u bootstrap.sql'),
  rd('seed.sql'),
  rd('tests.sql'),
].join('\n') + '\n');
