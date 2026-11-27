// js/notebooks.js – Notizbücher wie in GoodNotes: Bibliothek mit Covern, Ordnern (beliebig tief), Favoriten,
// Zuletzt geöffnet, Suche, Sortierung, Drag & Drop, Verschieben, Duplizieren, PDF/Fotos importieren.
// Notizbücher brauchen kein Fach; Hefte aus Fächern erscheinen zusätzlich unter "Fächer".
import { modal, confirmBox } from './apps/dialogs.js';
import { toast } from './toast.js';
import { StudyStore } from './study-store.js';
import * as S from './study-core.js';
import { COVERS, COVER_STYLES, TEMPLATES } from './ink-core.js';
import { openInkEditor, createPages, filesToBackgrounds, deleteDocPages, copyPage, drawPaper, exportDocPdf } from './ink.js';
import { loader } from './rich-elements.js';

const h = (tag, attrs = {}, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v; else if (k === 'text') el.textContent = v;
        else if (k === 'style' && typeof v === 'object') { for (const [p, val] of Object.entries(v)) p.startsWith('--') ? el.style.setProperty(p, val) : (el.style[p] = val); }
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else if (k === 'value') el.value = v; else el.setAttribute(k, v === true ? '' : String(v));
    }
    for (const c of kids.flat()) if (c != null && c !== false) el.append(typeof c === 'string' ? document.createTextNode(c) : c);
    return el;
};
const ic = (n) => h('span', { class: 'material-symbols-outlined', 'aria-hidden': 'true', text: n });
const FOLDER_COLORS = ['#5B8DEF', '#30A46C', '#E5484D', '#F76B15', '#8E4EC6', '#12A594', '#978365', '#6B7280'];
// view: 'alle' | 'zuletzt' | 'favoriten' | 'ordner:<id>' | 'fach:<id>'
const ui = { view: 'alle', q: '', sort: localStorage.getItem('coden_nb_sort') || 'bearbeitet' };
let rerender = () => {};
const save = (st) => { StudyStore.save(st); rerender(); };
const when = (iso) => { if (!iso) return ''; const d = new Date(iso); const days = S.daysBetween(d, new Date()); const t = d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }); return days === 0 ? 'Heute ' + t : days === 1 ? 'Gestern ' + t : d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' }); };

export function openNotebook(st, doc, extra = {}) {
    doc.openedAt = new Date().toISOString(); StudyStore.save(st);
    const su = S.subjectOf(st, doc.subjectId);
    openInkEditor({ doc, subjectName: su?.name || '', persist: () => StudyStore.save(st), onClose: () => rerender(), ...extra });
}

export function renderNotebooksTab(rr) {
    rerender = rr; const st = StudyStore.get();
    if (ui.view.startsWith('ordner:') && !S.folderOf(st, ui.view.slice(7))) ui.view = 'alle';
    const wrap = h('div', { class: 'nb-lib' });
    wrap.append(sidebar(st), main(st));
    return wrap;
}

// ---------- Seitenleiste ----------
function sidebar(st) {
    const nav = h('nav', { class: 'nb-nav' });
    const item = (view, icon, label, count, extra = {}) => {
        const b = h('button', { type: 'button', class: 'nb-nav-i' + (ui.view === view ? ' on' : ''), onclick: () => { ui.view = view; ui.q = ''; rerender(); }, ...extra }, ic(icon), h('span', { class: 'nb-nav-l', text: label }), count != null ? h('small', { text: String(count) }) : null);
        return b;
    };
    nav.append(item('alle', 'auto_stories', 'Alle Notizbücher', st.docs.filter(d => !d.subjectId).length), item('zuletzt', 'history', 'Zuletzt geöffnet'), item('favoriten', 'star', 'Favoriten', st.docs.filter(d => d.favorite).length));
    nav.append(h('div', { class: 'nb-nav-h' }, h('span', { text: 'Ordner' }), h('button', { type: 'button', class: 'nb-mini', title: 'Neuer Ordner', onclick: () => folderDialog(st, null, null) }, ic('create_new_folder'))));
    const tree = (parentId, depth) => S.childFolders(st, parentId).forEach(f => {
        const b = item('ordner:' + f.id, 'folder', f.name, S.countIn(st, f.id), { style: { '--fc': f.color, paddingLeft: (10 + depth * 14) + 'px' } });
        b.classList.add('folder'); dropTarget(b, st, f.id); nav.append(b); tree(f.id, depth + 1);
    });
    tree(null, 0);
    if (!st.folders.length) nav.append(h('small', { class: 'nb-muted nb-pad', text: 'Noch keine Ordner' }));
    const withDocs = st.subjects.filter(su => st.docs.some(d => d.subjectId === su.id));
    if (withDocs.length) {
        nav.append(h('div', { class: 'nb-nav-h' }, h('span', { text: 'Aus Fächern' })));
        withDocs.forEach(su => { const b = item('fach:' + su.id, 'school', su.name, st.docs.filter(d => d.subjectId === su.id).length, { style: { '--fc': su.color } }); b.classList.add('folder'); nav.append(b); });
    }
    return nav;
}

