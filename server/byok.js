// Bring your own Key: Nutzer bringen eigene API-Keys (Google AI Studio, OpenAI, Anthropic, OpenRouter) mit
// und fügen eigene Modelle hinzu, die im Auswahlmenü erscheinen.
// - Keys liegen verschlüsselt (AES-256-GCM) in Firestore und verlassen den Server nie wieder.
// - Ein eigenes Modell hat die Stufe "byok:<id>". Der Server löst Key und Modell erst beim Aufruf auf
//   (Läufe in Firestore speichern also nie einen Klartext-Key).
const crypto = require('crypto');
const express = require('express');
const db = require('./db');
const neon = require('./neon');
const { rateLimit } = require('./rateLimit');
const { wrapRouter } = require('./util');

// Mögliche Denkstufen (Reihenfolge = Stärke). Coden selbst kennt nur low/medium/high; Modelle dürfen mehr haben.
const LEVELS = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
const DEFAULT_LEVELS = ['low', 'medium', 'high'];

const PROVIDERS = {
  google: {
    name: 'Google AI Studio', link: 'https://aistudio.google.com/apikey', keyHint: 'AIza…',
    levels: ['minimal', 'low', 'medium', 'high', 'xhigh'],
    suggest: [{ id: 'gemini-4-hydrogen', label: 'Gemini 4 Hydrogen' }]
  },
  openai: {
    name: 'OpenAI', link: 'https://platform.openai.com/api-keys', keyHint: 'sk-…',
    levels: ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'], suggest: []
  },
  anthropic: {
    name: 'Anthropic', link: 'https://platform.claude.com/settings/keys', keyHint: 'sk-ant-…',
    levels: ['low', 'medium', 'high', 'xhigh', 'max'], suggest: []
  },
  openrouter: {
    name: 'OpenRouter', link: 'https://openrouter.ai/keys', keyHint: 'sk-or-…',
    levels: ['minimal', 'low', 'medium', 'high', 'xhigh'], suggest: []
  },
  // Numes: Marktplatz mit OpenAI-kompatibler Schnittstelle (https://api.numes.ai/api/v1), viele Gratismodelle
  numes: {
    name: 'Numes', link: 'https://numes.ai/dashboard/keys', keyHint: 'Inference-Key',
    levels: ['minimal', 'low', 'medium', 'high', 'xhigh'],
    suggest: [{ id: 'deepseek/deepseek-v4.1-flash:free', label: 'DeepSeek V4.1 Flash (gratis)' }, { id: 'moonshotai/kimi-k3.1-pro:free', label: 'Kimi K3.1 Pro (gratis)' }]
  },
  // Kilo: AI Gateway mit OpenAI-kompatibler Schnittstelle (https://ai-gateway.kilo.ai/api/v1), Modellliste von app.kilo.ai/api/gateway/models
  kilo: {
    name: 'Kilo', link: 'https://app.kilo.ai', keyHint: 'Kilo-API-Key',
    levels: ['minimal', 'low', 'medium', 'high', 'xhigh'],
    suggest: [
      { id: 'kilo-auto/free', label: 'Auto Free' },
      { id: 'inclusionai/ling-3.2-flash:free', label: 'inclusionAI: Ling 3.2 Flash (free)' },
      { id: 'nvidia/nemotron-3.5-super-vl:free', label: 'NVIDIA: Nemotron 3.5 Super VL (free)' },
      { id: 'nvidia/nemotron-3-ultra-550b-a55b:free', label: 'NVIDIA: Nemotron 3 Ultra (free)' },
      { id: 'baidu/ernie-5.5-flash-preview:free', label: 'Baidu: ERNIE-5.5-Flash-Preview (free)' },
      { id: 'particle-ai/particle-1:free', label: 'Particle AI: Particle-1 (free)' },
      { id: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free', label: 'NVIDIA: Nemotron 3 Nano Omni (free)' },
      { id: 'nvidia/nemotron-3.5-lightning:free', label: 'NVIDIA: Nemotron 3.5 Lightning (free)' },
      { id: 'recursive/flint-v1.0:free', label: 'Recursive: Flint (free)' },
      { id: 'liquid/lfm-3-1.7b:free', label: 'LiquidAI: LFM3-1.7B (free)' },
      { id: 'openrouter/free', label: 'OpenRouter Free Models Router' },
      { id: 'reflection/beam-free', label: 'Reflection: Beam 1.0 (Free)' },
      { id: 'stealth/glyph-cluster', label: 'Glyph Cluster' }
    ]
  },
  // AIHubMix: einheitliche OpenAI-kompatible Schnittstelle (https://aihubmix.com/v1)
  aihubmix: {
    name: 'AIHubMix', link: 'https://aihubmix.com/token', keyHint: 'sk-…',
    levels: ['minimal', 'low', 'medium', 'high', 'xhigh'],
    suggest: [
      { id: 'gpt-4o-mini', label: 'GPT-4o Mini' },
      { id: 'gpt-4.1-mini', label: 'GPT-4.1 Mini' },
      { id: 'claude-3-5-haiku-latest', label: 'Claude 3.5 Haiku' },
      { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
      { id: 'deepseek-chat', label: 'DeepSeek Chat' },
      { id: 'deepseek-reasoner', label: 'DeepSeek Reasoner' }
    ]
  },
  // OrcaRouter: OpenAI-kompatibles AI-Gateway (https://api.orcarouter.ai/v1)
  orcarouter: {
    name: 'OrcaRouter', link: 'https://orcarouter.ai', keyHint: 'sk-orca-…',
    levels: ['minimal', 'low', 'medium', 'high', 'xhigh'],
    suggest: [
      { id: 'orcarouter/free', label: 'OrcaRouter Free (Auto)' },
      { id: 'orcarouter/auto', label: 'OrcaRouter Auto' },
      { id: 'openai/gpt-4o-mini', label: 'GPT-4o Mini' },
      { id: 'anthropic/claude-3.5-haiku', label: 'Claude 3.5 Haiku' },
      { id: 'deepseek/deepseek-chat', label: 'DeepSeek Chat' }
    ]
  }
};
const MAX_MODELS = 40;
const BUILTIN = { flash: 'Coden Flash', normal: 'Coden Thinking', pro: 'Coden Pro', ultra: 'Coden Ultra' };
const isByok = (tier) => typeof tier === 'string' && /^byok:\d{1,9}$/.test(tier);
const isChain = (tier) => typeof tier === 'string' && /^chain:\d{1,9}$/.test(tier);
const isOwnTier = (tier) => isByok(tier) || isChain(tier);   // eigenes Modell oder eigene Ausweich-Kette
const MAX_CHAINS = 10, MAX_CHAIN_LEN = 8;

// ---------- Verschlüsselung ----------
// Geheimnis: Umgebungsvariable BYOK_SECRET, sonst app_secrets/byok (Admin/Memory) oder deterministische Server-Ableitung.
let master = null;
function fallbackSecretSeed() {
  const base = process.env.FIREBASE_SERVICE_ACCOUNT
    || process.env.GEMINI_API_KEY
    || process.env.GOOGLE_API_KEY
    || process.env.OPENROUTER_API_KEY
    || process.env.GROQ_API_KEY
    || db.getConfig().projectId
    || 'coden-byok-default';
  return crypto.createHmac('sha256', 'coden-byok-seed-v1').update(String(base)).digest('hex');
}
async function masterKey() {
  if (master) return master;
  let secret = process.env.BYOK_SECRET;
  if (!secret) {
    try {
      const r = await db.getDoc('app_secrets/byok', { preferAdmin: true });
      if (r?.secret) secret = r.secret;
      else {
        const gen = crypto.randomBytes(32).toString('hex');
        try {
          await db.createDoc('app_secrets/byok', { secret: gen }, { preferAdmin: true });
          secret = gen;
        } catch (e) {
          if (e.code === 'ALREADY_EXISTS') {
            const again = await db.getDoc('app_secrets/byok', { preferAdmin: true });
            secret = again?.secret || gen;
          } else {
            throw e;
          }
        }
      }
    } catch (_) {
      secret = fallbackSecretSeed();
    }
  }
  master = crypto.createHash('sha256').update('coden-byok:' + secret).digest();
  return master;
}
async function encrypt(text) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', await masterKey(), iv);
  const data = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), data].map(b => b.toString('base64')).join('.');
}
async function decrypt(blob) {
  const [iv, tag, data] = String(blob).split('.').map(s => Buffer.from(s, 'base64'));
  const d = crypto.createDecipheriv('aes-256-gcm', await masterKey(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(data), d.final()]).toString('utf8');
}
const hintOf = (key) => '…' + key.slice(-4);
const fail = (status, message) => Object.assign(new Error(message), { status });

