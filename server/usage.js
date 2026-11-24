// Nutzungslimits wie bei Claude und Gemini: ein 5-Stunden-Fenster und ein Wochenfenster, die sich mit Tokens füllen.
// - Das 5-Stunden-Fenster beginnt mit der ersten Anfrage und setzt sich 5 Stunden später komplett zurück.
// - Das Wochenfenster beginnt ebenso mit der ersten Anfrage und setzt sich nach 7 Tagen zurück.
// - Neue Anfragen werden abgelehnt, sobald eines der Limits voll ist.
// - Eine Aufgabe, die schon läuft, darf zu Ende arbeiten. Nur wenn sie sehr lange weiterläuft und dabei
//   deutlich über das Limit geht (Kulanz, Standard 125 %), wird die KI mitten in der Aufgabe gestoppt.
// - Der Owner hat kein Limit (sein Verbrauch wird trotzdem gezählt). Mit /reset <email> setzt er Limits zurück.
const db = require('./db');

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
  return db.getDoc(`usage_limits/${uid}`);
}
async function status(user) {
  const v = view(await row(user.uid));
  return { ...v, unlimited: !!user.isOwner, blocked: user.isOwner ? null : v.blocked };
}

// Verbrauch dazurechnen (optimistische Wiederholung bei gleichzeitigen Updates).
async function add(user, tokens) {
  const n = Math.max(0, Math.round(tokens));
  if (!n || !user?.uid) return row(user?.uid);
  const email = user.email ? String(user.email).toLowerCase().slice(0, 200) : null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    const cur = await db.getDoc(`usage_limits/${user.uid}`);
    if (!cur) {
      try {
        return await db.createDoc(`usage_limits/${user.uid}`, {
          uid: user.uid,
          email,
          s_start: nowIso,
          s_tokens: n,
          w_start: nowIso,
          w_tokens: n,
          total: n,
          updated_at: nowIso
        });
      } catch (e) {
        if (e.code === 'ALREADY_EXISTS') continue;
        throw e;
      }
    }
    const sExpired = !cur.s_start || (now - ms(cur.s_start)) >= H5;
    const wExpired = !cur.w_start || (now - ms(cur.w_start)) >= WEEK;
    const patch = {
      email: email || cur.email || null,
      s_start: sExpired ? nowIso : cur.s_start,
      s_tokens: sExpired ? n : (Number(cur.s_tokens) || 0) + n,
      w_start: wExpired ? nowIso : cur.w_start,
      w_tokens: wExpired ? n : (Number(cur.w_tokens) || 0) + n,
      total: (Number(cur.total) || 0) + n,
      updated_at: nowIso
    };
    try {
      const updated = await db.updateDoc(`usage_limits/${user.uid}`, patch, { updateTime: cur._updateTime });
      if (updated) return updated;
    } catch (e) {
      if (e.code === 'PRECONDITION_FAILED') continue;
      throw e;
    }
  }
  return row(user.uid);
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
    this.dbCtx = db.getDbContext();
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
    this.busy = db.runWithDbContext(this.dbCtx, () => add(this.user, n)).then((r) => {
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
  const rows = await db.runQuery('usage_limits', { where: [['email', '==', e]] });
  const nowIso = db.nowIso();
  for (const r of rows) {
    await db.updateDoc(`usage_limits/${r.uid}`, { s_tokens: 0, s_start: null, w_tokens: 0, w_start: null, updated_at: nowIso });
  }
  return { email: e, users: rows.length };
}
async function usageByEmail(email) {
  const e = String(email || '').trim().toLowerCase();
  const rows = await db.runQuery('usage_limits', { where: [['email', '==', e]] });
  return rows.map((r) => ({ uid: r.uid, email: r.email, ...view(r) }));
}
async function topUsers(n = 10) {
  const rows = await db.listDocs('usage_limits', { orderBy: 'updated_at', desc: true, limit: n });
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
