// Bench sheet: a page's preparation steps and tables on A4, with tick boxes and blank columns to fill in by hand,
// plus cut-out bottle labels for the aliquots and solutions it makes. Also exports the page's tables as CSV.
import { parseFrontMatter } from './model.js';
import { CODE_RE, STEP_FIELDS, loadReagents, loadSolutions, parseSteps, readMaterials } from './lab.js';
import { h } from './util.js';
import { downloadText, lib, modal, toast } from './core.js';
import { printSheets } from './printing.js';

const plain = (s) => String(s || '')
  .replace(/\{[^{}|]+\|([^{}]*)\}/g, '$1').replace(/==([^=]+)==/g, '$1').replace(/\+\+([^+]+)\+\+/g, '$1').replace(/\{\{([^}]+)\}\}/g, '$1')
  .replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*]+)\*/g, '$1').replace(/\[\[([^\]]+)\]\]/g, '$1').replace(/`([^`]+)`/g, '$1').trim();

// Everything a bench sheet needs from the Markdown: steps blocks, pipe tables (with the heading above them), and the prose
// of sections about procedure.
export function benchParts(body) {
  const lines = String(body || '').split('\n');
  const steps = []; const tables = []; const notes = [];
  let fence = null; let buf = []; let heading = ''; let section = ''; let tbl = null;
  const flush = () => { if (tbl && tbl.rows.length) tables.push(tbl); tbl = null; };
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (fence) {
      if (/^```/.test(line)) { if (fence === 'steps') steps.push(...parseSteps(buf.join('\n'))); fence = null; buf = []; } else buf.push(line);
      continue;
    }
    const f = line.match(/^```\s*(\w+)?/);
    if (f) { flush(); fence = f[1] || 'code'; buf = []; continue; }
    const hd = line.match(/^(#{2,4})\s+(.*)$/);
    if (hd) { flush(); heading = plain(hd[2]); if (hd[1] === '##') section = heading; continue; }
    if (/^\s*\|/.test(line)) {
      const cells = line.trim().replace(/^\||\|$/g, '').split('|').map((c) => plain(c));
      if (cells.every((c) => /^:?-{2,}:?$/.test(c.trim()))) continue;
      if (!tbl) tbl = { caption: heading, head: cells, rows: [] }; else tbl.rows.push(cells);
      continue;
    }
    flush();
    if (line.trim() && /步骤|方法|操作|流程|准备|配制/.test(section)) notes.push(plain(line));
  }
  flush();
  return { steps, tables, notes };
}

// Codes made on this page (aliquots A-…, solutions S-…) get a bottle label each.
function madeCodes(steps, materials) {
  const out = new Set();
  for (const s of steps) for (const k of ['what', 'into', 'note']) for (const m of String(s[k] || '').matchAll(CODE_RE)) if (!m[1].startsWith('R-')) out.add(m[1]);
  for (const m of materials || []) if (/^[AS]-/.test(m.id)) out.add(m.id);
  return [...out];
}

const BLANK_KEY = 'labnote-bench-blanks';
const recall = () => { try { return localStorage.getItem(BLANK_KEY) || '交联剂 (μL), 阈值功率 (mW), 气爆?, 备注'; } catch { return '交联剂 (μL), 阈值功率 (mW), 气爆?, 备注'; } };
const remember = (v) => { try { localStorage.setItem(BLANK_KEY, v); } catch { /* private window */ } };
const csvCell = (c) => (/[",\n]/.test(c) ? `"${String(c).replace(/"/g, '""')}"` : String(c ?? ''));

