// Lab notebook: views and routing.
import {
  GitHubBackend, MemoryBackend, Library, kv, NetworkError, ConflictError, ApiError, mimeOf,
} from './store.js';
import {
  parseFrontMatter, pagePath, todayISO, nowISO, fmtDate, fmtTime, cleanTag, safeFileName, parseRef, pad,
} from './model.js';
import { renderInto, fitChartsForPrint, loadLib, hypBadge } from './render.js';
import {
  expId, cleanTopic, nextSeq, sampleNo, sampleId, parseNumbers, readSamples, writeSamples, samplesTemplate, isResultCol, colLabel,
  parseFollowup, formatFollowup, addDays, daysFrom, icsFor, toCSV, REAGENTS_PATH, REAGENT_FIELDS, parseReagents, reagentsCSV,
  nextReagentId, loadReagents, reagentFields, LOCKED_REAGENT_KEYS, loadProtocol, loadProtocols, parseProtocol, protocolPath, cleanProtocolId, reagentAlerts,
  STEP_FIELDS, STEP_OPS, STEP_CONTAINERS, readSteps, writeSteps, stepsText, headings, replaceSection, quoteBlock, sectionOf,
  SOLUTIONS_PATH, SOLUTION_FIELDS, SOLUTION_STATUS, solutionFields, LOCKED_SOLUTION_KEYS, nextSolutionId, parseRecipe, recipeText, loadSolutions, solutionAlerts,
  HYP_STATUS, HYP_CONF, EV_KIND, hypPath, hypIds, loadHypothesis, loadHypotheses, nextHypId, evidenceCounts, nextEvidenceId,
  TOPICS_PATH, TOPIC_STATUS, TOPIC_PRIORITY, TOPIC_EVERY, loadTopics, activeTopic, topicAlerts,
  parseTSV, RESULT_HINT, looksLikeHeader, mdTable, MATERIAL_FROM, readMaterials, writeMaterials, renameMaterialsHeading,
} from './lab.js';
import { search } from './search.js';
import { h, icon, debounce, fmtBytes, loadScript } from './util.js';

// ---------- settings (per device) ----------
const SKEY = 'labnote.settings';
const DEFAULTS = {
  owner: '', repo: '', branch: 'main', token: '',
  apiBase: 'https://api.github.com', theme: 'auto', downscale: true, font: 'sans', size: 'normal', ptable: 'booktabs',
};
function loadSettings() {
  try {
    const s = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SKEY) || '{}') };
    if (!s.fontV) { if (s.font === 'song') s.font = 'sans'; s.fontV = 2; } // sans-serif became the default
    return s;
  } catch { return { ...DEFAULTS }; }
}
function saveSettings() { try { localStorage.setItem(SKEY, JSON.stringify(S)); } catch { /* ignore */ } }
const S = loadSettings();
const PTABLE_STYLES = [['booktabs', '三线表（论文风格，默认）'], ['zebra', '隔行浅底（宽表易对行）'], ['grid', '细网格（每格有框线）']];
const DEMO = new URLSearchParams(location.search).has('demo');

const CLOTHS = [
  ['墨绿', '#24453a'], ['酒红', '#5b2228'], ['藏青', '#22335a'],
  ['石板灰', '#3c4247'], ['赭黄', '#7d5a1e'], ['梅紫', '#4a2c4a'],
];

let lib = null;
const app = document.getElementById('app');
let view = { kind: null, token: 0, urls: [] };

// ---------- boot ----------
function applyTheme() {
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
const FS = (pkg, v = '5.2.8') => `https://cdn.jsdelivr.net/npm/@fontsource/${pkg}@${v}/400.css`;
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
const sigFontOf = (id) => SIG_FONTS.find((f) => f[0] === id) || SIG_FONTS[0];
function useFontCss(href) { if (href && !document.querySelector(`link[href="${href}"]`)) document.head.append(h('link', { rel: 'stylesheet', href })); }
function applySignature() {
  const f = sigFontOf(lib?.notebook?.sigFont);
  useFontCss(f[3]);
  document.documentElement.style.setProperty('--font-hand', `'${f[1]}', 'Bradley Hand', cursive`);
}
// What a signature shows: the chosen lettering for the notebook owner, the stored name for anyone else.
function sigText(name) {
  const nb = lib?.notebook || {};
  return nb.sigText && (!name || name === nb.owner) ? nb.sigText : (name || nb.owner || '');
}
const FONT_CSS = {
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

async function startLibrary() {
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
function loadFonts() {
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = 'https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@400;500;600&family=Homemade+Apple&family=IBM+Plex+Mono:wght@400;500&family=Literata:ital,opsz,wght@0,7..72,400..700;1,7..72,400..700&display=swap';
  document.head.append(l);
}

async function boot() {
  applyTheme();
  loadFonts();
  if ('serviceWorker' in navigator && !DEMO && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  window.addEventListener('hashchange', route);
  window.addEventListener('online', () => lib?.refresh().then(() => lib.flush()));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && lib && Date.now() - (lib.status.at || 0) > 30000) lib.refresh().then(() => lib.flush());
  });
  window.addEventListener('labnote:toast', (e) => toast(e.detail));
  document.addEventListener('keydown', globalKeys);
  window.addEventListener('beforeprint', () => fitChartsForPrint(document, 680));
  window.addEventListener('afterprint', () => {
    fitChartsForPrint(document, null);
    document.body.classList.remove('print-volume');
    document.getElementById('print-root').replaceChildren();
  });
  if (!DEMO && !S.token) { route(); return; }
  try { await startLibrary(); } catch (e) { console.error(e); }
  route();
  // Fetch the chart library in the background so charts also draw offline.
  setTimeout(() => { loadLib('plotly').catch(() => {}); loadLib('papa').catch(() => {}); }, 4000);
}

let rerenderTimer = null;
function onLibraryEvent(kind) {
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

function globalKeys(e) {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
  if ((e.key === '/' && !typing) || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k')) {
    if (!lib || document.querySelector('.modal-root')) return;
    e.preventDefault(); openSearch();
  }
  if (view.kind === 'page' && !typing && !document.querySelector('.modal-root')) {
    if (e.key === 'ArrowLeft') document.querySelector('[data-nav="prev"]')?.click();
    if (e.key === 'ArrowRight') document.querySelector('[data-nav="next"]')?.click();
  }
}

// ---------- routing ----------
function parseHash() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, qs] = raw.split('?');
  return { parts: path.split('/').filter(Boolean).map(decodeURIComponent), params: new URLSearchParams(qs || '') };
}

async function route(opts = {}) {
  const { parts, params } = parseHash();
  if (!DEMO && !S.token && parts[0] !== 'settings') return show('setup', viewSetup);
  if (!lib) return show('setup', viewSetup);
  const [a, b, c, d] = parts;
  if (!a) return show('home', viewHome, opts);
  if (a === 'settings') return show('settings', viewSettings);
  if (a === 'lib' && b === 'reagents') return show('library', viewReagents);
  if (a === 'lib' && b === 'solutions') return show('library', viewSolutions);
  if (a === 'lib' && b === 'protocols' && !c) return show('library', viewProtocols);
  if (a === 'lib' && b === 'protocols' && c) return show('library', () => viewProtocol(c));
  if (a === 'series' && b) return show('library', () => viewSeries(b));
  if (a === 'plan') return show('plan', () => viewPlan(b));
  if (a === 'think' && !b) return show('think', viewThinking);
  if (a === 'think' && b === 'topics') return show('think', viewTopics);
  if (a === 'think' && b) return show('think', () => viewHypothesis(b));
  if (a === 'new-exp') { await show('home', viewHome, opts); openNewExperiment(params.get('vol') || ''); return; }
  if (a === 'search') { await show('home', viewHome, opts); openSearch(params.get('q') || ''); return; }
  if (a === 'v' && b && !c) return show('volume', () => viewVolume(b), opts);
  if (a === 'v' && b && c === 'new') return show('editor', () => viewEditor(b, null, params));
  if (a === 'v' && b && /^\d+$/.test(c) && d === 'edit') return show('editor', () => viewEditor(b, parseInt(c, 10), params));
  if (a === 'v' && b && /^\d+$/.test(c)) return show('page', () => viewPage(b, parseInt(c, 10), params), opts);
  return show('missing', () => viewMissing('这个地址在笔记本里找不到。'));
}

async function show(kind, render, { quiet = false } = {}) {
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
    app.replaceChildren(el);
    refreshDueBar();
  }
  setTimeout(() => oldUrls.forEach((u) => URL.revokeObjectURL(u)), 1000);
  if (quiet) window.scrollTo(0, scroll);
  else if (prevKind !== kind || kind !== 'page') window.scrollTo(0, 0);
  updateSync();
}

// ---------- chrome ----------
function topbar({ back, backLabel = '返回', title, sub, actions = [] }) {
  return h('header', { class: 'topbar' },
    h('div', { class: 'tb-left' },
      back ? h('a', { class: 'btn icon ghost', href: back, 'aria-label': backLabel, title: backLabel }, icon('back')) : null,
      h('div', { class: 'tb-title' },
        h('span', { class: 'tb-main' }, title),
        sub ? h('span', { class: 'tb-sub' }, sub) : null)),
    h('div', { class: 'tb-right' }, syncChip(), ...actions));
}

function demoBanner() {
  if (!DEMO) return null;
  return h('div', { class: 'banner' }, '这是示例笔记本，这里的修改不会保存。',
    h('a', { href: location.pathname }, '去我的笔记本'));
}

function syncChip() {
  return h('button', { class: 'sync-chip', type: 'button', onclick: openSyncTray, 'aria-live': 'polite' }, h('span', { class: 'dot' }), h('span', { class: 'sync-text' }));
}
const SYNC_TEXT = {
  idle: '打开中', syncing: '同步中', synced: '已同步', offline: '离线', error: '同步出错', empty: '仓库为空',
};
function updateSync() {
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

function openSyncTray() {
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
async function resolveItem(id, how) {
  closeModals();
  await lib.resolve(id, how);
  toast(lib.status.state === 'synced' ? '已同步。' : '完成。');
}

let toastTimer;
function toast(msg, action) {
  const el = document.getElementById('toast');
  el.replaceChildren(h('span', null, msg));
  if (action) el.append(h('button', { class: 'btn small', onclick: () => { el.classList.remove('show'); action.run(); } }, action.label));
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), action ? 8000 : 4000);
}

function closeModals() { document.querySelectorAll('.modal-root').forEach((m) => m.close?.()); }

