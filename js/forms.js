/* ---------- AŽURIRANJE PROJEKTA ---------- */
function formUpdate(id){
  const g=grById[id]; if(!g)return;
  if(!(isDirector()||g.rukovodilac===ROLE)) return;
  const faze = fazeZa(g);
  const fazeOpts = (faze.includes(g.faza)?faze:[g.faza,...faze]).map(f=>`<option ${g.faza===f?'selected':''}>${f}</option>`).join('');
  openModal(`
    <div class="m-h"><h3>Ažuriraj projekat</h3><button class="x" style="position:static" onclick="closeModal()">${icon('x')}</button></div>
    <div class="m-b">
      <div style="font-size:13px;color:var(--muted);margin:-6px 0 14px">${g.naziv}</div>
      <div class="f-2">
        ${imaPredmer(id)
          ?`<div class="f-row"><label>Napredak (%)</label><div style="font-size:13px;padding:7px 0"><b class="num">${g.napredak}%</b> <span style="color:var(--muted)">— računa se iz ${jePro(g)?'specifikacije':'predmera'} (ugovoreno × izvedeno)</span></div></div>`
          :`<div class="f-row"><label>Napredak (%)</label><input id="u_nap" type="number" min="0" max="100" value="${g.napredak}"></div>`}
        <div class="f-row"><label>Status</label><select id="u_st">${Object.keys(STATUS).map(s=>`<option value="${s}" ${g.status===s?'selected':''}>${STATUS[s].t}</option>`).join('')}</select></div>
      </div>
      <div class="f-row"><label>Faza radova</label><select id="u_faza">${fazeOpts}</select></div>
      ${canFinance()?(troskoviZa(id).length?`<div class="f-row"><label>Utrošeno do sada</label><div style="font-size:13px;color:var(--muted);padding:6px 0">${fmtEur(potroseno(g))} — računa se iz stavki troškova (detalji gradilišta)</div></div>`:`<div class="f-row"><label>Utrošeno do sada bez PDV (RSD)</label><input id="u_pot" type="number" value="${g.potroseno}"></div>`):''}
      <div class="m-foot">
        <button class="btn ghost" onclick="closeModal()">Otkaži</button>
        <button class="btn" onclick="saveUpdate('${id}')">Sačuvaj izmene</button>
      </div>
    </div>`);
}
function saveUpdate(id){
  const g=grById[id]; if(!g)return;
  if(!(isDirector()||g.rukovodilac===ROLE)) return;
  const el=x=>document.getElementById(x);
  if(!imaPredmer(id) && el('u_nap') && String(el('u_nap').value).trim()!=='') g.napredak=Math.round(Math.max(0,Math.min(100,+el('u_nap').value||0)));   // sa predmerom: napredak je izveden, ne rucni
  g.status=el('u_st').value; g.faza=el('u_faza').value;
  if(canFinance()&&el('u_pot')) g.potroseno=+el('u_pot').value||0;
  if(g.napredak===100&&(g.status==='u toku'||g.status==='kasni')) g.status='zavrseno';
  saveState(); closeModal(); renderNav(); render(); openSite(id);
}

/* ============================================================
   MODAL + FORME
   ============================================================ */
let MODAL_KLJUC=null, MODAL_W0=0;
/* openModal(html, {siroka, kljuc}): siroka = 1040px (tabele/cekliste); kljuc = ime forme pod kojim se pamti sirina
   koju je korisnik razvukao (localStorage gos_modal_w_<kljuc>), samo na >900px — na telefonu je modal uvek pun ekran. */
function openModal(html, opt){
  opt=opt||{};
  const m=document.getElementById('modal');
  m.innerHTML=html;
  if(m.classList) m.classList.toggle('siroka', !!opt.siroka);
  MODAL_KLJUC=opt.kljuc||null;
  let w=null; try{ w=MODAL_KLJUC&&window.innerWidth>900?+localStorage.getItem('gos_modal_w_'+MODAL_KLJUC):null; }catch(e){}
  if(m.style) m.style.width=(w&&w>=420)?w+'px':'';
  document.getElementById('modalWrap').classList.add('on');
  MODAL_W0=m.offsetWidth||0;
}
/* posle rucnog razvlacenja (mouseup) zapamti sirinu za ovu formu */
function zapamtiSirinuModala(){
  const m=document.getElementById('modal'); if(!m||!MODAL_KLJUC||!(window.innerWidth>900)) return;
  const w=m.offsetWidth||0; if(!w||w===MODAL_W0) return;
  MODAL_W0=w; try{ localStorage.setItem('gos_modal_w_'+MODAL_KLJUC, String(Math.round(w))); }catch(e){}
}
if(typeof document!=='undefined'&&document.addEventListener) document.addEventListener('mouseup', zapamtiSirinuModala);
function closeModal(){ document.getElementById('modalWrap').classList.remove('on'); }

