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

  await check('home', async () => { await waitFor("document.querySelector('.wb-col.is-today') && document.querySelectorAll('.rail-card').length >= 4"); await sleep(600); await evaluate(clean); await shot('home'); });
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
    const order = await evaluate("const y = (q) => document.querySelector(q).getBoundingClientRect().top; return { ok: y('.dl-hero') < y('.wb') && y('.wb') < y('.notes-card') && y('.notes-card') < y('.shelf') && y('.shelf') < y('.home-boards'), gone: !document.querySelector('.cont-card') && !document.querySelector('.tile.recent'), cols: document.querySelectorAll('.notes-card .nt-col').length };");
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
    await go('#/', "document.querySelector('.notes-card .find-page.in-page')");
    return `quick entry → ${r.filed} 过程记录; existing finding attached`;
  });
  await check('paper-notes', async () => {
    await go('#/', "document.querySelectorAll('.board-item.paper .bi-notes').length >= 2");
    const r = await evaluate(`const wait = (ms) => new Promise((r) => setTimeout(r, ms)); const p = await import('./js/planner.js');
      const papers = [...document.querySelectorAll('.board-item.paper')]; const every = papers.every((li) => li.querySelectorAll('.bi-notes').length === 2 && /Figures \\d+/.test(li.textContent) && /Manuscript \\d+/.test(li.textContent));
      const li = papers.find((e) => /Figures 2/.test(e.textContent)); const btn = [...li.querySelectorAll('.bi-notes')].find((b) => b.textContent.startsWith('Manuscript'));
      btn.click(); await wait(300);
      const editOpened = !!document.querySelector('#pp-title');
      document.querySelector('#pn-where').value = 'p. 3';
      const ta = document.querySelector('#pn-text'); ta.value = '1. Shorten the abstract\\n- 这一段逻辑不顺';
      ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await wait(500);
      const rows = document.querySelectorAll('.pn-list .pn-item').length;
      document.querySelector('.pn-list .tick').click(); await wait(400);
      const doc = await p.loadPlanner(); const paper = doc.papers.find((x) => (x.ms || []).length);
      [...document.querySelectorAll('.modal-root .btn')].find((b) => b.textContent.trim() === '关闭').click(); await wait(400);
      const label = [...document.querySelectorAll('.board-item.paper .bi-notes')].find((b) => b.textContent === 'Manuscript 2');
      return { every, editOpened, rows, ms: paper.ms.map((n) => [n.text, n.where, n.by, !!n.done].join('|')), label: !!label, open: label?.classList.contains('open') };`);
    if (!r.every || r.editOpened || r.rows !== 2 || r.ms.length !== 2 || r.ms[0] !== 'Shorten the abstract|p. 3|导师|true' || r.ms[1] !== '这一段逻辑不顺|p. 3|导师|false' || !r.label || !r.open) throw new Error(JSON.stringify(r));
    await evaluate(clean);
    return 'Figures / Manuscript on every paper; two pasted lines became two items';
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
