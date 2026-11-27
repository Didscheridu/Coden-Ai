// js/humanizer-core.js – Reine Logik für den Coden Humanizer (ohne DOM, vollständig testbar):
// Einstellungen, Systemprompt-Direktiven für Chat/Lernhefte/Lern-Studio, Schutz von Code/Formeln,
// deterministische KI-Muster-Analyse mit Kategorien, Nachglättung und Vorher-Nachher-Diff.

export const HUMANIZER_SCOPES = ['chat', 'notebooks', 'study'];
export const HUMANIZER_STRENGTHS = ['gentle', 'balanced', 'strong'];

export const STRENGTH_META = {
    gentle: {
        id: 'gentle',
        step: 1,
        label: 'Behutsam',
        short: 'Nur Floskeln & Holperstellen glätten',
        desc: 'Entfernt typische KI-Floskeln, Gedankenstrich-Häufungen und steife Übergänge. Satzbau und Fachbegriffe bleiben weitgehend erhalten.'
    },
    balanced: {
        id: 'balanced',
        step: 2,
        label: 'Ausgewogen',
        short: 'Natürlich & schülerfreundlich',
        desc: 'Formuliert verschachtelte KI-Sätze in klare, aktive Sprache um, lockert Übergänge und bewahrt alle Fakten und Fachbegriffe.'
    },
    strong: {
        id: 'strong',
        step: 3,
        label: 'Stark & locker',
        short: 'Frei in Alltagssprache umgeschrieben',
        desc: 'Schreibt Absätze frei und leicht verständlich um – ideal für Referate, Lernzettel oder eigene Mitschriften.'
    }
};

export const DEFAULT_HUMANIZER_PREFS = () => ({
    chat: true,
    notebooks: true,
    study: true,
    strength: 'balanced',
    keepTerms: true,
    shortSentences: true,
    duTone: true
});

export function normalizeHumanizerPrefs(raw) {
    const def = DEFAULT_HUMANIZER_PREFS();
    if (!raw || typeof raw !== 'object') return def;
    const strength = HUMANIZER_STRENGTHS.includes(raw.strength) ? raw.strength : def.strength;
    return {
        chat: raw.chat !== false,
        notebooks: raw.notebooks !== false,
        study: raw.study !== false,
        strength,
        keepTerms: raw.keepTerms !== false,
        shortSentences: raw.shortSentences !== false,
        duTone: raw.duTone !== false
    };
}

export function strengthFromStep(step) {
    const n = Number(step);
    if (n <= 1) return 'gentle';
    if (n >= 3) return 'strong';
    return 'balanced';
}

export function stepFromStrength(strength) {
    return STRENGTH_META[strength]?.step || 2;
}

