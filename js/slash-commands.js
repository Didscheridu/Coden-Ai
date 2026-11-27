// js/slash-commands.js – Slash-Befehle & Schüler-Vorlagen (für alle Nutzer zugänglich).
// Reine Funktionen sind ohne DOM testbar; Coden-Chat lädt Vorschläge bei Tippen von '/'.

export const STUDENT_COMMANDS = [
    {
        name: '/zusammenfassen',
        icon: 'summarize',
        badge: 'VORLAGE',
        category: 'student',
        placeholder: '<Thema oder Text>',
        desc: 'Kernaussagen strukturiert & kurz zusammenfassen',
        buildPrompt: (param) => param
            ? `Fasse das Folgende übersichtlich, verständlich und auf das Wesentliche konzentriert zusammen (Kernaussagen, Merksätze, kurze Stichpunkte):\n\n${param}`
            : 'Fasse den bisherigen Inhalt bzw. mein Thema übersichtlich mit den wichtigsten Kernaussagen und Merksätzen zusammen:\n\n'
    },
    {
        name: '/aufsatz',
        icon: 'article',
        badge: 'VORLAGE',
        category: 'student',
        placeholder: '<Thema / Textsorte>',
        desc: 'Gliederung + natürlicher Entwurf (Einleitung, Hauptteil, Schluss)',
        buildPrompt: (param) => param
            ? `Hilf mir bei einem Aufsatz zu „${param}“: Erstelle zuerst eine klare Gliederung (Einleitung, Hauptteil mit Argumenten/Belegen, Schluss) und danach einen natürlich formulierten, schülerfreundlichen Entwurf.`
            : 'Hilf mir bei einem Aufsatz. Erstelle zuerst eine klare Gliederung (Einleitung, Hauptteil, Schluss) und danach einen schülerfreundlichen Entwurf zum Thema:\n\n'
    },
    {
        name: '/erklaeren',
        icon: 'school',
        badge: 'VORLAGE',
        category: 'student',
        placeholder: '<Thema>',
        desc: 'Einfach erklären wie für die Schule + Alltagsbeispiel',
        buildPrompt: (param) => param
            ? `Erkläre mir „${param}“ Schritt für Schritt in einfacher, klarer Sprache – mit einem anschaulichen Alltagsbeispiel und einem kurzen Merksatz am Ende.`
            : 'Erkläre mir dieses Thema Schritt für Schritt einfach und verständlich mit einem Alltagsbeispiel:\n\n'
    },
    {
        name: '/karteikarten',
        icon: 'style',
        badge: 'VORLAGE',
        category: 'student',
        placeholder: '<Fach / Thema>',
        desc: 'Interaktive Lernkarten im Chat erstellen',
        buildPrompt: (param) => param
            ? `Erstelle mir 10 präzise Lern-Karteikarten zu „${param}“ direkt als interaktives <flashcards>-Element (Vorderseite :: Rückseite) mit kompakten Prüfungsfragen und klaren Antworten.`
            : 'Erstelle mir 10 Lern-Karteikarten direkt als interaktives <flashcards>-Element zu folgendem Thema:\n\n'
    },
    {
        name: '/quiz',
        icon: 'quiz',
        badge: 'VORLAGE',
        category: 'student',
        placeholder: '<Thema>',
        desc: 'Interaktives Übungsquiz mit Tipps & Erklärungen',
        buildPrompt: (param) => param
            ? `Erstelle ein interaktives <quiz>-Übungsquiz mit 5 abwechslungsreichen Fragen zu „${param}“ inklusive Hinweis (! ) und kurzer Erklärung (> ).`
            : 'Erstelle ein interaktives <quiz> mit 5 Fragen inklusive Hinweisen und Erklärungen zu:\n\n'
    },
    {
        name: '/referat',
        icon: 'slideshow',
        badge: 'VORLAGE',
        category: 'student',
        placeholder: '<Thema>',
        desc: 'Referat-Folien (Präsentation) + Handout-Stichpunkte',
        buildPrompt: (param) => param
            ? `Erstelle ein Referat zu „${param}“:\n1. Eine Präsentation als <artifact type="slides" title="${param.slice(0, 60)}"> mit 6–8 klaren Folien (getrennt durch ---, jede mit # Titel, Stichpunkten und Notizen: Sprechtext).\n2. Ein kurzes Quellen- und Stichpunkt-Handout darunter.`
            : 'Erstelle mir ein schulfertiges Referat mit <artifact type="slides"> Präsentationsfolien (6–8 Folien + Sprechnotizen) zum Thema:\n\n'
    },
    {
        name: '/heft',
        icon: 'stylus_note',
        badge: 'VORLAGE',
        category: 'student',
        placeholder: '<Aufgabe>',
        desc: 'Lösung ordentlich im Karo-Lernheft / Handschrift aufschreiben',
        action: 'open-heft',
        buildPrompt: (param) => param
            ? `Löse die folgende Aufgabe sauber Schritt für Schritt im Schulheft-Stil direkt als <handwriting paper="karo" title="Lösung">-Element (mit klaren Umformungen und ==grün:Endergebnis==):\n\n${param}`
            : 'Löse die Aufgabe sauber Schritt für Schritt als <handwriting paper="karo" title="Lösung">-Element:\n\n'
    },
    {
        name: '/browser',
        icon: 'travel_explore',
        badge: 'BROWSER',
        category: 'tool',
        placeholder: '<URL oder Suchbegriff, z. B. amazon.de Kopfhörer>',
        desc: 'Research-Browser rechts öffnen oder Webseite direkt abrufen',
        action: 'open-browser',
        buildPrompt: (param) => param
            ? `Öffne und untersuche im Research-Browser (<browser_open>): ${param}. Zeige danach eine übersichtliche Webseiten-Vorschau (<browser>) mit den wichtigsten Fakten, Preisen oder Links.`
            : ''
    },
    {
        name: '/humanisieren',
        icon: 'auto_fix_high',
        badge: 'WERKZEUG',
        category: 'tool',
        placeholder: '<optional: Text direkt einfügen>',
        desc: 'Text natürlich & schülerfreundlich umformulieren',
        action: 'open-humanizer',
        buildPrompt: (param) => param
            ? `Formuliere den folgenden Text mit dem Coden-Humanizer natürlich, aktiv und schülerfreundlich um (keine steifen KI-Floskeln):\n\n${param}`
            : ''
    },
    {
        name: '/zitate',
        icon: 'format_quote',
        badge: 'VORLAGE',
        category: 'student',
        placeholder: '<Quellen / Links / Titel>',
        desc: 'Sauberes Quellen- und Literaturverzeichnis formatieren',
        buildPrompt: (param) => param
            ? `Formatiere ein sauberes, schul- und facharbeitstaugliches Quellen- und Literaturverzeichnis (nach Schule/APA sortiert) aus diesen Angaben bzw. unseren bisherigen Quellen:\n\n${param}`
            : 'Formatiere ein sauberes, schul- und facharbeitstaugliches Quellen- und Literaturverzeichnis aus den bisherigen Chat-Quellen oder folgenden Angaben:\n\n'
    }
];

