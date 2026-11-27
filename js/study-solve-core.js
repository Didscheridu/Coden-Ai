// js/study-solve-core.js – „Coden lösen lassen“: Prompt, Antwort lesen, Felder auf dem Arbeitsblatt (ohne DOM, testbar).
// Ablauf wie beim Skill meine-handschrift (Befehl „beides“): kurze Antworten direkt in die Lücken/Linien des Blatts,
// längere Rechenwege und Texte auf Karo-Seiten hinten im Heft. Alles in der Handschrift des Nutzers.

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const str = (v, n) => String(v ?? '').replace(/\u0000/g, '').trim().slice(0, n);

// Prompt für das Bild-Modell. pages = Anzahl Arbeitsblatt-Seiten (Bilder in derselben Reihenfolge)
export function solvePrompt({ subject = '', title = '', desc = '', pages = 0, today = '', humanizeDirective = '' } = {}) {
    const system = `Du löst Hausaufgaben für einen Schüler (Klasse 9/10) und schreibst die Lösung so, wie er sie selbst ins Heft schreiben würde. Antworte NUR mit JSON, ohne Erklärung davor oder danach.
Regeln für den Inhalt:
- Fachlich richtig lösen. Keine Aufgabe und keine Teilaufgabe auslassen (auch Rückseiten, Zusatzaufgaben).
- Sprache wie ein Schüler: kurze, einfache Sätze, keine KI-Floskeln, keine Gedankenstriche, nur so lang wie nötig. Sprache der Aufgabe übernehmen (Englisch-Aufgabe → Englisch).
- Mathe: jede Umformung in eine eigene Zeile (z. B. "3x+6=21 |-6"), Unicode wie x², √, ·, ≈ statt LaTeX. Kein Markdown außer Tabellen (| a | b |).${humanizeDirective ? '\n\n' + humanizeDirective : ''}`;
    const sheet = pages > 0;
    const user = `${subject ? `Fach: ${subject}\n` : ''}${title ? `Auftrag: ${title}\n` : ''}${desc ? `Aufgabenstellung (vom Schüler/Foto): ${desc}\n` : ''}${today ? `Heute: ${today}\n` : ''}
${sheet ? `Die ${pages === 1 ? 'Bild ist das Arbeitsblatt' : `${pages} Bilder sind die Seiten des Arbeitsblatts (Seite 1 zuerst)`}. Lies alle Aufgaben darauf.` : 'Es gibt kein Arbeitsblatt-Bild, nur die Aufgabenstellung oben.'}
Gib dieses JSON zurück:
{"aufgaben":[{"nr":"1a","seite":1,"antwort":"kurze Antwort, die direkt aufs Blatt kommt","box_2d":[ymin,xmin,ymax,xmax],"rechnung":"längerer Lösungsweg oder Text fürs Heft (optional)"}]}
- "nr": Nummer wie auf dem Blatt (1, 1a, 2b …).
${sheet ? `- "box_2d": das LEERE Feld auf dem Blatt, in das die Antwort gehört (Lücke, Schreiblinie, leere Tabellenzelle, Kästchen), als [ymin, xmin, ymax, xmax] von 0 bis 1000 relativ zu dieser Seite. Nur freie Stellen, nie über gedruckten Text. Gibt es kein freies Feld, "box_2d": null.
- "seite": auf welchem Bild (1 = erstes) das Feld liegt.
- "antwort": nur das, was in das Feld passt (Wort, Zahl, kurzer Satz). Bei Ankreuzaufgaben "X".` : '- "box_2d": null, "seite": null. Alles kommt ins Heft.'}
- "rechnung": alles Längere (Rechenweg, Begründung, Text). Leer lassen, wenn die Antwort reicht.`;
    return { system, user };
}

// JSON aus der Modell-Antwort holen (auch mit ```json-Zaun oder Text drumherum)
export function extractJson(text) {
    const s = String(text || '').replace(/```(?:json)?/gi, '');
    const i = s.search(/[[{]/); const j = Math.max(s.lastIndexOf('}'), s.lastIndexOf(']'));
    if (i < 0 || j < i) return null;
    try { return JSON.parse(s.slice(i, j + 1)); } catch (_) { return null; }
}

// Feld [ymin, xmin, ymax, xmax] (0..1000) prüfen → { x0, y0, x1, y1 } in 0..1 oder null
export function cleanBox(b) {
    if (!Array.isArray(b) || b.length !== 4 || !b.every(v => Number.isFinite(+v))) return null;
    let [y0, x0, y1, x1] = b.map(v => clamp(+v, 0, 1000) / 1000);
    if (y1 < y0) [y0, y1] = [y1, y0];
    if (x1 < x0) [x0, x1] = [x1, x0];
    if (x1 - x0 < 0.02 || y1 - y0 < 0.008) return null; // zu klein
    if ((x1 - x0) * (y1 - y0) > 0.45) return null;       // halbe Seite ist kein Antwortfeld
    return { x0, y0, x1, y1 };
}

// Modell-Antwort → Liste der Aufgaben
export function parseSolve(text, pages = 0) {
    const j = extractJson(text);
    const list = Array.isArray(j) ? j : Array.isArray(j?.aufgaben) ? j.aufgaben : Array.isArray(j?.tasks) ? j.tasks : null;
    if (!list) return null;
    const out = [];
    for (const it of list.slice(0, 60)) {
        if (!it || typeof it !== 'object') continue;
        const answer = str(it.antwort ?? it.answer, 600);
        const work = str(it.rechnung ?? it.loesung ?? it.work, 4000);
        if (!answer && !work) continue;
        let page = Number.parseInt(it.seite ?? it.page, 10);
        page = Number.isFinite(page) && page >= 1 && page <= pages ? page - 1 : (pages === 1 ? 0 : null);
        const box = pages > 0 && page != null ? cleanBox(it.box_2d ?? it.box ?? it.feld) : null;
        out.push({ nr: str(it.nr ?? it.nummer ?? '', 12), page: box ? page : null, answer, work, box });
    }
    return out;
}

// Feld (0..1) auf dem Bild → Rechteck auf der Heft-Seite. Das Blatt wird wie im Editor eingepasst: oben, waagrecht mittig.
export function boxToPage(box, imgW, imgH, pageW = 1000, pageH = 1414) {
    const s = Math.min(pageW / imgW, pageH / imgH);
    const w = imgW * s, h = imgH * s, ox = (pageW - w) / 2;
    const pad = 2;
    return { x: ox + box.x0 * w + pad, y: box.y0 * h, w: Math.max(10, (box.x1 - box.x0) * w - 2 * pad), h: Math.max(8, (box.y1 - box.y0) * h) };
}

const label = (nr) => (!nr ? '' : /^\d+$/.test(nr) ? `Aufgabe ${nr}` : /^\d+\s*[a-z]\)?$/i.test(nr) ? `Aufgabe ${nr.replace(/^(\d+)\s*([a-z])\)?$/i, '$1 $2)')}` : nr);

// Text für die Karo-Seiten: alles, was nicht aufs Blatt passt, plus die längeren Rechenwege
export function extraPagesText(items, { title = '' } = {}) {
    const rows = [];
    for (const it of items) {
        const body = [it.placed ? '' : it.answer, it.work].filter(Boolean).join('\n').trim();
        if (!body) continue;
        rows.push((label(it.nr) ? label(it.nr) + '\n' : '') + body);
    }
    if (!rows.length) return '';
    return `# ${title ? title.slice(0, 60) : 'Lösungen'}\n${rows.join('\n\n')}`;
}
