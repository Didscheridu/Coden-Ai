// js/formula-helper.js – Formelsammlung (Mathe, Physik, Chemie), Einheiten-Umrechner & sicherer Formel-Rechner (ohne DOM, testbar).

export const FORMULA_SUBJECTS = [
    { id: 'alle', label: 'Alle' },
    { id: 'mathe', label: 'Mathe' },
    { id: 'physik', label: 'Physik' },
    { id: 'chemie', label: 'Chemie' }
];

export const FORMULAS = [
    // --- Mathe ---
    { id: 'm_pyth', subject: 'mathe', title: 'Satz des Pythagoras', formula: 'a² + b² = c²', writeText: 'a² + b² = c²', vars: 'c = Hypotenuse; a, b = Katheten', hint: 'Nur im rechtwinkligen Dreieck' },
    { id: 'm_pq', subject: 'mathe', title: 'p-q-Formel', formula: 'x₁,₂ = -p/2 ± √((p/2)² - q)', writeText: 'x₁,₂ = -p/2 ± √((p/2)² - q)', vars: 'für x² + px + q = 0', hint: 'Normierte quadratische Gleichung' },
    { id: 'm_abc', subject: 'mathe', title: 'Mitternachtsformel (abc)', formula: 'x₁,₂ = (-b ± √(b² - 4ac)) / (2a)', writeText: 'x₁,₂ = (-b ± √(b² - 4ac)) / (2a)', vars: 'für ax² + bx + c = 0', hint: 'Diskriminante D = b² - 4ac' },
    { id: 'm_bin1', subject: 'mathe', title: '1. & 2. Binomische Formel', formula: '(a ± b)² = a² ± 2ab + b²', writeText: '(a + b)² = a² + 2ab + b²\n(a - b)² = a² - 2ab + b²', vars: 'a, b = Terme', hint: 'Zum Ausmultiplizieren & Faktorisieren' },
    { id: 'm_bin3', subject: 'mathe', title: '3. Binomische Formel', formula: '(a + b) · (a - b) = a² - b²', writeText: '(a + b)·(a - b) = a² - b²', vars: 'a, b = Terme', hint: 'Differenz zweier Quadrate' },
    { id: 'm_lin', subject: 'mathe', title: 'Lineare Funktion & Steigung', formula: 'y = m · x + b   |   m = (y₂ - y₁) / (x₂ - x₁)', writeText: 'y = m·x + b\nm = (y₂ - y₁) / (x₂ - x₁)', vars: 'm = Steigung, b = y-Achsenabschnitt', hint: 'Steigungsdreieck zwischen 2 Punkten' },
    { id: 'm_par', subject: 'mathe', title: 'Scheitelpunktform (Parabel)', formula: 'f(x) = a · (x - d)² + e', writeText: 'f(x) = a·(x - d)² + e\nScheitelpunkt S(d | e)', vars: 'a = Streckfaktor, S(d|e) = Scheitel', hint: 'Vorzeichen bei d umdrehen!' },
    { id: 'm_kreis', subject: 'mathe', title: 'Kreis: Umfang & Fläche', formula: 'U = 2 · π · r   |   A = π · r²', writeText: 'U = 2 · π · r\nA = π · r²', vars: 'r = Radius (d = 2r)', hint: 'π ≈ 3,14159' },
    { id: 'm_dreieck', subject: 'mathe', title: 'Dreieck & Trapez Fläche', formula: 'A_Δ = ½ · g · h   |   A_Tr = ½ · (a + c) · h', writeText: 'A_Dreieck = 1/2 · g · h\nA_Trapez = (a + c)/2 · h', vars: 'g = Grundseite, h = Höhe', hint: 'h steht senkrecht auf g' },
    { id: 'm_vol', subject: 'mathe', title: 'Zylinder, Kegel & Kugel', formula: 'V_Zyl = π · r² · h  |  V_Keg = ⅓ · π · r² · h  |  V_Kug = 4/3 · π · r³', writeText: 'V_Zylinder = π · r² · h\nV_Kegel = 1/3 · π · r² · h\nV_Kugel = 4/3 · π · r³', vars: 'r = Radius, h = Höhe', hint: 'Spitzkörper immer mit 1/3' },
    { id: 'm_trig', subject: 'mathe', title: 'Sinus, Kosinus, Tangens', formula: 'sin(α) = G/H   |   cos(α) = A/H   |   tan(α) = G/A', writeText: 'sin(α) = Gegenkathete / Hypotenuse\ncos(α) = Ankathete / Hypotenuse\ntan(α) = Gegenkathete / Ankathete', vars: 'G = Gegen-, A = Ankathete, H = Hypotenuse', hint: 'Taschenrechner auf DEG stellen' },
    { id: 'm_proz', subject: 'mathe', title: 'Prozent- & Zinsrechnung', formula: 'W = G · p / 100   |   Z = K · p / 100 · (t / 360)', writeText: 'W = G · p%\nZ = K · p% · (t / 360)', vars: 'W = Prozentwert, G = Grundwert, p = Zinssatz', hint: 'p% = p / 100' },

    // --- Physik ---
    { id: 'p_v', subject: 'physik', title: 'Geschwindigkeit', formula: 'v = s / t', writeText: 'v = s / t', vars: 's = Weg (m), t = Zeit (s), v in m/s', hint: 'm/s · 3,6 = km/h' },
    { id: 'p_a', subject: 'physik', title: 'Beschleunigung & Fall', formula: 'a = Δv / Δt   |   s = ½ · a · t²', writeText: 'a = Δv / Δt\ns = 1/2 · a · t²', vars: 'a in m/s², g ≈ 9,81 m/s²', hint: 'Freier Fall aus Ruhe: v = g · t' },
    { id: 'p_f', subject: 'physik', title: 'Kraft & Gewichtskraft', formula: 'F = m · a   |   F_G = m · g', writeText: 'F = m · a\nF_G = m · g (g ≈ 9,81 N/kg)', vars: 'F in Newton (N), m in kg', hint: '1 N = 1 kg·m/s²' },
    { id: 'p_rho', subject: 'physik', title: 'Dichte', formula: 'ρ = m / V', writeText: 'ρ = m / V', vars: 'm = Masse, V = Volumen', hint: 'Wasser: ρ ≈ 1 g/cm³ = 1000 kg/m³' },
    { id: 'p_druck', subject: 'physik', title: 'Druck', formula: 'p = F / A', writeText: 'p = F / A', vars: 'F = Kraft (N), A = Fläche (m²)', hint: '1 Pa = 1 N/m² · 1 bar = 10⁵ Pa' },
    { id: 'p_arbeit', subject: 'physik', title: 'Arbeit & Leistung', formula: 'W = F · s   |   P = W / t', writeText: 'W = F · s\nP = W / t', vars: 'W in Joule (J), P in Watt (W)', hint: '1 W = 1 J/s' },
    { id: 'p_e', subject: 'physik', title: 'Mechanische Energie', formula: 'E_kin = ½ · m · v²   |   E_pot = m · g · h', writeText: 'E_kin = 1/2 · m · v²\nE_pot = m · g · h', vars: 'm in kg, v in m/s, h in m', hint: 'Energieerhaltung: E_ges = konstant' },
    { id: 'p_ohm', subject: 'physik', title: 'Ohmsches Gesetz & el. Leistung', formula: 'U = R · I   |   P = U · I   |   E = P · t', writeText: 'U = R · I\nP = U · I\nE = U · I · t', vars: 'U in Volt (V), I in Ampere (A), R in Ohm (Ω)', hint: 'Reihenschaltung: I gleich · Parallel: U gleich' },
    { id: 'p_q', subject: 'physik', title: 'Wärmeenergie', formula: 'Q = c · m · ΔT', writeText: 'Q = c · m · ΔT', vars: 'c = spez. Wärmekapazität, ΔT = Temp.-Änderung', hint: 'Wasser: c ≈ 4,19 kJ/(kg·K)' },

    // --- Chemie ---
    { id: 'c_mol', subject: 'chemie', title: 'Stoffmenge (Mol)', formula: 'n = m / M', writeText: 'n = m / M', vars: 'n in mol, m = Masse (g), M = Molmasse (g/mol)', hint: 'Avogadro: N_A ≈ 6,022 · 10²³ 1/mol' },
    { id: 'c_konz', subject: 'chemie', title: 'Stoffmengenkonzentration', formula: 'c = n / V', writeText: 'c = n / V', vars: 'c in mol/l, n in mol, V in l', hint: 'Oft auch in eckigen Klammern [X]' },
    { id: 'c_verd', subject: 'chemie', title: 'Verdünnungsregel', formula: 'c₁ · V₁ = c₂ · V₂', writeText: 'c₁ · V₁ = c₂ · V₂', vars: '1 = Stammlösung, 2 = verdünnte Lösung', hint: 'Stoffmenge n bleibt beim Verdünnen gleich' },
    { id: 'c_ph', subject: 'chemie', title: 'pH-Wert', formula: 'pH = -log₁₀(c(H₃O⁺))   |   pH + pOH = 14', writeText: 'pH = -lg(c(H₃O⁺))\npH + pOH = 14', vars: 'c in mol/l (bei 25 °C)', hint: 'pH < 7 sauer · pH = 7 neutral · pH > 7 basisch' },
    { id: 'c_gas', subject: 'chemie', title: 'Ideales Gasgesetz', formula: 'p · V = n · R · T', writeText: 'p · V = n · R · T', vars: 'R ≈ 8,314 J/(mol·K), T in Kelvin (K = °C + 273,15)', hint: 'Normvolumen: V_m ≈ 22,4 l/mol (0 °C, 1013 hPa)' }
];

