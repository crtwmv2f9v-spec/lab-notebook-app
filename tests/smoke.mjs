// Smoke test: drives the demo notebook in headless Chrome and checks every main view.
//   node tests/smoke.mjs                 run checks, save screenshots to tests/out/
//   node tests/smoke.mjs --baseline      also store them as tests/baseline/ for later comparison
// Needs the app served at BASE (default http://localhost:8765/) and Google Chrome installed.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE || 'http://localhost:8765/';
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9300 + Math.floor(Math.random() * 400);
const baseline = process.argv.includes('--baseline');
const OUT = join(HERE, baseline ? 'baseline' : 'out');
mkdirSync(OUT, { recursive: true });

const profile = join(tmpdir(), `labnote-smoke-${PORT}`);
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--window-size=1440,1000', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let ws; let seq = 0; const pending = new Map(); const errors = []; const results = [];
async function connect() {
  for (let i = 0; i < 80; i++) {
    try { const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); const page = list.find((t) => t.type === 'page'); if (page) { ws = new WebSocket(page.webSocketDebuggerUrl); break; } } catch { /* not up yet */ }
    await sleep(150);
  }
  if (!ws) throw new Error('Chrome did not start');
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const { resolve, reject } = pending.get(m.id); pending.delete(m.id); if (m.error) reject(new Error(m.error.message)); else resolve(m.result); return; }
    if (m.method === 'Runtime.exceptionThrown') errors.push(`exception: ${m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text}`);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(`console.error: ${m.params.args.map((a) => a.value ?? a.description).join(' ')}`);
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error' && !/favicon/.test(m.params.entry.url || '')) errors.push(`log: ${m.params.entry.text} ${m.params.entry.url || ''}`);
  });
}
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression: `(async () => { ${expression} })()`, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}
async function waitFor(cond, timeout = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) { try { if (await evaluate(`return !!(${cond});`)) return true; } catch { /* page busy */ } await sleep(120); }
  throw new Error(`timed out waiting for: ${cond}`);
}
async function shot(name, { width = 1440, height = 1000, print = false } = {}) {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  if (print) await send('Emulation.setEmulatedMedia', { media: 'print' });
  await evaluate("if (!document.getElementById('smoke-css')) document.head.append(Object.assign(document.createElement('style'), { id: 'smoke-css', textContent: '#toast, .toast { visibility: hidden !important; }' })); return 1;");
  await evaluate('await document.fonts.ready; for (const f of document.querySelectorAll("iframe")) await f.contentDocument?.fonts?.ready; return 1;');
  await sleep(700);
  const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  if (print) await send('Emulation.setEmulatedMedia', { media: '' });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  writeFileSync(join(OUT, `${name}.png`), Buffer.from(data, 'base64'));
}
async function check(name, fn) {
  const before = errors.length;
  try { const note = await fn(); const errs = errors.slice(before); results.push({ name, ok: !errs.length, note: errs.length ? errs.join(' | ') : (note || '') }); }
  catch (e) { results.push({ name, ok: false, note: `${e.message}${errors.length > before ? ` | ${errors.slice(before).join(' | ')}` : ''}` }); }
}
const go = async (hash, cond) => { await evaluate(`location.hash = ${JSON.stringify(hash)}; return 1;`); await waitFor(cond); await sleep(300); };
// Stray "null" / "undefined" / "NaN" in visible text is always a bug.
const clean = `const t = document.body.innerText; const bad = (t.match(/\\b(null|undefined|NaN)\\b/g) || []); if (bad.length) throw new Error('stray text: ' + bad.join(',')); return 1;`;

