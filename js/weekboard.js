// 本周看板: the week at a glance, one column per day (like a calendar week view), plus a 待安排 column
// for this week's undated plans and anything overdue. Drag a card to another day to move it.
import { todayISO } from './model.js';
import { addDays } from './lab.js';
import { h, icon } from './util.js';
import { toast } from './core.js';
import { WEEKDAYS, allFollowups, changeTasks, editPaper, editProject, isGoal, loadPlanner, newTask, reminderRow, taskRow, weekStart } from './planner.js';

const FLOAT = ['杂事', '生活']; // side-list items that may wait without a day
const fmtMD = (iso) => `${+iso.slice(5, 7)}/${+iso.slice(8, 10)}`;
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

    const card = (x) => {
      const li = taskRow(x, { redraw: again });
      li.classList.add('wb-card');
      if (x.date && !x.done && x.date < t) li.classList.add('late');
      li.draggable = true;
      li.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/x-task', x.id); e.dataTransfer.effectAllowed = 'move'; li.classList.add('dragging'); el.classList.add('is-dragging'); });
      li.addEventListener('dragend', () => { li.classList.remove('dragging'); el.classList.remove('is-dragging'); });
      return li;
    };
    const flag = (text, tag, open) => h('li', { class: 'task wb-flag', onclick: open, title: '点击查看' }, icon('flag', 14), h('span', { class: 'task-main' }, h('span', { class: 'task-text' }, text), h('span', { class: 'task-meta' }, tag)));
    // ＋ 添加: a link that turns into a one-line box; Enter adds and keeps the box open for the next one.
    const adder = (day) => {
      const key = day || 'plan';
      const box = h('div', { class: 'wb-add' });
      const open = (focus) => {
        const input = h('input', { class: 'add-input', placeholder: day ? '添加到这一天' : '添加本周计划', enterkeyhint: 'done', 'data-k': key });
        input.addEventListener('keydown', (e) => {
          if (e.isComposing) return;
          if (e.key === 'Enter') { e.preventDefault(); const v = input.value.trim(); if (!v) return; input.value = ''; changeTasks((l) => l.push(newTask(v, day ? weekStart(day) : wk, day || null)), day ? 'Planner: add to-do' : 'Planner: add weekly goal', again); }
          if (e.key === 'Escape') { input.value = ''; input.blur(); }
        });
        input.addEventListener('blur', () => { if (!input.value.trim()) setTimeout(close, 120); });
        box.replaceChildren(input); if (focus) input.focus();
      };
      const close = () => { if (!box.contains(document.activeElement)) box.replaceChildren(h('button', { class: 'wb-add-btn', type: 'button', onclick: () => open(true) }, icon('plus', 14), '添加')); };
      if (focused === key) open(false); else close();
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
        if (!day && x.cat && !FLOAT.includes(x.cat)) { toast(`「${x.cat}」事项需要一个日期，不能放进待安排。`); return; }
        move(id, day);
      });
    };

    const planCol = h('div', { class: 'wb-col wb-plan' },
      h('div', { class: 'wb-head' }, h('span', { class: 'wb-w' }, '待安排'), h('span', { class: 'wb-n' }, goals.length ? `${goals.filter((x) => x.done).length}/${goals.length}` : '')),
      h('p', { class: 'wb-hint' }, '本周要做、还没定哪天的事；拖到某一天即可排期'),
      h('ul', { class: 'tasks' }, goals.sort((a, b) => Number(a.done) - Number(b.done)).map(card)),
      adder(null),
      overdue.length ? h('div', { class: 'wb-overdue' }, h('div', { class: 'wb-sub' }, `逾期 ${overdue.length}`), h('ul', { class: 'tasks' }, overdue.sort((a, b) => a.date.localeCompare(b.date)).map(card))) : null);
    dropZone(planCol, null);

    const cols = days.map((day, k) => {
      const mine = dated.filter((x) => x.date === day).sort((a, b) => Number(a.done) - Number(b.done) || String(a.created).localeCompare(String(b.created)));
      const rem = fus.filter((x) => x.date === day && (!x.done || day >= t));
      const dl = [
        ...projects.filter((x) => x.due === day && x.stage !== '已结束').map((x) => flag(x.title, `${x.kind || '课题'}截止`, () => editProject(x))),
        ...papers.filter((x) => x.due === day && !['接收', '已发表'].includes(x.stage)).map((x) => flag(x.title, `论文 · ${x.stage}`, () => editPaper(x))),
      ];
      const n = mine.length; const dn = mine.filter((x) => x.done).length;
      const col = h('div', { class: `wb-col${day === t ? ' is-today' : ''}${day < t ? ' past' : ''}${k >= 5 ? ' weekend' : ''}`, 'data-day': day },
        h('div', { class: 'wb-head' },
          h('span', { class: 'wb-w' }, `周${WEEKDAYS[k]}`), h('span', { class: 'wb-d' }, fmtMD(day)),
          h('span', { class: 'wb-n' }, n ? `${dn}/${n}` : '')),
        dl.length ? h('ul', { class: 'tasks wb-flags' }, dl) : null,
        h('ul', { class: 'tasks' }, mine.map(card)),
        rem.length ? h('ul', { class: 'tasks wb-rem' }, rem.map((x) => reminderRow(x, again))) : null,
        adder(day));
      dropZone(col, day);
      return col;
    });

    el.replaceChildren(
      h('div', { class: 'wb-top' },
        h('div', null,
          h('h2', { class: 'wb-title' }, standalone ? '一周看板' : '本周看板'),
          h('p', { class: 'wb-sub' }, `${fmtMD(wk)} – ${fmtMD(days[6])}${total ? ` · 完成 ${done}/${total}` : ''}${overdue.length ? ` · 逾期 ${overdue.length}` : ''}`)),
        h('div', { class: 'wb-nav' },
          h('button', { class: 'btn small ghost', type: 'button', 'aria-label': '上一周', onclick: () => go(addDays(wk, -7)) }, '‹'),
          h('button', { class: 'btn small ghost', type: 'button', disabled: isThis, onclick: () => go(weekStart(t)) }, '本周'),
          h('button', { class: 'btn small ghost', type: 'button', 'aria-label': '下一周', onclick: () => go(addDays(wk, 7)) }, '›'),
          standalone ? null : h('a', { class: 'btn small', href: `#/plan/${wk}` }, '周计划页 ›'))),
      h('div', { class: 'wb-grid' }, planCol, cols),
      h('p', { class: 'wb-foot muted small' }, '拖动卡片换到别的日子；点文字修改；拖回「待安排」即取消日期。手机上点卡片右侧的日期改天。'));
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
