/* ---------- TEMA (svetla / tamna / auto) ----------
   'system' = prati prefers-color-scheme (data-theme se uklanja), 'light'/'dark' = prisilno.
   Izbor u localStorage 'gos_tema'; inline skript u <head> ga primenjuje pre prvog crtanja. */
const TEMA_BOJA={light:'#1F4E79', dark:'#101418'};
function temaIzbor(){ try{ const t=localStorage.getItem('gos_tema'); return t==='dark'||t==='light'?t:'system'; }catch(e){ return 'system'; } }
function temaStvarna(){ const t=temaIzbor(); if(t!=='system') return t; try{ return window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'; }catch(e){ return 'light'; } }
function postaviTemu(t){
  if(t!=='dark'&&t!=='light') t='system';
  try{ if(t==='system') localStorage.removeItem('gos_tema'); else localStorage.setItem('gos_tema',t); }catch(e){}
  const h=document.documentElement;
  if(t==='system') h.removeAttribute('data-theme'); else h.setAttribute('data-theme',t);
  osveziTemuUI();
}
function osveziTemuUI(){
  const izbor=temaIzbor(), stvarna=temaStvarna();
  const seg=document.getElementById('temaSeg');
  if(seg) seg.querySelectorAll('button').forEach((b,i)=>b.classList.toggle('on', ['system','light','dark'][i]===izbor));
  const m=document.querySelector('meta[name="theme-color"]'); if(m) m.setAttribute('content', TEMA_BOJA[stvarna]);
}
if(typeof window!=='undefined' && window.matchMedia){
  try{ window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', osveziTemuUI); }catch(e){}
}
document.addEventListener('keydown',e=>{ if(e.key==='Escape'){ closeDrawer(); closeModal(); closeIzvestaj(); } });

