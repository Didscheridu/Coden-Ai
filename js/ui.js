// js/ui.js
import { splitArtifacts, Artifacts } from './artifacts.js';
import { createThinkPanel } from './think-panel.js';

const AI_PROFILE_PIC_SRC = './images/coden_logo.jpg';

// Markdown -> HTML, danach von DOMPurify bereinigt (Schutz vor XSS)
function safeMarkdown(text) {
    return DOMPurify.sanitize(marked.parse(text), { ADD_ATTR: ['download', 'target'] });
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

    renderRich: (content, text, msgKey) => {
        const frag = document.createDocumentFragment(); let n = 0;
        for (const seg of splitArtifacts(text)) {
            if (seg.kind === 'text') {
                if (!seg.text.trim()) continue;
                const d = document.createElement('div'); d.className = 'md'; d.innerHTML = safeMarkdown(seg.text); frag.appendChild(d);
            } else {
                const item = { ...seg, key: msgKey + ':' + (n++) };
                const ver = Artifacts.register(item);
                const card = document.createElement('button'); card.type = 'button'; card.className = 'artifact-card' + (item.closed ? '' : ' writing'); card._item = item;
                const ic = document.createElement('span'); ic.className = 'material-symbols-outlined ac-icon'; ic.textContent = { html: 'web', svg: 'draw', markdown: 'article', code: 'code' }[item.type];
                const tx = document.createElement('span'); tx.className = 'ac-text';
                const t = document.createElement('b'); t.textContent = item.title;
                const sub = document.createElement('small'); sub.textContent = (item.closed ? ({ html: 'Webseite', svg: 'Grafik', markdown: 'Dokument', code: item.language || 'Code' }[item.type]) + (ver > 1 ? ' · Version ' + ver : '') + ' · zum Öffnen klicken' : 'Coden schreibt …');
                tx.append(t, sub); card.append(ic, tx);
                frag.appendChild(card);
            }
        }
        content.replaceChildren(frag);
        content.querySelectorAll('.md img').forEach(UI._imageTools);
        content.querySelectorAll('pre code:not(.hljs)').forEach(b => { try { hljs.highlightElement(b); } catch (_) {} });
    },

    _newRow: (isUser) => {
        const chatContainer = document.getElementById('chat-container');
        const welcomeScreen = document.getElementById('welcome-screen'); if (welcomeScreen) welcomeScreen.style.display = 'none';
        const loadingIndicator = document.getElementById('coden-loading-row'); if (loadingIndicator) loadingIndicator.remove();
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

    appendMessage: (text, isUser, animate = false) => {
        const { content, chatContainer } = UI._newRow(isUser);
        if (isUser) { content.innerHTML = safeMarkdown(text); }
        else { UI.renderRich(content, text, 'm' + (++UI._msgCounter)); }
        UI.scrollToBottom(true);
    },

    // Live-Streaming: update(fullText) wird oft aufgerufen, gezeichnet wird höchstens einmal pro Bildschirm-Frame
    createStreamingMessage: () => {
        const { row, content, chatContainer } = UI._newRow(false);
        const key = 'm' + (++UI._msgCounter);
        row.classList.add('streaming');
        const panel = createThinkPanel(); content.replaceChildren(panel.el);
        let latest = '', raf = 0, started = false;
        const stick = () => chatContainer.scrollHeight - chatContainer.scrollTop - chatContainer.clientHeight < 140;
        const paint = () => { raf = 0; const follow = stick(); UI.renderRich(content, latest, key); if (follow) chatContainer.scrollTop = chatContainer.scrollHeight; };
        return {
            think: (k) => panel.think(k), model: (n) => panel.model(n),
            update(text) { latest = text; if (!started && text.trim()) started = true; if (started && !raf) raf = requestAnimationFrame(paint); },
            finish(text) { cancelAnimationFrame(raf); raf = 0; latest = text; row.classList.remove('streaming'); if (!text.trim()) { row.remove(); return; } UI.renderRich(content, text, key); chatContainer.scrollTop = chatContainer.scrollHeight; },
            fail(msg) { cancelAnimationFrame(raf); raf = 0; row.classList.remove('streaming'); const note = document.createElement('div'); note.className = 'stream-error'; note.textContent = msg; if (!latest.trim()) content.replaceChildren(note); else content.appendChild(note); },
            remove() { cancelAnimationFrame(raf); row.remove(); }
        };
    },

    showLoading: (show, modelNameDisplay = "Coden denkt nach...") => {
        const chatContainer = document.getElementById('chat-container');
        if (!chatContainer) return;
        const existing = document.getElementById('coden-loading-row');
        if (!show) { if (existing) existing.remove(); return; }
        if (UI.welcomeScreen) UI.welcomeScreen.classList.add('hidden');
        if (existing) return;
        const row = document.createElement('div'); row.id = 'coden-loading-row'; row.className = 'loading-row';
        row.innerHTML = '<div class="spinner-container"><div class="spinner"></div><img class="spinner-logo" alt=""></div><span class="loading-text"></span>';
        row.querySelector('img').src = AI_PROFILE_PIC_SRC; row.querySelector('.loading-text').textContent = modelNameDisplay;
        chatContainer.appendChild(row); UI.scrollToBottom();
    },

    scrollToBottom: (instant) => {
        UI.chatContainer.scrollTo({ top: UI.chatContainer.scrollHeight, behavior: instant ? 'auto' : 'smooth' });
    },

    renderSidebar: (sessions, activeSessionId) => {
        const list = document.querySelector('.sidebar-scroll-area');
        if (!list) return;
        const collapsed = (() => { try { return JSON.parse(localStorage.getItem('coden_sb_collapsed') || '{}'); } catch (_) { return {}; } })();
        const section = (key, label, items) => {
            const wrap = document.createElement('div'); wrap.className = 'sb-section' + (collapsed[key] ? ' closed' : '');
            const head = document.createElement('button'); head.className = 'sb-head'; head.type = 'button';
            head.append(document.createTextNode(label), Object.assign(document.createElement('span'), { className: 'material-symbols-outlined', textContent: 'expand_more' }));
            head.addEventListener('click', () => { wrap.classList.toggle('closed'); collapsed[key] = wrap.classList.contains('closed'); try { localStorage.setItem('coden_sb_collapsed', JSON.stringify(collapsed)); } catch (_) {} });
            const body = document.createElement('div'); body.className = 'sb-body';
            items.forEach(sess => {
                const row = document.createElement('div'); row.className = 'sb-chat' + (sess.id === activeSessionId ? ' active' : '');
                const ic = Object.assign(document.createElement('span'), { className: 'material-symbols-outlined', textContent: sess.pinned ? 'keep' : 'chat_bubble' });
                const title = document.createElement('span'); title.className = 'session-title'; title.textContent = sess.title; // Titel stammen von der KI: nur textContent
                const act = document.createElement('span'); act.className = 'sb-actions';
                const pin = Object.assign(document.createElement('button'), { className: 'sb-act', title: sess.pinned ? 'Lösen' : 'Anheften', type: 'button' }); pin.innerHTML = '<span class="material-symbols-outlined">' + (sess.pinned ? 'keep_off' : 'keep') + '</span>';
                const del = Object.assign(document.createElement('button'), { className: 'sb-act delete-chat-btn', title: 'Chat löschen', type: 'button' }); del.innerHTML = '<span class="material-symbols-outlined">delete</span>';
                pin.addEventListener('click', (e) => { e.stopPropagation(); document.dispatchEvent(new CustomEvent('togglePinSession', { detail: sess.id })); });
                del.addEventListener('click', (e) => { e.stopPropagation(); document.dispatchEvent(new CustomEvent('deleteChatSession', { detail: sess.id })); });
                act.append(pin, del); row.append(ic, title, act);
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
        if (UI.welcomeScreen) UI.welcomeScreen.style.display = 'flex';
    }
};

UI.init();
