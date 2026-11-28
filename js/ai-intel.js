// js/ai-intel.js – Intelligenter Auto-Router, chat-übergreifendes Gedächtnis,
// Lernprofil, Schwachstellen-Analyse, Tutor-Modus, Fakten-Unsicherheit & Selbstprüfungs-Logik.

const STOPWORDS = new Set([
  'der', 'die', 'das', 'den', 'dem', 'des', 'ein', 'eine', 'einen', 'einem', 'einer',
  'und', 'oder', 'aber', 'doch', 'weil', 'dass', 'wenn', 'dann', 'als', 'wie', 'was',
  'wer', 'wo', 'wann', 'warum', 'wieso', 'mit', 'ohne', 'für', 'von', 'zu', 'zur', 'zum',
  'in', 'im', 'an', 'am', 'auf', 'aus', 'bei', 'nach', 'über', 'unter', 'vor', 'zwischen',
  'ist', 'sind', 'war', 'waren', 'bin', 'bist', 'sein', 'haben', 'hat', 'hatte', 'kann',
  'kannst', 'können', 'muss', 'müssen', 'soll', 'sollen', 'will', 'wollen', 'ich', 'du',
  'er', 'sie', 'es', 'wir', 'ihr', 'mein', 'meine', 'dein', 'deine', 'mir', 'mich', 'dir',
  'dich', 'sich', 'nicht', 'kein', 'keine', 'auch', 'noch', 'schon', 'nur', 'sehr', 'mehr',
  'bitte', 'mal', 'eben', 'halt', 'the', 'and', 'for', 'with', 'that', 'this', 'from', 'what'
]);

const GREETING_RE = /^(hi|hallo|hey|moin|servus|guten\s+(morgen|tag|abend)|danke|ok|okay|alles\s+klar|super|cool|ja|nein|tschüss|bye)[!?. ]*$/i;
const COMPLEX_CODE_RE = /\b(baue?|erstell\w*|programmier\w*|architektur|refactor|multi.?file|full.?stack|react|three\.?js|webgl|shader|spiel|game|canvas|api|express|datenbank|sql|firebase|oauth|websocket|algorithm\w*|komplex|debug\w*|fehler\s+im\s+code)\b/i;
const REASONING_MATH_RE = /\b(rechne|berechne|gleichung|integral|ableit|differential|matrix|vektor|stochastik|wahrscheinlichkeit|beweis|parabel|nullstelle|pq-formel|logarithm|trigonometr|sinus|cosinus|chemie|reaktionsgleichung|physik|kraft|spannung|widerstand|analyse|erörterung|aufsatz|referat|interpret|zusammenfassung|erklär\w*\s+(mir|genau|ausführlich)|vergleiche|unterschied|logik|rätsel|warum)\b/i;
const MATH_EXPR_HINT_RE = /(\d+\s*[+\-*/^=]\s*\d+|√|\$.*\$|\bf\s*\(\s*x\s*\)|x\^2|x²)/;

export function tokenizeText(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 3 && !STOPWORDS.has(w));
}

// ---------- 1. Intelligenter Auto-Router ----------
export function routeModelForPrompt({
  text = '',
  hasImages = false,
  hasAttachments = false,
  isOwner = false,
  lockedModels = {},
  historyCount = 0,
  selectedTier = 'auto'
} = {}) {
  if (selectedTier && selectedTier !== 'auto') {
    return { tier: selectedTier, auto: false, reason: '' };
  }
  const canUse = (tier) => {
    if (isOwner) return true;
    if (tier === 'pro') return !lockedModels?.pro;
    if (tier === 'normal') return !lockedModels?.thinking;
    if (tier === 'ultra') return lockedModels?.ultra === false;
    return true;
  };
  const pickAllowed = (preferred, reason) => {
    if (canUse(preferred)) return { tier: preferred, auto: true, reason };
    if (preferred === 'pro' && canUse('normal')) return { tier: 'normal', auto: true, reason: reason + ' (Ausweichstufe Thinking)' };
    return { tier: 'flash', auto: true, reason: reason + ' (Standardstufe Flash)' };
  };

  const t = String(text || '').trim();
  if (!hasImages && !hasAttachments && (GREETING_RE.test(t) || (t.length <= 70 && !COMPLEX_CODE_RE.test(t) && !REASONING_MATH_RE.test(t) && !MATH_EXPR_HINT_RE.test(t)))) {
    return pickAllowed('flash', 'Schnelle Antwort');
  }
  if (COMPLEX_CODE_RE.test(t) || /```[\s\S]{120,}```/.test(t) || (t.length > 900 && /\b(code|funktion|klasse|modul|html|css|python|script)\b/i.test(t))) {
    return pickAllowed('pro', 'Komplexes Coding oder Projekt');
  }
  if (hasAttachments || hasImages || REASONING_MATH_RE.test(t) || MATH_EXPR_HINT_RE.test(t) || t.length > 220 || historyCount > 12) {
    return pickAllowed('normal', 'Mathe, Logik, Dokument oder tiefere Erklärung');
  }
  return pickAllowed('flash', 'Kurze Wissensfrage');
}

