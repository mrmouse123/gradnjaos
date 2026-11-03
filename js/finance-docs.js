/* ---------- TROSKOVI (STAVKE) ---------- */
function formTrosak(grId){
  if(!canFinance()){ alert('Unos troškova je dostupan direktoru.'); return; }
  const g=grById[grId]; if(!g||!smemNa(grId)) return;
  openModal(`
    <div class="m-h"><h3>Novi trošak</h3><button class="x" style="position:static" onclick="closeModal()">${icon('x')}</button></div>
    <div class="m-b">
      <div style="font-size:13px;color:var(--muted);margin:-6px 0 14px">${g.naziv}</div>
      <div class="f-row"><label>Opis</label><input id="f_tr_opis" placeholder="npr. Beton MB30 — 3. isporuka"></div>
      <div class="f-2">
        <div class="f-row"><label>Iznos bez PDV (RSD)</label><input id="f_tr_iznos" type="number" placeholder="npr. 12500"></div>
        <div class="f-row"><label>Kategorija</label><select id="f_tr_kat"><option>Materijal</option><option>Radna snaga</option><option>Mehanizacija</option><option>Podizvođači</option><option>Ostalo</option></select></div>
      </div>
      <div class="f-2">
        <div class="f-row"><label>Dobavljač (opciono)</label><input id="f_tr_dob" placeholder="npr. Lafarge BFC"></div>
        <div class="f-row"><label>Br. fakture (opciono)</label><input id="f_tr_fakt" placeholder="npr. IF-2026-0871"></div>
      </div>
      <div class="f-row"><label>Datum</label><input id="f_tr_datum" type="date" value="${todayStr()}"></div>
      <div class="m-foot">
        <button class="btn ghost" onclick="closeModal()">Otkaži</button>
        <button class="btn" onclick="saveTrosak('${grId}')">Sačuvaj trošak</button>
      </div>
    </div>`);
}
function saveTrosak(grId){
  if(!canFinance()||!smemNa(grId)) return;
  const v=id=>{const e=document.getElementById(id); return e?e.value:'';};
  const opis=esc(String(v('f_tr_opis')).trim()); const iznos=+v('f_tr_iznos')||0;
  if(!opis||!iznos){ alert('Unesi opis i iznos troška.'); return; }
  const g=grById[grId];
  if(g && !troskoviZa(grId).length && g.potroseno>0){
    DATA.troskovi_st.push({ id:'tr'+Date.now()+'-0', gr:grId, datum:g.pocetak, opis:'Preneto — troškovi do uvođenja evidencije', kat:'Ostalo', iznos:g.potroseno });
  }
  DATA.troskovi_st.push({ id:'tr'+Date.now(), gr:grId, datum:v('f_tr_datum')||todayStr(), opis, kat:v('f_tr_kat')||'Ostalo', iznos, dobavljac:esc(String(v('f_tr_dob')).trim()), fakt:esc(String(v('f_tr_fakt')).trim()) });
  saveState(); closeModal(); renderNav(); render(); openSite(grId);
}

