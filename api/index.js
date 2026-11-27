// Einziger Vercel-Einstiegspunkt: Express-Backend für Coden AI (Datenbank: ausschließlich Firebase Firestore)
const express = require('express');
const nodemailer = require('nodemailer');
const db = require('../server/db');
const { requireAuth, requireOwner } = require('../server/auth');
const { rateLimit } = require('../server/rateLimit');
const { generate, generateStream, listModels, probe, TEST_PROMPT } = require('../server/ai');
const { buddyRouter } = require('../server/buddy');
const { appsRouter, publicApiRouter, hostedRouter, baseUrl } = require('../server/apps');
const { mcpRouter } = require('../server/mcp');
const { browserRouter } = require('../server/browser');
const CodenUpload = require('../shared/upload-check');
const { wrapRouter } = require('../server/util');
const { startRun, serveRun, runsRouter } = require('../server/runs');
const { ensureSchema } = require('../server/schema');
const { chatJob, continueHandler, makeChatImage } = require('../server/chat-run');
const { pushRouter } = require('../server/push');
const { researchJob, researchRouter } = require('../server/research');
const { startReport } = require('../server/research-reports');
const { tasksRouter, cronHandler } = require('../server/tasks');
const { artifactsRouter, publicArtifactsRouter, sharedPageRouter } = require('../server/artifacts');
const byok = require('../server/byok');
const neon = require('../server/neon');
const { accountRouter } = require('../server/account');
const { contactRouter } = require('../server/contact');
const { Meter, limitGate, usageRouter } = require('../server/usage');
const meterFor = (req) => new Meter(req.user, req.body?.tier);

// Eigene Modelle (Bring your own Key) laufen über den Key des Nutzers und zählen nicht gegen die Coden-Limits.
// Recherchen laufen immer über Coden Ultra (Coden-Keys) und zählen deshalb immer.
const gate = (req, res, next) => (byok.isByok(req.body?.tier) && req.body?.research !== true ? next() : ensureSchema()
  .then(() => (byok.isChain(req.body?.tier) && req.body?.research !== true ? byok.freeOfQuota(req.user.uid, req.body.tier) : false))
  .then((free) => (free ? next() : limitGate(req, res, next)), next));

process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', e?.stack || e));
process.on('uncaughtException', (e) => console.error('[uncaughtException]', e?.stack || e));

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '12mb' }));
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

const api = express.Router();
wrapRouter(api);

// ---------- Selbsttest (ohne Login, verrät nichts Geheimes): coden-ai.vercel.app/api/health ----------
api.get('/health', async (req, res) => {
  const out = { ok: true, node: process.version, db: false, schema: false, push: false };
  try { await db.ping(); out.db = true; } catch (e) { out.ok = false; out.dbError = String(e.message).slice(0, 120); }
  try { out.schema = await ensureSchema(); } catch (_) { out.schema = false; }
  try { out.neon = await require('../server/neon').ping(); } catch (e) { out.neon = { configured: true, ok: false, error: String(e.message).slice(0, 120) }; }
  try { require('web-push'); out.push = true; } catch (e) { out.pushError = String(e.code || e.message).slice(0, 80); }
  res.status(out.ok ? 200 : 503).json(out);
});

// ---------- Wer bin ich? ----------
api.get('/me', requireAuth, (req, res) => {
  res.json({ uid: req.user.uid, email: req.user.email, emailVerified: !!req.user.emailVerified, isOwner: req.user.isOwner });
});

// ---------- Nutzerdaten (Chats + Einstellungen) ----------
// Geheimnisse (eigene API-Keys, E-Mail-Passwort) werden NIE in Firestore gespeichert.
function stripSecrets(settings) {
  const s = { ...(settings && typeof settings === 'object' ? settings : {}) };
  delete s.apiKey;
  if (s.emailConfig && typeof s.emailConfig === 'object') {
    s.emailConfig = {
      provider: String(s.emailConfig.provider || 'gmail').slice(0, 32),
      address: String(s.emailConfig.address || '').slice(0, 200),
      password: ''
    };
  }
  const priority = ['study', 'humanizer', 'tourDone', 'browserAllowedDomains', 'dictationMode', 'userName', 'persona', 'customPersona', 'fontSize', 'theme', 'instructions', 'memoryOn', 'memoryItems', 'assistants', 'skills', 'webSearch', 'researchDepth', 'emailConfig'];
  const keys = [...new Set([...priority.filter(k => k in s), ...Object.keys(s)])].slice(0, 40);
  const trimmed = {};
  for (const k of keys) trimmed[k] = s[k];
  return trimmed;
}