export const TIER_DISPLAY = {
  auto: 'Auto',
  flash: 'Coden Flash',
  normal: 'Coden Thinking',
  pro: 'Coden Pro',
  ultra: 'Coden Ultra'
};

// ---------- 2. Chat-übergreifendes Langzeitgedächtnis ----------
export function searchPastChats(sessions, currentSessionId, query, { maxResults = 3 } = {}) {
  const q = String(query || '').trim();
  if (q.length < 8 || GREETING_RE.test(q)) return [];
  const qTokens = [...new Set(tokenizeText(q))];
  if (!qTokens.length) return [];

  const list = Array.isArray(sessions) ? sessions : [];
  const candidates = list.filter(s => s && !s.temp && s.id !== currentSessionId && Array.isArray(s.messages) && s.messages.length > 0);
  if (!candidates.length) return [];

  // Dokument-Häufigkeit für seltene Wörter stärker gewichten
  const df = new Map();
  const docs = candidates.map((s) => {
    const title = String(s.title || 'Chat');
    const body = s.messages
      .slice(-24)
      .map(m => `${m.isUser ? 'Du' : 'Coden'}: ${String(m.text || '').replace(/<[^>]+>/g, ' ').slice(0, 600)}`)
      .join('\n');
    const docTokens = new Set(tokenizeText(title + ' ' + body));
    for (const tok of docTokens) df.set(tok, (df.get(tok) || 0) + 1);
    return { s, title, body, titleTokens: new Set(tokenizeText(title)), docTokens };
  });

  const N = docs.length;
  const scored = [];
  for (const d of docs) {
    let score = 0;
    let matched = 0;
    for (const tok of qTokens) {
      if (!d.docTokens.has(tok)) continue;
      matched++;
      const idf = Math.log(1 + (N + 1) / ((df.get(tok) || 0) + 0.5));
      score += idf * (d.titleTokens.has(tok) ? 1.8 : 1.0);
    }
    if (matched === 0) continue;
    if (qTokens.length >= 3 && matched < 2 && score < 2.2) continue;
    const ageDays = d.s.updatedAt ? Math.max(0, (Date.now() - Date.parse(d.s.updatedAt)) / 864e5) : 30;
    const recency = 1 / (1 + ageDays / 45);
    const total = score * (0.8 + 0.2 * recency);
    // Passendsten Ausschnitt um einen Treffer herum extrahieren
    const lines = d.body.split('\n').filter(Boolean);
    let bestLine = lines[0] || '';
    let bestHits = -1;
    for (const l of lines) {
      const lt = tokenizeText(l);
      const hits = qTokens.filter(t => lt.includes(t)).length;
      if (hits > bestHits) { bestHits = hits; bestLine = l; }
    }
    scored.push({
      sessionId: d.s.id,
      title: d.title,
      updatedAt: d.s.updatedAt || '',
      snippet: bestLine.slice(0, 320),
      score: total
    });
  }

  return scored.sort((a, b) => b.score - a.score).slice(0, maxResults);
}

