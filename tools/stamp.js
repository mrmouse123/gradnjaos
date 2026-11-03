#!/usr/bin/env node
'use strict';
/* Upisuje ?v=<hash sadrzaja> u <script src="js/..."> i <link href="css/..."> u index.html.
   Zasto: GitHub Pages kesira fajlove do 10 min; bez promene URL-a pregledac bi uz NOVI index.html mogao da ucita STARI js.
   Svaka izmena css/ ili js/ fajla menja svoj hash → menja index.html → aplikacija (proveriNovuVerziju) vidi novu verziju.
   Pokretanje:  node tools/stamp.js          upise nove oznake
                node tools/stamp.js --check  samo proveri (izlaz 1 ako su zastarele ili fajl nedostaje/nije ukljucen)
   Hash se racuna nad tekstom sa \n (CRLF/LF ne menja oznaku). */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const TAG = /(<script src="|<link rel="stylesheet" href=")((?:js|css)\/[^"?]+)(?:\?v=[0-9a-f]*)?(">)/g;
const hash = (root, rel) => crypto.createHash('sha1').update(fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n')).digest('hex').slice(0, 10);

/** { html: nov index.html, stale: [fajlovi sa starom oznakom], missing: [referisani a nepostojeci], unreferenced: [u js/ ili css/ a bez taga] } */
function analyze(root) {
  const file = path.join(root, 'index.html');
  const html = fs.readFileSync(file, 'utf8');
  const stale = [], missing = [], used = new Set();
  const out = html.replace(TAG, (m, pre, rel, post) => {
    used.add(rel);
    if (!fs.existsSync(path.join(root, rel))) { missing.push(rel); return m; }
    const next = `${pre}${rel}?v=${hash(root, rel)}${post}`;
    if (next !== m) stale.push(rel);
    return next;
  });
  const unreferenced = ['js', 'css'].flatMap(d => fs.existsSync(path.join(root, d)) ? fs.readdirSync(path.join(root, d)).map(f => d + '/' + f) : []).filter(f => !used.has(f));
  return { file, html, out, stale, missing, unreferenced };
}

module.exports = { analyze };

if (require.main === module) {
  const root = path.join(__dirname, '..');
  const r = analyze(root);
  const problems = [...r.missing.map(f => 'nedostaje ' + f), ...r.unreferenced.map(f => 'nije u index.html: ' + f)];
  if (process.argv.includes('--check')) {
    r.stale.forEach(f => problems.push('zastarela oznaka ?v= za ' + f));
    if (problems.length) { console.error(problems.join('\n') + '\nPopravka: node tools/stamp.js'); process.exit(1); }
    console.log('oznake ?v= su azurne');
  } else {
    if (r.stale.length) fs.writeFileSync(r.file, r.out);
    console.log(r.stale.length ? 'azurirano: ' + r.stale.join(', ') : 'oznake ?v= su vec azurne');
    if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
  }
}
