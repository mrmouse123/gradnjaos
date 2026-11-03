/* ---------- NALOZI I LOG (direktor) ----------
   Uloge se dodeljuju POSTOJECIM auth nalozima (kreiranje korisnika ostaje u Supabase
   dashboardu dok Jovan ne podesi Site URL / self-signup). RPC-ovi iz migracije 12 su
   security definer sa sopstvenim guardom (je_direktor, ne sebi, ne poslednjem direktoru). */
let NALOZI=null, LOG_K=null, NALOZI_MSG='', ANGAZ=null, ANG_OD='', ANG_DO='';
/* Potrosnja asistenta (2026-10-22): tokeni iz log_koriscenja (ai_pitanje.tokeni) za TEKUCI mesec, cena po AI_CENE.
   Cene = Claude Sonnet 5.5, USD po milion tokena (2026-10-22): ulaz 2, izlaz 10, citanje kesa 0,20, upis kesa 2,50;
   limit = mesecni limit workspace-a u Anthropic konzoli (Jovan, 30 USD). Promena modela/cena → ovde. Uvid, ne kontrola:
   pravi limit sprovodi Anthropic. Sopstveni upit (ne LOG_K: lista je ogranicena na 200 dogadjaja). */
const AI_CENE={ulaz:2, izlaz:10, kes:0.20, kesUpis:2.50, limit:30, model:'Sonnet 5.5'};
let AI_POTROSNJA=null;
function aiPotrosnjaIz(redovi){
  const t={pitanja:0, ulaz:0, kes:0, kesUpis:0, izlaz:0};
  (redovi||[]).forEach(r=>{ const k=(r&&r.detalj&&r.detalj.tokeni)||{}; t.pitanja++; t.ulaz+=+k.ulaz||0; t.kes+=+k.kes||0; t.kesUpis+=+k.kesUpis||0; t.izlaz+=+k.izlaz||0; });
  t.usd=(t.ulaz*AI_CENE.ulaz+t.izlaz*AI_CENE.izlaz+t.kes*AI_CENE.kes+t.kesUpis*AI_CENE.kesUpis)/1e6;
  return t;
}
const fmtUsd=n=>(Math.round((+n||0)*100)/100).toFixed(2).replace('.',',')+' USD';
function aiPotrosnjaKartica(){
  if(!supa) return '';
  const t=AI_POTROSNJA, mesec=todayStr().slice(0,7);
  const telo = !t ? '<div class="empty">Učitavam…</div>' : (()=>{
    const sve=t.ulaz+t.kes+t.kesUpis+t.izlaz, pct=Math.min(100, Math.round(t.usd/AI_CENE.limit*100)), kesPct=(t.ulaz+t.kes+t.kesUpis)?Math.round(t.kes/(t.ulaz+t.kes+t.kesUpis)*100):0;
    const boja=pct>=90?'var(--red)':pct>=60?'var(--amber)':'var(--green)';
    return `<div class="ai-danas" style="padding:0 0 10px">
      <div><b class="num">${t.pitanja}</b><small>pitanja</small></div>
      <div><b class="num">${Math.round(sve/1000)}k</b><small>tokena (ulaz ${Math.round((t.ulaz+t.kes+t.kesUpis)/1000)}k · izlaz ${Math.round(t.izlaz/1000)}k)</small></div>
      <div><b class="num">${kesPct}%</b><small>iz keša</small></div>
      <div><b class="num" style="color:${boja}">${fmtUsd(t.usd)}</b><small>od ${AI_CENE.limit} USD limita</small></div>
    </div>
    <div style="height:6px;border-radius:3px;background:var(--line);overflow:hidden"><div style="width:${pct}%;height:100%;background:${boja}"></div></div>`; })();
  return `<div class="card" style="margin-bottom:18px">
    <div class="card-h"><h3>Asistent — potrošnja ${mesec}</h3><span class="hint">${AI_CENE.model} · USD/M tokena: ulaz ${AI_CENE.ulaz}, izlaz ${AI_CENE.izlaz}, keš ${AI_CENE.kes}/${AI_CENE.kesUpis} · limit se sprovodi u Anthropic konzoli</span></div>
    <div class="card-b" style="padding:14px 16px">${telo}</div>
  </div>`;
}
function angazPeriod(){
  const dan=d=>{ const x=new Date(d); return x.getFullYear()+'-'+String(x.getMonth()+1).padStart(2,'0')+'-'+String(x.getDate()).padStart(2,'0'); };
  if(!ANG_DO) ANG_DO=dan(Date.now());
  if(!ANG_OD) ANG_OD=dan(Date.now()-30*86400000);
  return [ANG_OD, ANG_DO];
}
function angazovanostKartica(){
  const [od,do_]=angazPeriod();
  const rows = supa ? ANGAZ : agregirajAngazovanost(DATA.rad_na_zadatku, od, do_);
  const tr=(rows||[]).map(r=>{
    const res=(DATA.resursi||[]).filter(x=>x.zaduzen===r.osoba).map(x=>x.naziv).join(', ')||'—';
    const kad=r.poslednji?fmtDate(lokalniDatum(r.poslednji))+' '+hhmm(r.poslednji):'—';
    return `<tr><td class="strong">${imeTajmera(r.osoba)}</td><td>${grById[r.gr]?grById[r.gr].naziv:'—'}</td><td class="num">${r.sesija}</td><td class="num">${(r.minuta/60).toFixed(1).replace('.',',')}</td><td>${kad}</td><td class="sub">${res}</td></tr>`;
  }).join('');
  return `<div class="card" style="margin-bottom:18px">
    <div class="card-h"><h3>Angažovanost radnika (30 dana)</h3><span class="hint">Sati rada na zadacima (tajmer) i resursi koje radnik koristi</span></div>
    <div class="card-b tight">
      <div class="tools" style="margin:12px 16px 4px">
        <label class="sub">od <input type="date" id="ang_od" value="${od}"></label>
        <label class="sub">do <input type="date" id="ang_do" value="${do_}"></label>
        <button class="btn ghost" onclick="osveziAngaz()">Osveži</button>
      </div>
      <div style="overflow-x:auto"><table><thead><tr><th>Osoba</th><th>Gradilište</th><th>Sesija</th><th>Sati</th><th>Poslednji rad</th><th>Zaduženi resursi</th></tr></thead>
      <tbody>${tr||`<tr><td colspan="6" class="empty">${rows===null?'Učitavam…':'Nema evidentiranog rada u periodu.'}</td></tr>`}</tbody></table></div>
    </div>
  </div>`;
}
function osveziAngaz(){
  if(!isDirector()) return;
  const v=id=>{ const e=document.getElementById(id); return e?String(e.value):''; };
  if(/^\d{4}-\d{2}-\d{2}$/.test(v('ang_od'))) ANG_OD=v('ang_od');
  if(/^\d{4}-\d{2}-\d{2}$/.test(v('ang_do'))) ANG_DO=v('ang_do');
  if(supa){ ucitajNaloge(); } else render();
}
/* Sifarnik mera u Admin kokpitu (uprava: dodaj/aktivan; samo direktor brise). Nazivi/grupe idu kroz esc() pri upisu. */
const SF_JM=['m³','m²','m','kom','kg','t','h','paušal'];
/* Sifarnik zivi u modalu sa taba Gradilista (2026-10-11: izbacen iz Admin kokpita na zahtev). Akcije u njemu
   zovu render() (stranica ispod), pa modal osvezava osveziSifrarnikModal(). */
