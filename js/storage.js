// js/storage.js
import { db, auth } from './firebase-init.js';
import { doc, setDoc, getDoc } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

export const Storage = {
    // Holt Daten aus dem lokalen Speicher (Für schnelles Laden)
    getSessions: () => {
        const data = localStorage.getItem('coden_sessions');
        return data ? JSON.parse(data) : [];
    },
    
    // Speichert lokal UND synchronisiert sofort in die Cloud
    saveSessions: (sessions) => {
        localStorage.setItem('coden_sessions', JSON.stringify(sessions));
        Storage.syncToCloud(); 
    },

    createNewSession: () => {
        return {
            id: Date.now().toString(),
            title: 'Neuer Projekt-Chat',
            messages: [] 
        };
    },

    getSettings: () => {
        const data = localStorage.getItem('coden_settings');
        return data ? JSON.parse(data) : { persona: 'Standard', customPersona: '', fontSize: 15 };
    },

    saveSettings: (settings) => {
        localStorage.setItem('coden_settings', JSON.stringify(settings));
        Storage.syncToCloud();
    },

    // --- NEU: CLOUD SYNC LOGIK ---

    // Schiebt alles in die Firestore Datenbank
    syncToCloud: async () => {
        if (!auth.currentUser) return; // Wenn nicht eingeloggt, abbrechen
        try {
            const sessions = Storage.getSessions();
            const settings = Storage.getSettings();
            await setDoc(doc(db, "users", auth.currentUser.uid), {
                sessions: sessions,
                settings: settings,
                lastUpdated: Date.now()
            }, { merge: true });
        } catch (e) {
            console.error("Cloud Sync Error:", e);
        }
    },

    // Lädt alles aus der Firestore Datenbank herunter (Beim Login)
    loadFromCloud: async () => {
        if (!auth.currentUser) return false;
        try {
            const docSnap = await getDoc(doc(db, "users", auth.currentUser.uid));
            if (docSnap.exists()) {
                const data = docSnap.data();
                if (data.sessions) localStorage.setItem('coden_sessions', JSON.stringify(data.sessions));
                if (data.settings) localStorage.setItem('coden_settings', JSON.stringify(data.settings));
                return true;
            }
        } catch (e) {
            console.error("Cloud Load Error:", e);
        }
        return false;
    }
};