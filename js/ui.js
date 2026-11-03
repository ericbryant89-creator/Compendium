import { h, esc } from './util.js';
import * as Media from './media.js';
import { media } from './state.js';

const P = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  note: '<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 13h7M9 17h5"/>',
  board: '<rect x="3" y="3" width="8" height="10" rx="1.5"/><rect x="13" y="3" width="8" height="6" rx="1.5"/><rect x="13" y="11" width="8" height="10" rx="1.5"/><rect x="3" y="15" width="8" height="6" rx="1.5"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
  grid: '<rect x="4" y="4" width="6.5" height="6.5" rx="1"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>',
  link: '<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1"/>',
  file: '<path d="M14 3H6v18h12V7z"/><path d="M14 3v4h4"/>',
  text: '<path d="M5 6V4h14v2M12 4v16M9 20h6"/>',
  pin: '<path d="M9 4h6l-1 6 4 4H6l4-4z"/><path d="M12 14v7"/>',
  more: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
  tag: '<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.3"/>',
  hash: '<path d="M5 9h15M4 15h15M10 3 8 21M16 3l-2 18"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  cloud: '<path d="M7 18a4.5 4.5 0 0 1-.5-9 6 6 0 0 1 11.6 1.5A3.8 3.8 0 0 1 17.5 18z"/>',
  pen: '<path d="M4 20l1-5L16 4l4 4L9 19z"/><path d="M13.5 6.5l4 4"/>',
  eraser: '<path d="M8 20h12M5.5 14.5 14 6l5 5-8.5 8.5H7.5z"/><path d="m9.5 10.5 5 5"/>',
  cursor: '<path d="M5 3l14 8-6 2-2 6z"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>',
  redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h3"/>',
  fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  up: '<path d="m6 15 6-6 6 6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  flip: '<path d="M12 3v18M8 7 3 12l5 5zM16 7l5 5-5 5z"/>',
  gray: '<circle cx="12" cy="12" r="8"/><path d="M12 4v16" /><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor"/>',
  front: '<rect x="8" y="8" width="12" height="12" rx="1.5" fill="currentColor" fill-opacity=".25"/><path d="M4 16V5a1 1 0 0 1 1-1h11"/>',
  sendback: '<rect x="4" y="4" width="12" height="12" rx="1.5"/><path d="M20 8v11a1 1 0 0 1-1 1H8"/>',
  sparkles: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  upload: '<path d="M12 20V9M7 14l5-5 5 5M5 4h14"/>',
  star: '<path d="m12 3 2.8 5.8 6.2.9-4.5 4.4 1 6.2L12 17.4 6.5 20.3l1-6.2L3 9.7l6.2-.9z"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.6-4.5L4 8M4 4v4h4M4 13a8 8 0 0 0 14.6 4.5L20 16M20 20v-4h-4"/>',
  folder: '<path d="M3 6a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/>',
  home: '<path d="M4 11 12 4l8 7v9H4z"/><path d="M10 20v-5h4v5"/>',
  chat: '<path d="M4 5h16v11H9l-5 4z"/>',
  play: '<path d="M8 5v14l11-7z"/>',
};
export function icon(name, size = 20) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', size); s.setAttribute('height', size);
  s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '1.8');
  s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round'); s.setAttribute('aria-hidden', 'true');
  s.classList.add('ic'); s.innerHTML = P[name] || '';
  return s;
}
export function ibtn(name, title, onclick, cls = '') {
  return h('button', { class: 'ibtn ' + cls, title, 'aria-label': title, onclick }, icon(name));
}

// <img> that loads a media variant asynchronously
export function mImg(id, want = 'p', attrs = {}) {
  const img = h('img', { alt: '', draggable: 'false', ...attrs });
  img.classList.add('m-img');
  const c = Media.cachedURL(id, want);
  if (c) img.src = c;
  else { img.classList.add('loading'); Media.url(id, want).then(u => { if (u) img.src = u; img.classList.remove('loading'); }); }
  return img;
}

export function menu(anchor, items) {
  document.querySelectorAll('.popmenu').forEach(m => m.remove());
  const m = h('div', { class: 'popmenu' }, items.filter(Boolean).map(it => it === '-' ? h('hr') :
    h('button', { class: 'popitem' + (it.danger ? ' danger' : ''), onclick: e => { e.stopPropagation(); m.remove(); it.run(); } }, it.icon ? icon(it.icon, 18) : null, h('span', {}, it.label))));
  document.body.append(m);
  const r = anchor.getBoundingClientRect();
  const mw = m.offsetWidth, mh = m.offsetHeight;
  m.style.left = Math.max(8, Math.min(innerWidth - mw - 8, r.right - mw)) + 'px';
  m.style.top = (r.bottom + mh + 8 > innerHeight ? Math.max(8, r.top - mh - 6) : r.bottom + 6) + 'px';
  const off = e => { if (!m.contains(e.target)) { m.remove(); document.removeEventListener('pointerdown', off, true); } };
  setTimeout(() => document.addEventListener('pointerdown', off, true), 0);
  return m;
}

