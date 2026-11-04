// The page editor and the table / steps / reagents / quote dialogs it opens.
import { ApiError, ConflictError, kv, mimeOf } from './store.js';
import { cleanTag, fmtDate, fmtTime, nowISO, pad, pagePath, parseFrontMatter, parseRef, safeFileName, todayISO } from './model.js';
import {
  MATERIAL_FROM, RESULT_HINT, STEP_CONTAINERS, STEP_FIELDS, STEP_OPS, colLabel, headings, isResultCol,
  loadReagents, loadSolutions, looksLikeHeader, mdTable, parseTSV, quoteBlock, readMaterials, readSamples,
  readSteps, replaceSection, sampleNo, samplesTemplate, writeMaterials, writeSamples, writeSteps,
} from './lab.js';
import { search } from './search.js';
import { debounce, fmtBytes, h, icon } from './util.js';
import { S, choose, demoBanner, field, lib, modal, prepareFile, saveError, signerName, thead, toast, topbar, view, viewMissing, menu } from './core.js';
import { amendEntry, pageCtx, reasonField, refLink, updatePage, newXid } from './pages.js';
import { pdfPreview } from './printing.js';
import { openCiteHypothesis } from './think.js';
import { pickMethod } from './methods.js';
import { openPagePicker } from './searchui.js';
import { route } from './app.js';

