// Service worker mínimo. Existe SOLO para que Android reconozca la app como "instalable"
// en modo standalone (algunos navegadores todavía lo piden como requisito). A propósito
// NO cachea nada: siempre deja pasar la petición a la red tal cual, para no pelearse
// con el número de versión de index.html (necesitamos que SIEMPRE traiga la copia más
// reciente del servidor, nunca una vieja guardada por el service worker).
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request));
});
