// 资料表 (tables/T-0001.md): answers worth keeping — usually a table Claude gave in a chat — pasted in once,
// with a title and tags, so they can be found by search instead of scrolling back through old conversations.
// Each one is a Markdown file: front matter (title, date, id, tags, topic, source, question) + the content as pasted.
import { parseFrontMatter, serializePage, nowISO, todayISO, cleanTag, fmtDate } from './model.js';
import { renderInto } from './render.js';
import { toCSV } from './lab.js';
import { h, icon } from './util.js';
import { lib, modal, toast, topbar, demoBanner, downloadText, saveError, choose } from './core.js';
import { loadPlanner } from './planner.js';
import { topicsOf } from './finds.js';

export const TABLE_RE = /^tables\/(T-\d{4})\.md$/;
export const tablePath = (id) => `tables/${id}.md`;
export const tableIds = () => [...lib.tree.keys()].map((p) => (p.match(TABLE_RE) || [])[1]).filter(Boolean).sort();
const nextId = () => `T-${String(Math.max(0, ...tableIds().map((x) => parseInt(x.slice(2), 10))) + 1).padStart(4, '0')}`;

export async function loadTables() {
  const out = await Promise.all(tableIds().map(async (id) => {
    try { const { fm, body } = parseFrontMatter(await lib.readText(tablePath(id))); return { ...fm, id, tags: fm.tags || [], body }; } catch { return null; }
  }));
  return out.filter(Boolean).sort((a, b) => String(b.date).localeCompare(String(a.date)) || b.id.localeCompare(a.id));
}

