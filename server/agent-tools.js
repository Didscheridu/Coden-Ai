// Werkzeuge des Coden-Main-Agents (wie bei Claude Code, Codex und Gemini CLI):
// list (Glob), read (mit Zeilennummern), search (grep), check (Syntax + Verweise), fetch (Webseite lesen),
// web_search (Websuche), memory (Projektgedächtnis CODEN.md). Jedes Werkzeug liefert
// { ok, summary (kurz, für die Oberfläche), text (vollständig, für das Modell), set? (Dateiänderungen) }.
const vm = require('vm');
const Agent = require('../shared/agent-core');
const { parseServerUrl, request } = require('./mcp');

const MAX_READ_LINES = 400, MAX_READ_CHARS = 30000, MAX_HITS = 60, FETCH_CHARS = 12000;
const syntax = (code) => { try { new vm.Script(code); return null; } catch (e) { return e.message; } };
const numbered = (lines, from) => lines.map((l, i) => `${String(from + i).padStart(4)}| ${l}`).join('\n');
const plural = (n, a, b) => `${n} ${n === 1 ? a : b}`;

function globToRe(p) {
  const esc = String(p).trim().replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*\/?/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\?/g, '.').replace(/\u0000/g, '.*');
  return new RegExp('^' + esc + '$', 'i');
}

function list(files, pattern) {
  const re = pattern ? globToRe(pattern) : null;
  const names = Object.keys(files).filter(n => !re || re.test(n)).sort();
  const text = names.length ? names.map(n => `${n} (${String(files[n]).split('\n').length} Zeilen, ${String(files[n]).length} Zeichen)`).join('\n') : 'Keine passenden Dateien.';
  return { ok: true, summary: `${plural(names.length, 'Datei', 'Dateien')}${pattern ? ' für ' + pattern : ''}`, text: `Dateien${pattern ? ' (' + pattern + ')' : ''}:\n${text}` };
}

