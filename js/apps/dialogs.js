// js/apps/dialogs.js – Fenster im App-Builder: Auf dem Handy testen (QR, Installieren, APK), Veröffentlichen, Einladen, Bestätigen
import { apiJson } from '../backend.js';
import { toast } from '../toast.js';
import { Router } from '../router.js';
import { h, icon, copy, qrSvg } from './dom.js';

export function modal(title, body, { wide = false, onClose } = {}) {
    const close = () => { ov.classList.add('out'); setTimeout(() => ov.remove(), 180); document.removeEventListener('keydown', esc); onClose?.(); };
    const esc = (e) => { if (e.key === 'Escape') close(); };
    const ov = h('div', { class: 'cd-overlay', onclick: (e) => { if (e.target === ov) close(); } },
        h('div', { class: 'cd-modal' + (wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
            h('div', { class: 'cd-head' }, h('h3', { text: title }), h('button', { class: 'cd-x', title: 'Schließen', onclick: close }, icon('close'))),
            h('div', { class: 'cd-body' }, body)));
    document.body.appendChild(ov); document.addEventListener('keydown', esc);
    setTimeout(() => ov.querySelector('input, button.cd-primary')?.focus(), 50);
    return { close, el: ov };
}

export function confirmBox(text, { ok = 'OK', danger = false } = {}) {
    return new Promise((resolve) => {
        let done = false; const fin = (v) => { if (done) return; done = true; m.close(); resolve(v); };
        const m = modal('Bist du sicher?', h('div', {}, h('p', { class: 'cd-text', text: text }),
            h('div', { class: 'cd-row end' }, h('button', { class: 'cd-btn', text: 'Abbrechen', onclick: () => fin(false) }), h('button', { class: 'cd-primary' + (danger ? ' danger' : ''), text: ok, onclick: () => fin(true) }))), { onClose: () => fin(false) });
    });
}

export function promptBox(title, { label = '', value = '', placeholder = '', ok = 'OK' } = {}) {
    return new Promise((resolve) => {
        let done = false; const fin = (v) => { if (done) return; done = true; m.close(); resolve(v); };
        const inp = h('input', { class: 'cd-input', value, placeholder });
        inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') fin(inp.value.trim() || null); });
        const m = modal(title, h('div', {}, label ? h('label', { class: 'cd-label', text: label }) : null, inp,
            h('div', { class: 'cd-row end' }, h('button', { class: 'cd-btn', text: 'Abbrechen', onclick: () => fin(null) }), h('button', { class: 'cd-primary', text: ok, onclick: () => fin(inp.value.trim() || null) }))), { onClose: () => fin(null) });
        setTimeout(() => { inp.focus(); inp.select(); }, 60);
    });
}

const linkRow = (url) => h('div', { class: 'cd-link' }, h('input', { class: 'cd-input', value: url, readonly: true, onfocus: (e) => e.target.select() }),
    h('button', { class: 'cd-btn', title: 'Kopieren', onclick: async (e) => { if (await copy(url)) { toast('Link kopiert', { type: 'ok' }); } } }, icon('content_copy')),
    h('a', { class: 'cd-btn', href: url, target: '_blank', rel: 'noopener', title: 'Öffnen' }, icon('open_in_new')));

// ---------- Auf dem Handy testen ----------
export function phoneTest(ctx) {
    const { app } = ctx; const isAndroid = ['android', 'both'].includes(app.kind); const isMobile = app.kind !== 'web';
    const apkBox = h('div', { class: 'cd-apk' });
    let timer = 0;
    const body = h('div', { class: 'cd-phone' },
        h('div', { class: 'cd-phone-grid' },
            h('div', { class: 'cd-qr-card' }, qrSvg(app.testUrl), h('small', { text: 'Mit der Handy-Kamera scannen' })),
            h('div', { class: 'cd-steps' },
                h('p', { class: 'cd-text' }, 'Deine App läuft sofort auf dem Handy – ', h('b', { text: 'jede Änderung in Coden erscheint dort live.' })),
                h('ol', {},
                    h('li', {}, 'QR-Code scannen oder Link aufs Handy schicken.'),
                    isMobile ? h('li', {}, h('b', { text: 'Android: ' }), 'Chrome-Menü ⋮ → „App installieren“. ', h('b', { text: 'iPhone: ' }), 'Safari → Teilen → „Zum Home-Bildschirm“.') : h('li', { text: 'Auf jedem Gerät im Browser öffnen.' }),
                    h('li', { text: 'Die App startet dann wie eine echte App vom Homescreen, im Vollbild und mit eigenem Symbol.' })),
                linkRow(app.testUrl),
                h('small', { class: 'cd-hint' }, icon('lock'), ' Der Testlink ist geheim: nur wer ihn hat, sieht die App. Öffentlich wird sie erst mit „Veröffentlichen“.'))),
        isAndroid ? h('div', { class: 'cd-sec' }, h('h4', {}, icon('android'), ' Android-APK'), apkBox) : null,
        h('details', { class: 'cd-more' }, h('summary', { text: 'Im Emulator testen' }),
            h('p', { class: 'cd-text', text: 'Die Vorschau in Coden ist schon ein Handy-Emulator (iPhone- und Android-Rahmen). Für einen echten Android-Emulator: Android Studio → Device Manager → Gerät starten, dann den Testlink im Chrome des Emulators öffnen' + (isAndroid ? ' oder die APK per Drag & Drop auf den Emulator ziehen (oder: adb install app.apk).' : '.') })));
    const drawApk = async (startBuild) => {
        let r;
        try { r = startBuild ? await apiJson(`/apps/${app.id}/apk`, { method: 'POST', body: '{}' }) : await apiJson(`/apps/${app.id}/apk`); }
        catch (e) {
            if (e.code === 'NOT_PUBLISHED') { apkBox.replaceChildren(h('p', { class: 'cd-text', text: 'Die APK öffnet die öffentliche Coden-Adresse deiner App. Veröffentliche sie zuerst, dann kann die APK gebaut werden.' }), h('button', { class: 'cd-primary', onclick: () => { m.close(); ctx.openPublish({ thenApk: true }); } }, icon('public'), ' Veröffentlichen und APK bauen')); return; }
            if (e.code === 'APK_NOT_CONFIGURED') { apkBox.replaceChildren(h('p', { class: 'cd-text', text: 'Der APK-Bau ist auf diesem Coden-Server noch nicht eingerichtet. Bis dahin: Testlink öffnen und „App installieren“ – das erzeugt auf Android auch eine echte installierte App.' })); return; }
            apkBox.replaceChildren(h('p', { class: 'cd-err', text: e.message })); return;
        }
        const s = r.apk;
        if (r.configured === false && s.status === 'none') { apkBox.replaceChildren(h('p', { class: 'cd-text', text: 'Der APK-Bau ist auf diesem Coden-Server noch nicht eingerichtet (GH_APK_TOKEN). Bis dahin: Testlink öffnen → „App installieren“.' })); return; }
        clearTimeout(timer);
        if (s.status === 'building') {
            apkBox.replaceChildren(h('div', { class: 'cd-building' }, h('span', { class: 'cd-spin' }), h('div', {}, h('b', { text: 'APK wird gebaut …' }), h('small', { text: 'Dauert meist 1–3 Minuten. Du kannst das Fenster schließen.' }), s.runUrl ? h('a', { href: s.runUrl, target: '_blank', rel: 'noopener', text: 'Fortschritt ansehen' }) : null)));
            timer = setTimeout(() => drawApk(false), 6000); return;
        }
        const build = h('button', { class: s.status === 'ready' ? 'cd-btn' : 'cd-primary', onclick: () => drawApk(true) }, icon('build'), s.status === 'ready' ? ' Neu bauen' : ' APK bauen');
        if (s.status === 'ready') {
            apkBox.replaceChildren(h('div', { class: 'cd-phone-grid' }, h('div', { class: 'cd-qr-card small' }, qrSvg(s.url, 4), h('small', { text: 'APK aufs Handy laden' })),
                h('div', { class: 'cd-steps' }, h('p', { class: 'cd-text' }, h('b', { text: 'Fertig! ' }), `Paket ${s.packageId || ''}${s.size ? ` · ${(s.size / 1024).toFixed(0)} KB` : ''}`),
                    h('ol', {}, h('li', { text: 'QR scannen oder herunterladen.' }), h('li', { text: 'Installation aus unbekannten Quellen erlauben, wenn Android fragt.' }), h('li', { text: 'Fertig – die App lädt immer die neueste Fassung aus Coden. Neu bauen nur, wenn Name oder Farbe sich ändern.' })),
                    h('div', { class: 'cd-row' }, h('a', { class: 'cd-primary', href: s.url, rel: 'noopener' }, icon('download'), ' APK herunterladen'), build))));
        } else {
            apkBox.replaceChildren(s.status === 'failed' ? h('p', { class: 'cd-err' }, s.error || 'Der Build ist fehlgeschlagen.', s.runUrl ? h('a', { href: s.runUrl, target: '_blank', rel: 'noopener', text: ' Details' }) : null) : null,
                h('p', { class: 'cd-text', text: 'Baut eine echte Android-App (.apk) mit deinem Namen, Symbol und deiner Farbe. Die APK öffnet deine veröffentlichte App und zeigt Änderungen sofort.' }), build);
        }
    };
    const m = modal('Auf dem Handy testen', body, { wide: true, onClose: () => clearTimeout(timer) });
    if (isAndroid) { apkBox.replaceChildren(h('small', { class: 'cd-hint', text: 'Lade APK-Status …' })); drawApk(false); }
    return m;
}

// ---------- Veröffentlichen ----------
export function publish(ctx, { thenApk = false } = {}) {
    let app = ctx.app; const isOwner = app.role === 'owner';
    const origin = app.url.replace(/\/a\/[^/]+\/$/, '');
    const slug = h('input', { class: 'cd-input slug', value: app.slug, maxlength: 40, spellcheck: 'false', autocomplete: 'off' });
    const err = h('div', { class: 'cd-err' }); const box = h('div', {});
    slug.addEventListener('input', () => { slug.value = slug.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'); err.textContent = ''; });
    const draw = () => {
        const live = app.published;
        box.replaceChildren(
            h('div', { class: 'cd-pub-state ' + (live ? 'on' : '') }, icon(live ? 'public' : 'public_off'), h('div', {}, h('b', { text: live ? 'Online – jeder mit der Adresse kann sie benutzen' : 'Noch nicht veröffentlicht' }), h('small', { text: live ? 'Änderungen aus Coden sind sofort online.' : 'Nur du (und eingeladene Freunde über den Testlink) sehen die App.' }))),
            h('label', { class: 'cd-label', text: 'Deine Coden-Adresse' }),
            h('div', { class: 'cd-slug' }, h('span', { text: origin + '/a/' }), slug, h('span', { text: '/' })), err,
            live ? h('div', { class: 'cd-phone-grid' }, h('div', { class: 'cd-qr-card small' }, qrSvg(app.url, 4)), h('div', { class: 'cd-steps' }, linkRow(app.url), h('small', { class: 'cd-hint', text: 'Teile den Link oder QR-Code. Auf dem Handy lässt sich die App installieren.' }))) : null,
            isOwner ? h('div', { class: 'cd-row end' },
                live ? h('button', { class: 'cd-btn', onclick: async () => { try { app = (await apiJson(`/apps/${app.id}/publish`, { method: 'DELETE' })).app; ctx.onApp(app); toast('Nicht mehr öffentlich'); draw(); } catch (e) { err.textContent = e.message; } } }, icon('visibility_off'), ' Zurückziehen') : null,
                h('button', { class: 'cd-primary', onclick: async () => {
                    try { app = (await apiJson(`/apps/${app.id}/publish`, { method: 'POST', body: JSON.stringify({ slug: slug.value.trim() }) })).app; ctx.onApp(app); toast(live ? 'Adresse gespeichert' : 'Deine App ist online! 🎉', { type: 'ok' }); draw();
                        if (thenApk) { thenApk = false; m.close(); ctx.openPhone(); } }
                    catch (e) { err.textContent = e.message; }
                } }, icon(live ? 'save' : 'rocket_launch'), live ? ' Adresse speichern' : ' Jetzt veröffentlichen')) : h('p', { class: 'cd-hint', text: 'Nur der Besitzer kann veröffentlichen.' }));
    };
    draw();
    const m = modal(app.published ? 'Veröffentlicht' : 'Veröffentlichen', box, { wide: true });
    return m;
}

// ---------- Code Buddy einladen ----------
export function invite(ctx) {
    const box = h('div', { class: 'cd-invite' });
    const draw = async () => {
        box.replaceChildren(h('small', { class: 'cd-hint', text: 'Lade Freunde …' }));
        let friends;
        try { friends = (await apiJson('/buddy/friends')).friends; }
        catch (e) {
            box.replaceChildren(h('p', { class: 'cd-text', text: 'Um gemeinsam zu bauen, brauchst du ein Code-Buddy-Profil und Freunde.' }), h('button', { class: 'cd-primary', onclick: () => { m.close(); Router.go('buddy'); } }, icon('diversity_3'), ' Code Buddy öffnen'));
            return;
        }
        const members = ctx.members();
        const inApp = new Set(members.map(x => x.handle).filter(Boolean));
        const memberRows = members.map(x => h('div', { class: 'cd-person' }, h('span', { class: 'cd-ava' + (x.online ? ' on' : ''), text: (x.displayName || '?')[0].toUpperCase() }),
            h('div', { class: 'grow' }, h('b', { text: x.displayName + (x.me ? ' (du)' : '') }), h('small', { text: (x.handle ? '@' + x.handle + ' · ' : '') + (x.role === 'owner' ? 'Besitzer' : 'Kann mitbauen') + (x.online ? ' · online' : '') })),
            ctx.app.role === 'owner' && x.role !== 'owner' ? h('button', { class: 'cd-btn sm', title: 'Entfernen', onclick: async () => { try { await apiJson(`/apps/${ctx.app.id}/members/${x.handle}`, { method: 'DELETE' }); await ctx.reloadMembers(); draw(); } catch (e) { toast(e.message, { type: 'error' }); } } }, icon('person_remove')) : null));
        const candidates = friends.filter(f => !inApp.has(f.handle));
        box.replaceChildren(
            h('h4', { text: 'In dieser App' }), ...memberRows,
            ctx.app.role === 'owner' ? h('h4', { text: 'Freunde einladen' }) : null,
            ctx.app.role === 'owner' ? (candidates.length ? candidates.map(f => h('div', { class: 'cd-person' }, h('span', { class: 'cd-ava' + (f.online ? ' on' : ''), text: f.displayName[0].toUpperCase() }), h('div', { class: 'grow' }, h('b', { text: f.displayName }), h('small', { text: '@' + f.handle })),
                h('button', { class: 'cd-primary sm', onclick: async () => { try { await apiJson(`/apps/${ctx.app.id}/members`, { method: 'POST', body: JSON.stringify({ handle: f.handle }) }); toast(`@${f.handle} ist jetzt dabei`, { type: 'ok' }); await ctx.reloadMembers(); draw(); } catch (e) { toast(e.message, { type: 'error' }); } } }, icon('person_add'), ' Einladen')))
                : h('p', { class: 'cd-text' }, friends.length ? 'Alle deine Freunde sind schon dabei.' : 'Du hast noch keine Code-Buddy-Freunde. ', h('a', { href: '#/buddy', onclick: () => m.close(), text: 'Freunde finden' }))) : h('p', { class: 'cd-hint', text: 'Nur der Besitzer kann einladen.' }),
            h('p', { class: 'cd-hint' }, icon('info'), ' Eingeladene sehen den Chat mit Coden, die Vorschau und den Code und können mitbauen. Änderungen erscheinen bei allen in wenigen Sekunden.'));
    };
    const m = modal('Gemeinsam bauen', box);
    draw();
    return m;
}
