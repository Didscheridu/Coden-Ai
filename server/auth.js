// Eigene Anmeldung: Passwort (bcrypt) oder Google-Login, Sitzung als httpOnly-Cookie (JWT)
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getSql } = require('./db');

const COOKIE = 'coden_session';
const MAX_AGE = 30 * 24 * 60 * 60; // 30 Tage
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', 10);

function secret() {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) throw new Error('JWT_SECRET fehlt oder ist zu kurz (min. 32 Zeichen)');
  return process.env.JWT_SECRET;
}

const adminEmail = () => (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
const isOwnerUser = (email, verified) => !!adminEmail() && verified === true && email === adminEmail();

function readCookie(req, name) {
  const m = (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(name + '='));
  return m ? decodeURIComponent(m.slice(name.length + 1)) : null;
}

function setSession(res, user) {
  const token = jwt.sign({ sub: user.id, email: user.email, ev: !!user.email_verified }, secret(), { expiresIn: MAX_AGE });
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${MAX_AGE}${secure}`);
}

function clearSession(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
}

function requireAuth(req, res, next) {
  try {
    const token = readCookie(req, COOKIE);
    if (!token) return res.status(401).json({ error: 'Nicht eingeloggt.' });
    const p = jwt.verify(token, secret());
    req.user = { uid: p.sub, email: p.email, isOwner: isOwnerUser(p.email, p.ev === true) };
    next();
  } catch (e) {
    res.status(401).json({ error: 'Sitzung abgelaufen. Bitte neu einloggen.' });
  }
}

function requireOwner(req, res, next) {
  if (!req.user?.isOwner) return res.status(403).json({ error: 'Zugriff verweigert.' });
  next();
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

async function register(req, res) {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  if (!EMAIL_RE.test(email) || email.length > 200) return res.status(400).json({ error: 'Ungültige E-Mail.' });
  if (password.length < 8 || password.length > 72) return res.status(400).json({ error: 'Passwort: 8 bis 72 Zeichen.' });

  // Die Admin-Adresse darf nur mit geheimem Setup-Code registriert werden,
  // sonst könnte sie jemand anderes vor dir belegen.
  let verified = false;
  if (email === adminEmail()) {
    const code = process.env.ADMIN_SETUP_CODE;
    if (!code || req.body?.setupCode !== code) return res.status(403).json({ code: 'SETUP_CODE', error: 'Diese Adresse ist reserviert (Setup-Code nötig).' });
    verified = true;
  }
  const hash = await bcrypt.hash(password, 10);
  const rows = await getSql()`
    INSERT INTO users (email, password_hash, email_verified) VALUES (${email}, ${hash}, ${verified})
    ON CONFLICT (email) DO NOTHING RETURNING id, email, email_verified`;
  if (!rows.length) return res.status(409).json({ error: 'Diese E-Mail ist bereits registriert.' });
  setSession(res, rows[0]);
  res.json({ ok: true });
}

async function login(req, res) {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const rows = await getSql()`SELECT id, email, password_hash, email_verified FROM users WHERE email = ${email}`;
  const u = rows[0];
  const ok = await bcrypt.compare(password, u?.password_hash || DUMMY_HASH);
  if (!u || !u.password_hash || !ok) return res.status(401).json({ error: 'Falsches Passwort oder E-Mail existiert nicht.' });
  setSession(res, u);
  res.json({ ok: true });
}

async function googleLogin(req, res) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) return res.status(404).json({ error: 'Google-Login nicht konfiguriert.' });
  const credential = String(req.body?.credential || '');
  const r = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`);
  const info = await r.json().catch(() => ({}));
  if (!r.ok || info.aud !== clientId || String(info.email_verified) !== 'true' || !info.email) {
    return res.status(401).json({ error: 'Google-Login ungültig.' });
  }
  const email = String(info.email).toLowerCase();
  const rows = await getSql()`
    INSERT INTO users (email, password_hash, email_verified) VALUES (${email}, NULL, true)
    ON CONFLICT (email) DO UPDATE SET email_verified = true,
      password_hash = CASE WHEN users.email_verified THEN users.password_hash ELSE NULL END
    RETURNING id, email, email_verified`;
  setSession(res, rows[0]);
  res.json({ ok: true });
}

function logout(req, res) { clearSession(res); res.json({ ok: true }); }

module.exports = { requireAuth, requireOwner, register, login, googleLogin, logout };
