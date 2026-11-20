// 小实验 (ops/2026-11.json): the many small independent steps that are not a whole experiment —
// made a glucose solution, made Ag electrodes and baked them 4 h at 120 °C from 13:00 to 17:00.
// One line is enough: "13:00-17:00 烘烤银电极 120°C" is read into time, duration, temperature and a type.
// Each can be planned (计划) or done (已做); the day's list prints on one A4 sheet to carry to the lab,
// with blanks for the actual values, and is ticked off back in the notebook afterwards.
import { nowISO, todayISO, fmtDate } from './model.js';
import { addDays } from './lab.js';
import { h, icon, isComposing, isImeEvent } from './util.js';
import { lib, modal, toast, topbar, demoBanner, saveError, choose } from './core.js';

export const OPS_RE = /^ops\/(\d{4}-\d{2})\.json$/;
export const opsPath = (month) => `ops/${month}.json`;
const two = (n) => String(n).padStart(2, '0');
const WD = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
export const weekday = (iso) => WD[new Date(`${iso}T12:00:00`).getDay()];

// ----- types: words that give them away, and the fields worth writing down -----
export const KINDS = [
  { k: '配溶液', re: /配制?|溶液|稀释|溶解|母液|缓冲液/, fields: ['溶质', '溶剂', '浓度', '体积', '质量', '存放'] },
  { k: '清洗', re: /清洗|超声|等离子|plasma|紫外臭氧|UV-?O|冲洗|浸泡/i, fields: ['对象', '方法', '溶剂', '时长'] },
  { k: '涂膜', re: /旋涂|滴涂|刮涂|喷涂|涂膜|spin/i, fields: ['材料', '转速', '体积', '基底'] },
  { k: '打印', re: /打印|直写|DIW|2PP|双光子|丝网/i, fields: ['墨水', '针头', '速度', '压力', '基底'] },
  { k: '烘烤', re: /烘|烤|退火|干燥|固化|加热|热台|烧结/, fields: ['温度', '设备', '气氛'] },
  { k: '制作电极', re: /电极|栅极|导线|连线|封装/, fields: ['材料', '数量', '方法'] },
  { k: '称量分装', re: /称量?|分装|取样/, fields: ['试剂', '质量', '分装'] },
  { k: '测试', re: /测试?|表征|Keithley|显微|SEM|拍照|CV\b|EIS|阻抗|拉曼|XRD|紫外/i, fields: ['仪器', '样品'] },
  { k: '其他', re: null, fields: [] },
];
export const kindOf = (k) => KINDS.find((x) => x.k === k) || KINDS[KINDS.length - 1];
export const guessKind = (text) => (KINDS.find((x) => x.re && x.re.test(text)) || KINDS[KINDS.length - 1]).k;

// ----- times -----
export const toMin = (t) => { const m = String(t || '').match(/^(\d{1,2}):(\d{2})$/); return m ? +m[1] * 60 + +m[2] : null; };
export const fromMin = (n) => `${two(Math.floor(((n % 1440) + 1440) % 1440 / 60))}:${two(((n % 60) + 60) % 60)}`;
export function fmtDur(min) {
  if (min == null || !isFinite(min) || min <= 0) return '';
  const hr = Math.floor(min / 60); const m = Math.round(min % 60);
  return hr && m ? `${hr} h ${m} min` : hr ? `${hr} h` : `${m} min`;
}
// start / end / duration: any two give the third (an end before the start runs past midnight).
export function settle(op) {
  const s = toMin(op.start); const e = toMin(op.end);
  if (s != null && e != null) op.dur = (e - s + 1440) % 1440 || null;
  else if (s != null && op.dur) op.end = fromMin(s + op.dur);
  else if (e != null && op.dur) op.start = fromMin(e - op.dur);
  return op;
}
const hhmm = (h_, m) => `${two(+h_)}:${two(+(m || 0))}`;

