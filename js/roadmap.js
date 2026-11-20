// 候选清单 and 长期目标.
// 候选清单: under a 课题, named lists of things to try (e.g. 可双光子打印的有机聚合物半导体: BBL, p(g2T-TT), P-90, PTHS),
//   each with where it stands and, once tried, the 实验主题 that holds its experiments.
// 长期目标: the applications to get to in the end (反相器, 逻辑电路, 光电传感器 …), with the next step and how long
//   since it last moved, grouped into 目标集合 (e.g. 双光子 P3HT 打印应用) shown as the last part of 课题手记:
//   one card per set, click it to open its goals.
// All live in planner/tasks.json: `cands`, `aims` (each with `set`) and `aimSets`.
import { nowISO, todayISO, zoned } from './model.js';
import { daysFrom } from './lab.js';
import { h, icon, isImeEvent, replaceAround } from './util.js';
import { choose, menu, modal, toast } from './core.js';
import { changePlanner, freshId } from './planner.js';
import { LOOSE_COLOR, pinTopicsIn, topicsOf } from './finds.js';
import { allSeries } from './pages.js';

const rid = (p) => freshId(() => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`);

// ---------- 候选清单 ----------
export const CAND_STAGES = [
  ['todo', '待调研', '#8e8e93'],
  ['get', '待购 / 待合成', '#c77c02'],
  ['have', '已到手', '#0a84ff'],
  ['try', '在试', '#5e5ce6'],
  ['ok', '可行', '#30a46c'],
  ['no', '不可行', '#e5484d'],
];
const STAGE = Object.fromEntries(CAND_STAGES.map(([k, l, c]) => [k, { label: l, color: c }]));
const stageOf = (c) => STAGE[c.stage] ? c.stage : 'todo';

function seriesInfo(name) {
  const s = name ? allSeries().find((x) => x.name === name) : null;
  if (!s) return null;
  const ps = s.pages.filter((p) => !p.void);
  return { n: ps.length, ok: ps.filter((p) => p.outcome === 'ok').length, fail: ps.filter((p) => p.outcome === 'fail').length };
}

// cur: the topic tab shown in 课题手记 ('*' = all, '' = 未分类)
// Keeps each list's <input class="cd-add-input"> mounted across updates so typing & IME never lose focus.
export function createCandidatesBlock(draw) {
  const el = h('div', { class: 'cd-block' });
  const headEl = h('div', { class: 'cd-head' });
  const secMap = new Map(); // list name -> { sec, input }
  let state = { doc: null, cur: '*', addTopic: '', all: [] };
  const upd = (id, f, msg) => changePlanner((d) => { const x = (d.cands || []).find((y) => y.id === id); if (x) { f(x); x.updated = nowISO(); } }, msg, draw);
  const getListEntry = (list) => {
    if (secMap.has(list)) return secMap.get(list);
    const input = h('input', { class: 'cd-add-input', placeholder: '加一个候选，回车', 'aria-label': `在「${list}」里加一个候选`, 'data-k': `cand:${list}` });
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || isImeEvent(e)) return;
      e.preventDefault();
      const v = input.value.trim(); if (!v) return; input.value = '';
      const topic = state.addTopic || state.all.find((c) => (c.list || '候选') === list)?.topic || '';
      changePlanner((d) => { if (topic) pinTopicsIn(d); d.cands = [...(d.cands || []), { id: rid('C'), list, name: v, topic, stage: 'todo', created: nowISO() }]; }, 'Candidates: add', draw);
    });
    const sec = h('section', { class: 'cd-list' }, input);
    const entry = { sec, input };
    secMap.set(list, entry);
    return entry;
  };
  const counts = (cs) => CAND_STAGES.map(([k, l, c]) => [l, c, cs.filter((x) => stageOf(x) === k).length]).filter(([, , n]) => n);
  const update = (doc, cur) => {
    const topics = topicsOf(doc);
    const tname = new Map(topics.map((t) => [t.id, t]));
    const all = doc.cands || [];
    const mine = all.filter((c) => cur === '*' || (tname.has(c.topic) ? c.topic : '') === cur);
    const lists = [...new Set(mine.map((c) => c.list || '候选'))];
    const addTopic = cur === '*' ? '' : cur;
    state = { doc, cur, addTopic, all };
    const card = (c) => {
      const st = STAGE[stageOf(c)];
      const si = seriesInfo(c.series);
      const pill = h('button', { type: 'button', class: 'cd-stage', style: { '--k': st.color }, title: '改状态' }, st.label);
      pill.addEventListener('click', (e) => { e.stopPropagation(); menu(pill, CAND_STAGES.filter(([k]) => k !== stageOf(c)).map(([k, l]) => ({ icon: 'go', label: l, run: () => upd(c.id, (x) => { x.stage = k; }, 'Candidates: stage') }))); });
      return h('li', { class: `cd-card st-${stageOf(c)}`, style: { '--k': st.color }, tabindex: '0', title: '点击修改', onclick: (e) => { if (!e.target.closest('a, button')) editCand(c, doc, draw); }, onkeydown: (e) => { if (e.key === 'Enter' && e.target === e.currentTarget) editCand(c, doc, draw); } },
        h('div', { class: 'cd-top' }, h('b', null, c.name), c.kind ? h('span', { class: 'cd-kind' }, c.kind) : null, pill),
        c.note ? h('p', { class: 'cd-note' }, c.note) : null,
        c.series ? h('a', { class: 'cd-series', href: `#/series/${encodeURIComponent(c.series)}`, title: '这个候选的全部实验' },
          `${c.series}`, si ? h('span', null, ` · ${si.n} 次${si.ok ? ` · 可重复 ${si.ok}` : ''}${si.fail ? ` · 行不通 ${si.fail}` : ''}`) : h('span', null, ' · 还没有实验')) : null);
    };
    headEl.replaceChildren(
      h('h3', { class: 'nt-h', style: { '--k': '#00a3a3' } }, '候选清单', h('span', null, mine.length ? `${mine.length} 个候选` : '')),
      h('button', { class: 'wb-add-btn', type: 'button', onclick: () => editCand(null, doc, draw, { topic: addTopic }) }, icon('plus', 14), '新清单 / 新候选'));
    if (el.firstChild !== headEl) el.prepend(headEl);
    const keepNames = new Set(lists);
    for (const name of [...secMap.keys()]) if (!keepNames.has(name)) secMap.delete(name);
    if (!lists.length) {
      replaceAround(el, headEl, [], [
        h('p', { class: 'nt-empty' }, '还没有。把要试的材料、配方或结构列成一张清单，例如「可双光子打印的有机聚合物半导体」：BBL、p(g2T-TT)、P-90、PTHS。每个候选标出试到哪一步，开始做实验后关联到它的实验主题。'),
      ]);
      return;
    }
    const desired = lists.map((list) => {
      const entry = getListEntry(list);
      const cs = mine.filter((c) => (c.list || '候选') === list).sort((a, b) => CAND_STAGES.findIndex(([k]) => k === stageOf(a)) - CAND_STAGES.findIndex(([k]) => k === stageOf(b)));
      const tp = tname.get(cs[0]?.topic);
      replaceAround(entry.sec, entry.input, [
        h('h4', null, list, cur === '*' && tp ? h('span', { class: 'nt-topic', style: { '--k': tp.color } }, tp.name) : null,
          h('span', { class: 'cd-counts' }, counts(cs).map(([l, c, n]) => h('span', { style: { '--k': c } }, `${l} ${n}`)))),
        h('ul', { class: 'cd-cards' }, cs.map(card)),
      ], []);
      return entry.sec;
    });
    const desiredSet = new Set([headEl, ...desired]);
    for (const ch of [...el.childNodes]) if (!desiredSet.has(ch)) ch.remove();
    let prev = headEl;
    for (const sec of desired) {
      if (prev.nextSibling !== sec) prev.after(sec);
      prev = sec;
    }
  };
  return { el, update };
}

