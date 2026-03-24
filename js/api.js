// js/api.js
export async function generateAiResponse(messages, modelId) {
    try {
        const response = await fetch('/api/chat', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ messages, modelId })
        });

        // SCHUTZSCHILD: Wir lesen die Antwort zuerst als rohen Text!
        const textResponse = await response.text();

        let data;
        try {
            // Wir versuchen, den Text in ein Daten-Objekt (JSON) umzuwandeln
            data = JSON.parse(textResponse);
        } catch (e) {
            // Wenn das fehlschlägt, ist es meistens das API Rate Limit
            if (textResponse.includes("Too many") || response.status === 429) {
                throw new Error("⏳ API Limit erreicht (Zu viele Anfragen). Bitte warte kurz 1-2 Minuten.");
            }
            throw new Error("Server antwortete nicht richtig: " + textResponse.substring(0, 40) + "...");
        }

        if (!response.ok || data.error) {
            throw new Error(data.error || `HTTP Fehler ${response.status}`);
        }

        return data.content;
    } catch (error) {
        console.error("API Fehler:", error);
        throw error; 
    }
}
