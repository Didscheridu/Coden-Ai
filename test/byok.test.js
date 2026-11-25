// Bring your own Key: Keys verschlüsselt speichern, eigene Modelle bei Google/OpenAI/Anthropic/OpenRouter, Denkstufen, keine Coden-Limits.
const { setup } = require('./helpers');
(async () => {
  Object.assign(process.env, { CODEN_LIMIT_5H: '100', CODEN_LIMIT_WEEK: '1000' }); // winzige Limits: eigene Modelle dürfen sie nie auslösen
  const realFetch = global.fetch; const enc = new TextEncoder();
  const seen = []; let reply = null;
  const sse = (chunks) => new Response(new ReadableStream({ start(c) { for (const ch of chunks) c.enqueue(enc.encode(ch)); c.close(); } }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  global.fetch = async (url, o = {}) => {
    const u = String(url);
    if (u.startsWith('http://127.0.0.1')) return realFetch(url, o);
    const body = o.body ? JSON.parse(o.body) : null;
    seen.push({ url: u, headers: o.headers || {}, body });
    if (reply) return reply(u, body, o);
    // Modell-Listen der Anbieter
    if (u.includes('generativelanguage.googleapis.com/v1beta/models?')) return new Response(JSON.stringify({ models: [{ name: 'models/gemini-4-hydrogen', displayName: 'Gemini 4 Hydrogen', supportedGenerationMethods: ['generateContent'] }, { name: 'models/embedding-1', supportedGenerationMethods: ['embedContent'] }] }), { status: 200 });
    if (u === 'https://api.openai.com/v1/models') return new Response(JSON.stringify({ data: [{ id: 'gpt-x' }, { id: 'text-embedding-9' }, { id: 'whisper-1' }] }), { status: 200 });
    if (u.startsWith('https://api.anthropic.com/v1/models')) return new Response(JSON.stringify({ data: [{ id: 'claude-x', display_name: 'Claude X' }] }), { status: 200 });
    if (u === 'https://ai-gateway.kilo.ai/api/v1/models') return new Response(JSON.stringify({ data: [{ id: 'inclusionai/ling-3.0-flash-vl:free', name: 'inclusionAI: Ling 3.0 Flash VL (free)' }, { id: 'kilo-auto/free', name: 'Auto Free' }] }), { status: 200 });
    return new Response('{}', { status: 500 });
  };
  const { call, chk, finish, token, base, db } = await setup();
  const anna = await token({ sub: 'uid-anna', email: 'anna@x.de', email_verified: true });
  const ben = await token({ sub: 'uid-ben', email: 'ben@x.de', email_verified: true });
  const KEY = 'AIzaSyTESTKEY-1234567890abcd';
  const stream = (tier, tok = anna, extra = {}) => realFetch(base + '/chat/stream', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok }, body: JSON.stringify({ tier, messages: [{ role: 'system', content: 'Sei nett.' }, { role: 'user', content: 'Hallo' }], ...extra }) }).then(r => r.text());
  const events = (t) => t.split('\n\n').filter(x => x.startsWith('data: ')).map(x => JSON.parse(x.slice(6)));
  const textOf = (t) => events(t).filter(e => e.t === 'd').map(e => e.v).join('');
  const last = () => seen[seen.length - 1];
  const addModel = (provider, modelId, levels, tok = anna, label) => call('/byok/models', { provider, modelId, levels, ...(label ? { label } : {}) }, tok);

  // 1) Start: vier voreingestellte Anbieter, kein Key
  let o = (await call('/byok', null, anna)).j;
  chk('Anbieter voreingestellt', o.providers.map(p => p.id), ['google', 'openai', 'anthropic', 'openrouter', 'numes', 'kilo']);
  chk('Google AI Studio heißt so', o.providers[0].name, 'Google AI Studio');
  chk('Anfangs kein Key, keine Modelle', `${o.providers.some(p => p.hasKey)} ${o.models.length}`, 'false 0');
  chk('Ohne Login geht nichts', (await call('/byok')).s, 401);

  // 2) Key speichern: verschlüsselt in der Datenbank, nie in der Antwort
  chk('Zu kurzer Key abgelehnt', (await call('/byok/keys/google', { key: 'abc' }, anna, 'PUT')).s, 400);
  chk('Unbekannter Anbieter abgelehnt', (await call('/byok/keys/evil', { key: KEY }, anna, 'PUT')).s, 400);
  const put = await call('/byok/keys/google', { key: KEY }, anna, 'PUT');
  chk('Key gespeichert', put.s, 200);
  chk('Antwort zeigt nur die letzten 4 Zeichen', put.j.providers[0].hint, '…abcd');
  chk('Antwort enthält den Key nicht', JSON.stringify(put.j).includes('TESTKEY'), false);
  const stored = (await db.getDoc('user_provider_keys/uid-anna__google')).key_enc;
  chk('In der Datenbank verschlüsselt', stored.includes('TESTKEY') || stored.includes(KEY), false);
  chk('Verschlüsselung entschlüsselbar', await require('../server/byok').resolve('uid-anna', 'byok:' + (await addModel('google', 'gemini-4-hydrogen', ['low', 'medium', 'high', 'xhigh'])).j.models[0].id).then(m => m.apiKey), KEY);

  // 3) Modelle vom Anbieter laden (mit dem Key des Nutzers)
  const list = await call('/byok/providers/google/models', null, anna);
  chk('Modelle geladen, nur chat-fähige', list.j.models.map(m => m.id), ['gemini-4-hydrogen']);
  chk('Key ging als Header zu Google', last().headers['x-goog-api-key'], KEY);
  chk('Ohne Key keine Liste', (await call('/byok/providers/openai/models', null, anna)).s, 400);

  // 4) Modell anlegen, Denkstufen bleiben in fester Reihenfolge, Unbekanntes fliegt raus
  o = (await addModel('google', 'gemini-4-hydrogen', ['xhigh', 'low', 'bogus', 'high'], anna, 'Hydrogen')).j;
  const gm = o.models[0];
  chk('Modell gespeichert mit Name', gm.label, 'Hydrogen');
  chk('Denkstufen sortiert, nur bekannte', gm.levels, ['low', 'high', 'xhigh']);
  chk('Modell ist bereit', gm.ready, true);
  chk('Ungültige Modell-ID abgelehnt', (await addModel('google', 'a b;c', ['low'])).s, 400);
  chk('Modell-ID wird nicht doppelt angelegt', (await addModel('google', 'gemini-4-hydrogen', ['low'])).j.models.length, 1);
  await addModel('google', 'gemini-4-hydrogen', ['low', 'high', 'xhigh'], anna, 'Hydrogen');

  // 5) Chat mit Google-Modell: eigener Key, Denkstufe als thinkingLevel, kein Coden-Limit
  reply = (u) => sse([`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Hi ' }, { text: 'zurück' }] } }] })}\n\n`]);
  seen.length = 0;
  let t = await stream(gm.tier, anna, { effort: 'xhigh' });
  chk('Antwort kommt an', textOf(t), 'Hi zurück');
  chk('Google: Ziel ist das gewählte Modell', last().url.includes('/models/gemini-4-hydrogen:streamGenerateContent'), true);
  chk('Google: eigener Key benutzt', last().headers['x-goog-api-key'], KEY);
  chk('Google: Denkstufe xhigh gesendet', last().body.generationConfig.thinkingConfig.thinkingLevel, 'xhigh');
  chk('Eigenes Modell zeigt seinen Namen', events(t).some(e => e.t === 'm' && e.model === 'gemini-4-hydrogen'), true);
  const usageDoc = await db.getDoc('usage_limits/uid-anna');
  chk('Limit nicht gezählt', !!usageDoc && ((usageDoc.s_tokens || 0) > 0 || (usageDoc.w_tokens || 0) > 0), false);
  // Stufe, die das Modell nicht hat -> Standardstufe des Modells (mittlere gibt es nicht -> erste)
  await stream(gm.tier, anna, { effort: 'medium' });
  chk('Unbekannte Stufe -> Standard des Modells', last().body.generationConfig.thinkingConfig.thinkingLevel, 'low');
  // Modell kennt keine Denkstufe (HTTP 400) -> automatisch noch einmal ohne
  let n = 0; reply = () => (n++ === 0 ? new Response(JSON.stringify({ error: { message: 'thinking level not supported' } }), { status: 400 }) : sse([`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] })}\n\n`]));
  seen.length = 0; t = await stream(gm.tier, anna, { effort: 'high' });
  chk('Google: Wiederholung ohne Denkstufe', `${textOf(t)} ${seen.length} ${seen[1].body.generationConfig.thinkingConfig}`, 'ok 2 undefined');

  // 6) OpenAI
  await call('/byok/keys/openai', { key: 'sk-openai-test-9999' }, anna, 'PUT');
  const om = (await addModel('openai', 'gpt-x', ['low', 'medium', 'high', 'max'])).j.models.find(m => m.provider === 'openai');
  reply = () => sse([`data: ${JSON.stringify({ choices: [{ delta: { content: 'Moin' } }] })}\n\n`, 'data: [DONE]\n\n']);
  seen.length = 0; t = await stream(om.tier, anna, { effort: 'max', maxTokens: 2048 });
  chk('OpenAI: Antwort', textOf(t), 'Moin');
  chk('OpenAI: richtige Adresse und Key', `${last().url} ${last().headers.Authorization}`, 'https://api.openai.com/v1/chat/completions Bearer sk-openai-test-9999');
  chk('OpenAI: Modell, Stufe und max_completion_tokens', `${last().body.model} ${last().body.reasoning_effort} ${last().body.max_completion_tokens} ${last().body.max_tokens} ${last().body.temperature}`, 'gpt-x max 2048 undefined undefined');

  // 7) Anthropic
  await call('/byok/keys/anthropic', { key: 'sk-ant-test-7777' }, anna, 'PUT');
  const am = (await addModel('anthropic', 'claude-x', ['low', 'medium', 'high', 'xhigh'])).j.models.find(m => m.provider === 'anthropic');
  const ev = (o) => `event: ${o.type}\ndata: ${JSON.stringify(o)}\n\n`;
  reply = () => sse([ev({ type: 'message_start' }), ev({ type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'hmm' } }), ev({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'Servus' } }), ev({ type: 'content_block_delta', delta: { type: 'text_delta', text: '!' } }), ev({ type: 'message_stop' })]);
  seen.length = 0; t = await stream(am.tier, anna, { effort: 'xhigh' });
  chk('Anthropic: Antwort (Denk-Teile nicht im Text)', textOf(t), 'Servus!');
  chk('Anthropic: Adresse, Key, Version', `${last().url} ${last().headers['x-api-key']} ${last().headers['anthropic-version']}`, 'https://api.anthropic.com/v1/messages sk-ant-test-7777 2023-06-01');
  chk('Anthropic: System getrennt, Stufe als effort', `${last().body.system} ${last().body.messages.map(m => m.role)} ${last().body.output_config.effort} ${last().body.thinking.type} ${last().body.stream}`, 'Sei nett. user xhigh adaptive true');
  chk('Anthropic: Denken als Fortschritt gemeldet', events(t).some(e => e.t === 'k'), true);
  n = 0; reply = () => (n++ === 0 ? new Response(JSON.stringify({ error: { message: 'output_config.effort not supported' } }), { status: 400 }) : sse([ev({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'ohne' } })]));
  seen.length = 0; t = await stream(am.tier, anna, { effort: 'high' });
  chk('Anthropic: Wiederholung ohne Stufe', `${textOf(t)} ${seen.length} ${seen[1].body.output_config}`, 'ohne 2 undefined');

  // 8) OpenRouter mit eigenem Key
  await call('/byok/keys/openrouter', { key: 'sk-or-test-5555' }, anna, 'PUT');
  const rm = (await addModel('openrouter', 'vendor/model', ['low', 'high'])).j.models.find(m => m.provider === 'openrouter');
  reply = () => sse([`data: ${JSON.stringify({ choices: [{ delta: { content: 'Hey' } }] })}\n\n`, 'data: [DONE]\n\n']);
  seen.length = 0; t = await stream(rm.tier, anna, { effort: 'high' });
  chk('OpenRouter: eigener Key, Modell, Stufe', `${last().headers.Authorization} ${last().body.model} ${last().body.reasoning.effort}`, 'Bearer sk-or-test-5555 vendor/model high');
  // Numes (numes.ai): OpenAI-kompatibel unter api.numes.ai/api/v1
  await call('/byok/keys/numes', { key: 'nms-test-key-7777' }, anna, 'PUT');
  const nm = (await addModel('numes', 'deepseek/deepseek-v4.1-flash:free', ['low', 'high'])).j.models.find(m => m.provider === 'numes');
  seen.length = 0; t = await stream(nm.tier, anna, { effort: 'low' });
  chk('Numes: eigener Key, richtige Adresse, Modell', [last().url, last().headers.Authorization, last().body.model, nm.providerName], ['https://api.numes.ai/api/v1/chat/completions', 'Bearer nms-test-key-7777', 'deepseek/deepseek-v4.1-flash:free', 'Numes']);

  // Numes: HTTP 502 -> automatischer Neuversuch ohne reasoning-Einschränkung liefert Antwort
  n = 0;
  reply = () => (n++ === 0
    ? new Response('<html>502 Bad Gateway</html>', { status: 502, headers: { 'Content-Type': 'text/html' } })
    : sse([`data: ${JSON.stringify({ choices: [{ delta: { content: 'Cookie' } }] })}\n\n`, 'data: [DONE]\n\n']));
  seen.length = 0; t = await stream(nm.tier, anna, { effort: 'high' });
  chk('Numes: 502 wird wiederholt und lässt reasoning weg', [textOf(t), seen.length, seen[0].body.reasoning?.effort, seen[1].body.reasoning], ['Cookie', 2, 'high', undefined]);

  // Numes: In-Band-SSE-Fehler "provider capacity is exhausted" vor erster Ausgabe -> Neuversuch klappt
  n = 0;
  reply = () => (n++ === 0
    ? sse([': keepalive\n\n', `data: ${JSON.stringify({ error: { code: 503, message: 'provider capacity is exhausted', metadata: { error_type: 'provider_unavailable' } }, choices: [{ index: 0, delta: { content: '' }, finish_reason: 'error' }] })}\n\n`, 'data: [DONE]\n\n'])
    : sse([`data: ${JSON.stringify({ choices: [{ delta: { content: 'Läuft!' } }] })}\n\n`, 'data: [DONE]\n\n']));
  seen.length = 0; t = await stream(nm.tier, anna, { effort: 'high' });
  chk('Numes: In-Band-Kapazitätsfehler wird wiederholt', [textOf(t), seen.length], ['Läuft!', 2]);

  // Numes: 422 lehnt reasoning + temperature ab -> automatisch ohne beides
  n = 0;
  reply = () => (n++ < 2
    ? new Response(JSON.stringify({ error: { message: 'invalid parameter' } }), { status: 422 })
    : sse([`data: ${JSON.stringify({ choices: [{ delta: { content: 'Minimal' } }] })}\n\n`, 'data: [DONE]\n\n']));
  seen.length = 0; t = await stream(nm.tier, anna, { effort: 'low' });
  chk('Numes: 422 entfernt reasoning und temperature', [textOf(t), seen.length, seen[2].body.reasoning, seen[2].body.temperature], ['Minimal', 3, undefined, undefined]);

  // Numes: dauerhaft voll ausgelastet -> 3 Versuche bei Numes, kein stilles Ausweichen, klarer Hinweis
  reply = () => new Response(JSON.stringify({ error: { code: 429, message: 'provider capacity is exhausted', metadata: { error_type: 'provider_overloaded' } } }), { status: 429 });
  seen.length = 0; t = await stream(nm.tier, anna, { effort: 'low' });
  const numesErr = events(t).find(e => e.t === 'e')?.error || '';
  chk('Numes: nach 3 Versuchen klarer Hinweis ohne Coden-Fallback', [/provider capacity is exhausted.*kostenlosen Server bei Numes/.test(numesErr), seen.length, seen.every(s => s.url.includes('api.numes.ai'))], [true, 3, true]);

  // Kilo (ai-gateway.kilo.ai): eigener Key, Modellliste laden, Ling 3.0 Flash VL (free)
  reply = null;
  const kiloProvider = o.providers.find(p => p.id === 'kilo');
  chk('Kilo: schlägt Ling 3.0 Flash VL (free) vor', kiloProvider.suggest.some(s => s.id === 'inclusionai/ling-3.0-flash-vl:free'), true);
  await call('/byok/keys/kilo', { key: 'kilo-test-key-8888' }, anna, 'PUT');
  const kiloList = await call('/byok/providers/kilo/models', null, anna);
  chk('Kilo: Modelle geladen', kiloList.j.models.map(m => m.id), ['inclusionai/ling-3.0-flash-vl:free', 'kilo-auto/free']);
  const km = (await addModel('kilo', 'inclusionai/ling-3.0-flash-vl:free', ['low', 'high'], anna, 'Ling 3.0 Flash VL')).j.models.find(m => m.provider === 'kilo');
  reply = () => sse([`data: ${JSON.stringify({ choices: [{ delta: { content: 'Hallo von Kilo' } }] })}\n\n`, 'data: [DONE]\n\n']);
  seen.length = 0; t = await stream(km.tier, anna, { effort: 'high' });
  chk('Kilo: eigener Key, Adresse, Modell und Antwort', [textOf(t), last().url, last().headers.Authorization, last().body.model, last().body.reasoning.effort, km.providerName], ['Hallo von Kilo', 'https://ai-gateway.kilo.ai/api/v1/chat/completions', 'Bearer kilo-test-key-8888', 'inclusionai/ling-3.0-flash-vl:free', 'high', 'Kilo']);

  // 9) Fehler eines eigenen Modells: genaue Ursache, kein Ausweichen auf Coden-Modelle
  reply = () => new Response(JSON.stringify({ error: { message: 'Incorrect API key provided' } }), { status: 401 });
  seen.length = 0; t = await stream(om.tier, anna);
  const err = events(t).find(e => e.t === 'e');
  chk('Fehler nennt Modell und Key-Hinweis', /gpt-x \(OpenAI\).*Incorrect API key.*Eigene Modelle/.test(err?.error || ''), true);
  chk('Kein Ausweichen auf andere Modelle', seen.length, 1);

  // 10) Andere Nutzer kommen nicht an fremde Modelle/Keys
  reply = () => sse([`data: ${JSON.stringify({ choices: [{ delta: { content: 'x' } }] })}\n\n`]);
  seen.length = 0; t = await stream(om.tier, ben);
  chk('Fremdes Modell nicht nutzbar', `${/gibt es nicht mehr/.test(events(t).find(e => e.t === 'e')?.error || '') || (await realFetch(base + '/chat/stream', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + ben }, body: JSON.stringify({ tier: om.tier, messages: [{ role: 'user', content: 'x' }] }) })).status} ${seen.length}`.replace(/^.*?(true|404|200)/, '$1'), 'true 0');
  chk('Fremde Modelle nicht sichtbar', (await call('/byok', null, ben)).j.models.length, 0);
  chk('Fremdes Modell nicht löschbar', (await call('/byok/models/' + om.id, null, ben, 'DELETE')).j.models.length, 0);
  chk('… und bleibt bei Anna erhalten', (await call('/byok', null, anna)).j.models.some(m => m.id === om.id), true);

  // 11) Ohne Key kein Chat; Key entfernen sperrt das Modell, löscht es aber nicht
  o = (await call('/byok/keys/openai', null, anna, 'DELETE')).j;
  chk('Key entfernt', o.providers.find(p => p.id === 'openai').hasKey, false);
  chk('Modell bleibt, ist aber nicht bereit', o.models.find(m => m.id === om.id).ready, false);
  t = await stream(om.tier, anna);
  chk('Chat sagt, dass der Key fehlt', /kein API-Key/.test(events(t).find(e => e.t === 'e')?.error || ''), true);
  chk('Modell löschen', (await call('/byok/models/' + om.id, null, anna, 'DELETE')).j.models.some(m => m.id === om.id), false);

  // 12) Coden-Modelle und Limits bleiben unverändert (Limit 100 Tokens: ein langer Flash-Chat zählt)
  reply = () => sse([`data: ${JSON.stringify({ choices: [{ delta: { content: 'y'.repeat(4000) } }] })}\n\n`, 'data: [DONE]\n\n']);
  process.env.GROQ_API_KEY = 'g'; process.env.OPENROUTER_API_KEY = 'o'; process.env.GOOGLE_API_KEY = 'x';
  await stream('flash', anna); await new Promise(r => setTimeout(r, 150));
  chk('Coden-Modelle zählen weiter gegen das Limit', (await call('/usage', null, anna)).j.session.used > 100, true);
  const blocked = await realFetch(base + '/chat/stream', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + anna }, body: JSON.stringify({ tier: 'flash', messages: [{ role: 'user', content: 'x' }] }) });
  chk('Coden-Modell ist jetzt gesperrt (429)', blocked.status, 429);
  reply = () => sse([`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: 'trotzdem' }] } }] })}\n\n`]);
  t = await stream(gm.tier, anna);
  chk('Eigenes Modell geht trotz Limit', textOf(t), 'trotzdem');
  await finish();
})().catch(e => { console.error(e); process.exit(1); });
