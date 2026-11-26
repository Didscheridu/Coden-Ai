// js/handwriting.js – Handschrift-Renderer auf echtem Papier (Karo/Liniert/Blanko)
// sowie interaktiver Handschrift-Trainer (Apple Pencil, Touch, Maus) mit Profilen und Live-Vorschau.
import { modal, confirmBox, promptBox } from './apps/dialogs.js';
import { toast } from './toast.js';
import { StudyStore } from './study-store.js';
import * as S from './study-core.js';
import { strokeOutline, PAGE_W, PAGE_H, encodeStrokes } from './ink-core.js';
import {
    GUIDES, INK_COLORS, CHAR_GROUPS, ALL_TRAIN_CHARS,
    blankProfile, normalizeHandwriting, activeProfile, trainedCount,
    encodeGlyphStrokes, decodeGlyphStrokes, layoutHandwriting
} from './handwriting-core.js';

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

export function getHandwritingState() {
    return StudyStore.handwriting();
}

function drawOutlinesOnCtx(ctx, strokes, inkColor, penStyle, scale = 1) {
    const inkKind = penStyle === 'kugel' ? 'kugel' : penStyle === 'fein' ? 'kugel' : 'fueller';
    ctx.save();
    ctx.fillStyle = inkColor;
    ctx.strokeStyle = inkColor;
    for (const s of strokes) {
        const w = penStyle === 'fein' ? s.w * 0.72 : s.w;
        const outline = strokeOutline({ t: 'pen', c: inkColor, w, k: inkKind, p: s.points });
        if (!outline.length) continue;
        const n = outline.length;
        ctx.beginPath();
        ctx.moveTo(((outline[0][0] + outline[1 % n][0]) / 2) * scale, ((outline[0][1] + outline[1 % n][1]) / 2) * scale);
        for (let i = 1; i <= n; i++) {
            const a = outline[i % n], b = outline[(i + 1) % n];
            ctx.quadraticCurveTo(a[0] * scale, a[1] * scale, ((a[0] + b[0]) / 2) * scale, ((a[1] + b[1]) / 2) * scale);
        }
        ctx.closePath();
        ctx.fill();
    }
    ctx.restore();
}

export function paintSheetPaper(ctx, layout) {
    const { width, height, paper, grid, lineGap, firstBase } = layout;
    ctx.fillStyle = '#fffefb';
    ctx.fillRect(0, 0, width, height);
    ctx.lineWidth = 1;
    if (paper === 'karo') {
        ctx.strokeStyle = '#d6e2f2';
        ctx.beginPath();
        for (let x = grid; x < width; x += grid) { ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, height); }
        for (let y = grid; y < height; y += grid) { ctx.moveTo(0, y + 0.5); ctx.lineTo(width, y + 0.5); }
        ctx.stroke();
    } else if (paper === 'liniert') {
        ctx.strokeStyle = '#c8d6ea';
        ctx.beginPath();
        for (let y = firstBase; y < height - 10; y += lineGap) { ctx.moveTo(0, y + 0.5); ctx.lineTo(width, y + 0.5); }
        ctx.stroke();
        ctx.strokeStyle = '#eba9a9';
        ctx.beginPath();
        ctx.moveTo(54.5, 0); ctx.lineTo(54.5, height);
        ctx.stroke();
    }
}

export function renderHandwritingCanvas(canvas, text, opts = {}) {
    const hw = opts.hw || StudyStore.handwriting();
    const prof = opts.profileObj || activeProfile(hw, opts.profile);
    const layout = layoutHandwriting(text, prof, opts);
    const dpr = Math.min(typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1, 2.5);
    canvas.width = Math.round(layout.width * dpr);
    canvas.height = Math.round(layout.height * dpr);
    canvas.style.aspectRatio = `${layout.width} / ${layout.height}`;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    paintSheetPaper(ctx, layout);
    drawOutlinesOnCtx(ctx, layout.strokes, layout.inkColor, layout.penStyle, 1);
    return { layout, profile: prof, hw, trained: trainedCount(prof) };
}

