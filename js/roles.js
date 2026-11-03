/* ============================================================
   ULOGE (simulacija više korisnika)
   ============================================================ */
let ROLE = 'all'; // 'all' = uprava (direktor|admin); inače id osobe (zaposleni ili spoljni saradnik)
/* Sest uloga (2026-10-07): ULOGA = 'direktor'|'admin'|'rukovodilac'|'radnik'|'spoljni',
   VIDI_FIN = finansije (uprava uvek; rukovodilac po zastavici = "Rukovodilac 1"),
   JA = id zaposlenog (rukovodilac/radnik) ili podizvodjaca (spoljni). ROLE ostaje zbog
   17+ provera `g.rukovodilac===ROLE`. Server sprovodi isto (migracija 14). */
let ULOGA='direktor', VIDI_FIN=true, JA=null, MODULI=['projektovanje','izvodjenje'];
const SVI_MODULI=['projektovanje','izvodjenje'];
/* Modul po nalogu (migracija 18, odluka klijenta 2026-10-11): rukovodilac 1–2 modula, radnik TACNO 1,
   uprava/spoljni oba. Server: modul_dozvoljen() u vodim/moje_gradiliste. Klijent: MODULI + modulDozvoljen(). */
function normalizujModule(m){ const a=Array.isArray(m)?[...new Set(m.filter(x=>SVI_MODULI.includes(x)))]:[]; return a.length?a:SVI_MODULI.slice(); }
function modulDozvoljen(m){ return MODULI.includes(m); }   // uprava ima oba; direktor modula jedan (migracija 27)
/* Koju vrstu pristupa ima trenutni pogled: 'uprava' | 'rukovodilac' | 'radnik' | 'spoljni'.
   Testovi i stari kod postavljaju samo ROLE='z1' — to je rukovodilac. */
function vrstaUloge(){ if(ROLE==='all') return 'uprava'; return (ULOGA==='radnik'||ULOGA==='spoljni')?ULOGA:'rukovodilac'; }
function jeSuper(){ return ROLE==='all' && ULOGA==='direktor'; }   // SAMO direktor: globalno brisanje, dodela direktorskih uloga (server je_super)
function jeDirektorModula(){ return ROLE==='all' && !!MODUL_ULOGE[ULOGA]; }
function jePunaUprava(){ return ROLE==='all' && !MODUL_ULOGE[ULOGA]; }   // direktor | admin: Admin kokpit (nalozi, uloge, angazovanost, log) — odluka 2026-10-14, migracija 28
/* Brisanje reda gradilista: direktor svuda, direktor modula na svom gradilistu (server smem_brisati). Admin ne brise. */
function smemBrisati(grId){ return jeSuper() || (jeDirektorModula() && smemNa(grId)); }
function upravaSve(){ return isDirector() && MODUL==='sve' && MODULI.length>1; }
/* Modul koji UI prikazuje: izabrani segment, ili jedini modul naloga (direktor modula, rukovodilac/radnik jednog modula) — MODUL tada ostaje 'sve'. */
function modulEfektivni(){ return MODUL!=='sve' ? MODUL : (MODULI.length===1 ? MODULI[0] : 'sve'); }   // „vidi sve" za liste bez gradilista: samo puna uprava bez filtera modula
function primeniUlogu(uloga, ja, fin, moduli){
  ULOGA=uloga||'direktor'; JA=ja||null;
  const uprava=jeUpravaUloga(ULOGA);
  VIDI_FIN = uprava ? true : (ULOGA==='rukovodilac' && !!fin);
  ROLE = uprava ? 'all' : (JA||'all');
  MODULI = MODUL_ULOGE[ULOGA] ? [MODUL_ULOGE[ULOGA]] : (uprava||ULOGA==='spoljni') ? SVI_MODULI.slice() : normalizujModule(moduli);
  if(MODUL!=='sve' && !modulDozvoljen(MODUL)) MODUL='sve';   // segment modula ne nudi nedozvoljen modul; jedan modul = bez segmenta
  if(MODULI.length===1) MODUL='sve';
}
/* Tabovi po ulozi (odluka klijenta 2026-10-07): uprava sve; rukovodilac: naplata (samo sa
   finansijama), gradilišta, rokovi, zadaci, dnevnik, magacin, trebovanje; radnik/spoljni isto bez naplate. */
