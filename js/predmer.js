/* ---------- PREDMER / SPECIFIKACIJA USLUGA ---------- */
/* Sifrarnik mera/pozicija (tabela `sifrarnik`, migracija 14): projektovanje = nivoi dokumentacije
   (grupa = nivo), izvodjenje = tipicne pozicije po grupama radova. Uprava ga uredjuje u Admin kokpitu;
   pri kreiranju gradilista se bira iz njega (ceklista). DEMO se generise iz NIVOI_DOK + ove liste —
   ISTI sadrzaj kao seed u migraciji 14 (menjati oba). */
/* 24 'pozicije radova' (sf-i-*) su izbrisane 2026-10-11 (migracija 21): sifarnik Izvodjenja = 81 artikal (ARTIKLI_ELOM) + Razno. */
/* 81 artikal "ELOM projekt" (PDF Sifarnik artikala + 3 dopune) — ISTI sadrzaj kao seed migracije 19: [sifra, naziv, jm] */
const ARTIKLI_ELOM=[
  ["01-1", "PEGASUS HO 6W 24v IP65Warm White Medium Titan", "kom"],
  ["01-2", "PEGASUS Antiglare Accessory Titan", "kom"],
  ["01-3", "Picket for PEGASUS", "kom"],
  ["01-4", "Connector 4-pole IP68", "kom"],
  ["01-5", "DRIVER LED 24V DC/60W IP 67 162,5x42,5x32", "kom"],
  ["1", "Svetiljka I-TRON ZERO 5p5 STU-M 7040.100-1M,19.1W,4000k,2890lm AEC ILLUMINAZIONE", "kom"],
  ["10", "Dekorativni aluminijumski stup zip POLE RX2 ALLUMINIUM 5.0 5000MM sa dve lire", "kom"],
  ["11", "Priključna ploča za jedan osigurač TERMINAL BOARD FOR RX ALLUMINIUM POLE,1 FUSE", "kom"],
  ["12", "Priključna ploča za dva osigurača TERMINAL BOARD FOR RX ALLUMINIUM POLE,2 FUSE", "kom"],
  ["13", "Set za ankerisanje M18", "kom"],
  ["14", "S-PREVIDIA-C200LG", "kom"],
  ["15", "S-PREVIDIA-CDIAL", "kom"],
  ["16", "ULTRA 12150", "kom"],
  ["17", "S-WD100", "kom"],
  ["18", "S-WC0010", "kom"],
  ["19", "S-EWT100", "kom"],
  ["2", "Svetiljka I-TRON ZERO 5P5 STU-M 7040.140-2M,52.3W,4000K,7930lm AEC ILLUMINAZIONE", "kom"],
  ["20", "S-XWT100", "kom"],
  ["21", "S-SPS24060S", "kom"],
  ["22", "ULTRA 1270", "kom"],
  ["23", "S-WS2010RE", "kom"],
  ["24", "S-WM110", "kom"],
  ["25", "S-WM202SR", "kom"],
  ["26", "Vrata za stubove serije RX-2", "kom"],
  ["27", "Obojena kapa za stub", "kom"],
  ["28", "Set za montazu", "kom"],
  ["29", "S-L-MC-SG", "kom"],
  ["3", "Svetiljka ALO 1 2AB10 ASW 7040.350-22M ES OT30 240W,400K AEC ILLUMINAZIONE", "kom"],
  ["30", "S-L-OP-SG", "kom"],
  ["31", "S-SGCP200", "kom"],
  ["32", "S-VW2W100", "kom"],
  ["33", "S-SGWE100", "kom"],
  ["34", "S-CWS100", "kom"],
  ["35", "S-SGWS-MOD", "kom"],
  ["36", "Čelični nož TB 30", "kom"],
  ["37", "Čelični nož TB 31", "kom"],
  ["38", "Adresabilna centrala za dojavu pozara PREVIDIA-C-100LG INIM", "kom"],
  ["39", "Antres P 62 7,stubovi ,VALMONT", "kom"],
  ["4", "Svetiljka I-TRON ZERO 5p5 STU-M 7040.140-4M Cl.2 AEC ILLUMINAZIONE", "kom"],
  ["40", "Electric connecting box TB-2", "kom"],
  ["41", "Gumeni orebljeni podmetac 300x300", "kom"],
  ["42", "ITALO 1 5P5 STA 7040.100-3M CL.2 Grafite", "kom"],
  ["43", "Svetiljka ECO RAYS TP 5P5 S05 7040.100-1M Cl.2 F grafite", "kom"],
  ["44", "MX PRO 2 5P5 AS-45W 7040.120-7M Cl.2F Vin E1 120mA", "kom"],
  ["45", "Svetiljka I-TRON ZERO 5P5STE-M 7040.140-2M CL.2 F Vin E1 140mA Grafite", "kom"],
  ["5", "Svetiljka I-TRON ZERO 5P5 STU-M 7040.140-3M CL.2 AEC ILLUMINAZIONE", "kom"],
  ["6", "Svetiljka ECO RAYS TP 5P5 STA 7040.100-2M AEC ILLUMINAZIONE", "kom"],
  ["7", "Kapica cap for nema socket JL-208 IP66 AEC ILLUMINAZIONE", "kom"],
  ["8", "Svetiljka tipa MOD 2.0 URBAN 200 RX2 (500) 0F2H1 S05 4,7-1m CR170 cl.2 FIX AEC ILLUMINAZIONE", "kom"],
  ["9", "Dekorativni aluminijumski stub tip POLE RX2 ALLUMINIUM 5.0 5000MM sa jednom lirom", "kom"],
  ["M001", "Elektronski prihvatnik 6-14 V AC/DC za blokadu/deblokadu", "kom"],
  ["M002", "Razvodni orman sistema tehnicke zastite", "kom"],
  ["M003", "Modul kontrole pristupasa 20RFID kartica", "kom"],
  ["M004", "Citac RFID/NFC kartica i tagova", "kom"],
  ["M005", "Svetiljka DN142B 10S/840 PSU-E WR Philips", "kom"],
  ["M006", "AWEX panik svetiljka EXIT S1 WIP65", "kom"],
  ["M007", "ANSEC samostojeci rek ormar 33U", "kom"],
  ["M008", "ANSEC zidni rek ormar 15U", "kom"],
  ["M009", "Parapet 210x90", "m"],
  ["M010", "GA-OTRW poklopac za parapet", "m"],
  ["M011", "svetiljka WL060V LED 17S/840 PSU Philips", "kom"],
  ["M012", "Svetiljka WL070V GEN2 11_17S/830_860 PSU PHILIPS", "kom"],
  ["M013", "Svetiljka WT065C G3 LED 68S/840 PSU", "kom"],
  ["M014", "AWEX panik svetiljka EXIT S IP65 LED 1W", "kom"],
  ["M015", "Svetiljka RC065B G5 LED 41S/840 PSU W60L60 PHILIPS", "kom"],
  ["M016", "Nadrgradni ram 600x600x70mm", "kom"],
  ["M017", "Svetiljka LL24x 80S/840 NE PSU a BV WH PHILIPS", "kom"],
  ["M018", "SAM NADGRADNA PANIK SVETILJKA 20M 4,8W3H", "kom"],
  ["M019", "Gromobran sa ranim startovanjem D368425-60M", "kom"],
  ["M020", "Svetiljka DN145B LED 20S/830 840 PSUWh+RAM PHILIPS", "kom"],
  ["M021", "Svetiljka RC065B G5 41S/840 PSU W60L60 NOC PHILIPS", "kom"],
  ["M022", "Svetiljka Sm060C G2 34_ 40S/840 PSU W20L120 NOC PHILIPS", "kom"],
  ["M023", "Svetiljka WL070V GEN2 11_17S/830 840 860 PSU PHILIPS", "kom"],
  ["M024", "AJAX Hub2 WH", "kom"],
  ["M025", "AJAX Keypad WH", "kom"],
  ["M026", "AJAX DoorProtect WH", "kom"],
  ["M027", "AJAX MOtionProtect WH", "kom"],
  ["M028", "AJAX HomeSiren WH", "kom"],
  ["46", "Svetiljka ITALO 1 5P5 7040.120-3M 65.6W AEC ILLUMINAZIONE", "kom"],
  ["47", "Svetiljka ITALO 1 5P5 7040.200-3M 113W AEC ILLUMINAZIONE", "kom"],
  ["M029", "Svetiljka RC132V G6 36S/840 PSU W60L60", "kom"]
];
function sifrarnikDemo(){ const out=[];   // lazy: NIVOI_DOK je const ispod (TDZ pri ucitavanju skripte)
  const baza=[0,10,30];   // IDR 01-06, IDP/PGD 11-27, PZI 31-43 — isti id-jevi kao migracija 14
  Object.entries(NIVOI_DOK).forEach(([niv,l],gi)=>l.forEach((naziv,i)=>{ const n=baza[gi]+i+1; out.push({id:'sf-p-'+String(n).padStart(2,'0'), naziv, jm:'kom', grupa:niv, modul:'projektovanje', redosled:n, aktivan:true}); }));
  ARTIKLI_ELOM.forEach(([sifra,naziv,jm],i)=>out.push({id:'sf-a-'+String(i+1).padStart(3,'0'), naziv, jm, grupa:'Artikli (ELOM)', modul:'izvodjenje', redosled:200+i+1, aktivan:true, sifra}));
  return out; }