export async function viewEditor(vol, num, params) {
  const v = lib.volume(vol);
  if (!v) return viewMissing('笔记本里没有这个卷。');
  const isNew = num == null;
  const pending = isNew ? null : lib.pendingFor(vol, num);
  const dkey = `${lib.key}:draft:${vol}/${isNew ? 'new' : num}`;
  let fm; let body; let baseSha = null;
  const local = new Map();
  const removed = new Set();
  let existing = [];
  if (!isNew) {
    if (!lib.page(vol, num)) return viewMissing(`第 ${num} 页还不存在。`);
    ({ fm, body } = parseFrontMatter(await lib.readPage(vol, num)));
    baseSha = pending ? (pending.baseSha ?? null) : (lib.tree.get(pagePath(vol, num)) || null);
    existing = lib.attachments(vol, num);
    for (const a of pending?.attachments || []) local.set(a.name, new Blob([a.buf], { type: a.type }));
  } else {
    fm = { title: '', date: todayISO(), tags: [] };
    const c = params.get('continues');
    if (c) fm.continues = c;
  }
  const origSigned = !!fm.signed;
  let notice = null;
  const draft = await kv.get(dkey).catch(() => null);
  if (draft) {
    fm = draft.fm; body = draft.body;
    if (!isNew) {
      if ((draft.baseSha ?? null) !== baseSha) notice = '草稿写完后这一页又被改过。保存时会让你选择保留哪个版本。';
      baseSha = draft.baseSha ?? null;
    }
    for (const name of draft.attachments || []) {
      const a = await kv.get(`${dkey}:att:${name}`).catch(() => null);
      if (a) local.set(name, new Blob([a.buf], { type: a.type }));
    }
    for (const n of draft.removed || []) removed.add(n);
    toast(`已恢复 ${fmtTime(new Date(draft.updated).toISOString())} 的未保存草稿。`, { label: '丢弃草稿', run: async () => { await clearDraft(); route(); } });
  }

  // ----- fields -----
  const titleIn = h('input', { class: 'val title-input', value: fm.title || '', placeholder: '这一页写什么？', 'aria-label': '标题' });
  const dateIn = h('input', { type: 'date', class: 'val', value: String(fm.date || todayISO()).slice(0, 10), 'aria-label': '日期' });
  const tagsIn = h('input', { class: 'val', value: (fm.tags || []).join(', '), placeholder: '逗号分隔，例如 oect, gops', 'aria-label': '标签' });
  const ta = h('textarea', { class: 'editor-text', spellcheck: 'true', 'aria-label': '正文', placeholder: '在这里写。支持 Markdown、$公式$、[[页面链接]] 和附件。' });
  ta.value = body || '';
  const pdf = pdfPreview();
  const status = h('span', { class: 'ed-status', 'aria-live': 'polite' }, draft ? '已恢复草稿' : '');
  const strip = h('div', { class: 'att-strip' });
  const fileIn = h('input', { type: 'file', multiple: true, hidden: true, accept: 'image/*,.csv,.tsv,.json,.ipynb,.pdf,.txt,.xlsx,.zip' });

  let contLine = null;
  const renderCont = () => {
    const c = fm.continues ? parseRef(fm.continues, vol) : null;
    const nl = c ? h('p', { class: 'cont from' }, '接上页 ', refLink(`${c.vol}/${c.num}`, vol), ' ',
      h('button', { class: 'btn small ghost', type: 'button', onclick: () => { delete fm.continues; renderCont(); changed(); } }, '移除')) : h('span', { hidden: true });
    if (contLine) contLine.replaceWith(nl);
    contLine = nl;
  };
  renderCont();

  const collect = () => ({
    fm: {
      ...fm,
      title: titleIn.value.trim(),
      date: dateIn.value || todayISO(),
      tags: [...new Set(tagsIn.value.split(/[,\n]/).map(cleanTag).filter(Boolean))],
      ...(readMaterials(ta.value) ? { reagents: readMaterials(ta.value).map((m) => m.id) } : {}),
    },
    body: ta.value,
  });

  const saveDraft = debounce(async () => {
    const c = collect();
    await kv.set(dkey, { fm: c.fm, body: c.body, baseSha, attachments: [...local.keys()], removed: [...removed], updated: Date.now() }).catch(() => {});
    status.textContent = `草稿已存在本机，${fmtTime(nowISO())}`;
  }, 700);
  async function clearDraft() {
    saveDraft.cancel();
    for (const k of await kv.keys(`${dkey}:`)) await kv.del(k);
    await kv.del(dkey);
  }

  const previewUrls = [];
  const renderPreview = debounce(async () => {
    if (!wide() && split.dataset.tab !== 'preview') return;
    const old = previewUrls.splice(0);
    const n = num ?? lib.nextNumber(vol);
    const ctx = pageCtx(vol, n, local);
    ctx.urls = previewUrls;
    const c = collect();
    await pdf.update(vol, n, { ...c.fm, id: fm.id, series: fm.series, protocol: fm.protocol, amended: fm.amended }, c.body, ctx);
    setTimeout(() => old.forEach((u) => URL.revokeObjectURL(u)), 2000);
  }, 450);

  const autosize = () => { ta.style.height = 'auto'; ta.style.height = `${Math.max(ta.scrollHeight + 4, 360)}px`; };
  const changed = () => { status.textContent = '编辑中'; saveDraft(); renderPreview(); };
  for (const el of [titleIn, dateIn, tagsIn]) el.addEventListener('input', changed);
  ta.addEventListener('input', () => { autosize(); changed(); });

  // ----- text helpers -----
  const fire = () => ta.dispatchEvent(new Event('input'));
  function wrap(before, after = before, placeholder = 'text') {
    const s = ta.selectionStart; const e = ta.selectionEnd;
    const sel = ta.value.slice(s, e);
    ta.focus();
    ta.setRangeText(before + (sel || placeholder) + after, s, e, 'end');
    if (!sel) { ta.selectionStart = s + before.length; ta.selectionEnd = s + before.length + placeholder.length; }
    fire();
  }
  function prefixLines(prefix) {
    const s = ta.selectionStart; const e = ta.selectionEnd;
    const start = ta.value.lastIndexOf('\n', s - 1) + 1;
    const chunk = ta.value.slice(start, e);
    ta.focus();
    ta.setRangeText(chunk.split('\n').map((l) => prefix + l).join('\n'), start, e, 'end');
    fire();
  }
  function insertBlock(text, selectFrom, selectLen) {
    const s = ta.selectionStart;
    const before = ta.value.slice(0, s);
    const lead = !before || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
    ta.focus();
    ta.setRangeText(`${lead}${text}\n`, s, ta.selectionEnd, 'end');
    if (selectFrom != null) { ta.selectionStart = s + lead.length + selectFrom; ta.selectionEnd = ta.selectionStart + selectLen; }
    fire();
  }
  function insertInline(text) { ta.focus(); ta.setRangeText(text, ta.selectionStart, ta.selectionEnd, 'end'); fire(); }

  // ----- attachments -----
  const allNames = () => new Set([...existing.filter((n) => !removed.has(n)), ...local.keys()]);
  function uniqueName(name) {
    const taken = allNames();
    if (!taken.has(name)) return name;
    const m = name.match(/^(.*?)(\.[^.]*)?$/);
    let i = 2;
    while (taken.has(`${m[1]}-${i}${m[2] || ''}`)) i++;
    return `${m[1]}-${i}${m[2] || ''}`;
  }
  async function attach(files) {
    for (const f0 of files) {
      const f = await prepareFile(f0);
      let base = f.name && !/^image\.\w+$/.test(f.name) ? f.name : `pasted-${Date.now().toString(36)}.${(f.type.split('/')[1] || 'png').replace('jpeg', 'jpg')}`;
      const name = uniqueName(safeFileName(base));
      local.set(name, f);
      removed.delete(name);
      await kv.set(`${dkey}:att:${name}`, { type: f.type || mimeOf(name), buf: await f.arrayBuffer() }).catch(() => {});
      const ext = name.split('.').pop().toLowerCase();
      if ((f.type || '').startsWith('image/')) {
        insertBlock(`![${name.replace(/\.\w+$/, '').replace(/[-_]+/g, ' ')}](${name})`);
      } else if (['csv', 'tsv'].includes(ext)) {
        const first = (await f.slice(0, 4096).text()).split(/\r?\n/)[0] || '';
        const cols = first.split(ext === 'tsv' ? '\t' : ',').map((c) => c.trim().replace(/^"|"$/g, ''));
        const errCol = cols.slice(1).find((c) => /(^|[_\s-])(sd|se|sem|err|error|ci)$/i.test(c));
        const ys = cols.slice(1).filter((c) => c !== errCol).slice(0, errCol ? 1 : 2);
        insertBlock(`\`\`\`chart\ntype: line\ndata: ${name}\nx: ${cols[0] || ''}\ny: ${ys.join(', ')}\n${errCol ? `error: ${errCol}\n` : ''}title: \n\`\`\``);
      } else if (['ipynb', 'json'].includes(ext)) {
        insertBlock(`![[${name}]]`);
      } else insertInline(`[${name}](${name})`);
    }
    renderStrip();
    saveDraft(); renderPreview();
  }
  function renderStrip() {
    const names = [...new Set([...existing, ...local.keys()])].sort();
    strip.replaceChildren(...names.map((n) => {
      const isLocal = local.has(n) && !existing.includes(n);
      const gone = removed.has(n);
      const size = local.get(n)?.size;
      return h('span', { class: `att${gone ? ' gone' : ''}` },
        h('span', { class: 'att-name' }, n), size ? h('span', { class: 'att-size' }, fmtBytes(size)) : null,
        h('button', {
          class: 'btn icon small ghost', type: 'button', 'aria-label': gone ? `Keep ${n}` : `Remove ${n}`, title: gone ? '保留' : '移除',
          onclick: async () => {
            if (isLocal) { local.delete(n); await kv.del(`${dkey}:att:${n}`).catch(() => {}); } else if (gone) removed.delete(n); else removed.add(n);
            renderStrip(); saveDraft(); renderPreview();
          },
        }, icon(gone ? 'plus' : 'close', 16)));
    }));
    strip.hidden = !names.length;
  }
  fileIn.addEventListener('change', () => { attach([...fileIn.files]); fileIn.value = ''; });
  ta.addEventListener('paste', (e) => {
    // Excel also puts a picture of the cells on the clipboard; the cells themselves win.
    const rows = clipTable(e);
    if (rows) { e.preventDefault(); insertBlock(mdTable(rows)); saveDraft(); renderPreview(); toast(`已粘贴为表格（${rows.length - 1} 行 × ${rows[0].length} 列，第一行是表头）。`); return; }
    const files = [...(e.clipboardData?.files || [])];
    if (files.length) { e.preventDefault(); attach(files); }
  });
  ta.addEventListener('dragover', (e) => { if (e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); ta.classList.add('drop'); } });
  ta.addEventListener('dragleave', () => ta.classList.remove('drop'));
  ta.addEventListener('drop', (e) => {
    ta.classList.remove('drop');
    const files = [...(e.dataTransfer?.files || [])];
    if (files.length) { e.preventDefault(); attach(files); }
  });

  // ----- toolbar -----
  const tb = (ic, label, run) => h('button', { class: 'tool', type: 'button', title: label, 'aria-label': label, onclick: run }, icon(ic, 18));
  const toolbar = h('div', { class: 'toolbar', role: 'toolbar', 'aria-label': 'Formatting' },
    tb('heading', '标题', () => prefixLines('## ')),
    tb('bold', '加粗', () => wrap('**')),
    tb('italic', '斜体', () => wrap('*')),
    tb('list', '列表', () => prefixLines('- ')),
    tb('check', '清单', () => prefixLines('- [ ] ')),
    tb('quote', '引用', () => prefixLines('> ')),
    h('span', { class: 'tool-sep' }),
    tb('math', '公式', () => {
      const sel = ta.value.slice(ta.selectionStart, ta.selectionEnd);
      if (sel && !sel.includes('\n')) wrap('$', '$'); else insertBlock('$$\nE = mc^2\n$$', 3, 8);
    }),
    tb('code', '代码', () => insertBlock('```python\n\n```', 10, 0)),
    tb('table', '表格', () => insertBlock('| Column | Value |\n|---|---|\n|  |  |')),
    h('span', { class: 'tool-sep' }),
    h('button', { class: 'tool text mk-hl', type: 'button', title: '荧光笔 ==文字==', onclick: () => wrap('==', '==', '重点') }, '荧光'),
    h('button', { class: 'tool text mk-ul', type: 'button', title: '下划线 ++文字++', onclick: () => wrap('++', '++', '重点') }, '下划线'),
    h('button', { class: 'tool text mk-ci', type: 'button', title: '画圈 {{文字}}', onclick: () => wrap('{{', '}}', '重点') }, '圈出'),
    h('button', { class: 'tool text mk-ink', type: 'button', title: '字的颜色：选中文字后点这里，写成 {红|文字}', onclick: (e) => menu(e.currentTarget,
      [['红', 'red'], ['蓝', 'blue'], ['绿', 'green'], ['橙', 'orange'], ['紫', 'purple'], ['灰', 'grey']].map(([n, c]) => ({ icon: 'pen', label: `${n}色`, cls: `ink-${c}`, run: () => wrap(`{${n}|`, '}', '文字') }))) }, '颜色'),
    h('button', { class: 'tool text', type: 'button', title: '引用另一次实验的某一节（例如完全相同的操作步骤）', onclick: () => openQuoteDialog(vol, num, (block) => insertBlock(block)) }, '引用实验'),
    h('button', { class: 'tool text', type: 'button', title: '引用思维笔记本里的假设：整条逻辑链做成假设框，或在步骤里行内引用某条观察 O / 预测 P', onclick: () => openCiteHypothesis(vol, num, (block) => insertBlock(block), (t) => insertInline(t)) }, '引用假设'),
    h('button', { class: 'tool text', type: 'button', title: '从试剂库 / 溶液库导入本次用到的试剂和溶液（写在页面最下方“试剂”一节）',
      onclick: () => openMaterials(vol, num, { text: ta.value, reagents: fm.reagents || [], onInsert: (rows) => { ta.value = writeMaterials(ta.value, rows); changed(); toast('已写入页面最下方“试剂”一节。'); } }) }, '试剂'),
    h('button', { class: 'tool text', type: 'button', title: '引用方法卡片（插入 M-编号，页面上点它可打开卡片）', onclick: () => pickMethod(vol, (m) => insertInline(`${m.id}（${m.title}）`)) }, '方法'),
    h('span', { class: 'tool-sep' }),
    h('button', { class: 'tool text', type: 'button', title: '反应方程式（一行一个）', onclick: () => insertBlock('```reaction\n2 H2O2 ->[Pt] 2 H2O + O2 | (1)\n```') }, '反应式'),
    h('button', { class: 'tool text', type: 'button', title: '操作步骤：操作 | 用量 | 物质 | 加到/容器 | 条件 | 细节', onclick: () => insertBlock('```steps\n移取 | 10 mL | DI 水 | 20 mL 玻璃瓶 | 室温 | 沿瓶壁缓慢加入\n```') }, '步骤'),
    tb('chart', '图表', () => insertBlock('```chart\ntype: line\nx: dose\ny: response\ntitle: \n---\ndose,response\n0,0.1\n1,0.4\n2,0.7\n```')),
    tb('link', '链接到页面', () => openPagePicker(vol, (ref) => insertInline(`[[${ref}]]`))),
    tb('attach', '附件', () => fileIn.click()));

  ta.addEventListener('keydown', (e) => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); save(false); }
    if (mod && e.key.toLowerCase() === 'b') { e.preventDefault(); wrap('**'); }
    if (mod && e.key.toLowerCase() === 'i') { e.preventDefault(); wrap('*'); }
    if (e.key === 'Tab' && !e.shiftKey && !mod) {
      const line = ta.value.slice(ta.value.lastIndexOf('\n', ta.selectionStart - 1) + 1, ta.selectionStart);
      if (/^\s*([-*+]|\d+\.)\s/.test(line)) { e.preventDefault(); prefixLines('  '); }
    }
  });

  // ----- write / preview tabs (narrow screens) -----
  const wide = () => window.matchMedia('(min-width: 1100px)').matches;
  const writePane = h('div', { class: 'pane write-pane' }, toolbar, ta, strip);
  const previewPane = h('div', { class: 'pane preview-pane' }, h('div', { class: 'pane-label' }, 'PDF 预览'), pdf.el);
  const split = h('div', { class: 'ed-split', 'data-tab': 'write' }, writePane, previewPane);
  const tabWrite = h('button', { class: 'tab', type: 'button', role: 'tab', 'aria-selected': 'true', onclick: () => setTab('write') }, icon('write', 18), '编写');
  const tabPrev = h('button', { class: 'tab', type: 'button', role: 'tab', 'aria-selected': 'false', onclick: () => setTab('preview') }, icon('eye', 18), '预览');
  function setTab(t) {
    split.dataset.tab = t;
    tabWrite.setAttribute('aria-selected', String(t === 'write'));
    tabPrev.setAttribute('aria-selected', String(t === 'preview'));
    if (t === 'preview') renderPreview.flush(); else { ta.focus(); autosize(); }
  }

  // ----- save -----
  let saving = false;
  const saveBtn = h('button', { class: 'btn', type: 'button', onclick: () => save(false) }, origSigned ? '保存修订' : '保存');
  const whyInput = h('input', { class: 'why-input', placeholder: '修改原因（必填），例如：补充漏记的退火时间', 'aria-label': '修改原因' });
  const signBtn = origSigned ? null : h('button', { class: 'btn primary', type: 'button', onclick: () => save(true) }, icon('pen', 18), '签名并保存');
  // New pages are experiments by default, so raw data, fingerprints and sample numbers work from the start.
  const asExp = isNew && !fm.id ? h('input', { type: 'checkbox', checked: true, 'aria-label': '作为实验记录' }) : null;
  async function save(sign, opts = {}) {
    if (saving) return;
    if (origSigned && !whyInput.value.trim()) { toast('本页已签名，请在下方写明修改原因。'); whyInput.focus(); return; }
    saving = true; saveBtn.disabled = true; if (signBtn) signBtn.disabled = true;
    status.textContent = '保存中…';
    const c = collect();
    if (!c.fm.title) c.fm.title = '未命名';
    if (asExp?.checked && !c.fm.id) c.fm.id = newXid(vol, String(c.fm.date || todayISO()).slice(0, 10));
    const now = nowISO();
    if (origSigned) c.fm.amended = [...(c.fm.amended || []), amendEntry(whyInput.value)];
    else if (sign) { c.fm.signed = now; c.fm.signer = signerName(); }
    const item = {
      id: pending?.id, vol, num: isNew ? null : num, isNew: isNew || !!pending?.isNew, baseSha,
      fm: c.fm, body: c.body,
      attachments: [...local].filter(([n]) => !removed.has(n)).map(([name, blob]) => ({ name, blob })),
      removed: [...removed].filter((n) => existing.includes(n)),
      ...opts,
    };
    try {
      const r = await lib.savePage(item);
      await clearDraft();
      leaving = true;
      toast(r.queued ? '已存在本机，联网后同步到 GitHub。' : sign ? '已签名并保存。' : origSigned ? '修订已保存。' : '已保存。');
      location.hash = `#/v/${vol}/${r.num}`;
    } catch (e) {
      if (e instanceof ConflictError) {
        saving = false;
        const choice = await choose('这一页在别的设备上改过', '你开始编辑之后，有人（可能是你在另一台设备上）保存了这一页的另一个版本。', [
          ['overwrite', '用我的版本覆盖'], ['new', '把我的另存为新页'], ['cancel', '继续编辑'],
        ]);
        if (choice === 'overwrite') return await save(sign, { force: true });
        if (choice === 'new') return await save(sign, { isNew: true, asNew: true, num: null });
      } else {
        toast(e instanceof ApiError && e.status === 403 ? 'GitHub 拒绝了修改。请检查本设备令牌的 Contents 是否为 Read and write。' : `没有保存：${e.message}`);
      }
      status.textContent = '还没保存，草稿在本机。';
    } finally {
      saving = false; saveBtn.disabled = false; if (signBtn) signBtn.disabled = false;
    }
  }
  let leaving = false;
  const cancel = async () => {
    const c = collect();
    const dirty = draft || c.body !== (body || '') || c.fm.title !== (fm.title || '') || local.size || removed.size;
    if (dirty) {
      const choice = await choose('离开这一页？', '草稿会保留在本机，之后可以回来继续。', [['keep', '保留草稿并离开'], ['discard', '丢弃草稿'], ['stay', '继续编辑']]);
      if (choice === 'stay' || !choice) return;
      if (choice === 'discard') await clearDraft(); else saveDraft.flush();
    }
    leaving = true;
    location.hash = isNew ? `#/v/${vol}` : `#/v/${vol}/${num}`;
  };

  const stamp = h('div', { class: 'stamp', 'aria-label': isNew ? '新页' : `Page ${num}` }, h('span', { class: 'stamp-no' }, 'No'), isNew ? pad(lib.nextNumber(vol)) : pad(num));
  const sheet = h('article', { class: 'sheet page editing' },
    h('header', { class: 'sheet-head' },
      h('div', { class: 'form-row' }, field('项目', v.title, 'grow'), field('卷号', v.number), stamp),
      h('div', { class: 'form-row' },
        h('label', { class: 'field grow' }, h('span', { class: 'lbl' }, '标题'), titleIn),
        h('label', { class: 'field' }, h('span', { class: 'lbl' }, '日期'), dateIn)),
      h('div', { class: 'form-row' }, h('label', { class: 'field grow' }, h('span', { class: 'lbl' }, '标签'), tagsIn)),
      asExp ? h('div', { class: 'form-row no-print' }, h('label', { class: 'check ed-exp' }, asExp, ' 作为实验记录（保存时自动分配实验编号，例如 ', h('code', null, newXid(vol, todayISO())), '）')) : null),
    notice ? h('p', { class: 'warn' }, notice) : null,
    origSigned ? h('p', { class: 'note' }, `This page was signed on ${fmtDate(fm.signed)}. Changes are saved as a dated amendment, and the earlier version stays in the page history.`) : null,
    contLine,
    h('div', { class: 'tabs', role: 'tablist' }, tabWrite, tabPrev),
    split, fileIn);

  const root = h('div', { class: 'view editor' },
    topbar({ title: isNew ? `${v.title} · 新页` : `编辑第 ${num} 页`, sub: v.title, actions: [] }),
    demoBanner(), sheet,
    h('div', { class: 'action-bar' }, status, origSigned ? whyInput : null, h('div', { class: 'ab-buttons' }, h('button', { class: 'btn ghost', type: 'button', onclick: cancel }, '取消'), saveBtn, signBtn)));
  root.querySelector('.topbar .tb-left').prepend(h('button', { class: 'btn icon ghost', 'aria-label': '取消', title: '取消', onclick: cancel }, icon('close')));

  renderStrip();
  requestAnimationFrame(() => {
    autosize(); renderPreview.flush();
    (isNew && !titleIn.value ? titleIn : ta).focus({ preventScroll: true });
  });
  window.addEventListener('resize', () => { if (wide()) renderPreview(); }, { passive: true });
  const leaveGuard = () => { if (!leaving && view.kind === 'editor') saveDraft.flush(); };
  window.addEventListener('pagehide', leaveGuard);
  window.addEventListener('hashchange', leaveGuard, { once: true });
  return root;
}

