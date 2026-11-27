// Design: Social-Media-Designs (Instagram Post, Story, Karussell) – Layout als HTML/CSS von der Coding-KI,
// Bilder von der Bild-KI. Gespeichert in Firestore (user_designs/{id}), Bilder wie alle KI-Bilder in app_images.
const crypto = require('crypto');
const express = require('express');
const db = require('./db');
const { rateLimit } = require('./rateLimit');
const { wrapRouter } = require('./util');

const LIMITS = { designs: 100, title: 80, head: 20_000, body: 300_000, messages: 30, message: 2000, slides: 10, upload: 700_000, images: 300, minDim: 200, maxDim: 4000 };
const FORMATS = ['square', 'portrait', 'story', 'carousel', 'youtube', 'presentation', 'linkedin', 'poster', 'custom'];
const fail = (status, message) => Object.assign(new Error(message), { status });
const str = (v, n) => String(v ?? '').replace(/\u0000/g, '').slice(0, n);
const toInt = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) && n > 0 ? n : 0; };
const clampDim = (v) => { const n = toInt(v); return n ? Math.max(LIMITS.minDim, Math.min(LIMITS.maxDim, n)) : 0; };
const iso = (d) => (d instanceof Date ? d.toISOString() : d || null);
// data:-Adressen gehören nicht ins Dokument (1-MB-Grenze von Firestore) – Bilder laufen über /upload
const noDataUrls = (s) => (/(?:src|href)\s*=\s*["']?\s*data:/i.test(s) ? fail(400, 'Bilder bitte hochladen statt einbetten.') : null);

function clean(b, prev = {}) {
  const out = {};
  if ('title' in b) out.title = str(b.title, LIMITS.title).trim() || 'Neues Design';
  if ('format' in b) { if (!FORMATS.includes(b.format)) throw fail(400, 'Unbekanntes Format.'); out.format = b.format; }
  if ('width' in b) { const w = clampDim(b.width); if (w) out.width = w; }
  if ('height' in b) { const h = clampDim(b.height); if (h) out.height = h; }
  if ('slides' in b) out.slides = Math.max(1, Math.min(LIMITS.slides, toInt(b.slides) || 1));
  if ('head' in b) { if (String(b.head || '').length > LIMITS.head) throw fail(400, 'Der Kopf des Designs ist zu groß.'); out.head = str(b.head, LIMITS.head); }
  if ('body' in b) { if (String(b.body || '').length > LIMITS.body) throw fail(400, 'Das Design ist zu groß.'); out.body = str(b.body, LIMITS.body); const e = noDataUrls(out.body); if (e) throw e; }
  if ('messages' in b) {
    if (!Array.isArray(b.messages)) throw fail(400, 'Ungültiger Verlauf.');
    out.messages = b.messages.slice(-LIMITS.messages).map(m => ({ role: m?.role === 'user' ? 'user' : 'ai', text: str(m?.text, LIMITS.message) }));
  }
  if (!out.title && !prev.title) out.title = 'Neues Design';
  return out;
}
const meta = (d) => ({
  id: Number(d.id), title: d.title, format: d.format, slides: d.slides || 1,
  ...(d.width ? { width: Number(d.width) } : {}), ...(d.height ? { height: Number(d.height) } : {}),
  updatedAt: iso(d.updated_at), createdAt: iso(d.created_at)
});
const full = (d) => ({ ...meta(d), head: d.head || '', body: d.body || '', messages: Array.isArray(d.messages) ? d.messages : [] });

async function countImages(uid) { return (await db.runQuery('app_images', { where: [['uid', '==', uid]] }).catch(() => [])).length; }
const baseOf = (req) => `${req.headers['x-forwarded-proto'] || req.protocol}://${req.headers['x-forwarded-host'] || req.headers.host}`.replace(/\/$/, '');

// Eigenes Bild hochladen (Brand-Logo, Foto statt KI-Bild): data:image/png|jpeg|webp;base64,…
async function storeUpload(user, dataUrl, base) {
  const m = String(dataUrl || '').match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!m) throw fail(400, 'Nur PNG-, JPEG- oder WebP-Bilder.');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length < 64) throw fail(400, 'Das Bild ist leer.');
  if (buf.length > LIMITS.upload) throw fail(400, 'Das Bild ist zu groß (höchstens 700 KB nach dem Verkleinern).');
  const sig = { 'image/png': [0x89, 0x50, 0x4e, 0x47], 'image/jpeg': [0xff, 0xd8, 0xff], 'image/webp': [0x52, 0x49, 0x46, 0x46] }[m[1]];
  if (!sig.every((b, i) => buf[i] === b)) throw fail(400, 'Die Datei ist kein echtes Bild.');
  if (!user.isOwner && await countImages(user.uid) >= LIMITS.images) throw fail(400, 'Du hast das Bild-Limit erreicht (300).');
  const key = crypto.randomBytes(9).toString('hex');
  await db.createDoc(`app_images/${key}`, { key, uid: user.uid, mime: m[1], data_b64: buf.toString('base64'), created_at: db.nowIso() });
  return { key, url: `${base}/api/public/img/${key}` };
}

