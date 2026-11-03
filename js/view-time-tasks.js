/* ---------- ROKOVI (GANTT) ---------- */
/* Gantt na telefonu: osa pocinje od najstarijeg projekta, pa je "danas" van ekrana —
   posle rendera skroluj tako da je danasnja linija na ~1/3 vidljive sirine. */
function skrolujNaDanas(){
  const g=document.querySelector('.gantt'), t=document.querySelector('.g-today');
  if(!g||!t||typeof g.getBoundingClientRect!=='function') return;
  const gr=g.getBoundingClientRect(), tr=t.getBoundingClientRect();
  const labW=parseFloat(getComputedStyle(document.querySelector('.gantt-inner')).getPropertyValue('--g-lab'))||200;
  const vidljivo=gr.width-labW;
  if(vidljivo<=0) return;
  const cilj=(tr.left-gr.left)+g.scrollLeft-labW-vidljivo*0.35;
  g.scrollLeft=Math.max(0,cilj);
}
function viewTime(){
  const vs=visibleSites();
  if(!vs.length) return head('Rokovi','Vremenska osa projekata.')+'<div class="card"><div class="empty">Nema projekata za prikaz.</div></div>';
  const allD=vs.flatMap(g=>[dParse(g.pocetak),dParse(g.rok)]).concat([TODAY]);
  const minD=new Date(Math.min(...allD.map(d=>+d))), maxD=new Date(Math.max(...allD.map(d=>+d)));
  const start=new Date(minD.getFullYear(),minD.getMonth(),1), end=new Date(maxD.getFullYear(),maxD.getMonth()+2,1);
  const totalMs=end-start;
  const months=[]; let cur=new Date(start);
  while(cur<end){ months.push(new Date(cur)); cur.setMonth(cur.getMonth()+1); }
  const colTmpl=`repeat(${months.length},minmax(0,1fr))`;   /* minmax(0,…): kolona ne sme da raste na min-content teksta */
  const innerW=`min-width:max(var(--g-min), calc(var(--g-lab) + ${months.length} * var(--g-col)))`;
  const monHead=months.map(m=>`<div class="gm">${MESECI[m.getMonth()]}${m.getMonth()===0?" '"+String(m.getFullYear()).slice(2):''}</div>`).join('');
  const gridSpans=months.map(()=>'<span></span>').join('');
  const todayLeft=((TODAY-start)/totalMs*100);

  const rows=[...visibleSites()].sort((a,b)=>dParse(a.pocetak)-dParse(b.pocetak)).map(g=>{
    const s=dParse(g.pocetak), e=dParse(g.rok);
    let left=(s-start)/totalMs*100, width=(e-s)/totalMs*100;
    left=Math.max(0,Math.min(98,left)); width=Math.max(2,Math.min(100-left,width));
    const cls=g.status==='zavrseno'?'done':g.status==='kasni'?'late':g.status==='planirano'?'plan':'';
    const cl=cliById[g.klijent];
    return `<div class="g-row">
      <div class="g-lab"><div class="nm">${g.naziv.length>26?g.naziv.slice(0,25)+'…':g.naziv}</div><div class="cl">${cl?cl.naziv:''}</div></div>
      <div class="g-track">
        <div class="g-grid" style="grid-template-columns:${colTmpl}">${gridSpans}</div>
        <div class="g-bar ${cls}" style="left:${left}%; width:${width}%" title="${g.naziv} · ${g.napredak}%">
          <div class="fill" style="width:${g.napredak}%"></div>
          <span class="lbl">${g.napredak}%</span>
        </div>
      </div>
    </div>`;
  }).join('');

  return head('Rokovi','Vremenska osa svih projekata sa trenutnim napretkom (Gantt).') +
  `<div class="card">
    <div class="legend">
      <span><i style="background:var(--blue)"></i>U toku</span>
      <span><i style="background:var(--red)"></i>Kasni</span>
      <span><i style="background:var(--green)"></i>Završeno</span>
      <span><i style="background:var(--faint)"></i>Planirano</span>
      <span style="margin-left:auto"><i style="background:var(--amber)"></i>Današnji datum</span>
      <button class="btn ghost" style="padding:4px 10px;font-size:11.5px;min-height:0" onclick="skrolujNaDanas()">⟶ Danas</button>
    </div>
    <div class="gantt"><div class="gantt-inner" style="${innerW}">
      <div class="g-head">
        <div class="g-lab-h" style="padding:9px 14px;font-size:11px;color:var(--faint);text-transform:uppercase;letter-spacing:.05em;font-weight:600">Projekat</div>
        <div class="g-months" style="grid-template-columns:${colTmpl}">${monHead}</div>
      </div>
      <div style="position:relative">
        <div class="g-today" data-d="danas ${TODAY.getDate()}.${TODAY.getMonth()+1}." style="left:calc(var(--g-lab) + (100% - var(--g-lab)) * ${todayLeft/100})" title="${fmtDate(todayStr())}"></div>
        ${rows}
      </div>
    </div></div>
  </div>`;
}

