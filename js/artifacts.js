// js/artifacts.js – Artefakte wie in Claude/Gemini: Coden packt Inhalte in <artifact>…</artifact>,
// sie erscheinen als Karte im Chat und öffnen sich in einem Seitenfenster (Vorschau + Code).
// HTML läuft in einer Sandbox (iframe ohne allow-same-origin, ohne Netzwerkzugriff) und kann nie an Login oder Daten.

import { ARTIFACT_TYPES } from './system-prompt.js';
import { aidFor, attachBridge } from './artifact-bridge.js';
import { apiJson } from './backend.js';
import { toast } from './toast.js';
import { confirmBox } from './apps/dialogs.js';

const RE = /<artifact\s+([^>]*)>([\s\S]*?)(<\/artifact>|$)/g;
const attr = (s, k) => (s.match(new RegExp(k + '\\s*=\\s*"([^"]*)"', 'i')) || [])[1] || '';
const TYPES = ARTIFACT_TYPES;
const ALIAS = { jsx: 'react', tsx: 'react', diagram: 'mermaid', graph: 'mermaid', csv: 'table', presentation: 'slides', md: 'markdown', py: 'python' };

export function splitArtifacts(text) {
    const out = []; let last = 0; let m; RE.lastIndex = 0;
    while ((m = RE.exec(text)) !== null) {
        if (m.index > last) out.push({ kind: 'text', text: text.slice(last, m.index) });
        let type = attr(m[1], 'type').toLowerCase(); type = ALIAS[type] || type; if (!TYPES.includes(type)) type = 'code';
        out.push({ kind: 'artifact', type, title: (attr(m[1], 'title') || 'Artefakt').slice(0, 80), language: attr(m[1], 'language').slice(0, 20), body: m[2].replace(/^\n/, '').replace(/\n$/, ''), closed: !!m[3] });
        last = RE.lastIndex; if (m[0].length === 0) RE.lastIndex++;
    }
    // Block, dessen <artifact ...>-Tag noch nicht fertig gestreamt ist, nicht als Rohtext zeigen
    let rest = text.slice(last); const half = rest.search(/<artifact[^>]*$/); if (half !== -1) rest = rest.slice(0, half);
    if (rest) out.push({ kind: 'text', text: rest });
    return out;
}

const EXT = { html: 'html', svg: 'svg', markdown: 'md', code: 'txt', react: 'jsx', mermaid: 'mmd', chart: 'json', table: 'csv', slides: 'md', python: 'py' };
const LANG_EXT = { python: 'py', javascript: 'js', typescript: 'ts', java: 'java', c: 'c', cpp: 'cpp', csharp: 'cs', go: 'go', rust: 'rs', php: 'php', ruby: 'rb', bash: 'sh', sql: 'sql', css: 'css', json: 'json', html: 'html', lua: 'lua', kotlin: 'kt', swift: 'swift' };
export const ARTIFACT_ICON = { html: 'web', svg: 'draw', markdown: 'article', code: 'code', react: 'deployed_code', mermaid: 'account_tree', chart: 'bar_chart', table: 'table_chart', slides: 'slideshow', python: 'terminal' };
export const ARTIFACT_LABEL = { html: 'Webseite', svg: 'Grafik', markdown: 'Dokument', code: 'Code', react: 'React-App', mermaid: 'Diagramm', chart: 'Diagramm', table: 'Tabelle', slides: 'Präsentation', python: 'Python (ausführbar)' };
const ICON = ARTIFACT_ICON;
const LIVE = new Set(['html', 'svg', 'react', 'mermaid', 'chart', 'table', 'slides', 'python']); // brauchen ein iframe
const CDN = "https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://unpkg.com";
const cspFor = (type) => {
    const extra = type === 'react' ? ' https://cdn.tailwindcss.com' : '';
    const wasm = type === 'python' ? " 'wasm-unsafe-eval'" : '';
    const connect = type === 'python' ? 'https://cdn.jsdelivr.net' : "'none'";
    return `default-src 'none'; img-src data: blob: https:; media-src data: blob:; style-src 'unsafe-inline' https:; font-src https: data:; script-src 'unsafe-inline'${wasm} ${CDN}${extra}; connect-src ${connect}; worker-src blob:; form-action 'none'; base-uri 'none'`;
};

