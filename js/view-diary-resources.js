/* ---------- DNEVNIK RADOVA ---------- */
function viewDiary(){
  const ids=visibleSiteIds();
  const entries=DATA.dnevnik.filter(d=>upravaSve()||ids.has(d.gr)).sort((a,b)=>dParse(b.datum)-dParse(a.datum));
  const byDay={};
  entries.forEach(e=>{ (byDay[e.datum]=byDay[e.datum]||[]).push(e); });
  const days=Object.keys(byDay).sort((a,b)=>dParse(b)-dParse(a));
  const html = days.map(day=>`
    <div class="diary-day">
      <h3>${fmtDate(day)}</h3>
      ${byDay[day].map(e=>{
        const z={ime:osobaIme(e.autor)}, g=grById[e.gr];   // autor: zaposleni ili spoljni saradnik
        return `<div class="card entry">
          <div class="av">${z.ime!=='—'?initials(z.ime):'?'}</div>
          <div style="flex:1">
            <div class="hd"><b>${z?z.ime:'—'}</b><span class="gr-link" onclick="openSite('${e.gr}')">${g?g.naziv:''}</span>${smemObrisatiUnos(e)?`<span style="margin-left:auto">${BRISI_DUGME('obrisiUnosDnevnika',e.id)}</span>`:''}</div>
            <p>${e.tekst}</p>
          </div>
        </div>`;
      }).join('')}
    </div>`).join('') || '<div class="empty">Još nema unosa u dnevnik radova.</div>';

  return head('Dnevnik radova','Dnevni izveštaji sa gradilišta — ko je šta uradio i šta je zapelo.') +
  `<div class="tools"><button class="btn" onclick="formDiary()">${icon('plus')} Novi unos</button></div>
  ${html}`;
}

/* ---------- FORMA: NOVI / IZMENA ZAPOSLENOG ---------- */
function formEmp(id){
  const pozicije=['Rukovodilac gradilišta','Građevinski inženjer','Arhitekta','Inženjer geodezije','Inženjer instalacija','Građevinski tehničar','Nadzorni organ','Majstor','Pomoćni radnik'];
  let z=null;
  if(id){ if(!isDirector()) return; z=zapById[id]; if(!z) return; if(!pozicije.includes(z.poz)) pozicije.push(z.poz); }   // izmena: nepoznata pozicija se ne gubi
  const sel=(a,b)=>z&&a===b?' selected':'';
  openModal(`
    <div class="m-h"><h3>${z?'Izmeni zaposlenog':'Novi zaposleni'}</h3><button class="x" style="position:static" onclick="closeModal()">${icon('x')}</button></div>
    <div class="m-b">
      <div class="f-row"><label>Ime i prezime</label><input id="f_eime" placeholder="npr. Marko Marković" value="${z?z.ime:''}"></div>
      <div class="f-2">
        <div class="f-row"><label>Pozicija</label><select id="f_epoz">${pozicije.map(p=>`<option${sel(p,z&&z.poz)}>${p}</option>`).join('')}</select></div>
        <div class="f-row"><label>Telefon</label><input id="f_etel" placeholder="06x xxx xxxx" value="${z&&z.tel!=='—'?z.tel:''}"></div>
      </div>
      ${z?'':`<div class="f-row"><label>Gradilišta (može više)</label>
        <div class="chk-list">${DATA.gradilista.map(g=>`<label class="chk"><input type="checkbox" id="f_egr_${g.id}"> ${g.naziv}</label>`).join('')}</div>
      </div>`}
      <div class="f-2">
        <div class="f-row"><label>Status</label><select id="f_est">${['Na terenu','Kancelarija','Odsutan'].map(s=>`<option${sel(s,z&&z.status)}>${s}</option>`).join('')}</select></div>
        <div class="f-row"><label>Departman</label><select id="f_edep"><option value="">— po gradilištima —</option>${depOpcije(z&&z.departman)}</select></div>
      </div>
      <div class="f-row"><label>Opis posla</label><textarea id="f_eopis" placeholder="Šta ova osoba konkretno radi na projektu…">${z?z.opis||'':''}</textarea></div>
      <div class="m-foot">
        <button class="btn ghost" onclick="closeModal()">Otkaži</button>
        <button class="btn" onclick="saveEmp(${z?`'${z.id}'`:''})">${z?'Sačuvaj izmene':'Sačuvaj zaposlenog'}</button>
      </div>
    </div>`);
}
function saveEmp(id){
  if(!isDirector()) return;
  const v=id=>document.getElementById(id).value;
  const ime=esc(String(v('f_eime')).trim()); if(!ime){ alert('Unesi ime i prezime.'); return; }
  const departman=depIzForme(v('f_edep'), id&&zapById[id]?zapById[id].departman||null:null);
  if(id){   // IZMENA: grs/bivsi/id se ne diraju (raspored ide kroz formRaspored/formTim)
    const z=zapById[id]; if(!z) return;
    z.ime=ime; z.poz=v('f_epoz'); z.tel=esc(String(v('f_etel')).trim())||'—'; z.status=v('f_est'); z.opis=esc(String(v('f_eopis')).trim()); z.departman=departman;
    rebuildMaps(); saveState(); closeModal(); renderNav(); render(); return;
  }
  const grs=DATA.gradilista.filter(g=>{const c=document.getElementById('f_egr_'+g.id); return c&&c.checked;}).map(g=>g.id);
  DATA.zaposleni.push({ id:'z'+Date.now(), ime, poz:v('f_epoz'), grs, bivsi:[], status:v('f_est'), tel:esc(v('f_etel').trim())||'—', opis:esc(v('f_eopis').trim()), departman });
  rebuildMaps(); saveState(); closeModal(); renderNav(); render();
}

