// 素材库 (clips/F-0001.json): figures cut from papers and small facts (template line widths, plotting settings).
// The record (title, categories, source paper, Zotero link) lives in the notebook repository; the image itself is
// written to a folder the user picks once (e.g. in iCloud Drive), so pictures never go into GitHub.
import { nowISO } from './model.js';
import { kv } from './store.js';
import { h, icon } from './util.js';
import { DEMO, choose, demoBanner, lib, modal, saveError, toast, topbar, view } from './core.js';
import { route } from './app.js';
import { loadPlanner } from './planner.js';
import { lookupPaper, paperKey, paperKeywords } from './home.js';

// clip = { id, kind: 'img' | 'note', title, cats: [], note, file, w, h,
//          src: { zotero, page, fig, cite, doi, ref: { title, authors, journal, year, doi }, task }, created, updated }
export const clipPath = (id) => `clips/${id}.json`;
export const clipIds = () => [...lib.tree.keys()].map((p) => (p.match(/^clips\/(F-\d{4})\.json$/) || [])[1]).filter(Boolean).sort();
const memo = new Map();
export async function loadClips() {
  return (await Promise.all(clipIds().map(async (id) => {
    const k = `${id}@${lib.tree.get(clipPath(id))}`;
    if (!memo.has(k)) memo.set(k, lib.readText(clipPath(id)).then(JSON.parse).catch(() => null));
    return memo.get(k);
  }))).filter(Boolean);
}
const nextId = () => `F-${String(Math.max(0, ...clipIds().map((x) => parseInt(x.slice(2), 10))) + 1).padStart(4, '0')}`;
async function saveClip(c, msg) {
  c.updated = nowISO();
  await lib.commit(msg, async () => ({ changes: [{ path: clipPath(c.id), data: `${JSON.stringify(c, null, 1)}\n` }] }));
}