const keyDocPath = (uid, provider) => `user_provider_keys/${uid}__${provider}`;

// ---------- Key-Speicher: Firestore oder Neon (Postgres) ----------
// Welche Anbieter-Keys in Neon (Tabelle byok_keys) liegen: NEON_BYOK_PROVIDERS (Komma-Liste oder "all"),
// Standard nur OrcaRouter. Ohne Neon-URL bleibt alles in Firestore. Die Keys sind in beiden Fällen
// mit AES-256-GCM verschlüsselt, die Datenbank sieht nie den Klartext.
const NEON_TABLE = 'byok_keys';
function neonProviders() {
  const raw = (process.env.NEON_BYOK_PROVIDERS || 'orcarouter').toLowerCase();
  return raw.split(',').map(s => s.trim()).filter(Boolean);
}
const inNeon = (provider) => neon.isConfigured() && (neonProviders().includes('all') || neonProviders().includes(provider));
const keyStoreOf = (provider) => (inNeon(provider) ? 'neon' : 'firestore');
const neonFail = (e) => fail(502, `Die Neon-Datenbank ist nicht erreichbar (${String(e.message).slice(0, 140)}).`);

async function keyRecord(uid, provider) {
  if (inNeon(provider)) {
    const rows = await neon.select(NEON_TABLE, { uid, provider }).catch((e) => { console.error('[byok] Neon lesen:', e.message); return []; });
    if (rows[0]) return rows[0];
  }
  return db.getDoc(keyDocPath(uid, provider)); // Firestore (auch alte Keys von vor dem Umzug)
}
async function saveKey(uid, provider, record) {
  if (inNeon(provider)) {
    try { await neon.upsert(NEON_TABLE, record, ['uid', 'provider']); } catch (e) { throw neonFail(e); }
    await db.deleteDoc(keyDocPath(uid, provider)).catch(() => {}); // alte Kopie in Firestore aufräumen
    return;
  }
  await db.setDoc(keyDocPath(uid, provider), record);
}
async function deleteKey(uid, provider) {
  if (neon.isConfigured()) {
    try { await neon.remove(NEON_TABLE, { uid, provider }); } catch (e) { if (inNeon(provider)) throw neonFail(e); }
  }
  await db.deleteDoc(keyDocPath(uid, provider)).catch((e) => { if (!inNeon(provider)) throw e; });
}
async function listKeys(uid) {
  const [fsKeys, sbKeys] = await Promise.all([
    db.runQuery('user_provider_keys', { where: [['uid', '==', uid]] }),
    neon.isConfigured() ? neon.select(NEON_TABLE, { uid }).catch((e) => { console.error('[byok] Neon lesen:', e.message); return []; }) : []
  ]);
  const byProvider = new Map(fsKeys.map(k => [k.provider, k]));
  for (const k of sbKeys) byProvider.set(k.provider, k); // Neon hat Vorrang
  return [...byProvider.values()];
}

