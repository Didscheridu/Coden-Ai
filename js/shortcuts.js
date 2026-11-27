// js/shortcuts.js – Globaler Tastenkürzel-Manager für Coden AI (Mapping, Plattform-Formatierung & UI-Tooltips)

const KEY_ALIASES = {
    comma: ',',
    period: '.',
    dot: '.',
    slash: '/',
    forwardslash: '/',
    esc: 'escape',
    escape: 'escape',
    space: ' ',
    spacebar: ' ',
    enter: 'enter',
    return: 'enter',
    tab: 'tab',
    up: 'arrowup',
    down: 'arrowdown',
    left: 'arrowleft',
    right: 'arrowright',
    plus: '+',
    minus: '-'
};

const CODE_FOR_KEY = {
    ',': ['Comma'],
    '.': ['Period'],
    '/': ['Slash', 'NumpadDivide'],
    'escape': ['Escape'],
    ' ': ['Space'],
    'enter': ['Enter', 'NumpadEnter'],
    'tab': ['Tab']
};

const DISPLAY_LABEL_KEY = {
    ',': ',',
    '.': '.',
    '/': '/',
    'escape': 'Esc',
    ' ': 'Leertaste',
    'enter': 'Enter',
    'tab': 'Tab',
    'arrowup': '↑',
    'arrowdown': '↓',
    'arrowleft': '←',
    'arrowright': '→'
};

export function isMacPlatform(nav = typeof navigator !== 'undefined' ? navigator : null) {
    if (!nav) return false;
    return /Mac|iPhone|iPad|iPod/i.test(nav.platform || nav.userAgent || '');
}

export function parseCombo(comboStr) {
    const parts = String(comboStr || '').split('+').map(p => p.trim()).filter(Boolean);
    if (!parts.length) throw new Error(`Ungültiges Tastenkürzel: "${comboStr}"`);

    const parsed = {
        raw: String(comboStr),
        mod: false,
        ctrlOnly: false,
        metaOnly: false,
        shift: false,
        alt: false,
        key: '',
        codes: []
    };

    for (let i = 0; i < parts.length - 1; i++) {
        const m = parts[i].toLowerCase();
        if (m === 'ctrl' || m === 'control' || m === 'strg' || m === 'mod' || m === 'cmdorctrl') parsed.mod = true;
        else if (m === 'cmd' || m === 'meta' || m === 'command') parsed.metaOnly = true;
        else if (m === 'shift' || m === 'umschalt') parsed.shift = true;
        else if (m === 'alt' || m === 'option') parsed.alt = true;
        else throw new Error(`Unbekannter Modifikator "${parts[i]}" in "${comboStr}"`);
    }

    const rawKey = parts[parts.length - 1].toLowerCase();
    const key = KEY_ALIASES[rawKey] || rawKey;
    parsed.key = key;

    if (CODE_FOR_KEY[key]) {
        parsed.codes = [...CODE_FOR_KEY[key]];
    } else if (/^[a-z]$/.test(key)) {
        parsed.codes = [`Key${key.toUpperCase()}`];
    } else if (/^[0-9]$/.test(key)) {
        parsed.codes = [`Digit${key}`, `Numpad${key}`];
    }

    return parsed;
}

export function matchesCombo(event, parsed) {
    if (!event || !parsed) return false;
    if (event.isComposing) return false;

    const hasCtrl = !!event.ctrlKey;
    const hasMeta = !!event.metaKey;
    const hasShift = !!event.shiftKey;
    const hasAlt = !!event.altKey;

    if (parsed.mod) {
        if (!(hasCtrl || hasMeta)) return false;
    } else if (parsed.metaOnly) {
        if (!hasMeta) return false;
    } else {
        if (hasCtrl || hasMeta) return false;
    }

    if (hasAlt !== parsed.alt) return false;

    const evKey = String(event.key || '').toLowerCase();
    const evCode = String(event.code || '');

    // Sonderfall deutsche QWERTZ-Tastatur: "/" liegt auf Umschalt+7 (Ctrl+/ sendet oft key:"/" mit shiftKey:true oder key:"7" mit shiftKey:true)
    const isGermanSlash = parsed.key === '/' && !parsed.shift && !hasAlt && (
        evKey === '/' ||
        (evKey === '7' && hasShift) ||
        (evCode === 'Slash' && !hasShift) ||
        evCode === 'NumpadDivide'
    );
    if (isGermanSlash) return true;

    if (hasShift !== parsed.shift) return false;

    if (evKey === parsed.key) return true;
    if (evCode && parsed.codes.includes(evCode)) return true;
    return false;
}

