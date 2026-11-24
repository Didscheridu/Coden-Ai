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

export async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
    return true;
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
    return false;
  }
}

testConnection();
