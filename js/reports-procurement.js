/* ---------- IZVESTAJ ZA INVESTITORA ---------- */
function openIzvestaj(id){
  const g=grById[id]; if(!g) return;
  if(!vidimGr(id)) return;   // izvestaj za investitora nema finansije — sme i radnik
  const cl=cliById[g.klijent], ruk=zapById[g.rukovodilac];
  const od=new Date(TODAY); od.setDate(od.getDate()-7);
  const unosi=DATA.dnevnik.filter(d=>d.gr===id && dParse(d.datum)>=od).sort((a,b)=>dParse(b.datum)-dParse(a.datum));
  const sledece=DATA.zadaci.filter(t=>t.gr===id&&t.kol!=='done').sort((a,b)=>dParse(a.rok)-dParse(b.rok)).slice(0,5);
  const zavrseno=DATA.zadaci.filter(t=>t.gr===id&&t.kol==='done').length;
  const tim=timNa(id).length;
  const diff=daysBetween(TODAY,dParse(g.rok));
  document.getElementById('rpt').innerHTML=`
    <div class="rpt-page">
      <div class="rpt-actions" style="display:flex;justify-content:flex-end;gap:8px;margin-bottom:18px">
        <button class="btn ghost" onclick="closeIzvestaj()">Zatvori</button>
        <button class="btn" onclick="window.print()">Štampaj / Sačuvaj PDF</button>
      </div>
      <div style="display:flex;align-items:center;gap:12px;border-bottom:2px solid var(--ink);padding-bottom:14px;margin-bottom:20px">
        <div class="mark" style="background:var(--ink)"><svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18M5 21V8l7-4 7 4v13M9 21v-6h6v6"/></svg></div>
        <div style="flex:1"><b style="font-family:'Space Grotesk',sans-serif;font-size:15px">GradnjaOS</b><div style="font-size:11px;color:var(--muted)">Izveštaj o napretku radova</div></div>
        <div style="font-size:12px;color:var(--muted);text-align:right">${fmtDate(todayStr())}</div>
      </div>
      <h1 style="font-size:22px;margin:0 0 4px;letter-spacing:-.4px">${g.naziv}</h1>
      <div style="font-size:13px;color:var(--muted);margin-bottom:20px">${g.lok}${g.adresa?', '+g.adresa:''} · Investitor: <b style="color:var(--ink)">${cl?cl.naziv:'—'}</b> · Rukovodilac: ${ruk?ruk.ime:'—'}</div>
      <div class="rpt-stats">
        <div class="dr-stat"><div class="l">Napredak</div><div class="v">${g.napredak}%</div></div>
        <div class="dr-stat"><div class="l">Faza</div><div class="v" style="font-size:13px">${g.faza}</div></div>
        <div class="dr-stat"><div class="l">Rok</div><div class="v" style="font-size:13px">${fmtDate(g.rok)}</div><div style="font-size:11px;color:var(--muted);margin-top:3px">${g.status==='zavrseno'?'predato':diff<0?'prekoračen '+Math.abs(diff)+' d':'još '+diff+' d'}</div></div>
        <div class="dr-stat"><div class="l">Na gradilištu</div><div class="v">${tim} <span style="font-size:12px;color:var(--muted)">ljudi</span></div></div>
      </div>
      <div class="bar" style="height:10px;margin-bottom:26px"><span style="width:${g.napredak}%;background:${g.status==='kasni'?'var(--red)':'var(--blue)'}"></span></div>
      <h3 style="font-size:13px;text-transform:uppercase;letter-spacing:.05em;color:var(--faint);margin:0 0 10px">Aktivnosti u proteklih 7 dana</h3>
      ${unosi.length?unosi.map(e=>`<div style="padding:9px 0;border-bottom:1px solid var(--line);font-size:13px"><b>${fmtDate(e.datum)}</b> — ${e.tekst} <span style="color:var(--faint)">(${osobaIme(e.autor)})</span></div>`).join(''):'<div style="font-size:13px;color:var(--muted);padding:6px 0">Nema unosa u dnevnik za protekli period.</div>'}
      <h3 style="font-size:13px;text-transform:uppercase;letter-spacing:.05em;color:var(--faint);margin:24px 0 10px">Predstojeće aktivnosti</h3>
      ${sledece.length?sledece.map(t=>`<div style="padding:8px 0;border-bottom:1px solid var(--line);font-size:13px;display:flex;justify-content:space-between"><span>${t.naziv}</span><b class="num" style="color:var(--muted)">${fmtDate(t.rok)}</b></div>`).join(''):'<div style="font-size:13px;color:var(--muted)">Nema otvorenih zadataka.</div>'}
      <div style="margin-top:28px;padding-top:14px;border-top:1px solid var(--line);font-size:11px;color:var(--faint);display:flex;justify-content:space-between">
        <span>Do sada završeno ${zavrseno} radnih zadataka na projektu.</span>
        <span>Generisano iz GradnjaOS · ${fmtDate(todayStr())}</span>
      </div>
    </div>`;
  document.getElementById('rpt').classList.add('on');
  if(document.body&&document.body.classList) document.body.classList.add('rpt-open');
}
function closeIzvestaj(){
  const r=document.getElementById('rpt'); if(r) r.classList.remove('on');
  if(document.body&&document.body.classList) document.body.classList.remove('rpt-open');
}

