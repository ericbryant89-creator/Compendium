// Media files: originals + lighter preview/thumbnail copies, cached locally, fetched from Drive when missing.
import * as db from './db.js';
import { uid, now } from './util.js';
import { media, saveMedia } from './state.js';
import { PREVIEW_MAX, THUMB_MAX } from './config.js';

const EXT_MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', heic: 'image/heic', bmp: 'image/bmp', svg: 'image/svg+xml', mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', ogg: 'audio/ogg', pdf: 'application/pdf', txt: 'text/plain' };
export const guessMime = (name, type) => type || EXT_MIME[(name.split('.').pop() || '').toLowerCase()] || 'application/octet-stream';
export const isImage = m => m?.mime?.startsWith('image/');

async function stepScale(src, sw, sh, max) {
  const k = Math.min(1, max / Math.max(sw, sh));
  const tw = Math.max(1, Math.round(sw * k)), th = Math.max(1, Math.round(sh * k));
  let cur = src, cw = sw, ch = sh;
  // halve repeatedly for smoother downscales
  while (cw / 2 >= tw * 1.5) {
    const c = document.createElement('canvas'); c.width = Math.round(cw / 2); c.height = Math.round(ch / 2);
    const g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(cur, 0, 0, c.width, c.height);
    cur = c; cw = c.width; ch = c.height;
  }
  const c = document.createElement('canvas'); c.width = tw; c.height = th;
  const g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(cur, 0, 0, tw, th);
  let b = await new Promise(r => c.toBlob(r, 'image/webp', 0.85));
  if (!b || b.type !== 'image/webp') b = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.86));
  return b;
}

async function videoFrame(blob) {
  return new Promise(res => {
    const v = document.createElement('video'); const u = URL.createObjectURL(blob);
    let done = false; const fin = r => { if (done) return; done = true; URL.revokeObjectURL(u); res(r); };
    v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = u;
    v.onloadeddata = () => { try { v.currentTime = Math.min(0.5, (v.duration || 1) / 3); } catch { fin(null); } };
    v.onseeked = () => fin(v);
    v.onerror = () => fin(null);
    setTimeout(() => fin(null), 6000);
  });
}

// Store a File/Blob as a media record. Returns the record.
export async function addFile(file, { name, keepOriginal = true } = {}) {
  const id = uid();
  const fname = name || file.name || 'file';
  const mime = guessMime(fname, file.type);
  const rec = { id, name: fname, mime, size: file.size, w: 0, h: 0, v: {}, remote: {}, created: now(), updated: now() };
  await db.put('blobs', file, id + ':o'); rec.v.o = 1;
  try {
    if (mime.startsWith('image/') && mime !== 'image/svg+xml') {
      const bmp = await createImageBitmap(file);
      rec.w = bmp.width; rec.h = bmp.height;
      const big = Math.max(bmp.width, bmp.height);
      const webFriendly = /image\/(jpeg|png|webp|gif)/.test(mime);
      if (mime !== 'image/gif' && (big > PREVIEW_MAX || !webFriendly || file.size > 1.5e6)) {
        await db.put('blobs', await stepScale(bmp, bmp.width, bmp.height, PREVIEW_MAX), id + ':p'); rec.v.p = 1;
      }
      if (big > THUMB_MAX || file.size > 150e3) { await db.put('blobs', await stepScale(bmp, bmp.width, bmp.height, THUMB_MAX), id + ':t'); rec.v.t = 1; }
      bmp.close?.();
    } else if (mime.startsWith('video/')) {
      const v = await videoFrame(file);
      if (v) { rec.w = v.videoWidth; rec.h = v.videoHeight; rec.duration = v.duration; await db.put('blobs', await stepScale(v, v.videoWidth, v.videoHeight, THUMB_MAX), id + ':t'); rec.v.t = 1; }
    }
  } catch (e) { console.warn('media processing failed', fname, e); }
  if (!keepOriginal && rec.v.p) { /* caller may evict later after upload */ }
  await saveMedia(rec);
  return rec;
}

// ---- URLs ----
const urlCache = new Map();
const inflight = new Map();
let remoteFetch = null;        // (fileId) => Promise<Blob>
export function setRemoteFetcher(fn) { remoteFetch = fn; }
const cacheURL = (k, b) => { const u = URL.createObjectURL(b); urlCache.set(k, u); return u; };
const ORDER = { t: ['t', 'p', 'o'], p: ['p', 'o'], o: ['o', 'p'] };

export function cachedURL(id, want = 'p') {
  for (const v of ORDER[want]) { const u = urlCache.get(id + ':' + v); if (u) return u; }
  return null;
}
export async function blob(id, v) { return db.get('blobs', id + ':' + v); }

export async function url(id, want = 'p') {
  if (!id) return null;
  const c = cachedURL(id, want); if (c) return c;
  const k0 = id + ':' + want;
  if (inflight.has(k0)) return inflight.get(k0);
  const p = (async () => {
    for (const v of ORDER[want]) { const b = await db.get('blobs', id + ':' + v); if (b) return cacheURL(id + ':' + v, b); }
    const rec = media.get(id);
    if (rec && remoteFetch) for (const v of ORDER[want]) {
      const fid = rec.remote?.[v]; if (!fid) continue;
      try { const b = await remoteFetch(fid); if (b) { await db.put('blobs', b, id + ':' + v); return cacheURL(id + ':' + v, b); } } catch (e) { console.warn('fetch failed', e); }
    }
    if (want !== 't') { // fall back to a thumbnail rather than nothing
      const b = await db.get('blobs', id + ':t'); if (b) return cacheURL(id + ':t', b);
    }
    return null;
  })();
  inflight.set(k0, p);
  try { return await p; } finally { inflight.delete(k0); }
}
export function forget(id) { for (const v of ['o', 'p', 't']) { const u = urlCache.get(id + ':' + v); if (u) { URL.revokeObjectURL(u); urlCache.delete(id + ':' + v); } } }
// Remove local original once safely stored in Drive (keeps preview/thumb).
export async function evictOriginal(id) {
  const rec = media.get(id);
  if (!rec?.remote?.o || !(rec.v.p || rec.v.t)) return;
  if (!rec.mime.startsWith('image/')) return;
  const k = id + ':o'; const u = urlCache.get(k); if (u) { URL.revokeObjectURL(u); urlCache.delete(k); }
  await db.del('blobs', k);
}
export const aspect = m => (m?.w && m?.h ? m.h / m.w : 0.75);
