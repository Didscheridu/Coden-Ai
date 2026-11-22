// js/usage.js – Nutzungslimits anzeigen (wie „Einstellungen → Nutzung“ bei Claude):
// 5-Stunden-Fenster und Wochenlimit als Balken, Hinweis über dem Eingabefeld ab 80 %, klare Meldung beim Limit.
import { apiJson } from './backend.js';

let last = null, lastAt = 0;
export async function fetchUsage(force = false) {
    if (!force && last && Date.now() - lastAt < 15000) return last;
    try { last = await apiJson('/usage'); lastAt = Date.now(); } catch (_) { /* offline: alten Stand behalten */ }
    return last;
}

// "heute 22:15", "morgen 08:00", "Mo., 14:00"
export function resetText(iso) {
    if (!iso) return 'startet mit deiner nächsten Nachricht';
    const d = new Date(iso), now = new Date();
    const time = d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const diff = Math.round((day(d) - day(now)) / 86400000);
    const when = diff === 0 ? 'heute' : diff === 1 ? 'morgen' : d.toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'numeric' });
    const mins = Math.max(1, Math.round((d - now) / 60000));
    const rel = mins < 60 ? `${mins} Min.` : mins < 1440 ? `${Math.floor(mins / 60)} Std. ${mins % 60} Min.` : `${Math.floor(mins / 1440)} T. ${Math.floor((mins % 1440) / 60)} Std.`;
    return `setzt sich ${when} um ${time} zurück (in ${rel})`;
}
const fmtTok = (n) => n >= 1e6 ? (n / 1e6).toFixed(1).replace('.', ',') + ' Mio.' : n >= 1000 ? Math.round(n / 1000) + 'k' : String(n);

function bar(label, w) {
    const row = document.createElement('div'); row.className = 'us-row' + (w.pct >= 100 ? ' full' : w.pct >= 80 ? ' warn' : '');
    const head = document.createElement('div'); head.className = 'us-head';
    head.append(Object.assign(document.createElement('b'), { textContent: label }), Object.assign(document.createElement('span'), { textContent: `${w.pct} % verbraucht` }));
    const track = document.createElement('div'); track.className = 'us-track';
    const fill = document.createElement('i'); fill.style.width = Math.max(w.pct ? 2 : 0, w.pct) + '%'; track.append(fill);
    const sub = Object.assign(document.createElement('small'), { textContent: `${fmtTok(w.used)} von ${fmtTok(w.limit)} Tokens · ${resetText(w.resetAt)}` });
    row.append(head, track, sub); return row;
}

// Kasten mit beiden Balken (Einstellungen)
export async function renderUsage(box) {
    if (!box) return;
    box.replaceChildren(Object.assign(document.createElement('small'), { className: 'us-note', textContent: 'Lädt …' }));
    const u = await fetchUsage(true);
    if (!u) { box.replaceChildren(Object.assign(document.createElement('small'), { className: 'us-note', textContent: 'Nutzung konnte nicht geladen werden.' })); return; }
    const kids = [bar('Aktuelle Sitzung (5 Stunden)', u.session), bar('Diese Woche', u.week)];
    kids.push(Object.assign(document.createElement('small'), { className: 'us-note', textContent: u.unlimited
        ? 'Als Owner hast du kein Limit – dein Verbrauch wird nur angezeigt.'
        : 'Jede Antwort verbraucht Tokens (stärkere Modelle mehr als Flash). Eine Aufgabe, die schon läuft, darf zu Ende arbeiten.' }));
    box.replaceChildren(...kids);
}

// Hinweis über dem Eingabefeld (ab 80 % oder wenn das Limit erreicht ist)
export async function refreshUsageBanner(force = false) {
    const sec = document.querySelector('.input-section'); if (!sec) return;
    const u = await fetchUsage(force);
    let el = document.getElementById('usage-banner');
    const w = !u || u.unlimited ? null : u.blocked === 'week' || u.week.pct >= Math.max(80, u.session.pct) ? ['Wochenlimit', u.week] : ['5-Stunden-Limit', u.session];
    if (!w || w[1].pct < 80) { el?.remove(); return; }
    if (!el) { el = document.createElement('div'); el.id = 'usage-banner'; el.setAttribute('role', 'status'); sec.prepend(el); }
    const full = !!u.blocked;
    el.className = 'usage-banner' + (full ? ' full' : '');
    el.replaceChildren(
        Object.assign(document.createElement('span'), { className: 'material-symbols-outlined', textContent: full ? 'hourglass_top' : 'data_usage' }),
        Object.assign(document.createElement('span'), { className: 'ub-text', textContent: full ? `${w[0]} erreicht – ${resetText(w[1].resetAt)}.` : `Du hast ${w[1].pct} % deines ${w[0]}s verbraucht.` })
    );
}

// Text für den Chat, wenn eine Anfrage am Limit scheitert
export function limitMessage(err) {
    const u = err?.usage; const w = u ? (u.blocked === 'week' ? u.week : u.session) : null;
    return `⏳ **Nutzungslimit erreicht**\n\n${w ? `Dein ${u.blocked === 'week' ? 'Wochenlimit' : '5-Stunden-Limit'} ist aufgebraucht und ${resetText(w.resetAt)}.` : err.message}\n\nDeine Chats und Apps bleiben natürlich erhalten. Den aktuellen Stand siehst du unter **Einstellungen → Nutzung**.`;
}
