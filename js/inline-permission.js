// js/inline-permission.js – Claude-ähnliche Inline-Berechtigungskarte direkt im Chat-Verlauf.
// Ersetzt blockierende Bestätigungs-Modals für MCP-Werkzeuge, interaktive Browser-Aktionen und App-Schreibzugriffe.

const mk = (tag, cls, text) => {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text !== undefined && text !== null) el.textContent = text;
    return el;
};

const icon = (name) => mk('span', 'material-symbols-outlined ip-ic', name);

function formatArgVal(v) {
    if (v === null || v === undefined) return 'null';
    if (typeof v === 'string') return v.length > 320 ? v.slice(0, 320) + ' …' : v;
    try {
        const s = JSON.stringify(v, null, 2);
        return s.length > 360 ? s.slice(0, 360) + ' …' : s;
    } catch (_) {
        return String(v);
    }
}

/**
 * Zeigt eine Claude-ähnliche Freigabe-Karte direkt in der laufenden KI-Nachricht (.inline-perm-slot) an.
 * Rückgabe: Promise resolving to 'once' | 'always-tool' | 'always-server' | 'always-domain' | false
 */
export function requestInlinePermission(opts = {}) {
    return new Promise((resolve) => {
        const chatContainer = document.getElementById('chat-container');
        const host = (opts.hostEl && opts.hostEl.isConnected)
            ? opts.hostEl
            : chatContainer?.querySelector('.message-row.streaming .inline-perm-slot')
                || chatContainer?.querySelector('.message-row:last-child .inline-perm-slot')
                || chatContainer;

        if (!host) return resolve(false);

        const card = mk('div', 'inline-perm-card');
        card.setAttribute('role', 'region');
        card.setAttribute('aria-label', opts.title || 'Berechtigung anfragen');

        // Kopfzeile: Icon/Logo, Titel & Ablehnen-X
        const head = mk('div', 'ip-head');
        const badgeIcon = mk('div', 'ip-badge-icon');
        if (opts.kind === 'mcp' && (opts.serverUrl || opts.catalogId)) {
            const cat = window.CodenMcpCatalog?.byId?.(opts.catalogId);
            const domain = (cat && window.CodenMcpCatalog?.domainOf?.(cat)) || (() => {
                try { return new URL(opts.serverUrl).hostname; } catch (_) { return ''; }
            })();
            if (domain) {
                const fav = document.createElement('img');
                fav.src = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=32`;
                fav.alt = '';
                fav.referrerPolicy = 'no-referrer';
                fav.onerror = () => fav.replaceWith(icon(cat?.icon || opts.icon || 'hub'));
                badgeIcon.append(fav);
            } else {
                badgeIcon.append(icon(cat?.icon || opts.icon || 'hub'));
            }
        } else {
            badgeIcon.append(icon(opts.icon || (opts.kind === 'browser' ? 'public' : opts.kind === 'app' ? 'edit_document' : 'shield')));
        }

        const titles = mk('div', 'ip-titles');
        titles.append(mk('div', 'ip-title', opts.title || 'Aktion erlauben?'));
        if (opts.subtitle) titles.append(mk('div', 'ip-sub', opts.subtitle));

        const closeBtn = mk('button', 'ip-close');
        closeBtn.type = 'button';
        closeBtn.title = 'Ablehnen';
        closeBtn.setAttribute('aria-label', 'Ablehnen');
        closeBtn.append(icon('close'));

        head.append(badgeIcon, titles, closeBtn);
        card.append(head);

        // Hauptbereich: Tool-Name, Beschreibung, Parameter-Details / Dateien
        const body = mk('div', 'ip-body');

        if (opts.toolName || opts.serverName || opts.domain) {
            const toolBar = mk('div', 'ip-tool-bar');
            if (opts.toolName) toolBar.append(mk('code', 'ip-tool-pill', opts.toolName));
            if (opts.serverName || opts.domain) {
                toolBar.append(mk('span', 'ip-tool-src', opts.serverName || opts.domain));
            }
            body.append(toolBar);
        }

        if (opts.toolDesc) {
            body.append(mk('p', 'ip-desc', String(opts.toolDesc).replace(/\s+/g, ' ').trim().slice(0, 220)));
        }

        if (opts.message) {
            body.append(mk('p', 'ip-desc', opts.message));
        }

        const entries = opts.args && typeof opts.args === 'object' && !Array.isArray(opts.args)
            ? Object.entries(opts.args)
            : [];

        if (entries.length) {
            const det = mk('details', 'ip-params');
            det.open = entries.length <= 4;
            det.append(mk('summary', '', `Parameter anzeigen (${entries.length})`));
            const kvList = mk('div', 'ip-kv-list');
            for (const [k, v] of entries.slice(0, 14)) {
                const row = mk('div', 'ip-kv');
                row.append(mk('span', 'ip-kv-k', String(k)), mk('span', 'ip-kv-v', formatArgVal(v)));
                kvList.append(row);
            }
            det.append(kvList);
            body.append(det);
        }

        if (Array.isArray(opts.files) && opts.files.length) {
            const fileList = mk('div', 'ip-files');
            for (const f of opts.files.slice(0, 12)) {
                const row = mk('div', 'ip-file-row');
                row.append(
                    icon(f.action === 'neu' ? 'note_add' : 'edit_document'),
                    mk('code', '', String(f.path || '')),
                    mk('span', 'ip-file-meta', `${f.action || 'ändern'}${f.size ? ` · ${f.size} Z.` : ''}`)
                );
                fileList.append(row);
            }
            body.append(fileList);
        }

        if (body.childNodes.length) card.append(body);

        // Fußzeile: Ablehnen · Immer erlauben (Split) · Einmal erlauben
        const foot = mk('div', 'ip-foot');
        const denyBtn = mk('button', 'ip-btn ip-btn-ghost', opts.cancelLabel || 'Ablehnen');
        denyBtn.type = 'button';

        const allowBtn = mk('button', 'ip-btn ip-btn-primary', opts.confirmLabel || 'Einmal erlauben');
        allowBtn.type = 'button';

        let alwaysMenu = null;
        let alwaysWrap = null;
        const allowAlways = opts.allowAlways !== false;

        if (allowAlways) {
            alwaysWrap = mk('div', 'ip-always-wrap');
            const scopeItems = [];
            if (opts.kind === 'mcp') {
                if (opts.toolName) {
                    scopeItems.push({
                        value: 'always-tool',
                        icon: 'build',
                        label: `Dieses Werkzeug (${opts.toolName})`
                    });
                }
                scopeItems.push({
                    value: 'always-server',
                    icon: 'hub',
                    label: `Server „${opts.serverName || 'Konnektor'}“ komplett`
                });
            } else if (opts.kind === 'browser') {
                scopeItems.push({
                    value: 'always-domain',
                    icon: 'public',
                    label: `Domain „${opts.domain || 'Webseite'}“ immer erlauben`
                });
            }

            if (scopeItems.length === 1) {
                const singleBtn = mk('button', 'ip-btn ip-btn-outline', 'Immer erlauben');
                singleBtn.type = 'button';
                singleBtn.addEventListener('click', () => finish(scopeItems[0].value));
                alwaysWrap.append(singleBtn);
            } else if (scopeItems.length > 1) {
                const splitBtn = mk('button', 'ip-btn ip-btn-outline ip-split-btn');
                splitBtn.type = 'button';
                splitBtn.setAttribute('aria-haspopup', 'menu');
                splitBtn.setAttribute('aria-expanded', 'false');
                splitBtn.append(mk('span', '', 'Immer erlauben'), icon('expand_more'));

                alwaysMenu = mk('div', 'ip-always-menu hidden');
                alwaysMenu.setAttribute('role', 'menu');
                for (const item of scopeItems) {
                    const mi = mk('button', 'ip-always-item');
                    mi.type = 'button';
                    mi.setAttribute('role', 'menuitem');
                    mi.append(icon(item.icon), mk('span', '', item.label));
                    mi.addEventListener('click', (e) => {
                        e.stopPropagation();
                        finish(item.value);
                    });
                    alwaysMenu.append(mi);
                }

                splitBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const open = alwaysMenu.classList.toggle('hidden') === false;
                    splitBtn.setAttribute('aria-expanded', String(open));
                });
                alwaysWrap.append(splitBtn, alwaysMenu);
            }
        }

        const rightBtns = mk('div', 'ip-foot-right');
        if (alwaysWrap) rightBtns.append(alwaysWrap);
        rightBtns.append(allowBtn);
        foot.append(denyBtn, rightBtns);
        card.append(foot);

        host.append(card);
        if (chatContainer && host.closest('#chat-container')) {
            chatContainer.scrollTop = chatContainer.scrollHeight;
        }

        let done = false;
        const onDocClick = (e) => {
            if (alwaysMenu && !alwaysWrap?.contains(e.target)) {
                alwaysMenu.classList.add('hidden');
            }
        };
        const onKey = (e) => {
            if (e.key === 'Escape' && !done) {
                e.stopPropagation();
                finish(false);
            }
        };
        document.addEventListener('click', onDocClick);
        document.addEventListener('keydown', onKey);

        function finish(result) {
            if (done) return;
            done = true;
            document.removeEventListener('click', onDocClick);
            document.removeEventListener('keydown', onKey);

            // Karte auf kompakten Erledigt-Status zusammenklappen (Claude-Stil)
            card.classList.add('settled', result ? 'allowed' : 'denied');
            const summaryIcon = result ? 'check_circle' : 'cancel';
            const labelMap = {
                'once': 'Einmal erlaubt',
                'always-tool': `Immer erlaubt (${opts.toolName || 'Werkzeug'})`,
                'always-server': `Immer erlaubt (${opts.serverName || 'Server'})`,
                'always-domain': `Immer erlaubt (${opts.domain || 'Domain'})`
            };
            const summaryLabel = result === false
                ? 'Abgelehnt'
                : (labelMap[result] || 'Erlaubt');
            const targetName = opts.toolName || opts.domain || opts.title || '';

            const settledRow = mk('div', 'ip-settled');
            settledRow.append(icon(summaryIcon), mk('strong', '', summaryLabel));
            if (targetName) settledRow.append(mk('span', 'ip-settled-target', `· ${targetName}`));
            // Dauerhafte Freigaben: kurzer Link zur Verwaltung (Konnektoren bzw. Browser-Domains)
            if (typeof result === 'string' && result.startsWith('always-')) {
                const edit = mk('button', 'ip-settled-edit', 'Ändern');
                edit.type = 'button';
                edit.addEventListener('click', () => document.dispatchEvent(new CustomEvent('coden:managePermissions', {
                    detail: { kind: opts.kind, scope: result, serverName: opts.serverName || '', toolName: opts.toolName || '', domain: opts.domain || '' }
                })));
                settledRow.append(edit);
            }
            card.replaceChildren(settledRow);
            resolve(result);
        }

        denyBtn.addEventListener('click', () => finish(false));
        closeBtn.addEventListener('click', () => finish(false));
        allowBtn.addEventListener('click', () => finish('once'));
        setTimeout(() => allowBtn.focus(), 10);
    });
}
