// server/sandbox.js – Sichere Verifikations-Sandbox für Mathe-Rechnungen, Gleichungen und kurze JS-Code-Tests.
// Läuft ohne eval() auf Host-Globals: Mathe nutzt einen eigenen rekursiven Parser,
// JavaScript-Tests laufen in einem stark eingeschränkten Node-vm-Kontext mit Timeout.
const vm = require('vm');

const MAX_EXPR_LEN = 300;
const MAX_CODE_LEN = 4000;
const VM_TIMEOUT_MS = 350;

const MATH_FNS = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  sqrt: Math.sqrt,
  wurzel: Math.sqrt,
  abs: Math.abs,
  betrag: Math.abs,
  ln: Math.log,
  log: Math.log10,
  lg: Math.log10,
  log2: Math.log2,
  exp: Math.exp,
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  sign: Math.sign,
  pow: Math.pow,
  min: Math.min,
  max: Math.max
};

function factorial(n) {
  if (!Number.isInteger(n) || n < 0 || n > 170) throw new Error('Fakultät nur für 0..170');
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
}

function normalizeMath(src) {
  return String(src || '')
    .replace(/\u202f|\u00a0/g, ' ')
    .replace(/[·⋅×]/g, '*')
    .replace(/[÷]/g, '/')
    .replace(/(?<=\d)\s*:\s*(?=\d)/g, '/')
    .replace(/[−–—]/g, '-')
    .replace(/²/g, '^2')
    .replace(/³/g, '^3')
    .replace(/√\s*\(/g, 'sqrt(')
    .replace(/√\s*(\d+(?:[.,]\d+)?)/g, 'sqrt($1)')
    .replace(/π/g, 'pi')
    .replace(/(\d)\.(\d{3})(?!\d)/g, '$1$2') // 1.000 -> 1000
    .replace(/(\d),(\d)/g, '$1.$2')
    .replace(/\\cdot|\\times/g, '*')
    .replace(/\\div/g, '/')
    .replace(/\\frac\s*\{([^{}]+)\}\s*\{([^{}]+)\}/g, '(($1)/($2))')
    .replace(/\\(sqrt|sin|cos|tan|ln|log|pi|exp)/g, '$1')
    .replace(/[{}]/g, c => (c === '{' ? '(' : ')'))
    .replace(/\|([^|]+)\|/g, 'abs($1)')
    .replace(/\$/g, '')
    .trim();
}

function evalMathExpression(raw) {
  const s = normalizeMath(raw);
  if (!s) return { ok: false, error: 'Leerer Ausdruck' };
  if (s.length > MAX_EXPR_LEN) return { ok: false, error: 'Ausdruck zu lang' };
  // Keine freien Variablen (z. B. x, y) – nur reine Zahlenrechnung
  const tok = [];
  const re = /\s*(\d+\.?\d*|\.\d+|[a-zA-Z_][a-zA-Z0-9_]*|[-+*/%^()!,])/y;
  let pos = 0;
  while (pos < s.length) {
    re.lastIndex = pos;
    const m = re.exec(s);
    if (!m) {
      if (/^\s*$/.test(s.slice(pos))) break;
      return { ok: false, error: `Unerlaubtes Zeichen: ${s[pos]}` };
    }
    pos = re.lastIndex;
    const t = m[1];
    tok.push(/^[a-zA-Z_]/.test(t) ? t.toLowerCase() : t);
  }
  if (!tok.length) return { ok: false, error: 'Kein Rechenausdruck' };

  let i = 0;
  const peek = () => tok[i];
  const eat = (t) => { if (tok[i] !== t) throw new Error(`Erwartet ${t}`); i++; };
  const startsAtom = (t) => t != null && (t === '(' || /^[\d.]/.test(t) || /^[a-z_]/.test(t));

  function parseExpr() {
    let left = parseTerm();
    while (peek() === '+' || peek() === '-') {
      const op = tok[i++];
      const right = parseTerm();
      left = op === '+' ? left + right : left - right;
    }
    return left;
  }

  function parseTerm() {
    let left = parseUnary();
    for (;;) {
      const t = peek();
      if (t === '*' || t === '/' || t === '%') {
        i++;
        const right = parseUnary();
        if (t === '*') left *= right;
        else if (t === '/') {
          if (right === 0) throw new Error('Division durch 0');
          left /= right;
        } else {
          if (right === 0) throw new Error('Modulo durch 0');
          left %= right;
        }
      } else if (startsAtom(t)) {
        left *= parsePower();
      } else {
        return left;
      }
    }
  }

  function parseUnary() {
    if (peek() === '-') { i++; return -parseUnary(); }
    if (peek() === '+') { i++; return parseUnary(); }
    return parsePower();
  }

  function parsePower() {
    let base = parsePostfix();
    if (peek() === '^') {
      i++;
      const exp = parseUnary();
      base = Math.pow(base, exp);
    }
    return base;
  }

  function parsePostfix() {
    let val = parsePrimary();
    while (peek() === '!' || peek() === '%') {
      const op = tok[i++];
      val = op === '!' ? factorial(val) : val / 100;
    }
    return val;
  }

  function parsePrimary() {
    const t = tok[i++];
    if (t == null) throw new Error('Formel unvollständig');
    if (t === '(') {
      const v = parseExpr();
      eat(')');
      return v;
    }
    if (/^[\d.]/.test(t)) return parseFloat(t);
    if (t === 'pi') return Math.PI;
    if (t === 'e') return Math.E;
    if (MATH_FNS[t]) {
      const fn = MATH_FNS[t];
      if (peek() === '(') {
        i++;
        const args = [parseExpr()];
        while (peek() === ',') { i++; args.push(parseExpr()); }
        eat(')');
        return fn(...args);
      }
      return fn(parsePower());
    }
    throw new Error(`Unbekannte Größe: ${t}`);
  }

  try {
    const val = parseExpr();
    if (i < tok.length) throw new Error(`Unerwartet: ${tok[i]}`);
    if (!Number.isFinite(val)) return { ok: false, error: 'Ergebnis ist nicht endlich' };
    const clean = Math.abs(val) < 1e-12 ? 0 : Number(val.toPrecision(12));
    return { ok: true, value: clean };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function verifyEquation(rawEq) {
  const s = String(rawEq || '').trim();
  const parts = s.split(/(?<![<>!=])=(?!=)/).map(x => x.trim()).filter(Boolean);
  if (parts.length < 2) {
    const res = evalMathExpression(s);
    return { expr: s, ...res };
  }
  const lhs = evalMathExpression(parts[0]);
  const rhs = evalMathExpression(parts[parts.length - 1]);
  if (!lhs.ok || !rhs.ok) {
    return { expr: s, ok: false, lhs: lhs.value, rhs: rhs.value, error: lhs.error || rhs.error };
  }
  const scale = Math.max(1, Math.abs(lhs.value), Math.abs(rhs.value));
  const match = Math.abs(lhs.value - rhs.value) <= 1e-6 * scale;
  return {
    expr: s,
    ok: true,
    value: lhs.value,
    expected: rhs.value,
    match
  };
}

function verifyJsSnippet(code, { syntaxOnly = false } = {}) {
  const src = String(code || '').trim();
  if (!src) return { ok: false, syntaxOk: false, ran: false, error: 'Leerer Codeblock', logs: [] };
  if (src.length > MAX_CODE_LEN) return { ok: false, syntaxOk: false, ran: false, error: 'Codeblock für Sandbox zu groß', logs: [] };

  // Gefährliche Host-, Prototyp- oder Browser-APIs für Ausführung blockieren (Syntax-Check bleibt sicher)
  const needsBrowserOrIo = /\b(document|window|navigator|localStorage|sessionStorage|fetch|XMLHttpRequest|WebSocket|require|import|export|process|globalThis|eval|Function|constructor|__proto__|Reflect|Proxy)\b/.test(src);

  try {
    // ESM export/import für Syntaxcheck vorsichtig strippen, falls nötig
    const syntaxSrc = src.replace(/^\s*export\s+(default\s+)?/gm, '');
    const script = new vm.Script(syntaxSrc, { filename: 'coden-sandbox.js' });
    if (syntaxOnly || needsBrowserOrIo) {
      return { ok: true, syntaxOk: true, ran: false, skippedRunReason: needsBrowserOrIo ? 'Browser-/Modul-Code (nur Syntax geprüft)' : 'Nur Syntax', logs: [] };
    }

    const logs = [];
    const pushLog = (kind, args) => {
      if (logs.length >= 60) return;
      const line = args.map(a => {
        if (typeof a === 'string') return a;
        try { return JSON.stringify(a); } catch (_) { return String(a); }
      }).join(' ');
      const total = logs.reduce((n, x) => n + x.length, 0);
      if (total < 3500) logs.push((kind === 'log' ? '' : `[${kind}] `) + line.slice(0, 600));
    };

    const sandboxObj = Object.create(null);
    Object.assign(sandboxObj, {
      Math,
      Number,
      String,
      Boolean,
      Array,
      Object,
      JSON,
      Map,
      Set,
      Date,
      RegExp,
      parseInt,
      parseFloat,
      isNaN,
      isFinite,
      Infinity,
      NaN,
      undefined,
      console: Object.freeze({
        log: (...a) => pushLog('log', a),
        info: (...a) => pushLog('log', a),
        warn: (...a) => pushLog('warn', a),
        error: (...a) => pushLog('error', a),
        assert: (cond, ...a) => { if (!cond) pushLog('assert-fail', a.length ? a : ['Assertion failed']); }
      })
    });

    const ctx = vm.createContext(sandboxObj, { codeGeneration: { strings: false, wasm: false } });
    const t0 = Date.now();
    const result = script.runInContext(ctx, { timeout: VM_TIMEOUT_MS, displayErrors: true });
    const durationMs = Date.now() - t0;
    let outVal;
    if (result !== undefined) {
      try { outVal = JSON.stringify(result); } catch (_) { outVal = String(result); }
    }
    return { ok: true, syntaxOk: true, ran: true, logs, result: outVal ? String(outVal).slice(0, 600) : undefined, durationMs };
  } catch (e) {
    return { ok: false, syntaxOk: false, ran: false, logs: [], error: String(e.message || e).slice(0, 300) };
  }
}

function extractVerifiableItems(text) {
  const raw = String(text || '');
  const codeBlocks = [];
  const noCode = raw.replace(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g, (_, lang, body) => {
    const l = String(lang || '').toLowerCase();
    if ((l === 'js' || l === 'javascript') && body.trim().length >= 8 && body.trim().length <= MAX_CODE_LEN) {
      if (codeBlocks.length < 2) codeBlocks.push({ language: 'javascript', code: body.trim() });
    }
    return '\n';
  });

  const equations = [];
  const seen = new Set();
  for (const line of noCode.split('\n')) {
    const clean = line.replace(/==([a-zA-ZäöüßÄÖÜ]+:)?([^=]+)==/g, '$2').replace(/[*_`]/g, '').trim();
    if (!clean || clean.length > 160) continue;
    // Reine Zahlen-Gleichungen wie "3 * 14 + 8 = 50" oder "√(144) = 12"
    const m = clean.match(/([0-9(√][0-9+\-*/^%.,()·×÷:\s√πe²³!]{1,80}=\s*-?[0-9.,]+(?:\s|$))/);
    if (m) {
      const candidate = m[1].trim();
      if (/[+\-*/^%√·×÷:²³!]/.test(candidate) && !/[a-zA-Z]{4,}/.test(candidate) && !seen.has(candidate)) {
        seen.add(candidate);
        equations.push(candidate);
        if (equations.length >= 6) break;
      }
    }
  }
  return { equations, codeBlocks };
}

function verifyBatch({ expressions = [], equations = [], codeBlocks = [] } = {}) {
  const mathResults = [];
  for (const ex of (Array.isArray(expressions) ? expressions : []).slice(0, 8)) {
    if (typeof ex === 'string' && ex.trim()) mathResults.push({ expr: ex.trim(), ...evalMathExpression(ex) });
  }
  for (const eq of (Array.isArray(equations) ? equations : []).slice(0, 8)) {
    if (typeof eq === 'string' && eq.trim()) mathResults.push(verifyEquation(eq));
  }
  const codeResults = (Array.isArray(codeBlocks) ? codeBlocks : []).slice(0, 3).map((b) => {
    const code = typeof b === 'string' ? b : b?.code;
    const syntaxOnly = !!(typeof b === 'object' && b?.syntaxOnly);
    return verifyJsSnippet(code, { syntaxOnly });
  });

  const discrepancies = [];
  for (const m of mathResults) {
    if (m.match === false) discrepancies.push(`Rechenabweichung bei „${m.expr}“: rechnerisch ${m.value}, angegeben ${m.expected}`);
  }
  for (const c of codeResults) {
    if (!c.ok) discrepancies.push(`Code-Problem: ${c.error}`);
  }

  return {
    ok: discrepancies.length === 0,
    discrepancies,
    mathResults,
    codeResults
  };
}

module.exports = {
  evalMathExpression,
  verifyEquation,
  verifyJsSnippet,
  extractVerifiableItems,
  verifyBatch,
  MAX_EXPR_LEN,
  MAX_CODE_LEN
};
