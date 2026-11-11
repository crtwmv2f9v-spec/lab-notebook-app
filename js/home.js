// Home page: greeting, today / week / memo cards, the side rails, the shelf of volumes.
import { NetworkError, kv } from './store.js';
import { fmtDate, todayISO, parseFrontMatter, zoned } from './model.js';
import { addDays, cleanTopic, daysFrom, loadHypotheses, sectionOf, readSamples, isResultCol, evidenceCounts, loadMethods } from './lab.js';
import { search } from './search.js';
import { h, icon } from './util.js';
import { S, demoBanner, lib, modal, toast, topbar, view, menu } from './core.js';
import { clipCounts, loadClips } from './clips.js';
import { autoFileFinds, findsCard, topicsOf } from './finds.js';
import { weekBoard } from './weekboard.js';
import {
  PAPER_STAGE, WEEKDAYS, addBox, allFollowups, changeTasks, editPaper, editProject, exportIcs,
  editable, isGoal, loadPlanner, moveTask, newTask, reminderRow, ring, taskRow,
  toggleTask, weekStart, projectTopic, topicChip,
} from './planner.js';
import { openNewExperiment } from './pages.js';
import { openExport } from './printing.js';
import { thinkCover } from './think.js';
import { openSearch } from './searchui.js';
import { route } from './app.js';

export const CLOTHS = [
  ['墨绿', '#24453a'], ['酒红', '#5b2228'], ['藏青', '#22335a'],
  ['石板灰', '#3c4247'], ['赭黄', '#7d5a1e'], ['梅紫', '#4a2c4a'],
];

// ---------- home ----------
// 接着做: the loose ends, gathered without typing anything — drafts still in this browser, pages waiting to
// sync, records not signed or missing a conclusion or result cells, hypotheses under test, method cards not yet in a paper.
export function continueCard() {
  const sub = h('p', { class: 'card-sub' }, '读取中…');
  const cols = h('div', { class: 'cont-grid' });
  const box = h('section', { class: 'cont-wrap' }, h('div', { class: 'tile cont-card' }, cardHead('接着做', sub), cols));
  const item = (x) => h('li', null, h('a', { class: 'cont-item', href: x.href },
    h('span', { class: 'ci-title' }, x.tag ? h('span', { class: 'xid-tag' }, x.tag) : null, x.title),
    h('span', { class: 'ci-meta' }, x.where ? h('span', null, x.where) : null, x.chips.map((c) => h('span', { class: `ci-chip${/草稿|冲突|缺|空/.test(c) ? ' warn' : ''}${c === '可重复' ? ' oc-ok' : c === '行不通' ? ' oc-fail' : ''}` }, c)))));
  const col = (title, list, empty) => h('div', { class: 'cont-col' }, h('h3', null, title, list.length ? h('span', null, String(list.length)) : null),
    list.length ? foldList(h('ul', null, list.map(item)), `cont-${title}`) : h('p', { class: 'muted small' }, empty));
  (async () => {
    const recs = [];
    const pre = `${lib.key}:draft:`;
    for (const k of await kv.keys(pre).catch(() => [])) {
      if (k.includes(':att:')) continue;
      const d = await kv.get(k).catch(() => null);
      if (!d) continue;
      const [vol, n] = k.slice(pre.length).split('/');
      recs.push({ title: d.fm?.title || '未命名草稿', where: `${lib.volume(vol)?.title || vol} · ${n === 'new' ? '新页' : `p. ${n}`}`, href: n === 'new' ? `#/v/${vol}/new` : `#/v/${vol}/${n}/edit`, chips: ['草稿未保存'] });
    }
    for (const o of (lib.outbox || []).filter((x) => x.status !== 'discarded')) {
      recs.push({ title: o.fm?.title || '未命名', where: `${lib.volume(o.vol)?.title || o.vol}${o.num ? ` · p. ${o.num}` : ''}`, href: o.num ? `#/v/${o.vol}/${o.num}` : `#/v/${o.vol}`, chips: [o.status === 'conflict' ? '有冲突' : '待同步'] });
    }
    const pages = lib.allPages().filter((p) => !p.void && !p.pending).sort((a, b) => String(b.date).localeCompare(String(a.date)) || b.num - a.num).slice(0, 25);
    for (const p of pages) {
      const chips = [];
      if (p.outcome) chips.push(p.outcome === 'ok' ? '可重复' : '行不通');
      if (!p.signed) chips.push('未签名');
      if (p.xid) {
        try {
          const { body } = parseFrontMatter(await lib.readPage(p.vol, p.num));
          if (!(sectionOf(body, '结论') || '').trim()) chips.push('缺结论');
          const t = readSamples(body);
          if (t) {
            const ri = t.cols.map((c, i) => (isResultCol(c) ? i : -1)).filter((i) => i >= 0);
            const empty = t.rows.reduce((n, r) => n + ri.filter((i) => !String(r[i] ?? '').trim()).length, 0);
            if (empty) chips.push(`结果空 ${empty} 格`);
          }
        } catch { /* offline and not cached: skip the detailed checks */ }
      }
      if (chips.length) recs.push({ title: p.title || '未命名', tag: p.xid, where: `${fmtDate(p.date)} · ${lib.volume(p.vol)?.title || p.vol}`, href: `#/v/${p.vol}/${p.num}`, chips });
    }
    const hyps = (await loadHypotheses(lib).catch(() => [])).filter((x) => ['提出', '验证中'].includes(x.status)).map((x) => {
      const n = evidenceCounts(x);
      return { title: x.title, tag: x.id, href: `#/think/${x.id}`, chips: [x.status, `支持 ${n['支持']} · 反对 ${n['反对']}`] };
    });
    const ms = (await loadMethods(lib).catch(() => [])).filter((m) => (m.status || '待写入') === '待写入');
    const byVol = [...new Set(ms.map((m) => m.vol || ''))].map((vol) => ({ title: vol ? (lib.volume(vol)?.title || vol) : '未归卷', href: vol ? `#/v/${vol}/methods` : '#/methods', chips: [`${ms.filter((m) => (m.vol || '') === vol).length} 张待写入`] }));
    sub.textContent = [`${recs.length} 条记录待收尾`, `${hyps.length} 条假设在验证`, `${ms.length} 张方法卡片待写入论文`].join(' · ');
    cols.replaceChildren(
      col('记录', recs, '记录都已签名、写完。'),
      col('假设', hyps, '没有在验证的假设。'),
      col('写进论文', byVol, '方法卡片都已写入论文。'));
  })().catch((e) => { sub.textContent = `读取失败：${e.message}`; });
  return box;
}