// ---------- Geschützte Segmente (Code, LaTeX, Coden-Tags) ----------
const PROTECTED_PATTERNS = [
    /```[\s\S]*?```/g,
    /<(artifact|handwriting|notebook_write|plot|pie|bars|quiz|flashcards|steps|stats|proscons|tabs|mermaid|chart)\b[^>]*>[\s\S]*?<\/\1>/gi,
    /\$\$[\s\S]*?\$\$/g,
    /`[^`\n]+`/g,
    /\$[^$\n]+\$/g
];

export function protectSegments(text) {
    const src = String(text ?? '');
    const tokens = [];
    let out = src;
    for (const re of PROTECTED_PATTERNS) {
        out = out.replace(re, (m) => {
            const key = `@@HZKEEP${tokens.length}@@`;
            tokens.push(m);
            return key;
        });
    }
    return { text: out, tokens };
}

export function restoreSegments(text, tokens = []) {
    let out = String(text ?? '');
    for (let i = 0; i < tokens.length; i++) {
        out = out.replace(new RegExp(`@@HZKEEP${i}@@`, 'g'), () => tokens[i]);
    }
    return out;
}

// ---------- Automatische Stil-Direktiven für Coden ----------
export function humanizerPromptDirective({
    scope = 'chat',
    strength = 'balanced',
    keepTerms = true,
    shortSentences = true,
    duTone = true
} = {}) {
    const s = HUMANIZER_STRENGTHS.includes(strength) ? strength : 'balanced';
    const scopeHint = scope === 'notebooks'
        ? 'Du schreibst gerade für das Lernheft bzw. auf eine Heftseite eines Schülers. Formuliere so, wie ein guter Schüler es selbst ordentlich und verständlich ins Heft schreibt.'
        : scope === 'study'
            ? 'Du erstellst Lernmaterial (Merkzettel, Leitfaden, Quiz-Erklärung oder Tutor-Antwort) für Schüler. Es soll klingen wie ein sympathischer, kompetenter Lerncoach oder eine sehr gute Mitschrift – nie wie ein steifer KI-Bericht.'
            : 'Formuliere deine Antwort im Chat natürlich, menschlich und schülerfreundlich.';

    const strengthHint = s === 'gentle'
        ? 'Halte den Stil klar und sachlich, aber meide typische KI-Floskeln und künstliche Überleitungen.'
        : s === 'strong'
            ? 'Schreibe besonders locker, lebendig und alltagsnah, mit kurzen, direkten Sätzen.'
            : 'Schreibe natürlich, klar und verständlich in aktiver Sprache.';

    const rules = [
        '- VERBOTEN sind typische KI-Floskeln wie „Gerne helfe ich dir“, „Hier ist eine Übersicht“, „Es ist wichtig zu beachten“, „Zusammenfassend lässt sich sagen“, „Im heutigen digitalen Zeitalter“, „spielt eine entscheidende Rolle“, „tauchen wir ein“.',
        '- Meide geschraubte KI-Übergänge und Schlagwörter wie „Darüber hinaus“, „Des Weiteren“, „Nichtsdestotrotz“, „Folglich“, „maßgeblich“, „vielschichtig“, „unabdingbar“, „ganzheitlich“, „facettenreich“, „essenziell“.',
        '- Keine langen Gedankenstriche (— oder –) als Satz-Füllsel benutzen; schreibe lieber zwei saubere Sätze oder nutze ein Komma.',
        '- Keine künstlichen Dreier-Schablonen mit Fett-Doppelpunkt-Etiketten wie „**Klarheit:** …“ in jeder Aufzählung.',
        shortSentences ? '- Bevorzuge kurze, gut lesbare Sätze und aktive Verben statt Passiv- oder Nominalstil.' : '- Variiere die Satzlänge natürlich.',
        keepTerms ? '- Wichtige Fachbegriffe, Zahlen, Formeln und Code bleiben fachlich exakt erhalten – nur die Erklärungen drumherum sind leicht verständlich.' : '- Erkläre Begriffe möglichst einfach in Alltagssprache.',
        duTone && scope !== 'notebooks' ? '- Sprich den Schüler direkt und freundlich mit „du“ an, ohne anbiedernd zu wirken.' : null,
        '- Alle Coden-Elemente (wie ==Marker==, {{farbe:…}}, Codeblöcke, Formeln, <handwriting>, <notebook_write>, <artifact>) funktionieren ganz normal weiter.'
    ].filter(Boolean);

    return [
        `## SCHREIBSTIL: NATÜRLICH & SCHÜLERFREUNDLICH (Humanizer aktiv)`,
        `${scopeHint} ${strengthHint}`,
        ...rules
    ].join('\n');
}