/* ---------- ZADACI (KANBAN) ---------- */
function viewTasks(){
  const ids=visibleSiteIds();
  const cols=KOLONE.map(col=>{
    const items=zadaciVidljivi().filter(t=>t.kol===col.id);
    const cards=items.map(t=>{
      const g=grById[t.gr], z=zapById[t.zad], p=PRIO[t.prio];
      const dd=dParse(t.rok), diff=daysBetween(TODAY,dd);
      const rokTxt = t.kol==='done' ? 'Završeno'
        : diff<0 ? `<span style="color:var(--red);font-weight:600">Kasni ${Math.abs(diff)}d</span>`
        : diff===0 ? `<span style="color:var(--amber);font-weight:600">Danas</span>`
        : `${dd.getDate()}. ${MESECI[dd.getMonth()]}`;
      return `<div class="task" draggable="true" ondragstart="dragStart(event,'${t.id}')" onclick="openSite('${t.gr}')">
        <div class="t">${t.naziv}</div>
        ${t.opis?`<div style="font-size:12px;color:var(--muted);margin:-4px 0 8px;white-space:pre-line">${t.opis}</div>`:''}
        <div class="site">${icon('pin')} ${g?(g.naziv.length>28?g.naziv.slice(0,27)+'…':g.naziv):''}</div>
        <div class="tf">
          <div class="who2"><div class="av av-s">${z?initials(z.ime):'?'}</div>${z?z.ime.split(' ')[0]:''}</div>
          <span class="prio ${p.c}">${p.t}</span>
          ${smemBrisati(t.gr)?BRISI_DUGME('obrisiZadatak',t.id):''}
        </div>
        <div style="font-size:11.5px;color:var(--muted);margin-top:8px">🗓 ${rokTxt}</div>
        ${tajmerLinija(t)}
      </div>`;
    }).join('') || `<div style="text-align:center;color:var(--faint);font-size:12px;padding:18px 0">Prevuci zadatak ovde</div>`;
    return `<div class="col" ondragover="event.preventDefault()" ondrop="dropTask(event,'${col.id}')">
      <div class="col-h"><span class="k" style="background:${col.k}"></span>${col.naziv}<span class="cnt num">${items.length}</span></div>
      ${cards}
    </div>`;
  }).join('');
  return head('Zadaci','Tabla zadataka po statusu — prevuci karticu da promeniš status.') +
  `<div class="tools">
    ${mogaDaUpravljam()?`<button class="btn" onclick="formTask()">${icon('plus')} Novi zadatak</button>`:'<span class="sub">Zadatke dodeljuje rukovodilac — svoje možeš da pomeraš.</span>'}
  </div>
  <div class="kanban">${cols}</div>`;
}
let dragId=null;
function dragStart(e,id){ dragId=id; e.dataTransfer.effectAllowed='move'; }
function dropTask(e,col){
  e.preventDefault();
  const id=dragId; dragId=null;
  if(!id || !KOLONE.some(k=>k.id===col)) return;
  const t=DATA.zadaci.find(x=>x.id===id);
  if(!t || !(smemNa(t.gr) || (vidimGr(t.gr) && t.zad===ROLE))) return;   // radnik: samo svoj zadatak (server: trigger pusta samo kol)
  const staroKol=t.kol; t.kol=col; uskladiSveskuIzZadatka(t, staroKol);
  if(col==='done'){ const s=otvorenaSesija(id, osobaTajmera()); if(s){ zatvoriSesiju(s); beleziLog('zadatak_kraj',{zadatak:id, naziv:unesc(t.naziv), opis:unesc(t.opis||''), gr:t.gr, minuta:s.minuta, ukupno:minutaZadatka(id)}); } }   // da sesija ne ostane otvorena bez dugmeta
  saveState(); render();
}

