// Method cards (methods/M-0001.json): exact details for the Experimental section, with parameter versions.
import { fmtDate, nowISO } from './model.js';
import { renderInto } from './render.js';
import { METHOD_CAT, METHOD_STATUS, loadMethod, loadMethods, methodIds, methodPath, nextMethodId, paramDiff, paramsChanged } from './lab.js';
import { search } from './search.js';
import { h, icon, loadScript } from './util.js';
import { choose, copyText, demoBanner, downloadText, lib, modal, prepareFile, saveError, show, toast, topbar, view, viewMissing } from './core.js';
import { hero } from './home.js';
import { route } from './app.js';

// ----- method cards: per-volume archive of exact details, versioned, exportable to a Methods draft -----
export const methodCount = (vol) => (methodCache.list || []).filter((m) => m.vol === vol).length;
// Volume top bar button; the count fills in once the cards are loaded.
export function methodsBtn(vol) {
  const n = h('span', null, '方法细节');
  const show = () => { const k = methodCount(vol); n.textContent = k ? `方法细节 ${k}` : '方法细节'; };
  if (methodCache.list) show(); else allMethods().then(show);
  return h('a', { class: 'btn', href: `#/v/${vol}/methods`, title: '这个课题的方法细节（写论文 Experimental 用）' }, icon('list', 18), n);
}
export const methodCache = { list: null };
export async function allMethods() { methodCache.list = await loadMethods(lib).catch(() => []); return methodCache.list; }
export const curParams = (m) => m.params || [];
export async function saveMethod(m, message, files = []) {
  m.updated = nowISO();
  await lib.commit(message, async () => ({ changes: [{ path: methodPath(m.id), data: `${JSON.stringify(m, null, 1)}\n` }, ...files] }));
  methodCache.list = null;
}
export const methodCtx = () => ({ lib, vol: null, num: null, urls: view.urls, resolveBlob: (name) => lib.readBlob(name.replace(/^\/+/, '')) });