// ----- one typed line → an entry -----
// "13:00-17:00 烘烤银电极 120°C" · "明天 10:30 配制 100 mM 葡萄糖溶液 10 mL" · "烘烤 4 小时 120 度" · "超声清洗 15 min"
const NUM = '(\\d+(?:\\.\\d+)?)';
const PARAMS = [
  ['温度', new RegExp(`(-?${NUM})\\s*(?:°\\s*C|℃|度|°)`, 'i'), (m) => `${m[1]} °C`],
  ['浓度', new RegExp(`${NUM}\\s*(mM|μM|uM|nM|mol\\s*/\\s*L|M|mg\\s*/\\s*mL|g\\s*/\\s*L|wt\\s*%|v\\s*/\\s*v\\s*%|%)(?![a-zA-Z])`), (m) => `${m[1]} ${m[2].replace(/\s+/g, '').replace('uM', 'μM')}`],
  ['体积', new RegExp(`${NUM}\\s*(mL|ml|μL|uL|µL|L)(?![a-zA-Z])`), (m) => `${m[1]} ${m[2].replace(/^ml$/, 'mL').replace(/^u|^µ/, 'μ')}`],
  ['质量', new RegExp(`${NUM}\\s*(mg|μg|ug|g)(?![a-zA-Z/])`), (m) => `${m[1]} ${m[2].replace('ug', 'μg')}`],
  ['转速', new RegExp(`${NUM}\\s*rpm`, 'i'), (m) => `${m[1]} rpm`],
  ['功率', new RegExp(`${NUM}\\s*(mW|W)(?![a-zA-Z])`), (m) => `${m[1]} ${m[2]}`],
  ['压力', new RegExp(`${NUM}\\s*(kPa|psi|bar)`, 'i'), (m) => `${m[1]} ${m[2]}`],
  ['数量', /(\d+)\s*(个|片|根|支|块|瓶|管)/, (m) => `${m[1]} ${m[2]}`],
];
export function parseQuick(line, today = todayISO()) {
  let s = ` ${String(line || '').replace(/[，。；;]/g, (c) => ({ '，': ', ', '。': ' ', '；': '; ', ';': '; ' }[c])).replace(/：/g, ':')} `;
  const op = { date: today, start: '', end: '', dur: null, params: [] };
  const cut = (re, f) => { const m = s.match(re); if (!m) return null; s = s.replace(m[0], ' '); f?.(m); return m; };
  // day
  cut(/(?:^|\s)(今天|明天|后天|昨天|前天)/, (m) => { op.date = addDays(today, { 今天: 0, 明天: 1, 后天: 2, 昨天: -1, 前天: -2 }[m[1]]); });
  cut(/(?:^|\s)(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?=\s|$|[^\d])/, (m) => { op.date = `${m[1]}-${two(m[2])}-${two(m[3])}`; });
  cut(/(?:^|\s)(\d{1,2})(?:月|[-/])(\d{1,2})(?:日|号)?(?=\s|[^\d:])/, (m) => { if (+m[1] <= 12 && +m[2] <= 31) op.date = `${today.slice(0, 4)}-${two(m[1])}-${two(m[2])}`; });
  // times: 13:00-17:00 · 13点到17点半 · 13:00 起
  const T = '(\\d{1,2})(?::(\\d{2})|点(半|\\d{1,2}分?)?)';
  const tm = (hh, a, b) => hhmm(hh, a ?? (b === '半' ? 30 : b ? parseInt(b, 10) : 0));
  cut(new RegExp(`(?:从\\s*)?${T}\\s*(?:-|–|—|~|～|到|至)\\s*${T}`), (m) => { op.start = tm(m[1], m[2], m[3]); op.end = tm(m[4], m[5], m[6]); });
  if (!op.start) cut(new RegExp(`(?:从\\s*)?${T}\\s*(?:开始|起)?`), (m) => { op.start = tm(m[1], m[2], m[3]); });
  // duration: 4 h · 4 小时 · 4个小时 · 30 min · 1.5h · 半小时 · 过夜
  cut(new RegExp(`${NUM}\\s*(?:个)?\\s*(h|hr|hrs|小时|钟头|min|mins|分钟|s|秒)(?![a-zA-Z])`, 'i'), (m) => {
    const u = m[2].toLowerCase(); op.dur = Math.round(parseFloat(m[1]) * (/^(h|hr|hrs|小时|钟头)$/.test(u) ? 60 : /^(s|秒)$/.test(u) ? 1 / 60 : 1)) || null;
  });
  if (!op.dur) cut(/半(?:个)?小时/, () => { op.dur = 30; });
  // 下午 3 点 → 15:00
  if (/下午|晚上|傍晚/.test(line)) for (const k of ['start', 'end']) { const m = toMin(op[k]); if (m != null && m < 12 * 60) op[k] = fromMin(m + 720); }
  // above ~1 °C, 120度 is a temperature; parameters in order of how sure the match is
  for (const [k, re, f] of PARAMS) cut(re, (m) => op.params.push({ k, v: f(m) }));
  // what is left is the name; "了 / 并且 / 上午…" are only how one talks
  op.title = s.replace(/上午|中午|下午|晚上|早上|傍晚|凌晨/g, ' ').replace(/了(?!解)/g, '').replace(/并且|然后|之后/g, '，')
    .replace(/\s*,\s*/g, '，').replace(/(?:，\s*)+/g, '，').replace(/\s+/g, ' ').replace(/^[\s，]+|[\s，]+$/g, '').replace(/\s*(?:在|于|共|的|，)$/, '').replace(/([\u4e00-\u9fff])\s+(?=[\u4e00-\u9fff])/g, '$1').trim();
  op.kind = guessKind(`${op.title} ${op.params.map((p) => p.k).join(' ')}`);
  if (op.kind === '其他' && op.params.some((p) => p.k === '温度')) op.kind = '烘烤';
  return settle(op);
}

// ----- storage: one JSON file per month, so a year of daily notes stays small and diffs stay readable -----
export const opMonths = () => [...lib.tree.keys()].map((p) => (p.match(OPS_RE) || [])[1]).filter(Boolean).sort();
async function readMonth(l, month) { const d = await l.readJSON(opsPath(month), {}); return Array.isArray(d?.items) ? d.items : []; }
export async function loadOps({ from = '', to = '' } = {}) {
  const months = opMonths().filter((m) => (!from || m >= from.slice(0, 7)) && (!to || m <= to.slice(0, 7)));
  const all = (await Promise.all(months.map((m) => readMonth(lib, m).catch(() => [])))).flat();
  return all.filter((o) => (!from || o.date >= from) && (!to || o.date <= to)).sort(opOrder);
}
export const opOrder = (a, b) => String(a.date).localeCompare(String(b.date)) || (toMin(a.start) ?? 9999) - (toMin(b.start) ?? 9999) || String(a.id).localeCompare(String(b.id));
const clean = (o) => {
  const x = settle({ ...o, params: (o.params || []).map((p) => ({ k: String(p.k || '').trim(), v: String(p.v || '').trim(), ...(p.a ? { a: String(p.a).trim() } : {}) })).filter((p) => p.k && (p.v || p.a)) });
  for (const k of ['start', 'end', 'note', 'link', 'topic', 'actual']) if (!x[k]) delete x[k];
  if (!x.dur) delete x.dur;
  return x;
};
// Saves (or with remove, deletes) one entry; a new one gets the next number of its day: 20261117-OP-03.
export async function saveOp(op, { remove = false, old = null } = {}) {
  const was = old || op;
  return lib.commit(remove ? `Delete small step ${op.id}` : `${op.id ? 'Update' : 'Add'} small step: ${op.title}`, async (l) => {
    const changes = []; const files = new Map();
    const month = async (m) => { if (!files.has(m)) files.set(m, await readMonth(l, m)); return files.get(m); };
    let x = null;
    if (op.id) { const list = await month(was.date.slice(0, 7)); const i = list.findIndex((o) => o.id === op.id); if (i >= 0) list.splice(i, 1); }
    if (!remove) {
      x = clean(op);
      const list = await month(x.date.slice(0, 7));
      if (!x.id || !x.id.startsWith(x.date.replace(/-/g, ''))) {
        const pre = `${x.date.replace(/-/g, '')}-OP-`;
        const n = Math.max(0, ...list.filter((o) => String(o.id).startsWith(pre)).map((o) => parseInt(String(o.id).slice(pre.length), 10) || 0)) + 1;
        x.id = `${pre}${two(n)}`;
      }
      x.at ||= nowISO(); x.updated = nowISO();
      list.push(x);
    }
    for (const [m, list] of files) changes.push({ path: opsPath(m), data: `${JSON.stringify({ version: 1, items: list.sort(opOrder) }, null, 1)}\n` });
    return { changes, result: x };
  });
}