function formSifrarnik(){
  if(!isDirector()) return;
  openModal(`<div class="m-h"><h3>Šifarnik mera</h3><button class="x" style="position:static" onclick="closeModal()">${icon('x')}</button></div>
    <div class="m-b">${sifrarnikKartica()}</div>`);
}
function osveziSifrarnikModal(){ const m=document.getElementById('modal'); if(m && String(m.innerHTML||'').includes('id="sf_naziv"')) formSifrarnik(); }
function sifrarnikKartica(){
  const sve=(DATA.sifrarnik||[]).filter(s=>s.modul!=='projektovanje').sort((a,b)=>(a.redosled||0)-(b.redosled||0));   // Projektovanje nema sifarnik (sveske = tipovi dokumentacije)
  const grupe=[...new Set(sve.map(s=>s.grupa).filter(Boolean))];
  const rows=sve.map(s=>`<tr${s.aktivan===false?' style="opacity:.55"':''}><td>${s.modul==='projektovanje'?'Projektovanje':s.modul==='izvodjenje'?'Izvođenje':'Oba'}</td><td>${s.grupa||'—'}</td><td class="num">${s.sifra||''}</td><td class="strong">${s.naziv}</td><td>${s.jm||'—'}</td>
    <td><label class="chk" style="margin:0"><input type="checkbox" ${s.aktivan===false?'':'checked'} onchange="toggleSifrarnik('${s.id}')"> ${s.aktivan===false?'ne':'da'}</label></td>
    <td class="r">${jeSuper()?`<button class="btn ghost" style="padding:2px 8px;font-size:11px;color:var(--red)" onclick="obrisiSifrarnik('${s.id}')">✕</button>`:''}</td></tr>`).join('');
  return `<div class="card" style="margin-bottom:18px">
    <div class="card-h"><h3>Šifarnik artikala i usluga (${sve.length})</h3><span class="hint">Izvođenje: artikli (ELOM) + usluge · bira se u predmeru i situacijama · neaktivne stavke se ne nude</span></div>
    <div class="card-b tight">
      <div style="overflow-x:auto;max-height:340px;overflow-y:auto"><table><thead><tr><th>Modul</th><th>Grupa</th><th>Šifra</th><th>Naziv</th><th>JM</th><th>Aktivan</th><th></th></tr></thead>
      <tbody>${rows||'<tr><td colspan="7" class="empty">Šifarnik je prazan.</td></tr>'}</tbody></table></div>
      <div class="tools" style="margin:14px 16px 4px">
        <input id="sf_sifra" placeholder="šifra" style="width:90px">
        <input id="sf_naziv" placeholder="naziv pozicije / artikla" style="min-width:200px">
        <select id="sf_jm">${SF_JM.map(j=>`<option value="${j}">${j}</option>`).join('')}</select>
        <input id="sf_grupa" list="sf_grupe" placeholder="grupa"><datalist id="sf_grupe">${grupe.map(x=>`<option value="${x}">`).join('')}</datalist>
        <input type="hidden" id="sf_modul" value="izvodjenje">
        <button class="btn" onclick="saveSifrarnik()">Dodaj</button>
      </div>
    </div>
  </div>`;
}
function saveSifrarnik(){
  if(!isDirector()) return;
  const v=id=>{ const e=document.getElementById(id); return e?String(e.value):''; };
  const naziv=esc(v('sf_naziv').trim()); if(!naziv){ alert('Unesi naziv pozicije.'); return; }
  const modul=v('sf_modul')==='projektovanje'?'projektovanje':'izvodjenje';
  DATA.sifrarnik=DATA.sifrarnik||[];
  const max=DATA.sifrarnik.reduce((m,s)=>Math.max(m,s.redosled||0),0);
  DATA.sifrarnik.push({id:'sf'+Date.now(), naziv, jm:v('sf_jm')||'kom', grupa:esc(v('sf_grupa').trim())||null, modul, redosled:max+1, aktivan:true, sifra:esc(v('sf_sifra').trim())||null});
  saveState(); render(); osveziSifrarnikModal();
}
function toggleSifrarnik(id){
  if(!isDirector()) return;
  const s=(DATA.sifrarnik||[]).find(x=>x.id===id); if(!s) return;
  s.aktivan=(s.aktivan===false); saveState(); render(); osveziSifrarnikModal();
}
async function obrisiSifrarnik(id){
  if(!jeSuper()) return;
  const s=(DATA.sifrarnik||[]).find(x=>x.id===id); if(!s) return;
  if(!confirm('Obrisati iz šifarnika "'+unesc(s.naziv)+'"?')) return;
  const ok=await obrisiRed('sifrarnik', id, unesc(s.naziv));
  if(ok!==false){ render(); osveziSifrarnikModal(); }
}
function viewNalozi(){
  if(!jePunaUprava()){ current='dash'; return viewDash(); }   // samo direktor/admin (migracija 28); direktor modula nema kokpit
  const h=head('Nalozi i log korišćenja','Ko ima pristup, sa kojom ulogom, i šta je ko radio u aplikaciji.');
  if(!supa) return h+'<div class="card" style="margin-bottom:18px"><div class="empty">Radi samo kad je aplikacija povezana sa bazom (Supabase). U demo režimu nema naloga.</div></div>'+angazovanostKartica();
  if(NALOZI===null && !NALOZI_MSG) ucitajNaloge();
  const zOpt=DATA.zaposleni.map(z=>`<option value="${z.id}">${z.ime}</option>`).join('');
  const sOpt=(DATA.podizvodjaci||[]).map(p=>`<option value="${p.id}">${p.naziv}</option>`).join('');
  /* direktorske uloge dodeljuje samo direktor (server to sprovodi; UI ne nudi) */
  const ulOpt=(sel)=>ULOGE.filter(([v])=>v===sel||smemDodelitiUlogu(v)).map(([v,l])=>`<option value="${v}" ${sel===v?'selected':''}>${l}</option>`).join('');
  const modChk=(idp,idi,nm)=>`<label class="chk" style="margin:0"><input type="checkbox" id="${idp}" ${nm.includes('projektovanje')?'checked':''}> projektovanje</label><label class="chk" style="margin:0"><input type="checkbox" id="${idi}" ${nm.includes('izvodjenje')?'checked':''}> izvođenje</label>`;
  const mojEmail=(SESIJA&&SESIJA.user&&SESIJA.user.email||'').toLowerCase();
  const redovi=(NALOZI||[]).map(n=>{
    const moj=(n.email||'').toLowerCase()===mojEmail, zakljucan=!smemMenjatiNalog(n);
    const kad=n.poslednja_prijava?fmtDate(String(n.poslednja_prijava).slice(0,10))+' '+String(n.poslednja_prijava).slice(11,16):'—';
    const st=n.bez_profila?'<span class="badge b-amber">bez uloge</span>':moj?'<span class="badge b-blue">ti</span>':'<span class="badge b-green">aktivan</span>';
    const u=esc(n.user_id), ul=n.uloga||'';
    const nm=normalizujModule(n.moduli), modPolja=(ul==='rukovodilac'||n.bez_profila);   // radnik: modul je uvek projektovanje (migracija 32)
    const kontrole = (moj||zakljucan) ? `<span class="sub">${ulogaLabela(n.uloga, n.vidi_finansije, n.moduli)}${zakljucan?' · menja samo direktor':''}</span>` :
      `<select id="nu_${u}" onchange="naloziTogglZap('${u}')">${n.bez_profila?'<option value="">— izaberi —</option>':''}${ulOpt(ul)}</select>
       <select id="nz_${u}" style="${ul==='rukovodilac'||ul==='radnik'||n.bez_profila?'':'display:none'}"><option value="">— zaposleni —</option>${DATA.zaposleni.map(z=>`<option value="${z.id}" ${n.zaposleni_id===z.id?'selected':''}>${z.ime}</option>`).join('')}</select>
       <select id="ns_${u}" style="${ul==='spoljni'?'':'display:none'}"><option value="">— saradnik —</option>${(DATA.podizvodjaci||[]).map(p=>`<option value="${p.id}" ${n.saradnik_id===p.id?'selected':''}>${p.naziv}</option>`).join('')}</select>
       <label class="chk" id="nfl_${u}" style="margin:0;${ul==='rukovodilac'?'':'display:none'}"><input type="checkbox" id="nf_${u}" ${n.vidi_finansije?'checked':''}> vidi finansije</label>
       <span id="nml_${u}" style="display:${modPolja?'inline-flex':'none'};gap:6px">${modChk('nmp_'+u,'nmi_'+u,nm)}</span>
       <button class="btn ghost" style="padding:4px 10px;font-size:12px" onclick="dodeliUlogu('${esc(n.email)}','${u}')">Sačuvaj</button>
       ${n.bez_profila?'':`<button class="btn ghost" style="padding:4px 10px;font-size:12px;color:var(--red)" onclick="ukloniPristup('${esc(n.email)}')">Ukloni</button>`}`;
    return `<tr><td class="strong">${esc(n.email||'')}</td><td>${esc(n.ime||'')}</td><td>${st}</td><td>${kad}</td><td><div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">${kontrole}</div></td></tr>`;
  }).join('');
  const DOG={magacin_predmer:'Magacin: skinuto po predmeru',resursi_departman:'Dodela resursa departmanu',ai_pitanje:'Pitanje asistentu',ai_akcija:'Akcija iz asistenta',prijava:'Prijava',odjava:'Odjava',otvaranje:'Otvaranje',cuvanje:'Čuvanje',uloga_promena:'Promena uloge',pristup_uklonjen:'Pristup uklonjen',brisanje:'Brisanje',zadatak_start:'▶ Početak zadatka',zadatak_pauza:'⏸ Pauza zadatka',zadatak_kraj:'■ Kraj zadatka'};
  const logRed=l=>{ const d=l.detalj||{}; let det='';
    if(l.dogadjaj==='cuvanje') det=Object.entries(d).map(([t,n])=>t+' ×'+n).join(', ');
    else if(l.dogadjaj==='zadatak_start'||l.dogadjaj==='zadatak_pauza'||l.dogadjaj==='zadatak_kraj') det='„'+(d.naziv||d.zadatak||'')+'"'+(d.opis?' — '+d.opis:'')+(d.gr&&grById[d.gr]?' · '+unesc(grById[d.gr].naziv):'')+(d.minuta!=null?' · '+fmtTrajanje(d.minuta):'')+(d.ukupno!=null&&d.ukupno!==d.minuta?' · ukupno '+fmtTrajanje(d.ukupno):'');
    else if(l.dogadjaj==='uloga_promena') det=(d.email||'')+': '+(d.stara||'—')+' → '+(d.nova||'')+(d.zaposleni_id?' ('+d.zaposleni_id+')':'');
    else if(l.dogadjaj==='pristup_uklonjen') det=(d.email||'')+' ('+(d.stara||'')+')';
    else if(l.dogadjaj==='brisanje') det=(d.tabela||'')+' '+(d.naziv||d.id||'');
    else det=[d.uredjaj,d.verzija].filter(Boolean).join(' · ');
    const ts=String(l.ts||''); return `<tr><td class="num">${fmtDate(ts.slice(0,10))} ${ts.slice(11,16)}</td><td>${esc(l.email||'')}</td><td>${esc(l.uloga||'')}</td><td>${DOG[l.dogadjaj]||esc(l.dogadjaj)}</td><td class="sub">${esc(det)}</td></tr>`; };
  return h+`
  <div class="card" style="margin-bottom:18px">
    <div class="card-h"><h3>Nalozi (${(NALOZI||[]).length})</h3><span class="hint">Novi korisnik: Supabase → Authentication → Users → Add user, pa mu ovde dodeli ulogu · rukovodilac: jedan ili oba modula · radnik: tačno jedan</span></div>
    <div class="card-b tight">
      ${NALOZI_MSG?`<div class="banner" style="margin:12px 16px">${NALOZI_MSG}</div>`:''}
      <div style="overflow-x:auto"><table><thead><tr><th>Email</th><th>Ime</th><th>Stanje</th><th>Poslednja prijava</th><th>Uloga</th></tr></thead>
      <tbody>${redovi||`<tr><td colspan="5" class="empty">${NALOZI===null?'Učitavam…':'Nema naloga.'}</td></tr>`}</tbody></table></div>
      <div class="tools" style="margin:14px 16px 4px">
        <input id="n_email" placeholder="email postojećeg naloga" style="min-width:220px">
        <select id="n_uloga" onchange="naloziTogglZap('')">${ulOpt('rukovodilac')}</select>
        <select id="n_zap"><option value="">— zaposleni —</option>${zOpt}</select>
        <select id="n_sar" style="display:none"><option value="">— saradnik —</option>${sOpt}</select>
        <label class="chk" id="n_finl" style="margin:0"><input type="checkbox" id="n_fin"> vidi finansije</label>
        <span id="n_modl" style="display:inline-flex;gap:6px">${modChk('n_mp','n_mi',MODULI)}</span>
        <button class="btn" onclick="dodeliUlogu()">Dodeli ulogu</button>
      </div>
    </div>
  </div>
  ${aiPotrosnjaKartica()}
  ${angazovanostKartica()}
  <div class="card">
    <div class="card-h"><h3>Log korišćenja</h3><span class="hint">poslednjih ${(LOG_K||[]).length} događaja · <button class="btn ghost" style="padding:2px 8px;font-size:11px" onclick="ucitajNaloge()">↻ Osveži</button></span></div>
    <div class="card-b tight"><div style="overflow-x:auto"><table><thead><tr><th>Kada</th><th>Ko</th><th>Uloga</th><th>Događaj</th><th>Detalj</th></tr></thead>
      <tbody>${(LOG_K||[]).map(logRed).join('')||`<tr><td colspan="5" class="empty">${LOG_K===null?'Učitavam…':'Još nema zapisa.'}</td></tr>`}</tbody></table></div></div>
  </div>`;
}
/* Ko koju ulogu sme da dodeli / koji nalog sme da menja (isto kao server dodeli_ulogu / ukloni_pristup, migracija 28):
   samo puna uprava (direktor/admin); direktorske uloge samo direktor. Direktor modula nema Admin kokpit. */
