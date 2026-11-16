// 优化目标: what an experiment topic is trying to reach, so the merged table of conditions and results
// can be handed to an optimiser (Claude Code: `labnote.py table --topic …`). The user sets the target;
// nothing here proposes experiments yet.
import { nowISO } from './model.js';
import { colLabel, isResultCol } from './lab.js';
import { h, icon } from './util.js';
import { lib, modal, saveError, toast } from './core.js';

export const GOALS_PATH = 'optimize/goals.json';
const MIN_POINTS = 6; // below this an optimiser mostly guesses

export async function loadGoals() {
  const d = await lib.readJSON(GOALS_PATH, {});
  return { version: 1, topics: {}, ...d, topics: { ...(d?.topics || {}) } };
}
export async function saveGoal(name, goal) {
  return lib.commit(goal ? `Optimization goal: ${name}` : `Remove optimization goal: ${name}`, async (l) => {
    const d = await l.readJSON(GOALS_PATH, {});
    const doc = { version: 1, ...d, topics: { ...(d?.topics || {}) } };
    if (goal) doc.topics[name] = { ...goal, updated: nowISO() }; else delete doc.topics[name];
    return { changes: [{ path: GOALS_PATH, data: `${JSON.stringify(doc, null, 2)}\n` }], result: doc };
  });
}

// "2.8×10⁴", "2.8x10^4", "2.8e4", "−0.30", "20 µS" -> number; anything else -> null
const SUP = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', '⁻': '-', '⁺': '' };
export function num(v) {
  let s = String(v ?? '').trim().replace(/[−–]/g, '-').replace(/[⁰-⁹⁻⁺¹²³]/g, (c) => SUP[c] ?? c);
  s = s.replace(/\s*[×x*]\s*10\^?\s*(-?\d+)/i, 'e$1');
  const m = s.match(/^[<>≈~]?\s*(-?\d*\.?\d+(?:e[-+]?\d+)?)/i);
  return m ? parseFloat(m[1]) : null;
}

const OPS = { '>=': '≥', '<=': '≤' };
const passes = (vals, cons) => (cons || []).every((c) => { const x = num(vals[c.col]); return x != null && (c.op === '<=' ? x <= c.value : x >= c.value); });

// rows: [{ p, no, vals }] from the series page.
export function goalStats(goal, rows) {
  const live = rows.filter((r) => r.no && !r.p.void);
  const withTarget = live.filter((r) => num(r.vals[goal.target]) != null);
  const ok = withTarget.filter((r) => passes(r.vals, goal.constraints));
  const best = [...ok].sort((a, b) => (goal.dir === 'min' ? 1 : -1) * (num(a.vals[goal.target]) - num(b.vals[goal.target])))[0] || null;
  const failed = live.filter((r) => r.p.outcome === 'fail').length;
  return { samples: live.length, withTarget: withTarget.length, ok: ok.length, best, failed };
}

