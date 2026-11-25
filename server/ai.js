// KI-Anbieter. Alle Keys kommen ausschließlich aus Umgebungsvariablen.
const db = require('./db');
const byok = require('./byok');

// Alle Gratis-Modelle von OpenRouter (Stand 21.11.2026, per OpenRouter-MCP abgefragt, Preis 0 $ rein/raus).
// Reihenfolge = Stärke (Artificial-Analysis-Index, soweit vorhanden), stärkstes zuerst.
const OPENROUTER_FREE = [
  'nvidia/nemotron-3.5-super-vl:free',               // 1M Kontext, versteht Bilder/Video
  'nvidia/nemotron-3-ultra-550b-a55b:free',          // 1M Kontext, groß (550B MoE)
  'baidu/ernie-5.5-flash-preview:free',              // 1M Kontext
  'particle-ai/particle-1:free',                     // 1M Kontext, Coding, Bilder
  'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free', // multimodal
  'google/gemma-4-26b-a4b-it:free',                  // 256K, Bilder
  'nvidia/nemotron-3.5-lightning:free'               // klein und schnell
];
const openrouter = (ids) => ids.map(id => ({ provider: 'openrouter', id }));

// Knappe Gemini-Modelle: nur als LETZTE Rettung (ganz hinten in der Kaskade) und mit Tageslimit.
// total = Limit pro Tag bei Google, publicMax = davon dürfen normale Nutzer höchstens verbrauchen.
// Der Rest (total - publicMax) ist für den Owner reserviert. Anpassbar über Umgebungsvariablen.
const intEnv = (name, def) => { const n = parseInt(process.env[name], 10); return Number.isFinite(n) && n >= 0 ? n : def; };
const QUOTAS = {}; // aktuell hat kein Modell ein Tageslimit (die knappen Gemini-Modelle sind entfernt); der Mechanismus bleibt für künftige Modelle

// Die drei Stufen der App: erst Google (schnell) und Groq, dann alle OpenRouter-Gratismodelle.
// (Modell-IDs laut Google-AI-Studio- und Groq-Doku, Stand 21.11.2026)
const THINKING_FIRST = [
  'nvidia/nemotron-3-ultra-550b-a55b:free',
  'baidu/ernie-5.5-flash-preview:free',
  'nvidia/nemotron-3.5-super-vl:free',
  'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free'
];

// Coden Ultra: nur die besten der besten, Qualität vor Tempo.
// Standardmäßig gesperrt, nur der Owner darf (siehe api/index.js).
// Auf Wunsch von Kayden (22.11.): Nemotron 3.5 Super VL zuerst – neuer, klüger (AA-Index 13,6), besser bei Webseiten/UI,
// längere Antworten (131k), versteht Bilder. Nemotron 3 Ultra führt dafür jetzt Coden Pro an.
const ULTRA = [
  ...openrouter(['nvidia/nemotron-3.5-super-vl:free']),
  { provider: 'groq', id: 'qwen/qwen3.8-27b' },
  { provider: 'groq', id: 'openai/gpt-oss-120b' },
  ...openrouter(['nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free'])
];

const CASCADES = {
  ultra: ULTRA,
  // Schnell: kleine Modelle zuerst
  flash: [
    { provider: 'google', id: 'gemini-3.5-flash-lite' },
    { provider: 'groq', id: 'openai/gpt-oss-20b' },
    ...openrouter([...OPENROUTER_FREE].reverse())
  ],
  // Thinking: zuerst die großen Denkmodelle (Nemotron) und ERNIE 5.5 Flash (alle gratis über OpenRouter), dann der Rest, dann Groq
  normal: [
    ...openrouter(THINKING_FIRST),
    ...openrouter(OPENROUTER_FREE.filter(m => !THINKING_FIRST.includes(m))),
    { provider: 'groq', id: 'qwen/qwen3.8-27b' },
    { provider: 'groq', id: 'openai/gpt-oss-20b' },
    { provider: 'groq', id: 'openai/gpt-oss-120b' }
  ],
  // Pro: Nemotron 3 Ultra (550B, stark bei Spielen) zuerst, dann die schnellen Groq-Modelle, dann die übrigen Gratismodelle
  pro: [
    ...openrouter(['nvidia/nemotron-3-ultra-550b-a55b:free']),
    { provider: 'groq', id: 'openai/gpt-oss-120b' },
    { provider: 'groq', id: 'qwen/qwen3.8-27b' },
    ...openrouter(OPENROUTER_FREE.filter(m => m !== 'nvidia/nemotron-3-ultra-550b-a55b:free'))
  ]
};

