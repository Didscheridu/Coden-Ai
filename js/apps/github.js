// js/apps/github.js – GitHub verbinden, App als Repository speichern, Repository als App importieren.
// Der Zugriffstoken bleibt nur in diesem Browser (localStorage) und geht nie an das Coden-Backend.
import { toast } from '../toast.js';
import { h, icon } from './dom.js';
import { modal } from './dialogs.js';

const KEY = 'coden_github';
const API = 'https://api.github.com';
const FILE_RE = /^(?!.*\.\.)(?!.*\/\/)[A-Za-z0-9_][A-Za-z0-9_.\-\/]{0,99}$/;
const SKIP = /(^|\/)(node_modules|\.git|\.github|\.vscode|\.idea|dist|build|coverage)(\/|$)|(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|\.DS_Store)$/;

export const ghInfo = () => {
    try {
        const d = JSON.parse(localStorage.getItem(KEY) || 'null');
        if (!d || typeof d !== 'object' || !d.token) return null;
        return {
            token: String(d.token),
            login: String(d.login || ''),
            avatar: String(d.avatar || ''),
            accessMode: d.accessMode === 'selected' ? 'selected' : 'all',
            allowedRepos: Array.isArray(d.allowedRepos) ? [...new Set(d.allowedRepos.map(x => String(x || '').trim()).filter(x => /^[\w.-]+\/[\w.-]+$/.test(x)))] : [],
            allowCreate: typeof d.allowCreate === 'boolean' ? d.allowCreate : d.accessMode !== 'selected'
        };
    } catch (_) { return null; }
};
export const ghSaveConfig = (patch) => {
    const cur = ghInfo();
    if (!cur) return null;
    const next = { ...cur, ...patch };
    localStorage.setItem(KEY, JSON.stringify(next));
    return ghInfo();
};
export const ghDisconnect = () => { localStorage.removeItem(KEY); };
export const ghIsRepoAllowed = (fullName) => {
    const cfg = ghInfo();
    if (!cfg || cfg.accessMode !== 'selected') return true;
    const needle = String(fullName || '').trim().toLowerCase();
    return cfg.allowedRepos.some(r => r.toLowerCase() === needle);
};
export const ghAccessSummary = (cfg = ghInfo()) => {
    if (!cfg) return 'Nicht verbunden';
    if (cfg.accessMode !== 'selected') return 'Alle Repositories';
    const n = cfg.allowedRepos.length;
    return n ? `Nur ${n} ${n === 1 ? 'Repository' : 'Repositories'}` : 'Keine Repositories freigegeben';
};

