// Lern-Studio auf dem Server:
// 1) Heft-Seiten (Handschrift wie GoodNotes): Striche, Hintergrund (Arbeitsblatt-Foto), Papier, Korrektur von Coden.
//    Liegen pro Nutzer unter study/<uid>/pages/<id> – zu groß für die normalen Einstellungen.
// 2) Erinnerungen (Arbeit in 3 Tagen, Abgabe morgen, Lerneinheit gleich): die App schickt die nächsten Termine,
//    der Server verschickt sie als Push, sobald sie fällig sind (über den Cron-Eingang und nebenbei bei Anfragen).
const express = require('express');
const db = require('./db');
const { notify } = require('./push');
const { rateLimit } = require('./rateLimit');
const { wrapRouter } = require('./util');

let waitUntil = () => {};
try { waitUntil = require('@vercel/functions').waitUntil; } catch (_) { /* lokal ohne Vercel */ }

const LIMITS = { strokes: 4_000_000, bg: 3_500_000, item: 1_800_000, items: 30, page: 7_000_000, pagesPerDoc: 300, reminders: 80, text: 160, hand: 1_500_000 };
const ID_RE = /^[A-Za-z0-9_-]{4,64}$/;
const IMG_RE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;
const PAPERS = ['blanko', 'liniert', 'eng', 'karo', 'punkte', 'cornell', 'noten'];
const fail = (status, error) => Object.assign(new Error(error), { status });
const str = (v, n) => String(v ?? '').replace(/\u0000/g, '').slice(0, n);
const pagePath = (uid, id) => `study/${uid}/pages/${id}`;

// Korrektur von Coden: nur erwartete Felder, gekürzt
function cleanCorrection(c) {
  if (!c || typeof c !== 'object') return null;
  const items = (Array.isArray(c.items) ? c.items : []).slice(0, 30).map(i => ({
    y: Math.max(0, Math.min(1, Number(i?.y) || 0)), ok: !!i?.ok, text: str(i?.text, 300), fix: str(i?.fix, 400)
  }));
  return { grade: str(c.grade, 12), points: str(c.points, 20), score: Math.max(0, Math.min(100, Math.round(Number(c.score) || 0))), summary: str(c.summary, 1500), tips: (Array.isArray(c.tips) ? c.tips : []).slice(0, 6).map(t => str(t, 240)), items, at: str(c.at, 40) || new Date().toISOString() };
}

function cleanPage(body, id) {
  const b = body || {};
  if (typeof b.doc !== 'string' || !ID_RE.test(b.doc)) throw fail(400, 'Ungültiges Heft.');
  const strokes = typeof b.strokes === 'string' ? b.strokes : '';
  if (strokes.length > LIMITS.strokes) throw fail(413, 'Die Seite ist zu voll – leg eine neue Seite an.');
  let bg = null;
  if (b.bg != null && b.bg !== '') {
    if (typeof b.bg !== 'string' || b.bg.length > LIMITS.bg) throw fail(413, 'Das Hintergrundbild ist zu groß.');
    if (!IMG_RE.test(b.bg)) throw fail(400, 'Das Hintergrundbild ist kein gültiges Bild.');
    bg = b.bg;
  }
  return {
    id, doc: b.doc, idx: Math.max(0, Math.min(999, parseInt(b.idx, 10) || 0)),
    paper: PAPERS.includes(b.paper) ? b.paper : 'liniert',
    strokes, bg, correction: cleanCorrection(b.correction),
    text: (Array.isArray(b.text) ? b.text : []).slice(0, 200).map(t => ({ x: +t?.x || 0, y: +t?.y || 0, s: str(t?.s, 2000), c: str(t?.c, 9), z: Math.max(8, Math.min(120, +t?.z || 18)) })),
    // eingefügte Bilder (verschiebbar, wie in GoodNotes)
    items: (Array.isArray(b.items) ? b.items : []).slice(0, LIMITS.items).map(i => {
      if (!i || typeof i.src !== 'string' || i.src.length > LIMITS.item || !IMG_RE.test(i.src)) throw fail(413, 'Ein eingefügtes Bild ist zu groß oder kein Bild.');
      const n = (v, d) => (Number.isFinite(+v) ? Math.max(-2000, Math.min(4000, +v)) : d);
      return { id: str(i.id, 30) || 'im', type: 'img', x: n(i.x, 0), y: n(i.y, 0), w: Math.max(4, n(i.w, 200)), h: Math.max(4, n(i.h, 200)), src: i.src };
    })
  };
}

