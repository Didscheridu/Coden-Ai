// Nutzungslimits wie bei Claude und Gemini: ein 5-Stunden-Fenster und ein Wochenfenster, die sich mit Tokens füllen.
// - Das 5-Stunden-Fenster beginnt mit der ersten Anfrage und setzt sich 5 Stunden später komplett zurück.
// - Das Wochenfenster beginnt ebenso mit der ersten Anfrage und setzt sich nach 7 Tagen zurück.
// - Neue Anfragen werden abgelehnt, sobald eines der Limits voll ist.
// - Eine Aufgabe, die schon läuft, darf zu Ende arbeiten. Nur wenn sie sehr lange weiterläuft und dabei
//   deutlich über das Limit geht (Kulanz, Standard 125 %), wird die KI mitten in der Aufgabe gestoppt.
// - Der Owner hat kein Limit (sein Verbrauch wird trotzdem gezählt). Mit /reset <email> setzt er Limits zurück.
const { getSql } = require('./db');

const H5 = 5 * 3600_000, WEEK = 7 * 24 * 3600_000;
const intEnv = (name, def) => { const n = parseInt(process.env[name], 10); return Number.isFinite(n) && n > 0 ? n : def; };
const limits = () => ({ session: intEnv('CODEN_LIMIT_5H', 400_000), week: intEnv('CODEN_LIMIT_WEEK', 4_000_000) });
const grace = () => Math.max(1, intEnv('CODEN_LIMIT_GRACE_PCT', 125) / 100);

// Stärkere Modelle verbrauchen das Kontingent schneller (wie bei Claude: Opus zählt mehr als Haiku)
const WEIGHT = { flash: 0.5, normal: 1, pro: 1.5, ultra: 2 };
// Grobe Schätzung: ~4 Zeichen = 1 Token. Die Eingabe (Verlauf, Dateien) wird bei jedem Schritt neu geschickt
// und zählt deshalb nur zu einem Viertel, sonst wäre ein langer Chat nach wenigen Nachrichten aufgebraucht.
const tokensOf = (chars, { input = false } = {}) => (Math.max(0, chars) / 4) * (input ? 0.25 : 1);

const ms = (d) => (d ? new Date(d).getTime() : 0);
function view(row, now = Date.now()) {
  const L = limits();
  const win = (start, used, len, limit) => {
    const active = start && now - ms(start) < len;
    const u = active ? Number(used) || 0 : 0;
    return { used: Math.round(u), limit, pct: Math.min(100, Math.round((u / limit) * 100)), resetAt: active ? new Date(ms(start) + len).toISOString() : null };
  };
  const session = win(row?.s_start, row?.s_tokens, H5, L.session);
  const week = win(row?.w_start, row?.w_tokens, WEEK, L.week);
  const blocked = week.used >= week.limit ? 'week' : session.used >= session.limit ? 'session' : null;
  return { session, week, blocked, total: Math.round(Number(row?.total) || 0) };
}

// „in 2 Std. 13 Min.“ – unabhängig von der Zeitzone des Nutzers
function until(iso, now = Date.now()) {
  const m = Math.max(1, Math.round((ms(iso) - now) / 60000));
  if (m < 60) return `in ${m} Min.`;
  const h = Math.floor(m / 60), r = m % 60;
  if (h < 24) return `in ${h} Std.${r ? ` ${r} Min.` : ''}`;
  const d = Math.floor(h / 24), rh = h % 24;
  return `in ${d} ${d === 1 ? 'Tag' : 'Tagen'}${rh ? ` ${rh} Std.` : ''}`;
}
function message(v, { during = false } = {}) {
  const which = v.blocked === 'week' ? v.week : v.session;
  const name = v.blocked === 'week' ? 'Wochenlimit' : '5-Stunden-Limit';
  return during
    ? `Dein ${name} ist aufgebraucht, deshalb hat Coden hier angehalten. Es setzt sich ${until(which.resetAt)} zurück, dann kannst du „weiter“ schreiben.`
    : `Du hast dein ${name} erreicht. Es setzt sich ${until(which.resetAt)} zurück.`;
}

async function row(uid) {
  const rows = await getSql()`SELECT * FROM usage_limits WHERE uid = ${uid}`;
  return rows[0] || null;
}
async function status(user) {
  const v = view(await row(user.uid));
  return { ...v, unlimited: !!user.isOwner, blocked: user.isOwner ? null : v.blocked };
}

// Verbrauch atomar dazurechnen. Abgelaufene Fenster beginnen dabei neu (mit der aktuellen Anfrage).
async function add(user, tokens) {
  const n = Math.max(0, Math.round(tokens));
  if (!n || !user?.uid) return row(user?.uid);
  const email = user.email ? String(user.email).toLowerCase().slice(0, 200) : null;
  const [r] = await getSql()`
    INSERT INTO usage_limits (uid, email, s_start, s_tokens, w_start, w_tokens, total)
    VALUES (${user.uid}, ${email}, now(), ${n}, now(), ${n}, ${n})
    ON CONFLICT (uid) DO UPDATE SET
      email    = COALESCE(EXCLUDED.email, usage_limits.email),
      s_start  = CASE WHEN usage_limits.s_start IS NULL OR usage_limits.s_start <= now() - interval '5 hours' THEN now() ELSE usage_limits.s_start END,
      s_tokens = CASE WHEN usage_limits.s_start IS NULL OR usage_limits.s_start <= now() - interval '5 hours' THEN ${n} ELSE usage_limits.s_tokens + ${n} END,
      w_start  = CASE WHEN usage_limits.w_start IS NULL OR usage_limits.w_start <= now() - interval '7 days' THEN now() ELSE usage_limits.w_start END,
      w_tokens = CASE WHEN usage_limits.w_start IS NULL OR usage_limits.w_start <= now() - interval '7 days' THEN ${n} ELSE usage_limits.w_tokens + ${n} END,
      total    = usage_limits.total + ${n},
      updated_at = now()
    RETURNING *`;
  return r;
}

