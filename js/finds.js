// 碎片发现: small things noticed during the day, typed in one line from anywhere.
// They wait in planner/tasks.json (`finds`); once their week's Saturday has come, each finished day is filed,
// word for word, as one page of the volume 「每日发现」 titled with its date. Sorting and rewriting is left to the owner.
import { nowISO, pagePath, parseFrontMatter, serializePage, makeEntry, todayISO, volIndexPath } from './model.js';
import { gitSha, te } from './store.js';
import { addDays } from './lab.js';
import { h, icon } from './util.js';
import { lib, modal, toast, view } from './core.js';
import { TASKS_PATH, WEEKDAYS, changePlanner, editable, loadPlanner, planDoc, queuePlanner, weekStart } from './planner.js';
import { cardHead, redrawHome } from './home.js';
import { route } from './app.js';

export const DAILY_CODE = 'DAY';
export const DAILY_TITLE = '每日发现';
export const dailyVolume = () => lib.volumes().find((v) => v.code === DAILY_CODE) || null;
const dayOf = (f) => String(f.at).slice(0, 10);
const timeOf = (f) => String(f.at).slice(11, 16);
const weekday = (iso) => `周${WEEKDAYS[(new Date(`${iso}T12:00:00`).getDay() + 6) % 7]}`;
export const dayTitle = (iso) => `${iso} ${weekday(iso)}`;
// A day is filed once it is over and the Saturday of its week has come (Mon–Fri on Saturday, Sat on Sunday, Sun on Monday).
export const dueForFiling = (iso, today = todayISO()) => iso < today && today >= addDays(weekStart(iso), 5);
const groupByDay = (list) => {
  const m = new Map();
  for (const f of [...list].sort((a, b) => String(a.at).localeCompare(String(b.at)))) { const d = dayOf(f); if (!m.has(d)) m.set(d, []); m.get(d).push(f); }
  return m;
};
const bullet = (f) => `- **${timeOf(f)}** ${String(f.text).trim().split(/\n+/).map((l) => l.trim()).filter(Boolean).join('\n  ')}`;
const INTRO = '当天的零碎发现，原文照录。之后可以分类、改写，或挪到对应课题的实验页。';

