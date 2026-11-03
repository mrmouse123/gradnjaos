/* ============================================================
   SLOJ ZA CUVANJE: supabase -> ugradjeno skladiste -> memorija
   ============================================================ */
const SKEY = 'gradnjaos_v3';
const TABLES = ['clijenti','zaposleni','gradilista','dnevnik','situacije','narudzbe','troskovi_st','podizvodjaci','predmer','zadaci','situacija_stavke','resursi','magacin','mag_promene','dokumenti','sifrarnik','rad_na_zadatku'];
/* dokumenti.data (data-URL) NEMA select grant: lista ide iz dokumenti_v (bez data), sadrzaj po kliku
   kroz rpc dokument_podaci(id); insert nosi data, update ga NE salje (v. rowsZa). */
let DATA = JSON.parse(JSON.stringify(DEMO));
let supa=null, mode='memorija', saveTimer=null;
let saving=false, dirty=false, saveErr=null;
let SESIJA=null, PROFIL=null;   // Supabase Auth: sesija i red iz tabele profili (null u demo rezimu)
let PUSHED={};                  // snapshot poslednjeg upisa po tabeli: kljuc reda -> JSON (za diff)
let ZDR_SRV=null;               // rukovodilac: zdravlje po gradilistu sa servera (RPC), direktor: null = lokalna formula

async function initSupa(){
  if(!SUPABASE_URL || !SUPABASE_ANON_KEY) return false;
  try{
    if(!window.supabase){
      await new Promise((res,rej)=>{
        const sc=document.createElement('script');
        /* Pinovana verzija + SRI (isti URL/integrity/crossorigin kao <link rel=preload> u <head>,
           inace se preload ne iskoristi). Bump: promeni verziju NA OBA mesta i preracunaj hash:
           curl -s <url> | openssl dgst -sha384 -binary | openssl base64 -A */
        sc.src='https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/dist/umd/supabase.js';
        sc.integrity='sha384-Rj26LVGvoeRVR6+mwQmFfcR3QOBEwT+ZmuCWpuiqeTzJpCs0ER4ITAWGb4Hiy3Ok';
        sc.crossOrigin='anonymous';
        sc.onload=res; sc.onerror=()=>rej(new Error('CDN nedostupan'));
        document.head.appendChild(sc);
      });
    }
    supa = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    return true;
  }catch(e){ console.error('Supabase init:', e); return false; }
}

/* U JS modelu zaposleni.grs/bivsi i podizvodjaci.grs OSTAJU nizovi (30+ mesta u kodu),
   ali u bazi zive kao join tabele — RLS ne moze da ogranici niz po gradilistu.
   zaposleni_gradiliste.aktivan: true = grs (trenutno), false = bivsi (istorija). */
const JOIN_TABELE=['zaposleni_gradiliste','podizvodjac_gradiliste'];
const PUSH_TABLES=[...TABLES, ...JOIN_TABELE];
/* Rukovodilac cita iz view-ova (finansijske kolone su NULL), pa ih ne sme ni slati
   nazad — server ih svakako drzi trigerom, ovo je da diff ne salje NULL. */
const FIN_KOLONE={gradilista:['budzet','troskovi','potroseno','naplaceno'], predmer:['cena'], podizvodjaci:['cena'], situacije:['iznos']};   // situacije.iznos: migracija 19 (server ga racuna iz stavki)
/* Direktori modula (migracija 27, odluka klijenta 2026-10-14): sva ovlascenja direktora, ali SAMO u svom modulu.
   Modul se IZVODI iz imena uloge (MODUL_ULOGE), ne iz profili.moduli. Server: je_direktor() ih obuhvata,
   modul_dozvoljen()/vodim_gradiliste() ih ogranicava; brisanje smem_brisati(gid); nalozi samo svog modula. */
