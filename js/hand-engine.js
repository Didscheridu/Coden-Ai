// js/hand-engine.js – Handschrift-Engine wie der Skill „meine-handschrift“ (ohne DOM, testbar).
// Echte Stiftstriche (Mittellinien) mit mehreren Varianten je Zeichen, Auswahl ohne Wiederholung,
// sanfte Formvariation, konturbasiertes Kerning, ganze gelernte Wörter, feste Höhen auf dem
// GoodNotes-Karo (kleine Buchstaben = 1 Kästchen, Großbuchstaben/Ziffern = 1,5 Kästchen) und
// GoodNotes-Stifte (Fineliner, Kugelschreiber, Füller, Pinsel) samt Textmarker.
//
// Profil-Format „coden-hand“ v2 (Koordinaten in 1/100 x-Höhe, y nach oben, Grundlinie = 0):
//   { format: 'coden-hand', v: 2, name, style: { ink, sw, gap, wgap, extra, wobble, tilt, axis },
//     g: { 'a': [[w, y0, y1, [[x,y,x,y,…], …]], …] }, w: { 'und': [[…]] } }

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const TAU = Math.PI * 2;
export const HAND_FORMAT = 'coden-hand';

// ---------- Zufall (deterministisch je Seed, damit die Karte beim Neuzeichnen nicht flackert) ----------
export function makeRng(seed = 1) {
    let a = (Math.floor(seed * 2654435761) ^ 0x9e3779b9) >>> 0;
    const next = () => {
        a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    next.u = (amp) => (next() * 2 - 1) * amp;
    next.range = (lo, hi) => lo + next() * (hi - lo);
    next.gauss = (sd) => {
        const u = Math.max(1e-9, next()), v = next();
        return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v) * sd;
    };
    return next;
}

// ---------- Profil prüfen (Import, Server, Speicher) ----------
const STYLE_DEFAULT = { ink: '#1b1f2a', sw: 0.095, gap: 0.06, wgap: 1.05, extra: 0.12, wobble: 0.09, tilt: 0.5, axis: 0.72 };
const LIMITS = { chars: 400, variants: 16, words: 300, strokes: 24, points: 160000 };

function cleanVariant(raw, budget) {
    if (!Array.isArray(raw) || raw.length < 4) return null;
    const w = +raw[0], y0 = +raw[1], y1 = +raw[2];
    if (![w, y0, y1].every(Number.isFinite) || w <= 0 || w > 6000 || y1 <= y0) return null;
    const strokes = [];
    for (const s of (Array.isArray(raw[3]) ? raw[3] : []).slice(0, LIMITS.strokes)) {
        if (!Array.isArray(s) || s.length < 2) continue;
        const n = s.length - (s.length % 2);
        const flat = [];
        for (let i = 0; i < n; i++) {
            const v = Math.round(+s[i]);
            if (!Number.isFinite(v) || Math.abs(v) > 8000) { flat.length = 0; break; }
            flat.push(v);
        }
        if (flat.length >= 2) { strokes.push(flat); budget.n += flat.length / 2; }
    }
    if (!strokes.length || budget.n > LIMITS.points) return null;
    return [Math.round(w), Math.round(y0), Math.round(y1), strokes];
}

export function normalizeRich(raw) {
    if (!raw || typeof raw !== 'object' || raw.format !== HAND_FORMAT || !raw.g || typeof raw.g !== 'object') return null;
    const budget = { n: 0 };
    const pickMap = (obj, maxKeys, keyOk) => {
        const out = {};
        for (const k of Object.keys(obj || {}).slice(0, maxKeys)) {
            if (!keyOk(k) || !Array.isArray(obj[k])) continue;
            const list = obj[k].slice(0, LIMITS.variants).map(v => cleanVariant(v, budget)).filter(Boolean);
            if (list.length) out[k] = list;
        }
        return out;
    };
    const g = pickMap(raw.g, LIMITS.chars, k => [...k].length === 1);
    if (!Object.keys(g).length) return null;
    const w = pickMap(raw.w, LIMITS.words, k => /^[\p{L}]{2,24}$/u.test(k));
    const st = raw.style && typeof raw.style === 'object' ? raw.style : {};
    const num = (v, d, lo, hi) => (Number.isFinite(+v) ? clamp(+v, lo, hi) : d);
    const style = {
        ink: /^#[0-9a-f]{6}$/i.test(st.ink || '') ? st.ink.toLowerCase() : STYLE_DEFAULT.ink,
        sw: num(st.sw, STYLE_DEFAULT.sw, 0.03, 0.3),
        gap: num(st.gap, STYLE_DEFAULT.gap, -0.2, 0.6),
        wgap: num(st.wgap, STYLE_DEFAULT.wgap, 0.4, 2.5),
        extra: num(st.extra, 0.16, 0, 0.6),
        wobble: num(st.wobble, STYLE_DEFAULT.wobble, 0, 0.4),
        tilt: num(st.tilt, STYLE_DEFAULT.tilt, 0, 2),
        axis: num(st.axis, STYLE_DEFAULT.axis, 0.3, 1.2)
    };
    return {
        format: HAND_FORMAT, v: 2,
        name: String(raw.name || 'Handschrift').trim().slice(0, 40) || 'Handschrift',
        style, g, w
    };
}

export const richGlyphCount = (rich) => Object.keys(rich?.g || {}).length;
export const richVariantCount = (rich) => Object.values(rich?.g || {}).reduce((a, l) => a + l.length, 0);

// ---------- Einfache (im Trainer gezeichnete) Glyphen → Profil mit festen Höhen ----------
// Trainer-Feld: 0..100, Grundlinie y = 72, Mittellinie y = 42 (x-Höhe = 30 Einheiten)
const PAD_BASE = 72, PAD_XH = 30;
const XH_CHARS = 'acemnorsuvwxzıαεικνοστυω';
const DESC_CHARS = 'gjpqyβγζημρφχψ';
const TALL_CHARS = 'bdfhklß';

