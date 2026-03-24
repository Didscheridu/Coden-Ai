// js/Limit-Spamschutz.js

const MAX_REQUESTS = 3;
const TIME_WINDOW_MS = 60 * 1000; // 60 Sekunden in Millisekunden

let requestTimestamps = [];

export function checkRateLimit(isOwner) {
    // 👑 Der Boss hat VIP-Zugang ohne Limit!
    if (isOwner) {
        return { allowed: true };
    }

    const now = Date.now();
    
    // Alte Zeitstempel rauswerfen (alles, was älter als 60 Sekunden ist, wird gelöscht)
    requestTimestamps = requestTimestamps.filter(timestamp => now - timestamp < TIME_WINDOW_MS);

    // Wenn der Nutzer schon 3 (oder mehr) Anfragen in der letzten Minute hatte:
    if (requestTimestamps.length >= MAX_REQUESTS) {
        // Berechnen, wie viele Sekunden er noch warten muss
        const oldestRequest = requestTimestamps[0];
        const timeToWait = Math.ceil((TIME_WINDOW_MS - (now - oldestRequest)) / 1000);
        return { allowed: false, timeToWait: timeToWait };
    }

    // Anfrage ist erlaubt! Wir speichern den aktuellen Zeitstempel ab.
    requestTimestamps.push(now);
    return { allowed: true };
}