// buttons: [{label, primary, danger, run(): may return false to keep open}]
function modal({ title, body, buttons = [{ label: '关闭' }], wide = false, onClose }) {
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

function menu(anchor, items) {
  document.querySelectorAll('.menu').forEach((m) => m.remove());
  const m = h('div', { class: 'menu', role: 'menu' }, items.filter(Boolean).map((it) => h('button', {
    class: 'menu-item', role: 'menuitem', type: 'button',
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

function field(label, value, cls = '') {
  return h('div', { class: `field ${cls}` }, h('span', { class: 'lbl' }, label), h('span', { class: 'val' }, value ?? ''));
}
function signerName() { return lib?.notebook?.owner || '已签名'; }

// ---------- setup ----------
function tokenUrl(owner = S.owner) {
  const p = new URLSearchParams({
    name: 'Lab notebook (this device)',
    description: 'Lets the lab notebook app on one device read and write the notebook repository.',
    expires_in: '366',
    contents: 'write',
  });
  if (owner) p.set('target_name', owner);
  return `https://github.com/settings/personal-access-tokens/new?${p}`;
}

// On <name>.github.io the GitHub account is known, so suggest it.
function guessOwner() {
  const m = location.hostname.match(/^([a-z0-9-]+)\.github\.io$/i);
  return m ? m[1] : '';
}

// Entries belong in a private repository; ask before using a public one.
async function confirmPrivate(acc, fullName) {
  if (acc.private) return true;
  const c = await choose('这个仓库是公开的', `Anyone on the internet can read what is stored in ${fullName}. Make it private on GitHub (Settings, then Danger Zone, then Change visibility) before writing in it.`, [['cancel', '返回'], ['ok', '仍然使用']]);
  return c === 'ok';
}

function viewSetup() {
  const start = S.owner && S.repo ? `${S.owner}/${S.repo}` : guessOwner() ? `${guessOwner()}/` : '';
  const repoIn = h('input', { value: start, placeholder: 'your-github-name/lab-notebook-entries', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', id: 'f-repo' });
  const tokenLink = h('a', { href: tokenUrl(guessOwner()), target: '_blank', rel: 'noopener' }, '在 GitHub 上创建令牌');
  const repoName = h('code', null, start.split('/')[1] || '你的记录仓库');
  repoIn.addEventListener('input', () => {
    const [o, r] = repoIn.value.trim().split('/');
    tokenLink.href = tokenUrl(o);
    repoName.textContent = r || '你的记录仓库';
  });
  const branchIn = h('input', { value: S.branch, autocomplete: 'off', spellcheck: 'false', id: 'f-branch' });
  const tokenIn = h('input', { type: 'password', autocomplete: 'off', spellcheck: 'false', id: 'f-token', placeholder: 'github_pat_…' });
  const err = h('p', { class: 'form-error', role: 'alert' });
  const go = h('button', { class: 'btn primary', type: 'submit' }, '连接笔记本');
  const form = h('form', {
    class: 'setup-form',
    onsubmit: async (e) => {
      e.preventDefault();
      err.textContent = '';
      const [owner, repo] = repoIn.value.trim().split('/');
      const token = tokenIn.value.trim();
      if (!owner || !repo) { err.textContent = '仓库请写成 用户名/仓库名。'; return; }
      if (!token) { err.textContent = '粘贴你在 GitHub 上创建的令牌。'; return; }
      go.disabled = true; go.textContent = '检查中…';
      try {
        const be = new GitHubBackend({ owner, repo, branch: branchIn.value.trim() || 'main', token, apiBase: S.apiBase });
        const acc = await be.checkAccess();
        if (!acc.canWrite) throw new Error('这个令牌只能读不能写。请在 GitHub 上把 Contents 设为 “Read and write”。');
        if (!(await confirmPrivate(acc, `${owner}/${repo}`))) return;
        Object.assign(S, { owner, repo, branch: branchIn.value.trim() || 'main', token });
        saveSettings();
        await startLibrary();
        location.hash = '#/';
        route();
      } catch (e2) {
        err.textContent = e2 instanceof ApiError && e2.status === 401 ? 'GitHub 拒绝了这个令牌。请检查是否复制完整、是否过期。'
          : e2 instanceof ApiError && e2.status === 404 ? `This token can’t see ${owner}/${repo}. When creating it, choose “Only select repositories” and pick that repository.`
            : e2 instanceof NetworkError ? '连不上 GitHub，请检查网络后重试。' : e2.message;
      } finally { go.disabled = false; go.textContent = '连接笔记本'; }
    },
  },
  h('label', { for: 'f-repo' }, '存放记录的私有仓库'), repoIn,
  h('label', { for: 'f-branch' }, '分支'), branchIn,
  h('label', { for: 'f-token' }, 'GitHub 令牌'), tokenIn,
  err, go);

  return h('div', { class: 'view setup' },
    h('header', { class: 'topbar' }, h('div', { class: 'tb-left' }, h('div', { class: 'tb-title' }, h('span', { class: 'tb-main' }, '实验记录本')))),
    h('article', { class: 'sheet plain narrow' },
      h('h1', null, '连接这台设备'),
      h('p', null, '记录保存在你的 GitHub 私有仓库里。每台手机、平板或电脑都需要一个只能读写这个仓库的令牌，令牌只存在这台设备上。'),
      h('ol', { class: 'steps' },
        h('li', null, '新建一个空的 ', h('strong', null, 'private'), ' 仓库（如果还没有）。'),
        h('li', null, tokenLink, '。在 Repository access 里选 ', h('em', null, 'Only select repositories'), '，再选 ', repoName, '。Contents 已自动设为 Read and write。'),
        h('li', null, '复制令牌，粘贴到下面，然后连接。')),
      form,
      h('p', { class: 'muted' }, '想先看看效果？', h('a', { href: '?demo#/v/sample/1' }, '打开示例笔记本'), '.')));
}

// ---------- home ----------
function viewHome() {
  const vols = lib.volumes();
  const actions = [
    h('button', { class: 'btn primary', type: 'button', onclick: () => openNewExperiment('') }, icon('plus', 18), h('span', null, '新建实验')),
    h('a', { class: 'btn ghost', href: '#/lib/reagents' }, '试剂库'),
    h('a', { class: 'btn ghost', href: '#/lib/solutions' }, '溶液库'),
    h('a', { class: 'btn ghost', href: '#/lib/protocols' }, '步骤库'),
    h('button', { class: 'btn ghost', type: 'button', onclick: () => openExport('') }, '导出'),
    h('button', { class: 'btn icon ghost', 'aria-label': '搜索', title: '搜索（/）', onclick: () => openSearch() }, icon('search')),
    h('a', { class: 'btn icon ghost', href: '#/settings', 'aria-label': '设置', title: '设置' }, icon('gear')),
  ];
  const root = h('div', { class: 'view home' }, topbar({ title: lib.notebook.title || '实验记录本', sub: lib.notebook.owner || null, actions }), demoBanner());

  if (lib.empty) {
    root.append(h('article', { class: 'sheet plain narrow' },
      h('h1', null, '开始使用'),
      h('p', null, `The repository ${S.owner}/${S.repo} has no files yet. Starting it adds a small settings file; your volumes and pages are added as you write.`),
      h('div', { class: 'form' },
        h('label', { for: 'st-name' }, '签名用的名字'),
        h('input', { id: 'st-name', placeholder: 'e.g. A. Researcher', autocomplete: 'name' }),
        h('button', { class: 'btn primary', onclick: async (e) => {
          const btn = e.currentTarget; btn.disabled = true;
          try { await lib.initialize(document.getElementById('st-name').value.trim()); route(); } catch (err) { toast(err.message); btn.disabled = false; }
        } }, '开始'))));
    return root;
  }
  if (!lib.head && lib.status.state !== 'synced') {
    root.append(h('p', { class: 'loading' }, lib.status.state === 'offline' ? '连不上 GitHub，本机也还没有缓存。' : '正在打开笔记本…'));
    if (lib.status.state === 'error') root.append(h('p', { class: 'loading' }, lib.status.message || ''));
    return root;
  }

  root.append(hero(), dashboard(), topicsStrip());
  root.append(h('h2', { class: 'section-title' }, '记录本', h('span', null, `${vols.length} 卷 · ${lib.allPages().length} 页`)));
  const shelf = h('section', { class: 'shelf', 'aria-label': '卷' });
  for (const v of vols) shelf.append(cover(v));
  shelf.append(thinkCover());
  shelf.append(h('button', { class: 'cover new-cover', type: 'button', onclick: openNewVolume },
    icon('plus', 28), h('span', null, vols.length ? '新建卷（项目）' : '建第一个卷（项目）')));
  root.append(shelf);
  if (!vols.length) root.append(h('p', { class: 'hint' }, '每个项目一个卷，页码在卷内连续编号，就像装订的记录本。'));

  const recent = lib.allPages().sort((a, b) => String(b.date).localeCompare(String(a.date)) || b.num - a.num).slice(0, 8);
  if (recent.length) {
    root.append(h('h2', { class: 'section-title' }, '最近的记录'), h('section', { class: 'tile recent' },
      h('ol', { class: 'ledger-rows' }, recent.map((p) => h('li', null, h('a', { href: `#/v/${p.vol}/${p.num}` },
        h('span', { class: 'l-date' }, fmtDate(p.date)),
        h('span', { class: 'l-title' }, p.xid ? h('span', { class: 'xid-tag' }, p.xid) : null, p.title, p.series ? h('span', { class: 'series-tag small' }, p.series) : null, p.pending ? h('span', { class: 'pending-tag' }, '待同步') : null),
        h('span', { class: 'l-where' }, `${lib.volume(p.vol)?.title || p.vol}, p. ${p.num}`)))))));
  }
  return root;
}

function cover(v) {
  const pages = lib.pages(v.id);
  const last = pages.reduce((m, p) => (String(p.date) > m ? String(p.date) : m), '');
  const href = `#/v/${v.id}`;
  return h('div', { class: 'book' },
    h('a', { class: 'cover', href, 'aria-label': v.title, style: { '--cloth': v.color || CLOTHS[0][1] } },
      h('span', { class: 'cover-label' },
        h('span', { class: 'cl-kind' }, 'LABORATORY NOTEBOOK'),
        h('span', { class: 'cl-no' }, `No.${String(v.number).padStart(2, '0')}`),
        h('span', { class: 'cl-rule' }),
        h('span', { class: 'cl-title' }, v.title)),
      h('span', { class: 'cover-band', 'aria-hidden': 'true' })),
    h('a', { class: 'book-cap', href },
      h('span', { class: 'bc-title' }, v.title),
      h('span', { class: 'bc-meta' }, `${pages.length} 页${last ? ` · 最近 ${fmtDate(last)}` : ''}`)));
}

function openNewVolume() {
  const title = h('input', { id: 'nv-title', placeholder: 'e.g. Thyroid cytology classifier', autofocus: true });
  const desc = h('input', { id: 'nv-desc', placeholder: '可不填' });
  const code = h('input', { id: 'nv-code', placeholder: '例如 OECT（实验编号中间那段）', autocapitalize: 'characters' });
  const used = new Set(lib.volumes().map((v) => v.color));
  const pick = CLOTHS.find(([, c]) => !used.has(c))?.[1] || CLOTHS[0][1];
  const swatches = clothPicker(pick);
  modal({
    title: '新建卷',
    body: h('div', { class: 'form' },
      h('label', { for: 'nv-title' }, '项目'), title,
      h('label', { for: 'nv-desc' }, '说明'), desc,
      h('label', { for: 'nv-code' }, '主题代码'), code,
      h('span', { class: 'label' }, '封面'), swatches.el),
    buttons: [{ label: '取消' }, {
      label: '创建', primary: true,
      run: async () => {
        if (!title.value.trim()) { title.focus(); toast('给这个卷起个项目名。'); return false; }
        try {
          const id = await lib.createVolume({ title: title.value.trim(), description: desc.value.trim(), color: swatches.value(), code: cleanTopic(code.value) });
          location.hash = `#/v/${id}`;
        } catch (e) {
          if (e instanceof NetworkError) throw new Error('离线中，联网后才能新建卷。');
          throw e;
        }
      },
    }],
  });
}

function clothPicker(current) {
  let value = current;
  const el = h('div', { class: 'swatches', role: 'radiogroup', 'aria-label': '封面颜色' });
  for (const [name, c] of CLOTHS) {
    const b = h('button', { type: 'button', class: 'swatch', role: 'radio', 'aria-checked': String(c === value), 'aria-label': name, title: name, style: { '--cloth': c } });
    b.onclick = () => { value = c; el.querySelectorAll('.swatch').forEach((s) => s.setAttribute('aria-checked', String(s === b))); };
    el.append(b);
  }
  return { el, value: () => value };
}

// ---------- volume contents ----------
function viewVolume(id) {
  const v = lib.volume(id);
  if (!v) return viewMissing('笔记本里没有这个卷，可能已改名或删除。');
  const pages = lib.pages(id);
  const more = h('button', { class: 'btn icon ghost', 'aria-label': '更多', onclick: (e) => menu(e.currentTarget, [
    { icon: 'edit', label: '卷信息', run: () => openVolumeDetails(v) },
    pages.length ? { icon: 'print', label: '打印整卷 / 存为 PDF', run: () => printVolume(id) } : null,
    { icon: 'search', label: '在本卷中搜索', run: () => openSearch('', id) },
    { icon: 'download', label: '导出（按日期，PDF / Word）', run: () => openExport(id) },
    pages.length ? { icon: 'list', label: '把已有的页归入系列…', run: () => openBulkSeries(id) } : null,
    pages.length ? { icon: 'trash', label: '批量永久删除页面…', run: () => openBulkDelete(id) } : null,
    { icon: 'trash', label: '删除这个卷…', run: () => openDeleteVolume(v) },
  ]) }, icon('more'));
  const root = h('div', { class: 'view volume' },
    topbar({ back: '#/', backLabel: '所有卷', title: v.title, sub: `第 ${v.number} 卷`, actions: [
      h('button', { class: 'btn primary', type: 'button', onclick: () => openNewExperiment(id) }, icon('plus', 18), h('span', null, '新建实验')),
      h('a', { class: 'btn', href: `#/v/${id}/new` }, icon('write', 18), h('span', { class: 'wide-only' }, '普通页')), more] }),
    demoBanner());
  const sheet = h('article', { class: 'sheet toc' },
    h('header', { class: 'sheet-head' },
      h('div', { class: 'form-row' }, field('项目', v.title, 'grow'), field('卷号', v.number)),
      h('div', { class: 'form-row' }, field('开始于', fmtDate(v.created), 'grow'), field('页数', pages.length))),
    v.description ? h('p', { class: 'vol-desc' }, v.description) : null,
    h('h1', { class: 'toc-title' }, '目录'));
  if (!pages.length) {
    sheet.append(h('div', { class: 'empty' }, h('p', null, '还没有页面。'), h('a', { class: 'btn', href: `#/v/${id}/new` }, icon('write', 18), '写第 1 页')));
  } else {
    sheet.append(h('table', { class: 'toc-table' },
      h('thead', null, h('tr', null, h('th', { scope: 'col', class: 'c-no' }, '页'), h('th', { scope: 'col', class: 'c-date' }, '日期'), h('th', { scope: 'col' }, '标题'), h('th', { scope: 'col', class: 'c-sig' }, '已签名'))),
      h('tbody', null, tocRows(pages).map((p) => (p.seriesRow ? h('tr', { class: 'series-row', onclick: () => { location.hash = `#/series/${encodeURIComponent(p.name)}`; } },
        h('td', { class: 'c-no' }, p.nums),
        h('td', { class: 'c-date' }, p.range),
        h('td', null, h('span', { class: 'series-tag' }, '系列'), h('a', { href: `#/series/${encodeURIComponent(p.name)}` }, p.name), h('span', { class: 'toc-tags' }, `${p.count} 次实验`)),
        h('td', { class: 'c-sig' })) : h('tr', { class: p.void ? 'voided' : null, onclick: (e) => { if (!e.target.closest('a')) location.hash = `#/v/${id}/${p.num}`; } },
        h('td', { class: 'c-no' }, p.num),
        h('td', { class: 'c-date' }, fmtDate(p.date)),
        h('td', null, p.xid ? h('span', { class: 'xid-tag' }, p.xid) : null, h('a', { href: `#/v/${id}/${p.num}` }, p.title), p.void ? h('span', { class: 'void-tag' }, '已作废') : null,
          p.pending ? h('span', { class: 'pending-tag' }, '待同步') : null,
          p.tags.length ? h('span', { class: 'toc-tags' }, p.tags.map((t) => `#${t}`).join(' ')) : null),
        h('td', { class: 'c-sig' }, p.signed ? h('span', { class: 'initials', title: `Signed ${fmtDate(p.signed)}` }, initials(p.signer || signerName())) : h('span', { class: 'sr' }, '未签名'))))))));
  }
  root.append(sheet);
  return root;
}
// Each line under "## 下一步" gets a button that turns it into a to-do (today, tomorrow, this week, or a date).
async function nextStepButtons(sheet, vol, num, fm) {
  const head = [...sheet.querySelectorAll('.sheet-body.prose > h2')].find((x) => x.textContent.trim() === '下一步');
  if (!head) return;
  const items = [];
  for (let el = head.nextElementSibling; el && el.tagName !== 'H2'; el = el.nextElementSibling) {
    if (/^(UL|OL)$/.test(el.tagName)) items.push(...el.querySelectorAll(':scope > li'));
  }
  const tasks = await loadTasks().catch(() => []);
  const src = { vol, num, xid: fm.id || '' };
  for (const li of items) {
    const text = li.textContent.trim();
    if (!text) continue;
    const has = tasks.find((t) => t.src?.vol === vol && t.src?.num === num && t.text === text);
    const t = todayISO();
    const add = (date) => changeTasks((list) => list.push({ ...newTask(text, weekStart(date || t), date), src }), 'Planner: add next step', () => {
      btn.replaceWith(h('span', { class: 'ns-added no-print' }, `✓ 已加入${date ? ` ${dayLabel(date)}` : '本周计划'}`));
    });
    const btn = has ? h('span', { class: 'ns-added no-print' }, `✓ 已在待办${has.date ? ` ${dayLabel(has.date)}` : '（本周计划）'}${has.done ? ' · 已完成' : ''}`)
      : h('button', { class: 'ns-btn no-print', type: 'button', onclick: (e) => menu(e.currentTarget, [
        { icon: 'plus', label: '今天', run: () => add(t) },
        { icon: 'plus', label: '明天', run: () => add(addDays(t, 1)) },
        { icon: 'list', label: '本周计划', run: () => add(null) },
        { icon: 'history', label: '选日期…', run: () => { const d = window.prompt('哪一天？（YYYY-MM-DD）', addDays(t, 1)); if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) add(d); } },
      ]) }, icon('plus', 14), '加入待办');
    li.append(' ', btn);
  }
}

function amendList(list) {
  return h('details', { class: 'amended' }, h('summary', null, `修订记录（${list.length} 次）`),
    h('ol', { class: 'amend-list' }, list.map(parseAmend).map((a) => h('li', null,
      h('span', { class: 'am-at' }, `${fmtDate(a.at)} ${String(a.at).slice(11, 16)}`), h('span', { class: 'am-by' }, a.by), h('span', { class: 'am-why' }, a.why || '（未写原因）')))));
}
function initials(name) {
  return String(name).replace(/,.*$/, '').split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 3);
}

function openVolumeDetails(v) {
  const title = h('input', { id: 'vd-title', value: v.title });
  const desc = h('input', { id: 'vd-desc', value: v.description || '' });
  const code = h('input', { id: 'vd-code', value: v.code || '' });
  const sw = clothPicker(v.color || CLOTHS[0][1]);
  modal({
    title: '卷信息',
    body: h('div', { class: 'form' },
      h('label', { for: 'vd-title' }, '项目'), title,
      h('label', { for: 'vd-desc' }, '说明'), desc,
      h('label', { for: 'vd-code' }, '主题代码'), code,
      h('span', { class: 'label' }, '封面'), sw.el,
      h('p', { class: 'muted' }, `Volume ${v.number}. Its folder in the repository is volumes/${v.id}.`)),
    buttons: [{ label: '取消' }, {
      label: '保存', primary: true,
      run: async () => {
        if (!title.value.trim()) { toast('项目名不能为空。'); return false; }
        await lib.updateNotebook((nb) => {
          const x = nb.volumes.find((y) => y.id === v.id);
          Object.assign(x, { title: title.value.trim(), description: desc.value.trim(), color: sw.value(), code: cleanTopic(code.value) });
        }, `Update volume: ${title.value.trim()}`);
        toast('已保存。');
      },
    }],
  });
}

// ---------- page ----------
function pageCtx(vol, num, local, extra = {}) {
  return {
    lib, vol, num, urls: view.urls, attNames: vol && num ? lib.attachments(vol, num) : [], ...extra,
    ctxFor: (v, n) => pageCtx(v, n, null, { xid: lib.page(v, n)?.xid || '' }),
    resolveBlob: async (name) => {
      name = decodeURIComponent(name);
      if (local?.has(name)) return local.get(name);
      if (name.startsWith('/')) return lib.readBlob(name.slice(1));
      return lib.readAttachment(vol, num, name);
    },
  };
}

function refLink(key, curVol) {
  const r = parseRef(key);
  if (!r) return null;
  const p = lib.page(r.vol, r.num);
  const label = r.vol === curVol ? `p. ${r.num}` : `${lib.volume(r.vol)?.title || r.vol}, p. ${r.num}`;
  return h('a', { class: 'pageref', href: `#/v/${r.vol}/${r.num}`, title: p?.title || '' }, label);
}

// Builds the page sheet; `ready` resolves when figures and charts are drawn.
// Older pages list reagents only in the front matter; they get the same 试剂 table at the foot.
const shownBody = (fm, body) => renameMaterialsHeading(readMaterials(body) || !(fm.reagents || []).length ? body : writeMaterials(body, fm.reagents.map((id) => ({ id }))));

// ----- live PDF preview: the page laid out with the export's own print styles, in an A4 frame -----
let printCss = null;
const printRules = () => (printCss ??= fetch('css/notebook.css').then((r) => r.text()).then((css) => {
  let out = ''; const re = /@media\s+print\s*\{/g; let m;
  while ((m = re.exec(css))) {
    let depth = 1; let j = re.lastIndex;
    while (j < css.length && depth) { if (css[j] === '{') depth++; else if (css[j] === '}') depth--; j++; }
    out += `${css.slice(re.lastIndex, j - 1)}\n`; re.lastIndex = j;
  }
  return out;
}).catch(() => ''));
function pdfPreview() {
  const A4 = (210 / 25.4) * 96;
  const frame = h('iframe', { class: 'pdf-frame', title: 'PDF 预览', tabindex: '-1' });
  const page = h('div', { class: 'pdf-page' }, frame);
  const wrap = h('div', { class: 'pdf-wrap' }, page);
  let doc = null;
  const fit = () => {
    if (!doc?.body) return;
    const z = Math.min(1.3, Math.max(0.3, (wrap.clientWidth - 32) / A4));
    const hgt = Math.max(doc.body.scrollHeight, A4 * 297 / 210);
    Object.assign(frame.style, { width: `${A4}px`, height: `${hgt}px`, transform: `scale(${z})` });
    Object.assign(page.style, { width: `${A4 * z}px`, height: `${hgt * z}px` });
  };
  const ready = printRules().then((css) => new Promise((resolve) => {
    const de = document.documentElement;
    const head = [...document.head.querySelectorAll('link[rel="stylesheet"], style')].map((n) => n.outerHTML).join('');
    frame.addEventListener('load', () => {
      doc = frame.contentDocument;
      new ResizeObserver(fit).observe(doc.body);
      new ResizeObserver(fit).observe(wrap);
      resolve();
    }, { once: true });
    frame.srcdoc = `<!doctype html><html lang="zh-CN" data-theme="light" data-font="${de.dataset.font || ''}" data-size="${de.dataset.size || ''}" data-ptable="${de.dataset.ptable || 'booktabs'}"><head><meta charset="utf-8"><base href="${document.baseURI}">${head}<style>${css}</style><style>
      html, body { margin: 0; background: #fff !important; overflow: hidden; }
      body { width: 210mm; }
      #print-root { display: block !important; }
      a { pointer-events: none; }
    </style></head><body class="print-volume"><div id="print-root"></div></body></html>`;
  }));
  let seq = 0;
  // Lay out the page as the export would; the old one stays on screen until the new one is ready.
  async function update(vol, num, fm, body, ctx) {
    const mine = ++seq;
    await ready;
    const content = h('div', { class: 'sheet-body prose' });
    const panel = await expPanel(fm, vol, num, { forPrint: true }).catch(() => null);
    const sheet = recordSheet(vol, num, fm, panel, content);
    const holder = doc.createElement('div');
    holder.style.cssText = 'position:absolute;left:0;top:0;width:210mm;visibility:hidden';
    holder.append(printFrame([sheet]));
    doc.body.append(holder);
    await renderInto(content, shownBody(fm, body), ctx);
    if (mine !== seq) { holder.remove(); return; }
    doc.getElementById('print-root').replaceChildren(...holder.childNodes);
    holder.remove();
    fitChartsForPrint(doc.getElementById('print-root'), 680);
    fit();
  }
  return { el: wrap, update, fit };
}

async function buildPageSheet(vol, num, { forPrint = false } = {}) {
  const v = lib.volume(vol);
  const entry = lib.page(vol, num);
  const md = await lib.readPage(vol, num);
  const { fm, body } = parseFrontMatter(md);
  const content = h('div', { class: 'sheet-body prose' });
  const shown = shownBody(fm, body);
  const ready = renderInto(content, shown, pageCtx(vol, num, null, { xid: fm.id || '' }));
  const panel = await expPanel(fm, vol, num, { forPrint }).catch(() => null);
  if (forPrint) return { el: recordSheet(vol, num, fm, panel, content), ready, fm, body };
  const cont = entry?.continues ? parseRef(entry.continues) : null;
  const next = lib.continuedOn(vol, num);
  const backs = lib.backlinks(vol, num);
  const tags = entry?.tags || [];
  const sig = fm.signed
    ? h('span', { class: 'sig' }, sigText(fm.signer || signerName()))
    : h('span', { class: 'unsigned' }, '未签名');
  const sheet = h('article', { class: 'sheet page', 'data-vol': vol, 'data-num': num },
    h('header', { class: 'sheet-head' },
      h('div', { class: 'form-row' },
        field('项目', v?.title || vol, 'grow'),
        field('卷号', v?.number ?? ''),
        h('div', { class: 'stamp', 'aria-label': `Page ${num}` }, h('span', { class: 'stamp-no' }, 'No'), pad(num))),
      h('div', { class: 'form-row' },
        field('标题', h('span', { class: 'title' }, fm.title || '未命名'), 'grow'),
        field('日期', fmtDate(fm.date))),
      fm.id ? h('div', { class: 'form-row' }, field('实验编号', h('button', { class: 'linkish xid', type: 'button', title: '复制编号', onclick: () => copyText(fm.id) }, fm.id), 'grow')) : null,
      entry?.series ? seriesRow(entry) : null),
    fm.void ? h('div', { class: 'void-banner' }, h('strong', null, '已作废'), ` ${fm.void}`) : null,
    body.includes('原始数据与首次记录不一致') ? h('div', { class: 'void-banner data-alert' }, h('strong', null, '⚠ 原始数据已变动'), ' 有数据文件与首次记录的指纹不一致或已缺失，详见页末“自动挂接”。') : null,
    panel,
    cont ? h('p', { class: 'cont from' }, '接上页 ', refLink(entry.continues, vol)) : null,
    content,
    next ? h('p', { class: 'cont to' }, '续见 ', refLink(`${next.vol}/${next.num}`, vol)) : null,
    h('footer', { class: 'sheet-foot' },
      tags.length ? h('div', { class: 'form-row' }, field('标签', h('span', { class: 'tags' }, tags.map((t) => h('a', { href: `#/search?q=${encodeURIComponent(`#${t}`)}` }, `#${t}`))), 'grow')) : null,
      backs.length ? h('div', { class: 'form-row' }, field('被引用于', h('span', { class: 'backs' }, backs.map((p) => refLink(`${p.vol}/${p.num}`, vol))), 'grow')) : null,
      h('div', { class: 'form-row sig-row' }, field('已签名', sig, 'grow'), field('日期', fm.signed ? fmtDate(fm.signed) : '')),
      h('div', { class: 'form-row sig-row print-only' }, field('见证人', '', 'grow'), field('日期', '')),
      (fm.amended || []).length ? amendList(fm.amended) : null,
      entry?.pending ? h('p', { class: 'pending-note no-print' }, '已存在本机，联网后提交到 GitHub。') : null));
  if (forPrint) sheet.classList.add('for-print');
  if (fm.void) sheet.classList.add('voided');
  return { el: sheet, ready, fm, body };
}

// The exported record: experiment name, number and date on top, the related data at the bottom.
function recordSheet(vol, num, fm, panel, content) {
  const files = lib.attachments(vol, num).filter((n) => !/\.(jpe?g|png|gif|webp)$/i.test(n));
  const data = [fm.data, ...files].filter(Boolean);
  const ps = fm.series ? allSeries().find((x) => x.name === fm.series)?.pages || [] : [];
  const k = ps.findIndex((x) => x.vol === vol && x.num === num);
  const sheet = h('article', { class: `sheet page for-print record${fm.void ? ' voided' : ''}`, 'data-vol': vol, 'data-num': num },
    h('header', { class: 'rec-head' },
      h('div', { class: 'rh-cell rh-name' }, h('span', { class: 'rh-lbl' }, '实验名称'), h('span', { class: 'rh-title' }, fm.title || '未命名')),
      h('div', { class: 'rh-cell rh-when' }, h('span', { class: 'rh-lbl' }, '日期'), h('span', { class: 'rh-date' }, fm.date || '')),
      fm.id || fm.series ? h('div', { class: 'rh-meta' },
        fm.id ? h('span', null, h('span', { class: 'rh-lbl' }, '编号'), h('span', { class: 'rh-id' }, fm.id)) : null,
        fm.series ? h('span', null, h('span', { class: 'rh-lbl' }, '系列'), h('span', { class: 'rh-series' }, `${fm.series}${k >= 0 ? `　第 ${k + 1} / ${ps.length} 次` : ''}`)) : null,
        fm.protocol ? h('span', null, h('span', { class: 'rh-lbl' }, 'SOP'), h('span', { class: 'rh-id' }, fm.protocol)) : null) : null),
    fm.void ? h('div', { class: 'void-banner' }, h('strong', null, '已作废'), ` ${fm.void}`) : null,
    panel,
    content,
    (fm.amended || []).length ? h('div', { class: 'rec-amend' }, h('span', { class: 'rh-lbl' }, '修订记录'),
      h('ol', null, fm.amended.map(parseAmend).map((x) => h('li', null, `${fmtDate(x.at)} ${String(x.at).slice(11, 16)}　${x.by}　${x.why}`)))) : null,
    h('footer', { class: 'rec-foot' },
      h('span', { class: 'rh-lbl' }, '相关实验数据'),
      h('div', { class: 'rf-val' }, data.length ? data.map((d) => h('div', null, d)) : h('div', { class: 'rf-blank' }))));
  return sheet;
}

// Prints the given sheets inside a table whose header and footer rows repeat on
// every sheet of paper: that gives each page its margins while @page margin 0
// keeps the browser from adding its own date, title and address lines.
function printSheets(nodes) {
  const pr = document.getElementById('print-root');
  pr.replaceChildren(printFrame(nodes));
  return pr;
}
// Running header and footer, repeated on every sheet of paper.
function printFrame(nodes) {
  const nb = lib?.notebook || {};
  return (h('table', { class: 'print-frame' },
    h('thead', null, h('tr', null, h('td', { class: 'pf-top' }, h('div', { class: 'pf-run' },
      h('span', null, nb.title || '实验记录本'), h('span', null, 'LABORATORY RECORD'))))),
    h('tbody', null, h('tr', null, h('td', { class: 'pf-body' }, nodes))),
    h('tfoot', null, h('tr', null, h('td', { class: 'pf-bottom' }, h('div', { class: 'pf-run foot' },
      h('span', null, nb.owner ? `记录人　${nb.owner}` : ''), h('span', null, `导出于 ${todayISO()}`)))))));
}

async function viewPage(vol, num, params) {
  const v = lib.volume(vol);
  if (!v) return viewMissing('笔记本里没有这个卷。');
  if (!lib.page(vol, num)) {
    return viewMissing(`${v.title} 第 ${num} 页还没写。`, h('a', { class: 'btn primary', href: `#/v/${vol}/new` }, '写新页'));
  }
  const { el: sheet, fm } = await buildPageSheet(vol, num);
  nextStepButtons(sheet, vol, num, fm);
  conclusionEvidenceButton(sheet, vol, num, fm);
  const pages = lib.pages(vol);
  const idx = pages.findIndex((p) => p.num === num);
  const prev = pages[idx - 1]; const next = pages[idx + 1];
  const more = h('button', { class: 'btn icon ghost', 'aria-label': '更多', onclick: (e) => menu(e.currentTarget, [
    { icon: 'continue', label: '在新页续写', run: () => { location.hash = `#/v/${vol}/new?continues=${num}`; } },
    { icon: 'copy', label: '复制本页链接', run: () => copyRef(vol, num) },
    { icon: 'flask', label: '导入试剂 / 溶液…', run: () => openMaterials(vol, num) },
    { icon: 'print', label: '打印 / 存为 PDF', run: () => exportPdf([lib.page(vol, num)], fm.date, fm.date, { cover: false }) },
    { icon: 'history', label: '历史版本', run: () => openHistory(vol, num) },
    { icon: 'print', label: '打印纸质记录卡', run: () => printCard(vol, num) },
    fm.id ? { icon: 'copy', label: '命名助手（数据/照片文件名）', run: () => openNaming(fm, num) } : null,
    { icon: 'list', label: fm.series ? '更改所属系列…' : '加入系列…', run: () => setSeries(vol, num, fm) },
    { icon: 'list', label: '录入操作步骤（用量、容器、条件）', run: () => openStepsEditor(vol, num) },
    { icon: 'link', label: '引用另一次实验（步骤完全相同时）…', run: () => openQuoteDialog(vol, num, null) },
    { icon: 'book', label: '引用假设（本实验要检验的）…', run: () => openCiteHypothesis(vol, num, null) },
    { icon: 'plus', label: '登记本页配制的溶液（S-编号）…', run: async () => editSolution(await loadSolutions(lib), null, { page: fm.id || `${vol}/${num}`, prepared: fm.date, steps: readSteps(raw) || [] }) },
    fm.void ? { icon: 'history', label: '取消作废', run: () => setVoid(vol, num, null) } : { icon: 'close', label: '作废这一页…', run: () => setVoid(vol, num, fm) },
    { icon: 'trash', label: '永久删除这一页…', run: () => openDeletePage(vol, num, fm) },
    (fm.followups || []).length ? { icon: 'download', label: '提醒导出到手机日历', run: () => exportIcs((fm.followups || []).map(parseFollowup).filter((f) => f && !f.done).map((f) => ({ ...f, xid: fm.id, page: { vol, num } }))) } : null,
  ]) }, icon('more'));
  const photo = h('button', { class: 'btn', type: 'button', onclick: () => openPhotoCapture(vol, num) }, icon('attach', 18), h('span', { class: 'wide-only' }, '拍照/加图'));
  const raw = await lib.readPage(vol, num);
  const mats = h('button', { class: 'btn', type: 'button', title: '从试剂库 / 溶液库导入本次用到的试剂和溶液', onclick: () => openMaterials(vol, num) }, icon('flask', 18), h('span', { class: 'wide-only' }, '试剂'));
  const results = /```samples/.test(raw) ? h('button', { class: 'btn', type: 'button', onclick: () => openSamplesEditor(vol, num) }, icon('table', 18), h('span', { class: 'wide-only' }, '录入表格')) : null;
  const stepsBtn = /```steps/.test(raw) ? h('button', { class: 'btn', type: 'button', onclick: () => openStepsEditor(vol, num) }, icon('list', 18), h('span', { class: 'wide-only' }, '步骤')) : null;
  const edit = h('a', { class: 'btn', href: `#/v/${vol}/${num}/edit` }, icon('edit', 18), h('span', { class: 'wide-only' }, fm.signed ? '修订' : '编辑'));
  const pager = h('nav', { class: 'pager', 'aria-label': '页数' },
    prev ? h('a', { class: 'btn ghost', href: `#/v/${vol}/${prev.num}`, 'data-nav': 'prev', rel: 'prev' }, icon('back', 18), `p. ${prev.num}`) : h('span'),
    h('a', { class: 'btn ghost', href: `#/v/${vol}` }, '目录'),
    next ? h('a', { class: 'btn ghost', href: `#/v/${vol}/${next.num}`, 'data-nav': 'next', rel: 'next' }, `p. ${next.num}`, icon('next', 18))
      : h('a', { class: 'btn ghost', href: `#/v/${vol}/new` }, icon('plus', 18), '新页'));
  const dir = lastPageVisited && lastPageVisited.vol === vol ? Math.sign(num - lastPageVisited.num) : 0;
  if (dir) sheet.classList.add(dir > 0 ? 'turn-next' : 'turn-prev');
  lastPageVisited = { vol, num };
  addSwipe(sheet, prev && `#/v/${vol}/${prev.num}`, next && `#/v/${vol}/${next.num}`);
  return h('div', { class: 'view page-view' },
    topbar({ back: `#/v/${vol}`, backLabel: '目录', title: v.title, sub: `第 ${num} 页`, actions: [stepsBtn, results, mats, photo, edit, more] }),
    demoBanner(), sheet, pager);
}
let lastPageVisited = null;

function addSwipe(el, prevHref, nextHref) {
  let x0 = null; let y0 = 0;
  el.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1 || e.target.closest('.printout, table, pre, .katex-display, input, textarea')) { x0 = null; return; }
    x0 = e.touches[0].clientX; y0 = e.touches[0].clientY;
  }, { passive: true });
  el.addEventListener('touchend', (e) => {
    if (x0 == null) return;
    const dx = e.changedTouches[0].clientX - x0; const dy = e.changedTouches[0].clientY - y0;
    x0 = null;
    if (Math.abs(dx) > 80 && Math.abs(dy) < 50) {
      if (dx < 0 && nextHref) location.hash = nextHref;
      if (dx > 0 && prevHref) location.hash = prevHref;
    }
  });
}

async function copyRef(vol, num) {
  const ref = `[[${vol}/${num}]]`;
  try { await navigator.clipboard.writeText(ref); toast(`已复制 ${ref}，可粘贴到任何页面。`); } catch { toast(`Link text: ${ref}`); }
}

async function openHistory(vol, num) {
  const list = h('div', { class: 'history' }, h('p', { class: 'muted' }, '读取中…'));
  modal({ title: `第 ${num} 页的历史版本`, body: list, buttons: [{ label: '关闭' }] });
  try {
    const items = await lib.history(pagePath(vol, num));
    list.replaceChildren(items.length ? h('ol', { class: 'ledger-rows' }, items.map((c) => h('li', null,
      h(c.url ? 'a' : 'span', c.url ? { href: c.url, target: '_blank', rel: 'noopener' } : null,
        h('span', { class: 'l-date' }, `${fmtDate(c.date)} ${fmtTime(c.date)}`),
        h('span', { class: 'l-title' }, c.message.split('\n')[0]),
        h('span', { class: 'l-where' }, c.sha.slice(0, 7)))))) : h('p', null, '还没有保存的版本。'),
    h('p', { class: 'muted' }, 'GitHub 保存了每个版本，点开可以看具体改动。'));
  } catch (e) {
    list.replaceChildren(h('p', null, e instanceof NetworkError ? '查看历史需要连接 GitHub。' : e.message));
  }
}

function viewMissing(msg, action) {
  return h('div', { class: 'view missing' },
    topbar({ back: '#/', backLabel: '所有卷', title: '找不到' }),
    h('article', { class: 'sheet plain narrow' }, h('p', null, msg), action || h('a', { class: 'btn', href: '#/' }, '回到首页')));
}

// ---------- editor ----------
async function prepareFile(file) {
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

async function viewEditor(vol, num, params) {
  const v = lib.volume(vol);
  if (!v) return viewMissing('笔记本里没有这个卷。');
  const isNew = num == null;
  const pending = isNew ? null : lib.pendingFor(vol, num);
  const dkey = `${lib.key}:draft:${vol}/${isNew ? 'new' : num}`;
  let fm; let body; let baseSha = null;
  const local = new Map();
  const removed = new Set();
  let existing = [];
  if (!isNew) {
    if (!lib.page(vol, num)) return viewMissing(`第 ${num} 页还不存在。`);
    ({ fm, body } = parseFrontMatter(await lib.readPage(vol, num)));
    baseSha = pending ? (pending.baseSha ?? null) : (lib.tree.get(pagePath(vol, num)) || null);
    existing = lib.attachments(vol, num);
    for (const a of pending?.attachments || []) local.set(a.name, new Blob([a.buf], { type: a.type }));
  } else {
    fm = { title: '', date: todayISO(), tags: [] };
    const c = params.get('continues');
    if (c) fm.continues = c;
  }
  const origSigned = !!fm.signed;
  let notice = null;
  const draft = await kv.get(dkey).catch(() => null);
  if (draft) {
    fm = draft.fm; body = draft.body;
    if (!isNew) {
      if ((draft.baseSha ?? null) !== baseSha) notice = '草稿写完后这一页又被改过。保存时会让你选择保留哪个版本。';
      baseSha = draft.baseSha ?? null;
    }
    for (const name of draft.attachments || []) {
      const a = await kv.get(`${dkey}:att:${name}`).catch(() => null);
      if (a) local.set(name, new Blob([a.buf], { type: a.type }));
    }
    for (const n of draft.removed || []) removed.add(n);
    toast(`已恢复 ${fmtTime(new Date(draft.updated).toISOString())} 的未保存草稿。`, { label: '丢弃草稿', run: async () => { await clearDraft(); route(); } });
  }

  // ----- fields -----
  const titleIn = h('input', { class: 'val title-input', value: fm.title || '', placeholder: '这一页写什么？', 'aria-label': '标题' });
  const dateIn = h('input', { type: 'date', class: 'val', value: String(fm.date || todayISO()).slice(0, 10), 'aria-label': '日期' });
  const tagsIn = h('input', { class: 'val', value: (fm.tags || []).join(', '), placeholder: '逗号分隔，例如 oect, gops', 'aria-label': '标签' });
  const ta = h('textarea', { class: 'editor-text', spellcheck: 'true', 'aria-label': '正文', placeholder: '在这里写。支持 Markdown、$公式$、[[页面链接]] 和附件。' });
  ta.value = body || '';
  const pdf = pdfPreview();
  const status = h('span', { class: 'ed-status', 'aria-live': 'polite' }, draft ? '已恢复草稿' : '');
  const strip = h('div', { class: 'att-strip' });
  const fileIn = h('input', { type: 'file', multiple: true, hidden: true, accept: 'image/*,.csv,.tsv,.json,.ipynb,.pdf,.txt,.xlsx,.zip' });

  let contLine = null;
  const renderCont = () => {
    const c = fm.continues ? parseRef(fm.continues, vol) : null;
    const nl = c ? h('p', { class: 'cont from' }, '接上页 ', refLink(`${c.vol}/${c.num}`, vol), ' ',
      h('button', { class: 'btn small ghost', type: 'button', onclick: () => { delete fm.continues; renderCont(); changed(); } }, '移除')) : h('span', { hidden: true });
    if (contLine) contLine.replaceWith(nl);
    contLine = nl;
  };
  renderCont();

  const collect = () => ({
    fm: {
      ...fm,
      title: titleIn.value.trim(),
      date: dateIn.value || todayISO(),
      tags: [...new Set(tagsIn.value.split(/[,\n]/).map(cleanTag).filter(Boolean))],
      ...(readMaterials(ta.value) ? { reagents: readMaterials(ta.value).map((m) => m.id) } : {}),
    },
    body: ta.value,
  });

  const saveDraft = debounce(async () => {
    const c = collect();
    await kv.set(dkey, { fm: c.fm, body: c.body, baseSha, attachments: [...local.keys()], removed: [...removed], updated: Date.now() }).catch(() => {});
    status.textContent = `草稿已存在本机，${fmtTime(nowISO())}`;
  }, 700);
  async function clearDraft() {
    saveDraft.cancel();
    for (const k of await kv.keys(`${dkey}:`)) await kv.del(k);
    await kv.del(dkey);
  }

  const previewUrls = [];
  const renderPreview = debounce(async () => {
    if (!wide() && split.dataset.tab !== 'preview') return;
    const old = previewUrls.splice(0);
    const n = num ?? lib.nextNumber(vol);
    const ctx = pageCtx(vol, n, local);
    ctx.urls = previewUrls;
    const c = collect();
    await pdf.update(vol, n, { ...c.fm, id: fm.id, series: fm.series, protocol: fm.protocol, amended: fm.amended }, c.body, ctx);
    setTimeout(() => old.forEach((u) => URL.revokeObjectURL(u)), 2000);
  }, 450);

  const autosize = () => { ta.style.height = 'auto'; ta.style.height = `${Math.max(ta.scrollHeight + 4, 360)}px`; };
  const changed = () => { status.textContent = '编辑中'; saveDraft(); renderPreview(); };
  for (const el of [titleIn, dateIn, tagsIn]) el.addEventListener('input', changed);
  ta.addEventListener('input', () => { autosize(); changed(); });

  // ----- text helpers -----
  const fire = () => ta.dispatchEvent(new Event('input'));
  function wrap(before, after = before, placeholder = 'text') {
    const s = ta.selectionStart; const e = ta.selectionEnd;
    const sel = ta.value.slice(s, e);
    ta.focus();
    ta.setRangeText(before + (sel || placeholder) + after, s, e, 'end');
    if (!sel) { ta.selectionStart = s + before.length; ta.selectionEnd = s + before.length + placeholder.length; }
    fire();
  }
  function prefixLines(prefix) {
    const s = ta.selectionStart; const e = ta.selectionEnd;
    const start = ta.value.lastIndexOf('\n', s - 1) + 1;
    const chunk = ta.value.slice(start, e);
    ta.focus();
    ta.setRangeText(chunk.split('\n').map((l) => prefix + l).join('\n'), start, e, 'end');
    fire();
  }
  function insertBlock(text, selectFrom, selectLen) {
    const s = ta.selectionStart;
    const before = ta.value.slice(0, s);
    const lead = !before || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
    ta.focus();
    ta.setRangeText(`${lead}${text}\n`, s, ta.selectionEnd, 'end');
    if (selectFrom != null) { ta.selectionStart = s + lead.length + selectFrom; ta.selectionEnd = ta.selectionStart + selectLen; }
    fire();
  }
  function insertInline(text) { ta.focus(); ta.setRangeText(text, ta.selectionStart, ta.selectionEnd, 'end'); fire(); }

  // ----- attachments -----
  const allNames = () => new Set([...existing.filter((n) => !removed.has(n)), ...local.keys()]);
  function uniqueName(name) {
    const taken = allNames();
    if (!taken.has(name)) return name;
    const m = name.match(/^(.*?)(\.[^.]*)?$/);
    let i = 2;
    while (taken.has(`${m[1]}-${i}${m[2] || ''}`)) i++;
    return `${m[1]}-${i}${m[2] || ''}`;
  }
  async function attach(files) {
    for (const f0 of files) {
      const f = await prepareFile(f0);
      let base = f.name && !/^image\.\w+$/.test(f.name) ? f.name : `pasted-${Date.now().toString(36)}.${(f.type.split('/')[1] || 'png').replace('jpeg', 'jpg')}`;
      const name = uniqueName(safeFileName(base));
      local.set(name, f);
      removed.delete(name);
      await kv.set(`${dkey}:att:${name}`, { type: f.type || mimeOf(name), buf: await f.arrayBuffer() }).catch(() => {});
      const ext = name.split('.').pop().toLowerCase();
      if ((f.type || '').startsWith('image/')) {
        insertBlock(`![${name.replace(/\.\w+$/, '').replace(/[-_]+/g, ' ')}](${name})`);
      } else if (['csv', 'tsv'].includes(ext)) {
        const first = (await f.slice(0, 4096).text()).split(/\r?\n/)[0] || '';
        const cols = first.split(ext === 'tsv' ? '\t' : ',').map((c) => c.trim().replace(/^"|"$/g, ''));
        const errCol = cols.slice(1).find((c) => /(^|[_\s-])(sd|se|sem|err|error|ci)$/i.test(c));
        const ys = cols.slice(1).filter((c) => c !== errCol).slice(0, errCol ? 1 : 2);
        insertBlock(`\`\`\`chart\ntype: line\ndata: ${name}\nx: ${cols[0] || ''}\ny: ${ys.join(', ')}\n${errCol ? `error: ${errCol}\n` : ''}title: \n\`\`\``);
      } else if (['ipynb', 'json'].includes(ext)) {
        insertBlock(`![[${name}]]`);
      } else insertInline(`[${name}](${name})`);
    }
    renderStrip();
    saveDraft(); renderPreview();
  }
  function renderStrip() {
    const names = [...new Set([...existing, ...local.keys()])].sort();
    strip.replaceChildren(...names.map((n) => {
      const isLocal = local.has(n) && !existing.includes(n);
      const gone = removed.has(n);
      const size = local.get(n)?.size;
      return h('span', { class: `att${gone ? ' gone' : ''}` },
        h('span', { class: 'att-name' }, n), size ? h('span', { class: 'att-size' }, fmtBytes(size)) : null,
        h('button', {
          class: 'btn icon small ghost', type: 'button', 'aria-label': gone ? `Keep ${n}` : `Remove ${n}`, title: gone ? '保留' : '移除',
          onclick: async () => {
            if (isLocal) { local.delete(n); await kv.del(`${dkey}:att:${n}`).catch(() => {}); } else if (gone) removed.delete(n); else removed.add(n);
            renderStrip(); saveDraft(); renderPreview();
          },
        }, icon(gone ? 'plus' : 'close', 16)));
    }));
    strip.hidden = !names.length;
  }
  fileIn.addEventListener('change', () => { attach([...fileIn.files]); fileIn.value = ''; });
  ta.addEventListener('paste', (e) => {
    // Excel also puts a picture of the cells on the clipboard; the cells themselves win.
    const rows = clipTable(e);
    if (rows) { e.preventDefault(); insertBlock(mdTable(rows)); saveDraft(); renderPreview(); toast(`已粘贴为表格（${rows.length - 1} 行 × ${rows[0].length} 列，第一行是表头）。`); return; }
    const files = [...(e.clipboardData?.files || [])];
    if (files.length) { e.preventDefault(); attach(files); }
  });
  ta.addEventListener('dragover', (e) => { if (e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); ta.classList.add('drop'); } });
  ta.addEventListener('dragleave', () => ta.classList.remove('drop'));
  ta.addEventListener('drop', (e) => {
    ta.classList.remove('drop');
    const files = [...(e.dataTransfer?.files || [])];
    if (files.length) { e.preventDefault(); attach(files); }
  });

  // ----- toolbar -----
  const tb = (ic, label, run) => h('button', { class: 'tool', type: 'button', title: label, 'aria-label': label, onclick: run }, icon(ic, 18));
  const toolbar = h('div', { class: 'toolbar', role: 'toolbar', 'aria-label': 'Formatting' },
    tb('heading', '标题', () => prefixLines('## ')),
    tb('bold', '加粗', () => wrap('**')),
    tb('italic', '斜体', () => wrap('*')),
    tb('list', '列表', () => prefixLines('- ')),
    tb('check', '清单', () => prefixLines('- [ ] ')),
    tb('quote', '引用', () => prefixLines('> ')),
    h('span', { class: 'tool-sep' }),
    tb('math', '公式', () => {
      const sel = ta.value.slice(ta.selectionStart, ta.selectionEnd);
      if (sel && !sel.includes('\n')) wrap('$', '$'); else insertBlock('$$\nE = mc^2\n$$', 3, 8);
    }),
    tb('code', '代码', () => insertBlock('```python\n\n```', 10, 0)),
    tb('table', '表格', () => insertBlock('| Column | Value |\n|---|---|\n|  |  |')),
    h('span', { class: 'tool-sep' }),
    h('button', { class: 'tool text mk-hl', type: 'button', title: '荧光笔 ==文字==', onclick: () => wrap('==', '==', '重点') }, '荧光'),
    h('button', { class: 'tool text mk-ul', type: 'button', title: '下划线 ++文字++', onclick: () => wrap('++', '++', '重点') }, '下划线'),
    h('button', { class: 'tool text mk-ci', type: 'button', title: '画圈 {{文字}}', onclick: () => wrap('{{', '}}', '重点') }, '圈出'),
    h('button', { class: 'tool text', type: 'button', title: '引用另一次实验的某一节（例如完全相同的操作步骤）', onclick: () => openQuoteDialog(vol, num, (block) => insertBlock(block)) }, '引用实验'),
    h('button', { class: 'tool text', type: 'button', title: '引用思维笔记本里的假设（本实验要检验的）', onclick: () => openCiteHypothesis(vol, num, (block) => insertBlock(block)) }, '引用假设'),
    h('button', { class: 'tool text', type: 'button', title: '从试剂库 / 溶液库导入本次用到的试剂和溶液（写在页面最下方“试剂”一节）',
      onclick: () => openMaterials(vol, num, { text: ta.value, reagents: fm.reagents || [], onInsert: (rows) => { ta.value = writeMaterials(ta.value, rows); changed(); toast('已写入页面最下方“试剂”一节。'); } }) }, '试剂'),
    h('span', { class: 'tool-sep' }),
    h('button', { class: 'tool text', type: 'button', title: '反应方程式（一行一个）', onclick: () => insertBlock('```reaction\n2 H2O2 ->[Pt] 2 H2O + O2 | (1)\n```') }, '反应式'),
    h('button', { class: 'tool text', type: 'button', title: '操作步骤：操作 | 用量 | 物质 | 加到/容器 | 条件 | 细节', onclick: () => insertBlock('```steps\n移取 | 10 mL | DI 水 | 20 mL 玻璃瓶 | 室温 | 沿瓶壁缓慢加入\n```') }, '步骤'),
    tb('chart', '图表', () => insertBlock('```chart\ntype: line\nx: dose\ny: response\ntitle: \n---\ndose,response\n0,0.1\n1,0.4\n2,0.7\n```')),
    tb('link', '链接到页面', () => openPagePicker(vol, (ref) => insertInline(`[[${ref}]]`))),
    tb('attach', '附件', () => fileIn.click()));

  ta.addEventListener('keydown', (e) => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); save(false); }
    if (mod && e.key.toLowerCase() === 'b') { e.preventDefault(); wrap('**'); }
    if (mod && e.key.toLowerCase() === 'i') { e.preventDefault(); wrap('*'); }
    if (e.key === 'Tab' && !e.shiftKey && !mod) {
      const line = ta.value.slice(ta.value.lastIndexOf('\n', ta.selectionStart - 1) + 1, ta.selectionStart);
      if (/^\s*([-*+]|\d+\.)\s/.test(line)) { e.preventDefault(); prefixLines('  '); }
    }
  });

  // ----- write / preview tabs (narrow screens) -----
  const wide = () => window.matchMedia('(min-width: 1100px)').matches;
  const writePane = h('div', { class: 'pane write-pane' }, toolbar, ta, strip);
  const previewPane = h('div', { class: 'pane preview-pane' }, h('div', { class: 'pane-label' }, 'PDF 预览'), pdf.el);
  const split = h('div', { class: 'ed-split', 'data-tab': 'write' }, writePane, previewPane);
  const tabWrite = h('button', { class: 'tab', type: 'button', role: 'tab', 'aria-selected': 'true', onclick: () => setTab('write') }, icon('write', 18), '编写');
  const tabPrev = h('button', { class: 'tab', type: 'button', role: 'tab', 'aria-selected': 'false', onclick: () => setTab('preview') }, icon('eye', 18), '预览');
  function setTab(t) {
    split.dataset.tab = t;
    tabWrite.setAttribute('aria-selected', String(t === 'write'));
    tabPrev.setAttribute('aria-selected', String(t === 'preview'));
    if (t === 'preview') renderPreview.flush(); else { ta.focus(); autosize(); }
  }

  // ----- save -----
  let saving = false;
  const saveBtn = h('button', { class: 'btn', type: 'button', onclick: () => save(false) }, origSigned ? '保存修订' : '保存');
  const whyInput = h('input', { class: 'why-input', placeholder: '修改原因（必填），例如：补充漏记的退火时间', 'aria-label': '修改原因' });
  const signBtn = origSigned ? null : h('button', { class: 'btn primary', type: 'button', onclick: () => save(true) }, icon('pen', 18), '签名并保存');
  async function save(sign, opts = {}) {
    if (saving) return;
    if (origSigned && !whyInput.value.trim()) { toast('本页已签名，请在下方写明修改原因。'); whyInput.focus(); return; }
    saving = true; saveBtn.disabled = true; if (signBtn) signBtn.disabled = true;
    status.textContent = '保存中…';
    const c = collect();
    if (!c.fm.title) c.fm.title = '未命名';
    const now = nowISO();
    if (origSigned) c.fm.amended = [...(c.fm.amended || []), amendEntry(whyInput.value)];
    else if (sign) { c.fm.signed = now; c.fm.signer = signerName(); }
    const item = {
      id: pending?.id, vol, num: isNew ? null : num, isNew: isNew || !!pending?.isNew, baseSha,
      fm: c.fm, body: c.body,
      attachments: [...local].filter(([n]) => !removed.has(n)).map(([name, blob]) => ({ name, blob })),
      removed: [...removed].filter((n) => existing.includes(n)),
      ...opts,
    };
    try {
      const r = await lib.savePage(item);
      await clearDraft();
      leaving = true;
      toast(r.queued ? '已存在本机，联网后同步到 GitHub。' : sign ? '已签名并保存。' : origSigned ? '修订已保存。' : '已保存。');
      location.hash = `#/v/${vol}/${r.num}`;
    } catch (e) {
      if (e instanceof ConflictError) {
        saving = false;
        const choice = await choose('这一页在别的设备上改过', '你开始编辑之后，有人（可能是你在另一台设备上）保存了这一页的另一个版本。', [
          ['overwrite', '用我的版本覆盖'], ['new', '把我的另存为新页'], ['cancel', '继续编辑'],
        ]);
        if (choice === 'overwrite') return await save(sign, { force: true });
        if (choice === 'new') return await save(sign, { isNew: true, asNew: true, num: null });
      } else {
        toast(e instanceof ApiError && e.status === 403 ? 'GitHub 拒绝了修改。请检查本设备令牌的 Contents 是否为 Read and write。' : `没有保存：${e.message}`);
      }
      status.textContent = '还没保存，草稿在本机。';
    } finally {
      saving = false; saveBtn.disabled = false; if (signBtn) signBtn.disabled = false;
    }
  }
  let leaving = false;
  const cancel = async () => {
    const c = collect();
    const dirty = draft || c.body !== (body || '') || c.fm.title !== (fm.title || '') || local.size || removed.size;
    if (dirty) {
      const choice = await choose('离开这一页？', '草稿会保留在本机，之后可以回来继续。', [['keep', '保留草稿并离开'], ['discard', '丢弃草稿'], ['stay', '继续编辑']]);
      if (choice === 'stay' || !choice) return;
      if (choice === 'discard') await clearDraft(); else saveDraft.flush();
    }
    leaving = true;
    location.hash = isNew ? `#/v/${vol}` : `#/v/${vol}/${num}`;
  };

  const stamp = h('div', { class: 'stamp', 'aria-label': isNew ? '新页' : `Page ${num}` }, h('span', { class: 'stamp-no' }, 'No'), isNew ? pad(lib.nextNumber(vol)) : pad(num));
  const sheet = h('article', { class: 'sheet page editing' },
    h('header', { class: 'sheet-head' },
      h('div', { class: 'form-row' }, field('项目', v.title, 'grow'), field('卷号', v.number), stamp),
      h('div', { class: 'form-row' },
        h('label', { class: 'field grow' }, h('span', { class: 'lbl' }, '标题'), titleIn),
        h('label', { class: 'field' }, h('span', { class: 'lbl' }, '日期'), dateIn)),
      h('div', { class: 'form-row' }, h('label', { class: 'field grow' }, h('span', { class: 'lbl' }, '标签'), tagsIn))),
    notice ? h('p', { class: 'warn' }, notice) : null,
    origSigned ? h('p', { class: 'note' }, `This page was signed on ${fmtDate(fm.signed)}. Changes are saved as a dated amendment, and the earlier version stays in the page history.`) : null,
    contLine,
    h('div', { class: 'tabs', role: 'tablist' }, tabWrite, tabPrev),
    split, fileIn);

  const root = h('div', { class: 'view editor' },
    topbar({ title: isNew ? `${v.title} · 新页` : `编辑第 ${num} 页`, sub: v.title, actions: [] }),
    demoBanner(), sheet,
    h('div', { class: 'action-bar' }, status, origSigned ? whyInput : null, h('div', { class: 'ab-buttons' }, h('button', { class: 'btn ghost', type: 'button', onclick: cancel }, '取消'), saveBtn, signBtn)));
  root.querySelector('.topbar .tb-left').prepend(h('button', { class: 'btn icon ghost', 'aria-label': '取消', title: '取消', onclick: cancel }, icon('close')));

  renderStrip();
  requestAnimationFrame(() => {
    autosize(); renderPreview.flush();
    (isNew && !titleIn.value ? titleIn : ta).focus({ preventScroll: true });
  });
  window.addEventListener('resize', () => { if (wide()) renderPreview(); }, { passive: true });
  const leaveGuard = () => { if (!leaving && view.kind === 'editor') saveDraft.flush(); };
  window.addEventListener('pagehide', leaveGuard);
  window.addEventListener('hashchange', leaveGuard, { once: true });
  return root;
}

function choose(title, text, options) {
  return new Promise((resolve) => {
    let picked = null;
    modal({
      title, body: h('p', null, text),
      buttons: options.map(([value, label], i) => ({ label, primary: i === 0, run: () => { picked = value; } })),
      onClose: () => resolve(picked),
    });
  });
}

function openPagePicker(curVol, onPick) {
  const input = h('input', { type: 'search', placeholder: '按标题、编号或文字搜索', autofocus: true, 'aria-label': '找页面' });
  const list = h('ol', { class: 'picker-list' });
  let root;
  const draw = () => {
    const res = search(lib.allPages(), input.value).slice(0, 30);
    list.replaceChildren(...res.map(({ page: p }) => h('li', null, h('button', {
      type: 'button', class: 'picker-item',
      onclick: () => { onPick(p.vol === curVol ? String(p.num) : `${p.vol}/${p.num}`); root.close(); },
    }, h('span', { class: 'l-where' }, p.vol === curVol ? `p. ${p.num}` : `${lib.volume(p.vol)?.title || p.vol}, p. ${p.num}`), h('span', { class: 'l-title' }, p.title)))));
    if (!res.length) list.append(h('li', { class: 'muted' }, '没有匹配的页面。'));
  };
  input.addEventListener('input', draw);
  draw();
  root = modal({ title: '链接到页面', body: h('div', { class: 'picker' }, input, list), buttons: [] });
}

// ---------- search ----------
function openSearch(initial = '', vol = '') {
  const input = h('input', { type: 'search', value: initial, placeholder: '关键词、日期（2026-11 / 20261101）、实验编号、#09、#标签', autofocus: true, 'aria-label': '搜索笔记本' });
  const volSel = h('select', { 'aria-label': '卷' }, h('option', { value: '' }, '所有卷'), lib.volumes().map((v) => h('option', { value: v.id, selected: v.id === vol }, v.title)));
  const from = h('input', { type: 'date', 'aria-label': '起始日期', title: '起始日期' });
  const to = h('input', { type: 'date', 'aria-label': '截止日期', title: '截止日期' });
  const tags = h('div', { class: 'tag-cloud' }, lib.tags().slice(0, 24).map(([t, n]) => h('button', {
    type: 'button', class: 'tag-btn', onclick: () => { input.value = `#${t}`; draw(); input.focus(); },
  }, `#${t}`, h('span', { class: 'n' }, n))));
  const out = h('ol', { class: 'results' });
  let root;
  const draw = () => {
    const q = input.value.trim();
    tags.hidden = !!q;
    if (!q && !volSel.value && !from.value && !to.value) { out.replaceChildren(); return; }
    const res = search(lib.allPages(), q, { vol: volSel.value, from: from.value, to: to.value }).slice(0, 60);
    out.replaceChildren(...res.map(({ page: p, snippet }) => h('li', null, h('a', { href: `#/v/${p.vol}/${p.num}`, onclick: () => root.close() },
      h('span', { class: 'r-where' }, `${lib.volume(p.vol)?.title || p.vol}, p. ${p.num}`, h('span', { class: 'r-date' }, fmtDate(p.date))),
      h('span', { class: 'r-title' }, p.xid ? h('span', { class: 'xid-tag' }, p.xid) : null, p.title),
      snippet ? h('span', { class: 'r-snip', html: snippet }) : null))));
    if (!res.length) out.append(h('li', { class: 'muted' }, '没有结果，试试少写几个词。'));
  };
  input.addEventListener('input', draw);
  volSel.addEventListener('change', draw);
  from.addEventListener('change', draw); to.addEventListener('change', draw);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { const a = out.querySelector('a'); if (a) { a.click(); location.hash = a.getAttribute('href'); } } });
  draw();
  root = modal({ title: '搜索', wide: true, body: h('div', { class: 'search' }, h('div', { class: 'search-row' }, input, volSel), h('div', { class: 'search-row dates' }, h('span', { class: 'muted' }, '日期'), from, '至', to), tags, out), buttons: [] });
}

// ---------- printing ----------
async function printVolume(id) {
  const v = lib.volume(id);
  toast('正在准备打印…');
  const pages = lib.pages(id);
  const nodes = [];
  nodes.push(h('article', { class: 'sheet print-cover' },
    h('div', { class: 'cover-label big' },
      h('span', { class: 'cl-kind' }, '实验记录本'),
      h('span', { class: 'cl-no' }, `No. ${v.number}`),
      h('span', { class: 'cl-title' }, v.title),
      h('span', { class: 'cl-meta' }, `${lib.notebook.owner || ''}`, h('br'), `${fmtDate(v.created)} to ${fmtDate(pages[pages.length - 1]?.date || todayISO())}`))));
  const toc = viewVolume(id).querySelector('.sheet.toc');
  nodes.push(toc);
  const readies = [];
  for (const p of pages) {
    const { el, ready } = await buildPageSheet(id, p.num, { forPrint: true });
    nodes.push(el); readies.push(ready);
  }
  const pr = printSheets(nodes);
  const settle = (p) => Promise.race([p, new Promise((r) => setTimeout(r, 15000))]);
  await settle(Promise.allSettled(readies));
  await settle(Promise.all([...pr.querySelectorAll('img')].map((i) => i.decode?.().catch(() => {}))));
  document.body.classList.add('print-volume');
  fitChartsForPrint(pr, 680);
  setTimeout(() => window.print(), 50);
}

// ---------- settings ----------
function sigPicker() {
  const nb = lib.notebook;
  let pick = sigFontOf(nb.sigFont)[0];
  const text = h('input', { id: 's-sigtext', value: nb.sigText || '', placeholder: `留空则用“${nb.owner || '签名用的名字'}”，可写 王千语 / Q. Wang` });
  const grid = h('div', { class: 'sig-grid', role: 'radiogroup', 'aria-label': '签名字体' });
  const draw = () => {
    const word = text.value.trim() || nb.owner || '签名';
    grid.replaceChildren(...SIG_FONTS.map(([id, fam, label, css]) => {
      useFontCss(css);
      return h('button', { type: 'button', role: 'radio', 'aria-checked': String(id === pick), class: `sig-opt${id === pick ? ' on' : ''}`, onclick: () => { pick = id; draw(); } },
        h('span', { class: 'sig-sample', style: { fontFamily: `'${fam}', cursive` } }, word),
        h('span', { class: 'sig-name' }, label));
    }));
  };
  text.addEventListener('input', draw); draw();
  return h('div', { class: 'sig-pick' },
    h('label', { for: 's-sigtext' }, '签名显示为'), text,
    h('span', { class: 'label' }, '签名字体（中文名请选标“中文”的字体）'), grid,
    h('button', { class: 'btn', type: 'button', onclick: async (e) => {
      e.target.disabled = true;
      try { await lib.updateNotebook((n) => { n.sigFont = pick; n.sigText = text.value.trim(); }, 'Signature style'); applySignature(); toast('签名样式已保存。'); } catch (err) { toast(err instanceof NetworkError ? '离线中，联网后再试。' : err.message); } finally { e.target.disabled = false; }
    } }, '保存签名样式'));
}

function viewSettings() {
  const isLib = !!lib;
  const back = isLib ? '#/' : null;
  const nbTitle = h('input', { id: 's-title', value: lib?.notebook.title || '' });
  const owner = h('input', { id: 's-owner', value: lib?.notebook.owner || '', placeholder: '签名用的名字' });
  const theme = h('select', { id: 's-theme' }, [['auto', '跟随系统'], ['light', '浅色纸'], ['dark', '深色纸']].map(([v, l]) => h('option', { value: v, selected: S.theme === v }, l)));
  const down = h('input', { type: 'checkbox', id: 's-down', checked: S.downscale });
  const repo = h('input', { id: 's-repo', value: `${S.owner}/${S.repo}`, spellcheck: 'false' });
  const branch = h('input', { id: 's-branch', value: S.branch, spellcheck: 'false' });
  const token = h('input', { id: 's-token', type: 'password', placeholder: S.token ? '已存在本机（粘贴新的即可替换）' : 'github_pat_…', autocomplete: 'off' });
  const api = h('input', { id: 's-api', value: S.apiBase, spellcheck: 'false' });

  const font = h('select', { id: 's-font' }, FONTS.map(([v, l]) => h('option', { value: v, selected: S.font === v }, l)));
  const size = h('select', { id: 's-size' }, [['normal', '标准'], ['large', '大'], ['xlarge', '特大']].map(([v, l]) => h('option', { value: v, selected: S.size === v }, l)));
  const ptable = h('select', { id: 's-ptable' }, PTABLE_STYLES.map(([v, l]) => h('option', { value: v, selected: (S.ptable || 'booktabs') === v }, l)));
  ptable.addEventListener('change', () => { S.ptable = ptable.value; saveSettings(); applyTheme(); });
  const fontDemo = h('div', { class: 'prose font-demo' });
  fontDemo.innerHTML = '将 <span class="qty">10 mL</span> DI 水加入 <span class="qty">20 mL</span> 玻璃瓶，<span class="qty">500 rpm</span> 搅拌 <span class="qty">30 min</span>。PEDOT:PSS 薄膜呈深蓝色。';
  theme.addEventListener('change', () => { S.theme = theme.value; saveSettings(); applyTheme(); });
  font.addEventListener('change', () => { S.font = font.value; saveSettings(); applyTheme(); });
  size.addEventListener('change', () => { S.size = size.value; saveSettings(); applyTheme(); });
  down.addEventListener('change', () => { S.downscale = down.checked; saveSettings(); });

  const section = (title, ...kids) => h('section', { class: 'settings-section' }, h('h2', null, title), ...kids);
  return h('div', { class: 'view settings' },
    topbar({ back, backLabel: '所有卷', title: '设置' }),
    demoBanner(),
    h('article', { class: 'sheet plain narrow' },
      isLib ? section('笔记本',
        h('div', { class: 'form' },
          h('label', { for: 's-title' }, '笔记本名称'), nbTitle,
          h('label', { for: 's-owner' }, '签名用的名字'), owner,
          sigPicker(),
          h('button', { class: 'btn primary', type: 'button', onclick: async (e) => {
            e.target.disabled = true;
            try { await lib.updateNotebook((nb) => { nb.title = nbTitle.value.trim() || '实验记录本'; nb.owner = owner.value.trim(); }); toast('已保存。'); } catch (err) { toast(err instanceof NetworkError ? '离线中，联网后再试。' : err.message); } finally { e.target.disabled = false; }
          } }, '保存'))) : null,
      section('本设备',
        h('div', { class: 'form' },
          h('label', { for: 's-theme' }, '纸张'), theme,
          h('label', { for: 's-font' }, '正文字体'), font,
          h('label', { for: 's-size' }, '字号'), size,
          fontDemo,
          h('label', { for: 's-ptable' }, 'PDF 表格样式'), ptable,
          h('p', { class: 'muted' }, '导出 PDF 时，表格自动铺满 A4 宽度；表头里的单位（如 μL）另起一行；列多的表自动缩小字号。'),
          h('label', { class: 'check', for: 's-down' }, down, ' 附加前把大照片缩小到 2400 px'))),
      DEMO ? null : section('连接',
        h('p', { class: 'muted' }, '记录保存在这个 GitHub 私有仓库里。令牌只存在这个浏览器中。'),
        h('div', { class: 'form' },
          h('label', { for: 's-repo' }, '仓库'), repo,
          h('label', { for: 's-branch' }, '分支'), branch,
          h('label', { for: 's-token' }, '令牌'), token,
          h('details', null, h('summary', null, '高级'), h('label', { for: 's-api' }, 'GitHub API 地址'), api),
          h('div', { class: 'row-actions' },
            h('button', { class: 'btn primary', type: 'button', onclick: async (e) => {
              const [o, r] = repo.value.trim().split('/');
              if (!o || !r) { toast('仓库请写成 用户名/仓库名。'); return; }
              const next = { ...S, owner: o, repo: r, branch: branch.value.trim() || 'main', apiBase: api.value.trim() || DEFAULTS.apiBase, token: token.value.trim() || S.token };
              e.target.disabled = true;
              try {
                const acc = await new GitHubBackend(next).checkAccess();
                if (!acc.canWrite) throw new Error('这个令牌不能修改仓库。请把 Contents 设为 Read and write。');
                if (!(await confirmPrivate(acc, `${o}/${r}`))) return;
                Object.assign(S, next); saveSettings();
                await startLibrary(); toast('已连接。'); location.hash = '#/';
              } catch (err) {
                toast(err instanceof ApiError && err.status === 401 ? 'GitHub 拒绝了这个令牌。' : err instanceof ApiError && err.status === 404 ? '这个令牌看不到那个仓库。' : err.message);
              } finally { e.target.disabled = false; }
            } }, '保存连接'),
            h('a', { class: 'btn', href: tokenUrl(), target: '_blank', rel: 'noopener' }, '创建新令牌')))),
      isLib ? section('维护',
        h('p', { class: 'muted' }, '直接在 GitHub 或电脑上改过页面文件后，重建一下搜索索引。清除缓存只删本机的副本。'),
        h('div', { class: 'row-actions' },
          h('button', { class: 'btn', type: 'button', onclick: async (e) => {
            e.target.disabled = true; toast('正在重建搜索索引…');
            try { const n = await lib.rebuildIndex(); toast(`搜索索引已重建（读取 ${n} 页）。`); } catch (err) { toast(err.message); } finally { e.target.disabled = false; }
          } }, '重建搜索索引'),
          h('button', { class: 'btn', type: 'button', onclick: async () => { await lib.clearCache(); toast('本机缓存已清除，打开页面时会重新下载。'); lib.head = null; await lib.refresh(); } }, '清除本机缓存'))) : null,
      section('帮助',
        h('p', null, h('a', { href: '?demo#/v/sample/1' }, '打开示例笔记本'), '，可以看到各种写法和对应的源文本。')),
      DEMO ? null : section('断开',
        h('p', { class: 'muted' }, '删除本机的令牌和缓存，GitHub 上的内容不受影响。'),
        h('button', { class: 'btn danger', type: 'button', onclick: async () => {
          const ok = await choose('断开这台设备？', lib?.outbox.length ? `${lib.outbox.length} 个页面还没同步，断开会丢失。` : '随时可以用令牌重新连接。', [['yes', '断开'], ['no', '取消']]);
          if (ok !== 'yes') return;
          if (lib) { await lib.clearCache(); await kv.del(`${lib.key}:outbox`); }
          S.token = ''; saveSettings(); location.hash = '#/'; location.reload();
        } }, '断开这台设备'))));
}

// ---------- experiments: IDs, sample tables, libraries, reminders ----------
const thead = (cols) => h('thead', null, h('tr', null, cols.map((c) => h('th', { scope: 'col' }, c))));

function downloadText(name, text, type = 'text/plain') {
  const url = URL.createObjectURL(text instanceof Blob ? text : new Blob([text], { type }));
  const a = h('a', { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast(`已复制：${text}`); } catch { toast(text); }
}
// Changes to a signed page are logged as "time | who | why" (GLP-style audit trail).
const amendEntry = (why) => `${nowISO()} | ${signerName()} | ${String(why || '').replace(/\s*\n\s*/g, ' ').trim()}`;
function parseAmend(s) {
  const [at, by = '', ...why] = String(s).split(' | ');
  return { at: at.trim(), by: by.trim(), why: why.join(' | ').trim() };
}
// A required "reason for change" field, shown only when the page is signed.
function reasonField(fm, id = 'rf-why') {
  if (!fm.signed) return { el: null, ok: () => true, value: () => '' };
  const input = h('input', { id, placeholder: '例如：录入错误，#09 Vth 应为 0.45 V；补充漏记的退火时间' });
  return {
    el: h('div', { class: 'reason-field' }, h('label', { for: id }, '修改原因（本页已签名，必填）'), input),
    ok: () => { if (input.value.trim()) return true; toast('本页已签名，请写明修改原因。'); input.focus(); return false; },
    value: () => input.value.trim(),
  };
}
const saveError = (e) => (e instanceof ConflictError ? '这一页刚在别的设备上改过。刷新页面后再试。' : e instanceof NetworkError ? '离线：已存在本机，联网后自动同步。' : `没有保存：${e.message}`);

// Change a page without opening the editor (results, photos, follow-ups).
// mutate({fm, body}) returns the new {fm, body} and optional attachments [{name, blob}].
async function updatePage(vol, num, mutate, message, reason = '') {
  const pending = lib.pendingFor(vol, num);
  const { fm, body } = parseFrontMatter(await lib.readPage(vol, num));
  const next = await mutate({ fm: structuredClone(fm), body });
  if (fm.signed) next.fm.amended = [...(next.fm.amended || []), amendEntry(reason || message)];
  // Redraw once the dialog that started this has closed.
  setTimeout(function again() { if (document.querySelector('.modal-root')) setTimeout(again, 100); else route({ quiet: true }); }, 300);
  return lib.savePage({
    id: pending?.id, vol, num, isNew: !!pending?.isNew, message,
    baseSha: pending ? (pending.baseSha ?? null) : (lib.tree.get(pagePath(vol, num)) || null),
    fm: next.fm, body: next.body, attachments: next.attachments || [], removed: [],
  });
}

// Panel under the page header: SOP, reagents, data location, follow-ups.
async function expPanel(fm, vol, num, { forPrint = false } = {}) {
  if (!fm.id && !fm.protocol && !fm.data && !(fm.followups || []).length) return null;
  const proto = fm.protocol ? await loadProtocol(lib, fm.protocol).catch(() => null) : null;
  const panel = h('section', { class: 'exp-panel' });
  if (fm.protocol) {
    const body = h('div', { class: 'prose sop-body' });
    const det = h('details', { class: 'sop' },
      h('summary', null, h('span', { class: 'lbl' }, '标准步骤'), ' ',
        h('a', { href: `#/lib/protocols/${encodeURIComponent(fm.protocol)}` }, fm.protocol),
        proto ? ` · ${proto.title}${proto.version ? `（${proto.version}）` : ''}` : h('span', { class: 'warn' }, ' 步骤库里没有这个编号')),
      body,
      proto?.source ? h('p', { class: 'muted small' }, '原始文件：', h('code', null, proto.source)) : null);
    det.addEventListener('toggle', () => {
      if (det.open && proto && !body.dataset.done) { body.dataset.done = '1'; renderInto(body, proto.body, pageCtx(vol, num)); }
    });
    panel.append(det);
  }
  if (forPrint && !proto && !fm.data) return null;
  if (fm.data && !forPrint) panel.append(h('div', { class: 'lbl-line' }, h('span', { class: 'lbl' }, '原始数据'), h('code', { class: 'path' }, fm.data)));
  const fus = forPrint ? [] : (fm.followups || []).map(parseFollowup).filter(Boolean);
  if (fus.length) {
    panel.append(h('div', { class: 'lbl-line' }, h('span', { class: 'lbl' }, '提醒')),
      h('ul', { class: 'followups' }, fus.map((f, i) => {
        const d = daysFrom(f.date);
        return h('li', { class: f.done ? 'done' : d < 0 ? 'late' : d === 0 ? 'today' : null },
          h('button', { class: 'btn small ghost no-print', type: 'button', title: f.done ? '标为未完成' : '标为已完成', onclick: () => toggleFollowup(vol, num, i) }, f.done ? '✓' : '○'),
          h('span', { class: 'l-date' }, f.date), ' ', f.text);
      })));
  }
  return panel;
}

async function toggleFollowup(vol, num, index) {
  try {
    await updatePage(vol, num, ({ fm, body }) => {
      const list = (fm.followups || []).map(parseFollowup);
      list[index].done = !list[index].done;
      fm.followups = list.filter(Boolean).map(formatFollowup);
      return { fm, body };
    }, `Follow-up on p. ${num}`, '更新复测提醒的完成状态');
    toast('提醒已更新。');
  } catch (e) { toast(saveError(e)); }
}

// Rows of a table on the clipboard (spreadsheet cells, or a table copied from Word / a web page), else null.
function clipTable(e) {
  const text = e.clipboardData?.getData('text/plain') || '';
  if (/\t/.test(text)) { const rows = parseTSV(text); if (rows.length && (rows.length > 1 || rows[0].length > 1)) return rows; }
  const html = e.clipboardData?.getData('text/html') || '';
  if (/<table/i.test(html)) {
    const table = new DOMParser().parseFromString(html, 'text/html').querySelector('table');
    const rows = [...(table?.rows || [])].map((tr) => [...tr.cells].map((td) => td.innerText?.trim() ?? td.textContent.trim()));
    const width = Math.max(0, ...rows.map((r) => r.length));
    const out = rows.map((r) => [...r, ...Array(width - r.length).fill('')]).filter((r) => r.some(Boolean));
    if (out.length && (out.length > 1 || out[0].length > 1)) return out;
  }
  return null;
}

// ----- sample table editor: copy results from the paper card into the page -----
async function openSamplesEditor(vol, num) {
  const { fm, body } = parseFrontMatter(await lib.readPage(vol, num));
  const t = readSamples(body) || samplesTemplate([1], [], []);
  const grid = h('div', { class: 'grid-wrap' });
  const draw = () => {
    grid.replaceChildren(h('table', { class: 'grid' },
      h('thead', null, h('tr', null, t.cols.map((c, j) => h('th', { class: isResultCol(c) ? 'res' : null, title: isResultCol(c) ? '结果列' : '条件列' },
        h('input', { value: colLabel(c), 'aria-label': `第 ${j + 1} 列名`, oninput: (e) => { t.cols[j] = isResultCol(c) ? `结果: ${e.target.value}` : e.target.value; } }))), h('th'))),
      h('tbody', null, t.rows.map((r, i) => h('tr', null,
        r.map((v, j) => h('td', { class: isResultCol(t.cols[j]) ? 'res' : null }, h('input', {
          value: v, 'aria-label': `${r[0]} ${colLabel(t.cols[j])}`,
          oninput: (e) => { r[j] = e.target.value; },
          onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); grid.querySelectorAll('tbody tr')[i + 1]?.children[j]?.querySelector('input')?.focus(); } },
        }))),
        h('td', null, h('button', { class: 'btn icon small ghost', type: 'button', 'aria-label': '删除这一行', onclick: () => { t.rows.splice(i, 1); draw(); } }, icon('close', 16))))))));
  };
  draw();
  // Paste a block of spreadsheet cells: it fills the grid from the cell you are in, like Excel,
  // adding rows and columns as needed. A header row lands in the column names.
  grid.addEventListener('paste', (e) => {
    const input = e.target.closest('input'); if (!input) return;
    let rows = clipTable(e); if (!rows) return;
    e.preventDefault();
    const inHead = !!input.closest('thead');
    const j0 = [...input.closest('tr').children].indexOf(input.closest('th, td'));
    const i0 = inHead ? 0 : [...grid.querySelectorAll('tbody tr')].indexOf(input.closest('tr'));
    const head = inHead || looksLikeHeader(rows) ? rows.shift() : null;
    const width = Math.max(head?.length || 0, ...rows.map((r) => r.length));
    const nums = () => t.rows.map((r) => parseInt(String(r[0]).replace(/\D/g, ''), 10) || 0);
    // Columns past the right edge go before 备注, as conditions or results by their names.
    for (let k = 0; k < width; k++) {
      const j = j0 + k;
      if (j < t.cols.length && !(t.cols[j] === '备注' && head && head[k] && head[k] !== '备注')) continue;
      const name = head?.[k] || `列${j + 1}`;
      t.cols.splice(j, 0, RESULT_HINT.test(name) ? `结果: ${name}` : name);
      for (const r of t.rows) r.splice(j, 0, '');
    }
    if (head) head.forEach((v, k) => { if (v && j0 + k > 0) t.cols[j0 + k] = isResultCol(t.cols[j0 + k]) || RESULT_HINT.test(v) ? `结果: ${v}` : v; });
    rows.forEach((r, k) => {
      while (t.rows.length <= i0 + k) t.rows.push(t.cols.map((_, j) => (j === 0 ? sampleNo(Math.max(0, ...nums()) + 1) : '')));
      r.forEach((v, m) => { t.rows[i0 + k][j0 + m] = j0 + m === 0 ? sampleNo(v) : v; });
    });
    draw();
    toast(`已粘贴 ${rows.length} 行 × ${width} 列${head ? '，第一行作为列名' : ''}。`);
  });
  const addRow = () => {
    const nums = t.rows.map((r) => parseInt(String(r[0]).replace(/\D/g, ''), 10) || 0);
    t.rows.push(t.cols.map((_, j) => (j === 0 ? sampleNo(Math.max(0, ...nums) + 1) : ''))); draw();
  };
  const addCol = (result) => {
    const name = window.prompt(result ? '结果列名称（含单位，例如 gm_max (mS)）' : '条件列名称（含单位，例如 GOPS (wt%)）');
    if (!name) return;
    const at = result ? t.cols.length - (t.cols[t.cols.length - 1] === '备注' ? 1 : 0) : Math.max(1, t.cols.findIndex(isResultCol) === -1 ? t.cols.length - 1 : t.cols.findIndex(isResultCol));
    t.cols.splice(at, 0, result ? `结果: ${name}` : name);
    for (const r of t.rows) r.splice(at, 0, '');
    draw();
  };
  const why = reasonField(fm, 'se-why');
  modal({
    title: `录入条件与结果 · ${fm.id || `p. ${num}`}`, wide: true,
    body: h('div', null,
      h('p', { class: 'muted' }, '按纸质记录卡逐行录入，或在 Excel / WPS 里选中一块单元格 ⌘C，点一个格子 ⌘V 整块粘贴（带表头会自动成为列名）。Enter 跳到下一行同一列。绿色列是结果，Keithley 数据同步时会自动填入空着的结果格。'),
      grid, why.el,
      h('div', { class: 'row-actions' },
        h('button', { class: 'btn small', type: 'button', onclick: addRow }, icon('plus', 16), '加一行'),
        h('button', { class: 'btn small', type: 'button', onclick: () => addCol(false) }, '加条件列'),
        h('button', { class: 'btn small', type: 'button', onclick: () => addCol(true) }, '加结果列'))),
    buttons: [{ label: '取消' }, {
      label: '保存', primary: true,
      run: async () => {
        if (!why.ok()) return false;
        t.rows = t.rows.filter((r) => r.some((v) => String(v).trim()));
        try {
          await updatePage(vol, num, ({ fm: f, body: b }) => ({ fm: f, body: writeSamples(b, t) }), `Results for ${fm.id || `p. ${num}`}`, why.value());
          toast(fm.signed ? '已保存为修订（原版本保留在历史中）。' : '已保存。');
        } catch (e) { toast(saveError(e)); return false; }
      },
    }],
  });
}

// ----- operation steps: what, how much, into which container, under which conditions -----
// ----- key resources: pick reagents / solutions from the libraries, say which bottle and how much -----
// From the page editor, `text` is the draft being edited and `onInsert` takes the rows instead of saving the page.
async function openMaterials(vol, num, { text = null, onInsert = null, reagents = [] } = {}) {
  const { fm, body } = text != null ? { fm: { reagents }, body: text } : parseFrontMatter(await lib.readPage(vol, num));
  const [rs, ss] = await Promise.all([loadReagents(lib).catch(() => []), loadSolutions(lib).catch(() => [])]);
  const lib2 = { r: rs, s: ss };
  const all = new Map([...rs, ...ss].map((x) => [x.id, x]));
  const list = (readMaterials(body) || (fm.reagents || []).map((id) => ({ id }))).map((m) => {
    const known = MATERIAL_FROM.find((f) => (m.from || '').startsWith(f));
    return { ...m, kind: known || (m.from ? '其他' : (String(m.id).startsWith('S-') ? '母液' : '原瓶')), bottle: known ? (m.from || '').slice(known.length).trim() : (m.from || '') };
  });
  let tab = 'r';
  const q = h('input', { type: 'search', id: 'mt-q', placeholder: '搜索：名称、英文名、CAS、编号、存放位置', autocomplete: 'off' });
  const tabs = h('div', { class: 'seg mt-tabs' });
  const hits = h('div', { class: 'mt-hits' });
  const chosen = h('div', { class: 'mt-chosen' });
  const label = (x) => [x.name, x.name_en && x.name_en !== x.name ? x.name_en : '', x.cas, x.spec || x.conc, x.vendor, x.location].filter(Boolean).join(' · ');
  const drawTabs = () => tabs.replaceChildren(...[['r', `试剂库 ${rs.length}`], ['s', `溶液库 ${ss.length}`]].map(([k, l]) => h('button', { type: 'button', class: `seg-btn${tab === k ? ' on' : ''}`, onclick: () => { tab = k; drawTabs(); drawHits(); } }, l)));
  const drawHits = () => {
    const t = q.value.trim().toLowerCase();
    const src = lib2[tab].filter((x) => !['用完', '废弃'].includes(x.status));
    const found = (t ? src.filter((x) => `${x.id} ${label(x)} ${x.lot || ''} ${x.recipe || ''}`.toLowerCase().includes(t)) : tab === 's' ? src : []).slice(0, 40);
    hits.replaceChildren(...(found.length ? found.map((x) => h('button', { type: 'button', class: 'mt-hit', disabled: list.some((m) => m.id === x.id),
      onclick: () => { list.push({ id: x.id, kind: tab === 's' ? '母液' : '原瓶', bottle: '', amount: '', note: '' }); drawHits(); drawChosen(); } },
      h('span', { class: 'xid-tag' }, x.id), ' ', h('b', null, x.name), h('span', { class: 'muted' }, ` ${label(x).slice(x.name.length)}`)))
      : [h('p', { class: 'muted' }, t ? '没有找到。换个关键词，或试试 CAS 号。' : tab === 'r' ? `输入关键词搜索 ${rs.length} 种试剂。` : '溶液库还是空的。')]));
  };
  const drawChosen = () => chosen.replaceChildren(list.length ? h('table', { class: 'grid mt-grid' },
    h('thead', null, h('tr', null, ['编号', '名称', '来源', '瓶号 / 说明', '本次用量', ''].map((c) => h('th', null, c)))),
    h('tbody', null, list.map((m, i) => h('tr', null,
      h('td', { class: 'mono' }, m.id),
      h('td', null, all.get(m.id)?.name || h('span', { class: 'warn' }, '库里没有')),
      h('td', null, h('select', { onchange: (e) => { m.kind = e.target.value; } }, MATERIAL_FROM.map((f) => h('option', { selected: m.kind === f }, f)))),
      h('td', null, h('input', { value: m.bottle || '', placeholder: '例如 #2、2026-11-03 分装', oninput: (e) => { m.bottle = e.target.value; } })),
      h('td', null, h('input', { value: m.amount || '', placeholder: '例如 20 mg、100 μL', oninput: (e) => { m.amount = e.target.value; } })),
      h('td', null, h('button', { class: 'btn icon small ghost', type: 'button', 'aria-label': '移除', onclick: () => { list.splice(i, 1); drawChosen(); drawHits(); } }, icon('close', 16)))))))
    : h('p', { class: 'muted' }, '还没有选择。在上面搜索后点一下即可加入。'));
  q.addEventListener('input', drawHits);
  drawTabs(); drawHits(); drawChosen();
  const why = reasonField(fm, 'mt-why');
  modal({
    title: `试剂 · ${fm.id || `p. ${num}`}`, wide: true,
    body: h('div', { class: 'form' },
      tabs, q, hits,
      h('span', { class: 'label' }, '本次使用'), chosen,
      h('p', { class: 'muted' }, '保存后，页面最下方“试剂”一节会列出编号、名称、CAS、规格、厂商、批号/到货、来源和用量。用量留空时，自动取“操作步骤”里写的量。'),
      why.el),
    buttons: [{ label: '取消' }, {
      label: '保存', primary: true,
      run: async () => {
        if (!why.ok()) return false;
        const rows = list.map((m) => ({ id: m.id, from: [m.kind, m.bottle].filter(Boolean).join(' '), amount: m.amount, note: m.note }));
        if (onInsert) { onInsert(rows); return; }
        try {
          await updatePage(vol, num, ({ fm: f, body: b }) => {
            if (rows.length) f.reagents = rows.map((m) => m.id); else delete f.reagents;
            return { fm: f, body: writeMaterials(b, rows) };
          }, `Resources for ${fm.id || `p. ${num}`}`, why.value() || '更新试剂');
          toast('已保存。');
        } catch (e) { toast(saveError(e)); return false; }
      },
    }],
  });
  setTimeout(() => q.focus(), 50);
}

async function openStepsEditor(vol, num) {
  const { fm, body } = parseFrontMatter(await lib.readPage(vol, num));
  const steps = readSteps(body) || [];
  if (!steps.length) steps.push(Object.fromEntries(STEP_FIELDS.map(([k]) => [k, ''])));
  const reagents = [...await loadReagents(lib).catch(() => []), ...(await loadSolutions(lib).catch(() => [])).filter((x) => !['用完', '废弃'].includes(x.status)).map((x) => ({ ...x, spec: x.conc, vendor: '自配溶液' }))];
  const used = (k) => steps.map((x) => x[k]).filter(Boolean);
  const lists = h('div', { hidden: true },
    h('datalist', { id: 'st-ops' }, [...new Set([...STEP_OPS, ...used('op')])].map((v) => h('option', { value: v }))),
    h('datalist', { id: 'st-what' }, reagents.map((r) => h('option', { value: `${r.name} ${r.id}` }, [r.spec, r.vendor].filter(Boolean).join(' · ')))),
    h('datalist', { id: 'st-into' }, [...new Set([...(lib.notebook.containers || []), ...STEP_CONTAINERS, ...used('into')])].map((v) => h('option', { value: v }))));
  const showMore = h('input', { type: 'checkbox', id: 'st-more', checked: steps.some((x) => x.cond || x.note) });
  const PH = { op: '移取', amount: '10 mL', what: 'DI 水 / 选试剂', into: '20 mL 玻璃瓶', cond: '室温，500 rpm，30 min', note: '沿瓶壁缓慢滴加，避免气泡' };
  const grid = h('div', { class: 'grid-wrap' });
  const draw = () => {
    const fields = STEP_FIELDS.filter(([k]) => showMore.checked || !['cond', 'note'].includes(k));
    grid.replaceChildren(h('table', { class: 'grid steps-grid' },
      h('thead', null, h('tr', null, h('th', { class: 'no' }, '#'), fields.map(([k, l]) => h('th', { class: `c-${k}` }, l)), h('th'))),
      h('tbody', null, steps.map((st, i) => h('tr', null,
        h('th', { class: 'no' }, i + 1),
        fields.map(([k, l]) => h('td', { class: `c-${k}` }, h('input', {
          value: st[k] || '', placeholder: i === 0 ? PH[k] : '', 'aria-label': `第 ${i + 1} 步 ${l}`,
          list: { op: 'st-ops', what: 'st-what', into: 'st-into' }[k] || null,
          oninput: (e) => { st[k] = e.target.value; },
          onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); if (i === steps.length - 1) addRow(); grid.querySelectorAll('tbody tr')[i + 1]?.querySelector(`td.c-${k} input`)?.focus(); } },
        }))),
        h('td', { class: 'row-tools' },
          h('button', { class: 'btn icon small ghost', type: 'button', 'aria-label': '上移', title: '上移', disabled: i === 0, onclick: () => { [steps[i - 1], steps[i]] = [steps[i], steps[i - 1]]; draw(); } }, '↑'),
          h('button', { class: 'btn icon small ghost', type: 'button', 'aria-label': '删除这一步', title: '删除', onclick: () => { steps.splice(i, 1); draw(); } }, icon('close', 16))))))));
  };
  const addRow = () => { steps.push(Object.fromEntries(STEP_FIELDS.map(([k]) => [k, '']))); draw(); };
  showMore.addEventListener('change', draw);
  draw();
  const why = reasonField(fm, 'st-why');
  modal({
    title: `操作步骤 · ${fm.id || `p. ${num}`}`, wide: true,
    body: h('div', null,
      h('p', { class: 'muted' }, '一行一步。只有“操作”必填，其余可留空。物质可从试剂库选（带上试剂编号便于溯源），容器可从下拉选或自己写。页面上用量为蓝色、试剂为棕色、容器加框显示。'),
      lists,
      h('label', { class: 'check', for: 'st-more' }, showMore, ' 显示细节列（条件、具体操作细节）'),
      grid,
      h('div', { class: 'row-actions' }, h('button', { class: 'btn small', type: 'button', onclick: addRow }, icon('plus', 16), '加一步')),
      why.el),
    buttons: [{ label: '取消' }, {
      label: '保存', primary: true,
      run: async () => {
        if (!why.ok()) return false;
        const keep = steps.filter((x) => STEP_FIELDS.some(([k]) => String(x[k] || '').trim()));
        try {
          await updatePage(vol, num, ({ fm: f, body: b }) => ({ fm: f, body: writeSteps(b, keep) }), `Steps for ${fm.id || `p. ${num}`}`, why.value());
          toast(fm.signed ? '已保存为修订（原版本保留在历史中）。' : '已保存。');
        } catch (e) { toast(saveError(e)); return false; }
      },
    }],
  });
}