function targetTop(ch) {
    if (ch === 't') return 1.25;
    if (XH_CHARS.includes(ch) || (DESC_CHARS.includes(ch) && ch !== 'j')) return 1;
    if (TALL_CHARS.includes(ch) || /[A-Z0-9ÄÖÜ]/.test(ch)) return 1.5;
    return null; // i, j, Umlaute, Zeichen: nicht normieren
}

// strokes: [[[x,y,p], …], …] im 0..100-Feld → Variante [w, y0, y1, strokes] in 1/100 x-Höhe
export function variantFromPad(strokes, ch = '', { scale = 1 } = {}) {
    const pts = [];
    for (const s of strokes || []) for (const q of s) pts.push(q);
    if (!pts.length) return null;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [x, y] of pts) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
    // y nach oben, in x-Höhen
    let sc = scale / PAD_XH;
    let top = (PAD_BASE - minY) * sc, bot = (PAD_BASE - maxY) * sc;
    const tgt = targetTop(ch);
    let lift = 0;
    if (tgt && top > 0.2) {
        const f = clamp(tgt / top, 0.82, 1.22); // Höhe angleichen, Form bleibt
        sc *= f; top *= f; bot *= f;
    }
    // auf die Grundlinie setzen (nicht bei Unterlängen und schwebenden Zeichen)
    const floating = /^[-–—=+~^'"`´°*·•„“"]$/.test(ch);
    if (!floating && !DESC_CHARS.includes(ch) && !/[,;]/.test(ch) && Math.abs(bot) < 0.35) lift = -bot;
    const out = [];
    for (const s of strokes) {
        const flat = [];
        for (const [x, y] of s) flat.push(Math.round((x - minX) * sc * 100), Math.round(((PAD_BASE - y) * sc + lift) * 100));
        if (flat.length === 2) flat.push(flat[0] + 4, flat[1] + 2); // Punkt als winziger Strich
        out.push(flat);
    }
    const w = Math.max(8, Math.round((maxX - minX) * sc * 100));
    let y0 = Infinity, y1 = -Infinity;
    for (const s of out) for (let i = 1; i < s.length; i += 2) { y0 = Math.min(y0, s[i]); y1 = Math.max(y1, s[i]); }
    if (y1 - y0 < 4) y1 = y0 + 4;
    return [w, y0, y1, out];
}

// ---------- Vorbereitung: Varianten entpacken, Konturen fürs Kerning ----------
const BAND = 0.05; // Höhenraster der Kontur in x-Höhen
const prepCache = new WeakMap();

function prepVariant(raw, sw) {
    const [w, y0, y1, strokes] = raw;
    const st = strokes.map(s => {
        const a = new Float32Array(s.length);
        for (let i = 0; i < s.length; i++) a[i] = s[i] / 100;
        return a;
    });
    const v = { w: w / 100, y0: y0 / 100, y1: y1 / 100, st };
    const nb = Math.max(1, Math.ceil((v.y1 - v.y0) / BAND) + 1);
    const L = new Float32Array(nb).fill(NaN), R = new Float32Array(nb).fill(NaN);
    const put = (x, y) => {
        const i = clamp(Math.floor((y - v.y0) / BAND), 0, nb - 1);
        if (Number.isNaN(L[i]) || x - sw / 2 < L[i]) L[i] = x - sw / 2;
        if (Number.isNaN(R[i]) || x + sw / 2 > R[i]) R[i] = x + sw / 2;
    };
    for (const a of st) {
        put(a[0], a[1]);
        for (let i = 2; i + 1 < a.length; i += 2) {
            const x0 = a[i - 2], y0_ = a[i - 1], x1 = a[i], y1_ = a[i + 1];
            const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1_ - y0_) / 0.03));
            for (let k = 1; k <= n; k++) put(x0 + (x1 - x0) * k / n, y0_ + (y1_ - y0_) * k / n);
        }
    }
    v.L = L; v.R = R;
    return v;
}

export function prepareRich(rich) {
    if (prepCache.has(rich)) return prepCache.get(rich);
    const sw = rich.style?.sw ?? STYLE_DEFAULT.sw;
    const g = {}, w = {};
    for (const k of Object.keys(rich.g || {})) g[k] = rich.g[k].map(v => prepVariant(v, sw));
    for (const k of Object.keys(rich.w || {})) w[k] = rich.w[k].map(v => prepVariant(v, sw));
    const widths = [];
    for (const c of 'abcdefghijklmnopqrstuvwxyz0123456789') for (const v of g[c] || []) widths.push(v.w);
    widths.sort((a, b) => a - b);
    const prep = { rich, style: { ...STYLE_DEFAULT, ...(rich.style || {}) }, g, w, avgW: widths.length ? widths[widths.length >> 1] : 0.75 };
    // mittlerer Abstand zweier Buchstaben-Konturen (Bezugswert fürs Kerning)
    const letters = [...'enisratdhulcgmobwfkzpv'].filter(c => g[c]);
    const rr = makeRng(7); const vals = [];
    for (let i = 0; i < 260 && letters.length; i++) {
        const A = g[letters[Math.floor(rr() * letters.length)]], B = g[letters[Math.floor(rr() * letters.length)]];
        const s = slack(A[Math.floor(rr() * A.length)], B[Math.floor(rr() * B.length)]);
        if (s != null) vals.push(s);
    }
    prep.meanSlack = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
    prepCache.set(rich, prep);
    return prep;
}

// Freiraum zwischen rechter Kontur von A und linker Kontur von B (in x-Höhen, beide Größe 1)
function slack(A, B) {
    const lo = Math.max(A.y0, B.y0), hi = Math.min(A.y1, B.y1);
    if (hi - lo < 0.15) return null;
    let best = Infinity;
    for (let y = lo + BAND / 2; y < hi; y += BAND) {
        const ra = A.R[clamp(Math.floor((y - A.y0) / BAND), 0, A.R.length - 1)];
        const lb = B.L[clamp(Math.floor((y - B.y0) / BAND), 0, B.L.length - 1)];
        if (Number.isNaN(ra) || Number.isNaN(lb)) continue;
        best = Math.min(best, (A.w - ra) + lb);
    }
    return Number.isFinite(best) ? best : null;
}

