// First-run setup and the settings page.
import { ApiError, GitHubBackend, NetworkError, kv } from './store.js';
import { h } from './util.js';
import {
  DEFAULTS, DEMO, FONTS, PTABLE_STYLES, S, SIG_FONTS, app, applySignature,
  applyTheme, choose, demoBanner, lib, saveSettings, sigFontOf, startLibrary, toast,
  topbar, useFontCss, view,
} from './core.js';
import { route } from './app.js';

// ---------- setup ----------
export function tokenUrl(owner = S.owner) {
  const p = new URLSearchParams({
    name: 'Lab notebook (this device)',
    description: 'Lets the lab notebook app on one device read and write the notebook repository.',
    expires_in: '366',
    contents: 'write',
  });
  if (owner) p.set('target_name', owner);
  return `https://github.com/settings/personal-access-tokens/new?${p}`;
}

// On <name>.github.io the GitHub account is known, so suggest it.
export function guessOwner() {
  const m = location.hostname.match(/^([a-z0-9-]+)\.github\.io$/i);
  return m ? m[1] : '';
}

// Entries belong in a private repository; ask before using a public one.
export async function confirmPrivate(acc, fullName) {
  if (acc.private) return true;
  const c = await choose('这个仓库是公开的', `Anyone on the internet can read what is stored in ${fullName}. Make it private on GitHub (Settings, then Danger Zone, then Change visibility) before writing in it.`, [['cancel', '返回'], ['ok', '仍然使用']]);
  return c === 'ok';
}

