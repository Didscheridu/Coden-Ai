// js/ink-core.js – Grundlagen des Coden-Hefts ohne DOM (testbar): Seitenmaße, Vorlagen, Striche speichern,
// Formen erkennen (Linie, Rechteck, Dreieck, Kreis/Ellipse, Vieleck), Teil-Radierer, Lasso-Auswahl, Verschieben/Skalieren.

export const PAGE_W = 1000, PAGE_H = 1414; // A4 hochkant in Seiten-Einheiten
export const TEMPLATES = [['blanko', 'Blanko'], ['liniert', 'Liniert'], ['eng', 'Schmal liniert'], ['karo', 'Karo'], ['punkte', 'Punkte'], ['cornell', 'Cornell-Notizen'], ['noten', 'Notenlinien']];
export const PEN_TYPES = [['fueller', 'Füller'], ['kugel', 'Kugelschreiber'], ['pinsel', 'Pinsel']];
export const COVERS = ['#2B3A55', '#1F5F8B', '#2E7D5B', '#8C2F39', '#B5542D', '#C59B3B', '#6B4C9A', '#3D3D3D', '#C8B8A6', '#E8D9C4'];
export const COVER_STYLES = [['leinen', 'Leinen'], ['glatt', 'Glatt'], ['punkte', 'Punkte'], ['streifen', 'Streifen']];

// ---------- Striche speichern: Ganzzahlen, Unterschiede zum vorigen Punkt ----------
// Strich: { t: 'pen'|'hl', c: Farbe, w: Breite, k: Stiftart, p: [x, y, druck, …] }
export function encodeStrokes(strokes) {
    return JSON.stringify(strokes.map(s => {
        const d = []; let px = 0, py = 0, pp = 0;
        for (let i = 0; i < s.p.length; i += 3) { const x = Math.round(s.p[i] * 10), y = Math.round(s.p[i + 1] * 10), p = Math.round((s.p[i + 2] ?? 0.5) * 100); d.push(x - px, y - py, p - pp); px = x; py = y; pp = p; }
        return s.k && s.k !== 'fueller' ? [s.t, s.c, s.w, d, s.k] : [s.t, s.c, s.w, d];
    }));
}
export function decodeStrokes(str) {
    let arr; try { arr = JSON.parse(str || '[]'); } catch (_) { return []; }
    return (Array.isArray(arr) ? arr : []).map(([t, c, w, d, k]) => {
        const p = []; let x = 0, y = 0, q = 0;
        for (let i = 0; i + 2 < (d || []).length; i += 3) { x += d[i]; y += d[i + 1]; q += d[i + 2]; p.push(x / 10, y / 10, q / 100); }
        return { t: t === 'hl' ? 'hl' : 'pen', c: String(c || '#1b1f2a'), w: +w || 2, k: ['kugel', 'pinsel'].includes(k) ? k : 'fueller', p };
    }).filter(s => s.p.length >= 3);
}

// Strichbreite je nach Stiftart und Druck
export function widthAt(s, pressure) {
    if (s.t === 'hl') return s.w;
    const p = Math.max(0.05, Math.min(1, pressure));
    if (s.k === 'kugel') return s.w * 0.85;
    if (s.k === 'pinsel') return s.w * (0.15 + 1.7 * p);
    return s.w * (0.35 + 0.95 * p);
}

// ---------- Geometrie ----------
export function bbox(points) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < points.length; i += 3) { const x = points[i], y = points[i + 1]; if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
const distToSeg = (px, py, ax, ay, bx, by) => { const dx = bx - ax, dy = by - ay; const l = dx * dx + dy * dy; let t = l ? ((px - ax) * dx + (py - ay) * dy) / l : 0; t = Math.max(0, Math.min(1, t)); return Math.hypot(px - (ax + t * dx), py - (ay + t * dy)); };
// Ramer–Douglas–Peucker auf [[x,y], …]
function rdp(pts, eps) {
    if (pts.length < 3) return pts;
    let max = 0, idx = 0; const a = pts[0], b = pts[pts.length - 1];
    for (let i = 1; i < pts.length - 1; i++) { const d = distToSeg(pts[i][0], pts[i][1], a[0], a[1], b[0], b[1]); if (d > max) { max = d; idx = i; } }
    if (max <= eps) return [a, b];
    return rdp(pts.slice(0, idx + 1), eps).slice(0, -1).concat(rdp(pts.slice(idx), eps));
}
const densify = (verts, step = 6) => {
    const out = [];
    for (let i = 0; i < verts.length - 1; i++) {
        const [ax, ay] = verts[i], [bx, by] = verts[i + 1]; const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / step));
        for (let k = 0; k < n; k++) out.push(ax + (bx - ax) * k / n, ay + (by - ay) * k / n, 0.5);
    }
    const [lx, ly] = verts[verts.length - 1]; out.push(lx, ly, 0.5); return out;
};

