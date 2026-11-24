// js/assistants.js – Eigene Assistenten (wie GPTs bei ChatGPT, Gems bei Gemini): Name, Symbol und Anweisungen.
// Gespeichert in den Einstellungen (wird mit dem Konto synchronisiert). Ausgewählt wird pro Chat über den Knopf am Eingabefeld.
// Die Logik (Grenzen, Prüfungen, Vorlagen) steckt in shared/assist-core.js und ist dort getestet.
import { Storage } from './storage.js';
import { toast } from './toast.js';
import { h, icon } from './apps/dom.js';
import { confirmBox } from './apps/dialogs.js';
import * as M from './menu.js';

const A = () => window.CodenAssist;
const changed = () => document.dispatchEvent(new CustomEvent('assistantsChanged'));

export const Assistants = {
    list: () => A().assistants(Storage.getSettings()),
    get(id) { return id ? A().findAssistant(this.list(), id) : null; },
    prompt(id) { return A().assistantPrompt(this.get(id)); },
    save(a) {
        const r = A().upsertAssistant(this.list(), a);
        if (r.error) return r;
        const s = Storage.getSettings(); s.assistants = r.list; Storage.saveSettings(s); changed();
        return r;
    },
    remove(id) { const s = Storage.getSettings(); s.assistants = A().removeAssistant(this.list(), id); Storage.saveSettings(s); changed(); },
    startChat(id, text = '') { document.dispatchEvent(new CustomEvent('startAssistantChat', { detail: { assistantId: id, text } })); },

    // ---------- Verwaltung in den Einstellungen ----------
    renderSettings(host = document.getElementById('assistants-ui')) {
        if (!host) return;
        const draw = () => {
            const list = this.list();
            const used = new Set(list.map(a => a.name.toLowerCase()));
            const free = A().TEMPLATES.filter(t => !used.has(t.name.toLowerCase()));
            const edit = (a) => this.renderEditor(host, a, draw);
            host.replaceChildren(
                h('div', { class: 'as-head' }, h('span', { class: 'as-count', text: `${list.length} von ${A().AS.max}` }),
                    h('button', { type: 'button', class: 'cd-primary as-new', onclick: () => edit({}) }, icon('add'), ' Neuer Assistent')),
                list.length ? h('div', { class: 'as-list' }, list.map(a => h('div', { class: 'as-card' },
                    h('div', { class: 'as-emoji', text: a.emoji, 'aria-hidden': 'true' }),
                    h('div', { class: 'as-info' }, h('b', { text: a.name }), h('small', { text: a.desc || a.instructions.slice(0, 90) })),
                    h('div', { class: 'as-btns' },
                        h('button', { type: 'button', class: 'cd-btn', title: 'Neuen Chat mit diesem Assistenten starten', onclick: () => { document.getElementById('close-settings')?.click(); this.startChat(a.id); } }, icon('chat'), ' Chat'),
                        h('button', { type: 'button', class: 'cd-x', title: 'Bearbeiten', 'aria-label': 'Bearbeiten', onclick: () => edit(a) }, icon('edit')),
                        h('button', { type: 'button', class: 'cd-x', title: 'Löschen', 'aria-label': 'Löschen', onclick: async () => { if (await confirmBox(`Assistent „${a.name}“ löschen? Chats, in denen er aktiv war, laufen danach ohne ihn weiter.`, { ok: 'Löschen', danger: true })) { this.remove(a.id); draw(); } } }, icon('delete')))))) :
                    h('div', { class: 'as-empty' }, icon('smart_toy'), h('p', { text: 'Noch kein Assistent. Ein Assistent ist eine Rolle mit eigenen Anweisungen, zum Beispiel ein Lernhelfer oder ein Code-Reviewer. Starte mit einer Vorlage oder schreibe deinen eigenen.' })),
                free.length ? h('div', { class: 'as-tpl' }, h('h5', { text: 'Vorlagen' }), h('div', { class: 'as-chips' }, free.map(t => h('button', { type: 'button', class: 'as-chip', title: t.desc, onclick: () => edit({ ...t, id: undefined }) }, h('span', { text: t.emoji }), ' ' + t.name)))) : null);
        };
        draw();
    },
    renderEditor(host, a, back) {
        const isNew = !a.id;
        const emoji = h('input', { class: 'cd-input as-emoji-in', value: a.emoji || '🤖', maxlength: 4, 'aria-label': 'Symbol' });
        const name = h('input', { class: 'cd-input', value: a.name || '', maxlength: A().AS.name, placeholder: 'Name, z. B. Mathe-Hilfe' });
        const desc = h('input', { class: 'cd-input', value: a.desc || '', maxlength: A().AS.desc, placeholder: 'Kurze Beschreibung (optional)' });
        const ins = h('textarea', { class: 'cd-input as-ins', rows: 9, maxlength: A().AS.instr, placeholder: 'Wie soll dieser Assistent arbeiten? Zum Beispiel: „Erkläre alles in einfachen Schritten und stelle am Ende eine Kontrollfrage.“' }); ins.value = a.instructions || '';
        const err = h('div', { class: 'cd-err' });
        const count = h('small', { class: 'as-chars' });
        const upd = () => { count.textContent = `${ins.value.length} / ${A().AS.instr}`; }; ins.addEventListener('input', upd); upd();
        const ok = h('button', { type: 'button', class: 'cd-primary', onclick: () => {
            const r = this.save({ id: a.id, name: name.value, emoji: emoji.value, desc: desc.value, instructions: ins.value });
            if (r.error) { err.textContent = r.error; return; }
            toast(isNew ? 'Assistent angelegt' : 'Gespeichert', { type: 'ok' }); back();
        } }, icon('save'), ' Speichern');
        host.replaceChildren(h('div', { class: 'as-edit' },
            h('h5', { text: isNew ? 'Neuer Assistent' : 'Assistent bearbeiten' }),
            h('div', { class: 'as-row' }, h('div', { class: 'as-col s' }, h('label', { class: 'cd-label', text: 'Symbol' }), emoji), h('div', { class: 'as-col' }, h('label', { class: 'cd-label', text: 'Name' }), name)),
            h('label', { class: 'cd-label', text: 'Beschreibung' }), desc,
            h('label', { class: 'cd-label', text: 'Anweisungen' }), ins, count, err,
            h('div', { class: 'cd-row end' }, h('button', { type: 'button', class: 'cd-btn', onclick: back }, 'Abbrechen'), ok)));
        name.focus();
    }
};

