// Reagent, solution and protocol libraries.
import { todayISO } from './model.js';
import { renderInto } from './render.js';
import {
  LOCKED_REAGENT_KEYS, LOCKED_SOLUTION_KEYS, CODE_SRC, cleanAbbr, nextAliquotIds, REAGENTS_PATH, SOLUTIONS_PATH, SOLUTION_FIELDS, SOLUTION_STATUS, cleanProtocolId, loadProtocol,
  loadProtocols, loadReagents, loadSolutions, nextReagentId, nextSolutionId, parseProtocol, parseReagents, parseRecipe,
  protocolPath, reagentFields, reagentsCSV, recipeText, solutionFields,
} from './lab.js';
import { search } from './search.js';
import { h, icon } from './util.js';
import {
  S, confirmTyped, demoBanner, downloadText, field, lib, modal, saveError,
  show, signerName, thead, toast, topbar, view, viewMissing,
} from './core.js';
import { openNewExperiment } from './pages.js';
import { route } from './app.js';

// ----- reagent library -----
export async function viewReagents(initial = '') {
  const list = await loadReagents(lib);
  const fields = reagentFields(lib.notebook);
  const filter = h('input', { type: 'search', value: initial, placeholder: '按编号、中英文名、CAS、厂商、存放位置、订购者筛选', 'aria-label': '筛选' });
  const body = h('tbody');
  const today = todayISO();
  const usedBy = (id) => lib.allPages().filter((p) => (p.reagents || []).includes(id));
  const draw = () => {
    const q = filter.value.trim().toLowerCase();
    body.replaceChildren(...list.filter((r) => !q || Object.values(r).join(' ').toLowerCase().includes(q)).map((r) => {
      const n = usedBy(r.id).length;
      return h('tr', { onclick: () => editReagent(list, r) },
        fields.map(([k]) => h('td', { class: k === 'expires' && r.expires && r.expires < today ? 'warn' : null }, r[k] || '')),
        h('td', null, n ? h('a', { href: `#/search?q=${encodeURIComponent(r.id)}`, onclick: (e) => e.stopPropagation() }, `${n} 次`) : ''));
    }));
  };
  filter.addEventListener('input', draw); draw();
  const importIn = h('input', { type: 'file', accept: '.csv,text/csv', hidden: true, onchange: async (e) => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    const incoming = parseReagents(await f.text(), fields);
    if (!incoming.length) { toast('文件里没有读到试剂（第一行要是列名，必须有 id 列）。'); return; }
    const byId = new Map(list.map((r) => [r.id, r]));
    for (const r of incoming) byId.set(r.id, { ...(byId.get(r.id) || {}), ...r });
    await saveReagents([...byId.values()], `Import ${incoming.length} reagents`);
    toast(`已导入 ${incoming.length} 条。`); route();
  } });
  return h('div', { class: 'view library' },
    topbar({ back: '#/', backLabel: '首页', title: '试剂库', sub: `${list.length} 条`, actions: [
      h('button', { class: 'btn', type: 'button', onclick: () => editLibColumns('r', list) }, icon('table', 18), h('span', { class: 'wide-only' }, '管理列')),
      h('button', { class: 'btn danger', type: 'button', onclick: () => openLibBulkDelete('r', list) }, icon('trash', 18), h('span', { class: 'wide-only' }, '批量删除')),
      h('button', { class: 'btn primary', type: 'button', onclick: () => editReagent(list, null) }, icon('plus', 18), h('span', null, '新增试剂'))] }),
    demoBanner(),
    h('article', { class: 'sheet plain' },
      h('div', { class: 'search-row' }, filter,
        h('button', { class: 'btn', type: 'button', onclick: () => importIn.click() }, '导入 CSV'),
        h('button', { class: 'btn', type: 'button', onclick: () => downloadText('reagents.csv', `\uFEFF${reagentsCSV(list, fields)}`, 'text/csv') }, '导出 CSV'), importIn),
      h('div', { class: 'table-wrap tall' }, h('table', { class: 'data lib-table' }, thead([...fields.map(([, l]) => l), '使用']), body)),
      h('p', { class: 'muted' }, '点一行可修改。批号换了就新建一条（新编号），旧实验仍指向旧批号，保证可溯源。')));
}