/* ---------- FINANSIJSKI PRESEK (INTERNO) ---------- */
function openPresek(id){
  if(!canFinance()) return;
  const g=grById[id]; if(!g||!vidimGr(id)) return;
  const cl=cliById[g.klijent], ruk=zapById[g.rukovodilac];
  const pot=potroseno(g), trSt=troskoviZa(id), subs=subsZa(id), sits=sitZa(id);
  const n=naplataPct(g), sc=zdravlje(g);
  const ocek=Math.round(g.troskovi*g.napredak/100);
  const nenap=Math.max(0, Math.round(g.napredak/100*g.budzet - naplSum(g)));
  const dosp=sits.filter(x=>x.status!=='placeno'&&sitKasni(x)).reduce((a,b)=>a+b.iznos,0);
  // troskovi po kategorijama
  const kats={};
  trSt.forEach(t=>{ kats[t.kat]=(kats[t.kat]||0)+(+t.iznos||0); });
  const maxKat=Math.max(1,...Object.values(kats));
  const red=(k,v,jak)=>`<div class="dr-kv"><span class="k">${k}</span><span class="v num" style="${jak?'font-size:14px':''}">${v}</span></div>`;
  document.getElementById('rpt').innerHTML=`
    <div class="rpt-page">
      <div class="rpt-actions" style="display:flex;justify-content:flex-end;gap:8px;margin-bottom:18px">
        <button class="btn ghost" onclick="closeIzvestaj()">Zatvori</button>
        <button class="btn" onclick="window.print()">Štampaj / Sačuvaj PDF</button>
      </div>
      <div style="display:flex;align-items:center;gap:12px;border-bottom:2px solid var(--ink);padding-bottom:14px;margin-bottom:20px">
        <div class="mark" style="background:var(--ink)"><svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18M5 21V8l7-4 7 4v13M9 21v-6h6v6"/></svg></div>
        <div style="flex:1"><b style="font-family:'Space Grotesk',sans-serif;font-size:15px">GradnjaOS</b><div style="font-size:11px;color:var(--muted)">Finansijski presek gradilišta — INTERNO</div></div>
        <div style="font-size:12px;color:var(--muted);text-align:right">${fmtDate(todayStr())}</div>
      </div>
      <h1 style="font-size:22px;margin:0 0 4px;letter-spacing:-.4px">${g.naziv}</h1>
      <div style="font-size:13px;color:var(--muted);margin-bottom:18px">${g.lok}${g.adresa?', '+g.adresa:''} · ${modLab(g)} · ${cl?cl.naziv:'—'} · Rukovodilac: ${ruk?ruk.ime:'—'}</div>
      <div class="rpt-stats">
        <div class="dr-stat"><div class="l">Zdravlje</div><div class="v" style="color:${zdrBoja(sc)}">${sc}/100</div></div>
        <div class="dr-stat"><div class="l">Napredak</div><div class="v">${g.napredak}%</div></div>
        <div class="dr-stat"><div class="l">Faza</div><div class="v" style="font-size:13px">${g.faza}</div></div>
        <div class="dr-stat"><div class="l">Rok</div><div class="v" style="font-size:13px">${fmtDate(g.rok)}</div></div>
      </div>
      <h3 style="font-size:13px;text-transform:uppercase;letter-spacing:.05em;color:var(--faint);margin:0 0 8px">Finansije</h3>
      ${red('Ugovorena cena', fmtEur(g.budzet), 1)}
      ${red('Planirani troškovi', fmtEur(g.troskovi))}
      ${red('Utrošeno do sada', fmtEur(pot)+' — plan za trenutnu fazu '+fmtEur(ocek)+(pot>g.troskovi?' <b style="color:var(--amber)">⚠ troškovi iznad plana</b>':pot>ocek*1.1?' <b style="color:var(--amber)">⚠ ispred plana</b>':''))}
      ${imaNaplatu(g)?red('Naplaćeno', fmtEur(naplSum(g))+' ('+n+'%)'):''}
      ${(r=>r?`<h3 style="font-size:13px;text-transform:uppercase;letter-spacing:.05em;color:var(--faint);margin:22px 0 8px">Ugovoreno vs situacije</h3>
      ${red('Ugovoreno (predmer)', fmtEur(r.ugovoreno), 1)}
      ${red('Privremene situacije'+(r.nPriv?' ('+r.nPriv+')':''), fmtEur(r.privremene)+(r.pPriv==null?'':' ('+r.pPriv+'% ugovorenog)')+(r.pPriv>100?' <b style="color:var(--red)">⚠ preko ugovorenog</b>':''))}
      ${red('Okončana situacija (ukupno sa privremenim)', r.okoncana==null?'—':fmtEur(r.okoncana)+(r.pOkon==null?'':' ('+r.pOkon+'% ugovorenog)')+(r.pOkon>100?' <b style="color:var(--red)">⚠ preko ugovorenog</b>':''))}`:'')(realizacijaSituacija(g))}
      ${nenap&&imaNaplatu(g)?red('Izvedeno, a nenaplaćeno', '<b style="color:var(--amber)">'+fmtEur(nenap)+'</b>'):''}
      ${dosp&&imaNaplatu(g)?red('Dospelo, neplaćeno (situacije)', '<b style="color:var(--red)">'+fmtEur(dosp)+'</b>'):''}
      ${Object.keys(kats).length?`<h3 style="font-size:13px;text-transform:uppercase;letter-spacing:.05em;color:var(--faint);margin:22px 0 8px">Troškovi po kategorijama</h3>
        ${Object.entries(kats).sort((a,b)=>b[1]-a[1]).map(x=>`<div style="display:flex;align-items:center;gap:10px;padding:5px 0;font-size:13px">
          <span style="width:130px">${x[0]}</span>
          <div class="bar" style="flex:1"><span style="width:${Math.round(x[1]/maxKat*100)}%"></span></div>
          <b class="num" style="width:90px;text-align:right">${fmtEur(x[1])}</b></div>`).join('')}`:''}
      ${sits.length?`<h3 style="font-size:13px;text-transform:uppercase;letter-spacing:.05em;color:var(--faint);margin:22px 0 8px">Situacije (${sits.length})</h3>
        ${sits.map(x=>`<div class="dr-kv"><span class="k">${x.br} · ${x.opis} <span style="color:var(--faint)">· valuta ${fmtDate(x.valuta)}</span></span>
          <span class="v num">${fmtEur(x.iznos)} ${x.status==='placeno'?'<span class="badge b-green">Plaćeno</span>':sitKasni(x)?'<span class="badge b-red">Kasni</span>':'<span class="badge b-amber">Čeka</span>'}</span></div>`).join('')}`:''}
      ${subs.length?`<h3 style="font-size:13px;text-transform:uppercase;letter-spacing:.05em;color:var(--faint);margin:22px 0 8px">Podizvođači</h3>
        ${subs.map(x=>`<div class="dr-kv"><span class="k">${x.naziv} <span style="color:var(--faint)">· ${x.delatnost}</span></span><span class="v num">${fmtEur(x.cena||0)}</span></div>`).join('')}`:''}
      <div style="margin-top:28px;padding-top:14px;border-top:1px solid var(--line);font-size:11px;color:var(--faint);display:flex;justify-content:space-between">
        <span><b style="color:var(--red)">Interni dokument</b> — sadrži finansijske podatke, ne deliti van direkcije.</span>
        <span>Generisano iz GradnjaOS · ${fmtDate(todayStr())}</span>
      </div>
    </div>`;
  document.getElementById('rpt').classList.add('on');
  if(document.body&&document.body.classList) document.body.classList.add('rpt-open');
}

