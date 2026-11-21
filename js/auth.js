// js/auth.js – Firebase wird NUR für das Login benutzt. Alle Daten liegen in Neon (über das eigene Backend).
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getAuth, GoogleAuthProvider, GithubAuthProvider, linkWithPopup, reauthenticateWithPopup, signInWithPopup, signInWithEmailAndPassword, createUserWithEmailAndPassword, sendEmailVerification, signOut, onAuthStateChanged as fbOnAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";

// Die Web-Config ist öffentlich und kein Geheimnis.
const firebaseConfig = {
  apiKey: "AIzaSyAXszFYN8ablxO9ywdMk3LjzGBZXVorVQI",
  authDomain: "coden-4561f.firebaseapp.com",
  projectId: "coden-4561f",
  storageBucket: "coden-4561f.firebasestorage.app",
  messagingSenderId: "291880469153",
  appId: "1:291880469153:web:d60f58eb21a21aa15e26e0"
};

const fbAuth = getAuth(initializeApp(firebaseConfig));
const googleProvider = new GoogleAuthProvider();

// Eigener Zustand: Firebase-Nutzer + serverseitig entschiedenes isOwner
export const auth = { currentUser: null };
const listeners = new Set();

const MESSAGES = {
  'auth/invalid-credential': 'Falsches Passwort oder E-Mail existiert nicht.',
  'auth/user-not-found': 'Kein Account mit dieser E-Mail gefunden.',
  'auth/wrong-password': 'Falsches Passwort.',
  'auth/too-many-requests': 'Zu viele Versuche. Bitte kurz warten.',
  'auth/email-already-in-use': 'Diese E-Mail ist bereits registriert!',
  'auth/weak-password': 'Das Passwort muss mind. 6 Zeichen lang sein!',
  'auth/invalid-email': 'Ungültige E-Mail-Adresse.',
  'auth/popup-closed-by-user': 'Anmeldung abgebrochen.',
  'auth/popup-blocked': 'Das Popup wurde blockiert. Bitte erlaube Popups für diese Seite.',
  'auth/operation-not-allowed': 'GitHub-Anmeldung ist in Firebase noch nicht aktiviert. Nutze stattdessen einen Token.',
  'auth/network-request-failed': 'Keine Verbindung. Bitte Internet prüfen.'
};
function friendly(err) {
  const e = new Error(MESSAGES[err.code] || err.message);
  e.code = err.code;
  return e;
}

async function applyUser(fbUser) {
  if (!fbUser) { auth.currentUser = null; }
  else {
    // Server prüft das Token und sagt, ob dieser Nutzer Owner ist
    let isOwner = false;
    try {
      const res = await fetch('/api/me', { headers: { Authorization: `Bearer ${await fbUser.getIdToken()}` } });
      if (res.ok) isOwner = (await res.json()).isOwner === true;
    } catch (e) { /* offline: kein Owner */ }
    auth.currentUser = { uid: fbUser.uid, email: fbUser.email, isOwner, getIdToken: (force) => fbUser.getIdToken(force) };
  }
  listeners.forEach(cb => cb(auth.currentUser));
}

export function onAuthStateChanged(_auth, cb) {
  listeners.add(cb);
  fbOnAuthStateChanged(fbAuth, applyUser);
}

// Nach abgelaufener Sitzung o. Ä. neu bewerten
export async function refreshAuth() { await applyUser(fbAuth.currentUser); }

export const loginWithEmail = async (email, password) => {
  try { await signInWithEmailAndPassword(fbAuth, email, password); } catch (e) { throw friendly(e); }
};

export const registerWithEmail = async (email, password) => {
  try {
    const cred = await createUserWithEmailAndPassword(fbAuth, email, password);
    // Bestätigungsmail (nötig, damit die Admin-Adresse als Owner gilt)
    sendEmailVerification(cred.user).catch(() => {});
  } catch (e) { throw friendly(e); }
};

export const logoutUser = async () => { await signOut(fbAuth); };

export async function initGoogleLogin(onError) {
  const btn = document.getElementById('btn-google-login');
  if (!btn) return;
  btn.style.display = '';
  btn.onclick = async () => {
    try { await signInWithPopup(fbAuth, googleProvider); } catch (e) { onError(friendly(e).message); }
  };
}

// GitHub verbinden (Firebase-Login bleibt bestehen). Liefert den GitHub-Zugriffstoken für die Coden-Funktionen "Speichern/Importieren".
// Dafür muss in der Firebase-Konsole der GitHub-Anbieter aktiviert sein.
export async function connectGithub() {
  const user = fbAuth.currentUser;
  if (!user) throw new Error('Bitte zuerst anmelden.');
  const provider = new GithubAuthProvider(); provider.addScope('repo');
  let result;
  try { result = await linkWithPopup(user, provider); }
  catch (e) {
    if (e.code === 'auth/provider-already-linked') { try { result = await reauthenticateWithPopup(user, provider); } catch (e2) { throw friendly(e2); } }
    else if (e.code === 'auth/credential-already-in-use' || e.code === 'auth/email-already-in-use') {
      const cred = GithubAuthProvider.credentialFromError(e);
      if (cred?.accessToken) return { token: cred.accessToken };
      throw friendly(e);
    } else throw friendly(e);
  }
  const cred = GithubAuthProvider.credentialFromResult(result);
  if (!cred?.accessToken) throw new Error('GitHub hat keinen Zugriff geliefert.');
  return { token: cred.accessToken };
}