// ----- lab-made solutions (S-0001): what went in, when, by whom, until when -----
export async function viewSolutions(initial = '') {
  const list = await loadSolutions(lib);
  const reagents = await loadReagents(lib).catch(() => []);
  const nameOf = (id) => reagents.find((r) => r.id === id)?.name || list.find((r) => r.id === id)?.name || '';
  const fields = solutionFields(lib.notebook);
  const filter = h('input', { type: 'search', value: initial, placeholder: '按编号、名称、组成、日期筛选', 'aria-label': '筛选' });
  const showAll = h('input', { type: 'checkbox', id: 'sl-all' });
  const body = h('tbody');
  const today = todayISO();
  const usedIn = (id) => search(lib.allPages(), id).length;
  const draw = () => {
    const q = filter.value.trim().toLowerCase();
    body.replaceChildren(...list.filter((r) => (showAll.checked || !['用完', '废弃'].includes(r.status)) && (!q || Object.values(r).join(' ').toLowerCase().includes(q)))
      .sort((a, b) => String(b.id).localeCompare(String(a.id))).map((r) => {
        const n = usedIn(r.id);
        // Known columns keep their own look; added columns show as plain text.
        const cell = (k) => {
          if (k === 'id') return h('td', { class: 'mono' }, r.id);
          if (k === 'name') return h('td', null, h('b', null, r.name));
          if (k === 'recipe') return h('td', null, parseRecipe(r.recipe).map((c) => h('div', { class: 'recipe-line' }, h('span', { class: 'rg-id', 'data-rid': c.id }, c.id), ` ${nameOf(c.id)} `, h('span', { class: 'qty' }, c.amount))));
          if (k === 'prepared') return h('td', { class: 'mono' }, r.prepared || '');
          if (k === 'expires') return h('td', { class: `mono${r.expires && r.expires < today ? ' warn' : ''}` }, r.expires || '');
          if (k === 'page') return h('td', null, r.page ? h('a', { href: `#/search?q=${encodeURIComponent(r.page)}`, onclick: (e) => e.stopPropagation() }, r.page) : '');
          if (k === 'status') return h('td', null, r.status || '在用');
          return h('td', null, r[k] || '');
        };
        return h('tr', { class: ['用完', '废弃'].includes(r.status) ? 'retired' : null, onclick: () => editSolution(list, r) },
          fields.map(([k]) => cell(k)),
          h('td', null, n ? h('a', { href: `#/search?q=${encodeURIComponent(r.id)}`, onclick: (e) => e.stopPropagation() }, `${n} 次`) : ''));
      }));
  };
  filter.addEventListener('input', draw); showAll.addEventListener('change', draw); draw();
  return h('div', { class: 'view library' },
    topbar({ back: '#/', backLabel: '首页', title: '溶液库', sub: `${list.length} 批`, actions: [
      h('button', { class: 'btn', type: 'button', onclick: () => editLibColumns('s', list) }, icon('table', 18), h('span', { class: 'wide-only' }, '管理列')),
      h('button', { class: 'btn danger', type: 'button', onclick: () => openLibBulkDelete('s', list) }, icon('trash', 18), h('span', { class: 'wide-only' }, '批量删除')),
      h('button', { class: 'btn', type: 'button', title: '从原瓶分装成小瓶，每瓶一个 A- 编号（例如 A-CB-01）', onclick: () => openAliquot(list) }, icon('plus', 18), h('span', null, '分装')),
      h('button', { class: 'btn primary', type: 'button', onclick: () => editSolution(list, null) }, icon('plus', 18), h('span', null, '登记新溶液'))] }),
    demoBanner(),
    h('article', { class: 'sheet plain' },
      h('div', { class: 'search-row' }, filter, h('label', { class: 'check', for: 'sl-all' }, showAll, ' 显示已用完/废弃'),
        h('button', { class: 'btn', type: 'button', onclick: () => downloadText('solutions.csv', `\uFEFF${reagentsCSV(list, solutionFields(lib.notebook))}`, 'text/csv') }, '导出 CSV')),
      h('div', { class: 'table-wrap tall' }, h('table', { class: 'data lib-table sol-table' }, thead([...fields.map(([, l]) => l), '使用']), body)),
      h('p', { class: 'muted' }, '分装的小瓶编号为 A-溶剂缩写-瓶号（例如 A-CB-01，A = aliquot 分装），点右上角“分装”一次登记多瓶。每配一批就登记一条（新编号），瓶签写 S-编号。步骤里选这个编号，就能从实验追到这批溶液、再追到每瓶试剂的批号。')));
}

