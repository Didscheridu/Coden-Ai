// Firebase Firestore REST + In-Memory Store (einzige Datenbank für Coden AI)
// - Im Produktivbetrieb (Vercel / lokal): nutzt Firestore v1 REST API mit dem Firebase-ID-Token des eingeloggten Nutzers
//   (via AsyncLocalStorage) oder optional mit FIREBASE_SERVICE_ACCOUNT (für Hintergrund-Etappen / Admin-Aufgaben).
// - In Tests (enableMemoryDb / CODEN_TEST_DB=memory): vollwertiger In-Memory-Firestore-Store mit identischem Verhalten.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { AsyncLocalStorage } = require('async_hooks');
const { SignJWT, importPKCS8 } = require('jose');
const neon = require('./neon');

const als = new AsyncLocalStorage();
let cachedConfig = null;
let memoryMode = process.env.CODEN_TEST_DB === 'memory';
const useNeon = () => !memoryMode && neon.isConfigured();
const mem = new Map(); // path -> { data: Object, updateTime: string }
let seqCounter = 0;

function getConfig() {
  if (cachedConfig) return cachedConfig;
  let fileCfg = {};
  try {
    fileCfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'firebase-applet-config.json'), 'utf8'));
  } catch (_) { /* Fallback über Umgebungsvariablen */ }
  const projectId = process.env.FIREBASE_PROJECT_ID || fileCfg.projectId || 'coden-4561f';
  const databaseId = process.env.FIREBASE_DATABASE_ID || fileCfg.firestoreDatabaseId || '(default)';
  cachedConfig = { projectId, databaseId };
  return cachedConfig;
}

