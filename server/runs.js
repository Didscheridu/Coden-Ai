// Hintergrund-Läufe: eine KI-Antwort läuft auf dem Server zu Ende, auch wenn der Nutzer die Seite schließt,
// den Chat wechselt oder das Handy sperrt. Der Stand liegt in ai_runs; jedes Gerät kann sich wieder anhängen
// (live per SSE, solange die Verbindung steht, sonst per Abfrage) und holt die fertige Antwort ab ("claim").
const { getSql } = require('./db');

let waitUntil = () => {};
try { waitUntil = require('@vercel/functions').waitUntil; } catch (_) { /* lokal ohne Vercel */ }

const FLUSH_MS = 700;        // so oft wird der Stand höchstens in die Datenbank geschrieben
const HEARTBEAT_MS = 2000;   // Lebenszeichen (und Prüfung auf "Stopp"), auch wenn das Modell gerade still ist
const STALE_MS = 120_000;    // länger kein Lebenszeichen: der Server wurde beendet -> Lauf gilt als abgebrochen
const live = new Map();      // laufende Läufe dieser Server-Instanz

class Run {
  constructor(row, { isOwner = false } = {}) {
    this.id = Number(row.id); this.uid = row.uid; this.kind = row.kind; this.ref = row.ref; this.isOwner = isOwner;
    this.text = ''; this.think = { h: '', v: '', steps: [] }; this.agents = []; this.model = null; this.extra = {};
    this.ac = new AbortController(); this.subs = new Set(); this.timer = null; this.lastFlush = 0; this.flushing = null;
    this.status = 'running'; this.error = null;
    this.beat = setInterval(() => this.flush().catch(() => {}), HEARTBEAT_MS);
  }
  get signal() { return this.ac.signal; }
  // Fortsetzung in einer neuen Server-Ausführung: bisherigen Stand übernehmen
  restore(row) { this.text = row.text || ''; this.think = { h: '', v: '', steps: [], ...(row.think || {}) }; this.agents = row.agents || []; this.model = row.model || null; this.extra = (row.meta && row.meta.extra) || {}; return this; }
  // Etappe zu Ende, der Lauf geht in einer neuen Ausführung weiter: Stand sichern, aber NICHT abschließen
  async pause() {
    clearInterval(this.beat); clearTimeout(this.timer); this.timer = null;
    if (this.flushing) await this.flushing.catch(() => {});
    await this.flush().catch(() => {}); this.status = 'paused'; live.delete(this.id);
  }
  // Die nächste Etappe konnte doch nicht starten: in dieser Ausführung weiterlaufen
  unpause() { if (this.status !== 'paused') return; this.status = 'running'; live.set(this.id, this); this.beat = setInterval(() => this.flush().catch(() => {}), HEARTBEAT_MS); }
  emit(ev) { for (const s of this.subs) { try { s(ev); } catch (_) { /* Zuschauer weg */ } } }
  // Text anhängen (normale Antwort)
  delta(v) { if (!v) return; this.text += v; this.emit({ t: 'd', v }); this.schedule(); }
  // Ganzen Text ersetzen (Agenten setzen ihre Antwort aus mehreren Teilen zusammen)
  setText(t) { this.text = String(t || ''); this.emit({ t: 'r', v: this.text }); this.schedule(); }
  thinkStep(k) {
    if (!k) return; const th = this.think;
    if (k.h && k.h !== th.h) { if (th.h && !/^(Anfrage läuft|Modell antwortet langsam|Anderes Modell)/.test(th.h)) th.steps = [...th.steps.filter(s => s !== th.h), th.h].slice(-14); th.h = k.h; }
    th.v = k.v || '';
    this.emit({ t: 'k', h: k.h, v: k.v }); this.schedule();
  }
  setModel(m) { const id = m?.id || m; if (!id) return; this.model = id; if (this.isOwner) this.emit({ t: 'm', model: id }); this.schedule(); }
  setAgents(list) { this.agents = list; this.emit({ t: 'a', agents: list }); this.schedule(); }
  setExtra(o) { this.extra = { ...this.extra, ...o }; this.emit({ t: 'x', x: o }); this.schedule(); }
  schedule() {
    if (this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; this.flush().catch(() => {}); }, Math.max(0, FLUSH_MS - (Date.now() - this.lastFlush)));
  }
  async flush() {
    if (this.status !== 'running') return;
    if (this.flushing) return this.flushing;
    this.lastFlush = Date.now();
    this.flushing = (async () => {
      const rows = await getSql()`UPDATE ai_runs SET text = ${this.text}, think = ${JSON.stringify(this.think)}::jsonb, agents = ${JSON.stringify(this.agents)}::jsonb,
        model = ${this.model}, meta = meta || ${JSON.stringify({ extra: this.extra })}::jsonb, updated_at = now() WHERE id = ${this.id} RETURNING stop`;
      if (rows[0]?.stop && !this.ac.signal.aborted) this.ac.abort(); // jemand hat (auf irgendeinem Gerät) auf Stopp gedrückt
    })().finally(() => { this.flushing = null; });
    return this.flushing;
  }
  async finish(status, error, { claimed = false } = {}) {
    clearInterval(this.beat); clearTimeout(this.timer); this.timer = null;
    if (this.flushing) await this.flushing.catch(() => {});
    this.status = status; this.error = error || null;
    await getSql()`UPDATE ai_runs SET status = ${status}, error = ${this.error}, text = ${this.text}, think = ${JSON.stringify(this.think)}::jsonb,
      agents = ${JSON.stringify(this.agents)}::jsonb, model = ${this.model}, meta = meta || ${JSON.stringify({ extra: this.extra })}::jsonb,
      claimed = ${claimed}, updated_at = now() WHERE id = ${this.id}`;
    live.delete(this.id);
  }
}