// ---------- Zeichen, die auf andere abgebildet werden ----------
// ziel, sx, dy (x-Höhen), Skala
const ALIAS = {
    '−': ['-', 1.15, 0, 1], '–': ['-', 1.5, 0, 1], '—': ['-', 2.1, 0, 1], '‐': ['-', 1, 0, 1], '‑': ['-', 1, 0, 1],
    '’': ["'", 1, 0, 1], '‘': ["'", 1, 0, 1], '´': ["'", 1, 0, 1], '`': ["'", 1, 0, 1], '”': ['“', 1, 0, 1], '»': ['"', 1, 0, 1], '«': ['"', 1, 0, 1],
    '⋅': ['·', 1, 0, 1], '∙': ['·', 1, 0, 1], 'ẞ': ['ß', 1, 0, 1], '∆': ['Δ', 1, 0, 1], 'µ': ['μ', 1, 0, 1], '⩾': ['≥', 1, 0, 1], '⩽': ['≤', 1, 0, 1],
    '⁰': ['0', 1, 0.9, 0.62], '¹': ['1', 1, 0.9, 0.62], '²': ['2', 1, 0.9, 0.62], '³': ['3', 1, 0.9, 0.62], '⁴': ['4', 1, 0.9, 0.62],
    '⁵': ['5', 1, 0.9, 0.62], '⁶': ['6', 1, 0.9, 0.62], '⁷': ['7', 1, 0.9, 0.62], '⁸': ['8', 1, 0.9, 0.62], '⁹': ['9', 1, 0.9, 0.62],
    '⁺': ['+', 1, 0.9, 0.62], '⁻': ['-', 1, 0.75, 0.62], 'ⁿ': ['n', 1, 0.9, 0.62], 'ˣ': ['x', 1, 0.9, 0.62],
    '₀': ['0', 1, -0.35, 0.62], '₁': ['1', 1, -0.35, 0.62], '₂': ['2', 1, -0.35, 0.62], '₃': ['3', 1, -0.35, 0.62], '₄': ['4', 1, -0.35, 0.62],
    '₅': ['5', 1, -0.35, 0.62], '₆': ['6', 1, -0.35, 0.62], '₇': ['7', 1, -0.35, 0.62], '₈': ['8', 1, -0.35, 0.62], '₉': ['9', 1, -0.35, 0.62],
    '₊': ['+', 1, -0.35, 0.62], '₋': ['-', 1, -0.35, 0.62], '×': ['x', 1, 0.08, 0.85], '∗': ['*', 1, 0, 1], '…': ['.', 1, 0, 1]
};
const SYNTH = { '✓': [[0, 0.55, 0.3, 0.15, 1.0, 1.1]], '✔': [[0, 0.55, 0.3, 0.15, 1.0, 1.1]], '✗': [[0, 1.05, 0.8, 0.05], [0, 0.05, 0.8, 1.05]] };