// Form erkennen: liefert { kind, p } mit sauberen Punkten oder null (dann bleibt der Strich, wie er ist)
export function recognizeShape(p) {
    const n = p.length / 3; if (n < 6) return null;
    const pts = []; for (let i = 0; i < p.length; i += 3) pts.push([p[i], p[i + 1]]);
    const b = bbox(p); const diag = Math.hypot(b.w, b.h); if (diag < 25) return null;
    const [sx, sy] = pts[0], [ex, ey] = pts[pts.length - 1];
    let len = 0; for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    const closed = Math.hypot(ex - sx, ey - sy) < Math.max(18, diag * 0.22);
    if (!closed) {
        // Linie: alle Punkte nah an der Verbindung von Anfang und Ende
        const dev = Math.max(...pts.map(([x, y]) => distToSeg(x, y, sx, sy, ex, ey)));
        if (dev < Math.max(6, Math.hypot(ex - sx, ey - sy) * 0.06)) {
            let [ax, ay, bx, by] = [sx, sy, ex, ey];
            const ang = Math.atan2(by - ay, bx - ax), snap = Math.round(ang / (Math.PI / 4)) * (Math.PI / 4);
            if (Math.abs(ang - snap) < 0.07) { const L = Math.hypot(bx - ax, by - ay); bx = ax + Math.cos(snap) * L; by = ay + Math.sin(snap) * L; } // waagrecht/senkrecht/45° einrasten
            return { kind: 'linie', p: densify([[ax, ay], [bx, by]]) };
        }
        const v = rdp(pts, diag * 0.06);
        if (v.length >= 3 && v.length <= 6) return { kind: 'zickzack', p: densify(v) };
        return null;
    }
    // geschlossen: Ellipse prüfen (Abstand zum Mittelpunkt relativ zu den Halbachsen)
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2, rx = Math.max(1, b.w / 2), ry = Math.max(1, b.h / 2);
    const ell = pts.reduce((a, [x, y]) => a + Math.abs(Math.hypot((x - cx) / rx, (y - cy) / ry) - 1), 0) / pts.length;
    let v = rdp(pts.concat([pts[0]]), diag * 0.085); if (v.length > 1 && Math.hypot(v[0][0] - v[v.length - 1][0], v[0][1] - v[v.length - 1][1]) < diag * 0.15) v = v.slice(0, -1);
    const corners = v.length;
    if (corners === 3) return { kind: 'dreieck', p: densify([...v, v[0]]) };
    if (corners === 4 && ell > 0.07) {
        // fast achsparallel → echtes Rechteck
        const axis = v.every((q, i) => { const r = v[(i + 1) % 4]; const a = Math.abs(Math.atan2(r[1] - q[1], r[0] - q[0])) % (Math.PI / 2); return a < 0.2 || a > Math.PI / 2 - 0.2; });
        const rect = axis ? [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]] : v;
        return { kind: 'rechteck', p: densify([...rect, rect[0]]) };
    }
    if (ell < 0.14) {
        const out = []; const steps = 72;
        const circle = Math.abs(rx - ry) / Math.max(rx, ry) < 0.12; const r = (rx + ry) / 2;
        for (let i = 0; i <= steps; i++) { const a = i / steps * Math.PI * 2; out.push(cx + Math.cos(a) * (circle ? r : rx), cy + Math.sin(a) * (circle ? r : ry), 0.5); }
        return { kind: circle ? 'kreis' : 'ellipse', p: out };
    }
    if (corners >= 5 && corners <= 8) return { kind: 'vieleck', p: densify([...v, v[0]]) };
    return null;
}

// ---------- Teil-Radierer: Punkte im Radius entfernen, Strich in Stücke teilen ----------
export function eraseFrom(strokes, x, y, r) {
    let changed = false; const out = [];
    for (const s of strokes) {
        const rr = r + widthAt(s, 1) / 2;
        let hit = false; for (let j = 0; j < s.p.length; j += 3) if (Math.abs(s.p[j] - x) < rr && Math.abs(s.p[j + 1] - y) < rr && Math.hypot(s.p[j] - x, s.p[j + 1] - y) < rr) { hit = true; break; }
        if (!hit) { out.push(s); continue; }
        changed = true; let cur = [];
        for (let j = 0; j < s.p.length; j += 3) {
            const inside = Math.hypot(s.p[j] - x, s.p[j + 1] - y) < rr;
            if (inside) { if (cur.length >= 6) out.push({ ...s, p: cur }); cur = []; }
            else cur.push(s.p[j], s.p[j + 1], s.p[j + 2]);
        }
        if (cur.length >= 6) out.push({ ...s, p: cur });
    }
    return changed ? out : strokes;
}
// Ganze Striche löschen, die der Radierer berührt
export function eraseWhole(strokes, x, y, r) {
    const out = strokes.filter(s => { const rr = r + widthAt(s, 1) / 2; for (let j = 0; j < s.p.length; j += 3) if (Math.abs(s.p[j] - x) < rr && Math.abs(s.p[j + 1] - y) < rr && Math.hypot(s.p[j] - x, s.p[j + 1] - y) < rr) return false; return true; });
    return out.length === strokes.length ? strokes : out;
}