function designsRouter(requireAuth, { makeImage }) {
  const r = wrapRouter(express.Router());
  r.use(requireAuth);
  const mine = async (req) => {
    const id = toInt(req.params.id); if (!id) throw fail(404, 'Design nicht gefunden.');
    const d = await db.getDoc(`user_designs/${id}`);
    if (!d || d.uid !== req.user.uid) throw fail(404, 'Design nicht gefunden.');
    return d;
  };

  r.get('/', async (req, res) => {
    const list = await db.runQuery('user_designs', { where: [['uid', '==', req.user.uid]], orderBy: 'updated_at', desc: true, limit: LIMITS.designs });
    res.json({ designs: list.map(meta) });
  });
  r.post('/', rateLimit('designs-new', 60, 600), async (req, res) => {
    const list = await db.runQuery('user_designs', { where: [['uid', '==', req.user.uid]] });
    if (list.length >= LIMITS.designs) throw fail(400, `Du hast schon ${LIMITS.designs} Designs. Lösche ein paar alte.`);
    const b = clean(req.body || {});
    const id = db.nextId(); const now = db.nowIso();
    const d = await db.createDoc(`user_designs/${id}`, {
      id, uid: req.user.uid, title: b.title, format: b.format || 'square', slides: b.slides || 1,
      ...(b.width ? { width: b.width } : {}), ...(b.height ? { height: b.height } : {}),
      head: b.head || '', body: b.body || '', messages: b.messages || [], created_at: now, updated_at: now
    });
    res.json({ design: full(d) });
  });
  r.get('/:id', async (req, res) => res.json({ design: full(await mine(req)) }));
  r.patch('/:id', rateLimit('designs-save', 240, 60), async (req, res) => {
    const d = await mine(req);
    const patch = { ...clean(req.body || {}, d), updated_at: db.nowIso() };
    res.json({ design: meta(await db.updateDoc(`user_designs/${d.id}`, patch) || { ...d, ...patch }) });
  });
  r.delete('/:id', async (req, res) => {
    const d = await mine(req);
    await db.deleteDoc(`user_designs/${d.id}`);
    res.json({ ok: true });
  });

  // Bild-KI für Designs (eigenes, etwas großzügigeres Limit als im Chat: ein Karussell braucht mehrere Bilder)
  r.post('/image', rateLimit('design-img', 24, 300), async (req, res) => {
    const p = str(req.body?.prompt, 1500).trim();
    if (p.length < 3) throw fail(400, 'Beschreibe das Bild kurz.');
    // Bild-KI soll nie Schrift malen – die Texte macht das HTML
    const prompt = /no text/i.test(p) ? p : `${p}. No text, no letters, no words, no logos, no watermark.`;
    res.json(await makeImage(req.user, prompt, baseOf(req)));
  });
  r.post('/upload', rateLimit('design-upload', 30, 300), async (req, res) => res.json(await storeUpload(req.user, req.body?.dataUrl, baseOf(req))));

  r.use((err, req, res, next) => { if (err.status) return res.status(err.status).json({ error: err.message }); console.error('[designs]', err); res.status(500).json({ error: 'Serverfehler.' }); });
  return r;
}

module.exports = { designsRouter, storeUpload, LIMITS, FORMATS };
