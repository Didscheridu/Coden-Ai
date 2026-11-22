// Kontingent, Kaskaden-Reihenfolge, Streaming. Anbieter werden mit einem Fake-fetch simuliert, die Datenbank ist echt (PGlite).
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
  const log = []; let mode = 'googleOnly';
  global.fetch = async (url, o) => {
    const body = JSON.parse(o?.body || '{}'); const isGoogle = url.includes('googleapis'); const model = isGoogle ? url.split('/models/')[1].split(':')[0] : body.model;
    log.push(model);
    if (mode === 'googleOnly') {
      if (!isGoogle) return new Response(JSON.stringify({ error: { message: 'down' } }), { status: 500 });
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Antwort von ' + model }] } }] }), { status: 200 });
    }
    if (mode === 'nvidiaOnly') return url.includes('nvidia') ? new Response(JSON.stringify({ choices: [{ message: { content: 'NVIDIA ok' } }] }), { status: 200 }) : new Response(JSON.stringify({ error: { message: 'down' } }), { status: 500 });
    if (mode === 'groqWorks') return new Response(JSON.stringify({ choices: [{ message: { content: 'Groq ok' } }] }), { status: 200 });
    if (mode === 'streamThink') return sseResponse([oa('Hal'), oa('lo <thi'), oa('nk>geheim</th'), oa('ink>Welt'), 'data: [DONE]\n\n']);
    if (mode === 'streamFallback') { if (body.model === 'openai/gpt-oss-120b') return new Response('{}', { status: 500 }); if (body.model === 'llama-3.3-70b-versatile') return sseResponse([': ping\n\n', 'data: [DONE]\n\n']); return sseResponse([oa('Zweites Modell')]); }
    if (mode === 'streamMidError') return sseResponse([oa('Teil1 '), oa('Teil2'), oa('Teil3')], { failAfter: 2 });
    if (mode === 'streamGoogle') return sseResponse([gem('Ge'), gem('mini')]);
  };
  const counts = async (m) => (await db.query('SELECT total, public FROM model_quota WHERE model = $1', [m])).rows[0] || { total: 0, public: 0 };

  // --- Reihenfolge ---
  const last = (t) => ai.CASCADES[t][ai.CASCADES[t].length - 1].id;
  chk('pro: Gemini 4 Hydrogen ist ganz hinten', last('pro'), 'gemini-4-hydrogen');
  chk('normal: Gemini 3.8 Flash ist ganz hinten', last('normal'), 'gemini-3.8-flash');
  chk('flash enthält keine knappen Modelle', ai.CASCADES.flash.some(m => ai.QUOTAS[m.id]), false);
  chk('pro: Gemini nirgends sonst', ai.CASCADES.pro.filter(m => m.id === 'gemini-4-hydrogen').length, 1);
  chk('alle 11 OpenRouter-Gratismodelle in "pro"', ai.CASCADES.pro.filter(m => m.provider === 'openrouter').length, 11);

  // --- Neue Anbieter + NVIDIA nur im Notfall ---
  const idx = (t, pr) => ai.CASCADES[t].map(m => m.provider);
  for (const t of ['flash', 'normal', 'pro']) {
    const ps = idx(t); const firstNv = ps.indexOf('nvidia');
    chk(`${t}: NVIDIA steht hinter allen anderen Anbietern (außer Gemini-Reserve)`, ps.slice(firstNv).every(p => p === 'nvidia' || p === 'google'), true);
    chk(`${t}: Mistral/Hugging Face vor NVIDIA`, ['mistral', 'huggingface'].every(p => ps.indexOf(p) > -1 && ps.indexOf(p) < firstNv), true);
  }
  chk('pro: SambaNova vorhanden, vor NVIDIA', idx('pro').indexOf('sambanova') < idx('pro').indexOf('nvidia'), true);
  chk('normal beginnt mit Devstral (Coding-Modell)', ai.CASCADES.normal[0].id, 'devstral-medium-latest');
  const lm0 = ai.listModels();
  chk('Modellliste enthält alle neuen Anbieter', ['mistral', 'huggingface', 'sambanova', 'nvidia'].every(p => lm0.some(m => m.provider === p)), true);
  process.env.MISTRAL_API_KEY = 'x'; mode = 'groqWorks'; log.length = 0;
  chk('Mistral antwortet in "normal" zuerst, wenn der Key gesetzt ist', [await ai.generate('normal', [{ role: 'user', content: 'hi' }], {}), log[0]].join('|'), 'Groq ok|devstral-medium-latest');
  delete process.env.MISTRAL_API_KEY;
  process.env.NVIDIA_API_KEY = 'x'; mode = 'nvidiaOnly'; log.length = 0;
  chk('NVIDIA springt im Notfall ein', await ai.generate('flash', [{ role: 'user', content: 'hi' }], {}), 'NVIDIA ok');
  delete process.env.NVIDIA_API_KEY;

  // --- /modelle: gezielt ein Modell wählen ---
  const lm = ai.listModels();
  chk('Modellliste: eindeutig, enthält NVIDIA + Groq + Google', [new Set(lm.map(m => m.key)).size === lm.length, ['nvidia', 'groq', 'openrouter', 'google'].every(p => lm.some(m => m.provider === p))], [true, true]);
  chk('Modellliste: Gemini als knapp markiert', lm.find(m => m.id === 'gemini-4-hydrogen').limited, true);
  mode = 'groqWorks'; log.length = 0;
  const pr = await ai.generate('flash', [{ role: 'user', content: 'hi' }], { pin: 'groq:llama-3.3-70b-versatile' });
  chk('Pin: genau dieses Modell wird gefragt', [pr, log.join()], ['Groq ok', 'llama-3.3-70b-versatile']);
  let pe; try { await ai.generate('pro', [{ role: 'user', content: 'hi' }], { pin: 'groq:gibt-es-nicht' }); } catch (e) { pe = e.status; }
  chk('Pin: unbekanntes Modell → 400', pe, 400);
  mode = 'streamFallback'; log.length = 0; let fe; try { await ai.generate('pro', [{ role: 'user', content: 'hi' }], { pin: 'groq:openai/gpt-oss-120b' }); } catch (e) { fe = e.message; }
  chk('Pin: fällt das Modell aus, wird NICHT auf andere ausgewichen', [!!fe, log.join()], [true, 'openai/gpt-oss-120b']);

  mode = 'googleOnly'; let ke; try { await ai.generate('pro', [{ role: 'user', content: 'hi' }], { pin: 'groq:openai/gpt-oss-120b' }); } catch (e) { ke = e.message; }
  chk('Pin: Fehlermeldung nennt Modell', /gpt-oss-120b \(Groq\): down/.test(ke || ''), true);
  // --- Wenn andere Modelle funktionieren, wird Gemini nie angefasst ---
  mode = 'groqWorks'; log.length = 0;
  const r1 = await ai.generate('pro', [{ role: 'user', content: 'hi' }], { isOwner: false });
  chk('Groq beantwortet, Gemini 4 bleibt unberührt', [r1, log.includes('gemini-4-hydrogen'), (await counts('gemini-4-hydrogen')).total], ['Groq ok', false, 0]);

  // --- Kontingent: alle anderen Modelle down, nur Google antwortet ---
  mode = 'googleOnly'; log.length = 0;
  const pubResults = [];
  for (let i = 0; i < 12; i++) { try { pubResults.push(await ai.generate('pro', [{ role: 'user', content: 'hi' }], { isOwner: false })); } catch (e) { pubResults.push('FEHLER'); } }
  chk('Öffentlich: genau 10 Antworten über Gemini 4', pubResults.filter(x => x === 'Antwort von gemini-4-hydrogen').length, 10);
  chk('Öffentlich: Antwort 11 und 12 werden abgelehnt', pubResults.slice(10), ['FEHLER', 'FEHLER']);
  chk('Zähler nach öffentlichen Aufrufen', await counts('gemini-4-hydrogen'), { total: 10, public: 10 });
  const ownResults = [];
  for (let i = 0; i < 12; i++) { try { ownResults.push(await ai.generate('pro', [{ role: 'user', content: 'hi' }], { isOwner: true })); } catch (e) { ownResults.push('FEHLER'); } }
  chk('Owner: die übrigen 10 laufen', ownResults.filter(x => x === 'Antwort von gemini-4-hydrogen').length, 10);
  chk('Owner: danach ist Schluss (Tageslimit 20)', ownResults.slice(10), ['FEHLER', 'FEHLER']);
  chk('Zähler am Ende: 20 gesamt, 10 öffentlich', await counts('gemini-4-hydrogen'), { total: 20, public: 10 });
  // 3.8 Flash hat denselben Mechanismus, eigener Zähler
  const n1 = []; for (let i = 0; i < 11; i++) { try { n1.push(await ai.generate('normal', [{ role: 'user', content: 'hi' }], { isOwner: false })); } catch (e) { n1.push('FEHLER'); } }
  chk('3.8 Flash: öffentlich max. 10', [n1.filter(x => x === 'Antwort von gemini-3.8-flash').length, n1[10]], [10, 'FEHLER']);
  // Tageswechsel: neuer Tag = neuer Zähler
  await db.query("UPDATE model_quota SET day = day - 1");
  chk('Neuer Tag: wieder verfügbar', await ai.generate('pro', [{ role: 'user', content: 'hi' }], { isOwner: false }), 'Antwort von gemini-4-hydrogen');

  // --- Parallele Aufrufe überschreiten das Limit nicht (atomar) ---
  await db.query('DELETE FROM model_quota');
  const par = await Promise.allSettled(Array.from({ length: 25 }, () => ai.generate('pro', [{ role: 'user', content: 'hi' }], { isOwner: false })));
  chk('25 gleichzeitige öffentliche Aufrufe: höchstens 10 durch', [par.filter(x => x.status === 'fulfilled').length, (await counts('gemini-4-hydrogen')).total], [10, 10]);

  // --- Streaming ---
  mode = 'streamThink'; let deltas = []; let model = null;
  await ai.generateStream('flash', [{ role: 'user', content: 'hi' }], { isOwner: false, onDelta: (v) => deltas.push(v), onModel: (m) => { model = m.id; } });
  chk('Streaming: <think> über Stückgrenzen herausgefiltert', deltas.join(''), 'Hallo Welt');
  chk('Streaming: Modellname gemeldet', typeof model, 'string');

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
