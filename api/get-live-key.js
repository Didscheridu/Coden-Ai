// api/get-live-key.js
module.exports = async function handler(req, res) {
    // Erlaubt nur GET-Anfragen
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Methode nicht erlaubt' });
    }

    // Holt den Key aus den Vercel Environment Variables
    const apiKey = process.env.GOOGLE_API_KEY;

    if (!apiKey) {
        return res.status(500).json({ error: 'API Key nicht in Vercel konfiguriert!' });
    }

    // Gibt den Key an das Frontend zurück
    res.status(200).json({ key: apiKey });
};
