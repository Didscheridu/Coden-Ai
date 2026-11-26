// js/handwriting-core.js – Handschrift-Datenmodell, Vektor-Glyphen (kompakt kodiert),
// Fallback-Handschrift, Zeilenumbruch-Layout auf Karo/Liniert/Blanko und Chat-Prompt (ohne DOM, testbar).

const uid = (p = 'hw') => p + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const str = (v, n = 60) => String(v ?? '').trim().slice(0, n);

// Orientierungslinien im normierten 100×100 Trainingsfeld
export const GUIDES = {
    ascender: 18, // Oberlinie (b, d, h, k, l, t, Großbuchstaben, Ziffern)
    mid: 42,      // Mittellinie / x-Höhe (a, c, e, m, n, o, r, s, …)
    baseline: 72, // Grundlinie
    descender: 92 // Unterlänge (g, j, p, q, y)
};

export const INK_COLORS = [
    { id: 'navy', name: 'Tinte Dunkelblau', hex: '#1b3b8b' },
    { id: 'blue', name: 'Füller Königsblau', hex: '#1d4ed8' },
    { id: 'black', name: 'Tintenschwarz', hex: '#1b1f2a' },
    { id: 'graphite', name: 'Graphit', hex: '#475569' },
    { id: 'green', name: 'Grün', hex: '#15803d' },
    { id: 'red', name: 'Korrekturrot', hex: '#c62828' },
    { id: 'purple', name: 'Violett', hex: '#6d28d9' }
];