export function candidatesBlock(doc, cur, draw) {
  const b = createCandidatesBlock(draw);
  b.update(doc, cur);
  return b.el;
}

export function editCand(c, doc, draw, preset = {}) {
  const isNew = !c;
  const x = c ? { ...c } : { id: rid('C'), stage: 'todo', created: nowISO(), ...preset };
  const topics = topicsOf(doc);
  const lists = [...new Set((doc.cands || []).map((y) => y.list || '候选'))];
  const inp = (k, ph, attrs = {}) => h('input', { id: `cd-${k}`, value: x[k] || '', placeholder: ph, ...attrs });
  const listIn = inp('list', '例如：可双光子打印的有机聚合物半导体', { list: 'cd-lists' });
  const body = h('div', { class: 'form' },
    h('label', { for: 'cd-name' }, isNew ? '候选（一次可写几个，用顿号或逗号隔开）' : '候选'), inp('name', '例如：BBL、p(g2T-TT)、P-90、PTHS', { autofocus: true }),
    h('label', { for: 'cd-list' }, '属于哪张清单'), listIn, h('datalist', { id: 'cd-lists' }, lists.map((l) => h('option', { value: l }))),
    h('div', { class: 'pair' },
      h('div', null, h('label', { for: 'cd-topic' }, '课题'), h('select', { id: 'cd-topic' }, [{ id: '', name: '未分类' }, ...topics].map((t) => h('option', { value: t.id, selected: (x.topic || '') === t.id }, t.name)))),
      h('div', null, h('label', { for: 'cd-stage' }, '状态'), h('select', { id: 'cd-stage' }, CAND_STAGES.map(([k, l]) => h('option', { value: k, selected: stageOf(x) === k }, l))))),
    h('label', { for: 'cd-kind' }, '类型（可不填）'), inp('kind', '例如：n 型 / p 型 / 双极；交联剂；栅极材料'),
    h('label', { for: 'cd-note' }, '备注'), h('textarea', { id: 'cd-note', rows: 3, placeholder: '来源、溶剂、为什么值得试、卡在哪…' }, x.note || ''),
    h('label', { for: 'cd-series' }, '它的实验主题（开始做实验后选）'),
    h('select', { id: 'cd-series' }, [h('option', { value: '' }, '还没有'), ...allSeries().map((s) => h('option', { value: s.name, selected: x.series === s.name }, `${s.name}（${s.pages.length} 次）`))]));
  modal({
    title: isNew ? '新候选' : x.name, body,
    buttons: [isNew ? null : { label: '删除', danger: true, run: async () => {
      if ((await choose(`删除“${x.name}”？`, 'GitHub 历史里仍可找回。', [['yes', '删除'], ['no', '取消']])) !== 'yes') return false;
      changePlanner((d) => { d.cands = (d.cands || []).filter((y) => y.id !== x.id); }, 'Candidates: remove', draw);
    } },
    { label: '取消' }, { label: '保存', primary: true, run: () => {
      const v = (k) => body.querySelector(`#cd-${k}`).value.trim();
      const names = isNew ? v('name').split(/[、,，;；\n]+/).map((s) => s.trim()).filter(Boolean) : [v('name')].filter(Boolean);
      if (!names.length) { toast('写一个候选。'); return false; }
      const fields = { list: v('list') || '候选', topic: v('topic'), stage: v('stage'), kind: v('kind') || undefined, note: v('note') || undefined, series: v('series') || undefined, updated: nowISO() };
      changePlanner((d) => {
        if (fields.topic) pinTopicsIn(d);
        d.cands = d.cands || [];
        if (isNew) names.forEach((n, i) => d.cands.push({ ...x, ...fields, id: i ? rid('C') : x.id, name: n }));
        else { const k = d.cands.findIndex((y) => y.id === x.id); if (k >= 0) d.cands[k] = { ...d.cands[k], ...fields, name: names[0] }; }
      }, `Candidates: ${isNew ? 'add' : 'edit'}`, draw);
      if (isNew && names.length > 1) toast(`已加入 ${names.length} 个候选。`);
    } }],
  });
}