const sanitizeSessionId = (id, idx) => {
  const cleaned = String(id || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120);
  return cleaned || `chat_${idx}`;
};

api.get('/data', requireAuth, async (req, res) => {
  const uid = req.user.uid;
  if (neon.isConfigured()) {
    try {
      const rows = await neon.select('user_data', { uid });
      if (rows[0]) {
        const s = Array.isArray(rows[0].sessions) ? rows[0].sessions : [];
        const st = rows[0].settings && typeof rows[0].settings === 'object' ? rows[0].settings : {};
        return res.json({ exists: true, sessions: s, settings: st });
      }
    } catch (e) {
      console.warn('[data] Neon read fallback:', e.message);
    }
  }

  let userDoc = null;
  let subSessions = [];
  try {
    [userDoc, subSessions] = await Promise.all([
      db.getDoc(`user_data/${uid}`),
      db.listDocs(`user_data/${uid}/sessions`, { limit: 300 }).catch(() => [])
    ]);
  } catch (e) {
    if (e?.code === 'RESOURCE_EXHAUSTED' || e?.status === 429) {
      return res.json({ exists: false, quotaExceeded: true });
    }
    throw e;
  }
  if (!userDoc && !subSessions.length) return res.json({ exists: false });

  let sessions = [];
  if (subSessions.length) {
    const order = Array.isArray(userDoc?.sessionOrder) ? userDoc.sessionOrder : [];
    const pos = new Map(order.map((id, i) => [id, i]));
    sessions = subSessions
      .slice()
      .sort((a, b) => {
        const pa = pos.has(a.id) ? pos.get(a.id) : (typeof a.orderIndex === 'number' ? a.orderIndex : 99999);
        const pb = pos.has(b.id) ? pos.get(b.id) : (typeof b.orderIndex === 'number' ? b.orderIndex : 99999);
        if (pa !== pb) return pa - pb;
        return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
      })
      .map((s) => ({
        id: s.id,
        title: s.title || 'Neuer Chat',
        messages: Array.isArray(s.messages) ? s.messages : [],
        ...(s.pinned ? { pinned: true } : {}),
        ...(s.unread ? { unread: true } : {}),
        ...(s.projectId ? { projectId: s.projectId } : {}),
        ...(s.assistantId ? { assistantId: s.assistantId } : {}),
        createdAt: s.createdAt,
        updatedAt: s.updatedAt
      }));
  } else if (Array.isArray(userDoc?.sessions)) {
    sessions = userDoc.sessions;
  }

  const settings = userDoc?.settings || {};
  if (neon.isConfigured() && (sessions.length || Object.keys(settings).length)) {
    neon.upsert('user_data', {
      uid,
      sessions: JSON.stringify(sessions),
      settings: JSON.stringify(stripSecrets(settings)),
      updated_at: new Date().toISOString()
    }, ['uid']).catch(() => {});
  }

  res.json({ exists: true, sessions, settings });
});

