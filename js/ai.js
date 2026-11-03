// AI features via the Anthropic API (user's own key, called directly from the browser).
import { AI_MODEL_FAST, AI_MODEL_SMART } from './config.js';
import { store, blobToDataURL, esc } from './util.js';
import { media, docs, live, tagsOf, mediaOf, saveMedia, mediaTouched } from './state.js';
import * as Media from './media.js';

export const aiKey = () => store.get('aiKey', '');
export const models = () => ({ fast: store.get('aiFast', AI_MODEL_FAST), smart: store.get('aiSmart', AI_MODEL_SMART) });

async function call({ model, system, messages, max_tokens = 2000 }) {
  const key = aiKey(); if (!key) throw new Error('Add your Anthropic API key in Settings first.');
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true', 'content-type': 'application/json' },
    body: JSON.stringify({ model, max_tokens, system, messages }),
  });
  if (!r.ok) { let m = r.status + ''; try { m = (await r.json()).error?.message || m; } catch {} throw new Error('AI request failed: ' + m); }
  const j = await r.json();
  return (j.content || []).map(c => c.text || '').join('');
}

// ---------- image tagging ----------
function usedMediaIds() { const s = new Set(); for (const d of docs.values()) if (live(d)) for (const id of mediaOf(d)) s.add(id); for (const d of docs.values()) if (live(d) && d.thumb) s.add(d.thumb); return s; }
export function untaggedCount() { const used = usedMediaIds(); let n = 0; for (const m of media.values()) if (Media.isImage(m) && used.has(m.id) && !m.ai) n++; return n; }

const TAG_PROMPT = `You are cataloguing a comic artist's visual reference library so it can be searched later.
For EACH image, give:
- "caption": one plain sentence describing what is shown.
- "tags": 8–16 lowercase search tags. Cover: subjects (people, specific animals and creatures, objects, vehicles, places), actions and poses, camera angle / perspective (e.g. foreshortening, low angle, bird's eye), comic-craft terms when they apply (splash page, double page spread, panel layout, cover, sound effects, speed lines, crowd scene, fight scene), art style or medium (manga, western comic, painted, line art, black and white, colour), and mood.
Reply with ONLY a JSON array, one object per image, in the same order: [{"caption": "...", "tags": ["..."]}]`;

async function imagePart(m) {
  let b = await Media.blob(m.id, 't') || await Media.blob(m.id, 'p');
  if (!b) { const u = await Media.url(m.id, 't'); if (u) b = await (await fetch(u)).blob(); }
  if (!b) return null;
  if (!/image\/(jpeg|png|gif|webp)/.test(b.type)) return null;
  const data = (await blobToDataURL(b)).split(',')[1];
  return { type: 'image', source: { type: 'base64', media_type: b.type, data } };
}
export async function tagImages({ onProgress, shouldStop, batch = 4 }) {
  const used = usedMediaIds();
  const list = [...media.values()].filter(m => Media.isImage(m) && used.has(m.id) && !m.ai);
  let done = 0, failed = 0;
  const total = list.length;
  for (let i = 0; i < list.length; i += batch * 2) {
    if (shouldStop?.()) break;
    const groups = [list.slice(i, i + batch), list.slice(i + batch, i + batch * 2)].filter(g => g.length);
    await Promise.all(groups.map(async g => {
      const content = [];
      const ok = [];
      for (const m of g) { const p = await imagePart(m); if (p) { content.push({ type: 'text', text: `Image ${ok.length + 1}:` }, p); ok.push(m); } }
      if (!ok.length) { failed += g.length; return; }
      content.push({ type: 'text', text: `Describe these ${ok.length} image(s) as instructed.` });
      try {
        const txt = await call({ model: models().fast, system: TAG_PROMPT, messages: [{ role: 'user', content }], max_tokens: 300 * ok.length + 200 });
        const arr = JSON.parse(txt.slice(txt.indexOf('['), txt.lastIndexOf(']') + 1));
        for (let k = 0; k < ok.length; k++) {
          const r = arr[k]; if (!r) continue;
          ok[k].ai = { caption: String(r.caption || '').slice(0, 300), tags: (r.tags || []).map(t => String(t).toLowerCase().trim()).filter(Boolean).slice(0, 20), at: Date.now() };
          await saveMedia(ok[k]);
        }
        done += ok.length; failed += g.length - ok.length;
      } catch (e) { failed += g.length; if (/api key|authentication|credit|permission/i.test(e.message)) throw e; console.warn(e); }
    }));
    mediaTouched();
    onProgress?.(done + failed, total, done);
  }
  return { done, failed, total };
}

// ---------- ask across notes ----------
const ASK_SYSTEM = `You are a sharp, honest creative collaborator with read access to the user's personal notes app (notes, reference boards, and AI descriptions of their images).
The user is a comic creator and illustrator. Answer their question using the material provided. Be direct and specific — give real opinions when asked (e.g. which ideas are strongest or weakest and why), not flattery.
When you refer to a specific note or board, cite it as [[doc:ID]]. When you refer to a specific image, cite it as [[img:ID]]. Use the exact ids given. Use short markdown (headings, bullets, bold) where it helps.`;

export function buildContext(docList, { images = true, maxChars = 320000 } = {}) {
  const parts = [];
  for (const d of docList) {
    const tg = tagsOf(d).map(t => '#' + t).join(' ');
    let body = '';
    if (d.type === 'note') for (const b of d.blocks) {
      if (b.t === 'text') body += b.text + '\n';
      if (b.t === 'link') body += `Link: ${b.label ? b.label + ' — ' : ''}${b.url}\n`;
      if (b.t === 'image' || b.t === 'file') { const m = media.get(b.media); body += `[img:${b.media}] ${m?.ai?.caption || m?.name || ''}${b.caption ? ' — ' + b.caption : ''}\n`; }
    } else {
      for (const it of d.items || []) if (it.k === 'text') body += 'Text on board: ' + it.text + '\n';
      if (images) for (const it of d.items || []) if (it.k === 'img') { const m = media.get(it.media); if (m?.ai) body += `[img:${it.media}] ${m.ai.caption} (${m.ai.tags.join(', ')})\n`; }
      const n = (d.items || []).filter(i => i.k === 'img').length; body += `(${n} images on this board)\n`;
    }
    parts.push(`<${d.type} id="${d.id}" title="${esc(d.title || 'Untitled')}" categories="${tg}" updated="${new Date(d.updated).toISOString().slice(0, 10)}">\n${body.trim()}\n</${d.type}>`);
  }
  let ctx = parts.join('\n\n');
  let truncated = false;
  if (ctx.length > maxChars) { ctx = ctx.slice(0, maxChars); truncated = true; }
  return { ctx, truncated, count: docList.length };
}
export async function ask(question, docList, opts = {}) {
  const { ctx, truncated } = buildContext(docList, opts);
  const text = await call({
    model: models().smart, system: ASK_SYSTEM, max_tokens: 4000,
    messages: [{ role: 'user', content: `Here is my material${truncated ? ' (truncated — it was too long to include fully)' : ''}:\n\n${ctx}\n\n---\nMy question: ${question}` }],
  });
  return text;
}
export function liveDocs() { return [...docs.values()].filter(live); }
