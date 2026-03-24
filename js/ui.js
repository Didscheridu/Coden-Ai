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

    static appendMessage(text, isUser) {
        const chatContainer = document.getElementById('chat-container');
        if (!chatContainer) return;
        
        const welcomeScreen = document.getElementById('welcome-screen');
        if (welcomeScreen) welcomeScreen.style.display = 'none';

        const msgDiv = document.createElement('div');
        msgDiv.className = `message ${isUser ? 'user-message' : 'ai-message'}`;

        const avatar = document.createElement('div');
        avatar.className = 'avatar';
        if (!isUser) {
            avatar.classList.add('ai-avatar');
            avatar.innerHTML = '<img src="./images/coden_logo.jpg" style="width:100%; height:100%; border-radius:50%; object-fit:cover;" onerror="this.style.display=\'none\'">';
        } else {
            avatar.innerHTML = '<span class="material-symbols-outlined">person</span>';
        }

        const content = document.createElement('div');
        content.className = 'content';
        
        // 🌟 DER FIX: Markdown (inkl. Bilder) zu echtem HTML umwandeln! 🌟
        if (!isUser) {
            // Wir nutzen die marked.js Bibliothek, um den KI-Text zu rendern
            content.innerHTML = marked.parse(text);
        } else {
            // Wenn der Nutzer Code oder Anhänge mitschickt, rendern wir das auch als HTML
            content.innerHTML = text; 
        }

        // Code-Blöcke nach dem Rendern hübsch machen (Syntax Highlighting & Copy Button)
        if (!isUser) {
            content.querySelectorAll('pre code').forEach((block) => {
                hljs.highlightElement(block);
                const pre = block.parentElement;
                pre.style.position = 'relative';
                
                const copyBtn = document.createElement('button');
                copyBtn.className = 'icon-btn';
                copyBtn.innerHTML = '<span class="material-symbols-outlined" style="font-size:16px;">content_copy</span>';
                copyBtn.style.position = 'absolute';
                copyBtn.style.top = '8px';
                copyBtn.style.right = '8px';
                copyBtn.style.background = 'rgba(255,255,255,0.1)';
                copyBtn.style.border = 'none';
                copyBtn.style.color = '#fff';
                copyBtn.style.padding = '4px';
                copyBtn.style.borderRadius = '4px';
                copyBtn.style.cursor = 'pointer';
                
                copyBtn.onclick = () => {
                    navigator.clipboard.writeText(block.innerText);
                    copyBtn.innerHTML = '<span class="material-symbols-outlined" style="font-size:16px; color:#4caf50;">check</span>';
                    setTimeout(() => copyBtn.innerHTML = '<span class="material-symbols-outlined" style="font-size:16px;">content_copy</span>', 2000);
                };
                
                pre.appendChild(copyBtn);
            });
            
            // Bilder im Chat responsiv machen (damit sie nicht den Bildschirm sprengen)
            content.querySelectorAll('img').forEach((img) => {
                img.style.maxWidth = '100%';
                img.style.borderRadius = '8px';
                img.style.marginTop = '8px';
            });
        }

        msgDiv.appendChild(avatar);
        msgDiv.appendChild(content);
        chatContainer.appendChild(msgDiv);
        
        chatContainer.scrollTop = chatContainer.scrollHeight;
    }
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