/* ---------- NABAVKA MATERIJALA ---------- */
function autorIme(n){ if(n.autor==='direkcija') return 'Direkcija'; const z=zapById[n.autor]; return z?z.ime:'\u2014'; }
function narudzbaMailBody(n){
  const g=grById[n.gr], z=zapById[n.autor];
  const lines=['Trebovanje materijala','',
    'Gradili\u0161te: '+(g?unesc(g.naziv)+' ('+unesc(g.lok)+')':'\u2014'),
    'Adresa: '+(g&&g.adresa?unesc(g.adresa):'\u2014'),
    'Naru\u010dio: '+(n.autor==='direkcija'?'Direkcija':(z?unesc(z.ime)+' \u00b7 '+unesc(z.tel):'\u2014')),
    'Datum trebovanja: '+fmtDate(n.datum),
    'Potrebno na gradili\u0161tu do: '+fmtDate(n.rok),'',
    'STAVKE:'];
  (n.stavke||[]).forEach((st,i)=>lines.push((i+1)+'. '+(st.sifra?unesc(st.sifra)+' \u00b7 ':'')+unesc(st.naziv)+' \u2014 '+unesc(st.kolicina)+' '+unesc(st.jm)+(st.predmer_id?' (iz ugovorenog predmera)':'')));
  if(n.napomena) lines.push('','Napomena: '+unesc(n.napomena));
  lines.push('','\u2014 Poslato iz GradnjaOS');
  return lines.join('\n');
}
/* Primaoci trebovanja (zahtev 2026-10-23): UVEK direktor izvođenja (email naloga sa tom ulogom — RPC mejl_direktora_izvodjenja,
   migracija 32; bez takvog naloga ili bez baze → NABAVKA_EMAIL) + opcioni dodatni mejl iz forme (narudzbe.mejl). */
