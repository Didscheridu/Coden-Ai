// js/Limit-Spamschutz.js

const MAX_REQUESTS = 3;
const TIME_WINDOW_MS = 60 * 1000; // 60 Sekunden

export function checkRateLimit(isOwner) {
    // 👑 Der Boss hat VIP-Zugang ohne Limit!
    if (isOwner) {
        return { allowed: true };
    }

    const now = Date.now();
    
    // Hole die alten Zeitstempel hartnäckig aus dem Speicher (F5 bringt nichts mehr!)
    let savedTimestamps = localStorage.getItem('coden_spam_timestamps');
    let requestTimestamps = savedTimestamps ? JSON.parse(savedTimestamps) : [];

    // Alte Zeitstempel rauswerfen (alles älter als 60 Sekunden)
    requestTimestamps = requestTimestamps.filter(timestamp => now - timestamp < TIME_WINDOW_MS);

    // Wenn das Limit erreicht ist:
    if (requestTimestamps.length >= MAX_REQUESTS) {
        const oldestRequest = requestTimestamps[0];
        const timeToWait = Math.ceil((TIME_WINDOW_MS - (now - oldestRequest)) / 1000);
        
        // Gesäuberte Liste trotzdem speichern!
        localStorage.setItem('coden_spam_timestamps', JSON.stringify(requestTimestamps));
        return { allowed: false, timeToWait: timeToWait };
    }

    // Anfrage ist erlaubt! Wir pushen die neue Zeit und speichern es sofort ab.
    requestTimestamps.push(now);
    localStorage.setItem('coden_spam_timestamps', JSON.stringify(requestTimestamps));
    
    return { allowed: true };
}
