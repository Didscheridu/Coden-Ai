// KI-Anbieter. Alle Keys kommen ausschließlich aus Umgebungsvariablen.
const { getSql } = require('./db');

// Alle Gratis-Modelle von OpenRouter (Stand 21.11.2026, per OpenRouter-MCP abgefragt, Preis 0 $ rein/raus).
// Reihenfolge = Stärke (Artificial-Analysis-Index, soweit vorhanden), stärkstes zuerst.
const OPENROUTER_FREE = [
  'nvidia/nemotron-3.5-super-vl:free',               // 1M Kontext, versteht Bilder/Video
  'nvidia/nemotron-3-ultra-550b-a55b:free',          // 1M Kontext, groß (550B MoE)
  'baidu/ernie-5.5-flash-preview:free',              // 1M Kontext
  'particle-ai/particle-1:free',                     // 1M Kontext, Coding, Bilder
  'inclusionai/ling-3.2-flash:free',                 // 1M Kontext, Bilder
  'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free', // multimodal
  'google/gemma-4-31b-it:free',                      // 256K, Bilder
  'google/gemma-4-26b-a4b-it:free',                  // 256K, Bilder
  'recursive/flint-v1.0:free',                       // 256K, Coding
  'nvidia/nemotron-3.5-lightning:free',              // klein und schnell
  'liquid/lfm-3-1.7b:free'                           // sehr klein
];
// NVIDIA NIM (build.nvidia.com): gratis ohne Kreditkarte, ca. 40 Anfragen/Minute, große Modelle (Modell-IDs per /v1/models abgefragt, 22.11.2026).
// Schlägt eines fehl (Limit, nicht freigeschaltet), springt die Kaskade zum nächsten.
const nvidia = (ids) => ids.map(id => ({ provider: 'nvidia', id }));
const NVIDIA_STRONG = ['moonshotai/kimi-k3.1-pro', 'mistralai/mistral-large-4-1t-a52b', 'nvidia/nemotron-3-ultra-550b-a55b'];
const NVIDIA_FAST = ['z-ai/glm-5.3-flash', 'minimaxai/minimax-m3.1-flash', 'nvidia/nemotron-3.5-lightning-30b-a3b'];
const openrouter = (ids) => ids.map(id => ({ provider: 'openrouter', id }));

// Knappe Gemini-Modelle: nur als LETZTE Rettung (ganz hinten in der Kaskade) und mit Tageslimit.
// total = Limit pro Tag bei Google, publicMax = davon dürfen normale Nutzer höchstens verbrauchen.
// Der Rest (total - publicMax) ist für den Owner reserviert. Anpassbar über Umgebungsvariablen.
const intEnv = (name, def) => { const n = parseInt(process.env[name], 10); return Number.isFinite(n) && n >= 0 ? n : def; };
const QUOTAS = {
  'gemini-4-hydrogen': { total: intEnv('GEMINI_4_HYDROGEN_DAILY', 20), publicMax: intEnv('GEMINI_4_HYDROGEN_PUBLIC', 10) },
  'gemini-3.8-flash': { total: intEnv('GEMINI_3_8_FLASH_DAILY', 20), publicMax: intEnv('GEMINI_3_8_FLASH_PUBLIC', 10) }
};

// Die drei Stufen der App: erst Google (schnell) und Groq, dann alle OpenRouter-Gratismodelle.
// (Modell-IDs laut Google-AI-Studio- und Groq-Doku, Stand 21.11.2026)
const THINKING_FIRST = [
  'nvidia/nemotron-3-ultra-550b-a55b:free',
  'baidu/ernie-5.5-flash-preview:free',
  'nvidia/nemotron-3.5-super-vl:free',
  'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free'
];

const CASCADES = {
  // Schnell: kleine Modelle zuerst
  flash: [
    { provider: 'google', id: 'gemini-3.5-flash-lite' },
    { provider: 'groq', id: 'openai/gpt-oss-20b' },
    ...nvidia(NVIDIA_FAST),
    ...openrouter([...OPENROUTER_FREE].reverse())
  ],
  // Thinking: zuerst die großen NVIDIA-Denkmodelle und ERNIE 5.5 Flash (alle gratis über OpenRouter), dann der Rest, dann Groq
  normal: [
    ...nvidia(NVIDIA_STRONG),
    ...openrouter(THINKING_FIRST),
    ...openrouter(OPENROUTER_FREE.filter(m => !THINKING_FIRST.includes(m))),
    { provider: 'groq', id: 'qwen/qwen3.8-27b' },
    { provider: 'groq', id: 'openai/gpt-oss-20b' },
    { provider: 'groq', id: 'llama-3.3-70b-versatile' }, // bei Groq "Enterprise": kann ohne Vertrag fehlschlagen, dann springt die Kaskade weiter
    { provider: 'google', id: 'gemini-3.8-flash' }      // letzte Rettung, begrenzt
  ],
  // Pro: stärkste zuerst
  pro: [
    { provider: 'groq', id: 'openai/gpt-oss-120b' },
    ...nvidia(NVIDIA_STRONG),
    { provider: 'groq', id: 'llama-3.3-70b-versatile' },
    ...openrouter(OPENROUTER_FREE),
    { provider: 'google', id: 'gemini-4-hydrogen' }     // letzte Rettung, begrenzt
  ]
};

