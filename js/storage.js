// js/storage.js
import { db, auth } from './firebase-init.js';
import { doc, setDoc, getDoc } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

export const Storage = {
    getSessions: () => {
        const data = localStorage.getItem('coden_sessions');
        return data ? JSON.parse(data) : [];
    },
    
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
        return data ? JSON.parse(data) : { 
            persona: 'Standard', 
            customPersona: '', 
            fontSize: 15,
            // NEU: E-Mail Konfiguration
            emailConfig: { provider: 'gmail', address: '', password: '' }
        };
    },

    saveSettings: (settings) => {
        localStorage.setItem('coden_settings', JSON.stringify(settings));
        Storage.syncToCloud();
    },

    syncToCloud: async () => {
        if (!auth.currentUser) return; 
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