async function primaociTrebovanja(n){
  let dir=null;
  if(supa){ try{ const {data,error}=await supa.rpc('mejl_direktora_izvodjenja'); if(!error&&data) dir=String(data); }catch(e){} }
  const lista=[dir||NABAVKA_EMAIL]; if(n.mejl&&!lista.includes(unesc(n.mejl))) lista.push(unesc(n.mejl));
  return lista;
}
async function posaljiMejlNabavci(id){
  const n=(DATA.narudzbe||[]).find(x=>x.id===id); if(!n) return;
  if(!smemNa(n.gr)) return;
  const g=grById[n.gr];
  const subject='Trebovanje materijala \u2014 '+(g?unesc(g.naziv):'')+' \u2014 '+fmtDate(n.datum);
  const telo=narudzbaMailBody(n);
  const primaoci=await primaociTrebovanja(n);
  /* Pravo slanje preko Edge Function-a (supabase/functions/posalji-trebovanje),
     samo kad je Supabase povezan. Deploy ceka Jovanovo "da" (CLAUDE.md). Dok
     funkcija nije deploy-ovana (ili RESEND_API_KEY nije podesen), invoke()
     vraca gresku i padamo nazad na mailto — bez ikakve vidljive razlike za
     korisnika osim sto (kad proradi) ne treba klik u mail klijentu. */
  if(mode==='supabase' && supa && supa.functions){
    try{
      const {error}=await supa.functions.invoke('posalji-trebovanje', { body:{ to:primaoci, subject, body:telo } });
      if(error) throw new Error(error.message||JSON.stringify(error));
      return;
    }catch(e){ console.error('Edge function posalji-trebovanje (fallback na mailto):', e); }
  }
  const url='mailto:'+primaoci.map(encodeURIComponent).join(',')+'?subject='+encodeURIComponent(subject)+'&body='+encodeURIComponent(telo);
  try{ window.open(url,'_self'); }catch(e){}
}
function viewNabavka(){
  const ids=visibleSiteIds();
  const list=(DATA.narudzbe||[]).filter(n=>upravaSve()||ids.has(n.gr)).sort((a,b)=>dParse(b.datum)-dParse(a.datum));
  const cards=list.map(n=>{
    const g=grById[n.gr];
    const st = n.status==='isporuceno' ? '<span class="badge b-green">Isporu\u010deno</span>' : '<span class="badge b-amber">Poslato nabavci</span>';
    return `<div class="card" style="margin-bottom:14px">
      <div class="card-h">
        <div><h3 style="font-size:14px">${g?g.naziv:'\u2014'}</h3>
          <div class="hint">${autorIme(n)} \u00b7 poru\u010deno ${fmtDate(n.datum)} \u00b7 potrebno do <b style="color:var(--ink)">${fmtDate(n.rok)}</b></div></div>
        ${st}
      </div>
      <div class="card-b">
        ${n.mejl?`<div class="sub" style="margin-bottom:6px">✉ dodatni primalac: ${n.mejl}</div>`:''}
        ${(n.stavke||[]).map(x=>`<div class="dr-kv"><span class="k">${x.sifra?`<span class="num sub">${x.sifra}</span> \u00b7 `:''}${x.naziv}${x.predmer_id?' <span class="badge b-blue" title="Pozicija iz ugovorenog predmera">predmer</span>':''}</span><span class="v num">${x.kolicina} ${x.jm}</span></div>`).join('')}
        ${n.napomena?`<div style="font-size:12.5px;color:var(--muted);margin-top:10px">\uD83D\uDCDD ${n.napomena}</div>`:''}
        <div style="display:flex;gap:8px;margin-top:14px">
          <button class="btn ghost" style="padding:6px 12px;font-size:12px" onclick="posaljiMejlNabavci('${n.id}')">\u2709 Po\u0161alji mejl ponovo</button>
          ${n.status!=='isporuceno'?`<button class="btn ghost" style="padding:6px 12px;font-size:12px" onclick="oznaciIsporuceno('${n.id}')">\u2713 Ozna\u010di isporu\u010deno</button>`:''}
          ${smemBrisati(n.gr)?`<span style="margin-left:auto">${BRISI_DUGME('obrisiNarudzbu',n.id)}</span>`:''}
        </div>
      </div>
    </div>`;
  }).join('') || '<div class="card"><div class="empty">Jo\u0161 nema trebovanja materijala.</div></div>';
  return head('Trebovanje materijala','Poru\u010di materijal za gradili\u0161te \u2014 \u010duvanjem se otvara gotov mejl za slu\u017ebu nabavke.') +
  `<div class="banner blue">${icon('warn')}<div>Trebovanje ide <b>direktoru izvođenja</b> (nalog sa tom ulogom; bez njega: ${NABAVKA_EMAIL}) i, ako upišeš, dodatnom mejlu dobavljača \u2014 \u010duvanjem trebovanja otvara se popunjen mejl, ostaje samo klik \u201ePo\u0161alji\u201c. Adresa se menja u konfiguraciji na vrhu fajla.</div></div>
  <div class="tools">${mogaDaUpravljam()?`<button class="btn" onclick="formNarudzba()">${icon('plus')} Novo trebovanje</button>`:'<span class="sub">Trebovanje šalje rukovodilac gradilišta.</span>'}</div>
  ${cards}`;
}
let stavkaSeq=1, NAR_PM={};   // NAR_PM: indeks reda → predmer.id (JS mapa, ne skriveno polje — lekcija 32)
const JM_TREBOVANJE=['kom','m\u00b3','m\u00b2','m','t','kg','l','paleta','d\u017eak'];
function stavkaRed(i, p){   // p = red predmera (opciono): naziv zakljucan, kolicina = ugovorena kao polazna, JM iz predmera
  const jm=p&&p.jm?p.jm:'kom', opts=(JM_TREBOVANJE.includes(jm)?JM_TREBOVANJE:[jm,...JM_TREBOVANJE]).map(j=>`<option${j===jm?' selected':''}>${j}</option>`).join('');
  return `<div class="f-2" style="grid-template-columns:2fr 74px 92px;gap:8px;margin-bottom:8px">
    <input id="st_n_${i}" placeholder="Materijal (npr. Cement CEM II 42.5)"${p?` value="${(p.sifra?p.sifra+' \u00b7 ':'')+p.poz}" readonly title="Pozicija iz ugovorenog predmera (ugovoreno ${p.kol} ${jm})"`:''}>
    <input id="st_k_${i}" placeholder="Kol."${p?` value="${p.kol}"`:''}>
    <select id="st_j_${i}">${opts}</select>
  </div>`;
}
function addStavka(p){
  stavkaSeq++;
  const box=document.getElementById('stavkeBox');
  if(box&&box.insertAdjacentHTML) box.insertAdjacentHTML('beforeend', stavkaRed(stavkaSeq, p));
  if(p){ NAR_PM[stavkaSeq]=p.id; const k=document.getElementById('st_k_'+stavkaSeq); if(k&&k.focus){ k.focus(); if(k.select) k.select(); } }
}
/* Trebovanje iz ugovorenog predmera (2026-10-11): dropdown pozicija izabranog gradilista Izvodjenja; „Dodaj iz predmera"
   otvara red sa zakljucanim nazivom i ugovorenom kolicinom kao polaznom — rukovodilac je slobodno menja (kolicina
   trebovanja NIJE ogranicena ugovorenom). Stavka pamti predmer_id + sifra; naziv/JM se pri cuvanju citaju iz DATA. */
