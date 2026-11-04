// Shared state and building blocks: settings, the open notebook, sync status, dialogs, menus, toasts.
import { daysFrom } from './lab.js';
import { ConflictError, GitHubBackend, Library, MemoryBackend, NetworkError, kv } from './store.js';
import { fmtTime } from './model.js';
import { h, icon } from './util.js';
import { refreshDueBar } from './planner.js';
import { boot, route } from './app.js';

// ---------- settings (per device) ----------
export const SKEY = 'labnote.settings';
export const DEFAULTS = {
  owner: '', repo: '', branch: 'main', token: '',
  apiBase: 'https://api.github.com', theme: 'auto', downscale: true, font: 'sans', size: 'normal', ptable: 'booktabs', deadlineOffset: 13,
};
export function loadSettings() {
  try {
    const s = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SKEY) || '{}') };
    if (!s.fontV) { if (s.font === 'song') s.font = 'sans'; s.fontV = 2; } // sans-serif became the default
    return s;
  } catch { return { ...DEFAULTS }; }
}
export function saveSettings() { try { localStorage.setItem(SKEY, JSON.stringify(S)); } catch { /* ignore */ } }
export const S = loadSettings();
export const PTABLE_STYLES = [['booktabs', '三线表（论文风格，默认）'], ['zebra', '隔行浅底（宽表易对行）'], ['grid', '细网格（每格有框线）']];
export const DEMO = new URLSearchParams(location.search).has('demo');

export let lib = null;
export const app = document.getElementById('app');
export let view = { kind: null, token: 0, urls: [] };

// ---------- boot ----------
export function applyTheme() {
  const t = S.theme;
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
  document.documentElement.dataset.font = S.font;
  document.documentElement.dataset.size = S.size;
  document.documentElement.dataset.ptable = S.ptable || 'booktabs';
  // Web fonts are split by character range, so only the glyphs on screen download.
  for (const href of FONT_CSS[S.font] || []) {
    if (!document.querySelector(`link[href="${href}"]`)) document.head.append(h('link', { rel: 'stylesheet', href }));
  }
}
// Signature lettering, kept in notebook.json (sigFont, sigText) so every device signs the same way.
export const FS = (pkg, v = '5.2.8') => `https://cdn.jsdelivr.net/npm/@fontsource/${pkg}@${v}/400.css`;
export const SIG_FONTS = [
  ['homemade-apple', 'Homemade Apple', '随手英文', FS('homemade-apple')],
  ['mrs-saint-delafield', 'Mrs Saint Delafield', '签字笔连写', FS('mrs-saint-delafield', '5.2.7')],
  ['great-vibes', 'Great Vibes', '花体连笔', FS('great-vibes')],
  ['allura', 'Allura', '优雅连笔', FS('allura')],
  ['pinyon-script', 'Pinyon Script', '古典铜版体', FS('pinyon-script')],
  ['dancing-script', 'Dancing Script', '轻快手写', FS('dancing-script')],
  ['caveat', 'Caveat', '日常钢笔', FS('caveat')],
  ['long-cang', 'Long Cang', '行书手写（中文）', FS('long-cang')],
  ['zhi-mang-xing', 'Zhi Mang Xing', '行草毛笔（中文）', FS('zhi-mang-xing')],
  ['liu-jian-mao-cao', 'Liu Jian Mao Cao', '草书（中文）', FS('liu-jian-mao-cao')],
  ['ma-shan-zheng', 'Ma Shan Zheng', '毛笔楷书（中文）', FS('ma-shan-zheng', '5.3.0')],
  ['xiaolai', 'Xiaolai SC', '小赖手写（中文）', 'https://cdn.jsdelivr.net/npm/cn-fontsource-xiaolai-sc-regular@1.0.2/font.css'],
];
export const sigFontOf = (id) => SIG_FONTS.find((f) => f[0] === id) || SIG_FONTS[0];
export function useFontCss(href) { if (href && !document.querySelector(`link[href="${href}"]`)) document.head.append(h('link', { rel: 'stylesheet', href })); }
export function applySignature() {
  const f = sigFontOf(lib?.notebook?.sigFont);
  useFontCss(f[3]);
  document.documentElement.style.setProperty('--font-hand', `'${f[1]}', 'Bradley Hand', cursive`);
}
// What a signature shows: the chosen lettering for the notebook owner, the stored name for anyone else.
export function sigText(name) {
  const nb = lib?.notebook || {};
  return nb.sigText && (!name || name === nb.owner) ? nb.sigText : (name || nb.owner || '');
}
export const FONT_CSS = {
  noto: ['https://cdn.jsdelivr.net/npm/@fontsource/noto-sans-sc@5.2.6/400.css', 'https://cdn.jsdelivr.net/npm/@fontsource/noto-sans-sc@5.2.6/700.css'],
  xiaolai: ['https://cdn.jsdelivr.net/npm/cn-fontsource-xiaolai-sc-regular@1.0.2/font.css'],
  kai: ['https://cdn.jsdelivr.net/npm/lxgw-wenkai-screen-webfont@1.7.0/lxgwwenkaigbscreen.css'],
  marker: ['https://cdn.jsdelivr.net/npm/@fontsource/lxgw-marker-gothic@5.2.3/400.css'],
};
export const FONTS = [
  ['sans', '苹方 · 系统无衬线（推荐）'], ['noto', '思源黑体（无衬线，各设备一致）'],
  ['xiaolai', '小赖（圆润手写感，易读）'], ['kai', '文楷（手写楷体）'], ['marker', '漫黑（马克笔手写）'],
  ['song', '宋体（印刷衬线）'],
];

