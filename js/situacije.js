/* ---------- NAPLATA (SITUACIJE) ---------- */
function viewPay(){
  if(!isDirector()){ current='dash'; return viewDash(); }   // samo uprava (tabDozvoljen); rukovodilac sa finansijama vidi situacije u fioci
  const mIds=visibleSiteIds();
  const sits=[...(DATA.situacije||[])].filter(x=>mIds.has(x.gr)&&imaNaplatu(grById[x.gr])).sort((a,b)=>dParse(b.izdato)-dParse(a.izdato));   // samo Izvodjenje
  const uk=arr=>arr.reduce((a,b)=>a+(b.iznos||0),0);
  const izdato=uk(sits.filter(s=>pregledSit(s)==='odobrena')), placeno=uk(sits.filter(s=>s.status==='placeno'));   // na pregledu / vracene ne ulaze u izdato
  const dospele=sits.filter(s=>s.status!=='placeno'&&sitKasni(s)), brisiKol=jeSuper()||jeDirektorModula();   // kolona brisanja: direktor / direktor izvodjenja (po redu smemBrisati)
  const rows=sits.map(s=>{
    const g=grById[s.gr];
    const st = pregledSit(s)!=='odobrena'?pregledBadge(s):s.status==='placeno'?'<span class="badge b-green">Plaćeno</span>':sitKasni(s)?'<span class="badge b-red">Kasni</span>':'<span class="badge b-amber">Na čekanju</span>';
    const rz=razlikaSit(s);
    return `<tr>
      <td><div class="strong num" style="color:var(--blue);cursor:pointer" onclick="detaljSituacije('${s.id}')">${s.br}</div><div class="sub">${sitVrsta(s)} · ${s.opis}${rz?` · <span class="badge b-amber">${rz} preko ugovora</span>`:''}</div></td>
      <td><span style="color:var(--blue);font-weight:600;cursor:pointer" onclick="openSite('${s.gr}')">${g?g.naziv:'—'}</span></td>
      <td class="r num-cell strong">${s.iznos!=null?fmtEur(s.iznos):'—'}</td>
      <td class="num-cell">${fmtDate(s.izdato)}</td>
      <td class="num-cell">${fmtDate(s.valuta)}</td>
      <td>${st}</td>
      <td class="r" style="white-space:nowrap">${s.status!=='placeno'&&pregledSit(s)==='odobrena'?`<button class="btn ghost" style="padding:5px 10px;font-size:12px" onclick="markPaid('${s.id}')">✓ Plaćeno</button> `:''}${izvozLinkovi(s)}</td>
      ${brisiKol?`<td class="r">${smemBrisati(s.gr)?BRISI_DUGME('obrisiSituaciju',s.id):''}</td>`:''}
    </tr>`;
  }).join('');
  return head('Naplata','Privremene situacije po projektima — šta je izdato, šta plaćeno, ko probija valutu.') +
  `<div class="grid kpis kpis3">
    <div class="card kpi"><div class="accent"></div>
      <div class="lab">${icon('money')} Ukupno izdato</div>
      <div class="val num" style="font-size:24px">${fmtEur(izdato)}</div>
      <div class="sub">${sits.length} situacija</div></div>
    <div class="card kpi green"><div class="accent"></div>
      <div class="lab">${icon('check')} Naplaćeno</div>
      <div class="val num" style="font-size:24px">${fmtEur(placeno)}</div>
      <div class="sub">${izdato?Math.round(placeno/izdato*100):0}% izdatog</div></div>
    <div class="card kpi ${dospele.length?'red':'green'}"><div class="accent"></div>
      <div class="lab">${icon('warn')} Dospelo, neplaćeno</div>
      <div class="val num" style="font-size:24px">${fmtEur(uk(dospele))}</div>
      <div class="sub">${dospele.length?dospele.length+' situacija probilo valutu':'Ništa ne kasni'}</div></div>
  </div>
  <div class="tools"><button class="btn" onclick="formSit()">${icon('plus')} Nova situacija</button></div>
  <div class="card"><div style="overflow-x:auto"><table>
    <thead><tr><th>Situacija</th><th>Projekat</th><th class="r">Iznos</th><th>Izdato</th><th>Valuta</th><th>Status</th><th></th>${brisiKol?'<th></th>':''}</tr></thead>
    <tbody>${rows}</tbody></table>
    ${sits.length?'':'<div class="empty">Još nema izdatih situacija.</div>'}
  </div>`;
}
function markPaid(id){ if(!canFinance()) return; const s=(DATA.situacije||[]).find(x=>x.id===id); if(s&&smemNa(s.gr)&&pregledSit(s)==='odobrena'){ s.status='placeno'; saveState(); render(); osveziDetaljSituacije(id); } }   // samo odobrena
/* ---------- SITUACIJE SA STAVKAMA (migracija 19) ----------
   Rukovodilac (vodim) pravi privremenu/okoncanu situaciju iz predmera (+ artikli iz sifarnika van predmera);
   kolicine mogu da odstupe od ugovorenih. Server (preracunaj_situacije, security definer — ima cene) racuna
   kol_ugovoreno, kumulativ po artiklu kroz situacije (izdato, id), razlika = max(0, kumulativ - ugovoreno) i
   situacije.iznos = Σ kol × predmer.cena. Klijent ISTO racuna lokalno (preracunajSituacijeLokalno) radi trenutnog
   prikaza — formula na DVA mesta, menjati oba. Rukovodilac bez finansija: iznos = null (situacije_v). Uprava
   "dobija razliku": computeAlerts + detalj situacije. predmer.izv se NE menja iz situacije (pravilo 5: izv ima svoj
   izvor — Izvedeno iz Excela); okoncana je samo oznaka vrste. */
