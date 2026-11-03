/* ---------- GRADILIŠTA ---------- */
let siteFilter='all', siteQuery='';
function viewSites(){
  const filters=[['all','Sva'],['u toku','U toku'],['kasni','Kasne'],['planirano','Planirana'],['zavrseno','Završena']];
  return head('Gradilišta','Klikni na karticu za detalje projekta, budžet i zadatke.') +
  `<div class="tools">
    <div class="search">${icon('search')}<input id="siteSearch" placeholder="Pretraži gradilišta ili lokaciju…" value="${esc(siteQuery)}"></div>
    ${filters.map(f=>`<button class="chip ${siteFilter===f[0]?'active':''}" onclick="setSiteFilter('${f[0]}')">${f[1]}</button>`).join('')}
    ${isDirector()?`${modulEfektivni()!=='projektovanje'?`<button class="btn ghost" style="margin-left:auto" onclick="formSifrarnik()">Šifarnik artikala</button>`:''}
    <button class="btn"${modulEfektivni()==='projektovanje'?' style="margin-left:auto"':''} onclick="formSite()">${icon('plus')} Novo gradilište</button>`:''}
  </div>
  <div id="sitesGrid" class="grid sites-grid">${sitesCards()}</div>`;
}
function sitesCards(){
  let list = visibleSites().filter(g=> siteFilter==='all'||g.status===siteFilter);
  if(siteQuery.trim()){ const q=siteQuery.toLowerCase(); list=list.filter(g=>unesc(g.naziv+' '+g.lok+' '+(g.adresa||'')).toLowerCase().includes(q)); }
  if(!list.length) return `<div class="empty">Nema gradilišta koja odgovaraju filteru.</div>`;
  return list.map(g=>{
    const cl=cliById[g.klijent], ruk=zapById[g.rukovodilac];
    const barCol = g.status==='kasni'?'var(--red)':g.status==='zavrseno'?'var(--green)':'var(--blue)';
    return `<div class="card site-card" onclick="openSite('${g.id}')">
      <div class="hd">
        <div class="top"><h3>${g.naziv}</h3>${badge(g.status)}</div>
        <div class="loc">${icon('pin')} ${g.lok} · <span style="color:${modCol(g)};font-weight:600">${modLab(g)}</span></div>
        ${g.adresa?`<div class="loc" style="margin-top:2px">${g.adresa}</div>`:''}
      </div>
      <div class="bd">
        <div class="kv"><span>Klijent</span><b>${cl?cl.naziv:'—'}</b></div>
        ${canFinance()?`<div class="kv"><span>Ugovorena cena</span><b>${fmtEurK(g.budzet)}</b></div>
        ${imaNaplatu(g)?`<div class="kv"><span>Naplaćeno</span><b>${naplataPct(g)}%</b></div>`:''}`:''}
        <div class="kv"><span>Rukovodilac</span><b>${ruk?kratkoIme(ruk.ime):'—'}</b></div>
        <div class="kv"><span>Početak</span><b>${fmtDate(g.pocetak)}</b></div>
        <div class="kv"><span>Rok završetka</span><b>${g.status!=='zavrseno'&&daysBetween(TODAY,dParse(g.rok))<0?`<span style="color:var(--red)">${fmtDate(g.rok)}</span>`:fmtDate(g.rok)}</b></div>
        <div class="foot">
          <div class="bar"><span style="width:${g.napredak}%; background:${barCol}"></span></div>
          <span class="num" style="font-size:12px;font-weight:700">${g.napredak}%</span>
        </div>
      </div>
    </div>`;
  }).join('');
}
function setSiteFilter(f){ siteFilter=f; render(); }
function bindSitesSearch(){ const el=document.getElementById('siteSearch'); if(!el)return;
  el.oninput=e=>{ siteQuery=e.target.value; document.getElementById('sitesGrid').innerHTML=sitesCards(); };
}