// ---------- pasted content -> Markdown ----------
const cellText = (s) => String(s).replace(/\s*\n\s*/g, ' ').replace(/\|/g, '\\|').trim();
export function pipeTable(rows) {
  const w = Math.max(...rows.map((r) => r.length));
  const full = rows.map((r) => [...r, ...Array(w - r.length).fill('')].map(cellText));
  return [full[0], Array(w).fill('---'), ...full.slice(1)].map((r) => `| ${r.join(' | ')} |`).join('\n');
}
function inline(node) {
  let out = '';
  for (const n of node.childNodes) {
    if (n.nodeType === 3) { out += n.textContent.replace(/\s+/g, ' '); continue; }
    if (n.nodeType !== 1) continue;
    const t = n.tagName.toLowerCase(); const inner = inline(n);
    if (t === 'strong' || t === 'b') out += inner.trim() ? `**${inner.trim()}**` : '';
    else if (t === 'em' || t === 'i') out += inner.trim() ? `*${inner.trim()}*` : '';
    else if (t === 'code') out += `\`${n.textContent}\``;
    else if (t === 'br') out += '\n';
    else if (t === 'sub') out += `<sub>${inner}</sub>`;
    else if (t === 'sup') out += `<sup>${inner}</sup>`;
    else if (t === 'a' && n.getAttribute('href') && /^https?:/.test(n.getAttribute('href'))) out += `[${inner.trim()}](${n.getAttribute('href')})`;
    else out += inner;
  }
  return out;
}
function block(node, depth = 0) {
  const parts = [];
  for (const n of node.childNodes) {
    if (n.nodeType === 3) { if (n.textContent.trim()) parts.push(n.textContent.trim()); continue; }
    if (n.nodeType !== 1) continue;
    const t = n.tagName.toLowerCase();
    if (t === 'table') {
      const rows = [...n.querySelectorAll('tr')].map((tr) => [...tr.children].filter((c) => /^t[hd]$/i.test(c.tagName)).map((c) => inline(c).replace(/\n/g, ' ')));
      if (rows.length) parts.push(pipeTable(rows));
    } else if (/^h[1-6]$/.test(t)) parts.push(`${'#'.repeat(Math.min(6, Number(t[1]) + 1))} ${inline(n).trim()}`);
    else if (t === 'ul' || t === 'ol') {
      parts.push([...n.children].filter((li) => li.tagName === 'LI').map((li, i) => {
        const nested = [...li.children].filter((c) => /^(UL|OL)$/.test(c.tagName));
        const own = li.cloneNode(true); own.querySelectorAll('ul, ol').forEach((x) => x.remove());
        return `${'  '.repeat(depth)}${t === 'ol' ? `${i + 1}.` : '-'} ${inline(own).trim()}${nested.map((x) => `\n${block({ childNodes: [x] }, depth + 1)}`).join('')}`;
      }).join('\n'));
    } else if (t === 'pre') parts.push(`\`\`\`\n${n.textContent.replace(/\n$/, '')}\n\`\`\``);
    else if (t === 'blockquote') parts.push(block(n).split('\n').map((l) => `> ${l}`).join('\n'));
    else if (t === 'hr') parts.push('---');
    else if (t === 'p') { const s = inline(n).trim(); if (s) parts.push(s); }
    else if (['div', 'section', 'article', 'body', 'main', 'span', 'font'].includes(t)) { const s = block(n, depth); if (s) parts.push(s); }
    else if (!['style', 'script', 'meta', 'button', 'svg'].includes(t)) { const s = inline(n).trim(); if (s) parts.push(s); }
  }
  return parts.join(depth ? '\n' : '\n\n');
}
export function htmlToMarkdown(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return block(doc.body).replace(/\n{3,}/g, '\n\n').trim();
}
// Plain text: Markdown stays as it is; tab-separated cells (Excel, a copied table) become a Markdown table.
export function textToMarkdown(text) {
  const t = String(text || '').replace(/\r\n?/g, '\n').trim();
  const lines = t.split('\n');
  if (!/^\s*\|.*\|\s*$/m.test(t) && lines.length > 1 && lines.filter((l) => l.includes('\t')).length >= Math.max(2, lines.length * 0.6)) {
    return pipeTable(lines.filter((l) => l.trim()).map((l) => l.split('\t')));
  }
  return t;
}
export function clipboardMarkdown(e) {
  const html = e.clipboardData?.getData('text/html') || '';
  const text = e.clipboardData?.getData('text/plain') || '';
  // Rendered answers come with HTML; when the plain text is already a Markdown table (Claude's copy button), keep it.
  if (/^\s*\|.*\|\s*$/m.test(text)) return text.trim();
  if (/<table[\s>]/i.test(html)) return htmlToMarkdown(html);
  return textToMarkdown(text);
}