const MODUL_ULOGE={direktor_projektovanja:'projektovanje', direktor_izvodjenja:'izvodjenje'};
const DIREKTORSKE=['direktor','direktor_projektovanja','direktor_izvodjenja'];   // dodeljuje/menja/uklanja SAMO direktor
function jeUpravaUloga(u){ return u==='direktor'||u==='admin'||!!MODUL_ULOGE[u]; }
function jeRukovodilacNalog(){ return !!(PROFIL && !jeUpravaUloga(PROFIL.uloga)); }   // = nije uprava: skor sa servera, bez pisanja fin kolona
/* Uloge koje aplikacija poznaje (isti skup kao check constraint na profili.uloga). */
const ULOGE=[['direktor','Direktor'],['admin','Admin'],['direktor_projektovanja','Direktor projektovanje'],['direktor_izvodjenja','Direktor izvođenje'],['rukovodilac','Rukovodilac (projektovanje / izvođenje)'],['radnik','Radnik (samo projektovanje)'],['spoljni','Spoljni saradnik']];   // = check constraint profili.uloga (migracija 27); imena = odluka klijenta 2026-10-23; radnik samo projektovanje (migracija 32)
function uredjajTip(){ try{ return window.matchMedia&&window.matchMedia('(max-width:900px)').matches?'mobilni':'desktop'; }catch(e){ return '?'; } }
/* Log koriscenja (migracija 12): append-only tabela VAN PUSH_TABLES (izuzetak od pravila 8 —
   nikad se ne cita u DATA, nikad ne ide kroz diff). Upis je fire-and-forget i ne dira saveErr.
   Server sam belezi uloga_promena / pristup_uklonjen; klijent: prijava, odjava, otvaranje, cuvanje. */
function beleziLog(dogadjaj, detalj){
  if(!supa || !SESIJA) return Promise.resolve();
  const red={ email:(SESIJA.user&&SESIJA.user.email)||null, uloga:PROFIL?PROFIL.uloga:null, dogadjaj, detalj:detalj||{} };
  try{ return Promise.resolve(supa.from('log_koriscenja').insert(red)).then(r=>{ if(r&&r.error) console.warn('log:', r.error.message||r.error); }, e=>console.warn('log:', e)); }
  catch(e){ console.warn('log:', e); return Promise.resolve(); }
}
function bezKolona(r,keys){ const o={...r}; keys.forEach(k=>delete o[k]); return o; }
function rowsZa(t,d){
  const ruk=jeRukovodilacNalog();
  if(t==='gradilista' && ruk) return (d.gradilista||[]).map(g=>bezKolona(g,FIN_KOLONE.gradilista));
  if(t==='predmer' && ruk) return (d.predmer||[]).map(x=>bezKolona(x,FIN_KOLONE.predmer));
  if(t==='zaposleni') return (d.zaposleni||[]).map(z=>{ const r={...z}; delete r.grs; delete r.bivsi; return r; });
  if(t==='podizvodjaci') return (d.podizvodjaci||[]).map(x=>{ const r={...x}; delete r.grs; return ruk?bezKolona(r,FIN_KOLONE.podizvodjaci):r; });
  if(t==='zaposleni_gradiliste') return (d.zaposleni||[]).flatMap(z=>{ const g=z.grs||[];
    return [...g.map(x=>({zaposleni_id:z.id, gradiliste_id:x, aktivan:true})),
            ...(z.bivsi||[]).filter(x=>!g.includes(x)).map(x=>({zaposleni_id:z.id, gradiliste_id:x, aktivan:false}))]; });
  if(t==='podizvodjac_gradiliste') return (d.podizvodjaci||[]).flatMap(x=>(x.grs||[]).map(g=>({podizvodjac_id:x.id, gradiliste_id:g})));
  return d[t]||[];
}
function kljucReda(t,r){
  return t==='zaposleni_gradiliste' ? r.zaposleni_id+'|'+r.gradiliste_id
       : t==='podizvodjac_gradiliste' ? r.podizvodjac_id+'|'+r.gradiliste_id : r.id;
}
/* Iz redova join tabela rekonstruise nizove u JS modelu, pa ih uklanja iz out. */
function spojiJoinTabele(out){
  const zg=out.zaposleni_gradiliste||[], pg=out.podizvodjac_gradiliste||[];
  (out.zaposleni||[]).forEach(z=>{
    z.grs=zg.filter(r=>r.zaposleni_id===z.id&&r.aktivan).map(r=>r.gradiliste_id);
    z.bivsi=zg.filter(r=>r.zaposleni_id===z.id&&!r.aktivan).map(r=>r.gradiliste_id);
  });
  (out.podizvodjaci||[]).forEach(x=>{ x.grs=pg.filter(r=>r.podizvodjac_id===x.id).map(r=>r.gradiliste_id); });
  delete out.zaposleni_gradiliste; delete out.podizvodjac_gradiliste;
}
function zapamtiSnapshot(d){
  PUSHED={};
  for(const t of PUSH_TABLES){ const m={}; rowsZa(t,d).forEach(r=>m[kljucReda(t,r)]=JSON.stringify(r)); PUSHED[t]=m; }
}
/* Citanje ide iz view-ova: isti redovi kao tabela (isto pravilo kao RLS), ali finansijske
   kolone su NULL osim direktoru — na samim tabelama te kolone NEMAJU select grant.
   Pisanje ide u tabele. */
