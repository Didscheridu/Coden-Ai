// js/apps/tools.js – Werkzeug-Karten, die Coden im Chat aufrufen kann: Datenbank wählen, Frage, API-Schlüssel, Veröffentlichen.
// onAnswer({ body, display, integrations }) schickt die Antwort an Coden (body) und zeigt display im Chat.
import { h, icon } from './dom.js';

export const DATABASES = [
    { id: 'supabase', name: 'Supabase', tag: 'Postgres · Login · Echtzeit', color: '#3ecf8e', best: true, link: 'https://supabase.com/dashboard/projects',
        help: 'Supabase → dein Projekt → „Connect“ oder Project Settings → API. Kopiere die Project URL und den „anon public“ bzw. „publishable“ Key.',
        fields: [{ k: 'url', label: 'Project URL', ph: 'https://abcdefgh.supabase.co', re: /^https:\/\/[a-z0-9-]+\.supabase\.(co|in)\/?$/i, msg: 'Die URL sieht aus wie https://abcdefgh.supabase.co' }, { k: 'anonKey', label: 'anon public / publishable Key', ph: 'eyJhbGciOi… oder sb_publishable_…', check: 'supabaseKey' }],
        use: (v) => `Nutze: const sb = await Coden.db.supabase('${v.url}', '${v.anonKey}'); Lege Tabellen per <sql> an (mit Row Level Security und Policies) und sage dem Nutzer, dass er das SQL im Supabase SQL-Editor ausführen soll. Für Login: sb.auth.signUp / signInWithPassword.` },
    { id: 'firebase', name: 'Firebase', tag: 'Firestore · Login von Google', color: '#ffa000', link: 'https://console.firebase.google.com/',
        help: 'Firebase Console → Projekteinstellungen → Allgemein → „Deine Apps“ → Web-App (</>) → Konfiguration. Füge den ganzen firebaseConfig-Block ein.',
        fields: [{ k: 'config', label: 'firebaseConfig', ph: '{ apiKey: "…", authDomain: "…", projectId: "…", appId: "…" }', area: true, check: 'firebaseConfig' }],
        use: (v) => `Nutze: const fb = await Coden.db.firebase(${v.config}); const db = fb.firestore(); Login: fb.auth(). Erkläre dem Nutzer kurz, welche Firestore-Regeln er setzen soll.` },
    { id: 'appwrite', name: 'Appwrite', tag: 'Open Source · Datenbank · Login', color: '#fd366e', link: 'https://cloud.appwrite.io/',
        help: 'Appwrite Console → Projekt → Overview: Endpoint und Project ID. Unter „Platforms“ eine Web-Plattform mit deiner Coden-Adresse (oder *) hinzufügen.',
        fields: [{ k: 'endpoint', label: 'API Endpoint', ph: 'https://cloud.appwrite.io/v1', re: /^https:\/\/\S+$/, msg: 'Bitte eine https-Adresse' }, { k: 'projectId', label: 'Project ID', ph: '65f…' }, { k: 'databaseId', label: 'Database ID (optional)', ph: 'main', optional: true }],
        use: (v) => `Lade das Appwrite Web SDK per CDN (https://cdn.jsdelivr.net/npm/appwrite@16) mit Coden.loadScript und nutze new Appwrite.Client().setEndpoint('${v.endpoint}').setProject('${v.projectId}').` },
    { id: 'pocketbase', name: 'PocketBase', tag: 'Eine Datei · leicht selbst gehostet', color: '#b8dbe4', link: 'https://pockethost.io/',
        help: 'Z. B. kostenlos bei pockethost.io. Collections legst du im PocketBase-Admin an (oder Coden sagt dir, welche).',
        fields: [{ k: 'url', label: 'PocketBase-URL', ph: 'https://meine-app.pockethost.io', re: /^https:\/\/\S+$/, msg: 'Bitte eine https-Adresse' }],
        use: (v) => `Lade https://cdn.jsdelivr.net/npm/pocketbase/dist/pocketbase.umd.js mit Coden.loadScript und nutze const pb = new PocketBase('${v.url}'). Sage dem Nutzer, welche Collections und API-Regeln er anlegen soll.` },
    { id: 'mongodb', name: 'MongoDB', tag: 'Dokumente · über eine HTTPS-API', color: '#00ed64', link: 'https://www.mongodb.com/atlas',
        help: 'Browser-Apps können nicht direkt mit MongoDB sprechen. Gib die HTTPS-Adresse deiner API an (z. B. eigenes Backend vor MongoDB Atlas).',
        fields: [{ k: 'url', label: 'HTTPS-Adresse deiner API', ph: 'https://api.meine-seite.de', re: /^https:\/\/\S+$/, msg: 'Bitte eine https-Adresse' }, { k: 'apiKey', label: 'Öffentlicher Schlüssel (optional)', ph: '', optional: true }],
        use: (v) => `Nutze Coden.db.rest('${v.url}', '/pfad', { method, body${v.apiKey ? `, headers: { 'x-api-key': '${v.apiKey}' }` : ''} }). Frage nach, welche Endpunkte es gibt, falls unklar.` },
    { id: 'neon', name: 'Neon Postgres', tag: 'Serverless Postgres · Data API', color: '#00e599', link: 'https://console.neon.tech/',
        help: 'Neon Console → dein Projekt → Data API aktivieren und die REST-URL kopieren. Schreiben braucht meist einen Login (z. B. Neon Auth).',
        fields: [{ k: 'url', label: 'Data-API-URL', ph: 'https://…neon.tech/…/rest/v1', re: /^https:\/\/\S+$/, msg: 'Bitte eine https-Adresse' }],
        use: (v) => `Die Neon Data API ist PostgREST-kompatibel: Coden.db.rest('${v.url}', '/tabelle?select=*'). Gib SQL für Tabellen als <sql> aus.` },
    { id: 'instantdb', name: 'InstantDB', tag: 'Echtzeit · sehr einfach', color: '#f97316', link: 'https://www.instantdb.com/dash',
        help: 'instantdb.com/dash → neue App → App ID kopieren.',
        fields: [{ k: 'appId', label: 'App ID', ph: 'a1b2c3d4-…' }],
        use: (v) => `Lade https://cdn.jsdelivr.net/npm/@instantdb/core/dist/standalone/index.umd.js mit Coden.loadScript und nutze instant.init({ appId: '${v.appId}' }).` },
    { id: 'rest', name: 'Eigene API', tag: 'Beliebige REST-Schnittstelle', color: '#a8c7fa',
        help: 'Adresse deiner eigenen API. Sie muss CORS erlauben.',
        fields: [{ k: 'url', label: 'Basis-URL', ph: 'https://api.example.com', re: /^https:\/\/\S+$/, msg: 'Bitte eine https-Adresse' }, { k: 'apiKey', label: 'Öffentlicher Schlüssel (optional)', optional: true }],
        use: (v) => `Nutze Coden.db.rest('${v.url}', '/pfad', …).` },
    { id: 'local', name: 'Nur auf dem Gerät', tag: 'Ohne Server · Daten bleiben lokal', color: '#c4c7c5', fields: [],
        use: () => 'Der Nutzer möchte KEINE Online-Datenbank. Speichere alles mit Coden.store auf dem Gerät (nicht zwischen Geräten geteilt).' }
];