const restBase = () => {
  const { projectId, databaseId } = getConfig();
  return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/${encodeURIComponent(databaseId)}/documents`;
};

function runWithDbContext(ctx, fn) {
  const prev = als.getStore() || {};
  return als.run({ ...prev, ...ctx }, fn);
}
function getDbContext() {
  return als.getStore() || {};
}

function enableMemoryDb() { memoryMode = true; }
function disableMemoryDb() { memoryMode = false; }
function isMemoryDb() { return memoryMode; }
function clearMemoryDb() { mem.clear(); seqCounter = 0; }
function memoryStore() { return mem; }

function nextId() {
  seqCounter = (seqCounter + 1) % 1000;
  return Date.now() * 1000 + seqCounter;
}

function allocShortId(existing = []) {
  const used = new Set(existing.map(Number).filter(n => Number.isInteger(n) && n > 0));
  let n = used.size ? Math.max(...used) + 1 : 1;
  while (used.has(n) || n > 999_999_999) {
    n = 1 + crypto.randomInt(0, 999_999_990);
  }
  return n;
}

const nowIso = () => new Date().toISOString();

// ---------- Service-Account Auth (optional) ----------
let saToken = null; // { token, exp }
let saPrivateKey = null;
function parseServiceAccount() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) return null;
  try {
    const trimmed = raw.trim();
    const json = trimmed.startsWith('{') ? trimmed : Buffer.from(trimmed, 'base64').toString('utf8');
    const parsed = JSON.parse(json);
    if (parsed.client_email && parsed.private_key) return parsed;
  } catch (e) {
    console.warn('[firestore] FIREBASE_SERVICE_ACCOUNT ungültig:', e.message);
  }
  return null;
}

async function getAdminAccessToken() {
  const sa = parseServiceAccount();
  if (!sa) return null;
  const now = Math.floor(Date.now() / 1000);
  if (saToken && saToken.exp > now + 60) return saToken.token;
  if (!saPrivateKey) saPrivateKey = await importPKCS8(sa.private_key, 'RS256');
  const assertion = await new SignJWT({ scope: 'https://www.googleapis.com/auth/datastore' })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuer(sa.client_email)
    .setSubject(sa.client_email)
    .setAudience('https://oauth2.googleapis.com/token')
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(saPrivateKey);
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
    signal: AbortSignal.timeout(10000)
  });
  if (!res.ok) throw new Error(`Service-Account OAuth HTTP ${res.status}`);
  const data = await res.json();
  saToken = { token: data.access_token, exp: now + Number(data.expires_in || 3600) };
  return saToken.token;
}

async function authHeaders({ preferAdmin = false } = {}) {
  const ctx = getDbContext();
  if (preferAdmin) {
    const admin = await getAdminAccessToken();
    if (admin) return { Authorization: `Bearer ${admin}` };
  }
  if (ctx.token) return { Authorization: `Bearer ${ctx.token}` };
  const admin = await getAdminAccessToken();
  if (admin) return { Authorization: `Bearer ${admin}` };
  return {};
}

// ---------- Firestore Value Codec ----------
function toFsValue(val) {
  if (val === null || val === undefined) return { nullValue: null };
  if (typeof val === 'boolean') return { booleanValue: val };
  if (typeof val === 'number') {
    if (!Number.isFinite(val)) return { nullValue: null };
    if (Number.isInteger(val) && Math.abs(val) <= 9007199254740991) return { integerValue: String(val) };
    return { doubleValue: val };
  }
  if (typeof val === 'string') return { stringValue: val };
  if (val instanceof Date) return { stringValue: val.toISOString() };
  if (Buffer.isBuffer(val) || val instanceof Uint8Array) return { stringValue: Buffer.from(val).toString('base64') };
  if (Array.isArray(val)) return { arrayValue: { values: val.map(toFsValue) } };
  if (typeof val === 'object') return { mapValue: { fields: encodeFields(val) } };
  return { stringValue: String(val) };
}

function encodeFields(obj) {
  const fields = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (v === undefined) continue;
    fields[k] = toFsValue(v);
  }
  return fields;
}

function fromFsValue(v) {
  if (!v || typeof v !== 'object') return null;
  if ('nullValue' in v) return null;
  if ('booleanValue' in v) return Boolean(v.booleanValue);
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('stringValue' in v) return v.stringValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('bytesValue' in v) return v.bytesValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fromFsValue);
  if ('mapValue' in v) return decodeFields(v.mapValue.fields || {});
  return null;
}

function decodeFields(fields) {
  const out = {};
  for (const [k, v] of Object.entries(fields || {})) out[k] = fromFsValue(v);
  return out;
}

function docFromRest(raw) {
  if (!raw || !raw.name) return null;
  const parts = raw.name.split('/');
  const id = decodeURIComponent(parts[parts.length - 1]);
  return {
    ...decodeFields(raw.fields),
    _id: id,
    _updateTime: raw.updateTime || null
  };
}

function clone(v) {
  if (v === null || v === undefined || typeof v !== 'object') return v;
  return JSON.parse(JSON.stringify(v));
}

function fsError(status, message, code) {
  return Object.assign(new Error(message), { status, code });
}

async function restFetch(url, opts = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(await authHeaders(opts)),
    ...(opts.headers || {})
  };
  const r = await fetch(url, {
    method: opts.method || 'GET',
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    signal: opts.signal || AbortSignal.timeout(15000)
  });
  let d = null;
  try { d = await r.json(); } catch (_) { /* empty */ }
  if (!r.ok) {
    const errObj = Array.isArray(d) ? d[0]?.error : d?.error;
    const msg = errObj?.message || `Firestore HTTP ${r.status}`;
    const statusText = errObj?.status || '';
    if (r.status === 404 || statusText === 'NOT_FOUND') throw fsError(404, msg, 'NOT_FOUND');
    if (r.status === 409 || statusText === 'ALREADY_EXISTS') throw fsError(409, msg, 'ALREADY_EXISTS');
    if (r.status === 412 || statusText === 'FAILED_PRECONDITION' || statusText === 'ABORTED') throw fsError(409, msg, 'PRECONDITION_FAILED');
    if (r.status === 429 || statusText === 'RESOURCE_EXHAUSTED') throw fsError(429, msg, 'RESOURCE_EXHAUSTED');
    if (r.status === 403 || statusText === 'PERMISSION_DENIED') throw fsError(403, msg, 'PERMISSION_DENIED');
    if (r.status === 401 || statusText === 'UNAUTHENTICATED') throw fsError(401, msg, 'UNAUTHENTICATED');
    throw fsError(r.status, msg, statusText || 'FIRESTORE_ERROR');
  }
  return d;
}

const cleanPath = (p) => String(p || '').replace(/^\/+|\/+$/g, '');
const encodePath = (p) => cleanPath(p).split('/').map(encodeURIComponent).join('/');
const docIdOf = (p) => {
  const segs = cleanPath(p).split('/');
  return segs[segs.length - 1];
};
const colPathOf = (p) => {
  const segs = cleanPath(p).split('/');
  segs.pop();
  return segs.join('/');
};
const newUpdateTime = () => new Date().toISOString() + ':' + (++seqCounter);

// ---------- CRUD ----------
async function getDoc(docPath, opts = {}) {
  const p = cleanPath(docPath);
  if (memoryMode) {
    const hit = mem.get(p);
    if (!hit) return null;
    return { ...clone(hit.data), _id: docIdOf(p), _updateTime: hit.updateTime };
  }
  if (useNeon()) {
    const rows = await neon.query('select data, update_time from fs_docs where path = $1', [p]);
    if (!rows[0]) return null;
    return { ...clone(rows[0].data), _id: docIdOf(p), _updateTime: rows[0].update_time };
  }
  try {
    const raw = await restFetch(`${restBase()}/${encodePath(p)}`, opts);
    return docFromRest(raw);
  } catch (e) {
    if (e.code === 'NOT_FOUND') return null;
    throw e;
  }
}

async function setDoc(docPath, data, opts = {}) {
  const p = cleanPath(docPath);
  const { _id, _updateTime, ...clean } = data || {};
  if (memoryMode) {
    const prev = mem.get(p);
    const merged = opts.merge && prev ? { ...clone(prev.data), ...clone(clean) } : clone(clean);
    for (const k of Object.keys(merged)) if (merged[k] === undefined) delete merged[k];
    const updateTime = newUpdateTime();
    mem.set(p, { data: merged, updateTime });
    return { ...clone(merged), _id: docIdOf(p), _updateTime: updateTime };
  }
  if (useNeon()) {
    let prev = null;
    if (opts.merge) {
      const rows = await neon.query('select data from fs_docs where path = $1', [p]);
      prev = rows[0]?.data || null;
    }
    const merged = opts.merge && prev ? { ...clone(prev), ...clone(clean) } : clone(clean);
    for (const k of Object.keys(merged)) if (merged[k] === undefined) delete merged[k];
    const updateTime = newUpdateTime();
    await neon.query(
      `insert into fs_docs (path, col_path, doc_id, data, update_time) values ($1, $2, $3, $4::jsonb, $5)
       on conflict (path) do update set data = excluded.data, update_time = excluded.update_time`,
      [p, colPathOf(p), docIdOf(p), JSON.stringify(merged), updateTime]
    );
    return { ...clone(merged), _id: docIdOf(p), _updateTime: updateTime };
  }
  let url = `${restBase()}/${encodePath(p)}`;
  if (opts.merge) {
    const keys = Object.keys(clean).filter(k => clean[k] !== undefined);
    const params = keys.map(k => `updateMask.fieldPaths=${encodeURIComponent(k)}`);
    if (params.length) url += '?' + params.join('&');
  }
  const raw = await restFetch(url, { ...opts, method: 'PATCH', body: { fields: encodeFields(clean) } });
  return docFromRest(raw);
}

async function createDoc(docPath, data, opts = {}) {
  const p = cleanPath(docPath);
  const { _id, _updateTime, ...clean } = data || {};
  if (memoryMode) {
    if (mem.has(p)) throw fsError(409, 'Document already exists', 'ALREADY_EXISTS');
    const saved = clone(clean);
    for (const k of Object.keys(saved)) if (saved[k] === undefined) delete saved[k];
    const updateTime = newUpdateTime();
    mem.set(p, { data: saved, updateTime });
    return { ...clone(saved), _id: docIdOf(p), _updateTime: updateTime };
  }
  if (useNeon()) {
    const saved = clone(clean);
    for (const k of Object.keys(saved)) if (saved[k] === undefined) delete saved[k];
    const updateTime = newUpdateTime();
    const rows = await neon.query(
      `insert into fs_docs (path, col_path, doc_id, data, update_time) values ($1, $2, $3, $4::jsonb, $5)
       on conflict (path) do nothing returning path`,
      [p, colPathOf(p), docIdOf(p), JSON.stringify(saved), updateTime]
    );
    if (!rows[0]) throw fsError(409, 'Document already exists', 'ALREADY_EXISTS');
    return { ...clone(saved), _id: docIdOf(p), _updateTime: updateTime };
  }
  const url = `${restBase()}/${encodePath(p)}?currentDocument.exists=false`;
  const raw = await restFetch(url, { ...opts, method: 'PATCH', body: { fields: encodeFields(clean) } });
  return docFromRest(raw);
}

async function updateDoc(docPath, patch, opts = {}) {
  const p = cleanPath(docPath);
  const { _id, _updateTime, ...clean } = patch || {};
  if (memoryMode) {
    const hit = mem.get(p);
    if (!hit) return null;
    if (opts.updateTime && hit.updateTime !== opts.updateTime) {
      throw fsError(409, 'Concurrent modification', 'PRECONDITION_FAILED');
    }
    if (opts.expect) {
      for (const [k, v] of Object.entries(opts.expect)) {
        if (hit.data[k] !== v) throw fsError(409, `Precondition mismatch on ${k}`, 'PRECONDITION_FAILED');
      }
    }
    const next = { ...clone(hit.data), ...clone(clean) };
    for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
    const updateTime = newUpdateTime();
    mem.set(p, { data: next, updateTime });
    return { ...clone(next), _id: docIdOf(p), _updateTime: updateTime };
  }
  if (useNeon()) {
    const rows = await neon.query('select data, update_time from fs_docs where path = $1', [p]);
    const hit = rows[0];
    if (!hit) return null;
    if (opts.updateTime && hit.update_time !== opts.updateTime) {
      throw fsError(409, 'Concurrent modification', 'PRECONDITION_FAILED');
    }
    if (opts.expect) {
      for (const [k, v] of Object.entries(opts.expect)) {
        if (hit.data[k] !== v) throw fsError(409, `Precondition mismatch on ${k}`, 'PRECONDITION_FAILED');
      }
    }
    const next = { ...clone(hit.data), ...clone(clean) };
    for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
    const updateTime = newUpdateTime();
    const updated = opts.updateTime
      ? await neon.query('update fs_docs set data = $1::jsonb, update_time = $2 where path = $3 and update_time = $4 returning path', [JSON.stringify(next), updateTime, p, opts.updateTime])
      : await neon.query('update fs_docs set data = $1::jsonb, update_time = $2 where path = $3 returning path', [JSON.stringify(next), updateTime, p]);
    if (!updated[0]) throw fsError(409, 'Concurrent modification', 'PRECONDITION_FAILED');
    return { ...clone(next), _id: docIdOf(p), _updateTime: updateTime };
  }
  const keys = Object.keys(clean).filter(k => clean[k] !== undefined);
  const params = keys.map(k => `updateMask.fieldPaths=${encodeURIComponent(k)}`);
  if (opts.updateTime) params.push(`currentDocument.updateTime=${encodeURIComponent(opts.updateTime)}`);
  else params.push('currentDocument.exists=true');
  const url = `${restBase()}/${encodePath(p)}?${params.join('&')}`;
  try {
    const raw = await restFetch(url, { ...opts, method: 'PATCH', body: { fields: encodeFields(clean) } });
    return docFromRest(raw);
  } catch (e) {
    if (e.code === 'NOT_FOUND') return null;
    throw e;
  }
}

async function deleteDoc(docPath, opts = {}) {
  const p = cleanPath(docPath);
  if (memoryMode) {
    return { deleted: mem.delete(p) };
  }
  if (useNeon()) {
    const rows = await neon.query('delete from fs_docs where path = $1 returning path', [p]);
    return { deleted: rows.length > 0 };
  }
  try {
    await restFetch(`${restBase()}/${encodePath(p)}`, { ...opts, method: 'DELETE' });
    return { deleted: true };
  } catch (e) {
    if (e.code === 'NOT_FOUND') return { deleted: false };
    throw e;
  }
}

// ---------- Collections & Queries ----------
function matchCondition(doc, [field, op, val]) {
  const cur = field === '__name__' ? doc._id : doc[field];
  switch (op) {
    case '==': case 'EQUAL': return cur === val;
    case '!=': case 'NOT_EQUAL': return cur !== val;
    case '<': case 'LESS_THAN': return cur != null && cur < val;
    case '<=': case 'LESS_THAN_OR_EQUAL': return cur != null && cur <= val;
    case '>': case 'GREATER_THAN': return cur != null && cur > val;
    case '>=': case 'GREATER_THAN_OR_EQUAL': return cur != null && cur >= val;
    case 'ARRAY_CONTAINS': return Array.isArray(cur) && cur.includes(val);
    case 'IN': return Array.isArray(val) && val.includes(cur);
    case 'ARRAY_CONTAINS_ANY': return Array.isArray(cur) && Array.isArray(val) && cur.some(x => val.includes(x));
    default: return false;
  }
}

function cmpVal(a, b) {
  if (a === b) return 0;
  if (a == null) return -1;
  if (b == null) return 1;
  return a < b ? -1 : 1;
}

const OP_MAP = {
  '==': 'EQUAL', EQUAL: 'EQUAL',
  '!=': 'NOT_EQUAL', NOT_EQUAL: 'NOT_EQUAL',
  '<': 'LESS_THAN', LESS_THAN: 'LESS_THAN',
  '<=': 'LESS_THAN_OR_EQUAL', LESS_THAN_OR_EQUAL: 'LESS_THAN_OR_EQUAL',
  '>': 'GREATER_THAN', GREATER_THAN: 'GREATER_THAN',
  '>=': 'GREATER_THAN_OR_EQUAL', GREATER_THAN_OR_EQUAL: 'GREATER_THAN_OR_EQUAL',
  ARRAY_CONTAINS: 'ARRAY_CONTAINS',
  IN: 'IN',
  ARRAY_CONTAINS_ANY: 'ARRAY_CONTAINS_ANY'
};

async function listDocs(collectionPath, { limit = 200, orderBy, desc = false, ...restOpts } = {}) {
  const col = cleanPath(collectionPath);
  const depth = col.split('/').length;
  if (memoryMode) {
    const prefix = col + '/';
    let out = [];
    for (const [k, hit] of mem.entries()) {
      if (k.startsWith(prefix) && k.split('/').length === depth + 1) {
        out.push({ ...clone(hit.data), _id: docIdOf(k), _updateTime: hit.updateTime });
      }
    }
    if (orderBy) out.sort((a, b) => cmpVal(a[orderBy], b[orderBy]) * (desc ? -1 : 1));
    return limit ? out.slice(0, limit) : out;
  }
  if (useNeon()) {
    const rows = await neon.query('select doc_id, data, update_time from fs_docs where col_path = $1', [col]);
    const out = rows.map(r => ({ ...clone(r.data), _id: r.doc_id, _updateTime: r.update_time }));
    if (orderBy) out.sort((a, b) => cmpVal(a[orderBy], b[orderBy]) * (desc ? -1 : 1));
    return limit ? out.slice(0, limit) : out;
  }
  const fetchLimit = orderBy ? (limit ? Math.max(limit, 1000) : 0) : limit;
  const out = [];
  let pageToken = '';
  const pageSize = Math.min(fetchLimit || 300, 300);
  do {
    const qs = new URLSearchParams({ pageSize: String(pageSize) });
    if (pageToken) qs.set('pageToken', pageToken);
    const res = await restFetch(`${restBase()}/${encodePath(col)}?${qs.toString()}`, restOpts);
    for (const raw of res.documents || []) out.push(docFromRest(raw));
    pageToken = res.nextPageToken || '';
  } while (pageToken && (!fetchLimit || out.length < fetchLimit));
  if (orderBy) out.sort((a, b) => cmpVal(a[orderBy], b[orderBy]) * (desc ? -1 : 1));
  return limit ? out.slice(0, limit) : out;
}

// Hinweis: Vermeidet zusammengesetzte Indizes und "order by is not supported" in Firestore Enterprise!
// Filtert optional einen Primär-Filter über Firestore runQuery und filtert/sortiert den Rest in JavaScript.
async function runQuery(collectionPath, { where = [], orderBy, desc = false, limit = 200, ...restOpts } = {}) {
  const col = cleanPath(collectionPath);
  if (memoryMode || useNeon()) {
    let out = await listDocs(col, { limit: 0 });
    for (const cond of where) out = out.filter(d => matchCondition(d, cond));
    if (orderBy) out.sort((a, b) => cmpVal(a[orderBy], b[orderBy]) * (desc ? -1 : 1));
    return limit ? out.slice(0, limit) : out;
  }
  const segs = col.split('/');
  const collectionId = segs.pop();
  const parentPath = segs.join('/');
  const queryUrl = parentPath
    ? `${restBase()}/${encodePath(parentPath)}:runQuery`
    : `${restBase()}:runQuery`;

  // Nur ersten Filter serverseitig (keine Composite Indexes nötig), Sortierung immer in JS
  const structuredQuery = {
    from: [{ collectionId }]
  };
  if (where.length > 0) {
    const [field, op, val] = where[0];
    structuredQuery.where = {
      fieldFilter: {
        field: { fieldPath: field },
        op: OP_MAP[op] || 'EQUAL',
        value: toFsValue(val)
      }
    };
  }
  if (limit && !orderBy && where.length <= 1) {
    structuredQuery.limit = limit;
  }

  const rows = await restFetch(queryUrl, { ...restOpts, method: 'POST', body: { structuredQuery } });
  let out = [];
  for (const item of Array.isArray(rows) ? rows : []) {
    if (item.document) out.push(docFromRest(item.document));
  }
  for (let i = 1; i < where.length; i++) {
    out = out.filter(d => matchCondition(d, where[i]));
  }
  if (orderBy) {
    out.sort((a, b) => cmpVal(a[orderBy], b[orderBy]) * (desc ? -1 : 1));
  }
  return limit ? out.slice(0, limit) : out;
}

async function deleteCollection(collectionPath, nestedSubcollections = [], opts = {}) {
  const docs = await listDocs(collectionPath, { ...opts, limit: 500 });
  for (const d of docs) {
    const childPath = `${cleanPath(collectionPath)}/${d._id}`;
    for (const sub of nestedSubcollections) {
      await deleteCollection(`${childPath}/${sub}`, [], opts);
    }
    await deleteDoc(childPath, opts);
  }
}

async function deleteTree(docPath, subcollections = [], opts = {}) {
  const p = cleanPath(docPath);
  for (const sub of subcollections) {
    if (typeof sub === 'string') await deleteCollection(`${p}/${sub}`, [], opts);
    else if (sub && sub.name) await deleteCollection(`${p}/${sub.name}`, sub.nested || [], opts);
  }
  return deleteDoc(p, opts);
}

async function ping() {
  if (memoryMode) return true;
  if (useNeon()) {
    await neon.ping();
    return true;
  }
  const raw = await getDoc('test/connection');
  return raw !== undefined;
}

module.exports = {
  getConfig,
  runWithDbContext,
  getDbContext,
  enableMemoryDb,
  disableMemoryDb,
  isMemoryDb,
  clearMemoryDb,
  memoryStore,
  nextId,
  allocShortId,
  nowIso,
  getDoc,
  setDoc,
  createDoc,
  updateDoc,
  deleteDoc,
  deleteCollection,
  deleteTree,
  listDocs,
  runQuery,
  ping,
  fsError
};
