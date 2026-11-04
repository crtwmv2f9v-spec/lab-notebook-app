// Thinking notebook: hypotheses, evidence chains, citing them from experiments.
import { fmtDate, nowISO, parseFrontMatter, parseRef, todayISO } from './model.js';
import { hypBadge, renderInto } from './render.js';
import {
  EV_KIND, HYP_CONF, HYP_STATUS, evidenceCounts, hypIds, hypObservations, rationaleItems, predictionState, hypPath, loadHypotheses, loadHypothesis,
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
export const hypBlock = (id, note, codes = []) => `\`\`\`hypothesis\n${[id, ...codes].join(' ')}\n${note || ''}`.trimEnd() + '\n```';
const lines = (t) => String(t || '').split('\n').map((l) => l.replace(/^\s*(?:[OP]?\d+[.、)）:：]|[-*•])\s*/i, '').trim()).filter(Boolean);
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
        h('p', { class: 'hc-desc' }, `${hypObservations(x).length} 条观察 · ${(x.evidence || []).length} 条证据 · ${(x.predictions || []).length} 条预测${(x.predictions || []).length ? `（已检验 ${(x.predictions || []).filter((_, i) => predictionState(x, i).kind).length}）` : ''}`),
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
        h('p', { class: 'think-lead' }, '每条假设一张卡，按一条逻辑链写：观察现象（O1…）→ 假设 → 推理 → 验证证据（E1…）→ 可检验预测（P1…）。实验页可以引用整条假设，或在步骤里写 [[H-0001#P1]] 引用其中一条；结论可一键作为证据回到这里。')),
      thinkTabs('hyp'), chips, grid));
}
export const thinkTabs = (on) => h('nav', { class: 'think-tabs' },
  h('a', { href: '#/think', class: on === 'hyp' ? 'on' : null }, '假设与证据链'),
  h('a', { href: '#/projects' }, '课题看板 ›'));