async function allocUniqueShortDoc(collection, buildDoc) {
  for (let i = 0; i < 8; i++) {
    const id = 10_000_000 + crypto.randomInt(0, 900_000_000);
    const doc = buildDoc(id);
    try {
      return await db.createDoc(`${collection}/${id}`, doc);
    } catch (e) {
      if (e.code === 'ALREADY_EXISTS' || e.code === 'PERMISSION_DENIED') continue;
      throw e;
    }
  }
  throw fail(500, 'Konnte keine ID vergeben.');
}

// ---------- Zugriff ----------
async function keyOf(uid, provider) {
  const r = await keyRecord(uid, provider);
  if (!r) return null;
  try { return await decrypt(r.key_enc); } catch (e) { console.error('[byok] Key nicht lesbar:', e.message); return null; }
}

// "byok:<id>" -> { provider, id (Modell-ID beim Anbieter), apiKey, levels, defaultLevel, label }
async function resolve(uid, tier) {
  if (!isByok(tier)) throw fail(400, 'Ungültiges Modell.');
  const m = await db.getDoc(`user_models/${parseInt(tier.slice(5), 10)}`);
  if (!m || m.uid !== uid) throw fail(404, 'Dieses eigene Modell gibt es nicht mehr. Wähle ein anderes Modell.');
  const apiKey = await keyOf(uid, m.provider);
  if (!apiKey) throw fail(400, `Für ${PROVIDERS[m.provider]?.name || m.provider} ist kein API-Key hinterlegt (Einstellungen → Eigene Modelle).`);
  return { provider: m.provider, id: m.model_id, apiKey, levels: m.levels || [], defaultLevel: m.default_level, label: m.label };
}
// Denkstufe für diesen Aufruf: die gewünschte, wenn das Modell sie hat, sonst seine Standardstufe
const levelFor = (own, wanted) => (own.levels.includes(wanted) ? wanted : (own.levels.includes(own.defaultLevel) ? own.defaultLevel : own.levels[0]));