function sifrarnikZa(modul){ return (DATA.sifrarnik||[]).filter(s=>s.aktivan!==false && (!s.modul || s.modul===modul)).sort((a,b)=>(a.redosled||0)-(b.redosled||0)); }
const NIVOI_DOK={
  'IDR':['PDR','UP','KTP','Elaborat posebnih delova','Konceptualno rešenje','IDR'],
  'IDP/PGD':['1.0 Arhitektura','2.0 Konstrukcija','3.0 ViK','4.0 Elektroenergetika','5.1 Telekomunikacije i signalne inst.','5.2 Dojava požara','5.3 Video nadzor','6.0 Mašinske instalacije','7.0 Tehnologija','8.0 Saobraćaj i saobraćajna sign.','9.0 Parterno uređenje','10.0 Pripremni radovi','Elaborat energetske efikasnosti','Elaborat o geotehničkim uslovima','Elaborat zaštite od požara','Plan upravljanja otpadom','Energetski pasoš'],
  'PZI':['1.0 Arhitektura','2.0 Konstrukcija','3.0 ViK','4.0 Elektroenergetika','5.1 Telekomunikacije i signalne inst.','5.2 Dojava požara','5.3 Video nadzor','6.0 Mašinske instalacije','7.0 Tehnologija','8.0 Saobraćaj i saobraćajna sign.','9.0 Parterno uređenje','Plan preventivnih mera','Glavni projekat zaštite od požara']
};
/* Sabloni faza za Izvodjenje. Svaka faza nosi tipicne zadatke; SAMO na zahtev iz fioke
   (ubaciSablonFaza — od 2026-10-09 vise ne pri kreiranju) sejemo ih u Kanban sa rokovima
   rasporedjenim od pocetka do roka gradilista. Redosled = redosled faza. fazeZa() i dalje
   cita imena faza odavde. */
