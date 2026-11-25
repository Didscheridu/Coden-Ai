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

// ---------- Blöcke finden ----------
export const WIDGETS = ['quiz', 'flashcards', 'steps', 'stats', 'proscons', 'bars', 'tabs'];
const OPEN = new RegExp(`<(${WIDGETS.join('|')})(\\s[^>]*)?>`, 'i');
const attrsOf = (s) => { const a = {}; String(s || '').replace(/([a-zA-Z_-]+)\s*=\s*"([^"]*)"/g, (m, k, v) => { a[k.toLowerCase()] = v; }); return a; };

// Ersetzt jeden Block durch einen Platzhalter <div class="cw" data-cw="n"></div> (auch noch offene Blöcke beim Streamen).
// Liefert { text, widgets: [{ type, attrs, body, closed }] }
export function extractWidgets(text) {
    const widgets = []; const parts = String(text).split(/(```[\s\S]*?(?:```|$))/g);
    const out = parts.map((part, i) => {
        if (i % 2) return part;
        let rest = part, res = '';
        for (;;) {
            const m = rest.match(OPEN); if (!m) { res += rest; break; }
            const type = m[1].toLowerCase(); const start = m.index; const after = start + m[0].length;
            const close = rest.toLowerCase().indexOf(`</${type}>`, after);
            const body = close < 0 ? rest.slice(after) : rest.slice(after, close);
            widgets.push({ type, attrs: attrsOf(m[2]), body: body.replace(/^\n+|\s+$/g, ''), closed: close >= 0 });
            res += rest.slice(0, start) + `\n\n<div class="cw" data-cw="${widgets.length - 1}"></div>\n\n`;
            if (close < 0) { rest = ''; break; }
            rest = rest.slice(close + type.length + 3);
        }
        // halb geschriebener Anfangs-Tag am Ende ("<qu") nicht anzeigen
        return res.replace(/<[a-z]+$/i, (t) => (WIDGETS.some(w => ('<' + w).startsWith(t.toLowerCase())) ? '' : t));
    }).join('');
    return { text: out, widgets };
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

// ---------- Einheitliche Lade-Animation ----------
// loader({ size, logo }) -> Element. Überall gleich: Coden-Logo, darum ein rotierender Farbring.
export function loader({ size = 36, logo = true } = {}) {
    const el = document.createElement('span'); el.className = 'coden-loader' + (logo ? '' : ' no-logo'); el.style.setProperty('--s', size + 'px'); el.setAttribute('role', 'status'); el.setAttribute('aria-label', 'Lädt');
    const ring = document.createElement('span'); ring.className = 'cl-ring'; el.append(ring);
    if (logo) { const img = document.createElement('img'); img.className = 'cl-logo'; img.src = './images/coden_logo.jpg'; img.alt = ''; img.onerror = () => img.remove(); el.append(img); }
    return el;
}

// ---------- Elemente bauen ----------
const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const icon = (name) => mk('span', 'material-symbols-outlined', name);
const LABEL = { quiz: 'Quiz wird erstellt', flashcards: 'Karteikarten werden erstellt', steps: 'Schritte werden geschrieben', stats: 'Kennzahlen werden berechnet', proscons: 'Vor- und Nachteile werden gesammelt', bars: 'Balken werden gezeichnet', tabs: 'Abschnitte werden geschrieben' };

function pending(type) {
    const box = mk('div', 'cw-card cw-pending');
    const l = mk('span', 'cw-pending-text', (LABEL[type] || 'Wird erstellt') + ' …');
    box.append(loader({ size: 26 }), l); return box;
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
const BUILD = { quiz: buildQuiz, flashcards: buildCards, steps: buildSteps, stats: buildStats, proscons: buildProsCons, bars: buildBars, tabs: buildTabs };

// Fertige Elemente merken, damit ein Quiz beim Weiterschreiben der Antwort seinen Stand behält
const cache = new Map();
const hash = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; };
// Platzhalter im gerenderten HTML durch die echten Elemente ersetzen. md(text, block) -> sicheres HTML
export function hydrateWidgets(root, widgets, md, keyPrefix = '') {
    root.querySelectorAll('.cw[data-cw]').forEach(ph => {
        const w = widgets[+ph.dataset.cw]; if (!w) { ph.remove(); return; }
        let el;
        if (!w.closed) el = pending(w.type);
        else {
            const key = keyPrefix + '|' + ph.dataset.cw + '|' + w.type + '|' + hash(w.body);
            el = keyPrefix && cache.get(key);
            if (!el) {
                try { el = BUILD[w.type]?.(w, md) || null; } catch (_) { el = null; }
                if (!el) { el = mk('div', 'md'); el.innerHTML = md(w.body, true); }
                if (keyPrefix) { cache.set(key, el); if (cache.size > 300) cache.delete(cache.keys().next().value); }
            }
        }
        ph.replaceWith(el);
    });
}
