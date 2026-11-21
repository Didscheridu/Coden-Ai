// js/ui.js
import { splitArtifacts, Artifacts } from './artifacts.js';

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
        content.innerHTML = '<span class="typing-dots"><i></i><i></i><i></i></span>';
        let latest = '', raf = 0, started = false;
        const stick = () => chatContainer.scrollHeight - chatContainer.scrollTop - chatContainer.clientHeight < 140;
        const paint = () => { raf = 0; const follow = stick(); UI.renderRich(content, latest, key); if (follow) chatContainer.scrollTop = chatContainer.scrollHeight; };
        return {
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

        let historySection = document.getElementById('dynamic-history');
        if (!historySection) {
            historySection = document.createElement('div'); historySection.id = 'dynamic-history'; historySection.className = 'nav-section';
            list.insertBefore(historySection, list.firstChild);
        }

        historySection.innerHTML = '<span class="nav-label">Letzte Chats</span>';
        
        sessions.forEach(session => {
            const item = document.createElement('div');
            const isActive = session.id === activeSessionId;
            item.className = `nav-item ${isActive ? 'active-sub' : ''}`;
            item.style.display = 'flex'; item.style.justifyContent = 'space-between'; item.style.alignItems = 'center'; item.style.cursor = 'pointer';

            item.innerHTML = `
                <div class="nav-item-left" style="display: flex; align-items: center; gap: 12px; overflow: hidden; width: 100%;">
                    <span class="material-symbols-outlined">chat_bubble</span> 
                    <span class="session-title" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;"></span>
                </div>
                <button class="icon-btn delete-chat-btn" title="Chat löschen" style="padding: 4px; color: var(--text-muted); display: flex;">
                    <span class="material-symbols-outlined" style="font-size: 18px;">delete</span>
                </button>
            `;

            item.querySelector('.session-title').textContent = session.title; // kein innerHTML: Titel stammen von der KI

            item.querySelector('.nav-item-left').addEventListener('click', (e) => {
                e.stopPropagation(); document.dispatchEvent(new CustomEvent('loadChatSession', { detail: session.id }));
            });

            item.querySelector('.delete-chat-btn').addEventListener('click', (e) => {
                e.stopPropagation(); document.dispatchEvent(new CustomEvent('deleteChatSession', { detail: session.id }));
            });
            
            historySection.appendChild(item);
        });
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
