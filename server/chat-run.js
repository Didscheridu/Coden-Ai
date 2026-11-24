// Chat-Antworten als Hintergrund-Lauf, die auch bei komplett geschlossener Seite fertig werden:
// - Etappen: Ein Server-Aufruf darf auf Vercel höchstens 5 Minuten laufen. Wird eine Antwort sehr lang,
//   sichert der Lauf rechtzeitig seinen Stand in Firestore und startet sich selbst neu; das Modell schreibt nahtlos weiter.
// - Bilder (<generate_image prompt="…">) erstellt der Server selbst.
// - Am Ende kommt eine Push-Benachrichtigung aufs Gerät (wenn eingeschaltet).
const crypto = require('crypto');
const db = require('./db');
const byok = require('./byok');
const { generateStream, CONTINUE } = require('./ai');
const { generateImage } = require('./images');
const { Meter } = require('./usage');
const { resumeRun } = require('./runs');
const Push = require('./push');

const intEnv = (name, def) => { const n = parseInt(process.env[name], 10); return Number.isFinite(n) && n > 0 ? n : def; };
const LEG_MS = () => intEnv('CODEN_CHAT_LEG_MS', 230_000); // danach neue Etappe (Vercel-Grenze: 300 s)
const MAX_LEGS = 6;
const IMAGE_TAG = /<generate_image\s+([^>]*?)\/?>/gi;

// Ein Bild erzeugen und in Firestore speichern (auch für POST /api/image)
async function makeChatImage(user, prompt, base) {
  const p = String(prompt || '').trim().slice(0, 1500);
  if (p.length < 3) throw Object.assign(new Error('Beschreibe das Bild kurz.'), { status: 400 });
  if (!user.isOwner) {
    const mine = await db.runQuery('app_images', { where: [['uid', '==', user.uid]] });
    if (mine.length >= 300) throw Object.assign(new Error('Du hast das Bild-Limit erreicht (300).'), { status: 400 });
  }
  const img = await generateImage(p);
  const key = crypto.randomBytes(9).toString('hex');
  await db.createDoc(`app_images/${key}`, {
    key,
    uid: user.uid,
    prompt: p,
    mime: img.mime,
    data_b64: Buffer.from(img.data).toString('base64'),
    created_at: db.nowIso()
  });
  return { key, url: `${base}/api/public/img/${key}` };
}

// Selbstaufruf für die nächste Etappe (eigene Adresse, Einmal-Schlüssel)
async function selfInvoke(url, key, body) {
  const headers = { 'Content-Type': 'application/json', 'X-Coden-Leg': key };
  if (process.env.VERCEL_AUTOMATION_BYPASS_SECRET) headers['x-vercel-protection-bypass'] = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  try {
    const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(20000) });
    if (r.ok) return true;
    console.warn('[leg] abgelehnt:', r.status, url);
  } catch (e) { console.warn('[leg] nicht erreichbar:', e.message); }
  return false;
}

// job für startRun/resumeRun. state = { user, tier, messages, opts, base, self, leg }
async function chatJob(run, state) {
  const { user, tier, messages, opts = {}, leg = 1 } = state;
  const meter = new Meter(user, tier);
  const legAc = new AbortController(); let legEnd = false;
  const timer = setTimeout(() => { if (run.text.trim() && leg < MAX_LEGS) { legEnd = true; legAc.abort(); } }, LEG_MS());
  const msgs = leg > 1 && run.text.trim()
    ? [...messages, { role: 'assistant', content: run.text.replace(/<think>[\s\S]*?<\/think>\s*/gi, '') }, { role: 'user', content: CONTINUE }]
    : messages;
  try {
    await generateStream(tier, msgs, {
      ...opts, isOwner: user.isOwner, uid: user.uid, meter, signal: AbortSignal.any([run.signal, legAc.signal]),
      onModel: (m) => run.setModel(m), onThink: (k) => run.thinkStep(k), onDelta: (v) => run.delta(v)
    });
  } catch (e) {
    if (legEnd && !run.signal.aborted) {
      clearTimeout(timer); await meter.close();
      if (await continueLeg(run, { ...state, leg: leg + 1 })) return { continued: true };
      run.delta('\n\n⚠️ *Die Antwort war sehr lang und wurde hier gekürzt. Schreib „weiter“, dann macht Coden weiter.*');
    } else if (e.limit) {
      run.delta(`${run.text.trim() ? '\n\n' : ''}⚠️ ${e.message}`);
    } else throw e;
  } finally { clearTimeout(timer); await meter.close(); }
  if (run.signal.aborted) return;
  await images(run, user, state.base);
  if (run.subs.size === 0) await Push.notify(user.uid, { title: state.title ? `Coden ist fertig: ${state.title}` : 'Coden ist fertig', body: Push.preview(run.text), url: '/#/chat', tag: 'chat-' + run.ref });
}