const CITAJ_IZ={gradilista:'gradilista_v', predmer:'predmer_v', podizvodjaci:'podizvodjaci_v', dokumenti:'dokumenti_v', situacije:'situacije_v'};
const FIN_TABELE=['troskovi_st'];   // rukovodiocu server ne daje ni jedan red — ne trazimo ih (situacije od migracije 19 idu kroz situacije_v, iznos = null bez finansija)
/* Rukovodilac nema finansijske redove, pa zdravlje(g) ne moze da racuna lokalno —
   skor dolazi sa servera (zdravlje_gradilista = ista formula). Jedan poziv za sva gradilista. */
async function osveziZdravlje(rerender){
  if(!supa || !jeRukovodilacNalog()) return;
  try{
    const {data,error}=await supa.rpc('zdravlja_mojih');
    if(error) throw new Error(error.message||String(error));
    const novi={}; let napPromena=false;
    (data||[]).forEach(r=>{ if(!r||r.id==null) return; novi[r.id]=r.zdravlje;
      /* napredak racuna server (trigger na predmer); preuzmi ga i uskladi snapshot da diff ne salje isti broj nazad */
      const g=grById[r.id]; if(g && r.napredak!=null && g.napredak!==r.napredak){ g.napredak=r.napredak; napPromena=true;
        const red=rowsZa('gradilista',DATA).find(x=>x.id===g.id); if(red && PUSHED.gradilista) PUSHED.gradilista[g.id]=JSON.stringify(red); } });
    const promena=napPromena || JSON.stringify(novi)!==JSON.stringify(ZDR_SRV||{});
    ZDR_SRV=novi;
    if(rerender && promena) render();
  }catch(e){ console.error('zdravlja_mojih:', e); }
}
async function pushAll(d, opt){
  opt=opt||{};
  /* DIFF po redu: ide samo ono sto se promenilo od poslednjeg upisa. Pod RLS-om
     rukovodilac ne sme ni da pokusa upsert tudjih/direktorskih redova (greska),
     a usput nestaje "cela baza + base64 prilozi na svaki klik".
     Ne prekidamo na prvoj gresci — jedan los red ne sme da zaustavi ostale tabele. */
  const greske=[], poslato={};   // poslato: tabela -> broj uspesno upisanih redova (za log koriscenja)
  for(const t of (opt.samo||PUSH_TABLES)){
    const rows=rowsZa(t,d), prev=PUSHED[t]||{};
    const izmenjeni = opt.sve ? rows : rows.filter(r=>prev[kljucReda(t,r)]!==JSON.stringify(r));
    if(!izmenjeni.length) continue;
    /* PUSHED se belezi PO USPELOM ZAHTEVU, ne po tabeli: ako insert prodje a kasniji
       update padne, ubaceni redovi ne smeju sledeci put ponovo kao INSERT (23505). */
    const nx={...prev};
    const posalji=async(q, poslati)=>{ const {error}=await q; if(error) throw new Error(error.message||String(error)); poslati.forEach(r=>nx[kljucReda(t,r)]=JSON.stringify(r)); poslato[t]=(poslato[t]||0)+poslati.length; };
    const filtriraj=(q,r)=> t==='zaposleni_gradiliste' ? q.eq('zaposleni_id',r.zaposleni_id).eq('gradiliste_id',r.gradiliste_id)
                        : t==='podizvodjac_gradiliste' ? q.eq('podizvodjac_id',r.podizvodjac_id).eq('gradiliste_id',r.gradiliste_id)
                        : q.eq('id',r.id);
    try{
      /* Upsert = INSERT…ON CONFLICT DO UPDATE SET col=excluded.col; citanje excluded.<fin>
         trazi SELECT na finansijskoj koloni, koji je ukinut (migracija 11) → 42501 i za
         direktora (provereno na bazi 2026-10-03). Zato tabele sa FIN_KOLONE NIKAD upsert.
         Podela novi/stari se oslanja na to da je PUSHED = trenutno stanje baze (snapshot
         posle loadState; u resetDemo se zapamtiSnapshot zove tek POSLE upisa — ne pomerati). */
      if(opt.sve && !FIN_KOLONE[t]){ await posalji(supa.from(t).upsert(izmenjeni), izmenjeni); }
      else {
        /* postojeci -> UPDATE (upsert bi pao na INSERT WITH CHECK za rukovodioca), novi -> INSERT */
        const novi=izmenjeni.filter(r=>!(kljucReda(t,r) in prev)), stari=izmenjeni.filter(r=>kljucReda(t,r) in prev);
        if(novi.length) await posalji(supa.from(t).insert(novi), novi);
        /* dokumenti: update nikad ne salje data (2.5 MB po kliku; posle reload-a kljuc ni ne postoji) */
        const azuriraj=r=>{ const u = t==='dokumenti' ? (({data,...o})=>o)(r) : r; return posalji(filtriraj(supa.from(t).update(u),r), [r]); };
        if(opt.sve) await Promise.all(stari.map(azuriraj));      // seed/reset: nezavisni redovi, paralelno
        else for(const r of stari) await azuriraj(r);            // redovno cuvanje: redom, prva greska staje
      }
    }catch(e){ greske.push(t+': '+(e.message||e)); }
    finally{ PUSHED[t]=nx; }
  }
  if(greske.length) throw new Error(greske.join(' | '));
  return poslato;
}

