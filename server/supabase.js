// Supabase (Postgres über die REST-API PostgREST) – zweite Datenbank neben Firebase Firestore.
// Wird nur auf dem Server benutzt, mit dem geheimen Service-Role-Key (umgeht RLS). Der Key darf nie ins Frontend.
// Env: SUPABASE_URL (https://<ref>.supabase.co) + SUPABASE_SERVICE_ROLE_KEY (oder SUPABASE_SECRET_KEY, sb_secret_…).
// Ohne diese Variablen ist Supabase aus und Coden nutzt nur Firestore.
// In Tests (enableMemory): Tabellen im Speicher mit gleichem Verhalten.

let memory = false;
const mem = new Map(); // tabelle -> Map(pk -> zeile)

const cfg = () => {
  const url = (process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || '').trim();
  return { url, key };
};
const isConfigured = () => memory || (/^https:\/\/[\w.-]+$/.test(cfg().url) && cfg().key.length > 20);

function enableMemory() { memory = true; }
function disableMemory() { memory = false; }
function clearMemory() { mem.clear(); }
const table = (t) => { if (!mem.has(t)) mem.set(t, new Map()); return mem.get(t); };

async function rest(method, pathAndQuery, body, extraHeaders = {}) {
  const { url, key } = cfg();
  const headers = { apikey: key, 'Content-Type': 'application/json', ...extraHeaders };
  // Neue Secret-Keys (sb_secret_…) sind kein JWT und gehören nur in "apikey"; alte service_role-Keys zusätzlich als Bearer
  if (!key.startsWith('sb_')) headers.Authorization = `Bearer ${key}`;
  const r = await fetch(`${url}/rest/v1/${pathAndQuery}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10000)
  });
  const text = await r.text();
  let data = null; try { data = text ? JSON.parse(text) : null; } catch (_) { data = text; }
  if (!r.ok) {
    const msg = (data && (data.message || data.error || data.hint)) || `HTTP ${r.status}`;
    throw Object.assign(new Error(`Supabase: ${msg}`), { status: r.status, code: data?.code });
  }
  return data;
}
const eq = (filters) => Object.entries(filters).map(([k, v]) => `${encodeURIComponent(k)}=eq.${encodeURIComponent(v)}`).join('&');

// Zeilen lesen: select('byok_keys', { uid: 'x' })
async function select(t, filters = {}) {
  if (memory) return [...table(t).values()].filter(row => Object.entries(filters).every(([k, v]) => String(row[k]) === String(v))).map(r => ({ ...r }));
  return (await rest('GET', `${t}?select=*${Object.keys(filters).length ? '&' + eq(filters) : ''}`)) || [];
}
// Einfügen oder ersetzen (Primärschlüssel aus pk-Spalten)
async function upsert(t, row, pk) {
  if (memory) { table(t).set(pk.map(k => row[k]).join('\u0000'), { ...row }); return row; }
  const d = await rest('POST', `${t}?on_conflict=${pk.join(',')}`, [row], { Prefer: 'resolution=merge-duplicates,return=representation' });
  return Array.isArray(d) ? d[0] : row;
}
async function remove(t, filters) {
  if (memory) { const tb = table(t); for (const [k, row] of tb) if (Object.entries(filters).every(([f, v]) => String(row[f]) === String(v))) tb.delete(k); return; }
  await rest('DELETE', `${t}?${eq(filters)}`, undefined, { Prefer: 'return=minimal' });
}
// Für /api/health: Ist Supabase erreichbar und gibt es die Tabelle?
async function ping() {
  if (!isConfigured()) return { configured: false };
  if (memory) return { configured: true, ok: true };
  await rest('GET', 'byok_keys?select=uid&limit=1');
  return { configured: true, ok: true };
}

module.exports = { isConfigured, select, upsert, remove, ping, enableMemory, disableMemory, clearMemory };