async function gh(path, { method = 'GET', body, raw = false, token } = {}) {
    const cfg = ghInfo();
    const t = token || cfg?.token; if (!t) throw Object.assign(new Error('GitHub ist nicht verbunden.'), { code: 'NOAUTH' });
    if (!token && cfg?.accessMode === 'selected') {
        const rm = String(path || '').match(/^\/repos\/([^/?#]+\/[^/?#]+)/i);
        if (rm) {
            const full = decodeURIComponent(rm[1]);
            if (!ghIsRepoAllowed(full)) {
                throw Object.assign(new Error(`Zugriff blockiert: Das Repository „${full}“ ist für Coden nicht freigegeben.`), { code: 'REPO_RESTRICTED', status: 403 });
            }
        }
        if (String(method).toUpperCase() === 'POST' && /^\/user\/repos(?:$|[/?#])/.test(String(path || '')) && !cfg.allowCreate) {
            throw Object.assign(new Error('Neue Repositories sind beim eingeschränkten Zugriff deaktiviert. Aktiviere es unter „GitHub-Zugriff“ oder wähle ein freigegebenes Repository.'), { code: 'REPO_RESTRICTED', status: 403 });
        }
    }
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
        const pickScopeAfter = h('input', { type: 'checkbox' });
        const save = async (token) => {
            const prev = ghInfo();
            const u = await gh('/user', { token });
            const keep = prev && prev.login === u.login;
            localStorage.setItem(KEY, JSON.stringify({
                token,
                login: u.login,
                avatar: u.avatar_url,
                accessMode: keep ? prev.accessMode : 'all',
                allowedRepos: keep ? prev.allowedRepos : [],
                allowCreate: keep ? prev.allowCreate : true
            }));
            toast(`Mit GitHub verbunden: @${u.login}`, { type: 'ok' });
            const cfg = ghInfo();
            fin(cfg);
            if (pickScopeAfter.checked) await ghManageAccess();
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
            h('label', { class: 'cd-label', text: 'Persönlicher Zugriffstoken (Classic mit „repo“ oder Fine-Grained für einzelne Repos)' }), tokenIn,
            h('small', { class: 'cd-hint' },
                'Token erstellen: ',
                h('a', { href: 'https://github.com/settings/personal-access-tokens/new', target: '_blank', rel: 'noopener', text: 'Fine-Grained Token (einzelne Repos)' }),
                ' oder ',
                h('a', { href: 'https://github.com/settings/tokens/new?scopes=repo&description=Coden', target: '_blank', rel: 'noopener', text: 'Classic Token' }), '.'),
            h('label', { class: 'cd-check' }, pickScopeAfter, ' Danach direkt auswählen, auf welche Repositories Coden zugreifen darf'),
            err, h('div', { class: 'cd-row end' }, viaToken)), { onClose: () => fin(null) });
    });
}
export async function ensureGithub() { return ghInfo() || ghConnect(); }

// ---------- Zugriff auf bestimmte Repositories einschränken ----------
export async function ghManageAccess() {
    const me = await ensureGithub(); if (!me) return null;
    return new Promise((resolve) => {
        let done = false; const fin = (v) => { if (done) return; done = true; m.close(); resolve(v); };
        let mode = me.accessMode || 'all';
        const selected = new Set(me.allowedRepos.map(x => x.toLowerCase()));
        const displayCase = new Map(me.allowedRepos.map(x => [x.toLowerCase(), x]));
        let repos = [];
        let loaded = false;

        const scopeSeg = h('div', { class: 'gh-scope-seg' });
        const searchIn = h('input', { class: 'cd-input', placeholder: 'Repository filtern …', spellcheck: 'false' });
        const list = h('div', { class: 'gh-list' }, h('small', { class: 'cd-hint', text: 'Lade deine Repositories …' }));
        const manualIn = h('input', { class: 'cd-input', placeholder: 'owner/repository manuell hinzufügen', spellcheck: 'false', autocomplete: 'off' });
        const allowCreateChk = h('input', { type: 'checkbox', checked: mode === 'selected' ? !!me.allowCreate : false });
        const cntLabel = h('small', { class: 'gh-count' });
        const err = h('div', { class: 'cd-err' });
        const selectedArea = h('div', { class: 'gh-scope-box' });

        const visibleRepos = () => {
            const f = searchIn.value.trim().toLowerCase();
            const map = new Map();
            repos.forEach(r => map.set(r.full_name.toLowerCase(), r));
            selected.forEach(k => {
                if (!map.has(k)) map.set(k, { full_name: displayCase.get(k) || k, private: false, description: 'Manuell hinzugefügt' });
            });
            return [...map.values()].filter(r => !f || r.full_name.toLowerCase().includes(f));
        };

        const updateCount = () => {
            cntLabel.textContent = mode === 'all'
                ? 'Unbeschränkter Zugriff auf alle Repositories dieses Kontos'
                : `${selected.size} ${selected.size === 1 ? 'Repository' : 'Repositories'} freigegeben`;
        };

        const drawSeg = () => {
            scopeSeg.replaceChildren(...[
                ['all', 'public', 'Alle Repositories'],
                ['selected', 'verified_user', 'Nur ausgewählte']
            ].map(([id, ic, lbl]) => h('button', {
                type: 'button',
                class: 'gh-seg-btn' + (mode === id ? ' active' : ''),
                onclick: () => { mode = id; drawSeg(); drawBody(); }
            }, icon(ic), h('span', { text: lbl }))));
        };

        const drawList = () => {
            updateCount();
            if (!loaded && !repos.length) return;
            const rows = visibleRepos();
            if (!rows.length) {
                list.replaceChildren(h('small', { class: 'cd-hint', text: 'Keine passenden Repositories gefunden.' }));
                return;
            }
            list.replaceChildren(...rows.slice(0, 120).map(r => {
                const key = r.full_name.toLowerCase();
                const chk = h('input', {
                    type: 'checkbox',
                    checked: selected.has(key),
                    onchange: () => {
                        if (chk.checked) { selected.add(key); displayCase.set(key, r.full_name); }
                        else selected.delete(key);
                        updateCount();
                    }
                });
                return h('label', { class: 'gh-repo check' },
                    chk,
                    icon(r.private ? 'lock' : 'folder_open'),
                    h('div', { class: 'grow' },
                        h('b', { text: r.full_name }),
                        h('small', { text: r.description || (r.private ? 'Privates Repository' : 'Öffentliches Repository') })));
            }));
        };

        const addManual = () => {
            err.textContent = '';
            const val = manualIn.value.trim().replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/i, '').replace(/\/+$/, '');
            if (!/^[\w.-]+\/[\w.-]+$/.test(val)) {
                err.textContent = 'Bitte im Format owner/repository eingeben (z. B. meinname/meine-app).';
                return;
            }
            const k = val.toLowerCase();
            selected.add(k); displayCase.set(k, val);
            manualIn.value = '';
            drawList();
        };

        const drawBody = () => {
            selectedArea.classList.toggle('hidden', mode !== 'selected');
            updateCount();
            if (mode === 'selected') drawList();
        };

        searchIn.addEventListener('input', drawList);
        manualIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addManual(); } });

        selectedArea.append(
            h('div', { class: 'gh-bar' },
                searchIn,
                h('button', { type: 'button', class: 'cd-btn sm', text: 'Sichtbare wählen', onclick: () => { visibleRepos().forEach(r => { const k = r.full_name.toLowerCase(); selected.add(k); displayCase.set(k, r.full_name); }); drawList(); } }),
                h('button', { type: 'button', class: 'cd-btn sm', text: 'Alle abwählen', onclick: () => { selected.clear(); drawList(); } })),
            list,
            h('div', { class: 'gh-manual' }, manualIn, h('button', { type: 'button', class: 'cd-btn sm', text: 'Hinzufügen', onclick: addManual })),
            h('label', { class: 'cd-check' }, allowCreateChk, ' Neue Repositories beim Export erstellen erlauben')
        );

        const saveBtn = h('button', { type: 'button', class: 'cd-primary', onclick: () => {
            const listOut = [...selected].map(k => displayCase.get(k) || k);
            const updated = ghSaveConfig({
                accessMode: mode,
                allowedRepos: listOut,
                allowCreate: mode === 'all' ? true : allowCreateChk.checked
            });
            toast(mode === 'selected' ? `GitHub-Zugriff auf ${listOut.length} Repo${listOut.length === 1 ? '' : 's'} beschränkt` : 'Zugriff auf alle Repositories erlaubt', { type: 'ok' });
            fin(updated);
        } }, icon('check'), ' Speichern');

        drawSeg();
        drawBody();

        const m = modal('GitHub-Zugriff verwalten', h('div', {},
            h('div', { class: 'gh-bar' },
                h('span', { class: 'cd-text', style: 'margin:0' }, 'Konto: ', h('b', { text: '@' + me.login })),
                h('span', { class: 'grow' }),
                h('button', { type: 'button', class: 'cd-link', text: 'trennen', onclick: () => { ghDisconnect(); toast('GitHub getrennt'); fin(null); } })),
            h('p', { class: 'cd-text', text: 'Lege fest, welche Repositories Coden sehen, öffnen und beschreiben darf.' }),
            scopeSeg,
            cntLabel,
            selectedArea,
            err,
            h('div', { class: 'cd-row end' }, h('button', { type: 'button', class: 'cd-btn', text: 'Abbrechen', onclick: () => fin(null) }), saveBtn)),
        { wide: true, onClose: () => fin(null) });

        gh('/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator')
            .then(r => { repos = Array.isArray(r) ? r : []; loaded = true; drawList(); })
            .catch(e => { loaded = true; list.replaceChildren(); err.textContent = e.message; });
    });
}