export async function startLibrary() {
  if (lib) lib.listeners.clear();
  if (DEMO) {
    await kv.del('demo:state'); await kv.del('demo:outbox');
    const { demoFiles } = await import('./demo.js');
    const { labDemoFiles } = await import('./demo-lab.js');
    lib = new Library(new MemoryBackend({ ...demoFiles(), ...labDemoFiles() }));
  } else {
    lib = new Library(new GitHubBackend(S));
  }
  lib.on(onLibraryEvent);
  await lib.open();
  applySignature();
}

// Web fonts load in the background: where Google Fonts is blocked the page
// still opens at once with the system's Chinese fonts.
export function loadFonts() {
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = 'https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@400;500;600&family=Homemade+Apple&family=IBM+Plex+Mono:wght@400;500&family=Literata:ital,opsz,wght@0,7..72,400..700;1,7..72,400..700&display=swap';
  document.head.append(l);
}

export let rerenderTimer = null;
export function onLibraryEvent(kind) {
  if (kind === 'status') { updateSync(); return; }
  if (kind === 'data') applySignature();
  // Don't redraw under someone typing a task.
  if (kind === 'data' && document.activeElement?.closest?.('.dash') && document.activeElement.value) { updateSync(); return; }
  if (kind === 'data' && ['home', 'volume', 'page', 'plan', 'think'].includes(view.kind) && !document.querySelector('.modal-root')) {
    clearTimeout(rerenderTimer);
    rerenderTimer = setTimeout(() => route({ quiet: true }), 120);
  }
  updateSync();
}

export async function show(kind, render, { quiet = false } = {}) {
  const token = ++view.token;
  const scroll = window.scrollY;
  const oldUrls = view.urls;
  const prevKind = view.kind;
  view = { kind, token, urls: [] };
  if (!quiet) closeModals();
  let el;
  try { el = await render(); } catch (e) { console.error(e); el = viewMissing(`显示出错：${e.message}`); }
  if (token !== view.token) return;
  if (el) {
    const tb = el.querySelector?.(':scope > .topbar');
    if (tb && lib && !['setup'].includes(kind)) tb.after(h('div', { id: 'due-bar', class: 'due-bar', hidden: true, role: 'status' }));
    const tk = tb && tokenBar();
    if (tk) tb.after(tk);
    app.replaceChildren(el);
    refreshDueBar();
  }
  setTimeout(() => oldUrls.forEach((u) => URL.revokeObjectURL(u)), 1000);
  if (quiet) window.scrollTo(0, scroll);
  else if (prevKind !== kind || kind !== 'page') window.scrollTo(0, 0);
  updateSync();
}