/* Brisanje reda je EKSPLICITNA operacija, ne posledica diff-a.
   (Diff-brisanje bi u vise-korisnickom radu obrisalo tudje redove.) */
/* Brisanje: PRVO server (RLS: super, ili radnik svoj dnevnik/dokument), pa lokalno — ako server
   odbije, red ostaje i korisnik dobija poruku (ranije je saveErr brisao sledeci doSave, pa je
   red "nestajao" do refresha). Svako brisanje ide u log koriscenja. Vraca true/false. */
async function obrisiRed(tabela, id, opis){
  const list=DATA[tabela]; if(!Array.isArray(list)) return false;
  const i=list.findIndex(r=>r.id===id); if(i<0) return false;
  if(mode==='supabase'){
    try{ const {error}=await supa.from(tabela).delete().eq('id',id); if(error) throw new Error(error.message||String(error)); }
    catch(e){ console.error('Supabase delete:', e); alert('Brisanje nije uspelo: '+(e.message||e)); return false; }
  }
  list.splice(i,1);
  if(PUSHED[tabela]) delete PUSHED[tabela][id];
  beleziLog('brisanje',{tabela, id, naziv:opis||''});
  rebuildMaps(); saveState(); updateFoot();
  return true;
}

async function loadState(){
  if(supa){
    try{
      const out={};
      const ruk=jeRukovodilacNalog();
      /* Sve tabele odjednom (HTTP/2): serijski je bilo ~200 ms x 16 = 3 s po prijavi. */
      const poslovi = PUSH_TABLES.map(async t=>{
        if(!canFinance() && FIN_TABELE.includes(t)){ out[t]=[]; return; }   // bez finansija server ne daje ni jedan red
        const q=supa.from(CITAJ_IZ[t]||t).select('*');
        const {data,error}=await (JOIN_TABELE.includes(t) ? q : q.order('id'));
        if(error) throw new Error(t+': '+(error.message||error));
        out[t]=data||[];
      });
      if(ruk) poslovi.push(osveziZdravlje(false));
      await Promise.all(poslovi);
      /* "Prazna baza" se gleda po SVIM tabelama, ne samo po gradilistima. */
      const praznaBaza = TABLES.every(t=>!(out[t]||[]).length);
      if(praznaBaza){
        if(PROFIL && PROFIL.uloga!=='direktor') throw new Error('Baza je prazna — demo podatke moze da zaseje samo direktor.');
        normalizeData(); await pushAll(DATA, {sve:true});   // prvi start: zasej demo
      } else { spojiJoinTabele(out); DATA=out; }
      mode='supabase'; updateFoot(); return;
    }catch(e){
      console.error('Supabase load:', e);
      alert('Ne mogu da ucitam podatke iz Supabase — radim u demo rezimu (izmene se NE cuvaju).\n\nProveri na supabase.com -> projekat "gradnjaos" da li je baza aktivna (status Healthy), pa osvezi stranicu.\n\nAko to nije, proveri URL/kljuc i da li je schema.sql pokrenut.');
    }
  }
  try{
    if(typeof window!=='undefined' && window.storage){
      try{
        const r=await window.storage.get(SKEY);
        if(r&&r.value){ const st=JSON.parse(r.value); if(st&&st.gradilista) DATA=st; }
      }catch(e){ /* kljuc jos ne postoji */ }
      mode='skladiste';
    }
  }catch(e){}
  updateFoot();
}