function smemDodelitiUlogu(v){ if(!jePunaUprava()) return false; if(DIREKTORSKE.includes(v)) return jeSuper(); return true; }
function smemMenjatiNalog(n){
  if(!jePunaUprava()) return false;
  if(n.bez_profila) return true;
  if(DIREKTORSKE.includes(n.uloga)) return jeSuper();
  return true;
}
/* prikazi polja koja uloga trazi: zaposleni (rukovodilac/radnik), saradnik (spoljni), finansije (rukovodilac). uid='' = forma za novi */
function naloziTogglZap(uid){
  const g=id=>document.getElementById(uid?id+'_'+uid:{nu:'n_uloga',nz:'n_zap',ns:'n_sar',nfl:'n_finl',nml:'n_modl'}[id]);
  const u=g('nu'); if(!u) return; const v=u.value;
  const z=g('nz'), s=g('ns'), f=g('nfl'), m=g('nml');
  if(z) z.style.display=(v==='rukovodilac'||v==='radnik')?'':'none';
  if(m) m.style.display=v==='rukovodilac'?'inline-flex':'none';   // radnik: samo projektovanje, bez izbora modula (migracija 32)
  if(s) s.style.display=v==='spoljni'?'':'none';
  if(f) f.style.display=v==='rukovodilac'?'':'none';
}
async function ucitajNaloge(){
  if(!jePunaUprava()||!supa) return;
  NALOZI_MSG='';
  try{
    const [od,do_]=angazPeriod();
    const [{data:n,error:e1},{data:l,error:e2},{data:a,error:e3},{data:p,error:e4}]=await Promise.all([
      supa.rpc('nalozi_pregled'),
      supa.from('log_koriscenja').select('*').order('ts',{ascending:false}).limit(200),
      supa.rpc('angazovanost',{p_od:od, p_do:do_}),
      supa.from('log_koriscenja').select('detalj').eq('dogadjaj','ai_pitanje').gte('ts', new Date(TODAY.getFullYear(), TODAY.getMonth(), 1).toISOString()).limit(5000)
    ]);
    if(e1) throw new Error(e1.message||String(e1));
    if(e2) throw new Error(e2.message||String(e2));
    if(e3) throw new Error(e3.message||String(e3));
    if(e4) throw new Error(e4.message||String(e4));
    NALOZI=n||[]; LOG_K=l||[]; ANGAZ=a||[]; AI_POTROSNJA=aiPotrosnjaIz(p||[]);
  }catch(e){ NALOZI=NALOZI||[]; LOG_K=LOG_K||[]; ANGAZ=ANGAZ||[]; NALOZI_MSG='Ne mogu da učitam naloge: '+esc(e.message||e); }
  if(current==='nalozi') render();
}
async function dodeliUlogu(email, uid){
  if(!jePunaUprava()||!supa) return;
  const v=id=>{ const e=document.getElementById(id); return e?e.value:''; };
  email=(email||v('n_email')).trim().toLowerCase();
  const uloga=uid?v('nu_'+uid):v('n_uloga'), zap=(uid?v('nz_'+uid):v('n_zap'))||null, sar=(uid?v('ns_'+uid):v('n_sar'))||null;
  const finEl=document.getElementById(uid?'nf_'+uid:'n_fin'), fin=uloga==='rukovodilac'&&!!(finEl&&finEl.checked);
  if(!email||!/@/.test(email)){ alert('Unesi email naloga.'); return; }
  if(!ULOGE.some(u=>u[0]===uloga)){ alert('Izaberi ulogu.'); return; }
  if(!smemDodelitiUlogu(uloga)){ alert('Direktorske uloge dodeljuje samo direktor.'); return; }
  if((uloga==='rukovodilac'||uloga==='radnik')&&!zap){ alert((uloga==='rukovodilac'?'Rukovodilac':'Radnik')+' mora biti vezan za zaposlenog.'); return; }
  if(uloga==='spoljni'&&!sar){ alert('Spoljni saradnik mora biti vezan za podizvođača / saradnika.'); return; }
  const chk=id=>{ const e=document.getElementById(id); return !!(e&&e.checked); };
  const mods=[]; if(chk(uid?'nmp_'+uid:'n_mp')) mods.push('projektovanje'); if(chk(uid?'nmi_'+uid:'n_mi')) mods.push('izvodjenje');
  const trebaModul=(uloga==='rukovodilac');   // radnik → uvek ['projektovanje'] (migracija 32)
  if(trebaModul&&!mods.length){ alert('Izaberi bar jedan modul (projektovanje / izvođenje).'); return; }
  const {data,error}=await supa.rpc('dodeli_ulogu',{p_email:email, p_uloga:uloga, p_zaposleni_id:(uloga==='rukovodilac'||uloga==='radnik')?zap:null, p_vidi_finansije:fin, p_saradnik_id:uloga==='spoljni'?sar:null, p_moduli:trebaModul?mods:(uloga==='radnik'?['projektovanje']:null)});
  if(error){ alert('Nije uspelo: '+(error.message||error)); return; }
  NALOZI_MSG='✓ '+esc(email)+': uloga '+(data==='dodeljeno'?'dodeljena':'izmenjena')+'. Korisnik je vidi pri sledećem otvaranju aplikacije.';
  await ucitajNaloge();
}
async function ukloniPristup(email){
  if(!jePunaUprava()||!supa) return;
  if(!confirm('Ukloniti pristup za '+unesc(email)+'? Nalog ostaje, ali neće videti nijedan podatak dok mu ponovo ne dodeliš ulogu.')) return;
  const {error}=await supa.rpc('ukloni_pristup',{p_email:email});
  if(error){ alert('Nije uspelo: '+(error.message||error)); return; }
  NALOZI_MSG='Pristup uklonjen za '+esc(email)+'.';
  await ucitajNaloge();
}

