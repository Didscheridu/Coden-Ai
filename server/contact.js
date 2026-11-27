// Kontaktformular-API (§ 5 DDG / DSA): validiert Anfragen, speichert sie in Firestore und verschickt optional per SMTP / Push.
const express = require('express');
const nodemailer = require('nodemailer');
const { createRemoteJWKSet, jwtVerify } = require('jose');
const db = require('./db');
const { runWithDbContext } = require('./firestore');
const { rateLimit, byIp } = require('./rateLimit');
const { wrapRouter } = require('./util');

const PROJECT_ID = () => process.env.FIREBASE_PROJECT_ID || 'coden-4561f';
const JWKS_URL = () => process.env.FIREBASE_JWKS_URL || 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
const adminEmail = () => (process.env.ADMIN_EMAIL || 'kayden.schunack@gmail.com').trim().toLowerCase();

let jwks;
const getJwks = () => (jwks ||= createRemoteJWKSet(new URL(JWKS_URL())));

const TOPICS = new Set(['allgemein', 'datenschutz', 'dsa', 'bug', 'sonstiges']);
const TOPIC_LABELS = {
  allgemein: 'Allgemein & Feedback',
  datenschutz: 'Datenschutz / DSGVO',
  dsa: 'Inhalt melden (DSA)',
  bug: 'Fehler / Bug melden',
  sonstiges: 'Sonstiges'
};
const EMAIL_RE = /^[^\s@,;<>()]+@[^\s@,;<>()]+\.[^\s@,;<>()]{2,}$/;

const cleanLine = (val, max) => String(val ?? '').replace(/[\r\n\u0000-\u001f]+/g, ' ').trim().slice(0, max);
const cleanText = (val, max) => String(val ?? '').replace(/\u0000/g, '').trim().slice(0, max);

async function verifyOptionalAuth(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getJwks(), {
      issuer: `https://securetoken.google.com/${PROJECT_ID()}`,
      audience: PROJECT_ID(),
      algorithms: ['RS256']
    });
    if (!payload.sub) return null;
    const email = String(payload.email || '').toLowerCase();
    return {
      token,
      uid: payload.sub,
      email: payload.email || null,
      emailVerified: payload.email_verified === true,
      isOwner: !!adminEmail() && payload.email_verified === true && email === adminEmail()
    };
  } catch (_) {
    return null;
  }
}

function validateContactPayload(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'Ungültige Formulardaten.' };
  }
  // Honeypot gegen automatisierte Bots
  if (typeof body.website === 'string' && body.website.trim().length > 0) {
    return { spam: true };
  }
  if (
    typeof body.name !== 'string' ||
    typeof body.email !== 'string' ||
    typeof body.subject !== 'string' ||
    typeof body.message !== 'string'
  ) {
    return { error: 'Bitte fülle alle Pflichtfelder korrekt aus.' };
  }
  const name = cleanLine(body.name, 100);
  const email = cleanLine(body.email, 200).toLowerCase();
  const topic = typeof body.topic === 'string' && TOPICS.has(body.topic) ? body.topic : 'allgemein';
  const subject = cleanLine(body.subject, 140);
  const message = cleanText(body.message, 4000);

  if (name.length < 2) return { error: 'Bitte gib deinen Namen ein (mindestens 2 Zeichen).' };
  if (!EMAIL_RE.test(email)) return { error: 'Bitte gib eine gültige E-Mail-Adresse ein.' };
  if (subject.length < 3) return { error: 'Bitte gib einen Betreff ein (mindestens 3 Zeichen).' };
  if (message.length < 10) return { error: 'Deine Nachricht muss mindestens 10 Zeichen lang sein.' };
  if (body.privacyAccepted !== true) return { error: 'Bitte bestätige die Datenschutzhinweise.' };

  return { data: { name, email, topic, subject, message } };
}

async function sendOptionalSmtpEmail(record) {
  const host = (process.env.CONTACT_SMTP_HOST || '').trim();
  const user = (process.env.CONTACT_SMTP_USER || '').trim();
  const pass = process.env.CONTACT_SMTP_PASS || '';
  if (!host || !user || !pass) return false;

  const port = Number(process.env.CONTACT_SMTP_PORT || 465);
  const secure = process.env.CONTACT_SMTP_SECURE ? process.env.CONTACT_SMTP_SECURE === 'true' : port === 465;
  const to = (process.env.CONTACT_TO_EMAIL || adminEmail() || 'kayden.schunack@gmail.com').trim();
  const label = TOPIC_LABELS[record.topic] || 'Anfrage';

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass }
  });

  await transporter.sendMail({
    from: `"Coden AI Kontaktformular" <${user}>`,
    to,
    replyTo: record.email,
    subject: `[Coden AI · ${label}] ${record.subject}`.slice(0, 200),
    text: [
      `Neue Kontaktanfrage (#${record.id})`,
      `Thema: ${label}`,
      `Name: ${record.name}`,
      `E-Mail: ${record.email}`,
      `Nutzer-UID: ${record.uid}`,
      `Zeitpunkt: ${record.created_at}`,
      '',
      record.message
    ].join('\n')
  });
  return true;
}

