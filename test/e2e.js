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
     T6  finansijska izolacija: rukovodilac ne vidi cene/naplatu
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
  ['saveSituacija', "'g2'"], ['formSituacija', "'g2'"], ['markPaid', "'s1'"], ['saveEmp', ''], ['saveClient', ''],
  ['saveSite', ''], ['saveSite', "'g1'"], ['saveSub', ''], ['saveNarudzba', ''], ['saveTrosak', "'g1'"],
  ['saveArtikal', ''], ['saveResurs', 'null'], ['savePredmerRed', "'g1'"],
  ['savePredmerImport', "'g1'"], ['saveMagPromena', "'m1','ulaz'"],
  ['saveTask', ''], ['saveDiary', ''], ['obrisiDokument', "'dk_x'"],
  ['savePredmerRed', "'g5','pm1'"],
  ['saveEmp', "'z1'"], ['setAdmVazi', "'g1','polisa','2030-01-01'"],
  ['saveSifrarnik', ''], ['toggleSifrarnik', "'sf-a-001'"], ['obrisiSifrarnik', "'sf-a-001'"], ['saveIzSifarnika', "'g1'"],
  ['pocniZadatak', "'t3'"], ['pauzirajZadatak', "'t3'"], ['zavrsiZadatak', "'t3'"], ['obrisiStavku', "'zadaci','t1','x'"], ['obrisiZadatak', "'t1'"], ['obrisiUnosDnevnika', "'d2'"], ['obrisiTrosak', "'tr1'"],
  ['obrisiSituaciju', "'s1'"], ['obrisiPredmerRed', "'pm1'"], ['obrisiResurs', "'r1'"], ['obrisiNarudzbu', "'n1'"],
  ['obrisiKlijenta', "'c1'"], ['obrisiZaposlenog', "'z2'"], ['obrisiPodizvodjaca', "'p1'"], ['obrisiGradiliste', "'g2'"],
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
  /* 6 uloga (migracija 14): 'all' direktor, 'admin', '<z>' rukovodilac 2, '<z>:fin' rukovodilac 1, 'radnik:<z>', 'spoljni:<p>' — preko setRole() */
  const rukIds = app.run('DATA.zaposleni.filter(z=>/[Rr]ukovodilac/.test(z.poz)).map(z=>z.id)');
  const radnikId = app.run("(DATA.zaposleni.find(z=>!/[Rr]ukovodilac/.test(z.poz)&&(z.grs||[]).length)||{}).id");
  const spoljniId = app.run("((DATA.podizvodjaci||[]).find(p=>(p.grs||[]).length)||{}).id");
  const roles = ['all', 'admin', ...rukIds, ...rukIds.map(z => z + ':fin'), ...(radnikId ? ['radnik:' + radnikId] : []), ...(spoljniId ? ['spoljni:' + spoljniId] : [])];
  let combos = 0;
  const asymm = [];
  for (const role of roles) {
    for (const m of MODULI) {
      app.run(`setRole(${JSON.stringify(role)}); MODUL=${JSON.stringify(m.modul)}; PODTIP=${JSON.stringify(m.podtip)};`);
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
    ['situacija',  "formSituacija(DATA.predmer[0].gr)", "(function(){const g=DATA.predmer[0].gr; document.getElementById('st_k_'+predmerZa(g)[0].id).value='2'; saveSituacija(g);})()", 'situacije'],
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
  check('Excel izvoz (xlsx) nosi & i < kao prave znake i cita se nazad', () => {
    const gid = app.run('DATA.gradilista[0].id');
    app.run(`(()=>{ DATA.predmer.push({id:'pm_t9', gr:${JSON.stringify(gid)}, poz:esc('Beton & čelik <C25>'), jm:esc('m³'), kol:2, cena:100, izv:1, zaduzen:null, sifra:'9.9'}); })()`);
    app.run(`ROLE='all'; izvozPredmer(${JSON.stringify(gid)});`);
    const a = app.g.document._created.filter(c => c.tagName === 'A' && String(c.href).includes('spreadsheetml')).pop();
    if (!a || !/\.xlsx$/.test(String(a.download))) throw new Error('xlsx link nije napravljen: ' + (a && a.download));
    const xml = Buffer.from(String(a.href).split(',')[1], 'base64').toString('utf8');   // sirov XML u paketu (STORED zip, inline stringovi)
    if (xml.includes('&amp;amp;') || xml.includes('&amp;lt;') || !xml.includes('Beton &amp; čelik &lt;C25&gt;'))
      throw new Error('xlsx: HTML entiteti iz DATA nisu vraceni u prave znake pre XML escape-a: ' + (xml.match(/Beton[^<]*/) || [''])[0]);
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


  /* ---- T36 tajmer zadatka (C4) i angazovanost (C5) ---- */
  section('T36 tajmer i angazovanost');
  const T36_ZID = "(DATA.zaposleni.find(z=>!/[Rr]ukovodilac/.test(z.poz)&&(z.grs||[]).some(x=>grById[x]))||{}).id";
  const q36 = x => JSON.stringify(x);
  const PRO_TID = "DATA.zadaci.find(t=>grById[t.gr]&&jePro(grById[t.gr])).id";   // zadatak na gradilistu Projektovanja (tajmer samo tamo)
  await acheck('0) tajmer SAMO u Projektovanju: na zadatku Izvodjenja nema dugmadi, pocni/pauziraj/zavrsi su no-op', async () => {
    const a = await boot();
    const izv = a.run("DATA.zadaci.find(t=>grById[t.gr]&&!jePro(grById[t.gr])&&t.kol!=='done')");
    const pro = a.run("DATA.zadaci.find(t=>grById[t.gr]&&jePro(grById[t.gr])&&t.kol!=='done')");
    if (!izv || !pro) throw new Error('DEMO nema oba tipa zadatka');
    a.run("setRole('all'); MODUL='sve'; PODTIP='sve'; current='tasks'; render();");
    const h = a.g.document.getElementById('view').innerHTML;
    if (h.includes(`pocniZadatak('${izv.id}')`)) throw new Error('dugme tajmera na zadatku Izvodjenja');
    if (!h.includes(`pocniZadatak('${pro.id}')`)) throw new Error('nema dugmeta tajmera na zadatku Projektovanja');
    a.run(`pocniZadatak(${q36(izv.id)})`);
    if (a.run('DATA.rad_na_zadatku.length') !== 0) throw new Error('pocniZadatak je otvorio sesiju na Izvodjenju');
    if (a.run(`DATA.zadaci.find(t=>t.id===${q36(izv.id)}).kol`) !== izv.kol) throw new Error('kol promenjen');
    // nasledjena (zaglavljena) sesija na zadatku Izvodjenja (vise se ne prikazuje, odluka 2026-10-11): Zavrsi no-op,
    // a pocniZadatak na zadatku Projektovanja je automatski ZATVARA umesto da blokira
    a.run(`DATA.rad_na_zadatku.push({id:'rzx',zadatak:${q36(izv.id)},gr:${q36(izv.gr)},osoba:'uprava',start:new Date().toISOString(),kraj:null,minuta:null,napomena:''});`);
    a.run(`zavrsiZadatak(${q36(izv.id)})`);
    if (a.run("DATA.rad_na_zadatku[0].kraj") !== null || a.run(`DATA.zadaci.find(t=>t.id===${q36(izv.id)}).kol`) === 'done') throw new Error('zavrsi dirao sesiju/kol na Izvodjenju');
    a.run("current='tasks'; render();");
    let hz = a.g.document.getElementById('view').innerHTML;
    if (hz.includes(`obrisiZadatak('${izv.id}')`) || hz.includes(`openSite('${izv.gr}')`)) throw new Error('zadatak Izvodjenja se prikazuje u Kanbanu');
    const n0 = a.g._calls.alert.length;
    a.run(`pocniZadatak(${q36(pro.id)})`);
    if (a.g._calls.alert.length !== n0) throw new Error('zaglavljena sesija na Izvodjenju blokirala start: ' + a.g._calls.alert[n0]);
    if (a.run("DATA.rad_na_zadatku.find(s=>s.id==='rzx').kraj") === null) throw new Error('zaglavljena sesija nije zatvorena');
    if (!a.run(`DATA.rad_na_zadatku.some(s=>s.zadatak===${q36(pro.id)}&&!s.kraj)`)) throw new Error('nova sesija nije otvorena');
    a.run(`pauzirajZadatak(${q36(pro.id)})`);
    a.run("current='tasks'; render();");
    a.run("DATA.rad_na_zadatku[0].minuta=15");   // sa 0 minuta info-linija je prazna i bez guarda — zato pozitivna vrednost
    if (a.run(`tajmerLinija(DATA.zadaci.find(t=>t.id===${q36(izv.id)}))`) !== '') throw new Error('zatvorena sesija na Izvodjenju curi kao info-linija (⏱ ukupno 15 min)');
  });
  const prep36 = a => {   // radnik zid na svom gradilistu gid: tri zadatka (dva njegova, jedan tudj)
    const zid = a.run(T36_ZID), gid = a.run(`zapById[${q36(zid)}].grs.find(x=>grById[x])`);
    a.run(`grById[${q36(gid)}].modul='projektovanje'; grById[${q36(gid)}].tip=null;`);   // tajmer je samo u Projektovanju (2026-10-10)
    const tudj = a.run(`DATA.zaposleni.find(z=>z.id!==${q36(zid)}&&!/[Rr]ukovodilac/.test(z.poz)).id`);
    a.run(`const zt=zapById[${q36(tudj)}]; if(!(zt.grs||[]).includes(${q36(gid)})) zt.grs=[...(zt.grs||[]),${q36(gid)}];`);   // tudj u timu → vidimGr true → a2 blok se NE preskace
    a.run(`DATA.zadaci.push({id:'tm1',naziv:'Tajmer A',gr:${q36(gid)},zad:${q36(zid)},prio:'mid',kol:'todo',rok:'2026-12-01'},{id:'tm2',naziv:'Tajmer tudji',gr:${q36(gid)},zad:${q36(tudj)},prio:'mid',kol:'todo',rok:'2026-12-01'},{id:'tm3',naziv:'Tajmer B',gr:${q36(gid)},zad:${q36(zid)},prio:'mid',kol:'todo',rok:'2026-12-01'});`);
    return { zid, gid, tudj };
  };
  const viewZa36 = (a, role, cur) => { a.run(`setRole(${q36(role)}); MODUL='sve'; PODTIP='sve'; current=${q36(cur)}; render();`); return a.g.document.getElementById('view').innerHTML; };
  const tabla36 = (a, role) => { a.run(`setRole(${q36(role)}); MODUL='sve'; PODTIP='sve'; current='tasks'; render();`); return a.g.document.getElementById('view').innerHTML; };
  await acheck('a) radnik: Pocni na svom zadatku, tudji bez dugmeta, jedna otvorena sesija, Zavrsi zatvara i zavrsava (bez potvrde)', async () => {
    const a = await boot(); const { zid } = prep36(a);
    let h = tabla36(a, 'radnik:' + zid);
    if (!h.includes('▶ Počni zadatak')) throw new Error('nema dugmeta Počni');
    if (!h.includes("pocniZadatak('tm1')")) throw new Error('nema dugmeta na svom zadatku');
    if (h.includes("pocniZadatak('tm2')")) throw new Error('dugme na tudjem zadatku');
    a.run("pocniZadatak('tm1')");
    const ses = a.run("DATA.rad_na_zadatku.filter(s=>!s.kraj)");
    if (ses.length !== 1 || ses[0].osoba !== zid || ses[0].zadatak !== 'tm1') throw new Error('sesija: ' + JSON.stringify(ses));
    if (a.run("DATA.zadaci.find(t=>t.id==='tm1').kol") !== 'inprogress') throw new Error('kol nije inprogress');
    const n0 = a.g._calls.alert.length;
    a.run("pocniZadatak('tm3')");
    if (a.g._calls.alert.length !== n0 + 1 || !/Već imaš započet/.test(a.g._calls.alert[n0])) throw new Error('nema alerta za drugu sesiju');
    if (a.run('DATA.rad_na_zadatku.length') !== 1) throw new Error('druga sesija je upisana');
    h = a.g.document.getElementById('view').innerHTML;
    if (!h.includes('■ Završi zadatak') || !h.includes('⏱')) throw new Error('nema Završi / ⏱ u prikazu');
    a.run("zavrsiZadatak('tm1')");
    const s = a.run('DATA.rad_na_zadatku[0]');
    if (!s.kraj || typeof s.minuta !== 'number' || s.minuta < 0) throw new Error('sesija nije zatvorena: ' + JSON.stringify(s));
    if (a.run("DATA.zadaci.find(t=>t.id==='tm1').kol") !== 'done') throw new Error('kol nije done');
    if (a.g._calls.confirm.some(m => /završen/.test(m))) throw new Error('Završi ne sme da pita za potvrdu (za „samo stani" postoji Pauziraj)');
  });
  await acheck('a2) Pauziraj: zatvara svoju sesiju, zadatak ostaje u toku, log zadatak_pauza; Nastavi otvara drugu sesiju; Zavrsi bez sesije; tudja sesija blokira', async () => {
    const a = await boot(); const { zid, gid, tudj } = prep36(a);
    tabla36(a, 'radnik:' + zid); a.run("pocniZadatak('tm1')");
    let h = a.g.document.getElementById('view').innerHTML;
    if (!h.includes("pauzirajZadatak('tm1')") || !h.includes('⏸ Pauziraj')) throw new Error('nema dugmeta Pauziraj dok sesija tece');
    a.run("pauzirajZadatak('tm1')");
    const s1 = a.run("DATA.rad_na_zadatku[0]");
    if (!s1.kraj || typeof s1.minuta !== 'number') throw new Error('pauza nije zatvorila sesiju: ' + JSON.stringify(s1));
    if (a.run("DATA.zadaci.find(t=>t.id==='tm1').kol") !== 'inprogress') throw new Error('pauza je promenila kol');
    h = a.g.document.getElementById('view').innerHTML;
    if (!h.includes('▶ Nastavi') || !h.includes("zavrsiZadatak('tm1')")) throw new Error('posle pauze ocekujem Nastavi + Zavrsi, dobio: ' + (h.match(/▶[^<]*|■[^<]*/g) || []).join('|'));
    if (h.includes("pauzirajZadatak('tm1')")) throw new Error('Pauziraj bez otvorene sesije');
    a.run("pocniZadatak('tm1')");
    if (a.run("DATA.rad_na_zadatku.filter(s=>s.zadatak==='tm1').length") !== 2) throw new Error('Nastavi nije otvorio drugu sesiju');
    if (a.run("DATA.rad_na_zadatku.filter(s=>!s.kraj).length") !== 1) throw new Error('vise od jedne otvorene sesije');
    a.run("pauzirajZadatak('tm1')");
    a.run("zavrsiZadatak('tm1')");   // bez otvorene sesije, zadatak u toku → dozvoljeno
    if (a.run("DATA.zadaci.find(t=>t.id==='tm1').kol") !== 'done') throw new Error('Zavrsi posle pauze nije zavrsio');
    if (a.run("DATA.rad_na_zadatku.some(s=>!s.kraj)")) throw new Error('ostala otvorena sesija');
    // tudji zadatak u toku: radnik bez sesije ne moze da ga zavrsi; tudja otvorena sesija blokira i rukovodioca
    a.run("DATA.zadaci.find(t=>t.id==='tm2').kol='inprogress'");
    a.run("zavrsiZadatak('tm2')");
    if (a.run("DATA.zadaci.find(t=>t.id==='tm2').kol") !== 'inprogress') throw new Error('radnik je zavrsio tudji zadatak');
    const ruk = a.run(`grById[${q36(gid)}].rukovodilac`);
    a.run(`setRole(${q36('radnik:' + tudj)})`);
    if (!a.run("mogaTajmer(DATA.zadaci.find(t=>t.id==='tm2'))")) throw new Error('prep36: tudj ne moze tajmer na tm2 — blok bi se tiho preskocio');
    {
      a.run("pocniZadatak('tm2')");
      const n0 = a.g._calls.alert.length;
      a.run(`setRole('all'); zavrsiZadatak('tm2');`);
      if (a.run("DATA.zadaci.find(t=>t.id==='tm2').kol") === 'done') throw new Error('uprava zavrsila zadatak dok radnik radi na njemu');
      if (a.g._calls.alert.length !== n0 + 1 || !/još radi/.test(a.g._calls.alert[n0])) throw new Error('nema poruke o tudjoj sesiji');
      a.run(`setRole('all'); pauzirajZadatak('tm2');`);
      if (!a.run("DATA.rad_na_zadatku.some(s=>s.zadatak==='tm2'&&!s.kraj)")) throw new Error('uprava je pauzirala TUDJU sesiju');
    }
    // prevlacenje u Zavrseno zatvara SVOJU otvorenu sesiju (inace ostaje bez dugmeta i blokira)
    a.run(`setRole(${q36('radnik:' + zid)}); pocniZadatak('tm3');`);
    if (!a.run("DATA.rad_na_zadatku.some(s=>s.zadatak==='tm3'&&!s.kraj)")) throw new Error('tm3 nije pokrenut');
    a.run("dragId='tm3'; dropTask({preventDefault(){}}, 'done');");
    if (a.run("DATA.zadaci.find(t=>t.id==='tm3').kol") !== 'done') throw new Error('drop nije prebacio u done');
    if (a.run("DATA.rad_na_zadatku.some(s=>s.zadatak==='tm3'&&!s.kraj)")) throw new Error('drop u done ostavio otvorenu sesiju');
    // log: pauza nosi naziv i minute
    const b = await boot({ supabase: true, seed: {} });
    const sleep = async () => { for (let i = 0; i < 8; i++) await new Promise(r => setImmediate(r)); };
    const tid = b.run(PRO_TID);
    b.run(`pocniZadatak(${q36(tid)}); pauzirajZadatak(${q36(tid)});`);
    await b.run('doSave()'); await sleep();
    const lg = (b.g.__mock._db.log_koriscenja || []).find(l => l.dogadjaj === 'zadatak_pauza');
    if (!lg || !lg.detalj || !lg.detalj.naziv || typeof lg.detalj.minuta !== 'number') throw new Error('log pauze: ' + JSON.stringify(lg));
    b.run("NALOZI=null; ANGAZ=null; current='nalozi';");
    await b.run('ucitajNaloge()'); await sleep();
    b.run('render()');
    if (!b.g.document.getElementById('view').innerHTML.includes('⏸ Pauza zadatka')) throw new Error('log pogled ne prikazuje pauzu');
  });
  await acheck('b) tudji zadatak: nista; rukovodilac svog gradilista: osoba = on; uprava: osoba "uprava"', async () => {
    const a = await boot(); const { zid, gid } = prep36(a);
    a.run(`setRole(${q36('radnik:' + zid)}); pocniZadatak('tm2');`);
    if (a.run('DATA.rad_na_zadatku.length') !== 0) throw new Error('radnik je poceo tudji zadatak');
    const ruk = a.run(`grById[${q36(gid)}].rukovodilac`);
    if (ruk) {
      a.run(`setRole(${q36(ruk)}); pocniZadatak('tm2');`);
      const s = a.run('DATA.rad_na_zadatku');
      if (s.length !== 1 || s[0].osoba !== ruk) throw new Error('rukovodilac: ' + JSON.stringify(s));
      a.run("zavrsiZadatak('tm2')");
    }
    a.run("setRole('all'); pocniZadatak('tm1');");
    const u = a.run("DATA.rad_na_zadatku.filter(s=>!s.kraj)");
    if (u.length !== 1 || u[0].osoba !== 'uprava') throw new Error('uprava: ' + JSON.stringify(u));
  });
  await acheck('c) minutaZadatka = zatvorene + proteklo otvorene; fmtTrajanje', async () => {
    const a = await boot();
    a.run(`DATA.rad_na_zadatku=[{id:'c1',zadatak:'tc',gr:'g1',osoba:'z1',start:new Date(Date.now()-3*3600000).toISOString(),kraj:new Date(Date.now()-3*3600000+90*60000).toISOString(),minuta:90,napomena:''},{id:'c2',zadatak:'tc',gr:'g1',osoba:'z1',start:new Date(Date.now()-30*60000).toISOString(),kraj:null,minuta:null,napomena:''}]`);
    const m = a.run("minutaZadatka('tc')");
    if (Math.abs(m - 120) > 1) throw new Error('minuta = ' + m);
    if (a.run("fmtTrajanje(135)") !== '2 h 15 min' || a.run("fmtTrajanje(45)") !== '45 min') throw new Error('fmtTrajanje');
  });
  await acheck('d) stranica zaposlenog (Angazovanost) i Admin kokpit (red radnika + sajt + resursi)', async () => {
    const a = await boot(); const { zid, gid } = prep36(a);
    a.run(`DATA.resursi.push({id:'rT36',tip:'vozilo',naziv:'Kombi T36',oznaka:'',gr:null,zaduzen:${q36(zid)},istice:'2027-01-01',napomena:''});
      DATA.rad_na_zadatku.push({id:'dT1',zadatak:'tm1',gr:${q36(gid)},osoba:${q36(zid)},start:new Date(Date.now()-2*86400000).toISOString(),kraj:new Date(Date.now()-2*86400000+150*60000).toISOString(),minuta:150,napomena:''});`);
    a.run(`setRole('all'); openEmpPage(${q36(zid)});`);
    let h = a.g.document.getElementById('view').innerHTML;
    if (!h.includes('Angažovanost (30 dana)') || !h.includes('2 h 30 min')) throw new Error('stranica zaposlenog: nema angažovanosti/sati');
    const nm = a.run(`grById[${q36(gid)}].naziv`);
    h = viewZa36(a, 'all', 'nalozi');
    if (!h.includes('Angažovanost radnika')) throw new Error('nema kartice u Admin kokpitu');
    const kartica = h.slice(h.indexOf('Angažovanost radnika'), h.indexOf('Log korišćenja'));
    const ime = a.run(`zapById[${q36(zid)}].ime`);
    const red = kartica.split('<tr>').find(r => r.includes(ime));
    if (!red || !red.includes(nm) || !red.includes('Kombi T36') || !red.includes('2,5')) throw new Error('red radnika: ' + red);
    const th = (kartica.match(/<th>/g) || []).length;
    if (th !== 6 || (red.match(/<td/g) || []).length !== th) throw new Error('th/td: ' + th + ' / ' + (red.match(/<td/g) || []).length);
  });
  await acheck('e) Supabase: sesija se salje, server racuna minute (ne klijent), log, angazovanost rpc', async () => {
    const a = await boot({ supabase: true, seed: {} });
    const sleep = async () => { for (let i = 0; i < 8; i++) await new Promise(r => setImmediate(r)); };
    const tid = a.run(PRO_TID);
    a.run(`pocniZadatak(${q36(tid)})`);
    await a.run('doSave()'); await sleep();
    let row = a.g.__mock._db.rad_na_zadatku.find(r => r.zadatak === tid);
    if (!row || row.osoba !== 'uprava' || row.kraj) throw new Error('red nije na serveru: ' + JSON.stringify(row));
    a.run(`DATA.rad_na_zadatku[0].start=new Date(Date.now()-10*60000).toISOString()`);
    a.run(`zavrsiZadatak(${q36(tid)})`);
    a.run('DATA.rad_na_zadatku[0].minuta=999');   // klijentova vrednost se ignorise
    await a.run('doSave()'); await sleep();
    row = a.g.__mock._db.rad_na_zadatku.find(r => r.zadatak === tid);
    if (!row.kraj || ![9, 10].includes(row.minuta)) throw new Error('server minuta = ' + row.minuta);
    const dog = (a.g.__mock._db.log_koriscenja || []).map(l => l.dogadjaj);
    if (!dog.includes('zadatak_start') || !dog.includes('zadatak_kraj')) throw new Error('log: ' + dog.join(','));
    a.g.__mock._log.length = 0;
    a.run("NALOZI=null; ANGAZ=null; current='nalozi';");
    await a.run('ucitajNaloge()'); await sleep();
    if (!a.g.__mock._log.some(l => l.op === 'rpc' && l.name === 'angazovanost')) throw new Error('nema rpc angazovanost: ' + JSON.stringify(a.g.__mock._log.slice(0, 6)));
    if (!Array.isArray(a.run('ANGAZ')) || !a.run('ANGAZ').length) throw new Error('ANGAZ prazan');
    /* log u kokpitu prikazuje opis (naziv) zadatka, gradiliste i trajanje za start/kraj */
    a.run('render()');
    const hl = a.g.document.getElementById('view').innerHTML;
    const naziv = a.run(`unesc(DATA.zadaci.find(t=>t.id===${q36(tid)}).naziv)`);
    if (!hl.includes('Početak zadatka') || !hl.includes('Kraj zadatka')) throw new Error('log ne prikazuje start/kraj zadatka');
    if (!hl.includes('„' + naziv + '&quot;')) throw new Error('log ne prikazuje naziv zadatka: ' + naziv);   // esc() na izlazu: " -> &quot;
    if (!/Kraj zadatka<\/td><td class="sub">[^<]*min/.test(hl)) throw new Error('log ne prikazuje trajanje uz kraj zadatka');
  });

  /* ---- T38 vidljivost zadataka (migracija 17): uprava sve, rukovodilac svoja gradilista, radnik samo svoje ---- */
  section('T38 vidljivost zadataka');
  await acheck('zadaciVidljivi: direktor sve; rukovodilac sve na svojim gradilistima; radnik/spoljni samo svoje; tab brojac, kanban i fioka isto', async () => {
    const a = await boot();
    const zid = a.run("(DATA.zaposleni.find(z=>!/[Rr]ukovodilac/.test(z.poz)&&(z.grs||[]).some(x=>grById[x]&&jePro(grById[x])))||{}).id");
    const gid = a.run(`zapById[${JSON.stringify(zid)}].grs.find(x=>grById[x]&&jePro(grById[x]))`);   // zadaci samo u Projektovanju
    a.run(`DATA.zadaci.push({id:'t38a',naziv:'moj T38',gr:${JSON.stringify(gid)},zad:${JSON.stringify(zid)},prio:'mid',kol:'todo',rok:todayStr()},{id:'t38b',naziv:'tudji T38',gr:${JSON.stringify(gid)},zad:'z1',prio:'mid',kol:'todo',rok:todayStr()});`);
    a.run("setRole('all'); MODUL='sve';");
    if (a.run('zadaciVidljivi().length') !== a.run('DATA.zadaci.filter(zadatakPro).length')) throw new Error('direktor ne vidi sve zadatke Projektovanja');
    if (a.run('zadaciVidljivi().some(t=>!zadatakPro(t))')) throw new Error('direktor vidi zadatke Izvodjenja');
    const ruk = a.run(`grById[${JSON.stringify(gid)}].rukovodilac`);
    a.run(`setRole(${JSON.stringify(ruk)})`);
    const rv = a.run('zadaciVidljivi().map(t=>t.id)');
    if (!rv.includes('t38a') || !rv.includes('t38b')) throw new Error('rukovodilac ne vidi sve zadatke svog gradilista: ' + rv);
    if (a.run("zadaciVidljivi().some(t=>!visibleSiteIds().has(t.gr))")) throw new Error('rukovodilac vidi zadatke tudjih gradilista');
    a.run(`setRole('radnik:${zid}')`);
    const wv = a.run('zadaciVidljivi().map(t=>t.id)');
    if (!wv.includes('t38a') || wv.includes('t38b')) throw new Error('radnik: ' + wv);
    if (a.run(`zadaciVidljivi().some(t=>t.zad!==${JSON.stringify(zid)})`)) throw new Error('radnik vidi tudje zadatke');
    if (a.run("tabs().find(t=>t.id==='tasks').cnt") !== wv.length) throw new Error('brojac taba != vidljivi zadaci');
    a.run("current='tasks'; render();");
    const h = a.g.document.getElementById('view').innerHTML;
    if (!h.includes('moj T38') || h.includes('tudji T38')) throw new Error('kanban prikazuje tudji zadatak radniku');
    a.run(`openSite(${JSON.stringify(gid)})`);
    const d = a.g.document.getElementById('drawer').innerHTML;
    if (d.includes('moj T38') || d.includes('tudji T38') || d.includes('Zadaci (')) throw new Error('fioka Projektovanja lista zadatke (treba samo sveske po osobi)');
    a.run("current='dash'; render();");
    if (a.g.document.getElementById('view').innerHTML.includes('tudji T38')) throw new Error('tabla prikazuje tudji zadatak radniku');
  });

  /* ---- T37 opis zadatka (migracija 16): forma, kartica, log tajmera ---- */
  section('T37 opis zadatka');
  await acheck('formTask ima polje opis; saveTask cuva esc(opis); kartica ga prikazuje; start u logu nosi opis', async () => {
    const a = await boot();
    a.run("ROLE='all'; formTask();");
    const doc = a.g.document;
    if (!doc.getElementById('modal').innerHTML.includes('id="f_topis"')) throw new Error('forma nema polje opis');
    const gid = a.run('DATA.gradilista.find(g=>jePro(g)).id');
    if (doc.getElementById('modal').innerHTML.includes(`value="${a.run('DATA.gradilista.find(g=>!jePro(g)).id')}"`)) throw new Error('forma nudi gradiliste Izvodjenja');
    doc.getElementById('f_tnaziv').value = 'Zadatak T37'; doc.getElementById('f_topis').value = 'Opis <b> & detalji'; doc.getElementById('f_tgr').value = gid;
    doc.getElementById('f_tzad').value = 'z1'; doc.getElementById('f_tprio').value = 'mid'; doc.getElementById('f_trok').value = '';
    a.run('saveTask()');
    const t = a.run('DATA.zadaci[DATA.zadaci.length-1]');
    if (t.naziv !== 'Zadatak T37' || t.opis !== a.run("esc('Opis <b> & detalji')")) throw new Error('opis nije sacuvan esc-ovan: ' + JSON.stringify(t));
    a.run("current='tasks'; render();");
    if (!doc.getElementById('view').innerHTML.includes(t.opis)) throw new Error('kartica ne prikazuje opis');
    const b = await boot({ supabase: true, seed: {} });
    b.run(`ROLE='all'; DATA.zadaci.push({id:'t_37',naziv:'Sa opisom',opis:esc('radi pažljivo'),gr:DATA.gradilista.find(g=>jePro(g)).id,zad:'z1',prio:'mid',kol:'todo',rok:todayStr()}); pocniZadatak('t_37');`);
    await b.run('doSave()'); for (let i = 0; i < 6; i++) await new Promise(r => setImmediate(r));
    const l = (b.g.__mock._db.log_koriscenja || []).find(x => x.dogadjaj === 'zadatak_start' && x.detalj && x.detalj.zadatak === 't_37');
    if (!l || l.detalj.opis !== 'radi pažljivo') throw new Error('log start nema opis: ' + JSON.stringify(l && l.detalj));
  });

  /* ---- T35 brisanje (C3): super brise sve, radnik/spoljni samo svoj unos dnevnika ---- */
  section('T35 brisanje (super)');
  const T35_ZID = "(DATA.zaposleni.find(z=>!/[Rr]ukovodilac/.test(z.poz)&&(z.grs||[]).some(x=>grById[x]))||{}).id";
  const drawerT35 = (a, role, gid) => { a.run(`setRole(${JSON.stringify(role)})`); const d = a.g.document.getElementById('drawer'); d.innerHTML = ''; a.run(`openSite(${JSON.stringify(gid)})`); return d.innerHTML; };
  const T35_G = "(DATA.predmer.find(p=>grById[p.gr])||{}).gr";   // gradiliste sa predmerom
  const viewZa = (a, role, cur) => { a.run(`setRole(${JSON.stringify(role)}); MODUL='sve'; PODTIP='sve'; current=${JSON.stringify(cur)}; render();`); return a.g.document.getElementById('view').innerHTML; };
  await acheck('a) dugmad za brisanje: samo direktor (admin i rukovodilac ih ne vide) — zadaci, troskovi, situacije, resursi, predmer, klijenti, zaposleni, podizvodjaci, trebovanje, fioka', async () => {
    const a = await boot();
    const gid = a.run(T35_G);
    const slucajevi = [['tasks', 'obrisiZadatak('], ['pay', 'obrisiSituaciju('], ['resursi', 'obrisiResurs('], ['clients', 'obrisiKlijenta('], ['emps', 'obrisiZaposlenog('], ['subs', 'obrisiPodizvodjaca('], ['nabavka', 'obrisiNarudzbu(']];
    for (const [cur, fn] of slucajevi) {
      if (!viewZa(a, 'all', cur).includes(fn)) throw new Error('direktor nema ' + fn + ' u ' + cur);
      for (const r of ['admin', 'z1', 'z1:fin']) if (viewZa(a, r, cur).includes(fn)) throw new Error(r + ' ima ' + fn + ' u ' + cur);
    }
    a.run(`setRole('all'); PRED_ID=${JSON.stringify(gid)}; current='predmer'; render();`);
    if (!a.g.document.getElementById('view').innerHTML.includes('obrisiPredmerRed(')) throw new Error('direktor nema obrisiPredmerRed');
    a.run(`setRole('admin'); PRED_ID=${JSON.stringify(gid)}; current='predmer'; render();`);
    if (a.g.document.getElementById('view').innerHTML.includes('obrisiPredmerRed(')) throw new Error('admin ima obrisiPredmerRed');
    const trG = a.run("DATA.troskovi_st[0].gr"), modal = a.g.document.getElementById('modal');
    for (const [r, ocek] of [['all', true], ['admin', false], ['z1:fin', false]]) {
      a.run(`setRole(${JSON.stringify(r)})`); modal.innerHTML = ''; a.run(`openTroskovi(${JSON.stringify(trG)})`);
      const h = modal.innerHTML; if (!h) { if (ocek) throw new Error('modal prazan'); continue; }
      if (h.includes('obrisiTrosak(') !== ocek) throw new Error(r + ': obrisiTrosak ocekivano ' + ocek);
      const th = (h.match(/<th[ >]/g) || []).length, tr1 = h.slice(h.indexOf('<tbody>')).split('<tr>')[1] || '', td = (tr1.match(/<td[ >]/g) || []).length;
      if (th !== td) throw new Error(r + ': troskovi th=' + th + ' td=' + td);
    }
    const dr = drawerT35(a, 'all', 'g1'); if (!dr.includes('Obriši gradilište')) throw new Error('direktor nema Obrisi gradiliste');
    for (const r of ['admin', 'z1']) if (drawerT35(a, r, 'g1').includes('Obriši gradilište')) throw new Error(r + ' ima Obrisi gradiliste');
  });
  await acheck('b) obrisiZadatak: direktor brise (confirm), admin i rukovodilac ne mogu (bez confirm-a)', async () => {
    const a = await boot();
    const n0 = a.run('DATA.zadaci.length'), c0 = a.g._calls.confirm.length;
    for (const r of ['admin', 'z1']) { a.run(`setRole(${JSON.stringify(r)})`); await a.run("obrisiZadatak('t1')"); }
    if (a.run('DATA.zadaci.length') !== n0 || a.g._calls.confirm.length !== c0) throw new Error('admin/rukovodilac je obrisao ili pitao');
    a.run("setRole('all')"); const ok = await a.run("obrisiZadatak('t1')");
    if (ok !== true || a.run('DATA.zadaci.length') !== n0 - 1 || a.run("DATA.zadaci.some(t=>t.id==='t1')") || a.g._calls.confirm.length !== c0 + 1) throw new Error('direktor nije obrisao');
    if (!/Betoniranje/.test(a.g._calls.confirm[a.g._calls.confirm.length - 1])) throw new Error('confirm ne imenuje red');
  });
  await acheck('c) dnevnik: radnik brise samo svoj unos (✕ samo uz svoj); tudji = bez promene i bez confirm-a', async () => {
    const a = await boot();
    const zid = a.run(T35_ZID), gid = a.run(`zapById[${JSON.stringify(zid)}].grs.find(x=>grById[x])`);
    a.run(`DATA.dnevnik.push({id:'dnA',gr:${JSON.stringify(gid)},autor:${JSON.stringify(zid)},datum:'2026-10-05',tekst:'moj'},{id:'dnB',gr:${JSON.stringify(gid)},autor:'uprava',datum:'2026-10-05',tekst:'tudji'})`);
    const h = viewZa(a, 'radnik:' + zid, 'diary');
    if (!h.includes("obrisiUnosDnevnika('dnA')") || h.includes("obrisiUnosDnevnika('dnB')")) throw new Error('radnik: pogresna dugmad');
    const c0 = a.g._calls.confirm.length, n0 = a.run('DATA.dnevnik.length');
    await a.run("obrisiUnosDnevnika('dnB')");
    if (a.run('DATA.dnevnik.length') !== n0 || a.g._calls.confirm.length !== c0) throw new Error('radnik je dirao tudji unos');
    await a.run("obrisiUnosDnevnika('dnA')");
    if (a.run('DATA.dnevnik.length') !== n0 - 1 || a.run("DATA.dnevnik.some(d=>d.id==='dnA')")) throw new Error('svoj unos nije obrisan');
    const ha = viewZa(a, 'admin', 'diary'); if (ha.includes('obrisiUnosDnevnika(')) throw new Error('admin ima dugme za dnevnik');
    const hd = viewZa(a, 'all', 'diary'); if (!hd.includes("obrisiUnosDnevnika('dnB')")) throw new Error('direktor nema dugme');
  });
  await acheck('d) obrisiZaposlenog: rukovodilac gradilista = alert i bez promene; bez gradilista = obrisan', async () => {
    const a = await boot();
    a.run("setRole('all')");
    const al = a.g._calls.alert.length, n0 = a.run('DATA.zaposleni.length');
    await a.run("obrisiZaposlenog('z1')");
    if (a.run('DATA.zaposleni.length') !== n0 || a.g._calls.alert.length !== al + 1 || !/Prvo dodeli drugog rukovodioca/.test(a.g._calls.alert[al])) throw new Error('rukovodilac nije odbijen');
    a.run("DATA.zaposleni.push({id:'z_t35',ime:'Test T35',poz:'Majstor',tel:'1',status:'Kancelarija',opis:'',grs:[],bivsi:[]}); rebuildMaps();");
    await a.run("obrisiZaposlenog('z_t35')");
    if (a.run('DATA.zaposleni.length') !== n0 || a.run("!!zapById.z_t35")) throw new Error('zaposleni bez gradilista nije obrisan');
    a.run("setRole('admin')"); const c0 = a.g._calls.confirm.length; await a.run("obrisiZaposlenog('z2')");
    if (a.run('DATA.zaposleni.length') !== n0 || a.g._calls.confirm.length !== c0) throw new Error('admin je obrisao zaposlenog');
    /* klijent sa gradilistem = odbijen; podizvodjac: zaduzenje u predmeru se skida */
    a.run("setRole('all')"); const al2 = a.g._calls.alert.length, nc = a.run('DATA.clijenti.length');
    await a.run("obrisiKlijenta('c1')"); if (a.run('DATA.clijenti.length') !== nc || a.g._calls.alert.length !== al2 + 1) throw new Error('klijent sa gradilistem nije odbijen');
    a.run("DATA.predmer.find(p=>p.gr).zaduzen='p1'"); const np = a.run('DATA.podizvodjaci.length');
    await a.run("obrisiPodizvodjaca('p1')");
    if (a.run('DATA.podizvodjaci.length') !== np - 1 || a.run("DATA.predmer.some(p=>p.zaduzen==='p1')")) throw new Error('podizvodjac / zaduzenje');
  });
  await acheck('e) obrisiGradiliste (demo): gradiliste i sve zavisno nestaje, resursi.gr = null, z.grs ociscen; odbijen confirm = bez promene', async () => {
    const a = await boot({ confirmReturns: false });
    a.run("setRole('all')");
    const snap = a.run('JSON.stringify(DATA)'), c0 = a.g._calls.confirm.length;
    await a.run("obrisiGradiliste('g1')");
    if (a.run('JSON.stringify(DATA)') !== snap || a.g._calls.confirm.length !== c0 + 1) throw new Error('odbijen confirm je ipak menjao DATA');
    const b = await boot();
    b.run("setRole('all')");
    b.run("DATA.predmer.push({id:'pmT',gr:'g1',poz:'x',jm:'m',kol:2,cena:1,izv:0}); DATA.troskovi_st.push({id:'trT',gr:'g1',datum:'2026-10-01',opis:'x',kat:'k',iznos:1}); DATA.mag_promene.push({id:'mpT',mid:'m1',datum:'2026-10-01',tip:'ulaz',kol:1,gr:'g1'}); DATA.dokumenti.push({id:'dkT',gr:'g1',autor:'uprava',datum:'2026-10-01',naziv:'x',tip:'text/plain',velicina:0,opis:'',data:'data:,'}); DATA.resursi.push({id:'rT',tip:'vozilo',naziv:'x',gr:'g1',istice:'2030-01-01'}); rebuildMaps();");
    const TAB = ['zadaci', 'dnevnik', 'narudzbe', 'predmer', 'troskovi_st', 'situacije', 'mag_promene', 'dokumenti'];
    for (const t of TAB) if (!b.run(`DATA.${t}.some(r=>r.gr==='g1')`)) throw new Error('priprema: nema ' + t + ' za g1');
    if (!b.run("DATA.zaposleni.some(z=>(z.grs||[]).includes('g1'))")) throw new Error('priprema: nema z.grs');
    const n0 = b.run('DATA.gradilista.length'), c1 = b.g._calls.confirm.length;
    const ok = await b.run("obrisiGradiliste('g1')");
    if (ok !== true || b.g._calls.confirm.length !== c1 + 2) throw new Error('ok=' + ok + ', confirm x' + (b.g._calls.confirm.length - c1));
    if (b.run('DATA.gradilista.length') !== n0 - 1 || b.run("grById.g1") !== undefined) throw new Error('gradiliste ostalo');
    for (const t of TAB) if (b.run(`DATA.${t}.some(r=>r.gr==='g1')`)) throw new Error('ostali redovi u ' + t);
    if (b.run("DATA.resursi.some(r=>r.gr==='g1')") || b.run("DATA.resursi.find(r=>r.id==='rT').gr") !== null) throw new Error('resursi.gr nije nulovan');
    if (b.run("DATA.zaposleni.some(z=>(z.grs||[]).includes('g1')||(z.bivsi||[]).includes('g1'))") || b.run("DATA.podizvodjaci.some(p=>(p.grs||[]).includes('g1'))")) throw new Error('grs/bivsi nisu ocisceni');
    b.run("setRole('admin')"); const c2 = b.g._calls.confirm.length, n1 = b.run('DATA.gradilista.length');
    await b.run("obrisiGradiliste('g2')"); if (b.run('DATA.gradilista.length') !== n1 || b.g._calls.confirm.length !== c2) throw new Error('admin je obrisao gradiliste');
  });
  await acheck('e2) obrisiGradiliste (supabase): direktor -> rpc, baza nema gradiliste ni zavisne redove, log brisanje; admin -> rpc odbija, nista se ne menja', async () => {
    const USERS = { 'direktor@test': { id: 'u-dir', password: 'dir' }, 'admin@test': { id: 'u-adm', password: 'a' } };
    const profili = [{ user_id: 'u-dir', uloga: 'direktor', zaposleni_id: null, ime: 'D' }, { user_id: 'u-adm', uloga: 'admin', zaposleni_id: null, ime: 'A' }];
    const s0 = await boot({ supabase: true, seed: { profili }, session: { user: { id: 'u-dir', email: 'direktor@test' } }, users: USERS });
    const seed = JSON.parse(JSON.stringify(s0.g.__mock._db)); delete seed.log_koriscenja;
    /* admin: klijentski guard staje pre rpc-a; sam rpc (direktno) vraca gresku i ne dira bazu */
    const ad = await boot({ supabase: true, seed: JSON.parse(JSON.stringify(seed)), session: { user: { id: 'u-adm', email: 'admin@test' } }, users: USERS });
    const dbA = ad.g.__mock._db, snapA = JSON.stringify(dbA.gradilista), cA = ad.g._calls.confirm.length;
    ad.g.__mock._log.length = 0;
    await ad.run("obrisiGradiliste('g1')");
    if (ad.g._calls.confirm.length !== cA || ad.g.__mock._log.some(l => l.op === 'rpc' && l.name === 'obrisi_gradiliste')) throw new Error('admin je pokrenuo brisanje');
    const r = await ad.run("supa.rpc('obrisi_gradiliste',{p_gid:'g1'})");
    if (!r.error || !/direktor/.test(r.error.message) || JSON.stringify(dbA.gradilista) !== snapA || ad.run("grById.g1") === undefined) throw new Error('admin rpc: ' + JSON.stringify(r));
    const a = await boot({ supabase: true, seed: JSON.parse(JSON.stringify(seed)), session: { user: { id: 'u-dir', email: 'direktor@test' } }, users: USERS });
    const db = a.g.__mock._db;
    if (!db.zadaci.some(t => t.gr === 'g1')) throw new Error('priprema: nema zadataka g1');
    const ok = await a.run("obrisiGradiliste('g1')");
    if (ok !== true || db.gradilista.some(g => g.id === 'g1')) throw new Error('baza jos ima g1 (ok=' + ok + ')');
    for (const t of ['zadaci', 'dnevnik', 'narudzbe', 'predmer', 'troskovi_st', 'situacije']) if ((db[t] || []).some(x => x.gr === 'g1')) throw new Error('baza: ostali redovi u ' + t);
    if ((db.zaposleni_gradiliste || []).some(x => x.gradiliste_id === 'g1')) throw new Error('baza: join redovi');
    if (!(db.log_koriscenja || []).some(l => l.dogadjaj === 'brisanje' && l.detalj && l.detalj.id === 'g1' && l.detalj.tabela === 'gradilista')) throw new Error('nema log reda');
    if (a.run("grById.g1") !== undefined || a.run("DATA.zadaci.some(t=>t.gr==='g1')")) throw new Error('klijent nije ocistio DATA');
  });
  await acheck('f) obrisiPredmerRed: red nestaje, napredak gradilista se preracunava', async () => {
    const a = await boot();
    a.run("setRole('all')");
    const gid = a.run(T35_G);
    a.run(`DATA.predmer = DATA.predmer.filter(p=>p.gr!==${JSON.stringify(gid)}); DATA.predmer.push({id:'pfA',gr:${JSON.stringify(gid)},poz:'A',jm:'m',kol:100,cena:10,izv:100},{id:'pfB',gr:${JSON.stringify(gid)},poz:'B',jm:'m',kol:100,cena:10,izv:0}); osveziNapredak(${JSON.stringify(gid)});`);
    if (a.run(`grById[${JSON.stringify(gid)}].napredak`) !== 50) throw new Error('priprema: napredak ' + a.run(`grById[${JSON.stringify(gid)}].napredak`));
    await a.run("obrisiPredmerRed('pfB')");
    const n = a.run(`grById[${JSON.stringify(gid)}].napredak`);
    if (a.run("DATA.predmer.some(p=>p.id==='pfB')") || n !== 100) throw new Error('napredak = ' + n);
  });

  /* ---- T34 sifarnik mera (C2) ---- */
  section('T34 sifarnik');
  await acheck('a) DATA.sifrarnik: 117 redova (36 sveske projektovanja + 81 artikal ELOM, bez pozicija radova), unikatni id, sifrarnikZa sortiran po redosledu', async () => {
    const a = await boot();
    if (a.run('DATA.sifrarnik.length') !== 117) throw new Error('ukupno ' + a.run('DATA.sifrarnik.length'));
    if (a.run('new Set(DATA.sifrarnik.map(s=>s.id)).size') !== 117) throw new Error('id-jevi nisu unikatni');
    const p = a.run("DATA.sifrarnik.filter(s=>s.modul==='projektovanje').length"), i = a.run("DATA.sifrarnik.filter(s=>s.modul==='izvodjenje').length");
    if (p !== 36 || i !== 81) throw new Error('projektovanje ' + p + ', izvodjenje ' + i);
    if (a.run("DATA.sifrarnik.some(s=>s.id.startsWith('sf-i-'))") || a.run("typeof SIFRARNIK_IZV") !== 'undefined') throw new Error('pozicije radova (sf-i-*) jos postoje (obrisane migracijom 21)');
    const art = a.run("DATA.sifrarnik.filter(s=>s.grupa==='Artikli (ELOM)')");
    if (art.length !== 81 || new Set(art.map(x => x.sifra)).size !== 81) throw new Error('artikli: ' + art.length);
    for (const sf of ['01-1', '46', '47', 'M029', 'M009']) if (!art.some(x => x.sifra === sf)) throw new Error('nema sifre ' + sf);
    if (art.find(x => x.sifra === 'M009').jm !== 'm' || art.find(x => x.sifra === 'M009').naziv !== 'Parapet 210x90') throw new Error('M009 jm/naziv (zalepljena JM u PDF-u)');
    for (const m of ['izvodjenje', 'projektovanje'])
      if (!a.run(`(()=>{const l=sifrarnikZa('${m}');return l.length>0&&l.every((s,k)=>k===0||l[k-1].redosled<=s.redosled)})()`)) throw new Error('nije sortirano: ' + m);
  });
  await acheck('b) formSite(): mereFillBox (24 izv.) + nivoFillBox (36 proj.); toggleTipRadova prebacuje prikaz', async () => {
    const a = await boot();
    a.run("ROLE='all'; formSite();");
    const doc = a.g.document, html = doc.getElementById('modal').innerHTML;
    if (!html.includes('id="mereFillBox"') || !html.includes('id="nivoFillBox"')) throw new Error('nema kontejnera');
    const c = re => (html.match(re) || []).length;
    if (c(/id="f_sf_\d+"/g) !== 81 || c(/id="f_sfk_\d+"/g) !== 81 || c(/id="f_sfz_\d+"/g) !== 81) throw new Error(`f_sf_ ${c(/id="f_sf_\d+"/g)}, f_sfk_ ${c(/id="f_sfk_\d+"/g)}`);
    if (c(/id="f_sfc_\d+"/g) !== 81) throw new Error('cena po stavci (uprava): ' + c(/id="f_sfc_\d+"/g));
    if (!html.includes('oninput="filtrirajSifrarnik(this)"') || c(/class="sf-red"/g) !== 117) throw new Error('nema filtera / sf-red redova: ' + c(/class="sf-red"/g));
    if (c(/id="raznoBox"/g) !== 2) throw new Error('Razno mora biti i u Izvodjenju i u Projektovanju: ' + c(/id="raznoBox"/g));
    if (c(/id="f_nd_\d+"/g) !== 36) throw new Error('f_nd_ ' + c(/id="f_nd_\d+"/g));
    if (!/id="f_sfk_0"[^>]*type="number"|type="number"[^>]*id="f_sfk_0"/.test(html)) throw new Error('kolicina nije type=number');
    a.run("toggleTipRadova('izvodjenje')");
    if (doc.getElementById('mereFillBox').style.display !== 'block' || doc.getElementById('nivoFillBox').style.display !== 'none') throw new Error('izvodjenje: pogresan prikaz');
    if (/id="f_nivo"|nivoBox/.test(html)) throw new Error('forma nudi nivo gradilista (uklonjen 2026-10-14)');
    a.run("toggleTipRadova('projektovanje')");
    if (doc.getElementById('mereFillBox').style.display !== 'none' || doc.getElementById('nivoFillBox').style.display !== 'block') throw new Error('projektovanje: pogresan prikaz');
  });
  await acheck('f) saveSifrarnik / toggleSifrarnik / obrisiSifrarnik: guardovi po ulozi', async () => {
    const a = await boot();
    const doc = a.g.document, N = () => a.run('DATA.sifrarnik.length');
    a.run("ROLE='all'; current='nalozi'; render();");
    const set = (id, v) => { doc.getElementById(id).value = v; };
    set('sf_naziv', '<b>Nova poz</b>'); set('sf_jm', 'm²'); set('sf_grupa', 'Zemljani radovi'); set('sf_modul', 'izvodjenje');
    a.run("ROLE='z1'; saveSifrarnik(); ROLE='all';");
    if (N() !== 117) throw new Error('rukovodilac je dodao u sifarnik');
    const maxR = a.run('Math.max(...DATA.sifrarnik.map(s=>s.redosled))');
    a.run('saveSifrarnik()');
    if (N() !== 118) throw new Error('direktor nije dodao: ' + N());
    const nov = a.run('DATA.sifrarnik[DATA.sifrarnik.length-1]');
    if (nov.naziv.includes('<b>') || nov.redosled !== maxR + 1 || nov.aktivan !== true || nov.jm !== 'm²' || nov.modul !== 'izvodjenje' || nov.grupa !== 'Zemljani radovi') throw new Error('red: ' + JSON.stringify(nov));
    a.run("ROLE='z1'; toggleSifrarnik('sf-a-001'); ROLE='all';");
    if (a.run("DATA.sifrarnik.find(s=>s.id==='sf-a-001').aktivan") !== true) throw new Error('rukovodilac je promenio aktivan');
    a.run("toggleSifrarnik('sf-a-001')");
    if (a.run("DATA.sifrarnik.find(s=>s.id==='sf-a-001').aktivan") !== false) throw new Error('toggle nije prebacio na false');
    if (a.run("sifrarnikZa('izvodjenje').some(s=>s.id==='sf-a-001')")) throw new Error('neaktivan se i dalje nudi');
    a.run("toggleSifrarnik('sf-a-001')");
    if (a.run("DATA.sifrarnik.find(s=>s.id==='sf-a-001').aktivan") !== true) throw new Error('toggle nazad');
    a.run("setRole('admin')");
    await a.run("obrisiSifrarnik('sf-a-001')");
    if (N() !== 118) throw new Error('admin je obrisao');
    a.run('formSifrarnik()');
    if (a.g.document.getElementById('modal').innerHTML.includes('obrisiSifrarnik')) throw new Error('admin vidi dugme brisanja');
    if (a.run("viewNalozi()").includes('Šifarnik mera')) throw new Error('sifarnik je i dalje u Admin kokpitu (izbacen 2026-10-11)');
    a.run("setRole('all')");
    await a.run("obrisiSifrarnik('sf-a-001')");
    if (N() !== 117 || a.run("DATA.sifrarnik.some(s=>s.id==='sf-a-001')")) throw new Error('direktor nije obrisao');
  });
  await acheck('g) Šifarnik: modal sa taba Gradilišta (uprava), NE u Admin kokpitu; kartica "Šifarnik mera (60)" + polja', async () => {
    const a = await boot();
    a.run("ROLE='all'; current='nalozi'; render();");
    if (a.g.document.getElementById('view').innerHTML.includes('Šifarnik mera')) throw new Error('sifarnik u Admin kokpitu');
    a.run("current='sites'; render();");
    if (!a.g.document.getElementById('view').innerHTML.includes('onclick="formSifrarnik()"')) throw new Error('Gradilišta nema dugme Šifarnik za upravu');
    a.run("setRole('z1'); current='sites'; render();");
    if (a.g.document.getElementById('view').innerHTML.includes('formSifrarnik')) throw new Error('rukovodilac vidi dugme Šifarnik');
    a.run('formSifrarnik()');
    if (a.g.document.getElementById('modal').innerHTML.includes('sf_naziv')) throw new Error('rukovodilac otvorio sifarnik');
    a.run("setRole('all'); formSifrarnik();");
    const h = a.g.document.getElementById('modal').innerHTML;
    if (!h.includes('Šifarnik artikala i usluga (81)')) throw new Error('nema kartice u modalu (samo Izvodjenje, 81 artikal)');
    if (h.includes('sf-p-01') || /<option value="projektovanje"/.test(h)) throw new Error('sifarnik prikazuje/nudi Projektovanje');
    a.run("MODUL='projektovanje'; current='sites'; render();");
    if (a.g.document.getElementById('view').innerHTML.includes('formSifrarnik')) throw new Error('dugme Šifarnik u modulu Projektovanje');
    a.run("MODUL='sve';");
    if (!h.includes('id="sf_sifra"') || !h.includes('<th>Šifra</th>')) throw new Error('sifarnik bez sifre');
    a.run("toggleSifrarnik('sf-a-001')");   // akcija osvezava modal
    if (!a.g.document.getElementById('modal').innerHTML.includes('sf_naziv')) throw new Error('modal nestao posle akcije');
    for (const id of ['sf_naziv', 'sf_jm', 'sf_grupa', 'sf_modul', 'saveSifrarnik()']) if (!h.includes(id)) throw new Error('nema ' + id);
    if (!h.includes("obrisiSifrarnik('sf-a-001')")) throw new Error('direktor nema dugme za brisanje');
    const th = (h.match(/<th/g) || []).length, td = (h.match(/<td/g) || []).length;
    if (!(th > 0 && td > 0)) throw new Error('prazna tabela');
  });

  /* ---- T33 dokumenti gradilista (C1) ---- */
  section('T33 dokumenti');
  const T33_ZID = "(DATA.zaposleni.find(z=>!/[Rr]ukovodilac/.test(z.poz)&&(z.grs||[]).some(x=>grById[x]))||{}).id";
  const T33_PID = "((DATA.podizvodjaci||[]).find(p=>(p.grs||[]).some(x=>grById[x]))||{}).id";
  const drawerZa = (a, role, gid) => { a.run(`setRole(${JSON.stringify(role)})`); const d = a.g.document.getElementById('drawer'); d.innerHTML = ''; a.run(`openSite(${JSON.stringify(gid)})`); return d.innerHTML; };
  await acheck('fioka: "Dokumenti (0)" + dugme za dodavanje za direktora, rukovodioca, radnika u timu i spoljnog; radnik na tudjem gradilistu ne otvara fioku', async () => {
    const a = await boot();
    const zid = a.run(T33_ZID), pid = a.run(T33_PID);
    const gR = a.run(`zapById[${JSON.stringify(zid)}].grs.find(x=>grById[x])`);
    const gS = a.run(`DATA.podizvodjaci.find(p=>p.id===${JSON.stringify(pid)}).grs.find(x=>grById[x])`);
    const gRuk = a.run("DATA.gradilista.find(g=>g.rukovodilac==='z1').id");
    for (const [role, gid] of [['all', gRuk], ['z1', gRuk], ['radnik:' + zid, gR], ['spoljni:' + pid, gS]]) {
      const h = drawerZa(a, role, gid);
      if (!h.includes('Dokumenti (0)')) throw new Error(role + ': nema "Dokumenti (0)"');
      if (!h.includes("uploadDokument('" + gid + "')")) throw new Error(role + ': nema dugmeta za dodavanje');
    }
    const tudje = a.run(`visibleSites ? DATA.gradilista.map(g=>g.id).find(x=>!zapById[${JSON.stringify(zid)}].grs.includes(x)) : null`);
    const h = drawerZa(a, 'radnik:' + zid, tudje);
    if (h) throw new Error('radnik otvorio tudje gradiliste');
  });
  await acheck('brisanje: radnik samo svoj dokument, direktor sve, admin nista; obrisiDokument tudjeg = bez promene i bez confirm()', async () => {
    const a = await boot();
    const zid = a.run(T33_ZID);
    const gid = a.run(`zapById[${JSON.stringify(zid)}].grs.find(x=>grById[x])`);
    a.run(`DATA.dokumenti.push({id:'dkA',gr:${JSON.stringify(gid)},autor:${JSON.stringify(zid)},datum:'2026-10-01',naziv:'moj.jpg',tip:'image/jpeg',velicina:2048,opis:'',data:'data:,'},{id:'dkB',gr:${JSON.stringify(gid)},autor:'uprava',datum:'2026-10-02',naziv:'uprava.pdf',tip:'application/pdf',velicina:0,opis:'',data:'data:,'})`);
    const has = (h, id) => h.includes("obrisiDokument('" + id + "')");
    let h = drawerZa(a, 'radnik:' + zid, gid);
    if (!h.includes('Dokumenti (2)') || !has(h, 'dkA') || has(h, 'dkB')) throw new Error('radnik: pogresna dugmad za brisanje');
    h = drawerZa(a, 'all', gid); if (!has(h, 'dkA') || !has(h, 'dkB')) throw new Error('direktor ne moze da brise sve');
    h = drawerZa(a, 'admin', gid); if (has(h, 'dkA') || has(h, 'dkB')) throw new Error('admin ima dugme za brisanje');
    a.run(`setRole('radnik:${zid}')`);
    const c0 = a.g._calls.confirm.length;
    await a.run("obrisiDokument('dkB')");
    if (a.run('DATA.dokumenti.length') !== 2 || a.g._calls.confirm.length !== c0) throw new Error('radnik je obrisao ili pokusao da obrise tudji dokument');
    await a.run("obrisiDokument('dkA')");
    if (a.run('DATA.dokumenti.length') !== 1 || a.run('DATA.dokumenti[0].id') !== 'dkB') throw new Error('svoj dokument nije obrisan');
  });
  await acheck('otvoriDokument bez lokalnog data (supabase): view ne vraca data, sadrzaj preko rpc dokument_podaci, otvara se u novom tabu', async () => {
    const a0 = await boot({ supabase: true, seed: {} });
    const seed = JSON.parse(JSON.stringify(a0.g.__mock._db)); delete seed.log_koriscenja;
    const gid = seed.gradilista[0].id;
    seed.dokumenti = [{ id: 'dkS', gr: gid, autor: 'uprava', autor_uid: 'u-dir', datum: '2026-10-03', naziv: 'x.txt', tip: 'text/plain', velicina: 3, opis: '', data: 'data:,abc' }];
    const a = await boot({ supabase: true, seed });
    if (a.run('DATA.dokumenti.length') !== 1) throw new Error('dokument nije ucitan');
    if (a.run('DATA.dokumenti[0].data') !== undefined) throw new Error('view je vratio data');
    a.g.__mock._log.length = 0; const o0 = a.g._calls.open.length;
    await a.run("otvoriDokument('dkS')");
    if (!a.g.__mock._log.some(l => l.op === 'rpc' && l.name === 'dokument_podaci' && l.args.p_id === 'dkS')) throw new Error('nema rpc dokument_podaci');
    if (a.g._calls.open.length !== o0 + 1) throw new Error('dokument nije otvoren');
  });
  await acheck('upload: slika od 1 KB postaje dokument (autor = ROLE, data iz FileReader-a), 3 MB se odbija alertom', async () => {
    const a = await boot();
    const zid = a.run(T33_ZID);
    const gid = a.run(`zapById[${JSON.stringify(zid)}].grs.find(x=>grById[x])`);
    a.run(`setRole('radnik:${zid}')`);
    const radi = f => { a.run(`uploadDokument(${JSON.stringify(gid)})`); const inp = a.g.document._created.filter(c => c.tagName === 'INPUT').pop(); inp.files = [f]; inp.onchange({ target: inp }); };
    radi({ name: 'slika.jpg', type: 'image/jpeg', size: 1000 });
    const d = a.run('DATA.dokumenti[0]');
    if (!d || d.naziv !== 'slika.jpg' || d.autor !== a.run('ROLE') || d.data !== 'data:,' || d.gr !== gid) throw new Error('los dokument: ' + JSON.stringify(d));
    const al = a.g._calls.alert.length;
    radi({ name: 'velika.pdf', type: 'application/pdf', size: 3 * 1024 * 1024 });
    if (a.run('DATA.dokumenti.length') !== 1 || a.g._calls.alert.length !== al + 1) throw new Error('3 MB nije odbijen');
    a.run("setRole('all')"); radi({ name: 'u.pdf', type: 'application/pdf', size: 10 });
    if (a.run('DATA.dokumenti[DATA.dokumenti.length-1].autor') !== 'uprava') throw new Error('uprava autor');
  });


  /* ---- T32 sest uloga (migracija 14): tabovi, vidljivost gradilista, finansije, pisanje po ulozi ---- */
  section('T32 sest uloga');
  await acheck('tabovi po ulozi: uprava sve; rukovodilac 1 +naplata; rukovodilac 2 / radnik / spoljni bez naplate, bez klijenata/zaposlenih/resursa', async () => {
    const a = await boot();
    const tabs = r => { a.run(`setRole(${JSON.stringify(r)})`); return a.run('tabs().map(t=>t.id)'); };
    const svi = tabs('all');
    for (const t of ['clients', 'emps', 'resursi', 'subs', 'pay', 'nalozi']) if (!svi.includes(t)) throw new Error('direktor nema ' + t);
    const adm = tabs('admin'); if (JSON.stringify(adm) !== JSON.stringify(svi)) throw new Error('admin nema iste tabove kao direktor: ' + adm);
    const r1 = tabs('z1:fin'), r2 = tabs('z1');
    const ocekR = ['dash', 'sites', 'time', 'tasks', 'diary', 'magacin', 'nabavka'];
    if (r1.includes('pay') || JSON.stringify([...r1].sort()) !== JSON.stringify([...ocekR].sort())) throw new Error('rukovodilac 1 (sa finansijama) ne sme da ima tab Naplata (samo uprava, 2026-10-14): ' + r1);
    if (JSON.stringify([...r2].sort()) !== JSON.stringify([...ocekR].sort())) throw new Error('rukovodilac 2: ' + r2);
    const zid = a.run("(DATA.zaposleni.find(z=>!/[Rr]ukovodilac/.test(z.poz)&&(z.grs||[]).length)||{}).id");
    const pid = a.run("((DATA.podizvodjaci||[]).find(p=>(p.grs||[]).length)||{}).id");
    for (const r of ['radnik:' + zid, 'spoljni:' + pid]) { const t = tabs(r); if (JSON.stringify([...t].sort()) !== JSON.stringify([...ocekR].sort())) throw new Error(r + ': ' + t); }
    const tPro = tabs('radnik:' + zid + '|pro');   // samo projektovanje: bez magacina (sifarnik Izvodjenja), odluka 2026-10-12
    if (tPro.includes('magacin') || !tPro.includes('tasks')) throw new Error('radnik |pro: ' + tPro);
    const tIzv = tabs('z1|izv'); if (!tIzv.includes('magacin') || tIzv.includes('tasks')) throw new Error('rukovodilac |izv: ' + tIzv);
    const tFinPro = tabs('z1:fin|pro'); if (tFinPro.includes('pay')) throw new Error('rukovodilac sa finansijama samo Projektovanje ima Naplatu (Projektovanje nema situacija): ' + tFinPro);
    const tFinIzv = tabs('z1:fin|izv'); if (tFinIzv.includes('pay')) throw new Error('rukovodilac sa finansijama ima Naplatu (samo uprava): ' + tFinIzv);
    a.run("setRole('z1:fin|izv'); current='pay'; render();"); if (a.run('current') !== 'dash') throw new Error('viewPay nije vratio rukovodioca na dash');
    a.run("setRole('z1'); current='pay'; renderNav();");
    if (a.run('current') !== 'dash') throw new Error('rukovodilac 2 na nedozvoljenom tabu nije vracen na dash');
  });
  await acheck('vidljivost: radnik vidi samo gradilista svog tima, spoljni samo svoja; finansije samo uprava i rukovodilac 1', async () => {
    const a = await boot();
    const zid = a.run("(DATA.zaposleni.find(z=>!/[Rr]ukovodilac/.test(z.poz)&&(z.grs||[]).length)||{}).id");
    const pid = a.run("((DATA.podizvodjaci||[]).find(p=>(p.grs||[]).length)||{}).id");
    a.run(`setRole('radnik:${zid}')`);
    const vis = a.run('visibleSites().map(g=>g.id).sort()'), ocek = a.run(`[...zapById[${JSON.stringify(zid)}].grs].filter(x=>grById[x]).sort()`);
    if (JSON.stringify(vis) !== JSON.stringify(ocek)) throw new Error('radnik vidi ' + vis + ' a treba ' + ocek);
    if (a.run('canFinance()')) throw new Error('radnik vidi finansije');
    if (a.run('vrstaUloge()') !== 'radnik' || a.run('mogaDaUpravljam()')) throw new Error('radnik ima prava upravljanja');
    a.run(`setRole('spoljni:${pid}')`);
    const vs = a.run('visibleSites().map(g=>g.id).sort()'), ocekS = a.run(`[...DATA.podizvodjaci.find(p=>p.id===${JSON.stringify(pid)}).grs].filter(x=>grById[x]).sort()`);
    if (JSON.stringify(vs) !== JSON.stringify(ocekS)) throw new Error('spoljni vidi ' + vs + ' a treba ' + ocekS);
    if (a.run('canFinance()')) throw new Error('spoljni vidi finansije');
    a.run("setRole('z1:fin')"); if (!a.run('canFinance()') || a.run('isDirector()')) throw new Error('rukovodilac 1: canFinance treba true, isDirector false');
    a.run("current='dash'; render();"); const h = a.g.document.getElementById('view').innerHTML;
    if (!FIN_TERMS.some(t => h.includes(t))) throw new Error('rukovodilac 1 ne vidi finansijske termine na tabli');
    a.run("setRole('z1')"); if (a.run('canFinance()')) throw new Error('rukovodilac 2 vidi finansije');
    a.run("setRole('admin')"); if (!a.run('isDirector()') || a.run('jeSuper()') || !a.run('canFinance()')) throw new Error('admin: uprava da, super ne, finansije da');
    a.run("setRole('all')"); if (!a.run('jeSuper()')) throw new Error('direktor nije super');
  });
  await acheck('radnik: citanje svog gradilista (fioka, predmer bez cena, izvestaj), dnevnik pod svojim imenom, pomera samo svoj zadatak; tudje ne; bez dugmadi za pisanje', async () => {
    const a = await boot();
    const zid = a.run("(DATA.zaposleni.find(z=>!/[Rr]ukovodilac/.test(z.poz)&&(z.grs||[]).length)||{}).id");
    a.run(`setRole('radnik:${zid}')`);
    const moje = a.run('visibleSites().map(g=>g.id)'), tudje = a.run('DATA.gradilista.find(g=>!visibleSiteIds().has(g.id)).id');
    const drawer = a.g.document.getElementById('drawer');
    drawer.innerHTML = ''; a.run(`openSite(${JSON.stringify(moje[0])})`); if (!drawer.innerHTML) throw new Error('radnik ne moze da otvori svoje gradiliste');
    for (const t of FIN_TERMS) if (drawer.innerHTML.includes(t)) throw new Error('radnik vidi "' + t + '" u fioci');
    if (drawer.innerHTML.includes('Izmeni podatke') || drawer.innerHTML.includes("formUpdate(")) throw new Error('radnik ima dugmad za izmenu gradilista');
    drawer.innerHTML = ''; a.run(`openSite(${JSON.stringify(tudje)})`); if (drawer.innerHTML) throw new Error('radnik otvorio tudje gradiliste');
    a.run(`openPredmer(${JSON.stringify(moje[0])})`); if (a.run('current') !== 'predmer') throw new Error('radnik ne moze da vidi predmer svog gradilista');
    const hp = a.g.document.getElementById('view').innerHTML;
    if (hp.includes('Jed. cena') || hp.includes("formIzvedeno(")) throw new Error('radnik vidi cene ili ucitavanje izvedenog');
    a.run("current='tasks'; render();"); if (a.g.document.getElementById('view').innerHTML.includes('onclick="formTask()"')) throw new Error('radnik ima dugme Novi zadatak');
    a.run("current='nabavka'; render();"); if (a.g.document.getElementById('view').innerHTML.includes('onclick="formNarudzba()"')) throw new Error('radnik ima dugme Novo trebovanje');
    /* dnevnik pod svojim imenom */
    const n0 = a.run('DATA.dnevnik.length');
    a.run('formDiary()'); const doc = a.g.document;
    if (doc.getElementById('modal').innerHTML.includes('id="f_dautor"')) throw new Error('radnik bira autora');
    doc.getElementById('f_dgr').value = moje[0]; doc.getElementById('f_dtekst').value = 'radnik T32'; doc.getElementById('f_ddatum').value = '';
    a.run('saveDiary()');
    if (a.run('DATA.dnevnik.length') !== n0 + 1 || a.run('DATA.dnevnik[DATA.dnevnik.length-1].autor') !== zid) throw new Error('unos u dnevnik nije pod imenom radnika');
    doc.getElementById('f_dgr').value = tudje; doc.getElementById('f_dtekst').value = 'x'; a.run('saveDiary()');
    if (a.run('DATA.dnevnik.length') !== n0 + 1) throw new Error('radnik upisao dnevnik na tudje gradiliste');
    /* zadaci: svoj da, tudji ne */
    a.run(`DATA.zadaci.push({id:'t_r32',gr:${JSON.stringify(moje[0])},naziv:'moj',zad:${JSON.stringify(zid)},prio:'mid',kol:'todo',rok:todayStr()},{id:'t_r33',gr:${JSON.stringify(moje[0])},naziv:'tudji',zad:'z1',prio:'mid',kol:'todo',rok:todayStr()});`);
    a.run("dragId='t_r32'; dropTask({preventDefault(){}}, 'done'); dragId='t_r33'; dropTask({preventDefault(){}}, 'done');");
    if (a.run("DATA.zadaci.find(t=>t.id==='t_r32').kol") !== 'done') throw new Error('radnik ne moze da pomeri svoj zadatak');
    if (a.run("DATA.zadaci.find(t=>t.id==='t_r33').kol") === 'done') throw new Error('radnik pomerio tudji zadatak');
  });
  await acheck('spoljni saradnik: dnevnik pod imenom saradnika, prikaz ne puca (osobaIme), vidi podizvodjace svog gradilista bez cena', async () => {
    const a = await boot();
    const pid = a.run("((DATA.podizvodjaci||[]).find(p=>(p.grs||[]).length)||{}).id");
    a.run(`setRole('spoljni:${pid}')`);
    const g = a.run('visibleSites()[0].id');
    a.run('formDiary()'); const doc = a.g.document;
    doc.getElementById('f_dgr').value = g; doc.getElementById('f_dtekst').value = 'spoljni T32'; doc.getElementById('f_ddatum').value = '';
    a.run('saveDiary()');
    const e = a.run('DATA.dnevnik[DATA.dnevnik.length-1]');
    if (e.autor !== pid) throw new Error('autor nije saradnik: ' + e.autor);
    for (const v of ['diary', 'dash', 'sites']) { a.run(`current=${JSON.stringify(v)}; render();`); const h = a.g.document.getElementById('view').innerHTML; if (!h.length) throw new Error(v + ' prazan'); if (v === 'diary' && !h.includes(a.run(`DATA.podizvodjaci.find(p=>p.id===${JSON.stringify(pid)}).naziv`))) throw new Error('dnevnik ne prikazuje ime saradnika kao autora'); }
    a.run("setRole('all'); current='diary'; render();");
    if (/\bnull\b|undefined/.test(a.g.document.getElementById('view').innerHTML)) throw new Error('direktorov dnevnik puca na unos spoljnog saradnika');
  });
  await acheck('Admin kokpit: 5 uloga u listi, admin ne vidi opciju direktor; dodela radnika/spoljnog/rukovodioca 1 prolazi; admin ne menja direktora', async () => {
    const USERS = { 'direktor@test': { id: 'u-dir', password: 'dir' }, 'admin@test': { id: 'u-adm', password: 'a' }, 'petar@test': { id: 'u-ruk', password: 'ruk' }, 'r@test': { id: 'u-r', password: 'x' }, 's@test': { id: 'u-s', password: 'x' } };
    const profili = [{ user_id: 'u-dir', uloga: 'direktor', zaposleni_id: null, ime: 'D' }, { user_id: 'u-adm', uloga: 'admin', zaposleni_id: null, ime: 'A' }, { user_id: 'u-ruk', uloga: 'rukovodilac', zaposleni_id: 'z1', ime: 'P' }];
    /* direktor prvo zaseje demo (ne-direktor na praznoj bazi ne seje), pa admin radi nad tim seed-om */
    const s0 = await boot({ supabase: true, seed: { profili }, session: { user: { id: 'u-dir', email: 'direktor@test' } }, users: USERS });
    const seed = JSON.parse(JSON.stringify(s0.g.__mock._db)); delete seed.log_koriscenja;
    const a = await boot({ supabase: true, seed, session: { user: { id: 'u-adm', email: 'admin@test' } }, users: USERS });
    if (a.run('mode') !== 'supabase' || !a.run('isDirector()')) throw new Error('priprema: admin mode=' + a.run('mode') + ' isDirector=' + a.run('isDirector()'));
    if (!a.run("tabs().some(t=>t.id==='nalozi')")) throw new Error('admin nema Admin kokpit');
    a.run("go('nalozi')"); for (let i = 0; i < 8; i++) await new Promise(r => setImmediate(r));
    const h = a.g.document.getElementById('view').innerHTML;
    if (/<option value="direktor"/.test(h)) throw new Error('admin vidi opciju direktor');
    if (!h.includes('menja samo direktor')) throw new Error('red direktora nije zakljucan za admina');
    for (const u of ['admin', 'rukovodilac', 'radnik', 'spoljni']) if (!h.includes(`<option value="${u}"`)) throw new Error('nema uloge ' + u);
    const doc = a.g.document, set = (id, v) => { doc.getElementById(id).value = v; };
    const pid = a.run("((DATA.podizvodjaci||[]).find(p=>(p.grs||[]).length)||{}).id");
    const mods = (p, i) => { doc.getElementById('n_mp').checked = p; doc.getElementById('n_mi').checked = i; };   // stub ne cita "checked" iz HTML-a
    for (const id of ['n_mp', 'n_mi', 'n_modl']) if (!h.includes(`id="${id}"`)) throw new Error('forma nema polje modula ' + id);
    mods(true, true); set('n_email', 'r@test'); set('n_uloga', 'radnik'); set('n_zap', 'z2');
    const preA = a.g._calls.alert.length; await a.run('dodeliUlogu()');
    if (!a.g._calls.alert.slice(preA).some(m => /tačno jedan modul/.test(m))) throw new Error('radnik sa dva modula nije odbijen na klijentu');
    mods(false, true); await a.run('dodeliUlogu()'); for (let i = 0; i < 6; i++) await new Promise(r => setImmediate(r));
    set('n_email', 's@test'); set('n_uloga', 'spoljni'); set('n_sar', pid); await a.run('dodeliUlogu()'); for (let i = 0; i < 6; i++) await new Promise(r => setImmediate(r));
    mods(true, true); set('n_email', 'petar@test'); set('n_uloga', 'rukovodilac'); set('n_zap', 'z1'); doc.getElementById('n_fin').checked = true; await a.run('dodeliUlogu()'); for (let i = 0; i < 6; i++) await new Promise(r => setImmediate(r));
    const prof = a.g.__mock._db.profili;
    const r = prof.find(p => p.user_id === 'u-r'), s = prof.find(p => p.user_id === 'u-s'), p = prof.find(p => p.user_id === 'u-ruk');
    if (!r || r.uloga !== 'radnik' || r.zaposleni_id !== 'z2') throw new Error('radnik nije dodeljen: ' + JSON.stringify(r));
    if (JSON.stringify(r.moduli) !== '["izvodjenje"]') throw new Error('radnik moduli: ' + JSON.stringify(r.moduli));
    if (JSON.stringify(s.moduli) !== '["projektovanje","izvodjenje"]') throw new Error('spoljni mora imati oba modula: ' + JSON.stringify(s.moduli));
    const rpcR = a.g.__mock._log.find(l => l.op === 'rpc' && l.name === 'dodeli_ulogu' && l.args && l.args.p_email === 'r@test' && l.args.p_moduli && l.args.p_moduli.length === 1);
    if (!rpcR) throw new Error('klijent nije poslao p_moduli za radnika');
    if (!s || s.uloga !== 'spoljni' || s.saradnik_id !== pid) throw new Error('spoljni nije dodeljen: ' + JSON.stringify(s));
    if (!p || p.uloga !== 'rukovodilac' || p.vidi_finansije !== true) throw new Error('rukovodilac 1 (finansije) nije dodeljen: ' + JSON.stringify(p));
    const preAlert = a.g._calls.alert.length;
    set('n_email', 'direktor@test'); set('n_uloga', 'admin'); await a.run('dodeliUlogu()');
    if (!a.g._calls.alert.slice(preAlert).some(m => /Samo direktor/.test(m))) throw new Error('admin je promenio direktora');
    if (prof.find(x => x.user_id === 'u-dir').uloga !== 'direktor') throw new Error('direktor degradiran od strane admina');
  });

  /* ---- T31 ucitavanje izvedenog iz Excela: .xlsx parser bez biblioteke, uparivanje, klamp, samo izv, napredak ---- */
  section('T31 izvedeno iz Excela');
  await acheck('citajXlsx: fixture (openpyxl) -> 5 redova, shared strings, brojevi kao brojevi, tekst sa zarezom kao tekst', async () => {
    const a = await boot();
    const buf = fs.readFileSync(path.join(ROOT, 'test', 'fixtures', 'izvedeno.xlsx'));
    a.g.__xlsx = new Uint8Array(buf).buffer;
    const rows = await a.run('citajXlsx(__xlsx)');
    if (rows.length !== 5) throw new Error('redova: ' + rows.length + ' ' + JSON.stringify(rows));
    if (rows[0][1] !== 'Pozicija' || rows[0][4] !== 'Izvedeno') throw new Error('zaglavlje: ' + JSON.stringify(rows[0]));
    if (rows[1][1] !== 'Iskop temelja' || rows[1][3] !== 180 || rows[1][4] !== '150,5') throw new Error('red 1: ' + JSON.stringify(rows[1]));
    if (rows[2][4] !== 64 || rows[4][4] !== 999) throw new Error('brojevi: ' + JSON.stringify([rows[2], rows[4]]));
    if (!rows[3][1].includes('Nepostojeća')) throw new Error('utf-8/shared string: ' + rows[3][1]);
  });
  await acheck('upariIzvedeno + primeniIzvedeno: po imenu (normalizovano), klamp na kol, nepovezani prijavljeni, samo izv menjano, napredak osvezen; rukovodilac samo svoje', async () => {
    const a = await boot();
    a.run(`ROLE='all'; DATA.predmer=DATA.predmer.filter(x=>x.gr!=='g1');
      DATA.predmer.push({id:'i1',gr:'g1',poz:esc('Iskop temelja'),jm:'m³',kol:180,cena:22,izv:10,zaduzen:null},
                        {id:'i2',gr:'g1',poz:esc('Temelji AB'),jm:'m³',kol:64,cena:210,izv:0,zaduzen:null},
                        {id:'i3',gr:'g1',poz:esc('Armiranje ploče'),jm:'m²',kol:500,cena:9,izv:0,zaduzen:null});`);
    const buf = fs.readFileSync(path.join(ROOT, 'test', 'fixtures', 'izvedeno.xlsx'));
    a.g.__xlsx = new Uint8Array(buf).buffer;
    const rez = await a.run("citajXlsx(__xlsx).then(r=>{ const u=upariIzvedeno('g1', r); return {n:u.spojeni.map(s=>[s.x.id,s.novo]), ne:u.nepovezani}; })");
    const map = Object.fromEntries(rez.n);
    if (map.i1 !== 150.5) throw new Error('"150,5" tekst nije prosao kroz broj(): ' + map.i1);
    if (map.i2 !== 64) throw new Error('Temelji: ' + map.i2);
    if (map.i3 !== 500) throw new Error('klamp 999 -> 500 nije primenjen: ' + map.i3);
    if (rez.ne.length !== 1 || !rez.ne[0].includes('Nepostojeća')) throw new Error('nepovezani: ' + JSON.stringify(rez.ne));
    /* primena kroz dijalog: prikaziIzvedeno -> primeniIzvedeno */
    a.run("formIzvedeno('g1')");
    await a.run("citajXlsx(__xlsx).then(r=>prikaziIzvedeno('g1', upariIzvedeno('g1', r)))");
    const pre = a.run("JSON.stringify(DATA.predmer.filter(x=>x.gr==='g1').map(x=>({poz:x.poz,kol:x.kol,cena:x.cena})))");
    a.run("primeniIzvedeno('g1')");
    const izv = a.run("DATA.predmer.filter(x=>x.gr==='g1').map(x=>x.izv)");
    if (JSON.stringify(izv) !== JSON.stringify([150.5, 64, 500])) throw new Error('izv posle primene: ' + JSON.stringify(izv));
    if (a.run("JSON.stringify(DATA.predmer.filter(x=>x.gr==='g1').map(x=>({poz:x.poz,kol:x.kol,cena:x.cena})))") !== pre) throw new Error('promenjeno nesto osim izv');
    const ocek = Math.floor(100 * (150.5 * 22 + 64 * 210 + 500 * 9) / (180 * 22 + 64 * 210 + 500 * 9) + 0.5);
    if (a.run('grById.g1.napredak') !== ocek) throw new Error('napredak ' + a.run('grById.g1.napredak') + ' != ' + ocek);
    /* nalepljeno: bez zaglavlja, tab */
    a.g.document.getElementById('iz_tekst').value = 'Temelji AB\t30\nIskop temelja\t0';
    a.run("izvedenoIzTeksta('g1'); primeniIzvedeno('g1');");
    if (a.run("DATA.predmer.find(x=>x.id==='i2').izv") !== 30 || a.run("DATA.predmer.find(x=>x.id==='i1').izv") !== 0) throw new Error('nalepljeni unos nije primenjen');
    /* guard: rukovodilac tudjeg gradilista */
    const tudje = a.run("DATA.gradilista.find(g=>g.rukovodilac!=='z1').id");
    const modal = a.g.document.getElementById('modal'); modal.innerHTML = '';
    a.run(`ROLE='z1'; formIzvedeno(${JSON.stringify(tudje)});`);
    if (modal.innerHTML !== '') throw new Error('rukovodilac otvorio ucitavanje za tudje gradiliste');
    a.run("current='predmer'; PRED_ID='g1'; render();");
    if (!a.g.document.getElementById('view').innerHTML.includes("formIzvedeno('g1')")) throw new Error('rukovodilac svog gradilista nema dugme Ucitaj izvedeno');
  });

  /* ---- T30 napredak iz predmera (migracija 13): ugovoreno × izvedeno; direktor lokalno, rukovodilac sa servera; rucni napredak samo bez predmera ---- */
  section('T30 napredak iz predmera');
  await acheck('direktor: setIzv -> napredak = Σ min(izv,kol)·cena / Σ kol·cena; bez cena -> po kolicinama; bez predmera -> null i rucni ostaje', async () => {
    const a = await boot();
    const gid = a.run("ROLE='all'; DATA.predmer=DATA.predmer.filter(x=>x.gr!=='g1'); DATA.predmer.push({id:'pmA',gr:'g1',poz:'A',jm:'m',kol:10,cena:100,izv:0,zaduzen:null},{id:'pmB',gr:'g1',poz:'B',jm:'m',kol:10,cena:300,izv:0,zaduzen:null}); 'g1'");
    if (a.run("napredakIzPredmera('g1')") !== 0) throw new Error('pocetni napredak iz predmera nije 0');
    a.run("setIzv('pmB','5')");          // 5*300 / (1000+3000) = 37.5 -> 38
    if (a.run("grById.g1.napredak") !== 38) throw new Error('napredak posle setIzv = ' + a.run('grById.g1.napredak') + ' (ocekivano 38)');
    a.run("setIzv('pmA','99')");         // klamp na 10 -> (1000+1500)/4000 = 62.5 -> 63
    if (a.run("grById.g1.napredak") !== 63) throw new Error('napredak posle klampa = ' + a.run('grById.g1.napredak') + ' (ocekivano 63)');
    a.run("DATA.predmer.forEach(x=>{ if(x.gr==='g1') x.cena=0; })");
    if (a.run("napredakIzPredmera('g1')") !== 75) throw new Error('bez cena treba po kolicinama 15/20=75, dobio ' + a.run("napredakIzPredmera('g1')"));
    const bez = a.run("DATA.gradilista.find(g=>!DATA.predmer.some(x=>x.gr===g.id))");
    if (!bez) throw new Error('priprema: nema gradilista bez predmera');
    if (a.run(`napredakIzPredmera(${JSON.stringify(bez.id)})`) !== null) throw new Error('bez predmera mora biti null');
  });
  await acheck('formUpdate: sa predmerom napredak je samo prikaz (nema u_nap) i saveUpdate ga ne menja; bez predmera rucni unos radi', async () => {
    const a = await boot();
    a.run("ROLE='all'; DATA.predmer.push({id:'pmC',gr:'g1',poz:'C',jm:'m',kol:4,cena:10,izv:1,zaduzen:null}); osveziNapredak('g1');");
    const nap = a.run('grById.g1.napredak');
    a.run("formUpdate('g1')");
    const h = a.g.document.getElementById('modal').innerHTML;
    if (h.includes('id="u_nap"')) throw new Error('forma nudi rucni napredak iako postoji predmer');
    if (!h.includes('računa se iz')) throw new Error('nema objasnjenja da se napredak racuna iz predmera');
    a.g.document.getElementById('u_nap').value = '99'; a.g.document.getElementById('u_st').value = 'u toku'; a.g.document.getElementById('u_faza').value = a.run('grById.g1.faza');
    a.run("saveUpdate('g1')");
    if (a.run('grById.g1.napredak') !== nap) throw new Error('saveUpdate je pregazio izvedeni napredak: ' + a.run('grById.g1.napredak') + ' != ' + nap);
    const bez = a.run("DATA.gradilista.find(g=>!DATA.predmer.some(x=>x.gr===g.id)).id");
    a.run(`formUpdate(${JSON.stringify(bez)})`);
    if (!a.g.document.getElementById('modal').innerHTML.includes('id="u_nap"')) throw new Error('bez predmera forma mora imati rucni napredak');
  });
  await acheck('rukovodilac (cene null): izv ide na server, trigger racuna napredak, zdravlja_mojih ga vraca i klijent ga preuzme bez ponovnog slanja', async () => {
    const DIR = { user: { id: 'u-dir', email: 'direktor@test' } }, RUK = { user: { id: 'u-ruk', email: 'petar@test' } };
    const s0 = await boot({ supabase: true, seed: {}, session: DIR });
    s0.run("DATA.predmer.push({id:'pmR1',gr:'g1',poz:'R1',jm:'m',kol:10,cena:100,izv:0,zaduzen:null},{id:'pmR2',gr:'g1',poz:'R2',jm:'m',kol:10,cena:300,izv:0,zaduzen:null});");
    await s0.run('doSave()'); for (let i = 0; i < 6; i++) await new Promise(r => setImmediate(r));
    const seed = JSON.parse(JSON.stringify(s0.g.__mock._db)); delete seed.log_koriscenja;
    const a = await boot({ supabase: true, seed, session: RUK });
    if (a.run("DATA.predmer.find(x=>x.id==='pmR2').cena") !== 300) throw new Error('priprema: rukovodilac Izvodjenja vidi cenu (migracija 23)');
    a.run("setIzv('pmR2','5')");
    if (a.run('grById.g1.napredak') === 38) throw new Error('rukovodilac ne sme lokalno da racuna napredak (osveziNapredak je iza canFinance) — a napredak je vec 38');
    await a.run('doSave()'); for (let i = 0; i < 8; i++) await new Promise(r => setImmediate(r));
    const srv = a.g.__mock._db.gradilista.find(g => g.id === 'g1').napredak;
    if (srv !== 38) throw new Error('server (trigger) napredak = ' + srv + ', ocekivano 38');
    if (a.run('grById.g1.napredak') !== 38) throw new Error('klijent nije preuzeo napredak sa servera: ' + a.run('grById.g1.napredak'));
    a.g.__mock._log.length = 0;
    await a.run('doSave()'); for (let i = 0; i < 6; i++) await new Promise(r => setImmediate(r));
    if (a.g.__mock._log.some(l => l.op === 'upsert' && l.table === 'gradilista')) throw new Error('preuzeti napredak je poslat nazad kao izmena (snapshot nije uskladjen)');
  });

  /* ---- T29 novo gradiliste (2026-10-07): bez kontakt nadzora; projektovanje = ceklista svih faza/podfaza sa zaduzenim ---- */
  section('T29 novo gradiliste: ceklista faza');
  await acheck('formSite(): sve 3 faze i sve podfaze kao cekboksi + zaduzeni; cekirane postaju redovi specifikacije sa zaduzenim', async () => {
    const a = await boot();
    a.run("ROLE='all'; formSite();");
    const html = a.g.document.getElementById('modal').innerHTML;
    const ukupno = a.run("Object.values(NIVOI_DOK).reduce((s,l)=>s+l.length,0)");
    const n = (html.match(/id="f_nd_\d+"/g) || []).length, nz = (html.match(/id="f_ndz_\d+"/g) || []).length;
    if (n !== ukupno || nz !== ukupno) throw new Error(`cekboksa ${n}, zaduzenih ${nz}, ocekivano ${ukupno}`);
    for (const niv of ['IDR', 'IDP/PGD', 'PZI']) if (!html.includes('>' + niv + '<')) throw new Error('nema naslova faze ' + niv);
    if (!html.includes('(spoljni)')) throw new Error('zaduzeni ne nude spoljne saradnike');
    if (html.includes('f_nivo_fill') || html.includes('f_nadzor') || /id="f_nivo"|nivoBox|Trenutni nivo/.test(html)) throw new Error('stari cekboks sablona / polje nadzora / nivo gradilista jos postoje (nivo uklonjen 2026-10-14)');
    const doc = a.g.document, set = (id, v) => { doc.getElementById(id).value = v; };
    const kli = a.run('DATA.clijenti[0].id'), nPre = a.run('DATA.predmer.length');
    set('f_naziv', 'Pro T29'); set('f_lok', 'NS'); set('f_modul', 'projektovanje'); set('f_kli', kli); set('f_ruk', 'z1');
    set('f_poc', '2026-10-01'); set('f_rok', '2027-03-01'); set('f_cena', '100000'); set('f_tro', '');
    /* stub ne parsira HTML -> cekboksi su podrazumevano false; cekiramo 0 (IDR/PDR) i 6 (IDP-PGD/1.0 Arhitektura) */
    doc.getElementById('f_nd_0').checked = true; doc.getElementById('f_ndz_0').value = 'z2';
    doc.getElementById('f_nd_6').checked = true; doc.getElementById('f_ndz_6').value = '';
    a.run('saveSite()');
    const g = a.run("DATA.gradilista[DATA.gradilista.length-1]");
    if (g.naziv !== 'Pro T29' || g.modul !== 'projektovanje' || g.nivo !== null) throw new Error('gradiliste nije kreirano kako treba (nivo mora biti null): ' + JSON.stringify(g));
    if (a.run('modLab(grById.g8)') !== 'Projektovanje') throw new Error('modLab prikazuje nivo');
    a.run("current='predmer'; PRED_ID='g8'; render();"); if (a.run('typeof ubaciSablonNivoa') !== 'undefined' || doc.getElementById('view').innerHTML.includes('ablon nivoa')) throw new Error('sablon nivoa jos postoji');
    a.run(`formSite(${JSON.stringify(g.id)})`); if (/f_nivo|Nivo dokumentacije/.test(doc.getElementById('modal').innerHTML)) throw new Error('izmena pro gradilista nudi nivo');
    if (g.nadzor !== '') throw new Error('nadzor treba da bude prazan');
    const rows = a.run(`DATA.predmer.filter(x=>x.gr===${JSON.stringify(g.id)})`);
    if (rows.length !== 2) throw new Error('redova specifikacije: ' + rows.length + ' (ocekivano 2 cekirana), ukupno pre ' + nPre);
    if (rows[0].poz !== 'IDR — PDR' || rows[0].zaduzen !== 'z2') throw new Error('prvi red: ' + JSON.stringify(rows[0]));
    if (rows[1].poz !== 'IDP/PGD — 1.0 Arhitektura' || rows[1].zaduzen !== null) throw new Error('drugi red: ' + JSON.stringify(rows[1]));
  });

  /* ---- T28 nalozi i log (migracija 12): tab samo direktor, RPC guardovi, log dogadjaji, log van PUSH_TABLES ---- */
  section('T28 nalozi i log');
  const DIR_S28 = { user: { id: 'u-dir', email: 'direktor@test' } }, RUK_S28 = { user: { id: 'u-ruk', email: 'petar@test' } };
  const USERS28 = { 'direktor@test': { id: 'u-dir', password: 'dir' }, 'petar@test': { id: 'u-ruk', password: 'ruk' }, 'novi@test': { id: 'u-novi', password: 'x' } };
  const cekaj = async (n = 8) => { for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r)); };
  await acheck('tab Nalozi: direktor ga ima i vidi listu (bez uloge oznacen); rukovodilac ga nema i viewNalozi() ga vraca na dash', async () => {
    const a = await boot({ supabase: true, seed: {}, session: DIR_S28, users: USERS28 });
    if (!a.run("tabs().some(t=>t.id==='nalozi')")) throw new Error('direktor nema tab nalozi');
    a.run("go('nalozi')"); await cekaj();
    const h = a.g.document.getElementById('view').innerHTML;
    if (!h.includes('novi@test') || !h.includes('bez uloge')) throw new Error('lista ne prikazuje nalog bez uloge');
    if (!h.includes('petar@test')) throw new Error('lista ne prikazuje rukovodioca');
    if (!/badge b-blue">ti</.test(h)) throw new Error('sopstveni nalog nije oznacen kao "ti"');
    if (h.includes("ukloniPristup('direktor@test')")) throw new Error('nudi uklanjanje sopstvenog pristupa');
    const b = await boot({ supabase: true, seed: {}, session: RUK_S28, users: USERS28 });
    if (b.run("tabs().some(t=>t.id==='nalozi')")) throw new Error('rukovodilac ima tab nalozi');
    b.run("current='nalozi'; render();");
    if (b.run('current') !== 'dash') throw new Error('viewNalozi nije vratio rukovodioca na dash: ' + b.run('current'));
    if (b.g.__mock._log.some(l => l.op === 'rpc' && l.name === 'nalozi_pregled')) throw new Error('rukovodilac je pozvao nalozi_pregled');
  });
  await acheck('dodeliUlogu: novom nalogu rukovodilac+z2 -> profil + log uloga_promena; sebi odbijeno; ukloniPristup brise profil + log', async () => {
    const a = await boot({ supabase: true, seed: {}, session: DIR_S28, users: USERS28 });
    a.run("go('nalozi')"); await cekaj();
    a.g.document.getElementById('n_email').value = 'Novi@test'; a.g.document.getElementById('n_uloga').value = 'rukovodilac'; a.g.document.getElementById('n_zap').value = 'z2';
    const pre0 = a.g._calls.alert.length; await a.run('dodeliUlogu()');   // stub: nijedan modul cekiran → odbijeno pre RPC-a
    if (!a.g._calls.alert.slice(pre0).some(m => /bar jedan modul/.test(m))) throw new Error('rukovodilac bez modula nije odbijen');
    a.g.document.getElementById('n_mp').checked = true;
    await a.run('dodeliUlogu()'); await cekaj();
    const p = (a.g.__mock._db.profili || []).find(x => x.user_id === 'u-novi');
    if (!p || p.uloga !== 'rukovodilac' || p.zaposleni_id !== 'z2') throw new Error('profil nije napravljen: ' + JSON.stringify(p));
    if (JSON.stringify(p.moduli) !== '["projektovanje"]') throw new Error('moduli rukovodioca: ' + JSON.stringify(p.moduli));
    const lg = a.g.__mock._db.log_koriscenja || [];
    if (!lg.some(l => l.dogadjaj === 'uloga_promena' && l.detalj && l.detalj.email === 'novi@test')) throw new Error('nema uloga_promena u logu');
    const h = a.g.document.getElementById('view').innerHTML;
    if (!h.includes('Promena uloge') || !h.includes('novi@test')) throw new Error('log tabela ne prikazuje promenu uloge');
    const preAlert = a.g._calls.alert.length;
    a.g.document.getElementById('n_email').value = 'direktor@test'; a.g.document.getElementById('n_uloga').value = 'rukovodilac'; a.g.document.getElementById('n_zap').value = 'z1';
    await a.run('dodeliUlogu()'); await cekaj();
    if (!a.g._calls.alert.slice(preAlert).some(m => /Sopstvenu ulogu/.test(m))) throw new Error('dodela sebi nije odbijena');
    if ((a.g.__mock._db.profili || []).find(x => x.user_id === 'u-dir').uloga !== 'direktor') throw new Error('sopstvena uloga promenjena!');
    await a.run("ukloniPristup('novi@test')"); await cekaj();
    if ((a.g.__mock._db.profili || []).some(x => x.user_id === 'u-novi')) throw new Error('profil nije uklonjen');
    if (!lg.some(l => l.dogadjaj === 'pristup_uklonjen')) throw new Error('nema pristup_uklonjen u logu');
  });
  await acheck('log koriscenja: otvaranje pri bootu, cuvanje posle doSave (tabela -> broj), odjava PRE signOut; rukovodilac upisuje ali ne cita; nije u PUSH_TABLES', async () => {
    /* rukovodilac na praznoj bazi ne seje demo (pada u memoriju) — zato prvo direktor zaseje, pa rukovodilac dobije taj seed */
    const s0 = await boot({ supabase: true, seed: {}, session: DIR_S28, users: USERS28 });
    const seed28 = JSON.parse(JSON.stringify(s0.g.__mock._db)); delete seed28.log_koriscenja;
    const a = await boot({ supabase: true, seed: seed28, session: RUK_S28, users: USERS28 });
    if (a.run('mode') !== 'supabase') throw new Error('priprema: mode = ' + a.run('mode'));
    const lg = () => a.g.__mock._db.log_koriscenja || [];
    if (!lg().some(l => l.dogadjaj === 'otvaranje' && l.email === 'petar@test')) throw new Error('nema "otvaranje" posle boota');
    a.run("DATA.zadaci.find(t=>t.gr==='g1').naziv='T28 log';"); await a.run('doSave()'); await cekaj();
    const c = lg().find(l => l.dogadjaj === 'cuvanje');
    if (!c || !c.detalj || c.detalj.zadaci !== 1) throw new Error('nema "cuvanje" sa zadaci:1 — ' + JSON.stringify(c && c.detalj));
    if (a.run("PUSH_TABLES.includes('log_koriscenja')")) throw new Error('log_koriscenja je u PUSH_TABLES (pravilo 8)');
    if (a.run("Object.keys(DATA).includes('log_koriscenja')")) throw new Error('log_koriscenja ucitan u DATA');
    a.g.__mock._log.length = 0;
    await a.run('odjava()');
    const ops = a.g.__mock._log.map(l => l.op === 'auth.signOut' ? 'signOut' : l.op === 'log' ? 'log' : null).filter(Boolean);
    if (ops.indexOf('log') < 0 || ops.indexOf('log') > ops.indexOf('signOut')) throw new Error('odjava nije upisana pre signOut: ' + ops.join(','));
    if (!lg().some(l => l.dogadjaj === 'odjava')) throw new Error('nema "odjava" u logu');
  });
  await acheck('prijava lozinkom upisuje "prijava" pre reload-a; rpc pukne -> tab Nalozi prikazuje poruku, ne pada', async () => {
    const a = await boot({ supabase: true, seed: {}, session: null, users: USERS28 });
    a.g.document.getElementById('l_email').value = 'direktor@test'; a.g.document.getElementById('l_pw').value = 'dir';
    await a.run('prijava()'); await cekaj();
    if (!(a.g.__mock._db.log_koriscenja || []).some(l => l.dogadjaj === 'prijava' && l.email === 'direktor@test')) throw new Error('nema "prijava" u logu');
    if (a.g._calls.reload !== 1) throw new Error('reload posle prijave = ' + a.g._calls.reload);
    const b = await boot({ supabase: true, seed: {}, session: DIR_S28, users: USERS28, faults: { rpcFail: 'mreza' } });
    b.run("go('nalozi')"); await cekaj();
    const h = b.g.document.getElementById('view').innerHTML;
    if (!h.includes('Ne mogu da učitam naloge')) throw new Error('nema poruke o gresci pri rpcFail');
  });

  /* ---- T27 tema: svetla / tamna / auto (prefers-color-scheme), bez bljeska, bez hardkodiranog #fff na var(--ink) ---- */
  section('T27 tema');
  check('CSS: tamna paleta u oba oblika (sistem + rucno), svetla i na .rpt-page, bez color:#fff na pozadini var(--ink)', () => {
    const css = HTML.slice(HTML.indexOf('<style>'), HTML.indexOf('</style>'));
    if (!/@media \(prefers-color-scheme: dark\)\{\s*:root:not\(\[data-theme="light"\]\)\{/.test(css)) throw new Error('nema sistemskog tamnog bloka sa :root:not([data-theme="light"])');
    if (!/:root\[data-theme="dark"\]\{/.test(css)) throw new Error('nema :root[data-theme="dark"] bloka');
    const sys = css.slice(css.indexOf(':root:not([data-theme="light"]){')); const sysBlok = sys.slice(0, sys.indexOf('}'));
    const man = css.slice(css.indexOf(':root[data-theme="dark"]{')); const manBlok = man.slice(0, man.indexOf('}'));
    const vars = b => Object.fromEntries([...b.matchAll(/(--[a-z-]+):([^;]+);/g)].map(m => [m[1], m[2].trim()]));
    const a = vars(sysBlok), b = vars(manBlok);
    const razlike = Object.keys({ ...a, ...b }).filter(k => a[k] !== b[k]);
    if (razlike.length) throw new Error('sistemski i rucni tamni blok se razlikuju: ' + razlike.join(', '));
    for (const k of ['--paper', '--surface', '--ink', '--line', '--blue', '--amber', '--green', '--red', '--purple']) if (!a[k]) throw new Error('tamna paleta nema ' + k);
    if (!/:root, \.rpt-page\{/.test(css)) throw new Error('svetla paleta nije primenjena i na .rpt-page (izvestaj bi bio svetao tekst na belom)');
    for (const sel of ['.chip.active', '.modul-seg button.on']) {
      const i = css.indexOf(sel + '{'); const pravilo = css.slice(i, css.indexOf('}', i));
      if (/color:#fff/.test(pravilo)) throw new Error(sel + ' ima color:#fff na pozadini var(--ink) — u tamnoj temi belo na svetlom');
    }
    if (!HTML.includes("localStorage.getItem('gos_tema')")) throw new Error('nema ranog skripta u <head> (bljesak svetle teme)');
    if (HTML.includes("projektovanje:'#6B5CA5'")) throw new Error('MODUL_BOJA hardkodira ljubicastu umesto var(--purple)');
  });
  await acheck('postaviTemu: dark/light postavlja data-theme + localStorage, system uklanja; meta theme-color prati; UI segment', async () => {
    const a = await boot();
    a.run("var _ls={}; localStorage={getItem:k=>(k in _ls?_ls[k]:null), setItem:(k,v)=>{_ls[k]=String(v)}, removeItem:k=>{delete _ls[k]}};");
    const html = () => a.g.document.documentElement;
    a.run("postaviTemu('dark')");
    if (html()['data-theme'] !== 'dark') throw new Error('data-theme posle dark = ' + html()['data-theme']);
    if (a.run("localStorage.getItem('gos_tema')") !== 'dark') throw new Error('gos_tema nije dark');
    if (a.run('temaStvarna()') !== 'dark') throw new Error('temaStvarna != dark');
    a.run("postaviTemu('light')");
    if (html()['data-theme'] !== 'light') throw new Error('data-theme posle light = ' + html()['data-theme']);
    a.run("postaviTemu('system')");
    if (html()['data-theme'] !== undefined) throw new Error('system nije uklonio data-theme: ' + html()['data-theme']);
    if (a.run("localStorage.getItem('gos_tema')") !== null) throw new Error('system nije obrisao gos_tema');
    if (a.run('temaIzbor()') !== 'system') throw new Error('temaIzbor != system');
    a.run("postaviTemu('nesto')");
    if (a.run('temaIzbor()') !== 'system') throw new Error('nepoznata vrednost nije pala na system');
    if (!HTML.includes('id="temaSeg"') || !HTML.includes("postaviTemu('dark')")) throw new Error('nema segmenta Tema u sidebaru');
  });

  /* ---- T26 Rokovi: linija "danas" prati sirinu kolone sa imenima (200px desktop / 150px telefon) i nosi datum ---- */
  section('T26 Rokovi: danas');
  await acheck('Gantt: marker danas koristi var(--g-lab) i nosi danasnji datum; CSS definise 200px i 150px', async () => {
    const a = await boot();
    a.run("current='time'; render();");
    const h = a.g.document.getElementById('view').innerHTML;
    const m = h.match(/<div class="g-today"[^>]*>/); if (!m) throw new Error('nema .g-today');
    if (!m[0].includes('var(--g-lab)')) throw new Error('marker ne koristi var(--g-lab): ' + m[0]);
    if (/calc\(200px/.test(m[0])) throw new Error('marker i dalje hardkodira 200px (na telefonu kolona je 150px -> pomeren ~mesec dana)');
    const d = new Date(); const ocek = `data-d="danas ${d.getDate()}.${d.getMonth() + 1}."`;
    if (!m[0].includes(ocek)) throw new Error('marker nema danasnji datum: ' + m[0] + ' / ' + ocek);
    const css = HTML.slice(HTML.indexOf('<style>'), HTML.indexOf('</style>'));
    if (!/--g-lab:200px/.test(css)) throw new Error('CSS nema --g-lab:200px');
    if (!/--g-lab:150px/.test(css)) throw new Error('CSS nema --g-lab:150px za telefon');
    if (!/grid-template-columns:var\(--g-lab\) 1fr/.test(css)) throw new Error('g-head/g-row ne koriste var(--g-lab)');
    if (/grid-template-columns:150px 1fr/.test(css) || /grid-template-columns:200px 1fr/.test(css)) throw new Error('ostao hardkodiran 150px/200px grid');
    if (!/\.g-today::after\{content:attr\(data-d\)/.test(css)) throw new Error('::after ne cita data-d');
    if (typeof a.run('skrolujNaDanas') !== 'function') throw new Error('nema skrolujNaDanas()');
    if (!h.includes('onclick="skrolujNaDanas()"')) throw new Error('nema dugmeta "Danas" u legendi');
    // staro TODAY -> render() osvezi i marker
    a.run("TODAY=new Date(TODAY.getTime()-40*86400000); render();");
    const h2 = a.g.document.getElementById('view').innerHTML;
    if (!h2.includes(ocek)) throw new Error('posle zastarelog TODAY render() nije vratio danasnji datum na marker');
  });

  /* ---- T25 mobilni sloj: donja navigacija, brze akcije, PWA manifest ---- */
  section('T25 mobilni sloj');
  await acheck('donja navigacija: 5 dugmadi za obe uloge, aktivno prati current, "Više" otvara meni', async () => {
    const a = await boot();
    const bn = () => a.g.document.getElementById('bnav').innerHTML;
    const broj = h => (h.match(/<button/g) || []).length;
    if (broj(bn()) !== 5) throw new Error('direktor: dugmadi u bnav = ' + broj(bn()));
    if (!/class="active"[^>]*onclick="go\('dash'\)"/.test(bn())) throw new Error('dash nije aktivan na startu');
    a.run("go('tasks')");
    if (!/class="active"[^>]*onclick="go\('tasks'\)"/.test(bn())) throw new Error('posle go(tasks) aktivan nije tasks');
    if (!bn().includes("toggleSide()") || !bn().includes('Više')) throw new Error('nema "Više" (toggleSide)');
    a.run("ROLE='z1'; renderNav();");
    if (broj(bn()) !== 5) throw new Error('rukovodilac: dugmadi u bnav = ' + broj(bn()));
    for (const t of ['Naplata', 'Klijenti', 'cena', 'marž']) if (bn().toLowerCase().includes(t.toLowerCase())) throw new Error('bnav sadrzi "' + t + '"');
  });
  await acheck('brze akcije na tabli: Dnevnik/Zadatak/Trebovanje postoje i zovu postojece forme (obe uloge)', async () => {
    const a = await boot();
    const rukPro = a.run("DATA.gradilista.find(g=>jePro(g)&&g.rukovodilac).rukovodilac");
    for (const role of ['all', rukPro, 'z1']) {
      a.run(`ROLE=${JSON.stringify(role)}; current='dash'; renderNav(); render();`);
      const h = a.g.document.getElementById('view').innerHTML;
      const qa = (h.match(/<div class="qa">[\s\S]*?<\/div>/) || [''])[0];
      if (!qa) throw new Error(role + ': nema .qa bloka');
      if (role === 'z1') { if (qa.includes('formTask()')) throw new Error('rukovodilac samo Izvodjenja ima + Zadatak'); if (!qa.includes('formNarudzba()')) throw new Error('z1 nema trebovanje'); continue; }
      for (const f of ['formDiary()', 'formTask()', 'formNarudzba()']) {
        if (!qa.includes(`onclick="${f}"`)) throw new Error(role + ': nema akcije ' + f);
        if (typeof a.run(f.replace('()', '')) !== 'function') throw new Error(f + ' ne postoji');
      }
      if (/cena|marž|naplat/i.test(qa)) throw new Error(role + ': finansijski termin u brzim akcijama');
    }
  });
  check('CSS: .bnav/.qa skriveni na desktopu, definisani u <=900 bloku, skriveni na login/print', () => {
    const css = HTML.slice(HTML.indexOf('<style>'), HTML.indexOf('</style>'));
    if (!/\.bnav\{display:none\}/.test(css)) throw new Error('nema .bnav{display:none}');
    if (!/\.qa\{display:none\}/.test(css)) throw new Error('nema .qa{display:none}');
    const m900 = css.slice(css.indexOf('@media(max-width:900px)'));
    const blok = m900.slice(0, m900.indexOf('\n  }') + 4);
    if (!/\.bnav\{display:grid/.test(blok)) throw new Error('.bnav nije grid u 900 bloku');
    if (!/\.qa\{display:flex/.test(blok)) throw new Error('.qa nije flex u 900 bloku');
    if (!/\.main\{[^}]*padding-bottom:calc\(72px \+ env\(safe-area-inset-bottom\)\)/.test(blok)) throw new Error('.main nema mesto za bnav');
    if (!/body\.login \.bnav\{display:none\}/.test(css)) throw new Error('bnav nije skriven na login ekranu');
    const print = css.slice(css.indexOf('@media print'));
    if (!/\.bnav,\.qa\{display:none !important\}/.test(print)) throw new Error('bnav/qa nisu skriveni u print-u');
  });
  check('PWA: manifest validan, ikonice postoje, head ima manifest/theme-color/apple-touch-icon', () => {
    const mf = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.webmanifest'), 'utf8'));
    if (mf.start_url !== './' || mf.display !== 'standalone') throw new Error('start_url/display: ' + mf.start_url + '/' + mf.display);
    if (!Array.isArray(mf.icons) || mf.icons.length < 3) throw new Error('premalo ikonica u manifestu');
    for (const ic of mf.icons) if (!fs.existsSync(path.join(ROOT, ic.src))) throw new Error('ikonica ne postoji: ' + ic.src);
    if (!mf.icons.some(i => i.purpose === 'maskable')) throw new Error('nema maskable ikonice');
    const head = HTML.slice(0, HTML.indexOf('<style>'));
    for (const s of ['rel="manifest" href="manifest.webmanifest"', 'name="theme-color"', 'rel="apple-touch-icon" href="ikone/apple-touch-icon.png"', 'name="apple-mobile-web-app-capable"']) {
      if (!head.includes(s)) throw new Error('head nema ' + s);
    }
    for (const f of ['ikone/apple-touch-icon.png', 'ikone/icon.svg']) if (!fs.existsSync(path.join(ROOT, f))) throw new Error('nema ' + f);
  });

  /* ---- T24 zahtevi po modulima: izmena osnovnih podataka (A), kontakt investitora/nadzora (B) ----
     Stub ne parsira HTML u input-e, pa se prefill proverava u HTML-u modala, a polja se pune rucno. */
  section('T24 zahtevi po modulima (A, B)');
  await acheck('A1 formSite(id): prefill iz g, bez modul selektora/sablona, naslov izmene, dugme saveSite(id)', async () => {
    const a = await boot();
    const gid = a.run("DATA.gradilista.find(g=>g.modul==='izvodjenje').id");
    a.run(`ROLE='all'; formSite(${JSON.stringify(gid)});`);
    const html = a.g.document.getElementById('modal').innerHTML;
    const g = JSON.parse(a.run(`JSON.stringify(grById[${JSON.stringify(gid)}])`));
    const has = (id, val) => new RegExp('id="' + id + '"[^>]*value="' + String(val).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '"').test(html);
    if (!html.includes('Izmeni podatke gradilišta')) throw new Error('naslov izmene nedostaje');
    if (!has('f_naziv', g.naziv)) throw new Error('f_naziv nije prefill-ovan');
    if (!has('f_rok', g.rok)) throw new Error('f_rok nije prefill-ovan');
    if (!has('f_poc', g.pocetak)) throw new Error('f_poc nije prefill-ovan');
    if (!has('f_cena', g.budzet)) throw new Error('f_cena nije prefill-ovan');
    if (!has('f_tro', g.troskovi)) throw new Error('f_tro nije prefill-ovan');
    if (!new RegExp('<option value="' + g.klijent + '" selected>').test(html)) throw new Error('klijent nije selektovan');
    if (!new RegExp('<option value="' + g.rukovodilac + '" selected>').test(html)) throw new Error('rukovodilac nije selektovan');
    if (!new RegExp('<option value="' + g.tip + '" selected>').test(html)) throw new Error('tip nije selektovan');
    for (const x of ['id="f_modul"', 'f_faze_fill', 'f_nd_0', 'noviKlijentBox', '__novi__', 'f_nadzor']) if (html.includes(x)) throw new Error('u izmeni ne sme biti: ' + x);
    if (!html.includes("saveSite('" + gid + "')")) throw new Error('dugme ne zove saveSite(id)');
  });
  await acheck('A1b formSite() (novo): neizmenjeno — modul selektor, sablon, novi klijent, saveSite()', async () => {
    const a = await boot();
    a.run('ROLE=\'all\'; formSite();');
    const html = a.g.document.getElementById('modal').innerHTML;
    for (const x of ['id="f_modul"', 'f_nd_0', 'f_ndz_0', 'noviKlijentBox', '__novi__', 'Novo gradilište', 'onclick="saveSite()"', 'id="raznoBox"', 'dodajRaznoRed()'])
      if (!html.includes(x)) throw new Error('create forma nema: ' + x);
    if (html.includes('f_faze_fill')) throw new Error('sablon faza se vise ne nudi pri kreiranju (2026-10-09)');
    if (html.includes('f_nadzor')) throw new Error('polje kontakt nadzora je uklonjeno iz forme (2026-10-07)');
  });
  await acheck('A1c formSite(id) kao rukovodilac ne otvara modal', async () => {
    const a = await boot();
    const modal = a.g.document.getElementById('modal'), pre = modal.innerHTML;
    const own = a.run("DATA.gradilista.find(g=>g.rukovodilac==='z1').id");
    a.run(`ROLE='z1'; formSite(${JSON.stringify(own)});`);
    if (modal.innerHTML !== pre) throw new Error('modal popunjen za rukovodioca');
  });
  await acheck('A2 saveSite(id): menja u mestu (lok, povrsina), prazan rok zadrzava stari, bez duplikata', async () => {
    const a = await boot();
    const gid = a.run("DATA.gradilista.find(g=>g.modul==='izvodjenje').id");
    const G = JSON.stringify(gid), doc = a.g.document;
    const pre = JSON.parse(a.run(`JSON.stringify(grById[${G}])`)), nPre = a.run('DATA.gradilista.length');
    const set = (id, val) => { doc.getElementById(id).value = val; };
    set('f_naziv', 'Izmenjen naziv'); set('f_lok', 'Nova lokacija & 2'); set('f_povrsina', '123'); set('f_nadzor', 'Ing. Test, 060 1');
    set('f_kli', ''); set('f_ruk', ''); set('f_poc', ''); set('f_rok', ''); set('f_tip', ''); set('f_cena', ''); set('f_tro', '');
    a.run(`ROLE='all'; saveSite(${G});`);
    const g = JSON.parse(a.run(`JSON.stringify(grById[${G}])`));
    if (g.lok !== 'Nova lokacija &amp; 2') throw new Error('lok = ' + g.lok);
    if (g.povrsina !== 123) throw new Error('povrsina = ' + g.povrsina);
    if (g.naziv !== 'Izmenjen naziv') throw new Error('naziv = ' + g.naziv);
    if (g.rok !== pre.rok) throw new Error('rok promenjen: ' + g.rok + ' (bio ' + pre.rok + ')');
    if (g.pocetak !== pre.pocetak) throw new Error('pocetak promenjen');
    if (g.rukovodilac !== pre.rukovodilac || !g.rukovodilac) throw new Error('rukovodilac promenjen/prazan');
    if (g.klijent !== pre.klijent) throw new Error('klijent promenjen');
    for (const k of ['napredak', 'status', 'faza', 'potroseno', 'naplaceno', 'modul', 'tip', 'budzet', 'troskovi', 'id'])
      if (g[k] !== pre[k]) throw new Error(k + ' promenjen: ' + g[k] + ' (bio ' + pre[k] + ')');
    if (a.run('DATA.gradilista.length') !== nPre) throw new Error('napravljen duplikat gradilista');
  });
  await acheck('A3 saveSite(id) kao rukovodilac na SVOM gradilistu: nista se ne menja (samo direktor)', async () => {
    const a = await boot();
    const own = a.run("DATA.gradilista.find(g=>g.rukovodilac==='z1').id");
    const doc = a.g.document;
    doc.getElementById('f_naziv').value = 'Hakovan'; doc.getElementById('f_lok').value = 'X'; doc.getElementById('f_ruk').value = 'z2';
    const before = a.run('JSON.stringify(DATA)');
    a.run(`ROLE='z1'; saveSite(${JSON.stringify(own)});`);
    a.run("ROLE='all';");
    if (a.run('JSON.stringify(DATA)') !== before) throw new Error('DATA promenjen kao rukovodilac');
  });
  await acheck('A4 promena tipa revalidira fazu; ista faza ostaje kad tip nije menjan', async () => {
    const a = await boot();
    const doc = a.g.document, set = (id, val) => { doc.getElementById(id).value = val; };
    const gid = a.run("DATA.gradilista.find(g=>g.modul==='izvodjenje'&&g.tip==='visokogradnja').id"), G = JSON.stringify(gid);
    set('f_naziv', 'Tip test'); set('f_lok', 'L'); set('f_povrsina', ''); set('f_nadzor', ''); set('f_kli', ''); set('f_ruk', ''); set('f_poc', ''); set('f_rok', ''); set('f_cena', ''); set('f_tro', '');
    a.run(`ROLE='all'; grById[${G}].faza='Temelji';`);          // postoji samo u visokogradnji
    set('f_tip', 'visokogradnja'); a.run(`saveSite(${G});`);
    if (a.run(`grById[${G}].faza`) !== 'Temelji') throw new Error('faza promenjena bez promene tipa');
    set('f_tip', 'niskogradnja'); a.run(`saveSite(${G});`);
    if (a.run(`grById[${G}].tip`) !== 'niskogradnja') throw new Error('tip nije promenjen');
    if (!a.run(`fazeZa(grById[${G}]).includes(grById[${G}].faza)`)) throw new Error('faza nije validna za novi tip: ' + a.run(`grById[${G}].faza`));
    if (a.run(`grById[${G}].faza`) !== 'Priprema terena') throw new Error('faza = ' + a.run(`grById[${G}].faza`));
  });
  await acheck('A5 drawer: "Izmeni podatke" samo za direktora', async () => {
    const a = await boot();
    const gid = a.run("DATA.gradilista.find(g=>g.rukovodilac==='z1').id"), G = JSON.stringify(gid);
    const dr = a.g.document.getElementById('drawer');
    a.run(`ROLE='all'; openSite(${G});`);
    if (!dr.innerHTML.includes('Izmeni podatke')) throw new Error('direktor nema dugme');
    if (!dr.innerHTML.includes("formSite('" + gid + "')")) throw new Error('dugme ne zove formSite(id)');
    a.run(`ROLE='z1'; openSite(${G});`);
    const html = dr.innerHTML;
    a.run("ROLE='all';");
    if (!html.includes('Ažuriraj')) throw new Error('rukovodilac izgubio Ažuriraj (test nije validan)');
    if (html.includes('Izmeni podatke')) throw new Error('rukovodilac vidi dugme');
  });
  await acheck('B drawer: kontakt investitora (naziv, osoba, tel, mail); nepoznat klijent -> "—" bez izuzetka; rukovodilac vidi', async () => {
    const a = await boot();
    const gid = a.run("DATA.gradilista[0].id"), G = JSON.stringify(gid);
    const k = JSON.parse(a.run(`JSON.stringify(cliById[grById[${G}].klijent])`));
    const dr = a.g.document.getElementById('drawer');
    a.run(`ROLE='all'; openSite(${G});`);
    for (const x of ['Investitor', '<b>' + k.naziv + '</b>', k.osoba, k.tel, k.mail]) if (!dr.innerHTML.includes(x)) throw new Error('drawer nema: ' + x);
    const ruk = a.run(`grById[${G}].rukovodilac`);
    a.run(`ROLE=${JSON.stringify(ruk)}; openSite(${G});`);
    const rh = dr.innerHTML; a.run("ROLE='all';");
    if (!rh.includes(k.osoba)) throw new Error('rukovodilac ne vidi kontakt investitora');
    a.run(`grById[${G}].klijent='nema';`);
    let thr = null; try { a.run(`openSite(${G});`); } catch (e) { thr = e.message; }
    if (thr) throw new Error('izuzetak za nepoznatog klijenta: ' + thr);
    if (!/Investitor<\/span><span class="v">—<\/span>/.test(dr.innerHTML)) throw new Error('nema "—" za nepoznatog klijenta');
  });

  /* ---- T24b zahtevi po modulima (C, D, E) ---- */
  section('T24b zahtevi po modulima (C, D, E)');
  await acheck('C1 predmer: kolona Zadužen i za izvođenje (direktor + rukovodilac), th==td, ✎ samo direktor', async () => {
    const a = await boot();
    const gid = a.run("DATA.gradilista.find(g=>g.modul==='izvodjenje'&&DATA.predmer.some(r=>r.gr===g.id)).id"), G = JSON.stringify(gid);
    const dirH = a.run(`ROLE='all'; PRED_ID=${G}; viewPredmer()`);
    const ruk = a.run(`grById[${G}].rukovodilac`);
    const rukH = a.run(`ROLE=${JSON.stringify(ruk)}; PRED_ID=${G}; viewPredmer()`);
    a.run("ROLE='all';");
    if (!dirH.includes('<th>Zadužen</th>')) throw new Error('direktor: nema zaglavlja Zadužen za izvođenje');
    if (!rukH.includes('<th>Zadužen</th>')) throw new Error('rukovodilac: nema zaglavlja Zadužen za izvođenje');
    if (!dirH.includes("formPredmerRed('" + gid + "','")) throw new Error('direktor nema ✎ kontrolu');
    if (rukH.includes('formPredmerRed')) throw new Error('rukovodilac vidi ✎ kontrolu');
    for (const [n, h] of [['direktor', dirH], ['rukovodilac', rukH]]) {
      const p = tableAsymmetry(h); if (p.length) throw new Error(n + ' th!=td: ' + JSON.stringify(p[0]));
    }
  });
  await acheck('C2 formPredmerRed(gid,pid): prefill + "Izmena pozicije"; bez pid = "Nova pozicija"', async () => {
    const a = await boot();
    const modal = a.g.document.getElementById('modal');
    a.run("ROLE='all'; formPredmerRed('g5','pm3');");
    const h = modal.innerHTML;
    if (!h.includes('Izmena pozicije') || !h.includes('Sačuvaj izmene')) throw new Error('nema naslova/dugmeta izmene');
    if (!h.includes('Zidanje giter blokom d=25')) throw new Error('poz nije popunjen');
    if (!h.includes("savePredmerRed('g5','pm3')")) throw new Error('dugme ne zove savePredmerRed(gid,pid)');
    if (!/<option selected>m²<\/option>/.test(h)) throw new Error('JM nije prefill');
    a.run("formPredmerRed('g5');");
    if (!modal.innerHTML.includes('Nova pozicija') || modal.innerHTML.includes('Izmena pozicije')) throw new Error('bez pid nije "Nova pozicija"');
    if (!/<select id="f_pm_zad">/.test(modal.innerHTML)) throw new Error('izvođenje nema select Zadužen u formi');
  });
  await acheck('E openTroskovi + drawer: dobavljač/faktura, Ukupno, "Svi troškovi (N)"; rukovodilac ništa', async () => {
    const a = await boot();
    const modal = a.g.document.getElementById('modal'), dr = a.g.document.getElementById('drawer');
    a.run("DATA.troskovi_st.push({id:'tr_e1', gr:'g5', datum:'2026-02-01', opis:'Beton E', kat:'materijal', iznos:1000, dobavljac:'Beton Test d.o.o.', fakt:'2024-117'}, {id:'tr_e2', gr:'g5', datum:'2026-03-01', opis:'Armatura E', kat:'materijal', iznos:500, dobavljac:'', fakt:'', prilog:{name:'f.pdf', tip:'application/pdf', data:'data:,x'}});");
    const uk = a.run("troskoviZa('g5').reduce((s,t)=>s+(+t.iznos||0),0)"), n = a.run("troskoviZa('g5').length");
    a.run("ROLE='all'; openSite('g5');");
    const dh = dr.innerHTML;
    if (!dh.includes('Svi troškovi (' + n + ')')) throw new Error('drawer nema "Svi troškovi (' + n + ')"');
    if (!dh.includes('Beton Test d.o.o. · fakt. 2024-117')) throw new Error('drawer ne prikazuje dobavljača/fakturu');
    a.run("openTroskovi('g5');");
    const h = modal.innerHTML;
    for (const x of ['Ukupno', 'Beton Test d.o.o.', '2024-117', n + ' stavki', 'Br. fakture', "otvoriTrosakPrilog('tr_e2')", 'overflow-x:auto', a.run(`fmtEur(${uk})`)]) if (!h.includes(x)) throw new Error('modal nema: ' + x);
    if (h.indexOf('Armatura E') < 0 || h.indexOf('Armatura E') > h.indexOf('Beton E')) throw new Error('nije sortirano po datumu opadajuće (noviji prvi)');
    const tp = tableAsymmetry(h); if (tp.length) throw new Error('modal th!=td: ' + JSON.stringify(tp[0]));
    const ruk = a.run("grById.g5.rukovodilac");
    modal.innerHTML = '';
    a.run(`ROLE=${JSON.stringify(ruk)}; openTroskovi('g5'); openSite('g5');`);
    const mh = modal.innerHTML, rh = dr.innerHTML;
    a.run("ROLE='all';");
    if (mh !== '') throw new Error('rukovodilac otvorio modal troškova');
    if (rh.includes('Svi troškovi (') || rh.includes('Beton Test')) throw new Error('rukovodilac vidi troškove u drawer-u');
    if (!rh.includes('Ažuriraj')) throw new Error('drawer rukovodioca nije otvoren (test nije validan)');
  });

  /* ---- T24c zahtevi po modulima (F, G) ---- */
  section('T24c zahtevi po modulima (F, G)');
  const isoPlus = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  await acheck('F1 formEmp(id): izmena zaposlenog (direktor prefill, bez gradilišta; rukovodilac ništa)', async () => {
    const a = await boot();
    const modal = a.g.document.getElementById('modal');
    const ime = a.run("zapById.z1.ime");
    modal.innerHTML = '';
    a.run("ROLE='z1'; formEmp('z1'); ROLE='all';");
    if (modal.innerHTML !== '') throw new Error('rukovodilac je otvorio formu izmene');
    a.run("ROLE='all'; formEmp('z1');");
    const h = modal.innerHTML;
    if (!h.includes('Izmeni zaposlenog') || !h.includes(ime) || !h.includes("saveEmp('z1')")) throw new Error('nema naslova/imena/dugmeta izmene');
    if (h.includes('Gradilišta (može više)')) throw new Error('izmena prikazuje izbor gradilišta');
    a.run("formEmp();");
    if (!modal.innerHTML.includes('Novi zaposleni') || !modal.innerHTML.includes('Gradilišta (može više)')) throw new Error('create put se promenio');
  });
  await acheck('F1 saveEmp(id): izmena in-place, grs netaknut; rukovodilac ništa', async () => {
    const a = await boot();
    const doc = a.g.document, set = (id, val) => { doc.getElementById(id).value = val; };
    const poz = a.run("zapById.z1.poz"), grs0 = a.run("JSON.stringify(zapById.z1.grs)"), n = a.run("DATA.zaposleni.length");
    a.run("formEmp('z1');");
    set('f_eime', 'Petar & Co'); set('f_etel', ''); set('f_epoz', poz); set('f_est', 'Odsutan'); set('f_eopis', 'opis <b>');
    const before = a.run("JSON.stringify(DATA)");
    a.run("ROLE='z1'; saveEmp('z1'); ROLE='all';");
    if (a.run("JSON.stringify(DATA)") !== before) throw new Error('rukovodilac je izmenio zaposlenog');
    a.run("saveEmp('z1');");
    const z = JSON.parse(a.run("JSON.stringify(zapById.z1)"));
    if (z.ime !== 'Petar &amp; Co') throw new Error('ime = ' + z.ime);
    if (z.tel !== '—' || z.status !== 'Odsutan') throw new Error('tel/status: ' + z.tel + '/' + z.status);
    if (z.opis !== 'opis &lt;b&gt;') throw new Error('opis = ' + z.opis);
    if (JSON.stringify(z.grs) !== grs0) throw new Error('grs promenjen');
    if (a.run("DATA.zaposleni.length") !== n) throw new Error('izmena je dodala zaposlenog');
  });
  await acheck('F2 viewEmpPage: Zaduženi resursi + Izmeni podatke (samo direktor)', async () => {
    const a = await boot();
    a.run("ROLE='all'; openEmpPage('z1'); render();");
    let h = a.run("viewEmpPage()");
    if (!h.includes('Zaduženi resursi') || !h.includes('Nema zaduženih resursa.')) throw new Error('nema praznog stanja kartice');
    if (!h.includes('Izmeni podatke') || !h.includes("formEmp('z1')")) throw new Error('nema dugmeta Izmeni podatke');
    a.run(`DATA.resursi.push({id:'r_t24', tip:'vozilo', naziv:'Kombi T24', oznaka:'BG-123', istice:'${isoPlus(-1)}', gr:null, zaduzen:'z1'}); render();`);
    h = a.run("viewEmpPage()");
    if (!h.includes('Kombi T24') || !h.includes('Baza / kancelarija') || !h.includes('Zaduženi resursi (1)')) throw new Error('resurs nije prikazan');
    if (!h.includes('isteklo')) throw new Error('istekao resurs nije označen');
  });
  await acheck('G2/G4 setAdmVazi + computeAlerts: ističe/isteklo, vidi i rukovodilac, prazno briše, rukovodilac ništa', async () => {
    const a = await boot();
    const gid = a.run("DATA.gradilista.find(g=>g.rukovodilac&&g.modul==='izvodjenje').id"), G = JSON.stringify(gid);
    const ruk = a.run(`grById[${G}].rukovodilac`);
    const alerts = () => JSON.stringify(a.run("computeAlerts()").map(x => x.tekst));
    a.run(`ROLE=${JSON.stringify(ruk)}; setAdmVazi(${G},'polisa','${isoPlus(10)}'); ROLE='all';`);
    if (a.run(`admInfo(grById[${G}],'polisa').vazi_do`)) throw new Error('rukovodilac je postavio vazi_do');
    a.run(`setAdmVazi(${G},'polisa','${isoPlus(10)}');`);
    if (a.run(`admInfo(grById[${G}],'polisa').vazi_do`) !== isoPlus(10)) throw new Error('vazi_do nije postavljen');
    if (!alerts().includes('Polisa osiguranja ističe za')) throw new Error('nema upozorenja "ističe za": ' + alerts());
    a.run(`setAdmVazi(${G},'polisa','${isoPlus(-1)}');`);
    if (!alerts().includes('Polisa osiguranja isteklo')) throw new Error('nema upozorenja "isteklo"');
    a.run(`ROLE=${JSON.stringify(ruk)};`);
    const rk = alerts(); a.run("ROLE='all';");
    if (!rk.includes('Polisa osiguranja isteklo')) throw new Error('rukovodilac ne vidi upozorenje svog gradilišta');
    a.run(`setAdmVazi(${G},'podugovori','${isoPlus(5)}');`);
    a.run(`setAdmVazi(${G},'polisa','');`);
    if ('vazi_do' in JSON.parse(a.run(`JSON.stringify(admInfo(grById[${G}],'polisa'))`))) throw new Error('ključ vazi_do nije uklonjen');
    if (alerts().includes('Polisa osiguranja')) throw new Error('upozorenje ostalo posle brisanja');
    a.run(`setAdmVazi(${G},'nepoznato','${isoPlus(5)}');`);
    if (a.run(`'nepoznato' in (grById[${G}].adm||{})`)) throw new Error('nepoznat ključ prihvaćen');
  });
  await acheck('G3 drawer Administracija: unos datuma samo direktor, "važi do" za sve', async () => {
    const a = await boot();
    const dr = a.g.document.getElementById('drawer');
    const gid = a.run("DATA.gradilista.find(g=>g.rukovodilac&&g.modul==='izvodjenje').id"), G = JSON.stringify(gid);
    const ruk = a.run(`grById[${G}].rukovodilac`);
    a.run(`setAdmVazi(${G},'ugovor','${isoPlus(100)}');`);
    a.run(`ROLE='all'; openSite(${G});`);
    const dh = dr.innerHTML;
    a.run(`ROLE=${JSON.stringify(ruk)}; openSite(${G});`);
    const rh = dr.innerHTML;
    a.run("ROLE='all';");
    if (!dh.includes('setAdmVazi(') || !dh.includes('važi do')) throw new Error('direktor: nema unosa/prikaza važi do');
    if (!rh.includes('važi do')) throw new Error('rukovodilac ne vidi važi do');
    if (rh.includes('setAdmVazi(')) throw new Error('rukovodilac vidi unos datuma');
    if (dh.includes("setAdmVazi('" + gid + "','podugovori'")) throw new Error('unos datuma na podugovorima');
  });

  /* ---- T22 revizija 2026-10-03: CSS, guardovi, pretraga, brojevi ---- */
  section('T22 revizija 2026-10-03');
  check('CSS: .kpis3 (jedna klasa), jedini repeat(3,1fr), .site-line, Space Grotesk ima fallback', () => {
    if (!HTML.includes('.kpis3{')) throw new Error('nema .kpis3{');
    if (HTML.includes('.kpis.kpis3')) throw new Error('.kpis.kpis3 (mora jedna klasa)');
    const n3 = HTML.split('grid-template-columns:repeat(3,1fr)').length - 1;
    if (n3 !== 1) throw new Error('repeat(3,1fr) pojavljivanja: ' + n3 + ' (ocekivano 1 — CSS pravilo)');
    if ((HTML.match(/class="grid kpis kpis3"/g) || []).length !== 2) throw new Error('ocekivana 2 upotrebe class="grid kpis kpis3"');
    if (HTML.indexOf('.kpis3{') > HTML.indexOf('.kpis{grid-template-columns:1fr 1fr}')) throw new Error('.kpis3 mora biti pre media query-ja');
    if (!HTML.includes('.site-line{')) throw new Error('nema .site-line{');
    if (/Space Grotesk'[;"}]/.test(HTML)) throw new Error('Space Grotesk bez generic fallback-a');
  });
  await acheck('formUpdate kao rukovodilac na TUDJEM gradilistu ne otvara modal', async () => {
    const a = await boot();
    const gid = a.run("DATA.gradilista.find(g=>g.rukovodilac!=='z1').id");
    const modal = a.g.document.getElementById('modal');
    const pre = modal.innerHTML;
    a.run(`ROLE='z1'; formUpdate(${JSON.stringify(gid)});`);
    if (modal.innerHTML !== pre) throw new Error('modal popunjen za tudje gradiliste ' + gid);
    if (a.g.document.getElementById('modalWrap').classList.contains('on')) throw new Error('modalWrap otvoren');
    const own = a.run("DATA.gradilista.find(g=>g.rukovodilac==='z1').id");
    a.run(`formUpdate(${JSON.stringify(own)});`);
    if (modal.innerHTML === pre) throw new Error('modal se ne otvara ni za SVOJE gradiliste (preterani guard)');
  });
  await acheck('openPredmer kao rukovodilac na TUDJEM gradilistu ne menja current', async () => {
    const a = await boot();
    const gid = a.run("DATA.gradilista.find(g=>g.rukovodilac!=='z1').id");
    const preP = a.run('PRED_ID');
    a.run(`ROLE='z1'; current='dash'; openPredmer(${JSON.stringify(gid)});`);
    if (a.run('PRED_ID') === gid) throw new Error('PRED_ID postavljen na tudje gradiliste ' + gid);
    if (a.run('PRED_ID') !== preP) throw new Error('PRED_ID promenjen: ' + a.run('PRED_ID'));
    if (a.run('current') !== 'dash') throw new Error('current = ' + a.run('current'));
    const own = a.run("DATA.gradilista.find(g=>g.rukovodilac==='z1').id");
    a.run(`openPredmer(${JSON.stringify(own)});`);
    if (a.run('current') !== 'predmer') throw new Error('openPredmer ne radi za SVOJE gradiliste: ' + a.run('current'));
  });
  await acheck('setRole(rukovodilac) vraca dashSort sa finansijske kolone na smart', async () => {
    const a = await boot();
    const k = a.run("ROLE='all'; dashSort={key:'cena',dir:-1}; setRole('z1'); dashSort.key");
    if (k !== 'smart') throw new Error('dashSort.key = ' + k);
    const k2 = a.run("setRole('all'); dashSort={key:'cena',dir:-1}; setRole('all'); dashSort.key");
    if (k2 !== 'cena') throw new Error('direktor je izgubio svoj sort: ' + k2);
  });
  await acheck('pretraga gradilista nalazi "Petrović & Sinovi" (escapovan podatak, sirov upit)', async () => {
    const a = await boot();
    const r = a.run(`(()=>{ ROLE='all'; const c=JSON.parse(JSON.stringify(DATA.gradilista[0]));
      c.id='g_t22'; c.naziv=esc('Petrović & Sinovi'); DATA.gradilista.push(c); rebuildMaps();
      siteQuery='ović & s'; const h=sitesCards(); siteQuery=''; return h.includes('Petrović &amp; Sinovi'); })()`);
    if (r !== true) throw new Error('sitesCards ne nalazi gradiliste po "ović & s"');
  });
  await acheck('savePredmerRed: kol iz number inputa ("1.250" -> 1.25, "0" -> 0, "" -> 1)', async () => {
    const a = await boot();
    const d = a.g.document; const gid = a.run('DATA.gradilista[0].id');
    const unesi = kol => {
      d.getElementById('f_pm_poz').value = 'T22'; d.getElementById('f_pm_jm').value = 'm³';
      d.getElementById('f_pm_cena').value = '10'; d.getElementById('f_pm_kol').value = kol;
      a.run(`ROLE='all'; savePredmerRed(${JSON.stringify(gid)});`);
      return a.run('DATA.predmer[DATA.predmer.length-1].kol');
    };
    const k1 = unesi('1.250'); if (k1 !== 1.25) throw new Error('"1.250" -> ' + k1);
    const k2 = unesi('0'); if (k2 !== 0) throw new Error('"0" -> ' + k2);
    const k3 = unesi(''); if (k3 !== 1) throw new Error('"" -> ' + k3);
  });
  await acheck('saveUpdate: prazan napredak ne resetuje na 0', async () => {
    const a = await boot();
    const d = a.g.document; const gid = a.run('DATA.gradilista[0].id');
    const st = a.run('DATA.gradilista[0].status'), fz = a.run('DATA.gradilista[0].faza');
    a.run('DATA.gradilista[0].napredak=37;');
    d.getElementById('u_nap').value = ''; d.getElementById('u_st').value = st; d.getElementById('u_faza').value = fz;
    a.run(`ROLE='all'; saveUpdate(${JSON.stringify(gid)});`);
    const n = a.run('DATA.gradilista[0].napredak');
    if (n !== 37) throw new Error('napredak = ' + n + ', ocekivano 37');
    d.getElementById('u_nap').value = '55'; d.getElementById('u_st').value = st;
    a.run(`saveUpdate(${JSON.stringify(gid)});`);
    if (a.run('DATA.gradilista[0].napredak') !== 55) throw new Error('upis 55 ne radi');
  });
  await acheck('izvozPredmer: ime fajla cuva dijakritike (Vračar-Šabac)', async () => {
    const a = await boot();
    const gid = a.run('DATA.gradilista[0].id');
    a.run("DATA.gradilista[0].naziv=esc('Vračar Šabac');");
    const preN = a.g.document._created.length;
    a.run(`ROLE='all'; izvozPredmer(${JSON.stringify(gid)});`);
    const l = a.g.document._created.slice(preN).find(c => c.tagName === 'A');
    if (!l) throw new Error('link nije napravljen');
    if (!String(l.download).includes('Vračar-Šabac')) throw new Error('download = ' + l.download);
  });
  await acheck('viewPredmer: podnaslov projektovanja bez "sa cenama" za rukovodioca, sa njima za direktora', async () => {
    const a = await boot();
    const g = a.run("(()=>{const g=DATA.gradilista.find(g=>g.modul==='projektovanje'); return {id:g.id, r:g.rukovodilac};})()");
    a.run(`PRED_ID=${JSON.stringify(g.id)}; ROLE=${JSON.stringify(g.r)};`);
    const hr = a.run('viewPredmer()');
    if (hr.includes('sa cenama')) throw new Error('rukovodilac vidi "sa cenama"');
    if (!hr.includes('Usluge sa zaduženima i realizacijom.')) throw new Error('nema rukovodiocevog podnaslova');
    a.run("ROLE='all';");
    if (!a.run('viewPredmer()').includes('Usluge sa cenama, zaduženima i realizacijom.')) throw new Error('direktor ne vidi pun podnaslov');
  });

  /* ---- T21 ziv datum: TODAY se osvezava, ne zamrzava pri ucitavanju ---- */
  section('T21 ziv datum');
  await acheck('TODAY zastareo (tab preko noci) -> render() ga vrati na danas; todayStr prati', async () => {
    const a = await boot();
    const danas = a.run('todayStr()');
    a.run("TODAY=new Date(TODAY.getTime()-86400000);");          // simuliraj: ucitano juce
    if (a.run('todayStr()') === danas) throw new Error('priprema: TODAY nije pomeren');
    a.run("current='dash'; render();");
    if (a.run('todayStr()') !== danas) throw new Error('render() nije osvezio TODAY: ' + a.run('todayStr()') + ' != ' + danas);
    if (a.run('osveziDanas()') !== false) throw new Error('osveziDanas vraca true bez promene datuma');
    const h = a.g.document.getElementById('view').innerHTML;
    const d = new Date(); const ocek = d.getDate() + '. ';
    if (!h.includes(ocek)) throw new Error('zaglavlje ne prikazuje danasnji dan (' + ocek + ')');
  });

  /* ---- T20 responsive: sidebar na telefonu (scrim) ---- */
  section('T20 sidebar/scrim');
  await acheck('toggleSide otvara sidebar + scrim; tap na scrim (closeDrawer) zatvara oba; go() gasi scrim', async () => {
    const a = await boot();
    const side = a.g.document.getElementById('side'), scrim = a.g.document.getElementById('scrim');
    a.run('toggleSide()');
    if (!side.classList.contains('open') || !scrim.classList.contains('on')) throw new Error('toggleSide nije otvorio sidebar+scrim');
    a.run('closeDrawer()');
    if (side.classList.contains('open') || scrim.classList.contains('on')) throw new Error('closeDrawer nije zatvorio sidebar/scrim');
    a.run('toggleSide()'); a.run("go('sites')");
    if (side.classList.contains('open') || scrim.classList.contains('on')) throw new Error('go() nije ugasio sidebar/scrim');
    a.run('toggleSide(); toggleSide();');
    if (side.classList.contains('open') || scrim.classList.contains('on')) throw new Error('dupli toggle nije vratio u zatvoreno');
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
    for (const t of ['gradilista_v', 'predmer_v', 'podizvodjaci_v', 'situacije_v']) if (!sel.includes(t)) throw new Error('nije citao ' + t + ' (citao: ' + [...new Set(sel)].join(',') + ')');
    for (const t of ['gradilista', 'predmer', 'podizvodjaci', 'troskovi_st', 'situacije']) if (sel.includes(t)) throw new Error('rukovodilac citao tabelu ' + t);
    const g = a.run("DATA.gradilista.find(g=>g.id==='g1')");
    if (!g) throw new Error('g1 nije ucitan');
    for (const k of ['budzet', 'troskovi', 'potroseno', 'naplaceno']) if (g[k] != null) throw new Error('gradiliste nosi ' + k + '=' + g[k]);
    // migracija 23: cena samo na redovima gradilista Izvodjenja koja VODI (mock ne filtrira redove po gradilistu, pa tudji redovi ostaju null)
    if (a.run("DATA.predmer.some(x=>x.cena!=null && !(grById[x.gr]&&smemNa(x.gr)&&!jePro(grById[x.gr])))")) throw new Error('predmer nosi cenu tudjeg/projektantskog gradilista');
    if (a.run("DATA.predmer.some(x=>x.cena==null && grById[x.gr]&&smemNa(x.gr)&&!jePro(grById[x.gr]))")) throw new Error('rukovodilac Izvodjenja ne vidi cenu svog predmera');
    if (a.run("DATA.podizvodjaci.some(x=>x.cena!=null)")) throw new Error('podizvodjac nosi cenu');
    if (a.run('DATA.troskovi_st.length')) throw new Error('troskovi_st nisu prazni');
    if (a.run("DATA.situacije.some(x=>x.iznos!=null)")) throw new Error('situacije nose iznos bez finansija (migracija 19: situacije_v)');   // situacije se citaju (svoje), iznos = null
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

  await acheck('rpc pukne: rukovodilac dobija "—" (null), NE lokalnu formulu nad null finansijama', async () => {
    const a = await boot({ supabase: true, seed: await punSeed(), session: RUK_S, faults: { rpcFail: 'mreza' } });
    if (a.run('mode') !== 'supabase') throw new Error('rpc greska je oborila ucitavanje');
    const s = a.run("zdravlje(grById['g1'])");
    if (s !== null) throw new Error('skor bez servera mora biti null, dobijeno: ' + s);
    const cell = a.run("zdrCell(grById['g1'])");
    if (!cell.includes('—') || cell.includes('null')) throw new Error('zdrCell bez servera: ' + cell);
    a.run("current='dash'; render();");
    const h = a.g.document.getElementById('view').innerHTML;
    if (/\bnull\b/.test(h) || /NaN/.test(h)) throw new Error('kontrolna tabla prikazuje null/NaN bez skora sa servera');
    const b = await boot({ supabase: true, seed: await punSeed(), session: DIR_S, faults: { rpcFail: 'mreza' } });
    const sd = b.run("zdravlje(grById['g1'])");
    if (!Number.isFinite(sd)) throw new Error('direktor mora racunati lokalno i bez rpc-a: ' + sd);
  });

  await acheck('seed (opt.sve): upsert samo za tabele BEZ finansijskih kolona; gradilista/predmer/podizvodjaci insert/update', async () => {
    const a = await boot({ supabase: true, seed: {}, session: DIR_S });
    if (a.run('mode') !== 'supabase') throw new Error('seed na praznu bazu nije prosao (mode=' + a.run('mode') + ')');
    const log = a.g.__mock._log;
    const upsFin = log.filter(l => l.op === 'upsert' && !l.via && ['gradilista', 'predmer', 'podizvodjaci'].includes(l.table) && l.cols.some(c => ['budzet', 'cena'].includes(c)));
    /* mock odbija upsert sa finansijskom kolonom (42501) — da je poslat, seed bi pao; proveri i da redovi postoje */
    if (!a.g.__mock._count('gradilista')) throw new Error('gradilista nisu zasejana');
    if (!a.g.__mock._count('predmer')) throw new Error('predmer nije zasejan');
    const upsCl = log.filter(l => l.op === 'upsert' && !l.via && l.table === 'clijenti');
    if (!upsCl.length) throw new Error('clijenti (bez fin kolona) treba i dalje jednim upsertom');
    if (upsFin.length && a.run('saveErr')) throw new Error('upsert finansijske tabele je poslat i pao: ' + a.run('saveErr'));
  });

  /* ---- T23 revizija 2026-10-03: cuvanje — reset, PUSHED po zahtevu, prilog NULL, odjava ceka, fail-closed boot ---- */
  section('T23 revizija: cuvanje');

  await acheck('resetDemo kao direktor prolazi na bazi bez SELECT-a na fin kolonama (nema upsert-a fin tabela)', async () => {
    const a = await boot({ supabase: true, seed: await punSeed(), session: DIR_S });
    a.g.__mock._log.length = 0;
    await a.run('resetDemo()');
    for (let i = 0; i < 10; i++) await new Promise(r => setImmediate(r));
    const err = a.run('saveErr');
    if (err) throw new Error('reset pao: ' + err);
    const bad = a.g.__mock._log.filter(l => l.op === 'upsert' && !l.via && ['gradilista', 'predmer', 'podizvodjaci'].includes(l.table));
    if (bad.length) throw new Error('reset i dalje salje upsert fin tabela: ' + bad.map(b => b.table).join(','));
    const n = a.run('DEMO.gradilista.length');
    if (a.g.__mock._count('gradilista') !== n) throw new Error('posle reseta gradilista u bazi: ' + a.g.__mock._count('gradilista') + ' != ' + n);
  });

  await acheck('insert prodje, update padne -> ubaceni red je u PUSHED, sledeci upis ga NE ubacuje ponovo', async () => {
    const a = await boot({ supabase: true, seed: await punSeed(), session: DIR_S });
    a.g.__mock._faults.updateFail = { zadaci: 'pukao update' };
    const stari = a.run('DATA.zadaci[0].id');
    a.run(`ROLE='all'; DATA.zadaci.push({id:'t_t23', gr:'g1', naziv:'T23', kol:'todo', prio:'mid', rok:todayStr(), zad:null}); DATA.zadaci[0].naziv='T23 izmena';`);
    await a.run('doSave()');
    if (!a.run('saveErr')) throw new Error('priprema: update nije pao');
    delete a.g.__mock._faults.updateFail;
    a.g.__mock._log.length = 0;
    await a.run('doSave()');
    if (a.run('saveErr')) throw new Error('drugi upis pao: ' + a.run('saveErr'));
    const ins = a.g.__mock._log.filter(l => l.op === 'upsert' && !l.via && l.table === 'zadaci' && l.keys.includes('t_t23'));
    if (ins.length) throw new Error('t_t23 je ponovo poslat kao INSERT (dupli kljuc 23505 na pravoj bazi)');
    const upd = a.g.__mock._log.find(l => l.via === 'update' && l.table === 'zadaci' && l.keys.includes(stari));
    if (!upd) throw new Error('izmenjeni stari zadatak nije poslat u drugom pokusaju');
  });

  await acheck('uklanjanje priloga salje prilog:null (PATCH bez kljuca bi ostavio fakturu u bazi)', async () => {
    const a = await boot({ supabase: true, seed: await punSeed(), session: DIR_S });
    a.run(`ROLE='all'; DATA.troskovi_st.push({id:'tr_t23', gr:'g1', datum:todayStr(), opis:'T23', kat:'materijal', iznos:5, dobavljac:'', fakt:'', prilog:{name:'f.pdf', tip:'application/pdf', data:'data:,x'}});`);
    await a.run('doSave()');
    const pre = (a.g.__mock._db.troskovi_st || []).find(x => x.id === 'tr_t23');
    if (!pre || !pre.prilog) throw new Error('priprema: prilog nije u bazi');
    a.run("ukloniTrosakPrilog('tr_t23')");
    await a.run('doSave()');
    const post = (a.g.__mock._db.troskovi_st || []).find(x => x.id === 'tr_t23');
    if (post.prilog !== null) throw new Error('prilog posle uklanjanja u bazi: ' + JSON.stringify(post.prilog));
  });

  await acheck('odjava ceka upis: izmena iz debounce prozora stize u bazu PRE signOut-a', async () => {
    const a = await boot({ supabase: true, seed: await punSeed(), session: DIR_S });
    a.g.__mock._log.length = 0;
    a.run("ROLE='all'; DATA.zadaci[0].naziv='T23 pre odjave'; saveState();");
    await a.run('odjava()');
    const log = a.g.__mock._log;
    const iUp = log.findIndex(l => l.op === 'upsert' && l.table === 'zadaci');
    const iOut = log.findIndex(l => l.op === 'auth.signOut');
    if (iUp < 0) throw new Error('izmena nije upisana pre odjave');
    if (iOut < 0) throw new Error('signOut nije pozvan');
    if (iUp > iOut) throw new Error('signOut pre upisa (upis bi bio ubijen reload-om)');
    if (a.g._calls.reload !== 1) throw new Error('reload = ' + a.g._calls.reload);
    const db = (a.g.__mock._db.zadaci || []).find(z => z.naziv === 'T23 pre odjave');
    if (!db) throw new Error('izmena nije u bazi posle odjave');
  });

  await acheck('baza podesena, biblioteka ne moze da se ucita -> ekran greske sa "Pokušaj ponovo", NE demo rezim', async () => {
    const a = await boot({ supabase: true, seed: await punSeed(), session: DIR_S });
    a.run("window.supabase={createClient(){ throw new Error('CDN blokiran'); }}; supa=null; mode='memorija'; DATA={};");
    await a.run('pokreni()');
    const h = a.g.document.getElementById('view').innerHTML;
    if (!h.includes('Pokušaj ponovo')) throw new Error('nema ekrana greske: ' + h.slice(0, 120));
    if (h.includes('Učitavam')) throw new Error('ostao "Učitavam…"');
    if (!a.g.document.body.classList.contains('login')) throw new Error('ekran greske nije centriran (body.login)');
    if (a.run('DATA && DATA.gradilista && DATA.gradilista.length')) throw new Error('demo podaci ucitani uprkos gresci');
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
    if (!/nije dodeljena uloga/.test(v)) throw new Error('nema poruke o nepovezanom nalogu');
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
  section('T17 zdravlje / bez marze / tim');

  await acheck('zdravlje(g) je isto za direktora i rukovodioca (svako gradiliste)', async () => {
    const r = app.run("DATA.zaposleni.filter(z=>/[Rr]ukovodilac/.test(z.poz)).map(z=>z.id)[0]");
    const razlike = app.run(`(()=>{ const out=[]; DATA.gradilista.forEach(g=>{
      ROLE='all'; const a=zdravlje(g); ROLE=${JSON.stringify(r)}; const b=zdravlje(g); ROLE='all';
      if(a!==b) out.push(g.id+': '+a+' vs '+b); }); return out; })()`);
    if (razlike.length) throw new Error('skor zavisi od uloge: ' + razlike.join(', '));
  });

  await acheck('marza je uklonjena (2026-10-12): nema je u izvoru, ni u jednom pogledu/fioci/preseku/izvestaju za direktora; zavrsen projekat = 100', async () => {
    const src = require('fs').readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    if (/marz|marž/i.test(src)) throw new Error('index.html i dalje pominje marzu');
    if (app.run('typeof marzaPct') !== 'undefined' || app.run('typeof ostvMarzaPct') !== 'undefined') throw new Error('funkcije marze postoje');
    const nadji = () => { const d = app.g.document; return ['view', 'drawer', 'rpt', 'modal'].map(id => d.getElementById(id).innerHTML).join('\n'); };
    app.run("ROLE='all'; MODUL='sve';");
    for (const t of app.run('tabs().map(t=>t.id)')) { app.run(`current=${JSON.stringify(t)}; render();`); if (/marž|marz/i.test(nadji())) throw new Error('marza u pogledu ' + t); }
    for (const gid of app.run('DATA.gradilista.map(g=>g.id)')) {
      app.run(`openSite(${JSON.stringify(gid)}); openPresek(${JSON.stringify(gid)});`); if (/marž|marz/i.test(nadji())) throw new Error('marza u fioci/preseku ' + gid);
      app.run(`openIzvestaj(${JSON.stringify(gid)});`); if (/marž|marz/i.test(nadji())) throw new Error('marza u izvestaju ' + gid);
    }
    app.run("closeDrawer(); current='dash'; render();");
    const z = app.run("zdravlje({id:'zz', status:'zavrseno', rok:todayStr(), napredak:100, budzet:100, troskovi:100, potroseno:100, naplaceno:0})");
    if (z !== 100) throw new Error('zavrsen projekat != 100: ' + z);
  });

  await acheck('alarm kad stvarni troskovi premase plan (direktor), a ne za rukovodioca', async () => {
    const gid = 'g_t17';
    app.run(`(()=>{ DATA.gradilista.push({id:${JSON.stringify(gid)}, modul:'izvodjenje', tip:'visokogradnja', naziv:'T17 prekoracenje',
      lok:'x', klijent:DATA.clijenti[0].id, rukovodilac:DATA.zaposleni[0].id, pocetak:'2026-01-01', rok:plusDays(200),
      napredak:50, status:'u toku', faza:'x', budzet:1000000, troskovi:800000, potroseno:0, naplaceno:500000, adm:{}});
      DATA.troskovi_st.push({id:'tr_t17', gr:${JSON.stringify(gid)}, datum:todayStr(), opis:'x', kat:'Ostalo', iznos:850000});
      rebuildMaps(); })()`);
    const dir = app.run(`(ROLE='all', JSON.stringify(computeAlerts().filter(a=>a.gr===${JSON.stringify(gid)})))`);
    if (!/premašili plan/.test(dir) || /marž/i.test(dir)) throw new Error('alarm za prekoracenje plana fali ili pominje marzu: ' + dir);
    const r = app.run("DATA.zaposleni.filter(z=>/[Rr]ukovodilac/.test(z.poz)).map(z=>z.id)[0]");
    app.run(`DATA.gradilista.find(g=>g.id===${JSON.stringify(gid)}).rukovodilac=${JSON.stringify(r)}; rebuildMaps();`);
    const ruk = app.run(`(ROLE=${JSON.stringify(r)}, (()=>{ const s=JSON.stringify(computeAlerts().filter(a=>a.gr===${JSON.stringify(gid)})); ROLE='all'; return s; })())`);
    app.run(`DATA.gradilista=DATA.gradilista.filter(g=>g.id!==${JSON.stringify(gid)}); DATA.troskovi_st=DATA.troskovi_st.filter(t=>t.id!=='tr_t17'); rebuildMaps();`);
    if (/marža/i.test(ruk)) throw new Error('rukovodilac vidi marzu u alarmu: ' + ruk);
  });

  await acheck('oznake bez marze: fioka ima "Utrošeno do sada" i "Naplaćeno", presek "Planirani troškovi" i "Utrošeno do sada", kartica "Ugovorena cena"', async () => {
    app.run("ROLE='all'; MODUL='sve'; current='sites'; render();");
    if (!app.g.document.getElementById('view').innerHTML.includes('Ugovorena cena')) throw new Error('kartica nema Ugovorena cena');
    const gid = app.run('DATA.gradilista[0].id');
    app.run(`openSite(${JSON.stringify(gid)});`);
    const dr = app.g.document.getElementById('drawer').innerHTML;
    if (!dr.includes('Utrošeno do sada') || !dr.includes('Naplaćeno')) throw new Error('fioka nema Utrošeno do sada/Naplaćeno');
    app.run(`openPresek(${JSON.stringify(gid)});`);
    const pr = app.g.document.getElementById('rpt').innerHTML;   // presek/izvestaj idu u #rpt, ne u #drawer
    if (!pr.includes('Planirani troškovi') || !pr.includes('Utrošeno do sada')) throw new Error('presek nema troskove');
    app.run("closeDrawer(); current='dash'; render();");
  });

  await acheck('formTim: osoba sa drugog gradilista je oznacena; rukovodilac ne vidi ime tudjeg gradilista', async () => {
    const r = app.run("DATA.zaposleni.filter(z=>/[Rr]ukovodilac/.test(z.poz)).map(z=>z.id)[0]");
    const moje = app.run(`DATA.gradilista.find(g=>g.rukovodilac===${JSON.stringify(r)}).id`);
    const drugi = app.run(`DATA.zaposleni.find(z=>(z.grs||[]).length && !(z.grs||[]).includes(${JSON.stringify(moje)}))`);
    if (!drugi) return;
    const tudjeNaziv = app.run(`grById[${JSON.stringify(drugi.grs[0])}].naziv`);
    app.run(`setRole(${JSON.stringify(r)}); formTim(${JSON.stringify(moje)});`);   // smemNa trazi i ULOGA (pregled 2026-10-22), ne samo ROLE
    const htmlR = app.g.document.getElementById('modal').innerHTML;
    app.run(`setRole('all'); formTim(${JSON.stringify(moje)});`);
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

  await acheck('novo gradiliste (Izvodjenje) kroz saveSite NE seje zadatke (2026-10-09); sablon ostaje dugme u fioci', async () => {
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
    if (postZ !== preZ) throw new Error('kreiranje je dodalo ' + (postZ - preZ) + ' zadataka — ne sme (odluka 2026-10-09)');
    const gid = app.run('DATA.gradilista[DATA.gradilista.length-1].id');
    app.run(`openSite(${JSON.stringify(gid)})`);
    const dr = app.g.document.getElementById('drawer').innerHTML;
    if (dr.includes('ubaciSablonFaza') || dr.includes('<h4>Zadaci')) throw new Error('fioka Izvodjenja i dalje nudi zadatke / sablon (uklonjeno 2026-10-11)');
  });


  /* ---- T12 racunska ispravnost i otpornost prikaza ---- */
  section('T12 brojevi i otpornost');

  await acheck('naplataPct ne vraca NaN/Infinity kad je budzet 0', async () => {
    const r = app.run("naplataPct({id:'x0', budzet:0, naplaceno:0})");
    const r2 = app.run("naplataPct({id:'x0', budzet:0, naplaceno:100})");
    if (!Number.isFinite(r) || !Number.isFinite(r2)) throw new Error(`budzet 0 -> ${r} / ${r2}`);
  });

  await acheck('fmtEurK ispravno prikazuje negativne iznose', async () => {
    const a = app.run('fmtEurK(-2000000)'), b = app.run('fmtEurK(2000000)');
    if (!/^-2[.,]00M RSD$/.test(a)) throw new Error(`fmtEurK(-2000000) = ${a}, ocekivano oblik -2,00M RSD (dobija se "${a}")`);
    if (!/^1\.234\.567 RSD$/.test(app.run('fmtEur(1234567)')) || HTML.includes('€')) throw new Error('valuta nije RSD svuda: ' + app.run('fmtEur(1234567)'));
    if (!/^2[.,]00M RSD$/.test(b)) throw new Error('fmtEurK(2000000) = ' + b);
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
    const prazne = a.run('TABLES').filter(t => t !== 'dokumenti' && t !== 'rad_na_zadatku' && a.g.__mock._count(t) === 0);   // dokumenti: demo nema priloge; rad_na_zadatku: demo nema sesije (namerno)
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

  /* ---- T48 xlsx pisac (bez biblioteke) ---- */
  /* ---- T60 (2026-10-22): validacija id-jeva pri ucitavanju — red sa navodnikom/zagradom u id-u ili FK polju se izbacuje (stored XSS kroz onclick) ---- */
  section('T60 validacija id-jeva');
  await acheck('ocistiIdeve: redovi sa neispravnim id/FK poljem (i grs) se izbacuju pri ucitavanju iz baze, ispravni ostaju; render nema sirovu injekciju; normalizeData je zove', async () => {
    const zao = "x') onclick=\"alert(1)\" data-x='";
    const seed0 = await boot({ supabase: true, seed: {}, session: { user: { id: 'u-dir', email: 'direktor@test' } } });
    const seed = JSON.parse(JSON.stringify(seed0.g.__mock._db));
    const nG = seed.gradilista.length, nS = seed.situacije.length, nD = seed.dnevnik.length, nZ = seed.zaposleni.length;
    seed.gradilista.push({ ...seed.gradilista[0], id: zao, naziv: 'Zlo gradiliste' });
    seed.situacije.push({ ...seed.situacije[0], id: 's-zlo', gr: zao });
    seed.dnevnik.push({ ...seed.dnevnik[0], id: 'd-zlo', autor: "z1'); alert(1); ('" });
    seed.zaposleni_gradiliste.push({ zaposleni_id: 'z1', gradiliste_id: zao, aktivan: true });
    const a = await boot({ supabase: true, seed, session: { user: { id: 'u-dir', email: 'direktor@test' } } });
    if (a.run('DATA.gradilista.length') !== nG || a.run('DATA.situacije.length') !== nS || a.run('DATA.dnevnik.length') !== nD || a.run('DATA.zaposleni.length') !== nZ) throw new Error('redovi nisu izbaceni / ispravni su izbaceni: ' + [a.run('DATA.gradilista.length'), nG, a.run('DATA.situacije.length'), nS, a.run('DATA.dnevnik.length'), nD].join(','));
    if (a.run("DATA.gradilista.some(g=>g.naziv==='Zlo gradiliste')") || a.run("DATA.situacije.some(s=>s.id==='s-zlo')") || a.run("DATA.dnevnik.some(d=>d.id==='d-zlo')") || a.run("DATA.zaposleni.some(z=>(z.grs||[]).some(x=>!/^[A-Za-z0-9_.:|-]{1,80}$/.test(x)))")) throw new Error('zao red/veza je ostala u DATA');
    for (const v of ['dash', 'sites', 'diary', 'pay']) { a.run(`setRole('all'); current=${JSON.stringify(v)}; render();`); if (a.g.document.getElementById('view').innerHTML.includes("onclick=\"alert(1)")) throw new Error('injekcija u ' + v); }
    if (!a.run("['g1','pm1791218425024-x0','mg-sf-a-001','u-dir','direkcija','4.4.1D','a|b:c'].every(idOk)") || a.run("['', null].some(x=>!idOk(x))") || a.run(`idOk(${JSON.stringify(zao)})`) || a.run("idOk('a'.repeat(81))")) throw new Error('idOk pravilo');
    const b = await boot(); const pre = b.run('DATA.dnevnik.length'); b.run("DATA.dnevnik.push({id:'d-x', datum:todayStr(), gr:'g1', autor:\"z1')\", tekst:'x'}); normalizeData();"); if (b.run('DATA.dnevnik.length') !== pre) throw new Error('normalizeData ne cisti id-jeve');
  });

  /* ---- T59 (2026-10-21): AI asistent direktora — tab samo direktor, alati nad DATA, petlja tool_use, esc teksta modela, greske ---- */
  section('T59 AI asistent');
  await acheck('plutajuce dugme + panel samo direktor (nema taba; admin/rukovodilac bez dugmeta, aiOtvori ne otvara); panel: 4 brojke danas + 5 cipova + unos; alati: gradilista/detalj/situacija/upozorenja/dnevnik oblik i guardovi; nepoznat id → greska; aiPitaj van direktora ne zove funkciju', async () => {
    const a = await boot();
    a.run("setRole('all')");
    if (a.run("tabs().some(t=>t.id==='asistent')")) throw new Error('asistent je tab (treba plutajuce dugme)');
    a.run('render()'); if (!a.g.document.getElementById('aiDugme').classList.contains('vidi') || !/Asistent/.test(a.g.document.getElementById('aiDugme').innerHTML)) throw new Error('direktor nema dugme asistenta');
    for (const r of ['admin', 'dirpro', 'z1|izv', 'radnik:z10|pro']) { a.run(`setRole(${JSON.stringify(r)}); aiOtvori();`); if (a.g.document.getElementById('aiDugme').classList.contains('vidi') || a.g.document.getElementById('aiPanel').classList.contains('on') || a.run('AI_OTVOREN')) throw new Error(r + ' vidi dugme/panel asistenta'); }
    a.run("setRole('all'); aiOtvori();");
    const v = a.g.document.getElementById('aiPanel').innerHTML;
    if (!a.g.document.getElementById('aiPanel').classList.contains('on') || !v.includes('id="aiUnos"') || (v.match(/data-p="/g) || []).length !== 9 || !v.includes('aiPitajIzPolja()') || !v.includes('situacija čeka pregled') || !v.includes('aiZatvori()')) throw new Error('panel bez polja/cipova/brojki');
    a.run('aiZatvori()'); if (a.g.document.getElementById('aiPanel').classList.contains('on') || a.g.document.getElementById('aiPanel').innerHTML !== '') throw new Error('panel se nije zatvorio');
    const br = a.run('aiBroj()'); if (typeof br !== 'number' || br !== a.run("DATA.situacije.filter(x=>vidimGr(x.gr)&&imaNaplatu(grById[x.gr])&&pregledSit(x)==='na_pregledu').length + computeAlerts().filter(x=>x.sev==='red').length")) throw new Error('aiBroj');
    const gl = await a.run("aiIzvrsiAlat('gradilista',{})");
    if (!Array.isArray(gl) || gl.length !== a.run('visibleSites().length') || !gl.every(g => 'zdravlje_0_100' in g && 'naplaceno' in g && 'dana_do_roka' in g && 'situacije' in g)) throw new Error('alat gradilista: ' + JSON.stringify(gl[0]).slice(0, 200));
    if ((await a.run("aiIzvrsiAlat('gradilista',{modul:'projektovanje'})")).some(g => g.modul !== 'projektovanje')) throw new Error('filter modula');
    a.run("MODUL='projektovanje'"); const glP = await a.run("aiIzvrsiAlat('gradilista',{})"); const upP = await a.run("aiIzvrsiAlat('upozorenja',{})");
    if (glP.length !== gl.length || a.run('MODUL') !== 'projektovanje' || upP.length < gl.length - gl.length || !upP.some(u => !a.run(`jePro(grById[${JSON.stringify(u.gradiliste_id)}])`))) throw new Error('alati zavise od segmenta modula: ' + glP.length + '/' + gl.length);
    a.run("MODUL='sve'");
    const gd = await a.run("aiIzvrsiAlat('gradiliste_detalj',{id:'g1'})");
    if (!gd.predmer || !Array.isArray(gd.situacije_lista) || !gd.troskovi || !Array.isArray(gd.zadaci_lista) || !Array.isArray(gd.dnevnik_poslednji) || !Array.isArray(gd.upozorenja) || /&amp;|&lt;/.test(JSON.stringify(gd))) throw new Error('alat gradiliste_detalj: ' + JSON.stringify(gd).slice(0, 300));
    if (!(await a.run("aiIzvrsiAlat('gradiliste_detalj',{id:'nema-takvog'})")).greska || !(await a.run("aiIzvrsiAlat('situacija_detalj',{id:'x'})")).greska || !(await a.run("aiIzvrsiAlat('dnevnik',{gr:'x'})")).greska || !(await a.run("aiIzvrsiAlat('nepoznat',{})")).greska) throw new Error('nepoznat id/alat nije greska');
    const sid = a.run("DATA.situacije.find(s=>stavkeZa(s.id).length&&!jePro(grById[s.gr])).id");
    const sd = await a.run(`aiIzvrsiAlat('situacija_detalj',{id:${JSON.stringify(sid)}})`);
    if (!sd.stavke || !sd.stavke.length || !('kumulativ' in sd.stavke[0]) || !('razlika_preko_ugovora' in sd.stavke[0]) || !('jed_cena' in sd.stavke[0]) || !sd.gradiliste || !Array.isArray(sd.prethodne_situacije) || !Array.isArray(sd.istorija_pregleda)) throw new Error('alat situacija_detalj: ' + JSON.stringify(sd).slice(0, 300));
    const up = await a.run("aiIzvrsiAlat('upozorenja',{})"); if (!Array.isArray(up) || up.length !== a.run('computeAlerts().length') || (up.length && !('tekst' in up[0]))) throw new Error('alat upozorenja');
    const dn = await a.run("aiIzvrsiAlat('dnevnik',{gr:'g1'})"); if (!Array.isArray(dn) || dn.some(d => d.gradiliste_id !== 'g1') || dn.length !== a.run("DATA.dnevnik.filter(d=>d.gr==='g1').length")) throw new Error('alat dnevnik');
    const an = await a.run("aiIzvrsiAlat('angazovanost',{})"); if (!an.od || !Array.isArray(an.redovi)) throw new Error('alat angazovanost (demo)');
    if (!a.run('aiSistem()').includes('direktor') || !a.run('aiSistem()').includes(a.run('todayStr()'))) throw new Error('sistemski prompt');
    a.run("setRole('z1|izv')"); await a.run("aiPitaj('test')"); if (a.run('AI_RAZGOVOR.length') !== 0) throw new Error('rukovodilac je pokrenuo asistenta');
    a.run("setRole('all')"); await a.run("aiPitaj('test')"); if (!/Supabase/.test(a.run('AI_GRESKA'))) throw new Error('demo rezim bez poruke: ' + a.run('AI_GRESKA'));
  });
  await acheck('petlja: tool_use → alat u klijentu → tool_result → odgovor; sistem/alati u telu; tekst modela se esc-uje, **bold**/liste/linkovi [[gr]]/[[sit]] (nepostojeci id se brise); log ai_pitanje; cap krugova; funkcija nije deploy-ovana / bez kljuca → poruka bez izuzetka; dugme u detalju situacije', async () => {
    const tela = [];
    const ai = (body, n) => { tela.push(JSON.parse(JSON.stringify(body)));   // snimak: AI_PORUKE je ziv niz
      if (n === 1) return { data: { stop_reason: 'tool_use', content: [{ type: 'text', text: 'Gledam gradilišta.' }, { type: 'tool_use', id: 'tu1', name: 'gradilista', input: {} }] }, error: null };
      return { data: { stop_reason: 'end_turn', content: [{ type: 'text', text: '**Kasne**: 1 projekat.\n- Liman Park [[gr:g1]] kasni\n<script>alert(1)</script> nema [[sit:nepostoji]] kraj' }] }, error: null }; };
    const a = await boot({ supabase: true, seed: {}, faults: { ai } });
    a.run("setRole('all')"); await a.run("aiPitaj('Koji projekti kasne?')");
    if (tela.length !== 2) throw new Error('broj poziva funkcije: ' + tela.length);
    const sys = tela[0].system; if (!Array.isArray(sys) || !sys[0].text.includes('GradnjaOS') || !sys[0].cache_control || tela[0].tools.length !== 6 || !tela[0].tools[5].cache_control || tela[0].tools[0].cache_control || tela[0].messages.length !== 1 || tela[0].messages[0].role !== 'user') throw new Error('telo 1 (kesiranje): ' + JSON.stringify(tela[0]).slice(0, 300));
    if (!tela[0].messages[0].content[0].cache_control || tela[0].messages[0].content[0].text !== 'Koji projekti kasne?') throw new Error('poslednja poruka bez cache_control: ' + JSON.stringify(tela[0].messages[0]));
    const m2 = tela[1].messages; if (m2.length !== 3 || m2[1].role !== 'assistant' || m2[2].role !== 'user' || m2[2].content[0].type !== 'tool_result' || m2[2].content[0].tool_use_id !== 'tu1' || !m2[2].content[0].cache_control || m2[1].content[0].cache_control) throw new Error('telo 2: ' + JSON.stringify(m2).slice(0, 300));
    if (a.run('typeof AI_PORUKE[0].content') !== 'string' || a.run('JSON.stringify(AI_PORUKE).includes("cache_control")')) throw new Error('markeri kesa su upisani u AI_PORUKE (treba samo u kopiju)');
    const rez = JSON.parse(m2[2].content[0].content); if (!Array.isArray(rez) || rez.length !== a.run('visibleSites().length')) throw new Error('tool_result nije rezultat alata gradilista');
    if (a.run('AI_RAZGOVOR.length') !== 2 || a.run('AI_GRESKA') !== '' || a.run('AI_ZAUZET')) throw new Error('stanje razgovora: ' + a.run('JSON.stringify(AI_RAZGOVOR)'));
    if (!a.run('AI_OTVOREN') || !a.g.document.getElementById('aiPanel').classList.contains('on')) throw new Error('pitanje nije otvorilo panel'); const v = a.g.document.getElementById('aiPanel').innerHTML;
    if (!v.includes('<b>Kasne</b>') || !v.includes("openSite('g1')") || v.includes('<script>') || !v.includes('&lt;script&gt;') || v.includes('nepostoji') || !v.includes('class="ai-li"')) throw new Error('render odgovora: ' + v.slice(v.indexOf('ai-msg bot'), v.indexOf('ai-msg bot') + 400));
    const lg = a.g.__mock._log.filter(l => l.op === 'log'); const zadnji = a.g.__mock._db.log_koriscenja.slice(-1)[0];
    if (!zadnji || zadnji.dogadjaj !== 'ai_pitanje' || !zadnji.detalj || JSON.stringify(zadnji.detalj.alati) !== '["gradilista"]' || 'tekst' in zadnji.detalj || !zadnji.detalj.tokeni || zadnji.detalj.tokeni.ulaz !== 0) throw new Error('log ai_pitanje: ' + JSON.stringify(zadnji));
    // draft u polju prezivljava render() iz drugog razloga; alat koji baci izuzetak → {greska} u tool_result, ne pad petlje
    a.g.document.getElementById('aiUnos').value = 'nenaslato pitanje'; a.run('render()');
    if (a.g.document.getElementById('aiUnos').value !== 'nenaslato pitanje' || !a.run('AI_OTVOREN')) throw new Error('render() obrisao draft / zatvorio panel');
    const telaX = []; const x = await boot({ supabase: true, seed: {}, faults: { ai: (body, n) => { telaX.push(JSON.parse(JSON.stringify(body))); return n === 1 ? { data: { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'tx', name: 'gradiliste_detalj', input: { id: { ne: 'string' } } }] }, error: null } : { data: { stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }] }, error: null }; } } });
    x.run("setRole('all'); grById=new Proxy(grById,{get:(o,k)=>{ if(typeof k==='string'&&k==='[object Object]') throw new Error('bum'); return o[k]; }});"); await x.run("aiPitaj('x')");
    const tr = JSON.parse(telaX[1].messages[2].content[0].content); if (!tr.greska || x.run('AI_GRESKA') !== '' || x.run('AI_RAZGOVOR[1].tekst') !== 'ok') throw new Error('izuzetak alata nije pretvoren u greska: ' + JSON.stringify(tr) + ' ' + x.run('AI_GRESKA'));
    // cap krugova
    const b = await boot({ supabase: true, seed: {}, faults: { ai: () => ({ data: { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'x', name: 'upozorenja', input: {} }] }, error: null }) } });
    b.run("setRole('all')"); await b.run("aiPitaj('petlja')");
    if (b.g.__mock._log.filter(l => l.op === 'functions.invoke').length !== 6 || !/Prekinuto/.test(b.run('(AI_RAZGOVOR[1]||{}).tekst||""'))) throw new Error('cap krugova: ' + b.g.__mock._log.filter(l => l.op === 'functions.invoke').length + ' poziva; greska=' + b.run('AI_GRESKA') + ' razgovor=' + b.run('JSON.stringify(AI_RAZGOVOR)'));
    // nije deploy-ovana
    const c = await boot({ supabase: true, seed: {} }); c.run("setRole('all')"); await c.run("aiPitaj('x')");
    if (!/nije deploy-ovana|ANTHROPIC_API_KEY/.test(c.run('AI_GRESKA')) || c.run('AI_ZAUZET')) throw new Error('nije deploy-ovana: ' + c.run('AI_GRESKA'));
    // bez kljuca (funkcija vraca gresku)
    const d = await boot({ supabase: true, seed: {}, faults: { ai: () => ({ data: null, error: { message: 'ANTHROPIC_API_KEY nije podešen (Supabase → Edge Functions → Secrets).' } }) } });
    d.run("setRole('all')"); await d.run("aiPitaj('x')"); if (!/ANTHROPIC_API_KEY/.test(d.run('AI_GRESKA'))) throw new Error('bez kljuca: ' + d.run('AI_GRESKA'));
    // dugme u detalju situacije na pregledu (direktor, supabase) i aiPregledSituacije
    const e = await boot({ supabase: true, seed: {}, faults: { ai: () => ({ data: { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Preporuka: odobri.' }] }, error: null }) } });
    e.run("setRole('all')"); const sid = e.run("(()=>{ const s=DATA.situacije.find(x=>!jePro(grById[x.gr])); s.pregled='na_pregledu'; return s.id; })()");
    e.run(`detaljSituacije(${JSON.stringify(sid)})`); if (!e.g.document.getElementById('modal').innerHTML.includes(`aiPregledSituacije('${sid}')`)) throw new Error('nema dugmeta Pregledaj sa asistentom');
    await e.run(`aiPregledSituacije(${JSON.stringify(sid)})`);
    if (!e.run('AI_OTVOREN') || !e.g.document.getElementById('aiPanel').innerHTML.includes('Preporuka: odobri.') || !/Pregledaj situaciju/.test(e.run('AI_RAZGOVOR[0].tekst')) || e.run('AI_RAZGOVOR[1].tekst') !== 'Preporuka: odobri.') throw new Error('aiPregledSituacije: ' + e.run('JSON.stringify(AI_RAZGOVOR)'));
    e.run("setRole('z1|izv')"); e.run(`detaljSituacije(${JSON.stringify(sid)})`); if (e.g.document.getElementById('modal').innerHTML.includes('aiPregledSituacije(')) throw new Error('rukovodilac ima dugme asistenta');
  });

  /* ---- T58 (2026-10-16): izvoz situacije u investitorskom sablonu, latinica/cirilica; predmer.izvor iz uvoza ---- */
  section('T58 izvoz situacije lat/cir');
  await acheck('lat2cir: srpski tekst, digrafi (lj/nj/dž, velika slova), tokeni sa ciframa/qwxy i skracenice ostaju latinicni; round-trip sa cir2lat; rimski', async () => {
    const a = await boot();
    const l2c = s => a.run(`lat2cir(${JSON.stringify(s)})`);
    if (l2c('Demontaža postojećih razvodnih ormana i tabli') !== 'Демонтажа постојећих разводних ормана и табли') throw new Error('osnovno: ' + l2c('Demontaža postojećih razvodnih ormana i tabli'));
    if (l2c('Ljubljana njiva džak LJUBLJANA DŽAK') !== 'Љубљана њива џак ЉУБЉАНА ЏАК') throw new Error('digrafi: ' + l2c('Ljubljana njiva džak LJUBLJANA DŽAK'));
    if (l2c('Bullet IP kamera IPC2314LE-ADF28K-WP, 4MP') !== 'Буллет IP камера IPC2314LE-ADF28K-WP, 4MP') throw new Error('mesano: ' + l2c('Bullet IP kamera IPC2314LE-ADF28K-WP, 4MP'));
    if (l2c('LED svetiljka N2XH-J 3x1.5mm² (PVC)') !== 'LED светиљка N2XH-J 3x1.5mm² (PVC)') throw new Error('skracenice: ' + l2c('LED svetiljka N2XH-J 3x1.5mm² (PVC)'));
    const cist = 'Jednopolni automatski prekidač, grebenasti prekidač i šuko priključnica za zid';
    if (a.run(`cir2lat(lat2cir(${JSON.stringify(cist)}))`) !== cist) throw new Error('round-trip: ' + a.run(`cir2lat(lat2cir(${JSON.stringify(cist)}))`));
    if (a.run("lat2cir('Демонтажа 500m²')") !== 'Демонтажа 500m²' || a.run("lat2cir('')") !== '') throw new Error('cirilica/prazno netaknuto');
    if (a.run('[1,2,3,4,5,9,10].map(rimski).join()') !== 'I,II,III,IV,V,IX,X') throw new Error('rimski: ' + a.run('[1,2,3,4,5,9,10].map(rimski).join()'));
  });
  await acheck('citajXlsx: red.list = ime lista iz workbook.xml (redosled), red.izvorno = original pre cir2lat; upariPredmerSablon puni izvor {list, sekcija, nadpoz, cir}; T47 broj pozicija nepromenjen; dodajPredmerIzPripreme cuva izvor (esc)', async () => {
    const a = await boot();
    const buf = fs.readFileSync(path.join(ROOT, 'test', 'fixtures', 'predmer-sablon.xlsx'));
    a.g.__buf = new Uint8Array(buf).buffer;
    const redovi = await a.run('citajXlsx(__buf, true)');
    const listovi = [...new Set(redovi.map(r => r.list))];
    if (JSON.stringify(listovi) !== JSON.stringify(['ЕЛЕКТРОИНСТАЛАЦИЈЕ', 'ТЕХНИЧКА ЗАШТИТА', 'РЕКАПИТУЛАЦИЈА'])) throw new Error('imena listova: ' + JSON.stringify(listovi));
    const r0 = redovi.find(r => String(r[1]).startsWith('Demontaža u objektima'));
    if (!r0 || !r0.izvorno || !String(r0.izvorno[1]).startsWith('Демонтажа у објектима')) throw new Error('izvorno nije sacuvano: ' + JSON.stringify(r0 && r0.izvorno));
    a.g.__rows = redovi; const rez = a.run('upariPredmerSablon(__rows)');
    const dem = rez.redovi.find(r => r.poz.startsWith('Demontaža u objektima'));
    if (!dem || !dem.izvor || dem.izvor.list !== 'ЕЛЕКТРОИНСТАЛАЦИЈЕ' || dem.izvor.sekcija !== '4.0 ДЕМОНТАЖНИ РАДОВИ' || !String(dem.izvor.nadpoz).startsWith('4.0.1 Демонтажа постојећих') || !String(dem.izvor.cir).startsWith('Демонтажа у објектима')) throw new Error('izvor demontaza: ' + JSON.stringify(dem && dem.izvor));
    const kam = rez.redovi.find(r => /Bullet IP kamera/.test(r.poz));
    if (!kam || kam.izvor.list !== 'ТЕХНИЧКА ЗАШТИТА' || kam.izvor.sekcija !== 'И ВИДЕО НАДЗОР' || kam.izvor.nadpoz !== '3Д Bullet IP kamera 4 MP' || kam.izvor.cir !== null) throw new Error('izvor kamera: ' + JSON.stringify(kam && kam.izvor));
    const rad = rez.redovi.find(r => r.sifra === '453');
    if (!rad || rad.izvor.nadpoz !== null || rad.izvor.sekcija !== 'И ВИДЕО НАДЗОР') throw new Error('stavka sa sopstvenom sifrom ne sme imati nadpoz: ' + JSON.stringify(rad && rad.izvor));
    // isti broj pozicija kao pre (T47)
    const bez = rez.redovi.map(r => ({ sifra: r.sifra, poz: r.poz, kol: r.kol, cena: r.cena }));
    if (bez.length !== rez.redovi.length || bez.length < 5) throw new Error('broj pozicija ' + bez.length);
    a.g.__rez = rez.redovi.map(r => ({ ...r, poz: r.poz + ' <b>x</b>', izvor: { ...r.izvor, sekcija: (r.izvor && r.izvor.sekcija) ? r.izvor.sekcija + ' & co' : null } }));
    a.run("setRole('all'); PREDMER_PRIPREMA={redovi:__rez};");
    const gid = a.run("DATA.gradilista.find(g=>!jePro(g)).id"), n0 = a.run('DATA.predmer.length');
    a.run(`dodajPredmerIzPripreme(${JSON.stringify(gid)})`);
    const novi = a.run('DATA.predmer.slice(' + n0 + ')');
    if (!novi.length || novi.some(r => !r.izvor) || !novi.some(r => r.izvor.sekcija && r.izvor.sekcija.includes('&amp; co')) || novi.some(r => r.poz.includes('<b>'))) throw new Error('izvor nije esc/sacuvan: ' + JSON.stringify(novi[0]));
  });
  await acheck('izvozSituacije: privremena (lat) — listovi po vrsti radova + REKAPITULACIJA, zaglavlja, sekcija + UKUPNO, nadpozicija, kumulativ sa servera, UKUPNO = Σ kol×cena; cirilica = cirilicni naslovi i original stavke; okoncana ima kolonu po ranijoj situaciji; guardovi (tudje gradiliste null, radnik bez cena alert, Petar bez finansija moze); dugmad u detalju', async () => {
    const a = await boot();
    a.run("setRole('all')");
    const g = a.run("DATA.gradilista.find(x=>!jePro(x)&&predmerZa(x.id).length>=3)"); if (!g) throw new Error('DEMO bez izvodjenja sa predmerom');
    // predmer sa izvorom: dva lista, sekcije, nadpozicija; stare situacije brisemo da bi I privremena bila prva
    a.run(`DATA.situacije=DATA.situacije.filter(s=>s.gr!==${JSON.stringify(g.id)}); DATA.situacija_stavke=DATA.situacija_stavke.filter(x=>x.gr!==${JSON.stringify(g.id)});`);
    const pm = a.run(`predmerZa(${JSON.stringify(g.id)})`);
    a.run(`const l=predmerZa(${JSON.stringify(g.id)}); l[0].izvor={list:'ЕЛЕКТРОИНСТАЛАЦИЈЕ',sekcija:'4.0 ДЕМОНТАЖНИ РАДОВИ',nadpoz:'4.0.1 Демонтажа постојећих инсталација',cir:'Демонтажа у објектима'}; l[1].izvor={list:'ЕЛЕКТРОИНСТАЛАЦИЈЕ',sekcija:'4.2 РАЗВОДНИ ОРМАНИ',nadpoz:null,cir:null}; l[2].izvor={list:'ТЕХНИЧКА ЗАШТИТА',sekcija:'И ВИДЕО НАДЗОР',nadpoz:null,cir:null};`);
    // I privremena: stavke za prve dve pozicije
    const mk = (id, br, dan, kol0, kol1, vrsta) => a.run(`(()=>{ const s={id:${JSON.stringify(id)}, gr:${JSON.stringify(g.id)}, br:${JSON.stringify(br)}, opis:'t58', izdato:${JSON.stringify(dan)}, valuta:${JSON.stringify(dan)}, status:'ceka', vrsta:${JSON.stringify(vrsta)}, iznos:0, pregled:'odobrena'}; DATA.situacije.push(s);
      const l=predmerZa(${JSON.stringify(g.id)}); [[l[0],${kol0}],[l[1],${kol1}]].forEach(([p,k],i)=>{ if(k==null) return; DATA.situacija_stavke.push({id:s.id+'-'+i, sit:s.id, gr:s.gr, predmer_id:p.id, sifra:p.sifra||null, poz:p.poz, jm:p.jm, kol:k, kol_ugovoreno:p.kol, kumulativ:0, razlika:0}); });
      preracunajSituacijeLokalno(s.gr); return s.id; })()`);
    mk('t58-s1', 'PS-1/26', '2026-10-01', 1, 2, 'privremena');
    const u1 = await a.run("izvozSituacije('t58-s1','lat')");
    if (!u1 || !u1.length) throw new Error('izvoz nije vratio bajtove');
    a.g.__u1 = u1; const red1 = await a.run('citajXlsx(__u1.buffer, true)');
    const listovi = [...new Set(red1.map(r => r.list))];
    if (JSON.stringify(listovi) !== JSON.stringify(['ELEKTROINSTALACIJE', 'TEHNIČKA ZAŠTITA', 'PREDMER', 'REKAPITULACIJA'])) throw new Error('listovi lat (pozicije bez izvora idu u PREDMER): ' + JSON.stringify(listovi));
    const L1 = red1.filter(r => r.list === 'ELEKTROINSTALACIJE'), txt = r => r.map(String).join('|');
    if (!txt(L1[0]).includes('PRIVREMENA SITUACIJA br. PS-1/26') || !txt(L1[1]).includes('Objekat:') || !txt(L1[1]).includes('Investitor:')) throw new Error('info redovi: ' + txt(L1[0]) + ' / ' + txt(L1[1]));
    const zag = L1.find(r => r.includes('UGOVORENO')); if (!zag || !zag.includes('KUMULATIVNO IZVEDENO') || !zag.includes('IZVEDENO U PRETHODNIM SITUACIJAMA') || !zag.includes('IZVEDENO U I PRIVREMENOJ SITUACIJI')) throw new Error('grupe kolona: ' + txt(zag || []));
    const pod = L1.find(r => r[0] === 'Br. poz.'); if (!pod || pod.filter(x => x === 'kol.').length !== 4 || pod.filter(x => x === 'jed. cena bez PDV-a').length !== 4) throw new Error('podzaglavlje: ' + txt(pod || []));
    if (!L1.some(r => r[0] === '4.0' && r[1] === 'DEMONTAŽNI RADOVI') || !L1.some(r => r[0] === '4.0.1' && String(r[1]).startsWith('Demontaža postojećih')) || !L1.some(r => r[0] === '4.2' && r[1] === 'RAZVODNI ORMANI')) throw new Error('sekcija/nadpozicija nedostaje');
    if (!L1.some(r => r[1] === 'UKUPNO DEMONTAŽNI RADOVI') || !L1.some(r => r[1] === 'UKUPNO RAZVODNI ORMANI') || !L1.some(r => r[0] === 'REKAPITULACIJA')) throw new Error('UKUPNO po sekciji / rekap lista: ' + L1.filter(r => /UKUPNO|REKAP/.test(txt(r))).map(txt).join(' / '));
    const st0 = L1.find(r => String(r[1]) === a.run('unesc(predmerZa(' + JSON.stringify(g.id) + ')[0].poz)'));
    const c0 = +pm[0].cena, k0 = +pm[0].kol;
    if (!st0 || st0[0] !== '' || st0[3] !== k0 || st0[4] !== c0 || Math.abs(st0[5] - k0 * c0) > 0.01 || st0[6] !== 1 || st0[9] !== 0 || st0[12] !== 1 || Math.abs(st0[14] - c0) > 0.01) throw new Error('red stavke 0: ' + txt(st0 || []));
    const uk = L1.filter(r => r[1] === 'UKUPNO').pop(); const ugov = pm.filter(p => (p.izvor || {}).list === 'ЕЛЕКТРОИНСТАЛАЦИЈЕ').reduce((s2, p) => s2 + p.kol * p.cena, 0);
    if (!uk || Math.abs(uk[5] - ugov) > 0.01 || Math.abs(uk[14] - (1 * c0 + 2 * pm[1].cena)) > 0.01) throw new Error('UKUPNO lista: ' + txt(uk || []) + ' ocekivano ugov ' + ugov);
    const R = red1.filter(r => r.list === 'REKAPITULACIJA'); const rb = R.find(r => r[1] === 'UKUPNO BEZ PDV-a'), svi = pm.reduce((s2, p) => s2 + p.kol * p.cena, 0);
    if (!rb || Math.abs(rb[2] - svi) > 0.01 || !R.some(r => r[0] === 'I' && r[1] === 'ELEKTROINSTALACIJE') || !R.some(r => r[0] === 'II' && r[1] === 'TEHNIČKA ZAŠTITA')) throw new Error('rekapitulacija: ' + R.map(txt).join(' / '));
    // stilovi i formule (2026-10-18): styles.xml sa Century Gothic i bojama sablona, spojene celije, sirine, zamrzavanje, stampa, formule sa kesiranom vrednoscu
    const z1 = await a.run('zipCitaj(__u1.buffer)'); const st = await z1.citaj('xl/styles.xml'), sh1 = await z1.citaj('xl/worksheets/sheet1.xml'), wbx = await z1.citaj('xl/workbook.xml'), ct = await z1.citaj('[Content_Types].xml');
    if (!st || !st.includes('Century Gothic') || !st.includes('FFFFFF00') || !st.includes('FF92D050') || !st.includes('FFD9D9D9') || !st.includes('#,##0.00') || !/<border><left style="thin"/.test(st)) throw new Error('styles.xml: ' + String(st).slice(0, 300));
    if (!ct.includes('styles+xml') || !/<Relationship Id="rId\d+" Type="[^"]*\/styles" Target="styles.xml"\/>/.test(await z1.citaj('xl/_rels/workbook.xml.rels'))) throw new Error('styles.xml nije registrovan');
    if (!/<mergeCells count="\d+"><mergeCell ref="A4:O4"\/><mergeCell ref="D5:F5"\/>/.test(sh1) || !/<cols><col min="1" max="1" width="6.6"/.test(sh1) || !/<pane ySplit="6" topLeftCell="A7"/.test(sh1) || !/<pageSetup paperSize="9" orientation="landscape" fitToWidth="1"/.test(sh1)) throw new Error('sheet1: merge/cols/pane/pageSetup: ' + sh1.slice(0, 600));
    if (!/<c r="F\d+" s="\d+"><f>D(\d+)\*E\1<\/f><v>[\d.]+<\/v><\/c>/.test(sh1) || !/<f>SUM\(F\d+:F\d+\)<\/f>/.test(sh1) || !/<f>J\d+\+M\d+<\/f>/.test(sh1) || !/<f>F\d+-I\d+<\/f>/.test(sh1)) throw new Error('formule: ' + (sh1.match(/<f>[^<]*<\/f>/g) || []).slice(0, 8).join(' '));
    if (!/_xlnm\.Print_Area/.test(wbx) || !wbx.includes('<calcPr fullCalcOnLoad="1"/>')) throw new Error('workbook: print area / calcPr');
    const shR = await z1.citaj('xl/worksheets/sheet' + listovi.length + '.xml'); if (!/<f>'ELEKTROINSTALACIJE'!F\d+<\/f>/.test(shR)) throw new Error('rekapitulacija bez referenci na listove: ' + (shR.match(/<f>[^<]*<\/f>/g) || []).slice(0, 4).join(' '));
    // stavka lista VAN svake sekcije (izvor bez sekcije ispred prve sekcije) ulazi u UKUPNO lista kao +F<red> (nalaz pregleda 2026-10-22)
    a.run(`(()=>{ const l=predmerZa(${JSON.stringify(g.id)}); l[1].izvor={list:'ЕЛЕКТРОИНСТАЛАЦИЈЕ',sekcija:null,nadpoz:null,cir:null}; })()`);   // druga stavka lista ostaje bez sekcije (iza UKUPNO 4.0)
    const ub = await a.run("izvozSituacije('t58-s1','lat')"); a.g.__ub = ub; const zb = await a.run('zipCitaj(__ub.buffer)'); const shb = await zb.citaj('xl/worksheets/sheet1.xml');
    const fUk = (shb.match(/<f>SUM\(F\d+:F\d+\)\+F(\d+)<\/f>/) || []); if (!fUk[1]) throw new Error('UKUPNO lista bez stavke van sekcije: ' + (shb.match(/<f>SUM\(F[^<]*<\/f>/g) || []).join(' '));
    const redB = await a.run('citajXlsx(__ub.buffer, true)'); const Lb = redB.filter(r => r.list === 'ELEKTROINSTALACIJE'); const ukb = Lb.filter(r => r[1] === 'UKUPNO').pop();
    if (Math.abs(ukb[5] - ugov) > 0.01) throw new Error('kesirani UKUPNO lista posle premestanja: ' + ukb[5] + ' != ' + ugov);
    a.run(`(()=>{ const l=predmerZa(${JSON.stringify(g.id)}); l[1].izvor={list:'ЕЛЕКТРОИНСТАЛАЦИЈЕ',sekcija:'4.2 РАЗВОДНИ ОРМАНИ',nadpoz:null,cir:null}; })()`);
    // pro situacija (skrivena, Projektovanje nema naplatu) se ne izvozi ni direktnim pozivom; stavka bez predmer_id → list VAN PREDMERA
    const proSit = a.run("(DATA.situacije.find(x=>jePro(grById[x.gr]))||{}).id"); if (proSit && (a.run(`izvozSituacije(${JSON.stringify(proSit)},'lat')`) !== null || a.run(`smemIzvozSituacije(DATA.situacije.find(x=>x.id===${JSON.stringify(proSit)}))`))) throw new Error('pro situacija se izvozi');
    a.run(`DATA.situacija_stavke.push({id:'t58-van', sit:'t58-s1', gr:${JSON.stringify(g.id)}, predmer_id:null, sifra:'X1', poz:'Dodatni rad van predmera', jm:'kom', kol:3, kol_ugovoreno:0, kumulativ:3, razlika:3})`);
    const uv = await a.run("izvozSituacije('t58-s1','lat')"); a.g.__uv = uv; const rv = await a.run('citajXlsx(__uv.buffer, true)');
    if (!rv.some(r => r.list === 'VAN PREDMERA' && r[1] === 'Dodatni rad van predmera' && r[3] === 3)) throw new Error('nema lista VAN PREDMERA sa stavkom');
    a.run("DATA.situacija_stavke=DATA.situacija_stavke.filter(x=>x.id!=='t58-van')");
    // izvozPredmer (bez stilova) i dalje radi i cita se nazad
    const up = a.run(`izvozPredmer(${JSON.stringify(g.id)})`); a.g.__up = up; const rp = await a.run('citajXlsx(__up.buffer, true)'); if (!rp.some(r => r[1] === 'UKUPNO bez PDV')) throw new Error('izvozPredmer posle stilova');
    // cirilica: naslovi i original stavke (ZIP je STORED pa se tekst vidi direktno)
    const u1c = await a.run("izvozSituacije('t58-s1','cir')"); const s1c = Buffer.from(u1c).toString('utf8');
    for (const x of ['ПРИВРЕМЕНА СИТУАЦИЈА бр. PS-1/26', 'УГОВОРЕНО', 'КУМУЛАТИВНО ИЗВЕДЕНО', 'ИЗВЕДЕНО У I ПРИВРЕМЕНОЈ СИТУАЦИЈИ', 'ДЕМОНТАЖНИ РАДОВИ', 'Демонтажа у објектима', 'УКУПНО БЕЗ ПДВ-а', 'ЕЛЕКТРОИНСТАЛАЦИЈЕ']) if (!s1c.includes(x)) throw new Error('cirilica nema: ' + x);
    if (s1c.includes('UGOVORENO') || s1c.includes('<t xml:space="preserve">Demontaža u objektima')) throw new Error('cirilicni izvoz sadrzi latinicne naslove/stavku');
    // II privremena pa okoncana: kolone po ranijim situacijama, prethodne = kumulativ - ova
    mk('t58-s2', 'PS-2/26', '2026-11-01', 2, null, 'privremena');
    mk('t58-s3', 'OK-1/26', '2026-12-01', 1, 1, 'okoncana');
    const u3 = await a.run("izvozSituacije('t58-s3','lat')"); a.g.__u3 = u3; const red3 = await a.run('citajXlsx(__u3.buffer, true)');
    const L3 = red3.filter(r => r.list === 'ELEKTROINSTALACIJE'), z3 = L3.find(r => r.includes('UGOVORENO'));
    if (!z3.includes('IZVEDENO U I PRIVREMENOJ SITUACIJI') || !z3.includes('IZVEDENO U II PRIVREMENOJ SITUACIJI') || !z3.includes('IZVEDENO U OKONČANOJ SITUACIJI') || z3.includes('IZVEDENO U III PRIVREMENOJ SITUACIJI')) throw new Error('okoncana grupe: ' + txt(z3));
    const s30 = L3.find(r => String(r[1]) === a.run('unesc(predmerZa(' + JSON.stringify(g.id) + ')[0].poz)'));
    const zip3 = await a.run('zipCitaj(__u3.buffer)'); const sh3 = await zip3.citaj('xl/worksheets/sheet1.xml');
    if (!/<f>M\d+\+P\d+\+S\d+<\/f>/.test(sh3) || !/<f>M\d+\+P\d+<\/f>/.test(sh3)) throw new Error('okoncana: kumulativ/prethodne formule: ' + (sh3.match(/<f>[^<]*<\/f>/g) || []).slice(0, 10).join(' '));
    // kolone: 3 + [ugov 3][kum 3][preth 3][I 3][II 3][okon 3]
    if (s30[6] !== 4 || s30[9] !== 3 || s30[12] !== 1 || s30[15] !== 2 || s30[18] !== 1) throw new Error('okoncana kolicine: ' + txt(s30));
    const R3 = red3.filter(r => r.list === 'REKAPITULACIJA'), rz = R3.find(r => r[2] === 'Ugovoreno');
    if (!rz || !rz.includes('Izvedeno po I Privremenoj situaciji') || !rz.includes('Izvedeno po II Privremenoj situaciji') || !rz.includes('Izvedeno po okončanoj situaciji')) throw new Error('rekap okoncane: ' + txt(rz || []));
    // guardovi
    const drugi = a.run(`DATA.gradilista.find(x=>!jePro(x)&&x.id!==${JSON.stringify(g.id)}&&x.rukovodilac!==${JSON.stringify(g.rukovodilac)}).rukovodilac`);
    a.run(`setRole(${JSON.stringify(drugi + '|izv')})`);
    if (a.run("izvozSituacije('t58-s1','lat')") !== null) throw new Error('rukovodilac drugog gradilista izvezao situaciju');
    const radnik = a.run(`DATA.zaposleni.find(z=>(z.grs||[]).includes(${JSON.stringify(g.id)})&&z.id!==${JSON.stringify(g.rukovodilac)})`);
    if (radnik) { a.run(`setRole('radnik:${radnik.id}|izv')`); const al = a.g._calls.alert.length; if (a.run("izvozSituacije('t58-s1','lat')") !== null || a.g._calls.alert.length !== al + 1) throw new Error('radnik bez cena izvezao / bez alert-a'); a.run("detaljSituacije('t58-s1')"); if (a.g.document.getElementById('modal').innerHTML.includes('izvozSituacije(')) throw new Error('radnik ima dugme izvoza'); }
    a.run(`setRole(${JSON.stringify(g.rukovodilac + '|izv')})`);   // rukovodilac bez finansija: vidimCene → sme
    const uP = await a.run("izvozSituacije('t58-s1','lat')"); if (!uP || !uP.length) throw new Error('rukovodilac gradilista (bez finansija) ne moze da izveze');
    a.run("detaljSituacije('t58-s1')"); const m = a.g.document.getElementById('modal').innerHTML;
    if (!m.includes("izvozSituacije('t58-s1','lat')") || !m.includes("izvozSituacije('t58-s1','cir')")) throw new Error('nema dugmadi izvoza u detalju');
    a.run(`closeModal(); openSite(${JSON.stringify(g.id)})`); const dr = a.g.document.getElementById('drawer').innerHTML;
    if (!dr.includes("izvozSituacije('t58-s1','lat')") || !dr.includes("izvozSituacije('t58-s1','cir')")) throw new Error('fioka: nema ⬇ lat/ćir uz situaciju');
    a.run("closeDrawer(); setRole('all'); current='pay'; render();"); const pv = a.g.document.getElementById('view').innerHTML;
    if (!pv.includes("izvozSituacije('t58-s1','lat')") || !pv.includes("izvozSituacije('t58-s1','cir')")) throw new Error('Naplata: nema ⬇ lat/ćir uz situaciju');
    if (radnik) { a.run(`setRole('radnik:${radnik.id}|izv'); openSite(${JSON.stringify(g.id)})`); if (a.g.document.getElementById('drawer').innerHTML.includes('izvozSituacije(')) throw new Error('radnik ima ⬇ u fioci'); a.run('closeDrawer()'); }
    a.run("closeModal(); setRole('all')");
  });

  /* ---- T57 (2026-10-14): direktori modula — sva ovlascenja direktora, SAMO u svom modulu (migracija 27) ---- */
  section('T57 direktori modula');
  await acheck('setRole dirpro/dirizv: uprava + finansije + jedan modul; visibleSites/tabovi/smemNa/smemBrisati/smemPredmer po modulu; jeSuper samo direktor; obrisi* na tudjem gradilistu false bez confirm-a; formSite nudi samo svoj modul, tudje ne menja; Naplata/zadaci/upravaSve po modulu; svi tabovi se renderuju', async () => {
    const a = await boot();
    const nPro = a.run('DATA.gradilista.filter(jePro).length'), nIzv = a.run('DATA.gradilista.filter(g=>!jePro(g)).length');
    if (!nPro || !nIzv) throw new Error('DEMO bez oba modula');
    a.run("MODUL='izvodjenje'; setRole('dirpro');");
    if (a.run('vrstaUloge()') !== 'uprava' || !a.run('isDirector()') || !a.run('canFinance()') || a.run('jeSuper()') || !a.run('jeDirektorModula()')) throw new Error('dirpro: uprava/finansije/jeSuper/jeDirektorModula');
    if (JSON.stringify(a.run('MODULI')) !== '["projektovanje"]' || a.run('MODUL') !== 'sve' || a.run('modulSeg()') !== '' || a.run('upravaSve()')) throw new Error('dirpro MODULI/MODUL/segment/upravaSve');
    if (a.run('visibleSites().length') !== nPro || a.run('visibleSites().some(g=>!jePro(g))')) throw new Error('dirpro vidi izvodjenje');
    if (a.run('roleValue()') !== 'dirpro' || !a.run("ulogaLabela('direktor_projektovanja')").includes('direktor projektovanja') || !a.run("ulogaLabela('direktor_izvodjenja')").includes('direktor izvođenja')) throw new Error('roleValue/labela');
    const tabs = a.run('tabs().map(t=>t.id)');
    if (tabs.includes('magacin') || tabs.includes('pay') || !tabs.includes('tasks') || tabs.includes('nalozi') || !tabs.includes('clients')) throw new Error('dirpro tabovi (bez Admin kokpita, migracija 28): ' + tabs);
    a.run("current='nalozi'; render();"); if (a.run('current') !== 'dash') throw new Error('viewNalozi nije vratio direktora modula na dash');
    if (!a.run("smemNa('g8')") || a.run("smemNa('g1')") || !a.run("smemBrisati('g8')") || a.run("smemBrisati('g1')") || !a.run("smemPredmer('g8')") || a.run("smemPredmer('g1')")) throw new Error('dirpro smemNa/smemBrisati/smemPredmer po modulu');
    if (a.run('smemBrisati(null)') || a.run('smemBrisati(undefined)')) throw new Error('smemBrisati bez gradilista mora biti false za direktora modula (resurs bez gr brise samo direktor)');
    const c0 = a.g._calls.confirm.length;
    const tIzv = a.run('DATA.zadaci.find(t=>!jePro(grById[t.gr])).id'), sIzv = a.run("DATA.situacije.find(s=>!jePro(grById[s.gr])).id"), pIzv = a.run("DATA.predmer.find(p=>!jePro(grById[p.gr])).id");
    if (await a.run("obrisiGradiliste('g1')") !== false || a.run(`obrisiZadatak(${JSON.stringify(tIzv)})`) !== false || await a.run(`obrisiSituaciju(${JSON.stringify(sIzv)})`) !== false || a.run(`obrisiPredmerRed(${JSON.stringify(pIzv)})`) !== false) throw new Error('obrisi* na tudjem gradilistu nije false');
    if (a.g._calls.confirm.length !== c0) throw new Error('confirm pozvan za tudje gradiliste');
    a.run('formSite()'); let m = a.g.document.getElementById('modal').innerHTML;
    if (m.includes('value="izvodjenje"') || !m.includes('value="projektovanje"')) throw new Error('formSite dirpro nudi izvodjenje');
    if (/nivoBox|f_nivo/.test(m) || !/id="nivoFillBox" style="display:block"/.test(m) || !/id="tipRadovaBox" style="display:none"/.test(m) || !/id="mereFillBox" style="display:none"/.test(m)) throw new Error('formSite dirpro: kutije cek-lista/tip/mere (bez nivoa)');
    a.run("closeModal(); formSite('g1')"); if (a.g.document.getElementById('modal').innerHTML.includes('Izmeni podatke')) throw new Error('dirpro otvorio izmenu gradilista izvodjenja');
    a.run("formSite('g8')"); if (!a.g.document.getElementById('modal').innerHTML.includes('Izmeni podatke')) throw new Error('dirpro ne moze da izmeni svoje gradiliste');
    a.run('closeModal()');
    if (a.run('zadaciVidljivi().some(t=>!jePro(grById[t.gr]))') || a.run('zadaciVidljivi().length') === 0) throw new Error('dirpro zadaci');
    if (a.run('modulEfektivni()') !== 'projektovanje' || a.run("tabs().find(t=>t.id==='subs').naziv") !== 'Spoljni saradnici') throw new Error('dirpro: efektivni modul / naziv Spoljni saradnici');
    a.run("current='sites'; render();"); if (a.g.document.getElementById('view').innerHTML.includes('formSifrarnik()')) throw new Error('dirpro: nudi Sifarnik artikala (Izvodjenje)');
    a.run("current='dash'; render();"); if (a.g.document.getElementById('view').innerHTML.includes('Ugov. vs situacije')) throw new Error('dirpro: kolona Ugov. vs situacije na tabli');
    a.run("current='subs'; render();"); if (!a.g.document.getElementById('view').innerHTML.includes('Spoljni saradnici')) throw new Error('dirpro: naslov Podizvodjaci umesto Spoljni saradnici');
    for (const id of tabs) { a.run(`current=${JSON.stringify(id)}; render();`); if (a.run('current') !== id) throw new Error('dirpro: tab ' + id + ' vracen na ' + a.run('current')); }
    a.run("setRole('dirizv')");
    if (JSON.stringify(a.run('MODULI')) !== '["izvodjenje"]' || a.run('visibleSites().length') !== nIzv || a.run('visibleSites().some(jePro)') || a.run('roleValue()') !== 'dirizv') throw new Error('dirizv vidi projektovanje');
    const t2 = a.run('tabs().map(t=>t.id)');
    if (!t2.includes('magacin') || !t2.includes('pay') || t2.includes('tasks') || t2.includes('nalozi')) throw new Error('dirizv tabovi: ' + t2);
    if (a.run("smemNa('g8')") || !a.run("smemNa('g1')") || a.run("smemBrisati('g8')") || !a.run("smemBrisati('g1')")) throw new Error('dirizv smemNa/smemBrisati');
    if (a.run('zadaciVidljivi().length') !== 0) throw new Error('dirizv vidi zadatke projektovanja');
    if (a.run('modulEfektivni()') !== 'izvodjenje' || a.run("tabs().find(t=>t.id==='subs').naziv") !== 'Podizvođači') throw new Error('dirizv: efektivni modul / naziv Podizvodjaci');
    a.run("current='sites'; render();"); if (!a.g.document.getElementById('view').innerHTML.includes('formSifrarnik()')) throw new Error('dirizv: nema Sifarnik artikala');
    a.run("current='dash'; render();"); if (!a.g.document.getElementById('view').innerHTML.includes('Ugov. vs situacije')) throw new Error('dirizv: nema kolone Ugov. vs situacije');
    for (const id of t2) { a.run(`current=${JSON.stringify(id)}; render();`); if (a.run('current') !== id) throw new Error('dirizv: tab ' + id + ' vracen na ' + a.run('current')); }
    a.run("current='pay'; render();"); const pv = a.g.document.getElementById('view').innerHTML;
    if (!pv.includes('obrisiSituaciju') ) throw new Error('dirizv: Naplata bez dugmeta brisanja na svojim situacijama');
    a.run('formSite()'); m = a.g.document.getElementById('modal').innerHTML;
    if (m.includes('value="projektovanje"') || !m.includes('value="izvodjenje"') || !/id="mereFillBox" style="display:block"/.test(m)) throw new Error('formSite dirizv nudi projektovanje'); a.run('closeModal()');
    // stari guardovi sa golim isDirector()/canFinance() (pregled 2026-10-22): direktor projektovanja ne dira Izvodjenje
    a.run("setRole('dirpro')"); const sitIzv = a.run("DATA.situacije.find(x=>!jePro(grById[x.gr])&&pregledSit(x)!=='odobrena')||DATA.situacije.find(x=>!jePro(grById[x.gr]))");
    a.run(`(()=>{ const s=DATA.situacije.find(x=>x.id===${JSON.stringify(sitIzv.id)}); s.pregled='na_pregledu'; })()`);
    a.run(`odobriSituaciju(${JSON.stringify(sitIzv.id)})`); if (a.run(`DATA.situacije.find(x=>x.id===${JSON.stringify(sitIzv.id)}).pregled`) !== 'na_pregledu') throw new Error('dirpro odobrio situaciju Izvodjenja');
    a.run(`(()=>{ const s=DATA.situacije.find(x=>x.id===${JSON.stringify(sitIzv.id)}); s.pregled='odobrena'; s.status='ceka'; })()`); a.run(`markPaid(${JSON.stringify(sitIzv.id)})`); if (a.run(`DATA.situacije.find(x=>x.id===${JSON.stringify(sitIzv.id)}).status`) === 'placeno') throw new Error('dirpro oznacio placeno na Izvodjenju');
    for (const f of ["formTim('g1')", "formPredmerImport('g1')", "openTroskovi('g1')", "openPresek('g1')", "formTrosak('g1')"]) { a.run("document.getElementById('modal').innerHTML=''; document.getElementById('rpt').innerHTML=''; " + f); if (a.g.document.getElementById('modal').innerHTML.length > 0 || a.g.document.getElementById('rpt').innerHTML.length > 0) throw new Error('dirpro otvorio ' + f); }
    if (a.run("smemIzvedeno('g1')") || !a.run("smemIzvedeno('g8')") || a.run("izvozPredmer('g1')") !== undefined) throw new Error('dirpro: izvedeno/izvozPredmer na Izvodjenju');
    a.run("setRole('all')"); if (!a.run('upravaSve()') || a.run('MODULI.length') !== 2 || !a.run('jeSuper()') || a.run('jeDirektorModula()')) throw new Error('direktor: sve');
    a.run("setRole('admin')"); if (a.run('jeSuper()') || !a.run("smemNa('g1')") || a.run("smemBrisati('g1')")) throw new Error('admin: ne brise, vodi sve');
  });
  await acheck('nalog direktor_izvodjenja (initAuth): uprava sa jednim modulom; Pogled kao bez admina/dirpro/osoba projektovanja i ne simulira drugu upravu; NEMA Admin kokpit (tab, viewNalozi → dash, RPC nalozi/dodeli/ukloni/angazovanost odbijeni — migracija 28); obrisi_gradiliste po modulu; admin ne dodeljuje direktorske uloge; direktor dodeljuje direktora modula (moduli iz imena); ULOGE == migracija 27 == schema', async () => {
    const seed0 = await boot({ supabase: true, seed: {}, session: { user: { id: 'u-dir', email: 'direktor@test' } } });
    const seed = JSON.parse(JSON.stringify(seed0.g.__mock._db));
    seed.profili = [
      { user_id: 'u-dir', uloga: 'direktor', zaposleni_id: null, ime: 'Direktor' },
      { user_id: 'u-adm', uloga: 'admin', zaposleni_id: null, ime: 'Admin' },
      { user_id: 'u-dizv', uloga: 'direktor_izvodjenja', zaposleni_id: null, moduli: ['izvodjenje'], ime: 'Dir Izv' },
      { user_id: 'u-nik', uloga: 'rukovodilac', zaposleni_id: 'z17', moduli: ['projektovanje'], vidi_finansije: true, ime: 'Nikola' },
      { user_id: 'u-ruk', uloga: 'rukovodilac', zaposleni_id: 'z1', moduli: ['izvodjenje'], ime: 'Petar' },
    ];
    const USERS = { 'dirizv@test': { id: 'u-dizv' }, 'direktor@test': { id: 'u-dir' }, 'admin@test': { id: 'u-adm' }, 'nikola@test': { id: 'u-nik' }, 'petar@test': { id: 'u-ruk' }, 'novi@test': { id: 'u-novi' } };
    const kopija = () => JSON.parse(JSON.stringify(seed));
    const a = await boot({ supabase: true, seed: kopija(), session: { user: { id: 'u-dizv', email: 'dirizv@test' } }, users: USERS });
    if (a.run('ROLE') !== 'all' || a.run('ULOGA') !== 'direktor_izvodjenja' || JSON.stringify(a.run('MODULI')) !== '["izvodjenje"]' || a.run('jeRukovodilacNalog()') || !a.run('canFinance()')) throw new Error('initAuth dirizv: ' + a.run('ULOGA') + ' ' + JSON.stringify(a.run('MODULI')));
    if (a.run('visibleSites().some(jePro)') || !a.run('visibleSites().length')) throw new Error('dirizv nalog vidi projektovanje (mock ne filtrira redove — klijent mora)');
    a.run('renderNalog()'); if (!a.g.document.getElementById('roleBox').innerHTML.includes('roleSel')) throw new Error('dirizv nema „Pogled kao"');
    const ro = a.run('roleOptions()'), vals = [...ro.matchAll(/value="([^"]+)"/g)].map(x => x[1]);
    if (vals.includes('admin') || vals.includes('dirpro') || vals.includes('dirizv') || vals.some(v => /\|pro$/.test(v)) || !vals.includes('z1|izv') || !vals.includes('all') || !ro.includes('sve u modulu')) throw new Error('Pogled kao dirizv: ' + vals);
    a.run("setRole('admin')"); if (a.run('ULOGA') !== 'direktor_izvodjenja') throw new Error('dirizv simulirao admina');
    a.run("setRole('dirpro')"); if (a.run('ULOGA') !== 'direktor_izvodjenja') throw new Error('dirizv simulirao direktora projektovanja');
    a.run("setRole('z1|izv')"); if (a.run('ROLE') !== 'z1') throw new Error('dirizv ne moze „Pogled kao" Petar');
    a.run("setRole('all')"); if (a.run('ULOGA') !== 'direktor_izvodjenja' || a.run('ROLE') !== 'all') throw new Error("setRole('all') nije vratio na direktora modula");
    if (a.run("tabs().some(t=>t.id==='nalozi')")) throw new Error('direktor modula ima tab Admin kokpit');
    a.run("current='nalozi'; render();"); if (a.run('current') !== 'dash') throw new Error('viewNalozi nije vratio direktora modula na dash');
    if (a.g.__mock._log.some(l => l.op === 'rpc' && l.name === 'nalozi_pregled')) throw new Error('direktor modula je pozvao nalozi_pregled');
    if (a.run("smemDodelitiUlogu('radnik')") || a.run("smemMenjatiNalog({bez_profila:true})")) throw new Error('smemDodelitiUlogu/smemMenjatiNalog za direktora modula');
    const rpc = (f, args) => a.run(`supa.rpc(${JSON.stringify(f)}, ${JSON.stringify(args)})`);
    let r = await rpc('nalozi_pregled', {}); if (!r.error) throw new Error('nalozi_pregled prosao direktoru modula');
    r = await rpc('dodeli_ulogu', { p_email: 'novi@test', p_uloga: 'rukovodilac', p_zaposleni_id: 'z2', p_moduli: ['izvodjenje'] }); if (!r.error || a.g.__mock._db.profili.some(p => p.user_id === 'u-novi')) throw new Error('dodeli_ulogu prosao direktoru modula');
    r = await rpc('ukloni_pristup', { p_email: 'petar@test' }); if (!r.error || !a.g.__mock._db.profili.some(p => p.user_id === 'u-ruk')) throw new Error('ukloni_pristup prosao direktoru modula');
    r = await rpc('angazovanost', {}); if (!r.error) throw new Error('angazovanost prosla direktoru modula');
    const pre0 = a.g._calls.alert.length; await a.run("dodeliUlogu('novi@test')"); await a.run("ukloniPristup('petar@test')");
    if (a.g.__mock._log.some(l => l.op === 'rpc' && (l.name === 'dodeli_ulogu' || l.name === 'ukloni_pristup') && !l.args.p_email.startsWith('novi') && !l.args.p_email.startsWith('petar'))) throw new Error('klijentski guard');
    r = await rpc('obrisi_gradiliste', { p_gid: 'g8' }); if (!r.error || !a.g.__mock._db.gradilista.some(g => g.id === 'g8')) throw new Error('dirizv obrisao projektantsko gradiliste');
    r = await rpc('obrisi_gradiliste', { p_gid: 'g1' }); if (r.error || a.g.__mock._db.gradilista.some(g => g.id === 'g1')) throw new Error('dirizv ne moze da obrise svoje gradiliste: ' + (r.error && r.error.message));
    const b = await boot({ supabase: true, seed: kopija(), session: { user: { id: 'u-adm', email: 'admin@test' } }, users: USERS });
    for (const u of ['direktor', 'direktor_projektovanja', 'direktor_izvodjenja']) { r = await b.run(`supa.rpc('dodeli_ulogu', ${JSON.stringify({ p_email: 'novi@test', p_uloga: u })})`); if (!r.error) throw new Error('admin dodelio ' + u); }
    if (!b.run("tabs().some(t=>t.id==='nalozi')")) throw new Error('admin nema Admin kokpit');
    r = await b.run(`supa.rpc('angazovanost', {})`); if (r.error) throw new Error('admin: angazovanost odbijena');
    r = await b.run(`supa.rpc('ukloni_pristup', ${JSON.stringify({ p_email: 'dirizv@test' })})`); if (!r.error) throw new Error('admin uklonio direktora modula');
    b.run("go('nalozi')"); for (let i = 0; i < 8; i++) await new Promise(r2 => setImmediate(r2));
    const hb = b.g.document.getElementById('view').innerHTML, selb = (hb.match(/<select id="n_uloga"[\s\S]*?<\/select>/) || [''])[0];
    if (/value="direktor(_projektovanja|_izvodjenja)?"/.test(selb) || !selb.includes('value="spoljni"') || hb.includes("dodeliUlogu('dirizv@test'")) throw new Error('admin: direktorske uloge u ponudi ili direktor modula otkljucan');
    const c = await boot({ supabase: true, seed: kopija(), session: { user: { id: 'u-dir', email: 'direktor@test' } }, users: USERS });
    r = await c.run(`supa.rpc('dodeli_ulogu', ${JSON.stringify({ p_email: 'novi@test', p_uloga: 'direktor_projektovanja', p_moduli: ['izvodjenje'] })})`);
    const p = c.g.__mock._db.profili.find(x => x.user_id === 'u-novi');
    if (r.error || !p || p.uloga !== 'direktor_projektovanja' || JSON.stringify(p.moduli) !== '["projektovanje"]' || !p.vidi_finansije || p.zaposleni_id) throw new Error('direktor → direktor_projektovanja: ' + JSON.stringify(p) + ' ' + (r.error && r.error.message));
    c.run("go('nalozi')"); for (let i = 0; i < 8; i++) await new Promise(r2 => setImmediate(r2));
    const hc = c.g.document.getElementById('view').innerHTML;
    if (!/<select id="n_uloga"[\s\S]*?value="direktor_izvodjenja"[\s\S]*?<\/select>/.test(hc) || !hc.includes('id="n_mp"') || !hc.includes('id="n_mi"') || !hc.includes("dodeliUlogu('dirizv@test'")) throw new Error('direktor: nema direktorskih uloga / oba modula / otkljucan direktor modula');
    const ul = c.run('ULOGE.map(u=>u[0])'); if (ul.length !== 7 || !ul.includes('direktor_projektovanja') || !ul.includes('direktor_izvodjenja')) throw new Error('ULOGE: ' + ul);
    const fs2 = require('fs'), path2 = require('path'), mig = fs2.readFileSync(path2.join(__dirname, '..', 'supabase', 'migracija-27-direktori-modula.sql'), 'utf8'), sch = fs2.readFileSync(path2.join(__dirname, '..', 'supabase', 'schema.sql'), 'utf8');
    for (const u of ul) if (!mig.includes(`'${u}'`) || !sch.includes(`'${u}'`)) throw new Error('migracija 27 / schema.sql nema ulogu ' + u);
    if (!sch.includes('profili_moduli_uloga_check') || !sch.includes('smem_brisati')) throw new Error('schema.sql nema migraciju 27');
    if (!sch.includes("create policy p_sel on log_koriscenja for select to authenticated using (je_puna_uprava());") || !/if not je_puna_uprava\(\) then raise exception 'Samo direktor i admin vide naloge\.'/.test(sch)) throw new Error('schema.sql nema migraciju 28');
    if (!sch.includes("create policy p_sel on profili for select to authenticated using (user_id = auth.uid() or je_puna_uprava());")) throw new Error('schema.sql nema migraciju 30 (profili select)');
  });

  /* ---- T56 (2026-10-14): Projektovanje — sveska = faza + cek-lista (bez JM/kolicine), bez situacija/naplate ---- */
  section('T56 sveske bez JM, bez situacija');
  await acheck('pro forma: faza select + cek-lista bez f_pm_jm/f_pm_kol; batch dodaje redove „faza — naziv" kol 1 sa zaduzenim i zadacima, dedupe; izmena = zaduzen/cena; izv forma nepromenjena; strana Specifikacija: Faza/Status, bez Izvedeno, th==td; fioka pro bez Situacija; formSit/formSituacija preskacu pro; Naplata bez pro; upozorenja/brif bez pro situacija; zdravlje pro bez penala naplate', async () => {
    const a = await boot();
    const doc = doc0 => a.g.document; const d = a.g.document;
    a.run("setRole('all'); MODUL='sve';");
    const pre = a.run("predmerZa('g8').length");
    a.run("formPredmerRed('g8')");
    let m = d.getElementById('modal').innerHTML;
    if (m.includes('id="f_pm_jm"') || m.includes('id="f_pm_kol"') || !m.includes('id="f_sv_faza"') || !m.includes('id="f_sv_lista"')) throw new Error('pro forma ima JM/kol ili nema fazu/listu: ' + m.slice(0, 300));
    if (!m.includes('option value="IDR"') || !m.includes('option value="PZI"')) throw new Error('faze nisu NIVOI_DOK');
    const faza = a.run("grById.g8.nivo"), kand = a.run("sveskeKandidati('g8', grById.g8.nivo).map(s=>s.naziv)");
    if (!kand.length) throw new Error('nema kandidata za ' + faza);
    if (kand.some(n => a.run("predmerZa('g8').some(r=>unesc(r.poz).toLowerCase()===" + JSON.stringify((faza + ' — ' + n).toLowerCase()) + ")"))) throw new Error('kandidat vec u specifikaciji');
    d.getElementById('f_sv_faza').value = faza; a.run("osveziSveskeCeklistu('g8')");
    const nK = Object.keys(a.run('SV_KAND')).length; if (nK !== kand.length) throw new Error('SV_KAND ' + nK + ' != ' + kand.length);
    Object.keys(a.run('SV_KAND')).forEach(k => { d.getElementById('f_sv_' + k).checked = +k < 2; });   // prva dva
    d.getElementById('f_pm_zad').value = 'z10';
    a.run("savePredmerRed('g8')");
    const novi = a.run("predmerZa('g8').slice(" + pre + ")");
    if (novi.length !== Math.min(2, kand.length) || !novi.every(r => r.poz.startsWith(faza + ' — ') && r.kol === 1 && r.jm === 'kom' && r.zaduzen === 'z10')) throw new Error('batch: ' + JSON.stringify(novi));
    if (!novi.every(r => a.run("DATA.zadaci.some(t=>t.predmer_id===" + JSON.stringify(r.id) + "&&t.zad==='z10')"))) throw new Error('zadaci sveski nisu napravljeni za zaduzenog');
    a.run("formPredmerRed('g8')"); d.getElementById('f_sv_faza').value = faza; a.run("osveziSveskeCeklistu('g8')");
    if (a.run("sveskeKandidati('g8', grById.g8.nivo).map(s=>s.naziv)").some(n => kand.slice(0, 2).includes(n))) throw new Error('dodate sveske i dalje kandidati (dedupe)');
    a.run('closeModal()');
    // izmena: zaduzen + cena, naziv readonly
    const pid = novi[0].id;
    a.run(`formPredmerRed('g8', ${JSON.stringify(pid)})`); m = d.getElementById('modal').innerHTML;
    if (m.includes('id="f_pm_poz"') || m.includes('id="f_pm_jm"') || !m.includes('id="f_pm_zad"') || !m.includes('id="f_pm_cena"')) throw new Error('pro izmena: ' + m.slice(0, 300));
    d.getElementById('f_pm_zad').value = 'z4'; d.getElementById('f_pm_cena').value = '12000';
    a.run(`savePredmerRed('g8', ${JSON.stringify(pid)})`);
    const x = a.run(`DATA.predmer.find(r=>r.id===${JSON.stringify(pid)})`);
    if (x.zaduzen !== 'z4' || x.cena !== 12000 || x.kol !== 1 || a.run(`DATA.zadaci.find(t=>t.predmer_id===${JSON.stringify(pid)}).zad`) !== 'z4') throw new Error('izmena sveske: ' + JSON.stringify(x));
    // Izvodjenje forma nepromenjena
    a.run("formPredmerRed('g5')"); m = d.getElementById('modal').innerHTML;
    if (!m.includes('id="f_pm_jm"') || !m.includes('id="f_pm_kol"') || m.includes('id="f_sv_faza"')) throw new Error('izv forma promenjena');
    a.run('closeModal()');
    // strana Specifikacija (pro)
    a.run("openPredmer('g8'); render();"); let v = d.getElementById('view').innerHTML;
    if (!v.includes('<th>Faza</th>') || !v.includes('<th>Status</th>') || v.includes('<th class="r">Izvedeno</th>') || v.includes('setIzv(') || v.includes('formIzvedeno(') || v.includes('izvozPredmer(') || v.includes('openKumulativ(') || v.includes('formIzSifarnika(')) throw new Error('pro specifikacija ima izv/JM/alate Izvodjenja');
    if (!v.includes('Dodaj sveske (faza')) throw new Error('nema dugmeta za sveske');
    const hd = (v.match(/<thead>[\s\S]*?<\/thead>/) || [''])[0], th = (hd.match(/<th[\s>]/g) || []).length, td = v.match(/<tbody>[\s\S]*?<tr>[\s\S]*?<\/tr>/)[0].split('<td').length - 1;
    if (th !== td) throw new Error('pro specifikacija th ' + th + ' != td ' + td);
    a.run("openPredmer('g5'); render();"); v = d.getElementById('view').innerHTML;
    if (!v.includes('<th class="r">Izvedeno</th>') || v.includes('<th>Faza</th>')) throw new Error('izv strana promenjena');
    // situacije/naplata van Projektovanja
    a.run("openSite('g8')"); const dr = d.getElementById('drawer').innerHTML;
    if (dr.includes('Situacije (') || dr.includes("formSituacija('g8')") || dr.includes('>Naplaćeno<')) throw new Error('fioka pro ima situacije/naplatu');
    a.run("openSite('g5')"); if (!d.getElementById('drawer').innerHTML.includes('Situacije (')) throw new Error('fioka izv bez situacija');
    a.run('closeDrawer()');
    a.run("formSituacija('g8')"); if (d.getElementById('modal').innerHTML.includes('Nova situacija')) throw new Error('formSituacija na pro otvorila formu');
    const nS = a.run('DATA.situacije.length'); d.getElementById('f_sbr').value = 'PF-X'; d.getElementById('st_k_pm6').value = '1'; await a.run("saveSituacija('g8')");
    if (a.run('DATA.situacije.length') !== nS) throw new Error('saveSituacija upisao situaciju na pro gradiliste');
    a.run("setRole(grById.g8.rukovodilac)");
    if (a.run("visibleSites().filter(g=>smemNa(g.id)&&imaNaplatu(g)).length") !== a.run("visibleSites().filter(g=>smemNa(g.id)&&!jePro(g)).length")) throw new Error('formSit lista');
    a.run("setRole('all'); current='pay'; render();"); v = d.getElementById('view').innerHTML;
    if (v.includes('PF-01/26') || v.includes('PF-02/26')) throw new Error('Naplata lista situacije Projektovanja');
    if (a.run("computeAlerts().some(x=>x.sit&&jePro(grById[x.gr]))") || a.run("computeAlerts().some(x=>x.tekst.startsWith('Naplata (')&&jePro(grById[x.gr]))")) throw new Error('upozorenja za pro situacije/naplatu');
    a.run("current='dash'; render();"); v = d.getElementById('view').innerHTML;
    const red = v.match(/<tr class="clk"[\s\S]*?<\/tr>/g).find(r => r.includes('openSite(\'g8\')')); if (!red || !red.includes('<td class="r sub">—</td>')) throw new Error('tabla: pro red nema — u koloni Naplata');
    const z = a.run("zdravlje({id:'zz', modul:'projektovanje', status:'u toku', rok:plusDays(200), napredak:80, budzet:1000, troskovi:800, potroseno:0, naplaceno:0})");
    const zi = a.run("zdravlje({id:'zz', modul:'izvodjenje', status:'u toku', rok:plusDays(200), napredak:80, budzet:1000, troskovi:800, potroseno:0, naplaceno:0})");
    if (z !== 100 || zi !== 85) throw new Error('zdravlje bez penala naplate na pro: pro ' + z + ' izv ' + zi);
  });

  /* ---- T55 (2026-10-14): ćirilica → latinica pri učitavanju ---- */
  section('T55 cirilica → latinica');
  await acheck('cir2lat: Lj/Nj/Dž pravila i velika slova; citajXlsx/citajCsv vraćaju latinicu; normPoz uparuje oba pisma; ćirilična situacija se upari sa latiničnim predmerom', async () => {
    const a = await boot();
    const c = s => a.run('cir2lat(' + JSON.stringify(s) + ')');
    const slucajevi = [['Љубљана', 'Ljubljana'], ['ЉУБЉАНА', 'LJUBLJANA'], ['Ђорђе Џ. Ћирић — шећер, чađ', 'Đorđe Dž. Ćirić — šećer, čađ'], ['Њ', 'Nj'], ['ИСКОП ТЕМЕЉА', 'ISKOP TEMELJA'], ['Iskop 12,5 m³', 'Iskop 12,5 m³'], ['Кабл N2XH 3x2,5', 'Kabl N2XH 3x2,5']];
    for (const [u, o] of slucajevi) if (c(u) !== o) throw new Error(JSON.stringify(u) + ' → ' + JSON.stringify(c(u)) + ' (ocekujem ' + JSON.stringify(o) + ')');
    const csv = a.run('citajCsv(' + JSON.stringify('Ископ темеља;m³;10\nЗидање;m²;5') + ')');
    if (csv[0][0] !== 'Iskop temelja' || csv[1][0] !== 'Zidanje') throw new Error('citajCsv: ' + JSON.stringify(csv));
    const buf = fs.readFileSync(path.join(ROOT, 'test', 'fixtures', 'situacija.xlsx'));
    a.g.__buf55 = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    const redovi = await a.run('citajXlsx(__buf55, true)');
    if (redovi.some(r => r.some(x => /[\u0400-\u04FF]/.test(String(x))))) throw new Error('citajXlsx vratio ćirilicu');
    if (a.run("normPoz('Ископ темеља са одвозом')") !== a.run("normPoz('Iskop temelja sa odvozom')")) throw new Error('normPoz ne izjednačava pisma');
    a.run("setRole('all')");
    const rez = a.run("upariSituaciju('g5', [['Бр.','Опис','ЈМ','Уговорено','Претходно','Ова','Кумулатив'],['1','Ископ темеља са одвозом','m³',180,0,50,50],['2','Зидање гитер блоком d=25','m²',420,0,30,30],['9','Непостојећа позиција','kom',1,0,1,1]])");
    if (rez.spojeni.length !== 2 || rez.nepovezani.length !== 1 || rez.spojeni[0].x.id !== 'pm1' || rez.nepovezani[0] !== 'Nepostojeća pozicija') throw new Error('upari ćirilica→latinica: ' + JSON.stringify({s: rez.spojeni.map(x => x.x.id), n: rez.nepovezani}));
  });

  /* ---- T54 (2026-10-13): pregled situacija — na pregledu / odobrena / vracena, komentar, istorija ---- */
  section('T54 pregled situacija');
  await acheck('rukovodilac → na_pregledu (ne ulazi u naplatu/realizaciju, bez Placeno, bez kasni); uprava → odobrena; Vrati traži komentar i daje alert rukovodiocu (bez fin) + upravi (fin, sit); ispravka vracene (stavka obrisana server-prvo) → ponovo na pregledu; Odobri → naplata; istorija', async () => {
    const a = await boot({ promptReturns: 'Količina iskopa je prevelika <x>' });
    const doc = a.g.document, set = (id, v) => { doc.getElementById(id).value = v; };
    const ruk = a.run("grById.g5.rukovodilac");
    const pre = a.run("realizacijaSituacija(grById.g5).privremene");
    a.run(`setRole(${JSON.stringify(ruk)}); formSituacija('g5');`);
    set('f_sbr', 'PS-54'); set('f_svrsta', 'privremena'); set('f_sopis', 'proba'); set('f_sizdato', a.run('todayStr()')); set('f_svaluta', '2020-01-01');
    set('st_k_pm3', '10'); set('st_k_pm4', '5');
    await a.run("saveSituacija('g5')");
    const sid = a.run("DATA.situacije.find(x=>x.br==='PS-54').id");
    let sx = a.run(`DATA.situacije.find(x=>x.id===${JSON.stringify(sid)})`);
    if (sx.pregled !== 'na_pregledu' || sx.pregledao !== null || sx.komentar !== null) throw new Error('rukovodilac: ' + JSON.stringify(sx));
    if (a.run(`sitKasni(DATA.situacije.find(x=>x.id===${JSON.stringify(sid)}))`)) throw new Error('na pregledu ne sme da "kasni"');
    a.run(`markPaid(${JSON.stringify(sid)})`);
    if (a.run(`DATA.situacije.find(x=>x.id===${JSON.stringify(sid)}).status`) === 'placeno') throw new Error('markPaid na na_pregledu');
    a.run(`detaljSituacije(${JSON.stringify(sid)})`);
    let m = doc.getElementById('modal').innerHTML;
    if (!m.includes('Na pregledu') || m.includes('odobriSituaciju(') || m.includes('vratiSituaciju(') || m.includes('markPaid(')) throw new Error('rukovodilac detalj: ' + m.slice(0, 300));
    a.run('closeModal()');
    // uprava
    a.run("setRole('all'); MODUL='sve';");
    if (a.run("realizacijaSituacija(grById.g5).privremene") !== pre) throw new Error('na_pregledu usla u realizaciju');
    a.run("current='pay'; render();"); let v = doc.getElementById('view').innerHTML;
    if (!v.includes('Na pregledu') || v.includes("markPaid('" + sid + "')")) throw new Error('Naplata: bedz/placeno');
    const th = (v.match(/<th[\s>]/g) || []).length, td = v.match(/<tbody>[\s\S]*?<tr>[\s\S]*?<\/tr>/)[0].split('<td').length - 1; if (th !== td) throw new Error('Naplata th ' + th + ' != td ' + td);
    let al = a.run('computeAlerts()').filter(x => x.sit === sid);
    if (al.length !== 1 || !al[0].fin || !/čeka pregled/.test(al[0].tekst)) throw new Error('uprava alert: ' + JSON.stringify(al));
    a.run("current='dash'; render();");
    v = doc.getElementById('view').innerHTML;
    if (!v.includes('čeka pregled')) throw new Error('tabla: brif nema "čeka pregled"');
    const idx = a.run('computeAlerts()').findIndex(x => x.sit === sid);   // kartica prikazuje prvih 7 upozorenja (crvena prvo)
    if (idx >= 0 && idx < 7 && !v.includes("detaljSituacije('" + sid + "')")) throw new Error('tabla: upozorenje bez klika na detalj');
    if (!v.includes("detaljSituacije('")) throw new Error('tabla: nijedno upozorenje ne otvara detalj (idx ' + idx + ')');
    a.run(`detaljSituacije(${JSON.stringify(sid)})`); m = doc.getElementById('modal').innerHTML;
    if (!m.includes("vratiSituaciju('" + sid + "')") || !m.includes("odobriSituaciju('" + sid + "')") || m.includes("markPaid(")) throw new Error('uprava detalj dugmad');
    const pr0 = a.g._calls.prompt.length;
    a.run(`vratiSituaciju(${JSON.stringify(sid)})`);
    sx = a.run(`DATA.situacije.find(x=>x.id===${JSON.stringify(sid)})`);
    if (a.g._calls.prompt.length !== pr0 + 1 || sx.pregled !== 'vracena' || sx.komentar !== 'Količina iskopa je prevelika &lt;x&gt;' || sx.pregledao !== 'direkcija' || !sx.istorija || sx.istorija.length !== 1 || sx.istorija[0].odluka !== 'vracena') throw new Error('vrati: ' + JSON.stringify(sx));
    // rukovodilac: alert bez fin, ispravka (pm4 izbacena, pm1 dodata), ponovo na pregled
    a.run(`setRole(${JSON.stringify(ruk)})`);
    al = a.run('computeAlerts()').filter(x => x.sit === sid);
    if (al.length !== 1 || al[0].fin || !/vraćena/.test(al[0].tekst) || !al[0].tekst.includes('prevelika')) throw new Error('rukovodilac alert: ' + JSON.stringify(al));
    a.run(`detaljSituacije(${JSON.stringify(sid)})`); m = doc.getElementById('modal').innerHTML;
    if (!m.includes("formSituacija('g5','" + sid + "')") || !m.includes('Vraćena') || !m.includes('prevelika')) throw new Error('rukovodilac: nema ispravke/komentara');
    a.run(`formSituacija('g5', ${JSON.stringify(sid)})`); m = doc.getElementById('modal').innerHTML;
    if (!m.includes('Izmena vraćene situacije') || !m.includes("saveSituacija('g5','" + sid + "')")) throw new Error('forma izmene');
    set('f_sbr', 'PS-54'); set('f_svrsta', 'privremena'); set('f_sopis', 'proba 2'); set('f_sizdato', a.run('todayStr()')); set('f_svaluta', a.run('plusDays(10)'));
    set('st_k_pm3', '8'); set('st_k_pm4', ''); set('st_k_pm1', '2');
    const delPre = a.run("DATA.situacija_stavke.filter(x=>x.sit===" + JSON.stringify(sid) + ").map(x=>x.predmer_id).sort().join()");
    await a.run(`saveSituacija('g5', ${JSON.stringify(sid)})`);
    sx = a.run(`DATA.situacije.find(x=>x.id===${JSON.stringify(sid)})`);
    const st = a.run("DATA.situacija_stavke.filter(x=>x.sit===" + JSON.stringify(sid) + ")");
    if (delPre !== 'pm3,pm4' || st.map(x => x.predmer_id).sort().join() !== 'pm1,pm3' || st.find(x => x.predmer_id === 'pm3').kol !== 8) throw new Error('ispravka stavki: ' + delPre + ' → ' + JSON.stringify(st));
    if (sx.pregled !== 'na_pregledu' || sx.opis !== 'proba 2' || sx.komentar !== 'Količina iskopa je prevelika &lt;x&gt;' || sx.istorija.length !== 2) throw new Error('ponovo na pregled: ' + JSON.stringify(sx));
    if (a.run("DATA.situacije.filter(x=>x.br==='PS-54').length") !== 1) throw new Error('izmena napravila duplikat');
    // uprava odobri → naplata, realizacija, Placeno
    a.run("setRole('all')"); a.run(`odobriSituaciju(${JSON.stringify(sid)})`);
    sx = a.run(`DATA.situacije.find(x=>x.id===${JSON.stringify(sid)})`);
    if (sx.pregled !== 'odobrena' || sx.istorija.length !== 3 || sx.istorija[2].odluka !== 'odobrena') throw new Error('odobri: ' + JSON.stringify(sx));
    if (a.run("realizacijaSituacija(grById.g5).privremene") !== pre + sx.iznos) throw new Error('odobrena nije usla u realizaciju');
    a.run(`detaljSituacije(${JSON.stringify(sid)})`); m = doc.getElementById('modal').innerHTML;
    if (!m.includes("markPaid('" + sid + "')") || m.includes("odobriSituaciju(") || !m.includes('Istorija pregleda') || !m.includes('odobrio')) throw new Error('odobrena detalj: ' + m.slice(-600));
    if (a.run('computeAlerts()').some(x => x.sit === sid)) throw new Error('odobrena i dalje u upozorenjima pregleda');
    a.run('closeModal()');
    // uprava pravi situaciju → odmah odobrena
    a.run("formSituacija('g5')"); set('f_sbr', 'PS-55'); set('f_svrsta', 'privremena'); set('f_sopis', ''); set('f_sizdato', a.run('todayStr()')); set('f_svaluta', a.run('plusDays(10)')); set('st_k_pm3', '1');
    await a.run("saveSituacija('g5')");
    if (a.run("DATA.situacije.find(x=>x.br==='PS-55').pregled") !== 'odobrena') throw new Error('uprava: nije odobrena odmah');
    // supabase: brisanje stavke ide na server (delete), vracena situacija se azurira update-om
    const b = await boot({ supabase: true, seed: {}, promptReturns: 'k' });
    b.run("DATA.situacije.push({id:'s54', gr:'g5', br:'X', opis:'x', iznos:0, izdato:todayStr(), valuta:todayStr(), status:'ceka', vrsta:'privremena', autor:'z7', napomena:null, pregled:'vracena', komentar:'k', pregledao:'direkcija', pregledano:null, istorija:[]}); DATA.situacija_stavke.push({id:'st54a', sit:'s54', gr:'g5', predmer_id:'pm3', sifra:null, poz:'a', jm:'m²', kol:1, kol_ugovoreno:0, kumulativ:0, razlika:0},{id:'st54b', sit:'s54', gr:'g5', predmer_id:'pm4', sifra:null, poz:'b', jm:'m²', kol:1, kol_ugovoreno:0, kumulativ:0, razlika:0});");
    await b.run('doSave()'); for (let i = 0; i < 6; i++) await new Promise(r => setImmediate(r));
    b.run("setRole(grById.g5.rukovodilac); formSituacija('g5','s54');");
    const bd = b.g.document, bset = (id, v) => { bd.getElementById(id).value = v; };
    bset('f_sbr', 'X'); bset('f_svrsta', 'privremena'); bset('f_sopis', 'x'); bset('f_sizdato', b.run('todayStr()')); bset('f_svaluta', b.run('todayStr()')); bset('st_k_pm3', '2'); bset('st_k_pm4', '');
    await b.run("saveSituacija('g5','s54')"); await b.run('doSave()'); for (let i = 0; i < 6; i++) await new Promise(r => setImmediate(r));
    const dl = b.g.__mock._log.filter(l => l.op === 'delete' && l.table === 'situacija_stavke');
    if (!dl.length || (b.g.__mock._db.situacija_stavke || []).some(x => x.id === 'st54b')) throw new Error('obrisana stavka nije otisla na server: ' + JSON.stringify(dl));
    if ((b.g.__mock._db.situacije || []).find(x => x.id === 's54').pregled !== 'na_pregledu') throw new Error('ponovo na pregled nije stiglo u bazu');
  });

  /* ---- T53 (2026-10-12): magacin = sifarnik Izvodjenja (81) + Razno; red nastaje na prvom ulazu ---- */
  section('T53 magacin po sifarniku');
  await acheck('viewMagacin: svi artikli sifarnika (virtuelno, stanje 0) + Razno (m1–m3); prvi ulaz pravi red mg-<sf> sa nazivom/JM iz sifarnika; drugi ulaz ne duplira; izlaz sa 0 i rukovodilacev ulaz = no-op bez reda; nepromenjen DATA ne salje nista; tab po modulu', async () => {
    const a = await boot();
    a.run("setRole('all'); current='magacin'; render();");
    let h = a.g.document.getElementById('view').innerHTML;
    const n = a.run("sifrarnikZa('izvodjenje').length");
    if (n < 81) throw new Error('sifarnik izvodjenja < 81: ' + n);
    if (!h.includes('Šifarnik artikala (' + n + ')') || !h.includes('Razno (3)')) throw new Error('zaglavlja sekcija: ' + h.slice(0, 300));
    if ((h.match(/formMagPromena\('mg-sf-a-/g) || []).length !== n) throw new Error('nema ulaza za svaki artikal');
    if (h.includes("formMagPromena('mg-sf-a-001','izlaz')")) throw new Error('izlaz ponudjen na stanju 0');
    if (!h.includes("formMagPromena('m1','izlaz')") || !h.includes('oninput="filtrirajMagacin(this)"')) throw new Error('razno/izlaz/filter');
    if (a.run('DATA.magacin.length') !== 3) throw new Error('render je materijalizovao redove');
    // prvi ulaz (uprava)
    a.run("formMagPromena('mg-sf-a-001','ulaz')");
    if (!a.g.document.getElementById('modal').innerHTML.includes('trenutno stanje: <b class="num">0')) throw new Error('forma ulaza za virtuelan artikal');
    a.g.document.getElementById('f_mpkol').value = '12';
    a.run("saveMagPromena('mg-sf-a-001','ulaz')");
    const m = a.run("DATA.magacin.find(x=>x.id==='mg-sf-a-001')"), sf = a.run("DATA.sifrarnik.find(x=>x.id==='sf-a-001')");
    if (!m || m.naziv !== sf.naziv || m.jm !== sf.jm || m.stanje !== 12 || Object.keys(m).sort().join() !== 'id,jm,naziv,stanje') throw new Error('red posle prvog ulaza: ' + JSON.stringify(m));
    if (a.run("DATA.mag_promene.filter(x=>x.mid==='mg-sf-a-001').length") !== 1) throw new Error('promena nije zabelezena');
    a.run("formMagPromena('mg-sf-a-001','ulaz')"); a.g.document.getElementById('f_mpkol').value = '3'; a.run("saveMagPromena('mg-sf-a-001','ulaz')");
    if (a.run("DATA.magacin.filter(x=>x.id==='mg-sf-a-001').length") !== 1 || a.run("DATA.magacin.find(x=>x.id==='mg-sf-a-001').stanje") !== 15) throw new Error('drugi ulaz');
    a.run("current='magacin'; render();"); h = a.g.document.getElementById('view').innerHTML;
    if (!h.includes("formMagPromena('mg-sf-a-001','izlaz')") || h.includes('Razno (4)')) throw new Error('posle ulaza: izlaz/razno');
    // izlaz sa 0 (virtuelan) i rukovodilacev ulaz = no-op
    a.run("formMagPromena('mg-sf-a-002','izlaz')"); a.g.document.getElementById('f_mpkol').value = '1'; a.g.document.getElementById('f_mpgr').value = 'g1'; a.run("saveMagPromena('mg-sf-a-002','izlaz')");
    if (a.run("DATA.magacin.some(x=>x.id==='mg-sf-a-002')")) throw new Error('izlaz sa 0 napravio red');
    a.run("setRole('z1'); formMagPromena('mg-sf-a-003','ulaz');"); a.g.document.getElementById('f_mpkol').value = '5'; a.run("saveMagPromena('mg-sf-a-003','ulaz')");
    if (a.run("DATA.magacin.some(x=>x.id==='mg-sf-a-003')")) throw new Error('rukovodilac napravio ulaz');
    a.run("current='magacin'; render();"); h = a.g.document.getElementById('view').innerHTML;
    if (h.includes("'ulaz')") || !h.includes('Šifarnik artikala (')) throw new Error('rukovodilac: ulaz ponudjen / lista fali');
    // supabase: nepromenjen DATA ne salje magacin
    const s0 = await boot({ supabase: true, seed: {} });   // direktor zaseje demo (upsert m1–m3 je SEED)
    await s0.run('doSave()'); for (let i = 0; i < 6; i++) await new Promise(r => setImmediate(r));
    const seed = JSON.parse(JSON.stringify(s0.g.__mock._db)); delete seed.log_koriscenja;
    const b = await boot({ supabase: true, seed });
    const od = b.g.__mock._log.length;
    b.run("current='magacin'; render();");
    await b.run('doSave()'); for (let i = 0; i < 6; i++) await new Promise(r => setImmediate(r));
    const ups = b.g.__mock._log.slice(od).filter(l => (l.op === 'upsert' || l.op === 'insert') && l.table === 'magacin');
    if (ups.length) throw new Error('render magacina gura redove u bazu: ' + JSON.stringify(ups));
    // tab po modulu + povratak na dash
    a.run("setRole('all'); current='magacin'; setRole('radnik:z10|pro'); renderNav();");
    if (a.run('current') !== 'dash') throw new Error('radnik |pro ostao na magacinu');
    a.run("setRole('all')");
  });

  /* ---- T52 (2026-10-12): druga mera zdravlja u Izvodjenju — ugovoreno vs privremene vs okoncana situacija ---- */
  section('T52 ugovoreno vs situacije');
  await acheck('realizacijaSituacija: g5 = Σ kol×cena vs Σ iznos privremenih (okoncana —); pro i ne-fin = null; tabla kolona + th==td, fioka stat, presek blok; Projektovanje modul bez kolone', async () => {
    const a = await boot();
    const doc = a.g.document;
    a.run("setRole('all'); MODUL='sve';");
    const r = a.run("realizacijaSituacija(grById.g5)");
    const ug = a.run("predmerZa('g5').reduce((x,p)=>x+p.kol*p.cena,0)"), pr = a.run("sitZa('g5').filter(x=>x.vrsta!=='okoncana').reduce((x,b)=>x+b.iznos,0)");
    if (!r || r.ugovoreno !== ug || r.privremene !== pr || r.pPriv !== Math.round(pr / ug * 100) || r.okoncana !== null || r.pOkon !== null) throw new Error('g5: ' + JSON.stringify(r) + ' ug=' + ug + ' pr=' + pr);
    if (ug !== 64270 || pr !== 27500 || r.pPriv !== 43) throw new Error('demo g5 brojevi: ' + JSON.stringify(r));
    a.run("DATA.situacije.push({id:'s52', gr:'g5', br:'OK-52', opis:'x', iznos:60000, izdato:todayStr(), valuta:todayStr(), status:'ceka', vrsta:'okoncana', autor:'z7'});");
    const r2 = a.run("realizacijaSituacija(grById.g5)");
    if (r2.okoncana !== pr + 60000 || r2.pOkon !== 136 || r2.privremene !== pr) throw new Error('okoncana = Σ svih situacija (prirasti): ' + JSON.stringify(r2));
    if (a.run("realizacijaSituacija(grById.g8)") !== null) throw new Error('Projektovanje ima realizaciju situacija');
    a.run("current='dash'; render();");
    let h = doc.getElementById('view').innerHTML;
    if (!h.includes('Ugov. vs situacije') || !h.includes("setDashSort('sit')")) throw new Error('tabla nema kolonu');
    const hd = (h.match(/<thead>[\s\S]*?<\/thead>/g) || []).find(x => x.includes('Ugov. vs situacije')) || '';   // tabla ima vise tabela (rokovi…) — uzmi onu sa kolonom
    const th = (hd.match(/<th[\s>]/g) || []).length, tr = h.slice(h.indexOf(hd)).match(/<tr class="clk"[\s\S]*?<\/tr>/)[0].split('<td').length - 1;
    if (th !== tr) throw new Error('th ' + th + ' != td ' + tr);
    a.run("MODUL='projektovanje'; render();");
    if (doc.getElementById('view').innerHTML.includes('Ugov. vs situacije')) throw new Error('Projektovanje modul ima kolonu situacija');
    a.run("MODUL='sve'; openSite('g5');");
    const d = doc.getElementById('drawer').innerHTML;
    if (!d.includes('Ugovoreno vs situacije') || !d.includes('43%') || !d.includes('136%') || !d.includes('okončana (ukupno)')) throw new Error('fioka nema stat: ' + d.slice(0, 200));
    a.run("openSite('g8');");
    if (doc.getElementById('drawer').innerHTML.includes('Ugovoreno vs situacije')) throw new Error('fioka pro ima stat');
    a.run("openPresek('g5');");
    const p = doc.getElementById('rpt').innerHTML;
    if (!p.includes('Ugovoreno (predmer)') || !p.includes('Privremene situacije (2)') || !p.includes('43% ugovorenog') || !p.includes('136% ugovorenog') || !p.includes('preko ugovorenog')) throw new Error('presek bez bloka');
    a.run("closeDrawer(); closeIzvestaj(); setRole(grById.g5.rukovodilac);");
    if (a.run("realizacijaSituacija(grById.g5)") !== null) throw new Error('rukovodilac bez finansija dobio realizaciju');
    a.run("openSite('g5');");
    if (doc.getElementById('drawer').innerHTML.includes('Ugovoreno vs situacije')) throw new Error('fioka bez finansija ima stat');
    a.run("current='dash'; render();");
    if (doc.getElementById('view').innerHTML.includes('Ugov. vs situacije')) throw new Error('tabla bez finansija ima kolonu');
    a.run("setRole('all'); closeDrawer();");
  });

  /* ---- T51 (2026-10-12): tabla bez plan. marze; jedinicne cene za rukovodioca Izvodjenja; adresa gradilista; play samo na jednom zadatku ---- */
  section('T51 cene/adresa/jedan play');
  await acheck('vidimCene: rukovodilac Izvodjenja bez finansija vidi jed. cene (predmer stranica, detalj situacije), ne i KPI/ukupno/Placeno; rukovodilac Projektovanja ne; radnik ne; mock predmer_v daje cenu samo za svoje Izvodjenje; rowsZa ne salje cenu', async () => {
    const a = await boot();
    const doc = a.g.document;
    const g5r = a.run("grById.g5.rukovodilac"), g8r = a.run("grById.g8.rukovodilac");
    a.run(`setRole(${JSON.stringify(g5r)})`);
    if (a.run('canFinance()') || !a.run("vidimCene('g5')")) throw new Error('rukovodilac g5: canFinance=' + a.run('canFinance()') + ' vidimCene=' + a.run("vidimCene('g5')"));
    a.run("openPredmer('g5'); render();");
    let h = doc.getElementById('view').innerHTML;
    const c1 = a.run("fmtEur(predmerZa('g5')[0].cena)");
    if (!h.includes('Jed. cena (RSD, bez PDV)') || !h.includes(c1)) throw new Error('predmer g5 bez cena za rukovodioca');
    if (h.includes('<th class="r">Ukupno</th>') || h.includes(a.run("fmtEur(predmerZa('g5')[0].kol*predmerZa('g5')[0].cena)"))) throw new Error('rukovodilac bez finansija vidi kol×cena po redu');
    if (h.includes('Izvedena vrednost') || h.includes('izvozPredmer(')) throw new Error('rukovodilac bez finansija dobio KPI vrednosti / izvoz');
    const nTh = (h.match(/<th/g) || []).length, nTd = (h.match(/<\/tr>/g) || []).length; if (!nTh || !nTd) throw new Error('tabela predmera prazna');
    const sit = a.run("sitZa('g5')[0]");
    a.run(`detaljSituacije(${JSON.stringify(sit.id)})`);
    h = doc.getElementById('modal').innerHTML;
    if (!h.includes('Jed. cena (bez PDV)') || h.includes('Iznos (bez PDV)') || h.includes('Ukupno:') || h.includes("markPaid(")) throw new Error('detalj situacije za rukovodioca: kolone/iznos/ukupno/placeno pogresno');
    a.run('closeModal()');
    a.run(`setRole(${JSON.stringify(g8r)})`);
    if (a.run("vidimCene('g8')")) throw new Error('rukovodilac Projektovanja vidi cene');
    a.run("openPredmer('g8'); render();");
    if (doc.getElementById('view').innerHTML.includes('Jed. cena')) throw new Error('specifikacija g8 ima cene za rukovodioca bez finansija');
    const rad = a.run("(DATA.zaposleni.find(z=>(z.grs||[]).includes('g5')&&z.id!==grById.g5.rukovodilac)||{}).id");
    a.run(`setRole('radnik:${rad}')`);
    if (a.run("vidimCene('g5')")) throw new Error('radnik vidi cene');
    a.run(`setRole(${JSON.stringify(g5r)})`);
    if (a.run("rowsZa('predmer', DATA).some(x=>'cena' in x)") && a.run('jeRukovodilacNalog()')) throw new Error('rowsZa salje cenu');
    // mock view: Petar (rukovodilac bez finansija) dobija cenu na g1 (Izvodjenje), ne na projektantskom gradilistu koje bi vodio
    const DIR = { user: { id: 'u-dir', email: 'direktor@test' } }, RUK = { user: { id: 'u-ruk', email: 'petar@test' } };
    const s0 = await boot({ supabase: true, seed: {}, session: DIR });
    s0.run("DATA.gradilista.push({...grById.g8, id:'gPro51', naziv:'Pro 51', rukovodilac:'z1'}); DATA.predmer.push({id:'pm51a',gr:'g1',poz:'A51',jm:'m',kol:1,cena:70,izv:0,zaduzen:null},{id:'pm51b',gr:'gPro51',poz:'Sveska 51',jm:'kom',kol:1,cena:500,izv:0,zaduzen:null});");
    await s0.run('doSave()'); for (let i = 0; i < 6; i++) await new Promise(r => setImmediate(r));
    const seed = JSON.parse(JSON.stringify(s0.g.__mock._db)); delete seed.log_koriscenja;
    const b = await boot({ supabase: true, seed, session: RUK });
    if (b.run("DATA.predmer.find(x=>x.id==='pm51a').cena") !== 70) throw new Error('mock predmer_v: rukovodilac Izvodjenja ne dobija cenu');
    if (b.run("DATA.predmer.find(x=>x.id==='pm51b').cena") != null) throw new Error('mock predmer_v: cena curi na projektantskom gradilistu');
    if (b.run("grById.g1.budzet") != null || b.run("DATA.situacije.some(x=>x.iznos!=null)")) throw new Error('budzet/iznos cure');
    if (!b.run("rowsZa('predmer', DATA).every(x=>!('cena' in x))")) throw new Error('rukovodilac bi poslao cenu nazad');
  });
  await acheck('adresa gradilista: polje u formi, cuva se (izmena + novo, null kad prazno), fioka/kartica/mejl trebovanja/pretraga', async () => {
    const a = await boot();
    const doc = a.g.document, set = (id, v) => { doc.getElementById(id).value = v; };
    a.run("ROLE='all'; formSite('g1');");
    if (!doc.getElementById('modal').innerHTML.includes('id="f_adresa"')) throw new Error('forma nema polje Adresa');
    set('f_naziv', a.run('grById.g1.naziv')); set('f_lok', 'Novi Sad'); set('f_adresa', 'Bulevar oslobođenja 12 <x>'); set('f_povrsina', '');
    set('f_kli', ''); set('f_ruk', ''); set('f_poc', ''); set('f_rok', ''); set('f_cena', ''); set('f_tro', '');
    a.run("saveSite('g1')");
    if (a.run('grById.g1.adresa') !== 'Bulevar oslobođenja 12 &lt;x&gt;') throw new Error('adresa nije sacuvana/esc: ' + a.run('grById.g1.adresa'));
    a.run("openSite('g1')");
    if (!doc.getElementById('drawer').innerHTML.includes('Bulevar oslobođenja 12 &lt;x&gt;')) throw new Error('fioka ne prikazuje adresu');
    a.run("current='sites'; siteQuery='oslobođenja'; render();");
    const v = doc.getElementById('view').innerHTML;
    if (!v.includes('Bulevar oslobođenja 12') || !v.includes(a.run('grById.g1.naziv'))) throw new Error('kartica/pretraga po adresi');
    a.run('siteQuery=""');
    const telo = a.run("narudzbaMailBody({gr:'g1', autor:'z1', datum:todayStr(), rok:todayStr(), stavke:[{naziv:'x',kolicina:'1',jm:'kom'}]})");
    if (!telo.includes('Adresa: Bulevar oslobođenja 12 <x>')) throw new Error('mejl trebovanja bez adrese: ' + telo);
    a.run("formSite('g1');"); set('f_naziv', a.run('grById.g1.naziv')); set('f_adresa', ''); set('f_lok', 'Novi Sad'); a.run("saveSite('g1')");
    if (a.run('grById.g1.adresa') !== null || !a.run("'adresa' in grById.g1")) throw new Error('prazna adresa mora biti null (ne delete)');
    if (!a.run("rowsZa('gradilista', DATA).every(g=>g.id!=='g1' || ('adresa' in g))")) throw new Error('rowsZa ne nosi adresu');
    a.run("ROLE='all'; formSite();");
    set('f_naziv', 'T51 novo'); set('f_modul', 'izvodjenje'); set('f_tip', 'visokogradnja'); set('f_kli', a.run('DATA.clijenti[0].id')); set('f_ruk', 'z1');
    set('f_lok', 'Beograd'); set('f_adresa', 'Kneza Miloša 1'); set('f_poc', a.run('todayStr()')); set('f_rok', a.run('plusDays(30)')); set('f_cena', '1'); set('f_tro', '1');
    a.run('saveSite()');
    if (a.run('DATA.gradilista[DATA.gradilista.length-1].adresa') !== 'Kneza Miloša 1') throw new Error('novo gradiliste bez adrese');
  });
  await acheck('tajmer: dok radim na jednom zadatku, ostali moji zadaci nemaju ▶ (samo poruka + ■ ako je u toku); posle pauze ▶ se vraca', async () => {
    const a = await boot();
    const doc = a.g.document;
    const z = a.run("(DATA.zadaci.filter(t=>zadatakPro(t)&&t.kol!=='done').map(t=>t.zad).find(zid=>DATA.zadaci.filter(t=>zadatakPro(t)&&t.zad===zid&&t.kol!=='done').length>=2))");
    if (!z) throw new Error('nema osobe sa 2 otvorena zadatka Projektovanja u demo');
    a.run(`setRole('radnik:${z}')`);
    const moji = a.run("zadaciVidljivi().filter(t=>t.kol!=='done').map(t=>t.id)");
    if (moji.length < 2) throw new Error('radnik vidi < 2 zadatka: ' + moji);
    const [t1, t2] = moji;
    a.run(`pocniZadatak('${t1}')`);
    if (!a.run("mojaOtvorenaSesija()")) throw new Error('sesija nije otvorena');
    const l1 = a.run(`tajmerLinija(DATA.zadaci.find(t=>t.id==='${t1}'))`), l2 = a.run(`tajmerLinija(DATA.zadaci.find(t=>t.id==='${t2}'))`);
    if (!l1.includes("pauzirajZadatak('" + t1 + "')")) throw new Error('aktivan zadatak nema Pauziraj');
    if (l2.includes("pocniZadatak('") || !l2.includes('Radiš na:')) throw new Error('drugi zadatak nudi ▶ dok prvi radi: ' + l2);
    a.run("current='tasks'; render();");
    const h = doc.getElementById('view').innerHTML;
    if ((h.match(/pocniZadatak\('/g) || []).length) throw new Error('kanban nudi ▶ na drugim zadacima dok jedan radi');
    a.run(`pauzirajZadatak('${t1}')`);
    if (!a.run(`tajmerLinija(DATA.zadaci.find(t=>t.id==='${t2}'))`).includes("pocniZadatak('" + t2 + "')")) throw new Error('posle pauze ▶ se ne vraca');
    // zaglavljena sesija na zadatku Izvodjenja (nevidljiv) ne sme da sakrije ▶ — jedini izlaz je pocniZadatak koji je sam zatvori
    a.run(`DATA.zadaci.push({id:'t51izv',naziv:'stari izv',gr:DATA.gradilista.find(g=>!jePro(g)).id,zad:'${z}',prio:'mid',kol:'inprogress',rok:todayStr()}); DATA.rad_na_zadatku.push({id:'rz51',zadatak:'t51izv',gr:DATA.gradilista.find(g=>!jePro(g)).id,osoba:'${z}',start:new Date(Date.now()-60000).toISOString(),kraj:null,minuta:null,napomena:''});`);
    if (!a.run(`tajmerLinija(DATA.zadaci.find(t=>t.id==='${t2}'))`).includes("pocniZadatak('" + t2 + "')")) throw new Error('zaglavljena sesija Izvodjenja sakrila ▶ na zadatku Projektovanja');
    a.run(`pocniZadatak('${t2}')`);
    if (a.run("DATA.rad_na_zadatku.find(s=>s.id==='rz51').kraj") == null || a.run(`!otvorenaSesija('${t2}', '${z}')`)) throw new Error('pocniZadatak nije zatvorio zaglavljenu sesiju / otvorio novu');
    a.run(`pauzirajZadatak('${t2}')`);
  });

  /* ---- T50 fioka Projektovanja: bez tima i zadataka — sveske (tipovi dokumentacije) po osobi, dodela, dokument uz svesku ---- */
  section('T50 sveske po osobi');
  await acheck('fioka pro: nema „Tim na gradilištu" ni „Zadaci"; sveske grupisane po zaduzenom; select za dodelu samo ko vodi; dodeliSvesku menja predmer.zaduzen + zadatak + ubacuje u tim; dokument uz svesku stoji uz svesku, ne u opstim; brisanje sveske gasi vezu; Izvodjenje nepromenjeno', async () => {
    const a = await boot();
    const doc = a.g.document, dr = () => doc.getElementById('drawer').innerHTML;
    const gid = a.run("DATA.gradilista.find(g=>jePro(g)&&predmerZa(g.id).length>=3).id");
    const ruk = a.run(`grById[${JSON.stringify(gid)}].rukovodilac`);
    a.run("setRole('all'); MODUL='sve';");
    a.run(`openSite(${JSON.stringify(gid)})`);
    let h = dr();
    if (h.includes('Tim na gradilištu') || h.includes('formTim(') || h.includes('Zadaci (') || h.includes('dr-task')) throw new Error('fioka pro i dalje ima tim/zadatke');
    if (!h.includes('Dokumentacija po osobi (' + a.run(`predmerZa(${JSON.stringify(gid)}).length`) + ')')) throw new Error('nema sekcije Dokumentacija po osobi');
    const pm = a.run(`predmerZa(${JSON.stringify(gid)})`);
    for (const p of pm) { if (!h.includes(p.poz) || !h.includes(`uploadDokument('${gid}','${p.id}')`)) throw new Error('sveska bez reda/upload-a: ' + p.poz); }
    const dodeljeni = [...new Set(pm.map(p => p.zaduzen).filter(Boolean))];
    for (const z of dodeljeni) { if (!h.includes('<b>' + a.run(`zaduzenIme(${JSON.stringify(z)})`) + '</b>')) throw new Error('nema grupe za osobu ' + z); }
    if ((h.match(/dodeliSvesku\(/g) || []).length !== pm.length) throw new Error('uprava: select za dodelu nije na svakoj svesci');
    if (!h.includes("formPredmerRed('" + gid + "')")) throw new Error('nema dugmeta za novu svesku');
    // radnik u timu: vidi sveske, bez dodele i bez tajmera na tudjoj
    const zid = a.run(`(DATA.zaposleni.find(z=>z.id!==${JSON.stringify(ruk)}&&(z.grs||[]).includes(${JSON.stringify(gid)}))||{}).id`);
    a.run(`setRole('radnik:${zid}')`); a.run(`openSite(${JSON.stringify(gid)})`); h = dr();
    if (!h.includes('Dokumentacija po osobi') || h.includes('dodeliSvesku(')) throw new Error('radnik: nema sekcije ili ima dodelu');
    const tudja = pm.find(p => p.zaduzen && p.zaduzen !== zid), moja = pm.find(p => p.zaduzen === zid);
    const tTudja = a.run(`(DATA.zadaci.find(t=>t.predmer_id===${JSON.stringify(tudja.id)})||{}).id`);
    if (tTudja && h.includes("pocniZadatak('" + tTudja + "')")) throw new Error('radnik ima START na tudjoj svesci');
    if (moja) { const tm = a.run(`(DATA.zadaci.find(t=>t.predmer_id===${JSON.stringify(moja.id)})||{}).id`); if (tm && a.run(`DATA.zadaci.find(t=>t.id===${JSON.stringify(tm)}).kol`) !== 'done' && !h.includes("pocniZadatak('" + tm + "')") && !h.includes("zavrsiZadatak('" + tm + "')") && !h.includes("pauzirajZadatak('" + tm + "')")) throw new Error('radnik nema tajmer na svojoj svesci'); }
    // dodela: radnik ne sme; rukovodilac sme → zaduzen, zadatak.zad, tim (grs), fioka osvezena
    const novi = a.run(`(DATA.zaposleni.find(z=>!(z.grs||[]).includes(${JSON.stringify(gid)})&&z.id!==${JSON.stringify(ruk)})||{}).id`);
    a.run(`dodeliSvesku(${JSON.stringify(gid)}, ${JSON.stringify(tudja.id)}, ${JSON.stringify(novi)})`);
    if (a.run(`DATA.predmer.find(p=>p.id===${JSON.stringify(tudja.id)}).zaduzen`) !== tudja.zaduzen) throw new Error('radnik dodelio svesku');
    a.run(`setRole(${JSON.stringify(ruk)})`); a.run(`openSite(${JSON.stringify(gid)})`);
    if (!dr().includes('dodeliSvesku(')) throw new Error('rukovodilac nema select za dodelu');
    a.run(`dodeliSvesku(${JSON.stringify(gid)}, ${JSON.stringify(tudja.id)}, ${JSON.stringify(novi)})`);
    if (a.run(`DATA.predmer.find(p=>p.id===${JSON.stringify(tudja.id)}).zaduzen`) !== novi) throw new Error('zaduzen nije promenjen');
    if (a.run(`DATA.zadaci.find(t=>t.predmer_id===${JSON.stringify(tudja.id)}).zad`) !== novi) throw new Error('zadatak sveske nije presao na novu osobu');
    if (!a.run(`zapById[${JSON.stringify(novi)}].grs`).includes(gid)) throw new Error('nova osoba nije usla u tim (RLS: radnik ne bi video gradiliste)');
    if (!dr().includes('<b>' + a.run(`zaduzenIme(${JSON.stringify(novi)})`) + '</b>')) throw new Error('fioka nije osvezena posle dodele');
    // skidanje dodele: sveska pod „Nedodeljeno", zadatak ide rukovodiocu (ne ostaje staroj osobi)
    a.run(`dodeliSvesku(${JSON.stringify(gid)}, ${JSON.stringify(tudja.id)}, '')`);
    if (a.run(`DATA.predmer.find(p=>p.id===${JSON.stringify(tudja.id)}).zaduzen`) !== null) throw new Error('zaduzen nije skinut');
    if (a.run(`DATA.zadaci.find(t=>t.predmer_id===${JSON.stringify(tudja.id)}).zad`) !== ruk) throw new Error('zadatak nedodeljene sveske nije presao rukovodiocu');
    if (!dr().includes('<b>Nedodeljeno</b>')) throw new Error('fioka nema grupu Nedodeljeno');
    a.run(`dodeliSvesku(${JSON.stringify(gid)}, ${JSON.stringify(tudja.id)}, ${JSON.stringify(novi)})`);
    // formPredmerRed na pro nudi i osobu van tima
    const vanTima = a.run(`(DATA.zaposleni.find(z=>!(z.grs||[]).includes(${JSON.stringify(gid)}))||{}).id`);
    a.run(`formPredmerRed(${JSON.stringify(gid)})`);
    if (!doc.getElementById('modal').innerHTML.includes('value="' + vanTima + '"')) throw new Error('nova sveska ne nudi osobu van tima');
    a.run('closeModal()');
    // dokument uz svesku
    const d = a.run(`dodajDokument({gr:${JSON.stringify(gid)}, predmer_id:${JSON.stringify(tudja.id)}, naziv:'sveska <1>.pdf', tip:'application/pdf', velicina:10, opis:'', data:'data:,'})`);
    if (!d || d.predmer_id !== tudja.id || d.naziv !== 'sveska &lt;1&gt;.pdf') throw new Error('dodajDokument: ' + JSON.stringify(d));
    a.run(`openSite(${JSON.stringify(gid)})`); h = dr();
    const iS = h.indexOf('sveska &lt;1&gt;.pdf'), iOp = h.indexOf('Dokumenti gradilišta (');
    if (iS < 0 || iOp < 0 || iS > iOp) throw new Error('dokument uz svesku nije pod sveskom / pre opstih: ' + iS + ' ' + iOp);
    if (h.slice(iOp).includes('sveska &lt;1&gt;.pdf')) throw new Error('dokument uz svesku i u opstim dokumentima');
    if (a.run(`dodajDokument({gr:${JSON.stringify(gid)}, predmer_id:'pm-nepostojeci', naziv:'x.pdf', data:'data:,'}).predmer_id`) !== null) throw new Error('predmer_id tudjeg/nepostojeceg reda nije ocisceno');
    // brisanje sveske (super) gasi vezu dokumenta (=null, ne delete)
    a.run("setRole('all')");
    await a.run(`obrisiPredmerRed(${JSON.stringify(tudja.id)})`);
    const dd = a.run(`DATA.dokumenti.find(x=>x.id===${JSON.stringify(d.id)})`);
    if (!dd || dd.predmer_id !== null || !('predmer_id' in dd)) throw new Error('posle brisanja sveske: ' + JSON.stringify(dd));
    // Izvodjenje: fioka i dalje ima tim, nema sekcije svezaka
    const giz = a.run("DATA.gradilista.find(g=>!jePro(g)).id");
    a.run(`openSite(${JSON.stringify(giz)})`); h = dr();
    if (!h.includes('Tim na gradilištu') || h.includes('Dokumentacija po osobi')) throw new Error('fioka Izvodjenja promenjena');
    a.run('closeDrawer()');
    if (a.run('FIOKA_GR') !== null) throw new Error('FIOKA_GR nije ociscen');
  });

  /* ---- T49 trebovanje iz ugovorenog predmera: dropdown pozicija, kolicina slobodna, predmer_id/sifra na stavci ---- */
  section('T49 trebovanje iz predmera');
  await acheck('formNarudzba: nar_pm nudi predmer Izvodjenja (ne Projektovanja), dodaj iz predmera → readonly naziv + ugovorena kol kao polazna, saveNarudzba cuva predmer_id/sifra/naziv/JM iz DATA i slobodnu kolicinu; mejl i kartica nose sifru; promena gradilista menja listu', async () => {
    const a = await boot();
    const doc = a.g.document;
    a.run("DATA.predmer.push({id:'pm49', gr:'g1', sifra:'4.0.1', poz:esc('Kabl N2XH 3x2,5 <test>'), jm:'kompl', kol:120, cena:50, izv:0});");
    a.run("setRole('z1'); formNarudzba();");
    doc.getElementById('f_ngr').value = 'g1';   // u browseru select vec ima prvu opciju; stub nema
    const m = () => doc.getElementById('nar_pm_box').innerHTML;   // stub: innerHTML deteta se ne vidi u #modal, insertAdjacentHTML je no-op
    if (!doc.getElementById('modal').innerHTML.includes('id="nar_pm_box"') || !m().includes('id="nar_pm"') || !m().includes('value="pm49"') || !m().includes('ugovoreno 120')) throw new Error('nema dropdown-a predmera za g1: ' + m().slice(0, 300));
    if (a.run("predmerZa('g1').length") !== m().split('<option value="pm').length - 1) throw new Error('broj opcija != predmer g1');
    // dodaj iz predmera: red 2 zakljucan, kol = ugovorena, JM iz predmera (kompl nije u standardnoj listi)
    doc.getElementById('nar_pm').value = 'pm49';
    a.run('dodajIzPredmeraTrebovanje()');
    if (a.run('NAR_PM[2]') !== 'pm49') throw new Error('NAR_PM nije upisan: ' + JSON.stringify(a.run('NAR_PM')));
    const box = a.run("stavkaRed(2, predmerZa('g1').find(x=>x.id==='pm49'))");
    if (!box.includes('id="st_n_2"') || !box.includes('readonly') || !box.includes('value="120"') || !box.includes('<option selected>kompl</option>') || !box.includes('4.0.1 · Kabl')) throw new Error('red iz predmera: ' + box);
    if (a.run('stavkaRed(1)').includes('readonly')) throw new Error('slobodan red je readonly');
    // kolicina razlicita od ugovorene + slobodan red 3
    doc.getElementById('st_k_2').value = '150';
    a.run('addStavka()');
    doc.getElementById('st_n_3').value = 'Slobodni materijal'; doc.getElementById('st_k_3').value = '7'; doc.getElementById('st_j_3').value = 'kg';
    const pre = a.run('DATA.narudzbe.length');
    a.run('saveNarudzba()');
    if (a.run('DATA.narudzbe.length') !== pre + 1) throw new Error('trebovanje nije sacuvano');
    const n = a.run('DATA.narudzbe[DATA.narudzbe.length-1]');
    if (n.gr !== 'g1' || n.autor !== 'z1' || n.stavke.length !== 2) throw new Error('narudzba: ' + JSON.stringify(n));
    const s1 = n.stavke[0], s3 = n.stavke[1];
    if (s1.predmer_id !== 'pm49' || s1.sifra !== '4.0.1' || s1.jm !== 'kompl' || s1.kolicina !== '150' || s1.naziv !== 'Kabl N2XH 3x2,5 &lt;test&gt;') throw new Error('stavka iz predmera: ' + JSON.stringify(s1));
    if (s3.predmer_id || s3.naziv !== 'Slobodni materijal' || s3.kolicina !== '7' || s3.jm !== 'kg') throw new Error('slobodna stavka: ' + JSON.stringify(s3));
    if (Object.keys(a.run('NAR_PM')).length) throw new Error('NAR_PM nije resetovan');
    const telo = a.run(`narudzbaMailBody(${JSON.stringify(n)})`);
    if (!telo.includes('4.0.1 · Kabl N2XH 3x2,5 <test> — 150 kompl (iz ugovorenog predmera)')) throw new Error('mejl: ' + telo);
    a.run("current='nabavka'; render();");
    const v = doc.getElementById('view').innerHTML;
    if (!v.includes('4.0.1') || !v.includes('>predmer</span>') || !v.includes('150 kompl') || v.includes('<test>') || !v.includes('&lt;test&gt;')) throw new Error('kartica trebovanja: ' + v.slice(0, 400));
    // rukovodilac sa projektantskim gradilistem: nema dropdown-a; promena gradilista osvezava listu
    a.run("setRole('all'); formNarudzba();");
    doc.getElementById('f_ngr').value = 'g8'; a.run('osveziNarPredmer()');
    if (doc.getElementById('nar_pm_box').innerHTML !== '') throw new Error('projektantsko gradiliste nudi predmer za trebovanje');
    doc.getElementById('f_ngr').value = 'g1'; a.run('osveziNarPredmer()'); doc.getElementById('nar_pm').value = 'pm49'; a.run('dodajIzPredmeraTrebovanje()');
    if (a.run('NAR_PM[2]') !== 'pm49') throw new Error('priprema za promenu gradilista');
    doc.getElementById('f_ngr').value = 'g5'; a.run('osveziNarPredmer()');
    if (!doc.getElementById('nar_pm_box').innerHTML.includes('value="pm1"') || doc.getElementById('nar_pm_box').innerHTML.includes('pm49')) throw new Error('promena gradilista ne menja listu');
    if (Object.keys(a.run('NAR_PM')).length) throw new Error('promena gradilista nije ispraznila redove iz predmera starog gradilista');
    // tudje gradiliste: dodajIzPredmeraTrebovanje odbija
    a.run("setRole('z1');");
    doc.getElementById('f_ngr').value = 'g5'; doc.getElementById('nar_pm').value = 'pm1';
    a.run('dodajIzPredmeraTrebovanje()');
    if (a.run("Object.values(NAR_PM).includes('pm1')") !== false) throw new Error('rukovodilac dodao predmer tudjeg gradilista');
    a.run("setRole('all'); closeModal();");
  });

  section('T48 xlsx pisac');
  await acheck('napraviXlsx → citajXlsx roundtrip: brojevi, tekst sa &<>", prazne celije, dva lista; izvozPredmer = sablon situacije; rukovodilac bez cena', async () => {
    const a = await boot();
    const u = a.run(`napraviXlsx([{ime:'Prvi', redovi:[['Br.','Opis','JM',null,'Kol.'],['4.1','Beton & čelik <C25> "x"','m³','',12.5],[],['', 'poslednji', 'kom', null, 0]]},{ime:'Drugi/List',redovi:[['a',1]]}])`);
    const bytes = Uint8Array.from(Object.values(u)); a.g.__xb = bytes.buffer;
    const r1 = await a.run('citajXlsx(__xb)');   // prvi list
    if (r1.length !== 3 || r1[1][1] !== 'Beton & čelik <C25> "x"' || r1[1][4] !== 12.5 || r1[1][2] !== 'm³' || r1[2][1] !== 'poslednji' || r1[2][4] !== 0) throw new Error('roundtrip prvi list: ' + JSON.stringify(r1));
    const r2 = await a.run('citajXlsx(__xb, true)');
    if (r2.length !== 4 || r2[3][0] !== 'a' || r2[3][1] !== 1) throw new Error('svi listovi: ' + JSON.stringify(r2));
    // ZIP: EOCD na kraju, broj stavki = 5 (Content_Types, .rels, workbook, rels, styles) + 2 lista
    const dv = new DataView(bytes.buffer); const e = bytes.length - 22;
    if (dv.getUint32(e, true) !== 0x06054b50 || dv.getUint16(e + 10, true) !== 7) throw new Error('ZIP EOCD / broj stavki: ' + dv.getUint16(e + 10, true));
    // izvozPredmer: zaglavlje sablona + ukupno za upravu; rukovodilac bez cena
    const gid = a.run("DATA.predmer[0].gr");
    a.run(`ROLE='all'; __ex=izvozPredmer(${JSON.stringify(gid)});`);
    const link = a.g.document._created.filter(c => c.tagName === 'A' && String(c.href).includes('spreadsheetml')).pop();
    a.g.__xb2 = Uint8Array.from(Buffer.from(String(link.href).split(',')[1], 'base64')).buffer;
    const ex = await a.run('citajXlsx(__xb2)');
    const hdr = ex.find(r => r[0] === 'Br. poz.');
    if (!hdr || hdr.length !== 9 || !ex.some(r => r[1] === 'UKUPNO bez PDV' && typeof r[5] === 'number' && r[5] > 0)) throw new Error('izvoz: zaglavlje/ukupno: ' + JSON.stringify(hdr));
    const preL = a.g.document._created.filter(c => c.tagName === 'A').length;
    a.run(`setRole(${JSON.stringify(a.run("grById[DATA.predmer[0].gr].rukovodilac"))}); izvozPredmer(${JSON.stringify(gid)});`);
    if (a.g.document._created.filter(c => c.tagName === 'A').length !== preL) throw new Error('rukovodilac je izvezao predmer (izvoz je samo za upravu)');
    a.run("setRole('all')");
  });

  /* ---- T47 predmer iz investitorskog sablona (novo gradiliste + uvoz na postojece) ---- */
  section('T47 predmer iz sablona');
  await acheck('upariPredmerSablon: svi listovi, prazan opis → prethodni, bez cene preskoci, tekst-brojevi, kol uskladjena sa ukupnim, dedupe; formSite + savePredmerImport primenjuju', async () => {
    const a = await boot();
    const buf = fs.readFileSync(path.join(ROOT, 'test', 'fixtures', 'predmer-sablon.xlsx'));
    a.g.__buf = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    const redovi = await a.run('citajXlsx(__buf, true)');
    const rez = a.run(`upariPredmerSablon(${JSON.stringify(redovi)})`);
    const by = Object.fromEntries(rez.redovi.map(r => [r.poz, r]));
    if (rez.redovi.length !== 5) throw new Error('ocekujem 5 pozicija: ' + JSON.stringify(rez.redovi.map(r => r.sifra + ' ' + r.poz)));
    const dem = by['Demontaža u objektima od 500m² do 1000m²'];   // fajl je ćiriličan, citajXlsx ga transliteruje
    if (!dem || dem.sifra !== '4.0.1' || dem.cena !== 350000 || dem.jm !== 'kompl') throw new Error('demontaza: ' + JSON.stringify(dem));
    const p20 = by['Jednopolni automatski prekidač 20A'];
    if (!p20 || p20.kol !== 1830 || p20.cena !== 810) throw new Error('tekst-brojevi: ' + JSON.stringify(p20));
    const kam = by['Bullet IP kamera 4 MP'];
    if (!kam || kam.kol !== 3 || kam.sifra !== '3D') throw new Error('prazan opis: ' + JSON.stringify(kam));
    const rad = by['Panel radijator K22 600x2000'];
    if (!rad || Math.abs(rad.kol - 0.6667) > 0.001 || rez.uskladjeno !== 1) throw new Error('uskladjivanje: ' + JSON.stringify(rad) + ' uskl ' + rez.uskladjeno);
    if (rez.redovi.some(r => /VIDEO NADZOR|REKAPITULACIJA|UKUPNO|[\u0400-\u04FF]/.test(r.poz))) throw new Error('zbirni/recap red kao pozicija');
    // novo gradiliste: priprema → saveSite dodaje pozicije
    a.run("ROLE='all'; formSite();");
    const doc = a.g.document;
    if (!doc.getElementById('modal').innerHTML.includes('id="pm_fajl"')) throw new Error('formSite nema upload predmera');
    a.run(`prikaziPredmerPripremu(${JSON.stringify(rez)}, 'pm_pregled')`);
    if (!doc.getElementById('pm_pregled').innerHTML.includes('5</b> pozicija') || !a.run('PREDMER_PRIPREMA')) throw new Error('pregled/priprema');
    const set = (id, v) => { doc.getElementById(id).value = v; };
    set('f_naziv', 'T47 skola'); set('f_modul', 'izvodjenje'); set('f_tip', 'visokogradnja'); set('f_kli', a.run('DATA.clijenti[0].id')); set('f_ruk', 'z1');
    set('f_poc', a.run('todayStr()')); set('f_rok', a.run('plusDays(120)')); set('f_cena', '1000'); set('f_tro', '800');
    a.run('saveSite()');
    const gid = a.run('DATA.gradilista[DATA.gradilista.length-1].id');
    const pm = a.run(`predmerZa(${JSON.stringify(gid)})`);
    if (pm.length !== 5 || !pm.every(x => x.cena > 0) || !pm.some(x => x.sifra === '4.0.1') || pm.some(x => x.poz.includes('<'))) throw new Error('predmer novog gradilista: ' + JSON.stringify(pm.map(x => [x.sifra, x.kol, x.cena])));
    if (a.run('PREDMER_PRIPREMA') !== null) throw new Error('priprema nije potrosena');
    // uvoz na postojece: isti fajl → 0 novih (dedupe), + jedan nalepljen red
    a.run(`formPredmerImport(${JSON.stringify(gid)})`);
    if (!doc.getElementById('modal').innerHTML.includes('id="pm_fajl2"')) throw new Error('uvoz nema upload');
    a.run(`prikaziPredmerPripremu(${JSON.stringify(rez)}, 'pm_pregled2')`);
    doc.getElementById('f_pm_paste').value = 'Nova nalepljena\tkom\t2\t50';
    a.run(`savePredmerImport(${JSON.stringify(gid)})`);
    if (a.run(`predmerZa(${JSON.stringify(gid)}).length`) !== 6) throw new Error('dedupe/nalepljeno: ' + a.run(`predmerZa(${JSON.stringify(gid)}).length`));
    a.run("setRole('z1')");
    a.run(`prikaziPredmerPripremu(${JSON.stringify(rez)}, 'pm_pregled2'); dodajPredmerIzPripreme(${JSON.stringify(gid)})`);
    if (a.run(`predmerZa(${JSON.stringify(gid)}).length`) !== 6) throw new Error('rukovodilac dodao predmer iz fajla');
    a.run("setRole('all')");
    // pravi investitorski predmer (ako postoji lokalno): 87 pozicija, 20.935.367 RSD
    const pf = 'C:/Users/jovan/AppData/Local/Temp/claude/C--gradnjaos/b2cb9afe-8121-4031-9026-1be809ea2dca/scratchpad/dr/predmer.xlsx';
    if (fs.existsSync(pf)) {
      const b2 = fs.readFileSync(pf); a.g.__buf2 = b2.buffer.slice(b2.byteOffset, b2.byteOffset + b2.byteLength);
      const red2 = await a.run('citajXlsx(__buf2, true)');
      const r2 = a.run(`upariPredmerSablon(${JSON.stringify(red2)})`);
      const uk = Math.round(r2.redovi.reduce((x, r) => x + r.kol * r.cena, 0));
      if (r2.redovi.length !== 87 || uk !== 20935367) throw new Error('pravi predmer: ' + r2.redovi.length + ' pozicija, ukupno ' + uk + ' (ocekujem 87 / 20935367), uskladjeno ' + r2.uskladjeno);
      console.log('      (pravi predmer OŠ: ' + r2.redovi.length + ' pozicija, ' + uk + ' RSD, uskladjeno ' + r2.uskladjeno + ')');
    }
  });

  /* ---- T46 situacija iz Excela (format investitorske PPS / okoncane situacije) ---- */
  section('T46 situacija iz Excela');
  await acheck('citajXlsx(sve listove) + upariSituaciju: kumulativ − do sada, prazan opis → prethodni, srpski broj, nepoznato preskoceno, list bez kumulativa ignorisan; popuni formu', async () => {
    const a = await boot();
    const buf = fs.readFileSync(path.join(ROOT, 'test', 'fixtures', 'situacija.xlsx'));
    a.g.__buf = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    const redovi = await a.run('citajXlsx(__buf, true)');
    if (redovi.length < 10) throw new Error('nisu procitani svi listovi: ' + redovi.length);
    a.run("ROLE='all';");
    const rez = a.run(`upariSituaciju('g5', ${JSON.stringify(redovi)})`);
    const by = Object.fromEntries(rez.spojeni.map(s => [s.x.id, s]));
    if (!by.pm1 || by.pm1.kum !== 150 || by.pm1.doSada !== 190 || by.pm1.ova !== 0) throw new Error('pm1: ' + JSON.stringify(by.pm1));   // st1+st3 = 190 do sada
    if (!by.pm3 || by.pm3.kum !== 300 || by.pm3.doSada !== 260 || by.pm3.ova !== 40) throw new Error('pm3 (prazan opis → prethodni): ' + JSON.stringify(by.pm3));
    if (!by.pm4 || by.pm4.kum !== 1830.5 || by.pm4.ova !== 1830.5) throw new Error('pm4 (srpski broj): ' + JSON.stringify(by.pm4));
    if (by.pm5) throw new Error('list bez kumulativne kolone ne sme da daje stavke');
    if (rez.nepovezani.length !== 1 || !/Nepostoje/.test(rez.nepovezani[0])) throw new Error('nepovezani: ' + JSON.stringify(rez.nepovezani));
    a.run("formSituacija('g5')");
    const n = a.run(`popuniSituacijuIzRedova('g5', ${JSON.stringify(rez)})`);
    const doc = a.g.document;
    if (n !== 2 || doc.getElementById('st_k_pm3').value !== '40' || doc.getElementById('st_k_pm1').value !== '' || doc.getElementById('st_k_pm4').value !== '1830.5') throw new Error('forma nije popunjena: ' + n);
    if (!doc.getElementById('st_pregled').innerHTML.includes('1 kumulativno preko ugovorene')) throw new Error('pregled ne upozorava na prekoracenje');
    if (!doc.getElementById('modal').innerHTML.includes('id="st_fajl"')) throw new Error('forma nema dugme za Excel');
    a.run("saveSituacija('g5')");   // bez broja → odbija; sa brojem → stavke 40 i 1830.5
    doc.getElementById('f_sbr').value = 'PS-T46'; a.run("formSituacija('g5')"); doc.getElementById('f_sbr').value = 'PS-T46';
    a.run(`popuniSituacijuIzRedova('g5', ${JSON.stringify(rez)}); saveSituacija('g5');`);
    const st = a.run("stavkeZa(DATA.situacije.find(x=>x.br==='PS-T46').id)");
    if (st.length !== 2 || !st.some(x => x.predmer_id === 'pm3' && x.kol === 40 && x.razlika === 0) || !st.some(x => x.predmer_id === 'pm4' && x.razlika === 1600.5)) throw new Error('stavke: ' + JSON.stringify(st));
    // prava investitorska PPS (ako postoji lokalno): vecina pozicija OŠ Dušan Radović mora da se prepozna
    const pps = 'C:/Users/jovan/AppData/Local/Temp/claude/C--gradnjaos/b2cb9afe-8121-4031-9026-1be809ea2dca/scratchpad/dr/pps.xlsx';
    const pj = 'C:/Users/jovan/AppData/Local/Temp/claude/C--gradnjaos/b2cb9afe-8121-4031-9026-1be809ea2dca/scratchpad/dr/predmer.json';
    if (fs.existsSync(pps) && fs.existsSync(pj)) {
      const pred = JSON.parse(fs.readFileSync(pj, 'utf8'));
      a.run(`DATA.gradilista.push({id:'g-osdr',naziv:'OŠ',modul:'izvodjenje',tip:'visokogradnja',lok:'NS',klijent:'c1',rukovodilac:'z1',pocetak:'2026-09-01',rok:'2027-03-31',napredak:0,status:'u toku',faza:'x',budzet:1,troskovi:1,potroseno:0,naplaceno:0,adm:{}}); rebuildMaps(); ${JSON.stringify(pred)}.forEach(r=>DATA.predmer.push(r));`);
      const b2 = fs.readFileSync(pps); a.g.__buf2 = b2.buffer.slice(b2.byteOffset, b2.byteOffset + b2.byteLength);
      const r2 = a.run(`upariSituaciju('g-osdr', null)`); // sanity: null redovi
      const red2 = await a.run('citajXlsx(__buf2, true)');
      const rz = a.run(`upariSituaciju('g-osdr', ${JSON.stringify(red2)})`);
      // PPS nema list Masinske instalacije (20 pozicija) → ocekujemo svih 67 ostalih, bez ijednog nepovezanog
      if (rz.spojeni.length !== 67 || rz.nepovezani.length !== 0) throw new Error('prava PPS: prepoznato ' + rz.spojeni.length + ' (ocekujem 67 — bez masinskih), nepovezano ' + rz.nepovezani.length + ': ' + rz.nepovezani.slice(0, 5).join(' | '));
      console.log('      (prava PPS: ' + rz.spojeni.length + '/87 prepoznato, ' + rz.spojeni.filter(x => x.ova > 0).length + ' sa kolicinom, nepovezano ' + rz.nepovezani.length + ')');
      const ok = pps.replace('pps.xlsx', 'okoncana.xlsx');
      if (fs.existsSync(ok)) {   // okoncana: + kolone „izvedeno u prethodnim" / „u ovoj situaciji" — kumulativ ostaje merodavan
        const b3 = fs.readFileSync(ok); a.g.__buf3 = b3.buffer.slice(b3.byteOffset, b3.byteOffset + b3.byteLength);
        const red3 = await a.run('citajXlsx(__buf3, true)');
        const rz3 = a.run(`upariSituaciju('g-osdr', ${JSON.stringify(red3)})`);
        if (rz3.spojeni.length !== 67 || rz3.nepovezani.length !== 0) throw new Error('okoncana: prepoznato ' + rz3.spojeni.length + ', nepovezano ' + rz3.nepovezani.length + ': ' + rz3.nepovezani.slice(0, 5).join(' | '));
        const kab = rz3.spojeni.find(x => /N2XH-J 3x1\.5/.test(x.x.poz));
        if (!kab || kab.kum !== 1905 || kab.kum <= kab.x.kol) throw new Error('okoncana kabl 3x1.5: ' + JSON.stringify(kab && { kum: kab.kum, kol: kab.x.kol }));
        console.log('      (prava okoncana: ' + rz3.spojeni.length + ' prepoznato, ' + rz3.spojeni.filter(x => x.kum > (+x.x.kol || 0)).length + ' preko ugovorene kolicine)');
      }
    }
  });

  /* ---- T45 siroki modal + pamcenje sirine ---- */
  section('T45 siroki modal');
  await acheck('formSite/formIzSifarnika/formSituacija otvaraju .siroka modal, formTask ne; sirina se pamti po kljucu samo >900px', async () => {
    const a = await boot();
    const m = a.g.document.getElementById('modal');
    a.run("ROLE='all'; formSite();");
    if (!m.classList.contains('siroka')) throw new Error('formSite nije siroka');
    a.run("formTask()");
    if (m.classList.contains('siroka')) throw new Error('formTask je ostala siroka (klasa se ne skida)');
    a.run("formIzSifarnika('g1')"); if (!m.classList.contains('siroka')) throw new Error('formIzSifarnika nije siroka');
    a.run("formSituacija('g5')"); if (!m.classList.contains('siroka') || a.run('MODAL_KLJUC') !== 'situacija') throw new Error('formSituacija nije siroka / kljuc');
    a.run("formSite('g1')"); if (m.classList.contains('siroka')) throw new Error('izmena gradilista ne treba da bude siroka');
    // pamcenje: na 1200px sirina se primeni iz localStorage; na 375px ne
    a.run("var _ls={}; localStorage={getItem:k=>(k in _ls?_ls[k]:null), setItem:(k,v)=>{_ls[k]=String(v)}, removeItem:k=>{delete _ls[k]}};");   // stub nema localStorage (kao T27)
    a.run("localStorage.setItem('gos_modal_w_gradiliste','900'); window.innerWidth=1200; formSite();");
    if (a.run("document.getElementById('modal').style.width") !== '900px') throw new Error('zapamcena sirina nije primenjena: ' + a.run("document.getElementById('modal').style.width"));
    a.run("window.innerWidth=375; formSite();");
    if (a.run("document.getElementById('modal').style.width") !== '') throw new Error('na telefonu ne sme da se primeni sirina');
    const css = HTML.slice(0, HTML.indexOf('</style>'));
    if (!/@media\(min-width:901px\)\{ \.modal\{resize:horizontal/.test(css) || !css.includes('.modal.siroka{width:min(1040px, 100%)}')) throw new Error('CSS: resize / siroka');
  });

  /* ---- T44 Projektovanje: sveske = zadaci (migracija 20) ---- */
  section('T44 sveske = zadaci');
  await acheck('sinhronizujSveske: svaka stavka specifikacije ima zadatak (predmer_id, zaduzen), naziv/zaduzen se prate, obrisana sveska nosi zadatak; demo je vec usklaen', async () => {
    const a = await boot();
    a.run("ROLE='all'; MODUL='sve';");
    if (a.run('sinhronizujSveskeSve()') !== 0) throw new Error('demo nije uskladjen (sync je napravio zadatke)');
    const pm = a.run("predmerZa('g8')"), tz = a.run("DATA.zadaci.filter(t=>t.gr==='g8'&&t.predmer_id)");
    if (pm.length !== 5 || tz.length !== 5 || !pm.every(p => tz.some(t => t.predmer_id === p.id && t.naziv === p.poz && t.zad === p.zaduzen))) throw new Error('g8 sveske/zadaci: ' + pm.length + '/' + tz.length);
    if (a.run("DATA.zadaci.find(t=>t.predmer_id==='pm6').kol") !== 'done') throw new Error('predata sveska (izv=kol) nije done');
    // nova sveska kroz formu (direktor) → zadatak
    a.run("formPredmerRed('g8')");   // 2026-10-14: sveska = faza + cek-lista (bez slobodnog naziva, JM, kolicine)
    const doc = a.g.document; doc.getElementById('f_sv_faza').value = a.run("grById.g8.nivo"); a.run("osveziSveskeCeklistu('g8')");
    Object.keys(a.run('SV_KAND')).forEach(k => { doc.getElementById('f_sv_' + k).checked = +k === 0; }); doc.getElementById('f_pm_zad').value = 'z4';
    a.run("savePredmerRed('g8')");
    const np = a.run("DATA.predmer[DATA.predmer.length-1]"), nt = a.run(`DATA.zadaci.find(t=>t.predmer_id===${JSON.stringify(a.run("DATA.predmer[DATA.predmer.length-1].id"))})`);
    if (!nt || nt.zad !== 'z4' || nt.naziv !== np.poz || nt.kol !== 'todo' || nt.naziv.includes('<b>')) throw new Error('zadatak sveske: ' + JSON.stringify(nt));
    // promena zaduzenog → zadatak prati
    a.run(`formPredmerRed('g8',${JSON.stringify(np.id)})`); doc.getElementById('f_pm_zad').value = 'z17';
    a.run(`savePredmerRed('g8',${JSON.stringify(np.id)})`);
    if (a.run(`DATA.zadaci.find(t=>t.predmer_id===${JSON.stringify(np.id)}).zad`) !== 'z17') throw new Error('zaduzen nije prenet na zadatak');
    // zadatak u done → sveska izvedena (izv=kol), nazad → 0
    a.run(`dragId=${JSON.stringify(nt.id)}; dropTask({preventDefault(){}}, 'done');`);
    if (a.run(`DATA.predmer.find(p=>p.id===${JSON.stringify(np.id)}).izv`) !== 1) throw new Error('done nije upisao izv');
    a.run(`dragId=${JSON.stringify(nt.id)}; dropTask({preventDefault(){}}, 'inprogress');`);
    if (a.run(`DATA.predmer.find(p=>p.id===${JSON.stringify(np.id)}).izv`) !== 0) throw new Error('povratak iz done nije vratio izv na 0');
    // brisanje sveske nosi zadatak
    a.g._calls.confirm.length = 0;
    await a.run(`obrisiPredmerRed(${JSON.stringify(np.id)})`);
    if (a.run(`DATA.zadaci.some(t=>t.predmer_id===${JSON.stringify(np.id)})`)) throw new Error('zadatak ostao posle brisanja sveske');
    // rukovodilac projektovanja dodaje svesku (bez cene); rukovodilac izvodjenja ne moze
    const rukPro = a.run("grById['g8'].rukovodilac");
    a.run(`setRole(${JSON.stringify(rukPro + '|pro')}); formPredmerRed('g8');`);
    const h = doc.getElementById('modal').innerHTML;
    if (!h.includes('f_sv_faza') || h.includes('f_pm_cena') || h.includes('f_pm_jm') || h.includes('f_pm_kol')) throw new Error('rukovodilac: forma sveske nema fazu ili nudi cenu/JM/kolicinu');
    doc.getElementById('f_sv_faza').value = a.run("grById.g8.nivo"); a.run("osveziSveskeCeklistu('g8')");
    Object.keys(a.run('SV_KAND')).forEach(k => { doc.getElementById('f_sv_' + k).checked = +k === 0; }); doc.getElementById('f_pm_zad').value = 'z4';
    const pre = a.run('DATA.zadaci.length'); a.run("savePredmerRed('g8')");
    const npR = a.run("DATA.predmer[DATA.predmer.length-1]");
    if (a.run('DATA.zadaci.length') !== pre + 1 || npR.gr !== 'g8' || npR.kol !== 1 || !a.run(`DATA.zadaci.some(t=>t.predmer_id===${JSON.stringify(npR.id)}&&t.zad==='z4'&&t.naziv===${JSON.stringify(npR.poz)})`)) throw new Error('rukovodilac nije dodao svesku kao zadatak');
    a.run("current='predmer'; PRED_ID='g8'; render();");
    if (!doc.getElementById('view').innerHTML.includes("formPredmerRed('g8')")) throw new Error('rukovodilac nema dugme + Dodaj svesku');
    doc.getElementById('modal').innerHTML = '';   // stub ne brise modal sam
    a.run("setRole('z1'); formPredmerRed('g1');");
    if (/f_pm_poz|f_sv_faza/.test(doc.getElementById('modal').innerHTML)) throw new Error('rukovodilac izvodjenja otvorio formu predmera');
    a.run("setRole('all')");
  });
  await acheck('radnik: zadatak sveske done ne dira predmer lokalno (server trigger), start/pauza/zavrsi rade na sveski', async () => {
    const a = await boot();
    const t = a.run("DATA.zadaci.find(x=>x.predmer_id==='pm9')");
    a.run(`setRole('radnik:${t.zad}|pro'); current='tasks'; render();`);
    if (!a.g.document.getElementById('view').innerHTML.includes(`pocniZadatak('${t.id}')`)) throw new Error('radnik ne vidi svoju svesku kao zadatak');
    a.run(`pocniZadatak(${JSON.stringify(t.id)}); pauzirajZadatak(${JSON.stringify(t.id)}); zavrsiZadatak(${JSON.stringify(t.id)});`);
    if (a.run(`DATA.zadaci.find(x=>x.id===${JSON.stringify(t.id)}).kol`) !== 'done') throw new Error('zavrsi nije done');
    if (a.run("DATA.predmer.find(p=>p.id==='pm9').izv") !== 0) throw new Error('radnik lokalno menjao predmer (server to radi)');
    if (a.run(`DATA.rad_na_zadatku.filter(s=>s.zadatak===${JSON.stringify(t.id)}).length`) !== 1) throw new Error('sesija nije zabelezena');
    a.run("setRole('all')");
  });

  /* ---- T43 situacije sa stavkama + sifarnik artikala (migracija 19) ---- */
  section('T43 situacije sa stavkama');
  await acheck('ceklista: izabrani artikal → predmer red sa cenom i sifrom; dedupe po sifri; cena samo uz finansije', async () => {
    const a = await boot();
    a.run("ROLE='all'; formSite();");
    const doc = a.g.document, html = doc.getElementById('modal').innerHTML;
    const k = a.run("sifrarnikZa('izvodjenje').findIndex(s=>s.sifra==='M029')"); if (k < 0) throw new Error('M029 nije u listi');
    if (!html.includes(`id="f_sfc_${k}"`) || !html.includes('data-sifra="M029"')) throw new Error('red artikla bez cene/sifre');
    doc.getElementById('f_sf_' + k).checked = true; doc.getElementById('f_sfk_' + k).value = '12'; doc.getElementById('f_sfc_' + k).value = '85.5';
    const set = (id, v) => { doc.getElementById(id).value = v; };
    set('f_naziv', 'T43 rasveta'); set('f_modul', 'izvodjenje'); set('f_tip', 'visokogradnja'); set('f_kli', a.run('DATA.clijenti[0].id')); set('f_ruk', 'z1');
    set('f_poc', a.run('todayStr()')); set('f_rok', a.run('plusDays(90)')); set('f_cena', '100000'); set('f_tro', '80000');
    a.run('saveSite()');
    const gid = a.run('DATA.gradilista[DATA.gradilista.length-1].id');
    const r = a.run(`predmerZa(${JSON.stringify(gid)}).find(x=>x.sifra==='M029')`);
    if (!r || r.kol !== 12 || r.cena !== 85.5 || !/RC132V/.test(r.poz)) throw new Error('predmer red: ' + JSON.stringify(r));
    a.run(`formIzSifarnika(${JSON.stringify(gid)})`);
    doc.getElementById('f_sf_' + k).checked = true; doc.getElementById('f_sfk_' + k).value = '3';
    a.run(`saveIzSifarnika(${JSON.stringify(gid)})`);
    if (a.run(`predmerZa(${JSON.stringify(gid)}).filter(x=>x.sifra==='M029').length`) !== 1) throw new Error('dedupe po sifri ne radi');
    a.run("setRole('z1'); formSite();");   // rukovodilac ne otvara formu; ali ceklista bez finansija nema polje cene
    if (a.run("sifrarnikChecklist('izvodjenje')").includes('f_sfc_')) throw new Error('cena ponudjena bez finansija');
    a.run("setRole('all')");
  });
  await acheck('Razno u Izvodjenju: slobodna stavka (naziv, JM, kolicina, cena, zaduzen) → predmer red bez sifre; i kroz formIzSifarnika; Projektovanje bez sifarnika u situaciji', async () => {
    const a = await boot();
    a.run("ROLE='all'; formSite(); document.getElementById('f_modul').value='izvodjenje'; toggleTipRadova('izvodjenje'); RAZNO_MODUL='izvodjenje'; dodajRaznoRed(); dodajRaznoRed();");
    const doc = a.g.document, set = (id, v) => { doc.getElementById(id).value = v; };
    if (a.run('RAZNO_N') !== 2) throw new Error('RAZNO_N ' + a.run('RAZNO_N'));
    set('f_nr_0', ' Usluga montaže <i>x</i> '); set('f_nrj_0', 'h'); set('f_nrk_0', '12'); set('f_nrc_0', '45'); set('f_nrz_0', 'z2');
    set('f_nr_1', '');
    set('f_naziv', 'T43 razno'); set('f_modul', 'izvodjenje'); set('f_tip', 'visokogradnja'); set('f_kli', a.run('DATA.clijenti[0].id')); set('f_ruk', 'z1');
    set('f_poc', a.run('todayStr()')); set('f_rok', a.run('plusDays(90)')); set('f_cena', '1000'); set('f_tro', '800');
    a.run('saveSite()');
    const gid = a.run('DATA.gradilista[DATA.gradilista.length-1].id');
    const rows = a.run(`predmerZa(${JSON.stringify(gid)})`);
    if (rows.length !== 1 || rows[0].jm !== 'h' || rows[0].kol !== 12 || rows[0].cena !== 45 || rows[0].zaduzen !== 'z2' || rows[0].sifra !== null || rows[0].poz.includes('<i>') || !rows[0].poz.includes('&lt;i&gt;')) throw new Error('razno red: ' + JSON.stringify(rows));
    a.run(`formIzSifarnika(${JSON.stringify(gid)}); dodajRaznoRed();`);
    set('f_nr_0', 'Dodatna usluga'); set('f_nrk_0', '3');
    a.run(`saveIzSifarnika(${JSON.stringify(gid)})`);
    if (a.run(`predmerZa(${JSON.stringify(gid)}).length`) !== 2 || !a.run(`predmerZa(${JSON.stringify(gid)}).some(r=>r.poz==='Dodatna usluga'&&r.kol===3)`)) throw new Error('razno kroz formIzSifarnika');
    a.run("formSituacija('g8')");
    if (doc.getElementById('modal').innerHTML.includes('id="st_sf"')) throw new Error('Projektovanje nudi sifarnik u situaciji');
    a.run('closeModal()');
  });
  await acheck('rukovodilac BEZ finansija: formSituacija → stavke, iznos null, razlika za stavku van predmera; nijedan pogled bez NaN', async () => {
    const s0 = await boot({ supabase: true, seed: {} });   // direktor zaseje demo; Petar (u-ruk, bez finansija) radi nad tim seed-om
    const seed = JSON.parse(JSON.stringify(s0.g.__mock._db)); delete seed.log_koriscenja;
    const a = await boot({ supabase: true, seed, session: { user: { id: 'u-ruk', email: 'petar@test' } } });
    if (a.run('canFinance()') || a.run('mode') !== 'supabase') throw new Error('priprema: Petar ima finansije / mode ' + a.run('mode'));
    if (a.run("DATA.situacije.some(s=>s.iznos!=null)")) throw new Error('iznos stigao bez finansija: ' + JSON.stringify(a.run("DATA.situacije.filter(s=>s.iznos!=null).map(s=>s.id)")));
    a.run("formSituacija('g2')"); if (a.g.document.getElementById('modal').innerHTML.includes('f_sbr')) throw new Error('otvorio tudje gradiliste');
    a.run("formSituacija('g1')");
    const doc = a.g.document, html = doc.getElementById('modal').innerHTML;
    if (!html.includes('id="f_svrsta"') || !html.includes('id="st_sf"')) throw new Error('forma nepotpuna');
    doc.getElementById('f_sbr').value = 'PS-T43'; doc.getElementById('f_svrsta').value = 'okoncana'; doc.getElementById('f_sopis').value = 'proba';
    doc.getElementById('st_sf').value = a.run("DATA.sifrarnik.find(s=>s.sifra==='M029').id");
    a.run('dodajStavkuIzSifarnika()'); doc.getElementById('st_xk_0').value = '4';
    const pre = a.g._calls.alert.length;
    a.run("saveSituacija('g1')");
    const s = a.run("DATA.situacije.find(x=>x.br==='PS-T43')");
    if (!s || s.vrsta !== 'okoncana' || s.autor !== 'z1' || s.status !== 'ceka') throw new Error('situacija: ' + JSON.stringify(s));
    const st = a.run(`stavkeZa(${JSON.stringify(s.id)})`);
    if (st.length !== 1 || st[0].sifra !== 'M029' || st[0].kol !== 4 || st[0].kol_ugovoreno !== 0 || st[0].razlika !== 4) throw new Error('stavke: ' + JSON.stringify(st));
    if (!a.g._calls.alert.slice(pre).some(m => /preko ugovorene/.test(m))) throw new Error('rukovodilac nije obavesten o razlici');
    await a.run('doSave()'); for (let i = 0; i < 10; i++) await new Promise(r => setImmediate(r));
    const row = a.g.__mock._db.situacije.find(x => x.br === 'PS-T43'), rows = a.g.__mock._db.situacija_stavke.filter(x => x.sit === s.id);
    if (!row || rows.length !== 1 || rows[0].razlika !== 4) throw new Error('server: ' + JSON.stringify({ row, rows }));
    if (a.g.__mock._log.some(l => l.op === 'upsert' && l.table === 'situacije' && l.cols && !l.cols.includes('iznos') && l.via !== 'update')) throw new Error('insert situacije bez iznos kolone (trigger je postavlja, ali red mora nositi 0)');
    for (const v of ['dash', 'sites', 'time', 'tasks', 'diary']) { a.run(`current=${JSON.stringify(v)}; render();`); if (a.g.document.getElementById('view').innerHTML.includes('NaN')) throw new Error('NaN u pogledu ' + v); }
    a.run("openSite('g1')");
    const dr = a.g.document.getElementById('drawer').innerHTML;
    if (!dr.includes('PS-T43') || !dr.includes("formSituacija('g1')") || !dr.includes('1 preko ugovora')) throw new Error('fioka bez situacije/razlike');
    a.run(`detaljSituacije(${JSON.stringify(s.id)})`);
    const dm = a.g.document.getElementById('modal').innerHTML;
    if (!dm.includes('van predmera') || dm.includes('Ukupno:') || dm.includes('markPaid(')) throw new Error('detalj za rukovodioca bez finansija pokazuje ukupno/placeno');   // jed. cene po stavci sme da vidi (migracija 23)
  });
  await acheck('uprava: kumulativ kroz situacije, razlika preko ugovorenog, iznos iz cena; upozorenje u computeAlerts; viewPay + detalj; brisanje nosi stavke', async () => {
    const a = await boot();
    a.run("ROLE='all'; MODUL='sve'; PODTIP='sve';");
    const st3 = a.run("DATA.situacija_stavke.find(x=>x.id==='st3')");
    if (st3.kumulativ !== 190 || st3.razlika !== 10) throw new Error('demo stavke nisu po formuli: ' + JSON.stringify(st3));
    a.run("preracunajSituacijeLokalno('g5')");
    const s15 = a.run("DATA.situacije.find(x=>x.id==='s15')"), st5 = a.run("DATA.situacija_stavke.find(x=>x.id==='st5')");
    if (s15.iznos !== 11420 || st5.razlika !== 12 || a.run("DATA.situacija_stavke.find(x=>x.id==='st3').kumulativ") !== 190) throw new Error('lokalna formula: ' + JSON.stringify({ s15, st5 }));
    const al = a.run('computeAlerts()').filter(x => /preko ugovorene/.test(x.tekst));
    if (!al.length || al[0].gr !== 'g5' || !/PS-02\/26/.test(al[0].tekst) || !/2 stavki/.test(al[0].tekst)) throw new Error('alert razlike: ' + JSON.stringify(al));
    a.run("setRole('z7')");   // rukovodilac 2 bez finansija: razlika je fin alert — ne vidi je
    if (a.run('computeAlerts()').some(x => /preko ugovorene/.test(x.tekst))) throw new Error('rukovodilac 2 vidi fin alert');
    a.run("setRole('all'); current='pay'; render();");
    const h = a.g.document.getElementById('view').innerHTML;
    if (!h.includes("detaljSituacije('s15')") || !h.includes('2 preko ugovora') || !h.includes('Privremena')) throw new Error('viewPay bez razlike/vrste');
    a.run("detaljSituacije('s15')");
    const dm = a.g.document.getElementById('modal').innerHTML;
    for (const x of ['Jed. cena', 'Ukupno:', 'van predmera', '+10', '+12']) if (!dm.includes(x)) throw new Error('detalj nema ' + x);
    // nova situacija kroz formu: pm1 jos 5 → kumulativ 195, razlika 15; iznos 5*22
    a.run("formSituacija('g5')");
    const doc = a.g.document; doc.getElementById('f_sbr').value = 'PS-T43B'; doc.getElementById('st_k_pm1').value = '5';
    a.run("saveSituacija('g5')");
    const nova = a.run("DATA.situacije.find(x=>x.br==='PS-T43B')"), ns = a.run(`stavkeZa(${JSON.stringify(a.run("DATA.situacije.find(x=>x.br==='PS-T43B').id"))})`);
    if (!nova || nova.iznos !== 110 || nova.autor !== 'direkcija' || ns.length !== 1 || ns[0].kumulativ !== 195 || ns[0].razlika !== 15) throw new Error('nova: ' + JSON.stringify({ nova, ns }));
    // brisanje situacije nosi i stavke
    a.g._calls.confirm.length = 0;
    const before = a.run('DATA.situacija_stavke.length');
    await a.run(`obrisiSituaciju(${JSON.stringify(nova.id)})`);
    if (a.run("DATA.situacije.some(x=>x.br==='PS-T43B')") || a.run('DATA.situacija_stavke.length') !== before - 1) throw new Error('brisanje nije nosilo stavke');
    if (a.run("DATA.situacija_stavke.find(x=>x.id==='st3').kumulativ") !== 190) throw new Error('kumulativ nije preracunat posle brisanja');
    // mock trigger: server strana (seed) daje iste brojeve
    const b = await boot({ supabase: true, seed: {} });
    const srv = b.g.__mock._db.situacija_stavke.find(x => x.id === 'st5');
    if (!srv || srv.razlika !== 12 || b.g.__mock._db.situacije.find(x => x.id === 's15').iznos !== 11420) throw new Error('mock preracun: ' + JSON.stringify(srv));
  });
  await acheck('obrisi_gradiliste cisti i stavke (lokalno + mock); radnik/spoljni/tudj rukovodilac: formSituacija no-op', async () => {
    const a = await boot({ supabase: true, seed: {} });
    a.g._calls.confirm.length = 0;
    await a.run("obrisiGradiliste('g5')"); for (let i = 0; i < 8; i++) await new Promise(r => setImmediate(r));
    if (a.run("DATA.situacija_stavke.some(x=>x.gr==='g5')") || a.g.__mock._db.situacija_stavke.some(x => x.gr === 'g5')) throw new Error('stavke g5 ostale');
    const c = await boot();
    for (const r of ["radnik:z2", "z3"]) { c.run(`setRole(${JSON.stringify(r)}); formSituacija('g1');`); if (c.g.document.getElementById('modal').innerHTML.includes('f_sbr')) throw new Error(r + ' otvorio situaciju na g1'); }
    c.run("setRole('all')");
  });

  /* ---- T42 modul po nalogu (migracija 18) ---- */
  section('T42 modul po nalogu');
  await acheck('rukovodilac/radnik vide samo gradilista svog modula; jedan modul = bez segmenta; MODUL se resetuje', async () => {
    const a = await boot();
    const z1pro = a.run("DATA.gradilista.filter(g=>g.rukovodilac==='z1'&&jePro(g)).length"), z1izv = a.run("DATA.gradilista.filter(g=>g.rukovodilac==='z1'&&!jePro(g)).length");
    if (!z1izv) throw new Error('DEMO: z1 nema gradiliste izvodjenja');
    a.run("MODUL='projektovanje'; primeniUlogu('rukovodilac','z1',false,['izvodjenje']);");
    if (a.run('MODUL') !== 'sve') throw new Error('MODUL nije resetovan na sve');
    if (a.run("visibleSites().some(g=>jePro(g))")) throw new Error('rukovodilac izvodjenja vidi projektovanje');
    if (a.run('visibleSites().length') !== z1izv) throw new Error('broj gradilista: ' + a.run('visibleSites().length') + ' != ' + z1izv);
    if (a.run('modulSeg()') !== '') throw new Error('segment modula prikazan za jedan modul');
    a.run("primeniUlogu('rukovodilac','z1',false,['projektovanje']);");
    if (a.run('visibleSites().length') !== z1pro || a.run("visibleSites().some(g=>!jePro(g))")) throw new Error('rukovodilac projektovanja vidi izvodjenje');
    a.run("primeniUlogu('rukovodilac','z1',false,null);");
    if (a.run('visibleSites().length') !== z1pro + z1izv) throw new Error('bez modula = oba');
    if (!a.run('modulSeg()').includes('Svi moduli')) throw new Error('oba modula bez segmenta');
    a.run("primeniUlogu('rukovodilac','z1',false,['glupost']);");
    if (JSON.stringify(a.run('MODULI')) !== '["projektovanje","izvodjenje"]') throw new Error('nepoznat modul nije normalizovan: ' + JSON.stringify(a.run('MODULI')));
    // radnik: isto preko tima
    const rz = a.run("DATA.zaposleni.find(z=>(z.grs||[]).some(x=>grById[x]&&!jePro(grById[x]))&&!DATA.gradilista.some(g=>g.rukovodilac===z.id)).id");
    a.run(`primeniUlogu('radnik',${JSON.stringify(rz)},false,['izvodjenje']);`);
    if (a.run("visibleSites().some(g=>jePro(g))")) throw new Error('radnik izvodjenja vidi projektovanje');
    if (a.run("tabDozvoljen('tasks')")) throw new Error('radnik izvodjenja ima tab Zadaci');
    if (a.run("tabs().some(t=>t.id==='tasks')")) throw new Error('tabs() nudi Zadaci radniku izvodjenja');
    a.run("renderNav()");
    const bn = a.g.document.getElementById('bnav').innerHTML;
    if (bn.includes("go('tasks')") || !bn.includes("go('time')")) throw new Error('bnav: ' + bn.replace(/<svg[\s\S]*?<\/svg>/g, ''));
    a.run(`primeniUlogu('radnik',${JSON.stringify(rz)},false,['projektovanje']);`);
    if (!a.run("tabDozvoljen('tasks')")) throw new Error('radnik projektovanja nema Zadatke');
    a.run("renderNav()");
    if (!a.g.document.getElementById('bnav').innerHTML.includes("go('tasks')")) throw new Error('bnav bez Zadataka za radnika projektovanja');
    a.run("setRole('all')");
    if (a.run("tabDozvoljen('tasks')") !== true || a.run('MODULI.length') !== 2) throw new Error('uprava: sve');
  });
  await acheck('setRole sufiks |pro / |izv: parse, roleValue round-trip, roleOptions izvodi modul iz gradilista osobe', async () => {
    const a = await boot();
    a.run("setRole('z1|pro')");
    if (JSON.stringify(a.run('MODULI')) !== '["projektovanje"]' || a.run('roleValue()') !== 'z1|pro') throw new Error('z1|pro: ' + JSON.stringify(a.run('MODULI')) + ' ' + a.run('roleValue()'));
    a.run("setRole('z1:fin|izv')");
    if (JSON.stringify(a.run('MODULI')) !== '["izvodjenje"]' || !a.run('VIDI_FIN') || a.run('roleValue()') !== 'z1:fin|izv') throw new Error('z1:fin|izv: ' + a.run('roleValue()'));
    a.run("setRole('z1')");
    if (a.run('MODULI.length') !== 2 || a.run('roleValue()') !== 'z1') throw new Error('bez sufiksa = oba');
    const rz = a.run("DATA.zaposleni.find(z=>(z.grs||[]).some(x=>grById[x])&&!DATA.gradilista.some(g=>g.rukovodilac===z.id)).id");
    a.run(`setRole('radnik:${rz}|izv')`);
    if (a.run('roleValue()') !== `radnik:${rz}|izv`) throw new Error('radnik round-trip: ' + a.run('roleValue()'));
    a.run("setRole('all')");
    const ro = a.run('roleOptions()');
    const vals = [...ro.matchAll(/value="([^"]+)"/g)].map(m => m[1]);
    const ocek = ['all', 'admin', 'dirpro', 'dirizv', 'z17:fin|pro', 'z1|izv', 'radnik:z10|pro', 'radnik:z15|izv'];   // 6 test-profila (2026-10-11) + 2 direktora modula (2026-10-14)
    if (JSON.stringify(vals) !== JSON.stringify(ocek)) throw new Error('Pogled kao != 8 profila: ' + JSON.stringify(vals));
    if ((ro.match(/<option/g) || []).length !== 8) throw new Error('vise od 8 opcija');
    if (!ro.includes('selected')) throw new Error('trenutni pogled nije selektovan');
    a.run("setRole('z3')");   // pogled koji nije u listi ostaje vidljiv kao 7. opcija
    const ro2 = a.run('roleOptions()');
    if (!/value="z3" selected/.test(ro2) || (ro2.match(/<option/g) || []).length !== 9) throw new Error('trenutni pogled van liste nije dodat');
    a.run("DATA.zaposleni=DATA.zaposleni.filter(z=>z.id!=='z15'); rebuildMaps(); setRole('all');");   // osoba koje nema → opcija se preskace
    if (a.run('roleOptions()').includes('radnik:z15')) throw new Error('opcija za nepostojecu osobu');
  });
  await acheck('ulogaLabela + viewNalozi: moduli u redu i formi; mock odbija radnika sa 2 modula, uprava/spoljni uvek oba', async () => {
    const a = await boot({ supabase: true, seed: {} });
    if (!a.run("ulogaLabela('radnik',false,['izvodjenje'])").includes('izvođenje')) throw new Error('labela radnika bez modula');
    if (a.run("ulogaLabela('rukovodilac',true,['projektovanje','izvodjenje'])").includes('·')) throw new Error('oba modula ne treba da se ispisuju');
    if (a.run("ulogaLabela('admin',true,['projektovanje'])").includes('·')) throw new Error('uprava nema modul u labeli');
    const r1 = await a.g.__mock.createClient().rpc('dodeli_ulogu', { p_email: 'petar@test', p_uloga: 'radnik', p_zaposleni_id: 'z2', p_moduli: ['projektovanje', 'izvodjenje'] });
    if (!r1.error || !/tačno jedan/.test(r1.error.message)) throw new Error('mock: radnik sa 2 modula prosao');
    const r2 = await a.g.__mock.createClient().rpc('dodeli_ulogu', { p_email: 'petar@test', p_uloga: 'admin', p_moduli: ['projektovanje'] });
    if (r2.error) throw new Error('mock admin: ' + r2.error.message);
    const pa = a.g.__mock._db.profili.find(p => p.user_id === 'u-ruk');
    if (JSON.stringify(pa.moduli) !== '["projektovanje","izvodjenje"]') throw new Error('uprava mora imati oba: ' + JSON.stringify(pa.moduli));
    const np = await a.g.__mock.createClient().rpc('nalozi_pregled');
    if (!np.data.every(r => Array.isArray(r.moduli) && r.moduli.length)) throw new Error('nalozi_pregled bez moduli');
    a.run("go('nalozi')"); for (let i = 0; i < 8; i++) await new Promise(r => setImmediate(r));
    const h = a.g.document.getElementById('view').innerHTML;
    for (const x of ['id="n_mp"', 'id="n_mi"', 'nmp_u-ruk', 'nmi_u-ruk', 'tačno jedan']) if (!h.includes(x)) throw new Error('Admin kokpit nema ' + x);
  });

  /* ---- T40 Razno: slobodne stavke ispod svezaka (projektovanje, kreiranje) ---- */
  section('T40 Razno ceklista');
  await acheck('dodajRaznoRed + saveSite: popunjene stavke → redovi specifikacije "Razno — …" sa zaduzenim, prazne se preskacu, esc', async () => {
    const a = await boot();
    a.run("ROLE='all'; formSite();");
    const html = a.g.document.getElementById('modal').innerHTML;
    if (!html.includes('>Razno<') || !html.includes('id="raznoBox"')) throw new Error('nema sekcije Razno');
    if (html.indexOf('id="raznoBox"') < html.lastIndexOf('f_nd_')) throw new Error('Razno nije ISPOD svih svezaka');
    a.run('dodajRaznoRed(); dodajRaznoRed();');
    a.run("sifrarnikChecklist('projektovanje', true)");   // ponovni render (nova forma) mora da resetuje brojac
    if (a.run('RAZNO_N') !== 0) throw new Error('RAZNO_N nije resetovan pri ponovnom renderu: ' + a.run('RAZNO_N'));
    if (a.run("sifrarnikChecklist('projektovanje')").includes('raznoBox')) throw new Error('Razno se prikazuje bez eksplicitnog flaga');
    a.run("formSite(); dodajRaznoRed(); dodajRaznoRed(); dodajRaznoRed();");
    if (a.run('RAZNO_N') !== 3) throw new Error('RAZNO_N = ' + a.run('RAZNO_N'));
    const set = (id, val) => { a.g.document.getElementById(id).value = val; };
    set('f_naziv', 'T40 projekat'); set('f_modul', 'projektovanje');
    set('f_kli', a.run('DATA.clijenti[0].id')); set('f_ruk', a.run('DATA.zaposleni[0].id'));
    set('f_poc', a.run('todayStr()')); set('f_rok', a.run('plusDays(100)'));
    const zad = a.run('DATA.zaposleni[1].id');
    set('f_nr_0', '  Geodetski snimak '); set('f_nrz_0', zad);
    set('f_nr_1', '');                                   // prazna → preskoci
    set('f_nr_2', '<b>x</b>');                           // XSS → esc
    a.run('saveSite();');
    const gid = a.run('DATA.gradilista[DATA.gradilista.length-1].id');
    const rows = a.run(`DATA.predmer.filter(r=>r.gr===${JSON.stringify(gid)} && r.poz.startsWith('Razno'))`);
    if (rows.length !== 2) throw new Error('ocekujem 2 Razno reda, dobio ' + rows.length + ': ' + JSON.stringify(rows.map(r => r.poz)));
    const r0 = rows.find(r => r.poz === 'Razno — Geodetski snimak');
    if (!r0 || r0.zaduzen !== zad || r0.kol !== 1 || r0.jm !== 'kom') throw new Error('red: ' + JSON.stringify(r0));
    if (rows.some(r => r.poz.includes('<b>'))) throw new Error('XSS: ' + JSON.stringify(rows.map(r => r.poz)));
    if (!rows.some(r => r.poz.includes('&lt;b&gt;'))) throw new Error('esc nije primenjen');
    if (a.run('RAZNO_N') !== 0) throw new Error('RAZNO_N nije resetovan');
    const ids = new Set(a.run(`DATA.predmer.map(r=>r.id)`)); if (ids.size !== a.run('DATA.predmer.length')) throw new Error('duplirani id-jevi predmera');
    // izmena postojeceg: nema Razno
    a.run(`formSite(${JSON.stringify(gid)})`);
    if (a.g.document.getElementById('modal').innerHTML.includes('raznoBox')) throw new Error('Razno u formi izmene');
  });

  /* ---- T41 Kontrolna tabla: rokovi, dnevnik i najrizicniji projekat otvaraju gradiliste ---- */
  section('T41 tabla klik');
  await acheck('viewDash: svaka stavka rokova i dnevnika ima onclick openSite; najrizicniji projekat u brifu klikabilan; status red klikabilan', async () => {
    const a = await boot();
    a.run("ROLE='all'; MODUL='sve'; PODTIP='sve'; current='dash'; render();");
    const h = a.g.document.getElementById('view').innerHTML;
    const dl = h.match(/<div class="dl[^"]*"[^>]*>/g) || [];
    if (dl.length < 4) throw new Error('premalo dl stavki: ' + dl.length);
    const bez = dl.filter(x => !/onclick="openSite\('g[^']+'\)"/.test(x) && !/go\('resursi'\)/.test(x));
    if (bez.length) throw new Error('stavke bez klika: ' + bez.join(' | '));
    if (!/zdravlje \d+\/100/.test(h)) throw new Error('brif za upravu nema najrizicniji projekat (DEMO ima aktivne projekte)');
    if (!/<b style="[^"]*" onclick="openSite\('g[^']+'\)">[^<]+<\/b> — zdravlje \d+\/100/.test(h)) throw new Error('najrizicniji projekat u brifu nije klikabilan');
    if (!/<tr class="clk" onclick="openSite\('g[^']+'\)">[\s\S]*?<span class="badge/.test(h)) throw new Error('red sa statusom nije klikabilan');
    // rukovodilac: isto, bez curenja tudjih id-jeva
    const ruk = a.run("DATA.gradilista.find(g=>g.rukovodilac).rukovodilac");
    a.run(`setRole(${JSON.stringify(ruk)}); current='dash'; render();`);
    const h2 = a.g.document.getElementById('view').innerHTML;
    const vidi = new Set(a.run('[...visibleSiteIds()]'));
    const ids = [...h2.matchAll(/openSite\('(g[^']+)'\)/g)].map(m => m[1]);
    if (!ids.length) throw new Error('rukovodilac nema nijedan klik na tabli');
    const tudje = ids.filter(x => !vidi.has(x));
    if (tudje.length) throw new Error('rukovodilac dobija klik na tudja gradilista: ' + tudje.join(','));
  });

  /* ---- T39 Gantt: osa siroka koliko zaglavlje meseci (inace stapici/"danas" klize) ---- */
  section('T39 Gantt osa');
  await acheck('viewTime: kolone minmax(0,1fr) + inline min-width iz broja meseci', async () => {
    const a = await boot();
    const h = a.run(`current='time'; viewTime()`);
    const n = (h.match(/repeat\((\d+),minmax\(0,1fr\)\)/) || [])[1];
    if (!n) throw new Error('nema repeat(N,minmax(0,1fr)) — kolona meseca sme da naraste na min-content i zaglavlje iscuri sire od trake');
    if (h.match(/repeat\(\d+,1fr\)/)) throw new Error('jos postoji repeat(N,1fr)');
    const mw = `min-width:max(var(--g-min), calc(var(--g-lab) + ${n} * var(--g-col)))`;
    if (!h.includes(`class="gantt-inner" style="${mw}"`)) throw new Error('gantt-inner nema inline ' + mw);
    const css = HTML.slice(0, HTML.indexOf('</style>'));
    for (const v of ['--g-col:', '--g-min:']) if (!css.includes(v)) throw new Error('CSS nema ' + v);
    if (!/\.g-months \.gm\{[^}]*overflow:hidden/.test(css)) throw new Error('.gm bez overflow:hidden — tekst meseca bi sirio kolonu');
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