function checkValue(kind, v) {
    if (kind === 'supabaseKey') {
        if (/^sb_secret_/.test(v)) return 'Das ist ein GEHEIMER Key (sb_secret_…). Nimm den „publishable“ bzw. „anon public“ Key.';
        if (/^eyJ/.test(v)) { try { const p = JSON.parse(atob(v.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); if (p.role === 'service_role') return 'Das ist der geheime service_role-Key! Der darf nie in eine App. Nimm den „anon public“ Key.'; } catch (_) { return 'Der Key sieht nicht vollständig aus.'; } return null; }
        if (/^sb_publishable_/.test(v)) return null;
        return 'Der Key beginnt normalerweise mit eyJ… oder sb_publishable_…';
    }
    if (kind === 'firebaseConfig') {
        const cfg = {}; for (const k of ['apiKey', 'authDomain', 'projectId', 'storageBucket', 'messagingSenderId', 'appId', 'measurementId', 'databaseURL']) { const m = v.match(new RegExp(k + '["\']?\\s*:\\s*["\']([^"\']+)["\']')); if (m) cfg[k] = m[1]; }
        if (!cfg.apiKey || !cfg.projectId) return 'Darin fehlen apiKey oder projectId. Kopiere den ganzen firebaseConfig-Block.';
        return { value: JSON.stringify(cfg) };
    }
    return null;
}

const headOf = (ic, title, sub) => h('div', { class: 'tc-head' }, h('span', { class: 'tc-ic' }, icon(ic)), h('div', {}, h('b', { text: title }), sub ? h('small', { text: sub }) : null));
const doneRow = (text) => h('div', { class: 'tc-done' }, icon('check_circle'), h('span', { text }));

export function databaseCard(tool, { answered, onAnswer, current }) {
    const card = h('div', { class: 'tc' }, headOf('database', 'Datenbank verbinden', tool.reason ? `Coden braucht sie für: ${tool.reason}` : 'Damit Daten zwischen Geräten und Nutzern geteilt werden'));
    if (answered) { card.append(doneRow(answered)); card.classList.add('answered'); return card; }
    const grid = h('div', { class: 'tc-db-grid' }); const form = h('div', { class: 'tc-form' });
    const choose = (db) => {
        grid.querySelectorAll('.tc-db').forEach(b => b.classList.toggle('active', b.dataset.id === db.id));
        const inputs = {}; const err = h('div', { class: 'tc-err' });
        const prev = current && current.provider === db.id ? current : {};
        form.replaceChildren(
            db.help ? h('p', { class: 'tc-help' }, db.help, db.link ? h('a', { href: db.link, target: '_blank', rel: 'noopener' }, ' Öffnen ', icon('open_in_new')) : null) : null,
            ...db.fields.map(f => { const inp = h(f.area ? 'textarea' : 'input', { class: 'tc-input', placeholder: f.ph || '', value: prev[f.k] || '', spellcheck: 'false', autocomplete: 'off', rows: f.area ? 4 : null }); inputs[f.k] = inp; return h('label', { class: 'tc-field' }, h('span', { text: f.label }), inp); }),
            db.fields.length ? h('small', { class: 'tc-warn' }, icon('shield'), ' Nur öffentliche Schlüssel eingeben. Sie landen im Code deiner App. Geheime Schlüssel (service_role, Passwörter) niemals.') : null,
            err,
            h('div', { class: 'tc-row' }, h('button', { class: 'tc-primary', onclick: () => {
                const v = { provider: db.id };
                for (const f of db.fields) {
                    let val = inputs[f.k].value.trim();
                    if (!val && !f.optional) { err.textContent = `Bitte „${f.label}“ ausfüllen.`; inputs[f.k].focus(); return; }
                    if (val && f.re && !f.re.test(val)) { err.textContent = f.msg || 'Ungültiger Wert.'; inputs[f.k].focus(); return; }
                    if (val && f.check) { const c = checkValue(f.check, val); if (typeof c === 'string') { err.textContent = c; inputs[f.k].focus(); return; } if (c && c.value) val = c.value; }
                    if (val) v[f.k] = val.replace(/\/$/, '');
                }
                const lines = db.fields.filter(f => v[f.k]).map(f => `${f.label}: ${v[f.k]}`).join('\n');
                onAnswer({ body: `[Werkzeug database] Der Nutzer hat gewählt: ${db.name}.\n${lines}\n${db.use(v)}\nMach jetzt mit der Aufgabe weiter.`, display: db.id === 'local' ? '💾 Ohne Online-Datenbank (Daten bleiben auf dem Gerät)' : `🗄️ ${db.name} verbunden`, integrations: { database: { ...v, label: db.name } } });
            } }, icon('link'), db.id === 'local' ? ' So machen' : ' Verbinden')));
        setTimeout(() => form.querySelector('input,textarea')?.focus(), 30);
    };
    DATABASES.forEach(db => grid.append(h('button', { class: 'tc-db', 'data-id': db.id, onclick: () => choose(db) }, h('span', { class: 'tc-logo', style: { background: db.color }, text: db.name[0] }), h('span', { class: 'tc-db-t' }, h('b', { text: db.name }), h('small', { text: db.tag })), db.best ? h('em', { text: 'Empfohlen' }) : null)));
    card.append(grid, form);
    if (current?.provider) { const db = DATABASES.find(d => d.id === current.provider); if (db) choose(db); }
    return card;
}

export function askCard(tool, { answered, onAnswer }) {
    const card = h('div', { class: 'tc' }, headOf('help', tool.body || 'Coden hat eine Frage'));
    if (answered) { card.append(doneRow(answered)); card.classList.add('answered'); return card; }
    const send = (t) => { if (t) onAnswer({ body: `[Antwort auf deine Frage "${tool.body}"] ${t}`, display: t }); };
    const free = h('input', { class: 'tc-input', placeholder: 'Eigene Antwort …' }); free.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(free.value.trim()); });
    card.append(h('div', { class: 'tc-opts' }, tool.options.map(o => h('button', { class: 'tc-opt', text: o, onclick: () => send(o) }))), h('div', { class: 'tc-row' }, free, h('button', { class: 'tc-primary', onclick: () => send(free.value.trim()) }, icon('send'))));
    return card;
}