// Läuft ohne allow-same-origin: localStorage wirft sonst einen Fehler und bricht ganze Skripte ab -> Ersatz im Speicher
const SHIM = `<script>(function(){function mk(){var d={};return{getItem:function(k){return k in d?d[k]:null},setItem:function(k,v){d[k]=String(v)},removeItem:function(k){delete d[k]},clear:function(){d={}},key:function(i){return Object.keys(d)[i]||null},get length(){return Object.keys(d).length}}}
try{window.localStorage.getItem('x')}catch(e){try{Object.defineProperty(window,'localStorage',{value:mk()});Object.defineProperty(window,'sessionStorage',{value:mk()})}catch(_){}}
window.addEventListener('load',function(){try{window.focus();document.body&&document.body.setAttribute('tabindex','-1');document.body&&document.body.focus()}catch(e){}});
window.addEventListener('error',function(e){try{parent.postMessage({codenArtifactError:String(e.message)},'*')}catch(_){}})})();
(function(){var n=0,w={};window.addEventListener('message',function(e){var d=e.data;if(!d||d.codenReply==null||!w[d.codenReply])return;var p=w[d.codenReply];delete w[d.codenReply];d.ok?p[0](d.value):p[1](new Error(d.error||'Fehler'))});
function call(op,args){return new Promise(function(res,rej){var id=++n;w[id]=[res,rej];try{parent.postMessage({codenCall:id,op:op,args:args},'*')}catch(e){delete w[id];rej(e);return}setTimeout(function(){if(w[id]){delete w[id];rej(new Error('Keine Antwort von Coden'))}},120000)})}
var st={get:function(k,s){return call('get',{key:String(k),shared:!!s})},set:function(k,v,s){return call('set',{key:String(k),value:v,shared:!!s})},delete:function(k,s){return call('delete',{key:String(k),shared:!!s})},list:function(p,s){return call('list',{prefix:p||'',shared:!!s})}};
window.coden={ask:function(p){return call('ask',{prompt:p})},storage:st};window.claude=window.claude||{complete:function(p){return call('ask',{prompt:p})}};try{if(!window.storage)window.storage=st}catch(_){}})();<\/script>`;
const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const js = (v) => JSON.stringify(v).replace(/</g, '\\u003c'); // sicher in <script> einbetten
const BASE_CSS = `*{box-sizing:border-box}html,body{margin:0}body{font:15px/1.5 Inter,system-ui,-apple-system,"Segoe UI",sans-serif;color:#1f2328;background:#fff}.err{margin:16px;padding:12px 14px;border-radius:10px;background:#fff1f0;color:#a8071a;font:13px ui-monospace,monospace;white-space:pre-wrap}`;
const page = (type, head, body) => `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${cspFor(type)}">${SHIM}<style>${BASE_CSS}</style>${head}</head><body>${body}</body></html>`;
const showErr = `function __err(m){var d=document.createElement('div');d.className='err';d.textContent='⚠ '+m;document.body.prepend(d);try{parent.postMessage({codenArtifactError:String(m)},'*')}catch(_){}}`;

