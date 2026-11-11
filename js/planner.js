// Planner data (planner/tasks.json): to-dos, weekly goals, memos, projects, papers; the week view; follow-up reminders.
import { NetworkError } from './store.js';
import { fmtDate, nowISO, todayISO } from './model.js';
import {
  addDays, daysFrom, icsFor, loadReagents, loadSolutions, parseFollowup, reagentAlerts, solutionAlerts,
  PROJECT_STAGE, PROJECT_PRIORITY, REVIEW_EVERY, projectReviewAlerts,
} from './lab.js';
import { h, icon } from './util.js';
import { choose, demoBanner, downloadText, field, lib, modal, saveError, show, toast, topbar, view } from './core.js';
import { hero, redrawHome, uid, cardHead, foldList } from './home.js';
import { toggleFollowup } from './pages.js';
import { route } from './app.js';
import { weekBoard } from './weekboard.js';
import { LOOSE_COLOR, pinTopicsIn, topicsOf } from './finds.js';

// Which research direction (课题) a project belongs to: the one picked, else the one of its first linked volume.
export function projectTopic(p, topics) {
  return topics.find((t) => t.id === p.topic) || (p.topic === '' ? null : topics.find((t) => (p.vols || []).some((v) => t.id === `v:${v}`))) || null;
}
export const topicChip = (tp) => h('span', { class: 'tp-chip', style: { '--k': tp ? tp.color : LOOSE_COLOR } }, tp ? tp.name : '未归类');
let boardTopic = '*';

// ----- projects (课题): one list from a first idea to a finished grant; kept with the planner -----
// Mark a project as reviewed: one line of current thinking, then the next review is scheduled.
export function reviewProject(id) {
  const p = planLocal?.doc.projects.find((x) => x.id === id);
  if (!p) return;
  const note = h('textarea', { id: 'rv-note', rows: 3, placeholder: '这次想到了什么、有什么新进展或新文献（可不填）' });
  modal({
    title: `回顾：${p.title}`,
    body: h('div', { class: 'form' }, p.why ? h('p', { class: 'muted' }, p.why) : null, h('label', { for: 'rv-note' }, '这次的想法'), note,
      h('p', { class: 'muted' }, p.every ? `保存后下次回顾：${addDays(todayISO(), p.every)}` : '')),
    buttons: [{ label: '取消' }, { label: '已回顾', primary: true, run: () => {
      changePlanner((d) => { const y = d.projects.find((z) => z.id === id); if (!y) return; y.reviews = [...(y.reviews || []), { at: nowISO(), note: note.value.trim() }]; if (y.every) y.nextReview = addDays(todayISO(), y.every); }, `Project: review ${id}`, redrawAll);
      toast('已回顾，已排到下一次。');
    } }],
  });
}
const moveStage = (id, dir) => changePlanner((d) => { const y = d.projects.find((z) => z.id === id); const k = PROJECT_STAGE.indexOf(y?.stage) + dir; if (y && k >= 0 && k < PROJECT_STAGE.length) y.stage = PROJECT_STAGE[k]; }, 'Project: stage', redrawAll);
// Home rails and the board both show projects; whichever is on screen redraws.
const redrawAll = () => { redrawHome(); boardHooks.forEach((f) => f()); };
const boardHooks = new Set();
const reviewText = (p) => (p.every ? (p.nextReview ? (daysFrom(p.nextReview) <= 0 ? '该回顾了' : `${daysFrom(p.nextReview)} 天后回顾`) : '定期回顾') : '');

