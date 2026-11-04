// PDF and Word export, the print frame, and the live PDF preview.
import { fmtDate, parseFrontMatter, todayISO } from './model.js';
import { fitChartsForPrint, renderInto } from './render.js';
import { addDays, readSamples, sectionOf } from './lab.js';
import { h, loadScript } from './util.js';
import { downloadText, lib, modal, thead, toast } from './core.js';
import { cover } from './home.js';
import { buildPageSheet, expPanel, recordSheet, shownBody, viewVolume } from './pages.js';

// ----- live PDF preview: the page laid out with the export's own print styles, in an A4 frame -----
export let printCss = null;
export const printRules = () => (printCss ??= fetch('css/notebook.css').then((r) => r.text()).then((css) => {
  let out = ''; const re = /@media\s+print\s*\{/g; let m;
  while ((m = re.exec(css))) {
    let depth = 1; let j = re.lastIndex;
    while (j < css.length && depth) { if (css[j] === '{') depth++; else if (css[j] === '}') depth--; j++; }
    out += `${css.slice(re.lastIndex, j - 1)}\n`; re.lastIndex = j;
  }
  return out;
}).catch(() => ''));
export function pdfPreview() {
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

// Prints the given sheets inside a table whose header and footer rows repeat on
// every sheet of paper: that gives each page its margins while @page margin 0
// keeps the browser from adding its own date, title and address lines.
export function printSheets(nodes) {
  const pr = document.getElementById('print-root');
  pr.replaceChildren(printFrame(nodes));
  return pr;
}
// Running header and footer, repeated on every sheet of paper.
export function printFrame(nodes) {
  const nb = lib?.notebook || {};
  return (h('table', { class: 'print-frame' },
    h('thead', null, h('tr', null, h('td', { class: 'pf-top' }, h('div', { class: 'pf-run' },
      h('span', null, nb.title || '实验记录本'), h('span', null, 'LABORATORY RECORD'))))),
    h('tbody', null, h('tr', null, h('td', { class: 'pf-body' }, nodes))),
    h('tfoot', null, h('tr', null, h('td', { class: 'pf-bottom' }, h('div', { class: 'pf-run foot' },
      h('span', null, nb.owner ? `记录人　${nb.owner}` : ''), h('span', null, `导出于 ${todayISO()}`)))))));
}

// ---------- printing ----------
export async function printVolume(id) {
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

// ----- export a date range for the supervisor: PDF (print) or Word -----
export function openExport(vol) {
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

export async function summaryRows(pages) {
  const rows = [];
  for (const p of pages) {
    const { body } = parseFrontMatter(await lib.readPage(p.vol, p.num));
    const t = readSamples(body);
    const concl = (sectionOf(body, '结论') || '').split('\n').map((x) => x.replace(/^[-*>\s]+/, '').trim()).find(Boolean) || '';
    rows.push([p.date, p.xid || '', p.title + (p.void ? '（已作废）' : ''), lib.volume(p.vol)?.title || p.vol, p.protocol || '', t ? String(t.rows.length) : '', concl, p.signed ? '已签名' : '未签名']);
  }
  return rows;
}
export const SUMMARY_HEAD = ['日期', '实验编号', '标题', '卷', 'SOP', '样品数', '结论', '签名'];
export const exportName = (a, b) => `实验记录_${a.replace(/-/g, '')}-${b.replace(/-/g, '')}`;

export async function exportPdf(pages, a, b, { cover = true, title: heading = '实验记录汇总' } = {}) {
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

export async function exportWord(pages, a, b, { title: heading = '实验记录汇总' } = {}) {
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
