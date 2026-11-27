// js/humanizer.js – Eigene Humanizer-Werkbank unter „Mehr“ (#/humanizer):
// Vorher-Nachher-Vergleich, Stärke-Regler, Live-KI-Muster-Analyse mit Markierung,
// Vorlesen und direkte Übernahme in ein Lernheft (Handschrift oder Text) oder den Chat.
import { streamAiResponse } from './api.js';
import { ownTiers, byokEffort, isByokTier } from './byok.js';
import { Router } from './router.js';
import { toast } from './toast.js';
import { modal } from './apps/dialogs.js';
import { StudyStore } from './study-store.js';
import * as S from './study-core.js';
import { activeProfile } from './handwriting-core.js';
import { createSpeechController, toSpeakableText } from './speech.js';
import { loader } from './rich-elements.js';
import {
    STRENGTH_META,
    PATTERN_CATEGORIES,
    analyzeAiPatterns,
    buildHumanizeRequest,
    computeTextDiff,
    deAiText,
    restoreSegments,
    stepFromStrength,
    strengthFromStep,
    wordCount
} from './humanizer-core.js';
import { getHumanizerPrefs, updateHumanizerPrefs, HUMANIZER_CHANGED_EVENT } from './humanizer-prefs.js';

const DRAFT_KEY = 'coden_humanizer_draft';

const SAMPLE_AI_TEXT = `Es ist wichtig zu beachten, dass die Photosynthese im heutigen Ökosystem eine entscheidende Rolle spielt — sie bildet maßgeblich die Grundlage für nahezu jedes Leben auf der Erde. Darüber hinaus ermöglicht dieser vielschichtige Prozess es Pflanzen, mithilfe von Sonnenlicht aus Kohlenstoffdioxid und Wasser energiereiche Glukose herzustellen.

Nichtsdestotrotz wird häufig unterschätzt, wie essenziell die lichtabhängige Reaktion in den Thylakoiden ist. Folglich lässt sich festhalten:
- **Energiegewinnung:** Im ersten Schritt wird Lichtenergie eingefangen und in ATP umgewandelt.
- **Zuckeraufbau:** Im zweiten Schritt – dem sogenannten Calvin-Zyklus – entsteht daraus schließlich Glukose.

Zusammenfassend lässt sich sagen, dass die Photosynthese ein unabdingbarer Meilenstein der biologischen Evolution darstellt.`;

const h = (tag, attrs = {}, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else if (k === 'value') el.value = v;
        else if (k === 'checked') el.checked = !!v;
        else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else el.setAttribute(k, v === true ? '' : String(v));
    }
    for (const c of kids.flat()) {
        if (c != null && c !== false) el.append(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return el;
};

const ic = (name) => h('span', { class: 'material-symbols-outlined', 'aria-hidden': 'true', text: name });

function loadDraft() {
    try {
        const raw = localStorage.getItem(DRAFT_KEY);
        if (!raw) return null;
        return JSON.parse(raw);
    } catch (_) {
        return null;
    }
}

function saveDraft(data) {
    try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify({
            input: String(data.input || '').slice(0, 25000),
            output: String(data.output || '').slice(0, 25000),
            tier: data.tier || 'flash'
        }));
    } catch (_) {}
}

const stored = loadDraft();
const ui = {
    host: null,
    input: stored?.input || '',
    output: stored?.output || '',
    tier: stored?.tier || 'flash',
    leftMode: 'edit',   // 'edit' | 'analyze'
    rightMode: 'clean', // 'clean' | 'diff'
    activeCat: 'all',   // Filter für KI-Muster-Details
    selectedHitIdx: -1,
    busy: false,
    ac: null,
    speaking: false
};

let pendingRunText = null;
let pendingAutoRun = false;
const speech = createSpeechController();

export function openHumanizerWith(text, { autoRun = false } = {}) {
    const clean = String(text || '').trim();
    if (clean) {
        ui.input = clean;
        ui.output = '';
        ui.leftMode = 'analyze';
        ui.selectedHitIdx = -1;
        saveDraft(ui);
    }
    pendingRunText = clean || null;
    pendingAutoRun = !!autoRun;
    Router.go('humanizer');
}

function modelOptions() {
    const builtins = [['flash', 'Coden Flash'], ['normal', 'Thinking'], ['pro', 'Coden Pro']];
    const own = ownTiers().map(t => [t.tier, t.label]);
    return [...builtins, ...own];
}