// Handschrift-Profil im Format „coden-hand“ (vom Skill meine-handschrift): nur grob prüfen, die App normalisiert
function cleanHandMaster(p) {
  if (!p || typeof p !== 'object' || p.format !== 'coden-hand' || !p.g || typeof p.g !== 'object' || Array.isArray(p.g)) throw fail(400, 'Keine gültige Handschrift-Datei (coden-hand).');
  const chars = Object.keys(p.g);
  if (chars.length < 10 || chars.length > 400) throw fail(400, 'Die Handschrift-Datei hat zu wenige oder zu viele Zeichen.');
  if (!chars.every(k => [...k].length === 1 && Array.isArray(p.g[k]))) throw fail(400, 'Die Handschrift-Datei ist beschädigt.');
  const out = { format: 'coden-hand', v: 2, name: str(p.name, 40) || 'Kaydens', style: p.style && typeof p.style === 'object' && !Array.isArray(p.style) ? p.style : {}, g: p.g, w: p.w && typeof p.w === 'object' && !Array.isArray(p.w) ? p.w : {} };
  if (JSON.stringify(out).length > LIMITS.hand) throw fail(413, 'Die Handschrift-Datei ist zu groß.');
  return out;
}

const meta = (p) => ({ id: p._id || p.id, doc: p.doc, idx: p.idx, paper: p.paper, hasBg: !!p.bg, items: (p.items || []).length, corrected: !!p.correction, score: p.correction?.score ?? null, updatedAt: p.updated_at });

