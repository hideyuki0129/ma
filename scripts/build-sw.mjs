import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

async function list(dir) {
  const items = await readdir(dir, { withFileTypes: true });
  return (await Promise.all(items.map(item => item.isDirectory() ? list(`${dir}/${item.name}`) : `${dir}/${item.name}`))).flat();
}
const files = (await list('dist')).filter(file => !file.endsWith('/sw.js')).sort();
const hash = createHash('sha256');
for (const file of files) hash.update(await readFile(file));
const version = `ma-${hash.digest('hex').slice(0, 12)}`;
const paths = ['./', ...files.map(file => `./${file.slice(5)}`)];
const source = `// Generated from this build's assets. No remote requests or tracking.
const CACHE = ${JSON.stringify(version)};
const ASSETS = ${JSON.stringify(paths)};
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS.map(path => new Request(new URL(path, self.registration.scope), { cache: 'reload' })))));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('ma-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(() => caches.open(CACHE).then(cache => cache.match(new URL('./index.html', self.registration.scope), { ignoreVary: true })).then(hit => hit || Response.error())));
  } else {
    // These are this build's public, same-origin static assets. Preview servers may
    // add Vary: Origin; module-script requests include Origin, precache requests don't.
    event.respondWith(caches.open(CACHE).then(cache => cache.match(event.request, { ignoreVary: true })).then(hit => hit || fetch(event.request)));
  }
});
`;
await writeFile('dist/sw.js', source);
console.log(`Offline cache: ${files.length} files (${version})`);