// Markdown tables in a body -> [[cells]] for copying to Excel or CSV
export function tablesIn(md) {
  const out = []; let cur = null;
  for (const line of String(md).split('\n')) {
    if (/^\s*\|.*\|\s*$/.test(line)) {
      if (/^\s*\|(\s*:?-{2,}:?\s*\|)+\s*$/.test(line)) continue;
      const cells = line.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|').replace(/\*\*(.*?)\*\*/g, '$1'));
      (cur ||= []).push(cells);
    } else if (cur) { out.push(cur); cur = null; }
  }
  if (cur) out.push(cur);
  return out;
}
const firstHeading = (md) => (String(md).match(/^#{1,6}\s+(.+)$/m) || [])[1]?.replace(/\*\*/g, '').trim() || '';
const shape = (md) => { const ts = tablesIn(md); return ts.length ? ts.map((t) => `${t.length - 1} 行 × ${t[0].length} 列`).join('，') : '无表格'; };

// ---------- saving ----------
async function saveTable(t, isNew) {
  return lib.commit(`${isNew ? 'Add' : 'Update'} table ${t.id}: ${t.title}`, async (l) => {
    let id = t.id;
    if (isNew) { const used = new Set([...l.tree.keys()].map((p) => (p.match(TABLE_RE) || [])[1]).filter(Boolean)); while (used.has(id)) id = `T-${String(parseInt(id.slice(2), 10) + 1).padStart(4, '0')}`; }
    const fm = { title: t.title, date: t.date, id, tags: t.tags, topic: t.topic || undefined, source: t.source || undefined, question: t.question || undefined, updated: isNew ? undefined : nowISO() };
    return { changes: [{ path: tablePath(id), data: serializePage(fm, t.body) }], result: id };
  });
}

export async function editTable(t = null, { body = '' } = {}) {
  const isNew = !t;
  const x = t ? { ...t } : { id: nextId(), date: todayISO(), tags: [], source: 'Claude 对话', body };
  const doc = await loadPlanner().catch(() => ({}));
  const topics = topicsOf(doc);
  const all = await loadTables().catch(() => []);
  const tagSet = [...new Set(all.flatMap((y) => y.tags || []))];
  const title = h('input', { id: 'tb-title', value: x.title || '', placeholder: '例如：可双光子打印的 n 型聚合物对比', autocomplete: 'off' });
  const tags = h('input', { id: 'tb-tags', value: (x.tags || []).join('，'), placeholder: '用逗号分隔，例如 2PP，n 型，溶剂', list: 'tb-tag-list' });
  const question = h('input', { id: 'tb-q', value: x.question || '', placeholder: '可选：当时问 Claude 的问题，以后好找' });
  const topic = h('select', { id: 'tb-topic' }, [{ id: '', name: '不归课题' }, ...topics].map((o) => h('option', { value: o.id, selected: (x.topic || '') === o.id }, o.name)));
  const source = h('input', { id: 'tb-src', value: x.source || '', placeholder: 'Claude 对话 / 文献 / 自己整理' });
  const text = h('textarea', { id: 'tb-body', class: 'tb-src', rows: 10, placeholder: '在这里 ⌘V 粘贴 Claude 的回答：网页上选中复制、或点回答下方的复制按钮都行，表格会保持原样。' }, x.body || '');
  const preview = h('div', { class: 'prose tb-preview' });
  const info = h('p', { class: 'muted small tb-shape' });
  const redraw = async () => {
    await renderInto(preview, text.value || '_（还没有内容）_', { lib, urls: [] });
    info.textContent = `识别到：${shape(text.value)}`;
    if (!title.value.trim() && firstHeading(text.value)) title.placeholder = firstHeading(text.value);
  };
  let tmr = null;
  text.addEventListener('input', () => { clearTimeout(tmr); tmr = setTimeout(redraw, 250); });
  text.addEventListener('paste', (e) => {
    const md = clipboardMarkdown(e); if (!md) return;
    e.preventDefault();
    const s = text.selectionStart; const v = text.value;
    text.value = v.slice(0, s) + md + v.slice(text.selectionEnd);
    redraw();
    toast(`已粘贴：${shape(md)}。`);
  });
  redraw();
  modal({
    title: isNew ? '存一张资料表' : `修改 ${x.id}`, wide: true,
    body: h('div', { class: 'form tb-form' },
      h('label', { for: 'tb-title' }, '标题'), title,
      h('div', { class: 'pair' }, h('div', null, h('label', { for: 'tb-tags' }, '标签'), tags, h('datalist', { id: 'tb-tag-list' }, tagSet.map((g) => h('option', { value: g })))),
        h('div', null, h('label', { for: 'tb-topic' }, '课题'), topic)),
      h('label', { for: 'tb-q' }, '提问'), question,
      h('label', { for: 'tb-body' }, '内容（Markdown，可以改）'), text, info,
      h('details', { class: 'tb-more', open: true }, h('summary', null, '预览'), preview),
      h('label', { for: 'tb-src' }, '来源'), source),
    buttons: [{ label: '取消' }, { label: '保存', primary: true, run: async () => {
      x.title = title.value.trim() || firstHeading(text.value);
      if (!x.title) { toast('写一个标题，以后靠它找。'); title.focus(); return false; }
      if (!text.value.trim()) { toast('先粘贴内容。'); text.focus(); return false; }
      Object.assign(x, { body: text.value.trim(), tags: tags.value.split(/[,，、;；\s]+/).map(cleanTag).filter(Boolean), question: question.value.trim(), topic: topic.value, source: source.value.trim() });
      try { const id = await saveTable(x, isNew); toast(`${id} 已存好。`); location.hash = `#/tables/${id}`; } catch (e) { toast(saveError(e)); return false; }
    } }],
  });
}

// ---------- views ----------
const TAG_KEY = 'labnote-table-tag';
export async function viewTables(params = new URLSearchParams()) {
  const all = await loadTables();
  let tag = params.get('tag') || '';
  const q = h('input', { type: 'search', placeholder: '搜标题、提问、标签、表格里的字…', value: params.get('q') || '', 'aria-label': '搜资料表' });
  const tagsBox = h('div', { class: 'clip-chips' });
  const list = h('div', { class: 'tb-grid' });
  const counts = new Map(); for (const t of all) for (const g of t.tags) counts.set(g, (counts.get(g) || 0) + 1);
  const draw = () => {
    const words = q.value.toLowerCase().split(/\s+/).filter(Boolean);
    const hit = all.filter((t) => (!tag || t.tags.includes(tag)) && words.every((w) => `${t.id} ${t.title} ${t.question || ''} ${t.tags.join(' ')} ${t.body}`.toLowerCase().includes(w)));
    tagsBox.replaceChildren(...[['', '全部', all.length], ...[...counts].sort((a, b) => b[1] - a[1]).map(([g, n]) => [g, `#${g}`, n])].map(([g, l, n]) => h('button', { type: 'button', class: `chip${tag === g ? ' on' : ''}`, onclick: () => { tag = g; try { localStorage.setItem(TAG_KEY, g); } catch { /* */ } draw(); } }, l, h('b', null, String(n)))));
    list.replaceChildren(...(hit.length ? hit.map((t) => {
      const ts = tablesIn(t.body);
      return h('a', { class: 'tile tb-card', href: `#/tables/${t.id}` },
        h('div', { class: 'tb-top' }, h('span', { class: 'xid-tag' }, t.id), h('span', { class: 'muted small' }, fmtDate(t.date))),
        h('b', { class: 'tb-title' }, t.title),
        t.question ? h('p', { class: 'tb-q' }, `问：${t.question}`) : null,
        ts.length ? h('p', { class: 'tb-cols' }, `${ts[0][0].slice(0, 5).join(' · ')}${ts[0][0].length > 5 ? ' …' : ''}`) : null,
        h('div', { class: 'tb-foot' }, h('span', { class: 'muted small' }, shape(t.body)), ...t.tags.slice(0, 4).map((g) => h('span', { class: 'tb-tag' }, `#${g}`))));
    }) : [h('p', { class: 'muted' }, all.length ? '没有符合的资料表。' : '还没有资料表。点「存一张资料表」，把 Claude 回答里的表格粘贴进来，起个标题。')]));
  };
  q.addEventListener('input', draw);
  draw();
  const root = h('div', { class: 'view library tables' },
    topbar({ back: '#/', backLabel: '首页', title: '资料表', sub: `${all.length} 张 · Claude 给的表格、整理过的对比，存一次，以后搜得到`, actions: [
      h('button', { class: 'btn primary', type: 'button', onclick: () => editTable() }, icon('plus', 18), h('span', null, '存一张资料表'))] }),
    demoBanner(),
    h('div', { class: 'tb-wrap' }, h('div', { class: 'search-row' }, q), tagsBox, list));
  // ⌘V anywhere on this page opens the dialog with the pasted content
  const onPaste = (e) => {
    if (!document.body.contains(root)) { document.removeEventListener('paste', onPaste); return; }
    if (e.target.closest?.('input, textarea, .modal-root')) return;
    const md = clipboardMarkdown(e); if (!md) return;
    e.preventDefault(); editTable(null, { body: md });
  };
  document.addEventListener('paste', onPaste);
  return root;
}

export async function viewTable(id) {
  const all = await loadTables();
  const t = all.find((x) => x.id === id);
  if (!t) return h('div', { class: 'view missing' }, topbar({ back: '#/tables', backLabel: '资料表', title: '找不到' }), h('p', { class: 'loading' }, `没有 ${id}。`));
  const ts = tablesIn(t.body);
  const tsv = () => ts.map((x) => x.map((r) => r.join('\t')).join('\n')).join('\n\n');
  const doc = await loadPlanner().catch(() => ({}));
  const tp = topicsOf(doc).find((x) => x.id === t.topic);
  const body = h('div', { class: 'prose tb-body' });
  await renderInto(body, t.body, { lib, urls: [] });
  const copy = async (s, what) => { try { await navigator.clipboard.writeText(s); toast(`已复制${what}。`); } catch { toast('浏览器不让复制，请手动选中。'); } };
  return h('div', { class: 'view library tables' },
    topbar({ back: '#/tables', backLabel: '资料表', title: t.title, sub: `${t.id} · ${fmtDate(t.date)}${t.source ? ` · ${t.source}` : ''}`, actions: [
      h('button', { class: 'btn', type: 'button', onclick: () => editTable(t) }, icon('edit', 18), h('span', { class: 'wide-only' }, '修改')),
      ts.length ? h('button', { class: 'btn', type: 'button', title: '复制后在 Excel / WPS 里直接粘贴', onclick: () => copy(tsv(), '表格（可直接粘贴到 Excel）') }, icon('copy', 18), h('span', { class: 'wide-only' }, '复制到 Excel')) : null,
      h('button', { class: 'btn', type: 'button', title: '复制 Markdown，可粘贴进实验页', onclick: () => copy(t.body, ' Markdown（可粘贴进实验页）') }, icon('copy', 18), h('span', { class: 'wide-only' }, '复制 Markdown')),
      ts.length ? h('button', { class: 'btn', type: 'button', onclick: () => ts.forEach((x, i) => downloadText(`${t.id}_${t.title.replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 40)}${ts.length > 1 ? `_${i + 1}` : ''}.csv`, `﻿${toCSV(x)}`, 'text/csv')) }, icon('download', 18), h('span', { class: 'wide-only' }, 'CSV')) : null,
      h('button', { class: 'btn danger', type: 'button', onclick: async () => {
        if ((await choose(`删除 ${t.id}“${t.title}”？`, 'GitHub 历史里仍可找回。', [['yes', '删除'], ['no', '取消']])) !== 'yes') return;
        try { await lib.commit(`Delete table ${t.id}`, async () => ({ changes: [{ path: tablePath(t.id), delete: true }] })); toast('已删除。'); location.hash = '#/tables'; } catch (e) { toast(saveError(e)); }
      } }, icon('trash', 18))] }),
    demoBanner(),
    h('article', { class: 'sheet plain wide-sheet tb-sheet' },
      h('h1', { class: 'tb-h' }, t.title),
      h('div', { class: 'tb-meta' },
        t.question ? h('p', { class: 'tb-q' }, h('span', null, '提问'), t.question) : null,
        h('p', { class: 'tb-tags' }, tp ? h('span', { class: 'nt-topic', style: { '--k': tp.color } }, tp.name) : null, ...t.tags.map((g) => h('a', { class: 'tb-tag', href: `#/tables?tag=${encodeURIComponent(g)}` }, `#${g}`)))),
      body));
}

// For the global search
export async function tableSearchItems() {
  return (await loadTables()).map((t) => ({ tag: t.id, title: t.title, href: `#/tables/${t.id}`, text: `${t.id} ${t.title} ${t.question || ''} ${t.tags.join(' ')} ${t.body.replace(/[|*#`-]+/g, ' ')}` }));
}
