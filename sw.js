// Service Worker von Coden: zeigt Push-Benachrichtigungen („Coden ist fertig“), auch wenn die Seite zu ist.
// Er speichert absichtlich nichts zwischen (kein Offline-Cache), damit nach einem Update nie alte Dateien laden.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    // Schaut der Nutzer gerade auf Coden, sieht er das Ergebnis schon – keine doppelte Meldung
    if (wins.some((w) => w.visibilityState === 'visible' && w.focused)) return;
    await self.registration.showNotification(d.title || 'Coden', {
      body: d.body || 'Deine Aufgabe ist fertig.', icon: '/images/coden_logo.jpg', badge: '/images/coden_logo.jpg',
      tag: d.tag || 'coden', renotify: true, data: { url: d.url || '/' }
    });
  })());
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || '/', self.location.origin).href;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const w = wins.find((x) => new URL(x.url).origin === self.location.origin);
    if (w) { await w.focus(); try { await w.navigate(url); } catch (_) { /* andere Seite offen */ } return; }
    await self.clients.openWindow(url);
  })());
});