// ---------- Hand: baut Boxen aus Varianten ----------
class Hand {
    constructor(prep, fallback, { seed = 1, jitter = 1, wordLib = 0.35 } = {}) {
        this.p = prep; this.fb = fallback; this.rng = makeRng(seed); this.j = jitter; this.wordLib = wordLib;
        this.queues = new Map(); this.missing = new Set(); this.usedWords = 0; this.usedTrained = 0; this.usedFallback = 0;
    }
    pick(kind, key, list) {
        const id = kind + key;
        let q = this.queues.get(id);
        if (!q) { q = { q: [], last: -1 }; this.queues.set(id, q); }
        if (!q.q.length) {
            q.q = list.map((_, i) => i);
            for (let i = q.q.length - 1; i > 0; i--) { const j = Math.floor(this.rng() * (i + 1)); [q.q[i], q.q[j]] = [q.q[j], q.q[i]]; }
            if (q.q.length > 1 && q.q[0] === q.last) q.q.push(q.q.shift());
        }
        const i = q.q.shift(); q.last = i;
        return list[i];
    }
    find(key) {
        if (this.p.g[key]) return { list: this.p.g[key], own: true };
        if (this.fb?.g[key]) return { list: this.fb.g[key], own: false };
        return null;
    }
    resolve(ch) {
        let f = this.p.g[ch] ? { key: ch } : null;
        if (!f && ALIAS[ch]) { const [t, sx, dy, s] = ALIAS[ch]; if (this.p.g[t] || this.fb?.g[t]) f = { key: t, sx, dy, s }; }
        if (!f && /\p{L}/u.test(ch)) {
            const nfd = ch.normalize('NFD');
            if (nfd.length > 1 && this.p.g[nfd[0]]) f = { key: nfd[0], marks: nfd.slice(1) };
            else if (ch.toLowerCase() !== ch && this.p.g[ch.toLowerCase()]) f = { key: ch.toLowerCase(), s: 1.3 };
            else if (ch.toUpperCase() !== ch && this.p.g[ch.toUpperCase()]) f = { key: ch.toUpperCase(), s: 0.78 };
            else if (nfd.length > 1 && this.fb?.g[nfd[0]]) f = { key: nfd[0], marks: nfd.slice(1) };
        }
        if (!f && this.fb?.g[ch]) f = { key: ch };
        if (!f && this.fb?.g[ch.toLowerCase()]) f = { key: ch.toLowerCase(), s: ch.toLowerCase() !== ch ? 1.3 : 1 };
        if (!f) return null;
        const hit = this.find(f.key);
        return hit ? { ...f, ...hit } : null;
    }
    gap(a, b, k) {
        const st = this.p.style;
        let g = st.gap * k;
        if (',.'.includes(b)) g = g * 0.9 + 0.12 * k;
        else if (';:!?)'.includes(b) || a === '(') g *= 0.55;
        const ops = '+-=<>≤≥≈≠·×÷±→⇒⇔';
        if (ops.includes(a) || ops.includes(b)) g += 0.22 * k;
        if (a === '·' || b === '·') g += 0.15 * k;
        if (a === '|' && ':·+-'.includes(b)) g += 0.3 * k;
        g += st.extra * this.p.avgW * k;
        return g + this.rng.gauss(0.05 * this.j) * k;
    }
    kern(A, B, k) {
        const s = slack(A, B);
        if (s == null) return 0;
        return clamp(-0.8 * (s - this.p.meanSlack) * k, -0.3 * k, 0.25 * k);
    }
    // ein Zeichen → { w, items, v }
    charBox(ch, k, mathTok) {
        const r = this.rng, j = this.j;
        if (ch === '•') { // kräftiger Aufzählungspunkt
            const r = 0.1, cy = 0.5, cx = 0.22, pts = [];
            for (let a = 0; a <= 12; a++) pts.push((cx + Math.cos(a / 12 * TAU) * r * (a % 12 ? 1 : 1)) * k, (cy + Math.sin(a / 12 * TAU) * r) * k);
            return { w: 0.5 * k, items: [{ line: pts }, { line: [(cx - 0.03) * k, cy * k, (cx + 0.03) * k, cy * k] }], v: null };
        }
        if (SYNTH[ch]) {
            const items = SYNTH[ch].map(seg => ({ line: seg.map((v, i) => (i % 2 ? v : v) * k) }));
            return { w: 1.1 * k, items, v: null };
        }
        const spec = this.resolve(ch);
        if (!spec) { this.missing.add(ch); return null; }
        if (spec.own) this.usedTrained++; else this.usedFallback++;
        const v = this.pick(spec.own ? 'g' : 'f', spec.key, spec.list);
        const xs = ch === 'x' && mathTok ? 1.1 : 1;
        const s = k * (spec.s || 1) * xs * (1 + r.u(0.015 * j));
        const sx = (spec.sx || 1) * (1 + r.u(0.05 * j)), sy = 1 + r.u(0.01 * j);
        const dy = (spec.dy || 0) * k + r.gauss(this.p.style.wobble * 0.12 * j) * k;
        const rot = r.u(1.4 * j) * Math.PI / 180;
        const items = [{ v, x: 0, y: dy, s, sx, sy, rot, warp: this.warp(v, 0.7 * j) }];
        const w = v.w * s * sx;
        for (const m of spec.marks || '') {
            const top = v.y1 * s + dy, cx = w / 2, u = 0.18 * k;
            if (m === '̈') items.push({ line: [cx - u, top + 0.3 * k, cx - u + 0.04 * k, top + 0.36 * k] }, { line: [cx + u, top + 0.3 * k, cx + u + 0.04 * k, top + 0.36 * k] });
            else if (m === '́') items.push({ line: [cx - 0.08 * k, top + 0.2 * k, cx + 0.14 * k, top + 0.42 * k] });
            else if (m === '̀') items.push({ line: [cx + 0.08 * k, top + 0.2 * k, cx - 0.14 * k, top + 0.42 * k] });
            else if (m === '̂') items.push({ line: [cx - 0.16 * k, top + 0.2 * k, cx, top + 0.4 * k, cx + 0.16 * k, top + 0.2 * k] });
        }
        return { w, items, v, s };
    }
    warp(v, strength) {
        const r = this.rng;
        return { a: 0.025 * Math.max(v.y1 - v.y0, 0.1) * strength, f1: r.range(0.5, 1.3), f2: r.range(0.5, 1.3), p1: r() * TAU, p2: r() * TAU, lean: r.gauss(0.02 * strength) };
    }
    // ein Wort-Token (ohne Leerzeichen) → { w, items }
    tokenBox(token, k) {
        const items = [];
        let x = 0, prev = null, prevV = null;
        const mathTok = /[0-9=+<>|·×÷≠≤≥]/.test(token) || /^[-(]?x[)²]?$/.test(token);
        const runs = token.match(/\p{L}+|[^\p{L}]+/gu) || [];
        for (const run of runs) {
            const isAlpha = /^\p{L}+$/u.test(run);
            const wl = isAlpha && run.length >= 2 ? this.p.w[run] : null;
            if (wl && this.rng() < this.wordLib) {
                const v = this.pick('w', run, wl);
                const s = k * (1 + this.rng.gauss(0.01));
                const sxw = Math.min(1.1, 1 + this.p.style.extra * this.p.avgW * (run.length - 1) / Math.max(v.w, 1e-6));
                if (prev != null) x += this.gap(prev, run[0], k);
                items.push({ v, x, y: this.rng.gauss(this.p.style.wobble * 0.4 * this.j) * k, s, sx: sxw, sy: 1, rot: this.rng.gauss(0.4) * Math.PI / 180, warp: this.warp(v, 0.3 * this.j) });
                x += v.w * s * sxw; prev = run[run.length - 1]; prevV = null; this.usedWords++; this.usedTrained += run.length;
                continue;
            }
            const chars = [...run];
            chars.forEach((ch, ci) => {
                const b = this.charBox(ch, k, mathTok);
                if (!b) { x += 0.4 * k; return; }
                if (prev != null) {
                    x += this.gap(prev, ch, k);
                    if (prevV && b.v) x += this.kern(prevV, b.v, k);
                }
                let hy = 0;
                // Bindestrich im Wort (UV-Strahlung) sitzt tiefer als ein Minus in Rechnungen
                if ('-‐‑'.includes(ch) && (/\p{L}/u.test(chars[ci - 1] || '') || /\p{L}/u.test(chars[ci + 1] || '') || /\p{L}/u.test(token[token.indexOf(run) - 1] || ''))) {
                    hy = -(this.p.style.axis - 0.55) * k;
                }
                for (const it of b.items) {
                    if (it.line) items.push({ line: it.line.map((val, i) => (i % 2 ? val + hy : val + x)) });
                    else items.push({ ...it, x: it.x + x, y: it.y + hy });
                }
                x += b.w; prev = ch; prevV = b.v;
            });
        }
        return { w: x, items };
    }
}

// ---------- Text vorbereiten: LaTeX-/Markdown-Reste, Markierungen behalten ----------
const HL = { gelb: '#ffed4d', yellow: '#ffed4d', gruen: '#8fe678', grün: '#8fe678', green: '#8fe678', blau: '#80ccff', blue: '#80ccff', pink: '#ff99d1', rot: '#ff99d1', rosa: '#ff99d1', orange: '#ffb85c', lila: '#c7a3fa', violett: '#c7a3fa' };
export const MARKER_COLORS = HL;