// Quote a section of another experiment instead of copying it: "same steps as 20261029-OECT-01".
// onInsert(block) puts it into the editor; without it the block replaces (or adds) that section of the page.
function openQuoteDialog(curVol, curNum, onInsert) {
  openPagePicker(curVol, async (ref) => {
    const r = parseRef(ref, curVol);
    const target = r && lib.page(r.vol, r.num);
    if (!target) return;
    const { body } = parseFrontMatter(await lib.readPage(r.vol, r.num));
    const hs = headings(body).filter((x) => x.level <= 3);
    const sec = h('select', { id: 'q-sec' }, h('option', { value: '' }, '整页'), hs.map((x) => h('option', { value: x.text, selected: x.text === '操作步骤' }, `${'　'.repeat(x.level - 2 < 0 ? 0 : x.level - 2)}${x.text}`)));
    const note = h('input', { id: 'q-note', value: '本次完全按照此步骤操作，未作任何改动。' });
    const ownPage = !onInsert && curNum ? parseFrontMatter(await lib.readPage(curVol, curNum)) : { fm: {}, body: '' };
    const own = ownPage.body;
    const why = reasonField(ownPage.fm, 'q-why');
    const replace = h('input', { type: 'checkbox', id: 'q-rep', checked: true });
    const repRow = h('label', { class: 'check', for: 'q-rep' }, replace, h('span', { class: 'q-rep-text' }));
    const upd = () => { const has = sec.value && headings(own).some((x) => x.text === sec.value); repRow.hidden = !onInsert && has ? false : true; repRow.querySelector('.q-rep-text').textContent = ` 用引用替换本页“${sec.value}”一节现有的内容`; };
    sec.addEventListener('change', upd); upd();
    modal({
      title: `引用 ${target.xid || target.title}`,
      body: h('div', { class: 'form' },
        h('p', { class: 'muted' }, `${target.date || ''}　${target.title}`),
        h('label', { for: 'q-sec' }, '引用哪一节'), sec,
        h('label', { for: 'q-note' }, '说明（可改，例如：仅退火温度改为 150 °C）'), note,
        onInsert ? null : repRow, why.el,
        h('p', { class: 'muted' }, '引用不复制内容：页面上显示原页那一节的实时内容，加框、换字体，并链接回原实验。')),
      buttons: [{ label: '取消' }, {
        label: '引用', primary: true,
        run: async () => {
          const block = quoteBlock(target.xid || `${target.vol}/${target.num}`, sec.value, note.value.trim());
          if (onInsert) { onInsert(block); return; }
          if (!why.ok()) return false;
          try {
            await updatePage(curVol, curNum, ({ fm: f, body: b }) => ({ fm: f, body: sec.value && (replace.checked || !headings(b).some((x) => x.text === sec.value)) ? replaceSection(b, sec.value, block) : `${b.trimEnd()}\n\n${block}\n` }), `Quote ${target.xid || ref}`, why.value() || `引用 ${target.xid || ref}`);
            toast('已引用。');
          } catch (e) { toast(saveError(e)); return false; }
        },
      }],
    });
  });
}