/* formSite() = novo gradilište; formSite(id) = izmena osnovnih podataka postojećeg (samo direktor; modul se ne menja). */
function formSite(id){
  PREDMER_PRIPREMA=null;
  const g=id?grById[id]:null, ed=!!g;
  if(id&&!g) return;
  if(ed ? !(isDirector() && smemNa(id)) : !isDirector()) return;   // izmena: samo uprava, u svom modulu (direktor modula ne menja tudje gradiliste)
  const samoPro=!ed && !modulDozvoljen('izvodjenje');   // direktor projektovanja: novo gradiliste je samo projektantsko
  const va=x=>ed?` value="${x}"`:'';                         // prefill (g.* je već esc-ovan → ispravan HTML atribut)
  const sel=(a,b)=>ed&&a===b?' selected':'';
  const rukLista=DATA.zaposleni.filter(z=>z.poz==='Rukovodilac gradilišta'||(ed&&z.id===g.rukovodilac));  // trenutni rukovodilac uvek u listi (inače bi se tiho zamenio)
  openModal(`
    <div class="m-h"><h3>${ed?'Izmeni podatke gradilišta':'Novo gradilište'}</h3><button class="x" style="position:static" onclick="closeModal()">${icon('x')}</button></div>
    <div class="m-b">
      <div class="f-row"><label>Naziv projekta</label><input id="f_naziv" placeholder="npr. Stambena zgrada Vračar"${va(g&&g.naziv)}></div>
      <div class="f-row"><label>Lokacija</label><input id="f_lok" placeholder="Grad, deo grada"${va(g&&(g.lok==='—'?'':g.lok))}></div>
      <div class="f-row"><label>Adresa</label><input id="f_adresa" placeholder="Ulica i broj"${va(g&&(g.adresa||''))}></div>
      <div class="f-row"><label>Površina (m²)</label><input id="f_povrsina" type="number" placeholder="npr. 1200"${va(g&&(g.povrsina||''))}></div>
      ${ed?`<div class="f-2">
        <div class="f-row"><label>Modul</label><div style="padding:8px 0;font-size:13.5px;font-weight:600">${jePro(g)?'Projektovanje':'Izvođenje radova'}</div></div>
        ${jePro(g)
          ?''
          :`<div class="f-row"><label>Tip izvođenja</label><select id="f_tip">${Object.keys(PODTIPOVI).map(t=>`<option value="${t}"${sel(g.tip||'visokogradnja',t)}>${PODTIPOVI[t]}</option>`).join('')}</select></div>`}
      </div>`:`<div class="f-2">
        <div class="f-row"><label>Modul</label><select id="f_modul" onchange="toggleTipRadova(this.value)">${modulDozvoljen('izvodjenje')?'<option value="izvodjenje">Izvođenje radova</option>':''}${modulDozvoljen('projektovanje')?'<option value="projektovanje">Projektovanje</option>':''}</select></div>
        <div class="f-row" id="tipRadovaBox" style="display:${samoPro?'none':'block'}"><label>Tip izvođenja</label><select id="f_tip"><option value="visokogradnja">Visokogradnja</option><option value="niskogradnja">Niskogradnja</option></select></div>
      </div>
      <div id="nivoFillBox" style="display:${samoPro?'block':'none'}">${sifrarnikChecklist('projektovanje', true)}</div>
      <div id="mereFillBox" style="display:${samoPro?'none':'block'}">
        <div class="f-row"><label>Ugovoreni predmer iz Excela (investitorski šablon: list po vrsti radova, br. poz | opis | JM | količina | jed. cena bez PDV) — artikli iz šifarnika se dodaju kasnije na strani Predmer</label>
          <div class="tools" style="margin:0"><label class="btn ghost" style="cursor:pointer">⇧ Učitaj predmer (.xlsx) <input id="pm_fajl" type="file" accept=".xlsx" style="display:none" onchange="predmerIzFajla(this,'pm_pregled')"></label><span class="sub">ukupno bez PDV se računa automatski; artikli iz šifarnika se skidaju sa stanja magacina</span></div>
          <div id="pm_pregled"></div>
        </div></div>`}
      <div class="f-2">
        <div class="f-row"><label>Klijent</label><select id="f_kli"${ed?'':' onchange="toggleNoviKlijent(this.value)"'}>${DATA.clijenti.map(c=>`<option value="${c.id}"${sel(g&&g.klijent,c.id)}>${c.naziv}</option>`).join('')}${ed?'':'<option value="__novi__">＋ Novi klijent…</option>'}</select></div>
        <div class="f-row"><label>Rukovodilac</label><select id="f_ruk">${rukLista.map(z=>`<option value="${z.id}"${sel(g&&g.rukovodilac,z.id)}>${z.ime}</option>`).join('')}</select></div>
      </div>
      ${ed?'':`<div id="noviKlijentBox" style="display:none;background:var(--paper);border:1px solid var(--line);border-radius:10px;padding:12px 13px;margin-bottom:14px">
        <div style="font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--faint);font-weight:600;margin-bottom:9px">Podaci novog klijenta</div>
        <div class="f-2">
          <div class="f-row" style="margin-bottom:10px"><label>Naziv klijenta</label><input id="f_nk_naziv" placeholder="Firma ili ime i prezime"></div>
          <div class="f-row" style="margin-bottom:10px"><label>Tip</label><select id="f_nk_tip"><option>Privatna firma</option><option>Javni sektor</option><option>Fizičko lice</option></select></div>
        </div>
        <div class="f-2">
          <div class="f-row" style="margin-bottom:2px"><label>Kontakt osoba</label><input id="f_nk_osoba"></div>
          <div class="f-row" style="margin-bottom:2px"><label>Telefon</label><input id="f_nk_tel"></div>
        </div>
      </div>`}
      ${(!ed||canFinance())?`<div class="f-2">
        <div class="f-row"><label>Ugovorena cena bez PDV (RSD)</label><input id="f_cena" type="number" placeholder="npr. 150000000"${va(g&&g.budzet)}></div>
        <div class="f-row"><label>Planirani troškovi bez PDV (RSD)</label><input id="f_tro" type="number" placeholder="npr. 127500000"${va(g&&g.troskovi)}></div>
      </div>`:''}
      <div class="f-2">
        <div class="f-row"><label>Početak radova</label><input id="f_poc" type="date" value="${ed?g.pocetak:todayStr()}"></div>
        <div class="f-row"><label>Rok završetka</label><input id="f_rok" type="date" value="${ed?g.rok:plusDays(365)}"></div>
      </div>
      <div class="m-foot">
        <button class="btn ghost" onclick="closeModal()">Otkaži</button>
        <button class="btn" onclick="${ed?`saveSite('${id}')`:'saveSite()'}">${ed?'Sačuvaj izmene':'Sačuvaj gradilište'}</button>
      </div>
    </div>`, {siroka:!ed, kljuc:'gradiliste'});
}
/* Projektovanje pri kreiranju: sve 3 faze (IDR / IDP-PGD / PZI) sa svim podfazama,
   svaka sa čekboksom (ukloni ako ne treba) i zaduženim (zaposleni ili spoljni saradnik).
   Čekirane postaju redovi Specifikacije usluga sa `zaduzen`. Indeks je globalan kroz nivoe. */
