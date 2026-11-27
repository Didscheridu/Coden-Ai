// js/study.js – Schüler-Tab („Lernen“) im Stil von Google Gemini Study Notebooks & Guided Learning:
// Lerninhalte/Quellen speichern, interaktive Karteikarten (3D-Flip + Fortschritt + CSV),
// Quizze (mit Hinweisen & Erklärungen), Lernleitfäden (mit Audio-Vorlesen), Mindmaps
// und Geführtes Lernen (Sokratischer Tutor). Synchronisiert über Storage.saveSettings().

import { generateAiResponse } from './api.js';
import { Storage } from './storage.js';
import { toast } from './toast.js';
import { merkzettelPrompt, cleanMerkzettel, titleOf, renderSheet, printSheet, defaultPaper } from './merkzettel.js';
import { loader } from './rich-elements.js';
import { renderStudioTab, resetStudio } from './study-studio.js';
import { renderNotebooksTab } from './notebooks.js';
import { startStudyLive } from './study-live.js';
import { StudyStore } from './study-store.js';
import { openFlashcardsImportModal, openTextbookScanModal } from './study-scan.js';
import { deAiText } from './humanizer-core.js';
import { isAutoHumanizeOn, updateHumanizerPrefs, getAutoHumanizerPrompt } from './humanizer-prefs.js';

const h = (tag, attrs = {}, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else el.setAttribute(k, v === true ? '' : String(v));
    }
    for (const c of kids.flat()) if (c != null && c !== false) el.append(typeof c === 'string' ? document.createTextNode(c) : c);
    return el;
};
const ic = (name) => h('span', { class: 'material-symbols-outlined', 'aria-hidden': 'true', text: name });
const uid = () => 'nb_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

function loadNotebooks() {
    const s = Storage.getSettings();
    return Array.isArray(s.studyNotebooks) ? s.studyNotebooks : [];
}
function saveNotebooks(list) {
    const s = Storage.getSettings();
    s.studyNotebooks = list.slice(0, 40);
    Storage.saveSettings(s);
}

function activeSourcesText(nb) {
    const active = (nb.sources || []).filter(s => s.active !== false && (s.content || '').trim());
    return active.map((s, i) => `### Quelle ${i + 1}: ${s.title}\n${s.content.slice(0, 8000)}`).join('\n\n').slice(0, 24000);
}

