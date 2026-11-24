// Aufgaben & Zeitpläne: Coden erledigt etwas zu festen Zeiten (optional mit Deep Research) und legt das Ergebnis ab.
// Ausgelöst wird das auf drei Wegen: (1) /api/tasks/cron (Vercel-Cron oder ein kostenloser Pinger, mit CRON_SECRET),
// (2) POST /api/tasks/tick, während die App offen ist, (3) „Jetzt ausführen“. Ergebnisse liegen in task_results,
// dazu kommt eine Push-Benachrichtigung. Jeder Lauf wird vor dem Start über next_run „beansprucht“ – nie doppelt.
const express = require('express');
const crypto = require('crypto');
const db = require('./db');
const { rateLimit } = require('./rateLimit');
const { wrapRouter } = require('./util');
const byok = require('./byok');
const Push = require('./push');
const Usage = require('./usage');
const { generate } = require('./ai');
const { runResearch } = require('./research');
const T = require('../shared/tasks-core');

let waitUntil = () => {};
try { waitUntil = require('@vercel/functions').waitUntil; } catch (_) { /* lokal ohne Vercel */ }
const bg = (p) => { const q = p.catch((e) => console.warn('[tasks]', e.message)); waitUntil(q); return q; };
const fail = (status, message) => Object.assign(new Error(message), { status });
const today = () => new Intl.DateTimeFormat('de-DE', { dateStyle: 'full', timeZone: 'Europe/Berlin' }).format(new Date());
const RUN_MS = 240_000;

// Firestore: scheduled_tasks/{id} und task_results/{id}; Zeiten als ISO-Text (lässt sich vergleichen)
const isoOrNull = (ms) => (ms ? new Date(ms).toISOString() : null);
async function newDoc(col, build) {
  for (let i = 0; i < 8; i++) {
    const id = 10_000_000 + crypto.randomInt(0, 900_000_000);
    try { return await db.createDoc(`${col}/${id}`, build(id)); } catch (e) { if (e.code === 'ALREADY_EXISTS') continue; throw e; }
  }
  throw fail(500, 'Konnte keine ID vergeben.');
}
const byUid = (col, uid) => db.runQuery(col, { where: [['uid', '==', uid]], limit: 0 });

const shape = (r) => ({
  id: Number(r.id), title: r.title, prompt: r.prompt, schedule: r.schedule, tz: r.tz, tier: r.tier, research: r.research, depth: r.depth, enabled: r.enabled,
  next: r.next_run ? new Date(r.next_run).toISOString() : null, last: r.last_run ? new Date(r.last_run).toISOString() : null, lastStatus: r.last_status, when: T.describe(r.schedule, r.tz)
});

// ---------- Ausführen ----------
async function execute(t) {
  const user = { uid: t.uid, email: t.email, isOwner: !!t.is_owner };
  const own = byok.isOwnTier(t.tier);
  let text = '', ok = true; const meter = new Usage.Meter(user, t.tier);
  try {
    const c = own ? { ok: true } : await Usage.check(user);
    if (!c.ok) { ok = false; text = `Diese Aufgabe konnte nicht laufen: ${c.message}`; }
    else {
      const signal = AbortSignal.timeout(RUN_MS);
      if (t.research) text = await runResearch({ user, tier: t.tier, question: t.prompt, depth: t.depth, signal, meter });
      else {
        text = await generate(t.tier, [
          { role: 'system', content: `Du bist Coden und erledigst eine geplante Aufgabe für den Nutzer. Heute ist ${today()}. Antworte auf Deutsch, klar gegliedert und ohne Rückfragen, denn der Nutzer ist gerade nicht da. Du hast hier keinen Zugriff auf das Internet: Brauchst du aktuelle Daten, sag das offen und rate dem Nutzer, die Aufgabe mit „Recherche“ einzustellen.` },
          { role: 'user', content: t.prompt }
        ], { uid: user.uid, isOwner: user.isOwner, signal, meter, maxTokens: 4000 });
      }
    }
  } catch (e) { ok = false; text = e.limit ? `Diese Aufgabe konnte nicht zu Ende laufen: ${e.message}` : `Diese Aufgabe ist fehlgeschlagen: ${String(e.message || e).slice(0, 200)}`; }
  finally { await meter.close().catch(() => {}); }
  text = String(text || '').slice(0, T.LIMITS.resultChars) || 'Kein Ergebnis.';
  await newDoc('task_results', (rid) => ({ id: rid, uid: t.uid, task_id: Number(t.id), title: t.title, text, ok, seen: false, created_at: db.nowIso() }));
  await db.updateDoc(`scheduled_tasks/${t.id}`, { last_status: ok ? 'ok' : 'error' }).catch(() => {});
  // nur die neuesten Ergebnisse behalten
  byUid('task_results', t.uid).then(async (rows) => {
    const old = rows.sort((x, y) => String(y.created_at).localeCompare(String(x.created_at))).slice(T.LIMITS.results);
    for (const x of old) await db.deleteDoc(`task_results/${x.id}`).catch(() => {});
  }).catch(() => {});
  await Push.notify(t.uid, { title: ok ? `Aufgabe erledigt: ${t.title}` : `Aufgabe fehlgeschlagen: ${t.title}`, body: Push.preview(text), url: '/#aufgaben', tag: 'task-' + t.id });
  return ok;
}

