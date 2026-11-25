// js/byok.js – Bring your own Key: eigene API-Keys, Modelle, Ausweich-Ketten und App-Modus (Einstellungen → Modelle & Keys)
// + Einträge im Modell-Auswahlmenü. Die Keys gehen nur zum Server und werden dort verschlüsselt gespeichert; sie kommen nie wieder zurück.
import { apiJson } from './backend.js';
import { toast } from './toast.js';
import { h, icon } from './apps/dom.js';

const LEVEL_NAMES = { minimal: 'Minimal', low: 'Niedrig', medium: 'Mittel', high: 'Hoch', xhigh: 'Sehr hoch', max: 'Maximal' };
const DEFAULT_ON = ['low', 'medium', 'high'];
let state = { providers: [], models: [], chains: [], builtin: [], levels: [], agentConfig: null };
let hooks = { getTier: () => 'flash', select: () => {}, fallback: () => {} };
const loaded = new Map(); // Anbieter -> vom Anbieter geladene Modelle (nur im Speicher)
let sub = 'keys';         // aktueller Unterbereich in „Modelle & Keys“
let draftCfg = null;      // ungespeicherte App-Modus-Einstellung
const drafts = new Map(); // ungespeicherte Ketten (id oder 'new' -> { name, members })

export const isByokTier = (t) => /^byok:\d+$/.test(t || '');
export const isOwnTier = (t) => /^(byok|chain):\d+$/.test(t || '');
const modelOf = (tier) => state.models.find(m => m.tier === tier) || null;
const lvlKey = (m) => 'coden_byok_level_' + m.id;
const post = (path, body, method = 'POST') => apiJson(path, { method, ...(body ? { body: JSON.stringify(body) } : {}) });

// Alle auswählbaren eigenen Modelle und Ketten (für Menü und App-Builder)
export function ownTiers() {
  return [...state.models.filter(m => m.ready).map(m => ({ tier: m.tier, label: m.label, sub: m.providerName, kind: 'model' })),
    ...state.chains.filter(c => c.ready).map(c => ({ tier: c.tier, label: c.name, sub: 'Kette · ' + c.members.length + ' Modelle', kind: 'chain' }))];
}
export const byokReady = () => state.providers.length > 0; // Stand vom Server schon geladen?
export const ownLabel = (tier) => ownTiers().find(t => t.tier === tier)?.label || null;

// Gewählte Denkstufe für ein eigenes Modell (undefined bei Coden-Modellen und Ketten: dort gilt der normale Regler)
export function byokEffort(tier) {
  const m = modelOf(tier); if (!m || !m.levels.length) return undefined;
  let v = null; try { v = localStorage.getItem(lvlKey(m)); } catch (_) { /* privater Modus */ }
  return m.levels.includes(v) ? v : (m.levels.includes(m.defaultLevel) ? m.defaultLevel : m.levels[0]);
}

export function initByok(h2) { hooks = { ...hooks, ...h2 }; }
export async function loadByok() {
  try { state = await apiJson('/byok'); } catch (_) { /* offline: alten Stand behalten */ }
  renderMenu();
  const cur = hooks.getTier();
  if (isOwnTier(cur) && !ownTiers().some(t => t.tier === cur)) { hooks.fallback(); toast('Das eigene Modell ist nicht mehr verfügbar – zurück zu Coden Flash.', { type: 'warn' }); }
  syncEffortRow(hooks.getTier());
  return state;
}
export function clearByok() { state = { providers: [], models: [], chains: [], builtin: [], levels: [], agentConfig: null }; renderMenu(); }

// ---------- Auswahlmenü ----------
function renderMenu() {
  const box = document.getElementById('byok-models'); if (!box) return;
  const list = ownTiers(); const cur = hooks.getTier();
  box.replaceChildren(...(list.length ? [h('div', { class: 'byok-menu-head', text: 'Eigene Modelle' }), ...list.map(m =>
    h('div', { class: 'model-option byok-option' + (m.tier === cur ? ' active' : ''), 'data-model': m.tier, title: m.sub, onclick: () => hooks.select(m.tier, m.label) },
      icon(m.kind === 'chain' ? 'alt_route' : 'key'), h('span', { class: 'name', text: m.label }), h('span', { class: 'byok-prov', text: m.sub })))] : []));
}

