// js/ui.js
import { splitArtifacts, Artifacts, ARTIFACT_ICON, ARTIFACT_LABEL } from './artifacts.js';
import { createThinkPanel, thinkSummary } from './think-panel.js';
import { splitSuggestions } from './system-prompt.js';
import { colorize, extractWidgets, hydrateWidgets, loader } from './rich-elements.js';

const AI_PROFILE_PIC_SRC = './images/coden_logo.jpg';

// Markdown -> HTML, danach von DOMPurify bereinigt (Schutz vor XSS)
// Formeln ($…$ und $$…$$) vor marked schützen und danach mit KaTeX zeichnen (Code bleibt unberührt)
const escHtml = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function protectMath(text) {
    const math = [];
    const out = String(text).split(/(```[\s\S]*?(?:```|$)|`[^`\n]*`)/g).map((part, i) => {
        if (i % 2) return part;
        return part
            .replace(/\$\$([\s\S]+?)\$\$/g, (m, f) => { math.push({ f, d: true }); return `@@MATH${math.length - 1}@@`; })
            .replace(/\\\[([\s\S]+?)\\\]/g, (m, f) => { math.push({ f, d: true }); return `@@MATH${math.length - 1}@@`; })
            .replace(/(^|[^\\$\w])\$(?=\S)([^$\n]{1,300}?\S)\$(?!\d)/g, (m, pre, f) => { math.push({ f, d: false }); return `${pre}@@MATH${math.length - 1}@@`; })
            .replace(/\\\(([^\n]+?)\\\)/g, (m, f) => { math.push({ f, d: false }); return `@@MATH${math.length - 1}@@`; });
    }).map((part, i) => (i % 2 ? part : colorize(part))).join(''); // ==Markierung== und {{farbe:Text}} (nie in Code)
    return { out, math };
}
function renderMath(html, math) {
    if (!math.length) return html;
    return html.replace(/@@MATH(\d+)@@/g, (m, i) => {
        const x = math[+i]; if (!x) return m;
        try { if (window.katex) return window.katex.renderToString(x.f, { displayMode: x.d, throwOnError: false, output: 'html' }); } catch (_) {}
        return `<code>${escHtml(x.f)}</code>`;
    });
}
function safeMarkdown(text) {
    const { out, math } = protectMath(text);
    return renderMath(DOMPurify.sanitize(marked.parse(out), { ADD_ATTR: ['download', 'target'] }), math);
}
// Markdown für Inhalte in Quiz, Karteikarten usw.: kurz (ohne umschließendes <p>) oder als Block
function richMd(text, block = false) {
    const html = safeMarkdown(String(text || ''));
    if (block) { const d = document.createElement('div'); d.innerHTML = html; enhance(d); return d.innerHTML; }
    return html.trim().replace(/^<p>([\s\S]*?)<\/p>$/, (m, x) => (x.includes('<p>') ? m : x));
}
// Ein Markdown-Block mit allen Extras (Markierungen, Formeln, Hinweis-Kästen, <plot>, <quiz> …) – z. B. für den Merkzettel
export function renderRichBlock(text, key = '') {
    const { text: md, widgets } = extractWidgets(String(text || ''));
    const d = document.createElement('div'); d.className = 'md'; d.innerHTML = safeMarkdown(md); enhance(d);
    if (widgets.length) hydrateWidgets(d, widgets, richMd, key);
    return d;
}
// > [!TIP] … wird zu einem farbigen Hinweis-Kasten
const CALLOUT = { NOTE: ['info', 'Hinweis'], TIP: ['lightbulb', 'Tipp'], WARNING: ['warning', 'Achtung'], IMPORTANT: ['priority_high', 'Wichtig'], CAUTION: ['error', 'Vorsicht'],
    SUCCESS: ['check_circle', 'Richtig'], QUESTION: ['help', 'Frage'], EXAMPLE: ['science', 'Beispiel'], SUMMARY: ['summarize', 'Kurz gesagt'], DEFINITION: ['menu_book', 'Definition'], FORMULA: ['function', 'Formel'], KEY: ['key', 'Merke'] };
const CALLOUT_RE = new RegExp('^\\s*\\[!(' + Object.keys(CALLOUT).join('|') + ')\\]\\s*(<br>)?', 'i');
function enhance(root) {
    root.querySelectorAll('blockquote').forEach(q => {
        const p = q.firstElementChild; const m = p && p.innerHTML.match(CALLOUT_RE); if (!m) return;
        const k = m[1].toUpperCase(); p.innerHTML = p.innerHTML.slice(m[0].length); if (!p.textContent.trim() && !p.children.length) p.remove();
        const head = document.createElement('div'); head.className = 'callout-head'; head.innerHTML = '<span class="material-symbols-outlined"></span><b></b>'; head.firstChild.textContent = CALLOUT[k][0]; head.lastChild.textContent = CALLOUT[k][1];
        q.classList.add('callout', 'callout-' + k.toLowerCase()); q.prepend(head);
    });
    root.querySelectorAll('.choices[data-choices]').forEach(box => {
        let list = []; try { list = JSON.parse(decodeURIComponent(box.dataset.choices)); } catch (_) {}
        box.removeAttribute('data-choices');
        list.forEach(c => { const b = document.createElement('button'); b.type = 'button'; b.className = 'choice'; b.textContent = c; b.addEventListener('click', () => { box.querySelectorAll('.choice').forEach(x => { x.disabled = true; }); b.classList.add('picked'); document.dispatchEvent(new CustomEvent('codenFollowup', { detail: c })); }); box.append(b); });
    });
    root.querySelectorAll('table').forEach(t => { if (!t.parentElement.classList.contains('table-wrap')) { const w = document.createElement('div'); w.className = 'table-wrap'; t.replaceWith(w); w.append(t); } });
}

const customRenderer = new marked.Renderer();

customRenderer.code = function(tokenOrCode, language) {
    let codeText = ''; let lang = '';
    if (typeof tokenOrCode === 'object' && tokenOrCode !== null) { codeText = tokenOrCode.text || ''; lang = tokenOrCode.lang || ''; } 
    else { codeText = tokenOrCode || ''; lang = language || ''; }
    
    codeText = String(codeText);
    const validLanguage = hljs.getLanguage(lang) ? lang : 'plaintext';
    const highlightedCode = hljs.highlight(codeText, { language: validLanguage }).value;
    const langLabel = lang ? lang.charAt(0).toUpperCase() + lang.slice(1) : 'Code';
    const encodedCode = encodeURIComponent(codeText);

    return `<div class="code-block-wrapper"><div class="code-header"><span class="lang">${langLabel}</span><button class="copy-code-btn" data-code="${encodedCode}"><span class="material-symbols-outlined">content_copy</span> Kopieren</button></div><pre><code class="hljs ${validLanguage}">${highlightedCode}</code></pre></div>`;
};

marked.setOptions({ renderer: customRenderer, breaks: true, gfm: true });

export const UI = {
    chatContainer: document.getElementById('chat-container'),
    welcomeScreen: document.getElementById('welcome-screen'),

    init: () => {
        UI.chatContainer.addEventListener('click', async (e) => {
            const card = e.target.closest('.artifact-card');
            if (card && card._item) { Artifacts.open(card._item); return; }
            const copyBtn = e.target.closest('.copy-code-btn');
            if (copyBtn) {
                const rawCode = decodeURIComponent(copyBtn.getAttribute('data-code'));
                try {
                    await navigator.clipboard.writeText(rawCode);
                    const originalHTML = copyBtn.innerHTML;
                    copyBtn.innerHTML = `<span class="material-symbols-outlined">check</span> Kopiert!`;
                    copyBtn.classList.add('done');
                    setTimeout(() => { copyBtn.innerHTML = originalHTML; copyBtn.classList.remove('done'); }, 2000);
                } catch (err) { console.error('Fehler beim Kopieren:', err); }
            }
        });
    },

    // Die Helper-Funktion für Code-Highlighting
    applyPostRendering: (content) => {
        content.querySelectorAll('pre code').forEach((block) => {
            hljs.highlightElement(block);
        });
        content.querySelectorAll('img').forEach((img) => {
            img.style.maxWidth = '100%';
            img.style.borderRadius = '8px';
            img.style.marginTop = '12px';
            img.style.border = '1px solid rgba(255,255,255,0.05)';
        });
    },

    // Baut den Inhalt einer KI-Nachricht: Markdown-Abschnitte und Artefakt-Karten
    // Bilder im Chat: passen immer komplett auf den Bildschirm, mit Herunterladen / Öffnen
    _imageTools: (img) => {
        if (img.closest('.img-card')) return;
        const card = document.createElement('figure'); card.className = 'img-card';
        const bar = document.createElement('div'); bar.className = 'img-bar';
        const mk = (icon, label, fn) => { const b = document.createElement('button'); b.type = 'button'; b.title = label; b.className = 'img-btn'; b.innerHTML = '<span class="material-symbols-outlined"></span><span></span>'; b.children[0].textContent = icon; b.children[1].textContent = label; b.addEventListener('click', fn); return b; };
        const src = () => img.currentSrc || img.src;
        bar.append(
            mk('download', 'Herunterladen', async (e) => {
                const btn = e.currentTarget; btn.disabled = true;
                try {
                    const blob = await (await fetch(src())).blob();
                    const ext = ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' })[blob.type] || 'png';
                    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'coden-bild-' + Date.now().toString(36) + '.' + ext; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
                } catch (_) { window.open(src(), '_blank', 'noopener'); }
                btn.disabled = false;
            }),
            mk('open_in_new', 'Öffnen', () => window.open(src(), '_blank', 'noopener')),
            mk('content_copy', 'Link kopieren', async (e) => { try { await navigator.clipboard.writeText(src()); const l = e.currentTarget.children[1]; const o = l.textContent; l.textContent = 'Kopiert ✓'; setTimeout(() => { l.textContent = o; }, 1500); } catch (_) {} })
        );
        img.replaceWith(card); card.append(img, bar);
        img.loading = 'lazy'; img.addEventListener('click', () => window.open(src(), '_blank', 'noopener'));
    },

    renderRich: (content, text, msgKey, { final = true } = {}) => {
        const frag = document.createDocumentFragment(); let n = 0, tn = 0; const items = [];
        for (const seg of splitArtifacts(splitSuggestions(text).text)) {
            if (seg.kind === 'text') {
                if (!seg.text.trim()) continue;
                // Interaktive Blöcke (<quiz>, <flashcards>, <steps> …) erst herausnehmen, dann Markdown, dann die Elemente einsetzen
                const { text: md, widgets } = extractWidgets(seg.text, { final });
                const d = document.createElement('div'); d.className = 'md'; d.innerHTML = safeMarkdown(md); enhance(d);
                if (widgets.length) hydrateWidgets(d, widgets, richMd, msgKey + ':t' + (tn++));
                frag.appendChild(d);
            } else {
                const item = { ...seg, key: msgKey + ':' + (n++) }; items.push(item);
                const ver = Artifacts.register(item);
                const card = document.createElement('button'); card.type = 'button'; card.className = 'artifact-card' + (item.closed ? '' : ' writing'); card._item = item;
                const ic = document.createElement('span'); ic.className = 'material-symbols-outlined ac-icon'; ic.textContent = ARTIFACT_ICON[item.type] || 'code';
                const tx = document.createElement('span'); tx.className = 'ac-text';
                const t = document.createElement('b'); t.textContent = item.title;
                const sub = document.createElement('small'); sub.textContent = (item.closed ? (item.type === 'code' ? (item.language || 'Code') : (ARTIFACT_LABEL[item.type] || 'Artefakt')) + (ver > 1 ? ' · Version ' + ver : '') + ' · zum Öffnen klicken' : 'Coden schreibt …');
                tx.append(t, sub); card.append(ic, tx);
                frag.appendChild(card);
            }
        }
        content.replaceChildren(frag);
        content.querySelectorAll('.md img:not(.cl-logo)').forEach(UI._imageTools);
        content.querySelectorAll('pre code:not(.hljs)').forEach(b => { try { hljs.highlightElement(b); } catch (_) {} });
        return items;
    },

    _newRow: (isUser) => {
        const chatContainer = document.getElementById('chat-container');
        const welcomeScreen = document.getElementById('welcome-screen'); if (welcomeScreen) welcomeScreen.classList.add('hidden');
        document.getElementById('welcome-extra')?.classList.add('hidden');
        const loadingIndicator = document.getElementById('coden-loading-row'); if (loadingIndicator) { clearInterval(loadingIndicator._timer); loadingIndicator.remove(); }
        const row = document.createElement('div'); row.className = `message-row ${isUser ? 'user-message' : 'ai-message'}`;
        const avatar = document.createElement('div'); avatar.className = 'avatar';
        if (!isUser) { const img = document.createElement('img'); img.src = AI_PROFILE_PIC_SRC; img.alt = ''; img.onerror = () => { img.style.display = 'none'; }; avatar.appendChild(img); }
        else {
            const photo = localStorage.getItem('coden_user_photo');
            if (photo && /^(data:image\/|https:)/.test(photo)) { const img = document.createElement('img'); img.src = photo; img.alt = ''; avatar.appendChild(img); }
            else { avatar.classList.add('user-default'); avatar.innerHTML = '<span class="material-symbols-outlined">person</span>'; }
        }
        const content = document.createElement('div'); content.className = 'content';
        row.append(avatar, content); chatContainer.appendChild(row);
        return { row, content, chatContainer };
    },

    _msgCounter: 0,
    busySessions: new Set(),

    appendMessage: (text, isUser, animate = false, extra = {}) => {
        const { content, row } = UI._newRow(isUser);
        if (extra.failed) row.dataset.failed = '1';
        if (isUser) { content.innerHTML = safeMarkdown(text); }
        else {
            const think = thinkSummary(extra.think); const answer = document.createElement('div'); answer.className = 'answer';
            if (think) content.append(think); content.append(answer);
            UI.renderRich(answer, text, 'm' + (++UI._msgCounter));
            if (extra.last && !extra.failed) UI.addSuggestions(row, text);
        }
        UI.scrollToBottom(true);
        return row;
    },

    // Vorschläge für die nächste Frage (wie bei Perplexity): nur unter der letzten Antwort
    addSuggestions: (row, text) => {
        document.querySelectorAll('.followups').forEach(f => f.remove());
        const { items } = splitSuggestions(text); if (!items.length) return;
        const box = document.createElement('div'); box.className = 'followups';
        items.forEach(q => { const b = document.createElement('button'); b.type = 'button'; b.className = 'followup'; b.innerHTML = '<span class="material-symbols-outlined">subdirectory_arrow_right</span><span></span>'; b.lastChild.textContent = q; b.addEventListener('click', () => document.dispatchEvent(new CustomEvent('codenFollowup', { detail: q }))); box.append(b); });
        row.querySelector('.content')?.append(box);
    },

    // Live-Streaming: glättet stoßweise SSE-Chunks per requestAnimationFrame zu einem flüssigen 60fps-Textfluss.
    // Oben die Denk-Anzeige (bleibt nach der Antwort als "Hat 12 s nachgedacht" stehen), darunter die Antwort.
    createStreamingMessage: ({ startedAt } = {}) => {
        const { row, content, chatContainer } = UI._newRow(false);
        const key = 'm' + (++UI._msgCounter);
        row.classList.add('streaming');
        const panel = createThinkPanel({ startedAt }); const answer = document.createElement('div'); answer.className = 'answer';
        content.replaceChildren(panel.el, answer);
        let target = '', shownLen = 0, raf = 0, lastFrame = 0, started = false, info = null; const opened = new Set();
        const stick = () => chatContainer.scrollHeight - chatContainer.scrollTop - chatContainer.clientHeight < 140;
        // Neues Artefakt im Text? -> Fenster sofort öffnen und live mitschreiben lassen (wie bei Claude); auf dem Handy nur die Karte
        const autoOpen = (items) => { const it = items[items.length - 1]; if (!it || opened.has(it.key) || window.innerWidth < 900 || !row.isConnected) return; opened.add(it.key); Artifacts.open(it); };
        const nextSliceEnd = (cur, goal, dtMs) => {
            const backlog = goal - cur;
            if (backlog <= 0) return goal;
            // Adaptive Geschwindigkeit: ruhig bei kleinem Puffer, zieht bei großen Bursts nahtlos an
            const stepBase = Math.max(1.5, dtMs / 16.67);
            const chars = Math.max(2, Math.round(stepBase * (2.5 + backlog * 0.14)));
            let next = Math.min(goal, cur + chars);
            // Surrogate-Pairs nicht teilen
            if (next < goal && target.charCodeAt(next - 1) >= 0xD800 && target.charCodeAt(next - 1) <= 0xDBFF) next++;
            // Bei normalem Text möglichst bis zum nächsten Wortende/Leerzeichen gehen (max +5 Zeichen)
            if (next < goal) {
                for (let k = 0; k < 5 && next + k < goal; k++) {
                    const ch = target.charCodeAt(next + k);
                    if (ch === 32 || ch === 10) { next = next + k + 1; break; }
                }
            }
            return Math.min(goal, next);
        };
        const paint = (ts) => {
            raf = 0;
            const dt = lastFrame ? Math.min(64, ts - lastFrame) : 16.67;
            lastFrame = ts;
            if (shownLen > target.length) shownLen = target.length;
            const nextLen = nextSliceEnd(shownLen, target.length, dt);
            if (nextLen !== shownLen || !answer.childNodes.length) {
                shownLen = nextLen;
                const follow = stick();
                autoOpen(UI.renderRich(answer, target.slice(0, shownLen), key, { final: false }));
                if (follow) chatContainer.scrollTop = chatContainer.scrollHeight;
            }
            if (shownLen < target.length) {
                raf = requestAnimationFrame(paint);
            } else {
                lastFrame = 0;
            }
        };
        const end = (minSecs = 2) => { if (!info) { info = panel.done(); if (!(info.secs >= minSecs || info.steps.length || info.text)) panel.remove(); } return info; };
        return {
            row, attached: () => row.isConnected,
            think: (k) => panel.think(k), model: (n) => panel.model(n),
            update(text) {
                target = text;
                if (text.length < shownLen) shownLen = text.length;
                if (!started && text.trim()) { started = true; end(); }
                if (started && !raf) { lastFrame = 0; raf = requestAnimationFrame(paint); }
            },
            finish(text) {
                cancelAnimationFrame(raf); raf = 0; lastFrame = 0;
                target = text; shownLen = text.length;
                row.classList.remove('streaming');
                const i = end();
                if (!text.trim()) { row.remove(); return i; }
                UI.renderRich(answer, text, key);
                UI.addSuggestions(row, text);
                if (stick()) chatContainer.scrollTop = chatContainer.scrollHeight;
                return i;
            },
            fail(msg, actions = []) {
                cancelAnimationFrame(raf); raf = 0; lastFrame = 0; row.classList.remove('streaming'); row.dataset.failed = '1';
                const i = end(1);
                const note = document.createElement('div'); note.className = 'stream-error';
                const tx = document.createElement('div'); tx.textContent = msg; note.appendChild(tx);
                if (Array.isArray(actions) && actions.length) {
                    const bar = document.createElement('div'); bar.className = 'stream-error-actions';
                    actions.forEach(a => {
                        const b = document.createElement('button'); b.type = 'button'; b.className = 'stream-error-btn';
                        b.textContent = a.label;
                        b.addEventListener('click', (e) => { e.stopPropagation(); a.run?.(); });
                        bar.appendChild(b);
                    });
                    note.appendChild(bar);
                }
                answer.appendChild(note);
                return i;
            },
            info: () => info,
            remove() { cancelAnimationFrame(raf); raf = 0; panel.remove(); row.remove(); }
        };
    },

    // Lade-Anzeige, bevor die Antwort startet: gleiche Animation wie überall + was gerade passiert + Zeit
    showLoading: (show, modelNameDisplay = 'Coden denkt nach …') => {
        const chatContainer = document.getElementById('chat-container');
        if (!chatContainer) return;
        const existing = document.getElementById('coden-loading-row');
        if (!show) { if (existing) { clearInterval(existing._timer); existing.remove(); } return; }
        if (UI.welcomeScreen) UI.welcomeScreen.style.display = 'none';
        if (existing) {
            const label = existing.querySelector('.loading-text');
            if (label && label.textContent !== modelNameDisplay) label.textContent = modelNameDisplay;
            UI.scrollToBottom();
            return;
        }
        const row = document.createElement('div'); row.id = 'coden-loading-row'; row.className = 'loading-row';
        const tx = document.createElement('div'); tx.className = 'loading-info';
        const label = document.createElement('span'); label.className = 'loading-text'; label.textContent = modelNameDisplay;
        const sub = document.createElement('small'); sub.className = 'loading-sub';
        tx.append(label, sub); row.append(loader({ size: 30 }), tx);
        const PHASES = ['Liest deine Nachricht', 'Wählt das passende Modell', 'Verbindet mit dem Server', 'Plant die Antwort', 'Sucht die wichtigsten Infos heraus', 'Formuliert die Antwort'];
        const t0 = Date.now();
        const tick = () => { const s = Math.round((Date.now() - t0) / 1000); sub.textContent = PHASES[Math.min(PHASES.length - 1, Math.floor(s / 3))] + ' …' + (s >= 1 ? ' · ' + s + ' s' : ''); };
        tick(); row._timer = setInterval(() => { if (!row.isConnected) return clearInterval(row._timer); tick(); }, 1000);
        chatContainer.appendChild(row); UI.scrollToBottom(true);
    },

    scrollToBottom: (instant) => {
        UI.chatContainer.scrollTo({ top: UI.chatContainer.scrollHeight, behavior: instant ? 'auto' : 'smooth' });
    },

    renderSidebar: (sessions, activeSessionId) => {
        document.getElementById('sb-ctx-menu')?.remove();
        sessions = sessions.filter(s => !s.temp); // temporäre Chats tauchen nicht im Verlauf auf
        const list = document.querySelector('.sidebar-scroll-area');
        if (!list) return;
        const collapsed = (() => { try { return JSON.parse(localStorage.getItem('coden_sb_collapsed') || '{}'); } catch (_) { return {}; } })();
        const openRowMenu = (sess, btn) => {
            const existing = document.getElementById('sb-ctx-menu');
            const same = existing && existing.dataset.sid === sess.id;
            existing?.remove();
            if (same) return;
            const menu = document.createElement('div');
            menu.id = 'sb-ctx-menu';
            menu.className = 'sb-ctx-menu';
            menu.dataset.sid = sess.id;
            menu.setAttribute('role', 'menu');
            const mk = (ic, label, cls, fn) => {
                const b = document.createElement('button');
                b.type = 'button';
                b.className = 'sb-ctx-item' + (cls ? ' ' + cls : '');
                b.setAttribute('role', 'menuitem');
                b.innerHTML = '<span class="material-symbols-outlined"></span><span></span>';
                b.firstChild.textContent = ic;
                b.lastChild.textContent = label;
                b.addEventListener('click', (e) => { e.stopPropagation(); menu.remove(); fn(); });
                return b;
            };
            menu.append(
                mk(sess.pinned ? 'keep_off' : 'keep', sess.pinned ? 'Lösen' : 'Anheften', '', () => document.dispatchEvent(new CustomEvent('togglePinSession', { detail: sess.id }))),
                Object.assign(document.createElement('div'), { className: 'cm-sep' }),
                mk('delete', 'Chat löschen', 'danger', () => document.dispatchEvent(new CustomEvent('deleteChatSession', { detail: sess.id })))
            );
            document.body.append(menu);
            const r = btn.getBoundingClientRect();
            const mw = menu.offsetWidth || 168, mh = menu.offsetHeight || 86;
            const left = Math.max(8, Math.min(r.right - mw, window.innerWidth - mw - 8));
            const top = r.bottom + 4 + mh > window.innerHeight - 8 ? Math.max(8, r.top - mh - 4) : r.bottom + 4;
            menu.style.left = left + 'px';
            menu.style.top = top + 'px';
        };
        if (!UI._sbCtxBound) {
            UI._sbCtxBound = true;
            document.addEventListener('click', (e) => { if (!e.target.closest('#sb-ctx-menu, .sb-more-btn')) document.getElementById('sb-ctx-menu')?.remove(); });
            document.addEventListener('keydown', (e) => { if (e.key === 'Escape') document.getElementById('sb-ctx-menu')?.remove(); });
            list.addEventListener('scroll', () => document.getElementById('sb-ctx-menu')?.remove(), { passive: true });
        }
        const section = (key, label, items) => {
            const wrap = document.createElement('div'); wrap.className = 'sb-section' + (collapsed[key] ? ' closed' : '');
            const head = document.createElement('button'); head.className = 'sb-head'; head.type = 'button';
            head.append(document.createTextNode(label), Object.assign(document.createElement('span'), { className: 'material-symbols-outlined', textContent: 'expand_more' }));
            head.addEventListener('click', () => { wrap.classList.toggle('closed'); collapsed[key] = wrap.classList.contains('closed'); try { localStorage.setItem('coden_sb_collapsed', JSON.stringify(collapsed)); } catch (_) {} });
            const body = document.createElement('div'); body.className = 'sb-body';
            items.forEach(sess => {
                const busy = UI.busySessions?.has(sess.id);
                const row = document.createElement('div'); row.className = 'sb-chat' + (sess.id === activeSessionId ? ' active' : '') + (sess.unread ? ' unread' : '') + (busy ? ' busy' : '');
                const ic = Object.assign(document.createElement('span'), { className: 'material-symbols-outlined' + (busy ? ' sb-spin' : ''), textContent: busy ? 'progress_activity' : sess.pinned ? 'keep' : 'chat_bubble' });
                const title = document.createElement('span'); title.className = 'session-title'; title.textContent = sess.title; // Titel stammen von der KI: nur textContent
                const act = document.createElement('span'); act.className = 'sb-actions';
                const more = Object.assign(document.createElement('button'), { className: 'sb-act sb-more-btn', title: 'Chat-Aktionen', type: 'button' });
                more.setAttribute('aria-label', 'Chat-Aktionen');
                more.innerHTML = '<span class="material-symbols-outlined">more_horiz</span>';
                more.addEventListener('click', (e) => { e.stopPropagation(); openRowMenu(sess, more); });
                act.append(more); row.append(ic, title, act);
                row.addEventListener('click', () => document.dispatchEvent(new CustomEvent('loadChatSession', { detail: sess.id })));
                body.appendChild(row);
            });
            wrap.append(head, body); return wrap;
        };
        const pinned = sessions.filter(s => s.pinned), recent = sessions.filter(s => !s.pinned);
        list.replaceChildren(...[pinned.length ? section('pinned', 'Angepinnt', pinned) : null, section('recent', 'Letzte Elemente', recent)].filter(Boolean));
        document.dispatchEvent(new CustomEvent('sessionsRendered', { detail: sessions }));
    },

    resetUI: () => {
        Artifacts.reset();
        const messages = UI.chatContainer.querySelectorAll('.message-row');
        messages.forEach(msg => msg.remove());
        const loadingIndicator = document.getElementById('coden-loading-row');
        if (loadingIndicator) loadingIndicator.remove();
        if (UI.welcomeScreen) { UI.welcomeScreen.style.display = ''; UI.welcomeScreen.classList.remove('hidden'); }
        document.getElementById('welcome-extra')?.classList.remove('hidden');
    }
};

UI.init();