// ---------- 长期目标 ----------
export const AIM_STAGES = ['未开始', '准备中', '进行中', '已实现'];
const AIM_COLOR = { 未开始: '#8e8e93', 准备中: '#c77c02', 进行中: '#5e5ce6', 已实现: '#30a46c' };
const STALE = 14; // days without a move before the card asks for attention
const lastMove = (a) => zoned(a.moved || a.updated || a.created).day;

const OPEN_KEY = 'labnote-aimset-open';
const openSet = { get: () => { try { return localStorage.getItem(OPEN_KEY) || ''; } catch { return ''; } }, set: (v) => { try { localStorage.setItem(OPEN_KEY, v); } catch { /* private window */ } } };
const LOOSE_SET = '_';

// cur: the topic tab shown in 课题手记 ('*' = all, '' = 未分类)
export function aimsBlock(doc, cur, draw) {
  const topics = topicsOf(doc);
  const tOf = (id) => topics.find((t) => t.id === id) || null;
  const t = todayISO();
  const sets = doc.aimSets || [];
  const setIds = new Set(sets.map((x) => x.id));
  const inTab = (topic) => cur === '*' || (tOf(topic) ? topic : '') === cur;
  const groups = [
    ...sets.filter((x) => inTab(x.topic)).map((x) => ({ set: x, aims: (doc.aims || []).filter((a) => a.set === x.id) })),
  ];
  const loose = (doc.aims || []).filter((a) => !setIds.has(a.set) && inTab(a.topic));
  if (loose.length) groups.push({ set: { id: LOOSE_SET, title: '未归入集合', topic: '' }, aims: loose });
  let open = openSet.get();
  const idleOf = (a) => -daysFrom(lastMove(a), t);
  const card = (a) => {
    const idle = idleOf(a);
    const tp = tOf(a.topic);
    return h('li', { class: `aim${idle >= STALE && a.stage !== '已实现' ? ' stale' : ''}${a.stage === '已实现' ? ' done' : ''}`, style: { '--k': tp?.color || LOOSE_COLOR }, tabindex: '0', onclick: (e) => { if (!e.target.closest('button')) editAim(a, doc, draw); }, onkeydown: (e) => { if (e.key === 'Enter' && e.target === e.currentTarget) editAim(a, doc, draw); } },
      h('div', { class: 'aim-top' }, h('b', null, a.title), h('span', { class: 'aim-stage', style: { '--s': AIM_COLOR[a.stage] || AIM_COLOR.未开始 } }, a.stage || '未开始')),
      h('p', { class: 'aim-next' }, a.next ? [h('span', null, '下一步 '), a.next] : h('span', { class: 'muted' }, '还没写下一步')),
      h('div', { class: 'aim-foot' },
        h('span', { class: 'aim-idle' }, a.stage === '已实现' ? '已实现' : idle <= 0 ? '今天推进过' : idle >= STALE ? `${idle} 天没推进` : `${idle} 天前推进`),
        a.stage === '已实现' ? null : h('button', { class: 'btn small ghost aim-move', type: 'button', title: '记一笔进展，并写下新的下一步', onclick: () => moveAim(a, draw) }, '推进一步')));
  };
  const setCard = ({ set, aims }) => {
    const tp = tOf(set.topic);
    const live = aims.filter((a) => a.stage !== '已实现');
    const stale = live.filter((a) => idleOf(a) >= STALE).length;
    const n = (st) => aims.filter((a) => (a.stage || '未开始') === st).length;
    const isOpen = open === set.id;
    return h('button', { type: 'button', class: `aimset${isOpen ? ' open' : ''}${stale ? ' stale' : ''}`, style: { '--k': tp?.color || LOOSE_COLOR }, 'aria-expanded': String(isOpen),
      onclick: () => { open = isOpen ? '' : set.id; openSet.set(open); paint(); } },
      h('span', { class: 'aimset-kicker' }, tp ? tp.name : set.id === LOOSE_SET ? '' : '未分类'),
      h('b', { class: 'aimset-t' }, set.title),
      h('span', { class: 'aimset-names' }, aims.length ? aims.map((a) => a.title).join(' · ') : '还没有目标'),
      h('span', { class: 'aimset-foot' },
        h('span', null, `${aims.length} 个目标`),
        ...AIM_STAGES.filter((st) => n(st)).map((st) => h('span', { class: 'aimset-st', style: { '--s': AIM_COLOR[st] } }, `${st} ${n(st)}`)),
        stale ? h('span', { class: 'aimset-stale' }, `${stale} 个两周没推进`) : null),
      h('span', { class: 'aimset-chev', 'aria-hidden': 'true' }, isOpen ? '收起' : '点开 ›'));
  };
  const detail = (g) => {
    const { set, aims } = g;
    const order = (a) => AIM_STAGES.indexOf(a.stage || '未开始');
    const sorted = [...aims].sort((a, b) => Number(a.stage === '已实现') - Number(b.stage === '已实现') || order(b) - order(a));
    return h('div', { class: 'aimset-detail', style: { '--k': tOf(set.topic)?.color || LOOSE_COLOR } },
      h('div', { class: 'aimset-dh' },
        h('h4', null, set.title, set.note ? h('span', null, set.note) : null),
        h('button', { class: 'wb-add-btn', type: 'button', onclick: () => editAim(null, doc, draw, { set: set.id === LOOSE_SET ? '' : set.id, topic: set.topic || (cur !== '*' ? cur : '') }) }, icon('plus', 14), '长期目标'),
        set.id === LOOSE_SET ? null : h('button', { class: 'btn small ghost', type: 'button', onclick: () => editAimSet(set, doc, draw) }, icon('edit', 14), ' 改集合')),
      sorted.length ? h('ul', { class: 'aims-row' }, sorted.map(card)) : h('p', { class: 'nt-empty' }, '这个集合还没有目标。点「＋ 长期目标」，例如反相器、逻辑电路、光电传感器。'));
  };
  const box = h('div', { class: 'aims-block' });
  const paint = () => {
    const shown = groups.find((g) => g.set.id === open);
    const total = groups.reduce((k, g) => k + g.aims.filter((a) => a.stage !== '已实现').length, 0);
    box.replaceChildren(...[
      h('div', { class: 'cd-head' }, h('h3', { class: 'nt-h', style: { '--k': '#b4432b' } }, '长期目标', h('span', null, total ? `${total} 个在推进 · 最终要做出来的应用` : '最终要做出来的应用')),
        h('button', { class: 'wb-add-btn', type: 'button', onclick: () => editAimSet(null, doc, draw, { topic: cur !== '*' ? cur : '' }) }, icon('plus', 14), '新集合')),
      groups.length ? h('div', { class: 'aimsets' }, groups.map(setCard))
        : h('p', { class: 'nt-empty' }, '还没有。先建一个集合（一个应用方向），例如「双光子 P3HT 打印应用」，点进去再加反相器、逻辑电路、光电传感器这些长期目标。超过两周没推进的会变红提醒你。'),
      shown ? detail(shown) : null].filter(Boolean));
  };
  paint();
  return box;
}

