// 碎片发现: small things noticed during the day, typed in one line from anywhere.
// They wait in planner/tasks.json (`finds`); once their week's Saturday has come, each finished day is filed,
// word for word, as one page of the volume 「每日发现」 titled with its date. Sorting and rewriting is left to the owner.
import { nowISO, zoned, pagePath, parseFrontMatter, serializePage, makeEntry, todayISO, volIndexPath } from './model.js';
import { gitSha, te } from './store.js';
import { addDays, putSection, sectionOf } from './lab.js';
import { updatePage } from './pages.js';
import { h, icon } from './util.js';
import { lib, menu, modal, toast, view } from './core.js';
import { freshId, PIN_SVG, TASKS_PATH, WEEKDAYS, changePlanner, editable, loadPlanner, planDoc, queuePlanner, weekStart } from './planner.js';
import { redrawHome } from './home.js';
import { route } from './app.js';

export const DAILY_CODE = 'DAY';
export const DAILY_TITLE = '每日发现';
export const dailyVolume = () => lib.volumes().find((v) => v.code === DAILY_CODE) || null;
const dayOf = (f) => zoned(f.at).day;
const timeOf = (f) => zoned(f.at).time;
const weekday = (iso) => `周${WEEKDAYS[(new Date(`${iso}T12:00:00`).getDay() + 6) % 7]}`;
export const dayTitle = (iso) => `${iso} ${weekday(iso)}`;
// A day is filed once it is over and the Saturday of its week has come (Mon–Fri on Saturday, Sat on Sunday, Sun on Monday).
export const dueForFiling = (iso, today = todayISO()) => iso < today && today >= addDays(weekStart(iso), 5);
const groupByDay = (list) => {
  const m = new Map();
  for (const f of [...list].sort((a, b) => String(a.at).localeCompare(String(b.at)))) { const d = dayOf(f); if (!m.has(d)) m.set(d, []); m.get(d).push(f); }
  return m;
};
const bullet = (f, topic) => `- **${timeOf(f)}** ${topic ? `〔${topic}〕` : ''}${String(f.text).trim().split(/\n+/).map((l) => l.trim()).filter(Boolean).join('\n  ')}`;
const INTRO = '当天的零碎发现，原文照录。之后可以分类、改写，或挪到对应课题的实验页。';

