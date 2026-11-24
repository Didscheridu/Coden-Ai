// Einziger Vercel-Einstiegspunkt: Express-Backend für Coden AI
const express = require('express');
const nodemailer = require('nodemailer');
const { getSql } = require('../server/db');
const { requireAuth, requireOwner } = require('../server/auth');
const { rateLimit } = require('../server/rateLimit');
const { generate, generateStream, listModels, probe, TEST_PROMPT } = require('../server/ai');
const { buddyRouter } = require('../server/buddy');
const { appsRouter, publicApiRouter, hostedRouter, baseUrl } = require('../server/apps');
const crypto = require('crypto');
const { mcpRouter } = require('../server/mcp');
const CodenUpload = require('../shared/upload-check');
const { wrapRouter } = require('../server/util');
const { startRun, serveRun, runsRouter } = require('../server/runs');
const { ensureSchema } = require('../server/schema');
const { chatJob, continueHandler, makeChatImage } = require('../server/chat-run');
const { pushRouter } = require('../server/push');
const byok = require('../server/byok');
const { Meter, limitGate, usageRouter } = require('../server/usage');
const meterFor = (req) => new Meter(req.user, req.body?.tier);
// Limit-Prüfung braucht die Tabelle: vorher sicherstellen
// Eigene Modelle (Bring your own Key) laufen über den Key des Nutzers und zählen nicht gegen die Coden-Limits
const gate = (req, res, next) => (byok.isByok(req.body?.tier) ? next() : ensureSchema()
  .then(() => (byok.isChain(req.body?.tier) ? byok.freeOfQuota(req.user.uid, req.body.tier) : false))
  .then((free) => (free ? next() : limitGate(req, res, next)), next));

// Ein einzelner vergessener Fehler (z. B. in einem Hintergrund-Lauf) darf nie die ganze Funktion abstürzen lassen:
// sonst antwortet Vercel allen gleichzeitigen Anfragen nur noch mit „HTTP 500“.
process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', e?.stack || e));
process.on('uncaughtException', (e) => console.error('[uncaughtException]', e?.stack || e));

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '4mb' }));
app.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

const api = express.Router();
wrapRouter(api);

// ---------- Selbsttest (ohne Login, verrät nichts Geheimes): coden-ai.vercel.app/api/health ----------
api.get('/health', async (req, res) => {
  const out = { ok: true, node: process.version, db: false, schema: false, push: false };
  try { await getSql()`SELECT 1`; out.db = true; } catch (e) { out.ok = false; out.dbError = String(e.message).slice(0, 120); }
  try { out.schema = await ensureSchema(); } catch (_) { out.schema = false; }
  try { require('web-push'); out.push = true; } catch (e) { out.pushError = String(e.code || e.message).slice(0, 80); }
  res.status(out.ok ? 200 : 503).json(out);
});

// ---------- Wer bin ich? ----------
api.get('/me', requireAuth, (req, res) => {
  res.json({ uid: req.user.uid, email: req.user.email, isOwner: req.user.isOwner });
});

// ---------- Nutzerdaten (Chats + Einstellungen) ----------
// Geheimnisse (eigene API-Keys, E-Mail-Passwort) werden NIE in der Datenbank gespeichert.
function stripSecrets(settings) {
  const s = { ...(settings || {}) };
  delete s.apiKey;
  if (s.emailConfig) s.emailConfig = { ...s.emailConfig, password: '' };
  return s;
}

api.get('/data', requireAuth, async (req, res) => {
  const rows = await getSql()`SELECT sessions, settings FROM user_data WHERE uid = ${req.user.uid}`;
  if (!rows.length) return res.json({ exists: false });
  res.json({ exists: true, sessions: rows[0].sessions, settings: rows[0].settings });
});

api.put('/data', requireAuth, rateLimit('data', 30, 60), async (req, res) => {
  const { sessions, settings } = req.body || {};
  if (!Array.isArray(sessions) || typeof settings !== 'object' || settings === null) {
    return res.status(400).json({ error: 'Ungültige Daten.' });
  }
  const s = JSON.stringify(sessions);
  if (s.length > 3_000_000) return res.status(413).json({ error: 'Zu viele Daten.' });
  await getSql()`
    INSERT INTO user_data (uid, sessions, settings, updated_at)
    VALUES (${req.user.uid}, ${s}::jsonb, ${JSON.stringify(stripSecrets(settings))}::jsonb, now())
    ON CONFLICT (uid) DO UPDATE SET sessions = EXCLUDED.sessions, settings = EXCLUDED.settings, updated_at = now()`;
  res.json({ ok: true });
});

