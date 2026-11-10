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

  await check('home', async () => { await waitFor("document.querySelector('.wb-col.is-today') && document.querySelectorAll('.rail-card').length >= 5"); await sleep(600); await evaluate(clean); await shot('home'); });
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
  await check('continue-card', async () => {
    await waitFor("document.querySelector('.cont-card .cont-col') && !/读取中/.test(document.querySelector('.cont-card .card-sub').textContent)");
    return await evaluate("return document.querySelector('.cont-card .card-sub').textContent;");
  });
  await check('countdown-basis', async () => {
    const t = await evaluate("return [...document.querySelectorAll('.rail-card')].find(c => c.querySelector('h3').textContent === '截止日倒计时').querySelector('.card-sub').textContent;");
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
      return { tiles: document.querySelectorAll('.clip-tile').length, hint: m.unitHints('框线 0.5 pt'), z, zh, zo, cats: document.querySelectorAll('.clip-cat').length };`);
    if (!r.zo.zcopy || !r.zo.image || r.zo.plabel !== '19002' || r.zo.page || r.zo.cite !== 'Wang 等 2025' || Math.abs(r.zo.ratio - 609 / 709) > 1e-6) throw new Error('obsidian format ' + JSON.stringify(r.zo));
    if (zh_bad(r.zh)) throw new Error('html ' + JSON.stringify(r.zh));
    if (r.z.page !== '5' || r.z.fig !== 'Fig. 2b' || !/open-pdf/.test(r.z.zotero) || r.z.cite !== 'Liu et al. 2024' || !r.hint.includes('0.18 mm')) throw new Error(JSON.stringify(r));
    await evaluate(clean); await shot('clips');
    return `${r.tiles} clips, ${r.cats} categories`;
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
  await check('finds', async () => {
    await go('#/', "document.querySelectorAll('.finds-card .find').length >= 2");
    const r = await evaluate(`const f = await import('./js/finds.js'); const p = await import('./js/planner.js'); const c = await import('./js/core.js'); const lab = await import('./js/lab.js'); const m = await import('./js/model.js');
      const t = m.todayISO(); const old = lab.addDays(t, -8); const old2 = lab.addDays(t, -9);
      const rule = [f.dueForFiling('2026-11-09', '2026-11-13'), f.dueForFiling('2026-11-09', '2026-11-14'), f.dueForFiling('2026-11-14', '2026-11-14'), f.dueForFiling('2026-11-14', '2026-11-15'), f.dueForFiling('2026-11-15', '2026-11-16')].join();
      await p.changePlanner((d) => { d.finds.push({ id: 'o1', text: '旧发现一', at: old + 'T10:05:00+08:00' }, { id: 'o2', text: '旧发现二\\n第二行', at: old + 'T16:30:00+08:00' }, { id: 'o3', text: '更早的', at: old2 + 'T08:00:00+08:00' }); }, 'test');
      await f.autoFileFinds();
      const vol = f.dailyVolume(); const pages = c.lib.allPages().filter((x) => x.vol === vol?.id).sort((a, b) => a.date.localeCompare(b.date));
      const body = pages.length ? await c.lib.readPage(vol.id, pages[pages.length - 1].num) : '';
      const left = (await p.loadPlanner()).finds.length;
      // a later fragment for a day that already has a page is appended to it
      await p.changePlanner((d) => { d.finds.push({ id: 'o4', text: '补记', at: old + 'T18:00:00+08:00' }); }, 'test');
      await f.autoFileFinds();
      const pages2 = c.lib.allPages().filter((x) => x.vol === vol?.id);
      const body2 = await c.lib.readPage(vol.id, pages[pages.length - 1].num);
      return { rule, vol: vol?.title, titles: pages.map((x) => x.title), dates: pages.map((x) => x.date), ok: body.includes('**10:05** 旧发现一') && body.includes('**16:30** 旧发现二'), left, n2: pages2.length, appended: body2.includes('**18:00** 补记') && body2.includes('旧发现一'), old };`);
    if (r.rule !== 'false,true,false,true,true' || r.vol !== '每日发现' || r.titles.length !== 2 || !r.titles[1].startsWith(r.old) || !r.ok || r.left !== 2 || r.n2 !== 2 || !r.appended) throw new Error(JSON.stringify(r));
    return `${r.titles.join(' / ')}; today's 2 stay`;
  });
  await check('solutions', async () => { await go('#/lib/solutions', "document.querySelectorAll('.sol-table tbody tr').length > 0"); await evaluate(clean); });
  await check('protocols', async () => { await go('#/lib/protocols', "document.querySelector('.view.library table, .view.library .tile, .view.library li')"); await evaluate(clean); });
  await check('methods', async () => { await go('#/v/oect/methods', "document.querySelectorAll('.m-card').length >= 2"); await evaluate(clean); await shot('methods'); });
  await check('method-card', async () => { await go('#/m/M-0001', "document.querySelectorAll('.m-vers li').length >= 2"); await evaluate(clean); await shot('method-card'); });
  await check('think', async () => { await go('#/think', "document.querySelector('.hyp-card')"); await evaluate(clean); });
  await check('hypothesis', async () => { await go('#/think/H-0001', "document.querySelector('.ev-chain')"); await evaluate(clean); });
  await check('plan', async () => { await go('#/plan', "document.querySelectorAll('.wb-page .wb-col').length === 8"); await evaluate(clean); await shot('plan'); });
  await check('series', async () => { await go(`#/series/${encodeURIComponent('PEDOT:PSS 配方优化')}`, "document.querySelector('.series-table tbody tr')"); await evaluate(clean); });
  await check('settings', async () => { await go('#/settings', "document.querySelector('#s-font')"); await evaluate(clean); });
  await check('search', async () => {
    await go('#/', "document.querySelector('.wb-col.is-today')");
    await evaluate("document.querySelector('.topbar [aria-label=\"搜索\"]').click(); return 1;");
    await waitFor("document.querySelector('.modal input[type=search]')");
    await evaluate("const i = document.querySelector('.modal input[type=search]'); i.value = 'GOPS'; i.dispatchEvent(new Event('input', { bubbles: true })); return 1;");
    await waitFor("document.querySelectorAll('.modal .results li').length > 0");
    return `${await evaluate("return document.querySelectorAll('.modal .results li').length;")} results`;
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
