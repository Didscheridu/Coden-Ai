// server/websearch.js – Gratis-Websuche ohne eigenen Such-Key, mit mehreren Quellen hintereinander.
// Problem vorher: Nur DuckDuckGo (HTML-Seite). Von Vercel-Servern aus antwortet DuckDuckGo oft mit einer
// Bot-Sperre → „0 Ergebnisse“. Jetzt der Reihe nach, bis genug Treffer da sind:
//   1. Google-Suche über Gemini (Grounding mit Google Search, GOOGLE_API_KEY) – echte, aktuelle Google-Treffer
//      plus eine kurze Antwort mit Fakten (Spielpläne, Ergebnisse, Kurse …)
//   2. DuckDuckGo (HTML, dann Lite-Version)
//   3. Bing
//   4. Google News (RSS) – Nachrichten der letzten Tage
//   5. Wikipedia (de)
// Alle Adressen sind fest (keine Nutzer-URLs) → kein SSRF-Risiko. Jede Quelle hat ein eigenes Zeitlimit.
const Tools = require('./agent-tools');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';
const today = () => new Intl.DateTimeFormat('de-DE', { dateStyle: 'full', timeZone: 'Europe/Berlin' }).format(new Date());
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'", '#x27': "'" };
const decode = (s) => String(s || '').replace(/&(#\d+|#x[0-9a-f]+|[a-z]+\d*);/gi, (m, e) => {
  if (ENT[e.toLowerCase()] != null) return ENT[e.toLowerCase()];
  if (e[0] === '#') { const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) ? String.fromCodePoint(n) : m; }
  return m;
});
const strip = (s) => decode(String(s || '').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
const signalOf = (ms, outer) => (outer && AbortSignal.any ? AbortSignal.any([AbortSignal.timeout(ms), outer]) : AbortSignal.timeout(ms));

async function fetchText(url, { method = 'GET', body, headers = {}, ms = 9000, signal } = {}) {
  const r = await fetch(url, { method, body, redirect: 'follow', signal: signalOf(ms, signal), headers: { 'User-Agent': UA, 'Accept-Language': 'de-DE,de;q=0.9,en;q=0.7', Accept: 'text/html,application/xhtml+xml,application/json,application/rss+xml;q=0.9,*/*;q=0.8', ...headers } });
  if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status}`), { status: r.status });
  return r.text();
}
const cleanUrl = (u) => { try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.toString() : null; } catch (_) { return null; } };

// ---------- 1. Google über Gemini (Grounding) ----------
// Liefert die kurze Antwort (mit Fakten) als ersten Treffer und die Google-Quellen dahinter.
async function google(q, n, signal) {
  const key = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
  if (!key || process.env.CODEN_SEARCH_GOOGLE === 'off') return [];
  const model = process.env.CODEN_SEARCH_MODEL || 'gemini-3.5-flash-lite';
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST', signal: signalOf(20000, signal),
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: `Heute ist ${today()}. Suche bei Google nach: ${q}\nAntworte auf Deutsch in höchstens 8 kurzen Zeilen nur mit den gefundenen Fakten (Datum, Uhrzeit, Gegner, Ergebnis, Zahlen, Namen). Wenn du nichts Sicheres findest, sag das.` }] }],
      tools: [{ google_search: {} }],
      generationConfig: { temperature: 1, maxOutputTokens: 900 }
    })
  });
  let d = {}; try { d = await r.json(); } catch (_) { /* kein JSON */ }
  if (!r.ok) throw Object.assign(new Error(d.error?.message || `HTTP ${r.status}`), { status: r.status });
  const c = d.candidates?.[0];
  const answer = (c?.content?.parts || []).map(p => p.text || '').join('').trim();
  const chunks = (c?.groundingMetadata?.groundingChunks || []).map(x => x.web).filter(w => w && w.uri);
  if (!chunks.length) return []; // ohne Google-Quellen ist die Antwort nicht belegt
  // Google gibt Weiterleitungs-Links (vertexaisearch…/grounding-api-redirect/…) → echte Adresse holen
  const real = await Promise.all(chunks.slice(0, n).map(async (w) => {
    try {
      const h = await fetch(w.uri, { method: 'GET', redirect: 'manual', signal: signalOf(4000, signal), headers: { 'User-Agent': UA } });
      const loc = h.headers.get('location');
      return cleanUrl(loc) || w.uri;
    } catch (_) { return w.uri; }
  }));
  const out = [];
  const seen = new Set();
  chunks.slice(0, n).forEach((w, i) => {
    const url = real[i];
    if (seen.has(url)) return; seen.add(url);
    out.push({ title: w.title || new URL(url).hostname, url, snippet: '' });
  });
  if (answer) out.unshift({ title: `Google-Suche: ${q}`.slice(0, 120), url: 'https://www.google.com/search?' + new URLSearchParams({ q, hl: 'de' }), snippet: answer.slice(0, 1200), text: answer.slice(0, 2500), summary: true });
  return out;
}

// ---------- 2. DuckDuckGo ----------
const isBlocked = (html) => /anomaly-modal|challenge-form|bots use DuckDuckGo|unusual traffic|Please complete the following challenge/i.test(html);
function ddgLink(href) {
  let link = decode(href); const u = link.match(/[?&]uddg=([^&]+)/); if (u) link = decodeURIComponent(u[1]);
  if (link.startsWith('//')) link = 'https:' + link;
  return /duckduckgo\.com\/(y\.js|l\/\?)/.test(link) ? null : cleanUrl(link);
}
async function ddg(q, n, signal) {
  // die bisherige Abfrage (lässt sich in Tests ersetzen), dann POST an die HTML-Version, dann die Lite-Version
  try { const a = await Tools.ddgResults(q); if (a.length) return a.slice(0, n); } catch (e) { if (signal?.aborted) throw e; }
  const out = [];
  try {
    const html = await fetchText('https://html.duckduckgo.com/html/', { method: 'POST', body: new URLSearchParams({ q, kl: 'de-de' }).toString(), headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: 'https://html.duckduckgo.com/' }, signal });
    if (!isBlocked(html)) {
      // je Treffer: Link + Ausschnitt bis zum nächsten Treffer
      const parts = html.split(/(?=<a[^>]+class="result__a")/).filter(p => /class="result__a"/.test(p));
      for (const part of parts) {
        const a = part.match(/<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/); if (!a) continue;
        const sn = part.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/(?:a|div|td)>/);
        const url = ddgLink(a[1]); if (url && out.length < n) out.push({ title: strip(a[2]), url, snippet: strip(sn ? sn[1] : '') });
      }
    }
  } catch (e) { if (signal?.aborted) throw e; }
  if (out.length) return out;
  try {
    const html = await fetchText('https://lite.duckduckgo.com/lite/?' + new URLSearchParams({ q, kl: 'de-de' }), { signal });
    if (isBlocked(html)) return [];
    const links = [...html.matchAll(/<a[^>]+href="([^"]+)"[^>]*class=['"]result-link['"][^>]*>([\s\S]*?)<\/a>/g)];
    const snips = [...html.matchAll(/<td[^>]*class=['"]result-snippet['"][^>]*>([\s\S]*?)<\/td>/g)].map(x => strip(x[1]));
    links.forEach((m, i) => { const url = ddgLink(m[1]); if (url && out.length < n) out.push({ title: strip(m[2]), url, snippet: snips[i] || '' }); });
  } catch (e) { if (signal?.aborted) throw e; }
  return out;
}

// ---------- 3. Bing ----------
function bingLink(href) {
  const h = decode(href);
  const u = h.match(/[?&]u=a1([^&]+)/);
  if (u) { try { return cleanUrl(Buffer.from(u[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')); } catch (_) { return null; } }
  return cleanUrl(h);
}
async function bing(q, n, signal) {
  const html = await fetchText('https://www.bing.com/search?' + new URLSearchParams({ q, setlang: 'de', cc: 'DE', mkt: 'de-DE' }), { signal, headers: { Cookie: 'SRCHHPGUSR=ADLT=MODERATE' } });
  const out = [];
  for (const block of html.split(/<li class="b_algo"/).slice(1)) {
    const a = block.match(/<h2[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!a) continue;
    const url = bingLink(a[1]); if (!url || /bing\.com\//.test(url)) continue;
    const p = block.match(/<p[^>]*>([\s\S]*?)<\/p>/) || block.match(/class="b_caption"[^>]*>([\s\S]*?)<\/div>/);
    out.push({ title: strip(a[2]), url, snippet: strip(p ? p[1] : '').slice(0, 400) });
    if (out.length >= n) break;
  }
  return out;
}

// ---------- 4. Google News (RSS) ----------
async function news(q, n, signal) {
  const xml = await fetchText('https://news.google.com/rss/search?' + new URLSearchParams({ q, hl: 'de', gl: 'DE', ceid: 'DE:de' }), { signal });
  const out = [];
  for (const it of xml.split('<item>').slice(1)) {
    const get = (tag) => { const m = it.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`)); return m ? decode(m[1].replace(/^<!\[CDATA\[|\]\]>$/g, '')).trim() : ''; };
    const url = cleanUrl(get('link')); if (!url) continue;
    const date = get('pubDate'); const src = get('source');
    let when = '';
    try { when = date ? new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Berlin' }).format(new Date(date)) : ''; } catch (_) { /* egal */ }
    out.push({ title: strip(get('title')), url, snippet: [src, when].filter(Boolean).join(' · ') });
    if (out.length >= n) break;
  }
  return out;
}