export function viewSetup() {
  const start = S.owner && S.repo ? `${S.owner}/${S.repo}` : guessOwner() ? `${guessOwner()}/` : '';
  const repoIn = h('input', { value: start, placeholder: 'your-github-name/lab-notebook-entries', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', id: 'f-repo' });
  const tokenLink = h('a', { href: tokenUrl(guessOwner()), target: '_blank', rel: 'noopener' }, '在 GitHub 上创建令牌');
  const repoName = h('code', null, start.split('/')[1] || '你的记录仓库');
  repoIn.addEventListener('input', () => {
    const [o, r] = repoIn.value.trim().split('/');
    tokenLink.href = tokenUrl(o);
    repoName.textContent = r || '你的记录仓库';
  });
  const branchIn = h('input', { value: S.branch, autocomplete: 'off', spellcheck: 'false', id: 'f-branch' });
  const tokenIn = h('input', { type: 'password', autocomplete: 'off', spellcheck: 'false', id: 'f-token', placeholder: 'github_pat_…' });
  const err = h('p', { class: 'form-error', role: 'alert' });
  const go = h('button', { class: 'btn primary', type: 'submit' }, '连接笔记本');
  const form = h('form', {
    class: 'setup-form',
    onsubmit: async (e) => {
      e.preventDefault();
      err.textContent = '';
      const [owner, repo] = repoIn.value.trim().split('/');
      const token = tokenIn.value.trim();
      if (!owner || !repo) { err.textContent = '仓库请写成 用户名/仓库名。'; return; }
      if (!token) { err.textContent = '粘贴你在 GitHub 上创建的令牌。'; return; }
      go.disabled = true; go.textContent = '检查中…';
      try {
        const be = new GitHubBackend({ owner, repo, branch: branchIn.value.trim() || 'main', token, apiBase: S.apiBase });
        const acc = await be.checkAccess();
        if (!acc.canWrite) throw new Error('这个令牌只能读不能写。请在 GitHub 上把 Contents 设为 “Read and write”。');
        if (!(await confirmPrivate(acc, `${owner}/${repo}`))) return;
        Object.assign(S, { owner, repo, branch: branchIn.value.trim() || 'main', token });
        saveSettings();
        await startLibrary();
        location.hash = '#/';
        route();
      } catch (e2) {
        err.textContent = e2 instanceof ApiError && e2.status === 401 ? 'GitHub 拒绝了这个令牌。请检查是否复制完整、是否过期。'
          : e2 instanceof ApiError && e2.status === 404 ? `This token can’t see ${owner}/${repo}. When creating it, choose “Only select repositories” and pick that repository.`
            : e2 instanceof NetworkError ? '连不上 GitHub，请检查网络后重试。' : e2.message;
      } finally { go.disabled = false; go.textContent = '连接笔记本'; }
    },
  },
  h('label', { for: 'f-repo' }, '存放记录的私有仓库'), repoIn,
  h('label', { for: 'f-branch' }, '分支'), branchIn,
  h('label', { for: 'f-token' }, 'GitHub 令牌'), tokenIn,
  err, go);

  return h('div', { class: 'view setup' },
    h('header', { class: 'topbar' }, h('div', { class: 'tb-left' }, h('div', { class: 'tb-title' }, h('span', { class: 'tb-main' }, '实验记录本')))),
    h('article', { class: 'sheet plain narrow' },
      h('h1', null, '连接这台设备'),
      h('p', null, '记录保存在你的 GitHub 私有仓库里。每台手机、平板或电脑都需要一个只能读写这个仓库的令牌，令牌只存在这台设备上。'),
      h('ol', { class: 'steps' },
        h('li', null, '新建一个空的 ', h('strong', null, 'private'), ' 仓库（如果还没有）。'),
        h('li', null, tokenLink, '。在 Repository access 里选 ', h('em', null, 'Only select repositories'), '，再选 ', repoName, '。Contents 已自动设为 Read and write。'),
        h('li', null, '复制令牌，粘贴到下面，然后连接。')),
      form,
      h('p', { class: 'muted' }, '想先看看效果？', h('a', { href: '?demo#/v/sample/1' }, '打开示例笔记本'), '.')));
}

// ---------- settings ----------
export function sigPicker() {
  const nb = lib.notebook;
  let pick = sigFontOf(nb.sigFont)[0];
  const text = h('input', { id: 's-sigtext', value: nb.sigText || '', placeholder: `留空则用“${nb.owner || '签名用的名字'}”，可写 王千语 / Q. Wang` });
  const grid = h('div', { class: 'sig-grid', role: 'radiogroup', 'aria-label': '签名字体' });
  const draw = () => {
    const word = text.value.trim() || nb.owner || '签名';
    grid.replaceChildren(...SIG_FONTS.map(([id, fam, label, css]) => {
      useFontCss(css);
      return h('button', { type: 'button', role: 'radio', 'aria-checked': String(id === pick), class: `sig-opt${id === pick ? ' on' : ''}`, onclick: () => { pick = id; draw(); } },
        h('span', { class: 'sig-sample', style: { fontFamily: `'${fam}', cursive` } }, word),
        h('span', { class: 'sig-name' }, label));
    }));
  };
  text.addEventListener('input', draw); draw();
  return h('div', { class: 'sig-pick' },
    h('label', { for: 's-sigtext' }, '签名显示为'), text,
    h('span', { class: 'label' }, '签名字体（中文名请选标“中文”的字体）'), grid,
    h('button', { class: 'btn', type: 'button', onclick: async (e) => {
      e.target.disabled = true;
      try { await lib.updateNotebook((n) => { n.sigFont = pick; n.sigText = text.value.trim(); }, 'Signature style'); applySignature(); toast('签名样式已保存。'); } catch (err) { toast(err instanceof NetworkError ? '离线中，联网后再试。' : err.message); } finally { e.target.disabled = false; }
    } }, '保存签名样式'));
}

export function viewSettings() {
  const isLib = !!lib;
  const back = isLib ? '#/' : null;
  const nbTitle = h('input', { id: 's-title', value: lib?.notebook.title || '' });
  const owner = h('input', { id: 's-owner', value: lib?.notebook.owner || '', placeholder: '签名用的名字' });
  const theme = h('select', { id: 's-theme' }, [['auto', '跟随系统'], ['light', '浅色纸'], ['dark', '深色纸']].map(([v, l]) => h('option', { value: v, selected: S.theme === v }, l)));
  const down = h('input', { type: 'checkbox', id: 's-down', checked: S.downscale });
  const repo = h('input', { id: 's-repo', value: `${S.owner}/${S.repo}`, spellcheck: 'false' });
  const branch = h('input', { id: 's-branch', value: S.branch, spellcheck: 'false' });
  const tokExp = h('input', { id: 's-tokexp', type: 'date', value: S.tokenExpires || '', onchange: (e) => { S.tokenExpires = e.target.value; saveSettings(); } });
  const token = h('input', { id: 's-token', type: 'password', placeholder: S.token ? '已存在本机（粘贴新的即可替换）' : 'github_pat_…', autocomplete: 'off' });
  const api = h('input', { id: 's-api', value: S.apiBase, spellcheck: 'false' });

  const font = h('select', { id: 's-font' }, FONTS.map(([v, l]) => h('option', { value: v, selected: S.font === v }, l)));
  const size = h('select', { id: 's-size' }, [['normal', '标准'], ['large', '大'], ['xlarge', '特大']].map(([v, l]) => h('option', { value: v, selected: S.size === v }, l)));
  // Deadlines are often on Beijing time while this device may be elsewhere: count down on the deadline's clock.
  const dlOff = h('input', { id: 's-dloff', type: 'number', min: -24, max: 24, step: 1, value: S.deadlineOffset ?? 13, onchange: (e) => { S.deadlineOffset = e.target.value === '' ? 13 : Number(e.target.value); saveSettings(); } });
  const dlHint = () => { const bj = 8 + new Date().getTimezoneOffset() / 60; return bj ? `本机现在比北京时间慢 ${bj} 小时：填 ${bj} 就是按北京时间倒计时（美国夏令时期间相差 12 小时，冬令时 13 小时）。填 0 = 按本机时间。` : '本机就是北京时间，填 0 即可。'; };
  const ptable = h('select', { id: 's-ptable' }, PTABLE_STYLES.map(([v, l]) => h('option', { value: v, selected: (S.ptable || 'booktabs') === v }, l)));
  ptable.addEventListener('change', () => { S.ptable = ptable.value; saveSettings(); applyTheme(); });
  const fontDemo = h('div', { class: 'prose font-demo' });
  fontDemo.innerHTML = '将 <span class="qty">10 mL</span> DI 水加入 <span class="qty">20 mL</span> 玻璃瓶，<span class="qty">500 rpm</span> 搅拌 <span class="qty">30 min</span>。PEDOT:PSS 薄膜呈深蓝色。';
  theme.addEventListener('change', () => { S.theme = theme.value; saveSettings(); applyTheme(); });
  font.addEventListener('change', () => { S.font = font.value; saveSettings(); applyTheme(); });
  size.addEventListener('change', () => { S.size = size.value; saveSettings(); applyTheme(); });
  down.addEventListener('change', () => { S.downscale = down.checked; saveSettings(); });

  const section = (title, ...kids) => h('section', { class: 'settings-section' }, h('h2', null, title), ...kids);
  return h('div', { class: 'view settings' },
    topbar({ back, backLabel: '所有卷', title: '设置' }),
    demoBanner(),
    h('article', { class: 'sheet plain narrow' },
      isLib ? section('笔记本',
        h('div', { class: 'form' },
          h('label', { for: 's-title' }, '笔记本名称'), nbTitle,
          h('label', { for: 's-owner' }, '签名用的名字'), owner,
          sigPicker(),
          h('button', { class: 'btn primary', type: 'button', onclick: async (e) => {
            e.target.disabled = true;
            try { await lib.updateNotebook((nb) => { nb.title = nbTitle.value.trim() || '实验记录本'; nb.owner = owner.value.trim(); }); toast('已保存。'); } catch (err) { toast(err instanceof NetworkError ? '离线中，联网后再试。' : err.message); } finally { e.target.disabled = false; }
          } }, '保存'))) : null,
      section('本设备',
        h('div', { class: 'form' },
          h('label', { for: 's-theme' }, '纸张'), theme,
          h('label', { for: 's-font' }, '正文字体'), font,
          h('label', { for: 's-size' }, '字号'), size,
          fontDemo,
          h('label', { for: 's-ptable' }, 'PDF 表格样式'), ptable,
          h('p', { class: 'muted' }, '导出 PDF 时，表格自动铺满 A4 宽度；表头里的单位（如 μL）另起一行；列多的表自动缩小字号。'),
          h('label', { for: 's-dloff' }, '截止日倒计时：本机时间加几小时'), dlOff,
          h('p', { class: 'muted' }, dlHint()),
          h('label', { class: 'check', for: 's-down' }, down, ' 附加前把大照片缩小到 2400 px'))),
      DEMO ? null : section('连接',
        h('p', { class: 'muted' }, '记录保存在这个 GitHub 私有仓库里。令牌只存在这个浏览器中。'),
        h('div', { class: 'form' },
          h('label', { for: 's-repo' }, '仓库'), repo,
          h('label', { for: 's-branch' }, '分支'), branch,
          h('label', { for: 's-token' }, '令牌'), token,
          h('label', { for: 's-tokexp' }, '令牌到期日'), tokExp,
          h('p', { class: 'muted small' }, '在 GitHub 生成令牌时页面上会显示到期日，填在这里；到期前 14 天起，每页顶部都会提醒你换新令牌。'),
          h('details', null, h('summary', null, '高级'), h('label', { for: 's-api' }, 'GitHub API 地址'), api),
          h('div', { class: 'row-actions' },
            h('button', { class: 'btn primary', type: 'button', onclick: async (e) => {
              const [o, r] = repo.value.trim().split('/');
              if (!o || !r) { toast('仓库请写成 用户名/仓库名。'); return; }
              const next = { ...S, owner: o, repo: r, branch: branch.value.trim() || 'main', apiBase: api.value.trim() || DEFAULTS.apiBase, token: token.value.trim() || S.token };
              e.target.disabled = true;
              try {
                const acc = await new GitHubBackend(next).checkAccess();
                if (!acc.canWrite) throw new Error('这个令牌不能修改仓库。请把 Contents 设为 Read and write。');
                if (!(await confirmPrivate(acc, `${o}/${r}`))) return;
                Object.assign(S, next); saveSettings();
                await startLibrary(); toast('已连接。'); location.hash = '#/';
              } catch (err) {
                toast(err instanceof ApiError && err.status === 401 ? 'GitHub 拒绝了这个令牌。' : err instanceof ApiError && err.status === 404 ? '这个令牌看不到那个仓库。' : err.message);
              } finally { e.target.disabled = false; }
            } }, '保存连接'),
            h('a', { class: 'btn', href: tokenUrl(), target: '_blank', rel: 'noopener' }, '创建新令牌')))),
      isLib ? section('维护',
        h('p', { class: 'muted' }, '直接在 GitHub 或电脑上改过页面文件后，重建一下搜索索引。清除缓存只删本机的副本。'),
        h('div', { class: 'row-actions' },
          h('button', { class: 'btn', type: 'button', onclick: async (e) => {
            e.target.disabled = true; toast('正在重建搜索索引…');
            try { const n = await lib.rebuildIndex(); toast(`搜索索引已重建（读取 ${n} 页）。`); } catch (err) { toast(err.message); } finally { e.target.disabled = false; }
          } }, '重建搜索索引'),
          h('button', { class: 'btn', type: 'button', onclick: async () => { await lib.clearCache(); toast('本机缓存已清除，打开页面时会重新下载。'); lib.head = null; await lib.refresh(); } }, '清除本机缓存'))) : null,
      section('帮助',
        h('p', null, h('a', { href: '?demo#/v/sample/1' }, '打开示例笔记本'), '，可以看到各种写法和对应的源文本。')),
      DEMO ? null : section('断开',
        h('p', { class: 'muted' }, '删除本机的令牌和缓存，GitHub 上的内容不受影响。'),
        h('button', { class: 'btn danger', type: 'button', onclick: async () => {
          const ok = await choose('断开这台设备？', lib?.outbox.length ? `${lib.outbox.length} 个页面还没同步，断开会丢失。` : '随时可以用令牌重新连接。', [['yes', '断开'], ['no', '取消']]);
          if (ok !== 'yes') return;
          if (lib) { await lib.clearCache(); await kv.del(`${lib.key}:outbox`); }
          S.token = ''; saveSettings(); location.hash = '#/'; location.reload();
        } }, '断开这台设备'))));
}