// Full-screen media viewer with pan/zoom
export function lightbox(id, { list = null, caption = '' } = {}) {
  let idx = list ? Math.max(0, list.indexOf(id)) : 0;
  let s = 1, tx = 0, ty = 0;
  const stage = h('div', { class: 'lb-stage' });
  const info = h('div', { class: 'lb-info' });
  const bg = h('div', { class: 'lightbox' }, stage, info,
    ibtn('x', 'Close', () => close(), 'lb-close'),
    list && list.length > 1 ? ibtn('back', 'Previous', () => go(-1), 'lb-prev') : null,
    list && list.length > 1 ? h('button', { class: 'ibtn lb-next', title: 'Next', onclick: () => go(1) }, icon('back')) : null);
  function apply() { const el = stage.firstChild; if (el) el.style.transform = `translate(${tx}px,${ty}px) scale(${s})`; }
  function show() {
    const mid = list ? list[idx] : id; const m = media.get(mid);
    stage.innerHTML = ''; s = 1; tx = ty = 0;
    let el;
    if (!m || m.mime.startsWith('image/')) {
      el = mImg(mid, 'p', { class: 'lb-media' });
      Media.url(mid, 'o').then(u => { if (u && el.isConnected) el.src = u; });
    } else if (m.mime.startsWith('video/')) { el = h('video', { class: 'lb-media', controls: true, playsinline: true }); Media.url(mid, 'o').then(u => u && (el.src = u)); }
    else if (m.mime.startsWith('audio/')) { el = h('audio', { controls: true }); Media.url(mid, 'o').then(u => u && (el.src = u)); }
    else { el = h('div', { class: 'lb-file' }, m.name); }
    stage.append(el);
    info.innerHTML = '';
    const bits = [];
    if (m?.ai?.caption) bits.push(esc(m.ai.caption));
    if (m?.ai?.tags?.length) bits.push(m.ai.tags.map(t => `<span class="chip sm">${esc(t)}</span>`).join(' '));
    if (caption) bits.unshift(esc(caption));
    if (list && list.length > 1) bits.push(`<span class="dim">${idx + 1} / ${list.length}</span>`);
    info.innerHTML = bits.join('<br>');
  }
  const go = d => { idx = (idx + d + list.length) % list.length; show(); };
  function close() { bg.remove(); removeEventListener('keydown', key); }
  const key = e => { if (e.key === 'Escape') close(); if (list && e.key === 'ArrowRight') go(1); if (list && e.key === 'ArrowLeft') go(-1); };
  addEventListener('keydown', key);
  // gestures
  const pts = new Map(); let lastD = 0, moved = 0;
  stage.addEventListener('wheel', e => { e.preventDefault(); const f = Math.exp(-e.deltaY * 0.002); zoomAt(f, e.clientX, e.clientY); }, { passive: false });
  function zoomAt(f, cx, cy) { const r = stage.getBoundingClientRect(); cx -= r.left + r.width / 2; cy -= r.top + r.height / 2; const ns = Math.min(12, Math.max(1, s * f)); tx = cx - (cx - tx) * ns / s; ty = cy - (cy - ty) * ns / s; s = ns; if (s === 1) tx = ty = 0; apply(); }
  stage.addEventListener('pointerdown', e => { stage.setPointerCapture(e.pointerId); pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); moved = 0; if (pts.size === 2) { const [a, b] = [...pts.values()]; lastD = Math.hypot(a.x - b.x, a.y - b.y); } });
  stage.addEventListener('pointermove', e => { const p = pts.get(e.pointerId); if (!p) return; const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY; moved += Math.abs(dx) + Math.abs(dy);
    if (pts.size === 1 && s > 1) { tx += dx; ty += dy; apply(); }
    if (pts.size === 2) { const [a, b] = [...pts.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y); if (lastD) zoomAt(d / lastD, (a.x + b.x) / 2, (a.y + b.y) / 2); lastD = d; } });
  const up = e => { const was = pts.size; pts.delete(e.pointerId); if (pts.size < 2) lastD = 0;
    if (was === 1 && moved < 6 && e.target === stage) close();
    if (was === 1 && moved > 60 && s === 1 && list) { /* swipe */ } };
  stage.addEventListener('pointerup', up); stage.addEventListener('pointercancel', up);
  stage.addEventListener('dblclick', e => { if (s > 1) { s = 1; tx = ty = 0; apply(); } else zoomAt(2.5, e.clientX, e.clientY); });
  document.body.append(bg); show();
}

export function chip(text, { onclick, onremove, cls = '' } = {}) {
  return h('span', { class: 'chip ' + cls, onclick }, text, onremove ? h('button', { class: 'chip-x', title: 'Remove', onclick: e => { e.stopPropagation(); onremove(); } }, '×') : null);
}
export function progressModal(title) {
  const bar = h('div', { class: 'bar-fill' });
  const txt = h('div', { class: 'dim small' });
  let cancelled = false;
  const btn = h('button', { class: 'btn', onclick: () => { cancelled = true; btn.disabled = true; btn.textContent = 'Stopping…'; } }, 'Stop');
  const bg = h('div', { class: 'modal-bg' }, h('div', { class: 'modal' }, h('h3', {}, title), h('div', { class: 'bar' }, bar), txt, h('div', { class: 'modal-actions' }, btn)));
  document.body.append(bg);
  return {
    set(frac, msg) { bar.style.width = Math.round(frac * 100) + '%'; if (msg != null) txt.textContent = msg; },
    get cancelled() { return cancelled; },
    done(msg) { btn.textContent = 'Close'; btn.disabled = false; btn.onclick = () => bg.remove(); if (msg) txt.textContent = msg; bar.style.width = '100%'; },
    close() { bg.remove(); },
  };
}