// ---------- Auswahl im Chat: Untermenü „+ → Assistent“ + kompakter Hinweis-Chip, wenn einer aktiv ist ----------
export function mountAssistantPicker({ session, persist }) {
    const btn = document.getElementById('assistant-btn');
    if (!btn) return { redraw() {} };
    const inputBox = btn.closest('.input-box');
    let activeChip = document.getElementById('assistant-active-chip');
    if (!activeChip && inputBox) {
        activeChip = document.createElement('div');
        activeChip.id = 'assistant-active-chip';
        activeChip.className = 'as-active-bar hidden';
        const ta = inputBox.querySelector('#main-input');
        if (ta) ta.before(activeChip); else inputBox.prepend(activeChip);
    }
    const active = () => Assistants.get(session()?.assistantId);
    const choose = (id) => {
        const s = session();
        if (!s) return;
        if (id) s.assistantId = id; else delete s.assistantId;
        persist();
        redraw();
    };
    const build = (panel) => {
        const cur = session()?.assistantId, list = Assistants.list();
        panel.append(M.item({ icon: 'person', label: 'Kein Assistent', desc: 'Coden wie gewohnt', checked: !cur, onClick: () => choose(null) }));
        for (const a of list) panel.append(M.item({ emoji: a.emoji, label: a.name, desc: a.desc || a.instructions.slice(0, 70), checked: a.id === cur, onClick: () => choose(a.id) }));
        const free = list.length ? [] : A().TEMPLATES.slice(0, 4);
        if (free.length) {
            panel.append(M.sep(), M.group('Vorlagen zum Ausprobieren'));
            for (const t of free) panel.append(M.item({ emoji: t.emoji, label: t.name, desc: t.desc, onClick: () => { const r = Assistants.save({ ...t, id: undefined }); if (r.error) { toast(r.error, { type: 'warn' }); return; } choose(r.assistant.id); toast(`„${t.name}“ ist jetzt aktiv. Bearbeiten kannst du ihn in den Einstellungen.`, { type: 'ok' }); } }));
        }
        panel.append(M.sep(), M.item({ icon: 'tune', label: 'Assistenten verwalten', onClick: () => window.dispatchEvent(new CustomEvent('coden:settings', { detail: { tab: 'assistants' } })) }));
    };
    M.attachSub(btn, build);
    const redraw = () => {
        const a = active();
        const meta = btn.querySelector('.cm-meta') || (() => { const m = h('span', { class: 'cm-meta' }); btn.querySelector('.cm-chev')?.before(m); return m; })();
        meta.textContent = a ? a.name : '';
        btn.title = a ? `Assistent: ${a.name}` : 'Assistent wählen';
        if (activeChip) {
            if (a) {
                activeChip.classList.remove('hidden');
                const openBtn = h('button', { type: 'button', class: 'ca-chip as-chip-pill', title: 'Assistent wechseln', onclick: (e) => { e.stopPropagation(); document.getElementById('composer-plus-btn')?.click(); setTimeout(() => btn.click(), 30); } },
                    h('span', { class: 'as-btn-emoji', text: a.emoji, 'aria-hidden': 'true' }),
                    h('span', { class: 'ca-chip-name', text: a.name }));
                const clearBtn = h('button', { type: 'button', class: 'as-chip-clear', title: 'Assistent deaktivieren', 'aria-label': 'Assistent entfernen', onclick: (e) => { e.stopPropagation(); choose(null); } }, '×');
                openBtn.append(clearBtn);
                activeChip.replaceChildren(openBtn);
            } else { activeChip.classList.add('hidden'); activeChip.replaceChildren(); }
        }
    };
    document.addEventListener('assistantsChanged', redraw);
    redraw();
    return { redraw };
}