try {
  await connect();
  for (const d of ['Page', 'Runtime', 'Log']) await send(`${d}.enable`);
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: `${BASE}?demo#/` });

  await check('home', async () => { await waitFor("document.querySelector('.wb-col.is-today') && document.querySelectorAll('.rail-card').length >= 3 && document.querySelector('.pp-main .pp-card')"); await sleep(600); await evaluate(clean); await shot('home'); });
  await check('home-wide', async () => { await shot('home-wide', { width: 1920, height: 1100 }); });
  await check('phone-width', async () => {
    await send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 1, mobile: true });
    await sleep(600);
    const w = await evaluate('return document.documentElement.scrollWidth;');
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
    await sleep(400);
    if (w > 376) throw new Error(`home page is ${w}px wide on a 375px phone`);
  });
  await check('methods-entry', async () => {
    await evaluate("[...document.querySelectorAll('.topbar a')].find(a => a.getAttribute('href') === '#/methods').click(); return 1;");
    await waitFor("location.hash === '#/methods' && document.querySelectorAll('.m-card').length >= 2");
    await evaluate("history.back(); return 1;");
    await waitFor("document.querySelector('.wb-col.is-today')");
  });
  await check('countdown-basis', async () => {
    await waitFor("document.querySelector('.dl-hero .dl-card') && document.querySelector('.dl-hero .dl-sub')");
    const order = await evaluate("const y = (q) => document.querySelector(q).getBoundingClientRect().top; return { ok: y('.dl-hero') < y('.wb') && y('.wb') < y('.pp-main') && y('.pp-main') < y('.notes-card') && y('.notes-card') < y('.shelf') && y('.shelf') < y('.home-boards'), gone: !document.querySelector('.cont-card') && !document.querySelector('.tile.recent'), cols: document.querySelectorAll('.notes-card .nt-col').length };");
    if (!order.ok || !order.gone || order.cols !== 3) throw new Error(JSON.stringify(order));
    const t = await evaluate("return document.querySelector('.dl-hero .dl-sub').textContent;");
    if (!/北京时间|本机时间/.test(t)) throw new Error(`basis missing: ${t}`);
    return t;
  });
  await check('projects-board', async () => {
    await go('#/projects', "document.querySelectorAll('.pj-col').length === 6 && document.querySelector('.pj-card')");
    await evaluate(clean); await shot('projects');
    return `${await evaluate("return document.querySelectorAll('.pj-card').length;")} cards`;
  });
  await check('global-search', async () => {
    await go('#/', "document.querySelector('.wb-col.is-today')");
    await evaluate("document.querySelector('.topbar [aria-label=\"搜索\"]').click(); return 1;");
    await waitFor("document.querySelector('.modal input[type=search]')");
    await evaluate("const i = document.querySelector('.modal input[type=search]'); i.value = 'ROI'; i.dispatchEvent(new Event('input', { bubbles: true })); return 1;");
    await waitFor("[...document.querySelectorAll('.search-group h3')].some(x => x.textContent.startsWith('方法卡片'))");
    await evaluate("const i = document.querySelector('.modal input[type=search]'); i.value = 'PBS'; i.dispatchEvent(new Event('input', { bubbles: true })); return 1;");
    await waitFor("[...document.querySelectorAll('.search-group h3')].some(x => x.textContent.startsWith('试剂'))");
    const groups = await evaluate("return [...document.querySelectorAll('.search-group h3')].map(x => x.textContent).join(' / ');");
    await evaluate("document.querySelector('.modal-root')?.close?.(); return 1;");
    return groups;
  });
  await check('make-experiment', async () => {
    const target = await evaluate("const p = [...document.querySelectorAll('.shelf a.cover')].map(a => a.getAttribute('href')); return p;");
    const vols = await evaluate("return [...document.querySelectorAll('a.cover')].map(a => a.getAttribute('href')).filter(h => /^#\\/v\\//.test(h));");
    let found = null;
    for (const v of vols) {
      await go(v, "document.querySelector('.toc-table, .empty')");
      const hrefs = await evaluate("return [...document.querySelectorAll('.toc-table tbody tr')].map(tr => tr.querySelector('a')?.getAttribute('href')).filter(Boolean).filter(h => /\\/\\d+$/.test(h));");
      for (const href of hrefs) {
        await go(href, "document.querySelector('.sheet-head')");
        if (await evaluate("return !!document.querySelector('.no-xid button');")) { found = href; break; }
      }
      if (found) break;
    }
    if (!found) throw new Error('no plain page in the demo');
    await evaluate("document.querySelector('.no-xid button').click(); return 1;");
    await waitFor("[...document.querySelectorAll('.modal-foot button')].some(b => b.textContent === '分配编号')");
    await evaluate("[...document.querySelectorAll('.modal-foot button')].find(b => b.textContent === '分配编号').click(); return 1;");
    await waitFor("document.querySelector('.sheet-head .xid')", 10000);
    return `${found} → ${await evaluate("return document.querySelector('.sheet-head .xid').textContent;")}`;
  });
  await check('new-page-numbered', async () => {
    await go('#/v/oect/new', "document.querySelector('.ed-exp input')");
    if (!(await evaluate("return document.querySelector('.ed-exp input').checked;"))) throw new Error('not ticked by default');
    const t = await evaluate("return document.querySelector('.ed-exp code').textContent;");
    await evaluate("history.back(); return 1;");
    return t;
  });
  await check('volume', async () => { await go('#/v/oect', "document.querySelector('.toc-table')"); await evaluate(clean); await shot('volume'); });
  await check('page', async () => {
    await go('#/v/oect/1', "document.querySelector('table.samples') && document.querySelector('table.materials') && document.querySelector('ol.steps') && document.querySelector('.ink-red')");
    await evaluate(clean); await shot('page');
  });
  await check('page-hypothesis', async () => { await go('#/v/oect/2', "document.querySelector('aside.hyp-box .hyp-row')"); await evaluate(clean); });
  await check('print', async () => {
    await go('#/v/oect/1', "document.querySelector('table.materials')");
    await evaluate(`window.__printed = 0; window.print = () => { window.__printed = 1; }; [...document.querySelectorAll('.topbar button')].pop().click(); await new Promise(r => setTimeout(r, 300)); [...document.querySelectorAll('.menu button')].find(b => b.textContent.includes('打印 / 存为 PDF')).click(); return 1;`);
    await waitFor('window.__printed === 1', 15000);
    await send('Emulation.setEmulatedMedia', { media: 'print' });
    const over = await evaluate(`const root = document.querySelector('#print-root'); const w = root.getBoundingClientRect().width; return [...root.querySelectorAll('table')].filter(t => t.getBoundingClientRect().width > w + 1).length;`);
    await send('Emulation.setEmulatedMedia', { media: '' });
    if (over) throw new Error(`${over} table(s) wider than the page`);
    await shot('print-page1', { width: 794, height: 1123, print: true });
    await evaluate("document.body.classList.remove('print-volume'); return 1;");
  });
  await check('print-hypothesis', async () => {
    await go('#/v/oect/2', "document.querySelector('aside.hyp-box .hyp-why p + p')");
    await evaluate(`window.print = () => { window.__printed = 2; }; [...document.querySelectorAll('.topbar button')].pop().click(); await new Promise(r => setTimeout(r, 300)); [...document.querySelectorAll('.menu button')].find(b => b.textContent.includes('打印 / 存为 PDF')).click(); return 1;`);
    await waitFor('window.__printed === 2', 15000);
    await send('Emulation.setEmulatedMedia', { media: 'print' });
    const gap = await evaluate(`const ps = [...document.querySelectorAll('#print-root .hyp-why p')]; if (ps.length < 2) return -1; return Math.max(...ps.slice(1).map((p, i) => p.getBoundingClientRect().top - ps[i].getBoundingClientRect().bottom));`);
    await send('Emulation.setEmulatedMedia', { media: '' });
    if (gap < 0) throw new Error('no reasoning points in the printout');
    if (gap > 6) throw new Error(`reasoning points ${gap.toFixed(1)}px apart in print`);
    await evaluate("document.body.classList.remove('print-volume'); return 1;");
    return `gap ${gap.toFixed(1)}px`;
  });
  await check('bench-sheet', async () => {
    await go('#/v/oect/1', "document.querySelector('ol.steps')");
    const r = await evaluate(`window.print = () => { window.__printed = 3; }; const m = await import('./js/bench.js'); const c = await import('./js/core.js');
      const { fm, body } = (await import('./js/model.js')).parseFrontMatter(await c.lib.readPage('oect', 1)); const secs = m.splitSections(body);
      const bench = secs.filter((s) => s.kinds.includes('步骤') || s.kinds.includes('表格'));
      await m.exportParts('oect', 1, fm, { record: secs.slice(0, 2).map((s) => s.md).join('\\n\\n'), bench, order: 'rb', extra: ['备注'], labels: true, orient: 'auto' });
      return { secs: secs.length, bench: bench.length, frames: document.querySelectorAll('#print-root > .print-frame').length, boxes: document.querySelectorAll('#print-root .bench-sheet .bx').length, record: !!document.querySelector('#print-root .sheet.record') };`);
    await waitFor('window.__printed === 3', 15000);
    await evaluate("document.body.classList.remove('print-volume', 'print-bench'); document.getElementById('bench-page')?.remove(); return 1;");
    if (!r.bench || !r.boxes || r.frames !== 2 || !r.record) throw new Error(JSON.stringify(r));
    return `${r.secs} sections, ${r.bench} to checklist, ${r.boxes} tick boxes`;
  });
  await check('editor', async () => {
    await go('#/v/oect/2/edit', "document.querySelector('.pdf-frame')?.contentDocument?.querySelector('.rh-title')");
    const t = await evaluate("return document.querySelector('.pdf-frame').contentDocument.querySelector('.rh-title').textContent;");
    if (!t) throw new Error('empty preview');
    await shot('editor');
    await evaluate("history.back(); return 1;");
  });
  await check('reagents', async () => { await go('#/lib/reagents', "document.querySelectorAll('.lib-table tbody tr').length > 0"); await evaluate(clean); await shot('reagents'); });
  const zh_bad = (z) => z.akey !== 'ANN22222' || z.page !== '7' || z.ref?.doi !== '10.1038/x1' || z.zotero !== 'zotero://open-pdf/library/items/ATT11111?page=7&annotation=ANN22222' || !z.image;
  await check('clips', async () => {
    await go('#/clips', "document.querySelectorAll('.clip-tile').length >= 2");
    const r = await evaluate(`const m = await import('./js/clips.js'); const z = m.parseZotero('“Figure 2b. Device.” ([Liu et al., 2024, p. 5](zotero://select/library/items/AB12)) ([pdf](zotero://open-pdf/library/items/CD34?page=5))');
      const ann = { attachmentURI: 'http://zotero.org/users/local/x/items/ATT11111', annotationKey: 'ANN22222', position: { pageIndex: 6 }, citationItem: { uris: ['http://zotero.org/users/local/x/items/PAR33333'], itemData: { title: 'Vertical OECTs', author: [{ family: 'Huang' }], 'container-title': 'Nature', issued: { 'date-parts': [[2023]] }, DOI: '10.1038/x1' } } };
      const zh = m.parseZotero('[image]', '<p><img data-attachment-key="none" data-annotation="' + encodeURIComponent(JSON.stringify(ann)) + '"></p>');
      const zo = m.parseZotero('<html><body><div class="zotero-notes"><div class="zotero-note"><p><img data-attachment-key="none" width="609" height="709"><br><span class="citation">(<span class="citation-item">Wang 等, 2025, p. 19002</span>)</span></p></div></div></body></html>');
      return { tiles: document.querySelectorAll('.clip-tile').length, hint: m.unitHints('框线 0.5 pt'), z, zh, zo, cats: document.querySelectorAll('.clip-cat').length, gdUrl: m.parseDriveFolderId('https://drive.google.com/drive/folders/1N6YjBVlGW--cyomVcQjNJnizfYs4C0DF?usp=sharing'), gdRaw: m.parseDriveFolderId(m.DEFAULT_GDRIVE_FOLDER) };`);
    if (!r.zo.zcopy || !r.zo.image || r.zo.plabel !== '19002' || r.zo.page || r.zo.cite !== 'Wang 等 2025' || Math.abs(r.zo.ratio - 609 / 709) > 1e-6) throw new Error('obsidian format ' + JSON.stringify(r.zo));
    if (zh_bad(r.zh)) throw new Error('html ' + JSON.stringify(r.zh));
    if (r.gdUrl !== '1N6YjBVlGW--cyomVcQjNJnizfYs4C0DF' || r.gdRaw !== '1N6YjBVlGW--cyomVcQjNJnizfYs4C0DF') throw new Error('gdrive parse ' + JSON.stringify(r));
    if (r.z.page !== '5' || r.z.fig !== 'Fig. 2b' || !/open-pdf/.test(r.z.zotero) || r.z.cite !== 'Liu et al. 2024' || !r.hint.includes('0.18 mm')) throw new Error(JSON.stringify(r));
    await evaluate(clean); await shot('clips');
    return `${r.tiles} clips, ${r.cats} categories`;
  });
  await check('clips-pin-and-copy', async () => {
    await go('#/clips', "document.querySelectorAll('.clip-tile').length >= 2");
    const r = await evaluate(`
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const m = await import('./js/clips.js');
      const core = await import('./js/core.js');
      const s = await import('./js/searchui.js');
      // 1. sortClips edge cases: pinned first, mixed UTC offsets, missing created, non-mutating
      const raw = [
        { id: 'F-0001', created: '2026-11-01T00:00:00+08:00' },
        { id: 'F-0002', created: '2026-11-07T10:00:00-05:00' }, // 15:00Z (newer)
        { id: 'F-0005', created: '2026-11-07T18:00:00+08:00' }, // 10:00Z (older)
        { id: 'F-0003', pinned: true },
        { id: 'F-0004', pinned: true, created: '2026-11-05T00:00:00+08:00' },
      ];
      const sorted = m.sortClips(raw);
      const sortOk = raw[0].id === 'F-0001'
        && sorted.map((x) => x.id).join(',') === 'F-0004,F-0003,F-0002,F-0005,F-0001';

      // 2. Initial order: F-0002 (newer) before F-0001
      const initTitles = [...document.querySelectorAll('.clip-tile .clip-cap b')].map((el) => el.textContent);
      const initOrderOk = initTitles[0].includes('垂直 OECT') && initTitles[1].includes('Nature 作图');

      // 3. Open F-0001, test primary copy raw note + rejected-clipboard execCommand fallback (readonly, focus restored)
      let copied = '';
      const origClip = navigator.clipboard;
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (txt) => { copied = txt; } } });
      [...document.querySelectorAll('.clip-tile')].find((el) => el.textContent.includes('Nature 作图')).click();
      await wait(120);
      const copyBtn = [...document.querySelectorAll('.modal-foot button')].find((b) => b.textContent === '复制全文');
      copyBtn?.click();
      await wait(80);
      const copyRawOk = copied.includes('框线 0.5 pt') && !copied.includes('≈0.18 mm') && !!document.querySelector('.modal-root');

      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new DOMException('denied'); } } });
      const origExec = document.execCommand.bind(document);
      let fbReadonly = false; let fbText = '';
      document.execCommand = (cmd) => {
        if (cmd === 'copy') {
          const ta = document.activeElement;
          fbReadonly = ta?.tagName === 'TEXTAREA' && ta.readOnly === true;
          fbText = ta?.value || '';
          return true;
        }
        return origExec(cmd);
      };
      copyBtn?.focus();
      copyBtn?.click();
      await wait(80);
      const copyFallbackOk = fbReadonly && fbText.includes('框线 0.5 pt') && !fbText.includes('≈0.18 mm')
        && document.activeElement === copyBtn && !document.querySelector('textarea[aria-hidden="true"]');
      document.execCommand = origExec;
      if (origClip !== undefined) Object.defineProperty(navigator, 'clipboard', { configurable: true, value: origClip });

      // 4. Pin F-0001 from detail modal -> becomes first card with .is-pinned, top border, dark-theme contrast & topbar count
      const pinBtn = [...document.querySelectorAll('.modal-foot button')].find((b) => b.textContent === '置顶');
      pinBtn?.click();
      await wait(250);
      const firstAfterPin = document.querySelector('.clip-tile');
      const prevTheme = document.documentElement.dataset.theme;
      document.documentElement.dataset.theme = 'dark';
      const darkPinColor = getComputedStyle(firstAfterPin.querySelector('.clip-pin-tag')).color;
      if (prevTheme) document.documentElement.dataset.theme = prevTheme; else delete document.documentElement.dataset.theme;
      const topBorderW = parseFloat(getComputedStyle(firstAfterPin).borderTopWidth || '0');
      const pinnedUiOk = !!firstAfterPin?.classList.contains('is-pinned')
        && !!firstAfterPin?.querySelector('.clip-pin-tag')
        && topBorderW >= 2.5
        && darkPinColor === 'rgb(255, 209, 102)'
        && firstAfterPin.textContent.includes('Nature 作图')
        && (document.querySelector('.tb-sub')?.textContent || '').includes('置顶 1');

      // 5. Re-open -> edit -> verify #cl-pin checked -> unpin & save -> order restored
      firstAfterPin.click();
      await wait(120);
      const hasUnpinBtn = [...document.querySelectorAll('.modal-foot button')].some((b) => b.textContent === '取消置顶');
      [...document.querySelectorAll('.modal-foot button')].find((b) => b.textContent === '修改')?.click();
      await wait(150);
      const pinChk = document.getElementById('cl-pin');
      const chkWasOn = !!pinChk?.checked;
      pinChk.checked = false;
      [...document.querySelectorAll('.modal-foot button')].find((b) => b.textContent === '保存')?.click();
      await wait(250);
      const unpinnedUiOk = !document.querySelector('.clip-tile.is-pinned')
        && document.querySelector('.clip-tile')?.textContent.includes('垂直 OECT');

      // 6. Create long pinned note (>220 chars, with emoji at boundary) -> safe truncation + global search pinned-first + cross-view click-to-open
      await m.editClip(null, { kind: 'note' });
      await wait(120);
      document.getElementById('cl-title').value = 'SVG 置顶提示词测试';
      document.getElementById('cl-pin').checked = true;
      document.getElementById('cl-note').value = '矢量令牌测试词：' + 'a'.repeat(211) + '🎨' + '后缀补充内容';
      [...document.querySelectorAll('.modal-foot button')].find((b) => b.textContent === '保存')?.click();
      await wait(250);
      const longTile = document.querySelector('.clip-tile.is-pinned');
      const longText = longTile?.querySelector('.clip-note-text')?.textContent || '';
      const longTruncOk = !!longTile && longText.endsWith('🎨…') && !/[\uD800-\uDFFF]/.test(longText.replace(/🎨/g, ''));

      // Search from another view (#/plan): pinned clip sorts FIRST and clicking opens detail modal cleanly
      location.hash = '#/plan';
      await wait(250);
      s.openSearch('F-000');
      await wait(220);
      const clipGroup = [...document.querySelectorAll('.search-group')].find((g) => g.querySelector('h3')?.textContent.startsWith('素材库'));
      const tagsOrder = clipGroup ? [...clipGroup.querySelectorAll('.xid-tag')].map((el) => el.textContent) : [];
      const searchOrderOk = tagsOrder.length >= 3 && tagsOrder[0].startsWith('置顶 · ');
      clipGroup?.querySelector('a')?.click();
      await wait(350);
      const crossViewOpenOk = location.hash === '#/clips'
        && document.querySelector('.modal-head h2')?.textContent === 'SVG 置顶提示词测试';
      document.querySelector('.modal-root')?.close?.();
      await wait(100);

      // Cleanup temporary clip
      const added = (await m.loadClips()).find((x) => x.title === 'SVG 置顶提示词测试');
      if (added) await core.lib.commit('Cleanup test clip', async () => ({ changes: [{ path: m.clipPath(added.id), delete: true }] }));
      await wait(120);
      return { sortOk, initOrderOk, copyRawOk, copyFallbackOk, pinnedUiOk, hasUnpinBtn, chkWasOn, unpinnedUiOk, longTruncOk, searchOrderOk, crossViewOpenOk };
    `);
    const bad = Object.entries(r).filter(([, v]) => !v).map(([k]) => k);
    if (bad.length) throw new Error(`failed checks: ${bad.join(', ')} (${JSON.stringify(r)})`);
    return 'sort (tz), pin/unpin, dark contrast, raw+fallback copy, surrogate truncation, search order & cross-view open';
  });
  await check('clips-gdrive-style-inbox', async () => {
    await go('#/clips', "document.querySelectorAll('.clip-tile').length >= 2");
    const r = await evaluate(`
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const m = await import('./js/clips.js');
      const core = await import('./js/core.js');
      const prevCfg = localStorage.getItem('labnote-gdrive');
      const prevTok = sessionStorage.getItem('labnote-gdrive-tok');
      const origFetch = window.fetch;
      let tmpId = '';
      try {
        m.clearGdriveConfig();
        const defSc = m.styleSyncConfig();
        const defOk = defSc.styleFolderId === '1xjQ31u4WK3cFTfE-MQrCRLVmgNAEn6Fx'
          && defSc.styleCats.length === 1 && defSc.styleCats[0] === '00_Style_Inbox'
          && m.gdriveConfig() === null;

        const parsed = m.parseStyleCats('00_Style_Inbox, flat style image library，00_style_inbox; ');
        const parseOk = parsed.length === 2 && parsed[0] === '00_Style_Inbox' && parsed[1] === 'flat style image library';

        // Legacy v73 config without styleCats upgrades seamlessly to default 00_Style_Inbox
        localStorage.setItem('labnote-gdrive', JSON.stringify({ clientId: 'legacy.apps.googleusercontent.com', folderId: m.DEFAULT_GDRIVE_FOLDER }));
        const leg = m.gdriveConfig();
        const legacyOk = leg?.clientId === 'legacy.apps.googleusercontent.com'
          && leg?.styleFolderId === '1xjQ31u4WK3cFTfE-MQrCRLVmgNAEn6Fx'
          && leg?.styleCats?.[0] === '00_Style_Inbox';

        // Explicit opt-out via empty styleCats
        m.saveGdriveConfig({ clientId: 'test.apps.googleusercontent.com', styleCats: '' });
        const optOutOk = m.gdriveConfig()?.styleCats?.length === 0 && !m.matchesStyleSyncCat(['00_Style_Inbox']);

        // Modal renders all 4 inputs and saves cleanly via 仅保存配置
        m.connectGoogleDrive();
        await wait(80);
        const modalHasAll = !!document.getElementById('gd-cid') && !!document.getElementById('gd-fid')
          && !!document.getElementById('gd-style-cat') && !!document.getElementById('gd-style-fid')
          && [...document.querySelectorAll('.modal button')].some((b) => b.textContent === '复制网址');
        document.getElementById('gd-cid').value = 'cid-123.apps.googleusercontent.com';
        document.getElementById('gd-style-cat').value = '00_Style_Inbox, flat style image library';
        document.getElementById('gd-style-fid').value = 'https://drive.google.com/drive/folders/1xjQ31u4WK3cFTfE-MQrCRLVmgNAEn6Fx?usp=sharing';
        [...document.querySelectorAll('.modal-foot button')].find((b) => b.textContent === '仅保存配置')?.click();
        await wait(80);
        const savedCfg = m.gdriveConfig();
        const modalSaveOk = savedCfg?.clientId === 'cid-123.apps.googleusercontent.com'
          && savedCfg?.styleFolderId === '1xjQ31u4WK3cFTfE-MQrCRLVmgNAEn6Fx'
          && m.matchesStyleSyncCat(['Flat Style Image Library'])
          && !m.matchesStyleSyncCat(['其他分类']);

        // Mocked Drive v3 server-side copy + batch syncStyleInboxClips idempotency & guard
        sessionStorage.setItem('labnote-gdrive-tok', JSON.stringify({ token: 'tok-test', exp: Date.now() + 3600e3 }));
        const calls = [];
        window.fetch = async (url, opts) => {
          if (String(url).startsWith('https://www.googleapis.com/drive/v3/files/')) {
            calls.push({ url: String(url), method: opts?.method, body: opts?.body ? JSON.parse(opts.body) : null, auth: opts?.headers?.get?.('Authorization') });
            return new Response(JSON.stringify({ id: 'copy_style_999', name: 'F-9999_style.png' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
          }
          return origFetch(url, opts);
        };
        tmpId = 'F-9999';
        await core.lib.commit('Add temp style clip', async () => ({
          changes: [{ path: m.clipPath(tmpId), data: JSON.stringify({ id: tmpId, kind: 'img', title: 'Flat ref', cats: ['Flat Style Image Library'], file: 'F-9999_style.png', driveId: 'src_drive_111', src: {}, created: '2026-11-20T00:00:00Z' }) + '\\n' }],
        }));
        const res1 = await m.syncStyleInboxClips();
        const res2 = await m.syncStyleInboxClips();
        const afterSync = (await m.loadClips()).find((x) => x.id === tmpId);
        const syncOk = res1.synced === 1 && res1.failed === 0 && res2.synced === 0
          && calls.length === 1
          && calls[0].url.includes('/files/src_drive_111/copy')
          && calls[0].method === 'POST'
          && calls[0].auth === 'Bearer tok-test'
          && calls[0].body?.parents?.[0] === '1xjQ31u4WK3cFTfE-MQrCRLVmgNAEn6Fx'
          && calls[0].body?.name === 'F-9999_style.png'
          && afterSync?.styleDriveId === 'copy_style_999' && !!afterSync?.styleSyncedAt;

        // Same-folder guard prevents self-copy
        m.saveGdriveConfig({ clientId: 'cid-123.apps.googleusercontent.com', folderId: m.DEFAULT_STYLE_INBOX_FOLDER, styleFolderId: m.DEFAULT_STYLE_INBOX_FOLDER, styleCats: '00_Style_Inbox' });
        const resSame = await m.syncStyleInboxClips([{ id: 'F-9998', kind: 'img', cats: ['00_Style_Inbox'], driveId: 'src_222', file: 'a.png' }]);
        const sameGuardOk = resSame.synced === 0 && calls.length === 1;

        return { defOk, parseOk, legacyOk, optOutOk, modalHasAll, modalSaveOk, syncOk, sameGuardOk };
      } finally {
        window.fetch = origFetch;
        document.querySelectorAll('.modal-root').forEach((el) => el.close?.());
        if (tmpId) await core.lib.commit('Cleanup temp style clip', async () => ({ changes: [{ path: m.clipPath(tmpId), delete: true }] })).catch(() => {});
        if (prevCfg == null) localStorage.removeItem('labnote-gdrive'); else localStorage.setItem('labnote-gdrive', prevCfg);
        if (prevTok == null) sessionStorage.removeItem('labnote-gdrive-tok'); else sessionStorage.setItem('labnote-gdrive-tok', prevTok);
      }
    `);
    const bad = Object.entries(r).filter(([, v]) => !v).map(([k]) => k);
    if (bad.length) throw new Error(`failed checks: ${bad.join(', ')} (${JSON.stringify(r)})`);
    return 'gdrive config/legacy/opt-out, 4-field modal, copy-to-00_Style_Inbox & idempotency';
  });
  await check('weekboard', async () => {
    await go('#/', "document.querySelectorAll('.wb .wb-col').length === 8 && document.querySelector('.wb-col.is-today .wb-card')");
    const r = await evaluate(`const p = await import('./js/planner.js');
      const today = document.querySelector('.wb-col.is-today'); const cols = [...document.querySelectorAll('.wb .wb-col[data-day]')];
      const target = cols.find((c) => c !== today);
      const ptasks = (await p.loadPlanner()).tasks; const li = [...today.querySelectorAll('.wb-card')].find((e) => { const x = ptasks.find((y) => y.text === e.querySelector('.task-text').textContent); return x && (!x.cat || ['杂事', '生活'].includes(x.cat)); }); const text = li.querySelector('.task-text').textContent;
      const id = (await p.loadPlanner()).tasks.find((x) => x.text === text).id;
      const dt = new DataTransfer(); li.dispatchEvent(new DragEvent('dragstart', { dataTransfer: dt, bubbles: true }));
      target.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
      target.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
      await new Promise((r) => setTimeout(r, 600));
      const movedDate = (await p.loadPlanner()).tasks.find((x) => x.id === id).date;
      const shown = [...document.querySelectorAll('.wb .wb-col[data-day="' + target.dataset.day + '"] .task-text')].some((e) => e.textContent === text);
      // back to 待安排
      const plan = document.querySelector('.wb-plan'); const li2 = [...document.querySelectorAll('.wb .wb-card')].find((e) => e.querySelector('.task-text').textContent === text);
      const dt2 = new DataTransfer(); li2.dispatchEvent(new DragEvent('dragstart', { dataTransfer: dt2, bubbles: true }));
      plan.dispatchEvent(new DragEvent('drop', { dataTransfer: dt2, bubbles: true, cancelable: true }));
      await new Promise((r) => setTimeout(r, 600));
      const back = (await p.loadPlanner()).tasks.find((x) => x.id === id);
      return { to: target.dataset.day, date: movedDate, shown, backDate: back.date || null, inPlan: [...document.querySelectorAll('.wb-plan .task-text')].some((e) => e.textContent === text) };`);
    if (r.date !== r.to || !r.shown || r.backDate || !r.inPlan) throw new Error(JSON.stringify(r));
    await evaluate(clean);
    return `moved to ${r.to}, then back to 待安排`;
  });
  await check('reading-why', async () => {
    await go('#/', "document.querySelector('.reading-add .why-input') && document.querySelector('.paper-why')");
    const r = await evaluate(`const p = await import('./js/planner.js'); const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const shown = document.querySelector('.paper-why:not(.empty)')?.textContent;
      const a = document.querySelector('.reading-add .add-input:not(.why-input)'); const w = document.querySelector('.reading-add .why-input');
      a.value = '测试文献 A'; a.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      const movedFocus = document.activeElement === w;
      w.value = '看他们的退火温度'; w.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await wait(600);
      const x = (await p.loadPlanner()).tasks.find((y) => y.text === '测试文献 A');
      const row = () => [...document.querySelectorAll('.rail-tasks .task')].find((e) => /测试文献 A/.test(e.textContent));
      const inRow = row()?.querySelector('.paper-why')?.textContent;
      row().querySelector('.paper-why').click(); await wait(50);
      const inp = row().querySelector('.paper-why-input'); inp.value = ''; inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await wait(600);
      const cleared = (await p.loadPlanner()).tasks.find((y) => y.id === x.id).why; const empty = row()?.querySelector('.paper-why.empty')?.textContent;
      await p.removeTask(x.id); await wait(300);
      return { shown, movedFocus, why: x.why, inRow, cleared: cleared ?? null, empty };`);
    if (!/^为什么读找 OECT/.test(r.shown || '') || r.inRow !== '为什么读看他们的退火温度' || r.cleared !== null || r.empty !== '＋ 为什么读这篇') throw new Error(JSON.stringify(r));
    return 'reason asked on add, shown under the entry, edited, cleared';
  });
  await check('must-do', async () => {
    await go('#/', "document.querySelectorAll('.wb-must .wb-mustcard').length >= 3 && document.querySelector('.nt-promote')");
    const r = await evaluate(`const p = await import('./js/planner.js'); const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const texts = () => [...document.querySelectorAll('.wb-must .wb-mustcard')].map((e) => e.querySelector('.wb-rank').textContent + ' ' + e.querySelector('.task-text').textContent);
      const before = texts(); const age = document.querySelector('.wb-must .wb-age').textContent; const topic = document.querySelector('.wb-must .wb-must-topic')?.textContent;
      const below = document.querySelector('.wb-nag').nextElementSibling === document.querySelector('.wb-must');
      const btn = [...document.querySelectorAll('.nt-todos .task')].find((e) => /不加 GOPS/.test(e.textContent)).querySelector('.nt-promote'); btn.click(); await wait(700);
      const promoted = texts(); const memoLeft = [...document.querySelectorAll('.nt-todos .task')].some((e) => /不加 GOPS/.test(e.textContent));
      const find = (re) => [...document.querySelectorAll('.wb-must .wb-mustcard')].find((e) => re.test(e.textContent));
      const dt = new DataTransfer(); const li = find(/不加 GOPS/); li.dispatchEvent(new DragEvent('dragstart', { dataTransfer: dt, bubbles: true }));
      find(/补做 GOPS/).dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); li.dispatchEvent(new DragEvent('dragend', { bubbles: true })); await wait(700);
      const reordered = texts();
      const input = document.querySelector('.wb-must .add-input'); input.value = '测试必做实验'; input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await wait(600);
      const added = texts();
      const x = (await p.loadPlanner()).tasks.find((y) => y.text === '测试必做实验');
      find(/测试必做实验/).querySelector('.tick').click(); await wait(600);
      const ticked = find(/测试必做实验/)?.querySelector('.wb-rank').textContent;
      await p.removeTask(x.id); await wait(300);
      find(/不加 GOPS/).querySelector('.wb-must-more').click(); await wait(100);
      [...document.querySelectorAll('.menu .menu-item')].find((b) => /退回/.test(b.textContent)).click(); await wait(700);
      const back = [...document.querySelectorAll('.nt-todos .task')].some((e) => /不加 GOPS/.test(e.textContent)) && !find(/不加 GOPS/);
      const legend = [...document.querySelectorAll('.wb-legend span')].map((e) => e.textContent).join(',');
      return { before, age, topic, below, promoted, memoLeft, reordered, added, cat: x.cat, ticked, back, legend, nullText: document.querySelector('.wb-must').innerText.includes('null') };`);
    const ok = r.before.join('|') === '01 补做 GOPS 1 wt% 的 7 天稳定性对照|02 p(g2T-TT) 双光子打印阈值功率扫描|03 人工唾液中 MMP-8 浓度梯度测试' && r.age === '挂了 16 天' && r.topic && r.below
      && r.promoted[3] === '04 补一组不加 GOPS 的对照' && !r.memoLeft && r.reordered[0] === '01 补一组不加 GOPS 的对照' && r.reordered[1] === '02 补做 GOPS 1 wt% 的 7 天稳定性对照'
      && r.added[4] === '05 测试必做实验' && r.cat === '必做' && r.ticked === '✓' && r.back && /必做/.test(r.legend) && !r.nullText;
    if (!ok) throw new Error(JSON.stringify(r));
    await shot('must-do', { width: 1440, height: 1000 });
    return `3 ranked, oldest ${r.age}; promoted from 待做实验 → 04, dragged to 01; added 05, ticked; sent back to 待做实验`;
  });
  await check('nag-strip', async () => {
    await go('#/', "document.querySelector('.wb-nag .add-input') && document.querySelector('.wb-col.is-today')");
    const r = await evaluate(`const p = await import('./js/planner.js'); const m = await import('./js/model.js');
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const before = document.querySelectorAll('.wb-nagcard').length;
      const ages = [...document.querySelectorAll('.wb-nagcard .wb-age')].map((e) => e.textContent);
      const hot = !!document.querySelector('.wb-nagcard.hot');
      const input = document.querySelector('.wb-nag .add-input'); input.value = '测试催办事项';
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await wait(500);
      const x = (await p.loadPlanner()).tasks.find((y) => y.text === '测试催办事项');
      const find = () => [...document.querySelectorAll('.wb .wb-card')].find((e) => e.querySelector('.task-text').textContent === '测试催办事项');
      const added = { cat: x.cat, date: x.date || null, age: find()?.querySelector('.wb-age')?.textContent, inStrip: !!find()?.closest('.wb-nag') };
      const drag = async (li, to) => { const dt = new DataTransfer(); li.dispatchEvent(new DragEvent('dragstart', { dataTransfer: dt, bubbles: true })); to.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); li.dispatchEvent(new DragEvent('dragend', { bubbles: true })); await wait(500); };
      await drag(find(), document.querySelector('.wb-col.is-today'));
      const y1 = (await p.loadPlanner()).tasks.find((y) => y.id === x.id); const sched = { date: y1.date === m.todayISO(), inDay: !!find()?.closest('.wb-col.is-today') };
      await drag(find(), document.querySelector('.wb-nag'));
      const y2 = (await p.loadPlanner()).tasks.find((y) => y.id === x.id); const back = { date: y2.date || null, cat: y2.cat, inStrip: !!find()?.closest('.wb-nag') };
      find().querySelector('.tick').click(); await wait(500);
      const ticked = { done: find()?.classList.contains('done'), age: find()?.querySelector('.wb-age')?.textContent };
      await p.removeTask(x.id); await wait(300);
      return { before, ages, hot, added, sched, back, ticked, nullText: document.querySelector('.wb-nag').innerText.includes('null') };`);
    if (r.before < 3 || !r.hot || r.ages[0] !== '挂了 9 天' || r.added.cat !== '催办' || r.added.date || r.added.age !== '今天记下' || !r.added.inStrip || !r.sched.date || !r.sched.inDay || r.back.date || r.back.cat !== '催办' || !r.back.inStrip || !r.ticked.done || r.ticked.age !== '已办完' || r.nullText) throw new Error(JSON.stringify(r));
    return `${r.before} waiting, oldest ${r.ages[0]}; added, scheduled to today, dragged back, ticked`;
  });
  await check('refile-topics-outcome', async () => {
    await go('#/', "document.querySelector('.wb-plan .wb-topic') && document.querySelector('.wb-col.is-today .wb-refile')");
    const r = await evaluate(`const p = await import('./js/planner.js'); const f = await import('./js/finds.js'); const lab = await import('./js/lab.js'); const hm = await import('./js/home.js');
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const doc = await p.loadPlanner(); const topics = f.topicsOf(doc);
      const groups = [...document.querySelectorAll('.wb-plan .wb-topic .wb-glabel')].map((e) => e.firstChild.textContent);
      const colours = new Set(topics.map((t) => t.color)).size === topics.length;
      // change a dated item's kind through its menu
      const li = [...document.querySelectorAll('.wb-col.is-today .wb-card')].find((e) => e.textContent.includes('Keithley'));
      li.querySelector('.wb-refile').click(); await wait(100);
      [...document.querySelectorAll('.menu .menu-item')].find((b) => b.textContent.includes('杂事')).click(); await wait(500);
      const x = (await p.loadPlanner()).tasks.find((y) => y.text.includes('Keithley')); const kind = x.cat;
      await p.changeTasks((l) => { l.find((y) => y.id === x.id).cat = '仪器'; }, 'test'); await wait(300);
      // a weekly goal moved to another topic
      const g = [...document.querySelectorAll('.wb-plan .wb-card')].find((e) => e.textContent.includes('整理试剂库'));
      g.querySelector('.wb-refile').click(); await wait(100);
      [...document.querySelectorAll('.menu .menu-item')].find((b) => b.textContent.includes(topics[0].name)).click(); await wait(500);
      const gt = (await p.loadPlanner()).tasks.find((y) => y.text === '整理试剂库'); const goalTopic = gt.topic === topics[0].id;
      await p.changePlanner((d) => { delete d.tasks.find((y) => y.id === gt.id).topic; delete d.topics; }, 'test'); await wait(300);
      const ics = lab.icsFor([{ date: '2026-11-10', time: '14:00', end: '17:00', summary: 'a', uid: 'u1' }, { date: '2026-11-11', allDay: true, summary: 'b', uid: 'u2' }]);
      const wx = hm.wechat('一篇关于 OECT 的推送 https://mp.weixin.qq.com/s/AbCd123');
      const put = lab.putSection('## 目的\\n\\nx\\n\\n## 下一步\\n\\n- y\\n', '结论', 'z', ['下一步']);
      return { groups, colours, kind, goalTopic, ics: ics.includes('DTSTART:20261110T140000\\r') && ics.includes('DTEND:20261110T170000\\r') && ics.includes('DTSTART;VALUE=DATE:20261111') && ics.includes('TRIGGER:-PT10M'), wx, put: put.indexOf('## 结论') < put.indexOf('## 下一步') && put.includes('z') };`);
    if (r.groups.length < 2 || !r.colours || r.kind !== '杂事' || !r.goalTopic || !r.ics || r.wx.wx !== 'https://mp.weixin.qq.com/s/AbCd123' || r.wx.text !== '一篇关于 OECT 的推送' || !r.put) throw new Error(JSON.stringify(r));
    await go('#/v/oect', "document.querySelector('.toc-table .series-row .oc-tag.fail') && document.querySelector('.toc-table .series-row .oc-tag.ok')");
    await go('#/v/oect/3', "document.querySelector('.oc-banner.fail') && document.querySelector('.wrap-bar.fail')");
    await go('#/v/oect/2', "document.querySelector('.wrap-bar .btn')");
    const w = await evaluate(`const wait = (ms) => new Promise((r) => setTimeout(r, ms)); const pg = await import('./js/pages.js'); const core = await import('./js/core.js'); const m = await import('./js/model.js');
      document.querySelector('.wrap-bar .btn').click(); await wait(400);
      document.querySelector('#wu-res').value = '测试结果'; document.querySelector('#wu-disc').value = '测试讨论'; document.querySelector('.oc-seg .oc-fail').click(); document.querySelector('#wu-note').value = '测试原因';
      [...document.querySelectorAll('.modal-root .btn')].find((b) => b.textContent.trim() === '保存').click(); await wait(1500);
      const { fm, body } = m.parseFrontMatter(await core.lib.readPage('oect', 2));
      const banner = document.querySelector('.oc-banner.fail')?.textContent || '';
      return { outcome: fm.outcome, note: fm.outcome_note, res: body.includes('## 结果\\n\\n测试结果'), disc: /## (现象与)?讨论\\n\\n测试讨论/.test(body), order: body.indexOf('测试结果') < body.indexOf('测试讨论') && body.indexOf('测试讨论') < body.indexOf('## 结论'), banner, entry: core.lib.page('oect', 2).outcome };`);
    if (w.outcome !== 'fail' || w.note !== '测试原因' || !w.res || !w.disc || !w.order || !w.banner.includes('测试原因') || w.entry !== 'fail') throw new Error(JSON.stringify(w));
    return `goal groups ${r.groups.join(' / ')}; kind and topic changed by menu; page 2 wrapped up as 行不通`;
  });
  await check('time-zone-and-times', async () => {
    await go('#/', "document.querySelector('.wb-col.is-today .wb-add-btn')");
    const r = await evaluate(`const m = await import('./js/model.js'); const w = await import('./js/weekboard.js'); const p = await import('./js/planner.js');
      const bj = new Date(Date.now() + 8 * 3600e3).toISOString();
      const zone = { today: m.todayISO() === bj.slice(0, 10), now: m.nowISO().endsWith('+08:00') && m.nowISO().slice(0, 16) === bj.slice(0, 16), z: m.zoned('2026-11-09T20:30:00-05:00') };
      const pt = [w.parseTime('9'), w.parseTime('930'), w.parseTime('14:00-17:30'), w.parseTime('25'), w.parseTime('17-14'), w.parseTime('')].map((x) => (x ? x.time + (x.end ? '-' + x.end : '') : 'bad')).join('|');
      const col = document.querySelector('.wb-col.is-today'); col.querySelector('.wb-add-btn').click();
      const input = col.querySelector('.wb-add .add-input'); const tm = col.querySelector('.wb-time-add');
      input.value = '测试定时事项'; tm.value = '7-8';
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await new Promise((r) => setTimeout(r, 500));
      const x = (await p.loadPlanner()).tasks.find((y) => y.text === '测试定时事项');
      const first = document.querySelector('.wb-col.is-today .wb-card .task-text')?.textContent;
      const chip = [...document.querySelectorAll('.wb-col.is-today .wb-card')].find((e) => e.textContent.includes('测试定时事项'))?.querySelector('.wb-time')?.textContent;
      const nullText = document.querySelector('.wb').innerText.includes('null');
      await p.removeTask(x.id);
      return { zone, pt, time: x.time, end: x.end, date: x.date === m.todayISO(), chip, nullText };`);
    if (!r.zone.today || !r.zone.now || r.zone.z.day !== '2026-11-10' || r.zone.z.time !== '09:30' || r.pt !== '09:00|09:30|14:00-17:30|bad|bad|' || r.time !== '07:00' || r.end !== '08:00' || !r.date || r.chip !== '07:00–08:00' || r.nullText) throw new Error(JSON.stringify(r));
    return `UTC+8 day and clock; item added at ${r.chip}`;
  });
  await check('notes-topics', async () => {
    await go('#/', "document.querySelectorAll('.notes-card .nt-tab').length >= 4");
    const r = await evaluate(`const p = await import('./js/planner.js');
      const tabs = [...document.querySelectorAll('.notes-card .nt-tab')].map((b) => b.querySelector('span')?.textContent || b.textContent);
      [...document.querySelectorAll('.notes-card .nt-tab')].find((b) => b.textContent.includes('OECT')).click();
      await new Promise((r) => setTimeout(r, 200));
      const inOect = { finds: document.querySelectorAll('.notes-card .find').length, todos: document.querySelectorAll('.notes-card .nt-todos .task').length };
      const ta = document.querySelector('.notes-card textarea[data-k="memo"]'); ta.value = '测试待做'; ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await new Promise((r) => setTimeout(r, 500));
      const d = await p.loadPlanner(); const m = d.memos.find((x) => x.text === '测试待做');
      const pinned = Array.isArray(d.topics) && d.topics.some((x) => x.id === 'v:oect');
      document.querySelector('.notes-card .nt-todos .tick').click(); await new Promise((r) => setTimeout(r, 400));
      const ticked = (await p.loadPlanner()).memos.some((x) => x.done);
      await p.changePlanner((dd) => { dd.memos = dd.memos.filter((x) => x.text !== '测试待做'); dd.memos.forEach((x) => { delete x.done; delete x.doneAt; }); }, 'test');
      await new Promise((r) => setTimeout(r, 300)); document.querySelector('.notes-card .nt-tab').click(); localStorage.removeItem('labnote-note-topic'); await new Promise((r) => setTimeout(r, 200));
      return { tabs, inOect, topic: m?.topic, pinned, ticked, kinds: [...document.querySelectorAll('.wb-glabel')].map((e) => e.firstChild.textContent) };`);
    if (r.tabs[0] !== '全部' || !r.tabs.some((x) => x.includes('OECT')) || r.inOect.finds !== 1 || r.inOect.todos !== 1 || r.topic !== 'v:oect' || !r.pinned || !r.ticked || r.kinds.includes('仪器') || !r.kinds.includes('科研')) throw new Error(JSON.stringify(r));
    return `tabs ${r.tabs.slice(0, 4).join(' / ')}; 仪器 shows as 科研`;
  });
  await check('finds', async () => {
    await go('#/', "document.querySelectorAll('.finds-card .find').length >= 2");
    const r = await evaluate(`const f = await import('./js/finds.js'); const p = await import('./js/planner.js'); const c = await import('./js/core.js'); const lab = await import('./js/lab.js'); const m = await import('./js/model.js');
      const t = m.todayISO(); const old = lab.addDays(t, -8); const old2 = lab.addDays(t, -9);
      const rule = [f.dueForFiling('2026-11-09', '2026-11-13'), f.dueForFiling('2026-11-09', '2026-11-14'), f.dueForFiling('2026-11-14', '2026-11-14'), f.dueForFiling('2026-11-14', '2026-11-15'), f.dueForFiling('2026-11-15', '2026-11-16')].join();
      await p.changePlanner((d) => { d.finds.push({ id: 'o1', text: '旧发现一', at: old + 'T10:05:00+08:00' }, { id: 'o2', text: '旧发现二\\n第二行', at: old + 'T16:30:00+08:00' }, { id: 'o3', text: '更早的', at: old2 + 'T08:00:00+08:00' }); }, 'test');
      await f.autoFileFinds();
      const vol = f.dailyVolume(); const pages = c.lib.allPages().filter((x) => x.vol === vol?.id).sort((a, b) => a.date.localeCompare(b.date));
      const body = pages.length ? await c.lib.readPage(vol.id, pages[pages.length - 1].num) : '';
      const left = (await p.loadPlanner()).finds.filter((x) => !x.filed).length;
      // a later fragment for a day that already has a page is appended to it
      await p.changePlanner((d) => { d.finds.push({ id: 'o4', text: '补记', at: old + 'T18:00:00+08:00' }); }, 'test');
      await f.autoFileFinds();
      const pages2 = c.lib.allPages().filter((x) => x.vol === vol?.id);
      const body2 = await c.lib.readPage(vol.id, pages[pages.length - 1].num);
      // a day with experiment records: its page lists them above the findings
      const y = lab.addDays(t, -1);
      await p.changePlanner((d) => { d.finds.push({ id: 'o5', text: '昨天的发现', at: y + 'T11:00:00+08:00' }); }, 'test');
      await f.fileFinds((d) => d === y);
      const yp = c.lib.allPages().find((x) => x.vol === vol.id && x.date === y);
      const body3 = m.parseFrontMatter(await c.lib.readPage(vol.id, yp.num)).body;
      const sum = { exp: body3.indexOf('## 当天的实验'), find: body3.indexOf('## 碎片发现'), rows: body3.split('| [[oect/').length - 1 };
      return { rule, vol: vol?.title, titles: pages.map((x) => x.title), dates: pages.map((x) => x.date), ok: body.includes('**10:05** 旧发现一') && body.includes('**16:30** 旧发现二') && body.includes('## 碎片发现'), left, n2: pages2.length, appended: body2.includes('**18:00** 补记') && body2.includes('旧发现一'), old, sum };`);
    if (r.rule !== 'false,true,false,true,true' || r.vol !== '每日发现' || r.titles.length !== 2 || !r.titles[1].startsWith(r.old) || !r.ok || r.left !== 2 || r.n2 !== 2 || !r.appended
      || !(r.sum.exp > 0 && r.sum.find > r.sum.exp && r.sum.rows === 2)) throw new Error(JSON.stringify(r));
    return `${r.titles.join(' / ')}; today's 2 stay`;
  });
  await check('solutions', async () => { await go('#/lib/solutions', "document.querySelectorAll('.sol-table tbody tr').length > 0"); await evaluate(clean); });
  await check('protocols', async () => { await go('#/lib/protocols', "document.querySelector('.view.library table, .view.library .tile, .view.library li')"); await evaluate(clean); });
  await check('methods', async () => { await go('#/v/oect/methods', "document.querySelectorAll('.m-card').length >= 2"); await evaluate(clean); await shot('methods'); });
  await check('method-card', async () => { await go('#/m/M-0001', "document.querySelectorAll('.m-vers li').length >= 2"); await evaluate(clean); await shot('method-card'); });
  await check('think', async () => { await go('#/think', "document.querySelector('.hyp-card')"); await evaluate(clean); });
  await check('hypothesis', async () => { await go('#/think/H-0001', "document.querySelector('.ev-chain')"); await evaluate(clean); });
  await check('plan', async () => { await go('#/plan', "document.querySelectorAll('.wb-page .wb-col').length === 8"); await evaluate(clean); await shot('plan'); });
  await check('series', async () => { await go(`#/series/${encodeURIComponent('PEDOT:PSS 配方优化')}`, "document.querySelector('.series-table tbody tr') && document.querySelectorAll('.series-course tbody tr').length === 2 && document.querySelector('.series-course tr.oc-fail .oc-tag.fail')"); await evaluate(clean); });
  await check('naming', async () => {
    await go('#/v/oect/2', "document.querySelector('.wrap-bar')");
    const r = await evaluate(`const wait = (ms) => new Promise((r) => setTimeout(r, ms)); const pg = await import('./js/pages.js'); const core = await import('./js/core.js'); const m = await import('./js/model.js');
      const { fm } = m.parseFrontMatter(await core.lib.readPage('oect', 2)); pg.openNaming(fm, 2); await wait(300);
      const inp = document.querySelector('#nm-sample'); inp.value = 'P3HT fiber-01'; inp.dispatchEvent(new Event('input')); await wait(100);
      const names = [...document.querySelectorAll('.naming-form > table.naming tbody code')].map((e) => e.textContent);
      const cmd = document.querySelector('.naming-form > div:not(.clip-chips) code')?.textContent || '';
      document.querySelector('.modal-root .btn').click();
      return { id: fm.id, names, cmd };`);
    if (r.names.length !== 3 || r.names[2] !== r.id + '_AFM_P3HT-fiber-01' || !r.cmd.includes('labnote.py mkdir ' + r.id + ' --sample "P3HT fiber-01" --inst Keithley,Eclipse,AFM')) throw new Error(JSON.stringify(r));
    await evaluate(clean);
    return r.names[2];
  });
  await check('finding-into-page', async () => {
    await go('#/', "document.querySelector('.notes-card .find .find-attach')");
    const r = await evaluate(`const wait = (ms) => new Promise((r) => setTimeout(r, ms)); const f = await import('./js/finds.js'); const p = await import('./js/planner.js'); const core = await import('./js/core.js'); const m = await import('./js/model.js');
      const ts = f.findTargets(); const kinds = [ts.some((o) => o.key.startsWith('s:')), ts.some((o) => o.key.startsWith('p:')), ts.every((o) => !o.page.signed)];
      // through the quick-entry dialog, into the latest page of a 实验主题
      await f.openQuickFind(); await wait(300);
      const sel = document.querySelector('#fq-target'); const opt = [...sel.options].find((o) => o.value.startsWith('s:')); sel.value = opt.value; sel.dispatchEvent(new Event('change'));
      const box = document.querySelector('#fq-text'); box.value = '测试：挂到实验页的发现';
      box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await wait(2500);
      [...document.querySelectorAll('.modal-root .btn')].find((b) => b.textContent.trim() === '关闭')?.click(); await wait(600);
      const x = (await p.loadPlanner()).finds.find((y) => y.text === '测试：挂到实验页的发现');
      const [vol, num] = (x?.filed || '/').split('/');
      const body = x?.filed ? m.parseFrontMatter(await core.lib.readPage(vol, Number(num))).body : '';
      const line = /## 过程记录\\n\\n- \\*\\*[\\d: -]+\\*\\* 测试：挂到实验页的发现/.test(body);
      const order = body.indexOf('## 过程记录') > 0 && (body.indexOf('## 结论') < 0 || body.indexOf('## 过程记录') < body.indexOf('## 结论'));
      // and an existing one, afterwards
      const old = (await p.loadPlanner()).finds.find((y) => !y.filed); const page = ts.find((o) => o.key.startsWith('p:')).page;
      const ok = await f.attachFind(old.id, page); await wait(800);
      const old2 = (await p.loadPlanner()).finds.find((y) => y.id === old.id);
      const body2 = m.parseFrontMatter(await core.lib.readPage(page.vol, page.num)).body;
      return { kinds, filed: x?.filed, inPage: x?.inPage, topic: x?.topic, line, order, ok, old: old2.filed === page.vol + '/' + page.num && old2.inPage, has: body2.includes(old.text.split('\\n')[0]) };`);
    if (r.kinds.includes(false) || !r.filed || !r.inPage || !r.line || !r.order || !r.ok || !r.old || !r.has) throw new Error(JSON.stringify(r));
    await go('#/', "document.querySelector('.notes-card .nt-filed')");
    const gone = await evaluate("return ![...document.querySelectorAll('.notes-card .find-text')].some((e) => /测试：挂到实验页的发现/.test(e.textContent));");
    if (!gone) throw new Error('filed finding still listed');
    return `quick entry → ${r.filed} 过程记录; existing finding attached; filed ones leave the list`;
  });
  await check('paper-notes', async () => {
    await go('#/', "document.querySelectorAll('.pp-card.paper .bi-notes').length >= 2 && document.querySelector('.pp-card .pp-prog')");
    const r = await evaluate(`const wait = (ms) => new Promise((r) => setTimeout(r, ms)); const p = await import('./js/planner.js'); const f = await import('./js/finds.js');
      const papers = [...document.querySelectorAll('.pp-card.paper')]; const every = papers.every((li) => li.querySelectorAll('.bi-notes').length === 2 && /\\dFigures/.test(li.textContent) && /\\dManuscript/.test(li.textContent) && /\\d方法卡片/.test(li.textContent));
      const doc0 = await p.loadPlanner(); const tp = f.topicsOf(doc0).find((t) => t.id === 'v:oect');
      const li = papers.find((e) => /2Figures/.test(e.textContent)); const colour = li.style.getPropertyValue('--k') === tp.color; const prog = li.querySelector('.pp-prog').textContent;
      [...li.querySelectorAll('.bi-notes')].find((b) => b.textContent.includes('Manuscript')).click(); await wait(300);
      const editOpened = !!document.querySelector('#pp-title');
      const nums = [...document.querySelectorAll('.pn-nums b')].map((e) => e.textContent).join('/');
      const groups0 = [...document.querySelectorAll('.pn-group h4')].map((e) => e.firstChild.textContent);
      [...document.querySelectorAll('.pn-secs .chip')].find((b) => b.textContent.startsWith('Conclusion')).click(); await wait(100);
      document.querySelector('#pn-where').value = 'p. 7';
      const ta = document.querySelector('#pn-text'); ta.value = '1. Shorten the conclusion\\n- 这一段逻辑不顺';
      ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await wait(500);
      const g = [...document.querySelectorAll('.pn-group')].find((e) => e.querySelector('h4').firstChild.textContent === 'Conclusion');
      const rows = g.querySelectorAll('.pn-item').length;
      g.querySelector('.pn-item .tick').click(); await wait(400);
      [...document.querySelectorAll('.pn-group')].find((e) => e.querySelector('h4').firstChild.textContent === 'Conclusion').querySelector('.pn-act').click(); await wait(400);
      const paper = (await p.loadPlanner()).papers.find((x) => x.id === 'A1'); const mine = paper.ms.filter((n) => n.sec === 'Conclusion');
      const st = p.paperNoteStats(paper);
      [...document.querySelectorAll('.pn-filter .chip')].find((b) => b.textContent.startsWith('已完成')).click(); await wait(100);
      const trace = [...document.querySelectorAll('.pn-item.done .pn-trace')].map((e) => e.textContent).join(' | ');
      const how = [...document.querySelectorAll('.pn-item.done .pn-how')].map((e) => e.textContent).join(' | ');
      [...document.querySelectorAll('.modal-root .btn')].find((b) => b.textContent.trim() === '关闭').click(); await wait(400);
      return { every, colour, prog, editOpened, nums, groups0, rows, mine: mine.map((n) => [n.text, n.where, n.by, n.done ? 'done' : n.drop ? 'drop' : 'open'].join('|')), st, trace, how };`);
    if (!r.every || !r.colour || !/已完成 2 · 待完成 3 · 不采纳 1/.test(r.prog) || r.editOpened || r.nums !== '2/3/1/6' || r.groups0.join(',') !== 'Results and Discussion,Experimental' || r.rows !== 2
      || r.mine[0] !== 'Shorten the conclusion|p. 7|导师|done' || r.mine[1] !== '这一段逻辑不顺|p. 7|导师|drop' || r.st.all !== 8 || r.st.done !== 3 || r.st.open !== 3 || r.st.drop !== 2 || !/提出 → .* 完成/.test(r.trace) || !r.how.includes('148 词')) throw new Error(JSON.stringify(r));
    await evaluate(clean);
    return `sections ${r.groups0.join(' / ')}; stats ${r.nums}; done and 不采纳 archived with trace`;
  });
  await check('back-keeps-place', async () => {
    await go('#/', "document.querySelector('.shelf .cover[href]') && document.querySelector('.home-boards .rail-card')");
    const r = await evaluate(`const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const shelf = document.querySelector('.shelf'); window.scrollTo(0, shelf.getBoundingClientRect().top + window.scrollY - 80); await wait(150);
      const y0 = Math.round(window.scrollY);
      document.querySelector('.shelf .cover[href]').click(); await wait(900);
      const atTop = window.scrollY < 5 && location.hash.startsWith('#/v/');
      document.querySelector('.topbar a[aria-label]').click(); await wait(1600);
      const y1 = Math.round(window.scrollY);
      document.querySelector('.shelf .cover[href]').click(); await wait(900);
      history.back(); await wait(1600);
      const y2 = Math.round(window.scrollY);
      // a fresh visit by a link still starts at the top
      location.hash = '#/projects'; await wait(900); const fresh = window.scrollY < 5;
      return { y0, atTop, y1, y2, fresh, hash: location.hash };`);
    if (r.y0 < 300 || !r.atTop || Math.abs(r.y1 - r.y0) > 6 || Math.abs(r.y2 - r.y0) > 6 || !r.fresh) throw new Error(JSON.stringify(r));
    return `left home at ${r.y0}px, back button → ${r.y1}px, browser back → ${r.y2}px`;
  });
  await check('paper-progress-and-seeds', async () => {
    await go('#/', "document.querySelector('.pp-card .pp-progress input') && document.querySelector('.pj-seeds')");
    const r = await evaluate(`const wait = (ms) => new Promise((r) => setTimeout(r, ms)); const p = await import('./js/planner.js');
      const card = [...document.querySelectorAll('.pp-card.paper')].find((e) => /2Figures/.test(e.textContent)); const input = card.querySelector('.pp-progress input');
      const auto = card.querySelector('.pp-progress').classList.contains('auto');
      input.value = '65'; input.dispatchEvent(new Event('input', { bubbles: true })); const live = card.querySelector('.pp-progress b').textContent;
      input.dispatchEvent(new Event('change', { bubbles: true })); await wait(500);
      const saved = (await p.loadPlanner()).papers.find((x) => x.id === 'A1').progress; const noDialog = !document.querySelector('#pp-title');
      const seeds = [...document.querySelectorAll('.pj-seeds .pj-seed-list li b')].map((e) => e.textContent);
      const early = !document.querySelector('.notes-card .nt-pj, .notes-card .nt-seeds');
      return { auto, live, saved, noDialog, seeds, early };`);
    if (!r.auto || r.live !== '65%' || r.saved !== 65 || !r.noDialog || r.seeds.length !== 2 || !r.early) throw new Error(JSON.stringify(r));
    await evaluate(clean);
    return `progress dragged to ${r.live}; ${r.seeds.length} project ideas in 课题与基金 (not in 课题手记)`;
  });
  await check('optimization-goal', async () => {
    await go(`#/series/${encodeURIComponent('PEDOT:PSS 配方优化')}`, "document.querySelector('.opt-card .opt-stats')");
    const r = await evaluate(`const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const card = () => document.querySelector('.opt-card');
      const before = { target: card().querySelector('.opt-target').textContent, vars: card().querySelectorAll('.opt-chip.var').length,
        stats: [...card().querySelectorAll('.opt-stat b')].map((e) => e.textContent).join('/') };
      card().querySelector('.opt-head .btn').click(); await wait(200);
      const dir = document.querySelector('#og-dir'); dir.value = 'min'; dir.dispatchEvent(new Event('change'));
      [...document.querySelectorAll('.modal-foot .btn')].find((b) => b.textContent === '保存').click(); await wait(900);
      const after = { target: card().querySelector('.opt-target').textContent, best: card().querySelector('.opt-stat.best b').textContent };
      const o = await import('./js/optimize.js'); const saved = (await o.loadGoals()).topics['PEDOT:PSS 配方优化'];
      const l = await import('./js/lab.js');
      const added = l.writeSamples('## 目的\\n\\nx\\n\\n## 过程记录\\n\\n- a\\n', { cols: ['编号', '结果: gm_max (µS)', '备注'], rows: [['#01', '20', '']] });
      return { before, after, dir: saved.dir, kept: saved.vars.length, added, num: [o.num('2.8×10⁴'), o.num('2.81e+04'), o.num('−0.30 V'), o.num('abc')] };`);
    const order = r.added.indexOf('## 条件与结果') > r.added.indexOf('## 目的') && r.added.indexOf('## 条件与结果') < r.added.indexOf('## 过程记录');
    if (!/gm_max \(mS\) 越大越好/.test(r.before.target) || !/on\/off ≥ 100/.test(r.before.target) || r.before.vars !== 2 || r.before.stats !== '5/4/2/4.4'
      || !/越小越好/.test(r.after.target) || r.after.best !== '3.1' || r.dir !== 'min' || r.kept !== 3 || !order
      || r.num.join() !== '28000,28100,-0.3,') throw new Error(JSON.stringify(r));
    await evaluate(clean);
    return `goal card ${r.before.stats} (有目标值/满足约束/行不通/最好); switched to min → best ${r.after.best}; table added before 过程记录`;
  });
  await check('candidates-and-aims', async () => {
    await go('#/', "document.querySelector('.aims-block .aimset') && document.querySelector('.cd-block .cd-card')");
    const r = await evaluate(`const wait = (ms) => new Promise((r) => setTimeout(r, ms)); const p = await import('./js/planner.js');
      const onHome = !!document.querySelector('.view.home > .aims-wrap, .view.home > .aims');
      const tab = [...document.querySelectorAll('.nt-tab')].find((e) => e.textContent.startsWith('全部')); tab?.click(); await wait(300);
      const last = document.querySelector('.notes-card .aims-block')?.nextElementSibling?.classList.contains('find-foot');
      const set = document.querySelector('.aimset'); const setText = set.querySelector('.aimset-t').textContent + ' | ' + set.querySelector('.aimset-names').textContent;
      const closed = !document.querySelector('.aimset-detail');
      set.click(); await wait(100);
      const aims = [...document.querySelectorAll('.aimset-detail .aim b')].map((e) => e.textContent); const stale = document.querySelectorAll('.aimset-detail .aim.stale').length;
      const input = document.querySelector('.cd-add-input'); input.value = 'P-90'; input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await wait(700);
      const names = [...document.querySelectorAll('.cd-card b')].map((e) => e.textContent);
      const linked = document.querySelector('.cd-series')?.textContent || '';
      const doc = await p.loadPlanner(); const added = doc.cands.find((c) => c.name === 'P-90');
      [...document.querySelectorAll('.aimset-detail .aim')].find((e) => /光电/.test(e.textContent)).querySelector('.aim-move').click(); await wait(200);
      document.querySelector('#am-what').value = '查了三篇文献'; document.querySelector('#am-next').value = '定 P3HT 光电对照';
      [...document.querySelectorAll('.modal-foot .btn')].find((b) => b.textContent === '保存').click(); await wait(700);
      const g = (await p.loadPlanner()).aims.find((a) => a.id === 'ga2');
      const staleAfter = document.querySelectorAll('.aimset-detail .aim.stale').length;
      const rm = await import('./js/roadmap.js');
      rm.editAimSet(null, await p.loadPlanner(), () => {}); await wait(300);
      document.querySelector('#as-title').value = '双光子 P3HT 打印应用';
      [...document.querySelectorAll('.modal-foot .btn')].find((b) => b.textContent === '保存').click(); await wait(800);
      const sets = (await p.loadPlanner()).aimSets.map((x) => x.title);
      return { onHome, last, setText, closed, aims, stale, names, linked, list: added?.list, topic: added?.topic, stage: g.stage, next: g.next, log: (g.log || []).length, staleAfter, sets };`);
    if (r.onHome || !r.last || r.setText !== '打印 OECT 电路应用 | 互补反相器 · 光电传感器' || !r.closed || r.aims.join() !== '互补反相器,光电传感器' || r.stale !== 1 || !r.names.includes('P-90') || r.list !== '可打印的沟道材料' || r.topic !== 'v:oect'
      || !/2 次/.test(r.linked) || r.stage !== '准备中' || r.next !== '定 P3HT 光电对照' || r.log !== 1 || r.staleAfter !== 0 || r.sets.join() !== '打印 OECT 电路应用,双光子 P3HT 打印应用') throw new Error(JSON.stringify(r));
    await evaluate(clean);
    return `set "${r.setText}" opens to ${r.aims.join(' / ')} (1 stale → 0 after 推进一步); new set added; candidate added to ${r.list}`;
  });
  await check('saved-tables', async () => {
    await go('#/tables', "document.querySelector('.tb-card')");
    const r = await evaluate(`const wait = (ms) => new Promise((r) => setTimeout(r, ms)); const t = await import('./js/tables.js');
      const cards = document.querySelectorAll('.tb-card').length;
      const html = '<p>对比如下：</p><table><thead><tr><th>材料</th><th>溶剂</th></tr></thead><tbody><tr><td><strong>PTHS</strong></td><td>水 | 乙醇</td></tr><tr><td>P-90</td><td>氯仿</td></tr></tbody></table><ul><li>先试 PTHS</li></ul>';
      const md = t.htmlToMarkdown(html); const tsv = t.textToMarkdown('a\\tb\\n1\\t2');
      t.editTable(null, { body: md }); await wait(400);
      document.querySelector('#tb-title').value = '水溶性候选的溶剂'; document.querySelector('#tb-tags').value = '溶剂，2PP';
      const shape = document.querySelector('.tb-shape').textContent; const prevRows = document.querySelectorAll('.tb-preview tbody tr').length;
      [...document.querySelectorAll('.modal-foot .btn')].find((b) => b.textContent === '保存').click(); await wait(1200);
      const at = location.hash; const rows = document.querySelectorAll('.tb-body table tbody tr').length; const head = [...document.querySelectorAll('.tb-body thead th')].map((e) => e.textContent).join(',');
      const items = await t.tableSearchItems(); const found = items.filter((x) => /乙醇/.test(x.text)).map((x) => x.tag);
      return { cards, md, tsv, shape, prevRows, at, rows, head, found, tables: t.tablesIn(md) };`);
    if (r.cards !== 1 || !/\| \*\*PTHS\*\* \| 水 \\\| 乙醇 \|/.test(r.md) || !/^- 先试 PTHS$/m.test(r.md) || r.tsv !== '| a | b |\n| --- | --- |\n| 1 | 2 |'
      || !/2 行 × 2 列/.test(r.shape) || r.prevRows !== 2 || r.at !== '#/tables/T-0002' || r.rows !== 2 || r.head !== '材料,溶剂' || r.found.join() !== 'T-0002' || r.tables[0][1][1] !== '水 | 乙醇') throw new Error(JSON.stringify(r));
    await evaluate(clean);
    return `pasted HTML table → Markdown, saved as ${r.at.slice(9)}, found by search ("乙醇")`;
  });
  await check('small-steps', async () => {
    await go('#/ops', "document.querySelector('.ops-day.today .op-row')");
    const r = await evaluate(`const wait = (ms) => new Promise((r) => setTimeout(r, ms)); const o = await import('./js/ops.js');
      const today = document.querySelectorAll('.ops-day.today .op-row').length;
      const p1 = o.parseQuick('中午手工制作了银电极，并且烘烤了4个小时 120度 13:00到17:00', '2026-11-17');
      const p2 = o.parseQuick('明天 下午3点 配制 100 mM 葡萄糖溶液 10 mL', '2026-11-17');
      await o.openQuickOp(); await wait(300);
      document.querySelector('.op-quick .seg-btn:last-child').click();
      const line = document.querySelector('#oq-line'); line.value = '13:00-17:00 烘烤银电极 120°C'; line.dispatchEvent(new Event('input'));
      const prev = document.querySelector('.oq-prev').textContent;
      line.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await wait(1200);
      const saved = (await o.loadOps({ from: new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10) })).find((x) => x.title === '烘烤银电极');
      document.querySelector('.modal-root')?.close?.(); await wait(300);
      const after = document.querySelectorAll('.ops-day.today .op-row').length;
      await o.openOpsPrint(); await wait(900);
      const info = document.querySelector('.op-print .muted.small:last-child')?.textContent || '';
      const sheet = document.querySelector('.ops-prev .ops-page'); const inner = sheet.firstChild;
      const cards = sheet.querySelectorAll('.oc:not(.blank)').length; const blanks = sheet.querySelectorAll('.oc.blank').length;
      const bars = sheet.querySelectorAll('.tl-bar').length; const fill = sheet.querySelectorAll('td.oc-a').length;
      const over = inner.scrollHeight - sheet.clientHeight;
      document.querySelector('.modal-root')?.close?.();
      return { today, p1, p2, prev, saved, after, info, cards, blanks, bars, fill, over };`);
    const ok = r.today === 5 && r.after === 6 && r.p1.title === '手工制作银电极，烘烤' && r.p1.dur === 240 && r.p1.kind === '烘烤' && r.p1.params[0].v === '120 °C'
      && r.p2.date === '2026-11-18' && r.p2.start === '15:00' && r.p2.title === '配制葡萄糖溶液' && r.p2.params.map((p) => p.v).join() === '100 mM,10 mL'
      && /4 h/.test(r.prev) && r.saved?.status === 'plan' && r.saved?.dur === 240 && /-OP-06$/.test(r.saved?.id)
      && /一页 A4/.test(r.info) && r.cards === 6 && r.bars >= 4 && r.fill > 5 && r.over <= 0;
    if (!ok) throw new Error(JSON.stringify(r));
    await evaluate(clean);
    return `one line → ${r.saved.id} (13:00–17:00, 4 h, 120 °C, 计划); A4 sheet: ${r.cards} cards + ${r.blanks} blank, ${r.info}`;
  });
  await check('toc-by-topic', async () => {
    await go('#/v/oect', "document.querySelector('.toc-table .series-row') && document.querySelector('.toc-mode .chip')");
    const r = await evaluate(`const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const rows = [...document.querySelectorAll('.toc-table tbody tr')].map((e) => e.className.includes('series-row') ? 'T' : e.className.includes('toc-child') ? 'c' : 'p').join('');
      const join = !!document.querySelector('.toc-table tr:not(.toc-child):not(.series-row) .toc-join');
      [...document.querySelectorAll('.toc-mode .chip')][1].click(); await wait(100);
      const flat = [...document.querySelectorAll('.toc-table tbody tr .c-no')].map((e) => e.textContent).join(','); const chips = document.querySelectorAll('.toc-table .toc-chip').length;
      [...document.querySelectorAll('.toc-mode .chip')][0].click(); await wait(100);
      return { rows, join, flat, chips, back: !!document.querySelector('.toc-table .series-row') };`);
    if (!/Tcc/.test(r.rows) || !r.join || r.flat !== '1,2,3' || r.chips !== 2 || !r.back) throw new Error(JSON.stringify(r));
    return `by topic ${r.rows}; by date ${r.flat}`;
  });
  await check('settings', async () => { await go('#/settings', "document.querySelector('#s-font')"); await evaluate(clean); });
  await check('search', async () => {
    await go('#/', "document.querySelector('.wb-col.is-today')");
    await evaluate("document.querySelector('.topbar [aria-label=\"搜索\"]').click(); return 1;");
    await waitFor("document.querySelector('.modal input[type=search]')");
    await evaluate("const i = document.querySelector('.modal input[type=search]'); i.value = 'GOPS'; i.dispatchEvent(new Event('input', { bubbles: true })); return 1;");
    await waitFor("document.querySelectorAll('.modal .results li').length > 0");
    return `${await evaluate("return document.querySelectorAll('.modal .results li').length;")} results`;
  });
  await check('ime-and-focus-stability', async () => {
    await evaluate("document.querySelector('.modal-root')?.close?.(); return 1;");
    await go('#/', "document.querySelector('.wb-nag .add-input') && document.querySelector('.ops-card .oq-line') && document.querySelector('.notes-card textarea[data-k=\"find\"]')");
    const r = await evaluate(`
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const core = await import('./js/core.js');
      const home = await import('./js/home.js');
      const finds = await import('./js/finds.js');
      const planner = await import('./js/planner.js');
      const imeKey = (key) => {
        const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
        Object.defineProperty(ev, 'keyCode', { value: 229 });
        return ev;
      };

      // 1. Safari-style IME Enter (keyCode 229, isComposing false) must NOT prematurely submit in weekboard, finds, or ops
      const nag = document.querySelector('.wb-nag .add-input');
      nag.focus(); nag.value = '测试中文催办';
      nag.dispatchEvent(imeKey('Enter'));
      await wait(50);
      const nagKept = document.activeElement === nag && nag.value === '测试中文催办';

      // 2. Background lib.emit('data') while typing in weekboard must NOT destroy page or exit input
      core.lib.emit('data');
      await wait(280);
      const nagSurvivedData = nag.isConnected && document.activeElement === nag && nag.value === '测试中文催办';
      nag.value = ''; nag.blur();

      // 3. Background lib.emit('data') while focused on empty opsCard input must NOT kick focus out
      const opsIn = document.querySelector('.ops-card .oq-line');
      opsIn.focus();
      opsIn.dispatchEvent(imeKey('Enter'));
      core.lib.emit('data');
      await wait(280);
      const opsSurvivedData = opsIn.isConnected && document.activeElement === opsIn;
      opsIn.blur();

      // 4. Cross-section redrawHome() while typing in 课题手记 must NOT wipe textarea or lose focus
      const findTa = document.querySelector('.notes-card textarea[data-k="find"]');
      findTa.focus(); findTa.value = '半截中文发现';
      findTa.dispatchEvent(imeKey('Enter'));
      home.redrawHome();
      await wait(260);
      const findSurvived = findTa.isConnected && document.activeElement === findTa && findTa.value === '半截中文发现';
      findTa.value = ''; findTa.blur();

      // 5. Active IME composition in mustInput survives redrawHome()
      const mustIn = document.querySelector('.wb-must .add-input');
      mustIn.focus();
      mustIn.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' }));
      mustIn.value = 'shiyan';
      home.redrawHome();
      await wait(260);
      const mustImeSurvived = mustIn.isConnected && document.activeElement === mustIn && mustIn.value === 'shiyan';
      mustIn.value = '';
      mustIn.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '' }));
      mustIn.blur();

      // 6. Inline editable ignores IME Enter & IME Escape, and closes only on real Escape
      const editSpan = document.querySelector('.wb-nagcard .task-text.editable');
      editSpan.click();
      await wait(30);
      const editIn = document.querySelector('.wb-nagcard .edit-input');
      editIn.dispatchEvent(imeKey('Enter'));
      editIn.dispatchEvent(imeKey('Escape'));
      const inlineKeptOnIme = Boolean(editIn && editIn.isConnected && document.activeElement === editIn);
      editIn.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      const inlineClosedOnEsc = !document.querySelector('.wb-nagcard .edit-input');

      // 7. Weekboard day adder stays open when clicking <select> (Safari blur quirk) AND survives data emit
      const todayCol = document.querySelector('.wb-col.is-today');
      todayCol.querySelector('.wb-add-btn').click();
      const dayIn = todayCol.querySelector('.wb-add .add-input');
      const daySel = todayCol.querySelector('.wb-add .wb-kind');
      daySel.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      dayIn.blur();
      await wait(260);
      const adderKeptOnSelect = Boolean(todayCol.querySelector('.wb-add .add-input'));
      daySel.dispatchEvent(new Event('blur'));
      dayIn.focus();
      core.lib.emit('data');
      await wait(260);
      const adderSurvivedData = dayIn.isConnected && document.activeElement === dayIn;
      dayIn.blur();

      // 8. Modal ignores IME Escape & IME Enter, closes on normal Escape
      await finds.openQuickFind();
      await wait(120);
      const fq = document.querySelector('#fq-text');
      fq.focus(); fq.value = '中文批注';
      fq.dispatchEvent(imeKey('Enter'));
      fq.dispatchEvent(imeKey('Escape'));
      const modalKeptOnIme = Boolean(document.querySelector('.modal-root') && fq.value === '中文批注');
      fq.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      const modalClosedOnEsc = !document.querySelector('.modal-root');

      // 9. Search dialog ignores IME Enter (does not navigate away)
      document.querySelector('.topbar [aria-label="搜索"]').click();
      await wait(120);
      const sIn = document.querySelector('.modal input[type=search]');
      sIn.focus(); sIn.value = 'GOPS';
      sIn.dispatchEvent(new Event('input', { bubbles: true }));
      await wait(120);
      sIn.dispatchEvent(imeKey('Enter'));
      const searchKeptOnIme = Boolean(document.querySelector('.modal-root')) && location.hash === '#/';
      document.querySelector('.modal-root')?.close?.();

      // 10. Candidate adder keeps exact DOM node & focus after adding an item
      const candIn = document.querySelector('.cd-add-input');
      const candKey = candIn?.dataset?.k;
      candIn.focus(); candIn.value = '测试候选材料IME';
      candIn.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await wait(350);
      const candSameNode = document.activeElement === candIn && candIn.isConnected && candIn.dataset?.k === candKey;
      await planner.changePlanner((d) => { d.cands = (d.cands || []).filter((c) => c.name !== '测试候选材料IME'); }, 'Cleanup test cand', home.redrawHome);
      document.activeElement?.blur?.();

      // 11. Consecutive Enter submit in nagInput & findsCard keeps exact DOM node AND displays item 1 even while composing item 2
      const nagNode = document.querySelector('.wb-nag .add-input');
      nagNode.focus(); nagNode.value = '连录催办甲';
      nagNode.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      nagNode.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' }));
      nagNode.value = 'yi';
      await wait(180);
      const nagSameNode = document.querySelector('.wb-nag .add-input') === nagNode && document.activeElement === nagNode && nagNode.value === 'yi';
      const nagShownMidIme = [...document.querySelectorAll('.wb-nagcard .task-text')].some((el) => el.textContent.includes('连录催办甲'));
      nagNode.value = '';
      nagNode.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '' }));
      nagNode.blur();

      const findNode = document.querySelector('.notes-card textarea[data-k="find"]');
      findNode.focus(); findNode.value = '连录发现甲';
      findNode.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      await wait(180);
      const findSameNode = document.querySelector('.notes-card textarea[data-k="find"]') === findNode && document.activeElement === findNode;
      findNode.blur();
      await planner.changePlanner((d) => {
        d.tasks = (d.tasks || []).filter((t) => t.text !== '连录催办甲');
        d.finds = (d.finds || []).filter((f) => f.text !== '连录发现甲');
      }, 'Cleanup consecutive test items', home.redrawHome);

      // 12. Empty cat-截止 & cat-文献 inputs keep exact DOM node across external redrawHome()
      const dlIn = document.querySelector('.dl-head input[data-k="cat-截止"]');
      dlIn.focus();
      home.redrawHome();
      await wait(220);
      const dlSameNode = document.querySelector('.dl-head input[data-k="cat-截止"]') === dlIn && document.activeElement === dlIn;
      dlIn.blur();

      // 13. Detaching composing node auto-heals util.isComposing()
      const util = await import('./js/util.js');
      await finds.openQuickFind();
      await wait(80);
      const fq2 = document.getElementById('fq-text');
      fq2.focus();
      fq2.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' }));
      document.querySelector('.modal-root')?.close?.();
      const detachedImeHealed = util.isComposing() === false;

      // 14. Stacked modals: Escape closes ONLY the topmost modal
      const m1 = core.modal({ title: 'Outer', body: document.createTextNode('outer') });
      const m2 = core.modal({ title: 'Inner', body: document.createTextNode('inner') });
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      const stackedEscOk = m1.isConnected && !m2.isConnected;
      m1.close();

      // 15. openPaperNotes keeps exact #pn-text DOM node mounted & focused on Enter submit
      const firstPaperId = planner.planLocal?.doc?.papers?.[0]?.id;
      let paperNoteSameNode = true;
      if (firstPaperId) {
        planner.openPaperNotes(firstPaperId, 'ms');
        await wait(80);
        const pnTa = document.getElementById('pn-text');
        pnTa.focus(); pnTa.value = '临时中文批注测试';
        pnTa.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
        await wait(120);
        paperNoteSameNode = document.getElementById('pn-text') === pnTa && document.activeElement === pnTa;
        document.querySelector('.modal-root')?.close?.();
        await planner.changePlanner((d) => {
          const p = (d.papers || []).find((x) => x.id === firstPaperId);
          if (p?.ms) p.ms = p.ms.filter((n) => n.text !== '临时中文批注测试');
        }, 'Cleanup paper note test', home.redrawHome);
      }

      // 16. route({ quiet: true }) on #/plan forwards opts (keeps modal) & aborts async show() race while typing
      const appMod = await import('./js/app.js');
      location.hash = '#/plan';
      await wait(350);
      await finds.openQuickFind();
      await wait(80);
      await appMod.route({ quiet: true, background: true });
      const planQuietKeptModal = Boolean(document.querySelector('.modal-root'));
      document.querySelector('.modal-root')?.close?.();
      const raceP = appMod.route({ quiet: true, background: true });
      const planNag = document.querySelector('.wb-nag .add-input');
      if (planNag) { planNag.focus(); planNag.value = '竞态保护'; }
      await raceP;
      const planAsyncRaceSafe = Boolean(planNag && planNag.isConnected && document.activeElement === planNag && planNag.value === '竞态保护');
      if (planNag) { planNag.value = ''; planNag.blur(); }

      // 17. Editor textarea Tab mid-IME does not indent/corrupt list line
      location.hash = '#/v/oect/new';
      await wait(350);
      const edTa = document.querySelector('.editor-text');
      edTa.focus();
      edTa.value = '- 中文列表';
      edTa.setSelectionRange(edTa.value.length, edTa.value.length);
      edTa.dispatchEvent(imeKey('Tab'));
      const editorTabImeSafe = edTa.value === '- 中文列表';
      edTa.blur();

      return {
        nagKept, nagSurvivedData, opsSurvivedData, findSurvived, mustImeSurvived,
        inlineKeptOnIme, inlineClosedOnEsc, adderKeptOnSelect, adderSurvivedData,
        modalKeptOnIme, modalClosedOnEsc, searchKeptOnIme, candSameNode,
        nagSameNode, nagShownMidIme, findSameNode, dlSameNode,
        detachedImeHealed, stackedEscOk, paperNoteSameNode,
        planQuietKeptModal, planAsyncRaceSafe, editorTabImeSafe,
      };
    `);
    const bad = Object.entries(r).filter(([, v]) => !v).map(([k]) => k);
    if (bad.length) throw new Error(`failed checks: ${bad.join(', ')} (${JSON.stringify(r)})`);
    return 'IME Enter/Esc/Tab, detached-IME heal, persistent inputs, stacked modals, and async quiet-route race all verified';
  });
  await check('word-export', async () => {
    await evaluate("document.querySelector('.modal-root')?.close?.(); return 1;");
    await go('#/v/oect/methods', "document.querySelectorAll('.m-card').length >= 2");
    await evaluate(`window.__blob = 0; const o = URL.createObjectURL; URL.createObjectURL = (b) => { if (b && b.size > 1000) window.__blob = b.size; return o(b); };
      [...document.querySelectorAll('.topbar .btn')].find(b => b.textContent.includes('Experimental')).click(); await new Promise(r => setTimeout(r, 300));
      document.querySelector('#mx-mark').checked = false; document.querySelector('#mx-scope').value = 'all';
      [...document.querySelectorAll('.modal-foot button')].find(b => b.textContent === '导出 Word').click(); return 1;`);
    await waitFor('window.__blob > 0', 15000);
    return `${await evaluate('return window.__blob;')} bytes`;
  });
} catch (e) {
  results.push({ name: 'harness', ok: false, note: e.message });
} finally {
  try { ws?.close(); } catch { /* ignore */ }
  chrome.kill();
  await sleep(300);
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
}
const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.note ? `  — ${r.note}` : ''}`);
console.log(`\n${results.length - failed.length}/${results.length} passed${baseline ? ' (baseline saved)' : ''}`);
process.exit(failed.length ? 1 : 0);
