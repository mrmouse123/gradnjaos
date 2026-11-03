/* ============================================================
   POMOĆNE
   ============================================================ */
const esc=v=>String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;').replace(/`/g,'&#96;');
/* Obrnuto od esc(). DATA cuva tekst HTML-escapovan (CLAUDE.md pravilo 3), pa svaki
   izlaz koji NIJE HTML — CSV, telo mejla, ime fajla — mora proci kroz unesc(),
   inace korisnik dobije "Petrovic &amp; Sinovi" umesto "Petrovic & Sinovi". */
/* Broj iz korisnickog unosa. "1.234,50" i "1234.50" i "1.250" (hiljade) i "12.5".
   Pravilo: zarez je uvek decimalni; tacka je hiljade samo u obliku d{1,3}(.ddd)+. */
const broj=s=>{ s=String(s??'').trim().replace(/\s/g,''); if(!s) return 0;
  const n = s.includes(',') ? +s.replace(/\./g,'').replace(',','.')
          : +(/^-?\d{1,3}(\.\d{3})+$/.test(s) ? s.replace(/\./g,'') : s);
  return Number.isFinite(n)?n:0; };
const unesc=v=>String(v??'').replace(/&#96;/g,'`').replace(/&#39;/g,"'").replace(/&quot;/g,'"').replace(/&gt;/g,'>').replace(/&lt;/g,'<').replace(/&amp;/g,'&');
/* Valuta (odluka klijenta 2026-10-11): sve cene su jedinicne cene BEZ PDV u RSD (cena iz sifarnika → predmer → situacija).
   Jedno mesto za promenu; imena fmtEur/fmtEurK ostaju (200+ poziva). */
const VALUTA='RSD';
const fmtEur = n => Math.round(n).toLocaleString('sr-RS') + ' ' + VALUTA;
const fmtEurK = n => { const a=Math.abs(n), s=n<0?'-':''; return (a>=1000000 ? s+(a/1000000).toFixed(2).replace('.',',')+'M' : s+Math.round(a/1000)+'k') + ' ' + VALUTA; };
const initials = ime => ime.split(' ').map(w=>w[0]).slice(0,2).join('').toUpperCase();
const dParse = s => new Date(s+'T00:00:00');
const daysBetween = (a,b) => Math.round((b-a)/86400000);
function fmtDate(s){ const d=dParse(s); return d.getDate()+'. '+MESECI[d.getMonth()]+' '+d.getFullYear(); }
/* Planska/ostvarena profitna stopa je UKLONJENA 2026-10-12 (odluka klijenta: ne meri se) — iz UI, formule zdravlja i servera (migracija 24). */
function sitZa(id){ return (DATA.situacije||[]).filter(s=>s.gr===id); }
function naplSum(g){ const s=sitZa(g.id); return s.length? s.filter(x=>x.status==='placeno').reduce((a,b)=>a+(b.iznos||0),0) : (g.naplaceno||0); }   // iznos null bez finansija (situacije_v)
function naplataPct(g){ return g.budzet?Math.round(naplSum(g)/g.budzet*100):0; }
/* Projektovanje NEMA situacija ni naplatu po situacijama (odluka klijenta 2026-10-14, migracija 26): situacije se ne
   nude ni ne listaju na projektantskom gradilistu, Naplata/KPI/upozorenja/penal zdravlja gledaju samo Izvodjenje. */
function imaNaplatu(g){ return !!g && !jePro(g); }
function canFinance(){ return isDirector() || (ULOGA==='rukovodilac' && VIDI_FIN && ROLE!=='all'); }   // uprava uvek; "Rukovodilac 1" po zastavici (ULOGA eksplicitno rukovodilac); radnik/spoljni nikad
/* Jedinicne cene (predmer.cena) vidi i rukovodilac SVOG gradilista Izvodjenja bez zastavice (odluka klijenta 2026-10-12,
   migracija 23: predmer_v). Cene fiksira uprava (trigger zastiti_kolone_predmer). Budzet/troskovi/naplata/iznos: i dalje canFinance(). */
function vidimCene(grId){ const g=grById[grId]; return !!g && (canFinance() || (vrstaUloge()==='rukovodilac' && !jePro(g) && smemNa(grId))); }
function sitKasni(s){ return pregledSit(s)==='odobrena' && (s.status==='kasni' || (s.status==='ceka' && daysBetween(TODAY,dParse(s.valuta))<0)); }   // tek odobrena ulazi u naplatu (migracija 25)
function troskoviZa(grId){ return (DATA.troskovi_st||[]).filter(t=>t.gr===grId).sort((a,b)=>dParse(a.datum)-dParse(b.datum)); }
function potroseno(g){ const l=troskoviZa(g.id); return l.length ? l.reduce((a,b)=>a+(+b.iznos||0),0) : (g.potroseno||0); }
function subsZa(grId){ return (DATA.podizvodjaci||[]).filter(x=>(x.grs||[]).includes(grId)); }
function timNa(grId){ return DATA.zaposleni.filter(z=>(z.grs||[]).includes(grId)); }
/* 'Petar Kovacevic' -> 'Petar K.'; jednoclano ime ostaje kakvo jeste. */
function kratkoIme(ime){ const d=String(ime||'').trim().split(/\s+/); return d[0]+(d[1]?' '+d[1][0]+'.':''); }

const STATUS = {
  'u toku':   {t:'U toku',     c:'b-blue'},
  'kasni':    {t:'Kasni',      c:'b-red'},
  'zavrseno': {t:'Završeno',   c:'b-green'},
  'planirano':{t:'Planirano',  c:'b-gray'},
};
const EMP_STATUS = {'Na terenu':'b-green','Kancelarija':'b-blue','Odsutan':'b-amber'};
const KOLONE = [
  {id:'todo', naziv:'Za uraditi', k:'var(--faint)'},
  {id:'inprogress', naziv:'U toku', k:'var(--blue)'},
  {id:'hold', naziv:'Na čekanju', k:'var(--amber)'},
  {id:'done', naziv:'Završeno', k:'var(--green)'},
];
const PRIO = {high:{t:'Visok',c:'p-high'}, mid:{t:'Srednji',c:'p-mid'}, low:{t:'Nizak',c:'p-low'}};

function badge(status){ const s=STATUS[status]||{t:esc(status||'\u2014'),c:'b-gray'}; return `<span class="badge ${s.c}">${s.t}</span>`; }
function icon(name){
  const I={
    dash:'<path d="M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z"/>',
    ai:'<path d="M12 3l1.8 4.2L18 9l-4.2 1.8L12 15l-1.8-4.2L6 9l4.2-1.8z"/><path d="M5 16l.9 2.1L8 19l-2.1.9L5 22l-.9-2.1L2 19l2.1-.9z"/>',
    site:'<path d="M3 21h18M5 21V8l7-4 7 4v13M9 21v-6h6v6"/>',
    client:'<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
    emp:'<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8"/>',
    time:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    task:'<path d="M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
    book:'<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20M4 19.5A2.5 2.5 0 0 0 6.5 22H20V2H6.5A2.5 2.5 0 0 0 4 4.5v15z"/>',
    pin:'<path d="M21 10c0 7-9 12-9 12s-9-5-9-12a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>',
    plus:'<path d="M12 5v14M5 12h14"/>',
    search:'<circle cx="11" cy="11" r="8"/><path d="M21 21l-4-4"/>',
    money:'<path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
    warn:'<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4M12 17h.01"/>',
    check:'<path d="M20 6 9 17l-5-5"/>',
    x:'<path d="M18 6 6 18M6 6l12 12"/>',
    print:'<path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v8H6z"/>',
    trend:'<path d="M22 7l-8.5 8.5-5-5L2 17"/><path d="M16 7h6v6"/>',
  };
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${I[name]||''}</svg>`;
}