// GitHub does not let web pages read a token's expiry date, so it is typed once in Settings;
// from 14 days before, every page says so.
export function tokenBar() {
  if (DEMO || !/^\d{4}-\d{2}-\d{2}$/.test(S.tokenExpires || '')) return null;
  const d = daysFrom(S.tokenExpires);
  if (d > 14) return null;
  return h('a', { class: `token-bar${d < 0 ? ' expired' : ''}`, href: '#/settings' },
    d < 0 ? `GitHub 令牌已于 ${S.tokenExpires} 过期，笔记本无法同步。点此在设置里换新令牌 ›`
      : `GitHub 令牌${d === 0 ? '今天' : ` ${d} 天后`}到期（${S.tokenExpires}）。到期前在 GitHub 生成新令牌，再到设置里替换 ›`);
}
// A new version was installed in the background: offer to reload this tab so it runs it too.
export function offerUpdate() {
  if (document.getElementById('update-bar')) return;
  document.body.append(h('div', { id: 'update-bar', class: 'update-bar', role: 'status' },
    h('span', null, '笔记本有新版本', view.kind === 'editor' ? '（正在写的内容已自动存为草稿）' : ''),
    h('button', { class: 'btn small primary', type: 'button', onclick: () => location.reload() }, '立即更新'),
    h('button', { class: 'btn small ghost', type: 'button', onclick: (e) => e.currentTarget.parentElement.remove() }, '稍后')));
}

// ---------- chrome ----------
export function topbar({ back, backLabel = '返回', title, sub, actions = [] }) {
  return h('header', { class: 'topbar' },
    h('div', { class: 'tb-left' },
      back ? h('a', { class: 'btn icon ghost', href: back, 'aria-label': backLabel, title: backLabel }, icon('back')) : null,
      h('div', { class: 'tb-title' },
        h('span', { class: 'tb-main' }, title),
        sub ? h('span', { class: 'tb-sub' }, sub) : null)),
    h('div', { class: 'tb-right' }, syncChip(), ...actions));
}

export function demoBanner() {
  if (!DEMO) return null;
  return h('div', { class: 'banner' }, '这是示例笔记本，这里的修改不会保存。',
    h('a', { href: location.pathname }, '去我的笔记本'));
}

export function syncChip() {
  return h('button', { class: 'sync-chip', type: 'button', onclick: openSyncTray, 'aria-live': 'polite' }, h('span', { class: 'dot' }), h('span', { class: 'sync-text' }));
}
export const SYNC_TEXT = {
  idle: '打开中', syncing: '同步中', synced: '已同步', offline: '离线', error: '同步出错', empty: '仓库为空',
};
export function updateSync() {
  if (!lib) return;
  const s = lib.status;
  for (const chip of document.querySelectorAll('.sync-chip')) {
    chip.dataset.state = s.state;
    let text = SYNC_TEXT[s.state] || s.state;
    if (s.state === 'pending') text = `${s.count} 项待同步`;
    if (s.state === 'attention') text = '需要处理';
    if (s.state === 'offline' && lib.outbox.length) text = `离线，${lib.outbox.length} 项待同步`;
    chip.querySelector('.sync-text').textContent = text;
    chip.title = s.state === 'error' ? s.message || '' : '';
  }
}

