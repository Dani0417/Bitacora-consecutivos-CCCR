// Service Worker - Bitácora de Consecutivos
// Cachea el "app shell" para que la aplicación funcione sin conexión
// después de haber sido abierta al menos una vez con internet.

const CACHE_NAME = 'bitacora-consecutivos-v1';

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
    }).then(() => self.skipWaiting())
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
    }).then(() => self.clients.claim())
  );
});

// Estrategia: cache primero, y si no está, va a la red y guarda copia.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then((respuestaCache) => {
      if (respuestaCache) return respuestaCache;

      return fetch(event.request).then((respuestaRed) => {
        // Solo cachear respuestas válidas
        if (respuestaRed && respuestaRed.status === 200) {
          const copia = respuestaRed.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copia));
        }
        return respuestaRed;
      }).catch(() => {
        // Sin red y sin caché: no hay nada más que ofrecer para este recurso.
        return respuestaCache;
      });
    })
  );
});
