// js/artifacts.js – Artefakte wie in Claude/Gemini: Coden packt Inhalte in <artifact>…</artifact>,
// sie erscheinen als Karte im Chat und öffnen sich in einem Seitenfenster (Vorschau + Code).
// HTML läuft in einer Sandbox (iframe ohne allow-same-origin, ohne Netzwerkzugriff) und kann nie an Login oder Daten.

export const ARTIFACT_PROMPT = `
ARTEFAKTE: Wenn der Nutzer etwas Eigenständiges möchte (Webseite, Spiel, Tool, Rechner, Diagramm, SVG-Grafik, längeres Dokument, größeres Code-Programm), packe es in einen Artefakt-Block, damit es in einem eigenen Fenster erscheint:
<artifact type="html" title="Kurzer Titel">…vollständiger Inhalt…</artifact>
Erlaubte type-Werte: html (komplette, selbstständige HTML-Seite mit CSS und JS in einer Datei, kein Netzwerkzugriff, kein localStorage, keine externen Bilder oder APIs; Bibliotheken nur von cdnjs.cloudflare.com, cdn.jsdelivr.net oder unpkg.com; Tastatursteuerung auf document hören, Buttons und Funktionen testweise gedanklich durchgehen), svg, markdown, code (dann zusätzlich language="python" o. Ä.).
Regeln: Der Inhalt steht ROH im Block, NICHT zusätzlich in einem Markdown-Codeblock. Schreibe vor oder nach dem Block höchstens ein, zwei kurze Sätze. Für kurze Antworten, Erklärungen und kleine Code-Schnipsel nutze KEIN Artefakt, sondern normales Markdown. Wenn der Nutzer eine Änderung wünscht, gib das Artefakt mit dem gleichen Titel komplett neu aus.`;

const RE = /<artifact\s+([^>]*)>([\s\S]*?)(<\/artifact>|$)/g;
const attr = (s, k) => (s.match(new RegExp(k + '\\s*=\\s*"([^"]*)"', 'i')) || [])[1] || '';
const TYPES = ['html', 'svg', 'markdown', 'code'];

export function splitArtifacts(text) {
    const out = []; let last = 0; let m; RE.lastIndex = 0;
    while ((m = RE.exec(text)) !== null) {
        if (m.index > last) out.push({ kind: 'text', text: text.slice(last, m.index) });
        let type = attr(m[1], 'type').toLowerCase(); if (!TYPES.includes(type)) type = 'code';
        out.push({ kind: 'artifact', type, title: (attr(m[1], 'title') || 'Artefakt').slice(0, 80), language: attr(m[1], 'language').slice(0, 20), body: m[2].replace(/^\n/, '').replace(/\n$/, ''), closed: !!m[3] });
        last = RE.lastIndex; if (m[0].length === 0) RE.lastIndex++;
    }
    // Block, dessen <artifact ...>-Tag noch nicht fertig gestreamt ist, nicht als Rohtext zeigen
    let rest = text.slice(last); const half = rest.search(/<artifact[^>]*$/); if (half !== -1) rest = rest.slice(0, half);
    if (rest) out.push({ kind: 'text', text: rest });
    return out;
}

const EXT = { html: 'html', svg: 'svg', markdown: 'md', code: 'txt' };
const LANG_EXT = { python: 'py', javascript: 'js', typescript: 'ts', java: 'java', c: 'c', cpp: 'cpp', csharp: 'cs', go: 'go', rust: 'rs', php: 'php', ruby: 'rb', bash: 'sh', sql: 'sql', css: 'css', json: 'json', html: 'html', lua: 'lua', kotlin: 'kt', swift: 'swift' };
const ICON = { html: 'web', svg: 'draw', markdown: 'article', code: 'code' };
const CSP = "default-src 'none'; img-src data: blob: https:; media-src data: blob:; style-src 'unsafe-inline' https:; font-src https: data:; script-src 'unsafe-inline' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://unpkg.com; connect-src 'none'; form-action 'none'; base-uri 'none'";

// Läuft ohne allow-same-origin: localStorage wirft sonst einen Fehler und bricht ganze Skripte ab -> Ersatz im Speicher
const SHIM = `<script>(function(){function mk(){var d={};return{getItem:function(k){return k in d?d[k]:null},setItem:function(k,v){d[k]=String(v)},removeItem:function(k){delete d[k]},clear:function(){d={}},key:function(i){return Object.keys(d)[i]||null},get length(){return Object.keys(d).length}}}
try{window.localStorage.getItem('x')}catch(e){try{Object.defineProperty(window,'localStorage',{value:mk()});Object.defineProperty(window,'sessionStorage',{value:mk()})}catch(_){}}
window.addEventListener('load',function(){try{window.focus();document.body&&document.body.setAttribute('tabindex','-1');document.body&&document.body.focus()}catch(e){}});
window.addEventListener('error',function(e){try{parent.postMessage({codenArtifactError:String(e.message)},'*')}catch(_){}})})();<\/script>`;
export function previewDoc(item) {
    const meta = `<meta http-equiv="Content-Security-Policy" content="${CSP}">`;
    if (item.type === 'svg') return `<!doctype html><html><head><meta charset="utf-8">${meta}${SHIM}<style>html,body{margin:0;height:100%;display:flex;align-items:center;justify-content:center;background:#fff}svg{max-width:100%;max-height:100%}</style></head><body>${item.body}</body></html>`;
    return item.body.includes('<head') ? item.body.replace(/<head([^>]*)>/i, `<head$1>${meta}${SHIM}`) : `<!doctype html><html><head><meta charset="utf-8">${meta}${SHIM}</head><body>${item.body}</body></html>`;
}
export const fileNameFor = (item) => (item.title.replace(/[^\w\-äöüÄÖÜß ]+/g, '').trim().replace(/\s+/g, '_') || 'artefakt') + '.' + (item.type === 'code' ? (LANG_EXT[item.language.toLowerCase()] || 'txt') : EXT[item.type]);

