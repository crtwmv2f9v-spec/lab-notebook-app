// Notebook data model: file paths, page references, front matter, search text.

export const pad = (n) => String(n).padStart(4, '0');
export const pagePath = (vol, num) => `volumes/${vol}/pages/${pad(num)}.md`;
export const attDir = (vol, num) => `volumes/${vol}/attachments/${pad(num)}/`;
export const attPath = (vol, num, name) => attDir(vol, num) + name;
export const volIndexPath = (vol) => `volumes/${vol}/index.json`;
export const PAGE_RE = /^volumes\/([^/]+)\/pages\/(\d+)\.md$/;
export const VOL_INDEX_RE = /^volumes\/([^/]+)\/index\.json$/;

// "42", "p. 42", "cytology/42" -> {vol, num}
export function parseRef(ref, curVol) {
  if (ref == null) return null;
  const m = String(ref).trim().match(/^(?:([a-z0-9][a-z0-9-]*)\/)?(?:p\.?\s*)?(\d{1,5})$/i);
  if (!m) return null;
  const vol = m[1] ? m[1].toLowerCase() : curVol;
  if (!vol) return null;
  return { vol, num: parseInt(m[2], 10) };
}
export const refKey = (r) => (r ? `${r.vol}/${r.num}` : null);

const LINK_RE = /\[\[([^\]|\n]+)(?:\|[^\]\n]*)?\]\]/g;
export function extractLinks(body, vol) {
  const out = new Set();
  for (const m of String(body).matchAll(LINK_RE)) {
    if (m.index > 0 && body[m.index - 1] === '!') continue; // embeds are not page links
    const r = parseRef(m[1], vol);
    if (r) out.add(refKey(r));
  }
  return [...out];
}

// ---------- front matter ----------
function scalar(v) {
  v = v.trim();
  if (v.startsWith('"')) { try { return JSON.parse(v); } catch { /* fall through */ } }
  if (v.length > 1 && v.startsWith("'") && v.endsWith("'")) return v.slice(1, -1).replace(/''/g, "'");
  return v;
}
function list(v) {
  const inner = v.trim().replace(/^\[/, '').replace(/\]$/, '');
  const out = [];
  const re = /\s*("(?:[^"\\]|\\.)*"|'[^']*'|[^,]+)\s*(?:,|$)/g;
  let m;
  while ((m = re.exec(inner)) && m[0] !== '') {
    const s = scalar(m[1]);
    if (s !== '') out.push(s);
    if (re.lastIndex >= inner.length) break;
  }
  return out;
}

export function parseFrontMatter(md) {
  md = String(md ?? '').replace(/^﻿/, '');
  const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
  if (!m) return { fm: {}, body: md };
  const fm = {};
  let lastKey = null;
  for (const line of m[1].split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const item = line.match(/^\s*-\s+(.*)$/);
    if (item && lastKey) {
      if (!Array.isArray(fm[lastKey])) fm[lastKey] = [];
      fm[lastKey].push(scalar(item[1]));
      continue;
    }
    const kv = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
    if (!kv) continue;
    lastKey = kv[1];
    const v = kv[2].trim();
    fm[lastKey] = v === '' ? '' : v.startsWith('[') ? list(v) : scalar(v);
  }
  if (fm.tags && !Array.isArray(fm.tags)) fm.tags = String(fm.tags).split(',').map((t) => t.trim()).filter(Boolean);
  if (fm.amended && !Array.isArray(fm.amended)) fm.amended = [fm.amended];
  for (const k of ['reagents', 'followups', 'hypotheses']) if (fm[k] && !Array.isArray(fm[k])) fm[k] = [fm[k]];
  return { fm, body: md.slice(m[0].length) };
}

function q(s) {
  s = String(s);
  const plain = /^[A-Za-z0-9][\w .\-/+()]*$/.test(s) && s.trim() === s && !/^(true|false|null|yes|no|on|off)$/i.test(s);
  return plain ? s : JSON.stringify(s);
}
const KEY_ORDER = ['title', 'date', 'id', 'series', 'hypotheses', 'void', 'outcome', 'outcome_note', 'tags', 'protocol', 'reagents', 'data', 'followups', 'continues', 'signed', 'signer', 'amended'];
export function serializePage(fm, body) {
  const keys = [...KEY_ORDER.filter((k) => k in fm), ...Object.keys(fm).filter((k) => !KEY_ORDER.includes(k))];
  const lines = [];
  for (const k of keys) {
    const v = fm[k];
    if (v == null || v === '' || (Array.isArray(v) && !v.length)) continue;
    lines.push(Array.isArray(v) ? `${k}: [${v.map(q).join(', ')}]` : `${k}: ${q(v)}`);
  }
  const text = String(body ?? '').replace(/^\s*\n/, '').replace(/\s+$/, '');
  return `---\n${lines.join('\n')}\n---\n\n${text}\n`;
}

