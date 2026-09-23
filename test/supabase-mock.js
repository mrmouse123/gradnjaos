'use strict';
/* Mock Supabase klijenta — dovoljan za sloj čuvanja + auth + RPC u index.html.
   Podržava: from(t).select('*').order(c).eq(..).maybeSingle(), .upsert(rows),
   .delete().eq/neq/not(...), functions.invoke(), rpc(), auth.*.
   Sve je thenable, pa `await` radi kao sa pravim klijentom.

   View-ovi (migracija 11): gradilista_v / predmer_v / podizvodjaci_v čitaju iz
   osnovne tabele; finansijske kolone su NULL ako prijavljeni nije direktor
   (po seed.profili + auth sesiji) — isto što radi pravi view.

   Ubacivanje kvarova (faults):
     faults.upsertFail = {tabela: 'poruka'}   -> upsert na toj tabeli vraća {error}
     faults.selectFail = {tabela: 'poruka'}
     faults.maxRows    = broj
     faults.functionsDeployed / functionsFail -> edge function
     faults.rpcFail    = 'poruka'             -> svaki rpc() vraća {error}
     faults.zdravlja   = {gid: skor}          -> šta zdravlja_mojih vraća (default 77)
   Auth (treći argument): { session, users: { email: {id, password} } }
*/

function clone(x){ return JSON.parse(JSON.stringify(x)); }

/* kolone tipa date u schema.sql */
const DATE_COLS = new Set(['pocetak', 'rok', 'datum', 'izdato', 'valuta', 'istice']);

/* view -> osnovna tabela; kolone koje view NULL-uje ne-direktoru */
const VIEWS = { gradilista_v: 'gradilista', predmer_v: 'predmer', podizvodjaci_v: 'podizvodjaci' };
const FIN_COLS = { gradilista: ['budzet', 'troskovi', 'potroseno', 'naplaceno'], predmer: ['cena'], podizvodjaci: ['cena'] };

/* Primarni ključ po tabeli — join tabele i profili nemaju `id`. */
function kljuc(t, r){
  if (t === 'zaposleni_gradiliste')  return r.zaposleni_id + '|' + r.gradiliste_id;
  if (t === 'podizvodjac_gradiliste') return r.podizvodjac_id + '|' + r.gradiliste_id;
  if (t === 'profili') return r.user_id;
  return r.id;
}

