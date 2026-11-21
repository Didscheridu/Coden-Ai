// Einziger Vercel-Einstiegspunkt: Express-Backend für Coden AI
const express = require('express');
const nodemailer = require('nodemailer');
const { getSql } = require('../server/db');
const { requireAuth, requireOwner } = require('../server/auth');
const { rateLimit } = require('../server/rateLimit');
const { generate } = require('../server/ai');

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '4mb' }));
app.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

const api = express.Router();
// Express 4 fängt Fehler in async-Handlern nicht selbst ab -> weiterreichen
for (const m of ['get', 'put', 'post']) {
  const orig = api[m].bind(api);
  api[m] = (path, ...hs) => orig(path, ...hs.map(h => (req, res, next) => Promise.resolve(h(req, res, next)).catch(next)));
}

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
api.post('/chat', requireAuth, rateLimit('chat', 20, 60), enforceSystemState, async (req, res) => {
  const { messages, tier } = req.body || {};
  if (!Array.isArray(messages) || !messages.length || messages.length > 60 || typeof tier !== 'string') {
    return res.status(400).json({ error: 'Ungültige Anfrage.' });
  }
  for (const m of messages) {
    if (!['system', 'user', 'assistant'].includes(m.role) || typeof m.content !== 'string' || m.content.length > 100_000
      || (m.images && (!Array.isArray(m.images) || m.images.length > 4 || m.images.some(i => typeof i !== 'string' || !i.startsWith('data:image/'))))) {
      return res.status(400).json({ error: 'Ungültige Nachricht.' });
    }
  }
  try {
    res.json({ content: await generate(tier, messages) });
  } catch (e) {
    res.status(e.status || 502).json({ error: e.message });
  }
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

app.use('/api', api);
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Serverfehler.' });
});

module.exports = app;