const SABLONI_FAZA={
  visokogradnja:[
    {faza:'Priprema terena',  zadaci:['Prijava gradilišta i tabla','Ograđivanje i obezbeđenje','Geodetsko obeležavanje','Privremeni priključci (voda, struja)']},
    {faza:'Zemljani radovi',  zadaci:['Iskop','Odvoz viška materijala','Nasipanje i nabijanje']},
    {faza:'Temelji',          zadaci:['Podložni beton','Hidroizolacija temelja','Armiranje i betoniranje temelja']},
    {faza:'Konstrukcija',     zadaci:['AB stubovi i zidovi','Međuspratne ploče','Stepeništa','Krovna konstrukcija']},
    {faza:'Grubi radovi',     zadaci:['Zidanje','Krov i pokrivanje','Fasadna stolarija']},
    {faza:'Instalacije',      zadaci:['ViK instalacije','Elektro instalacije','Mašinske instalacije / grejanje','Slabostrujne instalacije']},
    {faza:'Završni radovi',   zadaci:['Malterisanje','Podovi','Keramika','Molersko-farbarski radovi','Unutrašnja stolarija','Fasada']},
    {faza:'Tehnički prijem',  zadaci:['Atesti i dokumentacija','Tehnički pregled','Otklanjanje primedbi komisije']},
  ],
  niskogradnja:[
    {faza:'Priprema terena',  zadaci:['Prijava gradilišta i tabla','Privremena saobraćajna signalizacija','Geodetsko obeležavanje trase','Uklanjanje rastinja i objekata']},
    {faza:'Zemljani radovi',  zadaci:['Iskop','Nasip i nabijanje','Uređenje posteljice']},
    {faza:'Odvodnjavanje',    zadaci:['Kanalizacija i slivnici','Rigole i propusti','Drenaža']},
    {faza:'Instalacije',      zadaci:['Vodovod','Elektro i javna rasveta','Telekomunikacije','Gas']},
    {faza:'Donji stroj',      zadaci:['Tamponski sloj','Nosivi sloj']},
    {faza:'Gornji stroj',     zadaci:['Bitumenizirani nosivi sloj','Habajući sloj','Ivičnjaci i trotoari']},
    {faza:'Signalizacija',    zadaci:['Horizontalna signalizacija','Vertikalna signalizacija','Zaštitna oprema']},
    {faza:'Tehnički prijem',  zadaci:['Atesti i dokumentacija','Tehnički pregled','Otklanjanje primedbi komisije']},
  ],
};
const FAZE_PRO=['Idejno rešenje','IDR','IDP/PGD','PZI','Tehnička kontrola','Predato'];
/* Imena faza za gradiliste — jedan izvor i za sablon i za formUpdate. */
function fazeZa(g){
  if(jePro(g)) return FAZE_PRO;
  const s=SABLONI_FAZA[g.tip||'visokogradnja']||SABLONI_FAZA.visokogradnja;
  return [...s.map(x=>x.faza),'Predato'];
}
/* Sejanje zadataka iz sablona. Rokovi: faza i dobija (i+1)/N puta trajanje gradilista. */
function primeniSablonFaza(grId){
  if(!isDirector()) return 0;
  const g=grById[grId]; if(!g || jePro(g)) return 0;
  const s=SABLONI_FAZA[g.tip||'visokogradnja']; if(!s) return 0;
  const od=dParse(g.pocetak||todayStr()), doD=dParse(g.rok||plusDays(180));
  const traj=Math.max(1, daysBetween(od,doD));
  const ts=Date.now(); let n=0;
  s.forEach((f,i)=>{
    const d=new Date(od); d.setDate(d.getDate()+Math.round(traj*(i+1)/s.length));
    const rok=_iso(d);
    f.zadaci.forEach(z=>{
      DATA.zadaci.push({ id:'t'+ts+'-'+(n++), naziv:esc(f.faza+' — '+z), gr:grId, zad:g.rukovodilac||null, prio:'mid', kol:'todo', rok });
    });
  });
  return n;
}
function ubaciSablonFaza(grId){
  if(!isDirector()||!smemNa(grId)) return;
  const ima=DATA.zadaci.some(t=>t.gr===grId);
  if(ima && !confirm('Gradilište već ima zadatke. Dodati i zadatke iz šablona?')) return;
  const n=primeniSablonFaza(grId);
  if(n){ saveState(); renderNav(); render(); openSite(grId); }
}
/* Naknadno ubacivanje sablona nivoa (projektovanje): dodaje samo stavke kojih jos nema (isti oblik reda kao saveSite). */
/* ubaciSablonNivoa (sablon nivoa gradilista) je OBRISAN 2026-10-14: gradiliste nema nivo; sveske se biraju u cek-listi (formSite) ili kroz formPredmerRed (faza + cek-lista). */
/* Izvodjenje: ceklirane pozicije iz sifrarnika (sifrarnikChecklist('izvodjenje')) → redovi predmera.
   Preskace nazive koji vec postoje na gradilistu. Vraca broj dodatih. Poziva ga saveSite (novo) i saveIzSifarnika (postojece). */