// Aliquots: one source bottle → n small bottles A-CB-01, A-CB-02 …, each its own row so it can be cited and used up.
export async function openAliquot(list, preset = {}) {
  const reagents = await loadReagents(lib).catch(() => []);
  const dl = h('datalist', { id: 'al-src' }, reagents.map((x) => h('option', { value: x.id }, `${x.name}${x.spec ? ` · ${x.spec}` : ''}${x.location ? ` · ${x.location}` : ''}`)));
  const name = h('input', { id: 'al-name', value: preset.name || '', placeholder: '例如：氯苯 CB' });
  const abbr = h('input', { id: 'al-abbr', value: preset.abbr || '', placeholder: '例如 CB、ODCB、CF', autocapitalize: 'characters' });
  const src = h('input', { id: 'al-src-in', list: 'al-src', value: preset.src || '', placeholder: '原瓶 R-编号（可空，之后再填）' });
  const n = h('input', { id: 'al-n', type: 'number', min: 1, max: 20, value: preset.n || 2 });
  const vol = h('input', { id: 'al-vol', value: preset.volume || '5 mL', placeholder: '每瓶，例如 5 mL' });
  const where = h('input', { id: 'al-loc', value: preset.location || '', placeholder: '例如：有机液体柜 1-1' });
  const page = h('input', { id: 'al-page', value: preset.page || '', placeholder: '用于哪个实验（编号，可空）' });
  const st = h('select', { id: 'al-st' }, ['待配', '在用'].map((x) => h('option', { selected: (preset.status || '在用') === x }, x)));
  const out = h('p', { class: 'muted' });
  const show = () => { const a = cleanAbbr(abbr.value); out.textContent = a ? `将登记：${nextAliquotIds(list, a, Math.max(1, +n.value || 1)).join('、')}` : '填写缩写后显示编号。'; };
  for (const el of [abbr, n]) el.addEventListener('input', show); show();
  const lbl = (f, t) => h('label', { for: f }, t);
  modal({
    title: '分装', body: h('div', { class: 'form' }, dl,
      lbl('al-name', '名称'), name,
      h('div', { class: 'pair' }, h('div', null, lbl('al-abbr', '缩写（编号中间那段）'), abbr), h('div', null, lbl('al-src-in', '原瓶'), src)),
      h('div', { class: 'pair' }, h('div', null, lbl('al-n', '瓶数'), n), h('div', null, lbl('al-vol', '每瓶体积'), vol)),
      h('div', { class: 'pair' }, h('div', null, lbl('al-loc', '存放位置'), where), h('div', null, lbl('al-st', '状态'), st)),
      lbl('al-page', '用于实验'), page, out),
    buttons: [{ label: '取消' }, { label: '登记', primary: true, run: async () => {
      const a = cleanAbbr(abbr.value);
      if (!a || !name.value.trim()) { toast('写名称和缩写。'); return false; }
      const cur = await loadSolutions(lib).catch(() => []);
      const ids = nextAliquotIds(cur, a, Math.max(1, +n.value || 1));
      const s0 = src.value.trim().toUpperCase();
      const rows = ids.map((id) => ({ id, name: `${name.value.trim()}（分装）`, recipe: new RegExp(`^(${CODE_SRC})$`).test(s0) ? `${s0} × ${vol.value.trim()}` : '', conc: '', volume: vol.value.trim(), prepared: st.value === '在用' ? todayISO() : '', by: st.value === '在用' ? signerName() : '', expires: '', location: where.value.trim(), page: page.value.trim(), status: st.value, notes: s0 && !/^R-/.test(s0) ? `原瓶 ${s0}` : '' }));
      try {
        await lib.commit(`Aliquot ${ids.join(', ')}`, async (l) => {
          const now = l.tree.has(SOLUTIONS_PATH) ? await loadSolutions(l) : [];
          const next = [...now.filter((x) => !ids.includes(x.id)), ...rows].sort((x, y) => String(x.id).localeCompare(String(y.id)));
          return { changes: [{ path: SOLUTIONS_PATH, data: `\uFEFF${reagentsCSV(next, solutionFields(lib.notebook))}` }] };
        });
        toast(`已登记 ${ids.join('、')}。瓶签写这些编号。`);
        if (view.kind === 'library') route({ quiet: true });
      } catch (e) { toast(saveError(e)); return false; }
    } }],
  });
}

