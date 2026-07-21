// Minimal service worker — its ONLY job is to make Soterra installable.
//
// Chrome/Edge require a registered service worker with a fetch handler before
// they'll fire `beforeinstallprompt` (the one-tap "Install app" button). iOS
// doesn't need one for Add to Home Screen, but it costs nothing there.
//
// Deliberately NO caching. Soterra is a live app: answers, calendar and plans
// must always come from the server, and a stale cached HTML shell is a far
// worse bug than a slow load. The fetch handler below is a pass-through — it
// never calls respondWith, so the browser handles every request normally.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {
  /* pass-through: required for installability, intentionally does nothing */
});