// ---------- Globaler Systemzustand (früher Firestore system/state) ----------
api.get('/system/state', requireAuth, async (req, res) => {
  const rows = await getSql()`SELECT state FROM system_state WHERE id = 1`;
  res.json(rows[0]?.state || {});
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
  // flache Zusammenführung; "locks" wird eine Ebene tief gemerged
  await getSql()`
    UPDATE system_state SET state = CASE
      WHEN ${JSON.stringify(patch)}::jsonb ? 'locks'
      THEN (state || ${JSON.stringify(patch)}::jsonb) || jsonb_build_object('locks', COALESCE(state->'locks','{}'::jsonb) || (${JSON.stringify(patch)}::jsonb->'locks'))
      ELSE state || ${JSON.stringify(patch)}::jsonb END
    WHERE id = 1`;
  res.json({ ok: true });
});

// Blockiert normale Nutzer bei Wartungsmodus / gesperrten Modellen (jetzt serverseitig)
async function enforceSystemState(req, res, next) {
  if (req.user.isOwner) return next();
  const rows = await getSql()`SELECT state FROM system_state WHERE id = 1`;
  const st = rows[0]?.state || {};
  if (st.maintenance) return res.status(503).json({ error: 'Wartungsarbeiten.' });
  const tier = req.body?.tier;
  if (tier === 'ultra' && st.locks?.ultra !== false) return res.status(403).json({ error: 'Coden Ultra ist gesperrt (nur der Owner).' }); // standardmäßig gesperrt
  if (tier === 'pro' && st.locks?.pro) return res.status(403).json({ error: 'Coden Pro ist gesperrt.' });
  if (tier === 'normal' && st.locks?.thinking) return res.status(403).json({ error: 'Coden Thinking ist gesperrt.' });
  next();
}

// ---------- Chat ----------
// Befehl /modelle: Liste aller Modelle (nur Owner) und gezielt ein Modell wählen
api.get('/models', requireAuth, (req, res) => {
  if (!req.user.isOwner) return res.status(403).json({ error: 'Nur der Owner.' });
  res.json({ models: listModels() });
});
// /model-test (nur Owner): alle Modelle mit demselben Prompt messen, Ergebnisse live als SSE
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
// Einfache Qualitäts-Checks für den Standard-Prompt (Snake): wie viele Bausteine tauchen im Code auf?
function checksOf(text) {
  return [/<\/html>/i, /<canvas|getContext|<div|<table/i, /keydown|ArrowUp/i, /game ?over/i, /neustart|restart|reset|neu starten/i, /score|punkte/i].filter(r => r.test(text)).length;
}
const pinOf = (req) => (typeof req.body?.model === 'string' && req.user.isOwner ? req.body.model.slice(0, 120) : undefined);

function validChat(body) {
  const { messages, tier } = body || {};
  if (!Array.isArray(messages) || !messages.length || messages.length > 60 || typeof tier !== 'string') return false;
  return messages.every(m => ['system', 'user', 'assistant'].includes(m.role) && typeof m.content === 'string' && m.content.length <= 100_000
    && (!m.images || (Array.isArray(m.images) && m.images.length <= 4 && m.images.every(i => typeof i === 'string' && CodenUpload.inspectImageDataUrl(i).ok))));
}

// Der App-Agent darf längere Antworten schreiben (ganze Dateien), normale Chats bleiben bei 8192
const effortOf = (b) => (byok.LEVELS.includes(b?.effort) ? b.effort : undefined); // eigene Modelle kennen mehr Stufen; die Coden-Modelle ignorieren alles außer low/medium/high
const maxTokensOf = (b) => { const n = parseInt(b?.maxTokens, 10); return Number.isFinite(n) ? Math.max(1024, Math.min(n, 16384)) : undefined; };

api.post('/chat', requireAuth, rateLimit('chat', 20, 60), enforceSystemState, gate, async (req, res) => {
  if (!validChat(req.body)) return res.status(400).json({ error: 'Ungültige Anfrage.' });
  const meter = meterFor(req);
  try {
    res.json({ content: await generate(req.body.tier, req.body.messages, { isOwner: req.user.isOwner, uid: req.user.uid, maxTokens: maxTokensOf(req.body), effort: effortOf(req.body), pin: pinOf(req), meter }) });
  } catch (e) {
    res.status(e.status || 502).json({ error: e.message, ...(e.limit ? { code: 'limit' } : {}) });
  } finally { meter.close(); }
});