const INK_MAP = Object.fromEntries(INK_COLORS.map(c => [c.id, c.hex]));
export function resolveInkHex(ink, fallback = '#1b3b8b') {
    const v = String(ink || '').trim().toLowerCase();
    if (!v) return fallback;
    if (/^#[0-9a-f]{3,8}$/i.test(v)) return v;
    const alias = { blau: 'blue', dunkelblau: 'navy', königsblau: 'blue', koenigsblau: 'blue', schwarz: 'black', grau: 'graphite', bleistift: 'graphite', grün: 'green', gruen: 'green', rot: 'red', lila: 'purple', violett: 'purple' };
    return INK_MAP[v] || INK_MAP[alias[v]] || fallback;
}

export const CHAR_GROUPS = [
    { id: 'quick', label: 'Schnellstart', chars: [...'aeinrstuldhcmogbwfkzpväöüß0123456789+-=.,?'] },
    { id: 'lower', label: 'Kleinbuchstaben', chars: [...'abcdefghijklmnopqrstuvwxyzäöüß'] },
    { id: 'upper', label: 'Großbuchstaben', chars: [...'ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÜ'] },
    { id: 'math', label: 'Ziffern & Mathe', chars: [...'0123456789+-=·:/()[].,?!%^√±≈≠≤≥<>'] }
];

// Alle empfohlenen Trainingszeichen in fester Reihenfolge
export const ALL_TRAIN_CHARS = (() => {
    const seen = new Set(); const out = [];
    for (const g of CHAR_GROUPS) for (const c of g.chars) if (!seen.has(c)) { seen.add(c); out.push(c); }
    return out;
})();

export function blankProfile(name = 'Meine Handschrift') {
    const now = new Date().toISOString();
    return {
        id: uid('hw'),
        name: str(name, 40) || 'Meine Handschrift',
        inkColor: '#1b3b8b',
        paper: 'karo',
        penStyle: 'fueller',
        strokeScale: 1,
        letterSpacing: 1,
        slantDeg: 0,
        glyphs: {},
        createdAt: now,
        updatedAt: now
    };
}

export function blankHandwriting() {
    const p = blankProfile('Meine Handschrift');
    return { v: 1, activeId: p.id, profiles: [p] };
}

export function normalizeHandwriting(raw) {
    const x = raw && typeof raw === 'object' ? raw : {};
    const list = Array.isArray(x.profiles) ? x.profiles : [];
    const profiles = [];
    const seenIds = new Set();
    for (const item of list.slice(0, 6)) {
        if (!item || typeof item !== 'object') continue;
        let id = str(item.id, 48).replace(/[^a-zA-Z0-9_-]/g, '') || uid('hw');
        if (seenIds.has(id)) id = uid('hw');
        seenIds.add(id);
        const glyphs = {};
        if (item.glyphs && typeof item.glyphs === 'object') {
            for (const k of Object.keys(item.glyphs).slice(0, 160)) {
                const ch = [...String(k)].slice(0, 1).join('');
                const val = typeof item.glyphs[k] === 'string' ? item.glyphs[k].slice(0, 4000) : '';
                if (ch && val && decodeGlyphStrokes(val).length) glyphs[ch] = val;
            }
        }
        profiles.push({
            id,
            name: str(item.name, 40) || 'Handschrift',
            inkColor: resolveInkHex(item.inkColor, '#1b3b8b'),
            paper: ['karo', 'liniert', 'blanko'].includes(item.paper) ? item.paper : 'karo',
            penStyle: ['fueller', 'kugel', 'fein'].includes(item.penStyle) ? item.penStyle : 'fueller',
            strokeScale: clamp(+item.strokeScale || 1, 0.65, 1.6),
            letterSpacing: clamp(+item.letterSpacing || 1, 0.7, 1.5),
            slantDeg: clamp(+item.slantDeg || 0, -14, 18),
            glyphs,
            createdAt: typeof item.createdAt === 'string' ? item.createdAt.slice(0, 40) : new Date().toISOString(),
            updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt.slice(0, 40) : new Date().toISOString()
        });
    }
    if (!profiles.length) return blankHandwriting();
    const activeId = profiles.some(p => p.id === x.activeId) ? x.activeId : profiles[0].id;
    return { v: 1, activeId, profiles };
}

export function activeProfile(hw, requested = '') {
    const h = normalizeHandwriting(hw);
    const q = String(requested || '').trim().toLowerCase();
    if (q) {
        const match = h.profiles.find(p => p.id.toLowerCase() === q || p.name.toLowerCase() === q)
            || h.profiles.find(p => p.name.toLowerCase().includes(q));
        if (match) return match;
    }
    return h.profiles.find(p => p.id === h.activeId) || h.profiles[0];
}

export const trainedCount = (profile) => Object.keys(profile?.glyphs || {}).length;

// ---------- Kompakte Glyphen-Kodierung (0..100 Box, 1/10-Genauigkeit) ----------
function distSeg(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    const t = l2 ? clamp(((px - ax) * dx + (py - ay) * dy) / l2, 0, 1) : 0;
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function rdp(pts, eps) {
    if (pts.length < 3) return pts;
    let max = 0, idx = 0;
    const a = pts[0], b = pts[pts.length - 1];
    for (let i = 1; i < pts.length - 1; i++) {
        const d = distSeg(pts[i][0], pts[i][1], a[0], a[1], b[0], b[1]);
        if (d > max) { max = d; idx = i; }
    }
    if (max <= eps) return [a, b];
    return rdp(pts.slice(0, idx + 1), eps).slice(0, -1).concat(rdp(pts.slice(idx), eps));
}

// strokes: Array von Punktlisten [[x,y,p], ...] oder flachen Arrays [x,y,p,...] im 0..100 Feld
export function encodeGlyphStrokes(strokes) {
    const parts = [];
    for (const s of (strokes || [])) {
        let pts = [];
        if (Array.isArray(s) && Array.isArray(s[0])) pts = s.map(q => [clamp(+q[0] || 0, -15, 115), clamp(+q[1] || 0, -15, 115), clamp(+q[2] || 0.5, 0.05, 1)]);
        else if (Array.isArray(s)) {
            for (let i = 0; i + 1 < s.length; i += 3) pts.push([clamp(+s[i] || 0, -15, 115), clamp(+s[i + 1] || 0, -15, 115), clamp(+(s[i + 2] ?? 0.5), 0.05, 1)]);
        }
        if (!pts.length) continue;
        const simplified = pts.length > 3 ? rdp(pts, 0.9) : pts;
        const tok = simplified.map(([x, y, p]) => `${Math.round(x * 10)},${Math.round(y * 10)},${clamp(Math.round(p * 10), 1, 10)}`);
        if (tok.length) parts.push(tok.join(';'));
    }
    return parts.join('|');
}

export function decodeGlyphStrokes(encoded) {
    if (!encoded || typeof encoded !== 'string') return [];
    const out = [];
    for (const strokeStr of encoded.split('|')) {
        if (!strokeStr) continue;
        const pts = [];
        for (const ptStr of strokeStr.split(';')) {
            const [xr, yr, pr] = ptStr.split(',');
            const x = Number(xr), y = Number(yr), p = Number(pr);
            if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
            pts.push([x / 10, y / 10, clamp((Number.isFinite(p) ? p : 5) / 10, 0.05, 1)]);
        }
        if (pts.length) out.push(pts);
    }
    return out;
}

export function glyphBounds(strokes) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const s of strokes) {
        for (const [x, y] of s) {
            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if (x > maxX) maxX = x;
            if (y > maxY) maxY = y;
        }
    }
    return Number.isFinite(minX) ? { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY } : null;
}

