// KI-Anbieter. Alle Keys kommen ausschließlich aus Umgebungsvariablen.
const CASCADES = {
  flash: [
    { provider: 'google', id: 'gemma-3-4b-it' },
    { provider: 'google', id: 'gemma-3-1b-it' },
    { provider: 'groq', id: 'llama-3.1-8b-instant' },
    { provider: 'openrouter', id: 'nvidia/nemotron-3-super-120b-a12b:free' }
  ],
  normal: [
    { provider: 'google', id: 'gemma-3-12b-it' },
    { provider: 'groq', id: 'qwen/qwen3-32b' },
    { provider: 'openrouter', id: 'arcee-ai/trinity-large-preview:free' }
  ],
  pro: [
    { provider: 'google', id: 'gemma-3-27b-it' },
    { provider: 'groq', id: 'openai/gpt-oss-120b' },
    { provider: 'openrouter', id: 'nvidia/nemotron-3-super-120b-a12b:free' }
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
  return data.choices[0].message.content;
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
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
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
