// js/storage.js – Chats & Einstellungen direkt über Firebase Firestore (+ schneller LocalStorage-Cache)
import {
  doc,
  collection,
  getDoc,
  getDocs,
  setDoc,
  deleteDoc,
  writeBatch,
  query,
  orderBy
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { auth } from './auth.js';
import { db, fbAuth, OperationType, handleFirestoreError, dbState } from './firebase.js';
import { apiJson } from './backend.js';

const LOCAL_SESSIONS_KEY = 'coden_sessions';
const LOCAL_SETTINGS_KEY = 'coden_settings';
const LOCAL_UID_KEY = 'coden_sessions_uid';
// Stand der letzten erfolgreichen Synchronisierung: { uid, sigs: {sessionId: Fingerabdruck}, user: Fingerabdruck, dirty }
// Damit wird beim Speichern nur geschrieben, was sich geändert hat (statt jedes Mal alle Chats zu lesen und neu zu schreiben),
// und Änderungen, die ohne Datenbank gemacht wurden, gehen beim nächsten Laden nicht verloren.
const LOCAL_SYNC_KEY = 'coden_sync_state';
const ID_RE = /^[a-zA-Z0-9_-]{1,128}$/;

const DEFAULT_SETTINGS = () => ({
  persona: 'Standard',
  customPersona: '',
  fontSize: 15,
  emailConfig: { provider: 'gmail', address: '', password: '' }
});

const LOCAL_ONLY = (s) => ({ emailPassword: s?.emailConfig?.password || '' });

let syncTimer = null;
let lastLoadedUid = null;
let syncingInFlight = false;
let pendingSync = false;

function safeParse(raw, fallback) {
  if (!raw) return fallback;
  try {
    const val = JSON.parse(raw);
    return val ?? fallback;
  } catch (_) {
    return fallback;
  }
}

function sanitizeId(id, idx = 0) {
  const s = String(id || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
  return ID_RE.test(s) ? s : `chat_${Date.now()}_${idx}`;
}

function sanitizeMessage(m) {
  if (!m || typeof m !== 'object') return null;
  let text = String(m.text ?? '');
  let displayHTML = typeof m.displayHTML === 'string' ? m.displayHTML : '';
  // Base64-Bilder nicht in Firestore ablegen (1 MB Dokument-Limit schützen)
  if (displayHTML.includes('data:image')) {
    displayHTML = displayHTML.replace(/!\[([^\]]*)\]\(data:image\/[^)]+\)/g, '📷 *Bild: $1*');
    if (displayHTML.includes('data:image')) {
      displayHTML = displayHTML.replace(/data:image\/[^"')\s>]+/g, '#bild-lokal');
    }
  }
  if (text.includes('data:image')) {
    text = text.replace(/data:image\/[^"')\s>]+/g, '[Bild]');
  }
  const out = {
    text: text.slice(0, 120000),
    isUser: !!m.isUser
  };
  if (displayHTML && displayHTML !== out.text) out.displayHTML = displayHTML.slice(0, 120000);
  if (m.think && typeof m.think === 'object') {
    out.think = {
      ...(Number.isFinite(m.think.secs) ? { secs: m.think.secs } : {}),
      ...(Array.isArray(m.think.steps) ? { steps: m.think.steps.slice(0, 40).map(x => String(x).slice(0, 300)) } : {}),
      ...(typeof m.think.text === 'string' && m.think.text.trim() ? { text: m.think.text.slice(0, 3000) } : {})
    };
  }
  return out;
}

function sanitizeSession(s, idx = 0) {
  if (!s || typeof s !== 'object' || s.temp) return null;
  const msgs = Array.isArray(s.messages) ? s.messages.map(sanitizeMessage).filter(Boolean).slice(-1000) : [];
  return {
    id: sanitizeId(s.id, idx),
    title: String(s.title || 'Neuer Projekt-Chat').slice(0, 200),
    messages: msgs,
    pinned: !!s.pinned,
    unread: !!s.unread,
    ...(s.projectId !== undefined && s.projectId !== null ? { projectId: s.projectId } : {}),
    ...(s.assistantId ? { assistantId: String(s.assistantId).slice(0, 128) } : {}),
    ...(s.createdAt ? { createdAt: String(s.createdAt).slice(0, 64) } : {}),
    ...(s.updatedAt ? { updatedAt: String(s.updatedAt).slice(0, 64) } : {})
  };
}

function stripSecrets(settings) {
  const s = { ...(settings && typeof settings === 'object' ? settings : DEFAULT_SETTINGS()) };
  delete s.apiKey;
  if (s.emailConfig && typeof s.emailConfig === 'object') {
    s.emailConfig = {
      provider: String(s.emailConfig.provider || 'gmail').slice(0, 32),
      address: String(s.emailConfig.address || '').slice(0, 200),
      password: ''
    };
  }
  // Firestore rule erlaubt max 40 Keys in settings
  const trimmed = {};
  for (const k of Object.keys(s).slice(0, 40)) trimmed[k] = s[k];
  return trimmed;
}

function hashStr(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36) + '.' + str.length.toString(36);
}
// Fingerabdruck eines (bereinigten) Chats inkl. Position; Zeitstempel zählen nicht mit
function sigOf(clean, idx) {
  return hashStr(JSON.stringify([idx, clean.title, clean.messages, !!clean.pinned, !!clean.unread, clean.projectId ?? null, clean.assistantId || null]));
}
function getSyncState(uid) {
  const st = safeParse(localStorage.getItem(LOCAL_SYNC_KEY), null);
  return st && st.uid === uid ? { ...st, sigs: st.sigs && typeof st.sigs === 'object' ? st.sigs : null } : null;
}
function setSyncState(st) {
  try { localStorage.setItem(LOCAL_SYNC_KEY, JSON.stringify(st)); } catch (_) {}
}
function markDirty(uid) {
  if (!uid) return;
  const st = getSyncState(uid) || { uid, sigs: null, user: null };
  if (!st.dirty) { st.dirty = true; setSyncState(st); }
}
const dbUnavailable = () => dbState.reason === 'quota' || dbState.reason === 'denied' || dbState.reason === 'offline';

function hasRealContent(sessions) {
  return Array.isArray(sessions) && sessions.some(s => !s.temp && Array.isArray(s.messages) && s.messages.length > 0);
}

async function writeToFirestore(uid, sessions, settings) {
  if (!uid || !fbAuth.currentUser || fbAuth.currentUser.uid !== uid) return false;
  if (!fbAuth.currentUser.emailVerified) {
    // Firestore Rules verlangen eine bestätigte E-Mail-Adresse; Backend-Endpunkt als Fallback vermeiden wir hier, damit Firestore-Regeln konsistent bleiben
    return false;
  }
  const nowIso = new Date().toISOString();
  const cleanSessions = (Array.isArray(sessions) ? sessions : [])
    .map((s, idx) => sanitizeSession(s, idx))
    .filter(Boolean)
    .slice(0, 300);
  const cleanSettings = stripSecrets(settings);

  const prev = getSyncState(uid);
  const userPayload = {
    uid,
    settings: cleanSettings,
    sessionOrder: cleanSessions.map(s => s.id)
  };
  const userSig = hashStr(JSON.stringify(userPayload));
  if (!prev || prev.user !== userSig) {
    try {
      await setDoc(doc(db, 'user_data', uid), { ...userPayload, updatedAt: nowIso }, { merge: true });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `user_data/${uid}`);
    }
  }

  // Welche Chats liegen schon in user_data/{uid}/sessions? Normalerweise aus dem letzten Abgleich bekannt,
  // nur ohne bekannten Stand wird die Liste einmal gelesen.
  let known = prev?.sigs || null;
  if (!known) {
    known = {};
    try {
      const snap = await getDocs(collection(db, 'user_data', uid, 'sessions'));
      snap.forEach(d => { known[d.id] = 'unbekannt'; });
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, `user_data/${uid}/sessions`);
    }
  }

  const nextSigs = {};
  const ops = [];
  cleanSessions.forEach((s, idx) => {
    const sig = sigOf(s, idx);
    nextSigs[s.id] = sig;
    if (known[s.id] === sig) return; // unverändert: nichts schreiben
    ops.push({
      type: 'set',
      ref: doc(db, 'user_data', uid, 'sessions', s.id),
      data: {
        id: s.id,
        uid,
        title: s.title,
        messages: s.messages,
        pinned: !!s.pinned,
        unread: !!s.unread,
        ...(s.projectId !== undefined && s.projectId !== null ? { projectId: s.projectId } : {}),
        ...(s.assistantId ? { assistantId: s.assistantId } : {}),
        orderIndex: idx,
        createdAt: s.createdAt || nowIso,
        updatedAt: nowIso
      }
    });
  });
  for (const oldId of Object.keys(known)) {
    if (!(oldId in nextSigs)) {
      ops.push({ type: 'delete', ref: doc(db, 'user_data', uid, 'sessions', oldId) });
    }
  }

  // Batches à max 400 Operationen ausführen
  for (let i = 0; i < ops.length; i += 400) {
    const batch = writeBatch(db);
    for (const op of ops.slice(i, i + 400)) {
      if (op.type === 'set') batch.set(op.ref, op.data);
      else batch.delete(op.ref);
    }
    try {
      await batch.commit();
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `user_data/${uid}/sessions`);
    }
  }
  setSyncState({ uid, sigs: nextSigs, user: userSig, dirty: false });
  return true;
}

