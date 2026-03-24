// js/api.js
import { Storage } from './storage.js';

const MODEL_CASCADES = {
    'flash': [ { provider: 'google', id: 'gemma-3-4b-it' }, { provider: 'groq', id: 'llama-3.1-8b-instant' }, { provider: 'openrouter', id: 'meta-llama/llama-3.1-8b-instruct:free'} ],
    'normal': [ { provider: 'google', id: 'gemma-3-12b-it' }, { provider: 'github', id: 'gpt-4o' }, { provider: 'groq', id: 'qwen/qwen3-32b' }, { provider: 'openrouter', id: 'arcee-ai/trinity-large-preview:free' } ],
    'pro': [ { provider: 'google', id: 'gemma-3-27b-it' }, { provider: 'github', id: 'gpt-4.1' }, { provider: 'groq', id: 'openai/gpt-oss-120b' }, { provider: 'openrouter', id: 'nvidia/nemotron-3-super-120b-a12b:free'} ]
};

export async function generateAiResponse(messages, tierOrModelId) {
    const settings = Storage.getSettings();
    const googleKey = settings.apiKey;

    let cascade = MODEL_CASCADES[tierOrModelId] || [ { provider: 'google', id: tierOrModelId }, { provider: 'vercel', id: tierOrModelId } ];
    let lastError = null;

    for (const modelConfig of cascade) {
        try {
            let responseText = "";
            if (modelConfig.provider === 'google' && googleKey) responseText = await callGoogleDirectly(messages, modelConfig.id, googleKey);
            else if (modelConfig.provider !== 'google' || !googleKey) responseText = await callVercelBackend(messages, modelConfig.id, modelConfig.provider);

            if (responseText) responseText = responseText.replace(/<think>[\s\S]*?<\/think>\n*/gi, '').trim();
            return responseText;
        } catch (error) { lastError = error; }
    }
    throw new Error(`Alle Server sind überlastet. Letzter Fehler: ${lastError?.message}`);
}

async function callVercelBackend(messages, modelId, providerTarget) {
    const response = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages, modelId, provider: providerTarget }) });
    const textResponse = await response.text();
    let data;
    try { data = JSON.parse(textResponse); } catch (e) { if (textResponse.includes("Too many") || response.status === 429) throw new Error("Rate Limit."); throw new Error("Backend Fehler."); }
    if (!response.ok || data.error) throw new Error(data.error || `HTTP ${response.status}`);
    return data.content;
}

async function callGoogleDirectly(messages, modelId, apiKey) {
    const contents = [];
    let systemInstruction = null;

    messages.forEach(msg => {
        if (msg.role === 'system') systemInstruction = { parts: [{ text: msg.content }] };
        else {
            let parts = [{ text: msg.content }];
            // 👁️ VISION FIX FÜR GOOGLE: Bilder einfügen
            if (msg.images && msg.images.length > 0) {
                msg.images.forEach(imgBase64 => {
                    // Base64 Code zerschneiden, da Google den MimeType ("image/jpeg") und die reinen Daten getrennt braucht
                    const mimeType = imgBase64.substring(imgBase64.indexOf(":") + 1, imgBase64.indexOf(";"));
                    const data = imgBase64.substring(imgBase64.indexOf(",") + 1);
                    parts.push({ inlineData: { mimeType: mimeType, data: data } });
                });
            }
            contents.push({ role: msg.role === 'assistant' ? 'model' : 'user', parts: parts });
        }
    });

    const body = { contents };
    if (modelId.includes('gemma') && systemInstruction) {
        if (contents.length > 0) contents[0].parts[0].text = systemInstruction.parts[0].text + "\n\n---\n\n" + contents[0].parts[0].text;
        else contents.push({ role: 'user', parts: [{ text: systemInstruction.parts[0].text }]});
    } else if (systemInstruction) { body.systemInstruction = systemInstruction; }

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${apiKey}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await response.json();
    if (!response.ok) throw new Error(`${data.error?.message || response.statusText}`);
    if (data.candidates && data.candidates.length > 0) return data.candidates[0].content.parts[0].text;
    throw new Error("Leere Antwort.");
}