/* ---------- PRILOG UZ TROSAK (faktura kao PDF/slika) ---------- */
function uploadTrosakPrilog(trId){
  if(!canFinance()) return;
  const t=(DATA.troskovi_st||[]).find(x=>x.id===trId); if(!t) return;
  try{
    const inp=document.createElement('input');
    inp.type='file'; inp.accept='.pdf,.jpg,.jpeg,.png';
    inp.onchange=e=>{
      const f=e.target.files&&e.target.files[0]; if(!f) return;
      if(f.size>2.5*1024*1024){ alert('Dokument je veći od 2.5MB — u pilotu važi taj limit (veći fajlovi stižu uz Supabase Storage).'); return; }
      const r=new FileReader();
      r.onload=()=>{ t.prilog={name:esc(f.name),datum:todayStr(),data:r.result}; saveState(); render(); openSite(t.gr); };
      r.readAsDataURL(f);
    };
    inp.click();
  }catch(e){}
}
/* Puna lista troskova gradilista (dobavljac, faktura, prilog) — samo uloge sa uvidom u finansije. */
function openTroskovi(grId){
  if(!canFinance()) return;
  const g=grById[grId]; if(!g||!vidimGr(grId)) return;
  const list=troskoviZa(grId).sort((a,b)=>dParse(b.datum)-dParse(a.datum)), brisi=smemBrisati(grId);
  const uk=list.reduce((a,t)=>a+(+t.iznos||0),0);
  const rows=list.map(t=>`<tr><td>${fmtDate(t.datum)}</td><td class="strong">${t.opis}</td><td>${t.kat||'—'}</td><td>${t.dobavljac||'—'}</td><td>${t.fakt||'—'}</td><td class="r num-cell">${fmtEur(t.iznos)}</td><td>${t.prilog?`<span style="color:var(--blue);font-weight:600;cursor:pointer" onclick="otvoriTrosakPrilog('${t.id}')">📄 ${t.prilog.name}</span>`:'—'}</td>${brisi?`<td class="r">${BRISI_DUGME('obrisiTrosak',t.id)}</td>`:''}</tr>`).join('');
  openModal(`
    <div class="m-h"><h3>Troškovi — ${g.naziv}</h3><button class="x" style="position:static" onclick="closeModal()">${icon('x')}</button></div>
    <div class="m-b">
      <div style="font-size:12.5px;color:var(--muted);margin-bottom:10px">${list.length} stavki</div>
      <div style="overflow-x:auto"><table>
        <thead><tr><th>Datum</th><th>Opis</th><th>Kategorija</th><th>Dobavljač</th><th>Br. fakture</th><th class="r">Iznos</th><th>Prilog</th>${brisi?'<th></th>':''}</tr></thead>
        <tbody>${rows}<tr><td class="strong" colspan="5">Ukupno</td><td class="r num-cell strong">${fmtEur(uk)}</td><td></td>${brisi?'<td></td>':''}</tr></tbody>
      </table></div>
      <div class="m-foot"><button class="btn ghost" onclick="closeModal()">Zatvori</button></div>
    </div>`);
}
function otvoriTrosakPrilog(trId){
  if(!canFinance()) return;
  const t=(DATA.troskovi_st||[]).find(x=>x.id===trId); if(!t||!t.prilog||!t.prilog.data) return;
  try{
    const parts=String(t.prilog.data).split(',');
    const bin=atob(parts[1]);
    const arr=new Uint8Array(bin.length);
    for(let i=0;i<bin.length;i++) arr[i]=bin.charCodeAt(i);
    const mime=(parts[0].match(/data:(.*?);/)||[])[1]||'application/pdf';
    window.open(URL.createObjectURL(new Blob([arr],{type:mime})),'_blank');
  }catch(e){}
}
function ukloniTrosakPrilog(trId){
  if(!canFinance()) return;
  const t=(DATA.troskovi_st||[]).find(x=>x.id===trId); if(!t) return;
  /* NULL, ne delete: PATCH postavlja samo kljuceve koje nosi — obrisan kljuc = prilog ostaje u bazi. */
  t.prilog=null; saveState(); render(); openSite(t.gr);
}

