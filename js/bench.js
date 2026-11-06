// Export part of a page: each section (## / ### heading) can go into the archived record, into the bench checklist
// (操作清单, printed to carry to the lab: tick boxes, blank columns to fill in by hand, bottle labels), or both.
// The record keeps the notebook's own layout; the checklist turns steps blocks and tables into tick-box rows and
// every line of plain text into one tick-box item, word for word.
import { parseFrontMatter } from './model.js';
import { CODE_RE, STEP_FIELDS, loadReagents, loadSolutions, parseCSV, parseMaterials, parseSteps } from './lab.js';
import { h } from './util.js';
import { downloadText, lib, modal, toast } from './core.js';
import { printFrame } from './printing.js';
import { buildPageSheet, shownBody } from './pages.js';

const plain = (s) => String(s || '')
  .replace(/\{[^{}|]+\|([^{}]*)\}/g, '$1').replace(/==([^=]+)==/g, '$1').replace(/\+\+([^+]+)\+\+/g, '$1').replace(/\{\{([^}]+)\}\}/g, '$1')
  .replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*]+)\*/g, '$1').replace(/\[\[([^\]]+)\]\]/g, '$1').replace(/`([^`]+)`/g, '$1')
  .replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/\$([^$]+)\$/g, '$1').trim();

// ----- sections: a page split at its headings; text before the first heading is its own section -----
export function splitSections(md) {
  const out = []; let cur = { title: '开头', level: 2, lines: [] }; let fence = false;
  for (const line of String(md || '').split('\n')) {
    if (/^```/.test(line.trim())) fence = !fence;
    const hd = !fence && line.match(/^(#{1,4})\s+(.*)$/);
    if (hd) { out.push(cur); cur = { title: plain(hd[2]) || '（无标题）', level: Math.max(2, hd[1].length), lines: [line] }; } else cur.lines.push(line);
  }
  out.push(cur);
  const seen = {};
  return out.map((s) => ({ ...s, md: s.lines.join('\n') })).filter((s) => s.md.trim()).map((s) => {
    seen[s.title] = (seen[s.title] || 0) + 1;
    const body = s.md.replace(/^#{1,4}\s+.*\n?/, '');
    return { key: `${s.title}#${seen[s.title]}`, title: s.title, level: s.level, md: s.md, kinds: kindsOf(body) };
  });
}
function kindsOf(md) {
  const k = new Set();
  if (/```steps/.test(md)) k.add('步骤');
  if (/^\s*\|.*\|/m.test(md) || /```samples/.test(md)) k.add('表格');
  if (/```materials/.test(md)) k.add('试剂');
  if (/```hypothesis/.test(md)) k.add('假设');
  if (md.replace(/```[\s\S]*?```/g, '').split('\n').some((l) => l.trim() && !/^\s*\|/.test(l))) k.add('文字');
  return [...k];
}

// ----- one section → checklist items, in reading order -----
export function checklistItems(md) {
  const items = []; let fence = null; let buf = []; let tbl = null;
  const flush = () => { if (tbl && tbl.rows.length) items.push(tbl); tbl = null; };
  for (const raw of String(md || '').split('\n')) {
    const line = raw.trimEnd();
    if (fence) {
      if (/^```/.test(line.trim())) {
        const src = buf.join('\n');
        if (fence === 'steps') items.push({ type: 'steps', rows: parseSteps(src) });
        else if (fence === 'samples') { const rows = parseCSV(src); if (rows.length > 1) items.push({ type: 'table', head: rows[0].map((c) => String(c).replace(/^结果[:：]\s*/, '')), rows: rows.slice(1) }); }
        else if (fence === 'materials') items.push({ type: 'materials', rows: parseMaterials(src) });
        else if (fence === 'reaction' || fence === 'code' || fence === 'python') buf.filter((l) => l.trim()).forEach((l) => items.push({ type: 'line', text: l.trim() }));
        fence = null; buf = [];
      } else buf.push(line);
      continue;
    }
    const f = line.trim().match(/^```\s*(\w+)?/);
    if (f) { flush(); fence = f[1] || 'code'; buf = []; continue; }
    if (/^#{1,4}\s/.test(line)) { flush(); continue; }
    if (/^\s*\|/.test(line)) {
      const cells = line.trim().replace(/^\||\|$/g, '').split('|').map((c) => plain(c));
      if (cells.every((c) => /^:?-{2,}:?$/.test(c.trim()))) continue;
      if (!tbl) tbl = { type: 'table', head: cells, rows: [] }; else tbl.rows.push(cells);
      continue;
    }
    flush();
    const t = plain(line.replace(/^\s*(?:[-*+]\s+(?:\[[ xX]\]\s+)?|>\s*)/, ''));
    if (t) items.push({ type: 'line', text: t });
  }
  flush();
  return items;
}

// Codes made in these sections (aliquots A-…, solutions S-…) get a bottle label each.
function madeCodes(items) {
  const out = new Set();
  for (const it of items) {
    if (it.type === 'steps') for (const s of it.rows) for (const k of ['what', 'into', 'note']) for (const m of String(s[k] || '').matchAll(CODE_RE)) if (!m[1].startsWith('R-')) out.add(m[1]);
    if (it.type === 'materials') for (const m of it.rows) if (/^[AS]-/.test(m.id)) out.add(m.id);
  }
  return [...out];
}

// ----- remembered choices, per page, in this browser only -----
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private window */ } },
};
const DEFAULT_BLANKS = '交联剂 (μL), 阈值功率 (mW), 气爆?, 备注';
const csvCell = (c) => (/[",\n]/.test(String(c ?? '')) ? `"${String(c).replace(/"/g, '""')}"` : String(c ?? ''));
const isBenchy = (s) => s.kinds.includes('步骤') || s.kinds.includes('表格') || /步骤|操作|准备|配制|流程|分装|称量|混合/.test(s.title);

export async function openExportPage(vol, num) {
  const { fm, body } = parseFrontMatter(await lib.readPage(vol, num));
  const secs = splitSections(shownBody(fm, body));
  const key = `labnote-export:${vol}/${num}`;
  const saved = store.get(key, {});
  const sel = Object.fromEntries(secs.map((s) => [s.key, saved.sel?.[s.key] ?? { r: true, b: isBenchy(s) }]));
  const rows = h('tbody');
  const draw = () => rows.replaceChildren(...secs.map((s, i) => {
    const children = () => { const out = []; for (let j = i + 1; j < secs.length && secs[j].level > s.level; j++) out.push(secs[j]); return out; };
    const ck = (k) => h('input', { type: 'checkbox', checked: sel[s.key][k], 'aria-label': `${s.title} ${k === 'r' ? '实验记录' : '操作清单'}`,
      onchange: (e) => { sel[s.key][k] = e.target.checked; for (const c of children()) sel[c.key][k] = e.target.checked; draw(); } });
    return h('tr', { class: `lv${s.level}` },
      h('td', { class: 'ck' }, ck('r')), h('td', { class: 'ck' }, ck('b')),
      h('td', { class: 'sec-t' }, h('span', { style: { paddingLeft: `${(s.level - 2) * 16}px` } }, s.title)),
      h('td', { class: 'kinds' }, s.kinds.map((k) => h('span', { class: 'kind' }, k))));
  }));
  draw();
  const all = (k) => { const v = !secs.every((s) => sel[s.key][k]); for (const s of secs) sel[s.key][k] = v; draw(); };
  const order = h('select', { id: 'ex-order' }, h('option', { value: 'rb', selected: saved.order !== 'br' }, '实验记录在前，操作清单在后'), h('option', { value: 'br', selected: saved.order === 'br' }, '操作清单在前，实验记录在后'));
  const blanks = h('input', { id: 'ex-blanks', value: saved.blanks ?? DEFAULT_BLANKS, placeholder: '逗号分隔，例如 阈值功率 (mW), 备注' });
  const labels = h('input', { type: 'checkbox', id: 'ex-labels', checked: saved.labels ?? true });
  const orient = h('select', { id: 'ex-orient' }, [['auto', '自动（列多时横向）'], ['portrait', 'A4 纵向'], ['landscape', 'A4 横向']].map(([v, l]) => h('option', { value: v, selected: (saved.orient || 'auto') === v }, l)));
  const pick = (k) => secs.filter((s) => sel[s.key][k]);
  const remember = () => store.set(key, { sel, order: order.value, blanks: blanks.value, labels: labels.checked, orient: orient.value });
  const csv = () => {
    const out = [];
    for (const s of pick('b')) for (const it of checklistItems(s.md)) {
      if (it.type === 'steps') out.push([s.title], STEP_FIELDS.map(([, l]) => l), ...it.rows.map((r) => STEP_FIELDS.map(([k]) => r[k] || '')), []);
      if (it.type === 'table') out.push([s.title], it.head, ...it.rows, []);
    }
    if (!out.length) { toast('勾进“操作清单”的小节里没有步骤块或表格。'); return; }
    downloadText(`${fm.id || `${vol}-${num}`}_表格.csv`, `﻿${out.map((r) => r.map(csvCell).join(',')).join('\n')}`, 'text/csv');
  };
  modal({
    title: '选择导出：实验记录 + 操作清单', wide: true,
    body: h('div', { class: 'form ex-form' },
      h('p', { class: 'muted' }, '每一节可以放进“实验记录”（存档，排版同记录本）、“操作清单”（带去实验室：每行一个勾选框，右侧留手写栏），或两者都放。完整记录仍然全部保存在记录本里，这里只决定这次导出哪些。'),
      h('div', { class: 'table-wrap' }, h('table', { class: 'data ex-secs' },
        h('thead', null, h('tr', null,
          h('th', { class: 'ck' }, '实验记录', h('br'), h('button', { class: 'linkish', type: 'button', onclick: () => all('r') }, '全选')),
          h('th', { class: 'ck' }, '操作清单', h('br'), h('button', { class: 'linkish', type: 'button', onclick: () => all('b') }, '全选')),
          h('th', null, '小节'), h('th', null, '内容'))), rows)),
      h('div', { class: 'pair' }, h('div', null, h('label', { for: 'ex-order' }, 'PDF 顺序'), order), h('div', null, h('label', { for: 'ex-orient' }, '操作清单纸张'), orient)),
      h('label', { for: 'ex-blanks' }, '清单里表格右侧加的手写栏'), blanks,
      h('label', { class: 'check', for: 'ex-labels' }, labels, ' 操作清单最后附瓶签（本次分装 / 配制的 A-、S- 编号，剪下贴瓶）')),
    buttons: [{ label: '下载表格 CSV', run: () => { remember(); csv(); return false; } }, { label: '取消' }, { label: '打印 / 存为 PDF', primary: true, run: async () => {
      remember();
      const rec = pick('r'); const ben = pick('b');
      if (!rec.length && !ben.length) { toast('至少勾一节。'); return false; }
      await exportParts(vol, num, fm, { all: shownBody(fm, body), record: rec.map((s) => s.md).join('\n\n'), bench: ben, order: order.value, extra: blanks.value.split(/[,，]/).map((x) => x.trim()).filter(Boolean), labels: labels.checked, orient: orient.value });
    } }],
  });
}

// ----- printing -----
export async function benchSheets(vol, num, fm, sections, opt) {
  const [sols, reagents] = await Promise.all([loadSolutions(lib).catch(() => []), loadReagents(lib).catch(() => [])]);
  const by = new Map([...reagents, ...sols, ...(opt.refs || [])].map((r) => [r.id, r]));
  const box = () => h('span', { class: 'bx' });
  const parts = sections.map((s) => ({ title: s.title, items: checklistItems(s.md) })).filter((p) => p.items.length);
  const items = parts.flatMap((p) => p.items);
  const widest = Math.max(0, ...items.map((it) => (it.type === 'steps' ? 8 : it.type === 'table' ? it.head.length + 1 + opt.extra.length : 0)));
  const landscape = opt.orient === 'landscape' || (opt.orient === 'auto' && widest > 10);
  let n = 0;
  const head = (t, sub) => h('h2', null, h('span', { class: 'bn-no' }, String(++n).padStart(2, '0')), t, sub ? h('small', null, sub) : null);
  const v = lib.volume(vol);
  // Where everything is: every code in the checklist sections and the page's reagent list, with its storage place;
  // an aliquot or solution also lists the bottle it comes from (or the candidate bottles named in its notes).
  const loc = (r) => r?.location || '';
  const pickCodes = new Set();
  for (const sct of sections) for (const m of sct.md.matchAll(CODE_RE)) pickCodes.add(m[1]);
  for (const m of String(opt.all || '').matchAll(/```materials\n([\s\S]*?)```/g)) for (const x of parseMaterials(m[1])) pickCodes.add(x.id);
  const srcOf = (r) => {
    const from = String(r?.recipe || '').match(CODE_RE) || [];
    const cand = from.length ? [] : [...String(r?.notes || '').matchAll(CODE_RE)].map((m) => m[1]);
    const fmt = (id) => { const x = by.get(id); return `${id} ${x?.name || ''}${loc(x) ? `（${loc(x)}）` : '（位置未登记）'}`; };
    return [...from.map(fmt), ...(cand.length ? [`候选原瓶：${cand.map(fmt).join('；')}`] : [])].join('；');
  };
  // Bottles of one aliquot family with the same contents, place and source share a row: A-CB-01、02.
  const groups = [];
  for (const id of [...pickCodes].sort((a, b) => (a[0] === 'R' ? 0 : a[0] === 'A' ? 1 : 2) - (b[0] === 'R' ? 0 : b[0] === 'A' ? 1 : 2) || a.localeCompare(b))) {
    const r = by.get(id);
    const fam = id.match(/^(A-[A-Z0-9]+)-(\d{2})$/);
    const sig = fam && JSON.stringify([fam[1], r?.name, r?.volume, loc(r), r?.recipe, r?.notes]);
    const g = sig && groups.find((x) => x.sig === sig);
    if (g) g.ids.push(id); else groups.push({ sig, ids: [id], r });
  }
  const pickRows = groups.map(({ ids, r }) => {
    const id = ids[0];
    const label = ids.length > 1 ? `${id}、${ids.slice(1).map((x) => x.slice(-2)).join('、')}` : id;
    const src = id.startsWith('R-') ? '' : srcOf(r) || String(r?.notes || '');
    return h('tr', null, h('td', { class: 'ck' }, box()), h('td', { class: 'mono' }, label), h('td', null, r?.name || '（库里没有这个编号）'),
      h('td', null, [r?.spec || r?.conc, r?.volume && `${r.volume}${ids.length > 1 ? ` × ${ids.length}` : ''}`].filter(Boolean).join(' · ')),
      loc(r) ? h('td', { class: 'loc' }, loc(r)) : h('td', { class: 'blank' }, h('span', { class: 'muted-p' }, id.startsWith('R-') ? '未登记' : '放好后填')),
      h('td', { class: 'src' }, src));
  });
  const codesIn = (t) => [...String(t || '').matchAll(CODE_RE)].map((m) => m[1]);
  // A step's substance: its own place; for an aliquoting step (substance not in the library), where its source bottle is kept.
  const whereOf = (st) => {
    const own = [...new Set(codesIn(st.what).map((id) => loc(by.get(id))).filter(Boolean))];
    if (own.length) return own.join('；');
    const src = [...new Set(codesIn(st.into).filter((id) => id.startsWith('A-')).flatMap((id) => codesIn(`${by.get(id)?.recipe || ''} ${by.get(id)?.notes || ''}`))
      .filter((id) => id.startsWith('R-')).map((id) => loc(by.get(id))).filter(Boolean))];
    return src.length ? `原瓶：${src.join(' / ')}` : '';
  };
  const render = (it) => {
    if (it.type === 'line') return h('div', { class: 'bn-item' }, box(), h('span', null, it.text));
    if (it.type === 'steps') {
      return h('table', { class: 'bn-t steps-t' },
        h('thead', null, h('tr', null, h('th', { class: 'ck' }, '✓'), STEP_FIELDS.flatMap(([k, l]) => [h('th', null, l), k === 'what' ? h('th', null, '存放位置') : null]), h('th', { class: 'blank-h wide' }, '实际 / 备注'))),
        h('tbody', null, it.rows.map((s) => h('tr', null, h('td', { class: 'ck' }, box()), STEP_FIELDS.flatMap(([k]) => [h('td', null, s[k] || ''), k === 'what' ? h('td', { class: 'loc' }, whereOf(s)) : null]), h('td', { class: 'blank' })))));
    }
    if (it.type === 'materials') {
      return h('table', { class: 'bn-t' },
        h('thead', null, h('tr', null, h('th', { class: 'ck' }, '✓'), ['编号', '名称', '来源 / 瓶号', '用量', '存放位置'].map((c) => h('th', null, c)))),
        h('tbody', null, it.rows.map((m) => { const r = by.get(m.id) || {}; return h('tr', null, h('td', { class: 'ck' }, box()), [m.id, r.name || '', m.from, m.amount, r.location || ''].map((c) => h('td', null, c))); })));
    }
    return h('table', { class: 'bn-t' },
      h('thead', null, h('tr', null, h('th', { class: 'ck' }, '✓'), it.head.map((c) => h('th', null, c)), opt.extra.map((c) => h('th', { class: 'blank-h' }, c)))),
      h('tbody', null, it.rows.map((r) => h('tr', null, h('td', { class: 'ck' }, box()), it.head.map((_, j) => h('td', { class: /^\s*[-\d.:\s/]+\s*$/.test(r[j] || '') ? 'num' : null }, r[j] || '')), opt.extra.map(() => h('td', { class: 'blank' }))))));
  };
  const nodes = [h('header', { class: 'bn-head' },
    h('div', { class: 'bn-kicker' }, '实验操作清单 · BENCH CHECKLIST'),
    h('h1', null, fm.title || `第 ${num} 页`),
    h('div', { class: 'bn-meta' },
      h('span', null, h('i', null, '实验编号'), fm.id || `${v?.title || vol} 第 ${num} 页`),
      h('span', null, h('i', null, '记录日期'), String(fm.date || '').slice(0, 10)),
      h('span', null, h('i', null, '实验日期'), h('u')),
      h('span', null, h('i', null, '操作人'), h('u'))))];
  if (pickRows.length) {
    nodes.push(h('section', { class: `bn-pick${pickRows.length <= 12 ? ' keep' : ''}` }, head('试剂取用', '先按位置取齐；没登记位置的现场写上，回来补到库里'),
      h('table', { class: 'bn-t' },
        h('thead', null, h('tr', null, h('th', { class: 'ck' }, '✓'), ['编号', '名称', '规格 / 浓度', '存放位置', '原瓶（分装 / 配制来源）'].map((c) => h('th', null, c)))),
        h('tbody', null, pickRows))));
  }
  const rowsIn = (p) => p.items.reduce((n, it) => n + (it.rows?.length || 1), 0);
  for (const p of parts) nodes.push(h('section', { class: rowsIn(p) <= 14 ? 'keep' : null }, head(p.title), p.items.map(render)));
  nodes.push(h('section', { class: 'bn-obs' }, head('现象与备注'), Array.from({ length: 6 }, () => h('div', { class: 'bn-line' }))));
  const sheets = [h('article', { class: `bench-sheet${landscape ? ' landscape' : ''}` }, nodes)];
  const codes = opt.labels ? madeCodes(items) : [];
  if (codes.length) {
    sheets.push(h('article', { class: 'bench-sheet bn-labels-sheet' },
      h('h2', null, '瓶签', h('small', null, '沿虚线剪下，贴在瓶身；日期和姓名缩写现场手写')),
      h('div', { class: 'bn-labels' }, codes.map((c) => {
        const r = by.get(c) || {};
        return h('div', { class: 'bn-label' },
          h('div', { class: 'lb-code' }, c),
          h('div', { class: 'lb-name' }, String(r.name || '').replace(/（分装）$/, '')),
          h('div', { class: 'lb-sub' }, [r.conc, r.volume].filter(Boolean).join(' · ') || ' '),
          h('div', { class: 'lb-fill' }, h('span', null, '日期'), h('u'), h('span', null, '人'), h('u')));
      }))));
  }
  return { sheets, landscape };
}

export async function exportParts(vol, num, fm, opt) {
  toast('正在准备 PDF…');
  const frames = [];
  let land = false;
  if (opt.record.trim()) {
    const { el, ready } = await buildPageSheet(vol, num, { forPrint: true, body: opt.record });
    await Promise.race([ready, new Promise((r) => setTimeout(r, 15000))]).catch(() => {});
    frames.push(printFrame([el]));
  }
  if (opt.bench.length) {
    const { sheets, landscape } = await benchSheets(vol, num, fm, opt.bench, opt);
    land = landscape;
    const f = printFrame(sheets);
    if (landscape) f.classList.add('pf-landscape');
    frames.push(f);
  }
  if (opt.order === 'br') frames.reverse();
  const pr = document.getElementById('print-root');
  pr.replaceChildren(...frames);
  await Promise.all([...pr.querySelectorAll('img')].map((i) => i.decode?.().catch(() => {})));
  // A landscape checklist gets its own named page size; the record stays portrait.
  document.getElementById('bench-page')?.remove();
  const style = h('style', { id: 'bench-page' }, land ? '@page bench-land { size: A4 landscape; } .pf-landscape { page: bench-land; }' : '');
  document.head.append(style);
  document.body.classList.add('print-volume', 'print-bench');
  const title = document.title;
  document.title = `${fm.id || `${vol}-${num}`}_${fm.title || ''}${opt.record.trim() && opt.bench.length ? '_记录+清单' : opt.bench.length ? '_操作清单' : '_记录'}`;
  window.addEventListener('afterprint', () => { document.title = title; style.remove(); document.body.classList.remove('print-bench'); }, { once: true });
  setTimeout(() => window.print(), 50);
  return pr;
}
