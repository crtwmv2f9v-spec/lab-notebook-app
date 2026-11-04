// Lab notebook: routing and start-up.
import { fitChartsForPrint, loadLib } from './render.js';
import { search } from './search.js';
import { DEMO, S, applyTheme, offerUpdate, lib, loadFonts, show, startLibrary, toast, view, viewMissing } from './core.js';
import { viewSettings, viewSetup } from './settings.js';
import { viewHome } from './home.js';
import { viewPlan, viewProjects } from './planner.js';
import { openNewExperiment, viewPage, viewSeries, viewVolume } from './pages.js';
import { viewEditor } from './editor.js';
import { viewHypothesis, viewThinking } from './think.js';
import { viewMethod, viewMethods } from './methods.js';
import { viewProtocol, viewProtocols, viewReagents, viewSolutions } from './libraries.js';
import { openSearch } from './searchui.js';

export async function boot() {
  applyTheme();
  loadFonts();
  if ('serviceWorker' in navigator && !DEMO && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    const had = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (had) offerUpdate(); });
    navigator.serviceWorker.register('sw.js').then((reg) => {
      // Look for a new version whenever the tab comes back, and every half hour.
      const check = () => reg.update().catch(() => {});
      document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
      setInterval(check, 30 * 60 * 1000);
    }).catch(() => {});
  }
  window.addEventListener('hashchange', route);
  window.addEventListener('online', () => lib?.refresh().then(() => lib.flush()));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && lib && Date.now() - (lib.status.at || 0) > 30000) lib.refresh().then(() => lib.flush());
  });
  window.addEventListener('labnote:toast', (e) => toast(e.detail));
  document.addEventListener('keydown', globalKeys);
  window.addEventListener('beforeprint', () => fitChartsForPrint(document, 680));
  window.addEventListener('afterprint', () => {
    fitChartsForPrint(document, null);
    document.body.classList.remove('print-volume');
    document.getElementById('print-root').replaceChildren();
  });
  if (!DEMO && !S.token) { route(); return; }
  try { await startLibrary(); } catch (e) { console.error(e); }
  route();
  // Fetch the chart library in the background so charts also draw offline.
  setTimeout(() => { loadLib('plotly').catch(() => {}); loadLib('papa').catch(() => {}); }, 4000);
}

export function globalKeys(e) {
  // Cmd/Ctrl+S never saves the web page: it presses the open dialog's 保存, or the editor's 保存.
  if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 's') {
    e.preventDefault();
    if (e.isComposing || e.repeat) return;
    const dlg = [...document.querySelectorAll('.modal-root')].pop();
    const btn = dlg ? dlg.querySelector('.modal-foot .btn.primary:not([disabled])') : document.querySelector('.ed-save:not([disabled])');
    btn?.click();
    return;
  }
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
  if ((e.key === '/' && !typing) || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k')) {
    if (!lib || document.querySelector('.modal-root')) return;
    e.preventDefault(); openSearch();
  }
  if (view.kind === 'page' && !typing && !document.querySelector('.modal-root')) {
    if (e.key === 'ArrowLeft') document.querySelector('[data-nav="prev"]')?.click();
    if (e.key === 'ArrowRight') document.querySelector('[data-nav="next"]')?.click();
  }
}

// ---------- routing ----------
export function parseHash() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, qs] = raw.split('?');
  return { parts: path.split('/').filter(Boolean).map(decodeURIComponent), params: new URLSearchParams(qs || '') };
}

export async function route(opts = {}) {
  const { parts, params } = parseHash();
  if (!DEMO && !S.token && parts[0] !== 'settings') return show('setup', viewSetup);
  if (!lib) return show('setup', viewSetup);
  const [a, b, c, d] = parts;
  if (!a) return show('home', viewHome, opts);
  if (a === 'settings') return show('settings', viewSettings);
  if (a === 'lib' && b === 'reagents') return show('library', () => viewReagents(params.get('q') || ''));
  if (a === 'lib' && b === 'solutions') return show('library', () => viewSolutions(params.get('q') || ''));
  if (a === 'lib' && b === 'protocols' && !c) return show('library', viewProtocols);
  if (a === 'lib' && b === 'protocols' && c) return show('library', () => viewProtocol(c));
  if (a === 'series' && b) return show('library', () => viewSeries(b));
  if (a === 'plan') return show('plan', () => viewPlan(b));
  if (a === 'methods') return show('methods', () => viewMethods(''));
  if (a === 'm' && b) return show('methods', () => viewMethod(b));
  if (a === 'v' && b && c === 'methods') return show('methods', () => viewMethods(b));
  if (a === 'think' && !b) return show('think', viewThinking);
  if (a === 'projects' || (a === 'think' && b === 'topics')) return show('projects', viewProjects);
  if (a === 'think' && b) return show('think', () => viewHypothesis(b));
  if (a === 'new-exp') { await show('home', viewHome, opts); openNewExperiment(params.get('vol') || ''); return; }
  if (a === 'search') { await show('home', viewHome, opts); openSearch(params.get('q') || ''); return; }
  if (a === 'v' && b && !c) return show('volume', () => viewVolume(b), opts);
  if (a === 'v' && b && c === 'new') return show('editor', () => viewEditor(b, null, params));
  if (a === 'v' && b && /^\d+$/.test(c) && d === 'edit') return show('editor', () => viewEditor(b, parseInt(c, 10), params));
  if (a === 'v' && b && /^\d+$/.test(c)) return show('page', () => viewPage(b, parseInt(c, 10), params), opts);
  return show('missing', () => viewMissing('这个地址在笔记本里找不到。'));
}

boot();