/* Magacin = sifarnik Izvodjenja (81 artikal ELOM) + Razno (odluka klijenta 2026-10-12). Red u DATA.magacin za artikal
   iz sifarnika nastaje tek na PRVOM ulazu, sa deterministickim id-jem 'mg-'+sifarnik.id (dva taba → PK sudar, ne
   duplikat; lekcija 33); do tada je red virtuelan (stanje 0) i NIKAD se ne gura u DATA (diff bi poslao 81 insert).
   Razno = redovi magacina koji nisu artikli sifarnika (rucno dodati, demo m1–m3). Tab vidi uprava i profil sa modulom
   izvodjenje (tabDozvoljen). */
const MG_PREFIX='mg-';
function magacinArtikal(mid){   // postojeci red ILI virtuelan iz sifarnika — virtuelan se ne upisuje dok saveMagPromena (ulaz) ne odluci
  const m=(DATA.magacin||[]).find(x=>x.id===mid); if(m) return m;
  if(!String(mid).startsWith(MG_PREFIX)) return null;
  const sf=(DATA.sifrarnik||[]).find(x=>x.id===String(mid).slice(MG_PREFIX.length)); if(!sf) return null;
  return { id:mid, naziv:sf.naziv, jm:sf.jm||'kom', stanje:0 };
}
function filtrirajMagacin(inp){
  const q=String(inp&&inp.value||'').trim().toLowerCase();
  document.querySelectorAll('#view tr[data-txt]').forEach(tr=>{ tr.style.display=(!q||String(tr.dataset.txt||'').includes(q))?'':'none'; });
}
function viewMagacin(){
  if(!tabDozvoljen('magacin')){ current='dash'; return viewDash(); }   // segment Projektovanje / nalog bez izvodjenja (zahtev 2026-10-23)
  const artikli=sifrarnikZa('izvodjenje'), sfIds=new Set(artikli.map(x=>MG_PREFIX+x.id));
  const red=(m,sifra)=>{
    const posl=(DATA.mag_promene||[]).filter(x=>x.mid===m.id).sort((a,b)=>dParse(b.datum)-dParse(a.datum))[0];
    return `<tr data-txt="${String(sifra+' '+m.naziv).toLowerCase()}">
      <td class="num sub">${sifra||'—'}</td><td class="strong">${m.naziv}</td><td>${m.jm}</td>
      <td class="r"><b class="num" style="font-size:14px">${m.stanje}</b></td>
      <td class="sub">${posl?`${posl.tip==='ulaz'?'⬆ ulaz':'⬇ izlaz'} ${posl.kol} ${m.jm} · ${fmtDate(posl.datum)}${posl.gr&&grById[posl.gr]?' → '+grById[posl.gr].naziv:''}`:'—'}</td>
      <td class="r">
        ${isDirector()?`<button class="btn ghost" style="padding:5px 10px;font-size:11.5px" onclick="formMagPromena('${m.id}','ulaz')">⬆ Ulaz</button>`:''}
        ${mogaDaUpravljam()&&(+m.stanje||0)>0?`<button class="btn ghost" style="padding:5px 10px;font-size:11.5px" onclick="formMagPromena('${m.id}','izlaz')">⬇ Izlaz</button>`:''}
      </td>
    </tr>`;
  };
  const rowsSf=artikli.map(x=>red(magacinArtikal(MG_PREFIX+x.id), x.sifra||'')).join('');
  const razno=(DATA.magacin||[]).filter(m=>!sfIds.has(m.id));
  const glava=`<thead><tr><th>Šifra</th><th>Artikal</th><th>JM</th><th class="r">Stanje</th><th>Poslednja promena</th><th class="r"></th></tr></thead>`;
  return head('Magacin','Stanje materijala po šifarniku — ulaz u magacin i izdavanje na gradilišta.') +
  `<div class="tools"><input placeholder="Pretraži artikle (šifra, naziv)…" oninput="filtrirajMagacin(this)" style="flex:1;min-width:0">${isDirector()?`<button class="btn" onclick="formArtikal()">${icon('plus')} Razno (van šifarnika)</button>`:''}</div>
  <div class="card"><div class="card-h"><h3>Šifarnik artikala (${artikli.length})</h3><span class="hint">stanje 0 = nema na stanju</span></div>
    <div style="overflow-x:auto"><table id="magTabela">${glava}<tbody>${rowsSf}</tbody></table></div>
    ${artikli.length?'':'<div class="empty">Šifarnik Izvođenja je prazan.</div>'}
  </div>
  <div class="card" style="margin-top:14px"><div class="card-h"><h3>Razno (${razno.length})</h3><span class="hint">artikli van šifarnika</span></div>
    <div style="overflow-x:auto"><table>${glava}<tbody>${razno.map(m=>red(m,'')).join('')}</tbody></table></div>
    ${razno.length?'':'<div class="empty">Nema artikala van šifarnika.</div>'}
  </div>`;
}
function formArtikal(){
  if(!isDirector()) return;
  openModal(`
    <div class="m-h"><h3>Razno — artikal van šifarnika</h3><button class="x" style="position:static" onclick="closeModal()">${icon('x')}</button></div>
    <div class="m-b">
      <div class="f-2">
        <div class="f-row"><label>Naziv</label><input id="f_mnaziv" placeholder="npr. Cement CEM II 42.5R"></div>
        <div class="f-row"><label>JM</label><select id="f_mjm"><option>kom</option><option>t</option><option>kg</option><option>m³</option><option>m²</option><option>m</option><option>l</option><option>paleta</option><option>džak</option></select></div>
      </div>
      <div class="f-row"><label>Početno stanje</label><input id="f_mstanje" type="number" value="0"></div>
      <div class="m-foot"><button class="btn ghost" onclick="closeModal()">Otkaži</button><button class="btn" onclick="saveArtikal()">Sačuvaj</button></div>
    </div>`);
}
function saveArtikal(){
  if(!isDirector()) return;
  const v=id=>{const e=document.getElementById(id); return e?e.value:'';};
  const naziv=esc(String(v('f_mnaziv')).trim()); if(!naziv){ alert('Unesi naziv artikla.'); return; }
  DATA.magacin.push({ id:'m'+Date.now(), naziv, jm:v('f_mjm')||'kom', stanje:+String(v('f_mstanje')).replace(',','.')||0 });
  saveState(); closeModal(); render();
}
function formMagPromena(mid,tip){
  const m=magacinArtikal(mid); if(!m) return;
  if(tip==='ulaz'&&!isDirector()) return;
  const sites=DATA.gradilista.filter(g=>isDirector()||g.rukovodilac===ROLE);
  openModal(`
    <div class="m-h"><h3>${tip==='ulaz'?'Ulaz u magacin':'Izdavanje iz magacina'}</h3><button class="x" style="position:static" onclick="closeModal()">${icon('x')}</button></div>
    <div class="m-b">
      <div style="font-size:13px;color:var(--muted);margin:-6px 0 14px">${m.naziv} — trenutno stanje: <b class="num">${m.stanje} ${m.jm}</b></div>
      <div class="f-row"><label>Količina (${m.jm})</label><input id="f_mpkol" type="number"></div>
      ${tip==='izlaz'?`<div class="f-row"><label>Na gradilište</label><select id="f_mpgr">${sites.map(g=>`<option value="${g.id}">${g.naziv}</option>`).join('')}</select></div>`:''}
      <div class="m-foot"><button class="btn ghost" onclick="closeModal()">Otkaži</button><button class="btn" onclick="saveMagPromena('${mid}','${tip}')">${tip==='ulaz'?'Zavedi ulaz':'Izdaj materijal'}</button></div>
    </div>`);
}
function saveMagPromena(mid,tip){
  if(tip!=='ulaz' && tip!=='izlaz') return;   // trecа vrednost je ranije prolazila kroz sve provere
  const m=magacinArtikal(mid); if(!m) return;
  if(tip==='ulaz'&&!isDirector()) return;
  const v=id=>{const e=document.getElementById(id); return e?e.value:'';};
  const kol=+String(v('f_mpkol')).replace(',','.')||0;
  if(kol<=0){ alert('Unesi količinu.'); return; }
  let gr=null;
  if(tip==='izlaz'){
    if(kol>(+m.stanje||0)){ alert('Nema dovoljno na stanju ('+m.stanje+' '+m.jm+').'); return; }
    gr=v('f_mpgr')||null;
    const g=gr?grById[gr]:null;
    if(!g || !(isDirector()||g.rukovodilac===ROLE)){ alert('Izdavanje je moguće samo na tvoje gradilište.'); return; }
  }
  if(!(DATA.magacin||[]).some(x=>x.id===m.id)) DATA.magacin.push(m);   // prvi ulaz artikla iz sifarnika: virtuelan red postaje pravi (insert = uprava, kao i ulaz)
  m.stanje=Math.round(((+m.stanje||0)+(tip==='ulaz'?kol:-kol))*100)/100;
  DATA.mag_promene.push({ id:'mp'+Date.now(), mid, datum:todayStr(), tip, kol, gr });
  saveState(); closeModal(); render();
}