export function openSyncTray() {
  const s = lib.status;
  const body = h('div', { class: 'tray' });
  const lines = {
    synced: `全部已保存到 GitHub。上次检查 ${fmtTime(new Date(s.at).toISOString())}。`,
    syncing: '正在检查 GitHub 上的更新。',
    offline: '现在连不上 GitHub。保存的页面先存在本机，联网后自动同步。',
    error: s.code === 401
      ? 'GitHub 拒绝了本设备的令牌，可能已过期或被撤销。请在设置里换一个新令牌。'
      : `上次同步失败：${s.message || '未知错误'}。`,
    empty: '笔记仓库里还没有文件。',
    pending: '有些页面只存在本机，还没同步到 GitHub。',
    attention: '有些页面没能同步，请逐个选择处理方式。',
  };
  body.append(h('p', null, lines[s.state] || ''));
  if (DEMO) body.append(h('p', { class: 'muted' }, '示例笔记本只存在于这个浏览器标签页。'));
  for (const o of lib.outbox) {
    const title = o.fm?.title || '未命名';
    const where = `${lib.volume(o.vol)?.title || o.vol}, p. ${o.num}`;
    const row = h('div', { class: 'tray-item' },
      h('div', null, h('strong', null, title), h('div', { class: 'muted' }, where)));
    if (o.status === 'conflict' || o.status === 'error') {
      row.append(h('p', { class: 'warn' }, o.status === 'conflict' ? '这一页在另一台设备上也改过。' : `Couldn’t sync: ${o.error}`),
        h('div', { class: 'row-actions' },
          o.status === 'conflict' ? h('button', { class: 'btn', onclick: () => resolveItem(o.id, 'overwrite') }, '保留这个版本') : h('button', { class: 'btn', onclick: () => resolveItem(o.id, 'retry') }, '重试'),
          h('button', { class: 'btn', onclick: () => resolveItem(o.id, 'new') }, '另存为新页'),
          h('button', { class: 'btn danger', onclick: () => resolveItem(o.id, 'discard') }, '丢弃')));
    } else row.append(h('span', { class: 'muted' }, '等待同步'));
    body.append(row);
  }
  modal({
    title: '同步', body,
    buttons: [
      { label: '关闭' },
      { label: '立即同步', primary: true, run: async () => { await lib.refresh(); await lib.flush(); toast(lib.status.state === 'synced' ? '已是最新。' : '同步完成，但有问题。'); } },
    ],
  });
}
export async function resolveItem(id, how) {
  closeModals();
  await lib.resolve(id, how);
  toast(lib.status.state === 'synced' ? '已同步。' : '完成。');
}

export let toastTimer;
export function toast(msg, action) {
  const el = document.getElementById('toast');
  el.replaceChildren(h('span', null, msg));
  if (action) el.append(h('button', { class: 'btn small', onclick: () => { el.classList.remove('show'); action.run(); } }, action.label));
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), action ? 8000 : 4000);
}

export function closeModals() { document.querySelectorAll('.modal-root').forEach((m) => m.close?.()); }