/* Ceklista iz sifrarnika (DATA.sifrarnik) za oba modula. Indeks k = pozicija u sifrarnikZa(modul)
   (globalan kroz grupe) — saveSite/saveIzSifarnika iteriraju ISTU listu.
   projektovanje: f_nd_k + f_ndz_k (podrazumevano cekirano); izvodjenje: f_sf_k + f_sfk_k (kolicina) + f_sfz_k (podrazumevano necekirano). */
function sifrarnikPoz(s, modul){ return modul==='projektovanje' ? (s.grupa?s.grupa+' — ':'')+s.naziv : s.naziv; }
function zaduzenOpcije(sel){ const s=id=>id===sel?' selected':''; return [...DATA.zaposleni.map(z=>`<option value="${z.id}"${s(z.id)}>${z.ime}</option>`), ...(DATA.podizvodjaci||[]).map(p=>`<option value="${p.id}"${s(p.id)}>${p.naziv} (spoljni)</option>`)].join(''); }
/* „Razno" (projektovanje, samo pri kreiranju): slobodne stavke ispod svih svezaka — f_nr_k (naziv) + f_nrz_k (zaduzen),
   k = 0..RAZNO_N-1 (brojac, NE getElementById-petlja: dom-stub vraca element za svaki id). Prazne se preskacu u saveSite. */
