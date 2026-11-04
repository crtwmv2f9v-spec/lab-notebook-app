// Markdown, math, page links, charts, data tables and Jupyter notebooks.
import { esc, h, loadScript, icon } from './util.js';
import { parseRef, parseFrontMatter } from './model.js';
import { parseCSV, isResultCol, colLabel, sampleNo, parseSteps, reactionHTML, loadReagents, parseQuote, sectionOf, EXP_RE, loadSolutions, loadHypothesis, evidenceCounts, parseMaterials, loadMethod } from './lab.js';

const CDN = 'https://cdn.jsdelivr.net/npm/';
export const LIBS = {
  plotly: [`${CDN}plotly.js-dist-min@2.35.2/plotly.min.js`, 'sha384-cCVCZkAjYNxaYKbM8lsArLznDF/SvMFr1jcZrvOpSTCa0W40ZAdLzHCEulnUa5i7'],
  papa: [`${CDN}papaparse@5.4.1/papaparse.min.js`, 'sha384-D/t0ZMqQW31H3az8ktEiNb39wyKnS82iFY52QPACM+IjKW3jDUhyIgh2PApRqJZs'],
};
export const loadLib = (name) => loadScript(...LIBS[name]);

// ctx = { lib, vol, num, resolveBlob(name) -> Promise<Blob>, urls: [] }
let cur = null;
let ready = false;

function setup() {
  if (ready) return;
  ready = true;
  const { marked, DOMPurify } = window;
  marked.use({
    gfm: true,
    breaks: true, // one Enter = a new line, as written
    extensions: [
      {
        name: 'mathBlock', level: 'block',
        start(src) { const i = src.search(/^\$\$/m); return i < 0 ? undefined : i; },
        tokenizer(src) {
          const m = /^\$\$([\s\S]+?)\$\$[ \t]*(?:\n|$)/.exec(src);
          if (m) return { type: 'mathBlock', raw: m[0], text: m[1].trim() };
        },
        renderer(t) { return `<div class="math math-display" data-tex="${esc(t.text)}"></div>\n`; },
      },
      {
        name: 'embedBlock', level: 'block',
        start(src) { const i = src.search(/^!\[\[/m); return i < 0 ? undefined : i; },
        tokenizer(src) {
          const m = /^!\[\[([^\]\n]+)\]\][ \t]*(?:\n|$)/.exec(src);
          if (m) return { type: 'embedBlock', raw: m[0], target: m[1] };
        },
        renderer(t) {
          const [target, caption = ''] = t.target.split('|');
          return `<div class="embed" data-embed="${esc(target.trim())}" data-caption="${esc(caption.trim())}"></div>\n`;
        },
      },
      {
        name: 'embedInline', level: 'inline',
        start(src) { const i = src.indexOf('![['); return i < 0 ? undefined : i; },
        tokenizer(src) {
          const m = /^!\[\[([^\]\n]+)\]\]/.exec(src);
          if (m) return { type: 'embedInline', raw: m[0], target: m[1].split('|')[0].trim() };
        },
        renderer(t) { return `<a class="file-chip" href="#" data-att-link="${esc(t.target)}">${esc(t.target)}</a>`; },
      },
      // ==highlighter==  ++underline++  {{circled}}
      ...[['mark', '==', '==', 'mark', 'hl'], ['uline', '++', '++', 'span', 'pen-ul'], ['circle', '{{', '}}', 'span', 'pen-circle']].map(([name, a, b, tag, cls]) => ({
        name, level: 'inline',
        start(src) { const i = src.indexOf(a); return i < 0 ? undefined : i; },
        tokenizer(src) {
          const esc = (x) => x.replace(/[{}+=]/g, '\\$&');
          const m = new RegExp(`^${esc(a)}(?=\\S)([^\\n]*?\\S)${esc(b)}`).exec(src);
          if (m) return { type: name, raw: m[0], tokens: this.lexer.inlineTokens(m[1]) };
        },
        renderer(t) { return `<${tag} class="${cls}">${this.parser.parseInline(t.tokens)}</${tag}>`; },
      })),
      {
        name: 'wikilink', level: 'inline',
        start(src) { const i = src.indexOf('[['); return i < 0 ? undefined : i; },
        tokenizer(src) {
          const m = /^\[\[([^\]|\n]+)(?:\|([^\]\n]+))?\]\]/.exec(src);
          if (m) return { type: 'wikilink', raw: m[0], target: m[1].trim(), label: m[2] && m[2].trim() };
        },
        renderer(t) { return pageLink(t.target, t.label); },
      },
      {
        name: 'mathInline', level: 'inline',
        start(src) { const i = src.search(/\$|\\\(/); return i < 0 ? undefined : i; },
        tokenizer(src) {
          let m = /^\$\$([^$]+?)\$\$/.exec(src);
          if (m) return { type: 'mathInline', raw: m[0], text: m[1], display: true };
          m = /^\$(?![\s$])((?:\\\$|[^$\n])+?)(?<![\s\\])\$(?![\w])/.exec(src);
          if (m) return { type: 'mathInline', raw: m[0], text: m[1] };
          m = /^\\\((.+?)\\\)/.exec(src);
          if (m) return { type: 'mathInline', raw: m[0], text: m[1] };
        },
        renderer(t) { return `<span class="math${t.display ? ' math-display' : ''}" data-tex="${esc(t.text)}"></span>`; },
      },
    ],
  });

  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'IMG') {
      const src = node.getAttribute('src') || '';
      if (src && !/^(https?:|data:image\/|blob:)/i.test(src)) {
        node.setAttribute('data-att', src);
        node.removeAttribute('src');
      } else node.setAttribute('loading', 'lazy');
    }
    if (node.tagName === 'A') {
      const href = node.getAttribute('href') || '';
      if (/^https?:/i.test(href)) {
        node.setAttribute('target', '_blank');
        node.setAttribute('rel', 'noopener noreferrer');
      } else if (href && !href.startsWith('#') && !/^mailto:/i.test(href)) {
        node.setAttribute('data-att-link', href);
        node.setAttribute('href', '#');
      }
    }
  });
}