// 课题看板: one column per stage, ideas on the left, finished work on the right.
export async function viewProjects() {
  const board = h('div', { class: 'pj-board' });
  const ended = h('div', { class: 'pj-ended' });
  const filter = h('div', { class: 'clip-chips tp-filters', role: 'group', 'aria-label': '按方向筛选' });
  const draw = async () => {
    const doc = await loadPlanner();
    const topics = topicsOf(doc);
    const tOf = (p) => projectTopic(p, topics);
    const all = doc.projects;
    const projects = boardTopic === '*' ? all : all.filter((p) => (tOf(p)?.id || '') === boardTopic);
    const order = (p) => { const k = topics.findIndex((t) => t.id === tOf(p)?.id); return k < 0 ? 99 : k; };
    const n = (id) => all.filter((p) => p.stage !== '已结束' && (tOf(p)?.id || '') === id).length;
    filter.replaceChildren(...[['*', '全部方向', null, all.filter((p) => p.stage !== '已结束').length], ...topics.map((t) => [t.id, t.name, t.color, n(t.id)]), ['', '未归类', LOOSE_COLOR, n('')]]
      .filter(([id, , , k]) => id === '*' || k || boardTopic === id)
      .map(([id, label, color, k]) => h('button', { type: 'button', class: `chip tp-filter${boardTopic === id ? ' on' : ''}`, style: color ? { '--k': color } : null, 'aria-pressed': String(boardTopic === id), onclick: () => { boardTopic = id; draw(); } }, label, h('b', null, String(k)))));
    const card = (p) => h('div', { class: `tile pj-card pr-${p.priority || '中'}`, style: { '--k': tOf(p)?.color || LOOSE_COLOR }, onclick: (e) => { if (!e.target.closest('a, button')) editProject(p); } },
      h('div', { class: 'pj-top' }, h('span', { class: 'bi-kind' }, p.kind || '课题'), p.priority === '高' ? h('span', { class: 'pj-hi' }, '高优先') : null,
        h('span', { class: 'pj-move' },
          h('button', { class: 'btn icon small ghost', type: 'button', title: '移到上一阶段', 'aria-label': '移到上一阶段', disabled: PROJECT_STAGE.indexOf(p.stage) <= 0, onclick: () => moveStage(p.id, -1) }, '‹'),
          h('button', { class: 'btn icon small ghost', type: 'button', title: '移到下一阶段', 'aria-label': '移到下一阶段', disabled: PROJECT_STAGE.indexOf(p.stage) >= PROJECT_STAGE.length - 1, onclick: () => moveStage(p.id, 1) }, '›'))),
      h('h3', null, p.title),
      h('div', null, topicChip(tOf(p))),
      p.why ? h('p', { class: 'pj-why' }, p.why) : null,
      p.next || p.due ? h('div', { class: 'bi-meta' }, p.next ? h('span', null, `下一步：${p.next}`) : null, p.due ? h('span', { class: 'due-tag' }, `截止 ${p.due}`) : null) : null,
      (p.vols || []).length ? h('div', { class: 'bi-vols' }, p.vols.map((id) => lib.volume(id)).filter(Boolean).flatMap((v) => [h('a', { href: `#/v/${v.id}` }, v.title), h('a', { class: 'bi-m', href: `#/v/${v.id}/methods` }, '方法细节')])) : null,
      p.every ? h('div', { class: 'pj-review' }, h('span', { class: daysFrom(p.nextReview || '9999-12-31') <= 0 ? 'due' : null }, reviewText(p)),
        h('button', { class: 'btn small', type: 'button', onclick: () => reviewProject(p.id) }, '回顾')) : null);
    board.replaceChildren(...PROJECT_STAGE.slice(0, -1).map((st) => {
      const list = projects.filter((p) => (p.stage || '想法') === st).sort((a, b) => order(a) - order(b));
      return h('section', { class: 'pj-col' }, h('h2', null, st, h('span', null, String(list.length))), list.map(card),
        h('button', { class: 'btn small ghost pj-add', type: 'button', onclick: () => editProject(null, { stage: st }) }, icon('plus', 14), st === '想法' ? '记一个想法' : '新建'));
    }));
    const done = projects.filter((p) => p.stage === '已结束');
    ended.replaceChildren(...(done.length ? [h('details', null, h('summary', null, `已结束 ${done.length}`), h('div', { class: 'pj-done' }, done.map(card)))] : []));
  };
  boardHooks.clear(); boardHooks.add(draw);
  await draw();
  return h('div', { class: 'view projects' },
    topbar({ back: '#/', backLabel: '首页', title: '课题看板', sub: '想法 → 调研 → 申请 → 进行 → 结题', actions: [
      h('button', { class: 'btn primary', type: 'button', onclick: () => editProject(null, { stage: '想法' }) }, icon('plus', 18), h('span', null, '新建课题'))] }),
    demoBanner(),
    h('div', { class: 'pj-wrap' }, h('p', { class: 'muted pj-lead' }, '点 ‹ › 推进阶段，点卡片修改。每张卡片归到一个研究方向，颜色与课题手记一致。'), filter, board, ended));
}

// ----- calendar export -----
export function exportIcs(items, name = 'lab-reminders.ics') {
  if (!items.length) { toast('没有未完成的提醒。'); return; }
  downloadText(name, icsFor(items.map((it) => ({
    date: it.date, summary: it.xid ? `${it.xid} ${it.text}` : it.text,
    description: it.page ? `${location.origin}${location.pathname}#/v/${it.page.vol}/${it.page.num}` : '',
    uid: `${it.xid || it.reagent || 'x'}-${it.date}-${it.text}`.replace(/[^\w-]+/g, ''),
  }))), 'text/calendar');
}

export async function openFollowups() {
  const items = await allFollowups();
  const open = items.filter((x) => !x.done);
  exportIcs(open);
}
export async function allFollowups() {
  const items = [];
  for (const p of lib.allPages()) {
    if (p.void) continue;
    (p.followups || []).forEach((s, i) => { const f = parseFollowup(s); if (f) items.push({ ...f, index: i, page: p, xid: p.xid }); });
  }
  const reagents = await loadReagents(lib).catch(() => []);
  for (const a of reagentAlerts(reagents)) items.push({ ...a, done: false });
  for (const a of solutionAlerts(await loadSolutions(lib).catch(() => []))) items.push({ ...a, done: false });
  for (const a of projectReviewAlerts((await loadPlanner().catch(() => ({}))).projects, 7)) items.push({ ...a, done: false });
  return items.sort((a, b) => a.date.localeCompare(b.date));
}