// Fällige Aufgaben beanspruchen (jede höchstens einmal) und zurückgeben. uid begrenzt auf einen Nutzer.
async function claimDue({ uid = null, limit = 3 } = {}) {
  const now = new Date().toISOString();
  // fällig = next_run <= jetzt (nur ein Filter in Firestore, Rest im Code; ausgeschaltete haben next_run = null)
  let rows = uid ? await byUid('scheduled_tasks', uid) : await db.runQuery('scheduled_tasks', { where: [['next_run', '<=', now]], limit: 0 });
  rows = rows.filter(t => t.enabled && t.next_run && t.next_run <= now).sort((a, b) => String(a.next_run).localeCompare(String(b.next_run))).slice(0, limit);
  const mine = [];
  for (const t of rows) {
    const nxt = T.nextRun(t.schedule, t.tz, Date.now());
    // beanspruchen: nur wenn das Dokument seit dem Lesen unverändert ist (sonst war ein anderer Lauf schneller)
    try {
      const took = await db.updateDoc(`scheduled_tasks/${t.id}`, { next_run: isoOrNull(nxt), enabled: nxt != null, last_run: db.nowIso() }, { updateTime: t._updateTime });
      if (took) mine.push(t);
    } catch (_) { /* schon beansprucht */ }
  }
  return mine;
}
async function tick(opts) { const due = await claimDue(opts); await Promise.all(due.map(t => execute(t).catch(e => console.warn('[tasks] Lauf', t.id, e.message)))); return due.length; }

// ---------- Cron-Eingang (ohne Login, mit Geheimnis) ----------
function cronHandler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return res.status(503).json({ error: 'CRON_SECRET ist nicht gesetzt.' });
  const given = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '') || String(req.headers['x-cron-secret'] || '') || String(req.query?.key || '');
  const a = Buffer.from(given), b = Buffer.from(secret);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.status(401).json({ error: 'Nicht erlaubt.' });
  return tick({ limit: 5 }).then(n => res.json({ ran: n }));
}

