// js/storage.js
import { auth } from './auth.js';
import { apiJson } from './backend.js';

// Diese Felder bleiben nur lokal im Browser und werden nie zum Server synchronisiert.
const LOCAL_ONLY = (s) => ({ emailPassword: s?.emailConfig?.password || '' });

let syncTimer = null;

export const Storage = {
    getSessions: () => {
        const data = localStorage.getItem('coden_sessions');
        return data ? JSON.parse(data) : [];
    },

    saveSessions: (sessions) => {
        localStorage.setItem('coden_sessions', JSON.stringify(sessions));
        Storage.syncToCloud();
    },

    createNewSession: () => ({ id: Date.now().toString(), title: 'Neuer Projekt-Chat', messages: [] }),

    getSettings: () => {
        const data = localStorage.getItem('coden_settings');
        return data ? JSON.parse(data) : {
            persona: 'Standard', customPersona: '', fontSize: 15,
            emailConfig: { provider: 'gmail', address: '', password: '' }
        };
    },

    saveSettings: (settings) => {
        localStorage.setItem('coden_settings', JSON.stringify(settings));
        Storage.syncToCloud();
    },

    // gebündelt (Debounce), damit nicht bei jedem Tastendruck ein Request rausgeht
    syncToCloud: () => {
        if (!auth.currentUser) return;
        clearTimeout(syncTimer);
        syncTimer = setTimeout(async () => {
            try {
                await apiJson('/data', { method: 'PUT', body: JSON.stringify({ sessions: Storage.getSessions(), settings: Storage.getSettings() }) });
            } catch (e) { console.error('Cloud Sync Error:', e); }
        }, 1500);
    },

    loadFromCloud: async () => {
        if (!auth.currentUser) return false;
        try {
            const data = await apiJson('/data');
            if (!data.exists) return false;
            const localPw = LOCAL_ONLY(Storage.getSettings()).emailPassword;
            if (data.sessions) localStorage.setItem('coden_sessions', JSON.stringify(data.sessions));
            if (data.settings) {
                const s = data.settings;
                if (s.emailConfig) s.emailConfig.password = localPw; // lokales Passwort behalten
                localStorage.setItem('coden_settings', JSON.stringify(s));
            }
            return true;
        } catch (e) {
            console.error('Cloud Load Error:', e);
        }
        return false;
    }
};