function contactRouter({ requireAuth, requireOwner }) {
  const r = wrapRouter(express.Router());

  // Öffentliches Absenden (mit und ohne Login nutzbar, streng rate-limitiert per IP)
  r.post('/', rateLimit('contact-send', 6, 600, byIp), async (req, res) => {
    const parsed = validateContactPayload(req.body);
    if (parsed.spam) return res.json({ ok: true, id: 'ok', delivered: 'filtered' });
    if (parsed.error) return res.status(400).json({ error: parsed.error });

    const authUser = await verifyOptionalAuth(req);
    const id = db.nextId();
    const now = db.nowIso();
    const record = {
      id,
      uid: authUser?.uid || 'guest',
      ...parsed.data,
      status: 'open',
      created_at: now,
      updated_at: now
    };

    let saved = false;
    let emailed = false;

    const persist = async () => {
      await db.setDoc(`contact_messages/${id}`, record);
      saved = true;
    };

    try {
      if (authUser?.token) {
        await runWithDbContext({ token: authUser.token, uid: authUser.uid, email: authUser.email, isOwner: authUser.isOwner }, persist);
      } else {
        await persist();
      }
    } catch (e) {
      if (e?.code !== 'PERMISSION_DENIED' && e?.code !== 'UNAUTHENTICATED' && e?.status !== 403 && e?.status !== 401) {
        console.warn('[contact] Speichern fehlgeschlagen:', e.message);
      }
    }

    try {
      emailed = await sendOptionalSmtpEmail(record);
    } catch (e) {
      console.warn('[contact] SMTP-Weiterleitung fehlgeschlagen:', e.message);
    }

    if (!saved && !emailed) {
      return res.status(200).json({
        ok: false,
        fallbackMailto: true,
        error: 'Ohne Anmeldung oder Server-Mailversand ist die direkte Speicherung nicht aktiv. Du kannst die Nachricht direkt im E-Mail-Programm absenden.'
      });
    }

    res.status(201).json({
      ok: true,
      id,
      saved,
      emailed,
      message: 'Vielen Dank! Deine Nachricht wurde übermittelt.'
    });
  });

  // Eingegangene Anfragen abrufen (Owner sieht alle, Nutzer nur eigene)
  r.get('/', requireAuth, rateLimit('contact-list', 30, 300), async (req, res) => {
    const rows = req.user.isOwner
      ? await db.listDocs('contact_messages', { limit: 100 }).catch(() => [])
      : await db.runQuery('contact_messages', { where: [['uid', '==', req.user.uid]], limit: 50 }).catch(() => []);
    const items = rows
      .map(({ _id, _updateTime, ...rest }) => {
        void _id; void _updateTime;
        return rest;
      })
      .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
    res.json({ items });
  });

  // Status aktualisieren (nur Owner)
  r.patch('/:id', requireAuth, requireOwner, rateLimit('contact-mod', 30, 300), async (req, res) => {
    const id = String(req.params.id || '');
    if (!/^[1-9][0-9]*$/.test(id)) return res.status(400).json({ error: 'Ungültige ID.' });
    const status = req.body?.status;
    if (!['open', 'done'].includes(status)) return res.status(400).json({ error: 'Ungültiger Status.' });
    const doc = await db.getDoc(`contact_messages/${id}`);
    if (!doc) return res.status(404).json({ error: 'Anfrage nicht gefunden.' });
    await db.updateDoc(`contact_messages/${id}`, { status, updated_at: db.nowIso() });
    res.json({ ok: true, id: Number(id), status });
  });

  // Anfrage löschen (Owner oder eigener Absender)
  r.delete('/:id', requireAuth, rateLimit('contact-del', 30, 300), async (req, res) => {
    const id = String(req.params.id || '');
    if (!/^[1-9][0-9]*$/.test(id)) return res.status(400).json({ error: 'Ungültige ID.' });
    const doc = await db.getDoc(`contact_messages/${id}`);
    if (!doc) return res.status(404).json({ error: 'Anfrage nicht gefunden.' });
    if (!req.user.isOwner && doc.uid !== req.user.uid) {
      return res.status(403).json({ error: 'Zugriff verweigert.' });
    }
    await db.deleteDoc(`contact_messages/${id}`);
    res.json({ ok: true });
  });

  return r;
}

module.exports = { contactRouter, validateContactPayload, TOPIC_LABELS };
