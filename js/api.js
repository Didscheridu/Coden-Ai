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

        // SCHUTZSCHILD: Wir lesen die Antwort zuerst als Text, nicht als JSON!
        const textResponse = await response.text();

        let data;
        try {
            // Wir versuchen, den Text in JSON umzuwandeln
            data = JSON.parse(textResponse);
        } catch (e) {
            // Wenn es fehlschlägt, prüfen wir auf das Rate Limit!
            if (textResponse.includes("Too many") || response.status === 429) {
                throw new Error("⏳ API Limit erreicht (Zu viele Anfragen). Bitte warte ca. 1 Minute.");
            }
            throw new Error("Server antwortete nicht richtig: " + textResponse.substring(0, 40) + "...");
        }

        if (!response.ok || data.error) {
            throw new Error(data.error || `HTTP Fehler ${response.status}`);
        }

        return data.content;
    } catch (error) {
        console.error("API Fehler:", error);
        throw error; // Wird an die app.js weitergeleitet!
    }
}