function stavkeZa(sitId){ return (DATA.situacija_stavke||[]).filter(x=>x.sit===sitId); }
function razlikaSit(s){ return s?stavkeZa(s.id).filter(x=>(+x.razlika||0)>0).length:0; }
function sitVrsta(s){ return s&&s.vrsta==='okoncana'?'Okončana':'Privremena'; }
/* PREGLED SITUACIJA (migracija 25, odluka klijenta 2026-10-13): rukovodilac sacuva → 'na_pregledu'; uprava odobri ili vrati
   uz komentar ('vracena'); rukovodilac vracenu ispravi i posalje ponovo (→ 'na_pregledu'). Odobrena je zakljucana za
   ne-upravu (server trigeri). Tek ODOBRENA ulazi u naplatu (sitKasni/markPaid/KPI) i u realizacijaSituacija. Istoriju
   odluka (pregledao/pregledano/istorija) pise SERVER pri svakoj promeni `pregled`; klijent je upise samo za trenutni prikaz. */
const PREGLED_LAB={na_pregledu:['Na pregledu','b-amber'], odobrena:['Odobrena','b-green'], vracena:['Vraćena','b-red']};
function pregledSit(s){ return (s&&s.pregled)||'odobrena'; }   // stari redovi / demo bez polja = odobrena
function pregledBadge(s){ const l=PREGLED_LAB[pregledSit(s)]||PREGLED_LAB.odobrena; return `<span class="badge ${l[1]}">${l[0]}</span>`; }
function zabeleziPregled(s, odluka, komentar){   // lokalni pecat radi trenutnog prikaza — server prepisuje svojim (trigger)
  s.pregled=odluka; s.pregledao=ROLE==='all'?'direkcija':ROLE; s.pregledano=new Date().toISOString();
  s.istorija=[...(Array.isArray(s.istorija)?s.istorija:[]), {kad:s.pregledano, ko:s.pregledao, odluka, komentar:odluka==='na_pregledu'?null:(komentar||null)}];
}
function odobriSituaciju(id){
  const s=(DATA.situacije||[]).find(x=>x.id===id); if(!s||!isDirector()||!smemNa(s.gr)||pregledSit(s)==='odobrena') return;
  zabeleziPregled(s,'odobrena', s.komentar);
  beleziLog('situacija_pregled',{sit:id, br:unesc(s.br), gr:s.gr, odluka:'odobrena'});
  saveState(); render(); osveziDetaljSituacije(id); osveziFioku(s.gr);
}
function vratiSituaciju(id, predlog){   // predlog = podrazumevani komentar (asistent, nivo 2); direktor ga vidi i menja u promptu
  const s=(DATA.situacije||[]).find(x=>x.id===id); if(!s||!isDirector()||!smemNa(s.gr)||pregledSit(s)!=='na_pregledu') return;
  const k=prompt('Komentar za rukovodioca (šta treba ispraviti):', predlog?String(predlog):''); if(k==null||!String(k).trim()) return;
  s.komentar=esc(String(k).trim());
  zabeleziPregled(s,'vracena', s.komentar);
  beleziLog('situacija_pregled',{sit:id, br:unesc(s.br), gr:s.gr, odluka:'vracena', komentar:unesc(s.komentar)});
  saveState(); render(); osveziDetaljSituacije(id); osveziFioku(s.gr);
}
function istorijaPregledaHtml(s){
  const h=Array.isArray(s.istorija)?s.istorija:[]; if(!h.length) return '';
  const lab=o=>o==='odobrena'?'odobrio':o==='vracena'?'vratio':'poslao na pregled';
  return `<div class="sub" style="margin-top:8px"><b>Istorija pregleda</b>${h.map(x=>`<div>${x.kad?fmtDate(String(x.kad).slice(0,10)):''} · ${x.ko==='direkcija'?'Direkcija':osobaIme(x.ko)} ${lab(x.odluka)}${x.komentar?': '+x.komentar:''}</div>`).join('')}</div>`;
}
function kljucStavke(x){ return x.predmer_id||(x.sifra?'sifra:'+x.sifra:'poz:'+String(x.poz||'').toLowerCase()); }
function preracunajSituacijeLokalno(grId){
  const sits=sitZa(grId).slice().sort((a,b)=>String(a.izdato).localeCompare(String(b.izdato))||String(a.id).localeCompare(String(b.id)));
  const pmById={}; predmerZa(grId).forEach(p=>pmById[p.id]=p);
  const imaCene=canFinance() && predmerZa(grId).some(p=>p.cena!=null);   // iznos pise samo ko vidi finansije (rukovodilac Izvodjenja ima cene od migracije 23, ali iznos ostaje serverov)
  const kum={};
  sits.forEach(s=>{
    const st=stavkeZa(s.id).slice().sort((a,b)=>String(a.id).localeCompare(String(b.id)));
    let iznos=0;
    st.forEach(x=>{
      const p=x.predmer_id?pmById[x.predmer_id]:null;
      x.kol_ugovoreno=p?(+p.kol||0):0;
      const k=kljucStavke(x); kum[k]=(kum[k]||0)+(+x.kol||0);
      x.kumulativ=kum[k]; x.razlika=Math.max(0, x.kumulativ-x.kol_ugovoreno);
      iznos+=(+x.kol||0)*(p&&p.cena!=null?+p.cena:0);
    });
    if(st.length && imaCene) s.iznos=Math.round(iznos*100)/100;
  });
}
/* Predmer iz Excela (investitorski sablon „ПРЕДМЕР И ПРЕДРАЧУН": list po vrsti radova; kolone br. poz | opis | JM |
   kol | jed. cena bez PDV | ukupno). Isti nacin citanja reda kao kod situacije (JM = prvi kratak tekst iza opisa pa broj;
   prazan opis → prethodni red; „укупно" se preskace). Stavka traži kol I cenu odmah iza JM (red bez cene, npr. prazan
   duplikat kamere, se preskace). Ukupno se NE cita — racuna se kol × cena; ako fajl ima ukupno koje odstupa > 0,5,
   kolicina se uskladi sa ukupnim (Excel formule sa skrivenim udelom) i to se prijavi. Vraca {redovi:[{sifra,poz,jm,kol,cena}], uskladjeno, listova}. */