// "chain:<id>" -> Mitglieder der Kette in Reihenfolge. Eigene Modelle ohne Key oder gelöschte werden übersprungen;
// Coden-Stufen unterliegen den gleichen Sperren wie sonst (Ultra nur Owner, Admin-Sperren).
async function resolveChain(uid, tier, { isOwner = false } = {}) {
  if (!isChain(tier)) throw fail(400, 'Ungültige Kette.');
  const c = await db.getDoc(`user_chains/${parseInt(tier.slice(6), 10)}`);
  if (!c || c.uid !== uid) throw fail(404, 'Diese Kette gibt es nicht mehr. Wähle ein anderes Modell.');
  let locks = {};
  if (!isOwner && (c.members || []).some(m => BUILTIN[m])) {
    const st = await db.getDoc('system_state/global');
    locks = st?.locks || {};
  }
  const members = [];
  for (const m of c.members || []) {
    if (BUILTIN[m]) {
      if (!isOwner && ((m === 'ultra' && locks.ultra !== false) || (m === 'pro' && locks.pro) || (m === 'normal' && locks.thinking))) continue;
      members.push({ kind: 'builtin', tier: m });
    } else if (isByok(m)) { try { members.push({ kind: 'own', ...(await resolve(uid, m)) }); } catch (e) { /* Modell oder Key fehlt: überspringen */ } }
  }
  if (!members.length) throw fail(400, `In der Kette „${c.name}“ ist kein Modell nutzbar (Key fehlt oder Modell gelöscht).`);
  return { name: c.name, members, ownOnly: members.every(m => m.kind === 'own') };
}