export function formatPastChatsPrompt(hits) {
  if (!Array.isArray(hits) || !hits.length) return '';
  const lines = hits.map((h, i) => `${i + 1}. Chat „${h.title}“: ${h.snippet}`);
  return `\nRELEVANTE AUSSCHNITTE AUS FRÜHEREN CHATS (nur nutzen, wenn es zur aktuellen Frage passt – erfinde nichts dazu):\n${lines.join('\n')}\n`;
}

// ---------- 3. Festes Lern- & Antwortprofil ----------
export function normalizeLearningProfile(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const subjectsRaw = Array.isArray(r.subjects)
    ? r.subjects
    : String(r.subjects || '').split(/[,;\n]/);
  const subjects = [...new Set(subjectsRaw.map(x => String(x || '').trim().slice(0, 40)).filter(Boolean))].slice(0, 12);
  const depth = ['einfach', 'ausgewogen', 'tief'].includes(r.depth) ? r.depth : 'ausgewogen';
  return {
    grade: String(r.grade || '').trim().slice(0, 60),
    subjects,
    goal: String(r.goal || '').trim().slice(0, 160),
    depth
  };
}

export function learningProfilePrompt(raw) {
  const p = normalizeLearningProfile(raw);
  if (!p.grade && !p.subjects.length && !p.goal && p.depth === 'ausgewogen') return '';
  const depthText = {
    einfach: 'Erkläre besonders einfach, alltagsnah und mit kleinen Schritten ohne unnötige Fachwörter.',
    ausgewogen: 'Erkläre verständlich auf dem passenden Niveau mit klaren Fachbegriffen und Beispielen.',
    tief: 'Erkläre tiefgehend, präzise und mit fachlicher Herleitung sowie anspruchsvollen Details.'
  }[p.depth];
  const parts = [];
  if (p.grade) parts.push(`Stufe/Klasse: ${p.grade}`);
  if (p.subjects.length) parts.push(`Fächer: ${p.subjects.join(', ')}`);
  if (p.goal) parts.push(`Lernziel: ${p.goal}`);
  parts.push(`Erklärungstiefe: ${depthText}`);
  return `\nLERN- & ANTWORTPROFIL DES NUTZERS (passe Sprachniveau, Beispiele und Schwierigkeit daran an):\n- ${parts.join('\n- ')}\n`;
}

// ---------- 4. Schwachstellen-Tracker aus Quiz & Karteikarten ----------
export function normalizeWeakTopics(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(x => x && typeof x === 'object' && String(x.topic || '').trim())
    .map(x => ({
      topic: String(x.topic).trim().slice(0, 80),
      subject: String(x.subject || '').trim().slice(0, 40),
      misses: Math.max(0, Math.min(99, parseInt(x.misses, 10) || 0)),
      hits: Math.max(0, Math.min(99, parseInt(x.hits, 10) || 0)),
      source: x.source === 'flashcard' ? 'flashcard' : 'quiz',
      lastSeen: String(x.lastSeen || '').slice(0, 32),
      sample: String(x.sample || '').trim().slice(0, 140)
    }))
    .filter(x => x.misses > 0)
    .slice(0, 25);
}

export function recordLearningOutcome(existing, { kind = 'quiz', ok = false, topic = 'Allgemein', subject = '', item = '' } = {}) {
  const list = normalizeWeakTopics(existing);
  const cleanTopic = String(topic || 'Allgemein').replace(/^Quiz:\s*/i, '').trim().slice(0, 80) || 'Allgemein';
  const key = cleanTopic.toLowerCase();
  const idx = list.findIndex(x => x.topic.toLowerCase() === key);
  const now = new Date().toISOString();

  if (ok) {
    if (idx >= 0) {
      const cur = { ...list[idx], hits: list[idx].hits + 1, misses: Math.max(0, list[idx].misses - 1), lastSeen: now };
      if (cur.misses <= 0) list.splice(idx, 1);
      else list[idx] = cur;
    }
    return list;
  }

  if (idx >= 0) {
    list[idx] = {
      ...list[idx],
      misses: Math.min(99, list[idx].misses + 1),
      source: kind === 'flashcard' ? 'flashcard' : list[idx].source,
      ...(subject ? { subject: String(subject).slice(0, 40) } : {}),
      ...(item ? { sample: String(item).trim().slice(0, 140) } : {}),
      lastSeen: now
    };
  } else {
    list.unshift({
      topic: cleanTopic,
      subject: String(subject || '').trim().slice(0, 40),
      misses: 1,
      hits: 0,
      source: kind === 'flashcard' ? 'flashcard' : 'quiz',
      lastSeen: now,
      sample: String(item || '').trim().slice(0, 140)
    });
  }
  return list
    .sort((a, b) => (b.misses - a.misses) || b.lastSeen.localeCompare(a.lastSeen))
    .slice(0, 25);
}