export function filterFormulas(query = '', subject = 'alle') {
    const q = String(query || '').trim().toLowerCase();
    return FORMULAS.filter(f => {
        if (subject && subject !== 'alle' && f.subject !== subject) return false;
        if (!q) return true;
        return (f.title + ' ' + f.formula + ' ' + f.vars + ' ' + f.hint).toLowerCase().includes(q);
    });
}

// ---------- Einheiten-Umrechner ----------
export const UNIT_CATEGORIES = [
    {
        id: 'laenge', label: 'Länge', base: 'm',
        units: [
            { id: 'mm', label: 'mm', factor: 0.001 },
            { id: 'cm', label: 'cm', factor: 0.01 },
            { id: 'dm', label: 'dm', factor: 0.1 },
            { id: 'm', label: 'm', factor: 1 },
            { id: 'km', label: 'km', factor: 1000 }
        ]
    },
    {
        id: 'flaeche', label: 'Fläche', base: 'm²',
        units: [
            { id: 'mm2', label: 'mm²', factor: 1e-6 },
            { id: 'cm2', label: 'cm²', factor: 1e-4 },
            { id: 'dm2', label: 'dm²', factor: 0.01 },
            { id: 'm2', label: 'm²', factor: 1 },
            { id: 'a', label: 'a', factor: 100 },
            { id: 'ha', label: 'ha', factor: 10000 },
            { id: 'km2', label: 'km²', factor: 1e6 }
        ]
    },
    {
        id: 'volumen', label: 'Volumen', base: 'l',
        units: [
            { id: 'ml', label: 'ml (cm³)', factor: 0.001 },
            { id: 'l', label: 'l (dm³)', factor: 1 },
            { id: 'm3', label: 'm³', factor: 1000 }
        ]
    },
    {
        id: 'masse', label: 'Masse', base: 'kg',
        units: [
            { id: 'mg', label: 'mg', factor: 1e-6 },
            { id: 'g', label: 'g', factor: 0.001 },
            { id: 'kg', label: 'kg', factor: 1 },
            { id: 't', label: 't', factor: 1000 }
        ]
    },
    {
        id: 'zeit', label: 'Zeit', base: 's',
        units: [
            { id: 'ms', label: 'ms', factor: 0.001 },
            { id: 's', label: 's', factor: 1 },
            { id: 'min', label: 'min', factor: 60 },
            { id: 'h', label: 'h', factor: 3600 },
            { id: 'd', label: 'Tage', factor: 86400 }
        ]
    },
    {
        id: 'geschwindigkeit', label: 'Geschwindigkeit', base: 'm/s',
        units: [
            { id: 'ms', label: 'm/s', factor: 1 },
            { id: 'kmh', label: 'km/h', factor: 1 / 3.6 },
            { id: 'mph', label: 'mph', factor: 0.44704 }
        ]
    },
    {
        id: 'temperatur', label: 'Temperatur', special: true,
        units: [
            { id: 'C', label: '°C' },
            { id: 'K', label: 'K' },
            { id: 'F', label: '°F' }
        ]
    },
    {
        id: 'energie', label: 'Energie', base: 'J',
        units: [
            { id: 'J', label: 'J', factor: 1 },
            { id: 'kJ', label: 'kJ', factor: 1000 },
            { id: 'Wh', label: 'Wh', factor: 3600 },
            { id: 'kWh', label: 'kWh', factor: 3600000 },
            { id: 'kcal', label: 'kcal', factor: 4184 }
        ]
    },
    {
        id: 'druck', label: 'Druck', base: 'Pa',
        units: [
            { id: 'Pa', label: 'Pa', factor: 1 },
            { id: 'hPa', label: 'hPa', factor: 100 },
            { id: 'kPa', label: 'kPa', factor: 1000 },
            { id: 'bar', label: 'bar', factor: 100000 }
        ]
    },
    {
        id: 'daten', label: 'Daten', base: 'B',
        units: [
            { id: 'B', label: 'Byte', factor: 1 },
            { id: 'KB', label: 'KB (1024)', factor: 1024 },
            { id: 'MB', label: 'MB', factor: 1048576 },
            { id: 'GB', label: 'GB', factor: 1073741824 },
            { id: 'TB', label: 'TB', factor: 1099511627776 }
        ]
    }
];

