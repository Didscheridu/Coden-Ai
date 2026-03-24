// api/chat.js

module.exports = async function handler(req, res) {
    // Wir erlauben nur POST-Anfragen
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    // 🔥 DER FIX: Wir holen uns jetzt auch den 'provider' vom Frontend!
    const { messages, modelId, provider } = req.body;

    if (!messages || !modelId || !provider) {
        return res.status(400).json({ error: 'Fehlende Daten: messages, modelId oder provider' });
    }

    let apiUrl = '';
    let apiKey = '';
    let isGitHubModel = false;

    // 1. Router-Logik: Wir hören jetzt auf das Frontend (provider) anstatt zu raten!
    if (provider === 'openrouter') {
        apiUrl = 'https://openrouter.ai/api/v1/chat/completions';
        apiKey = process.env.OPENROUTER_API_KEY; 
    } 
    else if (provider === 'github') {
        // Der offizielle, stabile GitHub Models Endpunkt
        apiUrl = 'https://models.inference.ai.azure.com/chat/completions';
        apiKey = process.env.GITHUB_TOKEN; // Oder GITHUB_TOKEN, je nachdem was du gespeichert hast
        isGitHubModel = true;
    } 
    else if (provider === 'groq') {
        apiUrl = 'https://api.groq.com/openai/v1/chat/completions';
        apiKey = process.env.GROQ_API_KEY; 
    } 
    else {
        return res.status(400).json({ error: `Unbekannter Provider: ${provider}` });
    }

    // 2. Payload vorbereiten
    const payload = {
        model: modelId,
        messages: messages,
    };

    // GitHub o1-Modelle brauchen spezielle Parameter, der Rest nutzt Standard
    if (isGitHubModel && (modelId.includes('o3-mini') || modelId.includes('o1'))) {
        payload.max_completion_tokens = 8192;
    } else {
        payload.max_tokens = 8192;
        payload.temperature = 0.7; 
    }

    try {
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': 'https://coden-ai.vercel.app', 
                'X-Title': 'Coden AI'
            },
            body: JSON.stringify(payload)
        });
        
        const data = await response.json();
        
        // Wenn die API meckert, fangen wir den Fehler sauber ab
        if (!response.ok || data.error) {
            throw new Error(data.error?.message || data.message || `HTTP ${response.status}`);
        }
        
        // Wir schicken nur den reinen Text-Content zurück ans Frontend
        res.status(200).json({ content: data.choices[0].message.content });
    } catch (error) {
        console.error("Serverless Function Error:", error);
        res.status(500).json({ error: error.message });
    }
};
