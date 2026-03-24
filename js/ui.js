// js/ui.js

const AI_PROFILE_PIC_SRC = './images/coden_logo.jpg';

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

    return `
    <div class="code-block-wrapper" style="margin: 16px 0; border-radius: 8px; overflow: hidden; background: #1e1e1e; border: 1px solid rgba(255,255,255,0.05);">
        <div class="code-header" style="display: flex; justify-content: space-between; padding: 6px 14px; background: rgba(255,255,255,0.03); font-size: 11px; color: #888; border-bottom: 1px solid rgba(255,255,255,0.05);">
            <span class="lang" style="font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">${langLabel}</span>
            <div class="code-actions">
                <button class="text-btn copy-code-btn" data-code="${encodedCode}" style="background: transparent; border: none; color: #888; cursor: pointer; display: flex; align-items: center; gap: 4px; font-size: 11px; padding: 0;">
                    <span class="material-symbols-outlined" style="font-size: 14px;">content_copy</span> Kopieren
                </button>
            </div>
        </div>
        <pre style="margin: 0; padding: 14px; overflow-x: auto; background: transparent;"><code class="hljs ${validLanguage}" style="font-size: var(--chat-font-size, 14px); background: transparent; padding: 0; display: block; line-height: 1.5;">${highlightedCode}</code></pre>
    </div>`;
};

marked.setOptions({ renderer: customRenderer, breaks: true, gfm: true });