export function prepareText(raw) {
    let s = String(raw || '').replace(/\r\n?/g, '\n');
    s = s.replace(/\{\{\s*[a-zäöü]+\s*:([\s\S]*?)\}\}/gi, '$1');
    s = s.replace(/\\frac\s*\{([^}]+)\}\s*\{([^}]+)\}/g, '($1)/($2)');
    s = s.replace(/\\sqrt\s*\{([^}]+)\}/g, '√($1)');
    s = s.replace(/\\(cdot|times)/g, '·');
    s = s.replace(/\\(pm|approx|neq|leq|le|geq|ge|to|rightarrow|leftarrow|Rightarrow|pi|alpha|beta|Delta|infty|degree)/g, (_, k) => ({
        pm: '±', approx: '≈', neq: '≠', leq: '≤', le: '≤', geq: '≥', ge: '≥', to: '→', rightarrow: '→', leftarrow: '←', Rightarrow: '⇒',
        pi: 'π', alpha: 'α', beta: 'β', Delta: 'Δ', infty: '∞', degree: '°'
    }[k] || k));
    const SUP = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹', '-': '⁻', '+': '⁺', n: 'ⁿ', x: 'ˣ' };
    s = s.replace(/\^\{([0-9+\-nx]{1,4})\}/g, (_, d) => [...d].map(c => SUP[c] || c).join(''));
    s = s.replace(/\^([0-9+\-])/g, (_, d) => SUP[d] || '^' + d);
    const SUB = { 0: '₀', 1: '₁', 2: '₂', 3: '₃', 4: '₄', 5: '₅', 6: '₆', 7: '₇', 8: '₈', 9: '₉' };
    s = s.replace(/_\{?([0-9])\}?/g, (_, d) => SUB[d]);
    s = s.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/(?<![\w*])\*([^*\n]+)\*(?![\w*])/g, '$1');
    s = s.replace(/\$+/g, '').replace(/\t/g, '    ').replace(/\\([{}])/g, '$1');
    return s.replace(/^\n+|\s+$/g, '');
}

// Zeile → Zeichen mit Marker-Farbe: ==Text== oder ==grün: Text==
function inlineMarks(line) {
    const out = [];
    const re = /==\s*(?:([a-zäöü]+)\s*:\s*)?([^=]+?)==/gi;
    let last = 0, m;
    while ((m = re.exec(line))) {
        for (const ch of line.slice(last, m.index)) out.push({ ch, hl: null });
        const col = HL[(m[1] || 'gelb').toLowerCase()] || (m[1] ? null : HL.gelb);
        const body = col || !m[1] ? m[2] : m[0].slice(2, -2);
        for (const ch of body) out.push({ ch, hl: col || HL.gelb });
        last = m.index + m[0].length;
    }
    for (const ch of line.slice(last)) out.push({ ch, hl: null });
    return out;
}

function tokensOf(chars) {
    const toks = []; let cur = null;
    for (const c of chars) {
        if (c.ch === ' ') { if (cur) { toks.push(cur); cur = null; } continue; }
        if (!cur) cur = { text: '', hl: c.hl };
        cur.text += c.ch; if (c.hl) cur.hl = c.hl;
    }
    if (cur) toks.push(cur);
    return toks;
}

const isTableRow = (l) => /^\s*\|.*\|\s*$/.test(l);
const isSepRow = (l) => /^\s*\|?(\s*:?-{2,}:?\s*\|)+\s*:?-*:?\s*\|?\s*$/.test(l);
const isMathLine = (l) => {
    const letters = (l.match(/\p{L}/gu) || []).length, sym = (l.match(/[0-9=+\-·×÷<>≤≥≈²³√|]/g) || []).length;
    return sym >= 2 && letters <= sym * 1.2;
};