/* ---------- DOKUMENTI GRADILISTA (migracija 14): svako ko vidi gradiliste dodaje, brise svoje; super brise sve ---------- */
function dokumentiZa(grId){ return (DATA.dokumenti||[]).filter(d=>d.gr===grId).sort((a,b)=>dParse(b.datum)-dParse(a.datum)); }
function smemObrisatiDokument(d){ return !!d && (smemBrisati(d.gr) || (ROLE!=='all' && d.autor===ROLE)); }
/* Red dokumenta u DATA (migracija 22: predmer_id = dokument uz svesku Projektovanja). Vraca red ili null. */
function dodajDokument(o){
  if(!o || !vidimGr(o.gr)) return null;
  const pid=o.predmer_id && (DATA.predmer||[]).some(p=>p.id===o.predmer_id&&p.gr===o.gr) ? o.predmer_id : null;
  const d={ id:'dk'+Date.now(), gr:o.gr, predmer_id:pid, autor:isDirector()?'uprava':ROLE, datum:todayStr(), naziv:esc(o.naziv), tip:o.tip||'', velicina:o.velicina||0, opis:o.opis==null?'':esc(String(o.opis).trim()), data:o.data };
  DATA.dokumenti.push(d);
  saveState();
  return d;
}
function uploadDokument(grId, predmerId){
  if(!vidimGr(grId)) return;
  try{
    const inp=document.createElement('input');
    inp.type='file'; inp.accept='image/*,.pdf,.doc,.docx,.xls,.xlsx';
    inp.onchange=e=>{
      const f=e.target.files&&e.target.files[0]; if(!f) return;
      if(f.size>2.5*1024*1024){ alert('Dokument je veći od 2.5MB — u pilotu važi taj limit (veći fajlovi stižu uz Supabase Storage).'); return; }
      const r=new FileReader();
      r.onload=()=>{
        const opis=prompt('Kratak opis (opciono)');
        dodajDokument({ gr:grId, predmer_id:predmerId||null, naziv:f.name, tip:f.type||'', velicina:f.size, opis, data:r.result });
        openSite(grId);
      };
      r.readAsDataURL(f);
    };
    inp.click();
  }catch(e){}
}
async function otvoriDokument(id){
  const d=(DATA.dokumenti||[]).find(x=>x.id===id); if(!d||!vidimGr(d.gr)) return;
  let data=d.data;
  if(!data && typeof supa!=='undefined' && supa){
    try{ const r=await supa.rpc('dokument_podaci',{p_id:id}); if(!r.error) data=r.data; }catch(e){}
  }
  if(!data){ alert(typeof supa!=='undefined' && supa ? 'Sadržaj dokumenta nije dostupan.' : 'Sadržaj nije dostupan u demo režimu.'); return; }
  try{
    const i=String(data).indexOf(','), head=String(data).slice(0,i), body=String(data).slice(i+1);
    const mime=(head.match(/data:([^;,]*)/)||[])[1]||d.tip||'application/octet-stream';
    let blob;
    if(/;base64/.test(head)){
      const bin=atob(body), arr=new Uint8Array(bin.length);
      for(let k=0;k<bin.length;k++) arr[k]=bin.charCodeAt(k);
      blob=new Blob([arr],{type:mime});
    } else blob=new Blob([decodeURIComponent(body)],{type:mime});
    window.open(URL.createObjectURL(blob),'_blank');
  }catch(e){}
}
async function obrisiDokument(id){
  const d=(DATA.dokumenti||[]).find(x=>x.id===id);
  if(!d||!smemObrisatiDokument(d)) return;
  if(!confirm('Obrisati dokument "'+unesc(d.naziv)+'"?')) return;
  const ok=await obrisiRed('dokumenti', id, unesc(d.naziv));
  if(ok!==false) openSite(d.gr);
}

/* ---------- BRISANJE (C3): direktor brise sve; direktor modula redove svog modula (smemBrisati); radnik/spoljni samo svoj unos dnevnika ----------
   Svako brisanje: confirm() sa imenom reda -> obrisiRed (server prvo, log) -> render.
   Dugmad se crtaju samo kad je dozvoljeno; guard je i ovde (funkcije su globalne). */
