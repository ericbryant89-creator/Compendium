// IndexedDB storage: docs (notes/boards), media (records), blobs (binary), meta (key/value)
const NAME = 'morgue-db', VER = 1;
let dbp;
function open() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    const r = indexedDB.open(NAME, VER);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains('docs')) d.createObjectStore('docs', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('media')) d.createObjectStore('media', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('blobs')) d.createObjectStore('blobs');
      if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta');
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}
const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const done = t => new Promise((res, rej) => { t.oncomplete = () => res(); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); });

export async function get(store, key) { const d = await open(); return req(d.transaction(store).objectStore(store).get(key)); }
export async function all(store) { const d = await open(); return req(d.transaction(store).objectStore(store).getAll()); }
export async function keys(store) { const d = await open(); return req(d.transaction(store).objectStore(store).getAllKeys()); }
export async function put(store, val, key) {
  const d = await open(); const t = d.transaction(store, 'readwrite');
  key === undefined ? t.objectStore(store).put(val) : t.objectStore(store).put(val, key);
  return done(t);
}
export async function putMany(store, vals) {
  const d = await open(); const t = d.transaction(store, 'readwrite'); const s = t.objectStore(store);
  for (const v of vals) s.put(v);
  return done(t);
}
export async function del(store, key) { const d = await open(); const t = d.transaction(store, 'readwrite'); t.objectStore(store).delete(key); return done(t); }
export async function clearAll() {
  const d = await open(); const t = d.transaction(['docs', 'media', 'blobs', 'meta'], 'readwrite');
  for (const s of ['docs', 'media', 'blobs', 'meta']) t.objectStore(s).clear();
  return done(t);
}
export const meta = {
  get: k => get('meta', k),
  set: (k, v) => put('meta', v, k),
};
