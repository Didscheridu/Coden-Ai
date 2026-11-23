// Bring your own Key: Nutzer bringen eigene API-Keys (Google AI Studio, OpenAI, Anthropic, OpenRouter) mit
// und fügen eigene Modelle hinzu, die im Auswahlmenü erscheinen.
// - Keys liegen verschlüsselt (AES-256-GCM) in der Datenbank und verlassen den Server nie wieder.
// - Ein eigenes Modell hat die Stufe "byok:<id>". Der Server löst Key und Modell erst beim Aufruf auf
//   (Läufe in der Datenbank speichern also nie einen Klartext-Key).
const crypto = require('crypto');
const express = require('express');
const { getSql } = require('./db');
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
  }
};
const MAX_MODELS = 40;
const isByok = (tier) => typeof tier === 'string' && /^byok:\d{1,9}$/.test(tier);

// ---------- Verschlüsselung ----------
// Geheimnis: Umgebungsvariable BYOK_SECRET, sonst einmalig erzeugt und in app_secrets abgelegt (wie bei den Push-Schlüsseln).
let master = null;
async function masterKey() {
  if (master) return master;
  let secret = process.env.BYOK_SECRET;
  if (!secret) {
    const sql = getSql();
    const [r] = await sql`SELECT value FROM app_secrets WHERE name = 'byok'`;
    if (r) secret = r.value.secret;
    else {
      await sql`INSERT INTO app_secrets (name, value) VALUES ('byok', ${JSON.stringify({ secret: crypto.randomBytes(32).toString('hex') })}::jsonb) ON CONFLICT (name) DO NOTHING`;
      const [again] = await sql`SELECT value FROM app_secrets WHERE name = 'byok'`; // gleichzeitig gestartete Server nutzen dasselbe Geheimnis
      secret = again.value.secret;
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

// ---------- Zugriff ----------
async function keyOf(uid, provider) {
  const [r] = await getSql()`SELECT key_enc FROM user_provider_keys WHERE uid = ${uid} AND provider = ${provider}`;
  if (!r) return null;
  try { return await decrypt(r.key_enc); } catch (e) { console.error('[byok] Key nicht lesbar:', e.message); return null; }
}

// "byok:<id>" -> { provider, id (Modell-ID beim Anbieter), apiKey, levels, defaultLevel, label }
async function resolve(uid, tier) {
  if (!isByok(tier)) throw fail(400, 'Ungültiges Modell.');
  const [m] = await getSql()`SELECT id, provider, model_id, label, levels, default_level FROM user_models WHERE id = ${parseInt(tier.slice(5), 10)} AND uid = ${uid}`;
  if (!m) throw fail(404, 'Dieses eigene Modell gibt es nicht mehr. Wähle ein anderes Modell.');
  const apiKey = await keyOf(uid, m.provider);
  if (!apiKey) throw fail(400, `Für ${PROVIDERS[m.provider]?.name || m.provider} ist kein API-Key hinterlegt (Einstellungen → Eigene Modelle).`);
  return { provider: m.provider, id: m.model_id, apiKey, levels: m.levels || [], defaultLevel: m.default_level, label: m.label };
}

// Dem Nutzer zeigen: nie den Key, nur ob und woran er endet
async function overview(uid) {
  const sql = getSql();
  const keys = await sql`SELECT provider, hint FROM user_provider_keys WHERE uid = ${uid}`;
  const models = await sql`SELECT id, provider, model_id, label, levels, default_level FROM user_models WHERE uid = ${uid} ORDER BY id`;
  const have = new Map(keys.map(k => [k.provider, k.hint]));
  return {
    levels: LEVELS,
    providers: Object.entries(PROVIDERS).map(([id, p]) => ({ id, name: p.name, link: p.link, keyHint: p.keyHint, levels: p.levels, suggest: p.suggest, hasKey: have.has(id), hint: have.get(id) || null })),
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
    await getSql()`INSERT INTO user_provider_keys (uid, provider, key_enc, hint) VALUES (${req.user.uid}, ${p}, ${await encrypt(key)}, ${hintOf(key)})
      ON CONFLICT (uid, provider) DO UPDATE SET key_enc = EXCLUDED.key_enc, hint = EXCLUDED.hint, created_at = now()`;
    res.json(await overview(req.user.uid));
  });
  r.delete('/keys/:provider', async (req, res) => {
    const p = provider(req);
    await getSql()`DELETE FROM user_provider_keys WHERE uid = ${req.user.uid} AND provider = ${p}`;
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
    const sql = getSql();
    const [{ n }] = await sql`SELECT count(*)::int AS n FROM user_models WHERE uid = ${req.user.uid}`;
    const [known] = await sql`SELECT id FROM user_models WHERE uid = ${req.user.uid} AND provider = ${p} AND model_id = ${modelId}`;
    if (!known && n >= MAX_MODELS) throw fail(400, `Du kannst höchstens ${MAX_MODELS} eigene Modelle anlegen.`);
    await sql`INSERT INTO user_models (uid, provider, model_id, label, levels, default_level) VALUES (${req.user.uid}, ${p}, ${modelId}, ${label}, ${JSON.stringify(levels)}::jsonb, ${def})
      ON CONFLICT (uid, provider, model_id) DO UPDATE SET label = EXCLUDED.label, levels = EXCLUDED.levels, default_level = EXCLUDED.default_level`;
    res.json(await overview(req.user.uid));
  });
  r.delete('/models/:id', async (req, res) => {
    const id = parseInt(req.params.id, 10); if (!Number.isFinite(id)) throw fail(400, 'Ungültig.');
    await getSql()`DELETE FROM user_models WHERE id = ${id} AND uid = ${req.user.uid}`;
    res.json(await overview(req.user.uid));
  });
  // Fehler mit Status (z. B. 400 „Key ungültig“) im Klartext zurückgeben, alles andere bleibt „Serverfehler“
  r.use((err, req, res, next) => { if (err.status) return res.status(err.status).json({ error: err.message }); console.error('[byok]', err); res.status(500).json({ error: 'Serverfehler.' }); });
  return r;
}

module.exports = { byokRouter, resolve, isByok, PROVIDERS, LEVELS, DEFAULT_LEVELS };
