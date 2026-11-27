// js/handwriting.js – Handschrift auf GoodNotes-Papier (Karo/Liniert/Blanko) mit der Handschrift-Engine
// sowie der Handschrift-Trainer im GoodNotes-Stil (Stifte, Farben, Dicke, Varianten, Apple Pencil/Touch/Maus).
import { modal, confirmBox, promptBox } from './apps/dialogs.js';
import { toast } from './toast.js';
import { StudyStore } from './study-store.js';
import * as S from './study-core.js';
import { PAGE_W, PAGE_H, encodeStrokes } from './ink-core.js';
import {
    GUIDES, CHAR_GROUPS, ALL_TRAIN_CHARS, MAX_VARIANTS, MASTER_ID,
    blankProfile, normalizeHandwriting, activeProfile, allProfiles, trainedCount, variantCount, glyphVariants,
    encodeGlyphStrokes, decodeGlyphStrokes, profileRich, fallbackRich, resolveInkHex, getMasterProfile, updateMasterPrefs, chooseHandwriting
} from './handwriting-core.js';
import { layoutRich, paintLayout, drawInk, drawPaper, smoothPoints, PENS, penFactor, richVariantCount } from './hand-engine.js';

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

// GoodNotes-Stiftfarben
export const GN_COLORS = [
    { hex: '#1b1b1d', name: 'Schwarz' }, { hex: '#1e1b1b', name: 'Kaydens Tinte' }, { hex: '#143f8c', name: 'Dunkelblau' },
    { hex: '#1f54cc', name: 'Blau' }, { hex: '#d62828', name: 'Rot' }, { hex: '#268c40', name: 'Grün' },
    { hex: '#7a40b5', name: 'Lila' }, { hex: '#f07d00', name: 'Orange' }, { hex: '#6b6b6b', name: 'Grau' }
];
export const THICKNESS = [{ id: 0.75, name: 'Fein' }, { id: 1, name: 'Mittel' }, { id: 1.4, name: 'Dick' }];
const PEN_ICON = { fineliner: 'edit', kugel: 'ink_pen', fueller: 'history_edu', pinsel: 'brush' };

export function getHandwritingState() {
    return StudyStore.handwriting();
}

const penOf = (prof) => (PENS.some(p => p.id === prof?.penStyle) ? prof.penStyle : 'kugel');
// Wenn Coden schreibt (Chat, Ins Heft, Lösen lassen): immer Kugelschreiber wie in GoodNotes
export const CODEN_PEN = 'kugel';

// Layout eines Textes mit einem Profil (eigenes oder Kaydens)
export function layoutFor(text, prof, opts = {}) {
    const rich = profileRich(prof);
    const weight = prof?.rich ? (+opts.weight || +prof.strokeScale || 1) : 1; // eigene Profile tragen die Dicke schon im Profil
    return layoutRich(text, rich, { ...opts, paper: opts.paper || prof?.paper || 'karo', weight, fallback: fallbackRich() });
}

export function renderHandwritingCanvas(canvas, text, opts = {}) {
    const hw = opts.hw || StudyStore.handwriting();
    const prof = opts.profileObj || activeProfile(hw, opts.profile);
    const rect = canvas.parentElement?.getBoundingClientRect?.();
    const width = opts.width || Math.round(Math.min(900, Math.max(320, rect?.width || 760)));
    const grid = opts.grid || (width < 520 ? 17 : width < 700 ? 19 : 21);
    const layout = layoutFor(text, prof, { paper: opts.paper, width, grid, seed: opts.seed || 3, weight: opts.weight });
    const dpr = Math.min(typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1, 2.5);
    canvas.width = Math.round(layout.width * dpr);
    canvas.height = Math.round(layout.height * dpr);
    canvas.style.aspectRatio = `${layout.width} / ${layout.height}`;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const ink = resolveInkHex(opts.ink, prof?.inkColor || '#1b1f2a');
    paintLayout(ctx, layout, { scale: dpr, color: ink, pen: opts.pen || CODEN_PEN, paperColor: opts.paperColor || 'weiss' });
    return { layout, profile: prof, hw, trained: trainedCount(prof), own: layout.usedTrained, preview: layout.usedFallback };
}

// Notizbuch-Striche aus Layout-Strichen (dicht, Seiten-Einheiten), optional als „von Coden“ markiert
function toInkStrokes(strokes, { color, pen = CODEN_PEN, dx = 0, dy = 0, origin = 'coden' } = {}) {
    const kind = pen;
    return strokes.map(s => {
        const pts = s.straight ? [[s.p[0], s.p[1]], [s.p[s.p.length - 3], s.p[s.p.length - 2]]] : smoothPoints(s.p, 0.9);
        const p = [];
        for (const [x, y] of pts) p.push(Math.round((x + dx) * 10) / 10, Math.round((y + dy) * 10) / 10, 0.5);
        if (p.length === 3) p.push(p[0] + 0.4, p[1], 0.5);
        // Notizbuch zeichnet mit Breite w · 1,15 → genau dieselbe Strichstärke wie in der Vorschau
        return { t: 'pen', c: color, w: Math.round(s.w * penFactor(pen) / 1.15 * 100) / 100, k: kind, p, ...(origin ? { o: origin } : {}) };
    });
}