api.put('/data', requireAuth, rateLimit('data', 30, 60), async (req, res) => {
  const { sessions, settings } = req.body || {};
  if (!Array.isArray(sessions) || typeof settings !== 'object' || settings === null) {
    return res.status(400).json({ error: 'Ungültige Daten.' });
  }
  const serialized = JSON.stringify(sessions);
  if (serialized.length > 3_000_000) return res.status(413).json({ error: 'Zu viele Daten.' });

  const uid = req.user.uid;
  const now = db.nowIso();
  const cleanSettings = stripSecrets(settings);
  const keptIds = [];
  const seen = new Set();

  const limitedSessions = sessions.slice(0, 300).map((raw, i) => {
    const r = raw || {};
    let id = sanitizeSessionId(r.id, i);
    while (seen.has(id)) id = `${id.slice(0, 110)}_${i}`;
    seen.add(id);
    keptIds.push(id);
    return {
      id,
      uid,
      title: String(r.title || 'Neuer Chat').slice(0, 200),
      messages: Array.isArray(r.messages) ? r.messages.slice(-1000) : [],
      pinned: !!r.pinned,
      unread: !!r.unread,
      projectId: r.projectId || null,
      assistantId: r.assistantId || null,
      orderIndex: i,
      createdAt: r.createdAt || now,
      updatedAt: r.updatedAt || now
    };
  });

  if (neon.isConfigured()) {
    await neon.upsert('user_data', {
      uid,
      sessions: JSON.stringify(limitedSessions),
      settings: JSON.stringify(cleanSettings),
      updated_at: now
    }, ['uid']);
    return res.json({ ok: true, backend: 'neon' });
  }

  for (const s of limitedSessions) {
    await db.setDoc(`user_data/${uid}/sessions/${s.id}`, s);
  }

  // Entferne gelöschte Chats aus der Subcollection
  const existing = await db.listDocs(`user_data/${uid}/sessions`, { limit: 300 }).catch(() => []);
  for (const old of existing) {
    if (!seen.has(old._id)) await db.deleteDoc(`user_data/${uid}/sessions/${old._id}`).catch(() => {});
  }

  await db.setDoc(`user_data/${uid}`, {
    uid,
    settings: cleanSettings,
    sessionOrder: keptIds,
    updatedAt: now
  });

  res.json({ ok: true });
});

// ---------- Globaler Systemzustand (Firestore system_state/global) ----------
function cleanDoc(doc) {
  if (!doc) return {};
  const { _id, _updateTime, ...rest } = doc;
  void _id; void _updateTime;
  return rest;
}

api.get('/system/state', requireAuth, async (req, res) => {
  res.json(await systemState());
});

api.post('/admin/command', requireAuth, requireOwner, async (req, res) => {
  const { cmd, param } = req.body || {};
  const now = Date.now();
  let patch;
  switch (cmd) {
    case 'lock': case 'unlock': {
      if (!['pro', 'thinking', 'ultra'].includes(param)) return res.status(400).json({ error: 'Nutze pro, thinking oder ultra.' });
      patch = { locks: { [param]: cmd === 'lock' } }; break;
    }
    case 'broadcast': patch = { broadcast: { message: String(param || '').slice(0, 500), time: now } }; break;
    case 'forceupdate': patch = { forceUpdate: now }; break;
    case 'maintenance': patch = { maintenance: param === 'on' }; break;
    case 'model': patch = { globalModel: ['flash', 'normal', 'pro', 'ultra'].includes(param) ? param : null }; break;
    case 'theme': patch = { theme: String(param || '').slice(0, 30) }; break;
    case 'font': { const n = parseInt(param, 10); if (!(n >= 10 && n <= 30)) return res.status(400).json({ error: 'Größe 10-30.' }); patch = { fontSize: n }; break; }
    case 'clearall': patch = { globalClear: now }; break;
    default: return res.status(400).json({ error: 'Unbekannter Befehl.' });
  }
  const cur = cleanDoc(await db.getDoc('system_state/global'));
  const next = patch.locks
    ? { ...cur, ...patch, locks: { ...(cur.locks || {}), ...patch.locks }, updatedAt: db.nowIso() }
    : { ...cur, ...patch, updatedAt: db.nowIso() };
  await db.setDoc('system_state/global', next); sysCache = { at: 0, doc: null };
  res.json({ ok: true });
});

