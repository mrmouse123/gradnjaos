/* ---------- UCITAVANJE IZVEDENOG IZ EXCELA (rukovodilac / direktor) ----------
   Rukovodilac ucitava stanje izvedenih kolicina (.xlsx / .csv / nalepljeno iz Excela);
   menja se SAMO izv (trigger na serveru ionako gazi sve ostalo za ne-direktora), napredak
   se izvodi iz predmera (pravilo 5). .xlsx se cita u browseru bez biblioteke: ZIP centralni
   direktorijum + DecompressionStream('deflate-raw') + regex nad sheet XML-om. */
function smemIzvedeno(grId){ return smemNa(grId); }
/* ---------- XLSX PISAC (bez biblioteke) ----------
   napraviXlsx([{ime, redovi:[[...]]}]) → Uint8Array: minimalan OOXML paket (Content_Types, rels, workbook, sheet-ovi),
   celije: broj → <v>, ostalo → inlineStr. ZIP bez kompresije (STORED) + CRC32, pa Excel/LibreOffice otvaraju bez pitanja.
   preuzmiXlsx(ime, listovi) pravi <a download> sa data:…;base64 (radi i u dom-stubu — test dekodira i cita nazad kroz citajXlsx). */
const CRC_TAB=(()=>{ const t=new Uint32Array(256); for(let n=0;n<256;n++){ let c=n; for(let k=0;k<8;k++) c=c&1?0xEDB88320^(c>>>1):c>>>1; t[n]=c>>>0; } return t; })();
function crc32(u){ let c=0xFFFFFFFF; for(let i=0;i<u.length;i++) c=CRC_TAB[(c^u[i])&0xFF]^(c>>>8); return (c^0xFFFFFFFF)>>>0; }
function xmlEsc(v){ return String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function xlsxKolona(n){ let s=''; n++; while(n>0){ const m=(n-1)%26; s=String.fromCharCode(65+m)+s; n=Math.floor((n-1)/26); } return s; }
/* Stilovi (2026-10-18, zahtev: izvoz identican investitorovom): celija je primitiv ILI {v, f, s} — f = formula bez '=' (uz v kao
   kesirana vrednost, pa je citajXlsx i Excel pre preracuna vide), s = {b, fill:'RRGGBB', h, va, wrap, fmt:'num'|'din'|'dincir'|'txt', bd:false}
   → internira se u cellXfs (font Century Gothic 11 za ceo dokument, tanka ivica podrazumevano za stilizovane celije).
   List: {ime, redovi, kolone:[sirine], spoji:['D5:F5'], zamrzni:brojRedova, stampa:true (landscape, fit to width, print area), visine:{red:pt}}. */
const XLSX_FMT={num:'#,##0.00', din:'#,##0.00\\ "din."', dincir:'#,##0.00\\ [$дин.-281A]', txt:'@'};
function xlsxImeLista(ime, i){ return String(ime||('List'+(i+1))).slice(0,31).replace(/[\\/*?:\[\]]/g,' '); }
function napraviXlsx(listovi){
  const enc=new TextEncoder();
  const fontovi=['<font><sz val="11"/><name val="Century Gothic"/><family val="2"/></font>','<font><b/><sz val="11"/><name val="Century Gothic"/><family val="2"/></font>'];
  const popune=['<fill><patternFill patternType="none"/></fill>','<fill><patternFill patternType="gray125"/></fill>'], popunaIdx={};
  const fmts=[], fmtIdx={}, xfs=['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'], xfIdx={};
  const stil=st=>{ if(!st) return 0; const k=JSON.stringify(st); if(xfIdx[k]!=null) return xfIdx[k];
    let fillId=0; if(st.fill){ if(popunaIdx[st.fill]==null){ popunaIdx[st.fill]=popune.length; popune.push('<fill><patternFill patternType="solid"><fgColor rgb="FF'+st.fill+'"/><bgColor indexed="64"/></patternFill></fill>'); } fillId=popunaIdx[st.fill]; }
    let numFmtId=0; if(st.fmt){ const code=XLSX_FMT[st.fmt]||st.fmt; if(fmtIdx[code]==null){ fmtIdx[code]=164+fmts.length; fmts.push(code); } numFmtId=fmtIdx[code]; }
    const al=(st.h||st.va||st.wrap)?'<alignment'+(st.h?' horizontal="'+st.h+'"':'')+(st.va?' vertical="'+st.va+'"':'')+(st.wrap?' wrapText="1"':'')+'/>':'';
    xfIdx[k]=xfs.length;
    xfs.push('<xf numFmtId="'+numFmtId+'" fontId="'+(st.b?1:0)+'" fillId="'+fillId+'" borderId="'+(st.bd===false?0:1)+'" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyNumberFormat="1"'+(al?' applyAlignment="1">'+al+'</xf>':'/>'));
    return xfIdx[k]; };
  const celija=(v,ref)=>{
    let si=0, f=null; if(v&&typeof v==='object'&&!Array.isArray(v)){ si=stil(v.s); f=v.f||null; v=v.v; }
    const sa=si?' s="'+si+'"':'', fx=f?'<f>'+xmlEsc(f)+'</f>':'';
    if((v==null||v==='')&&!f&&!si) return '';
    if(v==null||v==='') return '<c r="'+ref+'"'+sa+'>'+fx+'</c>';
    if(typeof v==='number'&&Number.isFinite(v)) return '<c r="'+ref+'"'+sa+'>'+fx+'<v>'+v+'</v></c>';
    if(f) return '<c r="'+ref+'"'+sa+' t="str">'+fx+'<v>'+xmlEsc(v)+'</v></c>';
    return '<c r="'+ref+'"'+sa+' t="inlineStr"><is><t xml:space="preserve">'+xmlEsc(v)+'</t></is></c>'; };
  const opseg=l=>{ const redovi=l.redovi||[]; const nKol=Math.max(1,...redovi.map(r=>r.length),(l.kolone||[]).length); return '$A$1:$'+xlsxKolona(nKol-1)+'$'+Math.max(1,redovi.length); };
  const sheetXml=l=>{ const redovi=l.redovi||[];
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    +(l.stampa?'<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>':'')
    +(l.zamrzni?'<sheetViews><sheetView workbookViewId="0"><pane ySplit="'+l.zamrzni+'" topLeftCell="A'+(l.zamrzni+1)+'" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft"/></sheetView></sheetViews>':'')
    +(l.kolone&&l.kolone.length?'<cols>'+l.kolone.map((w,i)=>w?'<col min="'+(i+1)+'" max="'+(i+1)+'" width="'+w+'" customWidth="1"/>':'').join('')+'</cols>':'')
    +'<sheetData>'+redovi.map((r,ri)=>{ const h=l.visine&&l.visine[ri+1]; return '<row r="'+(ri+1)+'"'+(h?' ht="'+h+'" customHeight="1"':'')+'>'+r.map((v,ci)=>celija(v, xlsxKolona(ci)+(ri+1))).join('')+'</row>'; }).join('')+'</sheetData>'
    +(l.spoji&&l.spoji.length?'<mergeCells count="'+l.spoji.length+'">'+l.spoji.map(m=>'<mergeCell ref="'+m+'"/>').join('')+'</mergeCells>':'')
    +(l.stampa?'<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/><pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/>':'')
    +'</worksheet>'; };
  const sheets=listovi.map(l=>sheetXml(l));   // PRE styles.xml: tek sada su svi stilovi internirani
  const stylesXml='<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    +(fmts.length?'<numFmts count="'+fmts.length+'">'+fmts.map((c,i)=>'<numFmt numFmtId="'+(164+i)+'" formatCode="'+xmlEsc(c)+'"/>').join('')+'</numFmts>':'')
    +'<fonts count="'+fontovi.length+'">'+fontovi.join('')+'</fonts><fills count="'+popune.length+'">'+popune.join('')+'</fills>'
    +'<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color auto="1"/></left><right style="thin"><color auto="1"/></right><top style="thin"><color auto="1"/></top><bottom style="thin"><color auto="1"/></bottom><diagonal/></border></borders>'
    +'<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="'+xfs.length+'">'+xfs.join('')+'</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
  const imena=listovi.map((l,i)=>xlsxImeLista(l.ime,i));
  imena.forEach((n,i)=>{ let k=2, m=n; while(imena.slice(0,i).includes(m)) m=n.slice(0,27)+' ('+(k++)+')'; imena[i]=m; });   // dupli naziv lista = Excel „repair"
  const definisana=listovi.map((l,i)=>l.stampa?'<definedName name="_xlnm.Print_Area" localSheetId="'+i+'">\''+xmlEsc(imena[i].replace(/'/g,"''"))+'\'!'+opseg(l)+'</definedName>':'').join('');
  const fajlovi=[
    ['[Content_Types].xml','<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
      +listovi.map((l,i)=>'<Override PartName="/xl/worksheets/sheet'+(i+1)+'.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('')+'</Types>'],
    ['_rels/.rels','<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
    ['xl/workbook.xml','<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'
      +listovi.map((l,i)=>'<sheet name="'+xmlEsc(imena[i])+'" sheetId="'+(i+1)+'" r:id="rId'+(i+1)+'"/>').join('')+'</sheets>'
      +(definisana?'<definedNames>'+definisana+'</definedNames>':'')+'<calcPr fullCalcOnLoad="1"/></workbook>'],
    ['xl/_rels/workbook.xml.rels','<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      +listovi.map((l,i)=>'<Relationship Id="rId'+(i+1)+'" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet'+(i+1)+'.xml"/>').join('')
      +'<Relationship Id="rId'+(listovi.length+1)+'" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'],
    ['xl/styles.xml', stylesXml],
    ...listovi.map((l,i)=>['xl/worksheets/sheet'+(i+1)+'.xml', sheets[i]]),
  ];
  const delovi=[], centralni=[]; let off=0;
  const u16=n=>[n&255,(n>>8)&255], u32=n=>[n&255,(n>>8)&255,(n>>16)&255,(n>>>24)&255];
  fajlovi.forEach(([ime,xml])=>{
    const nb=enc.encode(ime), db=enc.encode(xml), crc=crc32(db);
    const lok=new Uint8Array([0x50,0x4b,3,4, ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0), ...u32(crc), ...u32(db.length), ...u32(db.length), ...u16(nb.length), ...u16(0)]);
    delovi.push(lok, nb, db);
    centralni.push(new Uint8Array([0x50,0x4b,1,2, ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0), ...u32(crc), ...u32(db.length), ...u32(db.length), ...u16(nb.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(off)]), nb);
    off+=lok.length+nb.length+db.length;
  });
  const cdLen=centralni.reduce((a,b)=>a+b.length,0);
  const eocd=new Uint8Array([0x50,0x4b,5,6, ...u16(0), ...u16(0), ...u16(fajlovi.length), ...u16(fajlovi.length), ...u32(cdLen), ...u32(off), ...u16(0)]);
  const sve=[...delovi, ...centralni, eocd]; const out=new Uint8Array(sve.reduce((a,b)=>a+b.length,0)); let p=0; sve.forEach(b=>{ out.set(b,p); p+=b.length; });
  return out;
}
function bytesBase64(u){ let s=''; for(let i=0;i<u.length;i+=0x8000) s+=String.fromCharCode.apply(null, u.subarray(i,i+0x8000)); return btoa(s); }
function preuzmiXlsx(ime, listovi){
  const u=napraviXlsx(listovi);
  try{
    const a=document.createElement('a');
    a.href='data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,'+bytesBase64(u);
    a.download=/\.xlsx$/i.test(ime)?ime:ime+'.xlsx';
    document.body.appendChild&&document.body.appendChild(a); a.click&&a.click(); a.remove&&a.remove();
  }catch(err){ console.error('xlsx:', err); }
  return u;
}
/* Ćirilica → latinica pri UČITAVANJU (odluka klijenta 2026-10-14: rukovodioci uvek šalju ćirilične Excel fajlove).
   Primenjuje se na svaki tekst iz citajXlsx/citajCsv (pa su uvezene pozicije latinične) i u normPoz (uparivanje radi
   za bilo koju kombinaciju pisama). Srpska ćirilica; Љ/Њ/Џ → Lj/Nj/Dž, a LJ/NJ/DŽ kad je sledeće slovo veliko. */
const CIR_LAT={'а':'a','б':'b','в':'v','г':'g','д':'d','ђ':'đ','е':'e','ж':'ž','з':'z','и':'i','ј':'j','к':'k','л':'l','љ':'lj','м':'m','н':'n','њ':'nj','о':'o','п':'p','р':'r','с':'s','т':'t','ћ':'ć','у':'u','ф':'f','х':'h','ц':'c','ч':'č','џ':'dž','ш':'š'};
/* Latinica → ćirilica za IZVOZ (2026-10-16). Token ostaje latiničan ako ima cifru, q/w/x/y (strani modeli: IPC2314LE, N2XH-J)
   ili je poznata skraćenica (LED, IP, PoE…). Originalni ćirilični tekst iz uvoza (predmer.izvor.cir) ima prednost — ovo je rezerva. */
const LAT_CIR={a:'а',b:'б',c:'ц',č:'ч',ć:'ћ',d:'д',đ:'ђ',e:'е',f:'ф',g:'г',h:'х',i:'и',j:'ј',k:'к',l:'л',m:'м',n:'н',o:'о',p:'п',r:'р',s:'с',š:'ш',t:'т',u:'у',v:'в',z:'з',ž:'ж'};
const LAT_OSTAJE=new Set(['LED','IP','PoE','NVR','DVR','HDD','SSD','UTP','FTP','SFTP','FID','HFX','USB','HDMI','VGA','LAN','WAN','WiFi','CCTV','UPS','AC','DC','CE','ENEC','EN','IEC','ISO','SRPS','RAL','PVC','DIN','PE','PP','MDF','GSM','RFID','NFC']);
function lat2cir(s){
  s=String(s??''); if(!/[A-Za-zČĆĐŠŽčćđšž]/.test(s)) return s;
  return s.replace(/\S+/g, tok=>{
    if(/\d/.test(tok)||/[qwxyQWXY]/.test(tok)) return tok;
    const slova=tok.replace(/[^\p{L}]/gu,''); if(LAT_OSTAJE.has(slova)) return tok;
    let out='';
    for(let i=0;i<tok.length;i++){
      const two=tok.slice(i,i+2), lo2=two.toLowerCase(), d={lj:'љ',nj:'њ','dž':'џ'}[lo2];
      if(d){ const c0=two[0]; out+= c0===c0.toUpperCase()&&c0!==c0.toLowerCase() ? d.toUpperCase() : d; i++; continue; }
      const ch=tok[i], m=LAT_CIR[ch.toLowerCase()];
      if(m===undefined){ out+=ch; continue; }
      out+= ch===ch.toLowerCase() ? m : m.toUpperCase();
    }
    return out;
  });
}
function rimski(n){ const t=[[10,'X'],[9,'IX'],[5,'V'],[4,'IV'],[1,'I']]; let r=''; n=Math.max(1,Math.round(n)); for(const [v,z] of t) while(n>=v){ r+=z; n-=v; } return r; }
function escIzvor(iz){ if(!iz||typeof iz!=='object') return null; const o={}; for(const k of ['list','sekcija','nadpoz','cir']) o[k]=iz[k]?esc(String(iz[k])):null; return o; }
/* Izvoz situacije u investitorskom šablonu (2026-10-16, zahtev klijenta): list po vrsti radova (predmer.izvor.list),
   sekcije sa „UKUPNO <sekcija>", naslov nadpozicije iznad stavki, trojke kolona (kol · jed. cena · ukupno) za
   UGOVORENO · KUMULATIVNO · PRETHODNE · (okončana: svaka ranija situacija) · OVA, rekapitulacija po listu i list
   REKAPITULACIJA. pismo = 'lat' | 'cir'. Kumulativ je serverov (stavka.kumulativ), prethodne = kumulativ − ova.
   Ko: ko vidi gradilište I jedinične cene (uprava ili rukovodilac gradilišta Izvođenja) — dokument za investitora mora
   imati iznose, pa ih rukovodilac bez finansija ovde dobija iz cena koje već vidi (odluka 2026-10-16). */
const SIT_H={
  cir:{naslov:'ПРЕДМЕР И ПРЕДРАЧУН', ugov:'УГОВОРЕНО', kum:'КУМУЛАТИВНО ИЗВЕДЕНО', preth:'ИЗВЕДЕНО У ПРЕТХОДНИМ СИТУАЦИЈАМА',
       priv:n=>'ИЗВЕДЕНО У '+n+' ПРИВРЕМЕНОЈ СИТУАЦИЈИ', okon:'ИЗВЕДЕНО У ОКОНЧАНОЈ СИТУАЦИЈИ', jm:'јед. мере', kol:'кол.',
       cena:'јед. цена без ПДВ-а', uk:'укупна цена без ПДВ-а', ukupno:'УКУПНО', rekap:'РЕКАПИТУЛАЦИЈА', ukBez:'УКУПНО БЕЗ ПДВ-а',
       brPoz:'Бр. поз.', opis:'Врста и опис радова', privS:'ПРИВРЕМЕНА СИТУАЦИЈА', okonS:'ОКОНЧАНА СИТУАЦИЈА', br:'бр.',
       objekat:'Објекат', investitor:'Инвеститор', datum:'Датум', vanPred:'ВАН ПРЕДМЕРА', predmer:'ПРЕДМЕР', ugovoreno:'Уговорено',
       kumul:'Кумулативно изведено', poPriv:n=>'Изведено по '+n+' Привременој ситуацији', poOkon:'Изведено по окончаној ситуацији', razlika:'Преостало (уговорено − кумулативно)'},
  lat:{naslov:'PREDMER I PREDRAČUN', ugov:'UGOVORENO', kum:'KUMULATIVNO IZVEDENO', preth:'IZVEDENO U PRETHODNIM SITUACIJAMA',
       priv:n=>'IZVEDENO U '+n+' PRIVREMENOJ SITUACIJI', okon:'IZVEDENO U OKONČANOJ SITUACIJI', jm:'jed. mere', kol:'kol.',
       cena:'jed. cena bez PDV-a', uk:'ukupna cena bez PDV-a', ukupno:'UKUPNO', rekap:'REKAPITULACIJA', ukBez:'UKUPNO BEZ PDV-a',
       brPoz:'Br. poz.', opis:'Vrsta i opis radova', privS:'PRIVREMENA SITUACIJA', okonS:'OKONČANA SITUACIJA', br:'br.',
       objekat:'Objekat', investitor:'Investitor', datum:'Datum', vanPred:'VAN PREDMERA', predmer:'PREDMER', ugovoreno:'Ugovoreno',
       kumul:'Kumulativno izvedeno', poPriv:n=>'Izvedeno po '+n+' Privremenoj situaciji', poOkon:'Izvedeno po okončanoj situaciji', razlika:'Preostalo (ugovoreno − kumulativno)'},
};
function smemIzvozSituacije(s){ return !!s && vidimGr(s.gr) && imaNaplatu(grById[s.gr]) && (canFinance()||vidimCene(s.gr)); }   // pro situacije (skrivene) se ne izvoze
function izvozLinkovi(s){   // „⬇ lat · ćir" uz svaku situaciju (fioka, Naplata) — ista funkcija kao dugmad u detalju
  if(!smemIzvozSituacije(s)) return '';
  const st='padding:2px 7px;font-size:11px;min-height:0';
  return `<span style="white-space:nowrap" title="Preuzmi situaciju kao Excel (investitorski šablon)"><button class="btn ghost" style="${st}" onclick="event.stopPropagation();izvozSituacije('${s.id}','lat')">⬇ lat</button> <button class="btn ghost" style="${st}" onclick="event.stopPropagation();izvozSituacije('${s.id}','cir')">⬇ ćir</button></span>`;
}
function izvozSituacije(id, pismo){
  const s=(DATA.situacije||[]).find(x=>x.id===id); if(!s||!vidimGr(s.gr)||!imaNaplatu(grById[s.gr])) return null;
  if(!smemIzvozSituacije(s)){ alert('Izvoz situacije traži jedinične cene — dostupan je upravi i rukovodiocu gradilišta.'); return null; }
  const cir=pismo==='cir', H=SIT_H[cir?'cir':'lat'], g=grById[s.gr], okon=s.vrsta==='okoncana';
  const T=t=>{ const u=unesc(String(t??'')); return cir ? (/[\u0400-\u04FF]/.test(u)?u:lat2cir(u)) : cir2lat(u); };
  const okr=v=>Math.round(v*100)/100;
  const sve=sitZa(s.gr).slice().sort((a,b)=>String(a.izdato).localeCompare(String(b.izdato))||String(a.id).localeCompare(String(b.id)));
  const idx=sve.findIndex(x=>x.id===id), pre=idx>0?sve.slice(0,idx):[], privPre=pre.filter(x=>x.vrsta!=='okoncana');
  const mapa=sid=>{ const m={}; stavkeZa(sid).forEach(x=>{ if(x.predmer_id) m[x.predmer_id]=(m[x.predmer_id]||0)+(+x.kol||0); }); return m; };
  const ova=mapa(id), preMape=pre.map(x=>mapa(x.id)), stOva={}; stavkeZa(id).forEach(x=>{ if(x.predmer_id) stOva[x.predmer_id]=x; });
  const naslovOve=okon?H.okon:H.priv(rimski(privPre.length+1));
  const grupe=[H.ugov,H.kum,H.preth,...(okon?pre.map(x=>x.vrsta==='okoncana'?H.okon:H.priv(rimski(privPre.indexOf(x)+1))):[]),naslovOve];
  const nT=grupe.length, prazno=()=>new Array(nT).fill(0);
  const kolicine=p=>{ const k=+p.kol||0, o=ova[p.id]||0, prevQ=preMape.reduce((a,m)=>a+(m[p.id]||0),0), st=stOva[p.id];
    const kum=st&&st.kumulativ!=null?+st.kumulativ:prevQ+o, preth=st?Math.max(0,kum-(+st.kol||0)):prevQ;
    return [k,kum,preth,...(okon?preMape.map(m=>m[p.id]||0):[]),o]; };
  /* stilovi po uzoru na investitorov fajl: Century Gothic 11, tanke ivice, siva sekcija/naslov, zuta KUMULATIVNO, narandzasta ranije, zelena OVA */
  const SIVA='D9D9D9', ZUTA='FFFF00', ZELENA='92D050', NAR='FFC000', dinF=cir?'dincir':'din';
  const fillG=i=> i===0?SIVA : i===1?ZUTA : i===nT-1?ZELENA : NAR;
  const fillRed=i=> i===nT-1?ZELENA:null;
  const S={naslov:{b:1,h:'center',va:'center',fill:SIVA}, info:{b:1,bd:false}, info2:{bd:false},
    grupa:f=>({b:1,h:'center',va:'center',fill:f}), pod:{h:'center',va:'center',wrap:1},
    sekA:{b:1,h:'right',va:'top',fill:SIVA}, sekB:{b:1,va:'center',wrap:1,fill:SIVA}, sekX:{fill:SIVA},
    nadA:{h:'right',va:'top'}, nadB:{h:'justify',va:'top',wrap:1}, ok:{},
    sifra:{h:'right',va:'top'}, opis:{h:'justify',va:'top',wrap:1}, jm:{h:'center',va:'top'},
    kol:f=>({h:'center',fmt:'num',fill:f}), cena:f=>({h:'right',fmt:dinF,fill:f}), uk:f=>({h:'right',fmt:dinF,fill:f}),
    ukLab:{b:1,fill:SIVA}, ukNum:{b:1,h:'right',fmt:dinF,fill:SIVA}, rekLab:{b:1}, rekNum:{b:1,h:'right',fmt:dinF}, rekTot:{b:1,fill:SIVA}, rekTotNum:{b:1,h:'right',fmt:dinF,fill:SIVA}};
  const c=(v,st,f)=>({v, s:st, f});
  const KOL=i=>xlsxKolona(3+i*3), CEN=i=>xlsxKolona(4+i*3), UKC=i=>xlsxKolona(5+i*3), nKol=3+nT*3, zadnja=xlsxKolona(nKol-1);
  const kli=g&&g.klijent?cliById[g.klijent]:null;
  const info=()=>[[c(`${okon?H.okonS:H.privS} ${H.br} ${T(s.br)}`,S.info)],[c(`${H.objekat}: ${T(g?g.naziv:'')}${g&&g.adresa?', '+T(g.adresa):''}${g&&g.lok&&g.lok!=='—'?', '+T(g.lok):''} · ${H.investitor}: ${kli?T(kli.naziv):'—'} · ${H.datum}: ${fmtDate(s.izdato)}`,S.info2)],[]];
  const zaglavlje=()=>{ const r4=[], r5=['','',''], r6=[c(H.brPoz,S.pod),c(H.opis,S.pod),c(H.jm,S.pod)];
    for(let k=0;k<nKol;k++) r4.push(c(k===0?H.naslov:'',S.naslov));
    grupe.forEach((n,i)=>{ const f=fillG(i); r5.push(c(n,S.grupa(f)),c('',S.grupa(f)),c('',S.grupa(f))); r6.push(c(H.kol,S.pod),c(H.cena,S.pod),c(H.uk,S.pod)); });
    return [r4,r5,r6]; };
  const spojiZaglavlje=['A4:'+zadnja+'4', ...grupe.map((_,i)=>KOL(i)+'5:'+UKC(i)+'5')];
  const kolone=[6.6,58,8.4]; grupe.forEach(()=>kolone.push(10.7,18.7,18.3));
  /* formule po redu R: kumulativ = prethodne + ova (okoncana: zbir svih ranijih + ova), prethodne (okoncana) = zbir ranijih, cena = cena ugovorenog, ukupno = kol*cena */
  const fKol=(i,R)=>{ if(i===1) return okon ? grupe.slice(3).map((_,k)=>KOL(3+k)+R).join('+') : KOL(2)+R+'+'+KOL(nT-1)+R;
    if(i===2&&okon&&nT>4) return grupe.slice(3,-1).map((_,k)=>KOL(3+k)+R).join('+'); return null; };
  const redStavke=(p,R)=>{ const iz=p.izvor||{}, cena=p.cena!=null?+p.cena:null, q=kolicine(p), nad=!!iz.nadpoz;
    const r=[c(nad?'':T(rbPredmera(p)),S.sifra), c(T(cir&&iz.cir?iz.cir:p.poz),S.opis), c(T(p.jm||''),S.jm)];   // samo redni broj (odluka 2026-10-23)
    q.forEach((v,i)=>{ const f=fillRed(i); r.push(c(okr(v),S.kol(f),fKol(i,R)), c(cena,S.cena(f),i?CEN(0)+R:null), c(cena==null?null:okr(v*cena),S.uk(f),KOL(i)+R+'*'+CEN(i)+R)); });
    return {r,q,cena}; };
  const poListu=new Map(); predmerZa(s.gr).forEach(p=>{ const l=p.izvor&&p.izvor.list?T(p.izvor.list):''; if(!poListu.has(l)) poListu.set(l,[]); poListu.get(l).push(p); });
  const listovi=[], rekap=[];
  for(const [imeL, lista] of poListu){
    const rows=[...info(),...zaglavlje()], sekcije=[], bezSek=[]; let sek=null, sekSum=null, nad=null, prviRed=null; const sumL=prazno(), R=()=>rows.length+1;   // bezSek: redovi stavki koje nisu ni u jednoj sekciji
    const zatvoriSek=()=>{ if(sek==null) return; const r=['',c(H.ukupno+' '+sek.ime,S.ukLab),c('',S.sekX)]; const red=R();
      sekSum.forEach((v,i)=>r.push(c('',S.sekX),c('',S.sekX),c(okr(v),S.ukNum,'SUM('+UKC(i)+sek.start+':'+UKC(i)+(red-1)+')')));
      rows.push(r); sekcije.push({sifra:sek.sifra, ime:sek.ime, sume:sekSum, red}); sek=null; };
    lista.forEach(p=>{
      const iz=p.izvor||{}, sekT=iz.sekcija?T(iz.sekcija):null, nadT=iz.nadpoz?T(iz.nadpoz):null;
      if(sekT!==(sek?sek.puno:null)){ zatvoriSek(); if(sekT){ const m=sekT.match(/^(\S+)\s+(.*)$/); sek={puno:sekT, sifra:m?m[1]:'', ime:m?m[2]:sekT, sekSum:null}; sekSum=prazno();
          const r=[c(sek.sifra,S.sekA),c(sek.ime,S.sekB)]; for(let k=2;k<nKol;k++) r.push(c('',S.sekX)); rows.push(r); sek.start=R(); } nad=null; }
      if(nadT&&nadT!==nad){ const m=nadT.match(/^(\S+)\s+(.*)$/); const r=[c(m?m[1]:'',S.nadA),c(m?m[2]:nadT,S.nadB)]; for(let k=2;k<nKol;k++) r.push(c('',S.ok)); rows.push(r); nad=nadT; } else if(!nadT) nad=null;
      if(prviRed==null) prviRed=R();
      const red=R(); const {r,q,cena}=redStavke(p,red); rows.push(r); if(!sek) bezSek.push(red);
      if(cena!=null) q.forEach((v,i)=>{ if(sekSum) sekSum[i]+=v*cena; sumL[i]+=v*cena; });
    });
    zatvoriSek();
    let ukRed;
    if(sekcije.length){
      rows.push([], [c(H.rekap,S.rekLab)]); const r1=R();
      sekcije.forEach(x=>{ const r=[c(x.sifra,S.rekLab),c(x.ime,S.rekLab),c('',S.ok)]; x.sume.forEach((v,i)=>r.push(c('',S.ok),c('',S.ok),c(okr(v),S.rekNum,UKC(i)+x.red))); rows.push(r); });
      const rn=R()-1; ukRed=R(); const r=[c('',S.rekTot),c(H.ukupno,S.rekTot),c('',S.rekTot)]; sumL.forEach((v,i)=>r.push(c('',S.rekTot),c('',S.rekTot),c(okr(v),S.rekTotNum,'SUM('+UKC(i)+r1+':'+UKC(i)+rn+')'+bezSek.map(x=>'+'+UKC(i)+x).join('')))); rows.push(r);
    } else {
      ukRed=R(); const r=[c('',S.rekTot),c(H.ukupno,S.rekTot),c('',S.rekTot)]; const od=prviRed||ukRed, doR=ukRed-1;
      sumL.forEach((v,i)=>r.push(c('',S.rekTot),c('',S.rekTot),c(okr(v),S.rekTotNum,doR>=od?'SUM('+UKC(i)+od+':'+UKC(i)+doR+')':null))); rows.push(r);
    }
    rows.push([], ['',c(H.razlika,S.rekLab),'',c(okr(sumL[0]-sumL[1]),S.rekNum,UKC(0)+ukRed+'-'+UKC(1)+ukRed)]);
    const ime=imeL||T(H.predmer);
    listovi.push({ime, redovi:rows, kolone, spoji:spojiZaglavlje.slice(), zamrzni:6, stampa:true, visine:{4:20,5:20,6:33}});
    rekap.push({ime, sume:sumL, ukRed});
  }
  const van=stavkeZa(id).filter(x=>!x.predmer_id);
  if(van.length){ const rows=[...info(),[c(H.vanPred,S.naslov),c('',S.naslov),c('',S.naslov),c('',S.naslov)],[c(H.brPoz,S.pod),c(H.opis,S.pod),c(H.jm,S.pod),c(H.kol,S.pod)]];
    van.forEach(x=>rows.push([c('',S.sifra),c(T(x.poz),S.opis),c(T(x.jm||''),S.jm),c(okr(+x.kol||0),S.kol(ZELENA))]));   // van predmera: bez šifre artikla u izvozu
    listovi.push({ime:H.vanPred, redovi:rows, kolone:[6.6,58,8.4,10.7], spoji:['A4:D4'], stampa:true}); }
  const nazivi=[H.ugovoreno,H.kumul,...(okon?pre.map(x=>x.vrsta==='okoncana'?H.poOkon:H.poPriv(rimski(privPre.indexOf(x)+1))):[]),okon?H.poOkon:H.poPriv(rimski(privPre.length+1))];
  const rr=[...info(),[c(H.rekap,S.rekLab)],[c('',S.ok),c('',S.ok),...nazivi.map((n,i)=>c(n,S.grupa(i===0?SIVA:i===1?ZUTA:i===nazivi.length-1?ZELENA:NAR)))]];
  const imenaListova=listovi.map((l,i)=>xlsxImeLista(l.ime,i)), refList=(k,kol,red)=>"'"+imenaListova[k].replace(/'/g,"''")+"'!"+kol+red;
  const r1=rr.length+1;
  rekap.forEach((x,k)=>{ const vals=[x.sume[0],x.sume[1],...x.sume.slice(3)], kols=[UKC(0),UKC(1),...x.sume.slice(3).map((_,m)=>UKC(3+m))];
    rr.push([c(rimski(k+1),S.rekLab),c(x.ime,S.rekLab),...vals.map((v,m)=>c(okr(v),S.rekNum,refList(k,kols[m],x.ukRed)))]); });
  const rn=rr.length, tot=prazno(); rekap.forEach(x=>x.sume.forEach((v,i)=>tot[i]+=v));
  const totV=[tot[0],tot[1],...tot.slice(3)];
  rr.push([c('',S.rekTot),c(H.ukBez,S.rekTot),...totV.map((v,m)=>c(okr(v),S.rekTotNum,rn>=r1?'SUM('+xlsxKolona(2+m)+r1+':'+xlsxKolona(2+m)+rn+')':null))]);
  listovi.push({ime:H.rekap, redovi:rr, kolone:[5,40,...totV.map(()=>24)], stampa:true});
  const ime='situacija-'+unesc(String(s.br)).replace(/[^\p{L}\p{N}]+/gu,'-')+'-'+(g?unesc(g.naziv).replace(/[^\p{L}\p{N}]+/gu,'-').slice(0,40):s.gr)+'-'+(cir?'cir':'lat');
  return preuzmiXlsx(ime, listovi);
}
function cir2lat(s){
  s=String(s??''); if(!/[\u0400-\u04FF]/.test(s)) return s;
  let out='';
  for(let i=0;i<s.length;i++){
    const ch=s[i], lo=ch.toLowerCase(), m=CIR_LAT[lo];
    if(m===undefined){ out+=ch; continue; }
    if(ch===lo){ out+=m; continue; }
    const nx=s[i+1]||'', nxUp=nx!==''&&nx===nx.toUpperCase()&&nx!==nx.toLowerCase();
    out+= m.length>1 && (nxUp || (s[i-1]||'')!==(s[i-1]||'').toLowerCase()) ? m.toUpperCase() : m[0].toUpperCase()+m.slice(1);
  }
  return out;
}
function xmlDek(s){ return String(s||'').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&#(\d+);/g,(m,n)=>String.fromCharCode(+n)).replace(/&amp;/g,'&'); }
async function zipInflate(bytes, metod){
  if(metod===0) return bytes;
  if(metod!==8) throw new Error('Nepodržana ZIP kompresija ('+metod+')');
  if(typeof DecompressionStream==='undefined') throw new Error('Ovaj pretraživač ne može da otvori .xlsx — sačuvaj kao CSV ili nalepi iz Excela.');
  const st=new ReadableStream({start(c){ c.enqueue(bytes); c.close(); }}).pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(st).arrayBuffer());
}
async function zipCitaj(buf){
  const u=new Uint8Array(buf), dv=new DataView(u.buffer,u.byteOffset,u.byteLength), td=new TextDecoder('utf-8');
  let e=u.length-22; while(e>=0 && dv.getUint32(e,true)!==0x06054b50) e--;
  if(e<0) throw new Error('Fajl nije .xlsx (nema ZIP zaglavlja).');
  const n=dv.getUint16(e+10,true); let p=dv.getUint32(e+16,true); const ulazi={};
  for(let i=0;i<n;i++){
    if(dv.getUint32(p,true)!==0x02014b50) break;
    const metod=dv.getUint16(p+10,true), csz=dv.getUint32(p+20,true), nl=dv.getUint16(p+28,true), xl=dv.getUint16(p+30,true), cl=dv.getUint16(p+32,true), off=dv.getUint32(p+42,true);
    const ime=td.decode(u.subarray(p+46,p+46+nl));
    ulazi[ime]={metod,csz,off}; p+=46+nl+xl+cl;
  }
  return { ime:Object.keys(ulazi), async citaj(ime){ const z=ulazi[ime]; if(!z) return null;
    const lnl=dv.getUint16(z.off+26,true), lxl=dv.getUint16(z.off+28,true), s=z.off+30+lnl+lxl;   // velicine iz CENTRALNOG dir-a (lokalne su 0 uz data descriptor)
    return td.decode(await zipInflate(u.subarray(s,s+z.csz), z.metod)); } };
}
async function citajXlsx(buf, sveListove){   // sveListove: redovi svih listova redom (situacija ima list po vrsti radova)
  /* Svaki red (niz celija, tekst vec kroz cir2lat) nosi i red.list = ime lista i red.izvorno = celije PRE cir2lat
     (migracija 29: izvor predmera cuva originalni ćirilični tekst i sekcije za izvoz situacije). */
  const z=await zipCitaj(buf);
  const ss=[], ssRaw=[]; const ssx=await z.citaj('xl/sharedStrings.xml');
  if(ssx) for(const m of ssx.matchAll(/<si>([\s\S]*?)<\/si>/g)){ const t=[...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(t=>xmlDek(t[1])).join(''); ssRaw.push(t); ss.push(cir2lat(t)); }
  let list=z.ime.filter(x=>/^xl\/worksheets\/sheet\d+\.xml$/.test(x)).sort((a,b)=>(+a.match(/\d+/)[0])-(+b.match(/\d+/)[0])).map(f=>({fajl:f, ime:''}));
  try{   // imena i REDOSLED listova iz workbook.xml (rId → fajl kroz rels); broj u imenu fajla nije garantovan redosled
    const wb=await z.citaj('xl/workbook.xml'), rels=await z.citaj('xl/_rels/workbook.xml.rels');
    if(wb&&rels){
      const cilj={}; for(const m of rels.matchAll(/<Relationship\b[^>]*>/g)){ const id=m[0].match(/\bId="([^"]+)"/), t=m[0].match(/\bTarget="([^"]+)"/); if(id&&t){ let p=t[1].replace(/^\//,''); if(!p.startsWith('xl/')) p='xl/'+p; cilj[id[1]]=p; } }
      const l2=[]; for(const m of wb.matchAll(/<sheet\b[^>]*>/g)){ const nm=m[0].match(/\bname="([^"]*)"/), rid=m[0].match(/\br:id="([^"]+)"/); const f=rid&&cilj[rid[1]]; if(f&&z.ime.includes(f)) l2.push({fajl:f, ime:xmlDek(nm?nm[1]:'')}); }
      if(l2.length) list=l2;
    }
  }catch(e){ /* bez imena listova — redovi i dalje idu po broju fajla */ }
  if(!list.length) throw new Error('U fajlu nema radnog lista.');
  const redovi=[];
  for(const L of (sveListove?list:[list[0]])){
  const x=await z.citaj(L.fajl);
  for(const r of x.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)){
    const red=[], raw=[];
    for(const c of r[1].matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)){
      let kol=0; for(const ch of c[1]) kol=kol*26+(ch.charCodeAt(0)-64); kol--;
      const atr=c[2]||'', tel=c[3]||''; let v='', o='';
      const vm=tel.match(/<v>([\s\S]*?)<\/v>/), im=tel.match(/<is>[\s\S]*?<\/is>/);
      if(/t="s"/.test(atr)&&vm){ v=ss[+vm[1]]??''; o=ssRaw[+vm[1]]??''; }
      else if(/t="inlineStr"/.test(atr)&&im){ o=[...im[0].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(t=>xmlDek(t[1])).join(''); v=cir2lat(o); }
      else if(/t="b"/.test(atr)&&vm){ v=vm[1]==='1'?'DA':'NE'; o=v; }
      else if(vm){ if(/t="str"/.test(atr)){ o=xmlDek(vm[1]); v=cir2lat(o); } else { v=Number(vm[1]); o=v; } }
      red[kol]=v; raw[kol]=o;
    }
    for(let i=0;i<red.length;i++){ if(red[i]===undefined) red[i]=''; if(raw[i]===undefined) raw[i]=''; }
    if(red.some(c=>c!=='')){ red.list=L.ime; red.izvorno=raw; redovi.push(red); }
    if(redovi.length>5000) break;
  }
  }
  return redovi;
}
function citajCsv(txt){
  const sep=(txt.match(/;/g)||[]).length>=(txt.match(/\t/g)||[]).length?';':'\t';
  return txt.replace(/^﻿/,'').split(/\r?\n/).map(l=>l.split(sep).map(c=>cir2lat(c.trim().replace(/^"(.*)"$/,'$1')))).filter(r=>r.some(c=>c!==''));
}
/* Uparivanje: zaglavlje (ako ga ima) bira kolone "izved…" i "poz/opis/usluga"; "#" je rezerva.
   Bez zaglavlja: kolona 0 = pozicija, poslednja popunjena = izvedeno. Ime se poredi
   normalizovano (unesc, mala slova, sažeti razmaci). Rezultat: {spojeni:[{x,novo}], nepovezani:[...]} */
const normPoz=s=>cir2lat(unesc(String(s??''))).toLowerCase().replace(/\s+/g,' ').trim();   // oba pisma se uparuju (cir2lat)
function upariIzvedeno(grId, redovi){
  const lista=predmerZa(grId), spojeni=[], nepovezani=[];
  if(!redovi.length) return {spojeni,nepovezani};
  const h=redovi[0].map(c=>String(c).toLowerCase());
  let ci=h.findIndex(c=>/izved/.test(c)), cp=h.findIndex(c=>/poz|opis|uslug|naziv/.test(c)), cn=h.findIndex(c=>c.trim()==='#'||/^r\.?br/.test(c));
  const imaZag=ci>=0||cp>=0;
  if(!imaZag){ cp=0; ci=-1; cn=-1; }
  const poIme=new Map(lista.map((x,i)=>[normPoz(x.poz),x]));
  redovi.slice(imaZag?1:0).forEach((r,i)=>{
    const ime=normPoz(r[cp]); let x=poIme.get(ime);
    if(!x && !ime && cn>=0 && r[cn]!=='' && Number.isFinite(+r[cn])) x=lista[+r[cn]-1];   // redni broj samo kad nema imena (ime koje ne postoji ≠ drugi red)
    const sirovo = ci>=0 ? r[ci] : [...r].reverse().find(c=>c!==''&&Number.isFinite(typeof c==='number'?c:broj(c)));
    if(!x){ nepovezani.push(String(r[cp]??'')||('red '+(i+1))); return; }
    const vr=typeof sirovo==='number'?sirovo:broj(sirovo);
    spojeni.push({x, novo:Math.min(+x.kol||0, Math.max(0, Number.isFinite(vr)?vr:0))});
  });
  return {spojeni,nepovezani};
}
let IZV_PRIPREMA=null;
function formIzvedeno(grId){
  if(!smemIzvedeno(grId)) return;
  const g=grById[grId]; IZV_PRIPREMA=null;
  openModal(`
    <div class="m-h"><h3>Učitaj izvedeno — ${g.naziv}</h3><button class="x" style="position:static" onclick="closeModal()">${icon('x')}</button></div>
    <div class="m-b">
      <div style="font-size:12.5px;color:var(--muted);margin-bottom:10px">Preuzmi šablon sa tekućim pozicijama, popuni kolonu <b>Izvedeno</b> i učitaj fajl (.xlsx ili .csv) — ili nalepi dve kolone <b>Pozicija | Izvedeno</b> iz Excela. Menja se samo izvedena količina; napredak projekta se računa iz nje.</div>
      <div class="tools" style="margin-bottom:10px">
        <button class="btn ghost" onclick="izvozIzvedenoSablon('${grId}')">⇩ Šablon (CSV)</button>
        <label class="btn" style="cursor:pointer">Izaberi fajl… <input id="iz_fajl" type="file" accept=".xlsx,.csv,.txt" style="display:none" onchange="izvedenoIzFajla('${grId}',this)"></label>
      </div>
      <div class="f-row"><textarea id="iz_tekst" style="min-height:90px;font-family:'JetBrains Mono',monospace;font-size:12px" placeholder="Iskop temelja	150,5&#10;Temelji AB	64"></textarea></div>
      <div class="tools"><button class="btn ghost" onclick="izvedenoIzTeksta('${grId}')">Proveri nalepljeno</button></div>
      <div id="iz_pregled"></div>
      <div class="m-foot"><button class="btn ghost" onclick="closeModal()">Otkaži</button><button class="btn" id="iz_primeni" disabled onclick="primeniIzvedeno('${grId}')">Primeni</button></div>
    </div>`);
}
function izvozIzvedenoSablon(grId){
  if(!smemIzvedeno(grId)) return;
  const g=grById[grId], lista=predmerZa(grId);
  const csv='﻿#;Pozicija;JM;Ugovoreno;Izvedeno\n'+lista.map((x,i)=>[i+1, '"'+unesc(x.poz).replace(/"/g,'""')+'"', unesc(x.jm||''), String(x.kol).replace('.',','), String(x.izv||0).replace('.',',')].join(';')).join('\n');
  try{ const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'})); a.download='izvedeno-'+unesc(g.naziv).replace(/[^\p{L}\p{N}]+/gu,'-')+'.csv'; document.body.appendChild(a); a.click(); a.remove(); }catch(e){}
}
async function izvedenoIzFajla(grId, inp){
  if(!smemIzvedeno(grId)) return;
  const f=inp&&inp.files&&inp.files[0]; if(!f) return;
  try{
    const redovi = /\.xlsx$/i.test(f.name) ? await citajXlsx(await f.arrayBuffer()) : citajCsv(await f.text());
    prikaziIzvedeno(grId, upariIzvedeno(grId, redovi));
  }catch(e){ const p=document.getElementById('iz_pregled'); if(p) p.innerHTML='<div class="banner">'+esc(e.message||String(e))+'</div>'; }
}
function izvedenoIzTeksta(grId){
  if(!smemIzvedeno(grId)) return;
  const t=document.getElementById('iz_tekst'); const redovi=citajCsv(t?String(t.value):'');
  prikaziIzvedeno(grId, upariIzvedeno(grId, redovi));
}
function prikaziIzvedeno(grId, rez){
  IZV_PRIPREMA={grId, spojeni:rez.spojeni};
  const p=document.getElementById('iz_pregled'); if(!p) return;
  const promene=rez.spojeni.filter(s=>s.novo!==(+s.x.izv||0));
  p.innerHTML=(rez.spojeni.length?`<div style="overflow-x:auto;margin-top:6px"><table><thead><tr><th>Pozicija</th><th class="r">Ugovoreno</th><th class="r">Bilo</th><th class="r">Novo</th></tr></thead><tbody>
    ${rez.spojeni.map(s=>`<tr${s.novo!==(+s.x.izv||0)?' style="font-weight:600"':''}><td>${s.x.poz}</td><td class="r num">${s.x.kol} ${s.x.jm}</td><td class="r num">${s.x.izv||0}</td><td class="r num">${s.novo}</td></tr>`).join('')}
    </tbody></table></div>`:'<div class="empty">Nijedna pozicija nije prepoznata.</div>')
    +(rez.nepovezani.length?`<div class="banner" style="margin-top:8px">Nisu pronađene u predmeru (preskaču se): ${rez.nepovezani.map(esc).join(', ')}</div>`:'')
    +`<div class="sub" style="margin-top:8px">${rez.spojeni.length} pozicija prepoznato · ${promene.length} sa promenom</div>`;
  const b=document.getElementById('iz_primeni'); if(b){ b.disabled=!promene.length; b.textContent='Primeni ('+promene.length+')'; }
}
function primeniIzvedeno(grId){
  if(!smemIzvedeno(grId)||!IZV_PRIPREMA||IZV_PRIPREMA.grId!==grId) return;
  let n=0; IZV_PRIPREMA.spojeni.forEach(s=>{ const x=(DATA.predmer||[]).find(r=>r.id===s.x.id); if(x && x.gr===grId && (+x.izv||0)!==s.novo){ x.izv=s.novo; n++; } });
  IZV_PRIPREMA=null; if(!n){ closeModal(); return; }
  osveziNapredak(grId); saveState(); closeModal(); render();
}
/* formPredmerRed(grId) = nova pozicija; formPredmerRed(grId,pid) = izmena postojece (samo direktor). */
function smemPredmer(grId){ const g=grById[grId]; return !!g && smemNa(grId) && (isDirector() || jePro(g)); }   // rukovodilac dodaje/menja sveske (projektovanje), ne cenu
/* Projektovanje (odluka klijenta 2026-10-14): sveska NEMA JM ni kolicinu — bira se iz tipova dokumenta: faza (IDR / IDP-PGD
   / PZI, NIVOI_DOK = sifrarnik sf-p-*) + cek-lista dokumenata te faze koji jos nisu u specifikaciji. Red predmera i dalje
   nosi jm 'kom' / kol 1 (napredak, done → izv=kol). SV_KAND: k → sifrarnik.id (JS mapa, lekcija 32). */
let SV_KAND={};
function fazaSveske(poz){   // „IDP/PGD — 1.0 Arhitektura" → IDP/PGD; stariji nazivi po skracenici u tekstu („PGD — sveska…", „Idejno rešenje (IDR)") ; inace Razno
  const t=unesc(String(poz||'')); const i=t.indexOf(' — '); const f=i>0?t.slice(0,i):'';
  if(NIVOI_DOK[f]) return f;
  const k=Object.keys(NIVOI_DOK).find(n=>n.split('/').some(p=>new RegExp('(^|[^A-Za-z])'+p+'([^A-Za-z]|$)').test(t)));
  return k||'Razno';
}
function sveskeKandidati(grId, faza){
  const ima=new Set(predmerZa(grId).map(r=>unesc(r.poz).trim().toLowerCase()));
  return sifrarnikZa('projektovanje').filter(s=>s.grupa===faza && !ima.has((faza+' — '+unesc(s.naziv)).toLowerCase()) && !ima.has(unesc(s.naziv).toLowerCase()));
}
function osveziSveskeCeklistu(grId){
  const sel=document.getElementById('f_sv_faza'), box=document.getElementById('f_sv_lista'); if(!box) return;
  const faza=(sel&&sel.value)||(grById[grId]||{}).nivo||Object.keys(NIVOI_DOK)[0];
  const kand=sveskeKandidati(grId, faza); SV_KAND={};
  box.innerHTML=kand.length?`<div class="chk-list" style="max-height:260px;overflow-y:auto">${kand.map((s,k)=>{ SV_KAND[k]=s.id; return `<label class="chk"><input type="checkbox" id="f_sv_${k}" checked> ${s.naziv}</label>`; }).join('')}</div>`:'<div class="sub">Svi dokumenti ove faze su već u specifikaciji.</div>';
}
function formPredmerRed(grId,pid){
  if(!smemPredmer(grId)) return;
  const g=grById[grId]; if(!g) return;
  const pro=jePro(g);
  const x=pid?(DATA.predmer||[]).find(r=>r.id===pid&&r.gr===grId):null;
  if(pid&&!x) return;
  if(pro){
    const opc=zaduzenOpcije(x?x.zaduzen:null), faze=Object.keys(NIVOI_DOK);
    openModal(x?`
    <div class="m-h"><h3>Sveska</h3><button class="x" style="position:static" onclick="closeModal()">${icon('x')}</button></div>
    <div class="m-b">
      <div class="f-row"><label>Dokument (faza ${fazaSveske(x.poz)})</label><div style="padding:8px 0;font-weight:600">${x.poz}</div></div>
      ${canFinance()?`<div class="f-row"><label>Cena usluge bez PDV (RSD)</label><input id="f_pm_cena" type="number" value="${x.cena||0}"></div>`:''}
      <div class="f-row"><label>Zadužen</label><select id="f_pm_zad"><option value="">—</option>${opc}</select></div>
      <div class="m-foot"><button class="btn ghost" onclick="closeModal()">Otkaži</button><button class="btn" onclick="savePredmerRed('${grId}','${x.id}')">Sačuvaj izmene</button></div>
    </div>`:`
    <div class="m-h"><h3>Nove sveske — ${g.naziv}</h3><button class="x" style="position:static" onclick="closeModal()">${icon('x')}</button></div>
    <div class="m-b">
      <div class="f-row"><label>Faza dokumentacije</label><select id="f_sv_faza" onchange="osveziSveskeCeklistu('${grId}')">${faze.map(f=>`<option value="${f}"${(g.nivo||faze[0])===f?' selected':''}>${f}</option>`).join('')}</select></div>
      <div class="f-row"><label>Dokumenti (čekirano ulazi u specifikaciju; svaka sveska postaje zadatak zaduženog)</label><div id="f_sv_lista"></div></div>
      <div class="f-row"><label>Zadužen (za sve čekirane)</label><select id="f_pm_zad"><option value="">— rukovodilac —</option>${opc}</select></div>
      <div class="m-foot"><button class="btn ghost" onclick="closeModal()">Otkaži</button><button class="btn" onclick="savePredmerRed('${grId}')">Dodaj sveske</button></div>
    </div>`);
    if(!x) osveziSveskeCeklistu(grId);
    return;
  }
  const zs=x?x.zaduzen:null, sel=id=>id===zs?' selected':'';
  const opcije = pro ? zaduzenOpcije(zs)   // Projektovanje: tim nema UI — ko dobije svesku ulazi u tim (osigurajUTimu)
    : [...timNa(grId).map(z=>`<option value="${z.id}"${sel(z.id)}>${z.ime}</option>`), ...subsZa(grId).map(s=>`<option value="${s.id}"${sel(s.id)}>${s.naziv} (spoljni)</option>`)].join('');
  const jms=['m³','m²','m','kom','kg','t','h','paušal']; if(x&&x.jm&&!jms.includes(x.jm)) jms.push(x.jm);
  const jmOpc=jms.map(j=>`<option${x&&x.jm===j?' selected':''}>${j}</option>`).join('');
  openModal(`
    <div class="m-h"><h3>${x?'Izmena pozicije':'Nova pozicija'}</h3><button class="x" style="position:static" onclick="closeModal()">${icon('x')}</button></div>
    <div class="m-b">
      <div class="f-row"><label>${pro?'Sveska / usluga (postaje zadatak zaduženog)':'Opis pozicije'}</label><input id="f_pm_poz"${x?` value="${x.poz}"`:''}></div>
      <div class="f-2">
        <div class="f-row"><label>JM</label><select id="f_pm_jm">${jmOpc}</select></div>
        <div class="f-row"><label>Količina</label><input id="f_pm_kol" type="number" value="${x?x.kol:1}"></div>
      </div>
      ${canFinance()?`<div class="f-row"><label>Jedinična cena bez PDV (RSD)</label><input id="f_pm_cena" type="number"${x?` value="${x.cena}"`:''}></div>`:''}
      <div class="f-row"><label>Zadužen</label><select id="f_pm_zad"><option value="">—</option>${opcije}</select></div>
      <div class="m-foot"><button class="btn ghost" onclick="closeModal()">Otkaži</button><button class="btn" onclick="savePredmerRed('${grId}'${x?`,'${x.id}'`:''})">${x?'Sačuvaj izmene':'Sačuvaj'}</button></div>
    </div>`);
}
function savePredmerRed(grId,pid){
  if(!smemPredmer(grId)) return;
  const v=id=>{const e=document.getElementById(id); return e?e.value:'';};
  const g=grById[grId];
  if(g&&jePro(g)){   // Projektovanje: sveske iz cek-liste (nove) ili zaduzen/cena (izmena); bez JM i kolicine
    if(pid){
      const x=(DATA.predmer||[]).find(r=>r.id===pid&&r.gr===grId); if(!x) return;
      const ct=String(v('f_pm_cena')).trim(); if(canFinance()&&ct!==''&&Number.isFinite(+ct)) x.cena=+ct;
      x.zaduzen=v('f_pm_zad')||null;
      osveziNapredak(grId); sinhronizujSveske(grId); saveState(); closeModal(); render(); osveziFioku(grId); return;
    }
    const faza=v('f_sv_faza')||g.nivo||Object.keys(NIVOI_DOK)[0], zad=v('f_pm_zad')||null, ima=new Set(predmerZa(grId).map(r=>unesc(r.poz).trim().toLowerCase()));
    const ts=Date.now(); let n=0;
    Object.keys(SV_KAND).forEach(k=>{ const c=document.getElementById('f_sv_'+k); if(!c||!c.checked) return;
      const sf=(DATA.sifrarnik||[]).find(y=>y.id===SV_KAND[k]); if(!sf||sf.grupa!==faza) return;
      const poz=sifrarnikPoz(sf,'projektovanje'); if(ima.has(unesc(poz).toLowerCase())) return; ima.add(unesc(poz).toLowerCase());
      DATA.predmer.push({ id:'pm'+ts+'-'+(n++), gr:grId, poz, jm:'kom', kol:1, cena:0, izv:0, zaduzen:zad, rb:sledeciRb(grId) }); });
    if(!n){ alert('Čekiraj bar jedan dokument.'); return; }
    SV_KAND={};
    osveziNapredak(grId); sinhronizujSveske(grId); saveState(); closeModal(); render(); osveziFioku(grId); return;
  }
  const poz=esc(String(v('f_pm_poz')).trim()); if(!poz){ alert('Unesi opis pozicije.'); return; }
  if(pid){
    const x=(DATA.predmer||[]).find(r=>r.id===pid&&r.gr===grId); if(!x) return;
    x.poz=poz; x.jm=esc(v('f_pm_jm')||x.jm||'kom');
    const kt=String(v('f_pm_kol')).trim(); if(kt!==''&&Number.isFinite(+kt)) x.kol=+kt;
    x.izv=Math.min(x.izv||0, x.kol);                      // izvedeno ne sme preko nove ugovorene kolicine
    const ct=String(v('f_pm_cena')).trim(); if(canFinance()&&ct!==''&&Number.isFinite(+ct)) x.cena=+ct;
    x.zaduzen=v('f_pm_zad')||null;
    osveziNapredak(grId); sinhronizujSveske(grId); saveState(); closeModal(); render(); return;
  }
  DATA.predmer.push({ id:'pm'+Date.now(), gr:grId, poz, jm:v('f_pm_jm')||'kom', kol:(v('f_pm_kol').trim()!==''&&Number.isFinite(+v('f_pm_kol'))?+v('f_pm_kol'):1), cena:+String(v('f_pm_cena')).replace(',','.')||0, izv:0, zaduzen:v('f_pm_zad')||null , rb:sledeciRb(grId) });
  osveziNapredak(grId); sinhronizujSveske(grId); saveState(); closeModal(); render();
}
function formPredmerImport(grId){
  if(!isDirector()||!smemNa(grId)) return;
  PREDMER_PRIPREMA=null;
  openModal(`
    <div class="m-h"><h3>Uvoz predmera iz Excela</h3><button class="x" style="position:static" onclick="closeModal()">${icon('x')}</button></div>
    <div class="m-b">
      <div class="f-row"><label>Investitorski šablon (.xlsx, list po vrsti radova)</label>
        <div class="tools" style="margin:0"><label class="btn" style="cursor:pointer">⇧ Učitaj predmer (.xlsx) <input id="pm_fajl2" type="file" accept=".xlsx" style="display:none" onchange="predmerIzFajla(this,'pm_pregled2')"></label><span class="sub">pozicije kojih već ima (ista šifra i naziv) se preskaču</span></div>
        <div id="pm_pregled2"></div>
      </div>
      <div class="sub" style="margin:4px 0 10px">— ili nalepi kolone —</div>
      <div style="font-size:12.5px;color:var(--muted);margin-bottom:10px">U Excelu selektuj kolone <b>Opis | JM | Količina | Jedinična cena</b> (bez zaglavlja), kopiraj (Ctrl+C) i nalepi ovde (Ctrl+V). Radi i sa ; kao razdvajačem.</div>
      <div class="f-row"><textarea id="f_pm_paste" style="min-height:160px;font-family:'JetBrains Mono',monospace;font-size:12px" placeholder="Iskop temelja	m³	180	22&#10;Temelji AB	m³	64	210"></textarea></div>
      <div class="m-foot"><button class="btn ghost" onclick="closeModal()">Otkaži</button><button class="btn" onclick="savePredmerImport('${grId}')">Uvezi pozicije</button></div>
    </div>`, {siroka:true, kljuc:'predmer'});
}
function savePredmerImport(grId){
  if(!isDirector()||!smemNa(grId)) return;
  const e=document.getElementById('f_pm_paste'); const txt=e?String(e.value):'';
  const lines=txt.split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
  let n=dodajPredmerIzPripreme(grId), ts=Date.now();   // prvo fajl (ako je ucitan), pa nalepljeno
  lines.forEach(l=>{
    const c=l.split(/\t|;/).map(x=>x.trim());
    if(c.length<2) return;
    const poz=esc(c[0]); if(!poz) return;
    const kol=broj(c[2])||1;
    const cena=broj(c[3]);
    DATA.predmer.push({ id:'pm'+ts+'-'+n, gr:grId, poz, jm:esc(c[1]||'kom'), kol, cena, izv:0, zaduzen:null, rb:sledeciRb(grId) });
    n++;
  });
  if(!n){ alert('Nijedna pozicija nije prepoznata — učitaj .xlsx šablon ili proveri da su nalepljene kolone razdvojene tabom ili tačka-zarezom.'); return; }
  skiniSaStanjaZaPredmer(grId, predmerZa(grId).slice(-n));   // samo novi redovi
  osveziNapredak(grId); saveState(); closeModal(); render();
}
