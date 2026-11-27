// js/humanizer-prefs.js – Synchronisierte Einstellungen & Bereichs-Umschalter für den Coden Humanizer
import { Storage } from './storage.js';
import { normalizeHumanizerPrefs, humanizerPromptDirective } from './humanizer-core.js';

export const HUMANIZER_CHANGED_EVENT = 'coden:humanizerChanged';

export function getHumanizerPrefs() {
    const s = Storage.getSettings();
    return normalizeHumanizerPrefs(s?.humanizer);
}

export function updateHumanizerPrefs(patch = {}) {
    const s = Storage.getSettings();
    const next = normalizeHumanizerPrefs({ ...(s?.humanizer || {}), ...patch });
    s.humanizer = next;
    Storage.saveSettings(s);
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
        window.dispatchEvent(new CustomEvent(HUMANIZER_CHANGED_EVENT, { detail: next }));
    }
    return next;
}

export function isAutoHumanizeOn(scope = 'chat') {
    const prefs = getHumanizerPrefs();
    return prefs[scope] !== false;
}

export function getAutoHumanizerPrompt(scope = 'chat') {
    const prefs = getHumanizerPrefs();
    if (prefs[scope] === false) return '';
    return humanizerPromptDirective({
        scope,
        strength: prefs.strength,
        keepTerms: prefs.keepTerms,
        shortSentences: prefs.shortSentences,
        duTone: prefs.duTone
    });
}
