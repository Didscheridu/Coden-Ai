// Coden-Agenten für den App-Builder. Läuft komplett auf dem Server (Hintergrund-Lauf), baut also weiter,
// auch wenn die Seite zu ist. Aufbau wie bei Claude Code / Codex / Gemini CLI:
//   MAIN AGENT – mit ihm spricht der Nutzer. Er arbeitet in Schritten (denken → Code schreiben und/oder Werkzeuge
//                benutzen → Ergebnisse lesen → weiter) mit list/read/search/check/fetch/web_search/memory/image.
//   SUB-AGENTEN – startet der Main Agent mit spawn: Spezial-Agenten mit Kit und eigenem Modell (je nach Schwierigkeit),
//                parallel, jeder nur an seinen Dateien. Danach integriert und prüft der Main Agent.
//   Automatische Prüfung (Syntax, fehlende Dateien/Elemente) nach Änderungen – Fehler gehen zurück an den Main Agent.
const vm = require('vm');
const Agent = require('../shared/agent-core');
const { generateStream } = require('./ai');
const { Meter } = require('./usage');
const Push = require('./push');

const MAX_FIX = 2, MAX_TEAM = 5, TEAM_PARALLEL = 3, HISTORY = 18;

// Modell je nach Schwierigkeit: leicht -> Flash (schnell), mittel -> das gewählte Modell, schwer -> das stärkste erlaubte
const RANK = { flash: 1, normal: 2, pro: 3, ultra: 4 };
const TIER_NAME = { flash: 'Flash', normal: 'Thinking', pro: 'Pro', ultra: 'Ultra' };
function tierFor(level, chosen, allowUltra) {
  const strongest = allowUltra ? 'ultra' : 'pro';
  if (level === 'easy') return 'flash';
  if (level === 'hard') return RANK[chosen] > RANK[strongest] ? chosen : strongest;
  return chosen;
}
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

