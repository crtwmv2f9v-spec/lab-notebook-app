// Volumes and pages: contents, the page sheet, series, signing / void / delete, new experiments.
import { NetworkError } from './store.js';
import { cleanTag, fmtDate, fmtTime, nowISO, pad, pagePath, parseFrontMatter, parseRef, todayISO } from './model.js';
import { renderInto } from './render.js';
import {
  addDays, cleanTopic, colLabel, daysFrom, expId, formatFollowup, isResultCol, loadHypotheses,
  loadProtocol, loadProtocols, loadReagents, loadSolutions, nextSeq, parseFollowup, parseNumbers, readMaterials,
  readSamples, readSteps, renameMaterialsHeading, sampleId, sampleNo, samplesTemplate, stepsText, toCSV,
  writeMaterials,
} from './lab.js';
import { search } from './search.js';
import { h, icon } from './util.js';
import {
  S, confirmTyped, copyText, demoBanner, field, lib, menu, modal,
  prepareFile, saveError, show, sigText, signerName, thead, toast, topbar,
  view, viewMissing, choose } from './core.js';
import { CLOTHS, clothPicker, cover, openNewVolume } from './home.js';
import { changeTasks, dayLabel, exportIcs, loadTasks, newTask, weekStart } from './planner.js';
import { openMaterials, openQuoteDialog, openSamplesEditor, openStepsEditor } from './editor.js';
import { exportPdf, exportWord, openExport, printVolume } from './printing.js';
import { conclusionEvidenceButton, hypBlock, openCiteHypothesis } from './think.js';
import { methodsBtn } from './methods.js';
import { editSolution } from './libraries.js';
import { openSearch } from './searchui.js';
import { route } from './app.js';

