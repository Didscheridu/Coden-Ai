// Hintergrund-Läufe: eine KI-Antwort läuft auf dem Server zu Ende, auch wenn die Seite geschlossen wird.
// Der Stand liegt in Firestore (ai_runs/{id}); jedes Gerät kann sich wieder anhängen und die fertige Antwort abholen ("claim").
const db = require('./db');

let waitUntil = () => {};
try { waitUntil = require('@vercel/functions').waitUntil; } catch (_) { /* lokal ohne Vercel */ }

const FLUSH_MS = 1500;       // so oft wird der Stand höchstens nach Firestore geschrieben (Firestore-Gratis-Kontingent schonen)
const HEARTBEAT_MS = 4000;   // Lebenszeichen (und Prüfung auf "Stopp"), auch wenn das Modell gerade still ist
const STALE_MS = 300_000;    // länger kein Lebenszeichen: Lauf gilt als abgebrochen
const live = new Map();      // laufende Läufe dieser Server-Instanz

class Run {
  constructor(row, { isOwner = false, dbCtx } = {}) {
    this.id = Number(row.id); this.uid = row.uid; this.kind = row.kind; this.ref = row.ref; this.isOwner = isOwner;
    this.dbCtx = dbCtx || db.getDbContext();
    this.createdAt = row.created_at || db.nowIso(); this.updatedAt = row.updated_at || this.createdAt;
    this.meta = (row.meta && typeof row.meta === 'object') ? { ...row.meta } : {};
    this.text = ''; this.think = { h: '', v: '', steps: [] }; this.agents = []; this.model = null; this.extra = {};
    this.ac = new AbortController(); this.subs = new Set(); this.timer = null; this.lastFlush = 0; this.flushing = null;
    this.status = 'running'; this.error = null;
    this.beat = setInterval(() => this.flush().catch(() => {}), HEARTBEAT_MS);
  }
  get signal() { return this.ac.signal; }
  restore(row) {
    this.text = row.text || '';
    this.think = { h: '', v: '', steps: [], ...(row.think || {}) };
    this.agents = row.agents || [];
    this.model = row.model || null;
    this.meta = (row.meta && typeof row.meta === 'object') ? { ...row.meta } : {};
    this.extra = this.meta.extra || {};
    return this;
  }
  async pause() {
    clearInterval(this.beat); clearTimeout(this.timer); this.timer = null;
    if (this.flushing) await this.flushing.catch(() => {});
    await this.flush().catch(() => {}); this.status = 'paused'; live.delete(this.id);
  }
  unpause() {
    if (this.status !== 'paused') return;
    this.status = 'running'; live.set(this.id, this);
    this.beat = setInterval(() => this.flush().catch(() => {}), HEARTBEAT_MS);
  }
  emit(ev) { for (const s of this.subs) { try { s(ev); } catch (_) { /* Zuschauer weg */ } } }
  delta(v) { if (!v) return; this.text += v; this.emit({ t: 'd', v }); this.schedule(); }
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
    if (this.status !== 'running' || this.ephemeral) return;
    if (this.flushing) return this.flushing;
    this.lastFlush = Date.now();
    this.updatedAt = db.nowIso();
    this.flushing = db.runWithDbContext(this.dbCtx, async () => {
      const nextMeta = { ...this.meta, extra: this.extra };
      const updated = await db.updateDoc(`ai_runs/${this.id}`, {
        text: this.text,
        think: this.think,
        agents: this.agents,
        model: this.model,
        meta: nextMeta,
        updated_at: this.updatedAt
      });
      if (updated?.stop && !this.ac.signal.aborted) this.ac.abort();
    }).finally(() => { this.flushing = null; });
    return this.flushing;
  }
  async finish(status, error, { claimed = false } = {}) {
    clearInterval(this.beat); clearTimeout(this.timer); this.timer = null;
    if (this.flushing) await this.flushing.catch(() => {});
    this.status = status; this.error = error || null;
    this.updatedAt = db.nowIso();
    if (this.ephemeral) { live.delete(this.id); return; }
    await db.runWithDbContext(this.dbCtx, () => db.updateDoc(`ai_runs/${this.id}`, {
      status,
      error: this.error,
      text: this.text,
      think: this.think,
      agents: this.agents,
      model: this.model,
      meta: { ...this.meta, extra: this.extra },
      claimed,
      updated_at: this.updatedAt
    }));
    live.delete(this.id);
  }
}

