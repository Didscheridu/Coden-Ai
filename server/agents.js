// Coden-Agenten für den App-Builder. Läuft komplett auf dem Server (Hintergrund-Lauf), baut also weiter,
// auch wenn die Seite zu ist. Aufbau wie bei Claude Code / Codex / Gemini CLI:
//   MAIN AGENT – mit ihm spricht der Nutzer. Er arbeitet in Schritten (denken → Code schreiben und/oder Werkzeuge
//                benutzen → Ergebnisse lesen → weiter) mit list/read/search/check/fetch/web_search/memory/image.
//   SUB-AGENTEN – startet der Main Agent mit spawn: Spezial-Agenten mit Kit und eigenem Modell (je nach Schwierigkeit),
//                parallel, jeder nur an seinen Dateien. Danach integriert und prüft der Main Agent.
//   Automatische Prüfung (Syntax, fehlende Dateien/Elemente) nach Änderungen – Fehler gehen zurück an den Main Agent.
const vm = require('vm');
const Agent = require('../shared/agent-core');
const { generateStream, CONTINUE } = require('./ai');
const { Meter } = require('./usage');
const Byok = require('./byok');
const Push = require('./push');

const MAX_FIX = 4, MAX_TEAM = 8, TEAM_PARALLEL = 8, HISTORY = 18; // alle Sub-Agenten eines Auftrags laufen gleichzeitig

// Modell je nach Schwierigkeit: leicht -> Flash (schnell), mittel -> das gewählte Modell, schwer -> das stärkste erlaubte
const RANK = { flash: 1, normal: 2, pro: 3, ultra: 4 };
const TIER_NAME = { flash: 'Flash', normal: 'Thinking', pro: 'Pro', ultra: 'Ultra' };
function tierFor(level, chosen, allowUltra) {
  const strongest = allowUltra ? 'ultra' : 'pro';
  if (level === 'easy') return 'flash';
  if (level === 'hard') return RANK[chosen] > RANK[strongest] ? chosen : strongest;
  return chosen;
}
// Begrenzt, wie viele Sub-Agenten gleichzeitig über den eigenen Key laufen (max Plätze; Rest wartet, bis einer frei wird)
function slots(max) {
  let free = Math.max(1, max | 0); const q = [];
  return {
    free: () => free,
    acquire(signal) {
      return new Promise((resolve, reject) => {
        const take = () => { free--; resolve(() => { free++; q.shift()?.(); }); };
        if (free > 0) return take();
        const w = () => { signal?.removeEventListener('abort', onAbort); take(); };
        const onAbort = () => { const i = q.indexOf(w); if (i >= 0) q.splice(i, 1); reject(new Error('abgebrochen')); };
        q.push(w); signal?.addEventListener('abort', onAbort, { once: true });
      });
    }
  };
}
const { compressMessages } = require('./context');
const SOFT_DEADLINE_MS = 230_000; // danach keine neuen Runden mehr (Vercel beendet Funktionen nach 300 s)
const syntax = (code) => { try { new vm.Script(code); return null; } catch (e) { return e.message; } };
const FILE_OK = /^(?!.*\.\.)[A-Za-z0-9_][A-Za-z0-9_.\-/]{0,99}$/;

// Verlauf wie im Browser: Dateiinhalte früherer Antworten sind gekürzt und als Kommentar markiert
function historyFrom(rows) {
  const out = [];
  for (const m of rows.filter(r => ['user', 'assistant', 'tool'].includes(r.role)).slice(-HISTORY)) {
    const role = m.role === 'assistant' ? 'assistant' : 'user';
    let content = m.role === 'user' && m.handle && !m.mine ? `@${m.handle} schreibt: ${m.body}` : String(m.body || '');
    if (role === 'assistant') content = content.replace(/\[Datei (geschrieben|geändert|gelöscht): ([^\]]+)\]/g, '[Bereits gespeichert: $2 ($1) – aktueller Stand im System-Prompt]').replace(/\(Geänderte Dateien:[^)]*\)/g, '');
    if (out.length && out[out.length - 1].role === role) out[out.length - 1].content += '\n\n' + content; else out.push({ role, content });
  }
  while (out.length && out[0].role !== 'user') out.shift();
  if (!out.length) out.push({ role: 'user', content: 'Mach weiter.' });
  // Nur der Chatverlauf wird komprimiert (~10.000 Tokens), die Dateien der App stehen vollständig im Systemprompt
  return compressMessages(out.map(m => ({ ...m, content: m.content.slice(0, 90000) })), { systemShare: 0 }).messages;
}

