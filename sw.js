/* Build-generated service worker. One verified, complete cache per release. */
const BUILD = "fac250feee763ede";
const ASSETS = [{"path":"./catalog.json","hash":"445b8362bd57acb83b16ac39543cfaff20cb0f9d451354c8b428cb25d29b7124"},{"path":"./fonts/golos_text.ttf","hash":"17bb58fb69aec2dfb047a2ebf52534023e9b688c97a6b7ac795b0a72912c2063"},{"path":"./fonts/literata.ttf","hash":"b41138c9373112f32abb589cc22e8674b06ed4048b0c513be922bdd26f274440"},{"path":"./fonts/literata_italic.ttf","hash":"d483dfaeba9cbf4ce71d32a52ee65df82f7e35b15fff8d1011cdb242d1fcd465"},{"path":"./icons/apple-touch-icon.png","hash":"3e829136a0c8a728a4d8121ec26c4f35b957dfefc2563d67f305d1c82300a4e4"},{"path":"./icons/icon-192.png","hash":"2b69b5ed39763491c798bdff71883d1f135c7a2a92ee4f6a39b5b071c83a263b"},{"path":"./icons/icon-512.png","hash":"1b8a3114d3b70200f8eb84f20593883c49bb90dfeae02888b48963a0ac71e95c"},{"path":"./images/vocavoca-welcome-B-illustration.png","hash":"81fd267a3bdc5ed39b81bcae362c75ebba16dac35629c5b23039f6b3e1e2ec83"},{"path":"./index.html","hash":"6fed7ebf944a23e5f4392b766aff173c9d3ca74176e623cbffa64c8486581195"},{"path":"./licenses/GolosText-OFL.txt","hash":"ff532f9e8789f09a9fdffc3c0954eedfb0a48be77b2e2eb90f5f82e4f347f50c"},{"path":"./licenses/Literata-OFL.txt","hash":"8742963604cd89dc81437811a850018fc03b2bfad686d7422c8235967c87614e"},{"path":"./manifest.webmanifest","hash":"52682e006ce6f7553ae327c5f84314a3543a4f02069c4fdf5c3e5ec8c6cb9100"},{"path":"./search-forms.json","hash":"65d8fbecdef9ab5238220c0c2e7e7c855a9959fdf5a5c34f51938e32b6071fc1"},{"path":"./src/android-backup.mjs","hash":"9e757a5da6b0be097419d373adc86ad521cc1705a0ec50f0d8dcd94f9af9b488"},{"path":"./src/app.mjs","hash":"84333f1decb1c0ebf6265e1192cace9aeb1241c6feac13864ca4ab0c3fa9096c"},{"path":"./src/backup.mjs","hash":"b10ca0be7bfda386e3fea9f6d4dea7f9520f8313ea7ee778902efa78886f2349"},{"path":"./src/catalog.mjs","hash":"a26a27149754dfe6b2806750c6d5affe518fca63cdd9b58c3a141bc1a86adf46"},{"path":"./src/day.mjs","hash":"ea8b78f865608f3b3c3b6ebf6fd049983af8431dd890645a4908b31dc6541393"},{"path":"./src/feed.mjs","hash":"76af63a15ef842e0f99eabebe7178630a53bcd2869020d7302bf5fd72d392cfa"},{"path":"./src/learning.mjs","hash":"0a196e4f7771a063251e941d0daeaf02009736f9b44b8fe2aad6f4cf0c702be8"},{"path":"./src/navigation.mjs","hash":"1873d041ee8381224ad7e17b738897df451fa6bf08f11fec0418fffb81b5da9b"},{"path":"./src/pwa.mjs","hash":"8ab7e334d4afeb21d8849ce18e105425fa6a2d937ca9c05230d7d7efe402c54a"},{"path":"./src/results.mjs","hash":"e10c8f2fd84ebec1b777cfc016e48a4ec33451813cb5b6d2cafa626e6b771d46"},{"path":"./src/search.mjs","hash":"b803dd21cadb87a17f814ee4046b6c2df3796f2ef54d36d6e53100b5e5049257"},{"path":"./src/settings.mjs","hash":"89564cd7abb2da0810a3408b978df7e96a12bdd052e9bdfcbcd04261fd13b51c"},{"path":"./src/storage.mjs","hash":"de149bc6aa1ba88be49fccfb19c06f73fd80c6bf5fbf7a6fb4d6728e3d513d62"},{"path":"./styles.css","hash":"bac6d1ee81881a5f088b01b2b4e0d1c76d0f05a97603cda7b70effab95f6752c"},{"path":"./version.json","hash":"5853ac47dc804bc393a5c52cd7b0a4435edbb03f3efffe6fa6aa2a3ef5506cc4"},{"path":"./visual.css","hash":"343798b56cce27140c576880a51f9260e6e8bdfd251d7043cc67d62309a90015"}];
const PREFIX = 'vocavoca-pwa:' + self.registration.scope + ':';
const CACHE = PREFIX + BUILD;
const url = (path) => new URL(path, self.registration.scope).href;
self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      try {
        // Hash checks reject mixed/incomplete deployments before replacing the working release.
        await Promise.all(
          ASSETS.map(async (asset) => {
            const response = await fetch(url(asset.path), { cache: 'no-store' });
            if (!response.ok || response.type === 'opaque') throw Error('Incomplete release');
            const bytes = await response.clone().arrayBuffer();
            const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
              .map((b) => b.toString(16).padStart(2, '0'))
              .join('');
            if (hash !== asset.hash) throw Error('Mixed release');
            await cache.put(url(asset.path), response);
          }),
        );
      } catch (error) {
        await caches.delete(CACHE);
        throw error;
      }
      // No skipWaiting: open clients keep their current complete release until user accepts.
    })(),
  );
});
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      await Promise.all(
        (await caches.keys())
          .filter((name) => name.startsWith(PREFIX) && name !== CACHE)
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});
self.addEventListener('message', (event) => {
  if (event.data?.type === 'ACTIVATE') event.waitUntil(self.skipWaiting());
});
self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || !request.url.startsWith(self.registration.scope)) return;
  const requested = new URL(request.url);
  if (requested.origin !== self.location.origin) return;
  event.respondWith(
    (async () => {
      const key = request.mode === 'navigate' ? url('./index.html') : request.url;
      // A finishing request from the previous worker must not recreate its deleted cache.
      return (await caches.match(key, { cacheName: CACHE })) || fetch(request);
    })(),
  );
});
