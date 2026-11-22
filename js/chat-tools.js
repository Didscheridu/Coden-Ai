// js/chat-tools.js – Funktionen, die man von den großen KI-Apps kennt:
// Nachrichten kopieren / vorlesen / neu generieren / bearbeiten, Diktieren, Chat-Export,
// persönliche Anweisungen und ein Gedächtnis, das Coden selbst füllen darf.
import { Storage } from './storage.js';

// ---------- Persönliche Anweisungen + Gedächtnis ----------
const MEM_MAX = 30, MEM_LEN = 200, INSTR_MAX = 1500;
const clean = (t, n) => String(t || '').replace(/[\u0000-\u0008\u000B-\u001F]/g, '').replace(/<\/?[a-z_]+[^>]*>/gi, '').trim().slice(0, n);
export const Personal = {
    instructions: () => clean(Storage.getSettings().instructions, INSTR_MAX),
    memory: () => (Array.isArray(Storage.getSettings().memory) ? Storage.getSettings().memory : []).map(m => clean(m, MEM_LEN)).filter(Boolean).slice(0, MEM_MAX),
    memoryOn: () => Storage.getSettings().memoryOn !== false,
    save({ instructions, memoryText, memoryOn }, s) {
        s.instructions = clean(instructions, INSTR_MAX);
        s.memory = String(memoryText || '').split('\n').map(l => clean(l, MEM_LEN)).filter(Boolean).slice(0, MEM_MAX);
        s.memoryOn = memoryOn !== false; return s;
    },
    prompt() {
        const ins = this.instructions(), mem = this.memoryOn() ? this.memory() : [];
        let out = '';
        if (ins) out += `\nPERSÖNLICHE ANWEISUNGEN DES NUTZERS (vom Nutzer selbst in den Einstellungen geschrieben, befolge sie):\n${ins}\n`;
        if (this.memoryOn()) {
            out += `\nGEDÄCHTNIS (Fakten über den Nutzer, die er dir mitgeteilt hat):\n${mem.length ? mem.map(m => '- ' + m).join('\n') : '(noch leer)'}\nWenn der Nutzer dir etwas über sich sagt, das du dir dauerhaft merken sollst (oder er "merk dir" sagt), schreibe ans Ende deiner Antwort <remember>kurzer Satz</remember>. Merke dir nie Passwörter, Zahlungsdaten oder Gesundheitsdaten.\n`;
        }
        return out;
    },
    // <remember>…</remember> aus einer Antwort lesen und speichern. Gibt die gemerkten Sätze zurück.
    take(text) {
        if (!this.memoryOn()) return [];
        const found = [...String(text || '').matchAll(/<remember>([\s\S]*?)<\/remember>/gi)].map(m => clean(m[1], MEM_LEN)).filter(x => x.length >= 3).slice(0, 3);
        if (!found.length) return [];
        const s = Storage.getSettings(); const mem = Array.isArray(s.memory) ? s.memory.slice() : []; const added = [];
        for (const f of found) if (mem.length < MEM_MAX && !mem.some(x => x.toLowerCase() === f.toLowerCase())) { mem.push(f); added.push(f); }
        if (added.length) { s.memory = mem; Storage.saveSettings(s); }
        return added;
    },
    hide: (t) => String(t || '').replace(/<remember>[\s\S]*?<\/remember>/gi, '').replace(/<remember>[\s\S]*$/i, '')
};

// ---------- Chat-Export ----------
export function exportChat(session) {
    if (!session?.messages?.length) return false;
    const strip = (t) => String(t || '').replace(/data:image\/[^"'\s)\]]+/g, '[Bild]').replace(/<[^>]+>/g, '');
    const md = `# ${session.title || 'Coden-Chat'}\n\n` + session.messages.map(m => `**${m.isUser ? 'Du' : 'Coden'}:**\n\n${strip(m.text).trim()}`).join('\n\n---\n\n') + '\n';
    const name = (session.title || 'chat').replace(/[^\p{L}\p{N}_-]+/gu, '_').slice(0, 40) || 'chat';
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([md], { type: 'text/markdown;charset=utf-8' })); a.download = name + '.md';
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); return true;
}

// ---------- Diktieren ----------
export function mountDictation(btn, input, toast) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!btn) return;
    if (!SR) { btn.addEventListener('click', () => toast?.('Diktieren geht in diesem Browser nicht. Chrome, Edge oder Safari probieren.', { type: 'warn' })); return; }
    let rec = null, base = '';
    const stop = () => { try { rec?.stop(); } catch (_) {} };
    btn.addEventListener('click', () => {
        if (rec) { stop(); return; }
        rec = new SR(); rec.lang = 'de-DE'; rec.interimResults = true; rec.continuous = true;
        base = input.value ? input.value.replace(/\s*$/, ' ') : '';
        btn.classList.add('recording'); btn.setAttribute('aria-pressed', 'true');
        rec.onresult = (e) => { let t = ''; for (let i = 0; i < e.results.length; i++) t += e.results[i][0].transcript; input.value = base + t; input.dispatchEvent(new Event('input', { bubbles: true })); };
        rec.onerror = (e) => { if (e.error === 'not-allowed') toast?.('Mikrofon ist blockiert. Erlaube es in der Adressleiste.', { type: 'warn' }); };
        rec.onend = () => { rec = null; btn.classList.remove('recording'); btn.setAttribute('aria-pressed', 'false'); input.focus(); };
        try { rec.start(); } catch (_) { rec = null; btn.classList.remove('recording'); }
    });
}

