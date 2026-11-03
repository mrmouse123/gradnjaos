/* ============================================================
   START
   ============================================================ */
/* ============================================================
   AUTO-OSVEZAVANJE: GitHub Pages kesira index.html do 10 min, pa je telefon
   prikazivao staru verziju posle deploya. Jedan HEAD zahtev: ako je Last-Modified
   na serveru noviji od datuma ove kopije, ucitaj svezu (?v= zaobilazi kes).
   sessionStorage zastita: najvise jedno osvezavanje po sesiji (bez petlje).
   ============================================================ */
async function proveriNovuVerziju(){
  try{
    if(!/^https?:/.test(location.protocol)) return;
    if(sessionStorage.getItem("gos_reload")){ sessionStorage.removeItem("gos_reload"); return; }
    /* Timeout: na poluotvorenoj mobilnoj vezi HEAD bez roka drzi "Učitavam…" zauvek. */
    const ac=typeof AbortController!=='undefined'?new AbortController():null;
    const tm=ac?setTimeout(()=>ac.abort(),4000):null;
    const r=await fetch(location.pathname,{method:"HEAD",cache:"no-store",signal:ac?ac.signal:undefined});
    if(tm) clearTimeout(tm);
    const lm=r.headers.get("last-modified"); if(!lm) return;
    const srv=new Date(lm).getTime(), moj=new Date(document.lastModified).getTime();
    /* location.hash se cuva: magic link / reset lozinke stizu kao #access_token=… */
    if(isFinite(srv)&&isFinite(moj)&&srv>moj+1000){ sessionStorage.setItem("gos_reload","1"); location.replace(location.pathname+"?v="+Date.now()+location.hash); }
  }catch(e){}
}
function verzijaTekst(){
  try{ const d=new Date(document.lastModified); if(!isFinite(d.getTime())) return ""; return d.getDate()+"."+(d.getMonth()+1)+"."+d.getFullYear()+". "+String(d.getHours()).padStart(2,"0")+":"+String(d.getMinutes()).padStart(2,"0"); }catch(e){ return ""; }
}

/* ============================================================
   AUTH (Supabase). U demo/memorija rezimu (bez SUPABASE_URL) se ne koristi.
   Uloga dolazi iz tabele profili, ne iz menija; RLS na serveru sprovodi isto
   pravilo kao smemNa() ovde.
   ============================================================ */