// Rows of a table on the clipboard (spreadsheet cells, or a table copied from Word / a web page), else null.
export function clipTable(e) {
  const text = e.clipboardData?.getData('text/plain') || '';
  if (/\t/.test(text)) { const rows = parseTSV(text); if (rows.length && (rows.length > 1 || rows[0].length > 1)) return rows; }
  const html = e.clipboardData?.getData('text/html') || '';
  if (/<table/i.test(html)) {
    const table = new DOMParser().parseFromString(html, 'text/html').querySelector('table');
    const rows = [...(table?.rows || [])].map((tr) => [...tr.cells].map((td) => td.innerText?.trim() ?? td.textContent.trim()));
    const width = Math.max(0, ...rows.map((r) => r.length));
    const out = rows.map((r) => [...r, ...Array(width - r.length).fill('')]).filter((r) => r.some(Boolean));
    if (out.length && (out.length > 1 || out[0].length > 1)) return out;
  }
  return null;
}

// ----- sample table editor: copy results from the paper card into the page -----
export async function openSamplesEditor(vol, num) {
  const { fm, body } = parseFrontMatter(await lib.readPage(vol, num));
  const t = readSamples(body) || samplesTemplate([1], [], []);
  const grid = h('div', { class: 'grid-wrap' });
  const draw = () => {
    grid.replaceChildren(h('table', { class: 'grid' },
      h('thead', null, h('tr', null, t.cols.map((c, j) => h('th', { class: isResultCol(c) ? 'res' : null, title: isResultCol(c) ? '结果列' : '条件列' },
        h('input', { value: colLabel(c), 'aria-label': `第 ${j + 1} 列名`, oninput: (e) => { t.cols[j] = isResultCol(c) ? `结果: ${e.target.value}` : e.target.value; } }))), h('th'))),
      h('tbody', null, t.rows.map((r, i) => h('tr', null,
        r.map((v, j) => h('td', { class: isResultCol(t.cols[j]) ? 'res' : null }, h('input', {
          value: v, 'aria-label': `${r[0]} ${colLabel(t.cols[j])}`,
          oninput: (e) => { r[j] = e.target.value; },
          onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); grid.querySelectorAll('tbody tr')[i + 1]?.children[j]?.querySelector('input')?.focus(); } },
        }))),
        h('td', null, h('button', { class: 'btn icon small ghost', type: 'button', 'aria-label': '删除这一行', onclick: () => { t.rows.splice(i, 1); draw(); } }, icon('close', 16))))))));
  };
  draw();
  // Paste a block of spreadsheet cells: it fills the grid from the cell you are in, like Excel,
  // adding rows and columns as needed. A header row lands in the column names.
  grid.addEventListener('paste', (e) => {
    const input = e.target.closest('input'); if (!input) return;
    let rows = clipTable(e); if (!rows) return;
    e.preventDefault();
    const inHead = !!input.closest('thead');
    const j0 = [...input.closest('tr').children].indexOf(input.closest('th, td'));
    const i0 = inHead ? 0 : [...grid.querySelectorAll('tbody tr')].indexOf(input.closest('tr'));
    const head = inHead || looksLikeHeader(rows) ? rows.shift() : null;
    const width = Math.max(head?.length || 0, ...rows.map((r) => r.length));
    const nums = () => t.rows.map((r) => parseInt(String(r[0]).replace(/\D/g, ''), 10) || 0);
    // Columns past the right edge go before 备注, as conditions or results by their names.
    for (let k = 0; k < width; k++) {
      const j = j0 + k;
      if (j < t.cols.length && !(t.cols[j] === '备注' && head && head[k] && head[k] !== '备注')) continue;
      const name = head?.[k] || `列${j + 1}`;
      t.cols.splice(j, 0, RESULT_HINT.test(name) ? `结果: ${name}` : name);
      for (const r of t.rows) r.splice(j, 0, '');
    }
    if (head) head.forEach((v, k) => { if (v && j0 + k > 0) t.cols[j0 + k] = isResultCol(t.cols[j0 + k]) || RESULT_HINT.test(v) ? `结果: ${v}` : v; });
    rows.forEach((r, k) => {
      while (t.rows.length <= i0 + k) t.rows.push(t.cols.map((_, j) => (j === 0 ? sampleNo(Math.max(0, ...nums()) + 1) : '')));
      r.forEach((v, m) => { t.rows[i0 + k][j0 + m] = j0 + m === 0 ? sampleNo(v) : v; });
    });
    draw();
    toast(`已粘贴 ${rows.length} 行 × ${width} 列${head ? '，第一行作为列名' : ''}。`);
  });
  const addRow = () => {
    const nums = t.rows.map((r) => parseInt(String(r[0]).replace(/\D/g, ''), 10) || 0);
    t.rows.push(t.cols.map((_, j) => (j === 0 ? sampleNo(Math.max(0, ...nums) + 1) : ''))); draw();
  };
  const addCol = (result) => {
    const name = window.prompt(result ? '结果列名称（含单位，例如 gm_max (mS)）' : '条件列名称（含单位，例如 GOPS (wt%)）');
    if (!name) return;
    const at = result ? t.cols.length - (t.cols[t.cols.length - 1] === '备注' ? 1 : 0) : Math.max(1, t.cols.findIndex(isResultCol) === -1 ? t.cols.length - 1 : t.cols.findIndex(isResultCol));
    t.cols.splice(at, 0, result ? `结果: ${name}` : name);
    for (const r of t.rows) r.splice(at, 0, '');
    draw();
  };
  const why = reasonField(fm, 'se-why');
  modal({
    title: `录入条件与结果 · ${fm.id || `p. ${num}`}`, wide: true,
    body: h('div', null,
      h('p', { class: 'muted' }, '按纸质记录卡逐行录入，或在 Excel / WPS 里选中一块单元格 ⌘C，点一个格子 ⌘V 整块粘贴（带表头会自动成为列名）。Enter 跳到下一行同一列。绿色列是结果，Keithley 数据同步时会自动填入空着的结果格。'),
      grid, why.el,
      h('div', { class: 'row-actions' },
        h('button', { class: 'btn small', type: 'button', onclick: addRow }, icon('plus', 16), '加一行'),
        h('button', { class: 'btn small', type: 'button', onclick: () => addCol(false) }, '加条件列'),
        h('button', { class: 'btn small', type: 'button', onclick: () => addCol(true) }, '加结果列'))),
    buttons: [{ label: '取消' }, {
      label: '保存', primary: true,
      run: async () => {
        if (!why.ok()) return false;
        t.rows = t.rows.filter((r) => r.some((v) => String(v).trim()));
        try {
          await updatePage(vol, num, ({ fm: f, body: b }) => ({ fm: f, body: writeSamples(b, t) }), `Results for ${fm.id || `p. ${num}`}`, why.value());
          toast(fm.signed ? '已保存为修订（原版本保留在历史中）。' : '已保存。');
        } catch (e) { toast(saveError(e)); return false; }
      },
    }],
  });
}

