// Full-text search over the page index.
import { esc } from './util.js';

// Dates work as words: "2026-11", "2026-11-01" or "20261101" match the page date
// and experiment number; from/to (YYYY-MM-DD) limit the date range.
export function search(pages, query, { vol = '', tag = '', from = '', to = '' } = {}) {
  const raw = String(query || '').toLowerCase().trim();
  const words = raw.split(/\s+/).filter(Boolean);
  const tagTerms = words.filter((w) => w.startsWith('#') && !/^#\d/.test(w)).map((w) => w.slice(1));
  // "#09" is a sample number, not a tag
  const terms = words.filter((w) => !w.startsWith('#') || /^#\d/.test(w));
  if (tag) tagTerms.push(tag);
  const results = [];
  const showVoid = /作废|void/.test(raw);
  for (const p of pages) {
    if (p.void && !showVoid) continue;
    if (vol && p.vol !== vol) continue;
    if (from && !(p.date >= from)) continue;
    if (to && !(p.date <= to)) continue;
    if (tagTerms.some((t) => !(p.tags || []).includes(t))) continue;
    const title = (p.title || '').toLowerCase();
    const text = (p.text || '').toLowerCase();
    const tags = (p.tags || []).join(' ');
    let score = 0; let ok = true;
    for (const t of terms) {
      let s = 0;
      if (title.includes(t)) s += 10;
      if (tags.includes(t)) s += 6;
      let i = -1; let n = 0;
      while (n < 5 && (i = text.indexOf(t, i + 1)) !== -1) n++;
      s += n;
      if (String(p.num) === t) s += 8;
      const dt = t.replace(/^(\d{4})(\d{2})(\d{2})?$/, (_, y, m, d) => (d ? `${y}-${m}-${d}` : `${y}-${m}`));
      if (/^\d{4}-\d{2}(-\d{2})?$/.test(dt) && String(p.date).startsWith(dt)) s += 12;
      if (p.xid && p.xid.toLowerCase().includes(t)) s += 12;
      if (!s) { ok = false; break; }
      score += s;
    }
    if (!ok) continue;
    results.push({ page: p, score, snippet: snippet(p.text || '', terms) });
  }
  if (!terms.length && !tagTerms.length) for (const r of results) r.score = 0;
  results.sort((a, b) => b.score - a.score || String(b.page.date).localeCompare(String(a.page.date)) || b.page.num - a.page.num);
  return results;
}

function snippet(text, terms) {
  if (!text) return '';
  const lower = text.toLowerCase();
  let at = -1;
  for (const t of terms) { const i = lower.indexOf(t); if (i !== -1 && (at === -1 || i < at)) at = i; }
  const start = Math.max(0, at === -1 ? 0 : at - 70);
  let s = text.slice(start, start + 200);
  if (start > 0) s = `…${s.replace(/^\S*\s/, '')}`;
  if (start + 200 < text.length) s += '…';
  let html = esc(s);
  for (const t of terms) {
    if (t.length < 2) continue;
    const re = new RegExp(`(${esc(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    html = html.replace(re, '<mark>$1</mark>');
  }
  return html;
}