// ---------- volume contents ----------
export function viewVolume(id) {
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
      methodsBtn(id),
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
export async function nextStepButtons(sheet, vol, num, fm) {
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

export function amendList(list) {
  return h('details', { class: 'amended' }, h('summary', null, `修订记录（${list.length} 次）`),
    h('ol', { class: 'amend-list' }, list.map(parseAmend).map((a) => h('li', null,
      h('span', { class: 'am-at' }, `${fmtDate(a.at)} ${String(a.at).slice(11, 16)}`), h('span', { class: 'am-by' }, a.by), h('span', { class: 'am-why' }, a.why || '（未写原因）')))));
}
export function initials(name) {
  return String(name).replace(/,.*$/, '').split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 3);
}

export function openVolumeDetails(v) {
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
export function pageCtx(vol, num, local, extra = {}) {
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

export function refLink(key, curVol) {
  const r = parseRef(key);
  if (!r) return null;
  const p = lib.page(r.vol, r.num);
  const label = r.vol === curVol ? `p. ${r.num}` : `${lib.volume(r.vol)?.title || r.vol}, p. ${r.num}`;
  return h('a', { class: 'pageref', href: `#/v/${r.vol}/${r.num}`, title: p?.title || '' }, label);
}

// Builds the page sheet; `ready` resolves when figures and charts are drawn.
// Older pages list reagents only in the front matter; they get the same 试剂 table at the foot.
export const shownBody = (fm, body) => renameMaterialsHeading(readMaterials(body) || !(fm.reagents || []).length ? body : writeMaterials(body, fm.reagents.map((id) => ({ id }))));

export async function buildPageSheet(vol, num, { forPrint = false } = {}) {
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
      fm.id ? h('div', { class: 'form-row' }, field('实验编号', h('button', { class: 'linkish xid', type: 'button', title: '复制编号', onclick: () => copyText(fm.id) }, fm.id), 'grow'))
        : h('div', { class: 'form-row no-print' }, field('实验编号', h('span', { class: 'no-xid' }, h('span', { class: 'muted' }, '普通页，没有实验编号 '),
          h('button', { class: 'btn small', type: 'button', title: '分配编号后可以挂接原始数据、记录数据指纹、给样品编号、加入系列', onclick: () => makeExperiment(vol, num, fm) }, '设为实验')), 'grow')),
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
export function recordSheet(vol, num, fm, panel, content) {
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

export async function viewPage(vol, num, params) {
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
    fm.id ? null : { icon: 'flask', label: '设为实验（分配实验编号）…', run: () => makeExperiment(vol, num, fm) },
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
export let lastPageVisited = null;

export function addSwipe(el, prevHref, nextHref) {
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

export async function copyRef(vol, num) {
  const ref = `[[${vol}/${num}]]`;
  try { await navigator.clipboard.writeText(ref); toast(`已复制 ${ref}，可粘贴到任何页面。`); } catch { toast(`Link text: ${ref}`); }
}

export async function openHistory(vol, num) {
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

// Changes to a signed page are logged as "time | who | why" (GLP-style audit trail).
export const amendEntry = (why) => `${nowISO()} | ${signerName()} | ${String(why || '').replace(/\s*\n\s*/g, ' ').trim()}`;
export function parseAmend(s) {
  const [at, by = '', ...why] = String(s).split(' | ');
  return { at: at.trim(), by: by.trim(), why: why.join(' | ').trim() };
}
// A required "reason for change" field, shown only when the page is signed.
export function reasonField(fm, id = 'rf-why') {
  if (!fm.signed) return { el: null, ok: () => true, value: () => '' };
  const input = h('input', { id, placeholder: '例如：录入错误，#09 Vth 应为 0.45 V；补充漏记的退火时间' });
  return {
    el: h('div', { class: 'reason-field' }, h('label', { for: id }, '修改原因（本页已签名，必填）'), input),
    ok: () => { if (input.value.trim()) return true; toast('本页已签名，请写明修改原因。'); input.focus(); return false; },
    value: () => input.value.trim(),
  };
}
// Change a page without opening the editor (results, photos, follow-ups).
// mutate({fm, body}) returns the new {fm, body} and optional attachments [{name, blob}].
export async function updatePage(vol, num, mutate, message, reason = '') {
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
export async function expPanel(fm, vol, num, { forPrint = false } = {}) {
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

export async function toggleFollowup(vol, num, index) {
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

// Put several existing pages into one series at once.
export function openBulkSeries(volId) {
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
export const PHOTO_KINDS = [['photo', '照片'], ['channel', '沟道'], ['gate', '栅极'], ['device', '整片器件'], ['film', '薄膜'], ['solution', '溶液'], ['setup', '测试装置'], ['micro', '显微镜'], ['eq', '反应式'], ['scheme', '示意图']];
export async function openPhotoCapture(vol, num) {
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
export function openNaming(fm, num) {
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
export async function printCard(vol, num) {
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

// ----- series: one entry for the same study run on many days -----
export function allSeries() {
  const by = new Map();
  for (const p of lib.allPages()) {
    if (!p.series) continue;
    if (!by.has(p.series)) by.set(p.series, []);
    by.get(p.series).push(p);
  }
  return [...by].map(([name, pages]) => ({ name, pages: pages.sort((a, b) => String(a.date).localeCompare(String(b.date)) || a.num - b.num) }))
    .sort((a, b) => String(b.pages.slice(-1)[0].date).localeCompare(String(a.pages.slice(-1)[0].date)));
}
export const dateRange = (ps) => { const a = ps[0]?.date || ''; const b = ps[ps.length - 1]?.date || ''; return a === b ? a : `${a} ~ ${b}`; };

// Contents rows: each series shows once, where its first page is.
export function tocRows(pages) {
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

export function seriesRow(entry) {
  const ps = allSeries().find((x) => x.name === entry.series)?.pages || [];
  const i = ps.findIndex((x) => x.vol === entry.vol && x.num === entry.num);
  const link = (x, label) => (x ? h('a', { class: 'btn small ghost', href: `#/v/${x.vol}/${x.num}` }, label) : null);
  return h('div', { class: 'form-row' }, field('系列', h('span', { class: 'series-line' },
    h('a', { href: `#/series/${encodeURIComponent(entry.series)}` }, entry.series),
    h('span', { class: 'muted' }, ` 第 ${i + 1} / ${ps.length} 次`),
    link(ps[i - 1], '‹ 上一次'), link(ps[i + 1], '下一次 ›')), 'grow'));
}

export async function viewSeries(raw) {
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

export function exportSeries(name, ps) {
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
export function openDeleteSeries(name, ps) {
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
export async function dissolveSeries(name, ps) {
  toast('正在解散系列…');
  try {
    for (const p of ps) await updatePage(p.vol, p.num, ({ fm: f, body }) => { delete f.series; return { fm: f, body }; }, `Remove p. ${p.num} from series`, `解散系列“${name}”`);
    toast(`已解散“${name}”，${ps.length} 页保留。`);
    location.hash = `#/v/${ps[0].vol}`;
  } catch (e) { toast(saveError(e)); }
}
export async function deleteSeriesPages(ps) {
  const byVol = new Map();
  for (const p of ps) byVol.set(p.vol, [...(byVol.get(p.vol) || []), p.num]);
  toast('正在删除并重新编页…');
  try {
    for (const [vol, nums] of byVol) await lib.deletePages(vol, nums);
    toast(`已删除系列的 ${ps.length} 页，页码已重新连续编号。`);
    location.hash = `#/v/${ps[0].vol}`; route({ quiet: true });
  } catch (e) { toast(saveError(e)); }
}

export async function setSeries(vol, num, fm) {
  const names = allSeries().map((x) => x.name);
  const v = window.prompt(`所属系列名称（留空表示不属于任何系列）${names.length ? `\n已有：${names.join('、')}` : ''}`, fm.series || '');
  if (v == null) return;
  try {
    await updatePage(vol, num, ({ fm: f, body }) => { if (v.trim()) f.series = v.trim(); else delete f.series; return { fm: f, body }; }, `Series of p. ${num}`, v.trim() ? `归入系列“${v.trim()}”` : '移出系列');
    toast(v.trim() ? `已归入“${v.trim()}”。` : '已移出系列。');
  } catch (e) { toast(saveError(e)); }
}

export async function openDeleteVolume(v) {
  const n = lib.pages(v.id).length;
  const ok = await confirmTyped(`删除卷“${v.title}”`, `将删除这个卷和其中的 ${n} 页（含照片附件）。GitHub 历史和硬盘上的每周备份里仍保留旧版本，必要时可以找回。`, v.title, '删除');
  if (!ok) return;
  try { await lib.deleteVolume(v.id); toast(`已删除“${v.title}”。`); location.hash = '#/'; } catch (e) { toast(saveError(e)); }
}
export const DELETE_NOTE = '页面和它的照片、附件从记录本中删除，后面的页码自动前移（第 1 页起连续编号），所有指向被移动页面的链接、引用、证据和待办会一起更新。实验编号（如 20261101-OECT-01）不变。旧版本只留在 GitHub 历史和硬盘上的每周备份里。';
export async function openDeletePage(vol, num, fm) {
  const word = fm.id || `${num}`;
  const ok = await confirmTyped('永久删除这一页', `“${fm.title || '未命名'}”${fm.signed ? '（已签名的正式记录）' : ''}将被删除。${DELETE_NOTE}`, word, '永久删除');
  if (!ok) return;
  await runDelete(vol, [num]);
}
export async function runDelete(vol, nums) {
  toast('正在删除并重新编页…');
  try {
    const map = await lib.deletePages(vol, nums);
    toast(`已删除 ${nums.length} 页${map?.size ? `，${map.size} 页页码已前移` : ''}。`);
    location.hash = `#/v/${vol}`; route({ quiet: true });
  } catch (e) { toast(saveError(e)); }
}
// Tick several pages (e.g. font-test drafts) and delete them in one go.
export function openBulkDelete(volId) {
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
export async function setVoid(vol, num, fm) {
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
// A plain page becomes an experiment: it gets a number like 20261103-H2O2-01 (page date + volume code),
// which raw-data linking (labsync), data fingerprints, sample numbers and series all rely on.
export const volCode = (vol) => lib.volume(vol)?.code || cleanTopic(vol);
export const newXid = (vol, date) => expId(date, volCode(vol), nextSeq(lib.allPages(), date, volCode(vol)));
export async function makeExperiment(vol, num, fm) {
  const date = String(fm.date || todayISO()).slice(0, 10);
  const xid = newXid(vol, date);
  const ok = await choose(`设为实验：${xid}`, `按页面日期（${date}）和卷代码（${volCode(vol)}）分配实验编号。分配后这一页可以挂接原始数据（labsync）、记录数据指纹、给样品编号、加入系列。内容不变。`, [['yes', '分配编号'], ['no', '取消']]);
  if (ok !== 'yes') return;
  try {
    await updatePage(vol, num, ({ fm: f, body }) => { if (!f.id) f.id = xid; return { fm: f, body }; }, `Experiment number for p. ${num}`, `分配实验编号 ${xid}`);
    toast(`已分配 ${xid}。`);
  } catch (e) { toast(saveError(e)); }
}

export async function openNewExperiment(volId, { series: presetSeries = '' } = {}) {
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
