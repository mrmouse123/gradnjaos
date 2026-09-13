'use strict';
/* Mock Supabase klijenta — dovoljan za sloj čuvanja u index.html.
   Podržava: from(t).select('*').order(c), .upsert(rows), .delete().neq(...), .delete().not(...)
   Sve je thenable, pa `await` radi kao sa pravim klijentom.

   Ubacivanje kvarova (faults) služi da se testiraju putanje greške:
     faults.upsertFail = {tabela: 'poruka'}   -> upsert na toj tabeli vraća {error}
     faults.selectFail = {tabela: 'poruka'}
     faults.maxRows    = broj                 -> select vraća samo prvih N (Supabase db-max-rows)
*/

function clone(x){ return JSON.parse(JSON.stringify(x)); }

class Query {
  constructor(db, table, op, faults, log){
    this.db = db; this.table = table; this.op = op;
    this.faults = faults; this.log = log;
    this._filters = [];
    this._order = null;
    this._rows = null;
  }
  select(){ this.op = 'select'; return this; }
  order(col){ this._order = col; return this; }
  range(from, to){ this._range = [from, to]; return this; }
  upsert(rows){ this.op = 'upsert'; this._rows = clone(rows); return this; }
  insert(rows){ this.op = 'insert'; this._rows = clone(rows); return this; }
  delete(){ this.op = 'delete'; return this; }
  eq(c, v){ this._filters.push(['eq', c, v]); return this; }
  neq(c, v){ this._filters.push(['neq', c, v]); return this; }
  not(c, oper, v){ this._filters.push(['not', c, oper, v]); return this; }
  in(c, v){ this._filters.push(['in', c, v]); return this; }

  _match(row){
    return this._filters.every(f => {
      const [kind, col] = f;
      if (kind === 'eq')  return row[col] === f[2];
      if (kind === 'neq') return row[col] !== f[2];
      if (kind === 'in')  return f[2].includes(row[col]);
      if (kind === 'not') {
        const [, , oper, val] = f;
        if (oper === 'in') {
          // PostgREST sintaksa: '("a","b")'
          const list = String(val).replace(/^\(|\)$/g, '').split(',')
            .map(s => s.trim().replace(/^"|"$/g, '')).filter(Boolean);
          return !list.includes(row[col]);
        }
        return true;
      }
      return true;
    });
  }

  async _run(){
    const t = this.table;
    this.db[t] ||= [];
    if (this.op === 'select') {
      if (this.faults.selectFail && this.faults.selectFail[t])
        return { data: null, error: { message: this.faults.selectFail[t] } };
      let rows = clone(this.db[t]);
      if (this._order) rows.sort((a, b) => String(a[this._order]).localeCompare(String(b[this._order])));
      if (this._range) rows = rows.slice(this._range[0], this._range[1] + 1);
      else if (this.faults.maxRows) rows = rows.slice(0, this.faults.maxRows);
      this.log.push({ op: 'select', table: t, n: rows.length });
      return { data: rows, error: null };
    }
    if (this.op === 'upsert' || this.op === 'insert') {
      if (this.faults.upsertFail && this.faults.upsertFail[t])
        return { data: null, error: { message: this.faults.upsertFail[t] } };
      // simuliraj Postgres: prazan string u date koloni je greška
      for (const r of this._rows) {
        for (const [k, v] of Object.entries(r)) {
          if (DATE_COLS.has(k) && v === '')
            return { data: null, error: { message: `invalid input syntax for type date: "" (${t}.${k})` } };
        }
      }
      for (const r of this._rows) {
        const i = this.db[t].findIndex(x => x.id === r.id);
        if (i >= 0) this.db[t][i] = clone(r); else this.db[t].push(clone(r));
      }
      this.log.push({ op: 'upsert', table: t, n: this._rows.length });
      return { data: this._rows, error: null };
    }
    if (this.op === 'delete') {
      const before = this.db[t].length;
      this.db[t] = this.db[t].filter(r => !this._match(r));
      this.log.push({ op: 'delete', table: t, n: before - this.db[t].length });
      return { data: null, error: null };
    }
    return { data: null, error: null };
  }
  then(res, rej){ return this._run().then(res, rej); }
}

/* kolone tipa date u schema.sql */
const DATE_COLS = new Set(['pocetak', 'rok', 'datum', 'izdato', 'valuta', 'istice']);

function makeSupabaseMock(seed = {}, faults = {}){
  const db = clone(seed);
  const log = [];
  const client = {
    from(table){ return new Query(db, table, null, faults, log); },
  };
  return {
    createClient: () => client,
    _db: db,
    _log: log,
    _faults: faults,
    _count(t){ return (db[t] || []).length; },
  };
}

module.exports = { makeSupabaseMock, DATE_COLS };