// ----- planner: today's to-dos and the week's plan, kept in planner/tasks.json -----
// task = { id, text, week: <Monday ISO>, date?: <ISO> (a to-do for that day; none = a weekly goal), cat?, done, doneAt?, created }
// cat files a task under a home-page side list (杂事, 生活, 文献, 仪器, 截止); dated ones still show in that day's to-dos.
// projects / papers: the 课题与基金 and 论文与投稿 cards on the home page's left rail.
export const TASKS_PATH = 'planner/tasks.json';
export const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];
export const weekStart = (iso) => addDays(iso, -((new Date(`${iso}T12:00:00`).getDay() + 6) % 7));
export let planLocal = null; // { sha, doc: { tasks, memos }, dirty } — shown at once; commits follow in order
export let planQueue = Promise.resolve();
export const arr = (x) => (Array.isArray(x) ? x : []);
export const planDoc = (d) => ({ tasks: arr(d?.tasks), memos: arr(d?.memos), projects: arr(d?.projects), papers: arr(d?.papers), finds: arr(d?.finds), ...(Array.isArray(d?.topics) ? { topics: d.topics } : {}) });
// Other writers of planner/tasks.json (the weekly filing of 碎片发现) wait their turn in the same queue.
export function queuePlanner(job) {
  const p = planQueue.then(job);
  planQueue = p.catch(() => {}).then(() => { if (planLocal && !planLocal.dirty) planLocal = null; }); // a failed job must not block later saves
  return p.finally(() => planQueue);
}
export async function loadPlanner() {
  const fresh = () => planLocal && (planLocal.sha === (lib.tree.get(TASKS_PATH) || null) || planLocal.dirty > 0);
  if (fresh()) return planLocal.doc;
  const sha = lib.tree.get(TASKS_PATH) || null;
  const doc = planDoc(await lib.readJSON(TASKS_PATH, {}));
  // Two callers may read at once: the first one to finish installs the copy, the other uses it (an edit may already sit on it).
  if (fresh()) return planLocal.doc;
  planLocal = { sha, doc, dirty: 0 };
  return planLocal.doc;
}
export const loadTasks = async () => (await loadPlanner()).tasks;
// An edit runs twice: at once on the copy on screen, then again on the fresh file when it is saved. Ids made the
// first time are replayed the second time, so what is on screen and what is saved carry the same ids.
let idTape = null;
export const freshId = (make) => { if (!idTape) return make(); if (idTape.play) return idTape.ids[idTape.i++] ?? make(); const v = make(); idTape.ids.push(v); return v; };
const taped = (tape, play, f) => { idTape = { ids: tape, play, i: 0 }; try { return f(); } finally { idTape = null; } };
export function changePlanner(mutate, message, redraw) {
  const mine = planLocal; // the count of unsaved edits belongs to this copy, whatever replaces it later
  const tape = [];
  taped(tape, false, () => mutate(mine.doc)); mine.dirty += 1;
  redraw?.(); refreshDueBar();
  planQueue = planQueue.then(() => lib.commit(message, async (l) => {
    const doc = planDoc(await l.readJSON(TASKS_PATH, {}));
    taped(tape, true, () => mutate(doc));
    return { changes: [{ path: TASKS_PATH, data: `${JSON.stringify(doc, null, 1)}\n` }], after: () => { mine.dirty -= 1; if (!mine.dirty) mine.doc = doc; } };
  })).then(() => { if (planLocal === mine && !mine.dirty) mine.sha = lib.tree.get(TASKS_PATH); })
    .catch((e) => { toast(e instanceof NetworkError ? '离线中：没有同步，联网后请再操作一次。' : `没有保存：${e.message}`); mine.dirty = 0; if (planLocal === mine) planLocal = null; redraw?.(); refreshDueBar(); });
  return planQueue;
}
export const changeTasks = (mutate, message, redraw) => changePlanner((d) => mutate(d.tasks), message, redraw);
export const newTask = (text, week, date, cat) => ({ id: freshId(() => `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`), text, week, ...(date ? { date } : {}), ...(cat ? { cat } : {}), done: false, created: nowISO() });
export const isGoal = (x, wk) => x.week === wk && !x.date && !x.cat;
export const toggleTask = (id, redraw) => changeTasks((list) => { const t = list.find((x) => x.id === id); if (t) { t.done = !t.done; if (t.done) t.doneAt = nowISO(); else delete t.doneAt; } }, 'Planner: tick', redraw);
export const removeTask = (id, redraw) => changeTasks((list) => { const k = list.findIndex((x) => x.id === id); if (k >= 0) list.splice(k, 1); }, 'Planner: remove', redraw);
export const editTask = (id, text, redraw) => changeTasks((list) => { const t = list.find((x) => x.id === id); if (t) t.text = text; }, 'Planner: edit', redraw);
export const moveTask = (id, date, redraw) => changeTasks((list) => { const t = list.find((x) => x.id === id); if (!t) return; if (date) { t.date = date; t.week = weekStart(date); } else delete t.date; }, 'Planner: move', redraw);