// Denkstufen-Regler: bei eigenen Modellen mit deren Stufen, sonst der normale Regler von Coden
export function syncEffortRow(tier) {
  const builtin = document.querySelector('#model-dropdown-menu .effort-row:not(#byok-effort-row)');
  const row = document.getElementById('byok-effort-row'); if (!row) return;
  const m = isByokTier(tier) ? modelOf(tier) : null;
  builtin?.classList.toggle('hidden', !!m);
  row.classList.toggle('hidden', !m || !m.levels.length);
  if (!m || !m.levels.length) return;
  const cur = byokEffort(tier);
  row.querySelector('.effort-seg').replaceChildren(...m.levels.map(l => h('button', { type: 'button', class: l === cur ? 'active' : '', text: LEVEL_NAMES[l] || l, onclick: (e) => {
    e.stopPropagation(); try { localStorage.setItem(lvlKey(m), l); } catch (_) { /* privater Modus */ } syncEffortRow(tier);
  } })));
}

// ---------- Einstellungen ----------
const redraw = () => { const box = document.getElementById('byok-box'); if (box) renderByokSettings(box); };
async function act(fn, okMsg) {
  try { state = await fn(); renderMenu(); syncEffortRow(hooks.getTier()); if (okMsg) toast(okMsg, { type: 'ok' }); return true; }
  catch (e) { toast(e.message, { type: 'error' }); return false; }
  finally { redraw(); }
}
const levelBoxes = (all, on, onChange) => h('div', { class: 'byok-levels' }, all.map(l => {
  const cb = h('input', { type: 'checkbox', value: l }); cb.checked = on.includes(l);
  if (onChange) cb.addEventListener('change', () => onChange());
  return h('label', { class: 'byok-lvl' }, cb, ' ' + (LEVEL_NAMES[l] || l));
}));
const checked = (el) => [...el.querySelectorAll('input:checked')].map(i => i.value);
const sel = (options, value, onchange, cls = 'settings-input') => h('select', { class: cls, onchange: (e) => onchange(e.target.value) }, options.map(o => h('option', { value: o.value, text: o.text, selected: o.value === value || undefined })));
const field = (label, control, hint) => h('label', { class: 'byok-field' }, h('span', { class: 'byok-fl', text: label }), control, hint ? h('small', { text: hint }) : null);
const subHead = (title, text) => h('div', { class: 'byok-intro' }, h('b', { text: title }), text ? h('p', { text }) : null);

// 1) Anbieter & Keys
function paneKeys() {
  return h('div', { class: 'byok-grid' }, state.providers.map(p => {
    const keyIn = h('input', { type: 'password', class: 'settings-input', placeholder: p.hasKey ? 'Neuen Key einfügen (ersetzt den alten)' : `API-Key (${p.keyHint})`, autocomplete: 'off', spellcheck: 'false' });
    const n = state.models.filter(m => m.provider === p.id).length;
    return h('div', { class: 'byok-card' + (p.hasKey ? ' on' : '') },
      h('div', { class: 'byok-head' }, h('b', { text: p.name }), h('span', { class: 'byok-chip' + (p.hasKey ? ' ok' : ''), text: p.hasKey ? `Key ${p.hint}` : 'kein Key' }), p.store === 'neon' ? h('span', { class: 'byok-chip', title: 'Dieser Key wird verschlüsselt in der Neon-Datenbank gespeichert', text: 'Neon' }) : null, h('a', { href: p.link, target: '_blank', rel: 'noopener', class: 'byok-link', text: 'Key holen ↗' })),
      h('div', { class: 'byok-row' }, keyIn, h('button', { type: 'button', class: 'btn-save', text: 'Speichern', onclick: () => { const v = keyIn.value.trim(); if (!v) return toast('Füge zuerst deinen Key ein.', { type: 'warn' }); act(() => post(`/byok/keys/${p.id}`, { key: v }, 'PUT'), 'Key gespeichert.'); } })),
      p.hasKey ? h('div', { class: 'byok-row between' }, h('span', { class: 'byok-prov', text: n ? `${n} Modell${n > 1 ? 'e' : ''} eingerichtet` : 'Noch kein Modell – weiter bei „Modelle“' }),
        h('button', { type: 'button', class: 'btn-cancel', text: 'Key entfernen', onclick: () => { if (confirm(`Key von ${p.name} entfernen? Deine Modelle dieses Anbieters sind dann nicht mehr auswählbar.`)) act(() => post(`/byok/keys/${p.id}`, null, 'DELETE'), 'Key entfernt.'); } })) : null);
  }));
}

