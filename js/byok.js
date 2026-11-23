// js/byok.js – Bring your own Key: eigene API-Keys und Modelle (Einstellungen) + Eintrag im Modell-Auswahlmenü.
// Die Keys gehen nur zum Server und werden dort verschlüsselt gespeichert; sie kommen nie wieder in den Browser.
import { apiJson } from './backend.js';
import { toast } from './toast.js';
import { h, icon } from './apps/dom.js';

const LEVEL_NAMES = { minimal: 'Minimal', low: 'Niedrig', medium: 'Mittel', high: 'Hoch', xhigh: 'Sehr hoch', max: 'Maximal' };
const DEFAULT_ON = ['low', 'medium', 'high'];
let state = { providers: [], models: [], levels: [] };
let hooks = { getTier: () => 'flash', select: () => {}, fallback: () => {} };
const loaded = new Map(); // Anbieter -> vom Anbieter geladene Modelle (nur im Speicher)

export const isByokTier = (t) => /^byok:\d+$/.test(t || '');
const modelOf = (tier) => state.models.find(m => m.tier === tier) || null;
const lvlKey = (m) => 'coden_byok_level_' + m.id;

// Gewählte Denkstufe für ein eigenes Modell (undefined bei Coden-Modellen: dort gilt der normale Regler)
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
  if (isByokTier(cur) && !modelOf(cur)?.ready) { hooks.fallback(); toast('Das eigene Modell ist nicht mehr verfügbar – zurück zu Coden Flash.', { type: 'warn' }); }
  syncEffortRow(hooks.getTier());
  return state;
}
export function clearByok() { state = { providers: [], models: [], levels: [] }; renderMenu(); }

// ---------- Auswahlmenü ----------
function renderMenu() {
  const box = document.getElementById('byok-models'); if (!box) return;
  const ready = state.models.filter(m => m.ready);
  const cur = hooks.getTier();
  box.replaceChildren(...(ready.length ? [h('div', { class: 'byok-menu-head', text: 'Eigene Modelle' }), ...ready.map(m =>
    h('div', { class: 'model-option byok-option' + (m.tier === cur ? ' active' : ''), 'data-model': m.tier, title: `${m.providerName} · ${m.modelId}`, onclick: () => hooks.select(m.tier, m.label) },
      icon('key'), h('span', { class: 'name', text: m.label }), h('span', { class: 'byok-prov', text: m.providerName })))] : []));
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
  const seg = row.querySelector('.effort-seg');
  seg.replaceChildren(...m.levels.map(l => h('button', { type: 'button', class: l === cur ? 'active' : '', text: LEVEL_NAMES[l] || l, onclick: (e) => {
    e.stopPropagation(); try { localStorage.setItem(lvlKey(m), l); } catch (_) { /* privater Modus */ } syncEffortRow(tier);
  } })));
}

// ---------- Einstellungen ----------
const post = (path, body, method = 'POST') => apiJson(path, { method, ...(body ? { body: JSON.stringify(body) } : {}) });
async function act(fn, okMsg) {
  try { state = await fn(); renderMenu(); syncEffortRow(hooks.getTier()); if (okMsg) toast(okMsg, { type: 'ok' }); } catch (e) { toast(e.message, { type: 'error' }); }
  const box = document.getElementById('byok-box'); if (box) renderByokSettings(box);
}
const levelBoxes = (all, on, onChange) => h('div', { class: 'byok-levels' }, all.map(l => {
  const cb = h('input', { type: 'checkbox', value: l, checked: on.includes(l) || undefined }); cb.checked = on.includes(l);
  if (onChange) cb.addEventListener('change', () => onChange());
  return h('label', { class: 'byok-lvl' }, cb, ' ' + (LEVEL_NAMES[l] || l));
}));
const checked = (el) => [...el.querySelectorAll('input:checked')].map(i => i.value);