// Vor einer neuen Anfrage: ist noch Kontingent übrig?
async function check(user) {
  if (!user || user.isOwner) return { ok: true };
  try {
    const v = view(await row(user.uid));
    if (v.blocked) return { ok: false, view: v, message: message(v) };
  } catch (e) { console.warn('[usage] Prüfung fehlgeschlagen:', e.message); } // Datenbankfehler sperren niemanden aus
  return { ok: true };
}
// Express-Middleware für alle Wege, die eine KI starten
function limitGate(req, res, next) {
  check(req.user).then((c) => {
    if (c.ok) return next();
    res.status(429).json({ error: c.message, code: 'limit', usage: c.view });
  }, next);
}

// Zählt während einer Anfrage mit und schreibt gesammelt in die Datenbank.
// stop = true, sobald eine laufende Aufgabe die Kulanzgrenze überschreitet (dann hält die KI an).
class Meter {
  constructor(user, tier) {
    this.user = user; this.w = WEIGHT[tier] || 1; this.pending = 0; this.timer = null; this.stop = false; this.view = null; this.busy = null;
  }
  // Gleicher Zähler, aber mit dem Gewicht eines anderen Modells (Sub-Agenten auf Flash zählen weniger)
  child(tier) { const p = this; return { add: (c, o) => p.add(c, o, WEIGHT[tier] || 1), get stop() { return p.stop; }, message: () => p.message(), close: () => p.flush() }; }
  add(chars, opts, w = this.w) {
    if (!chars) return;
    this.pending += tokensOf(chars, opts) * w;
    if (this.pending >= 2000) this.flush();
    else if (!this.timer) this.timer = setTimeout(() => this.flush(), 4000);
  }
  flush() {
    clearTimeout(this.timer); this.timer = null;
    if (this.busy) return this.busy.then(() => (this.pending >= 1 ? this.flush() : undefined));
    const n = this.pending; if (n < 1) return Promise.resolve();
    this.pending = 0;
    this.busy = add(this.user, n).then((r) => {
      if (!r) return;
      this.view = view(r);
      const g = grace(), v = this.view;
      if (!this.user.isOwner && (v.week.used >= v.week.limit * g || v.session.used >= v.session.limit * g)) this.stop = true;
    }).catch((e) => { console.warn('[usage] Zählen fehlgeschlagen:', e.message); }).finally(() => { this.busy = null; });
    return this.busy;
  }
  message() { const v = this.view || view(null); return message({ ...v, blocked: v.week.used >= v.week.limit ? 'week' : 'session' }, { during: true }); }
  close() { return this.flush(); }
}
const limitError = (meter) => Object.assign(new Error(meter.message()), { limit: true, status: 429 });

// Owner: Limits eines Nutzers zurücksetzen (/reset <email>)
async function resetByEmail(email) {
  const e = String(email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw Object.assign(new Error('Bitte eine gültige E-Mail angeben: /reset name@beispiel.de'), { status: 400 });
  const rows = await getSql()`UPDATE usage_limits SET s_tokens = 0, s_start = NULL, w_tokens = 0, w_start = NULL, updated_at = now()
    WHERE lower(email) = ${e} RETURNING uid`;
  return { email: e, users: rows.length };
}
async function usageByEmail(email) {
  const e = String(email || '').trim().toLowerCase();
  const rows = await getSql()`SELECT * FROM usage_limits WHERE lower(email) = ${e}`;
  return rows.map((r) => ({ uid: r.uid, email: r.email, ...view(r) }));
}
async function topUsers(n = 10) {
  const rows = await getSql()`SELECT * FROM usage_limits ORDER BY updated_at DESC LIMIT ${n}`;
  return rows.map((r) => ({ email: r.email, ...view(r) }));
}

function usageRouter(requireAuth, requireOwner) {
  const express = require('express'); const { wrapRouter } = require('./util');
  const r = wrapRouter(express.Router());
  r.get('/', requireAuth, async (req, res) => res.json(await status(req.user)));
  r.get('/admin', requireAuth, requireOwner, async (req, res) => {
    res.json(req.query.email ? { users: await usageByEmail(req.query.email) } : { users: await topUsers(15) });
  });
  r.post('/reset', requireAuth, requireOwner, async (req, res) => {
    try { res.json({ ok: true, ...(await resetByEmail(req.body?.email)) }); }
    catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
  return r;
}

module.exports = { Meter, check, limitGate, limitError, status, add, view, until, resetByEmail, usageByEmail, usageRouter, limits, WEIGHT, tokensOf };