export function secretCard(tool, { answered, onAnswer }) {
    const card = h('div', { class: 'tc' }, headOf('key', tool.label || `Schlüssel ${tool.key}`, tool.key));
    if (answered) { card.append(doneRow(answered)); card.classList.add('answered'); return card; }
    const inp = h('input', { class: 'tc-input', type: 'password', placeholder: 'Schlüssel einfügen', autocomplete: 'off', spellcheck: 'false' });
    const send = () => { const v = inp.value.trim(); if (!v) return inp.focus(); onAnswer({ body: `[Werkzeug secret] ${tool.key} = ${v}\nBaue ihn ein (z. B. in config.js) und mach weiter.`, display: `🔑 ${tool.label || tool.key} eingegeben`, integrations: { secrets: { [tool.key || 'KEY']: v } }, mergeSecrets: true }); };
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
    card.append(tool.url ? h('p', { class: 'tc-help' }, 'Hier bekommst du ihn: ', h('a', { href: /^https:\/\//.test(tool.url) ? tool.url : '#', target: '_blank', rel: 'noopener', text: tool.url })) : null,
        h('small', { class: 'tc-warn' }, icon('shield'), ' Nur öffentliche Client-Schlüssel – er ist im Code der App sichtbar.'),
        h('div', { class: 'tc-row' }, inp, h('button', { class: 'tc-btn', title: 'Anzeigen', onclick: () => { inp.type = inp.type === 'password' ? 'text' : 'password'; } }, icon('visibility')), h('button', { class: 'tc-primary', onclick: send }, icon('check'), ' Speichern')));
    return card;
}

export function publishCard(tool, { onPublish, published }) {
    return h('div', { class: 'tc' }, headOf('rocket_launch', published ? 'Deine App ist online' : 'Bereit zum Veröffentlichen?', published ? 'Änderungen sind sofort live.' : 'Bekomme eine eigene Coden-Adresse, die jeder öffnen kann.'),
        h('div', { class: 'tc-row' }, h('button', { class: 'tc-primary', onclick: onPublish }, icon('public'), published ? ' Adresse ansehen' : ' Veröffentlichen …')));
}
