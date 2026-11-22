// js/apps/apps.js – der Tab "Apps": Übersicht aller Apps, Assistent für neue Apps (Typ → Stil → Idee) und der Builder.
import { ghImport } from './github.js';
import { apiJson } from '../backend.js';
import { Router } from '../router.js';
import { toast } from '../toast.js';
import { h, icon, timeAgo, copy } from './dom.js';
import { KINDS, scaffold, fromArtifact } from './templates.js';
import { GAME_TEMPLATES } from './games.js';
import { mountBuilder, stylePreview, loadStyleFonts } from './builder.js';
import { confirmBox } from './dialogs.js';
import { auth } from '../auth.js';
import { bindEffortButtons } from '../effort.js';

const S = () => window.CodenStyles;
let active = null;

export const AppsView = {
    async mount(host, params) {
        if (params[0] === 'neu' || params[0] === 'new') return wizard(host);
        if (params[0] && /^\d+$/.test(params[0])) { active = mountBuilder(host, +params[0]); return; }
        return gallery(host);
    },
    unmount() { active?.unmount?.(); active = null; }
};

// Neue App direkt anlegen (z. B. aus einem Artefakt) und öffnen
export async function createApp({ name, kind, style = '', files, prompt, template }) {
    const r = await apiJson('/apps', { method: 'POST', body: JSON.stringify({ name, kind, style, files: files || scaffold(kind, name, template) }) });
    if (prompt) sessionStorage.setItem('coden_app_prompt_' + r.app.id, prompt);
    Router.go('apps/' + r.app.id);
    return r.app;
}
document.addEventListener('artifactToApp', async (e) => {
    const a = e.detail; if (!a) return;
    try { await createApp({ name: a.title || 'Meine Webseite', kind: 'web', files: fromArtifact(a.title || 'Webseite', a.body) }); toast('Als App übernommen – jetzt mit Coden weiterbauen', { type: 'ok' }); }
    catch (err) { toast(err.message, { type: 'error' }); }
});

