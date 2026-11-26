// js/study-live.js – Live-Modus im Lern-Studio: mit Coden per Stimme über Aufgaben reden.
// Coden ist hier Nachhilfelehrer: kennt Fächer, Aufträge, Arbeiten und Stundenplan, sieht im Heft die aktuelle Seite
// (wird bei Änderungen als Bild mitgeschickt) und hilft Schritt für Schritt, ohne sofort die Lösung zu verraten.
import { sharedLive } from './multimodal-live-prototype.js';
import { StudyStore } from './study-store.js';
import { Storage } from './storage.js';

export function tutorPrompt({ task = '', subject = '', page = '' } = {}) {
    const name = Storage.getSettings()?.userName || 'du';
    return `Du bist "Coden", ein geduldiger, motivierender Nachhilfelehrer. Du sprichst per Stimme mit ${name} (Schüler/in), Deutsch, kurze natürliche Sätze.
SO HILFST DU:
- Erst verstehen, woran ${name} gerade arbeitet. Dann Schritt für Schritt helfen: Rückfrage stellen, Tipp geben, erst wenn nötig den nächsten Schritt zeigen. Nicht sofort die ganze Lösung verraten.
- Fehler freundlich, aber klar benennen und erklären, warum. Lob für richtige Schritte.
- Rechnungen und Formeln langsam und deutlich aussprechen ("x hoch zwei", "Bruch: drei durch vier").
- Wenn du Bilder der Heftseite bekommst: das ist, was ${name} gerade schreibt. Lies es, beziehe dich konkret darauf ("in deiner zweiten Zeile …"). Kommentiere neue Bilder nur, wenn es etwas Wichtiges gibt oder du gefragt wirst.
- Wichtige Merksätze oder nächste Schritte kannst du mit idee_festhalten als kurze Notiz festhalten.
${subject ? `FACH: ${subject}\n` : ''}${task ? `AUFTRAG/AUFGABE:\n${task.slice(0, 3000)}\n` : ''}${page ? `SEITE: ${page}\n` : ''}
${StudyStore.context() || ''}`;
}

// Live starten. compact: kleine Leiste (im Heft weiterschreiben), sonst großes Fenster mit Notizen.
export function startStudyLive({ compact = false, task = '', subject = '', page = '', greeting, onReady, onEnd } = {}) {
    if (sharedLive.isSessionActive) { sharedLive.stopSession(); return false; }
    sharedLive.initSession(null, null, [], {
        compact, boardTitle: 'Notizen von Coden',
        system: tutorPrompt({ task, subject, page }),
        greeting: greeting || (task ? 'Ich bin jetzt im Live-Modus und arbeite an meiner Aufgabe. Begrüße mich ganz kurz, sag in einem Satz, worum es in der Aufgabe geht, und frag, wo ich gerade hänge.' : 'Ich bin im Lern-Studio im Live-Modus. Begrüße mich kurz, nenn in einem Satz, was bei mir als Nächstes ansteht (Arbeiten, Abgaben), und frag, wobei du helfen sollst.'),
        onReady, onEnd
    });
    return true;
}
export const liveActive = () => sharedLive.isSessionActive;
export const stopLive = () => { if (sharedLive.isSessionActive) sharedLive.stopSession(); };
export const sendLiveImage = (d) => sharedLive.sendImage(d);
export const sendLiveNote = (t) => sharedLive.sendNote(t);
