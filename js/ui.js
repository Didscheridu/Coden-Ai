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
    <div class="code-block-wrapper">
        <div class="code-header">
            <span class="lang">${langLabel}</span>
            <div class="code-actions">
                <button class="text-btn copy-code-btn" data-code="${encodedCode}">
                    <span class="material-symbols-outlined">content_copy</span> Kopieren
                </button>
            </div>
        </div>
        <pre><code class="hljs ${validLanguage}" style="font-size: var(--chat-font-size, 14px);">${highlightedCode}</code></pre>
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
                    copyBtn.innerHTML = `<span class="material-symbols-outlined">check</span> Kopiert!`;
                    copyBtn.style.color = "var(--accent-green)";
                    setTimeout(() => {
                        copyBtn.innerHTML = originalHTML;
                        copyBtn.style.color = "var(--text-secondary)";
                    }, 2000);
                } catch (err) {
                    console.error('Fehler beim Kopieren:', err);
                }
            }
        });
        UI.createLoadingAnimation();
    },

    appendMessage: (text, isUser) => {
        if (UI.welcomeScreen) UI.welcomeScreen.classList.add('hidden');

        const row = document.createElement('div');
        row.className = `message-row ${isUser ? 'user' : 'ai'}`;
        row.style.display = 'flex';
        row.style.maxWidth = '85%';
        row.style.marginBottom = '24px';
        
        row.style.minWidth = '0'; 
        
        if (isUser) {
            row.style.alignSelf = 'flex-end';
            row.style.justifyContent = 'flex-end';
        } else {
            row.style.alignSelf = 'flex-start';
            const pic = document.createElement('img');
            pic.src = AI_PROFILE_PIC_SRC;
            pic.className = 'ai-profile-pic';
            pic.onerror = function() { this.style.display = 'none'; };
            row.appendChild(pic);
        }

        const bubble = document.createElement('div');
        bubble.className = 'bubble';
        bubble.style.lineHeight = '1.6';
        bubble.style.fontSize = 'var(--chat-font-size, 15px)';
        
        bubble.style.minWidth = '0';
        bubble.style.maxWidth = '100%';
        bubble.style.wordBreak = 'break-word';
        
        if (isUser) {
            bubble.style.backgroundColor = 'var(--bg-surface)';
            bubble.style.color = 'var(--text-primary)';
            bubble.style.padding = '14px 18px';
            bubble.style.borderRadius = '20px';
            bubble.style.borderBottomRightRadius = '4px';
            bubble.textContent = text;
        } else {
            bubble.style.backgroundColor = 'transparent';
            bubble.style.color = 'var(--text-primary)';
            bubble.style.padding = '0'; 
            bubble.innerHTML = marked.parse(String(text || ''));
        }

        row.appendChild(bubble);
        
        if (UI.loadingSpinnerBox) {
            UI.chatContainer.insertBefore(row, UI.loadingSpinnerBox);
        } else {
            UI.chatContainer.appendChild(row);
        }
        UI.scrollToBottom();
    },

    createLoadingAnimation: () => {
        UI.loadingSpinnerBox = document.createElement('div');
        UI.loadingSpinnerBox.id = 'coden-loading-spinner';
        UI.loadingSpinnerBox.className = 'ai-response-area hidden';
        
        // KOMPLETT BEFREIT VON ALLEN "BOX" KLASSEN!
        // Hier sind keine Rahmen oder Hintergründe mehr, nur pures HTML für das Icon.
        UI.loadingSpinnerBox.innerHTML = `
            <div style="display: flex; align-items: center; gap: 16px; margin-bottom: 24px; padding-left: 8px;">
                <div class="spinner-container">
                    <div class="spinner"></div>
                    <img src="${AI_PROFILE_PIC_SRC}" class="spinner-logo" onerror="this.style.display='none'">
                </div>
                <span id="loading-model-name" style="font-size: 15px; font-weight: 500; color: var(--text-secondary);">coden flash denkt...</span>
            </div>
        `;
        UI.chatContainer.appendChild(UI.loadingSpinnerBox);
    },

    showLoading: (show, modelNameDisplay = "coden flash denkt...") => {
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
    }
};

UI.init();