export function editHypothesis(hyp) {
  const isNew = !hyp;
  const obs = h('textarea', { id: 'hy-obs', rows: 5, placeholder: '只写看到、量到的事实，不写解释。一行一条，依次编号 O1、O2…\n例如：P3HT/氯仿墨水打印到银电极上时发生气爆，降低激光功率也无法避免\n同一墨水在纯石英片上可正常打印' }, hypObservations(hyp || {}).join('\n'));
  const title = h('input', { id: 'hy-title', value: hyp?.title || '', placeholder: '对上述现象最可能的解释，例如：气爆由银光热加热引发、低沸点溶剂暴沸所致' });
  const why = h('textarea', { id: 'hy-why', rows: 3, placeholder: '这个解释为什么能同时说明 O1、O2…；排除了哪些其他解释（可不填）。一行一点，例如 ① … ② …' }, hyp?.rationale || '');
  const preds = h('textarea', { id: 'hy-pred', rows: 3, placeholder: '若假设成立，在还没做过的实验里应看到什么。一行一条，编号 P1、P2…\n例如：改用邻二氯苯（沸点 180 °C）后，同样条件下不再气爆' }, (hyp?.predictions || []).join('\n'));
  const status = h('select', { id: 'hy-status' }, HYP_STATUS.map((x) => h('option', { selected: (hyp?.status || '提出') === x }, x)));
  const conf = h('select', { id: 'hy-conf' }, HYP_CONF.map((x) => h('option', { selected: (hyp?.confidence || '低') === x }, x)));
  const step = (n, t, sub) => h('span', { class: 'hy-step' }, h('b', null, n), t, sub ? h('small', null, sub) : null);
  modal({
    title: isNew ? '新建假设' : `编辑 ${hyp.id}`, wide: true,
    body: h('div', { class: 'form hy-form' },
      h('label', { for: 'hy-obs' }, step('1', '观察现象', '事实 · O1、O2…')), obs,
      h('label', { for: 'hy-title' }, step('2', '假设', '一句话解释')), title,
      h('label', { for: 'hy-why' }, step('3', '推理', '解释如何说明现象 · 可不填')), why,
      h('p', { class: 'muted hy-gap' }, '4　验证证据 —— 保存后在假设页“添加证据”，或在实验页结论旁“作为证据加入假设”。'),
      h('label', { for: 'hy-pred' }, step('5', '可检验预测', '若假设成立，应观察到 · P1、P2…')), preds,
      isNew ? h('div', { class: 'pair' }, h('div', null, h('label', { for: 'hy-status' }, '状态'), status), h('div', null, h('label', { for: 'hy-conf' }, '可信度'), conf)) : null),
    buttons: [{ label: '取消' }, {
      label: '保存', primary: true,
      run: async () => {
        if (!title.value.trim()) { toast('写一句假设：对这些现象的解释。'); return false; }
        const x = isNew ? { id: nextHypId(hypIds(lib)), status: status.value, confidence: conf.value, evidence: [], history: [{ at: nowISO(), status: status.value, confidence: conf.value, why: '提出' }], created: nowISO() } : await cloneHyp(hyp.id);
        x.title = title.value.trim();
        x.observations = lines(obs.value);
        x.rationale = why.value.trim();
        delete x.description;
        x.predictions = lines(preds.value);
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
  const pred = h('select', { id: 'ev-pred' }, h('option', { value: '' }, '不对应某条预测（一般性证据）'),
    (hyp.predictions || []).map((p, i) => h('option', { value: `P${i + 1}`, selected: (e.pred || preset.pred) === `P${i + 1}` }, `P${i + 1}　${p}`)));
  modal({
    title: isNew ? `为 ${hyp.id} 添加证据` : `编辑 ${hyp.id} · 证据 ${ev.id.slice(1)}`, wide: true,
    body: h('div', { class: 'form' },
      h('span', { class: 'label' }, '这条证据'), kind,
      (hyp.predictions || []).length ? [h('label', { for: 'ev-pred' }, '检验的是哪条预测'), pred] : null,
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
        const item = { id, kind: e.kind, date: date.value, text: text.value.trim(), photos: e.photos || [], ...(pred.value ? { pred: pred.value } : {}), ...(e.src?.vol ? { src: e.src } : url.value.trim() ? { src: { url: url.value.trim() } } : {}) };
        x.evidence = ev ? x.evidence.map((y) => (y.id === id ? item : y)) : [...(x.evidence || []), item];
        try { await saveHyp(x, `${x.id}: evidence ${id}`, adds); toast(`证据 ${id.slice(1)} 已保存。`); route({ quiet: true }); } catch (err) { toast(saveError(err)); return false; }
      },
    }],
  });
}

const secHead = (n, t, en, sub) => h('div', { class: 'sec-head' }, h('span', { class: 'sec-no' }, n), h('div', null, h('h2', null, t, h('span', { class: 'sec-en' }, en)), sub ? h('p', { class: 'card-sub' }, sub) : null));

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
  const obs = hypObservations(hyp);
  const why = h('div', { class: 'prose hyp-desc' });
  if (hyp.rationale) renderInto(why, rationaleItems(hyp.rationale).join('\n\n'), { lib, vol: null, num: null, urls, resolveBlob: (name) => lib.readBlob(name.replace(/^\//, '')) });
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
        h('p', { class: 'hero-eyebrow' }, `${hyp.id} · 假设 · 提出于 ${fmtDate(hyp.created)}`),
        h('h1', { class: 'hero-title' }, hyp.title),
        h('div', { class: 'hyp-state' }, hypBadge(hyp), confSwitch(hyp), h('button', { class: 'btn small', type: 'button', onclick: () => changeHypState(hyp) }, '调整状态'))),
      h('div', { class: 'hyp-cols' },
        h('div', { class: 'hyp-chain' },
          h('section', { class: 'tile' }, secHead('1', '观察现象', 'Observations', '实验中直接看到、测到的事实'),
            obs.length ? h('ol', { class: 'code-list' }, obs.map((o, i) => h('li', { id: `O${i + 1}` }, h('span', { class: 'code' }, `O${i + 1}`), h('span', null, o))))
              : h('p', { class: 'muted' }, '还没写观察到的现象。点“编辑”，先写事实，再写解释。')),
          h('section', { class: 'tile' }, secHead('2', '假设', 'Hypothesis', '对上述现象最可能的解释'),
            h('p', { class: 'hyp-claim' }, hyp.title)),
          hyp.rationale ? h('section', { class: 'tile' }, secHead('3', '推理', 'Reasoning', '为什么这个解释能说明观察现象'), why) : null,
          h('section', { class: 'tile' },
            h('div', { class: 'tile-head' }, secHead(hyp.rationale ? '4' : '3', '验证证据', 'Evidence', `支持 ${n['支持']} · 反对 ${n['反对']} · 待定 ${n['待定']}`),
              h('button', { class: 'btn small add-btn', type: 'button', onclick: () => editEvidence(hyp, null) }, '添加证据')),
            evidence.length ? h('ol', { class: 'ev-chain' }, evidence.map((e) => h('li', { class: `k-${e.kind}`, id: e.id },
              h('div', { class: 'ev-line' }, h('b', null, e.id), h('span', { class: `ev-kind k-${e.kind}` }, e.kind), e.pred ? h('span', { class: 'ev-pred' }, `检验 ${e.pred}`) : null, h('span', { class: 'ev-date' }, e.date || ''),
                h('span', { class: 'ev-tools' },
                  h('button', { class: 'btn small ghost', type: 'button', onclick: () => editEvidence(hyp, e) }, '编辑'),
                  h('button', { class: 'btn small ghost', type: 'button', onclick: async () => { if ((await choose(`删除证据 ${e.id}？`, 'GitHub 历史里仍可找回。', [['yes', '删除'], ['no', '取消']])) === 'yes') upd((x) => { x.evidence = x.evidence.filter((y) => y.id !== e.id); }, `${id}: remove evidence ${e.id}`); } }, '删除'))),
              h('p', { class: 'ev-text' }, e.text),
              e.src?.vol ? h('a', { class: 'ev-from', href: `#/v/${e.src.vol}/${e.src.num}` }, `来自实验 ${e.src.xid || `p. ${e.src.num}`}${lib.page(e.src.vol, e.src.num) ? ` · ${lib.page(e.src.vol, e.src.num).title}` : ''}`) : null,
              e.src?.url ? h('a', { class: 'ev-from', href: /^10\./.test(e.src.url) ? `https://doi.org/${e.src.url}` : e.src.url, target: '_blank', rel: 'noopener' }, `文献 ${e.src.url}`) : null,
              (e.photos || []).length ? h('div', { class: 'ev-photos' }, e.photos.map(photo)) : null))) : h('p', { class: 'muted' }, '还没有证据。可以在这里添加，也可以在实验页“结论”旁点“作为证据加入假设”。')),
          h('section', { class: 'tile' }, secHead(hyp.rationale ? '5' : '4', '可检验预测', 'Predictions', '若假设成立，应观察到'),
            (hyp.predictions || []).length ? h('ol', { class: 'code-list' }, hyp.predictions.map((p, i) => {
              const st = predictionState(hyp, i);
              return h('li', { id: `P${i + 1}` }, h('span', { class: 'code' }, `P${i + 1}`), h('span', null, p,
                h('span', { class: `pred-st${st.kind ? ` k-${st.kind}` : ''}` }, st.label, st.ev.length ? ` · ${st.ev.map((e) => e.id).join('、')}` : '')));
            })) : h('p', { class: 'muted' }, '还没写预测。点“编辑”添加，例如：换成高沸点溶剂后不再气爆。'))),
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
export async function openCiteHypothesis(vol, num, onInsert, onInline) {
  const hyps = await loadHypotheses(lib);
  if (!hyps.length) { if ((await choose('思维笔记本里还没有假设', '先去新建一条？', [['go', '去新建'], ['no', '取消']])) === 'go') { location.hash = '#/think'; setTimeout(() => editHypothesis(null), 400); } return; }
  const sel = h('select', { id: 'ch-hyp' }, hyps.map((x) => h('option', { value: x.id }, `${x.id} · ${x.title}（${x.status}）`)));
  const note = h('input', { id: 'ch-note', placeholder: '本次怎么检验，例如：改用邻二氯苯，其余条件与 20261101-OECT-01 相同' });
  // Tick the predictions this experiment tests (P1…); observations O1… can be cited inline from the steps.
  const picks = h('div', { class: 'pick-list' });
  const drawPicks = () => {
    const x = hyps.find((y) => y.id === sel.value);
    const row = (code, text, on) => h('label', { class: 'pick-row' }, h('input', { type: 'checkbox', value: code, checked: on }), h('span', { class: 'code' }, code), h('span', null, text));
    picks.replaceChildren(
      ...(x.predictions || []).map((p, i) => row(`P${i + 1}`, `${p}（${predictionState(x, i).label}）`, (x.predictions || []).length === 1)),
      ...(onInline ? hypObservations(x).map((o, i) => row(`O${i + 1}`, o, false)) : []));
    if (!picks.children.length) picks.append(h('p', { class: 'muted' }, '这条假设还没写预测。'));
  };
  sel.onchange = drawPicks; drawPicks();
  const codes = () => [...picks.querySelectorAll('input:checked')].map((c) => c.value);
  const buttons = [{ label: '取消' }];
  if (onInline) buttons.push({ label: '插入行内引用', run: () => { const c = codes(); onInline((c.length ? c : ['']).map((k) => `[[${sel.value}${k ? `#${k}` : ''}]]`).join(' ')); } });
  buttons.push({
    label: onInline ? '插入假设框' : '引用', primary: true,
    run: async () => {
      const block = hypBlock(sel.value, note.value.trim(), codes().filter((c) => c.startsWith('P')));
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
  });
  modal({
    title: '引用假设',
    body: h('div', { class: 'form' },
      h('label', { for: 'ch-hyp' }, '本实验要检验的假设'), sel,
      h('span', { class: 'label' }, onInline ? '本次检验的预测 / 要引用的观察' : '本次检验的预测'), picks,
      h('label', { for: 'ch-note' }, '检验方法（可不填）'), note,
      h('p', { class: 'muted' }, onInline
        ? '“插入假设框”：在光标处放完整逻辑链（观察 → 假设 → 证据 → 预测），勾选的预测标为“本次检验”。“插入行内引用”：在步骤或正文里写 [[H-0001#P1]]，页面上显示为可点的编号，鼠标停留可看原文。'
        : '会在“目的”一节顶部放一个假设框：观察 → 假设 → 证据 → 预测，勾选的预测标为“本次检验”；假设页的“相关实验”也会列出本实验。')),
    buttons,
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
  const tested = (body.match(/```hypothesis\n(H-\d{4})[^\n]*?\b(P\d+)/) || []);
  const btn = h('button', { class: 'ns-btn no-print', type: 'button', onclick: () => {
    const sel = h('select', { id: 'ce-hyp' }, hyps.map((x) => h('option', { value: x.id, selected: cited[0] === x.id }, `${x.id} · ${x.title}`)));
    modal({
      title: '把本实验的结论作为证据',
      body: h('div', { class: 'form' }, h('label', { for: 'ce-hyp' }, '加到哪条假设'), sel,
        h('p', { class: 'muted' }, '下一步选择“支持 / 反对 / 待定”，内容默认是本页的结论，可以修改。')),
      buttons: [{ label: '取消' }, { label: '下一步', primary: true, run: () => {
        const hyp = hyps.find((x) => x.id === sel.value);
        setTimeout(() => editEvidence(hyp, null, { date: fm.date, text: concl.slice(0, 300), src: { xid: fm.id || '', vol, num }, pred: tested[1] === hyp.id ? tested[2] : '' }), 50);
      } }],
    });
  } }, icon('book', 14), '作为证据加入假设');
  head.append(' ', btn, ...(done.length ? [h('span', { class: 'ns-added no-print' }, `✓ 已是 ${done.join('、')}`)] : []));
}