// ---------- Lasso ----------
export function pointInPoly(x, y, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [xi, yi] = poly[i], [xj, yj] = poly[j];
        if (((yi > y) !== (yj > y)) && x < (xj - xi) * (y - yi) / ((yj - yi) || 1e-9) + xi) inside = !inside;
    }
    return inside;
}
// Welche Striche/Texte/Bilder liegen im Lasso? (Striche: mehr als die Hälfte der Punkte)
export function lassoSelect(page, poly) {
    const si = [], ti = [], ii = [];
    (page.strokes || []).forEach((s, i) => { let n = 0, inn = 0; for (let j = 0; j < s.p.length; j += 3) { n++; if (pointInPoly(s.p[j], s.p[j + 1], poly)) inn++; } if (n && inn / n > 0.5) si.push(i); });
    (page.text || []).forEach((t, i) => { if (pointInPoly(t.x + 10, t.y + t.z / 2, poly)) ti.push(i); });
    (page.items || []).forEach((it, i) => { if (pointInPoly(it.x + it.w / 2, it.y + it.h / 2, poly)) ii.push(i); });
    return { si, ti, ii };
}
export function selectionBox(page, sel) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const add = (a, b, c, d) => { x0 = Math.min(x0, a); y0 = Math.min(y0, b); x1 = Math.max(x1, c); y1 = Math.max(y1, d); };
    sel.si.forEach(i => { const s = page.strokes[i]; if (!s) return; const b = bbox(s.p); const pad = widthAt(s, 1) / 2; add(b.x - pad, b.y - pad, b.x + b.w + pad, b.y + b.h + pad); });
    sel.ti.forEach(i => { const t = page.text[i]; if (!t) return; const lines = String(t.s).split('\n'); add(t.x, t.y, t.x + Math.max(...lines.map(l => l.length)) * t.z * 0.55, t.y + lines.length * t.z * 1.35); });
    sel.ii.forEach(i => { const it = page.items[i]; if (it) add(it.x, it.y, it.x + it.w, it.y + it.h); });
    return x0 === Infinity ? null : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
// Auswahl verschieben (dx, dy) und skalieren (Faktor f um den Ankerpunkt ax, ay). Gibt eine neue Seite zurück.
export function transformSelection(page, sel, { dx = 0, dy = 0, f = 1, ax = 0, ay = 0 } = {}) {
    const X = (x) => ax + (x - ax) * f + dx, Y = (y) => ay + (y - ay) * f + dy;
    const strokes = page.strokes.slice(), text = page.text.slice(), items = page.items.slice();
    sel.si.forEach(i => { const s = strokes[i]; if (!s) return; const p = new Array(s.p.length); for (let j = 0; j < s.p.length; j += 3) { p[j] = X(s.p[j]); p[j + 1] = Y(s.p[j + 1]); p[j + 2] = s.p[j + 2]; } strokes[i] = { ...s, p, w: s.w * (f === 1 ? 1 : Math.max(0.4, Math.min(3, f))) }; });
    sel.ti.forEach(i => { const t = text[i]; if (t) text[i] = { ...t, x: X(t.x), y: Y(t.y), z: Math.max(8, Math.min(120, t.z * f)) }; });
    sel.ii.forEach(i => { const it = items[i]; if (it) items[i] = { ...it, x: X(it.x), y: Y(it.y), w: it.w * f, h: it.h * f }; });
    return { strokes, text, items };
}