// ----- state of an entry, as of now (UTC+8) -----
export function opState(o, now = nowISO()) {
  const day = now.slice(0, 10); const t = toMin(now.slice(11, 16));
  if (o.status === 'skip') return { k: 'skip', label: '取消' };
  if (o.status !== 'done') {
    if (o.date < day) return { k: 'late', label: '过期未做' };
    if (o.date === day && toMin(o.start) != null && toMin(o.start) <= t) return { k: 'due', label: '该开始了' };
    return { k: 'plan', label: '计划' };
  }
  const s = toMin(o.start); const e = toMin(o.end);
  if (o.date === day && s != null && e != null && s <= t && (e > s ? t < e : true)) {
    const left = e > s ? e - t : e + 1440 - t;
    return { k: 'run', label: `进行中 · 还剩 ${fmtDur(left)}`, left };
  }
  return { k: 'done', label: '已做' };
}
export const timeText = (o) => {
  const span = o.start && o.end ? `${o.start}–${o.end}` : o.start ? `${o.start} 起` : o.end ? `至 ${o.end}` : '';
  return [span, fmtDur(o.dur)].filter(Boolean).join(' · ');
};

// ----- quick entry: one line, Enter, next line -----
const PREF = 'labnote-op-mode';
const pref = { get: () => { try { return localStorage.getItem(PREF) || 'done'; } catch { return 'done'; } }, set: (v) => { try { localStorage.setItem(PREF, v); } catch { /* */ } } };
let hooks = new Set();
export const onOpsChange = (f) => { hooks.add(f); return () => hooks.delete(f); };
const changed = () => hooks.forEach((f) => { try { f(); } catch { /* view gone */ } });

function linkTargets() {
  return lib.allPages().filter((p) => !p.void && p.xid).sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 25);
}

export async function openQuickOp({ date = todayISO(), text = '' } = {}) {
  if (!lib || document.querySelector('.op-quick')) return;
  const recent = await loadOps({ from: addDays(todayISO(), -60) }).catch(() => []);
  let mode = pref.get();
  let kindPick = '';
  const line = h('input', { id: 'oq-line', class: 'oq-line', autocomplete: 'off', value: text, autofocus: true, placeholder: '例如：13:00-17:00 烘烤银电极 120°C', 'aria-label': '一句话记一笔' });
  const day = h('input', { id: 'oq-date', type: 'date', value: date });
  const seg = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': '已做还是计划' });
  const kinds = h('div', { class: 'clip-chips oq-kinds', role: 'radiogroup', 'aria-label': '类型' });
  const prev = h('div', { class: 'oq-prev', 'aria-live': 'polite' });
  const link = h('select', { id: 'oq-link', 'aria-label': '属于哪次大实验' }, h('option', { value: '' }, '不属于某次大实验'), linkTargets().map((p) => h('option', { value: p.xid }, `${p.xid}　${p.title}`)));
  const again = h('div', { class: 'oq-again' });
  const list = h('ul', { class: 'op-list oq-list' });
  const parsed = () => { const o = parseQuick(line.value, todayISO()); if (day.value && !/(今天|明天|后天|昨天|前天|\d{1,2}(月|[-/])\d{1,2})/.test(line.value)) o.date = day.value; if (kindPick) o.kind = kindPick; return o; };
  const drawSeg = () => seg.replaceChildren(...[['done', '已做（记录）'], ['plan', '计划（要去做）']].map(([k, l]) => h('button', { type: 'button', class: `seg-btn${mode === k ? ' on' : ''}`, 'aria-pressed': String(mode === k), onclick: () => { mode = k; pref.set(k); drawSeg(); line.focus(); } }, l)));
  const drawPrev = () => {
    const o = parsed();
    kinds.replaceChildren(...KINDS.map((x) => h('button', { type: 'button', class: `chip${o.kind === x.k ? ' on' : ''}`, 'aria-pressed': String(o.kind === x.k), onclick: () => { kindPick = kindPick === x.k ? '' : x.k; drawPrev(); line.focus(); } }, x.k)));
    if (!line.value.trim()) { prev.replaceChildren(h('span', { class: 'muted small' }, '时间、时长、温度、浓度、体积、质量、转速会自动认出来；没写的以后可以补。')); return; }
    const bits = [['日期', o.date === todayISO() ? '' : `${fmtDate(o.date)} ${weekday(o.date)}`], ['时间', timeText(o)], ...o.params.map((p) => [p.k, p.v])].filter(([, v]) => v);
    prev.replaceChildren(h('b', { class: 'oq-t' }, o.title || '（还没有名称）'), ...bits.map(([k, v]) => h('span', { class: 'oq-bit' }, h('i', null, k), v)));
  };
  const drawList = async () => {
    const mine = (await loadOps({ from: day.value || todayISO(), to: day.value || todayISO() }).catch(() => []));
    list.replaceChildren(...mine.map((o) => opRow(o, { compact: true, after: drawList })));
  };
  // the last few different names, one tap to reuse (time and amounts left for this time)
  const seen = new Set();
  const reuse = recent.slice().reverse().filter((o) => o.title && !seen.has(o.title) && seen.add(o.title)).slice(0, 6);
  again.replaceChildren(...(reuse.length ? [h('span', { class: 'muted small' }, '再来一次：'), ...reuse.map((o) => h('button', { type: 'button', class: 'chip', title: `${o.kind} · ${timeText(o)} ${(o.params || []).map((p) => `${p.k} ${p.v}`).join(' ')}`, onclick: () => {
    line.value = [o.title, ...(o.params || []).map((p) => p.v), o.dur && !o.start ? fmtDur(o.dur) : ''].filter(Boolean).join(' ');
    kindPick = o.kind; if (o.link) link.value = o.link; drawPrev(); line.focus(); line.setSelectionRange(0, 0);
  } }, o.title))] : []));
  const save = async () => {
    const o = parsed();
    if (!o.title) { toast('写一下做了什么。'); line.focus(); return false; }
    o.status = mode;
    if (link.value) o.link = link.value;
    const kf = kindOf(o.kind).fields;
    o.params = [...o.params, ...kf.filter((k) => !o.params.some((p) => p.k === k)).map((k) => ({ k, v: '' }))];
    line.value = ''; kindPick = ''; drawPrev();
    try { const x = await saveOp(o); toast(`${x.id} 已记下${o.status === 'plan' ? '（计划）' : ''}。`); changed(); drawList(); } catch (e) { toast(saveError(e)); }
    line.focus();
    return false;
  };
  line.addEventListener('input', drawPrev);
  line.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !isImeEvent(e)) { e.preventDefault(); save(); } });
  day.addEventListener('change', () => { drawPrev(); drawList(); });
  drawSeg(); drawPrev(); drawList();
  return modal({
    title: '记一笔小实验', wide: true,
    body: h('div', { class: 'form op-quick' },
      h('div', { class: 'oq-top' }, seg, h('label', { class: 'oq-day' }, h('span', null, '日期'), day)),
      line, prev,
      h('div', { class: 'oq-row' }, h('span', { class: 'label' }, '类型'), kinds),
      h('div', { class: 'oq-row' }, h('label', { class: 'label', for: 'oq-link' }, '大实验'), link),
      again,
      h('p', { class: 'muted small' }, '回车保存，接着记下一条；Esc 关闭。点下面任意一条可以补参数、备注、实际值。'),
      list),
    buttons: [{ label: '关闭' }, { label: '打印这天的操作单', run: () => { openOpsPrint(day.value); } }, { label: '记下', primary: true, run: save }],
  });
}

