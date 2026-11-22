// Coden-Agententeam für den App-Builder. Läuft komplett auf dem Server (Hintergrund-Lauf), baut also weiter,
// auch wenn die Seite zu ist. Ablauf:
//   1. Planer   – versteht die Aufgabe, entscheidet: nur antworten, ein Coder oder ein Team; teilt Dateien auf
//   2. Coder    – ein Agent (kleine Änderungen) oder bis zu 4 parallele Sub-Agenten mit gemeinsamem "Vertrag"
//   3. Prüfer   – Syntax, fehlende Dateien/Elemente (ohne KI) + im Team ein KI-Prüfer, ob die Teile zusammenpassen
//   4. Fixer    – behebt gefundene Probleme (höchstens 2 Runden), danach Bilder einbauen
const vm = require('vm');
const Agent = require('../shared/agent-core');
const { generate, generateStream } = require('./ai');

const MAX_FIX = 2, MAX_TEAM = 4, TEAM_PARALLEL = 3, HISTORY = 18;
const SOFT_DEADLINE_MS = 230_000; // danach keine neuen Runden mehr (Vercel beendet Funktionen nach 300 s)
const syntax = (code) => { try { new vm.Script(code); return null; } catch (e) { return e.message; } };
const FILE_OK = /^(?!.*\.\.)[A-Za-z0-9_][A-Za-z0-9_.\-/]{0,99}$/;

// Verlauf wie im Browser: Dateiinhalte früherer Antworten sind gekürzt und als Kommentar markiert
function historyFrom(rows) {
  const out = [];
  for (const m of rows.filter(r => ['user', 'assistant', 'tool'].includes(r.role)).slice(-HISTORY)) {
    const role = m.role === 'assistant' ? 'assistant' : 'user';
    let content = m.role === 'user' && m.handle && !m.mine ? `@${m.handle} schreibt: ${m.body}` : String(m.body || '');
    if (role === 'assistant') content = content.replace(/\[Datei (geschrieben|geändert|gelöscht): ([^\]]+)\]/g, '<!-- (frühere Antwort: Datei $2 $1, Inhalt hier gekürzt) -->').replace(/\(Geänderte Dateien:[^)]*\)/g, '');
    if (out.length && out[out.length - 1].role === role) out[out.length - 1].content += '\n\n' + content; else out.push({ role, content });
  }
  while (out.length && out[0].role !== 'user') out.shift();
  if (!out.length) out.push({ role: 'user', content: 'Mach weiter.' });
  return out.map(m => ({ ...m, content: m.content.slice(0, 90000) }));
}

const PLANNER = `Du bist der Planer im Coden-Agententeam (App-Builder). Du schreibst KEINEN Code. Du entscheidest, wie die letzte Bitte des Nutzers erledigt wird, und antwortest NUR mit JSON:
{"mode":"answer|single|team","summary":"1 Satz auf Deutsch, was gebaut/geändert wird","contract":"gemeinsame Absprachen für das Team: Element-IDs, CSS-Klassen, globale Funktionen und Variablen (Name + Zweck), Datenformate, Reihenfolge der <script>-Dateien","tasks":[{"title":"kurzer Titel","files":["index.html"],"goal":"was genau in diese Dateien gehört"}],"next":"ein Vorschlag für den nächsten Schritt"}
Regeln:
- "answer": der Nutzer fragt nur etwas, es muss nichts geändert werden (tasks leer).
- "single": kleine oder mittlere Änderungen an 1–3 Dateien, Fehler beheben, Design anpassen, alles was ein Agent schnell schafft (tasks: eine Aufgabe).
- "team": neue App/neues Spiel oder große Umbauten mit mehreren Bereichen. 2–4 Aufgaben, JEDE Datei gehört genau EINER Aufgabe. Typisch: (1) index.html + style.css (Aufbau & Design), (2) Logik/Daten in app.js oder data.js, (3) weitere Seiten/Module (z. B. game.js, ui.js). Der contract muss so genau sein, dass die Agenten unabhängig voneinander zusammenpassenden Code schreiben (z. B. "index.html hat <canvas id=\\"game\\">, <div id=\\"menu\\">, Knopf #start; app.js definiert window.startGame()").
- Dateinamen: index.html, style.css, app.js, weitere .js/.html/.json/.svg. coden-kit.css/js gibt es schon (nicht als Aufgabe).
- Nur gültiges JSON, keine Erklärung davor oder danach.`;

