// js/account-menu.js – Konto-Menü unten in der Seitenleiste (Aufbau wie bei Claude) und globale Tastenkürzel.
import * as M from './menu.js';
import { h } from './apps/dom.js';
import { modal } from './apps/dialogs.js';

const $ = (id) => document.getElementById(id);
const settings = (tab) => window.dispatchEvent(new CustomEvent('coden:settings', { detail: { tab } }));

const SHORTCUTS = [
    ['Neuer Chat', 'Strg+Umschalt+O'],
    ['Dateien oder Bilder hinzufügen', 'Strg+U'],
    ['Einstellungen', 'Strg+,'],
    ['Hilfe & Tastenkürzel', 'Strg+/'],
    ['Nachricht senden', 'Enter'],
    ['Neue Zeile', 'Umschalt+Enter'],
    ['Menü schließen', 'Esc'],
    ['Skill gezielt nutzen', '/name']
];
export function openHelp() {
    modal('Hilfe & Tastenkürzel', h('div', { class: 'help-box' },
        h('div', { class: 'kb-list' }, SHORTCUTS.flatMap(([t, k]) => [h('span', { text: t }), h('kbd', { text: M.kbd(k) })])),
        h('p', { class: 'cd-text', style: { marginTop: '16px' }, text: 'Fragen zu Coden? Schreib sie einfach in den Chat. Über das + am Eingabefeld erreichst du Dateien, Skills, Assistenten, deine Apps und Verbindungen.' })));
}

let installEvt = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; $('um-install')?.classList.remove('hidden'); });
window.addEventListener('appinstalled', () => { installEvt = null; $('um-install')?.classList.add('hidden'); });

export function mountAccountMenu() {
    const chip = $('user-chip'), menu = $('user-menu');
    if (!chip || !menu) return;
    M.bindMenu(chip, menu);
    // Kurzbefehle für die Anzeige an Mac/Windows anpassen
    menu.querySelectorAll('.cm-kbd[data-kbd]').forEach((k) => { k.textContent = M.kbd(k.dataset.kbd); });
    document.querySelectorAll('#composer-tools-menu .cm-kbd[data-kbd]').forEach((k) => { k.textContent = M.kbd(k.dataset.kbd); });
    const on = (id, fn) => $(id)?.addEventListener('click', (e) => { e.preventDefault(); fn(); });
    on('um-usage', () => { settings('general'); setTimeout(() => $('usage-box')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 120); });
    on('um-skills', () => settings('skills'));
    on('um-help', openHelp);
    on('um-keys', () => settings('models'));
    on('open-email-settings-btn', () => settings('mail'));
    on('um-owner', () => { const ta = $('main-input'); if (!ta) return; location.hash = '#/chat'; ta.value = '/'; ta.dispatchEvent(new Event('input')); ta.focus(); });
    on('um-install', async () => {
        if (installEvt) { installEvt.prompt(); try { await installEvt.userChoice; } catch (_) { /* abgebrochen */ } installEvt = null; $('um-install')?.classList.add('hidden'); }
    });
    if (installEvt) $('um-install')?.classList.remove('hidden');
    M.attachSub($('um-more'), (panel) => {
        const legal = (icon, label, id) => M.item({ icon, label, onClick: () => $(id)?.click() });
        panel.append(
            legal('policy', 'Datenschutz', 'open-datenschutz-btn'),
            legal('description', 'Nutzungsbedingungen', 'open-agb-btn'),
            legal('badge', 'Impressum', 'open-impressum-btn'),
            M.sep(),
            M.item({ icon: 'keyboard', label: 'Tastenkürzel', kbd: 'Strg+/', onClick: openHelp }));
    });
}

// ---------- Tastenkürzel ----------
document.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (!mod || e.altKey) return;
    if ($('app')?.classList.contains('hidden')) return; // nicht auf dem Login-Bildschirm
    const k = e.key.toLowerCase();
    if (k === ',' && !e.shiftKey) { e.preventDefault(); M.closeAll(); $('open-settings-btn')?.click(); }
    else if (k === '/' || (k === '7' && e.shiftKey)) { e.preventDefault(); M.closeAll(); openHelp(); }
    else if (k === 'u' && !e.shiftKey) {
        if (!location.hash || location.hash.startsWith('#/chat') || location.hash === '#') { e.preventDefault(); M.closeAll(); $('file-upload-input')?.click(); }
    } else if (k === 'o' && e.shiftKey) { e.preventDefault(); M.closeAll(); $('sb-new')?.click(); }
});