// Live-Streaming (Server-Sent Events): Text kommt Stück für Stück an
api.post('/chat/stream', requireAuth, rateLimit('chat', 20, 60), enforceSystemState, gate, async (req, res) => {
  if (!validChat(req.body)) return res.status(400).json({ error: 'Ungültige Anfrage.' });
  const ac = new AbortController();
  res.on('close', () => { if (!res.writableEnded) ac.abort(); }); // Nutzer hat abgebrochen -> Anbieter nicht weiter belasten
  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  const send = (o) => { if (!res.writableEnded) res.write(`data: ${JSON.stringify(o)}\n\n`); };
  const meter = meterFor(req);
  try {
    await generateStream(req.body.tier, req.body.messages, {
      isOwner: req.user.isOwner, uid: req.user.uid, signal: ac.signal, maxTokens: maxTokensOf(req.body), effort: effortOf(req.body), pin: pinOf(req), meter,
      onModel: (m) => { if (req.user.isOwner || m.own) send({ t: 'm', model: m.id }); }, // Modellname sieht nur der Owner (und wer ein eigenes Modell gewählt hat)
      onThink: (k) => send({ t: 'k', h: k.h, v: k.v }),
      onDelta: (v) => send({ t: 'd', v })
    });
    send({ t: 'done' });
  } catch (e) {
    send({ t: 'e', error: ac.signal.aborted ? 'abgebrochen' : e.message, partial: !!e.partial, ...(e.limit ? { code: 'limit' } : {}) });
  } finally { meter.close(); }
  res.end();
});

// Hintergrund-Lauf: wie /chat/stream, aber die Antwort läuft auf dem Server zu Ende, auch wenn die Seite zu ist.
// Der Client bekommt sofort die Lauf-ID ({t:'run'}) und kann sich später per /runs/:id wieder anhängen.
api.post('/runs/chat', requireAuth, rateLimit('chat', 20, 60), enforceSystemState, gate, async (req, res) => {
  if (!validChat(req.body)) return res.status(400).json({ error: 'Ungültige Anfrage.' });
  const ref = typeof req.body.ref === 'string' && req.body.ref ? req.body.ref.slice(0, 80) : 'chat';
  const m = req.body.meta || {};
  const meta = { title: String(m.title || '').slice(0, 120), userText: String(m.userText || '').slice(0, 4000), tier: req.body.tier, ...(m.temp ? { temp: true } : {}) };
  await ensureSchema();
  const state = {
    user: { uid: req.user.uid, email: req.user.email, isOwner: req.user.isOwner }, tier: req.body.tier, messages: req.body.messages, title: meta.title,
    opts: { maxTokens: maxTokensOf(req.body), effort: effortOf(req.body), pin: pinOf(req) },
    base: baseUrl(req), self: selfUrl(req), leg: 1
  };
  const { run, done } = await startRun({ uid: req.user.uid, isOwner: req.user.isOwner, kind: 'chat', ref, meta }, (run) => chatJob(run, state));
  await serveRun(res, run, done);
});
// Nächste Etappe eines langen Chat-Laufs (ruft der Server selbst auf, mit Einmal-Schlüssel statt Login)
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

// Tabellen sicherstellen (einmal pro Serverstart), bevor Funktionen mit Datenbank laufen
const { projectsRouter } = require('../server/projects');
const { serversRouter } = require('../server/servers');
const needsDb = (req, res, next) => { ensureSchema().then(() => next(), next); };
api.use('/byok', needsDb); api.use('/buddy', needsDb); api.use('/servers', needsDb); api.use('/projects', needsDb); api.use('/apps', needsDb); api.use('/data', needsDb); api.use('/runs', needsDb); api.use('/usage', needsDb); api.use('/push', needsDb);
app.use('/a', needsDb);
// ---------- KI-Bilder für den normalen Chat (Cloudflare Flux) ----------
api.post('/image', requireAuth, rateLimit('image', 10, 300), async (req, res) => {
  try { res.json(await makeChatImage(req.user, req.body?.prompt, baseUrl(req))); }
  catch (e) { res.status(e.status || 502).json({ error: e.message }); }
});

api.use('/byok', byok.byokRouter(requireAuth));
api.use('/buddy', buddyRouter(requireAuth));
api.use('/mcp', mcpRouter(requireAuth));
api.use('/projects', projectsRouter(requireAuth));
api.use('/servers', serversRouter(requireAuth));
api.use('/runs', runsRouter(requireAuth));
api.use('/usage', usageRouter(requireAuth, requireOwner));
api.use('/push', pushRouter(requireAuth));
api.use('/apps', appsRouter(requireAuth));
api.use('/public', publicApiRouter());
app.use('/api', api);
app.use('/a', hostedRouter()); // veröffentlichte Apps: /a/<adresse>/
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Serverfehler.' });
});

module.exports = app;
