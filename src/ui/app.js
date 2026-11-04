// 主分页：组装顶栏 / 提示条 / 状态卡 / 分页（月历、基本设置），负责储存、计时与导入导出。
import { snapshot } from '../calc.js';
import { HOLIDAYS_CN } from '../holidays-cn.js';
import { STORAGE_KEY, loadState, saveState, exportState, importState } from '../settings.js';
import { STRINGS } from '../strings.zh-CN.js';
import { h, show, setText } from './dom.js';
import { renderCard } from './card.js';
import { createSettingsPanel } from './settings-panel.js';
import { createCalendar } from './calendar-view.js';
import { createFloatControl } from './float-control.js';
import { createTabs } from './tabs.js';
import { createBanners } from './banners.js';
import { importReport, fieldLabel } from './import-model.js';
import { ymd } from './format.js';
import { HOLIDAYS_STORAGE_KEY } from '../holiday-store.js';
import { startHolidayUpdate } from './holiday-update.js';
import { createHolidayPanel } from './holiday-panel.js';
import { readTicks, isStall } from './pause-model.js';

const UI_KEY = `${STORAGE_KEY}-ui`; // 界面旗标（首次提示已关闭、备份提示已显示），与设置分开存放
const TICK_MS = 100;
const TICK_MS_REDUCED = 1000;
const TICK_MIN_DELAY_MS = 20;
const ANNOUNCE_MS = 60000;
// R34 / R42 / R43：只有真的停过才提示——两次 tick 之间超过 5 秒（单调时钟与墙上时钟取较大者，见 pause-model.js），
// 或 Page Lifecycle resume。单纯切走分页再回来（tick 照常）不提示。数字会一下子跳到当前时间：不打扰地提示一次，10 分钟内最多一次。
const PAUSE_NOTICE_EVERY_MS = 10 * 60 * 1000;

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
  // 当前使用的假期表（R16）：所有计算与月历都用它；替换请走 setTables()。
  let tables = HOLIDAYS_CN;
  let mounted = false;

  // ---- 提示层（spec §13.2：错误通道 + 信息通道）----
  const banners = createBanners(doc, t);
  const exportAction = { key: 'export', label: t.settings.backup.export, onClick: () => doExport() };
  const importAction = { key: 'import', label: t.settings.backup.import, onClick: () => fileInput.click() };
  // 储存失败：恢复前不可关闭，带导出 / 导入快捷按钮（这两个按钮已不在顶栏）
  const setStorageFail = (on) => banners.setError('storageFail', on ? t.banner.storageFail : null, { dismissible: false, actions: [exportAction, importAction] });
  // 已保存的设置损坏或部分字段无效：明确告知，不当作首次打开静默处理（spec §2 反目标）；可关闭
  const issueOf = (r) => (r.corrupt
    ? t.banner.loadCorrupt
    : r.dropped.length
      ? t.banner.loadPartial([...new Set(r.dropped.map((d) => fieldLabel(d.field, t)))])
      : null);
  const loadIssue = issueOf(loaded);
  let loadShown = null;
  const setLoadIssue = (issue) => {
    loadShown = issue;
    banners.setError('loadIssue', issue, {
      dismissible: true,
      actions: issue === t.banner.loadCorrupt ? [importAction] : [],
      onDismiss: () => { loadShown = null; },
    });
  };
  let hintShown = false;
  const reportPanel = h(doc, 'section', { class: 'import-report', hidden: true, 'aria-live': 'off' });

  // ---- 顶栏只留标题；「悬浮成小窗」在左栏状态卡下方（R38）----
  const cardRoot = h(doc, 'div', { id: 'status-card', 'data-size': 'lg' });
  const float = createFloatControl(doc, t, {
    cardRoot,
    onOpen: (pipWin) => moveTimer(pipWin),
    onClose: () => moveTimer(win),
    onFail: () => toast(t.float.failed),
  });
  const fileInput = h(doc, 'input', { type: 'file', accept: '.json,application/json', class: 'visually-hidden', tabindex: '-1', 'aria-hidden': 'true', onchange: onFile });
  const header = h(doc, 'header', { class: 'app-header' }, h(doc, 'h1', { text: t.appTitle }));

  // ---- 主区：左 状态卡｜右 分页「月历」「基本设置」----
  let holiday = null; // 下方建立；面板的回调在用户操作时才会用到
  const holidayPanel = createHolidayPanel(doc, t, {
    onCheck: () => holiday.checkNow(),
    onImportText: (text) => holiday.importFile(text),
    onCustomUrl: (value) => holiday.setCustomUrl(value),
  });
  const settings = createSettingsPanel(doc, t, {
    holiday: holidayPanel,
    getCfg: () => state.cfg,
    onChange: (cfg) => commit({ ...state, cfg }, true),
    onExport: () => doExport(),
    onImport: () => fileInput.click(),
    report: reportPanel,
    builtinYears: Object.keys(HOLIDAYS_CN).filter((y) => HOLIDAYS_CN[y].source === 'builtin'),
  });
  const calendar = createCalendar(doc, t, {
    getState: () => state,
    getTables: () => tables,
    getToday: clock,
    onMarks: (marks, msg, prevMarks) => {
      commit({ ...state, marks }, false);
      toast(msg, () => commit({ ...state, marks: prevMarks }, false));
    },
  });
  const calendarPanel = h(doc, 'div', { class: 'tabpanel tabpanel-calendar' }, calendar.el);
  const settingsPanel = h(doc, 'div', { class: 'tabpanel tabpanel-settings' }, settings.el);
  const tabs = createTabs(doc, {
    label: t.tabs.label,
    tabs: [
      { id: 'calendar', label: t.tabs.calendar, panel: calendarPanel },
      { id: 'settings', label: t.tabs.settings, panel: settingsPanel },
    ],
    initial: 'calendar',
    onChange: (id) => { if (id !== 'calendar') calendar.hideOverlays(); },
  });
  const openSettings = () => tabs.select('settings', { focus: true });

  const toastText = h(doc, 'span', { class: 'toast-text' });
  const toastUndo = h(doc, 'button', { type: 'button', class: 'toast-action', text: t.calendar.undo });
  const toastEl = h(doc, 'div', { class: 'toast', role: 'status', hidden: true }, toastText, toastUndo);
  const live = h(doc, 'div', { class: 'visually-hidden', role: 'status', 'aria-live': 'polite' });

  const app = doc.getElementById('app') ?? doc.body;
  app.replaceChildren(
    header,
    banners.root,
    h(doc, 'main', { class: 'shell' },
      h(doc, 'div', { class: 'card-col' }, h(doc, 'div', { class: 'card-slot', id: 'card-slot' }, cardRoot, float.placeholder), float.el),
      h(doc, 'div', { class: 'main-panel' }, tabs.root, calendarPanel, settingsPanel, settings.autosave)),
    fileInput,
    toastEl,
    live);

  if (firstRun && !ui.hintDismissed) {
    hintShown = true;
    banners.queueInfo('firstRun', t.banner.firstRun, {
      actions: [{ key: 'goFix', label: t.banner.goFix, link: true, onClick: openSettings }],
      onDismiss: dismissHint,
    });
  }
  if (loadIssue) setLoadIssue(loadIssue);

  // ---- 行为 ----
  let toastTimer = null;
  const pendingQuiet = []; // 不打扰的提示（例如自动获取了假期表）：撤销提示还在时排在它后面，不盖掉撤销
  function hideToast() {
    show(toastEl, false);
    if (pendingQuiet.length) toast(pendingQuiet.shift());
  }
  function toast(msg, undo) {
    setText(toastText, msg);
    show(toastUndo, Boolean(undo));
    toastUndo.onclick = undo ? () => { win.clearTimeout(toastTimer); hideToast(); undo(); } : null;
    show(toastEl, true);
    win.clearTimeout(toastTimer);
    toastTimer = win.setTimeout(hideToast, 5000);
  }
  // behindAny：连普通 toast 也不盖掉（暂停提示：最不重要，排在任何正在显示的 toast 后面）
  function quietToast(msg, behindAny = false) {
    if (!toastEl.hidden && (behindAny || !toastUndo.hidden)) {
      if (!pendingQuiet.includes(msg)) pendingQuiet.push(msg);
    } else toast(msg);
  }

  // 假期表换了（联网 / 导入 / 其他分页）：状态卡、月历、小窗都按新表重算（缺表标签随之消失）
  function setTables(next) {
    tables = next;
    if (!mounted) return;
    calendar.render();
    tick();
  }
  holiday = startHolidayUpdate({
    storage,
    clock,
    fetchImpl: (...a) => win.fetch(...a),
    getTables: () => tables,
    onTables: setTables,
    // info = 页面级、可关闭的提示（联网数据与内置表 / 导入的表不同）；success = 不打扰的 toast（不带「查看」）
    notify: (msg, kind, against) => (kind === 'info'
      ? banners.queueInfo(against === 'file' ? 'holidayDiffFile' : 'holidayDiff', msg)
      : quietToast(msg)),
    onStatus: holidayPanel.update,
  });
  holiday.reload(); // 开页：读取已保存的联网 / 导入假期表

  function dismissHint() {
    hintShown = false;
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
    setStorageFail(!storageOk);
    if (res.ok) {
      if (fromSettings) settings.flashSaved();
      if (!ui.backupNudged) {
        ui.backupNudged = true;
        banners.queueInfo('backupNudge', t.banner.backupNudge, {
          closable: false,
          actions: [exportAction, { key: 'ok', label: t.banner.ok, onClick: () => banners.dismissInfo('backupNudge') }],
        });
        requestPersist();
      }
    }
    if (hintShown) {
      hintShown = false;
      banners.dismissInfo('firstRun');
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

  // 导入报告放在「基本设置 › 数据与备份」组内：先切到该分页再聚焦标题
  function showReport(titleText, body, actions) {
    const title = h(doc, 'h3', { tabindex: '-1', text: titleText });
    reportPanel.replaceChildren(title, ...body, h(doc, 'div', { class: 'report-actions' }, actions));
    show(reportPanel, true);
    tabs.select('settings');
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
      firstField ? h(doc, 'button', { type: 'button', class: 'btn btn-ghost', text: t.importer.goFix, onclick: () => { closeReport(); tabs.select('settings'); settings.focusField(firstField); } }) : null,
    ]);
  }

  // ---- 页面暂停提示（R34）----
  const perf = win.performance;
  const readTick = readTicks(() => perf.now(), () => Date.now(), () => doc.visibilityState === 'hidden'); // 全域 Date，不是可注入的 clock
  let lastTick = null; // null = 还没 tick 过（第一次 tick 不提示）
  let skipGap = false; // 小窗开 / 关搬动计时器造成的间隔不算暂停
  let lastPauseNotice = -Infinity;
  let pausePending = false; // 分页隐藏时发现的暂停：回到前台再提示
  function notePaused() {
    if (lastTick === null) return;
    if (doc.visibilityState === 'hidden') {
      pausePending = true;
      return;
    }
    pausePending = false;
    const p = perf.now();
    if (p - lastPauseNotice < PAUSE_NOTICE_EVERY_MS) return;
    lastPauseNotice = p;
    quietToast(t.notice.paused, true);
  }
  function checkGap() {
    const cur = readTick();
    if (!skipGap && isStall(lastTick, cur)) notePaused();
    skipGap = false;
    lastTick = cur;
  }
  function onVisibility() {
    if (doc.visibilityState !== 'hidden' && pausePending) notePaused();
  }

  // ---- 计时 ----
  let lastDay = null;
  let lastStatus = null;
  let lastAnnounce = 0;
  function tick() {
    checkGap();
    const now = clock();
    const snap = { ...snapshot(now, state.cfg, state.marks, tables), now };
    const m = renderCard(cardRoot, snap, state.cfg, t);
    const day = ymd(now);
    if (day !== lastDay) {
      const crossed = lastDay !== null;
      lastDay = day; // 先记下：reload → setTables → tick 会再进来
      if (crossed) {
        calendar.render();
        holiday.reload(); // 跨日：状态行里的年份可能变了
      }
    }
    if (m.status !== lastStatus || now - lastAnnounce >= ANNOUNCE_MS) {
      setText(live, m.srSummary);
      lastStatus = m.status;
      lastAnnounce = now.getTime();
    }
  }

  // 计时器跑在状态卡所在的视窗：悬浮时改由 PiP 视窗的 setInterval 驱动（spec §3），收回后回到主视窗。
  // 减少动态（1 秒一跳，R46）：用自我校正的 setTimeout 对齐墙上时钟的整秒（下一次 = 1000 − Date.now() % 1000，至少 20 ms），
  // 倒数的秒数不会跳号或重复；一般模式（100 ms）仍用 setInterval，不变。Date.now 用全域时钟（与暂停侦测相同，不是可注入的 clock）。
  const mq = win.matchMedia ? win.matchMedia('(prefers-reduced-motion: reduce)') : null;
  let timerHost = win;
  let timer = null; // setInterval（一般模式）
  let aligned = null; // setTimeout（减少动态模式）
  function stop() {
    timerHost.clearInterval(timer);
    timerHost.clearTimeout(aligned);
    timer = null;
    aligned = null;
  }
  function alignedDelay() {
    return Math.max(TICK_MIN_DELAY_MS, TICK_MS_REDUCED - (Date.now() % TICK_MS_REDUCED));
  }
  function scheduleAligned() {
    const host = timerHost;
    aligned = host.setTimeout(() => {
      aligned = null;
      tick();
      if (host === timerHost && aligned === null && timer === null && mq && mq.matches) scheduleAligned();
    }, alignedDelay());
  }
  function start() {
    stop();
    if (mq && mq.matches) scheduleAligned();
    else timer = timerHost.setInterval(tick, TICK_MS);
  }
  function moveTimer(host) {
    skipGap = true;
    stop();
    timerHost = host;
    start();
    tick();
  }
  // 其他分页改了设置（或清空了储存）：重新读取并套用，不回写，避免两个分页互相覆盖（spec §2 反目标）
  function applyRemote() {
    const r = loadState(storage);
    state = r.state;
    storageOk = r.storageOk;
    setStorageFail(!storageOk);
    const issue = issueOf(r);
    // 新的问题照常显示；与开页时相同、且已被关闭的问题不再弹出
    setLoadIssue(issue && (issue !== loadIssue || loadShown !== null) ? issue : null);
    settings.sync(state.cfg);
    calendar.render();
    tick();
  }
  win.addEventListener('storage', (e) => {
    if (e.storageArea && e.storageArea !== storage) return;
    if (e.key === STORAGE_KEY || e.key === null) applyRemote();
    // 其他分页更新了假期数据：重新读取并刷新，不回写
    if (e.key === HOLIDAYS_STORAGE_KEY || e.key === null) holiday.reload();
  });

  mq?.addEventListener?.('change', start);
  doc.addEventListener('visibilitychange', onVisibility); // 先于 tick：同一次回来只提示一次
  doc.addEventListener('visibilitychange', tick);
  doc.addEventListener('resume', notePaused); // Page Lifecycle：从冻结恢复
  win.addEventListener('focus', tick);

  mounted = true;
  settings.sync(state.cfg);
  setStorageFail(!storageOk);
  calendar.render();
  tick();
  start();
  // 只有当年 / （11 月起的）下一年缺可信假期表、且今天还没检查过时才会联网（spec §12.3）
  holiday.autoCheckIfNeeded();

  // 齿轮只在小窗显示：先把开启者视窗带到前面（R45），再收回小窗（同按 X），再切到「基本设置」分页。
  // window.focus() 在小窗内的点击手势里调用时，Chrome 123+ 会把开启者分页 / 视窗带到前面
  // （https://developer.chrome.com/docs/web-platform/document-picture-in-picture 「Focus the opener window」）；
  // 必须同步、在任何 await 之前调用。不支持或抛例外时照常收回并切分页。
  cardRoot.querySelector('.card-gear').addEventListener('click', () => {
    try {
      win.focus();
    } catch {
      // 无法聚焦开启者：不影响后续
    }
    float.close();
    openSettings();
  });

  return {
    // 换用另一份假期表（例如合并了联网数据）：状态卡与月历立即按新表重算。
    setTables,
  };
}
