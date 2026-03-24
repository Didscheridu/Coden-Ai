// api/chat.js
module.exports = async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    const { messages, modelId, provider } = req.body;
    if (!messages || !modelId || !provider) return res.status(400).json({ error: 'Fehlende Daten' });

    let apiUrl = ''; let apiKey = ''; let isGitHubModel = false;

    if (provider === 'openrouter') { apiUrl = 'https://openrouter.ai/api/v1/chat/completions'; apiKey = process.env.OPENROUTER_API_KEY; } 
    else if (provider === 'github') { apiUrl = 'https://models.inference.ai.azure.com/chat/completions'; apiKey = process.env.GITHUB_API_KEY; isGitHubModel = true; } 
    else if (provider === 'groq') { apiUrl = 'https://api.groq.com/openai/v1/chat/completions'; apiKey = process.env.GROQ_API_KEY; } 
    else return res.status(400).json({ error: `Unbekannter Provider: ${provider}` });

    // 👁️ VISION FIX: Wir bauen die Nachrichten so um, dass die KI Bilder "sehen" kann!
    const formattedMessages = messages.map(msg => {
        if (msg.images && msg.images.length > 0) {
            // Wenn Bilder dabei sind, machen wir ein spezielles OpenAI-Vision-Array
            let contentArray = [{ type: "text", text: msg.content }];
            msg.images.forEach(imgBase64 => {
                contentArray.push({ type: "image_url", image_url: { url: imgBase64 } });
            });
            return { role: msg.role, content: contentArray };
        }
        // Wenn kein Bild dabei ist, bleibt es normaler Text
        return { role: msg.role, content: msg.content };
    });

    const payload = { model: modelId, messages: formattedMessages };

    if (isGitHubModel && (modelId.includes('o3-mini') || modelId.includes('o1'))) payload.max_completion_tokens = 8192;
    else { payload.max_tokens = 8192; payload.temperature = 0.7; }

    try {
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://coden-ai.vercel.app', 'X-Title': 'Coden AI' },
            body: JSON.stringify(payload)
        });
        const data = await response.json();
        if (!response.ok || data.error) throw new Error(data.error?.message || data.message || `HTTP ${response.status}`);
        
        res.status(200).json({ content: data.choices[0].message.content });
    } catch (error) {
        console.error("Serverless Function Error:", error);
        res.status(500).json({ error: error.message });
    }
};