// ===================== thinking notebook: hypotheses and evidence chains =====================
const hypBlock = (id, note) => `\`\`\`hypothesis\n${id}\n${note || ''}`.trimEnd() + '\n```';
async function saveHyp(hyp, message, files = []) {
  hyp.updated = nowISO();
  return lib.commit(message, async () => ({ changes: [{ path: hypPath(hyp.id), data: `${JSON.stringify(hyp, null, 1)}\n` }, ...files] }));
}
const cloneHyp = async (id) => structuredClone(await loadHypothesis(lib, id));
const relatedPages = (id) => search(lib.allPages(), id).map((r) => r.page)
  .sort((a, b) => String(a.date).localeCompare(String(b.date)));

function thinkCover() {
  const n = hypIds(lib).length;
  return h('div', { class: 'book' },
    h('a', { class: 'cover think-cover', href: '#/think', 'aria-label': '思维笔记本' },
      h('span', { class: 'think-label' }, h('span', { class: 'tl-kind' }, 'HYPOTHESES & EVIDENCE'), h('span', { class: 'tl-title' }, '思维笔记本'), h('span', { class: 'tl-sub' }, '假设 · 证据链')),
      h('span', { class: 'cover-band' })),
    h('a', { class: 'book-cap', href: '#/think' }, h('span', { class: 'bc-title' }, '思维笔记本'), h('span', { class: 'bc-meta' }, n ? `${n} 条假设` : '记录假设与证据链')));
}