// 2) Modelle
const addState = { provider: null, q: '' };
function paneModels() {
  const ready = state.providers.filter(p => p.hasKey);
  const wrap = h('div', { class: 'byok-stack' });
  if (!ready.length) { wrap.append(h('div', { class: 'byok-empty' }, icon('key'), h('p', { text: 'Hinterlege zuerst bei „Anbieter & Keys“ einen API-Key.' }), h('button', { type: 'button', class: 'btn-save', text: 'Zu den Keys', onclick: () => { sub = 'keys'; redraw(); } }))); }
  else {
    if (!ready.some(p => p.id === addState.provider)) addState.provider = ready[0].id;
    const p = ready.find(x => x.id === addState.provider);
    const list = loaded.get(p.id) || [];
    const idIn = h('input', { type: 'text', class: 'settings-input', placeholder: p.suggest[0] ? `Modell-ID, z. B. ${p.suggest[0].id}` : 'Modell-ID', autocomplete: 'off', spellcheck: 'false' });
    const nameIn = h('input', { type: 'text', class: 'settings-input', placeholder: 'Anzeigename (optional)', maxlength: 60 });
    const lv = levelBoxes(p.levels, DEFAULT_ON.filter(l => p.levels.includes(l)));
    const results = h('div', { class: 'byok-pick' });
    const fill = () => {
      const q = addState.q.toLowerCase(); const all = [...p.suggest.filter(x => !list.some(l => l.id === x.id)), ...list];
      const hit = all.filter(m => !q || m.id.toLowerCase().includes(q) || String(m.label).toLowerCase().includes(q)).slice(0, 60);
      results.replaceChildren(...(hit.length ? hit.map(m => h('button', { type: 'button', class: 'byok-pick-i', title: m.id, onclick: () => { idIn.value = m.id; nameIn.value = m.label !== m.id ? m.label : ''; } }, h('b', { text: m.label }), m.label !== m.id ? h('small', { text: m.id }) : null)) : [h('small', { class: 'byok-prov', text: list.length ? 'Nichts gefunden.' : 'Tippe die Modell-ID selbst ein – oder lade die Liste deines Anbieters.' })]));
    };
    const filter = h('input', { type: 'search', class: 'settings-input', placeholder: list.length ? `${list.length} Modelle durchsuchen …` : 'Modelle durchsuchen …', value: addState.q, oninput: (e) => { addState.q = e.target.value; fill(); } });
    const loadBtn = h('button', { type: 'button', class: 'btn-cancel', text: list.length ? 'Neu laden' : `Liste von ${p.name} laden`, onclick: async () => {
      loadBtn.disabled = true; loadBtn.textContent = 'Lade …';
      try { loaded.set(p.id, (await apiJson(`/byok/providers/${p.id}/models`)).models); } catch (e) { toast(e.message, { type: 'error' }); }
      redraw();
    } });
    fill();
    wrap.append(h('div', { class: 'byok-card' },
      subHead('Modell hinzufügen', 'Wähle ein Modell aus der Liste deines Anbieters oder gib die Modell-ID selbst ein.'),
      field('Anbieter', sel(ready.map(x => ({ value: x.id, text: x.name })), p.id, (v) => { addState.provider = v; addState.q = ''; redraw(); })),
      h('div', { class: 'byok-row' }, filter, loadBtn), results,
      h('div', { class: 'byok-row two' }, field('Modell-ID', idIn), field('Anzeigename', nameIn)),
      field('Denkstufen, die du bei diesem Modell wählen kannst', lv, 'Nicht jedes Modell kennt jede Stufe – lehnt es eine ab, versucht Coden es automatisch ohne.'),
      h('div', { class: 'byok-row' }, h('button', { type: 'button', class: 'btn-save', text: 'Modell hinzufügen', onclick: () => {
        const modelId = idIn.value.trim(); if (!modelId) return toast('Gib eine Modell-ID ein oder wähle eins aus der Liste.', { type: 'warn' });
        const label = nameIn.value.trim() || [...p.suggest, ...list].find(m => m.id === modelId)?.label || modelId;
        act(() => post('/byok/models', { provider: p.id, modelId, label, levels: checked(lv) }), 'Modell hinzugefügt – du findest es im Auswahlmenü.');
      } }))));
  }
  // vorhandene Modelle
  const mine = state.models;
  wrap.append(h('div', { class: 'byok-card' }, subHead(`Deine Modelle (${mine.length})`, mine.length ? null : 'Noch keine – oben hinzufügen.'),
    ...mine.map(m => {
      const prov = state.providers.find(p => p.id === m.provider);
      const lv = levelBoxes(prov?.levels || state.levels, m.levels, () => save());
      const def = h('select', { class: 'settings-input byok-def', onchange: () => save() }, ...(prov?.levels || state.levels).map(l => h('option', { value: l, text: LEVEL_NAMES[l] || l, selected: l === m.defaultLevel || undefined })));
      const save = () => { const lvls = checked(lv); act(() => post('/byok/models', { provider: m.provider, modelId: m.modelId, label: m.label, levels: lvls, defaultLevel: lvls.includes(def.value) ? def.value : undefined })); };
      return h('div', { class: 'byok-model' }, h('div', { class: 'byok-mhead' }, h('b', { text: m.label }), h('span', { class: 'byok-prov', text: `${m.providerName} · ${m.modelId}${m.ready ? '' : ' · Key fehlt'}` }),
        h('button', { type: 'button', class: 'icon-btn', title: 'Modell entfernen', 'aria-label': 'Modell entfernen', onclick: () => act(() => post(`/byok/models/${m.id}`, null, 'DELETE')) }, icon('delete'))),
        h('div', { class: 'byok-row between' }, lv, h('label', { class: 'byok-def-l' }, 'Standard ', def)));
    })));
  return wrap;
}