async function flushCloudSync() {
  if (!auth.currentUser) return false;
  if (syncingInFlight) {
    pendingSync = true;
    return false;
  }
  syncingInFlight = true;
  try {
    const uid = auth.currentUser.uid;
    const sessions = Storage.getSessions();
    const settings = Storage.getSettings();
    markDirty(uid);
    // Datenbank gerade nicht erreichbar (z. B. Tageskontingent): nicht bei jeder Eingabe erneut anklopfen.
    // Die Änderungen bleiben auf dem Gerät und werden nach der Wiederverbindung übertragen.
    if (dbUnavailable()) return false;
    const ok = await writeToFirestore(uid, sessions, settings);
    if (!ok) {
      // Fallback: falls unbestätigt oder noch im REST-Modus, Backend API probieren
      await apiJson('/data', { method: 'PUT', body: JSON.stringify({ sessions, settings }) }).catch(() => {});
    }
    return true;
  } catch (e) {
    console.error('Cloud Sync Error:', e);
    if (e?.code === 'resource-exhausted' || /quota|resource.exhausted/i.test(String(e?.message || e))) Object.assign(dbState, { ok: false, reason: 'quota' });
    return false;
  } finally {
    syncingInFlight = false;
    if (pendingSync) {
      pendingSync = false;
      setTimeout(() => { flushCloudSync(); }, 300);
    }
  }
}

