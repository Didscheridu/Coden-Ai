// js/study-scan.js – UI-Modale für Feature #10:
// 1) Anki- / Quizlet-Import (.txt, .csv, .tsv & Copy-Paste mit Live-Vorschau)
// 2) Schulbuch-Seiten-Scanner (1–3 Fotos/PDF → Lernnotiz, Karteikarten, Aufgabenlösung oder direkt ins Handschrift-Heft)
import { modal } from './apps/dialogs.js';
import { toast } from './toast.js';
import { apiJson } from './backend.js';
import { loader } from './rich-elements.js';
import { parseFlashcardsImport, delimiterLabel, textbookScanPrompts, parseTextbookScan } from './study-import-core.js';

const h = (tag, attrs = {}, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else if (k === 'value') el.value = v;
        else if (k === 'checked') el.checked = !!v;
        else el.setAttribute(k, v === true ? '' : String(v));
    }
    for (const c of kids.flat()) if (c != null && c !== false) el.append(typeof c === 'string' ? document.createTextNode(c) : c);
    return el;
};
const ic = (n) => h('span', { class: 'material-symbols-outlined', 'aria-hidden': 'true', text: n });

// ---------- 1. Anki / Quizlet Import Modal ----------
export function openFlashcardsImportModal({ notebooks = [], activeNotebookId = null, onImported } = {}) {
    let rawText = '';
    let delim = 'auto';
    let targetNbId = activeNotebookId || (notebooks[0]?.id || '__new__');
    let targetDeckId = '__new__';

    const titleIn = h('input', { class: 'cd-input', placeholder: 'Stapel-Name (z. B. Englisch Unit 4 oder Bio Genetik)' });
    const newNbSubjectIn = h('input', { class: 'cd-input', placeholder: 'Fach (optional, z. B. Englisch)' });
    const delimSel = h('select', { class: 'cd-input' },
        ...[
            ['auto', 'Automatisch erkennen'],
            ['tab', 'Tabulator (Anki / Quizlet)'],
            [';', 'Semikolon (;)'],
            [',', 'Komma (,)'],
            [' :: ', 'Doppelpunkt ( :: )'],
            [' - ', 'Bindestrich ( - )']
        ].map(([v, l]) => h('option', { value: v, text: l }))
    );

    const nbSel = h('select', { class: 'cd-input' });
    const deckSel = h('select', { class: 'cd-input' });
    const newNbRow = h('div', { class: 'sc-field-row', hidden: true },
        h('label', { class: 'sd-field' }, h('span', { text: 'Fach für neues Lern-Notizbuch' }), newNbSubjectIn)
    );

    const syncTargets = () => {
        nbSel.replaceChildren(
            ...notebooks.map(n => h('option', { value: n.id, text: `${n.title}${n.subject ? ` (${n.subject})` : ''}`, ...(n.id === targetNbId ? { selected: true } : {}) })),
            h('option', { value: '__new__', text: '+ Neues Lern-Notizbuch anlegen', ...(targetNbId === '__new__' ? { selected: true } : {}) })
        );
        const nb = notebooks.find(n => n.id === targetNbId);
        const existingDecks = (nb?.tools || []).filter(t => t.type === 'flashcards');
        deckSel.replaceChildren(
            h('option', { value: '__new__', text: 'Als neuen Karteikarten-Stapel speichern' }),
            ...existingDecks.map(d => h('option', { value: d.id, text: `An „${d.title}“ anhängen (${(d.cards || []).length})` }))
        );
        if (!existingDecks.some(d => d.id === targetDeckId)) targetDeckId = '__new__';
        deckSel.value = targetDeckId;
        newNbRow.hidden = targetNbId !== '__new__';
        titleIn.disabled = targetDeckId !== '__new__';
    };

    nbSel.addEventListener('change', () => { targetNbId = nbSel.value; syncTargets(); });
    deckSel.addEventListener('change', () => { targetDeckId = deckSel.value; titleIn.disabled = targetDeckId !== '__new__'; });

    const textIn = h('textarea', {
        class: 'cd-input sc-textarea',
        rows: 7,
        placeholder: 'Füge hier deine Anki- oder Quizlet-Karten ein (z. B. per Copy-Paste):\nphotosynthesis\tFotosynthese\nmitochondria\tKraftwerk der Zelle'
    });

    const fileIn = h('input', { type: 'file', accept: '.txt,.csv,.tsv,text/plain,text/csv', hidden: true });
    const uploadBtn = h('button', { type: 'button', class: 'cd-btn', onclick: () => fileIn.click() }, ic('upload_file'), ' Anki .txt / .csv wählen');
    fileIn.addEventListener('change', async () => {
        const f = fileIn.files?.[0];
        if (!f) return;
        rawText = await f.text();
        textIn.value = rawText;
        if (!titleIn.value.trim()) titleIn.value = f.name.replace(/\.[a-z0-9]+$/i, '').slice(0, 70);
        updatePreview();
        fileIn.value = '';
    });

    const statsEl = h('div', { class: 'sc-stats' });
    const previewList = h('div', { class: 'sc-preview' });
    const importBtn = h('button', { type: 'button', class: 'cd-primary', disabled: true }, ic('style'), ' Karten importieren');

    let parsed = { cards: [], detectedDelimiter: '\t', skipped: 0 };
    const updatePreview = () => {
        rawText = textIn.value;
        parsed = parseFlashcardsImport(rawText, { delimiter: delim });
        importBtn.disabled = !parsed.cards.length;
        if (!rawText.trim()) {
            statsEl.textContent = 'Tipp: In Quizlet unter „Exportieren“ einfach alles kopieren und hier einfügen – oder aus Anki als „Notizen als Text (.txt)“ exportieren.';
            previewList.replaceChildren();
            return;
        }
        statsEl.textContent = parsed.cards.length
            ? `${parsed.cards.length} Karteikarte${parsed.cards.length === 1 ? '' : 'n'} erkannt · Trennzeichen: ${delimiterLabel(parsed.detectedDelimiter)}${parsed.skipped ? ` · ${parsed.skipped} Zeilen übersprungen` : ''}`
            : 'Noch keine gültigen Paare erkannt. Prüfe das gewählte Trennzeichen.';

        previewList.replaceChildren(...parsed.cards.slice(0, 4).map(c =>
            h('div', { class: 'sc-prev-card' },
                h('div', { class: 'sc-prev-side' }, h('small', { text: 'Vorne' }), h('span', { text: c.front })),
                h('div', { class: 'sc-prev-side' }, h('small', { text: 'Hinten' }), h('span', { text: c.back }))
            )
        ));
    };

    textIn.addEventListener('input', updatePreview);
    delimSel.addEventListener('change', () => { delim = delimSel.value; updatePreview(); });

    let m = null;
    importBtn.addEventListener('click', () => {
        if (!parsed.cards.length) return;
        onImported?.({
            notebookId: targetNbId,
            deckId: targetDeckId,
            title: titleIn.value.trim() || `Importierte Karten (${parsed.cards.length})`,
            subject: newNbSubjectIn.value.trim() || 'Allgemein',
            cards: parsed.cards
        });
        m?.close();
    });

    syncTargets();
    updatePreview();

    const body = h('div', { class: 'sd-form sc-modal' },
        h('div', { class: 'sc-toolbar' }, uploadBtn, fileIn, delimSel),
        textIn,
        h('div', { class: 'sc-grid-2' },
            h('label', { class: 'sd-field' }, h('span', { text: 'Ziel-Notizbuch' }), nbSel),
            h('label', { class: 'sd-field' }, h('span', { text: 'Stapel' }), deckSel)
        ),
        newNbRow,
        h('label', { class: 'sd-field' }, h('span', { text: 'Name des neuen Stapels' }), titleIn),
        statsEl,
        previewList,
        h('div', { class: 'cd-row end' },
            h('button', { type: 'button', class: 'cd-btn', text: 'Abbrechen', onclick: () => m?.close() }),
            importBtn
        )
    );
    m = modal('Anki / Quizlet Karteikarten importieren', body, { wide: true });
}