// ---------- Layout: Text → Striche in Pixeln ----------
export function layoutRich(rawText, rich, opts = {}) {
    const prep = prepareRich(rich);
    const fallback = opts.fallback ? prepareRich(opts.fallback) : null;
    const paper = ['karo', 'liniert', 'blanko', 'punkte'].includes(opts.paper) ? opts.paper : 'karo';
    const width = clamp(+opts.width || 720, opts.fit ? 10 : 240, 2400);
    const grid = clamp(+opts.grid || 20, 8, 60);
    const text = prepareText(rawText);
    const lines = text.split('\n');
    const mathe = opts.mathe === true || (opts.mathe !== false && lines.filter(l => l.trim()).length >= 2 && lines.filter(l => l.trim()).every(l => isMathLine(l) || /^(aufgabe|a\)|b\)|c\)|d\))/i.test(l.trim())));
    let pitch, k;
    const fit = opts.fit && +opts.fit.k > 0 ? opts.fit : null; // fester Kasten (z. B. Lücke auf dem Arbeitsblatt)
    if (fit) { k = +fit.k; pitch = +fit.pitch || k * 2.3; }
    else if (paper === 'liniert') { pitch = Math.round(grid * 1.8); k = Math.min(grid, 0.74 * pitch / 1.5); }
    else if (mathe) { pitch = grid * 2; k = grid * 0.73; }
    else { pitch = grid * 3; k = grid; }
    if (!fit) k *= clamp(+opts.size || 1, 0.5, 1.6);
    const hand = new Hand(prep, fallback, { seed: opts.seed ?? 1, jitter: opts.jitter ?? 1, wordLib: opts.wordLib ?? (Object.keys(prep.w).length ? 0.35 : 0) });
    const rng = hand.rng;
    const xLeft = fit ? 0 : paper === 'liniert' ? grid * 3.5 : grid;
    const xRight = fit ? width : width - grid * 0.8;
    const firstBase = fit ? (+fit.firstBase || 1.5 * k) : paper === 'liniert' ? pitch * 2 : Math.ceil(0.35 + 0.55 * pitch / grid - 1e-6) * grid;
    const swPx = prep.style.sw * k * clamp(+opts.weight || 1, 0.5, 1.8);
    const placed = [], lineItems = [], marks = [];
    let base = firstBase - pitch; let lineCount = 0;

    const drift = () => {
        const tilt = rng.gauss(prep.style.tilt * 0.6 * 0.35) * Math.PI / 180;
        const amp = prep.style.wobble * k * 1.1 * 0.25;
        const p1 = rng() * TAU, p2 = rng() * TAU, l1 = rng.range(4.4, 8.1) * grid, l2 = rng.range(1.6, 2.8) * grid;
        return (x) => Math.tan(tilt) * x + amp * (0.65 * Math.sin(TAU * x / l1 + p1) + 0.35 * Math.sin(TAU * x / l2 + p2));
    };
    const emit = (box, ox, by, d, x0) => {
        for (const it of box.items) {
            if (it.line) {
                const pts = [];
                for (let i = 0; i < it.line.length; i += 2) { const X = ox + it.line[i]; pts.push(X, by - it.line[i + 1] + d(X - x0)); }
                lineItems.push({ pts, w: swPx });
            } else {
                const X = ox + it.x;
                placed.push({ ...it, x: X, base: by + d(X - x0) });
            }
        }
    };
    const newLine = (slots = 1) => { base += pitch * slots; lineCount++; return base; };

    // Absatz mit Umbruch; align: left|center; Rückgabe: Liste der Zeilen-Spannen
    const paragraph = (chars, { indent = 0, align = 'left', size = 1, hlAll = null, maxW = xRight - xLeft, left = xLeft, at = null, step = pitch } = {}) => {
        const kk = k * size;
        const toks = tokensOf(chars).map(t => ({ ...t, hl: t.hl || hlAll, box: hand.tokenBox(t.text, kk) }));
        const spaceW = () => prep.style.wgap * kk * (1 + rng.u(0.08));
        const rows = []; let row = [], rw = 0;
        for (const t of toks) {
            const add = (row.length ? spaceW() : 0);
            if (row.length && rw + add + t.box.w > maxW - indent) { rows.push(row); row = []; rw = 0; }
            t.gapBefore = row.length ? add : 0;
            row.push(t); rw += t.gapBefore + t.box.w;
        }
        if (row.length || !rows.length) rows.push(row);
        const spans = [];
        rows.forEach((r, ri) => {
            const by = at != null ? at + ri * step : newLine();
            const total = r.reduce((a, t) => a + t.gapBefore + t.box.w, 0);
            let x = left + (ri === 0 ? indent : indent) + (align === 'center' ? Math.max(0, (maxW - indent - total) / 2) : 0);
            const x0 = x; const d = drift();
            let hlStart = null, hlColor = null;
            const flushHl = (xe) => { if (hlStart != null) marks.push({ x0: hlStart - 0.12 * kk, x1: xe + 0.12 * kk, y0: by - 1.12 * kk, y1: by + 0.3 * kk, color: hlColor, d, ox: x0 }); hlStart = null; };
            for (const t of r) {
                x += t.gapBefore;
                if (t.hl && hlStart == null) { hlStart = x; hlColor = t.hl; }
                else if (!t.hl) flushHl(x - t.gapBefore);
                emit(t.box, x, by, d, x0);
                x += t.box.w;
            }
            flushHl(x);
            spans.push({ x0, x1: x, by, d });
        });
        return spans;
    };

    for (let i = 0; i < lines.length; i++) {
        const raw = lines[i];
        if (!raw.trim()) { if (lineCount) newLine(); else base += 0; continue; }
        if (isTableRow(raw)) {
            const rows = [];
            let header = false;
            while (i < lines.length && (isTableRow(lines[i]) || isSepRow(lines[i]))) {
                if (isSepRow(lines[i])) { if (rows.length === 1) header = true; }
                else rows.push(lines[i].trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim()));
                i++;
            }
            i--;
            table(rows, header);
            continue;
        }
        const head = raw.match(/^\s*(#{1,3})\s+(.*)$/);
        if (head) {
            const lvl = head[1].length;
            const spans = paragraph(inlineMarks(head[2].replace(/==/g, '')), lvl === 1 ? { align: 'center', hlAll: HL.gelb } : {});
            if (lvl === 2) for (const sp of spans) lineItems.push({ pts: [sp.x0, sp.by + 0.32 * k, sp.x1, sp.by + 0.32 * k], w: swPx, straight: true });
            continue;
        }
        if (/^\s*(-{3,}|_{3,}|\*{3,})\s*$/.test(raw)) {
            const by = newLine();
            lineItems.push({ pts: [xLeft, by - 0.5 * k, xRight, by - 0.5 * k], w: swPx, straight: true });
            continue;
        }
        const lead = (raw.match(/^\s*/) || [''])[0].length;
        let body = raw.slice(lead);
        let indent = Math.min(lead, 12) * 0.35 * k;
        const bullet = body.match(/^([-*•])\s+/);
        if (bullet) body = '• ' + body.slice(bullet[0].length);
        paragraph(inlineMarks(body), { indent });
    }

    function table(rows, header) {
        const nCol = Math.max(...rows.map(r => r.length));
        const avail = xRight - xLeft;
        let kk = k;
        const measure = (kv) => rows.map(r => Array.from({ length: nCol }, (_, c) => {
            const toks = tokensOf(inlineMarks(r[c] || ''));
            const words = toks.map(t => hand.tokenBox(t.text, kv).w);
            return { words, sum: words.reduce((a, b) => a + b, 0) + Math.max(0, words.length - 1) * prep.style.wgap * kv, longest: Math.max(0, ...words) };
        }));
        let m = measure(kk);
        const pad = 0.45 * k;
        let longest = Array.from({ length: nCol }, (_, c) => Math.max(...m.map(r => r[c].longest)) + 2 * pad);
        if (longest.reduce((a, b) => a + b, 0) > avail) { kk = k * clamp(avail / longest.reduce((a, b) => a + b, 0), 0.55, 1); m = measure(kk); longest = longest.map(v => v * kk / k); }
        const natural = Array.from({ length: nCol }, (_, c) => Math.max(...m.map(r => r[c].sum)) + 2 * pad);
        let widths = natural.slice();
        const tot = widths.reduce((a, b) => a + b, 0);
        if (tot > avail) {
            const extra = avail - longest.reduce((a, b) => a + b, 0);
            const want = natural.map((n, c) => n - longest[c]);
            const wsum = want.reduce((a, b) => a + b, 0) || 1;
            widths = longest.map((l, c) => l + Math.max(0, extra) * want[c] / wsum);
        }
        const snap = (v) => (paper === 'karo' ? Math.round(v / grid) * grid : v);
        const colX = [xLeft];
        widths.forEach((w, c) => { const up = paper === 'karo' ? Math.ceil((colX[c] + w) / grid) * grid : colX[c] + w; colX.push(c < nCol - 1 && up <= xRight - widths.slice(c + 1).reduce((a, b) => a + b, 0) ? up : colX[c] + w); });
        const cellStep = Math.min(pitch, Math.max(grid * 2, Math.ceil(2.4 * kk / grid) * grid));
        const yTop = base + pitch - 1.7 * kk;
        let yb = yTop;
        rows.forEach((r, ri) => {
            const startBase = newLine();
            let maxRows = 1;
            for (let c = 0; c < nCol; c++) {
                const spans = paragraph(inlineMarks(r[c] || ''), { left: colX[c] + pad, maxW: colX[c + 1] - colX[c] - 2 * pad, size: kk / k, at: startBase, step: cellStep });
                maxRows = Math.max(maxRows, spans.length);
            }
            base = startBase + (maxRows - 1) * cellStep;
            yb = snap(base + Math.min(1.0 * k, pitch - 1.7 * kk));
            if ((header && ri === 0) || ri === rows.length - 1) lineItems.push({ pts: [xLeft - 0.4 * k, yb, colX[nCol] + 0.3 * k, yb], w: swPx, straight: true });
        });
        for (let c = 1; c < nCol; c++) lineItems.push({ pts: [colX[c], yTop - 0.15 * k, colX[c], yb + 0.5 * k], w: swPx, straight: true });
    }

    // Glyphen → Pixel-Striche
    const strokes = [];
    for (const it of placed) {
        const v = it.v, wp = it.warp, h = Math.max(v.y1 - v.y0, 1e-3), cx = v.w / 2;
        const c = Math.cos(it.rot), s = Math.sin(it.rot);
        for (const a of v.st) {
            const p = [];
            for (let i = 0; i + 1 < a.length; i += 2) {
                const gx = a[i], gy = a[i + 1];
                const yn = (gy - v.y0) / h;
                const x2 = gx + wp.a * Math.sin(TAU * wp.f1 * yn + wp.p1) + wp.lean * (gy - v.y0);
                const y2 = gy + 0.7 * wp.a * Math.sin(TAU * wp.f2 * gx / Math.max(v.w, 1e-3) + wp.p2);
                const X = (x2 - cx) * it.s * it.sx, Y = y2 * it.s * it.sy;
                const rx = X * c - Y * s, ry = X * s + Y * c;
                p.push(it.x + cx * it.s * it.sx + rx, it.base - it.y - ry, 0.5);
            }
            if (p.length === 3) p.push(p[0] + 0.3, p[1], 0.5);
            strokes.push({ p, w: swPx });
        }
    }
    for (const li of lineItems) {
        const p = [];
        for (let i = 0; i < li.pts.length; i += 2) p.push(li.pts[i], li.pts[i + 1], 0.5);
        strokes.push({ p, w: li.w, straight: !!li.straight });
    }
    const height = fit ? base + 0.8 * k : Math.max(opts.minHeight || 0, Math.ceil((base + pitch * 0.9) / grid) * grid + grid, grid * 6);
    return {
        width, height, grid, pitch, k, paper, mathe, firstBase, maxX: strokes.reduce((m, s) => { for (let i = 0; i < s.p.length; i += 3) if (s.p[i] > m) m = s.p[i]; return m; }, 0),
        strokes, marks, lineCount,
        usedTrained: hand.usedTrained, usedFallback: hand.usedFallback, usedWords: hand.usedWords,
        missing: [...hand.missing]
    };
}