// Legt einen Lauf an und startet job(run) im Hintergrund. Der Server arbeitet weiter, auch wenn niemand mehr zuschaut.
async function startRun({ uid, isOwner, kind, ref, meta = {} }, job) {
  const sql = getSql();
  const [row] = await sql`INSERT INTO ai_runs (uid, kind, ref, meta) VALUES (${uid}, ${kind}, ${String(ref).slice(0, 80)}, ${JSON.stringify(meta)}::jsonb) RETURNING *`;
  if (Math.random() < 0.05) sql`DELETE FROM ai_runs WHERE created_at < now() - interval '7 days'`.catch(() => {});
  const run = new Run(row, { isOwner }); live.set(run.id, run);
  return drive(run, job);
}
function drive(run, job) {
  const done = (async () => {
    try {
      const r = await job(run);
      if (r && r.continued) { run.continued = true; if (run.status === 'running') await run.pause(); return; } // nächste Etappe übernimmt
      await run.finish(run.signal.aborted ? 'stopped' : 'done', null, { claimed: run.subs.size > 0 });
    } catch (e) {
      const stopped = run.signal.aborted;
      if (!stopped) console.warn(`[run ${run.id}]`, e.message);
      await run.finish(stopped ? 'stopped' : 'error', stopped ? null : e.message, { claimed: run.subs.size > 0 }).catch(() => {});
    }
  })();
  waitUntil(done); // Vercel: Funktion nicht einfrieren, solange der Lauf noch arbeitet
  return { run, done };
}
// Einen laufenden Lauf in einer neuen Server-Ausführung fortsetzen (nächste Etappe)
async function resumeRun(id, { isOwner = false } = {}, job) {
  const [row] = await getSql()`SELECT * FROM ai_runs WHERE id = ${id} AND status = 'running'`;
  if (!row || live.has(Number(row.id))) return null;
  const run = new Run(row, { isOwner }).restore(row); live.set(run.id, run);
  if (row.stop) run.ac.abort();
  return drive(run, job);
}

// Hängt eine HTTP-Antwort als Live-Zuschauer (SSE) an einen Lauf. Schließt der Nutzer die Seite, läuft der Lauf weiter.
async function serveRun(res, run, done) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  const send = (o) => { if (!res.writableEnded && !res.destroyed) res.write(`data: ${JSON.stringify(o)}\n\n`); };
  const sub = (ev) => send(ev); run.subs.add(sub);
  const ping = setInterval(() => { if (!res.writableEnded && !res.destroyed) res.write(': ping\n\n'); }, 15000);
  res.on('close', () => { run.subs.delete(sub); clearInterval(ping); });
  send({ t: 'run', id: run.id });
  await done;
  clearInterval(ping); run.subs.delete(sub);
  if (run.continued) send({ t: 'cont', id: run.id }); // läuft in der nächsten Etappe weiter -> Client verfolgt per Abfrage
  else if (run.status === 'error') send({ t: 'e', error: run.error || 'Fehler', partial: !!run.text });
  else send({ t: 'done', status: run.status });
  if (!res.writableEnded) res.end();
}