// React: JSX mit Babel übersetzen, Komponente automatisch rendern (Hooks sind ohne import nutzbar)
function reactDoc(src) {
    let code = String(src).replace(/^\s*import\s[^;\n]*;?\s*$/gm, '');
    let name = (code.match(/export\s+default\s+function\s+([A-Z]\w*)/) || [])[1] || (code.match(/export\s+default\s+([A-Z]\w*)\s*;?/) || [])[1];
    code = code.replace(/export\s+default\s+function\s+([A-Z]\w*)/, 'function $1').replace(/export\s+default\s+([A-Z]\w*)\s*;?/, '').replace(/export\s+default\s+/, 'const __Default = ').replace(/^\s*export\s+/gm, '');
    if (!name && /const __Default =/.test(code)) name = '__Default';
    if (!name) name = /\bfunction\s+App\b|\b(const|let|var)\s+App\b/.test(code) ? 'App' : ((code.match(/\bfunction\s+([A-Z]\w*)/) || code.match(/\b(?:const|let)\s+([A-Z]\w*)\s*=/) || [])[1] || 'App');
    return page('react', `<script src="https://unpkg.com/react@18/umd/react.production.min.js"><\/script><script src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"><\/script><script src="https://unpkg.com/@babel/standalone@7/babel.min.js"><\/script><script src="https://cdn.tailwindcss.com"><\/script>`,
        `<div id="root"></div><script>${showErr}(function(){try{var src=${js(code)};var out=Babel.transform('(function(){const {useState,useEffect,useRef,useMemo,useCallback,useReducer,useContext,createContext,Fragment,useLayoutEffect,useId}=React;\\n'+src+'\\n;ReactDOM.createRoot(document.getElementById("root")).render(React.createElement(${name}));})()',{presets:['react']}).code;var s=document.createElement('script');s.textContent=out;document.body.appendChild(s)}catch(e){__err(e.message)}})()<\/script>`);
}
function mermaidDoc(src) {
    return page('mermaid', `<style>body{display:flex;align-items:center;justify-content:center;min-height:100vh;padding:20px}.mermaid{width:100%;text-align:center}.mermaid svg{max-width:100%;height:auto}</style><script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"><\/script>`,
        `<pre class="mermaid">${esc(src)}</pre><script>${showErr}try{mermaid.initialize({startOnLoad:false,theme:'default',securityLevel:'strict',fontFamily:'Inter,system-ui,sans-serif'});mermaid.run({querySelector:'.mermaid'}).catch(function(e){__err('Diagramm-Fehler: '+(e.message||e))})}catch(e){__err(e.message)}<\/script>`);
}
function chartDoc(src) {
    return page('chart', `<style>body{padding:16px;height:100vh}#w{position:relative;height:calc(100vh - 32px)}</style><script src="https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js"><\/script>`,
        `<div id="w"><canvas id="c"></canvas></div><script>${showErr}try{var cfg=JSON.parse(${js(src)});cfg.options=Object.assign({responsive:true,maintainAspectRatio:false},cfg.options||{});new Chart(document.getElementById('c'),cfg)}catch(e){__err('Diagramm-JSON fehlerhaft: '+e.message)}<\/script>`);
}
function tableDoc(src) {
    return page('table', `<style>body{padding:14px}.bar{display:flex;gap:8px;align-items:center;margin-bottom:10px;flex-wrap:wrap}input{flex:1;min-width:160px;padding:8px 12px;border:1px solid #d0d7de;border-radius:10px;font:inherit}button{padding:8px 12px;border:1px solid #d0d7de;background:#f6f8fa;border-radius:10px;cursor:pointer;font:inherit}.wrap{overflow:auto;border:1px solid #d0d7de;border-radius:12px;max-height:calc(100vh - 80px)}table{border-collapse:collapse;width:100%;font-size:14px}th,td{padding:8px 12px;border-bottom:1px solid #eaeef2;text-align:left;white-space:nowrap}th{position:sticky;top:0;background:#f6f8fa;cursor:pointer;user-select:none}th:hover{background:#eaeef2}tr:nth-child(even) td{background:#fbfcfd}td.n{text-align:right;font-variant-numeric:tabular-nums}small{color:#57606a}</style>`,
        `<div class="bar"><input id="q" placeholder="Suchen …"><small id="cnt"></small></div><div class="wrap"><table id="t"></table></div><script>${showErr}(function(){var raw=${js(src)};function parse(s){var rows=[],row=[],f='',q=false,sep=(s.split('\\n')[0].split(';').length>s.split('\\n')[0].split(',').length)?';':',';for(var i=0;i<s.length;i++){var c=s[i];if(q){if(c=='"'&&s[i+1]=='"'){f+='"';i++}else if(c=='"')q=false;else f+=c}else if(c=='"')q=true;else if(c==sep){row.push(f);f=''}else if(c=='\\n'||c=='\\r'){if(c=='\\r'&&s[i+1]=='\\n')i++;row.push(f);f='';if(row.some(function(x){return x.trim()}))rows.push(row);row=[]}else f+=c}row.push(f);if(row.some(function(x){return x.trim()}))rows.push(row);return rows}
var rows=parse(raw.trim());if(!rows.length){__err('Keine Daten');return}var head=rows.shift(),sort=-1,dir=1,t=document.getElementById('t'),q=document.getElementById('q');var num=function(v){var x=String(v).replace(/[ €$%]/g,'').replace(',','.');return x!==''&&!isNaN(x)?parseFloat(x):null};
function draw(){var f=q.value.toLowerCase(),list=rows.filter(function(r){return !f||r.join(' ').toLowerCase().indexOf(f)>=0});if(sort>=0)list.sort(function(a,b){var x=num(a[sort]),y=num(b[sort]);return (x!==null&&y!==null?x-y:String(a[sort]||'').localeCompare(String(b[sort]||''),'de'))*dir});
t.innerHTML='';var tr=document.createElement('tr');head.forEach(function(h,i){var th=document.createElement('th');th.textContent=h+(sort===i?(dir>0?' ▲':' ▼'):'');th.onclick=function(){dir=sort===i?-dir:1;sort=i;draw()};tr.appendChild(th)});var th0=document.createElement('thead');th0.appendChild(tr);t.appendChild(th0);var tb=document.createElement('tbody');list.forEach(function(r){var tr=document.createElement('tr');head.forEach(function(_,i){var td=document.createElement('td');td.textContent=r[i]==null?'':r[i];if(num(r[i])!==null)td.className='n';tr.appendChild(td)});tb.appendChild(tr)});t.appendChild(tb);document.getElementById('cnt').textContent=list.length+' von '+rows.length+' Zeilen'}
q.oninput=draw;draw()})()<\/script>`);
}
function slidesDoc(src) {
    return page('slides', `<style>html,body{height:100%;background:#0f1115;overflow:hidden}#stage{position:absolute;inset:0;display:flex;align-items:center;justify-content:center}.slide{width:1280px;height:720px;background:linear-gradient(135deg,#ffffff,#f3f6fb);border-radius:18px;box-shadow:0 30px 80px rgba(0,0,0,.45);padding:64px 80px;display:none;flex-direction:column;justify-content:center;transform-origin:center;color:#16181d;overflow:hidden}.slide.on{display:flex;animation:in .35s ease}@keyframes in{from{opacity:0;transform:var(--s) translateY(10px)}to{opacity:1}}.slide h1{font-size:58px;line-height:1.1;margin:0 0 28px;background:linear-gradient(90deg,#3b5bdb,#9c36b5);-webkit-background-clip:text;background-clip:text;color:transparent}.slide h2{font-size:36px;margin:0 0 16px}.slide p,.slide li{font-size:28px;line-height:1.5}.slide ul{margin:0;padding-left:1.2em}.slide li{margin:6px 0}.slide img{max-height:360px;border-radius:12px}.slide code{background:#eef1f6;padding:2px 8px;border-radius:6px;font-size:.9em}.slide.first{justify-content:center;text-align:center}.slide.first h1{font-size:76px}.note{display:none}.nav{position:fixed;bottom:14px;left:50%;transform:translateX(-50%);display:flex;gap:8px;align-items:center;background:rgba(255,255,255,.1);backdrop-filter:blur(8px);padding:6px 10px;border-radius:999px;color:#fff;font:13px Inter,system-ui,sans-serif}.nav button{background:rgba(255,255,255,.15);color:#fff;border:0;border-radius:999px;width:34px;height:34px;cursor:pointer;font-size:16px}.bar{position:fixed;top:0;left:0;height:3px;background:#5c7cfa;transition:width .3s}</style><script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"><\/script>`,
        `<div class="bar" id="bar"></div><div id="stage"></div><div class="nav"><button id="p" aria-label="Zurück">‹</button><span id="n"></span><button id="x" aria-label="Weiter">›</button><button id="f" aria-label="Vollbild">⛶</button></div><script>${showErr}(function(){try{var parts=${js(src)}.split(/\\n-{3,}\\s*\\n/).map(function(s){return s.trim()}).filter(Boolean),st=document.getElementById('stage'),i=0;
parts.forEach(function(md,k){var d=document.createElement('section');d.className='slide'+(k===0?' first':'');var note=md.match(/\\n(Notizen|Notes):([\\s\\S]*)$/i);if(note)md=md.slice(0,note.index);d.innerHTML=marked.parse(md);st.appendChild(d)});var sl=st.children;
function fit(){var s=Math.min(innerWidth/1340,(innerHeight-70)/760);for(var k=0;k<sl.length;k++){sl[k].style.transform='scale('+s+')';sl[k].style.setProperty('--s','scale('+s+')')}}
function go(n){i=Math.max(0,Math.min(sl.length-1,n));for(var k=0;k<sl.length;k++)sl[k].classList.toggle('on',k===i);document.getElementById('n').textContent=(i+1)+' / '+sl.length;document.getElementById('bar').style.width=((i+1)/sl.length*100)+'%'}
document.getElementById('p').onclick=function(){go(i-1)};document.getElementById('x').onclick=function(){go(i+1)};document.getElementById('f').onclick=function(){try{document.documentElement.requestFullscreen()}catch(e){}};
document.addEventListener('keydown',function(e){if(['ArrowRight','PageDown',' '].indexOf(e.key)>=0){e.preventDefault();go(i+1)}if(['ArrowLeft','PageUp'].indexOf(e.key)>=0){e.preventDefault();go(i-1)}});
var tx=null;document.addEventListener('touchstart',function(e){tx=e.touches[0].clientX});document.addEventListener('touchend',function(e){if(tx===null)return;var d=e.changedTouches[0].clientX-tx;if(Math.abs(d)>40)go(i+(d<0?1:-1));tx=null});
addEventListener('resize',fit);fit();go(0)}catch(e){__err(e.message)}})()<\/script>`);
}
function pythonDoc(src) {
    return page('python', `<style>body{background:#0f1115;color:#e6edf3;font:14px/1.5 ui-monospace,Menlo,Consolas,monospace;padding:14px}.top{display:flex;gap:10px;align-items:center;margin-bottom:10px;font-family:Inter,system-ui,sans-serif}button{background:#2f81f7;color:#fff;border:0;border-radius:10px;padding:8px 16px;font:600 14px Inter,system-ui,sans-serif;cursor:pointer}button:disabled{opacity:.5}#st{color:#8b949e;font-size:13px}#out{white-space:pre-wrap;word-break:break-word}.e{color:#ff7b72}img{max-width:100%;background:#fff;border-radius:8px;margin:8px 0;display:block}</style><script src="https://cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide.js"><\/script>`,
        `<div class="top"><button id="run">▶ Ausführen</button><span id="st">Python wird geladen …</span></div><div id="out"></div><script>${showErr}(function(){var src=${js(src)},out=document.getElementById('out'),st=document.getElementById('st'),btn=document.getElementById('run'),py=null;btn.disabled=true;
function w(t,c){var s=document.createElement('span');if(c)s.className=c;s.textContent=t+'\\n';out.appendChild(s)}
async function boot(){py=await loadPyodide({stdout:function(t){w(t)},stderr:function(t){w(t,'e')}});py.setStdin({stdin:function(){return prompt('Eingabe für input():')||''}});py.globals.set('_coden_img',function(b){var i=document.createElement('img');i.src='data:image/png;base64,'+b;out.appendChild(i)});st.textContent='Bereit';btn.disabled=false;run()}
async function run(){out.innerHTML='';btn.disabled=true;st.textContent='Läuft …';var t0=performance.now();try{await py.loadPackagesFromImports(src);if(/matplotlib/.test(src))py.runPython("import matplotlib\\nmatplotlib.use('AGG')\\nimport matplotlib.pyplot as plt, io, base64\\ndef _cs(*a, **k):\\n    b=io.BytesIO(); plt.savefig(b, format='png', bbox_inches='tight'); b.seek(0); _coden_img(base64.b64encode(b.read()).decode()); plt.clf()\\nplt.show=_cs");await py.runPythonAsync(src);st.textContent='Fertig in '+Math.round(performance.now()-t0)+' ms'}catch(e){w(String(e.message||e).split('\\n').slice(-6).join('\\n'),'e');st.textContent='Fehler'}btn.disabled=false}
btn.onclick=run;boot().catch(function(e){st.textContent='Python konnte nicht geladen werden: '+e.message})})()<\/script>`);
}
export function previewDoc(item) {
    const meta = `<meta http-equiv="Content-Security-Policy" content="${cspFor(item.type)}">`;
    if (item.type === 'react') return reactDoc(item.body);
    if (item.type === 'mermaid') return mermaidDoc(item.body);
    if (item.type === 'chart') return chartDoc(item.body);
    if (item.type === 'table') return tableDoc(item.body);
    if (item.type === 'slides') return slidesDoc(item.body);
    if (item.type === 'python') return pythonDoc(item.body);
    if (item.type === 'svg') return `<!doctype html><html><head><meta charset="utf-8">${meta}${SHIM}<style>html,body{margin:0;height:100%;display:flex;align-items:center;justify-content:center;background:#fff}svg{max-width:100%;max-height:100%}</style></head><body>${item.body}</body></html>`;
    return item.body.includes('<head') ? item.body.replace(/<head([^>]*)>/i, `<head$1>${meta}${SHIM}`) : `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${meta}${SHIM}</head><body>${item.body}</body></html>`;
}
export const fileNameFor = (item) => (item.title.replace(/[^\w\-äöüÄÖÜß ]+/g, '').trim().replace(/\s+/g, '_') || 'artefakt') + '.' + (item.type === 'code' ? (LANG_EXT[item.language.toLowerCase()] || 'txt') : EXT[item.type]);

