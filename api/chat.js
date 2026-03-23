// api/chat.js

// FIX: Auch hier nutzen wir jetzt module.exports statt export default!
module.exports = async function handler(req, res) {
    // Wir erlauben nur POST-Anfragen
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const { messages, modelId } = req.body;

    let apiUrl = '';
    let apiKey = '';
    let isGitHubModel = false;

    // 1. Router-Logik: Entscheiden, welche API genutzt wird
    if (modelId.includes('nemotron') || modelId.includes('nvidia') || modelId.includes('openrouter')) {
        apiUrl = 'https://openrouter.ai/api/v1/chat/completions';
        apiKey = process.env.OPENROUTER_API_KEY; // Sicherer Vercel Tresor!
    } else if (modelId.includes('openai')) {
        apiUrl = 'https://models.github.ai/inference/chat/completions';
        apiKey = process.env.GITHUB_API_KEY;     // Sicherer Vercel Tresor!
        isGitHubModel = true;
    } else {
        apiUrl = 'https://api.groq.com/openai/v1/chat/completions';
        apiKey = process.env.GROQ_API_KEY;       // Sicherer Vercel Tresor!
    }

    // 2. Payload vorbereiten
    const payload = {
        model: modelId,
        messages: messages,
    };

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
        
        if (!response.ok || data.error) {
            throw new Error(data.error?.message || `HTTP ${response.status}`);
        }
        
        // Wir schicken nur den reinen Text-Content zurück ans Frontend
        res.status(200).json({ content: data.choices[0].message.content });
    } catch (error) {
        console.error("Serverless Function Error:", error);
        res.status(500).json({ error: error.message });
    }
};
