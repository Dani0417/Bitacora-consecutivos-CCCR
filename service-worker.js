// Service Worker - Bitácora de Consecutivos
// Estrategia: network-first (siempre intenta traer la versión más reciente).
// Si no hay conexión, sirve la última copia guardada en caché.
// skipWaiting + clients.claim: la app se actualiza sola, sin que el
// usuario tenga que desinstalar o cerrar manualmente la aplicación.

const CACHE_NAME = 'bitacora-consecutivos-v2';

const ARCHIVOS_APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/app.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  // Librería para generar archivos .xlsx reales.
  // Se cachea la primera vez que haya internet; después queda disponible offline.
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ARCHIVOS_APP_SHELL).catch((err) => {
        // Si algún recurso externo falla (sin internet en la instalación),
        // no se bloquea la instalación del resto del app shell.
        console.warn('No se pudo precachear algún recurso:', err);
      });
    }).then(() => self.skipWaiting()) // activa la nueva versión de inmediato
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((nombres) => {
      return Promise.all(
        nombres
          .filter((nombre) => nombre !== CACHE_NAME)
          .map((nombre) => caches.delete(nombre))
      );
    }).then(() => self.clients.claim()) // toma control de las pestañas abiertas ya mismo
  );
});

// Permite que la página fuerce la activación inmediata si lo necesita
// (usado junto con el listener 'controllerchange' en app.js).
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// Estrategia network-first: intenta red primero para tener siempre la
// versión más reciente; si falla (sin conexión), recurre a la caché.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  event.respondWith(
    fetch(event.request)
      .then((respuestaRed) => {
        if (respuestaRed && respuestaRed.status === 200) {
          const copia = respuestaRed.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copia));
        }
        return respuestaRed;
      })
      .catch(() => {
        return caches.match(event.request).then((respuestaCache) => {
          return respuestaCache || Promise.reject('sin-red-y-sin-cache');
        });
      })
  );
});