// Bilder aus der Antwort gleich auf dem Server erstellen.
async function images(run, user, base) {
  const wanted = [...run.text.matchAll(IMAGE_TAG)].map(m => (m[1].match(/prompt\s*=\s*"([^"]*)"/i) || [])[1]).filter(Boolean).slice(0, 2);
  if (!wanted.length || !base) return;
  run.thinkStep({ h: 'Bild wird erstellt …', v: wanted[0].slice(0, 160) });
  const out = [];
  for (const prompt of wanted) {
    try { out.push({ prompt, url: (await makeChatImage(user, prompt, base)).url }); }
    catch (e) { out.push({ prompt, error: e.message }); }
  }
  run.setExtra({ images: out });
}

async function continueLeg(run, state) {
  const key = crypto.randomBytes(24).toString('hex');
  await run.pause();
  const ctxToken = db.getDbContext().token;
  const authTokenEnc = ctxToken ? await byok.encrypt(ctxToken).catch(() => null) : null;
  const savedState = authTokenEnc ? { ...state, authTokenEnc } : state;
  const nextMeta = { ...run.meta, extra: run.extra, cont: { key, state: savedState } };
  await db.updateDoc(`ai_runs/${run.id}`, { meta: nextMeta, updated_at: db.nowIso() });
  if (await selfInvoke(`${state.self}/api/runs/${run.id}/continue`, key, { run: run.id })) return true;
  const cleanMeta = { ...run.meta, extra: run.extra };
  await db.updateDoc(`ai_runs/${run.id}`, { meta: cleanMeta, updated_at: db.nowIso() }).catch(() => {});
  run.unpause(); return false;
}

// POST /api/runs/:id/continue (ohne Login, nur mit dem Einmal-Schlüssel der vorigen Etappe)
async function continueHandler(req, res) {
  const id = parseInt(req.params.id, 10); const key = String(req.headers['x-coden-leg'] || '');
  if (!Number.isFinite(id) || key.length !== 48) return res.status(400).json({ error: 'Ungültig.' });
  const row = await db.getDoc(`ai_runs/${id}`, { preferAdmin: true });
  const cont = row?.status === 'running' && row?.kind === 'chat' ? row?.meta?.cont : null;
  if (!cont || typeof cont.key !== 'string' || cont.key.length !== key.length || !crypto.timingSafeEqual(Buffer.from(cont.key), Buffer.from(key))) {
    return res.status(403).json({ error: 'Nicht erlaubt.' });
  }
  const { cont: _c, ...restMeta } = row.meta || {};
  void _c;
  try {
    const took = await db.updateDoc(`ai_runs/${id}`, { meta: restMeta, updated_at: db.nowIso() }, { updateTime: row._updateTime, preferAdmin: true });
    if (!took) return res.status(409).json({ error: 'Diese Etappe läuft schon.' });
  } catch (e) {
    if (e.code === 'PRECONDITION_FAILED') return res.status(409).json({ error: 'Diese Etappe läuft schon.' });
    throw e;
  }
  const st = cont.state || {};
  let token = null;
  if (st.authTokenEnc) token = await byok.decrypt(st.authTokenEnc).catch(() => null);
  const { authTokenEnc: _a, ...cleanState } = st;
  void _a;
  const dbCtx = { token, uid: st.user?.uid, isOwner: !!st.user?.isOwner, email: st.user?.email };
  const started = await db.runWithDbContext(dbCtx, () => resumeRun(id, { isOwner: !!st.user?.isOwner }, (run) => chatJob(run, cleanState)));
  if (!started) return res.status(409).json({ error: 'Der Lauf ist nicht mehr aktiv.' });
  res.status(202).json({ ok: true });
}

module.exports = { chatJob, continueHandler, makeChatImage, selfInvoke, IMAGE_TAG };
