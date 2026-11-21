// js/apps/github.js – GitHub verbinden, App als Repository speichern, Repository als App importieren.
// Der Zugriffstoken bleibt nur in diesem Browser (localStorage) und geht nie an das Coden-Backend.
import { toast } from '../toast.js';
import { h, icon } from './dom.js';
import { modal } from './dialogs.js';

const KEY = 'coden_github';
const API = 'https://api.github.com';
const FILE_RE = /^(?!.*\.\.)(?!.*\/\/)[A-Za-z0-9_][A-Za-z0-9_.\-\/]{0,99}$/;
const SKIP = /(^|\/)(node_modules|\.git|\.github|\.vscode|\.idea|dist|build|coverage)(\/|$)|(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|\.DS_Store)$/;

export const ghInfo = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (_) { return null; } };
export const ghDisconnect = () => { localStorage.removeItem(KEY); };

async function gh(path, { method = 'GET', body, raw = false, token } = {}) {
    const t = token || ghInfo()?.token; if (!t) throw Object.assign(new Error('GitHub ist nicht verbunden.'), { code: 'NOAUTH' });
    const r = await fetch(API + path, { method, headers: { Authorization: 'Bearer ' + t, Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    if (r.status === 401) { ghDisconnect(); throw Object.assign(new Error('Die GitHub-Verbindung ist abgelaufen. Verbinde dich bitte neu.'), { code: 'NOAUTH' }); }
    if (raw && r.ok) return r;
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(d.message || `GitHub-Fehler ${r.status}`), { status: r.status, data: d });
    return d;
}

// ---------- Verbinden ----------
export function ghConnect() {
    return new Promise((resolve) => {
        let done = false; const fin = (v) => { if (done) return; done = true; m.close(); resolve(v); };
        const err = h('div', { class: 'cd-err' });
        const tokenIn = h('input', { class: 'cd-input', type: 'password', placeholder: 'ghp_… oder github_pat_…', autocomplete: 'off', spellcheck: 'false' });
        const save = async (token) => {
            const u = await gh('/user', { token });
            localStorage.setItem(KEY, JSON.stringify({ token, login: u.login, avatar: u.avatar_url }));
            toast(`Mit GitHub verbunden: @${u.login}`, { type: 'ok' }); fin(ghInfo());
        };
        const viaPopup = h('button', { class: 'cd-primary', onclick: async (e) => {
            err.textContent = ''; const b = e.currentTarget; b.disabled = true;
            try { const { connectGithub } = await import('../auth.js'); const { token } = await connectGithub(); await save(token); }
            catch (x) { err.textContent = x.message + (/Firebase|aktiviert/.test(x.message) ? '' : ''); }
            b.disabled = false;
        } }, icon('login'), ' Mit GitHub anmelden');
        const viaToken = h('button', { class: 'cd-btn', onclick: async (e) => {
            err.textContent = ''; const t = tokenIn.value.trim(); if (!t) { err.textContent = 'Füge zuerst einen Token ein.'; return; }
            const b = e.currentTarget; b.disabled = true;
            try { await save(t); } catch (x) { err.textContent = x.status === 401 ? 'Dieser Token wird von GitHub nicht akzeptiert.' : x.message; }
            b.disabled = false;
        } }, 'Token verbinden');
        const m = modal('GitHub verbinden', h('div', {},
            h('p', { class: 'cd-text', text: 'Verbinde dein GitHub-Konto, um Apps als Repository zu speichern und bestehende Repositories in Coden zu öffnen. Der Zugriff bleibt in deinem Browser.' }),
            h('div', { class: 'cd-row' }, viaPopup),
            h('div', { class: 'cd-sep', text: 'oder mit Token' }),
            h('label', { class: 'cd-label', text: 'Persönlicher Zugriffstoken (Berechtigung „repo“)' }), tokenIn,
            h('small', { class: 'cd-hint' }, 'Token erstellen: ', h('a', { href: 'https://github.com/settings/tokens/new?scopes=repo&description=Coden', target: '_blank', rel: 'noopener', text: 'github.com/settings/tokens' }), ' → „Generate token“ → kopieren.'),
            err, h('div', { class: 'cd-row end' }, viaToken)), { onClose: () => fin(null) });
    });
}
export async function ensureGithub() { return ghInfo() || ghConnect(); }

// ---------- App als Repository speichern ----------
const b64 = (s) => btoa(unescape(encodeURIComponent(s)));
const slug = (s) => String(s || 'meine-app').toLowerCase().normalize('NFKD').replace(/[^\w\s.-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').slice(0, 60) || 'meine-app';

export async function ghExport({ app, files }) {
    const me = await ensureGithub(); if (!me) return;
    const savedKey = 'coden_gh_repo_' + app.id; const saved = localStorage.getItem(savedKey) || '';
    const name = h('input', { class: 'cd-input', value: saved ? saved.split('/')[1] : slug(app.name), maxlength: 80, spellcheck: 'false' });
    const priv = h('input', { type: 'checkbox', checked: true });
    const status = h('div', { class: 'cd-hint' }); const err = h('div', { class: 'cd-err' }); const out = h('div', {});
    const go = h('button', { class: 'cd-primary', onclick: async () => {
        err.textContent = ''; out.replaceChildren(); go.disabled = true;
        try {
            const repo = slug(name.value); let r; let fresh = false;
            status.textContent = 'Repository wird vorbereitet …';
            try { r = await gh('/user/repos', { method: 'POST', body: { name: repo, description: `${app.name} – gebaut mit Coden`, private: priv.checked, auto_init: false } }); fresh = true; }
            catch (e) { if (e.status === 422) r = await gh(`/repos/${me.login}/${repo}`); else throw e; }
            const all = { ...files }; if (!all['README.md']) all['README.md'] = `# ${app.name}\n\nGebaut mit [Coden](https://coden-ai.vercel.app).\n`;
            const names = Object.keys(all); let i = 0;
            for (const n of names) {
                status.textContent = `Lade hoch (${++i}/${names.length}): ${n}`;
                let sha; if (!fresh) { try { sha = (await gh(`/repos/${r.full_name}/contents/${n.split('/').map(encodeURIComponent).join('/')}`)).sha; } catch (e) { if (e.status !== 404) throw e; } }
                await gh(`/repos/${r.full_name}/contents/${n.split('/').map(encodeURIComponent).join('/')}`, { method: 'PUT', body: { message: fresh ? 'Erste Version aus Coden' : 'Update aus Coden', content: b64(all[n]), ...(sha ? { sha } : {}) } });
            }
            localStorage.setItem(savedKey, r.full_name);
            status.textContent = ''; toast('Auf GitHub gespeichert', { type: 'ok' });
            out.replaceChildren(h('div', { class: 'cd-pub-state on' }, icon('check_circle'), h('div', {}, h('b', { text: 'Gespeichert!' }), h('a', { href: r.html_url, target: '_blank', rel: 'noopener', text: r.html_url }))));
        } catch (e) { status.textContent = ''; err.textContent = e.code === 'NOAUTH' ? e.message : (e.status === 403 || e.status === 404 ? 'GitHub verweigert den Zugriff. Hat der Token die Berechtigung „repo“?' : e.message); }
        go.disabled = false;
    } }, icon('upload'), ' Auf GitHub speichern');
    modal('Auf GitHub speichern', h('div', {},
        h('p', { class: 'cd-text' }, 'Konto: ', h('b', { text: '@' + me.login }), ' ', h('button', { class: 'cd-link', text: 'trennen', onclick: () => { ghDisconnect(); toast('GitHub getrennt'); } })),
        h('label', { class: 'cd-label', text: 'Name des Repositorys' }), name,
        h('label', { class: 'cd-check' }, priv, ' Privat (nur du siehst es)'),
        h('small', { class: 'cd-hint', text: 'Gibt es das Repository schon, werden die Dateien aktualisiert.' }),
        err, status, out, h('div', { class: 'cd-row end' }, go)));
}

// ---------- Repository als App öffnen ----------
export async function ghImport(onImport) {
    const me = await ensureGithub(); if (!me) return;
    const list = h('div', { class: 'gh-list' }, h('small', { class: 'cd-hint', text: 'Lade deine Repositories …' }));
    const q = h('input', { class: 'cd-input', placeholder: 'Repository suchen …' });
    const err = h('div', { class: 'cd-err' }); let repos = []; let busy = false;
    const draw = () => {
        const f = q.value.trim().toLowerCase();
        const rows = repos.filter(r => r.full_name.toLowerCase().includes(f)).slice(0, 60);
        list.replaceChildren(...(rows.length ? rows.map(r => h('button', { class: 'gh-repo', onclick: () => pick(r) }, icon(r.private ? 'lock' : 'folder_open'), h('div', { class: 'grow' }, h('b', { text: r.full_name }), h('small', { text: r.description || 'Keine Beschreibung' })))) : [h('small', { class: 'cd-hint', text: 'Nichts gefunden.' })]));
    };
    const pick = async (r) => {
        if (busy) return; busy = true; err.textContent = '';
        try {
            list.replaceChildren(h('small', { class: 'cd-hint', text: `Lese ${r.full_name} …` }));
            const tree = await gh(`/repos/${r.full_name}/git/trees/${encodeURIComponent(r.default_branch || 'HEAD')}?recursive=1`);
            const cand = (tree.tree || []).filter(x => x.type === 'blob' && !SKIP.test(x.path) && FILE_RE.test(x.path) && x.size <= 400_000);
            if (!cand.some(x => x.path === 'index.html')) throw new Error('Kein index.html im Hauptordner gefunden. Importiert werden können nur Webseiten-Repositories.');
            const files = {}; let skipped = 0, total = 0;
            for (const x of cand.slice(0, 80)) {
                if (Object.keys(files).length >= 60 || total > 1_400_000) { skipped++; continue; }
                list.replaceChildren(h('small', { class: 'cd-hint', text: `Lade ${Object.keys(files).length + 1}/${Math.min(cand.length, 60)}: ${x.path}` }));
                const res = await gh(`/repos/${r.full_name}/contents/${x.path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(r.default_branch || 'HEAD')}`, { raw: true });
                const bytes = new Uint8Array(await res.arrayBuffer());
                const v = window.CodenUpload.inspect({ name: x.path.split('/').pop(), size: bytes.length, bytes });
                if (!v.ok || v.kind !== 'text') { skipped++; continue; }   // Bilder, Programme, Archive usw. werden nicht übernommen
                files[x.path] = new TextDecoder('utf-8').decode(bytes); total += files[x.path].length;
            }
            if (!files['index.html']) throw new Error('index.html konnte nicht gelesen werden.');
            m.close();
            await onImport(r.name, files);
            toast(`Importiert: ${Object.keys(files).length} Dateien${skipped ? ` (${skipped} übersprungen: Bilder, Binärdateien oder zu groß)` : ''}`, { type: 'ok' });
        } catch (e) { err.textContent = e.message; q.dispatchEvent(new Event('input')); }
        busy = false;
    };
    q.addEventListener('input', draw);
    const m = modal('Von GitHub öffnen', h('div', {}, h('p', { class: 'cd-text' }, 'Konto: ', h('b', { text: '@' + me.login })), q, err, list), { wide: true });
    try { repos = await gh('/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator'); draw(); }
    catch (e) { list.replaceChildren(); err.textContent = e.message; }
}
