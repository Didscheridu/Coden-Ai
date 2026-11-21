// js/dom-safe.js – append/prepend/replaceChildren überspringen null, undefined und false und entpacken Listen.
// So kann UI-Code optionale Teile einfach als "bedingung ? element : null" übergeben, ohne dass "null" als Text erscheint.
for (const proto of [Element.prototype, DocumentFragment.prototype]) {
    for (const name of ['append', 'prepend', 'replaceChildren']) {
        const orig = proto[name];
        if (!orig || orig.__codenSafe) continue;
        const safe = function (...nodes) { return orig.apply(this, nodes.flat(Infinity).filter(n => n != null && n !== false)); };
        safe.__codenSafe = true;
        proto[name] = safe;
    }
}