// 3) Ausweich-Ketten
function memberOptions(taken) {
  const own = state.models.filter(m => m.ready).map(m => ({ value: m.tier, text: `${m.label} (${m.providerName})` }));
  const bi = state.builtin.map(b => ({ value: b.tier, text: b.label }));
  return [...own, ...bi].filter(o => !taken.includes(o.value));
}
function chainCard(c) {
  const key = c ? String(c.id) : 'new';
  if (!drafts.has(key)) drafts.set(key, { name: c ? c.name : '', members: c ? c.members.map(m => m.tier) : [] });
  const d = drafts.get(key); const nameOf = (t) => ownLabelAny(t);
  const nameIn = h('input', { type: 'text', class: 'settings-input', placeholder: 'Name der Kette, z. B. „Sicher“', maxlength: 40, value: d.name, oninput: (e) => { d.name = e.target.value; } });
  const move = (i, dir) => { const j = i + dir; if (j < 0 || j >= d.members.length) return; [d.members[i], d.members[j]] = [d.members[j], d.members[i]]; redraw(); };
  const items = d.members.map((t, i) => h('div', { class: 'byok-chain-i' }, h('span', { class: 'byok-n', text: i + 1 }),
    h('span', { class: 'byok-cn', text: nameOf(t) }), i === 0 ? h('small', { class: 'byok-prov', text: 'zuerst' }) : null,
    h('button', { type: 'button', class: 'icon-btn', title: 'Nach oben', 'aria-label': 'Nach oben', disabled: i === 0 || undefined, onclick: () => move(i, -1) }, icon('arrow_upward')),
    h('button', { type: 'button', class: 'icon-btn', title: 'Nach unten', 'aria-label': 'Nach unten', disabled: i === d.members.length - 1 || undefined, onclick: () => move(i, 1) }, icon('arrow_downward')),
    h('button', { type: 'button', class: 'icon-btn', title: 'Entfernen', 'aria-label': 'Entfernen', onclick: () => { d.members.splice(i, 1); redraw(); } }, icon('close'))));
  const opts = memberOptions(d.members);
  const addSel = sel([{ value: '', text: '+ Modell hinzufügen …' }, ...opts], '', (v) => { if (v && d.members.length < 8) { d.members.push(v); redraw(); } });
  return h('div', { class: 'byok-card' }, h('div', { class: 'byok-row' }, nameIn),
    d.members.length ? h('div', { class: 'byok-chain' }, items) : h('small', { class: 'byok-prov', text: 'Noch keine Modelle in dieser Kette.' }), addSel,
    h('div', { class: 'byok-row between' }, c ? h('button', { type: 'button', class: 'btn-cancel', text: 'Kette löschen', onclick: () => { if (confirm(`Kette „${c.name}“ löschen?`)) { drafts.delete(key); act(() => post(`/byok/chains/${c.id}`, null, 'DELETE'), 'Kette gelöscht.'); } } }) : h('span'),
      h('button', { type: 'button', class: 'btn-save', text: c ? 'Kette speichern' : 'Kette anlegen', onclick: async () => {
        if (!d.name.trim()) return toast('Gib der Kette einen Namen.', { type: 'warn' });
        if (!d.members.length) return toast('Füge mindestens ein Modell hinzu.', { type: 'warn' });
        if (await act(() => post('/byok/chains', { ...(c ? { id: c.id } : {}), name: d.name, members: d.members }), c ? 'Kette gespeichert.' : 'Kette angelegt – sie steht jetzt im Auswahlmenü.')) drafts.delete(key);
        redraw();
      } })));
}
function ownLabelAny(t) { return state.builtin.find(b => b.tier === t)?.label || state.models.find(m => m.tier === t)?.label || 'gelöschtes Modell'; }
function paneChains() {
  return h('div', { class: 'byok-stack' }, subHead('Ausweich-Ketten', 'Eine Kette probiert ihre Modelle der Reihe nach. Fällt eines aus (überlastet, Limit, Fehler), antwortet automatisch das nächste. Du kannst auch Coden-Modelle in die Kette setzen, zum Beispiel als letzte Rettung. Ketten findest du im Auswahlmenü und im App-Builder.'),
    ...state.chains.map(chainCard), h('div', { class: 'byok-sub', text: 'Neue Kette' }), chainCard(null));
}

