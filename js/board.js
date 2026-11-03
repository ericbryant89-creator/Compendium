// Infinite reference board: images, text notes and ink strokes on a pan/zoom canvas.
import { h, uid, debounce, pick, toast, promptBox, store } from './util.js';
import { save, media, tagsOf, trash, addCategory } from './state.js';
import * as Media from './media.js';
import { icon, ibtn, lightbox, menu, chip } from './ui.js';
import { THUMB_MAX } from './config.js';

const SVGNS = 'http://www.w3.org/2000/svg';
const COLORS = ['#111111', '#ffffff', '#e5484d', '#f0a33b', '#3e8ef7', '#30a46c', '#a26df0'];

export function openBoard(root, d, { onClose }) {
  d.items ||= [];
  let s = 1, tx = 0, ty = 0;
  let tool = 'select';
  let penColor = store.get('penColor', '#e5484d'), penWidth = store.get('penWidth', 4), hiliter = false;
  const sel = new Set();
  const els = new Map(); // id -> element
  const undoStack = [], redoStack = [];
  let pending = null;
  let sawPen = false;

  let dirty = false;
  const saveNow = debounce(() => { if (!dirty) return; dirty = false; delete d._new; save(d); }, 700);
  const saveSoon = () => { dirty = true; saveNow(); };
  saveSoon.flush = () => saveNow.flush();
  const begin = () => { if (!pending) pending = JSON.stringify(d.items); };
  const commit = () => {
    if (pending == null) return;
    const now = JSON.stringify(d.items);
    if (now !== pending) { undoStack.push(pending); if (undoStack.length > 80) undoStack.shift(); redoStack.length = 0; saveSoon(); updateUndo(); }
    pending = null;
  };
  const maxZ = () => d.items.reduce((m, i) => Math.max(m, i.z || 0), 0);
  const minZ = () => d.items.reduce((m, i) => Math.min(m, i.z || 0), 0);

  // ---------- DOM ----------
  const titleIn = h('input', { class: 'bd-title', placeholder: 'Untitled board', value: d.title || '' });
  titleIn.addEventListener('input', () => { d.title = titleIn.value; saveSoon(); renderTagChips(); });
  const tagRow = h('div', { class: 'bd-tags' });
  const undoB = ibtn('undo', 'Undo (Ctrl+Z)', () => undo());
  const redoB = ibtn('redo', 'Redo (Ctrl+Y)', () => redo());
  const moreB = ibtn('more', 'More', () => menu(moreB, [
    { label: 'Add images', icon: 'image', run: () => addFiles() },
    { label: 'Add to category', icon: 'hash', run: addTag },
    d.thumb && { label: 'Remove custom thumbnail', icon: 'x', run: () => { d.thumb = null; saveSoon(); toast('Thumbnail removed'); } },
    { label: 'Fit everything', icon: 'fit', run: fit },
    '-',
    { label: 'Move board to trash', icon: 'trash', danger: true, run: async () => { await trash(d); close(true); } },
  ]));
  const world = h('div', { class: 'bd-world' });
  const ink = document.createElementNS(SVGNS, 'svg'); ink.classList.add('bd-ink');
  world.append(ink);
  const overlay = h('div', { class: 'bd-overlay' });
  const marquee = h('div', { class: 'bd-marquee', hidden: true });
  const stage = h('div', { class: 'bd-stage', tabindex: '0' }, world, overlay, marquee);
  const empty = h('div', { class: 'bd-empty' }, h('div', {}, icon('image', 34)), h('p', {}, 'Drop, paste or add images to start this board.'), h('button', { class: 'btn primary', onclick: () => addFiles() }, icon('plus', 18), 'Add images'));

  const toolBtns = {};
  const tb = (name, ic, title) => (toolBtns[name] = h('button', { class: 'tool', title, 'aria-label': title, onclick: () => setTool(name) }, icon(ic)));
  const swatches = h('div', { class: 'swatches' }, COLORS.map(c => h('button', { class: 'sw', style: { background: c }, title: c, onclick: () => { penColor = c; hiliter = false; store.set('penColor', c); setTool('pen'); updatePenUI(); } })),
    h('button', { class: 'sw hl', title: 'Highlighter', onclick: () => { hiliter = !hiliter; setTool('pen'); updatePenUI(); } }, 'H'));
  const widths = h('div', { class: 'widths' }, [2, 4, 8, 16].map(w => h('button', { class: 'wd', title: `Size ${w}`, onclick: () => { penWidth = w; store.set('penWidth', w); setTool('pen'); updatePenUI(); } }, h('i', { style: { width: Math.min(16, w + 2) + 'px', height: Math.min(16, w + 2) + 'px' } }))));
  const penOpts = h('div', { class: 'pen-opts' }, swatches, widths);
  const tools = h('div', { class: 'bd-tools' },
    tb('select', 'cursor', 'Select & move (V)'), tb('pen', 'pen', 'Draw (P)'), tb('eraser', 'eraser', 'Erase strokes (E)'), tb('text', 'text', 'Text note (T)'),
    h('button', { class: 'tool', title: 'Add images', onclick: () => addFiles() }, icon('image')),
    h('span', { class: 'sep' }), h('button', { class: 'tool', title: 'Fit (F)', onclick: fit }, icon('fit')));
  const selBar = h('div', { class: 'bd-selbar', hidden: true });

  const view = h('div', { class: 'editor board-editor' },
    h('header', { class: 'ed-bar' }, ibtn('back', 'Back', () => close()), titleIn, tagRow, h('div', { class: 'grow' }), undoB, redoB, moreB),
    stage, empty, penOpts, tools, selBar);
  root.append(view);

  // ---------- rendering ----------
  function apply() { world.style.transform = `translate(${tx}px,${ty}px) scale(${s})`; drawOverlay(); refreshImages(); }
  function renderAll() {
    for (const el of els.values()) el.remove();
    els.clear(); ink.innerHTML = '';
    for (const it of d.items) mount(it);
    empty.hidden = d.items.length > 0;
    refreshImages(true); drawOverlay();
  }
  function mount(it) {
    let el;
    if (it.k === 'img') {
      el = h('img', { class: 'bd-img', draggable: 'false', alt: '' });
      el.addEventListener('error', () => { el.dataset.v = ''; });
    } else if (it.k === 'text') {
      el = h('div', { class: 'bd-text' });
      el.addEventListener('blur', () => { if (el.isContentEditable) finishText(it, el); });
    } else if (it.k === 'stroke') {
      el = document.createElementNS(SVGNS, 'path'); el.classList.add('bd-stroke');
      ink.append(el);
    }
    el.dataset.id = it.id; els.set(it.id, el);
    if (it.k !== 'stroke') world.insertBefore(el, ink);
    style(it);
  }
  function style(it) {
    const el = els.get(it.id); if (!el) return;
    if (it.k === 'stroke') {
      el.setAttribute('d', pathD(it.pts)); el.setAttribute('stroke', it.color); el.setAttribute('stroke-width', it.width);
      el.setAttribute('stroke-opacity', it.op ?? 1); it._bb = null; return;
    }
    Object.assign(el.style, { left: it.x + 'px', top: it.y + 'px', width: it.w + 'px', zIndex: (it.z || 0) + 1000 });
    if (it.k === 'img') {
      el.style.height = it.h + 'px';
      const t = []; if (it.mh) t.push('scaleX(-1)'); if (it.mv) t.push('scaleY(-1)');
      el.style.transform = t.join(' '); el.style.filter = it.g ? 'grayscale(1)' : '';
    } else {
      el.style.fontSize = (it.size || 32) + 'px'; el.style.color = it.color || ''; el.style.background = it.bg || '';
      if (!el.isContentEditable) el.textContent = it.text || '';
    }
  }
  function pathD(p) {
    if (!p || p.length < 2) return '';
    if (p.length < 6) return `M${p[0]} ${p[1]}L${p[0] + 0.01} ${p[1]}`;
    let s0 = `M${p[0].toFixed(1)} ${p[1].toFixed(1)}`;
    for (let i = 2; i < p.length - 2; i += 2) {
      const mx = (p[i] + p[i + 2]) / 2, my = (p[i + 1] + p[i + 3]) / 2;
      s0 += `Q${p[i].toFixed(1)} ${p[i + 1].toFixed(1)} ${mx.toFixed(1)} ${my.toFixed(1)}`;
    }
    return s0 + `L${p[p.length - 2].toFixed(1)} ${p[p.length - 1].toFixed(1)}`;
  }
  // choose thumbnail vs preview per image based on on-screen size; skip offscreen images
  let refreshQueued = false;
  function refreshImages(now) {
    if (!now) { if (refreshQueued) return; refreshQueued = true; requestAnimationFrame(() => { refreshQueued = false; refreshImages(true); }); return; }
    const r = stage.getBoundingClientRect(), W = r.width, H = r.height, M = Math.max(W, H) * 0.5, dpr = devicePixelRatio || 1;
    for (const it of d.items) {
      if (it.k !== 'img') continue;
      const el = els.get(it.id); if (!el) continue;
      const sx = it.x * s + tx, sy = it.y * s + ty, sw = it.w * s, sh = it.h * s;
      if (sx > W + M || sy > H + M || sx + sw < -M || sy + sh < -M) continue;
      const want = sw * dpr > THUMB_MAX * 1.15 ? 'p' : 't';
      const cur = el.dataset.v;
      if (cur === want || cur === 'p' || cur === 'loading-' + want) continue;
      const c = Media.cachedURL(it.media, want);
      if (c) { el.src = c; el.dataset.v = want; continue; }
      el.dataset.v = 'loading-' + want;
      Media.url(it.media, want).then(u => { if (u) { el.src = u; } el.dataset.v = u ? want : ''; });
    }
  }

  // ---------- geometry ----------
  const toWorld = (cx, cy) => { const r = stage.getBoundingClientRect(); return [(cx - r.left - tx) / s, (cy - r.top - ty) / s]; };
  function bbox(it) {
    if (it.k === 'stroke') {
      if (!it._bb) { let a = Infinity, b = Infinity, c = -Infinity, e = -Infinity; for (let i = 0; i < it.pts.length; i += 2) { a = Math.min(a, it.pts[i]); c = Math.max(c, it.pts[i]); b = Math.min(b, it.pts[i + 1]); e = Math.max(e, it.pts[i + 1]); } const pad = it.width / 2; it._bb = [a - pad, b - pad, c + pad, e + pad]; }
      return it._bb;
    }
    if (it.k === 'text') { const el = els.get(it.id); const hh = el ? el.offsetHeight : (it.size || 32) * 1.4; return [it.x, it.y, it.x + it.w, it.y + hh]; }
    return [it.x, it.y, it.x + it.w, it.y + it.h];
  }
  function unionBox(list) {
    let a = Infinity, b = Infinity, c = -Infinity, e = -Infinity;
    for (const it of list) { const q = bbox(it); a = Math.min(a, q[0]); b = Math.min(b, q[1]); c = Math.max(c, q[2]); e = Math.max(e, q[3]); }
    return a === Infinity ? null : [a, b, c, e];
  }
  function fit() {
    const bb = unionBox(d.items); const r = stage.getBoundingClientRect();
    if (!bb) { s = 1; tx = r.width / 2; ty = r.height / 2; apply(); return; }
    const W = bb[2] - bb[0] || 1, H = bb[3] - bb[1] || 1;
    s = Math.min(r.width / W, r.height / H) * 0.92; s = Math.min(s, 2);
    tx = (r.width - W * s) / 2 - bb[0] * s; ty = (r.height - H * s) / 2 - bb[1] * s; apply();
  }
  function zoomAt(f, cx, cy) {
    const r = stage.getBoundingClientRect(); cx -= r.left; cy -= r.top;
    const ns = Math.min(10, Math.max(0.005, s * f));
    tx = cx - (cx - tx) * ns / s; ty = cy - (cy - ty) * ns / s; s = ns; apply(); saveView();
  }
  const saveView = debounce(() => { const r = stage.getBoundingClientRect(); store.set('view:' + d.id, { s, cx: (r.width / 2 - tx) / s, cy: (r.height / 2 - ty) / s }); }, 400);
  function restoreView() {
    const v = store.get('view:' + d.id); const r = stage.getBoundingClientRect();
    if (v && v.s) { s = v.s; tx = r.width / 2 - v.cx * s; ty = r.height / 2 - v.cy * s; apply(); } else fit();
  }

  // ---------- selection ----------
  const selected = () => d.items.filter(i => sel.has(i.id));
  function select(ids, add = false) { if (!add) sel.clear(); for (const id of ids) sel.add(id); drawOverlay(); }
  function drawOverlay() {
    overlay.innerHTML = '';
    for (const [id, el] of els) el.classList?.toggle('sel', sel.has(id));
    const list = selected();
    selBar.hidden = !list.length || tool !== 'select';
    if (!list.length) return;
    const bb = unionBox(list);
    const x = bb[0] * s + tx, y = bb[1] * s + ty, w = (bb[2] - bb[0]) * s, hh = (bb[3] - bb[1]) * s;
    overlay.append(h('div', { class: 'sel-box', style: { left: x + 'px', top: y + 'px', width: w + 'px', height: hh + 'px' } }),
      h('div', { class: 'sel-handle', 'data-handle': 'se', style: { left: x + w + 'px', top: y + hh + 'px' } }));
    renderSelBar(list);
  }
  function renderSelBar(list) {
    selBar.innerHTML = '';
    const imgs = list.filter(i => i.k === 'img'), one = list.length === 1 ? list[0] : null;
    const act = (ic, title, fn) => ibtn(ic, title, () => { begin(); fn(); for (const i of selected()) style(i); commit(); drawOverlay(); });
    if (one?.k === 'img') selBar.append(ibtn('search', 'View full size', () => openImage(one)));
    if (one?.k === 'text') selBar.append(ibtn('pen', 'Edit text', () => editText(one)));
    selBar.append(act('front', 'Bring to front', () => { let z = maxZ(); for (const i of selected()) i.z = ++z; }),
      act('sendback', 'Send to back', () => { let z = minZ(); for (const i of selected().reverse()) i.z = --z; }));
    if (imgs.length) selBar.append(act('flip', 'Flip horizontally', () => imgs.forEach(i => i.mh = !i.mh)), act('gray', 'Grayscale', () => imgs.forEach(i => i.g = !i.g)));
    if (one?.k === 'img') selBar.append(ibtn('star', 'Use as board thumbnail', () => { d.thumb = one.media; saveSoon(); toast('Board thumbnail set'); }));
    if (one?.k === 'text') selBar.append(...COLORS.slice(0, 5).map(c => h('button', { class: 'sw sm', style: { background: c }, title: 'Text color', onclick: () => { begin(); one.color = c; style(one); commit(); } })));
    selBar.append(ibtn('trash', 'Delete', () => delSelected(), 'danger'));
    selBar.append(h('span', { class: 'dim small sel-count' }, list.length > 1 ? `${list.length} selected` : ''));
  }
  function delSelected() {
    if (!sel.size) return; begin();
    d.items = d.items.filter(i => !sel.has(i.id));
    for (const id of sel) { els.get(id)?.remove(); els.delete(id); }
    sel.clear(); commit(); drawOverlay(); empty.hidden = d.items.length > 0;
  }
  function openImage(it) {
    const list = d.items.filter(i => i.k === 'img').sort((a, b) => (a.y - b.y) || (a.x - b.x)).map(i => i.media);
    lightbox(it.media, { list });
  }

  // ---------- tools ----------
  function setTool(t) {
    tool = t;
    for (const [n, b] of Object.entries(toolBtns)) b.classList.toggle('on', n === t);
    stage.dataset.tool = t;
    penOpts.hidden = t !== 'pen';
    if (t !== 'select') { sel.clear(); }
    drawOverlay(); updatePenUI();
  }
  function updatePenUI() {
    swatches.querySelectorAll('.sw').forEach(b => b.classList.toggle('on', b.classList.contains('hl') ? hiliter : (!hiliter && b.title === penColor)));
    widths.querySelectorAll('.wd').forEach((b, i) => b.classList.toggle('on', [2, 4, 8, 16][i] === penWidth));
  }

  // text items
  function editText(it) {
    const el = els.get(it.id); if (!el) return;
    el.contentEditable = 'true'; el.classList.add('editing');
    setTimeout(() => { el.focus(); const r = document.createRange(); r.selectNodeContents(el); const sl = getSelection(); sl.removeAllRanges(); sl.addRange(r); }, 0);
  }
  function finishText(it, el) {
    el.contentEditable = 'false'; el.classList.remove('editing');
    const txt = el.innerText.replace(/\n$/, '');
    if (!txt.trim()) { begin(); d.items = d.items.filter(i => i !== it); el.remove(); els.delete(it.id); sel.delete(it.id); commit(); drawOverlay(); return; }
    if (txt !== it.text) { begin(); it.text = txt; commit(); renderTagChips(); }
    drawOverlay();
  }
  function addTextAt(wx, wy) {
    begin();
    const it = { id: uid(), k: 'text', x: wx, y: wy, w: 320 / s, size: 22 / s, text: '', z: maxZ() + 1 };
    d.items.push(it); mount(it); pending = pending; // commit when finished editing
    commit();
    setTool('select'); select([it.id]); editText(it); empty.hidden = true;
  }

  // images
  async function addFiles(files, at) {
    files ||= await pick({ accept: 'image/*', multiple: true });
    files = files.filter(f => (f.type || '').startsWith('image/') || /\.(png|jpe?g|gif|webp|avif|bmp|heic)$/i.test(f.name));
    if (!files.length) return;
    const r = stage.getBoundingClientRect();
    let [wx, wy] = at || [(r.width / 2 - tx) / s, (r.height / 2 - ty) / s];
    const W = 280 / s, gap = 16 / s;
    begin();
    const added = [];
    let x = wx - (Math.min(files.length, 4) * (W + gap)) / 2, y = wy - W / 2, rowH = 0, col = 0;
    for (const f of files) {
      const rec = await Media.addFile(f);
      const hh = W * Media.aspect(rec);
      const it = { id: uid(), k: 'img', media: rec.id, x, y, w: W, h: hh, z: maxZ() + 1 };
      d.items.push(it); mount(it); added.push(it.id);
      rowH = Math.max(rowH, hh); x += W + gap;
      if (++col === 4) { col = 0; x = wx - (4 * (W + gap)) / 2; y += rowH + gap; rowH = 0; }
    }
    commit(); empty.hidden = true; setTool('select'); select(added); refreshImages();
  }

  // ---------- pointer handling ----------
  const pts = new Map();
  let mode = null, start = null, moved = 0, lastD = 0, lastMid = null, stroke = null, lastTap = null;
  stage.addEventListener('pointerdown', e => {
    if (e.target.isContentEditable) return;
    if (e.pointerType === 'pen') sawPen = true;
    stage.focus({ preventScroll: true });
    stage.setPointerCapture(e.pointerId);
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });
    if (pts.size === 2) {
      if (mode === 'draw' && stroke) { stroke.el.remove(); stroke = null; }
      if (mode === 'drag' || mode === 'resize') commit();
      mode = 'pinch'; const [a, b] = [...pts.values()]; lastD = Math.hypot(a.x - b.x, a.y - b.y); lastMid = [(a.x + b.x) / 2, (a.y + b.y) / 2]; return;
    }
    if (pts.size > 2) return;
    moved = 0;
    const [wx, wy] = toWorld(e.clientX, e.clientY);
    const fingerPans = e.pointerType === 'touch' && sawPen;
    if (e.button === 1 || (e.button === 0 && e.altKey)) { mode = 'pan'; return; }
    if ((tool === 'pen') && !fingerPans) {
      mode = 'draw';
      const el = document.createElementNS(SVGNS, 'path'); el.classList.add('bd-stroke');
      const width = (hiliter ? penWidth * 4 : penWidth) / s;
      el.setAttribute('stroke', penColor); el.setAttribute('stroke-width', width); el.setAttribute('stroke-opacity', hiliter ? 0.35 : 1);
      ink.append(el); stroke = { el, pts: [wx, wy], width }; return;
    }
    if (tool === 'eraser' && !fingerPans) { mode = 'erase'; begin(); eraseAt(wx, wy); return; }
    if (tool === 'text' && !fingerPans) { e.preventDefault(); mode = null; pts.delete(e.pointerId); setTimeout(() => addTextAt(wx, wy), 0); return; }
    // select tool
    const handle = e.target.dataset?.handle;
    const hit = e.target.closest?.('[data-id]');
    if (tool === 'select' && handle) {
      mode = 'resize'; begin();
      const list = selected(); const bb = unionBox(list);
      start = { bb, list: list.map(i => ({ i, x: i.x, y: i.y, w: i.w, h: i.h, size: i.size, width: i.width, pts: i.pts ? i.pts.slice() : null })) };
      return;
    }
    if (tool === 'select' && hit) {
      const id = hit.dataset.id;
      if (e.shiftKey || e.ctrlKey || e.metaKey) { sel.has(id) ? sel.delete(id) : sel.add(id); drawOverlay(); }
      else if (!sel.has(id)) select([id]);
      mode = 'drag'; begin();
      start = { wx, wy, id, list: selected().map(i => ({ i, x: i.x, y: i.y, pts: i.pts ? i.pts.slice() : null })) };
      return;
    }
    if (tool === 'select' && (e.shiftKey || (e.pointerType === 'mouse' && e.ctrlKey))) { mode = 'marquee'; start = { cx: e.clientX, cy: e.clientY }; return; }
    mode = 'pan';
  });
  stage.addEventListener('pointermove', e => {
    const p = pts.get(e.pointerId); if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY; moved += Math.abs(dx) + Math.abs(dy);
    if (mode === 'pinch' && pts.size === 2) {
      const [a, b] = [...pts.values()]; const dd = Math.hypot(a.x - b.x, a.y - b.y), mid = [(a.x + b.x) / 2, (a.y + b.y) / 2];
      tx += mid[0] - lastMid[0]; ty += mid[1] - lastMid[1]; lastMid = mid;
      if (lastD) zoomAt(dd / lastD, mid[0], mid[1]); lastD = dd; return;
    }
    if (mode === 'pan') { tx += dx; ty += dy; apply(); saveView(); return; }
    const [wx, wy] = toWorld(e.clientX, e.clientY);
    if (mode === 'draw' && stroke) {
      const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      for (const ce of evs) { const [x, y] = toWorld(ce.clientX, ce.clientY); const n = stroke.pts.length; if (Math.hypot(x - stroke.pts[n - 2], y - stroke.pts[n - 1]) * s > 1.5) stroke.pts.push(x, y); }
      stroke.el.setAttribute('d', pathD(stroke.pts)); return;
    }
    if (mode === 'erase') { eraseAt(wx, wy); return; }
    if (mode === 'drag' && start) {
      const ddx = wx - start.wx, ddy = wy - start.wy;
      for (const o of start.list) { if (o.pts) { o.i.pts = o.pts.map((v, k) => v + (k % 2 ? ddy : ddx)); } else { o.i.x = o.x + ddx; o.i.y = o.y + ddy; } style(o.i); }
      drawOverlay(); return;
    }
    if (mode === 'resize' && start) {
      const [x0, y0, x1, y1] = start.bb; const W = x1 - x0, H = y1 - y0;
      const k = Math.max(0.02, Math.max((wx - x0) / W, (wy - y0) / H));
      for (const o of start.list) {
        const it = o.i;
        if (o.pts) { it.pts = o.pts.map((v, j) => (j % 2 ? y0 + (v - y0) * k : x0 + (v - x0) * k)); it.width = o.width * k; }
        else { it.x = x0 + (o.x - x0) * k; it.y = y0 + (o.y - y0) * k; it.w = o.w * k; if (o.h) it.h = o.h * k; if (o.size) it.size = o.size * k; }
        style(it);
      }
      drawOverlay(); refreshImages(); return;
    }
    if (mode === 'marquee') {
      const r = stage.getBoundingClientRect();
      const x = Math.min(start.cx, e.clientX) - r.left, y = Math.min(start.cy, e.clientY) - r.top, w = Math.abs(e.clientX - start.cx), hh = Math.abs(e.clientY - start.cy);
      Object.assign(marquee.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: hh + 'px' }); marquee.hidden = false;
      const a = toWorld(Math.min(start.cx, e.clientX), Math.min(start.cy, e.clientY)), b = toWorld(Math.max(start.cx, e.clientX), Math.max(start.cy, e.clientY));
      sel.clear();
      for (const it of d.items) { const q = bbox(it); if (q[0] < b[0] && q[2] > a[0] && q[1] < b[1] && q[3] > a[1]) sel.add(it.id); }
      drawOverlay();
    }
  });
  function endPointer(e) {
    if (!pts.has(e.pointerId)) return;
    const was = pts.size; pts.delete(e.pointerId);
    if (mode === 'pinch') { if (pts.size === 0) { mode = null; } else if (pts.size === 1) { mode = 'pan'; lastD = 0; } return; }
    if (mode === 'draw' && stroke) {
      if (stroke.pts.length >= 2) {
        begin();
        const it = { id: uid(), k: 'stroke', pts: stroke.pts.map(v => Math.round(v * 10) / 10), color: penColor, width: stroke.width, op: hiliter ? 0.35 : 1, z: 0 };
        d.items.push(it); stroke.el.dataset.id = it.id; els.set(it.id, stroke.el); style(it); commit(); empty.hidden = true;
      } else stroke.el.remove();
      stroke = null;
    }
    if (mode === 'erase') commit();
    if (mode === 'drag' || mode === 'resize') { commit(); refreshImages(); }
    if (mode === 'marquee') { marquee.hidden = true; }
    if (was === 1 && moved < 6) { // tap
      const hit = e.target.closest?.('[data-id]');
      if (mode === 'pan' && tool === 'select') { sel.clear(); drawOverlay(); }
      if (hit && tool === 'select') {
        const id = hit.dataset.id, t = performance.now();
        if (lastTap && lastTap.id === id && t - lastTap.t < 350) {
          const it = d.items.find(i => i.id === id);
          if (it?.k === 'img') openImage(it); else if (it?.k === 'text') editText(it);
          lastTap = null;
        } else lastTap = { id, t };
      }
    }
    mode = null; start = null;
  }
  stage.addEventListener('pointerup', endPointer);
  stage.addEventListener('pointercancel', endPointer);
  stage.addEventListener('wheel', e => {
    e.preventDefault();
    const mouseWheel = !e.ctrlKey && e.deltaMode === 0 && e.deltaX === 0 && Math.abs(e.deltaY) >= 40 && Number.isInteger(e.deltaY);
    if (e.ctrlKey || mouseWheel || e.deltaMode === 1) zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.012 : 0.0018) * (e.deltaMode === 1 ? 30 : 1)), e.clientX, e.clientY);
    else { tx -= e.deltaX; ty -= e.deltaY; apply(); saveView(); }
  }, { passive: false });
  // Safari trackpad pinch
  let gs = 1;
  stage.addEventListener('gesturestart', e => { e.preventDefault(); gs = 1; });
  stage.addEventListener('gesturechange', e => { e.preventDefault(); zoomAt(e.scale / gs, e.clientX, e.clientY); gs = e.scale; });

  function eraseAt(wx, wy) {
    const R = 12 / s; let hit = false;
    d.items = d.items.filter(it => {
      if (it.k !== 'stroke') return true;
      const bb = bbox(it); if (wx < bb[0] - R || wx > bb[2] + R || wy < bb[1] - R || wy > bb[3] + R) return true;
      const p = it.pts;
      for (let i = 0; i + 3 < p.length || i === 0; i += 2) {
        const ax = p[i], ay = p[i + 1], bx = p[i + 2] ?? ax, by = p[i + 3] ?? ay;
        const vx = bx - ax, vy = by - ay, L = vx * vx + vy * vy || 1;
        const t = Math.max(0, Math.min(1, ((wx - ax) * vx + (wy - ay) * vy) / L));
        if (Math.hypot(wx - (ax + t * vx), wy - (ay + t * vy)) < R + it.width / 2) { els.get(it.id)?.remove(); els.delete(it.id); hit = true; return false; }
        if (i + 3 >= p.length) break;
      }
      return true;
    });
    return hit;
  }

  // ---------- keyboard, paste, drop ----------
  const onKey = e => {
    if (!view.isConnected) return;
    const typing = e.target.isContentEditable || /INPUT|TEXTAREA/.test(e.target.tagName);
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !typing) { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y' && !typing) { e.preventDefault(); redo(); return; }
    if (typing) { if (e.key === 'Escape') e.target.blur(); return; }
    if (document.querySelector('.lightbox, .modal-bg')) return;
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); delSelected(); }
    else if (e.key === 'Escape') { sel.clear(); drawOverlay(); setTool('select'); }
    else if ((e.ctrlKey || e.metaKey) && e.key === 'a') { e.preventDefault(); setTool('select'); select(d.items.map(i => i.id)); }
    else if (e.key === 'v') setTool('select'); else if (e.key === 'p') setTool('pen'); else if (e.key === 'e') setTool('eraser'); else if (e.key === 't') setTool('text'); else if (e.key === 'f') fit();
  };
  addEventListener('keydown', onKey);
  const onPaste = e => {
    if (!view.isConnected || e.target.isContentEditable || /INPUT|TEXTAREA/.test(e.target.tagName)) return;
    const files = [...(e.clipboardData?.files || [])];
    if (files.length) { e.preventDefault(); addFiles(files); }
  };
  addEventListener('paste', onPaste);
  stage.addEventListener('dragover', e => { e.preventDefault(); stage.classList.add('drop'); });
  stage.addEventListener('dragleave', () => stage.classList.remove('drop'));
  stage.addEventListener('drop', async e => {
    e.preventDefault(); stage.classList.remove('drop');
    const at = toWorld(e.clientX, e.clientY);
    const files = [...e.dataTransfer.files];
    if (files.length) return addFiles(files, at);
    const u = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
    if (u && /^https?:/.test(u)) {
      try { const r = await fetch(u); const b = await r.blob(); if (!b.type.startsWith('image/')) throw 0; addFiles([new File([b], u.split('/').pop().split('?')[0] || 'image', { type: b.type })], at); }
      catch { toast('That site blocks copying the image directly. Save it first, then drop or paste the file.', 4500); }
    }
  });
  const ro = new ResizeObserver(() => { drawOverlay(); refreshImages(); });
  ro.observe(stage);

  // ---------- undo ----------
  function restoreItems(json) { d.items = JSON.parse(json); sel.clear(); renderAll(); saveSoon(); }
  function undo() { if (!undoStack.length) return; redoStack.push(JSON.stringify(d.items)); restoreItems(undoStack.pop()); updateUndo(); }
  function redo() { if (!redoStack.length) return; undoStack.push(JSON.stringify(d.items)); restoreItems(redoStack.pop()); updateUndo(); }
  function updateUndo() { undoB.disabled = !undoStack.length; redoB.disabled = !redoStack.length; }

  // ---------- tags ----------
  function renderTagChips() {
    tagRow.innerHTML = '';
    const explicit = new Set((d.tags || []).map(t => t.toLowerCase()));
    for (const t of tagsOf(d)) tagRow.append(chip('#' + t, { cls: 'sm', onclick: () => { location.hash = '#tag-' + encodeURIComponent(t.toLowerCase()); }, onremove: explicit.has(t.toLowerCase()) ? () => { d.tags = d.tags.filter(x => x.toLowerCase() !== t.toLowerCase()); saveSoon(); renderTagChips(); } : null }));
    tagRow.append(h('button', { class: 'chip add sm', onclick: addTag }, '+ #'));
  }
  async function addTag() {
    const v = await promptBox('Add this board to a category (#name)', '', 'Add'); if (!v) return;
    const n = await addCategory(v); if (!n) return; d.tags = [...new Set([...(d.tags || []), n])]; saveSoon(); renderTagChips();
  }

  function close(skip) {
    removeEventListener('keydown', onKey); removeEventListener('paste', onPaste); ro.disconnect();
    if (!skip) { if (d._new && !d.items.length && !d.title.trim()) { import('./state.js').then(m => m.discard(d)); } else saveSoon.flush(); }
    view.remove(); onClose?.();
  }

  setTool('select'); renderAll(); renderTagChips(); updateUndo();
  requestAnimationFrame(restoreView);
  if (d._new) setTimeout(() => titleIn.focus(), 50);
  return { close };
}