export function goalCard(name, { conds, results, rows }, goal, redraw) {
  const edit = () => openGoal(name, { conds, results, rows }, goal, redraw);
  if (!goal) {
    return h('section', { class: 'opt-card empty' },
      h('div', { class: 'opt-head' }, h('h2', null, '优化目标'), h('button', { class: 'btn small primary', type: 'button', onclick: edit }, icon('plus', 16), '定优化目标')),
      h('p', { class: 'muted' }, '还没定目标。写下要把哪个结果做到最大或最小、哪些条件可以调、调的范围，Claude Code 就能根据下面「全部条件与结果」建议下一批实验。目标只能由你定。'));
  }
  const st = goalStats(goal, rows);
  const enough = st.withTarget >= MIN_POINTS;
  const vars = (goal.vars || []).filter((v) => !v.fixed);
  const numericCol = (c) => rows.filter((r) => r.no && String(r.vals[c] ?? '').trim()).every((r) => num(r.vals[c]) != null);
  return h('section', { class: 'opt-card' },
    h('div', { class: 'opt-head' }, h('h2', null, '优化目标'), h('button', { class: 'btn small', type: 'button', onclick: edit }, icon('edit', 16), '修改')),
    h('p', { class: 'opt-target' }, h('b', null, colLabel(goal.target)), goal.dir === 'min' ? ' 越小越好' : ' 越大越好',
      ...(goal.constraints || []).map((c) => h('span', { class: 'opt-chip' }, `${colLabel(c.col)} ${OPS[c.op]} ${c.value}`))),
    vars.length ? h('div', { class: 'opt-vars' }, h('span', { class: 'opt-lbl' }, '可调条件'),
      vars.map((v) => h('span', { class: `opt-chip var${numericCol(v.col) ? '' : ' warn'}`, title: numericCol(v.col) ? '' : '这一列有不是数字的格子，优化时会被跳过' },
        `${v.col}  ${v.lo ?? '?'} – ${v.hi ?? '?'}${v.step ? `，步长 ${v.step}` : ''}`))) : h('p', { class: 'muted' }, '还没选可调条件。'),
    (goal.vars || []).some((v) => v.fixed) ? h('p', { class: 'opt-fixed muted' }, `固定：${goal.vars.filter((v) => v.fixed).map((v) => `${v.col}${v.value ? ` = ${v.value}` : ''}`).join('　')}`) : null,
    h('div', { class: 'opt-stats' },
      h('div', { class: `opt-stat${enough ? ' ok' : ''}` }, h('b', null, String(st.withTarget)), h('span', null, `个样品有目标值${enough ? '' : `（至少 ${MIN_POINTS} 个，建议才有意义）`}`)),
      h('div', { class: 'opt-stat' }, h('b', null, String(st.ok)), h('span', null, '个满足约束')),
      st.failed ? h('div', { class: 'opt-stat fail' }, h('b', null, String(st.failed)), h('span', null, '个在「行不通」的实验里：也会告诉算法哪里不用再试')) : null,
      st.best ? h('div', { class: 'opt-stat best' }, h('b', null, st.best.vals[goal.target]), h('span', null, '目前最好：', h('a', { href: `#/v/${st.best.p.vol}/${st.best.p.num}` }, `${st.best.p.xid || `p. ${st.best.p.num}`} ${st.best.no}`))) : null),
    goal.batch ? h('p', { class: 'muted' }, `每轮 ${goal.batch} 个样品。`) : null,
    goal.note ? h('p', { class: 'opt-note' }, goal.note) : null,
    h('p', { class: 'opt-cli muted' }, '交给 Claude Code：', h('code', null, `labnote.py table --topic "${name}"`)));
}