async function initAuth(){
  try{
    const {data}=await supa.auth.getSession();
    SESIJA=(data&&data.session)||null;
    if(!SESIJA){ prikaziLogin(); return false; }
    const {data:prof,error}=await supa.from('profili').select('*').eq('user_id',SESIJA.user.id).maybeSingle();
    if(error) throw error;
    if(!prof){
      prikaziLogin('Nalog '+esc(SESIJA.user.email||'')+' postoji, ali mu još nije dodeljena uloga. Javi direktoru — dodeljuje se u aplikaciji, tab „Nalozi".');
      try{ await supa.auth.signOut(); }catch(e){}
      return false;
    }
    PROFIL=prof;
    primeniUlogu(prof.uloga, prof.zaposleni_id||prof.saradnik_id||null, !!prof.vidi_finansije, prof.moduli);
    return true;
  }catch(e){
    console.error('Auth:', e);
    prikaziLogin('Greška pri proveri prijave: '+esc(e.message||e));
    return false;
  }
}
function prikaziLogin(poruka){
  document.body.classList.add('login');
  document.getElementById('view').innerHTML=`<div class="login-wrap"><div class="login-card">
    <h1>GradnjaOS</h1><p>Prijavi se nalogom koji ti je dodelio direktor.</p>
    ${poruka?`<div class="err">${poruka}</div>`:''}
    <div class="f-row"><label>Email</label><input id="l_email" type="email" autocomplete="username" placeholder="ime@firma.rs"></div>
    <div class="f-row"><label>Lozinka</label><input id="l_pw" type="password" autocomplete="current-password" onkeydown="if(event.key==='Enter')prijava()"></div>
    <div id="l_msg"></div>
    <button class="btn" style="width:100%" onclick="prijava()">Prijavi se</button>
    <button class="btn ghost" style="width:100%;margin-top:8px" onclick="prijavaLink()">Pošalji mi link za prijavu na email</button>
  </div></div>`;
}
function loginPoruka(html){ const m=document.getElementById('l_msg'); if(m) m.innerHTML=html; }
async function prijava(){
  const email=((document.getElementById('l_email')||{}).value||'').trim(), pw=(document.getElementById('l_pw')||{}).value||'';
  if(!email||!pw){ loginPoruka('<div class="err">Unesi email i lozinku.</div>'); return; }
  const {error}=await supa.auth.signInWithPassword({email, password:pw});
  if(error){ loginPoruka('<div class="err">'+esc(/invalid/i.test(error.message||'')?'Pogrešan email ili lozinka.':(error.message||error))+'</div>'); return; }
  try{ const s=await supa.auth.getSession(); SESIJA=(s&&s.data&&s.data.session)||null; await beleziLog('prijava',{uredjaj:uredjajTip()}); }catch(e){}
  location.reload();
}
async function prijavaLink(){
  const email=((document.getElementById('l_email')||{}).value||'').trim();
  if(!email){ loginPoruka('<div class="err">Unesi email, pa klikni na link.</div>'); return; }
  const {error}=await supa.auth.signInWithOtp({email, options:{shouldCreateUser:false}});
  loginPoruka(error ? '<div class="err">'+esc(error.message||error)+'</div>'
                    : '<div class="ok">Link je poslat na '+esc(email)+'. Otvori ga na ovom uređaju.</div>');
}
let odjavaUToku=false;
async function odjava(){
  /* flushSave() nije cekao upis: signOut + reload su ubijali zahtev u letu i poslednja izmena se gubila. */
  if(odjavaUToku) return; odjavaUToku=true;
  const f=document.getElementById('sideFoot'); if(f) f.innerHTML='<span class="dot"></span> Čuvam izmene pre odjave…';
  try{ await sacuvajSve(); }catch(e){}
  if(saveErr && !confirm('Poslednje čuvanje NIJE uspelo ('+unesc(saveErr).slice(0,120)+'). Odjaviti se svejedno? Nesačuvane izmene će biti izgubljene.')){ odjavaUToku=false; updateFoot(); return; }
  try{ await beleziLog('odjava'); }catch(e){}   // pre signOut — posle njega upis u log ne prolazi RLS
  try{ await supa.auth.signOut(); }catch(e){}
  location.reload();
}
async function promeniLozinku(){
  const p=prompt('Nova lozinka (najmanje 8 znakova):'); if(p===null) return;
  if(String(p).length<8){ alert('Lozinka mora imati najmanje 8 znakova.'); return; }
  const {error}=await supa.auth.updateUser({password:String(p)});
  alert(error ? 'Nije uspelo: '+(error.message||error) : 'Lozinka je promenjena.');
}
/* Kutija u sidebaru: demo rezim = meni uloga; prijavljen = nalog (+ meni "pogled kao" za direktora). */
function renderNalog(){
  const box=document.getElementById('roleBox'); if(!box) return;
  if(!PROFIL){ box.innerHTML='<label>Prijavljen kao</label><select id="roleSel" onchange="setRole(this.value)"></select>'; return; }
  const dir=jeUpravaUloga(PROFIL.uloga);
  box.innerHTML='<label>Nalog</label><div class="acc"><b>'+esc(PROFIL.ime||'')+'</b><small>'+esc((SESIJA&&SESIJA.user&&SESIJA.user.email)||'')+' · '+ulogaLabela(PROFIL.uloga, PROFIL.vidi_finansije, PROFIL.moduli)+'</small></div>'
    +(dir?'<label style="margin-top:10px">Pogled kao</label><select id="roleSel" onchange="setRole(this.value)"></select>':'')
    +'<div class="acc-btns"><button onclick="promeniLozinku()">Lozinka</button><button onclick="odjava()">Odjavi se</button></div>';
}