// ----- operation steps: what, how much, into which container, under which conditions -----
// ----- key resources: pick reagents / solutions from the libraries, say which bottle and how much -----
// From the page editor, `text` is the draft being edited and `onInsert` takes the rows instead of saving the page.
export async function openMaterials(vol, num, { text = null, onInsert = null, reagents = [] } = {}) {
  const { fm, body } = text != null ? { fm: { reagents }, body: text } : parseFrontMatter(await lib.readPage(vol, num));
  const [rs, ss] = await Promise.all([loadReagents(lib).catch(() => []), loadSolutions(lib).catch(() => [])]);
  const lib2 = { r: rs, s: ss };
  const all = new Map([...rs, ...ss].map((x) => [x.id, x]));
  const list = (readMaterials(body) || (fm.reagents || []).map((id) => ({ id }))).map((m) => {
    const known = MATERIAL_FROM.find((f) => (m.from || '').startsWith(f));
    return { ...m, kind: known || (m.from ? '其他' : (String(m.id).startsWith('S-') ? '母液' : '原瓶')), bottle: known ? (m.from || '').slice(known.length).trim() : (m.from || '') };
  });
  let tab = 'r';
  const q = h('input', { type: 'search', id: 'mt-q', placeholder: '搜索：名称、英文名、CAS、编号、存放位置', autocomplete: 'off' });
  const tabs = h('div', { class: 'seg mt-tabs' });
  const hits = h('div', { class: 'mt-hits' });
  const chosen = h('div', { class: 'mt-chosen' });
  const label = (x) => [x.name, x.name_en && x.name_en !== x.name ? x.name_en : '', x.cas, x.spec || x.conc, x.vendor, x.location].filter(Boolean).join(' · ');
  const drawTabs = () => tabs.replaceChildren(...[['r', `试剂库 ${rs.length}`], ['s', `溶液库 ${ss.length}`]].map(([k, l]) => h('button', { type: 'button', class: `seg-btn${tab === k ? ' on' : ''}`, onclick: () => { tab = k; drawTabs(); drawHits(); } }, l)));
  const drawHits = () => {
    const t = q.value.trim().toLowerCase();
    const src = lib2[tab].filter((x) => !['用完', '废弃'].includes(x.status));
    const found = (t ? src.filter((x) => `${x.id} ${label(x)} ${x.lot || ''} ${x.recipe || ''}`.toLowerCase().includes(t)) : tab === 's' ? src : []).slice(0, 40);
    hits.replaceChildren(...(found.length ? found.map((x) => h('button', { type: 'button', class: 'mt-hit', disabled: list.some((m) => m.id === x.id),
      onclick: () => { list.push({ id: x.id, kind: tab === 's' ? '母液' : '原瓶', bottle: '', amount: '', note: '' }); drawHits(); drawChosen(); } },
      h('span', { class: 'xid-tag' }, x.id), ' ', h('b', null, x.name), h('span', { class: 'muted' }, ` ${label(x).slice(x.name.length)}`)))
      : [h('p', { class: 'muted' }, t ? '没有找到。换个关键词，或试试 CAS 号。' : tab === 'r' ? `输入关键词搜索 ${rs.length} 种试剂。` : '溶液库还是空的。')]));
  };
  const drawChosen = () => chosen.replaceChildren(list.length ? h('table', { class: 'grid mt-grid' },
    h('thead', null, h('tr', null, ['编号', '名称', '来源', '瓶号 / 说明', '本次用量', ''].map((c) => h('th', null, c)))),
    h('tbody', null, list.map((m, i) => h('tr', null,
      h('td', { class: 'mono' }, m.id),
      h('td', null, all.get(m.id)?.name || h('span', { class: 'warn' }, '库里没有')),
      h('td', null, h('select', { onchange: (e) => { m.kind = e.target.value; } }, MATERIAL_FROM.map((f) => h('option', { selected: m.kind === f }, f)))),
      h('td', null, h('input', { value: m.bottle || '', placeholder: '例如 #2、2026-11-03 分装', oninput: (e) => { m.bottle = e.target.value; } })),
      h('td', null, h('input', { value: m.amount || '', placeholder: '例如 20 mg、100 μL', oninput: (e) => { m.amount = e.target.value; } })),
      h('td', null, h('button', { class: 'btn icon small ghost', type: 'button', 'aria-label': '移除', onclick: () => { list.splice(i, 1); drawChosen(); drawHits(); } }, icon('close', 16)))))))
    : h('p', { class: 'muted' }, '还没有选择。在上面搜索后点一下即可加入。'));
  q.addEventListener('input', drawHits);
  drawTabs(); drawHits(); drawChosen();
  const why = reasonField(fm, 'mt-why');
  modal({
    title: `试剂 · ${fm.id || `p. ${num}`}`, wide: true,
    body: h('div', { class: 'form' },
      tabs, q, hits,
      h('span', { class: 'label' }, '本次使用'), chosen,
      h('p', { class: 'muted' }, '保存后，页面最下方“试剂”一节会列出编号、名称、CAS、规格、厂商、批号/到货、来源和用量。用量留空时，自动取“操作步骤”里写的量。'),
      why.el),
    buttons: [{ label: '取消' }, {
      label: '保存', primary: true,
      run: async () => {
        if (!why.ok()) return false;
        const rows = list.map((m) => ({ id: m.id, from: [m.kind, m.bottle].filter(Boolean).join(' '), amount: m.amount, note: m.note }));
        if (onInsert) { onInsert(rows); return; }
        try {
          await updatePage(vol, num, ({ fm: f, body: b }) => {
            if (rows.length) f.reagents = rows.map((m) => m.id); else delete f.reagents;
            return { fm: f, body: writeMaterials(b, rows) };
          }, `Resources for ${fm.id || `p. ${num}`}`, why.value() || '更新试剂');
          toast('已保存。');
        } catch (e) { toast(saveError(e)); return false; }
      },
    }],
  });
  setTimeout(() => q.focus(), 50);
}

