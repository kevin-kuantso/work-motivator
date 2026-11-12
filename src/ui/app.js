// 主分页：组装顶栏 / 提示条 / 状态卡 / 分页（月历、基本设置），负责储存、计时与导入导出。
import { snapshot, reasonText } from '../calc.js';
import logo from '../logo.png';
import { STORAGE_KEY, defaultsFor, loadState, saveState, exportState, importState } from '../settings.js';
import { PROFILES } from '../profiles.js';
import { h, show, setText } from './dom.js';
import { renderCard, syncReferenceHeight } from './card.js';
import { createSettingsPanel } from './settings-panel.js';
import { createCalendar } from './calendar-view.js';
import { createFloatControl } from './float-control.js';
import { syncDocumentLook } from '../pip.js';
import { createTabs } from './tabs.js';
import { createBanners } from './banners.js';
import { importReport, fieldLabel } from './import-model.js';
import { ymd, money } from './format.js';
import { HOLIDAYS_STORAGE_KEY } from '../holiday-store.js';
import { startHolidayUpdate } from './holiday-update.js';
import { startHolidayUpdateTw } from './holiday-update-tw.js';
import { TW_HOLIDAYS_STORAGE_KEY } from '../holiday-store-tw.js';
import { createHolidayPanel } from './holiday-panel.js';
import { readTicks, isStall } from './pause-model.js';
import { createTicker } from './tick-scheduler.js';

const UI_KEY = `${STORAGE_KEY}-ui`; // 界面旗标（首次提示已关闭、备份提示已显示），与设置分开存放
const ANNOUNCE_MS = 60000;
// R34 / R42 / R43：只有真的停过才提示——两次 tick 之间超过 5 秒（单调时钟与墙上时钟取较大者，见 pause-model.js），
// 或 Page Lifecycle resume。单纯切走分页再回来（tick 照常）不提示。数字会一下子跳到当前时间：不打扰地提示一次，10 分钟内最多一次。
const PAUSE_NOTICE_EVERY_MS = 10 * 60 * 1000;
// 显示设置（设置 › 显示）：改了这些字段要立刻套用到主文件与小窗，不必等下一次 tick
const DISPLAY_FIELDS = ['fontScale', 'showCardProgress', 'showCardMetrics', 'showCardDate', 'showCardPayday', 'showCardCheer'];

// 小窗尺寸依字号保存；切换字号时清除目标档位的旧手动尺寸，重新采用默认尺寸。
const UI_SCALES = ['xs', 's', 'm', 'l', 'xl'];
function readSizes(v) {
  const out = {};
  if (!v || typeof v !== 'object') return out;
  for (const k of UI_SCALES) {
    const s = v[k];
    const width = Number(s?.width);
    const height = Number(s?.height);
    if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
      out[k] = { width: Math.round(width), height: Math.round(height) };
    }
  }
  return out;
}