function upariPredmerSablon(redovi){
  const out=[], kljucevi=new Set(); let lastDesc='', lastDescRaw='', lastCode='', uskladjeno=0;
  /* izvor (migracija 29): list = ime lista (vrsta radova), sekcija = naslov VELIKIM slovima sa šifrom („4.0 ДЕМОНТАЖНИ РАДОВИ"),
     nadpoz = naslov pozicije iznad stavki bez sopstvene šifre („4.0.1 Демонтажа…"), cir = originalni tekst stavke ako je ćiriličan.
     Sve u ORIGINALNOM pismu iz fajla (red.izvorno) — izvoz ih konvertuje po potrebi. */
  let list=null, sekcija=null, nadpoz=null;
  const broj2=v=>{ if(typeof v==='number') return v; if(v===''||v==null||!/\d/.test(String(v))) return null; const n=broj(v); return Number.isFinite(n)?n:null; };
  const cist=v=>String(v??'').replace(/\s+/g,' ').trim();
  const jmIndex=r=>{ for(let i=2;i<r.length;i++){ const v=r[i]; if(typeof v==='string'&&v.trim()&&v.trim().length<=10&&i+1<r.length&&broj2(r[i+1])!=null) return i; } return -1; };
  (redovi||[]).forEach((r,ri)=>{
    const lst=r.list||null; if(lst!==list){ list=lst; sekcija=null; nadpoz=null; }
    const raw=r.izvorno||r, code=cist(r[0]), desc=cist(r[1]), descRaw=cist(raw[1]);
    if(/^(укупно|ukupno|рекапитулација|rekapitulacija)/i.test(desc)||/^(укупно|ukupno)/i.test(code)) return;
    const jmIdx=jmIndex(r);
    if(jmIdx<0){
      if(code&&desc){ lastCode=code; lastDesc=desc; lastDescRaw=descRaw;
        const nx=redovi[ri+1], nxStavkaBezSifre=!!nx && (nx.list||null)===lst && !cist(nx[0]) && jmIndex(nx)>=0;   // naslov iza koga ODMAH ide stavka bez šifre = pozicija velikim slovima, ne sekcija
        if(desc===desc.toUpperCase()&&/\p{L}/u.test(desc)&&!nxStavkaBezSifre){ sekcija=cist(raw[0])+' '+descRaw; nadpoz=null; } else nadpoz=cist(raw[0])+' '+descRaw; }
      else if(desc){ lastDesc=desc; lastDescRaw=descRaw; }
      else if(code){ lastCode=code; }
      return; }
    const ime=desc||lastDesc, imeRaw=desc?descRaw:lastDescRaw, sifra=code||lastCode;
    if(code) nadpoz=null;   // stavka sa sopstvenom šifrom nije pod nadpozicijom
    if(desc){ lastDesc=desc; lastDescRaw=descRaw; } if(code) lastCode=code;
    const kol=broj2(r[jmIdx+1]), cena=broj2(r[jmIdx+2]), tot=broj2(r[jmIdx+3]);
    if(kol==null||kol<=0||cena==null||!ime) return;
    let k=kol; if(tot!=null&&cena>0&&Math.abs(kol*cena-tot)>0.5){ k=Math.round(tot/cena*10000)/10000; uskladjeno++; }
    const kljuc=(sifra+'|'+normPoz(ime)); if(kljucevi.has(kljuc)) return; kljucevi.add(kljuc);
    const izvor={list:list||null, sekcija:sekcija||null, nadpoz:nadpoz||null, cir:/[\u0400-\u04FF]/.test(imeRaw)?imeRaw:null};
    out.push({sifra:sifra||null, poz:ime, jm:String(r[jmIdx]).trim(), kol:k, cena, izvor:Object.values(izvor).some(Boolean)?izvor:null});
  });
  return {redovi:out, uskladjeno};
}
let PREDMER_PRIPREMA=null;   // {redovi} iz fajla u formi novog gradilista / uvoza — primenjuje se pri cuvanju
async function predmerIzFajla(inp, cilj){
  if(!isDirector()) return;
  const f=inp&&inp.files&&inp.files[0]; if(!f) return;
  const p=document.getElementById(cilj||'pm_pregled');
  try{
    if(!/\.xlsx$/i.test(f.name)) throw new Error('Učitaj .xlsx (stari .xls sačuvaj kao .xlsx u Excelu).');
    const rez=upariPredmerSablon(await citajXlsx(await f.arrayBuffer(), true));
    prikaziPredmerPripremu(rez, cilj);
  }catch(e){ PREDMER_PRIPREMA=null; if(p) p.innerHTML='<div class="banner">'+esc(e.message||String(e))+'</div>'; }
}
function prikaziPredmerPripremu(rez, cilj){
  PREDMER_PRIPREMA=rez.redovi.length?{redovi:rez.redovi}:null;
  const p=document.getElementById(cilj||'pm_pregled'); if(!p) return;
  const uk=rez.redovi.reduce((a,r)=>a+r.kol*r.cena,0);
  p.innerHTML=rez.redovi.length?`<div class="sub" style="margin:6px 0"><b>${rez.redovi.length}</b> pozicija iz fajla · ukupno bez PDV <b class="num">${fmtEur(uk)}</b> (računa se količina × cena)${rez.uskladjeno?` · ${rez.uskladjeno} ${rez.uskladjeno===1?'red':'reda'}: količina usklađena sa ukupnim iznosom iz fajla`:''}</div>
    <div style="overflow-x:auto;max-height:200px;overflow-y:auto"><table><thead><tr><th>Šifra</th><th>Pozicija</th><th>JM</th><th class="r">Kol.</th><th class="r">Jed. cena</th></tr></thead><tbody>
    ${rez.redovi.slice(0,200).map(r=>`<tr><td class="num sub">${esc(r.sifra||'')}</td><td>${esc(r.poz)}</td><td>${esc(r.jm)}</td><td class="r num">${r.kol}</td><td class="r num">${fmtEur(r.cena)}</td></tr>`).join('')}
    </tbody></table></div>`:'<div class="banner">U fajlu nije prepoznata nijedna pozicija (očekujem kolone: br. poz | opis | JM | količina | jed. cena bez PDV).</div>';
}
/* primena pripreme na gradiliste: nove pozicije (dedupe po sifra+naziv), vraca broj dodatih */
function dodajPredmerIzPripreme(grId){
  const gN=grById[grId]||DATA.gradilista.find(x=>x.id===grId);   // iz saveSite stize PRE rebuildMaps
  if(!isDirector()||!PREDMER_PRIPREMA||!gN||!modulDozvoljen(gN.modul||'izvodjenje')) return 0;
  const ima=new Set(predmerZa(grId).map(x=>String(x.sifra||'')+'|'+normPoz(x.poz)));
  const ts=Date.now(); let n=0;
  PREDMER_PRIPREMA.redovi.forEach(r=>{
    const poz=esc(r.poz), k=String(r.sifra||'')+'|'+normPoz(poz); if(ima.has(k)) return; ima.add(k);
    DATA.predmer.push({id:'pm'+ts+'-x'+(n++), gr:grId, poz, jm:esc(r.jm)||'kom', kol:r.kol, cena:canFinance()?r.cena:0, izv:0, zaduzen:null, sifra:r.sifra?esc(String(r.sifra)):null, izvor:escIzvor(r.izvor), rb:r.sifra&&!jeSifraArtikla(String(r.sifra))?esc(String(r.sifra)):sledeciRb(grId)});   // investitorska numeracija = rb
  });
  PREDMER_PRIPREMA=null;
  return n;
}
/* Situacija iz Excela (format investitorske privremene/okoncane situacije: list po vrsti radova; kolone
   br. poz | opis | JM | UGOVORENO kol, cena, ukupno | KUMULATIVNO IZVEDENO kol, cena, ukupno). Red stavke = prvi
   kratak tekst posle opisa je JM pa slede brojevi; opis prazan → opis prethodnog reda (tehnicka zastita);
   zaglavlje sa „кумулативно/kumulativ" odredjuje kolonu, inace 4. broj posle JM. Uparivanje po normalizovanom
   nazivu (kao izvedeno), rezervno po sifri kad je jedinstvena. Ova situacija = kumulativ − dosadasnje stavke. */