function renderAnnotatedText(text, analysis, activeCat, onSelectHit) {
    const wrap = h('div', { class: 'hz-annotated' });
    const src = String(text || '');
    if (!src.trim()) {
        wrap.append(h('p', { class: 'hz-empty-note', text: 'Füge links einen Text ein, um typische KI-Muster automatisch zu erkennen und zu markieren.' }));
        return wrap;
    }

    const items = analysis.items || [];
    let cursor = 0;
    items.forEach((hit, idx) => {
        if (hit.start > cursor) {
            wrap.append(document.createTextNode(src.slice(cursor, hit.start)));
        }
        const dimmed = activeCat !== 'all' && hit.category !== activeCat;
        const mark = h('mark', {
            class: `hz-hit hz-hit-${hit.category}${dimmed ? ' dimmed' : ''}${ui.selectedHitIdx === idx ? ' selected' : ''}`,
            tabindex: '0',
            role: 'button',
            title: `${hit.label}: ${hit.hint}`,
            onclick: () => onSelectHit(idx),
            onkeydown: (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelectHit(idx);
                }
            }
        },
            h('span', { class: 'hz-hit-tag', 'aria-label': hit.label },
                ic(hit.icon),
                h('span', { text: hit.label })
            ),
            document.createTextNode(src.slice(hit.start, hit.end))
        );
        wrap.append(mark);
        cursor = hit.end;
    });
    if (cursor < src.length) {
        wrap.append(document.createTextNode(src.slice(cursor)));
    }
    return wrap;
}

function renderDiffView(before, after) {
    const box = h('div', { class: 'hz-diff' });
    if (!String(after || '').trim()) {
        box.append(h('p', { class: 'hz-empty-note', text: 'Klicke auf „Text humanisieren“, um den Vorher-Nachher-Vergleich zu sehen.' }));
        return box;
    }
    const ops = computeTextDiff(before, after);
    for (const op of ops) {
        if (op.type === 'same') {
            box.append(document.createTextNode(op.text));
        } else if (op.type === 'del') {
            box.append(h('del', { class: 'hz-diff-del', title: 'Entfernt / ersetzt', text: op.text }));
        } else {
            box.append(h('ins', { class: 'hz-diff-add', title: 'Neu formuliert', text: op.text }));
        }
    }
    return box;
}