function narPredmerOpcije(grId){
  const g=grById[grId]; if(!g||jePro(g)) return '';   // Projektovanje nema materijal — sveske nisu za trebovanje
  return predmerZa(grId).map(p=>`<option value="${p.id}">${p.sifra?p.sifra+' \u00b7 ':''}${p.poz} (${p.jm||'kom'}, ugovoreno ${p.kol})</option>`).join('');
}
function osveziNarPredmer(grId){   // grId = podrazumevano gradiliste pri otvaranju (select jos nema vrednost u stubu)
  const sel=document.getElementById('f_ngr'), box=document.getElementById('nar_pm_box'); if(!box) return;
  Object.keys(NAR_PM).forEach(i=>{ const e=document.getElementById('st_n_'+i); const red=e&&e.parentElement; if(red&&red.remove) red.remove(); });   // redovi iz predmera pripadaju prethodnom gradilistu
  NAR_PM={};
  const opt=narPredmerOpcije((sel&&sel.value)||grId||'');
  box.innerHTML=opt?`<div class="tools" style="margin:6px 0 0"><select id="nar_pm" style="min-width:0;flex:1">${opt}</select><button type="button" class="btn ghost" style="padding:6px 12px;font-size:12px" onclick="dodajIzPredmeraTrebovanje()">\uFF0B Dodaj iz predmera</button></div><div class="sub" style="margin-top:4px">Ugovorena koli\u010dina je samo polazna \u2014 unesi koliko stvarno treba.</div>`:'';
}
function dodajIzPredmeraTrebovanje(){
  const sel=document.getElementById('nar_pm'), gr=document.getElementById('f_ngr'); if(!sel||!gr||!smemNa(gr.value)) return;
  const p=predmerZa(gr.value).find(x=>x.id===sel.value); if(!p) return;
  addStavka(p);
}
function formNarudzba(){
  const sites=DATA.gradilista.filter(g=>isDirector()||g.rukovodilac===ROLE);
  if(!sites.length){ alert('Nema gradili\u0161ta za koja mo\u017ee\u0161 da poru\u010di\u0161 trebovanje.'); return; }
  stavkaSeq=1; NAR_PM={};
  openModal(`
    <div class="m-h"><h3>Novo trebovanje materijala</h3><button class="x" style="position:static" onclick="closeModal()">${icon('x')}</button></div>
    <div class="m-b">
      <div class="f-2">
        <div class="f-row"><label>Gradili\u0161te</label><select id="f_ngr" onchange="osveziNarPredmer()">${sites.map(g=>`<option value="${g.id}">${g.naziv}</option>`).join('')}</select></div>
        <div class="f-row"><label>Potrebno do</label><input id="f_nrok" type="date" value="${plusDays(5)}"></div>
      </div>
      <div class="f-row"><label>Iz ugovorenog predmera</label><div id="nar_pm_box"></div></div>
      <div class="f-row"><label>Stavke</label>
        <div id="stavkeBox">${stavkaRed(1)}</div>
        <button class="btn ghost" style="padding:6px 12px;font-size:12px" onclick="addStavka()">${icon('plus')} Dodaj stavku</button>
      </div>
      <div class="f-2">
        <div class="f-row"><label>Napomena (opciono)</label><textarea id="f_nnap" placeholder="npr. isporuka pre 7h, kontakt na kapiji\u2026" style="min-height:52px"></textarea></div>
        <div class="f-row"><label>Dodatni mejl (dobavljač / krajnji korisnik, opciono)</label><input id="f_nmejl" type="email" placeholder="npr. prodaja@dobavljac.rs"><div class="sub" style="margin-top:4px">Trebovanje uvek ide direktoru izvođenja; ovde upiši još jednog primaoca.</div></div>
      </div>
      <div class="m-foot">
        <button class="btn ghost" onclick="closeModal()">Otka\u017ei</button>
        <button class="btn" onclick="saveNarudzba()">Sa\u010duvaj i po\u0161alji</button>
      </div>
    </div>`, {siroka:true, kljuc:'trebovanje'});
  osveziNarPredmer(sites[0].id);
}
function saveNarudzba(){
  const v=id=>{const e=document.getElementById(id); return e?e.value:'';};
  const gr=v('f_ngr');
  const g=grById[gr];
  if(!g || !(isDirector()||g.rukovodilac===ROLE)){ alert('Nema\u0161 pravo trebovanja za ovo gradili\u0161te.'); return; }
  const pmById={}; predmerZa(gr).forEach(p=>pmById[p.id]=p);
  const stavke=[];
  for(let i=1;i<=stavkaSeq;i++){
    if(NAR_PM[i] && !pmById[NAR_PM[i]]) continue;   // red iz predmera drugog gradilista (ne sme da se degradira u slobodan tekst)
    const p=NAR_PM[i]?pmById[NAR_PM[i]]:null;
    const kol=esc(String(v('st_k_'+i)).trim())||'1';
    if(p){ stavke.push({naziv:p.poz, kolicina:kol, jm:p.jm||'kom', predmer_id:p.id, sifra:p.sifra||null}); continue; }   // naziv/JM iz DATA (vec esc), kolicina slobodna
    const nz=esc(String(v('st_n_'+i)).trim());
    if(nz) stavke.push({naziv:nz, kolicina:kol, jm:v('st_j_'+i)||'kom'});
  }
  if(!stavke.length){ alert('Unesi bar jednu stavku materijala.'); return; }
  const mejl=String(v('f_nmejl')).trim().toLowerCase(); if(mejl&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mejl)){ alert('Dodatni mejl nije ispravan.'); return; }
  const n={ id:'n'+Date.now(), gr, autor:(ROLE==='all'?'direkcija':ROLE), datum:todayStr(), rok:v('f_nrok')||plusDays(5), status:'poslato', napomena:esc(String(v('f_nnap')).trim()), stavke, mejl:mejl?esc(mejl):null };
  DATA.narudzbe.push(n); NAR_PM={};
  saveState(); closeModal(); render();
  posaljiMejlNabavci(n.id);
}
function oznaciIsporuceno(id){
  const n=(DATA.narudzbe||[]).find(x=>x.id===id); if(!n) return;
  const g=grById[n.gr];
  if(!(isDirector()||(g&&g.rukovodilac===ROLE))) return;
  if(n){ n.status='isporuceno'; saveState(); render(); }
}