function pageLink(target, label) {
  const r = parseRef(target, cur?.vol);
  if (!r) return `<span class="pageref bad">[[${esc(target)}]]</span>`;
  const lib = cur?.lib;
  const page = lib?.page(r.vol, r.num);
  const vol = lib?.volume(r.vol);
  const text = label || (r.vol === cur?.vol ? `p. ${r.num}` : `${vol ? vol.title : r.vol}, p. ${r.num}`);
  const title = page ? page.title : 'This page doesn’t exist yet';
  return `<a class="pageref${page ? '' : ' missing'}" href="#/v/${esc(r.vol)}/${r.num}" title="${esc(title)}">${esc(text)}</a>`;
}

export function renderMarkdown(md, ctx) {
  setup();
  cur = ctx;
  try {
    const html = window.marked.parse(String(md || ''));
    return window.DOMPurify.sanitize(html, { ADD_ATTR: ['target'] });
  } finally { cur = null; }
}

// Render markdown into an element, then load figures, charts and embeds.
// Resolves when everything (including charts) has been drawn.
export async function renderInto(el, md, ctx) {
  el.innerHTML = renderMarkdown(md, ctx);
  return hydrate(el, ctx);
}

export async function hydrate(root, ctx) {
  for (const el of root.querySelectorAll('.math[data-tex]')) renderMath(el);
  for (const code of root.querySelectorAll('pre > code')) {
    const lang = (code.className.match(/language-([\w+-]+)/) || [])[1];
    if (['chart', 'samples', 'steps', 'reaction', 'quote', 'hypothesis', 'materials'].includes(lang)) continue;
    if (lang && window.hljs?.getLanguage(lang)) { try { window.hljs.highlightElement(code); } catch { /* ignore */ } }
  }
  if (!root.dataset.wired) {
    root.dataset.wired = '1';
    root.addEventListener('click', (ev) => {
      const a = ev.target.closest('[data-att-link]');
      if (a && root.contains(a)) { ev.preventDefault(); openAttachment(a.dataset.attLink, ctx); return; }
      const img = ev.target.closest('figure.photo img');
      if (img && img.src) lightbox(img.src, img.alt);
    });
  }
  const jobs = [];
  // Number figures in reading order: taped-in photos, charts and embedded files.
  for (const img of root.querySelectorAll('img[data-att]')) jobs.push(loadImage(img, ctx));
  for (const p of root.querySelectorAll('p')) {
    const kids = [...p.childNodes].filter((n) => !(n.nodeType === 3 && !n.textContent.trim()));
    if (kids.length === 1 && kids[0].tagName === 'IMG') {
      const img = kids[0];
      const fig = h('figure', { class: 'printout photo' }, img);
      const alt = img.getAttribute('alt') || '';
      if (alt && alt !== img.dataset.att) fig.append(h('figcaption', null, alt));
      p.replaceWith(fig);
    }
  }
  for (const code of root.querySelectorAll('pre > code.language-chart')) jobs.push(renderChart(code.parentElement, code.textContent, ctx));
  for (const code of root.querySelectorAll('pre > code.language-samples')) jobs.push(renderSamples(code.parentElement, code.textContent, ctx));
  for (const el of root.querySelectorAll('div.embed[data-embed]')) jobs.push(renderEmbed(el, ctx));
  for (const code of root.querySelectorAll('pre > code.language-quote')) jobs.push(renderQuote(code.parentElement, code.textContent, ctx));
  for (const code of root.querySelectorAll('pre > code.language-hypothesis')) jobs.push(renderHypothesis(code.parentElement, code.textContent, ctx));
  for (const code of root.querySelectorAll('pre > code.language-reaction')) renderReactions(code.parentElement, code.textContent);
  for (const code of root.querySelectorAll('pre > code.language-steps')) renderSteps(code.parentElement, code.textContent);
  for (const code of root.querySelectorAll('pre > code.language-materials')) jobs.push(renderMaterials(code.parentElement, code.textContent, ctx, root));
  markQuantities(root);
  jobs.push(nameReagents(root, ctx));
  await Promise.allSettled(jobs);
  numberFigures(root);
  tidyTables(root);
}

// Tables: a unit at the end of a header ("CF 氯仿 (μL)") gets its own line, and wide tables are
// tagged so the PDF can set them smaller and still fit the A4 width.
function tidyTables(root) {
  for (const t of root.querySelectorAll('table')) {
    if (t.closest('.grid-wrap, .modal')) continue;
    const cols = Math.max(0, ...[...t.rows].map((r) => [...r.cells].reduce((n, c) => n + (c.colSpan || 1), 0)));
    t.classList.toggle('t-wide', cols >= 7 && cols < 10);
    t.classList.toggle('t-xwide', cols >= 10);
    t.classList.toggle('t-keep', t.rows.length <= 30); // short enough to print on one page, so never split it
    for (const th of t.querySelectorAll('th')) {
      if (th.dataset.split || [...th.childNodes].some((n) => n.nodeType !== 3)) continue;
      const m = th.textContent.trim().match(/^(.*?\S)\s*([(（][^()（）]{1,24}[)）])$/);
      if (!m) continue;
      th.dataset.split = '1';
      th.replaceChildren(h('span', { class: 'th-name' }, m[1]), ' ', h('span', { class: 'th-unit' }, m[2]));
    }
  }
}

