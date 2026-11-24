// js/assistants.js – Eigene Assistenten (wie GPTs bei ChatGPT, Gems bei Gemini): Name, Symbol und Anweisungen.
// Gespeichert in den Einstellungen (wird mit dem Konto synchronisiert). Ausgewählt wird pro Chat über den Knopf am Eingabefeld.
// Die Logik (Grenzen, Prüfungen, Vorlagen) steckt in shared/assist-core.js und ist dort getestet.
import { Storage } from './storage.js';
import { toast } from './toast.js';
import { h, icon } from './apps/dom.js';
import { confirmBox } from './apps/dialogs.js';

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

// ---------- Auswahl im Chat: im +-Menü + kompakter Hinweis-Chip wenn aktiv ----------
export function mountAssistantPicker({ session, persist }) {
    const btn = document.getElementById('assistant-btn'), pop = document.getElementById('assistant-popup');
    if (!btn || !pop) return { redraw() {} };
    const inputBox = btn.closest('.input-box') || pop.parentElement;
    let activeChip = document.getElementById('assistant-active-chip');
    if (!activeChip && inputBox) {
        activeChip = document.createElement('div');
        activeChip.id = 'assistant-active-chip';
        activeChip.className = 'as-active-bar hidden';
        const ta = inputBox.querySelector('#main-input');
        if (ta) ta.before(activeChip); else inputBox.prepend(activeChip);
    }

    const active = () => Assistants.get(session()?.assistantId);
    const closeTools = () => {
        document.getElementById('composer-tools-menu')?.classList.add('hidden');
        document.getElementById('composer-plus-btn')?.setAttribute('aria-expanded', 'false');
    };

    const choose = (id) => {
        const s = session();
        if (!s) return;
        if (id) s.assistantId = id;
        else delete s.assistantId;
        persist();
        redraw();
        pop.classList.add('hidden');
    };

    const redraw = () => {
        const a = active();
        btn.classList.toggle('on', !!a);
        btn.replaceChildren(
            a ? h('span', { className: 'as-btn-emoji', text: a.emoji, 'aria-hidden': 'true' }) : icon('smart_toy'),
            h('span', { className: 'ct-label', textContent: a ? `Assistent: ${a.name}` : 'Assistent wählen' })
        );
        btn.title = a ? `Assistent: ${a.name} (zum Wechseln tippen)` : 'Assistent wählen';
        btn.setAttribute('aria-label', btn.title);

        if (activeChip) {
            if (a) {
                activeChip.classList.remove('hidden');
                const openBtn = h('button', { type: 'button', className: 'ca-chip as-chip-pill', title: 'Assistent wechseln', onclick: (e) => { e.stopPropagation(); open(); } },
                    h('span', { className: 'as-btn-emoji', text: a.emoji, 'aria-hidden': 'true' }),
                    h('span', { className: 'ca-chip-name', text: a.name })
                );
                const clearBtn = h('button', { type: 'button', className: 'as-chip-clear', title: 'Assistent deaktivieren', 'aria-label': 'Assistent entfernen', onclick: (e) => { e.stopPropagation(); choose(null); } }, '×');
                openBtn.append(clearBtn);
                activeChip.replaceChildren(openBtn);
            } else {
                activeChip.classList.add('hidden');
                activeChip.replaceChildren();
            }
        }
    };

    const open = () => {
        closeTools();
        const cur = session()?.assistantId, list = Assistants.list();
        const item = (a) => h('button', { type: 'button', class: 'as-opt' + ((a && a.id === cur) || (!a && !cur) ? ' on' : ''), onclick: () => choose(a?.id) },
            a ? h('span', { class: 'as-opt-emoji', text: a.emoji, 'aria-hidden': 'true' }) : icon('person'),
            h('span', { class: 'as-opt-t' }, h('b', { text: a ? a.name : 'Kein Assistent' }), h('small', { text: a ? (a.desc || a.instructions.slice(0, 60)) : 'Coden wie gewohnt' })),
            (a && a.id === cur) || (!a && !cur) ? icon('check', 'as-check') : null);
        const addTpl = (t) => { const r = Assistants.save({ ...t, id: undefined }); if (r.error) { toast(r.error, { type: 'warn' }); return; } choose(r.assistant.id); toast(`„${t.name}“ ist jetzt aktiv. Bearbeiten kannst du ihn in den Einstellungen.`, { type: 'ok' }); };
        const free = list.length ? [] : A().TEMPLATES.slice(0, 4);
        pop.replaceChildren(
            item(null), ...list.map(item),
            free.length ? h('div', { class: 'as-sep', text: 'Vorlagen zum Ausprobieren' }) : null,
            ...free.map(t => h('button', { type: 'button', class: 'as-opt', onclick: () => addTpl(t) }, h('span', { class: 'as-opt-emoji', text: t.emoji, 'aria-hidden': 'true' }), h('span', { class: 'as-opt-t' }, h('b', { text: t.name }), h('small', { text: t.desc })), icon('add'))),
            h('button', { type: 'button', class: 'as-opt manage', onclick: () => { pop.classList.add('hidden'); window.dispatchEvent(new CustomEvent('coden:settings', { detail: { tab: 'assistants' } })); } }, icon('tune'), h('span', { class: 'as-opt-t' }, h('b', { text: 'Assistenten verwalten' }))));
        pop.classList.remove('hidden');
        const box = pop.parentElement.getBoundingClientRect();
        const above = box.top - 12, below = window.innerHeight - box.bottom - 12;
        const down = above < 340 && below > above;
        pop.classList.toggle('down', down);
        pop.style.maxHeight = Math.max(160, Math.min(420, down ? below : above)) + 'px';
    };
    btn.addEventListener('click', (e) => { e.stopPropagation(); pop.classList.contains('hidden') ? open() : pop.classList.add('hidden'); });
    document.addEventListener('click', (e) => { if (!pop.classList.contains('hidden') && !pop.contains(e.target) && !btn.contains(e.target) && (!activeChip || !activeChip.contains(e.target))) pop.classList.add('hidden'); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') pop.classList.add('hidden'); });
    document.addEventListener('assistantsChanged', redraw);
    redraw();
    return { redraw };
}