export function editSolution(list, s, preset = {}) {
  const isNew = !s;
  const r = s ? { ...s } : { id: nextSolutionId([...list, ...refIds('S')]), prepared: preset.prepared || todayISO(), by: signerName(), page: preset.page || '', status: '在用' };
  const reagents = [];
  const lists = h('datalist', { id: 'sol-ids' });
  loadReagents(lib).then((rs) => { reagents.push(...rs); lists.replaceChildren(...rs.map((x) => h('option', { value: x.id }, `${x.name}${x.lot ? ` · 批号 ${x.lot}` : ''}`)), ...list.filter((x) => x.id !== r.id).map((x) => h('option', { value: x.id }, `${x.name}（自配，${x.prepared || ''}）`))); drawRows(); }).catch(() => {});
  // Components: from the record, or from the page's steps (substances with an R-/S- number and their amounts).
  let rows = parseRecipe(r.recipe);
  if (!rows.length && preset.steps?.length) rows = preset.steps.map((st) => ({ id: (st.what.match(new RegExp(CODE_SRC)) || [''])[0], amount: st.amount })).filter((x) => x.id);
  if (!rows.length) rows = [{ id: '', amount: '' }];
  const rowsBox = h('div', { class: 'recipe-rows' });
  const nameFor = (id) => reagents.find((x) => x.id === id)?.name || list.find((x) => x.id === id)?.name || '';
  function drawRows() {
    rowsBox.replaceChildren(...rows.map((c, i) => h('div', { class: 'recipe-row' },
      h('input', { value: c.id, list: 'sol-ids', placeholder: 'R-0001 / S-0002', 'aria-label': '试剂或溶液编号', oninput: (e) => { c.id = e.target.value.trim().toUpperCase(); e.target.nextElementSibling.textContent = nameFor(c.id); } }),
      h('span', { class: 'recipe-name' }, nameFor(c.id)),
      h('input', { value: c.amount, placeholder: '1 mL / 10 µL / 50 mg', 'aria-label': '用量', oninput: (e) => { c.amount = e.target.value; } }),
      h('button', { class: 'btn icon small ghost', type: 'button', 'aria-label': '删除', onclick: () => { rows.splice(i, 1); drawRows(); } }, icon('close', 14)))),
    h('button', { class: 'btn small', type: 'button', onclick: () => { rows.push({ id: '', amount: '' }); drawRows(); } }, icon('plus', 14), '加一种成分'));
  }
  drawRows();
  const inputs = {};
  const cols = solutionFields(lib.notebook);
  const labelOf = (k, dflt) => cols.find(([c]) => c === k)?.[1] || dflt;
  const field = (k, label, attrs = {}) => {
    if (!cols.some(([c]) => c === k)) return [];
    inputs[k] = h('input', { id: `sol-${k}`, value: r[k] || '', ...attrs }); return [h('label', { for: `sol-${k}` }, labelOf(k, label)), inputs[k]];
  };
  const extra = cols.filter(([k]) => !SOLUTION_FIELDS.some(([d]) => d === k)).flatMap(([k, l]) => field(k, l));
  const status = h('select', { id: 'sol-status' }, SOLUTION_STATUS.map((x) => h('option', { selected: (r.status || '在用') === x }, x)));
  modal({
    title: isNew ? `登记溶液 ${r.id}` : `溶液 ${r.id}`, wide: true,
    body: h('div', { class: 'form two' },
      h('div', null,
        ...field('name', '名称', { placeholder: '例如：PEDOT:PSS 墨水（1 wt% GOPS）' }),
        h('span', { class: 'label' }, '组成（从试剂库/溶液库选编号，写用量）'), lists, rowsBox,
        ...field('conc', '浓度/配比', { placeholder: '例如：1 wt% GOPS / 10 mM' })),
      h('div', null,
        ...field('volume', '总量', { placeholder: '例如：5 mL' }),
        ...field('prepared', '配制日期', { type: 'date' }),
        ...field('by', '配制人'),
        ...field('expires', '有效期至', { type: 'date' }),
        ...field('location', '存放位置', { placeholder: '例如：4 °C 冰箱 第 2 层' }),
        ...field('page', '配制记录（实验编号）', { placeholder: '20261102-OECT-01' }),
        h('label', { for: 'sol-status' }, '状态'), status,
        ...field('notes', '备注'), ...extra)),
    buttons: [isNew ? null : { label: '删除', danger: true, run: () => { setTimeout(() => deleteLibEntries('s', [r.id]), 50); } }, { label: '取消' }, {
      label: '保存', primary: true,
      run: async () => {
        for (const k of Object.keys(inputs)) r[k] = inputs[k].value.trim();
        r.recipe = recipeText(rows); r.status = status.value;
        if (!r.name) { toast('写一个名称。'); return false; }
        try {
          await lib.commit(`${isNew ? 'Add' : 'Update'} solution ${r.id}`, async (l) => {
            const cur = l.tree.has(SOLUTIONS_PATH) ? await loadSolutions(l) : [];
            const next = [...cur.filter((x) => x.id !== r.id), r].sort((a, b) => String(a.id).localeCompare(String(b.id)));
            return { changes: [{ path: SOLUTIONS_PATH, data: `\uFEFF${reagentsCSV(next, solutionFields(lib.notebook))}` }] };
          });
          toast(`${r.id} 已保存。瓶签请写 ${r.id}。`);
          if (view.kind === 'library') route({ quiet: true });
        } catch (e) { toast(saveError(e)); return false; }
      },
    }],
  });
}