/* ---------- KLIJENTI ---------- */
let clientQuery='';
function viewClients(){
  if(!isDirector()){ current='dash'; return viewDash(); }
  return head('Klijenti','Investitori i naručioci — kontakt podaci i aktivni projekti.') +
  `<div class="tools">
    <div class="search">${icon('search')}<input id="clSearch" placeholder="Pretraži klijente…" value="${esc(clientQuery)}"></div>
    <button class="btn" style="margin-left:auto" onclick="formClient()">${icon('plus')} Novi klijent</button>
  </div>
  <div class="card"><div id="clTable">${clientsTable()}</div></div>`;
}
function clientsTable(){
  let list=DATA.clijenti; if(clientQuery.trim()){ const q=clientQuery.toLowerCase(); list=list.filter(c=>unesc(c.naziv+' '+c.osoba+' '+c.tip).toLowerCase().includes(q)); }
  if(!list.length) return `<div class="empty">Nema rezultata.</div>`;
  const tip=t=> t==='Javni sektor'?'b-blue':t==='Fizičko lice'?'b-amber':'b-gray';
  return `<div style="overflow-x:auto"><table><thead><tr><th>Klijent</th><th>Tip</th><th>Kontakt osoba</th><th>Telefon</th><th>Aktivni projekti</th>${jeSuper()?'<th></th>':''}</tr></thead><tbody>
    ${list.map(c=>{
      const proj=DATA.gradilista.filter(g=>g.klijent===c.id);
      const akt=proj.filter(g=>g.status!=='zavrseno').length;
      return `<tr>
        <td><div class="who"><div class="av">${initials(c.naziv.replace('Grad ','').replace('Porodica ',''))}</div>
          <div><div class="strong">${c.naziv}</div><div class="sub">${c.mail}</div></div></div></td>
        <td><span class="badge ${tip(c.tip)}">${c.tip}</span></td>
        <td>${c.osoba}</td>
        <td class="num-cell">${c.tel}</td>
        <td><span class="strong num">${akt}</span> <span style="color:var(--faint)">/ ${proj.length} ukupno</span></td>
        ${jeSuper()?`<td class="r">${BRISI_DUGME('obrisiKlijenta',c.id)}</td>`:''}
      </tr>`;
    }).join('')}
  </tbody></table>`;
}
function bindClientSearch(){ const el=document.getElementById('clSearch'); if(!el)return;
  el.oninput=e=>{ clientQuery=e.target.value; document.getElementById('clTable').innerHTML=clientsTable(); };
}