async function obrisiStavku(tabela, id, opis, dozvoljeno, posle){
  if(!(jeSuper() || dozvoljeno)) return false;
  if(!confirm('Obrisati '+opis+'? Ovo se ne može vratiti.')) return false;
  const ok=await obrisiRed(tabela, id, opis);
  if(ok){ if(posle) posle(); render(); }
  return ok;
}
const BRISI_DUGME=(fn,id)=>`<button class="btn ghost" title="Obriši" style="padding:2px 8px;font-size:11px;color:var(--red)" onclick="event.stopPropagation();${fn}('${id}')">✕</button>`;
function obrisiZadatak(id){
  const t=(DATA.zadaci||[]).find(x=>x.id===id); if(!t||!smemBrisati(t.gr)) return false;
  return obrisiStavku('zadaci', id, 'zadatak "'+unesc(t.naziv)+'"', true);
}
function smemObrisatiUnos(e){ return !!e && (smemBrisati(e.gr) || (ROLE!=='all' && e.autor===ROLE)); }
function obrisiUnosDnevnika(id){
  const e=(DATA.dnevnik||[]).find(x=>x.id===id); if(!e||!smemObrisatiUnos(e)) return false;
  return obrisiStavku('dnevnik', id, 'unos u dnevnik od '+fmtDate(e.datum), true);
}
async function obrisiTrosak(id){
  const t=(DATA.troskovi_st||[]).find(x=>x.id===id); if(!t||!smemBrisati(t.gr)||!canFinance()) return false;
  const ok=await obrisiStavku('troskovi_st', id, 'trošak "'+unesc(t.opis)+'"', true);
  if(ok) openTroskovi(t.gr);
  return ok;
}
async function obrisiSituaciju(id){
  const s=(DATA.situacije||[]).find(x=>x.id===id); if(!s||!smemBrisati(s.gr)||!canFinance()) return false;
  const ok=await obrisiStavku('situacije', id, 'situaciju '+unesc(s.br), true);
  if(ok!==false){   // server: on delete cascade; lokalno isto + PUSHED
    (DATA.situacija_stavke||[]).filter(x=>x.sit===id).forEach(x=>{ if(PUSHED.situacija_stavke) delete PUSHED.situacija_stavke[x.id]; });
    DATA.situacija_stavke=(DATA.situacija_stavke||[]).filter(x=>x.sit!==id);
    preracunajSituacijeLokalno(s.gr); render();
  }
  return ok;
}
function obrisiPredmerRed(id){
  const x=(DATA.predmer||[]).find(r=>r.id===id); if(!x||!smemBrisati(x.gr)) return false;
  return obrisiStavku('predmer', id, 'poziciju "'+unesc(x.poz)+'"', true, ()=>{ osveziNapredak(x.gr); sinhronizujSveske(x.gr); (DATA.dokumenti||[]).forEach(d=>{ if(d.predmer_id===id) d.predmer_id=null; }); });   // napredak PRE render(); zadatak sveske odlazi (server: cascade)
}
function obrisiResurs(id){
  const r=(DATA.resursi||[]).find(x=>x.id===id); if(!r||!smemBrisati(r.gr)) return false;   // resurs bez gradilista (gr null) brise samo direktor
  return obrisiStavku('resursi', id, 'resurs "'+unesc(r.naziv)+'"', true);
}
function obrisiNarudzbu(id){
  const n=(DATA.narudzbe||[]).find(x=>x.id===id); if(!n||!smemBrisati(n.gr)) return false;
  const g=grById[n.gr];
  return obrisiStavku('narudzbe', id, 'trebovanje od '+fmtDate(n.datum)+(g?' ('+unesc(g.naziv)+')':''), true);
}
function obrisiKlijenta(id){
  const c=cliById[id]; if(!c||!jeSuper()) return false;
  const vezana=DATA.gradilista.filter(g=>g.klijent===id);
  if(vezana.length){ alert('Klijent ima gradilišta: '+vezana.map(g=>unesc(g.naziv)).join(', ')+'. Prvo promeni klijenta na tim gradilištima.'); return false; }
  return obrisiStavku('clijenti', id, 'klijenta "'+unesc(c.naziv)+'"');
}
function obrisiZaposlenog(id){
  const z=zapById[id]; if(!z||!jeSuper()) return false;
  const vodi=DATA.gradilista.filter(g=>g.rukovodilac===id);
  if(vodi.length){ alert('Prvo dodeli drugog rukovodioca na: '+vodi.map(g=>unesc(g.naziv)).join(', ')); return false; }
  return obrisiStavku('zaposleni', id, 'zaposlenog "'+unesc(z.ime)+'"', false, ()=>{
    const pj=PUSHED.zaposleni_gradiliste; if(pj) Object.keys(pj).filter(k=>k.indexOf(id+'|')===0).forEach(k=>delete pj[k]);
  });
}
function obrisiPodizvodjaca(id){
  const p=(DATA.podizvodjaci||[]).find(x=>x.id===id); if(!p||!jeSuper()) return false;
  return obrisiStavku('podizvodjaci', id, (modulEfektivni()==='projektovanje'?'spoljnog saradnika "':'podizvođača "')+unesc(p.naziv)+'"', false, ()=>{
    (DATA.predmer||[]).forEach(r=>{ if(r.zaduzen===id) r.zaduzen=null; });
    const pj=PUSHED.podizvodjac_gradiliste; if(pj) Object.keys(pj).filter(k=>k.indexOf(id+'|')===0).forEach(k=>delete pj[k]);
    saveState();
  });
}
async function obrisiGradiliste(id){
  const g=grById[id]; if(!g||!smemBrisati(id)) return false;
  if(!confirm('Obrisati gradilište "'+unesc(g.naziv)+'"? Ovo se ne može vratiti.')) return false;
  if(!confirm('Biće obrisani i svi zadaci, dnevnik, predmer, troškovi, situacije, trebovanja i dokumenta ovog gradilišta. Nastaviti?')) return false;
  const naziv=unesc(g.naziv);
  if(mode==='supabase'){
    try{ const {error}=await supa.rpc('obrisi_gradiliste',{p_gid:id}); if(error) throw new Error(error.message||String(error)); }
    catch(e){ console.error('Supabase obrisi_gradiliste:', e); alert('Brisanje nije uspelo: '+(e.message||e)); return false; }
  }
  const nosi=t=>{ if(!Array.isArray(DATA[t])) return; const sada=DATA[t].filter(r=>r.gr===id);
    sada.forEach(r=>{ if(PUSHED[t]) delete PUSHED[t][r.id]; });
    DATA[t]=DATA[t].filter(r=>r.gr!==id); };
  ['zadaci','dnevnik','narudzbe','predmer','troskovi_st','situacija_stavke','situacije','mag_promene','dokumenti','rad_na_zadatku'].forEach(nosi);
  (DATA.resursi||[]).forEach(r=>{ if(r.gr===id) r.gr=null; });
  DATA.zaposleni.forEach(z=>{ z.grs=(z.grs||[]).filter(x=>x!==id); z.bivsi=(z.bivsi||[]).filter(x=>x!==id); });
  (DATA.podizvodjaci||[]).forEach(p=>{ p.grs=(p.grs||[]).filter(x=>x!==id); });
  DATA.gradilista=DATA.gradilista.filter(x=>x.id!==id);
  if(PUSHED.gradilista) delete PUSHED.gradilista[id];
  JOIN_TABELE.forEach(t=>{ const pj=PUSHED[t]; if(pj) Object.keys(pj).filter(k=>k.slice(-(id.length+1))==='|'+id).forEach(k=>delete pj[k]); });
  if(mode!=='supabase') beleziLog('brisanje',{tabela:'gradilista', id, naziv});   // u bazi log pise server
  rebuildMaps(); saveState(); closeDrawer(); renderNav(); render();
  return true;
}

