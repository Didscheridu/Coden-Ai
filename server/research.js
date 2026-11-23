// Deep Research: Coden plant die Suche, liest die besten Seiten und schreibt einen Bericht mit Quellen.
// Suche: eigener Brave- oder Tavily-Key (Einstellungen → Recherche), sonst die Gratis-Suche (DuckDuckGo).
// Läuft als normaler Chat-Lauf (Hintergrund, Push am Ende) und für geplante Aufgaben.
const express = require('express');
const { getSql } = require('./db');
const { rateLimit } = require('./rateLimit');
const { wrapRouter } = require('./util');
const byok = require('./byok');
const Tools = require('./agent-tools');
const Push = require('./push');
const { generate, generateStream } = require('./ai');
const { Meter } = require('./usage');
const R = require('../shared/research-core');

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

// Welche Suche hat dieser Nutzer? Reihenfolge: Brave, Tavily. Ohne Key: null.
async function keysOf(uid) {
  const out = [];
  for (const id of Object.keys(SEARCH)) { const key = uid ? await byok.keyOf(uid, id) : null; if (key) out.push({ id, key }); }
  return out;
}
// eine Suche; Fehler eines Anbieters führen zum nächsten, am Ende zur Gratis-Suche
async function search(keys, q, n, signal, onWarn) {
  for (const k of keys) {
    try { return { results: await ENGINES[k.id](k.key, q, n, signal), via: k.id }; }
    catch (e) { if (signal?.aborted) throw e; onWarn?.(`${SEARCH[k.id].name}: ${e.status === 401 || e.status === 403 ? 'Key abgelehnt' : e.status === 429 ? 'Monatslimit erreicht' : e.message}`); }
  }
  try { return { results: (await Tools.ddgResults(q)).slice(0, n), via: 'ddg' }; }
  catch (e) { if (signal?.aborted) throw e; return { results: [], via: 'ddg', error: e.message }; }
}

// Seite lesen -> reiner Text (leer, wenn nicht erreichbar)
async function readPage(url, chars) {
  const r = await Tools.fetchUrl(url);
  if (!r.ok) return '';
  return String(r.text).replace(/^Inhalt von [^\n]*:\n/, '').replace(/\s*… \(gekürzt\)$/, '').slice(0, chars).trim();
}

// Aufgaben der Reihe nach in kleinen Gruppen ausführen
async function inGroups(items, size, fn) { const out = []; for (let i = 0; i < items.length; i += size) out.push(...await Promise.all(items.slice(i, i + size).map(fn))); return out; }

// ---------- Der Ablauf ----------
// opts: { user, tier, question, context, depth, effort, signal, meter, onStep({h,v}), onDelta(v), onThink }
// Gibt den fertigen Bericht (mit Quellenliste) zurück. onDelta bekommt den Bericht Stück für Stück, am Ende ersetzt der Rückgabewert alles.
async function runResearch({ user, tier, question, context = '', depth = 'normal', effort, signal, meter, onStep = () => {}, onDelta = () => {}, onThink }) {
  const D = R.depthOf(depth); const day = today();
  const q = String(question || '').trim(); if (q.length < 3) throw fail(400, 'Stell eine Frage, die Coden recherchieren soll.');
  const own = { uid: user.uid, isOwner: user.isOwner, signal, meter, effort };

  onStep({ h: 'Plane die Recherche …', v: q.slice(0, 120) });
  let queries;
  try { queries = R.parsePlan(await generate(tier, R.planPrompt(q, D.queries, day, context), { ...own, maxTokens: 700 }), q, D.queries); }
  catch (e) { if (signal?.aborted || e.limit) throw e; queries = R.parsePlan('', q, 1); }

  const keys = await keysOf(user.uid); const warned = new Set();
  const lists = await inGroups(queries, 3, async (query) => {
    onStep({ h: 'Suche im Web …', v: query });
    const r = await search(keys, query, D.perQuery, signal, (w) => { if (!warned.has(w)) { warned.add(w); onStep({ h: 'Hinweis zur Suche', v: w }); } });
    return r.results;
  });
  const merged = R.mergeResults(lists, { max: D.pages + 4 });
  if (!merged.length) {
    const hint = keys.length ? '' : ' Mit einem eigenen Such-Key (Einstellungen → Recherche) klappt das zuverlässiger.';
    return `Ich konnte im Web gerade nichts zu **${q.slice(0, 120)}** finden.${hint} Versuch es gleich noch einmal oder formuliere die Frage etwas anders.`;
  }

  // die besten Seiten lesen (der Rest bleibt als Ausschnitt dabei)
  const toRead = merged.slice(0, D.pages); const per = Math.min(D.pageChars, Math.floor(36000 / Math.max(1, toRead.length)));
  let done = 0;
  await inGroups(toRead, 3, async (s) => {
    if (signal?.aborted) return;
    onStep({ h: `Lese Quellen (${Math.min(++done, toRead.length)} von ${toRead.length}) …`, v: R.host(s.url) });
    try { s.text = await readPage(s.url, per); } catch (_) { s.text = ''; }
  });
  const sources = R.numberSources(merged);
  if (signal?.aborted) throw Object.assign(new Error('abgebrochen'), { name: 'AbortError' });

  onStep({ h: 'Schreibe den Bericht …', v: `${sources.length} Quellen, ${sources.filter(s => s.text).length} gelesen` });
  let streamed = '';
  const report = await generateStream(tier, R.reportPrompt(q, sources, day), { ...own, maxTokens: 6000, onThink, onDelta: (v) => { streamed += v; onDelta(v); } });
  const body = R.dropBadCites((typeof report === 'string' ? report : report?.text) || streamed).trim();
  return (body || 'Der Bericht ist leer geblieben. Versuch es bitte noch einmal.') + R.sourceList(sources, body);
}