// ---------- Übersicht ----------
async function gallery(host) {
    const grid = h('div', { class: 'ap-grid' });
    const filters = h('div', { class: 'ap-filters' });
    let all = [], filter = localStorage.getItem('coden_apps_filter') || 'all';
    const page = h('div', { class: 'ap-page' },
        h('div', { class: 'ap-hero' },
            h('div', {}, h('h1', { text: 'Apps' }), h('p', { text: 'Baue Webseiten und Handy-Apps mit Coden – mit Live-Vorschau, eigener Adresse und zum Installieren aufs Handy.' })),
            h('div', { class: 'ap-actions' },
                h('button', { class: 'ap-gh', title: 'Ein GitHub-Repository als App öffnen', onclick: () => ghImport((name, files) => createApp({ name, kind: 'web', files })) }, icon('code'), 'Von GitHub'),
                h('button', { class: 'ap-new', onclick: () => Router.go('apps/neu') }, icon('add'), 'Neue App'))),
        filters, grid);
    host.append(page);
    grid.append(...Array.from({ length: 3 }, () => h('div', { class: 'ap-card skeleton' })));
    const drawFilters = () => filters.replaceChildren(...[['all', 'Alle'], ['web', 'Webseiten'], ['mobile', 'Handy-Apps'], ['game', 'Spiele'], ['shared', 'Geteilt'], ['live', 'Online']].map(([k, l]) =>
        h('button', { class: 'ap-chip' + (filter === k ? ' active' : ''), onclick: () => { filter = k; localStorage.setItem('coden_apps_filter', k); drawFilters(); draw(); } }, l, h('span', { text: String(count(k)) }))));
    const match = (a, k) => k === 'all' || (k === 'web' && a.kind === 'web') || (k === 'mobile' && !['web', 'game'].includes(a.kind)) || (k === 'game' && a.kind === 'game') || (k === 'shared' && (a.members > 1 || a.role !== 'owner')) || (k === 'live' && a.published);
    const count = (k) => all.filter(a => match(a, k)).length;
    const draw = () => {
        const list = all.filter(a => match(a, filter));
        if (!all.length) {
            grid.replaceChildren(h('div', { class: 'ap-empty wide' }, h('div', { class: 'ap-empty-art' }, icon('phone_iphone'), icon('language'), icon('android')),
                h('h2', { text: 'Deine erste App wartet' }), h('p', { text: 'Wähle, ob es eine Webseite oder eine Handy-App wird, such dir einen Stil aus und beschreibe deine Idee. Coden baut sie live vor deinen Augen.' }),
                h('button', { class: 'ap-new', onclick: () => Router.go('apps/neu') }, icon('add'), 'App erstellen'),
                h('div', { class: 'ap-examples' }, [['Habit-Tracker', 'both', 'Ein Habit-Tracker mit täglichen Zielen, Serien und schönen Statistiken'], ['Café-Webseite', 'web', 'Eine Webseite für ein gemütliches Café mit Speisekarte, Öffnungszeiten und Karte'], ['Quiz-App', 'android', 'Eine Quiz-App mit Kategorien, Punkten und Bestenliste'], ['Jump & Run', 'game', 'Ein Jump & Run mit Leveln, Münzen und Gegnern']].map(([n, k, p]) =>
                    h('button', { class: 'ap-example', onclick: () => { sessionStorage.setItem('coden_wizard', JSON.stringify({ name: n, kind: k, idea: p })); Router.go('apps/neu'); } }, icon(KINDS[k].icon), h('b', { text: n }), h('small', { text: KINDS[k].label }))))));
            filters.classList.add('hidden'); return;
        }
        filters.classList.remove('hidden');
        grid.replaceChildren(h('button', { class: 'ap-card add', onclick: () => Router.go('apps/neu') }, icon('add'), h('b', { text: 'Neue App' })), ...(list.length ? list.map(card) : [h('p', { class: 'ap-none', text: 'Keine Apps in dieser Auswahl.' })]));
    };
    const card = (a) => {
        const mobile = !['web', 'game'].includes(a.kind);
        const thumb = h('div', { class: 'ap-thumb' + (mobile ? ' mobile' : '') }, h('iframe', { src: a.testUrl + '&thumb=1', loading: 'lazy', tabindex: '-1', title: '', 'aria-hidden': 'true' }));
        return h('div', { class: 'ap-card', tabindex: '0', role: 'link', onclick: () => Router.go('apps/' + a.id), onkeydown: (e) => { if (e.key === 'Enter') Router.go('apps/' + a.id); } },
            thumb,
            h('div', { class: 'ap-info' },
                h('div', { class: 'ap-row' }, h('span', { class: 'ap-dot', style: { background: a.themeColor } }), h('b', { class: 'ap-name', text: a.name }), a.published ? h('span', { class: 'ap-live' }, h('i'), 'Live') : null),
                h('div', { class: 'ap-meta' }, icon(KINDS[a.kind].icon), h('span', { text: KINDS[a.kind].label }), h('span', { text: '·' }), h('span', { text: timeAgo(a.updatedAt) }),
                    a.members > 1 ? h('span', { class: 'ap-shared', title: a.members + ' Personen' }, icon('group'), String(a.members)) : null),
                h('div', { class: 'ap-actions' },
                    h('button', { class: 'ap-act', title: a.published ? 'Adresse kopieren' : 'Testlink kopieren', onclick: async (e) => { e.stopPropagation(); if (await copy(a.published ? a.url : a.testUrl)) toast('Link kopiert', { type: 'ok' }); } }, icon('link')),
                    h('a', { class: 'ap-act', title: 'Öffnen', href: a.published ? a.url : a.testUrl, target: '_blank', rel: 'noopener', onclick: (e) => e.stopPropagation() }, icon('open_in_new')),
                    a.role === 'owner'
                        ? h('button', { class: 'ap-act danger', title: 'App löschen', onclick: (e) => { e.stopPropagation(); remove(a, e.currentTarget.closest('.ap-card')); } }, icon('delete'))
                        : h('button', { class: 'ap-act danger', title: 'App verlassen', onclick: (e) => { e.stopPropagation(); leave(a, e.currentTarget.closest('.ap-card')); } }, icon('logout')))));
    };
    // App löschen – nur nach Bestätigung, danach verschwindet die Karte
    const drop = (a, el) => { all = all.filter(x => x.id !== a.id); el?.classList.add('removing'); setTimeout(() => { drawFilters(); draw(); }, el ? 260 : 0); };
    async function remove(a, el) {
        const ok = await confirmBox(`Willst du „${a.name}“ wirklich löschen? Alle Dateien, der Chat mit Coden und die Bilder werden endgültig gelöscht.${a.published ? ' Die Adresse ' + a.url + ' geht dann nicht mehr.' : ''} Das kann man nicht rückgängig machen.`, { ok: 'Ja, endgültig löschen', danger: true });
        if (!ok) return;
        try { await apiJson('/apps/' + a.id, { method: 'DELETE' }); drop(a, el); toast(`„${a.name}“ gelöscht`, { type: 'ok' }); }
        catch (e) { toast(e.message, { type: 'error' }); }
    }
    async function leave(a, el) {
        if (!(await confirmBox(`„${a.name}“ verlassen? Die App bleibt beim Besitzer, du siehst sie dann nicht mehr.`, { ok: 'Verlassen', danger: true }))) return;
        try { await apiJson(`/apps/${a.id}/leave`, { method: 'POST', body: '{}' }); drop(a, el); toast(`„${a.name}“ verlassen`, { type: 'ok' }); }
        catch (e) { toast(e.message, { type: 'error' }); }
    }
    try { all = (await apiJson('/apps')).apps; } catch (e) { grid.replaceChildren(h('div', { class: 'ap-empty wide' }, icon('cloud_off'), h('h2', { text: 'Apps konnten nicht geladen werden' }), h('p', { text: e.message }), h('button', { class: 'ap-new', onclick: () => location.reload() }, icon('refresh'), 'Neu laden'))); return; }
    drawFilters(); draw();
}

