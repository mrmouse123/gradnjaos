'use strict';
/* ============================================================
   GradnjaOS — e2e regresija (bez test framework-a, namerno)
   Pokretanje:  node test/e2e.js
   Izlaz: 0 = sve prošlo, 1 = bar jedan pad.

   Pokriva (CLAUDE.md "Testiranje"):
     T1  sintaksa: new Function(script)
     T2  boot: app se podigne bez exceptiona (režim 'memorija')
     T3  pogledi × uloge × moduli — bez exceptiona
     T4  th==td simetrija tabela (lekcija iz lessons.md)
     T5  role-guardovi: mutacija kao rukovodilac ne menja DATA
     T6  finansijska izolacija: rukovodilac ne vidi cene/marže/naplatu
     T7  esc() — XSS payload u podacima ne izlazi kao živ HTML
     T8  integritet: TABLES == DEMO ključevi, normalize kompletan
   ============================================================ */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { makeGlobals } = require('./dom-stub');
const { makeSupabaseMock } = require('./supabase-mock');

const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

/* ---------- infrastruktura za prijavu rezultata ---------- */
let pass = 0, fail = 0;
const failures = [];
function ok(name){ pass++; process.stdout.write('.'); }
function bad(name, detail){
  fail++; process.stdout.write('X');
  failures.push({ name, detail: String(detail).split('\n').slice(0, 6).join('\n') });
}
function check(name, fn){
  try { const r = fn(); if (r === false) bad(name, 'vratio false'); else ok(name); }
  catch (e) { bad(name, e && e.stack ? e.stack : e); }
}
async function acheck(name, fn){
  try { const r = await fn(); if (r === false) bad(name, 'vratio false'); else ok(name); }
  catch (e) { bad(name, e && e.stack ? e.stack : e); }
}
function section(t){ process.stdout.write('\n' + t.padEnd(46, ' ') + ' '); }

/* ---------- izvlačenje <script> bloka ---------- */
function extractScript(html){
  const m = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)];
  if (!m.length) throw new Error('nije nađen inline <script> blok');
  return m.map(x => x[1]).join('\n;\n');
}
const SCRIPT = extractScript(HTML);

/* ---------- podizanje app-a u vm kontekstu ---------- */
async function boot(opts = {}){
  const g = makeGlobals(opts);
  let script = SCRIPT;
  if (opts.supabase) {
    // aktiviraj Supabase granu bez obzira da li su konstante u repou prazne
    // (pre povezivanja) ili popunjene pravim vrednostima (posle povezivanja) —
    // testu treba samo da je supa.createClient() pozvan sa NEKIM URL/ključem.
    const before = script;
    script = script
      .replace(/const SUPABASE_URL = '[^']*';/, "const SUPABASE_URL = 'https://test.supabase.co';")
      .replace(/const SUPABASE_ANON_KEY = '[^']*';/, "const SUPABASE_ANON_KEY = 'test-anon-key';");
    if (script === before) throw new Error('boot(): nisam uspeo da aktiviram Supabase konstante');
    /* Auth: podrazumevano direktorska sesija (stariji T10/T15 testovi racunaju da je
       ucitavanje proslo). opts.session === null -> bez sesije (ekran za prijavu). */
    const seed = Object.assign({}, opts.seed || {});
    if (!seed.profili) seed.profili = [
      { user_id: 'u-dir', uloga: 'direktor',    zaposleni_id: null, ime: 'Direktor Test' },
      { user_id: 'u-ruk', uloga: 'rukovodilac', zaposleni_id: 'z1', ime: 'Petar Kovačević' },
    ];
    const session = opts.session === undefined ? { user: { id: 'u-dir', email: 'direktor@test' } } : opts.session;
    const users = opts.users || { 'direktor@test': { id: 'u-dir', password: 'dir' }, 'petar@test': { id: 'u-ruk', password: 'ruk' } };
    g.supabase = makeSupabaseMock(seed, opts.faults || {}, { session, users });
    g.__mock = g.supabase;
  } else {
    // Bez Supabase: isprazni konstante da app ni ne pokusa mrezu (index.html
    // od 2026-09-14 nosi prave vrednosti; bez ovoga svaki boot() loguje
    // "Supabase init: ... createClient" iz stuba i pada na memoriju).
    script = script
      .replace(/const SUPABASE_URL = '[^']*';/, "const SUPABASE_URL = '';")
      .replace(/const SUPABASE_ANON_KEY = '[^']*';/, "const SUPABASE_ANON_KEY = '';");
  }
  const ctx = vm.createContext(g);
  vm.runInContext(script, ctx, { filename: 'index.html<script>', displayErrors: true });
  // pusti async IIFE (loadState -> normalizeData -> render) da se izvrši
  for (let i = 0; i < 30; i++) await new Promise(r => setImmediate(r));   // auth + profil + 15 tabela
  return {
    ctx,
    g,
    /** izvrši izraz u ISTOM kontekstu (vidi top-level let/const app-a) */
    run: (code) => vm.runInContext(code, ctx, { filename: 'e2e-eval' }),
  };
}

