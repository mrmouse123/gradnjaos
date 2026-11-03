/* ============================================================
   NAVIGACIJA
   ============================================================ */
let current = 'dash';
function tabs(){
  const ids = visibleSiteIds();
  return [
    {id:'dash', naziv:'Kontrolna tabla', ic:'dash'},
    {id:'sites', naziv:'Gradilišta', ic:'site', cnt:visibleSites().length},
    {id:'clients', naziv:'Klijenti', ic:'client', cnt:DATA.clijenti.length, dirOnly:true},
    {id:'emps', naziv:'Zaposleni', ic:'emp', cnt:DATA.zaposleni.filter(z=>upravaSve()||(z.grs||[]).some(x=>ids.has(x))).length},
    {id:'time', naziv:'Rokovi', ic:'time'},
    {id:'tasks', naziv:'Zadaci', ic:'task', cnt:zadaciVidljivi().length},
    {id:'pay', naziv:'Naplata', ic:'money', cnt:(DATA.situacije||[]).filter(s=>s.status!=='placeno'&&ids.has(s.gr)&&imaNaplatu(grById[s.gr])).length, finOnly:true},
    {id:'diary', naziv:'Dnevnik radova', ic:'book', cnt:DATA.dnevnik.filter(d=>upravaSve()||ids.has(d.gr)).length},
    {id:'resursi', naziv:'Resursi', ic:'truck', cnt:(DATA.resursi||[]).filter(r=>r.istice&&daysBetween(TODAY,dParse(r.istice))<=30).length},
    {id:'magacin', naziv:'Magacin', ic:'box', cnt:0},
    {id:'subs', naziv:(modulEfektivni()==='projektovanje'?'Spoljni saradnici':'Podizvođači'), ic:'brief', cnt:(DATA.podizvodjaci||[]).filter(x=>x.status!=='zavrsen'&&(upravaSve()||(x.grs||[]).some(i=>ids.has(i)))).length},
    {id:'nabavka', naziv:'Trebovanje', ic:'cart', cnt:(DATA.narudzbe||[]).filter(n=>n.status==='poslato'&&(upravaSve()||ids.has(n.gr))).length},
    {id:'nalozi', naziv:'Admin kokpit', ic:'client', dirOnly:true, punaUprava:true},
  ].filter(t=>(!t.dirOnly || isDirector()) && (!t.punaUprava || jePunaUprava()) && (!t.finOnly || canFinance()) && tabDozvoljen(t.id));
}
function renderNav(){
  const t=tabs();
  const podPogled = current==='empPage' || current==='predmer';   // nisu tabovi, ali su legitimna stanja
  if(!t.find(x=>x.id===current) && !podPogled) current='dash';
  document.getElementById('nav').innerHTML = t.map(tb=>`
    <button class="${tb.id===current||(current==='empPage'&&tb.id==='emps')?'active':''}" onclick="go('${tb.id}')">
      ${icon(tb.ic)} ${tb.naziv}
      ${tb.cnt!=null?`<span class="tag num">${tb.cnt}</span>`:''}
    </button>`).join('');
  const rs=document.getElementById('roleSel'); if(rs) rs.innerHTML=roleOptions();
  /* Donja traka (telefon/tablet): 4 najcesca odredista + "Vise" koje otvara pun meni.
     Ista dugmad za obe uloge; aktivno prati `current` jer go() zove renderNav(). */
  const b=document.getElementById('bnav');
  if(b){
    const brzi=[['dash','Tabla','dash'],['sites','Gradilišta','site'],['tasks','Zadaci','task'],['diary','Dnevnik','book']].filter(([id])=>tabDozvoljen(id));
    if(brzi.length<4) brzi.splice(2,0,['time','Rokovi','time']);   // radnik izvodjenja: umesto Zadataka — Rokovi
    const meni='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 6h18M3 12h18M3 18h18"/></svg>';
    b.innerHTML=brzi.map(([id,n,ic])=>`<button class="${id===current?'active':''}" onclick="go('${id}')">${icon(ic)}<span>${n}</span></button>`).join('')
      +`<button onclick="toggleSide()">${meni}<span>Više</span></button>`;
  }
}
function go(id){ current=id; renderNav(); render(); window.scrollTo(0,0); document.getElementById('side').classList.remove('open'); document.getElementById('scrim').classList.remove('on'); }