// ----- topics: the sub-headings of 课题手记. Until the list is edited it mirrors the notebook's volumes. -----
export const NO_TOPIC = '';
// Each topic has its own colour everywhere it shows (tabs, weekly goals, project cards); a default until one is picked.
export const TOPIC_COLORS = ['#0a84ff', '#30a46c', '#c77c02', '#bf5af2', '#e5484d', '#00a3a3', '#5e5ce6', '#8e8e93'];
export const LOOSE_COLOR = '#8e8e93';
export function topicsOf(doc) {
  const list = Array.isArray(doc?.topics) ? doc.topics : lib.volumes().filter((v) => v.code !== DAILY_CODE).map((v) => ({ id: `v:${v.id}`, name: v.title }));
  return list.map((x, i) => ({ ...x, color: x.color || TOPIC_COLORS[i % TOPIC_COLORS.length] }));
}
export const pinTopicsIn = (d) => pinTopics(d);
// Writing a topic id into an item fixes the list in the file, so the id keeps its name.
function pinTopics(d) { if (!Array.isArray(d.topics)) d.topics = topicsOf(d).map((x) => ({ ...x })); }
const TOPIC_KEY = 'labnote-note-topic';
const lastTopic = () => { try { return localStorage.getItem(TOPIC_KEY) || NO_TOPIC; } catch { return NO_TOPIC; } };
const setLastTopic = (id) => { try { localStorage.setItem(TOPIC_KEY, id); } catch { /* private window */ } };
const rid = (p) => freshId(() => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`);

export function addFind(text, redraw = redrawHome, topic = NO_TOPIC) {
  const t = String(text || '').trim();
  if (!t) return null;
  const id = rid('f');
  return changePlanner((d) => { if (topic) pinTopics(d); d.finds ||= []; d.finds.push({ id, text: t, at: nowISO(), ...(topic ? { topic } : {}) }); }, 'Notes: add finding', redraw).then(() => id);
}
// 待做实验 live in `memos` (the old 备忘录), now with a topic and a tick.
export function addTodoNote(text, redraw = redrawHome, topic = NO_TOPIC) {
  const t = String(text || '').trim();
  if (!t) return null;
  return changePlanner((d) => { if (topic) pinTopics(d); d.memos.push({ id: rid('m'), text: t, pinned: false, created: nowISO(), ...(topic ? { topic } : {}) }); }, 'Notes: add to-do experiment', redraw);
}

// 零散想法: the same list as 待做实验, marked `kind: 'idea'` — thoughts that are not an experiment to run.
export function addIdea(text, redraw = redrawHome, topic = NO_TOPIC) {
  const t = String(text || '').trim();
  if (!t) return null;
  return changePlanner((d) => { if (topic) pinTopics(d); d.memos.push({ id: rid('m'), kind: 'idea', text: t, pinned: false, created: nowISO(), ...(topic ? { topic } : {}) }); }, 'Notes: add idea', redraw);
}

// ----- a finding that belongs to an experiment goes straight into that page's 「过程记录」 -----
// Targets: each 实验主题 (its latest open page) and the latest open experiment pages. Signed pages are not offered.
export function findTargets() {
  const daily = dailyVolume()?.id;
  const ps = lib.allPages().filter((p) => !p.void && !p.signed && !p.pending && p.vol !== daily)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)) || b.num - a.num);
  const out = []; const seen = new Set();
  for (const p of ps) if (p.series && !seen.has(p.series)) { seen.add(p.series); out.push({ key: `s:${p.series}`, label: `主题 · ${p.series}`, sub: `${p.date} ${p.xid || p.title}`, page: p }); }
  for (const p of ps.slice(0, 8)) out.push({ key: `p:${p.vol}/${p.num}`, label: `${p.xid || `p. ${p.num}`} ${p.title}`, sub: p.date, page: p });
  return out;
}
const PROC_BEFORE = ['结果', '讨论', '现象与讨论', '结论', '下一步', '照片', '自动挂接', '原始数据', '试剂等关键资源', '注意事项'];
// Writes the line into the page and marks the finding as filed there, so the Saturday filing leaves it alone.
export async function attachFind(id, page, redraw = redrawHome) {
  const doc = await loadPlanner();
  const f = (doc.finds || []).find((x) => x.id === id);
  if (!f) return false;
  const z = zoned(f.at);
  const stamp = z.day === page.date ? z.time : `${z.day.slice(5)} ${z.time}`;
  const line = `- **${stamp}** ${String(f.text).trim().split(/\n+/).map((l) => l.trim()).filter(Boolean).join('\n  ')}`;
  try {
    await updatePage(page.vol, page.num, ({ fm, body }) => {
      const old = (sectionOf(body, '过程记录') || '').trim();
      return { fm, body: putSection(body, '过程记录', old ? `${old}\n${line}` : line, PROC_BEFORE) };
    }, `Finding into p. ${page.num}`, '补充过程记录');
  } catch (e) { toast(`没有写进实验页：${e.message}`); return false; }
  const vt = `v:${page.vol}`;
  await changePlanner((d) => { const x = (d.finds || []).find((y) => y.id === id); if (!x) return; x.filed = `${page.vol}/${page.num}`; x.inPage = true; if (!x.topic && topicsOf(d).some((t) => t.id === vt)) { pinTopics(d); x.topic = vt; } }, 'Notes: finding into its experiment page', redraw);
  return true;
}
let lastTarget = { key: '', day: '' }; // the experiment picked last, for the rest of the day

// ----- filing -----
let filing = null;
// which(day) -> true for the days to file. Returns { days, n, vol } or null when there was nothing to do.
export function fileFinds(which) {
  if (filing) return filing;
  filing = queuePlanner(async () => {
    let vol = dailyVolume();
    const pending = planDoc(await lib.readJSON(TASKS_PATH, {})).finds.filter((f) => !f.filed && which(dayOf(f)));
    if (!pending.length) return null;
    if (!vol) { await lib.createVolume({ title: DAILY_TITLE, color: '#6b4a1e', code: DAILY_CODE, description: '每天的零碎发现：每周六自动按天整理成页，原文照录' }); vol = dailyVolume(); }
    return lib.commit(`Finds: file ${pending.length} into ${DAILY_TITLE}`, async (l) => {
      const doc = planDoc(await l.readJSON(TASKS_PATH, {}));
      const take = doc.finds.filter((f) => !f.filed && which(dayOf(f)));
      const names = new Map(topicsOf(doc).map((x) => [x.id, x.name]));
      if (!take.length) return { changes: [], result: null };
      const changes = []; const entries = {};
      let next = l.nextNumber(vol.id);
      const days = [...groupByDay(take)];
      for (const [day, list] of days) {
        const lines = list.map((f) => bullet(f, names.get(f.topic))).join('\n');
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
        for (const f of list) f.filed = `${vol.id}/${num}`; // stays in its topic's list, linked to the page
        entries[`${vol.id}/${num}`] = makeEntry(vol.id, num, md, await gitSha(te.encode(md)));
      }
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
    if (!(doc.finds || []).some((f) => !f.filed && dueForFiling(dayOf(f)))) return;
    const r = await fileFinds((d) => dueForFiling(d));
    if (r) { toast(`已把 ${r.n} 条碎片发现整理成 ${r.days.length} 天的页（${DAILY_TITLE}）。`, { label: '查看', run: () => { location.hash = `#/v/${r.vol}`; } }); if (view.kind === 'home') route({ quiet: true }); }
  } catch (e) { console.warn('finds', e); /* offline or busy: tried again next time the home page opens */ }
}

