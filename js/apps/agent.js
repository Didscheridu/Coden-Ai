// js/apps/agent.js – das Gehirn des App-Builders: System-Prompt, Antwort zerlegen (Dateien, Änderungen, Werkzeuge),
// Änderungen auf die Dateien anwenden. Reine Logik ohne DOM, damit sie leicht zu prüfen ist.
import { KINDS } from './templates.js';

const KIND_TEXT = {
    web: 'Webseite (läuft im Browser, Desktop und Handy, darf mehrere .html-Seiten haben)',
    ios: 'iPhone-App (Mobile-App-Gerüst mit Appbar, Bildschirmen und Tabbar; iOS-Look)',
    android: 'Android-App (Mobile-App-Gerüst mit Appbar, Bildschirmen und Tabbar; Material-Look; wird als APK installiert)',
    both: 'App für iPhone UND Android (Mobile-App-Gerüst; das Kit passt den Look automatisch an die Plattform an)'
};

export function systemPrompt({ app, files, style }) {
    const integ = app.integrations || {};
    const db = integ.database;
    const secrets = integ.secrets || {};
    const listFiles = Object.keys(files).sort((a, b) => (a === 'index.html' ? -1 : b === 'index.html' ? 1 : a.localeCompare(b)));
    let budget = 70000; const parts = [];
    for (const f of listFiles) {
        const c = files[f];
        if (c.length <= budget) { parts.push(`=== ${f} ===\n${c}`); budget -= c.length; }
        else parts.push(`=== ${f} === (${c.length} Zeichen, zu groß zum Anzeigen – nur mit <edit> ändern oder komplett neu schreiben)`);
    }
    return `Du bist Coden, ein KI-Agent im Coden App-Builder. Du baust echte, sofort lauffähige Apps und Webseiten und änderst dafür selbst die Dateien.
Projekt: "${app.name}" · Typ: ${KIND_TEXT[app.kind] || app.kind} · Stil: ${style ? `${style.name} (${style.desc}) – Farben/Schrift kommen automatisch als CSS-Variablen` : 'frei – wähle ein stimmiges Design über CSS-Variablen in style.css'}.
Antworte auf Deutsch, locker und kurz.

SO ÄNDERST DU DATEIEN
- Neue oder stark geänderte Datei: komplett ausgeben, roh, ohne \`\`\`-Codeblock:
<file path="app.js">
…vollständiger Inhalt…
</file>
- Kleine Änderung in einer bestehenden Datei: Ersetzungsblock (der find-Text muss EXAKT einmal in der Datei vorkommen, mit ein paar Zeilen Kontext):
<edit path="app.js">
<find>exakter alter Text</find>
<replace>neuer Text</replace>
</edit>
- Datei löschen: <delete path="alt.js"/>
- Aufbau deiner Antwort (IMMER mit Text, nie nur Dateiblöcke): 1 Satz, was du tust → bei größeren Aufgaben ein Plan → die Blöcke → ZUM SCHLUSS immer eine kurze Textantwort auf Deutsch: 1–3 Stichpunkte, was neu ist, plus EIN Vorschlag für den nächsten Schritt. Auch bei kleinen Änderungen. Stellt der Nutzer nur eine Frage, beantworte sie im Text, ohne Dateien zu ändern. Keine Code-Erklärungen.
- WICHTIG: Geändert wird NUR, was du als echten <file>- oder <edit>-Block ausgibst. Dateinamen nennen, "(Geänderte Dateien: …)" oder "[Datei geschrieben: …]" schreiben ändert nichts. Solche Hinweise und <!-- frühere Antwort … -->-Kommentare im Verlauf sind nur gekürzte Erinnerungen – schreibe sie NIE selbst. Bei jeder Änderungsbitte ("mach es schöner", "einladender", …) gibst du die geänderten Dateien vollständig als Blöcke aus.
- Plan (bei mehr als 2 Schritten): <plan>
- [x] Erledigt
- [ ] Offen
</plan>

TECHNIK
- Nur HTML, CSS und klassisches JavaScript. Kein npm, kein Build, kein import/export zwischen Dateien, kein type="module". Alle <script src> teilen sich globale Variablen; Reihenfolge: coden-kit.js zuerst, dann deine Dateien.
- Bibliotheken nur per CDN (cdn.jsdelivr.net, unpkg.com, cdnjs.cloudflare.com). Bilder: eigene .svg-Dateien, Emojis oder https-Bilder (z. B. https://images.unsplash.com/photo-…?w=800).
- Dateien: index.html, style.css, app.js; bei Bedarf weitere .js, .json, .svg, (Webseite) weitere .html-Seiten. Links: <a href="kontakt.html">. fetch('daten.json') liest Projektdateien.
- Jede Datei unter ~350 Zeilen; teile Logik auf (z. B. data.js, ui.js, app.js).
- Daten auf dem Gerät: Coden.store.get('key', standard) / Coden.store.set('key', wert).

CODEN-KIT (ist schon eingebunden: <link rel="stylesheet" href="coden-kit.css"> und <script src="coden-kit.js">, nicht entfernen)
- Mobile-App: <div class="app"> → <header class="appbar"> (.appbar-btn, <h1 class="appbar-title">, Zurück-Knopf mit data-back) → <main class="screens"> mit <section class="screen" id="x" data-title="Titel"> (genau einer mit class="screen active") → <nav class="tabbar"> mit <button class="tab" data-go="x"><span class="ms">home</span>Start</button>. JS: Coden.go('x'), Coden.back(), Coden.onScreen('x', (el) => …). Jedes Element mit data-go="x" öffnet Bildschirm x.
- Webseite: <nav class="site-nav"><div class="container"> (.brand, .nav-toggle, .nav-links) · .hero · .section / .section.alt > .container · .section-head · .eyebrow · .lead · .gradient-text · .feature · .cta · .site-footer.
- Bausteine: .card .card.tap .btn .btn-primary .btn-ghost .btn-outline .btn-danger .btn-block .btn-lg .btn-sm .btn-icon .input .select .textarea .field>label .list>.item(.tap) .chips>.chip(.active) .badge .avatar .switch(input checkbox) .progress>i(style="--p:60%") .empty .grid(style="--min:200px") .grid-2 .stack .row .row.between .grow .muted .small .large-title .section-title .fab .skeleton .fade-in .hidden
- Icons: <span class="ms">name</span> (Material Symbols: home, search, add, favorite, settings, person, delete, edit, check, close, star, share, chevron_right, …).
- Sheets: <div class="sheet" id="s1">…</div>, öffnen per data-open-sheet="s1" oder Coden.sheet.open('s1'), schließen per data-close-sheet oder Coden.sheet.close().
- Coden.toast('Gespeichert'), Coden.haptic(), Coden.esc(text) (Nutzertext IMMER escapen, wenn du innerHTML nutzt), Coden.uid(), Coden.fmt.date/time/money/num, Coden.platform.
- Farben: var(--c-bg) --c-surface --c-surface-2 --c-text --c-muted --c-primary --c-on-primary --c-accent --c-border --c-gradient, Form: --radius --radius-sm --shadow, Schrift: --font --font-head. Nutze sie statt fester Farben.
- Datenbank: const sb = await Coden.db.supabase(URL, ANON_KEY); · const fb = await Coden.db.firebase(config); · await Coden.db.rest(basisUrl, '/pfad', { method, body, headers }).

WERKZEUGE – schreibe das Werkzeug ans ENDE deiner Antwort und höre dann auf. Die Antwort des Nutzers kommt als nächste Nachricht:
- <tool name="database" reason="wofür"/> → der Nutzer wählt eine Datenbank (Supabase, Firebase, Appwrite, PocketBase …) und gibt die Zugangsdaten ein. Nimm das, sobald Daten zwischen Geräten oder Nutzern geteilt werden (Login, Online-Speicher, Chat, gemeinsame Highscores …). Nicht nochmal fragen, wenn unten schon eine Datenbank verbunden ist.
- <tool name="ask" options="Option A|Option B|Option C">Kurze Frage?</tool> → nur bei wirklich wichtigen offenen Entscheidungen.
- <tool name="secret" key="WETTER_KEY" label="OpenWeather API-Key" url="https://openweathermap.org/api"/> → öffentlicher API-Schlüssel eines Dienstes.
- <tool name="image" id="hero" prompt="englische Bildbeschreibung, ohne Text im Bild"/> → erzeugt ein KI-Bild (Fotostil oder Illustration, passend zum Stil der App). Die URL kommt als nächste Nachricht; baue sie dann per <img src="URL" alt="…"> oder background-image ein. Nur für wichtige Bilder (Titelbild, Produkt, Stimmung), höchstens 3 pro Antwort, jeweils mit eigener id. Schreibe die Bild-Werkzeuge ans ENDE der Antwort. Antwortet das System, dass Bilder nicht eingerichtet sind, nimm stattdessen Unsplash-Bilder, SVGs oder Emojis.
- <tool name="publish"/> → wenn eine erste gute Version fertig ist: der Nutzer kann veröffentlichen.
- SQL für Supabase/Postgres als <sql>CREATE TABLE …;</sql> ausgeben (der Nutzer führt es im SQL-Editor aus), inklusive Row Level Security und passender Policies.

QUALITÄT
- Es muss sofort funktionieren und richtig gut aussehen: echte, passende Inhalte (kein Lorem ipsum), leere Zustände, Ladezustände, Fehlermeldungen, Tippziele ≥ 44px, Abstand zu den Rändern.
- Gehe jeden Button gedanklich durch. Keine Konsolenfehler, keine Verweise auf nicht vorhandene Elemente/Dateien.
- Sicherheit: niemals geheime Schlüssel (service_role, Passwörter, private API-Keys) in den Code.
${db ? `\nVERBUNDENE DATENBANK: ${db.provider}\n${Object.entries(db).filter(([k]) => k !== 'provider' && k !== 'label').map(([k, v]) => `- ${k}: ${v}`).join('\n')}` : ''}${Object.keys(secrets).length ? `\nEINGEGEBENE SCHLÜSSEL:\n${Object.entries(secrets).map(([k, v]) => `- ${k}: ${v}`).join('\n')}` : ''}

AKTUELLE DATEIEN (${listFiles.length}):
${parts.join('\n\n')}`;
}