export function editAimSet(set, doc, draw, preset = {}) {
  const isNew = !set;
  const x = set ? { ...set } : { id: rid('S'), created: nowISO(), ...preset };
  const topics = topicsOf(doc);
  const body = h('div', { class: 'form' },
    h('label', { for: 'as-title' }, '集合（一个应用方向）'), h('input', { id: 'as-title', value: x.title || '', placeholder: '例如：双光子 P3HT 打印应用', autofocus: true }),
    h('label', { for: 'as-topic' }, '课题'), h('select', { id: 'as-topic' }, [{ id: '', name: '未分类' }, ...topics].map((t) => h('option', { value: t.id, selected: (x.topic || '') === t.id }, t.name))),
    h('label', { for: 'as-note' }, '说明（可不填）'), h('input', { id: 'as-note', value: x.note || '', placeholder: '例如：用 2PP 打印的 P3HT 做成器件和电路' }));
  modal({
    title: isNew ? '新目标集合' : x.title, body,
    buttons: [isNew ? null : { label: '删除集合', danger: true, run: async () => {
      if ((await choose(`删除集合“${x.title}”？`, '里面的长期目标不会删，会移到「未归入集合」。', [['yes', '删除'], ['no', '取消']])) !== 'yes') return false;
      changePlanner((d) => { d.aimSets = (d.aimSets || []).filter((y) => y.id !== x.id); (d.aims || []).forEach((a) => { if (a.set === x.id) delete a.set; }); }, 'Aims: remove set', draw);
    } },
    { label: '取消' }, { label: '保存', primary: true, run: () => {
      const v = (k) => body.querySelector(`#as-${k}`).value.trim();
      if (!v('title')) { toast('写一个集合名。'); return false; }
      const fields = { title: v('title'), topic: v('topic') || undefined, note: v('note') || undefined, updated: nowISO() };
      changePlanner((d) => {
        if (fields.topic) pinTopicsIn(d);
        d.aimSets = d.aimSets || [];
        const k = d.aimSets.findIndex((y) => y.id === x.id);
        if (k >= 0) d.aimSets[k] = { ...d.aimSets[k], ...fields }; else d.aimSets.push({ ...x, ...fields });
      }, `Aims: ${isNew ? 'add' : 'edit'} set`, draw);
      if (isNew) openSet.set(x.id);
    } }],
  });
}

