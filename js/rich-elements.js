// js/rich-elements.js – reichere Antworten im Chat:
// 1) Markieren und Einfärben einzelner Wörter/Abschnitte:  ==wichtig==  ==grün:richtig==  {{rot:Achtung}}
// 2) Interaktive Elemente (Blöcke im Text): <quiz>, <flashcards>, <steps>, <stats>, <proscons>, <bars>, <tabs>
// 3) Eine einheitliche Lade-Animation für ganz Coden (Logo mit rotierendem Ring), siehe loader()
// Die Parser sind reine Funktionen (ohne DOM) und werden in test/rich-elements.test.js geprüft.

// ---------- Farben ----------
export const COLORS = {
    rot: 'red', red: 'red', grün: 'green', gruen: 'green', green: 'green', blau: 'blue', blue: 'blue',
    gelb: 'yellow', yellow: 'yellow', orange: 'orange', lila: 'purple', violett: 'purple', purple: 'purple',
    pink: 'pink', rosa: 'pink', türkis: 'cyan', tuerkis: 'cyan', cyan: 'cyan', grau: 'gray', gray: 'gray', grey: 'gray'
};
const colorOf = (name) => COLORS[String(name || '').trim().toLowerCase()] || null;

// ==Text== / ==farbe:Text== -> Markierung, {{farbe:Text}} -> farbiger Text. Nur auf Text außerhalb von Code anwenden.
const HL = /(^|[^=\\])==(?!=)(?:([A-Za-zÄÖÜäöüß]+):)?(\S(?:[^\n]*?\S)?)==(?!=)/g;
const TC = /\{\{\s*([A-Za-zÄÖÜäöüß]+)\s*:\s*([^\n]+?)\s*\}\}/g;
export function colorize(text) {
    return String(text)
        .replace(TC, (m, c, t) => { const k = colorOf(c); return k ? `<span class="ctx ctx-${k}">${t}</span>` : m; })
        .replace(HL, (m, pre, c, t) => {
            let k = 'yellow';
            if (c) { const x = colorOf(c); if (x) k = x; else t = c + ':' + t; }
            return `${pre}<mark class="hl hl-${k}">${t}</mark>`;
        });
}
// Markierungen für Kopieren/Vorlesen entfernen: ==grün:x== -> x, {{rot:x}} -> x
export function stripMarks(text) {
    return outsideCode(text, (p) => p.replace(TC, (m, c, t) => (colorOf(c) ? t : m)).replace(HL, (m, pre, c, t) => pre + (c && !colorOf(c) ? c + ':' : '') + t));
}
// Wendet fn nur auf Text-Teile an (nicht auf ```Codeblöcke``` und `Inline-Code`)
export function outsideCode(text, fn) {
    return String(text).split(/(```[\s\S]*?(?:```|$)|`[^`\n]*`)/g).map((p, i) => (i % 2 ? p : fn(p))).join('');
}

import { parsePlanLines, fmtDate } from './study-core.js';
import { parseHandwriting, cleanHandwritingText, activeProfile, trainedCount, allProfiles } from './handwriting-core.js';
import { parseBrowserPreview } from './browser-core.js';
export { parseHandwriting };

// ---------- Blöcke finden ----------
export const WIDGETS = ['quiz', 'flashcards', 'steps', 'stats', 'proscons', 'bars', 'tabs', 'plot', 'pie', 'lernplan', 'handwriting', 'browser'];
const NAMES = WIDGETS.join('|');
const OPEN = new RegExp(`<(${NAMES})(\\s[^>]*)?>`, 'i');
const attrsOf = (s) => { const a = {}; String(s || '').replace(/([a-zA-Z_-]+)\s*=\s*["“„]([^"“”]*)["”“]/g, (m, k, v) => { a[k.toLowerCase()] = v; }); return a; };
// Modelle packen Blöcke manchmal in ```xml … ```: auspacken (auch wenn der Zaun beim Streamen noch offen ist)
const FENCED = new RegExp('```[a-zA-Z]*[ \\t]*\\n(\\s*<(?:' + NAMES + ')\\b[\\s\\S]*?)(?:\\n?```|$)', 'gi');

// Ersetzt jeden Block durch einen Platzhalter <div class="cw" data-cw="n"></div> (auch noch offene Blöcke beim Streamen).
// Liefert { text, widgets: [{ type, attrs, body, closed }] }
// final: die Antwort ist fertig (nicht mehr am Streamen). Dann wird ein Block, den das Modell nicht geschlossen hat,
// trotzdem gebaut, statt für immer als „Berechnet Kennzahlen …“ stehen zu bleiben.
export function extractWidgets(text, { final = false } = {}) {
    const widgets = []; const ph = () => `\n\n<div class="cw" data-cw="${widgets.length - 1}"></div>\n\n`;
    const parts = String(text).replace(FENCED, (m, inner) => inner + '\n').split(/(```[\s\S]*?(?:```|$))/g);
    const out = parts.map((part, i) => {
        if (i % 2) return part;
        let rest = part, res = '';
        for (;;) {
            const m = rest.match(OPEN); if (!m) { res += rest; break; }
            const type = m[1].toLowerCase(); const start = m.index; const after = start + m[0].length;
            const close = rest.toLowerCase().indexOf(`</${type}>`, after);
            let body = close < 0 ? rest.slice(after) : rest.slice(after, close);
            if (close < 0) body = body.replace(/<\/[a-z]*$/i, ''); // halber Schluss-Tag beim Streamen
            widgets.push({ type, attrs: attrsOf(m[2]), body: body.replace(/^\n+|\s+$/g, ''), closed: close >= 0 || final });
            res += rest.slice(0, start) + ph();
            if (close < 0) { rest = ''; break; }
            rest = rest.slice(close + type.length + 3);
        }
        // Anfangs-Tag noch nicht fertig geschrieben ("<qu", "<quiz title="Pho"): nichts Rohes anzeigen
        return res.replace(/<([a-z]+)(\s[^<>]*)?$/i, (t, name, attrs) => {
            const n = name.toLowerCase();
            if (final) return t; // fertige Antwort: nichts verschlucken
            if (WIDGETS.includes(n)) { widgets.push({ type: n, attrs: attrsOf(attrs), body: '', closed: false }); return ph(); }
            return !attrs && WIDGETS.some(w => w.startsWith(n)) ? '' : t;
        });
    }).join('');
    return { text: out, widgets };
}

// Wie weit ein Block beim Streamen schon ist (für die Anzeige "Erstellt Quiz … · 3 Fragen")
export function progressOf(w) {
    const L = String(w.body || '').split('\n').map(l => l.trim()).filter(Boolean);
    const n = (re) => L.filter(l => re.test(l)).length;
    switch (w.type) {
        case 'quiz': { const k = n(/^(\?|\d+[.)]\s)/) || (String(w.body).match(/"(q|question|frage)"\s*:/g) || []).length; return k ? `${k} ${k === 1 ? 'Frage' : 'Fragen'}` : ''; }
        case 'flashcards': { const k = n(/::|\s\|\s|->|→/) || (String(w.body).match(/"(front|vorne)"\s*:/g) || []).length; return k ? `${k} ${k === 1 ? 'Karte' : 'Karten'}` : ''; }
        case 'steps': return L.length ? `${L.length} ${L.length === 1 ? 'Schritt' : 'Schritte'}` : '';
        case 'lernplan': { const k = n(/\|/); return k ? `${k} ${k === 1 ? 'Einheit' : 'Einheiten'}` : ''; }
        case 'plot': { const k = n(/=/); return k ? `${k} ${k === 1 ? 'Funktion' : 'Funktionen'}` : ''; }
        case 'handwriting': return L.length ? `${L.length} ${L.length === 1 ? 'Zeile' : 'Zeilen'}` : '';
        default: return L.length ? `${L.length} ${L.length === 1 ? 'Eintrag' : 'Einträge'}` : '';
    }
}

// ---------- Inhalte der Blöcke lesen ----------
const lines = (s) => String(s || '').split('\n').map(l => l.trim()).filter(Boolean);
function tryJson(s) {
    const t = String(s || '').replace(/^```[a-z]*\s*|```\s*$/gi, '').trim();
    if (!/^[[{]/.test(t)) return null;
    try { return JSON.parse(t); } catch (_) { return null; }
}
// Quiz: Zeilenformat (? Frage, - falsch, + richtig, ! Hinweis, > Erklärung) oder JSON {title, questions:[{q, options, answer, hint, explanation}]}
export function parseQuiz(body) {
    const j = tryJson(body);
    if (j) {
        const qs = Array.isArray(j) ? j : (j.questions || j.fragen || []);
        return {
            title: Array.isArray(j) ? '' : (j.title || j.titel || ''),
            questions: qs.map(q => {
                const options = (q.options || q.answers || q.choices || q.antworten || []).map(String);
                let answer = q.answer ?? q.correct ?? q.richtig ?? q.loesung ?? 0;
                if (typeof answer === 'string' && !/^\d+$/.test(answer)) answer = Math.max(0, options.findIndex(o => o.trim().toLowerCase() === answer.trim().toLowerCase()));
                return { q: String(q.q || q.question || q.frage || ''), options, answer: +answer || 0, hint: String(q.hint || q.hinweis || ''), explanation: String(q.explanation || q.erklaerung || q.erklärung || '') };
            }).filter(q => q.q && q.options.length >= 2 && q.answer < q.options.length)
        };
    }
    const questions = []; let cur = null;
    for (const l of lines(body)) {
        const m = l.match(/^(\?|\d+[.)]|[-+*]|!|>|[A-Da-d][).]\s)\s*(.*)$/);
        const mark = m ? m[1].trim() : ''; const val = m ? m[2].trim() : l;
        if (mark === '?' || /^\d+[.)]$/.test(mark) || (!cur && !m)) { cur = { q: val, options: [], answer: -1, hint: '', explanation: '' }; questions.push(cur); continue; }
        if (!cur) continue;
        if (mark === '+' ) { cur.answer = cur.options.length; cur.options.push(val); }
        else if (mark === '-' || mark === '*' || /^[A-Da-d][).]/.test(mark)) { const ok = /\s*\((richtig|korrekt|✓|✔)\)\s*$/i.test(val) || /^✓|^✔/.test(val); const v = val.replace(/\s*\((richtig|korrekt|✓|✔)\)\s*$/i, '').replace(/^[✓✔]\s*/, ''); if (ok) cur.answer = cur.options.length; cur.options.push(v); }
        else if (mark === '!') cur.hint = val.replace(/^(Hinweis|Tipp)\s*:\s*/i, '');
        else if (mark === '>') cur.explanation = (cur.explanation ? cur.explanation + ' ' : '') + val.replace(/^(Erklärung|Erklaerung)\s*:\s*/i, '');
        else cur.q += ' ' + l;
    }
    return { title: '', questions: questions.filter(q => q.q && q.options.length >= 2 && q.answer >= 0) };
}
// Karteikarten: "Vorderseite :: Rückseite" je Zeile (auch " | " oder " -> ") oder JSON [{front, back}]
export function parseCards(body) {
    const j = tryJson(body);
    if (j) { const a = Array.isArray(j) ? j : (j.cards || j.karten || []); return a.map(c => ({ front: String(c.front || c.q || c.vorne || c.frage || ''), back: String(c.back || c.a || c.hinten || c.antwort || '') })).filter(c => c.front && c.back); }
    return lines(body).map(l => { const m = l.replace(/^[-*]\s*/, '').split(/\s*(?:::|\s\|\s|->|→)\s*/); return m.length >= 2 ? { front: m[0], back: m.slice(1).join(' – ') } : null; }).filter(Boolean);
}
// Zeilen mit "a | b | c"
export const parseRows = (body) => lines(body).map(l => l.replace(/^[-*]\s*/, '').split(/\s*\|\s*/));
// Schritte: "Titel: Beschreibung" oder nur Text, Aufzählungszeichen werden entfernt
export const parseSteps = (body) => lines(body).map(l => { const t = l.replace(/^(\d+[.)]|[-*])\s*/, ''); const m = t.match(/^\*{0,2}([^:*]{1,60}?)\*{0,2}\s*:\s+(.+)$/); return m ? { title: m[1].trim(), text: m[2] } : { title: '', text: t }; });
// Pro & Contra: "+ Vorteil" / "- Nachteil"
export const parseProsCons = (body) => { const pro = [], con = []; lines(body).forEach(l => { if (/^[+✓✔]/.test(l)) pro.push(l.replace(/^[+✓✔]\s*/, '')); else if (/^[-–✗✘x]\s/.test(l) || /^[-–✗✘]/.test(l)) con.push(l.replace(/^[-–✗✘x]\s*/, '')); }); return { pro, con }; };
// Tabs: Abschnitte mit "## Name"
export const parseTabs = (body) => { const tabs = []; String(body).split('\n').forEach(l => { const m = l.match(/^#{2,3}\s+(.+)/); if (m) tabs.push({ title: m[1].trim(), body: '' }); else if (tabs.length) tabs[tabs.length - 1].body += l + '\n'; }); return tabs.filter(t => t.title); };

// ---------- Mathe: Formeln sicher auswerten (kein eval) ----------
// compileExpr("2x^2 - 3sin(x) + √(x)") -> (x) => Zahl. Unterstützt + - * / ^, Klammern, implizites Mal (2x, 3(x+1), x sin(x)),
// sin cos tan asin acos atan sqrt abs ln log exp floor ceil round sign, pi, e, Komma als Dezimaltrennzeichen.
const FN = { sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan, arcsin: Math.asin, arccos: Math.acos, arctan: Math.atan, sqrt: Math.sqrt, wurzel: Math.sqrt, abs: Math.abs, betrag: Math.abs, ln: Math.log, log: Math.log10, lg: Math.log10, exp: Math.exp, floor: Math.floor, ceil: Math.ceil, round: Math.round, sign: Math.sign, sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh };
export function compileExpr(src) {
    const s = String(src).replace(/[·⋅×]/g, '*').replace(/[÷:]/g, '/').replace(/[−–]/g, '-').replace(/²/g, '^2').replace(/³/g, '^3').replace(/√/g, 'sqrt').replace(/π/g, 'pi')
        .replace(/(\d),(\d)/g, '$1.$2').replace(/\\cdot|\\times/g, '*').replace(/\\(sqrt|sin|cos|tan|ln|log|pi|exp)/g, '$1').replace(/[{}]/g, (c) => (c === '{' ? '(' : ')')).replace(/\|([^|]+)\|/g, 'abs($1)');
    const tok = []; const re = /\s*(\d+\.?\d*|\.\d+|[a-zA-Z]+|[-+*/^()])/y; let m, pos = 0;
    while (pos < s.length) { re.lastIndex = pos; m = re.exec(s); if (!m) { if (/^\s*$/.test(s.slice(pos))) break; throw new Error('Unbekanntes Zeichen: ' + s[pos]); } pos = re.lastIndex;
        const t = m[1]; if (/^[a-zA-Z]+$/.test(t) && !FN[t.toLowerCase()] && !['x', 'pi', 'e'].includes(t.toLowerCase())) { for (const c of t) tok.push(c); } else tok.push(/^[a-zA-Z]+$/.test(t) ? t.toLowerCase() : t); }
    let i = 0; const peek = () => tok[i]; const eat = (t) => { if (tok[i] !== t) throw new Error('Erwartet ' + t); i++; };
    const startsAtom = (t) => t != null && (t === '(' || /^[\d.]/.test(t) || /^[a-z]+$/.test(t));
    function expr() { let a = term(); while (peek() === '+' || peek() === '-') { const op = tok[i++]; const l = a, r = term(); a = op === '+' ? (x) => l(x) + r(x) : (x) => l(x) - r(x); } return a; }
    function term() { let a = unary(); for (;;) { const t = peek(); if (t === '*' || t === '/') { i++; const l = a, r = unary(); a = t === '*' ? (x) => l(x) * r(x) : (x) => l(x) / r(x); } else if (startsAtom(t)) { const l = a, r = power(); a = (x) => l(x) * r(x); } else return a; } }
    function unary() { if (peek() === '-') { i++; const a = unary(); return (x) => -a(x); } if (peek() === '+') { i++; return unary(); } return power(); }
    function power() { const b = primary(); if (peek() === '^') { i++; const e = unary(); return (x) => Math.pow(b(x), e(x)); } return b; }
    function primary() {
        const t = tok[i++]; if (t == null) throw new Error('Formel unvollständig');
        if (t === '(') { const a = expr(); eat(')'); return a; }
        if (/^[\d.]/.test(t)) { const v = parseFloat(t); return () => v; }
        if (t === 'x') return (x) => x; if (t === 'pi') return () => Math.PI; if (t === 'e') return () => Math.E;
        if (FN[t]) { const f = FN[t]; const a = peek() === '(' ? (i++, (() => { const r = expr(); eat(')'); return r; })()) : power(); return (x) => f(a(x)); }
        throw new Error('Unbekannt: ' + t);
    }
    const f = expr(); if (i < tok.length) throw new Error('Unerwartet: ' + tok[i]);
    return f;
}
const num = (v) => parseFloat(String(v).replace(',', '.').replace('−', '-'));
const range = (v) => { const m = String(v || '').match(/(-?[\d.,]+)\s*(?:\.\.|;|bis|,(?=\s*-?\d)|\s)\s*(-?[\d.,]+)/); if (!m) return null; const a = num(m[1]), b = num(m[2]); return Number.isFinite(a) && Number.isFinite(b) && b > a ? [a, b] : null; };
// Inhalt eines <plot>: Funktionen "f(x) = …", "y = …", Punkte "P(1|2)", senkrechte Linien "x = 2"; jeweils optional "| farbe"
export function parsePlot(body, attrs = {}) {
    const fns = [], pts = [], vlines = [];
    for (let l of String(body || '').split('\n').map(x => x.trim().replace(/^[-*]\s*/, '')).filter(Boolean)) {
        let color = null; const cm = l.match(/\|\s*([A-Za-zÄÖÜäöüß]+)\s*$/); if (cm && colorOf(cm[1])) { color = colorOf(cm[1]); l = l.slice(0, cm.index).trim(); }
        let m;
        if ((m = l.match(/^([A-Za-z][\w']*)\s*\(\s*(-?[\d.,]+)\s*[|;]\s*(-?[\d.,]+)\s*\)$/)) || (m = l.match(/^([A-Za-z][\w']*)\s*\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)$/))) { pts.push({ name: m[1], x: num(m[2]), y: num(m[3]), color }); continue; }
        if ((m = l.match(/^x\s*=\s*(-?[\d.,]+)$/))) { vlines.push({ x: num(m[1]), color }); continue; }
        if ((m = l.match(/^([A-Za-z][\w']*)\s*\(\s*x\s*\)\s*=\s*(.+)$/)) || (m = l.match(/^(y)\s*=\s*(.+)$/))) { try { fns.push({ name: m[1], expr: m[2].replace(/\$/g, '').trim(), f: compileExpr(m[2].replace(/\$/g, '')), color }); } catch (_) {} continue; }
    }
    return { fns, pts, vlines, x: range(attrs.x), y: range(attrs.y) };
}
// Kreisdiagramm: "Name | Wert | farbe"
export const parsePie = (body) => parseRows(body).map(([l, v, c]) => ({ l, v: num(String(v || '').replace('%', '')), c: colorOf(c) })).filter(r => r.l && Number.isFinite(r.v) && r.v > 0);

// ---------- Einheitliche Lade-Animation ----------
// loader({ size, logo }) -> Element. Überall gleich: Coden-Logo, darum ein rotierender Farbring.
// Die Drehung läuft über EINE gemeinsame Uhr (requestAnimationFrame) statt CSS-Animation: so springt der Ring nicht
// auf Anfang zurück, wenn eine Antwort beim Streamen 60× pro Sekunde neu gezeichnet wird.
let spinRaf = 0;
function spinLoop(t) {
    const rings = document.querySelectorAll('.coden-loader .cl-ring');
    if (!rings.length) { spinRaf = 0; return; }
    const rot = (t / 900 * 360) % 360, br = 0.97 + Math.sin(t / 1800 * Math.PI * 2) * 0.03;
    rings.forEach(r => { r.style.transform = `rotate(${rot}deg)`; const logo = r.nextElementSibling; if (logo) logo.style.transform = `scale(${br})`; });
    spinRaf = requestAnimationFrame(spinLoop);
}
export function loader({ size = 36, logo = true } = {}) {
    const el = document.createElement('span'); el.className = 'coden-loader' + (logo ? '' : ' no-logo'); el.style.setProperty('--s', size + 'px'); el.setAttribute('role', 'status'); el.setAttribute('aria-label', 'Lädt');
    const ring = document.createElement('span'); ring.className = 'cl-ring'; el.append(ring);
    if (logo) { const img = document.createElement('img'); img.className = 'cl-logo'; img.src = './images/coden_logo.jpg'; img.alt = ''; img.onerror = () => img.remove(); el.append(img); }
    if (!spinRaf && typeof requestAnimationFrame === 'function') spinRaf = requestAnimationFrame(spinLoop);
    return el;
}

// ---------- Elemente bauen ----------
const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const icon = (name) => mk('span', 'material-symbols-outlined', name);
const LABEL = { quiz: 'Quiz wird erstellt', flashcards: 'Karteikarten werden erstellt', steps: 'Schritte werden geschrieben', stats: 'Kennzahlen werden berechnet', proscons: 'Vor- und Nachteile werden gesammelt', bars: 'Balken werden gezeichnet', tabs: 'Abschnitte werden geschrieben' };

const VERB = { lernplan: 'Erstellt deinen Lernplan', quiz: 'Erstellt Quiz', flashcards: 'Erstellt Karteikarten', steps: 'Schreibt die Schritte', stats: 'Berechnet Kennzahlen', proscons: 'Sammelt Vor- und Nachteile', bars: 'Zeichnet Balken', tabs: 'Schreibt Abschnitte', plot: 'Zeichnet den Graphen', pie: 'Zeichnet das Kreisdiagramm', handwriting: 'Schreibt in deiner Handschrift', browser: 'Erstellt Web-Vorschau' };
const PICON = { lernplan: 'event_note', quiz: 'quiz', flashcards: 'style', steps: 'format_list_numbered', stats: 'monitoring', proscons: 'thumbs_up_down', bars: 'bar_chart', tabs: 'tab', plot: 'show_chart', pie: 'pie_chart', handwriting: 'stylus_note', browser: 'public' };
// Platzhalter, solange ein Block noch geschrieben wird: gleiche Lade-Animation + was entsteht + wie weit
function pending(type) {
    const box = mk('div', 'cw-card cw-pending cw-new');
    box.addEventListener('animationend', () => box.classList.remove('cw-new'), { once: true });
    const tx = mk('div', 'cw-pending-info');
    const l = mk('span', 'cw-pending-text', (VERB[type] || 'Wird erstellt') + ' …');
    const sub = mk('small', 'cw-pending-sub', 'Gleich fertig – du kannst es dann direkt benutzen');
    tx.append(l, sub);
    const skel = mk('div', 'cw-skel'); skel.append(icon(PICON[type] || 'auto_awesome'));
    box.append(loader({ size: 30 }), tx, skel); box._sub = sub; return box;
}

function buildQuiz(w, md) {
    const { title, questions } = parseQuiz(w.body);
    if (!questions.length) return null;
    const box = mk('div', 'cw-card cw-quiz');
    let order = questions.map((_, i) => i), pos = 0, score = 0; const wrong = [];
    const head = mk('div', 'qz-head');
    const ttl = mk('div', 'qz-title'); ttl.append(icon('quiz'), mk('b', '', w.attrs.title || title || 'Quiz'));
    const count = mk('span', 'qz-count');
    head.append(ttl, count);
    const bar = mk('div', 'qz-bar'); const fill = mk('i'); bar.append(fill);
    const stage = mk('div', 'qz-stage');
    box.append(head, bar, stage);
    const showQ = () => {
        const q = questions[order[pos]]; stage.replaceChildren();
        count.textContent = `Frage ${pos + 1} von ${order.length}`; fill.style.width = (pos / order.length * 100) + '%';
        const qt = mk('div', 'qz-q'); qt.innerHTML = md(q.q);
        const opts = mk('div', 'qz-opts'); const fb = mk('div', 'qz-feedback'); fb.hidden = true;
        const actions = mk('div', 'qz-actions');
        if (q.hint) {
            const hb = mk('button', 'qz-ghost'); hb.type = 'button'; hb.append(icon('lightbulb'), document.createTextNode('Hinweis'));
            hb.addEventListener('click', () => { const h = mk('div', 'qz-hint'); h.append(icon('lightbulb')); const s = mk('span'); s.innerHTML = md(q.hint); h.append(s); hb.replaceWith(h); });
            actions.append(hb);
        }
        q.options.forEach((o, i) => {
            const b = mk('button', 'qz-opt'); b.type = 'button';
            const letter = mk('span', 'qz-letter', String.fromCharCode(65 + i)); const t = mk('span', 'qz-opt-text'); t.innerHTML = md(o);
            b.append(letter, t);
            b.addEventListener('click', () => {
                const ok = i === q.answer; if (ok) score++; else wrong.push(order[pos]);
                opts.querySelectorAll('.qz-opt').forEach((x, k) => { x.disabled = true; if (k === q.answer) x.classList.add('right'); else if (k === i) x.classList.add('wrong'); else x.classList.add('dim'); });
                fb.hidden = false; fb.className = 'qz-feedback ' + (ok ? 'ok' : 'bad');
                const h = mk('div', 'qz-fb-head'); h.append(icon(ok ? 'check_circle' : 'cancel'), mk('b', '', ok ? pick(['Richtig!', 'Genau so!', 'Super, stimmt!', 'Perfekt!']) : pick(['Nicht ganz.', 'Knapp daneben.', 'Leider falsch.'])));
                fb.replaceChildren(h);
                if (q.explanation) { const e = mk('div', 'qz-expl'); e.innerHTML = md(q.explanation); fb.append(e); }
                actions.querySelector('.qz-ghost')?.remove(); actions.querySelector('.qz-hint')?.remove();
                const next = mk('button', 'qz-primary'); next.type = 'button';
                next.append(document.createTextNode(pos + 1 < order.length ? 'Nächste Frage' : 'Ergebnis ansehen'), icon('arrow_forward'));
                next.addEventListener('click', () => { pos++; if (pos < order.length) showQ(); else showEnd(); });
                actions.append(next); next.focus({ preventScroll: true });
            });
            opts.append(b);
        });
        stage.append(qt, opts, fb, actions);
    };
    const showEnd = () => {
        stage.replaceChildren(); fill.style.width = '100%'; count.textContent = 'Fertig';
        const pct = Math.round(score / order.length * 100);
        const end = mk('div', 'qz-end');
        const ring = mk('div', 'qz-ring'); ring.style.setProperty('--p', pct); ring.append(mk('b', '', pct + ' %'));
        const txt = mk('div', 'qz-end-text');
        txt.append(mk('b', '', pct === 100 ? 'Alles richtig! 🎉' : pct >= 70 ? 'Stark gemacht! 💪' : pct >= 40 ? 'Gar nicht schlecht!' : 'Da geht noch was – üb weiter!'), mk('span', '', `${score} von ${order.length} Fragen richtig`));
        end.append(ring, txt);
        const actions = mk('div', 'qz-actions');
        const again = mk('button', 'qz-ghost'); again.type = 'button'; again.append(icon('replay'), document.createTextNode('Nochmal'));
        again.addEventListener('click', () => { order = questions.map((_, i) => i); pos = 0; score = 0; wrong.length = 0; showQ(); });
        actions.append(again);
        if (wrong.length) {
            const miss = wrong.slice();
            const rep = mk('button', 'qz-ghost'); rep.type = 'button'; rep.append(icon('restart_alt'), document.createTextNode('Falsche wiederholen'));
            rep.addEventListener('click', () => { order = miss; pos = 0; score = 0; wrong.length = 0; showQ(); });
            const ask = mk('button', 'qz-primary'); ask.type = 'button'; ask.append(icon('school'), document.createTextNode('Fehler erklären lassen'));
            ask.addEventListener('click', () => document.dispatchEvent(new CustomEvent('codenFollowup', { detail: 'Erkläre mir bitte diese Quizfragen, die ich falsch hatte: ' + miss.map(i => '„' + questions[i].q + '“').join(', ') })));
            actions.append(rep, ask);
        } else {
            const more = mk('button', 'qz-primary'); more.type = 'button'; more.append(icon('add'), document.createTextNode('Schwierigeres Quiz'));
            more.addEventListener('click', () => document.dispatchEvent(new CustomEvent('codenFollowup', { detail: 'Mach mir ein schwierigeres Quiz zum gleichen Thema.' })));
            actions.append(more);
        }
        stage.append(end, actions);
    };
    showQ(); return box;
}
const pick = (a) => a[Math.floor(Math.random() * a.length)];

function buildCards(w, md) {
    const cards = parseCards(w.body); if (!cards.length) return null;
    const box = mk('div', 'cw-card cw-cards'); let i = 0, order = cards.map((_, k) => k); const known = new Set();
    const head = mk('div', 'qz-head'); const ttl = mk('div', 'qz-title'); ttl.append(icon('style'), mk('b', '', w.attrs.title || 'Karteikarten')); const count = mk('span', 'qz-count'); head.append(ttl, count);
    const card = mk('button', 'fc-card'); card.type = 'button'; card.setAttribute('aria-label', 'Karte umdrehen');
    const inner = mk('div', 'fc-inner'); const front = mk('div', 'fc-face fc-front'); const back = mk('div', 'fc-face fc-back'); inner.append(front, back); card.append(inner);
    card.addEventListener('click', () => card.classList.toggle('flipped'));
    const nav = mk('div', 'qz-actions fc-nav');
    const btn = (ic, label, fn, cls = 'qz-ghost') => { const b = mk('button', cls); b.type = 'button'; b.append(icon(ic)); if (label) b.append(document.createTextNode(label)); b.addEventListener('click', fn); return b; };
    const draw = () => {
        const c = cards[order[i]]; card.classList.remove('flipped');
        front.innerHTML = '<small>Frage</small>' + md(c.front); back.innerHTML = '<small>Antwort</small>' + md(c.back);
        count.textContent = `${i + 1} / ${order.length}` + (known.size ? ` · ${known.size} gewusst` : '');
    };
    nav.append(
        btn('chevron_left', '', () => { i = (i - 1 + order.length) % order.length; draw(); }),
        btn('shuffle', 'Mischen', () => { order = order.map(v => [Math.random(), v]).sort((a, b) => a[0] - b[0]).map(x => x[1]); i = 0; draw(); }),
        btn('check', 'Gewusst', () => { known.add(order[i]); i = (i + 1) % order.length; draw(); }, 'qz-primary'),
        btn('chevron_right', '', () => { i = (i + 1) % order.length; draw(); })
    );
    box.append(head, card, mk('small', 'fc-tip', 'Tippe auf die Karte zum Umdrehen'), nav); draw(); return box;
}

function buildSteps(w, md) {
    const steps = parseSteps(w.body); if (!steps.length) return null;
    const box = mk('ol', 'cw-steps');
    steps.forEach((s, k) => { const li = mk('li'); const n = mk('span', 'st-n', String(k + 1)); const tx = mk('div', 'st-tx'); if (s.title) tx.append(mk('b', '', s.title)); const p = mk('div'); p.innerHTML = md(s.text); tx.append(p); li.append(n, tx); box.append(li); });
    return box;
}
function buildStats(w, md) {
    const rows = parseRows(w.body).filter(r => r.length >= 2); if (!rows.length) return null;
    const box = mk('div', 'cw-stats');
    rows.slice(0, 8).forEach(([v, l, c]) => { const t = mk('div', 'stat' + (colorOf(c) ? ' c-' + colorOf(c) : '')); const b = mk('b'); b.innerHTML = md(v); const s = mk('span'); s.innerHTML = md(l); t.append(b, s); box.append(t); });
    return box;
}
function buildProsCons(w, md) {
    const { pro, con } = parseProsCons(w.body); if (!pro.length && !con.length) return null;
    const box = mk('div', 'cw-proscons');
    const col = (cls, ic, title, items) => { const c = mk('div', 'pc-col ' + cls); const h = mk('div', 'pc-head'); h.append(icon(ic), mk('b', '', title)); c.append(h); const ul = mk('ul'); items.forEach(x => { const li = mk('li'); li.innerHTML = md(x); ul.append(li); }); c.append(ul); return c; };
    box.append(col('pro', 'thumb_up', w.attrs.pro || 'Vorteile', pro), col('con', 'thumb_down', w.attrs.contra || w.attrs.con || 'Nachteile', con));
    return box;
}
function buildBars(w, md) {
    const rows = parseRows(w.body).map(([l, v, c]) => ({ l, v: parseFloat(String(v || '').replace(',', '.')), c: colorOf(c), raw: v })).filter(r => r.l && Number.isFinite(r.v)); if (!rows.length) return null;
    const max = Math.max(...rows.map(r => Math.abs(r.v)), +w.attrs.max || 0) || 1;
    const box = mk('div', 'cw-card cw-bars'); if (w.attrs.title) box.append(mk('b', 'bars-title', w.attrs.title));
    rows.forEach(r => { const row = mk('div', 'bar-row'); const l = mk('span', 'bar-l'); l.innerHTML = md(r.l); const track = mk('div', 'bar-track'); const f = mk('i', r.c ? 'c-' + r.c : ''); f.style.width = Math.max(2, Math.abs(r.v) / max * 100) + '%'; track.append(f); row.append(l, track, mk('span', 'bar-v', String(r.raw).trim() + (w.attrs.unit || ''))); box.append(row); });
    return box;
}
function buildTabs(w, md) {
    const tabs = parseTabs(w.body); if (!tabs.length) return null;
    const box = mk('div', 'cw-card cw-tabs'); const bar = mk('div', 'tb-bar'); const panel = mk('div', 'tb-panel md');
    const show = (k) => { bar.querySelectorAll('button').forEach((b, j) => b.classList.toggle('on', j === k)); panel.innerHTML = md(tabs[k].body, true); };
    tabs.forEach((t, k) => { const b = mk('button', '', t.title); b.type = 'button'; b.addEventListener('click', () => show(k)); bar.append(b); });
    box.append(bar, panel); show(0); return box;
}
const SUP = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '-': '⁻' };
const prettyExpr = (e) => String(e).replace(/\^\(?(-?\d+)\)?/g, (m, d) => [...d].map(c => SUP[c] || c).join('')).replace(/\*/g, '·').replace(/sqrt/g, '√').replace(/\bpi\b/g, 'π').replace(/(\d)\.(\d)/g, '$1,$2');
const PALETTE = ['blue', 'red', 'green', 'purple', 'orange', 'cyan', 'pink'];
const SVGNS = 'http://www.w3.org/2000/svg';
const sv = (tag, attrs = {}) => { const e = document.createElementNS(SVGNS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
const de = (v) => { const r = Math.abs(v) < 1e-9 ? 0 : +v.toPrecision(4); return String(r).replace('.', ','); };
function niceStep(span, target = 8) { const raw = span / target, p = Math.pow(10, Math.floor(Math.log10(raw))), n = raw / p; return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * p; }
function buildPlot(w, md) {
    const P = parsePlot(w.body, w.attrs); if (!P.fns.length && !P.pts.length) return null;
    const W = 600, H = 380, pad = 14;
    let [x0, x1] = P.x || (() => { const xs = P.pts.map(p => p.x); if (!xs.length) return [-5, 5]; const a = Math.min(-1, ...xs), b = Math.max(1, ...xs), m = (b - a) * 0.25 + 1; return [Math.floor(a - m), Math.ceil(b + m)]; })();
    let y0, y1;
    if (P.y) [y0, y1] = P.y;
    else {
        const ys = P.pts.map(p => p.y);
        P.fns.forEach(f => { for (let k = 0; k <= 200; k++) { const v = f.f(x0 + (x1 - x0) * k / 200); if (Number.isFinite(v)) ys.push(v); } });
        ys.sort((a, b) => a - b); const q = (p) => ys[Math.min(ys.length - 1, Math.max(0, Math.round(p * (ys.length - 1))))];
        y0 = ys.length ? q(0.04) : -5; y1 = ys.length ? q(0.96) : 5; y0 = Math.min(y0, 0); y1 = Math.max(y1, 0);
        if (y1 - y0 < 1e-6) { y0 -= 1; y1 += 1; } const m = (y1 - y0) * 0.12; y0 -= m; y1 += m;
    }
    const X = (x) => pad + (x - x0) / (x1 - x0) * (W - 2 * pad), Y = (y) => H - pad - (y - y0) / (y1 - y0) * (H - 2 * pad);
    const box = mk('div', 'cw-card cw-plot'); if (w.attrs.title) box.append(mk('b', 'bars-title', w.attrs.title));
    const svg = sv('svg', { viewBox: `0 0 ${W} ${H}`, class: 'plot-svg', role: 'img', 'aria-label': w.attrs.title || 'Funktionsgraph' });
    const gx = niceStep(x1 - x0), gy = niceStep(y1 - y0, 6);
    const grid = sv('g', { class: 'pl-grid' }), ticks = sv('g', { class: 'pl-ticks' });
    const ax = Math.min(Math.max(Y(0), pad), H - pad), ay = Math.min(Math.max(X(0), pad), W - pad);
    for (let v = Math.ceil(x0 / gx) * gx; v <= x1 + 1e-9; v += gx) { grid.append(sv('line', { x1: X(v), x2: X(v), y1: pad, y2: H - pad })); if (Math.abs(v) > 1e-9) { const t = sv('text', { x: X(v), y: Math.min(ax + 15, H - 2), 'text-anchor': 'middle' }); t.textContent = de(v); ticks.append(t); } }
    for (let v = Math.ceil(y0 / gy) * gy; v <= y1 + 1e-9; v += gy) { grid.append(sv('line', { y1: Y(v), y2: Y(v), x1: pad, x2: W - pad })); if (Math.abs(v) > 1e-9) { const t = sv('text', { x: ay - 6, y: Y(v) + 4, 'text-anchor': 'end' }); t.textContent = de(v); ticks.append(t); } }
    const axes = sv('g', { class: 'pl-axes' });
    axes.append(sv('line', { x1: pad, x2: W - pad + 2, y1: ax, y2: ax }), sv('path', { d: `M${W - pad + 4} ${ax} l-8 -4 v8z` }), sv('line', { x1: ay, x2: ay, y1: H - pad, y2: pad - 2 }), sv('path', { d: `M${ay} ${pad - 4} l-4 8 h8z` }));
    const lx = sv('text', { x: W - pad - 2, y: ax - 7, 'text-anchor': 'end', class: 'pl-axname' }); lx.textContent = w.attrs.xlabel || 'x';
    const ly = sv('text', { x: ay + 8, y: pad + 10, class: 'pl-axname' }); ly.textContent = w.attrs.ylabel || 'y';
    const clipId = 'plc' + Math.random().toString(36).slice(2, 8);
    const defs = sv('defs'); const cp = sv('clipPath', { id: clipId }); cp.append(sv('rect', { x: pad, y: pad - 2, width: W - 2 * pad, height: H - 2 * pad + 4 })); defs.append(cp);
    const plotG = sv('g', { 'clip-path': `url(#${clipId})` });
    svg.append(defs, grid, axes, ticks, lx, ly, plotG);
    P.vlines.forEach(v => svg.append(sv('line', { x1: X(v.x), x2: X(v.x), y1: pad, y2: H - pad, class: 'pl-vline c-' + (v.color || 'gray') })));
    const legend = mk('div', 'pl-legend');
    P.fns.forEach((f, k) => {
        const c = f.color || PALETTE[k % PALETTE.length]; let d = '', pen = false, prev = null; const N = 480;
        for (let s2 = 0; s2 <= N; s2++) {
            const x = x0 + (x1 - x0) * s2 / N, y = f.f(x);
            const ok = Number.isFinite(y) && Math.abs(y - (y0 + y1) / 2) < (y1 - y0) * 6 && !(prev !== null && Math.abs(y - prev) > (y1 - y0) * 2);
            if (ok) { d += (pen ? 'L' : 'M') + X(x).toFixed(1) + ' ' + Y(y).toFixed(1); pen = true; } else pen = false;
            prev = Number.isFinite(y) ? y : null;
        }
        plotG.append(sv('path', { d, class: 'pl-fn c-' + c }));
        const it = mk('span', 'pl-key c-' + c); it.append(mk('i')); const tx = mk('span'); tx.innerHTML = md(`${f.name === 'y' ? 'y' : f.name + '(x)'} = ${prettyExpr(f.expr)}`); it.append(tx); legend.append(it);
        f.c = c;
    });
    P.pts.forEach(p => { const c = p.color || 'red'; const g = sv('g', { class: 'pl-pt c-' + c }); g.append(sv('circle', { cx: X(p.x), cy: Y(p.y), r: 4.5 })); const t = sv('text', { x: X(p.x) + 8, y: Y(p.y) - 8 }); t.textContent = `${p.name}(${de(p.x)}|${de(p.y)})`; g.append(t); svg.append(g); });
    // Fadenkreuz: zeigt beim Drüberfahren x und die Funktionswerte
    const cross = sv('line', { class: 'pl-cross', y1: pad, y2: H - pad, x1: -10, x2: -10 }); svg.append(cross);
    const dots = P.fns.map(f => { const c = sv('circle', { r: 4, class: 'pl-dot c-' + f.c, cx: -10, cy: -10 }); svg.append(c); return c; });
    const tip = mk('div', 'pl-tip'); tip.hidden = true;
    const wrap = mk('div', 'pl-wrap'); wrap.append(svg, tip);
    svg.addEventListener('pointerenter', () => wrap.classList.add('hover'));
    svg.addEventListener('pointermove', (e) => {
        const r = svg.getBoundingClientRect(); const px = (e.clientX - r.left) / r.width * W; const x = x0 + (px - pad) / (W - 2 * pad) * (x1 - x0);
        if (x < x0 || x > x1) { tip.hidden = true; return; }
        cross.setAttribute('x1', px); cross.setAttribute('x2', px);
        const parts = [`x = ${de(x)}`];
        P.fns.forEach((f, k) => { const y = f.f(x); const ok = Number.isFinite(y) && y >= y0 && y <= y1; dots[k].setAttribute('cx', ok ? px : -10); dots[k].setAttribute('cy', ok ? Y(y) : -10); if (Number.isFinite(y)) parts.push(`${f.name === 'y' ? 'y' : f.name + '(x)'} = ${de(y)}`); });
        tip.textContent = parts.join('   ·   '); tip.hidden = false;
    });
    svg.addEventListener('pointerleave', () => { wrap.classList.remove('hover'); tip.hidden = true; cross.setAttribute('x1', -10); cross.setAttribute('x2', -10); dots.forEach(d => { d.setAttribute('cx', -10); }); });
    box.append(wrap); if (legend.children.length) box.append(legend);
    return box;
}
function buildPie(w, md) {
    const rows = parsePie(w.body); if (!rows.length) return null;
    const total = rows.reduce((a, r) => a + r.v, 0);
    const box = mk('div', 'cw-card cw-pie'); if (w.attrs.title) box.append(mk('b', 'bars-title', w.attrs.title));
    const body = mk('div', 'pie-body'); const svg = sv('svg', { viewBox: '-110 -110 220 220', class: 'pie-svg' }); const R0 = 100;
    let a = -Math.PI / 2; const legend = mk('div', 'pie-legend');
    rows.forEach((r, k) => {
        const c = r.c || PALETTE[k % PALETTE.length]; const frac = r.v / total, b = a + frac * Math.PI * 2;
        const el = frac >= 0.9999 ? sv('circle', { r: R0, class: 'pie-seg c-' + c }) : sv('path', { class: 'pie-seg c-' + c, d: `M0 0 L${R0 * Math.cos(a)} ${R0 * Math.sin(a)} A${R0} ${R0} 0 ${b - a > Math.PI ? 1 : 0} 1 ${R0 * Math.cos(b)} ${R0 * Math.sin(b)}Z` });
        svg.append(el);
        const it = mk('div', 'pie-key c-' + c); it.append(mk('i')); const l = mk('span'); l.innerHTML = md(r.l); it.append(l, mk('b', '', de(Math.round(frac * 1000) / 10) + ' %')); legend.append(it);
        a = b;
    });
    svg.append(sv('circle', { r: 56, class: 'pie-hole' }));
    const mid = sv('text', { y: 8, 'text-anchor': 'middle', class: 'pie-total' }); mid.textContent = w.attrs.center || (de(total) + (w.attrs.unit || '')); svg.append(mid);
    body.append(svg, legend); box.append(body); return box;
}
// Lernplan aus dem Chat: Übersicht + "Ins Lern-Studio übernehmen" (js/study-store.js hört auf das Ereignis)
function buildLernplan(w, md) {
    const sessions = parsePlanLines(w.body, null); if (!sessions.length) return null;
    const box = mk('div', 'cw-card cw-lernplan');
    const head = mk('div', 'qz-head'); const ttl = mk('div', 'qz-title'); ttl.append(icon('event_note'), mk('b', '', w.attrs.title || 'Dein Lernplan'));
    const total = sessions.reduce((n, s) => n + s.min, 0); head.append(ttl, mk('span', 'qz-count', `${sessions.length} Einheiten · ${String(Math.round(total / 6) / 10).replace('.', ',')} h`));
    const list = mk('div', 'lp-list'); let lastDate = '';
    sessions.forEach(s => {
        if (s.date !== lastDate) { list.append(mk('div', 'lp-day', fmtDate(s.date))); lastDate = s.date; }
        const row = mk('div', 'lp-row'); row.append(mk('span', 'lp-time', s.start), mk('span', 'lp-min', s.min + ' min'));
        const tx = mk('span', 'lp-tx'); tx.innerHTML = md(`**${s.subjectName}:** ${s.title}`); row.append(tx); list.append(row);
    });
    const actions = mk('div', 'qz-actions');
    const take = mk('button', 'qz-primary'); take.type = 'button'; take.append(icon('add_task'), document.createTextNode('Ins Lern-Studio übernehmen'));
    take.addEventListener('click', () => {
        document.dispatchEvent(new CustomEvent('codenStudyPlan', { detail: { title: w.attrs.title || '', sessions: sessions.map(s => ({ ...s })), done: () => {} } }));
        take.disabled = true; take.replaceChildren(icon('check'), document.createTextNode('Übernommen – mit Erinnerungen'));
    });
    const open = mk('button', 'qz-ghost'); open.type = 'button'; open.append(icon('open_in_new'), document.createTextNode('Lernplan ansehen')); open.addEventListener('click', () => { location.hash = '#/lernen/plan'; });
    actions.append(open, take); box.append(head, list, actions); return box;
}
// Handschrift-Block im Chat (<handwriting>): rendert den Text auf Papier in der trainierten Handschrift
function buildHandwriting(w) {
    const parsed = parseHandwriting(w.body, w.attrs);
    if (!parsed.text) return null;
    const box = mk('div', 'cw-card cw-hw');
    const head = mk('div', 'hw-card-head');
    const ttl = mk('div', 'qz-title');
    ttl.append(icon('stylus_note'), mk('b', '', parsed.title || 'Handschrift'));
    const meta = mk('div', 'hw-card-meta');
    const profSel = mk('select', 'hw-prof-pick');
    profSel.hidden = true;
    profSel.title = 'Handschrift-Profil wählen';
    const status = mk('span', 'qz-count', 'Lädt …');
    meta.append(profSel, status);
    head.append(ttl, meta);

    const sheetWrap = mk('div', 'hw-sheet-wrap');
    const canvas = mk('canvas', 'hw-sheet-canvas');
    sheetWrap.append(canvas);

    const untrainedBar = mk('div', 'hw-untrained-bar');
    untrainedBar.hidden = true;
    const uTxt = mk('span');
    uTxt.append(icon('stylus_note'), document.createTextNode('Noch keine eigene Schrift trainiert – Vorschau-Handschrift aktiv.'));
    const uBtn = mk('button', 'qz-primary');
    uBtn.type = 'button';
    uBtn.append(icon('edit'), document.createTextNode('Meine Handschrift trainieren'));
    untrainedBar.append(uTxt, uBtn);

    const rawPre = mk('pre', 'hw-raw-text', cleanHandwritingText(parsed.text));
    rawPre.hidden = true;

    const actions = mk('div', 'qz-actions');
    const txtBtn = mk('button', 'qz-ghost');
    txtBtn.type = 'button';
    txtBtn.append(icon('notes'), document.createTextNode('Text'));
    txtBtn.addEventListener('click', () => {
        rawPre.hidden = !rawPre.hidden;
        txtBtn.replaceChildren(icon('notes'), document.createTextNode(rawPre.hidden ? 'Text' : 'Text ausblenden'));
    });

    const imgBtn = mk('button', 'qz-ghost');
    imgBtn.type = 'button';
    imgBtn.append(icon('download'), document.createTextNode('Als Bild'));
    imgBtn.addEventListener('click', () => {
        const a = document.createElement('a');
        a.href = canvas.toDataURL('image/png');
        a.download = ((parsed.title || 'handschrift').toLowerCase().replace(/[^a-z0-9äöüß_-]+/gi, '-') || 'handschrift') + '.png';
        a.click();
    });

    const nbBtn = mk('button', 'qz-ghost');
    nbBtn.type = 'button';
    nbBtn.append(icon('menu_book'), document.createTextNode('Ins Heft'));

    const trainBtn = mk('button', 'qz-primary');
    trainBtn.type = 'button';
    trainBtn.append(icon('stylus_note'), document.createTextNode('Handschrift anpassen'));

    actions.append(txtBtn, imgBtn, nbBtn, trainBtn);
    box.append(head, sheetWrap, untrainedBar, rawPre, actions);

    let selectedProfile = parsed.profile || '';
    let hwMod = null;
    let firstPaint = true;
    let lastW = 0;
    // Breite ändert sich (Handy drehen, Seitenleiste): neu umbrechen
    if (typeof ResizeObserver !== 'undefined') {
        let t = 0;
        new ResizeObserver(() => { clearTimeout(t); t = setTimeout(() => { if (box.isConnected && Math.abs(sheetWrap.clientWidth - lastW) > 40) paint(); }, 150); }).observe(sheetWrap);
    }

    const paint = async () => {
        if (!firstPaint && !box.isConnected) return;
        firstPaint = false;
        try {
            if (!hwMod) hwMod = await import('./handwriting.js');
            const hw = hwMod.getHandwritingState();
            // Ohne eigene Wahl auf der Karte gilt immer die gespeicherte Handschrift (auch wenn Kaydens erst nach dem Laden kommt)
            const prof = activeProfile(hw, selectedProfile);
            const list = allProfiles(hw);
            if (list.length > 1) {
                profSel.hidden = false;
                profSel.replaceChildren(...list.map(p => {
                    const o = document.createElement('option');
                    o.value = p.id;
                    o.textContent = p.master ? `${p.name} (vorgespeichert)` : `${p.name} (${trainedCount(p)})`;
                    if (p.id === prof.id) o.selected = true;
                    return o;
                }));
            } else {
                profSel.hidden = true;
            }
            const res = hwMod.renderHandwritingCanvas(canvas, parsed.text, {
                hw,
                profileObj: prof,
                paper: parsed.paper,
                ink: parsed.ink
            });
            lastW = sheetWrap.clientWidth;
            untrainedBar.hidden = res.trained > 0;
            status.textContent = prof.master
                ? `${prof.name} · ${res.trained} Zeichen, echte Striche`
                : res.trained > 0
                    ? `${prof.name} · ${res.trained} trainierte Zeichen${res.preview > 0 ? ' · Rest in Vorschau-Schrift' : ''}`
                    : `${prof.name} · Vorschau-Handschrift`;
        } catch (err) {
            status.textContent = 'Textansicht';
            rawPre.hidden = false;
        }
    };

    profSel.addEventListener('change', () => {
        selectedProfile = profSel.value;
        paint();
    });
    const openTrainer = async () => {
        if (!hwMod) hwMod = await import('./handwriting.js');
        hwMod.openHandwritingTrainer({ onSaved: () => paint() });
    };
    uBtn.addEventListener('click', openTrainer);
    trainBtn.addEventListener('click', openTrainer);
    nbBtn.addEventListener('click', async () => {
        if (!hwMod) hwMod = await import('./handwriting.js');
        nbBtn.disabled = true;
        try {
            await hwMod.saveHandwritingAsNotebook({
                title: parsed.title || 'Handschrift-Lösung',
                text: parsed.text,
                paper: parsed.paper,
                ink: parsed.ink,
                profile: selectedProfile
            });
        } finally {
            nbBtn.disabled = false;
        }
    });

    const onChanged = () => {
        if (!box.isConnected) {
            document.removeEventListener('codenHandwritingChanged', onChanged);
            return;
        }
        paint();
    };
    document.addEventListener('codenHandwritingChanged', onChanged);
    paint();
    return box;
}
function buildBrowserCard(w) {
    const info = parseBrowserPreview(w.body, w.attrs);
    if (!info.url && !info.title && !info.products.length && !info.snippet) return null;

    const box = mk('div', 'cw-card cw-browser-card');
    const head = mk('div', 'bw-head');
    const favWrap = mk('span', 'bw-fav');
    if (info.domain) {
        const img = document.createElement('img');
        img.src = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(info.domain)}&sz=32`;
        img.alt = '';
        img.referrerPolicy = 'no-referrer';
        img.onerror = () => img.replaceWith(icon('public'));
        favWrap.append(img);
    } else {
        favWrap.append(icon('public'));
    }

    const headText = mk('div', 'bw-head-t');
    headText.append(mk('strong', '', info.title || info.domain || 'Webseite'));
    headText.append(mk('small', '', info.domain || info.url || 'Research-Browser'));
    head.append(favWrap, headText);
    if (info.query) head.append(mk('span', 'bw-q-badge', info.query));
    box.append(head);

    if (info.products.length) {
        const prods = mk('div', 'bw-prods');
        info.products.slice(0, 4).forEach(p => {
            const row = mk('div', 'bw-prod');
            const name = mk('span', 'bw-prod-name', p.title || '');
            const price = p.price ? mk('span', 'bw-prod-price', p.price) : null;
            row.append(name);
            if (price) row.append(price);
            prods.append(row);
        });
        box.append(prods);
    } else if (info.snippet) {
        box.append(mk('p', 'bw-snippet', info.snippet));
    }

    const foot = mk('div', 'bw-foot');
    const openSplitBtn = mk('button', 'qz-primary');
    openSplitBtn.type = 'button';
    openSplitBtn.append(icon('splitscreen'), document.createTextNode('Im Split-Browser öffnen'));
    openSplitBtn.addEventListener('click', () => {
        document.dispatchEvent(new CustomEvent('coden:openBrowser', {
            detail: { url: info.url, query: info.query }
        }));
    });
    foot.append(openSplitBtn);

    if (info.url && /^https?:\/\//i.test(info.url)) {
        const ext = document.createElement('a');
        ext.className = 'qz-ghost bw-ext';
        ext.href = info.url;
        ext.target = '_blank';
        ext.rel = 'noopener noreferrer';
        ext.append(icon('open_in_new'), document.createTextNode('Extern öffnen'));
        foot.append(ext);
    }
    box.append(foot);
    return box;
}
const BUILD = { lernplan: buildLernplan, plot: buildPlot, pie: buildPie, quiz: buildQuiz, flashcards: buildCards, steps: buildSteps, stats: buildStats, proscons: buildProsCons, bars: buildBars, tabs: buildTabs, handwriting: buildHandwriting, browser: buildBrowserCard };

// Fertige Elemente merken, damit ein Quiz beim Weiterschreiben der Antwort seinen Stand behält
const cache = new Map();
const hash = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; };
// Platzhalter im gerenderten HTML durch die echten Elemente ersetzen. md(text, block) -> sicheres HTML
export function hydrateWidgets(root, widgets, md, keyPrefix = '') {
    root.querySelectorAll('.cw[data-cw]').forEach(ph => {
        const w = widgets[+ph.dataset.cw]; if (!w) { ph.remove(); return; }
        let el;
        if (!w.closed) {
            // derselbe Platzhalter wird bei jedem Frame wiederverwendet (kein Flackern, Animation läuft weiter)
            const key = keyPrefix + '|' + ph.dataset.cw + '|' + w.type + '|pending';
            el = (keyPrefix && cache.get(key)) || pending(w.type);
            if (keyPrefix) cache.set(key, el);
            const p = progressOf(w); if (el._sub) el._sub.textContent = p ? p + ' bisher …' : 'Gleich fertig – du kannst es dann direkt benutzen';
        } else {
            const key = keyPrefix + '|' + ph.dataset.cw + '|' + w.type + '|' + hash(w.body);
            el = keyPrefix && cache.get(key);
            if (!el) {
                try { el = BUILD[w.type]?.(w, md) || null; } catch (_) { el = null; }
                if (!el) { el = mk('div', 'md'); el.innerHTML = md(w.body, true); }
                el.classList.add('cw-new'); el.addEventListener('animationend', () => el.classList.remove('cw-new'), { once: true });
                if (keyPrefix) { cache.set(key, el); if (cache.size > 300) cache.delete(cache.keys().next().value); }
            }
        }
        ph.replaceWith(el);
    });
}