// Click the text to edit it in place; Enter or leaving the field saves, Esc cancels.
export function editable(text, onSave, cls = 'task-text') {
  const span = h('span', { class: `${cls} editable`, tabindex: '0', title: '点击修改' }, text);
  const start = () => {
    const input = h('input', { class: `${cls} edit-input`, value: text, 'aria-label': '修改' });
    let done = false;
    const finish = (save) => { if (done) return; done = true; const v = input.value.trim(); input.replaceWith(span); if (save && v && v !== text) { span.textContent = v; onSave(v); } };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); finish(true); } if (e.key === 'Escape') finish(false); });
    input.addEventListener('blur', () => finish(true));
    span.replaceWith(input); input.focus(); input.select();
  };
  span.addEventListener('click', start);
  span.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); start(); } });
  return span;
}
export const dayLabel = (iso) => { const d = daysFrom(iso); return d === 0 ? '今天' : d === 1 ? '明天' : d === -1 ? '昨天' : iso.slice(5); };
// Date chip: shows 今天 / 明天 / 11-05 and opens the date picker; a weekly goal shows 本周.
export function dateChip(t, redraw) {
  const input = h('input', { type: 'date', class: 'date-input', value: t.date || '', 'aria-label': '改日期' });
  input.addEventListener('change', () => moveTask(t.id, input.value || null, redraw));
  const late = t.date && !t.done && t.date < todayISO();
  return h('label', { class: `date-chip${late ? ' late' : ''}`, title: t.date ? (t.cat ? '改日期（可清空）' : '改日期（清空则变为本周计划）') : '指定到某一天' }, t.date ? dayLabel(t.date) : t.cat === '催办' ? '排日期' : t.cat ? '无日期' : '本周', input);
}

export function ring(done, total, size = 64) {
  const r = (size - 8) / 2; const c = 2 * Math.PI * r; const f = total ? done / total : 0;
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`); svg.setAttribute('class', 'ring'); svg.setAttribute('width', size); svg.setAttribute('height', size);
  svg.innerHTML = `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="ring-bg"/><circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="ring-fg" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - f)}" transform="rotate(-90 ${size / 2} ${size / 2})"/>`;
  return h('div', { class: 'ring-box', role: 'img', 'aria-label': `已完成 ${done} / ${total}` }, svg, h('span', { class: 'ring-num' }, total ? `${Math.round(f * 100)}%` : '—'));
}
export function taskRow(t, { redraw, extra, meta, showCat = true } = {}) {
  if (!meta && t.src) meta = h('a', { href: `#/v/${t.src.vol}/${t.src.num}` }, `来自 ${t.src.xid || `p. ${t.src.num}`}`);
  if (!meta && t.cat && showCat) meta = h('span', { class: `cat-chip cat-${t.cat}` }, t.cat);
  return h('li', { class: `task${t.done ? ' done' : ''}` },
    h('button', { class: 'tick', type: 'button', role: 'checkbox', 'aria-checked': String(!!t.done), 'aria-label': t.done ? '标为未完成' : '标为完成', onclick: () => toggleTask(t.id, redraw) }),
    h('span', { class: 'task-main' }, editable(t.text, (v) => editTask(t.id, v, redraw)), meta ? h('span', { class: 'task-meta' }, meta) : null),
    extra || null,
    dateChip(t, redraw),
    h('button', { class: 'task-del', type: 'button', 'aria-label': '删除', title: '删除', onclick: () => removeTask(t.id, redraw) }, icon('close', 14)));
}
export function reminderRow(x, redraw) {
  const d = daysFrom(x.date);
  return h('li', { class: `task reminder${x.done ? ' done' : ''}${d < 0 && !x.done ? ' late' : ''}` },
    x.page ? h('button', { class: 'tick', type: 'button', role: 'checkbox', 'aria-checked': String(!!x.done), 'aria-label': '完成', onclick: async () => { await toggleFollowup(x.page.vol, x.page.num, x.index); redraw(); } })
      : x.project ? h('button', { class: 'tick', type: 'button', role: 'checkbox', 'aria-checked': 'false', 'aria-label': '已回顾', title: '已回顾（记一句想法，自动排到下一次）', onclick: () => reviewProject(x.project) }) : h('span', { class: 'tick static' }),
    h(x.page || x.project ? 'a' : 'span', { class: 'task-text', href: x.page ? `#/v/${x.page.vol}/${x.page.num}` : x.project ? '#/projects' : null }, x.text,
      h('span', { class: 'task-meta' }, [d < 0 ? `逾期 ${-d} 天` : d === 0 ? '今天' : `${d} 天后`, x.xid || (x.reagent ? '试剂库' : '')].filter(Boolean).join(' · '))),
    h('span', { class: 'chip' }, x.reagent ? '试剂' : x.solution ? '溶液' : x.project ? '课题' : '复测'));
}
export function addBox(placeholder, onAdd) {
  const input = h('input', { class: 'add-input', placeholder, enterkeyhint: 'done', 'aria-label': placeholder });
  const go = () => { const v = input.value.trim(); if (!v) return; input.value = ''; onAdd(v); input.focus(); };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); go(); } });
  return h('div', { class: 'add-row' }, h('span', { class: 'add-plus' }, icon('plus', 16)), input, h('button', { class: 'btn small add-btn', type: 'button', onclick: go }, '添加'));
}