function saveState(){ clearTimeout(saveTimer); saveTimer=setTimeout(doSave,400); }
let saveTok=null;   // obecanje upisa u toku — odjava ga ceka
function doSave(){
  /* pushAll je 13 uzastopnih HTTP poziva; bez ovog guarda dva preklopljena
     upisa mogu da vrate stariji snapshot preko novijeg. */
  if(saving){ dirty=true; return saveTok; }
  saving=true;
  saveTok=(async()=>{
    try{
      if(mode==='supabase'){ const p=await pushAll(JSON.parse(JSON.stringify(DATA))); saveErr=null; if(p&&Object.keys(p).length) beleziLog('cuvanje',p); await osveziZdravlje(true); }
      else if(mode==='skladiste'){ await window.storage.set(SKEY, JSON.stringify(DATA)); saveErr=null; }
    }catch(e){
      saveErr=e.message||String(e);
      console.error('Cuvanje nije uspelo:', e);
    }finally{
      saving=false; updateFoot();
      if(dirty){ dirty=false; doSave(); }
    }
  })();
  return saveTok;
}
/* Poslednja izmena unutar debounce prozora se gubila pri zatvaranju taba. */
function flushSave(){ if(saveTimer){ clearTimeout(saveTimer); saveTimer=null; doSave(); } }
/* Sacuvaj SVE sto ceka (debounce + upis u toku + ono sto je stiglo za vreme upisa) — za odjavu. */
async function sacuvajSve(){
  clearTimeout(saveTimer); saveTimer=null;
  do{ await doSave(); }while(saving||dirty);
}
if(typeof window!=='undefined' && window.addEventListener){
  window.addEventListener('pagehide', flushSave);
  document.addEventListener('visibilitychange', ()=>{ if(document.hidden) flushSave(); });
}

async function resetDemo(){
  if(mode==='supabase' && PROFIL && PROFIL.uloga!=='direktor'){ alert('Demo podatke moze da vrati samo direktor.'); return; }
  if(!confirm('Vratiti sve podatke na pocetni demo? Tvoje izmene ce biti obrisane.')) return;
  if(mode==='supabase'){
    /* Prvo upisi demo, pa tek onda pobrisi visak. Raniji redosled (obrisi sve ->
       upisi) je pri padu upisa ostavljao praznu bazu bez ikakvog povratka. */
    const novi=JSON.parse(JSON.stringify(DEMO));
    try{
      DATA=novi; normalizeData();
      await pushAll(DATA, {sve:true});
      const zadrzi={}; TABLES.forEach(t=>zadrzi[t]=new Set((DATA[t]||[]).map(r=>r.id)));
      for(const t of TABLES){
        const ids=[...zadrzi[t]];
        const q=supa.from(t).delete();
        const {error} = ids.length ? await q.not('id','in','("'+ids.join('","')+'")') : await q.neq('id','');
        if(error) throw new Error(error.message||String(error));
      }
      /* Join tabele nemaju id: obrisi sve pa upisi demo veze (jeftino za rekonstrukciju). */
      for(const t of JOIN_TABELE){
        const col = t==='zaposleni_gradiliste' ? 'zaposleni_id' : 'podizvodjac_id';
        const {error}=await supa.from(t).delete().neq(col,''); if(error) throw new Error(error.message||String(error));
      }
      await pushAll(DATA, {sve:true, samo:JOIN_TABELE});
      zapamtiSnapshot(DATA);
      saveErr=null;
    }catch(e){ console.error('Supabase reset:', e); saveErr='reset: '+(e.message||e); alert('Reset nije uspeo u potpunosti — proveri podnozje i konzolu.'); }
  } else {
    DATA=JSON.parse(JSON.stringify(DEMO));
    normalizeData();
    if(mode==='skladiste'){ try{ await window.storage.delete(SKEY); }catch(e){} }
  }
  rebuildMaps(); renderNav(); render();
}

