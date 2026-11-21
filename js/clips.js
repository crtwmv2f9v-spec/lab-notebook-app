// 素材库 (clips/F-0001.json): figures cut from papers and small facts (template line widths, plotting settings).
// The record (title, categories, source paper, Zotero link, Google Drive file ID) lives in the notebook repository;
// the image itself is stored in Google Drive via REST API so it loads reliably on every browser and device.
import { ZONE, nowISO, todayISO, zoned } from './model.js';
import { addDays } from './lab.js';
import { kv } from './store.js';
import { h, icon, isImeEvent } from './util.js';
import { DEMO, choose, demoBanner, lib, modal, requestQuietRoute, saveError, toast, topbar, view } from './core.js';
import { route } from './app.js';
import { PIN_SVG, WEEKDAYS, loadPlanner, toggleTask, weekStart } from './planner.js';
import { lookupPaper, paperKey, paperKeywords } from './home.js';

// clip = { id, kind: 'img' | 'note', title, cats: [], note, pinned, file, driveId, w, h,
//          src: { zotero, page, fig, cite, doi, ref: { title, authors, journal, year, doi }, task }, created, updated }
export const clipPath = (id) => `clips/${id}.json`;
export const clipIds = () => [...lib.tree.keys()].map((p) => (p.match(/^clips\/(F-\d{4})\.json$/) || [])[1]).filter(Boolean).sort();
const clipTime = (c) => {
  const t = Date.parse(c?.created || '');
  return Number.isFinite(t) ? t : null;
};
export function sortClips(list) {
  return [...list].sort((a, b) => {
    const pin = Number(!!b?.pinned) - Number(!!a?.pinned);
    if (pin) return pin;
    const ta = clipTime(a); const tb = clipTime(b);
    if (ta !== tb) {
      if (ta != null && tb != null) return tb - ta;
      return tb != null ? 1 : -1;
    }
    return String(b?.created || '').localeCompare(String(a?.created || ''))
      || String(b?.id || '').localeCompare(String(a?.id || ''));
  });
}
const memo = new Map();
export async function loadClips() {
  return (await Promise.all(clipIds().map(async (id) => {
    const k = `${id}@${lib.tree.get(clipPath(id))}`;
    if (!memo.has(k)) memo.set(k, lib.readText(clipPath(id)).then(JSON.parse).catch(() => null));
    return memo.get(k);
  }))).filter(Boolean);
}
const nextId = () => `F-${String(Math.max(0, ...clipIds().map((x) => parseInt(x.slice(2), 10))) + 1).padStart(4, '0')}`;
async function saveClip(c, msg) {
  c.updated = nowISO();
  await lib.commit(msg, async () => ({ changes: [{ path: clipPath(c.id), data: `${JSON.stringify(c, null, 1)}\n` }] }));
}

// ---------- Google Drive image storage (primary) + local/demo fallback ----------
const GDRIVE_CFG = 'labnote-gdrive';
const GDRIVE_TOK = 'labnote-gdrive-tok';
const GDRIVE_CACHE = 'labnote-gdrive-img-v1';
const GDRIVE_SCOPE = 'https://www.googleapis.com/auth/drive';
export const DEFAULT_GDRIVE_FOLDER = '1N6YjBVlGW--cyomVcQjNJnizfYs4C0DF'; // Research_Figure_Library / 03_LabNotebook_Clips
export const DEFAULT_STYLE_INBOX_FOLDER = '1xjQ31u4WK3cFTfE-MQrCRLVmgNAEn6Fx'; // Research_Figure_Library / 00_Style_Inbox
export const DEFAULT_STYLE_INBOX_CAT = '00_Style_Inbox';