export async function saveHandwritingAsNotebook({ title, text, paper, ink, profile }) {
    const hw = StudyStore.handwriting();
    const prof = activeProfile(hw, profile);
    const layout = layoutHandwriting(text, prof, { paper, ink, width: PAGE_W - 60 });
    const strokesPerPage = [];
    const maxPageY = PAGE_H - 90;
    const chunkHeight = maxPageY - 90;
    for (const s of layout.strokes) {
        // Auf Seiten aufteilen, falls die Lösung länger ist
        let minY = Infinity;
        for (let i = 1; i < s.points.length; i += 3) if (s.points[i] < minY) minY = s.points[i];
        const pgIdx = Math.max(0, Math.floor(Math.max(0, minY - 40) / chunkHeight));
        while (strokesPerPage.length <= pgIdx) strokesPerPage.push([]);
        const shifted = new Array(s.points.length);
        const yOff = pgIdx * chunkHeight;
        for (let i = 0; i < s.points.length; i += 3) {
            shifted[i] = Math.round((s.points[i] + 30) * 10) / 10;
            shifted[i + 1] = Math.round((s.points[i + 1] - yOff + 50) * 10) / 10;
            shifted[i + 2] = s.points[i + 2];
        }
        strokesPerPage[pgIdx].push({
            t: 'pen',
            c: layout.inkColor,
            w: s.w * 1.15,
            k: prof.penStyle === 'kugel' || prof.penStyle === 'fein' ? 'kugel' : 'fueller',
            p: shifted
        });
    }
    if (!strokesPerPage.length) strokesPerPage.push([]);
    const inkMod = await import('./ink.js');
    const st = StudyStore.get();
    const nbPaper = layout.paper === 'blanko' ? 'blanko' : layout.paper === 'liniert' ? 'liniert' : 'karo';
    const doc = S.newDoc(st, { title: title || 'Handschrift-Lösung', paper: nbPaper });
    const ids = [];
    for (let i = 0; i < strokesPerPage.length; i++) {
        const pid = inkMod.newPageId();
        await inkMod.savePage({
            id: pid,
            doc: doc.id,
            idx: i,
            paper: nbPaper,
            strokes: encodeStrokes(strokesPerPage[i]),
            text: [],
            items: []
        }, { withBg: true });
        ids.push(pid);
    }
    doc.pages = ids;
    StudyStore.save(st);
    toast(`Als Notizbuch „${doc.title}“ gespeichert.`, { type: 'ok' });
    inkMod.openInkEditor({ doc, persist: () => StudyStore.save(st) });
}

// ---------- Mini-Vorschau für trainierte Kacheln ----------
function paintTileGlyph(canvas, ch, prof) {
    const encoded = prof?.glyphs?.[ch];
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const size = 34;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    if (!encoded) return false;
    const strokes = decodeGlyphStrokes(encoded);
    if (!strokes.length) return false;
    const sc = size / 100;
    ctx.strokeStyle = prof.inkColor || '#1b3b8b';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(1.4, (prof.strokeScale || 1) * 1.7);
    for (const s of strokes) {
        ctx.beginPath();
        ctx.moveTo(s[0][0] * sc, s[0][1] * sc);
        if (s.length === 1) ctx.lineTo(s[0][0] * sc + 0.2, s[0][1] * sc);
        for (let i = 1; i < s.length; i++) ctx.lineTo(s[i][0] * sc, s[i][1] * sc);
        ctx.stroke();
    }
    return true;
}

