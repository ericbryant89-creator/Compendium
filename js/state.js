// In-memory model of all notes/boards/media, persisted to IndexedDB.
import * as db from './db.js';
import { uid, now, bus, extractTags } from './util.js';

export const docs = new Map();   // id -> note | board
export const media = new Map();  // id -> media record
export let categories = [];      // explicitly created category names
let mediaRev = 0;

export async function load() {
  for (const d of await db.all('docs')) docs.set(d.id, d);
  for (const m of await db.all('media')) media.set(m.id, m);
  categories = (await db.meta.get('categories')) || [];
}

export function newNote(extra = {}) {
  const d = { id: uid(), type: 'note', title: '', blocks: [{ id: uid(), t: 'text', text: '' }], tags: [], thumb: null, pinned: false, created: now(), updated: now(), ...extra };
  docs.set(d.id, d);
  return d;
}
export function newBoard(extra = {}) {
  const d = { id: uid(), type: 'board', title: '', items: [], tags: [], thumb: null, pinned: false, created: now(), updated: now(), ...extra };
  docs.set(d.id, d);
  return d;
}
export async function save(d, { touch = true, sync = true } = {}) {
  if (touch) d.updated = now();
  docs.set(d.id, d);
  stCache.delete(d.id);
  await db.put('docs', strip(d));
  if (sync) bus.emit('dirty:doc', d.id);
  bus.emit('doc', d);
}
// remove transient (underscore) fields before storing
export function strip(d) {
  const o = {};
  for (const k in d) if (!k.startsWith('_')) o[k] = d[k];
  return o;
}
export async function saveMedia(m, { sync = true } = {}) {
  m.updated = now();
  media.set(m.id, m);
  mediaRev++;
  await db.put('media', m);
  if (sync) bus.emit('dirty:media', m.id);
}
export function mediaTouched() { mediaRev++; stCache.clear(); }

export function isEmptyNote(d) {
  return d.type === 'note' && !d.title.trim() && !d.thumb && d.blocks.every(b => b.t === 'text' && !b.text.trim());
}
export async function trash(d) { d.deleted = true; await save(d); }
export async function restore(d) { delete d.deleted; await save(d); }
export async function purge(d) {
  const t = { id: d.id, type: d.type, purged: true, created: d.created, updated: now() };
  docs.set(d.id, t);
  await save(t, { touch: false });
}
export async function discard(d) { // delete a never-synced empty note silently
  docs.delete(d.id); stCache.delete(d.id);
  await db.del('docs', d.id);
}
export const live = d => d && !d.purged && !d.deleted;

export function tagsOf(d) {
  const m = new Map();
  const add = t => { const k = t.toLowerCase(); if (!m.has(k)) m.set(k, t); };
  (d.tags || []).forEach(add);
  extractTags(d.title).forEach(add);
  if (d.type === 'note') for (const b of d.blocks || []) { if (b.t === 'text') extractTags(b.text).forEach(add); if (b.caption) extractTags(b.caption).forEach(add); }
  else for (const i of d.items || []) if (i.k === 'text') extractTags(i.text).forEach(add);
  return [...m.values()];
}
export function hasTag(d, tag) { tag = tag.toLowerCase(); return tagsOf(d).some(t => t.toLowerCase() === tag); }