// ---------- Zeichnen wie GoodNotes ----------
export const PENS = [
    { id: 'fineliner', name: 'Fineliner', f: 1 },
    { id: 'kugel', name: 'Kugelschreiber', f: 0.78 },
    { id: 'fueller', name: 'Füller', f: 1.05 },
    { id: 'pinsel', name: 'Pinsel', f: 1.6 }
];
export const penFactor = (pen) => (PENS.find(p => p.id === pen) || PENS[0]).f;

// Catmull-Rom → dichte Punktliste (wie ein geglätteter Stiftstrich)
export function smoothPoints(p, step = 1.2) {
    const n = p.length / 3;
    const P = (i) => { const j = clamp(i, 0, n - 1) * 3; return [p[j], p[j + 1]]; };
    if (n < 3) { const out = []; for (let i = 0; i < n; i++) out.push(P(i)); return out; }
    const out = [P(0)];
    for (let i = 0; i < n - 1; i++) {
        const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
        const segs = Math.max(1, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / step));
        for (let t = 1; t <= segs; t++) {
            const u = t / segs, u2 = u * u, u3 = u2 * u;
            out.push([
                0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * u + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * u2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * u3),
                0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * u + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * u2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * u3)
            ]);
        }
    }
    return out;
}

// Umriss mit wechselnder Breite (Füller: schräge Feder, Pinsel: an- und abschwellend)
function ribbon(pts, width, pen) {
    const n = pts.length;
    if (n < 2) return null;
    const dist = [0];
    for (let i = 1; i < n; i++) dist.push(dist[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const L = dist[n - 1] || 1;
    const nib = -0.75; // Federwinkel (≈ 43°)
    const L1 = [], R1 = [];
    for (let i = 0; i < n; i++) {
        const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
        let dx = b[0] - a[0], dy = b[1] - a[1]; const len = Math.hypot(dx, dy) || 1; dx /= len; dy /= len;
        let w;
        if (pen === 'fueller') w = width * (0.5 + 0.85 * Math.abs(Math.sin(Math.atan2(dy, dx) - nib)));
        else {
            const t = dist[i] / L, ramp = Math.min(1, dist[i] / Math.min(L * 0.35, width * 4)), out = Math.min(1, (L - dist[i]) / Math.min(L * 0.45, width * 5));
            w = width * (0.35 + 0.65 * Math.min(ramp, out)) * (0.92 + 0.08 * Math.sin(t * Math.PI));
        }
        const r = Math.max(0.3, w / 2);
        L1.push([pts[i][0] - dy * r, pts[i][1] + dx * r]);
        R1.push([pts[i][0] + dy * r, pts[i][1] - dx * r]);
    }
    return [...L1, ...R1.reverse()];
}

// strokes: [{ p:[x,y,pr,…], w, c? }] in Layout-Pixeln; scale = Canvas-Pixel je Layout-Pixel
export function drawInk(ctx, strokes, { color = '#1b1f2a', pen = 'fineliner', scale = 1 } = {}) {
    const f = penFactor(pen);
    ctx.save();
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const s of strokes) {
        const col = s.c || color;
        ctx.strokeStyle = col; ctx.fillStyle = col;
        const pts = s.straight ? [[s.p[0], s.p[1]], [s.p[s.p.length - 3], s.p[s.p.length - 2]]] : smoothPoints(s.p, 1.1);
        const w = (s.w || 2) * f;
        if (!s.straight && (pen === 'fueller' || pen === 'pinsel') && pts.length > 2) {
            const poly = ribbon(pts, w, pen);
            ctx.beginPath();
            poly.forEach(([x, y], i) => (i ? ctx.lineTo(x * scale, y * scale) : ctx.moveTo(x * scale, y * scale)));
            ctx.closePath(); ctx.fill();
            // runde Enden
            const r0 = pen === 'pinsel' ? w * 0.17 : w * 0.3;
            for (const q of [pts[0], pts[pts.length - 1]]) { ctx.beginPath(); ctx.arc(q[0] * scale, q[1] * scale, r0 * scale, 0, TAU); ctx.fill(); }
            continue;
        }
        ctx.lineWidth = Math.max(0.6, w * scale);
        if (pen === 'kugel') ctx.globalAlpha = 0.93;
        ctx.beginPath();
        ctx.moveTo(pts[0][0] * scale, pts[0][1] * scale);
        if (pts.length === 1) ctx.lineTo(pts[0][0] * scale + 0.2, pts[0][1] * scale);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0] * scale, pts[i][1] * scale);
        ctx.stroke();
        ctx.globalAlpha = 1;
    }
    ctx.restore();
}