async function startRun({ uid, isOwner, kind, ref, meta = {} }, job) {
  const id = db.nextId();
  const now = db.nowIso();
  // Ist die Datenbank nicht erreichbar (z. B. Tageskontingent aufgebraucht), läuft die Antwort trotzdem –
  // nur im Speicher dieser Instanz, ohne Wiederaufnahme nach dem Schließen.
  let ephemeral = false;
  const row = await db.createDoc(`ai_runs/${id}`, {
    id,
    uid,
    kind,
    ref: String(ref).slice(0, 80),
    status: 'running',
    text: '',
    think: { h: '', v: '', steps: [] },
    agents: [],
    model: null,
    error: null,
    meta: meta || {},
    stop: false,
    claimed: false,
    created_at: now,
    updated_at: now
  }).catch((e) => { console.warn('[runs] ohne Datenbank weiter:', e.message); ephemeral = true; return { id, uid, kind, ref: String(ref).slice(0, 80), meta: meta || {} }; });
  if (!ephemeral && Math.random() < 0.05) {
    const cutoff = Date.now() - 7 * 24 * 3600_000;
    db.runQuery('ai_runs', { where: [['uid', '==', uid]] }).then(async (list) => {
      for (const item of list) {
        if (new Date(item.created_at).getTime() < cutoff) await db.deleteDoc(`ai_runs/${item.id}`).catch(() => {});
      }
    }).catch(() => {});
  }
  const run = new Run(row, { isOwner, dbCtx: db.getDbContext() });
  if (ephemeral) { run.ephemeral = true; clearInterval(run.beat); }
  live.set(run.id, run);
  return drive(run, job);
}

function drive(run, job) {
  const done = db.runWithDbContext(run.dbCtx, async () => {
    try {
      const r = await job(run);
      if (r && r.continued) { run.continued = true; if (run.status === 'running') await run.pause(); return; }
      await run.finish(run.signal.aborted ? 'stopped' : 'done', null, { claimed: run.subs.size > 0 });
    } catch (e) {
      const stopped = run.signal.aborted;
      if (!stopped) console.warn(`[run ${run.id}]`, e.message);
      await run.finish(stopped ? 'stopped' : 'error', stopped ? null : e.message, { claimed: run.subs.size > 0 }).catch(() => {});
    }
  });
  waitUntil(done);
  return { run, done };
}

async function resumeRun(id, { isOwner = false } = {}, job) {
  const row = await db.getDoc(`ai_runs/${id}`);
  if (!row || row.status !== 'running' || live.has(Number(row.id))) return null;
  const run = new Run(row, { isOwner, dbCtx: db.getDbContext() }).restore(row);
  live.set(run.id, run);
  if (row.stop) run.ac.abort();
  return drive(run, job);
}

async function serveRun(res, run, done) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  const send = (o) => { if (!res.writableEnded && !res.destroyed) res.write(`data: ${JSON.stringify(o)}\n\n`); };
  const sub = (ev) => send(ev); run.subs.add(sub);
  const ping = setInterval(() => { if (!res.writableEnded && !res.destroyed) res.write(': ping\n\n'); }, 10000);
  res.on('close', () => { run.subs.delete(sub); clearInterval(ping); });
  send({ t: 'run', id: run.id });
  await done;
  clearInterval(ping); run.subs.delete(sub);
  if (run.continued) send({ t: 'cont', id: run.id });
  else if (run.status === 'error') send({ t: 'e', error: run.error || 'Fehler', partial: !!run.text });
  else send({ t: 'done', status: run.status });
  if (!res.writableEnded) res.end();
}

const iso = (d) => (d instanceof Date ? d.toISOString() : d);
function safeMeta(m) {
  if (!m || typeof m !== 'object') return {};
  const { cont, ...rest } = m;
  void cont;
  return rest;
}
function shape(r, isOwner, from = 0) {
  const text = r.text || '';
  return {
    id: Number(r.id), kind: r.kind, ref: r.ref, status: r.status, from, len: text.length,
    text: text.slice(Math.max(0, Math.min(from, text.length))),
    think: r.think || {}, agents: r.agents || [], model: isOwner ? r.model : undefined,
    error: r.error, meta: safeMeta(r.meta), claimed: r.claimed,
    startedAt: iso(r.created_at), updatedAt: iso(r.updated_at)
  };
}

