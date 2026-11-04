// Search dialog and page picker.
import { fmtDate } from './model.js';
import { search } from './search.js';
import { h, esc } from './util.js';
import { loadMethods, loadHypotheses, loadReagents, loadSolutions, loadProtocols } from './lab.js';
import { loadPlanner, editPaper } from './planner.js';
import { lib, modal } from './core.js';

export function openPagePicker(curVol, onPick) {
  const input = h('input', { type: 'search', placeholder: '按标题、编号或文字搜索', autofocus: true, 'aria-label': '找页面' });
  const list = h('ol', { class: 'picker-list' });
  let root;
  const draw = () => {
    const res = search(lib.allPages(), input.value).slice(0, 30);
    list.replaceChildren(...res.map(({ page: p }) => h('li', null, h('button', {
      type: 'button', class: 'picker-item',
      onclick: () => { onPick(p.vol === curVol ? String(p.num) : `${p.vol}/${p.num}`); root.close(); },
    }, h('span', { class: 'l-where' }, p.vol === curVol ? `p. ${p.num}` : `${lib.volume(p.vol)?.title || p.vol}, p. ${p.num}`), h('span', { class: 'l-title' }, p.title)))));
    if (!res.length) list.append(h('li', { class: 'muted' }, '没有匹配的页面。'));
  };
  input.addEventListener('input', draw);
  draw();
  root = modal({ title: '链接到页面', body: h('div', { class: 'picker' }, input, list), buttons: [] });
}

// ---------- search ----------
export function openSearch(initial = '', vol = '') {
  const input = h('input', { type: 'search', value: initial, placeholder: '关键词、日期（2026-11 / 20261101）、实验编号、#09、#标签', autofocus: true, 'aria-label': '搜索笔记本' });
  const volSel = h('select', { 'aria-label': '卷' }, h('option', { value: '' }, '所有卷'), lib.volumes().map((v) => h('option', { value: v.id, selected: v.id === vol }, v.title)));
  const from = h('input', { type: 'date', 'aria-label': '起始日期', title: '起始日期' });
  const to = h('input', { type: 'date', 'aria-label': '截止日期', title: '截止日期' });
  const tags = h('div', { class: 'tag-cloud' }, lib.tags().slice(0, 24).map(([t, n]) => h('button', {
    type: 'button', class: 'tag-btn', onclick: () => { input.value = `#${t}`; draw(); input.focus(); },
  }, `#${t}`, h('span', { class: 'n' }, n))));
  const out = h('ol', { class: 'results' });
  let root;
  const draw = () => {
    const q = input.value.trim();
    tags.hidden = !!q;
    if (!q && !volSel.value && !from.value && !to.value) { out.replaceChildren(); return; }
    const res = search(lib.allPages(), q, { vol: volSel.value, from: from.value, to: to.value }).slice(0, 60);
    out.replaceChildren(...res.map(({ page: p, snippet }) => h('li', null, h('a', { href: `#/v/${p.vol}/${p.num}`, onclick: () => root.close() },
      h('span', { class: 'r-where' }, `${lib.volume(p.vol)?.title || p.vol}, p. ${p.num}`, h('span', { class: 'r-date' }, fmtDate(p.date))),
      h('span', { class: 'r-title' }, p.xid ? h('span', { class: 'xid-tag' }, p.xid) : null, p.title),
      snippet ? h('span', { class: 'r-snip', html: snippet }) : null))));
    if (!res.length) out.append(h('li', { class: 'muted' }, volSel.value || from.value || to.value ? '这个范围里没有匹配的记录页。' : '没有匹配的记录页。'));
    drawOthers(q);
  };
  // Everything that is not a page: method cards, hypotheses, libraries, planner. Loaded once, on the first search.
  let pool = null;
  const others = h('div', { class: 'search-others' });
  const drawOthers = async (q) => {
    const words = q.toLowerCase().split(/\s+/).filter((w) => w && !(w.startsWith('#') && !/^#\d/.test(w)));
    if (!words.length) { others.replaceChildren(); return; }
    pool ??= loadPool();
    const groups = await pool;
    if (input.value.trim() !== q) return;
    const hit = (text) => { const t = text.toLowerCase(); return words.every((w) => t.includes(w)); };
    const shown = groups.map((g) => [g, g.items.filter((x) => hit(x.text))]).filter(([, xs]) => xs.length);
    others.replaceChildren(...shown.map(([g, xs]) => h('section', { class: 'search-group' },
      h('h3', null, g.label, h('span', null, `${xs.length}`)),
      h('ol', { class: 'results' }, xs.slice(0, 8).map((x) => h('li', null, h('a', { href: x.href || '#/', onclick: (e) => { root.close(); if (x.open) { e.preventDefault(); location.hash = x.href || '#/'; setTimeout(x.open, 350); } } },
        h('span', { class: 'r-title' }, x.tag ? h('span', { class: 'xid-tag' }, x.tag) : null, x.title),
        h('span', { class: 'r-snip', html: snip(x.text, words) })))),
        xs.length > 8 ? h('li', { class: 'muted' }, `还有 ${xs.length - 8} 条，多写几个词可以缩小范围。`) : null))));
  };
  input.addEventListener('input', draw);
  volSel.addEventListener('change', draw);
  from.addEventListener('change', draw); to.addEventListener('change', draw);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { const a = out.querySelector('a'); if (a) { a.click(); location.hash = a.getAttribute('href'); } } });
  draw();
  root = modal({ title: '搜索', wide: true, body: h('div', { class: 'search' }, h('div', { class: 'search-row' }, input, volSel), h('div', { class: 'search-row dates' }, h('span', { class: 'muted' }, '日期'), from, '至', to), tags,
    h('h3', { class: 'search-h' }, '记录页'), out, others), buttons: [] });
}