export function formatCombo(comboStr, { mac = isMacPlatform() } = {}) {
    const p = typeof comboStr === 'string' ? parseCombo(comboStr) : comboStr;
    const keyLabel = DISPLAY_LABEL_KEY[p.key] || (p.key.length === 1 ? p.key.toUpperCase() : p.key.charAt(0).toUpperCase() + p.key.slice(1));

    if (mac) {
        const mods = [];
        if (p.mod || p.metaOnly) mods.push('⌘');
        if (p.alt) mods.push('⌥');
        if (p.shift) mods.push('⇧');
        return `${mods.join('')}${keyLabel}`;
    }

    const mods = [];
    if (p.mod || p.ctrlOnly) mods.push('Strg');
    if (p.metaOnly) mods.push('Meta');
    if (p.alt) mods.push('Alt');
    if (p.shift) mods.push('Umschalt');
    return mods.length ? `${mods.join('+')}+${keyLabel}` : keyLabel;
}

export function toAriaKeyShortcut(comboStr, { mac = isMacPlatform() } = {}) {
    const p = typeof comboStr === 'string' ? parseCombo(comboStr) : comboStr;
    const keyPart = p.key === ',' ? 'Comma' : p.key === '.' ? 'Period' : p.key === '/' ? 'Slash' : p.key === 'escape' ? 'Escape' : p.key;
    const mods = [];
    if (p.mod) mods.push(mac ? 'Meta' : 'Control');
    else if (p.metaOnly) mods.push('Meta');
    if (p.alt) mods.push('Alt');
    if (p.shift) mods.push('Shift');
    return mods.length ? `${mods.join('+')}+${keyPart}` : keyPart;
}

export function formatTooltip(baseTitle, comboStr, opts = {}) {
    const cleanBase = String(baseTitle || '').trim();
    const label = formatCombo(comboStr, opts);
    if (!cleanBase) return label;
    return `${cleanBase} (${label})`;
}

export function applyTooltip(el, comboStr, { baseTitle, mac = isMacPlatform(), kbdSelector } = {}) {
    if (!el) return;
    if (!el.dataset.tooltipBase) {
        const existing = String(el.getAttribute('title') || '').trim();
        el.dataset.tooltipBase = baseTitle || existing.replace(/\s*\((?:Strg|⌘|Ctrl|Meta|Alt|⌥|Umschalt|⇧|Esc)[^)]*\)\s*$/, '').trim();
    } else if (baseTitle) {
        el.dataset.tooltipBase = baseTitle;
    }

    const formatted = formatCombo(comboStr, { mac });
    const base = el.dataset.tooltipBase;
    if (base) {
        el.setAttribute('title', `${base} (${formatted})`);
    }
    el.setAttribute('aria-keyshortcuts', toAriaKeyShortcut(comboStr, { mac }));

    if (kbdSelector) {
        const kbdEl = el.querySelector(kbdSelector);
        if (kbdEl) {
            kbdEl.dataset.kbd = formatCombo(comboStr, { mac: false });
            kbdEl.textContent = formatted;
        }
    }
}