function read(files, path, start, end) {
  const paths = String(path || '').split(',').map(x => x.trim().replace(/^\.?\//, '')).filter(Boolean).slice(0, 5);
  if (!paths.length) return { ok: false, summary: 'kein Pfad angegeben', text: 'Fehler: read braucht path="datei".' };
  const out = []; const done = [];
  for (const p of paths) {
    if (!(p in files)) { out.push(`=== ${p} ===\nFehler: Datei gibt es nicht. Vorhanden: ${Object.keys(files).join(', ')}`); continue; }
    const lines = String(files[p]).split('\n');
    let a = Math.max(1, parseInt(start, 10) || 1); let b = Math.min(lines.length, parseInt(end, 10) || lines.length);
    if (paths.length > 1) { a = 1; b = lines.length; }
    if (b - a + 1 > MAX_READ_LINES) b = a + MAX_READ_LINES - 1;
    let body = numbered(lines.slice(a - 1, b), a);
    if (body.length > MAX_READ_CHARS) body = body.slice(0, MAX_READ_CHARS) + '\n… (gekürzt – lies einen kleineren Bereich mit start/end)';
    out.push(`=== ${p} (Zeilen ${a}–${b} von ${lines.length}) ===\n${body}`);
    done.push(`${p}${a > 1 || b < lines.length ? ` ${a}–${b}` : ''}`);
  }
  return { ok: done.length > 0, summary: done.length ? 'gelesen: ' + done.join(', ') : 'Datei nicht gefunden', text: out.join('\n\n') };
}

function search(files, query, regex, pattern, context) {
  const q = String(query || ''); if (!q) return { ok: false, summary: 'keine Suche angegeben', text: 'Fehler: search braucht query="…".' };
  let re;
  try { re = regex === 'true' || regex === true ? new RegExp(q, 'i') : new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'); }
  catch (e) { return { ok: false, summary: 'ungültiger regulärer Ausdruck', text: 'Fehler im regulären Ausdruck: ' + e.message }; }
  const pat = pattern ? globToRe(pattern) : null;
  const ctxN = Math.max(0, Math.min(4, parseInt(context, 10) || 0));
  const hits = []; const perFile = {};
  for (const n of Object.keys(files).sort()) {
    if (pat && !pat.test(n)) continue;
    const lines = String(files[n]).split('\n');
    lines.forEach((l, i) => {
      if (!re.test(l)) return;
      perFile[n] = (perFile[n] || 0) + 1;
      if (hits.length >= MAX_HITS) return;
      if (!ctxN) {
        hits.push(`${n}:${i + 1}: ${l.trim().slice(0, 200)}`);
      } else {
        const a = Math.max(0, i - ctxN), b = Math.min(lines.length - 1, i + ctxN);
        const block = [];
        for (let k = a; k <= b; k++) block.push(`${k === i ? '>' : ' '} ${n}:${k + 1}: ${lines[k].slice(0, 180)}`);
        hits.push(block.join('\n'));
      }
    });
  }
  const total = Object.values(perFile).reduce((a, b) => a + b, 0);
  return { ok: true, summary: `„${q.slice(0, 40)}“: ${plural(total, 'Treffer', 'Treffer')}${total ? ' in ' + plural(Object.keys(perFile).length, 'Datei', 'Dateien') : ''}`,
    text: total ? `Fundstellen für "${q}" (${total}${total > MAX_HITS ? ', die ersten ' + MAX_HITS : ''}):\n${hits.join(ctxN ? '\n---\n' : '\n')}` : `Keine Fundstellen für "${q}".` };
}

function tree(files) {
  const names = Object.keys(files || {}).sort();
  if (!names.length) return { ok: true, summary: 'leeres Projekt', text: 'Projekt hat noch keine Dateien.' };
  let totalLines = 0, totalBytes = 0;
  const rows = names.map(n => {
    const s = String(files[n]); const lines = s.split('\n').length; const bytes = s.length;
    totalLines += lines; totalBytes += bytes;
    const ext = (n.split('.').pop() || '').toLowerCase();
    const role = n === 'index.html' ? 'Startseite' : ext === 'html' ? 'Seite' : ext === 'css' ? 'Styles' : ext === 'js' ? 'Skript' : ext === 'json' ? 'Daten' : ext === 'svg' ? 'Grafik' : ext === 'md' ? 'Notizen' : 'Datei';
    return `- ${n} [${role}] · ${lines} Zeilen · ${(bytes / 1024).toFixed(1)} KB`;
  });
  return { ok: true, summary: `${plural(names.length, 'Datei', 'Dateien')} · ${totalLines} Zeilen`, text: `Projektstruktur (${names.length} Dateien, ${totalLines} Zeilen, ${(totalBytes / 1024).toFixed(1)} KB):\n${rows.join('\n')}` };
}

function outlineOfFile(name, content) {
  const lines = String(content).split('\n'); const out = [];
  if (/\.html?$/i.test(name)) {
    lines.forEach((l, i) => {
      const t = l.match(/<title[^>]*>([^<]+)<\/title>/i); if (t) out.push(`Z.${i + 1}: title "${t[1].trim()}"`);
      const s = l.match(/<(section|header|nav|main|footer|canvas|dialog|form)\b([^>]*)>/i);
      if (s) { const id = (s[2].match(/\bid=["']([^"']+)["']/i) || [])[1]; out.push(`Z.${i + 1}: <${s[1].toLowerCase()}${id ? ' #' + id : ''}>`); }
      const inc = l.match(/<(?:script|link)\b[^>]*?\b(?:src|href)=["']([^"']+)["']/i);
      if (inc) out.push(`Z.${i + 1}: lädt ${inc[1]}`);
    });
  } else if (/\.css$/i.test(name)) {
    lines.forEach((l, i) => {
      const m = l.match(/^\s*(@media[^{]+|@keyframes\s+[\w-]+|:root|[.#a-zA-Z\[][^{;\n]{1,70})\s*\{/);
      if (m) out.push(`Z.${i + 1}: ${m[1].trim()}`);
    });
  } else if (/\.js$/i.test(name)) {
    lines.forEach((l, i) => {
      let m = l.match(/^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)/);
      if (m) { out.push(`Z.${i + 1}: function ${m[1]}(${m[2].slice(0, 40)})`); return; }
      m = l.match(/^\s*class\s+([A-Za-z_$][\w$]*)/);
      if (m) { out.push(`Z.${i + 1}: class ${m[1]}`); return; }
      m = l.match(/^\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/);
      if (m) { out.push(`Z.${i + 1}: const ${m[1]} = () =>`); return; }
      m = l.match(/^\s*(?:window\.)?([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?function/);
      if (m) { out.push(`Z.${i + 1}: ${m[1]} = function`); return; }
      m = l.match(/addEventListener\(\s*['"]([^'"]+)['"]/);
      if (m) out.push(`Z.${i + 1}: listener(${m[1]})`);
    });
  } else if (/\.json$/i.test(name)) {
    try { const obj = JSON.parse(content); if (obj && typeof obj === 'object') out.push(`Keys: ${Object.keys(obj).slice(0, 20).join(', ')}`); }
    catch (e) { out.push(`JSON-Fehler: ${e.message}`); }
  }
  return out.slice(0, 60);
}

function outline(files, path) {
  const targets = path
    ? String(path).split(',').map(x => x.trim().replace(/^\.?\//, '')).filter(Boolean).slice(0, 5)
    : Object.keys(files || {}).filter(n => /\.(html?|css|js|json)$/i.test(n)).sort().slice(0, 10);
  if (!targets.length) return { ok: false, summary: 'keine passenden Dateien', text: 'Keine Code-Dateien vorhanden.' };
  const parts = []; let hits = 0;
  for (const p of targets) {
    if (!(p in files)) { parts.push(`=== ${p} ===\nFehler: Datei gibt es nicht.`); continue; }
    const sym = outlineOfFile(p, files[p]);
    hits += sym.length;
    parts.push(`=== ${p} (${String(files[p]).split('\n').length} Zeilen) ===\n${sym.length ? sym.join('\n') : '(keine Top-Level-Symbole)'}`);
  }
  return { ok: true, summary: `${plural(targets.length, 'Datei', 'Dateien')} · ${plural(hits, 'Symbol', 'Symbole')}`, text: parts.join('\n\n') };
}

const SAFE_PATH = /^(?!.*\.\.)[A-Za-z0-9_][A-Za-z0-9_.\-/]{0,99}$/;
function move(files, from, to, overwrite) {
  const src = String(from || '').trim().replace(/^\.?\//, '');
  const dst = String(to || '').trim().replace(/^\.?\//, '');
  if (!SAFE_PATH.test(src) || !SAFE_PATH.test(dst)) return { ok: false, summary: 'ungültiger Dateipfad', text: 'Fehler: move braucht gültige Pfade from="…" und to="…".' };
  if (/^coden-kit\./i.test(src) || /^coden-kit\./i.test(dst)) return { ok: false, summary: 'Kit-Datei geschützt', text: 'Fehler: coden-kit.* darf nicht verschoben werden.' };
  if (!(src in files)) return { ok: false, summary: 'Quelldatei fehlt', text: `Fehler: "${src}" gibt es nicht.` };
  if (src === dst) return { ok: false, summary: 'gleicher Pfad', text: 'Quelle und Ziel sind identisch.' };
  if (dst in files && overwrite !== 'true' && overwrite !== true) return { ok: false, summary: 'Zieldatei existiert schon', text: `Fehler: "${dst}" existiert bereits (setze overwrite="true" zum Überschreiben).` };
  return { ok: true, summary: `${src} → ${dst}`, text: `Datei verschoben/umbenannt: ${src} → ${dst}.`, set: { [dst]: files[src] }, remove: [src] };
}

function copy(files, from, to, overwrite) {
  const src = String(from || '').trim().replace(/^\.?\//, '');
  const dst = String(to || '').trim().replace(/^\.?\//, '');
  if (!SAFE_PATH.test(src) || !SAFE_PATH.test(dst)) return { ok: false, summary: 'ungültiger Dateipfad', text: 'Fehler: copy braucht gültige Pfade from="…" und to="…".' };
  if (/^coden-kit\./i.test(dst)) return { ok: false, summary: 'Kit-Datei geschützt', text: 'Fehler: coden-kit.* darf nicht überschrieben werden.' };
  if (!(src in files)) return { ok: false, summary: 'Quelldatei fehlt', text: `Fehler: "${src}" gibt es nicht.` };
  if (dst in files && overwrite !== 'true' && overwrite !== true) return { ok: false, summary: 'Zieldatei existiert schon', text: `Fehler: "${dst}" existiert bereits (setze overwrite="true" zum Überschreiben).` };
  return { ok: true, summary: `${src} → ${dst} kopiert`, text: `Datei kopiert: ${src} → ${dst}.`, set: { [dst]: files[src] } };
}

function insert(files, path, { line, after, content } = {}) {
  const p = String(path || '').trim().replace(/^\.?\//, '');
  if (!SAFE_PATH.test(p) || !(p in files)) return { ok: false, summary: 'Datei fehlt', text: `Fehler: "${p}" gibt es nicht.` };
  const body = String(content ?? '').replace(/^\n/, '').replace(/\n$/, '');
  if (!body) return { ok: false, summary: 'leerer Inhalt', text: 'Fehler: insert braucht Code zwischen <tool ...> und </tool>.' };
  const lines = String(files[p]).split('\n');
  let idx = lines.length;
  if (after !== undefined && after !== '') {
    const n = parseInt(after, 10);
    if (Number.isFinite(n)) idx = Math.max(0, Math.min(lines.length, n));
  } else if (line && String(line).toLowerCase() !== 'end') {
    const n = parseInt(line, 10);
    if (Number.isFinite(n)) idx = Math.max(0, Math.min(lines.length, n - 1));
  }
  const addLines = body.split('\n');
  const next = [...lines.slice(0, idx), ...addLines, ...lines.slice(idx)].join('\n');
  return { ok: true, summary: `${p} (+${addLines.length} Z. bei ${idx + 1})`, text: `${addLines.length} Zeile(n) in ${p} an Zeile ${idx + 1} eingefügt.`, set: { [p]: next } };
}

function domMap(files) {
  const names = Object.keys(files || {}).sort();
  const htmlFiles = names.filter(n => /\.html?$/i.test(n));
  const jsFiles = names.filter(n => /\.js$/i.test(n));
  const ids = new Set(); const gos = new Set(); const sheets = new Set();
  const htmlSummary = [];
  for (const n of htmlFiles) {
    const c = String(files[n]);
    const localIds = []; const scripts = [];
    c.replace(/\bid\s*=\s*["']([\w-]+)["']/gi, (m, v) => { ids.add(v); localIds.push(v); return m; });
    c.replace(/data-go\s*=\s*["']([\w-]+)["']/gi, (m, v) => { gos.add(v); return m; });
    c.replace(/data-open-sheet\s*=\s*["']([\w-]+)["']/gi, (m, v) => { sheets.add(v); return m; });
    c.replace(/<script\b[^>]*?\bsrc\s*=\s*["']([^"']+)["']/gi, (m, s) => { scripts.push(s); return m; });
    htmlSummary.push(`${n}:\n  IDs (${localIds.length}): ${localIds.slice(0, 40).join(', ') || 'keine'}\n  Scripts: ${scripts.join(', ') || 'keine'}`);
  }
  const refs = new Set(); const missing = [];
  for (const n of jsFiles) {
    const c = String(files[n]);
    c.replace(/(?:getElementById|querySelector(?:All)?)\(\s*["'`]#?([\w-]+)["'`]\s*\)/g, (m, id, off) => {
      const full = m;
      if (full.includes('querySelector') && !full.includes('#')) return m;
      refs.add(id);
      if (!ids.has(id) && !new RegExp(`\\.id\\s*=\\s*["'\`]${id}["'\`]|id=\\\\?["']${id}`).test(c)) missing.push(`${n} → #${id}`);
      return m;
    });
  }
  return {
    ok: !missing.length,
    summary: `${ids.size} IDs · ${missing.length ? missing.length + ' fehlt' : 'alles verknüpft'}`,
    text: `DOM-Karte:\n${htmlSummary.join('\n') || 'Keine HTML-Dateien.'}\nJS-ID-Zugriffe (${refs.size}): ${[...refs].slice(0, 40).join(', ') || 'keine'}${gos.size ? `\ndata-go Ziele: ${[...gos].join(', ')}` : ''}${sheets.size ? `\ndata-open-sheet: ${[...sheets].join(', ')}` : ''}${missing.length ? `\nFEHLENDE IDs: ${missing.join(', ')}` : ''}`
  };
}

// ---------- Headless DOM Runtime Smoke-Test (Node vm): fängt Null-Fehler, Timing-Fehler, kaputte Click-Handler & fehlende Globals vorab ab ----------
function parseAttrs(str) {
  const attrs = Object.create(null);
  String(str || '').replace(/([:@\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g, (m, k, d, s, u) => {
    if (!k) return m;
    attrs[k.toLowerCase()] = d ?? s ?? u ?? '';
    return m;
  });
  return attrs;
}

function smokeTest(files) {
  const issues = [];
  const names = Object.keys(files || {});
  const htmlPages = names.filter(n => /\.html?$/i.test(n)).sort((a, b) => (a === 'index.html' ? -1 : b === 'index.html' ? 1 : a.localeCompare(b)));
  if (!htmlPages.length) return issues;

  const SKIP_EXT = /^(https?:|data:|blob:|\/\/|#|mailto:|tel:|javascript:)/i;
  const norm = (p) => String(p || '').trim().split(/[?#]/)[0].replace(/^\.?\//, '');

  const cdnGlobalStubs = (cdnUrls, createProxyFn) => {
    const out = {};
    const joined = cdnUrls.join(' ').toLowerCase();
    if (/three/.test(joined)) out.THREE = createProxyFn('THREE');
    if (/chart/.test(joined)) out.Chart = createProxyFn('Chart');
    if (/lucide/.test(joined)) out.lucide = { createIcons() {} };
    if (/confetti/.test(joined)) out.confetti = () => {};
    if (/gsap/.test(joined)) out.gsap = createProxyFn('gsap');
    if (/leaflet/.test(joined)) out.L = createProxyFn('L');
    if (/marked/.test(joined)) out.marked = { parse: (s) => String(s || '') };
    if (/purify|dompurify/.test(joined)) out.DOMPurify = { sanitize: (s) => String(s || '') };
    if (/highlight/.test(joined)) out.hljs = { highlightAll() {}, highlightElement() {} };
    if (/d3/.test(joined)) out.d3 = createProxyFn('d3');
    if (/anime/.test(joined)) out.anime = createProxyFn('anime');
    if (/dayjs/.test(joined)) out.dayjs = createProxyFn('dayjs');
    if (/axios/.test(joined)) out.axios = createProxyFn('axios');
    return out;
  };

  for (const page of htmlPages.slice(0, 3)) {
    const rawHtml = String(files[page] || '');
    const noComments = rawHtml.replace(/<!--[\s\S]*?-->/g, '');
    const headEndIdx = noComments.search(/<\/head>/i);

    const allEls = [];
    const byId = new Map();
    let docReady = false; // vor </head> sind <body>-Elemente im echten Browser noch nicht geparst

    function makeNode(tag, attrs = {}, inHead = false) {
      const tagU = String(tag || 'div').toUpperCase();
      const attrMap = { ...attrs };
      const children = [];
      const listeners = Object.create(null);
      const classSet = new Set(String(attrMap.class || '').split(/\s+/).filter(Boolean));
      const syncClassAttr = () => { attrMap.class = [...classSet].join(' '); };
      let innerHtmlVal = '';
      let textVal = '';

      const styleObj = new Proxy({}, {
        get(t, p) { return p in t ? t[p] : (p === 'setProperty' ? ((k, v) => { t[k] = v; }) : p === 'getPropertyValue' ? ((k) => t[k] || '') : ''); },
        set(t, p, v) { t[p] = String(v ?? ''); return true; }
      });
      const dataset = new Proxy({}, {
        get(_, p) { const k = 'data-' + String(p).replace(/[A-Z]/g, m => '-' + m.toLowerCase()); return attrMap[k]; },
        set(_, p, v) { const k = 'data-' + String(p).replace(/[A-Z]/g, m => '-' + m.toLowerCase()); attrMap[k] = String(v ?? ''); return true; },
        deleteProperty(_, p) { const k = 'data-' + String(p).replace(/[A-Z]/g, m => '-' + m.toLowerCase()); delete attrMap[k]; return true; }
      });

      const el = {
        nodeType: 1,
        tagName: tagU,
        nodeName: tagU,
        __inHead: inHead,
        get id() { return attrMap.id || ''; },
        set id(v) {
          if (attrMap.id && byId.get(attrMap.id) === el) byId.delete(attrMap.id);
          attrMap.id = String(v || '');
          if (attrMap.id && !byId.has(attrMap.id)) byId.set(attrMap.id, el);
        },
        get className() { return [...classSet].join(' '); },
        set className(v) { classSet.clear(); String(v || '').split(/\s+/).filter(Boolean).forEach(x => classSet.add(x)); syncClassAttr(); },
        classList: {
          add(...xs) { xs.forEach(x => x && classSet.add(String(x))); syncClassAttr(); },
          remove(...xs) { xs.forEach(x => classSet.delete(String(x))); syncClassAttr(); },
          toggle(x, force) { const s = String(x); const has = classSet.has(s); const next = force === undefined ? !has : !!force; if (next) classSet.add(s); else classSet.delete(s); syncClassAttr(); return next; },
          contains(x) { return classSet.has(String(x)); },
          replace(a, b) { if (classSet.delete(String(a))) { classSet.add(String(b)); syncClassAttr(); return true; } return false; }
        },
        style: styleObj,
        dataset,
        value: attrMap.value ?? '',
        checked: 'checked' in attrMap,
        disabled: 'disabled' in attrMap,
        hidden: 'hidden' in attrMap,
        type: attrMap.type || (tagU === 'BUTTON' ? 'submit' : tagU === 'INPUT' ? 'text' : ''),
        name: attrMap.name || '',
        href: attrMap.href || '',
        src: attrMap.src || '',
        width: Number(attrMap.width) || 300,
        height: Number(attrMap.height) || 150,
        selectedIndex: 0,
        options: [],
        rows: Number(attrMap.rows) || 2,
        children,
        childNodes: children,
        parentNode: null,
        parentElement: null,
        get firstChild() { return children[0] || null; },
        get firstElementChild() { return children[0] || null; },
        get lastChild() { return children[children.length - 1] || null; },
        get lastElementChild() { return children[children.length - 1] || null; },
        get nextElementSibling() {
          if (!el.parentElement) return null;
          const idx = el.parentElement.children.indexOf(el);
          return idx >= 0 ? (el.parentElement.children[idx + 1] || null) : null;
        },
        get previousElementSibling() {
          if (!el.parentElement) return null;
          const idx = el.parentElement.children.indexOf(el);
          return idx > 0 ? el.parentElement.children[idx - 1] : null;
        },
        get textContent() { return textVal; },
        set textContent(v) { textVal = String(v ?? ''); },
        get innerText() { return textVal; },
        set innerText(v) { textVal = String(v ?? ''); },
        get innerHTML() { return innerHtmlVal; },
        set innerHTML(v) {
          innerHtmlVal = String(v ?? '');
          // Registriere dynamisch erzeugte Kindelemente (z. B. Render-Ausgaben), damit Folge-Abfragen sie finden
          children.length = 0;
          innerHtmlVal.replace(/<([a-z][a-z0-9-]*)\b([^>]*)>/gi, (m, ct, ca) => {
            if (/^(?:br|hr|img|input|meta|link)$/i.test(ct) && !/\bid=|data-/.test(ca)) return m;
            const child = makeNode(ct, parseAttrs(ca), false);
            child.parentElement = child.parentNode = el;
            children.push(child); allEls.push(child);
            if (child.id && !byId.has(child.id)) byId.set(child.id, child);
            return m;
          });
        },
        getAttribute(k) { const key = String(k).toLowerCase(); return key in attrMap ? attrMap[key] : null; },
        setAttribute(k, v) { const key = String(k).toLowerCase(); attrMap[key] = String(v ?? ''); if (key === 'id') el.id = attrMap[key]; if (key === 'class') el.className = attrMap[key]; },
        hasAttribute(k) { return String(k).toLowerCase() in attrMap; },
        removeAttribute(k) { delete attrMap[String(k).toLowerCase()]; },
        append(...nodes) { nodes.forEach(n => { if (n && typeof n === 'object') { n.parentElement = n.parentNode = el; children.push(n); if (!allEls.includes(n)) allEls.push(n); if (n.id) byId.set(n.id, n); } }); },
        appendChild(n) { el.append(n); return n; },
        prepend(...nodes) { nodes.forEach(n => { if (n && typeof n === 'object') { n.parentElement = n.parentNode = el; children.unshift(n); if (!allEls.includes(n)) allEls.push(n); if (n.id) byId.set(n.id, n); } }); },
        insertBefore(n) { el.append(n); return n; },
        removeChild(n) { const i = children.indexOf(n); if (i >= 0) children.splice(i, 1); return n; },
        replaceChildren(...nodes) { children.length = 0; el.append(...nodes); },
        insertAdjacentHTML(_pos, str) { el.innerHTML = (innerHtmlVal || '') + String(str || ''); },
        remove() { if (el.parentElement) el.parentElement.removeChild(el); },
        cloneNode() { return makeNode(tagU, { ...attrMap }, false); },
        matches(sel) { return matchSelector(el, sel); },
        closest(sel) { let c = el; while (c) { if (matchSelector(c, sel)) return c; c = c.parentElement; } return null; },
        querySelector(sel) { return queryIn(el, sel, true)[0] || null; },
        querySelectorAll(sel) { return queryIn(el, sel, false); },
        getElementsByClassName(cls) { return queryIn(el, '.' + String(cls).trim().split(/\s+/).join('.'), false); },
        getElementsByTagName(t) { return queryIn(el, String(t || '*'), false); },
        addEventListener(type, fn) { if (typeof fn === 'function') (listeners[type] ||= []).push(fn); },
        removeEventListener(type, fn) { if (listeners[type]) listeners[type] = listeners[type].filter(f => f !== fn); },
        dispatchEvent(ev) {
          const e = typeof ev === 'string' ? { type: ev } : (ev || {});
          const event = { target: el, currentTarget: el, preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {}, key: '', code: '', clientX: 0, clientY: 0, ...e };
          const hProp = el['on' + event.type];
          if (typeof hProp === 'function') hProp.call(el, event);
          for (const fn of (listeners[event.type] || []).slice()) fn.call(el, event);
          return true;
        },
        click() { el.dispatchEvent({ type: 'click', target: el, currentTarget: el }); },
        focus() {}, blur() {}, scrollIntoView() {}, select() {}, showModal() { el.open = true; }, close() { el.open = false; }, play() { return Promise.resolve(); }, pause() {},
        reset() {}, submit() {}, checkValidity() { return true; }, reportValidity() { return true; },
        getBoundingClientRect() { return { top: 0, left: 0, right: 320, bottom: 60, width: 320, height: 60, x: 0, y: 0 }; },
        getContext(kind) {
          if (kind === '2d') {
            const grad = { addColorStop() {} };
            return {
              canvas: el, fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, font: '14px sans-serif', textAlign: 'left', textBaseline: 'alphabetic', globalAlpha: 1, imageSmoothingEnabled: true, shadowBlur: 0, shadowColor: 'transparent',
              clearRect() {}, fillRect() {}, strokeRect() {}, beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, arc() {}, quadraticCurveTo() {}, bezierCurveTo() {}, rect() {}, roundRect() {}, ellipse() {},
              fill() {}, stroke() {}, clip() {}, save() {}, restore() {}, translate() {}, rotate() {}, scale() {}, setTransform() {}, resetTransform() {},
              fillText() {}, strokeText() {}, measureText(s) { return { width: String(s || '').length * 8 }; },
              drawImage() {}, createImageData() { return { data: [] }; }, getImageData() { return { data: [] }; }, putImageData() {},
              createLinearGradient() { return grad; }, createRadialGradient() { return grad; }, setLineDash() {}
            };
          }
          return {};
        }
      };
      el.__listeners = listeners;
      return el;
    }

    function matchSimple(el, part) {
      part = part.trim();
      if (!part) return false;
      if (part === '*') return true;
      let rest = part;
      const tagM = rest.match(/^[a-zA-Z][a-zA-Z0-9-]*/);
      if (tagM) { if (el.tagName !== tagM[0].toUpperCase()) return false; rest = rest.slice(tagM[0].length); }
      const idM = rest.match(/#([\w-]+)/g);
      if (idM) for (const s of idM) if (el.id !== s.slice(1)) return false;
      const clsM = rest.match(/\.([\w-]+)/g);
      if (clsM) for (const s of clsM) if (!el.classList.contains(s.slice(1))) return false;
      const attrM = rest.match(/\[([^\]=]+)(?:=["']?([^"'\]]*)["']?)?\]/g);
      if (attrM) {
        for (const a of attrM) {
          const m = a.match(/\[([^\]=]+)(?:=["']?([^"'\]]*)["']?)?\]/);
          if (!m) continue;
          const val = el.getAttribute(m[1].trim());
          if (val === null) return false;
          if (m[2] !== undefined && val !== m[2]) return false;
        }
      }
      return true;
    }

    function matchSelector(el, sel) {
      const groups = String(sel || '').split(',');
      for (const g of groups) {
        const parts = g.trim().split(/\s+/).filter(Boolean);
        if (!parts.length) continue;
        const last = parts[parts.length - 1];
        if (!matchSimple(el, last)) continue;
        if (parts.length === 1) return true;
        let cur = el.parentElement; let ok = true;
        for (let i = parts.length - 2; i >= 0; i--) {
          while (cur && !matchSimple(cur, parts[i])) cur = cur.parentElement;
          if (!cur) { ok = false; break; }
          cur = cur.parentElement;
        }
        if (ok) return true;
      }
      return false;
    }

    function queryIn(scope, sel, single) {
      const list = [];
      const pool = scope && scope !== docEl ? allEls.filter(e => {
        if (!docReady && !e.__inHead) return false;
        let p = e.parentElement; while (p) { if (p === scope) return true; p = p.parentElement; }
        return false;
      }) : allEls.filter(e => docReady || e.__inHead);
      for (const e of pool) {
        if (matchSelector(e, sel)) {
          list.push(e);
          if (single) break;
        }
      }
      return list;
    }

    const docEl = makeNode('html', {}, true);
    const headEl = makeNode('head', {}, true);
    const bodyEl = makeNode('body', {}, false);
    headEl.parentElement = headEl.parentNode = docEl;
    bodyEl.parentElement = bodyEl.parentNode = docEl;
    docEl.children.push(headEl, bodyEl);

    // Elemente aus HTML-Markup sammeln (ohne <script>/<style>/<template>-Textkörper)
    const strippedMarkup = noComments.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, '');
    strippedMarkup.replace(/<([a-z][a-z0-9-]*)\b([^>]*)>/gi, (m, tag, attrStr, off) => {
      const tLow = tag.toLowerCase();
      if (tLow === 'html' || tLow === 'head' || tLow === 'body') return m;
      const inHead = headEndIdx >= 0 && off < headEndIdx;
      const node = makeNode(tLow, parseAttrs(attrStr), inHead);
      const parent = inHead ? headEl : bodyEl;
      node.parentElement = node.parentNode = parent;
      parent.children.push(node);
      allEls.push(node);
      if (node.id && !byId.has(node.id)) byId.set(node.id, node);
      return m;
    });

    // Scripts in Ausführungsreihenfolge einsammeln
    const headScripts = [], bodyScripts = [], deferredScripts = [], cdnUrls = [];
    noComments.replace(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi, (m, a, body, off) => {
      // Module (type="module", .ts/.tsx/.jsx) laufen im Browser über den Coden-Bundler – hier nicht im vm testen
      if (/type\s*=\s*["'](?!text\/javascript)[^"']+["']/i.test(a) || /type\s*=\s*module\b/i.test(a)) return m;
      const srcAttr = (a.match(/\bsrc\s*=\s*["']([^"']+)["']/i) || [])[1] || '';
      if (/\.(jsx|tsx|ts|mts)(\?|#|$)/i.test(srcAttr)) return m;
      const srcNorm = norm(srcAttr);
      if (srcAttr && SKIP_EXT.test(srcAttr)) { cdnUrls.push(srcAttr); return m; }
      if (srcNorm && /(^|\/)coden-kit\.js$/.test(srcNorm)) return m;
      const code = srcNorm ? (srcNorm in files ? String(files[srcNorm]) : null) : body;
      if (code === null || !code.trim()) return m;
      const label = srcNorm || `${page} (Inline-Skript)`;
      const inHead = headEndIdx >= 0 && off < headEndIdx;
      const isDeferred = /\b(?:defer|async)\b/i.test(a);
      if (inHead && !isDeferred) headScripts.push({ label, code, inHead: true });
      else if (inHead && isDeferred) deferredScripts.push({ label, code, inHead: false });
      else bodyScripts.push({ label, code, inHead: false });
      return m;
    });

    const runOrder = [...headScripts, ...bodyScripts, ...deferredScripts];
    if (!runOrder.length) continue;

    // Sandbox-Kontext aufbauen
    const docListeners = Object.create(null);
    const winListeners = Object.create(null);
    const storageMap = () => {
      const m = new Map();
      return {
        getItem: (k) => (m.has(String(k)) ? m.get(String(k)) : null),
        setItem: (k, v) => m.set(String(k), String(v)),
        removeItem: (k) => m.delete(String(k)),
        clear: () => m.clear(),
        key: (i) => [...m.keys()][i] || null,
        get length() { return m.size; }
      };
    };
    const localStore = storageMap();
    const doc = {
      readyState: 'loading',
      title: (rawHtml.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1] || '',
      cookie: '',
      documentElement: docEl,
      head: headEl,
      body: bodyEl,
      getElementById(id) {
        const node = byId.get(String(id || ''));
        if (!node) return null;
        if (!docReady && !node.__inHead) return null;
        return node;
      },
      querySelector: (s) => queryIn(docEl, s, true)[0] || null,
      querySelectorAll: (s) => queryIn(docEl, s, false),
      getElementsByClassName: (c) => queryIn(docEl, '.' + String(c).trim().split(/\s+/).join('.'), false),
      getElementsByTagName: (t) => queryIn(docEl, String(t || '*'), false),
      createElement: (t) => makeNode(t, {}, false),
      createElementNS: (_ns, t) => makeNode(t, {}, false),
      createDocumentFragment: () => makeNode('#fragment', {}, false),
      createTextNode: (t) => ({ nodeType: 3, textContent: String(t ?? '') }),
      addEventListener: (t, fn) => { if (typeof fn === 'function') (docListeners[t] ||= []).push(fn); },
      removeEventListener: (t, fn) => { if (docListeners[t]) docListeners[t] = docListeners[t].filter(f => f !== fn); },
      dispatchEvent: (ev) => { const e = typeof ev === 'string' ? { type: ev } : ev; for (const fn of (docListeners[e.type] || []).slice()) fn({ target: doc, currentTarget: doc, preventDefault() {}, stopPropagation() {}, ...e }); return true; }
    };

    const kitListeners = Object.create(null);
    const kvStore = new Map();
    const codenMock = {
      $: (s, el) => (el || doc).querySelector(s),
      $$: (s, el) => (el || doc).querySelectorAll(s),
      go(id, opts = {}) {
        const target = doc.getElementById(id);
        if (!target) { issues.push(`Coden.go("${id}") in ${page}: Bildschirm #${id} existiert nicht.`); return; }
        doc.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s === target));
        (kitListeners[id] || []).forEach(fn => fn(target, opts.data));
      },
      back() {},
      toast() {},
      sheet: { open(id) { const s = doc.getElementById(id); if (s) s.classList.add('open'); }, close() {} },
      store: { get: (k, d = null) => (kvStore.has(k) ? kvStore.get(k) : d), set: (k, v) => { kvStore.set(k, v); return v; }, remove: (k) => kvStore.delete(k) },
      db: {
        supabase: async () => ({ from: () => ({ select: async () => ({ data: [], error: null }), insert: async () => ({ data: [], error: null }), update: async () => ({ data: [], error: null }), delete: async () => ({ data: [], error: null }) }) }),
        firebase: async () => ({ firestore: () => ({}), auth: () => ({}) }),
        rest: async () => ({})
      },
      fmt: { date: (d) => String(d || ''), time: (d) => String(d || ''), money: (n) => `${n} €`, num: (n) => String(n ?? 0) },
      esc: (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
      loadScript: async () => {},
      platform: 'web',
      fit: () => 1,
      autoscale: () => {},
      onScreen: (id, fn) => { (kitListeners[id] ||= []).push(fn); },
      uid: () => 'id1',
      haptic: () => {},
      game: {
        keys: new Set(), pressed: () => false, axis: () => ({ x: 0, y: 0 }), pointer: { x: 0, y: 0, down: false, clicked: false },
        create: (o = {}) => {
          const c = typeof o.canvas === 'string' ? doc.querySelector(o.canvas) : (o.canvas || doc.createElement('canvas'));
          const ctx = c ? c.getContext('2d') : makeNode('canvas').getContext('2d');
          return { canvas: c, ctx, w: o.width || 960, h: o.height || 540, scale: 1, paused: false, t: 0, fps: 60, pause() { this.paused = true; }, resume() { this.paused = false; }, shake() {}, loop(cb) { if (typeof cb === 'function') rafQueue.push(() => cb(0.016, 0.016)); } };
        },
        touchControls() {}, onSwipe() {}, sfx() {}, music() {}, best: (_k, v) => v || 0, hit: () => false, dist: () => 0, rand: (a = 0, b = 1) => a, clamp: (v, a, b) => Math.max(a, Math.min(b, v)), lerp: (a, b, t) => a + (b - a) * t,
        particles: () => ({ burst() {}, update() {}, draw() {} }), overlay: (s) => ({ show() {}, hide() {} })
      }
    };
    const makeStubProxy = (label) => {
      const fn = function () { return makeStubProxy(label); };
      return new Proxy(fn, {
        get(_t, prop) { if (prop === 'then' || prop === 'toJSON') return undefined; return makeStubProxy(label); },
        construct() { return makeStubProxy(label); }
      });
    };
    codenMock.three = makeStubProxy('Coden.three');

    const rafQueue = [];
    const runtimeConsoleErrs = [];
    const sandbox = {
      document: doc,
      console: { log() {}, info() {}, warn() {}, error: (...args) => { runtimeConsoleErrs.push(args.map(String).join(' ')); } },
      localStorage: localStore,
      sessionStorage: storageMap(),
      navigator: { userAgent: 'Mozilla/5.0 CodenSmoke', language: 'de-DE', clipboard: { writeText: async () => {} }, vibrate: () => {} },
      location: { href: 'https://coden.local/' + page, pathname: '/' + page, search: '', hash: '', origin: 'https://coden.local', reload() {} },
      history: { pushState() {}, replaceState() {}, back() {} },
      URL, URLSearchParams,
      Intl,
      crypto: { randomUUID: () => '00000000-0000-4000-8000-000000000001', getRandomValues: (arr) => arr },
      fetch: async (u) => {
        const key = norm(typeof u === 'string' ? u : (u?.url || ''));
        if (key && key in files) {
          const txt = String(files[key]);
          return { ok: true, status: 200, text: async () => txt, json: async () => JSON.parse(txt) };
        }
        return { ok: true, status: 200, text: async () => '{}', json: async () => ({}) };
      },
      matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }),
      ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
      IntersectionObserver: class { observe() {} unobserve() {} disconnect() {} },
      MutationObserver: class { observe() {} disconnect() {} },
      requestAnimationFrame: (cb) => { if (typeof cb === 'function' && rafQueue.length < 4) rafQueue.push(() => cb(16)); return rafQueue.length; },
      cancelAnimationFrame: () => {},
      setTimeout: (_fn, _ms) => 1,
      clearTimeout: () => {},
      setInterval: (_fn, _ms) => 1,
      clearInterval: () => {},
      alert() {}, confirm: () => true, prompt: () => '',
      innerWidth: 1024, innerHeight: 768, devicePixelRatio: 1,
      scrollTo() {},
      Event: class { constructor(t) { this.type = t; } preventDefault() {} stopPropagation() {} },
      CustomEvent: class { constructor(t, o) { this.type = t; this.detail = o?.detail; } preventDefault() {} stopPropagation() {} },
      Image: class { set src(_) {} },
      Audio: class { play() { return Promise.resolve(); } pause() {} },
      Coden: codenMock,
      addEventListener: (t, fn) => { if (typeof fn === 'function') (winListeners[t] ||= []).push(fn); },
      removeEventListener: (t, fn) => { if (winListeners[t]) winListeners[t] = winListeners[t].filter(f => f !== fn); },
      dispatchEvent: (ev) => { const e = typeof ev === 'string' ? { type: ev } : ev; for (const fn of (winListeners[e.type] || []).slice()) fn({ target: sandbox, currentTarget: sandbox, ...e }); return true; },
      ...cdnGlobalStubs(cdnUrls, makeStubProxy)
    };
    sandbox.window = sandbox;
    sandbox.self = sandbox;
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);

    const recordErr = (where, err, inHeadTiming) => {
      const msg = String(err?.message || err || 'Unbekannter Laufzeitfehler');
      if (inHeadTiming && /Cannot read|Cannot set|null/i.test(msg)) {
        issues.push(`Laufzeitfehler beim Start in ${where}: ${msg} (Skript läuft im <head> bevor <body> existiert – ergänze defer oder verschiebe es vor </body>).`);
      } else {
        issues.push(`Laufzeitfehler in ${where}: ${msg}`);
      }
    };

    for (const s of headScripts) {
      try { vm.runInContext(s.code, sandbox, { filename: s.label, timeout: 250 }); }
      catch (e) { if (e?.name !== 'SyntaxError') recordErr(s.label, e, true); }
    }
    docReady = true;
    doc.readyState = 'interactive';
    for (const s of [...bodyScripts, ...deferredScripts]) {
      try { vm.runInContext(s.code, sandbox, { filename: s.label, timeout: 250 }); }
      catch (e) { if (e?.name !== 'SyntaxError') recordErr(s.label, e, false); }
    }
    try { doc.dispatchEvent('DOMContentLoaded'); } catch (e) { recordErr(`${page} (DOMContentLoaded)`, e, false); }
    doc.readyState = 'complete';
    try { sandbox.dispatchEvent('load'); } catch (e) { recordErr(`${page} (load)`, e, false); }
    // Maximal 1 Frame auslösen, um Render-/Game-Loop-Abstürze sofort zu erkennen
    for (const fn of rafQueue.splice(0, 2)) {
      try { fn(); } catch (e) { recordErr(`${page} (Animation-Frame)`, e, false); }
    }
    // Synthetischer Klick-Test auf interaktive Buttons der Seite
    const buttons = allEls.filter(e => e.tagName === 'BUTTON' && (typeof e.onclick === 'function' || (e.__listeners.click && e.__listeners.click.length))).slice(0, 6);
    for (const b of buttons) {
      try { b.click(); } catch (e) { recordErr(`${page} (Klick auf ${b.id ? '#' + b.id : 'button'})`, e, false); }
    }
  }
  return [...new Set(issues)].slice(0, 8);
}

function check(files, { includeSmoke = true } = {}) {
  const issues = Agent.check(files, { syntax });
  for (const n of Object.keys(files || {})) {
    if (/\.json$/i.test(n)) {
      try { JSON.parse(String(files[n])); } catch (e) { issues.push(`JSON-Fehler in ${n}: ${e.message}`); }
    }
  }
  if (includeSmoke) issues.push(...smokeTest(files));
  const uniq = [...new Set(issues)].slice(0, 12);
  return { ok: !uniq.length, issues: uniq, summary: uniq.length ? plural(uniq.length, 'Problem', 'Probleme') + ' gefunden' : 'keine Probleme', text: uniq.length ? `Prüfung: ${uniq.length} Problem(e):\n${uniq.map(i => '- ' + i).join('\n')}` : 'Prüfung: keine Syntaxfehler, alle Dateien und Elemente gefunden und Laufzeit-Check bestanden.' };
}

// ---------- Web ----------
const decode = (s) => String(s).replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&#(\d+);/g, (m, n) => String.fromCharCode(+n));
function htmlToText(html) {
  let t = String(html).replace(/<(script|style|noscript|svg|template)\b[\s\S]*?<\/\1>/gi, ' ').replace(/<!--[\s\S]*?-->/g, ' ');
  const title = (t.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1];
  t = t.replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section|\/article|\/pre)\b[^>]*>/gi, '\n').replace(/<li\b[^>]*>/gi, '\n- ').replace(/<h([1-6])\b[^>]*>/gi, (m, n) => '\n' + '#'.repeat(+n) + ' ').replace(/<[^>]+>/g, ' ');
  t = decode(t).replace(/[ \t]+/g, ' ').replace(/\n\s*\n\s*\n+/g, '\n\n').trim();
  return { title: title ? decode(title).trim() : '', text: t };
}
async function get(url, { maxBody = 2 * 1024 * 1024 } = {}) {
  let u = parseServerUrl(url);
  for (let i = 0; i < 4; i++) {
    const r = await request(u, { method: 'GET', redirects: true, maxBody, timeout: 15000, headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CodenAgent/1.0)', Accept: 'text/html,application/json,text/plain;q=0.9,*/*;q=0.5', 'Accept-Language': 'de,en;q=0.8' } });
    if (r.status >= 300 && r.status < 400 && r.headers.location) { u = parseServerUrl(new URL(r.headers.location, u).toString()); continue; }
    return { ...r, url: u.toString() };
  }
  throw new Error('Zu viele Weiterleitungen.');
}
async function fetchUrl(url) {
  try {
    const r = await get(url);
    if (r.status >= 400) return { ok: false, summary: `HTTP ${r.status}`, text: `Fehler: ${url} antwortet mit HTTP ${r.status}.` };
    const type = String(r.headers['content-type'] || '');
    const body = /html/.test(type) ? htmlToText(r.text) : { title: '', text: r.text };
    const text = body.text.slice(0, FETCH_CHARS);
    return { ok: true, summary: `${body.title || new URL(r.url).hostname} · ${Math.round(body.text.length / 1000)}k Zeichen`, text: `Inhalt von ${r.url}${body.title ? ' – ' + body.title : ''}:\n${text}${body.text.length > FETCH_CHARS ? '\n… (gekürzt)' : ''}` };
  } catch (e) { return { ok: false, summary: 'nicht erreichbar', text: `Fehler beim Abrufen von ${url}: ${e.message}` }; }
}
// Websuche ohne API-Schlüssel (DuckDuckGo HTML). Liefert eine Liste { title, url, snippet }.
async function ddgResults(query) {
  const r = await get('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(query), { maxBody: 1024 * 1024 });
  const out = [];
  const re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:class="result__snippet"[^>]*>([\s\S]*?)<\/a>)?/g; let m;
  while ((m = re.exec(r.text)) && out.length < 10) {
    let link = decode(m[1]); const u = link.match(/[?&]uddg=([^&]+)/); if (u) link = decodeURIComponent(u[1]); if (link.startsWith('//')) link = 'https:' + link;
    if (/duckduckgo\.com\/y\.js/.test(link)) continue; // Anzeigen
    out.push({ title: decode(m[2].replace(/<[^>]+>/g, '')).trim(), url: link, snippet: decode(String(m[3] || '').replace(/<[^>]+>/g, '')).trim() });
  }
  return out;
}
async function webSearch(query) {
  const q = String(query || '').trim(); if (!q) return { ok: false, summary: 'keine Suche angegeben', text: 'Fehler: web_search braucht query="…".' };
  try {
    // mehrere Gratis-Quellen (Google über Gemini, DuckDuckGo, Bing, News, Wikipedia), siehe server/websearch.js
    const out = (await require('./websearch').freeSearch(q, 8)).results.slice(0, 8);
    if (!out.length) return { ok: false, summary: 'keine Ergebnisse', text: `Keine Suchergebnisse für "${q}".` };
    return { ok: true, summary: `„${q.slice(0, 40)}“: ${plural(out.length, 'Ergebnis', 'Ergebnisse')}`, text: `Suchergebnisse für "${q}":\n${out.map((x, i) => `${i + 1}. ${x.title}\n   ${x.url}\n   ${x.text || x.snippet}`).join('\n')}\nLies eine Seite genauer mit <tool name="fetch" url="…"/>.` };
  } catch (e) { return { ok: false, summary: 'Suche nicht erreichbar', text: `Die Websuche ist gerade nicht erreichbar (${e.message}). Arbeite mit deinem Wissen weiter.` }; }
}

async function cdnQuery(query) {
  const r = await get('https://api.cdnjs.com/libraries?search=' + encodeURIComponent(query) + '&fields=name,latest,description&limit=6', { maxBody: 512 * 1024 });
  const d = JSON.parse(r.text || '{}');
  return Array.isArray(d.results) ? d.results : [];
}
async function cdnSearch(query) {
  const q = String(query || '').trim(); if (!q) return { ok: false, summary: 'kein Paket angegeben', text: 'Fehler: cdn_search braucht query="…".' };
  try {
    const list = (await module.exports.cdnQuery(q)).slice(0, 6);
    if (!list.length) return { ok: false, summary: 'nichts gefunden', text: `Keine CDN-Bibliothek für "${q}" gefunden.` };
    return {
      ok: true,
      summary: `„${q.slice(0, 30)}“: ${plural(list.length, 'Paket', 'Pakete')}`,
      text: `CDN-Bibliotheken für "${q}" (einbinden als <script src="…"> oder <link rel="stylesheet" href="…">):\n` +
        list.map((x, i) => `${i + 1}. ${x.name}: ${x.latest}${x.description ? ' — ' + String(x.description).slice(0, 120) : ''}`).join('\n')
    };
  } catch (e) { return { ok: false, summary: 'CDN-Suche nicht erreichbar', text: `CDN-Suche fehlgeschlagen (${e.message}).` }; }
}

// Projektgedächtnis (wie CLAUDE.md / AGENTS.md / GEMINI.md)
function memory(files, note) {
  const n = String(note || '').trim().slice(0, 600); if (!n) return { ok: false, summary: 'leere Notiz', text: 'Fehler: memory braucht einen Text.' };
  const cur = String(files['CODEN.md'] || '# Projekt-Gedächtnis (von Coden gepflegt)\n');
  if (cur.length > 6000) return { ok: false, summary: 'Gedächtnis ist voll', text: 'CODEN.md ist voll – fasse sie mit einem <file path="CODEN.md">-Block kürzer zusammen.' };
  return { ok: true, summary: 'gemerkt in CODEN.md', text: 'Notiz in CODEN.md gespeichert.', set: { 'CODEN.md': cur.replace(/\s*$/, '') + '\n- ' + n.replace(/\n+/g, ' ') + '\n' } };
}

module.exports = { list, tree, read, outline, search, check, smokeTest, domMap, move, copy, insert, fetchUrl, webSearch, ddgResults, cdnSearch, cdnQuery, memory, htmlToText, globToRe, syntax };
