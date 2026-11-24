// Push-Benachrichtigungen (Web Push): „Coden ist fertig“ kommt auch an, wenn die Seite komplett zu ist.
// Die VAPID-Schlüssel kommen aus VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY. Fehlen sie, erzeugt der Server einmalig
// ein Paar und legt es in app_secrets/vapid (Admin/Memory) ab.
const crypto = require('crypto');
const db = require('./db');
// Erst bei Bedarf laden: ein Problem mit der Push-Bibliothek darf nie das ganze Backend (Chat!) lahmlegen
let wp = null;
const webpush = () => (wp ||= require('web-push'));

const subIdOf = (endpoint) => crypto.createHash('sha256').update(String(endpoint)).digest('hex').slice(0, 32);

let keys = null;
async function vapid() {
  if (keys) return keys;
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    keys = { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
  } else {
    try {
      const r = await db.getDoc('app_secrets/vapid', { preferAdmin: true });
      if (r?.publicKey && r?.privateKey) keys = { publicKey: r.publicKey, privateKey: r.privateKey };
      else {
        const k = webpush().generateVAPIDKeys();
        try {
          await db.createDoc('app_secrets/vapid', k, { preferAdmin: true });
          keys = k;
        } catch (e) {
          if (e.code === 'ALREADY_EXISTS') {
            const again = await db.getDoc('app_secrets/vapid', { preferAdmin: true });
            keys = again?.publicKey ? { publicKey: again.publicKey, privateKey: again.privateKey } : k;
          } else {
            throw e;
          }
        }
      }
    } catch (_) {
      // Fallback ohne Admin-Schlüssel: einmal pro Server-Instanz erzeugen
      keys = webpush().generateVAPIDKeys();
    }
  }
  webpush().setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:' + (process.env.ADMIN_EMAIL || 'admin@coden-ai.app'), keys.publicKey, keys.privateKey);
  return keys;
}

const validSub = (s) => s && typeof s.endpoint === 'string' && /^https:\/\//.test(s.endpoint) && s.endpoint.length < 1000
  && s.keys && typeof s.keys.p256dh === 'string' && typeof s.keys.auth === 'string' && s.keys.p256dh.length < 200 && s.keys.auth.length < 100;

// Nachricht an alle Geräte eines Nutzers. Abgelaufene Abos werden dabei aufgeräumt.
let sender = null; // Tests ersetzen den Versand
async function notify(uid, payload) {
  try {
    const subs = await db.runQuery('push_subs', { where: [['uid', '==', uid]], orderBy: 'created_at', desc: true, limit: 10 });
    if (!subs.length) return 0;
    await vapid();
    const body = JSON.stringify({ title: String(payload.title || 'Coden ist fertig').slice(0, 80), body: String(payload.body || '').slice(0, 180), url: String(payload.url || '/').slice(0, 300), tag: String(payload.tag || 'coden').slice(0, 60) });
    let sent = 0;
    await Promise.all(subs.map(async (s) => {
      try { await (sender || ((...a) => webpush().sendNotification(...a)))({ endpoint: s.endpoint, keys: s.keys }, body, { TTL: 3600 * 12 }); sent++; }
      catch (e) {
        if (e.statusCode === 404 || e.statusCode === 410) {
          await db.deleteDoc(`push_subs/${s._id || subIdOf(s.endpoint)}`).catch(() => {});
        }
      }
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
    const id = subIdOf(s.endpoint);
    const existing = await db.getDoc(`push_subs/${id}`);
    const payload = { uid: req.user.uid, endpoint: s.endpoint, keys: { p256dh: s.keys.p256dh, auth: s.keys.auth }, created_at: existing?.created_at || db.nowIso() };
    await db.setDoc(`push_subs/${id}`, payload);
    res.json({ ok: true });
  });
  r.post('/unsubscribe', requireAuth, async (req, res) => {
    const ep = String(req.body?.endpoint || '');
    if (ep) {
      const doc = await db.getDoc(`push_subs/${subIdOf(ep)}`);
      if (doc && doc.uid === req.user.uid) await db.deleteDoc(`push_subs/${doc._id}`);
    }
    res.json({ ok: true });
  });
  r.post('/test', requireAuth, async (req, res) => res.json({ sent: await notify(req.user.uid, { title: 'Coden', body: 'Benachrichtigungen sind an. So meldet sich Coden, wenn eine Aufgabe fertig ist.', tag: 'coden-test' }) }));
  return r;
}

module.exports = { notify, preview, pushRouter, vapid, _setSender: (f) => { sender = f; } };
