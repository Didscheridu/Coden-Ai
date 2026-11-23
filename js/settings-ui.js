// js/settings-ui.js – Tabs der Einstellungen (Allgemein, Persönlich, Modelle & Keys, …)
const KEY = 'coden_settings_tab';
export function showSettingsTab(name) {
    const box = document.getElementById('settings-box'); if (!box) return;
    const panes = [...box.querySelectorAll('.st-pane')];
    if (!panes.some(p => p.dataset.pane === name)) name = 'general';
    box.dataset.pane = name;
    box.querySelectorAll('#st-nav [data-st]').forEach(b => b.classList.toggle('active', b.dataset.st === name));
    panes.forEach(p => p.classList.toggle('hidden', p.dataset.pane !== name));
    try { localStorage.setItem(KEY, name); } catch (_) { /* privater Modus */ }
}
export function initSettingsTabs() {
    document.getElementById('st-nav')?.addEventListener('click', (e) => { const b = e.target.closest('[data-st]'); if (b) showSettingsTab(b.dataset.st); });
    // Von anderen Stellen aus öffnen, z. B. aus dem App-Builder: window.dispatchEvent(new CustomEvent('coden:settings', { detail: { tab: 'models', sub: 'app' } }))
    window.addEventListener('coden:settings', (e) => {
        document.getElementById('open-settings-btn')?.click();
        showSettingsTab(e.detail?.tab || 'general');
        if (e.detail?.sub) window.dispatchEvent(new CustomEvent('coden:byok-sub', { detail: e.detail.sub }));
    });
    let saved = 'general'; try { saved = localStorage.getItem(KEY) || 'general'; } catch (_) { /* privater Modus */ }
    showSettingsTab(saved);
}