window.addEventListener('message', (e) => { if (e.data && e.data.codenArtifactError && panel?.classList.contains('open')) { const w = panel.querySelector('.ap-writing'); w.hidden = false; w.textContent = '⚠ Fehler im Artefakt: ' + String(e.data.codenArtifactError).slice(0, 120); } });
let panel, current = null, autoCode = false; const versions = new Map(); // Titel -> Liste der Fassungen (nur in dieser Sitzung)

function build() {
    panel = document.createElement('aside'); panel.id = 'artifact-panel'; panel.className = 'artifact-panel'; panel.setAttribute('aria-label', 'Artefakt');
    panel.innerHTML = `
      <div class="ap-head">
        <span class="material-symbols-outlined ap-icon"></span><div class="ap-title"></div>
        <select class="ap-versions" title="Version" hidden></select>
        <div class="ap-tabs"><button data-tab="preview" class="active">Vorschau</button><button data-tab="code">Code</button></div>
        <button class="ap-btn ap-toapp" data-act="app" title="Als App mit eigener Coden-Adresse weiterbauen"><span class="material-symbols-outlined">rocket_launch</span><span class="ap-toapp-t">Als App</span></button>
        <button class="ap-btn" data-act="copy" title="Kopieren"><span class="material-symbols-outlined">content_copy</span></button>
        <button class="ap-btn" data-act="download" title="Herunterladen"><span class="material-symbols-outlined">download</span></button>
        <button class="ap-btn" data-act="full" title="Vollbild"><span class="material-symbols-outlined">fullscreen</span></button>
        <button class="ap-btn" data-act="close" title="Schließen"><span class="material-symbols-outlined">close</span></button>
      </div>
      <div class="ap-body"><div class="ap-preview"></div><pre class="ap-code" hidden><code></code></pre><div class="ap-writing" hidden><span class="dots"><i></i><i></i><i></i></span> Coden schreibt …</div></div>`;
    document.body.appendChild(panel);
    panel.addEventListener('click', async (e) => {
        const tab = e.target.closest('[data-tab]'); const act = e.target.closest('[data-act]');
        if (tab) setTab(tab.dataset.tab);
        if (act) {
            const a = act.dataset.act;
            if (a === 'close') Artifacts.close();
            if (a === 'full') { panel.classList.toggle('full'); }
            if (a === 'app' && current) { const it = current; Artifacts.close(); document.dispatchEvent(new CustomEvent('artifactToApp', { detail: it })); }
            if (a === 'copy' && current) { try { await navigator.clipboard.writeText(current.body); act.querySelector('span').textContent = 'check'; setTimeout(() => act.querySelector('span').textContent = 'content_copy', 1500); } catch (_) {} }
            if (a === 'download' && current) { const url = URL.createObjectURL(new Blob([current.body], { type: 'text/plain;charset=utf-8' })); const l = document.createElement('a'); l.href = url; l.download = fileNameFor(current); l.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
        }
    });
    panel.querySelector('.ap-versions').addEventListener('change', (e) => { const list = versions.get(current.title) || []; const v = list[+e.target.value]; if (v) show(v, true); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && panel.classList.contains('open')) Artifacts.close(); });
}
function setTab(t) {
    panel.querySelectorAll('.ap-tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === t));
    panel.querySelector('.ap-preview').hidden = t !== 'preview'; panel.querySelector('.ap-code').hidden = t !== 'code';
}
let renderTimer = null;
function show(item, keepTab) {
    if (!panel) build();
    current = item;
    panel.querySelector('.ap-icon').textContent = ICON[item.type]; panel.querySelector('.ap-title').textContent = item.title;
    panel.querySelector('.ap-toapp').hidden = item.type !== 'html' || !item.closed;
    const list = versions.get(item.title) || [item]; const sel = panel.querySelector('.ap-versions');
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
            if (!f) { pv.className = 'ap-preview'; pv.replaceChildren(); f = document.createElement('iframe'); f.setAttribute('sandbox', 'allow-scripts allow-modals allow-forms allow-pointer-lock'); f.setAttribute('referrerpolicy', 'no-referrer'); pv.appendChild(f); }
            f.srcdoc = previewDoc(item); f.onload = () => { try { f.contentWindow.focus(); } catch (_) {} };
        }
    };
    // Während des Schreibens nur selten neu zeichnen (Skripte würden sonst dauernd neu starten); am Ende sofort
    if (item.closed || item.type === 'markdown' || item.type === 'code') draw(); else renderTimer = setTimeout(draw, 700);
    panel.classList.add('open'); document.body.classList.add('artifact-open');
    if (!keepTab) { autoCode = !item.closed && item.type !== 'code'; setTab(item.type === 'code' || autoCode ? 'code' : 'preview'); }
    else if (item.closed && autoCode) { autoCode = false; setTab('preview'); } // fertig geschrieben: automatisch zur Vorschau
}

export const Artifacts = {
    register(item) { // von ui.js beim Rendern aufgerufen; gibt die Fassungsnummer zurück
        const list = versions.get(item.title) || []; const i = list.findIndex(v => v.key === item.key);
        if (i === -1) list.push(item); else list[i] = item; versions.set(item.title, list);
        if (current && current.key === item.key) { current = item; if (panel?.classList.contains('open')) show(item, true); }
        return list.indexOf(item) + 1;
    },
    open(item) { show(item); },
    close() { if (!panel) return; panel.classList.remove('open', 'full'); document.body.classList.remove('artifact-open'); current = null; const f = panel.querySelector('iframe'); if (f) f.srcdoc = ''; },
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