/* ---------- UREDJIVANJE TIMA NA GRADILISTU ---------- */
function formTim(grId){
  const g=grById[grId];
  if(!g || !smemNa(grId)) return;
  openModal(`
    <div class="m-h"><h3>Tim: ${g.naziv}</h3><button class="x" style="position:static" onclick="closeModal()">${icon('x')}</button></div>
    <div class="m-b">
      <div class="f-row"><label>Štikliraj ko radi na ovom gradilištu</label>
        <div class="chk-list" style="max-height:260px">${DATA.zaposleni.map(z=>`
          <label class="chk"><input type="checkbox" id="t_z_${z.id}" ${(z.grs||[]).includes(grId)?'checked':''}>
            <span style="flex:1">${z.ime} <span style="color:var(--faint);font-size:11px">· ${z.poz}</span></span>
            ${drugde(z,grId).length?`<span style="color:var(--amber);font-size:10.5px" title="Već angažovan/a na drugom gradilištu">⚠ ${isDirector()?'na: '+drugde(z,grId).map(x=>grById[x]?grById[x].naziv:x).join(', '):'na drugom gradilištu'}</span>`:''}
          </label>`).join('')}</div>
      </div>
      <div style="font-size:11.5px;color:var(--muted);margin:-6px 0 12px">Skidanjem s projekta osoba ide u „prošle projekte“ — istorija se čuva.</div>
      <div class="m-foot">
        <button class="btn ghost" onclick="closeModal()">Otkaži</button>
        <button class="btn" onclick="saveTim('${grId}')">Sačuvaj tim</button>
      </div>
    </div>`);
}
/* Gradilista (osim grId) na kojima je zaposleni trenutno angazovan. */
function drugde(z,grId){ return (z.grs||[]).filter(x=>x!==grId); }
function saveTim(grId){
  const g=grById[grId];
  if(!g || !smemNa(grId)) return;
  /* Jovanova odluka (2026-09-15): puna lista ostaje, ali dodavanje osobe koja je
     vec na drugom gradilistu trazi potvrdu. Rukovodiocu se ne otkriva ime tudjeg
     gradilista — samo da postoji. */
  const novi=DATA.zaposleni.filter(z=>{ const c=document.getElementById('t_z_'+z.id); return c&&c.checked&&!(z.grs||[]).includes(grId)&&drugde(z,grId).length; });
  if(novi.length){
    const lista=novi.map(z=>'\u2022 '+unesc(z.ime)+(isDirector()?' (na: '+drugde(z,grId).map(x=>grById[x]?unesc(grById[x].naziv):x).join(', ')+')':'')).join('\n');
    if(!confirm('Sledeći zaposleni su već angažovani na drugom gradilištu:\n'+lista+'\n\nDodati ih i na ovo gradilište?')) return;
  }
  DATA.zaposleni.forEach(z=>{
    const c=document.getElementById('t_z_'+z.id); if(!c) return;
    const ima=(z.grs||[]).includes(grId);
    if(c.checked && !ima){ z.grs=[...(z.grs||[]),grId]; z.bivsi=(z.bivsi||[]).filter(x=>x!==grId); }
    if(!c.checked && ima){ z.grs=z.grs.filter(x=>x!==grId); z.bivsi=[...new Set([...(z.bivsi||[]),grId])]; }
  });
  saveState(); closeModal(); renderNav(); render(); openSite(grId);
}