// Text → Striche für Notizbuch-Seiten, passend aufs Karo (25er-Raster) bzw. die Linien (alle 36 ab y = 120)
export function notebookPagesFor(text, prof, { paper, ink, origin, seed = 5 } = {}) {
    const want = paper || prof?.paper;
    const nbPaper = want === 'blanko' ? 'blanko' : want === 'liniert' ? 'liniert' : 'karo';
    const layout = layoutFor(text, prof, nbPaper === 'liniert'
        ? { paper: 'liniert', width: PAGE_W, grid: 20, seed }
        : { paper: nbPaper, width: PAGE_W, grid: 25, seed });
    const shiftY = nbPaper === 'liniert' ? 120 - layout.firstBase : (nbPaper === 'karo' ? 50 : 40);
    const chunk = nbPaper === 'liniert' ? Math.floor((PAGE_H - 170) / layout.pitch) * layout.pitch : Math.floor((PAGE_H - 110) / layout.pitch) * layout.pitch;
    const color = resolveInkHex(ink, prof?.inkColor || '#1b1f2a');
    const pen = CODEN_PEN;
    const pages = [];
    // Seite nach der Zeile (nicht nach dem einzelnen Strich), damit kein Buchstabe zerrissen wird
    const perPage = Math.max(1, Math.round(chunk / layout.pitch));
    const pageOf = (y) => Math.max(0, Math.floor(Math.round((y - layout.firstBase) / layout.pitch + 0.15) / perPage));
    for (const s of layout.strokes) {
        let sumY = 0, n = 0;
        for (let i = 1; i < s.p.length; i += 3) { sumY += s.p[i]; n++; }
        const pg = pageOf(sumY / Math.max(1, n));
        while (pages.length <= pg) pages.push([]);
        pages[pg].push(...toInkStrokes([s], { color, pen, dy: shiftY - pg * chunk, origin }));
    }
    for (const m of layout.marks || []) {
        const pg = pageOf(m.y1 - layout.k * 0.3);
        while (pages.length <= pg) pages.push([]);
        const y = (m.y0 + m.y1) / 2 - pg * chunk + shiftY;
        pages[pg].unshift({ t: 'hl', c: m.color, w: Math.round(m.y1 - m.y0), k: 'fueller', p: [m.x0, y, 0.5, (m.x0 + m.x1) / 2, y, 0.5, m.x1, y, 0.5], ...(origin ? { o: origin } : {}) });
    }
    if (!pages.length) pages.push([]);
    return { pages, paper: nbPaper };
}

// Text → Striche direkt ab einer y-Position auf einer vorhandenen Seite (bzw. mit Umbruch auf Folgeseiten).
// Passt Zeilen exakt auf Karo (25er-Raster) oder Liniert (36 ab y = 120) ein.
export function strokesForNotebookPage(text, prof, { paper, ink, origin = 'coden', seed = 5, startY = null } = {}) {
    const want = paper || prof?.paper;
    const nbPaper = want === 'blanko' ? 'blanko' : (want === 'liniert' || want === 'eng') ? 'liniert' : 'karo';
    const layout = layoutFor(text, prof, nbPaper === 'liniert'
        ? { paper: 'liniert', width: PAGE_W, grid: 20, seed }
        : { paper: nbPaper, width: PAGE_W, grid: 25, seed });
    const pitch = layout.pitch || (nbPaper === 'liniert' ? 36 : 50);
    const baseTop = nbPaper === 'liniert' ? 120 : (nbPaper === 'karo' ? 75 : 65);
    const maxBottom = nbPaper === 'liniert' ? (PAGE_H - 60) : (PAGE_H - 55);

    // Gewünschte Start-Grundlinie auf das Linien-/Karo-Raster einrasten
    let desiredBase = Number.isFinite(startY) ? Math.max(baseTop, startY) : baseTop;
    if (nbPaper === 'liniert') {
        desiredBase = 120 + Math.max(0, Math.ceil((desiredBase - 120) / 36)) * 36;
    } else if (nbPaper === 'karo') {
        desiredBase = Math.max(75, Math.ceil(desiredBase / 25) * 25);
    }
    // Falls auf der aktuellen Seite weniger als 1,5 Zeilen Platz sind, lieber sauber ab oben auf einer neuen Seite starten
    const overflowFirst = desiredBase > maxBottom - pitch * 0.4;
    if (overflowFirst) desiredBase = baseTop;

    const color = resolveInkHex(ink, prof?.inkColor || '#1b1f2a');
    const pen = CODEN_PEN;
    const pageOffsets = [];

    const yToTargetPage = (rawY) => {
        const lineIdx = Math.max(0, Math.round((rawY - layout.firstBase) / pitch));
        const yOnFirst = desiredBase + lineIdx * pitch;
        if (yOnFirst <= maxBottom) {
            return { pg: 0, dy: desiredBase - layout.firstBase };
        }
        const firstCapacity = Math.max(1, Math.floor((maxBottom - desiredBase) / pitch) + 1);
        const perNext = Math.max(1, Math.floor((maxBottom - baseTop) / pitch) + 1);
        const rem = lineIdx - firstCapacity;
        const pg = 1 + Math.floor(rem / perNext);
        const shift = baseTop - (layout.firstBase + (firstCapacity + (pg - 1) * perNext) * pitch);
        return { pg, dy: shift };
    };

    const pages = [[]];
    const pageMaxY = [desiredBase];
    for (const s of layout.strokes) {
        let sumY = 0, n = 0;
        for (let i = 1; i < s.p.length; i += 3) { sumY += s.p[i]; n++; }
        const avgY = sumY / Math.max(1, n);
        const { pg, dy } = yToTargetPage(avgY);
        while (pages.length <= pg) { pages.push([]); pageMaxY.push(baseTop); }
        const inkStrokes = toInkStrokes([s], { color, pen, dy, origin });
        pages[pg].push(...inkStrokes);
        for (const is of inkStrokes) {
            for (let i = 1; i < is.p.length; i += 3) {
                if (is.p[i] > pageMaxY[pg]) pageMaxY[pg] = is.p[i];
            }
        }
        pageOffsets[pg] = dy;
    }
    for (const m of layout.marks || []) {
        const { pg, dy } = yToTargetPage(m.y1 - layout.k * 0.3);
        while (pages.length <= pg) { pages.push([]); pageMaxY.push(baseTop); }
        const y = (m.y0 + m.y1) / 2 + dy;
        pages[pg].unshift({ t: 'hl', c: m.color, w: Math.round(m.y1 - m.y0), k: 'fueller', p: [m.x0, y, 0.5, (m.x0 + m.x1) / 2, y, 0.5, m.x1, y, 0.5], ...(origin ? { o: origin } : {}) });
    }
    return {
        pages,
        paper: nbPaper,
        startedOnNewPage: overflowFirst,
        endY: pageMaxY[pages.length - 1] || desiredBase
    };
}