export function allTags() {
  const counts = new Map();
  for (const d of docs.values()) if (live(d)) for (const t of tagsOf(d)) {
    const k = t.toLowerCase(); const c = counts.get(k) || { name: t, count: 0 }; c.count++; counts.set(k, c);
  }
  for (const c of categories) { const k = c.toLowerCase(); if (!counts.has(k)) counts.set(k, { name: c, count: 0 }); }
  return [...counts.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}
export async function addCategory(name) {
  name = name.replace(/^#/, '').trim().replace(/\s+/g, '-');
  if (!name) return;
  if (!categories.some(c => c.toLowerCase() === name.toLowerCase())) { categories.push(name); await db.meta.set('categories', categories); bus.emit('categories'); bus.emit('dirty:meta'); }
  return name;
}
export async function removeCategory(name) {
  categories = categories.filter(c => c.toLowerCase() !== name.toLowerCase());
  await db.meta.set('categories', categories); bus.emit('categories'); bus.emit('dirty:meta');
}
export async function setCategories(list) { categories = list; await db.meta.set('categories', list); bus.emit('categories'); }

// media used by a doc
export function mediaOf(d) {
  if (d.type === 'note') return d.blocks.filter(b => (b.t === 'image' || b.t === 'file') && b.media).map(b => b.media);
  return (d.items || []).filter(i => i.k === 'img').map(i => i.media);
}
export function coverOf(d) {
  if (d.thumb) return d.thumb;
  if (d.type === 'note') { const b = d.blocks.find(b => b.t === 'image'); return b ? b.media : null; }
  const imgs = (d.items || []).filter(i => i.k === 'img');
  if (!imgs.length) return null;
  return imgs.slice().sort((a, b) => (a.y - b.y) || (a.x - b.x))[0].media;
}
export function snippet(d, n = 220) {
  if (d.type === 'note') return d.blocks.filter(b => b.t === 'text').map(b => b.text).join(' ').replace(/\s+/g, ' ').trim().slice(0, n);
  const imgs = (d.items || []).filter(i => i.k === 'img').length;
  const texts = (d.items || []).filter(i => i.k === 'text').map(i => i.text).join(' ').replace(/\s+/g, ' ').trim();
  return (`${imgs} image${imgs === 1 ? '' : 's'}` + (texts ? ' · ' + texts : '')).slice(0, n);
}

// ---------- search ----------
const stCache = new Map();
function searchText(d) {
  const c = stCache.get(d.id);
  if (c && c.u === d.updated && c.r === mediaRev) return c.s;
  const parts = [d.title, tagsOf(d).map(t => '#' + t).join(' ')];
  if (d.type === 'note') for (const b of d.blocks) {
    if (b.t === 'text') parts.push(b.text);
    if (b.t === 'link') parts.push(b.url, b.label || '');
    if (b.caption) parts.push(b.caption);
    if (b.media) { const m = media.get(b.media); if (m) parts.push(m.name, ...(m.ai?.tags || []), m.ai?.caption || ''); }
  } else for (const i of d.items || []) {
    if (i.k === 'text') parts.push(i.text);
    if (i.k === 'img') { const m = media.get(i.media); if (m?.ai) parts.push(...(m.ai.tags || []), m.ai.caption || ''); }
  }
  const s = parts.join('\n').toLowerCase();
  stCache.set(d.id, { u: d.updated, r: mediaRev, s });
  return s;
}
export function parseQuery(q) {
  const terms = [], tags = [];
  for (const w of q.trim().split(/\s+/).filter(Boolean)) w.startsWith('#') && w.length > 1 ? tags.push(w.slice(1).toLowerCase()) : terms.push(w.toLowerCase());
  return { terms, tags };
}
export function matches(d, pq) {
  if (pq.tags.length) { const dt = tagsOf(d).map(t => t.toLowerCase()); if (!pq.tags.every(t => dt.includes(t))) return false; }
  if (pq.terms.length) { const s = searchText(d); if (!pq.terms.every(t => s.includes(t))) return false; }
  return true;
}
// images whose AI tags/caption/name match all terms
export function searchImages(pq) {
  if (!pq.terms.length) return [];
  const usage = new Map();
  for (const d of docs.values()) if (live(d)) for (const id of mediaOf(d)) if (!usage.has(id)) usage.set(id, d);
  const out = [];
  for (const [id, d] of usage) {
    const m = media.get(id); if (!m || !m.mime?.startsWith('image/')) continue;
    const s = [m.name, ...(m.ai?.tags || []), m.ai?.caption || ''].join(' ').toLowerCase();
    if (pq.terms.every(t => s.includes(t))) out.push({ media: m, doc: d });
  }
  return out;
}