export function formatNumberDe(n) {
    if (!Number.isFinite(n)) return '–';
    const abs = Math.abs(n);
    if (abs === 0) return '0';
    if (abs >= 1e9 || (abs > 0 && abs < 1e-6)) return n.toExponential(4).replace('.', ',');
    const rounded = Math.round(n * 1e6) / 1e6;
    return rounded.toLocaleString('de-DE', { maximumFractionDigits: 6 });
}

export function convertUnit(rawVal, catId, fromId, toId) {
    const num = typeof rawVal === 'number' ? rawVal : parseFloat(String(rawVal || '').replace(',', '.'));
    if (!Number.isFinite(num)) return { ok: false, value: NaN, formatted: '–' };
    const cat = UNIT_CATEGORIES.find(c => c.id === catId);
    if (!cat) return { ok: false, value: NaN, formatted: '–' };
    if (cat.id === 'temperatur') {
        let celsius = num;
        if (fromId === 'K') celsius = num - 273.15;
        else if (fromId === 'F') celsius = (num - 32) * 5 / 9;
        let out = celsius;
        if (toId === 'K') out = celsius + 273.15;
        else if (toId === 'F') out = celsius * 9 / 5 + 32;
        return { ok: true, value: out, formatted: formatNumberDe(out) };
    }
    const uFrom = cat.units.find(u => u.id === fromId);
    const uTo = cat.units.find(u => u.id === toId);
    if (!uFrom || !uTo) return { ok: false, value: NaN, formatted: '–' };
    const out = (num * uFrom.factor) / uTo.factor;
    return { ok: true, value: out, formatted: formatNumberDe(out) };
}

