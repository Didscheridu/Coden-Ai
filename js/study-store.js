// js/study-store.js – Lern-Studio-Daten in den Einstellungen (geräteübergreifend synchronisiert),
// Erinnerungen an den Server (Push auch bei geschlossener App) und lokal, solange Coden offen ist.
// Nimmt außerdem Lernpläne aus dem Chat an (<lernplan>-Block → Ereignis "codenStudyPlan").
import { Storage } from './storage.js';
import { apiJson } from './backend.js';
import { normalize, reminders, chatContext, notebooksPrompt, isoDate } from './study-core.js';
import { normalizeHandwriting, handwritingPrompt } from './handwriting-core.js';

let remTimer = 0, lastSent = '', localTimers = [];

export const StudyStore = {
    get() { return normalize(Storage.getSettings().study); },
    save(st) {
        const s = Storage.getSettings(); s.study = st; Storage.saveSettings(s);
        scheduleReminders(st);
        document.dispatchEvent(new CustomEvent('studyChanged'));
    },
    update(fn) { const st = StudyStore.get(); const r = fn(st); StudyStore.save(st); return r; },
    handwriting() { return normalizeHandwriting(StudyStore.get().handwriting); },
    saveHandwriting(hw) {
        const norm = normalizeHandwriting(hw);
        StudyStore.update(st => { st.handwriting = norm; });
        document.dispatchEvent(new CustomEvent('codenHandwritingChanged', { detail: norm }));
        return norm;
    },
    handwritingContext() { try { return handwritingPrompt(StudyStore.handwriting()); } catch (_) { return ''; } },
    context() { try { return chatContext(StudyStore.get()); } catch (_) { return ''; } },
    notebooksContext(opts) { try { return notebooksPrompt(StudyStore.get(), opts); } catch (_) { return ''; } },
    syncReminders() { scheduleReminders(StudyStore.get(), 0); }
};

function scheduleReminders(st, delay = 2500) {
    clearTimeout(remTimer);
    remTimer = setTimeout(async () => {
        const items = reminders(st);
        const key = JSON.stringify(items);
        if (key !== lastSent) {
            try { await apiJson('/study/reminders', { method: 'PUT', body: JSON.stringify({ items }) }); lastSent = key; } catch (_) { /* offline: beim nächsten Speichern */ }
        }
        scheduleLocal(items);
    }, delay);
}

// Solange Coden offen ist: Erinnerungen der nächsten Stunden direkt anzeigen (der Server macht den Rest)
function scheduleLocal(items) {
    localTimers.forEach(clearTimeout); localTimers = [];
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const now = Date.now();
    for (const it of items) {
        const wait = Date.parse(it.at) - now; if (wait < 0 || wait > 6 * 3600e3) continue;
        localTimers.push(setTimeout(async () => {
            const shown = JSON.parse(localStorage.getItem('coden_study_shown') || '{}');
            if (shown[it.id]) return; shown[it.id] = Date.now();
            for (const k of Object.keys(shown)) if (Date.now() - shown[k] > 4 * 864e5) delete shown[k];
            localStorage.setItem('coden_study_shown', JSON.stringify(shown));
            try { const reg = await navigator.serviceWorker?.getRegistration?.(); if (reg) reg.showNotification(it.title, { body: it.body, tag: 'study-' + it.id, data: { url: it.url } }); else new Notification(it.title, { body: it.body, tag: 'study-' + it.id }); } catch (_) {}
        }, wait));
    }
}

// Lernplan aus dem Chat übernehmen
document.addEventListener('codenStudyPlan', (e) => {
    const sessions = Array.isArray(e.detail?.sessions) ? e.detail.sessions : []; if (!sessions.length) return;
    StudyStore.update(st => {
        for (const s of sessions) {
            if (!s.subjectId && s.subjectName) { const su = st.subjects.find(x => x.name.toLowerCase() === s.subjectName.toLowerCase()); if (su) s.subjectId = su.id; }
            if (!st.plan.some(p => p.date === s.date && p.start === s.start && p.title === s.title)) st.plan.push({ ...s, fromChat: true });
        }
        st.plan.sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
        // alte, erledigte Einheiten (älter als 120 Tage) aufräumen
        const cut = isoDate(Date.now() - 120 * 864e5); st.plan = st.plan.filter(p => !(p.date < cut && (p.done || p.skipped)));
    });
    e.detail?.done?.(true);
});