const LEVEL = { leicht: 'easy', easy: 'easy', einfach: 'easy', mittel: 'medium', medium: 'medium', normal: 'medium', schwer: 'hard', hard: 'hard', schwierig: 'hard' };
function parsePlan(text, files) {
  const m = String(text || '').match(/\{[\s\S]*\}/); if (!m) return null;
  let p; try { p = JSON.parse(m[0]); } catch (_) { return null; }
  if (!p.mode && Array.isArray(p.tasks)) p.mode = 'team'; // spawn-Aufruf des Main Agents
  if (!p || !['answer', 'single', 'team'].includes(p.mode)) return null;
  const seen = new Set();
  const tasks = (Array.isArray(p.tasks) ? p.tasks : []).slice(0, MAX_TEAM).map(t => ({
    title: String(t.title || 'Aufgabe').slice(0, 80), goal: String(t.goal || '').slice(0, 900),
    agent: Agent.KIT_IDS.includes(t.agent) ? t.agent : guessAgent(t), level: LEVEL[String(t.level || '').toLowerCase()] || 'medium',
    files: (Array.isArray(t.files) ? t.files : []).map(f => String(f).replace(/^\.?\//, '')).filter(f => FILE_OK.test(f) && !/^coden-kit\./.test(f) && !seen.has(f) && seen.add(f)).slice(0, 6)
  })).filter(t => t.files.length);
  let mode = p.mode; if (mode === 'team' && tasks.length < 2) mode = 'single';
  return { mode, summary: String(p.summary || '').slice(0, 300), contract: String(p.contract || '').slice(0, 2500), tasks, next: String(p.next || '').slice(0, 200) };
}

// Ohne Angabe: Agent an den Dateien erkennen
function guessAgent(t) {
  const f = (t.files || []).join(' ') + ' ' + (t.title || '');
  if (/\b3d\b|three|szene|scene|game3d/i.test(f)) return 'three';
  if (/game|spiel|level|physik/i.test(f)) return 'game';
  if (/\.(html?|css)\b|layout|design/i.test(f)) return 'layout';
  if (/\.svg\b|grafik|icon|logo|art/i.test(f)) return 'art';
  if (/data|\.json\b|daten|api|db/i.test(f)) return 'data';
  if (/text|inhalt|content|fragen/i.test(f)) return 'content';
  return 'logic';
}
// Team-Modus ohne brauchbaren Plan: trotzdem aufteilen (Aufbau & Design / Logik bzw. Spiel)
function defaultTeam(ctx) {
  const names = Object.keys(ctx.files);
  const js = names.filter(n => /\.js$/.test(n) && !/^coden-kit/.test(n));
  const game = ctx.app.kind === 'game';
  const logicFiles = js.length ? js.slice(0, 6) : [game ? 'game.js' : 'app.js'];
  return { mode: 'team', summary: 'Das Coden-Team setzt deinen Wunsch um.', next: '',
    contract: `index.html bindet coden-kit.js und danach ${logicFiles.join(', ')} am Ende von <body> ein. Alle Elemente, die die Logik braucht, haben eine id (kebab-case). Die Logik schreibt keine Styles, das Layout keine Logik.`,
    tasks: [
      { title: 'Aufbau & Design', agent: 'layout', level: 'medium', files: ['index.html', 'style.css'], goal: 'Struktur und Aussehen passend zum Wunsch des Nutzers.' },
      { title: game ? 'Spiellogik' : 'App-Logik', agent: game ? 'game' : 'logic', level: 'hard', files: logicFiles, goal: 'Die Funktionen, die der Nutzer sich wünscht, vollständig und fehlerfrei.' }
    ] };
}

const MAX_STEPS = 40, MAX_SPAWNS = 3, MAX_TOOLS_PER_STEP = 8, MAX_IMG_ROUNDS = 2;
const Tools = require('./agent-tools');
const WAIT_TOOLS = ['database', 'ask', 'secret'];
const escAttr = (s) => String(s).replace(/[<>"&\n]/g, (c) => ({ '<': '‹', '>': '›', '"': '“', '&': '+', '\n': ' ' }[c]));
const TOOL_VERB = { list: 'listet Dateien', tree: 'analysiert Struktur', read: 'liest', outline: 'liest Gliederung', search: 'sucht', check: 'prüft die App', dom_map: 'prüft DOM-Verbindungen', move: 'verschiebt', copy: 'kopiert', insert: 'fügt Code ein', fetch: 'liest eine Webseite', web_search: 'sucht im Web', cdn_search: 'sucht CDN-Paket', memory: 'merkt sich etwas', spawn: 'startet Sub-Agenten', image: 'erstellt Bilder' };

// ---------- Etappen: ein Lauf darf auf Vercel höchstens 300 s dauern. Für große Aufgaben speichert der Agent
// seinen Stand und startet sich selbst in einer neuen Server-Ausführung neu (bis MAX_LEGS, insgesamt MAX_TOTAL_STEPS).
const LEG_START_MS = 160_000;   // danach keinen neuen Schritt mehr in dieser Etappe beginnen
const legStart = () => Number(process.env.CODEN_LEG_START_MS) || LEG_START_MS;
const legSteps = () => Number(process.env.CODEN_LEG_STEPS) || Infinity; // nur für Tests: Schritte pro Etappe
const LEG_HARD_MS = 262_000;    // spätestens dann wird ein laufender Schritt abgebrochen (und in der nächsten Etappe wiederholt)
const MAX_LEGS = 10, MAX_TOTAL_STEPS = 40, MAX_NUDGES = 3;
const HEAVY = ['spawn', 'image', 'fetch', 'web_search'];
const SPAWN_MIN_MS = () => { const n = parseInt(process.env.CODEN_SPAWN_MIN_MS, 10); return Number.isFinite(n) ? n : 150_000; }; // so viel Zeit brauchen Sub-Agenten mindestens – sonst in die nächste Etappe
const SUB_RESERVE_MS = () => { const n = parseInt(process.env.CODEN_SUB_RESERVE_MS, 10); return Number.isFinite(n) ? n : 30_000; }; // vor Etappen-Ende Sub-Agenten anhalten und Stand sichern
// Mehrere spawn-Aufrufe in einem Schritt zu EINEM Auftrag zusammenfassen (alle Sub-Agenten gleichzeitig statt nacheinander)
function mergeSpawns(tools) {
  const sp = tools.filter(t => t.name === 'spawn'); if (sp.length < 2) return tools;
  const parts = sp.map(t => { const m = String(t.body || '').match(/\{[\s\S]*\}/); try { return m ? JSON.parse(m[0]) : null; } catch (_) { return null; } }).filter(Boolean);
  if (!parts.length) return tools;
  const merged = { summary: parts.map(p => p.summary).filter(Boolean).join(' · ').slice(0, 300), contract: [...new Set(parts.map(p => p.contract).filter(Boolean))].join('\n'),
    tasks: parts.flatMap(p => Array.isArray(p.tasks) ? p.tasks : []) };
  const first = tools.indexOf(sp[0]);
  const out = tools.filter(t => t.name !== 'spawn'); out.splice(Math.min(first, out.length), 0, { ...sp[0], body: JSON.stringify(merged) });
  return out;
}
// Hat das Modell nur angekündigt, statt zu handeln? (häufigster Grund, warum Agenten "einfach aufhören")
const INTENT = /\b(let me|i will|i'll|i'm going to|i am going to|now i|next,? i|i need to|lass mich|ich werde|ich muss|ich (mache|baue|schreibe|füge|behebe|ändere|prüfe|repariere|ergänze|passe|verschiebe|kümmere)[^.!?\n]{0,30}\b(jetzt|nun|als nächstes|gleich|noch)|jetzt (behebe|baue|schreibe|füge|ändere|prüfe|repariere|ergänze|kümmere|passe)|als nächstes|im nächsten schritt)\b/i;
const tailText = (p) => { let k = -1; p.segs.forEach((x, i) => { if (x.kind !== 'text') k = i; }); return p.segs.slice(k + 1).filter(x => x.kind === 'text').map(x => x.text).join(' ').trim().slice(-500); };
const isQuestion = (w) => /\?\s*$/.test(w.trim()) && w.length < 400 && !/\b(bau|mach|füg|änder|erstell|fix|behebe|reparier|programmier|schreib|ergänz|verbesser|add|build|make|create)/i.test(w);

async function runAppAgent(run, ctx) {
  const t0 = Date.now(); const elapsed = () => Date.now() - t0; const timeLeft = () => LEG_HARD_MS - elapsed();
  const S = ctx.state || {};                       // Stand aus der vorigen Etappe (oder leer beim Start)
  const runStartedAt = S.startedAt || t0;
  const leg = (S.leg || 0) + 1;
  const agents = S.agents || [];
  const labels = ctx.uid ? await Byok.labels(ctx.uid).catch(() => ({})) : {}; // Namen eigener Modelle/Ketten für die Anzeige
  const tn = (t) => TIER_NAME[t] || labels[t] || (Byok.isOwnTier(t) ? 'Eigenes Modell' : String(t));
  const push = () => run.setAgents(agents.map(a => ({ id: a.id, role: a.role, title: a.title, status: a.status, detail: a.detail, tier: a.tier ? tn(a.tier) : undefined, kit: a.kit, level: a.level, parent: a.parent })));
  const add = (o) => { const a = { status: 'wait', detail: '', ...o }; agents.push(a); push(); return a; };
  const set = (a, patch) => { Object.assign(a, patch); push(); };
  const style = ctx.style; let files = { ...ctx.files }; const history = ctx.history.slice();
  const legAc = new AbortController(); const legTimer = setTimeout(() => legAc.abort(), LEG_HARD_MS);
  const signal = AbortSignal.any ? AbortSignal.any([run.signal, legAc.signal]) : run.signal;
  const meter = new Meter({ uid: ctx.uid, email: ctx.email, isOwner: ctx.isOwner }, ctx.tier); // Nutzungslimit
  const common = { isOwner: ctx.isOwner, uid: ctx.uid, signal, effort: ctx.effort, meter };
  const spawnAllowed = ctx.mode !== 'single';
  const mainCfg = { maxSteps: MAX_TOTAL_STEPS, spawn: spawnAllowed, team: ctx.mode === 'team' && ctx.trigger === 'user' && !S.spawns };
  const sys = (team) => ({ role: 'system', content: Agent.systemPrompt({ app: ctx.app, files, style, team, main: team ? null : mainCfg }) });
  const main = agents.find(a => a.id === 'main') || add({ id: 'main', role: 'main', title: '🧠 Main Agent', tier: ctx.tier, detail: 'liest deine Nachricht' });
  set(main, { status: 'run', detail: leg > 1 ? `Etappe ${leg}: macht weiter …` : 'liest deine Nachricht' });

  const steps = S.steps || [];                     // Gespräch innerhalb dieses Auftrags (Antworten + Werkzeug-Ergebnisse)
  const changed = new Map(S.changed || []);        // Datei -> Art der Änderung (für die Anzeige)
  let dirtySinceCheck = !!S.dirty, fixes = S.fixes || 0, spawns = S.spawns || 0, imgRounds = S.imgRounds || 0, stepsTotal = S.stepsTotal || 0;
  let nudges = S.nudges || 0, reviewed = !!S.reviewed, waits = false, finished = false, pending = S.pending || null;
  const wish = String([...history].reverse().find(m => m.role === 'user')?.content || '');
  const out = { text: run.text || '' };            // gesamte sichtbare Antwort (wächst nur – Zuschauer bekommen nur das Neue)
  const emit = (t) => { if (!t) return; out.text += t; run.delta(t); };
  const results = [];                              // Ergebnisse, die an den Main Agent zurückgehen
  let stepsInLeg = 0;
  const flushResults = (extra = '') => {
    if (!results.length) return;
    emit('\n' + results.map(r => `<result name="${escAttr(r.name)}" ok="${r.ok ? 1 : 0}">${escAttr(r.summary)}</result>`).join('\n'));
    steps.push({ role: 'user', content: '[Werkzeug-Ergebnisse]\n\n' + results.map(r => r.text).join('\n\n') + extra });
    results.length = 0;
  };
  let subResume = S.subResume || null;               // Sub-Agenten, die in der nächsten Etappe weiterschreiben
  const runTools = async (auto) => {
    for (const t of auto.filter(x => x.name !== 'image')) {
      if (signal.aborted || subResume) break;
      set(main, { detail: `${TOOL_VERB[t.name] || t.name} ${t.attrs.path || t.attrs.query || t.attrs.url || ''}`.trim() });
      results.push({ name: t.name, ...(await execTool(t)) });
    }
    const imgs = auto.filter(t => t.name === 'image'); if (imgs.length && !signal.aborted) results.push({ name: 'image', ...(await images(imgs)) });
  };
  if (leg > 1) emit(`\n\n<result name="leg" ok="1">Etappe ${leg} – Coden arbeitet weiter</result>`);

  try {
    // Werkzeuge, die am Ende der letzten Etappe keine Zeit mehr hatten (z. B. spawn), zuerst ausführen
    if (subResume && !pending?.length) pending = [{ name: 'spawn_resume', attrs: {} }];
    if (pending?.length) {
      const tools = pending.map(t => ({ ...t, attrs: t.attrs || {} })); pending = null;
      if (tools.some(t => t.name === 'spawn_resume')) { const r = subResume; subResume = null; results.push({ name: 'spawn', ...(await spawn(null, r)) }); }
      const rest = tools.filter(t => t.name !== 'spawn_resume');
      if (!subResume && rest.length) await runTools(rest);
      if (subResume) { flushResults(); return await nextLeg([{ name: 'spawn_resume', attrs: {} }]); }
      flushResults();
    }
    while (!finished && !waits) {
      if (run.signal.aborted) break;
      if (meter.stop) { emit('\n\n⏸️ ' + meter.message()); break; } // Aufgabe lief sehr lange weit über das Limit
      if (stepsTotal >= MAX_TOTAL_STEPS) { emit('\n\n⏸️ Ich habe die maximale Anzahl Schritte für einen Auftrag erreicht. Schreib „weiter“, dann mache ich genau hier weiter.'); break; }
      if (stepsInLeg > 0 && (elapsed() > legStart() || stepsInLeg >= legSteps())) return await nextLeg();
      stepsInLeg++;
      stepsTotal++;
      set(main, { status: 'run', detail: `Schritt ${stepsTotal}${leg > 1 ? ' · Etappe ' + leg : ''}: denkt nach …` });
      if (out.text) emit('\n\n');
      let text = '';
      try {
        await generateStream(ctx.tier, [sys(), ...history, ...steps], { ...common, maxTokens: 16000, onModel: (m) => run.setModel(m), onThink: (k) => run.thinkStep(k),
          onDelta: (v) => { text += v; emit(v); if (text.length % 1500 < v.length) { const pr = progress(text); if (pr) set(main, { detail: pr }); } } });
      } catch (e) {
        if (run.signal.aborted) break;
        if (e.limit) { emit('\n\n⏸️ ' + e.message); if (text.trim()) steps.push({ role: 'assistant', content: Agent.condense(text) || '…' }); break; }
        if (legAc.signal.aborted) { stepsTotal--; emit('\n\n_(Diese Etappe ist vorbei – der Schritt wird gleich wiederholt.)_'); return await nextLeg(); }
        if (!text.trim()) { if (stepsTotal === 1 && !steps.length) throw e; emit('⚠️ ' + e.message); break; }
      }

      // 1) Dateien des Main Agents anwenden
      const p = Agent.parse(text);
      const res = Agent.apply(files, p.ops);
      if (Object.keys(res.set).length || res.remove.length) { files = await ctx.save(res.set, res.remove); res.changed.forEach(c => changed.set(c.path, c)); dirtySinceCheck = true; }
      steps.push({ role: 'assistant', content: Agent.condense(text) || '…' });
      if (res.problems.length) results.push({ name: 'apply', ok: false, summary: `${res.problems.length} Änderung(en) nicht angewendet`, text: `[Änderungen] Diese Änderungen konnten nicht angewendet werden:\n${res.problems.map(x => '- ' + x).join('\n')}\nLies die Stelle (read/search) und versuche es mit dem EXAKTEN Text erneut – oder schreibe die Datei komplett neu.` });

      // 2) Werkzeuge ausführen (schwere Werkzeuge bei knapper Zeit in die nächste Etappe verschieben)
      waits = p.tools.some(t => WAIT_TOOLS.includes(t.name));
      const auto = mergeSpawns(p.tools.filter(t => Agent.AUTO_TOOLS.includes(t.name))).slice(0, MAX_TOOLS_PER_STEP);
      // Sub-Agenten brauchen eine frische Etappe: lieber jetzt neu starten, als sie mittendrin abzubrechen
      const needs = auto.some(t => t.name === 'spawn') ? SPAWN_MIN_MS() : auto.some(t => HEAVY.includes(t.name)) ? 120_000 : 0;
      if (needs && timeLeft() < needs && leg < MAX_LEGS) { flushResults(); return await nextLeg(auto); }
      await runTools(auto);
      if (subResume) { flushResults(); return await nextLeg([{ name: 'spawn_resume', attrs: {} }]); }
      if (waits) break;

      // 3) Fertig? Nur wenn nichts mehr offen ist – sonst nachhaken, prüfen, abnehmen
      const isDone = p.tools.some(t => t.name === 'done');
      if (!results.length) {
        const tail = tailText(p);
        const announced = !p.ops.length && (INTENT.test(tail) || /:\s*$/.test(tail));
        const nothingBuilt = !changed.size && !p.ops.length && !isQuestion(wish) && ctx.trigger === 'user' && !spawns;
        if (dirtySinceCheck && fixes < MAX_FIX) {
          const c = Tools.check(files); dirtySinceCheck = c.issues.length > 0;
          if (c.issues.length) { fixes++; results.push({ name: 'check', ok: false, summary: c.summary + ' – Main Agent behebt sie', text: `[Automatische Prüfung] ${c.text}\nBehebe diese Probleme jetzt selbst (nicht beenden, bis alle behoben sind).` }); }
        }
        if (!results.length && !isDone && nudges < MAX_NUDGES && (announced || nothingBuilt)) {
          nudges++;
          results.push({ name: 'nudge', ok: false, summary: 'Coden setzt die Ankündigung jetzt um', text: announced
            ? '[System] Du hast nur angekündigt, was du tun willst, aber keine Änderung ausgegeben. Gib JETZT die vollständigen <file>- oder <edit>-Blöcke dafür aus (oder benutze ein Werkzeug) – ohne erneute Ankündigung.'
            : '[System] Der Nutzer möchte, dass du etwas baust oder änderst, aber es wurde noch keine Datei geändert. Setze es jetzt vollständig um (<file>/<edit>' + (spawnAllowed ? ' oder spawn' : '') + ').' });
        }
        // Abnahme: einmal pro Auftrag die Bitte Punkt für Punkt gegen den Code prüfen lassen
        if (!results.length && !reviewed && changed.size && (spawns || changed.size >= 2 || stepsTotal >= 3) && stepsTotal < MAX_TOTAL_STEPS - 1) {
          reviewed = true;
          results.push({ name: 'review', ok: true, summary: 'Abnahme: prüft deine Bitte Punkt für Punkt', text: `[Abnahme] Prüfe kurz die Bitte des Nutzers gegen den AKTUELLEN Code (Start ohne Fehler? Alle Buttons/Formulare aktiv? Mobil/Touch?). Bei ❌: sofort mit <file>/<edit>/<insert> beheben. Wenn alles ✅ ist: antworte in 1–2 knappen Sätzen was geändert wurde und gib <tool name="done"/> aus.\n\nBitte des Nutzers:\n${wish.slice(0, 3000)}` });
        }
        if (!results.length) { finished = true; break; }
      }
      flushResults(isDone ? '\n\nDu hattest "done" gesagt, aber es gibt noch Fehler oder offene Punkte – behebe sie erst und schließe dann sauber ab.' : '');
    }
  } finally { clearTimeout(legTimer); await meter.close(); }

  set(main, { status: 'done', detail: `${stepsTotal} Schritt${stepsTotal !== 1 ? 'e' : ''}${leg > 1 ? ' · ' + leg + ' Etappen' : ''}${changed.size ? ' · ' + changed.size + ' Datei' + (changed.size > 1 ? 'en' : '') : ''}${spawns ? ' · ' + agents.filter(a => a.parent && a.role === 'coder').length + ' Sub-Agenten' : ''}` });
  return finish();

  async function finish() {
    // Eine Nachricht für den ganzen Auftrag (Dateiinhalte gekürzt, Werkzeug-Ergebnisse bleiben als kurze Zeilen)
    const reply = withReply(out.text, Agent.parse(out.text));
    if (reply !== out.text) { const suffix = reply.slice(out.text.replace(/\s+$/, '').length); if (suffix.trim()) emit(suffix); }
    await ctx.post('assistant', Agent.condense(out.text) || '…', { changed: [...changed.values()], model: run.model || undefined, agents: agents.map(a => ({ title: a.title, status: a.status, tier: a.tier ? tn(a.tier) : undefined })).slice(0, 14), steps: stepsTotal, legs: leg, durationMs: Math.max(0, Date.now() - runStartedAt) });
    run.setExtra({ done: true, steps: stepsTotal, legs: leg });
    if (run.subs.size === 0 && ctx.uid && !run.signal.aborted) await Push.notify(ctx.uid, { title: `Coden ist fertig: ${ctx.app?.name || 'App'}`, body: changed.size ? `${changed.size} Datei${changed.size > 1 ? 'en' : ''} geändert – tippe, um die App zu öffnen.` : Push.preview(out.text.replace(/<result[^>]*>[^<]*<\/result>/g, '').slice(-400)), url: `/#/apps/${ctx.app?.id || ''}`, tag: 'app-' + (ctx.app?.id || '') });
    return { files, summary: { steps: stepsTotal, legs: leg, changed: [...changed.keys()] } };
  }
  // Stand sichern und die nächste Etappe auf dem Server starten
  async function nextLeg(deferred) {
    if (leg >= MAX_LEGS || !ctx.continueLeg) {
      emit('\n\n⏸️ Das war ein großer Auftrag – ich habe hier pausiert. Schreib „weiter“, dann mache ich genau hier weiter.');
      set(main, { status: 'done', detail: `pausiert nach ${stepsTotal} Schritten` });
      return finish();
    }
    set(main, { status: 'run', detail: `Etappe ${leg} fertig – startet Etappe ${leg + 1} …` });
    const keepSteps = steps.slice(-30).map(m => ({ role: m.role, content: String(m.content).slice(0, 12000) }));
    const state = { leg, startedAt: runStartedAt, subResume, agents: agents.map(a => ({ ...a })), steps: keepSteps, changed: [...changed.entries()], dirty: dirtySinceCheck, fixes, spawns, imgRounds, stepsTotal, nudges, reviewed,
      pending: deferred ? deferred.map(t => ({ name: t.name, attrs: t.attrs, body: t.body, id: t.id, prompt: t.prompt })) : null };
    const ok = await ctx.continueLeg(state).catch((e) => { console.warn('[agent] Etappe konnte nicht starten:', e.message); return false; });
    if (!ok) { ctx.continueLeg = null; return nextLeg(deferred); }
    return { continued: true };
  }

  // ---------- Werkzeuge ----------
  async function execTool(t) {
    const a = t.attrs;
    const applyRes = async (r) => {
      if (r.set || r.remove?.length) {
        const prevFiles = files;
        files = await ctx.save(r.set || {}, r.remove || []);
        for (const p of Object.keys(r.set || {})) changed.set(p, { type: p in prevFiles ? 'edit' : 'new', path: p });
        for (const p of r.remove || []) changed.set(p, { type: 'delete', path: p });
        dirtySinceCheck = true;
      }
      return r;
    };
    switch (t.name) {
      case 'list': return Tools.list(files, a.pattern);
      case 'tree': return Tools.tree(files);
      case 'read': return Tools.read(files, a.path || a.file, a.start, a.end);
      case 'outline': return Tools.outline(files, a.path || a.file);
      case 'search': return Tools.search(files, a.query || t.body, a.regex, a.pattern, a.context);
      case 'check': { const c = Tools.check(files); dirtySinceCheck = c.issues.length > 0; return c; }
      case 'dom_map': return Tools.domMap(files);
      case 'move': return applyRes(Tools.move(files, a.from, a.to, a.overwrite));
      case 'copy': return applyRes(Tools.copy(files, a.from, a.to, a.overwrite));
      case 'insert': return applyRes(Tools.insert(files, a.path || a.file, { line: a.line, after: a.after, content: t.body }));
      case 'fetch': return Tools.fetchUrl(a.url || t.body);
      case 'web_search': return Tools.webSearch(a.query || t.body);
      case 'cdn_search': return Tools.cdnSearch(a.query || t.body);
      case 'memory': { const r = Tools.memory(files, t.body || a.text); if (r.set) { files = await ctx.save(r.set, []); changed.set('CODEN.md', { type: 'edit', path: 'CODEN.md' }); } return r; }
      case 'spawn': return spawn(t.body);
      default: return { ok: false, summary: 'unbekanntes Werkzeug', text: `Unbekanntes Werkzeug "${t.name}".` };
    }
  }
  async function images(list) {
    if (imgRounds >= MAX_IMG_ROUNDS) return { ok: false, summary: 'keine weiteren Bilder', text: '[Bilder] Für diesen Lauf sind keine weiteren Bilder möglich – nimm SVGs, Emojis oder Unsplash.' };
    imgRounds++;
    const painter = add({ id: 'img' + imgRounds, role: 'designer', parent: 'main', title: '🖼️ Bild-Agent', detail: `erstellt ${list.length} Bild${list.length > 1 ? 'er' : ''}` }); set(painter, { status: 'run' });
    const done = await Promise.all(list.slice(0, 3).map(async (t) => { try { return { id: t.id || 'bild', url: await ctx.image(t.prompt) }; } catch (e) { return { id: t.id || 'bild', error: e.message }; } }));
    const ok = done.filter(o => o.url);
    set(painter, { status: ok.length ? 'done' : 'error', detail: ok.length ? `${ok.length} Bild${ok.length > 1 ? 'er' : ''} fertig` : 'Bilder gehen gerade nicht' });
    return { ok: ok.length > 0, summary: ok.length ? `${ok.length} Bild${ok.length > 1 ? 'er' : ''} erstellt` : 'Bilder gehen gerade nicht', text: `[Bilder]\n${done.map(o => o.url ? `- ${o.id}: ${o.url}` : `- ${o.id}: FEHLGESCHLAGEN (${o.error})`).join('\n')}\n${ok.length ? 'Baue sie jetzt mit diesen URLs ein.' : 'Nimm stattdessen SVGs, Emojis oder Unsplash-Bilder.'}` };
  }
  // ---------- Sub-Agenten (spawn) ----------
  // spawn: neue Sub-Agenten starten – oder (resume) Sub-Agenten aus der letzten Etappe weiterschreiben lassen
  async function spawn(body, resume) {
    let plan, n, done = [];
    if (resume) { plan = resume.plan; n = resume.n; }
    else {
      if (!spawnAllowed) return { ok: false, summary: 'Solo-Modus: keine Sub-Agenten', text: 'Im Solo-Modus gibt es keine Sub-Agenten – erledige die Aufgabe selbst.' };
      if (spawns >= MAX_SPAWNS) return { ok: false, summary: 'Sub-Agenten-Limit erreicht', text: `Höchstens ${MAX_SPAWNS} spawn-Aufrufe pro Lauf – mach den Rest selbst.` };
      plan = parsePlan(body, files);
      if (!plan || !plan.tasks.length) return { ok: false, summary: 'ungültiger spawn-Auftrag', text: 'spawn braucht gültiges JSON: {"contract":"…","tasks":[{"title":"…","agent":"logic","level":"mittel","files":["app.js"],"goal":"…"}]} – jede Datei nur in einer Aufgabe.' };
      spawns++; n = spawns;
      // Modell je Sub-Agent: Einstellung pro Schwierigkeit, sonst gemeinsames Sub-Modell, sonst wie der Main Agent (eigene Modelle) bzw. nach Schwierigkeit (Coden)
      const cfg = ctx.agentCfg || {};
      const validTier = (t) => t && t !== 'auto' && (['flash', 'normal', 'pro'].includes(t) || (t === 'ultra' && ctx.allowUltra) || Byok.isOwnTier(t));
      plan.tasks.forEach(t => { t.tier = [cfg.levels?.[t.level], cfg.sub].find(validTier) || (Byok.isOwnTier(ctx.tier) ? ctx.tier : tierFor(t.level, ctx.tier, ctx.allowUltra)); });
      // Höchstens keyMax Sub-Agenten gleichzeitig über den eigenen Key. „coden“: der Rest läuft sofort über Coden-Modelle; „wait“: der Rest wartet (siehe slots unten)
      if (cfg.overflow === 'coden') {
        let used = 0; const max = Math.max(1, cfg.keyMax || 3);
        for (const t of plan.tasks) if (Byok.isOwnTier(t.tier)) { if (used < max) used++; else t.tier = ['flash', 'normal', 'pro'].includes(cfg.overflowTier) ? cfg.overflowTier : 'flash'; }
      }
    }
    const tasks = plan.tasks;
    const subs = tasks.map((t, i) => {
      const id = `sub${n}-${i + 1}`; const old = agents.find(a => a.id === id); if (old) return old;
      const k = Agent.kitFor(t.agent); return add({ id, role: 'coder', parent: 'main', kit: t.agent, tier: t.tier, level: t.level, title: `${k ? k.emoji + ' ' + k.name : 'Sub-Agent ' + (i + 1)}: ${t.title}`, detail: t.files.join(', ') });
    });
    const owner = new Map(); tasks.forEach((t, i) => t.files.forEach(f => owner.set(f, i)));
    const raw = tasks.map((t, i) => (resume?.raw?.[i] ?? ''));           // bisher geschriebener Text je Sub-Agent
    const notes = tasks.map((t, i) => resume?.notes?.[i] || '');
    const todo = tasks.map((t, i) => i).filter(i => !resume || resume.open.includes(i));
    if (resume) done = resume.done || [];
    set(main, { detail: resume ? `${todo.length} Sub-Agent${todo.length > 1 ? 'en schreiben' : ' schreibt'} weiter …` : `wartet auf ${tasks.length} Sub-Agenten (alle gleichzeitig) …` });
    const lastUser = [...history].reverse().find(m => m.role === 'user');
    const brief = { role: 'user', content: `${lastUser ? 'Wunsch des Nutzers: ' + lastUser.content.slice(0, 4000) + '\n\n' : ''}Auftrag vom Main Agent: ${plan.summary || 'siehe Aufgaben'}. Erledige jetzt DEINE Aufgabe vollständig.` };
    // Vor dem Etappen-Ende anhalten und den Stand sichern (statt abzubrechen); in der nächsten Etappe geht es nahtlos weiter
    const subAc = new AbortController(); let cut = false;
    const subMin = parseInt(process.env.CODEN_SUB_MIN_MS, 10) || 5_000;
    const cutTimer = setTimeout(() => { if (leg < MAX_LEGS) { cut = true; subAc.abort(); } }, Math.max(subMin, timeLeft() - SUB_RESERVE_MS()));
    const subSignal = AbortSignal.any([signal, subAc.signal]);
    const keySlots = slots(ctx.agentCfg?.keyMax || 3);
    const paused = [], readyOps = [];
    await Promise.all(todo.map(async (i) => {
      const t = tasks[i]; const viaKey = Byok.isOwnTier(t.tier); let release = null;
      set(subs[i], viaKey && keySlots.free() < 1 ? { status: 'wait', detail: 'wartet auf einen freien Key-Platz …' } : { status: 'run', detail: raw[i] ? 'schreibt weiter …' : 'startet …' });
      const team = { role: `${Agent.kitFor(t.agent)?.name || 'Sub-Agent'} (Sub-Agent ${i + 1} von ${tasks.length}, beauftragt vom Main Agent)`, summary: plan.summary || 'Auftrag vom Main Agent', contract: plan.contract, tasks, task: t };
      const msgs = raw[i] ? [sys(team), brief, { role: 'assistant', content: raw[i] }, { role: 'user', content: CONTINUE }] : [sys(team), brief];
      try {
        if (viaKey) { release = await keySlots.acquire(subSignal); set(subs[i], { status: 'run', detail: raw[i] ? 'schreibt weiter …' : 'startet …' }); }
        await generateStream(t.tier, msgs, { ...common, signal: subSignal, meter: meter.child(t.tier), maxTokens: 16000, onDelta: (v) => { raw[i] += v; if (raw[i].length % 1500 < v.length) set(subs[i], { detail: progress(raw[i]) || 'schreibt …' }); } });
        finishSub(i);
      } catch (e) {
        if (run.signal.aborted) return;
        if (cut && raw[i].trim()) { paused.push(i); set(subs[i], { status: 'wait', detail: `pausiert bei ${progress(raw[i]) || 'Schreiben'} – macht in der nächsten Etappe weiter` }); return; }
        if (cut) { paused.push(i); set(subs[i], { status: 'wait', detail: 'startet in der nächsten Etappe' }); return; }
        notes[i] = 'Fehler: ' + e.message; done.push({ i, paths: [] }); set(subs[i], { status: 'error', detail: e.message.slice(0, 120) });
      } finally { release?.(); }
    }));
    clearTimeout(cutTimer);
    function finishSub(i) {
      const pp = Agent.parse(raw[i]); const mine = pp.ops.filter(o => owner.get(o.path) === i);
      const foreign = pp.ops.filter(o => owner.get(o.path) !== i).map(o => o.path);
      notes[i] = pp.segs.filter(x => x.kind === 'text').map(x => x.text).join(' ').replace(/\s+/g, ' ').trim().slice(0, 300) + (foreign.length ? ` (fremde Dateien verworfen: ${foreign.join(', ')})` : '');
      readyOps.push(...mine); done.push({ i, paths: mine.map(o => o.path) });
      set(subs[i], { status: mine.length ? 'done' : 'error', detail: mine.length ? `${mine.length} Datei${mine.length > 1 ? 'en' : ''}: ${mine.map(o => o.path).join(', ')}` : 'hat keine Datei geliefert' });
    }
    // Fertige Ergebnisse sofort speichern (auch wenn andere Sub-Agenten noch weiterschreiben)
    const r = Agent.apply(files, readyOps.splice(0));
    if (Object.keys(r.set).length || r.remove.length) { files = await ctx.save(r.set, r.remove); r.changed.forEach(c => changed.set(c.path, c)); dirtySinceCheck = true; }
    if (paused.length && !run.signal.aborted) {
      subResume = { plan, n, open: paused, raw: raw.map((x, i) => paused.includes(i) ? x.slice(-60000) : ''), notes, done };
      return { ok: true, summary: `${done.filter(d => d.paths.length).length}/${tasks.length} Sub-Agenten fertig · ${paused.length} schreiben in der nächsten Etappe weiter`, text: '[Sub-Agenten] Ein Teil ist fertig, der Rest schreibt in der nächsten Etappe weiter.' };
    }
    const c = Tools.check(files); dirtySinceCheck = c.issues.length > 0;
    set(main, { detail: 'prüft die Ergebnisse der Sub-Agenten' });
    const okN = subs.filter(x => x.status === 'done').length;
    const pathsOf = (i) => (done.find(d => d.i === i)?.paths || []).join(', ');
    const report = tasks.map((t, i) => `${subs[i].status === 'done' ? '✅' : '⚠️'} ${subs[i].title} [${tn(t.tier)}] → ${pathsOf(i) || 'nichts geliefert'}${notes[i] ? '\n   Notiz: ' + notes[i] : ''}`).join('\n');
    return { ok: okN === tasks.length && !c.issues.length, summary: `${okN}/${tasks.length} Sub-Agenten fertig · ${c.summary}`,
      text: `[Sub-Agenten] ${okN} von ${tasks.length} fertig:\n${report}${r.problems.length ? '\nNicht angewendet: ' + r.problems.join('; ') : ''}\n\n${c.text}\n\nJetzt bist DU dran: lies die neuen Dateien (read/search), prüfe, ob alles zum Vertrag passt, schreibe fehlende Verbindungen selbst und behebe Fehler. Ausgefallene Aufgaben erledigst du selbst.` };
  }

}

// Fortschritt eines schreibenden Agenten: welche Datei, wie viele Zeilen
function progress(text) {
  const files = [...String(text).matchAll(/<(file|edit)\s+path="([^"]+)"/g)].map(m => m[2]);
  if (!files.length) return '';
  const lines = String(text).split('\n').length;
  return `schreibt ${files[files.length - 1]} · ${lines} Zeilen${files.length > 1 ? ` · ${files.length} Dateien` : ''}`;
}
// Nur die erlaubten Blöcke eines Team-Agenten behalten (in Originalform)
function rebuild(text, ops) {
  return ops.map(o => o.type === 'file' ? `<file path="${o.path}">\n${o.content}\n</file>`
    : o.type === 'edit' ? `<edit path="${o.path}">\n${o.pairs.map(p => `<find>${p.find}</find>\n<replace>${p.replace}</replace>`).join('\n')}\n</edit>`
    : `<delete path="${o.path}"/>`).join('\n\n');
}
function mergeRoles(list) { const out = []; for (const m of list) { if (out.length && out[out.length - 1].role === m.role) out[out.length - 1] = { ...out[out.length - 1], content: out[out.length - 1].content + '\n\n' + m.content }; else out.push(m); } return out; }
// Coden antwortet immer auch mit Text (wie im Browser)
function withReply(text, p) {
  const segs = p.segs; let lastOp = -1; segs.forEach((x, i) => { if (x.kind === 'op') lastOp = i; });
  const hasText = (a) => segs.slice(a).some(x => x.kind === 'text' && x.text.replace(/\[Datei [^\]]*\]/g, '').trim().length > 2);
  if (p.tools.length) return text;
  if (lastOp < 0) return hasText(0) ? text : text + (text.trim() ? '\n\n' : '') + 'Ich habe gerade nichts geändert. Sag mir gern genauer, was ich bauen oder anpassen soll.';
  if (hasText(lastOp + 1)) return text;
  const names = [...new Set(p.ops.map(o => o.path))]; const list = names.slice(0, 4).join(', ') + (names.length > 4 ? ` (+${names.length - 4})` : '');
  return text.replace(/\s+$/, '') + `\n\nGeändert: ${list}.`;
}

module.exports = { runAppAgent, historyFrom, parsePlan, tierFor, defaultTeam, MAX_STEPS, _progress: progress };