function numberFigures(root) {
  let n = 0;
  for (const fig of root.querySelectorAll(':scope figure.printout')) {
    if (fig.closest('.nb')) continue;
    n++;
    let cap = fig.querySelector(':scope > figcaption');
    if (!cap) { cap = h('figcaption'); fig.append(cap); }
    let lab = cap.querySelector('.fig-no');
    if (!lab) { lab = h('span', { class: 'fig-no' }); cap.prepend(lab); }
    lab.textContent = `图 ${n}`;
  }
}

function renderMath(el) {
  const tex = el.dataset.tex;
  try {
    window.katex.render(tex, el, { displayMode: el.classList.contains('math-display'), throwOnError: false, output: 'htmlAndMathml' });
  } catch { el.textContent = tex; }
}

async function loadImage(img, ctx) {
  const name = img.dataset.att;
  try {
    const blob = await ctx.resolveBlob(name);
    const url = URL.createObjectURL(blob);
    ctx.urls?.push(url);
    img.src = url;
    await Promise.race([img.decode().catch(() => {}), new Promise((r) => setTimeout(r, 5000))]);
  } catch {
    img.replaceWith(h('span', { class: 'missing-file' }, `缺少附件：${name}`));
  }
}

async function openAttachment(name, ctx) {
  try {
    const blob = await ctx.resolveBlob(name);
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: name.split('/').pop() });
    if (/^(image\/|application\/pdf|text\/)/.test(blob.type)) { a.removeAttribute('download'); a.target = '_blank'; }
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch {
    window.dispatchEvent(new CustomEvent('labnote:toast', { detail: `Couldn't open ${name}.` }));
  }
}