export function parseDriveFolderId(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  const m = s.match(/\/folders\/([A-Za-z0-9_-]{10,})/) || s.match(/[?&]id=([A-Za-z0-9_-]{10,})/);
  if (m) return m[1];
  return /^[A-Za-z0-9_-]{10,}$/.test(s) ? s : '';
}
export function parseStyleCats(raw) {
  const parts = Array.isArray(raw) ? raw.map((x) => String(x || '')) : String(raw ?? '').split(/[,，、;；\n]+/);
  const seen = new Set();
  const out = [];
  for (const p of parts) {
    const t = p.trim();
    const k = t.toLowerCase();
    if (!t || seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}
function rawGdriveStored() {
  try { return JSON.parse(localStorage.getItem(GDRIVE_CFG) || 'null'); } catch { return null; }
}
export function styleSyncConfig() {
  const d = rawGdriveStored();
  const hasCats = !!(d && Object.prototype.hasOwnProperty.call(d, 'styleCats'));
  return {
    styleFolderId: parseDriveFolderId(d?.styleFolderId) || DEFAULT_STYLE_INBOX_FOLDER,
    styleCats: hasCats ? parseStyleCats(d.styleCats) : [DEFAULT_STYLE_INBOX_CAT],
  };
}
export function gdriveConfig() {
  const d = rawGdriveStored();
  if (!d?.clientId || !String(d.clientId).trim()) return null;
  const sc = styleSyncConfig();
  return {
    clientId: String(d.clientId).trim(),
    folderId: parseDriveFolderId(d.folderId) || DEFAULT_GDRIVE_FOLDER,
    styleFolderId: sc.styleFolderId,
    styleCats: sc.styleCats,
  };
}
export function saveGdriveConfig({ clientId = '', folderId = '', styleFolderId = '', styleCats = DEFAULT_STYLE_INBOX_CAT } = {}) {
  const cid = String(clientId || '').trim();
  const fid = parseDriveFolderId(folderId) || DEFAULT_GDRIVE_FOLDER;
  const sfid = parseDriveFolderId(styleFolderId) || DEFAULT_STYLE_INBOX_FOLDER;
  const cats = parseStyleCats(styleCats);
  localStorage.setItem(GDRIVE_CFG, JSON.stringify({
    clientId: cid,
    folderId: fid,
    styleFolderId: sfid,
    styleCats: cats.join(', '),
  }));
  return cid ? { clientId: cid, folderId: fid, styleFolderId: sfid, styleCats: cats } : null;
}
export function clearGdriveConfig() {
  try { localStorage.removeItem(GDRIVE_CFG); } catch { /* ignore */ }
  setGdriveToken(null);
  urlCache.clear();
}
export function matchesStyleSyncCat(cats, cfg = styleSyncConfig()) {
  const targets = (cfg?.styleCats || []).map((x) => x.trim().toLowerCase()).filter(Boolean);
  if (!targets.length || !Array.isArray(cats) || !cats.length) return false;
  return cats.some((c) => targets.includes(String(c || '').trim().toLowerCase()));
}
export function isStyleInboxCategory(cat, cfg = styleSyncConfig()) {
  return !!cat && matchesStyleSyncCat([cat], cfg);
}
function gdriveToken() {
  try {
    const t = JSON.parse(sessionStorage.getItem(GDRIVE_TOK) || 'null');
    if (t?.token && Date.now() < Number(t.exp || 0) - 60e3) return t.token;
  } catch { /* private window */ }
  return null;
}
export function hasGdriveToken() {
  return !!gdriveToken();
}
function setGdriveToken(token, expiresIn = 3500) {
  try {
    if (!token) sessionStorage.removeItem(GDRIVE_TOK);
    else sessionStorage.setItem(GDRIVE_TOK, JSON.stringify({ token, exp: Date.now() + Number(expiresIn) * 1000 }));
  } catch { /* private window */ }
}
let gisLoading = null;
function loadGis() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (!gisLoading) {
    gisLoading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true;
      s.onload = () => (window.google?.accounts?.oauth2 ? resolve() : reject(new Error('Google 登录组件未就绪')));
      s.onerror = () => { gisLoading = null; reject(new Error('无法加载 Google 登录组件（请检查网络）。')); };
      document.head.appendChild(s);
    });
  }
  return gisLoading;
}
export async function authorizeDrive({ interactive = true, clientId = '' } = {}) {
  const cid = String(clientId || gdriveConfig()?.clientId || '').trim();
  if (!cid) throw new Error('尚未填写 Google OAuth Client ID。');
  await loadGis();
  return new Promise((resolve, reject) => {
    const tc = window.google.accounts.oauth2.initTokenClient({
      client_id: cid,
      scope: GDRIVE_SCOPE,
      callback: (resp) => {
        if (resp?.error) { reject(new Error(resp.error_description || resp.error)); return; }
        if (!resp?.access_token) { reject(new Error('未获取到 Google Drive 授权令牌。')); return; }
        setGdriveToken(resp.access_token, resp.expires_in || 3500);
        resolve(resp.access_token);
      },
      error_callback: (err) => reject(new Error(err?.message || 'Google 授权弹窗被关闭或拦截。')),
    });
    tc.requestAccessToken({ prompt: interactive ? '' : 'none' });
  });
}
async function driveReq(url, opts = {}) {
  const tok = gdriveToken();
  if (!tok) throw new Error('Google Drive 尚未授权。');
  const headers = new Headers(opts.headers || {});
  headers.set('Authorization', `Bearer ${tok}`);
  const r = await fetch(url, { ...opts, headers });
  if (r.status === 401) { setGdriveToken(null); throw new Error('Google Drive 授权已过期，请点击上方按钮重新授权。'); }
  return r;
}
const driveCacheKey = (id) => `https://labnote.local/gdrive/${encodeURIComponent(id)}`;
async function driveCacheGet(id) {
  if (!id || !('caches' in window)) return null;
  try {
    const c = await caches.open(GDRIVE_CACHE);
    const hit = await c.match(driveCacheKey(id));
    return hit ? await hit.blob() : null;
  } catch { return null; }
}
async function driveCachePut(id, blob) {
  if (!id || !blob || !('caches' in window)) return;
  try {
    const c = await caches.open(GDRIVE_CACHE);
    await c.put(driveCacheKey(id), new Response(blob, { headers: { 'Content-Type': blob.type || 'image/png' } }));
  } catch { /* storage quota or private mode */ }
}
async function driveCacheDel(id) {
  if (!id || !('caches' in window)) return;
  try { const c = await caches.open(GDRIVE_CACHE); await c.delete(driveCacheKey(id)); } catch { /* ignore */ }
}
async function driveDownloadBlob(id) {
  if (!id) return null;
  const cached = await driveCacheGet(id);
  if (cached) return cached;
  if (!gdriveToken()) return null;
  try {
    const r = await driveReq(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?alt=media`);
    if (!r.ok) return null;
    const b = await r.blob();
    await driveCachePut(id, b);
    return b;
  } catch { return null; }
}
async function driveFindByName(name) {
  const cfg = gdriveConfig();
  if (!cfg || !gdriveToken() || !name) return '';
  const esc = String(name).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const q = `name='${esc}' and '${cfg.folderId}' in parents and trashed=false`;
  try {
    const r = await driveReq(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)&pageSize=1`);
    if (!r.ok) return '';
    return (await r.json()).files?.[0]?.id || '';
  } catch { return ''; }
}
async function driveUpload(name, blob, oldDriveId = '') {
  const cfg = gdriveConfig();
  if (!cfg) throw new Error('请先连接 Google Drive。');
  if (!gdriveToken()) await authorizeDrive({ interactive: true });
  const mime = blob.type || 'image/png';
  if (oldDriveId) {
    const r = await driveReq(`https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(oldDriveId)}?uploadType=media`, {
      method: 'PATCH',
      headers: { 'Content-Type': mime },
      body: blob,
    });
    if (r.ok) {
      await driveReq(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(oldDriveId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      }).catch(() => {});
      await driveCachePut(oldDriveId, blob);
      return oldDriveId;
    }
  }
  const boundary = `labnote_${Date.now().toString(36)}`;
  const meta = JSON.stringify({ name, parents: [cfg.folderId] });
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n`,
    `--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`,
    blob,
    `\r\n--${boundary}--`,
  ]);
  const r = await driveReq('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name', {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  });
  if (!r.ok) throw new Error(`Google Drive 上传失败 (${r.status})`);
  const j = await r.json();
  if (!j?.id) throw new Error('Google Drive 未返回文件 ID。');
  await driveCachePut(j.id, blob);
  return j.id;
}
async function driveTrash(id) {
  if (!id) return;
  await driveCacheDel(id);
  if (!gdriveToken()) return;
  await driveReq(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ trashed: true }),
  }).catch(() => {});
}
export async function driveCopyToFolder(sourceDriveId, destFolderId, name = '') {
  if (!sourceDriveId || !destFolderId) throw new Error('缺少源文件 ID 或风格投递箱文件夹 ID。');
  if (!gdriveToken()) await authorizeDrive({ interactive: true });
  const payload = { parents: [destFolderId] };
  if (name) payload.name = name;
  const r = await driveReq(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(sourceDriveId)}/copy?fields=id,name`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error(`同步到风格投递箱失败 (${r.status})`);
  const j = await r.json();
  if (!j?.id) throw new Error('风格投递箱未返回文件 ID。');
  return j.id;
}
export async function syncStyleInboxClips(clipsInput = null) {
  const cfg = gdriveConfig();
  if (!cfg) throw new Error('请先填写 Google OAuth Client ID。');
  if (!cfg.styleCats.length || !cfg.styleFolderId) return { synced: 0, skipped: 0, failed: 0 };
  if (cfg.styleFolderId === cfg.folderId) return { synced: 0, skipped: 0, failed: 0 };
  const all = clipsInput || await loadClips();
  const todo = all.filter((c) => c.kind === 'img' && matchesStyleSyncCat(c.cats, cfg) && !c.styleDriveId && (c.driveId || c.file));
  if (!todo.length) return { synced: 0, skipped: 0, failed: 0 };
  if (!gdriveToken()) await authorizeDrive({ interactive: true });
  const done = [];
  let skipped = 0;
  let failed = 0;
  for (const c of todo) {
    try {
      const srcId = c.driveId || (c.file ? await driveFindByName(c.file) : '');
      if (!srcId) { skipped++; continue; }
      const copyId = await driveCopyToFolder(srcId, cfg.styleFolderId, c.file || `${c.id}.png`);
      const now = nowISO();
      done.push({
        ...c,
        ...(c.driveId ? {} : { driveId: srcId }),
        styleDriveId: copyId,
        styleSyncedAt: now,
        updated: now,
      });
    } catch { failed++; }
  }
  if (done.length) {
    await lib.commit(`Clips: sync ${done.length} to 00_Style_Inbox`, async () => ({
      changes: done.map((c) => ({ path: clipPath(c.id), data: `${JSON.stringify(c, null, 1)}\n` })),
    }));
  }
  return { synced: done.length, skipped, failed };
}
export function gdriveSetupSteps(origin = location.origin || 'https://crtwmv2f9v-spec.github.io') {
  return h('ol', { class: 'za-steps' },
    h('li', null, '打开 ', h('a', { href: 'https://console.cloud.google.com/apis/library/drive.googleapis.com', target: '_blank', rel: 'noopener' }, 'Google Cloud Console › Google Drive API'), '，选一个项目并点 ', h('b', null, 'Enable'), '。'),
    h('li', null, '在 ', h('a', { href: 'https://console.cloud.google.com/apis/credentials/consent', target: '_blank', rel: 'noopener' }, 'OAuth consent screen'), ' 选 External，把你的 Gmail 加入 ', h('b', null, 'Test users'), '（无需提交审核）。'),
    h('li', null, '在 ', h('a', { href: 'https://console.cloud.google.com/apis/credentials', target: '_blank', rel: 'noopener' }, 'Credentials › Create Credentials › OAuth client ID'), ' 选 ', h('b', null, 'Web application'), '，Authorized JavaScript origins 填 ',
      h('span', { class: 'gd-origin-row' },
        h('code', null, origin),
        h('button', { class: 'btn small ghost', type: 'button', onclick: async () => { toast(await copyText(origin) ? '已复制来源地址。' : '请手动复制来源地址。'); } }, '复制网址')), '。'),
    h('li', null, '复制生成的 Client ID（以 ', h('code', null, '.apps.googleusercontent.com'), ' 结尾）粘贴到下方，点「保存并授权」。'));
}
export function connectGoogleDrive(after) {
  const cur = gdriveConfig();
  const sc = styleSyncConfig();
  const origin = location.origin || 'https://crtwmv2f9v-spec.github.io';
  const cidIn = h('input', { id: 'gd-cid', value: cur?.clientId || '', autocomplete: 'off', spellcheck: 'false', placeholder: '粘贴 xxxxx.apps.googleusercontent.com' });
  const fidIn = h('input', { id: 'gd-fid', value: cur?.folderId || DEFAULT_GDRIVE_FOLDER, autocomplete: 'off', spellcheck: 'false', placeholder: '粘贴 Google Drive 文件夹 ID 或链接' });
  const scIn = h('input', { id: 'gd-style-cat', value: sc.styleCats.join(', '), autocomplete: 'off', spellcheck: 'false', placeholder: '例如：00_Style_Inbox, flat style image library（留空关闭）' });
  const sfidIn = h('input', { id: 'gd-style-fid', value: sc.styleFolderId || DEFAULT_STYLE_INBOX_FOLDER, autocomplete: 'off', spellcheck: 'false', placeholder: '粘贴 00_Style_Inbox 文件夹 ID 或链接' });
  const dlg = modal({
    title: '连接 Google Drive 图床与风格投递箱',
    wide: true,
    body: h('div', { class: 'form' },
      h('p', null, '所有素材图片默认存进 ', h('code', null, 'Research_Figure_Library/03_LabNotebook_Clips'), '；凡是归入指定风格分类（默认 ', h('code', null, DEFAULT_STYLE_INBOX_CAT), '）的图片，保存时会自动复制一份到 ', h('code', null, '00_Style_Inbox'), '。'),
      gdriveSetupSteps(origin),
      h('label', { for: 'gd-cid' }, 'Google OAuth Client ID（只需填一次）'), cidIn,
      h('label', { for: 'gd-fid' }, '素材库主文件夹 ID（默认 03_LabNotebook_Clips，可粘贴文件夹链接）'), fidIn,
      h('label', { for: 'gd-style-cat' }, '自动同步到风格投递箱的分类名（逗号分隔，不区分大小写；留空则关闭）'), scIn,
      h('label', { for: 'gd-style-fid' }, '风格投递箱文件夹 ID（默认 00_Style_Inbox，可粘贴文件夹链接）'), sfidIn,
      h('p', { class: 'muted small' }, cur ? '配置仅保存在本机浏览器，不进 GitHub。也可以在「设置 › Google Drive」随时修改。' : '只需配置一次，配置保存在本机浏览器（不进 GitHub）；也可以随时在「设置 › Google Drive」里修改。')),
    buttons: [
      cur ? { label: '断开', danger: true, run: () => {
        clearGdriveConfig();
        toast('已断开 Google Drive。');
        after?.();
      } } : null,
      { label: '取消' },
      { label: '仅保存配置', run: () => {
        const saved = saveGdriveConfig({ clientId: cidIn.value, folderId: fidIn.value, styleFolderId: sfidIn.value, styleCats: scIn.value });
        toast(saved ? 'Google Drive 配置已保存，点击授权即可同步。' : '已保存文件夹与分类设置；填写 Client ID 后即可授权。');
        dlg.close();
        after?.();
        return false;
      } },
      { label: '保存并授权', primary: true, run: async () => {
        const cid = cidIn.value.trim();
        if (!cid) { toast('先填写 Google OAuth Client ID。'); return false; }
        try {
          saveGdriveConfig({ clientId: cid, folderId: fidIn.value, styleFolderId: sfidIn.value, styleCats: scIn.value });
          await authorizeDrive({ interactive: true, clientId: cid });
          urlCache.clear();
          toast('Google Drive 已连接。');
          dlg.close();
          after?.();
          return false;
        } catch (e) {
          toast(e.message || 'Google Drive 授权失败。');
          return false;
        }
      } },
    ],
  });
}