/* ---------- PODIZVODJACI ---------- */
function viewSubs(){
  const ids=visibleSiteIds();
  const fin=canFinance();
  const list=(DATA.podizvodjaci||[]).filter(x=>upravaSve()||(x.grs||[]).some(i=>ids.has(i)));
  const rows=list.map(x=>{
    const projs=(x.grs||[]).map(i=>grById[i]).filter(Boolean);
    const st=x.status==='zavrsen'?'<span class="badge b-gray">Završen</span>':'<span class="badge b-green">Aktivan</span>';
    return `<tr>
      <td><div class="who"><div class="av">${initials(x.naziv)}</div><div><div class="strong">${x.naziv}</div><div class="sub">${x.delatnost}</div></div></div></td>
      <td>${x.osoba}<div class="sub num">${x.tel}</div></td>
      <td>${projs.map(g=>`<span style="color:var(--blue);font-weight:600;cursor:pointer" onclick="openSite('${g.id}')">${g.naziv}</span>`).join('<div style="height:3px"></div>')||'—'}</td>
      ${fin?`<td class="r num-cell strong">${fmtEur(x.cena||0)}</td>`:''}
      <td>${st}</td>
      ${jeSuper()?`<td class="r">${BRISI_DUGME('obrisiPodizvodjaca',x.id)}</td>`:''}
    </tr>`;
  }).join('');
  return head(modulEfektivni()==='projektovanje'?'Spoljni saradnici':'Podizvođači','Angažovane firme po gradilištima — kontakt i status.') +
  `<div class="tools">${isDirector()?`<button class="btn" onclick="formSub()">${icon('plus')} Novi podizvođač</button>`:''}</div>
  <div class="card"><div style="overflow-x:auto"><table>
    <thead><tr><th>Podizvođač</th><th>Kontakt</th><th>Gradilišta</th>${fin?'<th class="r">Ugovoreno</th>':''}<th>Status</th>${jeSuper()?'<th></th>':''}</tr></thead>
    <tbody>${rows}</tbody></table>
    ${list.length?'':'<div class="empty">Još nema podizvođača.</div>'}
  </div>`;
}
function formSub(){
  openModal(`
    <div class="m-h"><h3>Novi podizvođač</h3><button class="x" style="position:static" onclick="closeModal()">${icon('x')}</button></div>
    <div class="m-b">
      <div class="f-2">
        <div class="f-row"><label>Naziv firme</label><input id="f_pnaziv" placeholder="npr. Elektromont d.o.o."></div>
        <div class="f-row"><label>Delatnost</label><input id="f_pdel" placeholder="npr. Elektroinstalacije"></div>
      </div>
      <div class="f-2">
        <div class="f-row"><label>Kontakt osoba</label><input id="f_posoba"></div>
        <div class="f-row"><label>Telefon</label><input id="f_ptel"></div>
      </div>
      <div class="f-row"><label>Ugovorena vrednost bez PDV (RSD)</label><input id="f_pcena" type="number" placeholder="npr. 85000"></div>
      <div class="f-row"><label>Gradilišta (može više)</label>
        <div class="chk-list">${DATA.gradilista.map(g=>`<label class="chk"><input type="checkbox" id="p_gr_${g.id}"> ${g.naziv}</label>`).join('')}</div>
      </div>
      <div class="m-foot">
        <button class="btn ghost" onclick="closeModal()">Otkaži</button>
        <button class="btn" onclick="saveSub()">Sačuvaj podizvođača</button>
      </div>
    </div>`);
}
function saveSub(){
  if(!isDirector()) return;
  const v=id=>{const e=document.getElementById(id); return e?e.value:'';};
  const naziv=esc(String(v('f_pnaziv')).trim()); if(!naziv){ alert('Unesi naziv podizvođača.'); return; }
  const grs=DATA.gradilista.filter(g=>{const c=document.getElementById('p_gr_'+g.id); return c&&c.checked;}).map(g=>g.id);
  DATA.podizvodjaci.push({ id:'p'+Date.now(), naziv, delatnost:esc(String(v('f_pdel')).trim())||'—', osoba:esc(String(v('f_posoba')).trim())||'—', tel:esc(String(v('f_ptel')).trim())||'—', grs, cena:+v('f_pcena')||0, status:'aktivan' });
  saveState(); closeModal(); renderNav(); render();
}