// 4) App-Modus
function tierOpts(withAuto, autoText) {
  return [...(withAuto ? [{ value: 'auto', text: autoText }] : []),
    ...state.builtin.filter(b => b.tier !== 'ultra').map(b => ({ value: b.tier, text: b.label })),
    ...state.models.filter(m => m.ready).map(m => ({ value: m.tier, text: `${m.label} (${m.providerName})` })),
    ...state.chains.filter(c => c.ready).map(c => ({ value: c.tier, text: `${c.name} (Kette)` }))];
}
function paneApp() {
  if (!draftCfg) draftCfg = JSON.parse(JSON.stringify(state.agentConfig || { sub: 'auto', levels: { easy: 'auto', medium: 'auto', hard: 'auto' }, keyMax: 3, overflow: 'wait', overflowTier: 'flash' }));
  const c = draftCfg; const ownN = ownTiers().length;
  const sentence = () => {
    const six = 6; const via = Math.min(c.keyMax, six); const rest = six - via;
    return `Beispiel: Startet der Main Agent ${six} Sub-Agenten mit eigenem Modell, laufen ${via} gleichzeitig über deinen Key${rest ? ` – die anderen ${rest} ${c.overflow === 'wait' ? 'warten, bis ein Platz frei wird' : `laufen sofort über Coden ${state.builtin.find(b => b.tier === c.overflowTier)?.label.replace('Coden ', '') || ''}`}` : ''}.`;
  };
  const ex = h('p', { class: 'byok-example', text: sentence() });
  const num = h('output', { class: 'byok-num', text: c.keyMax });
  const range = h('input', { type: 'range', min: 1, max: 8, value: c.keyMax, class: 'settings-slider', oninput: (e) => { c.keyMax = +e.target.value; num.textContent = c.keyMax; ex.textContent = sentence(); } });
  const lvl = (k, label) => field(label, sel(tierOpts(true, 'wie Standard'), c.levels[k], (v) => { c.levels[k] = v; }));
  const overflowSel = sel(state.builtin.filter(b => b.tier !== 'ultra').map(b => ({ value: b.tier, text: b.label })), c.overflowTier, (v) => { c.overflowTier = v; ex.textContent = sentence(); });
  return h('div', { class: 'byok-stack' },
    subHead('App-Modus (Agenten)', 'Im App-Builder arbeitet der Main Agent und startet Sub-Agenten. Das Modell des Main Agents wählst du im Builder (dort stehen auch deine eigenen Modelle und Ketten). Hier legst du fest, womit die Sub-Agenten arbeiten und wie viele davon deinen Key gleichzeitig benutzen dürfen.'),
    !ownN ? h('div', { class: 'byok-empty small' }, icon('info'), h('p', { text: 'Du hast noch kein eigenes Modell. Die Einstellungen gelten erst, wenn du eines angelegt hast.' })) : null,
    h('div', { class: 'byok-card' }, h('div', { class: 'byok-sub first', text: 'Modell der Sub-Agenten' }),
      field('Standard', sel(tierOpts(true, 'Automatisch: wie der Main Agent'), c.sub, (v) => { c.sub = v; }), 'Automatisch heißt: Läuft der Main Agent mit einem eigenen Modell, nutzen die Sub-Agenten dasselbe. Bei Coden-Modellen wählt Coden je nach Schwierigkeit.'),
      h('div', { class: 'byok-row three' }, lvl('easy', 'Leichte Aufgaben'), lvl('medium', 'Mittlere Aufgaben'), lvl('hard', 'Schwere Aufgaben'))),
    h('div', { class: 'byok-card' }, h('div', { class: 'byok-sub first', text: 'Wie viele Sub-Agenten dürfen deinen Key benutzen?' }),
      h('div', { class: 'byok-row' }, range, num), ex,
      field('Sind mehr Sub-Agenten unterwegs als Plätze frei sind', sel([{ value: 'wait', text: 'Die übrigen warten, bis ein Platz frei wird (schont dein Rate-Limit)' }, { value: 'coden', text: 'Die übrigen laufen sofort über ein Coden-Modell' }], c.overflow, (v) => { c.overflow = v; ex.textContent = sentence(); })),
      field('Coden-Modell für die übrigen (nur bei „sofort über Coden“)', overflowSel)),
    h('div', { class: 'byok-row' }, h('button', { type: 'button', class: 'btn-save', text: 'App-Modus speichern', onclick: async () => { if (await act(() => post('/byok/agent-config', c, 'PUT'), 'App-Modus gespeichert.')) draftCfg = null; redraw(); } })));
}

