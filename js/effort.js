// Denkaufwand-Regler: niedrig / mittel / hoch. Gilt für den Chat und den App-Chat.
const KEY = 'coden_effort', LEVELS = ['low', 'medium', 'high'];
export const getEffort = () => { try { const v = localStorage.getItem(KEY); return LEVELS.includes(v) ? v : 'medium'; } catch (_) { return 'medium'; } };
export const setEffort = (v) => { if (!LEVELS.includes(v)) return; try { localStorage.setItem(KEY, v); } catch (_) { /* privater Modus */ } document.querySelectorAll('[data-effort]').forEach(b => b.classList.toggle('active', b.dataset.effort === v)); };
// Alle Regler auf der Seite (Chat-Menü, App-Builder) hören auf dieselbe Einstellung
export function bindEffortButtons(root = document) {
    root.querySelectorAll('[data-effort]').forEach(b => { b.classList.toggle('active', b.dataset.effort === getEffort()); b.onclick = (e) => { e.stopPropagation(); setEffort(b.dataset.effort); }; });
}