async function openNotebookTransferDialog(text) {
    const cleanText = String(text || '').trim();
    if (!cleanText) {
        toast('Es gibt noch keinen humanisierten Text zum Übernehmen.', { type: 'warn' });
        return;
    }

    const st = StudyStore.get();
    const docs = S.sortDocs(st.docs || [], 'bearbeitet');

    const targetSelect = h('select', { class: 'cd-input' },
        ...docs.map(d => {
            const su = S.subjectOf(st, d.subjectId);
            return h('option', { value: d.id, text: `${d.title}${su ? ` (${su.name})` : ''} · ${d.pages?.length || 0} S.` });
        }),
        h('option', { value: '__new__', ...(docs.length ? {} : { selected: true }), text: '+ Neues Lernheft erstellen' })
    );

    const newTitleInput = h('input', {
        class: 'cd-input',
        placeholder: 'Name des neuen Lernhefts (z. B. Biologie – Photosynthese)',
        value: 'Humanisierte Notiz'
    });
    const newPaperSelect = h('select', { class: 'cd-input' },
        h('option', { value: 'liniert', text: 'Liniert' }),
        h('option', { value: 'karo', text: 'Kariert' }),
        h('option', { value: 'blanko', text: 'Blanko' })
    );
    const newSubjectSelect = h('select', { class: 'cd-input' },
        h('option', { value: '', text: 'Kein Fach' }),
        ...(st.subjects || []).map(su => h('option', { value: su.id, text: su.name }))
    );

    const newFields = h('div', { class: 'hz-nb-new-fields', ...(docs.length ? { hidden: true } : {}) },
        h('label', { class: 'sd-field' }, h('span', { text: 'Heft-Titel' }), newTitleInput),
        h('div', { class: 'hz-nb-grid-2' },
            h('label', { class: 'sd-field' }, h('span', { text: 'Papier' }), newPaperSelect),
            h('label', { class: 'sd-field' }, h('span', { text: 'Fach (optional)' }), newSubjectSelect)
        )
    );

    const syncNewVisibility = () => {
        newFields.hidden = targetSelect.value !== '__new__';
    };
    targetSelect.addEventListener('change', syncNewVisibility);

    let insertFormat = 'handwriting';
    const hwOpt = h('button', {
        type: 'button',
        class: 'sc-goal on',
        onclick: () => {
            insertFormat = 'handwriting';
            hwOpt.classList.add('on');
            txtOpt.classList.remove('on');
        }
    },
        ic('stylus_note'),
        h('b', { text: 'In meiner Handschrift' }),
        h('small', { text: 'Schreibt den Text als echte Handschrift-Striche auf neue Heftseiten.' })
    );
    const txtOpt = h('button', {
        type: 'button',
        class: 'sc-goal',
        onclick: () => {
            insertFormat = 'text';
            txtOpt.classList.add('on');
            hwOpt.classList.remove('on');
        }
    },
        ic('post_add'),
        h('b', { text: 'Als Textnotiz' }),
        h('small', { text: 'Fügt den Text editierbar als Textblock auf einer neuen Seite ein.' })
    );

    const applyBtn = h('button', { type: 'button', class: 'cd-primary' }, ic('auto_stories'), ' Ins Lernheft übernehmen');
    const body = h('div', { class: 'sd-form hz-transfer-form' },
        h('label', { class: 'sd-field' }, h('span', { text: 'Ziel-Lernheft' }), targetSelect),
        newFields,
        h('div', { class: 'sd-field' },
            h('span', { text: 'Darstellung im Heft' }),
            h('div', { class: 'sc-goals' }, hwOpt, txtOpt)
        ),
        h('div', { class: 'cd-row end' },
            h('button', { type: 'button', class: 'cd-btn', onclick: () => m.close() }, 'Abbrechen'),
            applyBtn
        )
    );

    const m = modal('In Lernheft übernehmen', body, { wide: true });

    applyBtn.addEventListener('click', async () => {
        applyBtn.disabled = true;
        applyBtn.replaceChildren(loader({ size: 18 }), ' Wird übertragen …');
        try {
            const inkMod = await import('./ink.js');
            const freshStore = StudyStore.get();
            let doc = targetSelect.value !== '__new__'
                ? freshStore.docs.find(d => d.id === targetSelect.value)
                : null;
            if (!doc) {
                doc = S.newDoc(freshStore, {
                    title: newTitleInput.value.trim() || 'Humanisierte Notiz',
                    subjectId: newSubjectSelect.value || null,
                    paper: newPaperSelect.value || 'liniert'
                });
            }

            const paper = doc.paper || newPaperSelect.value || 'liniert';
            const startIdx = (doc.pages || []).length;

            if (insertFormat === 'handwriting') {
                const { notebookPagesFor } = await import('./handwriting.js');
                const prof = activeProfile(StudyStore.handwriting());
                const nbRes = notebookPagesFor(cleanText, prof, { paper, origin: 'coden' });
                for (let i = 0; i < nbRes.pages.length; i++) {
                    const pid = inkMod.newPageId();
                    await inkMod.savePage({
                        id: pid,
                        doc: doc.id,
                        idx: startIdx + i,
                        paper: nbRes.paper || paper,
                        strokes: inkMod.encodeStrokes(nbRes.pages[i]),
                        text: [],
                        items: []
                    }, { withBg: true });
                    doc.pages.push(pid);
                }
            } else {
                const pid = inkMod.newPageId();
                const lines = cleanText.split('\n');
                const chunk = lines.join('\n');
                await inkMod.savePage({
                    id: pid,
                    doc: doc.id,
                    idx: startIdx,
                    paper,
                    strokes: '[]',
                    text: [{ x: 112, y: 120, s: chunk.slice(0, 4000), c: '#1b1f2a', z: 22 }],
                    items: []
                }, { withBg: true });
                doc.pages.push(pid);
            }

            doc.updatedAt = new Date().toISOString();
            StudyStore.save(freshStore);
            m.close();
            toast(`In „${doc.title}“ übernommen.`, { type: 'ok' });

            const { openNotebook } = await import('./notebooks.js');
            openNotebook(freshStore, doc);
        } catch (err) {
            toast('Übernahme fehlgeschlagen: ' + (err.message || err), { type: 'error' });
            applyBtn.disabled = false;
            applyBtn.replaceChildren(ic('auto_stories'), ' Ins Lernheft übernehmen');
        }
    });
}