const OPENAI_COMPAT = {
  openrouter: { url: 'https://openrouter.ai/api/v1/chat/completions', env: 'OPENROUTER_API_KEY' },
  nvidia: { url: 'https://integrate.api.nvidia.com/v1/chat/completions', env: 'NVIDIA_API_KEY' },
  groq: { url: 'https://api.groq.com/openai/v1/chat/completions', env: 'GROQ_API_KEY' },
};

// ---------- Tageskontingent ----------
const pacificDay = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });

// Zählt einen Aufruf atomar. true = erlaubt. Normale Nutzer dürfen nur bis publicMax, der Owner bis total.
async function reserveQuota(model, isOwner) {
  const q = QUOTAS[model];
  if (!q) return true;
  const pub = isOwner ? 0 : 1;
  if (q.total < 1 || (!isOwner && q.publicMax < 1)) return false;
  const rows = await getSql()`
    INSERT INTO model_quota (model, day, total, public) VALUES (${model}, ${pacificDay()}, 1, ${pub})
    ON CONFLICT (model, day) DO UPDATE
      SET total = model_quota.total + 1, public = model_quota.public + ${pub}
      WHERE model_quota.total < ${q.total} AND (${pub} = 0 OR model_quota.public < ${q.publicMax})
    RETURNING total`;
  return rows.length > 0;
}

// ---------- Nachrichten umwandeln ----------
function toOpenAI(messages) {
  return messages.map(m => {
    if (m.images?.length) {
      return { role: m.role, content: [{ type: 'text', text: m.content || 'Beschreibe dieses Bild.' },
        ...m.images.map(url => ({ type: 'image_url', image_url: { url } }))] };
    }
    return { role: m.role, content: m.content };
  });
}

function toGemini(modelId, messages) {
  const contents = []; let system = null;
  for (const m of messages) {
    if (m.role === 'system') { system = m.content; continue; }
    const parts = [{ text: m.content || 'Beschreibe dieses Bild.' }];
    for (const img of m.images || []) {
      const mime = img.substring(img.indexOf(':') + 1, img.indexOf(';'));
      parts.push({ inlineData: { mimeType: mime, data: img.substring(img.indexOf(',') + 1) } });
    }
    contents.push({ role: m.role === 'assistant' ? 'model' : 'user', parts });
  }
  const body = { contents };
  if (system) {
    if (modelId.includes('gemma') && contents.length) contents[0].parts[0].text = `${system}\n\n---\n\n${contents[0].parts[0].text}`;
    else body.systemInstruction = { parts: [{ text: system }] };
  }
  return body;
}

// Filtert <think>…</think> auch dann, wenn die Tags über Stream-Stücke verteilt ankommen
class ThinkFilter {
  constructor() { this.buf = ''; this.inThink = false; }
  push(chunk) {
    this.buf += chunk; let out = '';
    for (;;) {
      if (this.inThink) {
        const i = this.buf.indexOf('</think>');
        if (i === -1) { this.buf = this.buf.slice(-8); return out; }
        this.buf = this.buf.slice(i + 8).replace(/^\n+/, ''); this.inThink = false;
      } else {
        const i = this.buf.indexOf('<think>');
        if (i !== -1) { out += this.buf.slice(0, i); this.buf = this.buf.slice(i + 7); this.inThink = true; continue; }
        const hold = Math.min(6, this.buf.length); let keep = 0;
        for (let k = hold; k > 0; k--) if ('<think>'.startsWith(this.buf.slice(-k))) { keep = k; break; }
        out += this.buf.slice(0, this.buf.length - keep); this.buf = this.buf.slice(this.buf.length - keep); return out;
      }
    }
  }
  flush() { const r = this.inThink ? '' : this.buf; this.buf = ''; return r; }
}

// Liest Server-Sent-Events und liefert die "data:"-Inhalte
async function* sseData(res) {
  const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, i).replace(/\r$/, ''); buf = buf.slice(i + 1);
      if (line.startsWith('data:')) yield line.slice(5).trim();
    }
  }
  if (buf.startsWith('data:')) yield buf.slice(5).trim();
}

async function failFrom(r) {
  let msg = `HTTP ${r.status}`;
  try { const d = await r.json(); msg = d.error?.message || d.message || msg; } catch (e) { /* kein JSON */ }
  throw new Error(msg);
}