// Blockiert normale Nutzer bei Wartungsmodus / gesperrten Modellen (serverseitig)
// Systemzustand (Sperren, Wartung) kurz zwischenspeichern: jede Chat-Anfrage und jede Abfrage der App
// würde sonst einen Firestore-Lesezugriff kosten. Ist die Datenbank nicht erreichbar, gilt der letzte bekannte Stand.
let sysCache = { at: 0, doc: null };
async function systemState() {
  if (sysCache.doc && Date.now() - sysCache.at < 30_000) return sysCache.doc;
  try { sysCache = { at: Date.now(), doc: cleanDoc(await db.getDoc('system_state/global')) }; }
  catch (e) { console.warn('[system] Zustand nicht lesbar:', e.message); sysCache = { at: Date.now() - 20_000, doc: sysCache.doc || cleanDoc(null) }; }
  return sysCache.doc;
}
async function enforceSystemState(req, res, next) {
  if (req.user.isOwner) return next();
  const st = await systemState();
  if (st.maintenance) return res.status(503).json({ error: 'Wartungsarbeiten.' });
  const tier = req.body?.tier;
  if (tier === 'ultra' && st.locks?.ultra !== false) return res.status(403).json({ error: 'Coden Ultra ist gesperrt (nur der Owner).' });
  if (tier === 'pro' && st.locks?.pro) return res.status(403).json({ error: 'Coden Pro ist gesperrt.' });
  if (tier === 'normal' && st.locks?.thinking) return res.status(403).json({ error: 'Coden Thinking ist gesperrt.' });
  next();
}

// ---------- Chat ----------
api.get('/models', requireAuth, (req, res) => {
  if (!req.user.isOwner) return res.status(403).json({ error: 'Nur der Owner.' });
  res.json({ models: listModels() });
});

const TEST_CONCURRENCY = 3, TEST_TIMEOUT_MS = 90_000;
api.post('/models/test', requireAuth, rateLimit('model-test', 3, 600), async (req, res) => {
  if (!req.user.isOwner) return res.status(403).json({ error: 'Nur der Owner.' });
  const prompt = typeof req.body?.prompt === 'string' && req.body.prompt.trim() ? req.body.prompt.trim().slice(0, 4000) : TEST_PROMPT;
  const all = listModels(); const want = Array.isArray(req.body?.keys) ? new Set(req.body.keys) : null;
  const models = all.filter(m => !want || want.has(m.key));
  const ac = new AbortController();
  res.on('close', () => { if (!res.writableEnded) ac.abort(); });
  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  const send = (o) => { if (!res.writableEnded) res.write(`data: ${JSON.stringify(o)}\n\n`); };
  send({ t: 'init', prompt, models: models.map(m => ({ key: m.key, id: m.id, provider: m.provider, providerName: m.providerName, ready: m.ready, limited: m.limited })) });
  const queue = models.slice(); const messages = [{ role: 'user', content: prompt }];
  const worker = async () => {
    for (let m; (m = queue.shift()) && !ac.signal.aborted;) {
      send({ t: 'start', key: m.key });
      const one = new AbortController(); const stop = () => one.abort(); ac.signal.addEventListener('abort', stop);
      const timer = setTimeout(stop, TEST_TIMEOUT_MS);
      const r = await probe(m.key, messages, { signal: one.signal, onProgress: (p) => send({ t: 'p', key: m.key, ...p }) });
      clearTimeout(timer); ac.signal.removeEventListener('abort', stop);
      const { text, ...row } = r; send({ t: 'r', row, tail: text.slice(-1500), complete: /<\/html>/i.test(text), checks: checksOf(text) });
    }
  };
  await Promise.all(Array.from({ length: TEST_CONCURRENCY }, worker));
  send({ t: 'done' }); res.end();
});

function checksOf(text) {
  return [/<\/html>/i, /<canvas|getContext|<div|<table/i, /keydown|ArrowUp/i, /game ?over/i, /neustart|restart|reset|neu starten/i, /score|punkte/i].filter(r => r.test(text)).length;
}
// Chatverlauf komprimieren: höchstens ~10.000 Eingabe-Tokens (CODEN_INPUT_BUDGET), die letzte Nutzer-Nachricht bleibt ganz
const { compressMessages } = require('../server/context');
const squeeze = (msgs) => compressMessages(msgs).messages;
const pinOf = (req) => (typeof req.body?.model === 'string' && req.user.isOwner ? req.body.model.slice(0, 120) : undefined);