// GoodNotes-Textmarker: gerader, durchscheinender Balken
export function drawMarks(ctx, marks, scale = 1) {
    if (!marks?.length) return;
    ctx.save();
    ctx.globalAlpha = 0.45;
    try { ctx.globalCompositeOperation = 'multiply'; } catch (_) { /* alte Browser */ }
    for (const m of marks) {
        ctx.fillStyle = m.color;
        const tl = m.d ? m.d(m.x0 - m.ox) : 0, tr = m.d ? m.d(m.x1 - m.ox) : 0;
        ctx.beginPath();
        ctx.moveTo(m.x0 * scale, (m.y0 + tl) * scale); ctx.lineTo(m.x1 * scale, (m.y0 + tr) * scale);
        ctx.lineTo(m.x1 * scale, (m.y1 + tr) * scale); ctx.lineTo(m.x0 * scale, (m.y1 + tl) * scale);
        ctx.closePath(); ctx.fill();
    }
    ctx.restore();
}

export const PAPER_COLORS = { weiss: '#ffffff', creme: '#fbf7ec', gelb: '#fdf6d3', grau: '#f2f2f2', dunkel: '#1f2124' };

// GoodNotes-Papier: Karo hellgrau (#cfd1d2), liniert, Punkte, blanko
export function drawPaper(ctx, { width, height, grid, pitch, firstBase, paper }, { scale = 1, color = 'weiss', px = scale } = {}) {
    const bg = PAPER_COLORS[color] || color || '#ffffff';
    const dark = color === 'dunkel';
    ctx.save();
    ctx.fillStyle = bg; ctx.fillRect(0, 0, width * scale, height * scale);
    const line = Math.max(0.5, 0.55 * px); // px = Bildschirm-Pixeldichte (Linien bleiben haarfein)
    if (paper === 'karo') {
        ctx.strokeStyle = dark ? '#3a3d42' : '#d3d5d6'; ctx.lineWidth = line;
        ctx.beginPath();
        for (let x = grid; x < width; x += grid) { const X = Math.round(x * scale) + 0.5; ctx.moveTo(X, 0); ctx.lineTo(X, height * scale); }
        for (let y = grid; y < height; y += grid) { const Y = Math.round(y * scale) + 0.5; ctx.moveTo(0, Y); ctx.lineTo(width * scale, Y); }
        ctx.stroke();
    } else if (paper === 'liniert') {
        ctx.strokeStyle = dark ? '#36506e' : '#a9c6ec'; ctx.lineWidth = line;
        ctx.beginPath();
        for (let y = firstBase - Math.floor(firstBase / pitch) * pitch; y < height - 4; y += pitch) { if (y < pitch * 0.9) continue; const Y = Math.round(y * scale) + 0.5; ctx.moveTo(0, Y); ctx.lineTo(width * scale, Y); }
        ctx.stroke();
        ctx.strokeStyle = '#ec8c94'; ctx.lineWidth = Math.max(0.8, 0.8 * px);
        ctx.beginPath(); ctx.moveTo(grid * 2.8 * scale, 0); ctx.lineTo(grid * 2.8 * scale, height * scale); ctx.stroke();
    } else if (paper === 'punkte') {
        ctx.fillStyle = dark ? '#555' : '#b9bfc8';
        for (let y = grid; y < height; y += grid) for (let x = grid; x < width; x += grid) { ctx.beginPath(); ctx.arc(x * scale, y * scale, 0.9 * px, 0, TAU); ctx.fill(); }
    }
    ctx.restore();
}

// Alles auf einmal: Papier, Marker, Tinte
export function paintLayout(ctx, layout, { scale = 1, color, pen, paperColor } = {}) {
    drawPaper(ctx, layout, { scale, color: paperColor });
    drawMarks(ctx, layout.marks, scale);
    drawInk(ctx, layout.strokes, { color, pen, scale });
}