// ----- 课题手记: findings and experiments to do, under one topic at a time -----
let shownTopic = null; // the tab open on the home page ('*' = all)
const ALL = '*';
export function findsCard(doc, draw) {
  const topics = topicsOf(doc);
  const tname = new Map(topics.map((x) => [x.id, x.name]));
  const tcolor = new Map(topics.map((x) => [x.id, x.color]));
  const known = (id) => (id && tname.has(id) ? id : NO_TOPIC);
  if (shownTopic === null) shownTopic = tname.has(lastTopic()) ? lastTopic() : ALL;
  if (shownTopic !== ALL && shownTopic !== NO_TOPIC && !tname.has(shownTopic)) shownTopic = ALL;
  const cur = shownTopic;
  const finds = doc.finds || []; const memos = doc.memos || [];
  const inTab = (x) => cur === ALL || known(x.topic) === cur;
  const t = todayISO();
  const count = (id) => finds.filter((f) => known(f.topic) === id && !f.filed).length + memos.filter((m) => known(m.topic) === id && !m.done && m.kind !== 'idea').length;
  const loose = finds.some((f) => !known(f.topic)) || memos.some((m) => !known(m.topic));
  const tab = (id, label, n) => h('button', { type: 'button', class: `nt-tab${cur === id ? ' on' : ''}${tcolor.has(id) ? ' tinted' : ''}`, style: tcolor.has(id) ? { '--k': tcolor.get(id) } : null, role: 'tab', 'aria-selected': String(cur === id), onclick: () => { shownTopic = id; if (id !== ALL) setLastTopic(id); draw(); } }, h('span', null, label), n ? h('b', null, String(n)) : null);
  const addTo = cur === ALL ? NO_TOPIC : cur;
  // move an item to another topic
  const topicChip = (x, where) => {
    const id = known(x.topic);
    const b = h('button', { type: 'button', class: `nt-topic${id ? '' : ' none'}`, style: id ? { '--k': tcolor.get(id) } : null, title: '改到别的课题' }, id ? tname.get(id) : '未分类');
    b.addEventListener('click', () => menu(b, [...topics, { id: NO_TOPIC, name: '未分类' }].filter((o) => o.id !== id).map((o) => ({ icon: 'go', label: o.name, run: () => changePlanner((d) => { if (o.id) pinTopics(d); const y = (d[where] || []).find((z) => z.id === x.id); if (y) { if (o.id) y.topic = o.id; else delete y.topic; } }, 'Notes: move to topic', draw) }))));
    return b;
  };
  const showChip = cur === ALL;
  const box = (ph, key, onAdd) => {
    const input = h('textarea', { class: 'add-input find-input', rows: 1, placeholder: ph, enterkeyhint: 'done', 'aria-label': ph, 'data-k': key });
    const go = () => { const v = input.value.trim(); if (!v) return; input.value = ''; onAdd(v); };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); go(); } });
    return h('div', { class: 'add-row find-add' }, h('span', { class: 'add-plus' }, icon('plus', 16)), input, h('button', { class: 'btn small add-btn', type: 'button', onclick: go }, '记下'));
  };
  // findings: newest day first; filed ones stay, linked to their page; only the latest 30 are listed
  const myFinds = finds.filter(inTab).sort((a, b) => String(b.at).localeCompare(String(a.at)));
  const shown = myFinds.slice(0, 30);
  const days = [...groupByDay(shown)].reverse();
  const updF = (id, f, msg) => changePlanner((d) => { const x = (d.finds || []).find((y) => y.id === id); if (x) f(x); }, msg, draw);
  // an unfiled finding can be sent into an experiment page
  const toPage = (f) => {
    const b = h('button', { type: 'button', class: 'find-attach', title: '这条发现属于某次实验：写进那一页的「过程记录」' }, '→ 实验页');
    b.addEventListener('click', () => {
      const ts = findTargets();
      if (!ts.length) { toast('还没有可写入的实验页（已签名的页不能挂）。'); return; }
      menu(b, ts.map((o) => ({ icon: 'go', label: o.label, run: async () => { if (await attachFind(f.id, o.page, draw)) toast(`已写进 ${o.page.xid || o.page.title} 的过程记录。`, { label: '查看', run: () => { location.hash = `#/v/${o.page.vol}/${o.page.num}`; } }); } })));
    });
    return b;
  };
  const findCol = h('div', { class: 'nt-col' },
    h('h3', { class: 'nt-h', style: { '--k': '#ff9f0a' } }, '碎片发现', h('span', null, `${myFinds.length} 条`)),
    box('刚发现了什么？写一句，回车保存', 'find', (v) => addFind(v, draw, addTo)),
    days.length ? days.map(([day, list]) => h('div', { class: 'find-day' },
      h('h4', null, day === t ? `今天 · ${day.slice(5)} ${weekday(day)}` : `${day.slice(5)} ${weekday(day)}`),
      h('ul', { class: 'finds' }, [...list].reverse().map((f) => h('li', { class: `find${f.filed ? ' filed' : ''}` },
        h('span', { class: 'find-time' }, timeOf(f)),
        h('span', { class: 'find-body' }, editable(f.text, (v) => updF(f.id, (x) => { x.text = v; }, 'Notes: edit finding'), 'find-text'),
          showChip ? topicChip(f, 'finds') : null,
          f.filed ? h('a', { class: `find-page${f.inPage ? ' in-page' : ''}`, href: `#/v/${f.filed}`, title: f.inPage ? '已写进这次实验的「过程记录」' : '已整理进「每日发现」的这一页' }, f.inPage ? '已进实验页' : '已成页') : toPage(f)),
        h('button', { class: 'task-del', type: 'button', 'aria-label': '删除', title: f.filed ? '从这里删除（每日发现页里的那一行不受影响）' : '删除', onclick: () => changePlanner((d) => { d.finds = (d.finds || []).filter((x) => x.id !== f.id); }, 'Notes: remove finding', draw) }, icon('close', 14)))))))
      : h('p', { class: 'nt-empty' }, '还没有。实验时注意到的小现象、小规律，随手记一句。'),
    myFinds.length > shown.length ? h('p', { class: 'muted small' }, `更早的 ${myFinds.length - shown.length} 条在「每日发现」卷里。`) : null);
  // experiments to do
  const isIdea = (m) => m.kind === 'idea';
  const move = (m) => h('button', { class: 'nt-move', type: 'button', title: isIdea(m) ? '这是要做的实验：移到「待做实验」' : '这不是实验：移到「零散想法」', onclick: () => updM(m.id, (x) => { if (isIdea(x)) delete x.kind; else { x.kind = 'idea'; delete x.done; delete x.doneAt; } }, 'Notes: move between lists') }, isIdea(m) ? '→ 实验' : '→ 想法');
  const myIdeas = memos.filter((m) => inTab(m) && isIdea(m)).sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || String(b.updated || b.created).localeCompare(String(a.updated || a.created)));
  const myMemos = memos.filter((m) => inTab(m) && !isIdea(m)).sort((a, b) => Number(!!a.done) - Number(!!b.done) || Number(!!b.pinned) - Number(!!a.pinned) || String(b.updated || b.created).localeCompare(String(a.updated || a.created)));
  const updM = (id, f, msg) => changePlanner((d) => { const m = d.memos.find((x) => x.id === id); if (m) f(m); }, msg, draw);
  const openN = myMemos.filter((m) => !m.done).length;
  const todoCol = h('div', { class: 'nt-col' },
    h('h3', { class: 'nt-h', style: { '--k': '#5e5ce6' } }, '待做实验', h('span', null, openN ? `${openN} 项待做` : '')),
    box('想做的实验、要补的对照、想试的条件', 'memo', (v) => addTodoNote(v, draw, addTo)),
    myMemos.length ? h('ul', { class: 'tasks nt-todos' }, myMemos.map((m) => h('li', { class: `task${m.done ? ' done' : ''}${m.pinned ? ' pinned' : ''}` },
      h('button', { class: 'tick', type: 'button', role: 'checkbox', 'aria-checked': String(!!m.done), 'aria-label': m.done ? '标为未做' : '标为已做', onclick: () => updM(m.id, (x) => { x.done = !x.done; if (x.done) x.doneAt = nowISO(); else delete x.doneAt; }, 'Notes: tick') }),
      h('span', { class: 'task-main' }, editable(m.text, (v) => updM(m.id, (x) => { x.text = v; x.updated = nowISO(); }, 'Notes: edit'), 'task-text'),
        h('span', { class: 'task-meta' }, showChip ? topicChip(m, 'memos') : null, zoned(m.updated || m.created).day.slice(5))),
      move(m),
      h('button', { class: 'memo-pin', type: 'button', 'aria-pressed': String(!!m.pinned), 'aria-label': m.pinned ? '取消置顶' : '置顶', title: m.pinned ? '取消置顶' : '置顶', html: PIN_SVG, onclick: () => updM(m.id, (x) => { x.pinned = !x.pinned; }, 'Notes: pin') }),
      h('button', { class: 'task-del', type: 'button', 'aria-label': '删除', title: '删除', onclick: () => changePlanner((d) => { d.memos = d.memos.filter((x) => x.id !== m.id); }, 'Notes: remove', draw) }, icon('close', 14)))))
      : h('p', { class: 'nt-empty' }, '还没有。想到要补的对照、下一步想试的条件，记在这里，做完打勾。'));
  const ideaCol = h('div', { class: 'nt-col' },
    h('h3', { class: 'nt-h', style: { '--k': '#30a46c' } }, '零散想法', h('span', null, myIdeas.length ? `${myIdeas.length} 条` : '')),
    box('一个念头、一个问题、要买的东西、要问的人', 'idea', (v) => addIdea(v, draw, addTo)),
    myIdeas.length ? h('ul', { class: 'tasks nt-todos nt-ideas' }, myIdeas.map((m) => h('li', { class: `task${m.pinned ? ' pinned' : ''}` },
      h('span', { class: 'nt-dot', 'aria-hidden': 'true' }),
      h('span', { class: 'task-main' }, editable(m.text, (v) => updM(m.id, (x) => { x.text = v; x.updated = nowISO(); }, 'Notes: edit'), 'task-text'),
        h('span', { class: 'task-meta' }, showChip ? topicChip(m, 'memos') : null, zoned(m.updated || m.created).day.slice(5))),
      move(m),
      h('button', { class: 'memo-pin', type: 'button', 'aria-pressed': String(!!m.pinned), 'aria-label': m.pinned ? '取消置顶' : '置顶', title: m.pinned ? '取消置顶' : '置顶', html: PIN_SVG, onclick: () => updM(m.id, (x) => { x.pinned = !x.pinned; }, 'Notes: pin') }),
      h('button', { class: 'task-del', type: 'button', 'aria-label': '删除', title: '删除', onclick: () => changePlanner((d) => { d.memos = d.memos.filter((x) => x.id !== m.id); }, 'Notes: remove', draw) }, icon('close', 14)))))
      : h('p', { class: 'nt-empty' }, '还没有。和实验无关或还不成形的念头，记在这里。'));
  const unfiled = finds.filter((f) => !f.filed).length;
  const vol = dailyVolume();
  const sat = addDays(weekStart(t), 5);
  return h('div', { class: 'tile finds-card notes-card' },
    h('div', { class: 'nt-tabs', role: 'tablist', 'aria-label': '课题' },
      tab(ALL, '全部', finds.filter((f) => !f.filed).length + memos.filter((m) => !m.done && m.kind !== 'idea').length),
      topics.map((x) => tab(x.id, x.name, count(x.id))),
      loose || cur === NO_TOPIC ? tab(NO_TOPIC, '未分类', count(NO_TOPIC)) : null,
      h('button', { type: 'button', class: 'nt-tab nt-manage', title: '增加、改名或删除课题', onclick: () => editTopics(doc, draw) }, icon('plus', 14), '课题')),
    h('div', { class: 'nt-cols three' }, findCol, todoCol, ideaCol),
    h('div', { class: 'rail-actions find-foot' },
      vol ? h('a', { class: 'btn small', href: `#/v/${vol.id}` }, `${DAILY_TITLE} ›`) : null,
      unfiled ? h('button', { class: 'btn small ghost', type: 'button', title: '不等周六，现在就把还没成页的发现按天整理成页（今天的也算）', onclick: async (e) => {
        e.currentTarget.disabled = true;
        try { const r = await fileFinds(() => true); if (r) { toast(`已整理成 ${r.days.length} 天的页。`, { label: '查看', run: () => { location.hash = `#/v/${r.vol}`; } }); route({ quiet: true }); } } catch (err) { toast(`没有整理：${err.message}`); draw(); }
      } }, '现在整理成页') : null,
      h('span', { class: 'muted small find-tip' }, `${unfiled ? `${unfiled} 条发现待成页 · ` : ''}${t >= sat ? '过完的日子自动成页' : `${sat.slice(5)} 周六自动按天成页`} · 任何页面按 N 或 ⌘J 也能记`)));
}

