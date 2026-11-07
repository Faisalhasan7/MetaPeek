/* MetaPeek service worker: caches the app shell so it works offline. Map tiles are never cached. */
const CACHE = 'metapeek-v2.2.0';
const SHELL = [
  './', './index.html', './css/app.css', './manifest.webmanifest', './icons/icon.svg',
  './js/theme.js', './js/util.js', './js/forensics.js', './js/parse.js', './js/strip.js', './js/export.js', './js/app.js',
  './vendor/exifr.full.umd.js', './vendor/jszip.min.js', './vendor/piexif.js', './js/geotag.js', './js/places.js',
  './vendor/leaflet/leaflet.js', './vendor/leaflet/leaflet.css', './vendor/leaflet/leaflet.markercluster.js',
  './vendor/leaflet/MarkerCluster.css', './vendor/leaflet/MarkerCluster.Default.css', './vendor/leaflet/leaflet-heat.js',
  './vendor/leaflet/images/marker-icon.png', './vendor/leaflet/images/marker-icon-2x.png', './vendor/leaflet/images/marker-shadow.png'
];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request)));
});