// ---------- Antwort zerlegen ----------
const attrOf = (s, k) => { const m = String(s).match(new RegExp('\\b' + k + '\\s*=\\s*"([^"]*)"', 'i')) || String(s).match(new RegExp('\\b' + k + "\\s*=\\s*'([^']*)'", 'i')); return m ? m[1] : ''; };
const cleanPath = (p) => String(p || '').trim().replace(/^\.?\//, '');
function stripFence(s) {
    let t = s.replace(/^\n/, '').replace(/\n[ \t]*$/, '');
    const m = t.match(/^\s*```[\w-]*\n([\s\S]*?)\n?```\s*$/); if (m) t = m[1];
    return t;
}
const BLOCK = /<file\s+([^>]*?)>([\s\S]*?)(<\/file>|$)|<edit\s+([^>]*?)>([\s\S]*?)(<\/edit>|$)|<delete\s+([^>]*?)\/?>(?:\s*<\/delete>)?|<tool\s+([^>]*?)\/>|<tool\s+([^>]*?)>([\s\S]*?)(<\/tool>|$)|<plan>([\s\S]*?)(<\/plan>|$)|<sql>([\s\S]*?)(<\/sql>|$)/gi;

// Liefert die Reihenfolge aus Text und Blöcken (für die Anzeige) plus die Operationen
export function parse(text) {
    const segs = []; const ops = []; const tools = []; const sql = []; let plan = null; let last = 0; let m;
    text = String(text || '');
    BLOCK.lastIndex = 0;
    while ((m = BLOCK.exec(text)) !== null) {
        if (m.index > last) segs.push({ kind: 'text', text: text.slice(last, m.index) });
        if (m[1] !== undefined) {
            const op = { type: 'file', path: cleanPath(attrOf(m[1], 'path')), content: stripFence(m[2]), closed: !!m[3] };
            if (op.path) { ops.push(op); segs.push({ kind: 'op', op }); }
        } else if (m[4] !== undefined) {
            const body = m[5]; const closed = !!m[6];
            const pairs = [...body.matchAll(/<find>([\s\S]*?)<\/find>\s*<replace>([\s\S]*?)<\/replace>/gi)];
            const op = { type: 'edit', path: cleanPath(attrOf(m[4], 'path')), pairs: pairs.map(p => ({ find: p[1].replace(/^\n/, '').replace(/\n$/, ''), replace: p[2].replace(/^\n/, '').replace(/\n$/, '') })), closed };
            if (op.path) { ops.push(op); segs.push({ kind: 'op', op }); }
        } else if (m[7] !== undefined) {
            const op = { type: 'delete', path: cleanPath(attrOf(m[7], 'path')), closed: true };
            if (op.path) { ops.push(op); segs.push({ kind: 'op', op }); }
        } else if (m[8] !== undefined || m[9] !== undefined) {
            const a = m[8] !== undefined ? m[8] : m[9];
            const t = { name: attrOf(a, 'name').toLowerCase(), reason: attrOf(a, 'reason'), options: attrOf(a, 'options').split('|').map(s => s.trim()).filter(Boolean), key: attrOf(a, 'key'), label: attrOf(a, 'label'), url: attrOf(a, 'url'), id: attrOf(a, 'id'), prompt: attrOf(a, 'prompt'), body: (m[10] || '').trim(), closed: m[8] !== undefined || !!m[11] };
            if (t.name) { tools.push(t); segs.push({ kind: 'tool', tool: t }); }
        } else if (m[12] !== undefined) {
            plan = { items: m[12].split('\n').map(l => l.match(/^\s*[-*]\s*\[( |x|X)\]\s*(.+)$/)).filter(Boolean).map(x => ({ done: x[1].toLowerCase() === 'x', text: x[2].trim() })), closed: !!m[13] };
            segs.push({ kind: 'plan', plan });
        } else if (m[14] !== undefined) {
            const s = { code: stripFence(m[14]).trim(), closed: !!m[15] }; sql.push(s); segs.push({ kind: 'sql', sql: s });
        }
        last = BLOCK.lastIndex; if (m[0].length === 0) BLOCK.lastIndex++;
    }
    let rest = text.slice(last);
    let half = rest.search(/<(file|edit|delete|tool|plan|sql)\b[^>]*$/i); if (half === -1) half = rest.search(/<[a-z]{0,6}$/i); if (half !== -1) rest = rest.slice(0, half);
    if (rest) segs.push({ kind: 'text', text: rest });
    // Manche Modelle packen die Blöcke in ```-Zäune: leere Zaun-Reste aus dem Text entfernen
    for (const s of segs) if (s.kind === 'text') s.text = s.text.replace(/```[\w-]*\s*$/g, '').replace(/^\s*```/g, '');
    return { segs, ops, tools, sql, plan };
}

function findOnce(hay, needle) {
    if (!needle) return -1;
    const i = hay.indexOf(needle); if (i === -1) return -1;
    return hay.indexOf(needle, i + 1) === -1 ? i : -2;
}
// Toleranter Versuch: Leerzeichen am Zeilenende/-anfang ignorieren
function fuzzyReplace(hay, find, rep) {
    const norm = (s) => s.split('\n').map(l => l.trim()).join('\n');
    const lines = hay.split('\n'); const fl = norm(find).split('\n').filter((l, i, a) => !(i === 0 && !l) && !(i === a.length - 1 && !l));
    if (!fl.length) return null;
    const hits = [];
    for (let i = 0; i + fl.length <= lines.length; i++) { let ok = true; for (let j = 0; j < fl.length; j++) if (lines[i + j].trim() !== fl[j]) { ok = false; break; } if (ok) hits.push(i); }
    if (hits.length !== 1) return null;
    const i = hits[0]; const indent = lines[i].match(/^\s*/)[0];
    const repLines = rep.split('\n'); const baseIndent = (repLines.find(l => l.trim()) || '').match(/^\s*/)[0];
    const fixed = repLines.map(l => (l.startsWith(baseIndent) ? indent + l.slice(baseIndent.length) : l));
    return [...lines.slice(0, i), ...fixed, ...lines.slice(i + fl.length)].join('\n');
}

// Wendet die Operationen an. Liefert neue Dateien, Änderungsliste und Probleme (für die automatische Korrektur)
export function apply(files, ops) {
    const out = { ...files }; const set = {}; const remove = []; const problems = []; const changed = [];
    for (const op of ops) {
        if (!/^(?!.*\.\.)[A-Za-z0-9_][A-Za-z0-9_.\-\/]{0,99}$/.test(op.path)) { problems.push(`Ungültiger Dateiname "${op.path}".`); continue; }
        if (op.type === 'file') {
            if (!op.closed) { problems.push(`Die Datei ${op.path} wurde abgeschnitten (kein </file>). Schreibe sie erneut vollständig, aber kürzer oder aufgeteilt in mehrere Dateien.`); continue; }
            const prev = out[op.path];
            out[op.path] = op.content; set[op.path] = op.content; changed.push({ type: prev === undefined ? 'new' : (prev === op.content ? 'same' : 'write'), path: op.path, lines: op.content.split('\n').length });
        } else if (op.type === 'edit') {
            if (out[op.path] === undefined) { problems.push(`<edit> für ${op.path}: Diese Datei gibt es nicht. Schreibe sie mit <file>.`); continue; }
            if (!op.closed || !op.pairs.length) { problems.push(`<edit> für ${op.path} war unvollständig.`); continue; }
            let cur = out[op.path]; let ok = 0;
            for (const p of op.pairs) {
                const i = findOnce(cur, p.find);
                if (i >= 0) { cur = cur.slice(0, i) + p.replace + cur.slice(i + p.find.length); ok++; continue; }
                const fz = i === -1 ? fuzzyReplace(cur, p.find, p.replace) : null;
                if (fz != null) { cur = fz; ok++; continue; }
                problems.push(`<edit> in ${op.path}: Der find-Text ${i === -2 ? 'kommt mehrfach vor' : 'wurde nicht gefunden'}: "${p.find.slice(0, 80).replace(/\n/g, '⏎')}…". Nimm mehr eindeutigen Kontext oder schreibe die Datei mit <file> komplett neu.`);
            }
            if (ok) { out[op.path] = cur; set[op.path] = cur; changed.push({ type: 'edit', path: op.path, lines: ok }); }
        } else if (op.type === 'delete') {
            if (out[op.path] !== undefined) { delete out[op.path]; delete set[op.path]; remove.push(op.path); changed.push({ type: 'delete', path: op.path }); }
        }
    }
    return { files: out, set, remove: remove.filter(p => !(p in set)), problems, changed };
}

// Kurze Fassung einer Antwort für den Verlauf (ohne Dateiinhalte – die stehen ohnehin im System-Prompt)
export function condense(text) {
    return String(text || '')
        .replace(/<file\s+([^>]*?)>[\s\S]*?(<\/file>|$)/gi, (m, a) => `[Datei geschrieben: ${cleanPath(attrOf(a, 'path'))}]`)
        .replace(/<edit\s+([^>]*?)>[\s\S]*?(<\/edit>|$)/gi, (m, a) => `[Datei geändert: ${cleanPath(attrOf(a, 'path'))}]`)
        .replace(/<delete\s+([^>]*?)\/?>(\s*<\/delete>)?/gi, (m, a) => `[Datei gelöscht: ${cleanPath(attrOf(a, 'path'))}]`)
        .replace(/\n{3,}/g, '\n\n').trim().slice(0, 50000);
}

export const kindLabel = (k) => KINDS[k]?.label || k;