// Add, rename or remove topics. Removing one leaves its notes under 未分类.
export function editTopics(doc, draw) {
  const list = topicsOf(doc).map((x) => ({ ...x }));
  const box = h('div', { class: 'recipe-rows' });
  const drawRows = () => box.replaceChildren(...list.map((x, i) => h('div', { class: 'recipe-row nt-row' },
    h('input', { type: 'color', class: 'nt-color', value: x.color, 'aria-label': '颜色', title: '这个课题的颜色', oninput: (e) => { x.color = e.target.value; } }),
    h('input', { value: x.name, placeholder: '课题名，例如 OECT传感器', 'aria-label': '课题名', oninput: (e) => { x.name = e.target.value; } }),
    h('button', { class: 'btn icon small ghost', type: 'button', 'aria-label': '上移', title: '上移', disabled: i === 0, onclick: () => { [list[i - 1], list[i]] = [list[i], list[i - 1]]; drawRows(); } }, '↑'),
    h('button', { class: 'btn icon small ghost', type: 'button', 'aria-label': '删除', title: '删除（里面的记录归到“未分类”）', onclick: () => { list.splice(i, 1); drawRows(); } }, icon('close', 14)))),
  h('button', { class: 'btn small', type: 'button', onclick: () => { list.push({ id: rid('tp'), name: '', color: TOPIC_COLORS.find((c) => !list.some((y) => y.color === c)) || TOPIC_COLORS[list.length % TOPIC_COLORS.length] }); drawRows(); box.querySelectorAll('input')[list.length - 1]?.focus(); } }, icon('plus', 14), '加一个课题'));
  drawRows();
  modal({ title: '课题', body: h('div', { class: 'form' }, h('p', { class: 'muted' }, '课题用在课题手记、本周目标和课题看板里。点色块换颜色；删除课题不会删除里面的记录。'), box),
    buttons: [{ label: '取消' }, { label: '保存', primary: true, run: () => { const out = list.map((x) => ({ id: x.id, name: x.name.trim(), color: x.color })).filter((x) => x.name); changePlanner((d) => { d.topics = out; }, 'Notes: topics', draw); } }] });
}