export function lightbox(src, alt) {
  const box = h('div', { class: 'lightbox', role: 'dialog', 'aria-label': alt || 'Figure' },
    h('img', { src, alt: alt || '' }),
    h('button', { class: 'btn icon lightbox-close', 'aria-label': 'Close' }, icon('close')));
  const close = () => { box.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  box.addEventListener('click', (e) => { if (e.target !== box.querySelector('img')) close(); });
  document.addEventListener('keydown', onKey);
  document.body.append(box);
}

// ---------- tables ----------
async function parseTable(text, ext) {
  ext = (ext || 'csv').toLowerCase();
  if (ext === 'json') {
    const j = JSON.parse(text);
    if (Array.isArray(j)) return j;
    if (j && typeof j === 'object') {
      const cols = Object.keys(j);
      const n = Math.max(...cols.map((c) => (Array.isArray(j[c]) ? j[c].length : 0)));
      return Array.from({ length: n }, (_, i) => Object.fromEntries(cols.map((c) => [c, j[c]?.[i]])));
    }
    throw new Error('JSON data should be a list of rows or an object of columns.');
  }
  await loadLib('papa');
  const r = window.Papa.parse(text.trim(), { header: true, dynamicTyping: true, skipEmptyLines: true, delimiter: ext === 'tsv' ? '\t' : '' });
  return r.data;
}

function dataTable(rows, limit = 200) {
  const cols = Object.keys(rows[0] || {});
  const fmt = (v) => (typeof v === 'number' && !Number.isInteger(v) ? String(+v.toPrecision(6)) : v ?? '');
  return h('div', { class: 'table-wrap' },
    h('table', { class: 'data' },
      h('thead', null, h('tr', null, cols.map((c) => h('th', { scope: 'col' }, c)))),
      h('tbody', null, rows.slice(0, limit).map((r) => h('tr', null, cols.map((c) => h('td', { class: typeof r[c] === 'number' ? 'num' : null }, fmt(r[c]))))))),
    rows.length > limit ? h('p', { class: 'table-more' }, `显示 ${limit} / ${rows.length} 行。`) : null);
}

// ---------- charts ----------
function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
const DASHES = ['solid', 'dash', 'dot', 'dashdot', 'longdash', 'longdashdot'];

export function parseChartSpec(src) {
  const parts = String(src).split(/^---\s*$/m);
  const head = parts[0].trim();
  const inline = parts.length > 1 ? parts.slice(1).join('---').trim() : null;
  let spec = {};
  if (head.startsWith('{')) spec = JSON.parse(head);
  else {
    for (const line of head.split('\n')) {
      const m = line.match(/^\s*([\w-]+)\s*:\s*(.*)$/);
      if (m) spec[m[1].toLowerCase()] = m[2].trim();
    }
  }
  for (const k of ['y']) if (typeof spec[k] === 'string') spec[k] = spec[k].split(',').map((s) => s.trim()).filter(Boolean);
  for (const k of ['logx', 'logy', 'markers']) if (typeof spec[k] === 'string') spec[k] = /^(true|yes|1)$/i.test(spec[k]);
  if (inline) spec.inline = inline;
  return spec;
}

function buildFigure(spec, rows) {
  if (!rows.length) throw new Error('The data has no rows.');
  const type = String(spec.type || 'line').toLowerCase();
  const cols = Object.keys(rows[0]);
  const need = (c) => { if (!cols.includes(c)) throw new Error(`No column named “${c}”. Columns: ${cols.join(', ')}`); return c; };
  const numeric = (c) => rows.some((r) => typeof r[c] === 'number');
  const x = spec.x ? need(spec.x) : cols[0];
  const group = spec.group ? need(spec.group) : null;
  let ys = (spec.y || []).map(need);
  if (!ys.length) ys = cols.filter((c) => c !== x && c !== group && numeric(c));
  const col = (rs, c) => rs.map((r) => r[c]);
  const series = [];
  if (group) {
    const keys = [...new Set(col(rows, group))];
    for (const g of keys) { const rs = rows.filter((r) => r[group] === g); series.push({ name: String(g), rows: rs, y: ys[0] }); }
  } else for (const y of ys) series.push({ name: y, rows, y });

  const surface = cssVar('--printout') || '#fff';
  const dense = rows.length > 40;
  const traces = [];
  const layout = {};
  series.forEach((s, i) => {
    const err = spec.error && cols.includes(spec.error) ? { type: 'data', array: col(s.rows, spec.error), visible: true, thickness: 1.5, width: 3 } : undefined;
    if (type === 'line') {
      traces.push({ type: 'scatter', mode: dense || spec.markers === false ? 'lines' : 'lines+markers', name: s.name, x: col(s.rows, x), y: col(s.rows, s.y), line: { width: 2, dash: DASHES[i % DASHES.length] }, marker: { size: 8, line: { width: 2, color: surface } }, error_y: err });
    } else if (type === 'scatter') {
      traces.push({ type: 'scatter', mode: 'markers', name: s.name, x: col(s.rows, x), y: col(s.rows, s.y), marker: { size: 8, opacity: 0.85, line: { width: 1.5, color: surface } }, error_y: err });
    } else if (type === 'bar') {
      traces.push({ type: 'bar', name: s.name, x: col(s.rows, x), y: col(s.rows, s.y), marker: { line: { width: 2, color: surface } }, error_y: err });
      layout.barmode = 'group'; layout.bargap = 0.25;
    } else if (type === 'histogram') {
      traces.push({ type: 'histogram', name: s.name, x: col(s.rows, spec.y ? s.y : x), opacity: series.length > 1 ? 0.6 : 0.9, nbinsx: spec.bins ? Number(spec.bins) : undefined, marker: { line: { width: 1, color: surface } } });
      layout.barmode = 'overlay';
    } else if (type === 'box' || type === 'violin') {
      traces.push({ type, name: s.name, y: col(s.rows, s.y), boxpoints: 'outliers', points: 'outliers', line: { width: 1.5 } });
    } else if (type === 'heatmap') {
      // first column = row labels, remaining columns = cells
      if (i > 0) return;
      const label = cols[0];
      const cells = cols.slice(1);
      traces.push({ type: 'heatmap', z: rows.map((r) => cells.map((c) => r[c])), x: cells, y: col(rows, label), colorscale: [[0, cssVar('--seq-0') || '#eef3fb'], [1, cssVar('--seq-1') || '#1d3f7a']], hoverongaps: false, xgap: 2, ygap: 2 });
    } else throw new Error(`Unknown chart type “${type}”. Use line, scatter, bar, histogram, box, violin or heatmap.`);
  });
  const xlabel = spec.xlabel ?? (type === 'heatmap' || type === 'box' || type === 'violin' ? '' : (type === 'histogram' && spec.y ? '' : x));
  const ylabel = spec.ylabel ?? (type === 'histogram' ? 'Count' : series.length === 1 && type !== 'heatmap' ? series[0].y : '');
  return { data: traces, layout: { ...layout, xaxis: { title: { text: xlabel }, type: spec.logx ? 'log' : undefined }, yaxis: { title: { text: ylabel }, type: spec.logy ? 'log' : undefined } }, hover: type === 'line' ? 'x unified' : 'closest' };
}

function theme(layout, hovermode, nSeries) {
  const ink2 = cssVar('--ink-2'); const grid = cssVar('--chart-grid'); const axis = cssVar('--chart-axis');
  const font = cssVar('--font-form') || 'sans-serif';
  const palette = [1, 2, 3, 4, 5, 6].map((i) => cssVar(`--series-${i}`));
  const ax = (a = {}) => ({ ...a, gridcolor: grid, zeroline: false, linecolor: axis, tickcolor: axis, ticks: 'outside', ticklen: 4, automargin: true, title: { ...(a.title || {}), font: { size: 13, color: ink2 } } });
  return {
    ...layout,
    colorway: palette,
    font: { family: font, size: 13, color: ink2 },
    paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)',
    margin: { l: 56, r: 16, t: nSeries > 1 ? 40 : 12, b: 48 },
    xaxis: ax(layout.xaxis), yaxis: ax(layout.yaxis),
    showlegend: nSeries > 1,
    legend: { orientation: 'h', x: 0, y: 1.02, yanchor: 'bottom', font: { size: 13, color: ink2 } },
    hovermode: hovermode || 'closest',
    hoverlabel: { font: { family: font, size: 13, color: cssVar('--ink') }, bgcolor: cssVar('--paper'), bordercolor: axis },
  };
}

const plotConfig = () => ({ ...PLOT_CONFIG, displayModeBar: window.matchMedia('(max-width: 640px)').matches ? false : 'hover' });
const PLOT_CONFIG = { responsive: true, displaylogo: false, modeBarButtonsToRemove: ['lasso2d', 'select2d', 'autoScale2d', 'toggleSpikelines'], toImageButtonOptions: { format: 'png', scale: 2 } };

async function renderChart(pre, src, ctx) {
  const fig = h('figure', { class: 'printout chart' });
  pre.replaceWith(fig);
  try {
    const spec = parseChartSpec(src);
    let rows = null;
    if (spec.inline) rows = await parseTable(spec.inline, spec.format || 'csv');
    else if (spec.data) {
      const blob = await ctx.resolveBlob(spec.data);
      rows = await parseTable(await blob.text(), String(spec.data).split('.').pop());
    }
    await loadLib('plotly');
    let fg;
    if (spec.plotly) fg = { data: spec.plotly.data || [], layout: spec.plotly.layout || {}, hover: 'closest' };
    else if (rows) fg = buildFigure(spec, rows);
    else throw new Error('Add a “data:” line naming an attached CSV, or put CSV rows after a “---” line.');
    const plot = h('div', { class: 'chart-plot' });
    fig.append(plot);
    const cap = spec.title || spec.caption;
    fig.append(h('figcaption', null, cap ? ` ${cap}` : ''));
    if (rows) fig.append(h('details', { class: 'chart-data no-print' }, h('summary', null, `数据（${rows.length} 行）`), dataTable(rows)));
    await window.Plotly.newPlot(plot, fg.data, theme(fg.layout, fg.hover, fg.data.length), plotConfig());
  } catch (e) {
    fig.classList.add('broken');
    fig.replaceChildren(h('p', { class: 'chart-error' }, `图表画不出来：${e.message}`), h('pre', null, src));
  }
}

