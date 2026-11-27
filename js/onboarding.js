// js/onboarding.js – Kurze, interaktive 4-Schritt-Einführung beim ersten Öffnen (überspringbar & jederzeit wiederholbar).

import { Storage } from './storage.js';

const TOUR_KEY = 'coden_tour_done';

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

const STEPS = [
    {
        icon: 'bolt',
        target: '#main-input',
        title: 'Smarte Slash-Befehle & Vorlagen',
        desc: 'Tippe einfach / im Chat, um Zeit zu sparen: /zusammenfassen, /aufsatz, /karteikarten, /quiz, /referat oder /zitate – mit automatischer Vervollständigung für alle.',
        hint: 'Tipp: Strg+/ fokussiert das Eingabefeld von überall.'
    },
    {
        icon: 'splitscreen',
        target: '#toggle-workspace-btn',
        title: 'Research-Browser & Split-Workspace',
        desc: 'Öffne oben rechts den Arbeitsbereich, um Chat links und den eigenen Research-Browser oder dein Lernheft rechts gleichzeitig nebeneinander zu sehen.',
        hint: 'Lesen klappt automatisch – Klicks und Formulare fragen dich direkt im Chat.'
    },
    {
        icon: 'auto_stories',
        target: '#open-study-btn',
        title: 'Lernheft, Foto-Aktionen & Exporte',
        desc: 'Ziehe Fotos von Arbeitsblättern direkt ins Chat-Feld (Lösen, Erklären, Karteikarten, Ins Heft) und exportiere Antworten als Word (.docx), PDF, Präsentation oder Quellenverzeichnis.',
        hint: 'Alle Exporte findest du über den Export-Knopf direkt unter jeder Antwort.'
    },
    {
        icon: 'hub',
        target: '#sb-more-toggle',
        title: 'Humanizer & Konnektoren',
        desc: 'Unter „Mehr“ formulierst du Texte im Humanizer natürlich & schülerfreundlich und verbindest deine Apps (MCP) mit dauerhaften Freigaben pro Werkzeug oder Server.',
        hint: 'Bereit! Du kannst diese Einführung jederzeit unter Hilfe wieder starten.'
    }
];

function markDone() {
    try { localStorage.setItem(TOUR_KEY, '1'); } catch (_) {}
    try {
        const s = Storage.getSettings();
        if (!s.tourDone) {
            s.tourDone = true;
            Storage.saveSettings(s);
        }
    } catch (_) {}
}

let activeOverlay = null;

export const Onboarding = {
    isDone() {
        try {
            if (localStorage.getItem(TOUR_KEY) === '1') return true;
            return !!Storage.getSettings().tourDone;
        } catch (_) {
            return true;
        }
    },

    maybeStart() {
        if (Onboarding.isDone()) return;
        // Nicht mit Rechtlichem-Modal oder Settings kollidieren
        const loginHidden = document.getElementById('login-screen')?.classList.contains('hidden');
        const appVisible = !document.getElementById('app')?.classList.contains('hidden');
        if (!loginHidden || !appVisible) return;
        setTimeout(() => {
            if (!Onboarding.isDone() && !activeOverlay) Onboarding.start(false);
        }, 700);
    },

    start(manual = true) {
        if (activeOverlay) activeOverlay.remove();
        let idx = 0;

        const overlay = h('div', { class: 'ob-overlay', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Kurze Einführung' });
        const card = h('div', { class: 'ob-card' });
        overlay.append(card);
        document.body.append(overlay);
        activeOverlay = overlay;

        const clearHighlights = () => {
            document.querySelectorAll('.ob-target-glow').forEach(el => el.classList.remove('ob-target-glow'));
        };

        const closeTour = () => {
            clearHighlights();
            document.removeEventListener('keydown', onKey);
            overlay.remove();
            activeOverlay = null;
            markDone();
        };

        const onKey = (e) => {
            if (e.key === 'Escape') closeTour();
            else if (e.key === 'ArrowRight') {
                if (idx < STEPS.length - 1) { idx++; renderStep(); }
                else closeTour();
            } else if (e.key === 'ArrowLeft' && idx > 0) {
                idx--; renderStep();
            }
        };
        document.addEventListener('keydown', onKey);

        const renderStep = () => {
            clearHighlights();
            const step = STEPS[idx];
            const tgt = step.target ? document.querySelector(step.target) : null;
            if (tgt && tgt.offsetParent !== null) {
                tgt.classList.add('ob-target-glow');
                try { tgt.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (_) {}
            }

            const dots = h('div', { class: 'ob-dots' }, ...STEPS.map((_, i) =>
                h('button', {
                    type: 'button',
                    class: 'ob-dot' + (i === idx ? ' on' : ''),
                    'aria-label': `Schritt ${i + 1}`,
                    onclick: () => { idx = i; renderStep(); }
                })
            ));

            const prevBtn = idx > 0
                ? h('button', { type: 'button', class: 'cd-btn', onclick: () => { idx--; renderStep(); } }, 'Zurück')
                : null;

            const isLast = idx === STEPS.length - 1;
            const nextBtn = h('button', {
                type: 'button',
                class: 'cd-primary',
                onclick: () => {
                    if (isLast) closeTour();
                    else { idx++; renderStep(); }
                }
            }, isLast ? 'Loslegen' : 'Weiter', ic(isLast ? 'check' : 'arrow_forward'));

            card.replaceChildren(
                h('div', { class: 'ob-head' },
                    h('span', { class: 'ob-step-num', text: `Schritt ${idx + 1} von ${STEPS.length}` }),
                    h('button', { type: 'button', class: 'ob-skip', onclick: closeTour }, manual ? 'Schließen' : 'Überspringen')
                ),
                h('div', { class: 'ob-hero' },
                    h('div', { class: 'ob-ic-wrap' }, ic(step.icon)),
                    h('h3', { text: step.title }),
                    h('p', { text: step.desc }),
                    step.hint ? h('div', { class: 'ob-hint' }, ic('tips_and_updates'), h('span', { text: step.hint })) : null
                ),
                h('div', { class: 'ob-foot' },
                    dots,
                    h('div', { class: 'ob-btns' }, prevBtn, nextBtn)
                )
            );
        };

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) closeTour();
        });

        renderStep();
    }
};
