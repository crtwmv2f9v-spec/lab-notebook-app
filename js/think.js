// Thinking notebook: hypotheses, evidence chains, citing them from experiments.
import { fmtDate, nowISO, parseFrontMatter, parseRef, todayISO } from './model.js';
import { hypBadge, renderInto } from './render.js';
import {
  EV_KIND, HYP_CONF, HYP_STATUS, evidenceCounts, hypIds, hypPath, loadHypotheses, loadHypothesis,
  nextEvidenceId, nextHypId, sectionOf,
} from './lab.js';
import { search } from './search.js';
import { h, icon } from './util.js';
import { choose, demoBanner, lib, modal, prepareFile, saveError, toast, topbar, view, viewMissing } from './core.js';
import { cover, hero } from './home.js';
import { updatePage } from './pages.js';
import { openPagePicker } from './searchui.js';
import { route } from './app.js';

// ===================== thinking notebook: hypotheses and evidence chains =====================
export const hypBlock = (id, note) => `\`\`\`hypothesis\n${id}\n${note || ''}`.trimEnd() + '\n```';
export async function saveHyp(hyp, message, files = []) {
  hyp.updated = nowISO();
  return lib.commit(message, async () => ({ changes: [{ path: hypPath(hyp.id), data: `${JSON.stringify(hyp, null, 1)}\n` }, ...files] }));
}
export const cloneHyp = async (id) => structuredClone(await loadHypothesis(lib, id));
export const relatedPages = (id) => search(lib.allPages(), id).map((r) => r.page)
  .sort((a, b) => String(a.date).localeCompare(String(b.date)));

export function thinkCover() {
  const n = hypIds(lib).length;
  return h('div', { class: 'book' },
    h('a', { class: 'cover think-cover', href: '#/think', 'aria-label': '思维笔记本' },
      h('span', { class: 'think-label' }, h('span', { class: 'tl-kind' }, 'HYPOTHESES & EVIDENCE'), h('span', { class: 'tl-title' }, '思维笔记本'), h('span', { class: 'tl-sub' }, '假设 · 证据链')),
      h('span', { class: 'cover-band' })),
    h('a', { class: 'book-cap', href: '#/think' }, h('span', { class: 'bc-title' }, '思维笔记本'), h('span', { class: 'bc-meta' }, n ? `${n} 条假设` : '记录假设与证据链')));
}