export function weakTopicsPrompt(raw) {
  const list = normalizeWeakTopics(raw).slice(0, 5);
  if (!list.length) return '';
  const rows = list.map(w => `- ${w.topic}${w.subject ? ` (${w.subject})` : ''} · ${w.misses}× unsicher/falsch${w.sample ? ` (z. B. „${w.sample.slice(0, 70)}“)` : ''}`);
  return `\nERKANNTE LERN-SCHWACHSTELLEN (aus früheren Quizzen & Karteikarten – erkläre diese Bereiche bei Bedarf besonders gründlich oder biete gezielte Übung an):\n${rows.join('\n')}\n`;
}

// ---------- 5. Sokratischer Tutor-Modus ----------
export function tutorModePrompt(enabled) {
  if (!enabled) return '';
  return `
TUTOR-MODUS IST AKTIV (WICHTIG):
- Wenn der Nutzer eine Hausaufgabe, Rechen-, Logik- oder Lernaufgabe stellt, verrate NICHT sofort die fertige Komplettlösung.
- Gib zuerst eine kurze freundliche Einordnung, den ERSTEN kleinen Denkanstoß oder eine hilfreiche Zwischenfrage und lass den Nutzer selbst mitdenken.
- Erst wenn der Nutzer ausdrücklich einen eigenen Lösungsversuch schreibt oder um den nächsten Schritt bzw. die Auflösung bittet, prüfst du seinen Ansatz, lobst Richtiges und erklärst den nächsten Schritt.
- Bei reinen Wissensfragen ohne Aufgabe darfst du normal antworten, baust aber am Ende eine kleine Verständnisfrage ein.`;
}

// ---------- 6. Fakten- & Unsicherheits-Kennzeichnung ----------
export function factConfidencePrompt(enabled = true) {
  if (!enabled) return '';
  return `
FAKTEN- & UNSICHERHEITS-KENNZEICHNUNG:
- Bei sachlichen Wissens-, Geschichts-, Naturwissenschafts-, Rechts- oder aktuellen Fragen: trenne erkennbar zwischen gesichertem Wissen und unsicheren Details.
- Wenn alle Kernaussagen sicher sind, reicht am Ende ein knapper Hinweis oder bei Unsicherheiten ein kurzer kompakter Block:
  > [!NOTE] Fakten-Check: Sicher = … · Unsicher / bitte gegenprüfen = …
- Erfinde NIEMALS Zahlen, Jahreszahlen, Zitate oder Studien. Bei reinem Smalltalk oder reinen Kreativaufgaben lasse den Hinweis weg.`;
}

// ---------- 7. KI-Einstellungen Normalisierung ----------
export function normalizeAiPrefs(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  return {
    selfCheck: r.selfCheck !== false,
    pastChatMemory: r.pastChatMemory !== false,
    factCheck: r.factCheck !== false
  };
}