const TABOVI_OSTALI=['dash','sites','time','tasks','diary','magacin','nabavka','pay'];
function tabDozvoljen(id){
  if(id==='tasks' && !MODULI.includes('projektovanje')) return false;   // bez projektovanja nema zadataka (Izvodjenje: podizvodjaci), odluka 2026-10-11
  if((id==='magacin'||id==='pay') && !MODULI.includes('izvodjenje')) return false;   // magacin = sifarnik Izvodjenja; naplata samo Izvodjenje (i za direktora modula
  if(id==='magacin' && modulEfektivni()==='projektovanje') return false;   // u segmentu Projektovanje nema sifarnika/magacina ni za upravu (zahtev 2026-10-23))
  if(vrstaUloge()==='uprava') return true;
  if(id==='pay') return false;   // tab Naplata vidi SAMO uprava (direktor/admin/direktor izvodjenja) — odluka klijenta 2026-10-14; rukovodilac situacije radi iz fioke gradilista
  return TABOVI_OSTALI.includes(id);
}
/* Ime osobe po id-u: zaposleni ili spoljni saradnik (dnevnik.autor / zadaci.zad / dokumenti.autor). */
function osobaIme(id){ if(!id) return '—'; if(id==='direkcija') return 'Direkcija'; const z=zapById[id]; if(z) return z.ime; const p=(DATA.podizvodjaci||[]).find(x=>x.id===id); return p?p.naziv:'—'; }
function modulLabela(m){ return m==='projektovanje'?'projektovanje':m==='izvodjenje'?'izvođenje':m; }
function ulogaLabela(u, fin, mods){
  /* Imena (odluka klijenta 2026-10-23): Direktor, Admin, Direktor projektovanje, Direktor izvođenje, Rukovodilac projektovanje,
     Rukovodilac izvođenje (modul iz naloga; oba modula = „Rukovodilac (oba modula)“), Radnik (samo projektovanje), Spoljni saradnik. */
  if(u==='rukovodilac'){ const m=normalizujModule(mods); return 'Rukovodilac'+(m.length===1?' '+modulLabela(m[0]):' (oba modula)')+(fin?' · sa finansijama':''); }
  return ({direktor:'Direktor',admin:'Admin',direktor_projektovanja:'Direktor projektovanje',direktor_izvodjenja:'Direktor izvođenje',radnik:'Radnik',spoljni:'Spoljni saradnik'})[u]||u;
}
let MODUL = 'sve';  // 'sve' | 'projektovanje' | 'izvodjenje'
let PODTIP = 'sve'; // samo za izvodjenje: 'sve' | 'visokogradnja' | 'niskogradnja'
const MODUL_BOJA = {projektovanje:'var(--purple)', izvodjenje:'var(--blue)'};
const PODTIPOVI = {visokogradnja:'Visokogradnja', niskogradnja:'Niskogradnja'};
const PODTIP_BOJA = {visokogradnja:'var(--blue)', niskogradnja:'var(--amber)'};
function modLab(g){ return (g.modul||'izvodjenje')==='projektovanje' ? 'Projektovanje' : PODTIPOVI[g.tip||'visokogradnja']; }   // nivo gradilista se ne prikazuje (faza je po svesci, 2026-10-14)
function modCol(g){ return (g.modul||'izvodjenje')==='projektovanje' ? MODUL_BOJA.projektovanje : PODTIP_BOJA[g.tip||'visokogradnja']; }
function setModul(m){ MODUL=m; PODTIP='sve'; renderNav(); render(); closeDrawer(); }
function setPodtip(t){ PODTIP=t; renderNav(); render(); closeDrawer(); }
function modulSeg(){
  const ops=[['sve','Svi moduli'],['projektovanje','Projektovanje'],['izvodjenje','Izvođenje radova']]
    .filter(o=>o[0]==='sve' ? MODULI.length>1 : modulDozvoljen(o[0]));
  if(ops.length<=1) return '';   // nalog sa jednim modulom: nema sta da bira
  let h=`<div class="modul-seg">${ops.map(o=>`<button class="${MODUL===o[0]?'on':''}" onclick="setModul('${o[0]}')">${o[0]!=='sve'?`<i style="background:${MODUL_BOJA[o[0]]}"></i>`:''}${o[1]}</button>`).join('')}</div>`;
  if(MODUL==='izvodjenje'){
    const sub=[['sve','Sve'],['visokogradnja','Visokogradnja'],['niskogradnja','Niskogradnja']];
    h+=`<div class="modul-seg">${sub.map(o=>`<button class="${PODTIP===o[0]?'on':''}" onclick="setPodtip('${o[0]}')">${o[0]!=='sve'?`<i style="background:${PODTIP_BOJA[o[0]]}"></i>`:''}${o[1]}</button>`).join('')}</div>`;
  }
  return '<div class="modul-wrap">'+h+'</div>';
}
/* "Pogled kao" (demo + simulacija za upravu). Vrednost: 'all' | 'admin' | '<zid>' (rukovodilac 2) |
   '<zid>:fin' (rukovodilac 1) | 'radnik:<zid>' | 'spoljni:<pid>'; opcioni sufiks '|pro' / '|izv' = jedan modul (bez sufiksa = oba) */