function dodajIzSifarnika(grId){
  const ima=new Set(predmerZa(grId).map(r=>unesc(r.poz).trim().toLowerCase()));
  const imaSifra=new Set(predmerZa(grId).map(r=>r.sifra).filter(Boolean));   // artikal sa sifrom se poklapa po sifri
  const ts=Date.now(); let n=0;
  sifrarnikZa('izvodjenje').forEach((s,idx)=>{
    const c=document.getElementById('f_sf_'+idx); if(!c||!c.checked) return;
    const kljuc=unesc(s.naziv).trim().toLowerCase(); if(ima.has(kljuc)||(s.sifra&&imaSifra.has(s.sifra))) return;
    const z=document.getElementById('f_sfz_'+idx), ko=document.getElementById('f_sfk_'+idx), ce=document.getElementById('f_sfc_'+idx);
    const raw=ko?String(ko.value).trim():''; let kol=raw===''?1:+raw; if(!Number.isFinite(kol)||kol<=0) kol=1;   // type=number: kanonicna vrednost (pravilo 4)
    const rawC=ce?String(ce.value).trim():''; let cena=rawC===''?0:+rawC; if(!Number.isFinite(cena)||cena<0) cena=0;   // ugovorena jed. cena (uprava)
    DATA.predmer.push({id:'pm'+ts+'-s'+(n++), gr:grId, poz:s.naziv, jm:s.jm||'kom', kol, cena, izv:0, zaduzen:(z&&z.value)||null, sifra:s.sifra||null, rb:sledeciRb(grId)});
    ima.add(kljuc); if(s.sifra) imaSifra.add(s.sifra);
  });
  return n;
}
function formIzSifarnika(grId){
  if(!isDirector()) return;
  const g=grById[grId]; if(!g||jePro(g)) return;
  openModal(`
    <div class="m-h"><h3>Artikli iz šifarnika — ${g.naziv}</h3><button class="x" style="position:static" onclick="closeModal()">${icon('x')}</button></div>
    <div class="m-b">
      ${sifrarnikChecklist('izvodjenje', true)}
      <div class="m-foot">
        <button class="btn ghost" onclick="closeModal()">Otkaži</button>
        <button class="btn" onclick="saveIzSifarnika('${grId}')">Dodaj u predmer</button>
      </div>
    </div>`, {siroka:true, kljuc:'artikli'});
}
function saveIzSifarnika(grId){
  if(!isDirector()||!smemNa(grId)) return;
  const g=grById[grId]; if(!g||jePro(g)) return;
  const n=dodajIzSifarnika(grId)+dodajRaznoIzvodjenje(grId);
  if(n) skiniSaStanjaZaPredmer(grId, predmerZa(grId).slice(-n));
  osveziNapredak(grId); saveState(); closeModal(); render();
}
let PRED_ID=null;
function predmerZa(grId){ return (DATA.predmer||[]).filter(x=>x.gr===grId); }
/* Napredak = ugovoreno × izvedeno (od 2026-10-07): vrednosno ponderisan udeo izvedenog iz
   predmera; ako su sve cene 0 → po kolicinama. null = nema predmera (ostaje rucni napredak).
   ISTA formula je na serveru (napredak_iz_predmera + trigger na predmer, migracija 13) —
   server je izvor istine; direktor je racuna i lokalno radi trenutnog prikaza, rukovodilac
   (cene null) je dobija iz zdravlja_mojih(). Menjati na OBA mesta. */
