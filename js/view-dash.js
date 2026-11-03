/* ============================================================
   POGLEDI
   ============================================================ */
function render(){
  osveziDanas();
  /* Alat stoji otvoren danima; bez ovoga bi sutradan upisivao jucerasnji datum. */
  const _n=new Date(); _n.setHours(0,0,0,0); if(_n.getTime()!==TODAY.getTime()) TODAY.setTime(_n.getTime());
  const v = document.getElementById('view');
  v.innerHTML = ({dash:viewDash, sites:viewSites, clients:viewClients, emps:viewEmps, time:viewTime, tasks:viewTasks, diary:viewDiary, pay:viewPay, empPage:viewEmpPage, nabavka:viewNabavka, subs:viewSubs, predmer:viewPredmer, resursi:viewResursi, magacin:viewMagacin, nalozi:viewNalozi}[current])();
  animateUI();
  if(current==='time') skrolujNaDanas();
  if(current==='sites') bindSitesSearch();
  if(current==='clients') bindClientSearch();
  if(current==='emps') bindEmpSearch();
  renderAi();   // plutajuce dugme + panel asistenta (samo direktor)
}

function head(title, sub){
  const d = TODAY;
  const roleTag = isDirector() ? '' : ` · pogled: <b>${zapById[ROLE]?zapById[ROLE].ime.split(' ')[0]:''}</b>`;
  return modulSeg() + `<div class="topbar">
    <div><h1>${title}</h1><p>${sub}</p></div>
    <div class="top-right">
      <button class="print-btn" onclick="window.print()">${icon('print')} Štampaj / PDF</button>
      <div class="today">📍 ${d.getDate()}. ${MESECI_PUN[d.getMonth()]} ${d.getFullYear()}.${roleTag}</div>
    </div>
  </div>`;
}

/* ---------- ZDRAVLJE PROJEKTA (0-100) ---------- */
function zdravlje(g){   // FORMULA NA TRI MESTA: ovde, server zdravlje_gradilista (migracija 24/26) i opis u aiSistem() za asistenta — menjati sva tri
  if(ZDR_SRV && Object.prototype.hasOwnProperty.call(ZDR_SRV, g.id) && ZDR_SRV[g.id]!=null) return ZDR_SRV[g.id];   // rukovodilac: server (nema finansijske redove)
  /* Pravi rukovodilacki nalog ima finansije kao NULL — lokalna formula bi tiho dala
     pogresan (do 25 nizi) skor. Bez servera: null → "—", nikad izmisljen broj.
     Direktor u "Pogled kao" ima pune podatke i racuna lokalno (jedan skor za sve). */
  if(jeRukovodilacNalog()) return null;
  if(g.status==='zavrseno') return 100;   // zavrsen projekat = 100 (ISTO u zdravlje_gradilista na serveru, migracija 24)
  let sc=100;
  const diff=daysBetween(TODAY,dParse(g.rok));
  if(g.status==='kasni'||diff<0) sc-=35;
  else if(diff<=30 && g.napredak<90) sc-=15;
  const kasneZad=DATA.zadaci.filter(t=>t.gr===g.id && t.kol!=='done' && daysBetween(TODAY,dParse(t.rok))<0).length;
  sc-=Math.min(15, kasneZad*5);
  /* Finansijski penali ulaze UVEK — skor je objektivan i isti za sve uloge.
     Rukovodilac vidi broj, ali ne i finansijsko obrazlozenje (alerti fin:true
     su filtrirani u computeAlerts, iznosi su iza canFinance()). */
  const ocek=g.troskovi*g.napredak/100;
  if(g.napredak>0 && potroseno(g)>ocek*1.1) sc-=20;
  if(imaNaplatu(g) && g.napredak-naplataPct(g)>25) sc-=15;   // Projektovanje bez situacija: nema penala (migracija 26, ISTO na serveru)
  return Math.max(5,sc);
}
function zdrBoja(sc){ return sc==null?'var(--faint)':sc>=80?'var(--green)':sc>=60?'var(--amber)':'var(--red)'; }
const zdrTekst=sc=>sc==null?'—':sc;
const ZDR_NEMA='Skor zdravlja stiže sa servera i trenutno nije dostupan';
function ringSvg(sc,size){
  size=size||36; const r=(size-6)/2, c=2*Math.PI*r, off=c*(1-(sc||0)/100);
  return `<svg class="zdr-ring" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="var(--line)" stroke-width="5"/>
    <circle class="arc" cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="${zdrBoja(sc)}" stroke-width="5"
      stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${c}" data-off="${off}"/>
  </svg>`;
}
/* Druga mera zdravlja u IZVODJENJU (odluka klijenta 2026-10-12): ugovoreno (predmer Σ kol×cena) vs privremene situacije
   (Σ iznos, server ih racuna iz stavki) vs okoncana situacija — uporedo sa statusom/skorom. Samo canFinance() (iznos je
   inace null); Projektovanje nema. */