function validChat(body) {
  const { messages, tier } = body || {};
  if (!Array.isArray(messages) || !messages.length || messages.length > 200 || typeof tier !== 'string') return false; // lange Chats: der Server komprimiert (squeeze)
  return messages.every(m => ['system', 'user', 'assistant'].includes(m.role) && typeof m.content === 'string' && m.content.length <= 2_500_000
    && (!m.images || (Array.isArray(m.images) && m.images.length <= 4 && m.images.every(i => typeof i === 'string' && CodenUpload.inspectImageDataUrl(i).ok))));
}

const effortOf = (b) => (byok.LEVELS.includes(b?.effort) ? b.effort : undefined);
const maxTokensOf = (b) => { const n = parseInt(b?.maxTokens, 10); return Number.isFinite(n) ? Math.max(1024, Math.min(n, 16384)) : undefined; };

api.post('/chat', requireAuth, rateLimit('chat', 20, 60), enforceSystemState, gate, async (req, res) => {
  if (!validChat(req.body)) return res.status(400).json({ error: 'Ungültige Anfrage.' });
  const meter = meterFor(req);
  try {
    res.json({ content: await generate(req.body.tier, squeeze(req.body.messages), { isOwner: req.user.isOwner, uid: req.user.uid, maxTokens: maxTokensOf(req.body), effort: effortOf(req.body), pin: pinOf(req), meter }) });
  } catch (e) {
    res.status(e.status || 502).json({ error: e.message, ...(e.limit ? { code: 'limit' } : {}) });
  } finally { meter.close(); }
});

api.post('/chat/stream', requireAuth, rateLimit('chat', 20, 60), enforceSystemState, gate, async (req, res) => {
  if (!validChat(req.body)) return res.status(400).json({ error: 'Ungültige Anfrage.' });
  const ac = new AbortController();
  res.on('close', () => { if (!res.writableEnded) ac.abort(); });
  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  const send = (o) => { if (!res.writableEnded) res.write(`data: ${JSON.stringify(o)}\n\n`); };
  const meter = meterFor(req);
  try {
    await generateStream(req.body.tier, squeeze(req.body.messages), {
      isOwner: req.user.isOwner, uid: req.user.uid, signal: ac.signal, maxTokens: maxTokensOf(req.body), effort: effortOf(req.body), pin: pinOf(req), meter,
      onModel: (m) => { if (req.user.isOwner || m.own) send({ t: 'm', model: m.id }); },
      onThink: (k) => send({ t: 'k', h: k.h, v: k.v }),
      onDelta: (v) => send({ t: 'd', v })
    });
    send({ t: 'done' });
  } catch (e) {
    send({ t: 'e', error: ac.signal.aborted ? 'abgebrochen' : e.message, partial: !!e.partial, ...(e.limit ? { code: 'limit' } : {}) });
  } finally { meter.close(); }
  res.end();
});

const researchLimit = (req, res, next) => (req.body?.research === true ? rateLimit('research', 6, 600)(req, res, next) : next()); // Deep Research ist teuer: höchstens 6 pro 10 Minuten
api.post('/runs/chat', requireAuth, rateLimit('chat', 20, 60), researchLimit, enforceSystemState, gate, async (req, res) => {
  if (!validChat(req.body)) return res.status(400).json({ error: 'Ungültige Anfrage.' });
  const ref = typeof req.body.ref === 'string' && req.body.ref ? req.body.ref.slice(0, 80) : 'chat';
  const m = req.body.meta || {};
  const research = req.body.research === true;
  const meta = { title: String(m.title || '').slice(0, 120), userText: String(m.userText || '').slice(0, 4000), tier: req.body.tier, ...(m.temp ? { temp: true } : {}), ...(research ? { research: true } : {}) };
  await ensureSchema();
  const state = {
    user: { uid: req.user.uid, email: req.user.email, isOwner: req.user.isOwner }, tier: req.body.tier, messages: squeeze(req.body.messages), title: meta.title,
    opts: { maxTokens: maxTokensOf(req.body), effort: effortOf(req.body), pin: pinOf(req) },
    base: baseUrl(req), self: selfUrl(req), leg: 1, ...(meta.temp ? { temp: true } : {}), ...(research ? { depth: ['quick', 'normal', 'deep'].includes(req.body.depth) ? req.body.depth : 'normal' } : {})
  };
  const { run, done } = await startRun({ uid: req.user.uid, isOwner: req.user.isOwner, kind: 'chat', ref, meta }, (run) => (research ? researchJob(run, state) : chatJob(run, state)));
  await serveRun(res, run, done);
});

