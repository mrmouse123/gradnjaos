'use strict';
/* Minimalni DOM stub — dovoljan da index.html <script> proradi u Node-u.
   Namerno mali: cilj je pokrenuti render/view funkcije, ne emulirati browser. */

class ClassList {
  constructor(){ this._s = new Set(); }
  add(...c){ c.forEach(x=>this._s.add(x)); }
  remove(...c){ c.forEach(x=>this._s.delete(x)); }
  toggle(c, force){
    if(force===true){ this._s.add(c); return true; }
    if(force===false){ this._s.delete(c); return false; }
    if(this._s.has(c)){ this._s.delete(c); return false; }
    this._s.add(c); return true;
  }
  contains(c){ return this._s.has(c); }
  get value(){ return [...this._s].join(' '); }
}

class FakeEl {
  constructor(tag='div', id=''){
    this.tagName = String(tag).toUpperCase();
    this.id = id;
    this.innerHTML = '';
    this.textContent = '';
    this.value = '';
    this.checked = false;
    this.files = [];
    this.src = '';
    this.href = '';
    this.download = '';
    this.style = {};
    this.dataset = {};
    this.classList = new ClassList();
    this.children = [];
    this.parentNode = null;
    this._listeners = {};
  }
  appendChild(c){ this.children.push(c); c.parentNode = this; if(typeof c.onload==='function') c.onload(); return c; }
  removeChild(c){ this.children = this.children.filter(x=>x!==c); c.parentNode = null; return c; }
  remove(){ if(this.parentNode) this.parentNode.removeChild(this); }
  setAttribute(k,v){ this[k]=v; }
  getAttribute(k){ return this[k]; }
  removeAttribute(k){ delete this[k]; }
  addEventListener(t,f){ (this._listeners[t] ||= []).push(f); }
  removeEventListener(t,f){ this._listeners[t] = (this._listeners[t]||[]).filter(x=>x!==f); }
  dispatch(t, ev={}){ (this._listeners[t]||[]).forEach(f=>f.call(this, {target:this, ...ev})); }
  click(){ if(typeof this.onclick==='function') this.onclick({target:this}); this.dispatch('click'); }
  focus(){} blur(){} select(){} scrollIntoView(){}
  querySelector(){ return null; }
  querySelectorAll(){ return []; }
  closest(){ return null; }
  getBoundingClientRect(){ return {top:0,left:0,right:0,bottom:0,width:0,height:0}; }
  insertAdjacentHTML(){}
}

function makeDocument(){
  const byId = new Map();
  const doc = {
    _byId: byId,
    _created: [],
    getElementById(id){
      if(!byId.has(id)) byId.set(id, new FakeEl('div', id));
      return byId.get(id);
    },
    createElement(tag){ const e = new FakeEl(tag); doc._created.push(e); return e; },
    createTextNode(t){ const e = new FakeEl('#text'); e.textContent = t; return e; },
    querySelector(){ return null; },
    querySelectorAll(){ return []; },
    getElementsByTagName(){ return []; },
    getElementsByClassName(){ return []; },
    addEventListener(){}, removeEventListener(){},
    execCommand(){ return true; },
    write(){}, close(){},
    readyState: 'complete',
    cookie: '',
  };
  doc.head = new FakeEl('head');
  doc.body = new FakeEl('body');
  doc.documentElement = new FakeEl('html');
  return doc;
}

/** Napravi svež set globalnih stubova za jedan vm kontekst. */
function makeGlobals(opts = {}){
  const document = makeDocument();
  const calls = { alert: [], confirm: [], print: 0, open: [], scrollTo: 0, reload: 0, prompt: [] };

  const win = {
    document,
    location: { href: 'http://localhost/index.html', hash: '', search: '', reload(){ calls.reload++; } },
    navigator: { userAgent: 'node-e2e', clipboard: { writeText: async()=>{} } },
    // window.storage se NE definiše — app tada ostaje u režimu 'memorija'
    alert: (m)=>{ calls.alert.push(String(m)); },
    confirm: (m)=>{ calls.confirm.push(String(m)); return opts.confirmReturns !== undefined ? opts.confirmReturns : true; },
    prompt: (m)=>{ calls.prompt.push(String(m)); return opts.promptReturns !== undefined ? opts.promptReturns : null; },
    print: ()=>{ calls.print++; },
    open: (u)=>{ calls.open.push(String(u)); return { document, focus(){}, close(){}, print(){} }; },
    scrollTo: ()=>{ calls.scrollTo++; },
    getComputedStyle: ()=>({ getPropertyValue: ()=>'' }),
    requestAnimationFrame: (f)=>setTimeout(f,0),
    cancelAnimationFrame: (h)=>clearTimeout(h),
    matchMedia: ()=>({ matches:false, addListener(){}, removeListener(){}, addEventListener(){}, removeEventListener(){} }),
    setTimeout, clearTimeout, setInterval, clearInterval,
    encodeURIComponent, decodeURIComponent,
    Blob: class Blob { constructor(p){ this.parts = p; } },
    URL: { createObjectURL: ()=>'blob:stub', revokeObjectURL: ()=>{} },
    FileReader: class FileReader {
      readAsText(){ this.result=''; if(this.onload) this.onload({target:this}); }
      readAsDataURL(){ this.result='data:,'; if(this.onload) this.onload({target:this}); }
    },
    console,
  };
  win.window = win;
  win.self = win;
  win.globalThis = win;
  win.top = win;
  win._calls = calls;

  return win;
}

module.exports = { FakeEl, ClassList, makeDocument, makeGlobals };