function realizacijaSituacija(g){
  if(!g||jePro(g)||!canFinance()) return null;
  const ug=predmerZa(g.id).reduce((a,p)=>a+(+p.kol||0)*(+p.cena||0),0);
  const sits=sitZa(g.id).filter(x=>pregledSit(x)==='odobrena'), priv=sits.filter(x=>x.vrsta!=='okoncana'), ok=sits.filter(x=>x.vrsta==='okoncana');   // samo odobrene (migracija 25)
  const suma=l=>l.reduce((a,b)=>a+(+b.iznos||0),0), pct=x=>ug?Math.round(x/ug*100):null;
  const privremene=suma(priv), okoncana=ok.length?suma(sits):null;   // kolicine situacija su PRIRASTI (kumulativ − do sada), pa je okoncana = konacni obracun = Σ SVIH situacija
  return { ugovoreno:ug, privremene, okoncana, pPriv:pct(privremene), pOkon:okoncana==null?null:pct(okoncana), nPriv:priv.length, nOkon:ok.length };
}
function realBoja(p){ return p==null?'var(--faint)':p>100?'var(--red)':p>=90?'var(--green)':'var(--blue)'; }
function realizacijaHtml(r, kompakt){   // dve trake: privremene (kumulativ) i okoncana — % od ugovorenog
  if(!r) return '<span class="sub">—</span>';
  const traka=(lab,p,iznos)=>`<div class="napl" style="margin-top:${kompakt?2:6}px"><div class="bar"><span style="width:${Math.min(100,p||0)}%;background:${realBoja(p)}"></span></div><b class="num" style="color:${realBoja(p)}">${p==null?'—':p+'%'}</b></div><div class="sub num" style="text-align:right">${lab}${iznos==null?'':' '+fmtEurK(iznos)}</div>`;
  return `${kompakt?'':`<div class="sub num">Ugovoreno ${fmtEurK(r.ugovoreno)}</div>`}${traka('privremene'+(r.nPriv?' ('+r.nPriv+')':''), r.pPriv, r.privremene)}${traka('okončana (ukupno)', r.pOkon, r.okoncana)}`;
}
function zdrCell(g){
  const sc=zdravlje(g);
  return `<td><div style="display:flex;align-items:center;gap:8px"${sc==null?` title="${ZDR_NEMA}"`:''}>${ringSvg(sc,34)}<b class="num" style="color:${zdrBoja(sc)};font-size:13.5px">${zdrTekst(sc)}</b></div></td>`;
}
function animateUI(){
  try{
    if(typeof document.querySelectorAll!=='function'||typeof requestAnimationFrame!=='function') return;
    document.querySelectorAll('.zdr-ring .arc').forEach(a=>{ requestAnimationFrame(()=>{ a.style.strokeDashoffset=a.dataset.off; }); });
    document.querySelectorAll('.kpi .val').forEach(el=>{
      const t=el.firstChild; if(!t||t.nodeType!==3) return;
      const raw=t.textContent.trim(); const n=parseInt(raw,10);
      if(isNaN(n)||String(n)!==raw||n<=0||n>10000) return;
      const dur=550, st=performance.now();
      const step=now=>{ const p=Math.min(1,(now-st)/dur); t.textContent=Math.round(n*(p*(2-p))); if(p<1) requestAnimationFrame(step); };
      requestAnimationFrame(step);
    });
  }catch(e){}
}