const iso = (d) => (d instanceof Date ? d.toISOString() : d);
function safeMeta(m) {
  if (!m || typeof m !== 'object') return {};
  const { cont, ...rest } = m;
  return rest;
}
function shape(r, isOwner, from = 0) {
  const text = r.text || '';
  return { id: Number(r.id), kind: r.kind, ref: r.ref, status: r.status, from, len: text.length, text: text.slice(Math.max(0, Math.min(from, text.length))),
    think: r.think || {}, agents: r.agents || [], model: isOwner ? r.model : undefined, error: r.error, meta: safeMeta(r.meta), claimed: r.claimed,
    startedAt: iso(r.created_at), updatedAt: iso(r.updated_at) };
}
// Läuft ein Lauf laut Datenbank noch, obwohl der Server ihn längst nicht mehr bearbeitet? -> als abgebrochen markieren
async function settleStale(r) {
  if (r.status !== 'running' || live.has(Number(r.id))) return r;
  if (Date.now() - new Date(r.updated_at).getTime() < STALE_MS) return r;
  const [u] = await getSql()`UPDATE ai_runs SET status = 'error', error = 'Der Lauf wurde unterbrochen (Zeitlimit des Servers).' WHERE id = ${r.id} AND status = 'running' RETURNING *`;
  return u || r;
}

function runsRouter(requireAuth) {
  const express = require('express'); const { wrapRouter } = require('./util');
  const r = wrapRouter(express.Router());
  // Offene Läufe des Nutzers: laufen noch oder sind fertig, aber noch nicht abgeholt
  r.get('/', requireAuth, async (req, res) => {
    const kind = ['chat', 'app'].includes(req.query.kind) ? req.query.kind : 'chat';
    const rows = await getSql()`SELECT * FROM ai_runs WHERE uid = ${req.user.uid} AND kind = ${kind} AND created_at > now() - interval '2 days'
      AND (status = 'running' OR claimed = false) ORDER BY created_at DESC LIMIT 20`;
    const out = [];
    for (const row of rows) { const s = await settleStale(row); out.push({ ...shape(s, req.user.isOwner), text: undefined }); }
    res.json({ runs: out });
  });
  r.get('/:id', requireAuth, async (req, res) => {
    const id = parseInt(req.params.id, 10); if (!Number.isFinite(id)) return res.status(400).json({ error: 'Ungültig.' });
    const [row] = await getSql()`SELECT * FROM ai_runs WHERE id = ${id} AND uid = ${req.user.uid}`;
    if (!row) return res.status(404).json({ error: 'Lauf nicht gefunden.' });
    const from = Math.max(0, parseInt(req.query.from, 10) || 0);
    res.json(shape(await settleStale(row), req.user.isOwner, from));
  });
  // Fertige Antwort abholen: nur EIN Gerät bekommt sie (verhindert doppelte Nachrichten)
  r.post('/:id/claim', requireAuth, async (req, res) => {
    const id = parseInt(req.params.id, 10); if (!Number.isFinite(id)) return res.status(400).json({ error: 'Ungültig.' });
    const rows = await getSql()`UPDATE ai_runs SET claimed = true WHERE id = ${id} AND uid = ${req.user.uid} AND claimed = false AND status <> 'running' RETURNING *`;
    if (!rows.length) return res.json({ ok: false });
    res.json({ ok: true, run: shape(rows[0], req.user.isOwner) });
  });
  r.post('/:id/stop', requireAuth, async (req, res) => {
    const id = parseInt(req.params.id, 10); if (!Number.isFinite(id)) return res.status(400).json({ error: 'Ungültig.' });
    const rows = await getSql()`UPDATE ai_runs SET stop = true WHERE id = ${id} AND uid = ${req.user.uid} RETURNING id`;
    if (!rows.length) return res.status(404).json({ error: 'Lauf nicht gefunden.' });
    live.get(id)?.ac.abort();
    res.json({ ok: true });
  });
  return r;
}

module.exports = { startRun, resumeRun, serveRun, runsRouter, Run, _live: live };