function moveAim(a, draw) {
  const what = h('textarea', { id: 'am-what', rows: 2, placeholder: '这次推进了什么（可不填）', autofocus: true });
  const next = h('input', { id: 'am-next', value: a.next || '', placeholder: '新的下一步' });
  modal({
    title: `推进：${a.title}`,
    body: h('div', { class: 'form' }, h('label', { for: 'am-what' }, '进展'), what, h('label', { for: 'am-next' }, '下一步'), next),
    buttons: [{ label: '取消' }, { label: '保存', primary: true, run: () => {
      changePlanner((d) => { const x = (d.aims || []).find((y) => y.id === a.id); if (!x) return;
        if (what.value.trim()) x.log = [...(x.log || []), { at: nowISO(), note: what.value.trim() }];
        x.next = next.value.trim() || undefined; x.moved = nowISO(); x.updated = nowISO();
        if ((x.stage || '未开始') === '未开始') x.stage = '准备中'; }, 'Aims: move', draw);
    } }],
  });
}

export function editAim(a, doc, draw, preset = {}) {
  const isNew = !a;
  const x = a ? { ...a } : { id: rid('G'), stage: '未开始', created: nowISO(), ...preset };
  const sets = doc.aimSets || [];
  const topics = topicsOf(doc);
  const inp = (k, ph) => h('input', { id: `ai-${k}`, value: x[k] || '', placeholder: ph });
  const body = h('div', { class: 'form' },
    h('label', { for: 'ai-title' }, '长期目标'), inp('title', '例如：反相器 / 逻辑电路 / 光电传感器'),
    h('label', { for: 'ai-set' }, '属于哪个集合'), h('select', { id: 'ai-set' }, [h('option', { value: '' }, '未归入集合'), ...sets.map((y) => h('option', { value: y.id, selected: x.set === y.id }, y.title))]),
    h('div', { class: 'pair' },
      h('div', null, h('label', { for: 'ai-topic' }, '课题'), h('select', { id: 'ai-topic' }, [{ id: '', name: '未分类' }, ...topics].map((t) => h('option', { value: t.id, selected: (x.topic || '') === t.id }, t.name)))),
      h('div', null, h('label', { for: 'ai-stage' }, '阶段'), h('select', { id: 'ai-stage' }, AIM_STAGES.map((s) => h('option', { selected: (x.stage || '未开始') === s }, s))))),
    h('label', { for: 'ai-next' }, '下一步'), inp('next', '例如：先做出 n 型 BBL 器件，和 p(g2T-TT) 配成互补对'),
    h('label', { for: 'ai-need' }, '需要先具备什么'), h('textarea', { id: 'ai-need', rows: 3, placeholder: '例如：p 型和 n 型都能稳定打印；Vth 匹配；栅极共用…' }, x.need || ''),
    (x.log || []).length ? h('details', { class: 'pj-reviews' }, h('summary', null, `进展记录（${x.log.length}）`),
      h('ol', { class: 'hist-list' }, [...x.log].reverse().map((r) => h('li', null, h('span', { class: 'ev-date' }, zoned(r.at).day), ' ', r.note)))) : null);
  modal({
    title: isNew ? '新长期目标' : x.title, body,
    buttons: [isNew ? null : { label: '删除', danger: true, run: async () => {
      if ((await choose(`删除“${x.title}”？`, 'GitHub 历史里仍可找回。', [['yes', '删除'], ['no', '取消']])) !== 'yes') return false;
      changePlanner((d) => { d.aims = (d.aims || []).filter((y) => y.id !== x.id); }, 'Aims: remove', draw);
    } },
    { label: '取消' }, { label: '保存', primary: true, run: () => {
      const v = (k) => body.querySelector(`#ai-${k}`).value.trim();
      if (!v('title')) { toast('写一个目标。'); return false; }
      const fields = { title: v('title'), set: v('set') || undefined, topic: v('topic'), stage: v('stage'), next: v('next') || undefined, need: v('need') || undefined, updated: nowISO() };
      if (fields.stage !== (x.stage || '未开始') || fields.next !== x.next) fields.moved = nowISO();
      changePlanner((d) => {
        if (fields.topic) pinTopicsIn(d);
        d.aims = d.aims || [];
        const k = d.aims.findIndex((y) => y.id === x.id);
        if (k >= 0) d.aims[k] = { ...d.aims[k], ...fields }; else d.aims.push({ ...x, ...fields });
      }, `Aims: ${isNew ? 'add' : 'edit'}`, draw);
    } }],
  });
}