/* ---------- ZAPOSLENI ---------- */
let empQuery='', empFilter='all', empDep='svi';   // empDep: svi | projektovanje | izvodjenje (zahtev 2026-10-23)
/* Departman zaposlenog (migracija 32, zaposleni.departman): izričit, inače izveden iz modula gradilišta na kojima je (jedan modul → taj; mešano/ništa → null = svi). */
function depZaposlenog(z){ if(z.departman) return z.departman; const m=new Set((z.grs||[]).map(x=>grById[x]).filter(Boolean).map(g=>g.modul||'izvodjenje')); return m.size===1?[...m][0]:null; }
function viewEmps(){
  const filters=[['all','Svi'],['Na terenu','Na terenu'],['Kancelarija','Kancelarija'],['Odsutan','Odsutni']];
  return head('Zaposleni','Klikni na red za profil — projekat, opis posla i aktivni zadaci.') +
  `<div class="tools">
    <div class="search">${icon('search')}<input id="empSearch" placeholder="Pretraži po imenu ili poziciji…" value="${esc(empQuery)}"></div>
    ${filters.map(f=>`<button class="chip ${empFilter===f[0]?'active':''}" onclick="setEmpFilter('${f[0]}')">${f[1]}</button>`).join('')}
    ${isDirector()?`<button class="btn" style="margin-left:auto" onclick="formEmp()">${icon('plus')} Novi zaposleni</button>`:''}
  </div>
  <div class="tools" style="margin-top:-6px">${depCipovi('empDep', empDep, 'active')}</div>
  <div class="card"><div id="empTable" style="overflow-x:auto">${empsTable()}</div></div>`;
}
function empsTable(){
  const ids=visibleSiteIds();
  let list=DATA.zaposleni.filter(z=>(upravaSve()||(z.grs||[]).some(x=>ids.has(x))) && (empFilter==='all'||z.status===empFilter) && (empDep==='svi'||depZaposlenog(z)===empDep));
  if(empQuery.trim()){ const q=empQuery.toLowerCase(); list=list.filter(z=>unesc(z.ime+' '+z.poz+' '+(z.grs||[]).map(x=>grById[x]?grById[x].naziv:'').join(' ')).toLowerCase().includes(q)); }
  if(!list.length) return `<div class="empty">Nema rezultata.</div>`;
  return `<table><thead><tr><th>Zaposleni</th><th>Pozicija</th><th>Departman</th><th>Projekat</th><th>Opis posla</th><th>Status</th>${jeSuper()?'<th></th>':''}</tr></thead><tbody>
    ${list.map(z=>{ const projs=(z.grs||[]).map(x=>grById[x]).filter(Boolean);
      const kratko = z.opis ? (z.opis.length>72 ? z.opis.slice(0,71)+'…' : z.opis) : '—';
      return `<tr class="clk" onclick="openEmp('${z.id}')">
        <td><div class="who"><div class="av">${initials(z.ime)}</div><div><div class="strong">${z.ime}</div><div class="sub num">${z.tel}</div></div></div></td>
        <td>${z.poz}</td>
        <td>${depBadge(depZaposlenog(z))}</td>
        <td><span style="color:var(--blue);font-weight:600">${projs.map(g=>g.naziv).join('</span><div style="height:3px"></div><span style="color:var(--blue);font-weight:600">')||'—'}</span>${projs.length>1?`<div class="sub">${projs.length} projekta</div>`:''}</td>
        <td style="max-width:280px"><span style="font-size:12.5px;color:var(--muted)">${kratko}</span></td>
        <td><span class="badge ${EMP_STATUS[z.status]}">${z.status}</span></td>
        ${jeSuper()?`<td class="r">${BRISI_DUGME('obrisiZaposlenog',z.id)}</td>`:''}
      </tr>`;
    }).join('')}
  </tbody></table>`;
}
function setEmpFilter(f){ empFilter=f; render(); }
function bindEmpSearch(){ const el=document.getElementById('empSearch'); if(!el)return;
  el.oninput=e=>{ empQuery=e.target.value; document.getElementById('empTable').innerHTML=empsTable(); };
}