function extractJson(raw) {
    const s = String(raw || '').trim();
    const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const body = fenced ? fenced[1].trim() : s;
    const start = body.search(/[\[{]/);
    if (start === -1) throw new Error('Antwort enthielt kein gültiges JSON.');
    return JSON.parse(body.slice(start));
}

function renderMd(text) {
    const raw = window.marked ? window.marked.parse(String(text || '')) : String(text || '');
    return window.DOMPurify ? window.DOMPurify.sanitize(raw) : raw;
}

const TABS = [['faecher', 'school', 'Fächer'], ['lernhilfen', 'menu_book', 'Lernhilfen'], ['plan', 'event_note', 'Lernplan'], ['stundenplan', 'calendar_month', 'Stundenplan'], ['statistik', 'monitoring', 'Statistik'], ['notizbuecher', 'auto_stories', 'Notizbücher']];
const state = {
    host: null,
    tab: 'faecher',
    activeId: null,
    mobPane: 'center', // sources | center | studio
    activeToolId: null, // null = Geführtes Lernen
    difficulty: 'mittel', // leicht | mittel | schwer
    amount: 'standard',   // weniger | standard | mehr
    focusPrompt: '',
    generating: '',
    addingSource: false,
    // Flashcard session state
    fcIdx: 0,
    fcFlipped: false,
    fcOnlyMissed: false,
    fcExplain: '',
    // Quiz session state
    qIdx: 0,
    qAnswers: {},
    qHintShown: false,
    // Tutor state
    tutorSending: false,
    speaking: false
};

function currentNb(list = loadNotebooks()) {
    return list.find(n => n.id === state.activeId) || null;
}

function updateNb(mutator) {
    const list = loadNotebooks();
    const nb = list.find(n => n.id === state.activeId);
    if (!nb) return null;
    mutator(nb);
    nb.updatedAt = new Date().toISOString();
    saveNotebooks(list);
    return nb;
}

async function generateTool(type) {
    const nb = currentNb();
    if (!nb) return;
    const src = activeSourcesText(nb);
    if (!src) {
        toast('Füge zuerst mindestens einen Lerninhalt (Quelle) links hinzu.', { type: 'warn' });
        state.mobPane = 'sources';
        render();
        return;
    }
    const count = state.amount === 'weniger' ? 5 : state.amount === 'mehr' ? 14 : 9;
    const focus = state.focusPrompt.trim() ? `\nZusätzlicher Fokus des Schülers: ${state.focusPrompt.trim()}` : '';
    let sys = '', user = '';

    if (type === 'sheet') {
        ({ sys, user } = merkzettelPrompt({ src, subject: nb.subject, difficulty: state.difficulty, amount: state.amount, focus: state.focusPrompt.trim() }));
    } else if (type === 'flashcards') {
        sys = 'Du erstellst hochwertige Lern-Karteikarten auf Deutsch. Antworte AUSSCHLIESSLICH mit gültigem JSON ohne Erklärung drumherum.';
        user = `Erstelle genau ${count} Karteikarten (Schwierigkeit: ${state.difficulty}) basierend auf diesen Lerninhalten.${focus}\nFormat: {"title":"Kurzer Titel","cards":[{"front":"Frage oder Begriff","back":"Klare, präzise Antwort"}]}\n\nLERNINHALTE:\n${src}`;
    } else if (type === 'quiz') {
        sys = 'Du erstellst interaktive Multiple-Choice-Quizze auf Deutsch. Antworte AUSSCHLIESSLICH mit gültigem JSON.';
        user = `Erstelle genau ${count} Multiple-Choice-Fragen (Schwierigkeit: ${state.difficulty}) basierend auf diesen Lerninhalten.${focus}\nFormat: {"title":"Quiz-Titel","questions":[{"q":"Frage","options":["A","B","C","D"],"answer":0,"hint":"Kurzer Denk-Hinweis ohne die Lösung zu verraten","explanation":"Klare Erklärung, warum diese Antwort richtig ist"}]}\n\nLERNINHALTE:\n${src}`;
    } else if (type === 'guide') {
        sys = 'Du bist ein erstklassiger Lerncoach. Erstelle einen klaren, gut gegliederten Lernleitfaden in Markdown auf Deutsch.';
        user = `Erstelle einen Lernleitfaden (Schwierigkeit: ${state.difficulty}) mit: 1) Überblick, 2) Wichtigste Konzepte & Fachbegriffe, 3) Merksätze, 4) Typische Prüfungsfragen.${focus}\n\nLERNINHALTE:\n${src}`;
    } else if (type === 'mindmap') {
        sys = 'Du erstellst strukturierte Mindmaps auf Deutsch. Antworte AUSSCHLIESSLICH mit gültigem JSON.';
        user = `Erstelle eine übersichtliche Mindmap (max. 3 Ebenen tief) aus diesen Lerninhalten.${focus}\nFormat: {"title":"Hauptthema","children":[{"title":"Unterthema","children":[{"title":"Detail oder Begriff"}]}]}\n\nLERNINHALTE:\n${src}`;
    }

    const humDir = getAutoHumanizerPrompt('study');
    if (humDir) sys = `${sys}\n\n${humDir}`;

    state.generating = type;
    render();
    try {
        const reply = await generateAiResponse([
            { role: 'system', content: sys },
            { role: 'user', content: user }
        ], 'flash');

        const humOn = isAutoHumanizeOn('study');
        let item = null;
        if (type === 'sheet') {
            const cleaned = cleanMerkzettel(reply);
            const markdown = humOn ? deAiText(cleaned) : cleaned;
            if (markdown.replace(/^#.*$/m, '').trim().length < 40) throw new Error('Der Merkzettel ist leer geblieben.');
            item = { id: uid(), type: 'sheet', title: titleOf(markdown), markdown, paper: defaultPaper(nb.subject), createdAt: new Date().toISOString() };
        } else if (type === 'flashcards') {
            const parsed = extractJson(reply);
            const cards = (parsed.cards || parsed || []).filter(c => c && c.front && c.back).map((c, i) => ({
                id: 'c_' + i + '_' + Date.now().toString(36), front: String(c.front), back: String(c.back), status: null
            }));
            if (!cards.length) throw new Error('Keine Karteikarten erkannt.');
            item = { id: uid(), type: 'flashcards', title: parsed.title || `Karteikarten (${cards.length})`, cards, createdAt: new Date().toISOString() };
        } else if (type === 'quiz') {
            const parsed = extractJson(reply);
            const questions = (parsed.questions || parsed || []).filter(q => q && q.q && Array.isArray(q.options));
            if (!questions.length) throw new Error('Keine Quizfragen erkannt.');
            item = { id: uid(), type: 'quiz', title: parsed.title || `Quiz (${questions.length} Fragen)`, questions, createdAt: new Date().toISOString() };
        } else if (type === 'guide') {
            const guideText = humOn ? deAiText(reply) : String(reply || '').trim();
            item = { id: uid(), type: 'guide', title: `Lernleitfaden (${state.difficulty})`, markdown: guideText, createdAt: new Date().toISOString() };
        } else if (type === 'mindmap') {
            const parsed = extractJson(reply);
            item = { id: uid(), type: 'mindmap', title: parsed.title || 'Mindmap', tree: parsed, createdAt: new Date().toISOString() };
        }

        updateNb((n) => {
            n.tools = Array.isArray(n.tools) ? n.tools : [];
            n.tools.unshift(item);
        });
        state.activeToolId = item.id;
        state.fcIdx = 0; state.fcFlipped = false; state.fcOnlyMissed = false; state.fcExplain = '';
        state.qIdx = 0; state.qAnswers = {}; state.qHintShown = false;
        state.mobPane = 'center';
        toast('Lernhilfe erstellt!', { type: 'ok' });
    } catch (e) {
        toast('Konnte nicht erstellt werden: ' + (e.message || e), { type: 'error' });
    } finally {
        state.generating = ''; state.genStart = 0;
        render();
    }
}

async function sendTutorMessage(text) {
    const msg = String(text || '').trim();
    if (!msg || state.tutorSending) return;
    const nb = currentNb();
    if (!nb) return;
    const src = activeSourcesText(nb);
    updateNb((n) => {
        n.chat = Array.isArray(n.chat) ? n.chat : [];
        n.chat.push({ role: 'user', content: msg });
    });
    state.tutorSending = true;
    render();
    try {
        const updated = currentNb();
        const humDir = getAutoHumanizerPrompt('study');
        const sys = `Du bist der „Geführtes Lernen“-Tutor in Coden AI (wie Gemini Guided Learning).
Regeln:
- Antworte auf Deutsch, ermutigend, klar und strukturiert.
- Gib bei komplexen Fragen nicht sofort alles vor, sondern führe den Schüler Schritt für Schritt mit kurzen Erklärungen und einer gezielten Rückfrage zum echten Verständnis.
- Nutze die Lerninhalte des Schülers als Hauptquelle, wenn vorhanden.
${src ? `\nAKTIVE LERNINHALTE DES SCHÜLERS:\n${src}` : '\n(Noch keine eigenen Quellen hochgeladen – erkläre das Thema allgemein verständlich.)'}${humDir ? '\n\n' + humDir : ''}`;
        const history = (updated.chat || []).slice(-12).map(m => ({ role: m.role, content: m.content }));
        const reply = await generateAiResponse([{ role: 'system', content: sys }, ...history], 'flash');
        updateNb((n) => { n.chat.push({ role: 'assistant', content: String(reply || '').trim() }); });
    } catch (e) {
        toast('Tutor-Fehler: ' + (e.message || e), { type: 'error' });
    } finally {
        state.tutorSending = false;
        render();
        const log = state.host?.querySelector('.st-chat-log');
        if (log) log.scrollTop = log.scrollHeight;
    }
}

function downloadFlashcardsCsv(tool) {
    const esc = (s) => '"' + String(s || '').replace(/"/g, '""') + '"';
    const csv = 'Vorderseite,Rückseite,Status\n' + (tool.cards || []).map(c => `${esc(c.front)},${esc(c.back)},${esc(c.status || '')}`).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = (tool.title || 'karteikarten').replace(/[^\w\-äöüÄÖÜß]+/g, '_') + '.csv';
    document.body.appendChild(a); a.click(); a.remove();
}

function toggleSpeak(text) {
    if (!('speechSynthesis' in window)) { toast('Vorlesen wird in diesem Browser nicht unterstützt.', { type: 'warn' }); return; }
    if (state.speaking) { speechSynthesis.cancel(); state.speaking = false; render(); return; }
    const plain = String(text || '').replace(/[#*_`>-]/g, ' ').slice(0, 8000);
    const u = new SpeechSynthesisUtterance(plain);
    u.lang = 'de-DE';
    u.onend = u.onerror = () => { state.speaking = false; render(); };
    state.speaking = true;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
    render();
}

function openAnkiImport(activeNbId = null) {
    const list = loadNotebooks();
    openFlashcardsImportModal({
        notebooks: list,
        activeNotebookId: activeNbId,
        onImported: ({ notebookId, deckId, title, subject, cards }) => {
            const all = loadNotebooks();
            let nb = notebookId !== '__new__' ? all.find(n => n.id === notebookId) : null;
            if (!nb) {
                nb = {
                    id: uid(), title: title.slice(0, 80), subject,
                    sources: [], tools: [], chat: [],
                    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
                };
                all.unshift(nb);
            }
            nb.tools = Array.isArray(nb.tools) ? nb.tools : [];
            let deck = deckId !== '__new__' ? nb.tools.find(t => t.id === deckId && t.type === 'flashcards') : null;
            if (deck) {
                deck.cards = [...(deck.cards || []), ...cards];
            } else {
                deck = { id: uid(), type: 'flashcards', title, cards, createdAt: new Date().toISOString() };
                nb.tools.unshift(deck);
            }
            nb.updatedAt = new Date().toISOString();
            saveNotebooks(all);
            state.activeId = nb.id;
            state.activeToolId = deck.id;
            state.fcIdx = 0; state.fcFlipped = false; state.fcOnlyMissed = false; state.fcExplain = '';
            state.mobPane = 'center';
            toast(`${cards.length} Karteikarten importiert!`, { type: 'ok' });
            render();
        }
    });
}

function openTextbookScan(activeNbId = null, defaultSubject = '') {
    const list = loadNotebooks();
    openTextbookScanModal({
        notebooks: list,
        activeNotebookId: activeNbId,
        defaultSubject,
        onSavedNotebook: ({ mode, notebookId, subject, result }) => {
            const all = loadNotebooks();
            let nb = notebookId !== '__new__' ? all.find(n => n.id === notebookId) : null;
            if (!nb) {
                nb = {
                    id: uid(), title: result.title || 'Schulbuch-Scan', subject,
                    sources: [], tools: [], chat: [],
                    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
                };
                all.unshift(nb);
            }
            nb.sources = Array.isArray(nb.sources) ? nb.sources : [];
            nb.tools = Array.isArray(nb.tools) ? nb.tools : [];
            if (mode === 'cards') {
                const deck = { id: uid(), type: 'flashcards', title: result.title, cards: result.cards, createdAt: new Date().toISOString() };
                nb.tools.unshift(deck);
                state.activeToolId = deck.id;
                state.fcIdx = 0; state.fcFlipped = false; state.fcOnlyMissed = false; state.fcExplain = '';
                state.mobPane = 'center';
                toast(`${result.cards.length} Karteikarten aus Schulbuch erstellt!`, { type: 'ok' });
            } else {
                const src = { id: uid(), title: result.title || 'Schulbuch-Seite', content: result.text.slice(0, 30000), active: true };
                nb.sources.unshift(src);
                state.activeToolId = null;
                state.mobPane = 'sources';
                toast(`Schulbuch-Scan als Quelle „${src.title}“ gespeichert.`, { type: 'ok' });
            }
            nb.updatedAt = new Date().toISOString();
            saveNotebooks(all);
            state.activeId = nb.id;
            render();
        }
    });
}

function renderOverview() {
    const list = loadNotebooks();
    const wrap = h('div', { class: 'st-wrap' });
    const createBtn = h('button', {
        type: 'button', class: 'btn-save',
        onclick: () => {
            const title = prompt('Name des Lern-Notizbuchs (z. B. Biologie – Genetik):');
            if (!title || !title.trim()) return;
            const subject = prompt('Fach oder Kategorie (optional, z. B. Biologie, Mathe, Geschichte):') || 'Allgemein';
            const nb = { id: uid(), title: title.trim().slice(0, 80), subject: subject.trim().slice(0, 32) || 'Allgemein', sources: [], tools: [], chat: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
            saveNotebooks([nb, ...loadNotebooks()]);
            state.activeId = nb.id; state.activeToolId = null; state.mobPane = 'sources';
            render();
        }
    }, ic('add'), ' Neues Lern-Notizbuch');

    wrap.append(h('div', { class: 'st-head' },
        h('div', {},
            h('h1', { text: 'Lernen & Schüler-Studio' }),
            h('p', { text: 'Speichere deine Unterrichtsnotizen und Lerninhalte in Notizbüchern. Erstelle daraus interaktive Karteikarten, Quizze, Mindmaps oder lerne Schritt für Schritt mit dem Geführten Lernen.' })
        )
    ));
    wrap.append(h('div', { class: 'st-head-acts' },
        h('button', { type: 'button', class: 'btn-cancel', onclick: () => openTextbookScan(null) }, ic('document_scanner'), ' Schulbuch scannen'),
        h('button', { type: 'button', class: 'btn-cancel', onclick: () => openAnkiImport(null) }, ic('upload'), ' Anki / Quizlet-Import'),
        createBtn
    ));

    if (!list.length) {
        const starter = h('div', { class: 'st-col', style: 'padding: 36px 28px; align-items: flex-start;' },
            h('h2', { text: 'Starte dein erstes Lern-Notizbuch' }),
            h('p', { text: 'Lege ein Fach oder Prüfungsthema an, füge deine Notizen oder Texte hinzu und erstelle mit einem Klick Karteikarten, Quizze oder einen Lernleitfaden.' }),
            h('button', {
                type: 'button', class: 'btn-save',
                onclick: () => {
                    const nb = {
                        id: uid(), title: 'Mein erstes Lern-Notizbuch', subject: 'Beispiel',
                        sources: [{ id: uid(), title: 'Fotosynthese – Kurzübersicht', active: true, content: 'Die Fotosynthese ist der Prozess, bei dem Pflanzen mithilfe von Sonnenlicht, Wasser (H2O) und Kohlenstoffdioxid (CO2) Glukose (Zucker) und Sauerstoff (O2) herstellen. Sie findet in den Chloroplasten statt. Man unterscheidet die lichtabhängige Reaktion (in den Thylakoiden, erzeugt ATP und NADPH) und den Calvin-Zyklus (im Stroma, fixiert CO2 zu Glukose).' }],
                        tools: [], chat: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
                    };
                    saveNotebooks([nb]);
                    state.activeId = nb.id; state.activeToolId = null;
                    render();
                }
            }, ic('school'), ' Beispiel-Notizbuch öffnen')
        );
        wrap.append(starter);
        return wrap;
    }

    const grid = h('div', { class: 'st-grid' });
    for (const nb of list) {
        const card = h('div', {
            class: 'st-nb-card', tabindex: '0', role: 'button',
            onclick: () => { state.activeId = nb.id; state.activeToolId = null; state.mobPane = 'center'; render(); }
        },
            h('div', { class: 'st-nb-top' },
                h('span', { class: 'st-nb-tag', text: nb.subject || 'Lernen' }),
                h('button', {
                    type: 'button', class: 'st-nb-del', title: 'Notizbuch löschen',
                    onclick: (e) => {
                        e.stopPropagation();
                        if (!confirm(`Lern-Notizbuch „${nb.title}“ wirklich löschen?`)) return;
                        saveNotebooks(loadNotebooks().filter(x => x.id !== nb.id));
                        render();
                    }
                }, ic('delete'))
            ),
            h('h3', { class: 'st-nb-title', text: nb.title }),
            h('div', { class: 'st-nb-meta' },
                h('span', { text: `${(nb.sources || []).length} Quellen` }),
                h('span', { text: `${(nb.tools || []).length} Lernhilfen` })
            )
        );
        grid.append(card);
    }
    wrap.append(grid);
    return wrap;
}

function renderFlashcards(tool) {
    const all = tool.cards || [];
    const deck = state.fcOnlyMissed ? all.filter(c => c.status === 'missed') : all;
    const box = h('div', { style: 'display:flex;flex-direction:column;gap:16px;' });
    const gotCount = all.filter(c => c.status === 'got').length;
    const missedCount = all.filter(c => c.status === 'missed').length;

    box.append(
        h('div', { class: 'st-mode-bar' },
            h('div', {},
                h('h3', { text: tool.title }),
                h('small', { text: `Gewusst: ${gotCount} · Nochmal üben: ${missedCount} · Gesamt: ${all.length}` })
            ),
            h('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;' },
                h('button', { type: 'button', class: 'btn-cancel', onclick: () => { updateNb(n => { const t = n.tools.find(x => x.id === tool.id); if (t) t.cards.sort(() => Math.random() - 0.5); }); state.fcIdx = 0; state.fcFlipped = false; render(); } }, ic('shuffle'), ' Mischen'),
                h('button', { type: 'button', class: 'btn-cancel', onclick: () => downloadFlashcardsCsv(tool) }, ic('download'), ' CSV')
            )
        ),
        h('div', { class: 'st-progress-bar' }, h('div', { style: `width:${all.length ? Math.round((gotCount / all.length) * 100) : 0}%` }))
    );

    if (!deck.length) {
        box.append(
            h('p', { text: state.fcOnlyMissed ? 'Alle verpassten Karten wurden gemeistert!' : 'Keine Karten in diesem Stapel.' }),
            h('button', { type: 'button', class: 'btn-save', onclick: () => { state.fcOnlyMissed = false; state.fcIdx = 0; render(); } }, 'Alle Karten üben')
        );
        return box;
    }

    if (state.fcIdx >= deck.length) state.fcIdx = 0;
    const card = deck[state.fcIdx];

    const stage = h('div', {
        class: 'st-fc-stage',
        onclick: () => { state.fcFlipped = !state.fcFlipped; render(); }
    },
        h('div', { class: 'st-fc-card' + (state.fcFlipped ? ' flipped' : '') },
            h('div', { class: 'st-fc-face' },
                h('span', { class: 'st-fc-label', text: `Karte ${state.fcIdx + 1} von ${deck.length} · Vorderseite (Klicken zum Umdrehen)` }),
                h('div', { class: 'st-fc-text', text: card.front })
            ),
            h('div', { class: 'st-fc-face st-fc-back' },
                h('span', { class: 'st-fc-label', text: 'Antwort' }),
                h('div', { class: 'st-fc-text', text: card.back })
            )
        )
    );
    box.append(stage);

    const mark = (status) => {
        updateNb(n => {
            const t = n.tools.find(x => x.id === tool.id);
            const c = t?.cards?.find(x => x.id === card.id);
            if (c) c.status = status;
        });
        state.fcFlipped = false; state.fcExplain = '';
        state.fcIdx = (state.fcIdx + 1) % deck.length;
        render();
    };

    box.append(
        h('div', { class: 'st-fc-grade' },
            h('button', { type: 'button', class: 'btn-cancel', onclick: () => mark('missed') }, ic('close'), ' Nochmal üben'),
            h('button', { type: 'button', class: 'btn-save', onclick: () => mark('got') }, ic('check'), ' Gewusst!')
        ),
        h('div', { class: 'st-fc-controls' },
            h('div', { style: 'display:flex;gap:6px;' },
                h('button', { type: 'button', class: 'btn-cancel', onclick: () => { state.fcIdx = (state.fcIdx - 1 + deck.length) % deck.length; state.fcFlipped = false; state.fcExplain = ''; render(); } }, ic('chevron_left'), ' Zurück'),
                h('button', { type: 'button', class: 'btn-cancel', onclick: () => { state.fcIdx = (state.fcIdx + 1) % deck.length; state.fcFlipped = false; state.fcExplain = ''; render(); } }, 'Weiter ', ic('chevron_right'))
            ),
            h('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;' },
                missedCount > 0 && h('button', { type: 'button', class: 'btn-cancel', onclick: () => { state.fcOnlyMissed = !state.fcOnlyMissed; state.fcIdx = 0; state.fcFlipped = false; render(); } }, state.fcOnlyMissed ? 'Alle Karten' : `Nur verpasste (${missedCount})`),
                h('button', {
                    type: 'button', class: 'btn-cancel',
                    onclick: async () => {
                        state.fcExplain = 'Erklärung wird erstellt …'; render();
                        try {
                            const humDir = getAutoHumanizerPrompt('study');
                            state.fcExplain = await generateAiResponse([
                                { role: 'system', content: 'Erkläre diese Lern-Karteikarte einem Schüler kurz, anschaulich und mit einem Beispiel auf Deutsch.' + (humDir ? '\n\n' + humDir : '') },
                                { role: 'user', content: `Frage: ${card.front}\nAntwort: ${card.back}` }
                            ], 'flash');
                        } catch (e) { state.fcExplain = 'Fehler: ' + e.message; }
                        render();
                    }
                }, ic('lightbulb'), ' Erklären')
            )
        )
    );

    if (state.fcExplain) {
        const ex = h('div', { class: 'st-fc-explain' });
        ex.innerHTML = renderMd(state.fcExplain);
        box.append(ex);
    }
    return box;
}

function renderQuiz(tool) {
    const qs = tool.questions || [];
    const box = h('div', { style: 'display:flex;flex-direction:column;gap:16px;' });
    const answeredCount = Object.keys(state.qAnswers).length;
    const correctCount = qs.filter((q, i) => state.qAnswers[i] === q.answer).length;

    box.append(
        h('div', { class: 'st-mode-bar' },
            h('div', {},
                h('h3', { text: tool.title }),
                h('small', { text: `Beantwortet: ${answeredCount} / ${qs.length} · Richtig: ${correctCount}` })
            ),
            h('button', { type: 'button', class: 'btn-cancel', onclick: () => { state.qIdx = 0; state.qAnswers = {}; state.qHintShown = false; render(); } }, ic('refresh'), ' Neu starten')
        ),
        h('div', { class: 'st-progress-bar' }, h('div', { style: `width:${qs.length ? Math.round((answeredCount / qs.length) * 100) : 0}%` }))
    );

    if (!qs.length) return box;

    if (state.qIdx >= qs.length) {
        const pct = Math.round((correctCount / qs.length) * 100);
        const wrong = qs.filter((q, i) => state.qAnswers[i] !== q.answer);
        box.append(
            h('h2', { text: `Ergebnis: ${correctCount} von ${qs.length} richtig (${pct} %)` }),
            h('p', { text: wrong.length ? `Du hattest bei ${wrong.length} Fragen noch Unsicherheiten. Erstelle daraus direkt einen Karteikarten-Stapel zum gezielten Üben!` : 'Perfekt gelöst! Du beherrschst diesen Lernstoff sicher.' }),
            h('div', { style: 'display:flex;gap:10px;flex-wrap:wrap;' },
                h('button', { type: 'button', class: 'btn-cancel', onclick: () => { state.qIdx = 0; state.qAnswers = {}; state.qHintShown = false; render(); } }, 'Quiz wiederholen'),
                wrong.length > 0 && h('button', {
                    type: 'button', class: 'btn-save',
                    onclick: () => {
                        const cards = wrong.map((q, i) => ({ id: 'qf_' + i + '_' + Date.now().toString(36), front: q.q, back: `${q.options[q.answer]} — ${q.explanation || ''}`, status: 'missed' }));
                        const fc = { id: uid(), type: 'flashcards', title: `Fehler-Karten: ${tool.title}`, cards, createdAt: new Date().toISOString() };
                        updateNb(n => { n.tools = [fc, ...(n.tools || [])]; });
                        state.activeToolId = fc.id; state.fcIdx = 0; state.fcFlipped = false;
                        toast('Karteikarten aus falschen Antworten erstellt!', { type: 'ok' });
                        render();
                    }
                }, ic('style'), ' Karteikarten aus Fehlern erstellen')
            )
        );
        return box;
    }

    const q = qs[state.qIdx];
    const picked = state.qAnswers[state.qIdx];
    const hasAnswered = picked !== undefined;

    box.append(
        h('small', { text: `Frage ${state.qIdx + 1} von ${qs.length}` }),
        h('div', { class: 'st-quiz-q', text: q.q })
    );

    const opts = h('div', { class: 'st-quiz-opts' });
    q.options.forEach((opt, idx) => {
        let cls = 'st-quiz-opt';
        if (hasAnswered) {
            if (idx === q.answer) cls += ' ok';
            else if (idx === picked) cls += ' bad';
        }
        opts.append(h('button', {
            type: 'button', class: cls, disabled: hasAnswered,
            onclick: () => { state.qAnswers[state.qIdx] = idx; render(); }
        }, `${String.fromCharCode(65 + idx)}. ${opt}`));
    });
    box.append(opts);

    if (!hasAnswered && q.hint) {
        if (state.qHintShown) {
            box.append(h('div', { class: 'st-quiz-feedback', text: `Hinweis: ${q.hint}` }));
        } else {
            box.append(h('button', { type: 'button', class: 'btn-cancel', style: 'align-self:flex-start;', onclick: () => { state.qHintShown = true; render(); } }, ic('lightbulb'), ' Hinweis anzeigen'));
        }
    }

    if (hasAnswered) {
        box.append(h('div', { class: 'st-quiz-feedback', text: (picked === q.answer ? 'Richtig! ' : 'Nicht ganz. ') + (q.explanation || '') }));
    }

    box.append(h('div', { class: 'st-fc-controls' },
        h('button', { type: 'button', class: 'btn-cancel', disabled: state.qIdx === 0, onclick: () => { state.qIdx--; state.qHintShown = false; render(); } }, ic('chevron_left'), ' Zurück'),
        h('button', { type: 'button', class: 'btn-save', onclick: () => { state.qIdx++; state.qHintShown = false; render(); } }, state.qIdx === qs.length - 1 ? 'Auswertung anzeigen' : 'Nächste Frage')
    ));
    return box;
}

function renderMindmap(node, root = true) {
    if (!node) return h('div');
    const kids = Array.isArray(node.children) ? node.children : [];
    if (!kids.length) return h('div', { class: root ? '' : 'st-mm-node', text: node.title || '' });
    const det = h('details', { open: true, class: root ? '' : 'st-mm-node' },
        h('summary', { class: 'st-mm-title', text: node.title || 'Thema' }),
        ...kids.map(k => renderMindmap(k, false))
    );
    return det;
}

function renderWorkspace(nb) {
    const wrap = h('div', { class: 'st-wrap' });

    wrap.append(h('div', { class: 'st-topbar' },
        h('div', { class: 'st-topbar-left' },
            h('button', { type: 'button', class: 'btn-cancel', onclick: () => { state.activeId = null; state.activeToolId = null; render(); } }, ic('arrow_back'), ' Alle Notizbücher'),
            h('h2', { text: nb.title }),
            h('span', { class: 'st-nb-tag', text: nb.subject || 'Lernen' })
        )
    ));

    // Mobile Tabs
    wrap.append(h('div', { class: 'st-mob-tabs' },
        h('button', { type: 'button', class: state.mobPane === 'sources' ? 'active' : '', onclick: () => { state.mobPane = 'sources'; render(); } }, `Quellen (${(nb.sources || []).length})`),
        h('button', { type: 'button', class: state.mobPane === 'center' ? 'active' : '', onclick: () => { state.mobPane = 'center'; render(); } }, state.activeToolId ? 'Lernhilfe' : 'Lernen'),
        h('button', { type: 'button', class: state.mobPane === 'studio' ? 'active' : '', onclick: () => { state.mobPane = 'studio'; render(); } }, `Studio (${(nb.tools || []).length})`)
    ));

    const ws = h('div', { class: 'st-workspace' });

    // --- 1. LINKE SPALTE: QUELLEN / LERNINHALTE ---
    const fileInput = h('input', {
        type: 'file', accept: '.txt,.md,.csv,.json', style: 'display:none',
        onchange: async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            const txt = (await f.text()).slice(0, 30000);
            updateNb(n => { n.sources = [{ id: uid(), title: f.name, content: txt, active: true }, ...(n.sources || [])]; });
            toast(`Quelle „${f.name}“ gespeichert.`, { type: 'ok' });
            render();
        }
    });

    const colSources = h('section', { class: 'st-col' + (state.mobPane === 'sources' ? ' mob-active' : ''), 'data-pane': 'sources' },
        h('div', { class: 'st-col-head' }, h('h3', {}, ic('menu_book'), ' Lerninhalte')),
        h('div', { class: 'st-src-actions' },
            h('button', { type: 'button', class: 'btn-save', onclick: () => { state.addingSource = !state.addingSource; render(); } }, ic('add'), ' Text'),
            h('button', { type: 'button', class: 'btn-cancel', onclick: () => fileInput.click() }, ic('upload_file'), ' Datei'),
            h('button', { type: 'button', class: 'btn-cancel', title: 'Schulbuch-Seiten abfotografieren oder scannen', onclick: () => openTextbookScan(nb.id, nb.subject || '') }, ic('document_scanner'), ' Buch'),
            fileInput
        )
    );

    if (state.addingSource) {
        const tIn = h('input', { type: 'text', placeholder: 'Titel (z. B. Kapitel 3 – Zellteilung)' });
        const cIn = h('textarea', { placeholder: 'Füge hier deine Notizen, Zusammenfassungen oder Buchtexte ein …' });
        colSources.append(h('div', { class: 'st-add-form' },
            tIn, cIn,
            h('div', { style: 'display:flex;gap:8px;' },
                h('button', {
                    type: 'button', class: 'btn-save', style: 'flex:1;',
                    onclick: () => {
                        if (!cIn.value.trim()) return toast('Bitte Lerninhalt eingeben.', { type: 'warn' });
                        updateNb(n => { n.sources = [{ id: uid(), title: tIn.value.trim() || 'Notiz', content: cIn.value.trim().slice(0, 30000), active: true }, ...(n.sources || [])]; });
                        state.addingSource = false;
                        toast('Lerninhalt gespeichert.', { type: 'ok' });
                        render();
                    }
                }, 'Speichern'),
                h('button', { type: 'button', class: 'btn-cancel', onclick: () => { state.addingSource = false; render(); } }, 'Abbrechen')
            )
        ));
    }

    const srcList = h('div', { class: 'st-src-list' });
    if (!(nb.sources || []).length) {
        srcList.append(h('small', { text: 'Noch keine Quellen. Füge Notizen oder Dateien hinzu, damit Coden daraus Quizze & Karteikarten bauen kann.' }));
    } else {
        for (const s of nb.sources) {
            srcList.append(h('div', { class: 'st-src-item' },
                h('input', {
                    type: 'checkbox', checked: s.active !== false, title: 'Für Generierung verwenden',
                    onchange: (e) => { updateNb(n => { const x = n.sources.find(i => i.id === s.id); if (x) x.active = e.target.checked; }); }
                }),
                h('div', { class: 'st-src-info' },
                    h('strong', { text: s.title }),
                    h('small', { text: `${(s.content || '').length} Zeichen` })
                ),
                h('button', {
                    type: 'button', class: 'st-nb-del', title: 'Quelle entfernen',
                    onclick: () => { updateNb(n => { n.sources = n.sources.filter(i => i.id !== s.id); }); render(); }
                }, ic('close'))
            ));
        }
    }
    colSources.append(srcList);

    // --- 2. MITTLERE SPALTE: GEFÜHRTES LERNEN ODER AKTIVES WERKZEUG ---
    const colCenter = h('section', { class: 'st-col st-center' + (state.mobPane === 'center' ? ' mob-active' : ''), 'data-pane': 'center' });
    const activeTool = (nb.tools || []).find(t => t.id === state.activeToolId);

    if (activeTool) {
        colCenter.append(h('div', { class: 'st-mode-bar' },
            h('button', { type: 'button', class: 'btn-cancel', onclick: () => { state.activeToolId = null; render(); } }, ic('arrow_back'), ' Zurück zu Geführtem Lernen'),
            activeTool.type === 'guide' && h('button', { type: 'button', class: 'btn-cancel', onclick: () => toggleSpeak(activeTool.markdown) }, ic(state.speaking ? 'stop' : 'volume_up'), state.speaking ? ' Stoppen' : ' Audio-Überblick')
        ));
        if (activeTool.type === 'sheet') colCenter.append(renderSheetView(activeTool, nb));
        else if (activeTool.type === 'flashcards') colCenter.append(renderFlashcards(activeTool));
        else if (activeTool.type === 'quiz') colCenter.append(renderQuiz(activeTool));
        else if (activeTool.type === 'guide') {
            const g = h('div', { class: 'st-guide' });
            g.innerHTML = renderMd(activeTool.markdown);
            colCenter.append(g);
        } else if (activeTool.type === 'mindmap') {
            colCenter.append(h('h3', { text: activeTool.title }), renderMindmap(activeTool.tree, true));
        }
    } else {
        colCenter.append(
            h('div', { class: 'st-col-head' },
                h('h3', {}, ic('psychology'), ' Geführtes Lernen (Tutor)'),
                (nb.chat || []).length > 0 && h('button', { type: 'button', class: 'btn-cancel', style: 'padding:5px 10px;font-size:12px;', onclick: () => { updateNb(n => { n.chat = []; }); render(); } }, 'Verlauf leeren')
            )
        );
        const log = h('div', { class: 'st-chat-log' });
        if (!(nb.chat || []).length) {
            log.append(h('p', { text: 'Stelle eine Frage zu deinen gespeicherten Lerninhalten. Der Tutor erklärt Schritt für Schritt und hilft dir mit Rückfragen, das Thema wirklich zu verstehen.' }));
            log.append(h('div', { class: 'st-quick-prompts' },
                ...['Erkläre mir das Hauptthema Schritt für Schritt', 'Frage mich zu meinen Quellen ab', 'Welche 5 Begriffe muss ich für die Prüfung können?'].map(q =>
                    h('button', { type: 'button', class: 'btn-cancel', onclick: () => sendTutorMessage(q) }, q)
                )
            ));
        } else {
            for (const m of nb.chat) {
                const bubble = h('div', { class: 'st-msg ' + (m.role === 'user' ? 'user' : 'ai') });
                if (m.role === 'user') bubble.textContent = m.content;
                else bubble.innerHTML = renderMd(m.content);
                log.append(bubble);
            }
            if (state.tutorSending) log.append(h('small', { text: 'Tutor denkt nach …' }));
        }
        colCenter.append(log);

        const inp = h('input', { type: 'text', placeholder: 'Frage an den Lern-Tutor stellen …', disabled: state.tutorSending });
        const form = h('form', {
            class: 'st-chat-form',
            onsubmit: (e) => { e.preventDefault(); const v = inp.value; inp.value = ''; sendTutorMessage(v); }
        }, inp, h('button', { type: 'submit', class: 'btn-save', disabled: state.tutorSending }, ic('arrow_upward')));
        colCenter.append(form);
    }

    // Während eine Lernhilfe entsteht: gleiche Lade-Animation wie im Chat + was gerade passiert
    if (state.generating) colCenter.prepend(renderGenerating(state.generating));

    // --- 3. RECHTE SPALTE: STUDIO-PANEL (wie Gemini Notebook Studio) ---
    const colStudio = h('section', { class: 'st-col' + (state.mobPane === 'studio' ? ' mob-active' : ''), 'data-pane': 'studio' },
        h('div', { class: 'st-col-head' }, h('h3', {}, ic('auto_awesome'), ' Lern-Studio')),
        h('div', { class: 'st-opt-row' },
            h('label', { text: 'Schwierigkeit' }),
            h('div', { class: 'st-seg' },
                ...['leicht', 'mittel', 'schwer'].map(d => h('button', { type: 'button', class: state.difficulty === d ? 'active' : '', onclick: () => { state.difficulty = d; render(); } }, d[0].toUpperCase() + d.slice(1)))
            )
        ),
        h('div', { class: 'st-opt-row' },
            h('label', { text: 'Umfang' }),
            h('div', { class: 'st-seg' },
                ...[['weniger', 'Kurz'], ['standard', 'Standard'], ['mehr', 'Ausführlich']].map(([k, lbl]) => h('button', { type: 'button', class: state.amount === k ? 'active' : '', onclick: () => { state.amount = k; render(); } }, lbl))
            )
        ),
        h('label', { class: 'st-hz-toggle', title: 'Formuliert Lernhilfen und Tutor-Antworten automatisch natürlich & schülerfreundlich' },
            h('span', { class: 'st-hz-toggle-l' }, ic('auto_fix_high'), h('span', { text: 'Schülerfreundlich (Humanizer)' })),
            h('input', {
                type: 'checkbox',
                checked: isAutoHumanizeOn('study'),
                onchange: (e) => { updateHumanizerPrefs({ study: e.target.checked }); render(); }
            })
        ),
        h('div', { class: 'st-studio-grid' },
            ...[
                ['sheet', 'sticky_note_2', 'Merkzettel', 'Wie handgeschrieben · PDF'],
                ['flashcards', 'style', 'Karteikarten', '3D-Flip & Fortschritt'],
                ['quiz', 'quiz', 'Quiz', 'Mit Hinweisen'],
                ['guide', 'description', 'Lernleitfaden', 'Strukturiert + Audio'],
                ['mindmap', 'account_tree', 'Mindmap', 'Zusammenhänge']
            ].map(([type, icon, title, sub]) => h('button', {
                type: 'button', class: 'st-tool-btn', disabled: !!state.generating,
                onclick: () => generateTool(type)
            }, ic(icon), h('strong', { text: state.generating === type ? 'Erstelle …' : title }), h('small', { text: sub }))),
            h('button', {
                type: 'button', class: 'st-tool-btn',
                onclick: () => openAnkiImport(nb.id)
            }, ic('upload'), h('strong', { text: 'Anki / Quizlet' }), h('small', { text: 'Karten importieren' }))
        )
    );

    if ((nb.tools || []).length) {
        const saved = h('div', { class: 'st-saved-list' }, h('small', { text: 'Gespeicherte Lernhilfen' }));
        const iconMap = { sheet: 'sticky_note_2', flashcards: 'style', quiz: 'quiz', guide: 'description', mindmap: 'account_tree' };
        for (const t of nb.tools) {
            saved.append(h('button', {
                type: 'button', class: 'st-saved-item' + (state.activeToolId === t.id ? ' active' : ''),
                onclick: () => {
                    state.activeToolId = t.id; state.fcIdx = 0; state.fcFlipped = false; state.fcExplain = '';
                    state.qIdx = 0; state.qAnswers = {}; state.qHintShown = false; state.mobPane = 'center';
                    render();
                }
            }, ic(iconMap[t.type] || 'school'), h('span', { class: 't', text: t.title })));
        }
        colStudio.append(saved);
    }

    ws.append(colSources, colCenter, colStudio);
    wrap.append(ws);
    return wrap;
}

const GEN_LABEL = { sheet: 'Schreibt deinen Merkzettel', flashcards: 'Erstellt Karteikarten', quiz: 'Erstellt Quiz', guide: 'Schreibt den Lernleitfaden', mindmap: 'Zeichnet die Mindmap' };
const GEN_STEPS = { sheet: ['Liest deine Lerninhalte', 'Sucht die prüfungsrelevanten Punkte', 'Schreibt Stichpunkte', 'Markiert das Wichtigste'], default: ['Liest deine Lerninhalte', 'Wählt die wichtigsten Punkte', 'Formuliert die Fragen', 'Prüft die Antworten'] };
let genTimer = 0;
function renderGenerating(type) {
    const box = h('div', { class: 'st-generating' });
    const sub = h('small', {});
    const t0 = state.genStart || (state.genStart = Date.now());
    const steps = GEN_STEPS[type] || GEN_STEPS.default;
    const tick = () => { const s = Math.round((Date.now() - t0) / 1000); sub.textContent = steps[Math.min(steps.length - 1, Math.floor(s / 4))] + ' … · ' + s + ' s'; };
    tick(); clearInterval(genTimer); genTimer = setInterval(() => { if (!box.isConnected) { clearInterval(genTimer); genTimer = 0; return; } tick(); }, 1000);
    box.append(loader({ size: 32 }), h('div', {}, h('strong', { text: (GEN_LABEL[type] || 'Erstellt') + ' …' }), sub));
    return box;
}

function renderSheetView(tool, nb) {
    const wrap = h('div', { class: 'mz-view' });
    let sheet = renderSheet(tool, { subject: nb.subject });
    const setPaper = (p) => { updateNb(n => { const t = (n.tools || []).find(x => x.id === tool.id); if (t) t.paper = p; }); tool.paper = p; const next = renderSheet(tool, { subject: nb.subject }); sheet.replaceWith(next); sheet = next; bar.querySelectorAll('[data-paper]').forEach(b => b.classList.toggle('active', b.dataset.paper === p)); };
    const bar = h('div', { class: 'mz-bar' },
        h('div', { class: 'st-seg' }, ...[['karo', 'Karo'], ['liniert', 'Liniert'], ['blanko', 'Blanko']].map(([k, l]) => h('button', { type: 'button', 'data-paper': k, class: (tool.paper || defaultPaper(nb.subject)) === k ? 'active' : '', onclick: () => setPaper(k) }, l))),
        h('button', { type: 'button', class: 'btn-save', onclick: () => printSheet(sheet, tool.title) }, ic('picture_as_pdf'), ' Als PDF speichern')
    );
    wrap.append(bar, h('div', { class: 'mz-scroll' }, sheet));
    return wrap;
}

function render() {
    if (!state.host) return;
    const nb = currentNb();
    if (nb) { state.host.replaceChildren(renderWorkspace(nb)); return; }
    const scroll = state.host.scrollTop;
    const wrap = h('div', { class: 'st-wrap st-home' });
    wrap.append(h('div', { class: 'st-head st-head-live' },
        h('div', {}, h('h1', { text: 'Lern-Studio' }), h('p', { text: 'Fächer, Aufträge, Arbeiten und Hefte an einem Ort. Coden plant mit dir, korrigiert deine Seiten und erinnert dich rechtzeitig.' })),
        h('button', { type: 'button', class: 'cd-primary st-live-btn', title: 'Per Stimme mit Coden über deine Aufgaben reden', onclick: () => startStudyLive({}) }, ic('graphic_eq'), h('span', { text: 'Live mit Coden' }))));
    wrap.append(h('nav', { class: 'st-tabs', role: 'tablist' }, ...TABS.map(([k, icon, label]) => h('button', {
        type: 'button', role: 'tab', class: state.tab === k ? 'active' : '', 'aria-selected': state.tab === k ? 'true' : 'false',
        onclick: () => { if (state.tab === k) resetStudio(); state.tab = k; history.replaceState(null, '', '#/lernen/' + k); render(); }
    }, ic(icon), h('span', { text: label })))));
    if (state.tab === 'lernhilfen') { const ov = renderOverview(); ov.querySelector('.st-head')?.remove(); wrap.append(ov); }
    else if (state.tab === 'notizbuecher') wrap.append(renderNotebooksTab(render));
    else wrap.append(renderStudioTab(state.tab, render));
    state.host.replaceChildren(wrap);
    state.host.scrollTop = scroll;
}
document.addEventListener('studyChanged', () => { if (state.host && !currentNb() && state.tab !== 'lernhilfen' && !document.querySelector('.cd-overlay, .ink-app')) render(); });

export const StudyView = {
    mount(host, params = []) {
        state.host = host;
        if (TABS.some(t => t[0] === params[0])) { state.tab = params[0]; state.activeId = null; }
        render();
        StudyStore.syncReminders();
    },
    unmount() {
        if (state.speaking && 'speechSynthesis' in window) { speechSynthesis.cancel(); state.speaking = false; }
        state.host = null;
    }
};
