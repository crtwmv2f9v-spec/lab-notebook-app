// Experiment records: IDs, sample tables, reagent and protocol libraries, follow-ups, naming.
import { parseFrontMatter, todayISO } from './model.js';

// ---------- naming ----------
// Experiment  20261101-OECT-01        date-topic-sequence
// Sample      20261101-OECT-01-#09    experiment-#condition
// Data file   20261101-OECT-01-#09_TR_VD-0.3V_gm.xls   sample_test_condition_purpose
export const EXP_RE = /\b(\d{8})-([A-Z][A-Z0-9]{1,11})-(\d{2,3})\b/;
export const SAMPLE_RE = /\b(\d{8}-[A-Z][A-Z0-9]{1,11}-\d{2,3})-#(\d{1,3}[a-z]?)\b/;
const two = (n) => String(n).padStart(2, '0');

export function cleanTopic(s) { return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12); }
export function expId(dateISO, topic, seq) { return `${String(dateISO).replace(/-/g, '')}-${cleanTopic(topic)}-${two(seq)}`; }
export function sampleNo(raw) {
  const m = String(raw ?? '').trim().replace(/^#/, '').match(/^(\d{1,3})([a-z]?)$/i);
  return m ? `#${two(parseInt(m[1], 10))}${m[2].toLowerCase()}` : String(raw ?? '').trim();
}
export const sampleId = (exp, no) => `${exp}-${sampleNo(no)}`;
// "1, 9, 10, 12-14" -> [1, 9, 10, 12, 13, 14]
export function parseNumbers(s) {
  const out = [];
  for (const part of String(s || '').split(/[,，\s]+/).filter(Boolean)) {
    const r = part.replace(/#/g, '').match(/^(\d+)\s*[-~–]\s*(\d+)$/);
    if (r) { for (let i = +r[1]; i <= +r[2] && out.length < 200; i++) out.push(i); } else if (/^\d+$/.test(part.replace(/#/g, ''))) out.push(parseInt(part.replace(/#/g, ''), 10));
  }
  return [...new Set(out)];
}
// Next free sequence number for this date and topic, across every volume.
export function nextSeq(pages, dateISO, topic) {
  const prefix = `${String(dateISO).replace(/-/g, '')}-${cleanTopic(topic)}-`;
  let max = 0;
  for (const p of pages) if (p.xid?.startsWith(prefix)) max = Math.max(max, parseInt(p.xid.slice(prefix.length), 10) || 0);
  return max + 1;
}
export function asciiSlug(s, fallback = 'photo') {
  return String(s || '').normalize('NFKD').replace(/[^\w.+-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || fallback;
}

// ---------- CSV ----------
export function parseCSV(text) {
  const rows = []; let row = []; let cell = ''; let q = false;
  const s = String(text ?? '').replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"' && s[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.map((r) => r.map((x) => x.trim())).filter((r) => r.some((x) => x !== ''));
}
const csvCell = (v) => { v = String(v ?? ''); return /[",\n\r]|^\s|\s$/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; };
export const toCSV = (rows) => `${rows.map((r) => r.map(csvCell).join(',')).join('\n')}\n`;

// ---------- sample table (a ```samples block in the page) ----------
// The first column is the sample number; columns starting with "结果" hold results.
const SAMPLES_RE = /```samples[^\n]*\n([\s\S]*?)```/;
export const isResultCol = (c) => /^(结果|result)\s*[:：]/i.test(c);
export const colLabel = (c) => String(c).replace(/^(结果|result)\s*[:：]\s*/i, '');
export function readSamples(body) {
  const m = String(body || '').match(SAMPLES_RE);
  if (!m) return null;
  const rows = parseCSV(m[1]);
  const cols = rows.shift() || ['编号'];
  return { cols, rows: rows.map((r) => cols.map((_, i) => r[i] ?? '')) };
}
export function writeSamples(body, table) {
  const block = `\`\`\`samples\n${toCSV([table.cols, ...table.rows]).trimEnd()}\n\`\`\``;
  return SAMPLES_RE.test(body) ? body.replace(SAMPLES_RE, () => block) : `${String(body || '').trimEnd()}\n\n${block}\n`;
}
export function samplesTemplate(numbers, variables, results) {
  const cols = ['编号', ...variables, ...results.map((r) => `结果: ${r}`), '备注'];
  const rows = (numbers.length ? numbers : [1]).map((n) => cols.map((_, i) => (i === 0 ? sampleNo(n) : '')));
  return { cols, rows };
}

// ---------- follow-ups ("2026-11-04 #09 第3天稳定性"; done ones start with ✓) ----------
export function parseFollowup(s) {
  const m = String(s).trim().match(/^(✓\s*)?(\d{4}-\d{2}-\d{2})\s*(.*)$/);
  return m ? { done: !!m[1], date: m[2], text: m[3] || '' } : null;
}
export const formatFollowup = (f) => `${f.done ? '✓ ' : ''}${f.date} ${f.text}`.trim();
export function addDays(iso, n) {
  const d = new Date(`${iso}T12:00:00`); d.setDate(d.getDate() + n); return todayISO(d);
}
export function daysFrom(iso, today = todayISO()) {
  return Math.round((new Date(`${iso}T12:00:00`) - new Date(`${today}T12:00:00`)) / 864e5);
}

// Calendar file so reminders reach the phone's own calendar app.
export function icsFor(items) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const escText = (s) => String(s).replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\n/g, '\\n');
  const ev = items.map((it, i) => [
    'BEGIN:VEVENT',
    `UID:${it.uid || `${stamp}-${i}`}@labnotebook`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${it.date.replace(/-/g, '')}T090000`,
    `DTEND:${it.date.replace(/-/g, '')}T093000`,
    `SUMMARY:${escText(it.summary)}`,
    it.description ? `DESCRIPTION:${escText(it.description)}` : null,
    'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${escText(it.summary)}`, 'TRIGGER:-PT0M', 'END:VALARM',
    'END:VEVENT',
  ].filter(Boolean).join('\r\n'));
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Lab notebook//CN', 'CALSCALE:GREGORIAN', ...ev, 'END:VCALENDAR', ''].join('\r\n');
}

// ---------- reagent library: library/reagents.csv ----------
export const REAGENTS_PATH = 'library/reagents.csv';
export const PROTOCOL_DIR = 'library/protocols/';
export const REAGENT_FIELDS = [
  ['id', '编号'], ['name', '名称'], ['spec', '规格/纯度/浓度'], ['vendor', '厂商'], ['catalog', '货号'],
  ['lot', '批号'], ['cas', 'CAS'], ['location', '存放位置'], ['opened', '开封日期'], ['expires', '有效期至'], ['notes', '备注'],
];
// Columns can be renamed, added and removed; they are kept in notebook.json as [[key, label], …].
export const reagentFields = (nb) => (Array.isArray(nb?.reagentColumns) && nb.reagentColumns.length ? nb.reagentColumns : REAGENT_FIELDS);
export const LOCKED_REAGENT_KEYS = ['id', 'name'];
export function parseReagents(text, fields = REAGENT_FIELDS) {
  const rows = parseCSV(text);
  const head = rows.shift() || [];
  const all = [...fields, ...REAGENT_FIELDS];
  const keys = head.map((c) => all.find(([k, l]) => k === c || k === c.toLowerCase() || l === c)?.[0] || c);
  return rows.map((r) => Object.fromEntries(keys.map((k, i) => [k, r[i] ?? '']))).filter((r) => r.id);
}
export const reagentsCSV = (list, fields = REAGENT_FIELDS) => toCSV([fields.map(([k]) => k), ...list.map((r) => fields.map(([k]) => r[k] ?? ''))]);
export function nextReagentId(list) {
  const max = Math.max(0, ...list.map((r) => parseInt(String(r.id).replace(/\D/g, ''), 10) || 0));
  return `R-${String(max + 1).padStart(4, '0')}`;
}

// ---------- protocol library: library/protocols/<ID>.md ----------
export const protocolPath = (id) => `${PROTOCOL_DIR}${id}.md`;
export function parseProtocol(md) {
  const { fm, body } = parseFrontMatter(md);
  const list = (v) => (Array.isArray(v) ? v : String(v || '').split(',')).map((x) => String(x).trim()).filter(Boolean);
  return {
    id: String(fm.id || '').trim(), title: fm.title || '', version: fm.version || '', source: fm.source || '',
    reagents: list(fm.reagents), variables: list(fm.variables), results: list(fm.results), tags: list(fm.tags), body,
  };
}
export const cleanProtocolId = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9.-]+/g, '-').replace(/^-|-$/g, '');

// Library files are small; read them once per git blob.
const cache = new Map();
async function cached(lib, path, parse) {
  const sha = lib.tree.get(path);
  if (!sha) return null;
  const k = `${path}@${sha}`;
  if (!cache.has(k)) cache.set(k, lib.readText(path).then(parse).catch((e) => { cache.delete(k); throw e; }));
  return cache.get(k);
}
export async function loadReagents(lib) { return (await cached(lib, REAGENTS_PATH, (t) => parseReagents(t, reagentFields(lib.notebook)))) || []; }
export function protocolIds(lib) {
  return [...lib.tree.keys()].filter((p) => p.startsWith(PROTOCOL_DIR) && p.endsWith('.md')).map((p) => p.slice(PROTOCOL_DIR.length, -3)).sort();
}
export async function loadProtocol(lib, id) { return cached(lib, protocolPath(id), parseProtocol); }
export async function loadProtocols(lib) {
  return (await Promise.all(protocolIds(lib).map((id) => loadProtocol(lib, id).catch(() => null)))).filter(Boolean);
}

// Reagent expiry as follow-up items.
export function reagentAlerts(reagents, within = 30, today = todayISO()) {
  return reagents.filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.expires) && daysFrom(r.expires, today) <= within)
    .map((r) => ({ date: r.expires, text: `试剂到期：${r.id} ${r.name}${r.lot ? `（批号 ${r.lot}）` : ''}`, reagent: r.id }));
}

// ---------- operation steps (a ```steps block) ----------
// One step per line:  操作 | 用量 | 物质 | 加到/容器 | 条件 | 细节   (every field after 操作 is optional)
//   移取 | 10 mL | DI 水 R-0003 | 20 mL 玻璃瓶 | 室温 | 沿瓶壁缓慢加入
export const STEP_FIELDS = [['op', '操作'], ['amount', '用量'], ['what', '物质/试剂'], ['into', '加到/容器'], ['cond', '条件'], ['note', '细节']];
const STEPS_RE = /```steps[^\n]*\n([\s\S]*?)```/;
export function parseSteps(src) {
  return String(src || '').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
    .map((l) => { const parts = l.split('|').map((x) => x.trim()); return Object.fromEntries(STEP_FIELDS.map(([k], i) => [k, parts[i] || ''])); });
}
export function stepsText(steps) {
  return steps.filter((s) => STEP_FIELDS.some(([k]) => s[k]))
    .map((s) => STEP_FIELDS.map(([k]) => String(s[k] || '').replace(/\|/g, '/').trim()).join(' | ').replace(/( \| )+$/, '')).join('\n');
}
export function readSteps(body) { const m = String(body || '').match(STEPS_RE); return m ? parseSteps(m[1]) : null; }
export function writeSteps(body, steps) {
  const block = `\`\`\`steps\n${stepsText(steps)}\n\`\`\``;
  return STEPS_RE.test(body) ? body.replace(STEPS_RE, () => block) : `${String(body || '').trimEnd()}\n\n## 操作步骤\n\n${block}\n`;
}
export const STEP_OPS = ['称取', '移取', '加入', '滴加', '混合', '搅拌', '超声', '涡旋', '离心', '过滤', '稀释', '定容', '浸泡', '清洗', '冲洗', '吹干', '烘干', '旋涂', '滴涂', '打印', '退火', '等离子处理', '静置', '孵育', '测试'];
export const STEP_CONTAINERS = ['1.5 mL 离心管', '2 mL 离心管', '15 mL 离心管', '50 mL 离心管', '5 mL 玻璃瓶', '20 mL 玻璃瓶', '50 mL 烧杯', '100 mL 烧杯', '容量瓶', '培养皿', '96 孔板', '比色皿', '玻璃片', '器件表面', '上一步溶液'];

// ---------- chemical equations (a ```reaction block, one equation per line) ----------
// 2 H2O2 ->[Pt] 2 H2O + O2 | (1)        Fe^3+ + e- <=> Fe^2+        阳极：H2O2 -> O2 + 2 H+ + 2 e-
const escH = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ARROWS = { '->': '→', '→': '→', '<-': '←', '<=>': '⇌', '⇌': '⇌', '<->': '↔', '=': '=' };
function charge(c) { return `<sup>${escH(c.replace(/-/g, '−'))}</sup>`; }
export function speciesHTML(tok) {
  let s = tok.trim();
  if (!s) return '';
  const em = s.match(/^(\d*)\s*e-$/);
  if (em) return `${em[1] ? `<span class="rx-coef">${em[1]}</span>` : ''}<span class="rx-sp">e${charge('-')}</span>`;
  let coef = '';
  const cm = s.match(/^(\d+(?:\.\d+)?|\d+\/\d+|[nx])\s*(?=[A-Z([])/);
  if (cm) { coef = `<span class="rx-coef">${escH(cm[1])}</span>`; s = s.slice(cm[0].length); }
  let state = '';
  const sm = s.match(/\((aq|s|l|g)\)$/);
  if (sm) { state = `<span class="rx-state">(${sm[1]})</span>`; s = s.slice(0, -sm[0].length); }
  let ch = '';
  if (s.includes(':') && !/^:|:$/.test(s)) return `${coef}<span class="rx-sp">${s.split(':').map((x) => speciesHTML(x).replace(/^<span class="rx-sp">|<\/span>$/g, '')).join(':')}</span>${state}`;
  const explicit = s.match(/\^([0-9]*[+-]|0|[0-9]*[a-z][+-])$/);
  if (explicit) { ch = charge(explicit[1]); s = s.slice(0, -explicit[0].length); } else {
    const mono = s.match(/^([A-Z][a-z]?)(\d[+-])$/); // Fe3+, Cu2+: a single element followed by its charge
    if (mono) { ch = charge(mono[2]); s = mono[1]; } else {
      const tail = s.match(/[A-Za-z)\]\d]([+-])$/);
      if (tail && /[A-Za-z]/.test(s)) { ch = charge(tail[1]); s = s.slice(0, -1); }
    }
  }
  const body = escH(s).replace(/([A-Za-z)\]])(\d+)/g, '$1<sub>$2</sub>').replace(/\*/g, '·');
  return `${coef}<span class="rx-sp">${body}${ch}</span>${state}`;
}
export function reactionHTML(line) {
  let s = String(line).trim();
  let label = '';
  const lm = s.match(/\s\|\s*(.+)$/);
  if (lm) { label = lm[1]; s = s.slice(0, lm.index); }
  let lead = '';
  const pm = s.match(/^([^：:]{1,16}[：:])\s*/);
  if (pm && (pm[1].endsWith('：') || /[\u4e00-\u9fff]/.test(pm[1])) && !/->|=/.test(pm[1])) { lead = pm[1]; s = s.slice(pm[0].length); }
  const parts = s.split(/(<=>|<->|->|<-|→|⇌|\s=\s)(?:\[([^\]]*)\])?(?:\[([^\]]*)\])?/);
  let html = '';
  for (let i = 0; i < parts.length; i += 4) {
    html += (parts[i] || '').split(/\s\+\s/).map(speciesHTML).filter(Boolean).join('<span class="rx-plus">+</span>');
    if (i + 1 < parts.length) {
      const a = ARROWS[parts[i + 1].trim()] || parts[i + 1];
      const up = parts[i + 2]; const down = parts[i + 3];
      html += up || down
        ? `<span class="rx-arrow cond"><span class="rx-up">${escH(up || '')}</span><span class="rx-a">${a === '=' ? '═══' : a.repeat(1)}</span><span class="rx-down">${escH(down || '')}</span></span>`
        : `<span class="rx-arrow">${a}</span>`;
    }
  }
  return { lead, html, label };
}

