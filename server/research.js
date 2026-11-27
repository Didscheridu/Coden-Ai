// Deep Research: Coden plant die Suche, liest die besten Seiten und schreibt einen Bericht mit Quellen.
// Suche: eigener Brave- oder Tavily-Key (Einstellungen → Recherche), sonst die Gratis-Suche (DuckDuckGo).
// Läuft als normaler Chat-Lauf (Hintergrund, Push am Ende) und für geplante Aufgaben.
const express = require('express');
const db = require('./db');
const { rateLimit } = require('./rateLimit');
const { wrapRouter } = require('./util');
const byok = require('./byok');
const Tools = require('./agent-tools');
const Push = require('./push');
const { generate, generateStream } = require('./ai');
const { Meter } = require('./usage');
const R = require('../shared/research-core');
const Free = require('./websearch');

const SEARCH = {
  brave: { name: 'Brave Search', link: 'https://brave.com/search/api/', keyHint: 'BSA…', note: 'Gratis-Plan mit 2000 Suchen im Monat.' },
  tavily: { name: 'Tavily', link: 'https://app.tavily.com/', keyHint: 'tvly-…', note: 'Gratis-Plan mit 1000 Suchen im Monat.' }
};
const fail = (status, message) => Object.assign(new Error(message), { status });
const today = () => new Intl.DateTimeFormat('de-DE', { dateStyle: 'full', timeZone: 'Europe/Berlin' }).format(new Date());