function napredakIzPredmera(grId){
  const l=predmerZa(grId); if(!l.length) return null;
  const kol=r=>+r.kol||0, izv=r=>Math.min(Math.max(0,+r.izv||0), kol(r)), cena=r=>+r.cena||0;
  const ugV=l.reduce((s,r)=>s+kol(r)*cena(r),0);
  if(ugV>0) return Math.max(0,Math.min(100,Math.floor(100*l.reduce((s,r)=>s+izv(r)*cena(r),0)/ugV+0.5)));
  const ugK=l.reduce((s,r)=>s+kol(r),0);
  return ugK>0 ? Math.max(0,Math.min(100,Math.floor(100*l.reduce((s,r)=>s+izv(r),0)/ugK+0.5))) : 0;
}
function imaPredmer(grId){ return predmerZa(grId).length>0; }
/* Posle svake promene predmera: direktor (ima cene) azurira napredak lokalno; rukovodilac ceka server. */
function osveziNapredak(grId){
  const g=grById[grId]; if(!g||!canFinance()) return;
  const n=napredakIzPredmera(grId); if(n!==null && g.napredak!==n) g.napredak=n;
}
function jePro(g){ return (g.modul||'izvodjenje')==='projektovanje'; }
function predNaslov(g){ return jePro(g)?'Specifikacija usluga':'Predmer i količine'; }
function openPredmer(id){ if(!vidimGr(id)) return; PRED_ID=id; current='predmer'; render(); window.scrollTo(0,0); closeDrawer(); }
function zaduzenIme(zid){ if(!zid) return '—'; const z=zapById[zid]; if(z) return z.ime; const p=(DATA.podizvodjaci||[]).find(x=>x.id===zid); return p?p.naziv+' (spolj.)':'—'; }
function viewPredmer(){
  const g=grById[PRED_ID]; if(!g) { current='sites'; return viewSites(); }
  if(!vidimGr(g.id)){ current='dash'; return viewDash(); }
  const smem = smemNa(g.id);   // vodim: ucitavanje izvedenog; radnik/spoljni samo gledaju
  const fin=canFinance(), pro=jePro(g), cene=vidimCene(g.id);   // cene: kolone jed. cena/ukupno po redu; fin: KPI vrednosti
  const list=predmerZa(g.id);
  const ugUk=list.reduce((a,b)=>a+b.kol*b.cena,0);
  const izUk=list.reduce((a,b)=>a+Math.min(b.izv||0,b.kol)*b.cena,0);
  const tById={}; (DATA.zadaci||[]).forEach(t=>{ if(t.predmer_id) tById[t.predmer_id]=t; });
  const ST={todo:['Čeka','b-gray'], inprogress:['U toku','b-blue'], done:['Završeno','b-green']};
  const rows=pro?list.map((x,i)=>{ const t=tById[x.id], st=ST[(t&&t.kol)||'todo']||ST.todo;   // Projektovanje: sveska = dokument, bez JM/kolicine/izvedenog
    return `<tr>
      <td class="num" style="color:var(--faint)">${i+1}</td>
      <td class="strong">${x.poz}</td>
      <td>${fazaSveske(x.poz)}</td>
      <td><span class="badge ${st[1]}">${st[0]}</span></td>
      <td>${zaduzenIme(x.zaduzen)}</td>
      ${fin?`<td class="r num-cell">${fmtEur(x.cena)}</td>`:''}
      ${smemPredmer(g.id)?`<td class="r"><button class="btn ghost" style="padding:2px 8px;font-size:11px" onclick="formPredmerRed('${g.id}','${x.id}')">✎</button>${smemBrisati(g.id)?' '+BRISI_DUGME('obrisiPredmerRed',x.id):''}</td>`:''}
    </tr>`; }).join():list.map((x,i)=>{
    const pct=x.kol?Math.round(Math.min(x.izv||0,x.kol)/x.kol*100):0;
    return `<tr>
      <td class="num" style="color:var(--faint)">${i+1}</td>
      <td class="strong"><span class="num sub" style="margin-right:6px">${rbPredmera(x)}</span>${x.sifra&&x.sifra!==rbPredmera(x)?`<span class="badge" style="margin-right:6px" title="Šifra artikla (samo u alatu)">${x.sifra}</span>`:''}${x.poz}</td>
      <td>${x.jm}</td>
      <td class="r num-cell">${x.kol}</td>
      ${cene?`<td class="r num-cell">${fmtEur(x.cena)}</td>`:''}${fin?`<td class="r num-cell">${fmtEur(x.kol*x.cena)}</td>`:''}
      <td class="r"><input class="izv-in num" value="${x.izv||0}" onchange="setIzv('${x.id}',this.value)"></td>
      <td class="r" style="min-width:90px"><div class="bar" style="height:6px"><span style="width:${pct}%;background:${pct>=100?'var(--green)':'var(--blue)'}"></span></div><div class="sub num" style="text-align:right">${pct}%</div></td>
      <td>${zaduzenIme(x.zaduzen)}</td>
      ${smemPredmer(g.id)?`<td class="r"><button class="btn ghost" style="padding:2px 8px;font-size:11px" onclick="formPredmerRed('${g.id}','${x.id}')">✎</button>${smemBrisati(g.id)?' '+BRISI_DUGME('obrisiPredmerRed',x.id):''}</td>`:''}
    </tr>`;
  }).join('');
  return `
  <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px">
    <button class="btn ghost" style="padding:6px 12px;font-size:12px" onclick="current='sites';render();openSite('${g.id}')">← Detalji gradilišta</button>
  </div>
  ${head(predNaslov(g)+' — '+g.naziv, pro?(fin?'Usluge sa cenama, zaduženima i realizacijom.':'Usluge sa zaduženima i realizacijom.'):'Ugovorene pozicije, izvedene količine i realizacija.')}
  ${fin?`<div class="grid kpis kpis3">
    <div class="card kpi"><div class="accent" style="background:var(--blue)"></div><div class="lab">Ugovoreno${pro?' (usluge)':' (predmer)'}</div><div class="val num">${fmtEur(ugUk)}</div><div class="sub">${list.length} pozicija</div></div>
    <div class="card kpi"><div class="accent" style="background:var(--green)"></div><div class="lab">Izvedena vrednost</div><div class="val num">${fmtEur(izUk)}</div><div class="sub">${ugUk?Math.round(izUk/ugUk*100):0}% ugovorenog</div></div>
    <div class="card kpi"><div class="accent" style="background:var(--amber)"></div><div class="lab">Preostalo</div><div class="val num">${fmtEur(ugUk-izUk)}</div><div class="sub">za izvođenje / fakturisanje</div></div>
  </div>`:''}
  <div class="tools">
    ${pro?`${smemPredmer(g.id)?`<button class="btn" onclick="formPredmerRed('${g.id}')">${icon('plus')} Dodaj sveske (faza + ček-lista)</button>`:''}
`:`
    ${smem?`<button class="btn${isDirector()?' ghost':''}" onclick="formIzvedeno('${g.id}')">⇧ Učitaj izvedeno (Excel)</button>`:''}
    ${isDirector()?`<button class="btn" onclick="formPredmerImport('${g.id}')">${icon('plus')} Uvezi iz Excela (nalepi)</button>
    <button class="btn ghost" onclick="formPredmerRed('${g.id}')">＋ Dodaj poziciju</button>
    <button class="btn ghost" onclick="izvozPredmer('${g.id}')">⇩ Izvoz izvedenih (CSV)</button>
    <button class="btn ghost" onclick="openKumulativ('${g.id}')">Kumulativni pregled</button>
    <button class="btn ghost" onclick="formIzSifarnika('${g.id}')">＋ Iz šifarnika</button>`:''}`}
  </div>
  <div class="card"><div style="overflow-x:auto"><table>
    <thead>${pro?`<tr><th>#</th><th>Sveska / dokument</th><th>Faza</th><th>Status</th><th>Zadužen</th>${fin?'<th class="r">Cena (RSD, bez PDV)</th>':''}${smemPredmer(g.id)?'<th></th>':''}</tr>`:`<tr><th>#</th><th>Pozicija</th><th>JM</th><th class="r">Ugovoreno</th>${cene?'<th class="r">Jed. cena (RSD, bez PDV)</th>':''}${fin?'<th class="r">Ukupno</th>':''}<th class="r">Izvedeno</th><th class="r">%</th><th>Zadužen</th>${smemPredmer(g.id)?'<th></th>':''}</tr>`}</thead>
    <tbody>${rows}</tbody></table>
    ${list.length?'':`<div class="empty">Još nema pozicija — ${isDirector()?'uvezi predmer iz Excela ili dodaj poziciju ručno.':'direktor još nije uvezao predmer.'}</div>`}
  </div>`;
}
function setIzv(pid,val){
  const x=(DATA.predmer||[]).find(r=>r.id===pid); if(!x) return;
  const g=grById[x.gr]; if(!g||!(isDirector()||g.rukovodilac===ROLE)) return;
  /* Klamp na ugovorenu kolicinu: prikaz je i ranije klampovao, ali CSV i kumulativ
     (osnov za fakturisanje) su izvozili sirovu vrednost. */
  x.izv=Math.min(+x.kol||0, Math.max(0, broj(val)));
  osveziNapredak(x.gr); saveState(); render();
}
