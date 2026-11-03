// 主分页：组装顶栏 / 提示层 / 状态卡 / 设置 / 月历，负责储存、计时与导入导出。
import { snapshot } from '../calc.js';
import { STORAGE_KEY, loadState, saveState, exportState, importState } from '../settings.js';
import { STRINGS } from '../strings.zh-CN.js';
import { h, show, setText } from './dom.js';
import { renderCard } from './card.js';
import { createSettingsPanel } from './settings-panel.js';
import { createCalendar } from './calendar-view.js';
import { createFloatControl } from './float-control.js';
import { importReport, fieldLabel } from './import-model.js';
import { ymd } from './format.js';

const UI_KEY = `${STORAGE_KEY}-ui`; // 界面旗标（首次提示已关闭、备份提示已显示），与设置分开存放
const TICK_MS = 100;
const TICK_MS_REDUCED = 1000;
const ANNOUNCE_MS = 60000;

function readUi(storage) {
  try {
    const v = JSON.parse(storage.getItem(UI_KEY) ?? '{}');
    return { hintDismissed: v?.hintDismissed === true, backupNudged: v?.backupNudged === true };
  } catch {
    return { hintDismissed: false, backupNudged: false };
  }
}

function writeUi(storage, ui) {
  try {
    storage.setItem(UI_KEY, JSON.stringify(ui));
  } catch {
    // 储存不可用时由警告条告知，这里不重复处理
  }
}