// ----- quick entry from any page -----
export async function openQuickFind() {
  if (!lib || document.querySelector('.find-quick')) return;
  const doc = await loadPlanner().catch(() => null);
  if (!doc) { toast('记录本还没读好，稍后再试。'); return; }
  const t = todayISO();
  const topics = topicsOf(doc);
  let topic = topics.some((x) => x.id === lastTopic()) ? lastTopic() : NO_TOPIC;
  let kind = 'find';
  const box = h('textarea', { id: 'fq-text', rows: 3, autofocus: true });
  const chips = h('div', { class: 'clip-chips fq-topics', role: 'radiogroup', 'aria-label': '课题' });
  const kinds = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': '类型' });
  const list = h('ul', { class: 'finds fq-list' });
  const count = h('p', { class: 'muted small' });
  const targets = findTargets();
  const keep = lastTarget.day === t && targets.some((o) => o.key === lastTarget.key) ? lastTarget.key : '';
  const target = h('select', { id: 'fq-target', 'aria-label': '属于哪次实验' }, h('option', { value: '' }, '不属于某次实验（周六按天成页）'), targets.map((o) => h('option', { value: o.key, selected: keep === o.key }, `${o.label}　${o.sub}`)));
  const targetRow = h('div', { class: 'fq-target' }, h('label', { for: 'fq-target' }, '属于哪次实验（选了就直接写进那一页的过程记录）'), target);
  target.addEventListener('change', () => { lastTarget = { key: target.value, day: t }; box.focus(); });
  const drawPick = () => {
    chips.replaceChildren(...[...topics, { id: NO_TOPIC, name: '未分类' }].map((x) => h('button', { type: 'button', class: `chip${topic === x.id ? ' on' : ''}`, 'aria-pressed': String(topic === x.id), onclick: () => { topic = x.id; setLastTopic(x.id); drawPick(); box.focus(); } }, x.name)));
    kinds.replaceChildren(...[['find', '碎片发现'], ['todo', '待做实验'], ['idea', '零散想法']].map(([k, l]) => h('button', { type: 'button', class: `seg-btn${kind === k ? ' on' : ''}`, onclick: () => { kind = k; drawPick(); box.focus(); } }, l)));
    targetRow.hidden = kind !== 'find' || !targets.length;
    box.placeholder = kind === 'find' ? '例如：银在盖玻片上可以打印，但碰到溶剂会溶解。可能是多孔、附着不好。' : kind === 'todo' ? '例如：补一组不加交联剂的对照' : '例如：能不能把 OECT 做成贴片？买 0.22 μm 滤头';
  };
  const drawList = () => {
    const mine = (doc.finds || []).filter((f) => dayOf(f) === t).sort((a, b) => String(b.at).localeCompare(String(a.at)));
    const name = new Map(topics.map((x) => [x.id, x.name]));
    list.replaceChildren(...mine.map((f) => h('li', { class: 'find' }, h('span', { class: 'find-time' }, timeOf(f)), h('span', { class: 'find-text' }, f.text), name.get(f.topic) ? h('span', { class: 'nt-topic' }, name.get(f.topic)) : null)));
    count.textContent = mine.length ? `今天已记 ${mine.length} 条发现` : '';
  };
  const after = () => { drawList(); redrawHome(); };
  const save = () => { const v = box.value.trim(); if (!v) return false; box.value = ''; if (kind === 'find') { const o = targets.find((x) => x.key === target.value); const vt = o && topics.some((x) => x.id === `v:${o.page.vol}`) ? `v:${o.page.vol}` : topic; addFind(v, after, o ? vt : topic).then((id) => { if (o && id) attachFind(id, o.page, after).then((ok) => { if (ok) toast(`已写进 ${o.page.xid || o.page.title} 的过程记录。`); }); }); } else if (kind === 'todo') { addTodoNote(v, after, topic); toast('已记到待做实验。'); } else { addIdea(v, after, topic); toast('已记到零散想法。'); } box.focus(); return false; };
  box.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); save(); } });
  drawPick(); drawList();
  const dlg = modal({ title: `课题手记 · ${dayTitle(t)}`, body: h('div', { class: 'form find-quick' },
    h('span', { class: 'label' }, '记到哪个课题'), chips, kinds, targetRow, box,
    h('p', { class: 'muted small' }, '回车保存并继续记下一条；Shift+回车换行；Esc 关闭。'), count, list),
  buttons: [{ label: '关闭' }, { label: '记下', primary: true, run: save }] });
  setTimeout(() => box.focus(), 40);
  return dlg;
}
// A round ＋ button at the bottom-right of every page.
export function mountFindButton() {
  let b = document.getElementById('find-fab');
  if (!b) {
    b = h('button', { id: 'find-fab', class: 'find-fab', type: 'button', title: '课题手记：记一条发现、待做实验或想法（N 或 ⌘J）', 'aria-label': '课题手记：记一条', onclick: () => openQuickFind() }, icon('pen', 22));
    document.body.append(b);
  }
  b.hidden = !lib;
}
