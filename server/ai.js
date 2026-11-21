// KI-Anbieter. Alle Keys kommen ausschließlich aus Umgebungsvariablen.
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
const openrouter = (ids) => ids.map(id => ({ provider: 'openrouter', id }));

// Die drei Stufen der App: erst Google und Groq, dahinter alle OpenRouter-Gratismodelle als Ersatz.
// (Modell-IDs laut Google-AI-Studio- und Groq-Doku, Stand 21.11.2026)
const CASCADES = {
  // Schnell: kleine Modelle zuerst
  flash: [
    { provider: 'google', id: 'gemini-3.5-flash-lite' },
    { provider: 'groq', id: 'openai/gpt-oss-20b' },
    ...openrouter([...OPENROUTER_FREE].reverse())
  ],
  normal: [
    { provider: 'google', id: 'gemini-3.8-flash' },
    { provider: 'groq', id: 'qwen/qwen3.8-27b' },
    { provider: 'groq', id: 'openai/gpt-oss-20b' },
    { provider: 'groq', id: 'llama-3.3-70b-versatile' }, // bei Groq "Enterprise": kann ohne Vertrag fehlschlagen, dann springt die Kaskade weiter
    ...openrouter(OPENROUTER_FREE)
  ],
  // Pro: stärkste zuerst
  pro: [
    { provider: 'google', id: 'gemini-4-hydrogen' },
    { provider: 'groq', id: 'openai/gpt-oss-120b' },
    { provider: 'groq', id: 'llama-3.3-70b-versatile' },
    ...openrouter(OPENROUTER_FREE)
  ]
};

const OPENAI_COMPAT = {
  openrouter: { url: 'https://openrouter.ai/api/v1/chat/completions', env: 'OPENROUTER_API_KEY' },
  groq: { url: 'https://api.groq.com/openai/v1/chat/completions', env: 'GROQ_API_KEY' }
};

async function callOpenAICompat(provider, modelId, messages) {
  const cfg = OPENAI_COMPAT[provider];
  const key = process.env[cfg.env];
  if (!key) throw new Error(`${cfg.env} fehlt`);
  const formatted = messages.map(m => {
    if (m.images?.length) {
      return {
        role: m.role,
        content: [{ type: 'text', text: m.content || 'Beschreibe dieses Bild.' },
          ...m.images.map(url => ({ type: 'image_url', image_url: { url } }))]
      };
    }
    return { role: m.role, content: m.content };
  });
  const payload = { model: modelId, messages: formatted };
  payload.max_tokens = 8192;
  payload.temperature = 0.7;

  const r = await fetch(cfg.url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://coden-ai.vercel.app', 'X-Title': 'Coden AI' },
    body: JSON.stringify(payload)
  });
  const data = await r.json();
  if (!r.ok || data.error) throw new Error(data.error?.message || data.message || `HTTP ${r.status}`);
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('Leere Antwort (Modell hat nur nachgedacht).');
  return content;
}

async function callGoogle(modelId, messages) {
  const key = process.env.GOOGLE_API_KEY;
  if (!key) throw new Error('GOOGLE_API_KEY fehlt');
  const contents = [];
  let system = null;
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
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify(body)
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error?.message || r.statusText);
  // Denk-Teile (thought) ausblenden, nur die eigentliche Antwort nehmen
  const text = (data.candidates?.[0]?.content?.parts || []).filter(p => p.text && !p.thought).map(p => p.text).join('');
  if (!text) throw new Error('Leere Antwort.');
  return text;
}

async function generate(tier, messages) {
  const cascade = CASCADES[tier];
  if (!cascade) throw Object.assign(new Error('Unbekannter Modus.'), { status: 400 });
  let last;
  for (const m of cascade) {
    try {
      const text = m.provider === 'google' ? await callGoogle(m.id, messages) : await callOpenAICompat(m.provider, m.id, messages);
      return text.replace(/<think>[\s\S]*?<\/think>\n*/gi, '').trim();
    } catch (e) {
      console.warn(`[ai] ${m.provider}/${m.id} fehlgeschlagen:`, e.message);
      last = e;
    }
  }
  throw new Error(`Alle Server sind überlastet. Letzter Fehler: ${last?.message}`);
}

module.exports = { generate };
