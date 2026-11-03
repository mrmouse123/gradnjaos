/* ============================================================
   DRAWER — DETALJ GRADILIŠTA
   ============================================================ */
/* Kontakt investitora za fioku: " — osoba, tel, mail" (prazni delovi i '—' se preskaču). */
function investKontakt(k){ const p=[k.osoba,k.tel,k.mail].filter(x=>x&&x!=='—'); return p.length?' — '+p.join(', '):''; }
let FIOKA_GR=null;   // gradiliste otvoreno u fioci (osveziFioku posle tajmera / dodele / dokumenta)
function osveziFioku(grId){ const d=document.getElementById('drawer'); if(FIOKA_GR===grId && d && d.classList.contains('on')) openSite(grId); }
/* Projektovanje: sveske (redovi specifikacije) PO OSOBI — status zadatka sveske, tajmer, dokumenti uz svesku, dodela. */
function sveskeHtml(id){
  const g=grById[id], pm=predmerZa(id), tById={}; (DATA.zadaci||[]).forEach(t=>{ if(t.predmer_id) tById[t.predmer_id]=t; });
  const grupe={}; pm.forEach(p=>{ const k=p.zaduzen||''; (grupe[k]=grupe[k]||[]).push(p); });
  const kljucevi=Object.keys(grupe).sort((a,b)=>((a===''?1:0)-(b===''?1:0))||zaduzenIme(a).localeCompare(zaduzenIme(b)));
  const moze=smemPredmer(id), ST={todo:['Čeka','b-gray'], inprogress:['U toku','b-blue'], done:['Završeno','b-green']};
  const osobe=kljucevi.map(k=>{
    const ime=k?zaduzenIme(k):'Nedodeljeno', z=k?zapById[k]:null;
    const redovi=grupe[k].map(p=>{
      const t=tById[p.id], st=ST[(t&&t.kol)||'todo']||ST.todo, docs=(DATA.dokumenti||[]).filter(d=>d.predmer_id===p.id);
      return `<div class="sv-red${t&&t.kol==='done'?' done':''}">
        <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start"><span class="nz" style="font-weight:600">${p.poz}</span><span class="badge ${st[1]}" style="flex:none">${st[0]}</span></div>
        ${moze?`<div style="margin-top:6px"><select onchange="dodeliSvesku('${id}','${p.id}',this.value)" title="Dodeli osobu"><option value="">— dodeli osobu —</option>${zaduzenOpcije(p.zaduzen)}</select></div>`:''}
        ${t?tajmerLinija(t):''}
        ${docs.map(d=>`<div class="sub" style="font-size:12px;margin-top:6px">${String(d.tip||'').indexOf('image/')===0?'🖼':'📄'} <span style="color:var(--blue);font-weight:600;cursor:pointer" onclick="otvoriDokument('${d.id}')">${d.naziv}</span> · ${fmtDate(d.datum)} · ${osobaIme(d.autor)}${smemObrisatiDokument(d)?` <span style="color:var(--red);cursor:pointer" onclick="obrisiDokument('${d.id}')" title="Obriši dokument">✕</span>`:''}</div>`).join('')}
        <div style="margin-top:6px"><button class="btn ghost" style="padding:4px 10px;font-size:11.5px" onclick="uploadDokument('${id}','${p.id}')">⬆ Učitaj dokument</button></div>
      </div>`; }).join('');
    return `<div class="sv-osoba"><div class="who">${z?`<div class="av" style="width:26px;height:26px;font-size:11px">${initials(z.ime)}</div>`:''}<b>${ime}</b><span class="sub">· ${grupe[k].length}</span></div>${redovi}</div>`;
  }).join('');
  return (osobe||'<div class="sub">Još nema svezaka — dodaj ih dugmetom ispod ili u Specifikaciji usluga.</div>')
    + (moze?`<button class="btn ghost" style="width:100%;margin-top:8px" onclick="formPredmerRed('${id}')">＋ Nova sveska / dokument</button>`:'');
}
function openSite(id){
  const g=grById[id]; if(!g)return;
  if(!vidimGr(id)) return;   // citanje: i radnik/spoljni na svom gradilistu; akcije unutra su iza smemNa/canFinance
  FIOKA_GR=id;
  const cl=cliById[g.klijent], ruk=zapById[g.rukovodilac];
  const tim=timNa(id), pro=jePro(g);
  const dokOpsti=pro?dokumentiZa(id).filter(d=>!d.predmer_id):dokumentiZa(id);   // Projektovanje: dokument uz svesku stoji uz svesku
  const dd=dParse(g.rok), diff=daysBetween(TODAY,dd);
  const pot=potroseno(g), trSt=troskoviZa(id), subs=subsZa(id);
  const budPct=g.budzet?Math.round(pot/g.budzet*100):0;
  const n=naplataPct(g);
  const rokTekst = g.status==='zavrseno'?'Projekat predat'
    : diff<0?`<span style="color:var(--red)">Prekoračen za ${Math.abs(diff)} dana</span>`
    : `Preostalo ${diff} dana`;

  const timHtml = tim.length? tim.map(z=>`
    <div class="dr-kv"><span class="k"><div class="who"><div class="av" style="width:26px;height:26px;font-size:11px">${initials(z.ime)}</div><span class="v link" style="font-weight:600" onclick="openEmp('${z.id}')">${z.ime}</span></div></span>
    <span class="v" style="font-weight:500;color:var(--muted)">${z.poz}</span></div>`).join('')
    : `<div style="color:var(--faint);font-size:13px">Nema dodeljenih ljudi.</div>`;

  document.getElementById('drawer').innerHTML = `
    <div class="dr-h">
      <button class="x" onclick="closeDrawer()">${icon('x')}</button>
      ${(isDirector()||g.rukovodilac===ROLE)?`<button class="x" style="right:58px;width:auto;padding:0 10px;font-size:12px;font-weight:600" onclick="formUpdate('${id}')">✎ Ažuriraj</button>`:''}
      <h2>${g.naziv}</h2>
      <div class="loc">${icon('pin')} ${g.lok}</div>
      ${g.adresa?`<div class="loc" style="margin-top:2px">${g.adresa}</div>`:''}
      <div style="margin-top:12px">${badge(g.status)} <span style="font-size:12px;color:var(--muted);margin-left:6px">${g.faza}</span></div>
    </div>
    <div class="dr-b">
      <button class="btn" style="width:100%;margin-bottom:8px" onclick="openPredmer('${id}')">${jePro(g)?'Specifikacija usluga':'Predmer i količine'} →</button>
      ${isDirector()?`<div style="display:flex;gap:8px;margin-bottom:16px">
        <button class="btn" style="flex:1" onclick="openPresek('${id}')">Finansijski presek</button>
        <button class="btn ghost" style="flex:1" onclick="openIzvestaj('${id}')">Izveštaj za investitora</button>
      </div>
      <button class="btn ghost" style="width:100%;margin:-8px 0 16px" onclick="formSite('${id}')">✎ Izmeni podatke</button>`:''}
      <div class="dr-stats">
        <div class="dr-stat"><div class="l">Zdravlje projekta</div>
          <div style="display:flex;align-items:center;gap:10px;margin-top:6px"${zdravlje(g)==null?` title="${ZDR_NEMA}"`:''}>${ringSvg(zdravlje(g),40)}<span class="v num" style="color:${zdrBoja(zdravlje(g))}">${zdrTekst(zdravlje(g))}<span style="font-size:12px;color:var(--faint)">/100</span></span></div>
        </div>
        ${realizacijaSituacija(g)?`<div class="dr-stat"><div class="l">Ugovoreno vs situacije</div>${realizacijaHtml(realizacijaSituacija(g))}</div>`:''}
        <div class="dr-stat"><div class="l">Napredak</div><div class="v">${g.napredak}%</div>
          <div class="bar" style="margin-top:8px"><span style="width:${g.napredak}%;background:${g.status==='kasni'?'var(--red)':g.status==='zavrseno'?'var(--green)':'var(--blue)'}"></span></div>
        </div>
        <div class="dr-stat"><div class="l">Rok</div><div class="v" style="font-size:15px">${fmtDate(g.rok)}</div>
          <div style="font-size:12px;margin-top:6px">${rokTekst}</div>
        </div>
        ${canFinance()&&!pro?`<div class="dr-stat"><div class="l">Naplaćeno</div><div class="v" style="font-size:17px">${n}%</div>
          <div class="bar" style="margin-top:8px"><span style="width:${n}%;background:${n>=90?'var(--green)':'var(--blue)'}"></span></div>
        </div>`:''}
      </div>

      <div class="dr-sec">
        <h4>Osnovni podaci</h4>
        <div class="dr-kv"><span class="k">Investitor</span><span class="v">${cl?`<b>${cl.naziv}</b>`+investKontakt(cl):'—'}</span></div>
        <div class="dr-kv"><span class="k">Rukovodilac</span><span class="v">${ruk?ruk.ime:'—'}</span></div>
        <div class="dr-kv"><span class="k">Početak radova</span><span class="v">${fmtDate(g.pocetak)}</span></div>
      </div>

      ${canFinance()?`<div class="dr-sec">
        <h4>Finansije</h4>
        <div class="dr-kv"><span class="k">Ugovorena cena</span><span class="v num">${fmtEur(g.budzet)}</span></div>
        <div class="dr-kv"><span class="k">Planirani troškovi</span><span class="v num">${fmtEur(g.troskovi)}</span></div>
        <div class="dr-kv"><span class="k">Utrošeno do sada</span><span class="v num">${fmtEur(pot)} (${budPct}%)${trSt.length?' · iz '+trSt.length+' stavki':''}</span></div>
        ${pro?'':`<div class="dr-kv"><span class="k">Naplaćeno</span><span class="v num">${fmtEur(naplSum(g))} (${n}%)</span></div>`}
        <div class="budget-bar ${budPct>90?'hot':''}"><span style="width:${Math.min(100,budPct)}%"></span></div>
        ${trSt.length?`<div style="margin-top:12px"><div style="font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--faint);font-weight:600;margin-bottom:4px">Poslednji troškovi</div>${trSt.slice(-4).reverse().map(t=>`<div class="dr-kv"><span class="k">${fmtDate(t.datum)} · ${t.opis} <span style="color:var(--faint)">· ${t.kat}</span>${(t.dobavljac||t.fakt)?`<br><span class="sub">${[t.dobavljac,t.fakt?'fakt. '+t.fakt:''].filter(Boolean).join(' · ')}</span>`:''}${t.prilog?`<br><span style="color:var(--blue);font-weight:600;cursor:pointer;font-size:11px" onclick="otvoriTrosakPrilog('${t.id}')">📄 ${t.prilog.name}</span> <span style="color:var(--red);cursor:pointer;font-size:11px" onclick="ukloniTrosakPrilog('${t.id}')" title="Ukloni prilog">✕</span>`:`<br><span style="color:var(--blue);cursor:pointer;font-size:11px" onclick="uploadTrosakPrilog('${t.id}')">📎 Dodaj fakturu</span>`}</span><span class="v num">${fmtEur(t.iznos)}</span></div>`).join('')}</div>`:''}
        <button class="btn ghost" style="margin-top:10px;padding:6px 12px;font-size:12px" onclick="formTrosak('${id}')">＋ Dodaj trošak</button>
        ${trSt.length?`<button class="btn ghost" style="margin-top:10px;padding:6px 12px;font-size:12px" onclick="openTroskovi('${id}')">Svi troškovi (${trSt.length})</button>`:''}
        ${sitZa(id).length&&!pro?`<div style="margin-top:12px">${sitZa(id).map(s=>{
          const st=s.status==='placeno'?'<span class="badge b-green">Plaćeno</span>':sitKasni(s)?'<span class="badge b-red">Kasni</span>':'<span class="badge b-amber">Čeka</span>';
          return `<div class="dr-kv"><span class="k">${s.br} · ${s.opis}</span><span class="v num" style="display:flex;gap:8px;align-items:center;justify-content:flex-end">${fmtEurK(s.iznos)} ${st}</span></div>`;
        }).join('')}</div>`:''}
      </div>`:''}

      ${pro?`<div class="dr-sec">
        <h4>Dokumentacija po osobi (${predmerZa(id).length})</h4>
        ${sveskeHtml(id)}
      </div>`:`<div class="dr-sec">
        <h4 style="display:flex;justify-content:space-between;align-items:center">Tim na gradilištu (${tim.length})
          ${(isDirector()||g.rukovodilac===ROLE)?`<button class="btn ghost" style="padding:3px 10px;font-size:11px" onclick="formTim('${id}')">✎ Uredi tim</button>`:''}</h4>
        ${timHtml}
      </div>`}

      ${(g.povrsina||g.nadzor)?`<div class="dr-sec">
        <h4>Osnovni podaci</h4>
        ${g.povrsina?`<div class="dr-kv"><span class="k">Površina</span><span class="v num">${g.povrsina.toLocaleString('sr-RS')} m²</span></div>`:''}
        ${g.nadzor?`<div class="dr-kv"><span class="k">Kontakt nadzora</span><span class="v" style="font-weight:500">${g.nadzor}</span></div>`:''}
      </div>`:''}
      <div class="dr-sec">
        <h4>Administracija</h4>
        ${ADM_DOK.map(a=>a[0]==='podugovori'&&jePro(g)?[a[0],'Ugovori saradnika']:a).map(a=>{
          const st=admInfo(g,a[0]); const m=ADM_ST[st.st]||ADM_ST.nema;
          const vd=st.vazi_do?daysBetween(TODAY,dParse(st.vazi_do)):null;
          const vaziHtml = st.vazi_do ? `<div class="sub" style="font-size:11px;${vd<0?'color:var(--red);font-weight:600':vd<=30?'color:var(--amber);font-weight:600':''}">važi do ${fmtDate(st.vazi_do)}${vd<0?' (isteklo)':vd<=30?' (ističe za '+vd+' d)':''}</div>` : '';
          const vaziIn = a[0]!=='podugovori' ? ` <input type="date" value="${st.vazi_do||''}" onchange="setAdmVazi('${id}','${a[0]}',this.value)" title="Važi do" style="border:1px solid var(--line);border-radius:7px;padding:3px 6px;font-size:11.5px;background:var(--surface);color:var(--ink);width:118px">` : '';
          const docHtml = st.doc ? `<div style="margin-top:4px"><span style="color:var(--blue);font-weight:600;cursor:pointer;font-size:12px" onclick="otvoriAdmDoc('${id}','${a[0]}')">📄 ${st.doc.name}</span><span class="sub" style="font-size:11px"> · ${fmtDate(st.doc.datum)}</span>${isDirector()?` <span style="color:var(--red);cursor:pointer;font-size:11px" onclick="ukloniAdmDoc('${id}','${a[0]}')" title="Ukloni dokument">✕</span>`:''}</div>` : '';
          const ctrl = isDirector()
            ? `<select onchange="setAdmStatus('${id}','${a[0]}',this.value)" style="border:1px solid var(--line);border-radius:7px;padding:3px 6px;font-size:11.5px;background:var(--surface);color:var(--ink)">${Object.entries(ADM_ST).map(o=>`<option value="${o[0]}" ${st.st===o[0]?'selected':''}>${o[1][0]}</option>`).join('')}</select>${vaziIn} <button class="btn ghost" style="padding:3px 8px;font-size:11px" onclick="uploadAdmDoc('${id}','${a[0]}')" title="Učitaj dokument">📎</button>`
            : `<span class="badge ${m[1]}">${m[2]} ${m[0]}</span>`;
          return `<div class="dr-kv"><span class="k">${a[1]}${vaziHtml}${docHtml}</span><span class="v" style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;justify-content:flex-end">${ctrl}</span></div>`;
        }).join('')}
      </div>
      ${subs.length?`<div class="dr-sec">
        <h4>${jePro(g)?'Spoljni saradnici':'Podizvođači'} (${subs.length})</h4>
        ${subs.map(x=>`<div class="dr-kv"><span class="k">${x.naziv}<div class="sub" style="font-size:11.5px">${x.delatnost} · ${x.osoba} · ${x.tel}</div></span><span class="v" style="font-weight:500">${canFinance()?'<span class="num">'+fmtEur(x.cena||0)+'</span> ':''}${x.status==='zavrsen'?'<span class="badge b-gray">Završen</span>':'<span class="badge b-green">Aktivan</span>'}</span></div>`).join('')}
      </div>`:''}
      ${pro?'':`<div class="dr-sec">
        <h4>Situacije (${sitZa(id).length})</h4>
        ${sitZa(id).slice().sort((a,b)=>dParse(b.izdato)-dParse(a.izdato)).map(s=>{ const rz=razlikaSit(s); return `<div class="dr-kv"><span class="k"><span style="color:var(--blue);font-weight:600;cursor:pointer" onclick="detaljSituacije('${s.id}')">${s.br}</span> · ${sitVrsta(s)}<div class="sub" style="font-size:11.5px">${fmtDate(s.izdato)} · ${pregledSit(s)!=='odobrena'?pregledBadge(s):s.status==='placeno'?'plaćeno':sitKasni(s)?'kasni':'na čekanju'}${rz?' · <b style="color:var(--amber)">'+rz+' preko ugovora</b>':''}</div></span><span class="v num" style="display:flex;flex-direction:column;align-items:flex-end;gap:4px">${canFinance()&&s.iznos!=null?fmtEur(s.iznos):''}${izvozLinkovi(s)}</span></div>`; }).join('')||'<div class="sub">Još nema situacija.</div>'}
        ${smemNa(id)?`<button class="btn ghost" style="width:100%;margin-top:8px" onclick="formSituacija('${id}')">＋ Nova situacija</button>`:''}
      </div>`}
      <div class="dr-sec">
        <h4>Dokumenti${pro?' gradilišta':''} (${dokOpsti.length})</h4>
        ${dokOpsti.map(d=>`<div class="dr-kv"><span class="k">${String(d.tip||'').indexOf('image/')===0?'🖼':'📄'} <span style="color:var(--blue);font-weight:600;cursor:pointer" onclick="otvoriDokument('${d.id}')">${d.naziv}</span><div class="sub" style="font-size:11.5px">${fmtDate(d.datum)} · ${osobaIme(d.autor)}${d.velicina?' · '+Math.round(d.velicina/1024)+' KB':''}${d.opis?' · '+d.opis:''}</div></span><span class="v">${smemObrisatiDokument(d)?`<span style="color:var(--red);cursor:pointer" onclick="obrisiDokument('${d.id}')" title="Obriši dokument">✕</span>`:''}</span></div>`).join('')}
        ${vidimGr(id)?`<div style="margin-top:8px"><button class="btn ghost" onclick="uploadDokument('${id}')">⬆ Dodaj dokument / fotografiju</button></div>`:''}
      </div>
      ${smemBrisati(id)?`<div class="dr-sec"><button class="btn ghost" style="color:var(--red)" onclick="obrisiGradiliste('${id}')">Obriši gradilište</button></div>`:''}
    </div>`;
  document.getElementById('drawer').classList.add('on');
  document.getElementById('scrim').classList.add('on');
}
function closeDrawer(){
  FIOKA_GR=null;
  document.getElementById('drawer').classList.remove('on');
  document.getElementById('scrim').classList.remove('on');
  document.getElementById('side').classList.remove('open');   // scrim je zajednicki: tap van sidebara ga zatvara
}
/* Hamburger na telefonu: sidebar (z 50) + scrim (z 40) — hamburger ostaje ISPOD otvorenog
   sidebara, pa je tap na scrim jedini nacin da se zatvori bez izbora stavke. */
function toggleSide(){
  const s=document.getElementById('side'); const on=s.classList.toggle('open');
  document.getElementById('scrim').classList.toggle('on', on);
}