/* profil zaposlenog: direktor dobija punu stranicu, rukovodilac fioku */
let empPageId=null;
function openEmpPage(id){ if(!isDirector()) return openEmp(id); empPageId=id; closeDrawer(); current='empPage'; renderNav(); render(); window.scrollTo(0,0); }
function openEmp(id){
  const z=zapById[id]; if(!z)return;
  if(isDirector()){ openEmpPage(id); return; }
  const projs=(z.grs||[]).map(x=>grById[x]).filter(Boolean);
  const zad=DATA.zadaci.filter(t=>t.zad===id && t.kol!=='done');
  const zadHtml = zad.length? zad.map(t=>`
    <div class="dr-task">
      <div class="tk"></div>
      <div class="lb">${t.naziv}<div class="sub" style="font-size:11.5px">${grById[t.gr]?grById[t.gr].naziv:''} · rok ${fmtDate(t.rok)}</div></div>
      <span class="prio ${PRIO[t.prio].c}">${PRIO[t.prio].t}</span>
    </div>`).join('') : `<div style="color:var(--faint);font-size:13px">Nema aktivnih zadataka.</div>`;

  document.getElementById('drawer').innerHTML = `
    <div class="dr-h">
      <button class="x" onclick="closeDrawer()">${icon('x')}</button>
      <div class="who" style="gap:14px">
        <div class="av" style="width:46px;height:46px;font-size:17px;border-radius:12px">${initials(z.ime)}</div>
        <div>
          <h2 style="margin:0">${z.ime}</h2>
          <div class="loc">${z.poz}</div>
        </div>
      </div>
      <div style="margin-top:12px"><span class="badge ${EMP_STATUS[z.status]}">${z.status}</span></div>
    </div>
    <div class="dr-b">
      <div class="dr-sec">
        <h4 style="display:flex;justify-content:space-between;align-items:center">Raspored — ${projs.length||0} ${projs.length===1?'projekat':'projekta'}
          ${isDirector()?`<button class="btn ghost" style="padding:3px 10px;font-size:11px" onclick="formRaspored('${z.id}')">✎ Izmeni</button>`:''}</h4>
        ${projs.length? projs.map(g=>`
          <div class="dr-kv"><span class="k"><span class="v link" style="font-weight:600" onclick="openSite('${g.id}')">${g.naziv} →</span><div class="sub" style="font-size:11.5px">${g.lok}</div></span>
          <span class="v" style="font-weight:500;color:var(--muted)">${g.faza}</span></div>`).join('')
          : '<div style="color:var(--faint);font-size:13px">Nije raspoređen ni na jedan projekat.</div>'}
        <div class="dr-kv"><span class="k">Telefon</span><span class="v num">${z.tel}</span></div>
      </div>
      <div class="dr-sec">
        <h4>Opis posla</h4>
        <div class="opis-box">${z.opis||'Nije unet opis posla.'}</div>
      </div>
      <div class="dr-sec">
        <h4>Aktivni zadaci (${zad.length})</h4>
        ${zadHtml}
      </div>
    </div>`;
  document.getElementById('drawer').classList.add('on');
  document.getElementById('scrim').classList.add('on');
}

