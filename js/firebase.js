// js/firebase.js – Zentrale Firebase-Initialisierung, Verbindungstest & Fehlerbehandlung
import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { getFirestore, doc, getDocFromServer } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

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
export const db = firebaseConfig.firestoreDatabaseId
  ? getFirestore(app, firebaseConfig.firestoreDatabaseId)
  : getFirestore(app);

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

let lastConnectedAt = 0;
let retryWakeup = null;
let inflightConnect = null;

export async function testConnection({ timeoutMs = 4500 } = {}) {
  try {
    await Promise.race([
      getDocFromServer(doc(db, 'test', 'connection')),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout: the client is offline')), timeoutMs))
    ]);
    lastConnectedAt = Date.now();
    return true;
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration or network connectivity.');
    }
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

export async function ensureDbConnection({ onAttempt, maxFreshMs = 4000 } = {}) {
  if (lastConnectedAt && Date.now() - lastConnectedAt < maxFreshMs) {
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