// Sticky notes: anything to remember that isn't a task for a given day.
export const PIN_SVG = '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="M9 3h6l-1 6 4 3v2h-5v7l-1 1-1-1v-7H6v-2l4-3z" fill="currentColor"/></svg>';
export function memoCard(doc, draw) {
  const memos = [...doc.memos].sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || String(b.updated || b.created).localeCompare(String(a.updated || a.created)));
  const pinned = memos.filter((m) => m.pinned).length;
  const upd = (id, f, msg) => changePlanner((d) => { const m = d.memos.find((x) => x.id === id); if (m) f(m, d); }, msg, draw);
  const add = addBox('记一条备忘', (text) => changePlanner((d) => d.memos.push({ id: `m${Date.now().toString(36)}`, text, pinned: false, created: nowISO() }), 'Memo: add', draw));
  add.querySelector('input').dataset.k = 'memo';
  return h('div', { class: 'tile memo-card' },
    cardHead('备忘录', memos.length ? `${memos.length} 条${pinned ? ` · 置顶 ${pinned}` : ''}` : '耗材、要问导师的问题、灵感', { add }),
    add,
    foldList(h('ul', { class: 'memos' }, memos.map((m) => h('li', { class: `memo${m.pinned ? ' pinned' : ''}` },
      h('div', { class: 'memo-main' },
        editable(m.text, (v) => upd(m.id, (x) => { x.text = v; x.updated = nowISO(); }, 'Memo: edit'), 'memo-text'),
        h('span', { class: 'memo-date' }, fmtDate(m.updated || m.created))),
      h('button', { class: 'memo-pin', type: 'button', 'aria-pressed': String(!!m.pinned), 'aria-label': m.pinned ? '取消置顶' : '置顶', title: m.pinned ? '取消置顶' : '置顶', html: PIN_SVG, onclick: () => upd(m.id, (x) => { x.pinned = !x.pinned; }, 'Memo: pin') }),
      h('button', { class: 'task-del', type: 'button', 'aria-label': '删除', title: '删除', onclick: () => changePlanner((d) => { d.memos = d.memos.filter((x) => x.id !== m.id); }, 'Memo: remove', draw) }, icon('close', 14))))), 'memos'));
}

// Reminder strip under the top bar on every page while today's or earlier to-dos are open.
export async function refreshDueBar() {
  const bar = document.getElementById('due-bar');
  if (!bar || !lib?.head) return;
  if (view.kind === 'home') { bar.hidden = true; return; } // the home page shows today's card itself
  try {
    const t = todayISO();
    const [tasks, fus] = await Promise.all([loadTasks(), allFollowups()]);
    const open = [...tasks.filter((x) => x.date && x.date <= t && !x.done), ...fus.filter((x) => !x.done && x.date <= t)];
    const late = open.filter((x) => x.date < t).sort((a, b) => a.date.localeCompare(b.date));
    const key = `${t}:${open.length}`;
    let hidden = false; try { hidden = sessionStorage.getItem('due-hide') === key; } catch { /* ignore */ }
    if (!open.length || hidden) { bar.hidden = true; return; }
    const d = new Date(`${t}T12:00:00`);
    bar.hidden = false;
    bar.replaceChildren(h('a', { class: 'due-link', href: '#/' },
      h('span', { class: 'due-dot' }),
      h('span', null, h('b', null, `还有 ${open.length} 项待办未完成`),
        late.length ? h('span', { class: 'due-late' }, `　其中 ${late.length} 项已逾期，最早 ${late[0].date.slice(5)}`) : null,
        h('span', { class: 'due-date' }, `　· 今天 ${d.getMonth() + 1} 月 ${d.getDate()} 日 星期${WEEKDAYS[(d.getDay() + 6) % 7]}`)),
      h('span', { class: 'due-go' }, '查看 ›')),
    h('button', { class: 'due-x', type: 'button', 'aria-label': '今天先不提示', title: '先隐藏（数量变化或明天会再提示）', onclick: () => { try { sessionStorage.setItem('due-hide', key); } catch { /* ignore */ } bar.hidden = true; } }, icon('close', 14)));
  } catch (e) { console.warn('due bar', e); bar.hidden = true; }
}

