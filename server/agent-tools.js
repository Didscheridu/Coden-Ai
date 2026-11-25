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

function check(files) {
  const issues = Agent.check(files, { syntax });
  for (const n of Object.keys(files || {})) {
    if (/\.json$/i.test(n)) {
      try { JSON.parse(String(files[n])); } catch (e) { issues.push(`JSON-Fehler in ${n}: ${e.message}`); }
    }
  }
  const uniq = [...new Set(issues)].slice(0, 12);
  return { ok: !uniq.length, issues: uniq, summary: uniq.length ? plural(uniq.length, 'Problem', 'Probleme') + ' gefunden' : 'keine Probleme', text: uniq.length ? `Prüfung: ${uniq.length} Problem(e):\n${uniq.map(i => '- ' + i).join('\n')}` : 'Prüfung: keine Syntaxfehler, alle Dateien und Elemente gefunden.' };
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
    const out = (await module.exports.ddgResults(q)).slice(0, 8);
    if (!out.length) return { ok: false, summary: 'keine Ergebnisse', text: `Keine Suchergebnisse für "${q}".` };
    return { ok: true, summary: `„${q.slice(0, 40)}“: ${plural(out.length, 'Ergebnis', 'Ergebnisse')}`, text: `Suchergebnisse für "${q}":\n${out.map((x, i) => `${i + 1}. ${x.title}\n   ${x.url}\n   ${x.snippet}`).join('\n')}\nLies eine Seite genauer mit <tool name="fetch" url="…"/>.` };
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

module.exports = { list, tree, read, outline, search, check, domMap, move, copy, insert, fetchUrl, webSearch, ddgResults, cdnSearch, cdnQuery, memory, htmlToText, globToRe, syntax };
