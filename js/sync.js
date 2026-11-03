// Google Drive sync. Everything lives in a "Compendium" folder in the user's Drive:
//   notes/<id>.json      one file per note/board
//   media/<id>.<v>.<ext> image/file variants (t = thumbnail, p = preview, o = original)
//   media-index.json     media records + categories
//   All Notes.md         readable export of every note & board (for AI assistants)
import { DRIVE_FOLDER, GOOGLE_CLIENT_ID, APP_NAME } from './config.js';
import * as db from './db.js';
import { docs, media, strip, categories, setCategories, mediaTouched, live, tagsOf, snippet } from './state.js';
import * as Media from './media.js';
import { bus, store, debounce } from './util.js';

const API = 'https://www.googleapis.com/drive/v3', UP = 'https://www.googleapis.com/upload/drive/v3';
const SCOPE = 'https://www.googleapis.com/auth/drive.file';
class NeedAuth extends Error { constructor() { super('Google sign-in needed'); } }

export const status = { state: 'off', msg: '', last: store.get('lastSync', 0), pending: 0 };
function setStatus(state, msg = '') { status.state = state; status.msg = msg; bus.emit('sync', status); }

export const clientId = () => (store.get('clientId') || GOOGLE_CLIENT_ID || '').trim();
export const enabled = () => !!store.get('driveOn') && !!clientId();