/* SKIDANJE SA STANJA MAGACINA PRI UČITAVANJU PREDMERA (2026-10-23, zahtev klijenta): kad uprava (direktor, admin, direktor
   izvođenja) napravi gradilište Izvođenja i učita predmer — ili na postojeće gradilište uveze predmer / doda artikle iz
   šifarnika — ugovorene količine artikala iz šifarnika (predmer.sifra = sifrarnik.sifra) se skidaju sa stanja magacina:
   izlaz u mag_promene (gr = gradilište). Skida se koliko ima (stanje ne ide u minus); manjak se prijavljuje i loguje.
   Samo uprava, samo Izvođenje, nikad iz demo seed-a/reset-a (poziva se samo iz saveSite/savePredmerImport/saveIzSifarnika). */
function skiniSaStanjaZaPredmer(grId, redovi){
  const g=grById[grId];   // svi pozivaoci zovu posle rebuildMaps
  if(!isDirector()||!g||jePro(g)||!modulDozvoljen(g.modul||'izvodjenje')) return null;
  const artikli=sifrarnikZa('izvodjenje').filter(x=>x.sifra), poSifri={}; artikli.forEach(x=>{ poSifri[x.sifra]=x; });
  const ts=Date.now(); let k=0; const skinuto=[], manjak=[];
  (redovi||[]).forEach(p=>{
    const sf=p.sifra?poSifri[p.sifra]:null; if(!sf) return;
    const kol=+p.kol||0; if(kol<=0) return;
    const m=magacinArtikal(MG_PREFIX+sf.id); if(!m) return;
    const ima=Math.max(0,+m.stanje||0), uzeto=Math.min(ima,kol), fali=Math.round((kol-uzeto)*100)/100;
    if(uzeto>0){
      if(!(DATA.magacin||[]).some(x=>x.id===m.id)) DATA.magacin.push(m);
      m.stanje=Math.round((ima-uzeto)*100)/100;
      DATA.mag_promene.push({ id:'mp'+ts+'-'+(k++), mid:m.id, datum:todayStr(), tip:'izlaz', kol:uzeto, gr:grId });
      skinuto.push({naziv:unesc(sf.naziv), kol:uzeto, jm:sf.jm||'kom'});
    }
    if(fali>0) manjak.push({naziv:unesc(sf.naziv), fali, jm:sf.jm||'kom'});
  });
  if(!skinuto.length&&!manjak.length) return null;
  beleziLog('magacin_predmer',{gr:grId, skinuto, manjak});
  const por=(skinuto.length?'Sa stanja magacina skinuto: '+skinuto.map(x=>x.naziv+' '+x.kol+' '+x.jm).join(', ')+'.':'')+
            (manjak.length?(skinuto.length?'\n':'')+'NEMA NA STANJU (treba nabaviti): '+manjak.map(x=>x.naziv+' '+x.fali+' '+x.jm).join(', ')+'.':'');
  alert(por);
  return {skinuto, manjak};
}