/* ---------- UPOZORENJA ---------- */
function computeAlerts(){
  const sites=visibleSites(); const ids=visibleSiteIds(); const out=[];
  sites.forEach(g=>{
    const dd=dParse(g.rok), diff=daysBetween(TODAY,dd);
    if(g.status!=='zavrseno'){
      if(diff<0) out.push({sev:'red', gr:g.id, tekst:'Rok prekoračen '+Math.abs(diff)+' d — napredak '+g.napredak+'%', nas:g.naziv});
      else if(diff<=30 && g.napredak<90) out.push({sev:'amber', gr:g.id, tekst:'Rok za '+diff+' d, a napredak je '+g.napredak+'%', nas:g.naziv});
      const ocek=g.troskovi*g.napredak/100;
      if(g.napredak>0 && potroseno(g)>ocek*1.1) out.push({sev:'amber', gr:g.id, fin:true, tekst:'Troškovi ('+fmtEurK(potroseno(g))+') idu ispred napretka — plan za ovu fazu '+fmtEurK(ocek), nas:g.naziv});
      if(imaNaplatu(g) && g.napredak - naplataPct(g) > 25) out.push({sev:'amber', gr:g.id, fin:true, tekst:'Naplata ('+naplataPct(g)+'%) zaostaje za izvedenim radovima ('+g.napredak+'%)', nas:g.naziv});
    }
    /* Upozorenje o troskovima iznad plana (bez procenata — 2026-10-12). */
    if(potroseno(g)>g.troskovi && g.troskovi>0 && g.status!=='zavrseno') out.push({sev:'amber', gr:g.id, fin:true, tekst:'Troškovi premašili plan — '+fmtEurK(potroseno(g))+' od planiranih '+fmtEurK(g.troskovi), nas:g.naziv});
  });
  zadaciVidljivi().forEach(t=>{
    if(t.kol==='done'||!ids.has(t.gr)) return;
    const diff=daysBetween(TODAY,dParse(t.rok));
    if(diff<0) out.push({sev:'red', gr:t.gr, tekst:'Zadatak „'+t.naziv+'" kasni '+Math.abs(diff)+' d', nas:grById[t.gr]?grById[t.gr].naziv:''});
  });
  (DATA.situacije||[]).forEach(s=>{
    if(!ids.has(s.gr)||!imaNaplatu(grById[s.gr])) return;
    const pr=pregledSit(s);
    if(pr==='na_pregledu' && isDirector()) out.push({sev:'amber', gr:s.gr, sit:s.id, fin:true, tekst:'Situacija '+s.br+' ('+sitVrsta(s).toLowerCase()+') čeka pregled — '+(s.autor==='direkcija'?'Direkcija':osobaIme(s.autor)), nas:grById[s.gr]?grById[s.gr].naziv:''});
    if(pr==='vracena' && !isDirector() && smemNa(s.gr)) out.push({sev:'amber', gr:s.gr, sit:s.id, tekst:'Situacija '+s.br+' vraćena na doradu'+(s.komentar?': '+s.komentar:''), nas:grById[s.gr]?grById[s.gr].naziv:''});
    if(s.status==='placeno') return;
    if(sitKasni(s)) out.push({sev:'red', gr:s.gr, fin:true, tekst:'Situacija '+s.br+' ('+fmtEurK(s.iznos||0)+') nije plaćena — valuta '+fmtDate(s.valuta), nas:grById[s.gr]?grById[s.gr].naziv:''});
    const rz=razlikaSit(s);   // uprava "dobija razliku": stavke preko ugovorene kolicine (migracija 19)
    if(rz) out.push({sev:'amber', gr:s.gr, fin:true, tekst:'Situacija '+s.br+' ('+sitVrsta(s).toLowerCase()+'): '+rz+' stavk'+(rz===1?'a':'i')+' preko ugovorene količine — za dogovor sa investitorom', nas:grById[s.gr]?grById[s.gr].naziv:''});
  });
  (DATA.resursi||[]).forEach(r=>{
    if(!r.istice) return;
    if(r.gr && !ids.has(r.gr)) return;   // tudje gradiliste ne sme ni u upozorenja
    const d=daysBetween(TODAY,dParse(r.istice));
    const nas=r.gr&&grById[r.gr]?grById[r.gr].naziv:'Firma';
    if(d<0) out.push({sev:'red', gr:r.gr||null, tekst:'Isteklo: '+r.naziv+' ('+(r.napomena||RES_TIP[r.tip]||'resurs')+', '+fmtDate(r.istice)+')', nas});
    else if(d<=30) out.push({sev:'amber', gr:r.gr||null, tekst:'Ističe za '+d+' d: '+r.naziv+' ('+(r.napomena||RES_TIP[r.tip]||'resurs')+')', nas});
  });
  sites.forEach(g=>{   // administracija: "važi do" (opciono, null-safe; nije fin — vidi ga i rukovodilac)
    ADM_DOK.slice(0,3).forEach(([key,lab])=>{
      const st=admInfo(g,key); if(!st.vazi_do) return;
      const d=daysBetween(TODAY,dParse(st.vazi_do));
      if(d<0) out.push({sev:'red', gr:g.id, tekst:lab+' isteklo '+fmtDate(st.vazi_do), nas:g.naziv});
      else if(d<=30) out.push({sev:'amber', gr:g.id, tekst:lab+' ističe za '+d+' d', nas:g.naziv});
    });
  });
  const rang=a=>a.sit&&a.sev==='amber'?0:a.sev==='red'?1:2;   // situacija na pregledu / vracena traži akciju → na vrh (kartica prikazuje prvih 7)
  return out.filter(a=>canFinance()||!a.fin).sort((a,b)=>rang(a)-rang(b));
}