/* Validacija id-jeva pri ucitavanju (2026-10-22, nalaz pregleda): id-jevi i strani kljucevi se interpoliraju u onclick="…('${id}')"
   na 100+ mesta, pa red sa id-jem koji sadrzi navodnik/zagradu (ubacen kroz REST mimo aplikacije) = stored XSS kod direktora.
   Pravilo: id i FK polja smeju samo [A-Za-z0-9_.:|-] (do 80 znakova); red koji to krsi se IZBACUJE iz DATA (i iz join nizova),
   broji se i prijavljuje u konzoli — nikad ne „popravlja" tiho (to bi napravilo novi id i duplirao red pri cuvanju). */
const ID_POLJA=['id','gr','zad','sit','predmer_id','autor','zaduzen','klijent','rukovodilac','zaposleni_id','gradiliste_id','podizvodjac_id','saradnik_id','user_id','autor_uid'];
const ID_POLJA_TABELE={rad_na_zadatku:['osoba','zadatak']};   // `osoba` je u clijenti/podizvodjaci IME kontakta (slobodan tekst), id je samo u sesiji tajmera
const idOk=v=>v==null||v===''||/^[A-Za-z0-9_.:|-]{1,80}$/.test(String(v));
function ocistiIdeve(d){
  let n=0;
  for(const t of Object.keys(d)){ const l=d[t]; if(!Array.isArray(l)) continue;
    const polja=ID_POLJA.concat(ID_POLJA_TABELE[t]||[]);
    d[t]=l.filter(r=>{ if(!r||typeof r!=='object') return false; const ok=polja.every(k=>idOk(r[k])); if(!ok){ n++; return false; }
      for(const k of ['grs','bivsi']) if(Array.isArray(r[k])){ const c=r[k].filter(idOk); if(c.length!==r[k].length){ n+=r[k].length-c.length; r[k]=c; } }   // losa VEZA se izbacuje, osoba ostaje
      return true; }); }
  if(n) console.warn('GradnjaOS: izbačeno '+n+' redova sa neispravnim id-jem (dozvoljeno: slova, cifre, _ . : | -).');
  return n;
}
/* REDNI BROJ POZICIJE (2026-10-23, migracija 32, predmer.rb): pozicija ima rb (investitorska numeracija iz uvezenog fajla ili 1..n
   po gradilištu) I sifra (šifra artikla iz šifarnika). Izvoz situacija (lat/ćir) i izvoz predmera prikazuju SAMO rb; šifra artikla
   ostaje u alatu (Predmer, situacija, trebovanje, magacin). Redovi bez rb (stari/demo) ga dobijaju pri učitavanju. */
