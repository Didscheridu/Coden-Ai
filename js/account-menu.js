// js/account-menu.js – Konto-Menü unten in der Seitenleiste (Aufbau wie bei Claude) und Hilfe-Dialog für Tastenkürzel.
import * as M from './menu.js';
import { h } from './apps/dom.js';
import { modal } from './apps/dialogs.js';
import { shortcuts } from './shortcuts.js';

const $ = (id) => document.getElementById(id);
const settings = (tab) => window.dispatchEvent(new CustomEvent('coden:settings', { detail: { tab } }));

const EXTRA_HINTS = [
    ['Nachricht senden', 'Enter'],
    ['Neue Zeile', 'Umschalt+Enter'],
    ['Skill gezielt nutzen', '/name']
];

export function openHelp() {
    const rows = [
        ...shortcuts.list().filter(s => s.showInHelp).map(s => [s.label, s.displayKey]),
        ...EXTRA_HINTS.map(([t, k]) => [t, M.kbd(k)])
    ];
    modal('Hilfe & Tastenkürzel', h('div', { class: 'help-box' },
        h('div', { class: 'kb-list' }, rows.flatMap(([t, k]) => [h('span', { text: t }), h('kbd', { text: k })])),
        h('p', { class: 'cd-text', style: { marginTop: '16px' }, text: 'Fragen zu Coden? Schreib sie einfach in den Chat. Über das + am Eingabefeld erreichst du Dateien, Skills, Assistenten, deine Apps und Verbindungen.' }),
        h('div', { style: { marginTop: '14px', display: 'flex', justifyContent: 'flex-end' } },
            h('button', {
                type: 'button',
                class: 'cd-btn',
                text: 'Einführungstour starten',
                onClick: () => {
                    document.querySelector('.cd-back')?.remove();
                    import('./onboarding.js').then(m => m.Onboarding.start(true)).catch(() => {});
                }
            })
        )));
}

let installEvt = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; $('um-install')?.classList.remove('hidden'); });
window.addEventListener('appinstalled', () => { installEvt = null; $('um-install')?.classList.add('hidden'); });

export function mountAccountMenu() {
    const chip = $('user-chip'), menu = $('user-menu');
    if (!chip || !menu) return;
    M.bindMenu(chip, menu);
    // Kurzbefehle und Tooltips für Mac/Windows synchronisieren
    menu.querySelectorAll('.cm-kbd[data-kbd]').forEach((k) => { k.textContent = M.kbd(k.dataset.kbd); });
    document.querySelectorAll('#composer-tools-menu .cm-kbd[data-kbd]').forEach((k) => { k.textContent = M.kbd(k.dataset.kbd); });
    shortcuts.syncTooltips();
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
            legal('badge', 'Impressum (§ 5 DDG)', 'open-impressum-btn'),
            legal('mail', 'Kontaktformular', 'open-kontakt-btn'),
            legal('policy', 'Datenschutz', 'open-datenschutz-btn'),
            legal('description', 'Nutzungsbedingungen', 'open-agb-btn'),
            legal('smart_toy', 'KI-Transparenz (AI Act)', 'open-ki-btn'),
            M.sep(),
            M.item({ icon: 'keyboard', label: 'Tastenkürzel', kbd: shortcuts.get('open-help')?.combo ? shortcuts.formatCombo(shortcuts.get('open-help').combo) : 'Strg+.', onClick: openHelp }));
    });
}