const OPENAI_COMPAT = {
  openrouter: { url: 'https://openrouter.ai/api/v1/chat/completions', env: 'OPENROUTER_API_KEY' },
  groq: { url: 'https://api.groq.com/openai/v1/chat/completions', env: 'GROQ_API_KEY' },
  openai: { url: 'https://api.openai.com/v1/chat/completions', env: null }, // nur mit eigenem Key (Bring your own Key)
  numes: { url: 'https://api.numes.ai/api/v1/chat/completions', env: null }, // nur mit eigenem Key (numes.ai)
  kilo: { url: 'https://ai-gateway.kilo.ai/api/v1/chat/completions', env: null }, // nur mit eigenem Key (ai-gateway.kilo.ai)
  aihubmix: { url: 'https://aihubmix.com/v1/chat/completions', env: null }, // nur mit eigenem Key (aihubmix.com)
};

// ---------- Tageskontingent ----------
const pacificDay = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });

const quotaQueues = new Map();
function withQuotaLock(key, fn) {
  const prev = quotaQueues.get(key) || Promise.resolve();
  const next = prev.then(fn, fn);
  const cleanup = next.finally(() => {
    if (quotaQueues.get(key) === cleanup) quotaQueues.delete(key);
  });
  quotaQueues.set(key, cleanup);
  return next;
}