export async function saveReagents(list, message) {
  list.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return lib.commit(message, async () => ({ changes: [{ path: REAGENTS_PATH, data: `\uFEFF${reagentsCSV(list, reagentFields(lib.notebook))}` }] }));
}

// Both libraries keep their own column lists in notebook.json.
export const LIBS = {
  r: { name: '试剂库', unit: '试剂', path: REAGENTS_PATH, nbKey: 'reagentColumns', fields: () => reagentFields(lib.notebook), locked: LOCKED_REAGENT_KEYS, load: () => loadReagents(lib) },
  s: { name: '溶液库', unit: '溶液', path: SOLUTIONS_PATH, nbKey: 'solutionColumns', fields: () => solutionFields(lib.notebook), locked: LOCKED_SOLUTION_KEYS, load: () => loadSolutions(lib) },
};
// Rename, add, remove and reorder a library's columns.
export function editLibColumns(kind, list) {
  const L = LIBS[kind];
  const cols = L.fields().map(([k, l]) => ({ k, l }));
  const box = h('div', { class: 'col-list' });
  const draw = () => box.replaceChildren(...cols.map((c, i) => h('div', { class: 'col-row' },
    h('input', { value: c.l, 'aria-label': '列名', oninput: (e) => { c.l = e.target.value; } }),
    h('button', { class: 'btn icon small ghost', type: 'button', 'aria-label': '上移', disabled: i === 0, onclick: () => { cols.splice(i - 1, 0, cols.splice(i, 1)[0]); draw(); } }, '↑'),
    h('button', { class: 'btn icon small ghost', type: 'button', 'aria-label': '下移', disabled: i === cols.length - 1, onclick: () => { cols.splice(i + 1, 0, cols.splice(i, 1)[0]); draw(); } }, '↓'),
    L.locked.includes(c.k) ? h('span', { class: 'muted small lock' }, '必需')
      : h('button', { class: 'btn icon small ghost', type: 'button', 'aria-label': '删除这一列', onclick: () => { cols.splice(i, 1); draw(); } }, icon('close', 16)))));
  draw();
  const lockedNames = L.fields().filter(([k]) => L.locked.includes(k)).map(([, l]) => `“${l}”`).join('');
  modal({
    title: `管理${L.name}的列`,
    body: h('div', null,
      h('p', { class: 'muted' }, `改名直接改文字；↑↓ 调整顺序；× 删除这一列（这一列里填过的内容会一起删除，但 GitHub 历史里能找回）。${lockedNames}不能删。`),
      box,
      h('button', { class: 'btn small', type: 'button', onclick: () => { cols.push({ k: `c${Date.now().toString(36)}`, l: '新列' }); draw(); box.lastChild.querySelector('input').select(); } }, icon('plus', 16), '加一列')),
    buttons: [{ label: '取消' }, { label: '保存', primary: true, run: async () => {
      if (cols.some((c) => !c.l.trim())) { toast('列名不能为空。'); return false; }
      const removed = L.fields().filter(([k]) => !cols.some((c) => c.k === k));
      const lost = removed.filter(([k]) => list.some((r) => String(r[k] || '').trim()));
      if (lost.length && !window.confirm(`“${lost.map(([, l]) => l).join('、')}”里有填过的内容，会一起删除。确定吗？`)) return false;
      const fields = cols.map((c) => [c.k, c.l.trim()]);
      try {
        await lib.commit(`Change ${kind === 'r' ? 'reagent' : 'solution'} columns`, async (l) => {
          const nb = structuredClone(l.notebook);
          nb[L.nbKey] = fields;
          return {
            changes: [{ path: 'notebook.json', data: `${JSON.stringify(nb, null, 2)}\n` }, { path: L.path, data: `\uFEFF${reagentsCSV(list, fields)}` }],
            after: () => { l.notebook = nb; },
          };
        });
        toast('列已更新。'); setTimeout(() => route(), 300);
      } catch (e) { toast(saveError(e)); return false; }
    } }],
  });
}