// ---------- Fallback-Handschrift (humanistische Druck-/Schreibschrift im 100×100 Raster) ----------
// Grundlinie y = 72, Mittellinie y = 42, Oberlinie y = 18, Unterlänge y = 92
function parseDef(defStr) {
    return defStr.split('|').map(st =>
        st.trim().split(/\s+/).filter(Boolean).map(pair => {
            const [x, y] = pair.split(',').map(Number);
            return [x, y, 0.55];
        })
    );
}

const RAW_FALLBACK = {
    a: '46,45 36,42 26,47 22,58 25,69 34,72 44,66 49,54 50,43|50,43 49,64 52,72 57,71',
    b: '25,18 25,72|25,52 33,43 44,44 50,55 48,67 38,72 26,69',
    c: '50,47 41,42 30,45 24,57 27,69 38,72 51,68',
    d: '49,47 40,42 29,46 24,58 28,69 39,72 48,64|50,18 50,65 53,72',
    e: '25,58 46,56 50,49 44,42 33,43 25,52 25,65 34,72 48,69',
    f: '49,21 43,18 36,22 34,34 34,72|24,44 46,44',
    g: '49,46 40,42 29,46 24,58 28,69 39,72 48,64|50,43 50,79 45,90 34,92 25,87',
    h: '25,18 25,72|25,53 33,43 44,43 49,51 49,72',
    i: '35,44 35,72|34,29 36,31',
    j: '42,44 42,81 36,91 27,91 23,86|41,29 43,31',
    k: '25,18 25,72|48,43 26,58 49,72',
    l: '34,18 34,67 39,72 44,70',
    m: '20,44 20,72|20,51 27,43 35,44 38,52 38,72|38,51 45,43 53,44 57,52 57,72',
    n: '25,44 25,72|25,52 33,43 44,43 49,52 49,72',
    o: '37,42 26,47 23,58 27,69 38,72 49,67 52,55 47,45 37,42',
    p: '25,43 25,92|25,51 34,43 45,44 51,55 48,67 38,72 26,69',
    q: '49,46 40,42 29,46 24,58 28,69 39,72 48,64|50,43 50,92|46,80 57,74',
    r: '26,44 26,72|26,53 33,44 42,42 48,46',
    s: '48,46 39,42 28,45 27,52 37,57 48,61 48,69 37,72 25,69',
    t: '34,23 34,66 39,72 46,70|23,43 46,43',
    u: '25,43 25,64 31,71 42,71 49,62|50,43 50,72',
    v: '23,43 37,72 51,43',
    w: '19,43 28,72 38,50 47,72 57,43',
    x: '24,43 50,72|50,43 24,72',
    y: '24,43 37,71|51,43 35,81 28,92 22,92',
    z: '25,44 49,44 24,71 50,71',
    ä: '46,45 36,42 26,47 22,58 25,69 34,72 44,66 49,54 50,43|50,43 49,64 52,72 57,71|29,30 31,31|43,30 45,31',
    ö: '37,42 26,47 23,58 27,69 38,72 49,67 52,55 47,45 37,42|29,30 31,31|43,30 45,31',
    ü: '25,43 25,64 31,71 42,71 49,62|50,43 50,72|29,30 31,31|43,30 45,31',
    ß: '26,72 26,28 32,19 43,19 49,26 47,36 37,43 49,50 51,62 45,71 34,71',
    A: '20,72 38,18 56,72|27,53 49,53',
    B: '24,18 24,72|24,18 42,19 49,27 46,38 35,43 24,43|35,43 48,47 52,58 47,69 35,72 24,72',
    C: '54,25 44,18 30,22 22,36 22,56 30,69 44,72 54,65',
    D: '23,18 23,72|23,18 41,20 52,32 54,50 47,66 34,72 23,72',
    E: '50,19 25,19 25,71 51,71|25,44 45,44',
    F: '50,19 25,19 25,72|25,45 45,45',
    G: '53,25 43,18 29,22 22,37 22,57 31,70 45,72 54,64 54,50 40,50',
    H: '23,18 23,72|52,18 52,72|23,45 52,45',
    I: '37,18 37,72|27,19 47,19|27,71 47,71',
    J: '47,18 47,58 41,70 30,72 22,64',
    K: '24,18 24,72|51,19 25,47 53,72',
    L: '25,18 25,71 51,71',
    M: '20,72 22,19 39,49 56,19 58,72',
    N: '23,72 23,19 52,71 52,18',
    O: '38,18 25,24 21,42 23,61 33,71 45,71 54,58 55,39 48,23 38,18',
    P: '24,18 24,72|24,18 42,19 50,28 48,40 37,46 24,46',
    Q: '38,18 25,24 21,42 23,61 33,71 45,71 54,58 55,39 48,23 38,18|42,58 57,76',
    R: '24,18 24,72|24,18 42,19 50,28 48,40 37,46 24,46|36,46 52,72',
    S: '51,24 41,18 28,21 24,32 32,41 47,48 52,59 46,70 33,72 22,66',
    T: '19,19 56,19|37,19 37,72',
    U: '23,18 23,56 29,69 40,72 50,65 53,52 53,18',
    V: '20,18 37,72 54,18',
    W: '16,18 26,72 37,38 48,72 59,18',
    X: '22,18 53,72|53,18 22,72',
    Y: '21,18 37,46 53,18|37,46 37,72',
    Z: '22,19 53,19 22,71 54,71',
    Ä: '20,72 38,18 56,72|27,53 49,53|29,9 31,11|44,9 46,11',
    Ö: '38,18 25,24 21,42 23,61 33,71 45,71 54,58 55,39 48,23 38,18|29,9 31,11|44,9 46,11',
    Ü: '23,18 23,56 29,69 40,72 50,65 53,52 53,18|29,9 31,11|44,9 46,11',
    0: '38,19 26,26 22,45 25,64 36,72 48,66 52,47 48,27 38,19',
    1: '26,32 39,19 39,72',
    2: '24,29 31,19 44,19 51,28 48,40 34,55 23,71 53,71',
    3: '24,26 33,19 45,20 50,29 44,39 34,43 46,47 52,58 46,69 34,72 23,67',
    4: '43,19 22,53 54,53|46,35 46,72',
    5: '50,19 28,19 26,43 38,40 49,46 51,59 44,70 32,72 23,67',
    6: '48,21 37,19 26,29 22,49 26,67 37,72 48,67 51,55 44,46 32,46 24,54',
    7: '22,20 52,20 31,72|29,47 46,47',
    8: '38,19 27,24 26,35 37,43 49,51 51,63 43,72 30,71 23,61 28,50 47,36 48,24 38,19',
    9: '49,34 45,22 34,19 24,25 23,37 30,46 42,46 50,38|50,29 46,61 36,72 26,70',
    '.': '34,69 36,72',
    ',': '36,68 35,76 30,82',
    ':': '35,45 36,47|35,69 36,72',
    ';': '36,45 37,47|36,68 35,76 30,82',
    '!': '36,19 36,56|35,69 36,72',
    '?': '25,27 32,19 44,19 50,27 46,38 36,46 36,56|35,69 36,72',
    '-': '24,50 50,50',
    '–': '22,50 52,50',
    '—': '18,50 56,50',
    '−': '24,50 50,50',
    '+': '37,35 37,65|22,50 52,50',
    '=': '22,43 52,43|22,57 52,57',
    '*': '37,31 37,53|27,36 47,48|47,36 27,48',
    '·': '36,49 38,51',
    '×': '25,38 49,62|49,38 25,62',
    '÷': '22,50 52,50|36,36 38,38|36,62 38,64',
    '/': '49,18 25,74',
    '\\': '25,18 49,74',
    '(': '45,17 34,30 30,48 34,66 45,79',
    ')': '29,17 40,30 44,48 40,66 29,79',
    '[': '45,18 32,18 32,76 45,76',
    ']': '29,18 42,18 42,76 29,76',
    '{': '45,18 37,22 37,42 30,47 37,52 37,72 45,76',
    '}': '29,18 37,22 37,42 44,47 37,52 37,72 29,76',
    '<': '49,34 25,49 49,64',
    '>': '25,34 49,49 25,64',
    '^': '26,38 37,22 48,38',
    '_': '20,76 54,76',
    '|': '37,16 37,78',
    '%': '28,21 22,26 24,33 32,31 33,24 28,21|48,19 25,72|46,59 40,64 42,71 50,69 51,62 46,59',
    '&': '49,69 27,42 25,27 33,20 42,23 41,34 24,52 24,66 34,72 45,67 52,53',
    '°': '37,21 31,24 31,32 39,34 43,27 37,21',
    "'": '37,19 35,33',
    '"': '31,19 29,32|43,19 41,32',
    '€': '51,25 40,19 28,25 23,44 26,64 38,72 51,67|18,41 44,41|18,52 42,52',
    '$': '48,25 38,19 27,23 26,33 37,42 48,49 48,62 37,69 24,65|37,14 37,75',
    '√': '16,52 24,50 32,74 47,20 62,20',
    '±': '37,28 37,54|23,41 51,41|23,66 51,66',
    '≈': '21,42 30,36 42,46 53,40|21,57 30,51 42,61 53,55',
    '≠': '22,43 52,43|22,57 52,57|46,30 28,70',
    '≤': '49,28 24,42 49,56|23,67 51,67',
    '≥': '25,28 50,42 25,56|23,67 51,67',
    '→': '18,50 56,50|46,41 56,50 46,59',
    '←': '56,50 18,50|28,41 18,50 28,59',
    '↔': '18,50 56,50|27,42 18,50 27,58|47,42 56,50 47,58',
    'π': '22,42 54,42|30,42 28,71|45,42 45,67 51,71',
    'α': '51,44 42,63 32,72 24,69 22,57 28,45 37,44 45,56 50,70 56,69',
    'β': '26,84 26,28 33,19 44,20 48,29 44,38 34,43 46,49 49,61 42,71 31,70'
};