// ---------- sample table ----------
// ctx.xid = experiment number; ctx.attNames = attachment names of the page.
// Attachments named "<xid>-#09_…" belong to sample #09 and are shown in its row.
async function renderSamples(pre, src, ctx) {
  const rows = parseCSV(src);
  const cols = rows.shift() || [];
  const xid = ctx.xid || '';
  const files = ctx.attNames || [];
  const resStart = cols.findIndex(isResultCol);
  const table = h('table', { class: 'samples' },
    h('thead', null,
      resStart > 0 ? h('tr', { class: 'group' },
        h('th', { colspan: resStart, scope: 'colgroup' }, '条件'),
        h('th', { colspan: cols.length - resStart, scope: 'colgroup', class: 'res' }, '结果'),
        h('th', { scope: 'col' })) : null,
      h('tr', null, cols.map((c, i) => h('th', { scope: 'col', class: isResultCol(c) ? 'res' : i === 0 ? 'no' : null }, colLabel(c))), h('th', { scope: 'col', class: 'files' }, '照片 / 数据'))),
    h('tbody'));
  const jobs = [];
  for (const r of rows) {
    const no = sampleNo(r[0]);
    const sid = xid ? `${xid}-${no}` : no;
    const own = files.filter((f) => f.startsWith(`${sid}_`));
    const thumbs = h('td', { class: 'files' });
    for (const f of own) {
      if (/\.(jpe?g|png|gif|webp)$/i.test(f)) {
        const img = h('img', { alt: f, title: f, class: 'thumb' });
        thumbs.append(img);
        jobs.push(ctx.resolveBlob(f).then((b) => { const u = URL.createObjectURL(b); ctx.urls?.push(u); img.src = u; img.onclick = () => lightbox(u, f); }).catch(() => img.remove()));
      } else thumbs.append(h('a', { class: 'file-chip', href: '#', 'data-att-link': f }, f.slice(sid.length + 1)));
    }
    table.tBodies[0].append(h('tr', null,
      cols.map((c, i) => (i === 0 ? h('th', { scope: 'row', class: 'no', title: sid }, no) : h('td', { class: isResultCol(c) ? 'res' : null }, r[i] ?? ''))),
      thumbs));
  }
  pre.replaceWith(h('div', { class: 'samples-wrap' }, table));
  await Promise.allSettled(jobs);
}

// ---------- quoting another experiment (same steps, not copied) ----------
async function renderQuote(pre, src, ctx) {
  const q = parseQuote(src);
  const lib = ctx.lib;
  const target = EXP_RE.test(q.ref) && lib ? lib.allPages().find((p) => p.xid === q.ref) : (() => { const r = parseRef(q.ref, ctx.vol); return r && lib?.page(r.vol, r.num); })();
  const box = h('aside', { class: 'quote-box' });
  pre.replaceWith(box);
  if (!target) { box.append(h('p', { class: 'quote-missing' }, `引用的实验 ${q.ref} 找不到（可能被删除或改了编号）。`)); return; }
  const head = h('div', { class: 'quote-head' },
    h('span', { class: 'quote-tag' }, '引用'),
    h('a', { href: `#/v/${target.vol}/${target.num}` }, target.xid || `p. ${target.num}`), ' ',
    h('span', { class: 'quote-title' }, target.title),
    q.section ? h('span', { class: 'quote-sec' }, `§ ${q.section}`) : null,
    h('span', { class: 'quote-date' }, target.date || ''));
  box.append(head);
  if (q.note) box.append(h('p', { class: 'quote-note' }, q.note));
  const content = h('div', { class: 'quote-body prose' });
  box.append(content);
  if ((ctx.quoteDepth || 0) >= 2) { content.append(h('p', { class: 'muted' }, '（嵌套引用，请打开原页面查看）')); return; }
  try {
    const { body } = parseFrontMatter(await lib.readPage(target.vol, target.num));
    const md = sectionOf(body, q.section);
    if (md == null) { content.append(h('p', { class: 'quote-missing' }, `原页面里没有“${q.section}”这一节。`)); return; }
    const sub = { ...(ctx.ctxFor ? ctx.ctxFor(target.vol, target.num) : ctx), quoteDepth: (ctx.quoteDepth || 0) + 1 };
    content.innerHTML = renderMarkdown(md, sub);
    await hydrate(content, sub);
  } catch (e) { content.append(h('p', { class: 'quote-missing' }, `读取失败：${e.message}`)); }
}