// ---------- App als Repository speichern ----------
const b64 = (s) => btoa(unescape(encodeURIComponent(s)));
const slug = (s) => String(s || 'meine-app').toLowerCase().normalize('NFKD').replace(/[^\w\s.-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').slice(0, 60) || 'meine-app';

export async function ghExport({ app, files }) {
    let me = await ensureGithub(); if (!me) return;
    const savedKey = 'coden_gh_repo_' + app.id; const saved = localStorage.getItem(savedKey) || '';
    const name = h('input', { class: 'cd-input', value: saved ? saved.split('/')[1] : slug(app.name), maxlength: 80, spellcheck: 'false' });
    const priv = h('input', { type: 'checkbox', checked: true });
    const repoSel = h('select', { class: 'cd-input' });
    const newBox = h('div', {});
    const selWrap = h('div', {});
    const scopeText = h('span', { class: 'gh-scope-pill' });
    const status = h('div', { class: 'cd-hint' }); const err = h('div', { class: 'cd-err' }); const out = h('div', {});

    const go = h('button', { class: 'cd-primary', onclick: async () => {
        err.textContent = ''; out.replaceChildren(); go.disabled = true;
        try {
            me = ghInfo();
            if (!me) throw Object.assign(new Error('GitHub ist nicht verbunden.'), { code: 'NOAUTH' });
            let r; let fresh = false;
            status.textContent = 'Repository wird vorbereitet …';
            const useSelected = me.accessMode === 'selected';
            const chosen = useSelected ? repoSel.value : '__new__';
            if (useSelected && chosen !== '__new__') {
                if (!chosen) throw new Error('Wähle zuerst ein freigegebenes Repository aus oder gib unter „Zugriff ändern“ eines frei.');
                r = await gh(`/repos/${chosen}`);
            } else {
                const repo = slug(name.value);
                try {
                    r = await gh('/user/repos', { method: 'POST', body: { name: repo, description: `${app.name} – gebaut mit Coden`, private: priv.checked, auto_init: false } });
                    fresh = true;
                    if (useSelected && r?.full_name && !ghIsRepoAllowed(r.full_name)) {
                        me = ghSaveConfig({ allowedRepos: [...me.allowedRepos, r.full_name] }) || me;
                    }
                } catch (e) {
                    if (e.status === 422) r = await gh(`/repos/${me.login}/${repo}`);
                    else throw e;
                }
            }
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
        } catch (e) { status.textContent = ''; err.textContent = (e.code === 'NOAUTH' || e.code === 'REPO_RESTRICTED') ? e.message : (e.status === 403 || e.status === 404 ? 'GitHub verweigert den Zugriff. Hat der Token die Berechtigung „repo“?' : e.message); }
        go.disabled = false;
    } }, icon('upload'), ' Auf GitHub speichern');

    const syncUi = () => {
        me = ghInfo() || me;
        scopeText.textContent = ghAccessSummary(me);
        const restricted = me.accessMode === 'selected';
        selWrap.classList.toggle('hidden', !restricted);
        if (restricted) {
            const opts = me.allowedRepos.map(fn => h('option', { value: fn, text: fn, selected: fn.toLowerCase() === saved.toLowerCase() || undefined }));
            if (me.allowCreate) opts.push(h('option', { value: '__new__', text: '+ Neues Repository erstellen …' }));
            if (!opts.length) opts.push(h('option', { value: '', text: 'Kein Repository freigegeben' }));
            repoSel.replaceChildren(...opts);
            const showNew = repoSel.value === '__new__';
            newBox.classList.toggle('hidden', !showNew);
            go.disabled = !repoSel.value;
        } else {
            newBox.classList.remove('hidden');
            go.disabled = false;
        }
    };
    repoSel.addEventListener('change', () => {
        const restricted = (ghInfo() || me).accessMode === 'selected';
        newBox.classList.toggle('hidden', restricted && repoSel.value !== '__new__');
        go.disabled = restricted && !repoSel.value;
    });

    selWrap.append(h('label', { class: 'cd-label', text: 'Freigegebenes Ziel-Repository' }), repoSel);
    newBox.append(
        h('label', { class: 'cd-label', text: 'Name des Repositorys' }), name,
        h('label', { class: 'cd-check' }, priv, ' Privat (nur du siehst es)'),
        h('small', { class: 'cd-hint', text: 'Gibt es das Repository schon, werden die Dateien aktualisiert.' })
    );
    syncUi();

    const expModal = modal('Auf GitHub speichern', h('div', {},
        h('div', { class: 'gh-bar' },
            h('span', { class: 'cd-text', style: 'margin:0' }, 'Konto: ', h('b', { text: '@' + me.login })),
            scopeText,
            h('span', { class: 'grow' }),
            h('button', { type: 'button', class: 'cd-link', text: 'Zugriff ändern', onclick: async () => { const u = await ghManageAccess(); if (u) syncUi(); else if (!ghInfo()) expModal.close(); } }),
            h('button', { type: 'button', class: 'cd-link', text: 'trennen', onclick: () => { ghDisconnect(); toast('GitHub getrennt'); expModal.close(); } })),
        selWrap, newBox,
        err, status, out, h('div', { class: 'cd-row end' }, go)));
}

// ---------- Repository als App öffnen ----------
export async function ghImport(onImport) {
    let me = await ensureGithub(); if (!me) return;
    const list = h('div', { class: 'gh-list' }, h('small', { class: 'cd-hint', text: 'Lade deine Repositories …' }));
    const q = h('input', { class: 'cd-input', placeholder: 'Repository suchen …' });
    const scopeText = h('span', { class: 'gh-scope-pill' });
    const err = h('div', { class: 'cd-err' }); let repos = []; let busy = false;
    const draw = () => {
        me = ghInfo() || me;
        scopeText.textContent = ghAccessSummary(me);
        const f = q.value.trim().toLowerCase();
        const allowedList = repos.filter(r => ghIsRepoAllowed(r.full_name));
        const rows = allowedList.filter(r => r.full_name.toLowerCase().includes(f)).slice(0, 60);
        const emptyMsg = me.accessMode === 'selected' && !allowedList.length
            ? 'Kein freigegebenes Repository in der Liste. Tippe auf „Zugriff ändern“, um Repositories freizugeben.'
            : 'Nichts gefunden.';
        list.replaceChildren(...(rows.length ? rows.map(r => h('button', { class: 'gh-repo', onclick: () => pick(r) }, icon(r.private ? 'lock' : 'folder_open'), h('div', { class: 'grow' }, h('b', { text: r.full_name }), h('small', { text: r.description || 'Keine Beschreibung' })))) : [h('small', { class: 'cd-hint', text: emptyMsg })]));
    };
    const pick = async (r) => {
        if (busy) return; busy = true; err.textContent = '';
        try {
            if (!ghIsRepoAllowed(r.full_name)) throw new Error(`Zugriff blockiert: Das Repository „${r.full_name}“ ist nicht freigegeben.`);
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
        } catch (e) { err.textContent = e.message; draw(); }
        busy = false;
    };
    q.addEventListener('input', draw);
    const m = modal('Von GitHub öffnen', h('div', {},
        h('div', { class: 'gh-bar' },
            h('span', { class: 'cd-text', style: 'margin:0' }, 'Konto: ', h('b', { text: '@' + me.login })),
            scopeText,
            h('span', { class: 'grow' }),
            h('button', { type: 'button', class: 'cd-link', text: 'Zugriff ändern', onclick: async () => { await ghManageAccess(); if (!ghInfo()) m.close(); else draw(); } }),
            h('button', { type: 'button', class: 'cd-link', text: 'trennen', onclick: () => { ghDisconnect(); toast('GitHub getrennt'); m.close(); } })),
        q, err, list), { wide: true });
    try { repos = await gh('/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator'); draw(); }
    catch (e) { list.replaceChildren(); err.textContent = e.message; }
}