// ---------- Tinte wie GoodNotes: geglättete Linie, Umriss mit Druck, sanfter Anfang, rundes Ende ----------
// Liefert den Umriss eines Strichs als Punktliste [[x,y], …] in Seiten-Einheiten (zum Füllen).
const KIND = { fueller: { thin: 0.55, stream: 0.5 }, pinsel: { thin: 0.85, stream: 0.45 }, kugel: { thin: 0.08, stream: 0.55 } };
export function strokeOutline(s) {
    const cfg = KIND[s.k] || KIND.fueller; const size = s.w * 1.15; const p = s.p;
    // 1) glätten (Zittern vom Stift raus) und doppelte Punkte überspringen
    const pts = []; let px = p[0], py = p[1], pr = p[2] ?? 0.5;
    pts.push([px, py, pr]);
    for (let i = 3; i < p.length; i += 3) {
        const t = 1 - cfg.stream; const nx = px + (p[i] - px) * t, ny = py + (p[i + 1] - py) * t;
        if (Math.hypot(nx - px, ny - py) < 0.35 && i < p.length - 3) continue;
        pr = pr + ((p[i + 2] ?? 0.5) - pr) * 0.35; px = nx; py = ny; pts.push([px, py, pr]);
    }
    const lx = p[p.length - 3], ly = p[p.length - 2]; if (Math.hypot(lx - px, ly - py) > 0.5) pts.push([lx, ly, pr]);
    const n = pts.length;
    if (n < 2) { const r = size * (1 - cfg.thin + cfg.thin * (pts[0][2])) / 2; const out = []; for (let a = 0; a < 12; a++) out.push([pts[0][0] + Math.cos(a / 12 * 6.283) * r, pts[0][1] + Math.sin(a / 12 * 6.283) * r]); return out; }
    // 2) Radius je Punkt: Druck + sanft anschwellender Anfang und auslaufendes Ende
    const dist = [0]; for (let i = 1; i < n; i++) dist.push(dist[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const total = dist[n - 1]; const taper = Math.min(total / 3, size * 2.2);
    const rad = pts.map((q, i) => {
        let r = size / 2 * (1 - cfg.thin + cfg.thin * Math.max(0.05, Math.min(1, q[2])));
        if (taper > 0) { r *= 0.55 + 0.45 * Math.min(1, dist[i] / taper); r *= 0.75 + 0.25 * Math.min(1, (total - dist[i]) / taper); }
        return Math.max(0.25, r);
    });
    // 3) linke und rechte Kante entlang der Normalen
    const L = [], R = [];
    for (let i = 0; i < n; i++) {
        const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
        let dx = b[0] - a[0], dy = b[1] - a[1]; const len = Math.hypot(dx, dy) || 1; dx /= len; dy /= len;
        L.push([pts[i][0] - dy * rad[i], pts[i][1] + dx * rad[i]]); R.push([pts[i][0] + dy * rad[i], pts[i][1] - dx * rad[i]]);
    }
    // 4) runde Kappen
    const cap = (c, r, from, to) => { const out = []; for (let k = 1; k < 8; k++) { const t = from + (to - from) * k / 8; out.push([c[0] + Math.cos(t) * r, c[1] + Math.sin(t) * r]); } return out; };
    const e = pts[n - 1], s0 = pts[0]; const ae = Math.atan2(L[n - 1][1] - e[1], L[n - 1][0] - e[0]); const as = Math.atan2(R[0][1] - s0[1], R[0][0] - s0[0]);
    return [...L, ...cap(e, rad[n - 1], ae, ae - Math.PI), ...R.reverse(), ...cap(s0, rad[0], as, as - Math.PI)];
}
// Auswahl drehen (nur Striche) um den Mittelpunkt
export function rotateSelection(page, sel, angle, cx, cy) {
    const c = Math.cos(angle), s = Math.sin(angle); const strokes = page.strokes.slice();
    sel.si.forEach(i => { const st = strokes[i]; if (!st) return; const p = new Array(st.p.length); for (let j = 0; j < st.p.length; j += 3) { const x = st.p[j] - cx, y = st.p[j + 1] - cy; p[j] = cx + x * c - y * s; p[j + 1] = cy + x * s + y * c; p[j + 2] = st.p[j + 2]; } strokes[i] = { ...st, p }; });
    return { strokes, text: page.text.slice(), items: page.items.slice() };
}
// Handballen-Erkennung: Berührungen mit großer Fläche oder kurz nach dem Stift sind die Hand, nicht ein Finger
export function isPalm(e, lastPenAt, now = Date.now()) {
    if (e.pointerType !== 'touch') return false;
    if (now - lastPenAt < 900) return true;
    const big = Math.max(e.width || 0, e.height || 0); return big > 44;
}
// Gleichmäßige Seitenränder beim Zoomen (kein plötzlicher Sprung bei 0,98, genug Platz zum Verschieben beim Rein- und Rauszoomen)
export function stageMetrics({ stageW = 800, stageH = 900, cssW = 768, zoom = 1 } = {}) {
    const out = zoom < 1 ? Math.min(1, (1 - zoom) / 0.25) : 0;
    const inn = zoom > 1 ? Math.min(1, (zoom - 1) / 0.5) : 0;
    const baseX = Math.max(16, Math.round((stageW - cssW) / 2));
    const padx = baseX + Math.round(out * stageW * 0.45 + inn * stageW * 0.25);
    const padyTop = Math.round(22 + out * stageH * 0.35 + inn * stageH * 0.25);
    const padyBottom = Math.max(padyTop, Math.round(120 + out * stageH * 0.25 + inn * stageH * 0.3));
    return { padx, padyTop, padyBottom };
}
