// js/skills.js – Skills wie bei Claude: Anleitungen für bestimmte Aufgaben, die Coden bei passenden Nachrichten automatisch lädt.
// Gespeichert in den Einstellungen (synchronisiert mit dem Konto). Import: Claude-Skills als .zip/.skill, SKILL.md, Text oder GitHub-Link.
// Die Logik (Lesen, Packen, Auswahl, Prompt) steckt in shared/skills-core.js und ist dort getestet.
import { Storage } from './storage.js';
import { toast } from './toast.js';
import { h, icon } from './apps/dom.js';
import { modal, confirmBox } from './apps/dialogs.js';
import * as M from './menu.js';

const S = () => window.CodenSkills;
const changed = () => document.dispatchEvent(new CustomEvent('skillsChanged'));
const picked = new Set(); // Skill-Ids, die der Nutzer für die nächste Nachricht gewählt hat
const SOURCE = { import: 'Importiert', vorlage: 'Vorlage', coden: 'Von Coden', eigen: 'Eigener' };
const openSettings = () => window.dispatchEvent(new CustomEvent('coden:settings', { detail: { tab: 'skills' } }));

async function inflateRaw(u8) {
    if (typeof DecompressionStream === 'undefined') throw new Error('Dieser Browser kann keine ZIP-Dateien entpacken. Öffne die SKILL.md und füge den Text ein.');
    const stream = new Blob([u8]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
}
function download(name, bytes, type) {
    const url = URL.createObjectURL(new Blob([bytes], { type }));
    const a = h('a', { href: url, download: name }); document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export const Skills = {
    list: () => S().skills(Storage.getSettings()),
    get(k) { return k ? S().findSkill(this.list(), k) : null; },
    save(raw) {
        const r = S().upsertSkill(this.list(), raw);
        if (r.error) return r;
        const s = Storage.getSettings(); s.skills = r.list; Storage.saveSettings(s); changed();
        return r;
    },
    remove(id) { const s = Storage.getSettings(); s.skills = S().removeSkill(this.list(), id); Storage.saveSettings(s); picked.delete(id); changed(); },
    toggle(id, on) { const s = Storage.getSettings(); s.skills = S().toggleSkill(this.list(), id, on); Storage.saveSettings(s); changed(); },

    // ---------- Im Chat ----------
    picked: () => [...picked],
    pick(id, on = true) { on ? picked.add(id) : picked.delete(id); document.dispatchEvent(new CustomEvent('skillsPicked')); },
    clearPicked() { picked.clear(); document.dispatchEvent(new CustomEvent('skillsPicked')); },
    // Prompt-Block für eine Nachricht: { text, loaded }
    forMessage(text, extra = []) { return S().skillsPrompt(this.list(), { text, picked: [...picked, ...extra] }); },
    parseSlash(text) { return S().parseSlash(text, this.list()); },
    slashMatches(q) { return S().slashMatches(this.list(), q); },
    requested: (t) => S().requested(t),
    loadedMessage(names) { return S().loadedMessage(this.list(), names); },
    hide: (t) => S().display(t),
    strip: (t) => S().stripRequests(t),
    draft: (t) => S().extractDraft(t),
    // Entwurf aus einer Antwort speichern (fragt nach)
    async offerDraft(d) {
        if (!d) return;
        const exists = this.get(d.skill.name);
        const ok = await confirmBox(exists ? `Coden hat den Skill „${d.skill.name}“ überarbeitet. Den vorhandenen Skill damit ersetzen?` : `Coden hat den Skill „${d.skill.name}“ entworfen. Jetzt speichern? Du kannst ihn danach in den Einstellungen bearbeiten.`, { ok: exists ? 'Ersetzen' : 'Skill speichern', title: 'Neuer Skill von Coden' });
        if (!ok) return;
        const r = this.save({ ...d.skill, id: exists?.id });
        if (r.error) toast(r.error, { type: 'warn', ms: 6000 });
        else toast(`Skill „${r.skill.name}“ gespeichert`, { type: 'ok', action: { label: 'Ansehen', run: openSettings } });
    },

    // ---------- Untermenü „+ → Skills“ ----------
    fillMenu(panel) {
        const list = this.list().filter(s => s.on);
        if (!list.length) panel.append(M.note('Noch keine Skills. Importiere einen Claude-Skill oder nimm eine Vorlage.'));
        else {
            panel.append(M.group('Für die nächste Nachricht nutzen'));
            for (const s of list) panel.append(M.item({ icon: 'auto_awesome', label: s.name, title: s.desc, checked: picked.has(s.id), keep: true, onClick: (e, b) => { this.pick(s.id, !picked.has(s.id)); M.setChecked(b, picked.has(s.id)); } }));
        }
        panel.append(M.sep(),
            M.item({ icon: 'upload', label: 'Skill importieren', onClick: () => this.openImport() }),
            M.item({ icon: 'tune', label: 'Skills verwalten', onClick: openSettings }));
    },
    // Gewählte Skills als Pillen über dem Eingabefeld
    mountPicked(input) {
        const bar = h('div', { class: 'sk-picked hidden', id: 'sk-picked' });
        input.before(bar);
        const draw = () => {
            const all = this.list();
            for (const id of [...picked]) if (!all.some(s => s.id === id)) picked.delete(id);
            bar.replaceChildren(...[...picked].map(id => { const s = all.find(x => x.id === id); return h('span', { class: 'sk-pill', title: s.desc }, icon('auto_awesome'), s.name, h('button', { type: 'button', 'aria-label': `Skill ${s.name} entfernen`, onclick: () => this.pick(id, false) }, '×')); }));
            bar.classList.toggle('hidden', !picked.size);
        };
        document.addEventListener('skillsPicked', draw); document.addEventListener('skillsChanged', draw); draw();
    },

    // ---------- „Einen Skill erstellen“ ----------
    openCreate() {
        let m;
        const pick = (ic, title, text, fn) => h('button', { type: 'button', class: 'sk-choice', onclick: () => { m.close(); fn(); } }, icon(ic), h('span', {}, h('b', { text: title }), h('small', { text })));
        m = modal('Einen Skill erstellen', h('div', { class: 'sk-choices' },
            pick('chat', 'Mit Coden im Chat', 'Beschreibe, was der Skill können soll. Coden schreibt die SKILL.md und du speicherst sie mit einem Klick.', () => document.dispatchEvent(new CustomEvent('coden:compose', { detail: { text: 'Ich möchte einen neuen Skill erstellen. Er soll ' } }))),
            pick('edit_note', 'Selbst schreiben', 'Name, Beschreibung und Anweisungen im Editor eingeben.', () => { openSettings(); setTimeout(() => this.renderEditor(document.getElementById('skills-ui'), {}, () => this.renderSettings()), 60); }),
            pick('upload', 'Claude-Skill importieren', '.zip, .skill, SKILL.md, Text oder GitHub-Link.', () => this.openImport())));
    },

    // ---------- Import ----------
    openImport() {
        let m;
        const err = h('div', { class: 'cd-err' });
        const busy = (on, b) => { if (b) { b.disabled = on; b.classList.toggle('busy', on); } };
        const fileIn = h('input', { type: 'file', accept: '.zip,.skill,.md,.markdown,.txt', hidden: true });
        const drop = h('button', { type: 'button', class: 'sk-drop', onclick: () => fileIn.click() }, icon('upload_file'), h('b', { text: 'Datei wählen oder hierher ziehen' }), h('small', { text: '.zip oder .skill (aus Claude heruntergeladen) oder SKILL.md' }));
        const takeFile = async (f) => { if (!f) return; err.textContent = ''; drop.classList.add('busy'); try { const r = await this.readFile(f); if (r) { m.close(); await this.confirmImport(r); } } catch (e) { err.textContent = e.message; } finally { drop.classList.remove('busy'); } };
        fileIn.addEventListener('change', () => takeFile(fileIn.files[0]));
        drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
        drop.addEventListener('dragleave', () => drop.classList.remove('over'));
        drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); takeFile(e.dataTransfer.files[0]); });
        const url = h('input', { class: 'cd-input', placeholder: 'https://github.com/anthropics/skills/tree/main/skills/pdf' });
        const gh = h('button', { type: 'button', class: 'cd-btn', onclick: async () => { err.textContent = ''; busy(true, gh); try { const r = await this.readGithub(url.value); if (r) { m.close(); await this.confirmImport(r); } } catch (e) { err.textContent = e.message; } finally { busy(false, gh); } } }, icon('download'), ' Laden');
        url.addEventListener('keydown', (e) => { if (e.key === 'Enter') gh.click(); });
        const ta = h('textarea', { class: 'cd-input sk-paste', rows: 6, placeholder: '---\nname: mein-skill\ndescription: Wofür der Skill da ist und wann Coden ihn nutzen soll\n---\n\n# Anleitung\n…' });
        const paste = h('button', { type: 'button', class: 'cd-btn', onclick: async () => { err.textContent = ''; const r = S().fromFiles([{ path: 'SKILL.md', text: ta.value }], { from: 'eingefügt' }); if (r.error) { err.textContent = r.error; return; } m.close(); await this.confirmImport(r); } }, icon('content_paste'), ' Übernehmen');
        m = modal('Skill importieren', h('div', { class: 'sk-import' },
            drop, fileIn,
            h('label', { class: 'cd-label', text: 'Oder von GitHub (Ordner mit SKILL.md)' }), h('div', { class: 'sk-row' }, url, gh),
            h('label', { class: 'cd-label', text: 'Oder SKILL.md einfügen' }), ta, h('div', { class: 'cd-row end' }, paste),
            err,
            h('p', { class: 'sk-hint', text: 'Claude-Skills funktionieren in Coden als Anleitungen. Skripte darin führt Coden nicht aus, er kann sie aber lesen und im Chat verwenden.' })), { wide: true });
    },
    async readFile(f) {
        if (f.size > 10 * 1024 * 1024) throw new Error('Die Datei ist zu groß (höchstens 10 MB).');
        if (/\.(zip|skill)$/i.test(f.name)) return S().fromZip(new Uint8Array(await f.arrayBuffer()), inflateRaw, { from: f.name });
        if (/\.(md|markdown|txt)$/i.test(f.name)) return S().fromFiles([{ path: /skill\.md$/i.test(f.name) ? 'SKILL.md' : f.name, text: await f.text() }], { from: f.name });
        throw new Error('Bitte eine .zip-, .skill- oder .md-Datei wählen.');
    },
    async readGithub(link) {
        const t = S().githubTarget(link);
        if (!t) throw new Error('Das ist kein GitHub-Link. Beispiel: https://github.com/anthropics/skills/tree/main/skills/pdf');
        const getJson = async (u) => { const r = await fetch(u, { headers: { Accept: 'application/vnd.github+json' } }); if (r.status === 404) throw new Error('Nicht gefunden. Ist das Repository öffentlich?'); if (r.status === 403) throw new Error('GitHub-Limit erreicht. Versuche es in einer Stunde noch einmal oder lade den Ordner als ZIP herunter.'); if (!r.ok) throw new Error('GitHub antwortet nicht (' + r.status + ').'); return r.json(); };
        const getText = async (u) => { const r = await fetch(u); if (!r.ok) throw new Error('Datei konnte nicht geladen werden (' + r.status + ').'); return r.text(); };
        if (t.kind === 'file' && !/(^|\/)skill\.md$/i.test(t.path)) return S().fromFiles([{ path: t.path.split('/').pop(), text: await getText(S().rawUrl(t, t.path)) }], { from: link });
        const dir = t.kind === 'file' ? t.path.split('/').slice(0, -1).join('/') : t.path;
        const api = (p) => `https://api.github.com/repos/${t.owner}/${t.repo}/contents/${p.split('/').map(encodeURIComponent).join('/')}${t.ref ? '?ref=' + encodeURIComponent(t.ref) : ''}`;
        const top = await getJson(api(dir));
        if (!Array.isArray(top)) throw new Error('Das ist keine Datei und kein Ordner mit SKILL.md.');
        if (!top.some(x => x.type === 'file' && /^skill\.md$/i.test(x.name))) {
            // Ordner mit mehreren Skills (z. B. anthropics/skills): auswählen lassen
            const dirs = top.filter(x => x.type === 'dir' && !x.name.startsWith('.'));
            if (!dirs.length) throw new Error('In diesem Ordner liegt keine SKILL.md.');
            const choice = await new Promise((res) => {
                let done = false; const fin = (v) => { if (done) return; done = true; mm.close(); res(v); };
                const mm = modal('Welchen Skill importieren?', h('div', { class: 'sk-dirs' }, dirs.slice(0, 60).map(d => h('button', { type: 'button', class: 'cm-item', onclick: () => fin(d.path) }, icon('folder', 'cm-ic'), h('span', { class: 'cm-label', text: d.name })))), { onClose: () => fin(null) });
            });
            if (!choice) return null;
            return this.readGithub(`https://github.com/${t.owner}/${t.repo}/tree/${t.ref || 'HEAD'}/${choice}`);
        }
        const files = []; let count = 0;
        const walk = async (items, depth) => {
            for (const x of items) {
                if (count >= 40) return;
                if (x.type === 'file' && (/^skill\.md$/i.test(x.name) || S().isTextPath(x.name)) && x.size <= 200000) { count++; files.push({ path: x.path.slice(dir ? dir.length + 1 : 0), text: await getText(x.download_url) }); }
                else if (x.type === 'dir' && depth < 3 && !x.name.startsWith('.') && x.name !== 'node_modules') await walk(await getJson(api(x.path)), depth + 1);
            }
        };
        await walk(top, 0);
        return S().fromFiles(files, { from: link });
    },
    async confirmImport(r) {
        if (!r) return;
        if (r.error) { toast(r.error, { type: 'error', ms: 6000 }); return; }
        const sk = r.skill; const exists = this.get(sk.name);
        const body = h('div', { class: 'sk-preview' },
            h('div', { class: 'sk-pv-name' }, icon('auto_awesome'), h('b', { text: sk.name })),
            h('p', { class: 'cd-text', text: sk.desc || '(ohne Beschreibung – bitte nach dem Import ergänzen)' }),
            h('div', { class: 'sk-pv-meta', text: `${sk.instructions.length.toLocaleString('de-DE')} Zeichen Anleitung · ${sk.files.length} Zusatzdatei${sk.files.length === 1 ? '' : 'en'}` }),
            sk.files.length ? h('div', { class: 'sk-pv-files' }, sk.files.map(f => h('span', { text: f.path }))) : null,
            r.skipped?.length ? h('div', { class: 'sk-pv-skip', text: `Nicht übernommen (Bilder, Programme oder zu groß): ${r.skipped.slice(0, 8).join(', ')}${r.skipped.length > 8 ? ' …' : ''}` }) : null,
            exists ? h('div', { class: 'sk-pv-skip', text: `Es gibt schon einen Skill „${sk.name}“. Er wird ersetzt.` }) : null);
        const res = await new Promise((resolve) => {
            let done = false; const fin = (v) => { if (done) return; done = true; m.close(); resolve(v); };
            const m = modal('Skill importieren?', h('div', {}, body, h('div', { class: 'cd-row end' }, h('button', { class: 'cd-btn', text: 'Abbrechen', onclick: () => fin(false) }), h('button', { class: 'cd-primary', text: exists ? 'Ersetzen' : 'Importieren', onclick: () => fin(true) }))), { onClose: () => fin(false) });
        });
        if (!res) return;
        let desc = sk.desc;
        if (desc.length < 10) desc = (desc + ' ' + `Skill „${sk.name}“ (importiert).`).trim();
        const out = this.save({ ...sk, desc, id: exists?.id });
        if (out.error) { toast(out.error, { type: 'error', ms: 7000 }); return; }
        toast(`Skill „${out.skill.name}“ importiert`, { type: 'ok' });
        this.renderSettings();
    },
    exportSkill(s) {
        download(`${s.name}.zip`, S().zip(S().exportFiles(s)), 'application/zip');
        toast('Als ZIP gespeichert. In Claude: Einstellungen → Fähigkeiten → Skill hochladen.', { type: 'ok', ms: 5000 });
    },

    // ---------- Einstellungen ----------
    renderSettings(host = document.getElementById('skills-ui')) {
        if (!host) return;
        const draw = () => {
            const list = this.list(); const used = S().totalSize(list);
            const names = new Set(list.map(s => s.name));
            const free = S().TEMPLATES.filter(t => !names.has(t.name));
            const edit = (s) => this.renderEditor(host, s, draw);
            const card = (s) => {
                const sw = h('input', { type: 'checkbox', class: 'sk-switch', 'aria-label': `Skill ${s.name} ${s.on ? 'ausschalten' : 'einschalten'}`, title: s.on ? 'Eingeschaltet: Coden nutzt ihn automatisch' : 'Ausgeschaltet' });
                sw.checked = s.on; sw.addEventListener('change', () => { this.toggle(s.id, sw.checked); draw(); });
                return h('div', { class: 'sk-card' + (s.on ? '' : ' off') },
                    h('div', { class: 'sk-info' },
                        h('div', { class: 'sk-top' }, h('b', { class: 'sk-name', text: s.name }), h('span', { class: 'sk-src', text: SOURCE[s.source] || '' }), s.files.length ? h('span', { class: 'sk-src', text: `${s.files.length} Datei${s.files.length === 1 ? '' : 'en'}` }) : null),
                        h('small', { text: s.desc })),
                    h('div', { class: 'sk-btns' },
                        h('button', { type: 'button', class: 'cd-x', title: 'Bearbeiten', 'aria-label': 'Bearbeiten', onclick: () => edit(s) }, icon('edit')),
                        h('button', { type: 'button', class: 'cd-x', title: 'Als ZIP exportieren (für Claude)', 'aria-label': 'Exportieren', onclick: () => this.exportSkill(s) }, icon('download')),
                        h('button', { type: 'button', class: 'cd-x', title: 'Löschen', 'aria-label': 'Löschen', onclick: async () => { if (await confirmBox(`Skill „${s.name}“ löschen?`, { ok: 'Löschen', danger: true })) { this.remove(s.id); draw(); } } }, icon('delete')),
                        sw));
            };
            host.replaceChildren(
                h('div', { class: 'sk-head' },
                    h('span', { class: 'sk-count', text: `${list.length} von ${S().SK.max} · ${Math.round(used / S().SK.total * 100)} % Speicher` }),
                    h('button', { type: 'button', class: 'cd-btn', onclick: () => this.openImport() }, icon('upload'), ' Importieren'),
                    h('button', { type: 'button', class: 'cd-primary', onclick: () => edit({}) }, icon('add'), ' Neuer Skill')),
                list.length ? h('div', { class: 'sk-list' }, list.map(card)) :
                    h('div', { class: 'sk-empty' }, icon('auto_awesome'), h('p', { text: 'Noch keine Skills. Ein Skill ist eine Anleitung für eine bestimmte Aufgabe, zum Beispiel „Lernzettel erstellen“ oder „Commit-Nachrichten schreiben“. Coden nutzt ihn automatisch, wenn er passt.' })),
                free.length ? h('div', { class: 'sk-tpl' }, h('h5', { text: 'Vorlagen' }), h('div', { class: 'sk-chips' }, free.map(t => h('button', { type: 'button', class: 'as-chip', title: t.desc, onclick: () => { const r = this.save({ ...t, source: 'vorlage' }); if (r.error) toast(r.error, { type: 'warn' }); else { toast(`„${t.name}“ hinzugefügt`, { type: 'ok' }); draw(); } } }, icon('add'), ' ' + t.name)))) : null);
        };
        draw();
    },
    renderEditor(host, s, back) {
        if (!host) return;
        const isNew = !s.id; const SK = S().SK;
        let files = (s.files || []).map(f => ({ ...f }));
        const name = h('input', { class: 'cd-input sk-mono', value: s.name || '', maxlength: SK.name, placeholder: 'z. B. lernzettel', autocomplete: 'off', spellcheck: 'false' });
        const slugHint = h('small', { class: 'sk-chars' });
        const updSlug = () => { const v = S().slug(name.value); slugHint.textContent = v ? `Aufruf im Chat: /${v}` : 'Kleinbuchstaben, Ziffern und Bindestriche'; };
        name.addEventListener('input', updSlug); updSlug();
        const desc = h('textarea', { class: 'cd-input', rows: 3, maxlength: SK.desc, placeholder: 'Wofür ist der Skill da und wann soll Coden ihn nutzen? Coden entscheidet anhand dieser Beschreibung, ob er den Skill lädt.' }); desc.value = s.desc || '';
        const ins = h('textarea', { class: 'cd-input sk-ins sk-mono', rows: 14, maxlength: SK.instr, placeholder: '# Anleitung\n\n1. Erster Schritt …\n2. …', spellcheck: 'false' }); ins.value = s.instructions || '';
        const count = h('small', { class: 'sk-chars' });
        const upd = () => { count.textContent = `${ins.value.length.toLocaleString('de-DE')} / ${SK.instr.toLocaleString('de-DE')}`; }; ins.addEventListener('input', upd); upd();
        const fileList = h('div', { class: 'sk-files' });
        const addIn = h('input', { type: 'file', multiple: true, hidden: true });
        const drawFiles = () => fileList.replaceChildren(...files.map((f, i) => h('div', { class: 'sk-file' }, icon('description'), h('span', { class: 'sk-mono', text: f.path }), h('small', { text: `${f.text.length.toLocaleString('de-DE')} Zeichen` }), h('button', { type: 'button', class: 'cd-x', 'aria-label': 'Datei entfernen', onclick: () => { files.splice(i, 1); drawFiles(); } }, icon('close')))));
        addIn.addEventListener('change', async () => { for (const f of addIn.files) { if (!S().isTextPath(f.name)) { toast(`${f.name}: nur Textdateien (z. B. .md, .py, .json)`, { type: 'warn' }); continue; } if (f.size > SK.fileLen * 2) { toast(`${f.name} ist zu groß`, { type: 'warn' }); continue; } files = [...files.filter(x => x.path !== f.name), { path: f.name, text: await f.text() }]; } addIn.value = ''; drawFiles(); });
        drawFiles();
        const on = h('input', { type: 'checkbox' }); on.checked = s.on !== false;
        const err = h('div', { class: 'cd-err' });
        const ok = h('button', { type: 'button', class: 'cd-primary', onclick: () => {
            const r = this.save({ ...s, id: s.id, name: name.value, desc: desc.value, instructions: ins.value, files, on: on.checked, source: s.source || 'eigen' });
            if (r.error) { err.textContent = r.error; return; }
            toast(isNew ? 'Skill angelegt' : 'Gespeichert', { type: 'ok' }); back();
        } }, icon('save'), ' Speichern');
        host.replaceChildren(h('div', { class: 'sk-edit' },
            h('h5', { text: isNew ? 'Neuer Skill' : `Skill „${s.name}“ bearbeiten` }),
            h('label', { class: 'cd-label', text: 'Name' }), name, slugHint,
            h('label', { class: 'cd-label', text: 'Beschreibung' }), desc,
            h('label', { class: 'cd-label', text: 'Anweisungen (Inhalt der SKILL.md, Markdown)' }), ins, count,
            h('div', { class: 'sk-files-head' }, h('label', { class: 'cd-label', text: 'Zusatzdateien (optional, z. B. Beispiele oder Vorlagen)' }), h('button', { type: 'button', class: 'cd-btn', onclick: () => addIn.click() }, icon('attach_file'), ' Datei hinzufügen')), fileList, addIn,
            h('label', { class: 'st-check' }, on, ' Eingeschaltet (Coden nutzt den Skill automatisch, wenn er passt)'),
            err,
            h('div', { class: 'cd-row end' }, h('button', { type: 'button', class: 'cd-btn', onclick: back }, 'Abbrechen'), ok)));
        name.focus();
    }
};