// Numbers still written on pages count as taken, so a deleted entry's number is never handed out again.
export const refIds = (p) => [...new Set(lib.allPages().flatMap((x) => String(x.text || '').match(new RegExp(`\\b${p}-\\d{4}\\b`, 'g')) || []))].map((id) => ({ id }));
// Pages that mention a library entry (its number in the resources table, steps or text).
export const pagesUsing = (id) => search(lib.allPages(), id).map((r) => r.page);
// Remove entries from a library. Numbers are never reused, so old pages keep pointing at the right bottle.
export async function deleteLibEntries(kind, ids) {
  const L = LIBS[kind];
  const used = ids.map((id) => [id, pagesUsing(id).length]).filter(([, n]) => n);
  const word = ids.length === 1 ? ids[0] : '删除';
  const ok = await confirmTyped(`从${L.name}删除 ${ids.length} 条`,
    `${ids.length === 1 ? ids[0] : `${ids.slice(0, 6).join('、')}${ids.length > 6 ? ` 等 ${ids.length} 条` : ''}`}将从${L.name}删除。${used.length ? `其中 ${used.map(([id, n]) => `${id}（${n} 页用到）`).slice(0, 5).join('、')}${used.length > 5 ? ' 等' : ''}被实验页引用，删除后这些页面的资源表会显示“库里没有这个编号”。` : '没有实验页引用它们。'}编号不会被重新使用；GitHub 历史里可以找回。`,
    word, '删除');
  if (!ok) return false;
  const gone = new Set(ids);
  try {
    await lib.commit(`Delete ${ids.length} ${kind === 'r' ? 'reagent' : 'solution'}${ids.length > 1 ? 's' : ''}`, async (l) => {
      const cur = await (kind === 'r' ? loadReagents(l) : loadSolutions(l));
      return { changes: [{ path: L.path, data: `\uFEFF${reagentsCSV(cur.filter((x) => !gone.has(x.id)), L.fields())}` }] };
    });
    toast(`已删除 ${ids.length} 条。`); setTimeout(() => route({ quiet: true }), 300);
    return true;
  } catch (e) { toast(saveError(e)); return false; }
}
// Tick entries (or everything matching a search) and delete them together.
export function openLibBulkDelete(kind, list) {
  const L = LIBS[kind];
  const picked = new Set();
  const q = h('input', { type: 'search', placeholder: '筛选：编号、名称、CAS、位置、状态…', autocomplete: 'off' });
  const box = h('div', { class: 'pick-list' });
  const count = h('span', { class: 'muted' });
  const match = () => { const t = q.value.trim().toLowerCase(); return list.filter((x) => !t || Object.values(x).join(' ').toLowerCase().includes(t)); };
  const draw = () => {
    const rows = match();
    box.replaceChildren(...rows.slice(0, 300).map((x) => h('label', { class: 'check' },
      h('input', { type: 'checkbox', checked: picked.has(x.id), onchange: (e) => { if (e.target.checked) picked.add(x.id); else picked.delete(x.id); count.textContent = `已选 ${picked.size} 条`; } }),
      ' ', h('span', { class: 'c-date' }, x.id), ' ', x.name, h('span', { class: 'muted' }, [x.cas, x.conc, x.location, x.status].filter(Boolean).map((v) => ` · ${v}`).join(''))))
      , ...(rows.length > 300 ? [h('p', { class: 'muted' }, `只显示前 300 条，共 ${rows.length} 条；“全选筛选结果”会选中全部 ${rows.length} 条。`)] : []));
    count.textContent = `已选 ${picked.size} 条`;
  };
  q.addEventListener('input', draw); draw();
  modal({
    title: `批量删除 · ${L.name}`, wide: true,
    body: h('div', { class: 'form' },
      q,
      h('div', { class: 'row-actions' },
        h('button', { class: 'btn small', type: 'button', onclick: () => { match().forEach((x) => picked.add(x.id)); draw(); } }, '全选筛选结果'),
        h('button', { class: 'btn small', type: 'button', onclick: () => { picked.clear(); draw(); } }, '全不选'), count),
      box,
      h('p', { class: 'muted' }, `不筛选时“全选筛选结果”= 清空整个${L.name}。`)),
    buttons: [{ label: '取消' }, { label: '删除所选', danger: true, run: () => {
      if (!picked.size) { toast('至少勾选一条。'); return false; }
      setTimeout(() => deleteLibEntries(kind, [...picked]), 50);
    } }],
  });
}