function setRole(r){
  if(PROFIL && !jeUpravaUloga(PROFIL.uloga)) return;
  r=String(r||'all');
  if(PROFIL && MODUL_ULOGE[PROFIL.uloga] && ['admin','dirpro','dirizv'].includes(r)) r='all';   // direktor modula ne simulira drugu upravu
  let mods=null; const bar=r.indexOf('|');
  if(bar>=0){ const suf=r.slice(bar+1); r=r.slice(0,bar); mods=suf==='pro'?['projektovanje']:suf==='izv'?['izvodjenje']:null; }
  if(r==='all') primeniUlogu(PROFIL&&jeUpravaUloga(PROFIL.uloga)?PROFIL.uloga:'direktor', null, true);
  else if(r==='admin') primeniUlogu('admin', null, true);
  else if(r==='dirpro') primeniUlogu('direktor_projektovanja', null, true);
  else if(r==='dirizv') primeniUlogu('direktor_izvodjenja', null, true);
  else if(r.startsWith('radnik:')) primeniUlogu('radnik', r.slice(7), false, mods);   // simulacija: modul iz sufiksa (pravi nalozi radnika su samo projektovanje — migracija 32, server)
  else if(r.startsWith('spoljni:')) primeniUlogu('spoljni', r.slice(8), false);
  else if(r.endsWith(':fin')) primeniUlogu('rukovodilac', r.slice(0,-4), true, mods);
  else primeniUlogu('rukovodilac', r, false, mods);
  if((ROLE!=='all' && ['cena','naplata','sit'].includes(dashSort.key)) || !['smart','zdr','sit','cena','naplata','ljudi','napredak','rok'].includes(dashSort.key)) dashSort={key:'smart',dir:-1};   // nepoznat/uklonjen kljuc → podrazumevano
  if(!tabDozvoljen(current)) current='dash';
  renderNav(); render(); closeDrawer();
}
function modulSufiks(){ return MODULI.length===1 ? (MODULI[0]==='projektovanje'?'|pro':'|izv') : ''; }
function roleValue(){ const v=vrstaUloge(); return v==='uprava'?(ULOGA==='admin'?'admin':ULOGA==='direktor_projektovanja'?'dirpro':ULOGA==='direktor_izvodjenja'?'dirizv':'all'):v==='radnik'?'radnik:'+ROLE+modulSufiks():v==='spoljni'?'spoljni:'+ROLE:(VIDI_FIN?ROLE+':fin':ROLE)+modulSufiks(); }
/* "Pogled kao" = 6 test-profila (zahtev 2026-10-11), isti ljudi kao pravi nalozi u bazi; osoba koje nema u DATA se preskace.
   Trenutna vrednost (npr. iz testova) ostaje u listi da select ne "iskoci". */