const SUBS = [['keys', 'key', 'Anbieter & Keys'], ['models', 'smart_toy', 'Modelle'], ['chains', 'alt_route', 'Ketten'], ['app', 'deployed_code', 'App-Modus']];
export function renderByokSettings(box) {
  const pane = { keys: paneKeys, models: paneModels, chains: paneChains, app: paneApp }[sub]();
  box.replaceChildren(
    h('p', { class: 'settings-hint', text: 'Nutze deine eigenen API-Keys, wenn du die Modelle von Coden nicht verwenden willst. Eigene Modelle erscheinen im Auswahlmenü und im App-Builder, zählen nicht gegen dein Coden-Limit und laufen über die Rechnung deines Anbieters. Dein Key wird verschlüsselt auf dem Server gespeichert und nie wieder angezeigt.' }),
    h('div', { class: 'byok-tabs', role: 'tablist' }, SUBS.map(([id, ic, label], i) => h('button', { type: 'button', role: 'tab', class: sub === id ? 'active' : '', onclick: () => { sub = id; redraw(); } }, h('span', { class: 'byok-step', text: i + 1 }), h('span', { text: label })))),
    pane);
}
export async function openByokSettings(box) { if (!state.providers.length) await loadByok(); renderByokSettings(box); }
window.addEventListener('coden:byok-sub', (e) => { if (SUBS.some(s => s[0] === e.detail)) { sub = e.detail; redraw(); } });
