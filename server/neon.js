// Neon (Postgres) – zweite Datenbank neben Firebase Firestore. Nur auf dem Server, über node-postgres (CommonJS).
// Env: NEON_DATABASE_URL oder DATABASE_URL (Neon-Verbindungs-URL, am besten die "pooled"-Variante mit -pooler im Host).
// Ohne URL ist Neon aus und Coden nutzt nur Firestore. Die Tabelle legt der Server beim ersten Zugriff selbst an.
// Tests: enableMemory() (Speicher) oder useClient(client) mit einem echten Postgres wie PGlite.

const SCHEMA = `
create table if not exists byok_keys (
  uid        text        not null,
  provider   text        not null,
  key_enc    text        not null check (char_length(key_enc) between 10 and 2000),
  hint       text        check (hint is null or char_length(hint) <= 32),
  created_at timestamptz not null default now(),
  primary key (uid, provider)
)`;
const TABLES = { byok_keys: ['uid', 'provider', 'key_enc', 'hint', 'created_at'] }; // erlaubte Tabellen/Spalten

let memory = false;
const mem = new Map();
let client = null; // { query(text, params) -> { rows } }
let ready = null;  // Promise: Schema angelegt

const url = () => (process.env.NEON_DATABASE_URL || process.env.DATABASE_URL || '').trim();
const isConfigured = () => memory || !!client || /^postgres(ql)?:\/\//.test(url());

function enableMemory() { memory = true; }
function disableMemory() { memory = false; }
function clearMemory() { mem.clear(); }
function useClient(c) { client = c; ready = null; } // für Tests (PGlite) – null schaltet zurück auf die URL

let pool = null;
function getPool() {
  if (pool) return pool;
  const { Pool } = require('pg'); // erst bei Bedarf laden
  pool = new Pool({ connectionString: url(), ssl: /sslmode=disable|localhost|127\.0\.0\.1/.test(url()) ? false : { rejectUnauthorized: true }, max: 3, idleTimeoutMillis: 10000, connectionTimeoutMillis: 8000 });
  pool.on('error', (e) => console.error('[neon] Pool-Fehler:', e.message));
  return pool;
}
async function q(text, params = []) {
  const c = client || getPool();
  if (!ready) ready = c.query(SCHEMA).catch((e) => { ready = null; throw e; });
  await ready;
  try { return (await c.query(text, params)).rows; } catch (e) { throw Object.assign(new Error(`Neon: ${e.message}`), { code: e.code }); }
}

function cols(t, obj) {
  const allowed = TABLES[t]; if (!allowed) throw new Error(`Neon: unbekannte Tabelle ${t}`);
  const keys = Object.keys(obj).filter(k => obj[k] !== undefined);
  for (const k of keys) if (!allowed.includes(k)) throw new Error(`Neon: unbekannte Spalte ${k}`);
  return keys;
}
const where = (keys, offset = 0) => (keys.length ? ' where ' + keys.map((k, i) => `${k} = $${i + 1 + offset}`).join(' and ') : '');
const mtable = (t) => { if (!mem.has(t)) mem.set(t, new Map()); return mem.get(t); };
const match = (row, f) => Object.entries(f).every(([k, v]) => String(row[k]) === String(v));

async function select(t, filters = {}) {
  if (memory) return [...mtable(t).values()].filter(r => match(r, filters)).map(r => ({ ...r }));
  const keys = cols(t, filters);
  return q(`select * from ${t}${where(keys)}`, keys.map(k => filters[k]));
}
async function upsert(t, row, pk) {
  if (memory) { mtable(t).set(pk.map(k => row[k]).join('\u0000'), { ...row }); return row; }
  const keys = cols(t, row); cols(t, Object.fromEntries(pk.map(k => [k, 1])));
  const set = keys.filter(k => !pk.includes(k)).map(k => `${k} = excluded.${k}`).join(', ');
  const rows = await q(`insert into ${t} (${keys.join(', ')}) values (${keys.map((_, i) => '$' + (i + 1)).join(', ')})
    on conflict (${pk.join(', ')}) do ${set ? 'update set ' + set : 'nothing'} returning *`, keys.map(k => row[k]));
  return rows[0] || row;
}
async function remove(t, filters) {
  if (memory) { const tb = mtable(t); for (const [k, r] of tb) if (match(r, filters)) tb.delete(k); return; }
  const keys = cols(t, filters);
  if (!keys.length) throw new Error('Neon: Löschen ohne Filter ist nicht erlaubt');
  await q(`delete from ${t}${where(keys)}`, keys.map(k => filters[k]));
}
// Für /api/health
async function ping() {
  if (!isConfigured()) return { configured: false };
  if (memory) return { configured: true, ok: true };
  await q('select 1');
  return { configured: true, ok: true };
}

module.exports = { isConfigured, select, upsert, remove, ping, enableMemory, disableMemory, clearMemory, useClient, SCHEMA };