// ---------- Erinnerungen ----------
function cleanReminders(items) {
  if (!Array.isArray(items)) throw fail(400, 'Ungültige Erinnerungen.');
  return items.slice(0, LIMITS.reminders).map(i => {
    const at = Date.parse(i?.at);
    if (!Number.isFinite(at) || typeof i?.id !== 'string' || !/^[\w:.-]{1,80}$/.test(i.id)) return null;
    return { id: i.id, at: new Date(at).toISOString(), title: str(i.title, 80) || 'Coden Lern-Studio', body: str(i.body, LIMITS.text), url: /^\/[#\w/?=&.-]*$/.test(String(i.url || '')) ? String(i.url).slice(0, 120) : '/#/lernen' };
  }).filter(Boolean);
}

// Fällige Erinnerungen aller Nutzer verschicken (nur einmal je Erinnerung, höchstens 36 h verspätet)
async function dispatchDue(now = Date.now()) {
  let sent = 0;
  const docs = await db.listDocs('study_reminders', { limit: 500 }).catch(() => []);
  for (const d of docs) {
    const done = { ...(d.sent || {}) }; let changed = false;
    for (const it of d.items || []) {
      const at = Date.parse(it.at);
      if (done[it.id] || !(at <= now) || now - at > 36 * 3600e3) continue;
      done[it.id] = new Date(now).toISOString(); changed = true;
      sent += (await notify(d.uid, { title: it.title, body: it.body, url: it.url, tag: 'study-' + it.id.slice(0, 40) })) ? 1 : 0;
    }
    if (changed) {
      // alte Einträge (älter als 3 Tage) vergessen, damit das Dokument klein bleibt
      for (const k of Object.keys(done)) if (now - Date.parse(done[k]) > 3 * 864e5) delete done[k];
      await db.updateDoc(`study_reminders/${d._id}`, { sent: done }).catch(() => {});
    }
  }
  return sent;
}
// Nebenbei bei Anfragen prüfen (höchstens einmal pro Minute und Server-Instanz)
let lastCheck = 0;
function maybeDispatch() {
  if (Date.now() - lastCheck < 60_000) return;
  lastCheck = Date.now();
  waitUntil(dispatchDue().catch(e => console.warn('[study] Erinnerungen', e.message)));
}

function studyRouter(requireAuth) {
  const r = wrapRouter(express.Router());
  r.use(requireAuth);
  r.use((req, res, next) => { maybeDispatch(); next(); });
  const pid = (req) => { const id = String(req.params.id || ''); if (!ID_RE.test(id)) throw fail(400, 'Ungültige Seite.'); return id; };

  // Seiten eines Hefts (ohne große Daten)
  r.get('/pages', async (req, res) => {
    const doc = String(req.query.doc || '');
    const rows = await db.listDocs(`study/${req.user.uid}/pages`, { limit: 1000 });
    res.json({ pages: rows.filter(p => !doc || p.doc === doc).sort((a, b) => a.idx - b.idx).map(meta) });
  });
  r.get('/pages/:id', async (req, res) => {
    const p = await db.getDoc(pagePath(req.user.uid, pid(req)));
    if (!p) throw fail(404, 'Seite nicht gefunden.');
    res.json({ page: { ...cleanPage(p, p._id || p.id), updatedAt: p.updated_at } });
  });
  r.put('/pages/:id', rateLimit('study-page', 240, 60), async (req, res) => {
    const id = pid(req); const page = cleanPage(req.body, id);
    if (JSON.stringify(page).length > LIMITS.page) throw fail(413, 'Die Seite ist zu groß.');
    const existing = await db.listDocs(`study/${req.user.uid}/pages`, { limit: 1000 });
    if (!existing.some(p => (p._id || p.id) === id) && existing.filter(p => p.doc === page.doc).length >= LIMITS.pagesPerDoc) throw fail(400, `Höchstens ${LIMITS.pagesPerDoc} Seiten pro Heft.`);
    const old = existing.find(p => (p._id || p.id) === id);
    if (req.body?.keepBg && old?.bg && !page.bg) page.bg = (await db.getDoc(pagePath(req.user.uid, id)))?.bg || null;
    if (req.body?.correction === undefined && old?.correction) page.correction = old.correction; // Korrektur bleibt beim Weiterschreiben
    await db.setDoc(pagePath(req.user.uid, id), { ...page, uid: req.user.uid, updated_at: db.nowIso() });
    res.json({ ok: true, page: meta({ ...page, updated_at: db.nowIso() }) });
  });
  r.delete('/pages/:id', async (req, res) => {
    await db.deleteDoc(pagePath(req.user.uid, pid(req))).catch(() => {});
    res.json({ ok: true });
  });
  // ganzes Heft löschen
  r.delete('/docs/:id', async (req, res) => {
    const doc = pid(req);
    const rows = await db.listDocs(`study/${req.user.uid}/pages`, { limit: 1000 });
    await Promise.all(rows.filter(p => p.doc === doc).map(p => db.deleteDoc(pagePath(req.user.uid, p._id || p.id)).catch(() => {})));
    res.json({ ok: true });
  });

  // Kaydens Handschrift (Profil „Kaydens“): liegt NUR in der Datenbank, nie im öffentlichen Repo.
  // Lesen und Speichern darf ausschließlich der Owner (ADMIN_EMAIL, bestätigt) – alle anderen trainieren ihre eigene.
  const handPath = (req) => `study/${req.user.uid}/hand/master`;
  const ownerOnly = (req, res) => { res.set('Cache-Control', 'private, no-store'); if (!req.user.isOwner) throw fail(404, 'Nicht gefunden.'); };
  r.get('/hand-master', async (req, res) => {
    ownerOnly(req, res);
    const d = await db.getDoc(handPath(req));
    res.json({ profile: d?.profile || null, updatedAt: d?.updated_at || null });
  });
  r.put('/hand-master', rateLimit('study-hand', 20, 600), async (req, res) => {
    ownerOnly(req, res);
    const profile = cleanHandMaster(req.body?.profile);
    await db.setDoc(handPath(req), { uid: req.user.uid, profile, updated_at: db.nowIso() });
    res.json({ ok: true, glyphs: Object.keys(profile.g).length });
  });
  r.delete('/hand-master', async (req, res) => {
    ownerOnly(req, res);
    await db.deleteDoc(handPath(req)).catch(() => {});
    res.json({ ok: true });
  });

  // Erinnerungen ersetzen (die App rechnet sie aus Arbeiten, Abgaben und dem Lernplan aus)
  r.put('/reminders', rateLimit('study-rem', 30, 60), async (req, res) => {
    const items = cleanReminders(req.body?.items);
    const path = `study_reminders/${req.user.uid}`;
    const old = await db.getDoc(path);
    await db.setDoc(path, { uid: req.user.uid, items, sent: old?.sent || {}, updated_at: db.nowIso() });
    res.json({ ok: true, count: items.length });
  });
  r.get('/reminders', async (req, res) => {
    const d = await db.getDoc(`study_reminders/${req.user.uid}`);
    res.json({ items: d?.items || [], sent: d?.sent || {} });
  });
  return r;
}

module.exports = { studyRouter, dispatchDue, maybeDispatch, cleanPage, cleanCorrection, cleanReminders, cleanHandMaster, LIMITS };