// ---------- Hauptbereich ----------
function main(st) {
    const box = h('section', { class: 'nb-main' });
    const folderId = ui.view.startsWith('ordner:') ? ui.view.slice(7) : null;
    // Kopf: Pfad, Suche, Sortierung, Neu
    const search = h('input', { class: 'cd-input nb-search', type: 'search', placeholder: 'Notizbücher durchsuchen …', value: ui.q });
    search.addEventListener('input', () => { ui.q = search.value; const pos = search.selectionStart; rerender(); const s2 = document.querySelector('.nb-search'); if (s2) { s2.focus(); s2.setSelectionRange(pos, pos); } });
    const sort = h('select', { class: 'cd-input nb-sort', title: 'Sortieren' }, ...[['bearbeitet', 'Zuletzt bearbeitet'], ['geoeffnet', 'Zuletzt geöffnet'], ['erstellt', 'Erstellt'], ['name', 'Name']].map(([v, l]) => h('option', { value: v, text: l, ...(ui.sort === v ? { selected: true } : {}) })));
    sort.addEventListener('change', () => { ui.sort = sort.value; localStorage.setItem('coden_nb_sort', ui.sort); rerender(); });
    const hwBtn = h('button', { type: 'button', class: 'cd-btn', title: 'Eigene Handschrift für Coden trainieren', onclick: () => import('./handwriting.js').then(m => m.openHandwritingTrainer()) }, ic('stylus_note'), ' Handschrift');
    const newBtn = h('button', { type: 'button', class: 'cd-primary nb-new', onclick: (e) => newMenu(e.currentTarget, st, folderId) }, ic('add'), ' Neu');
    const crumbs = h('div', { class: 'nb-crumbs' });
    const crumb = (label, view) => h('button', { type: 'button', class: 'nb-crumb', text: label, onclick: () => { ui.view = view; rerender(); } });
    if (folderId) { crumbs.append(crumb('Alle Notizbücher', 'alle')); S.folderPath(st, folderId).forEach(f => crumbs.append(ic('chevron_right'), f.id === folderId ? h('b', { text: f.name }) : crumb(f.name, 'ordner:' + f.id))); }
    else crumbs.append(h('b', { text: { alle: 'Alle Notizbücher', zuletzt: 'Zuletzt geöffnet', favoriten: 'Favoriten' }[ui.view] || (ui.view.startsWith('fach:') ? 'Fach: ' + (S.subjectOf(st, ui.view.slice(5))?.name || '') : 'Notizbücher') }));
    box.append(h('div', { class: 'nb-head' }, crumbs, h('div', { class: 'nb-tools' }, search, sort, hwBtn, newBtn)));

    // Inhalt
    let folders = [], docs = [];
    if (ui.q.trim()) { docs = S.searchDocs(st, ui.q); box.append(h('small', { class: 'nb-muted', text: `${docs.length} Treffer für „${ui.q.trim()}“` })); }
    else if (ui.view === 'alle') { folders = S.childFolders(st, null); docs = st.docs.filter(d => !d.folderId && !d.subjectId); }
    else if (folderId) { folders = S.childFolders(st, folderId); docs = st.docs.filter(d => d.folderId === folderId); }
    else if (ui.view === 'zuletzt') docs = st.docs.filter(d => d.openedAt).sort((a, b) => b.openedAt.localeCompare(a.openedAt)).slice(0, 24);
    else if (ui.view === 'favoriten') docs = st.docs.filter(d => d.favorite);
    else if (ui.view.startsWith('fach:')) docs = st.docs.filter(d => d.subjectId === ui.view.slice(5));
    if (ui.view !== 'zuletzt' || ui.q) docs = S.sortDocs(docs, ui.sort);

    const grid = h('div', { class: 'nb-grid' });
    folders.forEach(f => grid.append(folderTile(st, f)));
    docs.forEach(d => grid.append(docTile(st, d)));
    if (!ui.q && (ui.view === 'alle' || folderId)) grid.append(h('button', { type: 'button', class: 'nb-tile nb-add', onclick: () => newDocDialog(st, folderId) }, h('div', { class: 'nb-add-cover' }, ic('add')), h('b', { text: 'Neues Notizbuch' })));
    if (!folders.length && !docs.length && (ui.q || !['alle'].includes(ui.view) && !folderId)) grid.append(h('p', { class: 'nb-muted', text: ui.q ? 'Nichts gefunden.' : ui.view === 'favoriten' ? 'Tippe bei einem Notizbuch auf ⋯ → „Zu Favoriten“.' : 'Hier ist noch nichts.' }));
    box.append(grid);
    if (folderId) dropTarget(box, st, folderId, true);
    return box;
}

