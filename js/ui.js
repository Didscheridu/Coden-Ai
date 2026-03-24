// js/ui.js

const AI_PROFILE_PIC_SRC = './images/coden_logo.jpg';

const customRenderer = new marked.Renderer();

// Kompatibilität für marked.js v12 und v13+
customRenderer.code = function(tokenOrCode, language) {
    let codeText = '';
    let lang = '';
    
    if (typeof tokenOrCode === 'object' && tokenOrCode !== null) {
        codeText = tokenOrCode.text || '';
        lang = tokenOrCode.lang || '';
    } else {
        codeText = tokenOrCode || '';
        lang = language || '';
    }

    codeText = String(codeText);
    const validLanguage = hljs.getLanguage(lang) ? lang : 'plaintext';
    const highlightedCode = hljs.highlight(codeText, { language: validLanguage }).value;
    const langLabel = lang ? lang.charAt(0).toUpperCase() + lang.slice(1) : 'Code';
    const encodedCode = encodeURIComponent(codeText);

    return `
    <div class="code-block-wrapper" style="margin: 16px 0; border-radius: 8px; overflow: hidden; background: #1e1e1e; border: 1px solid rgba(255,255,255,0.1);">
        <div class="code-header" style="display: flex; justify-content: space-between; padding: 8px 16px; background: rgba(255,255,255,0.05); font-size: 12px; color: #aaa;">
            <span class="lang">${langLabel}</span>
            <div class="code-actions">
                <button class="text-btn copy-code-btn" data-code="${encodedCode}" style="background: transparent; border: none; color: #aaa; cursor: pointer; display: flex; align-items: center; gap: 4px;">
                    <span class="material-symbols-outlined" style="font-size: 14px;">content_copy</span> Kopieren
                </button>
            </div>
        </div>
        <pre style="margin: 0; padding: 16px; overflow-x: auto;"><code class="hljs ${validLanguage}" style="font-size: var(--chat-font-size, 14px); background: transparent; padding: 0;">${highlightedCode}</code></pre>
    </div>`;
};

marked.setOptions({ renderer: customRenderer, breaks: true, gfm: true });