let RAZNO_N=0, RAZNO_MODUL='projektovanje';   // RAZNO_MODUL postavlja sifrarnikChecklist(…, razno=true)
function dodajRaznoRed(){
  const box=document.getElementById('raznoBox'); if(!box) return;
  const k=RAZNO_N++;
  const d=document.createElement('div'); d.style.cssText='display:flex;align-items:center;gap:8px;margin-bottom:4px;flex-wrap:wrap';
  const st='font-size:12px;padding:5px 6px';
  if(RAZNO_MODUL==='izvodjenje'){
    d.innerHTML=`<input id="f_nr_${k}" placeholder="npr. Usluga montaže, Dodatni materijal…" style="flex:1 1 160px;min-width:0;${st}">
      <select id="f_nrj_${k}" style="width:70px;${st}">${SF_JM.map(j=>`<option value="${j}"${j==='kom'?' selected':''}>${j}</option>`).join('')}</select>
      <input type="number" id="f_nrk_${k}" placeholder="količina" style="width:84px;${st}">
      ${canFinance()?`<input type="number" id="f_nrc_${k}" placeholder="cena RSD" title="jedinična cena bez PDV" style="width:84px;${st}">`:''}
      <select id="f_nrz_${k}" style="width:34%;min-width:0;${st}"><option value="">— zadužen —</option>${zaduzenOpcije()}</select>`;
  } else {
    d.innerHTML=`<input id="f_nr_${k}" placeholder="npr. Geodetski snimak, Elaborat…" style="flex:1;min-width:0;${st}">
      <select id="f_nrz_${k}" style="width:46%;min-width:0;${st}"><option value="">— zadužen —</option>${zaduzenOpcije()}</select>`;
  }
  box.appendChild(d);
  const i=document.getElementById('f_nr_'+k); if(i&&i.focus) i.focus();
}
/* Izvodjenje: Razno redovi (f_nr_k…) → predmer (poz, jm, kol, cena, zaduzen; bez sifre). Vraca broj dodatih. */
function dodajRaznoIzvodjenje(grId){
  const v=id=>{ const e=document.getElementById(id); return e?String(e.value):''; };
  const ts=Date.now(); let n=0;
  for(let k=0;k<RAZNO_N;k++){
    const naziv=esc(v('f_nr_'+k).trim()); if(!naziv) continue;
    const rawK=v('f_nrk_'+k).trim(); let kol=rawK===''?1:+rawK; if(!Number.isFinite(kol)||kol<=0) kol=1;
    const rawC=v('f_nrc_'+k).trim(); let cena=rawC===''?0:+rawC; if(!Number.isFinite(cena)||cena<0) cena=0;
    DATA.predmer.push({id:'pm'+ts+'-r'+(n++), gr:grId, poz:naziv, jm:esc(v('f_nrj_'+k))||'kom', kol, cena:canFinance()?cena:0, izv:0, zaduzen:v('f_nrz_'+k)||null, sifra:null, rb:sledeciRb(grId)});
  }
  RAZNO_N=0;
  return n;
}
function sifrarnikChecklist(modul, razno){   // razno=true SAMO tamo gde saveSite cita f_nr_k (formSite novo); drugi pozivaoci ne smeju da je prikazu
  const pro=modul==='projektovanje';
  const opcije=zaduzenOpcije();
  RAZNO_N=0; if(razno) RAZNO_MODUL=modul;
  const lista=sifrarnikZa(modul), grupe=[];
  lista.forEach((s,k)=>{ let gr=grupe.find(x=>x.naziv===s.grupa); if(!gr){ gr={naziv:s.grupa,red:[]}; grupe.push(gr); } gr.red.push([s,k]); });
  const cid=pro?'f_nd_':'f_sf_', zid=pro?'f_ndz_':'f_sfz_';
  const label=pro?'Specifikacija — sveske po nivoima dokumentacije (odčekiraj šta ne treba, dodeli zaduženog)':'Predmer — artikli iz šifarnika (čekiraj šta ulazi, upiši količinu'+(canFinance()?' i jediničnu cenu bez PDV u RSD':'')+')';
  return `<div class="f-row"><label>${label}</label>
    ${pro?'':`<input placeholder="🔍 filtriraj po šifri, nazivu ili grupi" oninput="filtrirajSifrarnik(this)" style="margin-bottom:6px">`}
    <div class="chk-list" style="max-height:260px;overflow-y:auto">${grupe.map(gr=>`
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--faint);font-weight:700;margin:8px 0 4px">${gr.naziv||'—'}</div>
      ${gr.red.map(([s,k])=>`<div class="sf-red" data-txt="${((s.sifra||'')+' '+s.naziv+' '+(s.grupa||'')).toLowerCase()}" style="display:flex;align-items:center;gap:8px;margin-bottom:4px;flex-wrap:wrap">
        <label class="chk" style="flex:1 1 240px;min-width:0;margin:0"><input type="checkbox" id="${cid}${k}" data-naziv="${s.naziv}" data-jm="${s.jm||''}" data-grupa="${s.grupa||''}" data-sifra="${s.sifra||''}"${pro?' checked':''}> ${s.sifra?`<span class="num sub">${s.sifra}</span> `:''}${s.naziv}${pro?'':` <span class="sub">(${s.jm||'kom'})</span>`}</label>
        ${pro?'':`<input type="number" id="f_sfk_${k}" placeholder="količina" style="width:84px;font-size:12px;padding:5px 6px">`}
        ${pro||!canFinance()?'':`<input type="number" id="f_sfc_${k}" placeholder="cena RSD" title="jedinična cena bez PDV" style="width:84px;font-size:12px;padding:5px 6px">`}
        <select id="${zid}${k}" style="width:${pro?'46%':'34%'};min-width:0;font-size:12px;padding:5px 6px"><option value="">— zadužen —</option>${opcije}</select>
      </div>`).join('')}`).join('')}
      ${razno?`<div style="font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--faint);font-weight:700;margin:8px 0 4px">Razno${pro?'':' (usluge i stavke van šifarnika)'}</div>
      <div id="raznoBox"></div>
      <button type="button" class="btn ghost" style="font-size:12px;padding:5px 10px;min-height:0;margin:2px 0 6px" onclick="dodajRaznoRed()">＋ Dodaj stavku</button>`:''}
    </div></div>`;
}
/* Filter ceklista (izvodjenje: 24 pozicije + 81 artikal): sakriva .sf-red cije data-txt ne sadrzi upit. */
function filtrirajSifrarnik(inp){
  const q=String(inp&&inp.value||'').trim().toLowerCase();
  const box=inp&&inp.parentElement&&inp.parentElement.querySelector?inp.parentElement.querySelector('.chk-list'):null;
  if(!box||!box.querySelectorAll) return;
  box.querySelectorAll('.sf-red').forEach(d=>{ d.style.display=(!q||String(d.dataset&&d.dataset.txt||'').includes(q))?'':'none'; });
}
function toggleTipRadova(val){
  const pro = val==='projektovanje';
  const b=document.getElementById('tipRadovaBox'); if(b) b.style.display = pro?'none':'block';
  const f=document.getElementById('nivoFillBox'); if(f) f.style.display = pro?'block':'none';
  const m=document.getElementById('mereFillBox'); if(m) m.style.display = pro?'none':'block';
}
function toggleNoviKlijent(val){
  const box=document.getElementById('noviKlijentBox');
  if(box) box.style.display = val==='__novi__' ? 'block' : 'none';
}
function saveSite(grId){
  if(!isDirector()) return;
  const v=id=>document.getElementById(id).value;
  if(grId){   // IZMENA postojećeg: modul/napredak/status/potroseno/naplaceno/adm se ne diraju; prazan datum/rukovodilac/klijent = zadrži staro (pravilo 6, RLS)
    const g=grById[grId]; if(!g) return;
    const nazivE=esc(String(v('f_naziv')).trim()); if(!nazivE){ alert('Unesi naziv projekta.'); return; }
    g.naziv=nazivE; g.lok=esc(String(v('f_lok')).trim())||'—'; g.adresa=esc(String(v('f_adresa')).trim())||null; g.povrsina=+v('f_povrsina')||null;   // nadzor: polje uklonjeno iz forme (2026-10-07), kolona ostaje za stare podatke
    g.klijent=v('f_kli')||g.klijent; g.rukovodilac=v('f_ruk')||g.rukovodilac;
    g.pocetak=v('f_poc')||g.pocetak; g.rok=v('f_rok')||g.rok;
    const tipPre=g.tip;   // nivo gradilista se vise ne menja (uklonjeno iz forme 2026-10-14)
    if(!jePro(g)) g.tip=v('f_tip')||g.tip||'visokogradnja';
    if(canFinance()){ const c=String(v('f_cena')).trim(), t=String(v('f_tro')).trim(); if(c!=='') g.budzet=+c||0; if(t!=='') g.troskovi=+t||0; }
    if(g.tip!==tipPre&&!fazeZa(g).includes(g.faza)) g.faza=fazeZa(g)[0];   // promena tipa → stara faza ne postoji u novom šablonu
    saveState(); closeModal(); rebuildMaps(); renderNav(); render(); openSite(grId);
    return;
  }
  const naziv=esc(v('f_naziv').trim()); if(!naziv){ alert('Unesi naziv projekta.'); return; }
  let klijentId=v('f_kli');
  if(klijentId==='__novi__'){
    const kNaziv=esc(v('f_nk_naziv').trim());
    if(!kNaziv){ alert('Unesi naziv novog klijenta.'); return; }
    klijentId='c'+Date.now();
    DATA.clijenti.push({ id:klijentId, naziv:kNaziv, tip:v('f_nk_tip'), osoba:esc(v('f_nk_osoba').trim())||'—', tel:esc(v('f_nk_tel').trim())||'—', mail:'—' });
  }
  const cena=+v('f_cena')||0; const troRaw=v('f_tro').trim(); const tro=troRaw!==''?(+troRaw||0):Math.round(cena*0.85);
  const gid='g'+Date.now();
  const jeProNovi = v('f_modul')==='projektovanje';
  DATA.gradilista.push({
    id:gid, naziv, modul:v('f_modul')||'izvodjenje', tip:(v('f_modul')==='projektovanje'?null:(v('f_tip')||'visokogradnja')), lok:esc(v('f_lok').trim())||'—', adresa:esc(String(v('f_adresa')).trim())||null, povrsina:+v('f_povrsina')||null, nadzor:'', adm:{}, nivo:null, klijent:klijentId, rukovodilac:v('f_ruk'),
    pocetak:v('f_poc')||todayStr(), rok:v('f_rok')||plusDays(180), napredak:0, status:'planirano', faza:(jeProNovi?'Idejno rešenje':'Priprema terena'),
    budzet:cena, troskovi:tro, potroseno:0, naplaceno:0
  });
  if(jeProNovi){
    /* Čeklista iz šifarnika (sifrarnikChecklist): čekirane → redovi specifikacije sa zaduženim */
    const ts=Date.now(); let n=0;
    sifrarnikZa('projektovanje').forEach((s,idx)=>{
      const c=document.getElementById('f_nd_'+idx); if(!c||!c.checked) return;
      const z=document.getElementById('f_ndz_'+idx); const zad=(z&&z.value)||null;
      DATA.predmer.push({id:'pm'+ts+'-'+(n++), gr:gid, poz:sifrarnikPoz(s,'projektovanje'), jm:s.jm||'kom', kol:1, cena:0, izv:0, zaduzen:zad, rb:sledeciRb(gid)});
    });
    for(let k=0;k<RAZNO_N;k++){   // „Razno": slobodne stavke, prazne se preskacu
      const inp=document.getElementById('f_nr_'+k); const naziv=esc(String((inp&&inp.value)||'').trim()); if(!naziv) continue;
      const z=document.getElementById('f_nrz_'+k); const zad=(z&&z.value)||null;
      DATA.predmer.push({id:'pm'+ts+'-'+(n++), gr:gid, poz:'Razno — '+naziv, jm:'kom', kol:1, cena:0, izv:0, zaduzen:zad, rb:sledeciRb(gid)});
    }
    RAZNO_N=0;
  } else {
    dodajPredmerIzPripreme(gid);   // forma novog gradilista Izvodjenja nema ceklist u sifarnika (2026-10-23) — artikli se dodaju kasnije (formIzSifarnika)
    skiniSaStanjaZaPredmer(gid, predmerZa(gid));   // ugovorene kolicine artikala → izlaz iz magacina (zahtev 2026-10-23)
    /* Zadaci se pri kreiranju NE seju (odluka 2026-10-09): šablon faza ostaje opciono dugme u fioci (ubaciSablonFaza). */
  }
  rebuildMaps(); if(jeProNovi) sinhronizujSveske(gid);
  saveState(); closeModal(); renderNav(); render();
}