export function isEditableElement(target) {
    if (!target || typeof target !== 'object') return false;
    if (target.isContentEditable) return true;
    const tag = String(target.tagName || '').toUpperCase();
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

export function createShortcutManager({ mac = isMacPlatform(), isBlocked } = {}) {
    const entries = new Map();
    const listeners = new Map();

    function register(def) {
        if (!def || !def.id || !def.combo || typeof def.handler !== 'function') {
            throw new Error('Shortcut benötigt id, combo und handler');
        }
        const primary = parseCombo(def.combo);
        const aliases = (Array.isArray(def.aliases) ? def.aliases : []).map(parseCombo);
        const entry = {
            id: def.id,
            label: def.label || def.id,
            combo: def.combo,
            parsed: primary,
            aliases,
            handler: def.handler,
            when: typeof def.when === 'function' ? def.when : null,
            allowInInputs: def.allowInInputs !== undefined ? !!def.allowInInputs : primary.mod,
            enabled: def.enabled !== false,
            showInHelp: def.showInHelp !== false,
            preventDefault: def.preventDefault !== false,
            targets: Array.isArray(def.targets) ? def.targets : []
        };
        entries.set(entry.id, entry);
        return () => entries.delete(entry.id);
    }

    function registerAll(defs) {
        for (const def of defs) register(def);
        return api;
    }

    function unregister(id) {
        return entries.delete(id);
    }

    function setEnabled(id, enabled) {
        const entry = entries.get(id);
        if (entry) entry.enabled = !!enabled;
    }

    function get(id) {
        return entries.get(id) || null;
    }

    function list() {
        return [...entries.values()].map(e => ({
            id: e.id,
            label: e.label,
            combo: e.combo,
            displayKey: formatCombo(e.parsed, { mac }),
            winKey: formatCombo(e.parsed, { mac: false }),
            macKey: formatCombo(e.parsed, { mac: true }),
            enabled: e.enabled,
            showInHelp: e.showInHelp
        }));
    }

    function syncTooltips(root = typeof document !== 'undefined' ? document : null) {
        if (!root) return;
        for (const entry of entries.values()) {
            for (const target of entry.targets) {
                const nodes = root.querySelectorAll(target.selector);
                nodes.forEach((el) => {
                    applyTooltip(el, entry.combo, {
                        baseTitle: target.baseTitle,
                        mac,
                        kbdSelector: target.kbdSelector
                    });
                });
            }
        }
    }

    function trigger(id, event = null) {
        const entry = entries.get(id);
        if (!entry || !entry.enabled) return false;
        if (entry.when && !entry.when(event)) return false;
        entry.handler(event, entry);
        return true;
    }

    function handleKeydown(event) {
        if (!event || event.defaultPrevented || event.isComposing) return false;
        if (typeof isBlocked === 'function' && isBlocked(event)) return false;

        const inEditable = isEditableElement(event.target);

        for (const entry of entries.values()) {
            if (!entry.enabled) continue;
            if (inEditable && !entry.allowInInputs) continue;

            const matched = matchesCombo(event, entry.parsed) || entry.aliases.some(a => matchesCombo(event, a));
            if (!matched) continue;
            if (entry.when && !entry.when(event)) continue;

            if (entry.preventDefault && typeof event.preventDefault === 'function') {
                event.preventDefault();
            }
            entry.handler(event, entry);
            return entry.id;
        }
        return false;
    }

    function attach(target = typeof document !== 'undefined' ? document : null) {
        if (!target || typeof target.addEventListener !== 'function') return () => {};
        if (listeners.has(target)) return listeners.get(target).detach;

        const onKeydown = (e) => handleKeydown(e);
        target.addEventListener('keydown', onKeydown);
        const detach = () => {
            target.removeEventListener('keydown', onKeydown);
            listeners.delete(target);
        };
        listeners.set(target, { onKeydown, detach });
        return detach;
    }

    function detach(target) {
        if (target) {
            listeners.get(target)?.detach();
            return;
        }
        for (const entry of [...listeners.values()]) entry.detach();
    }

    const api = {
        register,
        registerAll,
        unregister,
        setEnabled,
        get,
        list,
        syncTooltips,
        trigger,
        handleKeydown,
        attach,
        detach,
        formatCombo: (c) => formatCombo(c, { mac }),
        formatTooltip: (title, c) => formatTooltip(title, c, { mac })
    };
    return api;
}

export const shortcuts = createShortcutManager({
    isBlocked: () => {
        if (typeof document === 'undefined') return false;
        if (document.getElementById('app')?.classList.contains('hidden')) return true;
        const confirm = document.getElementById('confirm-modal');
        if (confirm && !confirm.classList.contains('hidden')) return true;
        return false;
    }
});
