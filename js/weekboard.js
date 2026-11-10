// 本周看板: the week at a glance, one column per day (like a calendar week view), plus a 待安排 column
// for this week's undated plans and anything overdue. Drag a card to another day to move it.
import { todayISO } from './model.js';
import { addDays } from './lab.js';
import { h, icon } from './util.js';
import { toast } from './core.js';
import { WEEKDAYS, allFollowups, changeTasks, editPaper, editProject, exportIcs, isGoal, loadPlanner, moveTask, newTask, reminderRow, ring, taskRow, weekStart } from './planner.js';

const FLOAT = ['杂事', '生活']; // side-list items that may wait without a day
// Every item on a day sits under its kind, in this order, each with its own colour.
const KINDS = [['截止', '#e5484d'], ['仪器', '#0a84ff'], ['待办', '#5e5ce6'], ['杂事', '#c77c02'], ['生活', '#30a46c'], ['提醒', '#8e8e93']];
const kindOf = (x) => (KINDS.some(([k]) => k === x.cat) ? x.cat : '待办');
const fmtMD = (iso) => `${+iso.slice(5, 7)}/${+iso.slice(8, 10)}`;
const openKind = new Map(); // the kind last picked in each column's add box
let shownWeek = null; // the home board remembers the week you paged to until reload