/* ---------- parser tabela: broji kolone uz colspan ---------- */
function colCount(rowHtml, tagRe){
  let n = 0;
  for (const cell of rowHtml.matchAll(tagRe)) {
    const attrs = cell[1] || '';
    const cs = /colspan\s*=\s*["']?(\d+)/i.exec(attrs);
    n += cs ? parseInt(cs[1], 10) : 1;
  }
  return n;
}
/** Vrati listu nesimetričnih tabela: {headCols, bodyCols, rowIndex}. */
function tableAsymmetry(html){
  const problems = [];
  const tables = html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi);
  let ti = 0;
  for (const t of tables) {
    ti++;
    const inner = t[1];
    const rows = [...inner.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(r => r[1]);
    if (!rows.length) continue;
    // prvi red koji ima <th> je zaglavlje
    const headIdx = rows.findIndex(r => /<th\b/i.test(r));
    if (headIdx === -1) continue;
    const headCols = colCount(rows[headIdx], /<th\b([^>]*)>/gi);
    rows.forEach((r, i) => {
      if (i === headIdx) return;
      if (!/<td\b/i.test(r)) return;              // npr. dodatni th red
      const bodyCols = colCount(r, /<td\b([^>]*)>/gi);
      if (bodyCols !== headCols) {
        problems.push({ table: ti, rowIndex: i, headCols, bodyCols, snippet: r.replace(/\s+/g, ' ').slice(0, 120) });
      }
    });
  }
  return problems;
}

/* ---------- matrica: uloge × moduli × pogledi ---------- */
const VIEWS = ['dash','sites','clients','emps','time','tasks','diary','pay','nabavka','subs','resursi','magacin'];
const MODULI = [
  { modul: 'sve',           podtip: 'sve' },
  { modul: 'projektovanje', podtip: 'sve' },
  { modul: 'izvodjenje',    podtip: 'sve' },
  { modul: 'izvodjenje',    podtip: 'visokogradnja' },
  { modul: 'izvodjenje',    podtip: 'niskogradnja' },
];

/* ---------- funkcije koje MORAJU imati role-guard ---------- */
/* [ime, pozivArgumenti] — poziv se radi kao rukovodilac; DATA se ne sme promeniti */
const MUTATORS = [
  ['saveSit', ''], ['markPaid', "'s1'"], ['saveEmp', ''], ['saveClient', ''],
  ['saveSite', ''], ['saveSub', ''], ['saveNarudzba', ''], ['saveTrosak', "'g1'"],
  ['saveArtikal', ''], ['saveResurs', 'null'], ['savePredmerRed', "'g1'"],
  ['savePredmerImport', "'g1'"], ['saveMagPromena', "'m1','ulaz'"],
  ['saveTask', ''], ['saveDiary', ''],
];

/* ---------- finansijski termini koji ne smeju u rukovodiočev DOM ---------- */
const FIN_TERMS = ['Marža', 'Marza', 'marža', 'marži', 'Ostv. marža', 'Ostvarena marža', 'Naplaćeno', 'Naplaceno', 'Jed. cena', 'Jedinična cena', 'Budžet'];

(async function main(){
  console.log('GradnjaOS e2e — ' + new Date().toISOString().slice(0, 19).replace('T', ' '));
  console.log('index.html: ' + HTML.length + ' bajtova, script: ' + SCRIPT.length + ' bajtova\n');

  /* ---- T1 sintaksa ---- */
  section('T1 sintaksa');
  check('new Function(script)', () => { new Function(SCRIPT); });

  /* ---- T2 boot ---- */
  section('T2 boot (režim memorija)');
  let app;
  try {
    app = await boot();
    ok('boot');
    check('mode === memorija', () => app.run('mode') === 'memorija');
    check('DATA.gradilista popunjen', () => app.run('DATA.gradilista.length') > 0);
    check('#view ima sadržaj', () => app.g.document.getElementById('view').innerHTML.length > 500);
    check('#nav ima dugmad', () => app.g.document.getElementById('nav').innerHTML.includes('<button'));
    check('bez alert() pri startu', () => app.g._calls.alert.length === 0);
  } catch (e) {
    bad('boot', e && e.stack ? e.stack : e);
    report(); return;
  }

  /* ---- T8 integritet podataka (rano, jer diktira ostalo) ---- */
  section('T8 integritet TABLES/DEMO/normalize');
  check('TABLES pokriva sve DEMO ključeve', () => {
    const tables = app.run('TABLES');
    const demoKeys = app.run('Object.keys(DEMO)');
    const missing = demoKeys.filter(k => !tables.includes(k));
    if (missing.length) throw new Error('DEMO ključevi van TABLES: ' + missing.join(', '));
  });
  check('svaki TABLES ključ postoji u DATA', () => {
    const missing = app.run('TABLES.filter(t=>!Array.isArray(DATA[t]))');
    if (missing.length) throw new Error('DATA nema niz za: ' + missing.join(', '));
  });
  check('normalize: svi zaposleni imaju grs[] i bivsi[]', () =>
    app.run('DATA.zaposleni.every(z=>Array.isArray(z.grs)&&Array.isArray(z.bivsi)&&z.gr===undefined)'));
  check('normalize: svako gradilište ima modul i adm', () =>
    app.run("DATA.gradilista.every(g=>g.modul&&typeof g.adm==='object'&&g.adm!==null)"));
  check('normalize je idempotentan', () => {
    const a = app.run('JSON.stringify(DATA)');
    app.run('normalizeData()');
    const b = app.run('JSON.stringify(DATA)');
    if (a !== b) throw new Error('drugi normalizeData() menja DATA');
  });
  check('ID-evi jedinstveni po tabeli', () => {
    const dup = app.run(`(()=>{const out=[];for(const t of TABLES){const ids=(DATA[t]||[]).map(r=>r.id);
      const s=new Set(ids); if(s.size!==ids.length) out.push(t);} return out;})()`);
    if (dup.length) throw new Error('duplikati ID-eva u: ' + dup.join(', '));
  });
  check('strane reference postoje (zadaci/dnevnik/situacije -> gradiliste)', () => {
    const broken = app.run(`(()=>{const gid=new Set(DATA.gradilista.map(g=>g.id)); const out=[];
      for(const t of ['zadaci','dnevnik','situacije','narudzbe','troskovi_st','predmer']){
        (DATA[t]||[]).forEach(r=>{ if(r.gr && !gid.has(r.gr)) out.push(t+':'+r.id); });
      } return out;})()`);
    if (broken.length) throw new Error('visece reference: ' + broken.join(', '));
  });

  /* ---- T3 + T4 pogledi × uloge × moduli ---- */
  section('T3/T4 pogledi × uloge × moduli');
  const roles = ['all', ...app.run('DATA.zaposleni.filter(z=>/[Rr]ukovodilac/.test(z.poz)).map(z=>z.id)')];
  let combos = 0;
  const asymm = [];
  for (const role of roles) {
    for (const m of MODULI) {
      app.run(`ROLE=${JSON.stringify(role)}; MODUL=${JSON.stringify(m.modul)}; PODTIP=${JSON.stringify(m.podtip)};`);
      // tabovi vidljivi ovoj ulozi
      const visible = app.run('tabs().map(t=>t.id)');
      for (const v of VIEWS) {
        if (!visible.includes(v)) continue;      // tab nije ponuđen ovoj ulozi
        combos++;
        const label = `${v} [${role}/${m.modul}${m.podtip !== 'sve' ? '/' + m.podtip : ''}]`;
        let html = null;
        try {
          app.run(`current=${JSON.stringify(v)}; renderNav(); render();`);
          html = app.g.document.getElementById('view').innerHTML;
          if (typeof html !== 'string' || !html.length) throw new Error('prazan render');
          ok(label);
        } catch (e) { bad(label, e && e.stack ? e.stack : e); continue; }
        const probs = tableAsymmetry(html);
        if (probs.length) asymm.push({ label, probs: probs.slice(0, 3) });
      }
    }
  }
  check(`th==td simetrija (${combos} kombinacija)`, () => {
    if (asymm.length) {
      throw new Error(asymm.map(a =>
        a.label + ' -> ' + a.probs.map(p => `tabela#${p.table} red#${p.rowIndex}: th=${p.headCols} td=${p.bodyCols}`).join('; ')
      ).join('\n'));
    }
  });

  /* ---- detaljni pogledi (stranica zaposlenog, predmer) ---- */
  section('T3b detaljni pogledi');
  app.run("ROLE='all'; MODUL='sve'; PODTIP='sve';");
  check('viewEmpPage za svakog zaposlenog', () => {
    const bad2 = app.run(`(()=>{const out=[]; const prev=empPageId;
      DATA.zaposleni.forEach(z=>{ try{ empPageId=z.id; const h=viewEmpPage(); if(!h) out.push(z.id+':prazno'); }
      catch(e){ out.push(z.id+':'+e.message); } }); empPageId=prev; return out;})()`);
    if (bad2.length) throw new Error(bad2.join('\n'));
  });
  check('viewPredmer za svako gradilište', () => {
    const bad2 = app.run(`(()=>{const out=[]; const prev=PRED_ID;
      DATA.gradilista.forEach(g=>{ try{ PRED_ID=g.id; const h=viewPredmer(); if(!h) out.push(g.id+':prazno'); }
      catch(e){ out.push(g.id+':'+e.message); } }); PRED_ID=prev; return out;})()`);
    if (bad2.length) throw new Error(bad2.join('\n'));
  });
  check('openSite (drawer) za svako gradilište × obe uloge', () => {
    const bad2 = app.run(`(()=>{const out=[]; const pr=ROLE;
      const rukovodioci=DATA.zaposleni.filter(z=>/[Rr]ukovodilac/.test(z.poz)).map(z=>z.id);
      ['all',...rukovodioci].forEach(r=>{ ROLE=r;
        DATA.gradilista.forEach(g=>{ try{ openSite(g.id); }catch(e){ out.push(r+'/'+g.id+':'+e.message); } });
      }); ROLE=pr; return out;})()`);
    if (bad2.length) throw new Error(bad2.join('\n'));
  });
  check('izveštaji: openIzvestaj / openPresek / openKumulativ', () => {
    const bad2 = app.run(`(()=>{const out=[]; const pr=ROLE; ROLE='all';
      DATA.gradilista.forEach(g=>{
        ['openIzvestaj','openPresek','openKumulativ'].forEach(fn=>{
          try{ this[fn]?this[fn](g.id):eval(fn+'(g.id)'); }catch(e){ out.push(fn+'/'+g.id+':'+e.message); }
        });
      }); ROLE=pr; return out;})()`);
    if (bad2.length) throw new Error(bad2.join('\n'));
  });

  /* ---- T5 role-guardovi ---- */
  section('T5 role-guardovi (kao rukovodilac)');
  const ruk = app.run("DATA.zaposleni.filter(z=>/[Rr]ukovodilac/.test(z.poz)).map(z=>z.id)[0]");
  if (!ruk) bad('role-guard setup', 'nema rukovodioca u DEMO podacima');
  else {
    for (const [fn, args] of MUTATORS) {
      check(`guard: ${fn}()`, () => {
        const exists = app.run(`typeof ${fn}==='function'`);
        if (!exists) throw new Error('funkcija ne postoji');
        const before = app.run(`(ROLE=${JSON.stringify(ruk)}, JSON.stringify(DATA))`);
        let threw = null;
        try { app.run(`${fn}(${args});`); } catch (e) { threw = e.message; }
        const after = app.run('JSON.stringify(DATA)');
        app.run("ROLE='all';");
        if (before !== after) throw new Error('DATA je promenjen bez prava' + (threw ? ' (uz throw: ' + threw + ')' : ''));
        if (threw) throw new Error('guard ne postoji ili je posle DOM pristupa — baca: ' + threw);
      });
    }
  }

  /* ---- T6 finansijska izolacija ---- */
  section('T6 finansijska izolacija');
  check('rukovodilac nema tabove Klijenti/Naplata', () => {
    const ids = app.run(`(ROLE=${JSON.stringify(ruk)}, MODUL='sve', PODTIP='sve', tabs().map(t=>t.id))`);
    app.run("ROLE='all';");
    const leak = ['clients', 'pay'].filter(x => ids.includes(x));
    if (leak.length) throw new Error('vidljivi tabovi: ' + leak.join(', '));
  });
  check('rukovodilac: nijedan pogled ne prikazuje finansije', () => {
    const leaks = [];
    app.run(`ROLE=${JSON.stringify(ruk)}; MODUL='sve'; PODTIP='sve';`);
    const visible = app.run('tabs().map(t=>t.id)');
    for (const v of visible) {
      if (!VIEWS.includes(v)) continue;
      app.run(`current=${JSON.stringify(v)}; render();`);
      const html = app.g.document.getElementById('view').innerHTML;
      const hit = FIN_TERMS.filter(t => html.includes(t));
      if (hit.length) leaks.push(`${v}: ${hit.join(', ')}`);
    }
    app.run("ROLE='all'; current='dash'; render();");
    if (leaks.length) throw new Error(leaks.join('\n'));
  });
  check('canFinance() false za rukovodioca', () =>
    app.run(`(ROLE=${JSON.stringify(ruk)}, (()=>{const r=canFinance(); ROLE='all'; return r===false;})())`));

  /* ---- T7 esc() / XSS kroz STVARNI put upisa ----
     CLAUDE.md pravilo 3 tvrdi: sve što uđe u DATA prošlo je kroz esc().
     Zato test ide kroz forme (kao korisnik), a ne ubacivanjem u DATA direktno. */
  section('T7 esc() / XSS (kroz forme)');
  const PAYLOAD = '<img src=x onerror=xss()>';

  check('esc() escapuje < > & " \' `', () => {
    const out = app.run(`esc('<img src=x onerror=alert(1)> & "q" \\'a\\' \\\`t\\\`')`);
    for (const ch of ['<', '>']) if (out.includes(ch)) throw new Error('nije escapovano: ' + ch + ' -> ' + out);
    if (out.includes('"') || out.includes("'") || out.includes('`')) throw new Error('navodnici nisu escapovani -> ' + out);
  });
  check('unesc(esc(x)) === x (round-trip)', () => {
    const s = 'Petrović & Sinovi <d.o.o.> "AB" \'x\' `y`';
    const r = app.run(`unesc(esc(${JSON.stringify(s)}))`);
    if (r !== s) throw new Error(JSON.stringify(r) + ' !== ' + JSON.stringify(s));
  });

  /* Popuni sva polja otvorene forme: tekst -> payload, broj/datum/select -> validna vrednost. */
  function fillOpenForm(payload){
    const html = app.g.document.getElementById('modal').innerHTML || '';
    const today = app.run('todayStr()');
    const seen = [];
    for (const m of html.matchAll(/<(input|textarea|select)\b([^>]*)>/gi)) {
      const [ , tag, attrs ] = m;
      const idm = /\bid=["']?([A-Za-z0-9_]+)/.exec(attrs);
      if (!idm) continue;
      const id = idm[1];
      const type = (/\btype=["']?([a-z]+)/i.exec(attrs) || [, 'text'])[1].toLowerCase();
      const el = app.g.document.getElementById(id);
      if (tag.toLowerCase() === 'select') {
        // uzmi prvu <option value="..."> posle ovog <select>
        const rest = html.slice(m.index);
        const om = /<option[^>]*\bvalue=["']([^"']*)["']/i.exec(rest.slice(0, rest.indexOf('</select>') + 9));
        el.value = om ? om[1] : '';
      } else if (type === 'number') { el.value = '5'; }
      else if (type === 'date')     { el.value = today; }
      else if (type === 'checkbox') { el.checked = false; }
      else { el.value = payload; }
      seen.push(id);
    }
    return seen;
  }

  /* [labela, otvaranje forme, poziv snimanja, tabela u DATA] */
  const FORME = [
    ['klijent',    "formClient()",                 "saveClient()",             'clijenti'],
    ['zaposleni',  "formEmp()",                    "saveEmp()",                'zaposleni'],
    ['gradiliste', "formSite()",                   "saveSite()",               'gradilista'],
    ['zadatak',    "formTask()",                   "saveTask()",               'zadaci'],
    ['dnevnik',    "formDiary()",                  "saveDiary()",              'dnevnik'],
    ['situacija',  "formSit()",                    "saveSit()",                'situacije'],
    ['podizvodjac',"formSub()",                    "saveSub()",                'podizvodjaci'],
    ['resurs',     "formResurs(null)",             "saveResurs(null)",         'resursi'],
    ['artikal',    "formArtikal()",                "saveArtikal()",            'magacin'],
    ['trosak',     "formTrosak(DATA.gradilista[0].id)", "saveTrosak(DATA.gradilista[0].id)", 'troskovi_st'],
    ['predmer',    "formPredmerRed(DATA.gradilista[0].id)", "savePredmerRed(DATA.gradilista[0].id)", 'predmer'],
  ];

  for (const [label, openFn, saveFn, tabela] of FORME) {
    check(`upis "${label}": payload završi escapovan u DATA`, () => {
      app.run("ROLE='all'; MODUL='sve'; PODTIP='sve';");
      const before = app.run(`DATA.${tabela}.length`);
      app.run(openFn);
      const fields = fillOpenForm(PAYLOAD);
      if (!fields.length) throw new Error('forma nema nijedno polje (modal prazan?)');
      app.run(saveFn);
      const after = app.run(`DATA.${tabela}.length`);
      if (after === before) throw new Error('zapis nije dodat — validacija odbila (polja: ' + fields.join(', ') + ')');
      const rec = app.run(`JSON.stringify(DATA.${tabela}[DATA.${tabela}.length-1])`);
      if (rec.includes('<img'))
        throw new Error('SIROV payload u DATA: ' + rec.slice(0, 200));
      if (!rec.includes('&lt;img'))
        throw new Error('payload nije ni stigao do zapisa: ' + rec.slice(0, 200));
    });
  }

  check('nijedan pogled ne renderuje živ payload posle svih upisa', () => {
    const dirty = [];
    app.run("ROLE='all'; MODUL='sve'; PODTIP='sve'; rebuildMaps();");
    for (const v of VIEWS) {
      try {
        app.run(`current=${JSON.stringify(v)}; render();`);
        if (app.g.document.getElementById('view').innerHTML.includes('<img src=x onerror=')) dirty.push(v);
      } catch (e) { dirty.push(v + '(throw:' + e.message + ')'); }
    }
    app.run("current='dash'; render();");
    if (dirty.length) throw new Error('živ payload u: ' + dirty.join(', '));
  });

  check('uvoz predmera iz Excela escapuje pozicije', () => {
    const gid = app.run('DATA.gradilista[0].id');
    app.g.document.getElementById('f_pm_paste').value = `${PAYLOAD}\tm3\t10\t100`;
    app.run(`ROLE='all'; savePredmerImport(${JSON.stringify(gid)});`);
    const rec = app.run('JSON.stringify(DATA.predmer[DATA.predmer.length-1])');
    if (rec.includes('<img')) throw new Error('sirov payload iz uvoza: ' + rec.slice(0, 200));
  });

  /* ---- T9 ne-HTML izlazi moraju biti RAW (ne &amp;) ---- */
  section('T9 ne-HTML izlazi (CSV / mailto)');
  check('CSV izvoz nosi & i < kao prave znake', () => {
    const gid = app.run('DATA.gradilista[0].id');
    app.run(`(()=>{ DATA.predmer.push({id:'pm_t9', gr:${JSON.stringify(gid)}, poz:esc('Beton & čelik <C25>'), jm:esc('m³'), kol:2, cena:100, izv:1, zaduzen:null}); })()`);
    app.run(`ROLE='all'; izvozPredmer(${JSON.stringify(gid)});`);
    const a = app.g.document._created.filter(c => c.tagName === 'A' && String(c.href).includes('text/csv')).pop();
    if (!a) throw new Error('CSV link nije napravljen');
    const csv = decodeURIComponent(String(a.href).split(',').slice(1).join(','));
    if (csv.includes('&amp;') || csv.includes('&lt;'))
      throw new Error('CSV sadrži HTML entitete: ' + csv.split('\n').find(l => l.includes('Beton')));
    if (!csv.includes('Beton & čelik <C25>'))
      throw new Error('tekst nije ispravno dekodiran: ' + csv.split('\n').find(l => l.includes('Beton')));
  });
  check('telo mejla trebovanja nosi & kao pravi znak', () => {
    const gid = app.run('DATA.gradilista[0].id');
    app.run(`(()=>{ DATA.narudzbe.push({id:'n_t9', gr:${JSON.stringify(gid)}, autor:'direkcija', datum:todayStr(), rok:todayStr(), status:'poslato',
      napomena:esc('hitno & obavezno'), stavke:[{naziv:esc('Cement & kreč'), kolicina:'10', jm:esc('m³')}]}); })()`);
    const body = app.run("narudzbaMailBody(DATA.narudzbe.find(x=>x.id==='n_t9'))");
    if (body.includes('&amp;')) throw new Error('telo mejla sadrži &amp;:\n' + body);
    if (!body.includes('Cement & kreč')) throw new Error('stavka nije dekodirana:\n' + body);
  });
  check('uvoz predmera: "1.250" -> 1250 (hiljade iz Excela)', () => {
    const gid = app.run('DATA.gradilista[0].id');
    app.g.document.getElementById('f_pm_paste').value = 'Iskop temelja\tm3\t1.250\t22';
    app.run(`ROLE='all'; savePredmerImport(${JSON.stringify(gid)});`);
    const kol = app.run('DATA.predmer[DATA.predmer.length-1].kol');
    if (kol !== 1250) throw new Error('kol = ' + kol + ', očekivano 1250');
  });


  /* ---- T19 F4b: finansije ne stizu rukovodiocu; zdravlje sa servera ---- */
  section('T19 finansije van dometa rukovodioca');

  const RUK_S = { user: { id: 'u-ruk', email: 'petar@test' } };
  const DIR_S = { user: { id: 'u-dir', email: 'direktor@test' } };
  /* seed = baza koju je direktor zasejao (pun sadrzaj); mock view-ovi NULL-uju kolone ne-direktoru */
  async function punSeed(){
    const a0 = await boot({ supabase: true, seed: {}, session: DIR_S });
    return JSON.parse(JSON.stringify(a0.g.__mock._db));
  }

  await acheck('rukovodilac: cita iz view-ova, ne trazi troskovi_st/situacije, bez ijednog iznosa u DATA', async () => {
    const a = await boot({ supabase: true, seed: await punSeed(), session: RUK_S, faults: { zdravlja: { g1: 61 } } });
    const sel = a.g.__mock._log.filter(l => l.op === 'select').map(l => l.table);
    for (const t of ['gradilista_v', 'predmer_v', 'podizvodjaci_v']) if (!sel.includes(t)) throw new Error('nije citao ' + t + ' (citao: ' + [...new Set(sel)].join(',') + ')');
    for (const t of ['gradilista', 'predmer', 'podizvodjaci', 'troskovi_st', 'situacije']) if (sel.includes(t)) throw new Error('rukovodilac citao tabelu ' + t);
    const g = a.run("DATA.gradilista.find(g=>g.id==='g1')");
    if (!g) throw new Error('g1 nije ucitan');
    for (const k of ['budzet', 'troskovi', 'potroseno', 'naplaceno']) if (g[k] != null) throw new Error('gradiliste nosi ' + k + '=' + g[k]);
    if (a.run("DATA.predmer.some(x=>x.cena!=null)")) throw new Error('predmer nosi cenu');
    if (a.run("DATA.podizvodjaci.some(x=>x.cena!=null)")) throw new Error('podizvodjac nosi cenu');
    if (a.run('DATA.troskovi_st.length') || a.run('DATA.situacije.length')) throw new Error('finansijske tabele nisu prazne');
    if (a.run("zdravlje(grById['g1'])") !== 61) throw new Error('zdravlje(g1) = ' + a.run("zdravlje(grById['g1'])") + ', ocekivano 61 sa servera');
    if (a.run("JSON.stringify(ZDR_SRV)") !== '{"g1":61}') throw new Error('ZDR_SRV = ' + a.run('JSON.stringify(ZDR_SRV)'));
    const greske = a.run(`(()=>{ const out=[]; const p=(l,f)=>{ try{ f(); }catch(e){ out.push(l+': '+e.message); } };
      for(const v of tabs().map(t=>t.id)) p('view '+v, ()=>{ current=v; render(); });
      p('openSite g1', ()=>openSite('g1')); p('openPredmer g1', ()=>openPredmer('g1')); p('computeAlerts', ()=>computeAlerts());
      current='dash'; render(); return out; })()`);
    if (greske.length) throw new Error(greske.join('\n'));
    if (!a.g.document.getElementById('view').innerHTML.includes('61')) throw new Error('kontrolna tabla ne prikazuje serverski skor 61');
  });

  await acheck('rukovodilac: UPDATE (ne upsert) bez finansijskih kolona; skor se osvezava posle cuvanja', async () => {
    const a = await boot({ supabase: true, seed: await punSeed(), session: RUK_S, faults: { zdravlja: { g1: 61 } } });
    const rpc0 = a.g.__mock._log.filter(l => l.op === 'rpc').length;
    a.g.__mock._faults.zdravlja = { g1: 48 };
    a.run("(()=>{ const g=grById['g1']; g.napredak=Math.min(100,(g.napredak||0)+1); const x=DATA.predmer.find(r=>r.gr==='g1'); if(x) x.izv=(x.izv||0)+0.5; })()");
    const n0 = a.g.__mock._log.length;
    await a.run('doSave()');
    const ups = a.g.__mock._log.slice(n0).filter(l => l.op === 'upsert');
    const gUp = ups.find(u => u.table === 'gradilista'), pUp = ups.find(u => u.table === 'predmer');
    if (!gUp) throw new Error('nema upisa u gradilista');
    if (gUp.via !== 'update') throw new Error('postojeci red gradilista poslat kao ' + (gUp.via || 'upsert') + ' umesto update');
    for (const k of ['budzet', 'troskovi', 'potroseno', 'naplaceno']) if (gUp.cols.includes(k)) throw new Error('upis gradilista nosi ' + k);
    if (pUp && pUp.cols.includes('cena')) throw new Error('upis predmer nosi cenu');
    if (a.g.__mock._db.gradilista.find(g => g.id === 'g1').budzet == null) throw new Error('budzet u bazi pregazen sa null');
    if (a.g.__mock._log.filter(l => l.op === 'rpc').length !== rpc0 + 1) throw new Error('rpc posle cuvanja nije pozvan tacno jednom');
    if (a.run("zdravlje(grById['g1'])") !== 48) throw new Error('skor nije osvezen posle cuvanja: ' + a.run("zdravlje(grById['g1'])"));
    if (a.run('saveErr') !== null) throw new Error('saveErr: ' + a.run('saveErr'));
  });

  await acheck('novi red ide kao INSERT, postojeci kao UPDATE (direktor)', async () => {
    const a = await boot({ supabase: true, seed: await punSeed(), session: DIR_S });
    const n0 = a.g.__mock._log.length;
    a.run("DATA.zadaci.push({id:'t_t19', naziv:'Nov', gr:'g1', zad:'z1', prio:'mid', kol:'todo', rok:todayStr()}); grById['g1'].napredak=(grById['g1'].napredak||0)+1;");
    await a.run('doSave()');
    const ups = a.g.__mock._log.slice(n0).filter(l => l.op === 'upsert');
    const z = ups.find(u => u.table === 'zadaci'), g = ups.find(u => u.table === 'gradilista');
    if (!z || z.via === 'update') throw new Error('novi zadatak nije poslat kao insert');
    if (!g || g.via !== 'update') throw new Error('postojece gradiliste nije poslato kao update');
    if (!g.cols.includes('budzet')) throw new Error('direktorov update ne nosi budzet (mora, da ga moze menjati)');
  });

  await acheck('direktor: view-ovi sa punim kolonama, bez rpc-a, lokalna formula', async () => {
    const a = await boot({ supabase: true, seed: await punSeed(), session: DIR_S });
    if (a.g.__mock._log.some(l => l.op === 'rpc')) throw new Error('direktor zove rpc');
    if (a.run('ZDR_SRV') !== null) throw new Error('ZDR_SRV postavljen direktoru');
    if (a.run("DATA.gradilista.find(g=>g.id==='g1').budzet") == null) throw new Error('direktor nema budzet iz view-a');
    if (a.run("DATA.predmer[0].cena") == null) throw new Error('direktor nema cenu iz view-a');
  });

  await acheck('rpc pukne: zdravlje pada na lokalnu formulu bez rusenja', async () => {
    const a = await boot({ supabase: true, seed: await punSeed(), session: RUK_S, faults: { rpcFail: 'mreza' } });
    if (a.run('mode') !== 'supabase') throw new Error('rpc greska je oborila ucitavanje');
    const s = a.run("zdravlje(grById['g1'])");
    if (!Number.isFinite(s) || s < 5 || s > 100) throw new Error('skor nije validan: ' + s);
  });

  await acheck('seed/reset (opt.sve) i dalje idu kao upsert', async () => {
    const a = await boot({ supabase: true, seed: {}, session: DIR_S });
    const ups = a.g.__mock._log.filter(l => l.op === 'upsert' && l.table === 'gradilista');
    if (!ups.length || ups.some(u => u.via === 'update')) throw new Error('seed nije isao kao upsert');
  });

  /* ---- T18 F4: Auth + RLS na klijentu (Supabase mock sa auth slojem) ---- */
  section('T18 auth: prijava, uloga iz profila, odjava');

  const RUK_SESIJA = { user: { id: 'u-ruk', email: 'petar@test' } };
  const DIR_SESIJA = { user: { id: 'u-dir', email: 'direktor@test' } };

  await acheck('bez sesije: ekran za prijavu, NIJEDAN podatak se ne ucitava', async () => {
    const a = await boot({ supabase: true, seed: {}, session: null });
    if (!a.g.document.body.classList.contains('login')) throw new Error('body nema klasu login');
    const v = a.g.document.getElementById('view').innerHTML;
    if (!v.includes('id="l_email"') || !v.includes('id="l_pw"')) throw new Error('nema forme za prijavu');
    const citanja = a.g.__mock._log.filter(l => l.op === 'select' && l.table !== 'profili');
    if (citanja.length) throw new Error('ucitane tabele bez sesije: ' + citanja.map(l => l.table).join(', '));
    const upisi = a.g.__mock._log.filter(l => l.op === 'upsert');
    if (upisi.length) throw new Error('upis bez sesije: ' + upisi.map(l => l.table).join(', '));
  });

  await acheck('prijava: pogresna lozinka -> poruka, bez reload; tacna -> reload', async () => {
    const a = await boot({ supabase: true, seed: {}, session: null });
    a.g.document.getElementById('l_email').value = 'petar@test';
    a.g.document.getElementById('l_pw').value = 'pogresna';
    await a.run('prijava()');
    const msg = a.g.document.getElementById('l_msg').innerHTML;
    if (!/Pogrešan email ili lozinka/.test(msg)) throw new Error('nema poruke o pogresnoj lozinci: ' + msg);
    if (a.g._calls.reload) throw new Error('reload posle pogresne lozinke');
    a.g.document.getElementById('l_pw').value = 'ruk';
    await a.run('prijava()');
    if (a.g._calls.reload !== 1) throw new Error('reload posle tacne lozinke = ' + a.g._calls.reload);
  });

  await acheck('sesija bez profila: poruka + odjava, bez ucitavanja', async () => {
    const a = await boot({ supabase: true, seed: {}, session: { user: { id: 'u-nepoznat', email: 'stranac@test' } } });
    const v = a.g.document.getElementById('view').innerHTML;
    if (!/nije povezan/.test(v)) throw new Error('nema poruke o nepovezanom nalogu');
    if (!a.g.__mock._log.some(l => l.op === 'auth.signOut')) throw new Error('nije odjavljen');
    if (a.g.__mock._log.some(l => l.op === 'select' && l.table === 'gradilista')) throw new Error('ucitao gradilista bez profila');
  });

  await acheck('rukovodilac: ROLE iz profila, bez menija, setRole ignorisan, bez Klijenti/Naplata', async () => {
    const a = await boot({ supabase: true, seed: {}, session: RUK_SESIJA });
    if (a.run('ROLE') !== 'z1') throw new Error('ROLE = ' + a.run('ROLE'));
    if (a.run('PROFIL.uloga') !== 'rukovodilac') throw new Error('PROFIL.uloga = ' + a.run('PROFIL.uloga'));
    const box = a.g.document.getElementById('roleBox').innerHTML;
    if (box.includes('id="roleSel"')) throw new Error('rukovodilac ima meni za promenu uloge');
    if (!box.includes('Odjavi se')) throw new Error('nema dugmeta za odjavu');
    a.run("setRole('all')");
    if (a.run('ROLE') !== 'z1') throw new Error('setRole("all") je prosao za rukovodioca');
    const tabs = a.run('tabs().map(t=>t.id)');
    if (tabs.includes('clients') || tabs.includes('pay')) throw new Error('rukovodilac vidi Klijenti/Naplata: ' + tabs.join(','));
    const foot = a.g.document.getElementById('sideFoot').innerHTML;
    if (foot.includes('resetDemo')) throw new Error('rukovodilac ima dugme za reset demo podataka');
  });

  await acheck('direktor: ROLE=all, meni "pogled kao" radi u oba smera', async () => {
    const a = await boot({ supabase: true, seed: {}, session: DIR_SESIJA });
    if (a.run('ROLE') !== 'all') throw new Error('ROLE = ' + a.run('ROLE'));
    const box = a.g.document.getElementById('roleBox').innerHTML;
    if (!box.includes('id="roleSel"')) throw new Error('direktor nema meni "pogled kao"');
    if (!box.includes('direktor@test')) throw new Error('email nije prikazan');
    a.run("setRole('z1')");
    if (a.run('ROLE') !== 'z1') throw new Error('simulacija pogleda ne radi');
    const tabs = a.run('tabs().map(t=>t.id)');
    if (tabs.includes('pay')) throw new Error('u simulaciji rukovodioca i dalje vidi Naplatu');
    a.run("setRole('all')");
    if (a.run('ROLE') !== 'all') throw new Error('povratak na direktora ne radi');
  });

  await acheck('odjava: signOut + reload; promena lozinke: kratka odbijena, validna poslata', async () => {
    const a = await boot({ supabase: true, seed: {}, session: DIR_SESIJA, promptReturns: 'kratka' });
    await a.run('promeniLozinku()');
    if (a.g.__mock._log.some(l => l.op === 'auth.updateUser')) throw new Error('kratka lozinka poslata');
    if (!a.g._calls.alert.some(m => /najmanje 8/.test(m))) throw new Error('nema upozorenja o duzini');
    const b = await boot({ supabase: true, seed: {}, session: DIR_SESIJA, promptReturns: 'novalozinka123' });
    await b.run('promeniLozinku()');
    const up = b.g.__mock._log.find(l => l.op === 'auth.updateUser');
    if (!up || up.attrs.password !== 'novalozinka123') throw new Error('updateUser nije pozvan sa lozinkom');
    await b.run('odjava()');
    if (!b.g.__mock._log.some(l => l.op === 'auth.signOut')) throw new Error('signOut nije pozvan');
    if (b.g._calls.reload !== 1) throw new Error('reload posle odjave = ' + b.g._calls.reload);
  });

  section('T18b diff-cuvanje i join tabele');

  await acheck('doSave gura SAMO izmenjene redove (1 zadatak -> 1 upsert, 1 red)', async () => {
    const a = await boot({ supabase: true, seed: {}, session: DIR_SESIJA });
    const n0 = a.g.__mock._log.length;
    a.run("DATA.zadaci[0].naziv = 'Izmenjen naziv T18'");
    await a.run('doSave()');
    const ups = a.g.__mock._log.slice(n0).filter(l => l.op === 'upsert');
    if (ups.length !== 1) throw new Error('upsert poziva: ' + ups.length + ' (' + ups.map(u => u.table + ':' + u.n).join(', ') + ')');
    if (ups[0].table !== 'zadaci' || ups[0].n !== 1) throw new Error('pogresan upsert: ' + JSON.stringify(ups[0]));
    if (a.g.__mock._db.zadaci[0].naziv !== 'Izmenjen naziv T18') throw new Error('baza nema novi naziv');
  });

  await acheck('nepromenjen DATA -> doSave ne salje nista', async () => {
    const a = await boot({ supabase: true, seed: {}, session: DIR_SESIJA });
    const n0 = a.g.__mock._log.length;
    await a.run('doSave()');
    const ups = a.g.__mock._log.slice(n0).filter(l => l.op === 'upsert');
    if (ups.length) throw new Error('poslato bez izmena: ' + ups.map(u => u.table).join(', '));
  });

  await acheck('seed: zaposleni u bazi BEZ grs/bivsi; join tabele popunjene; podizvodjaci bez grs', async () => {
    const a = await boot({ supabase: true, seed: {}, session: DIR_SESIJA });
    const z = a.g.__mock._db.zaposleni.find(x => x.id === 'z1');
    if (!z || 'grs' in z || 'bivsi' in z) throw new Error('zaposleni red u bazi nosi nizove: ' + JSON.stringify(z));
    const zg = a.g.__mock._db.zaposleni_gradiliste || [];
    const z1g1 = zg.find(r => r.zaposleni_id === 'z1' && r.gradiliste_id === 'g1');
    const z1g4 = zg.find(r => r.zaposleni_id === 'z1' && r.gradiliste_id === 'g4');
    if (!z1g1 || z1g1.aktivan !== true) throw new Error('z1/g1 aktivan nedostaje');
    if (!z1g4 || z1g4.aktivan !== false) throw new Error('z1/g4 bivsi nedostaje');
    const p1 = a.g.__mock._db.podizvodjaci.find(x => x.id === 'p1');
    if (!p1 || 'grs' in p1) throw new Error('podizvodjac red nosi grs');
    const pg = a.g.__mock._db.podizvodjac_gradiliste || [];
    if (!pg.some(r => r.podizvodjac_id === 'p1' && r.gradiliste_id === 'g1')) throw new Error('p1/g1 veza nedostaje');
  });

  await acheck('ucitavanje: grs/bivsi/podizvodjaci.grs se rekonstruisu iz join tabela', async () => {
    const a0 = await boot({ supabase: true, seed: {}, session: DIR_SESIJA });   // zaseje bazu
    const seed = JSON.parse(JSON.stringify(a0.g.__mock._db));
    const a = await boot({ supabase: true, seed, session: DIR_SESIJA });        // ucita iz zasejane
    const z1 = a.run("zapById['z1']");
    if (JSON.stringify(z1.grs) !== '["g1"]' || JSON.stringify(z1.bivsi) !== '["g4"]')
      throw new Error('z1 grs/bivsi: ' + JSON.stringify(z1.grs) + ' / ' + JSON.stringify(z1.bivsi));
    const p1 = a.run("DATA.podizvodjaci.find(x=>x.id==='p1')");
    if (JSON.stringify([...p1.grs].sort()) !== '["g1","g6"]') throw new Error('p1.grs = ' + JSON.stringify(p1.grs));
    if (a.run("'zaposleni_gradiliste' in DATA")) throw new Error('join tabela ostala u DATA');
    const n0 = a.g.__mock._log.length;
    await a.run('doSave()');
    const ups = a.g.__mock._log.slice(n0).filter(l => l.op === 'upsert');
    if (ups.length) throw new Error('posle ucitavanja doSave salje: ' + ups.map(u => u.table + ':' + u.n).join(', '));
  });

  await acheck('saveTim: dodavanje/skidanje ide u zaposleni_gradiliste, NE u zaposleni', async () => {
    const a = await boot({ supabase: true, seed: {}, session: DIR_SESIJA });
    // par (zaposleni, gradiliste) koji NIJE u DEMO ni kao grs ni kao bivsi — inace test prolazi trivijalno
    const par = a.run(`(()=>{ for(const z of DATA.zaposleni){ for(const g of DATA.gradilista){
      if(!(z.grs||[]).includes(g.id) && !(z.bivsi||[]).includes(g.id)) return {z:z.id, g:g.id}; } } return null; })()`);
    if (!par) throw new Error('nema slobodnog para u DEMO');
    const n0 = a.g.__mock._log.length;
    // skini z1 sa g1 (-> bivsi), dodaj par.z na par.g
    a.run(`(()=>{ const z1=zapById['z1']; z1.grs=z1.grs.filter(x=>x!=='g1'); z1.bivsi=[...new Set([...z1.bivsi,'g1'])];
      const z=zapById[${JSON.stringify(par.z)}]; z.grs=[...(z.grs||[]), ${JSON.stringify(par.g)}]; })()`);
    await a.run('doSave()');
    const ups = a.g.__mock._log.slice(n0).filter(l => l.op === 'upsert');
    const tabele = [...new Set(ups.map(u => u.table))];
    if (tabele.includes('zaposleni')) throw new Error('upsert na zaposleni iako se red nije promenio');
    if (!tabele.includes('zaposleni_gradiliste')) throw new Error('nema upserta na join tabelu: ' + tabele.join(','));
    const jt = ups.filter(u => u.table === 'zaposleni_gradiliste');
    if (jt.reduce((s, u) => s + u.n, 0) !== 2) throw new Error('ocekivana tacno 2 izmenjena reda join tabele, poslato: ' + jt.map(u => u.n).join('+'));
    const zg = a.g.__mock._db.zaposleni_gradiliste;
    const r1 = zg.find(r => r.zaposleni_id === 'z1' && r.gradiliste_id === 'g1');
    const r2 = zg.find(r => r.zaposleni_id === par.z && r.gradiliste_id === par.g);
    if (!r1 || r1.aktivan !== false) throw new Error('z1/g1 nije prebacen u bivsi');
    if (!r2 || r2.aktivan !== true) throw new Error(par.z + '/' + par.g + ' nije dodat');
  });

  await acheck('prazna baza + rukovodilac: NE seje demo', async () => {
    const a = await boot({ supabase: true, seed: {}, session: RUK_SESIJA });
    if (a.g.__mock._log.some(l => l.op === 'upsert')) throw new Error('rukovodilac je zasejao bazu');
    if (a.run('mode') === 'supabase') throw new Error('mode=supabase iako ucitavanje nije uspelo');
  });

  await acheck('resetDemo kao rukovodilac: odbijen bez ijednog poziva bazi', async () => {
    const a0 = await boot({ supabase: true, seed: {}, session: DIR_SESIJA });
    const seed = JSON.parse(JSON.stringify(a0.g.__mock._db));
    const a = await boot({ supabase: true, seed, session: RUK_SESIJA });
    const n0 = a.g.__mock._log.length;
    await a.run('resetDemo()');
    const poz = a.g.__mock._log.slice(n0).filter(l => l.op === 'upsert' || l.op === 'delete');
    if (poz.length) throw new Error('reset kao rukovodilac je dirao bazu: ' + poz.map(x => x.op + ':' + x.table).join(', '));
    if (!a.g._calls.alert.some(m => /samo direktor/.test(m))) throw new Error('nema poruke');
  });

  await acheck('resetDemo kao direktor: join tabele ponovo upisane i snapshot svez', async () => {
    const a = await boot({ supabase: true, seed: {}, session: DIR_SESIJA });
    const par = a.run(`(()=>{ for(const z of DATA.zaposleni){ for(const g of DATA.gradilista){
      if(!(z.grs||[]).includes(g.id) && !(z.bivsi||[]).includes(g.id)) return {z:z.id, g:g.id}; } } return null; })()`);
    a.run(`(()=>{ const z=zapById[${JSON.stringify(par.z)}]; z.grs=[...(z.grs||[]), ${JSON.stringify(par.g)}]; })()`);
    await a.run('doSave()');
    if (!a.g.__mock._db.zaposleni_gradiliste.some(r => r.zaposleni_id === par.z && r.gradiliste_id === par.g)) throw new Error('priprema: veza nije upisana');
    await a.run('resetDemo()');
    const zg = a.g.__mock._db.zaposleni_gradiliste;
    if (zg.some(r => r.zaposleni_id === par.z && r.gradiliste_id === par.g)) throw new Error(par.z + '/' + par.g + ' prezivela reset');
    const n0 = a.g.__mock._log.length;
    await a.run('doSave()');
    if (a.g.__mock._log.slice(n0).some(l => l.op === 'upsert')) throw new Error('posle reseta doSave gura podatke (snapshot nije osvezen)');
  });

  await acheck('demo rezim (bez Supabase): nema prijave, meni uloga radi kao pre', async () => {
    const a = await boot();
    if (a.g.document.body.classList.contains('login')) throw new Error('login ekran u demo rezimu');
    if (a.run('PROFIL') !== null) throw new Error('PROFIL postavljen u demo rezimu');
    if (!a.g.document.getElementById('roleBox').innerHTML.includes('id="roleSel"')) throw new Error('nema menija uloga');
    a.run("setRole('z1')"); if (a.run('ROLE') !== 'z1') throw new Error('setRole ne radi u demo rezimu');
  });


  section('T18c parcijalni DATA (kao sto RLS vraca rukovodiocu)');

  /* Server rukovodiocu vraca: SVE zaposlene i SVE veze (ukljucujuci tudja gradilista),
     ali samo SVOJE gradiliste i njegove redove. Svako `grById[x].naziv` bez zastite
     puca na id gradilista koje nije ucitano. Ovaj test to lovi u mock-u — u pravom
     browseru je proslo 2026-09-23, ali mora ostati pokriveno. */
  await acheck('rukovodilac sa RLS-isecenim podacima: nijedan pogled/kartica/forma ne puca', async () => {
    const a0 = await boot({ supabase: true, seed: {}, session: DIR_SESIJA });
    const full = JSON.parse(JSON.stringify(a0.g.__mock._db));
    const moje = 'g1';
    const seed = {
      profili: full.profili,
      gradilista: full.gradilista.filter(g => g.id === moje),
      clijenti: full.clijenti.filter(c => full.gradilista.some(g => g.id === moje && g.klijent === c.id)),
      zaposleni: full.zaposleni,                          // svi (Jovanova odluka)
      zaposleni_gradiliste: full.zaposleni_gradiliste,    // sve veze, i tudje
      podizvodjaci: full.podizvodjaci.filter(p => (full.podizvodjac_gradiliste || []).some(r => r.podizvodjac_id === p.id && r.gradiliste_id === moje)),
      podizvodjac_gradiliste: full.podizvodjac_gradiliste,
      resursi: full.resursi.filter(r => !r.gr || r.gr === moje),
      magacin: full.magacin,
      mag_promene: full.mag_promene.filter(r => !r.gr || r.gr === moje),
    };
    for (const t of ['zadaci', 'dnevnik', 'situacije', 'narudzbe', 'troskovi_st', 'predmer']) seed[t] = (full[t] || []).filter(r => r.gr === moje);
    const a = await boot({ supabase: true, seed, session: RUK_SESIJA });
    if (a.run('mode') !== 'supabase' || a.run('ROLE') !== 'z1') throw new Error('boot: mode=' + a.run('mode') + ' ROLE=' + a.run('ROLE'));
    if (a.run('DATA.gradilista.length') !== 1) throw new Error('ucitano gradilista: ' + a.run('DATA.gradilista.length'));
    // tudji id u grs mora da PREZIVI ucitavanje (drugde() ga koristi za ⚠ oznaku)
    const z2 = a.run("zapById['z2'].grs");
    if (!z2.includes('g2')) throw new Error('tudji id nestao iz z2.grs: ' + JSON.stringify(z2));
    const greske = a.run(`(()=>{ const out=[]; const p=(l,f)=>{ try{ f(); }catch(e){ out.push(l+': '+e.message); } };
      for(const v of tabs().map(t=>t.id)) p('view '+v, ()=>{ current=v; render(); });
      DATA.zaposleni.forEach(z=>p('openEmp '+z.id, ()=>openEmp(z.id)));
      DATA.gradilista.forEach(g=>{ p('openSite '+g.id, ()=>openSite(g.id)); p('formTim '+g.id, ()=>formTim(g.id)); p('openPredmer '+g.id, ()=>openPredmer(g.id)); });
      p('formTask', ()=>formTask()); p('formDiary', ()=>formDiary()); p('formNarudzba', ()=>formNarudzba()); p('computeAlerts', ()=>computeAlerts());
      current='dash'; render(); return out; })()`);
    if (greske.length) throw new Error(greske.join('\n'));
    // formTim: oznaka "na drugom gradilistu" bez imena tudjeg gradilista
    a.run("formTim('g1')");
    const html = a.g.document.getElementById('modal').innerHTml || a.g.document.getElementById('modal').innerHTML;
    if (!html.includes('na drugom gradilištu')) throw new Error('nema ⚠ oznake za osobu sa tudjeg gradilista');
    const tudjiNazivi = full.gradilista.filter(g => g.id !== moje).map(g => g.naziv);
    const curi = tudjiNazivi.filter(n => html.includes(n));
    if (curi.length) throw new Error('ime tudjeg gradilista u formi tima: ' + curi.join(', '));
  });

  await acheck('rukovodilac: saveTim gura samo join redove SVOG gradilista (nista sto RLS odbija)', async () => {
    const a0 = await boot({ supabase: true, seed: {}, session: DIR_SESIJA });
    const full = JSON.parse(JSON.stringify(a0.g.__mock._db));
    const seed = { profili: full.profili, gradilista: full.gradilista.filter(g => g.id === 'g1'), zaposleni: full.zaposleni,
      zaposleni_gradiliste: full.zaposleni_gradiliste, podizvodjaci: [], podizvodjac_gradiliste: full.podizvodjac_gradiliste,
      clijenti: [], zadaci: [], dnevnik: [], situacije: [], narudzbe: [], troskovi_st: [], predmer: [], resursi: [], magacin: [], mag_promene: [] };
    const a = await boot({ supabase: true, seed, session: RUK_SESIJA });
    const slobodan = a.run(`DATA.zaposleni.find(z=>!(z.grs||[]).includes('g1') && !(z.bivsi||[]).includes('g1')).id`);
    a.run("formTim('g1')");
    a.run(`DATA.zaposleni.forEach(z=>{ document.getElementById('t_z_'+z.id).checked=(z.grs||[]).includes('g1'); });`);
    a.g.document.getElementById('t_z_' + slobodan).checked = true;
    const n0 = a.g.__mock._log.length;
    a.run("saveTim('g1')");
    await a.run('doSave()');
    const ups = a.g.__mock._log.slice(n0).filter(l => l.op === 'upsert');
    const tabele = [...new Set(ups.map(u => u.table))];
    if (tabele.some(t => t !== 'zaposleni_gradiliste')) throw new Error('rukovodilac gurao i: ' + tabele.join(','));
    const keys = ups.flatMap(u => u.keys || []);
    if (keys.some(k => !k.endsWith('|g1'))) throw new Error('gurnuti redovi van g1: ' + keys.join(','));
  });


  /* ---- T17 tri Jovanove odluke (2026-09-15) ---- */
  section('T17 zdravlje / ostvarena marza / tim');

  await acheck('zdravlje(g) je isto za direktora i rukovodioca (svako gradiliste)', async () => {
    const r = app.run("DATA.zaposleni.filter(z=>/[Rr]ukovodilac/.test(z.poz)).map(z=>z.id)[0]");
    const razlike = app.run(`(()=>{ const out=[]; DATA.gradilista.forEach(g=>{
      ROLE='all'; const a=zdravlje(g); ROLE=${JSON.stringify(r)}; const b=zdravlje(g); ROLE='all';
      if(a!==b) out.push(g.id+': '+a+' vs '+b); }); return out; })()`);
    if (razlike.length) throw new Error('skor zavisi od uloge: ' + razlike.join(', '));
  });

  await acheck('ostvMarzaPct: budzet 0 -> 0; potroseno > troskovi -> ostvarena < planska', async () => {
    if (app.run('ostvMarzaPct({budzet:0})') !== 0) throw new Error('budzet 0 nije 0');
    const g = app.run(`DATA.gradilista.find(g=>potroseno(g)>g.troskovi)`);
    if (!g) return;   // demo nema takav slucaj
    const om = app.run(`ostvMarzaPct(grById[${JSON.stringify(g.id)}])`);
    const pm = app.run(`marzaPct(grById[${JSON.stringify(g.id)}])`);
    if (!(om < pm)) throw new Error(`ostvarena ${om} nije manja od planske ${pm} iako je potroseno > plan`);
  });

  await acheck('alarm kad stvarni troskovi premase plan (direktor), a ne za rukovodioca', async () => {
    const gid = 'g_t17';
    app.run(`(()=>{ DATA.gradilista.push({id:${JSON.stringify(gid)}, modul:'izvodjenje', tip:'visokogradnja', naziv:'T17 prekoracenje',
      lok:'x', klijent:DATA.clijenti[0].id, rukovodilac:DATA.zaposleni[0].id, pocetak:'2026-01-01', rok:plusDays(200),
      napredak:50, status:'u toku', faza:'x', budzet:1000000, troskovi:800000, potroseno:0, naplaceno:500000, adm:{}});
      DATA.troskovi_st.push({id:'tr_t17', gr:${JSON.stringify(gid)}, datum:todayStr(), opis:'x', kat:'Ostalo', iznos:850000});
      rebuildMaps(); })()`);
    const dir = app.run(`(ROLE='all', JSON.stringify(computeAlerts().filter(a=>a.gr===${JSON.stringify(gid)})))`);
    if (!/premašili plan|Ostvarena marža/.test(dir)) throw new Error('nema alarma za prekoracenje plana: ' + dir);
    const r = app.run("DATA.zaposleni.filter(z=>/[Rr]ukovodilac/.test(z.poz)).map(z=>z.id)[0]");
    app.run(`DATA.gradilista.find(g=>g.id===${JSON.stringify(gid)}).rukovodilac=${JSON.stringify(r)}; rebuildMaps();`);
    const ruk = app.run(`(ROLE=${JSON.stringify(r)}, (()=>{ const s=JSON.stringify(computeAlerts().filter(a=>a.gr===${JSON.stringify(gid)})); ROLE='all'; return s; })())`);
    app.run(`DATA.gradilista=DATA.gradilista.filter(g=>g.id!==${JSON.stringify(gid)}); DATA.troskovi_st=DATA.troskovi_st.filter(t=>t.id!=='tr_t17'); rebuildMaps();`);
    if (/marža/i.test(ruk)) throw new Error('rukovodilac vidi marzu u alarmu: ' + ruk);
  });

  await acheck('oznake: "Plan. marža" na tabli, "Ostv. marža" u fioci, "Ostvarena marža" u preseku', async () => {
    app.run("ROLE='all'; MODUL='sve'; current='dash'; render();");
    const dash = app.g.document.getElementById('view').innerHTML;
    if (!dash.includes('Plan. mar')) throw new Error('tabla nema "Plan. marža"');
    const gid = app.run('DATA.gradilista[0].id');
    app.run(`openSite(${JSON.stringify(gid)});`);
    const dr = app.g.document.getElementById('drawer').innerHTML;
    if (!dr.includes('Ostv. marža') || !dr.includes('Plan. marža')) throw new Error('fioka nema Plan./Ostv. marža');
    app.run(`openPresek(${JSON.stringify(gid)});`);
    const pr = app.g.document.getElementById('rpt').innerHTML;   // presek/izvestaj idu u #rpt, ne u #drawer
    if (!pr.includes('Ostvarena marža')) throw new Error('presek nema "Ostvarena marža"');
    app.run("closeDrawer(); current='dash'; render();");
  });

  await acheck('formTim: osoba sa drugog gradilista je oznacena; rukovodilac ne vidi ime tudjeg gradilista', async () => {
    const r = app.run("DATA.zaposleni.filter(z=>/[Rr]ukovodilac/.test(z.poz)).map(z=>z.id)[0]");
    const moje = app.run(`DATA.gradilista.find(g=>g.rukovodilac===${JSON.stringify(r)}).id`);
    const drugi = app.run(`DATA.zaposleni.find(z=>(z.grs||[]).length && !(z.grs||[]).includes(${JSON.stringify(moje)}))`);
    if (!drugi) return;
    const tudjeNaziv = app.run(`grById[${JSON.stringify(drugi.grs[0])}].naziv`);
    app.run(`ROLE=${JSON.stringify(r)}; formTim(${JSON.stringify(moje)});`);
    const htmlR = app.g.document.getElementById('modal').innerHTML;
    app.run(`ROLE='all'; formTim(${JSON.stringify(moje)});`);
    const htmlD = app.g.document.getElementById('modal').innerHTML;
    if (!htmlR.includes('na drugom gradilištu')) throw new Error('rukovodilac: nema oznake');
    if (htmlR.includes(tudjeNaziv)) throw new Error('rukovodilac vidi ime tudjeg gradilista: ' + tudjeNaziv);
    if (!htmlD.includes('na: ')) throw new Error('direktor: nema imena gradilista uz oznaku');
  });

  await acheck('saveTim: odbijena potvrda NE dodaje osobu sa drugog gradilista; prihvacena dodaje', async () => {
    for (const odgovor of [false, true]) {
      const a = await boot({ confirmReturns: odgovor });
      const moje = a.run("DATA.gradilista[0].id");
      const drugi = a.run(`DATA.zaposleni.find(z=>(z.grs||[]).length && !(z.grs||[]).includes(${JSON.stringify(moje)}))`);
      if (!drugi) return;
      a.run(`ROLE='all'; formTim(${JSON.stringify(moje)});`);
      // sacuvaj postojece stanje checkbox-ova, pa cekiraj "drugog"
      a.run(`DATA.zaposleni.forEach(z=>{ document.getElementById('t_z_'+z.id).checked=(z.grs||[]).includes(${JSON.stringify(moje)}); });`);
      a.g.document.getElementById('t_z_' + drugi.id).checked = true;
      a.run(`saveTim(${JSON.stringify(moje)});`);
      const dodat = a.run(`(zapById[${JSON.stringify(drugi.id)}].grs||[]).includes(${JSON.stringify(moje)})`);
      if (a.g._calls.confirm.length !== 1) throw new Error(`confirm pozvan ${a.g._calls.confirm.length}x (ocekivano 1)`);
      if (odgovor === false && dodat) throw new Error('dodat uprkos odbijenoj potvrdi');
      if (odgovor === true && !dodat) throw new Error('nije dodat uprkos prihvacenoj potvrdi');
    }
  });


  /* ---- T16 sitne korekcije (falsy-nula, prazan rok zadatka) ---- */
  section('T16 sitne korekcije');

  await acheck('prazan rok zadatka dobija smislen default, ne null', async () => {
    app.run("ROLE='all'; formTask();");
    const html = app.g.document.getElementById('modal').innerHTML;
    for (const m of html.matchAll(/<(input|textarea|select)\b([^>]*)>/gi)) {
      const idm = /\bid=["']?([A-Za-z0-9_]+)/.exec(m[2]); if (!idm) continue;
      const el = app.g.document.getElementById(idm[1]);
      if (idm[1] === 'f_trok') el.value = '';                 // korisnik obrisao rok
      else if (m[1].toLowerCase() === 'select') {
        const rest = html.slice(m.index);
        const om = /<option[^>]*\bvalue=["']([^"']*)["']/i.exec(rest.slice(0, rest.indexOf('</select>') + 9));
        el.value = om ? om[1] : '';
      } else el.value = 'Zadatak T16';
    }
    app.run('saveTask();');
    const t = app.run('DATA.zadaci[DATA.zadaci.length-1]');
    if (t.rok === null || t.rok === '') throw new Error('rok = ' + JSON.stringify(t.rok) + ' — dParse/daysBetween se lome na null/prazno u 10+ mesta (viewTasks, viewTime, computeAlerts...)');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(t.rok)) throw new Error('rok nije validan datum: ' + t.rok);
    // mora biti upotrebljiv u daysBetween bez NaN
    const dana = app.run(`daysBetween(TODAY, dParse(${JSON.stringify(t.rok)}))`);
    if (!Number.isFinite(dana)) throw new Error('daysBetween vraca NaN za dodeljeni rok');
  });

  await acheck('saveSite: eksplicitno uneta 0 za planirane troskove se ne zamenjuje', async () => {
    app.run("ROLE='all'; formSite();");
    const set = (id, val) => { const e = app.g.document.getElementById(id); if (e) e.value = val; };
    set('f_naziv', 'T16 nula troskova'); set('f_modul', 'izvodjenje'); set('f_tip', 'visokogradnja');
    set('f_lok', 'x'); set('f_cena', '50000'); set('f_tro', '0');
    set('f_ruk', app.run('DATA.zaposleni[0].id'));
    set('f_poc', app.run('todayStr()')); set('f_rok', app.run('plusDays(100)'));
    const cb = app.g.document.getElementById('f_faze_fill'); if (cb) cb.checked = false;
    app.run('saveSite();');
    const g = app.run('DATA.gradilista[DATA.gradilista.length-1]');
    if (g.troskovi !== 0) throw new Error('troskovi = ' + g.troskovi + ', ocekivano 0 (korisnik je eksplicitno uneo 0)');
  });

  await acheck('savePredmerRed: eksplicitno uneta 0 kolicina se ne zamenjuje sa 1', async () => {
    const gid = app.run('DATA.gradilista[0].id');
    app.run(`ROLE='all'; formPredmerRed(${JSON.stringify(gid)});`);
    const set = (id, val) => { const e = app.g.document.getElementById(id); if (e) e.value = val; };
    set('f_pm_poz', 'Pozicija T16'); set('f_pm_kol', '0'); set('f_pm_cena', '100');
    app.run(`savePredmerRed(${JSON.stringify(gid)});`);
    const r = app.run('DATA.predmer[DATA.predmer.length-1]');
    if (r.kol !== 0) throw new Error('kol = ' + r.kol + ', ocekivano 0 (korisnik je eksplicitno uneo 0)');
  });

  await acheck('savePredmerRed: prazna kolicina i dalje dobija default 1', async () => {
    const gid = app.run('DATA.gradilista[0].id');
    app.run(`ROLE='all'; formPredmerRed(${JSON.stringify(gid)});`);
    const set = (id, val) => { const e = app.g.document.getElementById(id); if (e) e.value = val; };
    set('f_pm_poz', 'Pozicija T16b'); set('f_pm_kol', ''); set('f_pm_cena', '100');
    app.run(`savePredmerRed(${JSON.stringify(gid)});`);
    const r = app.run('DATA.predmer[DATA.predmer.length-1]');
    if (r.kol !== 1) throw new Error('kol = ' + r.kol + ', ocekivano default 1 kad je polje prazno');
  });

  await acheck('dashSorted (smart): gradiliste sa nepoznatim statusom ne kvari sortiranje', async () => {
    app.run(`(()=>{ DATA.gradilista.push({id:'g_t16', modul:'izvodjenje', tip:'visokogradnja', naziv:'T16 status',
      lok:'x', klijent:DATA.clijenti[0].id, rukovodilac:null, pocetak:todayStr(), rok:plusDays(30),
      napredak:0, status:'nepoznat-status', faza:'x', budzet:1000, troskovi:800, potroseno:0, naplaceno:0, adm:{}}); })()`);
    let err = null;
    try { app.run("ROLE='all'; dashSort.key='smart'; dashSorted(DATA.gradilista);"); }
    catch (e) { err = e.message; }
    app.run("DATA.gradilista = DATA.gradilista.filter(g=>g.id!=='g_t16');");
    if (err) throw new Error('dashSorted baca na nepoznat status: ' + err);
  });


  /* ---- T15 F2: Edge Function za trebovanje (sa fallback na mailto) ---- */
  section('T15 edge function trebovanja');

  await acheck('bez Supabase: trebovanje ide direktno na mailto (bez mreznog poziva)', async () => {
    const a = await boot();      // mode = 'memorija', nema supa uopste
    const nid = a.run('DATA.narudzbe[0]?.id');
    if (!nid) return;
    const preOpen = a.g._calls.open.length;
    await a.run(`ROLE='all'; posaljiMejlNabavci(${JSON.stringify(nid)});`);
    if (a.g._calls.open.length !== preOpen + 1) throw new Error('mailto nije otvoren van Supabase rezima');
    if (!/^mailto:/.test(a.g._calls.open[a.g._calls.open.length - 1])) throw new Error('otvoren URL nije mailto:');
  });

  await acheck('Supabase povezan ali funkcija NIJE deploy-ovana: pada na mailto', async () => {
    const a = await boot({ supabase: true, seed: {} }); // faults.functionsDeployed nije postavljen -> "not found"
    const nid = a.run('DATA.narudzbe[0]?.id');
    if (!nid) return;
    const preOpen = a.g._calls.open.length;
    await a.run(`ROLE='all'; posaljiMejlNabavci(${JSON.stringify(nid)});`);
    const pozivi = a.g.__mock._log.filter(l => l.op === 'functions.invoke');
    if (!pozivi.length) throw new Error('invoke() nije ni pokusan');
    if (a.g._calls.open.length !== preOpen + 1) throw new Error('nije palo na mailto kad funkcija ne postoji');
  });

  await acheck('Supabase + funkcija deploy-ovana: salje se pravi mejl, BEZ mailto', async () => {
    const a = await boot({ supabase: true, seed: {}, faults: { functionsDeployed: true } });
    const n = a.run('DATA.narudzbe[0]');
    if (!n) return;
    const preOpen = a.g._calls.open.length;
    await a.run(`ROLE='all'; posaljiMejlNabavci(${JSON.stringify(n.id)});`);
    const poziv = a.g.__mock._log.filter(l => l.op === 'functions.invoke').pop();
    if (!poziv) throw new Error('invoke() nije pozvan');
    if (poziv.name !== 'posalji-trebovanje') throw new Error('pogresno ime funkcije: ' + poziv.name);
    if (!poziv.body || !poziv.body.to || !poziv.body.subject || !poziv.body.body)
      throw new Error('nepotpun payload: ' + JSON.stringify(poziv.body));
    if (poziv.body.to !== NABAVKA_EMAIL_TEST(a)) throw new Error('to != NABAVKA_EMAIL: ' + poziv.body.to);
    if (a.g._calls.open.length !== preOpen) throw new Error('mailto otvoren iako je mejl uspesno poslat preko funkcije');
  });
  function NABAVKA_EMAIL_TEST(a){ return a.run('NABAVKA_EMAIL'); }

  await acheck('mrezna greska u funkciji i dalje pada na mailto (korisnik nikad ne ostaje bez opcije)', async () => {
    const a = await boot({ supabase: true, seed: {}, faults: { functionsDeployed: true, functionsFail: 'mreza pukla' } });
    const nid = a.run('DATA.narudzbe[0]?.id');
    if (!nid) return;
    const preOpen = a.g._calls.open.length;
    await a.run(`ROLE='all'; posaljiMejlNabavci(${JSON.stringify(nid)});`);
    if (a.g._calls.open.length !== preOpen + 1) throw new Error('nije palo na mailto posle mrezne greske');
  });

  await acheck('telo mejla poslato funkciji ne sadrzi HTML entitete (unesc primenjen)', async () => {
    const a = await boot({ supabase: true, seed: {}, faults: { functionsDeployed: true } });
    const gid = a.run('DATA.gradilista[0].id');
    a.run(`(()=>{ DATA.gradilista.find(g=>g.id===${JSON.stringify(gid)}).naziv = esc('Petrović & Sinovi'); rebuildMaps();
      DATA.narudzbe.push({id:'n_t15', gr:${JSON.stringify(gid)}, autor:'direkcija', datum:todayStr(), rok:todayStr(), status:'poslato',
        napomena:'', stavke:[{naziv:esc('Cement & krec'), kolicina:'5', jm:'kom'}]}); })()`);
    await a.run("ROLE='all'; posaljiMejlNabavci('n_t15');");
    const poziv = a.g.__mock._log.filter(l => l.op === 'functions.invoke').pop();
    if (poziv.body.subject.includes('&amp;') || poziv.body.body.includes('&amp;'))
      throw new Error('HTML entiteti u mejlu poslatom pravoj funkciji:\n' + poziv.body.subject + '\n' + poziv.body.body);
  });


  /* ---- T14 F3: prilog (faktura PDF/slika) uz stavku troska ---- */
  section('T14 prilog uz trosak');

  function fakeFile(name, sizeBytes, dataUrl) {
    return {
      name, size: sizeBytes,
      _dataUrl: dataUrl || 'data:application/pdf;base64,JVBERi0xLjQK',
    };
  }
  /* simulira klik na uploadTrosakPrilog: napravi <input type=file>, uhvati onchange, "izaberi" fajl */
  function simulirajUpload(app, trId, file) {
    app.run(`ROLE='all'; uploadTrosakPrilog(${JSON.stringify(trId)});`);
    const inp = app.g.document._created.filter(c => c.tagName === 'INPUT' && c.type === 'file').pop();
    if (!inp) throw new Error('input[type=file] nije kreiran');
    inp.files = [file];
    // FileReader stub u dom-stub.js cita 'data:,' fiksno — patch je po potrebi
    inp.onchange({ target: inp });
  }

  await acheck('upload priloga: file > 2.5MB je odbijen', async () => {
    const t = app.run('DATA.troskovi_st[0]');
    const pre = app.run(`DATA.troskovi_st.find(x=>x.id===${JSON.stringify(t.id)}).prilog`);
    simulirajUpload(app, t.id, fakeFile('faktura.pdf', 3 * 1024 * 1024));
    const post = app.run(`DATA.troskovi_st.find(x=>x.id===${JSON.stringify(t.id)}).prilog`);
    if (JSON.stringify(post) !== JSON.stringify(pre)) throw new Error('prevelik fajl je ipak prihvacen');
  });

  await acheck('uploadTrosakPrilog je guardovan (rukovodilac ne moze)', async () => {
    const t = app.run('DATA.troskovi_st[0]');
    const ruk4 = app.run("DATA.zaposleni.filter(z=>/[Rr]ukovodilac/.test(z.poz)).map(z=>z.id)[0]");
    app.run(`ROLE=${JSON.stringify(ruk4)};`);
    const preN = app.g.document._created.length;
    app.run(`uploadTrosakPrilog(${JSON.stringify(t.id)});`);
    app.run("ROLE='all';");
    const kreiran = app.g.document._created.slice(preN).some(c => c.tagName === 'INPUT' && c.type === 'file');
    if (kreiran) throw new Error('rukovodilac je uspeo da otvori file picker za prilog');
  });

  await acheck('otvoriTrosakPrilog / ukloniTrosakPrilog su guardovani', async () => {
    const t = app.run('DATA.troskovi_st[0]');
    app.run(`(()=>{ DATA.troskovi_st.find(x=>x.id===${JSON.stringify(t.id)}).prilog = {name:'x.pdf', datum:todayStr(), data:'data:application/pdf;base64,AAA='}; })()`);
    const ruk5 = app.run("DATA.zaposleni.filter(z=>/[Rr]ukovodilac/.test(z.poz)).map(z=>z.id)[0]");
    const preOpen = app.g._calls.open.length;
    app.run(`ROLE=${JSON.stringify(ruk5)}; otvoriTrosakPrilog(${JSON.stringify(t.id)});`);
    if (app.g._calls.open.length > preOpen) throw new Error('rukovodilac je otvorio prilog uz trosak');
    app.run(`ukloniTrosakPrilog(${JSON.stringify(t.id)});`);
    app.run("ROLE='all';");
    const stillThere = app.run(`!!DATA.troskovi_st.find(x=>x.id===${JSON.stringify(t.id)}).prilog`);
    if (!stillThere) throw new Error('rukovodilac je uspeo da obrise prilog');
    app.run(`delete DATA.troskovi_st.find(x=>x.id===${JSON.stringify(t.id)}).prilog;`);
  });

  await acheck('prilog se prikazuje u fioci gradilista', async () => {
    const t = app.run('DATA.troskovi_st[0]');
    app.run(`(()=>{ DATA.troskovi_st.find(x=>x.id===${JSON.stringify(t.id)}).prilog = {name:'racun-t14.pdf', datum:todayStr(), data:'data:application/pdf;base64,AAA='}; })()`);
    app.run(`ROLE='all'; openSite(${JSON.stringify(t.gr)});`);
    const drawer = app.g.document.getElementById('drawer').innerHTML;
    if (!drawer.includes('racun-t14.pdf')) throw new Error('naziv priloga nije prikazan u fioci');
    app.run(`delete DATA.troskovi_st.find(x=>x.id===${JSON.stringify(t.id)}).prilog; current='dash'; render();`);
  });

  await acheck('prilog ne curi HTML kroz naziv fajla (esc na upisu)', async () => {
    const t = app.run('DATA.troskovi_st[0]');
    simulirajUpload(app, t.id, fakeFile('<img src=x onerror=xss()>.pdf', 100));
    const naziv = app.run(`DATA.troskovi_st.find(x=>x.id===${JSON.stringify(t.id)}).prilog?.name`);
    app.run(`ROLE='all'; openSite(${JSON.stringify(t.gr)});`);
    const drawer = app.g.document.getElementById('drawer').innerHTML;
    app.run("current='dash'; render();");
    if (naziv && naziv.includes('<img')) throw new Error('sirov payload u nazivu fajla: ' + naziv);
    if (drawer.includes('<img src=x onerror=')) throw new Error('zivi payload u fioci preko naziva fajla priloga');
    app.run(`delete DATA.troskovi_st.find(x=>x.id===${JSON.stringify(t.id)}).prilog;`);
  });


  /* ---- T13 F1: sabloni faza za Izvodjenje ---- */
  section('T13 sabloni faza (Izvodjenje)');

  await acheck('SABLONI_FAZA pokriva oba tipa izvodjenja', async () => {
    const keys = app.run('Object.keys(SABLONI_FAZA)');
    if (!keys.includes('visokogradnja') || !keys.includes('niskogradnja'))
      throw new Error('nedostaje tip: ' + keys.join(', '));
    const prazne = app.run(`Object.entries(SABLONI_FAZA).filter(([k,v])=>!v.length||v.some(f=>!f.faza||!f.zadaci.length)).map(([k])=>k)`);
    if (prazne.length) throw new Error('prazna faza/zadaci u: ' + prazne.join(', '));
  });

  await acheck('primeniSablonFaza seje zadatke sa rastucim rokovima unutar [pocetak,rok]', async () => {
    const gid = 'g_t13a';
    app.run(`(()=>{ DATA.gradilista.push({id:${JSON.stringify(gid)}, modul:'izvodjenje', tip:'visokogradnja', naziv:'T13 test',
      lok:'x', klijent:DATA.clijenti[0].id, rukovodilac:DATA.zaposleni[0].id, pocetak:'2026-01-01', rok:'2026-09-01',
      napredak:0, status:'planirano', faza:'Priprema terena', budzet:1000, troskovi:800, potroseno:0, naplaceno:0, adm:{}});
      rebuildMaps(); })()`);
    app.run(`ROLE='all'; primeniSablonFaza(${JSON.stringify(gid)});`);
    const zad = app.run(`DATA.zadaci.filter(t=>t.gr===${JSON.stringify(gid)})`);
    if (!zad.length) throw new Error('nijedan zadatak nije zaseiat');
    const rokovi = zad.map(t => t.rok);
    const sorted = [...rokovi].sort();
    if (JSON.stringify(rokovi.slice().sort()) !== JSON.stringify(sorted))
      throw new Error('interno neproverivo'); // no-op guard
    const van = zad.filter(t => t.rok < '2026-01-01' || t.rok > '2026-09-01');
    if (van.length) throw new Error('rok van opsega gradilista: ' + van.map(t => t.rok).join(', '));
    // rokovi ne opadaju kroz faze (monotono neopadajuci po redosledu faza)
    const brojFaza = app.run("SABLONI_FAZA.visokogradnja.length");
    if (zad.length < brojFaza) throw new Error('manje zadataka nego faza: ' + zad.length);
  });

  await acheck('primeniSablonFaza je no-op za Projektovanje', async () => {
    const gid = app.run(`DATA.gradilista.find(g=>jePro(g)).id`);
    const pre = app.run('DATA.zadaci.length');
    const n = app.run(`ROLE='all'; primeniSablonFaza(${JSON.stringify(gid)})`);
    const post = app.run('DATA.zadaci.length');
    if (n !== 0 || post !== pre) throw new Error(`n=${n}, zadaci ${pre}->${post} (ocekivano bez promene)`);
  });

  await acheck('primeniSablonFaza je role-guardovano (rukovodilac ne moze)', async () => {
    const ruk3 = app.run("DATA.zaposleni.filter(z=>/[Rr]ukovodilac/.test(z.poz)).map(z=>z.id)[0]");
    const gid = app.run(`DATA.gradilista.filter(g=>g.rukovodilac===${JSON.stringify(ruk3)}&&!jePro(g))[0]?.id`);
    if (!gid) return;
    const pre = app.run('DATA.zadaci.length');
    app.run(`ROLE=${JSON.stringify(ruk3)}; primeniSablonFaza(${JSON.stringify(gid)});`);
    const post = app.run('DATA.zadaci.length');
    app.run("ROLE='all';");
    if (post !== pre) throw new Error(`rukovodilac je uspeo da zaseje sablon: ${pre}->${post}`);
  });

  await acheck('ubaciSablonFaza guardovano vlasnistvom (koristi isDirector unutar primeniSablonFaza)', async () => {
    const gid = 'g_t13b';
    app.run(`(()=>{ DATA.gradilista.push({id:${JSON.stringify(gid)}, modul:'izvodjenje', tip:'niskogradnja', naziv:'T13 niska',
      lok:'x', klijent:DATA.clijenti[0].id, rukovodilac:null, pocetak:todayStr(), rok:plusDays(90),
      napredak:0, status:'planirano', faza:'Priprema terena', budzet:1000, troskovi:800, potroseno:0, naplaceno:0, adm:{}});
      rebuildMaps(); })()`);
    const pre = app.run('DATA.zadaci.length');
    app.run(`ROLE='all'; ubaciSablonFaza(${JSON.stringify(gid)});`);
    const post = app.run('DATA.zadaci.length');
    const brojFazaNiska = app.run("SABLONI_FAZA.niskogradnja.reduce((a,f)=>a+f.zadaci.length,0)");
    if (post - pre !== brojFazaNiska) throw new Error(`upisano ${post-pre}, ocekivano ${brojFazaNiska}`);
  });

  await acheck('formUpdate koristi fazeZa() konzistentno sa sablonom', async () => {
    const gid = app.run(`DATA.gradilista.find(g=>!jePro(g)&&g.tip==='visokogradnja').id`);
    const fazeUForm = app.run(`fazeZa(grById[${JSON.stringify(gid)}])`);
    const fazeUSablonu = app.run("[...SABLONI_FAZA.visokogradnja.map(f=>f.faza),'Predato']");
    if (JSON.stringify(fazeUForm) !== JSON.stringify(fazeUSablonu))
      throw new Error('formUpdate i sablon se raziliaze:\n' + fazeUForm.join(',') + '\nvs\n' + fazeUSablonu.join(','));
  });

  await acheck('novo gradiliste (Izvodjenje) kroz saveSite seje sablon kad je checkbox cekiran', async () => {
    app.run("ROLE='all'; formSite();");
    const set = (id, val) => { const e = app.g.document.getElementById(id); if (e) e.value = val; };
    set('f_naziv', 'Test sejanja'); set('f_modul', 'izvodjenje'); set('f_tip', 'niskogradnja');
    set('f_lok', 'Beograd'); set('f_cena', '100000'); set('f_tro', '80000');
    set('f_ruk', app.run('DATA.zaposleni[0].id'));
    set('f_poc', app.run('todayStr()')); set('f_rok', app.run('plusDays(200)'));
    const cb = app.g.document.getElementById('f_faze_fill'); if (cb) cb.checked = true;
    const preG = app.run('DATA.gradilista.length'), preZ = app.run('DATA.zadaci.length');
    app.run('saveSite();');
    const postG = app.run('DATA.gradilista.length'), postZ = app.run('DATA.zadaci.length');
    if (postG !== preG + 1) throw new Error('gradiliste nije dodato');
    if (postZ <= preZ) throw new Error('sablon faza nije zaseiao nijedan zadatak pri kreiranju');
  });


  /* ---- T12 racunska ispravnost i otpornost prikaza ---- */
  section('T12 brojevi i otpornost');

  await acheck('marzaPct ne vraca NaN/Infinity kad je budzet 0', async () => {
    const r = app.run("marzaPct({budzet:0, troskovi:0})");
    const r2 = app.run("marzaPct({budzet:0, troskovi:100})");
    if (!Number.isFinite(r) || !Number.isFinite(r2))
      throw new Error(`budzet 0 -> ${r} / ${r2} (renderuje se kao "NaN%" i "Marža pala na -Infinity%")`);
  });

  await acheck('fmtEurK ispravno prikazuje negativne iznose', async () => {
    const a = app.run('fmtEurK(-2000000)'), b = app.run('fmtEurK(2000000)');
    if (!/^€-2[.,]00M$/.test(a)) throw new Error(`fmtEurK(-2000000) = ${a}, ocekivano oblik €-2,00M (dobija se "${a}")`);
    if (!/M$/.test(b)) throw new Error('fmtEurK(2000000) = ' + b);
  });

  await acheck('kontrolna tabla se ne rusi na unos nepoznatog autora', async () => {
    const gid = app.run('DATA.gradilista[0].id');
    app.run(`DATA.dnevnik.push({id:'d_t12', datum:todayStr(), gr:${JSON.stringify(gid)}, autor:'z-nepostojeci', tekst:'unos'});`);
    let err = null;
    try { app.run("ROLE='all'; MODUL='sve'; current='dash'; render();"); } catch (e) { err = e.message; }
    app.run("DATA.dnevnik = DATA.dnevnik.filter(d=>d.id!=='d_t12'); render();");
    if (err) throw new Error('render pukao -> cela kontrolna tabla prazna: ' + err);
  });

  await acheck('kartice gradilista podnose jednoclano ime rukovodioca', async () => {
    app.run(`(()=>{ DATA.zaposleni.push({id:'z_t12', ime:'Marko', poz:'Rukovodilac gradilišta', grs:[], bivsi:[], status:'Na terenu', tel:'060'});
      DATA.gradilista.push({id:'g_t12', modul:'izvodjenje', tip:'visokogradnja', naziv:'Test jednoclano', lok:'x', klijent:DATA.clijenti[0].id,
        rukovodilac:'z_t12', pocetak:todayStr(), rok:plusDays(30), napredak:10, status:'u toku', faza:'x', budzet:1000, troskovi:800, potroseno:0, naplaceno:0, adm:{}});
      rebuildMaps(); })()`);
    let err = null;
    try { app.run("ROLE='all'; current='sites'; render();"); } catch (e) { err = e.message; }
    app.run(`(()=>{ DATA.zaposleni=DATA.zaposleni.filter(z=>z.id!=='z_t12'); DATA.gradilista=DATA.gradilista.filter(g=>g.id!=='g_t12');
      rebuildMaps(); current='dash'; render(); })()`);
    if (err) throw new Error('tab Gradilista pukao: ' + err);
  });

  await acheck('uvoz: cena "1.234,50" i kolicina "1.250" iz Excela', async () => {
    const gid = app.run('DATA.gradilista[0].id');
    app.g.document.getElementById('f_pm_paste').value = 'Beton;m3;1.250;1.234,50';
    app.run(`ROLE='all'; savePredmerImport(${JSON.stringify(gid)});`);
    const r = app.run('DATA.predmer[DATA.predmer.length-1]');
    if (r.kol !== 1250) throw new Error('kolicina = ' + r.kol + ', ocekivano 1250');
    if (r.cena !== 1234.5) throw new Error('cena = ' + r.cena + ', ocekivano 1234.5 (hiljade se ne skidaju kao kod kolicine)');
  });

  await acheck('uvoz: engleski zapis "12.5" nije 125', async () => {
    const gid = app.run('DATA.gradilista[0].id');
    app.g.document.getElementById('f_pm_paste').value = 'Malterisanje;m2;12.5;10';
    app.run(`ROLE='all'; savePredmerImport(${JSON.stringify(gid)});`);
    const r = app.run('DATA.predmer[DATA.predmer.length-1]');
    if (r.kol !== 12.5) throw new Error('kolicina = ' + r.kol + ', ocekivano 12.5');
  });

  await acheck('setIzv prihvata srpski decimalni zapis', async () => {
    const pid = app.run('DATA.predmer[0].id');
    app.run(`ROLE='all'; setIzv(${JSON.stringify(pid)}, '1.234,5');`);
    const izv = app.run(`DATA.predmer.find(r=>r.id===${JSON.stringify(pid)}).izv`);
    if (izv === 0) throw new Error('vrednost tiho obrisana (izv=0) umesto 1234.5');
  });

  await acheck('setIzv ne dozvoljava izvedeno iznad ugovorenog', async () => {
    const p0 = app.run('DATA.predmer[0]');
    app.run(`ROLE='all'; setIzv(${JSON.stringify(p0.id)}, 999999);`);
    const izv = app.run(`DATA.predmer.find(r=>r.id===${JSON.stringify(p0.id)}).izv`);
    app.run(`setIzv(${JSON.stringify(p0.id)}, ${p0.izv || 0});`);
    if (izv > p0.kol) throw new Error(`izv=${izv} > ugovoreno ${p0.kol} — CSV i kumulativ prijavljuju netacnu kolicinu`);
  });

  await acheck('serijski uvoz ne pravi duple ID-eve', async () => {
    const gid = app.run('DATA.gradilista[0].id');
    const red = Array.from({ length: 40 }, (_, i) => `Pozicija ${i};m2;1;1`).join('\n');
    app.g.document.getElementById('f_pm_paste').value = red;
    app.run(`ROLE='all'; savePredmerImport(${JSON.stringify(gid)});`);
    app.g.document.getElementById('f_pm_paste').value = red;
    app.run(`savePredmerImport(${JSON.stringify(gid)});`);
    const dup = app.run(`(()=>{const ids=DATA.predmer.map(r=>r.id); const s=new Set(ids); return ids.length-s.size;})()`);
    if (dup > 0) throw new Error(dup + ' duplih ID-eva — setIzv bi menjao pogresan red, upsert bi ih spojio');
  });

  await acheck('jutarnji brif postuje filter modula', async () => {
    app.run("ROLE='all'; MODUL='projektovanje'; PODTIP='sve'; current='dash'; render();");
    const dash = app.g.document.getElementById('view').innerHTML;
    const ukupnoPro = app.run(`(()=>{const ids=visibleSiteIds();
      return (DATA.situacije||[]).filter(x=>ids.has(x.gr)&&x.status!=='placeno'&&sitKasni(x)).reduce((a,b)=>a+b.iznos,0);})()`);
    const svihModula = app.run(`(DATA.situacije||[]).filter(x=>x.status!=='placeno'&&sitKasni(x)).reduce((a,b)=>a+b.iznos,0)`);
    app.run("MODUL='sve'; current='dash'; render();");
    if (ukupnoPro === svihModula) return;                       // nema razlike u demo podacima
    const pogresan = app.run(`fmtEurK(${svihModula})`);
    if (dash.includes(pogresan))
      throw new Error(`brif prikazuje ${pogresan} (svi moduli) umesto iznosa za Projektovanje`);
  });

  await acheck('magacin: stanje kao string ne pravi nadovezivanje', async () => {
    app.run(`(()=>{ DATA.magacin.push({id:'m_t12', naziv:'Test', jm:'kom', stanje:'18'}); })()`);
    app.g.document.getElementById('f_mpkol').value = '5';
    app.run("ROLE='all'; saveMagPromena('m_t12','ulaz');");
    const st = app.run("DATA.magacin.find(m=>m.id==='m_t12').stanje");
    app.run("DATA.magacin = DATA.magacin.filter(m=>m.id!=='m_t12');");
    if (st !== 23) throw new Error('stanje = ' + JSON.stringify(st) + ', ocekivano 23 (dobija se "185" nadovezivanjem)');
  });

  await acheck('predmer ostaje otvoren kad se promeni modul', async () => {
    const gid = app.run('DATA.gradilista[0].id');
    app.run(`ROLE='all'; openPredmer(${JSON.stringify(gid)}); renderNav();`);
    const cur = app.run('current');
    app.run("current='dash'; render();");
    if (cur !== 'predmer') throw new Error("renderNav() vraca korisnika na 'dash' iz predmera (current=" + cur + ')');
  });


  /* ---- T11 vlasnistvo: rukovodilac ne sme da dira TUDJE gradiliste ----
     Pravilo 2 iz CLAUDE.md. Raniji T5 je zvao mutacije sa PRAZNOM formom, pa su
     padale na validaciji naziva i test je lazno prolazio. Ovde se forma popuni
     validnim podacima, a ciljno gradiliste je tudje. */
  section('T11 vlasnistvo (tudje gradiliste)');

  const ruk2 = app.run("DATA.zaposleni.filter(z=>/[Rr]ukovodilac/.test(z.poz)).map(z=>z.id)[0]");
  const mojeG = app.run(`DATA.gradilista.filter(g=>g.rukovodilac===${JSON.stringify(ruk2)}).map(g=>g.id)[0]`);
  const tudjeG = app.run(`DATA.gradilista.filter(g=>g.rukovodilac && g.rukovodilac!==${JSON.stringify(ruk2)}).map(g=>g.id)[0]`);
  if (!mojeG || !tudjeG) bad('T11 priprema', 'nema para svoje/tudje gradiliste u DEMO');

  const kaoRuk = (code) => app.run(`(()=>{ const _p=ROLE; ROLE=${JSON.stringify(ruk2)}; try{ return (${code}); } finally { ROLE=_p; } })()`);

  await acheck('saveTask ne upisuje zadatak na tudje gradiliste', async () => {
    app.run(`ROLE=${JSON.stringify(ruk2)};`);
    app.run('formTask();');
    const html = app.g.document.getElementById('modal').innerHTML;
    for (const m of html.matchAll(/<(input|textarea|select)\b([^>]*)>/gi)) {
      const idm = /\bid=["']?([A-Za-z0-9_]+)/.exec(m[2]); if (!idm) continue;
      app.g.document.getElementById(idm[1]).value = 'Zadatak';
    }
    app.g.document.getElementById('f_tgr').value = tudjeG;      // tudje gradiliste
    app.g.document.getElementById('f_tprio').value = 'mid';
    app.g.document.getElementById('f_trok').value = app.run('todayStr()');
    const pre = app.run('DATA.zadaci.length');
    app.run('saveTask();');
    const post = app.run('DATA.zadaci.length');
    app.run("ROLE='all';");
    if (post !== pre) {
      const z = app.run('DATA.zadaci[DATA.zadaci.length-1]');
      throw new Error('zadatak upisan na tudje gradiliste: gr=' + z.gr);
    }
  });

  await acheck('saveDiary ne upisuje u tudji dnevnik niti pod tudjim imenom', async () => {
    app.run(`ROLE=${JSON.stringify(ruk2)};`);
    app.run('formDiary();');
    const html = app.g.document.getElementById('modal').innerHTML;
    for (const m of html.matchAll(/<(input|textarea|select)\b([^>]*)>/gi)) {
      const idm = /\bid=["']?([A-Za-z0-9_]+)/.exec(m[2]); if (!idm) continue;
      app.g.document.getElementById(idm[1]).value = 'Tekst unosa u dnevnik';
    }
    app.g.document.getElementById('f_dgr').value = tudjeG;
    app.g.document.getElementById('f_ddatum').value = app.run('todayStr()');
    const tudjiAutor = app.run(`DATA.zaposleni.filter(z=>z.id!==${JSON.stringify(ruk2)})[0].id`);
    app.g.document.getElementById('f_dautor').value = tudjiAutor;
    const pre = app.run('DATA.dnevnik.length');
    app.run('saveDiary();');
    const post = app.run('DATA.dnevnik.length');
    const zadnji = post > pre ? app.run('DATA.dnevnik[DATA.dnevnik.length-1]') : null;
    app.run("ROLE='all';");
    if (zadnji && zadnji.gr === tudjeG) throw new Error('unos u dnevnik tudjeg gradilista: gr=' + zadnji.gr);
    if (zadnji && zadnji.autor === tudjiAutor) throw new Error('unos potpisan tudjim imenom: autor=' + zadnji.autor);
  });

  await acheck('dropTask ne pomera tudji zadatak', async () => {
    const tz = app.run(`DATA.zadaci.filter(t=>t.gr===${JSON.stringify(tudjeG)})[0]`);
    if (!tz) return;  // nema takvog zadatka u demo podacima
    const pre = tz.kol;
    const nova = pre === 'done' ? 'todo' : 'done';
    app.run(`ROLE=${JSON.stringify(ruk2)}; dragStart({dataTransfer:{}}, ${JSON.stringify(tz.id)}); dropTask({preventDefault(){}}, ${JSON.stringify(nova)});`);
    const posle = app.run(`DATA.zadaci.find(t=>t.id===${JSON.stringify(tz.id)}).kol`);
    app.run("ROLE='all';");
    if (posle !== pre) throw new Error(`tudji zadatak pomeren ${pre} -> ${posle}`);
  });

  await acheck('dropTask odbija nepostojecu kolonu', async () => {
    const tm = app.run(`DATA.zadaci.filter(t=>t.gr===${JSON.stringify(mojeG)})[0]`);
    if (!tm) return;
    const pre = tm.kol;
    app.run(`ROLE=${JSON.stringify(ruk2)}; dragStart({dataTransfer:{}}, ${JSON.stringify(tm.id)}); dropTask({preventDefault(){}}, 'ne-postoji');`);
    const posle = app.run(`DATA.zadaci.find(t=>t.id===${JSON.stringify(tm.id)}).kol`);
    app.run("ROLE='all';");
    if (posle !== pre) throw new Error(`zadatak zavrsio u nepostojecoj koloni: ${posle}`);
  });

  await acheck('saveMagPromena odbija nepoznat tip (ne obara stanje)', async () => {
    const mid = app.run('DATA.magacin[0].id');
    const pre = app.run('DATA.magacin[0].stanje');
    app.g.document.getElementById('f_mpkol').value = '9999';
    app.run(`ROLE=${JSON.stringify(ruk2)}; saveMagPromena(${JSON.stringify(mid)}, 'bilo-sta');`);
    const posle = app.run('DATA.magacin[0].stanje');
    app.run("ROLE='all';");
    if (posle !== pre) throw new Error(`stanje ${pre} -> ${posle} kroz nepoznat tip promene`);
  });

  section('T11b izolacija gradilista (citanje)');

  await acheck('openSite ne otvara tudje gradiliste', async () => {
    app.g.document.getElementById('drawer').innerHTML = '';
    kaoRuk(`openSite(${JSON.stringify(tudjeG)}), 1`);
    const d = app.g.document.getElementById('drawer').innerHTML || '';
    if (d.length > 200) throw new Error('fioka otvorena za tudje gradiliste (' + d.length + ' znakova)');
  });

  await acheck('openIzvestaj ne radi za tudje gradiliste', async () => {
    const pre = app.g._calls.open.length;
    // openIzvestaj renderuje u #rpt (ranije je test gledao nepostojeci #izvestajWrap i prolazio vakuumski)
    app.g.document.getElementById('rpt').innerHTML = '';
    kaoRuk(`openIzvestaj(${JSON.stringify(tudjeG)}), 1`);
    const sadrzaj = app.g.document.getElementById('rpt').innerHTML || '';
    if (app.g._calls.open.length > pre || sadrzaj.length > 200)
      throw new Error('izvestaj generisan za tudje gradiliste');
  });

  await acheck('posaljiMejlNabavci ne salje tudje trebovanje', async () => {
    const tn = app.run(`(DATA.narudzbe||[]).filter(n=>n.gr===${JSON.stringify(tudjeG)})[0]`);
    if (!tn) return;
    const pre = app.g._calls.open.length;
    kaoRuk(`posaljiMejlNabavci(${JSON.stringify(tn.id)}), 1`);
    if (app.g._calls.open.length > pre)
      throw new Error('otvoren mailto za tudje trebovanje: ' + app.g._calls.open[app.g._calls.open.length - 1].slice(0, 120));
  });

  await acheck('openEmpPage ne otvara punu karticu rukovodiocu', async () => {
    const zid = app.run(`DATA.zaposleni.filter(z=>z.id!==${JSON.stringify(ruk2)})[0].id`);
    app.run(`ROLE=${JSON.stringify(ruk2)}; openEmpPage(${JSON.stringify(zid)});`);
    const cur = app.run('current');
    app.run("ROLE='all'; current='dash'; render();");
    if (cur === 'empPage') throw new Error('rukovodilac otvorio punu karticu zaposlenog');
  });

  await acheck('viewPay/viewClients pozvani direktno ne odaju finansije', async () => {
    const leaks = [];
    for (const fn of ['viewPay', 'viewClients']) {
      const html = kaoRuk(`${fn}()`) || '';
      const hit = FIN_TERMS.filter(t => html.includes(t));
      if (hit.length) leaks.push(`${fn}: ${hit.join(', ')}`);
    }
    if (leaks.length) throw new Error(leaks.join('\n'));
  });

  await acheck('upozorenja ne pominju tudja gradilista', async () => {
    const nazivi = app.run(`DATA.gradilista.filter(g=>g.rukovodilac && g.rukovodilac!==${JSON.stringify(ruk2)}).map(g=>g.naziv)`);
    const al = kaoRuk('JSON.stringify(computeAlerts())');
    const hit = nazivi.filter(n => al.includes(n));
    if (hit.length) throw new Error('tudja gradilista u upozorenjima: ' + hit.join(', '));
  });

  await acheck('viewResursi ne prikazuje resurse tudjih gradilista', async () => {
    const nazivi = app.run(`DATA.gradilista.filter(g=>g.rukovodilac && g.rukovodilac!==${JSON.stringify(ruk2)}).map(g=>g.naziv)`);
    const html = kaoRuk('viewResursi()') || '';
    const hit = nazivi.filter(n => html.includes(n));
    if (hit.length) throw new Error('tudja gradilista u resursima: ' + hit.join(', '));
  });


  /* ---- T10 sloj cuvanja (Supabase mock) ----
     Konstante SUPABASE_URL/KEY su u repou namerno prazne; boot({supabase:true})
     ih privremeno popuni i podmetne mock klijenta. */
  section('T10 Supabase: ucitavanje i sejanje');

  await acheck('prazna baza -> zaseje se demo u svih 13 tabela', async () => {
    const a = await boot({ supabase: true, seed: {} });
    if (a.run('mode') !== 'supabase') throw new Error("mode = " + a.run('mode'));
    const prazne = a.run('TABLES').filter(t => a.g.__mock._count(t) === 0);
    if (prazne.length) throw new Error('nezasejane tabele: ' + prazne.join(', '));
  });

  await acheck('puna baza -> ucita se, demo se NE upisuje', async () => {
    const seed = {
      gradilista: [{ id: 'gX', naziv: 'Stvarni projekat', modul: 'izvodjenje', tip: 'visokogradnja', lok: 'Beograd', klijent: 'cX', rukovodilac: null, pocetak: '2026-01-01', rok: '2026-12-31', napredak: 10, status: 'u toku', faza: 'Pripremni radovi', budzet: 100000, troskovi: 80000, potroseno: 10000, naplaceno: 0, adm: {} }],
      clijenti: [{ id: 'cX', naziv: 'Stvarni klijent' }],
      zaposleni: [], zadaci: [], dnevnik: [], situacije: [], narudzbe: [],
      troskovi_st: [], podizvodjaci: [], predmer: [], resursi: [], magacin: [], mag_promene: [],
    };
    const a = await boot({ supabase: true, seed });
    const nazivi = a.run('DATA.gradilista.map(g=>g.naziv)');
    if (!nazivi.includes('Stvarni projekat')) throw new Error('nije ucitano iz baze: ' + JSON.stringify(nazivi));
    if (nazivi.length !== 1) throw new Error('demo je pregazio bazu: ' + JSON.stringify(nazivi));
  });

  /* V1 — detekcija "prvog starta" gleda samo gradilista */
  await acheck('baza sa klijentima ali bez gradilista se NE gazi demom', async () => {
    const seed = {
      gradilista: [],
      clijenti: [{ id: 'cX', naziv: 'Stvarni klijent koji ne sme nestati' }],
      zaposleni: [{ id: 'zX', ime: 'Stvarni radnik', poz: 'Zidar', grs: [], bivsi: [] }],
      zadaci: [], dnevnik: [], situacije: [], narudzbe: [],
      troskovi_st: [], podizvodjaci: [], predmer: [], resursi: [], magacin: [], mag_promene: [],
    };
    const a = await boot({ supabase: true, seed });
    const kli = a.g.__mock._db.clijenti.map(c => c.naziv);
    if (!kli.includes('Stvarni klijent koji ne sme nestati'))
      throw new Error('stvarni klijent obrisan/pregazen; u bazi: ' + JSON.stringify(kli));
    if (kli.length > 1)
      throw new Error('demo klijenti dodati preko stvarnih: ' + JSON.stringify(kli));
  });

  section('T10b Supabase: greske i vidljivost');

  /* K2 — prazan <input type=date> salje '' u date kolonu */
  await acheck('prazan datum se upisuje kao null, ne kao ""', async () => {
    const a = await boot();
    a.run("ROLE='all'; formTask();");
    const html = a.g.document.getElementById('modal').innerHTML;
    for (const m of html.matchAll(/<(input|textarea|select)\b([^>]*)>/gi)) {
      const idm = /\bid=["']?([A-Za-z0-9_]+)/.exec(m[2]); if (!idm) continue;
      const type = (/\btype=["']?([a-z]+)/i.exec(m[2]) || [, 'text'])[1];
      const el = a.g.document.getElementById(idm[1]);
      if (type === 'date') el.value = '';                       // korisnik obrisao rok
      else if (m[1].toLowerCase() === 'select') {
        const rest = html.slice(m.index);
        const om = /<option[^>]*\bvalue=["']([^"']*)["']/i.exec(rest.slice(0, rest.indexOf('</select>') + 9));
        el.value = om ? om[1] : '';
      } else el.value = 'Zadatak bez roka';
    }
    a.run('saveTask();');
    const rok = a.run('DATA.zadaci[DATA.zadaci.length-1].rok');
    if (rok === '') throw new Error('rok je prazan string -> Postgres odbija ceo upsert (22007)');
    if (!(rok === null || (typeof rok === 'string' && rok.length === 10)))
      throw new Error('neocekivan rok: ' + JSON.stringify(rok));
  });

  await acheck('prazan datum u DATA ne obara ceo lanac cuvanja', async () => {
    const a = await boot({ supabase: true, seed: {} });
    a.run("DATA.zadaci[0].rok=''; DATA.magacin.push({id:'mZ', naziv:'Posle zadataka', jm:'kom', stanje:1});");
    await a.run('doSave()');
    for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r));
    // magacin dolazi POSLE zadaci u TABLES — ne sme da ostane neupisan
    const ids = (a.g.__mock._db.magacin || []).map(m => m.id);
    if (!ids.includes('mZ'))
      throw new Error('tabele posle prve greske nisu upisane (magacin: ' + JSON.stringify(ids) + ')');
  });

  /* V5 — neuspelo cuvanje mora biti vidljivo */
  await acheck('neuspelo cuvanje je vidljivo korisniku (footer)', async () => {
    const a = await boot({ supabase: true, seed: {} });
    a.g.__mock._faults.upsertFail = { zadaci: 'nema veze sa mrezom' };
    a.run("DATA.zadaci.push({id:'tZ', gr:DATA.gradilista[0].id, zad:'x', kol:'todo', prio:'mid', rok:todayStr()});");
    await a.run('doSave()');
    for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r));
    a.run('updateFoot()');
    const foot = a.g.document.getElementById('sideFoot').innerHTML || '';
    if (/izmene se cuvaju u bazi|izmene se čuvaju u bazi/i.test(foot) && !/nije|gre[sš]k/i.test(foot))
      throw new Error('footer i dalje tvrdi da je sve sacuvano: ' + foot.replace(/<[^>]+>/g, ' ').trim().slice(0, 120));
  });

  section('T10c Supabase: brisanje i reset');

  /* K3 — pushAll radi samo upsert */
  await acheck('obrisan red lokalno nestaje i iz baze', async () => {
    const a = await boot({ supabase: true, seed: {} });
    const id = a.run('DATA.zadaci[0].id');
    await a.run("obrisiRed('zadaci',"+JSON.stringify(id)+")");
    for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r));
    const still = (a.g.__mock._db.zadaci || []).some(z => z.id === id);
    if (still) throw new Error('red ' + id + ' i dalje u bazi — pushAll nikad ne brise');
  });

  /* K1 — resetDemo prvo obrise sve, pa seje */
  await acheck('neuspeo reset ne ostavlja praznu bazu', async () => {
    const a = await boot({ supabase: true, seed: {} });
    a.g.__mock._faults.upsertFail = { gradilista: 'pukla mreza' };
    const preClijenti = a.g.__mock._count('clijenti');
    if (!preClijenti) throw new Error('priprema: baza nije zasejana');
    await a.run('resetDemo()');
    for (let i = 0; i < 8; i++) await new Promise(r => setImmediate(r));
    const posle = a.g.__mock._count('clijenti');
    if (posle === 0)
      throw new Error('reset je obrisao bazu pa pukao na upisu — podaci izgubljeni (clijenti: 0)');
  });

  /* S2 — normalizeData se ne poziva posle reseta */
  await acheck('posle reseta su adm polja normalizovana', async () => {
    const a = await boot({ supabase: true, seed: {} });
    await a.run('resetDemo()');
    for (let i = 0; i < 8; i++) await new Promise(r => setImmediate(r));
    const loši = a.run(`DATA.gradilista.filter(g=>Object.values(g.adm||{}).some(v=>typeof v!=='object'||v===null)).map(g=>g.id)`);
    if (loši.length) throw new Error('adm nije normalizovan posle reseta: ' + loši.join(', '));
  });

  /* N4 — napredak je int kolona */
  await acheck('napredak se upisuje kao ceo broj', async () => {
    const a = await boot();
    const gid = a.run('DATA.gradilista[0].id');
    a.run(`ROLE='all'; formUpdate(${JSON.stringify(gid)});`);
    a.g.document.getElementById('u_nap').value = '50.5';
    a.run(`saveUpdate(${JSON.stringify(gid)});`);
    const n = a.run(`grById[${JSON.stringify(gid)}].napredak`);
    if (!Number.isInteger(n)) throw new Error('napredak = ' + n + ' (int kolona u schema.sql)');
  });


  report();
})().catch(e => { console.error('\nHARNESS PUKAO:\n', e); process.exit(2); });

function report(){
  console.log('\n\n' + '='.repeat(60));
  if (failures.length) {
    console.log('PADOVI (' + failures.length + '):\n');
    failures.forEach((f, i) => console.log(`${i + 1}. ${f.name}\n   ${f.detail.replace(/\n/g, '\n   ')}\n`));
  }
  console.log(`Prošlo: ${pass}   Palo: ${fail}`);
  console.log('='.repeat(60));
  process.exit(fail ? 1 : 0);
}
