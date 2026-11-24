// js/websearch.js – Websuche im normalen Chat (wie bei Claude): Coden entscheidet selbst, wann er sucht.
// Das Modell antwortet mit <web_search>Suchanfrage</web_search>, app.js holt die Treffer über /api/research/search,
// schickt sie nummeriert zurück und macht aus [1] in der Antwort Quellen-Chips. Logik in shared/research-core.js.
import { Storage } from './storage.js';
import { apiJson } from './backend.js';
import * as Menu from './menu.js';

const R = () => window.CodenResearch;
const today = () => new Intl.DateTimeFormat('de-DE', { dateStyle: 'full' }).format(new Date());

export const WebSearch = {
    enabled: () => Storage.getSettings().webSearch !== false,
    set(on) { const s = Storage.getSettings(); s.webSearch = !!on; Storage.saveSettings(s); this.sync(); },
    sync() { const b = document.getElementById('ct-web'); if (b) Menu.setChecked(b, this.enabled()); },
    mount() {
        const b = document.getElementById('ct-web'); if (!b) return;
        b.addEventListener('click', () => this.set(!this.enabled()));
        this.sync();
    },
    prompt() {
        if (!this.enabled()) return '';
        return `\nWEBSUCHE: Du kannst im Internet suchen. Heute ist ${today()}.\n` +
            'Braucht die Frage aktuelle oder genaue Fakten, die sich ändern können (Nachrichten, Sport, Wetter, Preise, Kurse, neue Versionen, wer gerade ein Amt hat, Termine, Öffnungszeiten, Produkte), oder bist du dir nicht sicher, dann antworte NUR mit <web_search>kurze Suchanfrage</web_search> (2 bis 6 Wörter, ohne weiteren Text). ' +
            'Du bekommst nummerierte Ergebnisse und antwortest danach mit Belegen wie [1]. Für Allgemeinwissen, Mathe, Code, Texte schreiben oder Plaudern suchst du NICHT.\n';
    },
    requested: (t) => R().requestedSearch(t),
    strip: (t) => R().stripSearch(t),
    async search(q) { return apiJson('/research/search', { method: 'POST', body: JSON.stringify({ q }) }); },
    block: (q, sources) => R().searchBlock(q, sources),
    cite: (t, sources) => R().citeChips(t, sources),
    lines: (sources) => R().sourceLines(sources)
};