async function viewThinking() {
  const hyps = await loadHypotheses(lib);
  let filter = '全部';
  const grid = h('div', { class: 'hyp-grid' });
  const chips = h('div', { class: 'hyp-filter' });
  const draw = () => {
    chips.replaceChildren(...['全部', ...HYP_STATUS].map((s) => h('button', { type: 'button', class: `chip-btn${filter === s ? ' on' : ''}`, onclick: () => { filter = s; draw(); } },
      s, h('span', null, s === '全部' ? hyps.length : hyps.filter((x) => x.status === s).length))));
    const list = hyps.filter((x) => filter === '全部' || x.status === filter).sort((a, b) => String(b.updated || b.created).localeCompare(String(a.updated || a.created)));
    grid.replaceChildren(...(list.length ? list.map((x) => {
      const n = evidenceCounts(x);
      const tot = (x.evidence || []).length || 1;
      return h('a', { class: 'tile hyp-card', href: `#/think/${x.id}` },
        h('div', { class: 'hc-top' }, h('span', { class: 'hc-id' }, x.id), hypBadge(x)),
        h('h3', null, x.title),
        x.description ? h('p', { class: 'hc-desc' }, x.description.replace(/[#*>`]/g, '').slice(0, 90)) : null,
        h('div', { class: 'ev-bar', title: `支持 ${n['支持']} · 反对 ${n['反对']} · 待定 ${n['待定']}` },
          EV_KIND.map((k) => h('span', { class: `k-${k}`, style: { width: `${(n[k] / tot) * 100}%` } }))),
        h('div', { class: 'hc-foot' }, `支持 ${n['支持']} · 反对 ${n['反对']} · 待定 ${n['待定']}`, h('span', null, `${relatedPages(x.id).length} 个实验 · ${fmtDate(x.updated || x.created)}`)));
    }) : [h('div', { class: 'tile empty-tile' }, h('p', null, filter === '全部' ? '还没有假设。点右上角“新建假设”，例如：氯仿挥发引起气爆。' : `没有“${filter}”状态的假设。`))]));
  };
  draw();
  return h('div', { class: 'view think' },
    topbar({ back: '#/', backLabel: '首页', title: '思维笔记本', sub: '假设 · 证据链', actions: [
      h('button', { class: 'btn primary', type: 'button', onclick: () => editHypothesis(null) }, icon('plus', 18), h('span', null, '新建假设'))] }),
    demoBanner(),
    h('div', { class: 'think-wrap' },
      h('header', { class: 'hero think-hero' }, h('p', { class: 'hero-eyebrow' }, 'HYPOTHESES & EVIDENCE'), h('h1', { class: 'hero-title' }, '思维笔记本'),
        h('p', { class: 'think-lead' }, '每条假设一张卡：写下假设和“如果成立应看到什么”，再把每一次实验、观察、照片、文献作为证据挂上去，标明支持还是反对。实验页的“目的”可以引用假设，“结论”可以一键作为证据回到这里。')),
      thinkTabs('hyp'), chips, grid));
}
const thinkTabs = (on) => h('nav', { class: 'think-tabs' },
  h('a', { href: '#/think', class: on === 'hyp' ? 'on' : null }, '假设与证据链'),
  h('a', { href: '#/think/topics', class: on === 'topics' ? 'on' : null }, '潜在研究课题'));

function editHypothesis(hyp) {
  const isNew = !hyp;
  const title = h('input', { id: 'hy-title', value: hyp?.title || '', placeholder: '例如：气爆由氯仿挥发、瓶内压力升高引起' });
  const desc = h('textarea', { id: 'hy-desc', rows: 4, placeholder: '背景、现象、为什么这么想…（支持 Markdown）' }, hyp?.description || '');
  const preds = h('textarea', { id: 'hy-pred', rows: 3, placeholder: '一行一条，例如：\n换成低挥发溶剂后不再气爆\n加热时瓶内压力明显升高' }, (hyp?.predictions || []).join('\n'));
  const status = h('select', { id: 'hy-status' }, HYP_STATUS.map((x) => h('option', { selected: (hyp?.status || '提出') === x }, x)));
  const conf = h('select', { id: 'hy-conf' }, HYP_CONF.map((x) => h('option', { selected: (hyp?.confidence || '低') === x }, x)));
  modal({
    title: isNew ? '新建假设' : `编辑 ${hyp.id}`, wide: true,
    body: h('div', { class: 'form' },
      h('label', { for: 'hy-title' }, '假设（一句话）'), title,
      h('label', { for: 'hy-desc' }, '描述'), desc,
      h('label', { for: 'hy-pred' }, '预测：如果成立，应该看到（一行一条）'), preds,
      isNew ? h('div', { class: 'pair' }, h('div', null, h('label', { for: 'hy-status' }, '状态'), status), h('div', null, h('label', { for: 'hy-conf' }, '可信度'), conf)) : null),
    buttons: [{ label: '取消' }, {
      label: '保存', primary: true,
      run: async () => {
        if (!title.value.trim()) { toast('写一句假设。'); return false; }
        const x = isNew ? { id: nextHypId(hypIds(lib)), status: status.value, confidence: conf.value, evidence: [], history: [{ at: nowISO(), status: status.value, confidence: conf.value, why: '提出' }], created: nowISO() } : await cloneHyp(hyp.id);
        x.title = title.value.trim(); x.description = desc.value.trim();
        x.predictions = preds.value.split('\n').map((l) => l.trim()).filter(Boolean);
        try { await saveHyp(x, `${isNew ? 'Add' : 'Edit'} hypothesis ${x.id}`); toast(`${x.id} 已保存。`); location.hash = `#/think/${x.id}`; if (!isNew) route({ quiet: true }); } catch (e) { toast(saveError(e)); return false; }
      },
    }],
  });
}

// Status and confidence change only with a reason, so the history shows how the thinking moved.
// 可信度 低 / 中 / 高: one click, no reason needed; the change still goes into 思路变化.
function confSwitch(hyp) {
  return h('div', { class: 'seg conf-seg', role: 'radiogroup', 'aria-label': '可信度' }, h('span', { class: 'seg-lbl' }, '可信度'),
    HYP_CONF.map((c) => h('button', { type: 'button', role: 'radio', 'aria-checked': String(hyp.confidence === c), class: `seg-btn${hyp.confidence === c ? ' on' : ''}`,
      onclick: async () => {
        if (hyp.confidence === c) return;
        const x = await cloneHyp(hyp.id);
        x.confidence = c;
        x.history = [...(x.history || []), { at: nowISO(), status: x.status, confidence: c, why: '' }];
        try { await saveHyp(x, `${x.id}: confidence ${c}`); toast(`可信度：${c}`); route({ quiet: true }); } catch (e) { toast(saveError(e)); }
      } }, c)));
}
function changeHypState(hyp) {
  const status = h('select', { id: 'hs-status' }, HYP_STATUS.map((x) => h('option', { selected: hyp.status === x }, x)));
  const why = h('input', { id: 'hs-why', placeholder: '例如：证据 3（20261105-OECT-01）显示换溶剂后不再气爆' });
  modal({
    title: `调整 ${hyp.id} 的状态`,
    body: h('div', { class: 'form' },
      h('label', { for: 'hs-status' }, '状态'), status,
      h('label', { for: 'hs-why' }, '依据（可不填）'), why),
    buttons: [{ label: '取消' }, {
      label: '保存', primary: true,
      run: async () => {
        const x = await cloneHyp(hyp.id);
        x.status = status.value;
        x.history = [...(x.history || []), { at: nowISO(), status: x.status, confidence: x.confidence, why: why.value.trim() }];
        try { await saveHyp(x, `${x.id}: ${x.status} / ${x.confidence}`); route({ quiet: true }); } catch (e) { toast(saveError(e)); return false; }
      },
    }],
  });
}

// Add or edit one piece of evidence: kind, date, what was seen, where it came from, photos.
function editEvidence(hyp, ev, preset = {}) {
  const isNew = !ev;
  const e = ev ? { ...ev } : { kind: preset.kind || '支持', date: preset.date || todayISO(), text: preset.text || '', src: preset.src || null, photos: [] };
  const kind = h('div', { class: 'seg', role: 'radiogroup' });
  const drawKind = () => kind.replaceChildren(...EV_KIND.map((k) => h('button', { type: 'button', role: 'radio', 'aria-checked': String(e.kind === k), class: `seg-btn k-${k}${e.kind === k ? ' on' : ''}`, onclick: () => { e.kind = k; drawKind(); } }, k)));
  drawKind();
  const date = h('input', { id: 'ev-date', type: 'date', value: e.date || '' });
  const text = h('textarea', { id: 'ev-text', rows: 3, placeholder: '看到了什么、量到了什么，例如：打开瓶盖时有明显泄压声，瓶壁温度 38 °C' }, e.text || '');
  const srcOut = h('span', { class: 'ev-src-out' });
  const url = h('input', { id: 'ev-url', placeholder: '或文献 DOI / 链接', value: e.src?.url || '' });
  const drawSrc = () => srcOut.replaceChildren(e.src?.xid || e.src?.num ? h('span', { class: 'xid-tag' }, e.src.xid || `p. ${e.src.num}`) : h('span', { class: 'muted' }, '未关联实验'),
    e.src?.vol ? h('button', { class: 'btn small ghost', type: 'button', onclick: () => { e.src = null; drawSrc(); } }, '清除') : null);
  drawSrc();
  const pick = h('button', { class: 'btn small', type: 'button', onclick: () => openPagePicker('', (ref) => { const r = parseRef(ref, ''); const p = r && lib.page(r.vol, r.num); if (p) { e.src = { xid: p.xid || '', vol: p.vol, num: p.num }; if (!date.value || isNew) date.value = p.date || date.value; drawSrc(); } }) }, '选择实验…');
  const files = h('input', { type: 'file', accept: 'image/*', multiple: true, id: 'ev-photos' });
  modal({
    title: isNew ? `为 ${hyp.id} 添加证据` : `编辑 ${hyp.id} · 证据 ${ev.id.slice(1)}`, wide: true,
    body: h('div', { class: 'form' },
      h('span', { class: 'label' }, '这条证据'), kind,
      h('label', { for: 'ev-date' }, '日期'), date,
      h('label', { for: 'ev-text' }, '内容'), text,
      h('span', { class: 'label' }, '来源'), h('div', { class: 'row-actions' }, srcOut, pick), url,
      h('label', { for: 'ev-photos' }, `照片（可多张）${(e.photos || []).length ? `，已有 ${e.photos.length} 张` : ''}`), files),
    buttons: [{ label: '取消' }, {
      label: '保存', primary: true,
      run: async () => {
        if (!text.value.trim()) { toast('写一下证据内容。'); return false; }
        const x = await cloneHyp(hyp.id);
        const id = ev ? ev.id : nextEvidenceId(x);
        const adds = [];
        let k = (e.photos || []).length;
        for (const f0 of files.files) {
          const f = await prepareFile(f0);
          const ext = (f.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
          const path = `thinking/attachments/${x.id}/${id}-${++k}.${ext}`;
          adds.push({ path, data: f }); e.photos = [...(e.photos || []), path];
        }
        const item = { id, kind: e.kind, date: date.value, text: text.value.trim(), photos: e.photos || [], ...(e.src?.vol ? { src: e.src } : url.value.trim() ? { src: { url: url.value.trim() } } : {}) };
        x.evidence = ev ? x.evidence.map((y) => (y.id === id ? item : y)) : [...(x.evidence || []), item];
        try { await saveHyp(x, `${x.id}: evidence ${id}`, adds); toast(`证据 ${id.slice(1)} 已保存。`); route({ quiet: true }); } catch (err) { toast(saveError(err)); return false; }
      },
    }],
  });
}

async function viewHypothesis(id) {
  const hyp = await loadHypothesis(lib, id).catch(() => null);
  if (!hyp) return viewMissing(`思维笔记本里没有 ${id}。`);
  const n = evidenceCounts(hyp);
  const urls = view.urls;
  const photo = (path) => {
    const img = h('img', { class: 'ev-photo', alt: path.split('/').pop() });
    lib.readBlob(path).then((b) => { const u = URL.createObjectURL(b); urls.push(u); img.src = u; img.onclick = () => window.open(u, '_blank'); }).catch(() => img.remove());
    return img;
  };
  const desc = h('div', { class: 'prose hyp-desc' });
  if (hyp.description) renderInto(desc, hyp.description, { lib, vol: null, num: null, urls, resolveBlob: (name) => lib.readBlob(name.replace(/^\//, '')) });
  const rel = relatedPages(id);
  const evidence = hyp.evidence || [];
  const upd = async (f, msg) => { const x = await cloneHyp(id); f(x); try { await saveHyp(x, msg); route({ quiet: true }); } catch (e) { toast(saveError(e)); } };
  return h('div', { class: 'view think' },
    topbar({ back: '#/think', backLabel: '思维笔记本', title: hyp.id, sub: '思维笔记本', actions: [
      h('button', { class: 'btn', type: 'button', onclick: () => editHypothesis(hyp) }, icon('edit', 18), h('span', { class: 'wide-only' }, '编辑')),
      h('button', { class: 'btn primary', type: 'button', onclick: () => editEvidence(hyp, null) }, icon('plus', 18), h('span', null, '添加证据'))] }),
    demoBanner(),
    h('div', { class: 'think-wrap' },
      h('header', { class: 'hyp-hero' },
        h('p', { class: 'hero-eyebrow' }, `${hyp.id} · 提出于 ${fmtDate(hyp.created)}`),
        h('h1', { class: 'hero-title' }, hyp.title),
        h('div', { class: 'hyp-state' }, hypBadge(hyp), confSwitch(hyp), h('button', { class: 'btn small', type: 'button', onclick: () => changeHypState(hyp) }, '调整状态'))),
      h('div', { class: 'hyp-cols' },
        h('div', null,
          hyp.description ? h('section', { class: 'tile' }, h('h2', null, '描述'), desc) : null,
          h('section', { class: 'tile' }, h('h2', null, '预测', h('span', { class: 'h-sub' }, '如果成立，应该看到')),
            (hyp.predictions || []).length ? h('ol', { class: 'pred-list' }, hyp.predictions.map((p) => h('li', null, p))) : h('p', { class: 'muted' }, '还没写预测。点“编辑”添加，例如：换成低挥发溶剂后不再气爆。')),
          h('section', { class: 'tile' },
            h('div', { class: 'tile-head' }, h('div', null, h('h2', null, '证据链'), h('p', { class: 'card-sub' }, `支持 ${n['支持']} · 反对 ${n['反对']} · 待定 ${n['待定']}`)),
              h('button', { class: 'btn small add-btn', type: 'button', onclick: () => editEvidence(hyp, null) }, '添加证据')),
            evidence.length ? h('ol', { class: 'ev-chain' }, evidence.map((e) => h('li', { class: `k-${e.kind}` },
              h('div', { class: 'ev-line' }, h('b', null, `证据 ${e.id.slice(1)}`), h('span', { class: `ev-kind k-${e.kind}` }, e.kind), h('span', { class: 'ev-date' }, e.date || ''),
                h('span', { class: 'ev-tools' },
                  h('button', { class: 'btn small ghost', type: 'button', onclick: () => editEvidence(hyp, e) }, '编辑'),
                  h('button', { class: 'btn small ghost', type: 'button', onclick: async () => { if ((await choose(`删除证据 ${e.id.slice(1)}？`, 'GitHub 历史里仍可找回。', [['yes', '删除'], ['no', '取消']])) === 'yes') upd((x) => { x.evidence = x.evidence.filter((y) => y.id !== e.id); }, `${id}: remove evidence ${e.id}`); } }, '删除'))),
              h('p', { class: 'ev-text' }, e.text),
              e.src?.vol ? h('a', { class: 'ev-from', href: `#/v/${e.src.vol}/${e.src.num}` }, `来自实验 ${e.src.xid || `p. ${e.src.num}`}${lib.page(e.src.vol, e.src.num) ? ` · ${lib.page(e.src.vol, e.src.num).title}` : ''}`) : null,
              e.src?.url ? h('a', { class: 'ev-from', href: /^10\./.test(e.src.url) ? `https://doi.org/${e.src.url}` : e.src.url, target: '_blank', rel: 'noopener' }, `文献 ${e.src.url}`) : null,
              (e.photos || []).length ? h('div', { class: 'ev-photos' }, e.photos.map(photo)) : null))) : h('p', { class: 'muted' }, '还没有证据。可以在这里添加，也可以在实验页“结论”旁点“作为证据加入假设”。'))),
        h('div', null,
          h('section', { class: 'tile' }, h('h2', null, '相关实验'),
            rel.length ? h('ul', { class: 'rel-list' }, rel.map((p) => {
              const used = evidence.find((e) => e.src?.vol === p.vol && e.src?.num === p.num);
              return h('li', null, h('a', { href: `#/v/${p.vol}/${p.num}` }, h('span', { class: 'ev-date' }, fmtDate(p.date)), ' ', p.xid ? h('span', { class: 'xid-tag' }, p.xid) : null, ' ', p.title),
                used ? h('span', { class: `ev-kind k-${used.kind}` }, `证据 ${used.id.slice(1)}`) : null);
            })) : h('p', { class: 'muted' }, '还没有实验引用这条假设。在实验页 ⋯ → 引用假设。')),
          h('section', { class: 'tile' }, h('h2', null, '思路变化'),
            h('ol', { class: 'hist-list' }, [...(hyp.history || [])].reverse().map((x) => h('li', null,
              h('span', { class: 'ev-date' }, `${fmtDate(x.at)} ${String(x.at).slice(11, 16)}`), h('span', { class: `hyp-status st-${x.status}` }, x.status), h('span', { class: 'muted' }, ` 可信度 ${x.confidence}`), x.why ? h('div', null, x.why) : null))))))));
}

// ----- potential research topics: ideas not to forget, with a review rhythm -----
async function changeTopics(mutate, message) {
  return lib.commit(message, async (l) => {
    const list = l.tree.has(TOPICS_PATH) ? structuredClone(await loadTopics(l)) : [];
    mutate(list);
    return { changes: [{ path: TOPICS_PATH, data: `${JSON.stringify({ topics: list }, null, 1)}\n` }] };
  });
}
const nextTopicId = (list) => `T-${String(Math.max(0, ...list.map((t) => parseInt(String(t.id).replace(/\D/g, ''), 10) || 0)) + 1).padStart(3, '0')}`;
const reviewLabel = (t) => {
  if (!t.every || !t.next) return '不定期';
  const d = daysFrom(t.next);
  return d < 0 ? `该回顾了（逾期 ${-d} 天）` : d === 0 ? '今天回顾' : `${d} 天后回顾`;
};

function topicsStrip() {
  const box = h('section', { class: 'topics-strip' });
  loadTopics(lib).catch(() => []).then((all) => {
    const list = all.filter(activeTopic).sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || TOPIC_PRIORITY.indexOf(a.priority) - TOPIC_PRIORITY.indexOf(b.priority) || String(a.next || '9').localeCompare(String(b.next || '9')));
    const add = addBox('记下一个潜在课题，回车保存', (text) => changeTopics((l) => l.push({ id: nextTopicId(l), title: text, priority: '中', status: '想法', pinned: false, every: 14, next: addDays(todayISO(), 14), reviews: [], created: nowISO() }), 'Topic: add').then(() => route({ quiet: true })).catch((e) => toast(saveError(e))));
    box.replaceChildren(h('div', { class: 'tile topics-tile' },
      h('div', { class: 'tile-head' }, h('div', null, h('h2', null, '潜在研究课题'), h('p', { class: 'card-sub' }, list.length ? `${list.length} 个在关注 · 别忘了它们` : '值得以后做的方向，先记下来，定期回顾')),
        h('a', { class: 'more-link', href: '#/think/topics' }, '全部 ›')),
      add,
      list.length ? h('div', { class: 'topic-row' }, list.slice(0, 8).map((t) => {
        const due = t.every && t.next && daysFrom(t.next) <= 0;
        return h('a', { class: `topic-chip p-${t.priority}${due ? ' due' : ''}`, href: '#/think/topics' },
          h('span', { class: 'tc-title' }, t.pinned ? h('span', { class: 'tc-pin', html: PIN_SVG }) : null, t.title),
          h('span', { class: 'tc-meta' }, `${t.priority}优先 · ${t.status} · ${reviewLabel(t)}`));
      })) : null));
  });
  return box;
}

function editTopic(t) {
  const isNew = !t;
  const x = t ? { ...t } : { priority: '中', status: '想法', every: 14, pinned: false };
  const title = h('input', { id: 'tp-title', value: x.title || '', placeholder: '例如：唾液中 MMP-8 的 OECT 检测' });
  const why = h('textarea', { id: 'tp-why', rows: 4, placeholder: '为什么值得做：临床意义、和现有工作的关系、需要的条件…' }, x.why || '');
  const links = h('input', { id: 'tp-links', value: x.links || '', placeholder: '相关假设 / 实验 / 文献：H-0001, 20261101-OECT-01, 10.1021/…' });
  const pr = h('select', { id: 'tp-pr' }, TOPIC_PRIORITY.map((v) => h('option', { selected: x.priority === v }, v)));
  const st = h('select', { id: 'tp-st' }, TOPIC_STATUS.map((v) => h('option', { selected: x.status === v }, v)));
  const every = h('select', { id: 'tp-every' }, TOPIC_EVERY.map(([d, l]) => h('option', { value: d, selected: Number(x.every || 0) === d }, l)));
  const next = h('input', { id: 'tp-next', type: 'date', value: x.next || addDays(todayISO(), Number(x.every) || 14) });
  every.addEventListener('change', () => { if (+every.value) next.value = addDays(todayISO(), +every.value); });
  const pin = h('input', { type: 'checkbox', id: 'tp-pin', checked: !!x.pinned });
  modal({
    title: isNew ? '新的潜在课题' : `课题 ${x.id}`, wide: true,
    body: h('div', { class: 'form' },
      h('label', { for: 'tp-title' }, '课题'), title,
      h('label', { for: 'tp-why' }, '为什么值得做'), why,
      h('label', { for: 'tp-links' }, '相关'), links,
      h('div', { class: 'pair' }, h('div', null, h('label', { for: 'tp-pr' }, '优先级'), pr), h('div', null, h('label', { for: 'tp-st' }, '状态'), st)),
      h('div', { class: 'pair' }, h('div', null, h('label', { for: 'tp-every' }, '定期回顾'), every), h('div', null, h('label', { for: 'tp-next' }, '下次回顾'), next)),
      h('label', { class: 'check', for: 'tp-pin' }, pin, ' 置顶（首页一直显示在最前）')),
    buttons: [
      isNew ? null : { label: '删除', danger: true, run: async () => { if ((await choose('删除这个课题？', 'GitHub 历史里仍可找回。', [['yes', '删除'], ['no', '取消']])) !== 'yes') return false; await changeTopics((l) => l.splice(l.findIndex((y) => y.id === x.id), 1), `Topic: remove ${x.id}`); route({ quiet: true }); } },
      { label: '取消' },
      { label: '保存', primary: true, run: async () => {
        if (!title.value.trim()) { toast('写一下课题。'); return false; }
        const data = { title: title.value.trim(), why: why.value.trim(), links: links.value.trim(), priority: pr.value, status: st.value, every: +every.value, next: +every.value ? next.value : '', pinned: pin.checked, updated: nowISO() };
        try {
          await changeTopics((l) => { if (isNew) l.push({ id: nextTopicId(l), ...data, reviews: [], created: nowISO() }); else Object.assign(l.find((y) => y.id === x.id), data); }, `Topic: ${isNew ? 'add' : 'edit'} ${data.title}`);
          route({ quiet: true });
        } catch (e) { toast(saveError(e)); return false; }
      } },
    ].filter(Boolean),
  });
}

// Mark a topic as reviewed: one line of current thinking, then it is scheduled again.
async function reviewTopic(id) {
  const t = (await loadTopics(lib)).find((x) => x.id === id);
  if (!t) return;
  const note = h('textarea', { id: 'rv-note', rows: 3, placeholder: '这次想到了什么、有什么新进展或新文献（可不填）' });
  modal({
    title: `回顾：${t.title}`,
    body: h('div', { class: 'form' }, t.why ? h('p', { class: 'muted' }, t.why) : null, h('label', { for: 'rv-note' }, '这次的想法'), note,
      h('p', { class: 'muted' }, t.every ? `保存后下次回顾：${addDays(todayISO(), t.every)}` : '')),
    buttons: [{ label: '取消' }, { label: '已回顾', primary: true, run: async () => {
      try {
        await changeTopics((l) => { const y = l.find((z) => z.id === id); y.reviews = [...(y.reviews || []), { at: nowISO(), note: note.value.trim() }]; if (y.every) y.next = addDays(todayISO(), y.every); y.updated = nowISO(); }, `Topic: review ${id}`);
        toast('已回顾，已排到下一次。'); route({ quiet: true });
      } catch (e) { toast(saveError(e)); return false; }
    } }],
  });
}

async function viewTopics() {
  const all = await loadTopics(lib).catch(() => []);
  const order = (a, b) => Number(!!b.pinned) - Number(!!a.pinned) || TOPIC_PRIORITY.indexOf(a.priority) - TOPIC_PRIORITY.indexOf(b.priority);
  const card = (t) => h('div', { class: `tile topic-card p-${t.priority}${activeTopic(t) ? '' : ' closed'}` },
    h('div', { class: 'hc-top' }, h('span', { class: 'hc-id' }, t.id), h('span', { class: 'hyp-badges' }, h('span', { class: `prio p-${t.priority}` }, `${t.priority}优先`), h('span', { class: 'hyp-status' }, t.status))),
    h('h3', null, t.pinned ? h('span', { class: 'tc-pin', html: PIN_SVG }) : null, t.title),
    t.why ? h('p', { class: 'hc-desc' }, t.why) : null,
    t.links ? h('p', { class: 'tc-links' }, '相关：', t.links) : null,
    (t.reviews || []).length ? h('details', { class: 'soon' }, h('summary', null, `回顾记录（${t.reviews.length}）`),
      h('ol', { class: 'hist-list' }, [...t.reviews].reverse().map((r) => h('li', null, h('span', { class: 'ev-date' }, fmtDate(r.at)), h('div', null, r.note || '（已回顾）'))))) : null,
    h('div', { class: 'topic-foot' }, h('span', { class: `rv${t.every && t.next && daysFrom(t.next) <= 0 ? ' due' : ''}` }, reviewLabel(t)),
      h('span', null,
        activeTopic(t) && t.every ? h('button', { class: 'btn small', type: 'button', onclick: () => reviewTopic(t.id) }, '已回顾') : null,
        h('button', { class: 'btn small ghost', type: 'button', onclick: () => editTopic(t) }, '编辑'))));
  const act = all.filter(activeTopic).sort(order);
  const closed = all.filter((t) => !activeTopic(t));
  return h('div', { class: 'view think' },
    topbar({ back: '#/think', backLabel: '思维笔记本', title: '潜在研究课题', sub: '思维笔记本', actions: [
      h('button', { class: 'btn primary', type: 'button', onclick: () => editTopic(null) }, icon('plus', 18), h('span', null, '新课题'))] }),
    demoBanner(),
    h('div', { class: 'think-wrap' },
      h('header', { class: 'hero think-hero' }, h('p', { class: 'hero-eyebrow' }, 'FUTURE DIRECTIONS'), h('h1', { class: 'hero-title' }, '潜在研究课题'),
        h('p', { class: 'think-lead' }, '值得以后做的方向。每个课题设一个回顾节奏，到期会出现在首页“今日待办”和顶部提示条里；回顾时记一句当下的想法，自动排到下一次。')),
      thinkTabs('topics'),
      h('div', { class: 'hyp-grid' }, act.length ? act.map(card) : [h('div', { class: 'tile empty-tile' }, h('p', null, '还没有课题。点右上角“新课题”，或在首页卡片里直接记下。'))]),
      closed.length ? h('h2', { class: 'section-title think-sub' }, '已转为课题 / 放弃') : null,
      closed.length ? h('div', { class: 'hyp-grid' }, closed.map(card)) : null));
}

// Experiment page: put a hypothesis box at the top of 目的 and record the link in front matter.
async function openCiteHypothesis(vol, num, onInsert) {
  const hyps = await loadHypotheses(lib);
  if (!hyps.length) { if ((await choose('思维笔记本里还没有假设', '先去新建一条？', [['go', '去新建'], ['no', '取消']])) === 'go') { location.hash = '#/think'; setTimeout(() => editHypothesis(null), 400); } return; }
  const sel = h('select', { id: 'ch-hyp' }, hyps.map((x) => h('option', { value: x.id }, `${x.id} · ${x.title}（${x.status}）`)));
  const note = h('input', { id: 'ch-note', placeholder: '本次检验哪条预测，例如：本次检验：换成甲苯后是否仍气爆' });
  const own = num && !onInsert ? parseFrontMatter(await lib.readPage(vol, num)) : null;
  modal({
    title: '引用假设',
    body: h('div', { class: 'form' },
      h('label', { for: 'ch-hyp' }, '本实验要检验的假设'), sel,
      h('label', { for: 'ch-note' }, '说明（可不填）'), note,
      h('p', { class: 'muted' }, '会在“目的”一节顶部放一个假设框，显示假设、状态、可信度和目前的证据；假设页的“相关实验”也会列出本实验。')),
    buttons: [{ label: '取消' }, {
      label: '引用', primary: true,
      run: async () => {
        const block = hypBlock(sel.value, note.value.trim());
        if (onInsert) { onInsert(block); return; }
        try {
          await updatePage(vol, num, ({ fm: f, body: b }) => {
            f.hypotheses = [...new Set([...(f.hypotheses || []), sel.value])];
            const m = b.match(/^##\s+目的\s*$/m);
            b = m ? `${b.slice(0, m.index + m[0].length)}\n\n${block}\n${b.slice(m.index + m[0].length)}` : `## 目的\n\n${block}\n\n${b}`;
            return { fm: f, body: b.replace(/\n{3,}/g, '\n\n') };
          }, `Cite ${sel.value}`, `引用假设 ${sel.value}`);
          toast('已引用。');
        } catch (e) { toast(saveError(e)); return false; }
      },
    }],
  });
}

// Experiment page: "作为证据加入假设" beside 结论 — the conclusion becomes evidence on the hypothesis.
async function conclusionEvidenceButton(sheet, vol, num, fm) {
  const head = [...sheet.querySelectorAll('.sheet-body.prose > h2')].find((x) => x.textContent.trim() === '结论');
  if (!head || !hypIds(lib).length) return;
  const hyps = await loadHypotheses(lib);
  const done = hyps.flatMap((x) => (x.evidence || []).filter((e) => e.src?.vol === vol && e.src?.num === num).map((e) => `${x.id} 证据 ${e.id.slice(1)}（${e.kind}）`));
  const { body } = parseFrontMatter(await lib.readPage(vol, num));
  const concl = (sectionOf(body, '结论') || '').replace(/[#*>`=+{}]/g, '').trim();
  const cited = [...new Set([...(fm.hypotheses || []), ...(body.match(/H-\d{4}/g) || [])])];
  const btn = h('button', { class: 'ns-btn no-print', type: 'button', onclick: () => {
    const sel = h('select', { id: 'ce-hyp' }, hyps.map((x) => h('option', { value: x.id, selected: cited[0] === x.id }, `${x.id} · ${x.title}`)));
    modal({
      title: '把本实验的结论作为证据',
      body: h('div', { class: 'form' }, h('label', { for: 'ce-hyp' }, '加到哪条假设'), sel,
        h('p', { class: 'muted' }, '下一步选择“支持 / 反对 / 待定”，内容默认是本页的结论，可以修改。')),
      buttons: [{ label: '取消' }, { label: '下一步', primary: true, run: () => {
        const hyp = hyps.find((x) => x.id === sel.value);
        setTimeout(() => editEvidence(hyp, null, { date: fm.date, text: concl.slice(0, 300), src: { xid: fm.id || '', vol, num } }), 50);
      } }],
    });
  } }, icon('book', 14), '作为证据加入假设');
  head.append(' ', btn, ...(done.length ? [h('span', { class: 'ns-added no-print' }, `✓ 已是 ${done.join('、')}`)] : []));
}

// Put several existing pages into one series at once.
function openBulkSeries(volId) {
  const pages = lib.pages(volId);
  const names = allSeries().map((x) => x.name);
  const name = h('input', { id: 'bs-name', list: 'bs-list', placeholder: '例如：PEDOT:PSS 配方优化' });
  const checks = pages.map((p) => ({ p, box: h('input', { type: 'checkbox', checked: false }) }));
  modal({
    title: '把已有的页归入系列',
    body: h('div', { class: 'form' },
      h('label', { for: 'bs-name' }, '系列名称（可选已有的）'), name,
      h('datalist', { id: 'bs-list' }, names.map((n) => h('option', { value: n }))),
      h('span', { class: 'label' }, '勾选要归入的页'),
      h('div', { class: 'pick-list' }, checks.map(({ p, box }) => h('label', { class: 'check' }, box, ' ',
        h('span', { class: 'c-date' }, fmtDate(p.date)), ' ', p.xid ? h('span', { class: 'xid-tag' }, p.xid) : null, p.title,
        p.series ? h('span', { class: 'toc-tags' }, `（现属：${p.series}）`) : null))),
      h('p', { class: 'muted' }, '每一页仍保留自己的编号和日期；已签名的页会记一条修订。')),
    buttons: [{ label: '取消' }, {
      label: '归入', primary: true,
      run: async () => {
        const n = name.value.trim();
        const sel = checks.filter((c) => c.box.checked).map((c) => c.p);
        if (!n) { toast('写一个系列名称。'); return false; }
        if (!sel.length) { toast('至少勾选一页。'); return false; }
        try {
          for (const p of sel) await updatePage(p.vol || volId, p.num, ({ fm: f, body }) => { f.series = n; return { fm: f, body }; }, `Series of p. ${p.num}`, `归入系列“${n}”`);
          toast(`${sel.length} 页已归入“${n}”。`);
        } catch (e) { toast(saveError(e)); return false; }
      },
    }],
  });
}

// ----- photos straight from the phone camera -----
const PHOTO_KINDS = [['photo', '照片'], ['channel', '沟道'], ['gate', '栅极'], ['device', '整片器件'], ['film', '薄膜'], ['solution', '溶液'], ['setup', '测试装置'], ['micro', '显微镜'], ['eq', '反应式'], ['scheme', '示意图']];
async function openPhotoCapture(vol, num) {
  const { fm, body } = parseFrontMatter(await lib.readPage(vol, num));
  const t = readSamples(body);
  const xid = fm.id || `p${pad(num)}`;
  const input = h('input', { type: 'file', accept: 'image/*', capture: 'environment', multiple: true, hidden: true });
  document.body.append(input);
  input.addEventListener('change', async () => {
    const files = [...input.files]; input.remove();
    if (!files.length) return;
    const who = h('select', { id: 'ph-who' }, h('option', { value: '' }, `整个实验（${xid}）`), (t?.rows || []).map((r) => h('option', { value: sampleNo(r[0]) }, `${sampleNo(r[0])}  ${r.slice(1, 4).filter(Boolean).join(' / ')}`)));
    const kind = h('select', { id: 'ph-kind' }, PHOTO_KINDS.map(([v, l]) => h('option', { value: v }, `${l} (${v})`)));
    const cap = h('input', { id: 'ph-cap', placeholder: '例如：溶液呈深蓝色；沟道边缘有裂纹' });
    const nameOut = h('code', { class: 'name-preview' });
    const names = () => {
      const base = who.value ? sampleId(xid, who.value) : xid;
      return files.map((_, i) => `${base}_${kind.value}${files.length > 1 ? `-${i + 1}` : ''}.jpg`);
    };
    const upd = () => { nameOut.textContent = names().join('  '); };
    [who, kind].forEach((el) => el.addEventListener('change', upd)); upd();
    modal({
      title: `添加 ${files.length} 张照片`,
      body: h('div', { class: 'form' },
        h('label', { for: 'ph-who' }, '对应样品'), who,
        h('label', { for: 'ph-kind' }, '拍的是什么'), kind,
        h('label', { for: 'ph-cap' }, '说明（会写在图下）'), cap,
        h('p', { class: 'muted' }, '文件名：', nameOut)),
      buttons: [{ label: '取消' }, {
        label: '保存到本页', primary: true,
        run: async () => {
          const existing = new Set(lib.attachments(vol, num));
          const atts = [];
          const lines = [];
          for (const [i, f0] of files.entries()) {
            const f = await prepareFile(f0);
            let name = names()[i];
            for (let k = 2; existing.has(name); k++) name = name.replace(/(-\d+)?\.jpg$/, `-${k}.jpg`);
            existing.add(name);
            atts.push({ name, blob: f });
            const label = [who.value || '', PHOTO_KINDS.find(([v]) => v === kind.value)?.[1], cap.value.trim()].filter(Boolean).join(' · ');
            lines.push(`![${label}](${name})`);
          }
          try {
            const r = await updatePage(vol, num, ({ fm: f, body: b }) => {
              const add = lines.join('\n\n');
              const head = /^## 照片[ \t]*$/m;
              b = head.test(b) ? b.replace(head, (m) => `${m}\n\n${add}\n`) : `${b.trimEnd()}\n\n## 照片\n\n${add}\n`;
              return { fm: f, body: b, attachments: atts };
            }, `Photos for ${xid}`, `补充照片 ${atts.map((a) => a.name).join('、')}`);
            toast(r.queued ? '照片已存在本机，联网后同步。' : '照片已保存。');
          } catch (e) { toast(saveError(e)); return false; }
        },
      }],
    });
  });
  input.click();
}

// ----- naming helper -----
function openNaming(fm, num) {
  const xid = fm.id;
  if (!xid) { toast('这一页没有实验编号。新建实验时会自动生成。'); return; }
  const year = xid.slice(0, 4);
  const rows = [
    ['Keithley 数据文件夹', `01_Data/01_Keithley 4200/${year}/${xid}_简短描述/`, '里面按样品号建子文件夹 1、9、10……（不带 #），数据同步脚本按这个对应。'],
    ['单个数据文件', `${xid}-#09_TR_VD-0.3V_gm.xls`, '样品号_测试类型_测试条件_目的。测试类型：TR 转移、OUT 输出、IT 电流-时间、CV、EIS。'],
    ['显微镜 / 照片', `${xid}-#09_micro_20x.jpg`, '放在任何数据目录里，名字以样品号开头就会被同步脚本挂到这一页。'],
    ['电化学（CHI）', `01_Data/02_CHI/${year}/${xid}-#09_CV_50mVs.txt`, ''],
    ['预处理文件', `${xid}-#09_TR_20mVs_cond03.xls`, 'SOP v2：预处理数据带 _cond，不计入结果。'],
  ];
  modal({
    title: `命名助手 · ${xid}`, wide: true,
    body: h('div', null,
      h('p', { class: 'muted' }, '把 #09 换成实际样品号。点名字即可复制。'),
      h('table', { class: 'data naming' }, thead(['用途', '名字', '说明']),
        h('tbody', null, rows.map(([a, b, c]) => h('tr', null, h('td', null, a), h('td', null, h('button', { class: 'linkish', type: 'button', onclick: () => copyText(b) }, h('code', null, b))), h('td', { class: 'muted' }, c)))))),
    buttons: [{ label: '关闭' }],
  });
}

// ----- paper record card: printed before the experiment, filled at the bench -----
async function printCard(vol, num) {
  const { fm, body } = parseFrontMatter(await lib.readPage(vol, num));
  const t = readSamples(body) || samplesTemplate([1, 2, 3], [], []);
  const reagents = await loadReagents(lib).catch(() => []);
  const proto = fm.protocol ? await loadProtocol(lib, fm.protocol).catch(() => null) : null;
  const used = (fm.reagents || []).map((id) => reagents.find((r) => r.id === id) || { id, name: '?' });
  const blankRows = Math.max(2, 10 - t.rows.length);
  const pr = document.getElementById('print-root');
  const sheet = h('article', { class: 'sheet card' },
    h('header', { class: 'card-head' },
      h('div', null, h('div', { class: 'card-id' }, fm.id || `p. ${num}`), h('div', { class: 'card-title' }, fm.title || '')),
      h('div', { class: 'card-meta' }, `日期 ${fm.date || ''}`, h('br'), `${lib.volume(vol)?.title || ''}，第 ${num} 页`)),
    h('p', { class: 'card-line' }, h('b', null, 'SOP '), fm.protocol ? `${fm.protocol} ${proto?.title || ''} ${proto?.version || ''}` : '—', h('span', { class: 'gap' }), h('b', null, '实验人 '), '________', h('b', null, '  温度/湿度 '), '____ ℃ / ____ %RH'),
    used.length ? h('table', { class: 'card-table small' }, thead(['试剂', '名称', '批号', '实际批号/开封日']), h('tbody', null, used.map((r) => h('tr', null, h('td', null, r.id), h('td', null, r.name), h('td', null, r.lot || ''), h('td'))))) : null,
    h('table', { class: 'card-table' },
      thead([...t.cols.map(colLabel), '✓']),
      h('tbody', null,
        t.rows.map((r) => h('tr', null, t.cols.map((c, j) => h('td', { class: isResultCol(c) ? 'blank' : null }, j === 0 ? sampleNo(r[0]) : (isResultCol(c) ? '' : r[j]))), h('td'))),
        Array.from({ length: blankRows }, () => h('tr', null, t.cols.map(() => h('td')), h('td'))))),
    h('div', { class: 'card-notes' }, h('b', null, '与 SOP 的偏离 / 现象 / 时间点'), ...Array.from({ length: 6 }, () => h('div', { class: 'ruled' }))),
    (fm.followups || []).length ? h('p', { class: 'card-line' }, h('b', null, '后续提醒 '), (fm.followups || []).join('；')) : null,
    h('p', { class: 'card-foot' }, '录入：打开这一页 → “录入表格”。照片和 Keithley 数据按命名助手里的名字保存，会自动挂到对应样品。'));
  pr.replaceChildren(sheet);
  document.body.classList.add('print-volume');
  setTimeout(() => window.print(), 50);
}

// ----- calendar export -----
function exportIcs(items, name = 'lab-reminders.ics') {
  if (!items.length) { toast('没有未完成的提醒。'); return; }
  downloadText(name, icsFor(items.map((it) => ({
    date: it.date, summary: it.xid ? `${it.xid} ${it.text}` : it.text,
    description: it.page ? `${location.origin}${location.pathname}#/v/${it.page.vol}/${it.page.num}` : '',
    uid: `${it.xid || it.reagent || 'x'}-${it.date}-${it.text}`.replace(/[^\w-]+/g, ''),
  }))), 'text/calendar');
}

async function openFollowups() {
  const items = await allFollowups();
  const open = items.filter((x) => !x.done);
  exportIcs(open);
}
async function allFollowups() {
  const items = [];
  for (const p of lib.allPages()) {
    if (p.void) continue;
    (p.followups || []).forEach((s, i) => { const f = parseFollowup(s); if (f) items.push({ ...f, index: i, page: p, xid: p.xid }); });
  }
  const reagents = await loadReagents(lib).catch(() => []);
  for (const a of reagentAlerts(reagents)) items.push({ ...a, done: false });
  for (const a of solutionAlerts(await loadSolutions(lib).catch(() => []))) items.push({ ...a, done: false });
  for (const a of topicAlerts(await loadTopics(lib).catch(() => []), 7)) items.push({ ...a, done: false });
  return items.sort((a, b) => a.date.localeCompare(b.date));
}

// ----- planner: today's to-dos and the week's plan, kept in planner/tasks.json -----
// task = { id, text, week: <Monday ISO>, date?: <ISO> (a to-do for that day; none = a weekly goal), done, doneAt?, created }
const TASKS_PATH = 'planner/tasks.json';
const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];
const weekStart = (iso) => addDays(iso, -((new Date(`${iso}T12:00:00`).getDay() + 6) % 7));
let planLocal = null; // { sha, doc: { tasks, memos }, dirty } — shown at once; commits follow in order
let planQueue = Promise.resolve();
const planDoc = (d) => ({ tasks: Array.isArray(d?.tasks) ? d.tasks : [], memos: Array.isArray(d?.memos) ? d.memos : [] });
async function loadPlanner() {
  const sha = lib.tree.get(TASKS_PATH) || null;
  if (planLocal && (planLocal.sha === sha || planLocal.dirty)) return planLocal.doc;
  planLocal = { sha, doc: planDoc(await lib.readJSON(TASKS_PATH, {})), dirty: 0 };
  return planLocal.doc;
}
const loadTasks = async () => (await loadPlanner()).tasks;
function changePlanner(mutate, message, redraw) {
  mutate(planLocal.doc); planLocal.dirty += 1;
  redraw?.(); refreshDueBar();
  planQueue = planQueue.then(() => lib.commit(message, async (l) => {
    const doc = planDoc(await l.readJSON(TASKS_PATH, {}));
    mutate(doc);
    return { changes: [{ path: TASKS_PATH, data: `${JSON.stringify(doc, null, 1)}\n` }], after: () => { planLocal.dirty -= 1; if (!planLocal.dirty) planLocal.doc = doc; } };
  })).then(() => { if (!planLocal.dirty) planLocal.sha = lib.tree.get(TASKS_PATH); })
    .catch((e) => { toast(e instanceof NetworkError ? '离线中：没有同步，联网后请再操作一次。' : `没有保存：${e.message}`); planLocal = null; redraw?.(); refreshDueBar(); });
  return planQueue;
}
const changeTasks = (mutate, message, redraw) => changePlanner((d) => mutate(d.tasks), message, redraw);
const newTask = (text, week, date) => ({ id: `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, text, week, ...(date ? { date } : {}), done: false, created: nowISO() });
const toggleTask = (id, redraw) => changeTasks((list) => { const t = list.find((x) => x.id === id); if (t) { t.done = !t.done; if (t.done) t.doneAt = nowISO(); else delete t.doneAt; } }, 'Planner: tick', redraw);
const removeTask = (id, redraw) => changeTasks((list) => { const k = list.findIndex((x) => x.id === id); if (k >= 0) list.splice(k, 1); }, 'Planner: remove', redraw);
const editTask = (id, text, redraw) => changeTasks((list) => { const t = list.find((x) => x.id === id); if (t) t.text = text; }, 'Planner: edit', redraw);
const moveTask = (id, date, redraw) => changeTasks((list) => { const t = list.find((x) => x.id === id); if (!t) return; if (date) { t.date = date; t.week = weekStart(date); } else delete t.date; }, 'Planner: move', redraw);

// Click the text to edit it in place; Enter or leaving the field saves, Esc cancels.
function editable(text, onSave, cls = 'task-text') {
  const span = h('span', { class: `${cls} editable`, tabindex: '0', title: '点击修改' }, text);
  const start = () => {
    const input = h('input', { class: `${cls} edit-input`, value: text, 'aria-label': '修改' });
    let done = false;
    const finish = (save) => { if (done) return; done = true; const v = input.value.trim(); input.replaceWith(span); if (save && v && v !== text) { span.textContent = v; onSave(v); } };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); finish(true); } if (e.key === 'Escape') finish(false); });
    input.addEventListener('blur', () => finish(true));
    span.replaceWith(input); input.focus(); input.select();
  };
  span.addEventListener('click', start);
  span.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); start(); } });
  return span;
}
const dayLabel = (iso) => { const d = daysFrom(iso); return d === 0 ? '今天' : d === 1 ? '明天' : d === -1 ? '昨天' : iso.slice(5); };
// Date chip: shows 今天 / 明天 / 11-05 and opens the date picker; a weekly goal shows 本周.
function dateChip(t, redraw) {
  const input = h('input', { type: 'date', class: 'date-input', value: t.date || '', 'aria-label': '改日期' });
  input.addEventListener('change', () => moveTask(t.id, input.value || null, redraw));
  const late = t.date && !t.done && t.date < todayISO();
  return h('label', { class: `date-chip${late ? ' late' : ''}`, title: t.date ? '改日期（清空则变为本周计划）' : '指定到某一天' }, t.date ? dayLabel(t.date) : '本周', input);
}

function ring(done, total, size = 64) {
  const r = (size - 8) / 2; const c = 2 * Math.PI * r; const f = total ? done / total : 0;
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`); svg.setAttribute('class', 'ring'); svg.setAttribute('width', size); svg.setAttribute('height', size);
  svg.innerHTML = `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="ring-bg"/><circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="ring-fg" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - f)}" transform="rotate(-90 ${size / 2} ${size / 2})"/>`;
  return h('div', { class: 'ring-box', role: 'img', 'aria-label': `已完成 ${done} / ${total}` }, svg, h('span', { class: 'ring-num' }, total ? `${Math.round(f * 100)}%` : '—'));
}
function taskRow(t, { redraw, extra, meta } = {}) {
  if (!meta && t.src) meta = h('a', { href: `#/v/${t.src.vol}/${t.src.num}` }, `来自 ${t.src.xid || `p. ${t.src.num}`}`);
  return h('li', { class: `task${t.done ? ' done' : ''}` },
    h('button', { class: 'tick', type: 'button', role: 'checkbox', 'aria-checked': String(!!t.done), 'aria-label': t.done ? '标为未完成' : '标为完成', onclick: () => toggleTask(t.id, redraw) }),
    h('span', { class: 'task-main' }, editable(t.text, (v) => editTask(t.id, v, redraw)), meta ? h('span', { class: 'task-meta' }, meta) : null),
    extra || null,
    dateChip(t, redraw),
    h('button', { class: 'task-del', type: 'button', 'aria-label': '删除', title: '删除', onclick: () => removeTask(t.id, redraw) }, icon('close', 14)));
}
function reminderRow(x, redraw) {
  const d = daysFrom(x.date);
  return h('li', { class: `task reminder${x.done ? ' done' : ''}${d < 0 && !x.done ? ' late' : ''}` },
    x.page ? h('button', { class: 'tick', type: 'button', role: 'checkbox', 'aria-checked': String(!!x.done), 'aria-label': '完成', onclick: async () => { await toggleFollowup(x.page.vol, x.page.num, x.index); redraw(); } })
      : x.topic ? h('button', { class: 'tick', type: 'button', role: 'checkbox', 'aria-checked': 'false', 'aria-label': '已回顾', title: '已回顾（记一句想法，自动排到下一次）', onclick: () => reviewTopic(x.topic) }) : h('span', { class: 'tick static' }),
    h(x.page || x.topic ? 'a' : 'span', { class: 'task-text', href: x.page ? `#/v/${x.page.vol}/${x.page.num}` : x.topic ? '#/think/topics' : null }, x.text,
      h('span', { class: 'task-meta' }, [d < 0 ? `逾期 ${-d} 天` : d === 0 ? '今天' : `${d} 天后`, x.xid || (x.reagent ? '试剂库' : '')].filter(Boolean).join(' · '))),
    h('span', { class: 'chip' }, x.reagent ? '试剂' : x.solution ? '溶液' : x.topic ? '课题' : '复测'));
}
function addBox(placeholder, onAdd) {
  const input = h('input', { class: 'add-input', placeholder, enterkeyhint: 'done', 'aria-label': placeholder });
  const go = () => { const v = input.value.trim(); if (!v) return; input.value = ''; onAdd(v); input.focus(); };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); go(); } });
  return h('div', { class: 'add-row' }, h('span', { class: 'add-plus' }, icon('plus', 16)), input, h('button', { class: 'btn small add-btn', type: 'button', onclick: go }, '添加'));
}

// Sticky notes: anything to remember that isn't a task for a given day.
const PIN_SVG = '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="M9 3h6l-1 6 4 3v2h-5v7l-1 1-1-1v-7H6v-2l4-3z" fill="currentColor"/></svg>';
function memoCard(doc, draw) {
  const memos = [...doc.memos].sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || String(b.updated || b.created).localeCompare(String(a.updated || a.created)));
  const pinned = memos.filter((m) => m.pinned).length;
  const upd = (id, f, msg) => changePlanner((d) => { const m = d.memos.find((x) => x.id === id); if (m) f(m, d); }, msg, draw);
  const add = addBox('记一条备忘，回车保存', (text) => changePlanner((d) => d.memos.push({ id: `m${Date.now().toString(36)}`, text, pinned: false, created: nowISO() }), 'Memo: add', draw));
  add.querySelector('input').dataset.k = 'memo';
  return h('div', { class: 'tile memo-card' },
    h('div', { class: 'tile-head' }, h('div', null, h('h2', null, '备忘录'),
      h('p', { class: 'card-sub' }, memos.length ? `${memos.length} 条${pinned ? ` · 置顶 ${pinned}` : ''}` : '要买的耗材、要问导师的问题、灵感…'))),
    add,
    h('ul', { class: 'memos' }, memos.map((m) => h('li', { class: `memo${m.pinned ? ' pinned' : ''}` },
      h('div', { class: 'memo-main' },
        editable(m.text, (v) => upd(m.id, (x) => { x.text = v; x.updated = nowISO(); }, 'Memo: edit'), 'memo-text'),
        h('span', { class: 'memo-date' }, fmtDate(m.updated || m.created))),
      h('button', { class: 'memo-pin', type: 'button', 'aria-pressed': String(!!m.pinned), 'aria-label': m.pinned ? '取消置顶' : '置顶', title: m.pinned ? '取消置顶' : '置顶', html: PIN_SVG, onclick: () => upd(m.id, (x) => { x.pinned = !x.pinned; }, 'Memo: pin') }),
      h('button', { class: 'task-del', type: 'button', 'aria-label': '删除', title: '删除', onclick: () => changePlanner((d) => { d.memos = d.memos.filter((x) => x.id !== m.id); }, 'Memo: remove', draw) }, icon('close', 14))))));
}

// Reminder strip under the top bar on every page while today's or earlier to-dos are open.
async function refreshDueBar() {
  const bar = document.getElementById('due-bar');
  if (!bar || !lib?.head) return;
  try {
    const t = todayISO();
    const [tasks, fus] = await Promise.all([loadTasks(), allFollowups()]);
    const open = [...tasks.filter((x) => x.date && x.date <= t && !x.done), ...fus.filter((x) => !x.done && x.date <= t)];
    const late = open.filter((x) => x.date < t).sort((a, b) => a.date.localeCompare(b.date));
    const key = `${t}:${open.length}`;
    let hidden = false; try { hidden = sessionStorage.getItem('due-hide') === key; } catch { /* ignore */ }
    if (!open.length || hidden) { bar.hidden = true; return; }
    const d = new Date(`${t}T12:00:00`);
    bar.hidden = false;
    bar.replaceChildren(h('a', { class: 'due-link', href: '#/' },
      h('span', { class: 'due-dot' }),
      h('span', null, h('b', null, `还有 ${open.length} 项待办未完成`),
        late.length ? h('span', { class: 'due-late' }, `　其中 ${late.length} 项已逾期，最早 ${late[0].date.slice(5)}`) : null,
        h('span', { class: 'due-date' }, `　· 今天 ${d.getMonth() + 1} 月 ${d.getDate()} 日 星期${WEEKDAYS[(d.getDay() + 6) % 7]}`)),
      h('span', { class: 'due-go' }, '查看 ›')),
    h('button', { class: 'due-x', type: 'button', 'aria-label': '今天先不提示', title: '先隐藏（数量变化或明天会再提示）', onclick: () => { try { sessionStorage.setItem('due-hide', key); } catch { /* ignore */ } bar.hidden = true; } }, icon('close', 14)));
  } catch (e) { console.warn('due bar', e); bar.hidden = true; }
}

function hero() {
  const t = todayISO(); const d = new Date(`${t}T12:00:00`);
  const hr = new Date().getHours();
  const greet = hr < 5 ? '夜深了' : hr < 11 ? '早上好' : hr < 13 ? '中午好' : hr < 18 ? '下午好' : '晚上好';
  const name = (lib.notebook.owner || '').trim();
  return h('header', { class: 'hero' },
    h('p', { class: 'hero-eyebrow' }, `${d.getMonth() + 1} 月 ${d.getDate()} 日 · 星期${WEEKDAYS[(d.getDay() + 6) % 7]}`),
    h('h1', { class: 'hero-title' }, `${greet}${name ? `，${name}` : ''}。`));
}

// Home: today's to-dos (your own + experiment reminders) and this week's plan, each with progress.
function dashboard() {
  const t = todayISO(); const wk = weekStart(t);
  const box = h('section', { class: 'dash' }, h('div', { class: 'tile' }, h('p', { class: 'muted' }, '读取中…')));
  const draw = async () => {
    let tasks; let fus;
    let doc;
    try { [doc, fus] = await Promise.all([loadPlanner(), allFollowups()]); tasks = doc.tasks; } catch (e) { box.replaceChildren(h('div', { class: 'tile' }, h('p', { class: 'warn' }, e.message))); return; }
    const focused = box.querySelector('input:focus')?.dataset.k;
    const mine = tasks.filter((x) => x.date === t);
    const carried = tasks.filter((x) => x.date && x.date < t && !x.done);
    const due = fus.filter((x) => (x.date === t) || (!x.done && x.date < t));
    const soon = fus.filter((x) => !x.done && x.date > t && daysFrom(x.date) <= 7);
    const all = [...mine, ...carried, ...due];
    const doneN = all.filter((x) => x.done).length;
    const todayAdd = addBox('添加今天要做的事，回车保存', (text) => changeTasks((list) => list.push(newTask(text, wk, t)), 'Planner: add to-do', draw));
    todayAdd.querySelector('input').dataset.k = 'today';
    const todayCard = h('div', { class: 'tile today-card' },
      h('div', { class: 'tile-head' },
        h('div', null, h('h2', null, '今日待办'), h('p', { class: 'card-sub' }, all.length ? `已完成 ${doneN} 项 · 还剩 ${all.length - doneN} 项` : '今天还没有安排')),
        ring(doneN, all.length)),
      todayAdd,
      h('ul', { class: 'tasks' },
        carried.map((x) => taskRow(x, { redraw: draw, extra: h('button', { class: 'btn small ghost', type: 'button', onclick: () => moveTask(x.id, t, draw) }, '移到今天') })),
        mine.sort((a, b) => Number(a.done) - Number(b.done)).map((x) => taskRow(x, { redraw: draw })),
        due.map((x) => reminderRow(x, draw))),
      soon.length ? h('details', { class: 'soon' }, h('summary', null, `接下来 7 天的实验提醒（${soon.length}）`),
        h('ul', { class: 'tasks' }, soon.map((x) => reminderRow(x, draw))),
        h('button', { class: 'btn small ghost', type: 'button', onclick: () => exportIcs(fus.filter((x) => !x.done)) }, '导出到手机日历')) : null);

    const goals = tasks.filter((x) => x.week === wk && !x.date);
    const gDone = goals.filter((x) => x.done).length;
    const days = WEEKDAYS.map((w, k) => {
      const day = addDays(wk, k); const list = tasks.filter((x) => x.date === day);
      const dn = list.filter((x) => x.done).length;
      return h('a', { class: `day${day === t ? ' is-today' : ''}${day < t ? ' past' : ''}`, href: `#/plan/${wk}`, title: `${day}：${dn}/${list.length}` },
        h('span', { class: 'day-w' }, w),
        h('span', { class: 'day-bar' }, h('span', { style: { height: `${list.length ? (dn / list.length) * 100 : 0}%` } })),
        h('span', { class: 'day-n' }, list.length ? `${dn}/${list.length}` : '·'));
    });
    const weekAdd = addBox('添加本周计划（例如：完成 GOPS 稳定性测试）', (text) => changeTasks((list) => list.push(newTask(text, wk)), 'Planner: add weekly goal', draw));
    weekAdd.querySelector('input').dataset.k = 'week';
    const weekCard = h('div', { class: 'tile week-card' },
      h('div', { class: 'tile-head' },
        h('div', null, h('h2', null, '本周计划'), h('p', { class: 'card-sub' }, goals.length ? `已完成 ${gDone} 项 · 还剩 ${goals.length - gDone} 项` : `${wk.slice(5)} 至 ${addDays(wk, 6).slice(5)}`)),
        ring(gDone, goals.length)),
      weekAdd,
      h('ul', { class: 'tasks' }, goals.sort((a, b) => Number(a.done) - Number(b.done)).map((x) => taskRow(x, { redraw: draw }))),
      h('div', { class: 'week-days', 'aria-label': '本周每天的待办完成情况' }, days),
      h('a', { class: 'more-link', href: `#/plan/${wk}` }, '查看周计划与历史 ›'));
    box.replaceChildren(todayCard, weekCard, memoCard(doc, draw));
    if (focused) box.querySelector(`input[data-k="${focused}"]`)?.focus();
  };
  draw();
  return box;
}

// Week view: every day's to-dos and the week's goals, with history of earlier weeks.
async function viewPlan(param) {
  const t = todayISO();
  const wk = weekStart(/^\d{4}-\d{2}-\d{2}$/.test(param || '') ? param : t);
  const body = h('div', { class: 'plan-body' });
  const draw = async () => {
    const tasks = await loadTasks();
    const goals = tasks.filter((x) => x.week === wk && !x.date);
    const dayCols = WEEKDAYS.map((w, k) => {
      const day = addDays(wk, k);
      const list = tasks.filter((x) => x.date === day).sort((a, b) => Number(a.done) - Number(b.done));
      const dn = list.filter((x) => x.done).length;
      const add = addBox('添加', (text) => changeTasks((l) => l.push(newTask(text, wk, day)), 'Planner: add to-do', draw));
      add.querySelector('input').dataset.k = day;
      return h('div', { class: `tile day-col${day === t ? ' is-today' : ''}` },
        h('div', { class: 'dc-head' }, h('span', { class: 'dc-w' }, `周${w}`), h('span', { class: 'dc-d' }, day.slice(5)), h('span', { class: 'dc-n' }, list.length ? `${dn}/${list.length}` : '')),
        h('ul', { class: 'tasks' }, list.map((x) => taskRow(x, { redraw: draw }))), add);
    });
    const allDay = tasks.filter((x) => x.week === wk && x.date);
    const gd = goals.filter((x) => x.done).length; const dd = allDay.filter((x) => x.done).length;
    const goalAdd = addBox('添加本周计划', (text) => changeTasks((l) => l.push(newTask(text, wk)), 'Planner: add weekly goal', draw));
    goalAdd.querySelector('input').dataset.k = 'goal';
    const weeks = [...new Set(tasks.map((x) => x.week))].filter((w) => w < wk).sort().reverse().slice(0, 12);
    const focused = body.querySelector('input:focus')?.dataset.k;
    body.replaceChildren(...[
      h('div', { class: 'plan-stats' },
        h('div', { class: 'tile stat' }, ring(gd, goals.length, 56), h('div', null, h('b', null, `${gd} / ${goals.length}`), h('span', null, '本周计划完成'))),
        h('div', { class: 'tile stat' }, ring(dd, allDay.length, 56), h('div', null, h('b', null, `${dd} / ${allDay.length}`), h('span', null, '每日待办完成'))),
        h('div', { class: 'tile stat' }, h('div', null, h('b', null, `${goals.length - gd + allDay.length - dd}`), h('span', null, '尚未完成')))),
      h('h2', { class: 'section-title' }, '本周计划'),
      h('div', { class: 'tile' }, goalAdd, h('ul', { class: 'tasks' }, goals.sort((a, b) => Number(a.done) - Number(b.done)).map((x) => taskRow(x, { redraw: draw })))),
      h('h2', { class: 'section-title' }, '每日待办'),
      h('div', { class: 'day-grid' }, dayCols),
      weeks.length ? h('h2', { class: 'section-title' }, '往周') : null,
      weeks.length ? h('div', { class: 'tile' }, h('ul', { class: 'history' }, weeks.map((w) => {
        const all = tasks.filter((x) => x.week === w); const dn = all.filter((x) => x.done).length;
        return h('li', null, h('a', { href: `#/plan/${w}` }, h('span', { class: 'hw' }, `${w} 至 ${addDays(w, 6).slice(5)}`),
          h('span', { class: 'hbar' }, h('span', { style: { width: `${all.length ? (dn / all.length) * 100 : 0}%` } })),
          h('span', { class: 'hn' }, `${dn} / ${all.length}`)));
      }))) : null].filter(Boolean));
    if (focused) body.querySelector(`input[data-k="${focused}"]`)?.focus();
  };
  await draw().catch((e) => body.replaceChildren(h('p', { class: 'warn' }, e.message)));
  return h('div', { class: 'view plan' },
    topbar({ back: '#/', backLabel: '首页', title: '周计划', sub: `${wk} 至 ${addDays(wk, 6)}`, actions: [
      h('a', { class: 'btn ghost', href: `#/plan/${addDays(wk, -7)}` }, '‹ 上一周'),
      wk !== weekStart(t) ? h('a', { class: 'btn ghost', href: '#/plan' }, '本周') : null,
      h('a', { class: 'btn ghost', href: `#/plan/${addDays(wk, 7)}` }, '下一周 ›')] }),
    demoBanner(), h('div', { class: 'plan-wrap' }, body));
}

// ----- export a date range for the supervisor: PDF (print) or Word -----
function openExport(vol) {
  const from = h('input', { id: 'ex-from', type: 'date', value: addDays(todayISO(), -6) });
  const to = h('input', { id: 'ex-to', type: 'date', value: todayISO() });
  const volSel = h('select', { id: 'ex-vol' }, h('option', { value: '' }, '所有卷'), lib.volumes().map((v) => h('option', { value: v.id, selected: v.id === vol }, v.title)));
  const withVoid = h('input', { type: 'checkbox', id: 'ex-void' });
  const count = h('p', { class: 'muted' });
  const pick = () => lib.allPages().filter((p) => p.date >= from.value && p.date <= to.value && (!volSel.value || p.vol === volSel.value) && (withVoid.checked || !p.void))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)) || a.vol.localeCompare(b.vol) || a.num - b.num);
  const upd = () => { count.textContent = `共 ${pick().length} 页。`; };
  [from, to, volSel, withVoid].forEach((el) => el.addEventListener('change', upd)); upd();
  const quick = (label, a, b) => h('button', { class: 'btn small', type: 'button', onclick: () => { from.value = a; to.value = b; upd(); } }, label);
  const t = todayISO(); const dow = (new Date(`${t}T12:00:00`).getDay() + 6) % 7;
  modal({
    title: '导出实验记录',
    body: h('div', { class: 'form' },
      h('div', { class: 'row-actions' },
        quick('最近 7 天', addDays(t, -6), t),
        quick('本周', addDays(t, -dow), t),
        quick('上周', addDays(t, -dow - 7), addDays(t, -dow - 1)),
        quick('本月', `${t.slice(0, 7)}-01`, t)),
      h('div', { class: 'pair' }, h('div', null, h('label', { for: 'ex-from' }, '从'), from), h('div', null, h('label', { for: 'ex-to' }, '到'), to)),
      h('label', { for: 'ex-vol' }, '卷'), volSel,
      h('label', { class: 'check', for: 'ex-void' }, withVoid, ' 包含已作废的页'),
      count,
      h('p', { class: 'muted' }, 'PDF：在打印窗口里选“存储为 PDF”。Word：直接下载 .docx，导师可以在里面批注。')),
    buttons: [{ label: '取消' },
      { label: '导出 Word', run: async () => { const ps = pick(); if (!ps.length) { toast('这个范围里没有记录。'); return false; } await exportWord(ps, from.value, to.value); } },
      { label: '导出 PDF', primary: true, run: async () => { const ps = pick(); if (!ps.length) { toast('这个范围里没有记录。'); return false; } await exportPdf(ps, from.value, to.value); } }],
  });
}

async function summaryRows(pages) {
  const rows = [];
  for (const p of pages) {
    const { body } = parseFrontMatter(await lib.readPage(p.vol, p.num));
    const t = readSamples(body);
    const concl = (sectionOf(body, '结论') || '').split('\n').map((x) => x.replace(/^[-*>\s]+/, '').trim()).find(Boolean) || '';
    rows.push([p.date, p.xid || '', p.title + (p.void ? '（已作废）' : ''), lib.volume(p.vol)?.title || p.vol, p.protocol || '', t ? String(t.rows.length) : '', concl, p.signed ? '已签名' : '未签名']);
  }
  return rows;
}
const SUMMARY_HEAD = ['日期', '实验编号', '标题', '卷', 'SOP', '样品数', '结论', '签名'];
const exportName = (a, b) => `实验记录_${a.replace(/-/g, '')}-${b.replace(/-/g, '')}`;

async function exportPdf(pages, a, b, { cover = true, title: heading = '实验记录汇总' } = {}) {
  toast('正在准备 PDF…');
  const nodes = [];
  if (cover) {
  const rows = await summaryRows(pages);
  nodes.push(h('article', { class: 'sheet plain report-cover record' },
    h('div', { class: 'rc-kind' }, 'LABORATORY RECORD · SUMMARY'),
    h('h1', null, heading),
    h('p', { class: 'rc-range' }, `${a} 至 ${b}`),
    h('p', { class: 'muted' }, `${lib.notebook.owner || ''}　共 ${pages.length} 页　导出于 ${todayISO()}`),
    h('table', { class: 'data report-table' }, thead(SUMMARY_HEAD), h('tbody', null, rows.map((r) => h('tr', null, r.map((c) => h('td', null, c))))))));
  }
  const readies = [];
  for (const p of pages) { const { el, ready } = await buildPageSheet(p.vol, p.num, { forPrint: true }); nodes.push(el); readies.push(ready); }
  const pr = printSheets(nodes);
  const settle = (x) => Promise.race([x, new Promise((r) => setTimeout(r, 15000))]);
  await settle(Promise.allSettled(readies));
  await settle(Promise.all([...pr.querySelectorAll('img')].map((i) => i.decode?.().catch(() => {}))));
  document.body.classList.add('print-volume');
  fitChartsForPrint(pr, 680);
  const title = document.title; document.title = cover ? exportName(a, b) : `${pages[0].xid || '实验记录'}_${pages[0].title || ''}`;
  window.addEventListener('afterprint', () => { document.title = title; }, { once: true });
  setTimeout(() => window.print(), 50);
}

async function exportWord(pages, a, b, { title: heading = '实验记录汇总' } = {}) {
  toast('正在生成 Word…');
  await loadScript('vendor/docx.umd.js');
  const D = window.docx;
  const W = 9638; // A4 text width in twips with 2 cm margins
  const font = { ascii: 'Arial', hAnsi: 'Arial', eastAsia: '等线', cs: 'Arial' };
  const P = (text, o = {}) => new D.Paragraph({ spacing: { after: 80 }, ...o.para, children: String(text ?? '').split('\n').map((t, i) => new D.TextRun({ text: t, break: i ? 1 : 0, font, size: o.size || 21, bold: o.bold, italics: o.italics, color: o.color })) });
  const border = { style: D.BorderStyle.SINGLE, size: 4, color: '999999' };
  const table = (rows, head) => {
    const n = Math.max(...[head, ...rows].filter(Boolean).map((r) => r.length));
    const w = Math.floor(W / n);
    const cell = (t, th) => new D.TableCell({ width: { size: w, type: D.WidthType.DXA }, borders: { top: border, bottom: border, left: border, right: border },
      shading: th ? { type: D.ShadingType.CLEAR, color: 'auto', fill: 'EEF2EE' } : undefined,
      margins: { top: 40, bottom: 40, left: 80, right: 80 }, children: [P(t, { bold: th, size: 18, para: { spacing: { after: 0 } } })] });
    const all = [...(head ? [head] : []), ...rows].map((r, i) => new D.TableRow({ tableHeader: !!head && i === 0, children: Array.from({ length: n }, (_, j) => cell(r[j] ?? '', !!head && i === 0)) }));
    return new D.Table({ width: { size: w * n, type: D.WidthType.DXA }, columnWidths: Array(n).fill(w), rows: all });
  };
  const image = async (src, maxW = 560) => {
    const buf = await (await fetch(src)).arrayBuffer();
    const bmp = await createImageBitmap(new Blob([buf]));
    const k = Math.min(1, maxW / bmp.width);
    const type = /^\x89PNG/.test(String.fromCharCode(...new Uint8Array(buf.slice(0, 4)))) ? 'png' : 'jpg';
    return new D.Paragraph({ alignment: D.AlignmentType.CENTER, children: [new D.ImageRun({ type, data: buf, transformation: { width: Math.round(bmp.width * k), height: Math.round(bmp.height * k) } })] });
  };
  // Text of an element with its <br> line breaks kept.
  const brText = (el) => { const c = el.cloneNode(true); c.querySelectorAll('br').forEach((b) => b.replaceWith('\n')); return c.textContent.trim(); };
  const tableRows = (t) => [...t.querySelectorAll('tr:not(.group)')].map((tr) => [...tr.children].map((c) => c.textContent.trim()));
  // Walk the rendered page and turn it into Word blocks.
  async function blocks(root) {
    const out = [];
    for (const el of root.children) {
      const tag = el.tagName;
      if (/^H[1-4]$/.test(tag)) out.push(new D.Paragraph({ heading: [D.HeadingLevel.HEADING_2, D.HeadingLevel.HEADING_2, D.HeadingLevel.HEADING_3, D.HeadingLevel.HEADING_4][+tag[1] - 1], children: [new D.TextRun({ text: el.textContent, font })] }));
      else if (tag === 'P') { if (el.textContent.trim()) out.push(P(brText(el))); }
      else if (tag === 'UL' || tag === 'OL') [...el.children].forEach((li, i) => out.push(P(`${tag === 'OL' ? `${i + 1}.` : '•'} ${brText(li)}`, { para: { indent: { left: 360 } } })));
      else if (tag === 'BLOCKQUOTE') out.push(P(el.textContent.trim(), { italics: true, color: '666666' }));
      else if (tag === 'PRE') out.push(P(el.textContent, { size: 18 }));
      else if (tag === 'TABLE') out.push(table(tableRows(el)), P(''));
      else if (el.querySelector?.(':scope > table')) out.push(table(tableRows(el.querySelector(':scope > table'))), P(''));
      else if (tag === 'FIGURE') {
        const img = el.querySelector('img');
        const plot = el.querySelector('.js-plotly-plot');
        try {
          if (img?.src) out.push(await image(img.src));
          else if (plot && window.Plotly) out.push(await image(await window.Plotly.toImage(plot, { format: 'png', width: 900, height: 500 })));
          else if (el.querySelector('table')) out.push(table(tableRows(el.querySelector('table'))));
        } catch { /* leave the caption only */ }
        const cap = el.querySelector(':scope > figcaption');
        if (cap) out.push(P(cap.textContent.trim().replace(/^(图 \d+)\s*/, '$1  '), { size: 18, color: '555555', para: { alignment: D.AlignmentType.CENTER } }));
      } else if (tag === 'DIV' || tag === 'SECTION') out.push(...await blocks(el));
    }
    return out;
  }
  const rows = await summaryRows(pages);
  const children = [
    P(lib.notebook.title || '实验记录本', { color: '4F7D66' }),
    new D.Paragraph({ heading: D.HeadingLevel.TITLE, children: [new D.TextRun({ text: heading, font })] }),
    P(`${a} 至 ${b}　共 ${pages.length} 页　${lib.notebook.owner || ''}　导出于 ${todayISO()}`),
    table(rows, SUMMARY_HEAD),
  ];
  const stage = h('div', { class: 'export-stage' });
  document.body.append(stage);
  try {
    for (const p of pages) {
      const { el, ready, fm } = await buildPageSheet(p.vol, p.num, { forPrint: true });
      stage.replaceChildren(el);
      await Promise.race([ready, new Promise((r) => setTimeout(r, 15000))]);
      children.push(new D.Paragraph({ children: [new D.PageBreak()] }),
        new D.Paragraph({ heading: D.HeadingLevel.HEADING_1, children: [new D.TextRun({ text: `${fm.id ? `${fm.id}  ` : ''}${fm.title || '未命名'}`, font })] }),
        P([`日期 ${fm.date || ''}`, `${lib.volume(p.vol)?.title || p.vol} 第 ${p.num} 页`, fm.protocol ? `SOP ${fm.protocol}` : '', fm.signed ? `签名 ${fm.signer || ''} ${String(fm.signed).slice(0, 10)}` : '未签名'].filter(Boolean).join('　'), { color: '555555' }));
      if (fm.void) children.push(P(`已作废 ${fm.void}`, { bold: true, color: 'B4322B' }));
      const panel = el.querySelector('.exp-panel');
      if (panel) {
        const rt = panel.querySelector('table');
        if (rt) children.push(P('试剂', { bold: true }), table(tableRows(rt)));
        const path = panel.querySelector('code.path');
        if (path) children.push(P(`原始数据：${path.textContent}`, { size: 18 }));
        const fus = [...panel.querySelectorAll('ul.followups li')].map((li) => li.textContent.replace(/^[✓○]/, '').trim());
        if (fus.length) children.push(P(`提醒：${fus.join('；')}`, { size: 18 }));
      }
      children.push(...await blocks(el.querySelector('.sheet-body')));
    }
  } finally { stage.remove(); }
  const doc = new D.Document({
    styles: { default: { document: { run: { font, size: 21 } } } },
    sections: [{ properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } } }, children }],
  });
  downloadText(`${exportName(a, b)}.docx`, await D.Packer.toBlob(doc), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  toast('Word 已下载。');
}

