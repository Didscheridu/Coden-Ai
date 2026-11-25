// js/firebase.js – Zentrale Firebase-Initialisierung, Verbindungstest & Fehlerbehandlung
import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { initializeFirestore, getFirestore, doc, getDocFromServer } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

const FALLBACK_CONFIG = {
  projectId: "coden-4561f",
  appId: "1:291880469153:web:2c0e14c6eceee8a85e26e0",
  apiKey: "AIzaSyAXszFYN8ablxO9ywdMk3LjzGBZXVorVQI",
  authDomain: "coden-4561f.firebaseapp.com",
  firestoreDatabaseId: "ai-studio-codenai-d5a99dca-ece7-4952-8ea8-5b8fbe3f45e1",
  storageBucket: "coden-4561f.firebasestorage.app",
  messagingSenderId: "291880469153"
};

async function loadFirebaseConfig() {
  try {
    const res = await fetch('/firebase-applet-config.json', { cache: 'no-store' });
    if (res.ok) {
      const cfg = await res.json();
      if (cfg && cfg.projectId && cfg.apiKey) return { ...FALLBACK_CONFIG, ...cfg };
    }
  } catch (_) {}
  return FALLBACK_CONFIG;
}

export const firebaseConfig = await loadFirebaseConfig();
export const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
export const fbAuth = getAuth(app);
function initDb() {
  try {
    return initializeFirestore(
      app,
      { experimentalAutoDetectLongPolling: true },
      firebaseConfig.firestoreDatabaseId || undefined
    );
  } catch (_) {
    return firebaseConfig.firestoreDatabaseId
      ? getFirestore(app, firebaseConfig.firestoreDatabaseId)
      : getFirestore(app);
  }
}
export const db = initDb();

export const OperationType = Object.freeze({
  CREATE: 'create',
  UPDATE: 'update',
  DELETE: 'delete',
  LIST: 'list',
  GET: 'get',
  WRITE: 'write'
});

export function handleFirestoreError(error, operationType, path) {
  const user = fbAuth.currentUser;
  const errInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: user?.uid || null,
      email: user?.email || null,
      emailVerified: user?.emailVerified ?? null,
      isAnonymous: user?.isAnonymous ?? null,
      tenantId: user?.tenantId || null,
      providerInfo: Array.isArray(user?.providerData)
        ? user.providerData.map(provider => ({
            providerId: provider.providerId || null,
            email: provider.email || null
          }))
        : []
    },
    operationType,
    path: path || null
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  const err = new Error(JSON.stringify(errInfo));
  err.code = error?.code;
  throw err;
}

let lastConnectedAt = Number(sessionStorage.getItem('coden_db_ok_ts') || 0);
let retryWakeup = null;
let inflightConnect = null;
// Zustand der Datenbank für die Oberfläche: reason = 'quota' (Tageskontingent aufgebraucht), 'denied', 'offline' oder null
export const dbState = { ok: false, reason: null, message: '' };

export async function testConnection({ timeoutMs = 8000 } = {}) {
  try {
    await Promise.race([
      getDocFromServer(doc(db, 'test', 'connection')),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout: the client is offline')), timeoutMs))
    ]);
    lastConnectedAt = Date.now();
    try { sessionStorage.setItem('coden_db_ok_ts', String(lastConnectedAt)); } catch (_) {}
    Object.assign(dbState, { ok: true, reason: null, message: '' });
    return true;
  } catch (error) {
    const code = String(error?.code || ''); const msg = String(error?.message || error || '');
    const reason = code === 'resource-exhausted' || /quota|resource.exhausted/i.test(msg) ? 'quota'
      : code === 'permission-denied' ? 'denied' : 'offline';
    if (reason === 'quota') {
      try { sessionStorage.removeItem('coden_db_ok_ts'); } catch (_) {}
      lastConnectedAt = 0;
    }
    Object.assign(dbState, { ok: false, reason, message: msg.slice(0, 200) });
    if (reason === 'offline') console.warn('Firestore nicht erreichbar:', msg);
    else console.warn('Firestore meldet:', code || msg);
    return false;
  }
}

export function retryDbNow() {
  if (typeof retryWakeup === 'function') {
    const fn = retryWakeup;
    retryWakeup = null;
    fn();
  }
}

// Wartet kurz auf die Datenbank. Gibt true (verbunden) oder false zurück – blockiert aber nie endlos:
// Bei aufgebrauchtem Kontingent oder fehlender Berechtigung sofort false (weiter probieren kostet nur weitere Lesezugriffe),
// bei Netzproblemen nach maxAttempts/maxWaitMs. Die App läuft dann mit dem Speicher auf dem Gerät weiter.
export async function ensureDbConnection({ onAttempt, maxFreshMs = 5 * 60_000, maxAttempts = 3, maxWaitMs = 10000 } = {}) {
  if (lastConnectedAt && Date.now() - lastConnectedAt < maxFreshMs) {
    Object.assign(dbState, { ok: true, reason: null, message: '' });
    return true;
  }
  if (inflightConnect) return inflightConnect;

  inflightConnect = (async () => {
    let attempt = 0;
    const startedAt = Date.now();
    for (;;) {
      attempt += 1;
      onAttempt?.({ attempt, elapsedMs: Date.now() - startedAt, online: navigator.onLine !== false });
      const ok = await testConnection();
      if (ok) return true;
      if (dbState.reason === 'quota' || dbState.reason === 'denied') return false;
      if (attempt >= maxAttempts || Date.now() - startedAt >= maxWaitMs) return false;
      const delay = Math.min(4000, 600 + attempt * 500);
      await new Promise((resolve) => {
        const timer = setTimeout(() => {
          window.removeEventListener('online', wake);
          if (retryWakeup === wake) retryWakeup = null;
          resolve();
        }, delay);
        const wake = () => {
          clearTimeout(timer);
          window.removeEventListener('online', wake);
          if (retryWakeup === wake) retryWakeup = null;
          resolve();
        };
        retryWakeup = wake;
        window.addEventListener('online', wake, { once: true });
      });
    }
  })();

  try {
    return await inflightConnect;
  } finally {
    inflightConnect = null;
  }
}