// ---------- Ein Modell aufrufen (stream=true: Stücke an onDelta) ----------
async function callModel(m, messages, { stream, onDelta, signal, maxTokens }) {
  if (m.provider === 'google') {
    const key = process.env.GOOGLE_API_KEY;
    if (!key) throw new Error('GOOGLE_API_KEY fehlt');
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${m.id}:${stream ? 'streamGenerateContent?alt=sse' : 'generateContent'}`;
    const r = await fetch(url, { method: 'POST', signal, headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify(toGemini(m.id, messages)) });
    if (!r.ok) await failFrom(r);
    const textOf = (d) => (d.candidates?.[0]?.content?.parts || []).filter(p => p.text && !p.thought).map(p => p.text).join('');
    if (!stream) return textOf(await r.json());
    let full = '';
    for await (const raw of sseData(r)) { let d; try { d = JSON.parse(raw); } catch (e) { continue; } const t = textOf(d); if (t) { full += t; onDelta(t); } }
    return full;
  }
  const cfg = OPENAI_COMPAT[m.provider];
  const key = process.env[cfg.env];
  if (!key) throw new Error(`${cfg.env} fehlt`);
  const r = await fetch(cfg.url, {
    method: 'POST', signal,
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://coden-ai.vercel.app', 'X-Title': 'Coden AI' },
    body: JSON.stringify({ model: m.id, messages: toOpenAI(messages), max_tokens: maxTokens || 8192, temperature: 0.7, ...(stream ? { stream: true } : {}) })
  });
  if (!r.ok) await failFrom(r);
  if (!stream) { const d = await r.json(); if (d.error) throw new Error(d.error.message); return d.choices?.[0]?.message?.content || ''; }
  let full = '';
  for await (const raw of sseData(r)) {
    if (raw === '[DONE]') break;
    let d; try { d = JSON.parse(raw); } catch (e) { continue; }
    if (d.error) throw new Error(d.error.message || 'Stream-Fehler');
    const t = d.choices?.[0]?.delta?.content; // Denk-Teile (reasoning) werden bewusst ignoriert
    if (t) { full += t; onDelta(t); }
  }
  return full;
}

// ---------- Modellliste (für den Befehl /modelle) ----------
const PROVIDER_NAMES = { nvidia: 'NVIDIA', groq: 'Groq', openrouter: 'OpenRouter', google: 'Google' };
const keyOf = (m) => `${m.provider}:${m.id}`;
function listModels() {
  const seen = new Map();
  for (const tier of ['pro', 'normal', 'flash']) for (const m of CASCADES[tier]) if (!seen.has(keyOf(m))) seen.set(keyOf(m), { key: keyOf(m), provider: m.provider, providerName: PROVIDER_NAMES[m.provider] || m.provider, id: m.id,
    ready: m.provider === 'google' ? !!process.env.GOOGLE_API_KEY : !!process.env[OPENAI_COMPAT[m.provider]?.env], limited: !!QUOTAS[m.id] });
  return [...seen.values()];
}
const findModel = (key) => listModels().find(m => m.key === key) || null;

// ---------- Kaskade ----------
// Probiert die Modelle der Stufe der Reihe nach. Fällt eines aus (oder liefert nichts), kommt das nächste.
// Beim Streamen ist Wechsel nur möglich, solange noch nichts an den Nutzer geschickt wurde.
async function run(tier, messages, { isOwner = false, stream = false, onDelta = () => {}, onModel = () => {}, signal, maxTokens, pin } = {}) {
  let cascade = CASCADES[tier];
  if (pin) { // ein bestimmtes Modell erzwingen (nur Owner, kein Ausweichen auf andere)
    const m = findModel(pin);
    if (!m) throw Object.assign(new Error('Unbekanntes Modell.'), { status: 400 });
    cascade = [m];
  }
  if (!cascade) throw Object.assign(new Error('Unbekannter Modus.'), { status: 400 });
  let last;
  for (const m of cascade) {
    if (signal?.aborted) throw new Error('abgebrochen');
    try {
      if (QUOTAS[m.id] && !(await reserveQuota(m.id, isOwner))) { last = new Error(`${m.id}: Tageslimit erreicht`); continue; }
      let sent = false; const filter = new ThinkFilter();
      const emit = (t) => { const v = filter.push(t); if (v) { if (!sent) { sent = true; onModel(m); } onDelta(v); } };
      const full = await callModel(m, messages, { stream, onDelta: emit, signal, maxTokens }).catch((e) => { if (sent) e.partial = true; throw e; });
      if (stream) {
        const rest = filter.flush(); if (rest) { if (!sent) { sent = true; onModel(m); } onDelta(rest); }
        if (!sent) throw new Error('Leere Antwort');
        return { model: m };
      }
      const clean = full.replace(/<think>[\s\S]*?<\/think>\n*/gi, '').trim();
      if (!clean) throw new Error('Leere Antwort (Modell hat nur nachgedacht).');
      return { text: clean, model: m };
    } catch (e) {
      if (e.partial) throw e; // schon Text beim Nutzer: nicht mehr wechseln
      console.warn(`[ai] ${m.provider}/${m.id} fehlgeschlagen:`, e.message);
      last = e;
    }
  }
  throw new Error(`Alle Server sind überlastet. Letzter Fehler: ${last?.message}`);
}

const generate = async (tier, messages, opts = {}) => (await run(tier, messages, opts)).text;
const generateStream = (tier, messages, opts) => run(tier, messages, { ...opts, stream: true });

module.exports = { listModels, generate, generateStream, CASCADES, QUOTAS, ThinkFilter };
