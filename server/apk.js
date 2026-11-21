// Android-APK über GitHub Actions bauen (.github/workflows/build-apk.yml).
// Die APK ist eine schlanke Android-Hülle (WebView), die die Coden-Adresse der App öffnet: Änderungen aus Coden
// erscheinen darum sofort in der installierten App, ohne neu zu bauen. Neu bauen nur bei Name/Symbol/Farbe.
// Einrichtung: GH_APK_TOKEN (Fine-grained Token mit Actions: write + Contents: write) und optional GH_APK_REPO / GH_APK_REF.
const crypto = require('crypto');

const cfg = () => ({ token: process.env.GH_APK_TOKEN || '', repo: process.env.GH_APK_REPO || 'Didscheridu/Coden-Ai', ref: process.env.GH_APK_REF || 'main', workflow: 'build-apk.yml' });
const configured = () => !!cfg().token;
const JAVA_KEYWORDS = new Set('abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for goto if implements import instanceof int interface long native new package private protected public return short static strictfp super switch synchronized this throw throws transient try void volatile while true false null var record yield'.split(' '));

function packageId(slug) {
  let seg = String(slug).replace(/-/g, '_').replace(/[^a-z0-9_]/g, '');
  if (!/^[a-z]/.test(seg)) seg = 'a' + seg;
  if (JAVA_KEYWORDS.has(seg)) seg += '_app';
  return 'app.coden.' + seg;
}

async function gh(p, opts = {}) {
  const { token, repo } = cfg();
  const r = await fetch(`https://api.github.com/repos/${repo}${p}`, {
    ...opts,
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'coden-ai', ...(opts.body ? { 'Content-Type': 'application/json' } : {}) }
  });
  if (r.status === 404) return null;
  if (!r.ok) { let m = `GitHub ${r.status}`; try { m = (await r.json()).message || m; } catch (e) {} throw new Error(m); }
  return r.status === 204 ? {} : r.json();
}

async function dispatch({ slug, name, url, color }) {
  const { ref, workflow } = cfg();
  const requestId = crypto.randomBytes(6).toString('hex');
  await gh(`/actions/workflows/${workflow}/dispatches`, { method: 'POST', body: JSON.stringify({ ref, inputs: { slug, name: String(name).slice(0, 40), url, color, package_id: packageId(slug), request_id: requestId } }) });
  return { status: 'building', requestId, requestedAt: Date.now(), packageId: packageId(slug) };
}

async function check(slug, state) {
  const rel = await gh(`/releases/tags/apk-${slug}`);
  if (rel && String(rel.body || '').includes(state.requestId)) {
    const asset = (rel.assets || []).find(a => a.name.endsWith('.apk'));
    if (asset) return { ...state, status: 'ready', url: asset.browser_download_url, size: asset.size, builtAt: Date.now() };
  }
  const runs = await gh(`/actions/workflows/${cfg().workflow}/runs?event=workflow_dispatch&per_page=30`);
  const run = (runs?.workflow_runs || []).find(x => String(x.display_title || x.name || '').includes(state.requestId));
  if (run) {
    state = { ...state, runUrl: run.html_url };
    if (run.status === 'completed' && run.conclusion !== 'success') return { ...state, status: 'failed', error: `Build fehlgeschlagen (${run.conclusion}).` };
  }
  if (Date.now() - (state.requestedAt || 0) > 30 * 60 * 1000) return { ...state, status: 'failed', error: 'Zeitüberschreitung beim Bauen.' };
  return state;
}

function publicState(s) {
  s = s || {};
  if (!s.status) return { status: 'none' };
  return { status: s.status, url: s.url || null, size: s.size || null, error: s.error || null, runUrl: s.runUrl || null, requestedAt: s.requestedAt || null, builtAt: s.builtAt || null, packageId: s.packageId || null };
}

module.exports = { configured, dispatch, check, publicState, packageId };