async function settleStale(r) {
  if (r.status !== 'running' || live.has(Number(r.id))) return r;
  if (Date.now() - new Date(r.updated_at).getTime() < STALE_MS) return r;
  const u = await db.updateDoc(`ai_runs/${r.id}`, {
    status: 'error',
    error: 'Der Lauf wurde unterbrochen (Zeitlimit des Servers).',
    updated_at: db.nowIso()
  }, { updateTime: r._updateTime, expect: { status: 'running' } }).catch(() => null);
  return u || r;
}

function runsRouter(requireAuth) {
  const express = require('express'); const { wrapRouter } = require('./util');
  const r = wrapRouter(express.Router());
  r.get('/', requireAuth, async (req, res) => {
    const kind = ['chat', 'app'].includes(req.query.kind) ? req.query.kind : 'chat';
    const cutoff = Date.now() - 2 * 24 * 3600_000;
    const all = await db.runQuery('ai_runs', { where: [['uid', '==', req.user.uid]] });
    const rows = all
      .filter(x => x.kind === kind && new Date(x.created_at).getTime() > cutoff && (x.status === 'running' || x.claimed === false))
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
      .slice(0, 20);
    // Aufräumen: abgeholte, fertige Läufe (älter als 15 Min.) und alles älter als 2 Tage löschen.
    // Sonst liest jede Abfrage hier immer mehr Dokumente (Firestore-Lesekontingent).
    const old = all.filter(x => { const age = Date.now() - new Date(x.created_at).getTime(); return age > 2 * 24 * 3600_000 || (x.claimed === true && x.status !== 'running' && age > 15 * 60_000); }).slice(0, 40);
    if (old.length) Promise.all(old.map(x => db.deleteDoc(`ai_runs/${x.id}`).catch(() => {}))).catch(() => {});
    const out = [];
    for (const row of rows) {
      const s = await settleStale(row);
      out.push({ ...shape(s, req.user.isOwner), text: undefined });
    }
    res.json({ runs: out });
  });
  r.get('/:id', requireAuth, async (req, res) => {
    const id = parseInt(req.params.id, 10); if (!Number.isFinite(id)) return res.status(400).json({ error: 'Ungültig.' });
    const from = Math.max(0, parseInt(req.query.from, 10) || 0);
    const active = live.get(id);
    if (active && active.uid === req.user.uid) {
      return res.json(shape({
        id: active.id, kind: active.kind, ref: active.ref, status: active.status,
        text: active.text, think: active.think, agents: active.agents, model: active.model,
        error: active.error, meta: { ...active.meta, extra: active.extra },
        claimed: false, created_at: active.createdAt, updated_at: active.updatedAt || db.nowIso()
      }, req.user.isOwner, from));
    }
    const row = await db.getDoc(`ai_runs/${id}`);
    if (!row || row.uid !== req.user.uid) return res.status(404).json({ error: 'Lauf nicht gefunden.' });
    res.json(shape(await settleStale(row), req.user.isOwner, from));
  });
  r.post('/:id/claim', requireAuth, async (req, res) => {
    const id = parseInt(req.params.id, 10); if (!Number.isFinite(id)) return res.status(400).json({ error: 'Ungültig.' });
    const row = await db.getDoc(`ai_runs/${id}`);
    if (!row || row.uid !== req.user.uid || row.claimed !== false || row.status === 'running') return res.json({ ok: false });
    try {
      const u = await db.updateDoc(`ai_runs/${id}`, { claimed: true, updated_at: db.nowIso() }, { updateTime: row._updateTime, expect: { claimed: false } });
      if (!u) return res.json({ ok: false });
      res.json({ ok: true, run: shape(u, req.user.isOwner) });
    } catch (e) {
      if (e.code === 'PRECONDITION_FAILED') return res.json({ ok: false });
      throw e;
    }
  });
  r.post('/:id/stop', requireAuth, async (req, res) => {
    const id = parseInt(req.params.id, 10); if (!Number.isFinite(id)) return res.status(400).json({ error: 'Ungültig.' });
    const row = await db.getDoc(`ai_runs/${id}`);
    if (!row || row.uid !== req.user.uid) return res.status(404).json({ error: 'Lauf nicht gefunden.' });
    if (row.status === 'running') {
      await db.updateDoc(`ai_runs/${id}`, { stop: true, updated_at: db.nowIso() }).catch(() => {});
    }
    live.get(id)?.ac.abort();
    res.json({ ok: true });
  });
  return r;
}

module.exports = { startRun, resumeRun, serveRun, runsRouter, Run, _live: live };