/* ---------- KONTROLNA TABLA ---------- */
let dashSort={key:'smart',dir:-1};
function setDashSort(k){
  if(dashSort.key===k && k!=='smart') dashSort.dir*=-1;
  else dashSort={key:k,dir:-1};
  render();
}
function dashSorted(sites){
  const arr=[...sites];
  if(dashSort.key==='smart'){
    const st={'kasni':0,'u toku':1,'planirano':2,'zavrseno':3};
    arr.sort((a,b)=> (st[a.status]??9)-(st[b.status]??9) || dParse(a.rok)-dParse(b.rok));
    return arr;
  }
  const v=g=>({cena:g.budzet, sit:(realizacijaSituacija(g)||{}).pPriv||0, naplata:naplataPct(g), ljudi:timNa(g.id).length, napredak:g.napredak, rok:dParse(g.rok).getTime(), zdr:zdravlje(g)}[dashSort.key]||0);
  arr.sort((a,b)=>(v(b)-v(a))*(-dashSort.dir));
  return arr;
}
/* Brze akcije na tabli — vidljive samo na telefonu/tabletu (CSS .qa). Forme same nude
   samo gradilista koja korisnik sme (formDiary/formTask/formNarudzba bez argumenata). */
function brzeAkcije(){
  return `<div class="qa">
    <button class="btn" onclick="formDiary()">＋ Dnevnik</button>
    ${mogaDaUpravljam()?`${visibleSites().some(g=>jePro(g))?`<button class="btn ghost" onclick="formTask()">＋ Zadatak</button>`:''}
    <button class="btn ghost" onclick="formNarudzba()">＋ Trebovanje</button>`:''}
  </div>`;
}
function viewDash(){
  const sites = visibleSites();
  const ids = visibleSiteIds();
  const aktivni = sites.filter(g=>g.status==='u toku'||g.status==='kasni');
  const kasne = sites.filter(g=>g.status==='kasni');
  const emps = DATA.zaposleni.filter(z=>(z.grs||[]).some(x=>ids.has(x)));
  const ukCena = sites.reduce((s,g)=>s+g.budzet,0);
  const ukNapl = sites.filter(imaNaplatu).reduce((s,g)=>s+naplSum(g),0);
  const nenap = sites.filter(g=>g.status!=='zavrseno'&&imaNaplatu(g)).reduce((s,g)=>s+Math.max(0, g.napredak/100*g.budzet - naplSum(g)),0);
  const fin = canFinance();
  const sitKol = fin && modulEfektivni()!=='projektovanje';   // druga mera zdravlja (Izvodjenje): ugovoreno vs privremene vs okoncana
  const alerts = computeAlerts();

  // finansijska tabela po projektu
  const rowHtml = (g)=>{
    const n = naplataPct(g), tim = timNa(g.id).length;
    const finCells = fin ? `
      <td class="r num-cell strong">${fmtEurK(g.budzet)}</td>
      ${imaNaplatu(g)?`<td class="r"><div class="napl">
        <div class="bar"><span style="width:${n}%; background:${n>=90?'var(--green)':n>=50?'var(--blue)':'var(--amber)'}"></span></div>
        <b class="num">${n}%</b></div>
        <div class="sub num" style="text-align:right">${fmtEurK(naplSum(g))}</div></td>`:'<td class="r sub">—</td>'}` : `
      <td>${fmtDate(g.rok)}</td>`;
    return `<tr class="clk" onclick="openSite('${g.id}')">
      <td>
        <div class="strong">${g.naziv}</div>
        <div class="sub">${cliById[g.klijent]?cliById[g.klijent].naziv+' · ':''}${g.faza} · <span style="color:${modCol(g)}">${modLab(g)}</span></div>
      </td>${zdrCell(g)}${sitKol?`<td class="r" style="min-width:150px">${realizacijaHtml(realizacijaSituacija(g), true)}</td>`:''}${finCells}
      <td class="r"><span class="ppl">${icon('emp')} <span class="num">${tim}</span></span></td>
      <td class="r">
        <div class="napl"><div class="bar"><span style="width:${g.napredak}%; background:${g.status==='kasni'?'var(--red)':g.status==='zavrseno'?'var(--green)':'var(--blue)'}"></span></div>
        <b class="num">${g.napredak}%</b></div></td>
      <td class="r">${badge(g.status)}</td>
    </tr>`;
  };

  // rokovi
  const dl = [];
  sites.forEach(g=>{ if(g.status!=='zavrseno') dl.push({naziv:g.naziv, meta:'Rok završetka projekta', datum:g.rok, tip:'projekat', gr:g.id}); });
  zadaciVidljivi().forEach(t=>{ if(t.kol!=='done' && ids.has(t.gr)) dl.push({naziv:t.naziv, meta:grById[t.gr].naziv, datum:t.rok, tip:'zadatak', gr:t.gr}); });
  dl.sort((a,b)=>dParse(a.datum)-dParse(b.datum));
  const dlHtml = dl.slice(0,6).map(d=>{
    const dd=dParse(d.datum); const diff=daysBetween(TODAY,dd);
    const cls = diff<0?'over':diff<=10?'warn':'';
    const metaExtra = diff<0?`<span style="color:var(--red);font-weight:600"> · kasni ${Math.abs(diff)} d</span>`
                      : diff===0?'<span style="color:var(--amber);font-weight:600"> · danas</span>'
                      : `<span style="color:var(--muted)"> · za ${diff} d</span>`;
    return `<div class="dl ${cls}" style="cursor:pointer" onclick="openSite('${d.gr}')">
      <div class="when"><div class="d">${dd.getDate()}</div><div class="m">${MESECI[dd.getMonth()]}</div></div>
      <div style="flex:1">
        <div class="nm">${d.naziv}</div>
        <div class="meta">${d.tip==='projekat'?'🏗 ':'✓ '}${d.meta}${metaExtra}</div>
      </div>
    </div>`;
  }).join('') || '<div class="empty">Nema nadolazećih rokova.</div>';

  // poslednji unosi u dnevnik
  const diaryEntries = DATA.dnevnik.filter(d=>ids.has(d.gr)).sort((a,b)=>dParse(b.datum)-dParse(a.datum)).slice(0,3);
  const diaryHtml = diaryEntries.map(e=>{
    const z={ime:osobaIme(e.autor)}, g=grById[e.gr]||{naziv:'\u2014'};   // autor moze biti i spoljni saradnik
    return `<div class="dl" style="cursor:pointer" onclick="openSite('${e.gr}')">
      <div class="av" style="margin-top:2px">${initials(z.ime)}</div>
      <div style="flex:1">
        <div class="nm">${g.naziv}</div>
        <div class="meta">${z.ime.split(' ')[0]} · ${fmtDate(e.datum)}</div>
        <div style="font-size:12.5px;color:var(--slate);margin-top:4px">${e.tekst.length>110?e.tekst.slice(0,109)+'…':e.tekst}</div>
      </div>
    </div>`;
  }).join('') || '<div class="empty">Nema unosa u dnevnik.</div>';

  const mojiZad = zadaciVidljivi().filter(t=>t.kol!=='done');
  const mojiKasne = mojiZad.filter(t=>daysBetween(TODAY,dParse(t.rok))<0).length;
  const finKpis = fin ? `
    <div class="card kpi"><div class="accent"></div>
      <div class="lab">${icon('money')} Naplaćeno</div>
      <div class="val num">${ukCena?Math.round(ukNapl/ukCena*100):0}<small>%</small></div>
      <div class="sub">${fmtEur(ukNapl)} od ugovorenih ${fmtEurK(ukCena)}${nenap>0?`<br><span style="color:var(--amber);font-weight:600">Izvedeno, a nenaplaćeno: ${fmtEurK(nenap)}</span>`:''}</div>
    </div>` : `
    <div class="card kpi amber"><div class="accent"></div>
      <div class="lab">${icon('task')} Aktivni zadaci</div>
      <div class="val num">${mojiZad.length}</div>
      <div class="sub">${mojiKasne?'<span class="down">'+mojiKasne+' probilo rok</span>':'<span class="up">Nijedan ne kasni</span>'}</div>
    </div>
    <div class="card kpi"><div class="accent"></div>
      <div class="lab">${icon('book')} Dnevnik radova</div>
      <div class="val num">${DATA.dnevnik.filter(d=>ids.has(d.gr)).length}</div>
      <div class="sub">unosa na mojim gradilištima</div>
    </div>`;

  const alertsCard = alerts.length ? `<div class="card" style="margin-bottom:18px">
    <div class="card-h"><h3>Upozorenja</h3><span class="hint">${alerts.length} — klik vodi na projekat</span></div>
    <div class="card-b tight">${alerts.slice(0,7).map(a=>`
      <div class="dl ${a.sev==='red'?'over':'warn'}" style="cursor:pointer" onclick="${a.sit?`detaljSituacije('${a.sit}')`:a.gr?`openSite('${a.gr}')`:`go('resursi')`}">
        <div class="when" style="width:40px;padding:9px 2px"><div class="d" style="font-size:15px;color:${a.sev==='red'?'var(--red)':'var(--amber)'}">!</div></div>
        <div style="flex:1"><div class="nm">${a.tekst}</div><div class="meta">${a.nas}</div></div>
      </div>`).join('')}</div>
  </div>` : '';

  const thS=(k,lab,r)=>`<th class="sortable ${r?'r':''}" onclick="setDashSort('${k}')">${lab}${dashSort.key===k&&k!=='smart'?`<span class="arr">${dashSort.dir===-1?'\u25bc':'\u25b2'}</span>`:''}</th>`;
  const finHead = fin
    ? thS('smart','Projekat')+thS('zdr','Zdravlje')+(sitKol?thS('sit','Ugov. vs situacije',1):'')+thS('cena','Cena',1)+thS('naplata','Naplata',1)+thS('ljudi','Ljudi',1)+thS('napredak','Napredak',1)+'<th class="r">Status</th>'
    : thS('smart','Projekat')+thS('zdr','Zdravlje')+thS('rok','Rok')+thS('ljudi','Ljudi',1)+thS('napredak','Napredak',1)+'<th class="r">Status</th>';

  // jutarnji brif
  const dan=['nedelja','ponedeljak','utorak','sreda','četvrtak','petak','subota'][TODAY.getDay()];
  const aktProj=sites.filter(g=>g.status!=='zavrseno'&&g.status!=='planirano');
  const najrizik=aktProj.filter(g=>zdravlje(g)!=null).sort((a,b)=>zdravlje(a)-zdravlje(b))[0];
  const rokovi7=sites.filter(g=>g.status!=='zavrseno'&&daysBetween(TODAY,dParse(g.rok))>=0&&daysBetween(TODAY,dParse(g.rok))<=7).length
              + zadaciVidljivi().filter(t=>t.kol!=='done'&&daysBetween(TODAY,dParse(t.rok))>=0&&daysBetween(TODAY,dParse(t.rok))<=7).length;
  const bl=[];
  if(fin){
    const naPreg=(DATA.situacije||[]).filter(x=>ids.has(x.gr)&&imaNaplatu(grById[x.gr])&&pregledSit(x)==='na_pregledu');
    if(naPreg.length) bl.push(['var(--amber)',`<b style="cursor:pointer;text-decoration:underline" onclick="${naPreg.length===1?`detaljSituacije('${naPreg[0].id}')`:`go('pay')`}">${naPreg.length} situacij${naPreg.length===1?'a čeka':'e čekaju'} pregled</b> — ${naPreg.length===1?'klik otvara detalj':'klik vodi na Naplatu'}`]);
    const dosp=(DATA.situacije||[]).filter(x=>ids.has(x.gr)&&imaNaplatu(grById[x.gr])&&x.status!=='placeno'&&sitKasni(x));
    if(dosp.length) bl.push(['var(--red)',`<b>${fmtEur(dosp.reduce((a,b)=>a+(b.iznos||0),0))}</b> dospelo za naplatu (${dosp.length} situacij${dosp.length===1?'a':'e'}) — proveri tab Naplata`]);
    if(najrizik) bl.push([zdrBoja(zdravlje(najrizik)),`Najrizičniji projekat: <b style="cursor:pointer;text-decoration:underline" onclick="openSite('${najrizik.id}')">${najrizik.naziv}</b> — zdravlje ${zdravlje(najrizik)}/100`]);
    bl.push(['var(--blue-2)',`U narednih 7 dana dospeva <b>${rokovi7}</b> rokova (projekti + zadaci)`]);
  } else {
    const moji=zadaciVidljivi().filter(t=>t.kol!=='done');
    const danas=moji.filter(t=>daysBetween(TODAY,dParse(t.rok))===0).length;
    const kasneT=moji.filter(t=>daysBetween(TODAY,dParse(t.rok))<0).length;
    bl.push([kasneT?'var(--red)':'var(--green)',`Zadaci: <b>${danas}</b> dospeva danas${kasneT?`, <b>${kasneT}</b> već kasni`:', ništa ne kasni'}`]);
    const vrac=(DATA.situacije||[]).filter(x=>ids.has(x.gr)&&imaNaplatu(grById[x.gr])&&smemNa(x.gr)&&pregledSit(x)==='vracena').length;
    if(vrac) bl.push(['var(--amber)',`<b>${vrac}</b> situacij${vrac===1?'a vraćena':'e vraćene'} na doradu — v. upozorenja`]);
    if(najrizik) bl.push([zdrBoja(zdravlje(najrizik)),`<b style="cursor:pointer;text-decoration:underline" onclick="openSite('${najrizik.id}')">${najrizik.naziv}</b> — zdravlje ${zdravlje(najrizik)}/100, rok ${fmtDate(najrizik.rok)}`]);
    bl.push(['var(--blue-2)',`U narednih 7 dana dospeva <b>${rokovi7}</b> rokova`]);
  }
  const briefCard=`<div class="brief">
    <div class="b-date">${dan}, ${TODAY.getDate()}. ${MESECI_PUN[TODAY.getMonth()]} ${TODAY.getFullYear()}.</div>
    <h2>${fin?'Dobro jutro — stanje firme na jedan pogled':'Dobro jutro — tvoja gradilišta danas'}</h2>
    ${bl.map(x=>`<div class="b-line"><span class="b-dot" style="background:${x[0]}"></span><span>${x[1]}</span></div>`).join('')}
  </div>`;

  // grupisanje tabele po modulima + red UKUPNO
  let finBody='';
  const NCOLS = (fin ? 7 : 6) + (sitKol?1:0);
  const grpRed=(lab,boja,gs,klik)=>{
    if(!gs.length) return '';
    const c=gs.reduce((a,b)=>a+b.budzet,0), gN=gs.filter(imaNaplatu), cN=gN.reduce((a,b)=>a+b.budzet,0), n=gN.reduce((a,b)=>a+naplSum(b),0);
    return `<tr class="grp" onclick="${klik}"><td colspan="${NCOLS}"><span class="g-dot" style="background:${boja}"></span>${lab} · ${gs.length} proj.${fin?` · ${fmtEurK(c)}${gN.length?` · naplata ${cN?Math.round(n/cN*100):0}%`:''}`:''}</td></tr>`
      + dashSorted(gs).map(rowHtml).join('');
  };
  const grupe = (fin && MODUL==='sve') ? [
      ['Projektovanje', MODUL_BOJA.projektovanje, sites.filter(g=>(g.modul||'izvodjenje')==='projektovanje'), "setModul('projektovanje')"],
      ['Izvođenje radova', MODUL_BOJA.izvodjenje, sites.filter(g=>(g.modul||'izvodjenje')==='izvodjenje'), "setModul('izvodjenje')"]
    ] : (fin && modulEfektivni()==='izvodjenje'&&PODTIP==='sve') ? [
      ['Visokogradnja', PODTIP_BOJA.visokogradnja, sites.filter(g=>(g.tip||'visokogradnja')==='visokogradnja'), "setPodtip('visokogradnja')"],
      ['Niskogradnja', PODTIP_BOJA.niskogradnja, sites.filter(g=>(g.tip||'visokogradnja')==='niskogradnja'), "setPodtip('niskogradnja')"]
    ] : null;
  if(grupe) finBody = grupe.map(x=>grpRed(x[0],x[1],x[2],x[3])).join('');
  else finBody = dashSorted(sites).map(rowHtml).join('');
  if(fin && sites.length>1){
    const c=sites.reduce((a,b)=>a+b.budzet,0), cN=sites.filter(imaNaplatu).reduce((a,b)=>a+b.budzet,0), n=sites.filter(imaNaplatu).reduce((a,b)=>a+naplSum(b),0);   // naplata samo Izvodjenje
    const ppl=new Set(); sites.forEach(g=>timNa(g.id).forEach(z=>ppl.add(z.id)));
    const wNap=c?Math.round(sites.reduce((a,b)=>a+b.napredak*b.budzet,0)/c):0;
    finBody += `<tr class="total">
      <td>UKUPNO · ${sites.length} projekata</td><td></td>${sitKol?'<td></td>':''}
      <td class="r num-cell">${fmtEurK(c)}</td>
      <td class="r"><b class="num">${cN?Math.round(n/cN*100):0}%</b><div class="sub num">${fmtEurK(n)}</div></td>
      <td class="r num-cell">${ppl.size}</td>
      <td class="r num-cell">${wNap}%</td><td></td>
    </tr>`;
  }
  return head('Kontrolna tabla', fin?'Finansije, napredak i rokovi svih projekata na jednom mestu.':'Napredak, rokovi i zadaci na tvojim gradilištima.') +
  brzeAkcije() +
  briefCard +
  `<div class="grid kpis${fin?' kpis3':''}">
    <div class="card kpi"><div class="accent"></div>
      <div class="lab">${icon('site')} Aktivna gradilišta</div>
      <div class="val num">${aktivni.length}<small> / ${sites.length}</small></div>
      <div class="sub">${sites.filter(g=>g.status==='planirano').length} u pripremi, ${sites.filter(g=>g.status==='zavrseno').length} završeno</div>
    </div>
    <div class="card kpi ${kasne.length?'red':'green'}"><div class="accent"></div>
      <div class="lab">${icon('warn')} Kasne s rokom</div>
      <div class="val num">${kasne.length}</div>
      <div class="sub">${kasne.length?'<span class="down">Zahteva pažnju</span>':'<span class="up">Sve u planu</span>'}</div>
    </div>${finKpis}
  </div>

  ${alertsCard}

  <div class="card">
    <div class="card-h"><h2>${fin?'Finansije po projektu':'Moja gradilišta'}</h2><span class="hint">${dashSort.key==='smart'?'Sortirano po hitnosti \u00b7 klik na kolonu menja':'Klik na kolonu menja sortiranje \u00b7 \u201eProjekat\u201c vra\u0107a po hitnosti'}</span></div>
    <div style="overflow-x:auto"><table>
      <thead><tr>${finHead}</tr></thead>
      <tbody>${finBody}</tbody>
    </table></div>
  </div>

  <div class="grid row2">
    <div class="card">
      <div class="card-h"><h3>Nadolazeći rokovi</h3><span class="hint">${dl.length} ukupno</span></div>
      <div class="card-b tight">${dlHtml}</div>
    </div>
    <div class="card">
      <div class="card-h"><h3>Poslednje iz dnevnika radova</h3><button class="btn ghost" style="padding:5px 11px;font-size:12px" onclick="go('diary')">Sve →</button></div>
      <div class="card-b tight">${diaryHtml}</div>
    </div>
  </div>`;
}