function jeSifraArtikla(sf){ return !!sf && (DATA.sifrarnik||[]).some(x=>x.sifra&&x.sifra===sf); }
function rbPredmera(p){ if(p&&p.rb) return String(p.rb); const l=predmerZa(p.gr), i=l.indexOf(p); return i>=0?String(i+1):''; }
function sledeciRb(grId){ const l=predmerZa(grId); let max=0; l.forEach(p=>{ const n=Math.floor(Number(p.rb)); if(Number.isFinite(n)&&n>max) max=n; }); return String(Math.max(max, l.length)+1); }   // investitorsko „5.3“ → 5
function dopuniRb(){
  const poGr={}; (DATA.predmer||[]).forEach(p=>{ (poGr[p.gr]=poGr[p.gr]||[]).push(p); });
  Object.values(poGr).forEach(l=>{ let n=0; l.forEach(p=>{ if(p.rb==null||p.rb===''){ p.rb = (p.sifra&&!jeSifraArtikla(p.sifra)) ? String(p.sifra) : null; } });
    l.forEach(p=>{ if(p.rb==null){ n++; while(l.some(q=>q!==p&&q.rb===String(n))) n++; p.rb=String(n); } }); });
}
function normalizeData(){
  ocistiIdeve(DATA);
  dopuniRb();
  (DATA.zaposleni||[]).forEach(z=>{ if(!Array.isArray(z.grs)) z.grs = z.gr?[z.gr]:[]; delete z.gr; if(!Array.isArray(z.bivsi)) z.bivsi=[]; });
  (DATA.gradilista||[]).forEach(g=>{ if(!g.modul) g.modul='izvodjenje'; if(g.modul==='izvodjenje'&&!g.tip) g.tip='visokogradnja'; });
  if(!DATA.situacije) DATA.situacije=[];
  if(!DATA.narudzbe) DATA.narudzbe=[];
  if(!DATA.troskovi_st) DATA.troskovi_st=[];
  if(!DATA.podizvodjaci) DATA.podizvodjaci=[];
  (DATA.podizvodjaci||[]).forEach(x=>{ if(!Array.isArray(x.grs)) x.grs=[]; });
  if(!DATA.predmer) DATA.predmer=[];
  if(!DATA.resursi) DATA.resursi=[];
  if(!DATA.magacin) DATA.magacin=[];
  if(!DATA.mag_promene) DATA.mag_promene=[];
  if(!DATA.dokumenti) DATA.dokumenti=[];
  if(!DATA.rad_na_zadatku) DATA.rad_na_zadatku=[];
  if(!DATA.sifrarnik || !DATA.sifrarnik.length) DATA.sifrarnik=sifrarnikDemo();   // demo/memorija: isti sadrzaj kao migracija 14
  (DATA.gradilista||[]).forEach(g=>{
    if(!g.adm) g.adm={};
    Object.keys(g.adm).forEach(k=>{
      const v=g.adm[k];
      if(v===true) g.adm[k]={st:'ima'};
      else if(v===false||v==null) g.adm[k]={st:'nema'};
      else if(!v.st) v.st='nema';
    });
  });
}
/* Baza je podesena, a biblioteka/klijent nisu dostupni (CDN blokiran, mreza): NE padamo
   tiho u demo rezim sa izmisljenim podacima i bez prijave — zatvoreno, sa objasnjenjem. */
function prikaziGreskuUcitavanja(poruka){
  document.body.classList.add('login');
  document.getElementById('view').innerHTML=`<div class="login-wrap"><div class="login-card">
    <h1>GradnjaOS</h1><div class="err">${poruka}</div>
    <p>Proveri internet vezu (i da li je cdn.jsdelivr.net dostupan na ovoj mreži), pa pokušaj ponovo.</p>
    <button class="btn" style="width:100%" onclick="location.reload()">Pokušaj ponovo</button>
  </div></div>`;
}
async function pokreni(){
  const v=document.getElementById('view'); if(v) v.innerHTML='<div class="empty" id="ucitavam">Učitavam…</div>';
  const pVerzija=proveriNovuVerziju();   // HEAD zahtev — ne ceka se pre biblioteke
  const supaOk=await initSupa();
  await pVerzija;
  if(SUPABASE_URL && SUPABASE_ANON_KEY && !supaOk){ prikaziGreskuUcitavanja('Ne mogu da učitam biblioteku za bazu, pa se podaci ne mogu prikazati.'); return; }
  if(supa && !(await initAuth())) return;   // ekran za prijavu — podaci se ne ucitavaju bez sesije
  if(supa) beleziLog('otvaranje',{verzija:verzijaTekst(), uredjaj:uredjajTip()});
  await loadState();
  normalizeData();
  if(mode==='supabase') zapamtiSnapshot(DATA);   // posle normalize, da prvi diff ne gura sve
  rebuildMaps();
  if(sinhronizujSveskeSve()) saveState();   // sveske bez zadatka (migracija 20) — samo ko vodi gradiliste
  renderNalog();
  osveziTemuUI();
  renderNav();
  render();
}
pokreni();
