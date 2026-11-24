// KI-Anbieter. Alle Keys kommen ausschließlich aus Umgebungsvariablen.
const { getSql } = require('./db');
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
  if (!stream) { const d = await r.json(); if (d.stop_reason === 'max_tokens') info.truncated = true; return (d.content || []).filter(b => b.type === 'text').map(b => b.text).join(''); }
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
    if (!stream) { const d = await r.json(); if (d.candidates?.[0]?.finishReason === 'MAX_TOKENS') info.truncated = true; return textOf(d); }
    let full = '';
    for await (const raw of sseData(r)) { let d; try { d = JSON.parse(raw); } catch (e) { continue; } if (d.candidates?.[0]?.finishReason === 'MAX_TOKENS') info.truncated = true; const th = (d.candidates?.[0]?.content?.parts || []).filter(p => p.text && p.thought).map(p => p.text).join(''); if (th) onThink?.(th); const t = textOf(d); if (t) { full += t; onDelta(t); } }
    return full;
  }
  if (m.provider === 'anthropic') return callAnthropic(m, messages, { stream, onDelta, onThink, signal, maxTokens, effort, info });
  const cfg = OPENAI_COMPAT[m.provider];
  const key = m.apiKey || (cfg.env && process.env[cfg.env]);
  if (!key) throw new Error(`${cfg.env} fehlt`);
  const level = m.own ? m.level : null;
  const send = (lvl) => fetch(cfg.url, {
    method: 'POST', signal,
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...(m.provider === 'openai' ? {} : { 'HTTP-Referer': 'https://coden-ai.vercel.app', 'X-Title': 'Coden AI' }) },
    body: JSON.stringify({
      model: m.id, messages: toOpenAI(messages),
      // OpenAI: Denkmodelle verlangen max_completion_tokens und kennen keine temperature
      ...(m.provider === 'openai' ? { max_completion_tokens: maxTokens || DEFAULT_MAX } : { max_tokens: maxTokens || DEFAULT_MAX, temperature: 0.7 }),
      ...(m.own ? (lvl ? (m.provider === 'openai' ? { reasoning_effort: lvl } : { reasoning: { effort: lvl } }) : {}) : effortParams(m, effort)),
      ...(stream ? { stream: true } : {})
    })
  });
  let r = await send(level);
  if (!r.ok && level && r.status === 400) r = await send(null); // Modell kennt keine Denkstufe: ohne noch einmal
  if (!r.ok) await failFrom(r);
  if (!stream) { const d = await r.json(); if (d.error) throw new Error(d.error.message); if (d.choices?.[0]?.finish_reason === 'length') info.truncated = true; return d.choices?.[0]?.message?.content || ''; }
  let full = '';
  for await (const raw of sseData(r)) {
    if (raw === '[DONE]') break;
    let d; try { d = JSON.parse(raw); } catch (e) { continue; }
    if (d.error) throw new Error(d.error.message || 'Stream-Fehler');
    if (d.choices?.[0]?.finish_reason === 'length') info.truncated = true;
    const dl = d.choices?.[0]?.delta || {};
    const th = dl.reasoning_content || dl.reasoning; // Denk-Teile: nur als Überschrift an den Nutzer, nie als Antworttext
    if (th && typeof th === 'string') onThink?.(th);
    const t = dl.content;
    if (t) { full += t; onDelta(t); }
  }
  return full;
}