function folderTile(st, f) {
    const t = h('div', { class: 'nb-tile nb-folder', role: 'button', tabindex: '0', style: { '--fc': f.color }, onclick: () => { ui.view = 'ordner:' + f.id; rerender(); }, onkeydown: (e) => { if (e.key === 'Enter') { ui.view = 'ordner:' + f.id; rerender(); } } },
        h('div', { class: 'nb-folder-icon' }, h('i'), h('span', { text: String(S.countIn(st, f.id)) })),
        h('div', { class: 'nb-tile-meta' }, h('b', { text: f.name }), h('small', { text: `${S.childFolders(st, f.id).length ? S.childFolders(st, f.id).length + ' Ordner · ' : ''}${S.countIn(st, f.id)} ${S.countIn(st, f.id) === 1 ? 'Notizbuch' : 'Notizbücher'}` })),
        h('button', { type: 'button', class: 'nb-more', title: 'Ordner-Aktionen', onclick: (e) => { e.stopPropagation(); folderMenu(e.currentTarget, st, f); } }, ic('more_horiz')));
    dropTarget(t, st, f.id); dragSource(t, 'folder', f.id);
    return t;
}
export function coverEl(doc, small = false) {
    const c = doc.cover || { color: '#2B3A55', style: 'leinen' };
    return h('div', { class: `nb-cover ${c.style || 'leinen'}${small ? ' small' : ''}`, style: { '--cv': c.color } }, h('div', { class: 'nb-label' }, h('span', { text: doc.title || 'Notizbuch' })));
}
function docTile(st, d) {
    const su = S.subjectOf(st, d.subjectId);
    const t = h('div', { class: 'nb-tile nb-doc', role: 'button', tabindex: '0', onclick: () => openNotebook(st, d), onkeydown: (e) => { if (e.key === 'Enter') openNotebook(st, d); } },
        coverEl(d),
        h('div', { class: 'nb-tile-meta' }, h('b', {}, d.favorite ? ic('star') : null, d.title || 'Notizbuch'), h('small', { text: [when(d.updatedAt), `${d.pages.length} S.`, su ? su.name : null].filter(Boolean).join(' · ') })),
        h('button', { type: 'button', class: 'nb-more', title: 'Aktionen', onclick: (e) => { e.stopPropagation(); docMenu(e.currentTarget, st, d); } }, ic('more_horiz')));
    dragSource(t, 'doc', d.id);
    return t;
}