function formTask(pre){   // pre = {gr, naziv, opis, rok, zad} popuna iz asistenta (nivo 2); korisnik i dalje klikne „Sačuvaj“
  const ids=visibleSiteIds();
  const sites=DATA.gradilista.filter(g=>jePro(g)&&(isDirector()||ids.has(g.id)));   // zadaci samo u Projektovanju
  if(!sites.length){ alert('Zadaci postoje samo na gradilištima Projektovanja.'); return; }
  openModal(`
    <div class="m-h"><h3>Novi zadatak</h3><button class="x" style="position:static" onclick="closeModal()">${icon('x')}</button></div>
    <div class="m-b">
      <div class="f-row"><label>Naziv zadatka</label><input id="f_tnaziv" placeholder="npr. Betoniranje temelja"></div>
      <div class="f-row"><label>Opis (opciono)</label><textarea id="f_topis" placeholder="Šta tačno treba uraditi, gde, sa čim…" style="min-height:64px"></textarea></div>
      <div class="f-2">
        <div class="f-row"><label>Gradilište</label><select id="f_tgr">${sites.map(g=>`<option value="${g.id}">${g.naziv}</option>`).join('')}</select></div>
        <div class="f-row"><label>Zadužen</label><select id="f_tzad">${DATA.zaposleni.map(z=>`<option value="${z.id}">${z.ime}</option>`).join('')}</select></div>
      </div>
      <div class="f-2">
        <div class="f-row"><label>Prioritet</label><select id="f_tprio"><option value="high">Visok</option><option value="mid" selected>Srednji</option><option value="low">Nizak</option></select></div>
        <div class="f-row"><label>Rok</label><input id="f_trok" type="date" value="${plusDays(14)}"></div>
      </div>
      <div class="m-foot">
        <button class="btn ghost" onclick="closeModal()">Otkaži</button>
        <button class="btn" onclick="saveTask()">Sačuvaj zadatak</button>
      </div>
    </div>`);
  if(pre&&typeof pre==='object'){ const set=(id,v)=>{ const e=document.getElementById(id); if(e&&v!=null&&v!=='') e.value=v; }; set('f_tgr',pre.gr); set('f_tnaziv',pre.naziv); set('f_topis',pre.opis); set('f_trok',pre.rok); set('f_tzad',pre.zad); }
}
function saveTask(){
  const v=id=>document.getElementById(id).value;
  if(!smemNa(v('f_tgr'))){ alert('Zadatke mozes da otvaras samo na svom gradilistu.'); return; }
  if(!jePro(grById[v('f_tgr')])){ alert('Zadaci postoje samo na gradilištima Projektovanja.'); return; }
  const naziv=esc(v('f_tnaziv').trim()); if(!naziv){ alert('Unesi naziv zadatka.'); return; }
  const opisEl=document.getElementById('f_topis'); const opis=esc(String(opisEl?opisEl.value:'').trim());
  DATA.zadaci.push({ id:'t'+Date.now(), naziv, opis, gr:v('f_tgr'), zad:v('f_tzad'), prio:v('f_tprio'), kol:'todo', rok:v('f_trok')||plusDays(14) });
  saveState(); closeModal(); renderNav(); render();
}