const POGLED_KAO=[
  ['all','Direktor — sve'], ['admin','Admin — sve, bez brisanja'],
  ['dirpro','Direktor projektovanje — samo modul projektovanje'], ['dirizv','Direktor izvođenje — samo modul izvođenje'],
  ['z17:fin|pro','Rukovodilac projektovanje (Nikola, sa finansijama)'], ['z1|izv','Rukovodilac izvođenje (Petar, bez finansija)'],
  ['radnik:z10|pro','Radnik (Sara)'],   // radnik postoji samo u Projektovanju (migracija 32); Miloš (z15) je prebačen na projektovanje
];
function roleOptions(){
  const mojMod=PROFIL&&MODUL_ULOGE[PROFIL.uloga]||null;   // direktor modula: bez admina/drugog direktora modula i bez osoba drugog modula
  let cur=roleValue(); if(mojMod && (cur==='dirpro'||cur==='dirizv')) cur='all';   // sopstvena uloga direktora modula = „all"
  const o=(v,t)=>`<option value="${v}" ${cur===v?'selected':''}>${t}</option>`;
  const osoba=v=>{ const m=v.match(/^(?:radnik:|spoljni:)?([a-z]+\d+)/); return m?m[1]:null; };
  const lista=POGLED_KAO.filter(([v])=>{ const id=osoba(v); if(!(!id || zapById[id] || (DATA.podizvodjaci||[]).some(p=>p.id===id))) return false;
    if(!mojMod) return true;
    if(v==='admin' || v==='dirpro' || v==='dirizv') return false;
    const suf=v.indexOf('|')>=0?v.slice(v.indexOf('|')+1):''; return !suf || (suf==='pro'?'projektovanje':'izvodjenje')===mojMod; })
    .map(([v,t])=>[v, v==='all'&&mojMod?ulogaLabela(PROFIL.uloga)+' — sve u modulu':t]);
  if(!lista.some(([v])=>v===cur)) lista.push([cur, 'Trenutni pogled ('+cur+')']);
  return lista.map(([v,t])=>o(v,t)).join('');
}
function visibleSites(){
  const v=vrstaUloge();
  let l = v==='uprava' ? DATA.gradilista
        : v==='radnik' ? DATA.gradilista.filter(g=>((zapById[ROLE]||{}).grs||[]).includes(g.id))
        : v==='spoljni' ? DATA.gradilista.filter(g=>(((DATA.podizvodjaci||[]).find(p=>p.id===ROLE)||{}).grs||[]).includes(g.id))
        : DATA.gradilista.filter(g=>g.rukovodilac===ROLE);
  l = l.filter(g=>MODULI.includes(g.modul||'izvodjenje'));   // modul po nalogu, i za direktora modula (server: modul_dozvoljen)
  if(MODUL!=='sve') l = l.filter(g=>(g.modul||'izvodjenje')===MODUL);
  if(MODUL==='izvodjenje' && PODTIP!=='sve') l = l.filter(g=>(g.tip||'visokogradnja')===PODTIP);
  return l;
}
function visibleSiteIds(){ return new Set(visibleSites().map(g=>g.id)); }
/* Zadaci po ulozi (odluka 2026-10-08): uprava sve (uz filter modula); rukovodilac sve zadatke svojih
   gradilista (i svojih radnika na njima); radnik/spoljni SAMO svoje zadatke na svojim gradilistima.
   Server isto (migracija 17: p_sel zadaci). */
/* Zadaci postoje SAMO u Projektovanju (odluka 2026-10-11): na gradilistima Izvodjenja ih nema (radove nose podizvodjaci) —
   ne prikazuju se, ne nude se u formi, ne ulaze u rokove/upozorenja. Stari redovi u bazi ostaju, samo su sakriveni. */
function zadatakPro(t){ const g=grById[t.gr]; return !!g && jePro(g); }
/* U Projektovanju zadaci SU sveske (+ razno) iz specifikacije (migracija 20, odluka klijenta): svaka stavka predmera
   projektantskog gradilista ima zadatak sa predmer_id, dodeljen zaduzenom (ili rukovodiocu); covek na njemu klikne
   play/pauza/stop. sinhronizujSveske(gr): napravi zadatke koji fale, uskladi naziv/zaduzenog, ukloni zadatke obrisanih
   stavki (server: on delete cascade). Zove se posle svake izmene specifikacije i pri pokretanju (samo ko VODI gradiliste —
   on sme da pise zadatke). Status zadatka ↔ sveska: 'done' → predmer.izv = kol, povratak iz 'done' → izv = 0 ako je bila
   puna — isto radi server (trg_zadatak_sveska_izv, definer — radnik ne sme u predmer), klijent samo lokalno ako vodi. */