api.post('/runs/:id/continue', (req, res, next) => ensureSchema().then(() => continueHandler(req, res)).catch(next));
const selfUrl = (req) => `${req.headers['x-forwarded-proto'] || req.protocol}://${req.headers['x-forwarded-host'] || req.headers.host}`.replace(/\/$/, '');

// ---------- E-Mail (über das eigene Konto des Nutzers, nur Gmail/Outlook) ----------
const SMTP = {
  gmail: { host: 'smtp.gmail.com', port: 465, secure: true },
  outlook: { host: 'smtp.office365.com', port: 587, secure: false }
};
api.post('/send-email', requireAuth, rateLimit('mail', 5, 300), async (req, res) => {
  const { provider, email, password, to, subject, text } = req.body || {};
  const cfg = SMTP[provider];
  if (!cfg) return res.status(400).json({ error: 'Nur Gmail oder Outlook werden unterstützt.' });
  const mailOk = s => typeof s === 'string' && /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(s);
  if (!mailOk(email) || !mailOk(to) || !password || !text) return res.status(400).json({ error: 'Ungültige oder fehlende Daten.' });
  try {
    const transporter = nodemailer.createTransport({ ...cfg, auth: { user: email, pass: password } });
    const info = await transporter.sendMail({
      from: `"Coden AI Assistent" <${email}>`, to,
      subject: String(subject || 'Neue Nachricht von Coden AI').replace(/[\r\n]/g, ' ').slice(0, 200),
      text: String(text).slice(0, 20000)
    });
    res.json({ success: true, messageId: info.messageId });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// ---------- Live-Call: kurzlebiges Token statt echtem Google-Key ----------
api.post('/live-token', requireAuth, rateLimit('live', 5, 300), async (req, res) => {
  const key = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
  if (!key) return res.status(500).json({ error: 'Live-Server nicht konfiguriert.' });
  try {
    const r = await fetch('https://generativelanguage.googleapis.com/v1alpha/auth_tokens', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        uses: 1,
        expireTime: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        newSessionExpireTime: new Date(Date.now() + 60 * 1000).toISOString()
      })
    });
    const data = await r.json();
    if (!r.ok || !data.name) throw new Error(data.error?.message || 'Token konnte nicht erstellt werden');
    res.json({ token: data.name });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

const { projectsRouter } = require('../server/projects');
const { studyRouter } = require('../server/study');
const { serversRouter } = require('../server/servers');
const needsDb = (req, res, next) => { ensureSchema().then(() => next(), next); };
api.use('/account', needsDb); api.use('/contact', needsDb); api.use('/byok', needsDb); api.use('/buddy', needsDb); api.use('/mcp', needsDb); api.use('/servers', needsDb); api.use('/projects', needsDb); api.use('/apps', needsDb); api.use('/data', needsDb); api.use('/runs', needsDb); api.use('/usage', needsDb); api.use('/push', needsDb); api.use('/research', needsDb); api.use('/tasks', needsDb); api.use('/artifacts', needsDb);
app.use('/a', needsDb); app.use('/s', needsDb);

// ---------- KI-Bilder für den normalen Chat (Cloudflare Flux) ----------
api.post('/image', requireAuth, rateLimit('image', 10, 300), async (req, res) => {
  try { res.json(await makeChatImage(req.user, req.body?.prompt, baseUrl(req))); }
  catch (e) { res.status(e.status || 502).json({ error: e.message }); }
});

api.use('/account', accountRouter(requireAuth));
api.use('/contact', contactRouter({ requireAuth, requireOwner }));
api.use('/byok', byok.byokRouter(requireAuth));
api.use('/buddy', buddyRouter(requireAuth));
api.use('/mcp', mcpRouter(requireAuth));
api.use('/browser', browserRouter(requireAuth));
api.use('/projects', projectsRouter(requireAuth));
api.use('/study', needsDb, studyRouter(requireAuth));
api.use('/servers', serversRouter(requireAuth));
api.use('/runs', runsRouter(requireAuth));
api.use('/usage', usageRouter(requireAuth, requireOwner));
api.use('/push', pushRouter(requireAuth));
// Research-Seite: Bericht als eigener Hintergrund-Lauf (zählt gegen das Nutzungslimit, höchstens 6 Recherchen pro 10 Minuten)
// Das Modell wählt der Server (immer Coden Ultra) – ein mitgeschicktes tier wird vorher entfernt, damit die Ultra-Sperre des Chats nicht greift.
const researchBody = (req, res, next) => { req.body = { ...(req.body || {}), research: true }; delete req.body.tier; next(); };
api.post('/research/reports', requireAuth, rateLimit('research', 6, 600), researchBody, enforceSystemState, gate, (req, res) => ensureSchema()
  .then(() => startReport(req, res))
  .catch((e) => { if (e.status) return res.status(e.status).json({ error: e.message }); console.error('[research/reports]', e); res.status(500).json({ error: 'Die Recherche konnte nicht starten.' }); }));
api.use('/research', researchRouter(requireAuth));
// Zeitpläne auslösen (Pinger wie cron-job.org, mit CRON_SECRET statt Login)
api.get('/cron/tasks', needsDb, cronHandler); api.post('/cron/tasks', needsDb, cronHandler);
api.use('/tasks', tasksRouter(requireAuth));
api.use('/apps', appsRouter(requireAuth));
api.use('/artifacts', artifactsRouter(requireAuth));
api.use('/public/artifacts', needsDb, publicArtifactsRouter());
api.use('/public', publicApiRouter());
app.use('/api', api);
app.use('/a', hostedRouter()); // veröffentlichte Apps: /a/<adresse>/
app.use('/s', sharedPageRouter()); // veröffentlichte Artefakte: /s/<id>
app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  if (err?.code === 'PERMISSION_DENIED' || err?.status === 403) {
    const msg = req.user && req.user.emailVerified === false
      ? 'Bitte bestätige zuerst deine E-Mail-Adresse, um diese Aktion durchzuführen.'
      : 'Zugriff in der Datenbank verweigert.';
    return res.status(403).json({ error: msg, code: 'PERMISSION_DENIED' });
  }
  if (err?.code === 'UNAUTHENTICATED' || err?.status === 401) {
    return res.status(401).json({ error: 'Sitzung abgelaufen. Bitte erneut anmelden.', code: 'UNAUTHENTICATED' });
  }
  if (err?.code === 'ALREADY_EXISTS' || err?.status === 409) {
    return res.status(409).json({ error: 'Eintrag existiert bereits.', code: 'ALREADY_EXISTS' });
  }
  if (err?.code === 'NOT_FOUND' || err?.status === 404) {
    return res.status(404).json({ error: 'Nicht gefunden.', code: 'NOT_FOUND' });
  }
  if (err?.code === 'RESOURCE_EXHAUSTED' || err?.status === 429) {
    return res.status(429).json({ error: 'Datenbank-Limit vorübergehend erreicht. Bitte kurz warten.', code: 'RESOURCE_EXHAUSTED' });
  }
  if (err?.status >= 400 && err?.status < 500) {
    return res.status(err.status).json({ error: err.message || 'Ungültige Anfrage.' });
  }
  res.status(500).json({ error: 'Serverfehler.' });
});

module.exports = app;