// Zählt einen Aufruf. true = erlaubt. Normale Nutzer dürfen nur bis publicMax, der Owner bis total.
async function reserveQuota(model, isOwner) {
  const q = QUOTAS[model];
  if (!q) return true;
  const pub = isOwner ? 0 : 1;
  if (q.total < 1 || (!isOwner && q.publicMax < 1)) return false;
  const key = `${String(model).replace(/[^a-zA-Z0-9_-]/g, '_')}__${pacificDay()}`;
  return withQuotaLock(key, async () => {
    try {
      for (let attempt = 0; attempt < 16; attempt++) {
        const cur = await db.getDoc(`model_quota/${key}`, { preferAdmin: true });
        if (!cur) {
          try {
            await db.createDoc(`model_quota/${key}`, { model, day: pacificDay(), total: 1, public: pub }, { preferAdmin: true });
            return true;
          } catch (e) {
            if (e.code === 'ALREADY_EXISTS') continue;
            return false;
          }
        }
        if (cur.total >= q.total || (pub > 0 && cur.public >= q.publicMax)) return false;
        try {
          await db.updateDoc(`model_quota/${key}`, { total: cur.total + 1, public: cur.public + pub }, { updateTime: cur._updateTime, preferAdmin: true });
          return true;
        } catch (e) {
          if (e.code === 'PRECONDITION_FAILED') continue;
          return false;
        }
      }
    } catch (_) {
      return false;
    }
    return false;
  });
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

function toGemini(modelId, messages, maxTokens, level) {
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
  const body = { contents, generationConfig: { maxOutputTokens: maxTokens || DEFAULT_MAX } };
  if (level) body.generationConfig.thinkingConfig = { thinkingLevel: level, includeThoughts: true }; // Denkstufe eines eigenen Modells
  if (system) {
    if (modelId.includes('gemma') && contents.length) contents[0].parts[0].text = `${system}\n\n---\n\n${contents[0].parts[0].text}`;
    else body.systemInstruction = { parts: [{ text: system }] };
  }
  return body;
}

// Anthropic: System-Text liegt außerhalb der Nachrichten, Bilder sind eigene Blöcke
function toAnthropic(messages) {
  const system = messages.filter(m => m.role === 'system').map(m => m.content).filter(Boolean).join('\n\n');
  const out = [];
  for (const m of messages) {
    if (m.role === 'system') continue;
    const text = m.content || (m.images?.length ? 'Beschreibe dieses Bild.' : '(leer)');
    if (!m.images?.length) { out.push({ role: m.role, content: text }); continue; }
    const parts = m.images.map(img => ({ type: 'image', source: { type: 'base64', media_type: img.substring(img.indexOf(':') + 1, img.indexOf(';')), data: img.substring(img.indexOf(',') + 1) } }));
    out.push({ role: m.role, content: [...parts, { type: 'text', text }] });
  }
  return { system, messages: out };
}

const DEFAULT_MAX = 16384; // pro Aufruf; wird die Antwort trotzdem abgeschnitten, setzt run() automatisch fort
const EFFORTS = ['low', 'medium', 'high'];

// Filtert <think>…</think> auch dann, wenn die Tags über Stream-Stücke verteilt ankommen
class ThinkFilter {
  constructor(onThink) { this.buf = ''; this.inThink = false; this.onThink = onThink; }
  reset() { this.buf = ''; this.inThink = false; }
  push(chunk) {
    this.buf += chunk; let out = '';
    for (;;) {
      if (this.inThink) {
        const i = this.buf.indexOf('</think>');
        if (i === -1) { if (this.onThink && this.buf.length > 8) this.onThink(this.buf.slice(0, -8)); this.buf = this.buf.slice(-8); return out; }
        if (this.onThink && i > 0) this.onThink(this.buf.slice(0, i));
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

// Macht aus dem Denk-Text eine kurze Überschrift + den Ausschnitt des aktuellen Schritts.
// Ältere Schritte werden verworfen: es gibt immer nur den aktuellen.
class ThinkTracker {
  constructor(emit, { every = 300, now = Date.now } = {}) { this.emit = emit; this.every = every; this.now = now; this.text = ''; this.last = 0; this.head = ''; this.from = 0; }
  push(chunk) {
    if (!chunk) return; this.text += chunk;
    if (this.text.length > 6000) { const cut = this.text.length - 3000; this.text = this.text.slice(cut); this.from = Math.max(0, this.from - cut); }
    const heads = [...this.text.matchAll(/(?:^|\n)\s*(?:#{1,4}\s+(.{3,80})|\*\*([^*\n]{3,80})\*\*)\s*(?=\n|$)/g)];
    const hm = heads[heads.length - 1];
    let head = this.head, changed = false;
    if (hm) { const t = (hm[1] || hm[2]).trim().replace(/[:.]+$/, ''); if (t !== this.head) { head = t; this.from = hm.index + hm[0].length; changed = true; } }
    else if (!this.head) { head = 'Überlege …'; }
    const t = this.now();
    if (!changed && t - this.last < this.every) { this.head = head; return; }
    this.head = head; this.last = t;
    const snippet = this.text.slice(this.from).replace(/\*\*/g, '').replace(/\s+/g, ' ').trim().slice(-400);
    this.emit({ h: head.slice(0, 80), v: snippet });
  }
}

// Liest Server-Sent-Events und liefert die "data:"-Inhalte
async function* sseData(res) {
  if (!res?.body) return;
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
  buf += dec.decode();
  if (buf.startsWith('data:')) yield buf.slice(5).trim();
}

function apiError(msg, { status, errorType, retryAfter } = {}) {
  const e = new Error(msg);
  if (status) e.status = status;
  if (errorType) e.errorType = errorType;
  if (retryAfter) e.retryAfter = retryAfter;
  return e;
}

async function failFrom(r) {
  let msg = `HTTP ${r.status}`, errorType = null;
  const raw = typeof r.text === 'function' ? await r.text().catch(() => '') : '';
  if (raw) {
    try {
      const d = JSON.parse(raw);
      msg = d.error?.message || d.message || msg;
      errorType = d.error?.metadata?.error_type || d.error?.type || d.error?.code || null;
    } catch (e) { /* kein JSON, z. B. HTML-502 */ }
  } else if (typeof r.json === 'function') {
    try {
      const d = await r.json();
      msg = d.error?.message || d.message || msg;
      errorType = d.error?.metadata?.error_type || d.error?.type || d.error?.code || null;
    } catch (e) { /* kein JSON */ }
  }
  const ra = parseFloat(r.headers?.get?.('retry-after') || '');
  throw apiError(msg, { status: r.status, errorType, retryAfter: Number.isFinite(ra) && ra > 0 ? ra : null });
}

function extractReasoning(obj) {
  if (!obj || typeof obj !== 'object') return '';
  const direct = obj.reasoning_content || obj.reasoning || obj.thinking;
  if (typeof direct === 'string' && direct) return direct;
  if (Array.isArray(obj.reasoning_details)) {
    return obj.reasoning_details.map(x => (typeof x === 'string' ? x : (x?.text || x?.summary || ''))).filter(Boolean).join('');
  }
  return '';
}

// Denkaufwand (niedrig/mittel/hoch): nur dort mitschicken, wo der Anbieter es versteht
function effortParams(m, effort) {
  if (!EFFORTS.includes(effort)) return {};
  if (m.provider === 'openrouter') return { reasoning: { effort } };
  if (m.provider === 'groq' && /gpt-oss/.test(m.id)) return { reasoning_effort: effort };
  return {};
}
const CONTINUE = 'Deine letzte Antwort wurde mitten im Satz oder Code abgeschnitten. Mach nahtlos genau an der Stelle weiter, an der du aufgehört hast. Keine Wiederholung, keine Einleitung, kein Hinweis auf die Unterbrechung.';

// ---------- Anthropic (nur mit eigenem Key) ----------
async function callAnthropic(m, messages, { stream, onDelta, onThink, signal, maxTokens, effort, info }) {
  if (!m.apiKey) throw new Error('ANTHROPIC_API_KEY fehlt');
  const { system, messages: msgs } = toAnthropic(messages);
  const level = m.own ? m.level : null;
  const send = (lvl) => fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST', signal,
    headers: { 'x-api-key': m.apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: m.id, max_tokens: maxTokens || DEFAULT_MAX, messages: msgs, ...(system ? { system } : {}),
      ...(lvl ? { thinking: { type: 'adaptive' }, output_config: { effort: lvl } } : {}), ...(stream ? { stream: true } : {}) })
  });
  let r = await send(level);
  if (!r.ok && level && r.status === 400) r = await send(null); // ältere Modelle kennen die Stufe nicht
  if (!r.ok) await failFrom(r);
  if (!stream) {
    const d = await r.json();
    if (d.stop_reason === 'max_tokens') info.truncated = true;
    const th = (d.content || []).filter(b => b.type === 'thinking' && b.thinking).map(b => b.thinking).join('');
    if (th) onThink?.(th);
    return (d.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
  }
  let full = '';
  for await (const raw of sseData(r)) {
    let d; try { d = JSON.parse(raw); } catch (e) { continue; }
    if (d.type === 'error') throw new Error(d.error?.message || 'Stream-Fehler');
    if (d.type === 'content_block_delta') {
      const dl = d.delta || {};
      if (dl.type === 'thinking_delta' && dl.thinking) onThink?.(dl.thinking);
      else if (dl.type === 'text_delta' && dl.text) { full += dl.text; onDelta(dl.text); }
    } else if (d.type === 'message_delta' && d.delta?.stop_reason === 'max_tokens') info.truncated = true;
  }
  return full;
}

// ---------- Ein Modell aufrufen (stream=true: Stücke an onDelta) ----------
async function callModel(m, messages, { stream, onDelta, onThink, signal, maxTokens, effort, info = {} }) {
  if (m.provider === 'google') {
    const key = m.apiKey || process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
    if (!key) throw new Error('GOOGLE_API_KEY fehlt');
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${m.id}:${stream ? 'streamGenerateContent?alt=sse' : 'generateContent'}`;
    const level = m.own ? m.level : null; // Denkstufe nur bei eigenen Modellen; kennt das Modell sie nicht, noch einmal ohne
    const send = (lvl) => fetch(url, { method: 'POST', signal, headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify(toGemini(m.id, messages, maxTokens, lvl)) });
    let r = await send(level);
    if (!r.ok && level && r.status === 400) r = await send(null);
    if (!r.ok) await failFrom(r);
    const textOf = (d) => (d.candidates?.[0]?.content?.parts || []).filter(p => p.text && !p.thought).map(p => p.text).join('');
    const thinkOf = (d) => (d.candidates?.[0]?.content?.parts || []).filter(p => p.text && p.thought).map(p => p.text).join('');
    if (!stream) {
      const d = await r.json();
      if (d.candidates?.[0]?.finishReason === 'MAX_TOKENS') info.truncated = true;
      const th = thinkOf(d); if (th) onThink?.(th);
      return textOf(d);
    }
    let full = '';
    for await (const raw of sseData(r)) { let d; try { d = JSON.parse(raw); } catch (e) { continue; } if (d.candidates?.[0]?.finishReason === 'MAX_TOKENS') info.truncated = true; const th = thinkOf(d); if (th) onThink?.(th); const t = textOf(d); if (t) { full += t; onDelta(t); } }
    return full;
  }
  if (m.provider === 'anthropic') return callAnthropic(m, messages, { stream, onDelta, onThink, signal, maxTokens, effort, info });
  const cfg = OPENAI_COMPAT[m.provider];
  const key = m.apiKey || (cfg.env && process.env[cfg.env]);
  if (!key) throw new Error(`${cfg.env} fehlt`);
  const level = m.own ? m.level : null;
  const send = (lvl, withTemp = true) => fetch(cfg.url, {
    method: 'POST', signal,
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...(m.provider === 'openai' ? {} : { 'HTTP-Referer': 'https://coden-ai.vercel.app', 'X-Title': 'Coden AI' }) },
    body: JSON.stringify({
      model: m.id, messages: toOpenAI(messages),
      // OpenAI: Denkmodelle verlangen max_completion_tokens und kennen keine temperature
      ...(m.provider === 'openai' ? { max_completion_tokens: maxTokens || DEFAULT_MAX } : { max_tokens: maxTokens || DEFAULT_MAX, ...(withTemp ? { temperature: 0.7 } : {}) }),
      ...(m.own ? (lvl ? (m.provider === 'openai' ? { reasoning_effort: lvl } : { reasoning: { effort: lvl } }) : {}) : effortParams(m, effort)),
      ...(stream ? { stream: true } : {})
    })
  });
  let r = await send(level, true);
  if (!r.ok && (r.status === 400 || r.status === 422)) {
    if (level) r = await send(null, true); // Modell kennt keine Denkstufe oder lehnt reasoning-Parameter ab
    if (!r.ok && (r.status === 400 || r.status === 422) && m.provider !== 'openai') r = await send(null, false); // manche Modelle lehnen temperature ab
  }
  if (!r.ok) await failFrom(r);
  const ct = String(r.headers?.get?.('content-type') || '').toLowerCase();
  if (!stream || ct.includes('application/json')) {
    const d = await r.json();
    if (d.error) throw apiError(d.error.message || 'Anbieter-Fehler', { status: Number(d.error.code) || undefined, errorType: d.error.metadata?.error_type || d.error.type || null });
    const fr = d.choices?.[0]?.finish_reason;
    if (fr === 'length' || fr === 'max_tokens') info.truncated = true;
    const th = extractReasoning(d.choices?.[0]?.message);
    if (th) onThink?.(th);
    const content = d.choices?.[0]?.message?.content || '';
    if (stream && content) { onDelta(content); }
    return content;
  }
  let full = '';
  for await (const raw of sseData(r)) {
    if (raw === '[DONE]') break;
    let d; try { d = JSON.parse(raw); } catch (e) { continue; }
    if (d.error) throw apiError(d.error.message || 'Stream-Fehler', { status: Number(d.error.code) || undefined, errorType: d.error.metadata?.error_type || d.error.type || null });
    const fr = d.choices?.[0]?.finish_reason;
    if (fr === 'length' || fr === 'max_tokens') info.truncated = true;
    if (fr === 'error') throw apiError('Stream-Fehler vom Anbieter', { status: 502 });
    const dl = d.choices?.[0]?.delta || {};
    const th = extractReasoning(dl); // Denk-Teile: nur als Überschrift an den Nutzer, nie als Antworttext
    if (th) onThink?.(th);
    const t = dl.content;
    if (t) { full += t; onDelta(t); }
  }
  return full;
}

// ---------- Modellliste (für den Befehl /modelle) ----------
const PROVIDER_NAMES = { groq: 'Groq', openrouter: 'OpenRouter', google: 'Google', openai: 'OpenAI', anthropic: 'Anthropic', numes: 'Numes', kilo: 'Kilo', aihubmix: 'AIHubMix' };
const keyOf = (m) => `${m.provider}:${m.id}`;
function listModels() {
  const seen = new Map();
  for (const tier of ['ultra', 'pro', 'normal', 'flash']) for (const m of CASCADES[tier]) if (!seen.has(keyOf(m))) seen.set(keyOf(m), { key: keyOf(m), provider: m.provider, providerName: PROVIDER_NAMES[m.provider] || m.provider, id: m.id,
    ready: m.provider === 'google' ? !!(process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY) : !!process.env[OPENAI_COMPAT[m.provider]?.env], limited: !!QUOTAS[m.id] });
  return [...seen.values()];
}
const findModel = (key) => listModels().find(m => m.key === key) || null;

const sleepAbort = (ms, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) return reject(new Error('abgebrochen'));
  const t = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
  const onAbort = () => { clearTimeout(t); reject(new Error('abgebrochen')); };
  signal?.addEventListener('abort', onAbort, { once: true });
});

function isTransientError(e, m) {
  if (!e || e.limit || e.partial) return false;
  if ([408, 429, 502, 503, 504].includes(e.status)) return true;
  if (e.status === 500 && (m.provider === 'numes' || m.provider === 'kilo' || e.errorType === 'server')) return true;
  if (['rate_limited', 'provider_overloaded', 'provider_unavailable', 'service_unavailable', 'routing_unavailable', 'timeout', 'rate_limit_exceeded'].includes(e.errorType)) return true;
  if (/provider capacity is exhausted|capacity.*exhausted|overloaded|provider.?unavailable|service.?unavailable|rate.?limit|bad gateway|gateway timeout|timed? ?out|econnreset|socket hang up|fetch failed/i.test(e.message || '')) return true;
  if (e.message === 'Leere Antwort' && (m.own || m.provider === 'numes' || m.provider === 'kilo')) return true;
  return false;
}

function retryWaitMs(e, attempt) {
  if (e?.retryAfter && e.retryAfter > 0) return Math.min(4000, Math.max(400, Math.round(e.retryAfter * 1000)));
  const base = attempt === 0 ? 650 : 1500;
  return base + Math.floor(Math.random() * 250);
}

// ---------- Kaskade ----------
// Probiert die Modelle der Stufe der Reihe nach. Fällt eines aus (oder liefert nichts), kommt das nächste.
// Beim Streamen ist Wechsel nur möglich, solange noch nichts an den Nutzer geschickt wurde.
// meter (optional): zählt den Verbrauch für die Nutzungslimits mit; meter.stop = true hält eine zu lange Aufgabe an
const charsOf = (msgs) => msgs.reduce((n, m) => n + String(m.content || '').length + (m.images?.length || 0) * 3000, 0);
async function run(tier, messages, { isOwner = false, stream = false, onDelta = () => {}, onModel = () => {}, onThink, signal: outer, maxTokens, effort, pin, meter, uid } = {}) {
  // Eigenes Modell oder eigene Kette (Bring your own Key): Modelle und Keys erst hier aus der Datenbank holen,
  // nie im Lauf-Zustand speichern. Über den eigenen Key laufende Aufrufe zählen nicht gegen die Coden-Limits.
  let own = null, chain = null, entries = null;
  const entryOf = (o) => ({ provider: o.provider, id: o.id, apiKey: o.apiKey, own: true, label: o.label, level: byok.levelFor(o, effort) });
  if (byok.isByok(tier)) {
    if (!uid) throw Object.assign(new Error('Nicht eingeloggt.'), { status: 401 });
    own = await byok.resolve(uid, tier); meter = null; pin = undefined; entries = [entryOf(own)];
  } else if (byok.isChain(tier)) {
    if (!uid) throw Object.assign(new Error('Nicht eingeloggt.'), { status: 401 });
    chain = await byok.resolveChain(uid, tier, { isOwner }); pin = undefined;
    entries = chain.members.flatMap(m => (m.kind === 'own' ? [entryOf(m)] : CASCADES[m.tier]));
    if (chain.ownOnly) meter = null;
  }
  const stopper = new AbortController(); // bricht den Anbieter-Aufruf ab, wenn das Nutzungslimit überschritten wird
  const signal = outer ? AbortSignal.any([outer, stopper.signal]) : stopper.signal;
  const limitHit = () => { stopper.abort(); const e = new Error(meter.message()); e.limit = true; e.status = 429; return e; };
  if (meter?.stop) throw limitHit();
  let cascade = entries || CASCADES[tier];
  if (pin) { // ein bestimmtes Modell erzwingen (nur Owner, kein Ausweichen auf andere)
    const m = findModel(pin);
    if (!m) throw Object.assign(new Error('Unbekanntes Modell.'), { status: 400 });
    cascade = [m];
  }
  if (!cascade) throw Object.assign(new Error('Unbekannter Modus.'), { status: 400 });
  let last, tried = 0;
  for (const m of cascade) {
    if (signal?.aborted) throw new Error('abgebrochen');
    if (QUOTAS[m.id] && !(await reserveQuota(m.id, isOwner))) { last = new Error(`${m.id}: Tageslimit erreicht`); continue; }
    const maxAttempts = (cascade.length === 1 && (m.own || m.provider === 'numes' || m.provider === 'kilo')) || m.provider === 'numes' || m.provider === 'kilo' ? 3 : (m.own ? 2 : 1);
    let modelDone = false;
    for (let attempt = 0; attempt < maxAttempts && !modelDone; attempt++) {
      if (signal?.aborted) throw new Error('abgebrochen');
      let slow = null;
      const tryModel = attempt > 0 && (m.provider === 'numes' || m.provider === 'kilo') ? { ...m, level: null } : m;
      try {
        const mt = m.own ? null : meter; // eigene Modelle zählen nicht gegen die Coden-Limits (auch nicht in gemischten Ketten)
        let sent = false, thinkBuf = '';
        const tracker = onThink && stream ? new ThinkTracker(onThink) : null;
        // Fortschritt auch dann zeigen, wenn das Modell sein Denken nicht preisgibt: echter Stand statt stummer Wartepunkte
        if (tracker) {
          onThink({ h: attempt > 0 ? `Neuer Versuch (${attempt + 1}/${maxAttempts}) …` : (tried === 0 ? 'Anfrage läuft …' : 'Anderes Modell wird versucht …'), v: attempt > 0 ? 'Der Anbieter war kurz überlastet – Anfrage wird wiederholt.' : (tried ? 'Das vorherige Modell war überlastet oder nicht erreichbar.' : '') });
          slow = setTimeout(() => { if (!sent && !tracker.text) onThink({ h: 'Modell antwortet langsam …', v: 'Große Modelle brauchen manchmal etwas länger, bevor die ersten Worte kommen.' }); }, 6000);
        }
        if (attempt === 0) tried++;
        const thinkIn = (t) => {
          const s = String(t || '');
          if (!s) return;
          mt?.add(s.length);
          thinkBuf = (thinkBuf + s).slice(-4000);
          if (tracker) tracker.push(s);
        };
        const filter = new ThinkFilter(thinkIn);
        const emit = (t) => {
          mt?.add(t.length);
          const v = filter.push(t); if (v) { if (!sent) { sent = true; clearTimeout(slow); onModel(m); } onDelta(v); }
          if (mt?.stop) { const e = limitHit(); if (sent) e.partial = true; throw e; }
        };
        const info = {};
        const call = async (msgs, { mdl = tryModel, eff = effort } = {}) => {
          let got = false;
          try { const r = await callModel(mdl, msgs, { stream, onDelta: (t) => { got = true; emit(t); }, onThink: (t) => { got = true; thinkIn(t); }, signal, maxTokens, effort: eff, info }); got = true; if (!stream) mt?.add(r.length); return r; }
          catch (e) { if (e.limit) throw e; if (signal.aborted && mt?.stop) { const le = limitHit(); if (sent) le.partial = true; throw le; } if (sent) e.partial = true; throw e; }
          finally { if (got) mt?.add(charsOf(msgs), { input: true }); } // Eingabe nur zählen, wenn das Modell wirklich gearbeitet hat
        };
        const stripThink = (s) => String(s || '').replace(/<think>[\s\S]*?<\/think>\s*/gi, '').replace(/<think>[\s\S]*$/i, '');
        let full = await call(messages);
        if (!stream) {
          const inlineThink = full.match(/<think>([\s\S]*?)(?:<\/think>|$)/i);
          if (inlineThink?.[1]) thinkBuf = (thinkBuf + inlineThink[1]).slice(-4000);
        }
        const restFirst = stream ? filter.flush() : '';
        if (restFirst) { if (!sent) { sent = true; onModel(m); } onDelta(restFirst); }
        // Hat das Modell sein Token-Limit (oder seinen Denk-Lauf) nur im Denken verbraucht:
        // einmal mit niedrigem Denkaufwand direkt die fertige Antwort schreiben lassen statt „Leere Antwort“.
        if (!stripThink(full).trim() && !sent && (info.truncated || thinkBuf.trim().length >= 80)) {
          if (tracker) onThink({ h: 'Antwort wird formuliert …', v: 'Ausführliches Denken abgeschlossen – die Antwort wird jetzt ausgegeben.' });
          filter.reset();
          info.truncated = false;
          const tail = thinkBuf.trim().slice(-2500);
          const wrapMsg = tail
            ? `Deine bisherigen Überlegungen wurden beendet, bevor die Antwort ausgegeben wurde. Zusammenfassung deiner bisherigen Gedanken:\n\n${tail}\n\nGib jetzt sofort ohne weiteres langes Nachdenken die vollständige, fertige Antwort für den Nutzer aus.`
            : 'Du hast dein Denkbudget ausgeschöpft, bevor die Antwort ausgegeben wurde. Gib jetzt sofort die vollständige, fertige Antwort für den Nutzer aus.';
          full = await call([...messages, { role: 'user', content: wrapMsg }], { mdl: { ...tryModel, level: null }, eff: 'low' });
          const restWrap = stream ? filter.flush() : '';
          if (restWrap) { if (!sent) { sent = true; onModel(m); } onDelta(restWrap); }
        }
        // Antwort wurde vom Token-Limit abgeschnitten (z. B. langer Code): nahtlos weiterschreiben lassen
        for (let n = 0; info.truncated && n < 3 && stripThink(full).trim(); n++) {
          info.truncated = false;
          full += await call([...messages, { role: 'assistant', content: stripThink(full) }, { role: 'user', content: CONTINUE }]);
        }
        if (stream) {
          const rest = filter.flush(); if (rest) { if (!sent) { sent = true; onModel(m); } onDelta(rest); }
          if (!sent) throw new Error('Leere Antwort');
          clearTimeout(slow);
          modelDone = true;
          return { model: m };
        }
        const clean = stripThink(full).trim();
        if (!clean) throw new Error('Leere Antwort (Modell hat nur nachgedacht).');
        modelDone = true;
        return { text: clean, model: m };
      } catch (e) {
        clearTimeout(slow);
        if (e.partial || e.limit) throw e; // schon Text beim Nutzer (oder Limit erreicht): nicht mehr wechseln
        if (outer?.aborted) throw e;
        console.warn(`[ai] ${m.provider}/${m.id} fehlgeschlagen (Versuch ${attempt + 1}/${maxAttempts}):`, e.message);
        last = e;
        if (attempt + 1 < maxAttempts && isTransientError(e, m)) {
          if (onThink && stream) onThink({ h: 'Anbieter überlastet – neuer Versuch …', v: `${m.label || m.id} (${PROVIDER_NAMES[m.provider] || m.provider}): ${e.message}` });
          await sleepAbort(retryWaitMs(e, attempt), signal);
          continue;
        }
        break;
      }
    }
  }
  if (pin || own) { // gezielt gewähltes Modell: genaue Ursache nennen statt „überlastet“
    const m = cascade[0];
    const prov = PROVIDER_NAMES[m.provider] || m.provider;
    const msg = String(last?.message || '');
    let hint = '';
    if (/401|403|unauthor|invalid.*key|api key|permission/i.test(msg) || last?.status === 401 || last?.status === 403) {
      hint = ` – der API-Key von ${prov} wird abgelehnt (${own ? 'Einstellungen → Eigene Modelle' : 'in Vercel prüfen, danach neu deployen'})`;
    } else if (last?.status === 402 || /insufficient_credits|credit|balance|funding/i.test(msg)) {
      hint = ` – Guthaben oder Ausgabenlimit bei ${prov} reicht nicht aus`;
    } else if (own && ([429, 502, 503, 504].includes(last?.status) || /capacity|exhausted|overload|unavailable|bad gateway|http 50[234]|http 429/i.test(msg))) {
      const isFreeTier = /:free$|(?:\/|-)free$/i.test(m.id) || m.id === 'stealth/glyph-cluster';
      hint = (m.provider === 'numes' || m.provider === 'kilo') && isFreeTier
        ? ` – die kostenlosen Server bei ${prov} sind gerade ausgelastet. Wechsle kurz auf ein Coden-Modell oder richte eine Ausweich-Kette ein.`
        : ` – ${prov} ist gerade überlastet oder nicht erreichbar.`;
    }
    throw Object.assign(
      new Error(`${own ? own.label : m.id} (${prov}): ${msg}${hint}`),
      { ...(last?.status ? { status: last.status } : {}), ...(last?.errorType ? { errorType: last.errorType } : {}) }
    );
  }
  if (chain) throw new Error(`Alle Modelle der Kette „${chain.name}“ sind ausgefallen. Letzter Fehler: ${last?.message}`);
  throw new Error(`Alle Server sind überlastet. Letzter Fehler: ${last?.message}`);
}

// ---------- Modell-Test (/model-test): ein einzelnes Modell ohne Fallback messen ----------
const TEST_PROMPT = 'Baue ein kleines Snake-Spiel als eine einzige HTML-Datei (HTML, CSS und JavaScript zusammen). Es soll Punkte zählen, per Pfeiltasten steuerbar sein, ein Game Over zeigen und einen Neustart-Button haben. Antworte nur mit dem Code.';
async function probe(key, messages, { signal, onProgress = () => {}, maxTokens = 6000 } = {}) {
  const m = findModel(key);
  if (!m) return { ok: false, error: 'Unbekanntes Modell' };
  const out = { key, id: m.id, provider: m.provider, providerName: m.providerName, ok: false, ms: 0, ttft: null, chars: 0, thinkChars: 0, text: '' };
  if (!m.ready) return { ...out, error: 'kein API-Key' };
  if (QUOTAS[m.id] && !(await reserveQuota(m.id, true))) return { ...out, error: 'Tageslimit erreicht' };
  const t0 = Date.now(); let lastP = 0;
  const tick = (force) => { out.ms = Date.now() - t0; const n = Date.now(); if (force || n - lastP > 400) { lastP = n; onProgress({ chars: out.chars, thinkChars: out.thinkChars, ms: out.ms, ttft: out.ttft }); } };
  const filter = new ThinkFilter((t) => { out.thinkChars += t.length; tick(); });
  const see = (v) => { if (!v) return; if (out.ttft === null) out.ttft = Date.now() - t0; out.chars += v.length; out.text += v; tick(); };
  try {
    await callModel(m, messages, { stream: true, onDelta: (t) => see(filter.push(t)), onThink: (t) => { out.thinkChars += t.length; tick(); }, signal, maxTokens });
    see(filter.flush());
    out.ms = Date.now() - t0;
    if (!out.chars) return { ...out, error: 'Leere Antwort' };
    return { ...out, ok: true };
  } catch (e) { out.ms = Date.now() - t0; return { ...out, error: signal?.aborted ? 'abgebrochen/Zeitlimit' : e.message }; }
}

const generate = async (tier, messages, opts = {}) => (await run(tier, messages, opts)).text;
const generateStream = (tier, messages, opts) => run(tier, messages, { ...opts, stream: true });

module.exports = { CONTINUE, probe, TEST_PROMPT, listModels, generate, generateStream, CASCADES, QUOTAS, ThinkFilter, ThinkTracker, EFFORTS };