function updateFoot(){
  const el=document.getElementById('sideFoot'); if(!el) return;
  if(saveErr){
    el.innerHTML='<span class="dot mem"></span> <b>Poslednje cuvanje NIJE uspelo</b><br>'
      +'<span style="opacity:.7">'+esc(saveErr.slice(0,140))+'</span>'
      +'<br><button class="reset" onclick="doSave()">\u21bb Pokusaj ponovo</button>';
    return;
  }
  const msg={
    supabase:'<span class="dot"></span> Baza: <b>Supabase</b> — izmene se cuvaju u bazi',
    skladiste:'<span class="dot"></span> Cuvanje: <b>aktivno</b> — izmene ostaju',
    memorija:'<span class="dot mem"></span> Cuvanje: <b>u memoriji</b><br><span style="opacity:.7">Za trajno cuvanje poveži Supabase (README)</span>'
  }[mode];
  const smeReset = !PROFIL || PROFIL.uloga==='direktor';
  const ver=verzijaTekst();
  el.innerHTML=msg+(smeReset?'<br><button class="reset" onclick="resetDemo()">↺ Vrati demo podatke</button>':'')+(ver?'<br><span style="opacity:.55;font-size:10.5px">verzija od '+ver+'</span>':'');
}

/* mape (rebuild posle svake izmene) */
let cliById={}, zapById={}, grById={};
function rebuildMaps(){
  cliById = Object.fromEntries(DATA.clijenti.map(c=>[c.id,c]));
  zapById = Object.fromEntries(DATA.zaposleni.map(z=>[z.id,z]));
  grById  = Object.fromEntries(DATA.gradilista.map(g=>[g.id,g]));
}

/* "Danas" je ZIV: tab otvoren preko noci (telefon) je ranije zauvek pokazivao datum
   ucitavanja — u zaglavlju, u Rokovima ("danas" linija), u "kasni X dana" i, najgore,
   u todayStr() koji je datum NOVIH unosa. Osvezava se pri svakom render(), kad se
   tab vrati u prvi plan i tacno u ponoc. Identifikator TODAY ostaje (30 mesta). */
function danasDatum(){ const d=new Date(); d.setHours(0,0,0,0); return d; }
let TODAY=danasDatum();
function osveziDanas(){ const d=danasDatum(); if(d.getTime()!==TODAY.getTime()){ TODAY=d; return true; } return false; }
function zakaziPonoc(){
  const sad=new Date(), ponoc=new Date(sad); ponoc.setHours(24,0,5,0);   // 5 s posle ponoci
  setTimeout(()=>{ if(osveziDanas() && typeof render==='function'){ try{ renderNav(); render(); }catch(e){} } zakaziPonoc(); }, Math.max(1000, ponoc-sad));
}
if(typeof window!=='undefined' && window.addEventListener){
  zakaziPonoc();
  const naPovratak=()=>{ if(!document.hidden && osveziDanas()){ try{ renderNav(); render(); }catch(e){} } };
  document.addEventListener('visibilitychange', naPovratak);
  window.addEventListener('focus', naPovratak);
}
const _iso=d=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
const todayStr=()=>_iso(TODAY);
const plusDays=n=>{const d=new Date(TODAY); d.setDate(d.getDate()+n); return _iso(d);};
const MESECI = ['jan','feb','mar','apr','maj','jun','jul','avg','sep','okt','nov','dec'];
const MESECI_PUN = ['januar','februar','mart','april','maj','jun','jul','avgust','septembar','oktobar','novembar','decembar'];