export async function openBench(vol, num) {
  const { fm, body } = parseFrontMatter(await lib.readPage(vol, num));
  const parts = benchParts(body);
  const materials = readMaterials(body) || [];
  const codes = madeCodes(parts.steps, materials);
  if (!parts.steps.length && !parts.tables.length) { toast('这一页没有“步骤”块或表格，没有可打印的操作单。'); return; }
  const blanks = h('input', { id: 'bn-blanks', value: recall(), placeholder: '逗号分隔，例如 阈值功率 (mW), 备注' });
  const withSteps = h('input', { type: 'checkbox', id: 'bn-steps', checked: parts.steps.length > 0, disabled: !parts.steps.length });
  const withNotes = h('input', { type: 'checkbox', id: 'bn-notes', checked: parts.notes.length > 0, disabled: !parts.notes.length });
  const withLabels = h('input', { type: 'checkbox', id: 'bn-labels', checked: codes.length > 0, disabled: !codes.length });
  const orient = h('select', { id: 'bn-orient' }, h('option', { value: 'auto' }, '自动（列多时横向）'), h('option', { value: 'portrait' }, 'A4 纵向'), h('option', { value: 'landscape' }, 'A4 横向'));
  const csv = () => {
    const out = [];
    if (parts.steps.length) out.push(['准备步骤'], STEP_FIELDS.map(([, l]) => l), ...parts.steps.map((s) => STEP_FIELDS.map(([k]) => s[k] || '')), []);
    parts.tables.forEach((t, i) => out.push([t.caption || `表 ${i + 1}`], t.head, ...t.rows, []));
    downloadText(`${fm.id || `${vol}-${num}`}_表格.csv`, `﻿${out.map((r) => r.map(csvCell).join(',')).join('\n')}`, 'text/csv');
  };
  modal({
    title: '实验操作单（打印带去实验室）',
    body: h('div', { class: 'form' },
      h('p', { class: 'muted' }, `本页有 ${parts.steps.length} 个准备步骤、${parts.tables.length} 张表${codes.length ? `、${codes.length} 个要贴瓶签的编号（${codes.join('、')}）` : ''}。每一行前面有勾选框，右侧留空白栏手写。`),
      h('label', { for: 'bn-blanks' }, '表格右侧加的手写栏'), blanks,
      h('label', { class: 'check', for: 'bn-steps' }, withSteps, ' 准备步骤（分装、称量、配母液）'),
      h('label', { class: 'check', for: 'bn-notes' }, withNotes, ' 步骤说明文字'),
      h('label', { class: 'check', for: 'bn-labels' }, withLabels, ' 瓶签（最后一页，剪下贴瓶）'),
      h('label', { for: 'bn-orient' }, '纸张方向'), orient),
    buttons: [{ label: '下载表格 CSV', run: () => { csv(); return false; } }, { label: '取消' }, { label: '打印 / 存为 PDF', primary: true, run: async () => {
      remember(blanks.value);
      const extra = blanks.value.split(/[,，]/).map((x) => x.trim()).filter(Boolean);
      await printBench(vol, num, fm, parts, { extra, steps: withSteps.checked, notes: withNotes.checked, labels: withLabels.checked ? codes : [], orient: orient.value, materials });
    } }],
  });
}