// ---------- Prompt für die Humanizer-Werkbank ----------
export function buildHumanizeRequest({
    text,
    strength = 'balanced',
    keepTerms = true,
    shortSentences = true,
    duTone = true
} = {}) {
    const s = HUMANIZER_STRENGTHS.includes(strength) ? strength : 'balanced';
    const { text: safeInput, tokens } = protectSegments(String(text || '').trim());

    const levelDesc = s === 'gentle'
        ? 'Stufe 1 (Behutsam): Entferne KI-Floskeln, Gedankenstriche als Füllsel, unnötige Passivformen und steife Übergänge. Behalte Satzaufbau und Absatzstruktur weitgehend bei.'
        : s === 'strong'
            ? 'Stufe 3 (Stark & locker): Formuliere den Text frei, lebendig und direkt in natürlicher, schülerfreundlicher Alltagssprache um. Teile lange Bandwurmsätze in knackige Einzelsätze auf.'
            : 'Stufe 2 (Ausgewogen): Formuliere den Text natürlich, aktiv und schülerfreundlich um. Ersetze Schachtelsätze, hohle Phrasen und Schablonen durch klare, menschliche Sprache.';

    const system = `Du bist ein präziser deutscher und englischer Text-Redakteur (Humanizer) für Schüler.
Deine Aufgabe: Formuliere den gegebenen Text so um, dass er klingt, als hätte ihn ein Mensch – natürlich, klar, schülerfreundlich und ohne typische KI-Muster.

${levelDesc}

VERBINDLICHE REGELN:
1. Antworte AUSSCHLIESSLICH mit dem überarbeiteten Text – KEINE Einleitung („Hier ist…“), KEINE Kommentare, KEIN Schlusswort.
2. Behalte die Sprache des Ausgangstexts bei (Deutsch bleibt Deutsch, Englisch bleibt Englisch).
3. Verändere KEINE Fakten, Namen, Jahreszahlen, Zitate oder Zahlenwerte.
4. Erhalte Platzhalter wie @@HZKEEP0@@ exakt unverändert an der passenden Stelle im Text.
5. ${keepTerms ? 'Behalte zentrale Fachbegriffe korrekt bei, bette sie aber verständlich ein.' : 'Ersetze unnötig hochgestochene Fremdwörter durch verständliche Alltagswörter.'}
6. ${shortSentences ? 'Löse Bandwurmsätze (> 24 Wörter) in zwei klare, aktive Sätze auf.' : 'Behalte den natürlichen Satzrhythmus bei.'}
7. ${duTone ? 'Falls der Text den Leser direkt anspricht, nutze einen freundlichen, natürlichen Du-Ton.' : 'Behalte die Perspektive des Ausgangstexts (z. B. sachliches Referat oder Ich-Form) exakt bei.'}
8. VERBOTEN im Ergebnis: lange Gedankenstriche (—) oder eingeschobene „ – “-Pausen, KI-Floskeln („Es ist wichtig zu beachten“, „Zusammenfassend lässt sich sagen“, „Darüber hinaus“, „Des Weiteren“, „Nichtsdestotrotz“, „maßgeblich“, „vielschichtig“, „unabdingbar“, „ganzheitlich“, „facettenreich“), künstliche „**Begriff:** Erklärung“-Aufzählungsschablonen.`;

    const user = `Formuliere diesen Text um:\n\n${safeInput}`;
    return { system, user, tokens };
}