export function weekBoard({ week = null, redraw = null, hooks = null, standalone = false } = {}) {
  const t = todayISO();
  let wk = week || (standalone ? weekStart(t) : shownWeek || weekStart(t));
  const el = h('section', { class: `wb${standalone ? ' wb-page' : ''}`, 'aria-label': '本周看板' });
  let scrolled = false;
  const again = () => (redraw ? redraw() : draw());
  const move = (id, day) => changeTasks((list) => {
    const x = list.find((y) => y.id === id); if (!x) return;
    if (day) { x.date = day; x.week = weekStart(day); } else { delete x.date; x.week = wk; }
  }, day ? 'Planner: move to day' : 'Planner: move to week plan', again);

  async function draw() {
    let doc; let fus;
    try { [doc, fus] = await Promise.all([loadPlanner(), allFollowups().catch(() => [])]); } catch (e) { el.replaceChildren(h('p', { class: 'warn' }, e.message)); return; }
    const focused = el.querySelector('input:focus')?.dataset.k;
    const { tasks, projects = [], papers = [] } = doc;
    const days = WEEKDAYS.map((w, k) => addDays(wk, k));
    const isThis = wk === weekStart(t);
    const dated = tasks.filter((x) => x.date && x.date >= wk && x.date <= days[6] && x.cat !== '文献');
    // 待安排: this week's plans with no day yet, and (this week) the open 杂事 / 生活 that have no date.
    const goals = tasks.filter((x) => isGoal(x, wk) || (isThis && !x.date && !x.done && FLOAT.includes(x.cat)));
    const overdue = isThis ? tasks.filter((x) => x.date && x.date < wk && !x.done && x.cat !== '文献') : [];
    const done = dated.filter((x) => x.done).length + goals.filter((x) => x.done).length;
    const total = dated.length + goals.length;

    const card = (x, opt = {}) => {
      const li = taskRow(x, { redraw: again, showCat: false, extra: opt.toToday ? h('button', { class: 'btn small ghost wb-totoday', type: 'button', onclick: () => moveTask(x.id, t, again) }, '移到今天') : null });
      li.classList.add('wb-card');
      if (x.date && !x.done && x.date < t) li.classList.add('late');
      li.draggable = true;
      li.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/x-task', x.id); e.dataTransfer.effectAllowed = 'move'; li.classList.add('dragging'); el.classList.add('is-dragging'); });
      li.addEventListener('dragend', () => { li.classList.remove('dragging'); el.classList.remove('is-dragging'); });
      return li;
    };
    const flag = (text, tag, open) => h('li', { class: 'task wb-flag', onclick: open, title: '点击查看' }, icon('flag', 14), h('span', { class: 'task-main' }, h('span', { class: 'task-text' }, text), h('span', { class: 'task-meta' }, tag)));
    // ＋ 添加: a link that turns into a one-line box; Enter adds and keeps the box open for the next one.
    const adder = (day, cats = false) => {
      const key = day || 'plan';
      const box = h('div', { class: 'wb-add' });
      const open = (focus) => {
        const input = h('input', { class: 'add-input', placeholder: day ? (day === t ? '添加今天要做的事' : '添加到这一天') : '添加本周目标', enterkeyhint: 'done', 'data-k': key });
        const sel = day ? h('select', { class: 'wb-kind', 'aria-label': '分类', title: '分类' }, ['待办', '仪器', '截止', '杂事', '生活'].map((k) => h('option', { selected: (openKind.get(key) || '待办') === k }, k))) : null;
        sel?.addEventListener('change', () => { openKind.set(key, sel.value); input.focus(); });
        input.addEventListener('keydown', (e) => {
          if (e.isComposing) return;
          if (e.key === 'Enter') {
            e.preventDefault(); const v = input.value.trim(); if (!v) return; input.value = '';
            const cat = sel && sel.value !== '待办' ? sel.value : null;
            changeTasks((l) => l.push(newTask(v, day ? weekStart(day) : wk, day || null, cat)), day ? 'Planner: add to-do' : 'Planner: add weekly goal', again);
          }
          if (e.key === 'Escape') { input.value = ''; input.blur(); }
        });
        const leave = () => { if (!input.value.trim()) setTimeout(close, 150); };
        input.addEventListener('blur', leave); sel?.addEventListener('blur', leave);
        box.replaceChildren(h('div', { class: 'wb-add-row' }, input, sel)); if (focus) input.focus();
      };
      const close = () => { if (!box.contains(document.activeElement)) box.replaceChildren(h('button', { class: 'wb-add-btn', type: 'button', onclick: () => open(true) }, icon('plus', 14), '添加')); };
      if (focused === key || (cats && day === t && !standalone && false)) open(false); else close();
      return box;
    };
    const dropZone = (col, day) => {
      col.addEventListener('dragover', (e) => { if ([...e.dataTransfer.types].includes('text/x-task')) { e.preventDefault(); col.classList.add('over'); } });
      col.addEventListener('dragleave', (e) => { if (!col.contains(e.relatedTarget)) col.classList.remove('over'); });
      col.addEventListener('drop', (e) => {
        e.preventDefault(); col.classList.remove('over');
        const id = e.dataTransfer.getData('text/x-task'); if (!id) return;
        const x = tasks.find((y) => y.id === id); if (!x) return;
        if ((x.date || null) === (day || null) && (day || x.week === wk)) return;
        if (!day && x.cat && !FLOAT.includes(x.cat)) { toast(`「${x.cat}」事项需要一个日期，不能取消日期。`); return; }
        move(id, day);
      });
    };

    const float = goals.filter((x) => x.cat);
    const aims = goals.filter((x) => !x.cat).sort((a, b) => Number(a.done) - Number(b.done));
    const aimsDone = aims.filter((x) => x.done).length;
    const planCol = h('div', { class: 'wb-col wb-plan' },
      h('div', { class: 'wb-head wb-head-plan' },
        h('div', null, h('span', { class: 'wb-w' }, '本周目标'), h('span', { class: 'wb-d' }, aims.length ? `完成 ${aimsDone}/${aims.length}` : '这周要完成什么')),
        ring(aimsDone, aims.length, 38)),
      h('ul', { class: 'tasks' }, aims.map((x) => card(x))),
      adder(null),
      float.length ? h('div', { class: 'wb-group', style: { '--k': '#c77c02' } }, h('div', { class: 'wb-glabel' }, '未排期 · 杂事 / 生活'), h('ul', { class: 'tasks' }, float.map((x) => card(x)))) : null,
      h('p', { class: 'wb-hint' }, '拖到某一天即可排期'));
    dropZone(planCol, null);

    const lateRem = isThis ? fus.filter((x) => !x.done && x.date < t) : [];
    const cols = days.map((day, k) => {
      const mine = dated.filter((x) => x.date === day).sort((a, b) => Number(a.done) - Number(b.done) || String(a.created).localeCompare(String(b.created)));
      const rem = [...fus.filter((x) => x.date === day && (!x.done || day >= t)), ...(day === t ? lateRem : [])];
      const dl = [
        ...projects.filter((x) => x.due === day && x.stage !== '已结束').map((x) => flag(x.title, `${x.kind || '课题'}截止`, () => editProject(x))),
        ...papers.filter((x) => x.due === day && !['接收', '已发表'].includes(x.stage)).map((x) => flag(x.title, `论文 · ${x.stage}`, () => editPaper(x))),
      ];
      const carried = day === t ? overdue.sort((a, b) => a.date.localeCompare(b.date)) : [];
      const n = mine.length; const dn = mine.filter((x) => x.done).length;
      const groups = KINDS.map(([kind, color]) => {
        const items = kind === '提醒' ? rem.map((x) => reminderRow(x, again)) : [...(kind === '截止' ? dl : []), ...mine.filter((x) => kindOf(x) === kind).map((x) => card(x))];
        return items.length ? h('div', { class: 'wb-group', style: { '--k': color } }, h('div', { class: 'wb-glabel' }, kind, h('span', null, String(items.length))), h('ul', { class: 'tasks' }, items)) : null;
      });
      const isToday = day === t;
      const col = h('div', { class: `wb-col${isToday ? ' is-today' : ''}${day < t ? ' past' : ''}${k >= 5 ? ' weekend' : ''}`, 'data-day': day },
        h('div', { class: 'wb-head' },
          h('span', { class: 'wb-num' }, String(+day.slice(8, 10))),
          h('div', { class: 'wb-hd' }, h('span', { class: 'wb-w' }, isToday ? `今天 · 周${WEEKDAYS[k]}` : `周${WEEKDAYS[k]}`), h('span', { class: 'wb-d' }, n ? `${dn}/${n} 完成` : rem.length || dl.length ? `${rem.length + dl.length} 项提醒` : '空')),
          isToday && n ? ring(dn, n, 34) : null),
        carried.length ? h('div', { class: 'wb-group wb-carried', style: { '--k': '#d70015' } }, h('div', { class: 'wb-glabel' }, '之前没做完', h('span', null, String(carried.length))), h('ul', { class: 'tasks' }, carried.map((x) => card(x, { toToday: true })))) : null,
        groups,
        !n && !rem.length && !dl.length && !carried.length ? h('p', { class: 'wb-empty' }, day < t ? '—' : '没有安排') : null,
        adder(day, true));
      dropZone(col, day);
      return col;
    });

    el.replaceChildren(
      h('div', { class: 'wb-top' },
        h('div', null,
          h('h2', { class: 'wb-title' }, standalone ? '一周日程' : '本周日程'),
          h('p', { class: 'wb-sub' }, `${fmtMD(wk)} – ${fmtMD(days[6])}${total ? ` · 完成 ${done}/${total}` : ''}${overdue.length ? ` · 之前没做完 ${overdue.length}` : ''}`)),
        h('div', { class: 'wb-legend', 'aria-hidden': 'true' }, KINDS.map(([k, c]) => h('span', { style: { '--k': c } }, k))),
        h('div', { class: 'wb-nav' },
          h('button', { class: 'btn small ghost', type: 'button', 'aria-label': '上一周', onclick: () => go(addDays(wk, -7)) }, '‹'),
          h('button', { class: 'btn small ghost', type: 'button', disabled: isThis, onclick: () => go(weekStart(t)) }, '本周'),
          h('button', { class: 'btn small ghost', type: 'button', 'aria-label': '下一周', onclick: () => go(addDays(wk, 7)) }, '›'),
          fus.some((x) => !x.done) ? h('button', { class: 'btn small ghost wide-only', type: 'button', title: '把实验提醒导出到手机日历', onclick: () => exportIcs(fus.filter((x) => !x.done)) }, '导出提醒') : null,
          standalone ? null : h('a', { class: 'btn small', href: `#/plan/${wk}` }, '周计划与历史 ›'))),
      h('div', { class: 'wb-grid' }, planCol, cols),
      h('p', { class: 'wb-foot muted small' }, '拖动卡片换到别的日子；点文字修改；拖到「本周目标」即取消日期。手机上点卡片右侧的日期改天。'));
    // Narrow screens scroll sideways: start at today.
    if (!scrolled && isThis) {
      scrolled = true;
      requestAnimationFrame(() => { const g = el.querySelector('.wb-grid'); const c = el.querySelector('.wb-col.is-today'); if (g && c && g.scrollWidth > g.clientWidth + 4) g.scrollLeft = c.offsetLeft - g.offsetLeft - 8; });
    }
    if (focused) el.querySelector(`input[data-k="${focused}"]`)?.focus();
  }
  const go = (w) => {
    if (standalone) { location.hash = `#/plan/${w}`; return; }
    wk = w; shownWeek = w; scrolled = false; draw().catch((e) => toast(e.message));
  };
  hooks?.add(draw);
  draw();
  return el;
}
