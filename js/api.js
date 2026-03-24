// js/api.js
import { Storage } from './storage.js';

export async function generateAiResponse(messages, modelId) {
    const settings = Storage.getSettings();
    const googleKey = settings.apiKey; // Holt deinen geheimen Key

    // 🚀 GOOGLE DIRECT BYPASS: Wenn Key da ist und es ein Google Modell ist!
    if (googleKey && (modelId.startsWith('gemini') || modelId.startsWith('gemma'))) {
        return await callGoogleDirectly(messages, modelId, googleKey);
    }

    // 🐢 ALTER FALLBACK (Falls kein Key da ist, geht es über Vercel)
    try {
        const response = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ messages, modelId })
        });
        const textResponse = await response.text();
        let data;
        try {
            data = JSON.parse(textResponse);
        } catch (e) {
            if (textResponse.includes("Too many") || response.status === 429) throw new Error("⏳ API Limit (Vercel) erreicht.");
            throw new Error("Server Fehler: " + textResponse.substring(0, 40));
        }
        if (!response.ok || data.error) throw new Error(data.error || `HTTP ${response.status}`);
        return data.content;
    } catch (error) {
        throw error; 
    }
}

// 🧠 DIE DIREKTE GOOGLE KI-VERBINDUNG
async function callGoogleDirectly(messages, modelId, apiKey) {
    const contents = [];
    let systemInstruction = null;

    // Nachrichten in Google-Format übersetzen
    messages.forEach(msg => {
        if (msg.role === 'system') {
            systemInstruction = { parts: [{ text: msg.content }] };
        } else {
            contents.push({
                role: msg.role === 'assistant' ? 'model' : 'user',
                parts: [{ text: msg.content }]
            });
        }
    });

    const body = { contents };

    // Gemma 3 Modelle brauchen den System-Prompt manchmal direkt in der ersten Nachricht
    if (modelId.includes('gemma') && systemInstruction) {
        if (contents.length > 0) {
            contents[0].parts[0].text = systemInstruction.parts[0].text + "\n\n---\n\n" + contents[0].parts[0].text;
        } else {
            contents.push({ role: 'user', parts: [{ text: systemInstruction.parts[0].text }]});
        }
    } else if (systemInstruction) {
        body.systemInstruction = systemInstruction;
    }

    // Direkt an Google senden!
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });

    const data = await response.json();

    if (!response.ok) {
        throw new Error(`Google API Fehler: ${data.error?.message || response.statusText}`);
    }

    if (data.candidates && data.candidates.length > 0) {
        return data.candidates[0].content.parts[0].text;
    } else {
        throw new Error("Leere Antwort von Google.");
    }
}
