// js/startpage-overview.js – Kompakte Startseiten-Karten (Anstehend & Zuletzt bearbeitet).
// Zeigt fällige Aufgaben/Klassenarbeiten/Lernplan-Einheiten und 1-Klick-Fortsetzen der letzten Chats.
// Bewusst KEIN Fokus- oder Pomodoro-Timer.

import { StudyStore } from './study-store.js';
import { isoDate, daysBetween } from './study-core.js';

const h = (tag, attrs = {}, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else el.setAttribute(k, v === true ? '' : String(v));
    }
    for (const c of kids.flat()) if (c != null && c !== false) el.append(typeof c === 'string' ? document.createTextNode(c) : c);
    return el;
};
const ic = (name) => h('span', { class: 'material-symbols-outlined', 'aria-hidden': 'true', text: name });

function collectUpcomingItems() {
    let st;
    try { st = StudyStore.get(); } catch (_) { return []; }
    const today = isoDate();
    const out = [];

    const subjName = (id) => (st.subjects || []).find(s => s.id === id)?.name || '';

    // Offene Aufgaben / Hausaufgaben
    for (const t of (st.tasks || [])) {
        if (t.done) continue;
        const due = t.due || today;
        const diff = t.due ? daysBetween(today, t.due) : 0;
        const badge = !t.due ? 'Offen'
            : diff < 0 ? 'Überfällig'
            : diff === 0 ? 'Heute'
            : diff === 1 ? 'Morgen'
            : `In ${diff} Tagen`;
        out.push({
            kind: 'task',
            icon: 'assignment',
            title: t.title || 'Aufgabe',
            sub: [subjName(t.subjectId), badge].filter(Boolean).join(' · '),
            urgent: diff <= 0,
            sortKey: due,
            prompt: `Hilf mir bei meiner Aufgabe${subjName(t.subjectId) ? ' in ' + subjName(t.subjectId) : ''}: ${t.title}`
        });
    }

    // Nächste Klassenarbeiten / Klausuren
    for (const ex of (st.exams || [])) {
        if (!ex.date || ex.date < today) continue;
        const diff = daysBetween(today, ex.date);
        const badge = diff === 0 ? 'Heute!' : diff === 1 ? 'Morgen' : `In ${diff} Tagen`;
        out.push({
            kind: 'exam',
            icon: 'event',
            title: ex.title || 'Klassenarbeit',
            sub: [subjName(ex.subjectId), badge].filter(Boolean).join(' · '),
            urgent: diff <= 3,
            sortKey: ex.date,
            prompt: `Erstelle mir einen kompakten Lern-Überblick und 5 Übungsfragen für „${ex.title}“${subjName(ex.subjectId) ? ' (' + subjName(ex.subjectId) + ')' : ''}.`
        });
    }

    // Lernplan-Einheiten für heute/morgen
    for (const p of (st.plan || [])) {
        if (p.done || p.skipped || !p.date || p.date < today) continue;
        const diff = daysBetween(today, p.date);
        if (diff > 3) continue;
        out.push({
            kind: 'plan',
            icon: 'event_note',
            title: p.title || 'Lerneinheit',
            sub: [subjName(p.subjectId), diff === 0 ? `Heute ${p.start || ''}` : `Am ${p.date}`].filter(Boolean).join(' · '),
            urgent: diff === 0,
            sortKey: p.date + (p.start || ''),
            prompt: `Starte die Lerneinheit „${p.title}“ mit mir.`
        });
    }

    return out.sort((a, b) => a.sortKey.localeCompare(b.sortKey)).slice(0, 3);
}

function formatRelTime(iso) {
    if (!iso) return 'Vor Kurzem';
    const d = Date.parse(iso);
    if (!Number.isFinite(d)) return 'Vor Kurzem';
    const mins = Math.max(0, Math.round((Date.now() - d) / 60000));
    if (mins < 2) return 'Gerade eben';
    if (mins < 60) return `vor ${mins} Min.`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `vor ${hrs} Std.`;
    return new Date(d).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
}

export function mountStartpageOverview({ getSessions, getActiveId } = {}) {
    const extra = document.getElementById('welcome-extra');
    if (!extra) return;

    let box = document.getElementById('sp-overview-grid');
    if (!box) {
        box = h('div', { id: 'sp-overview-grid', class: 'sp-overview-grid' });
        const gallery = document.getElementById('we-gallery');
        if (gallery) extra.insertBefore(box, gallery);
        else extra.append(box);
    }

    const render = (sessionsList) => {
        const upcoming = collectUpcomingItems();
        const sessions = (Array.isArray(sessionsList) ? sessionsList : (getSessions?.() || []))
            .filter(s => s && !s.temp && Array.isArray(s.messages) && s.messages.length > 0)
            .slice(0, 3);

        // Karte 1: Anstehend
        const dueCard = h('section', { class: 'sp-card' },
            h('div', { class: 'sp-card-head' },
                h('div', { class: 'sp-card-title' }, ic('school'), h('span', { text: 'Anstehend' })),
                h('a', { href: '#/lernen', class: 'we-link', text: 'Zum Plan' })
            ),
            upcoming.length
                ? h('div', { class: 'sp-list' }, ...upcoming.map(it =>
                    h('button', {
                        type: 'button',
                        class: 'sp-row' + (it.urgent ? ' urgent' : ''),
                        onclick: () => document.dispatchEvent(new CustomEvent('coden:compose', { detail: { text: it.prompt, send: false } }))
                    },
                    ic(it.icon),
                    h('span', { class: 'sp-row-txt' }, h('strong', { text: it.title }), h('small', { text: it.sub })),
                    ic('arrow_forward'))
                ))
                : h('div', { class: 'sp-empty' },
                    h('span', { text: 'Keine offenen Aufgaben oder Arbeiten eingetragen.' }),
                    h('a', { href: '#/lernen', class: 'sp-mini-link', text: 'Im Lern-Studio planen →' })
                )
        );

        // Karte 2: Zuletzt bearbeitet
        const recentCard = h('section', { class: 'sp-card' },
            h('div', { class: 'sp-card-head' },
                h('div', { class: 'sp-card-title' }, ic('history'), h('span', { text: 'Zuletzt bearbeitet' })),
                sessions.length ? h('span', { class: 'sp-count', text: `${sessions.length}` }) : null
            ),
            sessions.length
                ? h('div', { class: 'sp-list' }, ...sessions.map(s => {
                    const lastMsg = [...s.messages].reverse().find(m => m?.text);
                    const preview = String(lastMsg?.text || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 56);
                    return h('button', {
                        type: 'button',
                        class: 'sp-row',
                        onclick: () => document.dispatchEvent(new CustomEvent('loadChatSession', { detail: s.id }))
                    },
                    ic(s.pinned ? 'keep' : 'chat_bubble_outline'),
                    h('span', { class: 'sp-row-txt' },
                        h('strong', { text: s.title || 'Chat' }),
                        h('small', { text: `${formatRelTime(s.updatedAt || s.createdAt)}${preview ? ' · ' + preview : ''}` })
                    ),
                    ic('play_arrow'));
                }))
                : h('div', { class: 'sp-empty' },
                    h('span', { text: 'Deine letzten Chats erscheinen hier zum direkten Fortsetzen.' })
                )
        );

        box.replaceChildren(dueCard, recentCard);
    };

    document.addEventListener('sessionsRendered', (e) => render(e.detail));
    document.addEventListener('studyChanged', () => render());
    render();
    return { render };
}
