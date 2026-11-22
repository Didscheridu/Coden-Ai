// Aufklappbare Denk-Anzeige: zeigt nur die Überschrift des aktuellen Denk-Schritts.
// Beim Aufklappen steht ein kurzer Ausschnitt des aktuellen Schritts, ältere Schritte sind weg.
// Der Modellname steht daneben (kommt nur beim Owner vom Server).
export function createThinkPanel({ label = 'Coden denkt nach …' } = {}) {
    const el = document.createElement('details'); el.className = 'think-panel';
    const sum = document.createElement('summary');
    const dots = document.createElement('span'); dots.className = 'typing-dots'; dots.innerHTML = '<i></i><i></i><i></i>';
    const head = document.createElement('span'); head.className = 'think-head'; head.textContent = label;
    const model = document.createElement('span'); model.className = 'think-model'; model.hidden = true;
    const chev = document.createElement('span'); chev.className = 'material-symbols-outlined think-chev'; chev.textContent = 'expand_more';
    sum.append(dots, head, model, chev);
    const body = document.createElement('div'); body.className = 'think-body';
    el.append(sum, body);
    return {
        el,
        think(k) { if (!k) return; if (k.h) head.textContent = k.h; body.textContent = k.v || ''; el.classList.toggle('has-body', !!k.v); },
        model(name) { if (!name) return; model.textContent = name; model.hidden = false; },
        remove() { el.remove(); }
    };
}