// ---------- Aktionsleiste unter Nachrichten ----------
// ctx: { session(): aktuelle Sitzung, truncate(index): Verlauf ab Index löschen (Daten + Anzeige), setInput(text), send() }
export function mountMessageActions(ctx, toast) {
    const host = document.getElementById('chat-container'); if (!host) return;
    const rowsOf = () => [...host.querySelectorAll(':scope > .message-row')];
    const synced = () => rowsOf().length === (ctx.session()?.messages?.length ?? -1); // nur dann ist die Zuordnung sicher
    const btn = (icon, label, fn) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'ma-btn'; b.title = label; b.setAttribute('aria-label', label); const s = document.createElement('span'); s.className = 'material-symbols-outlined'; s.textContent = icon; b.append(s); b.addEventListener('click', (e) => { e.stopPropagation(); fn(b); }); return b; };
    const textOf = (row) => { const i = rowsOf().indexOf(row); const m = synced() ? ctx.session().messages[i] : null; return m ? m.text : (row.querySelector('.content')?.innerText || ''); };
    const plain = (t) => String(t || '').replace(/<(suggestions|choices)>[\s\S]*?<\/(suggestions|choices)>/gi, '').replace(/```[\s\S]*?```/g, ' Codeblock. ').replace(/<[^>]+>/g, '').replace(/[*_`#>|]/g, '').replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
    let speakingRow = null;
    const speak = (row, b) => {
        if (!('speechSynthesis' in window)) { toast?.('Vorlesen geht in diesem Browser nicht.', { type: 'warn' }); return; }
        const was = speakingRow === row; speechSynthesis.cancel(); document.querySelectorAll('.ma-btn.on').forEach(x => x.classList.remove('on')); speakingRow = null;
        if (was) return;
        const u = new SpeechSynthesisUtterance(plain(textOf(row)).slice(0, 8000)); u.lang = 'de-DE';
        u.onend = u.onerror = () => { b.classList.remove('on'); if (speakingRow === row) speakingRow = null; };
        speakingRow = row; b.classList.add('on'); speechSynthesis.speak(u);
    };
    const decorate = (row) => {
        if (row.dataset.act || row.classList.contains('streaming')) return;
        const content = row.querySelector('.content'); if (!content || !content.textContent.trim()) return;
        row.dataset.act = '1';
        const bar = document.createElement('div'); bar.className = 'ma-bar';
        const isUser = row.classList.contains('user-message');
        bar.append(btn('content_copy', 'Kopieren', async (b) => { try { await navigator.clipboard.writeText(plain(textOf(row)).trim() || textOf(row)); const ic = b.firstChild; ic.textContent = 'check'; setTimeout(() => ic.textContent = 'content_copy', 1200); } catch (_) { toast?.('Kopieren nicht möglich.', { type: 'warn' }); } }));
        if (!isUser) bar.append(btn('volume_up', 'Vorlesen', (b) => speak(row, b)));
        const idx = () => rowsOf().indexOf(row);
        if (isUser) bar.append(btn('edit', 'Bearbeiten und neu senden', () => {
            if (!synced()) return toast?.('Bitte erst den Chat neu laden, dann geht es.', { type: 'warn' });
            const m = ctx.session().messages[idx()]; if (!m || m.images?.length || m.text.length > 6000) return toast?.('Diese Nachricht hat Anhänge und lässt sich nicht bearbeiten.', { type: 'warn' });
            const t = m.text; ctx.truncate(idx()); ctx.setInput(t);
        }));
        else bar.append(btn('refresh', 'Neu generieren', () => {
            if (!synced()) return toast?.('Bitte erst den Chat neu laden, dann geht es.', { type: 'warn' });
            const rows = rowsOf(), i = idx(); if (i !== rows.length - 1) return toast?.('Neu generieren geht nur bei der letzten Antwort.', { type: 'warn' });
            let u = i - 1; while (u >= 0 && !ctx.session().messages[u].isUser) u--;
            if (u < 0) return; const m = ctx.session().messages[u]; if (m.images?.length) return toast?.('Die Frage hatte Anhänge. Sende sie bitte neu.', { type: 'warn' });
            const t = m.text; ctx.truncate(u); ctx.setInput(t); ctx.send();
        }));
        content.after(bar);
    };
    const scan = () => rowsOf().forEach(decorate);
    new MutationObserver(() => requestAnimationFrame(scan)).observe(host, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    scan();
}