// ---------- 8. Automatische Selbstprüfung & Rechen-/Code-Abgleich ----------
export function needsAutoSelfCheck(userText = '', draftText = '', aiPrefs = {}) {
  const prefs = normalizeAiPrefs(aiPrefs);
  if (!prefs.selfCheck) return false;
  const u = String(userText || '');
  const d = String(draftText || '');
  if (!d.trim() || d.length < 40) return false;
  if (GREETING_RE.test(u.trim())) return false;
  // Bereits als Artefakt-Teaser oder Tool-Aufruf unterwegs -> nicht hier prüfen
  if (/<(mcp_call|browser_open|browser_action|research_read|notebook_read|doc_read|use_skill|web_search)\b/i.test(d)) return false;

  const hasCode = /```[a-zA-Z0-9_-]*\n[\s\S]{30,}```|<artifact\b[^>]*type=["'](?:html|react|python|code|javascript|js)["']/i.test(d);
  const hasMath = MATH_EXPR_HINT_RE.test(u) || MATH_EXPR_HINT_RE.test(d) || /\b(rechn|gleichung|ergebnis|lösung|beweis|integral|ableitung|prozent|zins|fläche|volumen|wahrscheinlichkeit|logik)\b/i.test(u);
  return hasCode || hasMath;
}

export function extractMathAndCodeForVerify(text) {
  const raw = String(text || '');
  const codeBlocks = [];
  const noCode = raw.replace(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g, (_, lang, body) => {
    const l = String(lang || '').toLowerCase();
    if ((l === 'js' || l === 'javascript') && body.trim().length >= 8 && body.trim().length <= 3800) {
      if (codeBlocks.length < 2) codeBlocks.push({ language: 'javascript', code: body.trim() });
    }
    return '\n';
  });
  const equations = [];
  const seen = new Set();
  for (const line of noCode.split('\n')) {
    const clean = line.replace(/==([a-zA-ZäöüßÄÖÜ]+:)?([^=]+)==/g, '$2').replace(/[*_`]/g, '').trim();
    if (!clean || clean.length > 160) continue;
    const m = clean.match(/([0-9(√][0-9+\-*/^%.,()·×÷:\s√πe²³!]{1,80}=\s*-?[0-9.,]+(?:\s|$))/);
    if (m) {
      const cand = m[1].trim();
      if (/[+\-*/^%√·×÷:²³!]/.test(cand) && !/[a-zA-Z]{4,}/.test(cand) && !seen.has(cand)) {
        seen.add(cand);
        equations.push(cand);
        if (equations.length >= 6) break;
      }
    }
  }
  return { equations, codeBlocks };
}

export function buildSelfCheckPrompt({ userText, draftText, sandboxReport }) {
  const parts = [
    'Führe eine strenge, stille SELBSTPRÜFUNG für folgende Mathe-, Logik- oder Code-Antwort durch.',
    `NUTZER-FRAGE:\n${String(userText || '').slice(0, 2000)}`,
    `DEIN ENTWURF:\n${String(draftText || '').slice(0, 8000)}`
  ];
  if (sandboxReport) {
    const mathLines = (sandboxReport.mathResults || [])
      .map(m => `- ${m.expr} → Sandbox-Wert: ${m.ok ? m.value : m.error}${m.match === false ? ` (ABWEICHUNG zu ${m.expected}!)` : m.match === true ? ' (stimmt)' : ''}`)
      .join('\n');
    const codeLines = (sandboxReport.codeResults || [])
      .map((c, idx) => `- Code ${idx + 1}: ${c.ok ? (c.ran ? `lief fehlerfrei (${c.durationMs} ms)${c.logs?.length ? ', Ausgabe: ' + c.logs.join(' | ') : ''}` : 'Syntax OK') : `FEHLER: ${c.error}`}`)
      .join('\n');
    if (mathLines || codeLines) {
      parts.push(`SANDBOX-ERGEBNIS (deterministisch nachgerechnet/getestet):\n${[mathLines, codeLines].filter(Boolean).join('\n')}`);
    }
  }
  parts.push(
    'AUFGABE:\n' +
    '1. Prüfe Rechenschritte, Vorzeichen, Einheiten, Logik und Code-Randfälle anhand der Sandbox-Ergebnisse.\n' +
    '2. Wenn ALLES korrekt, vollständig und frei von Fehlern ist, antworte AUSSCHLIESSLICH mit exakt: [VERIFIED_OK]\n' +
    '3. Wenn du auch nur EINEN Rechen-, Logik- oder Code-Fehler findest, gib sofort die KOMPLETTE, korrigierte Endantwort für den Nutzer aus (ohne Meta-Kommentar „Ich habe korrigiert“).'
  );
  return parts.join('\n\n');
}