// Kurze Antwort in einen Kasten auf dem Arbeitsblatt schreiben (Seiten-Einheiten). null, wenn sie nicht hineinpasst.
export function strokesInBox(text, prof, rect, { ink, origin = 'coden', seed = 7, maxK = 24, minK = 7 } = {}) {
    const rich = profileRich(prof);
    const color = resolveInkHex(ink, prof?.inkColor || '#1b1f2a');
    let k = Math.min(maxK, rect.h / 1.75);
    for (let i = 0; i < 14 && k >= minK; i++, k *= 0.9) {
        const L = layoutRich(text, rich, { fit: { k, pitch: 2.25 * k, firstBase: 1.5 * k }, width: rect.w, paper: 'blanko', seed, weight: prof?.rich ? (prof.strokeScale || 1) : 1, fallback: fallbackRich() });
        if (L.maxX > rect.w + 0.5 || L.height > rect.h * 1.2) continue;
        // eine Zeile sitzt unten im Feld (auf der Schreiblinie), mehrere Zeilen oben
        const dy = rect.y + (L.lineCount <= 1 ? Math.max(0, rect.h - L.height - 0.1 * k) : 0);
        return toInkStrokes(L.strokes, { color, pen: CODEN_PEN, dx: rect.x, dy, origin });
    }
    return null;
}

// Ins Heft: neues Notizbuch mit der Lösung in der Handschrift
export async function saveHandwritingAsNotebook({ title, text, paper, ink, profile }) {
    const hw = StudyStore.handwriting();
    const prof = activeProfile(hw, profile);
    const { pages, paper: nbPaper } = notebookPagesFor(text, prof, { paper, ink });
    const inkMod = await import('./ink.js');
    const st = StudyStore.get();
    const doc = S.newDoc(st, { title: title || 'Handschrift-Lösung', paper: nbPaper });
    const ids = [];
    for (let i = 0; i < pages.length; i++) {
        const pid = inkMod.newPageId();
        await inkMod.savePage({ id: pid, doc: doc.id, idx: i, paper: nbPaper, strokes: encodeStrokes(pages[i]), text: [], items: [] }, { withBg: true });
        ids.push(pid);
    }
    doc.pages = ids;
    StudyStore.save(st);
    toast(`Als Notizbuch „${doc.title}“ gespeichert.`, { type: 'ok' });
    inkMod.openInkEditor({ doc, persist: () => StudyStore.save(st) });
}

// ---------- Mini-Vorschau für trainierte Kacheln ----------
function paintTileGlyph(canvas, enc, prof) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const size = 34;
    canvas.width = size * dpr; canvas.height = size * dpr;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const strokes = decodeGlyphStrokes(enc);
    if (!strokes.length) return;
    const sc = size / 100 * dpr;
    drawInk(ctx, strokes.map(s => ({ p: s.flatMap(([x, y]) => [x, y, 0.5]), w: 4.2 * (prof.strokeScale || 1) })), { color: prof.inkColor, pen: penOf(prof), scale: sc });
}

