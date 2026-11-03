// Import VizRef boards: either the raw iPad "PrivateDocuments" folder (.VRB/.VRI + binary plists)
// or the "VizRef Export" folder (boards.json + Boards/...).
import { uid, now, pick, toast } from './util.js';
import { newBoard, save, docs, addCategory, live } from './state.js';
import * as Media from './media.js';
import { progressModal } from './ui.js';
import * as db from './db.js';

// ---------- binary plist (bplist00) parser ----------
export function parseBplist(buf) {
  const u8 = new Uint8Array(buf), dv = new DataView(buf);
  if (String.fromCharCode(...u8.slice(0, 8)) !== 'bplist00') throw new Error('Not a binary plist');
  const T = u8.length - 32;
  const offSize = u8[T + 6], refSize = u8[T + 7];
  const readN = (pos, n) => { let v = 0; for (let i = 0; i < n; i++) v = v * 256 + u8[pos + i]; return v; };
  const numObjs = readN(T + 8, 8), top = readN(T + 16, 8), tableOff = readN(T + 24, 8);
  const offsets = []; for (let i = 0; i < numObjs; i++) offsets.push(readN(tableOff + i * offSize, offSize));
  const cache = new Map();
  function lenAt(pos, info) {
    if (info !== 0xF) return [info, pos + 1];
    const m = u8[pos + 1]; const n = 1 << (m & 0xF);
    return [readN(pos + 2, n), pos + 2 + n];
  }
  function obj(i) {
    if (cache.has(i)) return cache.get(i);
    const pos = offsets[i], b = u8[pos], type = b >> 4, info = b & 0xF; let v;
    switch (type) {
      case 0x0: v = info === 8 ? false : info === 9 ? true : null; break;
      case 0x1: { const n = 1 << info; v = n === 8 ? Number(dv.getBigInt64(pos + 1)) : readN(pos + 1, n); break; }
      case 0x2: v = (1 << info) === 4 ? dv.getFloat32(pos + 1) : dv.getFloat64(pos + 1); break;
      case 0x3: v = new Date((978307200 + dv.getFloat64(pos + 1)) * 1000); break;
      case 0x4: { const [n, p] = lenAt(pos, info); v = u8.slice(p, p + n); break; }
      case 0x5: { const [n, p] = lenAt(pos, info); v = new TextDecoder('latin1').decode(u8.slice(p, p + n)); break; }
      case 0x6: { const [n, p] = lenAt(pos, info); let s = ''; for (let k = 0; k < n; k++) s += String.fromCharCode(dv.getUint16(p + k * 2)); v = s; break; }
      case 0x8: v = { UID: readN(pos + 1, info + 1) }; break;
      case 0xA: { const [n, p] = lenAt(pos, info); v = []; cache.set(i, v); for (let k = 0; k < n; k++) v.push(obj(readN(p + k * refSize, refSize))); return v; }
      case 0xD: { const [n, p] = lenAt(pos, info); v = {}; cache.set(i, v); for (let k = 0; k < n; k++) v[obj(readN(p + k * refSize, refSize))] = obj(readN(p + (n + k) * refSize, refSize)); return v; }
      default: v = null;
    }
    cache.set(i, v); return v;
  }
  return obj(top);
}
// Resolve an NSKeyedArchiver root into a plain object (one level of UID references)
function unarchive(pl) {
  const objs = pl.$objects; const root = objs[pl.$top.root.UID];
  const out = {};
  for (const [k, v] of Object.entries(root)) out[k] = v && typeof v === 'object' && 'UID' in v ? objs[v.UID] : v;
  return out;
}
const nums = s => (String(s).match(/-?[\d.]+(?:e-?\d+)?/gi) || []).map(Number);

