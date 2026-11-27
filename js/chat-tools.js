// js/chat-tools.js – Funktionen, die man von den großen KI-Apps kennt:
// Nachrichten kopieren / vorlesen / neu generieren / bearbeiten, Diktieren, Chat-Export,
// persönliche Anweisungen und ein Gedächtnis, das Coden selbst füllen darf.
import { Storage } from './storage.js';
import { stripMarks } from './rich-elements.js';
import { createSpeechController, toSpeakableText } from './speech.js';
import { smartStructureDictation } from './dictation-smart.js';
import { exportAsPdfReport, exportAsDocx, markdownToSlides, extractCitations, formatBibliography } from './doc-export.js';
import { Artifacts } from './artifacts.js';
import { SplitWorkspace } from './split-workspace.js';

// ---------- Persönliche Anweisungen + Gedächtnis ----------
// Die Logik (Einträge, Projekt-Trennung, Doppelte, Grenzen) steckt in shared/assist-core.js und ist dort getestet.
const INSTR_MAX = 1500;
const A = () => window.CodenAssist;
const clean = (t, n) => String(t || '').replace(/[\u0000-\u0008\u000B-\u001F]/g, '').replace(/<\/?[a-z_]+[^>]*>/gi, '').trim().slice(0, n);
export const Personal = {
    instructions: () => clean(Storage.getSettings().instructions, INSTR_MAX),
    memoryOn: () => Storage.getSettings().memoryOn !== false,
    // Alle Einträge (alle Projekte) für die Liste in den Einstellungen
    items: () => A().memoryItems(Storage.getSettings()),
    memory: (projectId) => A().memoryFor(A().memoryItems(Storage.getSettings()), projectId),
    save({ instructions, memoryOn }, s) {
        s.instructions = clean(instructions, INSTR_MAX);
        s.memoryOn = memoryOn !== false; return s;
    },
    // Liste speichern (und das alte Feld als Spiegel für ältere Geräte mitschreiben)
    _write(items) {
        const s = Storage.getSettings(); s.memoryItems = items; s.memory = A().legacyMirror(items);
        Storage.saveSettings(s); return items;
    },
    add(text, projectId = null) { const r = A().addMemory(this.items(), text, { p: projectId }); if (r.added) this._write(r.items); return r; },
    remove(id) { return this._write(A().removeMemory(this.items(), id)); },
    edit(id, text) { return this._write(A().editMemory(this.items(), id, text)); },
    clear(projectId) { return this._write(this.items().filter(m => projectId === undefined ? false : (projectId === null ? !!m.p : m.p !== projectId))); },
    prompt(projectId = null, projectName = '') {
        const ins = this.instructions();
        let out = '';
        if (ins) out += `\nPERSÖNLICHE ANWEISUNGEN DES NUTZERS (vom Nutzer selbst in den Einstellungen geschrieben, befolge sie):\n${ins}\n`;
        if (this.memoryOn()) out += A().memoryPrompt(this.items(), projectId, { project: projectName });
        return out;
    },
    // <remember>…</remember> aus einer Antwort lesen und speichern. In einem Projekt-Chat bleiben neue Einträge im Projekt.
    // Gibt die neu gemerkten Einträge zurück (mit id, damit man sie rückgängig machen kann).
    take(text, projectId = null) {
        if (!this.memoryOn()) return [];
        let items = this.items(); const added = [];
        for (const t of A().extractRemember(text)) { const r = A().addMemory(items, t, { p: projectId }); if (r.added) { items = r.items; added.push(r.added); } }
        if (added.length) this._write(items);
        return added;
    },
    undo(ids) { return this._write(this.items().filter(m => !ids.includes(m.id))); },
    hide: (t) => A().stripRemember(t)
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

// ---------- Diktieren (Standard & Smart-Gliederung) ----------
export function mountDictation(btn, input, toast, toggleBtn = document.getElementById('mic-smart-btn')) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!btn) return;
    const isSmart = () => Storage.getSettings().dictationMode !== 'normal';
    const syncToggle = () => {
        if (!toggleBtn) return;
        const on = isSmart();
        toggleBtn.classList.toggle('on', on);
        toggleBtn.setAttribute('aria-pressed', String(on));
        toggleBtn.title = on
            ? 'Smart-Diktat AN: Sprache automatisch als Aufgaben oder Notizen gliedern'
            : 'Smart-Diktat AUS: Gesprochenen Text 1:1 übernehmen';
    };
    syncToggle();
    toggleBtn?.addEventListener('click', () => {
        const s = Storage.getSettings();
        s.dictationMode = isSmart() ? 'normal' : 'smart';
        Storage.saveSettings(s);
        syncToggle();
        toast?.(s.dictationMode === 'smart'
            ? 'Smart-Diktat aktiv: Aufgaben & Notizen werden automatisch gegliedert.'
            : 'Normales Diktat aktiv.', { type: 'info' });
    });

    if (!SR) {
        btn.addEventListener('click', () => toast?.('Diktieren geht in diesem Browser nicht. Chrome, Edge oder Safari probieren.', { type: 'warn' }));
        return;
    }
    let rec = null, base = '', captured = '';
    const stop = () => { try { rec?.stop(); } catch (_) {} };
    btn.addEventListener('click', () => {
        if (rec) { stop(); return; }
        rec = new SR(); rec.lang = 'de-DE'; rec.interimResults = true; rec.continuous = true;
        base = input.value ? input.value.replace(/\s*$/, ' ') : '';
        captured = '';
        btn.classList.add('recording'); btn.setAttribute('aria-pressed', 'true');
        rec.onresult = (e) => {
            let t = '';
            for (let i = 0; i < e.results.length; i++) t += e.results[i][0].transcript;
            captured = t;
            input.value = base + t;
            input.dispatchEvent(new Event('input', { bubbles: true }));
        };
        rec.onerror = (e) => { if (e.error === 'not-allowed') toast?.('Mikrofon ist blockiert. Erlaube es in der Adressleiste.', { type: 'warn' }); };
        rec.onend = () => {
            rec = null;
            btn.classList.remove('recording');
            btn.setAttribute('aria-pressed', 'false');
            if (isSmart() && captured.trim()) {
                const formatted = smartStructureDictation(captured, 'smart');
                if (formatted) {
                    const sep = base.trim() ? base.trimEnd() + '\n\n' : '';
                    input.value = sep + formatted;
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                }
            }
            input.focus();
        };
        try { rec.start(); } catch (_) { rec = null; btn.classList.remove('recording'); }
    });
}