const ADM_ST={nema:['Nema','b-red','✗'], priprema:['U pripremi','b-amber','…'], ima:['Ima','b-green','✓']};
const ADM_DOK=[['ugovor','Ugovor / radni nalog'],['prijava','Prijava radova'],['polisa','Polisa osiguranja'],['podugovori','Ugovori podizvođača']];
function admInfo(g,key){
  let v=(g.adm||{})[key];
  if(v===true) v={st:'ima'}; else if(!v||v===false) v={st:'nema'}; else if(!v.st) v.st='nema';
  return v;
}
function setAdmStatus(grId,key,val){
  if(!isDirector()) return;
  const g=grById[grId]; if(!g||!ADM_ST[val]) return;
  g.adm=g.adm||{}; g.adm[key]=Object.assign(admInfo(g,key),{st:val});
  saveState(); openSite(grId);
}
function setAdmVazi(grId,key,val){   // vazi_do: opciono (null-safe) — samo `if(st.vazi_do)`; prazno = ukloni ključ
  if(!isDirector()) return;
  const g=grById[grId]; if(!g||!ADM_DOK.some(d=>d[0]===key)) return;
  g.adm=g.adm||{}; const a=admInfo(g,key);
  if(val) a.vazi_do=val; else delete a.vazi_do;
  g.adm[key]=a; saveState(); openSite(grId);
}
function setAdmDoc(grId,key,doc){
  if(!isDirector()) return;
  const g=grById[grId]; if(!g) return;
  g.adm=g.adm||{}; const a=admInfo(g,key); a.doc=doc; if(a.st==='nema') a.st='ima';
  g.adm[key]=a; saveState(); openSite(grId);
}
function ukloniAdmDoc(grId,key){
  if(!isDirector()) return;
  const g=grById[grId]; if(!g) return;
  const a=admInfo(g,key); delete a.doc; g.adm[key]=a;
  saveState(); openSite(grId);
}
function uploadAdmDoc(grId,key){
  if(!isDirector()) return;
  try{
    const inp=document.createElement('input');
    inp.type='file'; inp.accept='.pdf,.jpg,.jpeg,.png';
    inp.onchange=e=>{
      const f=e.target.files&&e.target.files[0]; if(!f) return;
      if(f.size>2.5*1024*1024){ alert('Dokument je veći od 2.5MB — u pilotu važi taj limit (veći fajlovi stižu uz Supabase Storage).'); return; }
      const r=new FileReader();
      r.onload=()=>setAdmDoc(grId,key,{name:esc(f.name),datum:todayStr(),data:r.result});
      r.readAsDataURL(f);
    };
    inp.click();
  }catch(e){}
}
function otvoriAdmDoc(grId,key){
  const g=grById[grId]; if(!g) return;
  if(!(isDirector()||g.rukovodilac===ROLE)) return;
  const d=admInfo(g,key).doc; if(!d||!d.data) return;
  try{
    const parts=String(d.data).split(',');
    const bin=atob(parts[1]);
    const arr=new Uint8Array(bin.length);
    for(let i=0;i<bin.length;i++) arr[i]=bin.charCodeAt(i);
    const mime=(parts[0].match(/data:(.*?);/)||[])[1]||'application/pdf';
    window.open(URL.createObjectURL(new Blob([arr],{type:mime})),'_blank');
  }catch(e){}
}
/* ---------- RESURSI (vozila, licence, polise, oprema) ---------- */
const RES_TIP={vozilo:'Vozila', alat:'Alati i oprema', racunar:'Računari', licenca:'Licence', polisa:'Polise osiguranja'};
let resFilter='sve', resDep='svi';   // resDep: svi | projektovanje | izvodjenje (zahtev 2026-10-23)
/* Departman resursa (migracija 32, resursi.modul): izričito dodeljen, inače izveden iz modula gradilišta kome je dodeljen; null bez gradilišta = svi. */
function depResursa(r){ if(r.modul) return r.modul; const g=r.gr?grById[r.gr]:null; return g?(g.modul||'izvodjenje'):null; }
function depLabela(d){ return d==='projektovanje'?'Projektovanje':d==='izvodjenje'?'Izvođenje':'Svi'; }
function depBadge(d){ return d?`<span class="badge ${d==='projektovanje'?'b-blue':'b-green'}">${depLabela(d)}</span>`:'<span class="sub">Svi</span>'; }
function depCipovi(varName, aktivan, klasa){ return [['svi','Svi'],['projektovanje','Departman projektovanje'],['izvodjenje','Departman izvođenje']].filter(([d])=>d==='svi'||modulDozvoljen(d)).map(([d,l])=>`<button class="chip ${aktivan===d?klasa:''}" onclick="${varName}='${d}';render()">${l}</button>`).join(''); }
function depOpcije(sel){   // tudji (nedozvoljen) tekuci departman ostaje kao izabrana, zakljucana opcija — izmena ne sme da ga obrise
  const o=['projektovanje','izvodjenje'].filter(modulDozvoljen).map(d=>`<option value="${d}" ${sel===d?'selected':''}>${depLabela(d)}</option>`).join('');
  return sel&&!modulDozvoljen(sel)?o+`<option value="${sel}" selected disabled>${depLabela(sel)} (drugi departman)</option>`:o; }
