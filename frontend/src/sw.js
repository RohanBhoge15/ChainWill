/* ChainWill service worker: offline app shell (Workbox) + Web Push. */
import { clientsClaim } from "workbox-core";
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";

self.skipWaiting();
clientsClaim();

// Injected at build time with the list of built assets.
precacheAndRoute(self.__WB_MANIFEST || []);
cleanupOutdatedCaches();

// Client-side routes fall back to the cached shell. API calls are never cached:
// balances, deadlines and claim states must always come from the server.
try {
  registerRoute(new NavigationRoute(createHandlerBoundToURL("index.html"), { denylist: [/^\/api\//] }));
} catch {
  /* dev mode: index.html is not precached */
}

// ── Web Push ─────────────────────────────────────────────────────────────────────

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: "ChainWill", body: event.data ? event.data.text() : "" };
  }
  const title = payload.title || "ChainWill";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: payload.body || "",
      icon: "/icons/icon-192.png",
      badge: "/icons/badge-96.png",
      tag: payload.id ? `chainwill-${payload.id}` : undefined,
      data: { url: payload.url || "/app" },
      // deadline alerts should not silently disappear
      requireInteraction: ["GRACE_START", "GRACE_WARN", "ELIGIBLE", "ACTIVATED"].includes(payload.type),
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/app", self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const open = windows.find((client) => new URL(client.url).origin === self.location.origin);
      if (open) {
        await open.focus();
        if ("navigate" in open) await open.navigate(target).catch(() => {});
        return;
      }
      await self.clients.openWindow(target);
    })()
  );
});
