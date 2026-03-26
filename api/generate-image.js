// api/generate-image.js
module.exports = async function handler(req, res) {
    // Nur POST-Anfragen erlauben
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    const { prompt } = req.body;
    if (!prompt) return res.status(400).json({ error: 'Prompt fehlt' });

    // Holt den Freepik Key aus den Vercel Environment Variables
    const apiKey = process.env.FREEPIK_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'Freepik API Key fehlt im Backend!' });

    try {
        // Freepik Text-to-Image API Aufruf
        const response = await fetch('https://api.freepik.com/v1/ai/text-to-image', {
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'x-freepik-api-key': apiKey
            },
            body: JSON.stringify({
                prompt: prompt,
                // Du kannst hier bei Bedarf weitere Freepik-Parameter hinzufügen (z.B. styling)
            })
        });

        const data = await response.json();
        if (!response.ok) throw new Error(data.message || 'Fehler bei der Freepik API');

        // Freepik gibt in der Regel base64-Strings für Bilder zurück
        if (data.data && data.data[0] && data.data[0].base64) {
            const base64Image = `data:image/jpeg;base64,${data.data[0].base64}`;
            return res.status(200).json({ imageUrl: base64Image });
        } else if (data.data && data.data[0] && data.data[0].url) {
            // Falls sie eine URL zurückgeben
            return res.status(200).json({ imageUrl: data.data[0].url });
        } else {
            throw new Error('Unerwartetes Antwortformat von Freepik');
        }
    } catch (error) {
        console.error("Freepik Error:", error);
        res.status(500).json({ error: error.message });
    }
};