// ---------- 5. Wikipedia ----------
async function wikipedia(q, n, signal) {
  const j = JSON.parse(await fetchText('https://de.wikipedia.org/w/api.php?' + new URLSearchParams({ action: 'query', list: 'search', srsearch: q, format: 'json', srlimit: String(Math.min(n, 5)), utf8: '1' }), { signal }));
  return (j.query?.search || []).map(s => ({ title: s.title, url: 'https://de.wikipedia.org/wiki/' + encodeURIComponent(s.title.replace(/ /g, '_')), snippet: strip(s.snippet) }));
}

const ENGINES = { google, ddg, bing, news, wikipedia };
const ORDER = ['google', 'ddg', 'bing', 'news', 'wikipedia'];
const NEWSY = /aktuell|heute|gestern|morgen|news|nachricht|neueste|spielplan|ergebnis|tabelle|spiel|liga|wahl|wetter|kurs|preis|202\d|live|termin/i;

// Gratis-Suche: Quellen der Reihe nach, bis genug Treffer da sind. Rückgabe { results, via, tried }
// opts.min: so viele Treffer sammeln, bevor aufgehört wird (Deep Research will viele verschiedene Webseiten)
async function freeSearch(q, n = 8, signal, onWarn, { min = 4 } = {}) {
  const all = []; const seen = new Set(); const via = []; const tried = [];
  const want = Math.min(n, Math.max(1, min));
  const enough = () => all.length >= want || (want <= 4 && all[0]?.summary && all.length >= 3);
  const order = NEWSY.test(q) ? ORDER : ORDER.filter(e => e !== 'news').concat('news');
  for (const id of order) {
    if (enough()) break;
    tried.push(id);
    try {
      const list = await ENGINES[id](q, n, signal);
      let added = 0;
      for (const r of list || []) {
        if (!r?.url || seen.has(r.url) || all.length >= n) continue;
        seen.add(r.url); all.push(r); added++;
      }
      if (added) via.push(id);
    } catch (e) {
      if (signal?.aborted) throw e;
      onWarn?.(`${id}: ${String(e.message).slice(0, 120)}`);
    }
  }
  return { results: all, via: via.join('+') || 'none', tried };
}

module.exports = { freeSearch, ENGINES, _parse: { bingLink, ddgLink, strip, decode } };