// ---------- Interaktiver Handschrift-Trainer ----------
export function openHandwritingTrainer({ initialChar = '', onSaved } = {}) {
    let hw = StudyStore.handwriting();
    const state = {
        groupId: 'quick',
        char: initialChar || CHAR_GROUPS[0].chars[0],
        showGhost: true,
        penOnly: false,
        strokes: [], // aktuelle Striche auf dem Zeichenfeld [[x,y,p], ...] in 0..100
        previewMode: 'math',
        previewText: 'Aufgabe: x² - 5x + 6 = 0\n→ x₁ = 3, x₂ = 2\nProbe: 3² - 5·3 + 6 = 0 ✓'
    };

    const getProf = () => activeProfile(hw);
    const loadCurrentCharStrokes = () => {
        const enc = getProf().glyphs?.[state.char];
        state.strokes = enc ? decodeGlyphStrokes(enc) : [];
    };
    if (initialChar && !CHAR_GROUPS[0].chars.includes(initialChar)) {
        const grp = CHAR_GROUPS.find(g => g.chars.includes(initialChar));
        if (grp) state.groupId = grp.id;
    }
    loadCurrentCharStrokes();

    const persistHw = () => {
        hw = StudyStore.saveHandwriting(hw);
        onSaved?.(hw);
    };

    const root = h('div', { class: 'hw-trainer' });

    // --- Kopfzeile: Profil-Verwaltung ---
    const profSelect = h('select', { class: 'cd-input hw-prof-sel', title: 'Handschrift-Profil wählen' });
    const progTxt = h('small', { class: 'hw-prog-txt' });
    const topBar = h('div', { class: 'hw-top' },
        h('div', { class: 'hw-prof-row' },
            h('label', { class: 'hw-lbl', text: 'Handschrift-Profil' }),
            profSelect,
            h('button', {
                type: 'button', class: 'cd-btn', title: 'Neues Profil anlegen (z. B. Schönschrift)',
                onclick: async () => {
                    if (hw.profiles.length >= 6) return toast('Maximal 6 Handschrift-Profile möglich.', { type: 'warn' });
                    const name = await promptBox('Neues Handschrift-Profil', { label: 'Name (z. B. Schönschrift, Druckschrift, Mathe)', placeholder: 'Schönschrift', ok: 'Erstellen' });
                    if (!name) return;
                    const p = blankProfile(name);
                    hw.profiles.push(p);
                    hw.activeId = p.id;
                    persistHw();
                    loadCurrentCharStrokes();
                    renderAll();
                }
            }, ic('add'), ' Neu'),
            h('button', {
                type: 'button', class: 'cd-btn', title: 'Profil umbenennen',
                onclick: async () => {
                    const p = getProf();
                    const name = await promptBox('Profil umbenennen', { value: p.name, ok: 'Speichern' });
                    if (!name) return;
                    p.name = name.slice(0, 40);
                    p.updatedAt = new Date().toISOString();
                    persistHw();
                    renderHeader();
                }
            }, ic('edit')),
            h('button', {
                type: 'button', class: 'cd-btn', title: 'Profil löschen',
                onclick: async () => {
                    if (hw.profiles.length <= 1) return toast('Mindestens ein Profil bleibt bestehen.', { type: 'warn' });
                    const p = getProf();
                    if (!(await confirmBox(`Handschrift „${p.name}“ wirklich löschen?`, { ok: 'Löschen', danger: true }))) return;
                    hw.profiles = hw.profiles.filter(x => x.id !== p.id);
                    hw.activeId = hw.profiles[0].id;
                    persistHw();
                    loadCurrentCharStrokes();
                    renderAll();
                }
            }, ic('delete'))
        ),
        progTxt
    );

    profSelect.addEventListener('change', () => {
        hw.activeId = profSelect.value;
        persistHw();
        loadCurrentCharStrokes();
        renderAll();
    });

    // --- Zweispaltiger Studio-Bereich ---
    const stageLeft = h('div', { class: 'hw-stage' });
    const deckRight = h('div', { class: 'hw-deck' });
    const main = h('div', { class: 'hw-main' }, stageLeft, deckRight);

    // Zeichen-Pad
    const charTitle = h('div', { class: 'hw-char-head' });
    const padCanvas = h('canvas', { class: 'hw-pad-canvas' });
    const padBox = h('div', { class: 'hw-pad-wrap' }, padCanvas);
    const padHint = h('small', { class: 'hw-pad-hint', text: 'Schreibe das Zeichen auf die Grundlinie. Die blaue Vorlage dient nur zur Orientierung.' });

    const ghostChk = h('input', { type: 'checkbox', checked: state.showGhost, onchange: () => { state.showGhost = ghostChk.checked; drawPad(); } });
    const penChk = h('input', { type: 'checkbox', checked: state.penOnly, onchange: () => { state.penOnly = penChk.checked; } });

    const padTools = h('div', { class: 'hw-pad-tools' },
        h('div', { class: 'hw-pad-toggles' },
            h('label', { class: 'hw-chk' }, ghostChk, h('span', { text: 'Vorlage' })),
            h('label', { class: 'hw-chk', title: 'Auf iPad/Tablet Handballen ignorieren' }, penChk, h('span', { text: 'Nur Stift' }))
        ),
        h('div', { class: 'hw-pad-btns' },
            h('button', { type: 'button', class: 'cd-btn', title: 'Letzten Strich rückgängig', onclick: () => { if (!state.strokes.length) return; state.strokes.pop(); drawPad(); } }, ic('undo'), ' Strich zurück'),
            h('button', { type: 'button', class: 'cd-btn', title: 'Feld leeren', onclick: () => { state.strokes = []; drawPad(); } }, ic('ink_eraser'), ' Leeren'),
            h('button', {
                type: 'button', class: 'cd-btn', title: 'Dieses Zeichen aus Training entfernen',
                onclick: () => {
                    const p = getProf();
                    delete p.glyphs[state.char];
                    p.updatedAt = new Date().toISOString();
                    state.strokes = [];
                    persistHw();
                    renderAll();
                }
            }, ic('delete_outline')),
            h('button', {
                type: 'button', class: 'cd-primary', title: 'Zeichen speichern und zum nächsten (Enter)',
                onclick: () => saveCurrentAndNext()
            }, ic('check'), ' Speichern & Weiter')
        )
    );

    stageLeft.append(charTitle, padBox, padHint, padTools);

    // --- Rechte Spalte: Zeichengruppen + Raster + Stil + Vorschau ---
    const groupTabs = h('div', { class: 'hw-tabs' });
    const glyphGrid = h('div', { class: 'hw-grid' });

    const styleBox = h('div', { class: 'hw-style-box' });
    const swatchRow = h('div', { class: 'hw-swatches' });
    const paperSel = h('div', { class: 'st-seg' });
    const penSel = h('div', { class: 'st-seg' });
    const slantRange = h('input', { type: 'range', min: '-10', max: '14', step: '1', class: 'hw-range' });
    const slantVal = h('small', { class: 'hw-val' });
    const weightRange = h('input', { type: 'range', min: '0.7', max: '1.5', step: '0.05', class: 'hw-range' });
    const weightVal = h('small', { class: 'hw-val' });

    slantRange.addEventListener('input', () => {
        const p = getProf(); p.slantDeg = +slantRange.value; slantVal.textContent = p.slantDeg + '°';
        p.updatedAt = new Date().toISOString(); persistHw(); renderPreview();
    });
    weightRange.addEventListener('input', () => {
        const p = getProf(); p.strokeScale = +weightRange.value; weightVal.textContent = Math.round(p.strokeScale * 100) + '%';
        p.updatedAt = new Date().toISOString(); persistHw(); drawPad(); renderPreview();
    });

    styleBox.append(
        h('div', { class: 'hw-style-row' }, h('span', { class: 'hw-lbl', text: 'Tintenfarbe' }), swatchRow),
        h('div', { class: 'hw-style-two' },
            h('div', {}, h('span', { class: 'hw-lbl', text: 'Standard-Papier' }), paperSel),
            h('div', {}, h('span', { class: 'hw-lbl', text: 'Stiftart' }), penSel)
        ),
        h('div', { class: 'hw-style-two' },
            h('label', { class: 'hw-slider-lbl' }, h('span', {}, 'Neigung ', slantVal), slantRange),
            h('label', { class: 'hw-slider-lbl' }, h('span', {}, 'Strichstärke ', weightVal), weightRange)
        )
    );

    const prevInput = h('textarea', { class: 'cd-input hw-prev-in', rows: 2, value: state.previewText, placeholder: 'Testtext eingeben …' });
    prevInput.addEventListener('input', () => { state.previewText = prevInput.value; renderPreview(); });
    const prevCanvas = h('canvas', { class: 'hw-prev-canvas' });
    const prevBox = h('div', { class: 'hw-prev-box' },
        h('div', { class: 'hw-prev-head' },
            h('span', { class: 'hw-lbl', text: 'Live-Vorschau deiner Handschrift' }),
            h('div', { class: 'hw-prev-presets' },
                h('button', { type: 'button', class: 'cd-btn sm', onclick: () => { prevInput.value = 'Aufgabe: x² - 5x + 6 = 0\n→ x₁ = 3, x₂ = 2\nProbe: 3² - 5·3 + 6 = 0 ✓'; state.previewText = prevInput.value; renderPreview(); } }, 'Mathe'),
                h('button', { type: 'button', class: 'cd-btn sm', onclick: () => { prevInput.value = 'Hallo! Das ist ein kleiner Test\nmit meiner eigenen Handschrift.'; state.previewText = prevInput.value; renderPreview(); } }, 'Text'),
                h('button', { type: 'button', class: 'cd-btn sm', onclick: () => { prevInput.value = 'abcdefghijklmnopqrstuvwxyzäöüß\nABCDEFGHIJKLMNOPQRSTUVWXYZ 0123456789'; state.previewText = prevInput.value; renderPreview(); } }, 'A–Z')
            )
        ),
        prevInput,
        h('div', { class: 'hw-prev-sheet' }, prevCanvas)
    );

    deckRight.append(groupTabs, glyphGrid, styleBox, prevBox);
    root.append(topBar, main);

    // ---------- Zeichen-Pad Painting & Pointer Handling ----------
    const PAD_SIZE = 320;
    let activePointer = null;
    let currentPts = null;

    function drawPad() {
        const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
        padCanvas.width = PAD_SIZE * dpr;
        padCanvas.height = PAD_SIZE * dpr;
        const ctx = padCanvas.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        const s = PAD_SIZE / 100;

        // Papierhintergrund + leichte Kästchen
        ctx.fillStyle = '#fffefb';
        ctx.fillRect(0, 0, PAD_SIZE, PAD_SIZE);
        ctx.strokeStyle = '#eef3f9';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let g = 10; g < 100; g += 10) {
            ctx.moveTo(g * s, 0); ctx.lineTo(g * s, PAD_SIZE);
            ctx.moveTo(0, g * s); ctx.lineTo(PAD_SIZE, g * s);
        }
        ctx.stroke();

        // 4 Schreiblern-Linien
        const drawGuide = (y, color, dash = [], lw = 1) => {
            ctx.save();
            ctx.strokeStyle = color;
            ctx.lineWidth = lw;
            ctx.setLineDash(dash);
            ctx.beginPath();
            ctx.moveTo(0, y * s);
            ctx.lineTo(PAD_SIZE, y * s);
            ctx.stroke();
            ctx.restore();
        };
        drawGuide(GUIDES.ascender, '#93c5fd', [4, 4], 1);
        drawGuide(GUIDES.mid, '#93c5fd', [4, 4], 1);
        drawGuide(GUIDES.baseline, '#f59e0b', [], 1.5);
        drawGuide(GUIDES.descender, '#cbd5e1', [4, 4], 1);

        // Dezente Vorlage im Hintergrund
        if (state.showGhost) {
            ctx.save();
            ctx.fillStyle = 'rgba(100, 116, 139, 0.14)';
            ctx.font = `400 ${Math.round(54 * s)}px "Kalam", "Caveat", cursive, sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'alphabetic';
            ctx.fillText(state.char, PAD_SIZE / 2, GUIDES.baseline * s);
            ctx.restore();
        }

        // Bisherige Striche zeichnen
        const p = getProf();
        const all = currentPts && currentPts.length ? [...state.strokes, currentPts] : state.strokes;
        const padStrokes = all.map(pts => ({
            points: pts.flatMap(([x, y, pr]) => [x * s, y * s, pr]),
            w: (p.strokeScale || 1) * 4.4
        }));
        drawOutlinesOnCtx(ctx, padStrokes, p.inkColor || '#1b3b8b', p.penStyle || 'fueller', 1);
    }

    const padPoint = (e) => {
        const r = padCanvas.getBoundingClientRect();
        const x = ((e.clientX - r.left) / r.width) * 100;
        const y = ((e.clientY - r.top) / r.height) * 100;
        const pr = e.pointerType === 'pen' && e.pressure > 0 ? Math.max(0.12, Math.min(1, e.pressure)) : 0.55;
        return [Math.max(-10, Math.min(110, x)), Math.max(-10, Math.min(110, y)), pr];
    };

    padCanvas.addEventListener('pointerdown', (e) => {
        if (e.button && e.button !== 0) return;
        if (state.penOnly && e.pointerType === 'touch') return;
        e.preventDefault();
        activePointer = e.pointerId;
        padCanvas.setPointerCapture?.(e.pointerId);
        currentPts = [padPoint(e)];
        drawPad();
    });
    padCanvas.addEventListener('pointermove', (e) => {
        if (activePointer !== e.pointerId || !currentPts) return;
        e.preventDefault();
        const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
        for (const ev of evs) {
            const pt = padPoint(ev);
            const last = currentPts[currentPts.length - 1];
            if (!last || Math.hypot(pt[0] - last[0], pt[1] - last[1]) >= 0.45) currentPts.push(pt);
        }
        drawPad();
    });
    const endStroke = (e) => {
        if (activePointer !== e.pointerId || !currentPts) return;
        if (currentPts.length >= 1) state.strokes.push(currentPts);
        currentPts = null;
        activePointer = null;
        drawPad();
    };
    padCanvas.addEventListener('pointerup', endStroke);
    padCanvas.addEventListener('pointercancel', endStroke);

    function commitCurrentChar() {
        const p = getProf();
        if (state.strokes.length) {
            const enc = encodeGlyphStrokes(state.strokes);
            if (enc) p.glyphs[state.char] = enc;
        } else {
            return false;
        }
        p.updatedAt = new Date().toISOString();
        persistHw();
        return true;
    }

    function selectChar(ch) {
        if (state.strokes.length) commitCurrentChar();
        state.char = ch;
        loadCurrentCharStrokes();
        renderCharHead();
        renderGrid();
        drawPad();
        renderPreview();
    }

    function saveCurrentAndNext() {
        const saved = commitCurrentChar();
        const grp = CHAR_GROUPS.find(g => g.id === state.groupId) || CHAR_GROUPS[0];
        const idx = grp.chars.indexOf(state.char);
        const nextChar = grp.chars[(idx + 1) % grp.chars.length];
        state.char = nextChar;
        loadCurrentCharStrokes();
        renderHeader();
        renderCharHead();
        renderGrid();
        drawPad();
        renderPreview();
        if (saved && idx === grp.chars.length - 1) toast(`Alle Zeichen in „${grp.label}“ durchlaufen!`, { type: 'ok' });
    }

    function renderHeader() {
        const p = getProf();
        profSelect.replaceChildren(...hw.profiles.map(x => h('option', { value: x.id, text: `${x.name} (${trainedCount(x)})`, ...(x.id === p.id ? { selected: true } : {}) })));
        progTxt.textContent = `${trainedCount(p)} von ${ALL_TRAIN_CHARS.length} Zeichen trainiert`;
    }

    function renderCharHead() {
        const p = getProf();
        const isDone = !!p.glyphs?.[state.char];
        const grp = CHAR_GROUPS.find(g => g.id === state.groupId) || CHAR_GROUPS[0];
        const pos = grp.chars.indexOf(state.char) + 1;
        charTitle.replaceChildren(
            h('div', { class: 'hw-char-big', text: state.char }),
            h('div', { class: 'hw-char-info' },
                h('b', { text: `Zeichen „${state.char}“ ${isDone ? '✓ trainiert' : 'zeichnen'}` }),
                h('small', { text: pos > 0 ? `${grp.label} · ${pos} / ${grp.chars.length}` : 'Einzelzeichen' })),
            h('div', { class: 'hw-char-nav' },
                h('button', {
                    type: 'button', class: 'cd-btn sm', title: 'Vorheriges Zeichen',
                    onclick: () => { const i = grp.chars.indexOf(state.char); selectChar(grp.chars[(i - 1 + grp.chars.length) % grp.chars.length]); }
                }, ic('chevron_left')),
                h('button', {
                    type: 'button', class: 'cd-btn sm', title: 'Nächstes Zeichen überspringen',
                    onclick: () => { const i = grp.chars.indexOf(state.char); selectChar(grp.chars[(i + 1) % grp.chars.length]); }
                }, ic('chevron_right')))
        );
    }

    function renderTabs() {
        const p = getProf();
        groupTabs.replaceChildren(...CHAR_GROUPS.map(g => {
            const done = g.chars.filter(c => !!p.glyphs?.[c]).length;
            return h('button', {
                type: 'button',
                class: 'hw-tab' + (g.id === state.groupId ? ' on' : ''),
                onclick: () => {
                    state.groupId = g.id;
                    if (!g.chars.includes(state.char)) {
                        if (state.strokes.length) commitCurrentChar();
                        state.char = g.chars.find(c => !p.glyphs?.[c]) || g.chars[0];
                        loadCurrentCharStrokes();
                    }
                    renderTabs(); renderCharHead(); renderGrid(); drawPad();
                }
            }, h('span', { text: g.label }), h('small', { text: `${done}/${g.chars.length}` }));
        }));
    }

    function renderGrid() {
        const p = getProf();
        const grp = CHAR_GROUPS.find(g => g.id === state.groupId) || CHAR_GROUPS[0];
        glyphGrid.replaceChildren(...grp.chars.map(ch => {
            const isTrained = !!p.glyphs?.[ch];
            const isCur = state.char === ch;
            const tile = h('button', {
                type: 'button',
                class: 'hw-tile' + (isCur ? ' cur' : '') + (isTrained ? ' done' : ''),
                title: `Zeichen ${ch}`,
                onclick: () => selectChar(ch)
            });
            if (isTrained) {
                const c = h('canvas', { class: 'hw-tile-c' });
                tile.append(c);
                paintTileGlyph(c, ch, p);
                tile.append(h('span', { class: 'hw-tile-lbl', text: ch }));
            } else {
                tile.append(h('span', { class: 'hw-tile-empty', text: ch }));
            }
            return tile;
        }));
    }

    function renderStyle() {
        const p = getProf();
        swatchRow.replaceChildren(...INK_COLORS.map(c => h('button', {
            type: 'button',
            class: 'hw-sw' + (p.inkColor.toLowerCase() === c.hex.toLowerCase() ? ' on' : ''),
            title: c.name,
            style: { background: c.hex },
            onclick: () => {
                p.inkColor = c.hex; p.updatedAt = new Date().toISOString();
                persistHw(); renderStyle(); renderGrid(); drawPad(); renderPreview();
            }
        })));
        paperSel.replaceChildren(...[['karo', 'Karo'], ['liniert', 'Liniert'], ['blanko', 'Blanko']].map(([k, lbl]) => h('button', {
            type: 'button', class: p.paper === k ? 'active' : '',
            onclick: () => { p.paper = k; p.updatedAt = new Date().toISOString(); persistHw(); renderStyle(); renderPreview(); }
        }, lbl)));
        penSel.replaceChildren(...[['fueller', 'Füller'], ['kugel', 'Kuli'], ['fein', 'Fein']].map(([k, lbl]) => h('button', {
            type: 'button', class: p.penStyle === k ? 'active' : '',
            onclick: () => { p.penStyle = k; p.updatedAt = new Date().toISOString(); persistHw(); renderStyle(); drawPad(); renderPreview(); }
        }, lbl)));
        slantRange.value = String(p.slantDeg || 0);
        slantVal.textContent = (p.slantDeg || 0) + '°';
        weightRange.value = String(p.strokeScale || 1);
        weightVal.textContent = Math.round((p.strokeScale || 1) * 100) + '%';
    }

    function renderPreview() {
        const p = getProf();
        const previewProfile = { ...p, glyphs: { ...p.glyphs } };
        if (state.strokes.length) {
            const liveEnc = encodeGlyphStrokes(state.strokes);
            if (liveEnc) previewProfile.glyphs[state.char] = liveEnc;
        }
        renderHandwritingCanvas(prevCanvas, prevInput.value || 'Hallo Welt! 2 + 2 = 4', {
            hw,
            profileObj: previewProfile,
            paper: p.paper,
            ink: p.inkColor,
            width: 460
        });
    }

    function renderAll() {
        renderHeader();
        renderCharHead();
        renderTabs();
        renderGrid();
        renderStyle();
        drawPad();
        renderPreview();
    }

    const onKey = (e) => {
        if (!root.isConnected) { document.removeEventListener('keydown', onKey); return; }
        if (/INPUT|TEXTAREA|SELECT/.test(e.target?.tagName)) return;
        if (e.key === 'Enter') { e.preventDefault(); saveCurrentAndNext(); }
    };
    document.addEventListener('keydown', onKey);

    renderAll();
    modal('Handschrift trainieren', root, {
        wide: true,
        onClose: () => {
            if (state.strokes.length) commitCurrentChar();
            document.removeEventListener('keydown', onKey);
        }
    });
}