// ---------- sections and quotes of other experiments ----------
// A ```quote block:  first line = experiment number or vol/num, optionally "#section"; the rest is a note.
const headingRE = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
export function headings(body) {
  let fence = false;
  return String(body || '').split('\n').flatMap((l) => {
    if (/^```/.test(l)) fence = !fence;
    const m = !fence && l.match(headingRE);
    return m ? [{ level: m[1].length, text: m[2] }] : [];
  });
}
// Lines of the section under the heading `name` (until the next heading of the same or a higher level).
function sectionRange(lines, name) {
  let fence = false; let start = -1; let level = 0;
  for (let i = 0; i < lines.length; i++) {
    if (/^```/.test(lines[i])) fence = !fence;
    const m = !fence && lines[i].match(headingRE);
    if (!m) continue;
    if (start >= 0 && m[1].length <= level) return [start, i];
    if (start < 0 && m[2] === name) { start = i + 1; level = m[1].length; }
  }
  return start >= 0 ? [start, lines.length] : null;
}
export function sectionOf(body, name) {
  if (!name) return String(body || '');
  const lines = String(body || '').split('\n'); const r = sectionRange(lines, name);
  return r ? lines.slice(r[0], r[1]).join('\n').trim() : null;
}
export function replaceSection(body, name, content) {
  const lines = String(body || '').split('\n'); const r = sectionRange(lines, name);
  if (!r) return `${String(body || '').trimEnd()}\n\n## ${name}\n\n${content}\n`;
  return [...lines.slice(0, r[0]), '', content, '', ...lines.slice(r[1])].join('\n').replace(/\n{3,}/g, '\n\n');
}
export function parseQuote(src) {
  const [first = '', ...rest] = String(src || '').split('\n');
  const [ref, section = ''] = first.trim().split('#').map((x) => x.trim());
  return { ref, section, note: rest.join('\n').trim() };
}
export const quoteBlock = (ref, section, note) => `\`\`\`quote\n${ref}${section ? ` #${section}` : ''}\n${note || ''}`.trimEnd() + '\n```';

// ---------- lab-made solutions: library/solutions.csv (S-0001, one row per batch) ----------
export const SOLUTIONS_PATH = 'library/solutions.csv';
export const SOLUTION_FIELDS = [
  ['id', '编号'], ['name', '名称'], ['recipe', '组成（试剂/溶液 × 用量）'], ['conc', '浓度/配比'], ['volume', '总量'],
  ['prepared', '配制日期'], ['by', '配制人'], ['expires', '有效期至'], ['location', '存放位置'], ['page', '配制记录'], ['status', '状态'], ['notes', '备注'],
];
export const SOLUTION_STATUS = ['在用', '用完', '废弃'];
// Columns can be renamed, added and removed like the reagent library's; kept in notebook.json as solutionColumns.
export const solutionFields = (nb) => (Array.isArray(nb?.solutionColumns) && nb.solutionColumns.length ? nb.solutionColumns : SOLUTION_FIELDS);
export const LOCKED_SOLUTION_KEYS = ['id', 'name', 'recipe', 'status'];
export function nextSolutionId(list) {
  const max = Math.max(0, ...list.map((r) => parseInt(String(r.id).replace(/\D/g, ''), 10) || 0));
  return `S-${String(max + 1).padStart(4, '0')}`;
}
// "R-0001 × 1 mL; R-0002 × 10 µL" <-> [{ id, amount }]
export const parseRecipe = (s) => String(s || '').split(/[;；]/).map((x) => x.trim()).filter(Boolean)
  .map((x) => { const m = x.match(/^([RS]-\d{4})\s*(?:[×x*]\s*)?(.*)$/i); return m ? { id: m[1].toUpperCase(), amount: m[2].trim() } : { id: '', amount: x }; });
export const recipeText = (rows) => rows.filter((r) => r.id || r.amount).map((r) => `${r.id}${r.amount ? ` × ${r.amount}` : ''}`.trim()).join('; ');
export async function loadSolutions(lib) { return (await cached(lib, SOLUTIONS_PATH, (t) => parseReagents(t, solutionFields(lib.notebook)))) || []; }
export function solutionAlerts(list, within = 14, today = todayISO()) {
  return list.filter((s) => !['用完', '废弃'].includes(s.status) && /^\d{4}-\d{2}-\d{2}$/.test(s.expires) && daysFrom(s.expires, today) <= within)
    .map((s) => ({ date: s.expires, text: `溶液到期：${s.id} ${s.name}`, solution: s.id }));
}

// ---------- thinking notebook: hypotheses and their evidence (thinking/H-0001.json) ----------
// { id, title, status, confidence, description, predictions: [text], evidence: [{ id: 'E1', kind, date, text, src?: { xid, vol, num } | { url }, photos: [repo path] }],
//   history: [{ at, status, confidence, why }], created, updated }
export const THINK_DIR = 'thinking/';
export const HYP_STATUS = ['提出', '验证中', '支持', '否定', '搁置'];
export const HYP_CONF = ['低', '中', '高'];
export const EV_KIND = ['支持', '反对', '待定'];
export const hypPath = (id) => `${THINK_DIR}${id}.json`;
export const HYP_RE = /\bH-\d{4}\b/;
export const hypIds = (lib) => [...lib.tree.keys()].map((p) => (p.match(/^thinking\/(H-\d{4})\.json$/) || [])[1]).filter(Boolean).sort();
export async function loadHypothesis(lib, id) { return cached(lib, hypPath(id), (t) => JSON.parse(t)); }
export async function loadHypotheses(lib) { return (await Promise.all(hypIds(lib).map((id) => loadHypothesis(lib, id).catch(() => null)))).filter(Boolean); }
export function nextHypId(ids) {
  const max = Math.max(0, ...ids.map((x) => parseInt(String(x).replace(/\D/g, ''), 10) || 0));
  return `H-${String(max + 1).padStart(4, '0')}`;
}
export const evidenceCounts = (hyp) => Object.fromEntries(EV_KIND.map((k) => [k, (hyp.evidence || []).filter((e) => e.kind === k).length]));
export function nextEvidenceId(hyp) {
  const max = Math.max(0, ...(hyp.evidence || []).map((e) => parseInt(String(e.id).replace(/\D/g, ''), 10) || 0));
  return `E${max + 1}`;
}

// ---------- potential research topics (thinking/topics.json) ----------
// { id: 'T-001', title, why, links, priority, status, pinned, every (days, 0 = no review), next (ISO date), reviews: [{ at, note }], created, updated }
export const TOPICS_PATH = 'thinking/topics.json';
export const TOPIC_STATUS = ['想法', '调研中', '准备开展', '进行中', '已转为课题', '放弃'];
export const TOPIC_PRIORITY = ['高', '中', '低'];
export const TOPIC_EVERY = [[7, '每周'], [14, '每两周'], [30, '每月'], [90, '每季度'], [0, '不提醒']];
export async function loadTopics(lib) { return (await cached(lib, TOPICS_PATH, (t) => JSON.parse(t).topics || [])) || []; }
export const activeTopic = (t) => !['已转为课题', '放弃'].includes(t.status);
export function topicAlerts(list, within = 0, today = todayISO()) {
  return list.filter((t) => activeTopic(t) && t.every && /^\d{4}-\d{2}-\d{2}$/.test(t.next || '') && daysFrom(t.next, today) <= within)
    .map((t) => ({ date: t.next, text: `回顾课题：${t.title}`, topic: t.id }));
}

// ---------- tables pasted from Excel / WPS / Origin / Numbers ----------
// Spreadsheets put tab-separated text on the clipboard; cells holding tabs or line breaks are quoted.
export function parseTSV(text) {
  const rows = []; let row = []; let cell = ''; let q = false;
  const s = String(text || '').replace(/\r\n?/g, '\n');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"' && s[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c;
    } else if (c === '"' && cell === '') q = true;
    else if (c === '\t') { row.push(cell); cell = ''; } else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  const width = Math.max(0, ...rows.map((r) => r.length));
  return rows.map((r) => [...r.map((v) => v.trim()), ...Array(width - r.length).fill('')]).filter((r) => r.some(Boolean));
}
// Header names that read as measured results rather than set conditions.
export const RESULT_HINT = /\b(gm|g_m|vth|v_th|on\/off|ss|mobility|ion|ioff|c\*|μc\*)(?!\w)|开关比|迁移率|跨导|阈值|电流|电容|响应|灵敏度|结果|产率|收率/i;
const isNumberish = (v) => /^[-+]?[\d.,]+(e[-+]?\d+)?\s*%?$/i.test(String(v).trim());
// A first row with no numbers, above rows that have some, is a header row.
export const looksLikeHeader = (rows) => rows.length > 1 && rows[0].every((v) => !isNumberish(v)) && rows.slice(1).some((r) => r.some(isNumberish));
// Markdown pipe table; the first row is the header.
export function mdTable(rows) {
  const esc = (v) => String(v ?? '').replace(/\|/g, '\\|').replace(/\n/g, '<br>');
  const head = rows[0].map((v, i) => esc(v) || `列${i + 1}`);
  return [`| ${head.join(' | ')} |`, `| ${head.map((_, i) => (rows.slice(1).every((r) => !r[i] || isNumberish(r[i])) ? '---:' : '---')).join(' | ')} |`,
    ...rows.slice(1).map((r) => `| ${r.map(esc).join(' | ')} |`)].join('\n');
}