// ---------- als Chat-Lauf ----------
const lastUser = (messages) => { for (let i = messages.length - 1; i >= 0; i--) if (messages[i].role === 'user') return messages[i].content; return ''; };
const contextOf = (messages) => {
  const turns = messages.filter(m => m.role !== 'system'); const prev = turns.slice(Math.max(0, turns.length - 5), -1);
  return prev.map(m => `${m.role === 'user' ? 'Nutzer' : 'Coden'}: ${String(m.content).replace(/\s+/g, ' ').slice(0, 500)}`).join('\n');
};
async function researchJob(run, state) {
  const { user, tier, messages, opts = {} } = state; const meter = new Meter(user, tier);
  try {
    const text = await runResearch({
      user, tier, question: lastUser(messages), context: contextOf(messages), depth: state.depth, effort: opts.effort, signal: run.signal, meter,
      onStep: (k) => run.thinkStep(k), onThink: (k) => run.thinkStep(k), onDelta: (v) => run.delta(v)
    });
    if (!run.signal.aborted && text !== run.text) run.setText(text); // Quellenliste anhängen, falsche Nummern raus
  } catch (e) {
    if (run.signal.aborted) return;
    if (e.limit) run.delta(`${run.text.trim() ? '\n\n' : ''}⚠️ ${e.message}`); else throw e;
  } finally { await meter.close(); }
  if (run.signal.aborted) return;
  if (run.subs.size === 0) await Push.notify(user.uid, { title: 'Deine Recherche ist fertig', body: Push.preview(run.text), url: '/#/chat', tag: 'chat-' + run.ref });
}

// ---------- Einstellungen: Such-Keys ----------
async function overview(uid) {
  const rows = await getSql()`SELECT provider, hint FROM user_provider_keys WHERE uid = ${uid} AND provider = ANY(${Object.keys(SEARCH)})`;
  const have = new Map(rows.map(r => [r.provider, r.hint]));
  return { providers: Object.entries(SEARCH).map(([id, p]) => ({ id, name: p.name, link: p.link, keyHint: p.keyHint, note: p.note, hasKey: have.has(id), hint: have.get(id) || null })), engine: Object.keys(SEARCH).find(id => have.has(id)) || 'ddg' };
}
function researchRouter(requireAuth) {
  const r = wrapRouter(express.Router());
  r.use(requireAuth, rateLimit('research-cfg', 60, 60));
  const prov = (req) => { if (!SEARCH[req.params.provider]) throw fail(400, 'Unbekannter Such-Anbieter.'); return req.params.provider; };
  r.get('/', async (req, res) => res.json(await overview(req.user.uid)));
  r.put('/keys/:provider', async (req, res) => {
    const p = prov(req); const key = typeof req.body?.key === 'string' ? req.body.key.trim() : '';
    if (key.length < 8 || key.length > 400 || /\s/.test(key)) throw fail(400, 'Das sieht nicht wie ein API-Key aus.');
    try { await ENGINES[p](key, 'Test', 1); } // Key gleich prüfen, damit Fehler sofort sichtbar sind
    catch (e) { throw fail(400, e.status === 401 || e.status === 403 || e.status === 422 ? `${SEARCH[p].name} lehnt diesen Key ab.` : e.status === 429 ? `${SEARCH[p].name}: Das Monatslimit ist schon erreicht.` : `${SEARCH[p].name} antwortet gerade nicht (${e.message}).`); }
    await getSql()`INSERT INTO user_provider_keys (uid, provider, key_enc, hint) VALUES (${req.user.uid}, ${p}, ${await byok.encrypt(key)}, ${byok.hintOf(key)})
      ON CONFLICT (uid, provider) DO UPDATE SET key_enc = EXCLUDED.key_enc, hint = EXCLUDED.hint, created_at = now()`;
    res.json(await overview(req.user.uid));
  });
  r.delete('/keys/:provider', async (req, res) => {
    const p = prov(req);
    await getSql()`DELETE FROM user_provider_keys WHERE uid = ${req.user.uid} AND provider = ${p}`;
    res.json(await overview(req.user.uid));
  });
  r.use((err, req, res, next) => { if (err.status) return res.status(err.status).json({ error: err.message }); console.error('[research]', err); res.status(500).json({ error: 'Serverfehler.' }); });
  return r;
}

module.exports = { runResearch, researchJob, researchRouter, search, keysOf, SEARCH, _engines: ENGINES };
