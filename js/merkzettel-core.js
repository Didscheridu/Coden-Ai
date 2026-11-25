// js/merkzettel-core.js – reine Funktionen für den Merkzettel (Prompt, Aufräumen, Titel, Papier); ohne DOM, damit testbar
// ---------- Prompt ----------
export function merkzettelPrompt({ src, subject = '', difficulty = 'mittel', amount = 'standard', focus = '' }) {
    const len = amount === 'weniger' ? 'knapp, ca. eine halbe Seite (4–6 Abschnitte mit wenigen Punkten)' : amount === 'mehr' ? 'ausführlich, ca. 2 Seiten' : 'ca. eine Seite';
    const sys = `Du schreibst einen MERKZETTEL so, wie ihn eine gute Schülerin oder ein guter Schüler selbst von Hand ins Heft schreibt, um für eine Arbeit zu lernen. Er darf auf KEINEN Fall nach KI aussehen.
SO SCHREIBEN SCHÜLER (Pflicht):
- Nur Stichpunkte, keine Absätze, keine ganzen Sätze, wo ein Stichwort reicht. Meist 2–9 Wörter pro Punkt.
- Zeichen und Abkürzungen wie im Heft: →, ⇒, ≈, =, ↑, ↓, +, z.B., bzw., d.h., ca., v.a., u.a., Bsp., ggf.
- Abschnitte unterschiedlich lang (mal 2, mal 5 Punkte) – nicht alles gleich gebaut, keine Dreierlisten aus Prinzip.
- Konkrete Fakten, Zahlen, Fachbegriffe, Formeln, typische Fehler. Nichts Allgemeines, nichts doppelt.
- VERBOTEN: Einleitung, Schlusswort, "Fazit", "Zusammenfassung", "Überblick", "Im Folgenden", "Es ist wichtig", "spielt eine entscheidende/zentrale Rolle", "Insgesamt", "Darüber hinaus", Emojis, Ausrufe, Doppelpunkt-Etiketten in Fett (**Wichtig:**), Fragen an den Leser.
FORMAT (genau so):
- Erste Zeile: "# Thema" (kurz, wie ein Schüler es überschreibt).
- Abschnitte: "## Stichwort" (1–4 Wörter, keine Nummerierung).
- Punkte: "- …", Unterpunkte: "  - …" (zwei Leerzeichen).
- Höchstens 2 Merke-Kästen: eine Zeile "> Merke: …" (der wichtigste Satz bzw. die wichtigste Regel).
- Beispiele als Punkt "- Bsp.: …". Formeln mit $…$ (LaTeX). Kleine Tabelle nur, wenn sie wirklich hilft.
- Textmarker sparsam (5–10 Mal, nur einzelne Wörter oder kurze Stücke): ==Schlüsselbegriff== (gelb), ==grün:Definition/Ergebnis==, ==blau:Formel/Name/Jahr==, ==rot:typischer Fehler/Achtung==. Rot unterstrichen wirkt: {{rot:nicht verwechseln}}.
- Bei Funktionen/Graphen in Mathe/Physik darfst du EINEN kleinen Graphen zeichnen: <plot x="-4..4">\\nf(x) = x^2 | blau\\n</plot>
Schreib korrekt (Rechtschreibung, Fakten). Antworte NUR mit dem Merkzettel.`;
    const user = `Fach: ${subject || 'allgemein'} · Niveau: ${difficulty} · Länge: ${len}.${focus ? `\nSchwerpunkt: ${focus}` : ''}\n\nLERNSTOFF:\n${src}`;
    return { sys, user };
}

// Typische KI-Spuren entfernen, falls das Modell sie trotzdem schreibt
export function cleanMerkzettel(text) {
    let t = String(text || '').replace(/^```(?:markdown|md)?\s*|```\s*$/gi, '').trim();
    t = t.replace(/\p{Extended_Pictographic}️?/gu, '');
    t = t.replace(/^#{1,3}\s*(Fazit|Zusammenfassung|Überblick|Einleitung|Schluss(wort)?)\s*$[\s\S]*?(?=^#{1,2}\s|(?![\s\S]))/gim, '');
    t = t.replace(/^(\s*[-*]\s*)\*\*([^*\n]{1,40}?):\*\*\s*/gm, '$1$2: ');
    t = t.replace(/^\s*(Hier ist|Gerne|Natürlich|Klar)[^\n]*\n/i, '');
    if (!/^#\s/m.test(t)) t = '# Merkzettel\n' + t;
    return t.replace(/\n{3,}/g, '\n\n').trim();
}
export const titleOf = (md) => (String(md).match(/^#\s+(.+)$/m) || [])[1]?.replace(/[=*_{}]/g, '').trim() || 'Merkzettel';

const MATHY = /mathe|physik|chemie|informatik|technik|wirtschaft|rechn/i;
export const defaultPaper = (subject) => (MATHY.test(subject || '') ? 'karo' : 'liniert');