export function viewHome() {
  const vols = lib.volumes();
  const actions = [
    h('button', { class: 'btn primary', type: 'button', onclick: () => openNewExperiment('') }, icon('plus', 18), h('span', null, '新建实验')),
    h('a', { class: 'btn ghost lib-link', href: '#/lib/reagents' }, '试剂库'),
    h('a', { class: 'btn ghost lib-link', href: '#/lib/solutions' }, '溶液库'),
    h('a', { class: 'btn ghost lib-link', href: '#/lib/protocols' }, '步骤库'),
    h('a', { class: 'btn ghost lib-link', href: '#/methods', title: '全部方法卡片：写论文 Experimental 用的细节' }, '方法细节'),
    h('a', { class: 'btn ghost lib-link', href: '#/clips', title: '文献图和杂项（template 框线、作图参数…），按分类' }, '素材库'),
    h('button', { class: 'btn ghost lib-link', type: 'button', onclick: () => openExport('') }, '导出'),
    // Narrow screens: the same links folded into one menu, so the bar fits a phone.
    h('button', { class: 'btn ghost narrow-only', type: 'button', onclick: (e) => menu(e.currentTarget, [
      { icon: 'flask', label: '试剂库', run: () => { location.hash = '#/lib/reagents'; } },
      { icon: 'flask', label: '溶液库', run: () => { location.hash = '#/lib/solutions'; } },
      { icon: 'list', label: '步骤库', run: () => { location.hash = '#/lib/protocols'; } },
      { icon: 'list', label: '方法细节', run: () => { location.hash = '#/methods'; } },
      { icon: 'image', label: '素材库', run: () => { location.hash = '#/clips'; } },
      { icon: 'download', label: '导出', run: () => openExport('') },
    ]) }, '资料库'),
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

  homeHooks.clear();
  // Top to bottom: the week (goals, today, each day) → quick notes → what to pick up → the side boards → the notebooks.
  const { left, right, top } = homeRails();
  const shelf = h('section', { class: 'shelf', 'aria-label': '卷' });
  for (const v of vols) shelf.append(cover(v));
  shelf.append(thinkCover());
  shelf.append(h('button', { class: 'cover new-cover', type: 'button', onclick: openNewVolume },
    icon('plus', 28), h('span', null, vols.length ? '新建卷（项目）' : '建第一个卷（项目）')));
  root.append(
    hero(),
    top,
    weekBoard({ hooks: homeHooks, redraw: redrawHome }),
    h('h2', { class: 'section-title' }, '课题手记', h('span', null, '按课题记：碎片发现 · 待做实验 · 零散想法')),
    dashboard(),
    h('h2', { class: 'section-title' }, '记录本', h('span', null, `${vols.length} 卷 · ${lib.allPages().length} 页`)),
    shelf);
  if (!vols.length) root.append(h('p', { class: 'hint' }, '每个项目一个卷，页码在卷内连续编号，就像装订的记录本。'));
  root.append(h('div', { class: 'home-boards' }, left, right));
  return root;
}
export function cover(v) {
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

export function openNewVolume() {
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

export function clothPicker(current) {
  let value = current;
  const el = h('div', { class: 'swatches', role: 'radiogroup', 'aria-label': '封面颜色' });
  for (const [name, c] of CLOTHS) {
    const b = h('button', { type: 'button', class: 'swatch', role: 'radio', 'aria-checked': String(c === value), 'aria-label': name, title: name, style: { '--cloth': c } });
    b.onclick = () => { value = c; el.querySelectorAll('.swatch').forEach((s) => s.setAttribute('aria-checked', String(s === b))); };
    el.append(b);
  }
  return { el, value: () => value };
}

export function hero() {
  const t = todayISO(); const d = new Date(`${t}T12:00:00`);
  const hr = zoned(new Date().toISOString()).hour;
  const greet = hr < 5 ? '夜深了' : hr < 11 ? '早上好' : hr < 13 ? '中午好' : hr < 18 ? '下午好' : '晚上好';
  const name = (lib.notebook.owner || '').trim();
  return h('header', { class: 'hero' },
    h('p', { class: 'hero-eyebrow' }, `${d.getMonth() + 1} 月 ${d.getDate()} 日 · 星期${WEEKDAYS[(d.getDay() + 6) % 7]}`),
    h('h1', { class: 'hero-title' }, `${greet}${name ? `，${name}` : ''}。`));
}

// Everything on the home page that shows planner data redraws together, so an item added in a side list
// appears in today's to-dos at once (and the other way round).
export const homeHooks = new Set();
export const redrawHome = () => homeHooks.forEach((f) => f());

export const uid = (p) => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
// Deadlines count down on the deadline's own clock: this device's time plus S.deadlineOffset hours
// (13 h turns US Eastern winter time into Beijing time). A deadline date means the end of that day.
export const dlOffset = () => (S.deadlineOffset === '' || S.deadlineOffset == null || !Number.isFinite(Number(S.deadlineOffset)) ? 13 : Number(S.deadlineOffset));
const dlNow = () => new Date(Date.now() + dlOffset() * 3600e3);
const isoDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const dlDays = (iso) => daysFrom(iso, isoDay(dlNow()));
export const dlHours = (iso) => Math.max(0, Math.ceil((new Date(`${iso}T23:59:59`) - dlNow()) / 3600e3));
// The basis shown under the countdown: 北京时间 when the offset matches this device's gap to Beijing.
export const dlBasis = () => { const bj = 8 + new Date().getTimezoneOffset() / 60; return dlOffset() === 0 ? '按本机时间' : dlOffset() === bj ? '按北京时间' : `按本机时间 +${dlOffset()} 小时`; };
export const leftDays = (iso) => { const d = dlDays(iso); return d < 0 ? `逾期 ${-d} 天` : d <= 1 ? `${dlHours(iso)} 小时` : `${d} 天`; };
export const urgency = (iso) => { const d = dlDays(iso); return d < 0 ? 'late' : d <= 3 ? 'hot' : d <= 7 ? 'warm' : ''; };
// A one-line add box with an optional date beside it.
export function addDated(placeholder, onAdd, { dateRequired = false } = {}) {
  const date = h('input', { type: 'date', class: 'add-date', 'aria-label': '日期' });
  const box = addBox(placeholder, (text) => {
    if (dateRequired && !date.value) { toast('请选一个日期。'); return; }
    onAdd(text, date.value || null); date.value = '';
  });
  box.insertBefore(date, box.querySelector('.add-btn'));
  return box;
}
// ----- card chrome: a coloured mark, a bold title, a quiet subtitle; add boxes stay folded behind a ＋ -----
const CARD_LOOK = {
  碎片发现: ['pen', '#ff9f0a'], 今日待办: ['done', '#0a84ff'], 本周计划: ['calendar', '#5e5ce6'], 备忘录: ['note', '#f5a400'], 接着做: ['go', '#34c759'],
  课题与基金: ['bulb', '#30b0c7'], 论文与投稿: ['doc', '#af52de'], 文献待读: ['book', '#a2845e'], 仪器预约与实验队列: ['flask', '#32ade6'],
  截止日倒计时: ['flag', '#ff3b30'], 杂事: ['case', '#ff9500'], 生活: ['heart', '#ff2d55'], 本周科研数据: ['bars', '#00b8a9'],
};
const openAdds = new Set(); // add boxes opened with ＋; they stay open across redraws until closed
const unfolded = new Set(); // lists opened with “还有 N 项”
export function cardHead(title, sub, { add = null, right = null, level = 'h2' } = {}) {
  if (sub && !(sub instanceof Element)) sub = h('p', { class: 'card-sub' }, sub);
  const [ic, color] = CARD_LOOK[title] || ['list', '#8e8e93'];
  let plus = null;
  if (add) {
    const key = add.querySelector('input')?.dataset.k || title;
    const open = openAdds.has(key);
    add.hidden = !open;
    plus = h('button', { class: `card-plus${open ? ' on' : ''}`, type: 'button', title: '添加', 'aria-label': `添加：${title}`, 'aria-expanded': String(open), onclick: (e) => {
      const show = add.hidden; add.hidden = !show;
      e.currentTarget.classList.toggle('on', show); e.currentTarget.setAttribute('aria-expanded', String(show));
      if (show) { openAdds.add(key); add.querySelector('input')?.focus(); } else openAdds.delete(key);
    } }, icon('plus', 16));
  }
  return h('div', { class: 'c-head', style: { '--acc': color } },
    h('span', { class: 'card-ic', 'aria-hidden': 'true' }, icon(ic, 16)),
    h('div', { class: 'card-tt' }, h(level, null, title), sub || null),
    right, plus);
}
// Boards show every item: nothing is folded away behind “还有 N 项” (kept as a function so callers stay simple).
export function foldList(ul) { return ul; }
export function railCard(title, sub, ...kids) {
  const flat = kids.flat().filter(Boolean);
  const add = flat.find((k) => k.classList?.contains('add-row')) || null;
  return h('section', { class: 'tile rail-card', style: { '--acc': (CARD_LOOK[title] || [])[1] || '#8e8e93' } }, cardHead(title, sub, { add, level: 'h3' }), ...flat);
}
// Categorized to-dos: open ones first (by date), then the last few done.
export function catList(tasks, cat, { placeholder, dated = false, dateRequired = false, limitDone = 3 }) {
  const list = tasks.filter((x) => x.cat === cat);
  const open = list.filter((x) => !x.done).sort((a, b) => String(a.date || '9').localeCompare(String(b.date || '9')));
  const done = list.filter((x) => x.done).sort((a, b) => String(b.doneAt || '').localeCompare(String(a.doneAt || ''))).slice(0, limitDone);
  const wk = weekStart(todayISO());
  const add = dated
    ? addDated(placeholder, (text, date) => changeTasks((l) => l.push(newTask(text, date ? weekStart(date) : wk, date, cat)), `Planner: add ${cat}`, redrawHome), { dateRequired })
    : addBox(placeholder, (text) => changeTasks((l) => l.push({ ...newTask(text, wk, null, cat), ...(cat === '文献' ? wechat(text) : {}) }), `Planner: add ${cat}`, redrawHome).then(() => { if (cat === '文献') fillPaperRefs(); }));
  add.querySelector('input').dataset.k = `cat-${cat}`;
  const row = (x) => (cat === '文献' ? paperRow(x) : taskRow(x, { redraw: redrawHome, showCat: false, meta: linkMeta(x.text) }));
  const rows = [...open.map(row), ...done.map(row)];
  return { open, done, el: [add, foldList(h('ul', { class: 'tasks rail-tasks' }, rows), `cat-${cat}`)] };
}
// ----- reading list: a pasted link or DOI shows as title · authors · journal · year -----
// Looked up once from Crossref (or DataCite for arXiv) and stored on the entry as `ref`, so it also works offline later.
const triedRefs = new Set();
export function paperKey(text) {
  const t = decodeURIComponent(String(text)).trim();
  const doi = t.match(/\b(10\.\d{4,9}\/[^\s?#"<>]+)/);
  if (doi) return { doi: doi[1].replace(/[.,;)\]]+$/, '').replace(/\/(full|abstract|epdf|pdf|html)$/i, '') };
  const pii = t.match(/\/pii\/(S?[0-9X]{15,17})/i);
  if (pii) return { pii: pii[1].toUpperCase() };
  const nat = t.match(/nature\.com\/articles\/([a-z0-9.-]+)/i);
  if (nat) return { doi: `10.1038/${nat[1]}` };
  const rsc = t.match(/pubs\.rsc\.org\/[^\s]*\/(?:articlelanding|articlehtml|articlepdf)\/\d{4}\/\w+\/([a-z0-9]+)/i);
  if (rsc) return { doi: `10.1039/${rsc[1].toUpperCase()}` };
  const arx = t.match(/arxiv\.org\/(?:abs|pdf)\/(\d{4}\.\d{4,5})/i);
  if (arx) return { doi: `10.48550/arXiv.${arx[1]}` };
  return null;
}
function shortAuthors(list) {
  const names = (list || []).map((a) => a.family || a.familyName || a.name || '').filter(Boolean);
  return names.length > 2 ? `${names[0]} et al.` : names.join(', ');
}
export async function lookupPaper(text) {
  const key = paperKey(text);
  if (!key) return null;
  if (key.doi && /^10\.48550\//.test(key.doi)) {
    const r = await fetch(`https://api.datacite.org/dois/${encodeURIComponent(key.doi)}`);
    if (!r.ok) return null;
    const a = (await r.json()).data?.attributes || {};
    return { title: a.titles?.[0]?.title || '', authors: shortAuthors(a.creators), journal: 'arXiv', year: String(a.publicationYear || ''), doi: key.doi };
  }
  const sel = 'select=DOI,title,author,container-title,short-container-title,issued';
  const r = await fetch(key.doi ? `https://api.crossref.org/works/${encodeURIComponent(key.doi)}` : `https://api.crossref.org/works?filter=alternative-id:${key.pii}&rows=1&${sel}`);
  if (!r.ok) return null;
  const j = (await r.json()).message;
  const w = key.doi ? j : j?.items?.[0];
  if (!w?.title?.[0]) return null;
  return {
    title: w.title[0].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim(),
    authors: shortAuthors(w.author),
    journal: w['short-container-title']?.[0] || w['container-title']?.[0] || '',
    year: String(w.issued?.['date-parts']?.[0]?.[0] || ''),
    doi: w.DOI,
  };
}
// Fills in any reading-list entry that has a link but no title yet (new ones, and ones added before this existed).
export async function fillPaperRefs() {
  const doc = await loadPlanner().catch(() => null);
  const todo = (doc?.tasks || []).filter((x) => x.cat === '文献' && !x.ref && !triedRefs.has(x.id) && paperKey(x.text));
  if (!todo.length) return;
  const found = [];
  for (const x of todo) {
    triedRefs.add(x.id);
    try { const ref = await lookupPaper(x.text); if (ref) found.push([x.id, ref]); } catch { /* offline or blocked: tried again after the next reload */ }
  }
  if (found.length) changeTasks((l) => { for (const [id, ref] of found) { const t = l.find((y) => y.id === id); if (t) t.ref = ref; } }, 'Planner: paper titles', redrawHome);
}
// A few keywords instead of the whole title, so the list stays one short line per paper.
const ABBR = [
  [/organic electrochemical transistors?/gi, 'OECT'], [/organic field[- ]effect transistors?/gi, 'OFET'], [/field[- ]effect transistors?/gi, 'FET'],
  [/single[- ]walled carbon nanotubes?/gi, 'SWCNT'], [/carbon nanotubes?/gi, 'CNT'], [/zeolitic imidazolate frameworks?/gi, 'ZIF'], [/metal[- ]organic frameworks?/gi, 'MOF'],
  [/covalent organic frameworks?/gi, 'COF'], [/two[- ]photon (?:polymeri[sz]ation|lithography|printing|direct laser writing)/gi, '2PP'], [/direct laser writing/gi, 'DLW'],
  [/poly\(3,4-ethylenedioxythiophene\)\s*:?\s*poly\(styrene ?sulfonate\)/gi, 'PEDOT:PSS'], [/poly\(3-hexylthiophene\)/gi, 'P3HT'], [/reduced graphene oxide/gi, 'rGO'], [/graphene oxide/gi, 'GO'],
  [/electrochemical impedance spectroscopy/gi, 'EIS'], [/molecularly imprinted polymers?/gi, 'MIP'], [/hydrogen peroxide/gi, 'H2O2'], [/glucose oxidase/gi, 'GOx'], [/prussian blue/gi, 'PB'],
  [/silver nanowires?/gi, 'AgNW'], [/direct ink writing/gi, 'DIW'], [/aerosol[- ]jet print(?:ing|ed)/gi, 'AJP'], [/matrix metalloproteinase[- ]?8/gi, 'MMP-8'], [/point[- ]of[- ]care/gi, 'POC'],
  [/machine learning/gi, 'ML'], [/deep learning/gi, 'DL'], [/three[- ]dimensional|3-dimensional/gi, '3D'], [/two[- ]dimensional/gi, '2D'],
];
const STOP = new Set(('a an the of for in on with and or to by from via using use based toward towards novel new high highly performance enhanced efficient effective study effect effects approach '
  + 'application applications loaded network networks system systems strategy simple facile one step one-step through its their as at into under over between ultra robust stable improved '
  + 'sensitive sensitivity selective rapid fast low cost low-cost large scale large-scale advanced recent progress review perspective toward properties property design designed fabrication '
  + 'fabricated synthesis prepared preparation method methods material materials device devices insight insights understanding role new-type type types its this that these').split(' '));
export function paperKeywords(title) {
  let t = String(title || '').trim();
  if (!t) return '';
  if (/[㐀-鿿]/.test(t)) return t.length > 24 ? `${t.slice(0, 24)}…` : t;
  for (const [re, ab] of ABBR) t = t.replace(re, ab);
  const strong = (w) => /[A-Z].*[A-Z0-9]|\d/.test(w) || /^[A-Z]{2,}/.test(w);
  const out = [];
  for (const raw of t.split(/[\s,;]+(?![^()]*\))/)) {
    const tok = raw.replace(/^["'“]+|["'”.?!:]+$/g, '').replace(/^\(([^()]*)\)$/, '$1');
    if (!tok || tok.split('-').every((w) => STOP.has(w.toLowerCase()))) continue;
    const parts = tok.includes('-') && !tok.includes('(') && tok.split('-').some(strong) ? tok.split('-') : [tok];
    for (let w of parts) {
      w = w.replace(/^([A-Z][A-Z0-9]+)s$/, '$1');
      if (!w || STOP.has(w.toLowerCase()) || (w.length < 3 && !strong(w))) continue;
      if (!out.some((o) => o.toLowerCase() === w.toLowerCase())) out.push(w);
    }
  }
  const pick = [...out.filter(strong), ...out.filter((w) => !strong(w))].slice(0, 5);
  return pick.join(' · ');
}
let clipN = new Map();
// A WeChat official-account article pasted into the reading list ("标题 https://mp.weixin.qq.com/s/…", or the link alone):
// the link is kept apart from the title, so the title stays readable and can be rewritten. A DOI typed into the title
// later still gets looked up, and the entry then shows the paper with the article link beside it.
export function wechat(text) {
  const m = String(text).match(/https?:\/\/mp\.weixin\.qq\.com\/\S+/);
  if (!m) return {};
  const title = String(text).replace(m[0], '').replace(/[\s|｜·:：-]+$/, '').trim();
  return { text: title || '公众号文章（点这里写题目）', wx: m[0] };
}
const wxLink = (x) => (x.wx ? h('a', { class: 'wx-link', href: x.wx, target: '_blank', rel: 'noopener', title: '打开微信公众号原文' }, '公众号') : null);
function paperRow(x) {
  const href = x.ref?.doi ? `https://doi.org/${x.ref.doi}` : linkMeta(x.text)?.href;
  if (!x.ref && x.wx) { const li = taskRow(x, { redraw: redrawHome, showCat: false, meta: h('span', { class: 'paper-meta' }, wxLink(x), paperKey(x.text) ? '正在查找原文…' : '题目里加上原文 DOI 可自动补全') }); if (!x.date) li.querySelector('.date-chip')?.remove(); return li; }
  if (!x.ref) return taskRow(x, { redraw: redrawHome, showCat: false, meta: paperKey(x.text) ? h('span', { class: 'paper-meta' }, '正在查找题目…', linkMeta(x.text)) : linkMeta(x.text) });
  const first = String(x.ref.authors || '').split(/[ ,]/)[0];
  const li = taskRow(x, { redraw: redrawHome, showCat: false,
    meta: h('span', { class: 'paper-meta' }, [[first, x.ref.year].filter(Boolean).join(' '), x.ref.journal].filter(Boolean).join(' · '), href ? h('a', { href, target: '_blank', rel: 'noopener' }, '打开') : null, wxLink(x), clipN.get(x.id) ? h('a', { href: `#/clips?paper=${x.id}`, title: '从这篇存下的图' }, `图 ${clipN.get(x.id)}`) : null) });
  // Keywords: generated from the title, click to rewrite them in your own words (kept as `keys`).
  const keys = x.keys || paperKeywords(x.ref.title) || x.ref.title;
  const main = li.querySelector('.task-main > .task-text');
  main?.replaceWith(editable(keys, (v) => changeTasks((l) => { const y = l.find((z) => z.id === x.id); if (y) y.keys = v; }, 'Planner: paper keywords', redrawHome), 'task-text paper-keys'));
  li.classList.add('paper-row');
  li.title = `${x.ref.title}\n${[x.ref.authors, x.ref.journal, x.ref.year].filter(Boolean).join(' · ')}\n（点关键词可改写）`;
  if (!x.date) li.querySelector('.date-chip')?.remove();
  return li;
}
// A DOI or link in a reading-list entry becomes a link.
export function linkMeta(text) {
  const doi = String(text).match(/\b10\.\d{4,9}\/\S+/); const url = String(text).match(/https?:\/\/\S+/);
  const href = url ? url[0] : doi ? `https://doi.org/${doi[0]}` : null;
  return href ? h('a', { href, target: '_blank', rel: 'noopener' }, '打开') : null;
}

export const dueTag = (iso) => (iso ? h('span', { class: `due-tag ${urgency(iso)}` }, `${iso.slice(5)} · ${leftDays(iso)}`) : null);

export async function weekStats() {
  const t = todayISO(); const wk = weekStart(t); const end = addDays(wk, 6);
  const inWk = (d) => d && String(d).slice(0, 10) >= wk && String(d).slice(0, 10) <= end;
  const pages = lib.allPages().filter((p) => inWk(p.date) && !p.void);
  const hyps = await loadHypotheses(lib).catch(() => []);
  const ev = hyps.flatMap((x) => x.evidence || []).filter((e) => inWk(e.date)).length;
  const tasks = (await loadPlanner()).tasks;
  return { pages: pages.length, exps: pages.filter((p) => p.xid).length, signed: pages.filter((p) => p.signed).length, ev, done: tasks.filter((x) => x.done && inWk(x.doneAt)).length };
}

let dlAll = false;
export function homeRails() {
  const left = h('aside', { class: 'rail rail-left', 'aria-label': '科研主线' });
  const right = h('aside', { class: 'rail rail-right', 'aria-label': '时间与日常' });
  const top = h('section', { class: 'dl-hero', 'aria-label': '截止日倒计时' });
  const draw = async () => {
    let doc; try { doc = await loadPlanner(); } catch { return; }
    const focused = document.activeElement?.closest?.('.rail') ? document.activeElement.dataset.k : null;
    const { tasks, projects, papers } = doc;
    const paperMethods = await loadMethods(lib).catch(() => []);
    clipN = await clipCounts();
    // 课题与基金
    const topics = topicsOf(doc); const tOf = (x) => projectTopic(x, topics);
    const byTopic = (a, b) => { const k = (x) => { const i = topics.findIndex((t) => t.id === tOf(x)?.id); return i < 0 ? 99 : i; }; return k(a) - k(b); };
    const active = projects.filter((x) => !['想法', '调研', '已结束'].includes(x.stage || '想法'));
    const early = (st) => projects.filter((x) => (x.stage || '想法') === st).length;
    const pj = railCard('课题与基金', `${active.length} 个在推进 · 想法 ${early('想法')} · 调研 ${early('调研')}`,
      active.length ? h('ul', { class: 'board-list' }, [...active].sort((a, b) => String(a.due || '9').localeCompare(String(b.due || '9'))).map((x) => h('li', { class: 'board-item', onclick: (e) => { if (!e.target.closest('a')) editProject(x); } },
        h('div', { class: 'bi-top' }, h('span', { class: 'bi-kind' }, x.kind || '课题'), h('b', null, x.title), topicChip(tOf(x))),
        h('div', { class: 'bi-meta' }, h('span', { class: 'bi-stage' }, x.stage), x.next ? h('span', null, `下一步：${x.next}`) : null, dueTag(x.due)),
        (x.vols || []).length ? h('div', { class: 'bi-vols' }, x.vols.map((id) => lib.volume(id)).filter(Boolean).flatMap((v) => [h('a', { href: `#/v/${v.id}` }, v.title), h('a', { class: 'bi-m', href: `#/v/${v.id}/methods` }, '方法细节')])) : null)))
        : h('p', { class: 'muted small' }, '还没有在推进的课题。'),
      ...['调研', '想法'].map((st) => {
        const list = projects.filter((x) => (x.stage || '想法') === st).sort(byTopic);
        return list.length ? h('div', { class: 'pj-early' }, h('h4', null, `${st} ${list.length}`),
          h('ul', { class: 'idea-list' }, list.map((x) => h('li', { onclick: () => editProject(x), title: x.why || '点击修改' },
            h('b', null, x.title), topicChip(tOf(x)), x.why ? h('span', { class: 'idea-why' }, x.why) : null, x.next ? h('span', { class: 'idea-why' }, `下一步：${x.next}`) : null)))) : null;
      }),
      h('div', { class: 'rail-actions' },
        h('a', { class: 'btn small', href: '#/projects' }, '课题看板 ›'),
        h('button', { class: 'btn small ghost', type: 'button', onclick: () => editProject(null, { stage: '想法' }) }, icon('plus', 14), '记一个想法')));
    // 论文与投稿
    const counts = PAPER_STAGE.map((st) => [st, papers.filter((x) => x.stage === st).length]).filter(([, n]) => n);
    const pp = railCard('论文与投稿', counts.length ? counts.map(([st, n]) => `${st} ${n}`).join(' · ') : '构思 → 写作 → 投稿 → 返修 → 接收',
      h('ol', { class: 'paper-steps' }, PAPER_STAGE.slice(0, 6).map((st) => h('li', { class: papers.some((x) => x.stage === st) ? 'on' : null }, st))),
      h('ul', { class: 'board-list' }, [...papers].sort((a, b) => PAPER_STAGE.indexOf(a.stage) - PAPER_STAGE.indexOf(b.stage)).map((x) => h('li', { class: `board-item paper st-${x.stage}`, onclick: () => editPaper(x) },
        h('div', { class: 'bi-top' }, h('span', { class: 'bi-kind' }, x.stage), h('b', null, x.title)),
        h('div', { class: 'bi-meta' }, x.journal ? h('i', null, x.journal) : null, dueTag(x.due),
          h('a', { class: 'bi-m', href: `#/methods/a/${x.id}`, title: '这篇文章的方法卡片' }, `方法卡片 ${paperMethods.filter((m) => (m.papers || []).includes(x.id)).length}`))))),
      h('button', { class: 'btn small rail-add', type: 'button', onclick: () => editPaper(null) }, icon('plus', 14), '新建论文'));
    for (const [card, key] of [[pj, 'pj'], [pp, 'pp']]) { const ul = card.querySelector('ul.board-list'); if (ul) foldList(ul, key); }
    const rd = catList(tasks, '文献', { placeholder: '粘贴 DOI、链接、题目或公众号文章链接' });
    setTimeout(fillPaperRefs, 300);
    left.replaceChildren(
      h('p', { class: 'rail-title' }, '科研主线'), pj, pp,
      railCard('文献待读', rd.open.length ? `${rd.open.length} 篇待读` : '读完打勾', ...rd.el));
    // 截止日倒计时：自己的截止项 + 课题、论文的日期
    const t = todayISO();
    const dl = [
      ...tasks.filter((x) => x.cat === '截止' && !x.done && x.date).map((x) => ({ text: x.text, date: x.date, task: x })),
      ...projects.filter((x) => x.due && x.stage !== '已结束').map((x) => ({ text: `${x.title}${x.next ? ` · ${x.next}` : ''}`, date: x.due, open: () => editProject(x), tag: x.kind })),
      ...papers.filter((x) => x.due && !['接收', '已发表'].includes(x.stage)).map((x) => ({ text: `${x.title} · ${x.stage}`, date: x.due, open: () => editPaper(x), tag: '论文' })),
    ].sort((a, b) => a.date.localeCompare(b.date));
    const dlAdd = addDated('截止事项，如 双周报告', (text, date) => changeTasks((l) => l.push(newTask(text, weekStart(date), date, '截止')), 'Planner: add deadline', redrawHome), { dateRequired: true });
    dlAdd.querySelector('input').dataset.k = 'cat-截止';
    // The countdown opens the page: one big card per deadline, nearest first.
    const DL_SHOW = 6;
    const dlCard = (x) => {
      const d = dlDays(x.date); const inHours = d >= 0 && d <= 1;
      return h('li', { class: `dl-card ${urgency(x.date)}` },
        h('div', { class: 'dl-num' }, h('b', null, d < 0 ? `+${-d}` : String(inHours ? dlHours(x.date) : d)), h('span', null, d < 0 ? '天 · 已逾期' : inHours ? '小时' : '天')),
        h('div', { class: 'dl-body' }, h('b', { class: x.open ? 'linkish' : null, onclick: x.open || null }, x.text), h('span', null, `${x.date}${x.tag ? ` · ${x.tag}` : ''}`)),
        x.task ? h('button', { class: 'tick small', type: 'button', role: 'checkbox', 'aria-checked': 'false', 'aria-label': '完成', title: '完成', onclick: () => toggleTask(x.task.id, redrawHome) }) : null);
    };
    const near = dl.filter((x) => dlDays(x.date) <= 7).length;
    top.replaceChildren(
      h('div', { class: 'dl-head' }, h('h2', null, '截止日倒计时'), h('span', { class: 'dl-sub' }, `${dl.length ? `${dl.length} 项${near ? ` · ${near} 项在 7 天内` : ''}` : '没有临近的截止日'} · ${dlBasis()}`), dlAdd),
      dl.length ? h('ul', { class: 'dl-cards' }, (dlAll ? dl : dl.slice(0, DL_SHOW)).map(dlCard),
        dl.length > DL_SHOW ? h('li', { class: 'dl-more' }, h('button', { class: 'btn small ghost', type: 'button', onclick: () => { dlAll = !dlAll; draw(); } }, dlAll ? '收起' : `还有 ${dl.length - DL_SHOW} 项`)) : null) : null);
    top.classList.toggle('empty', !dl.length);
    const st = await weekStats();
    const stat = (n, label) => h('div', { class: 'ws' }, h('b', null, String(n)), h('span', null, label));
    const clipsWk = (await loadClips().catch(() => [])).filter((c) => c.kind === 'img' && String(c.created).slice(0, 10) >= weekStart(t)).length;
    right.replaceChildren(
      h('p', { class: 'rail-title' }, '时间与数据'),
      railCard('本周科研数据', `${weekStart(t).slice(5)} 至 ${addDays(weekStart(t), 6).slice(5)} · 东八区`,
        h('div', { class: 'week-stats' }, stat(st.pages, '页记录'), stat(st.exps, '个实验'), stat(st.pages ? `${Math.round((st.signed / st.pages) * 100)}%` : '—', '已签名'), stat(st.ev, '条新证据'), stat(st.done, '项待办完成'), stat(clipsWk, '张文献图')),
        h('a', { class: 'btn small ws-open', href: '#/reading', title: '打开后才向 Zotero 查询' }, icon('book', 16), '本周读过的文献 ›')));
    if (focused) document.querySelector(`.rail input[data-k="${focused}"]`)?.focus();
  };
  homeHooks.add(draw);
  draw().then(() => autoFileFinds());
  return { left, right, top };
}

// Home: today's to-dos (your own + experiment reminders) and this week's plan, each with progress.
// 随手记: the two free-form lists side by side. (Today's to-dos and the week's goals live in the week board.)
export function dashboard() {
  const box = h('section', { class: 'dash' }, h('div', { class: 'tile' }, h('p', { class: 'muted' }, '读取中…')));
  const draw = async () => {
    let doc;
    try { doc = await loadPlanner(); } catch (e) { box.replaceChildren(h('div', { class: 'tile' }, h('p', { class: 'warn' }, e.message))); return; }
    const focused = box.querySelector('input:focus, textarea:focus')?.dataset.k;
    box.replaceChildren(findsCard(doc, redrawHome));
    if (focused) box.querySelector(`[data-k="${focused}"]`)?.focus();
  };
  homeHooks.add(draw);
  draw().then(() => autoFileFinds());
  return box;
}