const FALLBACK_PARSED = Object.fromEntries(Object.entries(RAW_FALLBACK).map(([k, v]) => [k, parseDef(v)]));

const SUPERSCRIPTS = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', '⁻': '-', '⁺': '+', 'ⁿ': 'n' };
const SUBSCRIPTS = { '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4', '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9', '₋': '-', '₊': '+' };

function transformGlyph(strokes, { scale = 1, dx = 0, dy = 0, slantRad = 0 } = {}) {
    return strokes.map(s => s.map(([x, y, p]) => {
        const sy = (y - GUIDES.baseline) * scale + GUIDES.baseline + dy;
        const sx = (x - 50) * scale + 50 + dx - (sy - GUIDES.baseline) * Math.tan(slantRad);
        return [sx, sy, p];
    }));
}

// Liefert { strokes, isTrained, bounds } für genau 1 Zeichen (inkl. Hoch-/Tiefstellung & Fallback)
export function resolveCharGlyph(ch, profile) {
    const glyphs = profile?.glyphs || {};
    if (glyphs[ch]) {
        const st = decodeGlyphStrokes(glyphs[ch]);
        if (st.length) return { strokes: st, isTrained: true, bounds: glyphBounds(st) };
    }
    if (SUPERSCRIPTS[ch]) {
        const base = resolveCharGlyph(SUPERSCRIPTS[ch], profile);
        const st = transformGlyph(base.strokes, { scale: 0.56, dy: -31 });
        return { strokes: st, isTrained: base.isTrained, bounds: glyphBounds(st) };
    }
    if (SUBSCRIPTS[ch]) {
        const base = resolveCharGlyph(SUBSCRIPTS[ch], profile);
        const st = transformGlyph(base.strokes, { scale: 0.56, dy: 14 });
        return { strokes: st, isTrained: base.isTrained, bounds: glyphBounds(st) };
    }
    // Umlaut aus trainiertem Grundbuchstaben zusammensetzen, falls nur Grundbuchstabe trainiert wurde
    const uml = { ä: 'a', ö: 'o', ü: 'u', Ä: 'A', Ö: 'O', Ü: 'U' };
    if (uml[ch] && glyphs[uml[ch]]) {
        const base = decodeGlyphStrokes(glyphs[uml[ch]]);
        const b = glyphBounds(base);
        if (b) {
            const cx = (b.minX + b.maxX) / 2;
            const dy = /[AÄOÖUÜ]/.test(ch) ? Math.min(10, b.minY - 7) : Math.min(31, b.minY - 7);
            const dots = [[[cx - 7, dy, 0.7], [cx - 5, dy + 1.5, 0.7]], [[cx + 5, dy, 0.7], [cx + 7, dy + 1.5, 0.7]]];
            const st = [...base, ...dots];
            return { strokes: st, isTrained: true, bounds: glyphBounds(st) };
        }
    }
    const fb = FALLBACK_PARSED[ch] || FALLBACK_PARSED[ch.toLowerCase()];
    if (fb) return { strokes: fb, isTrained: false, bounds: glyphBounds(fb) };
    return null;
}