function sendToChat(text, { sendImmediately = false } = {}) {
    const cleanText = String(text || '').trim();
    if (!cleanText) {
        toast('Es gibt noch keinen humanisierten Text zum Übernehmen.', { type: 'warn' });
        return;
    }
    const prompt = sendImmediately
        ? `Hier ist mein überarbeiteter Text:\n\n${cleanText}`
        : cleanText;
    document.dispatchEvent(new CustomEvent('coden:compose', {
        detail: { text: prompt, send: sendImmediately }
    }));
    toast(sendImmediately ? 'An den Chat gesendet.' : 'Ins Chat-Eingabefeld übernommen.', { type: 'ok' });
}

async function runHumanize() {
    if (ui.busy) {
        ui.ac?.abort();
        return;
    }
    const raw = String(ui.input || '').trim();
    if (!raw) {
        toast('Bitte füge zuerst einen Text ein.', { type: 'warn' });
        return;
    }

    const prefs = getHumanizerPrefs();
    const { system, user, tokens } = buildHumanizeRequest({
        text: raw,
        strength: prefs.strength,
        keepTerms: prefs.keepTerms,
        shortSentences: prefs.shortSentences,
        duTone: prefs.duTone
    });

    ui.busy = true;
    ui.ac = new AbortController();
    ui.output = '';
    ui.rightMode = 'clean';
    render();

    const restore = (chunk) => restoreSegments(chunk, tokens);

    try {
        const finalReply = await streamAiResponse([
            { role: 'system', content: system },
            { role: 'user', content: user }
        ], ui.tier, {
            signal: ui.ac.signal,
            effort: isByokTier(ui.tier) ? byokEffort(ui.tier) : undefined,
            onDelta: (partial) => {
                ui.output = deAiText(restore(partial), { stripIntro: true });
                updateOutputDomOnly();
            }
        });
        ui.output = deAiText(restore(finalReply || ui.output), { stripIntro: true });
        saveDraft(ui);
    } catch (err) {
        if (err?.name === 'AbortError' || ui.ac?.signal?.aborted) {
            toast('Humanisieren gestoppt.', { type: 'info' });
        } else {
            toast('Humanizer-Fehler: ' + (err?.message || err), { type: 'error' });
        }
    } finally {
        ui.busy = false;
        ui.ac = null;
        render();
    }
}

function updateOutputDomOnly() {
    if (!ui.host) return;
    const outEl = ui.host.querySelector('.hz-output-text');
    if (outEl) {
        outEl.textContent = ui.output;
        outEl.classList.toggle('streaming', ui.busy);
    }
}

function updateLiveMetricsInDom() {
    if (!ui.host) return;
    const beforeAnalysis = analyzeAiPatterns(ui.input);
    const metaEl = ui.host.querySelector('.hz-left-meta');
    if (metaEl) {
        metaEl.textContent = `${wordCount(ui.input)} Wörter · ${beforeAnalysis.total} KI-Muster`;
    }
}