function parsePlan(text, files) {
  const m = String(text || '').match(/\{[\s\S]*\}/); if (!m) return null;
  let p; try { p = JSON.parse(m[0]); } catch (_) { return null; }
  if (!p || !['answer', 'single', 'team'].includes(p.mode)) return null;
  const seen = new Set();
  const tasks = (Array.isArray(p.tasks) ? p.tasks : []).slice(0, MAX_TEAM).map(t => ({
    title: String(t.title || 'Aufgabe').slice(0, 80), goal: String(t.goal || '').slice(0, 900),
    files: (Array.isArray(t.files) ? t.files : []).map(f => String(f).replace(/^\.?\//, '')).filter(f => FILE_OK.test(f) && !/^coden-kit\./.test(f) && !seen.has(f) && seen.add(f)).slice(0, 6)
  })).filter(t => t.files.length);
  let mode = p.mode; if (mode === 'team' && tasks.length < 2) mode = 'single';
  return { mode, summary: String(p.summary || '').slice(0, 300), contract: String(p.contract || '').slice(0, 2500), tasks, next: String(p.next || '').slice(0, 200) };
}

function planInput(ctx, history) {
  const names = Object.keys(ctx.files).sort();
  const peek = String(ctx.files['index.html'] || '').slice(0, 2500);
  const recent = history.slice(-6).map(m => `${m.role === 'user' ? 'NUTZER' : 'CODEN'}: ${m.content.replace(/<!--[\s\S]*?-->/g, '').slice(0, 1200)}`).join('\n\n');
  return `App: "${ctx.app.name}" · Typ: ${Agent.KIND_TEXT[ctx.app.kind] || ctx.app.kind}
Dateien (${names.length}): ${names.map(n => `${n} (${String(ctx.files[n]).split('\n').length} Zeilen)`).join(', ') || 'keine'}
Anfang von index.html:
${peek}

Gespräch (neueste zuletzt):
${recent}`;
}
// Nur ein Grundgerüst ohne eigene Inhalte? (Dann lohnt sich ein Team für die erste Version)
const looksFresh = (files) => Object.values(files).join('').length < 9000 && /Sag Coden im Chat|Deine neue App|Grundgerüst|Neues Spiel/.test(Object.values(files).join(''));

async function runAppAgent(run, ctx) {
  const t0 = Date.now(); const timeLeft = () => SOFT_DEADLINE_MS - (Date.now() - t0);
  const agents = [];
  const push = () => run.setAgents(agents.map(a => ({ id: a.id, role: a.role, title: a.title, status: a.status, detail: a.detail })));
  const add = (o) => { const a = { status: 'wait', detail: '', ...o }; agents.push(a); push(); return a; };
  const set = (a, patch) => { Object.assign(a, patch); push(); };
  const style = ctx.style; let files = { ...ctx.files }; let history = ctx.history.slice();
  const common = { isOwner: ctx.isOwner, signal: run.signal, effort: ctx.effort };
  const sys = (team) => ({ role: 'system', content: Agent.systemPrompt({ app: ctx.app, files, style, team }) });
  const summary = { rounds: 0, changed: [] };

  // ---------- 1. Planer (nur bei echten Nutzer-Bitten) ----------
  let plan = null;
  const last = history[history.length - 1]?.content || '';
  const fromUser = ctx.trigger === 'user';
  const tiny = last.length < 50 && !looksFresh(files);
  if (fromUser && !tiny && ctx.mode !== 'single') {
    const planner = add({ id: 'plan', role: 'planner', title: 'Planer', detail: 'versteht die Aufgabe und verteilt sie' });
    set(planner, { status: 'run' }); run.thinkStep({ h: 'Planer teilt die Aufgabe auf …', v: '' });
    try {
      const txt = await generate('pro', [{ role: 'system', content: PLANNER }, { role: 'user', content: planInput(ctx, history) }], { ...common, maxTokens: 2500, effort: 'low' });
      plan = parsePlan(txt, files);
    } catch (e) { if (run.signal.aborted) throw e; }
    if (plan && ctx.mode === 'team' && plan.mode === 'single' && plan.tasks.length) plan.mode = 'single';
    set(planner, { status: plan ? 'done' : 'error', detail: plan ? (plan.mode === 'team' ? `Team aus ${plan.tasks.length} Agenten: ${plan.summary}` : plan.mode === 'answer' ? 'nur eine Frage – keine Änderung nötig' : plan.summary || 'ein Agent reicht') : 'ohne Plan weiter (ein Agent)' });
  }
  if (!plan) plan = { mode: 'single', tasks: [], summary: '', contract: '', next: '' };

  // ---------- 2. Bauen ----------
  let round = await (plan.mode === 'team' ? teamRound() : singleRound(plan.mode === 'answer' ? 'Antwort' : 'Coder', plan.mode === 'answer' ? 'beantwortet die Frage' : (plan.summary || 'baut die Änderung')));

  // ---------- 3./4. Prüfen, beheben, Bilder ----------
  let reviewed = false;
  for (let fix = 0, img = 0; ;) {
    if (run.signal.aborted || timeLeft() < 25_000) break;
    if (round.waits) break; // wartet auf den Nutzer (Datenbank, Rückfrage, Schlüssel)
    const imgs = round.tools.filter(t => t.name === 'image' && t.prompt).slice(0, 3);
    if (imgs.length && img < 2) {
      img++;
      const painter = add({ id: 'img' + img, role: 'designer', title: 'Bild-Agent', detail: `erstellt ${imgs.length} Bild${imgs.length > 1 ? 'er' : ''}` }); set(painter, { status: 'run' });
      const out = await Promise.all(imgs.map(async (t) => { try { return { id: t.id || 'bild', url: await ctx.image(t.prompt) }; } catch (e) { return { id: t.id || 'bild', error: e.message }; } }));
      const ok = out.filter(o => o.url);
      set(painter, { status: ok.length ? 'done' : 'error', detail: ok.length ? `${ok.length} Bild${ok.length > 1 ? 'er' : ''} fertig` : 'Bilder gehen gerade nicht' });
      const msg = `[Bilder] ${out.map(o => o.url ? `- ${o.id}: ${o.url}` : `- ${o.id}: FEHLGESCHLAGEN (${o.error})`).join('\n')}\n${ok.length ? 'Baue die Bilder jetzt mit diesen URLs ein (<img src="…" alt="…">).' : 'Bilder gehen gerade nicht – nimm Unsplash-Bilder, SVGs oder Emojis und erwähne es kurz.'}`;
      await toolMessage(msg, ok.length ? `${ok.length} Bild${ok.length > 1 ? 'er' : ''} erstellt` : 'Bilder konnten nicht erstellt werden');
      round = await singleRound('Coder', 'baut die Bilder ein'); continue;
    }
    if (!round.changed.length && !round.problems.length && (plan.mode !== 'team' || reviewed)) break;
    let issues = round.problems.slice();
    if (round.changed.length) issues = issues.concat(Agent.check(files, { syntax }));
    if (plan.mode === 'team' && !reviewed && !issues.length && timeLeft() > 70_000) { reviewed = true; issues = issues.concat(await reviewTeam()); }
    issues = [...new Set(issues)].slice(0, 10);
    if (!issues.length || fix >= MAX_FIX) { if (issues.length) summary.open = issues.length; break; }
    fix++;
    await toolMessage(`[Automatische Prüfung] Nach deiner letzten Antwort gibt es diese Probleme:\n${issues.map(i => '- ' + i).join('\n')}\nBehebe sie jetzt (nur die nötigen Änderungen).`, `Prüfer: ${issues.length} Problem${issues.length > 1 ? 'e' : ''} gefunden – wird behoben …`);
    round = await singleRound('Fixer', `behebt ${issues.length} Problem${issues.length > 1 ? 'e' : ''}`, 'fixer');
  }
  run.setExtra({ done: true, rounds: summary.rounds, open: summary.open || 0 });
  return { files, summary };

  // ---------- Bausteine ----------
  async function toolMessage(body, display) {
    await ctx.post('tool', body, { display, auto: true });
    history.push({ role: 'user', content: body });
    history = mergeRoles(history);
  }
  async function finishRound(text, meta) {
    summary.rounds++;
    const p = Agent.parse(text); const res = Agent.apply(files, p.ops);
    if (Object.keys(res.set).length || res.remove.length) { files = await ctx.save(res.set, res.remove); summary.changed.push(...res.changed.map(c => c.path)); }
    const reply = withReply(text, p);
    const m = { changed: res.changed, model: run.model || undefined, problems: res.problems.length || undefined, auto: meta.auto || undefined, agents: meta.agents };
    await ctx.post('assistant', Agent.condense(reply) || '…', m);
    history.push({ role: 'assistant', content: Agent.condense(reply) }); history = mergeRoles(history);
    run.setExtra({ round: summary.rounds });
    return { changed: res.changed, problems: res.problems, tools: p.tools, waits: p.tools.some(t => ['database', 'ask', 'secret'].includes(t.name)), team: !!meta.team };
  }
  // Ein Agent schreibt die Antwort; der Text kommt live beim Nutzer an
  async function singleRound(title, detail, role = 'coder') {
    const a = add({ id: role + (summary.rounds + 1), role, title, detail }); set(a, { status: 'run' });
    run.setText('');
    let text = '';
    try {
      await generateStream(ctx.tier, [sys(), ...history], { ...common, maxTokens: 16000, onModel: (m) => run.setModel(m), onThink: (k) => run.thinkStep(k), onDelta: (v) => { text += v; run.delta(v); if (text.length % 2000 < v.length) set(a, { detail: progress(text) || detail }); } });
    } catch (e) { if (!text.trim()) { set(a, { status: 'error', detail: e.message.slice(0, 120) }); throw e; } }
    const r = await finishRound(text, { auto: role === 'fixer', agents: brief() });
    set(a, { status: 'done', detail: r.changed.length ? r.changed.map(c => c.path).slice(0, 4).join(', ') : (role === 'fixer' ? 'keine Änderung nötig' : 'geantwortet') });
    return r;
  }
  // Mehrere Sub-Agenten bauen gleichzeitig je ihre eigenen Dateien
  async function teamRound() {
    const coders = plan.tasks.map((t, i) => add({ id: 'coder' + (i + 1), role: 'coder', title: `Coder ${i + 1}: ${t.title}`, detail: t.files.join(', ') }));
    const header = () => `${plan.summary || 'Das Coden-Team baut deine App.'}\n\n<plan>\n${plan.tasks.map((t, i) => `- [${coders[i].status === 'done' ? 'x' : ' '}] ${t.title} (${t.files.join(', ')})`).join('\n')}\n</plan>`;
    run.setText(header());
    const owner = new Map(); plan.tasks.forEach((t, i) => t.files.forEach(f => owner.set(f, i)));
    const outs = new Array(plan.tasks.length).fill('');
    const queue = plan.tasks.map((t, i) => i);
    const worker = async () => {
      for (let i; (i = queue.shift()) !== undefined;) {
        if (run.signal.aborted) return;
        const t = plan.tasks[i]; set(coders[i], { status: 'run', detail: 'startet …' });
        const team = { role: `Coder ${i + 1} von ${plan.tasks.length}`, summary: plan.summary, contract: plan.contract, tasks: plan.tasks, task: t };
        const only = history.slice(-4);
        try {
          await generateStream(ctx.tier, [sys(team), ...(only[0]?.role === 'user' ? only : history.slice(-1))], { ...common, maxTokens: 16000, onModel: (m) => run.setModel(m), onDelta: (v) => { outs[i] += v; if (outs[i].length % 1500 < v.length) set(coders[i], { detail: progress(outs[i]) || 'schreibt …' }); } });
          const p = Agent.parse(outs[i]); const mine = p.ops.filter(o => owner.get(o.path) === i); // nur die eigenen Dateien (sonst überschreiben sich Agenten gegenseitig)
          outs[i] = rebuild(outs[i], mine);
          set(coders[i], { status: mine.length ? 'done' : 'error', detail: mine.length ? `${mine.length} Datei${mine.length > 1 ? 'en' : ''}: ${mine.map(o => o.path).join(', ')}` : 'hat keine Datei geliefert' });
        } catch (e) { if (run.signal.aborted) return; set(coders[i], { status: 'error', detail: e.message.slice(0, 120) }); }
        run.setText(header());
      }
    };
    await Promise.all(Array.from({ length: Math.min(TEAM_PARALLEL, queue.length) }, worker));
    if (run.signal.aborted) throw new Error('abgebrochen');
    // Fehlt ein Teil (Agent ausgefallen)? Dann übernimmt ein Agent die liegengebliebenen Dateien
    const missing = plan.tasks.filter((t, i) => coders[i].status === 'error');
    const body = outs.filter(Boolean).join('\n\n');
    const done = plan.tasks.filter((t, i) => coders[i].status === 'done');
    const text = `${header()}\n\n${body}\n\n**${missing.length ? 'Fast fertig' : 'Fertig'}!** Das Coden-Team hat ${done.length} von ${plan.tasks.length} Aufgaben erledigt:\n${plan.tasks.map((t, i) => `- ${coders[i].status === 'done' ? '✅' : '⚠️'} ${t.title}`).join('\n')}\n\n${plan.next ? 'Nächster Schritt: ' + plan.next : 'Schau dir die Vorschau an und sag mir, was ich verbessern soll.'}`;
    const r = await finishRound(text, { team: true, agents: brief() });
    if (missing.length && timeLeft() > 60_000) {
      await toolMessage(`[Team] Diese Aufgaben sind ausgefallen und müssen noch erledigt werden:\n${missing.map(t => `- ${t.title}: ${t.files.join(', ')} – ${t.goal}`).join('\n')}\nVertrag: ${plan.contract}\nSchreibe die fehlenden Dateien jetzt vollständig.`, `${missing.length} Aufgabe${missing.length > 1 ? 'n' : ''} werden nachgeholt …`);
      return singleRound('Ersatz-Coder', 'holt die ausgefallenen Aufgaben nach');
    }
    return r;
  }
  // KI-Prüfer: passen die parallel geschriebenen Teile zusammen?
  async function reviewTeam() {
    const rv = add({ id: 'review', role: 'reviewer', title: 'Prüfer', detail: 'prüft, ob alle Teile zusammenpassen' }); set(rv, { status: 'run' });
    const listing = Object.keys(files).sort().map(n => `=== ${n} ===\n${String(files[n]).slice(0, 14000)}`).join('\n\n').slice(0, 60000);
    try {
      const txt = await generate('pro', [{ role: 'system', content: 'Du bist der Prüfer im Coden-Team. Mehrere Agenten haben parallel Dateien einer Web-App geschrieben. Finde NUR echte Fehler, durch die etwas nicht funktioniert: IDs/Klassen, die in HTML und JS nicht übereinstimmen, aufgerufene Funktionen/Variablen, die nirgends definiert sind, falsche Script-Reihenfolge, fehlende Dateien, offensichtliche Logikfehler (z. B. Knopf ohne Funktion). Keine Stil-Wünsche. Antworte NUR mit JSON: {"issues":["konkreter Fehler mit Datei und Name", …]} (leere Liste, wenn alles passt, höchstens 6).' }, { role: 'user', content: listing }], { ...common, maxTokens: 1500, effort: 'low' });
      const m = String(txt).match(/\{[\s\S]*\}/); const list = m ? (JSON.parse(m[0]).issues || []).map(x => String(x).slice(0, 300)).filter(Boolean).slice(0, 6) : [];
      set(rv, { status: 'done', detail: list.length ? `${list.length} Problem${list.length > 1 ? 'e' : ''} gefunden` : 'alles passt zusammen' });
      return list;
    } catch (e) { if (run.signal.aborted) throw e; set(rv, { status: 'done', detail: 'Prüfung übersprungen' }); return []; }
  }
  function brief() { return agents.map(a => ({ title: a.title, status: a.status })).slice(0, 10); }
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
  const names = [...new Set(p.ops.map(o => o.path))]; const list = names.slice(0, 4).join(', ') + (names.length > 4 ? ` und ${names.length - 4} weitere` : '');
  return text.replace(/\s+$/, '') + `\n\nFertig – ich habe ${list} ${p.ops.some(o => o.type === 'file') ? 'geschrieben bzw. angepasst' : 'angepasst'}. Schau dir die Vorschau an und sag mir, was ich noch ändern soll.`;
}

module.exports = { runAppAgent, historyFrom, parsePlan, _progress: progress };