export async function viewThinking() {
  const hyps = await loadHypotheses(lib);
  let filter = '全部';
  const grid = h('div', { class: 'hyp-grid' });
  const chips = h('div', { class: 'hyp-filter' });
  const draw = () => {
    chips.replaceChildren(...['全部', ...HYP_STATUS].map((s) => h('button', { type: 'button', class: `chip-btn${filter === s ? ' on' : ''}`, onclick: () => { filter = s; draw(); } },
      s, h('span', null, s === '全部' ? hyps.length : hyps.filter((x) => x.status === s).length))));
    const list = hyps.filter((x) => filter === '全部' || x.status === filter).sort((a, b) => String(b.updated || b.created).localeCompare(String(a.updated || a.created)));
    grid.replaceChildren(...(list.length ? list.map((x) => {
      const n = evidenceCounts(x);
      const tot = (x.evidence || []).length || 1;
      return h('a', { class: 'tile hyp-card', href: `#/think/${x.id}` },
        h('div', { class: 'hc-top' }, h('span', { class: 'hc-id' }, x.id), hypBadge(x)),
        h('h3', null, x.title),
        x.description ? h('p', { class: 'hc-desc' }, x.description.replace(/[#*>`]/g, '').slice(0, 90)) : null,
        h('div', { class: 'ev-bar', title: `支持 ${n['支持']} · 反对 ${n['反对']} · 待定 ${n['待定']}` },
          EV_KIND.map((k) => h('span', { class: `k-${k}`, style: { width: `${(n[k] / tot) * 100}%` } }))),
        h('div', { class: 'hc-foot' }, `支持 ${n['支持']} · 反对 ${n['反对']} · 待定 ${n['待定']}`, h('span', null, `${relatedPages(x.id).length} 个实验 · ${fmtDate(x.updated || x.created)}`)));
    }) : [h('div', { class: 'tile empty-tile' }, h('p', null, filter === '全部' ? '还没有假设。点右上角“新建假设”，例如：氯仿挥发引起气爆。' : `没有“${filter}”状态的假设。`))]));
  };
  draw();
  return h('div', { class: 'view think' },
    topbar({ back: '#/', backLabel: '首页', title: '思维笔记本', sub: '假设 · 证据链', actions: [
      h('button', { class: 'btn primary', type: 'button', onclick: () => editHypothesis(null) }, icon('plus', 18), h('span', null, '新建假设'))] }),
    demoBanner(),
    h('div', { class: 'think-wrap' },
      h('header', { class: 'hero think-hero' }, h('p', { class: 'hero-eyebrow' }, 'HYPOTHESES & EVIDENCE'), h('h1', { class: 'hero-title' }, '思维笔记本'),
        h('p', { class: 'think-lead' }, '每条假设一张卡：写下假设和“如果成立应看到什么”，再把每一次实验、观察、照片、文献作为证据挂上去，标明支持还是反对。实验页的“目的”可以引用假设，“结论”可以一键作为证据回到这里。')),
      thinkTabs('hyp'), chips, grid));
}
export const thinkTabs = (on) => h('nav', { class: 'think-tabs' },
  h('a', { href: '#/think', class: on === 'hyp' ? 'on' : null }, '假设与证据链'),
  h('a', { href: '#/projects' }, '课题看板 ›'));

export function editHypothesis(hyp) {
  const isNew = !hyp;
  const title = h('input', { id: 'hy-title', value: hyp?.title || '', placeholder: '例如：气爆由氯仿挥发、瓶内压力升高引起' });
  const desc = h('textarea', { id: 'hy-desc', rows: 4, placeholder: '背景、现象、为什么这么想…（支持 Markdown）' }, hyp?.description || '');
  const preds = h('textarea', { id: 'hy-pred', rows: 3, placeholder: '一行一条，例如：\n换成低挥发溶剂后不再气爆\n加热时瓶内压力明显升高' }, (hyp?.predictions || []).join('\n'));
  const status = h('select', { id: 'hy-status' }, HYP_STATUS.map((x) => h('option', { selected: (hyp?.status || '提出') === x }, x)));
  const conf = h('select', { id: 'hy-conf' }, HYP_CONF.map((x) => h('option', { selected: (hyp?.confidence || '低') === x }, x)));
  modal({
    title: isNew ? '新建假设' : `编辑 ${hyp.id}`, wide: true,
    body: h('div', { class: 'form' },
      h('label', { for: 'hy-title' }, '假设（一句话）'), title,
      h('label', { for: 'hy-desc' }, '描述'), desc,
      h('label', { for: 'hy-pred' }, '预测：如果成立，应该看到（一行一条）'), preds,
      isNew ? h('div', { class: 'pair' }, h('div', null, h('label', { for: 'hy-status' }, '状态'), status), h('div', null, h('label', { for: 'hy-conf' }, '可信度'), conf)) : null),
    buttons: [{ label: '取消' }, {
      label: '保存', primary: true,
      run: async () => {
        if (!title.value.trim()) { toast('写一句假设。'); return false; }
        const x = isNew ? { id: nextHypId(hypIds(lib)), status: status.value, confidence: conf.value, evidence: [], history: [{ at: nowISO(), status: status.value, confidence: conf.value, why: '提出' }], created: nowISO() } : await cloneHyp(hyp.id);
        x.title = title.value.trim(); x.description = desc.value.trim();
        x.predictions = preds.value.split('\n').map((l) => l.trim()).filter(Boolean);
        try { await saveHyp(x, `${isNew ? 'Add' : 'Edit'} hypothesis ${x.id}`); toast(`${x.id} 已保存。`); location.hash = `#/think/${x.id}`; if (!isNew) route({ quiet: true }); } catch (e) { toast(saveError(e)); return false; }
      },
    }],
  });
}

// Status and confidence change only with a reason, so the history shows how the thinking moved.
// 可信度 低 / 中 / 高: one click, no reason needed; the change still goes into 思路变化.
export function confSwitch(hyp) {
  return h('div', { class: 'seg conf-seg', role: 'radiogroup', 'aria-label': '可信度' }, h('span', { class: 'seg-lbl' }, '可信度'),
    HYP_CONF.map((c) => h('button', { type: 'button', role: 'radio', 'aria-checked': String(hyp.confidence === c), class: `seg-btn${hyp.confidence === c ? ' on' : ''}`,
      onclick: async () => {
        if (hyp.confidence === c) return;
        const x = await cloneHyp(hyp.id);
        x.confidence = c;
        x.history = [...(x.history || []), { at: nowISO(), status: x.status, confidence: c, why: '' }];
        try { await saveHyp(x, `${x.id}: confidence ${c}`); toast(`可信度：${c}`); route({ quiet: true }); } catch (e) { toast(saveError(e)); }
      } }, c)));
}
export function changeHypState(hyp) {
  const status = h('select', { id: 'hs-status' }, HYP_STATUS.map((x) => h('option', { selected: hyp.status === x }, x)));
  const why = h('input', { id: 'hs-why', placeholder: '例如：证据 3（20261105-OECT-01）显示换溶剂后不再气爆' });
  modal({
    title: `调整 ${hyp.id} 的状态`,
    body: h('div', { class: 'form' },
      h('label', { for: 'hs-status' }, '状态'), status,
      h('label', { for: 'hs-why' }, '依据（可不填）'), why),
    buttons: [{ label: '取消' }, {
      label: '保存', primary: true,
      run: async () => {
        const x = await cloneHyp(hyp.id);
        x.status = status.value;
        x.history = [...(x.history || []), { at: nowISO(), status: x.status, confidence: x.confidence, why: why.value.trim() }];
        try { await saveHyp(x, `${x.id}: ${x.status} / ${x.confidence}`); route({ quiet: true }); } catch (e) { toast(saveError(e)); return false; }
      },
    }],
  });
}

// Add or edit one piece of evidence: kind, date, what was seen, where it came from, photos.
export function editEvidence(hyp, ev, preset = {}) {
  const isNew = !ev;
  const e = ev ? { ...ev } : { kind: preset.kind || '支持', date: preset.date || todayISO(), text: preset.text || '', src: preset.src || null, photos: [] };
  const kind = h('div', { class: 'seg', role: 'radiogroup' });
  const drawKind = () => kind.replaceChildren(...EV_KIND.map((k) => h('button', { type: 'button', role: 'radio', 'aria-checked': String(e.kind === k), class: `seg-btn k-${k}${e.kind === k ? ' on' : ''}`, onclick: () => { e.kind = k; drawKind(); } }, k)));
  drawKind();
  const date = h('input', { id: 'ev-date', type: 'date', value: e.date || '' });
  const text = h('textarea', { id: 'ev-text', rows: 3, placeholder: '看到了什么、量到了什么，例如：打开瓶盖时有明显泄压声，瓶壁温度 38 °C' }, e.text || '');
  const srcOut = h('span', { class: 'ev-src-out' });
  const url = h('input', { id: 'ev-url', placeholder: '或文献 DOI / 链接', value: e.src?.url || '' });
  const drawSrc = () => srcOut.replaceChildren(e.src?.xid || e.src?.num ? h('span', { class: 'xid-tag' }, e.src.xid || `p. ${e.src.num}`) : h('span', { class: 'muted' }, '未关联实验'),
    e.src?.vol ? h('button', { class: 'btn small ghost', type: 'button', onclick: () => { e.src = null; drawSrc(); } }, '清除') : null);
  drawSrc();
  const pick = h('button', { class: 'btn small', type: 'button', onclick: () => openPagePicker('', (ref) => { const r = parseRef(ref, ''); const p = r && lib.page(r.vol, r.num); if (p) { e.src = { xid: p.xid || '', vol: p.vol, num: p.num }; if (!date.value || isNew) date.value = p.date || date.value; drawSrc(); } }) }, '选择实验…');
  const files = h('input', { type: 'file', accept: 'image/*', multiple: true, id: 'ev-photos' });
  modal({
    title: isNew ? `为 ${hyp.id} 添加证据` : `编辑 ${hyp.id} · 证据 ${ev.id.slice(1)}`, wide: true,
    body: h('div', { class: 'form' },
      h('span', { class: 'label' }, '这条证据'), kind,
      h('label', { for: 'ev-date' }, '日期'), date,
      h('label', { for: 'ev-text' }, '内容'), text,
      h('span', { class: 'label' }, '来源'), h('div', { class: 'row-actions' }, srcOut, pick), url,
      h('label', { for: 'ev-photos' }, `照片（可多张）${(e.photos || []).length ? `，已有 ${e.photos.length} 张` : ''}`), files),
    buttons: [{ label: '取消' }, {
      label: '保存', primary: true,
      run: async () => {
        if (!text.value.trim()) { toast('写一下证据内容。'); return false; }
        const x = await cloneHyp(hyp.id);
        const id = ev ? ev.id : nextEvidenceId(x);
        const adds = [];
        let k = (e.photos || []).length;
        for (const f0 of files.files) {
          const f = await prepareFile(f0);
          const ext = (f.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
          const path = `thinking/attachments/${x.id}/${id}-${++k}.${ext}`;
          adds.push({ path, data: f }); e.photos = [...(e.photos || []), path];
        }
        const item = { id, kind: e.kind, date: date.value, text: text.value.trim(), photos: e.photos || [], ...(e.src?.vol ? { src: e.src } : url.value.trim() ? { src: { url: url.value.trim() } } : {}) };
        x.evidence = ev ? x.evidence.map((y) => (y.id === id ? item : y)) : [...(x.evidence || []), item];
        try { await saveHyp(x, `${x.id}: evidence ${id}`, adds); toast(`证据 ${id.slice(1)} 已保存。`); route({ quiet: true }); } catch (err) { toast(saveError(err)); return false; }
      },
    }],
  });
}

export async function viewHypothesis(id) {
  const hyp = await loadHypothesis(lib, id).catch(() => null);
  if (!hyp) return viewMissing(`思维笔记本里没有 ${id}。`);
  const n = evidenceCounts(hyp);
  const urls = view.urls;
  const photo = (path) => {
    const img = h('img', { class: 'ev-photo', alt: path.split('/').pop() });
    lib.readBlob(path).then((b) => { const u = URL.createObjectURL(b); urls.push(u); img.src = u; img.onclick = () => window.open(u, '_blank'); }).catch(() => img.remove());
    return img;
  };
  const desc = h('div', { class: 'prose hyp-desc' });
  if (hyp.description) renderInto(desc, hyp.description, { lib, vol: null, num: null, urls, resolveBlob: (name) => lib.readBlob(name.replace(/^\//, '')) });
  const rel = relatedPages(id);
  const evidence = hyp.evidence || [];
  const upd = async (f, msg) => { const x = await cloneHyp(id); f(x); try { await saveHyp(x, msg); route({ quiet: true }); } catch (e) { toast(saveError(e)); } };
  return h('div', { class: 'view think' },
    topbar({ back: '#/think', backLabel: '思维笔记本', title: hyp.id, sub: '思维笔记本', actions: [
      h('button', { class: 'btn', type: 'button', onclick: () => editHypothesis(hyp) }, icon('edit', 18), h('span', { class: 'wide-only' }, '编辑')),
      h('button', { class: 'btn primary', type: 'button', onclick: () => editEvidence(hyp, null) }, icon('plus', 18), h('span', null, '添加证据'))] }),
    demoBanner(),
    h('div', { class: 'think-wrap' },
      h('header', { class: 'hyp-hero' },
        h('p', { class: 'hero-eyebrow' }, `${hyp.id} · 提出于 ${fmtDate(hyp.created)}`),
        h('h1', { class: 'hero-title' }, hyp.title),
        h('div', { class: 'hyp-state' }, hypBadge(hyp), confSwitch(hyp), h('button', { class: 'btn small', type: 'button', onclick: () => changeHypState(hyp) }, '调整状态'))),
      h('div', { class: 'hyp-cols' },
        h('div', null,
          hyp.description ? h('section', { class: 'tile' }, h('h2', null, '描述'), desc) : null,
          h('section', { class: 'tile' }, h('h2', null, '预测', h('span', { class: 'h-sub' }, '如果成立，应该看到')),
            (hyp.predictions || []).length ? h('ol', { class: 'pred-list' }, hyp.predictions.map((p) => h('li', null, p))) : h('p', { class: 'muted' }, '还没写预测。点“编辑”添加，例如：换成低挥发溶剂后不再气爆。')),
          h('section', { class: 'tile' },
            h('div', { class: 'tile-head' }, h('div', null, h('h2', null, '证据链'), h('p', { class: 'card-sub' }, `支持 ${n['支持']} · 反对 ${n['反对']} · 待定 ${n['待定']}`)),
              h('button', { class: 'btn small add-btn', type: 'button', onclick: () => editEvidence(hyp, null) }, '添加证据')),
            evidence.length ? h('ol', { class: 'ev-chain' }, evidence.map((e) => h('li', { class: `k-${e.kind}` },
              h('div', { class: 'ev-line' }, h('b', null, `证据 ${e.id.slice(1)}`), h('span', { class: `ev-kind k-${e.kind}` }, e.kind), h('span', { class: 'ev-date' }, e.date || ''),
                h('span', { class: 'ev-tools' },
                  h('button', { class: 'btn small ghost', type: 'button', onclick: () => editEvidence(hyp, e) }, '编辑'),
                  h('button', { class: 'btn small ghost', type: 'button', onclick: async () => { if ((await choose(`删除证据 ${e.id.slice(1)}？`, 'GitHub 历史里仍可找回。', [['yes', '删除'], ['no', '取消']])) === 'yes') upd((x) => { x.evidence = x.evidence.filter((y) => y.id !== e.id); }, `${id}: remove evidence ${e.id}`); } }, '删除'))),
              h('p', { class: 'ev-text' }, e.text),
              e.src?.vol ? h('a', { class: 'ev-from', href: `#/v/${e.src.vol}/${e.src.num}` }, `来自实验 ${e.src.xid || `p. ${e.src.num}`}${lib.page(e.src.vol, e.src.num) ? ` · ${lib.page(e.src.vol, e.src.num).title}` : ''}`) : null,
              e.src?.url ? h('a', { class: 'ev-from', href: /^10\./.test(e.src.url) ? `https://doi.org/${e.src.url}` : e.src.url, target: '_blank', rel: 'noopener' }, `文献 ${e.src.url}`) : null,
              (e.photos || []).length ? h('div', { class: 'ev-photos' }, e.photos.map(photo)) : null))) : h('p', { class: 'muted' }, '还没有证据。可以在这里添加，也可以在实验页“结论”旁点“作为证据加入假设”。'))),
        h('div', null,
          h('section', { class: 'tile' }, h('h2', null, '相关实验'),
            rel.length ? h('ul', { class: 'rel-list' }, rel.map((p) => {
              const used = evidence.find((e) => e.src?.vol === p.vol && e.src?.num === p.num);
              return h('li', null, h('a', { href: `#/v/${p.vol}/${p.num}` }, h('span', { class: 'ev-date' }, fmtDate(p.date)), ' ', p.xid ? h('span', { class: 'xid-tag' }, p.xid) : null, ' ', p.title),
                used ? h('span', { class: `ev-kind k-${used.kind}` }, `证据 ${used.id.slice(1)}`) : null);
            })) : h('p', { class: 'muted' }, '还没有实验引用这条假设。在实验页 ⋯ → 引用假设。')),
          h('section', { class: 'tile' }, h('h2', null, '思路变化'),
            h('ol', { class: 'hist-list' }, [...(hyp.history || [])].reverse().map((x) => h('li', null,
              h('span', { class: 'ev-date' }, `${fmtDate(x.at)} ${String(x.at).slice(11, 16)}`), h('span', { class: `hyp-status st-${x.status}` }, x.status), h('span', { class: 'muted' }, ` 可信度 ${x.confidence}`), x.why ? h('div', null, x.why) : null))))))));
}


// Experiment page: put a hypothesis box at the top of 目的 and record the link in front matter.
export async function openCiteHypothesis(vol, num, onInsert) {
  const hyps = await loadHypotheses(lib);
  if (!hyps.length) { if ((await choose('思维笔记本里还没有假设', '先去新建一条？', [['go', '去新建'], ['no', '取消']])) === 'go') { location.hash = '#/think'; setTimeout(() => editHypothesis(null), 400); } return; }
  const sel = h('select', { id: 'ch-hyp' }, hyps.map((x) => h('option', { value: x.id }, `${x.id} · ${x.title}（${x.status}）`)));
  const note = h('input', { id: 'ch-note', placeholder: '本次检验哪条预测，例如：本次检验：换成甲苯后是否仍气爆' });
  const own = num && !onInsert ? parseFrontMatter(await lib.readPage(vol, num)) : null;
  modal({
    title: '引用假设',
    body: h('div', { class: 'form' },
      h('label', { for: 'ch-hyp' }, '本实验要检验的假设'), sel,
      h('label', { for: 'ch-note' }, '说明（可不填）'), note,
      h('p', { class: 'muted' }, '会在“目的”一节顶部放一个假设框，显示假设、状态、可信度和目前的证据；假设页的“相关实验”也会列出本实验。')),
    buttons: [{ label: '取消' }, {
      label: '引用', primary: true,
      run: async () => {
        const block = hypBlock(sel.value, note.value.trim());
        if (onInsert) { onInsert(block); return; }
        try {
          await updatePage(vol, num, ({ fm: f, body: b }) => {
            f.hypotheses = [...new Set([...(f.hypotheses || []), sel.value])];
            const m = b.match(/^##\s+目的\s*$/m);
            b = m ? `${b.slice(0, m.index + m[0].length)}\n\n${block}\n${b.slice(m.index + m[0].length)}` : `## 目的\n\n${block}\n\n${b}`;
            return { fm: f, body: b.replace(/\n{3,}/g, '\n\n') };
          }, `Cite ${sel.value}`, `引用假设 ${sel.value}`);
          toast('已引用。');
        } catch (e) { toast(saveError(e)); return false; }
      },
    }],
  });
}

// Experiment page: "作为证据加入假设" beside 结论 — the conclusion becomes evidence on the hypothesis.
export async function conclusionEvidenceButton(sheet, vol, num, fm) {
  const head = [...sheet.querySelectorAll('.sheet-body.prose > h2')].find((x) => x.textContent.trim() === '结论');
  if (!head || !hypIds(lib).length) return;
  const hyps = await loadHypotheses(lib);
  const done = hyps.flatMap((x) => (x.evidence || []).filter((e) => e.src?.vol === vol && e.src?.num === num).map((e) => `${x.id} 证据 ${e.id.slice(1)}（${e.kind}）`));
  const { body } = parseFrontMatter(await lib.readPage(vol, num));
  const concl = (sectionOf(body, '结论') || '').replace(/[#*>`=+{}]/g, '').trim();
  const cited = [...new Set([...(fm.hypotheses || []), ...(body.match(/H-\d{4}/g) || [])])];
  const btn = h('button', { class: 'ns-btn no-print', type: 'button', onclick: () => {
    const sel = h('select', { id: 'ce-hyp' }, hyps.map((x) => h('option', { value: x.id, selected: cited[0] === x.id }, `${x.id} · ${x.title}`)));
    modal({
      title: '把本实验的结论作为证据',
      body: h('div', { class: 'form' }, h('label', { for: 'ce-hyp' }, '加到哪条假设'), sel,
        h('p', { class: 'muted' }, '下一步选择“支持 / 反对 / 待定”，内容默认是本页的结论，可以修改。')),
      buttons: [{ label: '取消' }, { label: '下一步', primary: true, run: () => {
        const hyp = hyps.find((x) => x.id === sel.value);
        setTimeout(() => editEvidence(hyp, null, { date: fm.date, text: concl.slice(0, 300), src: { xid: fm.id || '', vol, num } }), 50);
      } }],
    });
  } }, icon('book', 14), '作为证据加入假设');
  head.append(' ', btn, ...(done.length ? [h('span', { class: 'ns-added no-print' }, `✓ 已是 ${done.join('、')}`)] : []));
}