/* ---------- TAJMER ZADATKA (C4) + ANGAZOVANOST (C5) ----------
   Sesije u DATA.rad_na_zadatku; start/kraj su ISO (timestamptz). Minute na serveru racuna trigger iz start/kraj
   (klijentova procena je samo za prikaz do prvog osvezavanja). Uprava belezi kao osoba 'uprava'. */
/* Auto-pauza zaboravljenog tajmera (2026-10-22, zahtev klijenta): sesija se sama zatvara u 16:00 na dan pocetka
   (ako je pocela u 16:00 ili kasnije — u ponoc tog dana). ZATVARA je SAMO server (pg_cron svakih 15 min,
   auto_pauza_tajmera, migracija 31; kraj zatvorene sesije je nepromenljiv). Klijent takvu sesiju samo TRETIRA kao
   zatvorenu: sesijaOtvorena() umesto !s.kraj svuda, minSesije() odseca na granici — pa dugme postaje „▶ Nastavi“,
   angazovanost ne raste i nijedan klijent nikad ne salje kraj posle granice. Sat je na DVA mesta (ovde i u SQL
   funkciji granica_auto_pauze) — menjati oba. Demo rezim (bez baze) nema cron: red ostaje bez kraja, ali se prikazuje odseceno. */
const AUTO_PAUZA_SAT=16;
function granicaAutoPauze(start){ const d=new Date(start), g=new Date(d); g.setHours(AUTO_PAUZA_SAT,0,0,0); if(g<=d) g.setHours(24,0,0,0); return g; }   // po satu uredjaja (pravilo 10); server po Beogradu
function sesijaOtvorena(s){ return !s.kraj && Date.now() < granicaAutoPauze(s.start).getTime(); }
function radZa(zadatakId){ return (DATA.rad_na_zadatku||[]).filter(s=>s.zadatak===zadatakId); }
function mojaOtvorenaSesija(){ const o=osobaTajmera(); return (DATA.rad_na_zadatku||[]).find(s=>s.osoba===o && sesijaOtvorena(s))||null; }   // jedan zadatak u isto vreme (odluka 2026-10-12)
function otvorenaSesija(zadatakId, osoba){ return (DATA.rad_na_zadatku||[]).find(s=>s.zadatak===zadatakId && s.osoba===osoba && sesijaOtvorena(s))||null; }
function minSesije(s){ if(s.kraj) return s.minuta!=null?s.minuta:Math.max(0,Math.floor((new Date(s.kraj)-new Date(s.start))/60000)); const kraj=Math.min(Date.now(), granicaAutoPauze(s.start).getTime()); return Math.max(0,Math.floor((kraj-new Date(s.start))/60000)); }
function minutaZadatka(zadatakId){ return radZa(zadatakId).reduce((a,s)=>a+minSesije(s),0); }
function fmtTrajanje(min){ min=Math.max(0,Math.round(+min||0)); const h=Math.floor(min/60), m=min%60; return h?(h+' h'+(m?' '+m+' min':'')):(m+' min'); }
function hhmm(iso){ const d=new Date(iso); return String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0'); }
function lokalniDatum(iso){ const d=new Date(iso); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
function osobaTajmera(){ return ROLE==='all'?'uprava':ROLE; }
function imeTajmera(o){ return o==='uprava'?'Uprava':osobaIme(o); }
/* Tajmer SAMO u Projektovanju (odluka 2026-10-10): na gradilistima Izvodjenja nema dugmadi, a funkcije su no-op. */
function tajmerZa(t){ const g=t&&grById[t.gr]; return !!g && jePro(g); }
function mogaTajmer(t){ return tajmerZa(t) && vidimGr(t.gr) && (t.zad===ROLE || smemNa(t.gr)); }
function pocniZadatak(id){
  const t=DATA.zadaci.find(x=>x.id===id); if(!mogaTajmer(t)) return;
  const osoba=osobaTajmera();
  let otv=mojaOtvorenaSesija();
  if(otv){ const ot=DATA.zadaci.find(x=>x.id===otv.zadatak);
    if(!ot || !zadatakPro(ot)){ zatvoriSesiju(otv); beleziLog('zadatak_pauza',{zadatak:otv.zadatak, naziv:ot?unesc(ot.naziv):otv.zadatak, gr:otv.gr, minuta:otv.minuta, auto:true}); otv=null; }   // zaglavljena sesija na zadatku koji vise nije vidljiv (Izvodjenje) — zatvori je umesto da blokira
    else { alert('Već imaš započet zadatak: '+unesc(ot.naziv)+'. Prvo ga pauziraj ili završi.'); return; } }
  DATA.rad_na_zadatku.push({id:'rz'+Date.now(), zadatak:id, gr:t.gr, osoba, start:new Date().toISOString(), kraj:null, minuta:null, napomena:''});
  if(t.kol==='todo') t.kol='inprogress';
  beleziLog('zadatak_start',{zadatak:id, naziv:unesc(t.naziv), opis:unesc(t.opis||''), gr:t.gr});
  saveState(); render(); osveziFioku(t.gr);
}
function zatvoriSesiju(s){ s.kraj=new Date().toISOString(); s.minuta=Math.max(0,Math.floor((new Date(s.kraj)-new Date(s.start))/60000)); }   // procena; server prepisuje (trigger)
/* Pauza: zatvara SVOJU otvorenu sesiju, zadatak ostaje "u toku"; "Nastavi" otvara novu sesiju (pocniZadatak). */
function pauzirajZadatak(id){
  const t=DATA.zadaci.find(x=>x.id===id); if(!t||!vidimGr(t.gr)) return;
  const s=otvorenaSesija(id, osobaTajmera()); if(!s) return;   // vlasnistvo = SVOJA otvorena sesija (i na Izvodjenju / done zadatku — da se ne zaglavi)
  zatvoriSesiju(s);
  beleziLog('zadatak_pauza',{zadatak:id, naziv:unesc(t.naziv), opis:unesc(t.opis||''), gr:t.gr, minuta:s.minuta});
  saveState(); render(); osveziFioku(t.gr);
}
/* Zavrsi: zatvara svoju sesiju (ako je otvorena) i prebacuje zadatak u "Završeno" — bez potvrde (za „samo stani" postoji Pauziraj).
   Bez svoje sesije dozvoljeno samo za zadatak u toku (nastavljen posle pauze); tudja otvorena sesija blokira. */
function zavrsiZadatak(id){
  const t=DATA.zadaci.find(x=>x.id===id); if(!mogaTajmer(t)) return;
  const s=otvorenaSesija(id, osobaTajmera());
  if(!s && t.kol!=='inprogress') return;
  const tuda=radZa(id).find(x=>sesijaOtvorena(x) && x.osoba!==osobaTajmera());
  if(tuda){ alert(imeTajmera(tuda.osoba)+' još radi na ovom zadatku — ne može se završiti dok ne stane.'); return; }
  if(s) zatvoriSesiju(s);
  const staroKol=t.kol; t.kol='done'; uskladiSveskuIzZadatka(t, staroKol);
  beleziLog('zadatak_kraj',{zadatak:id, naziv:unesc(t.naziv), opis:unesc(t.opis||''), gr:t.gr, minuta:s?s.minuta:0, ukupno:minutaZadatka(id)});
  saveState(); render(); osveziFioku(t.gr);
}
/* sesije -> [{osoba,gr,sesija,minuta,poslednji}] za period [od,do] (YYYY-MM-DD, ukljucivo); otvorena sesija se racuna do sada */
function agregirajAngazovanost(rows, od, do_){
  const a=new Date(od+'T00:00:00'), b=new Date(new Date(do_+'T00:00:00').getTime()+86400000);
  const agg={};
  (rows||[]).forEach(r=>{ const s=new Date(r.start); if(s<a || s>=b) return;
    const k=r.osoba+'|'+r.gr, x=agg[k]=agg[k]||{osoba:r.osoba, gr:r.gr, sesija:0, minuta:0, poslednji:null};
    x.sesija++; x.minuta+=minSesije(r); const p=r.kraj||r.start; if(!x.poslednji || new Date(p)>new Date(x.poslednji)) x.poslednji=p; });
  return Object.values(agg).sort((x,y)=>(x.osoba+x.gr).localeCompare(y.osoba+y.gr));
}
function tajmerLinija(t){
  const moja=otvorenaSesija(t.id, osobaTajmera());
  if(!tajmerZa(t) && !moja) return '';   // Izvodjenje: nista — osim ako imam zaglavljenu (nasledjenu) sesiju, nju moram moci da zaustavim
  const ses=radZa(t.id), tot=minutaZadatka(t.id);
  const moze=mogaTajmer(t) && t.kol!=='done';
  const tuda=ses.find(s=>sesijaOtvorena(s) && s.osoba!==osobaTajmera());
  const B=(fn,txt,ghost)=>`<button class="btn${ghost?' ghost':''}" style="flex:1;min-height:38px;padding:6px 8px" onclick="event.stopPropagation();${fn}('${t.id}')">${txt}</button>`;
  const uToku=t.kol==='inprogress', mojeSesije=ses.some(s=>s.osoba===osobaTajmera());
  const drugaRaw=moja?null:mojaOtvorenaSesija(), drugiZad=drugaRaw?(DATA.zadaci||[]).find(x=>x.id===drugaRaw.zadatak):null;
  const druga=drugaRaw&&drugiZad&&zadatakPro(drugiZad)?drugaRaw:null;   // vec radim na DRUGOM zadatku Projektovanja: ovde nema ▶ (play samo na jednom). Zaglavljena sesija na nevidljivom/Izvodjenje zadatku NE blokira — ▶ ostaje, pocniZadatak je sam zatvori (izlaz iz T36 0)
  const drugiNaziv=druga?drugiZad.naziv:'';
  const dugme = moja
    ? `<div style="display:flex;gap:6px;margin-top:8px">${B('pauzirajZadatak', moze?'⏸ Pauziraj':'⏸ Zaustavi tajmer',1)}${moze?B('zavrsiZadatak','■ Završi zadatak'):''}</div><div style="font-size:11.5px;color:var(--muted);margin-top:4px">⏱ radi od ${hhmm(moja.start)} · ${fmtTrajanje(minSesije(moja))}</div>`
    : !moze ? ''
    : druga ? `<div style="font-size:11.5px;color:var(--amber);margin-top:8px">⏱ Radiš na: <b>${drugiNaziv}</b> — pauziraj ga da bi počeo ovaj.</div>${uToku?`<div style="display:flex;gap:6px;margin-top:6px">${B('zavrsiZadatak','■ Završi zadatak')}</div>`:''}`
    : `<div style="display:flex;gap:6px;margin-top:8px">${B('pocniZadatak', uToku&&mojeSesije?'▶ Nastavi':'▶ Počni zadatak',1)}${uToku?B('zavrsiZadatak','■ Završi zadatak'):''}</div>`;
  const info = (tot>0||tuda) ? `<div style="font-size:11.5px;color:var(--muted);margin-top:4px">${tot>0?'⏱ ukupno '+fmtTrajanje(tot):''}${tuda?(tot>0?' · ':'')+'radi: '+imeTajmera(tuda.osoba):''}</div>` : '';
  return dugme+info;
}