// ---------- a hypothesis this experiment tests: ```hypothesis  H-0001 \n 本次检验：… ----------
export function hypBadge(hyp) {
  return h('span', { class: 'hyp-badges' },
    h('span', { class: `hyp-status st-${hyp.status}` }, hyp.status),
    h('span', { class: `hyp-conf cf-${hyp.confidence}`, title: `可信度：${hyp.confidence}` }, h('i'), h('i'), h('i'), ` 可信度 ${hyp.confidence}`));
}
async function renderHypothesis(pre, src, ctx) {
  const [first = '', ...rest] = String(src).split('\n');
  const id = (first.match(/H-\d{4}/) || [])[0];
  const note = rest.join('\n').trim().replace(/^本次检验\s*[:：]\s*/, '');
  const box = h('aside', { class: 'hyp-box' });
  pre.replaceWith(box);
  const hyp = id && ctx.lib ? await loadHypothesis(ctx.lib, id).catch(() => null) : null;
  if (!hyp) { box.append(h('p', { class: 'quote-missing' }, `思维笔记本里没有假设 ${id || first}。`)); return; }
  const n = evidenceCounts(hyp);
  const ev = hyp.evidence || [];
  // One labelled row per part: label on the left, content on the right, so the basis reads at a glance.
  const row = (label, ...content) => h('div', { class: 'hyp-row' }, h('div', { class: 'hyp-lbl' }, label), h('div', { class: 'hyp-val' }, ...content));
  const desc = h('div', { class: 'hyp-desc-box prose-mini' });
  if (hyp.description) desc.innerHTML = renderMarkdown(String(hyp.description).replace(/^(\d+)[.、]\s*/gm, '$1. '), ctx);
  box.append(
    h('header', { class: 'hyp-head' },
      h('div', { class: 'hyp-kicker' }, h('span', { class: 'hyp-tag' }, '检验假设'), h('a', { class: 'hyp-id', href: `#/think/${hyp.id}` }, hyp.id), hypBadge(hyp)),
      h('div', { class: 'hyp-title' }, hyp.title)),
    h('div', { class: 'hyp-rows' },
      note ? row('本次检验', h('span', { class: 'hyp-note' }, note)) : null,
      hyp.description ? row('描述', desc) : null,
      (hyp.predictions || []).length ? row('预测', h('ol', { class: 'hyp-pred' }, hyp.predictions.map((p) => h('li', null, p)))) : null,
      row('证据链',
        h('div', { class: 'hyp-sum' }, ['支持', '反对', '待定'].map((k) => h('span', { class: `ev-k k-${k}` }, h('b', null, n[k]), ` ${k}`))),
        ev.length ? h('ol', { class: 'hyp-ev' }, ev.map((e) => h('li', { class: `k-${e.kind}` },
          h('span', { class: 'ev-no' }, `E${e.id.slice(1)}`), h('span', { class: `ev-kind k-${e.kind}` }, e.kind),
          h('span', { class: 'ev-t' }, e.text, e.src?.xid ? h('span', { class: 'ev-src' }, ` · ${e.src.xid}`) : e.src?.url ? h('span', { class: 'ev-src' }, ` · ${e.src.url}`) : null)))) : null)));
}

// ---------- key resources: every reagent / solution used, traced back to its bottle ----------
async function renderMaterials(pre, src, ctx, root) {
  const list = parseMaterials(src);
  const wrap = h('div', { class: 'materials-wrap' });
  pre.replaceWith(wrap);
  const [rs, ss] = ctx.lib?.tree ? await Promise.all([loadReagents(ctx.lib).catch(() => []), loadSolutions(ctx.lib).catch(() => [])]) : [[], []];
  const by = new Map([...rs, ...ss.map((x) => ({ ...x, solution: true }))].map((r) => [r.id, r]));
  // Amounts already written in the operation steps fill an empty 用量 cell.
  const stepAmt = (id) => [...root.querySelectorAll('ol.steps > li')].filter((li) => li.querySelector('.st-what')?.textContent.includes(id))
    .map((li) => li.querySelector('.st-amt')?.textContent.trim()).filter(Boolean).join(' + ');
  const two = (a, b) => [a ? h('span', null, a) : null, b ? h('span', { class: 'mat-sub' }, b) : null];
  wrap.append(h('table', { class: 'materials' },
    h('thead', null, h('tr', null, ['编号', '名称', 'CAS', '规格 / 浓度', '厂商', '批号 / 到货', '来源', '本次用量'].map((c) => h('th', null, c)))),
    h('tbody', null, list.map((m) => {
      const r = by.get(m.id);
      if (!r) return h('tr', { class: 'missing' }, h('td', { class: 'mono' }, m.id), h('td', { colspan: 5 }, '库里没有这个编号'), h('td', null, m.from), h('td', null, m.amount));
      const amt = m.amount || stepAmt(m.id);
      return h('tr', null,
        h('td', { class: 'mono' }, m.id),
        h('td', null, two(r.name, r.solution ? r.recipe : (r.name_en && r.name_en !== r.name ? r.name_en : ''))),
        h('td', { class: 'mono' }, r.solution ? '—' : (r.cas || '')),
        h('td', null, r.solution ? (r.conc || '') : [r.spec, r.purity].filter(Boolean).join(' · ')),
        h('td', null, r.solution ? two('自配', r.by) : (r.vendor || '')),
        h('td', { class: 'nw' }, r.solution ? (r.prepared ? h('span', null, `配于 ${r.prepared}`) : '') : two(r.lot ? `批号 ${r.lot}` : '', r.arrived ? `到货 ${r.arrived}` : '')),
        h('td', null, two(m.from, m.note)),
        h('td', { class: 'mat-amt' }, amt));
    }))));
}

// ---------- chemical equations ----------
function renderReactions(pre, src) {
  const lines = src.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  const box = h('div', { class: 'reactions' });
  for (const l of lines) {
    const r = reactionHTML(l);
    const eq = h('span', { class: 'rx-eq' }); eq.innerHTML = r.html; // built from escaped text only
    box.append(h('div', { class: 'rx' }, r.lead ? h('span', { class: 'rx-lead' }, r.lead) : null, eq, r.label ? h('span', { class: 'rx-label' }, r.label) : null));
  }
  pre.replaceWith(box);
}