// ---------- Assistent: Typ → Stil → Idee ----------
function wizard(host) {
    loadStyleFonts();
    const pre = (() => { try { return JSON.parse(sessionStorage.getItem('coden_wizard') || 'null'); } catch (_) { return null; } })(); sessionStorage.removeItem('coden_wizard');
    const st = { step: pre?.kind ? 1 : 0, kind: pre?.kind || null, style: null, template: pre?.template || null, name: pre?.name || '', idea: pre?.idea || '' };
    const body = h('div', { class: 'wz-body' }); const dots = h('div', { class: 'wz-steps' });
    const page = h('div', { class: 'ap-page wz' },
        h('div', { class: 'wz-top' }, h('button', { class: 'bl-ibtn', title: 'Abbrechen', onclick: () => Router.go('apps') }, icon('close')), dots, h('span', { class: 'grow' })), body);
    host.append(page);
    const draw = () => {
        const STEPS = ['Typ', st.kind === 'game' ? 'Vorlage' : 'Stil', 'Idee'];
        dots.replaceChildren(...STEPS.map((l, i) => h('button', { class: 'wz-step' + (i === st.step ? ' active' : '') + (i < st.step ? ' done' : ''), disabled: i > st.step || (i > 0 && !st.kind), onclick: () => { st.step = i; draw(); } }, h('i', { text: i < st.step ? '✓' : String(i + 1) }), l)));
        body.replaceChildren(); body.classList.remove('anim'); void body.offsetWidth; body.classList.add('anim');
        if (st.step === 0) {
            body.append(h('h1', { text: 'Was möchtest du bauen?' }), h('p', { class: 'wz-sub', text: 'Den Typ kannst du später noch ändern.' }),
                h('div', { class: 'ap-kinds' }, Object.entries(KINDS).map(([k, v]) => h('button', { class: 'ap-kind' + (st.kind === k ? ' active' : ''), onclick: () => { st.kind = k; st.step = 1; draw(); } },
                    h('span', { class: 'ap-kic' }, icon(v.icon)), h('b', { text: v.label }), h('small', { text: v.desc }), kindArt(k)))));
        } else if (st.step === 1 && st.kind === 'game') {
            body.append(h('h1', { text: 'Mit welchem Spiel startest du?' }), h('p', { class: 'wz-sub', text: 'Jede Vorlage ist sofort spielbar (Tastatur, Maus und Touch). Danach baut Coden sie nach deinen Ideen um.' }),
                h('div', { class: 'gm-grid' }, GAME_TEMPLATES.map(t => h('button', { class: 'gm-card' + (st.template === t.id ? ' active' : ''), onclick: () => { st.template = t.id; st.style = ''; if (!st.name || GAME_TEMPLATES.some(x => x.name === st.name)) st.name = t.id === 'starter' ? '' : t.name; st.step = 2; draw(); } },
                    h('div', { class: 'gm-art', style: { background: t.g }, text: t.emoji }), h('b', { text: t.name }), h('small', { text: t.desc })))));
        } else if (st.step === 1) {
            const styles = [{ id: '', name: 'Coden entscheidet', desc: 'Coden wählt ein passendes Design' }, ...S().STYLES];
            body.append(h('h1', { text: 'Such dir einen Stil aus' }), h('p', { class: 'wz-sub' }, 'Farben, Schrift und Formen. Optional – du kannst ihn jederzeit wechseln. ', h('button', { class: 'wz-link', text: 'Überspringen', onclick: () => { st.style = ''; st.step = 2; draw(); } })),
                h('div', { class: 'ap-styles' }, styles.map(s => h('button', { class: 'ap-style' + (st.style === s.id ? ' active' : ''), onclick: () => { st.style = s.id; st.step = 2; draw(); } }, stylePreview(s), h('b', { text: s.name }), h('small', { text: s.desc })))));
        } else {
            const name = h('input', { class: 'wz-input', placeholder: st.kind === 'web' ? 'z. B. Café Sonnenschein' : 'z. B. FitTrack', maxlength: 60, value: st.name });
            const idea = h('textarea', { class: 'wz-input area', rows: 4, placeholder: 'Beschreibe deine Idee: Was soll die App können? Für wen ist sie? (optional)', value: st.idea });
            const err = h('div', { class: 'cd-err' });
            const style = S().byId(st.style);
            const create = h('button', { class: 'ap-new big', onclick: async () => {
                st.name = name.value.trim(); st.idea = idea.value.trim();
                if (!st.name) { err.textContent = 'Gib deiner App einen Namen.'; name.focus(); return; }
                create.disabled = true; create.replaceChildren(h('span', { class: 'cd-spin' }), 'Wird erstellt …');
                try { await createApp({ name: st.name, kind: st.kind, style: st.style || '', prompt: st.idea || '', template: st.template }); }
                catch (e) { err.textContent = e.message; create.disabled = false; create.replaceChildren(icon('auto_awesome'), 'App erstellen'); }
            } }, icon('auto_awesome'), 'App erstellen');
            name.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); idea.focus(); } });
            idea.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) create.click(); });
            const examples = st.kind === 'game' ? ['Mach daraus ein Weltraum-Abenteuer mit Bossgegnern', 'Füge Level, Power-ups und eine Bestenliste hinzu', 'Pixel-Art-Stil mit Retro-Musik', 'Zwei Spieler an einer Tastatur'] : st.kind === 'web' ? ['Webseite für mein Café mit Speisekarte und Öffnungszeiten', 'Mein Portfolio mit Projekten und Kontaktformular', 'Landingpage für ein Produkt mit Preisen und FAQ'] : ['To-do-App mit Kategorien und Fälligkeitsdaten', 'Habit-Tracker mit Serien und Statistiken', 'Rezept-App mit Favoriten und Einkaufsliste', 'Budget-App mit Ausgaben nach Kategorie'];
            const tpl = GAME_TEMPLATES.find(t => t.id === st.template);
            const ai = aiSettings();
            body.append(h('h1', { text: st.kind === 'game' ? 'Wie heißt dein Spiel?' : 'Wie heißt deine App?' }),
                h('div', { class: 'wz-summary' }, h('span', { class: 'bl-badge' }, icon(KINDS[st.kind].icon), KINDS[st.kind].label), st.kind === 'game' ? h('span', { class: 'bl-badge' }, icon('extension'), tpl ? tpl.emoji + ' ' + tpl.name : 'Leeres Spiel') : h('span', { class: 'bl-badge' }, icon('palette'), style ? style.name : 'Coden entscheidet')),
                h('label', { class: 'cd-label', text: 'Name' }), name, h('label', { class: 'cd-label', text: 'Idee' }), idea,
                h('div', { class: 'wz-ex' }, examples.map(t => h('button', { class: 'ap-chip', text: t, onclick: () => { idea.value = t; idea.focus(); } }))), ai, err,
                h('div', { class: 'wz-foot' }, h('button', { class: 'bl-btn', onclick: () => { st.name = name.value; st.idea = idea.value; st.step = 1; draw(); } }, icon('arrow_back'), 'Zurück'), h('span', { class: 'grow' }), create),
                h('p', { class: 'wz-note' }, icon('info'), ' Coden legt sofort ein schickes Grundgerüst an und baut dann deine Idee. Du siehst alles live.'));
            setTimeout(() => (st.name ? idea : name).focus(), 60);
        }
    };
    draw();
}

