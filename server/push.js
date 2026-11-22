// Push-Benachrichtigungen (Web Push): „Coden ist fertig“ kommt auch an, wenn die Seite komplett zu ist.
// Die VAPID-Schlüssel kommen aus VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY. Fehlen sie, erzeugt der Server einmalig
// ein Paar und legt es in app_secrets ab (nie in system_state, das jeder Nutzer lesen darf).
const webpush = require('web-push');
const { getSql } = require('./db');

let keys = null;
async function vapid() {
  if (keys) return keys;
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) keys = { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
  else {
    const sql = getSql();
    const [r] = await sql`SELECT value FROM app_secrets WHERE name = 'vapid'`;
    if (r) keys = r.value;
    else {
      const k = webpush.generateVAPIDKeys();
      await sql`INSERT INTO app_secrets (name, value) VALUES ('vapid', ${JSON.stringify(k)}::jsonb) ON CONFLICT (name) DO NOTHING`;
      const [again] = await sql`SELECT value FROM app_secrets WHERE name = 'vapid'`; // gleichzeitig gestartete Server nutzen dasselbe Paar
      keys = again.value;
    }
  }
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:' + (process.env.ADMIN_EMAIL || 'admin@coden-ai.app'), keys.publicKey, keys.privateKey);
  return keys;
}

const validSub = (s) => s && typeof s.endpoint === 'string' && /^https:\/\//.test(s.endpoint) && s.endpoint.length < 1000
  && s.keys && typeof s.keys.p256dh === 'string' && typeof s.keys.auth === 'string' && s.keys.p256dh.length < 200 && s.keys.auth.length < 100;

// Nachricht an alle Geräte eines Nutzers. Abgelaufene Abos werden dabei aufgeräumt.
let sender = null; // Tests ersetzen den Versand
async function notify(uid, payload) {
  try {
    const subs = await getSql()`SELECT endpoint, keys FROM push_subs WHERE uid = ${uid} ORDER BY created_at DESC LIMIT 10`;
    if (!subs.length) return 0;
    await vapid();
    const body = JSON.stringify({ title: String(payload.title || 'Coden ist fertig').slice(0, 80), body: String(payload.body || '').slice(0, 180), url: String(payload.url || '/').slice(0, 300), tag: String(payload.tag || 'coden').slice(0, 60) });
    let sent = 0;
    await Promise.all(subs.map(async (s) => {
      try { await (sender || webpush.sendNotification)({ endpoint: s.endpoint, keys: s.keys }, body, { TTL: 3600 * 12 }); sent++; }
      catch (e) { if (e.statusCode === 404 || e.statusCode === 410) await getSql()`DELETE FROM push_subs WHERE endpoint = ${s.endpoint}`.catch(() => {}); }
    }));
    return sent;
  } catch (e) { console.warn('[push]', e.message); return 0; }
}
// Kurzfassung einer Antwort für die Benachrichtigung
const preview = (t) => String(t || '').replace(/<[^>]+>/g, ' ').replace(/```[\s\S]*?```/g, ' [Code] ').replace(/[#*`>_~|]/g, '').replace(/\s+/g, ' ').trim().slice(0, 160);

function pushRouter(requireAuth) {
  const express = require('express'); const { wrapRouter } = require('./util');
  const r = wrapRouter(express.Router());
  r.get('/key', requireAuth, async (req, res) => res.json({ key: (await vapid()).publicKey }));
  r.post('/subscribe', requireAuth, async (req, res) => {
    const s = req.body?.sub; if (!validSub(s)) return res.status(400).json({ error: 'Ungültiges Abo.' });
    await getSql()`INSERT INTO push_subs (endpoint, uid, keys) VALUES (${s.endpoint}, ${req.user.uid}, ${JSON.stringify({ p256dh: s.keys.p256dh, auth: s.keys.auth })}::jsonb)
      ON CONFLICT (endpoint) DO UPDATE SET uid = EXCLUDED.uid, keys = EXCLUDED.keys`;
    res.json({ ok: true });
  });
  r.post('/unsubscribe', requireAuth, async (req, res) => {
    await getSql()`DELETE FROM push_subs WHERE uid = ${req.user.uid} AND endpoint = ${String(req.body?.endpoint || '')}`;
    res.json({ ok: true });
  });
  r.post('/test', requireAuth, async (req, res) => res.json({ sent: await notify(req.user.uid, { title: 'Coden', body: 'Benachrichtigungen sind an. So meldet sich Coden, wenn eine Aufgabe fertig ist.', tag: 'coden-test' }) }));
  return r;
}

module.exports = { notify, preview, pushRouter, vapid, _setSender: (f) => { sender = f; } };