// ---------- operation steps: action, amount, substance, container, conditions, details ----------
function renderSteps(pre, src) {
  const steps = parseSteps(src);
  const part = (cls, text) => (text ? h('span', { class: cls }, text) : null);
  const list = h('ol', { class: 'steps' }, steps.map((s) => h('li', null,
    h('div', { class: 'st-main' },
      part('st-op', s.op), part('st-amt', s.amount), part('st-what', s.what),
      s.into ? h('span', { class: 'st-to' }, '→') : null, part('st-into', s.into),
      part('st-cond', s.cond)),
    s.note ? h('div', { class: 'st-note' }, s.note) : null)));
  pre.replaceWith(h('div', { class: 'steps-wrap' },
    h('div', { class: 'st-legend', 'aria-hidden': 'true' }, part('st-op', '操作'), part('st-amt', '用量'), part('st-what', '物质'), part('st-into', '容器'), part('st-cond', '条件')),
    list));
}

// Amounts with units ("10 mL", "37 °C", "500 rpm") and reagent numbers stand out in running text.
// A unit may be compound: mg/mL, °C/min, mW/cm², mg·mL⁻¹, mg mL-1, S/cm.
const UNIT = '(?:µL|μL|uL|mL|L|µg|μg|ng|mg|kg|g|nmol|mmol|µmol|μmol|mol|pM|nM|µM|μM|mM|M|wt%|vol%|v/v|w/w|%|°C|℃|rpm|min|ms|µs|μs|s|h|kV|mV|µV|μV|V|pA|nA|µA|μA|mA|MHz|kHz|Hz|nm|µm|μm|mm|cm|µS|μS|mS|S|kW|mW|µW|μW|W|mJ|µJ|μJ|J|MPa|kPa|mPa·s|Pa|mbar|bar|cP|MΩ|kΩ|Ω|nF|µF|μF|mF|ppm|ppb|equiv|eq)(?:⁻?[¹²³]|\\^?-?[123](?![\\d.]))?';
const UNITS = `${UNIT}(?:\\s?[/·⋅]\\s?${UNIT}|\\s(?=[A-Za-zµμ°]+(?:⁻[¹²³]|\\^?-[123]))${UNIT})*`;
const QTY_RE = new RegExp(`(^|[^\\w.#-])((?:[~≈<>≤≥±]\\s?)?\\d+(?:\\.\\d+)?(?:\\s?[-–~]\\s?\\d+(?:\\.\\d+)?)?\\s?${UNITS})(?![A-Za-z0-9µμ/])|([RSM]-\\d{4})\\b`, 'g');
function markQuantities(root) {
  const skip = 'pre, code, a, .math, .katex, .samples, .steps-wrap, .reactions, h1, h2, h3, h4, .st-what, figcaption';
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.parentElement?.closest(skip) || !/\d/.test(n.nodeValue) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
  const nodes = []; while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const n of nodes) {
    const t = n.nodeValue; QTY_RE.lastIndex = 0;
    if (!QTY_RE.test(t)) continue;
    const frag = document.createDocumentFragment(); let last = 0; QTY_RE.lastIndex = 0;
    for (const m of t.matchAll(QTY_RE)) {
      const start = m.index + (m[1] || '').length; const text = m[2] || m[3];
      frag.append(t.slice(last, start), m[3]?.startsWith('M-') ? h('a', { class: 'rg-id m-id', href: `#/m/${m[3]}`, 'data-rid': m[3] }, text) : h('span', { class: m[3] ? 'rg-id' : 'qty', 'data-rid': m[3] || null }, text));
      last = start + text.length;
    }
    frag.append(t.slice(last));
    n.replaceWith(frag);
  }
}
async function nameReagents(root, ctx) {
  const ids = root.querySelectorAll('.rg-id, .st-what');
  if (!ids.length || !ctx.lib?.tree) return;
  const [list, sols] = await Promise.all([loadReagents(ctx.lib).catch(() => []), loadSolutions(ctx.lib).catch(() => [])]);
  const by = new Map([...list, ...sols.map((x) => ({ ...x, spec: x.conc, vendor: x.prepared && `配于 ${x.prepared}` }))].map((r) => [r.id, r]));
  for (const el of root.querySelectorAll('.rg-id')) { const r = by.get(el.dataset.rid); if (r) el.title = [r.name, r.spec, r.vendor, r.lot && `批号 ${r.lot}`].filter(Boolean).join(' · '); }
  for (const el of root.querySelectorAll('.m-id')) loadMethod(ctx.lib, el.dataset.rid).then((m) => { el.title = `方法卡片：${m.title}`; }).catch(() => { el.classList.add('missing'); });
  for (const el of root.querySelectorAll('.st-what')) {
    const m = el.textContent.match(/^(.*?)\s*([RS]-\d{4})\s*$/);
    if (!m) continue;
    const r = by.get(m[2]);
    el.replaceChildren(m[1] || r?.name || m[2], ' ', h('span', { class: 'rg-id', 'data-rid': m[2], title: r ? [r.name, r.spec, r.vendor, r.lot && `批号 ${r.lot}`].filter(Boolean).join(' · ') : '' }, m[2]));
  }
}

// ---------- embeds ----------
async function renderEmbed(el, ctx) {
  const name = el.dataset.embed;
  const caption = el.dataset.caption;
  const ext = name.split('.').pop().toLowerCase();
  try {
    const blob = await ctx.resolveBlob(name);
    if (ext === 'ipynb') {
      el.replaceWith(await renderNotebook(JSON.parse(await blob.text()), name, ctx));
    } else if (['csv', 'tsv', 'json'].includes(ext)) {
      const rows = await parseTable(await blob.text(), ext);
      el.replaceWith(h('figure', { class: 'printout table-fig' }, fileHead(name, `${rows.length} rows`), dataTable(rows), h('figcaption', null, caption ? ` ${caption}` : '')));
    } else if (/^image\//.test(blob.type)) {
      const url = URL.createObjectURL(blob); ctx.urls?.push(url);
      el.replaceWith(h('figure', { class: 'printout photo' }, h('img', { src: url, alt: caption || name }), h('figcaption', null, caption ? ` ${caption}` : '')));
    } else {
      el.replaceWith(h('p', null, h('a', { class: 'file-chip', href: '#', 'data-att-link': name }, name)));
    }
  } catch (e) {
    el.replaceWith(h('p', { class: 'missing-file' }, e.notFound ? `缺少附件：${name}` : `Couldn’t show ${name}: ${e.message}`));
  }
}

