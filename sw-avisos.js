// Service worker del panel: solo muestra los avisos push (nuevo caso / respuesta de un cliente) y abre el caso, el cliente o el correo al tocarlos.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));

self.addEventListener("push", e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { titulo: "Velority", texto: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(d.titulo || "Velority", {
    body: d.texto || "",
    icon: "https://velority.es/icon-192.png",
    badge: "https://velority.es/favicon-96.png",
    tag: d.etiqueta || undefined,
    renotify: !!d.etiqueta,
    data: { url: d.url || self.registration.scope },
  }));
});

self.addEventListener("notificationclick", e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || self.registration.scope;
  const destino = (/#.*$/.exec(url) || [""])[0];
  e.waitUntil((async () => {
    const abiertas = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const panel = abiertas.find(c => c.url.startsWith(self.registration.scope));
    if (panel) {
      await panel.focus();
      if (destino) panel.postMessage({ abrir: destino });
      return;
    }
    await self.clients.openWindow(url);
  })());
});