export function editReagent(list, r) {
  const isNew = !r;
  const cur = r ? { ...r } : { id: nextReagentId([...list, ...refIds('R')]) };
  const fields = reagentFields(lib.notebook);
  const inputs = Object.fromEntries(fields.map(([k]) => [k, h('input', {
    id: `rg-${k}`, value: cur[k] || '', type: k === 'opened' || k === 'expires' ? 'date' : 'text', readonly: k === 'id' && !isNew,
  })]));
  modal({
    title: isNew ? '新增试剂' : `修改 ${cur.id}`,
    body: h('div', { class: 'form grid2' }, fields.map(([k, l]) => h('div', null, h('label', { for: `rg-${k}` }, l), inputs[k]))),
    buttons: [
      isNew ? null : { label: '删除', danger: true, run: () => { setTimeout(() => deleteLibEntries('r', [cur.id]), 50); } },
      isNew ? null : { label: '用新批号复制', run: () => { setTimeout(() => editReagent(list, null), 0); setTimeout(() => { for (const [k] of fields) if (!['id', 'lot', 'opened', 'expires'].includes(k)) { const el = document.getElementById(`rg-${k}`); if (el) el.value = cur[k] || ''; } }, 60); } },
      { label: '取消' },
      { label: '保存', primary: true, run: async () => {
        const next = { ...(cur || {}), ...Object.fromEntries(fields.map(([k]) => [k, inputs[k].value.trim()])) };
        if (!next.id || !next.name) { toast('编号和名称不能为空。'); return false; }
        if (isNew && list.some((x) => x.id === next.id)) { toast('这个编号已经有了。'); return false; }
        const all = isNew ? [...list, next] : list.map((x) => (x.id === cur.id ? next : x));
        try { await saveReagents(all, `${isNew ? 'Add' : 'Update'} reagent ${next.id}`); toast('已保存。'); route(); } catch (e) { toast(saveError(e)); return false; }
      } },
    ].filter(Boolean),
  });
}

// ----- protocol library -----
export async function viewProtocols() {
  const list = await loadProtocols(lib);
  const importIn = h('input', { type: 'file', accept: '.md,text/markdown', multiple: true, hidden: true, onchange: async (e) => {
    const files = [...e.target.files]; e.target.value = '';
    const changes = [];
    for (const f of files) {
      const text = await f.text();
      const p = parseProtocol(text);
      const id = cleanProtocolId(p.id || f.name.replace(/\.md$/i, ''));
      if (id) changes.push({ path: protocolPath(id), data: text });
    }
    if (!changes.length) return;
    try { await lib.commit(`Import ${changes.length} protocols`, async () => ({ changes })); toast(`已导入 ${changes.length} 个 SOP。`); route(); } catch (err) { toast(saveError(err)); }
  } });
  return h('div', { class: 'view library' },
    topbar({ back: '#/', backLabel: '首页', title: '步骤库（SOP）', sub: `${list.length} 个`, actions: [
      h('button', { class: 'btn', type: 'button', onclick: () => importIn.click() }, '导入 .md'), importIn,
      h('button', { class: 'btn primary', type: 'button', onclick: () => editProtocol(null) }, icon('plus', 18), h('span', null, '新建 SOP'))] }),
    demoBanner(),
    h('article', { class: 'sheet plain' },
      list.length ? h('table', { class: 'data lib-table' }, thead(['编号', '名称', '版本', '试剂', '用过']),
        h('tbody', null, list.map((p) => h('tr', { onclick: () => { location.hash = `#/lib/protocols/${encodeURIComponent(p.id)}`; } },
          h('td', null, p.id), h('td', null, p.title), h('td', null, p.version), h('td', null, p.reagents.join(' ')),
          h('td', null, `${lib.allPages().filter((x) => x.protocol === p.id).length} 次`)))))
        : h('p', { class: 'muted' }, '还没有 SOP。点“导入 .md”导入预置的步骤库，或者新建。'),
      h('p', { class: 'muted' }, 'SOP 改版时请新建一个带新版本号的编号（例如 …-v3），不要改旧的：旧实验仍然指向当时用的版本。')));
}

