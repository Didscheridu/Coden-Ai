// js/memory-ui.js – Gedächtnis als Liste in den Einstellungen: suchen, einzeln ändern, löschen, pro Projekt getrennt.
import { Personal } from './chat-tools.js';
import { Projects } from './projects.js';
import { toast } from './toast.js';
import { h, icon } from './apps/dom.js';
import { confirmBox } from './apps/dialogs.js';

let projectNames = null; // Map Projekt-Id → Name
async function loadNames() {
    if (projectNames) return projectNames;
    try { projectNames = new Map((await Projects.list()).map(p => [Number(p.id), p.name])); } catch (_) { projectNames = new Map(); }
    return projectNames;
}
document.addEventListener('projectsChanged', () => { projectNames = null; });

export async function renderMemory(host = document.getElementById('memory-ui')) {
    if (!host) return;
    const names = await loadNames();
    let query = '';
    const A = window.CodenAssist;
    const scopeLabel = (m) => (m.p ? 'Projekt: ' + (names.get(m.p) || 'gelöscht') : 'Überall');

    const list = h('div', { class: 'mem-list' });
    const search = h('input', { class: 'cd-input mem-search', type: 'search', placeholder: 'Im Gedächtnis suchen …', 'aria-label': 'Gedächtnis durchsuchen', oninput: () => { query = search.value; drawList(); } });
    const count = h('span', { class: 'mem-count' });
    const scope = h('select', { class: 'cd-input mem-scope', 'aria-label': 'Wo soll das gelten?' }, h('option', { value: '', text: 'Überall' }), ...[...names].map(([id, n]) => h('option', { value: String(id), text: 'Nur Projekt: ' + n })));
    const input = h('input', { class: 'cd-input mem-in', placeholder: 'Etwas hinzufügen, z. B. „Ich lerne gerade Python“', maxlength: A.MEM.len, 'aria-label': 'Neuer Gedächtnis-Eintrag' });
    const add = () => {
        const r = Personal.add(input.value, scope.value ? Number(scope.value) : null);
        if (!r.added) { toast({ 'zu kurz': 'Schreib etwas mehr.', 'schon da': 'Das weiß Coden schon.', voll: `Das Gedächtnis ist voll (${A.MEM.max}). Lösche zuerst etwas.` }[r.reason] || 'Das ging nicht.', { type: 'warn' }); return; }
        input.value = ''; drawList();
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });

    function row(m) {
        const text = h('span', { class: 'mem-t', text: m.t, title: 'Zum Ändern antippen', tabindex: 0, role: 'button' });
        const startEdit = () => {
            const f = h('input', { class: 'cd-input mem-edit', value: m.t, maxlength: A.MEM.len, 'aria-label': 'Eintrag ändern' });
            const done = (save) => { if (save && f.value.trim() && f.value.trim() !== m.t) Personal.edit(m.id, f.value); drawList(); };
            f.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); done(true); } else if (e.key === 'Escape') done(false); });
            f.addEventListener('blur', () => done(true));
            text.replaceWith(f); f.focus(); f.select();
        };
        text.addEventListener('click', startEdit); text.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); startEdit(); } });
        return h('div', { class: 'mem-row' }, text, h('span', { class: 'mem-scope-tag' + (m.p ? ' proj' : ''), text: scopeLabel(m) }),
            h('button', { type: 'button', class: 'cd-x', title: 'Vergessen', 'aria-label': 'Eintrag löschen', onclick: () => { Personal.remove(m.id); drawList(); } }, icon('close')));
    }
    function drawList() {
        const all = Personal.items(), shown = A.searchMemory(all, query);
        count.textContent = `${all.length} von ${A.MEM.max}`;
        search.classList.toggle('hidden', all.length < 6);
        list.replaceChildren(...(shown.length ? shown.map(row) : [h('div', { class: 'mem-empty', text: all.length ? 'Nichts gefunden.' : 'Noch nichts gemerkt. Sag Coden im Chat „Merk dir, dass …“ oder trage hier etwas ein.' })]));
        clear.classList.toggle('hidden', !all.length);
    }
    const clear = h('button', { type: 'button', class: 'cd-btn danger mem-clear', onclick: async () => { if (await confirmBox('Alles im Gedächtnis löschen? Das lässt sich nicht rückgängig machen.', { ok: 'Alles löschen', danger: true })) { Personal._write([]); drawList(); toast('Gedächtnis geleert', { type: 'ok' }); } } }, icon('delete_sweep'), ' Alles löschen');

    host.replaceChildren(
        h('div', { class: 'mem-head' }, count, clear),
        search, list,
        h('div', { class: 'mem-add' }, input, scope, h('button', { type: 'button', class: 'cd-primary', onclick: add }, icon('add'), ' Merken')),
        h('p', { class: 'settings-hint', text: 'In einem Projekt-Chat bleibt alles, was Coden sich neu merkt, in diesem Projekt. Dein Gedächtnis mit „Überall“ kennt Coden in jedem Chat. Im temporären Chat wird nichts gemerkt.' }));
    drawList();
}
