// js/api.js

export async function generateAiResponse(messages, modelId) {
    try {
        // Wir rufen unsere EIGENE Serverless Function auf!
        const response = await fetch('/api/chat', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ 
                messages: messages, 
                modelId: modelId 
            })
        });
        
        const data = await response.json();
        
        if (!response.ok || data.error) {
            throw new Error(data.error || `Server Fehler: ${response.status}`);
        }
        
        return data.content;
    } catch (error) {
        console.error("Frontend API Error:", error);
        return `❌ **Fehler aufgetreten:**\n\n\`${error.message}\``;
    }
}