// ----- one entry in a list -----
export function opRow(o, { compact = false, after = null, showDate = false } = {}) {
  const st = opState(o);
  const k = kindOf(o.kind);
  const tick = h('button', { type: 'button', class: `op-tick ${st.k}`, title: o.status === 'done' ? '标回计划' : '做完了：按计划记为已做（实际值可点开再改）', 'aria-label': o.status === 'done' ? '标回计划' : '标为已做',
    onclick: async (e) => { e.stopPropagation(); try { await saveOp({ ...o, status: o.status === 'done' ? 'plan' : 'done' }); changed(); after?.(); } catch (err) { toast(saveError(err)); } } }, o.status === 'done' ? icon('check', 14) : null);
  const vals = (o.params || []).filter((p) => p.v || p.a).map((p) => h('span', { class: 'op-p' }, h('i', null, p.k), p.a && p.a !== p.v ? h('span', null, h('s', null, p.v), ` ${p.a}`) : p.v || p.a));
  return h('li', { class: `op-row ${st.k}${compact ? ' compact' : ''}`, tabindex: '0', onclick: () => editOp(o, after), onkeydown: (e) => { if (e.key === 'Enter') editOp(o, after); } },
    tick,
    h('span', { class: 'op-when' }, showDate ? h('b', null, `${o.date.slice(5)} ${weekday(o.date)}`) : null, o.start ? `${o.start}${o.end ? `–${o.end}` : ''}` : (o.dur ? fmtDur(o.dur) : '—')),
    h('span', { class: 'op-main' },
      h('span', { class: 'op-title' }, o.title),
      h('span', { class: 'op-kind', style: { '--k': KIND_COLOR[o.kind] || '#888' } }, k.k),
      st.k !== 'done' && st.k !== 'plan' ? h('span', { class: `op-st ${st.k}` }, st.label) : null,
      compact ? null : h('span', { class: 'op-ps' }, vals, o.link ? h('a', { class: 'op-link', href: linkHref(o.link), onclick: (e) => e.stopPropagation() }, `→ ${o.link}`) : null, o.note ? h('span', { class: 'op-note' }, o.note) : null)),
    h('span', { class: 'op-id' }, String(o.id || '').slice(-5)));
}
export const KIND_COLOR = { 配溶液: '#2a7bbd', 清洗: '#1e9a8c', 涂膜: '#8a55c9', 打印: '#c94f86', 烘烤: '#d0542f', 制作电极: '#b98a12', 称量分装: '#5b7c3a', 测试: '#3b5bb5', 其他: '#7b7f84' };
function linkHref(xid) {
  const p = lib.allPages().find((x) => x.xid === xid);
  return p ? `#/v/${p.vol}/${p.num}` : `#/search?q=${encodeURIComponent(xid)}`;
}

