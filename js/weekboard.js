// 本周看板: the week at a glance, one column per day (like a calendar week view), plus a 待安排 column
// for this week's undated plans and anything overdue. Drag a card to another day to move it.
import { todayISO, zoned } from './model.js';
import { addDays } from './lab.js';
import { h, icon } from './util.js';
import { downloadText, menu, toast } from './core.js';
import { icsFor } from './lab.js';
import { LOOSE_COLOR, pinTopicsIn, topicsOf } from './finds.js';
import { WEEKDAYS, allFollowups, changePlanner, changeTasks, editPaper, editProject, isGoal, loadPlanner, moveTask, newTask, reminderRow, ring, taskRow, weekStart } from './planner.js';

const FLOAT = ['杂事', '生活']; // side-list items that may wait without a day
// 催办: no deadline, but it must not be forgotten and the sooner the better. Kept as undated tasks of this kind,
// shown in a strip above the days whatever week is on screen, oldest first, with how long each has waited.
export const NAG = '催办';
const NAG_SHOW = 8;
// 必做实验: one level above 待做实验 — experiments that have to be done, in the order they matter.
// Undated or scheduled, they stay in this strip (under 催办) until ticked; a scheduled one also shows on its day.
export const MUST = '必做';
let nagAll = false;
const waited = (x, today) => Math.max(0, Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${zoned(x.created || `${today}T00:00:00+08:00`).day}T00:00:00Z`)) / 864e5));
// Every item on a day sits under its kind, in this order, each with its own colour.
const KINDS = [['截止', '#e5484d'], ['必做', '#1d3461'], ['科研', '#0a84ff'], ['待办', '#5e5ce6'], ['杂事', '#c77c02'], ['生活', '#30a46c'], ['提醒', '#8e8e93']];
// Items filed as 仪器 before the kind was renamed are 科研.
const ADD_KINDS = ['待办', '科研', '截止', '杂事', '生活'];
const kindOf = (x) => (x.cat === '仪器' ? '科研' : KINDS.some(([k]) => k === x.cat) ? x.cat : '待办');
// "9" → 09:00, "930" / "9:30" → 09:30, "14-17" / "14:00~17:30" → a span. 24-hour clock only.
export function parseTime(text) {
  const one = (v) => {
    const m = String(v).trim().match(/^(\d{1,2})(?:[:：.]?(\d{2}))?$/); if (!m) return null;
    const hh = +m[1]; const mm = +(m[2] || 0);
    return hh <= 24 && mm < 60 && (hh < 24 || mm === 0) ? `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}` : null;
  };
  const raw = String(text || '').trim(); if (!raw) return { time: '', end: '' };
  const [a, b] = raw.split(/\s*(?:[-–—~～]|到|至)\s*/);
  const time = one(a); const end = b ? one(b) : '';
  if (!time || end === null || (end && end <= time)) return null;
  return { time, end: end || '' };
}
const timeLabel = (x) => (x.time ? `${x.time}${x.end ? `–${x.end}` : ''}` : '');
const fmtMD = (iso) => `${+iso.slice(5, 7)}/${+iso.slice(8, 10)}`;
const openKind = new Map(); // the kind last picked in each column's add box
let goalTopic = ''; // the topic last picked when adding a weekly goal
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
    // Open ones, longest-waiting first; one ticked today stays (struck through) until tomorrow so it can be unticked.
    const nags = tasks.filter((x) => x.cat === NAG && !x.date && (!x.done || zoned(x.doneAt || '').day === t))
      .sort((a, b) => Number(a.done) - Number(b.done) || String(a.created).localeCompare(String(b.created)));
    const nagOpen = nags.filter((x) => !x.done);
    const overdue = isThis ? tasks.filter((x) => x.date && x.date < wk && !x.done && x.cat !== '文献') : [];
    const done = dated.filter((x) => x.done).length + goals.filter((x) => x.done).length;
    const total = dated.length + goals.length;

    const topics = topicsOf(doc);
    const topicOf = (x) => topics.find((y) => y.id === x.topic) || null;
    // Every card can be refiled: a dated item under another kind, a weekly goal under another topic.
    const refile = (x) => {
      if ((x.cat === NAG && !x.date) || x.cat === MUST) return null;
      const goal = !x.date && !x.cat;
      if (!goal && !x.date) return null;
      const b = h('button', { class: 'wb-refile', type: 'button', title: goal ? '改到别的课题' : '改类别' }, goal ? '课题' : kindOf(x));
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        if (goal) menu(b, [...topics, { id: '', name: '未分类' }].filter((o) => o.id !== (topicOf(x)?.id || '')).map((o) => ({ icon: 'go', label: o.name, run: () => changePlanner((d) => { if (o.id) pinTopicsIn(d); const y = d.tasks.find((z) => z.id === x.id); if (!y) return; if (o.id) y.topic = o.id; else delete y.topic; }, 'Planner: goal topic', again) })));
        else menu(b, ADD_KINDS.filter((k) => k !== kindOf(x)).map((k) => ({ icon: 'go', label: `改为「${k}」`, run: () => changeTasks((l) => { const y = l.find((z) => z.id === x.id); if (!y) return; if (k === '待办') delete y.cat; else y.cat = k; }, 'Planner: kind', again) })));
      });
      return b;
    };
    const card = (x, opt = {}) => {
      const li = taskRow(x, { redraw: again, showCat: false, extra: h('span', { class: 'wb-extra' }, opt.toToday ? h('button', { class: 'btn small ghost wb-totoday', type: 'button', onclick: () => moveTask(x.id, t, again) }, '移到今天') : null, refile(x)) });
      li.classList.add('wb-card');
      if (x.date) {
        const chip = h('button', { class: `wb-time${x.time ? '' : ' none'}`, type: 'button', title: x.time ? '改时间（清空则不定时）' : '加时间（24 小时制，如 14:00 或 14-17）' }, x.time ? timeLabel(x) : '＋时间');
        chip.addEventListener('click', () => {
          const input = h('input', { class: 'wb-time-input', value: timeLabel(x), placeholder: '14:00', inputmode: 'numeric', 'aria-label': '时间（24 小时制）' });
          let done = false;
          const finish = (save) => {
            if (done) return; done = true;
            const v = parseTime(input.value);
            if (save && !v) { toast('时间写成 24 小时制：14:00、9:30，或 14-17 表示一段。'); input.replaceWith(chip); return; }
            input.replaceWith(chip);
            if (save && (v.time !== (x.time || '') || v.end !== (x.end || ''))) changeTasks((l) => { const y = l.find((z) => z.id === x.id); if (!y) return; if (v.time) y.time = v.time; else delete y.time; if (v.end) y.end = v.end; else delete y.end; }, 'Planner: time', again);
          };
          input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); finish(true); } if (e.key === 'Escape') finish(false); });
          input.addEventListener('blur', () => finish(true));
          chip.replaceWith(input); input.focus(); input.select();
        });
        li.querySelector('.task-main')?.prepend(chip);
        if (x.time) li.classList.add('timed');
      }
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
        const sel = day ? h('select', { class: 'wb-kind', 'aria-label': '分类', title: '分类' }, ADD_KINDS.map((k) => h('option', { selected: (openKind.get(key) || '待办') === k }, k))) : null;
        const tsel = day ? null : h('select', { class: 'wb-kind', 'aria-label': '课题', title: '这个目标属于哪个课题' }, [{ id: '', name: '未分类' }, ...topics].map((o) => h('option', { value: o.id, selected: goalTopic === o.id }, o.name)));
        tsel?.addEventListener('change', () => { goalTopic = tsel.value; input.focus(); });
        sel?.addEventListener('change', () => { openKind.set(key, sel.value); input.focus(); });
        const tm = day ? h('input', { class: 'wb-time-add', placeholder: '时间', title: '可选。24 小时制：14:00、9:30，或 14-17 表示一段', inputmode: 'numeric', 'aria-label': '时间（24 小时制，可不填）' }) : null;
        const submit = () => {
          const v = input.value.trim(); if (!v) return;
          const tv = tm ? parseTime(tm.value) : { time: '', end: '' };
          if (!tv) { toast('时间写成 24 小时制：14:00、9:30，或 14-17 表示一段。'); tm.focus(); tm.select(); return; }
          input.value = ''; if (tm) tm.value = '';
          const cat = sel && sel.value !== '待办' ? sel.value : null;
          const tp = tsel && topics.some((o) => o.id === tsel.value) ? tsel.value : '';
          changePlanner((d) => { if (tp) pinTopicsIn(d); d.tasks.push({ ...newTask(v, day ? weekStart(day) : wk, day || null, cat), ...(tv.time ? { time: tv.time } : {}), ...(tv.end ? { end: tv.end } : {}), ...(tp ? { topic: tp } : {}) }); }, day ? 'Planner: add to-do' : 'Planner: add weekly goal', again);
        };
        tm?.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); if (input.value.trim()) submit(); else input.focus(); } if (e.key === 'Escape') { tm.value = ''; input.focus(); } });
        input.addEventListener('keydown', (e) => {
          if (e.isComposing) return;
          if (e.key === 'Enter') { e.preventDefault(); submit(); }
          if (e.key === 'Escape') { input.value = ''; input.blur(); }
        });
        const leave = () => { if (!input.value.trim() && !(tm && tm.value.trim())) setTimeout(close, 150); };
        input.addEventListener('blur', leave); sel?.addEventListener('blur', leave); tm?.addEventListener('blur', leave); tsel?.addEventListener('blur', leave);
        box.replaceChildren(h('div', { class: 'wb-add-row' }, input), ...(day ? [h('div', { class: 'wb-add-row wb-add-opts' }, tm, sel)] : [h('div', { class: 'wb-add-row wb-add-opts' }, tsel)])); if (focus) input.focus();
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
        if (!day && (x.cat === NAG || x.cat === MUST)) { move(id, null); return; }
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
      [...topics, { id: '', name: '未分类', color: LOOSE_COLOR }].map((tp) => {
        const mine = aims.filter((x) => (topicOf(x)?.id || '') === tp.id);
        return mine.length ? h('div', { class: 'wb-group wb-topic', style: { '--k': tp.color } }, h('div', { class: 'wb-glabel' }, tp.name, h('span', null, `${mine.filter((x) => x.done).length}/${mine.length}`)), h('ul', { class: 'tasks' }, mine.map((x) => card(x)))) : null;
      }),
      adder(null),
      float.length ? h('div', { class: 'wb-group', style: { '--k': '#c77c02' } }, h('div', { class: 'wb-glabel' }, '未排期 · 杂事 / 生活'), h('ul', { class: 'tasks' }, float.map((x) => card(x)))) : null,
      h('p', { class: 'wb-hint' }, '拖到某一天即可排期'));
    dropZone(planCol, null);

    // 催办 strip
    const nagCard = (x) => {
      const n = waited(x, t);
      const li = card(x);
      li.classList.add('wb-nagcard', n >= 7 ? 'hot' : n >= 3 ? 'warm' : 'new');
      li.querySelector('.task-main')?.append(h('span', { class: 'wb-age', title: `${zoned(x.created).day} 记下` }, x.done ? '已办完' : n ? `挂了 ${n} 天` : '今天记下'));
      return li;
    };
    const nagInput = h('input', { class: 'add-input', placeholder: '加一条催办：没有截止日，但要尽早办完。回车保存', enterkeyhint: 'done', 'data-k': 'nag', 'aria-label': '添加催办事项' });
    nagInput.addEventListener('keydown', (e) => {
      if (e.isComposing) return;
      if (e.key === 'Enter') { e.preventDefault(); const v = nagInput.value.trim(); if (!v) return; nagInput.value = ''; changeTasks((l) => l.push(newTask(v, weekStart(t), null, NAG)), 'Planner: add nag', again); }
      if (e.key === 'Escape') { nagInput.value = ''; nagInput.blur(); }
    });
    const nagShown = nagAll ? nags : nags.slice(0, NAG_SHOW);
    const oldest = nagOpen.length ? waited(nagOpen[0], t) : 0;
    const nagBox = h('div', { class: `wb-nag${oldest >= 7 ? ' hot' : ''}` },
      h('div', { class: 'wb-nag-head' },
        h('span', { class: 'wb-nag-t' }, icon('flag', 15), '催办'),
        h('span', { class: 'wb-nag-s' }, '没有截止日 · 越早办完越好'),
        h('span', { class: 'wb-nag-n' }, nagOpen.length ? `${nagOpen.length} 项待办${oldest ? ` · 最久 ${oldest} 天` : ''}` : '都办完了')),
      h('div', { class: 'wb-nag-body' },
        nags.length ? h('ul', { class: 'tasks wb-nag-list' }, nagShown.map(nagCard)) : null,
        h('div', { class: 'wb-nag-add' }, nagInput,
          nags.length > NAG_SHOW ? h('button', { class: 'btn small ghost', type: 'button', onclick: () => { nagAll = !nagAll; draw(); } }, nagAll ? '收起' : `还有 ${nags.length - NAG_SHOW} 项`) : null)));
    nagBox.addEventListener('dragover', (e) => { if ([...e.dataTransfer.types].includes('text/x-task')) { e.preventDefault(); nagBox.classList.add('over'); } });
    nagBox.addEventListener('dragleave', (e) => { if (!nagBox.contains(e.relatedTarget)) nagBox.classList.remove('over'); });
    nagBox.addEventListener('drop', (e) => {
      e.preventDefault(); nagBox.classList.remove('over');
      const id = e.dataTransfer.getData('text/x-task'); const x = tasks.find((y) => y.id === id);
      if (!x || (x.cat === NAG && !x.date)) return;
      changeTasks((l) => { const y = l.find((z) => z.id === id); if (!y) return; y.cat = NAG; delete y.date; delete y.time; delete y.end; }, 'Planner: move to nag list', again);
    });

    // 必做实验 strip
    const rankOf = (x) => (Number.isFinite(x.rank) ? x.rank : 1e9);
    const musts = tasks.filter((x) => x.cat === MUST && (!x.done || zoned(x.doneAt || '').day === t))
      .sort((a, b) => Number(a.done) - Number(b.done) || rankOf(a) - rankOf(b) || String(a.created).localeCompare(String(b.created)));
    const mustOpen = musts.filter((x) => !x.done);
    // write the order shown as ranks 1…n, with `id` moved to position `at`
    const reorder = (id, at) => changeTasks((l) => {
      const open = l.filter((x) => x.cat === MUST && !x.done).sort((a, b) => rankOf(a) - rankOf(b) || String(a.created).localeCompare(String(b.created)));
      const i = open.findIndex((x) => x.id === id); const it = i >= 0 ? open.splice(i, 1)[0] : l.find((x) => x.id === id);
      if (!it) return;
      open.splice(Math.max(0, Math.min(at, open.length)), 0, it);
      open.forEach((x, k) => { x.rank = k + 1; });
    }, 'Planner: must-do order', again);
    const mustCard = (x, i) => {
      const n = waited(x, t);
      const li = card(x);
      li.classList.add('wb-mustcard');
      if (!x.done) li.dataset.age = String(Math.min(6, Math.floor(n / 3))); // one shade deeper every 3 days, darkest from 18 days
      if (!x.done && i === 0) li.classList.add('first');
      li.prepend(h('span', { class: 'wb-rank', 'aria-label': `第 ${i + 1} 位` }, x.done ? '✓' : String(i + 1).padStart(2, '0')));
      const tp = topicOf(x);
      li.querySelector('.task-main')?.append(h('span', { class: 'wb-must-meta' },
        tp ? h('span', { class: 'wb-must-topic', style: { '--k': tp.color } }, tp.name) : null,
        h('span', { class: `wb-age${n >= 9 ? ' long' : ''}`, title: `${zoned(x.created).day} 列入必做` }, x.done ? '已完成' : n ? `挂了 ${n} 天` : '今天列入')));
      const more = h('button', { class: 'wb-must-more', type: 'button', 'aria-label': '更多操作', title: '更多' }, icon('more', 16));
      more.addEventListener('click', (e) => {
        e.stopPropagation();
        menu(more, [
          i > 0 && !x.done ? { icon: 'flag', label: '放到第一位', run: () => reorder(x.id, 0) } : null,
          i > 0 && !x.done ? { icon: 'back', label: '上移一位', run: () => reorder(x.id, i - 1) } : null,
          i < mustOpen.length - 1 && !x.done ? { icon: 'next', label: '下移一位', run: () => reorder(x.id, i + 1) } : null,
          !x.done && x.date !== t ? { icon: 'calendar', label: '排到今天', run: () => moveTask(x.id, t, again) } : null,
          { icon: 'plus', label: '开始做：新建实验页', run: () => import('./pages.js').then((m) => m.openNewExperiment('', { title: x.text })) },
          { icon: 'go', label: '退回「待做实验」', run: () => changePlanner((d) => {
            d.tasks = d.tasks.filter((z) => z.id !== x.id);
            d.memos ||= []; d.memos.push({ id: x.from || `m${Date.now().toString(36)}`, text: x.text, pinned: false, created: x.created || new Date().toISOString(), ...(x.topic ? { topic: x.topic } : {}) });
          }, 'Planner: must-do back to to-do', again) },
        ].filter(Boolean));
      });
      li.querySelector('.task-del')?.before(more);
      // drop another card on this one: it takes this place
      li.addEventListener('dragover', (e) => { if ([...e.dataTransfer.types].includes('text/x-task') && !x.done) { e.preventDefault(); e.stopPropagation(); li.classList.add('drop-before'); } });
      li.addEventListener('dragleave', () => li.classList.remove('drop-before'));
      li.addEventListener('drop', (e) => {
        if (x.done) return;
        e.preventDefault(); e.stopPropagation(); li.classList.remove('drop-before'); mustBox.classList.remove('over');
        const id = e.dataTransfer.getData('text/x-task'); const y = tasks.find((z) => z.id === id); if (!y || id === x.id) return;
        if (y.cat !== MUST) changeTasks((l) => { const z = l.find((q) => q.id === id); if (z) { z.cat = MUST; z.created = z.created || new Date().toISOString(); delete z.time; delete z.end; } }, 'Planner: move to must-do', () => reorder(id, i));
        else { const j = mustOpen.findIndex((z) => z.id === id); reorder(id, j >= 0 && j < i ? i - 1 : i); }
      });
      return li;
    };
    let mustTopic = goalTopic;
    const mustInput = h('input', { class: 'add-input', placeholder: '加一项必做实验：一定要做、比待做实验更重要的。回车保存', enterkeyhint: 'done', 'data-k': 'must', 'aria-label': '添加必做实验' });
    const mustTsel = h('select', { class: 'wb-kind', 'aria-label': '课题', title: '属于哪个课题' }, [{ id: '', name: '未分类' }, ...topics].map((o) => h('option', { value: o.id, selected: mustTopic === o.id }, o.name)));
    mustTsel.addEventListener('change', () => { mustTopic = mustTsel.value; goalTopic = mustTsel.value; });
    mustInput.addEventListener('keydown', (e) => {
      if (e.isComposing) return;
      if (e.key === 'Enter') {
        e.preventDefault(); const v = mustInput.value.trim(); if (!v) return; mustInput.value = '';
        const tp = topics.some((o) => o.id === mustTsel.value) ? mustTsel.value : '';
        changePlanner((d) => { if (tp) pinTopicsIn(d); const rank = Math.max(0, ...d.tasks.filter((x) => x.cat === MUST && !x.done).map(rankOf).filter(Number.isFinite).filter((r) => r < 1e9)) + 1; d.tasks.push({ ...newTask(v, weekStart(t), null, MUST), rank, ...(tp ? { topic: tp } : {}) }); }, 'Planner: add must-do', again);
      }
      if (e.key === 'Escape') { mustInput.value = ''; mustInput.blur(); }
    });
    const mustOld = mustOpen.length ? Math.max(...mustOpen.map((x) => waited(x, t))) : 0;
    const mustBox = h('div', { class: 'wb-must' },
      h('div', { class: 'wb-must-head' },
        h('span', { class: 'wb-must-kicker' }, 'MUST-DO · 必须完成'),
        h('span', { class: 'wb-must-t' }, '必做实验'),
        h('span', { class: 'wb-must-s' }, '比「待做实验」高一级：一定要做，按重要性排序'),
        h('span', { class: 'wb-must-n' }, mustOpen.length ? h('b', null, String(mustOpen.length)) : null, mustOpen.length ? ` 项未完成${mustOld ? ` · 最久挂了 ${mustOld} 天` : ''}` : '全部完成'),
        h('span', { class: 'wb-must-legend', title: '挂得越久颜色越深：每 3 天深一级' }, '新', [0, 10, 20, 31, 42, 53, 64].map((k) => h('i', { style: { '--heat': String(k) } })), '久')),
      h('div', { class: 'wb-must-body' },
        musts.length ? h('ol', { class: 'tasks wb-must-list' }, musts.map(mustCard)) : h('p', { class: 'wb-must-empty' }, '还没有。从「课题手记 › 待做实验」点「↑ 必做」，或把任一张卡片拖到这里。'),
        h('div', { class: 'wb-must-add' }, mustInput, mustTsel)));
    mustBox.addEventListener('dragover', (e) => { if ([...e.dataTransfer.types].includes('text/x-task')) { e.preventDefault(); mustBox.classList.add('over'); } });
    mustBox.addEventListener('dragleave', (e) => { if (!mustBox.contains(e.relatedTarget)) mustBox.classList.remove('over'); });
    mustBox.addEventListener('drop', (e) => {
      e.preventDefault(); mustBox.classList.remove('over');
      const id = e.dataTransfer.getData('text/x-task'); const x = tasks.find((y) => y.id === id);
      if (!x || x.cat === MUST) return;
      changeTasks((l) => { const y = l.find((z) => z.id === id); if (!y) return; y.cat = MUST; y.rank = Math.max(0, ...l.filter((z) => z.cat === MUST && !z.done && z.id !== id).map(rankOf).filter((r) => r < 1e9)) + 1; delete y.time; delete y.end; }, 'Planner: move to must-do', again);
    });

    const lateRem = isThis ? fus.filter((x) => !x.done && x.date < t) : [];
    const cols = days.map((day, k) => {
      const mine = dated.filter((x) => x.date === day).sort((a, b) => String(a.time || '99').localeCompare(String(b.time || '99')) || Number(a.done) - Number(b.done) || String(a.created).localeCompare(String(b.created)));
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
          h('p', { class: 'wb-sub' }, `${fmtMD(wk)} – ${fmtMD(days[6])} · 东八区 ${zoned(new Date().toISOString()).time}${total ? ` · 完成 ${done}/${total}` : ''}${overdue.length ? ` · 之前没做完 ${overdue.length}` : ''}${nagOpen.length ? ` · 催办 ${nagOpen.length}` : ''}${mustOpen.length ? ` · 必做实验 ${mustOpen.length}` : ''}`)),
        h('div', { class: 'wb-legend', 'aria-hidden': 'true' }, KINDS.map(([k, c]) => h('span', { style: { '--k': c } }, k))),
        h('div', { class: 'wb-nav' },
          h('button', { class: 'btn small ghost', type: 'button', 'aria-label': '上一周', onclick: () => go(addDays(wk, -7)) }, '‹'),
          h('button', { class: 'btn small ghost', type: 'button', disabled: isThis, onclick: () => go(weekStart(t)) }, '本周'),
          h('button', { class: 'btn small ghost', type: 'button', 'aria-label': '下一周', onclick: () => go(addDays(wk, 7)) }, '›'),
          h('button', { class: 'btn small ghost wide-only', type: 'button', title: '把这一周还没做完的日程和实验提醒存成日历文件（.ics）。打开它加进 Mac 日历，iPhone 和 Apple Watch 会同步并按时提醒', onclick: () => {
            const items = [
              ...dated.filter((x) => !x.done).map((x) => ({ date: x.date, time: x.time, end: x.end, allDay: !x.time, summary: `${kindOf(x) === '待办' ? '' : `【${kindOf(x)}】`}${x.text}`, uid: `task-${x.id}` })),
              ...fus.filter((x) => !x.done && x.date >= wk && x.date <= days[6]).map((it) => ({ date: it.date, allDay: true, summary: it.xid ? `${it.xid} ${it.text}` : it.text, uid: `${it.xid || it.reagent || 'x'}-${it.date}-${it.text}`.replace(/[^\w-]+/g, '') })),
            ];
            if (!items.length) { toast('这一周没有未完成的日程。'); return; }
            downloadText(`lab-week-${wk}.ics`, icsFor(items), 'text/calendar');
            toast(`已导出 ${items.length} 项。打开下载的文件即可加进日历；带时间的按设备当地时间提前 10 分钟提醒，不带时间的当天 9:00 提醒。`);
          } }, '加到日历'),
          standalone ? null : h('a', { class: 'btn small', href: `#/plan/${wk}` }, '周计划与历史 ›'))),
      nagBox,
      mustBox,
      h('div', { class: 'wb-grid' }, planCol, cols),
      h('p', { class: 'wb-foot muted small' }, '拖动卡片换到别的日子；点文字修改；拖到「本周目标」即取消日期；拖进「催办」就变成不设截止日的催办事项；拖进「必做实验」就列为必须做的实验，拖到某一项上即排在它前面。手机上点卡片右侧的日期改天。'));
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
