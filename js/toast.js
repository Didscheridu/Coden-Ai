// js/toast.js – kleine Hinweise unten in der Mitte statt alert()
let box;
export function toast(msg, { type = 'info', ms = 3200, action } = {}) {
    if (!box) { box = document.createElement('div'); box.className = 'toasts'; box.setAttribute('role', 'status'); box.setAttribute('aria-live', 'polite'); document.body.appendChild(box); }
    const t = document.createElement('div'); t.className = 'toast ' + type;
    const ic = document.createElement('span'); ic.className = 'material-symbols-outlined'; ic.textContent = { info: 'info', ok: 'check_circle', error: 'error', warn: 'warning' }[type] || 'info';
    const tx = document.createElement('span'); tx.textContent = msg; t.append(ic, tx);
    if (action) { const b = document.createElement('button'); b.textContent = action.label; b.addEventListener('click', () => { action.run(); t.remove(); }); t.appendChild(b); }
    box.appendChild(t);
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, ms);
    return t;
}