// ----- full form: every field, actual values, notes -----
export function editOp(o, after = null) {
  const old = o.id ? o : null;
  const x = structuredClone(o);
  const f = (id, v, attrs = {}) => h('input', { id, value: v ?? '', ...attrs });
  const title = f('oe-title', x.title);
  const date = f('oe-date', x.date, { type: 'date' });
  const start = f('oe-start', x.start, { type: 'time' }); const end = f('oe-end', x.end, { type: 'time' });
  const dur = f('oe-dur', x.dur ? fmtDur(x.dur) : '', { placeholder: '例如 4 h、30 min' });
  const status = h('select', { id: 'oe-status' }, [['plan', '计划'], ['done', '已做'], ['skip', '取消（不做了）']].map(([v, l]) => h('option', { value: v, selected: (x.status || 'plan') === v }, l)));
  const kind = h('select', { id: 'oe-kind' }, KINDS.map((k) => h('option', { value: k.k, selected: x.kind === k.k }, k.k)));
  const link = h('select', { id: 'oe-link' }, h('option', { value: '' }, '不属于某次大实验'), [...new Set([x.link, ...linkTargets().map((p) => p.xid)].filter(Boolean))].map((id) => { const p = lib.allPages().find((q) => q.xid === id); return h('option', { value: id, selected: x.link === id }, `${id}　${p?.title || ''}`); }));
  const note = h('textarea', { id: 'oe-note', rows: 2, placeholder: '现象、注意、哪批样品……' }, x.note || '');
  const rows = h('tbody');
  const drawRows = () => rows.replaceChildren(...x.params.map((p, i) => h('tr', null,
    h('td', null, h('input', { value: p.k, 'aria-label': '参数名', oninput: (e) => { p.k = e.target.value; } })),
    h('td', null, h('input', { value: p.v || '', 'aria-label': `${p.k} 计划值`, placeholder: '计划 / 记录值', oninput: (e) => { p.v = e.target.value; } })),
    h('td', null, h('input', { value: p.a || '', 'aria-label': `${p.k} 实际值`, placeholder: '实际（和计划不同时填）', oninput: (e) => { p.a = e.target.value; } })),
    h('td', null, h('button', { class: 'btn icon ghost small', type: 'button', 'aria-label': '删掉这一行', onclick: () => { x.params.splice(i, 1); drawRows(); } }, icon('close', 14))))));
  x.params ||= [];
  const fillKind = () => { for (const k of kindOf(kind.value).fields) if (!x.params.some((p) => p.k === k)) x.params.push({ k, v: '' }); drawRows(); };
  kind.addEventListener('change', fillKind);
  if (!old) fillKind(); else drawRows();
  const readDur = () => { const m = parseQuick(dur.value).dur; return m || null; };
  modal({
    title: old ? `${x.id}` : '新的小实验', wide: true,
    body: h('div', { class: 'form op-edit' },
      h('label', { for: 'oe-title' }, '做了什么'), title,
      h('div', { class: 'pair three' },
        h('div', null, h('label', { for: 'oe-date' }, '日期'), date),
        h('div', null, h('label', { for: 'oe-status' }, '状态'), status),
        h('div', null, h('label', { for: 'oe-kind' }, '类型'), kind)),
      h('div', { class: 'pair three' },
        h('div', null, h('label', { for: 'oe-start' }, '开始'), start),
        h('div', null, h('label', { for: 'oe-end' }, '结束'), end),
        h('div', null, h('label', { for: 'oe-dur' }, '时长'), dur)),
      h('p', { class: 'muted small' }, '开始、结束、时长填两个，第三个自动算。'),
      h('span', { class: 'label' }, '参数'),
      h('div', { class: 'table-wrap' }, h('table', { class: 'data op-params' }, h('thead', null, h('tr', null, h('th', null, '名称'), h('th', null, '值'), h('th', null, '实际'), h('th'))), rows)),
      h('button', { class: 'btn small', type: 'button', onclick: () => { x.params.push({ k: '', v: '' }); drawRows(); rows.querySelector('tr:last-child input')?.focus(); } }, icon('plus', 14), ' 加一行'),
      h('label', { for: 'oe-link' }, '属于哪次大实验'), link,
      h('label', { for: 'oe-note' }, '备注'), note),
    buttons: [
      old ? { label: '删除', danger: true, run: async () => {
        if ((await choose(`删除 ${x.id}“${x.title}”？`, 'GitHub 历史里仍可找回。', [['yes', '删除'], ['no', '取消']])) !== 'yes') return false;
        try { await saveOp(old, { remove: true }); toast('已删除。'); changed(); after?.(); } catch (e) { toast(saveError(e)); return false; }
      } } : null,
      old ? { label: '复制一份', run: () => { editOp({ ...structuredClone(x), id: '', status: 'plan', date: todayISO(), at: '', note: '', params: x.params.map((p) => ({ k: p.k, v: p.a || p.v })) }, after); } } : null,
      { label: '取消' },
      { label: '保存', primary: true, run: async () => {
        Object.assign(x, { title: title.value.trim(), date: date.value || todayISO(), start: start.value, end: end.value, dur: readDur(), status: status.value, kind: kind.value, link: link.value, note: note.value.trim() });
        if (!x.title) { toast('写一下做了什么。'); title.focus(); return false; }
        if (x.start && x.end) x.dur = null;
        try { const r = await saveOp(x, { old }); toast(`${r.id} 已保存。`); changed(); after?.(); } catch (e) { toast(saveError(e)); return false; }
      } }],
  });
}

// ----- the list page -----
export async function viewOps(params = new URLSearchParams()) {
  const t = todayISO();
  const q = h('input', { type: 'search', placeholder: '搜名称、参数、备注、实验编号…', value: params.get('q') || '', 'aria-label': '搜小实验' });
  let kind = params.get('kind') || '';
  let span = 60;
  const chips = h('div', { class: 'clip-chips' });
  const body = h('div', { class: 'ops-days' });
  const more = h('button', { class: 'btn small', type: 'button', onclick: () => { span += 90; draw(); } }, '再往前看 90 天');
  let all = [];
  const load = async () => { all = await loadOps({ from: addDays(t, -span) }); };
  const paint = () => {
    const words = q.value.toLowerCase().split(/\s+/).filter(Boolean);
    const hit = all.filter((o) => (!kind || o.kind === kind) && words.every((w) => `${o.id} ${o.title} ${o.kind} ${o.note || ''} ${o.link || ''} ${(o.params || []).map((p) => `${p.k} ${p.v} ${p.a || ''}`).join(' ')}`.toLowerCase().includes(w)));
    const counts = new Map(); for (const o of all) counts.set(o.kind, (counts.get(o.kind) || 0) + 1);
    chips.replaceChildren(...[['', '全部', all.length], ...KINDS.filter((k) => counts.get(k.k)).map((k) => [k.k, k.k, counts.get(k.k)])].map(([k, l, n]) => h('button', { type: 'button', class: `chip${kind === k ? ' on' : ''}`, onclick: () => { kind = k; paint(); } }, l, h('b', null, String(n)))));
    const late = hit.filter((o) => opState(o).k === 'late');
    const byDay = new Map();
    for (const o of hit) { if (opState(o).k === 'late') continue; if (!byDay.has(o.date)) byDay.set(o.date, []); byDay.get(o.date).push(o); }
    if (!byDay.has(t) && !words.length && !kind) byDay.set(t, []);
    const days = [...byDay.keys()].sort((a, b) => (a >= t && b >= t ? a.localeCompare(b) : b.localeCompare(a)));
    const future = days.filter((d) => d > t).sort(); const past = days.filter((d) => d < t).sort().reverse();
    const dayBox = (d, list) => h('section', { class: `ops-day${d === t ? ' today' : ''}` },
      h('header', null,
        h('h3', null, d === t ? '今天' : d === addDays(t, 1) ? '明天' : d === addDays(t, -1) ? '昨天' : fmtDate(d), h('span', null, `${weekday(d)}${d === t ? ` · ${fmtDate(d)}` : ''}`)),
        h('span', { class: 'muted small' }, list.length ? `${list.filter((o) => o.status === 'done').length}/${list.length} 已做` : ''),
        h('span', { class: 'grow' }),
        h('button', { class: 'btn small ghost', type: 'button', onclick: () => openQuickOp({ date: d }) }, icon('plus', 14), ' 记一笔'),
        list.length ? h('button', { class: 'btn small', type: 'button', onclick: () => openOpsPrint(d) }, icon('print', 14), ' 打印') : null),
      list.length ? h('ul', { class: 'op-list' }, list.map((o) => opRow(o, { after: draw }))) : h('p', { class: 'muted small' }, '还没有。按 O 或点「记一笔」。'));
    body.replaceChildren(...[
      late.length ? h('section', { class: 'ops-day late' }, h('header', null, h('h3', null, '过期没做的计划', h('span', null, '做了就点圆圈；不做了点开改成「取消」'))), h('ul', { class: 'op-list' }, late.map((o) => opRow(o, { after: draw, showDate: true })))) : null,
      byDay.has(t) ? dayBox(t, byDay.get(t)) : null,
      ...future.map((d) => dayBox(d, byDay.get(d))),
      ...past.map((d) => dayBox(d, byDay.get(d))),
      hit.length || !all.length ? null : h('p', { class: 'muted' }, '没有符合的小实验。'),
      more].filter(Boolean));
  };
  const draw = async () => { await load(); paint(); };
  q.addEventListener('input', (e) => { if (!e.isComposing && !isComposing()) paint(); });
  q.addEventListener('compositionend', paint);
  const root = h('div', { class: 'view library ops' },
    topbar({ back: '#/', backLabel: '首页', title: '小实验', sub: '配溶液、做电极、烘烤……一步一条，一句话记下；当天的打成一页 A4 带去实验室', actions: [
      h('button', { class: 'btn', type: 'button', onclick: () => openOpsPrint(t) }, icon('print', 18), h('span', { class: 'wide-only' }, '打印操作单')),
      h('button', { class: 'btn primary', type: 'button', title: '快捷键 O', onclick: () => openQuickOp() }, icon('plus', 18), h('span', null, '记一笔'))] }),
    demoBanner(),
    h('div', { class: 'ops-wrap' }, h('div', { class: 'search-row' }, q), chips, body));
  const off = onOpsChange(() => { if (!document.body.contains(root)) { off(); return; } draw(); });
  await draw();
  return root;
}