function depIzForme(v, staro){ if(staro&&v===staro) return staro; return (v==='projektovanje'||v==='izvodjenje')&&modulDozvoljen(v)?v:null; }   // pravilo 8: null, ne delete
/* Dodeli SVE vidljive resurse jednom departmanu (ili svima = null). Uprava; modulDozvoljen za direktora modula. Pravilo 8: null, ne delete. */
function dodeliSveResurse(dep){
  if(!isDirector()) return;
  dep=dep==='projektovanje'||dep==='izvodjenje'?dep:null;
  if(dep&&!modulDozvoljen(dep)) return;
  const lista=(DATA.resursi||[]).filter(r=>(!r.gr || smemNa(r.gr)) && (!depResursa(r) || modulDozvoljen(depResursa(r))));   // sve sto vodim; direktor modula ne dira resurse tudjeg departmana
  if(!lista.length) return;
  if(!confirm('Dodeliti svih '+lista.length+' resursa departmanu: '+depLabela(dep)+'?')) return;
  lista.forEach(r=>{ r.modul=dep; });
  beleziLog('resursi_departman',{departman:dep, broj:lista.length});
  saveState(); render();
}
function resIstice(r){ if(!r.istice) return 9999; return daysBetween(TODAY,dParse(r.istice)); }
function viewResursi(){
  const vidljiva=visibleSiteIds();
  const list=(DATA.resursi||[]).filter(r=>(resFilter==='sve'||r.tip===resFilter) && (!r.gr || isDirector() || vidljiva.has(r.gr)) && (resDep==='svi'||depResursa(r)===resDep));
  const cips=[['sve','Svi'],...Object.entries(RES_TIP)].map(c=>`<button class="chip ${resFilter===c[0]?'on':''}" onclick="resFilter='${c[0]}';render()">${c[1]}</button>`).join('');
  const depCips=depCipovi('resDep', resDep, 'on');
  const dodela=isDirector()?`<span class="sub" style="margin-left:auto">Dodeli sve:</span>${['projektovanje','izvodjenje'].filter(modulDozvoljen).map(d=>`<button class="btn ghost" style="padding:5px 10px;font-size:11.5px" onclick="dodeliSveResurse('${d}')">${depLabela(d)}</button>`).join('')}${jePunaUprava()?`<button class="btn ghost" style="padding:5px 10px;font-size:11.5px" onclick="dodeliSveResurse(null)">Svima</button>`:''}`:'';
  const rows=list.sort((a,b)=>resIstice(a)-resIstice(b)).map(r=>{
    const d=resIstice(r);
    const ist = !r.istice ? '<span class="sub">—</span>' : d<0 ? `<span class="badge b-red">Isteklo ${fmtDate(r.istice)}</span>` : d<=30 ? `<span class="badge b-amber">Ističe ${fmtDate(r.istice)}</span>` : `<span class="num" style="font-size:12.5px">${fmtDate(r.istice)}</span>`;
    const g=r.gr?grById[r.gr]:null, z=r.zaduzen?zapById[r.zaduzen]:null;
    return `<tr>
      <td><div class="strong">${r.naziv}</div><div class="sub">${RES_TIP[r.tip]||r.tip}${r.napomena?' · '+r.napomena:''}</div></td>
      <td class="num" style="font-size:12.5px">${r.oznaka||'—'}</td>
      <td>${g?`<span style="color:var(--blue);font-weight:600;cursor:pointer" onclick="openSite('${g.id}')">${g.naziv}</span>`:'<span class="sub">Baza / kancelarija</span>'}</td>
      <td>${depBadge(depResursa(r))}</td>
      <td>${z?z.ime:'—'}</td>
      <td class="r">${ist}</td>
      ${isDirector()?`<td class="r"><button class="btn ghost" style="padding:5px 10px;font-size:11.5px" onclick="formResurs('${r.id}')">✎</button>${smemBrisati(r.gr)?' '+BRISI_DUGME('obrisiResurs',r.id):''}</td>`:''}
    </tr>`;
  }).join('');
  return head('Resursi','Vozila, oprema, licence i polise — dodela i rokovi važenja.') +
  `<div class="tools">${isDirector()?`<button class="btn" onclick="formResurs()">${icon('plus')} Novi resurs</button>`:''}<div style="display:flex;gap:6px;flex-wrap:wrap">${cips}</div>
  <div class="tools" style="margin-top:-6px">${depCips}${dodela}</div></div>
  <div class="card"><div style="overflow-x:auto"><table>
    <thead><tr><th>Resurs</th><th>Oznaka</th><th>Dodeljeno</th><th>Departman</th><th>Zadužen</th><th class="r">Važi do</th>${isDirector()?'<th></th>':''}</tr></thead>
    <tbody>${rows}</tbody></table>
    ${list.length?'':'<div class="empty">Nema resursa u ovoj kategoriji.</div>'}
  </div>`;
}
function formResurs(rid){
  if(!isDirector()) return;
  const r=rid?(DATA.resursi||[]).find(x=>x.id===rid):null; if(r&&r.gr&&!smemNa(r.gr)) return;   // resurs tudjeg modula (direktor modula)
  openModal(`
    <div class="m-h"><h3>${r?'Izmena resursa':'Novi resurs'}</h3><button class="x" style="position:static" onclick="closeModal()">${icon('x')}</button></div>
    <div class="m-b">
      <div class="f-2">
        <div class="f-row"><label>Naziv</label><input id="f_rnaziv" value="${r?r.naziv:''}" placeholder="npr. Kamion kiper MAN"></div>
        <div class="f-row"><label>Tip</label><select id="f_rtip">${Object.entries(RES_TIP).map(t=>`<option value="${t[0]}" ${r&&r.tip===t[0]?'selected':''}>${t[1]}</option>`).join('')}</select></div>
      </div>
      <div class="f-2">
        <div class="f-row"><label>Oznaka (reg./inv./br.)</label><input id="f_roznaka" value="${r?(r.oznaka||''):''}"></div>
        <div class="f-row"><label>Važi do (opciono)</label><input id="f_ristice" type="date" value="${r?(r.istice||''):''}"></div>
      </div>
      <div class="f-2">
        <div class="f-row"><label>Dodeljeno gradilištu</label><select id="f_rgr"><option value="">Baza / kancelarija</option>${DATA.gradilista.map(g=>`<option value="${g.id}" ${r&&r.gr===g.id?'selected':''}>${g.naziv}</option>`).join('')}</select></div>
        <div class="f-row"><label>Zadužen</label><select id="f_rzad"><option value="">—</option>${DATA.zaposleni.map(z=>`<option value="${z.id}" ${r&&r.zaduzen===z.id?'selected':''}>${z.ime}</option>`).join('')}</select></div>
      </div>
      <div class="f-2">
        <div class="f-row"><label>Departman</label><select id="f_rmod"><option value="">Svi / po gradilištu</option>${depOpcije(r&&r.modul)}</select></div>
        <div></div>
      </div>
      <div class="f-row"><label>Napomena</label><input id="f_rnap" value="${r?(r.napomena||''):''}"></div>
      <div class="m-foot"><button class="btn ghost" onclick="closeModal()">Otkaži</button><button class="btn" onclick="saveResurs('${rid||''}')">Sačuvaj</button></div>
    </div>`);
}
function saveResurs(rid){
  if(!isDirector()) return;
  const r0=rid?(DATA.resursi||[]).find(x=>x.id===rid):null; if(r0&&r0.gr&&!smemNa(r0.gr)) return;
  const v=id=>{const e=document.getElementById(id); return e?e.value:'';};
  const naziv=esc(String(v('f_rnaziv')).trim()); if(!naziv){ alert('Unesi naziv resursa.'); return; }
  const mod=v('f_rmod'), staroMod=r0?r0.modul||null:null; if(mod&&mod!==staroMod&&!modulDozvoljen(mod)){ alert('Nemaš pristup tom departmanu.'); return; }
  const o={ tip:v('f_rtip')||'alat', naziv, oznaka:esc(String(v('f_roznaka')).trim()), istice:v('f_ristice')||null, gr:v('f_rgr')||null, zaduzen:v('f_rzad')||null, napomena:esc(String(v('f_rnap')).trim()), modul:depIzForme(mod, staroMod) };
  const r=rid?(DATA.resursi||[]).find(x=>x.id===rid):null;
  if(r) Object.assign(r,o); else DATA.resursi.push(Object.assign({id:'r'+Date.now()},o));
  saveState(); closeModal(); renderNav(); render();
}

/* ---------- MAGACIN ---------- */