window.addEventListener('message', (e) => { if (e.data && e.data.codenArtifactError && panel?.classList.contains('open')) { const w = panel.querySelector('.ap-writing'); w.hidden = false; w.textContent = '⚠ Fehler im Artefakt: ' + String(e.data.codenArtifactError).slice(0, 120); } });
let panel, current = null, autoCode = false; const versions = new Map(); // Titel -> Liste der Fassungen (nur in dieser Sitzung)

function build() {
    panel = document.createElement('aside'); panel.id = 'artifact-panel'; panel.className = 'artifact-panel'; panel.setAttribute('aria-label', 'Artefakt');
    panel.innerHTML = `
      <div class="ap-head">
        <span class="material-symbols-outlined ap-icon"></span>
        <div class="ap-title"></div>
        <div class="ap-tabs"><button type="button" data-tab="preview" class="active">Vorschau</button><button type="button" data-tab="code">Code</button></div>
        <div class="ap-more-wrap">
          <button type="button" class="ap-btn" data-act="more" title="Weitere Aktionen" aria-label="Weitere Aktionen" aria-haspopup="true" aria-expanded="false"><span class="material-symbols-outlined">more_horiz</span></button>
          <div class="ap-menu hidden" role="menu">
            <button type="button" class="ap-mi ap-toapp" data-act="app" role="menuitem"><span class="material-symbols-outlined">rocket_launch</span><span>Als App weiterbauen</span></button>
            <button type="button" class="ap-mi" data-act="publish" role="menuitem"><span class="material-symbols-outlined">public</span><span class="ap-pub-label">Veröffentlichen</span></button>
            <button type="button" class="ap-mi" data-act="link" role="menuitem" hidden><span class="material-symbols-outlined">link</span><span>Link kopieren</span></button>
            <button type="button" class="ap-mi danger" data-act="unpublish" role="menuitem" hidden><span class="material-symbols-outlined">public_off</span><span>Veröffentlichung beenden</span></button>
            <button type="button" class="ap-mi" data-act="copy" role="menuitem"><span class="material-symbols-outlined">content_copy</span><span>Code kopieren</span></button>
            <button type="button" class="ap-mi" data-act="download" role="menuitem"><span class="material-symbols-outlined">download</span><span>Herunterladen</span></button>
            <button type="button" class="ap-mi" data-act="full" role="menuitem"><span class="material-symbols-outlined">fullscreen</span><span class="ap-full-label">Vollbild</span></button>
            <div class="ap-ver-wrap" hidden><label class="ap-ver-lbl" for="ap-ver-sel">Version</label><select id="ap-ver-sel" class="ap-versions" title="Version"></select></div>
          </div>
        </div>
        <button type="button" class="ap-btn" data-act="close" title="Schließen" aria-label="Schließen"><span class="material-symbols-outlined">close</span></button>
      </div>
      <div class="ap-body"><div class="ap-preview"></div><pre class="ap-code" hidden><code></code></pre><div class="ap-writing" hidden><span class="dots"><i></i><i></i><i></i></span> Coden schreibt …</div></div>`;
    document.body.appendChild(panel);
    const apMenu = panel.querySelector('.ap-menu');
    const apMoreBtn = panel.querySelector('[data-act="more"]');
    const closeMenu = () => { apMenu.classList.add('hidden'); apMoreBtn?.setAttribute('aria-expanded', 'false'); };

    // Breite per Ziehen am linken Rand ändern (wird gemerkt)
    const grip = document.createElement('div'); grip.className = 'ap-grip'; grip.title = 'Breite ändern'; panel.prepend(grip);
    const setW = (w) => { const px = Math.round(Math.max(340, Math.min(window.innerWidth - 360, w))); document.documentElement.style.setProperty('--ap-w', px + 'px'); return px; };
    const saved = parseInt(localStorage.getItem('coden_ap_w'), 10); if (saved) setW(saved);
    grip.addEventListener('pointerdown', (e) => {
        e.preventDefault(); grip.setPointerCapture(e.pointerId); document.body.classList.add('ap-resizing');
        const mv = (ev) => setW(window.innerWidth - ev.clientX);
        const up = (ev) => { grip.removeEventListener('pointermove', mv); grip.removeEventListener('pointerup', up); document.body.classList.remove('ap-resizing'); try { localStorage.setItem('coden_ap_w', String(setW(window.innerWidth - ev.clientX))); } catch (_) {} };
        grip.addEventListener('pointermove', mv); grip.addEventListener('pointerup', up);
    });
    grip.addEventListener('dblclick', () => { document.documentElement.style.removeProperty('--ap-w'); try { localStorage.removeItem('coden_ap_w'); } catch (_) {} });
    panel.addEventListener('click', async (e) => {
        const tab = e.target.closest('[data-tab]'); const act = e.target.closest('[data-act]');
        if (tab) { closeMenu(); setTab(tab.dataset.tab); }
        if (act) {
            const a = act.dataset.act;
            if (a === 'more') {
                e.stopPropagation();
                const open = apMenu.classList.toggle('hidden') === false;
                apMoreBtn?.setAttribute('aria-expanded', String(open));
                if (open) refreshPublishItems();
                return;
            }
            if (a === 'close') { closeMenu(); Artifacts.close(); }
            if (a === 'full') {
                const full = panel.classList.toggle('full');
                const ic = act.querySelector('.material-symbols-outlined');
                const lb = act.querySelector('.ap-full-label');
                if (ic) ic.textContent = full ? 'fullscreen_exit' : 'fullscreen';
                if (lb) lb.textContent = full ? 'Vollbild beenden' : 'Vollbild';
                closeMenu();
            }
            if (a === 'app' && current) { const it = current; closeMenu(); Artifacts.close(); document.dispatchEvent(new CustomEvent('artifactToApp', { detail: it })); }
            if (a === 'publish' && current) { closeMenu(); publish(current); }
            if (a === 'link' && current) { closeMenu(); const p = publishedOf(current); if (p) copyLink(p.id); }
            if (a === 'unpublish' && current) { closeMenu(); unpublish(current); }
            if (a === 'copy' && current) {
                try {
                    await navigator.clipboard.writeText(current.body);
                    const ic = act.querySelector('.material-symbols-outlined');
                    if (ic) { ic.textContent = 'check'; setTimeout(() => { ic.textContent = 'content_copy'; }, 1500); }
                } catch (_) {}
                closeMenu();
            }
            if (a === 'download' && current) {
                const url = URL.createObjectURL(new Blob([current.body], { type: 'text/plain;charset=utf-8' }));
                const l = document.createElement('a'); l.href = url; l.download = fileNameFor(current); l.click();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
                closeMenu();
            }
        }
    });
    document.addEventListener('click', (e) => { if (!apMenu.contains(e.target) && !apMoreBtn?.contains(e.target)) closeMenu(); });
    panel.querySelector('.ap-versions').addEventListener('change', (e) => { const list = versions.get(current.title) || []; const v = list[+e.target.value]; if (v) { closeMenu(); show(v, true); } });
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape' || !panel.classList.contains('open')) return;
        if (!apMenu.classList.contains('hidden')) { closeMenu(); return; }
        Artifacts.close();
    });
}
let pendingDraw = null; // Vorschau, die gezeichnet werden soll, sobald sie sichtbar ist (Mermaid/Chart brauchen echte Maße)
function setTab(t) {
    panel.querySelectorAll('.ap-tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === t));
    panel.querySelector('.ap-preview').hidden = t !== 'preview'; panel.querySelector('.ap-code').hidden = t !== 'code';
    if (t === 'preview' && pendingDraw) { const d = pendingDraw; pendingDraw = null; requestAnimationFrame(d); }
}
let renderTimer = null;
function show(item, keepTab) {
    if (!panel) build();
    current = item;
    // Auf Tablets (iPad etc.) Seitenleiste automatisch einklappen, damit Chat + Artefakt genug Platz haben
    if (window.innerWidth <= 1180 && window.innerWidth > 768) {
        const sb = document.getElementById('main-sidebar');
        if (sb && !sb.classList.contains('collapsed')) {
            sb.classList.add('collapsed');
            document.getElementById('open-sidebar-btn')?.classList.remove('hidden');
        }
    }
    panel.querySelector('.ap-icon').textContent = ICON[item.type]; panel.querySelector('.ap-title').textContent = item.title;
    panel.querySelector('.ap-toapp').hidden = item.type !== 'html' || !item.closed;
    const list = versions.get(item.title) || [item];
    const sel = panel.querySelector('.ap-versions');
    const verWrap = panel.querySelector('.ap-ver-wrap');
    if (verWrap) verWrap.hidden = list.length < 2;
    sel.hidden = list.length < 2; sel.replaceChildren(...list.map((v, i) => { const o = document.createElement('option'); o.value = i; o.textContent = 'Version ' + (i + 1); return o; })); sel.value = Math.max(0, list.indexOf(item));
    const codeEl = panel.querySelector('.ap-code'); const stick = codeEl.scrollHeight - codeEl.scrollTop - codeEl.clientHeight < 80 || !panel.classList.contains('open');
    codeEl.querySelector('code').textContent = item.body;
    if (stick) codeEl.scrollTop = codeEl.scrollHeight;
    const w = panel.querySelector('.ap-writing'); w.hidden = item.closed; w.innerHTML = '<span class="dots"><i></i><i></i><i></i></span> Coden schreibt …';
    const pv = panel.querySelector('.ap-preview');
    clearTimeout(renderTimer);
    const draw = () => {
        if (item.type === 'markdown') { pv.className = 'ap-preview md'; pv.innerHTML = DOMPurify.sanitize(marked.parse(item.body)); }
        else if (item.type === 'code') { pv.className = 'ap-preview'; pv.replaceChildren(); const pre = document.createElement('pre'); const c = document.createElement('code'); c.textContent = item.body; pre.appendChild(c); pv.appendChild(pre); try { if (item.language && hljs.getLanguage(item.language)) { c.className = 'language-' + item.language; hljs.highlightElement(c); } } catch (_) {} }
        else {
            let f = pv.querySelector('iframe');
            if (!f) { pv.className = 'ap-preview'; pv.replaceChildren(); f = document.createElement('iframe'); f.setAttribute('sandbox', 'allow-scripts allow-modals allow-forms allow-pointer-lock'); f.setAttribute('referrerpolicy', 'no-referrer'); f.setAttribute('allow', 'fullscreen; autoplay'); pv.appendChild(f); }
            attachBridge(f, () => { if (!current) return {}; const p = publishedOf(current); return p ? { aid: p.id, published: true } : { aid: aidFor(sessionOf(), current.title), published: false }; });
            f.srcdoc = previewDoc(item); f.onload = () => { try { f.contentWindow.focus(); } catch (_) {} };
        }
    };
    // Während des Schreibens nur selten neu zeichnen (Skripte würden sonst dauernd neu starten); am Ende sofort
    // Mermaid, Chart & Co. brauchen sichtbare Maße: erst zeichnen, wenn der Vorschau-Tab wirklich offen ist
    const later = () => requestAnimationFrame(() => { if (current !== item) return; if (pv.hidden) pendingDraw = draw; else { pendingDraw = null; draw(); } });
    if (item.closed || !LIVE.has(item.type)) { if (LIVE.has(item.type) && item.type !== 'html' && item.type !== 'svg') later(); else draw(); }
    else if (item.type === 'html' || item.type === 'svg') renderTimer = setTimeout(draw, 700);
    panel.classList.add('open'); document.body.classList.add('artifact-open');
    if (!keepTab) { autoCode = !item.closed && item.type !== 'code'; setTab(item.type === 'code' || autoCode ? 'code' : 'preview'); }
    else if (item.closed && autoCode) { autoCode = false; setTab('preview'); } // fertig geschrieben: automatisch zur Vorschau
}

// ---------- Veröffentlichen (Link wie bei Claude) ----------
let sessionOf = () => 'chat';
let sharedList = null; // [{ id, srcKey, url, version }]
const srcKeyOf = (item) => `${item.sessionId || sessionOf()}|${item.title}`;
const publishedOf = (item) => (sharedList || []).find(x => x.srcKey === srcKeyOf(item)) || null;
const shareUrl = (id) => `${location.origin}/s/${id}`;
async function loadShared(force) { if (sharedList && !force) return sharedList; try { sharedList = (await apiJson('/artifacts/shared')).items || []; } catch (_) { sharedList = sharedList || []; } return sharedList; }
async function refreshPublishItems() {
    if (!panel) return;
    const set = () => {
        const p = current ? publishedOf(current) : null;
        panel.querySelector('.ap-pub-label').textContent = p ? 'Neue Fassung veröffentlichen' : 'Veröffentlichen';
        panel.querySelector('[data-act="link"]').hidden = !p; panel.querySelector('[data-act="unpublish"]').hidden = !p;
        panel.querySelector('[data-act="publish"]').hidden = !current || !current.closed;
    };
    set(); await loadShared(); set();
}
async function copyLink(id) {
    try { await navigator.clipboard.writeText(shareUrl(id)); toast('Link kopiert', { type: 'ok', action: { label: 'Öffnen', run: () => window.open(shareUrl(id), '_blank', 'noopener') } }); }
    catch (_) { toast(shareUrl(id), { ms: 9000 }); }
}
// Dokument zum Veröffentlichen: wie die Vorschau; Dokumente und Code bekommen eine eigene lesbare Seite
function publishDoc(item) {
    if (item.type === 'markdown') return page('markdown', '<style>body{max-width:760px;margin:0 auto;padding:32px 20px;font-size:16px;line-height:1.65}pre{background:#f6f8fa;padding:12px;border-radius:8px;overflow:auto}code{font-family:ui-monospace,monospace}table{border-collapse:collapse}td,th{border:1px solid #ddd;padding:6px 10px}img{max-width:100%}</style>', DOMPurify.sanitize(marked.parse(item.body)));
    if (item.type === 'code') return page('code', '<style>body{margin:0;background:#0f1115;color:#e6e6e6}pre{margin:0;padding:20px;font:13px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre;overflow:auto}</style>', `<pre>${esc(item.body)}</pre>`);
    return previewDoc(item);
}
async function publish(item) {
    await loadShared();
    const p = publishedOf(item);
    const ok = p || await confirmBox(`„${item.title}“ veröffentlichen? Jeder mit dem Link kann das Artefakt ansehen und benutzen. Deine Chats bleiben privat. Du kannst die Veröffentlichung jederzeit beenden.`, { ok: 'Veröffentlichen', title: 'Artefakt veröffentlichen' });
    if (!ok) return;
    try {
        let author = ''; try { author = JSON.parse(localStorage.getItem('coden_settings') || '{}').userName || ''; } catch (_) {}
        const r = await apiJson('/artifacts/share', { method: 'POST', body: JSON.stringify({ title: item.title, type: item.type, body: item.body, html: publishDoc(item), srcKey: srcKeyOf(item), author }) });
        await loadShared(true);
        toast(r.updated ? `Neue Fassung veröffentlicht (Version ${r.version})` : 'Veröffentlicht', { type: 'ok' });
        copyLink(r.id);
    } catch (e) { toast(e.message, { type: 'error', ms: 6000 }); }
}
async function unpublish(item) {
    const p = publishedOf(item); if (!p) return;
    if (!(await confirmBox('Veröffentlichung beenden? Der Link funktioniert danach nicht mehr.', { ok: 'Beenden', danger: true }))) return;
    try { await apiJson('/artifacts/shared/' + p.id, { method: 'DELETE' }); await loadShared(true); toast('Veröffentlichung beendet', { type: 'ok' }); }
    catch (e) { toast(e.message, { type: 'error' }); }
}

export const Artifacts = {
    setContext(fn) { sessionOf = fn; },
    loadShared,
    register(item) { // von ui.js beim Rendern aufgerufen; gibt die Fassungsnummer zurück
        const list = versions.get(item.title) || []; const i = list.findIndex(v => v.key === item.key);
        if (i === -1) list.push(item); else list[i] = item; versions.set(item.title, list);
        if (current && current.key === item.key) { current = item; if (panel?.classList.contains('open')) show(item, true); }
        return list.indexOf(item) + 1;
    },
    open(item) { show(item); },
    close() {
        if (!panel) return;
        panel.querySelector('.ap-menu')?.classList.add('hidden');
        panel.querySelector('[data-act="more"]')?.setAttribute('aria-expanded', 'false');
        const fullBtn = panel.querySelector('[data-act="full"]');
        if (fullBtn) {
            const ic = fullBtn.querySelector('.material-symbols-outlined'); if (ic) ic.textContent = 'fullscreen';
            const lb = fullBtn.querySelector('.ap-full-label'); if (lb) lb.textContent = 'Vollbild';
        }
        panel.classList.remove('open', 'full'); document.body.classList.remove('artifact-open'); current = null; const f = panel.querySelector('iframe'); if (f) f.srcdoc = '';
    },
    reset() { versions.clear(); this.close(); }
};

// Alle Artefakte aus allen Chats (neueste Fassung je Titel), neueste zuerst
export function collectArtifacts(sessions) {
    const map = new Map();
    [...sessions].reverse().forEach(sess => (sess.messages || []).forEach((m, mi) => {
        if (m.isUser || typeof m.text !== 'string' || !m.text.includes('<artifact')) return;
        splitArtifacts(m.text).filter(x => x.kind === 'artifact').forEach((a, i) => map.set(sess.id + '|' + a.title, { ...a, closed: true, key: `${sess.id}:${mi}:${i}`, sessionId: sess.id, chatTitle: sess.title }));
    }));
    return [...map.values()].reverse();
}
export function thumbFor(item) {
    const box = document.createElement('div'); box.className = 'thumb';
    if (item.type === 'html' || item.type === 'svg') {
        const f = document.createElement('iframe'); f.setAttribute('sandbox', ''); f.setAttribute('tabindex', '-1'); f.setAttribute('loading', 'lazy'); f.srcdoc = previewDoc(item).replace(/<script[\s\S]*?<\/script>/gi, ''); box.appendChild(f);
    } else { const pre = document.createElement('pre'); pre.textContent = item.body.slice(0, 500); box.appendChild(pre); }
    return box;
}