// ----- home: today's small steps, with the one-line box right there -----
export function opsCard() {
  const t = todayISO();
  const list = h('ul', { class: 'op-list' });
  const sub = h('span', null, '');
  const line = h('input', { class: 'oq-line small', placeholder: '一句话记一笔，回车：13:00-17:00 烘烤银电极 120°C', 'aria-label': '记一笔小实验' });
  const draw = async () => {
    const ops = await loadOps({ from: addDays(t, -14), to: addDays(t, 1) }).catch(() => []);
    const shown = ops.filter((o) => o.date === t || (o.date === addDays(t, 1) && o.status !== 'done') || opState(o).k === 'late');
    sub.textContent = shown.length ? `今天 ${ops.filter((o) => o.date === t && o.status === 'done').length}/${ops.filter((o) => o.date === t).length} 已做` : '';
    list.replaceChildren(...shown.map((o) => opRow(o, { compact: true, after: draw, showDate: o.date !== t })));
  };
  line.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter' || isImeEvent(e) || !line.value.trim()) return;
    e.preventDefault();
    const o = parseQuick(line.value); o.status = pref.get();
    const kf = kindOf(o.kind).fields; o.params = [...o.params, ...kf.filter((k) => !o.params.some((p) => p.k === k)).map((k) => ({ k, v: '' }))];
    line.value = '';
    try { const x = await saveOp(o); toast(`${x.id} 已记下（${o.status === 'plan' ? '计划' : '已做'}）。`, { label: '改', run: () => editOp(x, draw) }); changed(); } catch (err) { toast(saveError(err)); }
  });
  const box = h('section', { class: 'ops-card' },
    h('header', null, h('h2', { class: 'section-title' }, '小实验', sub), h('span', { class: 'grow' }),
      h('button', { class: 'btn small ghost', type: 'button', title: '展开的记录框（O）', onclick: () => openQuickOp() }, icon('plus', 14), ' 记一笔'),
      h('button', { class: 'btn small ghost', type: 'button', onclick: () => openOpsPrint(t) }, icon('print', 14), ' 打印今天'),
      h('a', { class: 'btn small ghost', href: '#/ops' }, '全部')),
    line, list);
  const off = onOpsChange(() => { if (!document.body.contains(box)) { off(); return; } draw(); });
  draw();
  return box;
}

