// api/send-email.js
const nodemailer = require('nodemailer'); // FIX: Klassischer Import für den Vercel Server!

export default async function handler(req, res) {
    // Nur POST-Anfragen erlauben
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Methode nicht erlaubt' });
    }

    const { provider, email, password, to, subject, text } = req.body;

    // Prüfen ob alles ausgefüllt ist
    if (!email || !password || !to || !text) {
        return res.status(400).json({ error: 'Es fehlen Daten (E-Mail, Passwort, Empfänger oder Text).' });
    }

    try {
        // Welcher Server soll genutzt werden?
        let host = '';
        let port = 465; // SSL Port

        if (provider === 'gmail') {
            host = 'smtp.gmail.com';
        } else if (provider === 'outlook') {
            host = 'smtp.office365.com';
            port = 587; // TLS Port für Outlook
        } else {
            host = provider; // Falls jemand manuell einen Server einträgt
        }

        // Transporter (Postbote) erstellen
        const transporter = nodemailer.createTransport({
            host: host,
            port: port,
            secure: port === 465, 
            auth: {
                user: email,
                pass: password // Hier muss das Google/Microsoft App-Passwort rein!
            }
        });

        // E-Mail versenden
        const info = await transporter.sendMail({
            from: `"Coden AI Assistent" <${email}>`,
            to: to,
            subject: subject || "Neue Nachricht von Coden AI",
            text: text
        });

        res.status(200).json({ success: true, messageId: info.messageId });
    } catch (error) {
        console.error("Fehler beim Senden:", error);
        res.status(500).json({ error: error.message });
    }
}