// ---------- Suche ----------
async function jsonFetch(url, opts, signal) {
  const r = await fetch(url, { ...opts, signal: AbortSignal.any([AbortSignal.timeout(15000), ...(signal ? [signal] : [])]) });
  if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status}`), { status: r.status });
  return r.json();
}
async function braveSearch(key, q, n, signal) {
  const j = await jsonFetch('https://api.search.brave.com/res/v1/web/search?' + new URLSearchParams({ q, count: String(Math.min(n, 20)), search_lang: 'de', country: 'de', safesearch: 'moderate' }), { headers: { Accept: 'application/json', 'X-Subscription-Token': key } }, signal);
  return (j.web?.results || []).map(r => ({ title: r.title, url: r.url, snippet: String(r.description || '').replace(/<[^>]+>/g, '') }));
}
async function tavilySearch(key, q, n, signal) {
  const j = await jsonFetch('https://api.tavily.com/search', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key }, body: JSON.stringify({ query: q, max_results: Math.min(n, 20), search_depth: 'basic' }) }, signal);
  return (j.results || []).map(r => ({ title: r.title, url: r.url, snippet: r.content }));
}
const ENGINES = { brave: braveSearch, tavily: tavilySearch };

// Such-Keys liegen verschlüsselt in user_search_keys/{uid}__{provider}
const keyPath = (uid, p) => `user_search_keys/${uid}__${p}`;
async function searchKeyOf(uid, p) {
  const r = await db.getDoc(keyPath(uid, p)).catch(() => null);
  if (!r?.key_enc) return null;
  try { return await byok.decrypt(r.key_enc); } catch (e) { console.warn('[research] Key nicht lesbar:', e.message); return null; }
}
// Welche Suche hat dieser Nutzer? Reihenfolge: eigener Brave-/Tavily-Key, dann die Keys des Servers
// (BRAVE_API_KEY / TAVILY_API_KEY in Vercel, gelten für alle Nutzer). Ohne Key: leer (dann Gratis-Suche).
const ENV_KEYS = { brave: 'BRAVE_API_KEY', tavily: 'TAVILY_API_KEY' };
async function keysOf(uid) {
  const out = [];
  for (const id of Object.keys(SEARCH)) { const key = uid ? await searchKeyOf(uid, id) : null; if (key) out.push({ id, key }); }
  for (const [id, env] of Object.entries(ENV_KEYS)) { const key = process.env[env]; if (key && !out.some(k => k.id === id)) out.push({ id, key, server: true }); }
  return out;
}
// eine Suche; Fehler eines Anbieters führen zum nächsten, am Ende zur Gratis-Suche
async function search(keys, q, n, signal, onWarn, opts = {}) {
  for (const k of keys) {
    try { return { results: await ENGINES[k.id](k.key, q, n, signal), via: k.id }; }
    catch (e) { if (signal?.aborted) throw e; onWarn?.(`${SEARCH[k.id].name}: ${e.status === 401 || e.status === 403 ? 'Key abgelehnt' : e.status === 429 ? 'Monatslimit erreicht' : e.message}`); }
  }
  // Gratis: Google (über Gemini), DuckDuckGo, Bing, Google News, Wikipedia – der Reihe nach (server/websearch.js)
  try { const r = await Free.freeSearch(q, n, signal, undefined, opts); return { results: r.results, via: r.via === 'none' ? 'ddg' : r.via }; }
  catch (e) { if (signal?.aborted) throw e; return { results: [], via: 'ddg', error: e.message }; }
}
// Die Google-Zusammenfassung (Fakten aus der Google-Suche) hat ihren Text schon – nicht als Seite neu lesen
const withSummary = (merged, lists) => {
  const sum = new Map(); for (const l of lists) for (const r of l || []) if (r?.summary && r.text) sum.set(r.url, r.text);
  for (const s of merged) if (sum.has(s.url)) { s.text = sum.get(s.url); s.summary = true; }
  merged.sort((a, b) => Number(!!b.summary) - Number(!!a.summary));
  return merged;
};

// Seite lesen -> reiner Text (leer, wenn nicht erreichbar)
async function readPage(url, chars) {
  const r = await Tools.fetchUrl(url);
  if (!r.ok) return '';
  return String(r.text).replace(/^Inhalt von [^\n]*:\n/, '').replace(/\s*… \(gekürzt\)$/, '').slice(0, chars).trim();
}

// Aufgaben der Reihe nach in kleinen Gruppen ausführen
async function inGroups(items, size, fn) { const out = []; for (let i = 0; i < items.length; i += size) out.push(...await Promise.all(items.slice(i, i + size).map(fn))); return out; }

// ---------- Der Ablauf (ab 27.11.: Agenten, immer Coden Ultra) ----------
// Recherchen laufen IMMER über Coden Ultra – für alle Nutzer, auch wenn Ultra im Chat gesperrt ist (Wunsch von Kayden).
const RESEARCH_TIER = 'ultra';
const intEnv = (name, def) => { const n = parseInt(process.env[name], 10); return Number.isFinite(n) && n >= 0 ? n : def; };
const READ_MS = () => intEnv('CODEN_RESEARCH_READ_MS', 120_000);     // so lange wird gesucht und gelesen
const NOTES_MS = () => intEnv('CODEN_RESEARCH_NOTES_MS', 75_000);    // Höchstdauer für die Notizen eines Agenten
const SPLIT_MS = () => intEnv('CODEN_RESEARCH_SPLIT_MS', 90_000);    // danach schreibt eine neue Etappe den Bericht (Vercel: 300 s)
const PAGE_MS = 10_000;
const withTimeout = (p, ms) => { let t; return Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => rej(new Error('Zeitüberschreitung')), ms); })]).finally(() => clearTimeout(t)); };

// Phase 1: planen, suchen, Webseiten prüfen, Notizen der Agenten. Ergebnis ist klein genug für die nächste Etappe.
async function collect({ user, question, context = '', depth = 'normal', signal, meter, onStep = () => {} }) {
  const D = R.depthOf(depth); const day = today();
  const q = String(question || '').trim(); if (q.length < 3) throw fail(400, 'Stell eine Frage, die Coden recherchieren soll.');
  const own = { uid: user.uid, isOwner: user.isOwner, signal, meter };
  const started = Date.now(); const deadline = started + READ_MS();

  onStep({ h: `Plane die Recherche (${D.agents} Agent${D.agents === 1 ? '' : 'en'}, Ziel: ${D.pages} Webseiten) …`, v: q.slice(0, 120) });
  let plan;
  try { plan = R.parseAgentPlan(await generate(RESEARCH_TIER, R.agentPlanPrompt(q, D.agents, D.queries, day, context), { ...own, maxTokens: 1200 }), q, D.agents, D.queries); }
  catch (e) { if (signal?.aborted || e.limit) throw e; plan = R.parseAgentPlan('', q, D.agents, D.queries); }
  plan.forEach((a, i) => onStep({ h: `Agent ${i + 1}: ${a.focus}`, v: a.queries.slice(0, 3).join(' · ') }));

  const keys = await keysOf(user.uid); const warned = new Set();
  const warn = (w) => { if (!warned.has(w)) { warned.add(w); onStep({ h: 'Hinweis zur Suche', v: w }); } };
  const terms = R.termsOf([q, ...plan.flatMap(a => a.queries)].join(' '));
  const seen = new Set(); // dieselbe Seite prüft nur ein Agent
  const perAgent = Math.ceil(D.pages / plan.length);
  const prog = { per: plan.map(() => 0), last: 0 };
  const tell = (force) => {
    if (!force && Date.now() - prog.last < 700) return; prog.last = Date.now();
    const total = prog.per.reduce((a, b) => a + b, 0);
    onStep({ h: `Prüfe Webseiten (${total} von ${D.pages}) …`, v: prog.per.map((n, i) => `Agent ${i + 1}: ${n}`).join(' · ') });
  };

  const runAgent = async (a, i) => {
    // 1) suchen, bis genug Webseiten im Topf sind (+40 % Reserve für Seiten, die nicht laden)
    const pool = []; const used = new Set(); const want = Math.ceil(perAgent * 1.4);
    let todo = [...a.queries]; let round = 0;
    const add = (list) => {
      for (const r of list || []) {
        if (!r || !/^https?:\/\//i.test(r.url || '')) continue;
        const k = R.norm(r.url); if (seen.has(k)) continue; seen.add(k);
        pool.push({ title: String(r.title || R.host(r.url)).replace(/\s+/g, ' ').trim().slice(0, 160), url: r.url, snippet: String(r.snippet || '').replace(/\s+/g, ' ').slice(0, 300), summary: !!(r.summary && r.text), text: r.summary ? r.text : '' });
      }
    };
    while (pool.length < want && Date.now() < deadline && !signal?.aborted) {
      if (!todo.length) { if (++round > R.VARIANT_ROUNDS) break; todo = a.queries.flatMap(x => R.queryVariants(x, round)).filter(x => !used.has(x)).slice(0, 6); if (!todo.length) break; }
      const batch = todo.splice(0, 3);
      batch.forEach(x => used.add(x));
      onStep({ h: `Agent ${i + 1} sucht …`, v: batch.join(' · ') });
      const lists = await Promise.all(batch.map(x => search(keys, x, D.perQuery, signal, warn, { min: D.perQuery }).then(r => r.results).catch(() => [])));
      lists.forEach(add);
    }
    // 2) Webseiten prüfen: mehrere gleichzeitig, bis das Ziel erreicht ist oder die Zeit um ist
    const checked = []; let next = 0;
    const worker = async () => {
      while (next < pool.length && checked.length < perAgent && Date.now() < deadline && !signal?.aborted) {
        const s = pool[next++];
        let text = s.summary ? s.text : '';
        if (!text) { try { text = await withTimeout(readPage(s.url, 14000), PAGE_MS); } catch (_) { text = ''; } }
        if (!text || text.length < 200 || checked.length >= perAgent) continue;
        const best = R.bestPassages(text, terms, 1100);
        checked.push({ title: s.title, url: s.url, snippet: s.snippet, excerpt: best.text, score: best.score + (s.summary ? 5 : 0) });
        prog.per[i] = checked.length; tell();
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
    return { focus: a.focus, queries: [...used], checked: checked.sort((x, y) => y.score - x.score) };
  };
  const agents = await Promise.all(plan.map(runAgent));
  if (signal?.aborted) throw Object.assign(new Error('abgebrochen'), { name: 'AbortError' });
  tell(true);

  // fortlaufende Nummern über alle Agenten
  let n = 0; for (const a of agents) for (const s of a.checked) s.n = ++n;
  const sources = agents.flatMap(a => a.checked);
  const searched = agents.reduce((x, a) => x + a.queries.length, 0);
  if (!sources.length) return { question: q, depth, agents: [], sources: [], checked: 0, searched };

  // 3) jeder Agent schreibt Notizen (gleichzeitig, mit Zeitgrenze; zur Not aus den Auszügen)
  onStep({ h: `${agents.length === 1 ? 'Der Agent fasst' : 'Die Agenten fassen'} zusammen …`, v: `${sources.length} Webseiten geprüft` });
  const noted = await Promise.all(agents.map(async (a, i) => {
    const top = a.checked.slice(0, D.keep);
    let notes = '';
    if (top.length) {
      try {
        const sig = AbortSignal.any([AbortSignal.timeout(NOTES_MS()), ...(signal ? [signal] : [])]);
        const out = await generate(RESEARCH_TIER, R.agentNotesPrompt(q, a.focus, top, day, i + 1), { ...own, signal: sig, maxTokens: 2500 });
        notes = String(typeof out === 'string' ? out : out?.text || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
      } catch (e) { if (signal?.aborted || e.limit) throw e; notes = ''; }
      if (!/\[\d{1,3}\]/.test(notes)) notes = R.fallbackNotes(top);
    }
    onStep({ h: `Agent ${i + 1} ist fertig`, v: `${a.checked.length} Webseiten geprüft` });
    return { focus: a.focus, notes: notes.slice(0, 12000), count: a.checked.length };
  }));
  return { question: q, depth, agents: noted, checked: sources.length, searched, sources: sources.map(s => ({ n: s.n, title: s.title, url: s.url })) };
}

// Phase 2: der Bericht (Ultra); die Quellenliste hängt der Server an
async function write({ user, collected, signal, meter, onStep = () => {}, onDelta = () => {}, onThink }) {
  const c = collected; const q = c.question;
  if (!c.checked) {
    const keys = await keysOf(user.uid);
    return `Ich konnte im Web gerade keine passenden Webseiten zu **${q.slice(0, 120)}** prüfen.${keys.length ? '' : ' Mit einem eigenen Such-Key (Einstellungen → Recherche) klappt das zuverlässiger.'} Versuch es gleich noch einmal oder formuliere die Frage etwas anders.`;
  }
  onStep({ h: 'Schreibe den Bericht mit Coden Ultra …', v: `${c.checked} Webseiten geprüft · ${c.agents.length} Agent${c.agents.length === 1 ? '' : 'en'}` });
  let streamed = '';
  const report = await generateStream(RESEARCH_TIER, R.finalReportPrompt(q, c.agents, c.sources, today(), { checked: c.checked }), { uid: user.uid, isOwner: user.isOwner, signal, meter, maxTokens: 7000, onThink, onDelta: (v) => { streamed += v; onDelta(v); } });
  const body = R.dropBadCites((typeof report === 'string' ? report : report?.text) || streamed, c.sources.length).trim();
  return (body || 'Der Bericht ist leer geblieben. Versuch es bitte noch einmal.') + R.sourceList(c.sources, body, { checked: c.checked, agents: c.agents.length });
}

// Alles am Stück (z. B. geplante Aufgaben). Ein übergebenes tier wird ignoriert: Recherchen laufen immer über Coden Ultra.
async function runResearch({ user, question, context = '', depth = 'normal', signal, meter, onStep = () => {}, onDelta = () => {}, onThink }) {
  const collected = await collect({ user, question, context, depth, signal, meter, onStep });
  return write({ user, collected, signal, meter, onStep, onDelta, onThink });
}

// Für Hintergrund-Läufe (Chat und Research-Seite): dauert das Prüfen lange, schreibt eine zweite Etappe den Bericht.
// state.collected ist gesetzt, wenn dies schon die zweite Etappe ist. Rückgabe: { continued: true } oder { text }.
async function phasedResearch(run, state, { question, context = '' }) {
  const { user } = state; const meter = new Meter(user, RESEARCH_TIER);
  const started = Date.now();
  try {
    let collected = state.collected;
    if (!collected) {
      collected = await collect({ user, question, context, depth: state.depth, signal: run.signal, meter, onStep: (k) => run.thinkStep(k) });
      const leg = state.leg || 1;
      if (collected.checked && Date.now() - started >= SPLIT_MS() && !run.ephemeral && state.self && leg < 3 && !run.signal.aborted) {
        await meter.close();
        run.thinkStep({ h: 'Webseiten geprüft – der Bericht wird in einer neuen Etappe geschrieben …', v: `${collected.checked} Webseiten` });
        const { continueLeg } = require('./chat-run');
        if (await continueLeg(run, { ...state, collected, leg: leg + 1 })) return { continued: true };
      }
    }
    const text = await write({ user, collected, signal: run.signal, meter, onStep: (k) => run.thinkStep(k), onThink: (k) => run.thinkStep(k), onDelta: (v) => run.delta(v) });
    return { text, collected };
  } finally { await meter.close(); }
}

// ---------- als Chat-Lauf ----------
const lastUser = (messages) => { for (let i = messages.length - 1; i >= 0; i--) if (messages[i].role === 'user') return messages[i].content; return ''; };
const contextOf = (messages) => {
  const turns = messages.filter(m => m.role !== 'system'); const prev = turns.slice(Math.max(0, turns.length - 5), -1);
  return prev.map(m => `${m.role === 'user' ? 'Nutzer' : 'Coden'}: ${String(m.content).replace(/\s+/g, ' ').slice(0, 500)}`).join('\n');
};
async function researchJob(run, state) {
  const { user, messages } = state;
  const question = lastUser(messages);
  try {
    const r = await phasedResearch(run, { ...state, job: 'research' }, { question, context: contextOf(messages) });
    if (r.continued) return r;
    if (!run.signal.aborted && r.text !== run.text) run.setText(r.text); // Quellenliste anhängen, falsche Nummern raus
    if (!run.signal.aborted && !state.temp) await require('./research-reports').saveFinished(user, { question, depth: state.depth, origin: 'chat', text: r.text });
  } catch (e) {
    if (run.signal.aborted) return;
    if (e.limit) run.delta(`${run.text.trim() ? '\n\n' : ''}⚠️ ${e.message}`); else throw e;
  }
  if (run.signal.aborted) return;
  if (run.subs.size === 0) await Push.notify(user.uid, { title: 'Deine Recherche ist fertig', body: Push.preview(run.text), url: '/#/chat', tag: 'chat-' + run.ref });
}

// ---------- Websuche für den normalen Chat ----------
// Das Modell fragt im Chat <web_search>…</web_search>, der Client ruft hier an. read: die besten Seiten zusätzlich lesen.
async function quickSearch(uid, q, { read = true, n = 6, signal } = {}) {
  const keys = await keysOf(uid); const warn = [];
  const r = await search(keys, q, n, signal, (w) => warn.push(w));
  const list = withSummary(R.mergeResults([r.results], { max: n }), [r.results]);
  if (read) await inGroups(list.filter(s => !s.summary).slice(0, 3), 3, async (s) => { try { s.text = await readPage(s.url, 2500); } catch (_) { s.text = ''; } });
  return { results: list.map(s => ({ title: s.title, url: s.url, snippet: s.snippet, text: s.text || '' })), via: r.via, warn };
}

// ---------- Einstellungen: Such-Keys ----------
async function overview(uid) {
  const rows = await Promise.all(Object.keys(SEARCH).map(async (p) => [p, await db.getDoc(keyPath(uid, p)).catch(() => null)]));
  const have = new Map(rows.filter(([, d]) => d).map(([p, d]) => [p, d.hint || null]));
  return { providers: Object.entries(SEARCH).map(([id, p]) => ({ id, name: p.name, link: p.link, keyHint: p.keyHint, note: p.note, hasKey: have.has(id), hint: have.get(id) || null })), engine: Object.keys(SEARCH).find(id => have.has(id)) || 'ddg', server: Object.entries(ENV_KEYS).filter(([, env]) => !!process.env[env]).map(([id]) => id), google: !!(process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY) && process.env.CODEN_SEARCH_GOOGLE !== 'off' };
}
function researchRouter(requireAuth) {
  const r = wrapRouter(express.Router());
  r.use(requireAuth, rateLimit('research-cfg', 60, 60));
  const prov = (req) => { if (!SEARCH[req.params.provider]) throw fail(400, 'Unbekannter Such-Anbieter.'); return req.params.provider; };
  r.get('/', async (req, res) => res.json(await overview(req.user.uid)));
  r.post('/search', rateLimit('websearch', 40, 600), async (req, res) => {
    const q = String(req.body?.q || '').replace(/\s+/g, ' ').trim().slice(0, 200);
    if (q.length < 2) throw fail(400, 'Leere Suche.');
    res.json(await quickSearch(req.user.uid, q, { read: req.body?.read !== false, signal: AbortSignal.timeout(25000) }));
  });
  r.put('/keys/:provider', async (req, res) => {
    const p = prov(req); const key = typeof req.body?.key === 'string' ? req.body.key.trim() : '';
    if (key.length < 8 || key.length > 400 || /\s/.test(key)) throw fail(400, 'Das sieht nicht wie ein API-Key aus.');
    try { await ENGINES[p](key, 'Test', 1); } // Key gleich prüfen, damit Fehler sofort sichtbar sind
    catch (e) { throw fail(400, e.status === 401 || e.status === 403 || e.status === 422 ? `${SEARCH[p].name} lehnt diesen Key ab.` : e.status === 429 ? `${SEARCH[p].name}: Das Monatslimit ist schon erreicht.` : `${SEARCH[p].name} antwortet gerade nicht (${e.message}).`); }
    await db.setDoc(keyPath(req.user.uid, p), { uid: req.user.uid, provider: p, key_enc: await byok.encrypt(key), hint: '…' + key.slice(-4), created_at: db.nowIso() });
    res.json(await overview(req.user.uid));
  });
  r.delete('/keys/:provider', async (req, res) => {
    const p = prov(req);
    await db.deleteDoc(keyPath(req.user.uid, p));
    res.json(await overview(req.user.uid));
  });
  require('./research-reports').mountReports(r); // Research-Bibliothek: /api/research/reports …
  r.use((err, req, res, next) => { if (err.status) return res.status(err.status).json({ error: err.message }); console.error('[research]', err); res.status(500).json({ error: 'Serverfehler.' }); });
  return r;
}

module.exports = { runResearch, researchJob, phasedResearch, collect, write, researchRouter, quickSearch, search, keysOf, SEARCH, RESEARCH_TIER, _engines: ENGINES };