export const PUBLIC_COMMANDS = [
    ...STUDENT_COMMANDS,
    { name: '/chess', icon: 'chess', badge: 'SPIEL', category: 'tool', desc: 'Spiele eine Runde Schach gegen Coden!', action: 'chess' }
];

/**
 * Sucht passende Befehle für das '/' Popup-Menü.
 */
export function matchSlashCommands(rawInput, { skillHits = [], ownerCommands = [], isOwner = false } = {}) {
    const text = String(rawInput || '');
    if (!text.startsWith('/')) return { items: [], isCmdList: false };

    const parts = text.split(' ');
    const cmdSearch = parts[0].toLowerCase();
    const hasSpace = text.includes(' ');

    const allBase = [
        ...skillHits.map(s => ({ ...s, badge: 'SKILL', skill: true })),
        ...PUBLIC_COMMANDS,
        ...(isOwner ? ownerCommands.filter(c => c.name !== '/chess').map(c => ({ ...c, badge: 'OWNER', owner: true })) : [])
    ];

    if (!hasSpace) {
        const items = allBase.filter(c => c.name.toLowerCase().startsWith(cmdSearch));
        return { items, isCmdList: true };
    }

    if (isOwner) {
        const exactOwner = ownerCommands.find(c => c.name.toLowerCase() === cmdSearch);
        if (exactOwner && Array.isArray(exactOwner.opts)) {
            const optSearch = (parts[1] || '').toLowerCase();
            const fOpts = exactOwner.opts.filter(o => o.toLowerCase().startsWith(optSearch));
            if (fOpts.length) {
                return {
                    items: fOpts.map(opt => ({ name: `${exactOwner.name} ${opt}`, desc: 'Parameter', badge: 'OPTION' })),
                    isCmdList: false
                };
            }
        }
    }

    return { items: [], isCmdList: false };
}

/**
 * Prüft beim Absenden, ob ein Schüler-/Werkzeug-Slashbefehl vorliegt.
 * Gibt null zurück, wenn kein bekannter öffentlicher Slash-Befehl passt.
 */
export function resolvePublicSlash(rawText) {
    const trimmed = String(rawText || '').trim();
    if (!trimmed.startsWith('/')) return null;

    const sp = trimmed.search(/\s/);
    const cmd = (sp === -1 ? trimmed : trimmed.slice(0, sp)).toLowerCase();
    const param = sp === -1 ? '' : trimmed.slice(sp + 1).trim();

    const found = PUBLIC_COMMANDS.find(c => c.name === cmd);
    if (!found) return null;

    // Direkte Aktionsbefehle ohne Text-Eingabe öffnen das jeweilige Panel/Werkzeug sofort
    if (found.action === 'chess') return { kind: 'action', action: 'chess', param };
    if (found.action === 'open-humanizer' && !param) return { kind: 'action', action: 'open-humanizer', param: '' };
    if (found.action === 'open-browser') {
        if (!param) return { kind: 'action', action: 'open-browser', param: '' };
        // URL direkt im Split-Browser öffnen + KI optional fragen falls explizit Frage dabei steht
        const looksUrl = /^https?:\/\//i.test(param) || /^[a-z0-9-]+(\.[a-z]{2,})+/i.test(param.split(/\s+/)[0]);
        if (looksUrl && !/\s/.test(param)) {
            return { kind: 'action', action: 'open-browser', param };
        }
        return { kind: 'prompt', command: found, param, prompt: found.buildPrompt(param), openBrowserQuery: param };
    }
    if (found.action === 'open-heft' && !param) {
        return { kind: 'action', action: 'open-heft', param: '' };
    }

    return {
        kind: 'prompt',
        command: found,
        param,
        prompt: found.buildPrompt(param)
    };
}