// ----- series: one entry for the same study run on many days -----
function allSeries() {
  const by = new Map();
  for (const p of lib.allPages()) {
    if (!p.series) continue;
    if (!by.has(p.series)) by.set(p.series, []);
    by.get(p.series).push(p);
  }
  return [...by].map(([name, pages]) => ({ name, pages: pages.sort((a, b) => String(a.date).localeCompare(String(b.date)) || a.num - b.num) }))
    .sort((a, b) => String(b.pages.slice(-1)[0].date).localeCompare(String(a.pages.slice(-1)[0].date)));
}
const dateRange = (ps) => { const a = ps[0]?.date || ''; const b = ps[ps.length - 1]?.date || ''; return a === b ? a : `${a} ~ ${b}`; };

// Contents rows: each series shows once, where its first page is.
function tocRows(pages) {
  const out = []; const seen = new Set();
  for (const p of pages) {
    if (!p.series) { out.push(p); continue; }
    if (seen.has(p.series)) continue;
    seen.add(p.series);
    const ps = pages.filter((x) => x.series === p.series);
    out.push({ seriesRow: true, name: p.series, count: ps.length, range: dateRange([...ps].sort((a, b) => String(a.date).localeCompare(String(b.date)))), nums: ps.length <= 4 ? ps.map((x) => x.num).join(', ') : `${ps[0].num}, ${ps[1].num} … ${ps[ps.length - 1].num}` });
  }
  return out;
}

