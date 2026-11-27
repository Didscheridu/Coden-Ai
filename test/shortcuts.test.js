// Tests für den globalen Tastenkürzel-Manager (js/shortcuts.js) sowie Tooltips & Verdrahtung
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

let fails = 0;
const chk = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log((ok ? 'OK   ' : 'FAIL ') + name + (ok ? '' : ` (bekam ${JSON.stringify(got)}, erwartet ${JSON.stringify(want)})`));
};

function makeFakeEl(initialTitle = '', hasKbd = false) {
  const attrs = new Map();
  if (initialTitle) attrs.set('title', initialTitle);
  const kbdEl = hasKbd ? { dataset: {}, textContent: '' } : null;
  return {
    dataset: {},
    getAttribute: (k) => attrs.get(k) ?? null,
    setAttribute: (k, v) => attrs.set(k, String(v)),
    querySelector: (sel) => (sel === '.cm-kbd' ? kbdEl : null),
    _kbd: kbdEl
  };
}

function makeFakeEvent(opts = {}) {
  let prevented = !!opts.defaultPrevented;
  return {
    key: opts.key ?? '',
    code: opts.code ?? '',
    ctrlKey: !!opts.ctrlKey,
    metaKey: !!opts.metaKey,
    shiftKey: !!opts.shiftKey,
    altKey: !!opts.altKey,
    isComposing: !!opts.isComposing,
    target: opts.target || { tagName: 'BODY', isContentEditable: false },
    get defaultPrevented() { return prevented; },
    preventDefault() { prevented = true; }
  };
}

