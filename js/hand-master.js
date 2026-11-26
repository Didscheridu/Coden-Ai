// js/hand-master.js – Kaydens Handschrift („Kaydens“) für die Admin-Mail.
// Die Daten liegen nur in der Datenbank (nie im öffentlichen Repo). Der Server gibt sie nur dem Owner
// (ADMIN_EMAIL, bestätigt). Alle anderen Nutzer trainieren ihre eigene Handschrift.
import { apiJson } from './backend.js';
import { setMasterRich, getMasterProfile, MASTER_ID } from './handwriting-core.js';
import { normalizeRich } from './hand-engine.js';
import { StudyStore } from './study-store.js';

const KEY = 'coden_hand_master_v2';
const AUTO_KEY = 'coden_hand_master_auto';
const changed = () => document.dispatchEvent(new CustomEvent('codenHandwritingChanged'));
let owner = false;

export const isHandOwner = () => owner;

function activate(raw, { remember = true } = {}) {
    const prof = setMasterRich(raw);
    if (!prof) return null;
    if (remember) { try { localStorage.setItem(KEY, JSON.stringify(raw)); } catch (_) { /* Speicher voll */ } }
    // Beim ersten Mal „Kaydens“ als aktive Handschrift setzen (danach entscheidet der Nutzer)
    try {
        if (!localStorage.getItem(AUTO_KEY)) {
            localStorage.setItem(AUTO_KEY, '1');
            const hw = StudyStore.handwriting();
            if (hw.activeId !== MASTER_ID) StudyStore.saveHandwriting({ ...hw, activeId: MASTER_ID });
        }
    } catch (_) { /* egal */ }
    return prof;
}

export function clearMaster() {
    setMasterRich(null);
    try { localStorage.removeItem(KEY); } catch (_) { /* egal */ }
    changed();
}

// Nach dem Login: nur der Owner lädt Kaydens (erst Zwischenspeicher, dann Server)
export async function loadMaster(isOwner) {
    owner = !!isOwner;
    if (!owner) { if (getMasterProfile()) clearMaster(); else { try { localStorage.removeItem(KEY); } catch (_) { /* egal */ } } return null; }
    try { const c = localStorage.getItem(KEY); if (c && activate(JSON.parse(c), { remember: false })) changed(); } catch (_) { /* kaputter Cache */ }
    try {
        const r = await apiJson('/study/hand-master');
        if (r.profile && activate(r.profile)) changed();
        else if (!r.profile && getMasterProfile()) clearMaster();
    } catch (e) {
        if (e.status === 404 || e.status === 403) { owner = false; clearMaster(); }
    }
    return getMasterProfile();
}

// Datei vom Skill (kaydens-handschrift.coden-hand.json, auch .gz) einspielen
export async function importMasterFile(file) {
    if (!owner) throw new Error('Nur die Admin-Mail darf Kaydens Handschrift einspielen.');
    let text;
    if (/\.gz$/i.test(file.name) && typeof DecompressionStream !== 'undefined') {
        text = await new Response(file.stream().pipeThrough(new DecompressionStream('gzip'))).text();
    } else text = await file.text();
    let raw;
    try { raw = JSON.parse(text); } catch (_) { throw new Error('Die Datei ist keine Handschrift-Datei.'); }
    const rich = normalizeRich(raw);
    if (!rich) throw new Error('Die Datei ist keine gültige Handschrift-Datei (coden-hand).');
    await apiJson('/study/hand-master', { method: 'PUT', body: JSON.stringify({ profile: rich }) });
    try { localStorage.removeItem(AUTO_KEY); } catch (_) { /* egal */ }
    activate(rich);
    changed();
    return getMasterProfile();
}

export async function deleteMaster() {
    await apiJson('/study/hand-master', { method: 'DELETE' });
    clearMaster();
}