export async function viewProtocol(id) {
  const p = await loadProtocol(lib, id);
  if (!p) return viewMissing(`步骤库里没有 ${id}。`);
  const body = h('div', { class: 'prose' });
  await renderInto(body, p.body, { lib, vol: null, num: null, urls: view.urls, resolveBlob: async () => { throw new Error('no attachments'); } });
  const uses = lib.allPages().filter((x) => x.protocol === p.id).sort((a, b) => String(b.date).localeCompare(String(a.date)));
  return h('div', { class: 'view library' },
    topbar({ back: '#/lib/protocols', backLabel: '步骤库', title: p.id, sub: p.version, actions: [
      h('button', { class: 'btn', type: 'button', onclick: () => editProtocol(p) }, icon('edit', 18), h('span', null, '修改')),
      h('button', { class: 'btn primary', type: 'button', onclick: () => openNewExperiment('').then(() => { const s = document.getElementById('ne-proto'); if (s) { s.value = p.id; s.dispatchEvent(new Event('change')); } }) }, '用它新建实验')] }),
    demoBanner(),
    h('article', { class: 'sheet plain' },
      h('h1', null, p.title),
      h('p', { class: 'muted' }, [p.version && `版本 ${p.version}`, p.source && `原始文件 ${p.source}`].filter(Boolean).join(' · ')),
      p.reagents.length ? h('p', null, h('b', null, '试剂 '), p.reagents.join('、')) : null,
      p.variables.length ? h('p', null, h('b', null, '常变条件 '), p.variables.join('、')) : null,
      p.results.length ? h('p', null, h('b', null, '结果 '), p.results.join('、')) : null,
      body,
      uses.length ? h('section', null, h('h2', null, '用过这个 SOP 的实验'), h('ol', { class: 'ledger-rows' }, uses.map((x) => h('li', null, h('a', { href: `#/v/${x.vol}/${x.num}` },
        h('span', { class: 'l-date' }, x.date), h('span', { class: 'l-title' }, x.title), h('span', { class: 'l-where' }, x.xid || '')))))) : null));
}

export function editProtocol(p) {
  const tpl = p ? null : '---\nid: SOP-NEW-v1\ntitle: \nversion: v1\nsource: \nreagents: []\nvariables: []\nresults: []\ntags: []\n---\n\n## 步骤\n\n1. \n';
  const ta = h('textarea', { class: 'editor-text', rows: 22, spellcheck: 'false' });
  const load = p ? lib.readText(protocolPath(p.id)) : Promise.resolve(tpl);
  load.then((t) => { ta.value = t; });
  modal({
    title: p ? `修改 ${p.id}` : '新建 SOP', wide: true,
    body: h('div', null, h('p', { class: 'muted' }, '开头 --- 之间是信息：id 编号、title 名称、version 版本、source 原始 PDF 路径、reagents 常用试剂编号、variables 常变条件、results 要记录的结果。下面是步骤正文（Markdown）。'), ta),
    buttons: [{ label: '取消' }, { label: '保存', primary: true, run: async () => {
      const np = parseProtocol(ta.value);
      const id = cleanProtocolId(np.id);
      if (!id) { toast('id 不能为空。'); return false; }
      const changes = [{ path: protocolPath(id), data: ta.value }];
      if (p && p.id !== id) changes.push({ path: protocolPath(p.id), delete: true });
      try { await lib.commit(`${p ? 'Update' : 'Add'} protocol ${id}`, async () => ({ changes })); toast('已保存。'); location.hash = `#/lib/protocols/${encodeURIComponent(id)}`; route(); } catch (e) { toast(saveError(e)); return false; }
    } }],
  });
}