// A short excerpt around the first matching word, with the words marked.
function snip(text, words) {
  const t = String(text).replace(/\s+/g, ' ');
  const i = Math.max(0, t.toLowerCase().indexOf(words[0]));
  const part = (i > 30 ? '…' : '') + t.slice(Math.max(0, i - 30), i + 70) + (i + 70 < t.length ? '…' : '');
  let out = esc(part);
  for (const w of words) out = out.replace(new RegExp(esc(w).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), (m) => `<mark>${m}</mark>`);
  return out;
}
async function loadPool() {
  const safe = (p) => p.catch(() => []);
  const [methods, hyps, reagents, solutions, protocols, plan] = await Promise.all([safe(loadMethods(lib)), safe(loadHypotheses(lib)), safe(loadReagents(lib)), safe(loadSolutions(lib)), safe(loadProtocols(lib)), loadPlanner().catch(() => ({}))]);
  const vals = (o) => Object.values(o).filter((v) => typeof v === 'string').join(' ');
  return [
    { label: '方法卡片', items: methods.map((m) => ({ tag: m.id, title: m.title, href: `#/m/${m.id}`, text: `${m.id} ${m.title} ${m.cat} ${(m.tags || []).join(' ')} ${(m.params || []).map((p) => `${p.k} ${p.v}`).join(' ')} ${m.body || ''}` })) },
    { label: '假设', items: hyps.map((x) => ({ tag: x.id, title: x.title, href: `#/think/${x.id}`, text: `${x.id} ${x.title} ${x.description || ''} ${(x.predictions || []).join(' ')} ${(x.evidence || []).map((e) => e.text).join(' ')}` })) },
    { label: '课题', items: (plan.projects || []).map((x) => ({ tag: x.stage, title: x.title, href: '#/projects', text: `${x.title} ${x.kind || ''} ${x.stage || ''} ${x.next || ''} ${x.why || ''} ${x.note || ''}` })) },
    { label: '论文', items: (plan.papers || []).map((x) => ({ tag: x.stage, title: x.title, href: '#/', open: () => editPaper(x), text: `${x.title} ${x.journal || ''} ${x.stage || ''} ${x.note || ''}` })) },
    { label: '试剂', items: reagents.map((r) => ({ tag: r.id, title: r.name, href: `#/lib/reagents?q=${encodeURIComponent(r.id)}`, text: vals(r) })) },
    { label: '溶液', items: solutions.map((r) => ({ tag: r.id, title: r.name, href: `#/lib/solutions?q=${encodeURIComponent(r.id)}`, text: vals(r) })) },
    { label: '步骤库（SOP）', items: protocols.map((p) => ({ tag: p.id, title: p.title, href: `#/lib/protocols/${encodeURIComponent(p.id)}`, text: `${p.id} ${p.title} ${p.version || ''} ${(p.reagents || []).join(' ')}` })) },
    { label: '待办与计划', items: (plan.tasks || []).map((t) => ({ tag: t.done ? '已完成' : (t.cat || (t.date ? t.date.slice(5) : '本周')), title: t.text, href: `#/plan/${t.week || ''}`, text: `${t.text} ${t.cat || ''} ${t.date || ''}` })) },
    { label: '备忘录', items: (plan.memos || []).map((m) => ({ title: m.text, href: '#/', text: m.text })) },
  ];
}