export async function openStepsEditor(vol, num) {
  const { fm, body } = parseFrontMatter(await lib.readPage(vol, num));
  const steps = readSteps(body) || [];
  if (!steps.length) steps.push(Object.fromEntries(STEP_FIELDS.map(([k]) => [k, ''])));
  const reagents = [...await loadReagents(lib).catch(() => []), ...(await loadSolutions(lib).catch(() => [])).filter((x) => !['用完', '废弃'].includes(x.status)).map((x) => ({ ...x, spec: x.conc, vendor: '自配溶液' }))];
  const used = (k) => steps.map((x) => x[k]).filter(Boolean);
  const lists = h('div', { hidden: true },
    h('datalist', { id: 'st-ops' }, [...new Set([...STEP_OPS, ...used('op')])].map((v) => h('option', { value: v }))),
    h('datalist', { id: 'st-what' }, reagents.map((r) => h('option', { value: `${r.name} ${r.id}` }, [r.spec, r.vendor].filter(Boolean).join(' · ')))),
    h('datalist', { id: 'st-into' }, [...new Set([...(lib.notebook.containers || []), ...STEP_CONTAINERS, ...used('into')])].map((v) => h('option', { value: v }))));
  const showMore = h('input', { type: 'checkbox', id: 'st-more', checked: steps.some((x) => x.cond || x.note) });
  const PH = { op: '移取', amount: '10 mL', what: 'DI 水 / 选试剂', into: '20 mL 玻璃瓶', cond: '室温，500 rpm，30 min', note: '沿瓶壁缓慢滴加，避免气泡' };
  const grid = h('div', { class: 'grid-wrap' });
  const draw = () => {
    const fields = STEP_FIELDS.filter(([k]) => showMore.checked || !['cond', 'note'].includes(k));
    grid.replaceChildren(h('table', { class: 'grid steps-grid' },
      h('thead', null, h('tr', null, h('th', { class: 'no' }, '#'), fields.map(([k, l]) => h('th', { class: `c-${k}` }, l)), h('th'))),
      h('tbody', null, steps.map((st, i) => h('tr', null,
        h('th', { class: 'no' }, i + 1),
        fields.map(([k, l]) => h('td', { class: `c-${k}` }, h('input', {
          value: st[k] || '', placeholder: i === 0 ? PH[k] : '', 'aria-label': `第 ${i + 1} 步 ${l}`,
          list: { op: 'st-ops', what: 'st-what', into: 'st-into' }[k] || null,
          oninput: (e) => { st[k] = e.target.value; },
          onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); if (i === steps.length - 1) addRow(); grid.querySelectorAll('tbody tr')[i + 1]?.querySelector(`td.c-${k} input`)?.focus(); } },
        }))),
        h('td', { class: 'row-tools' },
          h('button', { class: 'btn icon small ghost', type: 'button', 'aria-label': '上移', title: '上移', disabled: i === 0, onclick: () => { [steps[i - 1], steps[i]] = [steps[i], steps[i - 1]]; draw(); } }, '↑'),
          h('button', { class: 'btn icon small ghost', type: 'button', 'aria-label': '删除这一步', title: '删除', onclick: () => { steps.splice(i, 1); draw(); } }, icon('close', 16))))))));
  };
  const addRow = () => { steps.push(Object.fromEntries(STEP_FIELDS.map(([k]) => [k, '']))); draw(); };
  showMore.addEventListener('change', draw);
  draw();
  const why = reasonField(fm, 'st-why');
  modal({
    title: `操作步骤 · ${fm.id || `p. ${num}`}`, wide: true,
    body: h('div', null,
      h('p', { class: 'muted' }, '一行一步。只有“操作”必填，其余可留空。物质可从试剂库选（带上试剂编号便于溯源），容器可从下拉选或自己写。页面上用量为蓝色、试剂为棕色、容器加框显示。'),
      lists,
      h('label', { class: 'check', for: 'st-more' }, showMore, ' 显示细节列（条件、具体操作细节）'),
      grid,
      h('div', { class: 'row-actions' }, h('button', { class: 'btn small', type: 'button', onclick: addRow }, icon('plus', 16), '加一步')),
      why.el),
    buttons: [{ label: '取消' }, {
      label: '保存', primary: true,
      run: async () => {
        if (!why.ok()) return false;
        const keep = steps.filter((x) => STEP_FIELDS.some(([k]) => String(x[k] || '').trim()));
        try {
          await updatePage(vol, num, ({ fm: f, body: b }) => ({ fm: f, body: writeSteps(b, keep) }), `Steps for ${fm.id || `p. ${num}`}`, why.value());
          toast(fm.signed ? '已保存为修订（原版本保留在历史中）。' : '已保存。');
        } catch (e) { toast(saveError(e)); return false; }
      },
    }],
  });
}