// ---------- Deterministische Nachglättung (ohne Fakten zu verfälschen) ----------
export function deAiText(raw, { forNotebook = false, stripIntro = false } = {}) {
    const original = String(raw || '');
    if (!original.trim()) return '';
    const { text: protectedText, tokens } = protectSegments(original);
    let t = protectedText.replace(/\r\n?/g, '\n');

    if (stripIntro) {
        t = t.replace(/^\s*(?:Hier ist(?: die| der| dein| deine)?[^:\n]{0,60}:|Gerne[!.,]?|Natürlich[!.,]?|Sehr gerne[!.,]?|Klar[!.,]?)\s*\n+/i, '');
        t = t.replace(/^```(?:markdown|md|text)?\s*\n([\s\S]*?)\n```\s*$/i, '$1');
    }

    // Typische KI-Floskel-Einleitungen in Absätzen glätten
    t = t
        .replace(/\bZusammenfassend lässt sich sagen,\s*dass\s+/gi, '')
        .replace(/\bAbschließend lässt sich festhalten,\s*dass\s+/gi, '')
        .replace(/\bEs ist wichtig zu beachten,\s*dass\s+/gi, 'Wichtig ist: ')
        .replace(/\bEs gilt zu beachten,\s*dass\s+/gi, 'Zu beachten ist: ')
        .replace(/\bDarüber hinaus\b/g, 'Außerdem')
        .replace(/\bdarüber hinaus\b/g, 'außerdem')
        .replace(/\bDes Weiteren\b/g, 'Außerdem')
        .replace(/\bdes Weiteren\b/g, 'außerdem')
        .replace(/\bNichtsdestotrotz\b/g, 'Trotzdem')
        .replace(/\bnichtsdestotrotz\b/g, 'trotzdem')
        .replace(/\bInfolgedessen\b/g, 'Deshalb')
        .replace(/\binfolgedessen\b/g, 'deshalb');

    // Lange Gedankenstriche (—) im Fließtext durch Komma ersetzen (nicht in Aufzählungs-/Zahlenspannen wie 10–15)
    t = t.replace(/(\S)\s*—\s*(\S)/g, '$1, $2');
    t = t.replace(/\s*—\s*/g, ', ');
    // Eingeschobene „ – “ im Fließtext (wenn links Buchstabe und rechts Kleinbuchstabe/Artikel steht)
    t = t.replace(/([a-zäöüß.,!?])\s+–\s+([a-zäöüß])/g, '$1, $2');

    if (forNotebook) {
        // Im Lernheft stören **Begriff:**-Fett-Etiketten bei jedem Bullet sowie steife Fazit-Überschriften
        t = t.replace(/^(\s*[-*•]\s*)\*\*([^*\n]{1,42}?):\*\*\s*/gm, '$1$2: ');
        t = t.replace(/\*\*/g, '');
    }

    // Satzanfänge nach entferntem Prefix großschreiben, falls Kleinschreibung entstanden ist
    t = t.replace(/(^|\n|[.!?]\s+)([a-zäöü])/g, (_, pre, ch) => pre + ch.toUpperCase());
    t = t.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();

    return restoreSegments(t, tokens);
}

// ---------- Deterministische KI-Muster-Analyse (live, mit exakten Positionen) ----------
export const PATTERN_CATEGORIES = {
    cliche: {
        id: 'cliche',
        label: 'KI-Floskel',
        icon: 'auto_fix_off',
        hint: 'Typische Baukasten-Wendung, die selten natürlich klingt.'
    },
    transition: {
        id: 'transition',
        label: 'Steifer Übergang',
        icon: 'swap_horiz',
        hint: 'Wirkt aufgesetzt; im Alltag sagt man meist einfach „außerdem“ oder „trotzdem“.'
    },
    buzzword: {
        id: 'buzzword',
        label: 'KI-Schlagwort',
        icon: 'psychology_alt',
        hint: 'Überstrapaziertes KI-Wort – ein konkreter Ausdruck ist meist klarer.'
    },
    dash: {
        id: 'dash',
        label: 'Gedankenstrich',
        icon: 'horizontal_rule',
        hint: 'Häufige Einschübe mit Gedankenstrich sind ein typisches KI-Muster.'
    },
    structure: {
        id: 'structure',
        label: 'Schablone / Bandwurm',
        icon: 'segment',
        hint: 'Sehr langer Satz oder starres Aufzählungs-Muster.'
    }
};