export const UI = {
    chatContainer: document.getElementById('chat-container'),
    welcomeScreen: document.getElementById('welcome-screen'),
    loadingSpinnerBox: null,

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
                    setTimeout(() => {
                        copyBtn.innerHTML = originalHTML;
                        copyBtn.style.color = "#aaa";
                    }, 2000);
                } catch (err) {
                    console.error('Fehler beim Kopieren:', err);
                }
            }
        });
        UI.createLoadingAnimation();
    },

    appendMessage: (text, isUser) => {
        const chatContainer = document.getElementById('chat-container');
        if (!chatContainer) return;
        
        const welcomeScreen = document.getElementById('welcome-screen');
        if (welcomeScreen) welcomeScreen.style.display = 'none';

        const msgDiv = document.createElement('div');
        msgDiv.className = `message-row ${isUser ? 'user-message' : 'ai-message'}`;
        
        // 🌟 NEUES CLEAN DESIGN: Flexbox Layout 🌟
        msgDiv.style.display = 'flex';
        msgDiv.style.gap = '16px';
        msgDiv.style.marginBottom = '32px';
        msgDiv.style.alignItems = 'flex-start';
        
        // Nutzer wandert nach rechts
        if (isUser) {
            msgDiv.style.flexDirection = 'row-reverse';
        }

        // --- AVATAR BEREICH ---
        const avatar = document.createElement('div');
        avatar.className = 'avatar';
        avatar.style.flexShrink = '0';
        avatar.style.width = '36px';
        avatar.style.height = '36px';
        avatar.style.borderRadius = '50%';
        avatar.style.overflow = 'hidden';
        avatar.style.display = 'flex';
        avatar.style.alignItems = 'center';
        avatar.style.justifyContent = 'center';

        if (!isUser) {
            // KI Avatar: Neben dem Text, KEIN Hintergrund-Kasten
            avatar.style.background = 'transparent';
            avatar.innerHTML = `<img src="${AI_PROFILE_PIC_SRC}" style="width:100%; height:100%; object-fit:contain;" onerror="this.style.display='none'">`;
        } else {
            // Nutzer Avatar: Google Account Bild abrufen
            const userPhoto = localStorage.getItem('coden_user_photo');
            if (userPhoto) {
                avatar.innerHTML = `<img src="${userPhoto}" style="width:100%; height:100%; object-fit:cover;">`;
            } else {
                // Fallback, falls kein Google-Bild da ist
                avatar.style.background = 'var(--accent-blue, #2b6cb0)';
                avatar.innerHTML = '<span class="material-symbols-outlined" style="color:white; font-size: 20px;">person</span>';
            }
        }

        // --- CONTENT BEREICH ---
        const content = document.createElement('div');
        content.className = 'content';
        content.style.maxWidth = '75%';
        content.style.lineHeight = '1.6';
        
        if (isUser) {
            // Nutzer: Schicke Chatblase
            content.style.background = 'var(--accent-blue, #2b6cb0)'; 
            content.style.color = '#ffffff';
            content.style.padding = '12px 18px';
            content.style.borderRadius = '18px 18px 4px 18px';
            content.style.fontSize = '15px';
            content.innerHTML = marked.parse(text); // Auch Nutzer dürfen Markdown!
        } else {
            // KI: KEINE Chatblase, cleaner Text direkt auf dem Hintergrund
            content.style.background = 'transparent';
            content.style.color = 'var(--text-primary, #ececec)';
            content.style.padding = '4px 0';
            content.innerHTML = marked.parse(text);
        }

        // Highlight.js anwenden und Bilder anpassen (nur für KI nötig, da Nutzer meist keinen Code schicken)
        if (!isUser) {
            content.querySelectorAll('pre code').forEach((block) => {
                hljs.highlightElement(block);
            });
        }
        
        // Alle Bilder responsiv machen
        content.querySelectorAll('img').forEach((img) => {
            img.style.maxWidth = '100%';
            img.style.borderRadius = '8px';
            img.style.marginTop = '12px';
            img.style.border = '1px solid rgba(255,255,255,0.1)';
        });

        // Zusammenbauen
        msgDiv.appendChild(avatar);
        msgDiv.appendChild(content);
        
        // Zwingend VOR die Lade-Animation setzen
        if (UI.loadingSpinnerBox && chatContainer.contains(UI.loadingSpinnerBox)) {
            chatContainer.insertBefore(msgDiv, UI.loadingSpinnerBox);
        } else {
            chatContainer.appendChild(msgDiv);
        }
        
        chatContainer.scrollTop = chatContainer.scrollHeight;
    },

    createLoadingAnimation: () => {
        UI.loadingSpinnerBox = document.createElement('div');
        UI.loadingSpinnerBox.id = 'coden-loading-spinner';
        UI.loadingSpinnerBox.className = 'ai-response-area hidden';
        
        // Ladeanimation an das neue, cleane Design angepasst
        UI.loadingSpinnerBox.innerHTML = `
            <div style="display: flex; align-items: center; gap: 16px; margin-bottom: 32px;">
                <div class="spinner-avatar" style="flex-shrink: 0; width: 36px; height: 36px; border-radius: 50%; background: transparent; display: flex; justify-content: center; align-items: center; overflow: hidden;">
                    <img src="${AI_PROFILE_PIC_SRC}" style="width:100%; height:100%; object-fit:contain;" onerror="this.style.display='none'">
                </div>
                <div style="display: flex; align-items: center; gap: 12px;">
                    <div class="spinner"></div>
                    <span id="loading-model-name" style="font-size: 14px; font-weight: 500; color: var(--text-muted, #888);">Coden denkt nach...</span>
                </div>
            </div>
        `;
        UI.chatContainer.appendChild(UI.loadingSpinnerBox);
    },

    showLoading: (show, modelNameDisplay = "Coden denkt nach...") => {
        if (!UI.loadingSpinnerBox) return;
        if (show) {
            if (UI.welcomeScreen) UI.welcomeScreen.classList.add('hidden');
            const nameSpan = document.getElementById('loading-model-name');
            if (nameSpan) nameSpan.textContent = modelNameDisplay;
            UI.loadingSpinnerBox.classList.remove('hidden');
            UI.scrollToBottom();
        } else {
            UI.loadingSpinnerBox.classList.add('hidden');
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
            historySection = document.createElement('div');
            historySection.id = 'dynamic-history';
            historySection.className = 'nav-section';
            list.insertBefore(historySection, list.firstChild);
        }

        historySection.innerHTML = '<span class="nav-label">Letzte Chats</span>';
        
        sessions.forEach(session => {
            const item = document.createElement('div');
            const isActive = session.id === activeSessionId;
            item.className = `nav-item ${isActive ? 'active-sub' : ''}`;
            item.style.display = 'flex';
            item.style.justifyContent = 'space-between';
            item.style.alignItems = 'center';
            item.style.cursor = 'pointer';

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
                e.stopPropagation();
                document.dispatchEvent(new CustomEvent('loadChatSession', { detail: session.id }));
            });

            item.querySelector('.delete-chat-btn').addEventListener('click', (e) => {
                e.stopPropagation();
                document.dispatchEvent(new CustomEvent('deleteChatSession', { detail: session.id }));
            });
            
            historySection.appendChild(item);
        });
    },

    resetUI: () => {
        const messages = UI.chatContainer.querySelectorAll('.message-row');
        messages.forEach(msg => msg.remove());
        if (UI.welcomeScreen) UI.welcomeScreen.classList.remove('hidden');
        if (UI.loadingSpinnerBox) UI.loadingSpinnerBox.classList.add('hidden');
    }
};

UI.init();