// Änderungen, die ohne Datenbank gemacht wurden, mit dem Cloud-Stand zusammenführen.
// Mit bekanntem letzten Abgleich (st.sigs) wird genau unterschieden, wer was geändert hat;
// ohne (ältere Version) gewinnt der Chat mit mehr Nachrichten.
function mergeOffline(localSessions, remote, st) {
  const local = (Array.isArray(localSessions) ? localSessions : []).map((x, i) => sanitizeSession(x, i)).filter(Boolean);
  const base = st.sigs || null;
  const remoteById = new Map(remote.map(r => [r.id, r]));
  const out = []; const used = new Set();
  local.forEach((l, i) => {
    const r = remoteById.get(l.id);
    let pick = l;
    if (r) {
      if (base) pick = base[l.id] && base[l.id] === sigOf(l, i) ? r : l; // lokal unverändert → Cloud-Stand nehmen
      else pick = (r.messages?.length || 0) > (l.messages?.length || 0) ? r : l;
    } else if (base && base[l.id]) {
      return; // war synchron, wurde aber auf einem anderen Gerät gelöscht
    }
    out.push(pick); used.add(l.id);
  });
  remote.forEach((r) => {
    if (used.has(r.id)) return;
    if (base && base[r.id] && !local.some(l => l.id === r.id)) return; // lokal gelöscht
    out.push(r);
  });
  return out;
}