// ----- home side rails: 科研主线 on the left, 时间与日常 on the right -----
export const PROJECT_KIND = ['课题', '基金', '合作'];
export const PAPER_STAGE = ['构思', '写作中', '已投稿', '审稿中', '返修', '接收', '已发表'];
export function editProject(p, preset = {}) {
  const isNew = !p; const x = p ? { ...p } : { id: uid('P'), kind: '课题', stage: '想法', priority: '中', every: 0, vols: [], created: nowISO(), ...preset };
  const f = (k, label, attrs = {}) => { const el = h('input', { id: `pj-${k}`, value: x[k] || '', ...attrs }); return [h('label', { for: `pj-${k}` }, label), el]; };
  const sel = (k, label, opts) => [h('label', { for: `pj-${k}` }, label), h('select', { id: `pj-${k}` }, opts.map((o) => h('option', { selected: x[k] === o }, o)))];
  const topics = topicsOf(planLocal?.doc);
  const cur = isNew && boardTopic !== '*' ? boardTopic : projectTopic(x, topics)?.id || '';
  const dir = h('select', { id: 'pj-topic' }, [{ id: '', name: '未归类' }, ...topics].map((o) => h('option', { value: o.id, selected: cur === o.id }, o.name)));
  const vols = h('div', { class: 'check-list' }, lib.volumes().map((v) => h('label', { class: 'check' }, h('input', { type: 'checkbox', value: v.id, checked: (x.vols || []).includes(v.id) }), ` ${v.title}`)));
  const body = h('div', { class: 'form' }, ...f('title', '名称', { placeholder: '例如：国自然青年基金 · 唾液 OECT 早筛' }),
    h('div', { class: 'pair' }, h('div', null, ...sel('kind', '类型', PROJECT_KIND)), h('div', null, ...sel('stage', '阶段', PROJECT_STAGE))),
    h('label', { for: 'pj-topic' }, '所属方向（和哪个大课题最相关）'), dir,
    ...f('next', '下一个节点', { placeholder: '例如：提交申请书 / 中期报告 / 完成预实验' }), ...f('due', '截止日期', { type: 'date' }),
    h('label', { for: 'pj-why' }, '为什么值得做'), h('textarea', { id: 'pj-why', rows: 3, placeholder: '动机、科学问题、和现有课题的关系…' }, x.why || ''),
    h('div', { class: 'pair' }, h('div', null, ...sel('priority', '优先级', PROJECT_PRIORITY)),
      h('div', null, h('label', { for: 'pj-every' }, '定期回顾'), h('select', { id: 'pj-every' }, REVIEW_EVERY.map(([d, l]) => h('option', { value: d, selected: Number(x.every || 0) === d }, l))))),
    ...f('note', '备注', { placeholder: '编号、经费、合作人、相关假设 H-0001…' }), h('span', { class: 'label' }, '关联的实验卷'), vols,
    (x.reviews || []).length ? h('details', { class: 'pj-reviews' }, h('summary', null, `回顾记录（${x.reviews.length}）`),
      h('ol', { class: 'hist-list' }, [...x.reviews].reverse().map((r) => h('li', null, h('span', { class: 'ev-date' }, fmtDate(r.at)), ' ', r.note || '（无备注）')))) : null);
  modal({
    title: isNew ? '新建课题' : x.title, body, wide: true,
    buttons: [isNew ? null : { label: '删除', danger: true, run: async () => { if ((await choose(`删除“${x.title}”？`, 'GitHub 历史里仍可找回。', [['yes', '删除'], ['no', '取消']])) !== 'yes') return false; changePlanner((d) => { d.projects = d.projects.filter((y) => y.id !== x.id); }, 'Board: remove project', redrawAll); } },
      { label: '取消' }, { label: '保存', primary: true, run: () => {
        for (const k of ['title', 'next', 'due', 'note', 'why']) x[k] = body.querySelector(`#pj-${k}`).value.trim();
        x.kind = body.querySelector('#pj-kind').value; x.stage = body.querySelector('#pj-stage').value; x.priority = body.querySelector('#pj-priority').value;
        const every = Number(body.querySelector('#pj-every').value) || 0;
        if (every !== Number(x.every || 0) || (every && !x.nextReview)) x.nextReview = every ? addDays(todayISO(), every) : undefined;
        x.every = every;
        x.vols = [...vols.querySelectorAll('input:checked')].map((c) => c.value);
        x.topic = dir.value;
        if (!x.title) { toast('写一个名称。'); return false; }
        changePlanner((d) => { if (x.topic) pinTopicsIn(d); const k = d.projects.findIndex((y) => y.id === x.id); if (k >= 0) d.projects[k] = x; else d.projects.push(x); }, `Board: ${isNew ? 'add' : 'edit'} project`, redrawAll);
      } }],
  });
}
// ----- comments on a paper's figures and manuscript (the advisor's pen marks on the printout, typed in) -----
// Kept on the paper itself: paper.fig / paper.ms = [{ id, text, where, by, done, at }].
export const PAPER_NOTES = { fig: ['Figures', '图的意见', '位置，如 Fig. 2b'], ms: ['Manuscript', '稿件的意见', '位置，如 p. 3 第 2 段 / Abstract'] };
const NOTE_BY = ['导师', '我', '合作者', '审稿人'];
export const paperNoteCount = (p, kind) => arr(p?.[kind]).length;
export function openPaperNotes(paperId, kind) {
  const [name, label, wherePh] = PAPER_NOTES[kind];
  const paper = () => planLocal?.doc.papers.find((x) => x.id === paperId);
  if (!paper()) return;
  let by = '导师'; try { by = localStorage.getItem('labnote-note-by') || '导师'; } catch { /* private window */ }
  const list = h('ul', { class: 'tasks pn-list' });
  const sum = h('p', { class: 'muted small' });
  const upd = (mutate, msg) => changePlanner((d) => { const y = d.papers.find((z) => z.id === paperId); if (!y) return; y[kind] = arr(y[kind]); mutate(y[kind]); }, msg, () => { draw(); redrawHome(); });
  const draw = () => {
    const items = arr(paper()?.[kind]);
    const open = items.filter((x) => !x.done);
    sum.textContent = items.length ? `共 ${items.length} 条 · ${open.length} 条未处理` : '还没有。把打印稿上的批注一条一条敲进来，改完一条勾一条。';
    list.replaceChildren(...[...open, ...items.filter((x) => x.done)].map((x) => h('li', { class: `task pn-item${x.done ? ' done' : ''}` },
      h('button', { class: 'tick', type: 'button', role: 'checkbox', 'aria-checked': String(!!x.done), 'aria-label': x.done ? '标为未处理' : '标为已改', onclick: () => upd((l) => { const y = l.find((z) => z.id === x.id); if (y) { y.done = !y.done; if (y.done) y.doneAt = nowISO(); else delete y.doneAt; } }, 'Paper notes: tick') }),
      h('span', { class: 'task-main' },
        editable(x.text, (v) => upd((l) => { const y = l.find((z) => z.id === x.id); if (y) y.text = v; }, 'Paper notes: edit'), 'task-text'),
        h('span', { class: 'task-meta' }, x.where ? h('span', { class: 'pn-where' }, x.where) : null, h('span', { class: `pn-by${x.by === '导师' ? ' boss' : ''}` }, x.by || '我'), fmtDate(x.at))),
      h('button', { class: 'task-del', type: 'button', 'aria-label': '删除', title: '删除', onclick: () => upd((l) => { const k = l.findIndex((z) => z.id === x.id); if (k >= 0) l.splice(k, 1); }, 'Paper notes: remove') }, icon('close', 14)))));
  };
  const where = h('input', { id: 'pn-where', placeholder: wherePh, autocomplete: 'off' });
  const who = h('select', { id: 'pn-by', 'aria-label': '谁提的' }, NOTE_BY.map((o) => h('option', { selected: by === o }, o)));
  who.addEventListener('change', () => { try { localStorage.setItem('labnote-note-by', who.value); } catch { /* private window */ } });
  const text = h('textarea', { id: 'pn-text', rows: 3, placeholder: '意见原话。回车保存；一次贴多行 = 每行一条（Shift+回车换行）' });
  const add = () => {
    const lines = text.value.split(/\n+/).map((l) => l.replace(/^\s*(?:[-•*]|\d+[.、)）])\s*/, '').trim()).filter(Boolean);
    if (!lines.length) return false;
    const w = where.value.trim(); const b = who.value; text.value = '';
    upd((l) => { for (const t of lines) l.push({ id: uid('N'), text: t, ...(w ? { where: w } : {}), by: b, done: false, at: nowISO() }); }, `Paper notes: add ${name}`);
    text.focus(); return false;
  };
  text.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); add(); } });
  draw();
  modal({ title: `${name} · ${paper().title}`, wide: true,
    body: h('div', { class: 'form paper-notes' },
      h('div', { class: 'pair' }, h('div', null, h('label', { for: 'pn-where' }, '位置（可不填）'), where), h('div', null, h('label', { for: 'pn-by' }, '谁提的'), who)),
      h('label', { for: 'pn-text' }, label), text, sum, list),
    buttons: [{ label: '关闭' }, { label: '添加', primary: true, run: add }] });
  setTimeout(() => text.focus(), 40);
}
export function editPaper(p) {
  const isNew = !p; const x = p ? { ...p } : { id: uid('A'), stage: '写作中' };
  const f = (k, label, attrs = {}) => [h('label', { for: `pp-${k}` }, label), h('input', { id: `pp-${k}`, value: x[k] || '', ...attrs })];
  const body = h('div', { class: 'form' }, ...f('title', '题目（可简写）', { placeholder: '例如：Printed OECT for salivary MMP-8' }),
    h('div', { class: 'pair' }, h('div', null, ...f('journal', '期刊 / 会议', { placeholder: 'Adv. Mater.' })),
      h('div', null, h('label', { for: 'pp-stage' }, '阶段'), h('select', { id: 'pp-stage' }, PAPER_STAGE.map((o) => h('option', { selected: x.stage === o }, o))))),
    ...f('due', '关键日期（截稿 / 返修截止）', { type: 'date' }), ...f('note', '备注', { placeholder: '稿件号、共同作者、审稿意见要点…' }));
  modal({
    title: isNew ? '新建论文' : x.title, body,
    buttons: [isNew ? null : { label: '删除', danger: true, run: async () => { if ((await choose(`删除“${x.title}”？`, 'GitHub 历史里仍可找回。', [['yes', '删除'], ['no', '取消']])) !== 'yes') return false; changePlanner((d) => { d.papers = d.papers.filter((y) => y.id !== x.id); }, 'Board: remove paper', redrawHome); } },
      { label: '取消' }, { label: '保存', primary: true, run: () => {
        for (const k of ['title', 'journal', 'due', 'note']) x[k] = body.querySelector(`#pp-${k}`).value.trim();
        x.stage = body.querySelector('#pp-stage').value;
        if (!x.title) { toast('写一个题目。'); return false; }
        changePlanner((d) => { const k = d.papers.findIndex((y) => y.id === x.id); if (k >= 0) d.papers[k] = x; else d.papers.push(x); }, `Board: ${isNew ? 'add' : 'edit'} paper`, redrawHome);
      } }],
  });
}
// Week view: every day's to-dos and the week's goals, with history of earlier weeks.
export async function viewPlan(param) {
  const t = todayISO();
  const wk = weekStart(/^\d{4}-\d{2}-\d{2}$/.test(param || '') ? param : t);
  const hooks = new Set();
  const redraw = () => hooks.forEach((f) => f());
  const stats = h('div', { class: 'plan-stats' });
  const hist = h('div');
  const draw = async () => {
    const tasks = await loadTasks();
    const goals = tasks.filter((x) => isGoal(x, wk));
    const allDay = tasks.filter((x) => x.week === wk && x.date);
    const gd = goals.filter((x) => x.done).length; const dd = allDay.filter((x) => x.done).length;
    stats.replaceChildren(
      h('div', { class: 'tile stat' }, ring(gd, goals.length, 56), h('div', null, h('b', null, `${gd} / ${goals.length}`), h('span', null, '本周计划（待安排）完成'))),
      h('div', { class: 'tile stat' }, ring(dd, allDay.length, 56), h('div', null, h('b', null, `${dd} / ${allDay.length}`), h('span', null, '每日待办完成'))),
      h('div', { class: 'tile stat' }, h('div', null, h('b', null, `${goals.length - gd + allDay.length - dd}`), h('span', null, '尚未完成'))));
    const weeks = [...new Set(tasks.map((x) => x.week))].filter((w) => w < wk).sort().reverse().slice(0, 12);
    hist.replaceChildren(...(weeks.length ? [h('h2', { class: 'section-title' }, '往周'), h('div', { class: 'tile' }, h('ul', { class: 'history' }, weeks.map((w) => {
      const all = tasks.filter((x) => x.week === w && (x.date || !x.cat)); const dn = all.filter((x) => x.done).length;
      return h('li', null, h('a', { href: `#/plan/${w}` }, h('span', { class: 'hw' }, `${w} 至 ${addDays(w, 6).slice(5)}`),
        h('span', { class: 'hbar' }, h('span', { style: { width: `${all.length ? (dn / all.length) * 100 : 0}%` } })),
        h('span', { class: 'hn' }, `${dn} / ${all.length}`)));
    })))] : []));
  };
  hooks.add(() => draw().catch((e) => stats.replaceChildren(h('p', { class: 'warn' }, e.message))));
  await draw().catch((e) => stats.replaceChildren(h('p', { class: 'warn' }, e.message)));
  const board = weekBoard({ week: wk, standalone: true, hooks, redraw });
  return h('div', { class: 'view plan' },
    topbar({ back: '#/', backLabel: '首页', title: '周计划', sub: `${wk} 至 ${addDays(wk, 6)}`, actions: [
      h('a', { class: 'btn ghost', href: `#/plan/${addDays(wk, -7)}` }, '‹ 上一周'),
      wk !== weekStart(t) ? h('a', { class: 'btn ghost', href: '#/plan' }, '本周') : null,
      h('a', { class: 'btn ghost', href: `#/plan/${addDays(wk, 7)}` }, '下一周 ›')] }),
    demoBanner(), h('div', { class: 'plan-wrap' }, stats, board, hist));
}
