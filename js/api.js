// js/api.js
import { Storage } from './storage.js';

// 🧠 DIE GLOBALE MODELL-KASKADE (Deine absolute Meister-Liste!)
const MODEL_CASCADES = {
    'flash': [
        { provider: 'google',     id: 'gemini-2.5-flash' },                     // 1. Google (Extrem schnell, 1500/Tag)
        { provider: 'groq',       id: 'llama-3.1-8b-instant' },                 // 2. Groq (Llama Speed)
        { provider: 'groq',       id: 'groq/compound-mini' },                   // 3. Groq Fallback
        { provider: 'openrouter', id: 'meta-llama/llama-3.3-70b-instruct:free'} // 4. OpenRouter Notnagel
    ],
    'normal': [
        { provider: 'google',     id: 'gemma-3-27b-it' },                       // 1. Google (Starke Logik, Free-Tier)
        { provider: 'groq',       id: 'qwen/qwen3-32b' },                       // 2. Groq (Bestes Mid-Size Coding)
        { provider: 'github',     id: 'gpt-4o' },                               // 3. GitHub (Zuverlässig)
        { provider: 'groq',       id: 'meta-llama/llama-4-scout-17b-16e-instruct'}, // 4. Groq Fallback
        { provider: 'openrouter', id: 'arcee-ai/trinity-large-preview:free' }   // 5. OpenRouter Notnagel
    ],
    'pro': [
        { provider: 'github',     id: 'gpt-4.1' },                              // 1. GitHub (Das absolute Code-Genie)
        { provider: 'groq',       id: 'openai/gpt-oss-120b' },                  // 2. Groq (Gigantisches Fallback)
        { provider: 'google',     id: 'gemini-1.5-pro' },                       // 3. Google (50 Free Anfragen/Tag)
        { provider: 'groq',       id: 'llama-3.3-70b-versatile' },              // 4. Groq (Schweres Llama)
        { provider: 'openrouter', id: 'nvidia/nemotron-3-super-120b-a12b:free'} // 5. OpenRouter Notnagel
    ]
};

export async function generateAiResponse(messages, tierOrModelId) {
    const settings = Storage.getSettings();
    const googleKey = settings.apiKey; // Holt deinen /api Key aus dem Browser

    // Holt die Kaskade (flash, normal, pro) oder baut ein Dummy für direkte Aufrufe
    let cascade = MODEL_CASCADES[tierOrModelId];
    if (!cascade) {
        cascade = [
            { provider: 'google', id: tierOrModelId }, 
            { provider: 'vercel', id: tierOrModelId }
        ];
    }

    let lastError = null;

    // 🚀 DIE SCHLEIFE DER UNZERSTÖRBARKEIT
    for (const modelConfig of cascade) {
        try {
            // 1. GOOGLE DIREKT-BYPASS (Wenn Key vorhanden)
            if (modelConfig.provider === 'google' && googleKey) {
                console.log(`⚡ Kaskade: Versuche Google AI API mit [${modelConfig.id}]...`);
                return await callGoogleDirectly(messages, modelConfig.id, googleKey);
            } 
            // 2. BACKEND ROUTING FÜR ALLE ANDEREN (GitHub, Groq, OpenRouter)
            else if (modelConfig.provider !== 'google' || !googleKey) {
                console.log(`⚡ Kaskade: Versuche Backend (${modelConfig.provider}) mit [${modelConfig.id}]...`);
                return await callVercelBackend(messages, modelConfig.id, modelConfig.provider);
            }
        } catch (error) {
            console.warn(`[FALLBACK] Modell ${modelConfig.id} über ${modelConfig.provider} fehlgeschlagen:`, error.message);
            lastError = error;
            // Schleife bricht NICHT ab! Sie probiert sofort das nächste Modell im Array.
        }
    }

    // Wenn ALLE Modelle im Array abgeraucht sind (z.B. komplettes Internet offline)
    throw new Error(`Alle Fallback-Server sind überlastet. Letzter Fehler: ${lastError?.message}`);
}

// --- VERCEL BACKEND ROUTE (Gibt den Provider mit, damit dein Backend weiß, wohin!) ---
async function callVercelBackend(messages, modelId, providerTarget) {
    const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
            messages: messages, 
            modelId: modelId,
            provider: providerTarget // NEU: Wir sagen dem Server, ob es groq, github oder openrouter ist
        })
    });
    
    const textResponse = await response.text();
    let data;
    try { 
        data = JSON.parse(textResponse); 
    } catch (e) {
        if (textResponse.includes("Too many") || response.status === 429) throw new Error("Rate Limit erreicht.");
        throw new Error("Backend Server Fehler.");
    }
    
    if (!response.ok || data.error) throw new Error(data.error || `HTTP ${response.status}`);
    return data.content;
}

// --- GOOGLE AI STUDIO DIRECT ROUTE (Ultraschnell) ---
async function callGoogleDirectly(messages, modelId, apiKey) {
    const contents = [];
    let systemInstruction = null;

    messages.forEach(msg => {
        if (msg.role === 'system') systemInstruction = { parts: [{ text: msg.content }] };
        else contents.push({ role: msg.role === 'assistant' ? 'model' : 'user', parts: [{ text: msg.content }] });
    });

    const body = { contents };

    // Spezieller Fix für Gemma-Modelle, die System-Prompts im User-Array brauchen
    if (modelId.includes('gemma') && systemInstruction) {
        if (contents.length > 0) contents[0].parts[0].text = systemInstruction.parts[0].text + "\n\n---\n\n" + contents[0].parts[0].text;
        else contents.push({ role: 'user', parts: [{ text: systemInstruction.parts[0].text }]});
    } else if (systemInstruction) {
        body.systemInstruction = systemInstruction;
    }

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${apiKey}`, {
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify(body)
    });
    
    const data = await response.json();

    if (!response.ok) throw new Error(`${data.error?.message || response.statusText}`);
    if (data.candidates && data.candidates.length > 0) return data.candidates[0].content.parts[0].text;
    throw new Error("Leere Antwort von Google.");
}