// Zählt die Nutzung gegen die Coden-Limits? Nein bei eigenen Modellen und Ketten, die nur aus eigenen Modellen bestehen.
async function freeOfQuota(uid, tier) {
  if (isByok(tier)) return true;
  if (!isChain(tier)) return false;
  const c = await db.getDoc(`user_chains/${parseInt(tier.slice(6), 10)}`);
  return !!c && c.uid === uid && (c.members || []).length > 0 && c.members.every(isByok);
}
// Gehört das Modell/die Kette diesem Nutzer? (für Anfragen mit frei wählbarer Stufe)
async function owns(uid, tier) {
  if (isByok(tier)) {
    const m = await db.getDoc(`user_models/${parseInt(tier.slice(5), 10)}`);
    return !!m && m.uid === uid;
  }
  if (isChain(tier)) {
    const c = await db.getDoc(`user_chains/${parseInt(tier.slice(6), 10)}`);
    return !!c && c.uid === uid;
  }
  return false;
}
// Anzeigenamen aller eigenen Modelle/Ketten (für die Agenten-Anzeige)
async function labels(uid) {
  const out = {};
  const models = await db.runQuery('user_models', { where: [['uid', '==', uid]] });
  const chains = await db.runQuery('user_chains', { where: [['uid', '==', uid]] });
  for (const m of models) out['byok:' + m.id] = m.label;
  for (const c of chains) out['chain:' + c.id] = c.name;
  return out;
}

// ---------- App-Modus: Modelle der Agenten ----------
// main wird im Builder gewählt. Hier: Sub-Agenten – welches Modell (pro Schwierigkeit), wie viele gleichzeitig über den Key.
const AGENT_DEFAULT = { sub: 'auto', levels: { easy: 'auto', medium: 'auto', hard: 'auto' }, keyMax: 3, overflow: 'wait', overflowTier: 'flash' };
async function getAgentConfig(uid) {
  const r = await db.getDoc(`user_agent_cfg/${uid}`);
  const c = r?.cfg || {};
  return { ...AGENT_DEFAULT, ...c, levels: { ...AGENT_DEFAULT.levels, ...(c.levels || {}) } };
}
async function setAgentConfig(uid, b = {}) {
  const [models, chains] = await Promise.all([
    db.runQuery('user_models', { where: [['uid', '==', uid]] }),
    db.runQuery('user_chains', { where: [['uid', '==', uid]] })
  ]);
  const mine = new Set([...models.map(m => 'byok:' + m.id), ...chains.map(c => 'chain:' + c.id)]);
  const tierOk = (t) => (t === 'auto' || BUILTIN[t] || mine.has(t) ? t : 'auto');
  const keyMax = Math.max(1, Math.min(8, parseInt(b.keyMax, 10) || AGENT_DEFAULT.keyMax));
  const cfg = {
    sub: tierOk(b.sub),
    levels: { easy: tierOk(b.levels?.easy), medium: tierOk(b.levels?.medium), hard: tierOk(b.levels?.hard) },
    keyMax,
    overflow: b.overflow === 'coden' ? 'coden' : 'wait',
    overflowTier: ['flash', 'normal', 'pro'].includes(b.overflowTier) ? b.overflowTier : 'flash'
  };
  await db.setDoc(`user_agent_cfg/${uid}`, { uid, cfg, updated_at: db.nowIso() });
  return cfg;
}