// ---------- Aktionsleiste unter Nachrichten ----------
// ctx: { session(): aktuelle Sitzung, truncate(index): Verlauf ab Index löschen (Daten + Anzeige), setInput(text), send() }
export function mountMessageActions(ctx, toast) {
    const host = document.getElementById('chat-container'); if (!host) return;
    const rowsOf = () => [...host.querySelectorAll(':scope > .message-row')];
    const synced = () => rowsOf().length === (ctx.session()?.messages?.length ?? -1); // nur dann ist die Zuordnung sicher
    const btn = (icon, label, fn, extraCls = '') => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = extraCls ? `ma-btn ${extraCls}` : 'ma-btn';
        b.title = label;
        b.setAttribute('aria-label', label);
        const s = document.createElement('span');
        s.className = 'material-symbols-outlined';
        s.textContent = icon;
        b.append(s);
        b.addEventListener('click', (e) => { e.stopPropagation(); fn(b); });
        return b;
    };
    const textOf = (row) => {
        const i = rowsOf().indexOf(row);
        const m = synced() ? ctx.session().messages[i] : null;
        if (m?.text) return m.text;
        const answer = row.querySelector('.answer');
        if (answer) return answer.innerText || answer.textContent || '';
        return row.querySelector('.content')?.innerText || '';
    };
    const copyTextOf = (t) => stripMarks(String(t || ''))
        .replace(/<(suggestions|choices|remember|think)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
        .trim();

    const speech = createSpeechController();
    let speakingRow = null;

    const setSpeakButtonState = (b, active) => {
        if (!b) return;
        b.classList.toggle('on', active);
        b.setAttribute('aria-pressed', active ? 'true' : 'false');
        const label = active ? 'Vorlesen stoppen' : 'Vorlesen (Erklärung & Code anhören)';
        b.title = label;
        b.setAttribute('aria-label', label);
        const ic = b.querySelector('.material-symbols-outlined');
        if (ic) ic.textContent = active ? 'stop_circle' : 'volume_up';
    };

    const resetSpeakButtons = () => {
        host.querySelectorAll('.ma-speak-btn.on').forEach((x) => setSpeakButtonState(x, false));
        speakingRow = null;
    };

    const toggleSpeakRow = (row, b) => {
        const raw = textOf(row);
        const speakable = toSpeakableText(raw);
        speech.speak(speakable || raw, {
            key: row,
            raw: true,
            onStart: () => {
                resetSpeakButtons();
                speakingRow = row;
                setSpeakButtonState(b, true);
            },
            onEnd: () => {
                setSpeakButtonState(b, false);
                if (speakingRow === row) speakingRow = null;
            },
            onError: (reason) => {
                setSpeakButtonState(b, false);
                if (speakingRow === row) speakingRow = null;
                if (reason === 'unsupported') {
                    toast?.('Vorlesen geht in diesem Browser nicht.', { type: 'warn' });
                } else if (reason === 'empty') {
                    toast?.('Kein vorlesbarer Text in dieser Nachricht.', { type: 'info' });
                } else {
                    toast?.('Vorlesen konnte nicht gestartet werden.', { type: 'warn' });
                }
            }
        });
    };

    window.addEventListener('pagehide', () => speech.stop());
    window.addEventListener('hashchange', () => {
        if (speech.isSpeaking() && location.hash && !location.hash.startsWith('#/chat')) speech.stop();
    });

    const decorate = (row) => {
        if (row.dataset.act || row.classList.contains('streaming')) return;
        const content = row.querySelector('.content'); if (!content || !content.textContent.trim()) return;
        row.dataset.act = '1';
        const bar = document.createElement('div'); bar.className = 'ma-bar';
        const isUser = row.classList.contains('user-message');
        bar.append(btn('content_copy', 'Kopieren', async (b) => {
            try {
                const raw = textOf(row);
                await navigator.clipboard.writeText(copyTextOf(raw) || raw);
                const ic = b.firstChild;
                ic.textContent = 'check';
                setTimeout(() => { ic.textContent = 'content_copy'; }, 1200);
            } catch (_) { toast?.('Kopieren nicht möglich.', { type: 'warn' }); }
        }));
        if (!isUser) {
            const speakBtn = btn('volume_up', 'Vorlesen (Erklärung & Code anhören)', (b) => toggleSpeakRow(row, b), 'ma-speak-btn');
            speakBtn.dataset.act = 'read-aloud';
            speakBtn.setAttribute('aria-pressed', 'false');
            bar.append(speakBtn);

            const humBtn = btn('auto_fix_high', 'Im Humanizer natürlich umformulieren', () => {
                const raw = textOf(row);
                const clean = copyTextOf(raw) || raw;
                if (!clean.trim()) return toast?.('Kein Text zum Humanisieren vorhanden.', { type: 'info' });
                import('./humanizer.js').then(m => m.openHumanizerWith(clean, { autoRun: true })).catch(() => {
                    toast?.('Humanizer konnte nicht geöffnet werden.', { type: 'warn' });
                });
            }, 'ma-humanize-btn');
            humBtn.dataset.act = 'humanize';
            bar.append(humBtn);

            // Export- & Zitate-Menü (PDF, Word .docx, Präsentation, Quellenverzeichnis, Lernheft)
            const expWrap = document.createElement('div');
            expWrap.className = 'ma-export-wrap';
            const expBtn = btn('ios_share', 'Exportieren, Folien & Quellenverzeichnis', () => {
                const wasOpen = !expMenu.classList.contains('hidden');
                host.querySelectorAll('.ma-export-menu').forEach(m => m.classList.add('hidden'));
                if (!wasOpen) {
                    expMenu.classList.remove('hidden');
                    const rect = expMenu.getBoundingClientRect();
                    if (rect.right > window.innerWidth - 12) expMenu.classList.add('align-right');
                    else expMenu.classList.remove('align-right');
                }
            }, 'ma-export-btn');
            expBtn.setAttribute('aria-haspopup', 'menu');

            const expMenu = document.createElement('div');
            expMenu.className = 'ma-export-menu cm-panel hidden';
            expMenu.setAttribute('role', 'menu');

            const inferTitle = (clean) => {
                const heading = clean.match(/^#{1,3}\s+(.+)$/m)?.[1];
                if (heading) return heading.slice(0, 60);
                const sTitle = ctx.session()?.title;
                if (sTitle && sTitle !== 'Neuer Chat') return sTitle.slice(0, 60);
                return 'Coden-Ergebnis';
            };
            const addExpItem = (iconName, label, fn) => {
                const it = document.createElement('button');
                it.type = 'button';
                it.className = 'cm-item';
                it.setAttribute('role', 'menuitem');
                const icEl = document.createElement('span');
                icEl.className = 'material-symbols-outlined cm-ic';
                icEl.textContent = iconName;
                const lbEl = document.createElement('span');
                lbEl.className = 'cm-label';
                lbEl.textContent = label;
                it.append(icEl, lbEl);
                it.addEventListener('click', async (ev) => {
                    ev.stopPropagation();
                    expMenu.classList.add('hidden');
                    const raw = textOf(row);
                    const clean = copyTextOf(raw) || raw;
                    if (!clean.trim()) return toast?.('Kein Text vorhanden.', { type: 'info' });
                    await fn({ raw, clean, title: inferTitle(clean) });
                });
                expMenu.append(it);
            };

            addExpItem('picture_as_pdf', 'Als PDF speichern', ({ clean, title }) => {
                const res = exportAsPdfReport(title, clean);
                toast?.(`PDF gespeichert (${res.pages} Seite${res.pages === 1 ? '' : 'n'}).`, { type: 'ok' });
            });
            addExpItem('description', 'Als Word (.docx) speichern', ({ clean, title }) => {
                const fname = exportAsDocx(title, clean);
                toast?.(`Word-Dokument „${fname}“ gespeichert.`, { type: 'ok' });
            });
            addExpItem('slideshow', 'Als Präsentation öffnen', ({ clean, title }) => {
                const slidesBody = markdownToSlides(title, clean);
                Artifacts.open({ kind: 'artifact', type: 'slides', title, body: slidesBody, closed: true });
            });
            addExpItem('format_quote', 'Quellenverzeichnis (Schule)', async ({ raw }) => {
                const bib = formatBibliography(raw, 'schule');
                if (!bib) return toast?.('Keine Links oder Webquellen in dieser Nachricht gefunden.', { type: 'info' });
                try { await navigator.clipboard.writeText(bib); toast?.(`Quellenverzeichnis (Schule, ${extractCitations(raw).length} Quelle(n)) kopiert.`, { type: 'ok' }); }
                catch (_) { toast?.('Konnte nicht in die Zwischenablage kopieren.', { type: 'warn' }); }
            });
            addExpItem('school', 'Quellenverzeichnis (APA / Harvard)', async ({ raw }) => {
                const apa = formatBibliography(raw, 'apa');
                const harvard = formatBibliography(raw, 'harvard');
                if (!apa) return toast?.('Keine Links oder Webquellen in dieser Nachricht gefunden.', { type: 'info' });
                try { await navigator.clipboard.writeText(`${apa}\n\n${harvard}`); toast?.('APA- & Harvard-Quellenverzeichnis kopiert.', { type: 'ok' }); }
                catch (_) { toast?.('Konnte nicht in die Zwischenablage kopieren.', { type: 'warn' }); }
            });
            addExpItem('auto_stories', 'Ins Lernheft übernehmen', async ({ clean, title }) => {
                try {
                    await SplitWorkspace.appendNoteToNotebook(clean.slice(0, 1800), { title });
                    SplitWorkspace.open('notebook');
                    toast?.('Text ins Lernheft übernommen.', { type: 'ok' });
                } catch (err) {
                    toast?.(err?.message || 'Konnte nicht ins Lernheft schreiben.', { type: 'error' });
                }
            });

            expWrap.append(expBtn, expMenu);
            bar.append(expWrap);
        }
        const idx = () => rowsOf().indexOf(row);
        if (isUser) bar.append(btn('edit', 'Bearbeiten und neu senden', () => {
            if (!synced()) return toast?.('Bitte erst den Chat neu laden, dann geht es.', { type: 'warn' });
            const m = ctx.session().messages[idx()]; if (!m || m.images?.length || m.text.length > 6000) return toast?.('Diese Nachricht hat Anhänge und lässt sich nicht bearbeiten.', { type: 'warn' });
            const t = m.text; ctx.truncate(idx()); ctx.setInput(t);
        }));
        else bar.append(btn('refresh', 'Neu generieren', () => {
            const rows = rowsOf(), i = idx();
            if (row.dataset.failed === '1' && i === rows.length - 1) {
                const msgs = ctx.session()?.messages || [];
                let u = msgs.length - 1; while (u >= 0 && !msgs[u].isUser) u--;
                if (u < 0) return; const m = msgs[u];
                if (m.images?.length) return toast?.('Die Frage hatte Anhänge. Sende sie bitte neu.', { type: 'warn' });
                row.remove(); const t = m.text; ctx.truncate(u); ctx.setInput(t); ctx.send(); return;
            }
            if (!synced()) return toast?.('Bitte erst den Chat neu laden, dann geht es.', { type: 'warn' });
            if (i !== rows.length - 1) return toast?.('Neu generieren geht nur bei der letzten Antwort.', { type: 'warn' });
            let u = i - 1; while (u >= 0 && !ctx.session().messages[u].isUser) u--;
            if (u < 0) return; const m = ctx.session().messages[u]; if (m.images?.length) return toast?.('Die Frage hatte Anhänge. Sende sie bitte neu.', { type: 'warn' });
            const t = m.text; ctx.truncate(u); ctx.setInput(t); ctx.send();
        }));
        content.after(bar);
    };
    const scan = () => {
        if (speakingRow && !speakingRow.isConnected) speech.stop();
        rowsOf().forEach(decorate);
    };
    document.addEventListener('click', (e) => {
        if (!e.target?.closest?.('.ma-export-wrap')) {
            host.querySelectorAll('.ma-export-menu').forEach(m => m.classList.add('hidden'));
        }
    });
    new MutationObserver(() => requestAnimationFrame(scan)).observe(host, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    scan();
}
