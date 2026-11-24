// Kontingent, Kaskaden-Reihenfolge, Streaming. Anbieter werden mit einem Fake-fetch simuliert, die Datenbank ist Firestore (In-Memory).
const { setup } = require('./helpers');
const enc = new TextEncoder();
const sseResponse = (chunks, { failAfter } = {}) => new Response(new ReadableStream({
  async start(c) { let i = 0; for (const ch of chunks) { if (failAfter !== undefined && i++ >= failAfter) { c.error(new Error('Verbindung weg')); return; } c.enqueue(enc.encode(ch)); await new Promise(r => setTimeout(r, 1)); } c.close(); }
}), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
const oa = (t) => `data: ${JSON.stringify({ choices: [{ delta: { content: t } }] })}\n\n`;
const gem = (t) => `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: t }] } }] })}\n\n`;

(async () => {
  const { db, chk, finish } = await setup({ withApp: false });
  Object.assign(process.env, { GROQ_API_KEY: 'x', OPENROUTER_API_KEY: 'x', GOOGLE_API_KEY: 'x' });
  const ai = require('../server/ai');
  // Künstliche knappe Modelle, um das Tageslimit-System weiter zu prüfen (echte Modelle haben aktuell kein Limit)
  ai.QUOTAS['gemini-quota-a'] = { total: 20, publicMax: 10 }; ai.QUOTAS['gemini-quota-b'] = { total: 20, publicMax: 10 };
  ai.CASCADES.pro.push({ provider: 'google', id: 'gemini-quota-a' }); ai.CASCADES.normal.push({ provider: 'google', id: 'gemini-quota-b' });
  const log = []; let mode = 'googleOnly'; let lastBody = null; const calls = [];
  global.fetch = async (url, o) => {
    const body = JSON.parse(o?.body || '{}'); const isGoogle = url.includes('googleapis'); const model = isGoogle ? url.split('/models/')[1].split(':')[0] : body.model;
    log.push(model);
    if (mode === 'googleOnly') {
      if (!isGoogle) return new Response(JSON.stringify({ error: { message: 'down' } }), { status: 500 });
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Antwort von ' + model }] } }] }), { status: 200 });
    }
    if (mode === 'groqWorks') return new Response(JSON.stringify({ choices: [{ message: { content: 'Groq ok' } }] }), { status: 200 });
    if (mode === 'streamLength') {
      if (isGoogle) return new Response('{}', { status: 500 });
      lastBody = body; calls.push(body);
      const cont = JSON.stringify(body.messages).includes('abgeschnitten');
      const fin = (r) => `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: r }] })}\n\n`;
      return cont ? sseResponse([oa('Teil2'), fin('stop'), 'data: [DONE]\n\n']) : sseResponse([oa('Teil1 '), fin('length'), 'data: [DONE]\n\n']);
    }
    if (mode === 'effort') { lastBody = body; return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 }); }
    if (mode === 'streamThink') return sseResponse([oa('Hal'), oa('lo <thi'), oa('nk>geheim</th'), oa('ink>Welt'), 'data: [DONE]\n\n']);
    if (mode === 'streamFallback') { if (body.model === 'openai/gpt-oss-120b') return new Response('{}', { status: 500 }); if (body.model === 'openai/gpt-oss-20b') return sseResponse([': ping\n\n', 'data: [DONE]\n\n']); return sseResponse([oa('Zweites Modell')]); }
    if (mode === 'streamReason') return sseResponse([`data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: '**Frage lesen**\nIch lese. ' } }] })}\n\n`, `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: '\n**Antwort planen**\nJetzt plane ich.' } }] })}\n\n`, oa('Fertig'), 'data: [DONE]\n\n']);
    if (mode === 'streamMidError') return sseResponse([oa('Teil1 '), oa('Teil2'), oa('Teil3')], { failAfter: 2 });
    if (mode === 'streamGoogle') return sseResponse([gem('Ge'), gem('mini')]);
  };
  const pacificDay = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  const qKey = (m) => `model_quota/${String(m).replace(/[^a-zA-Z0-9_-]/g, '_')}__${pacificDay()}`;
  const counts = async (m) => { const d = await db.getDoc(qKey(m)); return d ? { total: d.total, public: d.public } : { total: 0, public: 0 }; };

  // --- Reihenfolge ---
  const last = (t) => ai.CASCADES[t][ai.CASCADES[t].length - 1].id;
  chk('pro: Gemini 4 Hydrogen ist ganz hinten', last('pro'), 'gemini-quota-a');
  chk('normal: Gemini 3.8 Flash ist ganz hinten', last('normal'), 'gemini-quota-b');
  chk('flash enthält keine knappen Modelle', ai.CASCADES.flash.some(m => ai.QUOTAS[m.id]), false);
  chk('pro: Gemini nirgends sonst', ai.CASCADES.pro.filter(m => m.id === 'gemini-quota-a').length, 1);
  chk('alle 7 OpenRouter-Gratismodelle in "pro"', ai.CASCADES.pro.filter(m => m.provider === 'openrouter').length, 7);

  chk('NVIDIA NIM ist als Anbieter entfernt', [Object.values(ai.CASCADES).some(c => c.some(m => m.provider === 'nvidia')), ai.listModels().some(m => m.provider === 'nvidia')], [false, false]);

  // --- Coden Ultra ---
  chk('Ultra: Nemotron 3.5 Super VL und Qwen 3.8 vorn', ai.CASCADES.ultra.slice(0, 2).map(m => m.id).join(), 'nvidia/nemotron-3.5-super-vl:free,qwen/qwen3.8-27b');
  chk('Pro: Nemotron 3 Ultra zuerst, kein Modell doppelt', `${ai.CASCADES.pro[0].id} ${new Set(ai.CASCADES.pro.map(m => m.id)).size === ai.CASCADES.pro.length}`, 'nvidia/nemotron-3-ultra-550b-a55b:free true');
    chk('Ultra: nur starke Modelle (keine kleinen Flash/Lite)', ai.CASCADES.ultra.some(m => /lite|lightning|1\.7b|(?<!\d)20b/i.test(m.id)), false);

  // --- /modelle: gezielt ein Modell wählen ---
  const lm = ai.listModels();
  chk('Modellliste: eindeutig, enthält Groq + OpenRouter + Google', [new Set(lm.map(m => m.key)).size === lm.length, ['groq', 'openrouter', 'google'].every(p => lm.some(m => m.provider === p))], [true, true]);
  chk('Modellliste: Modelle mit Tageslimit sind markiert', lm.find(m => m.id === 'gemini-quota-a')?.limited, true);
  const REMOVED = ['gemini-4-hydrogen', 'gemini-3.8-flash', 'llama-3.3-70b-versatile', 'inclusionai/ling-3.2-flash:free', 'google/gemma-4-31b-it:free', 'recursive/flint-v1.0:free', 'liquid/lfm-3-1.7b:free'];
  chk('Fehlerhafte Modelle sind aus allen Stufen entfernt', Object.values(ai.CASCADES).some(c => c.some(m => REMOVED.includes(m.id))), false);
  mode = 'groqWorks'; log.length = 0;
  const pr = await ai.generate('flash', [{ role: 'user', content: 'hi' }], { pin: 'groq:openai/gpt-oss-20b' });
  chk('Pin: genau dieses Modell wird gefragt', [pr, log.join()], ['Groq ok', 'openai/gpt-oss-20b']);
  let pe; try { await ai.generate('pro', [{ role: 'user', content: 'hi' }], { pin: 'groq:gibt-es-nicht' }); } catch (e) { pe = e.status; }
  chk('Pin: unbekanntes Modell → 400', pe, 400);
  mode = 'streamFallback'; log.length = 0; let fe; try { await ai.generate('pro', [{ role: 'user', content: 'hi' }], { pin: 'groq:openai/gpt-oss-120b' }); } catch (e) { fe = e.message; }
  chk('Pin: fällt das Modell aus, wird NICHT auf andere ausgewichen', [!!fe, log.join()], [true, 'openai/gpt-oss-120b']);

  mode = 'googleOnly'; let ke; try { await ai.generate('pro', [{ role: 'user', content: 'hi' }], { pin: 'groq:openai/gpt-oss-120b' }); } catch (e) { ke = e.message; }
  chk('Pin: Fehlermeldung nennt Modell', /gpt-oss-120b \(Groq\): down/.test(ke || ''), true);
  // --- Wenn andere Modelle funktionieren, wird Gemini nie angefasst ---
  mode = 'groqWorks'; log.length = 0;
  const r1 = await ai.generate('pro', [{ role: 'user', content: 'hi' }], { isOwner: false });
  chk('Groq beantwortet, Gemini 4 bleibt unberührt', [r1, log.includes('gemini-quota-a'), (await counts('gemini-quota-a')).total], ['Groq ok', false, 0]);

  // --- Kontingent: alle anderen Modelle down, nur Google antwortet ---
  mode = 'googleOnly'; log.length = 0;
  const pubResults = [];
  for (let i = 0; i < 12; i++) { try { pubResults.push(await ai.generate('pro', [{ role: 'user', content: 'hi' }], { isOwner: false })); } catch (e) { pubResults.push('FEHLER'); } }
  chk('Öffentlich: genau 10 Antworten über Gemini 4', pubResults.filter(x => x === 'Antwort von gemini-quota-a').length, 10);
  chk('Öffentlich: Antwort 11 und 12 werden abgelehnt', pubResults.slice(10), ['FEHLER', 'FEHLER']);
  chk('Zähler nach öffentlichen Aufrufen', await counts('gemini-quota-a'), { total: 10, public: 10 });
  const ownResults = [];
  for (let i = 0; i < 12; i++) { try { ownResults.push(await ai.generate('pro', [{ role: 'user', content: 'hi' }], { isOwner: true })); } catch (e) { ownResults.push('FEHLER'); } }
  chk('Owner: die übrigen 10 laufen', ownResults.filter(x => x === 'Antwort von gemini-quota-a').length, 10);
  chk('Owner: danach ist Schluss (Tageslimit 20)', ownResults.slice(10), ['FEHLER', 'FEHLER']);
  chk('Zähler am Ende: 20 gesamt, 10 öffentlich', await counts('gemini-quota-a'), { total: 20, public: 10 });
  // 3.8 Flash hat denselben Mechanismus, eigener Zähler
  const n1 = []; for (let i = 0; i < 11; i++) { try { n1.push(await ai.generate('normal', [{ role: 'user', content: 'hi' }], { isOwner: false })); } catch (e) { n1.push('FEHLER'); } }
  chk('3.8 Flash: öffentlich max. 10', [n1.filter(x => x === 'Antwort von gemini-quota-b').length, n1[10]], [10, 'FEHLER']);
  // Tageswechsel: neuer Tag = neuer Zähler
  await db.deleteDoc(qKey('gemini-quota-a'));
  chk('Neuer Tag: wieder verfügbar', await ai.generate('pro', [{ role: 'user', content: 'hi' }], { isOwner: false }), 'Antwort von gemini-quota-a');

  // --- Parallele Aufrufe überschreiten das Limit nicht (atomar) ---
  await db.deleteCollection('model_quota');
  const par = await Promise.allSettled(Array.from({ length: 25 }, () => ai.generate('pro', [{ role: 'user', content: 'hi' }], { isOwner: false })));
  chk('25 gleichzeitige öffentliche Aufrufe: höchstens 10 durch', [par.filter(x => x.status === 'fulfilled').length, (await counts('gemini-quota-a')).total], [10, 10]);

  // --- Streaming ---
  mode = 'streamThink'; let deltas = []; let model = null;
  await ai.generateStream('flash', [{ role: 'user', content: 'hi' }], { isOwner: false, onDelta: (v) => deltas.push(v), onModel: (m) => { model = m.id; } });
  chk('Streaming: <think> über Stückgrenzen herausgefiltert', deltas.join(''), 'Hallo Welt');
  chk('Streaming: Modellname gemeldet', typeof model, 'string');
  mode = 'streamReason'; deltas = []; const ks = [];
  await ai.generateStream('flash', [{ role: 'user', content: 'hi' }], { onDelta: (v) => deltas.push(v), onThink: (k) => ks.push(k) });
  chk('Denken: reasoning_content landet nie im Antworttext', deltas.join(''), 'Fertig');
  chk('Denken: nur aktuelle Überschrift, kein altes Denken', [ks.length > 0, ks[ks.length - 1].h, /Jetzt plane/.test(ks[ks.length - 1].v), /Ich lese/.test(ks[ks.length - 1].v)], [true, 'Antwort planen', true, false]);
  mode = 'streamFallback'; deltas = []; const st2 = [];
  await ai.generateStream('flash', [{ role: 'user', content: 'hi' }], { onDelta: (v) => deltas.push(v), onThink: (k) => st2.push(k.h) });
  chk('Denken: auch ohne Denk-Ausgabe kommt Fortschritt (Start + Modellwechsel)', [st2[0], st2.includes('Anderes Modell wird versucht …')], ['Anfrage läuft …', true]);
  mode = 'streamLength'; deltas = []; calls.length = 0;
  await ai.generateStream('flash', [{ role: 'user', content: 'schreib viel' }], { onDelta: (v) => deltas.push(v) });
  chk('Lange Antwort: abgeschnitten → automatisch fortgesetzt, nahtlos', [deltas.join(''), calls.length], ['Teil1 Teil2', 2]);
  chk('Fortsetzung bekommt den bisherigen Text', calls[1].messages.some(m => m.role === 'assistant' && m.content === 'Teil1 '), true);
  chk('Standard-Limit pro Aufruf ist 16384 Tokens', calls[0].max_tokens, 16384);
  mode = 'effort';
  await ai.generate('pro', [{ role: 'user', content: 'hi' }], { effort: 'high', pin: 'groq:openai/gpt-oss-120b' });
  chk('Denkaufwand: Groq gpt-oss bekommt reasoning_effort', lastBody.reasoning_effort, 'high');
  await ai.generate('pro', [{ role: 'user', content: 'hi' }], { effort: 'low', pin: 'groq:qwen/qwen3.8-27b' });
  chk('Denkaufwand: Modelle ohne Unterstützung bekommen keinen Parameter', [lastBody.reasoning_effort, lastBody.reasoning], [undefined, undefined]);
  await ai.generate('pro', [{ role: 'user', content: 'hi' }], { effort: 'low', pin: 'openrouter:google/gemma-4-26b-a4b-it:free' });
  chk('Denkaufwand: OpenRouter bekommt reasoning.effort', lastBody.reasoning?.effort, 'low');
  await ai.generate('pro', [{ role: 'user', content: 'hi' }], { effort: 'extrem', pin: 'groq:openai/gpt-oss-120b' });
  chk('Denkaufwand: ungültiger Wert wird ignoriert', lastBody.reasoning_effort, undefined);
  // --- /model-test: probe ---
  mode = 'streamThink'; const pb = await ai.probe('groq:openai/gpt-oss-120b', [{ role: 'user', content: 'hi' }]);
  chk('probe: misst Zeichen (ohne <think>) und Zeit', [pb.ok, pb.chars, pb.text, pb.ttft !== null, pb.ms >= 0], [true, 10, 'Hallo Welt', true, true]);
  mode = 'streamReason'; const pr2 = await ai.probe('groq:openai/gpt-oss-120b', [{ role: 'user', content: 'hi' }]);
  chk('probe: Denk-Zeichen getrennt gezählt', [pr2.text, pr2.thinkChars > 0], ['Fertig', true]);
  mode = 'streamFallback'; const pfe = await ai.probe('groq:openai/gpt-oss-120b', [{ role: 'user', content: 'hi' }]);
  chk('probe: Fehler → ok false, kein Fallback auf andere Modelle', [pfe.ok, !!pfe.error], [false, true]);
  const savedKey = process.env.GROQ_API_KEY; delete process.env.GROQ_API_KEY; const pk = await ai.probe('groq:openai/gpt-oss-120b', []);
  process.env.GROQ_API_KEY = savedKey; chk('probe: ohne Key → „kein API-Key“', [pk.ok, pk.error], [false, 'kein API-Key']);
  const tk = []; const T = new ai.ThinkTracker((x) => tk.push(x), { every: 0, now: (() => { let n = 0; return () => n++; })() });
  T.push('ohne Überschrift, einfach Text'); chk('Denken: ohne Überschrift → „Überlege …“', tk[0].h, 'Überlege …');
  const tf = []; const F = new ai.ThinkFilter((x) => tf.push(x)); F.push('<think>abc defghijkl</think>ok'); F.flush();
  chk('Denken: <think>-Inhalt geht an Denk-Callback', tf.join(''), 'abc defghijkl');

  mode = 'streamFallback'; deltas = [];
  await ai.generateStream('pro', [{ role: 'user', content: 'hi' }], { isOwner: false, onDelta: (v) => deltas.push(v) });
  chk('Streaming: erstes Modell Fehler, zweites leer, drittes liefert', deltas.join(''), 'Zweites Modell');

  mode = 'streamMidError'; deltas = []; let err = null;
  try { await ai.generateStream('flash', [{ role: 'user', content: 'hi' }], { isOwner: false, onDelta: (v) => deltas.push(v) }); } catch (e) { err = e; }
  chk('Streaming: Abbruch mitten im Text bleibt als "partial" erkennbar', [deltas.join(''), !!err?.partial], ['Teil1 Teil2', true]);

  mode = 'streamGoogle'; deltas = [];
  await ai.generateStream('flash', [{ role: 'user', content: 'hi' }], { isOwner: false, onDelta: (v) => deltas.push(v) });
  chk('Streaming über Google (SSE)', deltas.join(''), 'Gemini');

  // --- ThinkFilter einzeln ---
  const f = new ai.ThinkFilter(); let o = ''; for (const c of ['A<', 'b>', 'x <think>y</think>z']) o += f.push(c); o += f.flush();
  chk('ThinkFilter: "<b>" bleibt, kein Hängenbleiben', o, 'A<b>x z'.replace(' ', ' '));
  await finish();
})();
