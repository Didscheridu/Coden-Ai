// js/study-import-core.js – Reine Logik (ohne DOM, testbar) für:
// 1) Anki- / Quizlet-Karteikarten-Import (.txt, .csv, .tsv & Copy-Paste)
// 2) Schulbuch-Seiten-Scanner Prompts & Parser (Lernnotiz, Karteikarten, Aufgaben, Handschrift)

const DELIM_HINT = {
    tab: '\t',
    comma: ',',
    semicolon: ';',
    pipe: '|',
    colon: ':'
};

function cleanCardText(raw, isHtml = true) {
    let s = String(raw || '').trim();
    if (!s) return '';
    if (isHtml) {
        s = s
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<\/(?:div|p|li)>/gi, '\n')
            .replace(/<[^>]+>/g, '')
            .replace(/&nbsp;/gi, ' ')
            .replace(/&amp;/gi, '&')
            .replace(/&lt;/gi, '<')
            .replace(/&gt;/gi, '>')
            .replace(/&quot;/gi, '"')
            .replace(/&#39;/gi, "'");
    }
    return s
        .split('\n')
        .map(line => line.trim())
        .filter((line, i, arr) => line || (i > 0 && arr[i - 1]))
        .join('\n')
        .trim()
        .slice(0, 1200);
}

// CSV-Zeile korrekt splitten (beachtet Anführungszeichen "a, b",c)
function splitDelimitedLine(line, sep) {
    if (sep.length > 1) {
        return line.split(sep);
    }
    const cols = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
            if (inQuotes && line[i + 1] === '"') {
                cur += '"';
                i++;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (ch === sep && !inQuotes) {
            cols.push(cur);
            cur = '';
        } else {
            cur += ch;
        }
    }
    cols.push(cur);
    return cols;
}

export function detectFlashcardDelimiter(lines) {
    const sample = lines.slice(0, 25);
    const candidates = ['\t', ' :: ', ';', ' - ', ','];
    let best = '\t';
    let bestScore = -1;
    for (const sep of candidates) {
        let twoCol = 0;
        for (const line of sample) {
            const cols = splitDelimitedLine(line, sep).map(c => c.trim()).filter(Boolean);
            if (cols.length >= 2) twoCol++;
        }
        if (twoCol > bestScore) {
            bestScore = twoCol;
            best = sep;
        }
    }
    return bestScore > 0 ? best : '\t';
}

export function delimiterLabel(sep) {
    if (sep === '\t') return 'Tabulator';
    if (sep === ';') return 'Semikolon (;)';
    if (sep === ',') return 'Komma (,)';
    if (sep === ' :: ') return 'Doppelpunkt (::)';
    if (sep === ' - ') return 'Bindestrich ( - )';
    return sep;
}

/**
 * Parst Anki (.txt / .tsv / .csv) oder Quizlet Copy-Paste Text in Karteikarten.
 * @param {string} rawText
 * @param {{ delimiter?: string }} [opts]
 */