// ---------- Modellliste (für den Befehl /modelle) ----------
const PROVIDER_NAMES = { groq: 'Groq', openrouter: 'OpenRouter', google: 'Google', openai: 'OpenAI', anthropic: 'Anthropic' };
const keyOf = (m) => `${m.provider}:${m.id}`;
function listModels() {
  const seen = new Map();
  for (const tier of ['ultra', 'pro', 'normal', 'flash']) for (const m of CASCADES[tier]) if (!seen.has(keyOf(m))) seen.set(keyOf(m), { key: keyOf(m), provider: m.provider, providerName: PROVIDER_NAMES[m.provider] || m.provider, id: m.id,
    ready: m.provider === 'google' ? !!(process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY) : !!process.env[OPENAI_COMPAT[m.provider]?.env], limited: !!QUOTAS[m.id] });
  return [...seen.values()];
}
const findModel = (key) => listModels().find(m => m.key === key) || null;

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
    let slow = null;
    try {
      if (QUOTAS[m.id] && !(await reserveQuota(m.id, isOwner))) { last = new Error(`${m.id}: Tageslimit erreicht`); continue; }
      const mt = m.own ? null : meter; // eigene Modelle zählen nicht gegen die Coden-Limits (auch nicht in gemischten Ketten)
      let sent = false;
      const tracker = onThink && stream ? new ThinkTracker(onThink) : null;
      // Fortschritt auch dann zeigen, wenn das Modell sein Denken nicht preisgibt: echter Stand statt stummer Wartepunkte
      if (tracker) {
        onThink({ h: tried === 0 ? 'Anfrage läuft …' : 'Anderes Modell wird versucht …', v: tried ? 'Das vorherige Modell war überlastet oder nicht erreichbar.' : '' });
        slow = setTimeout(() => { if (!sent && !tracker.text) onThink({ h: 'Modell antwortet langsam …', v: 'Große Modelle brauchen manchmal etwas länger, bevor die ersten Worte kommen.' }); }, 6000);
      }
      tried++;
      const filter = new ThinkFilter(tracker ? (t) => tracker.push(t) : undefined);
      const emit = (t) => {
        mt?.add(t.length);
        const v = filter.push(t); if (v) { if (!sent) { sent = true; clearTimeout(slow); onModel(m); } onDelta(v); }
        if (mt?.stop) { const e = limitHit(); if (sent) e.partial = true; throw e; }
      };
      const thinkIn = (t) => { mt?.add(String(t).length); if (tracker) tracker.push(t); };
      const info = {};
      const call = async (msgs) => {
        let got = false;
        try { const r = await callModel(m, msgs, { stream, onDelta: (t) => { got = true; emit(t); }, onThink: (t) => { got = true; thinkIn(t); }, signal, maxTokens, effort, info }); got = true; if (!stream) mt?.add(r.length); return r; }
        catch (e) { if (e.limit) throw e; if (signal.aborted && mt?.stop) { const le = limitHit(); if (sent) le.partial = true; throw le; } if (sent) e.partial = true; throw e; }
        finally { if (got) mt?.add(charsOf(msgs), { input: true }); } // Eingabe nur zählen, wenn das Modell wirklich gearbeitet hat
      };
      let full = await call(messages);
      // Antwort wurde vom Token-Limit abgeschnitten (z. B. langer Code): nahtlos weiterschreiben lassen
      for (let n = 0; info.truncated && n < 3 && full.trim(); n++) {
        info.truncated = false;
        full += await call([...messages, { role: 'assistant', content: full.replace(/<think>[\s\S]*?<\/think>\s*/gi, '') }, { role: 'user', content: CONTINUE }]);
      }
      if (stream) {
        const rest = filter.flush(); if (rest) { if (!sent) { sent = true; onModel(m); } onDelta(rest); }
        if (!sent) throw new Error('Leere Antwort');
        clearTimeout(slow);
        return { model: m };
      }
      const clean = full.replace(/<think>[\s\S]*?<\/think>\n*/gi, '').trim();
      if (!clean) throw new Error('Leere Antwort (Modell hat nur nachgedacht).');
      return { text: clean, model: m };
    } catch (e) {
      clearTimeout(slow);
      if (e.partial || e.limit) throw e; // schon Text beim Nutzer (oder Limit erreicht): nicht mehr wechseln
      if (outer?.aborted) throw e;
      console.warn(`[ai] ${m.provider}/${m.id} fehlgeschlagen:`, e.message);
      last = e;
    }
  }
  if (pin || own) { // gezielt gewähltes Modell: genaue Ursache nennen statt „überlastet“
    const m = cascade[0]; const hint = /401|403|unauthor|invalid.*key|api key|permission/i.test(last?.message || '') ? ` – der API-Key von ${PROVIDER_NAMES[m.provider] || m.provider} wird abgelehnt (${own ? 'Einstellungen → Eigene Modelle' : 'in Vercel prüfen, danach neu deployen'})` : '';
    throw new Error(`${own ? own.label : m.id} (${PROVIDER_NAMES[m.provider] || m.provider}): ${last?.message}${hint}`);
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