// ---------- Schnittstelle für die App ----------
function tasksRouter(requireAuth) {
  const r = wrapRouter(express.Router());
  r.use(requireAuth);
  const id = (req) => { const n = parseInt(req.params.id, 10); if (!Number.isFinite(n)) throw fail(400, 'Ungültig.'); return n; };
  const mine = async (req) => { const t = await db.getDoc(`scheduled_tasks/${id(req)}`); if (!t || t.uid !== req.user.uid) throw fail(404, 'Diese Aufgabe gibt es nicht (mehr).'); return t; };
  const tierOk = async (req, tier) => { if (byok.isOwnTier(tier)) { if (!(await byok.owns(req.user.uid, tier))) throw fail(400, 'Dieses eigene Modell gibt es nicht mehr.'); } };
  const nextOf = (task) => isoOrNull(T.nextRun(task.schedule, task.tz));

  r.get('/', async (req, res) => {
    const [rows, results] = await Promise.all([byUid('scheduled_tasks', req.user.uid), byUid('task_results', req.user.uid)]);
    rows.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    res.json({ tasks: rows.map(shape), unseen: results.filter(x => !x.seen).length, limits: T.LIMITS, cron: !!process.env.CRON_SECRET });
  });

  r.post('/', rateLimit('task-edit', 30, 60), async (req, res) => {
    const c = T.cleanTask(req.body); if (c.error) throw fail(400, c.error);
    const rows = await byUid('scheduled_tasks', req.user.uid);
    if (rows.length >= T.LIMITS.tasks) throw fail(400, `Du kannst höchstens ${T.LIMITS.tasks} Aufgaben anlegen. Lösche zuerst eine.`);
    if (c.task.research && rows.filter(x => x.research).length >= T.LIMITS.research && !req.user.isOwner) throw fail(400, `Du kannst höchstens ${T.LIMITS.research} Aufgaben mit Recherche anlegen.`);
    await tierOk(req, c.task.tier);
    const t = c.task;
    const row = await newDoc('scheduled_tasks', (tid) => ({ id: tid, uid: req.user.uid, email: req.user.email || '', is_owner: !!req.user.isOwner, title: t.title, prompt: t.prompt, schedule: t.schedule, tz: t.tz, tier: t.tier, research: t.research, depth: t.depth, enabled: true, next_run: nextOf(t), last_run: null, last_status: null, created_at: db.nowIso() }));
    res.json({ task: shape(row) });
  });

  // ändern: entweder nur an/aus ({ enabled }) oder komplett neu ({ prompt, schedule, … })
  r.put('/:id', rateLimit('task-edit', 30, 60), async (req, res) => {
    const old = await mine(req);
    if (Object.keys(req.body || {}).length === 1 && typeof req.body.enabled === 'boolean') {
      const nxt = req.body.enabled ? nextOf({ schedule: old.schedule, tz: old.tz }) : null;
      if (req.body.enabled && !nxt) throw fail(400, 'Diese einmalige Aufgabe ist schon vorbei. Lege sie neu an.');
      const row = await db.updateDoc(`scheduled_tasks/${old.id}`, { enabled: req.body.enabled, next_run: nxt });
      return res.json({ task: shape(row) });
    }
    const c = T.cleanTask(req.body); if (c.error) throw fail(400, c.error);
    if (c.task.research && !old.research && !req.user.isOwner) {
      const rs = (await byUid('scheduled_tasks', req.user.uid)).filter(x => x.research).length;
      if (rs >= T.LIMITS.research) throw fail(400, `Du kannst höchstens ${T.LIMITS.research} Aufgaben mit Recherche anlegen.`);
    }
    await tierOk(req, c.task.tier); const t = c.task;
    const row = await db.updateDoc(`scheduled_tasks/${old.id}`, { title: t.title, prompt: t.prompt, schedule: t.schedule, tz: t.tz, tier: t.tier, research: t.research, depth: t.depth, enabled: true, next_run: nextOf(t) });
    res.json({ task: shape(row) });
  });

  r.delete('/:id', async (req, res) => {
    const t = await mine(req);
    await db.deleteDoc(`scheduled_tasks/${t.id}`);
    res.json({ ok: true });
  });

  // sofort ausführen (läuft im Hintergrund, Ergebnis kommt wie sonst)
  r.post('/:id/run', rateLimit('task-run', 6, 600), async (req, res) => {
    const t = await mine(req);
    bg(execute(t)); res.status(202).json({ ok: true });
  });

  // App offen: eigene fällige Aufgaben ausführen
  r.post('/tick', rateLimit('task-tick', 30, 600), async (req, res) => {
    const due = await claimDue({ uid: req.user.uid, limit: 2 });
    due.forEach(t => bg(execute(t)));
    res.json({ started: due.length });
  });

  // Ergebnisse
  const result = async (req) => { const x = await db.getDoc(`task_results/${id(req)}`); return x && x.uid === req.user.uid ? x : null; };
  r.get('/results', async (req, res) => {
    const rows = (await byUid('task_results', req.user.uid)).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 50);
    res.json({ results: rows.map(x => ({ id: Number(x.id), taskId: x.task_id == null ? null : Number(x.task_id), title: x.title, ok: x.ok, seen: !!x.seen, at: new Date(x.created_at).toISOString(), preview: String(x.text || '').slice(0, 240).replace(/\s+/g, ' ') })) });
  });
  r.get('/results/:id', async (req, res) => {
    const x = await result(req);
    if (!x) throw fail(404, 'Dieses Ergebnis gibt es nicht mehr.');
    if (!x.seen) await db.updateDoc(`task_results/${x.id}`, { seen: true });
    res.json({ id: Number(x.id), title: x.title, text: x.text, ok: x.ok, at: new Date(x.created_at).toISOString() });
  });
  r.post('/results-seen', async (req, res) => {
    for (const x of (await byUid('task_results', req.user.uid)).filter(x => !x.seen)) await db.updateDoc(`task_results/${x.id}`, { seen: true });
    res.json({ ok: true });
  });
  r.delete('/results/:id', async (req, res) => { const x = await result(req); if (x) await db.deleteDoc(`task_results/${x.id}`); res.json({ ok: true }); });

  r.use((err, req, res, next) => { if (err.status) return res.status(err.status).json({ error: err.message }); console.error('[tasks]', err); res.status(500).json({ error: 'Serverfehler.' }); });
  return r;
}

module.exports = { tasksRouter, cronHandler, tick, claimDue, execute };