/* ---------- IZMENA RASPOREDA ZAPOSLENOG ---------- */
function formRaspored(id){
  const z=zapById[id]; if(!z)return;
  openModal(`
    <div class="m-h"><h3>Raspored: ${z.ime}</h3><button class="x" style="position:static" onclick="closeModal()">${icon('x')}</button></div>
    <div class="m-b">
      <div class="f-row"><label>Gradilišta na kojima radi (može više)</label>
        <div class="chk-list">${DATA.gradilista.map(g=>`<label class="chk"><input type="checkbox" id="r_gr_${g.id}" ${(z.grs||[]).includes(g.id)?'checked':''}> ${g.naziv} <span style="color:var(--faint);font-size:11px">· ${g.faza}</span></label>`).join('')}</div>
      </div>
      <div class="m-foot">
        <button class="btn ghost" onclick="closeModal()">Otkaži</button>
        <button class="btn" onclick="saveRaspored('${id}')">Sačuvaj raspored</button>
      </div>
    </div>`);
}
function saveRaspored(id){
  if(!isDirector()) return;
  const z=zapById[id]; if(!z)return;
  const novi=DATA.gradilista.filter(g=>{const c=document.getElementById('r_gr_'+g.id); return c&&c.checked;}).map(g=>g.id);
  const skinuti=(z.grs||[]).filter(x=>!novi.includes(x));
  z.bivsi=[...new Set([...(z.bivsi||[]).filter(x=>!novi.includes(x)), ...skinuti])];
  z.grs=novi;
  saveState(); closeModal(); renderNav(); render(); openEmp(id);
}