// ---------- key resources used on a page: ```materials  R-0001 | 分装瓶 #2 | 20 mg | 备注 ----------
export const MATERIAL_FROM = ['原瓶', '母液', '分装瓶', '其他'];
const MATERIALS_RE = /```materials\n([\s\S]*?)```/;
export function parseMaterials(src) {
  return String(src || '').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).map((l) => {
    const [id = '', from = '', amount = '', note = ''] = l.split('|').map((x) => x.trim());
    return { id, from, amount, note };
  }).filter((x) => x.id);
}
export const materialsText = (list) => list.map((m) => [m.id, m.from, m.amount, m.note].map((x) => String(x || '').replace(/\|/g, '/')).join(' | ').replace(/( \| )+$/, '')).join('\n');
export function readMaterials(body) {
  const m = String(body || '').match(MATERIALS_RE);
  return m ? parseMaterials(m[1]) : null;
}
// The section was first called 试剂等关键资源; pages written then read as 试剂 too.
export const renameMaterialsHeading = (body) => String(body || '').replace(/^##[ \t]+试剂等关键资源[ \t]*$/m, '## 试剂');
// Rewrite the block in place, or add it under its own heading at the very end of the page.
export function writeMaterials(body, list) {
  const block = `\`\`\`materials\n${materialsText(list)}\n\`\`\``;
  if (MATERIALS_RE.test(body)) return renameMaterialsHeading(body.replace(MATERIALS_RE, block));
  return `${String(body || '').trimEnd()}\n\n## 试剂\n\n${block}\n`;
}

// ---------- method cards (methods/M-0001.json): the small exact details a paper's Experimental section needs ----------
// card = { id, vol, title, cat, status, tags, body (Markdown), params: [{ k, v }], versions: [{ v, at, since, note, params }], created, updated }
export const METHOD_CAT = ['材料制备', '器件制备', '动物实验', '细胞实验', '图像分析', '表征测试', '统计分析', '软件与参数', '其他'];
export const METHOD_STATUS = ['待写入', '已写入', '不写入'];
export const methodPath = (id) => `methods/${id}.json`;
export const methodIds = (lib) => [...lib.tree.keys()].map((p) => (p.match(/^methods\/(M-\d{4})\.json$/) || [])[1]).filter(Boolean).sort();
export async function loadMethod(lib, id) { return cached(lib, methodPath(id), (t) => JSON.parse(t)); }
export async function loadMethods(lib) { return (await Promise.all(methodIds(lib).map((id) => loadMethod(lib, id).catch(() => null)))).filter(Boolean); }
export function nextMethodId(ids) {
  const max = Math.max(0, ...ids.map((x) => parseInt(String(x).replace(/\D/g, ''), 10) || 0));
  return `M-${String(max + 1).padStart(4, '0')}`;
}
const paramKey = (ps) => JSON.stringify((ps || []).filter((p) => p.k || p.v).map((p) => [p.k, p.v]));
export const paramsChanged = (a, b) => paramKey(a) !== paramKey(b);
// "对比度: 1.1 → 1.2；阈值：新增 Otsu"
export function paramDiff(before, after) {
  const A = new Map((before || []).map((p) => [p.k, p.v])); const B = new Map((after || []).map((p) => [p.k, p.v]));
  const out = [];
  for (const [k, v] of B) { if (!A.has(k)) out.push(`${k}：新增 ${v}`); else if (A.get(k) !== v) out.push(`${k}：${A.get(k)} → ${v}`); }
  for (const k of A.keys()) if (!B.has(k)) out.push(`${k}：删除`);
  return out.join('；');
}