function seriesRow(entry) {
  const ps = allSeries().find((x) => x.name === entry.series)?.pages || [];
  const i = ps.findIndex((x) => x.vol === entry.vol && x.num === entry.num);
  const link = (x, label) => (x ? h('a', { class: 'btn small ghost', href: `#/v/${x.vol}/${x.num}` }, label) : null);
  return h('div', { class: 'form-row' }, field('系列', h('span', { class: 'series-line' },
    h('a', { href: `#/series/${encodeURIComponent(entry.series)}` }, entry.series),
    h('span', { class: 'muted' }, ` 第 ${i + 1} / ${ps.length} 次`),
    link(ps[i - 1], '‹ 上一次'), link(ps[i + 1], '下一次 ›')), 'grow'));
}

async function viewSeries(raw) {
  const name = decodeURIComponent(raw);
  const ps = allSeries().find((x) => x.name === name)?.pages || [];
  if (!ps.length) return viewMissing(`没有名为“${name}”的系列。`);
  // Merge every experiment's sample table into one, columns in first-seen order.
  const conds = []; const results = []; const rows = [];
  for (const p of ps) {
    const t = readSamples(parseFrontMatter(await lib.readPage(p.vol, p.num)).body);
    if (!t) { rows.push({ p, no: '', vals: {} }); continue; }
    for (const c of t.cols.slice(1)) {
      if (c === '备注') continue;
      const list = isResultCol(c) ? results : conds;
      if (!list.includes(c)) list.push(c);
    }
    t.rows.forEach((r, i) => rows.push({ p, no: sampleNo(r[0]), first: i === 0, vals: Object.fromEntries(t.cols.map((c, j) => [c, r[j]])) }));
  }
  const cols = [...conds, ...results];
  let newest = true;
  const filter = h('input', { type: 'search', placeholder: '筛选：条件、结果、日期、编号…', 'aria-label': '筛选' });
  const body = h('tbody');
  const draw = () => {
    const q = filter.value.trim().toLowerCase();
    const order = newest ? [...ps].reverse() : ps;
    const list = order.flatMap((p) => rows.filter((r) => r.p === p)).filter((r) => !q || `${r.p.date} ${r.p.xid} ${r.no} ${r.p.title} ${Object.values(r.vals).join(' ')}`.toLowerCase().includes(q));
    let last = null;
    body.replaceChildren(...list.map((r) => {
      const start = last !== r.p; last = r.p;
      return h('tr', { class: `${start ? 'exp-start' : ''}${r.p.void ? ' voided' : ''}`, onclick: (e) => { if (!e.target.closest('a')) location.hash = `#/v/${r.p.vol}/${r.p.num}`; } },
        h('td', { class: 'c-date' }, start ? r.p.date : ''),
        h('td', { class: 'mono' }, start ? h('a', { href: `#/v/${r.p.vol}/${r.p.num}`, title: r.p.title }, r.p.xid || `p. ${r.p.num}`) : '', r.no ? h('span', { class: 'sno' }, r.no) : null),
        cols.map((c) => h('td', { class: isResultCol(c) ? 'res' : null }, r.vals[c] ?? '')),
        h('td', null, r.vals['备注'] || ''));
    }));
  };
  filter.addEventListener('input', draw);
  const sortBtn = h('button', { class: 'btn small', type: 'button', onclick: () => { newest = !newest; sortBtn.textContent = newest ? '最新在前' : '最早在前'; draw(); } }, '最新在前');
  draw();
  const first = ps[0]; const lastP = ps[ps.length - 1];
  const nSamples = rows.filter((r) => r.no).length;
  return h('div', { class: 'view library series' },
    topbar({ back: `#/v/${lastP.vol}`, backLabel: '目录', title: name, sub: `系列 · ${ps.length} 次实验 · ${nSamples} 个样品`, actions: [
      h('button', { class: 'btn danger', type: 'button', title: '解散或删除这个系列', onclick: () => openDeleteSeries(name, ps) }, icon('trash', 18), h('span', { class: 'wide-only' }, '删除系列')),
      h('button', { class: 'btn', type: 'button', onclick: () => exportSeries(name, ps) }, icon('download', 18), h('span', { class: 'wide-only' }, '导出')),
      h('button', { class: 'btn primary', type: 'button', onclick: () => openNewExperiment(lastP.vol, { series: name }) }, icon('plus', 18), h('span', null, '在此系列中新建'))] }),
    demoBanner(),
    h('article', { class: 'sheet plain wide-sheet' },
      h('p', { class: 'series-meta' }, `${dateRange(ps)}　·　${lib.volume(first.vol)?.title || ''}　·　SOP ${[...new Set(ps.map((x) => x.protocol).filter(Boolean))].join('、') || '—'}`),
      h('h2', null, '全部条件与结果'),
      h('div', { class: 'search-row' }, filter, sortBtn),
      h('div', { class: 'samples-wrap' }, h('table', { class: 'samples series-table' },
        h('thead', null,
          h('tr', { class: 'group' }, h('th', { colspan: 2 }), conds.length ? h('th', { colspan: conds.length }, '条件') : null, results.length ? h('th', { colspan: results.length, class: 'res' }, '结果') : null, h('th')),
          h('tr', null, h('th', null, '日期'), h('th', null, '实验 / 样品'), cols.map((c) => h('th', { class: isResultCol(c) ? 'res' : null }, colLabel(c))), h('th', null, '备注'))),
        body)),
      h('h2', null, '各次实验'),
      h('ol', { class: 'ledger-rows series-list' }, [...ps].reverse().map((p) => h('li', null, h('a', { href: `#/v/${p.vol}/${p.num}` },
        h('span', { class: 'l-date' }, p.date),
        h('span', { class: 'l-title' }, p.xid ? h('span', { class: 'xid-tag' }, p.xid) : null, p.title, p.void ? h('span', { class: 'void-tag' }, '已作废') : null),
        h('span', { class: 'l-where' }, `${(p.samples || []).length} 个样品`)))))));
}

function exportSeries(name, ps) {
  const live = ps.filter((p) => !p.void);
  const a = live[0]?.date || ''; const b = live[live.length - 1]?.date || '';
  modal({
    title: `导出系列“${name}”`,
    body: h('p', null, `共 ${live.length} 次实验（${a} ~ ${b}），已作废的不导出。`),
    buttons: [{ label: '取消' },
      { label: '导出 Word', run: () => exportWord(live, a, b, { title: name }) },
      { label: '导出 PDF', primary: true, run: () => exportPdf(live, a, b, { title: name }) }],
  });
}

// Two ways out of a series: drop the label (pages stay) or delete every page in it.
function openDeleteSeries(name, ps) {
  const signed = ps.filter((p) => p.signed).length;
  const radio = (v, title, note, checked) => h('label', { class: 'check choice' }, h('input', { type: 'radio', name: 'ds-mode', value: v, checked }), ' ',
    h('span', null, h('b', null, title), h('br'), h('span', { class: 'muted' }, note)));
  const word = h('input', { id: 'ds-word', autocomplete: 'off', placeholder: name });
  const wordRow = h('div', { class: 'form', hidden: true }, h('label', { for: 'ds-word' }, `请输入系列名称“${name}”确认`), word);
  const body = h('div', { class: 'form' },
    h('p', null, `系列“${name}”共 ${ps.length} 页${signed ? `（其中 ${signed} 页已签名）` : ''}：`),
    h('ol', { class: 'pick-list small' }, ps.map((p) => h('li', null, h('span', { class: 'c-date' }, `p. ${p.num}　${p.date}`), ' ', p.xid ? h('span', { class: 'xid-tag' }, p.xid) : null, ' ', p.title))),
    radio('dissolve', '解散系列（保留全部实验页）', `只去掉这些页上的“系列”标签，内容不动。${signed ? '已签名的页会在修订记录里写明“解散系列”。' : ''}`, true),
    radio('delete', `永久删除系列及其全部 ${ps.length} 页`, DELETE_NOTE, false),
    wordRow);
  body.addEventListener('change', () => { wordRow.hidden = body.querySelector('input[name=ds-mode]:checked').value !== 'delete'; });
  modal({
    title: `删除系列“${name}”`, wide: true, body,
    buttons: [{ label: '取消' }, {
      label: '确定', danger: true,
      run: () => {
        const mode = body.querySelector('input[name=ds-mode]:checked').value;
        if (mode === 'delete' && word.value.trim() !== name) { toast('输入的系列名称不一致。'); return false; }
        setTimeout(() => (mode === 'delete' ? deleteSeriesPages(ps) : dissolveSeries(name, ps)), 50);
      },
    }],
  });
}
async function dissolveSeries(name, ps) {
  toast('正在解散系列…');
  try {
    for (const p of ps) await updatePage(p.vol, p.num, ({ fm: f, body }) => { delete f.series; return { fm: f, body }; }, `Remove p. ${p.num} from series`, `解散系列“${name}”`);
    toast(`已解散“${name}”，${ps.length} 页保留。`);
    location.hash = `#/v/${ps[0].vol}`;
  } catch (e) { toast(saveError(e)); }
}
async function deleteSeriesPages(ps) {
  const byVol = new Map();
  for (const p of ps) byVol.set(p.vol, [...(byVol.get(p.vol) || []), p.num]);
  toast('正在删除并重新编页…');
  try {
    for (const [vol, nums] of byVol) await lib.deletePages(vol, nums);
    toast(`已删除系列的 ${ps.length} 页，页码已重新连续编号。`);
    location.hash = `#/v/${ps[0].vol}`; route({ quiet: true });
  } catch (e) { toast(saveError(e)); }
}

async function setSeries(vol, num, fm) {
  const names = allSeries().map((x) => x.name);
  const v = window.prompt(`所属系列名称（留空表示不属于任何系列）${names.length ? `\n已有：${names.join('、')}` : ''}`, fm.series || '');
  if (v == null) return;
  try {
    await updatePage(vol, num, ({ fm: f, body }) => { if (v.trim()) f.series = v.trim(); else delete f.series; return { fm: f, body }; }, `Series of p. ${num}`, v.trim() ? `归入系列“${v.trim()}”` : '移出系列');
    toast(v.trim() ? `已归入“${v.trim()}”。` : '已移出系列。');
  } catch (e) { toast(saveError(e)); }
}

// ----- delete / void -----
function confirmTyped(title, text, word, label) {
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
async function openDeleteVolume(v) {
  const n = lib.pages(v.id).length;
  const ok = await confirmTyped(`删除卷“${v.title}”`, `将删除这个卷和其中的 ${n} 页（含照片附件）。GitHub 历史和硬盘上的每周备份里仍保留旧版本，必要时可以找回。`, v.title, '删除');
  if (!ok) return;
  try { await lib.deleteVolume(v.id); toast(`已删除“${v.title}”。`); location.hash = '#/'; } catch (e) { toast(saveError(e)); }
}
const DELETE_NOTE = '页面和它的照片、附件从记录本中删除，后面的页码自动前移（第 1 页起连续编号），所有指向被移动页面的链接、引用、证据和待办会一起更新。实验编号（如 20261101-OECT-01）不变。旧版本只留在 GitHub 历史和硬盘上的每周备份里。';
async function openDeletePage(vol, num, fm) {
  const word = fm.id || `${num}`;
  const ok = await confirmTyped('永久删除这一页', `“${fm.title || '未命名'}”${fm.signed ? '（已签名的正式记录）' : ''}将被删除。${DELETE_NOTE}`, word, '永久删除');
  if (!ok) return;
  await runDelete(vol, [num]);
}
async function runDelete(vol, nums) {
  toast('正在删除并重新编页…');
  try {
    const map = await lib.deletePages(vol, nums);
    toast(`已删除 ${nums.length} 页${map?.size ? `，${map.size} 页页码已前移` : ''}。`);
    location.hash = `#/v/${vol}`; route({ quiet: true });
  } catch (e) { toast(saveError(e)); }
}
// Tick several pages (e.g. font-test drafts) and delete them in one go.
function openBulkDelete(volId) {
  const pages = lib.pages(volId);
  const checks = pages.map((p) => ({ p, box: h('input', { type: 'checkbox' }) }));
  const word = h('input', { id: 'bd-word', autocomplete: 'off', placeholder: '删除' });
  modal({
    title: '批量永久删除', wide: true,
    body: h('div', { class: 'form' },
      h('span', { class: 'label' }, '勾选要删除的页'),
      h('div', { class: 'pick-list' }, checks.map(({ p, box }) => h('label', { class: 'check' }, box, ' ', h('span', { class: 'c-date' }, `p. ${p.num}`), ' ',
        h('span', { class: 'c-date' }, fmtDate(p.date)), ' ', p.xid ? h('span', { class: 'xid-tag' }, p.xid) : null, ' ', p.title, p.signed ? h('span', { class: 'toc-tags' }, '（已签名）') : null))),
      h('p', { class: 'muted' }, DELETE_NOTE),
      h('label', { for: 'bd-word' }, '请输入“删除”确认'), word),
    buttons: [{ label: '取消' }, {
      label: '永久删除', danger: true,
      run: async () => {
        const nums = checks.filter((c) => c.box.checked).map((c) => c.p.num);
        if (!nums.length) { toast('至少勾选一页。'); return false; }
        if (word.value.trim() !== '删除') { toast('请输入“删除”确认。'); return false; }
        setTimeout(() => runDelete(volId, nums), 50);
      },
    }],
  });
}
async function setVoid(vol, num, fm) {
  let reason = '';
  if (fm) {
    reason = window.prompt('作废原因（会写在页面顶部，例如：样品污染，数据无效；或：重复记录，见 20261101-OECT-02）');
    if (reason == null) return;
    if (!reason.trim()) { toast('请写一个作废原因。'); return; }
  }
  try {
    await updatePage(vol, num, ({ fm: f, body }) => {
      if (fm) f.void = `${todayISO()} ${reason.trim()}`; else delete f.void;
      return { fm: f, body };
    }, fm ? `Void p. ${num}` : `Restore p. ${num}`, fm ? `作废：${reason.trim()}` : '取消作废');
    toast(fm ? '已作废。页面保留，搜索和导出时默认隐藏。' : '已取消作废。');
  } catch (e) { toast(saveError(e)); }
}

// ----- new experiment -----
async function openNewExperiment(volId, { series: presetSeries = '' } = {}) {
  const vols = lib.volumes();
  if (!vols.length) { toast('先建一个卷（项目），再在里面新建实验。'); openNewVolume(); return; }
  const protocols = await loadProtocols(lib).catch(() => []);
  const reagents = await loadReagents(lib).catch(() => []);
  const volSel = h('select', { id: 'ne-vol' }, vols.map((v) => h('option', { value: v.id, selected: v.id === volId }, v.title)));
  const date = h('input', { id: 'ne-date', type: 'date', value: todayISO() });
  const topic = h('input', { id: 'ne-topic', placeholder: '例如 OECT、GLU3E、H2O2', autocapitalize: 'characters' });
  const idOut = h('code', { class: 'exp-id' });
  const title = h('input', { id: 'ne-title', placeholder: '例如：GOPS 浓度对 PEDOT:PSS 沟道稳定性的影响' });
  const seriesIn = h('input', { id: 'ne-series', list: 'ne-series-list', value: presetSeries, placeholder: '例如：PEDOT:PSS 配方优化（同一主题多天的实验归到一起）' });
  const seriesList = h('datalist', { id: 'ne-series-list' }, allSeries().map((x) => h('option', { value: x.name })));
  const purpose = h('textarea', { id: 'ne-purpose', rows: 2, placeholder: '一两句话写清楚想回答的问题' });
  const hypSel = h('select', { id: 'ne-hyp' }, h('option', { value: '' }, '（不检验特定假设）'));
  loadHypotheses(lib).then((hs) => hypSel.append(...hs.filter((x) => !['否定', '搁置'].includes(x.status)).map((x) => h('option', { value: x.id }, `${x.id} · ${x.title}`)))).catch(() => {});
  const proto = h('select', { id: 'ne-proto' }, h('option', { value: '' }, '（不使用 SOP）'), protocols.map((p) => h('option', { value: p.id }, `${p.id} · ${p.title}`)));
  const nums = h('input', { id: 'ne-nums', value: '1-3', placeholder: '例如 1, 9, 10 或 1-6' });
  const vars = h('input', { id: 'ne-vars', placeholder: '逗号分隔，例如 GOPS (wt%), 退火 (°C)' });
  const res = h('input', { id: 'ne-res', placeholder: '逗号分隔，例如 gm_max (mS), Vth (V), on/off' });
  const rFilter = h('input', { type: 'search', placeholder: '筛选试剂', 'aria-label': '筛选试剂' });
  const picked = new Set();
  const rList = h('div', { class: 'check-list' });
  const drawR = () => {
    const q = rFilter.value.trim().toLowerCase();
    // The library holds hundreds of bottles: show the ticked ones, plus search hits once something is typed.
    const hits = reagents.filter((r) => picked.has(r.id) || (q && `${r.id} ${r.name} ${r.name_en || ''} ${r.cas || ''} ${r.vendor} ${r.location || ''}`.toLowerCase().includes(q))).slice(0, 60);
    rList.replaceChildren(...(q || picked.size ? [] : [h('p', { class: 'muted' }, `输入名称、英文名、CAS 或存放位置搜索（试剂库共 ${reagents.length} 种）。`)]), ...hits.map((r) => h('label', { class: 'check' },
      h('input', { type: 'checkbox', checked: picked.has(r.id), onchange: (e) => { if (e.target.checked) picked.add(r.id); else picked.delete(r.id); } }),
      ` ${r.id} ${r.name}`, h('span', { class: 'muted' }, [r.cas, r.vendor, r.location].filter(Boolean).map((x) => ` · ${x}`).join('')))));
    if (!reagents.length) rList.append(h('p', { class: 'muted' }, '试剂库还是空的。可在“试剂库”里导入。'));
  };
  rFilter.addEventListener('input', drawR); drawR();
  rFilter.placeholder = '搜索试剂：名称、英文名、CAS、位置';
  const fuDays = h('input', { id: 'ne-fu', placeholder: '例如 1, 3, 7（天后）' });
  const fuText = h('input', { id: 'ne-fu-text', value: '稳定性复测' });
  const curVol = () => lib.volume(volSel.value);
  const upd = () => {
    if (!topic.dataset.touched) topic.value = curVol()?.code || '';
    const tp = cleanTopic(topic.value);
    idOut.textContent = tp ? expId(date.value, tp, nextSeq(lib.allPages(), date.value, tp)) : '（先填主题代码）';
  };
  topic.addEventListener('input', () => { topic.dataset.touched = '1'; upd(); });
  volSel.addEventListener('change', upd); date.addEventListener('change', upd);
  proto.addEventListener('change', () => {
    const p = protocols.find((x) => x.id === proto.value);
    if (!p) return;
    p.reagents.forEach((id) => picked.add(id)); drawR();
    if (!vars.value) vars.value = p.variables.join(', ');
    if (!res.value) res.value = p.results.join(', ');
  });
  // Picking an existing series copies the setup of its latest experiment.
  let seriesSteps = null;
  async function fromSeries() {
    const last = allSeries().find((x) => x.name === seriesIn.value.trim())?.pages.slice(-1)[0];
    if (!last) return;
    const { fm: lf, body: lb } = parseFrontMatter(await lib.readPage(last.vol, last.num));
    volSel.value = last.vol;
    const code = String(lf.id || '').split('-')[1];
    if (code) { topic.value = code; topic.dataset.touched = '1'; }
    if (lf.protocol) proto.value = lf.protocol;
    picked.clear(); (lf.reagents || []).forEach((id) => picked.add(id)); drawR();
    seriesSteps = readSteps(lb);
    const t = readSamples(lb);
    if (t) {
      vars.value = t.cols.slice(1).filter((c) => !isResultCol(c) && c !== '备注').join(', ');
      res.value = t.cols.filter(isResultCol).map(colLabel).join(', ');
    }
    if (!title.value) title.placeholder = `例如：${seriesIn.value.trim()} 第 ${allSeries().find((x) => x.name === seriesIn.value.trim()).pages.length + 1} 轮：改变旋涂速度`;
    upd();
  }
  seriesIn.addEventListener('change', fromSeries);
  upd();
  if (presetSeries) setTimeout(fromSeries, 0);
  modal({
    title: presetSeries ? `在“${presetSeries}”中新建实验` : '新建实验', wide: true,
    body: h('div', { class: 'form two' },
      h('div', null,
        h('label', { for: 'ne-vol' }, '放在哪个卷'), volSel,
        h('div', { class: 'pair' }, h('div', null, h('label', { for: 'ne-date' }, '日期'), date), h('div', null, h('label', { for: 'ne-topic' }, '主题代码'), topic)),
        h('p', { class: 'id-line' }, '实验编号 ', idOut),
        h('label', { for: 'ne-series' }, '所属系列（可选）'), seriesIn, seriesList,
        h('label', { for: 'ne-title' }, '标题'), title,
        h('label', { for: 'ne-hyp' }, '检验的假设（思维笔记本）'), hypSel,
        h('label', { for: 'ne-purpose' }, '目的'), purpose,
        h('label', { for: 'ne-proto' }, '标准步骤（SOP）'), proto,
        h('label', { for: 'ne-nums' }, '样品 / 条件编号'), nums,
        h('label', { for: 'ne-vars' }, '每个编号不同的条件'), vars,
        h('label', { for: 'ne-res' }, '要记录的结果'), res),
      h('div', null,
        h('span', { class: 'label' }, '用到的试剂'), rFilter, rList,
        h('label', { for: 'ne-fu' }, '提醒（可选）'), h('div', { class: 'pair' }, fuDays, fuText),
        h('p', { class: 'muted' }, '提醒会出现在首页“今日待办”，也能导出到手机日历。'))),
    buttons: [{ label: '取消' }, {
      label: '创建并打印记录卡', run: () => create(true),
    }, {
      label: '创建', primary: true, run: () => create(false),
    }],
  });
  async function create(print) {
    const tp = cleanTopic(topic.value);
    if (!tp) { toast('填一个主题代码，例如 OECT。'); topic.focus(); return false; }
    if (!title.value.trim()) { toast('写一个标题。'); title.focus(); return false; }
    const vol = volSel.value;
    const xid = expId(date.value, tp, nextSeq(lib.allPages(), date.value, tp));
    const split = (s) => s.split(/[,，]/).map((x) => x.trim()).filter(Boolean);
    const t = samplesTemplate(parseNumbers(nums.value), split(vars.value), split(res.value));
    const p = protocols.find((x) => x.id === proto.value);
    const fus = parseNumbers(fuDays.value).map((d) => formatFollowup({ date: addDays(date.value, d), text: `${fuText.value.trim() || '复测'}（第 ${d} 天）` }));
    const fm = {
      title: title.value.trim(), date: date.value, id: xid,
      tags: [...new Set([tp.toLowerCase(), ...(p?.tags || []).map(cleanTag)])].filter(Boolean),
      protocol: p?.id || undefined, reagents: [...picked], followups: fus,
      series: seriesIn.value.trim() || undefined,
      hypotheses: hypSel.value ? [hypSel.value] : undefined,
    };
    const bodyText = [
      '## 目的', '', ...(hypSel.value ? [hypBlock(hypSel.value, ''), ''] : []), purpose.value.trim() || '', '',
      '## 条件与结果', '',
      '> 编号与纸质记录卡一一对应。结果可用“录入表格”填写；Keithley 数据同步后自动填入空着的结果格。', '',
      `\`\`\`samples\n${toCSV([t.cols, ...t.rows]).trimEnd()}\n\`\`\``, '',
      ...(() => {
        // Steps carried over from the last run of the series, or from the SOP, so only what changed needs editing.
        const st = seriesSteps || (p && readSteps(p.body));
        return st?.length ? ['## 操作步骤', '', `\`\`\`steps\n${stepsText(st)}\n\`\`\``, ''] : [];
      })(),
      '## 与 SOP 的偏离', '', '- ', '',
      '## 现象与讨论', '', '',
      '## 结论', '', '',
      '## 下一步', '', '- ', '',
      '## 照片', '',
    ].join('\n');
    try {
      const r = await lib.savePage({ vol, isNew: true, fm, body: bodyText, attachments: [], message: `New experiment ${xid}` });
      toast(r.queued ? `${xid} 已存在本机，联网后同步。` : `已创建 ${xid}。`);
      location.hash = `#/v/${vol}/${r.num}`;
      if (print) setTimeout(() => printCard(vol, r.num), 600);
    } catch (e) { toast(saveError(e)); return false; }
  }
}

// ----- reagent library -----
async function viewReagents() {
  const list = await loadReagents(lib);
  const fields = reagentFields(lib.notebook);
  const filter = h('input', { type: 'search', placeholder: '按编号、中英文名、CAS、厂商、存放位置、订购者筛选', 'aria-label': '筛选' });
  const body = h('tbody');
  const today = todayISO();
  const usedBy = (id) => lib.allPages().filter((p) => (p.reagents || []).includes(id));
  const draw = () => {
    const q = filter.value.trim().toLowerCase();
    body.replaceChildren(...list.filter((r) => !q || Object.values(r).join(' ').toLowerCase().includes(q)).map((r) => {
      const n = usedBy(r.id).length;
      return h('tr', { onclick: () => editReagent(list, r) },
        fields.map(([k]) => h('td', { class: k === 'expires' && r.expires && r.expires < today ? 'warn' : null }, r[k] || '')),
        h('td', null, n ? h('a', { href: `#/search?q=${encodeURIComponent(r.id)}`, onclick: (e) => e.stopPropagation() }, `${n} 次`) : ''));
    }));
  };
  filter.addEventListener('input', draw); draw();
  const importIn = h('input', { type: 'file', accept: '.csv,text/csv', hidden: true, onchange: async (e) => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    const incoming = parseReagents(await f.text(), fields);
    if (!incoming.length) { toast('文件里没有读到试剂（第一行要是列名，必须有 id 列）。'); return; }
    const byId = new Map(list.map((r) => [r.id, r]));
    for (const r of incoming) byId.set(r.id, { ...(byId.get(r.id) || {}), ...r });
    await saveReagents([...byId.values()], `Import ${incoming.length} reagents`);
    toast(`已导入 ${incoming.length} 条。`); route();
  } });
  return h('div', { class: 'view library' },
    topbar({ back: '#/', backLabel: '首页', title: '试剂库', sub: `${list.length} 条`, actions: [
      h('button', { class: 'btn', type: 'button', onclick: () => editLibColumns('r', list) }, icon('table', 18), h('span', { class: 'wide-only' }, '管理列')),
      h('button', { class: 'btn danger', type: 'button', onclick: () => openLibBulkDelete('r', list) }, icon('trash', 18), h('span', { class: 'wide-only' }, '批量删除')),
      h('button', { class: 'btn primary', type: 'button', onclick: () => editReagent(list, null) }, icon('plus', 18), h('span', null, '新增试剂'))] }),
    demoBanner(),
    h('article', { class: 'sheet plain' },
      h('div', { class: 'search-row' }, filter,
        h('button', { class: 'btn', type: 'button', onclick: () => importIn.click() }, '导入 CSV'),
        h('button', { class: 'btn', type: 'button', onclick: () => downloadText('reagents.csv', `\uFEFF${reagentsCSV(list, fields)}`, 'text/csv') }, '导出 CSV'), importIn),
      h('div', { class: 'table-wrap tall' }, h('table', { class: 'data lib-table' }, thead([...fields.map(([, l]) => l), '使用']), body)),
      h('p', { class: 'muted' }, '点一行可修改。批号换了就新建一条（新编号），旧实验仍指向旧批号，保证可溯源。')));
}