// ---------- Handschrift-Trainer (GoodNotes-Stil) ----------
export function openHandwritingTrainer({ initialChar = '', onSaved } = {}) {
    let hw = normalizeHandwriting(StudyStore.handwriting());
    const state = {
        groupId: 'quick',
        char: initialChar || CHAR_GROUPS[0].chars[0],
        variant: 0,
        showGhost: true,
        penOnly: false,
        strokes: [],
        redo: [],
        previewText: 'Aufgabe 1\na) 3x+6=21 |-6\n• 3x=15 |:3\n• x=5\nDas ist meine ==eigene== Handschrift.'
    };
    const isMaster = () => hw.activeId === MASTER_ID && !!getMasterProfile();
    const ownProf = () => hw.profiles.find(p => p.id === hw.activeId) || hw.profiles[0];
    const curProf = () => (isMaster() ? getMasterProfile() : ownProf());
    const variantsOf = (ch = state.char) => glyphVariants(ownProf(), ch);
    const loadStrokes = () => {
        const v = variantsOf();
        if (state.variant > v.length) state.variant = v.length;
        state.strokes = v[state.variant] ? decodeGlyphStrokes(v[state.variant]) : [];
        state.redo = [];
    };
    if (initialChar && !CHAR_GROUPS[0].chars.includes(initialChar)) {
        const grp = CHAR_GROUPS.find(g => g.chars.includes(initialChar));
        if (grp) state.groupId = grp.id;
    }
    loadStrokes();

    const saveBadge = h('small', { class: 'hw-save-badge', text: 'Automatisch gespeichert' });
    let badgeTimer = 0;
    const persistHw = ({ sync = false } = {}) => {
        hw = StudyStore.saveHandwriting(hw);
        onSaved?.(hw);
        saveBadge.textContent = 'Gespeichert ✓';
        saveBadge.classList.add('ok');
        clearTimeout(badgeTimer);
        badgeTimer = setTimeout(() => saveBadge.classList.remove('ok'), 1800);
        if (sync) StudyStore.syncNow?.();
    };
    const touch = (p) => { p.updatedAt = new Date().toISOString(); };
    const masterChanged = () => document.dispatchEvent(new CustomEvent('codenHandwritingChanged', { detail: { master: true } }));

    const root = h('div', { class: 'hw-trainer gn' });

    // ---- Kopf: Profile ----
    const profSelect = h('select', { class: 'cd-input hw-prof-sel', title: 'Handschrift wählen' });
    const progTxt = h('small', { class: 'hw-prog-txt' });
    let closeTrainer = () => {};
    const ownerBox = h('div', { class: 'hw-owner' });
    const profBtns = h('div', { class: 'hw-prof-btns' },
        h('button', {
            type: 'button', class: 'cd-btn', title: 'Neue eigene Handschrift anlegen',
            onclick: async () => {
                if (hw.profiles.length >= 6) return toast('Maximal 6 eigene Handschriften möglich.', { type: 'warn' });
                const name = await promptBox('Neue Handschrift', { label: 'Name (z. B. Schönschrift, Druckschrift, Mathe)', placeholder: 'Schönschrift', ok: 'Erstellen' });
                if (!name) return;
                const p = blankProfile(name);
                hw.profiles.push(p); hw = chooseHandwriting(hw, p.id);
                persistHw({ sync: true }); state.variant = 0; loadStrokes(); renderAll();
            }
        }, ic('add'), ' Neu'),
        h('button', {
            type: 'button', class: 'cd-btn', title: 'Umbenennen',
            onclick: async () => {
                if (isMaster()) return toast('Kaydens kann nicht umbenannt werden.', { type: 'warn' });
                const p = ownProf();
                const name = await promptBox('Handschrift umbenennen', { value: p.name, ok: 'Speichern' });
                if (!name) return;
                p.name = name.slice(0, 40); touch(p); persistHw({ sync: true }); renderHeader();
            }
        }, ic('edit')),
        h('button', {
            type: 'button', class: 'cd-btn', title: 'Löschen',
            onclick: async () => {
                if (isMaster()) return toast('Kaydens löschst du im Admin-Bereich unten.', { type: 'warn' });
                if (hw.profiles.length <= 1) return toast('Mindestens eine eigene Handschrift bleibt bestehen.', { type: 'warn' });
                const p = ownProf();
                if (!(await confirmBox(`Handschrift „${p.name}“ wirklich löschen?`, { ok: 'Löschen', danger: true }))) return;
                hw.profiles = hw.profiles.filter(x => x.id !== p.id);
                if (hw.activeId === p.id || !hw.profiles.some(x => x.id === hw.activeId)) hw = chooseHandwriting(hw, hw.profiles[0].id);
                persistHw({ sync: true }); state.variant = 0; loadStrokes(); renderAll();
            }
        }, ic('delete'))
    );
    const topBar = h('div', { class: 'hw-top' },
        h('div', { class: 'hw-prof-row' }, h('label', { class: 'hw-lbl', text: 'Handschrift' }), profSelect, profBtns),
        h('div', { class: 'hw-top-meta' }, progTxt, saveBadge,
            h('button', { type: 'button', class: 'cd-primary sm', title: 'Speichern und schließen', onclick: () => closeTrainer() }, ic('check'), ' Fertig'))
    );
    profSelect.addEventListener('change', () => {
        hw = chooseHandwriting(hw, profSelect.value);
        persistHw({ sync: true }); state.variant = 0; loadStrokes(); renderAll();
    });

    // ---- GoodNotes-Werkzeugleiste ----
    const toolbar = h('div', { class: 'gn-toolbar', role: 'toolbar', 'aria-label': 'Stifte' });
    const penGroup = h('div', { class: 'gn-group gn-pens' });
    const colorGroup = h('div', { class: 'gn-group gn-colors' });
    const widthGroup = h('div', { class: 'gn-group gn-widths' });
    const actGroup = h('div', { class: 'gn-group gn-acts' });
    const undoBtn = h('button', { type: 'button', class: 'gn-tool', title: 'Rückgängig', onclick: () => undo() }, ic('undo'));
    const redoBtn = h('button', { type: 'button', class: 'gn-tool', title: 'Wiederholen', onclick: () => redo() }, ic('redo'));
    const clearBtn = h('button', { type: 'button', class: 'gn-tool', title: 'Diese Variante leeren', onclick: () => clearVariant() }, ic('ink_eraser'));
    const ghostBtn = h('button', { type: 'button', class: 'gn-tool on', title: 'Vorlage ein/aus', onclick: () => { state.showGhost = !state.showGhost; ghostBtn.classList.toggle('on', state.showGhost); drawPad(); } }, ic('visibility'));
    const penOnlyBtn = h('button', { type: 'button', class: 'gn-tool', title: 'Nur Stift (Handballen ignorieren)', onclick: () => { state.penOnly = !state.penOnly; penOnlyBtn.classList.toggle('on', state.penOnly); } }, ic('stylus'));
    actGroup.append(undoBtn, redoBtn, clearBtn, h('i', { class: 'gn-sep' }), ghostBtn, penOnlyBtn);
    toolbar.append(penGroup, h('i', { class: 'gn-sep' }), colorGroup, h('i', { class: 'gn-sep' }), widthGroup, h('i', { class: 'gn-sep' }), actGroup);

    // ---- Schreibfeld ----
    const charHead = h('div', { class: 'hw-char-head' });
    const variantRow = h('div', { class: 'gn-variants' });
    const padCanvas = h('canvas', { class: 'hw-pad-canvas gn-pad' });
    const padBox = h('div', { class: 'hw-pad-wrap gn-page' }, padCanvas);
    const padHint = h('small', { class: 'hw-pad-hint', text: 'Schreib das Zeichen wie in GoodNotes auf die orange Grundlinie. Mehrere Varianten machen deine Schrift natürlicher.' });
    const nextBtn = h('button', { type: 'button', class: 'cd-primary', title: 'Speichern und nächstes Zeichen (Enter)', onclick: () => saveAndNext() }, ic('check'), ' Speichern & Weiter');
    const padFoot = h('div', { class: 'hw-pad-tools' }, padHint, nextBtn);
    const masterInfo = h('div', { class: 'gn-master-info', hidden: true });
    const stageLeft = h('div', { class: 'hw-stage' }, charHead, variantRow, padBox, padFoot, masterInfo);

    // ---- rechte Spalte ----
    const groupTabs = h('div', { class: 'hw-tabs' });
    const glyphGrid = h('div', { class: 'hw-grid' });
    const paperSel = h('div', { class: 'st-seg' });
    const prevInput = h('textarea', { class: 'cd-input hw-prev-in', rows: 3, value: state.previewText, placeholder: 'Testtext eingeben …' });
    prevInput.addEventListener('input', () => { state.previewText = prevInput.value; renderPreview(); });
    const prevCanvas = h('canvas', { class: 'hw-prev-canvas' });
    const preset = (lbl, txt) => h('button', { type: 'button', class: 'cd-btn sm', onclick: () => { prevInput.value = txt; state.previewText = txt; renderPreview(); } }, lbl);
    const prevBox = h('div', { class: 'hw-prev-box' },
        h('div', { class: 'hw-prev-head' },
            h('span', { class: 'hw-lbl', text: 'So sieht es im Heft aus' }),
            h('div', { class: 'hw-prev-presets' },
                preset('Mathe', 'Aufgabe 1\na) 3x+6=21 |-6\n• 3x=15 |:3\n• x=5\nb) x²-5x+6=0 → x₁=3, x₂=2'),
                preset('Text', '# Zusammenfassung\nStrom ist wichtig für das moderne Leben. In Europa ist Strom selbstverständlich, doch in ==Afrika== nicht.'),
                preset('A–Z', 'abcdefghijklm nopqrstuvwxyz äöüß\nABCDEFGHIJKLM NOPQRSTUVWXYZ\n0123456789 + - = ( ) ? !'))
        ),
        prevInput,
        h('div', { class: 'hw-prev-sheet' }, prevCanvas),
        h('div', { class: 'hw-style-two' }, h('div', {}, h('span', { class: 'hw-lbl', text: 'Papier' }), paperSel))
    );
    const deckRight = h('div', { class: 'hw-deck' }, groupTabs, glyphGrid, prevBox);
    root.append(topBar, ownerBox, toolbar, h('div', { class: 'hw-main' }, stageLeft, deckRight));

    // ---------- Werkzeuge ----------
    function renderTools() {
        const p = curProf();
        const locked = isMaster();
        penGroup.replaceChildren(...PENS.map(pen => h('button', {
            type: 'button', class: 'gn-tool gn-pen' + (penOf(p) === pen.id ? ' on' : ''), title: pen.name,
            onclick: () => { const t = ownProf(); if (locked) { updateMasterPrefs({ penStyle: pen.id }); masterChanged(); } else { t.penStyle = pen.id; touch(t); persistHw(); } renderTools(); drawPad(); renderGrid(); renderPreview(); }
        }, ic(PEN_ICON[pen.id]), h('span', { text: pen.name }))));
        const inkNow = (p.inkColor || '').toLowerCase();
        colorGroup.replaceChildren(...GN_COLORS.map(c => h('button', {
            type: 'button', class: 'gn-color' + (inkNow === c.hex ? ' on' : ''), title: c.name, style: { background: c.hex },
            onclick: () => { if (locked) { updateMasterPrefs({ inkColor: c.hex }); masterChanged(); } else { const t = ownProf(); t.inkColor = c.hex; touch(t); persistHw(); } renderTools(); drawPad(); renderGrid(); renderPreview(); }
        })));
        const scale = p.strokeScale || 1;
        widthGroup.replaceChildren(...THICKNESS.map((t, i) => h('button', {
            type: 'button', class: 'gn-width' + (Math.abs(scale - t.id) < 0.13 ? ' on' : ''), title: t.name,
            onclick: () => { if (locked) { updateMasterPrefs({ strokeScale: t.id }); masterChanged(); } else { const o = ownProf(); o.strokeScale = t.id; touch(o); persistHw(); } renderTools(); drawPad(); renderGrid(); renderPreview(); }
        }, h('i', { style: { width: (4 + i * 4) + 'px', height: (4 + i * 4) + 'px' } }))));
        paperSel.replaceChildren(...[['karo', 'Karo'], ['liniert', 'Liniert'], ['blanko', 'Blanko']].map(([k, lbl]) => h('button', {
            type: 'button', class: (p.paper || 'karo') === k ? 'active' : '',
            onclick: () => { if (locked) { updateMasterPrefs({ paper: k }); masterChanged(); } else { const o = ownProf(); o.paper = k; touch(o); persistHw(); } renderTools(); renderPreview(); }
        }, lbl)));
        for (const b of [undoBtn, redoBtn, clearBtn, ghostBtn, penOnlyBtn]) b.disabled = locked;
        undoBtn.disabled = locked || !state.strokes.length;
        redoBtn.disabled = locked || !state.redo.length;
    }

    // ---------- Admin: Kaydens einspielen (nur Admin-Mail) ----------
    async function renderOwner() {
        let mod = null;
        try { mod = await import('./hand-master.js'); } catch (_) { /* offline */ }
        if (!mod?.isHandOwner()) { ownerBox.hidden = true; return; }
        ownerBox.hidden = false;
        const m = getMasterProfile();
        const file = h('input', { type: 'file', accept: '.json,.gz,application/json', hidden: true });
        file.addEventListener('change', async () => {
            const f = file.files?.[0]; if (!f) return;
            try {
                const prof = await mod.importMasterFile(f);
                hw = normalizeHandwriting(StudyStore.handwriting());
                hw = chooseHandwriting(hw, MASTER_ID); persistHw({ sync: true });
                toast(`„${prof.name}“ ist gespeichert – nur für deine Admin-Mail.`, { type: 'ok' });
                renderAll();
            } catch (e) { toast(e.message || 'Import fehlgeschlagen.', { type: 'err' }); }
        });
        ownerBox.replaceChildren(
            ic('admin_panel_settings'),
            h('div', { class: 'hw-owner-txt' },
                h('b', { text: m ? `Kaydens ist vorgespeichert · ${trainedCount(m)} Zeichen, ${richVariantCount(m.rich)} Varianten` : 'Kaydens Handschrift einspielen' }),
                h('small', { text: m ? 'Liegt nur in der Datenbank und wird nur an deine Admin-Mail ausgeliefert.' : 'Datei „kaydens-handschrift.coden-hand.json“ wählen. Sie wird nur für deine Admin-Mail gespeichert.' })),
            file,
            h('button', { type: 'button', class: m ? 'cd-btn sm' : 'cd-primary sm', onclick: () => file.click() }, ic('upload_file'), m ? ' Ersetzen' : ' Datei wählen'),
            m ? h('button', {
                type: 'button', class: 'cd-btn sm', title: 'Kaydens aus der Datenbank löschen',
                onclick: async () => {
                    if (!(await confirmBox('Kaydens Handschrift aus der Datenbank löschen? Du kannst die Datei später wieder einspielen.', { ok: 'Löschen', danger: true }))) return;
                    try { await mod.deleteMaster(); if (hw.activeId === MASTER_ID) { hw = chooseHandwriting(hw, hw.profiles[0].id); persistHw({ sync: true }); } renderAll(); } catch (e) { toast(e.message, { type: 'err' }); }
                }
            }, ic('delete')) : null
        );
    }

    // ---------- Schreibfeld zeichnen ----------
    const PAD = 320;
    let activePointer = null, currentPts = null;
    function drawPad() {
        const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
        padCanvas.width = PAD * dpr; padCanvas.height = PAD * dpr;
        const ctx = padCanvas.getContext('2d');
        const s = PAD / 100 * dpr;
        // GoodNotes-Karo (10 Einheiten je Kästchen)
        drawPaper(ctx, { width: 100, height: 100, grid: 10, pitch: 30, firstBase: 72, paper: 'karo' }, { scale: s, px: dpr });
        const guide = (y, color, dash = [], lw = 1) => {
            ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = lw * dpr; ctx.setLineDash(dash.map(d => d * dpr));
            ctx.beginPath(); ctx.moveTo(0, y * s); ctx.lineTo(PAD * dpr, y * s); ctx.stroke(); ctx.restore();
        };
        guide(GUIDES.ascender, 'rgba(59,130,246,.45)', [4, 4]);
        guide(GUIDES.mid, 'rgba(59,130,246,.45)', [4, 4]);
        guide(GUIDES.baseline, '#f59e0b', [], 1.6);
        guide(GUIDES.descender, 'rgba(148,163,184,.6)', [4, 4]);
        if (state.showGhost && !isMaster()) {
            ctx.save();
            ctx.fillStyle = 'rgba(100, 116, 139, 0.13)';
            ctx.font = `400 ${Math.round(54 * s)}px "Kalam", "Caveat", cursive, sans-serif`;
            ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
            ctx.fillText(state.char, PAD * dpr / 2, GUIDES.baseline * s);
            ctx.restore();
        }
        const p = curProf();
        const all = currentPts?.length ? [...state.strokes, currentPts] : state.strokes;
        // Andere Varianten blass dahinter (wie Ebenen), damit die Größe gleich bleibt
        if (!isMaster()) {
            const others = variantsOf().filter((_, i) => i !== state.variant).flatMap(enc => decodeGlyphStrokes(enc));
            if (others.length) drawInk(ctx, others.map(st => ({ p: st.flatMap(([x, y]) => [x, y, 0.5]), w: 2.6 })), { color: 'rgba(100,116,139,.22)', pen: 'fineliner', scale: s });
        }
        drawInk(ctx, all.map(st => ({ p: st.flatMap(([x, y, pr]) => [x, y, pr]), w: 3.0 * (p.strokeScale || 1) })), { color: p.inkColor || '#1b1f2a', pen: penOf(p), scale: s });
    }

    const padPoint = (e) => {
        const r = padCanvas.getBoundingClientRect();
        const x = ((e.clientX - r.left) / r.width) * 100, y = ((e.clientY - r.top) / r.height) * 100;
        const pr = e.pointerType === 'pen' && e.pressure > 0 ? Math.max(0.12, Math.min(1, e.pressure)) : 0.55;
        return [Math.max(-10, Math.min(110, x)), Math.max(-10, Math.min(110, y)), pr];
    };
    padCanvas.addEventListener('pointerdown', (e) => {
        if (isMaster()) return;
        if (e.button && e.button !== 0) return;
        if (e.pointerType === 'pen' && !state.penOnly) { state.penOnly = true; penOnlyBtn.classList.add('on'); }
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
        for (const ev of (e.getCoalescedEvents ? e.getCoalescedEvents() : [e])) {
            const pt = padPoint(ev), last = currentPts[currentPts.length - 1];
            if (!last || Math.hypot(pt[0] - last[0], pt[1] - last[1]) >= 0.45) currentPts.push(pt);
        }
        drawPad();
    });
    const endStroke = (e) => {
        if (activePointer !== e.pointerId || !currentPts) return;
        state.strokes.push(currentPts);
        state.redo = [];
        currentPts = null; activePointer = null;
        commit(); renderHeader(); renderCharHead(); renderVariants(); renderTabs(); renderGrid(); renderTools(); drawPad(); renderPreview();
    };
    padCanvas.addEventListener('pointerup', endStroke);
    padCanvas.addEventListener('pointercancel', endStroke);
    padCanvas.addEventListener('lostpointercapture', endStroke);

    // aktuelle Variante speichern (leere Variante entfernen)
    function commit({ sync = false } = {}) {
        if (isMaster()) return false;
        const p = ownProf();
        const vars = variantsOf();
        if (state.strokes.length) {
            const enc = encodeGlyphStrokes(state.strokes);
            if (!enc) return false;
            vars[state.variant] = enc;
        } else if (vars[state.variant] != null) vars.splice(state.variant, 1);
        else return false;
        const clean = vars.filter(Boolean).slice(0, MAX_VARIANTS);
        if (clean.length) p.glyphs[state.char] = clean.join('#'); else delete p.glyphs[state.char];
        state.variant = Math.min(state.variant, Math.max(0, clean.length - (state.strokes.length ? 1 : 0)));
        touch(p); persistHw({ sync });
        return true;
    }
    function undo() {
        if (!state.strokes.length) return;
        state.redo.push(state.strokes.pop());
        const keep = state.redo;
        commit(); state.redo = keep; refreshChar();
    }
    function redo() {
        if (!state.redo.length) return;
        state.strokes.push(state.redo.pop());
        const keep = state.redo;
        commit(); state.redo = keep; refreshChar();
    }
    function clearVariant() {
        if (!state.strokes.length) return;
        state.strokes = []; state.redo = [];
        commit(); loadStrokes(); refreshChar();
    }
    const refreshChar = () => { renderHeader(); renderCharHead(); renderVariants(); renderTabs(); renderGrid(); renderTools(); drawPad(); renderPreview(); };

    function selectChar(ch, variant = 0) {
        state.char = ch; state.variant = variant;
        loadStrokes(); refreshChar();
    }
    function saveAndNext() {
        if (isMaster()) return;
        commit({ sync: true });
        const grp = CHAR_GROUPS.find(g => g.id === state.groupId) || CHAR_GROUPS[0];
        const idx = grp.chars.indexOf(state.char);
        if (idx === grp.chars.length - 1) toast(`Alle Zeichen in „${grp.label}“ durchlaufen! Tipp: Schreib noch eine 2. Variante.`, { type: 'ok' });
        selectChar(grp.chars[(idx + 1) % grp.chars.length], 0);
    }

    // ---------- Anzeigen ----------
    function renderHeader() {
        const list = allProfiles(hw);
        profSelect.replaceChildren(...list.map(x => h('option', { value: x.id, text: x.master ? `${x.name} (vorgespeichert)` : `${x.name} (${trainedCount(x)})`, ...(x.id === curProf().id ? { selected: true } : {}) })));
        const p = curProf();
        progTxt.textContent = isMaster()
            ? `${trainedCount(p)} Zeichen · ${richVariantCount(p.rich)} Varianten · ${Object.keys(p.rich.w || {}).length} Wörter`
            : `${trainedCount(p)} von ${ALL_TRAIN_CHARS.length} Zeichen · ${variantCount(p)} Varianten`;
        profBtns.classList.toggle('locked', isMaster());
    }
    function renderCharHead() {
        const grp = CHAR_GROUPS.find(g => g.id === state.groupId) || CHAR_GROUPS[0];
        const pos = grp.chars.indexOf(state.char) + 1;
        const n = variantsOf().length;
        charHead.replaceChildren(
            h('div', { class: 'hw-char-big', text: state.char }),
            h('div', { class: 'hw-char-info' },
                h('b', { text: `Zeichen „${state.char}“ ${n ? `✓ ${n} ${n === 1 ? 'Variante' : 'Varianten'}` : 'zeichnen'}` }),
                h('small', { text: pos > 0 ? `${grp.label} · ${pos} / ${grp.chars.length}` : 'Einzelzeichen' })),
            h('div', { class: 'hw-char-nav' },
                h('button', { type: 'button', class: 'cd-btn sm', title: 'Vorheriges Zeichen', onclick: () => { commit(); const i = grp.chars.indexOf(state.char); selectChar(grp.chars[(i - 1 + grp.chars.length) % grp.chars.length]); } }, ic('chevron_left')),
                h('button', { type: 'button', class: 'cd-btn sm', title: 'Nächstes Zeichen', onclick: () => { commit(); const i = grp.chars.indexOf(state.char); selectChar(grp.chars[(i + 1) % grp.chars.length]); } }, ic('chevron_right')))
        );
    }
    function renderVariants() {
        const n = variantsOf().length;
        const chips = [];
        for (let i = 0; i < Math.min(MAX_VARIANTS, n + 1); i++) {
            const isNew = i >= n;
            chips.push(h('button', {
                type: 'button', class: 'gn-var' + (i === state.variant ? ' on' : '') + (isNew ? ' new' : ''),
                title: isNew ? 'Neue Variante schreiben' : `Variante ${i + 1}`,
                onclick: () => { if (state.strokes.length) commit(); state.variant = i; loadStrokes(); refreshChar(); }
            }, isNew ? ic('add') : String(i + 1)));
        }
        variantRow.replaceChildren(h('span', { class: 'hw-lbl', text: 'Varianten' }), ...chips);
    }
    function renderTabs() {
        const p = ownProf();
        groupTabs.replaceChildren(...CHAR_GROUPS.map(g => {
            const done = g.chars.filter(c => !!p.glyphs?.[c]).length;
            return h('button', {
                type: 'button', class: 'hw-tab' + (g.id === state.groupId ? ' on' : ''),
                onclick: () => {
                    state.groupId = g.id;
                    if (!g.chars.includes(state.char)) { commit(); selectChar(g.chars.find(c => !p.glyphs?.[c]) || g.chars[0]); return; }
                    renderTabs(); renderCharHead(); renderGrid(); drawPad();
                }
            }, h('span', { text: g.label }), h('small', { text: `${done}/${g.chars.length}` }));
        }));
    }
    function renderGrid() {
        const p = ownProf();
        const grp = CHAR_GROUPS.find(g => g.id === state.groupId) || CHAR_GROUPS[0];
        glyphGrid.replaceChildren(...grp.chars.map(ch => {
            const vars = glyphVariants(p, ch);
            const tile = h('button', { type: 'button', class: 'hw-tile' + (state.char === ch ? ' cur' : '') + (vars.length ? ' done' : ''), title: `Zeichen ${ch}`, onclick: () => { commit(); selectChar(ch); } });
            if (vars.length) {
                const c = h('canvas', { class: 'hw-tile-c' });
                tile.append(c);
                paintTileGlyph(c, vars[0], p);
                tile.append(h('span', { class: 'hw-tile-lbl', text: ch }));
                if (vars.length > 1) tile.append(h('span', { class: 'hw-tile-n', text: '×' + vars.length }));
            } else tile.append(h('span', { class: 'hw-tile-empty', text: ch }));
            return tile;
        }));
    }
    function renderPreview() {
        const p = curProf();
        let prof = p;
        if (!isMaster() && state.strokes.length) {
            const vars = variantsOf(); vars[state.variant] = encodeGlyphStrokes(state.strokes);
            prof = { ...p, glyphs: { ...p.glyphs, [state.char]: vars.filter(Boolean).join('#') }, updatedAt: p.updatedAt + '*' + state.strokes.length };
        }
        renderHandwritingCanvas(prevCanvas, prevInput.value || 'Hallo Welt! 2 + 2 = 4', { hw, profileObj: prof, paper: p.paper || 'karo', ink: p.inkColor, width: 460, grid: 16, weight: p.rich ? p.strokeScale : 1 });
    }
    function renderMasterMode() {
        const m = isMaster();
        for (const el of [charHead, variantRow, padBox, padFoot, groupTabs, glyphGrid]) el.hidden = m;
        padBox.classList.toggle('locked', m);
        masterInfo.hidden = !m;
        if (m) masterInfo.replaceChildren(ic('verified'), h('div', {},
            h('b', { text: 'Kaydens – fertig gelernte Handschrift' }),
            h('small', { text: 'Echte GoodNotes-Striche aus dem Skill „meine-handschrift“ mit mehreren Varianten pro Zeichen und ganzen Wörtern. Stift, Farbe und Dicke kannst du oben wählen. Zum Selberschreiben oben eine eigene Handschrift wählen oder mit „Neu“ anlegen.' })));
    }
    function renderAll() {
        renderMasterMode(); renderHeader(); renderCharHead(); renderVariants(); renderTabs(); renderGrid(); renderTools(); drawPad(); renderPreview(); renderOwner();
    }

    const flush = () => {
        if (currentPts?.length) { state.strokes.push(currentPts); currentPts = null; activePointer = null; }
        if (!commit({ sync: true })) StudyStore.syncNow?.();
    };
    const onKey = (e) => {
        if (!root.isConnected) { document.removeEventListener('keydown', onKey); return; }
        if (/INPUT|TEXTAREA|SELECT/.test(e.target?.tagName)) return;
        if (e.key === 'Enter') { e.preventDefault(); saveAndNext(); }
        else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
    };
    const onChanged = (e) => { if (!root.isConnected) return document.removeEventListener('codenHandwritingChanged', onChanged); if (!e.detail) { renderHeader(); renderOwner(); } };
    document.addEventListener('keydown', onKey);
    window.addEventListener('pagehide', flush);

    renderAll();
    const m = modal('Handschrift trainieren', root, {
        wide: true,
        onClose: () => {
            flush();
            document.removeEventListener('keydown', onKey);
            document.removeEventListener('codenHandwritingChanged', onChanged);
            window.removeEventListener('pagehide', flush);
        }
    });
    setTimeout(() => document.addEventListener('codenHandwritingChanged', onChanged), 0);
    closeTrainer = () => m.close();
}
