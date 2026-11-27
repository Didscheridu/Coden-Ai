// js/dictation-smart.js – Intelligente Sprach-Nachbearbeitung für Diktate:
// Wandelt gesprochenen Text auf Wunsch automatisch in saubere Aufgaben-Checklisten oder gegliederte Notizen um.

const CLEAN_FILLERS = /\b(ähm|äh|hm|halt|sozusagen|quasi|irgendwie)\b/gi;

const TASK_LEAD = /^(?:(?:aufgabe|hausaufgabe|todo|to-do|merke|wichtig|termin|nicht vergessen|lernen für|abgabe)\b[:\s-]*)/i;
const SUBJECT_RE = /\b(mathe|mathematik|deutsch|englisch|französisch|spanisch|latein|biologie|bio|chemie|physik|geschichte|erdkunde|geografie|politik|wirtschaft|informatik|kunst|musik|sport|religion|ethik)\b/i;

function tidySentence(s) {
    let out = String(s || '')
        .replace(CLEAN_FILLERS, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    if (!out) return '';
    out = out.replace(/\b(neue zeile|nächster punkt|punkt)\b/gi, '').trim();
    if (!out) return '';
    return out.charAt(0).toUpperCase() + out.slice(1);
}

/**
 * Erkennt anhand des gesprochenen Inhalts, ob eher eine Aufgabenliste oder Notizen gemeint sind,
 * und formatiert das Diktat entsprechend als strukturiertes Markdown.
 */
export function smartStructureDictation(rawText, mode = 'smart') {
    const raw = String(rawText || '').trim();
    if (!raw || mode === 'normal') return raw;

    // explizite Sprach-Trenner ("nächster Punkt", "außerdem", "und dann", "erstens/zweitens", Satzzeichen, Zeilen)
    const normalized = raw
        .replace(/\b(neue zeile|nächster punkt|nächste aufgabe|und als nächstes|außerdem muss ich noch|außerdem|erstens|zweitens|drittens|viertens)\b/gi, '\n')
        .replace(/([.!?])\s+/g, '$1\n')
        .replace(/\s*;\s*/g, '\n');

    const segments = normalized
        .split(/\n+/)
        .map(tidySentence)
        .filter(Boolean);

    if (!segments.length) return raw;

    const looksLikeTasks = /\b(hausaufgaben?|aufgaben?|todo|lernen|abgeben|morgen|bis\s+(?:montag|dienstag|mittwoch|donnerstag|freitag)|präsentation|klausur|arbeit schreiben|vorbereiten|erledigen)\b/i.test(raw);

    if (segments.length === 1 && !looksLikeTasks) {
        return segments[0];
    }

    if (looksLikeTasks || mode === 'tasks') {
        const items = segments.map((seg) => {
            const stripped = seg.replace(TASK_LEAD, '').trim() || seg;
            const subj = stripped.match(SUBJECT_RE);
            const finalLine = subj
                ? stripped.replace(new RegExp(`^(${subj[1]})\\s*[:\\-]?\\s*`, 'i'), (_, w) => `**${w.charAt(0).toUpperCase() + w.slice(1)}:** `)
                : stripped;
            return `- [ ] ${finalLine.replace(/[.]+$/, '')}`;
        });
        return `### Aufgaben\n${items.join('\n')}`;
    }

    // Strukturierte Notizen
    if (segments.length <= 2) {
        return segments.map(s => `- ${s}`).join('\n');
    }
    return `### Notizen\n${segments.map(s => `- ${s}`).join('\n')}`;
}
