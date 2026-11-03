// Note editor: title, thumbnail, blocks of text / image / link / file, tags.
import { h, uid, debounce, linkify, pick, toast, promptBox, confirmBox, fmtDate } from './util.js';
import { save, tagsOf, trash, isEmptyNote, discard, media, addCategory, allTags } from './state.js';
import * as Media from './media.js';
import { icon, ibtn, mImg, lightbox, menu, chip } from './ui.js';

const ytId = u => { const m = String(u).match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{11})/); return m ? m[1] : null; };
const host = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };
const fmtSize = n => n > 1e6 ? (n / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1e3)) + ' KB';

export function openNote(root, d, { onClose }) {
  const isNew = !!d._new;
  let dirty = false;
  const saveSoon = debounce(() => { if (!dirty) return; dirty = false; delete d._new; save(d); stamp(); }, 600);
  const changed = () => { dirty = true; saveSoon(); renderTags(); };

  const title = h('textarea', { class: 'note-title', rows: 1, placeholder: 'Title', value: d.title });
  title.value = d.title;
  title.addEventListener('input', () => { d.title = title.value.replace(/\n/g, ' '); autosize(title); changed(); });
  title.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); focusFirstText(); } });

  const thumbBox = h('div', { class: 'note-thumb' });
  const blocksEl = h('div', { class: 'blocks' });
  const tagsEl = h('div', { class: 'note-tags' });
  const stampEl = h('div', { class: 'stamp dim small' });
  const pinBtn = ibtn('pin', 'Pin to top', () => { d.pinned = !d.pinned; pinBtn.classList.toggle('on', !!d.pinned); changed(); });
  pinBtn.classList.toggle('on', !!d.pinned);

  const addBar = h('div', { class: 'addbar' },
    h('button', { class: 'btn ghost', onclick: () => addText() }, icon('text', 18), 'Text'),
    h('button', { class: 'btn ghost', onclick: () => addFiles('image/*') }, icon('image', 18), 'Image'),
    h('button', { class: 'btn ghost', onclick: () => addLink() }, icon('link', 18), 'Link'),
    h('button', { class: 'btn ghost', onclick: () => addFiles('*/*') }, icon('file', 18), 'File / media'));

  const more = ibtn('more', 'More', () => menu(more, [
    { label: d.thumb ? 'Change thumbnail' : 'Set thumbnail', icon: 'star', run: chooseThumb },
    d.thumb && { label: 'Remove thumbnail', icon: 'x', run: () => { d.thumb = null; renderThumb(); changed(); } },
    { label: 'Add to category', icon: 'hash', run: addTag },
    '-',
    { label: 'Move to trash', icon: 'trash', danger: true, run: async () => { await trash(d); close(true); } },
  ]));

  const view = h('div', { class: 'editor note-editor' },
    h('header', { class: 'ed-bar' }, ibtn('back', 'Back', () => close()), h('div', { class: 'grow' }), pinBtn, ibtn('star', 'Thumbnail', chooseThumb), more),
    h('div', { class: 'ed-scroll' }, h('div', { class: 'note-page' }, thumbBox, title, blocksEl, addBar, tagsEl, stampEl)));
  root.append(view);

  // ---------- blocks ----------
  function renderBlocks() { blocksEl.innerHTML = ''; d.blocks.forEach((b, i) => blocksEl.append(blockEl(b, i))); }
  function tools(b, extra = []) {
    const i = () => d.blocks.indexOf(b);
    return h('div', { class: 'blk-tools' }, ...extra,
      ibtn('up', 'Move up', () => move(i(), -1)), ibtn('down', 'Move down', () => move(i(), 1)),
      ibtn('x', 'Remove', () => { d.blocks.splice(i(), 1); if (!d.blocks.length) d.blocks.push({ id: uid(), t: 'text', text: '' }); renderBlocks(); changed(); }));
  }
  function move(i, dir) { const j = i + dir; if (j < 0 || j >= d.blocks.length) return; [d.blocks[i], d.blocks[j]] = [d.blocks[j], d.blocks[i]]; renderBlocks(); changed(); }

  function blockEl(b) {
    if (b.t === 'text') {
      const wrap = h('div', { class: 'blk blk-text' });
      const viewEl = h('div', { class: 'text-view' });
      const ta = h('textarea', { class: 'text-edit', rows: 1, placeholder: 'Write something… use #hashtags to file it into categories' });
      const showView = () => {
        const empty = !b.text.trim();
        viewEl.innerHTML = empty ? '<span class="ph">Write something… use #hashtags to file it into categories</span>' : linkify(b.text);
        ta.replaceWith(viewEl);
      };
      const edit = () => { ta.value = b.text; viewEl.replaceWith(ta); autosize(ta); ta.focus(); };
      viewEl.addEventListener('click', e => { if (e.target.closest('a')) return; edit(); });
      ta.addEventListener('input', () => { b.text = ta.value; autosize(ta); changed(); });
      ta.addEventListener('blur', () => {
        const textBlocks = d.blocks.filter(x => x.t === 'text');
        if (!b.text.trim() && textBlocks.length > 1) { d.blocks.splice(d.blocks.indexOf(b), 1); wrap.remove(); changed(); return; }
        showView();
      });
      wrap.append(viewEl); showView();
      wrap._edit = edit;
      if (b._focus) { delete b._focus; setTimeout(edit, 0); }
      return wrap;
    }
    if (b.t === 'image') {
      const m = media.get(b.media);
      const img = mImg(b.media, 'p', { class: 'blk-img' });
      if (m?.w) img.style.aspectRatio = `${m.w} / ${m.h}`;
      img.addEventListener('click', () => lightbox(b.media, { list: d.blocks.filter(x => x.t === 'image').map(x => x.media), caption: b.caption }));
      const cap = h('input', { class: 'caption', placeholder: 'Caption', value: b.caption || '' });
      cap.addEventListener('input', () => { b.caption = cap.value; changed(); });
      const star = ibtn('star', 'Use as thumbnail', () => { d.thumb = b.media; renderThumb(); changed(); toast('Thumbnail set'); });
      return h('figure', { class: 'blk blk-image' }, img, cap, tools(b, [star]));
    }
    if (b.t === 'link') {
      const yt = ytId(b.url);
      const card = h('a', { class: 'link-card', href: b.url, target: '_blank', rel: 'noopener' },
        yt ? h('img', { class: 'yt', src: `https://i.ytimg.com/vi/${yt}/hqdefault.jpg`, alt: '' }) : h('img', { class: 'fav', src: `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host(b.url))}&sz=64`, alt: '', onerror: e => e.target.remove() }),
        h('div', { class: 'link-txt' }, h('div', { class: 'link-label' }, b.label || host(b.url)), h('div', { class: 'link-url dim small' }, b.url)));
      const editBtn = ibtn('pen', 'Edit link', async () => {
        const u = await promptBox('Link address', b.url, 'Save'); if (u == null) return;
        const l = await promptBox('Label (optional)', b.label || '', 'Save');
        b.url = normUrl(u); b.label = l || ''; renderBlocks(); changed();
      });
      return h('div', { class: 'blk blk-link' }, card, tools(b, [editBtn]));
    }
    if (b.t === 'file') {
      const m = media.get(b.media) || { name: b.name || 'file', mime: '' };
      let body;
      if (m.mime.startsWith('video/')) { body = h('video', { class: 'blk-video', controls: true, playsinline: true, preload: 'metadata' }); Media.url(b.media, 'o').then(u => u && (body.src = u)); }
      else if (m.mime.startsWith('audio/')) { body = h('audio', { controls: true }); Media.url(b.media, 'o').then(u => u && (body.src = u)); }
      else body = h('button', { class: 'file-chip', onclick: async () => { const u = await Media.url(b.media, 'o'); if (u) { const a = h('a', { href: u, download: m.name, target: '_blank' }); a.click(); } else toast('File not available offline'); } },
        icon('file', 22), h('div', {}, h('div', {}, m.name), h('div', { class: 'dim small' }, (m.mime || 'file') + (m.size ? ' · ' + fmtSize(m.size) : ''))));
      return h('div', { class: 'blk blk-file' }, body, tools(b));
    }
    return h('div');
  }

  function insertIndex() {
    const a = document.activeElement; const blk = a?.closest?.('.blk');
    const i = blk ? [...blocksEl.children].indexOf(blk) : -1;
    return i >= 0 ? i + 1 : d.blocks.length;
  }
  function addText() { const b = { id: uid(), t: 'text', text: '', _focus: true }; d.blocks.push(b); renderBlocks(); }
  async function addFiles(accept, files) {
    files ||= await pick({ accept, multiple: true });
    if (!files.length) return;
    let at = insertIndex();
    for (const f of files) {
      const rec = await Media.addFile(f);
      const b = rec.mime.startsWith('image/') ? { id: uid(), t: 'image', media: rec.id } : { id: uid(), t: 'file', media: rec.id, name: rec.name };
      d.blocks.splice(at++, 0, b);
      if (!d.thumb && rec.mime.startsWith('image/') && !d.blocks.some(x => x.t === 'image' && x !== b)) { /* first image becomes cover automatically via coverOf */ }
    }
    renderBlocks(); changed();
  }
  async function addLink() {
    const u = await promptBox('Paste a link', '', 'Add'); if (!u) return;
    d.blocks.splice(insertIndex(), 0, { id: uid(), t: 'link', url: normUrl(u), label: '' }); renderBlocks(); changed();
  }
  const normUrl = u => (u = u.trim(), /^[a-z]+:\/\//i.test(u) ? u : 'https://' + u);

  // ---------- thumbnail ----------
  function renderThumb() {
    thumbBox.innerHTML = '';
    if (!d.thumb) { thumbBox.hidden = true; return; }
    thumbBox.hidden = false;
    thumbBox.append(mImg(d.thumb, 'p'), h('div', { class: 'thumb-actions' },
      h('button', { class: 'btn sm', onclick: chooseThumb }, 'Change'),
      h('button', { class: 'btn sm', onclick: () => { d.thumb = null; renderThumb(); changed(); } }, 'Remove')));
  }
  async function chooseThumb() {
    const imgs = d.blocks.filter(b => b.t === 'image');
    if (!imgs.length) return uploadThumb();
    const bg = h('div', { class: 'modal-bg', onclick: e => e.target === bg && bg.remove() });
    const grid = h('div', { class: 'thumb-pick' }, imgs.map(b => h('button', { class: 'tp', onclick: () => { d.thumb = b.media; bg.remove(); renderThumb(); changed(); } }, mImg(b.media, 't'))));
    bg.append(h('div', { class: 'modal wide' }, h('h3', {}, 'Choose a thumbnail'), grid,
      h('div', { class: 'modal-actions' }, h('button', { class: 'btn', onclick: () => { bg.remove(); uploadThumb(); } }, icon('upload', 18), 'Upload a new image'), h('button', { class: 'btn', onclick: () => bg.remove() }, 'Cancel'))));
    document.body.append(bg);
  }
  async function uploadThumb() {
    const [f] = await pick({ accept: 'image/*' }); if (!f) return;
    const rec = await Media.addFile(f); d.thumb = rec.id; renderThumb(); changed();
  }

  // ---------- tags ----------
  function renderTags() {
    tagsEl.innerHTML = '';
    const explicit = new Set((d.tags || []).map(t => t.toLowerCase()));
    for (const t of tagsOf(d)) tagsEl.append(chip('#' + t, {
      onclick: () => { location.hash = '#tag-' + encodeURIComponent(t.toLowerCase()); },
      onremove: explicit.has(t.toLowerCase()) ? () => { d.tags = d.tags.filter(x => x.toLowerCase() !== t.toLowerCase()); changed(); } : null,
    }));
    tagsEl.append(h('button', { class: 'chip add', onclick: addTag }, '+ Category'));
  }
  async function addTag() {
    const names = allTags().map(t => t.name);
    const v = await promptBox(names.length ? `Category name (existing: ${names.slice(0, 12).map(n => '#' + n).join(' ')}${names.length > 12 ? ' …' : ''})` : 'Category name', '', 'Add');
    if (!v) return; const n = await addCategory(v); if (!n) return;
    d.tags = [...new Set([...(d.tags || []), n])]; changed();
  }
  const stamp = () => { stampEl.textContent = `Edited ${fmtDate(d.updated)} · Created ${fmtDate(d.created)}`; };

  // paste & drop
  view.addEventListener('paste', e => {
    const files = [...(e.clipboardData?.files || [])];
    if (files.length) { e.preventDefault(); addFiles('', files); }
  });
  view.addEventListener('dragover', e => { e.preventDefault(); view.classList.add('drop'); });
  view.addEventListener('dragleave', e => { if (e.target === view) view.classList.remove('drop'); });
  view.addEventListener('drop', e => { e.preventDefault(); view.classList.remove('drop'); const f = [...e.dataTransfer.files]; if (f.length) addFiles('', f); });

  function focusFirstText() { const el = blocksEl.querySelector('.blk-text'); el?._edit?.(); }
  async function close(skipSave) {
    if (!skipSave) {
      if (isEmptyNote(d) && (isNew || d._new)) await discard(d);
      else saveSoon.flush();
    }
    view.remove(); onClose?.();
  }
  renderThumb(); renderBlocks(); renderTags(); stamp(); autosize(title);
  if (isNew) setTimeout(() => title.focus(), 50);
  return { close };
}
export function autosize(ta) { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; }