export const UI = {
    chatContainer: document.getElementById('chat-container'),
    welcomeScreen: document.getElementById('welcome-screen'),

    init: () => {
        UI.chatContainer.addEventListener('click', async (e) => {
            const copyBtn = e.target.closest('.copy-code-btn');
            if (copyBtn) {
                const rawCode = decodeURIComponent(copyBtn.getAttribute('data-code'));
                try {
                    await navigator.clipboard.writeText(rawCode);
                    const originalHTML = copyBtn.innerHTML;
                    copyBtn.innerHTML = `<span class="material-symbols-outlined" style="font-size: 14px;">check</span> Kopiert!`;
                    copyBtn.style.color = "var(--accent-green, #4caf50)";
                    setTimeout(() => { copyBtn.innerHTML = originalHTML; copyBtn.style.color = "#888"; }, 2000);
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

    // Neu: Mit animate Parameter für den Typewriter-Effekt!
    appendMessage: (text, isUser, animate = false) => {
        const chatContainer = document.getElementById('chat-container');
        if (!chatContainer) return;
        
        const welcomeScreen = document.getElementById('welcome-screen');
        if (welcomeScreen) welcomeScreen.style.display = 'none';

        const loadingIndicator = document.getElementById('coden-loading-row');
        if (loadingIndicator) loadingIndicator.remove();

        const msgDiv = document.createElement('div');
        msgDiv.className = `message-row ${isUser ? 'user-message' : 'ai-message'}`;
        
        msgDiv.style.display = 'flex';
        msgDiv.style.gap = '16px';
        msgDiv.style.marginBottom = '24px';
        msgDiv.style.alignItems = 'flex-start';
        
        if (isUser) msgDiv.style.flexDirection = 'row-reverse';

        const avatar = document.createElement('div');
        avatar.className = 'avatar';
        avatar.style.flexShrink = '0'; avatar.style.width = '36px'; avatar.style.height = '36px'; avatar.style.borderRadius = '50%'; avatar.style.overflow = 'hidden'; avatar.style.display = 'flex'; avatar.style.alignItems = 'center'; avatar.style.justifyContent = 'center';

        if (!isUser) {
            avatar.style.background = 'transparent';
            avatar.innerHTML = `<img src="${AI_PROFILE_PIC_SRC}" style="width:100%; height:100%; object-fit:contain;" onerror="this.style.display='none'">`;
        } else {
            const userPhoto = localStorage.getItem('coden_user_photo');
            if (userPhoto) avatar.innerHTML = `<img src="${userPhoto}" style="width:100%; height:100%; object-fit:cover;">`;
            else { avatar.style.background = 'var(--accent-blue, #2b6cb0)'; avatar.innerHTML = '<span class="material-symbols-outlined" style="color:white; font-size: 20px;">person</span>'; }
        }

        const content = document.createElement('div');
        content.className = 'content';
        content.style.maxWidth = '75%';
        content.style.lineHeight = '1.6';
        
        if (isUser) {
            content.style.background = 'var(--accent-blue, #2b6cb0)'; content.style.color = '#ffffff'; content.style.padding = '10px 16px'; content.style.borderRadius = '16px 16px 4px 16px'; content.style.fontSize = '15px';
            content.innerHTML = marked.parse(text);
        } else {
            content.style.background = 'transparent'; content.style.color = 'var(--text-primary, #ececec)'; content.style.padding = '4px 0';
        }

        msgDiv.appendChild(avatar);
        msgDiv.appendChild(content);
        chatContainer.appendChild(msgDiv);

        // 🌟 TYPEWRITER EFFEKT FÜR DIE KI 🌟
        if (!isUser && animate) {
            let i = 0;
            const chunkSize = 2; // Wie viele Buchstaben pro Tick (Geschwindigkeit)
            const typingInterval = setInterval(() => {
                i += chunkSize;
                if (i >= text.length) i = text.length;
                
                content.innerHTML = marked.parse(text.substring(0, i));
                chatContainer.scrollTop = chatContainer.scrollHeight;

                if (i >= text.length) {
                    clearInterval(typingInterval);
                    UI.applyPostRendering(content); // Code-Blöcke erst am Ende stylen
                }
            }, 10); // Geschwindigkeit (10ms)
        } else if (!isUser && !animate) {
            // Wenn Chats geladen werden (keine Animation)
            content.innerHTML = marked.parse(text);
            UI.applyPostRendering(content);
        }

        chatContainer.scrollTop = chatContainer.scrollHeight;
    },

    // 🌟 WIEDER DA: Der Kreis-Spinner um das Logo 🌟
    showLoading: (show, modelNameDisplay = "Coden denkt nach...") => {
        const chatContainer = document.getElementById('chat-container');
        if (!chatContainer) return;
        
        const existingIndicator = document.getElementById('coden-loading-row');
        
        if (show) {
            if (UI.welcomeScreen) UI.welcomeScreen.classList.add('hidden');
            if (existingIndicator) return; 

            const loadingRow = document.createElement('div');
            loadingRow.id = 'coden-loading-row';
            loadingRow.style.display = 'flex'; loadingRow.style.gap = '16px'; loadingRow.style.marginBottom = '24px'; loadingRow.style.alignItems = 'flex-start';

            // Platzhalter für das Avatar-Grid
            const spacer = document.createElement('div');
            spacer.style.width = '36px'; spacer.style.flexShrink = '0';

            const content = document.createElement('div');
            content.style.display = 'flex'; content.style.alignItems = 'center'; content.style.gap = '16px'; content.style.padding = '4px 0';

            // Hier ist dein geliebter Spinner-Container!
            const spinnerHTML = `
                <div class="spinner-container" style="position: relative; width: 36px; height: 36px; display: flex; justify-content: center; align-items: center;">
                    <div class="spinner" style="position: absolute; width: 100%; height: 100%; border: 3px solid rgba(255,255,255,0.1); border-top-color: var(--accent-blue); border-radius: 50%; animation: spin 1s linear infinite;"></div>
                    <img src="${AI_PROFILE_PIC_SRC}" class="spinner-logo" style="width: 24px; height: 24px; border-radius: 50%; object-fit: cover;" onerror="this.style.display='none'">
                </div>
                <span style="font-size: 13px; color: var(--text-muted, #888); font-weight: 500;">${modelNameDisplay}</span>
            `;
            
            // Falls du die Spin-Animation im CSS nicht mehr hast, injizieren wir sie sicherheitshalber:
            if (!document.getElementById('spin-keyframes')) {
                const style = document.createElement('style'); style.id = 'spin-keyframes';
                style.innerHTML = `@keyframes spin { 100% { transform: rotate(360deg); } }`;
                document.head.appendChild(style);
            }

            content.innerHTML = spinnerHTML;
            loadingRow.appendChild(spacer);
            loadingRow.appendChild(content);

            chatContainer.appendChild(loadingRow);
            UI.scrollToBottom();
        } else {
            if (existingIndicator) existingIndicator.remove();
        }
    },

    scrollToBottom: () => {
        UI.chatContainer.scrollTo({ top: UI.chatContainer.scrollHeight, behavior: 'smooth' });
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
                    <span class="session-title" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${session.title}</span>
                </div>
                <button class="icon-btn delete-chat-btn" title="Chat löschen" style="padding: 4px; color: var(--text-muted); display: flex;">
                    <span class="material-symbols-outlined" style="font-size: 18px;">delete</span>
                </button>
            `;

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
        const messages = UI.chatContainer.querySelectorAll('.message-row');
        messages.forEach(msg => msg.remove());
        const loadingIndicator = document.getElementById('coden-loading-row');
        if (loadingIndicator) loadingIndicator.remove();
        if (UI.welcomeScreen) UI.welcomeScreen.style.display = 'flex';
    }
};

UI.init();