// Quote a section of another experiment instead of copying it: "same steps as 20261029-OECT-01".
// onInsert(block) puts it into the editor; without it the block replaces (or adds) that section of the page.
export function openQuoteDialog(curVol, curNum, onInsert) {
  openPagePicker(curVol, async (ref) => {
    const r = parseRef(ref, curVol);
    const target = r && lib.page(r.vol, r.num);
    if (!target) return;
    const { body } = parseFrontMatter(await lib.readPage(r.vol, r.num));
    const hs = headings(body).filter((x) => x.level <= 3);
    const sec = h('select', { id: 'q-sec' }, h('option', { value: '' }, '整页'), hs.map((x) => h('option', { value: x.text, selected: x.text === '操作步骤' }, `${'　'.repeat(x.level - 2 < 0 ? 0 : x.level - 2)}${x.text}`)));
    const note = h('input', { id: 'q-note', value: '本次完全按照此步骤操作，未作任何改动。' });
    const ownPage = !onInsert && curNum ? parseFrontMatter(await lib.readPage(curVol, curNum)) : { fm: {}, body: '' };
    const own = ownPage.body;
    const why = reasonField(ownPage.fm, 'q-why');
    const replace = h('input', { type: 'checkbox', id: 'q-rep', checked: true });
    const repRow = h('label', { class: 'check', for: 'q-rep' }, replace, h('span', { class: 'q-rep-text' }));
    const upd = () => { const has = sec.value && headings(own).some((x) => x.text === sec.value); repRow.hidden = !onInsert && has ? false : true; repRow.querySelector('.q-rep-text').textContent = ` 用引用替换本页“${sec.value}”一节现有的内容`; };
    sec.addEventListener('change', upd); upd();
    modal({
      title: `引用 ${target.xid || target.title}`,
      body: h('div', { class: 'form' },
        h('p', { class: 'muted' }, `${target.date || ''}　${target.title}`),
        h('label', { for: 'q-sec' }, '引用哪一节'), sec,
        h('label', { for: 'q-note' }, '说明（可改，例如：仅退火温度改为 150 °C）'), note,
        onInsert ? null : repRow, why.el,
        h('p', { class: 'muted' }, '引用不复制内容：页面上显示原页那一节的实时内容，加框、换字体，并链接回原实验。')),
      buttons: [{ label: '取消' }, {
        label: '引用', primary: true,
        run: async () => {
          const block = quoteBlock(target.xid || `${target.vol}/${target.num}`, sec.value, note.value.trim());
          if (onInsert) { onInsert(block); return; }
          if (!why.ok()) return false;
          try {
            await updatePage(curVol, curNum, ({ fm: f, body: b }) => ({ fm: f, body: sec.value && (replace.checked || !headings(b).some((x) => x.text === sec.value)) ? replaceSection(b, sec.value, block) : `${b.trimEnd()}\n\n${block}\n` }), `Quote ${target.xid || ref}`, why.value() || `引用 ${target.xid || ref}`);
            toast('已引用。');
          } catch (e) { toast(saveError(e)); return false; }
        },
      }],
    });
  });
}