// =================== the A4 sheet ===================
const MM = 96 / 25.4;
function opCard(o, { blanks, date }) {
  const st = o.status === 'done';
  const k = kindOf(o.kind);
  const fill = blanks && !st;
  const ps = [...(o.params || [])];
  if (fill) for (const f of k.fields) if (!ps.some((p) => p.k === f)) ps.push({ k: f, v: '' });
  const shownPs = ps.filter((p) => p.v || p.a || fill);
  const time = timeText(o);
  return h('div', { class: `oc${st ? ' done' : ''}`, style: { '--k': KIND_COLOR[o.kind] || '#777' } },
    h('div', { class: 'oc-h' },
      h('span', { class: `oc-box${st ? ' on' : ''}` }, st ? '✓' : ''),
      h('span', { class: 'oc-no' }, String(o.id || '').slice(-2)),
      h('b', { class: 'oc-t' }, o.title),
      h('span', { class: 'oc-k' }, k.k)),
    h('div', { class: 'oc-time' },
      date && o.date !== date ? h('span', { class: 'oc-late' }, `原定 ${o.date.slice(5)}`) : null,
      time ? h('span', null, h('i', null, st ? '时间' : '计划'), time) : null,
      fill ? h('span', { class: 'oc-fill' }, h('i', null, '实际'), h('u', { class: 's' }), '–', h('u', { class: 's' })) : null),
    shownPs.length ? h('table', { class: `oc-ps${shownPs.every((p) => !p.v) ? ' all-tpl' : ''}` }, fill ? h('thead', null, h('tr', null, h('th'), h('th', null, '计划'), h('th', { class: 'oc-a' }, '实际'))) : null, h('tbody', null, shownPs.map((p) => h('tr', { class: p.v || p.a ? null : 'tpl' },
      h('th', null, p.k),
      h('td', { class: p.v ? '' : 'empty' }, p.v || (fill ? '' : '')),
      fill ? h('td', { class: 'oc-a' }, p.a || '') : (p.a && p.a !== p.v ? h('td', { class: 'oc-a filled' }, `实际 ${p.a}`) : null))))) : null,
    o.link ? h('div', { class: 'oc-link' }, `→ ${o.link}`) : null,
    o.note ? h('div', { class: 'oc-note' }, o.note) : null,
    fill ? h('div', { class: 'oc-line' }, h('i', null, '现象 / 备注')) : null);
}
const blankCard = () => h('div', { class: 'oc blank' },
  h('div', { class: 'oc-h' }, h('span', { class: 'oc-box' }), h('u', { class: 'oc-t' }), h('span', { class: 'oc-k' }, '临时加')),
  h('div', { class: 'oc-time' }, h('span', { class: 'oc-fill' }, h('i', null, '时间'), h('u', { class: 's' }), '–', h('u', { class: 's' }))),
  h('div', { class: 'oc-line' }, h('i', null, '参数')), h('div', { class: 'oc-line' }, h('i', null, '备注')));

// A day strip 0–24 h with a bar per timed step, lanes stacked so overlaps (two ovens at once) stay readable.
function timeline(items) {
  const timed = items.filter((o) => toMin(o.start) != null).map((o) => {
    const s = toMin(o.start); let e = toMin(o.end) ?? (o.dur ? s + o.dur : s + 20); if (e <= s) e += 1440;
    return { o, s, e: Math.min(e, 1440) };
  });
  if (!timed.length) return null;
  const lo = Math.max(0, Math.floor(Math.min(...timed.map((x) => x.s)) / 60) - 1) * 60;
  let hi = Math.min(24, Math.ceil(Math.max(...timed.map((x) => x.e)) / 60) + 1) * 60;
  // a label runs past a short bar; reserve its width (≈2.6 mm per Chinese character on a ~180 mm strip) so lanes do not collide
  let perMin = 180 / (hi - lo);
  const labelEnd = (x) => x.s + (([...`${x.o.title}  00`].reduce((n, ch) => n + (/[\u0000-\u00ff]/.test(ch) ? 1.5 : 2.6), 0) + 3) / perMin);
  for (let k = 0; k < 2; k++) { hi = Math.min(1440, Math.max(hi, Math.ceil(Math.max(...timed.map(labelEnd)) / 60) * 60)); perMin = 180 / (hi - lo); } // room for the last label
  const lanes = [];
  for (const x of timed.sort((a, b) => a.s - b.s)) { const end = Math.max(x.e, labelEnd(x)); let i = lanes.findIndex((v) => v <= x.s); if (i < 0) { i = lanes.length; lanes.push(0); } lanes[i] = end; x.lane = i; }
  const pct = (m) => `${((m - lo) / (hi - lo)) * 100}%`;
  const ticks = []; for (let m = lo; m <= hi; m += 60) ticks.push(m);
  return h('div', { class: 'ops-tl', style: { '--lanes': String(lanes.length) } },
    ticks.map((m) => h('span', { class: 'tl-tick', style: { left: pct(m) } }, h('em', null, String(m / 60)))),
    timed.flatMap((x) => {
      const at = { left: pct(x.s), top: `calc(${x.lane} * var(--lane) + 4.2mm)`, '--k': KIND_COLOR[x.o.kind] || '#777' };
      return [h('span', { class: `tl-bar${x.o.status === 'done' ? ' done' : ''}`, style: { ...at, width: `calc(${pct(x.e)} - ${pct(x.s)})` } }),
        h('span', { class: 'tl-label', style: at }, h('b', null, String(x.o.id || '').slice(-2)), ` ${x.o.title}`)];
    }));
}

export function opsSheet(items, { date, blanks = true, fillBlank = true, title = '' } = {}) {
  const nb = lib?.notebook || {};
  const done = items.filter((o) => o.status === 'done').length;
  const days = [...new Set(items.map((o) => o.date))].sort();
  const when = days.length > 1 ? `${fmtDate(days[0])} – ${fmtDate(days[days.length - 1])}` : `${fmtDate(date || days[0] || todayISO())}　${weekday(date || days[0] || todayISO())}`;
  const grid = h('div', { class: 'ops-grid' }, items.map((o) => opCard(o, { blanks, date })));
  const inner = h('div', { class: 'ops-in' },
    h('header', { class: 'ops-h' },
      h('div', null, h('div', { class: 'ops-kicker' }, '小实验操作单 · BENCH SHEET'), h('h1', null, title || when)),
      h('div', { class: 'ops-meta' },
        h('span', null, h('i', null, '操作人'), h('u')),
        h('span', null, h('i', null, '共'), `${items.length} 项${done ? `（已做 ${done}）` : ''}`),
        h('span', { class: 'ops-nb' }, nb.title || '实验记录本'))),
    timeline(items),
    grid,
    h('footer', { class: 'ops-f' }, h('span', null, '做完一项勾一项；实际值写在右栏。回来后在记录本「小实验」里点圆圈标已做，点开补实际值。'), h('span', null, `打印于 ${nowISO().slice(0, 16).replace('T', ' ')}`)));
  const page = h('div', { class: 'ops-page' }, inner);
  page.fit = () => fitSheet(page, grid, fillBlank);
  return page;
}
// Shrink the type until everything sits on one A4 sheet; then fill what is left with blank cards for steps added at the bench.
function fitSheet(page, grid, fillBlank) {
  const inner = page.firstChild;
  const cs = getComputedStyle(page);
  const room = () => page.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) - 4; // 1 mm to spare
  const fits = () => inner.scrollHeight <= room();
  grid.querySelectorAll('.oc.blank').forEach((b) => b.remove());
  page.classList.remove('multi');
  inner.style.minHeight = '0'; // measure what the content needs; afterwards the footer goes back to the bottom
  try { return fitInner(); } finally { inner.style.minHeight = ''; }
  function fitInner() {
    // Ever tighter: smaller type → leave out the empty template rows → three columns. Only then a second sheet.
    const stages = [['', 10, 8], ['compact', 10, 7.5], ['compact c3', 9, 6.5]];
    let pt = 10; let mode = '';
    for (const [cls, top, low] of stages) {
      page.classList.remove('compact', 'c3'); if (cls) page.classList.add(...cls.split(' '));
      mode = cls;
      for (pt = top; pt >= low; pt -= 0.25) { inner.style.setProperty('--fs', `${pt}pt`); if (fits()) break; }
      if (fits()) break;
    }
    if (!fits()) { page.classList.add('multi'); return { pt: Math.max(pt, 6.5), pages: Math.ceil(inner.scrollHeight / (297 * MM)), mode }; }
    if (fillBlank) {
      for (let i = 0; i < 4; i++) {
        const b = blankCard(); grid.append(b);
        if (!fits()) { b.remove(); break; }
      }
    }
    return { pt, pages: 1, mode, blanks: grid.querySelectorAll('.oc.blank').length };
  }
}

