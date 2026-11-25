// js/merkzettel.js – Merkzettel für den Schüler-Tab: ein A4-Blatt, das aussieht wie selbst geschrieben
// (Karo- oder Linienpapier, Handschrift, Textmarker mit unregelmäßigen Rändern, schiefe Merke-Kästen),
// mit Inhalten im Stil echter Schüler-Notizen statt KI-Fließtext. Export als PDF über den Druckdialog.
import { renderRichBlock } from './ui.js';
import { titleOf, defaultPaper } from './merkzettel-core.js';
export { merkzettelPrompt, cleanMerkzettel, titleOf, defaultPaper } from './merkzettel-core.js';

// ---------- Blatt bauen ----------
// kleiner, fester Zufall: gleiches Blatt sieht jedes Mal gleich aus
function rng(seed) { let x = 0; for (const c of String(seed)) x = (x * 31 + c.charCodeAt(0)) | 0; x = x || 7; return () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return ((x >>> 0) % 10000) / 10000; }; }
const between = (r, a, b) => a + (b - a) * r();

export function renderSheet(tool, { subject = '' } = {}) {
    const paper = document.createElement('article');
    paper.className = 'mz-paper mz-' + (tool.paper || defaultPaper(subject));
    const md = String(tool.markdown || '');
    const head = document.createElement('div'); head.className = 'mz-head';
    const subj = document.createElement('span'); subj.textContent = subject || '';
    const date = document.createElement('span'); date.textContent = new Date(tool.createdAt || Date.now()).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' });
    head.append(subj, date);
    const body = renderRichBlock(md.replace(/^#\s+(.+)$/m, ''), 'mz:' + (tool.id || ''));
    body.classList.add('mz-body');
    const h1 = document.createElement('h1'); h1.className = 'mz-title'; h1.textContent = titleOf(md);
    paper.append(head, h1, body);

    // Hand-Gefühl: leicht schiefe Marker, Überschriften und Kästen, Stifte wechseln
    const r = rng(tool.id || md.slice(0, 80));
    h1.style.transform = `rotate(${between(r, -1.4, 0.4).toFixed(2)}deg)`;
    const pens = ['pen-red', 'pen-blue', 'pen-green'];
    const pen = pens[Math.floor(r() * pens.length)];
    body.querySelectorAll('h2, h3').forEach((h, i) => {
        h.classList.add(i % 3 === 2 ? pens[(pens.indexOf(pen) + 1) % 3] : pen);
        h.style.transform = `rotate(${between(r, -0.9, 0.5).toFixed(2)}deg) translateX(${between(r, -3, 4).toFixed(1)}px)`;
        h.style.setProperty('--u', between(r, 55, 100).toFixed(0) + '%');
    });
    body.querySelectorAll('mark.hl').forEach(m => {
        m.style.setProperty('--tilt', between(r, -1.6, 1.1).toFixed(2) + 'deg');
        m.style.setProperty('--l', between(r, -4, -1).toFixed(1) + 'px');
        m.style.setProperty('--rr', `${between(r, 2, 9).toFixed(0)}px ${between(r, 3, 10).toFixed(0)}px ${between(r, 2, 8).toFixed(0)}px ${between(r, 4, 11).toFixed(0)}px`);
    });
    body.querySelectorAll('blockquote').forEach(q => {
        q.classList.add('mz-box');
        q.style.transform = `rotate(${between(r, -1.1, 0.9).toFixed(2)}deg)`;
        q.style.borderRadius = `${between(r, 4, 14).toFixed(0)}px ${between(r, 10, 22).toFixed(0)}px ${between(r, 6, 16).toFixed(0)}px ${between(r, 12, 24).toFixed(0)}px / ${between(r, 10, 20).toFixed(0)}px ${between(r, 4, 12).toFixed(0)}px ${between(r, 14, 22).toFixed(0)}px ${between(r, 6, 14).toFixed(0)}px`;
        const p = q.querySelector('p'); if (p) p.innerHTML = p.innerHTML.replace(/^\s*(Merke|Wichtig|Achtung)\s*[:!]\s*/i, (m, w) => `<b class="mz-merke">${w}!</b> `);
    });
    body.querySelectorAll(':scope > ul > li, :scope > ol > li').forEach(li => { li.style.marginLeft = between(r, -2, 3).toFixed(1) + 'px'; });
    body.querySelectorAll('.cw-card').forEach(c => c.classList.add('mz-sketch'));
    return paper;
}

// ---------- PDF (Druckdialog → "Als PDF speichern") ----------
export function printSheet(paper, title = 'Merkzettel') {
    document.getElementById('mz-print-root')?.remove();
    const root = document.createElement('div'); root.id = 'mz-print-root';
    root.append(paper.cloneNode(true)); document.body.append(root);
    const oldTitle = document.title; document.title = title.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'Merkzettel';
    document.body.classList.add('mz-printing');
    const done = () => { document.body.classList.remove('mz-printing'); root.remove(); document.title = oldTitle; window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    // Schriften müssen geladen sein, sonst druckt der Browser die Ersatzschrift
    (document.fonts?.ready || Promise.resolve()).then(() => setTimeout(() => window.print(), 50));
}