export const Storage = {
  getSessions: () => {
    const cachedUid = localStorage.getItem(LOCAL_UID_KEY);
    const activeUid = auth.currentUser?.uid || null;
    if (activeUid && cachedUid && cachedUid !== activeUid) {
      // Anderer Nutzer eingeloggt: alten lokalen Cache nicht vermischen
      return [];
    }
    const parsed = safeParse(localStorage.getItem(LOCAL_SESSIONS_KEY), []);
    return Array.isArray(parsed) ? parsed : [];
  },

  saveSessions: (sessions) => {
    const clean = (Array.isArray(sessions) ? sessions : []).filter(s => s && !s.temp);
    if (auth.currentUser?.uid) localStorage.setItem(LOCAL_UID_KEY, auth.currentUser.uid);
    try {
      localStorage.setItem(LOCAL_SESSIONS_KEY, JSON.stringify(clean));
    } catch (e) {
      // Falls localStorage wegen alter Bilder voll ist, bereinigte Version speichern
      const stripped = clean.map((s, i) => sanitizeSession(s, i)).filter(Boolean);
      try { localStorage.setItem(LOCAL_SESSIONS_KEY, JSON.stringify(stripped)); } catch (_) {}
    }
    markDirty(auth.currentUser?.uid);
    Storage.syncToCloud();
  },

  createNewSession: () => {
    const now = new Date().toISOString();
    return {
      id: String(Date.now()),
      title: 'Neuer Projekt-Chat',
      messages: [],
      createdAt: now,
      updatedAt: now
    };
  },

  getSettings: () => {
    const parsed = safeParse(localStorage.getItem(LOCAL_SETTINGS_KEY), null);
    return parsed && typeof parsed === 'object' ? { ...DEFAULT_SETTINGS(), ...parsed } : DEFAULT_SETTINGS();
  },

  saveSettings: (settings) => {
    if (auth.currentUser?.uid) localStorage.setItem(LOCAL_UID_KEY, auth.currentUser.uid);
    localStorage.setItem(LOCAL_SETTINGS_KEY, JSON.stringify(settings));
    markDirty(auth.currentUser?.uid);
    Storage.syncToCloud();
  },

  deleteSessionFromCloud: async (sessionId) => {
    const uid = auth.currentUser?.uid;
    if (!uid || !fbAuth.currentUser || fbAuth.currentUser.uid !== uid) return;
    if (!fbAuth.currentUser.emailVerified) return;
    const cleanId = sanitizeId(sessionId);
    try {
      await deleteDoc(doc(db, 'user_data', uid, 'sessions', cleanId));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `user_data/${uid}/sessions/${cleanId}`);
    }
  },

  clearLocalUserCache: () => {
    clearTimeout(syncTimer);
    lastLoadedUid = null;
    localStorage.removeItem(LOCAL_SESSIONS_KEY);
    localStorage.removeItem(LOCAL_UID_KEY);
    localStorage.removeItem(LOCAL_SYNC_KEY);
  },

  syncToCloud: () => {
    if (!auth.currentUser) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => { flushCloudSync(); }, 1000);
  },

  syncNow: () => {
    if (!auth.currentUser) return Promise.resolve(false);
    clearTimeout(syncTimer);
    return flushCloudSync();
  },

  loadFromCloud: async () => {
    const user = auth.currentUser;
    if (!user) return false;
    const uid = user.uid;
    const cachedUid = localStorage.getItem(LOCAL_UID_KEY);
    const sameOrLegacyLocal = !cachedUid || cachedUid === uid;
    const localSessions = sameOrLegacyLocal ? safeParse(localStorage.getItem(LOCAL_SESSIONS_KEY), []) : [];
    const localPw = LOCAL_ONLY(Storage.getSettings()).emailPassword;

    let remoteSessions = [];
    let remoteSettings = null;
    let remoteFound = false;
    let loadFailed = false;

    try {
      const userSnap = await getDoc(doc(db, 'user_data', uid));
      const userDoc = userSnap.exists() ? userSnap.data() : null;
      if (userDoc) {
        remoteFound = true;
        if (userDoc.settings && typeof userDoc.settings === 'object') {
          remoteSettings = userDoc.settings;
        }
      }

      const sessionsRef = collection(db, 'user_data', uid, 'sessions');
      let sessSnap;
      try {
        sessSnap = await getDocs(query(sessionsRef, orderBy('orderIndex', 'asc')));
      } catch (_) {
        sessSnap = await getDocs(sessionsRef);
      }

      const byId = new Map();
      sessSnap.forEach((d) => {
        const val = d.data();
        if (val && typeof val === 'object') {
          byId.set(val.id || d.id, { ...val, id: String(val.id || d.id) });
        }
      });

      if (byId.size > 0) {
        remoteFound = true;
        const order = Array.isArray(userDoc?.sessionOrder) ? userDoc.sessionOrder.map(String) : [];
        if (order.length) {
          for (const id of order) {
            if (byId.has(id)) {
              remoteSessions.push(byId.get(id));
              byId.delete(id);
            }
          }
        }
        const rest = Array.from(byId.values()).sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0));
        remoteSessions.push(...rest);
      } else if (Array.isArray(userDoc?.sessions) && userDoc.sessions.length > 0) {
        // Alte Einzeldokument-Struktur -> direkt übernehmen und in Subcollection migrieren
        remoteFound = true;
        remoteSessions = userDoc.sessions;
      }
    } catch (error) {
      if (error?.code === 'permission-denied') {
        handleFirestoreError(error, OperationType.GET, `user_data/${uid}`);
      }
      console.error('Firestore Load Error:', error);
      loadFailed = true;
    }
    // Laden fehlgeschlagen (z. B. Kontingent aufgebraucht): lokalen Stand behalten, nichts überschreiben
    if (loadFailed) return false;

    // Fallback über /api/data (z. B. wenn Firestore-Subcollection noch leer ist und Server migrieren kann)
    if (!remoteFound || (!remoteSessions.length && !hasRealContent(remoteSessions))) {
      try {
        const apiData = await apiJson('/data');
        if (apiData?.exists) {
          remoteFound = true;
          if (Array.isArray(apiData.sessions) && apiData.sessions.length > 0 && !remoteSessions.length) {
            remoteSessions = apiData.sessions;
          }
          if (!remoteSettings && apiData.settings) {
            remoteSettings = apiData.settings;
          }
        }
      } catch (_) {}
    }

    localStorage.setItem(LOCAL_UID_KEY, uid);

    // Wenn lokal echte Chats existieren, die Cloud aber leer ist, diese einmalig in Firebase sichern statt zu überschreiben!
    if (!hasRealContent(remoteSessions) && hasRealContent(localSessions)) {
      remoteSessions = localSessions.filter(s => !s.temp);
      if (fbAuth.currentUser?.emailVerified) {
        writeToFirestore(uid, remoteSessions, remoteSettings || Storage.getSettings()).catch(() => {});
      }
      remoteFound = true;
    }

    if (remoteFound && remoteSessions.length > 0) {
      let normalized = remoteSessions.map((s, idx) => sanitizeSession(s, idx)).filter(Boolean);
      const remoteSigs = {}; normalized.forEach((x, i) => { remoteSigs[x.id] = sigOf(x, i); });
      const st = sameOrLegacyLocal ? getSyncState(uid) : null;
      const merged = st?.dirty ? mergeOffline(localSessions, normalized, st) : null;
      // Basis für spätere Abgleiche: das, was jetzt wirklich in der Cloud liegt
      setSyncState({ uid, sigs: remoteSigs, user: st?.user || null, dirty: !!merged });
      if (merged) normalized = merged;
      localStorage.setItem(LOCAL_SESSIONS_KEY, JSON.stringify(normalized));
      if (merged) setTimeout(() => { flushCloudSync(); }, 500);
    } else if (cachedUid && cachedUid !== uid) {
      localStorage.setItem(LOCAL_SESSIONS_KEY, JSON.stringify([]));
    }

    if (remoteSettings) {
      const merged = { ...DEFAULT_SETTINGS(), ...remoteSettings };
      if (merged.emailConfig) merged.emailConfig.password = localPw;
      localStorage.setItem(LOCAL_SETTINGS_KEY, JSON.stringify(merged));
    }

    lastLoadedUid = uid;
    return remoteFound;
  },

  lastLoadedUid: () => lastLoadedUid
};