function upariSituaciju(grId, redovi){
  const lista=predmerZa(grId), spojeni=[], nepovezani=[];
  const poIme=new Map(lista.map(x=>[normPoz(x.poz),x]));
  const brSifra={}; lista.forEach(x=>{ if(x.sifra){ const k=String(x.sifra).trim().toLowerCase(); brSifra[k]=(brSifra[k]||0)+1; } });
  const poSifri=new Map(lista.filter(x=>x.sifra&&brSifra[String(x.sifra).trim().toLowerCase()]===1).map(x=>[String(x.sifra).trim().toLowerCase(),x]));
  const doSada={}; (DATA.situacija_stavke||[]).filter(x=>x.gr===grId).forEach(x=>{ const k=x.predmer_id||kljucStavke(x); doSada[k]=(doSada[k]||0)+(+x.kol||0); });
  let lastDesc='', lastCode='', kumCol=-1; const videno=new Set();
  const broj2=v=>{ if(typeof v==='number') return v; if(v===''||v==null||!/\d/.test(String(v))) return null; const n=broj(v); return Number.isFinite(n)?n:null; };   // „кол." nije broj (broj() bi dao 0)
  (redovi||[]).forEach(r=>{
    const low=r.map(c=>String(c??'').toLowerCase());
    const hi=low.findIndex(c=>/кумулатив|kumulativ/.test(c)); if(hi>=0){ kumCol=hi; return; }
    const code=String(r[0]??'').trim(), desc=String(r[1]??'').replace(/\s+/g,' ').trim();
    let jmIdx=-1;
    for(let i=2;i<r.length;i++){ const v=r[i]; if(typeof v==='string'&&v.trim()&&v.trim().length<=10&&i+1<r.length&&broj2(r[i+1])!=null){ jmIdx=i; break; } }
    if(jmIdx<0){ if(code&&desc){ lastCode=code; lastDesc=desc; } else if(desc){ lastDesc=desc; } else if(code){ lastCode=code; } return; }
    if(/^(укупно|ukupno)/i.test(desc)||/^(укупно|ukupno)/i.test(code)) return;   // zbirni redovi (i „УКУПНО | ВИДЕО НАДЗОР")
    const nums=[]; for(let i=jmIdx+1;i<r.length;i++){ const n=broj2(r[i]); if(n!=null) nums.push({i,n}); }
    let kum=null; if(kumCol>=0){ const f=nums.find(x=>x.i>=kumCol); if(f) kum=f.n; } else if(nums.length>=4) kum=nums[3].n;
    if(kum==null) return;   // list bez kumulativne kolone (obican predmer) — nista za situaciju
    const ime=desc||lastDesc, sifra=code||lastCode;
    if(desc) lastDesc=desc; if(code) lastCode=code;   // prazan red-nastavak ispod stavke nasledjuje STAVKU, ne naslov sekcije
    let x=poIme.get(normPoz(ime)); if(!x&&sifra) x=poSifri.get(sifra.toLowerCase());
    if(!x){ nepovezani.push(cir2lat(ime||sifra||'?')); return; }   // i nalepljeni/rucni redovi se prijavljuju latinicom
    if(videno.has(x.id)) return; videno.add(x.id);
    const ds=doSada[x.id]||0;
    spojeni.push({x, kum, doSada:ds, ova:Math.max(0, kum-ds)});
  });
  return {spojeni, nepovezani};
}
async function situacijaIzFajla(grId, inp){
  if(!smemNa(grId)) return;
  const f=inp&&inp.files&&inp.files[0]; if(!f) return;
  const p=document.getElementById('st_pregled');
  try{
    if(!/\.xlsx$/i.test(f.name)) throw new Error('Učitaj .xlsx (stari .xls sačuvaj kao .xlsx u Excelu).');
    const rez=upariSituaciju(grId, await citajXlsx(await f.arrayBuffer(), true));
    popuniSituacijuIzRedova(grId, rez);
  }catch(e){ if(p) p.innerHTML='<div class="banner">'+esc(e.message||String(e))+'</div>'; }
}
function popuniSituacijuIzRedova(grId, rez){
  let n=0; rez.spojeni.forEach(s=>{ const i=document.getElementById('st_k_'+s.x.id); if(i){ i.value=s.ova>0?String(s.ova):''; if(s.ova>0) n++; } });
  const p=document.getElementById('st_pregled'); if(!p) return n;
  const preko=rez.spojeni.filter(s=>s.kum>(+s.x.kol||0)).length;
  p.innerHTML=`<div class="sub" style="margin:6px 0">${rez.spojeni.length} pozicija prepoznato iz fajla · ${n} ulazi u ovu situaciju (kumulativ − do sada)${preko?` · <b style="color:var(--amber)">${preko} kumulativno preko ugovorene količine</b>`:''}</div>`
    +(rez.nepovezani.length?`<div class="banner">Nisu pronađene u predmeru (preskaču se): ${rez.nepovezani.slice(0,12).map(esc).join('; ')}${rez.nepovezani.length>12?' … (+'+(rez.nepovezani.length-12)+')':''}</div>`:'');
  return n;
}
let SIT_N=0, SIT_DODATNE={};   // k → sifrarnik.id (ne skriveno polje: dom-stub ne cita innerHTML)
function formSituacija(grId, sitId){   // sitId = izmena VRACENE situacije (rukovodilac ispravi i posalje ponovo)
  if(!smemNa(grId)) return;
  const g=grById[grId], pm=predmerZa(grId);
  if(!imaNaplatu(g)) return;   // Projektovanje nema situacija
  const s=sitId?(DATA.situacije||[]).find(x=>x.id===sitId&&x.gr===grId):null;
  if(sitId && (!s || pregledSit(s)!=='vracena')) return;
  const moje=s?stavkeZa(s.id):[], mojaKol=p=>{ const x=moje.find(y=>y.predmer_id===p.id); return x?x.kol:''; };
  const kumDo={}; (DATA.situacija_stavke||[]).filter(x=>x.gr===grId&&(!s||x.sit!==s.id)).forEach(x=>{ const k=kljucStavke(x); kumDo[k]=(kumDo[k]||0)+(+x.kol||0); });
  SIT_N=0; SIT_DODATNE={};
  const redovi=pm.map(p=>`<tr><td class="num sub">${p.sifra||''}</td><td>${p.poz}</td><td>${p.jm||''}</td><td class="r num">${p.kol}</td><td class="r num">${kumDo[p.id]||0}</td><td class="r"><input type="number" id="st_k_${p.id}" placeholder="0" value="${mojaKol(p)}" style="width:90px;font-size:12px;padding:5px 6px"></td></tr>`).join('');
  const uPredmeru=s=>pm.some(p=>(s.sifra&&p.sifra===s.sifra)||unesc(p.poz).trim().toLowerCase()===unesc(s.naziv).trim().toLowerCase());
  const sfOpt=jePro(g)?'':sifrarnikZa('izvodjenje').filter(s=>!uPredmeru(s)).map(s=>`<option value="${s.id}">${s.sifra?s.sifra+' · ':''}${s.naziv} (${s.jm||'kom'})</option>`).join('');   // Projektovanje nema sifarnik
  openModal(`
    <div class="m-h"><h3>${s?'Izmena vraćene situacije '+s.br:'Nova situacija'} — ${g.naziv}</h3><button class="x" style="position:static" onclick="closeModal()">${icon('x')}</button></div>
    <div class="m-b">
      ${s&&s.komentar?`<div class="banner" style="margin-bottom:10px">↩ Komentar uprave: <b>${s.komentar}</b></div>`:''}
      <div class="f-2">
        <div class="f-row"><label>Vrsta</label><select id="f_svrsta"><option value="privremena"${s&&s.vrsta!=='okoncana'?' selected':''}>Privremena situacija</option><option value="okoncana"${s&&s.vrsta==='okoncana'?' selected':''}>Okončana situacija</option></select></div>
        <div class="f-row"><label>Broj situacije</label><input id="f_sbr" placeholder="npr. PS-05/26"${s?` value="${s.br}"`:''}></div>
      </div>
      <div class="f-row"><label>Opis</label><input id="f_sopis" placeholder="npr. Radovi za oktobar"${s?` value="${s.opis==='—'?'':s.opis}"`:''}></div>
      <div class="f-2">
        <div class="f-row"><label>Datum izdavanja</label><input id="f_sizdato" type="date" value="${s?s.izdato:todayStr()}"></div>
        <div class="f-row"><label>Valuta plaćanja</label><input id="f_svaluta" type="date" value="${s?s.valuta:plusDays(15)}"></div>
      </div>
      ${pm.length&&!jePro(g)?`<div class="tools" style="margin:0 0 8px"><label class="btn ghost" style="cursor:pointer">⇧ Učitaj iz Excela (privremena / okončana situacija) <input id="st_fajl" type="file" accept=".xlsx" style="display:none" onchange="situacijaIzFajla('${grId}',this)"></label><span class="sub">kumulativne količine iz fajla − dosadašnje situacije = ova situacija</span></div><div id="st_pregled"></div>`:''}
      <div class="f-row"><label>Količine u ovoj situaciji (iz ${jePro(g)?'specifikacije':'predmera'}; prazno = ne ulazi)</label>
        <div style="overflow-x:auto;max-height:300px;overflow-y:auto"><table>
          <thead><tr><th>Šifra</th><th>Pozicija</th><th>JM</th><th class="r">Ugovoreno</th><th class="r">Do sada</th><th class="r">Ova situacija</th></tr></thead>
          <tbody>${redovi||'<tr><td colspan="6" class="empty">Predmer je prazan — dodaj stavke iz šifarnika ispod.</td></tr>'}</tbody>
          <tbody id="sitDodatne"></tbody></table></div>
      </div>
      ${sfOpt?`<div class="tools" style="margin:0 0 10px"><select id="st_sf" style="min-width:0;flex:1">${sfOpt}</select><button type="button" class="btn ghost" onclick="dodajStavkuIzSifarnika()">＋ Dodaj iz šifarnika</button></div>`:''}
      <div class="sub" style="margin-bottom:12px">Stavke kojih nema u ugovorenom predmeru idu celom količinom u razliku; cenu im naknadno određuje uprava.</div>
      <div class="m-foot">
        <button class="btn ghost" onclick="closeModal()">Otkaži</button>
        <button class="btn" onclick="saveSituacija('${grId}'${s?`,'${s.id}'`:''})">${s?'Sačuvaj i pošalji ponovo na pregled':'Sačuvaj situaciju'}</button>
      </div>
    </div>`, {siroka:true, kljuc:'situacija'});
  if(s) moje.filter(x=>!x.predmer_id).forEach(x=>{ const sf=(DATA.sifrarnik||[]).find(y=>y.sifra&&y.sifra===x.sifra); if(sf){ dodajStavkuIzSifarnika(sf.id); const i=document.getElementById('st_xk_'+(SIT_N-1)); if(i) i.value=x.kol; } });   // stavke van predmera iz vracene situacije
}
function dodajStavkuIzSifarnika(sfId){
  const sel=document.getElementById('st_sf'); const s=(DATA.sifrarnik||[]).find(x=>x.id===(sfId||(sel&&sel.value))); if(!s) return;
  const tb=document.getElementById('sitDodatne'); if(!tb) return;
  const k=SIT_N++; SIT_DODATNE[k]=s.id;
  const tr=document.createElement('tr');
  tr.innerHTML=`<td class="num sub">${s.sifra||''}</td><td>${s.naziv}</td><td>${s.jm||'kom'}</td><td class="r num">0</td><td class="r num">0</td><td class="r"><input type="number" id="st_xk_${k}" placeholder="0" style="width:90px;font-size:12px;padding:5px 6px"></td>`;
  tb.appendChild(tr);
  const i=document.getElementById('st_xk_'+k); if(i&&i.focus) i.focus();
}
async function saveSituacija(grId, sitId){
  if(!smemNa(grId) || !imaNaplatu(grById[grId])) return;   // Projektovanje nema situacija (pravilo 2: guard i u save-u)
  const v=id=>{ const e=document.getElementById(id); return e?String(e.value):''; };
  const br=esc(v('f_sbr').trim()); if(!br){ alert('Unesi broj situacije.'); return; }
  const vrsta=v('f_svrsta')==='okoncana'?'okoncana':'privremena';
  const stara=sitId?(DATA.situacije||[]).find(x=>x.id===sitId&&x.gr===grId):null;
  if(sitId && (!stara || pregledSit(stara)!=='vracena')) return;   // izmena samo vracene
  const sid=stara?stara.id:'s'+Date.now(), ts=Date.now(); let n=0; const stavke=[];
  const kolOd=raw=>{ raw=String(raw).trim(); if(raw==='') return null; const k=+raw; return (Number.isFinite(k)&&k>0)?k:null; };   // type=number (pravilo 4)
  predmerZa(grId).forEach(p=>{ const kol=kolOd(v('st_k_'+p.id)); if(kol==null) return;
    stavke.push({id:'st'+ts+'-'+(n++), sit:sid, gr:grId, predmer_id:p.id, sifra:p.sifra||null, poz:p.poz, jm:p.jm||null, kol, kol_ugovoreno:0, kumulativ:0, razlika:0}); });
  for(let k=0;k<SIT_N;k++){ const sf=(DATA.sifrarnik||[]).find(x=>x.id===SIT_DODATNE[k]); const kol=kolOd(v('st_xk_'+k)); if(!sf||kol==null) continue;
    stavke.push({id:'st'+ts+'-'+(n++), sit:sid, gr:grId, predmer_id:null, sifra:sf.sifra||null, poz:sf.naziv, jm:sf.jm||null, kol, kol_ugovoreno:0, kumulativ:0, razlika:0}); }
  if(!stavke.length){ alert('Unesi količinu bar za jednu stavku.'); return; }
  DATA.situacija_stavke=DATA.situacija_stavke||[];
  if(stara){   // izmena vracene: postojece stavke azuriraj, nove ubaci, prazne obrisi (server prvo), pa ponovo na pregled
    const postojece=stavkeZa(sid), kljucN=x=>x.predmer_id||('sifra:'+x.sifra);
    for(const x of stavke){ const p=postojece.find(y=>kljucN(y)===kljucN(x)); if(p) p.kol=x.kol; else DATA.situacija_stavke.push(x); }
    for(const p of postojece){ if(!stavke.some(x=>kljucN(x)===kljucN(p))) await obrisiRed('situacija_stavke', p.id, 'stavku '+unesc(p.poz)); }
    stara.br=br; stara.opis=esc(v('f_sopis').trim())||'—'; stara.izdato=v('f_sizdato')||stara.izdato; stara.valuta=v('f_svaluta')||stara.valuta; stara.vrsta=vrsta;
    zabeleziPregled(stara,'na_pregledu');
    beleziLog('situacija_ponovo',{sit:sid, br:unesc(br), gr:grId});
  } else {
    DATA.situacije.push({ id:sid, gr:grId, br, opis:esc(v('f_sopis').trim())||'—', iznos:0, izdato:v('f_sizdato')||todayStr(), valuta:v('f_svaluta')||plusDays(15), status:'ceka', vrsta, autor:ROLE==='all'?'direkcija':ROLE, napomena:null,
      pregled:isDirector()?'odobrena':'na_pregledu', komentar:null, pregledao:isDirector()?(ROLE==='all'?'direkcija':ROLE):null, pregledano:isDirector()?new Date().toISOString():null, istorija:[] });   // uprava: odmah odobrena; rukovodilac: ceka pregled (server to i sam sprovodi)
    stavke.forEach(x=>DATA.situacija_stavke.push(x));
  }
  preracunajSituacijeLokalno(grId); SIT_N=0; SIT_DODATNE={};
  saveState(); closeModal(); renderNav(); render(); osveziFioku(grId);
  const rz=razlikaSit(DATA.situacije.find(x=>x.id===sid));
  if(rz) alert('Situacija je sačuvana. '+rz+' stavk'+(rz===1?'a je':'i su')+' preko ugovorene količine — uprava dobija razliku za dogovor sa investitorom.');
}
function detaljSituacije(id){
  const s=(DATA.situacije||[]).find(x=>x.id===id); if(!s||!vidimGr(s.gr)) return;
  const g=grById[s.gr], fin=vidimCene(s.gr), nap=canFinance(), st=stavkeZa(id), pmById={}; predmerZa(s.gr).forEach(p=>pmById[p.id]=p);   // fin: jed. cena po stavci; nap: iznos po stavci, ukupno, Placeno
  const rows=st.map(x=>{ const p=x.predmer_id?pmById[x.predmer_id]:null, cena=p&&p.cena!=null?+p.cena:null;
    return `<tr${(+x.razlika||0)>0?' style="background:var(--amber-soft)"':''}><td class="num sub">${x.sifra||''}</td><td>${x.poz}${x.predmer_id?'':' <span class="badge b-amber">van predmera</span>'}</td><td>${x.jm||''}</td><td class="r num">${x.kol_ugovoreno}</td><td class="r num">${x.kumulativ}</td><td class="r num strong">${x.kol}</td><td class="r num" style="color:${(+x.razlika||0)>0?'var(--red)':'var(--muted)'}">${(+x.razlika||0)>0?'+'+x.razlika:'—'}</td>${fin?`<td class="r num">${cena!=null?fmtEur(cena):'—'}</td>`:''}${nap?`<td class="r num">${cena!=null?fmtEur(cena*(+x.kol||0)):'—'}</td>`:''}</tr>`; }).join('');
  const rz=razlikaSit(s);
  openModal(`
    <div class="m-h"><h3>${sitVrsta(s)} situacija ${s.br}</h3><button class="x" style="position:static" onclick="closeModal()">${icon('x')}</button></div>
    <div class="m-b">
      <div class="sub" style="margin-bottom:10px">${g?g.naziv:'—'} · ${s.opis} · izdato ${fmtDate(s.izdato)}, valuta ${fmtDate(s.valuta)} · ${pregledBadge(s)} ${pregledSit(s)==='odobrena'?(s.status==='placeno'?'plaćeno':sitKasni(s)?'kasni':'na čekanju'):''} · autor: ${s.autor==='direkcija'?'Direkcija':osobaIme(s.autor)}${s.pregledao&&pregledSit(s)!=='na_pregledu'?` · ${pregledSit(s)==='odobrena'?'odobrio':'vratio'}: ${s.pregledao==='direkcija'?'Direkcija':osobaIme(s.pregledao)}${s.pregledano?' ('+fmtDate(String(s.pregledano).slice(0,10))+')':''}`:''}</div>
      ${pregledSit(s)==='vracena'&&s.komentar?`<div class="banner" style="margin-bottom:10px">↩ Vraćena rukovodiocu — komentar uprave: <b>${s.komentar}</b></div>`:''}
      ${pregledSit(s)==='na_pregledu'?`<div class="banner blue" style="margin-bottom:10px">${isDirector()?'Čeka tvoj pregled: odobri je ili vrati rukovodiocu uz komentar.':'Poslata upravi na pregled — do odobrenja ne ulazi u naplatu.'}</div>`:''}
      ${rz?`<div class="banner" style="margin-bottom:10px">⚠ ${rz} stavk${rz===1?'a je':'i su'} preko ugovorene količine (kumulativno) — razlika za dogovor sa investitorom.</div>`:''}
      <div style="overflow-x:auto"><table>
        <thead><tr><th>Šifra</th><th>Pozicija</th><th>JM</th><th class="r">Ugovoreno</th><th class="r">Kumulativ</th><th class="r">Ova situacija</th><th class="r">Razlika</th>${fin?'<th class="r">Jed. cena (bez PDV)</th>':''}${nap?'<th class="r">Iznos (bez PDV)</th>':''}</tr></thead>
        <tbody>${rows||`<tr><td colspan="${7+(fin?1:0)+(nap?1:0)}" class="empty">Situacija nema stavke (uneta ručno kao iznos).</td></tr>`}</tbody></table></div>
      ${nap?`<div style="text-align:right;margin-top:10px;font-weight:700">Ukupno: <span class="num">${s.iznos!=null?fmtEur(s.iznos):'—'}</span></div>`:''}
      ${istorijaPregledaHtml(s)}
      <div class="m-foot">
        ${isDirector()&&pregledSit(s)==='na_pregledu'?`<button class="btn ghost" onclick="vratiSituaciju('${s.id}')">↩ Vrati rukovodiocu</button>`:''}
        ${isDirector()&&pregledSit(s)!=='odobrena'?`<button class="btn ghost" onclick="odobriSituaciju('${s.id}')">✓ Odobri</button>`:''}
        ${!isDirector()&&smemNa(s.gr)&&pregledSit(s)==='vracena'?`<button class="btn ghost" onclick="closeModal();formSituacija('${s.gr}','${s.id}')">✎ Ispravi i pošalji ponovo</button>`:''}
        ${nap&&s.status!=='placeno'&&pregledSit(s)==='odobrena'?`<button class="btn ghost" onclick="markPaid('${s.id}')">✓ Plaćeno</button>`:''}
        ${aiDostupan()&&supa&&pregledSit(s)!=='odobrena'?`<button class="btn ghost" onclick="aiPregledSituacije('${s.id}')">🤖 Pregledaj sa asistentom</button>`:''}
        ${smemIzvozSituacije(s)?`<button class="btn ghost" onclick="izvozSituacije('${s.id}','lat')">⬇ Excel (latinica)</button><button class="btn ghost" onclick="izvozSituacije('${s.id}','cir')">⬇ Excel (ćirilica)</button>`:''}
        <button class="btn" onclick="closeModal()">Zatvori</button>
      </div>
    </div>`, {siroka:true, kljuc:'situacija'});
}
function osveziDetaljSituacije(id){ const m=document.getElementById('modal'); if(m && String(m.innerHTML||'').includes('situacija '+((DATA.situacije||[]).find(x=>x.id===id)||{}).br)) detaljSituacije(id); }
/* Naplata → "Nova situacija": izbor gradilista (vodim), pa formSituacija */
function formSit(){
  const l=visibleSites().filter(g=>smemNa(g.id)&&imaNaplatu(g)); if(!l.length) return;
  if(l.length===1) return formSituacija(l[0].id);
  openModal(`
    <div class="m-h"><h3>Nova situacija</h3><button class="x" style="position:static" onclick="closeModal()">${icon('x')}</button></div>
    <div class="m-b">
      <div class="f-row"><label>Gradilište</label><select id="f_sgr">${l.map(g=>`<option value="${g.id}">${g.naziv}</option>`).join('')}</select></div>
      <div class="m-foot">
        <button class="btn ghost" onclick="closeModal()">Otkaži</button>
        <button class="btn" onclick="formSituacija(document.getElementById('f_sgr').value)">Dalje →</button>
      </div>
    </div>`);
}
