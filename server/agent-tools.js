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

function search(files, query, regex) {
  const q = String(query || ''); if (!q) return { ok: false, summary: 'keine Suche angegeben', text: 'Fehler: search braucht query="…".' };
  let re;
  try { re = regex === 'true' || regex === true ? new RegExp(q, 'i') : new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'); }
  catch (e) { return { ok: false, summary: 'ungültiger regulärer Ausdruck', text: 'Fehler im regulären Ausdruck: ' + e.message }; }
  const hits = []; const perFile = {};
  for (const n of Object.keys(files).sort()) {
    String(files[n]).split('\n').forEach((l, i) => { if (re.test(l)) { perFile[n] = (perFile[n] || 0) + 1; if (hits.length < MAX_HITS) hits.push(`${n}:${i + 1}: ${l.trim().slice(0, 200)}`); } });
  }
  const total = Object.values(perFile).reduce((a, b) => a + b, 0);
  return { ok: true, summary: `„${q.slice(0, 40)}“: ${plural(total, 'Treffer', 'Treffer')}${total ? ' in ' + plural(Object.keys(perFile).length, 'Datei', 'Dateien') : ''}`,
    text: total ? `Fundstellen für "${q}" (${total}${total > MAX_HITS ? ', die ersten ' + MAX_HITS : ''}):\n${hits.join('\n')}` : `Keine Fundstellen für "${q}".` };
}

function check(files) {
  const issues = Agent.check(files, { syntax });
  return { ok: !issues.length, issues, summary: issues.length ? plural(issues.length, 'Problem', 'Probleme') + ' gefunden' : 'keine Probleme', text: issues.length ? `Prüfung: ${issues.length} Problem(e):\n${issues.map(i => '- ' + i).join('\n')}` : 'Prüfung: keine Syntaxfehler, alle Dateien und Elemente gefunden.' };
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
async function ddgResults(query, { signal } = {}) {
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
    const out = (await ddgResults(q)).slice(0, 8);
    if (!out.length) return { ok: false, summary: 'keine Ergebnisse', text: `Keine Suchergebnisse für "${q}".` };
    return { ok: true, summary: `„${q.slice(0, 40)}“: ${plural(out.length, 'Ergebnis', 'Ergebnisse')}`, text: `Suchergebnisse für "${q}":\n${out.map((x, i) => `${i + 1}. ${x.title}\n   ${x.url}\n   ${x.snippet}`).join('\n')}\nLies eine Seite genauer mit <tool name="fetch" url="…"/>.` };
  } catch (e) { return { ok: false, summary: 'Suche nicht erreichbar', text: `Die Websuche ist gerade nicht erreichbar (${e.message}). Arbeite mit deinem Wissen weiter.` }; }
}

// Projektgedächtnis (wie CLAUDE.md / AGENTS.md / GEMINI.md)
function memory(files, note) {
  const n = String(note || '').trim().slice(0, 600); if (!n) return { ok: false, summary: 'leere Notiz', text: 'Fehler: memory braucht einen Text.' };
  const cur = String(files['CODEN.md'] || '# Projekt-Gedächtnis (von Coden gepflegt)\n');
  if (cur.length > 6000) return { ok: false, summary: 'Gedächtnis ist voll', text: 'CODEN.md ist voll – fasse sie mit einem <file path="CODEN.md">-Block kürzer zusammen.' };
  return { ok: true, summary: 'gemerkt in CODEN.md', text: 'Notiz in CODEN.md gespeichert.', set: { 'CODEN.md': cur.replace(/\s*$/, '') + '\n- ' + n.replace(/\n+/g, ' ') + '\n' } };
}

module.exports = { list, read, search, check, fetchUrl, webSearch, ddgResults, memory, htmlToText, globToRe, syntax };