const MAX_STEPS = 40, MAX_SPAWNS = 3, MAX_TOOLS_PER_STEP = 6, MAX_IMG_ROUNDS = 2;
const Tools = require('./agent-tools');
const WAIT_TOOLS = ['database', 'ask', 'secret'];
const escAttr = (s) => String(s).replace(/[<>"&\n]/g, (c) => ({ '<': '‹', '>': '›', '"': '“', '&': '+', '\n': ' ' }[c]));
const TOOL_VERB = { list: 'listet Dateien', read: 'liest', search: 'sucht', check: 'prüft die App', fetch: 'liest eine Webseite', web_search: 'sucht im Web', memory: 'merkt sich etwas', spawn: 'startet Sub-Agenten', image: 'erstellt Bilder' };

// ---------- Etappen: ein Lauf darf auf Vercel höchstens 300 s dauern. Für große Aufgaben speichert der Agent
// seinen Stand und startet sich selbst in einer neuen Server-Ausführung neu (bis MAX_LEGS, insgesamt MAX_TOTAL_STEPS).
const LEG_START_MS = 160_000;   // danach keinen neuen Schritt mehr in dieser Etappe beginnen
const legStart = () => Number(process.env.CODEN_LEG_START_MS) || LEG_START_MS;
const legSteps = () => Number(process.env.CODEN_LEG_STEPS) || Infinity; // nur für Tests: Schritte pro Etappe
const LEG_HARD_MS = 262_000;    // spätestens dann wird ein laufender Schritt abgebrochen (und in der nächsten Etappe wiederholt)
const MAX_LEGS = 10, MAX_TOTAL_STEPS = 40, MAX_NUDGES = 3;
const HEAVY = ['spawn', 'image', 'fetch', 'web_search'];
// Hat das Modell nur angekündigt, statt zu handeln? (häufigster Grund, warum Agenten "einfach aufhören")
const INTENT = /\b(let me|i will|i'll|i'm going to|i am going to|now i|next,? i|i need to|lass mich|ich werde|ich muss|ich (mache|baue|schreibe|füge|behebe|ändere|prüfe|repariere|ergänze|passe|verschiebe|kümmere)[^.!?\n]{0,30}\b(jetzt|nun|als nächstes|gleich|noch)|jetzt (behebe|baue|schreibe|füge|ändere|prüfe|repariere|ergänze|kümmere|passe)|als nächstes|im nächsten schritt)\b/i;
const tailText = (p) => { let k = -1; p.segs.forEach((x, i) => { if (x.kind !== 'text') k = i; }); return p.segs.slice(k + 1).filter(x => x.kind === 'text').map(x => x.text).join(' ').trim().slice(-500); };
const isQuestion = (w) => /\?\s*$/.test(w.trim()) && w.length < 400 && !/\b(bau|mach|füg|änder|erstell|fix|behebe|reparier|programmier|schreib|ergänz|verbesser|add|build|make|create)/i.test(w);

async function runAppAgent(run, ctx) {
  const t0 = Date.now(); const elapsed = () => Date.now() - t0; const timeLeft = () => LEG_HARD_MS - elapsed();
  const S = ctx.state || {};                       // Stand aus der vorigen Etappe (oder leer beim Start)
  const leg = (S.leg || 0) + 1;
  const agents = S.agents || [];
  const push = () => run.setAgents(agents.map(a => ({ id: a.id, role: a.role, title: a.title, status: a.status, detail: a.detail, tier: a.tier ? TIER_NAME[a.tier] : undefined, kit: a.kit, level: a.level, parent: a.parent })));
  const add = (o) => { const a = { status: 'wait', detail: '', ...o }; agents.push(a); push(); return a; };
  const set = (a, patch) => { Object.assign(a, patch); push(); };
  const style = ctx.style; let files = { ...ctx.files }; const history = ctx.history.slice();
  const legAc = new AbortController(); const legTimer = setTimeout(() => legAc.abort(), LEG_HARD_MS);
  const signal = AbortSignal.any ? AbortSignal.any([run.signal, legAc.signal]) : run.signal;
  const meter = new Meter({ uid: ctx.uid, email: ctx.email, isOwner: ctx.isOwner }, ctx.tier); // Nutzungslimit
  const common = { isOwner: ctx.isOwner, signal, effort: ctx.effort, meter };
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
  const runTools = async (auto) => {
    for (const t of auto.filter(x => x.name !== 'image')) {
      if (signal.aborted) break;
      set(main, { detail: `${TOOL_VERB[t.name] || t.name} ${t.attrs.path || t.attrs.query || t.attrs.url || ''}`.trim() });
      results.push({ name: t.name, ...(await execTool(t)) });
    }
    const imgs = auto.filter(t => t.name === 'image'); if (imgs.length && !signal.aborted) results.push({ name: 'image', ...(await images(imgs)) });
  };
  if (leg > 1) emit(`\n\n<result name="leg" ok="1">Etappe ${leg} – Coden arbeitet weiter</result>`);

  try {
    // Werkzeuge, die am Ende der letzten Etappe keine Zeit mehr hatten (z. B. spawn), zuerst ausführen
    if (pending?.length) {
      const tools = pending.map(t => ({ ...t, attrs: t.attrs || {} })); pending = null;
      await runTools(tools); flushResults();
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
      const auto = p.tools.filter(t => Agent.AUTO_TOOLS.includes(t.name)).slice(0, MAX_TOOLS_PER_STEP);
      if (auto.some(t => HEAVY.includes(t.name)) && timeLeft() < 120_000 && leg < MAX_LEGS) { flushResults(); return await nextLeg(auto); }
      await runTools(auto);
      if (waits) break;

      // 3) Fertig? Nur wenn nichts mehr offen ist – sonst nachhaken, prüfen, abnehmen
      const isDone = p.tools.some(t => t.name === 'done');
      if (!results.length) {
        const tail = tailText(p);
        const announced = !p.ops.length && (INTENT.test(tail) || /:\s*$/.test(tail));
        const nothingBuilt = !changed.size && !p.ops.length && !isQuestion(wish) && ctx.trigger === 'user' && !spawns;
        if (!isDone && nudges < MAX_NUDGES && (announced || nothingBuilt)) {
          nudges++;
          results.push({ name: 'nudge', ok: false, summary: 'Coden setzt die Ankündigung jetzt um', text: announced
            ? '[System] Du hast nur angekündigt, was du tun willst, aber keine Änderung ausgegeben. Gib JETZT die vollständigen <file>- oder <edit>-Blöcke dafür aus (oder benutze ein Werkzeug) – ohne erneute Ankündigung.'
            : '[System] Der Nutzer möchte, dass du etwas baust oder änderst, aber es wurde noch keine Datei geändert. Setze es jetzt vollständig um (<file>/<edit>' + (spawnAllowed ? ' oder spawn' : '') + ').' });
        } else if (dirtySinceCheck && fixes < MAX_FIX) {
          const c = Tools.check(files); dirtySinceCheck = false;
          if (c.issues.length) { fixes++; results.push({ name: 'check', ok: false, summary: c.summary + ' – Main Agent behebt sie', text: `[Automatische Prüfung] ${c.text}\nBehebe diese Probleme jetzt selbst.` }); }
        }
        // Abnahme: einmal pro Auftrag die Bitte Punkt für Punkt gegen den Code prüfen lassen
        if (!results.length && !reviewed && changed.size && (spawns || changed.size >= 2 || stepsTotal >= 3) && stepsTotal < MAX_TOTAL_STEPS - 1) {
          reviewed = true;
          results.push({ name: 'review', ok: true, summary: 'Abnahme: prüft deine Bitte Punkt für Punkt', text: `[Abnahme] Bevor du fertig bist: Geh die Bitte des Nutzers Punkt für Punkt durch und prüfe jeden Punkt gegen den AKTUELLEN Code oben (nicht gegen deine Erinnerung). Denk auch an: Startet die App ohne Fehler? Hat jeder Knopf eine Funktion? Funktioniert es auf dem Handy (Touch)? Schreibe eine kurze Liste mit ✅/❌.\nBei ❌: behebe es SOFORT in diesem Schritt mit <file>/<edit>. Wenn alles ✅ ist: kurze Abschlussnachricht auf Deutsch und <tool name="done"/>.\n\nBitte des Nutzers:\n${wish.slice(0, 3000)}` });
        }
        if (!results.length) { finished = true; break; }
      }
      flushResults(isDone ? '\n\nDu hattest "done" gesagt, aber es gibt noch offene Punkte – erledige sie und schließe dann ab.' : '');
    }
  } finally { clearTimeout(legTimer); await meter.close(); }

  set(main, { status: 'done', detail: `${stepsTotal} Schritt${stepsTotal !== 1 ? 'e' : ''}${leg > 1 ? ' · ' + leg + ' Etappen' : ''}${changed.size ? ' · ' + changed.size + ' Datei' + (changed.size > 1 ? 'en' : '') : ''}${spawns ? ' · ' + agents.filter(a => a.parent && a.role === 'coder').length + ' Sub-Agenten' : ''}` });
  return finish();

  async function finish() {
    // Eine Nachricht für den ganzen Auftrag (Dateiinhalte gekürzt, Werkzeug-Ergebnisse bleiben als kurze Zeilen)
    const reply = withReply(out.text, Agent.parse(out.text));
    if (reply !== out.text) { const suffix = reply.slice(out.text.replace(/\s+$/, '').length); if (suffix.trim()) emit(suffix); }
    await ctx.post('assistant', Agent.condense(out.text) || '…', { changed: [...changed.values()], model: run.model || undefined, agents: agents.map(a => ({ title: a.title, status: a.status, tier: a.tier ? TIER_NAME[a.tier] : undefined })).slice(0, 14), steps: stepsTotal, legs: leg });
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
    const state = { leg, agents: agents.map(a => ({ ...a })), steps: keepSteps, changed: [...changed.entries()], dirty: dirtySinceCheck, fixes, spawns, imgRounds, stepsTotal, nudges, reviewed,
      pending: deferred ? deferred.map(t => ({ name: t.name, attrs: t.attrs, body: t.body, id: t.id, prompt: t.prompt })) : null };
    const ok = await ctx.continueLeg(state).catch((e) => { console.warn('[agent] Etappe konnte nicht starten:', e.message); return false; });
    if (!ok) { ctx.continueLeg = null; return nextLeg(deferred); }
    return { continued: true };
  }

  // ---------- Werkzeuge ----------
  async function execTool(t) {
    const a = t.attrs;
    switch (t.name) {
      case 'list': return Tools.list(files, a.pattern);
      case 'read': return Tools.read(files, a.path || a.file, a.start, a.end);
      case 'search': return Tools.search(files, a.query || t.body, a.regex);
      case 'check': { dirtySinceCheck = false; return Tools.check(files); }
      case 'fetch': return Tools.fetchUrl(a.url || t.body);
      case 'web_search': return Tools.webSearch(a.query || t.body);
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
  async function spawn(body) {
    if (!spawnAllowed) return { ok: false, summary: 'Solo-Modus: keine Sub-Agenten', text: 'Im Solo-Modus gibt es keine Sub-Agenten – erledige die Aufgabe selbst.' };
    if (spawns >= MAX_SPAWNS) return { ok: false, summary: 'Sub-Agenten-Limit erreicht', text: `Höchstens ${MAX_SPAWNS} spawn-Aufrufe pro Lauf – mach den Rest selbst.` };
    if (timeLeft() < 90_000) return { ok: false, summary: 'zu wenig Zeit für Sub-Agenten', text: 'Für Sub-Agenten reicht die Zeit in diesem Lauf nicht mehr – mach es selbst oder kleiner.' };
    const plan = parsePlan(body, files);
    if (!plan || !plan.tasks.length) return { ok: false, summary: 'ungültiger spawn-Auftrag', text: 'spawn braucht gültiges JSON: {"contract":"…","tasks":[{"title":"…","agent":"logic","level":"mittel","files":["app.js"],"goal":"…"}]} – jede Datei nur in einer Aufgabe.' };
    spawns++;
    const n = spawns; const tasks = plan.tasks;
    tasks.forEach(t => { t.tier = tierFor(t.level, ctx.tier, ctx.allowUltra); });
    const subs = tasks.map((t, i) => { const k = Agent.kitFor(t.agent); return add({ id: `sub${n}-${i + 1}`, role: 'coder', parent: 'main', kit: t.agent, tier: t.tier, level: t.level, title: `${k ? k.emoji + ' ' + k.name : 'Sub-Agent ' + (i + 1)}: ${t.title}`, detail: t.files.join(', ') }); });
    set(main, { detail: `wartet auf ${tasks.length} Sub-Agenten …` });
    const owner = new Map(); tasks.forEach((t, i) => t.files.forEach(f => owner.set(f, i)));
    const outs = new Array(tasks.length).fill(''); const notes = new Array(tasks.length).fill('');
    const queue = tasks.map((t, i) => i);
    const lastUser = [...history].reverse().find(m => m.role === 'user');
    const brief = { role: 'user', content: `${lastUser ? 'Wunsch des Nutzers: ' + lastUser.content.slice(0, 4000) + '\n\n' : ''}Auftrag vom Main Agent: ${plan.summary || 'siehe Aufgaben'}. Erledige jetzt DEINE Aufgabe.` };
    const worker = async () => {
      for (let i; (i = queue.shift()) !== undefined;) {
        if (run.signal.aborted) return;
        const t = tasks[i]; set(subs[i], { status: 'run', detail: 'startet …' });
        const team = { role: `${Agent.kitFor(t.agent)?.name || 'Sub-Agent'} (Sub-Agent ${i + 1} von ${tasks.length}, beauftragt vom Main Agent)`, summary: plan.summary || 'Auftrag vom Main Agent', contract: plan.contract, tasks, task: t };
        try {
          await generateStream(t.tier, [sys(team), brief], { ...common, meter: meter.child(t.tier), maxTokens: 16000, onDelta: (v) => { outs[i] += v; if (outs[i].length % 1500 < v.length) set(subs[i], { detail: progress(outs[i]) || 'schreibt …' }); } });
          const pp = Agent.parse(outs[i]); const mine = pp.ops.filter(o => owner.get(o.path) === i);
          const foreign = pp.ops.filter(o => owner.get(o.path) !== i).map(o => o.path);
          notes[i] = pp.segs.filter(x => x.kind === 'text').map(x => x.text).join(' ').replace(/\s+/g, ' ').trim().slice(0, 300) + (foreign.length ? ` (fremde Dateien verworfen: ${foreign.join(', ')})` : '');
          outs[i] = mine;
          set(subs[i], { status: mine.length ? 'done' : 'error', detail: mine.length ? `${mine.length} Datei${mine.length > 1 ? 'en' : ''}: ${mine.map(o => o.path).join(', ')}` : 'hat keine Datei geliefert' });
        } catch (e) { outs[i] = []; if (run.signal.aborted) return; notes[i] = 'Fehler: ' + e.message; set(subs[i], { status: 'error', detail: e.message.slice(0, 120) }); }
      }
    };
    await Promise.all(Array.from({ length: Math.min(TEAM_PARALLEL, queue.length) }, worker));
    const ops = outs.flat().filter(Boolean);
    const r = Agent.apply(files, ops);
    if (Object.keys(r.set).length || r.remove.length) { files = await ctx.save(r.set, r.remove); r.changed.forEach(c => changed.set(c.path, c)); dirtySinceCheck = true; }
    const c = Tools.check(files); dirtySinceCheck = false;
    set(main, { detail: 'prüft die Ergebnisse der Sub-Agenten' });
    const okN = subs.filter(x => x.status === 'done').length;
    const report = tasks.map((t, i) => `${subs[i].status === 'done' ? '✅' : '⚠️'} ${subs[i].title} [${TIER_NAME[t.tier]}] → ${(Array.isArray(outs[i]) ? outs[i].map(o => o.path).join(', ') : '') || 'nichts geliefert'}${notes[i] ? '\n   Notiz: ' + notes[i] : ''}`).join('\n');
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
  const names = [...new Set(p.ops.map(o => o.path))]; const list = names.slice(0, 4).join(', ') + (names.length > 4 ? ` und ${names.length - 4} weitere` : '');
  return text.replace(/\s+$/, '') + `\n\nFertig – ich habe ${list} ${p.ops.some(o => o.type === 'file') ? 'geschrieben bzw. angepasst' : 'angepasst'}. Schau dir die Vorschau an und sag mir, was ich noch ändern soll.`;
}

module.exports = { runAppAgent, historyFrom, parsePlan, tierFor, defaultTeam, MAX_STEPS, _progress: progress };
