// Einziger Vercel-Einstiegspunkt: Express-Backend für Coden AI
const express = require('express');
const nodemailer = require('nodemailer');
const { getSql } = require('../server/db');
const { requireAuth, requireOwner } = require('../server/auth');
const { rateLimit } = require('../server/rateLimit');
const { generate, generateStream } = require('../server/ai');
const { buddyRouter } = require('../server/buddy');
const { appsRouter, publicApiRouter, hostedRouter, baseUrl } = require('../server/apps');
const { generateImage } = require('../server/images');
const crypto = require('crypto');
const { mcpRouter } = require('../server/mcp');
const CodenUpload = require('../shared/upload-check');
const { wrapRouter } = require('../server/util');

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '4mb' }));
app.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

const api = express.Router();
wrapRouter(api);

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
      if (!['pro', 'thinking'].includes(param)) return res.status(400).json({ error: 'Nutze pro oder thinking.' });
      patch = { locks: { [param]: cmd === 'lock' } }; break;
    }
    case 'broadcast': patch = { broadcast: { message: String(param || '').slice(0, 500), time: now } }; break;
    case 'forceupdate': patch = { forceUpdate: now }; break;
    case 'maintenance': patch = { maintenance: param === 'on' }; break;
    case 'model': patch = { globalModel: ['flash', 'normal', 'pro'].includes(param) ? param : null }; break;
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
  if (tier === 'pro' && st.locks?.pro) return res.status(403).json({ error: 'Coden Pro ist gesperrt.' });
  if (tier === 'normal' && st.locks?.thinking) return res.status(403).json({ error: 'Coden Thinking ist gesperrt.' });
  next();
}

// ---------- Chat ----------
function validChat(body) {
  const { messages, tier } = body || {};
  if (!Array.isArray(messages) || !messages.length || messages.length > 60 || typeof tier !== 'string') return false;
  return messages.every(m => ['system', 'user', 'assistant'].includes(m.role) && typeof m.content === 'string' && m.content.length <= 100_000
    && (!m.images || (Array.isArray(m.images) && m.images.length <= 4 && m.images.every(i => typeof i === 'string' && CodenUpload.inspectImageDataUrl(i).ok))));
}

// Der App-Agent darf längere Antworten schreiben (ganze Dateien), normale Chats bleiben bei 8192
const maxTokensOf = (b) => { const n = parseInt(b?.maxTokens, 10); return Number.isFinite(n) ? Math.max(1024, Math.min(n, 16384)) : undefined; };

api.post('/chat', requireAuth, rateLimit('chat', 20, 60), enforceSystemState, async (req, res) => {
  if (!validChat(req.body)) return res.status(400).json({ error: 'Ungültige Anfrage.' });
  try {
    res.json({ content: await generate(req.body.tier, req.body.messages, { isOwner: req.user.isOwner, maxTokens: maxTokensOf(req.body) }) });
  } catch (e) {
    res.status(e.status || 502).json({ error: e.message });
  }
});

// Live-Streaming (Server-Sent Events): Text kommt Stück für Stück an
api.post('/chat/stream', requireAuth, rateLimit('chat', 20, 60), enforceSystemState, async (req, res) => {
  if (!validChat(req.body)) return res.status(400).json({ error: 'Ungültige Anfrage.' });
  const ac = new AbortController();
  res.on('close', () => { if (!res.writableEnded) ac.abort(); }); // Nutzer hat abgebrochen -> Anbieter nicht weiter belasten
  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  const send = (o) => { if (!res.writableEnded) res.write(`data: ${JSON.stringify(o)}\n\n`); };
  try {
    await generateStream(req.body.tier, req.body.messages, {
      isOwner: req.user.isOwner, signal: ac.signal, maxTokens: maxTokensOf(req.body),
      onModel: (m) => send({ t: 'm', model: m.id }),
      onDelta: (v) => send({ t: 'd', v })
    });
    send({ t: 'done' });
  } catch (e) {
    send({ t: 'e', error: ac.signal.aborted ? 'abgebrochen' : e.message, partial: !!e.partial });
  }
  res.end();
});

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
  const key = process.env.GOOGLE_API_KEY;
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
const { ensureSchema } = require('../server/schema');
const needsDb = (req, res, next) => { ensureSchema().then(() => next(), next); };
api.use('/buddy', needsDb); api.use('/apps', needsDb); api.use('/data', needsDb);
app.use('/a', needsDb);
// ---------- KI-Bilder für den normalen Chat (Cloudflare Flux) ----------
api.post('/image', requireAuth, rateLimit('image', 10, 300), async (req, res) => {
  const prompt = String(req.body?.prompt || '').trim().slice(0, 1500);
  if (prompt.length < 3) return res.status(400).json({ error: 'Beschreibe das Bild kurz.' });
  const [{ n }] = await getSql()`SELECT count(*)::int AS n FROM app_images WHERE uid = ${req.user.uid}`;
  if (n >= 300 && !req.user.isOwner) return res.status(400).json({ error: 'Du hast das Bild-Limit erreicht (300).' });
  let img;
  try { img = await generateImage(prompt); } catch (e) { return res.status(e.status || 502).json({ error: e.message }); }
  const key = crypto.randomBytes(9).toString('hex');
  await getSql()`INSERT INTO app_images (key, uid, prompt, mime, data) VALUES (${key}, ${req.user.uid}, ${prompt}, ${img.mime}, ${img.data})`;
  res.json({ key, url: `${baseUrl(req)}/api/public/img/${key}` });
});

api.use('/buddy', buddyRouter(requireAuth));
api.use('/mcp', mcpRouter(requireAuth));
api.use('/apps', appsRouter(requireAuth));
api.use('/public', publicApiRouter());
app.use('/api', api);
app.use('/a', hostedRouter()); // veröffentlichte Apps: /a/<adresse>/
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Serverfehler.' });
});

module.exports = app;
