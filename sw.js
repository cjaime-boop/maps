// Mapas Mobisond: hace que la página se pueda instalar como app.
// No guarda nada en caché: todo se pide siempre a internet (los mapas vencen y se borran).
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', function (e) {
  if (e.request.mode !== 'navigate') return;
  e.respondWith(fetch(e.request).catch(function () {
    return new Response('<meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<p style="font:16px system-ui;text-align:center;margin-top:40vh">Sin conexión. Probá de nuevo en un rato.</p>',
      {headers: {'Content-Type': 'text/html; charset=utf-8'}});
  }));
});