export function parseFlashcardsImport(rawText, { delimiter = 'auto' } = {}) {
    const linesRaw = String(rawText || '').replace(/\r\n?/g, '\n').split('\n');
    let ankiSep = null;
    let isHtml = true;
    const contentLines = [];

    for (const line of linesRaw) {
        const t = line.trim();
        if (!t) continue;
        if (t.startsWith('#')) {
            const sepM = t.match(/^#separator\s*:\s*(\S+)/i);
            if (sepM) ankiSep = DELIM_HINT[sepM[1].toLowerCase()] || sepM[1];
            const htmlM = t.match(/^#html\s*:\s*(true|false)/i);
            if (htmlM) isHtml = htmlM[1].toLowerCase() === 'true';
            continue;
        }
        contentLines.push(line);
    }

    if (!contentLines.length) {
        return { cards: [], detectedDelimiter: delimiter === 'auto' ? '\t' : delimiter, skipped: 0 };
    }

    const usedSep = (!delimiter || delimiter === 'auto')
        ? (ankiSep || detectFlashcardDelimiter(contentLines))
        : (delimiter === 'tab' ? '\t' : delimiter);

    const cards = [];
    let skipped = 0;
    const now = Date.now().toString(36);

    for (let i = 0; i < contentLines.length; i++) {
        const cols = splitDelimitedLine(contentLines[i], usedSep);
        if (cols.length < 2) { skipped++; continue; }
        const front = cleanCardText(cols[0], isHtml);
        // Falls weitere Spalten (z. B. Notiz) existieren, sauber bündeln
        const back = cleanCardText(cols.slice(1, 3).filter(c => c.trim()).join('\n\n'), isHtml);
        if (!front || !back) { skipped++; continue; }
        // Klassische CSV-Kopfzeile überspringen
        if (i === 0 && /^(vorderseite|frage|begriff|front|term)$/i.test(front) && /^(rückseite|antwort|definition|back)$/i.test(back)) {
            continue;
        }
        cards.push({
            id: `imp_${now}_${cards.length}`,
            front,
            back,
            status: null
        });
        if (cards.length >= 400) break;
    }

    return { cards, detectedDelimiter: usedSep, skipped };
}

export function textbookScanPrompts({ mode = 'notes', subject = '' } = {}) {
    const subjHint = subject ? ` im Fach ${subject}` : '';
    if (mode === 'cards') {
        return {
            system: `Du erstellst aus Schulbuch-Seiten${subjHint} präzise Karteikarten auf Deutsch. Antworte AUSSCHLIESSLICH mit gültigem JSON ohne Text drumherum.`,
            user: `Lies alle wichtigen Definitionen, Fachbegriffe, Jahreszahlen, Formeln und Zusammenhänge auf den angehängten Schulbuch-Seiten aus und erstelle 8 bis 16 hochwertige Karteikarten.\nFormat: {"title":"Thema der Schulbuch-Seite","cards":[{"front":"Begriff / Frage","back":"Klare, schülergerechte Antwort"}]}`
        };
    }
    if (mode === 'tasks') {
        return {
            system: `Du bist ein hilfreicher Lern-Tutor${subjHint}. Du liest Aufgaben und Texte auf Schulbuch-Seiten vollständig aus und erklärst klare Lösungen auf Deutsch.`,
            user: `Analysiere die angehängten Schulbuch-Seiten:\n1. Gib eine kurze Übersicht zum Thema der Seite.\n2. Liste die erkannten Aufgaben (mit Nummer) und löse jede Aufgabe nachvollziehbar Schritt für Schritt (mit Zwischenschritten und Merksatz).`
        };
    }
    if (mode === 'handwriting') {
        return {
            system: `Du schreibst kompakte, schülergerechte Heftaufschriebe auf Deutsch für ein Schulheft. Nutze klare Zeilen, Unicode-Mathe (x², √, ·, →), # Titel, ==wichtig== für Marker, KEIN LaTeX ($) und KEIN **Fett**.`,
            user: `Fasse den Lernstoff der angehängten Schulbuch-Seiten${subjHint} als sauberen, prüfungsrelevanten Heftaufschrieb zusammen (Überschrift mit #, Unterpunkte mit •, wichtige Begriffe mit ==…== markieren, max. 35 Zeilen).`
        };
    }
    // Default: 'notes'
    return {
        system: `Du strukturierst Schulbuch-Seiten${subjHint} als übersichtliche, prüfungsrelevante Lernnotizen in Markdown auf Deutsch.`,
        user: `Lies die angehängten Schulbuch-Seiten vollständig aus und erstelle daraus eine strukturierte Lernnotiz:\n- **Thema & Überblick**\n- **Wichtigste Begriffe & Definitionen**\n- **Formeln / Regeln / Merksätze**\n- **Typische Beispiele oder Merktipps**\nLass nichts Wesentliches von den Seiten weg.`
    };
}

export function parseTextbookScan(raw, mode = 'notes') {
    const txt = String(raw || '').trim();
    if (!txt) throw new Error('Keine Antwort vom Schulbuch-Scanner erhalten.');
    if (mode === 'cards') {
        const fenced = txt.match(/```(?:json)?\s*([\s\S]*?)```/i);
        const body = fenced ? fenced[1].trim() : txt;
        const start = body.search(/[\[{]/);
        if (start < 0) throw new Error('Karteikarten-Format nicht erkannt.');
        const parsed = JSON.parse(body.slice(start));
        const arr = Array.isArray(parsed) ? parsed : (parsed.cards || []);
        const now = Date.now().toString(36);
        const cards = arr
            .filter(c => c && c.front && c.back)
            .map((c, i) => ({
                id: `scan_${now}_${i}`,
                front: String(c.front).trim().slice(0, 1000),
                back: String(c.back).trim().slice(0, 1200),
                status: null
            }));
        if (!cards.length) throw new Error('Keine Karteikarten auf der Seite erkannt.');
        return {
            title: String(parsed.title || 'Schulbuch-Karten').trim().slice(0, 80),
            cards
        };
    }
    const titleMatch = txt.match(/^#{1,2}\s+(.+)$/m);
    return {
        title: titleMatch ? titleMatch[1].replace(/[*`]/g, '').trim().slice(0, 80) : 'Schulbuch-Scan',
        text: txt
    };
}