// Dem Nutzer zeigen: nie den Key, nur ob und woran er endet
async function overview(uid) {
  const [keys, models, chains] = await Promise.all([
    listKeys(uid),
    db.runQuery('user_models', { where: [['uid', '==', uid]], orderBy: 'id' }),
    db.runQuery('user_chains', { where: [['uid', '==', uid]], orderBy: 'id' })
  ]);
  const have = new Map(keys.map(k => [k.provider, k.hint]));
  const readyModel = new Set(models.filter(m => have.has(m.provider)).map(m => 'byok:' + m.id));
  const nameOf = new Map([...models.map(m => ['byok:' + m.id, m.label]), ...Object.entries(BUILTIN)]);
  return {
    levels: LEVELS, builtin: Object.entries(BUILTIN).map(([tier, label]) => ({ tier, label })), agentConfig: await getAgentConfig(uid),
    chains: chains.map(c => ({ id: c.id, tier: 'chain:' + c.id, name: c.name, members: (c.members || []).map(t => ({ tier: t, label: nameOf.get(t) || 'gelöscht', ok: !!BUILTIN[t] || readyModel.has(t) })), ready: (c.members || []).some(t => BUILTIN[t] || readyModel.has(t)) })),
    providers: Object.entries(PROVIDERS).map(([id, p]) => ({ id, name: p.name, link: p.link, keyHint: p.keyHint, levels: p.levels, suggest: p.suggest, hasKey: have.has(id), hint: have.get(id) || null, store: keyStoreOf(id) })),
    models: models.map(m => ({ id: m.id, tier: 'byok:' + m.id, provider: m.provider, providerName: PROVIDERS[m.provider]?.name || m.provider, modelId: m.model_id, label: m.label, levels: m.levels || [], defaultLevel: m.default_level, ready: have.has(m.provider) }))
  };
}