export function openGoal(name, { conds, results }, goal, redraw) {
  const g = structuredClone(goal || { target: results[0] || '', dir: 'max', constraints: [], vars: conds.map((c) => ({ col: c })), batch: 4, note: '' });
  for (const c of conds) if (!g.vars.some((v) => v.col === c)) g.vars.push({ col: c });
  const resCols = [...new Set([...results, g.target].filter(Boolean))];
  const opt = (v, label, sel) => h('option', { value: v, selected: sel }, label);
  const target = h('select', { id: 'og-target' }, resCols.map((c) => opt(c, colLabel(c), c === g.target)), opt('', '+ 新的结果列…', false));
  const newTarget = h('input', { id: 'og-newtarget', placeholder: '例如 gm_max (µS)，单位写在括号里', hidden: true });
  target.addEventListener('change', () => { newTarget.hidden = target.value !== ''; if (!newTarget.hidden) newTarget.focus(); });
  if (!resCols.length) { target.value = ''; newTarget.hidden = false; }
  const dir = h('select', { id: 'og-dir' }, opt('max', '越大越好', g.dir !== 'min'), opt('min', '越小越好', g.dir === 'min'));

  const consBox = h('div', { class: 'og-list cons' });
  const drawCons = () => consBox.replaceChildren(...g.constraints.map((c, i) => h('div', { class: 'og-row' },
    h('select', { 'aria-label': '约束的结果列', onchange: (e) => { c.col = e.target.value; } }, resCols.map((x) => opt(x, colLabel(x), x === c.col))),
    h('select', { 'aria-label': '大于或小于', onchange: (e) => { c.op = e.target.value; } }, opt('>=', '≥', c.op !== '<='), opt('<=', '≤', c.op === '<=')),
    h('input', { type: 'number', step: 'any', value: c.value ?? '', 'aria-label': '约束值', oninput: (e) => { c.value = e.target.value === '' ? null : Number(e.target.value); } }),
    h('button', { class: 'btn icon small ghost', type: 'button', 'aria-label': '删除这条约束', onclick: () => { g.constraints.splice(i, 1); drawCons(); } }, icon('close', 16)))));
  drawCons();

  const varBox = h('div', { class: 'og-list' });
  const drawVars = () => varBox.replaceChildren(
    g.vars.length ? h('div', { class: 'og-row og-headrow' }, h('span', null, '条件'), h('span', null, '怎么用'), h('span', null, '下限'), h('span', null, '上限'), h('span', null, '步长')) : h('p', { class: 'muted' }, '这个主题的参数表里还没有条件列。先在实验页「录入表格」加条件列，或在这里加。'),
    ...g.vars.map((v) => {
      const mode = h('select', { 'aria-label': `${v.col} 怎么用`, onchange: (e) => { v.fixed = e.target.value === 'fixed'; v.skip = e.target.value === 'skip'; drawVars(); } },
        opt('var', '可调', !v.fixed && !v.skip), opt('fixed', '固定', !!v.fixed), opt('skip', '不管', !!v.skip));
      const n = (key, label) => h('input', { type: v.fixed && key !== 'value' ? 'hidden' : 'number', step: 'any', value: v[key] ?? '', placeholder: label, 'aria-label': `${v.col} ${label}`, oninput: (e) => { v[key] = e.target.value === '' ? null : Number(e.target.value); } });
      return h('div', { class: `og-row${v.skip ? ' skip' : ''}` }, h('span', { class: 'og-col' }, v.col), mode,
        v.skip ? null : v.fixed ? [h('input', { value: v.value ?? '', placeholder: '固定值', 'aria-label': `${v.col} 固定值`, oninput: (e) => { v.value = e.target.value; } })] : [n('lo', '下限'), n('hi', '上限'), n('step', '步长')]);
    }));
  drawVars();
  const batch = h('input', { id: 'og-batch', type: 'number', min: 1, max: 24, value: g.batch || 4 });
  const note = h('textarea', { id: 'og-note', rows: 3, placeholder: '例如：Vth 漂移比 gm 更重要；退火温度超过 150 °C 基底会翘。' }, g.note || '');

  modal({
    title: `优化目标 · ${name}`, wide: true,
    body: h('div', { class: 'og' },
      h('p', { class: 'muted' }, '这里只记录目标和范围，不会自动安排实验。之后让 Claude Code 读这个主题的全部条件与结果，提出下一批条件，你决定做不做。'),
      h('div', { class: 'form-row' }, h('label', { for: 'og-target' }, '要优化的结果'), h('div', { class: 'og-inline' }, target, dir), newTarget),
      h('div', { class: 'form-row' }, h('span', { class: 'lbl' }, '约束（其他结果必须满足）'), consBox,
        h('button', { class: 'btn small', type: 'button', disabled: !resCols.length, onclick: () => { g.constraints.push({ col: resCols[0], op: '>=', value: null }); drawCons(); } }, icon('plus', 16), '加约束')),
      h('div', { class: 'form-row' }, h('span', { class: 'lbl' }, '条件：哪些可调，范围多大'), varBox,
        h('button', { class: 'btn small', type: 'button', onclick: () => { const c = window.prompt('条件列名称（含单位，例如 退火 (°C)）'); if (c?.trim() && !g.vars.some((v) => v.col === c.trim())) { g.vars.push({ col: c.trim() }); drawVars(); } } }, icon('plus', 16), '加条件')),
      h('div', { class: 'form-row' }, h('label', { for: 'og-batch' }, '每轮做几个样品'), batch),
      h('div', { class: 'form-row' }, h('label', { for: 'og-note' }, '给算法的话（经验、禁区）'), note)),
    buttons: [
      goal ? { label: '删除目标', danger: true, run: async () => { try { await saveGoal(name, null); toast('已删除优化目标。'); redraw(); } catch (e) { toast(saveError(e)); return false; } } } : null,
      { label: '取消' },
      { label: '保存', primary: true, run: async () => {
        const t = target.value || (newTarget.value.trim() ? `结果: ${newTarget.value.trim().replace(/^(结果|result)\s*[:：]\s*/i, '')}` : '');
        if (!t) { toast('选一个要优化的结果。'); return false; }
        const out = {
          target: isResultCol(t) ? t : `结果: ${t}`, dir: dir.value,
          constraints: g.constraints.filter((c) => c.col && c.value != null && !Number.isNaN(c.value)),
          vars: g.vars.filter((v) => !v.skip).map(({ skip, ...v }) => Object.fromEntries(Object.entries(v).filter(([, x]) => x != null && x !== '' && x !== false))),
          batch: Number(batch.value) || undefined, note: note.value.trim() || undefined,
        };
        const bad = out.vars.find((v) => !v.fixed && v.lo != null && v.hi != null && v.lo >= v.hi);
        if (bad) { toast(`${bad.col} 的下限要小于上限。`); return false; }
        try { await saveGoal(name, out); toast('已保存优化目标。'); redraw(); } catch (e) { toast(saveError(e)); return false; }
      } },
    ],
  });
}
