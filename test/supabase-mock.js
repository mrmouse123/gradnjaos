'use strict';
/* Mock Supabase klijenta — dovoljan za sloj čuvanja + auth + RPC u index.html.
   Podržava: from(t).select('*').order(c).eq(..).maybeSingle(), .upsert(rows),
   .delete().eq/neq/not(...), functions.invoke(), rpc(), auth.*.
   Sve je thenable, pa `await` radi kao sa pravim klijentom.

   View-ovi (migracija 11): gradilista_v / predmer_v / podizvodjaci_v čitaju iz
   osnovne tabele; finansijske kolone su NULL ako prijavljeni nije direktor
   (po seed.profili + auth sesiji) — isto što radi pravi view.

   Ubacivanje kvarova (faults):
     faults.upsertFail = {tabela: 'poruka'}   -> upsert/insert/update na toj tabeli vraća {error}
     faults.updateFail = {tabela: 'poruka'}   -> samo update na toj tabeli vraća {error}
     (ugrađeno, bez faults): upsert na gradilista/predmer/podizvodjaci sa finansijskom
     kolonom u payload-u → "permission denied" (42501), kao prava baza posle migracije 11
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
const VIEWS = { gradilista_v: 'gradilista', predmer_v: 'predmer', podizvodjaci_v: 'podizvodjaci', dokumenti_v: 'dokumenti' };
const FIN_COLS = { gradilista: ['budzet', 'troskovi', 'potroseno', 'naplaceno'], predmer: ['cena'], podizvodjaci: ['cena'] };
const SKRIVENE_KOLONE = { dokumenti: ['data'] };   // migracija 14: dokumenti.data nema SELECT grant — view ga nema ni za koga

/* Primarni ključ po tabeli — join tabele i profili nemaju `id`. */
/* Migracija 13: trigger na predmer osvezava gradilista.napredak (ugovoreno × izvedeno) — ista formula kao napredak_iz_predmera. */
function osveziNapredakMock(db, gr){
  if (!gr || !db.gradilista) return;
  const l = (db.predmer || []).filter(x => x.gr === gr); if (!l.length) return;
  const kol = r => +r.kol || 0, izv = r => Math.min(Math.max(0, +r.izv || 0), kol(r)), cena = r => +r.cena || 0;
  const ugV = l.reduce((s, r) => s + kol(r) * cena(r), 0), ugK = l.reduce((s, r) => s + kol(r), 0);
  const n = ugV > 0 ? Math.floor(100 * l.reduce((s, r) => s + izv(r) * cena(r), 0) / ugV + 0.5) : ugK > 0 ? Math.floor(100 * l.reduce((s, r) => s + izv(r), 0) / ugK + 0.5) : 0;
  const g = db.gradilista.find(x => x.id === gr); if (g) g.napredak = Math.max(0, Math.min(100, n));
}
/* Migracija 15: trigger rad_minuta — minuta se racuna na serveru iz start/kraj (klijentov broj se ignorise). */
function radMinutaMock(r){
  if (!r) return;
  if (r.kraj) { const s = new Date(r.start).getTime(), k = Math.max(new Date(r.kraj).getTime(), s); r.minuta = Math.max(0, Math.floor((k - s) / 60000)); }
  else r.minuta = null;
}
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
  limit(n){ this._limit = n; return this; }
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
      if (this.view && !this.ctx.vidiFin()) {   // finansijske kolone NULL bez vidi_finansije (migracija 14)
        const cols = FIN_COLS[t] || [];
        rows = rows.map(r => { const o = { ...r }; cols.forEach(c => { if (c in o) o[c] = null; }); return o; });
      }
      if (this.view && SKRIVENE_KOLONE[t]) rows = rows.map(r => { const o = { ...r }; SKRIVENE_KOLONE[t].forEach(c => { delete o[c]; }); return o; });
      if (this._order) rows.sort((a, b) => String(a[this._order]).localeCompare(String(b[this._order])));
      if (this._range) rows = rows.slice(this._range[0], this._range[1] + 1);
      else if (this.faults.maxRows) rows = rows.slice(0, this.faults.maxRows);
      if (this._limit) rows = rows.slice(0, this._limit);
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
      /* Kao prava baza (migracija 11, provereno 2026-10-03 set local role): UPSERT =
         INSERT ... ON CONFLICT DO UPDATE SET col=excluded.col, a citanje excluded.<fin>
         trazi SELECT na toj koloni, koji je ukinut za authenticated → 42501 za SVE uloge.
         Plain INSERT i UPDATE prolaze. */
      if (this.op === 'upsert' && FIN_COLS[t]) {
        const fin = FIN_COLS[t].find(c => this._rows.some(r => c in r));
        if (fin) return { data: null, error: { message: `permission denied for table ${t} (upsert cita excluded.${fin}; 42501)` } };
      }
      for (const r of this._rows) {
        for (const [k, v] of Object.entries(r)) {
          if (DATE_COLS.has(k) && v === '')
            return { data: null, error: { message: `invalid input syntax for type date: "" (${t}.${k})` } };
        }
      }
      for (const r of this._rows) {
        const k = kljuc(t, r);
        if (!this.db[t]) this.db[t] = [];          // npr. log_koriscenja — nije u seed-u
        if (t === 'log_koriscenja' && r.id == null) { r.id = (this.db[t].length + 1); r.ts = r.ts || new Date().toISOString(); }
        const i = this.db[t].findIndex(x => kljuc(t, x) === k);
        /* kao PostgREST: kolone koje payload ne nosi ostaju netaknute pri update-u */
        if (i >= 0) this.db[t][i] = Object.assign({}, this.db[t][i], clone(r)); else this.db[t].push(clone(r));
        if (t === 'predmer') osveziNapredakMock(this.db, r.gr);
        if (t === 'rad_na_zadatku') radMinutaMock(this.db[t].find(x => x.id === r.id));
      }
      /* log_koriscenja je append-only i van PUSH_TABLES — loguje se kao op:'log' da testovi koji broje upserte ostanu tacni */
      this.log.push({ op: t === 'log_koriscenja' ? 'log' : 'upsert', table: t, n: this._rows.length, keys: this._rows.map(r => kljuc(t, r)), cols: Object.keys(this._rows[0] || {}) });
      return { data: this._rows, error: null };
    }
    if (this.op === 'update') {
      if (this.view) return { data: null, error: { message: `cannot update view "${this.requested}"` } };
      if (this.faults.upsertFail && this.faults.upsertFail[t])
        return { data: null, error: { message: this.faults.upsertFail[t] } };
      if (this.faults.updateFail && this.faults.updateFail[t])
        return { data: null, error: { message: this.faults.updateFail[t] } };
      for (const [k, v] of Object.entries(this._patch)) {
        if (DATE_COLS.has(k) && v === '')
          return { data: null, error: { message: `invalid input syntax for type date: "" (${t}.${k})` } };
      }
      let n = 0;
      this.db[t] = this.db[t].map(r => { if (this._match(r)) { n++; return Object.assign({}, r, clone(this._patch)); } return r; });
      if (t === 'predmer') { const grs = new Set(this.db[t].filter(r => this._match(r)).map(r => r.gr)); grs.forEach(gr => osveziNapredakMock(this.db, gr)); }
      if (t === 'rad_na_zadatku') this.db[t].filter(r => this._match(r)).forEach(radMinutaMock);
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
    isDir: () => { const p = profil(); return !!p && (p.uloga === 'direktor' || p.uloga === 'admin'); },   // uprava (migracija 14)
    isSuper: () => { const p = profil(); return !!p && p.uloga === 'direktor'; },
    vidiFin: () => { const p = profil(); return !!p && (p.uloga === 'direktor' || p.uloga === 'admin' || !!p.vidi_finansije); },
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
      /* Migracija 12: nalozi i log — isti guardovi kao na serveru (direktor; ne sebi; ne poslednjem direktoru). */
      const emailOd = id => Object.keys(authOpts.users || {}).find(e => (authOpts.users[e] || {}).id === id) || null;
      const idOd = email => ((authOpts.users || {})[String(email || '').toLowerCase()] || {}).id || null;
      const ja = auth._session() && auth._session().user;
      const upisiLog = (dogadjaj, detalj) => { db.log_koriscenja = db.log_koriscenja || []; db.log_koriscenja.push({ id: db.log_koriscenja.length + 1, ts: new Date().toISOString(), user_id: ja && ja.id, email: ja && ja.email, uloga: 'direktor', dogadjaj, detalj }); };
      if (name === 'angazovanost') {   // migracija 15: uprava — sati po osobi i gradilistu u periodu (otvorena sesija se racuna do sada)
        if (!ctx.isDir()) return { data: null, error: { message: 'Samo uprava vidi angažovanost.' } };
        const od = args && args.p_od ? new Date(args.p_od) : new Date(Date.now() - 30 * 86400000), dod = args && args.p_do ? new Date(args.p_do) : new Date();
        const agg = {};
        (db.rad_na_zadatku || []).forEach(r => { const s = new Date(r.start); if (s < od || s > new Date(dod.getTime() + 86400000)) return;
          const k = r.osoba + '|' + r.gr; const a = agg[k] = agg[k] || { osoba: r.osoba, gr: r.gr, sesija: 0, minuta: 0, poslednji: null };
          a.sesija++; a.minuta += r.minuta != null ? r.minuta : Math.max(0, Math.floor((Date.now() - s.getTime()) / 60000)); const p = r.kraj || r.start; if (!a.poslednji || p > a.poslednji) a.poslednji = p; });
        return { data: Object.values(agg).sort((x, y) => (x.osoba + x.gr).localeCompare(y.osoba + y.gr)), error: null };
      }
      if (name === 'obrisi_gradiliste') {   // migracija 14: super brise gradiliste i sve zavisne redove, upisuje log
        if (!ctx.isSuper()) return { data: null, error: { message: 'Samo direktor briše gradilišta.' } };
        const g = (db.gradilista || []).find(x => x.id === args.p_gid); if (!g) return { data: null, error: null };
        ['zadaci', 'dnevnik', 'narudzbe', 'predmer', 'troskovi_st', 'situacije', 'mag_promene', 'dokumenti'].forEach(t => { if (db[t]) db[t] = db[t].filter(r => r.gr !== args.p_gid); });
        (db.resursi || []).forEach(r => { if (r.gr === args.p_gid) r.gr = null; });
        ['zaposleni_gradiliste', 'podizvodjac_gradiliste'].forEach(t => { if (db[t]) db[t] = db[t].filter(r => r.gradiliste_id !== args.p_gid); });
        db.gradilista = db.gradilista.filter(x => x.id !== args.p_gid);
        upisiLog('brisanje', { tabela: 'gradilista', id: args.p_gid, naziv: g.naziv });
        return { data: null, error: null };
      }
      if (name === 'dokument_podaci') {   // data-URL dokumenta po id-u (RLS: moje_gradiliste) — mock ne filtrira redove, samo vraca data
        const d = (db.dokumenti || []).find(x => x.id === args.p_id);
        return { data: d ? (d.data || null) : null, error: null };
      }
      if (name === 'nalozi_pregled') {
        if (!ctx.isDir()) return { data: null, error: { message: 'Samo direktor vidi naloge.' } };
        const rows = Object.entries(authOpts.users || {}).map(([email, u]) => { const p = (db.profili || []).find(x => x.user_id === u.id); return { user_id: u.id, email, uloga: p ? p.uloga : null, zaposleni_id: p ? p.zaposleni_id : null, saradnik_id: p ? (p.saradnik_id || null) : null, vidi_finansije: !!(p && (p.vidi_finansije || p.uloga === 'direktor' || p.uloga === 'admin')), ime: p ? p.ime : null, kreiran: null, poslednja_prijava: null, bez_profila: !p }; });
        return { data: rows, error: null };
      }
      if (name === 'dodeli_ulogu') {   // migracija 14: 5 uloga, vidi_finansije, saradnik; admin ne dira direktore
        if (!ctx.isDir()) return { data: null, error: { message: 'Samo uprava dodeljuje uloge.' } };
        const uid = idOd(args.p_email); if (!uid) return { data: null, error: { message: `Nema naloga ${args.p_email}.` } };
        if (ja && uid === ja.id) return { data: null, error: { message: 'Sopstvenu ulogu ne možeš da menjaš — zamoli drugog direktora.' } };
        if (!['direktor', 'admin', 'rukovodilac', 'radnik', 'spoljni'].includes(args.p_uloga)) return { data: null, error: { message: 'Nepoznata uloga: ' + args.p_uloga } };
        db.profili = db.profili || []; const p = db.profili.find(x => x.user_id === uid); const stara = p ? p.uloga : null;
        if (!ctx.isSuper() && (args.p_uloga === 'direktor' || stara === 'direktor')) return { data: null, error: { message: 'Samo direktor može da dodeli ili promeni ulogu direktora.' } };
        let zid = args.p_zaposleni_id || null, sid = args.p_saradnik_id || null, fin = !!args.p_vidi_finansije;
        if (['rukovodilac', 'radnik'].includes(args.p_uloga) && !(db.zaposleni || []).some(z => z.id === zid)) return { data: null, error: { message: (args.p_uloga === 'rukovodilac' ? 'Rukovodilac' : 'Radnik') + ' mora biti vezan za postojećeg zaposlenog.' } };
        if (args.p_uloga === 'spoljni' && !(db.podizvodjaci || []).some(x => x.id === sid)) return { data: null, error: { message: 'Spoljni saradnik mora biti vezan za postojećeg podizvođača/saradnika.' } };
        if (['direktor', 'admin'].includes(args.p_uloga)) { zid = null; sid = null; fin = true; }
        if (args.p_uloga !== 'spoljni') sid = null; if (args.p_uloga === 'spoljni') zid = null; if (['radnik', 'spoljni'].includes(args.p_uloga)) fin = false;
        if (stara === 'direktor' && args.p_uloga !== 'direktor' && db.profili.filter(x => x.uloga === 'direktor').length <= 1) return { data: null, error: { message: 'Ovo je poslednji direktor — prvo dodeli ulogu direktora nekom drugom.' } };
        const z = (db.zaposleni || []).find(x => x.id === zid), s = (db.podizvodjaci || []).find(x => x.id === sid); const ime = z ? z.ime : s ? s.naziv : args.p_email;
        if (p) { p.uloga = args.p_uloga; p.zaposleni_id = zid; p.saradnik_id = sid; p.vidi_finansije = fin; p.ime = ime; } else db.profili.push({ user_id: uid, uloga: args.p_uloga, zaposleni_id: zid, saradnik_id: sid, vidi_finansije: fin, ime });
        upisiLog('uloga_promena', { email: args.p_email, stara, nova: args.p_uloga, zaposleni_id: zid, saradnik_id: sid, vidi_finansije: fin });
        return { data: stara ? 'izmenjeno' : 'dodeljeno', error: null };
      }
      if (name === 'ukloni_pristup') {
        if (!ctx.isDir()) return { data: null, error: { message: 'Samo direktor uklanja pristup.' } };
        const uid = idOd(args.p_email); if (!uid) return { data: null, error: { message: `Nema naloga ${args.p_email}.` } };
        if (ja && uid === ja.id) return { data: null, error: { message: 'Sopstveni pristup ne možeš da ukloniš.' } };
        const p = (db.profili || []).find(x => x.user_id === uid); if (!p) return { data: null, error: null };
        if (p.uloga === 'direktor' && db.profili.filter(x => x.uloga === 'direktor').length <= 1) return { data: null, error: { message: 'Ovo je poslednji direktor.' } };
        db.profili = db.profili.filter(x => x.user_id !== uid); upisiLog('pristup_uklonjen', { email: args.p_email, stara: p.uloga });
        return { data: null, error: null };
      }
      if (name === 'zdravlja_mojih') {
        if (!profil()) return { data: [], error: null };
        const dir = ctx.isDir(), z = ctx.mojZ();
        const ids = (db.gradilista || []).filter(g => dir || g.rukovodilac === z).map(g => g.id).sort();
        const sk = faults.zdravlja || {};
        /* migracija 13: + napredak (server ga racuna trigerom na predmer, v. osveziNapredakMock) */
        return { data: ids.map(id => ({ id, zdravlje: sk[id] !== undefined ? sk[id] : 77, napredak: ((db.gradilista || []).find(g => g.id === id) || {}).napredak })), error: null };
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