function readUi(storage) {
  try {
    const v = JSON.parse(storage.getItem(UI_KEY) ?? '{}');
    return { hintDismissed: v?.hintDismissed === true, backupNudged: v?.backupNudged === true, winSizes: readSizes(v?.winSizes) };
  } catch {
    return { hintDismissed: false, backupNudged: false, winSizes: {} };
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
  let t;
  const win = doc.defaultView;
  // Profile is selected only after the saved state is read.

  let firstRun = false;
  try {
    firstRun = storage.getItem(STORAGE_KEY) === null;
  } catch {
    firstRun = false;
  }
  const loaded = loadState(storage);
  let state = loaded.state;
  let profile = PROFILES[state.region];
  t = profile.strings;
  let regionGeneration = 0;
  doc.title = t.appTitle;
  doc.documentElement.lang = profile.locale;
  const activeCfg = () => ({ ...state.cfg, salary: state.salaries[state.region], holidayProvider: profile.holidayProvider });
  const activeMarks = () => state.marksByRegion[state.region];
  const activeState = () => ({ cfg: activeCfg(), marks: activeMarks() });
  const changeCfg = (cfg) => {
    const { salary, holidayProvider, ...shared } = cfg;
    return { ...state, cfg: shared, salaries: { ...state.salaries, [state.region]: salary } };
  };
  const changeMarks = (marks) => ({ ...state, marksByRegion: { ...state.marksByRegion, [state.region]: marks } });
  let storageOk = loaded.storageOk;
  const ui = readUi(storage);
  doc.documentElement.dataset.theme = state.cfg.theme;
  // 当前使用的假期表（R16）：所有计算与月历都用它；替换请走 setTables()。
  let tables = profile.holidayProvider.tables;
  let mounted = false;

  // ---- 提示层（spec §13.2：错误通道 + 信息通道）----
  const banners = createBanners(doc, t);
  const exportAction = { key: 'export', label: (s) => s.settings.backup.export, onClick: () => doExport() };
  const importAction = { key: 'import', label: (s) => s.settings.backup.import, onClick: () => fileInput.click() };
  // 储存失败：恢复前不可关闭，带导出 / 导入快捷按钮（这两个按钮已不在顶栏）
  const setStorageFail = (on) => banners.setError('storageFail', on ? (s) => s.banner.storageFail : null, { dismissible: false, actions: [exportAction, importAction] });
  // 已保存的设置损坏或部分字段无效：明确告知，不当作首次打开静默处理（spec §2 反目标）；可关闭
  const issueOf = (r, strings = t) => (r.corrupt
    ? strings.banner.loadCorrupt
    : r.dropped.length
      ? strings.banner.loadPartial([...new Set(r.dropped.map((d) => fieldLabel(d.field, strings)))])
      : null);
  const loadIssue = issueOf(loaded);
  let loadShown = null;
  const setLoadIssue = (issue, source = loaded) => {
    loadShown = issue;
    banners.setError('loadIssue', issue ? (strings) => issueOf(source, strings) : null, {
      dismissible: true,
      actions: source.corrupt ? [importAction] : [],
      onDismiss: () => { loadShown = null; },
    });
  };
  let hintShown = false;
  const reportPanel = h(doc, 'section', { class: 'import-report', hidden: true, 'aria-live': 'off' });
  let reportResult = null;

  // ---- 顶栏只留标题；「悬浮成小窗」在左栏状态卡下方（R38）----
  const cardRoot = h(doc, 'div', { id: 'status-card', 'data-size': 'lg' });
  const float = createFloatControl(doc, t, {
    cardRoot,
    onOpen: (pipWin) => { pipWin.document.documentElement.dataset.theme = state.cfg.theme; pipWin.document.documentElement.lang = profile.locale; pipWin.document.documentElement.dataset.fontScale = state.cfg.fontScale ?? 'm'; pipWin.document.title = t.appTitle; moveTimer(pipWin); },
    onClose: () => moveTimer(win),
    onFail: () => toast((s) => s.float.failed),
    // 小窗尺寸按字号档位管理：目前档位、该档记住的尺寸、使用者拉动后记住
    getScale: () => state.cfg.fontScale ?? 'm',
    getSize: (scale) => ui.winSizes[scale] ?? null,
    rememberSize: (scale, size) => {
      ui.winSizes = { ...ui.winSizes, [scale]: size };
      writeUi(storage, ui);
    },
  });
  const fileInput = h(doc, 'input', { type: 'file', accept: '.json,application/json', class: 'visually-hidden', tabindex: '-1', 'aria-hidden': 'true', onchange: onFile });
  const header = h(doc, 'header', { class: 'app-header' },
    h(doc, 'img', { class: 'app-logo', src: logo, alt: '', width: 28, height: 28 }),
    h(doc, 'h1', { text: t.appTitle }));

  // ---- 主区：左 状态卡｜右 分页「月历」「基本设置」----
  let holiday = null; // 下方建立；面板的回调在用户操作时才会用到
  const holidayPanel = createHolidayPanel(doc, t, {
    onCheck: () => { if (state.region === 'CN') holiday.checkNow(); },
    onImportText: (text, readError) => holiday.importFile(text, readError),
    onCustomUrl: (value) => holiday.setCustomUrl?.(value),
    getOperationToken: () => regionGeneration,
    getRegion: () => state.region,
    profile,
  });
  const settings = createSettingsPanel(doc, t, {
    holiday: holidayPanel,
    getCfg: activeCfg,
    getRegion: () => state.region,
    onRegionChange: (region) => {
      if (region === state.region) return;
      clearUndo();
      commit({ ...state, region }, false);
      // 切区已提交：把新地区的月薪与共享偏好一起套回面板（旧地区的草稿月薪不跨区沿用）。
      settings.applyState(activeCfg(), region);
    },
    onChange: (cfg) => commit(changeCfg(cfg), true),
    onExport: () => doExport(),
    onImport: () => fileInput.click(),
    report: reportPanel,
    builtinYears: Object.keys(profile.holidayProvider.tables).filter((y) => profile.holidayProvider.tables[y].source === 'builtin'),
    profile,
  });
  const calendar = createCalendar(doc, t, {
    getState: activeState,
    getTables: () => tables,
    getToday: clock,
    onUndo: () => { win.clearTimeout(toastTimer); undoLatest(); },
    onMarks: (marks, msg, prevMarks) => {
      noteMarkChange(prevMarks, marks);
      const saved = commit(changeMarks(marks), false);
      // 没写进储存时仍给「撤销」（内存里的改动可以撤回），但不谎称已经标记好了
      toast(saved ? msg : (s) => s.calendar.unsaved(msg(s)), undoLatest);
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
    onChange: (id) => { if (id === 'calendar') calendar.refreshLayout(); else { calendar.hideOverlays(); settings.refreshFade(); } },
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
    // H1：文案里的数字取自当前（默认）设置，不写死
    banners.queueInfo('firstRun', (s) => s.banner.firstRun(`${profile.currency}${money(activeCfg().salary, 0, profile.locale)}`, state.cfg.start, state.cfg.end), {
      actions: [{ key: 'goFix', label: (s) => s.banner.goFix, onClick: openSettings }],
      onDismiss: dismissHint,
    });
  }
  if (loadIssue) setLoadIssue(loadIssue);

  // ---- 行为 ----
  let toastTimer = null;
  const pendingQuiet = []; // 不打扰的提示（例如自动获取了假期表）：撤销提示还在时排在它后面，不盖掉撤销
  // 撤销按钮只对「当前这一条」有效：token 变了旧按钮的回调就不再起作用（提示被打断、撤销记录被清掉时）
  let undoToken = 0;
  const pausedMessage = (strings) => strings.notice.paused;
  let toastMessage = null;
  const resolveMessage = (msg) => typeof msg === 'function' ? msg(t) : msg;
  function dismissToast() {
    undoToken += 1;
    toastMessage = null;
    show(toastEl, false);
    show(toastUndo, false);
    toastUndo.onclick = null;
  }
  function hideToast() {
    dismissToast();
    if (pendingQuiet.length) toast(pendingQuiet.shift());
  }
  function toast(msg, undo) {
    const token = (undoToken += 1);
    toastMessage = msg;
    setText(toastText, resolveMessage(msg));
    show(toastUndo, Boolean(undo));
    // 点「撤销」不经过 hideToast：排队的安静提示（例如暂停提醒）留给下一条，别被撤销回执顶掉
    toastUndo.onclick = undo ? () => { if (token !== undoToken) return; win.clearTimeout(toastTimer); dismissToast(); undo(); } : null;
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

  // ---- 月历标记的撤销 ----
  // 只记「哪几天从什么改成什么」，撤销时逐天恢复且只恢复现值仍等于当时新值的那几天：
  // 别的分页 / 导入已经改过的那天原样保留，不静默覆盖。
  const UNDO_MAX = 20;
  const undoStack = []; // 每项：[{ key, before, after }]（before/after 为 undefined 表示没有标记）
  const markValue = (marks, key) => (Object.hasOwn(marks, key) ? marks[key] : undefined);
  function markDiff(prev, next) {
    const keys = new Set([...Object.keys(prev), ...Object.keys(next)]);
    const diff = [];
    for (const key of keys) {
      const before = markValue(prev, key);
      const after = markValue(next, key);
      if (before !== after) diff.push({ key, before, after });
    }
    return diff;
  }
  const sameMarks = (a, b) => Object.keys(a).length === Object.keys(b).length
    && Object.keys(a).every((k) => markValue(b, k) === a[k]);
  function noteMarkChange(prevMarks, nextMarks) {
    const diff = markDiff(prevMarks, nextMarks);
    if (!diff.length) return;
    undoStack.push(diff);
    if (undoStack.length > UNDO_MAX) undoStack.shift();
    calendar.setUndoAvailable(true);
  }
  // 撤销记录整体失效（导入、其他分页改了标记）：收起已经点不到的那颗「撤销」按钮，提示文字保留
  function clearUndo() {
    undoStack.length = 0;
    calendar.setUndoAvailable(false);
    if (!toastUndo.hidden) {
      undoToken += 1;
      show(toastUndo, false);
      toastUndo.onclick = null;
    }
  }
  function undoLatest() {
    const diff = undoStack.pop();
    calendar.setUndoAvailable(undoStack.length > 0);
    if (!diff) return;
    const marks = { ...activeMarks() };
    let done = 0;
    let skipped = 0;
    for (const { key, before, after } of diff) {
      if (markValue(marks, key) !== after) {
        skipped += 1; // 这几天已经被改过（导入 / 其他分页）：不覆盖
        continue;
      }
      if (before === undefined) delete marks[key];
      else marks[key] = before;
      done += 1;
    }
    if (!done) {
      toast((s) => s.calendar.undoStale);
      return;
    }
    const saved = commit(changeMarks(marks), false);
    const message = (s) => skipped ? s.calendar.undoPartial(done, skipped) : s.calendar.undoDone;
    toast(saved ? message : (s) => s.calendar.unsaved(message(s)));
  }

  // 假期表换了（联网 / 导入 / 其他分页）：状态卡、月历、小窗都按新表重算（缺表标签随之消失）
  function setTables(next) {
    tables = next;
    if (!mounted) return;
    calendar.render();
    tick();
  }
  function initializeHoliday() {
    const generation = regionGeneration;
    tables = profile.holidayProvider.tables;
    const startUpdate = profile.id === 'TW' ? startHolidayUpdateTw : startHolidayUpdate;
    holiday = startUpdate({
      storage, clock,
      fetchImpl: (...a) => win.fetch(...a),
      getTables: () => tables,
      onTables: setTables,
      getStrings: () => t,
      isCurrent: () => generation === regionGeneration,
      notify: (msg, kind, against) => (kind === 'info'
        ? banners.queueInfo(against === 'file' ? 'holidayDiffFile' : 'holidayDiff', msg)
        : quietToast(msg)),
      onStatus: holidayPanel.update,
    });
    holiday.reload();
    if (mounted && state.region === 'CN') holiday.autoCheckIfNeeded();
  }
  initializeHoliday();

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
  function applyProfile() {
    if (profile.id === state.region) return;
    regionGeneration++;
    profile = PROFILES[state.region];
    t = profile.strings;
    for (const target of new Set([doc, cardRoot.ownerDocument])) {
      target.documentElement.lang = profile.locale;
      target.title = t.appTitle;
      target.documentElement.dataset.theme = state.cfg.theme;
    }
    setText(header.querySelector('h1'), t.appTitle);
    setText(toastUndo, t.calendar.undo);
    if (toastMessage !== null) setText(toastText, resolveMessage(toastMessage));
    banners.setProfile(profile);
    settings.setProfile(profile);
    holidayPanel.setProfile(profile);
    calendar.setProfile(t);
    float.setProfile(t);
    if (reportResult) updateReportText(reportResult);
    tabs.setProfile(t);
    banners.dismissInfo('holidayDiff');
    banners.dismissInfo('holidayDiffFile');
    lastStatus = null; // Force the next tick to refresh the live summary in the new locale.
    refDirty = true;
    initializeHoliday();
  }


  // 显示设置（字号档位与状态卡区块开关）：唯一入口。切档只改 <html data-font-scale>，
  // 主文件与小窗文件各写一次（小窗里的卡片靠它算字号）。content = 区块开关也变了（内容高度会变）。
  function applyDisplay({ resize = false, content = false, doc: only = null, pip = null } = {}) {
    const scale = state.cfg.fontScale ?? 'm';
    for (const target of new Set([only ?? doc, cardRoot.ownerDocument])) {
      target.documentElement.dataset.fontScale = scale;
    }
    // 小窗开着：先把字号档位同步到小窗文件，再重画卡片、再量该多高
    if (pip) syncDocumentLook(doc, pip.document);
    // 区块开关 / 字号变了：先按新设置重画卡片，再重量参考高度（syncRef 会把 refDirty 清掉，所以顺序不能反）
    if (content) tick();
    refDirty = true;
    syncRef();
    calendar.refreshLayout();
    if (resize) {
      const sizes = { ...ui.winSizes };
      delete sizes[scale];
      ui.winSizes = sizes;
      writeUi(storage, ui);
    }
    if (pip && (resize || content)) float.syncSize({ fit: content && !resize });
  }

  function commit(next, fromSettings) {
    const displayChanged = DISPLAY_FIELDS.some((k) => (state.cfg[k] ?? null) !== (next.cfg[k] ?? null));
    const cardTextChanged = JSON.stringify(state.cfg.cheers) !== JSON.stringify(next.cfg.cheers) || state.cfg.payday !== next.cfg.payday;
    const prevScale = state.cfg.fontScale;
    state = next;
    applyProfile();
    doc.documentElement.dataset.theme = state.cfg.theme;
    cardRoot.ownerDocument.documentElement.dataset.theme = state.cfg.theme;
    // 字号 / 区块开关改了：立刻套用到主文件与小窗（不必等下一次 tick），小窗也跟着换尺寸
    if (displayChanged) applyDisplay({ resize: prevScale !== state.cfg.fontScale, content: true, pip: float.pipWindow() });
    const res = saveState(storage, state);
    storageOk = res.ok;
    setStorageFail(!storageOk);
    if (res.ok) {
      if (fromSettings) settings.flashSaved();
      if (!ui.backupNudged) {
        ui.backupNudged = true;
        banners.queueInfo('backupNudge', (s) => s.banner.backupNudge, {
          closable: false,
          actions: [exportAction, { key: 'ok', label: (s) => s.banner.ok, onClick: () => banners.dismissInfo('backupNudge') }],
        });
        requestPersist();
      }
    } else if (fromSettings) {
      settings.flashSaved(false); // 没写进去就不显示「已自动保存」：只说真话，原因由储存警告条说明
    }
    if (hintShown) {
      hintShown = false;
      banners.dismissInfo('firstRun');
      ui.hintDismissed = true;
    }
    writeUi(storage, ui);
    calendar.render();
    tick();
    if (cardTextChanged && float.pipWindow()) float.syncSize({ fit: true });
    return res.ok; // 调用者可据此说真话（例如标记没写进储存时不能只说「已标记」）
  }

  function doExport() {
    const blob = new win.Blob([exportState(state)], { type: 'application/json' });
    const url = win.URL.createObjectURL(blob);
    const a = h(doc, 'a', { href: url, download: t.exporter.filename(ymd(clock())), class: 'visually-hidden' });
    doc.body.append(a);
    a.click();
    a.remove();
    win.setTimeout(() => win.URL.revokeObjectURL(url), 10000);
    toast((s) => s.exporter.done);
  }

  function closeReport() {
    reportResult = null;
    show(reportPanel, false);
    reportPanel.replaceChildren();
  }

  // 导入报告放在「基本设置 › 数据与备份」卡头下方（H6）：先切到该分页，再把报告带进视野，最后聚焦标题
  function showReport(titleText, body, actions) {
    const title = h(doc, 'h3', { tabindex: '-1', text: titleText });
    // 按钮紧跟标题、在明细表之前：报告比可滚区域高时，标题与按钮仍在视野内（H6）
    reportPanel.replaceChildren(title, h(doc, 'div', { class: 'report-actions' }, actions), ...body);
    show(reportPanel, true);
    tabs.select('settings');
    // 先聚焦（不滚动），再把报告的起始端带进视野：长报告不会把标题和按钮推出画面
    title.focus({ preventScroll: true });
    reportPanel.scrollIntoView({ block: 'nearest' });
    // 报告改变了内容高度：分页没切换时不会自动重算底部渐隐（M16）
    settings.refreshFade();
  }

  function updateReportText(res) {
    const title = reportPanel.querySelector('h3');
    const buttons = reportPanel.querySelectorAll('.report-actions button');
    if (res.error) {
      setText(title, t.importer.fail);
      setText(reportPanel.querySelector('p'), t.importer.failReason(reasonText(res.error, t)));
      setText(buttons[0], t.importer.retry);
      setText(buttons[1], t.importer.ok);
      return;
    }
    const report = importReport(res, t);
    setText(title, report.title);
    setText(buttons[0], t.importer.ok);
    if (buttons[1]) setText(buttons[1], t.importer.goFix);
    reportPanel.querySelectorAll('th').forEach((cell, i) => setText(cell, t.importer.cols[i]));
    reportPanel.querySelectorAll('tbody tr').forEach((row, i) => {
      const item = report.rows[i];
      [item.label, item.reason, item.value].forEach((value, j) => setText(row.children[j], value));
    });
  }

  async function onFile() {
    const file = fileInput.files && fileInput.files[0];
    fileInput.value = '';
    if (!file) return;
    const generation = regionGeneration;
    let text;
    try {
      text = await file.text();
    } catch {
      text = '';
    }
    if (generation !== regionGeneration) return;
    const res = importState(text, state);
    // M19：报告里的按钮与其他卡片按钮同一尺寸（28px），主次仍分开
    const okBtn = h(doc, 'button', { type: 'button', class: 'btn btn-secondary btn-s', text: t.importer.ok, onclick: closeReport });
    if (res.error) {
      reportResult = res;
      showReport(t.importer.fail, [h(doc, 'p', { text: t.importer.failReason(reasonText(res.error, t)) })], [
        h(doc, 'button', { type: 'button', class: 'btn btn-primary btn-s', text: t.importer.retry, onclick: () => fileInput.click() }),
        okBtn,
      ]);
      return;
    }
    commit(res.state, false);
    const report = importReport(res, t);
    clearUndo(); // 导入换掉了整份标记：之前那次标记的撤销不再成立
    settings.applyState(activeCfg(), state.region);
    if (report.rows.length === 0) {
      closeReport();
      toast((s) => s.importer.success);
      return;
    }
    const cols = t.importer.cols;
    const table = h(doc, 'table', {},
      h(doc, 'thead', {}, h(doc, 'tr', {}, cols.map((c) => h(doc, 'th', { scope: 'col', text: c })))),
      h(doc, 'tbody', {}, report.rows.map((r) =>
        h(doc, 'tr', {}, h(doc, 'td', { text: r.label }), h(doc, 'td', { text: r.reason }), h(doc, 'td', { text: r.value })))));
    const firstField = report.rows.find((r) => r.field && !r.field.startsWith('marksByRegion'))?.field;
    reportResult = res;
    showReport(report.title, [table], [
      okBtn,
      firstField ? h(doc, 'button', { type: 'button', class: 'btn btn-ghost btn-s', text: t.importer.goFix, onclick: () => { closeReport(); tabs.select('settings'); settings.focusField(firstField); } }) : null,
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
    quietToast(pausedMessage, true);
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
  // 大卡片最小高度（= 上班中的卡高）要重量：载入、视窗尺寸改变、字体载入完成
  let refDirty = true;
  let lastSnap = null;
  function syncRef() {
    if (!lastSnap || !cardRoot.isConnected || cardRoot.dataset.size !== 'lg') return; // 悬浮中：回到主页后的第一次 tick 再量
    refDirty = false;
    syncReferenceHeight(cardRoot, lastSnap, activeCfg(), t);
  }
  // 视窗改变时立刻量（不等下一次 tick：跨过 640px 断点那一刻卡高就该跟着变）
  const markRefDirty = () => { refDirty = true; syncRef(); };
  win.addEventListener('resize', markRefDirty);
  try {
    doc.fonts?.ready?.then?.(markRefDirty, () => {});
    doc.fonts?.addEventListener?.('loadingdone', markRefDirty);
  } catch {
    // 不支持 FontFaceSet：只靠载入与 resize
  }
  let lastDay = null;
  let lastStatus = null;
  let lastAnnounce = 0;
  function tick() {
    checkGap();
    const now = clock();
    const cfg = activeCfg();
    const snap = { ...snapshot(now, cfg, activeMarks(), tables), now };
    const m = renderCard(cardRoot, snap, cfg, t);
    lastSnap = snap;
    if (refDirty) syncRef();
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

  // 计时（R46，tick-scheduler.js）：一般模式 100 ms；减少动态模式对齐墙上时钟整秒；任何时刻只有一个计时器。
  // 计时器跑在状态卡所在的视窗：悬浮时由小窗驱动（spec §3），收回后回到主视窗。
  const mq = win.matchMedia ? win.matchMedia('(prefers-reduced-motion: reduce)') : null;
  const ticker = createTicker({ tick, reduced: () => Boolean(mq && mq.matches), now: () => Date.now() });
  const start = () => ticker.start();
  function moveTimer(host) {
    skipGap = true;
    ticker.start(host);
    tick();
  }
  // 其他分页改了设置（或清空了储存）：重新读取并套用，不回写，避免两个分页互相覆盖（spec §2 反目标）
  function applyRemote() {
    const r = loadState(storage);
    const prevScale = state.cfg.fontScale;
    const regionChanged = state.region !== r.state.region;
    const marksChanged = state.region !== r.state.region || !sameMarks(activeMarks(), r.state.marksByRegion[r.state.region]);
    const displayChanged = DISPLAY_FIELDS.some((k) => (state.cfg[k] ?? null) !== (r.state.cfg[k] ?? null));
    const cardTextChanged = JSON.stringify(state.cfg.cheers) !== JSON.stringify(r.state.cfg.cheers) || state.cfg.payday !== r.state.cfg.payday;
    state = r.state;
    applyProfile();
    doc.documentElement.dataset.theme = state.cfg.theme;
    cardRoot.ownerDocument.documentElement.dataset.theme = state.cfg.theme;
    // 别的分页改了字号 / 区块开关：跟着变（不回写，也不改小窗位置）
    if (displayChanged) applyDisplay({ resize: prevScale !== state.cfg.fontScale, content: true, pip: float.pipWindow() });
    storageOk = r.storageOk;
    setStorageFail(!storageOk);
    const issue = issueOf(r);
    // 新的问题照常显示；与开页时相同、且已被关闭的问题不再弹出
    setLoadIssue(issue && (issue !== loadIssue || loadShown !== null) ? issue : null, r);
    // 远端设定（可能连地区一起换了）：同一个入口把权威值套回面板。
    // 未送出的草稿照旧留着，只有换地区时才丢掉旧地区的月薪草稿。
    settings.applyState(activeCfg(), state.region);
    // H1：别的分页把设置改成非默认值后，「现在按默认…计算」就不成立了：撤掉这条提示（不记为「已关闭」）
    if (hintShown && Object.entries(defaultsFor(state.region)).some(([k, v]) => Array.isArray(v)
      ? JSON.stringify(activeCfg()[k]) !== JSON.stringify(v) : activeCfg()[k] !== v)) {
      hintShown = false;
      banners.dismissInfo('firstRun');
    }
    // 别的分页改了标记：撤销记录里「改成什么」的前提已经变了，整批作废
    if (marksChanged) clearUndo();
    calendar.render();
    tick();
    if (cardTextChanged && float.pipWindow()) float.syncSize({ fit: true });
  }
  win.addEventListener('storage', (e) => {
    if (e.storageArea && e.storageArea !== storage) return;
    if (e.key === STORAGE_KEY || e.key === null) applyRemote();
    // 其他分页更新了假期数据：重新读取并刷新，不回写
    if (e.key === null || (state.region === 'CN' && e.key === HOLIDAYS_STORAGE_KEY) || (state.region === 'TW' && e.key === TW_HOLIDAYS_STORAGE_KEY)) {
      if (state.region === 'TW') holiday.refresh();
      else holiday.reload();
    }
  });

  mq?.addEventListener?.('change', start);
  doc.addEventListener('visibilitychange', onVisibility); // 先于 tick：同一次回来只提示一次
  doc.addEventListener('visibilitychange', tick);
  doc.addEventListener('resume', notePaused); // Page Lifecycle：从冻结恢复
  win.addEventListener('focus', tick);


  mounted = true;
  settings.applyState(activeCfg(), state.region);
  setStorageFail(!storageOk);
  applyDisplay(); // 先套字号档位，再排版月历与卡片（避免先按 m 排版再跳一次）
  calendar.render();
  tick();
  ticker.start(win);
  // 中国地区仅在缺表且符合检查间隔时联网；台湾只使用内建及导入的年表。
  if (state.region === 'CN') holiday.autoCheckIfNeeded();

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