function providerCard(p) {
  const keyIn = h('input', { type: 'password', class: 'settings-input', placeholder: p.hasKey ? 'Neuen Key einfügen (ersetzt den alten)' : `API-Key (${p.keyHint})`, autocomplete: 'off', spellcheck: 'false' });
  const head = h('div', { class: 'byok-head' }, h('b', { text: p.name }),
    h('span', { class: 'byok-chip' + (p.hasKey ? ' ok' : ''), text: p.hasKey ? `Key ${p.hint}` : 'kein Key' }),
    h('a', { href: p.link, target: '_blank', rel: 'noopener', class: 'byok-link', text: 'Key holen ↗' }));
  const keyRow = h('div', { class: 'byok-row' }, keyIn,
    h('button', { type: 'button', class: 'btn-save', text: 'Speichern', onclick: () => { const v = keyIn.value.trim(); if (!v) return toast('Füge zuerst deinen Key ein.', { type: 'warn' }); act(() => post(`/byok/keys/${p.id}`, { key: v }, 'PUT'), 'Key gespeichert.'); } }),
    p.hasKey && h('button', { type: 'button', class: 'btn-cancel', text: 'Entfernen', onclick: () => { if (confirm(`Key von ${p.name} entfernen? Deine Modelle dieses Anbieters sind dann nicht mehr auswählbar.`)) act(() => post(`/byok/keys/${p.id}`, null, 'DELETE'), 'Key entfernt.'); } }));
  const card = h('div', { class: 'byok-card' }, head, keyRow);
  if (!p.hasKey) return card;

  // Modell hinzufügen
  const list = h('datalist', { id: 'byok-dl-' + p.id }, [...p.suggest, ...(loaded.get(p.id) || [])].map(m => h('option', { value: m.id, label: m.label })));
  const idIn = h('input', { type: 'text', class: 'settings-input', list: 'byok-dl-' + p.id, placeholder: p.suggest[0] ? `Modell-ID, z. B. ${p.suggest[0].id}` : 'Modell-ID', autocomplete: 'off', spellcheck: 'false' });
  const nameIn = h('input', { type: 'text', class: 'settings-input', placeholder: 'Anzeigename (optional)', maxlength: 60 });
  const lv = levelBoxes(p.levels, DEFAULT_ON.filter(l => p.levels.includes(l)));
  const loadBtn = h('button', { type: 'button', class: 'btn-cancel', text: loaded.has(p.id) ? `${loaded.get(p.id).length} Modelle geladen` : 'Modelle von ' + p.name + ' laden', onclick: async () => {
    loadBtn.disabled = true; loadBtn.textContent = 'Lade …';
    try { loaded.set(p.id, (await apiJson(`/byok/providers/${p.id}/models`)).models); } catch (e) { toast(e.message, { type: 'error' }); }
    const box = document.getElementById('byok-box'); if (box) renderByokSettings(box);
  } });
  const add = h('div', { class: 'byok-add' }, h('div', { class: 'byok-sub', text: 'Modell hinzufügen' }), loadBtn, idIn, list, nameIn,
    h('div', { class: 'byok-sub', text: 'Denkstufen, die du bei diesem Modell wählen kannst' }), lv,
    h('button', { type: 'button', class: 'btn-save', text: 'Modell hinzufügen', onclick: () => {
      const modelId = idIn.value.trim(); if (!modelId) return toast('Gib eine Modell-ID ein.', { type: 'warn' });
      const label = nameIn.value.trim() || (loaded.get(p.id) || p.suggest).find(m => m.id === modelId)?.label || modelId;
      act(() => post('/byok/models', { provider: p.id, modelId, label, levels: checked(lv) }), 'Modell hinzugefügt – du findest es im Auswahlmenü.');
    } }));
  card.append(add);
  return card;
}

export function renderByokSettings(box) {
  const mine = state.models.map(m => {
    const prov = state.providers.find(p => p.id === m.provider);
    const lv = levelBoxes(prov?.levels || state.levels, m.levels, () => act(() => post('/byok/models', { provider: m.provider, modelId: m.modelId, label: m.label, levels: checked(lv), defaultLevel: m.defaultLevel })));
    return h('div', { class: 'byok-model' }, h('div', { class: 'byok-mhead' }, h('b', { text: m.label }), h('span', { class: 'byok-prov', text: `${m.providerName} · ${m.modelId}${m.ready ? '' : ' · Key fehlt'}` }),
      h('button', { type: 'button', class: 'icon-btn', title: 'Modell entfernen', 'aria-label': 'Modell entfernen', onclick: () => act(() => post(`/byok/models/${m.id}`, null, 'DELETE')) }, icon('delete'))), lv);
  });
  box.replaceChildren(
    h('p', { class: 'settings-hint', text: 'Nutze deine eigenen API-Keys, wenn du die Modelle von Coden nicht verwenden willst. Eigene Modelle erscheinen im Auswahlmenü und zählen nicht gegen dein Coden-Limit – die Kosten laufen über deinen Anbieter. Dein Key wird verschlüsselt auf dem Server gespeichert und nie wieder angezeigt.' }),
    ...state.providers.map(providerCard),
    mine.length ? h('div', { class: 'byok-mine' }, h('div', { class: 'byok-sub', text: 'Deine Modelle' }), ...mine) : null);
}
export async function openByokSettings(box) { if (!state.providers.length) await loadByok(); renderByokSettings(box); }