// ---------- Modellliste des Anbieters (mit dem Key des Nutzers) ----------
async function fetchJson(url, headers) {
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
  let d = {}; try { d = await r.json(); } catch (_) { /* kein JSON */ }
  if (!r.ok) throw fail(r.status === 401 || r.status === 403 ? 400 : 502, d.error?.message || d.message || `Der Anbieter antwortet mit HTTP ${r.status} (stimmt der Key?).`);
  return d;
}
async function listProviderModels(provider, key) {
  if (provider === 'google') {
    const d = await fetchJson('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { 'x-goog-api-key': key });
    return (d.models || []).filter(m => (m.supportedGenerationMethods || []).includes('generateContent')).map(m => ({ id: String(m.name).replace(/^models\//, ''), label: m.displayName || m.name }));
  }
  if (provider === 'openai') {
    const d = await fetchJson('https://api.openai.com/v1/models', { Authorization: `Bearer ${key}` });
    return (d.data || []).map(m => m.id).filter(id => !/embed|whisper|tts|dall-e|moderation|image|audio|realtime|transcribe|davinci|babbage|search/i.test(id)).sort().map(id => ({ id, label: id }));
  }
  if (provider === 'anthropic') {
    const d = await fetchJson('https://api.anthropic.com/v1/models?limit=100', { 'x-api-key': key, 'anthropic-version': '2023-06-01' });
    return (d.data || []).map(m => ({ id: m.id, label: m.display_name || m.id }));
  }
  if (provider === 'numes') {
    const d = await fetchJson('https://api.numes.ai/api/v1/models', { Authorization: `Bearer ${key}` });
    const list = Array.isArray(d) ? d : (d.data || d.models || []);
    return list.map(m => (typeof m === 'string' ? { id: m, label: m } : { id: m.id, label: m.name || m.id })).filter(m => m.id);
  }
  if (provider === 'kilo') {
    const d = await fetchJson('https://app.kilo.ai/api/gateway/models', { Authorization: `Bearer ${key}` });
    const list = (Array.isArray(d) ? d : (d.data || d.models || [])).filter(m => m && (typeof m === 'string' || m.id));
    list.sort((a, b) => Number(!!b?.isFree) - Number(!!a?.isFree));
    return list.map(m => (typeof m === 'string' ? { id: m, label: m } : { id: m.id, label: m.name || m.id }));
  }
  if (provider === 'aihubmix') {
    const d = await fetchJson('https://aihubmix.com/v1/models', { Authorization: `Bearer ${key}` });
    const list = (Array.isArray(d) ? d : (d.data || d.models || [])).filter(m => m && (typeof m === 'string' || m.id));
    return list.map(m => (typeof m === 'string' ? { id: m, label: m } : { id: m.id, label: m.name || m.id }));
  }
  if (provider === 'orcarouter') {
    const d = await fetchJson('https://api.orcarouter.ai/v1/models', { Authorization: `Bearer ${key}` });
    const list = (Array.isArray(d) ? d : (d.data || d.models || [])).filter(m => m && (typeof m === 'string' || m.id));
    const isFree = (m) => (typeof m === 'string'
      ? /:free$|\/free$/i.test(m)
      : !!(m.isFree || /:free$|\/free$/i.test(m.id || '') || (m.pricing && Number(m.pricing.prompt) === 0 && Number(m.pricing.completion) === 0)));
    list.sort((a, b) => Number(isFree(b)) - Number(isFree(a)));
    return list.map(m => (typeof m === 'string' ? { id: m, label: m } : { id: m.id, label: m.name || m.id }));
  }
  const d = await fetchJson('https://openrouter.ai/api/v1/models', { Authorization: `Bearer ${key}` });
  return (d.data || []).map(m => ({ id: m.id, label: m.name || m.id }));
}

// ---------- API ----------
function byokRouter(requireAuth) {
  const r = wrapRouter(express.Router());
  r.use(requireAuth, rateLimit('byok', 60, 60));
  const provider = (req) => { const p = req.params.provider || req.body?.provider; if (!PROVIDERS[p]) throw fail(400, 'Unbekannter Anbieter.'); return p; };

  r.get('/', async (req, res) => res.json(await overview(req.user.uid)));

  r.put('/keys/:provider', async (req, res) => {
    const p = provider(req); const key = typeof req.body?.key === 'string' ? req.body.key.trim() : '';
    if (key.length < 8 || key.length > 400 || /\s/.test(key)) throw fail(400, 'Das sieht nicht wie ein API-Key aus.');
    await saveKey(req.user.uid, p, {
      uid: req.user.uid,
      provider: p,
      key_enc: await encrypt(key),
      hint: hintOf(key),
      created_at: db.nowIso()
    });
    res.json(await overview(req.user.uid));
  });
  r.delete('/keys/:provider', async (req, res) => {
    const p = provider(req);
    await deleteKey(req.user.uid, p);
    res.json(await overview(req.user.uid));
  });

  // „Modelle laden“: alle Modelle, die der Key des Nutzers bei diesem Anbieter sieht
  r.get('/providers/:provider/models', rateLimit('byok-list', 10, 60), async (req, res) => {
    const p = provider(req); const key = await keyOf(req.user.uid, p);
    if (!key) throw fail(400, 'Speichere zuerst deinen API-Key.');
    res.json({ models: (await listProviderModels(p, key)).slice(0, 600) });
  });

  r.post('/models', async (req, res) => {
    const p = provider(req); const b = req.body || {};
    const modelId = typeof b.modelId === 'string' ? b.modelId.trim() : '';
    if (!/^[\w.\-:/@]{1,120}$/.test(modelId)) throw fail(400, 'Die Modell-ID ist ungültig.');
    const label = (typeof b.label === 'string' && b.label.trim() ? b.label.trim() : modelId).slice(0, 60);
    const levels = LEVELS.filter(l => Array.isArray(b.levels) && b.levels.includes(l)); // in fester Reihenfolge, nur bekannte Stufen
    const def = levels.includes(b.defaultLevel) ? b.defaultLevel : (levels.includes('medium') ? 'medium' : levels[0] || null);
    const mine = await db.runQuery('user_models', { where: [['uid', '==', req.user.uid]] });
    const known = mine.find(m => m.provider === p && m.model_id === modelId);
    if (known) {
      await db.updateDoc(`user_models/${known.id}`, { label, levels, default_level: def });
    } else {
      if (mine.length >= MAX_MODELS) throw fail(400, `Du kannst höchstens ${MAX_MODELS} eigene Modelle anlegen.`);
      await allocUniqueShortDoc('user_models', (id) => ({
        id,
        uid: req.user.uid,
        provider: p,
        model_id: modelId,
        label,
        levels,
        default_level: def,
        created_at: db.nowIso()
      }));
    }
    res.json(await overview(req.user.uid));
  });

  r.delete('/models/:id', async (req, res) => {
    const id = parseInt(req.params.id, 10); if (!Number.isFinite(id)) throw fail(400, 'Ungültig.');
    const existing = await db.getDoc(`user_models/${id}`);
    if (existing && existing.uid === req.user.uid) {
      await db.deleteDoc(`user_models/${id}`);
    }
    const chains = await db.runQuery('user_chains', { where: [['uid', '==', req.user.uid]] });
    const tag = 'byok:' + id;
    for (const c of chains) {
      if (Array.isArray(c.members) && c.members.includes(tag)) {
        await db.updateDoc(`user_chains/${c.id}`, { members: c.members.filter(m => m !== tag) });
      }
    }
    res.json(await overview(req.user.uid));
  });

  // Ausweich-Ketten: Modelle der Reihe nach probieren, bis eines antwortet
  r.post('/chains', async (req, res) => {
    const b = req.body || {}; const name = typeof b.name === 'string' ? b.name.trim().slice(0, 40) : '';
    if (!name) throw fail(400, 'Gib der Kette einen Namen.');
    const members = [...new Set(Array.isArray(b.members) ? b.members.filter(m => BUILTIN[m] || isByok(m)) : [])].slice(0, MAX_CHAIN_LEN);
    if (!members.length) throw fail(400, 'Eine Kette braucht mindestens ein Modell.');
    const myModels = await db.runQuery('user_models', { where: [['uid', '==', req.user.uid]] });
    const mine = new Set(myModels.map(m => 'byok:' + m.id));
    if (members.some(m => isByok(m) && !mine.has(m))) throw fail(400, 'Die Kette enthält ein unbekanntes Modell.');
    const id = parseInt(b.id, 10);
    if (Number.isFinite(id)) {
      const existing = await db.getDoc(`user_chains/${id}`);
      if (!existing || existing.uid !== req.user.uid) throw fail(404, 'Kette nicht gefunden.');
      await db.updateDoc(`user_chains/${id}`, { name, members });
    } else {
      const chains = await db.runQuery('user_chains', { where: [['uid', '==', req.user.uid]] });
      if (chains.length >= MAX_CHAINS) throw fail(400, `Du kannst höchstens ${MAX_CHAINS} Ketten anlegen.`);
      await allocUniqueShortDoc('user_chains', (newId) => ({
        id: newId,
        uid: req.user.uid,
        name,
        members,
        created_at: db.nowIso()
      }));
    }
    res.json(await overview(req.user.uid));
  });

  r.delete('/chains/:id', async (req, res) => {
    const id = parseInt(req.params.id, 10); if (!Number.isFinite(id)) throw fail(400, 'Ungültig.');
    const existing = await db.getDoc(`user_chains/${id}`);
    if (existing && existing.uid === req.user.uid) {
      await db.deleteDoc(`user_chains/${id}`);
    }
    res.json(await overview(req.user.uid));
  });

  r.put('/agent-config', async (req, res) => { await setAgentConfig(req.user.uid, req.body); res.json(await overview(req.user.uid)); });

  // Fehler mit Status (z. B. 400 „Key ungültig“) im Klartext zurückgeben, alles andere bleibt „Serverfehler“
  r.use((err, req, res, next) => { if (err.status) return res.status(err.status).json({ error: err.message }); console.error('[byok]', err); res.status(500).json({ error: 'Serverfehler.' }); });
  return r;
}

module.exports = { keyStoreOf, neonProviders, byokRouter, resolve, resolveChain, levelFor, freeOfQuota, owns, labels, getAgentConfig, setAgentConfig, encrypt, decrypt, isByok, isChain, isOwnTier, PROVIDERS, BUILTIN, LEVELS, DEFAULT_LEVELS };