// ---------- auth ----------
let token = null, tokenExp = 0;
export function loadGIS() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  return new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
    s.onload = () => res(); s.onerror = () => rej(new Error('Could not load Google sign-in')); document.head.append(s);
  });
}
function cachedToken() {
  if (token && Date.now() < tokenExp - 60e3) return token;
  const t = store.get('tok'); if (t && Date.now() < t.exp - 60e3) { token = t.t; tokenExp = t.exp; return token; }
  return null;
}
export function signIn() {
  return new Promise(async (res, rej) => {
    try { if (!window.google?.accounts?.oauth2) await loadGIS(); } catch (e) { return rej(e); }
    const tc = google.accounts.oauth2.initTokenClient({
      client_id: clientId(), scope: SCOPE, prompt: store.get('consented') ? '' : 'consent',
      callback: r => {
        if (r.error) return rej(new Error(r.error_description || r.error));
        token = r.access_token; tokenExp = Date.now() + (r.expires_in || 3600) * 1000;
        store.set('tok', { t: token, exp: tokenExp }); store.set('consented', true); res(token);
      },
      error_callback: e => rej(new Error(e.type === 'popup_failed_to_open' ? 'The sign-in window was blocked — tap again.' : (e.message || e.type || 'Sign-in failed'))),
    });
    tc.requestAccessToken();
  });
}
async function gfetch(url, opts = {}, tries = 4) {
  const t = cachedToken(); if (!t) throw new NeedAuth();
  let r;
  try { r = await fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: 'Bearer ' + t } }); }
  catch (e) { if (tries > 1) { await sleep(1500); return gfetch(url, opts, tries - 1); } throw e; }
  if (r.status === 401) { token = null; store.set('tok', null); throw new NeedAuth(); }
  if ((r.status === 429 || r.status >= 500 || r.status === 403) && tries > 1) {
    const txt = r.status === 403 ? await r.clone().text() : '';
    if (r.status !== 403 || /rate|quota|limit/i.test(txt)) { await sleep((5 - tries) * 2000 + Math.random() * 1000); return gfetch(url, opts, tries - 1); }
  }
  if (!r.ok) throw new Error(`Drive error ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const q = s => encodeURIComponent(s);

// ---------- Drive helpers ----------
async function findOrCreateFolder(name, parent) {
  const query = `name='${name.replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.folder' and '${parent}' in parents and trashed=false`;
  const r = await (await gfetch(`${API}/files?q=${q(query)}&fields=files(id)&spaces=drive`)).json();
  if (r.files?.length) return r.files[0].id;
  const c = await (await gfetch(`${API}/files?fields=id`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', parents: [parent] }) })).json();
  return c.id;
}
async function folders() {
  let f = await db.meta.get('drive:folders');
  if (f?.root) return f;
  const root = await findOrCreateFolder(DRIVE_FOLDER, 'root');
  f = { root, docs: await findOrCreateFolder('notes', root), media: await findOrCreateFolder('media', root) };
  await db.meta.set('drive:folders', f); return f;
}
async function upload({ id, name, parent, blob, mime, props }) {
  if (!id && blob.size > 4.5e6) { try { return await uploadResumable({ name, parent, blob, mime, props }); } catch (e) { if (e instanceof NeedAuth) throw e; console.warn('resumable failed, trying multipart', e); } }
  const meta = id ? { name, appProperties: props } : { name, parents: [parent], appProperties: props, mimeType: mime };
  const bd = 'mg' + Math.random().toString(36).slice(2);
  const body = new Blob([`--${bd}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${bd}\r\nContent-Type: ${mime}\r\n\r\n`, blob, `\r\n--${bd}--`]);
  const url = id ? `${UP}/files/${id}?uploadType=multipart&fields=id,modifiedTime` : `${UP}/files?uploadType=multipart&fields=id,modifiedTime`;
  try {
    return await (await gfetch(url, { method: id ? 'PATCH' : 'POST', headers: { 'Content-Type': `multipart/related; boundary=${bd}` }, body })).json();
  } catch (e) {
    if (id && /error 404/.test(e.message)) return upload({ name, parent, blob, mime, props }); // file vanished: recreate
    throw e;
  }
}
async function uploadResumable({ name, parent, blob, mime, props }) {
  const r = await gfetch(`${UP}/files?uploadType=resumable&fields=id`, { method: 'POST', headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': mime }, body: JSON.stringify({ name, parents: [parent], appProperties: props }) });
  const loc = r.headers.get('Location'); if (!loc) throw new Error('no upload location');
  const r2 = await fetch(loc, { method: 'PUT', headers: { 'Content-Type': mime }, body: blob });
  if (!r2.ok) throw new Error('upload failed ' + r2.status);
  return r2.json();
}
async function listAll(query, fields = 'id,name,modifiedTime,appProperties') {
  const out = []; let page = '';
  do {
    const r = await (await gfetch(`${API}/files?q=${q(query)}&fields=nextPageToken,files(${fields})&pageSize=1000&spaces=drive${page ? '&pageToken=' + page : ''}`)).json();
    out.push(...(r.files || [])); page = r.nextPageToken || '';
  } while (page);
  return out;
}
// limit concurrent downloads
let active = 0; const waiters = [];
async function slot(fn) {
  while (active >= 6) await new Promise(r => waiters.push(r));
  active++; try { return await fn(); } finally { active--; waiters.shift()?.(); }
}
Media.setRemoteFetcher(fid => {
  if (!enabled() || !cachedToken()) return Promise.resolve(null);
  return slot(async () => { try { return await (await gfetch(`${API}/files/${fid}?alt=media`)).blob(); } catch (e) { if (e instanceof NeedAuth) setStatus('needs-auth'); throw e; } });
});

// ---------- dirty tracking ----------
let dirtyDocs = new Set(), dirtyIndex = false, dirtyExport = false;
(async () => {
  dirtyDocs = new Set((await db.meta.get('dirty:docs')) || []);
  dirtyIndex = !!(await db.meta.get('dirty:index'));
  dirtyExport = !!(await db.meta.get('dirty:export'));
})();
const persistDirty = debounce(() => { db.meta.set('dirty:docs', [...dirtyDocs]); db.meta.set('dirty:index', dirtyIndex); db.meta.set('dirty:export', dirtyExport); }, 300);
bus.on('dirty:doc', id => { dirtyDocs.add(id); dirtyExport = true; persistDirty(); soon(); });
bus.on('dirty:media', () => { dirtyIndex = true; persistDirty(); soon(); });
bus.on('dirty:meta', () => { dirtyIndex = true; persistDirty(); soon(); });

// ---------- sync ----------
let running = false, again = false;
const soon = debounce(() => syncNow(), 2500);
export async function syncNow() {
  if (!enabled()) { setStatus('off'); return; }
  if (running) { again = true; return; }
  if (!cachedToken()) { setStatus('needs-auth'); return; }
  if (!navigator.onLine) { setStatus('offline'); return; }
  running = true; setStatus('syncing', 'Syncing…');
  try {
    const F = await folders();
    await pull(F);
    await pushDocs(F);
    const more = await pushMedia(F, 40e3);
    await pushIndex(F);
    await pushExport(F);
    status.last = Date.now(); store.set('lastSync', status.last);
    setStatus('idle');
    if (more) again = true;
  } catch (e) {
    if (e instanceof NeedAuth) setStatus('needs-auth');
    else { console.error(e); setStatus('error', e.message); }
  } finally {
    running = false;
    if (again && status.state === 'idle') { again = false; setTimeout(syncNow, 500); }
  }
}

async function pull(F) {
  const last = (await db.meta.get('drive:lastPull')) || '1970-01-01T00:00:00.000Z';
  const map = (await db.meta.get('drive:docs')) || {};
  const files = await listAll(`'${F.docs}' in parents and trashed=false and modifiedTime >= '${last}'`);
  let maxT = last, changed = 0;
  const jobs = files.map(f => async () => {
    if (f.modifiedTime > maxT) maxT = f.modifiedTime;
    if (!f.name.endsWith('.json')) return;
    const id = f.name.slice(0, -5); map[id] = f.id;
    const local = docs.get(id); const ru = +(f.appProperties?.u || 0);
    if (local && ru && local.updated >= ru) return;
    const d = await (await gfetch(`${API}/files/${f.id}?alt=media`)).json();
    if (!d?.id) return;
    const cur = docs.get(id);
    if (!cur || d.updated > cur.updated) { docs.set(d.id, d); await db.put('docs', d); dirtyDocs.delete(d.id); changed++; }
  });
  await runPool(jobs, 6);
  await db.meta.set('drive:docs', map); await db.meta.set('drive:lastPull', maxT);
  // media index
  const idx = await indexFile(F);
  if (idx && idx.modifiedTime !== (await db.meta.get('drive:indexTime'))) {
    const data = await (await gfetch(`${API}/files/${idx.id}?alt=media`)).json();
    let mchanged = 0;
    for (const [id, r] of Object.entries(data.media || {})) {
      const l = media.get(id);
      if (!l) { media.set(id, r); await db.put('media', r); mchanged++; continue; }
      const merged = (r.updated || 0) > (l.updated || 0) ? { ...l, ...r } : { ...r, ...l };
      merged.remote = { ...(r.remote || {}), ...(l.remote || {}) };
      merged.v = { ...(r.v || {}), ...(l.v || {}) };
      if (JSON.stringify(merged) !== JSON.stringify(l)) { media.set(id, merged); await db.put('media', merged); mchanged++; }
    }
    if (Array.isArray(data.categories)) {
      const set = new Map(categories.map(c => [c.toLowerCase(), c]));
      for (const c of data.categories) if (!set.has(c.toLowerCase())) set.set(c.toLowerCase(), c);
      if (set.size !== categories.length) await setCategories([...set.values()]);
    }
    await db.meta.set('drive:indexTime', idx.modifiedTime);
    if (mchanged) mediaTouched();
    changed += mchanged;
  }
  if (changed) bus.emit('pulled', changed);
}
async function indexFile(F) {
  let id = await db.meta.get('drive:indexId');
  if (id) { try { return await (await gfetch(`${API}/files/${id}?fields=id,modifiedTime`)).json(); } catch { id = null; } }
  const f = (await listAll(`name='media-index.json' and '${F.root}' in parents and trashed=false`, 'id,modifiedTime'))[0];
  if (f) await db.meta.set('drive:indexId', f.id);
  return f || null;
}
async function pushDocs(F) {
  if (!dirtyDocs.size) return;
  const map = (await db.meta.get('drive:docs')) || {};
  const jobs = [...dirtyDocs].map(id => async () => {
    const d = docs.get(id);
    if (!d || d._new) { dirtyDocs.delete(id); return; }
    const r = await upload({ id: map[id], name: id + '.json', parent: F.docs, blob: new Blob([JSON.stringify(strip(d))]), mime: 'application/json', props: { u: String(d.updated), t: d.type } });
    map[id] = r.id; dirtyDocs.delete(id);
  });
  try { await runPool(jobs, 4); } finally { await db.meta.set('drive:docs', map); persistDirty(); }
}
export function pendingMedia() {
  let n = 0; for (const m of media.values()) for (const v of ['t', 'p', 'o']) if (m.v?.[v] && !m.remote?.[v] && !m._missing?.[v]) n++;
  return n;
}
async function pushMedia(F, budgetMs) {
  const t0 = Date.now();
  const evict = store.get('evictOriginals', true);
  for (const v of ['t', 'p', 'o']) {
    const todo = [...media.values()].filter(m => m.v?.[v] && !m.remote?.[v]);
    const jobs = todo.map(m => async () => {
      if (Date.now() - t0 > budgetMs) return;
      const b = await Media.blob(m.id, v);
      if (!b) { (m._missing ||= {})[v] = 1; return; }
      const ext = v === 'o' ? (m.name.split('.').pop() || 'bin').toLowerCase().slice(0, 5) : (b.type.split('/')[1] || 'webp');
      const r = await upload({ name: `${m.id}.${v}.${ext}`, parent: F.media, blob: b, mime: b.type || m.mime || 'application/octet-stream', props: { m: m.id, v } });
      m.remote = { ...(m.remote || {}), [v]: r.id };
      await db.put('media', m); dirtyIndex = true;
      if (v === 'o' && evict) await Media.evictOriginal(m.id);
      status.pending = pendingMedia(); bus.emit('sync', status);
    });
    await runPool(jobs, 3);
    if (Date.now() - t0 > budgetMs) { persistDirty(); return pendingMedia() > 0; }
  }
  persistDirty();
  status.pending = pendingMedia();
  return false;
}
async function pushIndex(F) {
  if (!dirtyIndex) return;
  const out = {};
  for (const [id, m] of media) { const o = {}; for (const k in m) if (!k.startsWith('_')) o[k] = m[k]; out[id] = o; }
  const body = JSON.stringify({ app: APP_NAME, updated: Date.now(), categories, media: out });
  const existing = await indexFile(F);
  const r = await upload({ id: existing?.id, name: 'media-index.json', parent: F.root, blob: new Blob([body]), mime: 'application/json', props: {} });
  await db.meta.set('drive:indexId', r.id); await db.meta.set('drive:indexTime', r.modifiedTime);
  dirtyIndex = false; persistDirty();
}
export function exportMarkdown() {
  const lines = [`# ${APP_NAME} — all notes and boards`, `_Generated ${new Date().toLocaleString()}. One section per note or board. Images are listed by file name; the image files are in the "media" folder (name starts with the media id)._`, ''];
  const list = [...docs.values()].filter(live).sort((a, b) => b.updated - a.updated);
  for (const d of list) {
    lines.push(`## ${d.type === 'board' ? 'Board: ' : ''}${d.title || 'Untitled'}`);
    const tg = tagsOf(d); lines.push(`- id: ${d.id}`, `- updated: ${new Date(d.updated).toISOString().slice(0, 10)}`); if (tg.length) lines.push(`- categories: ${tg.map(t => '#' + t).join(' ')}`);
    lines.push('');
    if (d.type === 'note') for (const b of d.blocks) {
      if (b.t === 'text' && b.text.trim()) lines.push(b.text, '');
      if (b.t === 'link') lines.push(`[${b.label || b.url}](${b.url})`, '');
      if (b.t === 'image' || b.t === 'file') { const m = media.get(b.media); lines.push(`[${b.t}: ${m?.name || b.media} — media id ${b.media}${m?.ai?.caption ? ' — ' + m.ai.caption : ''}]${b.caption ? ' ' + b.caption : ''}`, ''); }
    } else {
      lines.push(snippet(d, 100000), '');
      const tagged = (d.items || []).filter(i => i.k === 'img').map(i => media.get(i.media)).filter(m => m?.ai?.tags?.length);
      if (tagged.length) lines.push('Images in this board (AI descriptions):', ...tagged.map(m => `- ${m.name} (media id ${m.id}): ${m.ai.caption || ''} [${m.ai.tags.join(', ')}]`), '');
    }
  }
  return lines.join('\n');
}
async function pushExport(F) {
  if (!dirtyExport) return;
  const last = store.get('lastExport', 0);
  if (Date.now() - last < 5 * 60e3 && !store.get('forceExport')) return; // at most every 5 minutes
  let id = await db.meta.get('drive:exportId');
  const r = await upload({ id, name: 'All Notes.md', parent: F.root, blob: new Blob([exportMarkdown()], { type: 'text/markdown' }), mime: 'text/markdown', props: {} });
  await db.meta.set('drive:exportId', r.id); store.set('lastExport', Date.now()); store.set('forceExport', false);
  dirtyExport = false; persistDirty();
}
async function runPool(jobs, n) {
  let i = 0; const errs = [];
  await Promise.all(Array.from({ length: Math.min(n, jobs.length) }, async () => {
    while (i < jobs.length) { const j = jobs[i++]; try { await j(); } catch (e) { if (e instanceof NeedAuth) throw e; errs.push(e); } }
  }));
  if (errs.length) throw errs[0];
}

// ---------- lifecycle ----------
export async function connect() {
  store.set('driveOn', true);
  await signIn();
  store.set('forceExport', true);
  dirtyExport = true;
  // everything local must be pushed at least once
  for (const [id, d] of docs) if (!d._new) dirtyDocs.add(id);
  dirtyIndex = true; persistDirty();
  await syncNow();
}
export function disconnect() {
  store.set('driveOn', false);
  const t = cachedToken(); if (t && window.google?.accounts?.oauth2) google.accounts.oauth2.revoke(t, () => {});
  token = null; store.set('tok', null); setStatus('off');
}
export async function reconnect() { await signIn(); await syncNow(); }
export async function resetDriveLink() { for (const k of ['drive:folders', 'drive:docs', 'drive:lastPull', 'drive:indexId', 'drive:indexTime', 'drive:exportId']) await db.meta.set(k, null); }

export function start() {
  if (!enabled()) { setStatus('off'); return; }
  loadGIS().catch(() => {});
  status.pending = pendingMedia();
  cachedToken() ? syncNow() : setStatus('needs-auth');
  setInterval(() => { if (document.visibilityState === 'visible') syncNow(); }, 90e3);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncNow(); });
  addEventListener('online', () => syncNow());
}
