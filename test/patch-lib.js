'use strict';
/* Alat za bezbedne izmene index.html (lessons.md: svaki replace mora imati assert,
   upis ide preko temp fajla pa atomic rename — fajl je jednom već truncate-ovan). */
const fs = require('fs');
const path = require('path');

class Patcher {
  constructor(file){
    this.file = file;
    this.src = fs.readFileSync(file, 'utf8');
    this.orig = this.src;
    this.log = [];
  }
  /** Zameni tačno `count` pojava. Baca ako broj pogodaka nije očekivan. */
  replace(name, find, repl, count = 1){
    const isRe = find instanceof RegExp;
    let hits;
    if (isRe) {
      const g = new RegExp(find.source, find.flags.includes('g') ? find.flags : find.flags + 'g');
      hits = (this.src.match(g) || []).length;
    } else {
      hits = this.src.split(find).length - 1;
    }
    if (hits !== count) {
      throw new Error(`PATCH "${name}": očekivano ${count} pogodaka, nađeno ${hits}\n  cilj: ${String(find).slice(0, 160)}`);
    }
    this.src = isRe
      ? this.src.replace(new RegExp(find.source, find.flags.includes('g') ? find.flags : find.flags + 'g'), repl)
      : this.src.split(find).join(repl);
    this.log.push(`  ✓ ${name} (${hits}×)`);
    return this;
  }
  /** Potvrdi da se nešto NE nalazi u fajlu (posle izmene). */
  assertAbsent(name, find){
    const hits = find instanceof RegExp
      ? (this.src.match(new RegExp(find.source, find.flags.includes('g') ? find.flags : find.flags + 'g')) || []).length
      : this.src.split(find).length - 1;
    if (hits !== 0) throw new Error(`ASSERT "${name}": još uvek postoji ${hits}× ${String(find).slice(0, 120)}`);
    this.log.push(`  ✓ assert: ${name}`);
    return this;
  }
  /** Potvrdi da nešto POSTOJI (npr. da nova deklaracija nije izgubljena). */
  assertPresent(name, find, count = null){
    const hits = find instanceof RegExp
      ? (this.src.match(new RegExp(find.source, find.flags.includes('g') ? find.flags : find.flags + 'g')) || []).length
      : this.src.split(find).length - 1;
    if (hits === 0 || (count !== null && hits !== count)) {
      throw new Error(`ASSERT "${name}": nađeno ${hits}${count !== null ? ', očekivano ' + count : ''}`);
    }
    this.log.push(`  ✓ assert: ${name} (${hits}×)`);
    return this;
  }
  /** Popiši sve top-level deklaracije — lekcija 1: brisanje bloka ne sme pojesti deklaraciju. */
  declarations(src = this.src){
    const s = src.slice(src.indexOf('<script>'), src.indexOf('</script>'));
    return new Set([...s.matchAll(/^(?:\s*)(?:function|let|const|var)\s+([A-Za-z_$][\w$]*)/gm)].map(m => m[1]));
  }
  assertNoLostDeclarations(namernoUklonjene = []){
    const before = this.declarations(this.orig), after = this.declarations(this.src);
    const lost = [...before].filter(d => !after.has(d) && !namernoUklonjene.includes(d));
    if (lost.length) throw new Error('ASSERT: izgubljene deklaracije: ' + lost.join(', '));
    const nisuBile = namernoUklonjene.filter(d => after.has(d));
    if (nisuBile.length) throw new Error('ASSERT: "uklonjene" deklaracije i dalje postoje: ' + nisuBile.join(', '));
    const added = [...after].filter(d => !before.has(d));
    this.log.push(`  ✓ assert: nijedna deklaracija nije izgubljena${added.length ? ' (nove: ' + added.join(', ') + ')' : ''}`);
    return this;
  }
  /** Sintaksna provera <script> bloka pre upisa. */
  assertSyntax(){
    const m = [...this.src.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)];
    if (!m.length) throw new Error('ASSERT: nema inline <script> bloka');
    m.forEach((x, i) => { try { new Function(x[1]); } catch (e) { throw new Error(`ASSERT sintaksa blok#${i}: ${e.message}`); } });
    this.log.push('  ✓ assert: sintaksa OK');
    return this;
  }
  /** Atomic upis: temp fajl -> rename. */
  write(){
    if (this.src === this.orig) throw new Error('PATCH: ništa nije promenjeno — sve izmene su promašile?');
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, this.src, 'utf8');
    fs.renameSync(tmp, this.file);
    this.log.push(`  ✓ upisano (${this.orig.length} -> ${this.src.length} bajtova)`);
    return this;
  }
  print(title){ console.log(title + '\n' + this.log.join('\n')); return this; }
}

module.exports = { Patcher };
