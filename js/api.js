// api/chat.js
export default async function handler(req, res) {
    // Nur POST-Anfragen erlauben
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { messages, modelId, provider } = req.body;

    if (!messages || !modelId || !provider) {
        return res.status(400).json({ error: 'Missing messages, modelId, or provider' });
    }

    try {
        let apiUrl = '';
        let apiKey = '';
        let requestBody = {};
        let headers = {
            'Content-Type': 'application/json'
        };

        // ==========================================
        // 1. GOOGLE AI STUDIO (Gemma / Gemini)
        // ==========================================
        if (provider === 'google') {
            apiKey = process.env.GOOGLE_API_KEY;
            if (!apiKey) throw new Error("GOOGLE_API_KEY fehlt in Vercel.");

            apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${apiKey}`;
            
            // Google Formatierung (braucht 'contents' und 'parts')
            const contents = [];
            let systemInstruction = null;

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

            requestBody = { contents };

            // Gemma-Modelle brauchen den System-Prompt manchmal als erste User-Nachricht
            if (modelId.includes('gemma') && systemInstruction) {
                if (contents.length > 0) {
                    contents[0].parts[0].text = systemInstruction.parts[0].text + "\n\n---\n\n" + contents[0].parts[0].text;
                } else {
                    contents.push({ role: 'user', parts: [{ text: systemInstruction.parts[0].text }]});
                }
            } else if (systemInstruction) {
                requestBody.systemInstruction = systemInstruction;
            }
        } 
        
        // ==========================================
        // 2. GROQ (Llama, Qwen, etc. in Echtzeit)
        // ==========================================
        else if (provider === 'groq') {
            apiKey = process.env.GROQ_API_KEY;
            if (!apiKey) throw new Error("GROQ_API_KEY fehlt in Vercel.");
            
            apiUrl = 'https://api.groq.com/openai/v1/chat/completions';
            headers['Authorization'] = `Bearer ${apiKey}`;
            requestBody = {
                model: modelId,
                messages: messages,
                temperature: 0.7
            };
        } 
        
        // ==========================================
        // 3. OPENROUTER (Die riesige Modell-Bibliothek)
        // ==========================================
        else if (provider === 'openrouter') {
            apiKey = process.env.OPENROUTER_API_KEY;
            if (!apiKey) throw new Error("OPENROUTER_API_KEY fehlt in Vercel.");
            
            apiUrl = 'https://openrouter.ai/api/v1/chat/completions';
            headers['Authorization'] = `Bearer ${apiKey}`;
            headers['HTTP-Referer'] = 'https://coden-ai.com'; // OpenRouter verlangt oft einen Referer
            headers['X-Title'] = 'Coden AI';
            requestBody = {
                model: modelId,
                messages: messages,
                temperature: 0.7
            };
        } 
        
        // ==========================================
        // 4. GITHUB MODELS (GPT-4o, GPT-4.1)
        // ==========================================
        else if (provider === 'github') {
            apiKey = process.env.GITHUB_TOKEN; // Ein GitHub Personal Access Token
            if (!apiKey) throw new Error("GITHUB_TOKEN fehlt in Vercel.");
            
            // GitHub nutzt Azure Endpunkte für seine KI-Modelle
            apiUrl = 'https://models.inference.ai.azure.com/chat/completions';
            headers['Authorization'] = `Bearer ${apiKey}`;
            requestBody = {
                model: modelId,
                messages: messages,
                temperature: 0.7
            };
        } 
        
        else {
            throw new Error(`Unbekannter Provider: ${provider}`);
        }

        // ==========================================
        // 🚀 DIE ANFRAGE AN DEN ANBIETER SENDEN
        // ==========================================
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(requestBody)
        });

        const data = await response.json();

        // Fehler-Handling (z.B. Rate Limits fangen!)
        if (!response.ok) {
            if (response.status === 429) {
                return res.status(429).json({ error: "Rate Limit erreicht" });
            }
            throw new Error(data.error?.message || data.message || `API Error ${response.status}`);
        }

        // Antworten extrahieren (Google nutzt ein anderes Format als die OpenAI-kompatiblen)
        let aiContent = "";
        if (provider === 'google') {
            aiContent = data.candidates[0].content.parts[0].text;
        } else {
            // Groq, OpenRouter und GitHub nutzen alle das Standard-OpenAI-Format
            aiContent = data.choices[0].message.content;
        }

        // Antwort sauber ans Frontend zurückgeben
        return res.status(200).json({ success: true, content: aiContent });

    } catch (error) {
        console.error("Backend Error:", error);
        return res.status(500).json({ error: error.message });
    }
}