// ---------- Sicherer mathematischer Ausdrucks-Parser (kein eval, keine Code-Ausführung) ----------
const MATH_FUNCS = {
    sqrt: (x) => (x < 0 ? NaN : Math.sqrt(x)),
    wurzel: (x) => (x < 0 ? NaN : Math.sqrt(x)),
    abs: (x) => Math.abs(x),
    sin: (x) => Math.sin(x * Math.PI / 180),
    cos: (x) => Math.cos(x * Math.PI / 180),
    tan: (x) => Math.tan(x * Math.PI / 180),
    log: (x) => Math.log10(x),
    lg: (x) => Math.log10(x),
    ln: (x) => Math.log(x),
    round: (x) => Math.round(x)
};
const MATH_CONSTS = { pi: Math.PI, π: Math.PI, e: Math.E };

function tokenizeMath(input) {
    const s = String(input || '')
        .replace(/,/g, '.')
        .replace(/[·×]/g, '*')
        .replace(/[÷:]/g, '/')
        .replace(/[−–]/g, '-')
        .replace(/²/g, '^2')
        .replace(/³/g, '^3')
        .replace(/√\s*\(/g, 'sqrt(')
        .replace(/√\s*([0-9.]+)/g, 'sqrt($1)');

    const tokens = [];
    let i = 0;
    while (i < s.length) {
        const ch = s[i];
        if (/\s/.test(ch)) { i++; continue; }
        if (/[0-9.]/.test(ch)) {
            let num = '';
            while (i < s.length && /[0-9.]/.test(s[i])) num += s[i++];
            const v = Number(num);
            if (!Number.isFinite(v)) throw new Error('Ungültige Zahl');
            tokens.push({ t: 'num', v });
            continue;
        }
        if (/[a-zA-Zπ]/.test(ch)) {
            let id = '';
            while (i < s.length && /[a-zA-Z0-9π]/.test(s[i])) id += s[i++];
            tokens.push({ t: 'id', v: id.toLowerCase() });
            continue;
        }
        if ('+-*/^%()'.includes(ch)) {
            tokens.push({ t: 'op', v: ch });
            i++;
            continue;
        }
        throw new Error(`Unbekanntes Zeichen „${ch}“`);
    }
    return tokens;
}

export function evaluateMathExpr(expr) {
    const raw = String(expr || '').trim();
    if (!raw) return { ok: false, error: 'Ausdruck eingeben' };
    if (raw.length > 200) return { ok: false, error: 'Ausdruck zu lang' };
    try {
        const tokens = tokenizeMath(raw);
        let pos = 0;
        const peek = () => tokens[pos];
        const next = () => tokens[pos++];

        const parseExpr = () => {
            let left = parseTerm();
            while (peek()?.t === 'op' && (peek().v === '+' || peek().v === '-')) {
                const op = next().v;
                const right = parseTerm();
                left = op === '+' ? left + right : left - right;
            }
            return left;
        };

        const parseTerm = () => {
            let left = parsePower();
            while (peek()?.t === 'op' && (peek().v === '*' || peek().v === '/' || peek().v === '%')) {
                const op = next().v;
                const right = parsePower();
                if (op === '*') left *= right;
                else if (op === '/') { if (right === 0) throw new Error('Division durch 0'); left /= right; }
                else left %= right;
            }
            return left;
        };

        const parsePower = () => {
            const base = parseUnary();
            if (peek()?.t === 'op' && peek().v === '^') {
                next();
                return Math.pow(base, parsePower());
            }
            return base;
        };

        const parseUnary = () => {
            if (peek()?.t === 'op' && peek().v === '-') { next(); return -parseUnary(); }
            if (peek()?.t === 'op' && peek().v === '+') { next(); return parseUnary(); }
            return parsePrimary();
        };

        const parsePrimary = () => {
            const tok = peek();
            if (!tok) throw new Error('Unvollständiger Ausdruck');
            if (tok.t === 'num') { next(); return tok.v; }
            if (tok.t === 'op' && tok.v === '(') {
                next();
                const val = parseExpr();
                if (peek()?.t !== 'op' || peek()?.v !== ')') throw new Error('Klammer fehlt');
                next();
                return val;
            }
            if (tok.t === 'id') {
                next();
                if (tok.v in MATH_CONSTS) return MATH_CONSTS[tok.v];
                if (tok.v in MATH_FUNCS) {
                    if (peek()?.t !== 'op' || peek()?.v !== '(') throw new Error(`${tok.v}(…) erwartet`);
                    next();
                    const arg = parseExpr();
                    if (peek()?.t !== 'op' || peek()?.v !== ')') throw new Error('Klammer fehlt');
                    next();
                    return MATH_FUNCS[tok.v](arg);
                }
                throw new Error(`Unbekannt: ${tok.v}`);
            }
            throw new Error('Syntaxfehler');
        };

        const val = parseExpr();
        if (pos < tokens.length) throw new Error('Unerwartetes Zeichen');
        if (!Number.isFinite(val)) throw new Error('Nicht definiert');
        return { ok: true, value: val, formatted: formatNumberDe(val) };
    } catch (e) {
        return { ok: false, error: e.message || 'Fehler' };
    }
}