// ---------- 2. Schulbuch-Seiten-Scanner Modal ----------
export function openTextbookScanModal({ notebooks = [], activeNotebookId = null, defaultGoal = 'notes', defaultSubject = '', onSavedNotebook, onSavedHandwriting } = {}) {
    let images = [];
    let goal = defaultGoal; // notes | cards | tasks | handwriting
    let targetNbId = activeNotebookId || (notebooks[0]?.id || '__new__');
    let busy = false;

    const nbSel = h('select', { class: 'cd-input' },
        ...notebooks.map(n => h('option', { value: n.id, text: `${n.title}${n.subject ? ` (${n.subject})` : ''}`, ...(n.id === targetNbId ? { selected: true } : {}) })),
        h('option', { value: '__new__', text: '+ Neues Lern-Notizbuch anlegen', ...(targetNbId === '__new__' ? { selected: true } : {}) })
    );
    const subjIn = h('input', { class: 'cd-input', value: defaultSubject, placeholder: 'Fach (z. B. Geschichte, Biologie, Mathe)' });
    const targetWrap = h('div', { class: 'sc-grid-2' },
        h('label', { class: 'sd-field' }, h('span', { text: 'Lern-Notizbuch' }), nbSel),
        h('label', { class: 'sd-field' }, h('span', { text: 'Fach (optional)' }), subjIn)
    );
    const syncGoalUi = () => {
        targetWrap.querySelector(':first-child').hidden = goal === 'handwriting';
    };
    nbSel.addEventListener('change', () => { targetNbId = nbSel.value; });

    const goalSeg = h('div', { class: 'sc-goals' });
    const GOALS = [
        ['notes', 'menu_book', 'Lernnotiz', 'Strukturierte Zusammenfassung'],
        ['cards', 'style', 'Karteikarten', 'Begriffe & Definitionen'],
        ['tasks', 'assignment_turned_in', 'Aufgaben lösen', 'Mit Rechen-/Lösungsweg'],
        ['handwriting', 'stylus_note', 'Handschrift-Heft', 'In deiner Schrift als Heft']
    ];
    const renderGoals = () => {
        goalSeg.replaceChildren(...GOALS.map(([id, icon, title, sub]) => h('button', {
            type: 'button',
            class: 'sc-goal' + (goal === id ? ' on' : ''),
            onclick: () => { goal = id; renderGoals(); syncGoalUi(); }
        }, ic(icon), h('b', { text: title }), h('small', { text: sub }))));
    };
    renderGoals();
    syncGoalUi();

    const fileIn = h('input', { type: 'file', accept: 'image/*,application/pdf', capture: 'environment', multiple: true, hidden: true });
    const thumbRow = h('div', { class: 'sc-thumbs' });
    const scanBtn = h('button', { type: 'button', class: 'cd-primary', disabled: true }, ic('document_scanner'), ' Seiten mit Coden scannen');
    const statusBox = h('div', { class: 'sc-scan-status', hidden: true });

    const renderThumbs = () => {
        scanBtn.disabled = !images.length || busy;
        if (!images.length) {
            thumbRow.replaceChildren(h('div', { class: 'sc-drop-hint', text: 'Fotografiere 1 bis 3 Schulbuch-Seiten oder wähle Fotos / eine PDF-Seite aus.' }));
            return;
        }
        thumbRow.replaceChildren(...images.map((src, i) =>
            h('div', { class: 'sc-thumb' },
                h('img', { src, alt: `Seite ${i + 1}` }),
                h('button', {
                    type: 'button', class: 'sc-thumb-x', title: 'Entfernen',
                    onclick: () => { images.splice(i, 1); renderThumbs(); }
                }, ic('close'))
            )
        ));
    };

    fileIn.addEventListener('change', async () => {
        const files = [...(fileIn.files || [])];
        fileIn.value = '';
        if (!files.length) return;
        try {
            const { filesToBackgrounds } = await import('./ink.js');
            const imgs = await filesToBackgrounds(files);
            images = [...images, ...imgs].slice(0, 3);
            renderThumbs();
        } catch (e) {
            toast('Bilder konnten nicht gelesen werden: ' + (e.message || e), { type: 'error' });
        }
    });

    let m = null;
    scanBtn.addEventListener('click', async () => {
        if (!images.length || busy) return;
        busy = true;
        scanBtn.disabled = true;
        statusBox.hidden = false;
        statusBox.replaceChildren(loader({ size: 22 }), h('span', { text: 'Coden liest deine Schulbuch-Seiten …' }));
        try {
            const subject = subjIn.value.trim();
            const { system, user } = textbookScanPrompts({ mode: goal, subject });
            const r = await apiJson('/chat', {
                method: 'POST',
                body: JSON.stringify({
                    tier: 'flash',
                    messages: [
                        { role: 'system', content: system },
                        { role: 'user', content: user, images: images.slice(0, 3) }
                    ]
                })
            });
            const result = parseTextbookScan(r.content, goal);
            m?.close();
            if (goal === 'handwriting') {
                if (onSavedHandwriting) {
                    await onSavedHandwriting({ title: result.title, text: result.text, subject });
                } else {
                    const { saveHandwritingAsNotebook } = await import('./handwriting.js');
                    await saveHandwritingAsNotebook({ title: result.title, text: result.text });
                }
                return;
            }
            onSavedNotebook?.({
                mode: goal,
                notebookId: targetNbId,
                subject: subject || 'Allgemein',
                result
            });
        } catch (e) {
            toast('Schulbuch-Scan fehlgeschlagen: ' + (e.message || e), { type: 'error' });
            statusBox.hidden = true;
            busy = false;
            scanBtn.disabled = false;
        }
    });

    renderThumbs();

    const body = h('div', { class: 'sd-form sc-modal' },
        h('div', { class: 'sc-toolbar' },
            h('button', { type: 'button', class: 'cd-btn', onclick: () => fileIn.click() }, ic('photo_camera'), ' Seiten fotografieren / wählen (max. 3)'),
            fileIn
        ),
        thumbRow,
        h('label', { class: 'sd-field' }, h('span', { text: 'Was soll Coden aus der Schulbuch-Seite machen?' }), goalSeg),
        targetWrap,
        statusBox,
        h('div', { class: 'cd-row end' },
            h('button', { type: 'button', class: 'cd-btn', text: 'Abbrechen', onclick: () => m?.close() }),
            scanBtn
        )
    );
    m = modal('Schulbuch-Seiten-Scanner', body, { wide: true });
}