// ---------- entry point ----------
export async function importVizRef() {
  toast('Choose the VizRef folder (the iPad "PrivateDocuments" folder, or the "VizRef Export" folder)', 5000);
  const files = await pick({ dir: true });
  if (!files.length) return;
  const byPath = new Map(files.map(f => [f.webkitRelativePath || f.name, f]));
  const paths = [...byPath.keys()];
  let plan;
  const bj = paths.find(p => /(^|\/)boards\.json$/.test(p));
  if (bj) plan = await planFromExport(byPath, bj);
  else if (paths.some(p => /\.VRB\//i.test(p))) plan = await planFromVRB(byPath, paths);
  else { toast('No VizRef boards found in that folder.'); return; }
  return runPlan(plan);
}

async function planFromExport(byPath, bjPath) {
  const base = bjPath.slice(0, bjPath.length - 'boards.json'.length);
  const data = JSON.parse(await byPath.get(bjPath).text());
  return data.map(b => ({
    name: b.name,
    cover: b.cover ? byPath.get(base + b.cover) : null,
    images: b.images.map(i => ({ file: byPath.get(base + i.f), x: i.x, y: i.y, w: i.w, h: i.h, z: i.z, mh: i.mh, mv: i.mv, g: i.g })).filter(i => i.file),
  }));
}

async function planFromVRB(byPath, paths) {
  const boards = new Map(); // board dir -> {plist, cover, vris: Map}
  for (const p of paths) {
    if (p.includes('__MACOSX')) continue;
    const m = p.match(/^(.*?[^/]+\.VRB)\/(.*)$/i); if (!m) continue;
    const [, dir, rest] = m;
    const b = boards.get(dir) || { vris: new Map() }; boards.set(dir, b);
    if (rest === 'Data.plist') b.plist = byPath.get(p);
    else if (rest === 'thumb.png') b.cover = byPath.get(p);
    else { const vm = rest.match(/^([^/]+\.VRI)\/(Data\.plist|image\.\w+)$/i); if (vm) { const v = b.vris.get(vm[1]) || {}; vm[2] === 'Data.plist' ? v.plist = byPath.get(p) : v.img = byPath.get(p); b.vris.set(vm[1], v); } }
  }
  const plan = [];
  for (const [dir, b] of boards) {
    let name = dir.split('/').pop().replace(/\.VRB$/i, ''), order = name;
    if (b.plist) try { const o = unarchive(parseBplist(await b.plist.arrayBuffer())); if (typeof o.name === 'string') name = o.name; if (o.order != null) order = String(o.order); } catch (e) { console.warn(e); }
    const images = [];
    for (const v of b.vris.values()) {
      if (!v.img || !v.plist) continue;
      try {
        const o = unarchive(parseBplist(await v.plist.arrayBuffer()));
        const [x, y, w, hh] = nums(o.Frame);
        images.push({ file: v.img, x, y, w, h: hh, z: o.Layer || 0, mh: !!o.isMirroredHorizontal, mv: !!o.isMirroredVertical, g: !!o.isGrayscale });
      } catch (e) { console.warn('skip', e); }
    }
    if (images.length) {
      const mx = Math.min(...images.map(i => i.x)), my = Math.min(...images.map(i => i.y));
      for (const i of images) { i.x -= mx; i.y -= my; }
    }
    plan.push({ name, order, cover: b.cover || null, images });
  }
  plan.sort((a, b) => String(a.order).localeCompare(String(b.order), undefined, { numeric: true }));
  return plan;
}

async function runPlan(plan) {
  const done = (await db.meta.get('vizrefImported')) || {};
  const todo = plan.filter(b => !done[b.name] || !docs.get(done[b.name]) || !live(docs.get(done[b.name])));
  const total = todo.reduce((n, b) => n + b.images.length, 0);
  if (!todo.length) { toast('All of these boards are already imported.'); return; }
  await addCategory('vizref');
  const pm = progressModal(`Importing ${todo.length} VizRef board${todo.length > 1 ? 's' : ''}`);
  let n = 0, boardsDone = 0;
  try {
    for (const b of todo) {
      if (pm.cancelled) break;
      const d = newBoard({ title: b.name, tags: ['vizref'] });
      const items = [];
      for (const i of b.images) {
        if (pm.cancelled) break;
        pm.set(n / total, `${b.name} — image ${items.length + 1} of ${b.images.length}  (${n} / ${total} total)`);
        const rec = await Media.addFile(i.file, { name: `${b.name} ${String(items.length + 1).padStart(3, '0')}.${(i.file.name.split('.').pop() || 'png')}` });
        items.push({ id: uid(), k: 'img', media: rec.id, x: i.x, y: i.y, w: i.w, h: i.h, z: i.z, mh: i.mh || undefined, mv: i.mv || undefined, g: i.g || undefined });
        n++;
      }
      if (pm.cancelled && items.length < b.images.length) { await import('./state.js').then(m => m.discard(d)); break; }
      d.items = items;
      if (b.cover) { const c = await Media.addFile(b.cover, { name: `${b.name} cover.png` }); d.thumb = c.id; }
      await save(d);
      done[b.name] = d.id; await db.meta.set('vizrefImported', done);
      boardsDone++;
    }
    pm.done(pm.cancelled ? `Stopped. ${boardsDone} board(s) imported — run the import again to continue where it left off.` : `Done: ${boardsDone} board(s), ${n} images.`);
  } catch (e) {
    console.error(e); pm.done('Import hit an error: ' + e.message + '. Run it again to continue.');
  }
}