export async function printBench(vol, num, fm, parts, opt) {
  const [sols, reagents] = await Promise.all([loadSolutions(lib).catch(() => []), loadReagents(lib).catch(() => [])]);
  const by = new Map([...reagents, ...sols, ...(opt.refs || [])].map((r) => [r.id, r]));
  const box = () => h('span', { class: 'bx' });
  const blankCells = (n) => Array.from({ length: n }, () => h('td', { class: 'blank' }));
  const widest = Math.max(opt.steps && parts.steps.length ? 8 : 0, ...parts.tables.map((t) => t.head.length + 1 + opt.extra.length));
  const landscape = opt.orient === 'landscape' || (opt.orient === 'auto' && widest > 10);
  let sec = 0;
  const head = (t, sub) => h('h2', null, h('span', { class: 'bn-no' }, String(++sec).padStart(2, '0')), t, sub ? h('small', null, sub) : null);
  const v = lib.volume(vol);
  const nodes = [h('header', { class: 'bn-head' },
    h('div', { class: 'bn-kicker' }, '实验操作单 · BENCH SHEET'),
    h('h1', null, fm.title || `第 ${num} 页`),
    h('div', { class: 'bn-meta' },
      h('span', null, h('i', null, '实验编号'), fm.id || `${v?.title || vol} 第 ${num} 页`),
      h('span', null, h('i', null, '记录日期'), String(fm.date || '').slice(0, 10)),
      h('span', null, h('i', null, '实验日期'), h('u')),
      h('span', null, h('i', null, '操作人'), h('u'))))];
  const mats = (opt.materials || []).filter((m) => /^R-/.test(m.id));
  if (mats.length) nodes.push(h('p', { class: 'bn-mats' }, h('b', null, '原瓶试剂　'), mats.map((m) => `${m.id} ${by.get(m.id)?.name || ''}${by.get(m.id)?.location ? `（${by.get(m.id).location}）` : ''}`).join('；')));
  if (opt.steps && parts.steps.length) {
    nodes.push(h('section', null, head('准备', '分装 · 称量 · 配制'),
      h('table', { class: 'bn-t' },
        h('thead', null, h('tr', null, h('th', { class: 'ck' }, '✓'), STEP_FIELDS.map(([, l]) => h('th', null, l)), h('th', { class: 'blank-h' }, '实际 / 备注'))),
        h('tbody', null, parts.steps.map((s) => h('tr', null, h('td', { class: 'ck' }, box()), STEP_FIELDS.map(([k]) => h('td', { class: `c-${k}` }, s[k] || '')), h('td', { class: 'blank' })))))));
  }
  if (opt.notes && parts.notes.length) nodes.push(h('section', { class: 'bn-notes' }, head('说明'), parts.notes.map((t) => h('p', null, t))));
  parts.tables.forEach((t, i) => {
    nodes.push(h('section', null, head(t.caption && !/步骤|方法/.test(t.caption) ? t.caption : `表 ${i + 1}`, `${t.rows.length} 行`),
      h('table', { class: 'bn-t' },
        h('thead', null, h('tr', null, h('th', { class: 'ck' }, '✓'), t.head.map((c) => h('th', null, c)), opt.extra.map((c) => h('th', { class: 'blank-h' }, c)))),
        h('tbody', null, t.rows.map((r) => h('tr', null, h('td', { class: 'ck' }, box()), t.head.map((_, j) => h('td', { class: /^\s*[-\d.:\s/]+\s*$/.test(r[j] || '') ? 'num' : null }, r[j] || '')), blankCells(opt.extra.length)))))));
  });
  nodes.push(h('section', { class: 'bn-obs' }, head('现象与备注'), Array.from({ length: 6 }, () => h('div', { class: 'bn-line' }))));
  const sheets = [h('article', { class: `bench-sheet${landscape ? ' landscape' : ''}` }, nodes)];
  if (opt.labels.length) {
    sheets.push(h('article', { class: 'bench-sheet bn-labels-sheet' },
      h('h2', null, '瓶签', h('small', null, '沿虚线剪下，贴在瓶身；日期和姓名缩写现场手写')),
      h('div', { class: 'bn-labels' }, opt.labels.map((c) => {
        const r = by.get(c) || {};
        return h('div', { class: 'bn-label' },
          h('div', { class: 'lb-code' }, c),
          h('div', { class: 'lb-name' }, String(r.name || '').replace(/（分装）$/, '')),
          h('div', { class: 'lb-sub' }, [r.conc, r.volume].filter(Boolean).join(' · ') || ' '),
          h('div', { class: 'lb-fill' }, h('span', null, '日期'), h('u'), h('span', null, '人'), h('u')));
      }))));
  }
  const pr = printSheets(sheets);
  const style = h('style', { id: 'bench-page' }, `@page { size: A4 ${landscape ? 'landscape' : 'portrait'}; }`);
  document.head.append(style);
  document.body.classList.add('print-volume', 'print-bench');
  const title = document.title;
  document.title = `操作单_${fm.id || `${vol}-${num}`}_${fm.title || ''}`;
  window.addEventListener('afterprint', () => { document.title = title; style.remove(); document.body.classList.remove('print-bench'); }, { once: true });
  await Promise.all([...pr.querySelectorAll('img')].map((i) => i.decode?.().catch(() => {})));
  setTimeout(() => window.print(), 50);
  return pr;
}