// ---------- the picture folder ----------
// Chrome / Edge on a computer can keep a folder handle (stored in IndexedDB on this device). Safari and phones cannot,
// so there the library shows records and sources only. The demo uses the browser's private storage instead.
const DIR_KEY = 'clips-dir';
export const folderSupported = () => DEMO ? !!navigator.storage?.getDirectory : 'showDirectoryPicker' in window;
let dirCache = null;
async function storedDir() {
  if (DEMO) return (await navigator.storage.getDirectory()).getDirectoryHandle('labnote-clips', { create: true });
  return kv.get(DIR_KEY).catch(() => null);
}
// 'none' (never chosen) | 'ask' (chosen, needs one click this visit) | 'ok' | 'unsupported'
export async function folderState() {
  if (!folderSupported()) return { state: 'unsupported' };
  if (dirCache) return { state: 'ok', dir: dirCache };
  const d = await storedDir();
  if (!d) return { state: 'none' };
  const p = DEMO ? 'granted' : await d.queryPermission({ mode: 'readwrite' }).catch(() => 'prompt');
  if (p === 'granted') { dirCache = d; return { state: 'ok', dir: d }; }
  return { state: 'ask', dir: d };
}
// Needs a click (browsers only show the permission prompt for a user action).
export async function connectFolder({ pickNew = false } = {}) {
  let d = pickNew ? null : await storedDir();
  if (d && !DEMO) {
    const p = await d.requestPermission({ mode: 'readwrite' }).catch(() => 'denied');
    if (p !== 'granted') { toast('没有得到文件夹权限。'); return null; }
  }
  if (!d) {
    try { d = await window.showDirectoryPicker({ id: 'labnote-clips', mode: 'readwrite', startIn: 'documents' }); } catch { return null; }
    await kv.set(DIR_KEY, d);
  }
  dirCache = d;
  return d;
}
async function writeImage(dir, name, blob) {
  const fh = await dir.getFileHandle(name, { create: true });
  const w = await fh.createWritable();
  await w.write(blob); await w.close();
}
const urlCache = new Map(); // file name -> object URL, kept for the session so the grid does not flicker
async function imageUrl(name) {
  if (!name) return null;
  if (urlCache.has(name)) return urlCache.get(name);
  const st = await folderState();
  if (st.state !== 'ok') return null;
  try {
    const f = await (await st.dir.getFileHandle(name)).getFile();
    const u = URL.createObjectURL(f); urlCache.set(name, u); return u;
  } catch { return null; }
}
async function imageBlob(name) {
  const st = await folderState();
  if (st.state !== 'ok') return null;
  try { return await (await st.dir.getFileHandle(name)).getFile(); } catch { return null; }
}
const safe = (s) => String(s || '').replace(/[\\/:*?"<>|\s]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);

// ---------- sources ----------
// Text copied from Zotero's PDF reader carries its links, e.g.
//   “Figure 3. …” ([Liu et al., 2024, p. 5](zotero://select/library/items/AB12CD34)) ([pdf](zotero://open-pdf/library/items/EF56GH78?page=5&annotation=…))
export function parseZotero(text) {
  const t = String(text || '');
  const out = {};
  const pdf = t.match(/zotero:\/\/open-pdf\/[^\s)\]"'>]+/);
  const sel = t.match(/zotero:\/\/select\/[^\s)\]"'>]+/);
  if (pdf) out.zotero = pdf[0]; else if (sel) out.zotero = sel[0];
  if (sel) out.zselect = sel[0];
  const pg = (pdf && pdf[0].match(/[?&]page=(\d+)/)) || t.match(/\bp\.\s*(\d+)/);
  if (pg) out.page = pg[1];
  const cite = t.match(/\(\[?([A-Z][^()[\]]*?(?:et al\.)?),\s*((?:19|20)\d{2})/) || t.match(/\b([A-Z][A-Za-z'-]+(?: et al\.| and [A-Z][A-Za-z'-]+)?),?\s+((?:19|20)\d{2})\b/);
  if (cite) out.cite = `${cite[1].trim()} ${cite[2]}`;
  const fig = t.match(/\b(?:Fig(?:ure)?\.?|Scheme|Table)\s*S?\d+[a-z]?(?:[,–-]\s*[a-z])?/i);
  if (fig) out.fig = fig[0].replace(/^Figure/i, 'Fig.').replace(/^Fig\s/i, 'Fig. ');
  const quote = t.match(/[“"]([^”"]{4,})[”"]/);
  if (quote) out.caption = quote[1].trim();
  const doi = paperKey(t)?.doi; if (doi) out.doi = doi;
  return out;
}
// zotero://open-pdf with the page the figure is on.
export function zoteroHref(src) {
  const z = src?.zotero; if (!z) return '';
  if (!/open-pdf/.test(z) || !src.page || /[?&]page=/.test(z)) return z;
  return `${z}${z.includes('?') ? '&' : '?'}page=${src.page}`;
}
export function srcLine(src) {
  if (!src) return '';
  const r = src.ref;
  const who = r ? [String(r.authors || '').split(/[ ,]/)[0], r.year].filter(Boolean).join(' ') : src.cite || '';
  return [who, r?.journal, src.fig, src.page ? `第 ${src.page} 页` : ''].filter(Boolean).join(' · ');
}
const readingList = async () => ((await loadPlanner().catch(() => ({ tasks: [] }))).tasks || []).filter((x) => x.cat === '文献');
const taskLabel = (x) => (x.ref ? `${x.keys || paperKeywords(x.ref.title) || x.ref.title} — ${String(x.ref.authors || '').split(/[ ,]/)[0]} ${x.ref.year || ''}` : x.text).slice(0, 90);
// Links a clip to a reading-list entry by DOI, or by first author + year.
function matchTask(list, src) {
  const doi = (src.doi || src.ref?.doi || '').toLowerCase();
  if (doi) { const t = list.find((x) => x.ref?.doi?.toLowerCase() === doi || paperKey(x.text)?.doi?.toLowerCase() === doi); if (t) return t; }
  const m = String(src.cite || '').match(/^([A-Za-z'-]+).*?((?:19|20)\d{2})$/);
  if (m) return list.find((x) => x.ref && String(x.ref.authors || '').toLowerCase().startsWith(m[1].toLowerCase()) && String(x.ref.year) === m[2]) || null;
  return null;
}

// 0.5 pt (≈ 0.18 mm): line widths and sizes in notes show the other unit too.
export function unitHints(text) {
  return String(text || '').replace(/(\d+(?:\.\d+)?)\s*(pt|mm)\b(?!\s*[（(]≈)/g, (all, n, u) => {
    const v = parseFloat(n); if (u === 'mm' && v > 3) return all; // only thin lines in mm; page sizes stay as written
    const o = u === 'pt' ? `${(v * 0.3528).toFixed(v * 0.3528 < 1 ? 2 : 1)} mm` : `${(v / 0.3528).toFixed(v / 0.3528 < 10 ? 2 : 1)} pt`;
    return `${all}（≈${o}）`;
  });
}

// ---------- the library page ----------
const ALL = '';
const UNSORTED = '__none__';
export async function viewClips(cat = ALL, params = new URLSearchParams()) {
  const [clips, reading, fs] = await Promise.all([loadClips(), readingList(), folderState()]);
  const paper = params.get('paper') || '';
  const pTask = paper ? reading.find((x) => x.id === paper) : null;
  const cats = new Map();
  for (const c of clips) for (const k of c.cats || []) cats.set(k, (cats.get(k) || 0) + 1);
  const catList = [...cats].sort((a, b) => a[0].localeCompare(b[0], 'zh'));
  const unsorted = clips.filter((c) => !(c.cats || []).length).length;
  const q = h('input', { type: 'search', placeholder: '搜索：标题、笔记、作者、Fig.', 'aria-label': '搜索素材' });
  const grid = h('div', { class: 'clip-grid' });
  const inCat = (c) => (cat === ALL ? true : cat === UNSORTED ? !(c.cats || []).length : (c.cats || []).includes(cat));
  const draw = () => {
    const t = q.value.trim().toLowerCase();
    const hit = clips.filter((c) => inCat(c) && (!paper || c.src?.task === paper)
      && (!t || `${c.id} ${c.title} ${c.note} ${(c.cats || []).join(' ')} ${srcLine(c.src)} ${c.src?.ref?.title || ''} ${c.src?.caption || ''}`.toLowerCase().includes(t)))
      .sort((a, b) => String(b.created).localeCompare(String(a.created)));
    grid.replaceChildren(...(hit.length ? hit.map((c) => clipTile(c, fs)) : [h('div', { class: 'tile clip-empty' },
      h('p', null, clips.length ? '这里没有符合条件的素材。' : '素材库还是空的。'),
      h('p', { class: 'muted' }, '在 Zotero 里截图（⌃⇧⌘4 截到剪贴板），回到这里按 ⌘V；或点“记一条文字”记下 template 框线、作图参数这类杂项。'))]));
  };
  q.addEventListener('input', draw);
  draw();
  const catBtn = (key, label, n) => h('a', { class: `clip-cat${cat === key && !paper ? ' on' : ''}`, href: key === ALL ? '#/clips' : `#/clips/${encodeURIComponent(key)}` }, h('span', null, label), h('b', null, String(n)));
  const side = h('nav', { class: 'clip-cats', 'aria-label': '分类' },
    catBtn(ALL, '全部', clips.length), ...catList.map(([k, n]) => catBtn(k, k, n)), unsorted ? catBtn(UNSORTED, '未分类', unsorted) : null);
  const folderBar = fs.state === 'ok' ? null : h('div', { class: `clip-folder st-${fs.state}` },
    fs.state === 'unsupported'
      ? h('p', null, '这个浏览器不能读取电脑上的文件夹，所以只显示文字和出处。看图请在电脑上用 Chrome 打开。')
      : [h('p', null, fs.state === 'none' ? '先选一个存图片的文件夹（建议在 iCloud 云盘里新建「LabNotebook 图库」）。图片只存在那里，不进 GitHub。' : '点一下，允许读取图片文件夹（Chrome 会问“每次访问都允许”，选它以后就不用再点）。'),
        h('button', { class: 'btn primary small', type: 'button', onclick: async () => { if (await connectFolder()) route({ quiet: true }); } }, icon('attach', 16), fs.state === 'none' ? '选择文件夹' : '允许读取')]);
  const fileIn = h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: (e) => { const f = e.target.files?.[0]; if (f) editClip(null, { image: f, cat: realCat(cat), task: paper }); e.target.value = ''; } });
  const realCat = (k) => (k === ALL || k === UNSORTED ? '' : k);
  // ⌘V anywhere on this page (outside text fields) starts a new clip with the pasted picture or Zotero text.
  const onPaste = (e) => {
    if (view.kind !== 'clips' || document.querySelector('.modal-root')) return;
    if (e.target.closest?.('input, textarea, [contenteditable="true"]')) return;
    const img = [...(e.clipboardData?.files || [])].find((f) => f.type.startsWith('image/'));
    const text = e.clipboardData?.getData('text/plain') || '';
    if (!img && !text.trim()) return;
    e.preventDefault();
    editClip(null, { image: img || null, text: img ? '' : text, cat: realCat(cat), task: paper });
  };
  document.removeEventListener('paste', window.__clipPaste || (() => {}));
  window.__clipPaste = onPaste;
  document.addEventListener('paste', onPaste);
  const title = pTask ? `素材库 · ${pTask.ref ? (pTask.keys || paperKeywords(pTask.ref.title)) : pTask.text}` : cat === ALL ? '素材库' : cat === UNSORTED ? '素材库 · 未分类' : `素材库 · ${cat}`;
  return h('div', { class: 'view clips' },
    topbar({ back: cat !== ALL || paper ? '#/clips' : '#/', backLabel: cat !== ALL || paper ? '素材库' : '首页', title,
      sub: `${clips.filter((c) => c.kind === 'img').length} 张图 · ${clips.filter((c) => c.kind !== 'img').length} 条文字 · 在 Zotero 截图后按 ⌘V`,
      actions: [
        fs.state === 'ok' && !DEMO ? h('button', { class: 'btn ghost', type: 'button', title: '换一个存图片的文件夹', onclick: async () => { if (await connectFolder({ pickNew: true })) { urlCache.clear(); route({ quiet: true }); } } }, h('span', { class: 'wide-only' }, '图片文件夹')) : null,
        h('button', { class: 'btn', type: 'button', onclick: () => editClip(null, { kind: 'note', cat: realCat(cat) }) }, icon('note', 18), h('span', null, '记一条文字')),
        fs.state !== 'unsupported' ? h('button', { class: 'btn primary', type: 'button', onclick: () => fileIn.click() }, icon('plus', 18), h('span', null, '加图片')) : null].filter(Boolean) }),
    demoBanner(),
    h('div', { class: 'clip-wrap' }, folderBar,
      pTask ? h('p', { class: 'clip-paper' }, h('span', { class: 'm-art-kicker' }, '文献'), pTask.ref ? `${pTask.ref.title}（${[pTask.ref.authors, pTask.ref.journal, pTask.ref.year].filter(Boolean).join(' · ')}）` : pTask.text, ' ', h('a', { href: '#/clips' }, '看全部')) : null,
      h('div', { class: 'clip-layout' }, side, h('div', null, h('div', { class: 'search-row' }, q), grid)), fileIn));
}

function clipTile(c, fs) {
  const img = c.kind === 'img';
  const box = h('div', { class: 'clip-thumb' }, img ? h('span', { class: 'muted small' }, fs.state === 'ok' ? '图片文件找不到' : '图片在 iCloud 文件夹里') : null);
  if (img && fs.state === 'ok') imageUrl(c.file).then((u) => { if (u) box.replaceChildren(h('img', { src: u, alt: c.title || '', loading: 'lazy' })); });
  return h('button', { type: 'button', class: `tile clip-tile${img ? '' : ' clip-note'}`, onclick: () => openClip(c.id) },
    img ? box : h('p', { class: 'clip-note-text' }, unitHints(c.note).slice(0, 220)),
    h('div', { class: 'clip-cap' },
      h('b', null, c.title || (img ? '未命名图' : '未命名')),
      srcLine(c.src) ? h('span', { class: 'clip-src' }, srcLine(c.src)) : null,
      (c.cats || []).length ? h('span', { class: 'clip-tags' }, c.cats.join(' · ')) : null));
}

export async function openClip(id) {
  const c = (await loadClips()).find((x) => x.id === id);
  if (!c) return toast(`没有素材 ${id}。`);
  const big = h('div', { class: 'clip-big' });
  if (c.kind === 'img') {
    const u = await imageUrl(c.file);
    big.append(u ? h('img', { src: u, alt: c.title || '' }) : h('p', { class: 'muted' }, (await folderState()).state === 'ok' ? `图片文件 ${c.file} 不在文件夹里（可能被移动或改名）。` : `图片存在电脑的图片文件夹里：${c.file}`));
  }
  const s = c.src || {};
  const zh = zoteroHref(s);
  const doi = s.ref?.doi || s.doi;
  const body = h('div', { class: 'clip-detail' }, big,
    (c.cats || []).length ? h('p', { class: 'clip-tags' }, c.cats.map((k) => h('a', { href: `#/clips/${encodeURIComponent(k)}`, onclick: () => document.querySelectorAll('.modal-root').forEach((m) => m.close?.()) }, k))) : null,
    c.note ? h('p', { class: 'clip-note-full' }, unitHints(c.note)) : null,
    s.ref || s.cite || zh || doi ? h('div', { class: 'clip-source' },
      h('span', { class: 'm-art-kicker' }, '出处'),
      s.ref?.title ? h('p', null, h('b', null, s.ref.title)) : null,
      h('p', { class: 'muted' }, [s.ref?.authors || s.cite, s.ref?.journal, s.ref?.year, s.fig, s.page ? `第 ${s.page} 页` : ''].filter(Boolean).join(' · ')),
      s.caption ? h('p', { class: 'muted small' }, `“${s.caption}”`) : null,
      h('div', { class: 'clip-src-act' },
        zh ? h('a', { class: 'btn small primary', href: zh }, icon('book', 16), s.page && /open-pdf/.test(zh) ? `在 Zotero 打开第 ${s.page} 页` : '在 Zotero 打开') : null,
        doi ? h('a', { class: 'btn small', href: `https://doi.org/${doi}`, target: '_blank', rel: 'noopener' }, 'DOI') : null,
        s.task ? h('a', { class: 'btn small ghost', href: `#/clips?paper=${s.task}`, onclick: () => document.querySelectorAll('.modal-root').forEach((m) => m.close?.()) }, '这篇的所有素材') : null))
      : h('p', { class: 'muted small' }, '没有记出处。'),
    h('p', { class: 'muted small' }, `${c.id}${c.file ? ` · ${c.file}` : ''}`));
  const dlg = modal({ title: c.title || c.id, wide: true, body, buttons: [
    { label: '删除', danger: true, run: async () => { if (await deleteClip(c)) { dlg.close(); route({ quiet: true }); } return false; } },
    c.kind === 'img' ? { label: '复制图片', run: async () => {
      const b = await imageBlob(c.file); if (!b) { toast('读不到图片文件。'); return false; }
      try { const png = b.type === 'image/png' ? b : await toPng(b); await navigator.clipboard.write([new window.ClipboardItem({ 'image/png': png })]); toast('图片已复制，可以粘贴到 PPT / Word。'); } catch { toast('浏览器不允许复制图片。'); }
      return false;
    } } : null,
    { label: '修改', primary: true, run: () => { setTimeout(() => editClip(c), 0); } }] });
}
async function toPng(blob) {
  const bmp = await createImageBitmap(blob);
  const cv = document.createElement('canvas'); cv.width = bmp.width; cv.height = bmp.height;
  cv.getContext('2d').drawImage(bmp, 0, 0);
  return new Promise((r) => cv.toBlob(r, 'image/png'));
}
async function deleteClip(c) {
  const st = await folderState();
  const opts = [['rec', '只删记录（图片文件留在文件夹）'], ['no', '取消']];
  if (c.kind === 'img' && st.state === 'ok') opts.splice(1, 0, ['both', '记录和图片文件都删']);
  const a = await choose(`删除 ${c.id}？`, '记录删除后，GitHub 历史里还能找回；图片文件删掉后到“最近删除”里找（iCloud 云盘保留 30 天）。', opts);
  if (!a || a === 'no') return false;
  try {
    await lib.commit(`Delete clip ${c.id}`, async () => ({ changes: [{ path: clipPath(c.id), delete: true }] }));
    if (a === 'both') { await st.dir.removeEntry(c.file).catch(() => {}); urlCache.delete(c.file); }
    toast(`${c.id} 已删除。`); return true;
  } catch (e) { toast(saveError(e)); return false; }
}

// ---------- add / edit ----------
const LAST_SRC = 'labnote-clip-src';
const lastSrc = () => { try { return JSON.parse(localStorage.getItem(LAST_SRC) || 'null'); } catch { return null; } };
export async function editClip(c, { image = null, text = '', kind = 'img', cat = '', task = '' } = {}) {
  const isNew = !c;
  const x = c ? structuredClone(c) : { kind: image ? 'img' : kind, cats: cat ? [cat] : [], src: {} };
  const [all, reading] = await Promise.all([loadClips(), readingList()]);
  let pic = image;
  const preview = h('div', { class: 'clip-drop' });
  const showPic = (f) => {
    pic = f; x.kind = 'img';
    const u = URL.createObjectURL(f); view.urls.push(u);
    preview.replaceChildren(h('img', { src: u, alt: '' }));
  };
  if (x.kind === 'img') {
    if (pic) showPic(pic);
    else if (x.file) imageUrl(x.file).then((u) => preview.replaceChildren(u ? h('img', { src: u, alt: '' }) : h('span', { class: 'muted' }, x.file)));
    else preview.append(h('span', { class: 'muted' }, '在这里按 ⌘V 粘贴截图，或把图片拖进来'));
  }
  const title = h('input', { id: 'cl-title', value: x.title || '', placeholder: x.kind === 'img' ? '一句话说明，例如：垂直 OECT 截面结构' : '例如：Template 框线粗细' });
  // categories: chips of existing ones (click to toggle) + a free box for new ones
  const picked = new Set(x.cats || []);
  const known = [...new Set([...all.flatMap((y) => y.cats || []), ...picked])].sort((a, b) => a.localeCompare(b, 'zh'));
  const chips = h('div', { class: 'clip-chips' });
  const newCat = h('input', { id: 'cl-cat', placeholder: known.length ? '新分类，回车添加（可多个，逗号分隔）' : '分类，例如 v-OECTs结构、大鼠皮肤修复图、画图/template（逗号分隔）' });
  const drawChips = () => chips.replaceChildren(...[...new Set([...known, ...picked])].map((k) => h('button', { type: 'button', class: `chip${picked.has(k) ? ' on' : ''}`, 'aria-pressed': String(picked.has(k)), onclick: () => { if (picked.has(k)) picked.delete(k); else picked.add(k); drawChips(); } }, k)));
  const addCats = () => { for (const k of newCat.value.split(/[,，、;；]/).map((s) => s.trim()).filter(Boolean)) { picked.add(k); if (!known.includes(k)) known.push(k); } newCat.value = ''; drawChips(); };
  newCat.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addCats(); } });
  newCat.addEventListener('blur', addCats);
  drawChips();
  const note = h('textarea', { id: 'cl-note', rows: x.kind === 'img' ? 3 : 6, placeholder: x.kind === 'img' ? '可选：为什么存这张，打算怎么用' : '例如：Nature 模板：框线 0.5 pt，坐标字号 7 pt，图宽单栏 89 mm / 双栏 183 mm' }, x.note || '');
  const hint = h('p', { class: 'muted small clip-hint' });
  const drawHint = () => { const t = unitHints(note.value); hint.textContent = t !== note.value ? `换算：${(t.match(/\d+(?:\.\d+)?\s*(?:pt|mm)（≈[^）]+）/g) || []).join('；')}` : ''; };
  note.addEventListener('input', drawHint); drawHint();
  // source
  const s = { ...(x.src || {}) };
  if (isNew && !text) { const l = lastSrc(); if (l && Date.now() - (l.at || 0) < 6 * 3600e3) Object.assign(s, { ...l.src, fig: '', page: '', caption: '' }); }
  if (isNew && task) s.task = task;
  const zbox = h('textarea', { id: 'cl-z', rows: 2, class: 'mono-area', placeholder: '在 Zotero PDF 里选中图注（如 “Figure 3.”）→ ⌘C → 粘贴到这里；自动认出文章、页码、Fig. 号和 Zotero 链接' }, s.zotero || '');
  const fig = h('input', { id: 'cl-fig', value: s.fig || '', placeholder: 'Fig. 3b' });
  const page = h('input', { id: 'cl-page', value: s.page || '', placeholder: '5', inputmode: 'numeric' });
  const doi = h('input', { id: 'cl-doi', value: s.ref?.doi || s.doi || '', placeholder: 'DOI 或文章链接（可选，用来查题目和期刊）' });
  const tsel = h('select', { id: 'cl-task' }, h('option', { value: '' }, '（不关联）'), reading.map((t) => h('option', { value: t.id, selected: t.id === s.task }, `${t.done ? '✓ ' : ''}${taskLabel(t)}`)));
  const srcInfo = h('p', { class: 'muted small' });
  const drawInfo = () => { srcInfo.textContent = [s.cite || (s.ref ? srcLine({ ref: s.ref }) : ''), s.caption ? `“${s.caption.slice(0, 60)}”` : ''].filter(Boolean).join(' · '); };
  const absorb = (t) => {
    const z = parseZotero(t);
    if (!Object.keys(z).length) return false;
    if (z.zotero) { s.zotero = z.zotero; zbox.value = z.zotero; }
    if (z.page) page.value = z.page;
    if (z.fig && !fig.value) fig.value = z.fig;
    if (z.cite) s.cite = z.cite;
    if (z.caption) { s.caption = z.caption; if (!title.value) { const t = z.caption.replace(/^(?:Fig(?:ure)?\.?|Scheme)\s*S?\d+[a-z]?\.?\s*/i, ''); title.value = t.length > 60 ? `${t.slice(0, 60).replace(/\s+\S*$/, '')}…` : t.replace(/\.$/, ''); } }
    if (z.doi && !doi.value) doi.value = z.doi;
    const m = matchTask(reading, { ...s, doi: doi.value });
    if (m && !tsel.value) { tsel.value = m.id; if (m.ref && !doi.value) doi.value = m.ref.doi || ''; }
    drawInfo();
    return true;
  };
  zbox.addEventListener('paste', (e) => { const t = e.clipboardData?.getData('text/plain') || ''; if (t && absorb(t)) e.preventDefault(); });
  zbox.addEventListener('change', () => absorb(zbox.value));
  tsel.addEventListener('change', () => { const t = reading.find((y) => y.id === tsel.value); if (t?.ref?.doi) doi.value = t.ref.doi; });
  if (text) absorb(text);
  drawInfo();
  const lbl = (f, t) => h('label', { for: f }, t);
  const form = h('div', { class: 'form clip-form' },
    x.kind === 'img' ? preview : null,
    lbl('cl-title', '标题'), title,
    h('span', { class: 'label' }, '分类（可多选；点一下选中/取消）'), chips, newCat,
    lbl('cl-note', x.kind === 'img' ? '备注' : '内容'), note, hint,
    h('details', { class: 'clip-src-box', open: x.kind === 'img' },
      h('summary', null, '出处（溯源回文献）'),
      lbl('cl-z', 'Zotero 链接 / 从 Zotero 复制的图注'), zbox, srcInfo,
      h('div', { class: 'pair' }, h('div', null, lbl('cl-fig', '图号'), fig), h('div', null, lbl('cl-page', 'PDF 页码'), page)),
      lbl('cl-task', '对应「文献待读」里的哪篇'), tsel,
      lbl('cl-doi', 'DOI'), doi));
  // paste / drop a picture into the dialog (focus may be anywhere while it is open)
  const onP = (e) => {
    if (e.defaultPrevented) return;
    const f = [...(e.clipboardData?.files || [])].find((y) => y.type.startsWith('image/'));
    if (f) { e.preventDefault(); showPic(f); return; }
    const t = e.clipboardData?.getData('text/plain') || '';
    if (/zotero:\/\//.test(t) && e.target !== note && e.target !== title) { e.preventDefault(); absorb(t); }
  };
  document.addEventListener('paste', onP);
  form.addEventListener('dragover', (e) => e.preventDefault());
  form.addEventListener('drop', (e) => { const f = [...(e.dataTransfer?.files || [])].find((y) => y.type.startsWith('image/')); if (f) { e.preventDefault(); showPic(f); } });
  modal({ title: isNew ? (x.kind === 'img' ? '存一张图' : '记一条文字') : `修改 ${x.id}`, wide: true, body: form, onClose: () => document.removeEventListener('paste', onP), buttons: [{ label: '取消' }, {
    label: '保存', primary: true, run: async () => {
      addCats();
      if (x.kind === 'img' && !pic && !x.file) { toast('先粘贴一张图（⌘V）。'); return false; }
      if (x.kind !== 'img' && !note.value.trim() && !title.value.trim()) { toast('写点内容。'); return false; }
      const src = { ...s, zotero: zbox.value.trim() && /^zotero:/.test(zbox.value.trim()) ? zbox.value.trim() : s.zotero || '', fig: fig.value.trim(), page: page.value.trim().replace(/\D/g, ''), task: tsel.value };
      const d = doi.value.trim(); const key = paperKey(d)?.doi || '';
      if (key && key.toLowerCase() !== String(src.ref?.doi || '').toLowerCase()) {
        const t = reading.find((y) => y.id === src.task);
        src.ref = (t?.ref && String(t.ref.doi).toLowerCase() === key.toLowerCase() ? t.ref : await lookupPaper(key).catch(() => null)) || src.ref;
        src.doi = key;
      } else if (!d) { delete src.doi; if (src.ref && !src.task) delete src.ref; }
      if (!src.ref && src.task) { const t = reading.find((y) => y.id === src.task); if (t?.ref) src.ref = t.ref; }
      for (const k of Object.keys(src)) if (src[k] === '' || src[k] == null) delete src[k];
      if (isNew) { x.id = nextId(); x.created = nowISO(); }
      Object.assign(x, { title: title.value.trim(), cats: [...picked], note: note.value.trim(), src });
      if (pic) {
        let st = await folderState();
        if (st.state !== 'ok') { const dir = await connectFolder(); if (!dir) { toast('图片需要存进图片文件夹，先选一个文件夹。'); return false; } st = { dir }; }
        const ext = (pic.type.split('/')[1] || 'png').replace('jpeg', 'jpg').replace('svg+xml', 'svg');
        const who = src.ref ? `${String(src.ref.authors || '').split(/[ ,]/)[0]}${src.ref.year || ''}` : (src.cite || '').replace(/ et al\./, '');
        const name = [x.id, safe(x.cats[0]), safe(who), safe(src.fig)].filter(Boolean).join('_') + `.${ext}`;
        try { await writeImage(st.dir, name, pic); } catch (e) { toast(`图片没写进文件夹：${e.message}`); return false; }
        if (x.file && x.file !== name) await st.dir.removeEntry(x.file).catch(() => {});
        x.file = name; urlCache.delete(name);
        try { const bmp = await createImageBitmap(pic); x.w = bmp.width; x.h = bmp.height; } catch { /* size is optional */ }
      }
      try {
        await saveClip(x, `${isNew ? 'Add' : 'Update'} clip ${x.id}`);
        if (src.ref || src.zotero || src.cite) try { localStorage.setItem(LAST_SRC, JSON.stringify({ at: Date.now(), src })); } catch { /* private window */ }
        toast(`${x.id} 已存好${x.kind === 'img' ? '（图片在图片文件夹里）' : ''}。`);
        route({ quiet: true });
      } catch (e) { toast(saveError(e)); return false; }
    },
  }] });
  setTimeout(() => title.focus(), 60);
}

// For the reading list: how many clips each entry has.
export async function clipCounts() {
  const m = new Map();
  for (const c of await loadClips().catch(() => [])) if (c.src?.task) m.set(c.src.task, (m.get(c.src.task) || 0) + 1);
  return m;
}