function formClient(){
  openModal(`
    <div class="m-h"><h3>Novi klijent</h3><button class="x" style="position:static" onclick="closeModal()">${icon('x')}</button></div>
    <div class="m-b">
      <div class="f-row"><label>Naziv</label><input id="f_cnaziv" placeholder="Firma ili ime i prezime"></div>
      <div class="f-row"><label>Tip</label><select id="f_ctip"><option>Privatna firma</option><option>Javni sektor</option><option>Fizičko lice</option></select></div>
      <div class="f-2">
        <div class="f-row"><label>Kontakt osoba</label><input id="f_cosoba"></div>
        <div class="f-row"><label>Telefon</label><input id="f_ctel"></div>
      </div>
      <div class="f-row"><label>E-mail</label><input id="f_cmail" type="email"></div>
      <div class="m-foot">
        <button class="btn ghost" onclick="closeModal()">Otkaži</button>
        <button class="btn" onclick="saveClient()">Sačuvaj klijenta</button>
      </div>
    </div>`);
}
function saveClient(){
  if(!isDirector()) return;
  const v=id=>document.getElementById(id).value;
  const naziv=esc(v('f_cnaziv').trim()); if(!naziv){ alert('Unesi naziv klijenta.'); return; }
  DATA.clijenti.push({ id:'c'+Date.now(), naziv, tip:v('f_ctip'), osoba:esc(v('f_cosoba').trim())||'—', tel:esc(v('f_ctel').trim())||'—', mail:esc(v('f_cmail').trim())||'—' });
  rebuildMaps(); saveState(); closeModal(); renderNav(); render();
}