// buttons: [{label, primary, danger, run(): may return false to keep open}]
export function modal({ title, body, buttons = [{ label: '关闭' }], wide = false, onClose }) {
  const prevFocus = document.activeElement;
  const root = h('div', { class: 'modal-root' });
  const panel = h('div', { class: `modal${wide ? ' wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title });
  const close = () => {
    root.remove();
    document.removeEventListener('keydown', onKey, true);
    onClose?.();
    prevFocus?.focus?.();
  };
  root.close = close;
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  document.addEventListener('keydown', onKey, true);
  root.addEventListener('mousedown', (e) => { if (e.target === root) close(); });
  const foot = h('div', { class: 'modal-foot' }, buttons.filter(Boolean).map((b) => h('button', {
    class: `btn${b.primary ? ' primary' : ''}${b.danger ? ' danger' : ''}`, type: 'button',
    onclick: async (ev) => {
      if (!b.run) return close();
      const btn = ev.currentTarget;
      btn.disabled = true;
      try { const keep = await b.run(); if (keep !== false) close(); } catch (e) { toast(e.message); } finally { btn.disabled = false; }
    },
  }, b.label)));
  panel.append(h('div', { class: 'modal-head' }, h('h2', null, title), h('button', { class: 'btn icon ghost', 'aria-label': '关闭', onclick: close }, icon('close'))), h('div', { class: 'modal-body' }, body), ...(buttons.length ? [foot] : []));
  root.append(panel);
  document.body.append(root);
  setTimeout(() => (panel.querySelector('[autofocus]') || panel.querySelector('input,textarea,select') || panel.querySelector('.modal-foot .btn.primary') || panel).focus?.(), 30);
  return root;
}

export function menu(anchor, items) {
  document.querySelectorAll('.menu').forEach((m) => m.remove());
  const m = h('div', { class: 'menu', role: 'menu' }, items.filter(Boolean).map((it) => h('button', {
    class: `menu-item${it.cls ? ` ${it.cls}` : ''}`, role: 'menuitem', type: 'button',
    onclick: () => { m.remove(); it.run(); },
  }, icon(it.icon, 18), it.label)));
  document.body.append(m);
  const r = anchor.getBoundingClientRect();
  m.style.top = `${r.bottom + window.scrollY + 6}px`;
  m.style.right = `${Math.max(8, document.documentElement.clientWidth - r.right)}px`;
  const off = (e) => { if (!m.contains(e.target)) { m.remove(); document.removeEventListener('mousedown', off, true); } };
  setTimeout(() => document.addEventListener('mousedown', off, true), 0);
  m.querySelector('button')?.focus();
  m.addEventListener('keydown', (e) => { if (e.key === 'Escape') { m.remove(); anchor.focus(); } });
}

export function field(label, value, cls = '') {
  return h('div', { class: `field ${cls}` }, h('span', { class: 'lbl' }, label), h('span', { class: 'val' }, value ?? ''));
}
export function signerName() { return lib?.notebook?.owner || '已签名'; }

export function viewMissing(msg, action) {
  return h('div', { class: 'view missing' },
    topbar({ back: '#/', backLabel: '所有卷', title: '找不到' }),
    h('article', { class: 'sheet plain narrow' }, h('p', null, msg), action || h('a', { class: 'btn', href: '#/' }, '回到首页')));
}

// ---------- editor ----------
export async function prepareFile(file) {
  if (S.downscale && /^image\/(jpeg|webp|heic|heif)$/.test(file.type) && file.size > 1.5e6) {
    try {
      const bmp = await createImageBitmap(file);
      const scale = Math.min(1, 2400 / Math.max(bmp.width, bmp.height));
      const c = document.createElement('canvas');
      c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85));
      if (blob && blob.size < file.size) return new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' });
    } catch { /* keep original */ }
  }
  return file;
}

export function choose(title, text, options) {
  return new Promise((resolve) => {
    let picked = null;
    modal({
      title, body: h('p', null, text),
      buttons: options.map(([value, label], i) => ({ label, primary: i === 0, run: () => { picked = value; } })),
      onClose: () => resolve(picked),
    });
  });
}

// ---------- experiments: IDs, sample tables, libraries, reminders ----------
export const thead = (cols) => h('thead', null, h('tr', null, cols.map((c) => h('th', { scope: 'col' }, c))));

export function downloadText(name, text, type = 'text/plain') {
  const url = URL.createObjectURL(text instanceof Blob ? text : new Blob([text], { type }));
  const a = h('a', { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast(`已复制：${text}`); } catch { toast(text); }
}
export const saveError = (e) => (e instanceof ConflictError ? '这一页刚在别的设备上改过。刷新页面后再试。' : e instanceof NetworkError ? '离线：已存在本机，联网后自动同步。' : `没有保存：${e.message}`);

// ----- delete / void -----
export function confirmTyped(title, text, word, label) {
  return new Promise((resolve) => {
    const input = h('input', { id: 'cf-word', autocomplete: 'off', placeholder: word });
    let ok = false;
    modal({
      title,
      body: h('div', { class: 'form' }, h('p', null, text), h('label', { for: 'cf-word' }, `请输入“${word}”确认`), input),
      buttons: [{ label: '取消' }, { label, danger: true, run: () => { if (input.value.trim() !== word) { toast('输入的内容不一致。'); return false; } ok = true; } }],
      onClose: () => resolve(ok),
    });
  });
}
