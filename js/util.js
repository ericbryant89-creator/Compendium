export const uid = () => {
  const t = Date.now().toString(36);
  const r = crypto.getRandomValues(new Uint32Array(2));
  return t + r[0].toString(36) + r[1].toString(36).slice(0, 4);
};
export const now = () => Date.now();
export function debounce(fn, ms) {
  let t;
  const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  d.flush = (...a) => { clearTimeout(t); fn(...a); };
  return d;
}
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function h(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'html') e.innerHTML = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k.nodeType ? k : document.createTextNode(k));
  return e;
}
// tiny event bus
const subs = {};
export const bus = {
  on(ev, fn) { (subs[ev] ||= new Set()).add(fn); return () => subs[ev].delete(fn); },
  emit(ev, data) { subs[ev]?.forEach(fn => { try { fn(data); } catch (e) { console.error(e); } }); },
};
export function fmtDate(ts) {
  const d = new Date(ts), n = new Date();
  if (d.toDateString() === n.toDateString()) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (d.getFullYear() === n.getFullYear()) return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  return d.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
}
export const TAG_RE = /(^|[^\p{L}\p{N}_&/#])#([\p{L}\p{N}][\p{L}\p{N}_\-]*)/gu;
export function extractTags(text) {
  const out = [];
  for (const m of String(text || '').matchAll(TAG_RE)) out.push(m[2]);
  return out;
}
export const store = {
  get(k, d = null) { try { const v = localStorage.getItem('mg:' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('mg:' + k, JSON.stringify(v)); } catch {} },
};
export function toast(msg, ms = 2600) {
  let box = document.getElementById('toasts');
  if (!box) { box = h('div', { id: 'toasts' }); document.body.append(box); }
  const t = h('div', { class: 'toast' }, msg);
  box.append(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, ms);
}
export function linkify(text) {
  // escape, then turn URLs into links and #tags into tag links
  let s = esc(text);
  s = s.replace(/\bhttps?:\/\/[^\s<]+[^\s<.,;:!?)\]'"]/g, u => `<a href="${u}" target="_blank" rel="noopener">${u}</a>`);
  s = s.replace(/(^|[^\p{L}\p{N}_&/#])#([\p{L}\p{N}][\p{L}\p{N}_\-]*)/gu, (m, p, t) => `${p}<a class="tag-link" href="#tag-${encodeURIComponent(t.toLowerCase())}">#${t}</a>`);
  return s.replace(/\n/g, '<br>');
}
export function blobToDataURL(b) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(b); });
}
export function pick({ accept = '', multiple = false, dir = false } = {}) {
  return new Promise(res => {
    const i = h('input', { type: 'file', accept, style: { display: 'none' } });
    if (multiple) i.multiple = true;
    if (dir) { i.webkitdirectory = true; i.setAttribute('webkitdirectory', ''); }
    i.onchange = () => { res([...i.files]); i.remove(); };
    document.body.append(i); i.click();
  });
}
export function confirmBox(msg, okLabel = 'OK') {
  return new Promise(res => {
    const close = v => { bg.remove(); res(v); };
    const bg = h('div', { class: 'modal-bg', onclick: e => e.target === bg && close(false) },
      h('div', { class: 'modal' }, h('p', {}, msg),
        h('div', { class: 'modal-actions' },
          h('button', { class: 'btn', onclick: () => close(false) }, 'Cancel'),
          h('button', { class: 'btn primary', onclick: () => close(true) }, okLabel))));
    document.body.append(bg);
  });
}
export function promptBox(msg, value = '', okLabel = 'OK') {
  return new Promise(res => {
    const inp = h('input', { class: 'input', value });
    const close = v => { bg.remove(); res(v); };
    const bg = h('div', { class: 'modal-bg', onclick: e => e.target === bg && close(null) },
      h('div', { class: 'modal' }, h('p', {}, msg), inp,
        h('div', { class: 'modal-actions' },
          h('button', { class: 'btn', onclick: () => close(null) }, 'Cancel'),
          h('button', { class: 'btn primary', onclick: () => close(inp.value) }, okLabel))));
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') close(inp.value); if (e.key === 'Escape') close(null); });
    document.body.append(bg); setTimeout(() => inp.focus(), 30);
  });
}