export function addFind(text, redraw = redrawHome) {
  const t = String(text || '').trim();
  if (!t) return null;
  return changePlanner((d) => { d.finds ||= []; d.finds.push({ id: `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, text: t, at: nowISO() }); }, 'Finds: add', redraw);
}

// ----- filing -----
let filing = null;
// which(day) -> true for the days to file. Returns { days, n, vol } or null when there was nothing to do.
export function fileFinds(which) {
  if (filing) return filing;
  filing = queuePlanner(async () => {
    let vol = dailyVolume();
    const pending = planDoc(await lib.readJSON(TASKS_PATH, {})).finds.filter((f) => which(dayOf(f)));
    if (!pending.length) return null;
    if (!vol) { await lib.createVolume({ title: DAILY_TITLE, color: '#6b4a1e', code: DAILY_CODE, description: '每天的零碎发现：每周六自动按天整理成页，原文照录' }); vol = dailyVolume(); }
    return lib.commit(`Finds: file ${pending.length} into ${DAILY_TITLE}`, async (l) => {
      const doc = planDoc(await l.readJSON(TASKS_PATH, {}));
      const take = doc.finds.filter((f) => which(dayOf(f)));
      if (!take.length) return { changes: [], result: null };
      const changes = []; const entries = {};
      let next = l.nextNumber(vol.id);
      const days = [...groupByDay(take)];
      for (const [day, list] of days) {
        const lines = list.map(bullet).join('\n');
        // A page for this day that is still open gets the new lines; a signed one is left alone and a second page is made.
        const old = Object.values(l.pagesByKey).find((p) => p.vol === vol.id && p.date === day && String(p.title).startsWith(day) && !p.signed && !p.void && !p.pending);
        let num; let md;
        if (old) {
          num = old.num;
          const { fm, body } = parseFrontMatter(await l.readText(pagePath(vol.id, num)));
          md = serializePage(fm, `${body.trimEnd()}\n${lines}\n`);
        } else {
          num = next++;
          md = serializePage({ title: dayTitle(day), date: day, tags: ['碎片发现'] }, `${INTRO}\n\n${lines}\n`);
        }
        changes.push({ path: pagePath(vol.id, num), data: md });
        entries[`${vol.id}/${num}`] = makeEntry(vol.id, num, md, await gitSha(te.encode(md)));
      }
      const gone = new Set(take.map((f) => f.id));
      doc.finds = doc.finds.filter((f) => !gone.has(f.id));
      changes.push({ path: volIndexPath(vol.id), data: JSON.stringify(l.volumeIndexData(vol.id, entries)) });
      changes.push({ path: TASKS_PATH, data: `${JSON.stringify(doc, null, 1)}\n` });
      return { changes, result: { days: days.map(([d]) => d), n: take.length, vol: vol.id }, after: () => Object.assign(l.pagesByKey, entries) };
    });
  }).finally(() => { filing = null; });
  return filing;
}
// Runs when the home page opens.
export async function autoFileFinds() {
  try {
    const doc = await loadPlanner();
    if (!(doc.finds || []).some((f) => dueForFiling(dayOf(f)))) return;
    const r = await fileFinds((d) => dueForFiling(d));
    if (r) { toast(`已把 ${r.n} 条碎片发现整理成 ${r.days.length} 天的页（${DAILY_TITLE}）。`, { label: '查看', run: () => { location.hash = `#/v/${r.vol}`; } }); if (view.kind === 'home') route({ quiet: true }); }
  } catch (e) { console.warn('finds', e); /* offline or busy: tried again next time the home page opens */ }
}

// ----- home card -----
export function findsCard(doc, draw) {
  const finds = doc.finds || [];
  const t = todayISO();
  const upd = (id, f, msg) => changePlanner((d) => { const x = (d.finds || []).find((y) => y.id === id); if (x) f(x); }, msg, draw);
  const input = h('textarea', { class: 'add-input find-input', rows: 1, placeholder: '刚发现了什么？写一句，回车保存', enterkeyhint: 'done', 'aria-label': '记一条碎片发现', 'data-k': 'find' });
  const go = () => { const v = input.value.trim(); if (!v) return; input.value = ''; addFind(v, draw); };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); go(); } });
  const days = [...groupByDay(finds)].reverse();
  const vol = dailyVolume();
  const sat = addDays(weekStart(t), 5);
  return h('div', { class: 'tile finds-card' },
    cardHead('碎片发现', finds.length ? `待整理 ${finds.length} 条 · ${t >= sat ? '周六已到，过完的日子会自动成页' : `${sat.slice(5)} 周六自动按天成页`}` : '零碎的小发现，随手记一句'),
    h('div', { class: 'add-row find-add' }, h('span', { class: 'add-plus' }, icon('plus', 16)), input, h('button', { class: 'btn small add-btn', type: 'button', onclick: go }, '记下')),
    days.map(([day, list]) => h('div', { class: 'find-day' },
      h('h4', null, day === t ? `今天 · ${day.slice(5)} ${weekday(day)}` : `${day.slice(5)} ${weekday(day)}`, h('span', null, `${list.length} 条`)),
      h('ul', { class: 'finds' }, list.map((f) => h('li', { class: 'find' },
        h('span', { class: 'find-time' }, timeOf(f)),
        editable(f.text, (v) => upd(f.id, (x) => { x.text = v; }, 'Finds: edit'), 'find-text'),
        h('button', { class: 'task-del', type: 'button', 'aria-label': '删除', title: '删除', onclick: () => changePlanner((d) => { d.finds = (d.finds || []).filter((x) => x.id !== f.id); }, 'Finds: remove', draw) }, icon('close', 14))))))),
    h('div', { class: 'rail-actions find-foot' },
      vol ? h('a', { class: 'btn small', href: `#/v/${vol.id}` }, `${DAILY_TITLE} ›`) : null,
      finds.length ? h('button', { class: 'btn small ghost', type: 'button', title: '不等周六，现在就把上面这些按天整理成页（今天的也算）', onclick: async (e) => {
        e.currentTarget.disabled = true;
        try { const r = await fileFinds(() => true); if (r) { toast(`已整理成 ${r.days.length} 天的页。`, { label: '查看', run: () => { location.hash = `#/v/${r.vol}`; } }); route({ quiet: true }); } } catch (err) { toast(`没有整理：${err.message}`); draw(); }
      } }, '现在整理') : null,
      h('span', { class: 'muted small find-tip' }, '任何页面按 N 或 ⌘J 也能记')));
}

// ----- quick entry from any page -----
export async function openQuickFind() {
  if (!lib || document.querySelector('.find-quick')) return;
  const doc = await loadPlanner().catch(() => null);
  if (!doc) { toast('记录本还没读好，稍后再试。'); return; }
  const t = todayISO();
  const box = h('textarea', { id: 'fq-text', rows: 3, autofocus: true, placeholder: '例如：银在盖玻片上可以打印，但碰到溶剂会溶解。可能是多孔、附着不好。' });
  const list = h('ul', { class: 'finds fq-list' });
  const drawList = () => {
    const mine = (doc.finds || []).filter((f) => dayOf(f) === t).sort((a, b) => String(b.at).localeCompare(String(a.at)));
    list.replaceChildren(...mine.map((f) => h('li', { class: 'find' }, h('span', { class: 'find-time' }, timeOf(f)), h('span', { class: 'find-text' }, f.text))));
    count.textContent = mine.length ? `今天已记 ${mine.length} 条` : '';
  };
  const count = h('p', { class: 'muted small' });
  const save = () => { const v = box.value.trim(); if (!v) return false; box.value = ''; addFind(v, () => { drawList(); redrawHome(); }); box.focus(); return false; };
  box.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); save(); } });
  drawList();
  const dlg = modal({ title: `碎片发现 · ${dayTitle(t)}`, body: h('div', { class: 'form find-quick' }, box,
    h('p', { class: 'muted small' }, '回车保存并继续记下一条；Shift+回车换行；Esc 关闭。每周六自动按天整理成页。'), count, list),
  buttons: [{ label: '关闭' }, { label: '记下', primary: true, run: save }] });
  setTimeout(() => box.focus(), 40);
  return dlg;
}
// A round ＋ button at the bottom-right of every page.
export function mountFindButton() {
  let b = document.getElementById('find-fab');
  if (!b) {
    b = h('button', { id: 'find-fab', class: 'find-fab', type: 'button', title: '记一条碎片发现（N 或 ⌘J）', 'aria-label': '记一条碎片发现', onclick: () => openQuickFind() }, icon('pen', 22));
    document.body.append(b);
  }
  b.hidden = !lib;
}