// ----- lab-made solutions (S-0001): what went in, when, by whom, until when -----
async function viewSolutions() {
  const list = await loadSolutions(lib);
  const reagents = await loadReagents(lib).catch(() => []);
  const nameOf = (id) => reagents.find((r) => r.id === id)?.name || list.find((r) => r.id === id)?.name || '';
  const fields = solutionFields(lib.notebook);
  const filter = h('input', { type: 'search', placeholder: '按编号、名称、组成、日期筛选', 'aria-label': '筛选' });
  const showAll = h('input', { type: 'checkbox', id: 'sl-all' });
  const body = h('tbody');
  const today = todayISO();
  const usedIn = (id) => search(lib.allPages(), id).length;
  const draw = () => {
    const q = filter.value.trim().toLowerCase();
    body.replaceChildren(...list.filter((r) => (showAll.checked || !['用完', '废弃'].includes(r.status)) && (!q || Object.values(r).join(' ').toLowerCase().includes(q)))
      .sort((a, b) => String(b.id).localeCompare(String(a.id))).map((r) => {
        const n = usedIn(r.id);
        // Known columns keep their own look; added columns show as plain text.
        const cell = (k) => {
          if (k === 'id') return h('td', { class: 'mono' }, r.id);
          if (k === 'name') return h('td', null, h('b', null, r.name));
          if (k === 'recipe') return h('td', null, parseRecipe(r.recipe).map((c) => h('div', { class: 'recipe-line' }, h('span', { class: 'rg-id', 'data-rid': c.id }, c.id), ` ${nameOf(c.id)} `, h('span', { class: 'qty' }, c.amount))));
          if (k === 'prepared') return h('td', { class: 'mono' }, r.prepared || '');
          if (k === 'expires') return h('td', { class: `mono${r.expires && r.expires < today ? ' warn' : ''}` }, r.expires || '');
          if (k === 'page') return h('td', null, r.page ? h('a', { href: `#/search?q=${encodeURIComponent(r.page)}`, onclick: (e) => e.stopPropagation() }, r.page) : '');
          if (k === 'status') return h('td', null, r.status || '在用');
          return h('td', null, r[k] || '');
        };
        return h('tr', { class: ['用完', '废弃'].includes(r.status) ? 'retired' : null, onclick: () => editSolution(list, r) },
          fields.map(([k]) => cell(k)),
          h('td', null, n ? h('a', { href: `#/search?q=${encodeURIComponent(r.id)}`, onclick: (e) => e.stopPropagation() }, `${n} 次`) : ''));
      }));
  };
  filter.addEventListener('input', draw); showAll.addEventListener('change', draw); draw();
  return h('div', { class: 'view library' },
    topbar({ back: '#/', backLabel: '首页', title: '溶液库', sub: `${list.length} 批`, actions: [
      h('button', { class: 'btn', type: 'button', onclick: () => editLibColumns('s', list) }, icon('table', 18), h('span', { class: 'wide-only' }, '管理列')),
      h('button', { class: 'btn danger', type: 'button', onclick: () => openLibBulkDelete('s', list) }, icon('trash', 18), h('span', { class: 'wide-only' }, '批量删除')),
      h('button', { class: 'btn primary', type: 'button', onclick: () => editSolution(list, null) }, icon('plus', 18), h('span', null, '登记新溶液'))] }),
    demoBanner(),
    h('article', { class: 'sheet plain' },
      h('div', { class: 'search-row' }, filter, h('label', { class: 'check', for: 'sl-all' }, showAll, ' 显示已用完/废弃'),
        h('button', { class: 'btn', type: 'button', onclick: () => downloadText('solutions.csv', `\uFEFF${reagentsCSV(list, solutionFields(lib.notebook))}`, 'text/csv') }, '导出 CSV')),
      h('div', { class: 'table-wrap tall' }, h('table', { class: 'data lib-table sol-table' }, thead([...fields.map(([, l]) => l), '使用']), body)),
      h('p', { class: 'muted' }, '每配一批就登记一条（新编号），瓶签写 S-编号。步骤里选这个编号，就能从实验追到这批溶液、再追到每瓶试剂的批号。')));
}

function editSolution(list, s, preset = {}) {
  const isNew = !s;
  const r = s ? { ...s } : { id: nextSolutionId([...list, ...refIds('S')]), prepared: preset.prepared || todayISO(), by: signerName(), page: preset.page || '', status: '在用' };
  const reagents = [];
  const lists = h('datalist', { id: 'sol-ids' });
  loadReagents(lib).then((rs) => { reagents.push(...rs); lists.replaceChildren(...rs.map((x) => h('option', { value: x.id }, `${x.name}${x.lot ? ` · 批号 ${x.lot}` : ''}`)), ...list.filter((x) => x.id !== r.id).map((x) => h('option', { value: x.id }, `${x.name}（自配，${x.prepared || ''}）`))); drawRows(); }).catch(() => {});
  // Components: from the record, or from the page's steps (substances with an R-/S- number and their amounts).
  let rows = parseRecipe(r.recipe);
  if (!rows.length && preset.steps?.length) rows = preset.steps.map((st) => ({ id: (st.what.match(/[RS]-\d{4}/) || [''])[0], amount: st.amount })).filter((x) => x.id);
  if (!rows.length) rows = [{ id: '', amount: '' }];
  const rowsBox = h('div', { class: 'recipe-rows' });
  const nameFor = (id) => reagents.find((x) => x.id === id)?.name || list.find((x) => x.id === id)?.name || '';
  function drawRows() {
    rowsBox.replaceChildren(...rows.map((c, i) => h('div', { class: 'recipe-row' },
      h('input', { value: c.id, list: 'sol-ids', placeholder: 'R-0001 / S-0002', 'aria-label': '试剂或溶液编号', oninput: (e) => { c.id = e.target.value.trim().toUpperCase(); e.target.nextElementSibling.textContent = nameFor(c.id); } }),
      h('span', { class: 'recipe-name' }, nameFor(c.id)),
      h('input', { value: c.amount, placeholder: '1 mL / 10 µL / 50 mg', 'aria-label': '用量', oninput: (e) => { c.amount = e.target.value; } }),
      h('button', { class: 'btn icon small ghost', type: 'button', 'aria-label': '删除', onclick: () => { rows.splice(i, 1); drawRows(); } }, icon('close', 14)))),
    h('button', { class: 'btn small', type: 'button', onclick: () => { rows.push({ id: '', amount: '' }); drawRows(); } }, icon('plus', 14), '加一种成分'));
  }
  drawRows();
  const inputs = {};
  const cols = solutionFields(lib.notebook);
  const labelOf = (k, dflt) => cols.find(([c]) => c === k)?.[1] || dflt;
  const field = (k, label, attrs = {}) => {
    if (!cols.some(([c]) => c === k)) return [];
    inputs[k] = h('input', { id: `sol-${k}`, value: r[k] || '', ...attrs }); return [h('label', { for: `sol-${k}` }, labelOf(k, label)), inputs[k]];
  };
  const extra = cols.filter(([k]) => !SOLUTION_FIELDS.some(([d]) => d === k)).flatMap(([k, l]) => field(k, l));
  const status = h('select', { id: 'sol-status' }, SOLUTION_STATUS.map((x) => h('option', { selected: (r.status || '在用') === x }, x)));
  modal({
    title: isNew ? `登记溶液 ${r.id}` : `溶液 ${r.id}`, wide: true,
    body: h('div', { class: 'form two' },
      h('div', null,
        ...field('name', '名称', { placeholder: '例如：PEDOT:PSS 墨水（1 wt% GOPS）' }),
        h('span', { class: 'label' }, '组成（从试剂库/溶液库选编号，写用量）'), lists, rowsBox,
        ...field('conc', '浓度/配比', { placeholder: '例如：1 wt% GOPS / 10 mM' })),
      h('div', null,
        ...field('volume', '总量', { placeholder: '例如：5 mL' }),
        ...field('prepared', '配制日期', { type: 'date' }),
        ...field('by', '配制人'),
        ...field('expires', '有效期至', { type: 'date' }),
        ...field('location', '存放位置', { placeholder: '例如：4 °C 冰箱 第 2 层' }),
        ...field('page', '配制记录（实验编号）', { placeholder: '20261102-OECT-01' }),
        h('label', { for: 'sol-status' }, '状态'), status,
        ...field('notes', '备注'), ...extra)),
    buttons: [isNew ? null : { label: '删除', danger: true, run: () => { setTimeout(() => deleteLibEntries('s', [r.id]), 50); } }, { label: '取消' }, {
      label: '保存', primary: true,
      run: async () => {
        for (const k of Object.keys(inputs)) r[k] = inputs[k].value.trim();
        r.recipe = recipeText(rows); r.status = status.value;
        if (!r.name) { toast('写一个名称。'); return false; }
        try {
          await lib.commit(`${isNew ? 'Add' : 'Update'} solution ${r.id}`, async (l) => {
            const cur = l.tree.has(SOLUTIONS_PATH) ? await loadSolutions(l) : [];
            const next = [...cur.filter((x) => x.id !== r.id), r].sort((a, b) => String(a.id).localeCompare(String(b.id)));
            return { changes: [{ path: SOLUTIONS_PATH, data: `\uFEFF${reagentsCSV(next, solutionFields(lib.notebook))}` }] };
          });
          toast(`${r.id} 已保存。瓶签请写 ${r.id}。`);
          if (view.kind === 'library') route({ quiet: true });
        } catch (e) { toast(saveError(e)); return false; }
      },
    }],
  });
}

async function saveReagents(list, message) {
  list.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return lib.commit(message, async () => ({ changes: [{ path: REAGENTS_PATH, data: `\uFEFF${reagentsCSV(list, reagentFields(lib.notebook))}` }] }));
}

// Both libraries keep their own column lists in notebook.json.
const LIBS = {
  r: { name: '试剂库', unit: '试剂', path: REAGENTS_PATH, nbKey: 'reagentColumns', fields: () => reagentFields(lib.notebook), locked: LOCKED_REAGENT_KEYS, load: () => loadReagents(lib) },
  s: { name: '溶液库', unit: '溶液', path: SOLUTIONS_PATH, nbKey: 'solutionColumns', fields: () => solutionFields(lib.notebook), locked: LOCKED_SOLUTION_KEYS, load: () => loadSolutions(lib) },
};
// Rename, add, remove and reorder a library's columns.
function editLibColumns(kind, list) {
  const L = LIBS[kind];
  const cols = L.fields().map(([k, l]) => ({ k, l }));
  const box = h('div', { class: 'col-list' });
  const draw = () => box.replaceChildren(...cols.map((c, i) => h('div', { class: 'col-row' },
    h('input', { value: c.l, 'aria-label': '列名', oninput: (e) => { c.l = e.target.value; } }),
    h('button', { class: 'btn icon small ghost', type: 'button', 'aria-label': '上移', disabled: i === 0, onclick: () => { cols.splice(i - 1, 0, cols.splice(i, 1)[0]); draw(); } }, '↑'),
    h('button', { class: 'btn icon small ghost', type: 'button', 'aria-label': '下移', disabled: i === cols.length - 1, onclick: () => { cols.splice(i + 1, 0, cols.splice(i, 1)[0]); draw(); } }, '↓'),
    L.locked.includes(c.k) ? h('span', { class: 'muted small lock' }, '必需')
      : h('button', { class: 'btn icon small ghost', type: 'button', 'aria-label': '删除这一列', onclick: () => { cols.splice(i, 1); draw(); } }, icon('close', 16)))));
  draw();
  const lockedNames = L.fields().filter(([k]) => L.locked.includes(k)).map(([, l]) => `“${l}”`).join('');
  modal({
    title: `管理${L.name}的列`,
    body: h('div', null,
      h('p', { class: 'muted' }, `改名直接改文字；↑↓ 调整顺序；× 删除这一列（这一列里填过的内容会一起删除，但 GitHub 历史里能找回）。${lockedNames}不能删。`),
      box,
      h('button', { class: 'btn small', type: 'button', onclick: () => { cols.push({ k: `c${Date.now().toString(36)}`, l: '新列' }); draw(); box.lastChild.querySelector('input').select(); } }, icon('plus', 16), '加一列')),
    buttons: [{ label: '取消' }, { label: '保存', primary: true, run: async () => {
      if (cols.some((c) => !c.l.trim())) { toast('列名不能为空。'); return false; }
      const removed = L.fields().filter(([k]) => !cols.some((c) => c.k === k));
      const lost = removed.filter(([k]) => list.some((r) => String(r[k] || '').trim()));
      if (lost.length && !window.confirm(`“${lost.map(([, l]) => l).join('、')}”里有填过的内容，会一起删除。确定吗？`)) return false;
      const fields = cols.map((c) => [c.k, c.l.trim()]);
      try {
        await lib.commit(`Change ${kind === 'r' ? 'reagent' : 'solution'} columns`, async (l) => {
          const nb = structuredClone(l.notebook);
          nb[L.nbKey] = fields;
          return {
            changes: [{ path: 'notebook.json', data: `${JSON.stringify(nb, null, 2)}\n` }, { path: L.path, data: `\uFEFF${reagentsCSV(list, fields)}` }],
            after: () => { l.notebook = nb; },
          };
        });
        toast('列已更新。'); setTimeout(() => route(), 300);
      } catch (e) { toast(saveError(e)); return false; }
    } }],
  });
}

// Numbers still written on pages count as taken, so a deleted entry's number is never handed out again.
const refIds = (p) => [...new Set(lib.allPages().flatMap((x) => String(x.text || '').match(new RegExp(`\\b${p}-\\d{4}\\b`, 'g')) || []))].map((id) => ({ id }));
// Pages that mention a library entry (its number in the resources table, steps or text).
const pagesUsing = (id) => search(lib.allPages(), id).map((r) => r.page);
// Remove entries from a library. Numbers are never reused, so old pages keep pointing at the right bottle.
async function deleteLibEntries(kind, ids) {
  const L = LIBS[kind];
  const used = ids.map((id) => [id, pagesUsing(id).length]).filter(([, n]) => n);
  const word = ids.length === 1 ? ids[0] : '删除';
  const ok = await confirmTyped(`从${L.name}删除 ${ids.length} 条`,
    `${ids.length === 1 ? ids[0] : `${ids.slice(0, 6).join('、')}${ids.length > 6 ? ` 等 ${ids.length} 条` : ''}`}将从${L.name}删除。${used.length ? `其中 ${used.map(([id, n]) => `${id}（${n} 页用到）`).slice(0, 5).join('、')}${used.length > 5 ? ' 等' : ''}被实验页引用，删除后这些页面的资源表会显示“库里没有这个编号”。` : '没有实验页引用它们。'}编号不会被重新使用；GitHub 历史里可以找回。`,
    word, '删除');
  if (!ok) return false;
  const gone = new Set(ids);
  try {
    await lib.commit(`Delete ${ids.length} ${kind === 'r' ? 'reagent' : 'solution'}${ids.length > 1 ? 's' : ''}`, async (l) => {
      const cur = await (kind === 'r' ? loadReagents(l) : loadSolutions(l));
      return { changes: [{ path: L.path, data: `\uFEFF${reagentsCSV(cur.filter((x) => !gone.has(x.id)), L.fields())}` }] };
    });
    toast(`已删除 ${ids.length} 条。`); setTimeout(() => route({ quiet: true }), 300);
    return true;
  } catch (e) { toast(saveError(e)); return false; }
}
// Tick entries (or everything matching a search) and delete them together.
function openLibBulkDelete(kind, list) {
  const L = LIBS[kind];
  const picked = new Set();
  const q = h('input', { type: 'search', placeholder: '筛选：编号、名称、CAS、位置、状态…', autocomplete: 'off' });
  const box = h('div', { class: 'pick-list' });
  const count = h('span', { class: 'muted' });
  const match = () => { const t = q.value.trim().toLowerCase(); return list.filter((x) => !t || Object.values(x).join(' ').toLowerCase().includes(t)); };
  const draw = () => {
    const rows = match();
    box.replaceChildren(...rows.slice(0, 300).map((x) => h('label', { class: 'check' },
      h('input', { type: 'checkbox', checked: picked.has(x.id), onchange: (e) => { if (e.target.checked) picked.add(x.id); else picked.delete(x.id); count.textContent = `已选 ${picked.size} 条`; } }),
      ' ', h('span', { class: 'c-date' }, x.id), ' ', x.name, h('span', { class: 'muted' }, [x.cas, x.conc, x.location, x.status].filter(Boolean).map((v) => ` · ${v}`).join(''))))
      , ...(rows.length > 300 ? [h('p', { class: 'muted' }, `只显示前 300 条，共 ${rows.length} 条；“全选筛选结果”会选中全部 ${rows.length} 条。`)] : []));
    count.textContent = `已选 ${picked.size} 条`;
  };
  q.addEventListener('input', draw); draw();
  modal({
    title: `批量删除 · ${L.name}`, wide: true,
    body: h('div', { class: 'form' },
      q,
      h('div', { class: 'row-actions' },
        h('button', { class: 'btn small', type: 'button', onclick: () => { match().forEach((x) => picked.add(x.id)); draw(); } }, '全选筛选结果'),
        h('button', { class: 'btn small', type: 'button', onclick: () => { picked.clear(); draw(); } }, '全不选'), count),
      box,
      h('p', { class: 'muted' }, `不筛选时“全选筛选结果”= 清空整个${L.name}。`)),
    buttons: [{ label: '取消' }, { label: '删除所选', danger: true, run: () => {
      if (!picked.size) { toast('至少勾选一条。'); return false; }
      setTimeout(() => deleteLibEntries(kind, [...picked]), 50);
    } }],
  });
}

function editReagent(list, r) {
  const isNew = !r;
  const cur = r ? { ...r } : { id: nextReagentId([...list, ...refIds('R')]) };
  const fields = reagentFields(lib.notebook);
  const inputs = Object.fromEntries(fields.map(([k]) => [k, h('input', {
    id: `rg-${k}`, value: cur[k] || '', type: k === 'opened' || k === 'expires' ? 'date' : 'text', readonly: k === 'id' && !isNew,
  })]));
  modal({
    title: isNew ? '新增试剂' : `修改 ${cur.id}`,
    body: h('div', { class: 'form grid2' }, fields.map(([k, l]) => h('div', null, h('label', { for: `rg-${k}` }, l), inputs[k]))),
    buttons: [
      isNew ? null : { label: '删除', danger: true, run: () => { setTimeout(() => deleteLibEntries('r', [cur.id]), 50); } },
      isNew ? null : { label: '用新批号复制', run: () => { setTimeout(() => editReagent(list, null), 0); setTimeout(() => { for (const [k] of fields) if (!['id', 'lot', 'opened', 'expires'].includes(k)) { const el = document.getElementById(`rg-${k}`); if (el) el.value = cur[k] || ''; } }, 60); } },
      { label: '取消' },
      { label: '保存', primary: true, run: async () => {
        const next = { ...(cur || {}), ...Object.fromEntries(fields.map(([k]) => [k, inputs[k].value.trim()])) };
        if (!next.id || !next.name) { toast('编号和名称不能为空。'); return false; }
        if (isNew && list.some((x) => x.id === next.id)) { toast('这个编号已经有了。'); return false; }
        const all = isNew ? [...list, next] : list.map((x) => (x.id === cur.id ? next : x));
        try { await saveReagents(all, `${isNew ? 'Add' : 'Update'} reagent ${next.id}`); toast('已保存。'); route(); } catch (e) { toast(saveError(e)); return false; }
      } },
    ].filter(Boolean),
  });
}

// ----- protocol library -----
async function viewProtocols() {
  const list = await loadProtocols(lib);
  const importIn = h('input', { type: 'file', accept: '.md,text/markdown', multiple: true, hidden: true, onchange: async (e) => {
    const files = [...e.target.files]; e.target.value = '';
    const changes = [];
    for (const f of files) {
      const text = await f.text();
      const p = parseProtocol(text);
      const id = cleanProtocolId(p.id || f.name.replace(/\.md$/i, ''));
      if (id) changes.push({ path: protocolPath(id), data: text });
    }
    if (!changes.length) return;
    try { await lib.commit(`Import ${changes.length} protocols`, async () => ({ changes })); toast(`已导入 ${changes.length} 个 SOP。`); route(); } catch (err) { toast(saveError(err)); }
  } });
  return h('div', { class: 'view library' },
    topbar({ back: '#/', backLabel: '首页', title: '步骤库（SOP）', sub: `${list.length} 个`, actions: [
      h('button', { class: 'btn', type: 'button', onclick: () => importIn.click() }, '导入 .md'), importIn,
      h('button', { class: 'btn primary', type: 'button', onclick: () => editProtocol(null) }, icon('plus', 18), h('span', null, '新建 SOP'))] }),
    demoBanner(),
    h('article', { class: 'sheet plain' },
      list.length ? h('table', { class: 'data lib-table' }, thead(['编号', '名称', '版本', '试剂', '用过']),
        h('tbody', null, list.map((p) => h('tr', { onclick: () => { location.hash = `#/lib/protocols/${encodeURIComponent(p.id)}`; } },
          h('td', null, p.id), h('td', null, p.title), h('td', null, p.version), h('td', null, p.reagents.join(' ')),
          h('td', null, `${lib.allPages().filter((x) => x.protocol === p.id).length} 次`)))))
        : h('p', { class: 'muted' }, '还没有 SOP。点“导入 .md”导入预置的步骤库，或者新建。'),
      h('p', { class: 'muted' }, 'SOP 改版时请新建一个带新版本号的编号（例如 …-v3），不要改旧的：旧实验仍然指向当时用的版本。')));
}

async function viewProtocol(id) {
  const p = await loadProtocol(lib, id);
  if (!p) return viewMissing(`步骤库里没有 ${id}。`);
  const body = h('div', { class: 'prose' });
  await renderInto(body, p.body, { lib, vol: null, num: null, urls: view.urls, resolveBlob: async () => { throw new Error('no attachments'); } });
  const uses = lib.allPages().filter((x) => x.protocol === p.id).sort((a, b) => String(b.date).localeCompare(String(a.date)));
  return h('div', { class: 'view library' },
    topbar({ back: '#/lib/protocols', backLabel: '步骤库', title: p.id, sub: p.version, actions: [
      h('button', { class: 'btn', type: 'button', onclick: () => editProtocol(p) }, icon('edit', 18), h('span', null, '修改')),
      h('button', { class: 'btn primary', type: 'button', onclick: () => openNewExperiment('').then(() => { const s = document.getElementById('ne-proto'); if (s) { s.value = p.id; s.dispatchEvent(new Event('change')); } }) }, '用它新建实验')] }),
    demoBanner(),
    h('article', { class: 'sheet plain' },
      h('h1', null, p.title),
      h('p', { class: 'muted' }, [p.version && `版本 ${p.version}`, p.source && `原始文件 ${p.source}`].filter(Boolean).join(' · ')),
      p.reagents.length ? h('p', null, h('b', null, '试剂 '), p.reagents.join('、')) : null,
      p.variables.length ? h('p', null, h('b', null, '常变条件 '), p.variables.join('、')) : null,
      p.results.length ? h('p', null, h('b', null, '结果 '), p.results.join('、')) : null,
      body,
      uses.length ? h('section', null, h('h2', null, '用过这个 SOP 的实验'), h('ol', { class: 'ledger-rows' }, uses.map((x) => h('li', null, h('a', { href: `#/v/${x.vol}/${x.num}` },
        h('span', { class: 'l-date' }, x.date), h('span', { class: 'l-title' }, x.title), h('span', { class: 'l-where' }, x.xid || '')))))) : null));
}

function editProtocol(p) {
  const tpl = p ? null : '---\nid: SOP-NEW-v1\ntitle: \nversion: v1\nsource: \nreagents: []\nvariables: []\nresults: []\ntags: []\n---\n\n## 步骤\n\n1. \n';
  const ta = h('textarea', { class: 'editor-text', rows: 22, spellcheck: 'false' });
  const load = p ? lib.readText(protocolPath(p.id)) : Promise.resolve(tpl);
  load.then((t) => { ta.value = t; });
  modal({
    title: p ? `修改 ${p.id}` : '新建 SOP', wide: true,
    body: h('div', null, h('p', { class: 'muted' }, '开头 --- 之间是信息：id 编号、title 名称、version 版本、source 原始 PDF 路径、reagents 常用试剂编号、variables 常变条件、results 要记录的结果。下面是步骤正文（Markdown）。'), ta),
    buttons: [{ label: '取消' }, { label: '保存', primary: true, run: async () => {
      const np = parseProtocol(ta.value);
      const id = cleanProtocolId(np.id);
      if (!id) { toast('id 不能为空。'); return false; }
      const changes = [{ path: protocolPath(id), data: ta.value }];
      if (p && p.id !== id) changes.push({ path: protocolPath(p.id), delete: true });
      try { await lib.commit(`${p ? 'Update' : 'Add'} protocol ${id}`, async () => ({ changes })); toast('已保存。'); location.hash = `#/lib/protocols/${encodeURIComponent(id)}`; route(); } catch (e) { toast(saveError(e)); return false; }
    } }],
  });
}

boot();