function render() {
    if (!ui.host) return;
    const scrollPos = ui.host.scrollTop;
    const prefs = getHumanizerPrefs();
    const strength = prefs.strength;
    const meta = STRENGTH_META[strength] || STRENGTH_META.balanced;

    const beforeAnalysis = analyzeAiPatterns(ui.input);
    const afterAnalysis = analyzeAiPatterns(ui.output);

    const wrap = h('div', { class: 'hz-page' });

    // --- Kopfzeile ---
    const opts = modelOptions();
    if (!opts.some(([v]) => v === ui.tier)) ui.tier = 'flash';
    const tierSel = h('select', {
        class: 'cd-input hz-tier',
        'aria-label': 'KI-Modell für den Humanizer wählen',
        onchange: (e) => { ui.tier = e.target.value; saveDraft(ui); }
    }, ...opts.map(([v, l]) => h('option', { value: v, text: l, ...(ui.tier === v ? { selected: true } : {}) })));

    const head = h('header', { class: 'hz-head' },
        h('div', { class: 'hz-head-title' },
            h('div', { class: 'hz-title-row' },
                ic('auto_fix_high'),
                h('h1', { text: 'Humanizer' })
            ),
            h('p', { text: 'Macht KI-Texte natürlich und schülerfreundlich, markiert KI-Muster und übernimmt Ergebnisse direkt ins Lernheft oder den Chat.' })
        ),
        h('div', { class: 'hz-head-actions' },
            tierSel,
            h('button', {
                type: 'button',
                class: 'cd-btn',
                onclick: () => {
                    ui.input = SAMPLE_AI_TEXT;
                    ui.leftMode = 'analyze';
                    ui.activeCat = 'all';
                    ui.selectedHitIdx = -1;
                    saveDraft(ui);
                    render();
                }
            }, ic('science'), ' Beispiel laden'),
            h('button', {
                type: 'button',
                class: 'cd-btn',
                disabled: !ui.input && !ui.output,
                onclick: () => {
                    if (ui.speaking) speech.stop();
                    ui.input = '';
                    ui.output = '';
                    ui.leftMode = 'edit';
                    ui.selectedHitIdx = -1;
                    saveDraft(ui);
                    render();
                }
            }, ic('delete_sweep'), ' Leeren')
        )
    );

    // --- Automatischer Schreibstil in Coden (umschaltbar pro Bereich) ---
    const scopeToggle = (key, icon, label) => {
        const on = prefs[key] !== false;
        return h('label', { class: 'hz-scope-chk' + (on ? ' on' : '') },
            h('input', {
                type: 'checkbox',
                checked: on,
                onchange: (e) => updateHumanizerPrefs({ [key]: e.target.checked })
            }),
            ic(icon),
            h('span', { text: label })
        );
    };
    const autoStrip = h('section', { class: 'hz-auto-strip', 'aria-label': 'Automatischer Humanizer pro Bereich' },
        h('div', { class: 'hz-auto-label' },
            ic('tune'),
            h('strong', { text: 'Automatisch natürlich formulieren in:' })
        ),
        h('div', { class: 'hz-scope-row' },
            scopeToggle('notebooks', 'auto_stories', 'Lernhefte'),
            scopeToggle('study', 'school', 'Lern-Studio'),
            scopeToggle('chat', 'chat', 'Chat-Antworten')
        )
    );

    // --- Steuerleiste: Stärke-Regler + Optionen + Hauptaktion ---
    const slider = h('input', {
        type: 'range',
        min: '1',
        max: '3',
        step: '1',
        value: String(stepFromStrength(strength)),
        class: 'hz-slider',
        'aria-label': 'Stärke des Humanizers',
        oninput: (e) => {
            const nextStrength = strengthFromStep(e.target.value);
            updateHumanizerPrefs({ strength: nextStrength });
        }
    });

    const stepButtons = ['gentle', 'balanced', 'strong'].map(id => {
        const m = STRENGTH_META[id];
        return h('button', {
            type: 'button',
            class: 'hz-step-btn' + (strength === id ? ' active' : ''),
            onclick: () => updateHumanizerPrefs({ strength: id })
        }, m.label);
    });

    const prefChk = (key, label) => h('label', { class: 'hz-opt-chk' },
        h('input', {
            type: 'checkbox',
            checked: prefs[key] !== false,
            onchange: (e) => updateHumanizerPrefs({ [key]: e.target.checked })
        }),
        h('span', { text: label })
    );

    const runBtn = h('button', {
        type: 'button',
        class: 'cd-primary hz-run-btn',
        disabled: !ui.input.trim() && !ui.busy,
        onclick: () => runHumanize()
    }, ui.busy ? [loader({ size: 18 }), h('span', { text: 'Stoppen' })] : [ic('auto_fix_high'), h('span', { text: 'Text humanisieren' })]);

    const controls = h('section', { class: 'hz-controls' },
        h('div', { class: 'hz-strength-box' },
            h('div', { class: 'hz-strength-head' },
                h('span', { class: 'hz-ctrl-title', text: 'Stärke-Regler' }),
                h('strong', { class: 'hz-strength-val', text: `${meta.label} · ${meta.short}` })
            ),
            slider,
            h('div', { class: 'hz-step-labels' }, ...stepButtons),
            h('p', { class: 'hz-strength-desc', text: meta.desc })
        ),
        h('div', { class: 'hz-options-box' },
            h('span', { class: 'hz-ctrl-title', text: 'Schreibstil: Natürlich & schülerfreundlich' }),
            h('div', { class: 'hz-opt-list' },
                prefChk('keepTerms', 'Fachbegriffe behalten'),
                prefChk('shortSentences', 'Kurze, klare Sätze'),
                prefChk('duTone', 'Freundlicher Schüler-/Du-Ton')
            ),
            h('div', { class: 'hz-run-wrap' }, runBtn)
        )
    );

    // --- Linke Spalte: Vorher & KI-Muster-Analyse ---
    const textarea = h('textarea', {
        class: 'hz-textarea',
        placeholder: 'Füge hier einen Text ein oder schreibe selbst – Coden erkennt typische KI-Wörter, Gedankenstriche und Schachtelsätze sofort …',
        value: ui.input,
        oninput: (e) => {
            ui.input = e.target.value;
            ui.selectedHitIdx = -1;
            saveDraft(ui);
            updateLiveMetricsInDom();
            const rBtn = ui.host?.querySelector('.hz-run-btn');
            if (rBtn && !ui.busy) rBtn.disabled = !ui.input.trim();
        }
    });
    textarea.value = ui.input;

    const leftBody = ui.leftMode === 'analyze'
        ? renderAnnotatedText(ui.input, beforeAnalysis, ui.activeCat, (idx) => {
            ui.selectedHitIdx = ui.selectedHitIdx === idx ? -1 : idx;
            render();
        })
        : textarea;

    // Muster-Kategorien mit Icon + Text (nie nur Farbe)
    const catButtons = [
        h('button', {
            type: 'button',
            class: 'hz-cat-btn' + (ui.activeCat === 'all' ? ' active' : ''),
            onclick: () => { ui.activeCat = 'all'; ui.leftMode = 'analyze'; render(); }
        }, ic('analytics'), h('span', { text: `Alle (${beforeAnalysis.total})` }))
    ];
    for (const [catId, catMeta] of Object.entries(PATTERN_CATEGORIES)) {
        const count = beforeAnalysis.countsByCategory[catId] || 0;
        if (!count) continue;
        catButtons.push(h('button', {
            type: 'button',
            class: `hz-cat-btn hz-cat-${catId}${ui.activeCat === catId ? ' active' : ''}`,
            onclick: () => {
                ui.activeCat = ui.activeCat === catId ? 'all' : catId;
                ui.leftMode = 'analyze';
                render();
            }
        }, ic(catMeta.icon), h('span', { text: `${catMeta.label}: ${count}` })));
    }

    const activeHit = ui.selectedHitIdx >= 0 ? beforeAnalysis.items[ui.selectedHitIdx] : null;
    const hitDetail = activeHit
        ? h('div', { class: 'hz-hit-detail' },
            ic(activeHit.icon),
            h('div', {},
                h('strong', { text: `${activeHit.label}: „${activeHit.match.slice(0, 60)}${activeHit.match.length > 60 ? '…' : ''}“` }),
                h('p', { text: `${activeHit.hint} Tipp: ${activeHit.suggestion}.` })
            )
        )
        : null;

    const leftPane = h('section', { class: 'hz-pane' },
        h('div', { class: 'hz-pane-head' },
            h('div', { class: 'hz-pane-title' },
                h('h2', { text: 'Vorher (Original)' }),
                h('small', { class: 'hz-left-meta', text: `${wordCount(ui.input)} Wörter · ${beforeAnalysis.total} KI-Muster` })
            ),
            h('div', { class: 'st-seg' },
                h('button', {
                    type: 'button',
                    class: ui.leftMode === 'edit' ? 'active' : '',
                    onclick: () => { ui.leftMode = 'edit'; render(); }
                }, 'Eingabe'),
                h('button', {
                    type: 'button',
                    class: ui.leftMode === 'analyze' ? 'active' : '',
                    onclick: () => { ui.leftMode = 'analyze'; render(); }
                }, `KI-Muster-Analyse (${beforeAnalysis.total})`)
            )
        ),
        h('div', { class: 'hz-pane-body' }, leftBody),
        h('div', { class: 'hz-pane-foot' },
            h('div', { class: 'hz-cat-bar' }, ...catButtons),
            hitDetail
        )
    );

    // --- Rechte Spalte: Nachher (Humanisiert & Übernahme) ---
    let rightBody;
    if (ui.rightMode === 'diff') {
        rightBody = renderDiffView(ui.input, ui.output);
    } else if (!ui.output && !ui.busy) {
        rightBody = h('div', { class: 'hz-empty-out' },
            ic('edit_note'),
            h('p', { text: 'Hier erscheint deine natürlich formulierte Version zum Vergleichen, Vorlesen und Übernehmen.' })
        );
    } else {
        rightBody = h('div', { class: 'hz-output-text' + (ui.busy ? ' streaming' : ''), text: ui.output || (ui.busy ? 'Formuliert um …' : '') });
    }

    const speakBtn = h('button', {
        type: 'button',
        class: 'cd-btn' + (ui.speaking ? ' active' : ''),
        disabled: !ui.output.trim(),
        onclick: () => {
            if (!ui.output.trim()) return;
            speech.speak(toSpeakableText(ui.output) || ui.output, {
                key: 'humanizer-output',
                raw: true,
                onStart: () => { ui.speaking = true; render(); },
                onEnd: () => { ui.speaking = false; render(); },
                onError: () => { ui.speaking = false; toast('Vorlesen nicht verfügbar.', { type: 'warn' }); render(); }
            });
        }
    }, ic(ui.speaking ? 'stop_circle' : 'volume_up'), ui.speaking ? ' Stoppen' : ' Vorlesen');

    const copyBtn = h('button', {
        type: 'button',
        class: 'cd-btn',
        disabled: !ui.output.trim(),
        onclick: async () => {
            try {
                await navigator.clipboard.writeText(ui.output);
                toast('Humanisierten Text kopiert.', { type: 'ok' });
            } catch (_) {
                toast('Kopieren fehlgeschlagen.', { type: 'warn' });
            }
        }
    }, ic('content_copy'), ' Kopieren');

    const retryBtn = h('button', {
        type: 'button',
        class: 'cd-btn',
        disabled: !ui.input.trim() || ui.busy,
        onclick: () => runHumanize()
    }, ic('refresh'), ' Neu variieren');

    const toNotebookBtn = h('button', {
        type: 'button',
        class: 'cd-primary',
        disabled: !ui.output.trim() || ui.busy,
        onclick: () => openNotebookTransferDialog(ui.output)
    }, ic('auto_stories'), ' In Lernheft');

    const toChatBtn = h('button', {
        type: 'button',
        class: 'cd-btn',
        disabled: !ui.output.trim() || ui.busy,
        onclick: () => sendToChat(ui.output, { sendImmediately: false })
    }, ic('chat'), ' In Chat übernehmen');

    const rightMeta = ui.output.trim()
        ? `${wordCount(ui.output)} Wörter · KI-Muster: ${beforeAnalysis.total} → ${afterAnalysis.total}`
        : 'Bereit';

    const rightPane = h('section', { class: 'hz-pane' },
        h('div', { class: 'hz-pane-head' },
            h('div', { class: 'hz-pane-title' },
                h('h2', { text: 'Nachher (Schülerfreundlich)' }),
                h('small', { text: rightMeta })
            ),
            h('div', { class: 'st-seg' },
                h('button', {
                    type: 'button',
                    class: ui.rightMode === 'clean' ? 'active' : '',
                    onclick: () => { ui.rightMode = 'clean'; render(); }
                }, 'Fertiger Text'),
                h('button', {
                    type: 'button',
                    class: ui.rightMode === 'diff' ? 'active' : '',
                    onclick: () => { ui.rightMode = 'diff'; render(); }
                }, 'Änderungen')
            )
        ),
        h('div', { class: 'hz-pane-body' }, rightBody),
        h('div', { class: 'hz-pane-foot hz-out-actions' },
            h('div', { class: 'hz-act-group' }, speakBtn, copyBtn, retryBtn),
            h('div', { class: 'hz-act-group' }, toChatBtn, toNotebookBtn)
        )
    );

    const grid = h('div', { class: 'hz-grid' }, leftPane, rightPane);
    wrap.append(head, autoStrip, controls, grid);
    ui.host.replaceChildren(wrap);
    ui.host.scrollTop = scrollPos;
}

const onPrefsChanged = () => {
    if (ui.host && !ui.busy) render();
};

export const HumanizerView = {
    mount(host) {
        ui.host = host;
        window.addEventListener(HUMANIZER_CHANGED_EVENT, onPrefsChanged);
        if (pendingRunText) {
            ui.input = pendingRunText;
            pendingRunText = null;
        }
        render();
        if (pendingAutoRun && ui.input.trim()) {
            pendingAutoRun = false;
            runHumanize();
        } else {
            pendingAutoRun = false;
        }
    },
    unmount() {
        window.removeEventListener(HUMANIZER_CHANGED_EVENT, onPrefsChanged);
        if (ui.speaking) {
            speech.stop();
            ui.speaking = false;
        }
        ui.ac?.abort();
        ui.ac = null;
        ui.busy = false;
        ui.host = null;
    }
};
