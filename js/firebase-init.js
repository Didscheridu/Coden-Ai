// js/firebase-init.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

// Deine Firebase Konfiguration (Analytics/measurementId wurde für DSGVO entfernt!)
const firebaseConfig = {
  apiKey: "AIzaSyAXszFYN8ablxO9ywdMk3LjzGBZXVorVQI",
  authDomain: "coden-4561f.firebaseapp.com",
  projectId: "coden-4561f",
  storageBucket: "coden-4561f.firebasestorage.app",
  messagingSenderId: "291880469153",
  appId: "1:291880469153:web:d60f58eb21a21aa15e26e0"
};

// Firebase initialisieren
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Authentifizierungs-Methoden
const provider = new GoogleAuthProvider();

export const loginWithGoogle = () => signInWithPopup(auth, provider);
export const loginWithEmail = (email, password) => signInWithEmailAndPassword(auth, email, password);
export const registerWithEmail = (email, password) => createUserWithEmailAndPassword(auth, email, password);
export const logoutUser = () => signOut(auth);
export { onAuthStateChanged, auth, db };