// Kleine Illustration je Typ
function kindArt(k) {
    if (k === 'game') return h('div', { class: 'ka game' }, h('span', { text: '🎮' }));
    if (k === 'web') return h('div', { class: 'ka web' }, h('i'), h('i'), h('i'));
    if (k === 'both') return h('div', { class: 'ka both' }, h('div', { class: 'ka-ph ios' }), h('div', { class: 'ka-ph android' }));
    return h('div', { class: 'ka' }, h('div', { class: 'ka-ph ' + k }));
}

// ---------- KI-Einstellungen im Assistenten: Modell, Denkaufwand, Agenten-Modus ----------
// Wird in localStorage gemerkt – der Builder startet den ersten Lauf genau damit.
const WZ_TIERS = [['flash', 'bolt', 'Flash', 'Am schnellsten'], ['normal', 'psychology', 'Thinking', 'Denkt länger nach'], ['pro', 'workspace_premium', 'Pro', 'Stark – Empfehlung für Apps'], ['ultra', 'diamond', 'Ultra', 'Nur die besten Modelle']];
const WZ_MODES = [['auto', 'smart_toy', 'Auto', 'Coden entscheidet: kleine Wünsche allein, große im Team'], ['team', 'groups', 'Team', 'Immer mehrere Spezial-Agenten parallel. Leichte Teile bekommen ein schnelles, schwere ein starkes Modell.'], ['single', 'person', 'Solo', 'Ein Agent mit dem gewählten Modell']];
function aiSettings() {
    const get = (k, d, ok) => { const v = localStorage.getItem(k); return ok.includes(v) ? v : d; };
    const isOwner = !!auth.currentUser?.isOwner;
    let tier = get('coden_app_tier', 'pro', WZ_TIERS.map(t => t[0])); if (tier === 'ultra' && !isOwner) tier = 'pro';
    let mode = get('coden_agent_mode', 'auto', WZ_MODES.map(m => m[0]));
    const seg = (items, cur, key, onPick) => h('div', { class: 'wz-seg' }, items.map(([v, ic, l, tip]) => h('button', { type: 'button', class: 'wz-opt' + (v === cur ? ' active' : ''), title: tip, 'data-v': v,
        onclick: (e) => { localStorage.setItem(key, v); e.currentTarget.parentNode.querySelectorAll('.wz-opt').forEach(b => b.classList.toggle('active', b.dataset.v === v)); onPick(v); } }, icon(ic), h('span', { text: l }))));
    const hint = h('p', { class: 'wz-ai-hint' });
    const explain = () => { const m = WZ_MODES.find(x => x[0] === mode); hint.textContent = (m ? m[3] : '') + (mode === 'team' ? ` Mittlere Aufgaben nutzen ${WZ_TIERS.find(t => t[0] === tier)[2]}.` : ''); };
    const effort = h('div', { class: 'wz-seg' }, ...[['low', 'Niedrig'], ['medium', 'Mittel'], ['high', 'Hoch']].map(([v, l]) => h('button', { type: 'button', class: 'wz-opt', 'data-effort': v, text: l })));
    bindEffortButtons(effort);
    const box = h('details', { class: 'wz-ai', open: true },
        h('summary', {}, icon('tune'), h('b', { text: 'So baut Coden' }), h('small', { text: 'Modell, Denkaufwand und Agenten' })),
        h('label', { class: 'cd-label', text: 'Modell' }), seg(WZ_TIERS.filter(t => t[0] !== 'ultra' || isOwner), tier, 'coden_app_tier', (v) => { tier = v; explain(); }),
        h('label', { class: 'cd-label', text: 'Denkaufwand' }), effort,
        h('label', { class: 'cd-label', text: 'Agenten' }), seg(WZ_MODES, mode, 'coden_agent_mode', (v) => { mode = v; explain(); }), hint);
    explain();
    return box;
}