(async () => {
  const S = await import(pathToFileURL(path.join(__dirname, '../js/shortcuts.js')).href);

  // 1. Formatierung für Windows/Linux & Mac
  chk('Format Win/Linux', [
    S.formatCombo('Ctrl+N', { mac: false }),
    S.formatCombo('Ctrl+Comma', { mac: false }),
    S.formatCombo('Ctrl+Slash', { mac: false }),
    S.formatCombo('Ctrl+Shift+O', { mac: false })
  ], ['Strg+N', 'Strg+,', 'Strg+/', 'Strg+Umschalt+O']);

  chk('Format Mac', [
    S.formatCombo('Ctrl+N', { mac: true }),
    S.formatCombo('Ctrl+Comma', { mac: true }),
    S.formatCombo('Ctrl+Slash', { mac: true }),
    S.formatCombo('Ctrl+Shift+O', { mac: true })
  ], ['⌘N', '⌘,', '⌘/', '⌘⇧O']);

  // 2. Manager-Dispatching, Aliase, QWERTZ-Slash & Guards
  const calls = [];
  let blocked = false;
  let chatActive = true;
  const mgr = S.createShortcutManager({ mac: false, isBlocked: () => blocked });

  mgr.registerAll([
    {
      id: 'new-chat',
      label: 'Neuer Chat',
      combo: 'Ctrl+N',
      aliases: ['Ctrl+Shift+O'],
      targets: [{ selector: '#sb-new', baseTitle: 'Neuer Chat' }],
      handler: () => calls.push('new-chat')
    },
    {
      id: 'open-settings',
      label: 'Einstellungen',
      combo: 'Ctrl+Comma',
      targets: [{ selector: '#open-settings-btn', baseTitle: 'Einstellungen', kbdSelector: '.cm-kbd' }],
      handler: () => calls.push('open-settings')
    },
    {
      id: 'focus-input',
      label: 'Eingabefeld fokussieren',
      combo: 'Ctrl+Slash',
      when: () => chatActive,
      targets: [{ selector: '#main-input', baseTitle: 'Eingabefeld fokussieren' }],
      handler: () => calls.push('focus-input')
    },
    {
      id: 'plain-key',
      label: 'Nur außerhalb von Eingaben',
      combo: 'P',
      allowInInputs: false,
      handler: () => calls.push('plain-key')
    }
  ]);

  const evN = makeFakeEvent({ key: 'n', code: 'KeyN', ctrlKey: true });
  chk('Ctrl+N löst new-chat aus und verhindert Browser-Standard', [mgr.handleKeydown(evN), evN.defaultPrevented], ['new-chat', true]);

  const evShiftN = makeFakeEvent({ key: 'N', code: 'KeyN', ctrlKey: true, shiftKey: true });
  chk('Ctrl+Shift+N löst new-chat nicht fälschlich aus', mgr.handleKeydown(evShiftN), false);

  const evAlias = makeFakeEvent({ key: 'O', code: 'KeyO', metaKey: true, shiftKey: true });
  chk('Alias Cmd+Shift+O löst new-chat aus', mgr.handleKeydown(evAlias), 'new-chat');

  const evComma = makeFakeEvent({ key: ',', code: 'Comma', ctrlKey: true });
  chk('Ctrl+Comma löst open-settings aus', [mgr.handleKeydown(evComma), evComma.defaultPrevented], ['open-settings', true]);

  const evSlashUS = makeFakeEvent({ key: '/', code: 'Slash', ctrlKey: true });
  const evSlashDE = makeFakeEvent({ key: '7', code: 'Digit7', ctrlKey: true, shiftKey: true });
  chk('Ctrl+Slash funktioniert auf US- und QWERTZ-Tastatur', [mgr.handleKeydown(evSlashUS), mgr.handleKeydown(evSlashDE)], ['focus-input', 'focus-input']);

  // Guard checks: IME composing, defaultPrevented, editable target, when, isBlocked
  chk('isComposing wird ignoriert', mgr.handleKeydown(makeFakeEvent({ key: 'n', ctrlKey: true, isComposing: true })), false);
  chk('defaultPrevented wird ignoriert', mgr.handleKeydown(makeFakeEvent({ key: 'n', ctrlKey: true, defaultPrevented: true })), false);

  const inputTarget = { tagName: 'TEXTAREA', isContentEditable: false };
  chk('Einfache Taste ohne Modifikator feuert nicht im Eingabefeld', mgr.handleKeydown(makeFakeEvent({ key: 'p', target: inputTarget })), false);
  chk('Ctrl+N feuert auch bei Fokus im Eingabefeld', mgr.handleKeydown(makeFakeEvent({ key: 'n', ctrlKey: true, target: inputTarget })), 'new-chat');

  chatActive = false;
  chk('when-Guard deaktiviert Shortcut bei false', mgr.handleKeydown(makeFakeEvent({ key: '/', code: 'Slash', ctrlKey: true })), false);
  chatActive = true;

  blocked = true;
  chk('isBlocked verhindert alle globalen Shortcuts', mgr.handleKeydown(makeFakeEvent({ key: ',', code: 'Comma', ctrlKey: true })), false);
  blocked = false;

  // 3. Idempotente Tooltip-Aktualisierung
  const sbNew = makeFakeEl('Neuer Chat');
  const settingsBtn = makeFakeEl('', true);
  const mainInput = makeFakeEl('');
  const fakeRoot = {
    querySelectorAll: (sel) => ({
      '#sb-new': [sbNew],
      '#open-settings-btn': [settingsBtn],
      '#main-input': [mainInput]
    }[sel] || [])
  };

  mgr.syncTooltips(fakeRoot);
  mgr.syncTooltips(fakeRoot); // Zweiter Aufruf muss idempotent sein!
  chk('Tooltips & aria-keyshortcuts idempotent gesetzt', [
    sbNew.getAttribute('title'),
    sbNew.getAttribute('aria-keyshortcuts'),
    settingsBtn.getAttribute('title'),
    settingsBtn._kbd.textContent,
    mainInput.getAttribute('title'),
    mainInput.getAttribute('aria-keyshortcuts')
  ], [
    'Neuer Chat (Strg+N)',
    'Control+n',
    'Einstellungen (Strg+,)',
    'Strg+,',
    'Eingabefeld fokussieren (Strg+/)',
    'Control+Slash'
  ]);

  // 4. Statische Integration in index.html, js/app.js und js/account-menu.js
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  const appJs = fs.readFileSync(path.join(__dirname, '../js/app.js'), 'utf8');
  const accJs = fs.readFileSync(path.join(__dirname, '../js/account-menu.js'), 'utf8');

  chk('index.html zeigt neue Hotkey-Tooltips', [
    html.includes('id="sb-new" title="Neuer Chat (Strg+N)"'),
    html.includes('id="open-settings-btn" role="menuitem" title="Einstellungen (Strg+,)"'),
    html.includes('id="main-input" rows="1" placeholder="Nachricht an Coden … (\'/\' für Befehle)" title="Eingabefeld fokussieren (Strg+/)"'),
    html.includes('id="toggle-search-btn" title="Chats durchsuchen (Strg+K)"')
  ], [true, true, true, true]);

  chk('app.js & account-menu.js nutzen gemeinsamen Shortcut-Manager ohne doppelten keydown', [
    appJs.includes("combo: 'Ctrl+N'"),
    appJs.includes("combo: 'Ctrl+Comma'"),
    appJs.includes("combo: 'Ctrl+Slash'"),
    appJs.includes('shortcuts.attach(document)'),
    accJs.includes('shortcuts.list()'),
    accJs.includes("document.addEventListener('keydown'")
  ], [true, true, true, true, true, false]);

  console.log(`\n${fails ? fails + ' Fehler' : 'Alle Shortcut-Tests grün'}`);
  process.exit(fails ? 1 : 0);
})();
