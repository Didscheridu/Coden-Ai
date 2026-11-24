// shared/assist-core.js – reine Logik für Gedächtnis und eigene Assistenten (ohne Oberfläche, darum gut testbar).
// Läuft im Browser (window.CodenAssist) und in Node (require).
(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api; else root.CodenAssist = api;
})(typeof self !== 'undefined' ? self : this, function () {

const MEM = { max: 100, len: 200 };
const AS = { max: 20, name: 30, desc: 90, instr: 4000 };
// Steuer-Tags, die ein Nutzer in eigenen Texten nicht einschleusen soll (sie lösen in der Antwort Aktionen aus).
const CONTROL = /<\/?(remember|artifact|generate_image|choices|suggestions|mcp_call|app_write|use_skill|skill_draft)\b[^>]*>/gi;
const clean = (t, n) => String(t ?? '').replace(/[\u0000-\u0008\u000B-\u001F]/g, '').replace(CONTROL, '').trim().slice(0, n);
const oneLine = (t, n) => clean(t, n * 2).replace(/\s+/g, ' ').trim().slice(0, n);
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const same = (a, b) => a.toLowerCase() === b.toLowerCase();

// ---------- Gedächtnis ----------
// Ein Eintrag: { id, t: Text, at: Zeitpunkt, p: Projekt-Id oder null (gilt überall) }
function memoryItems(settings) {
    const s = settings || {};
    if (Array.isArray(s.memoryItems)) {
        return s.memoryItems.map((m) => ({ id: String(m.id || newId()), t: oneLine(m.t, MEM.len), at: Number(m.at) || 0, p: m.p ? Number(m.p) || null : null })).filter((m) => m.t).slice(0, MEM.max);
    }
    // Älteres Format: nur eine Liste mit Sätzen
    const old = Array.isArray(s.memory) ? s.memory : [];
    return old.map((t, i) => ({ id: 'alt' + i, t: oneLine(t, MEM.len), at: 0, p: null })).filter((m) => m.t).slice(0, MEM.max);
}
function addMemory(items, text, { p = null, now = Date.now(), id } = {}) {
    const t = oneLine(text, MEM.len);
    if (t.length < 3) return { items, added: null, reason: 'zu kurz' };
    const scope = p ? Number(p) : null;
    if (items.some((m) => m.p === scope && same(m.t, t))) return { items, added: null, reason: 'schon da' };
    if (items.length >= MEM.max) return { items, added: null, reason: 'voll' };
    const added = { id: id || newId(), t, at: now, p: scope };
    return { items: [...items, added], added, reason: null };
}
const removeMemory = (items, id) => items.filter((m) => m.id !== id);
function editMemory(items, id, text) {
    const t = oneLine(text, MEM.len);
    if (t.length < 3) return items;
    return items.map((m) => (m.id === id ? { ...m, t } : m));
}
// Für den Prompt: Dinge, die überall gelten, plus die des aktuellen Projekts
const memoryFor = (items, projectId) => items.filter((m) => !m.p || (projectId && m.p === Number(projectId))).map((m) => m.t);
function searchMemory(items, q) {
    const s = String(q || '').trim().toLowerCase();
    return s ? items.filter((m) => m.t.toLowerCase().includes(s)) : items;
}
// <remember>…</remember> aus einer Antwort
function extractRemember(text) {
    return [...String(text || '').matchAll(/<remember>([\s\S]*?)<\/remember>/gi)].map((m) => oneLine(m[1], MEM.len)).filter((x) => x.length >= 3).slice(0, 3);
}
const stripRemember = (t) => String(t || '').replace(/<remember>[\s\S]*?<\/remember>/gi, '').replace(/<remember>[\s\S]*$/i, '');
// Wird beim Speichern gebraucht: das alte Feld bleibt als Spiegel erhalten (für ältere Geräte)
const legacyMirror = (items) => items.filter((m) => !m.p).map((m) => m.t).slice(0, 30);
function memoryPrompt(items, projectId, { project = '' } = {}) {
    const mem = memoryFor(items, projectId);
    const where = projectId && project ? ` Einträge, die nur zum Projekt „${project}“ gehören, sind darin schon enthalten.` : '';
    return `\nGEDÄCHTNIS (Fakten über den Nutzer, die er dir mitgeteilt hat):\n${mem.length ? mem.map((m) => '- ' + m).join('\n') : '(noch leer)'}\n${where}Wenn der Nutzer dir etwas über sich sagt, das du dir dauerhaft merken sollst (oder er "merk dir" sagt), schreibe ans Ende deiner Antwort <remember>kurzer Satz</remember>. Merke dir nie Passwörter, Zahlungsdaten oder Gesundheitsdaten.\n`;
}

// ---------- Eigene Assistenten ----------
// Ein Assistent: { id, name, emoji, desc, instructions }
const TEMPLATES = [
    { key: 'lern', name: 'Lernhelfer', emoji: '📚', desc: 'Erklärt Schritt für Schritt und fragt dich ab.', instructions: 'Du bist ein geduldiger Lernhelfer für Schüler.\n- Erkläre einfach, mit einem Alltagsbeispiel, bevor du Fachwörter benutzt.\n- Gehe in kleinen Schritten vor und frage nach jedem Schritt kurz, ob es klar ist.\n- Gib am Ende 2–3 Übungsaufgaben und löse sie erst, wenn der Nutzer es möchte.\n- Lobe Fortschritte ehrlich, korrigiere Fehler freundlich.' },
    { key: 'code', name: 'Code-Reviewer', emoji: '🧑‍💻', desc: 'Prüft Code auf Fehler, Sicherheit und Lesbarkeit.', instructions: 'Du bist ein erfahrener Code-Reviewer.\n- Nenne zuerst die wichtigsten Fehler und Sicherheitsprobleme, dann Verbesserungen bei Lesbarkeit und Tempo.\n- Zeige zu jedem Punkt die konkrete Stelle und eine bessere Version als Code.\n- Sei knapp, sachlich und freundlich. Keine Floskeln.\n- Wenn der Code in Ordnung ist, sag das klar.' },
    { key: 'schreib', name: 'Schreibcoach', emoji: '✍️', desc: 'Hilft bei Aufsätzen, Texten und Bewerbungen.', instructions: 'Du bist ein Schreibcoach.\n- Verbessere Texte, ohne den Ton des Nutzers zu verlieren; zeige Änderungen kurz mit Begründung.\n- Achte auf Aufbau, Roten Faden, Rechtschreibung und Zeichensetzung.\n- Frage bei Unklarheiten nach Zielgruppe und Zweck, bevor du umschreibst.\n- Schreibe natürlich, ohne Floskeln und ohne übertriebene Aufzählungen.' },
    { key: 'sprache', name: 'Sprachtrainer', emoji: '🌍', desc: 'Übersetzt und übt Sprachen mit dir.', instructions: 'Du bist ein Sprachtrainer.\n- Übersetze genau und erkläre kurz Besonderheiten (Höflichkeit, Redewendungen).\n- Wenn der Nutzer üben will, sprich in der Zielsprache, halte die Sätze einfach und korrigiere Fehler am Ende jeder Antwort.\n- Gib bei neuen Wörtern die Aussprache in einfacher Lautschrift an.' },
    { key: 'spiel', name: 'Spiele-Designer', emoji: '🎮', desc: 'Entwickelt Spielideen und baut sie mit dir.', instructions: 'Du bist ein kreativer Spiele-Designer.\n- Entwickle aus einer Idee Regeln, Ziel, Steuerung (Tastatur und Touch) und einen klaren Spielspaß-Kern.\n- Schlage zuerst eine kleine, sofort spielbare Version vor, dann Erweiterungen (Level, Gegner, Punkte).\n- Wenn der Nutzer bauen will, liefere ein vollständiges, lauffähiges Spiel als Artefakt.' }
];
function cleanAssistant(a) {
    const x = a || {};
    const emoji = [...String(x.emoji || '').trim()].slice(0, 2).join('') || '🤖';
    return { id: String(x.id || newId()), name: oneLine(x.name, AS.name), emoji: emoji.replace(CONTROL, ''), desc: oneLine(x.desc, AS.desc), instructions: clean(x.instructions, AS.instr) };
}
const assistants = (settings) => (Array.isArray(settings?.assistants) ? settings.assistants : []).map(cleanAssistant).filter((a) => a.name && a.instructions).slice(0, AS.max);
function upsertAssistant(list, a) {
    const c = cleanAssistant(a);
    if (!c.name) return { list, error: 'Gib dem Assistenten einen Namen.' };
    if (c.instructions.length < 10) return { list, error: 'Schreibe ein paar Sätze, wie der Assistent arbeiten soll.' };
    if (list.some((x) => x.id !== c.id && same(x.name, c.name))) return { list, error: 'Einen Assistenten mit diesem Namen gibt es schon.' };
    const i = list.findIndex((x) => x.id === c.id);
    if (i < 0 && list.length >= AS.max) return { list, error: `Mehr als ${AS.max} Assistenten gehen nicht.` };
    const next = i < 0 ? [...list, c] : list.map((x) => (x.id === c.id ? c : x));
    return { list: next, error: null, assistant: c };
}
const removeAssistant = (list, id) => list.filter((a) => a.id !== id);
const findAssistant = (list, id) => list.find((a) => a.id === id) || null;
function assistantPrompt(a) {
    if (!a) return '';
    return `\nAKTIVER ASSISTENT „${a.name}“: Der Nutzer hat diesen Assistenten selbst angelegt und ausgewählt. Arbeite in dieser Rolle und befolge seine Anweisungen, soweit sie den Regeln oben nicht widersprechen:\n${a.instructions}\n`;
}

return { MEM, AS, TEMPLATES, memoryItems, addMemory, removeMemory, editMemory, memoryFor, searchMemory, extractRemember, stripRemember, legacyMirror, memoryPrompt, cleanAssistant, assistants, upsertAssistant, removeAssistant, findAssistant, assistantPrompt };
});