function sinhronizujSveske(grId){
  const g=grById[grId]; if(!g||!jePro(g)||!smemNa(grId)) return 0;
  const pm=predmerZa(grId), poId={}; (DATA.zadaci||[]).forEach(t=>{ if(t.predmer_id) poId[t.predmer_id]=t; });
  let n=0;
  pm.forEach(p=>{
    let t=poId[p.id];
    if(!t){
      const gotova=(+p.kol||0)>0 && (+p.izv||0)>=(+p.kol||0);
      DATA.zadaci.push({ id:'tsv-'+p.id, naziv:p.poz, opis:'', gr:grId, zad:p.zaduzen||g.rukovodilac||null, prio:'mid', kol:gotova?'done':'todo', rok:g.rok||plusDays(30), predmer_id:p.id });   // deterministican id = isti na serveru (backfill) i u dva taba → PK konflikt, ne duplikat
    } else {
      if(t.naziv!==p.poz) t.naziv=p.poz;
      if(p.zaduzen && t.zad!==p.zaduzen) t.zad=p.zaduzen;
    }
  });
  pm.forEach(p=>{ if(p.zaduzen && p.zaduzen!==g.rukovodilac && osigurajUTimu(grId, p.zaduzen)) n++; });   // tim projektantskog gradilista = ko je zaduzen za svesku (fioka nema „Uredi tim")
  const ids=new Set(pm.map(p=>p.id));
  (DATA.zadaci||[]).filter(t=>t.gr===grId&&t.predmer_id&&!ids.has(t.predmer_id)).forEach(t=>{ if(PUSHED.zadaci) delete PUSHED.zadaci[t.id]; });
  DATA.zadaci=(DATA.zadaci||[]).filter(t=>!(t.gr===grId&&t.predmer_id&&!ids.has(t.predmer_id)));
  return n;
}
/* Osoba (zaposleni ili spoljni saradnik) dobija pristup gradilistu: z.grs / p.grs (join tabele; polisa insert = vodim). Ne uklanja nikoga. */
function osigurajUTimu(grId, osoba){
  if(!smemNa(grId)) return false;
  const z=zapById[osoba];
  if(z){ if((z.grs||[]).includes(grId)) return false; z.grs=[...(z.grs||[]),grId]; z.bivsi=(z.bivsi||[]).filter(x=>x!==grId); return true; }
  const sp=(DATA.podizvodjaci||[]).find(x=>x.id===osoba);
  if(sp){ if((sp.grs||[]).includes(grId)) return false; sp.grs=[...(sp.grs||[]),grId]; return true; }
  return false;
}
/* Dodela sveske osobi iz fioke (Projektovanje): predmer.zaduzen → zadatak sveske (sinhronizujSveske) → tim. */
function dodeliSvesku(grId, pid, osoba){
  if(!smemPredmer(grId)) return;
  const p=(DATA.predmer||[]).find(x=>x.id===pid&&x.gr===grId); if(!p) return;
  if(osoba && !zapById[osoba] && !(DATA.podizvodjaci||[]).some(x=>x.id===osoba)) return;
  p.zaduzen=osoba||null;
  sinhronizujSveske(grId);
  const t=(DATA.zadaci||[]).find(x=>x.predmer_id===pid), g=grById[grId];   // i skidanje dodele: zadatak ide rukovodiocu (sync prenosi samo postavljenog)
  if(t) t.zad=osoba||(g&&g.rukovodilac)||null;
  saveState(); osveziFioku(grId);
}
function sinhronizujSveskeSve(){ let n=0; (DATA.gradilista||[]).forEach(g=>{ if(jePro(g)&&smemNa(g.id)) n+=sinhronizujSveske(g.id); }); return n; }
/* status zadatka sveske → izvedeno sveske (lokalno samo ako vodim; server to radi za svakog) */
function uskladiSveskuIzZadatka(t, staroKol){
  if(!t||!t.predmer_id||!smemNa(t.gr)) return;
  const p=(DATA.predmer||[]).find(x=>x.id===t.predmer_id); if(!p) return;
  const k=+p.kol||0;
  if(t.kol==='done'){ if((+p.izv||0)!==k) p.izv=k; }
  else if(staroKol==='done' && k>0 && (+p.izv||0)>=k) p.izv=0;
  osveziNapredak(t.gr);
}
function zadaciVidljivi(){
  const v=vrstaUloge(), ids=visibleSiteIds();
  if(v==='uprava') return DATA.zadaci.filter(t=>zadatakPro(t)&&(upravaSve()||ids.has(t.gr)));
  if(v==='rukovodilac') return DATA.zadaci.filter(t=>zadatakPro(t)&&ids.has(t.gr));
  return DATA.zadaci.filter(t=>zadatakPro(t)&&ids.has(t.gr) && t.zad===ROLE);
}
function isDirector(){ return ROLE==='all'; }
/* Vlasnistvo gradilista: direktor sve, rukovodilac samo svoje.
   Koristiti u SVAKOJ funkciji koja prima grId spolja — funkcije su globalne,
   pa sakriveno dugme nije zastita (CLAUDE.md pravilo 2). */
function smemNa(grId){ const g=grById[grId]; return !!g && (isDirector() ? modulDozvoljen(g.modul||'izvodjenje') : (vrstaUloge()==='rukovodilac' && g.rukovodilac===ROLE)); }   // VODIM: uprava (u svom modulu) | rukovodilac gradilista (pisanje)
function vidimGr(grId){ return visibleSiteIds().has(grId); }   // CITANJE: + radnik u timu, spoljni na gradilistu
function mogaDaUpravljam(){ const v=vrstaUloge(); return v==='uprava'||v==='rukovodilac'; }   // zadaci, trebovanje, magacin izlaz, tim