// ---------- text helpers ----------
export function plainText(md) {
  return String(md)
    .replace(/```chart[^\n]*\n[\s\S]*?```/g, ' ')
    .replace(/```samples[^\n]*\n/g, ' ').replace(/,/g, ' ')
    .replace(/```[^\n]*\n/g, ' ')
    .replace(/!\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g, (_, a, b) => b || a)
    .replace(/\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g, (_, a, b) => b || `p. ${a}`)
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[#*_>`~|$\\]+/g, ' ')
    .replace(/^\s*[-+]\s+(\[[ xX]\]\s*)?/gm, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function slugify(s) {
  return String(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'volume';
}
export function cleanTag(t) {
  return String(t).trim().replace(/^#/, '').toLowerCase().replace(/\s+/g, '-').replace(/[^\p{L}\p{N}_\-.]/gu, '');
}
export function safeFileName(name) {
  const base = String(name).split(/[\\/]/).pop().normalize('NFKD').replace(/[̀-ͯ]/g, '');
  const cleaned = base.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^[-.]+/, '');
  return cleaned || 'file';
}

export function makeEntry(vol, num, md, sha) {
  const { fm, body } = parseFrontMatter(md);
  const xid = String(fm.id || '').trim();
  const samples = xid ? [...new Set((body.match(/^\s*#\d{1,3}[a-z]?(?=\s*,)/gm) || []).map((s) => `${xid}-${s.trim()}`))] : [];
  const text = [fm.void ? `作废 ${fm.void}` : '', xid, fm.series, fm.protocol, ...(fm.reagents || []), ...samples, plainText(body)].filter(Boolean).join(' ');
  const cont = parseRef(fm.continues, vol);
  return {
    vol, num,
    title: String(fm.title || '').trim() || 'Untitled',
    date: String(fm.date || '').slice(0, 10),
    tags: (fm.tags || []).map(cleanTag).filter(Boolean),
    signed: fm.signed || null,
    signer: fm.signer || null,
    amended: fm.amended || [],
    continues: cont ? refKey(cont) : null,
    links: extractLinks(body, vol),
    xid: xid || null,
    void: fm.void || null,
    outcome: ['ok', 'fail'].includes(fm.outcome) ? fm.outcome : null,
    series: String(fm.series || '').trim() || null,
    protocol: fm.protocol || null,
    reagents: fm.reagents || [],
    followups: fm.followups || [],
    samples,
    sha,
    text: text.slice(0, 8000),
  };
}

// ---------- dates ----------
const two = (n) => String(n).padStart(2, '0');
// The notebook keeps one clock wherever it is opened: UTC+8 (北京时间). "Today", the current week and every new
// timestamp follow it, so a page written in another time zone still lands on the right day.
export const ZONE = '+08:00';
const wall = (d) => new Date(d.getTime() + (480 + d.getTimezoneOffset()) * 60000); // local getters then read the UTC+8 wall clock
const ymd = (d) => `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
// No argument: today in UTC+8. With a Date built from a calendar day (as addDays does): that calendar day.
export function todayISO(d) { return ymd(d || wall(new Date())); }
export function nowISO(d = new Date()) {
  const w = wall(d);
  return `${ymd(w)}T${two(w.getHours())}:${two(w.getMinutes())}:${two(w.getSeconds())}${ZONE}`;
}
// A stored timestamp (any offset) as the UTC+8 day and 24-hour time.
export function zoned(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return { day: String(iso).slice(0, 10), time: String(iso).slice(11, 16) };
  const w = wall(d);
  return { day: ymd(w), time: `${two(w.getHours())}:${two(w.getMinutes())}`, hour: w.getHours() };
}
export function fmtDate(iso) {
  if (!iso) return '';
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return String(iso);
  return `${m[1]}-${m[2]}-${m[3]}`;
}
export function fmtTime(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return zoned(iso).time;
}