export async function openOpsPrint(date = todayISO()) {
  const all = await loadOps({ from: addDays(date, -30), to: addDays(date, 30) }).catch(() => []);
  const day = h('input', { id: 'op-day', type: 'date', value: date });
  const late = h('input', { type: 'checkbox', id: 'op-late', checked: true });
  const blanks = h('input', { type: 'checkbox', id: 'op-blanks', checked: true });
  const fillBlank = h('input', { type: 'checkbox', id: 'op-fill', checked: true });
  const pickBox = h('div', { class: 'op-pick' });
  const info = h('p', { class: 'muted small' });
  const holder = h('div', { class: 'ops-prev-in' });
  const prevWrap = h('div', { class: 'ops-prev' }, holder);
  const chosen = new Map();
  let sheet = null;
  const pool = () => all.filter((o) => o.date === day.value || (late.checked && o.status !== 'done' && o.status !== 'skip' && o.date < day.value && o.date >= addDays(day.value, -14)));
  const items = () => pool().filter((o) => chosen.get(o.id) !== false);
  const draw = () => {
    pickBox.replaceChildren(...(pool().length ? pool().map((o) => h('label', { class: 'check op-pk' }, h('input', { type: 'checkbox', checked: chosen.get(o.id) !== false, onchange: (e) => { chosen.set(o.id, e.target.checked); layout(); } }),
      h('span', { class: 'op-pk-t' }, o.date !== day.value ? h('b', { class: 'late' }, `${o.date.slice(5)} `) : null, o.start ? `${o.start} ` : '', o.title, h('em', null, o.status === 'done' ? ' 已做' : ''))))
      : [h('p', { class: 'muted small' }, '这一天还没有小实验。先在「记一笔」里排几条计划，再来打印；也可以直接打印空白单，到实验室手写。')]));
    layout();
  };
  const layout = () => {
    const its = items();
    sheet = opsSheet(its, { date: day.value, blanks: blanks.checked, fillBlank: fillBlank.checked });
    holder.replaceChildren(sheet);
    requestAnimationFrame(() => {
      const r = sheet.fit();
      const z = Math.min(1, (prevWrap.clientWidth - 2) / (210 * MM));
      holder.style.transform = `scale(${z})`;
      holder.style.height = `${(r.pages > 1 ? holder.firstChild.scrollHeight : 297 * MM)}px`;
      prevWrap.style.height = `${(r.pages > 1 ? holder.firstChild.scrollHeight : 297 * MM) * z}px`;
      info.textContent = r.pages > 1 ? `项目太多，一页排不下（已缩到 ${r.pt} pt、三栏），会打成 ${r.pages} 页。可以取消勾选几项。` : `一页 A4 · 字号 ${r.pt} pt${/c3/.test(r.mode) ? ' · 三栏' : ''}${r.mode ? ' · 空着的模板行已省略' : ''}${r.blanks ? ` · 补了 ${r.blanks} 张空白卡` : ''}`;
    });
  };
  [day, late].forEach((x) => x.addEventListener('change', draw));
  [blanks, fillBlank].forEach((x) => x.addEventListener('change', layout));
  const dlg = modal({
    title: '打印小实验操作单', wide: true,
    body: h('div', { class: 'form op-print' },
      h('div', { class: 'op-print-side' },
        h('label', { for: 'op-day' }, '日期'), day,
        h('label', { class: 'check', for: 'op-late' }, late, ' 加上前两周没做完的计划'),
        h('span', { class: 'label' }, '打印哪些'), pickBox,
        h('label', { class: 'check', for: 'op-blanks' }, blanks, ' 计划项留「实际」手写栏'),
        h('label', { class: 'check', for: 'op-fill' }, fillBlank, ' 剩下的地方补空白卡（现场临时加的）'),
        info),
      prevWrap),
    buttons: [{ label: '取消' }, { label: '打印 / 存为 PDF', primary: true, run: () => { printSheet(sheet, day.value); } }],
  });
  dlg.querySelector('.modal')?.classList.add('xwide');
  draw();
  return dlg;
}

function printSheet(sheet, date) {
  const pr = document.getElementById('print-root');
  const copy = sheet.cloneNode(true);
  pr.replaceChildren(copy);
  document.body.classList.add('print-volume', 'print-ops');
  const title = document.title;
  document.title = `小实验操作单_${String(date).replace(/-/g, '')}`;
  window.addEventListener('afterprint', () => { document.title = title; document.body.classList.remove('print-ops'); }, { once: true });
  setTimeout(() => window.print(), 60);
}

// For the global search
export async function opSearchItems() {
  return (await loadOps()).map((o) => ({ tag: o.id, title: `${o.title}`, href: `#/ops?q=${encodeURIComponent(o.id)}`, text: `${o.id} ${o.date} ${o.title} ${o.kind} ${timeText(o)} ${(o.params || []).map((p) => `${p.k} ${p.v} ${p.a || ''}`).join(' ')} ${o.note || ''} ${o.link || ''}` }));
}