// ---------- demo OPFS / legacy local folder fallback ----------
const DIR_KEY = 'clips-dir';
export const folderSupported = () => DEMO ? !!navigator.storage?.getDirectory : 'showDirectoryPicker' in window;
let dirCache = null;
async function storedDir() {
  if (DEMO) return (await navigator.storage.getDirectory()).getDirectoryHandle('labnote-clips', { create: true });
  return kv.get(DIR_KEY).catch(() => null);
}
// 'none' (not configured) | 'ask' (needs one click this visit) | 'ok' | 'unsupported'
export async function folderState() {
  if (DEMO) {
    if (!folderSupported()) return { state: 'unsupported', mode: 'local' };
    if (dirCache) return { state: 'ok', dir: dirCache, mode: 'local' };
    const d = await storedDir();
    if (!d) return { state: 'none', mode: 'local' };
    dirCache = d;
    return { state: 'ok', dir: d, mode: 'local' };
  }
  const cfg = gdriveConfig();
  if (!cfg) return { state: 'none', mode: 'gdrive' };
  const tok = gdriveToken();
  return tok ? { state: 'ok', mode: 'gdrive', token: tok, folderId: cfg.folderId } : { state: 'ask', mode: 'gdrive', folderId: cfg.folderId };
}
async function legacyLocalDir() {
  if (DEMO || !('showDirectoryPicker' in window)) return null;
  if (dirCache) return dirCache;
  const d = await storedDir();
  if (!d) return null;
  const p = await d.queryPermission({ mode: 'read' }).catch(() => 'prompt');
  if (p === 'granted') { dirCache = d; return d; }
  return null;
}
export async function connectFolder({ pickNew = false } = {}) {
  if (DEMO) {
    dirCache = await storedDir();
    return dirCache;
  }
  const cfg = gdriveConfig();
  if (!cfg || pickNew) { connectGoogleDrive(() => route({ quiet: true })); return null; }
  try {
    await authorizeDrive({ interactive: true });
    urlCache.clear();
    toast('Google Drive 已授权。');
    return { mode: 'gdrive', folderId: cfg.folderId };
  } catch (e) {
    toast(e.message || 'Google Drive 授权失败。');
    return null;
  }
}
async function writeImage(dir, name, blob) {
  const fh = await dir.getFileHandle(name, { create: true });
  const w = await fh.createWritable();
  await w.write(blob); await w.close();
}
const urlCache = new Map(); // cache key -> object URL, kept for the session so the grid does not flicker
const clipKey = (c) => (typeof c === 'string' ? c : (c?.driveId || c?.file || ''));
async function imageBlob(c) {
  const name = typeof c === 'string' ? c : (c?.file || '');
  const did = typeof c === 'string' ? '' : (c?.driveId || '');
  if (DEMO) {
    const st = await folderState();
    if (st.state !== 'ok' || !name) return null;
    try { return await (await st.dir.getFileHandle(name)).getFile(); } catch { return null; }
  }
  if (did) {
    const b = await driveDownloadBlob(did);
    if (b) return b;
  }
  if (name && gdriveToken()) {
    const found = await driveFindByName(name);
    if (found) {
      const b = await driveDownloadBlob(found);
      if (b) return b;
    }
  }
  if (name) {
    const ld = await legacyLocalDir();
    if (ld) try { return await (await ld.getFileHandle(name)).getFile(); } catch { /* ignore */ }
  }
  return null;
}
async function imageUrl(c) {
  const key = clipKey(c);
  if (!key) return null;
  if (urlCache.has(key)) return urlCache.get(key);
  const b = await imageBlob(c);
  if (!b) return null;
  const u = URL.createObjectURL(b);
  urlCache.set(key, u);
  return u;
}
const safe = (s) => String(s || '').replace(/[\\/:*?"<>|\s]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);

// ---------- sources ----------
// What Zotero (7–10) puts on the clipboard, checked in its source (reader.js, Note Markdown translator):
//  - copying SELECTED TEXT in the PDF: plain text only, no link;
//  - copying an ANNOTATION (highlight, or an area box made with 「选择区域」): Markdown with links, e.g.
//      [image] ([Huang et al., 2023, p. 4](zotero://select/library/items/QWER1234)) ([pdf](zotero://open-pdf/library/items/ZXCV5678?page=4&annotation=AAAA1111))
//    plus HTML whose data-annotation / data-citation attributes carry the article (title, authors, journal, year, DOI).
//  - an area annotation's picture is kept at <Zotero data folder>/cache/library/<annotation key>.png
const jsonAttr = (html, sel, attr) => {
  try {
    const el = new DOMParser().parseFromString(html, 'text/html').querySelector(sel);
    return el ? JSON.parse(decodeURIComponent(el.getAttribute(attr))) : null;
  } catch { return null; }
};
const cslRef = (d) => (d && d.title ? {
  title: String(d.title).replace(/<[^>]+>/g, '').trim(),
  authors: ((n) => (n.length > 2 ? `${n[0]} et al.` : n.join(', ')))((d.author || []).map((x) => x.family || x.literal || '').filter(Boolean)),
  journal: d['container-title-short'] || d['journal-abbreviation'] || d['container-title'] || '',
  year: String(d.issued?.['date-parts']?.[0]?.[0] || ''),
  doi: d.DOI || '',
} : null);
const looksHtml = (t) => /<(?:p|div|span|img|html|body)\b/i.test(t);
const htmlText = (t) => { try { return new DOMParser().parseFromString(t, 'text/html').body.textContent || ''; } catch { return t.replace(/<[^>]+>/g, ' '); } };
export function parseZotero(text, html = '') {
  let t = String(text || '');
  // Some note formats (e.g. a custom Obsidian translator) put HTML in the plain-text slot and drop the links.
  if (looksHtml(t)) { if (!html) html = t; t = htmlText(t); }
  const out = {};
  if (/zotero-note|citation-item|data-attachment-key/.test(html)) out.zcopy = true;
  const im = html.match(/<img\b[^>]*>/i);
  if (im && out.zcopy) { out.image = true; const w = im[0].match(/width="(\d+)"/); const hh = im[0].match(/height="(\d+)"/); if (w && hh) out.ratio = +w[1] / +hh[1]; }
  const pl = t.match(/,\s*(?:19|20)\d{2},\s*p\.\s*([\w-]+)/);
  if (pl) out.plabel = pl[1];
  const pdf = t.match(/zotero:\/\/open-pdf\/[^\s)\]"'>]+/);
  const sel = t.match(/zotero:\/\/select\/[^\s)\]"'>]+/);
  if (pdf) out.zotero = pdf[0]; else if (sel) out.zotero = sel[0];
  if (sel) out.zselect = sel[0];
  const pg = (pdf && pdf[0].match(/[?&]page=(\d+)/)) || (!pl && t.match(/\bp\.\s*(\d+)/));
  if (pg) out.page = pg[1];
  const ak = pdf && pdf[0].match(/[?&]annotation=([A-Z0-9]{8})/);
  if (ak) out.akey = ak[1];
  const lb = pdf && pdf[0].match(/open-pdf\/(library|groups\/\d+)\//);
  if (lb) out.zlib = lb[1];
  const cite = t.match(/\(\[?([^()[\]\n]+?),\s*((?:19|20)\d{2})/) || t.match(/\b([A-Z][A-Za-z'-]+(?: et al\.| and [A-Z][A-Za-z'-]+)?),?\s+((?:19|20)\d{2})\b/);
  if (cite) out.cite = `${cite[1].trim()} ${cite[2]}`;
  const fig = t.match(/\b(?:Fig(?:ure)?\.?|Scheme|Table)\s*S?\d+[a-z]?(?:[,–-]\s*[a-z])?/i);
  if (fig) out.fig = fig[0].replace(/^Figure/i, 'Fig.').replace(/^Fig\s/i, 'Fig. ');
  const quote = t.match(/[“"]([^”"]{4,})[”"]/);
  if (quote) out.caption = quote[1].trim();
  const doi = paperKey(t)?.doi; if (doi) out.doi = doi;
  if (/\[image\]/.test(t)) out.image = true;
  if (html && /data-annotation|data-citation/.test(html)) {
    const ann = jsonAttr(html, '[data-annotation]', 'data-annotation');
    if (ann) {
      if (/<img\b[^>]*data-annotation/.test(html)) out.image = true;
      if (ann.annotationKey) out.akey = ann.annotationKey;
      const m = String(ann.attachmentURI || ann.uri || '').match(/\/(users|groups)\/(?:local\/)?(\w+)\/items\/(\w+)$/);
      const pi = ann.position?.pageIndex;
      if (m) {
        out.zlib = m[1] === 'users' ? 'library' : `groups/${m[2]}`;
        if (!out.zotero || !/open-pdf/.test(out.zotero)) out.zotero = `zotero://open-pdf/${out.zlib}/items/${m[3]}${Number.isInteger(pi) ? `?page=${pi + 1}` : ''}${out.akey ? `${Number.isInteger(pi) ? '&' : '?'}annotation=${out.akey}` : ''}`;
      }
      if (Number.isInteger(pi) && !out.page) out.page = String(pi + 1);
      const ci = ann.citationItem;
      const ref = cslRef(ci?.itemData);
      if (ref) { out.ref = ref; if (ref.doi) out.doi = ref.doi; }
    }
    if (!out.ref) { const c = jsonAttr(html, '[data-citation]', 'data-citation'); const ref = cslRef(c?.citationItems?.[0]?.itemData); if (ref) { out.ref = ref; if (ref.doi) out.doi = ref.doi; } }
  }
  return out;
}

// ---------- the Zotero data folder (read only): pictures of area annotations ----------
const ZKEY = 'zotero-dir';
let zdirCache = null;
export async function zoteroState() {
  if (zdirCache) return { state: 'ok', dir: zdirCache };
  if (DEMO || !('showDirectoryPicker' in window)) return { state: 'unsupported' };
  const d = await kv.get(ZKEY).catch(() => null);
  if (!d) return { state: 'none' };
  const p = await d.queryPermission({ mode: 'read' }).catch(() => 'prompt');
  if (p === 'granted') { zdirCache = d; return { state: 'ok', dir: d }; }
  return { state: 'ask', dir: d };
}
export async function connectZotero() {
  let d = await kv.get(ZKEY).catch(() => null);
  if (d) { if ((await d.requestPermission({ mode: 'read' }).catch(() => 'denied')) === 'granted') { zdirCache = d; return d; } d = null; }
  try { d = await window.showDirectoryPicker({ id: 'zotero-data', mode: 'read' }); } catch { return null; }
  const has = async (n) => { try { await d.getFileHandle(n); return true; } catch { try { await d.getDirectoryHandle(n); return true; } catch { return false; } } };
  if (!(await has('zotero.sqlite')) && !(await has('cache'))) { toast('这不是 Zotero 数据文件夹：请选“个人文件夹 › Zotero”（里面有 zotero.sqlite）。'); return null; }
  await kv.set(ZKEY, d);
  zdirCache = d;
  return d;
}
// Tests stand in a folder from the browser's private storage.
export const useZoteroDirForTest = (d) => { zdirCache = d; };
// Zotero writes the picture a moment after the box is drawn, so look a few times.
async function zoteroImage(akey, zlib = 'library') {
  const st = await zoteroState();
  if (st.state !== 'ok' || !akey) return null;
  for (let i = 0; i < 6; i++) {
    try {
      let dir = await st.dir.getDirectoryHandle('cache');
      for (const part of zlib.split('/')) dir = await dir.getDirectoryHandle(part);
      return await (await dir.getFileHandle(`${akey}.png`)).getFile();
    } catch { await new Promise((r) => setTimeout(r, 700)); }
  }
  return null;
}
// No annotation key on the clipboard: take the newest picture Zotero wrote (the box just drawn), preferring one
// whose proportions match the copied <img width height>. Its file name is the annotation key.
async function newestZoteroImage(ratio) {
  const st = await zoteroState();
  if (st.state !== 'ok') return null;
  let lib;
  try { lib = await (await st.dir.getDirectoryHandle('cache')).getDirectoryHandle('library'); } catch { return null; }
  const found = [];
  for await (const [name, hd] of lib.entries()) {
    if (hd.kind !== 'file' || !/^[A-Z0-9]{8}\.png$/.test(name)) continue; // skips the "._" files exFAT disks add
    const f = await hd.getFile();
    if (Date.now() - f.lastModified < 30 * 60e3) found.push(f);
  }
  if (!found.length) return null;
  const dims = async (f) => { try { const v = new DataView(await f.slice(16, 24).arrayBuffer()); return v.getUint32(0) / v.getUint32(4); } catch { return 0; } };
  found.sort((a, b) => b.lastModified - a.lastModified);
  for (const f of found.slice(0, 8)) if (!ratio || Math.abs((await dims(f)) / ratio - 1) < 0.03) return { file: f, akey: f.name.slice(0, 8) };
  return null;
}
// Title, DOI and the PDF page come from the Zotero web API (Zotero's own local API refuses web pages).
// A read-only key, kept only in this browser like the GitHub token.
const ZAPI = 'labnote-zotero-api';
export const zoteroApi = () => { try { return JSON.parse(localStorage.getItem(ZAPI) || 'null'); } catch { return null; } };
async function zget(path) {
  const a = zoteroApi(); if (!a) return null;
  const r = await fetch(`https://api.zotero.org/users/${a.userID}/${path}`, { headers: { 'Zotero-API-Key': a.key, 'Zotero-API-Version': '3' } });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`Zotero ${r.status}`);
  return (await r.json()).data;
}
async function zlist(path) {
  const a = zoteroApi(); if (!a) return [];
  const r = await fetch(`https://api.zotero.org/users/${a.userID}/${path}`, { headers: { 'Zotero-API-Key': a.key, 'Zotero-API-Version': '3' } });
  if (!r.ok) throw new Error(`Zotero ${r.status}`);
  return (await r.json()).map((x) => x.data);
}
const byKeys = async (keys) => {
  const out = [];
  keys = [...new Set(keys)];
  for (let i = 0; i < keys.length; i += 50) out.push(...await zlist(`items?itemKey=${keys.slice(i, i + 50).join(',')}&limit=50`));
  const seen = new Set();
  return out.filter((x) => keys.includes(x.key) && !seen.has(x.key) && seen.add(x.key)); // each asked-for item once
};
// What was read in Zotero from `from` (a local Date) on: a paper counts as read once it has a highlight, note or box
// made in that time. Zotero only reports what it has synced. Kept for ten minutes so redraws do not ask again.
// -> { papers: [{ key, title, who, journal, doi, n, last }], notes, added, days: [7 counts], at }
export async function readingStats(from, { fresh = false, to = null } = {}) {
  if (!zoteroApi()) return null;
  const ck = `labnote-reading:${from.toISOString().slice(0, 10)}`;
  if (!fresh) try { const c = JSON.parse(sessionStorage.getItem(ck) || 'null'); if (c && Date.now() - c.at < 10 * 60e3) return c; } catch { /* no cache */ }
  const since = from.toISOString(); const until = (to || new Date(from.getTime() + 7 * 864e5)).toISOString();
  const anns = [];
  for (let start = 0; start < 1000; start += 100) {
    const page = await zlist(`items?itemType=annotation&sort=dateAdded&direction=desc&limit=100&start=${start}`);
    anns.push(...page.filter((x) => x.dateAdded >= since && x.dateAdded < until));
    if (page.length < 100 || page.some((x) => x.dateAdded < since)) break;
  }
  const days = Array(7).fill(0);
  for (const x of anns) { const k = Math.floor((new Date(x.dateAdded) - from) / 864e5); if (k >= 0 && k < 7) days[k] += 1; }
  const perAtt = new Map();
  for (const x of anns) { const g = perAtt.get(x.parentItem) || { n: 0, last: '' }; g.n += 1; if (x.dateAdded > g.last) g.last = x.dateAdded; perAtt.set(x.parentItem, g); }
  const atts = await byKeys([...perAtt.keys()].filter(Boolean));
  const perPaper = new Map(); // parent key (or the attachment itself when it has no parent)
  for (const at of atts) {
    const g = perAtt.get(at.key); const k = at.parentItem || at.key;
    const cur = perPaper.get(k) || { key: k, n: 0, last: '', title: at.parentItem ? '' : (at.title || at.filename || '') };
    cur.n += g.n; if (g.last > cur.last) cur.last = g.last; perPaper.set(k, cur);
  }
  // An attachment Zotero would not return still counts as one paper read.
  for (const [k, g] of perAtt) if (k && !atts.some((x) => x.key === k)) perPaper.set(k, { key: k, n: g.n, last: g.last, title: '' });
  for (const it of await byKeys(atts.map((x) => x.parentItem).filter(Boolean))) {
    const cur = perPaper.get(it.key); if (!cur) continue;
    const n = (it.creators || []).map((c) => c.lastName || c.name || '').filter(Boolean);
    Object.assign(cur, { title: it.title || '', who: [n[0] ? `${n[0]}${n.length > 1 ? ' 等' : ''}` : '', String(it.date || '').match(/\d{4}/)?.[0] || ''].filter(Boolean).join(' '), journal: it.journalAbbreviation || it.publicationTitle || '', doi: it.DOI || '' });
  }
  const top = await zlist('items/top?sort=dateAdded&direction=desc&limit=100');
  const added = top.filter((x) => x.dateAdded >= since && x.dateAdded < until && !['attachment', 'note', 'annotation'].includes(x.itemType)).length;
  const out = { papers: [...perPaper.values()].sort((a, b) => b.last.localeCompare(a.last)), notes: anns.length, added, days, at: Date.now() };
  try { sessionStorage.setItem(ck, JSON.stringify(out)); } catch { /* private window */ }
  return out;
}
// annotation key -> { zotero link, page, page label, ref }; null if the annotation has not synced yet.
export async function resolveAnnotation(akey) {
  const an = await zget(`items/${akey}`).catch(() => null);
  if (!an?.parentItem) return null;
  let pi = null; try { pi = JSON.parse(an.annotationPosition || '{}').pageIndex; } catch { /* no position */ }
  const out = { akey, zotero: `zotero://open-pdf/library/items/${an.parentItem}${Number.isInteger(pi) ? `?page=${pi + 1}&` : '?'}annotation=${akey}` };
  if (Number.isInteger(pi)) out.page = String(pi + 1);
  if (an.annotationPageLabel) out.plabel = an.annotationPageLabel;
  const att = await zget(`items/${an.parentItem}`).catch(() => null);
  const it = att?.parentItem ? await zget(`items/${att.parentItem}`).catch(() => null) : null;
  if (it) {
    const n = (it.creators || []).filter((c) => c.creatorType === 'author' || !c.creatorType).map((c) => c.lastName || c.name || '').filter(Boolean);
    out.ref = { title: it.title || '', authors: n.length > 2 ? `${n[0]} et al.` : n.join(', '), journal: it.journalAbbreviation || it.publicationTitle || '', year: String(it.date || '').match(/\d{4}/)?.[0] || '', doi: it.DOI || '' };
  }
  return out;
}
export function connectZoteroApi(after) {
  const cur = zoteroApi();
  const key = h('input', { id: 'za-key', type: 'password', autocomplete: 'off', placeholder: '粘贴 Zotero API key' });
  modal({ title: '连接 Zotero 账号（只读）', body: h('div', { class: 'form' },
    h('p', null, '用途：根据 Zotero 里的框，自动查出文章题目、期刊、DOI，以及“在 Zotero 打开第 N 页”的链接。只需做一次。'),
    h('ol', { class: 'za-steps' },
      h('li', null, '点这个链接打开 Zotero 网站（会要求登录你的 Zotero 账号 qianyuw）：', h('a', { href: 'https://www.zotero.org/settings/keys/new', target: '_blank', rel: 'noopener' }, 'zotero.org › 新建 API key')),
      h('li', null, '「Key Description」随便写，例如 LabNotebook。'),
      h('li', null, '「Personal Library」只勾 ', h('b', null, 'Allow library access'), '；其他都不勾（只读）。'),
      h('li', null, '拉到最下面点「Save Key」，复制页面上显示的那串 key。'),
      h('li', null, '回到这里，粘贴到下面的框，点「连接」。')),
    h('label', { for: 'za-key' }, 'API key'), key,
    h('p', { class: 'muted small' }, cur ? `已连接（用户 ${cur.userID}）。重新粘贴会替换。` : 'key 只存在这台电脑的浏览器里，不进 GitHub，不发给别处。')),
  buttons: [cur ? { label: '断开', danger: true, run: () => { try { localStorage.removeItem(ZAPI); } catch { /* ignore */ } toast('已断开 Zotero 账号。'); } } : null, { label: '取消' }, { label: '连接', primary: true, run: async () => {
    const k = key.value.trim(); if (!k) { toast('先粘贴 key。'); return false; }
    try {
      const r = await fetch('https://api.zotero.org/keys/current', { headers: { 'Zotero-API-Key': k, 'Zotero-API-Version': '3' } });
      if (!r.ok) { toast('这个 key 无效，请检查是否复制完整。'); return false; }
      const j = await r.json();
      if (!j.access?.user?.library) { toast('这个 key 没有勾选 Allow library access。'); return false; }
      localStorage.setItem(ZAPI, JSON.stringify({ key: k, userID: j.userID }));
      toast('Zotero 账号已连接。'); after?.();
    } catch { toast('连不上 Zotero 网站，请检查网络。'); return false; }
  } }] });
}
// zotero://open-pdf with the page the figure is on.
export function zoteroHref(src) {
  const z = src?.zotero; if (!z) return '';
  if (!/open-pdf/.test(z) || !src.page || /[?&]page=/.test(z)) return z;
  return `${z}${z.includes('?') ? '&' : '?'}page=${src.page}`;
}
export function srcLine(src) {
  if (!src) return '';
  const r = src.ref;
  const who = r ? [String(r.authors || '').split(/[ ,]/)[0], r.year].filter(Boolean).join(' ') : src.cite || '';
  return [who, r?.journal, src.fig, src.page ? `PDF 第 ${src.page} 页` : src.plabel ? `p. ${src.plabel}` : ''].filter(Boolean).join(' · ');
}
const readingList = async () => ((await loadPlanner().catch(() => ({ tasks: [] }))).tasks || []).filter((x) => x.cat === '文献');
const taskLabel = (x) => (x.ref ? `${x.keys || paperKeywords(x.ref.title) || x.ref.title} — ${String(x.ref.authors || '').split(/[ ,]/)[0]} ${x.ref.year || ''}` : x.text).slice(0, 90);
// Links a clip to a reading-list entry by DOI, or by first author + year.
function matchTask(list, src) {
  const doi = (src.doi || src.ref?.doi || '').toLowerCase();
  if (doi) { const t = list.find((x) => x.ref?.doi?.toLowerCase() === doi || paperKey(x.text)?.doi?.toLowerCase() === doi); if (t) return t; }
  const m = String(src.cite || '').match(/^([A-Za-z'-]+).*?((?:19|20)\d{2})$/);
  if (m) return list.find((x) => x.ref && String(x.ref.authors || '').toLowerCase().startsWith(m[1].toLowerCase()) && String(x.ref.year) === m[2]) || null;
  return null;
}

// 0.5 pt (≈ 0.18 mm): line widths and sizes in notes show the other unit too.
export function unitHints(text) {
  return String(text || '').replace(/(\d+(?:\.\d+)?)\s*(pt|mm)\b(?!\s*[（(]≈)/g, (all, n, u) => {
    const v = parseFloat(n); if (u === 'mm' && v > 3) return all; // only thin lines in mm; page sizes stay as written
    const o = u === 'pt' ? `${(v * 0.3528).toFixed(v * 0.3528 < 1 ? 2 : 1)} mm` : `${(v / 0.3528).toFixed(v / 0.3528 < 10 ? 2 : 1)} pt`;
    return `${all}（≈${o}）`;
  });
}

// ---------- the library page ----------
const ALL = '';
const UNSORTED = '__none__';
export async function viewClips(cat = ALL, params = new URLSearchParams()) {
  const [clips, reading, fs] = await Promise.all([loadClips(), readingList(), folderState()]);
  const paper = params.get('paper') || '';
  const pTask = paper ? reading.find((x) => x.id === paper) : null;
  const sc = styleSyncConfig();
  const cats = new Map();
  for (const c of clips) for (const k of c.cats || []) cats.set(k, (cats.get(k) || 0) + 1);
  if (!DEMO && sc.styleCats.length) {
    const primaryStyleCat = sc.styleCats[0];
    if (![...cats.keys()].some((k) => k.toLowerCase() === primaryStyleCat.toLowerCase())) cats.set(primaryStyleCat, 0);
  }
  const catList = [...cats].sort((a, b) => a[0].localeCompare(b[0], 'zh'));
  const unsorted = clips.filter((c) => !(c.cats || []).length).length;
  const q = h('input', { type: 'search', placeholder: '搜索：标题、笔记、作者、Fig.', 'aria-label': '搜索素材' });
  const grid = h('div', { class: 'clip-grid' });
  const inCat = (c) => (cat === ALL ? true : cat === UNSORTED ? !(c.cats || []).length : (c.cats || []).includes(cat));
  const draw = () => {
    const t = q.value.trim().toLowerCase();
    const hit = sortClips(clips.filter((c) => inCat(c) && (!paper || c.src?.task === paper)
      && (!t || `${c.id} ${c.title} ${c.note} ${(c.cats || []).join(' ')} ${srcLine(c.src)} ${c.src?.ref?.title || ''} ${c.src?.caption || ''}`.toLowerCase().includes(t))));
    grid.replaceChildren(...(hit.length ? hit.map((c) => clipTile(c, fs)) : [h('div', { class: 'tile clip-empty' },
      h('p', null, clips.length ? '这里没有符合条件的素材。' : '素材库还是空的。'),
      h('p', { class: 'muted' }, '在 Zotero 的 PDF 里按 ⌥5（选择区域）框住一张图 → ⌘C → 回到这里按 ⌘V，图片和出处一起进来。也可以点“记一条文字”记下 template 框线、作图参数这类杂项。'))]));
  };
  q.addEventListener('input', draw);
  draw();
  const catBtn = (key, label, n) => h('a', { class: `clip-cat${cat === key && !paper ? ' on' : ''}`, href: key === ALL ? '#/clips' : `#/clips/${encodeURIComponent(key)}` }, h('span', null, label), h('b', null, String(n)));
  const side = h('nav', { class: 'clip-cats', 'aria-label': '分类' },
    catBtn(ALL, '全部', clips.length), ...catList.map(([k, n]) => catBtn(k, k, n)), unsorted ? catBtn(UNSORTED, '未分类', unsorted) : null);
  const folderBar = fs.state === 'ok' ? null : h('div', { class: `clip-folder st-${fs.state}` },
    fs.mode === 'gdrive'
      ? [h('p', null, fs.state === 'none'
        ? `尚未填写 Google OAuth Client ID：配置一次后，图片自动存进 03_LabNotebook_Clips${sc.styleCats.length ? `，归入「${sc.styleCats[0]}」分类的图会自动同步到风格投递箱` : ''}。`
        : '点一下授权 Google Drive，即可同步最新图片并上传新图（已加载过的图片会直接从本地缓存显示）。'),
      h('div', { class: 'clip-folder-act' },
        fs.state === 'ask' ? h('button', { class: 'btn small ghost', type: 'button', onclick: () => connectGoogleDrive(() => route({ quiet: true })) }, '修改设置') : null,
        h('button', { class: 'btn primary small', type: 'button', onclick: async () => {
          if (fs.state === 'none') connectGoogleDrive(() => route({ quiet: true }));
          else if (await connectFolder()) route({ quiet: true });
        } }, icon('attach', 16), fs.state === 'none' ? '填写 OAuth Client ID 并连接' : '授权 Google Drive'))]
      : fs.state === 'unsupported'
        ? h('p', null, '这个浏览器不能读取电脑上的文件夹，所以只显示文字和出处。')
        : [h('p', null, '先选一个存图片的文件夹。'),
          h('button', { class: 'btn primary small', type: 'button', onclick: async () => { if (await connectFolder()) route({ quiet: true }); } }, icon('attach', 16), '选择文件夹')]);
  const pendingStyle = (!DEMO && sc.styleCats.length)
    ? clips.filter((c) => c.kind === 'img' && matchesStyleSyncCat(c.cats, sc) && !c.styleDriveId && (c.driveId || c.file))
    : [];
  const styleBar = (!DEMO && isStyleInboxCategory(cat, sc)) ? h('div', { class: 'clip-folder clip-style-bar' },
    h('p', null, pendingStyle.length
      ? `本分类有 ${pendingStyle.length} 张图尚未同步到 Google Drive 风格投递箱（00_Style_Inbox）。`
      : `本分类（${cat}）中的新图保存时会自动复制一份到 Google Drive 风格投递箱（00_Style_Inbox）。`),
    h('div', { class: 'clip-folder-act' },
      h('a', { class: 'btn small ghost', href: `https://drive.google.com/drive/folders/${encodeURIComponent(sc.styleFolderId)}`, target: '_blank', rel: 'noopener' }, '打开 00_Style_Inbox'),
      pendingStyle.length ? h('button', { class: 'btn primary small', type: 'button', onclick: async (e) => {
        if (!gdriveConfig()) { connectGoogleDrive(() => route({ quiet: true })); return; }
        e.currentTarget.disabled = true;
        try {
          const res = await syncStyleInboxClips(clips);
          toast(res.synced ? `已同步 ${res.synced} 张图到 00_Style_Inbox${res.failed ? `（${res.failed} 张失败）` : ''}。`
            : res.failed ? '同步到 00_Style_Inbox 失败，请重试。' : '没有可同步的云端图片（请确认图片已上传到 Google Drive）。');
          if (res.synced) route({ quiet: true });
        } catch (err) { toast(err.message || '同步失败。'); } finally { e.currentTarget.disabled = false; }
      } }, icon('sync', 16), `立即同步 (${pendingStyle.length})`) : null)) : null;
  const fileIn = h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: (e) => { const f = e.target.files?.[0]; if (f) editClip(null, { image: f, cat: realCat(cat), task: paper }); e.target.value = ''; } });
  const realCat = (k) => (k === ALL || k === UNSORTED ? '' : k);
  // ⌘V anywhere on this page (outside text fields) starts a new clip with the pasted picture or Zotero text.
  const onPaste = (e) => {
    if (view.kind !== 'clips' || document.querySelector('.modal-root')) return;
    if (e.target.closest?.('input, textarea, [contenteditable="true"]')) return;
    const img = [...(e.clipboardData?.files || [])].find((f) => f.type.startsWith('image/'));
    const text = e.clipboardData?.getData('text/plain') || '';
    const html = e.clipboardData?.getData('text/html') || '';
    if (!img && !text.trim()) return;
    e.preventDefault();
    if (img) return editClip(null, { image: img, cat: realCat(cat), task: paper });
    if (/zotero:\/\/|data-annotation|zotero-note|citation-item/.test(text + html)) return editClip(null, { text, html, cat: realCat(cat), task: paper });
    editClip(null, { kind: 'note', noteText: text.trim(), cat: realCat(cat) });
  };
  document.removeEventListener('paste', window.__clipPaste || (() => {}));
  window.__clipPaste = onPaste;
  document.addEventListener('paste', onPaste);
  completeSources(clips);
  const pinnedCount = clips.filter((c) => c.pinned).length;
  const title = pTask ? `素材库 · ${pTask.ref ? (pTask.keys || paperKeywords(pTask.ref.title)) : pTask.text}` : cat === ALL ? '素材库' : cat === UNSORTED ? '素材库 · 未分类' : `素材库 · ${cat}`;
  return h('div', { class: 'view clips' },
    topbar({ back: cat !== ALL || paper ? '#/clips' : '#/', backLabel: cat !== ALL || paper ? '素材库' : '首页', title,
      sub: `${pinnedCount ? `置顶 ${pinnedCount} · ` : ''}${clips.filter((c) => c.kind === 'img').length} 张图 · ${clips.filter((c) => c.kind !== 'img').length} 条文字 · Zotero 里 ⌥5 框图 → ⌘C → 这里 ⌘V`,
      actions: [
        !DEMO ? h('button', { class: 'btn ghost', type: 'button', title: '填写 OAuth Client ID、授权或配置 00_Style_Inbox 自动同步', onclick: () => connectGoogleDrive(() => route({ quiet: true })) }, icon('sync', 16), h('span', null, fs.state === 'ok' ? 'Drive ✓' : 'Drive 设置')) : null,
        h('button', { class: 'btn ghost', type: 'button', title: '连接 Zotero 账号：自动补全题目、DOI 和跳回原页的链接', onclick: () => connectZoteroApi(() => route({ quiet: true })) }, icon('book', 16), h('span', { class: 'wide-only' }, zoteroApi() ? 'Zotero ✓' : '连接 Zotero')),
        h('button', { class: 'btn', type: 'button', onclick: () => editClip(null, { kind: 'note', cat: realCat(cat) }) }, icon('note', 18), h('span', null, '记一条文字')),
        (!DEMO || fs.state !== 'unsupported') ? h('button', { class: 'btn primary', type: 'button', onclick: () => fileIn.click() }, icon('plus', 18), h('span', null, '加图片')) : null].filter(Boolean) }),
    demoBanner(),
    h('div', { class: 'clip-wrap' }, folderBar, styleBar,
      pTask ? h('p', { class: 'clip-paper' }, h('span', { class: 'm-art-kicker' }, '文献'), pTask.ref ? `${pTask.ref.title}（${[pTask.ref.authors, pTask.ref.journal, pTask.ref.year].filter(Boolean).join(' · ')}）` : pTask.text, ' ', h('a', { href: '#/clips' }, '看全部'), pTask.why ? h('span', { class: 'clip-why' }, `　为什么读：${pTask.why}`) : null) : null,
      h('div', { class: 'clip-layout' }, side, h('div', null, h('div', { class: 'search-row' }, q), grid)), fileIn));
}

export async function copyText(text) {
  const str = String(text ?? '');
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(str);
      return true;
    }
  } catch { /* fallback below */ }
  const prev = document.activeElement;
  let ta = null;
  try {
    ta = h('textarea', {
      value: str,
      readonly: true,
      'aria-hidden': 'true',
      tabindex: '-1',
      style: { position: 'fixed', top: '0', left: '0', width: '1px', height: '1px', padding: '0', border: '0', opacity: '0', fontSize: '16px', pointerEvents: 'none' },
    });
    document.body.append(ta);
    ta.focus({ preventScroll: true });
    ta.select();
    ta.setSelectionRange(0, str.length);
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    ta?.remove();
    if (prev && prev !== document.body && prev.isConnected) prev.focus?.({ preventScroll: true });
  }
}

function clipTile(c, fs) {
  const img = c.kind === 'img';
  const fallbackMsg = fs.mode === 'gdrive'
    ? (fs.state === 'ok' ? '图片文件找不到' : '授权 Google Drive 后加载')
    : (fs.state === 'ok' ? '图片文件找不到' : '图片在本地文件夹里');
  const box = h('div', { class: 'clip-thumb' }, img ? h('span', { class: 'muted small' }, fallbackMsg) : null);
  if (img) imageUrl(c).then((u) => { if (u) box.replaceChildren(h('img', { src: u, alt: c.title || '', loading: 'lazy' })); });
  const rawPreview = img ? '' : unitHints(c.note);
  const chars = Array.from(rawPreview);
  const previewText = chars.length > 220 ? `${chars.slice(0, 220).join('').trimEnd()}…` : rawPreview;
  return h('button', { type: 'button', class: `tile clip-tile${img ? '' : ' clip-note'}${c.pinned ? ' is-pinned' : ''}`, onclick: () => openClip(c.id) },
    img ? box : h('p', { class: 'clip-note-text' }, previewText),
    h('div', { class: 'clip-cap' },
      h('b', null, c.pinned ? h('span', { class: 'clip-pin-tag', 'aria-label': '已置顶', html: `${PIN_SVG}<span>置顶</span>` }) : null, c.title || (img ? '未命名图' : '未命名')),
      srcLine(c.src) ? h('span', { class: 'clip-src' }, srcLine(c.src)) : null,
      (c.cats || []).length ? h('span', { class: 'clip-tags' }, c.cats.join(' · ')) : null));
}

export async function openClip(id) {
  const c = (await loadClips()).find((x) => x.id === id);
  if (!c) return toast(`没有素材 ${id}。`);
  const big = h('div', { class: 'clip-big' });
  if (c.kind === 'img') {
    const u = await imageUrl(c);
    const st = await folderState();
    big.append(u ? h('img', { src: u, alt: c.title || '' }) : h('p', { class: 'muted' }, st.state === 'ok' ? `找不到图片：${c.file || c.driveId || ''}` : '点上方「授权 Google Drive」后即可加载图片。'));
  }
  const s = c.src || {};
  const zh = zoteroHref(s);
  const doi = s.ref?.doi || s.doi;
  const driveHref = c.driveId ? `https://drive.google.com/file/d/${encodeURIComponent(c.driveId)}/view` : '';
  const styleHref = c.styleDriveId ? `https://drive.google.com/file/d/${encodeURIComponent(c.styleDriveId)}/view` : '';
  const body = h('div', { class: 'clip-detail' }, big,
    (c.cats || []).length ? h('p', { class: 'clip-tags' }, c.cats.map((k) => h('a', { href: `#/clips/${encodeURIComponent(k)}`, onclick: () => document.querySelectorAll('.modal-root').forEach((m) => m.close?.()) }, k))) : null,
    c.note ? h('p', { class: 'clip-note-full' }, unitHints(c.note)) : null,
    s.ref || s.cite || zh || doi || driveHref || styleHref ? h('div', { class: 'clip-source' },
      h('span', { class: 'm-art-kicker' }, '出处'),
      s.ref?.title ? h('p', null, h('b', null, s.ref.title)) : null,
      h('p', { class: 'muted' }, [s.ref?.authors || s.cite, s.ref?.journal, s.ref?.year, s.fig, s.page ? `第 ${s.page} 页` : ''].filter(Boolean).join(' · ')),
      s.caption ? h('p', { class: 'muted small' }, `“${s.caption}”`) : null,
      h('div', { class: 'clip-src-act' },
        zh ? h('a', { class: 'btn small primary', href: zh }, icon('book', 16), s.page && /open-pdf/.test(zh) ? `在 Zotero 打开第 ${s.page} 页` : '在 Zotero 打开') : null,
        doi ? h('a', { class: 'btn small', href: `https://doi.org/${doi}`, target: '_blank', rel: 'noopener' }, 'DOI') : null,
        driveHref ? h('a', { class: 'btn small ghost', href: driveHref, target: '_blank', rel: 'noopener' }, 'Google Drive 原图') : null,
        styleHref ? h('a', { class: 'btn small ghost', href: styleHref, target: '_blank', rel: 'noopener' }, '00_Style_Inbox 副本') : null,
        (!DEMO && c.kind === 'img' && c.driveId && !c.styleDriveId && matchesStyleSyncCat(c.cats)) ? h('button', { class: 'btn small', type: 'button', onclick: async (e) => {
          const cfg = gdriveConfig();
          if (!cfg) { connectGoogleDrive(() => route({ quiet: true })); return; }
          e.currentTarget.disabled = true;
          try {
            const copyId = await driveCopyToFolder(c.driveId, cfg.styleFolderId, c.file || `${c.id}.png`);
            const next = structuredClone(c);
            next.styleDriveId = copyId;
            next.styleSyncedAt = nowISO();
            await saveClip(next, `Sync clip ${next.id} to 00_Style_Inbox`);
            toast(`${next.id} 已同步到 00_Style_Inbox。`);
            document.querySelectorAll('.modal-root').forEach((m) => m.close?.());
            route({ quiet: true });
          } catch (err) { toast(err.message || '同步到 00_Style_Inbox 失败。'); } finally { e.currentTarget.disabled = false; }
        } }, icon('sync', 16), '同步到 00_Style_Inbox') : null,
        s.task ? h('a', { class: 'btn small ghost', href: `#/clips?paper=${s.task}`, onclick: () => document.querySelectorAll('.modal-root').forEach((m) => m.close?.()) }, '这篇的所有素材') : null))
      : h('p', { class: 'muted small' }, '没有记出处。'),
    h('p', { class: 'muted small' }, `${c.id}${c.pinned ? ' · 已置顶' : ''}${c.styleDriveId ? ' · 已同步 00_Style_Inbox' : ''}${c.file ? ` · ${c.file}` : ''}`));
  const hasNote = !!(c.note && String(c.note).trim());
  const dlg = modal({ title: c.title || c.id, wide: true, body, buttons: [
    { label: '删除', danger: true, run: async () => { if (await deleteClip(c)) { dlg.close(); route({ quiet: true }); } return false; } },
    { label: c.pinned ? '取消置顶' : '置顶', run: async () => {
      const next = structuredClone(c);
      if (next.pinned) delete next.pinned; else next.pinned = true;
      try {
        await saveClip(next, `${next.pinned ? 'Pin' : 'Unpin'} clip ${next.id}`);
        toast(next.pinned ? `${next.id} 已置顶。` : `${next.id} 已取消置顶。`);
        dlg.close();
        route({ quiet: true });
      } catch (e) { toast(saveError(e)); }
      return false;
    } },
    hasNote ? { label: c.kind === 'img' ? '复制备注' : '复制全文', run: async () => {
      toast(await copyText(c.note) ? '已复制到剪贴板。' : '浏览器不允许自动复制，请手动选中复制。');
      return false;
    } } : null,
    c.kind === 'img' ? { label: '复制图片', run: async () => {
      const b = await imageBlob(c); if (!b) { toast('读不到图片文件。'); return false; }
      try { const png = b.type === 'image/png' ? b : await toPng(b); await navigator.clipboard.write([new window.ClipboardItem({ 'image/png': png })]); toast('图片已复制，可以粘贴到 PPT / Word。'); } catch { toast('浏览器不允许复制图片。'); }
      return false;
    } } : null,
    { label: '修改', primary: true, run: () => { setTimeout(() => editClip(c), 0); } }] });
}
async function toPng(blob) {
  const bmp = await createImageBitmap(blob);
  const cv = document.createElement('canvas'); cv.width = bmp.width; cv.height = bmp.height;
  cv.getContext('2d').drawImage(bmp, 0, 0);
  return new Promise((r) => cv.toBlob(r, 'image/png'));
}
async function deleteClip(c) {
  const st = await folderState();
  const opts = [['rec', '只删记录（图片保留在云端）'], ['no', '取消']];
  if (c.kind === 'img' && (c.driveId || (DEMO && st.state === 'ok'))) opts.splice(1, 0, ['both', DEMO ? '记录和图片文件都删' : '记录和 Google Drive 图片都删']);
  const a = await choose(`删除 ${c.id}？`, '记录删除后，GitHub 历史里还能找回；Google Drive 图片删掉后会移入回收站（保留 30 天）。', opts);
  if (!a || a === 'no') return false;
  try {
    await lib.commit(`Delete clip ${c.id}`, async () => ({ changes: [{ path: clipPath(c.id), delete: true }] }));
    if (a === 'both') {
      if (DEMO && st.dir && c.file) await st.dir.removeEntry(c.file).catch(() => {});
      else if (c.driveId) await driveTrash(c.driveId);
      urlCache.delete(clipKey(c));
    }
    toast(`${c.id} 已删除。`); return true;
  } catch (e) { toast(saveError(e)); return false; }
}

// ---------- add / edit ----------
const LAST_SRC = 'labnote-clip-src';
const lastSrc = () => { try { return JSON.parse(localStorage.getItem(LAST_SRC) || 'null'); } catch { return null; } };
export async function editClip(c, { image = null, text = '', html = '', noteText = '', kind = 'img', cat = '', task = '' } = {}) {
  const isNew = !c;
  const x = c ? structuredClone(c) : { kind: image ? 'img' : kind, cats: cat ? [cat] : [], src: {} };
  const [all, reading] = await Promise.all([loadClips(), readingList()]);
  let pic = image;
  const preview = h('div', { class: 'clip-drop' });
  const showPic = (f) => {
    pic = f; x.kind = 'img';
    const u = URL.createObjectURL(f); view.urls.push(u);
    preview.replaceChildren(h('img', { src: u, alt: '' }));
  };
  if (x.kind === 'img') {
    if (pic) showPic(pic);
    else if (x.driveId || x.file) imageUrl(x).then((u) => preview.replaceChildren(u ? h('img', { src: u, alt: '' }) : h('span', { class: 'muted' }, x.file || x.driveId)));
    else preview.append(dropHint());
  }
  function dropHint(msg) {
    return h('div', { class: 'clip-drop-hint' },
      msg ? h('p', { class: 'clip-warn' }, msg) : null,
      h('p', null, h('b', null, '最简单：'), '在 Zotero 按 ⌥5（选择区域）框住这张图 → ⌘C → 在这里 ⌘V，图片和出处一起进来'),
      h('p', { class: 'muted small' }, '或者截图后 ⌘V，或把图片拖进来。'));
  }
  // An area annotation copied from Zotero: fetch its picture from the Zotero folder.
  async function zoteroPic(akey, zlib, ratio) {
    if (pic || x.file) return;
    let st = await zoteroState();
    if (st.state === 'unsupported') return;
    const load = async () => {
      preview.replaceChildren(h('span', { class: 'muted' }, '正在从 Zotero 取图…'));
      let f = akey ? await zoteroImage(akey, zlib) : null;
      if (!f && !akey) { const n = await newestZoteroImage(ratio); if (n) { f = n.file; akey = n.akey; } }
      if (f) { showPic(new File([f], `${akey}.png`, { type: 'image/png' })); s.akey = akey; fillFromApi(akey); }
      else preview.replaceChildren(dropHint(akey ? 'Zotero 里没找到这条标注的图片——只有「选择区域」(⌥5) 画出的框才有图（高亮、文字没有）。可以截图后 ⌘V。' : '在 Zotero 文件夹里没找到刚画的框。请确认：用的是 ⌥5 画的框，并且选的是 Zotero 的数据文件夹（Zotero 设置 › 高级 › 文件和文件夹 › 数据存储位置）。'));
    };
    if (st.state === 'ok') return load();
    preview.replaceChildren(h('div', { class: 'clip-drop-hint' },
      h('p', null, '这是 Zotero 的区域标注。第一次需要允许读取 Zotero 文件夹，之后自动取图：'),
      h('button', { class: 'btn primary small', type: 'button', onclick: async () => { if (await connectZotero()) load(); } }, st.state === 'none' ? '选择 Zotero 数据文件夹' : '允许读取 Zotero 文件夹'),
      st.state === 'none' ? h('p', { class: 'muted small' }, '就是 Zotero 设置 › 高级 › 文件和文件夹 › 「数据存储位置」写的那个文件夹（里面有 zotero.sqlite）。') : null,
      h('p', { class: 'muted small' }, '只读，不会改动 Zotero 里的任何东西。')));
  }
  const title = h('input', { id: 'cl-title', value: x.title || '', placeholder: x.kind === 'img' ? '一句话说明，例如：垂直 OECT 截面结构' : '例如：Template 框线粗细' });
  // categories: chips of existing ones (click to toggle) + a free box for new ones
  const sc = styleSyncConfig();
  const picked = new Set(x.cats || []);
  const extraStyleCats = (!DEMO && x.kind === 'img' && sc.styleCats.length) ? [sc.styleCats[0]] : [];
  const known = [...new Set([...all.flatMap((y) => y.cats || []), ...extraStyleCats, ...picked])].sort((a, b) => a.localeCompare(b, 'zh'));
  const chips = h('div', { class: 'clip-chips' });
  const newCat = h('input', { id: 'cl-cat', placeholder: known.length ? '新分类，回车添加（可多个，逗号分隔）' : '分类，例如 v-OECTs结构、大鼠皮肤修复图、00_Style_Inbox（逗号分隔）' });
  const styleCatHint = (!DEMO && x.kind === 'img' && sc.styleCats.length)
    ? h('p', { class: 'muted small clip-hint' }, `勾选「${sc.styleCats[0]}」分类保存时，会自动复制一份到 Google Drive 风格投递箱（00_Style_Inbox），主图仍留在 03_LabNotebook_Clips。`)
    : null;
  const drawChips = () => chips.replaceChildren(...[...new Set([...known, ...picked])].map((k) => h('button', { type: 'button', class: `chip${picked.has(k) ? ' on' : ''}`, 'aria-pressed': String(picked.has(k)), onclick: () => { if (picked.has(k)) picked.delete(k); else picked.add(k); drawChips(); } }, k)));
  const addCats = () => { for (const k of newCat.value.split(/[,，、;；]/).map((s) => s.trim()).filter(Boolean)) { picked.add(k); if (!known.includes(k)) known.push(k); } newCat.value = ''; drawChips(); };
  newCat.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !isImeEvent(e)) { e.preventDefault(); addCats(); } });
  newCat.addEventListener('blur', addCats);
  drawChips();
  const initNote = x.note || noteText || '';
  const noteRows = x.kind === 'img' ? 3 : Math.min(14, Math.max(6, initNote.split('\n').length + 1));
  const note = h('textarea', { id: 'cl-note', rows: noteRows, placeholder: x.kind === 'img' ? '可选：为什么存这张，打算怎么用' : '例如：Nature 模板：框线 0.5 pt，坐标字号 7 pt，图宽单栏 89 mm / 双栏 183 mm' }, initNote);
  const pin = h('input', { id: 'cl-pin', type: 'checkbox' });
  pin.checked = !!x.pinned;
  const hint = h('p', { class: 'muted small clip-hint' });
  const drawHint = () => { const t = unitHints(note.value); hint.textContent = t !== note.value ? `换算：${(t.match(/\d+(?:\.\d+)?\s*(?:pt|mm)（≈[^）]+）/g) || []).join('；')}` : ''; };
  note.addEventListener('input', drawHint); drawHint();
  // source
  const s = { ...(x.src || {}) };
  if (isNew && !text) { const l = lastSrc(); if (l && Date.now() - (l.at || 0) < 6 * 3600e3) Object.assign(s, { ...l.src, fig: '', page: '', caption: '' }); }
  if (isNew && task) s.task = task;
  const zbox = h('textarea', { id: 'cl-z', rows: 2, class: 'mono-area', placeholder: '在 Zotero 里点选这张图的标注（框或高亮）→ ⌘C → 粘贴到这里' }, s.zotero || '');
  const fig = h('input', { id: 'cl-fig', value: s.fig || '', placeholder: 'Fig. 3b' });
  const page = h('input', { id: 'cl-page', value: s.page || '', placeholder: '5', inputmode: 'numeric' });
  const doi = h('input', { id: 'cl-doi', value: s.ref?.doi || s.doi || '', placeholder: 'DOI 或文章链接（可选，用来查题目和期刊）' });
  const tsel = h('select', { id: 'cl-task' }, h('option', { value: '' }, '（不关联）'), reading.map((t) => h('option', { value: t.id, selected: t.id === s.task }, `${t.done ? '✓ ' : ''}${taskLabel(t)}`)));
  const srcInfo = h('p', { class: 'muted small' });
  const srcWarn = h('p', { class: 'clip-warn', hidden: true });
  const drawInfo = () => {
    const r = s.ref;
    srcInfo.textContent = [r ? `✓ ${[String(r.authors || '').split(/[ ,]/)[0], r.year, r.journal].filter(Boolean).join(' ')}${r.title ? `：${r.title.slice(0, 70)}` : ''}` : s.cite ? `✓ ${s.cite}` : '', s.zotero ? '✓ Zotero 链接' : '', s.plabel ? `p. ${s.plabel}` : '', s.caption ? `“${s.caption.slice(0, 60)}”` : ''].filter(Boolean).join(' · ');
  };
  // Fills title, DOI, PDF page and the Zotero link from the web API (if connected).
  const apiInfo = h('p', { class: 'muted small' });
  async function fillFromApi(akey) {
    s.akey = akey;
    if (!zoteroApi()) { apiInfo.replaceChildren('想自动补全题目、DOI 和「在 Zotero 打开」链接？', h('button', { class: 'btn small ghost', type: 'button', onclick: () => connectZoteroApi(() => fillFromApi(akey)) }, '连接 Zotero 账号（一次）')); return; }
    apiInfo.textContent = '正在向 Zotero 查这篇文章…';
    const r = await resolveAnnotation(akey).catch(() => null);
    if (!r) { apiInfo.textContent = 'Zotero 还没同步这个框（通常 1 分钟内）。先保存也行，之后打开素材库会自动补全出处。'; return; }
    apiInfo.textContent = '';
    s.zotero = r.zotero; zbox.value = r.zotero; srcWarn.hidden = true;
    if (r.page) page.value = r.page;
    if (r.plabel) s.plabel = r.plabel;
    if (r.ref) { s.ref = r.ref; if (r.ref.doi) doi.value = r.ref.doi; }
    const m = matchTask(reading, { ...s, doi: doi.value });
    if (m && !tsel.value) tsel.value = m.id;
    drawInfo();
  }
  const absorb = (t, html = '') => {
    const z = parseZotero(t, html);
    if (!Object.keys(z).length) return false;
    if (z.zotero) { s.zotero = z.zotero; zbox.value = z.zotero; srcWarn.hidden = true; }
    if (z.ref) { s.ref = z.ref; if (z.ref.doi) doi.value = z.ref.doi; }
    if ((z.akey || z.zcopy) && x.kind === 'img') zoteroPic(z.akey || '', z.zlib || 'library', z.ratio);
    else if (z.akey && !z.ref) fillFromApi(z.akey);
    if (z.plabel) s.plabel = z.plabel;
    if (z.page) page.value = z.page;
    if (z.fig && !fig.value) fig.value = z.fig;
    if (z.cite) s.cite = z.cite;
    if (z.caption) { s.caption = z.caption; if (!title.value) { const t = z.caption.replace(/^(?:Fig(?:ure)?\.?|Scheme)\s*S?\d+[a-z]?\.?\s*/i, ''); title.value = t.length > 60 ? `${t.slice(0, 60).replace(/\s+\S*$/, '')}…` : t.replace(/\.$/, ''); } }
    if (z.doi && !doi.value) doi.value = z.doi;
    const m = matchTask(reading, { ...s, doi: doi.value });
    if (m && !tsel.value) { tsel.value = m.id; if (m.ref && !doi.value) doi.value = m.ref.doi || ''; }
    drawInfo();
    return true;
  };
  // Only a Zotero link replaces what is in the box; any other text is pasted as it is (and kept as the caption).
  const NO_LINK = '这段文字里没有 Zotero 链接：在 Zotero 里复制“选中的文字”时，Zotero 不附带链接。请改为点选那条标注（框或高亮）再 ⌘C。';
  zbox.addEventListener('paste', (e) => {
    const t = e.clipboardData?.getData('text/plain') || ''; const hm = e.clipboardData?.getData('text/html') || '';
    if (/zotero:\/\/|data-annotation/.test(t + hm)) { e.preventDefault(); absorb(t, hm); return; }
    if (t.trim()) { srcWarn.textContent = NO_LINK; srcWarn.hidden = false; const z = parseZotero(t); if (z.fig && !fig.value) fig.value = z.fig; if (!s.caption) s.caption = t.trim().slice(0, 200); drawInfo(); }
  });
  zbox.addEventListener('change', () => { if (/zotero:\/\//.test(zbox.value)) absorb(zbox.value); });
  tsel.addEventListener('change', () => { const t = reading.find((y) => y.id === tsel.value); if (t?.ref?.doi) doi.value = t.ref.doi; });
  if (text || html) absorb(text, html);
  drawInfo();
  const lbl = (f, t) => h('label', { for: f }, t);
  const form = h('div', { class: 'form clip-form' },
    x.kind === 'img' ? preview : null,
    lbl('cl-title', '标题'), title,
    h('label', { class: 'check', for: 'cl-pin' }, pin, '置顶显示（固定排在素材库最前面）'),
    h('span', { class: 'label' }, '分类（可多选；点一下选中/取消）'), chips, newCat, styleCatHint,
    lbl('cl-note', x.kind === 'img' ? '备注' : '内容'), note, hint,
    h('details', { class: 'clip-src-box', open: x.kind === 'img' },
      h('summary', null, '出处（溯源回文献）'),
      lbl('cl-z', 'Zotero 标注（点选标注 → ⌘C → 粘贴）'), zbox, srcWarn, srcInfo, apiInfo,
      h('div', { class: 'pair' }, h('div', null, lbl('cl-fig', '图号'), fig), h('div', null, lbl('cl-page', 'PDF 页码'), page)),
      lbl('cl-task', '对应「文献待读」里的哪篇'), tsel,
      lbl('cl-doi', 'DOI'), doi));
  // paste / drop a picture into the dialog (focus may be anywhere while it is open)
  const onP = (e) => {
    if (e.defaultPrevented) return;
    const f = [...(e.clipboardData?.files || [])].find((y) => y.type.startsWith('image/'));
    if (f) { e.preventDefault(); showPic(f); return; }
    const t = e.clipboardData?.getData('text/plain') || ''; const hm = e.clipboardData?.getData('text/html') || '';
    if (/zotero:\/\/|data-annotation/.test(t + hm) && e.target !== note && e.target !== title) { e.preventDefault(); absorb(t, hm); }
  };
  document.addEventListener('paste', onP);
  form.addEventListener('dragover', (e) => e.preventDefault());
  form.addEventListener('drop', (e) => { const f = [...(e.dataTransfer?.files || [])].find((y) => y.type.startsWith('image/')); if (f) { e.preventDefault(); showPic(f); } });
  modal({ title: isNew ? (x.kind === 'img' ? '存一张图' : '记一条文字') : `修改 ${x.id}`, wide: true, body: form, onClose: () => document.removeEventListener('paste', onP), buttons: [{ label: '取消' }, {
    label: '保存', primary: true, run: async () => {
      addCats();
      if (x.kind === 'img' && !pic && !x.file && !x.driveId) { toast('先粘贴一张图（⌘V）。'); return false; }
      if (x.kind !== 'img' && !note.value.trim() && !title.value.trim()) { toast('写点内容。'); return false; }
      const zv = zbox.value.trim();
      const src = { ...s, zotero: /^zotero:\/\//.test(zv) ? zv : '', caption: s.caption || (zv && !/^zotero:/.test(zv) ? zv.slice(0, 200) : ''), fig: fig.value.trim(), page: page.value.trim().replace(/\D/g, ''), task: tsel.value };
      const d = doi.value.trim(); const key = paperKey(d)?.doi || '';
      if (key && key.toLowerCase() !== String(src.ref?.doi || '').toLowerCase()) {
        const t = reading.find((y) => y.id === src.task);
        src.ref = (t?.ref && String(t.ref.doi).toLowerCase() === key.toLowerCase() ? t.ref : await lookupPaper(key).catch(() => null)) || src.ref;
        src.doi = key;
      } else if (!d) { delete src.doi; if (src.ref && !src.task) delete src.ref; }
      if (!src.ref && src.task) { const t = reading.find((y) => y.id === src.task); if (t?.ref) src.ref = t.ref; }
      for (const k of Object.keys(src)) if (src[k] === '' || src[k] == null) delete src[k];
      if (isNew) { x.id = nextId(); x.created = nowISO(); }
      Object.assign(x, { title: title.value.trim(), cats: [...picked], note: note.value.trim(), src });
      if (pin.checked) x.pinned = true; else delete x.pinned;
      if (pic) {
        const ext = (pic.type.split('/')[1] || 'png').replace('jpeg', 'jpg').replace('svg+xml', 'svg');
        const who = src.ref ? `${String(src.ref.authors || '').split(/[ ,]/)[0]}${src.ref.year || ''}` : (src.cite || '').replace(/ et al\./, '');
        const name = [x.id, safe(x.cats[0]), safe(who), safe(src.fig)].filter(Boolean).join('_') + `.${ext}`;
        if (DEMO) {
          let st = await folderState();
          if (st.state !== 'ok') { const dir = await connectFolder(); if (!dir) { toast('图片需要存进图片文件夹。'); return false; } st = { dir }; }
          try { await writeImage(st.dir, name, pic); } catch (e) { toast(`图片没写进文件夹：${e.message}`); return false; }
          if (x.file && x.file !== name) await st.dir.removeEntry(x.file).catch(() => {});
          urlCache.delete(x.file);
        } else {
          if (!gdriveConfig()) {
            toast('先连接 Google Drive，图片将自动同步到云端。');
            connectGoogleDrive();
            return false;
          }
          try {
            const newId = await driveUpload(name, pic, x.driveId || '');
            urlCache.delete(x.driveId || x.file);
            x.driveId = newId;
          } catch (e) {
            toast(e.message || '图片上传 Google Drive 失败。');
            return false;
          }
        }
        x.file = name; urlCache.delete(clipKey(x));
        try { const bmp = await createImageBitmap(pic); x.w = bmp.width; x.h = bmp.height; } catch { /* size is optional */ }
      }
      let styleSyncedNow = false;
      let styleSyncErr = '';
      if (!DEMO && x.kind === 'img') {
        const cfg = gdriveConfig();
        const wantsStyle = !!(cfg && matchesStyleSyncCat(x.cats, cfg) && cfg.styleFolderId && cfg.styleFolderId !== cfg.folderId);
        if (wantsStyle && !x.driveId && x.file && gdriveToken()) {
          const found = await driveFindByName(x.file);
          if (found) x.driveId = found;
        }
        if (wantsStyle && x.driveId && (pic || !x.styleDriveId)) {
          try {
            x.styleDriveId = await driveCopyToFolder(x.driveId, cfg.styleFolderId, x.file || `${x.id}.png`);
            x.styleSyncedAt = nowISO();
            styleSyncedNow = true;
          } catch (e) {
            if (pic) { delete x.styleDriveId; delete x.styleSyncedAt; }
            styleSyncErr = e.message || '同步失败';
          }
        }
      }
      try {
        await saveClip(x, `${isNew ? 'Add' : 'Update'} clip ${x.id}`);
        if (src.ref || src.zotero || src.cite) try { localStorage.setItem(LAST_SRC, JSON.stringify({ at: Date.now(), src })); } catch { /* private window */ }
        toast(styleSyncedNow
          ? `${x.id} 已存好（已同步到 Google Drive 及 00_Style_Inbox）。`
          : styleSyncErr
            ? `${x.id} 已存入主库，但同步到 00_Style_Inbox 失败：${styleSyncErr}（可在分类页点「立即同步」重试）。`
            : `${x.id} 已存好${x.kind === 'img' ? (DEMO ? '（图片已存好）' : '（图片已同步到 Google Drive）') : ''}。`);
        route({ quiet: true });
      } catch (e) { toast(saveError(e)); return false; }
    },
  }] });
  setTimeout(() => { if (title.isConnected && !title.closest('.modal')?.contains(document.activeElement)) title.focus(); }, 60);
}

// Clips saved before Zotero synced the box get their article and link filled in later, in one commit.
let completing = false;
async function completeSources(clips) {
  const todo = clips.filter((c) => c.src?.akey && !c.src.zotero);
  if (completing || !todo.length || !zoteroApi()) return;
  completing = true;
  try {
    const done = [];
    for (const c of todo.slice(0, 12)) {
      const r = await resolveAnnotation(c.src.akey).catch(() => null);
      if (!r) continue;
      const src = { ...c.src, zotero: r.zotero, ...(r.page ? { page: r.page } : {}), ...(r.plabel ? { plabel: r.plabel } : {}), ...(r.ref ? { ref: r.ref, doi: r.ref.doi || c.src.doi } : {}) };
      if (!src.doi) delete src.doi;
      done.push({ ...c, src, updated: nowISO() });
    }
    if (done.length) {
      await lib.commit(`Clips: sources from Zotero (${done.length})`, async () => ({ changes: done.map((c) => ({ path: clipPath(c.id), data: `${JSON.stringify(c, null, 1)}\n` })) }));
      toast(`已从 Zotero 补全 ${done.length} 张图的出处。`);
      if (view.kind === 'clips') requestQuietRoute({ immediate: true, views: ['clips'] });
    }
  } finally { completing = false; }
}

// For the reading list: how many clips each entry has.
export async function clipCounts() {
  const m = new Map();
  for (const c of await loadClips().catch(() => [])) if (c.src?.task) m.set(c.src.task, (m.get(c.src.task) || 0) + 1);
  return m;
}

// ----- 本周读过的文献: its own page, asked from Zotero only when opened -----
export async function viewReading(param) {
  const t = todayISO();
  const wk = weekStart(/^\d{4}-\d{2}-\d{2}$/.test(param || '') ? param : t);
  const from = new Date(`${wk}T00:00:00${ZONE}`);
  const body = h('div', { class: 'rd-body' }, h('p', { class: 'muted' }, '正在向 Zotero 查询…'));
  const load = async (fresh) => {
    if (!zoteroApi()) {
      body.replaceChildren(h('div', { class: 'tile' }, h('p', null, '连接 Zotero 账号后，这里列出这一周读过的文献。'),
        h('button', { class: 'btn primary', type: 'button', onclick: () => connectZoteroApi(() => load(true)) }, '连接 Zotero（只读，一次）')));
      return;
    }
    let r; let tasks = [];
    try { [r, tasks] = await Promise.all([readingStats(from, { fresh }), loadPlanner().then((d) => d.tasks).catch(() => [])]); } catch (e) { body.replaceChildren(h('div', { class: 'tile' }, h('p', { class: 'warn' }, `没连上 Zotero：${e.message}`))); return; }
    const wait = tasks.filter((x) => x.cat === '文献' && !x.done && x.ref?.doi);
    const max = Math.max(1, ...r.days);
    const stat = (n, label) => h('div', { class: 'ws' }, h('b', null, String(n)), h('span', null, label));
    body.replaceChildren(
      h('div', { class: 'tile' },
        h('div', { class: 'week-stats' }, stat(r.papers.length, '篇读过（有批注）'), stat(r.notes, '条批注'), stat(r.added, '篇新入库')),
        h('div', { class: 'ws-days', 'aria-label': '每天的批注数' }, r.days.map((n, k) => h('div', { class: `ws-day${addDays(wk, k) === t ? ' is-today' : ''}`, title: `周${WEEKDAYS[k]}：${n} 条批注` },
          h('span', { class: 'ws-bar' }, h('span', { style: { height: `${(n / max) * 100}%` } })), h('span', { class: 'ws-dn' }, n ? String(n) : '·'), h('span', { class: 'ws-dw' }, WEEKDAYS[k])))),
        h('p', { class: 'muted small' }, '一篇文章算“读过”：这一周在它的 PDF 里做过高亮、下划线、笔记或框图。时间按东八区；Zotero 同步后才会出现。')),
      h('div', { class: 'tile' },
        h('h2', null, `读过的文献 ${r.papers.length}`),
        r.papers.length ? h('ul', { class: 'ws-papers rd-list' }, r.papers.map((p) => {
          const todo = p.doi ? wait.find((x) => x.ref.doi.toLowerCase() === p.doi.toLowerCase()) : null;
          const z = zoned(p.last);
          return h('li', null,
            h('a', { href: `zotero://select/library/items/${p.key}`, title: '在 Zotero 中打开' }, h('b', null, p.title || '（Zotero 没有返回题目）'), h('span', null, [p.who, p.journal, `最后批注 ${z.day.slice(5)} ${z.time}`].filter(Boolean).join(' · '))),
            todo ? h('button', { class: 'btn small ghost', type: 'button', title: '这篇在「文献待读」里：标为已读', onclick: async () => { await toggleTask(todo.id); load(false); } }, '待读 → 已读') : null,
            p.doi ? h('a', { class: 'btn small ghost', href: `https://doi.org/${p.doi}`, target: '_blank', rel: 'noopener' }, 'DOI') : null,
            h('span', { class: 'ws-pn', title: '这一周的批注数' }, String(p.n)));
        })) : h('p', { class: 'muted' }, '这一周没有新的批注。')));
  };
  load(false);
  return h('div', { class: 'view reading' },
    topbar({ back: '#/', backLabel: '首页', title: '读过的文献', sub: `${wk} 至 ${addDays(wk, 6)} · 东八区 · 来自 Zotero`, actions: [
      h('a', { class: 'btn ghost', href: `#/reading/${addDays(wk, -7)}` }, '‹ 上一周'),
      wk !== weekStart(t) ? h('a', { class: 'btn ghost', href: '#/reading' }, '本周') : null,
      wk < weekStart(t) ? h('a', { class: 'btn ghost', href: `#/reading/${addDays(wk, 7)}` }, '下一周 ›') : null,
      h('button', { class: 'btn', type: 'button', onclick: () => load(true) }, '刷新')] }),
    demoBanner(), h('div', { class: 'plan-wrap rd-wrap' }, body));
}
