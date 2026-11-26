// js/research.js – Deep Research: Schalter „Recherche“ im +-Menü (wie bei Claude) und Einstellungen (Such-Key, Tiefe).
// Der Ablauf selbst läuft auf dem Server (server/research.js) als Hintergrund-Lauf, die Antwort kommt mit Quellenliste in den Chat.
import { apiJson } from './backend.js';
import { Storage } from './storage.js';
import { toast } from './toast.js';
import { h, icon } from './apps/dom.js';

const DEPTHS = [['quick', 'Schnell', 'drei Suchen, ein paar Quellen – dauert etwa eine Minute'], ['normal', 'Normal', 'vier Suchen, sechs gelesene Seiten – gut für die meisten Fragen'], ['deep', 'Gründlich', 'sechs Suchen, neun gelesene Seiten – dauert länger, findet mehr']];
let on = false, ph = null;
const input = () => document.getElementById('main-input');

function set(v) {
    on = !!v;
    const b = document.getElementById('ct-research'); if (b) { b.setAttribute('aria-checked', String(on)); b.querySelector('.cm-check')?.classList.toggle('off', !on); }
    const chip = document.getElementById('research-chip'); if (chip) chip.classList.toggle('hidden', !on);
    const i = input(); if (i) { if (ph === null) ph = i.placeholder; i.placeholder = on ? 'Was soll Coden recherchieren?' : ph; }
}

export const Research = {
    active: () => on,
    depth() { const d = Storage.getSettings().researchDepth; return DEPTHS.some(x => x[0] === d) ? d : 'normal'; },
    // Beim Senden: war Deep Research an? Dann einmal verbrauchen (gilt nur für diese Nachricht)
    consume() { const was = on; if (was) set(false); return was; },
    mount() {
        const b = document.getElementById('ct-research'); if (!b) return;
        b.addEventListener('click', () => { set(!on); if (on) setTimeout(() => input()?.focus(), 50); });
        // Hinweis über dem Eingabefeld, solange Recherche an ist
        const i = input();
        if (i && !document.getElementById('research-chip')) {
            const chip = h('div', { class: 'sk-picked hidden', id: 'research-chip' }, h('span', { class: 'sk-pill' }, icon('travel_explore'), 'Recherche', h('button', { type: 'button', 'aria-label': 'Recherche ausschalten', onclick: () => set(false) }, '×')));
            i.before(chip);
        }
        set(false);
    },
    toggle(v) { set(v === undefined ? !on : v); },

    async renderSettings(host = document.getElementById('research-ui')) {
        if (!host) return;
        host.replaceChildren(h('p', { class: 'settings-hint', text: 'Lade …' }));
        let o; try { o = await apiJson('/research'); } catch (e) { host.replaceChildren(h('p', { class: 'cd-err', text: 'Konnte die Einstellungen nicht laden: ' + e.message })); return; }
        const draw = (o) => {
            const cur = o.providers.find(p => p.id === o.engine);
            const card = (p) => {
                const key = h('input', { class: 'cd-input', type: 'password', placeholder: p.keyHint, autocomplete: 'off', spellcheck: 'false', 'aria-label': `${p.name} API-Key` });
                const err = h('div', { class: 'cd-err' });
                const save = h('button', { type: 'button', class: 'cd-primary', onclick: async () => {
                    err.textContent = ''; save.disabled = true;
                    try { draw(await apiJson(`/research/keys/${p.id}`, { method: 'PUT', body: JSON.stringify({ key: key.value }) })); toast(`${p.name} ist verbunden`, { type: 'ok' }); }
                    catch (e) { err.textContent = e.message; save.disabled = false; }
                } }, 'Speichern');
                return h('div', { class: 'rs-card' },
                    h('div', { class: 'rs-top' }, h('b', { text: p.name }), p.hasKey ? h('span', { class: 'rs-tag ok', text: 'verbunden' }) : null),
                    h('small', { text: p.note }),
                    p.hasKey
                        ? h('div', { class: 'rs-row' }, h('span', { class: 'rs-hint', text: `Key gespeichert (${p.hint})` }), h('button', { type: 'button', class: 'cd-btn', onclick: async () => { draw(await apiJson(`/research/keys/${p.id}`, { method: 'DELETE' })); toast('Key entfernt', { type: 'info' }); } }, 'Entfernen'))
                        : h('div', { class: 'rs-row' }, key, save),
                    err, p.hasKey ? null : h('a', { class: 'rs-link', href: p.link, target: '_blank', rel: 'noopener', text: 'Gratis-Key holen' }));
            };
            const depth = this.depth();
            host.replaceChildren(
                h('div', { class: 'rs-status' }, icon(cur ? 'travel_explore' : 'search'), h('div', {}, h('b', { text: cur ? `Suche über ${cur.name}` : o.server?.length ? 'Suche über den Coden-Server' : o.google ? 'Gratis-Suche (Google, DuckDuckGo, Bing, News)' : 'Gratis-Suche (DuckDuckGo, Bing, News)' }),
                    h('small', { text: cur ? 'Zuverlässige Treffer mit deinem eigenen Key.' : 'Funktioniert ohne Key: Coden fragt mehrere Suchdienste nacheinander, bis es Treffer gibt. Mit einem eigenen Key unten geht es noch zuverlässiger.' }))),
                h('h5', { class: 'rs-h', text: 'Such-Key (optional)' }),
                h('div', { class: 'rs-cards' }, o.providers.map(card)),
                h('p', { class: 'settings-hint', text: 'Dein Key wird verschlüsselt auf dem Server gespeichert und nur für deine Recherchen benutzt. Bei Fehlern fällt Coden automatisch auf die Gratis-Suche zurück.' }),
                h('h5', { class: 'rs-h', text: 'Wie gründlich?' }),
                h('div', { class: 'rs-depth' }, DEPTHS.map(([id, name, d]) => h('label', { class: 'rs-opt' + (id === depth ? ' on' : '') },
                    h('input', { type: 'radio', name: 'rs-depth', value: id, checked: id === depth, onchange: () => { const s = Storage.getSettings(); s.researchDepth = id; Storage.saveSettings(s); draw(o); } }),
                    h('span', {}, h('b', { text: name }), h('small', { text: d }))))));
        };
        draw(o);
    }
};