const ANALYZER_RULES = [
    // KI-Floskeln (DE + EN)
    {
        cat: 'cliche',
        re: /\b(?:gerne helfe ich(?: dir)?|hier ist(?: eine| der| die)?(?: Übersicht| Antwort| Zusammenfassung)?|zusammenfassend lässt sich sagen|abschließend lässt sich (?:sagen|festhalten)|es ist wichtig zu beachten|es gilt zu beachten|spielt eine (?:entscheidende|zentrale|wichtige) rolle|im heutigen (?:digitalen )?zeitalter|ein breites spektrum|tauchen wir(?: tiefer)? ein|in der heutigen welt|it is important to note|in conclusion|in today'?s (?:fast-paced )?world|delve into)\b/gi,
        suggestion: 'Direkt zur eigentlichen Aussage kommen'
    },
    // Steife Übergänge
    {
        cat: 'transition',
        re: /\b(?:darüber hinaus|des weiteren|nichtsdestotrotz|demzufolge|infolgedessen|diesbezüglich|hinsichtlich dessen|weiterhin ist|furthermore|moreover|additionally|nevertheless|consequently)\b/gi,
        suggestion: 'Einfach „außerdem“, „deshalb“ oder „trotzdem“ nutzen'
    },
    // Typische KI-Schlagwörter
    {
        cat: 'buzzword',
        re: /\b(?:maßgeblich(?:e[rnsm]?)?|vielschichtig(?:e[rnsm]?)?|unabdingbar(?:e[rnsm]?)?|ganzheitlich(?:e[rnsm]?)?|wegweisend(?:e[rnsm]?)?|facettenreich(?:e[rnsm]?)?|essenziell(?:e[rnsm]?)?|tiefgreifend(?:e[rnsm]?)?|meilenstein(?:e|en)?|nahtlos(?:e[rnsm]?)?|synergie(?:n)?|hervorzuheben|bemerkenswert(?:e[rnsm]?)?|crucial|pivotal|seamless(?:ly)?|comprehensive|tapestry|landscape)\b/gi,
        suggestion: 'Konkreteres Alltagswort wählen (z. B. „wichtig“, „genau“, „einfach“)'
    },
    // Gedankenstrich-Muster im Fließtext
    {
        cat: 'dash',
        re: /\s*—\s*|[a-zäöüß.,!?]\s+–\s+[a-zäöüß]/gi,
        suggestion: 'Durch Komma oder Punkt ersetzen'
    },
    // Starre **Titel:**-Aufzählungsschablonen
    {
        cat: 'structure',
        re: /(?:^|\n)\s*[-*•]\s+\*\*[^*\n]{2,40}:\*\*/g,
        suggestion: 'Fließender formulieren ohne starre Fett-Etiketten'
    }
];

function maskedRanges(text) {
    const ranges = [];
    for (const re of PROTECTED_PATTERNS) {
        const r = new RegExp(re.source, re.flags);
        let m;
        while ((m = r.exec(text))) {
            ranges.push([m.index, m.index + m[0].length]);
        }
    }
    return ranges;
}

function overlapsProtected(start, end, ranges) {
    for (const [a, b] of ranges) {
        if (start < b && end > a) return true;
    }
    return false;
}

export function analyzeAiPatterns(raw) {
    const text = String(raw || '');
    const countsByCategory = { cliche: 0, transition: 0, buzzword: 0, dash: 0, structure: 0 };
    if (!text.trim()) {
        return { total: 0, countsByCategory, items: [] };
    }

    const protectedRanges = maskedRanges(text);
    const candidates = [];

    for (const rule of ANALYZER_RULES) {
        const r = new RegExp(rule.re.source, rule.re.flags);
        let m;
        while ((m = r.exec(text))) {
            let start = m.index;
            let end = start + m[0].length;
            let matched = m[0];
            // Führenden Zeilenumbruch bei Listen-Regeln nicht mit markieren
            if (matched.startsWith('\n')) {
                start += 1;
                matched = matched.slice(1);
            }
            // Bei „x – y“ nur das „ – “ hervorheben
            if (rule.cat === 'dash') {
                const dashPos = matched.search(/[—–]/);
                if (dashPos >= 0) {
                    const padStart = Math.max(0, dashPos - 1);
                    const padEnd = Math.min(matched.length, dashPos + 2);
                    start += padStart;
                    end = start + (padEnd - padStart);
                    matched = text.slice(start, end);
                }
            }
            if (end <= start || overlapsProtected(start, end, protectedRanges)) continue;
            candidates.push({
                start,
                end,
                match: matched,
                category: rule.cat,
                label: PATTERN_CATEGORIES[rule.cat].label,
                icon: PATTERN_CATEGORIES[rule.cat].icon,
                hint: PATTERN_CATEGORIES[rule.cat].hint,
                suggestion: rule.suggestion
            });
        }
    }

    // Sehr lange Schachtelsätze (> 28 Wörter) erkennen, falls sie nicht schon viele Treffer haben
    const sentenceRe = /[^.!?\n]+[.!?]?/g;
    let sm;
    while ((sm = sentenceRe.exec(text))) {
        const sent = sm[0];
        const trimmed = sent.trim();
        if (!trimmed || overlapsProtected(sm.index, sm.index + sent.length, protectedRanges)) continue;
        const words = trimmed.split(/\s+/).filter(Boolean);
        if (words.length >= 29 && !trimmed.startsWith('|')) {
            const leadOffset = sent.indexOf(trimmed);
            const start = sm.index + leadOffset;
            const end = start + trimmed.length;
            candidates.push({
                start,
                end,
                match: trimmed,
                category: 'structure',
                label: 'Langer Schachtelsatz',
                icon: PATTERN_CATEGORIES.structure.icon,
                hint: `Dieser Satz hat ${words.length} Wörter und wirkt schwer lesbar.`,
                suggestion: 'In zwei kürzere Sätze aufteilen'
            });
        }
    }

    // Überlappungen sauber auflösen: kürzere/spezifische Inline-Treffer (Floskel/Schlagwort/Übergang/Strich) vor Langsatz-Rahmen behalten
    const priority = { cliche: 5, transition: 4, buzzword: 3, dash: 2, structure: 1 };
    candidates.sort((a, b) => a.start - b.start || priority[b.category] - priority[a.category] || (b.end - b.start) - (a.end - a.start));

    const items = [];
    for (const c of candidates) {
        const conflict = items.findIndex(x => c.start < x.end && c.end > x.start);
        if (conflict === -1) {
            items.push(c);
        } else if (priority[c.category] > priority[items[conflict].category]) {
            items.splice(conflict, 1, c);
        }
    }
    items.sort((a, b) => a.start - b.start);

    for (const it of items) {
        countsByCategory[it.category] = (countsByCategory[it.category] || 0) + 1;
    }

    return {
        total: items.length,
        countsByCategory,
        items
    };
}

// ---------- Wort-Diff für Vorher-Nachher-Vergleich ----------
function tokenizeForDiff(text) {
    return String(text || '').match(/\S+|\s+/g) || [];
}

export function computeTextDiff(before, after) {
    const a = tokenizeForDiff(before);
    const b = tokenizeForDiff(after);
    if (!a.length && !b.length) return [];
    if (!a.length) return [{ type: 'add', text: String(after) }];
    if (!b.length) return [{ type: 'del', text: String(before) }];

    // Sicherheitsgrenze für extrem lange Texte (sonst O(n*m)-Speicher zu groß)
    if (a.length * b.length > 180_000) {
        return [
            { type: 'del', text: String(before) },
            { type: 'add', text: String(after) }
        ];
    }

    const n = a.length, m = b.length;
    const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
    for (let i = n - 1; i >= 0; i--) {
        for (let j = m - 1; j >= 0; j--) {
            dp[i][j] = a[i] === b[j]
                ? dp[i + 1][j + 1] + 1
                : Math.max(dp[i + 1][j], dp[i][j + 1]);
        }
    }

    const rawOps = [];
    let i = 0, j = 0;
    while (i < n && j < m) {
        if (a[i] === b[j]) {
            rawOps.push({ type: 'same', text: a[i] });
            i++; j++;
        } else if (dp[i + 1][j] >= dp[i][j + 1]) {
            rawOps.push({ type: 'del', text: a[i] });
            i++;
        } else {
            rawOps.push({ type: 'add', text: b[j] });
            j++;
        }
    }
    while (i < n) rawOps.push({ type: 'del', text: a[i++] });
    while (j < m) rawOps.push({ type: 'add', text: b[j++] });

    // Benachbarte gleiche Operationen zusammenfassen
    const merged = [];
    for (const op of rawOps) {
        const last = merged[merged.length - 1];
        if (last && last.type === op.type) last.text += op.text;
        else merged.push({ ...op });
    }
    return merged;
}

export function wordCount(text) {
    const words = String(text || '').trim().split(/\s+/).filter(Boolean);
    return words.length;
}