// ---------- Text vor dem Zeichnen aufbereiten (kleine LaTeX/Markdown-Reste säubern) ----------
export function cleanHandwritingText(raw) {
    let s = String(raw || '').replace(/\r\n?/g, '\n');
    s = s.replace(/==\s*(?:[a-zäöü]+\s*:)?([\s\S]*?)==/gi, '$1');
    s = s.replace(/\{\{\s*[a-zäöü]+\s*:([\s\S]*?)\}\}/gi, '$1');
    s = s.replace(/\\frac\s*\{([^}]+)\}\s*\{([^}]+)\}/g, '($1) / ($2)');
    s = s.replace(/\\sqrt\s*\{([^}]+)\}/g, '√($1)');
    s = s.replace(/\\(cdot|times)/g, (_, k) => (k === 'times' ? '×' : '·'));
    s = s.replace(/\\(pm|approx|neq|leq|le|geq|ge|to|rightarrow|leftarrow|pi|alpha|beta)/g, (_, k) => ({
        pm: '±', approx: '≈', neq: '≠', leq: '≤', le: '≤', geq: '≥', ge: '≥',
        to: '→', rightarrow: '→', leftarrow: '←', pi: 'π', alpha: 'α', beta: 'β'
    }[k] || k));
    s = s.replace(/\^([0-9+-])/g, (_, d) => ({ '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '-': '⁻', '+': '⁺' }[d] || '^' + d));
    s = s.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/(?<!\w)\*([^*\n]+)\*(?!\w)/g, '$1');
    s = s.replace(/\$+/g, '').replace(/\t/g, '    ');
    return s.trim();
}

// Deterministischer Pseudo-Zufall für natürliche Handschrift-Variation ohne Flackern
function jitterHash(a, b, c = 0) {
    let h = ((a + 1) * 73856093) ^ ((b + 1) * 19349663) ^ ((c + 1) * 83492791);
    h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
    return ((h >>> 0) % 1000) / 1000; // 0..0.999
}

function measureCharWidth(ch, profile, charSize, spacingMul) {
    if (ch === ' ') return charSize * 0.28 * spacingMul;
    const g = resolveCharGlyph(ch, profile);
    if (!g || !g.bounds) return charSize * 0.36 * spacingMul;
    const rawW = Math.max(8, g.bounds.w);
    const pad = /[.,:;!|'"]/.test(ch) ? 7 : 10;
    return ((rawW + pad) / 100) * charSize * spacingMul;
}

// ---------- Gesamten Text in positionierte Papier-Striche umbrechen ----------
export function layoutHandwriting(rawText, profile, opts = {}) {
    const prof = profile || blankProfile();
    const paper = ['karo', 'liniert', 'blanko'].includes(opts.paper || prof.paper) ? (opts.paper || prof.paper) : 'karo';
    const inkColor = resolveInkHex(opts.ink, prof.inkColor || '#1b3b8b');
    const width = clamp(+opts.width || 720, 320, 1400);
    const text = cleanHandwritingText(rawText);

    const grid = 22;
    const lineGap = paper === 'karo' ? grid * 2 : 40; // 44 bei Karo (2 Kästchen), 40 bei Liniert/Blanko
    const charSize = paper === 'karo' ? 40 : 38;       // Glyphen-Boxgröße in Zeichen-Einheiten
    const marginX = paper === 'liniert' ? 68 : 28;
    const rightPad = 24;
    const maxW = Math.max(180, width - marginX - rightPad);
    const spacingMul = clamp(+prof.letterSpacing || 1, 0.7, 1.5);
    const strokeW = clamp((+prof.strokeScale || 1) * 2.15, 1.1, 4.2);
    const slantRad = (clamp(+prof.slantDeg || 0, -14, 18) * Math.PI) / 180;

    // 1. Wortumbruch in logische Zeilen
    const wrappedLines = [];
    for (const para of text.split('\n')) {
        if (!para.trim()) { wrappedLines.push(''); continue; }
        const leading = (para.match(/^\s+/) || [''])[0];
        let line = leading;
        let lineW = [...leading].reduce((acc, c) => acc + measureCharWidth(c, prof, charSize, spacingMul), 0);
        const words = para.trim().split(/(\s+)/);
        for (const tok of words) {
            if (!tok) continue;
            if (/^\s+$/.test(tok)) {
                const sw = measureCharWidth(' ', prof, charSize, spacingMul) * Math.min(tok.length, 3);
                if (lineW + sw <= maxW) { line += ' '.repeat(Math.min(tok.length, 3)); lineW += sw; }
                continue;
            }
            const ww = [...tok].reduce((acc, c) => acc + measureCharWidth(c, prof, charSize, spacingMul), 0);
            if (line.trim() && lineW + ww > maxW) {
                wrappedLines.push(line.trimEnd());
                line = tok;
                lineW = ww;
            } else {
                line += tok;
                lineW += ww;
            }
        }
        if (line || !wrappedLines.length) wrappedLines.push(line.trimEnd());
    }

    // 2. Striche jeder Zeile auf Grundlinien setzen
    const firstBase = paper === 'karo' ? grid * 2 : 58;
    const strokes = [];
    let usedTrained = 0, usedFallback = 0;

    wrappedLines.forEach((line, li) => {
        if (!line) return;
        const baseY = firstBase + li * lineGap;
        let curX = marginX;
        const chars = [...line];
        chars.forEach((ch, ci) => {
            if (ch === ' ') { curX += measureCharWidth(' ', prof, charSize, spacingMul); return; }
            const g = resolveCharGlyph(ch, prof);
            if (!g || !g.bounds) { curX += measureCharWidth(' ', prof, charSize, spacingMul); return; }
            if (g.isTrained) usedTrained++; else usedFallback++;

            const scale = charSize / 100;
            const b = g.bounds;
            const leftBearing = /[.,:;!|'"]/.test(ch) ? 2.5 : 4;
            const adv = measureCharWidth(ch, prof, charSize, spacingMul);

            // Dezente natürliche Schreibschwankung pro Buchstabe
            const jy = (jitterHash(li, ci, 1) - 0.5) * 1.4;
            const jx = (jitterHash(li, ci, 2) - 0.5) * 0.9;
            const rot = (jitterHash(li, ci, 3) - 0.5) * 0.042;
            const cR = Math.cos(rot), sR = Math.sin(rot);
            const midX = (b.minX + b.maxX) / 2;

            for (const st of g.strokes) {
                const flat = [];
                for (const [gx, gy, gp] of st) {
                    const lx = (gx - b.minX + leftBearing);
                    const ly = (gy - GUIDES.baseline);
                    // leichte Rotation um Grundlinie + individueller Neigungswinkel
                    const rx = (lx - (midX - b.minX)) * cR - ly * sR + (midX - b.minX) - ly * Math.tan(slantRad);
                    const ry = (lx - (midX - b.minX)) * sR + ly * cR;
                    flat.push(
                        curX + rx * scale + jx,
                        baseY + ry * scale + jy,
                        gp
                    );
                }
                if (flat.length >= 3) strokes.push({ points: flat, w: strokeW });
            }
            curX += adv;
        });
    });

    const totalLines = Math.max(paper === 'karo' ? 6 : 5, wrappedLines.length);
    const height = Math.max(paper === 'karo' ? grid * 10 : 220, firstBase + totalLines * lineGap + 18);

    return {
        width,
        height,
        paper,
        grid,
        lineGap,
        firstBase,
        marginX,
        inkColor,
        penStyle: prof.penStyle || 'fueller',
        profileName: prof.name,
        usedTrained,
        usedFallback,
        lineCount: wrappedLines.length,
        strokes
    };
}

// ---------- Parser & Systemprompt für <handwriting> im Chat ----------
export function parseHandwriting(body, attrs = {}) {
    return {
        title: str(attrs.title || '', 120),
        paper: ['karo', 'liniert', 'blanko'].includes((attrs.paper || '').toLowerCase()) ? attrs.paper.toLowerCase() : '',
        ink: str(attrs.ink || '', 30),
        profile: str(attrs.profile || '', 40),
        text: String(body || '').trim()
    };
}

export function handwritingPrompt(hw) {
    const norm = normalizeHandwriting(hw);
    const act = activeProfile(norm);
    const count = trainedCount(act);
    const allMeta = norm.profiles.map(p => `„${p.name}“ (${trainedCount(p)} Zeichen)`).join(', ');
    if (count > 0) {
        const sample = Object.keys(act.glyphs).slice(0, 40).join('');
        return `## HANDSCHRIFT DES NUTZERS (trainiert – im Chat direkt nutzen)
Aktive Handschrift: „${act.name}“ (${count} trainierte Zeichen: ${sample}${count > 40 ? ' …' : ''}; bevorzugtes Papier: ${act.paper}).${norm.profiles.length > 1 ? ` Alle verfügbaren Handschriften: ${allMeta}.` : ''}
WICHTIG: Wenn der Nutzer dich bittet, eine Aufgabe, Rechnung, Lösung, Zusammenfassung oder einen Text **in seiner Handschrift** (oder einer der trainierten Handschriften) zu schreiben bzw. zu lösen, gib die handschriftliche Lösung direkt im Chat in einem \`<handwriting title="…" paper="${act.paper}">…\`-Block aus. Schreibe darin klare, saubere Zeilen wie in einem Schulheft (Unicode wie \`x²\`, \`√(…)\`, \`·\`, \`±\`, \`→\`, \`=\`, KEIN \`$\`-LaTeX und KEIN \`**\`-Markdown). Danach höchstens 1 kurzer Satz.`;
    }
    return `## HANDSCHRIFT IM CHAT (<handwriting>)
Der Nutzer hat noch keine eigene Handschrift trainiert (Profil „${act.name}“ hat noch 0 Zeichen). Wenn er trotzdem um eine Lösung oder einen Text „in meiner Handschrift“ bittet, gib die Lösung in \`<handwriting title="…" paper="karo">…\` aus (Coden zeigt sie in Vorschau-Handschrift und bietet direkt auf der Karte einen Knopf „Meine Handschrift trainieren“, um seine echte Schrift anzulernen).`;
}