function fileHead(name, meta) {
  return h('div', { class: 'file-head' }, h('a', { href: '#', 'data-att-link': name, class: 'file-name' }, name), meta ? h('span', { class: 'file-meta' }, meta) : null);
}

const join = (s) => (Array.isArray(s) ? s.join('') : String(s ?? ''));
const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');

export async function renderNotebook(nb, name, ctx) {
  const lang = nb.metadata?.language_info?.name || nb.metadata?.kernelspec?.language || 'python';
  const kernel = nb.metadata?.kernelspec?.display_name || lang;
  const cells = nb.cells || nb.worksheets?.[0]?.cells || [];
  const body = h('div', { class: 'nb-body' });
  const plots = [];
  for (const cell of cells) {
    const src = join(cell.source);
    if (cell.cell_type === 'markdown') {
      let md = src;
      if (cell.attachments) {
        md = md.replace(/attachment:([^\s)]+)/g, (m, n) => {
          const a = cell.attachments[n]; if (!a) return m;
          const [mime, data] = Object.entries(a)[0];
          return `data:${mime};base64,${join(data).replace(/\s/g, '')}`;
        });
      }
      body.append(h('div', { class: 'nb-cell nb-md', html: renderMarkdown(md, ctx) }));
    } else if (cell.cell_type === 'code') {
      const c = h('div', { class: 'nb-cell nb-code' });
      c.append(h('div', { class: 'nb-in' },
        h('span', { class: 'nb-prompt' }, `In [${cell.execution_count ?? ' '}]`),
        h('pre', null, h('code', { class: `language-${lang}` }, src))));
      const outs = h('div', { class: 'nb-outs' });
      for (const o of cell.outputs || []) outs.append(renderOutput(o, ctx, plots));
      if (outs.childNodes.length) c.append(outs);
      body.append(c);
    } else if (src.trim()) {
      body.append(h('pre', { class: 'nb-cell nb-raw' }, src));
    }
  }
  const wrap = h('figure', { class: 'printout nb' });
  const toggleCode = h('button', { class: 'btn small', type: 'button', onclick: () => { wrap.classList.toggle('hide-code'); toggleCode.textContent = wrap.classList.contains('hide-code') ? 'Show code' : 'Hide code'; } }, 'Hide code');
  const expand = h('button', { class: 'btn small', type: 'button', onclick: () => { wrap.classList.toggle('open'); expand.textContent = wrap.classList.contains('open') ? 'Collapse' : 'Show whole notebook'; } }, 'Show whole notebook');
  wrap.append(
    h('div', { class: 'file-head' }, h('a', { href: '#', 'data-att-link': name, class: 'file-name' }, name), h('span', { class: 'file-meta' }, `${kernel}, ${cells.length} cells`), h('span', { class: 'nb-tools no-print' }, toggleCode)),
    body,
    h('div', { class: 'nb-foot no-print' }, expand),
  );
  await hydrate(body, ctx);
  if (plots.length) {
    await loadLib('plotly').catch(() => {});
    for (const [el, fig] of plots) {
      if (!window.Plotly) { el.textContent = 'Interactive chart (needs a connection to draw).'; continue; }
      await window.Plotly.newPlot(el, fig.data || [], theme(fig.layout || {}, 'closest', (fig.data || []).length), plotConfig()).catch(() => {});
    }
  }
  requestAnimationFrame(() => { if (body.scrollHeight <= 640) { wrap.classList.add('open', 'short'); } });
  return wrap;
}

function renderOutput(o, ctx, plots) {
  if (o.output_type === 'stream') return h('pre', { class: `nb-stream${o.name === 'stderr' ? ' err' : ''}` }, stripAnsi(join(o.text)));
  if (o.output_type === 'error') return h('pre', { class: 'nb-error' }, stripAnsi((o.traceback || [`${o.ename}: ${o.evalue}`]).join('\n')));
  const d = o.data || {};
  if (d['application/vnd.plotly.v1+json']) { const el = h('div', { class: 'chart-plot' }); plots.push([el, d['application/vnd.plotly.v1+json']]); return el; }
  for (const mime of ['image/png', 'image/jpeg', 'image/gif']) {
    if (d[mime]) return h('div', { class: 'nb-img' }, h('img', { src: `data:${mime};base64,${join(d[mime]).replace(/\s/g, '')}`, alt: 'Cell output' }));
  }
  if (d['image/svg+xml']) return h('div', { class: 'nb-img', html: window.DOMPurify.sanitize(join(d['image/svg+xml']), { USE_PROFILES: { svg: true, svgFilters: true } }) });
  if (d['text/html']) return h('div', { class: 'nb-html', html: window.DOMPurify.sanitize(join(d['text/html'])) });
  if (d['text/markdown']) return h('div', { class: 'nb-md', html: renderMarkdown(join(d['text/markdown']), ctx) });
  if (d['text/latex']) return h('div', { class: 'math math-display', 'data-tex': join(d['text/latex']).replace(/^\$+|\$+$/g, '') });
  if (d['text/plain']) return h('pre', { class: 'nb-text' }, stripAnsi(join(d['text/plain'])));
  return document.createTextNode('');
}

// Resize charts to the printed column width, and back afterwards.
export function fitChartsForPrint(root, width) {
  if (!window.Plotly) return;
  for (const el of root.querySelectorAll('.js-plotly-plot')) {
    try { window.Plotly.relayout(el, width ? { width, autosize: false } : { width: null, autosize: true }); } catch { /* ignore */ }
  }
}