export function mountApp(doc, storage, clock) {
  const t = STRINGS;
  const win = doc.defaultView;
  doc.title = t.appTitle;

  let firstRun = false;
  try {
    firstRun = storage.getItem(STORAGE_KEY) === null;
  } catch {
    firstRun = false;
  }
  const loaded = loadState(storage);
  let state = loaded.state;
  let storageOk = loaded.storageOk;
  const ui = readUi(storage);

  // ---- 提示层 ----
  const storageBanner = h(doc, 'p', { class: 'banner banner-error storage-banner', role: 'alert', hidden: true, text: t.banner.storageFail });
  // 已保存的设置损坏或部分字段无效：明确告知，不当作首次打开静默处理（spec §2 反目标）
  const loadIssue = loaded.corrupt
    ? t.banner.loadCorrupt
    : loaded.dropped.length
      ? t.banner.loadPartial([...new Set(loaded.dropped.map((d) => fieldLabel(d.field, t)))])
      : null;
  const loadBanner = h(doc, 'div', { class: 'banner banner-error load-banner', role: 'alert', hidden: !loadIssue },
    h(doc, 'span', { text: loadIssue ?? '' }),
    h(doc, 'button', { type: 'button', class: 'banner-close', 'aria-label': t.banner.dismiss, title: t.banner.dismiss, text: t.banner.closeGlyph, onclick: () => show(loadBanner, false) }));
  const hintBanner = h(doc, 'div', { class: 'banner banner-info hint-banner', hidden: !(firstRun && !ui.hintDismissed) },
    h(doc, 'span', { text: t.banner.firstRun }),
    h(doc, 'button', { type: 'button', class: 'banner-close', 'aria-label': t.banner.dismiss, title: t.banner.dismiss, text: t.banner.closeGlyph, onclick: dismissHint }));
  const backupBanner = h(doc, 'div', { class: 'banner banner-info backup-banner', role: 'status', hidden: true },
    h(doc, 'span', { text: t.banner.backupNudge }),
    h(doc, 'span', { class: 'banner-actions' },
      h(doc, 'button', { type: 'button', class: 'btn btn-secondary', text: t.header.export, onclick: doExport }),
      h(doc, 'button', { type: 'button', class: 'btn btn-ghost', text: t.banner.ok, onclick: () => show(backupBanner, false) })));
  const reportPanel = h(doc, 'section', { class: 'panel import-report', hidden: true, 'aria-live': 'off' });

  // ---- 顶栏 ----
  const cardRoot = h(doc, 'div', { id: 'status-card', 'data-size': 'lg' });
  const float = createFloatControl(doc, t, {
    cardRoot,
    onOpen: (pipWin) => moveTimer(pipWin),
    onClose: () => moveTimer(win),
    onFail: () => toast(t.float.failed),
  });
  const fileInput = h(doc, 'input', { type: 'file', accept: '.json,application/json', class: 'visually-hidden', tabindex: '-1', 'aria-hidden': 'true', onchange: onFile });
  const header = h(doc, 'header', { class: 'app-header' },
    h(doc, 'h1', { text: t.appTitle }),
    h(doc, 'div', { class: 'header-actions' },
      float.button,
      float.note,
      h(doc, 'button', { type: 'button', class: 'btn btn-secondary', id: 'btn-export', text: t.header.export, onclick: doExport }),
      h(doc, 'button', { type: 'button', class: 'btn btn-secondary', id: 'btn-import', text: t.header.import, onclick: () => fileInput.click() }),
      fileInput));

  // ---- 主区 ----
  const settings = createSettingsPanel(doc, t, { getCfg: () => state.cfg, onChange: (cfg) => commit({ ...state, cfg }, true) });
  const calendar = createCalendar(doc, t, {
    getState: () => state,
    getToday: clock,
    onMarks: (marks, msg, prevMarks) => {
      commit({ ...state, marks }, false);
      toast(msg, () => commit({ ...state, marks: prevMarks }, false));
    },
  });

  const toastText = h(doc, 'span', { class: 'toast-text' });
  const toastUndo = h(doc, 'button', { type: 'button', class: 'toast-action', text: t.calendar.undo });
  const toastEl = h(doc, 'div', { class: 'toast', role: 'status', hidden: true }, toastText, toastUndo);
  const live = h(doc, 'div', { class: 'visually-hidden', role: 'status', 'aria-live': 'polite' });

  const app = doc.getElementById('app') ?? doc.body;
  app.replaceChildren(
    header,
    h(doc, 'div', { class: 'notices' }, storageBanner, loadBanner, hintBanner, backupBanner, reportPanel),
    h(doc, 'main', { class: 'main-grid' }, h(doc, 'div', { class: 'card-slot', id: 'card-slot' }, cardRoot, float.placeholder), settings.el),
    calendar.el,
    toastEl,
    live);

  // ---- 行为 ----
  let toastTimer = null;
  function toast(msg, undo) {
    setText(toastText, msg);
    show(toastUndo, Boolean(undo));
    toastUndo.onclick = undo ? () => { show(toastEl, false); undo(); } : null;
    show(toastEl, true);
    win.clearTimeout(toastTimer);
    toastTimer = win.setTimeout(() => show(toastEl, false), 5000);
  }

  function dismissHint() {
    show(hintBanner, false);
    ui.hintDismissed = true;
    writeUi(storage, ui);
  }

  function requestPersist() {
    try {
      const p = win.navigator.storage?.persist?.();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch {
      // 浏览器不支援或拒绝：不影响功能（spec §7）
    }
  }

  function commit(next, fromSettings) {
    state = next;
    const res = saveState(storage, state);
    storageOk = res.ok;
    show(storageBanner, !storageOk);
    if (res.ok) {
      if (fromSettings) settings.flashSaved();
      if (!ui.backupNudged) {
        ui.backupNudged = true;
        show(backupBanner, true);
        requestPersist();
      }
    }
    if (!hintBanner.hidden) {
      show(hintBanner, false);
      ui.hintDismissed = true;
    }
    writeUi(storage, ui);
    calendar.render();
    tick();
  }

  function doExport() {
    const blob = new win.Blob([exportState(state)], { type: 'application/json' });
    const url = win.URL.createObjectURL(blob);
    const a = h(doc, 'a', { href: url, download: t.exporter.filename(ymd(clock())), class: 'visually-hidden' });
    doc.body.append(a);
    a.click();
    a.remove();
    win.setTimeout(() => win.URL.revokeObjectURL(url), 10000);
    toast(t.exporter.done);
  }

  function closeReport() {
    show(reportPanel, false);
    reportPanel.replaceChildren();
  }

  function showReport(titleText, body, actions) {
    const title = h(doc, 'h2', { tabindex: '-1', text: titleText });
    reportPanel.replaceChildren(title, ...body, h(doc, 'div', { class: 'report-actions' }, actions));
    show(reportPanel, true);
    title.focus();
  }

  async function onFile() {
    const file = fileInput.files && fileInput.files[0];
    fileInput.value = '';
    if (!file) return;
    let text;
    try {
      text = await file.text();
    } catch {
      text = '';
    }
    const res = importState(text, state);
    const okBtn = h(doc, 'button', { type: 'button', class: 'btn btn-secondary', text: t.importer.ok, onclick: closeReport });
    if (res.error) {
      showReport(t.importer.fail, [h(doc, 'p', { text: t.importer.failReason(res.error) })], [
        h(doc, 'button', { type: 'button', class: 'btn btn-primary', text: t.importer.retry, onclick: () => fileInput.click() }),
        okBtn,
      ]);
      return;
    }
    const report = importReport(JSON.parse(text), res, t);
    commit(res.state, false);
    settings.sync(state.cfg);
    if (report.rows.length === 0) {
      closeReport();
      toast(t.importer.success);
      return;
    }
    const cols = t.importer.cols;
    const table = h(doc, 'table', {},
      h(doc, 'thead', {}, h(doc, 'tr', {}, cols.map((c) => h(doc, 'th', { scope: 'col', text: c })))),
      h(doc, 'tbody', {}, report.rows.map((r) =>
        h(doc, 'tr', {}, h(doc, 'td', { text: r.label }), h(doc, 'td', { text: r.reason }), h(doc, 'td', { text: r.value })))));
    const firstField = report.rows.find((r) => r.field && !r.field.startsWith('marks'))?.field;
    showReport(report.title, [table], [
      okBtn,
      firstField ? h(doc, 'button', { type: 'button', class: 'btn btn-ghost', text: t.importer.goFix, onclick: () => { closeReport(); settings.focusField(firstField); } }) : null,
    ]);
  }

  // ---- 计时 ----
  let lastDay = null;
  let lastStatus = null;
  let lastAnnounce = 0;
  function tick() {
    const now = clock();
    const snap = { ...snapshot(now, state.cfg, state.marks), now };
    const m = renderCard(cardRoot, snap, state.cfg, t);
    const day = ymd(now);
    if (day !== lastDay) {
      if (lastDay !== null) calendar.render();
      lastDay = day;
    }
    if (m.status !== lastStatus || now - lastAnnounce >= ANNOUNCE_MS) {
      setText(live, m.srSummary);
      lastStatus = m.status;
      lastAnnounce = now.getTime();
    }
  }

  // 计时器跑在状态卡所在的视窗：悬浮时改由 PiP 视窗的 setInterval 驱动（spec §3），收回后回到主视窗。
  const mq = win.matchMedia ? win.matchMedia('(prefers-reduced-motion: reduce)') : null;
  let timerHost = win;
  let timer = null;
  function start() {
    timerHost.clearInterval(timer);
    timer = timerHost.setInterval(tick, mq && mq.matches ? TICK_MS_REDUCED : TICK_MS);
  }
  function moveTimer(host) {
    timerHost.clearInterval(timer);
    timer = null;
    timerHost = host;
    start();
    tick();
  }
  mq?.addEventListener?.('change', start);
  doc.addEventListener('visibilitychange', tick);
  win.addEventListener('focus', tick);

  settings.sync(state.cfg);
  show(storageBanner, !storageOk);
  calendar.render();
  tick();
  start();

  // 齿轮只在小窗显示：收回小窗（同按 X）并滚动到设置区，不依赖聚焦开启者视窗的 API（spec §4.2）
  cardRoot.querySelector('.card-gear').addEventListener('click', () => {
    float.close();
    settings.el.scrollIntoView({ block: 'start' });
  });
}