export async function viewMethods(vol) {
  const v = vol ? lib.volume(vol) : null;
  if (vol && !v) return viewMissing('笔记本里没有这个卷。');
  const all = await allMethods();
  const list = vol ? all.filter((m) => m.vol === vol) : all;
  const q = h('input', { type: 'search', placeholder: '搜索：标题、正文、参数、标签', 'aria-label': '搜索' });
  const st = h('select', { 'aria-label': '状态' }, h('option', { value: '' }, '全部状态'), METHOD_STATUS.map((x) => h('option', { value: x }, x)));
  const body = h('div', { class: 'm-groups' });
  const draw = () => {
    const t = q.value.trim().toLowerCase();
    const hit = list.filter((m) => (!st.value || (m.status || '待写入') === st.value)
      && (!t || `${m.id} ${m.title} ${m.body} ${(m.tags || []).join(' ')} ${curParams(m).map((p) => `${p.k} ${p.v}`).join(' ')}`.toLowerCase().includes(t)));
    const cats = [...METHOD_CAT, ...new Set(hit.map((m) => m.cat).filter((c) => !METHOD_CAT.includes(c)))];
    body.replaceChildren(...(hit.length ? cats.map((c) => [c, hit.filter((m) => (m.cat || '其他') === c)]).filter(([, ms]) => ms.length).map(([c, ms]) => h('section', { class: 'm-group' },
      h('h2', { class: 'm-cat' }, c, h('span', null, `${ms.length}`)),
      h('div', { class: 'm-grid' }, ms.sort((a, b) => a.id.localeCompare(b.id)).map((m) => h('a', { class: `tile m-card st-${m.status || '待写入'}`, href: `#/m/${m.id}` },
        h('div', { class: 'm-top' }, h('span', { class: 'xid-tag' }, m.id), h('span', { class: 'm-status' }, m.status || '待写入'), (m.versions || []).length > 1 ? h('span', { class: 'm-ver' }, `v${m.versions.length}`) : null),
        h('h3', null, m.title),
        curParams(m).length ? h('dl', { class: 'm-params' }, curParams(m).slice(0, 4).map((p) => [h('dt', null, p.k), h('dd', null, p.v)])) : h('p', { class: 'muted' }, String(m.body || '').replace(/[#*>`!\[\]()]/g, '').slice(0, 80)),
        !vol && m.vol ? h('span', { class: 'm-vol' }, lib.volume(m.vol)?.title || m.vol) : null)))))
      : [h('div', { class: 'tile empty-m' }, h('p', null, list.length ? '没有符合条件的卡片。' : '还没有方法卡片。'), h('p', { class: 'muted' }, '每张卡片记一个细节：例如“伤口床 ROI 如何圈定”“调色对比度”“ImageJ 阈值方法”。写论文时可以一键汇总成 Experimental 初稿。'))]));
  };
  q.addEventListener('input', draw); st.addEventListener('change', draw); draw();
  const todo = list.filter((m) => (m.status || '待写入') === '待写入').length;
  return h('div', { class: 'view methods' },
    topbar({ back: vol ? `#/v/${vol}` : '#/', backLabel: vol ? v.title : '首页', title: vol ? `方法细节 · ${v.title}` : '全部方法卡片', sub: `${list.length} 张 · ${todo} 张待写入论文`, actions: [
      vol ? h('a', { class: 'btn ghost', href: '#/methods' }, h('span', { class: 'wide-only' }, '全部卷')) : null,
      h('button', { class: 'btn', type: 'button', onclick: () => openMethodsExport(vol, list) }, icon('download', 18), h('span', { class: 'wide-only' }, '生成 Experimental 初稿')),
      h('button', { class: 'btn primary', type: 'button', onclick: () => editMethod(null, vol) }, icon('plus', 18), h('span', null, '新建卡片'))].filter(Boolean) }),
    demoBanner(),
    h('div', { class: 'm-wrap' }, h('div', { class: 'search-row' }, q, st), body));
}

export async function viewMethod(id) {
  const m = await loadMethod(lib, id).catch(() => null);
  if (!m) return viewMissing(`没有方法卡片 ${id}。`);
  const desc = h('div', { class: 'prose m-body' });
  if (m.body) renderInto(desc, m.body, methodCtx());
  const used = search(lib.allPages(), id).map((r) => r.page).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const vs = m.versions || [];
  const setStatus = async (x) => { const c = structuredClone(await loadMethod(lib, id)); c.status = x; try { await saveMethod(c, `${id}: ${x}`); route({ quiet: true }); } catch (e) { toast(saveError(e)); } };
  return h('div', { class: 'view methods' },
    topbar({ back: m.vol ? `#/v/${m.vol}/methods` : '#/methods', backLabel: '方法细节', title: m.id, sub: lib.volume(m.vol)?.title || '', actions: [
      h('button', { class: 'btn', type: 'button', onclick: () => copyText(`${m.id}（${m.title}）`) }, h('span', null, '复制引用')),
      h('button', { class: 'btn primary', type: 'button', onclick: () => editMethod(m, m.vol) }, icon('edit', 18), h('span', null, '修改'))] }),
    demoBanner(),
    h('div', { class: 'm-wrap m-one' },
      h('header', { class: 'm-hero' },
        h('p', { class: 'hero-eyebrow' }, `${m.cat || '其他'} · ${m.id}${vs.length ? ` · v${vs.length}` : ''}`),
        h('h1', { class: 'hero-title' }, m.title),
        h('div', { class: 'seg m-status-seg', role: 'radiogroup', 'aria-label': '论文状态' }, METHOD_STATUS.map((x) => h('button', { type: 'button', class: `seg-btn${(m.status || '待写入') === x ? ' on' : ''}`, onclick: () => setStatus(x) }, x))),
        (m.tags || []).length ? h('p', { class: 'm-tags' }, m.tags.map((t) => `#${t}`).join('  ')) : null),
      h('div', { class: 'm-cols' },
        h('div', null,
          h('section', { class: 'tile' }, h('h2', null, '做法'), m.body ? desc : h('p', { class: 'muted' }, '还没写。')),
          curParams(m).length ? h('section', { class: 'tile' }, h('h2', null, '参数', h('span', { class: 'h-sub' }, vs.length ? `当前 v${vs.length}` : '')),
            h('table', { class: 'm-ptable' }, h('tbody', null, curParams(m).map((p) => h('tr', null, h('th', null, p.k), h('td', null, p.v)))))) : null),
        h('div', null,
          h('section', { class: 'tile' }, h('h2', null, '版本记录'),
            vs.length ? h('ol', { class: 'hist-list m-vers' }, [...vs].reverse().map((x, i) => h('li', null,
              h('b', null, `v${x.v}`), h('span', { class: 'ev-date' }, ` ${fmtDate(x.at)}`), x.since ? h('span', { class: 'muted' }, ` · 自 ${x.since} 起`) : null,
              h('div', null, x.note || ''),
              i < vs.length - 1 ? h('div', { class: 'muted small' }, paramDiff(vs[vs.length - 2 - i]?.params, x.params)) : null))) : h('p', { class: 'muted' }, '参数改动时会自动记一版。')),
          h('section', { class: 'tile' }, h('h2', null, '用到的实验'),
            used.length ? h('ul', { class: 'rel-list' }, used.map((p) => h('li', null, h('a', { href: `#/v/${p.vol}/${p.num}` }, h('span', { class: 'ev-date' }, fmtDate(p.date)), ' ', p.xid ? h('span', { class: 'xid-tag' }, p.xid) : null, ' ', p.title))))
              : h('p', { class: 'muted' }, `在实验页正文或步骤里写 ${m.id}（编辑页工具栏“方法”），就会列在这里。`))))));
}

export function editMethod(m, vol) {
  const isNew = !m;
  const x = m ? structuredClone(m) : { vol: vol || '', cat: '图像分析', status: '待写入', tags: [], params: [], versions: [] };
  const files = [];
  const title = h('input', { id: 'me-title', value: x.title || '', placeholder: '例如：伤口床 ROI 圈定方法' });
  const cat = h('select', { id: 'me-cat' }, METHOD_CAT.map((c) => h('option', { selected: x.cat === c }, c)));
  const vsel = h('select', { id: 'me-vol' }, h('option', { value: '' }, '（不属于某个卷）'), lib.volumes().map((v) => h('option', { value: v.id, selected: x.vol === v.id }, v.title)));
  const tags = h('input', { id: 'me-tags', value: (x.tags || []).join(', '), placeholder: '逗号分隔，例如 ImageJ, 伤口愈合' });
  const body = h('textarea', { id: 'me-body', rows: 9, class: 'mono-area', placeholder: '做法（Markdown）。可以直接粘贴截图。\n例如：在 ImageJ 中用 Freehand 工具沿创面边缘…' }, x.body || '');
  const params = (x.params || []).map((p) => ({ ...p }));
  if (!params.length) params.push({ k: '', v: '' });
  const pbox = h('div', { class: 'recipe-rows' });
  const drawP = () => pbox.replaceChildren(...params.map((p, i) => h('div', { class: 'recipe-row m-prow' },
    h('input', { value: p.k, placeholder: '参数，例如 对比度', oninput: (e) => { p.k = e.target.value; } }),
    h('input', { value: p.v, placeholder: '值，例如 1.2（Brightness/Contrast 自动后 +20%）', oninput: (e) => { p.v = e.target.value; } }),
    h('button', { class: 'btn icon small ghost', type: 'button', 'aria-label': '删除', onclick: () => { params.splice(i, 1); drawP(); } }, icon('close', 14)))),
  h('button', { class: 'btn small', type: 'button', onclick: () => { params.push({ k: '', v: '' }); drawP(); } }, icon('plus', 14), '加一个参数'));
  drawP();
  const since = h('input', { id: 'me-since', placeholder: '可选：从哪个实验开始用新参数，例如 20261105-BHJ-01' });
  const note = h('input', { id: 'me-note', placeholder: isNew ? '初版' : '可选：为什么改，例如 原阈值把痂皮算进创面' });
  // Pasted screenshots are uploaded with the card and linked into the text.
  body.addEventListener('paste', async (e) => {
    const f0 = [...(e.clipboardData?.files || [])].find((f) => f.type.startsWith('image/'));
    if (!f0) return;
    e.preventDefault();
    const id = x.id || '__new__';
    const f = await prepareFile(f0);
    const name = `img-${Date.now().toString(36)}.${(f.type.split('/')[1] || 'png').replace('jpeg', 'jpg')}`;
    files.push({ name, data: f });
    body.setRangeText(`\n![截图](/methods/attachments/${id}/${name})\n`, body.selectionStart, body.selectionEnd, 'end');
    toast('截图已加入，保存卡片时一起上传。');
  });
  const lbl = (f, t) => h('label', { for: f }, t);
  modal({
    title: isNew ? '新建方法卡片' : `修改 ${x.id}`, wide: true,
    body: h('div', { class: 'form' },
      lbl('me-title', '标题'), title,
      h('div', { class: 'pair' }, h('div', null, lbl('me-cat', '分类（论文 Methods 小节）'), cat), h('div', null, lbl('me-vol', '所属卷（课题）'), vsel)),
      lbl('me-body', '做法'), body,
      h('span', { class: 'label' }, '参数（改动会自动记一版）'), pbox,
      h('div', { class: 'pair' }, h('div', null, lbl('me-since', '自哪个实验起'), since), h('div', null, lbl('me-note', '修改说明'), note)),
      lbl('me-tags', '标签'), tags),
    buttons: [isNew ? null : { label: '删除', danger: true, run: async () => {
      if ((await choose(`删除 ${x.id}？`, '实验页里写的编号会变成“找不到”。GitHub 历史里可以找回。', [['yes', '删除'], ['no', '取消']])) !== 'yes') return false;
      try { await lib.commit(`Delete method ${x.id}`, async () => ({ changes: [{ path: methodPath(x.id), delete: true }] })); methodCache.list = null; location.hash = x.vol ? `#/v/${x.vol}/methods` : '#/methods'; } catch (e) { toast(saveError(e)); return false; }
    } }, { label: '取消' }, {
      label: '保存', primary: true,
      run: async () => {
        if (!title.value.trim()) { toast('写一个标题。'); return false; }
        if (isNew) x.id = nextMethodId(methodIds(lib));
        const ps = params.map((p) => ({ k: p.k.trim(), v: p.v.trim() })).filter((p) => p.k || p.v);
        x.body = body.value.replaceAll('/methods/attachments/__new__/', `/methods/attachments/${x.id}/`);
        Object.assign(x, { title: title.value.trim(), cat: cat.value, vol: vsel.value, tags: tags.value.split(/[,，]/).map((t) => t.trim()).filter(Boolean) });
        if (isNew || paramsChanged(x.params, ps)) x.versions = [...(x.versions || []), { v: (x.versions || []).length + 1, at: nowISO(), since: since.value.trim(), note: note.value.trim() || (isNew ? '初版' : ''), params: ps }];
        x.params = ps;
        if (isNew) x.created = nowISO();
        const adds = files.map((f) => ({ path: `methods/attachments/${x.id}/${f.name}`, data: f.data }));
        try { await saveMethod(x, `${isNew ? 'Add' : 'Update'} method ${x.id}`, adds); toast(`${x.id} 已保存。`); location.hash = `#/m/${x.id}`; route({ quiet: true }); } catch (e) { toast(saveError(e)); return false; }
      },
    }],
  });
  setTimeout(() => title.focus(), 50);
}

// Picker used by the page editor: cards of this volume first.
export async function pickMethod(vol, onPick) {
  const all = (await allMethods()).sort((a, b) => Number(b.vol === vol) - Number(a.vol === vol) || a.id.localeCompare(b.id));
  if (!all.length) { toast('还没有方法卡片。先在卷目录页右上角“方法细节”里新建。'); return; }
  const q = h('input', { type: 'search', placeholder: '搜索方法卡片', autocomplete: 'off' });
  const box = h('div', { class: 'mt-hits' });
  let dlg = null;
  const draw = () => { const t = q.value.trim().toLowerCase(); box.replaceChildren(...all.filter((m) => !t || `${m.id} ${m.title} ${m.cat}`.toLowerCase().includes(t)).slice(0, 40).map((m) => h('button', { type: 'button', class: 'mt-hit', onclick: () => { onPick(m); dlg?.close(); } }, h('span', { class: 'xid-tag' }, m.id), ' ', h('b', null, m.title), h('span', { class: 'muted' }, ` · ${m.cat}${m.vol !== vol ? ` · ${lib.volume(m.vol)?.title || ''}` : ''}`)))); };
  q.addEventListener('input', draw); draw();
  dlg = modal({ title: '引用方法卡片', body: h('div', { class: 'form' }, q, box), buttons: [{ label: '取消' }] });
  setTimeout(() => q.focus(), 50);
}

// Methods draft: cards grouped by category into Markdown or Word, ready to edit into the paper.
export function openMethodsExport(vol, list) {
  const scope = h('select', { id: 'mx-scope' }, h('option', { value: 'todo' }, '只要“待写入”'), h('option', { value: 'all' }, '“待写入”和“已写入”'));
  const mark = h('input', { type: 'checkbox', id: 'mx-mark', checked: true });
  const pick = () => list.filter((m) => (scope.value === 'all' ? (m.status || '待写入') !== '不写入' : (m.status || '待写入') === '待写入'));
  const groups = (ms) => METHOD_CAT.concat([...new Set(ms.map((m) => m.cat))].filter((c) => !METHOD_CAT.includes(c))).map((c) => [c, ms.filter((m) => (m.cat || '其他') === c)]).filter(([, g]) => g.length);
  const plain = (md) => String(md || '').replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\*\*|__|==|\+\+|\{\{|\}\}/g, '').trim();
  const pline = (m) => curParams(m).map((p) => `${p.k} ${p.v}`).join('; ');
  const title = vol ? `Experimental · ${lib.volume(vol)?.title || vol}` : 'Experimental';
  const finish = async (ms) => {
    if (!mark.checked) return;
    const todo = ms.filter((m) => (m.status || '待写入') === '待写入');
    if (!todo.length) return;
    try {
      await lib.commit(`Methods draft: mark ${todo.length} written`, async () => ({ changes: todo.map((m) => ({ path: methodPath(m.id), data: `${JSON.stringify({ ...m, status: '已写入', updated: nowISO() }, null, 1)}\n` })) }));
      methodCache.list = null; route({ quiet: true });
    } catch (e) { toast(saveError(e)); }
  };
  const md = (ms) => [`# ${title}`, '', ...groups(ms).flatMap(([c, g]) => [`## ${c}`, '', ...g.flatMap((m) => [`### ${m.title}`, '', plain(m.body), '', ...(curParams(m).length ? [`Parameters: ${pline(m)}.`, ''] : []), `<!-- ${m.id} v${(m.versions || []).length || 1} -->`, ''])])].join('\n');
  modal({
    title: '生成 Experimental 初稿',
    body: h('div', { class: 'form' },
      h('label', { for: 'mx-scope' }, '包括哪些卡片'), scope,
      h('label', { class: 'check', for: 'mx-mark' }, mark, ' 导出后把“待写入”标为“已写入”'),
      h('p', { class: 'muted' }, '按分类（材料制备 / 器件制备 / 动物实验 / 图像分析 / 统计分析…）排成 Methods 小节；每张卡片一段，参数列在段尾。截图不进初稿，需要时到卡片里看。')),
    buttons: [{ label: '取消' },
      { label: '导出 Markdown', run: async () => { const ms = pick(); if (!ms.length) { toast('没有符合条件的卡片。'); return false; } downloadText(`${title}.md`, md(ms), 'text/markdown'); await finish(ms); } },
      { label: '导出 Word', primary: true, run: async () => {
        const ms = pick(); if (!ms.length) { toast('没有符合条件的卡片。'); return false; }
        await loadScript('vendor/docx.umd.js');
        const D = window.docx; const font = { ascii: 'Times New Roman', hAnsi: 'Times New Roman', eastAsia: '等线' };
        const P = (text, o = {}) => new D.Paragraph({ spacing: { after: 120 }, ...o.para, children: [new D.TextRun({ text, font, size: o.size || 22, bold: o.bold, italics: o.italics, color: o.color })] });
        const children = [new D.Paragraph({ heading: D.HeadingLevel.HEADING_1, children: [new D.TextRun({ text: title, font })] })];
        for (const [c, g] of groups(ms)) {
          children.push(new D.Paragraph({ heading: D.HeadingLevel.HEADING_2, children: [new D.TextRun({ text: c, font })] }));
          for (const m of g) {
            children.push(new D.Paragraph({ heading: D.HeadingLevel.HEADING_3, children: [new D.TextRun({ text: m.title, font })] }));
            for (const line of plain(m.body).split(/\n+/).map((x) => x.replace(/^#+\s*/, '').trim()).filter(Boolean)) children.push(P(line));
            if (curParams(m).length) children.push(P(`Parameters: ${pline(m)}.`, { italics: true }));
            children.push(P(`[${m.id} v${(m.versions || []).length || 1}]`, { size: 16, color: '999999' }));
          }
        }
        const blob = await D.Packer.toBlob(new D.Document({ sections: [{ properties: { page: { margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } } }, children }] }));
        const a = h('a', { href: URL.createObjectURL(blob), download: `${title}.docx` }); document.body.append(a); a.click(); a.remove();
        await finish(ms);
      } }],
  });
}