// ---------- Drag & Drop ----------
function dragSource(el, kind, id) { el.draggable = true; el.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/coden-nb', JSON.stringify({ kind, id })); e.dataTransfer.effectAllowed = 'move'; el.classList.add('dragging'); }); el.addEventListener('dragend', () => el.classList.remove('dragging')); }
function dropTarget(el, st, folderId, soft = false) {
    el.addEventListener('dragover', (e) => { if (![...e.dataTransfer.types].includes('text/coden-nb')) return; e.preventDefault(); e.stopPropagation(); el.classList.add('drop'); });
    el.addEventListener('dragleave', () => el.classList.remove('drop'));
    el.addEventListener('drop', (e) => {
        el.classList.remove('drop'); let d; try { d = JSON.parse(e.dataTransfer.getData('text/coden-nb')); } catch (_) { return; } e.preventDefault(); e.stopPropagation();
        if (d.kind === 'doc') { const doc = st.docs.find(x => x.id === d.id); if (!doc || doc.folderId === folderId) return; doc.folderId = folderId; save(st); toast(`In „${S.folderOf(st, folderId)?.name}“ verschoben`, { type: 'ok' }); }
        else if (d.kind === 'folder' && d.id !== folderId) { if (S.moveFolder(st, d.id, folderId)) save(st); else toast('Ein Ordner kann nicht in sich selbst.', { type: 'warn' }); }
    });
    if (soft) el.classList.add('drop-soft');
}

// ---------- Menüs ----------
function popMenu(anchor, items) {
    document.querySelector('.nb-pop')?.remove();
    const pop = h('div', { class: 'nb-pop' }, ...items.filter(Boolean).map(([icon, label, fn, danger]) => h('button', { type: 'button', class: 'nb-pop-i' + (danger ? ' danger' : ''), onclick: () => { pop.remove(); fn(); } }, ic(icon), h('span', { text: label }))));
    document.body.append(pop); const r = anchor.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight, pad = 8, gap = 6;
    const maxW = Math.max(160, vw - pad * 2);
    pop.style.maxWidth = maxW + 'px';
    pop.style.overflowY = 'auto';
    const mw = Math.min(pop.offsetWidth || 220, maxW);
    const spaceBelow = Math.max(0, vh - r.bottom - pad - gap);
    const spaceAbove = Math.max(0, r.top - pad - gap);
    const openUp = pop.scrollHeight > spaceBelow && spaceAbove > spaceBelow;
    const availH = Math.max(80, Math.floor(openUp ? spaceAbove : spaceBelow));
    const finalH = Math.min(pop.scrollHeight || 200, availH);
    const top = openUp ? Math.max(pad, r.top - gap - finalH) : Math.min(vh - pad - finalH, r.bottom + gap);
    pop.style.left = Math.round(Math.max(pad, Math.min(vw - mw - pad, r.right - mw))) + 'px';
    pop.style.top = Math.round(top) + 'px';
    pop.style.maxHeight = Math.max(80, Math.min(availH, Math.floor(vh - pad - top))) + 'px';
    setTimeout(() => document.addEventListener('pointerdown', function off(e) { if (!pop.contains(e.target)) { pop.remove(); document.removeEventListener('pointerdown', off); } }), 0);
}
function newMenu(anchor, st, folderId) {
    popMenu(anchor, [
        ['auto_stories', 'Notizbuch', () => newDocDialog(st, folderId)],
        ['create_new_folder', 'Ordner', () => folderDialog(st, null, folderId)],
        ['upload_file', 'PDF / Fotos importieren', () => importDialog(st, folderId)],
        ['document_scanner', 'Schulbuch-Seite scannen', () => scanTextbookToNotebook(st, folderId)]
    ]);
}
function docMenu(anchor, st, d) {
    popMenu(anchor, [
        ['open_in_new', 'Öffnen', () => openNotebook(st, d)],
        ['picture_as_pdf', 'Als PDF exportieren', () => exportNotebookPdf(st, d)],
        ['edit', 'Umbenennen', () => { const n = prompt('Neuer Name:', d.title); if (n && n.trim()) { d.title = n.trim().slice(0, 80); save(st); } }],
        ['palette', 'Cover ändern', () => coverDialog(st, d)],
        [d.favorite ? 'star' : 'grade', d.favorite ? 'Aus Favoriten entfernen' : 'Zu Favoriten', () => { d.favorite = !d.favorite; save(st); }],
        ['drive_file_move', 'Verschieben nach …', () => moveDialog(st, d)],
        ['content_copy', 'Duplizieren', () => duplicateDoc(st, d)],
        ['delete', 'Löschen', async () => { if (!(await confirmBox(`„${d.title}“ mit allen ${d.pages.length} Seiten löschen?`, { ok: 'Löschen', danger: true }))) return; deleteDocPages(d.id); st.docs = st.docs.filter(x => x.id !== d.id); save(st); }, true]
    ]);
}
function folderMenu(anchor, st, f) {
    popMenu(anchor, [
        ['edit', 'Umbenennen / Farbe', () => folderDialog(st, f)],
        ['create_new_folder', 'Unterordner', () => folderDialog(st, null, f.id)],
        ['drive_file_move', 'Verschieben nach …', () => moveDialog(st, null, f)],
        ['delete', 'Ordner löschen', async () => { if (!(await confirmBox(`Ordner „${f.name}“ löschen? Die Notizbücher darin bleiben erhalten und wandern eine Ebene nach oben.`, { ok: 'Ordner löschen', danger: true }))) return; S.deleteFolder(st, f.id); if (ui.view === 'ordner:' + f.id) ui.view = f.parentId ? 'ordner:' + f.parentId : 'alle'; save(st); }, true]
    ]);
}

// ---------- Dialoge ----------
function coverPicker(cover) {
    const cur = { color: cover?.color || COVERS[0], style: cover?.style || 'leinen' };
    const preview = coverEl({ title: '', cover: cur }, true);
    const colors = h('div', { class: 'nb-swatches' }, ...COVERS.map(c => h('button', { type: 'button', class: 'nb-sw' + (c === cur.color ? ' on' : ''), style: { background: c }, onclick: (e) => { cur.color = c; colors.querySelectorAll('.nb-sw').forEach(x => x.classList.toggle('on', x === e.currentTarget)); upd(); } })));
    const styles = h('div', { class: 'nb-styles' }, ...COVER_STYLES.map(([v, l]) => h('button', { type: 'button', class: 'nb-style' + (v === cur.style ? ' on' : ''), onclick: (e) => { cur.style = v; styles.querySelectorAll('.nb-style').forEach(x => x.classList.toggle('on', x === e.currentTarget)); upd(); } }, l)));
    const upd = () => { preview.className = `nb-cover ${cur.style} small`; preview.style.setProperty('--cv', cur.color); };
    return { el: h('div', { class: 'nb-coverpick' }, preview, h('div', {}, colors, styles)), get: () => ({ ...cur }), preview };
}
function paperPicker(sel = 'liniert') {
    let cur = sel;
    const box = h('div', { class: 'nb-papers' }, ...TEMPLATES.map(([v, l]) => { const c = h('canvas', { width: 70, height: 99 }); drawPaper(c.getContext('2d'), v, 0.07); return h('button', { type: 'button', class: 'nb-paper' + (v === cur ? ' on' : ''), onclick: (e) => { cur = v; box.querySelectorAll('.nb-paper').forEach(x => x.classList.toggle('on', x === e.currentTarget)); } }, c, h('span', { text: l })); }));
    return { el: box, get: () => cur };
}
const field = (label, input) => h('label', { class: 'sd-field' }, h('span', { text: label }), input);
function folderSelect(st, sel) {
    const opts = [h('option', { value: '', text: 'Keinem Ordner (oberste Ebene)' })];
    const walk = (pid, depth) => S.childFolders(st, pid).forEach(f => { opts.push(h('option', { value: f.id, text: '  '.repeat(depth) + '📁 ' + f.name, ...(f.id === sel ? { selected: true } : {}) })); walk(f.id, depth + 1); });
    walk(null, 0); return h('select', { class: 'cd-input' }, ...opts);
}
function newDocDialog(st, folderId) {
    const title = h('input', { class: 'cd-input', placeholder: 'z. B. Mathe Mitschrift, Tagebuch, Ideen …' });
    const cover = coverPicker({ color: COVERS[st.docs.length % COVERS.length], style: 'leinen' });
    title.addEventListener('input', () => { cover.preview.querySelector('span').textContent = title.value; });
    const paper = paperPicker('liniert');
    const folder = folderSelect(st, folderId);
    const subj = h('select', { class: 'cd-input' }, h('option', { value: '', text: 'Kein Fach' }), ...st.subjects.map(s => h('option', { value: s.id, text: s.name })));
    const go = h('button', { class: 'cd-primary' }, ic('check'), ' Erstellen');
    const m = modal('Neues Notizbuch', h('div', { class: 'sd-form nb-form' }, field('Titel', title), field('Cover', cover.el), field('Papier', paper.el),
        h('div', { class: 'nb-two' }, field('Ordner', folder), field('Fach (optional)', subj)),
        h('div', { class: 'cd-row end' }, h('button', { class: 'cd-btn', text: 'Abbrechen', onclick: () => m.close() }), go)), { wide: true });
    go.addEventListener('click', async () => {
        go.disabled = true; go.replaceChildren(loader({ size: 18 }), ' Wird erstellt …');
        try {
            const d = S.newDoc(st, { title: title.value.trim() || 'Unbenanntes Notizbuch', folderId: folder.value || null, subjectId: subj.value || null, paper: paper.get(), cover: cover.get() });
            d.pages = await createPages(d, [null], d.paper); StudyStore.save(st); m.close(); rerender(); openNotebook(st, d);
        } catch (e) { toast('Erstellen ging nicht: ' + e.message, { type: 'error' }); go.disabled = false; go.replaceChildren(ic('check'), ' Erstellen'); }
    });
    setTimeout(() => title.focus(), 60);
}
function importDialog(st, folderId) {
    const input = h('input', { type: 'file', accept: 'application/pdf,image/*', multiple: true, hidden: true });
    input.addEventListener('change', async () => {
        const files = [...input.files]; if (!files.length) return;
        const busy = toast('Wird importiert …', { type: 'info', ms: 60000 });
        try {
            const bgs = await filesToBackgrounds(files); if (!bgs.length) throw new Error('Nur PDFs oder Fotos.');
            const name = files[0].name.replace(/\.[a-z0-9]+$/i, '').slice(0, 80);
            const d = S.newDoc(st, { title: files.length > 1 ? name + ' …' : name, folderId, paper: 'blanko', cover: { color: COVERS[(st.docs.length + 3) % COVERS.length], style: 'glatt' } });
            d.pages = await createPages(d, bgs, 'blanko'); StudyStore.save(st); rerender();
            toast(`„${d.title}“ importiert (${d.pages.length} Seiten) – du kannst direkt darauf schreiben.`, { type: 'ok' }); openNotebook(st, d);
        } catch (e) { toast('Import ging nicht: ' + e.message, { type: 'error' }); } finally { busy?.remove?.(); }
    });
    document.body.append(input); input.click(); setTimeout(() => input.remove(), 60000);
}
function folderDialog(st, f = null, parentId = null) {
    const name = h('input', { class: 'cd-input', value: f?.name || '', placeholder: 'z. B. 10. Klasse, Mathe, Privat …' });
    let color = f?.color || FOLDER_COLORS[st.folders.length % FOLDER_COLORS.length];
    const sw = h('div', { class: 'nb-swatches' }, ...FOLDER_COLORS.map(c => h('button', { type: 'button', class: 'nb-sw' + (c === color ? ' on' : ''), style: { background: c }, onclick: (e) => { color = c; sw.querySelectorAll('.nb-sw').forEach(x => x.classList.toggle('on', x === e.currentTarget)); } })));
    const m = modal(f ? 'Ordner bearbeiten' : 'Neuer Ordner', h('div', { class: 'sd-form' }, field('Name', name), field('Farbe', sw),
        h('div', { class: 'cd-row end' }, h('button', { class: 'cd-btn', text: 'Abbrechen', onclick: () => m.close() }), h('button', { class: 'cd-primary', text: f ? 'Speichern' : 'Erstellen', onclick: () => {
            const n = name.value.trim(); if (!n) return;
            if (f) { f.name = n.slice(0, 60); f.color = color; } else { const nf = S.addFolder(st, n, parentId, color); if (!parentId) ui.view = 'ordner:' + nf.id; }
            m.close(); save(st);
        } }))));
    setTimeout(() => name.focus(), 60);
}
function moveDialog(st, doc = null, folder = null) {
    const list = h('div', { class: 'nb-movelist' });
    const pick = (id) => {
        if (doc) { doc.folderId = id; if (id) doc.subjectId = doc.subjectId; }
        else if (!S.moveFolder(st, folder.id, id)) { toast('Ein Ordner kann nicht in sich selbst.', { type: 'warn' }); return; }
        m.close(); save(st); toast(id ? `Verschoben nach „${S.folderOf(st, id).name}“` : 'Auf die oberste Ebene verschoben', { type: 'ok' });
    };
    list.append(h('button', { type: 'button', class: 'nb-move-i', onclick: () => pick(null) }, ic('home'), h('span', { text: 'Oberste Ebene' })));
    const walk = (pid, depth) => S.childFolders(st, pid).forEach(f => {
        const off = folder && (f.id === folder.id || S.isInside(st, f.id, folder.id));
        list.append(h('button', { type: 'button', class: 'nb-move-i', disabled: off || (doc && doc.folderId === f.id), style: { paddingLeft: (12 + depth * 18) + 'px', '--fc': f.color }, onclick: () => pick(f.id) }, ic('folder'), h('span', { text: f.name })));
        walk(f.id, depth + 1);
    });
    walk(null, 0);
    const m = modal(`„${doc?.title || folder?.name}“ verschieben`, h('div', { class: 'sd-form' }, list, h('button', { type: 'button', class: 'cd-btn', onclick: () => { const n = prompt('Name des neuen Ordners:'); if (!n) return; const nf = S.addFolder(st, n); pick(nf.id); } }, ic('create_new_folder'), ' Neuer Ordner …')));
}
function coverDialog(st, d) {
    const cover = coverPicker(d.cover); cover.preview.querySelector('span').textContent = d.title;
    const m = modal('Cover ändern', h('div', { class: 'sd-form' }, cover.el, h('div', { class: 'cd-row end' }, h('button', { class: 'cd-btn', text: 'Abbrechen', onclick: () => m.close() }), h('button', { class: 'cd-primary', text: 'Übernehmen', onclick: () => { d.cover = cover.get(); m.close(); save(st); } }))));
}
async function duplicateDoc(st, d) {
    const busy = toast('Wird dupliziert …', { type: 'info', ms: 60000 });
    try {
        const copy = S.newDoc(st, { title: d.title + ' (Kopie)', folderId: d.folderId, subjectId: d.subjectId, paper: d.paper, cover: { ...(d.cover || {}) } });
        for (const id of d.pages) copy.pages.push(await copyPage(id, copy.id));
        save(st); toast('Kopie erstellt', { type: 'ok' });
    } catch (e) { toast('Duplizieren ging nicht: ' + e.message, { type: 'error' }); } finally { busy?.remove?.(); }
}

async function exportNotebookPdf(st, d) {
    const su = S.subjectOf(st, d.subjectId);
    const busy = toast('PDF wird erstellt …', { type: 'info', ms: 60000 });
    try {
        const res = await exportDocPdf(d, { subjectName: su?.name || '', withCorrection: true });
        toast(`„${res.filename}“ (${res.pages} S.) gespeichert`, { type: 'ok' });
    } catch (e) {
        toast('PDF-Export ging nicht: ' + (e.message || e), { type: 'error' });
    } finally {
        busy?.remove?.();
    }
}

async function scanTextbookToNotebook(st, folderId) {
    const { openTextbookScanModal } = await import('./study-scan.js');
    openTextbookScanModal({
        defaultGoal: 'handwriting',
        onSavedHandwriting: async ({ title, text }) => {
            const { saveHandwritingAsNotebook } = await import('./handwriting.js');
            await saveHandwritingAsNotebook({ title, text });
            rerender();
        }
    });
}