/* ---------- STRANICA ZAPOSLENOG (direktor) ---------- */
function viewEmpPage(){
  const z=zapById[empPageId];
  if(!z){ current='emps'; return viewEmps(); }
  const aktivni=(z.grs||[]).map(x=>grById[x]).filter(Boolean).filter(g=>g.status!=='zavrseno');
  const zavGrs=(z.grs||[]).map(x=>grById[x]).filter(Boolean).filter(g=>g.status==='zavrseno');
  const istorija=(z.bivsi||[]).filter(x=>!(z.grs||[]).includes(x)).map(x=>grById[x]).filter(Boolean);
  const prosli=[...zavGrs.map(g=>({g,tip:'Završen projekat'})), ...istorija.map(g=>({g,tip:'Ranije radio/la'}))];
  const zadAkt=DATA.zadaci.filter(t=>t.zad===z.id&&t.kol!=='done');
  const zadDone=DATA.zadaci.filter(t=>t.zad===z.id&&t.kol==='done');
  const unosi=DATA.dnevnik.filter(d=>d.autor===z.id).sort((a,b)=>dParse(b.datum)-dParse(a.datum)).slice(0,3);

  const projRow=(g,extra)=>`
    <div class="site-line" onclick="openSite('${g.id}')" style="grid-template-columns:1fr auto;padding:9px 16px;gap:10px">
      <div style="min-width:0">
        <div class="nm" style="font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${g.naziv}</div>
        <div class="loc" style="font-size:11.5px">${g.faza}${extra?' · '+extra:''} · <b style="color:var(--ink)">${g.napredak}%</b></div>
      </div>
      <div style="text-align:right;align-self:center">${badge(g.status)}</div>
    </div>`;

  const angSes=(DATA.rad_na_zadatku||[]).filter(s=>s.osoba===z.id && Date.now()-new Date(s.start)<=30*86400000);
  const angMin=angSes.reduce((a,s)=>a+minSesije(s),0), angOtv=angSes.filter(sesijaOtvorena), angMap={};
  angSes.forEach(s=>{ const x=angMap[s.gr]=angMap[s.gr]||{gr:s.gr, ses:0, min:0}; x.ses++; x.min+=minSesije(s); });
  const angPoGr=Object.values(angMap).sort((a,b)=>b.min-a.min);
  const zRes=(DATA.resursi||[]).filter(r=>r.zaduzen===z.id);   // zaduženi resursi (istice je null-safe: resIstice)
  const resRow=r=>{
    const d=resIstice(r);
    const ist=r.istice?`<span style="${d<0?'color:var(--red);font-weight:600':d<=30?'color:var(--amber);font-weight:600':''}">${d<0?'isteklo ':'ističe '}${fmtDate(r.istice)}</span>`:'';
    return `<div class="dr-task" style="padding:10px 18px">
      <div class="lb">${RES_TIP[r.tip]||r.tip} · ${r.naziv}${r.oznaka?' ('+r.oznaka+')':''}<div class="sub" style="font-size:11.5px">${r.gr&&grById[r.gr]?grById[r.gr].naziv:'Baza / kancelarija'}${ist?' · '+ist:''}</div></div>
    </div>`;
  };
  const zadRow=t=>{
    const g=grById[t.gr]; const dd=dParse(t.rok); const diff=daysBetween(TODAY,dd);
    const rokTxt=t.kol==='done'?'':(diff<0?`<span style="color:var(--red);font-weight:600"> · kasni ${Math.abs(diff)}d</span>`:` · rok ${fmtDate(t.rok)}`);
    return `<div class="dr-task ${t.kol==='done'?'done':''}" style="padding:10px 18px">
      <div class="tk">${t.kol==='done'?icon('check'):''}</div>
      <div class="lb">${t.naziv}<div class="sub" style="font-size:11.5px">${g?g.naziv:''}${rokTxt}</div></div>
      <span class="prio ${PRIO[t.prio].c}">${PRIO[t.prio].t}</span>
    </div>`;
  };

  return `<div class="topbar">
    <div>
      <button class="btn ghost" style="margin-bottom:14px" onclick="go('emps')">← Svi zaposleni</button>
      <div class="who" style="gap:16px">
        <div class="av" style="width:56px;height:56px;font-size:20px;border-radius:14px">${initials(z.ime)}</div>
        <div>
          <h1 style="margin:0">${z.ime}</h1>
          <p style="margin:4px 0 0">${z.poz} · <span class="num">${z.tel}</span> · <span class="badge ${EMP_STATUS[z.status]}">${z.status}</span></p>
        </div>
      </div>
    </div>
    <div class="top-right">
      ${isDirector()?`<button class="print-btn" onclick="formEmp('${z.id}')">✎ Izmeni podatke</button>`:''}
      <button class="print-btn" onclick="formRaspored('${z.id}')">✎ Izmeni raspored</button>
      <button class="print-btn" onclick="window.print()">${icon('print')} Štampaj / PDF</button>
    </div>
  </div>

  <div class="grid kpis">
    <div class="card kpi"><div class="accent"></div>
      <div class="lab">${icon('site')} Aktivni projekti</div>
      <div class="val num">${aktivni.length}</div>
      <div class="sub">trenutno raspoređen/a</div></div>
    <div class="card kpi green"><div class="accent"></div>
      <div class="lab">${icon('check')} Prošli projekti</div>
      <div class="val num">${prosli.length}</div>
      <div class="sub">završeni i raniji angažmani</div></div>
    <div class="card kpi amber"><div class="accent"></div>
      <div class="lab">${icon('task')} Aktivni zadaci</div>
      <div class="val num">${zadAkt.length}</div>
      <div class="sub">${zadAkt.filter(t=>daysBetween(TODAY,dParse(t.rok))<0).length?'<span class="down">'+zadAkt.filter(t=>daysBetween(TODAY,dParse(t.rok))<0).length+' kasni</span>':'nijedan ne kasni'}</div></div>
    <div class="card kpi"><div class="accent"></div>
      <div class="lab">${icon('book')} Unosi u dnevnik</div>
      <div class="val num">${DATA.dnevnik.filter(d=>d.autor===z.id).length}</div>
      <div class="sub">ukupno izveštaja</div></div>
  </div>

  <div class="card" style="margin-bottom:18px">
    <div class="card-h"><h3>Opis posla</h3></div>
    <div class="card-b"><div style="font-size:13.5px;color:var(--slate);line-height:1.6">${z.opis||'Nije unet opis posla.'}</div></div>
  </div>

  <div class="grid row2" style="margin-bottom:18px;margin-top:0">
    <div class="card">
      <div class="card-h" style="padding:12px 16px"><h3>Aktivni projekti (${aktivni.length})</h3></div>
      <div class="card-b tight" style="max-height:230px;overflow-y:auto">${aktivni.length?aktivni.map(g=>projRow(g)).join(''):'<div class="empty" style="padding:24px 16px">Trenutno nije na aktivnim projektima.</div>'}</div>
    </div>
    <div class="card">
      <div class="card-h" style="padding:12px 16px"><h3>Prošli projekti (${prosli.length})</h3></div>
      <div class="card-b tight" style="max-height:230px;overflow-y:auto">${prosli.length?prosli.map(x=>projRow(x.g,x.tip)).join(''):'<div class="empty" style="padding:24px 16px">Nema prošlih projekata.</div>'}</div>
    </div>
  </div>

  <div class="grid row2">
    <div class="card">
      <div class="card-h" style="padding:12px 16px"><h3>Zadaci</h3><span class="hint">${zadAkt.length} aktivnih · ${zadDone.length} završenih</span></div>
      <div class="card-b tight" style="max-height:260px;overflow-y:auto">${[...zadAkt,...zadDone].length?[...zadAkt,...zadDone].map(zadRow).join(''):'<div class="empty">Nema zadataka.</div>'}</div>
    </div>
    <div class="card">
      <div class="card-h" style="padding:12px 16px"><h3>Poslednji unosi u dnevnik</h3></div>
      <div class="card-b tight" style="max-height:260px;overflow-y:auto">${unosi.length?unosi.map(e=>{const g=grById[e.gr];return `
        <div class="dl"><div class="when"><div class="d">${dParse(e.datum).getDate()}</div><div class="m">${MESECI[dParse(e.datum).getMonth()]}</div></div>
        <div style="flex:1"><div class="nm">${g?g.naziv:''}</div>
        <div style="font-size:12.5px;color:var(--slate);margin-top:3px">${e.tekst.length>140?e.tekst.slice(0,139)+'…':e.tekst}</div></div></div>`;}).join(''):'<div class="empty">Nema unosa.</div>'}</div>
    </div>
  </div>

  <div class="card" style="margin-top:18px">
    <div class="card-h" style="padding:12px 16px"><h3>Angažovanost (30 dana)</h3><span class="hint">${fmtTrajanje(angMin)} · ${angSes.length} ${angSes.length===1?'sesija':'sesija'}</span></div>
    <div class="card-b tight" style="max-height:260px;overflow-y:auto">${angPoGr.length?angPoGr.map(x=>`<div class="dr-task" style="padding:10px 18px"><div class="lb">${grById[x.gr]?grById[x.gr].naziv:'—'}<div class="sub" style="font-size:11.5px">${x.ses} ${x.ses===1?'sesija':'sesija'}</div></div><span class="num">${fmtTrajanje(x.min)}</span></div>`).join(''):'<div class="empty" style="padding:24px 16px">Nema evidentiranog rada u poslednjih 30 dana.</div>'}
      ${angOtv.map(s=>{ const tt=DATA.zadaci.find(x=>x.id===s.zadatak); return `<div class="dr-task" style="padding:10px 18px"><div class="lb">Trenutno radi: ${tt?tt.naziv:'—'}<div class="sub" style="font-size:11.5px">od ${hhmm(s.start)} · ${fmtTrajanje(minSesije(s))}</div></div></div>`; }).join('')}</div>
  </div>

  <div class="card" style="margin-top:18px">
    <div class="card-h" style="padding:12px 16px"><h3>Zaduženi resursi (${zRes.length})</h3></div>
    <div class="card-b tight" style="max-height:260px;overflow-y:auto">${zRes.length?zRes.map(resRow).join(''):'<div class="empty" style="padding:24px 16px">Nema zaduženih resursa.</div>'}</div>
  </div>`;
}