class Query {
  constructor(db, table, op, faults, log, ctx){
    this.db = db; this.op = op;
    this.view = !!VIEWS[table];
    this.table = VIEWS[table] || table;
    this.requested = table;
    this.faults = faults; this.log = log; this.ctx = ctx;
    this._filters = [];
    this._order = null;
    this._rows = null;
    this._single = null;
  }
  select(){ this.op = 'select'; return this; }
  order(col){ this._order = col; return this; }
  range(from, to){ this._range = [from, to]; return this; }
  maybeSingle(){ this._single = 'maybe'; return this; }
  single(){ this._single = 'one'; return this; }
  upsert(rows){ this.op = 'upsert'; this._rows = clone(Array.isArray(rows) ? rows : [rows]); return this; }
  insert(rows){ this.op = 'insert'; this._rows = clone(Array.isArray(rows) ? rows : [rows]); return this; }
  update(obj){ this.op = 'update'; this._patch = clone(obj); return this; }
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
      if (this.faults.selectFail && this.faults.selectFail[this.requested])
        return { data: null, error: { message: this.faults.selectFail[this.requested] } };
      if (this.view && this.ctx.pisanjeUView) { /* no-op: view je samo za citanje */ }
      let rows = clone(this.db[t]).filter(r => this._match(r));
      if (this.view && !this.ctx.isDir()) {
        const cols = FIN_COLS[t] || [];
        rows = rows.map(r => { const o = { ...r }; cols.forEach(c => { if (c in o) o[c] = null; }); return o; });
      }
      if (this._order) rows.sort((a, b) => String(a[this._order]).localeCompare(String(b[this._order])));
      if (this._range) rows = rows.slice(this._range[0], this._range[1] + 1);
      else if (this.faults.maxRows) rows = rows.slice(0, this.faults.maxRows);
      this.log.push({ op: 'select', table: this.requested, n: rows.length });
      if (this._single) {
        if (this._single === 'one' && rows.length !== 1) return { data: null, error: { message: 'JSON object requested, multiple (or no) rows returned' } };
        return { data: rows[0] || null, error: null };
      }
      return { data: rows, error: null };
    }
    if (this.op === 'upsert' || this.op === 'insert') {
      if (this.view) return { data: null, error: { message: `cannot insert into view "${this.requested}"` } };
      if (this.faults.upsertFail && this.faults.upsertFail[t])
        return { data: null, error: { message: this.faults.upsertFail[t] } };
      for (const r of this._rows) {
        for (const [k, v] of Object.entries(r)) {
          if (DATE_COLS.has(k) && v === '')
            return { data: null, error: { message: `invalid input syntax for type date: "" (${t}.${k})` } };
        }
      }
      for (const r of this._rows) {
        const k = kljuc(t, r);
        const i = this.db[t].findIndex(x => kljuc(t, x) === k);
        /* kao PostgREST: kolone koje payload ne nosi ostaju netaknute pri update-u */
        if (i >= 0) this.db[t][i] = Object.assign({}, this.db[t][i], clone(r)); else this.db[t].push(clone(r));
      }
      this.log.push({ op: 'upsert', table: t, n: this._rows.length, keys: this._rows.map(r => kljuc(t, r)), cols: Object.keys(this._rows[0] || {}) });
      return { data: this._rows, error: null };
    }
    if (this.op === 'update') {
      if (this.view) return { data: null, error: { message: `cannot update view "${this.requested}"` } };
      if (this.faults.upsertFail && this.faults.upsertFail[t])
        return { data: null, error: { message: this.faults.upsertFail[t] } };
      for (const [k, v] of Object.entries(this._patch)) {
        if (DATE_COLS.has(k) && v === '')
          return { data: null, error: { message: `invalid input syntax for type date: "" (${t}.${k})` } };
      }
      let n = 0;
      this.db[t] = this.db[t].map(r => { if (this._match(r)) { n++; return Object.assign({}, r, clone(this._patch)); } return r; });
      /* log kao 'upsert' da stariji testovi (koji broje upserte po tabeli) ostanu validni */
      this.log.push({ op: 'upsert', via: 'update', table: t, n, keys: n ? [kljuc(t, this._patch)] : [], cols: Object.keys(this._patch) });
      return { data: null, error: null };
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

function makeAuth(authOpts, log){
  const users = authOpts.users || {};           // email -> {id, password}
  let session = authOpts.session === undefined ? null : authOpts.session;
  const listeners = [];
  const fire = (ev, s) => listeners.forEach(f => { try { f(ev, s); } catch (e) {} });
  return {
    async getSession(){ return { data: { session }, error: null }; },
    async signInWithPassword({ email, password }){
      log.push({ op: 'auth.signInWithPassword', email });
      const u = users[email];
      if (!u || u.password !== password)
        return { data: { session: null, user: null }, error: { message: 'Invalid login credentials' } };
      session = { user: { id: u.id, email }, access_token: 'mock-token' };
      fire('SIGNED_IN', session);
      return { data: { session, user: session.user }, error: null };
    },
    async signInWithOtp({ email, options }){
      log.push({ op: 'auth.signInWithOtp', email, options });
      if (!users[email] && options && options.shouldCreateUser === false)
        return { data: {}, error: { message: 'Signups not allowed for otp' } };
      return { data: {}, error: null };
    },
    async signOut(){ log.push({ op: 'auth.signOut' }); session = null; fire('SIGNED_OUT', null); return { error: null }; },
    onAuthStateChange(f){ listeners.push(f); return { data: { subscription: { unsubscribe(){} } } }; },
    async updateUser(attrs){
      log.push({ op: 'auth.updateUser', attrs });
      if (!session) return { data: { user: null }, error: { message: 'Auth session missing!' } };
      return { data: { user: session.user }, error: null };
    },
    _setSession(s){ session = s; },
    _session(){ return session; },
  };
}

function makeSupabaseMock(seed = {}, faults = {}, authOpts = {}){
  const db = clone(seed);
  const log = [];
  const auth = makeAuth(authOpts, log);
  const profil = () => { const s = auth._session(); if (!s) return null; return (db.profili || []).find(p => p.user_id === s.user.id) || null; };
  const ctx = {
    isDir: () => { const p = profil(); return !!p && p.uloga === 'direktor'; },
    mojZ: () => { const p = profil(); return p ? p.zaposleni_id : null; },
  };
  const client = {
    from(table){ return new Query(db, table, null, faults, log, ctx); },
    functions: {
      async invoke(name, opts){
        log.push({ op: 'functions.invoke', name, body: opts && opts.body });
        if (faults.functionsFail) return { data: null, error: { message: faults.functionsFail } };
        if (!faults.functionsDeployed) return { data: null, error: { message: `Function not found: ${name}` } };
        return { data: { ok: true, id: 'mock-' + Date.now() }, error: null };
      },
    },
    /* RPC: zdravlja_mojih vraća skor za gradilišta koja pozivalac sme da vidi. */
    async rpc(name, args){
      log.push({ op: 'rpc', name, args });
      if (faults.rpcFail) return { data: null, error: { message: faults.rpcFail } };
      if (name === 'zdravlja_mojih') {
        if (!profil()) return { data: [], error: null };
        const dir = ctx.isDir(), z = ctx.mojZ();
        const ids = (db.gradilista || []).filter(g => dir || g.rukovodilac === z).map(g => g.id).sort();
        const sk = faults.zdravlja || {};
        return { data: ids.map(id => ({ id, zdravlje: sk[id] !== undefined ? sk[id] : 77 })), error: null };
      }
      return { data: null, error: { message: 'Could not find the function public.' + name } };
    },
    auth,
  };
  return {
    createClient: () => client,
    _db: db,
    _log: log,
    _faults: faults,
    _auth: auth,
    _count(t){ return (db[t] || []).length; },
  };
}

module.exports = { makeSupabaseMock, DATE_COLS, kljuc, VIEWS, FIN_COLS };
