import { APP_NAME, APP_TAGLINE, DRIVE_FOLDER } from './config.js';
import { h, esc, debounce, fmtDate, store, toast, bus, confirmBox, promptBox } from './util.js';
import * as S from './state.js';
import * as Media from './media.js';
import { icon, ibtn, mImg, lightbox, menu, chip, progressModal } from './ui.js';
import { openNote } from './note.js';
import { openBoard } from './board.js';
import * as Sync from './sync.js';
import * as AI from './ai.js';
import { importVizRef } from './importer.js';

// ---------- theme ----------
const mq = matchMedia('(prefers-color-scheme: dark)');
function applyTheme() {
  const t = store.get('theme', 'system');
  const dark = t === 'dark' || (t === 'system' && mq.matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', dark ? '#0f1b1c' : '#ffffff');
  themeBtn?.replaceChildren(icon(dark ? 'sun' : 'moon'));
}
mq.addEventListener?.('change', applyTheme);
function toggleTheme() { const dark = document.documentElement.dataset.theme === 'dark'; store.set('theme', dark ? 'light' : 'dark'); applyTheme(); }

// ---------- shell ----------
let themeBtn, navEl, contentEl, searchIn, viewBtn, syncPill, editorRoot, catList;
let query = '';
let layout = store.get('layout', 'grid');
let sortBy = store.get('sort', 'updated');
let editor = null, editorRoute = null, lastList = '#all';

function emblem(size = 30) {
  return h('span', { class: 'emblem', html: `<svg viewBox="0 0 64 64" width="${size}" height="${size}" aria-hidden="true"><rect width="64" height="64" rx="15" fill="var(--emblem-bg)"/><path d="M31 21.5C26 18 19 17.2 12.5 18.6v26.6c6.5-1.4 13.5-.6 18.5 2.9z" fill="var(--emblem-fg)"/><path d="M33 21.5c5-3.5 12-4.3 18.5-2.9v26.6c-6.5-1.4-13.5-.6-18.5 2.9z" fill="var(--emblem-fg)"/><path d="M17 25.5c3.6-.5 7.4.1 10.5 1.6M17 31c3.6-.5 7.4.1 10.5 1.6M47 25.5c-3.6-.5-7.4.1-10.5 1.6M47 31c-3.6-.5-7.4.1-10.5 1.6" stroke="var(--emblem-bg)" stroke-width="1.8" stroke-linecap="round" opacity=".45"/></svg>` });
}

function buildShell() {
  document.title = APP_NAME;
  themeBtn = ibtn('moon', 'Light / dark mode', toggleTheme);
  searchIn = h('input', { class: 'search', type: 'search', placeholder: 'Search everything…  (use #tag to filter)', 'aria-label': 'Search' });
  searchIn.addEventListener('input', debounce(() => { query = searchIn.value; if (isEditorRoute(location.hash)) return; renderList(); }, 140));
  searchIn.addEventListener('keydown', e => { if (e.key === 'Escape') { searchIn.value = ''; query = ''; renderList(); } });
  viewBtn = ibtn(layout === 'grid' ? 'list' : 'grid', 'Grid / list view', () => { layout = layout === 'grid' ? 'list' : 'grid'; store.set('layout', layout); viewBtn.replaceChildren(icon(layout === 'grid' ? 'list' : 'grid')); renderList(); });
  const sortBtn = ibtn('down', 'Sort', () => menu(sortBtn, [
    { label: 'Last edited', icon: sortBy === 'updated' ? 'check' : null, run: () => setSort('updated') },
    { label: 'Date created', icon: sortBy === 'created' ? 'check' : null, run: () => setSort('created') },
    { label: 'Title', icon: sortBy === 'title' ? 'check' : null, run: () => setSort('title') },
  ]));
  const setSort = v => { sortBy = v; store.set('sort', v); renderList(); };
  syncPill = h('button', { class: 'sync-pill', onclick: onSyncPill });
  catList = h('div', { class: 'cat-list' });
  const navLink = (href, ic, label) => h('a', { class: 'nav-link', href, 'data-href': href }, icon(ic, 19), h('span', {}, label));
  navEl = h('aside', { id: 'nav' },
    h('div', { class: 'brand' }, emblem(30), h('div', {}, h('div', { class: 'brand-name' }, APP_NAME), h('div', { class: 'brand-sub' }, APP_TAGLINE))),
    h('nav', { class: 'nav-main' },
      navLink('#all', 'home', 'Everything'), navLink('#notes', 'note', 'Notes'), navLink('#boards', 'board', 'Boards'), navLink('#ask', 'sparkles', 'Ask AI')),
    h('div', { class: 'nav-head' }, h('span', {}, 'Categories'), ibtn('plus', 'New category', newCategory, 'sm')),
    catList,
    h('nav', { class: 'nav-foot' }, navLink('#trash', 'trash', 'Trash'), navLink('#prefs', 'settings', 'Settings'),
      h('button', { class: 'nav-link only-mobile', onclick: toggleTheme }, icon('moon', 19), h('span', {}, 'Light / dark mode'))),
    syncPill);
  const scrim = h('div', { class: 'scrim', onclick: () => document.body.classList.remove('nav-open') });
  contentEl = h('div', { id: 'content' });
  const newMenuBtn = h('button', { class: 'fab', title: 'New', 'aria-label': 'New', onclick: () => menu(newMenuBtn, [{ label: 'New note', icon: 'note', run: () => createNote() }, { label: 'New board', icon: 'board', run: () => createBoard() }]) }, icon('plus', 26));
  const main = h('main', { id: 'main' },
    h('header', { class: 'topbar' },
      ibtn('menu', 'Menu', () => document.body.classList.toggle('nav-open'), 'only-mobile'),
      h('div', { class: 'search-wrap' }, icon('search', 18), searchIn),
      viewBtn, h('span', { class: 'hide-sm' }, sortBtn), h('span', { class: 'hide-sm' }, themeBtn),
      h('button', { class: 'btn primary only-desktop', onclick: () => createNote() }, icon('note', 18), 'New note'),
      h('button', { class: 'btn only-desktop', onclick: () => createBoard() }, icon('board', 18), 'New board')),
    contentEl, newMenuBtn);
  editorRoot = h('div', { id: 'editor-root' });
  document.getElementById('app').replaceChildren(navEl, scrim, main, editorRoot);
  applyTheme();
}

function renderCats() {
  catList.innerHTML = '';
  const tags = S.allTags();
  if (!tags.length) catList.append(h('div', { class: 'dim small pad' }, 'Type #something in a note to create a category.'));
  for (const t of tags) {
    const href = '#tag-' + encodeURIComponent(t.name.toLowerCase());
    catList.append(h('a', { class: 'nav-link cat', href, 'data-href': href }, h('span', { class: 'hash' }, '#'), h('span', { class: 'grow' }, t.name), h('span', { class: 'count' }, t.count || '')));
  }
  markNav();
}
function markNav() {
  const cur = isEditorRoute(location.hash) ? lastList : ((location.hash && location.hash !== '#') ? location.hash : '#all');
  navEl.querySelectorAll('.nav-link').forEach(a => a.classList.toggle('on', a.dataset.href === cur || (cur === '' && a.dataset.href === '#all')));
}
async function newCategory() {
  const n = await promptBox('New category name (you can also just type #name in any note)', '', 'Create');
  if (!n) return; const name = await S.addCategory(n); if (name) { renderCats(); location.hash = '#tag-' + encodeURIComponent(name.toLowerCase()); }
}

// ---------- sync pill ----------
function renderSync() {
  const st = Sync.status;
  let txt, cls = st.state;
  if (st.state === 'off') txt = 'Sync off · this device only';
  else if (st.state === 'needs-auth') txt = 'Tap to reconnect Google Drive';
  else if (st.state === 'syncing') txt = 'Syncing…' + (st.pending ? ` ${st.pending} files to upload` : '');
  else if (st.state === 'error') txt = 'Sync problem · tap to retry';
  else if (st.state === 'offline') txt = 'Offline · will sync later';
  else txt = (st.pending ? `Uploading · ${st.pending} files left` : 'Synced') + (st.last ? ' · ' + fmtDate(st.last) : '');
  syncPill.className = 'sync-pill ' + cls;
  syncPill.title = st.msg || txt;
  syncPill.replaceChildren(icon('cloud', 17), h('span', {}, txt));
}
async function onSyncPill() {
  const st = Sync.status.state;
  if (st === 'off') { location.hash = '#prefs'; return; }
  if (st === 'needs-auth') { try { await Sync.reconnect(); } catch (e) { toast(e.message); } return; }
  Sync.syncNow();
}

// ---------- routing ----------
const isEditorRoute = r => /^#(note|board)-/.test(r || '');
function route() {
  const r = (location.hash && location.hash !== '#') ? location.hash : '#all';
  document.body.classList.remove('nav-open');
  if (isEditorRoute(r)) {
    const [, type, id] = r.match(/^#(note|board)-(.+)$/);
    if (!contentEl.childElementCount) renderList();
    if (editor && editorRoute === r) return;
    closeEditor();
    const d = S.docs.get(id);
    if (!d || d.purged) { toast('That item no longer exists'); location.replace(lastList); return; }
    editorRoute = r;
    const myRoute = r;
    const onClose = () => {
      if (editorRoute === myRoute) { editor = null; editorRoute = null; }
      document.body.classList.remove('editing');
      if (location.hash === myRoute) { const back = cameFromApp; cameFromApp = false; back ? history.back() : location.replace(lastList); }
      if (!editor) { renderList(); renderCats(); }
    };
    editor = type === 'note' ? openNote(editorRoot, d, { onClose }) : openBoard(editorRoot, d, { onClose });
    document.body.classList.add('editing');
    return;
  }
  closeEditor();
  cameFromApp = false;
  lastList = r;
  renderList();
  markNav();
}
let cameFromApp = false;
function closeEditor() { if (editor) { const e = editor; editor = null; editorRoute = null; e.close(); } document.body.classList.remove('editing'); }
function openDoc(d) { cameFromApp = true; location.hash = `#${d.type}-${d.id}`; }
function createNote(extra = {}) {
  const tag = currentTag();
  const d = S.newNote(tag ? { tags: [tag], ...extra } : extra); d._new = true; openDoc(d);
}
function createBoard() {
  const tag = currentTag();
  const d = S.newBoard(tag ? { tags: [tag] } : {}); d._new = true; openDoc(d);
}
function currentTag() { const m = lastList.match(/^#tag-(.+)$/); if (!m) return null; const k = decodeURIComponent(m[1]); const t = S.allTags().find(x => x.name.toLowerCase() === k); return t ? t.name : k; }

// ---------- list views ----------
function renderList() {
  const r = lastList;
  if (r === '#prefs') return renderSettings();
  if (r === '#ask') return renderAsk();
  contentEl.innerHTML = '';
  const pq = S.parseQuery(query);
  let title = 'Everything', filter = d => S.live(d), sub = '';
  if (r === '#notes') { title = 'Notes'; filter = d => S.live(d) && d.type === 'note'; }
  else if (r === '#boards') { title = 'Boards'; filter = d => S.live(d) && d.type === 'board'; }
  else if (r === '#trash') { title = 'Trash'; filter = d => d.deleted && !d.purged; }
  const tagM = r.match(/^#tag-(.+)$/);
  let tagName = null;
  if (tagM) { const k = decodeURIComponent(tagM[1]); tagName = S.allTags().find(x => x.name.toLowerCase() === k)?.name || k; title = '#' + tagName; filter = d => S.live(d) && S.hasTag(d, k); }
  let list = [...S.docs.values()].filter(filter).filter(d => S.matches(d, pq));
  const cmp = sortBy === 'title' ? (a, b) => (a.title || '~').localeCompare(b.title || '~', undefined, { numeric: true, sensitivity: 'base' }) : sortBy === 'created' ? (a, b) => b.created - a.created : (a, b) => b.updated - a.updated;
  list.sort((a, b) => (!!b.pinned - !!a.pinned) || cmp(a, b));
  const head = h('div', { class: 'list-head' }, h('h1', {}, title));
  if (query.trim()) sub = `${list.length} result${list.length === 1 ? '' : 's'} for “${query.trim()}”`;
  else sub = `${list.length} item${list.length === 1 ? '' : 's'}`;
  head.append(h('div', { class: 'dim small' }, sub));
  if (tagName) {
    const mb = ibtn('more', 'Category options', () => menu(mb, [
      { label: 'Rename category', icon: 'pen', run: () => renameTag(tagName) },
      { label: 'Remove category', icon: 'trash', danger: true, run: () => removeTag(tagName) },
    ]));
    head.append(h('div', { class: 'head-actions' }, h('button', { class: 'btn sm', onclick: () => createNote() }, icon('plus', 16), 'Note here'), h('button', { class: 'btn sm', onclick: () => createBoard() }, icon('plus', 16), 'Board here'), mb));
  }
  if (r === '#trash' && list.length) head.append(h('div', { class: 'head-actions' }, h('button', { class: 'btn sm danger', onclick: emptyTrash }, 'Empty trash')));
  contentEl.append(head);

  // image hits from AI descriptions
  const imgHits = r !== '#trash' && query.trim() ? S.searchImages(pq) : [];
  if (imgHits.length) {
    const ids = imgHits.map(x => x.media.id);
    contentEl.append(h('h2', { class: 'section' }, `Images matching “${pq.terms.join(' ')}” · ${imgHits.length}`),
      h('div', { class: 'img-hits' }, imgHits.slice(0, 240).map(x => h('button', { class: 'img-hit', title: x.media.ai?.caption || '', onclick: () => lightbox(x.media.id, { list: ids }) }, mImg(x.media.id, 't'), h('span', { class: 'img-hit-src', onclick: e => { e.stopPropagation(); openDoc(x.doc); } }, x.doc.title || 'Untitled')))));
    if (list.length) contentEl.append(h('h2', { class: 'section' }, 'Notes & boards'));
  }

  if (!list.length && !imgHits.length) {
    contentEl.append(emptyState(r, tagName));
    return;
  }
  const wrap = h('div', { class: layout === 'grid' ? 'grid' : 'rows' });
  for (const d of list) wrap.append(layout === 'grid' ? card(d, r === '#trash') : row(d, r === '#trash'));
  contentEl.append(wrap);
}
function emptyState(r, tagName) {
  if (query.trim()) return h('div', { class: 'empty' }, h('p', {}, 'Nothing matches that search.'), AI.aiKey() ? null : h('p', { class: 'dim small' }, 'Tip: to search inside images (“animals”, “foreshortening”…), turn on AI image tagging in Settings.'));
  if (r === '#trash') return h('div', { class: 'empty' }, h('p', {}, 'Trash is empty.'));
  return h('div', { class: 'empty' }, emblem(54), h('h2', {}, tagName ? `Nothing in #${tagName} yet` : `Welcome to ${APP_NAME}`),
    h('p', { class: 'dim' }, 'Notes hold text, images, links and media. Boards are infinite canvases for references. Type #hashtags to sort anything into categories.'),
    h('div', { class: 'row-actions' }, h('button', { class: 'btn primary', onclick: () => createNote() }, icon('note', 18), 'New note'), h('button', { class: 'btn', onclick: () => createBoard() }, icon('board', 18), 'New board'),
      !tagName ? h('button', { class: 'btn', onclick: () => importVizRef().then(() => { renderList(); renderCats(); }) }, icon('upload', 18), 'Import VizRef boards') : null));
}
function docActions(d, inTrash) {
  if (inTrash) return [
    { label: 'Restore', icon: 'refresh', run: async () => { await S.restore(d); renderList(); renderCats(); } },
    { label: 'Delete forever', icon: 'trash', danger: true, run: async () => { if (await confirmBox(`Delete “${d.title || 'Untitled'}” forever?`, 'Delete')) { await S.purge(d); renderList(); } } },
  ];
  return [
    { label: d.pinned ? 'Unpin' : 'Pin to top', icon: 'pin', run: async () => { d.pinned = !d.pinned; await S.save(d, { touch: false }); renderList(); } },
    { label: 'Add to category', icon: 'hash', run: async () => { const v = await promptBox('Category name', '', 'Add'); if (!v) return; const n = await S.addCategory(v); d.tags = [...new Set([...(d.tags || []), n])]; await S.save(d); renderList(); renderCats(); } },
    { label: 'Move to trash', icon: 'trash', danger: true, run: async () => { await S.trash(d); renderList(); renderCats(); toast('Moved to trash'); } },
  ];
}
function card(d, inTrash) {
  const cover = S.coverOf(d);
  const tags = S.tagsOf(d);
  const mb = ibtn('more', 'Options', e => { e.stopPropagation(); menu(mb, docActions(d, inTrash)); }, 'card-more');
  const n = d.type === 'board' ? (d.items || []).filter(i => i.k === 'img').length : 0;
  return h('article', { class: 'card ' + d.type + (cover ? '' : ' no-cover'), tabindex: '0', onclick: () => inTrash ? null : openDoc(d), onkeydown: e => e.key === 'Enter' && !inTrash && openDoc(d) },
    cover ? h('div', { class: 'card-media' }, mImg(cover, 't'), d.type === 'board' ? h('span', { class: 'badge' }, icon('board', 14), String(n)) : null) :
      d.type === 'board' ? h('div', { class: 'card-media ph' }, icon('board', 30), h('span', { class: 'badge' }, icon('board', 14), String(n))) : null,
    h('div', { class: 'card-body' },
      h('div', { class: 'card-title' }, d.pinned ? icon('pin', 14) : null, h('span', {}, d.title || 'Untitled')),
      d.type === 'note' ? h('p', { class: 'card-snip' }, S.snippet(d, 260)) : null,
      tags.length ? h('div', { class: 'card-tags' }, tags.slice(0, 5).map(t => h('span', { class: 'chip sm' }, '#' + t))) : null,
      h('div', { class: 'card-meta dim small' }, d.type === 'board' ? 'Board · ' : '', fmtDate(d.updated))),
    mb);
}
function row(d, inTrash) {
  const cover = S.coverOf(d); const tags = S.tagsOf(d);
  const mb = ibtn('more', 'Options', e => { e.stopPropagation(); menu(mb, docActions(d, inTrash)); });
  return h('div', { class: 'row', tabindex: '0', onclick: () => inTrash ? null : openDoc(d), onkeydown: e => e.key === 'Enter' && !inTrash && openDoc(d) },
    h('div', { class: 'row-thumb' }, cover ? mImg(cover, 't') : icon(d.type === 'board' ? 'board' : 'note', 22)),
    h('div', { class: 'row-main' },
      h('div', { class: 'row-title' }, d.pinned ? icon('pin', 14) : null, d.title || 'Untitled'),
      h('div', { class: 'row-snip dim' }, S.snippet(d, 160))),
    h('div', { class: 'row-tags' }, tags.slice(0, 3).map(t => h('span', { class: 'chip sm' }, '#' + t))),
    h('div', { class: 'row-date dim small' }, fmtDate(d.updated)), mb);
}
async function emptyTrash() {
  const list = [...S.docs.values()].filter(d => d.deleted && !d.purged);
  if (!await confirmBox(`Permanently delete ${list.length} item(s)?`, 'Delete all')) return;
  for (const d of list) await S.purge(d);
  renderList();
}
async function renameTag(old) {
  const nv = await promptBox(`Rename #${old} to`, old, 'Rename'); if (!nv) return;
  const name = nv.replace(/^#/, '').trim().replace(/\s+/g, '-'); if (!name || name === old) return;
  const re = new RegExp(`(^|[^\\p{L}\\p{N}_&/#])#${old.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')}(?![\\p{L}\\p{N}_\\-])`, 'giu');
  for (const d of S.docs.values()) {
    if (!S.live(d) && !d.deleted) continue; if (!S.hasTag(d, old)) continue;
    d.tags = (d.tags || []).map(t => t.toLowerCase() === old.toLowerCase() ? name : t);
    d.title = (d.title || '').replace(re, `$1#${name}`);
    if (d.type === 'note') d.blocks.forEach(b => { if (b.t === 'text') b.text = b.text.replace(re, `$1#${name}`); });
    else (d.items || []).forEach(i => { if (i.k === 'text') i.text = i.text.replace(re, `$1#${name}`); });
    await S.save(d);
  }
  await S.removeCategory(old); await S.addCategory(name);
  renderCats(); location.hash = '#tag-' + encodeURIComponent(name.toLowerCase());
}
async function removeTag(name) {
  if (!await confirmBox(`Remove the #${name} category? Notes stay where they are; only the label is removed (hashtags typed inside note text are left in place).`, 'Remove')) return;
  for (const d of S.docs.values()) if (d.tags?.some(t => t.toLowerCase() === name.toLowerCase())) { d.tags = d.tags.filter(t => t.toLowerCase() !== name.toLowerCase()); await S.save(d); }
  await S.removeCategory(name); renderCats(); location.hash = '#all';
}

// ---------- settings ----------
function section(title, ...kids) { return h('section', { class: 'set-sec' }, h('h2', {}, title), ...kids); }
function seg(options, value, onpick) {
  return h('div', { class: 'seg' }, options.map(([v, label]) => h('button', { class: v === value ? 'on' : '', onclick: e => { e.currentTarget.parentNode.querySelectorAll('button').forEach(b => b.classList.remove('on')); e.currentTarget.classList.add('on'); onpick(v); } }, label)));
}
async function renderSettings() {
  contentEl.innerHTML = '';
  const page = h('div', { class: 'settings' }, h('div', { class: 'list-head' }, h('h1', {}, 'Settings')));
  contentEl.append(page);

  page.append(section('Appearance',
    h('div', { class: 'set-row' }, h('span', {}, 'Theme'), seg([['system', 'Match device'], ['light', 'Light'], ['dark', 'Dark']], store.get('theme', 'system'), v => { store.set('theme', v); applyTheme(); })),
    h('div', { class: 'set-row' }, h('span', {}, 'Library layout'), seg([['grid', 'Grid'], ['list', 'List']], layout, v => { layout = v; store.set('layout', v); viewBtn.replaceChildren(icon(v === 'grid' ? 'list' : 'grid')); }))));

  // Drive
  const cid = h('input', { class: 'input mono', placeholder: 'xxxxxxxx.apps.googleusercontent.com', value: Sync.clientId() });
  cid.addEventListener('change', () => { store.set('clientId', cid.value.trim()); });
  const st = h('div', { class: 'dim small' });
  const upd = () => { const s = Sync.status; st.textContent = s.state === 'off' ? 'Not connected. Everything is saved on this device only.' : `Status: ${s.state}${s.msg ? ' — ' + s.msg : ''}${s.pending ? ` · ${s.pending} files waiting to upload` : ''}${s.last ? ' · last synced ' + fmtDate(s.last) : ''}`; };
  upd(); const off = bus.on('sync', () => { if (!st.isConnected) return off(); upd(); });
  const btns = h('div', { class: 'row-actions' });
  const drawBtns = () => {
    btns.innerHTML = '';
    if (!Sync.enabled()) btns.append(h('button', { class: 'btn primary', onclick: async () => { store.set('clientId', cid.value.trim()); if (!Sync.clientId()) return toast('Paste the Google Client ID first'); try { await Sync.connect(); toast('Connected to Google Drive'); } catch (e) { toast(e.message, 5000); store.set('driveOn', false); } drawBtns(); renderSync(); } }, icon('cloud', 18), 'Connect Google Drive'));
    else btns.append(
      h('button', { class: 'btn primary', onclick: () => Sync.syncNow() }, icon('refresh', 18), 'Sync now'),
      Sync.status.state === 'needs-auth' ? h('button', { class: 'btn', onclick: () => Sync.reconnect().catch(e => toast(e.message)) }, 'Reconnect') : null,
      h('button', { class: 'btn', onclick: () => { Sync.disconnect(); drawBtns(); renderSync(); } }, 'Disconnect'));
  };
  drawBtns();
  const keep = h('input', { type: 'checkbox' }); keep.checked = !store.get('evictOriginals', true);
  keep.onchange = () => store.set('evictOriginals', !keep.checked);
  page.append(section('Sync with Google Drive',
    h('p', { class: 'dim small' }, `Your notes and images are stored as ordinary files in a “${DRIVE_FOLDER}” folder in your Google Drive, and every device signed in to the same Google account stays in sync.`),
    h('label', { class: 'field' }, h('span', {}, 'Google Client ID'), cid),
    st, btns,
    h('label', { class: 'check' }, keep, h('span', {}, 'Keep full-size originals on this device (otherwise they are fetched from Drive when you open an image full-screen)'))));

  // Import
  page.append(section('Import',
    h('p', { class: 'dim small' }, 'Bring in your VizRef boards with their exact layouts. On your PC, choose either the iPad “PrivateDocuments” folder (the one with the .VRB folders) or the “VizRef Export” folder. Boards that were already imported are skipped, so you can stop and resume.'),
    h('div', { class: 'row-actions' }, h('button', { class: 'btn', onclick: () => importVizRef().then(() => { renderCats(); }) }, icon('upload', 18), 'Import VizRef boards'))));

  // AI
  const key = h('input', { class: 'input mono', type: 'password', placeholder: 'sk-ant-…', value: AI.aiKey(), autocomplete: 'off' });
  key.addEventListener('change', () => store.set('aiKey', key.value.trim()));
  const mf = h('input', { class: 'input mono', value: AI.models().fast }); mf.onchange = () => store.set('aiFast', mf.value.trim());
  const ms = h('input', { class: 'input mono', value: AI.models().smart }); ms.onchange = () => store.set('aiSmart', ms.value.trim());
  const nTag = AI.untaggedCount();
  page.append(section('AI',
    h('p', { class: 'dim small' }, 'Two ways AI can use your library: (1) ask Claude in a normal chat to read the “All Notes.md” file and images in your Drive folder — no setup needed once sync is on; (2) the built-in Ask AI page and image tagging below, which use your own Anthropic API key (billed per use by Anthropic; the key stays on this device).'),
    h('label', { class: 'field' }, h('span', {}, 'Anthropic API key'), key),
    h('details', {}, h('summary', { class: 'dim small' }, 'Models'), h('label', { class: 'field' }, h('span', {}, 'Image tagging model'), mf), h('label', { class: 'field' }, h('span', {}, 'Ask AI model'), ms)),
    h('p', { class: 'small' }, `${nTag} image${nTag === 1 ? '' : 's'} not yet described. Tagging looks at each image once and writes a caption and search tags, so searches like “animals”, “foreshortening” or “rain” find matching images.`),
    h('div', { class: 'row-actions' }, h('button', { class: 'btn primary', disabled: !nTag, onclick: runTagging }, icon('sparkles', 18), 'Describe & tag images'))));

  // Install + data
  let est = ''; try { const e = await navigator.storage?.estimate?.(); if (e) est = `Using ${(e.usage / 1e6).toFixed(0)} MB on this device.`; } catch {}
  page.append(section('Install on your devices',
    h('ul', { class: 'install' },
      h('li', {}, h('b', {}, 'iPad: '), 'open the app’s address in Safari, tap the Share button, then “Add to Home Screen”.'),
      h('li', {}, h('b', {}, 'Android phone: '), 'open it in Chrome, tap the ⋮ menu, then “Install app” (or “Add to Home screen”).'),
      h('li', {}, h('b', {}, 'Windows (Edge): '), 'open it in Edge, click the ⋯ menu, then Apps → “Install this site as an app”.'))));
  page.append(section('Your data',
    h('p', { class: 'dim small' }, est + ' Nothing is locked in: in Drive every note is a plain file, and you can download a readable copy of everything here.'),
    h('div', { class: 'row-actions' },
      h('button', { class: 'btn', onclick: () => { const b = new Blob([Sync.exportMarkdown()], { type: 'text/markdown' }); const a = h('a', { href: URL.createObjectURL(b), download: `${APP_NAME} notes.md` }); a.click(); } }, icon('download', 18), 'Download all notes (.md)'))));
}
async function runTagging() {
  if (!AI.aiKey()) return toast('Add your Anthropic API key first');
  const pm = progressModal('Describing & tagging images');
  try {
    const r = await AI.tagImages({ onProgress: (n, total, ok) => pm.set(n / total, `${n} of ${total} images · ${ok} tagged`), shouldStop: () => pm.cancelled });
    pm.done(`${r.done} image(s) tagged${r.failed ? `, ${r.failed} skipped` : ''}.`);
  } catch (e) { pm.done(e.message); }
}

// ---------- Ask AI ----------
const askHistory = [];
function md(text) {
  const lines = esc(text).split('\n'); let html = '', list = null;
  const inline = s => s.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*([^*]+)\*/g, '$1<i>$2</i>').replace(/`([^`]+)`/g, '<code>$1</code>');
  for (const l of lines) {
    const m = l.match(/^\s*([-*]|\d+\.)\s+(.*)/);
    if (m) { const t = /\d/.test(m[1]) ? 'ol' : 'ul'; if (list !== t) { if (list) html += `</${list}>`; html += `<${t}>`; list = t; } html += `<li>${inline(m[2])}</li>`; continue; }
    if (list) { html += `</${list}>`; list = null; }
    const hm = l.match(/^(#{1,4})\s+(.*)/);
    if (hm) html += `<h${hm[1].length + 2}>${inline(hm[2])}</h${hm[1].length + 2}>`;
    else if (l.trim()) html += `<p>${inline(l)}</p>`;
  }
  if (list) html += `</${list}>`;
  return html;
}
function renderAnswer(text) {
  const el = h('div', { class: 'answer', html: md(text) });
  const walker = el.querySelectorAll('p, li, h3, h4, h5, h6');
  walker.forEach(node => {
    node.innerHTML = node.innerHTML.replace(/\[\[(doc|img):([\w-]+)\]\]/g, (m, k, id) => `<span class="ref" data-k="${k}" data-id="${id}"></span>`);
  });
  el.querySelectorAll('.ref').forEach(sp => {
    const id = sp.dataset.id;
    if (sp.dataset.k === 'doc') { const d = S.docs.get(id); sp.replaceWith(d ? h('button', { class: 'chip ref-doc', onclick: () => openDoc(d) }, icon(d.type === 'board' ? 'board' : 'note', 14), d.title || 'Untitled') : document.createTextNode('')); }
    else sp.replaceWith(S.media.get(id) ? h('button', { class: 'ref-img', onclick: () => lightbox(id) }, mImg(id, 't')) : document.createTextNode(''));
  });
  return el;
}
function renderAsk() {
  contentEl.innerHTML = '';
  const tags = S.allTags();
  const scope = h('select', { class: 'input' }, h('option', { value: '' }, 'Everything'), tags.map(t => h('option', { value: t.name }, '#' + t.name)));
  const q = h('textarea', { class: 'input ask-q', rows: 3, placeholder: 'Ask anything about your notes and boards…' });
  const out = h('div', { class: 'ask-out' });
  const presets = ['What are my best and worst ideas? Be honest and explain why.', 'Summarize what I have collected and what themes keep coming up.', 'Which of my ideas could combine into one stronger story?', 'Find images of animals or creatures.'];
  const go = async () => {
    const question = q.value.trim(); if (!question) return;
    if (!AI.aiKey()) { toast('Add your Anthropic API key in Settings → AI'); return; }
    let list = AI.liveDocs(); if (scope.value) list = list.filter(d => S.hasTag(d, scope.value));
    const item = h('div', { class: 'ask-item' }, h('div', { class: 'ask-question' }, question), h('div', { class: 'dim small spin' }, `Reading ${list.length} notes & boards…`));
    out.prepend(item); askBtn.disabled = true;
    try { const a = await AI.ask(question, list); item.lastChild.replaceWith(renderAnswer(a)); askHistory.unshift({ question, a }); }
    catch (e) { item.lastChild.replaceWith(h('div', { class: 'error' }, e.message)); }
    askBtn.disabled = false;
  };
  const askBtn = h('button', { class: 'btn primary', onclick: go }, icon('sparkles', 18), 'Ask');
  q.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) go(); });
  contentEl.append(h('div', { class: 'ask' },
    h('div', { class: 'list-head' }, h('h1', {}, 'Ask AI'), h('div', { class: 'dim small' }, 'Claude reads your notes (and image descriptions, if you have tagged images) and answers with links back to them.')),
    !AI.aiKey() ? h('div', { class: 'notice' }, 'This needs an Anthropic API key — add it in ', h('a', { href: '#prefs' }, 'Settings → AI'), '. Or ask Claude in a normal chat to read “All Notes.md” in your Drive folder.') : null,
    h('div', { class: 'ask-form' }, h('div', { class: 'ask-row' }, h('span', { class: 'dim small' }, 'Look in'), scope), q, h('div', { class: 'presets' }, presets.map(p => h('button', { class: 'chip', onclick: () => { q.value = p; q.focus(); } }, p))), h('div', { class: 'row-actions' }, askBtn)),
    out));
  for (const it of askHistory) out.append(h('div', { class: 'ask-item' }, h('div', { class: 'ask-question' }, it.question), renderAnswer(it.a)));
}

// ---------- boot ----------
async function boot() {
  buildShell();
  try { await S.load(); } catch (e) { contentEl.append(h('div', { class: 'error' }, 'Could not open local storage: ' + e.message)); return; }
  renderCats(); renderSync();
  bus.on('sync', renderSync);
  bus.on('categories', renderCats);
  bus.on('pulled', () => { renderCats(); if (!editor) renderList(); });
  addEventListener('hashchange', route);
  route();
  Sync.start();
  try { navigator.storage?.persist?.(); } catch {}
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
  addEventListener('keydown', e => {
    if (editor || /INPUT|TEXTAREA/.test(e.target.tagName) || e.target.isContentEditable) return;
    if (e.key === '/' ) { e.preventDefault(); searchIn.focus(); }
    if (e.key === 'n' && !e.ctrlKey && !e.metaKey) createNote();
  });
}
boot();