function formDiary(){
  const ids=visibleSiteIds();
  const sites=DATA.gradilista.filter(g=>isDirector()||ids.has(g.id));
  const autori = isDirector()? DATA.zaposleni : DATA.zaposleni.filter(z=>z.id===ROLE || (z.grs||[]).some(x=>ids.has(x)));
  openModal(`
    <div class="m-h"><h3>Novi unos u dnevnik</h3><button class="x" style="position:static" onclick="closeModal()">${icon('x')}</button></div>
    <div class="m-b">
      <div class="f-2">
        <div class="f-row"><label>Gradilište</label><select id="f_dgr">${sites.map(g=>`<option value="${g.id}">${g.naziv}</option>`).join('')}</select></div>
        ${isDirector()
          ?`<div class="f-row"><label>Autor</label><select id="f_dautor">${autori.map(z=>`<option value="${z.id}" ${z.id===ROLE?'selected':''}>${z.ime}</option>`).join('')}</select></div>`
          :`<div class="f-row"><label>Autor</label><div style="padding:8px 0;font-size:13.5px;font-weight:600">${osobaIme(ROLE)}</div></div>`}
      </div>
      <div class="f-row"><label>Datum</label><input id="f_ddatum" type="date" value="${todayStr()}"></div>
      <div class="f-row"><label>Izveštaj</label><textarea id="f_dtekst" placeholder="Šta je urađeno danas, šta je zapelo, šta se čeka…"></textarea></div>
      <div class="m-foot">
        <button class="btn ghost" onclick="closeModal()">Otkaži</button>
        <button class="btn" onclick="saveDiary()">Sačuvaj unos</button>
      </div>
    </div>`);
}
function saveDiary(){
  const v=id=>document.getElementById(id).value;
  if(!vidimGr(v('f_dgr'))){ alert('Dnevnik mozes da vodis samo za svoje gradiliste.'); return; }
  const tekst=esc(v('f_dtekst').trim()); if(!tekst){ alert('Unesi tekst izveštaja.'); return; }
  /* Niko osim uprave ne moze da potpise unos tudjim imenom (server: autor = moj_autor()). */
  const autor = isDirector() ? v('f_dautor') : ROLE;
  DATA.dnevnik.push({ id:'d'+Date.now(), datum:v('f_ddatum')||todayStr(), gr:v('f_dgr'), autor, tekst });
  saveState(); closeModal(); renderNav(); render();
}

