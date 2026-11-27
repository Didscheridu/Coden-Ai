// js/auth.js – Firebase Authentication (Google & E-Mail) + Owner-Prüfung über /api/me
import {
  GoogleAuthProvider,
  GithubAuthProvider,
  linkWithPopup,
  reauthenticateWithPopup,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendEmailVerification,
  signOut,
  deleteUser,
  onAuthStateChanged as fbOnAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { fbAuth } from "./firebase.js";

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
  if (!fbUser) {
    auth.currentUser = null;
  } else {
    let isOwner = false;
    try {
      const res = await fetch('/api/me', {
        headers: { Authorization: `Bearer ${await fbUser.getIdToken()}` }
      });
      if (res.ok) isOwner = (await res.json()).isOwner === true;
    } catch (_) { /* offline: kein Owner */ }
    auth.currentUser = {
      uid: fbUser.uid,
      email: fbUser.email,
      emailVerified: !!fbUser.emailVerified,
      isOwner,
      getIdToken: (force) => fbUser.getIdToken(force)
    };
  }
  listeners.forEach(cb => cb(auth.currentUser));
}

let authSubscribed = false;
export function onAuthStateChanged(_auth, cb) {
  listeners.add(cb);
  if (!authSubscribed) {
    authSubscribed = true;
    fbOnAuthStateChanged(fbAuth, applyUser);
  } else if (auth.currentUser !== undefined) {
    // Falls bereits initialisiert, Listener direkt synchronisieren
    Promise.resolve().then(() => cb(auth.currentUser));
  }
}

export async function refreshAuth() {
  if (fbAuth.currentUser) {
    try { await fbAuth.currentUser.reload(); } catch (_) {}
  }
  await applyUser(fbAuth.currentUser);
}

export async function resendVerificationEmail() {
  if (!fbAuth.currentUser) throw new Error('Nicht eingeloggt.');
  try {
    await sendEmailVerification(fbAuth.currentUser);
    return true;
  } catch (e) {
    throw friendly(e);
  }
}

export const loginWithEmail = async (email, password) => {
  try { await signInWithEmailAndPassword(fbAuth, email, password); } catch (e) { throw friendly(e); }
};

export const registerWithEmail = async (email, password) => {
  try {
    const cred = await createUserWithEmailAndPassword(fbAuth, email, password);
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

export async function connectGithub() {
  const user = fbAuth.currentUser;
  if (!user) throw new Error('Bitte zuerst anmelden.');
  const provider = new GithubAuthProvider();
  provider.addScope('repo');
  let result;
  try {
    result = await linkWithPopup(user, provider);
  } catch (e) {
    if (e.code === 'auth/provider-already-linked') {
      try { result = await reauthenticateWithPopup(user, provider); } catch (e2) { throw friendly(e2); }
    } else if (e.code === 'auth/credential-already-in-use' || e.code === 'auth/email-already-in-use') {
      const cred = GithubAuthProvider.credentialFromError(e);
      if (cred?.accessToken) return { token: cred.accessToken };
      throw friendly(e);
    } else {
      throw friendly(e);
    }
  }
  const cred = GithubAuthProvider.credentialFromResult(result);
  if (!cred?.accessToken) throw new Error('GitHub hat keinen Zugriff geliefert.');
  return { token: cred.accessToken };
}

export async function deleteAccount() {
  const user = fbAuth.currentUser;
  if (!user) throw new Error('Nicht angemeldet.');
  try {
    await deleteUser(user);
    return true;
  } catch (e) {
    if (e.code === 'auth/requires-recent-login') {
      const err = new Error('Bitte melde dich kurz ab und erneut an, bevor du dein Login-Konto endgültig löschst.');
      err.code = e.code;
      throw err;
    }
    throw friendly(e);
  }
}
