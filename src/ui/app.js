// 主分頁：組裝頂欄 / 提示條 / 狀態卡 / 分頁（月曆、基本設定），負責儲存、計時與匯入匯出。
import { snapshot, reasonText } from '../calc.js';
import logo from '../logo.png';
import { STORAGE_KEY, defaultsFor, loadState, saveState, exportState, importState } from '../settings.js';
import { PROFILES } from '../profiles.js';
import { h, show, setText } from './dom.js';
import { icon } from './icons.js';
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
import { readSizes } from './window-sizes.js';

const UI_KEY = `${STORAGE_KEY}-ui`; // 介面旗標（首次提示已關閉、備份提示已顯示），與設定分開存放
const ANNOUNCE_MS = 60000;
// R34 / R42 / R43：只有真的停過才提示——兩次 tick 之間超過 5 秒（單調時鐘與牆上時鐘取較大者，見 pause-model.js），
// 或 Page Lifecycle resume。單純切走分頁再回來（tick 照常）不提示。數字會一下子跳到當前時間：不打擾地提示一次，10 分鐘內最多一次。
const PAUSE_NOTICE_EVERY_MS = 10 * 60 * 1000;
const REPOSITORY_URL = 'https://github.com/kevin-kuantso/work-motivator';
// 顯示設定（設定 › 顯示）：改了這些欄位要立刻套用到主文件與小窗，不必等下一次 tick
const DISPLAY_FIELDS = ['fontScale', 'showCardProgress', 'showCardMetrics', 'showCardDate', 'showCardPayday', 'showCardCheer'];

// 小窗尺寸依字號儲存；切換字號時清除目標檔位的舊手動尺寸，重新採用預設尺寸。
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
    // 儲存不可用時由警告條告知，這裡不重複處理
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
  // 當前使用的假期表（R16）：所有計算與月曆都用它；替換請走 setTables()。
  let tables = profile.holidayProvider.tables;
  let mounted = false;

  // ---- 提示層（spec §13.2：錯誤通道 + 資訊通道）----
  const banners = createBanners(doc, t);
  const exportAction = { key: 'export', label: (s) => s.settings.backup.export, onClick: () => doExport() };
  const importAction = { key: 'import', label: (s) => s.settings.backup.import, onClick: () => fileInput.click() };
  // 儲存失敗：恢復前不可關閉，帶匯出 / 匯入快捷按鈕（這兩個按鈕已不在頂欄）
  const setStorageFail = (on) => banners.setError('storageFail', on ? (s) => s.banner.storageFail : null, { dismissible: false, actions: [exportAction, importAction] });
  // 已儲存的設定損壞或部分欄位無效：明確告知，不當作首次開啟靜默處理（spec §2 反目標）；可關閉
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

  // ---- 頂欄只留標題；「懸浮成小窗」在左欄狀態卡下方（R38）----
  const cardRoot = h(doc, 'div', { id: 'status-card', 'data-size': 'lg' });
  const float = createFloatControl(doc, t, {
    cardRoot,
    onOpen: (pipWin) => { pipWin.document.documentElement.dataset.theme = state.cfg.theme; pipWin.document.documentElement.lang = profile.locale; pipWin.document.documentElement.dataset.fontScale = state.cfg.fontScale ?? 'm'; pipWin.document.title = t.appTitle; moveTimer(pipWin); },
    onClose: () => moveTimer(win),
    onFail: () => toast((s) => s.float.failed),
    onPreviewSize: (size) => syncPreviewSize(size),
    // 小窗尺寸按字號檔位管理：目前檔位、該檔記住的尺寸、使用者拉動後記住
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
    h(doc, 'h1', { text: t.appTitle }),
    h(doc, 'a', {
      id: 'repo-link', class: 'app-repo-link', href: REPOSITORY_URL, target: '_blank', rel: 'noopener noreferrer',
      'aria-label': t.header.repository, title: t.header.repository,
    }, icon(doc, 'github')));

  // ---- 主區：左 狀態卡｜右 分頁「月曆」「基本設定」----
  let holiday = null; // 下方建立；面板的回撥在使用者操作時才會用到
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
      // 切區已提交：把新地區的月薪與共享偏好一起套回面板（舊地區的草稿月薪不跨區沿用）。
      settings.applyState(activeCfg(), region);
    },
    onChange: (cfg) => commit(changeCfg(cfg), true),
    onExport: () => doExport(),
    onImport: () => fileInput.click(),
    report: reportPanel,
    builtinYears: Object.keys(profile.holidayProvider.tables).filter((y) => profile.holidayProvider.tables[y].source === 'builtin'),
    profile,
    desktop: win.workMotivatorDesktop,
  });
  const calendar = createCalendar(doc, t, {
    getState: activeState,
    getTables: () => tables,
    getToday: clock,
    onUndo: () => { win.clearTimeout(toastTimer); undoLatest(); },
    onMarks: (marks, msg, prevMarks) => {
      noteMarkChange(prevMarks, marks);
      const saved = commit(changeMarks(marks), false);
      // 沒寫進儲存時仍給「撤銷」（記憶體裡的改動可以撤回），但不謊稱已經標記好了
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
  win.workMotivatorDesktop?.onOpenSettings?.(openSettings);

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
    // H1：文案裡的數字取自當前（預設）設定，不寫死
    banners.queueInfo('firstRun', (s) => s.banner.firstRun(`${profile.currency}${money(activeCfg().salary, 0, profile.locale)}`, state.cfg.start, state.cfg.end), {
      actions: [{ key: 'goFix', label: (s) => s.banner.goFix, onClick: openSettings }],
      onDismiss: dismissHint,
    });
  }
  if (loadIssue) setLoadIssue(loadIssue);

  // ---- 行為 ----
  let toastTimer = null;
  const pendingQuiet = []; // 不打擾的提示（例如自動獲取了假期表）：撤銷提示還在時排在它後面，不蓋掉撤銷
  // 撤銷按鈕只對「當前這一條」有效：token 變了舊按鈕的回撥就不再起作用（提示被打斷、撤銷記錄被清掉時）
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
    // 點「撤銷」不經過 hideToast：排隊的安靜提示（例如暫停提醒）留給下一條，別被撤銷回執頂掉
    toastUndo.onclick = undo ? () => { if (token !== undoToken) return; win.clearTimeout(toastTimer); dismissToast(); undo(); } : null;
    show(toastEl, true);
    win.clearTimeout(toastTimer);
    toastTimer = win.setTimeout(hideToast, 5000);
  }
  // behindAny：連普通 toast 也不蓋掉（暫停提示：最不重要，排在任何正在顯示的 toast 後面）
  function quietToast(msg, behindAny = false) {
    if (!toastEl.hidden && (behindAny || !toastUndo.hidden)) {
      if (!pendingQuiet.includes(msg)) pendingQuiet.push(msg);
    } else toast(msg);
  }

  // ---- 月曆標記的撤銷 ----
  // 只記「哪幾天從什麼改成什麼」，撤銷時逐天恢復且只恢復現值仍等於當時新值的那幾天：
  // 別的分頁 / 匯入已經改過的那天原樣保留，不靜默覆蓋。
  const UNDO_MAX = 20;
  const undoStack = []; // 每項：[{ key, before, after }]（before/after 為 undefined 表示沒有標記）
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
  // 撤銷記錄整體失效（匯入、其他分頁改了標記）：收起已經點不到的那顆「撤銷」按鈕，提示文字保留
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
        skipped += 1; // 這幾天已經被改過（匯入 / 其他分頁）：不覆蓋
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

  // 假期表換了（聯網 / 匯入 / 其他分頁）：狀態卡、月曆、小窗都按新表重算（缺表標籤隨之消失）
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
      // 瀏覽器不支援或拒絕：不影響功能（spec §7）
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
    const repositoryLink = header.querySelector('#repo-link');
    repositoryLink.setAttribute('aria-label', t.header.repository);
    repositoryLink.title = t.header.repository;
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


  // 顯示設定（字號檔位與狀態卡區塊開關）：唯一入口。切檔只改 <html data-font-scale>，
  // 主文件與小窗文件各寫一次（小窗裡的卡片靠它算字號）。content = 區塊開關也變了（內容高度會變）。
  function applyDisplay({ resize = false, content = false, doc: only = null, pip = null } = {}) {
    const scale = state.cfg.fontScale ?? 'm';
    for (const target of new Set([only ?? doc, cardRoot.ownerDocument])) {
      target.documentElement.dataset.fontScale = scale;
    }
    // 小窗開著：先把字號檔位同步到小窗文件，再重畫卡片、再量該多高
    if (pip) syncDocumentLook(doc, pip.document);
    // 區塊開關 / 字號變了：先按新設定重畫卡片，再重量參考高度（syncRef 會把 refDirty 清掉，所以順序不能反）
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

  function syncPreviewSize(size = ui.winSizes[state.cfg.fontScale ?? 'm']) {
    const slot = doc.getElementById('card-slot');
    if (!slot) return;
    for (const axis of ['width', 'height']) {
      if (Number.isFinite(size?.[axis]) && size[axis] > 0) slot.style.setProperty(`--preview-${axis}`, `${size[axis]}px`);
      else slot.style.removeProperty(`--preview-${axis}`);
    }
  }
  // Electron 的原生小窗回報實際幾何時，沿用與 Document PiP 相同的左欄預覽尺寸。
  win.workMotivatorDesktop?.onWidgetBounds?.((size) => syncPreviewSize(size));
  // Native widgets are allowed to be absent.  Ask the desktop shell to measure
  // the same small-card layout in that case, rather than waiting until a widget
  // exists (or retaining a stale height after a relaunch).
  const refitDesktopPreview = () => win.workMotivatorDesktop?.requestPreviewFit?.(state.cfg.fontScale ?? 'm');

  function commit(next, fromSettings) {
    const displayChanged = DISPLAY_FIELDS.some((k) => (state.cfg[k] ?? null) !== (next.cfg[k] ?? null));
    const cardTextChanged = JSON.stringify(state.cfg.cheers) !== JSON.stringify(next.cfg.cheers) || state.cfg.payday !== next.cfg.payday;
    const prevScale = state.cfg.fontScale;
    state = next;
    applyProfile();
    doc.documentElement.dataset.theme = state.cfg.theme;
    cardRoot.ownerDocument.documentElement.dataset.theme = state.cfg.theme;
    // 字號 / 區塊開關改了：立刻套用到主文件與小窗（不必等下一次 tick），小窗也跟著換尺寸
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
      settings.flashSaved(false); // 沒寫進去就不顯示「已自動儲存」：只說真話，原因由儲存警告條說明
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
    if (displayChanged || cardTextChanged) refitDesktopPreview();
    return res.ok; // 呼叫者可據此說真話（例如標記沒寫進儲存時不能只說「已標記」）
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

  // 匯入報告放在「基本設定 › 資料與備份」卡頭下方（H6）：先切到該分頁，再把報告帶進視野，最後聚焦標題
  function showReport(titleText, body, actions) {
    const title = h(doc, 'h3', { tabindex: '-1', text: titleText });
    // 按鈕緊跟標題、在明細表之前：報告比可滾區域高時，標題與按鈕仍在視野內（H6）
    reportPanel.replaceChildren(title, h(doc, 'div', { class: 'report-actions' }, actions), ...body);
    show(reportPanel, true);
    tabs.select('settings');
    // 先聚焦（不滾動），再把報告的起始端帶進視野：長報告不會把標題和按鈕推出畫面
    title.focus({ preventScroll: true });
    reportPanel.scrollIntoView({ block: 'nearest' });
    // 報告改變了內容高度：分頁沒切換時不會自動重算底部漸隱（M16）
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
    // M19：報告裡的按鈕與其他卡片按鈕同一尺寸（28px），主次仍分開
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
    clearUndo(); // 匯入換掉了整份標記：之前那次標記的撤銷不再成立
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

  // ---- 頁面暫停提示（R34）----
  const perf = win.performance;
  const readTick = readTicks(() => perf.now(), () => Date.now(), () => doc.visibilityState === 'hidden'); // 全域 Date，不是可注入的 clock
  let lastTick = null; // null = 還沒 tick 過（第一次 tick 不提示）
  let skipGap = false; // 小窗開 / 關搬動計時器造成的間隔不算暫停
  let lastPauseNotice = -Infinity;
  let pausePending = false; // 分頁隱藏時發現的暫停：回到前臺再提示
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

  // ---- 計時 ----
  // 大卡片最小高度（= 上班中的卡高）要重量：載入、視窗尺寸改變、字型載入完成
  let refDirty = true;
  let lastSnap = null;
  function syncRef() {
    if (!lastSnap || !cardRoot.isConnected || cardRoot.dataset.size !== 'lg') return; // 懸浮中：回到主頁後的第一次 tick 再量
    refDirty = false;
    syncReferenceHeight(cardRoot, lastSnap, activeCfg(), t);
  }
  // 視窗改變時立刻量（不等下一次 tick：跨過 640px 斷點那一刻卡高就該跟著變）
  const markRefDirty = () => { refDirty = true; syncRef(); };
  win.addEventListener('resize', markRefDirty);
  try {
    doc.fonts?.ready?.then?.(markRefDirty, () => {});
    doc.fonts?.addEventListener?.('loadingdone', markRefDirty);
  } catch {
    // 不支援 FontFaceSet：只靠載入與 resize
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
    float.syncPreview();
    lastSnap = snap;
    if (refDirty) syncRef();
    const day = ymd(now);
    if (day !== lastDay) {
      const crossed = lastDay !== null;
      lastDay = day; // 先記下：reload → setTables → tick 會再進來
      if (crossed) {
        calendar.render();
        holiday.reload(); // 跨日：狀態行裡的年份可能變了
      }
    }
    if (m.status !== lastStatus || now - lastAnnounce >= ANNOUNCE_MS) {
      setText(live, m.srSummary);
      lastStatus = m.status;
      lastAnnounce = now.getTime();
    }
  }

  // 計時（R46，tick-scheduler.js）：一般模式 100 ms；減少動態模式對齊牆上時鐘整秒；任何時刻只有一個計時器。
  // 計時器跑在狀態卡所在的視窗：懸浮時由小窗驅動（spec §3），收回後回到主視窗。
  const mq = win.matchMedia ? win.matchMedia('(prefers-reduced-motion: reduce)') : null;
  const ticker = createTicker({ tick, reduced: () => Boolean(mq && mq.matches), now: () => Date.now() });
  const start = () => ticker.start();
  function moveTimer(host) {
    skipGap = true;
    ticker.start(host);
    tick();
  }
  // 其他分頁改了設定（或清空了儲存）：重新讀取並套用，不回寫，避免兩個分頁互相覆蓋（spec §2 反目標）
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
    // 別的分頁改了字號 / 區塊開關：跟著變（不回寫，也不改小窗位置）
    if (displayChanged) applyDisplay({ resize: prevScale !== state.cfg.fontScale, content: true, pip: float.pipWindow() });
    storageOk = r.storageOk;
    setStorageFail(!storageOk);
    const issue = issueOf(r);
    // 新的問題照常顯示；與開頁時相同、且已被關閉的問題不再彈出
    setLoadIssue(issue && (issue !== loadIssue || loadShown !== null) ? issue : null, r);
    // 遠端設定（可能連地區一起換了）：同一個入口把權威值套回面板。
    // 未送出的草稿照舊留著，只有換地區時才丟掉舊地區的月薪草稿。
    settings.applyState(activeCfg(), state.region);
    // H1：別的分頁把設定改成非預設值後，「現在按預設…計算」就不成立了：撤掉這條提示（不記為「已關閉」）
    if (hintShown && Object.entries(defaultsFor(state.region)).some(([k, v]) => Array.isArray(v)
      ? JSON.stringify(activeCfg()[k]) !== JSON.stringify(v) : activeCfg()[k] !== v)) {
      hintShown = false;
      banners.dismissInfo('firstRun');
    }
    // 別的分頁改了標記：撤銷記錄裡「改成什麼」的前提已經變了，整批作廢
    if (marksChanged) clearUndo();
    calendar.render();
    tick();
    if (cardTextChanged && float.pipWindow()) float.syncSize({ fit: true });
    if (displayChanged || cardTextChanged) refitDesktopPreview();
  }
  win.addEventListener('storage', (e) => {
    if (e.storageArea && e.storageArea !== storage) return;
    if (e.key === STORAGE_KEY || e.key === null) applyRemote();
    // 其他分頁更新了假期資料：重新讀取並重新整理，不回寫
    if (e.key === null || (state.region === 'CN' && e.key === HOLIDAYS_STORAGE_KEY) || (state.region === 'TW' && e.key === TW_HOLIDAYS_STORAGE_KEY)) {
      if (state.region === 'TW') holiday.refresh();
      else holiday.reload();
    }
  });

  mq?.addEventListener?.('change', start);
  doc.addEventListener('visibilitychange', onVisibility); // 先於 tick：同一次回來只提示一次
  doc.addEventListener('visibilitychange', tick);
  doc.addEventListener('resume', notePaused); // Page Lifecycle：從凍結恢復
  win.addEventListener('focus', tick);


  mounted = true;
  settings.applyState(activeCfg(), state.region);
  setStorageFail(!storageOk);
  applyDisplay(); // 先套字號檔位，再排版月曆與卡片（避免先按 m 排版再跳一次）
  calendar.render();
  tick();
  ticker.start(win);
  // 中國地區僅在缺表且符合檢查間隔時聯網；臺灣只使用內建及匯入的年表。
  if (state.region === 'CN') holiday.autoCheckIfNeeded();

  // 齒輪只在小窗顯示：先把開啟者視窗帶到前面（R45），再收回小窗（同按 X），再切到「基本設定」分頁。
  // window.focus() 在小窗內的點選手勢裡呼叫時，Chrome 123+ 會把開啟者分頁 / 視窗帶到前面
  // （https://developer.chrome.com/docs/web-platform/document-picture-in-picture 「Focus the opener window」）；
  // 必須同步、在任何 await 之前呼叫。不支援或拋例外時照常收回並切分頁。
  cardRoot.querySelector('.card-gear').addEventListener('click', () => {
    try {
      win.focus();
    } catch {
      // 無法聚焦開啟者：不影響後續
    }
    float.close();
    openSettings();
  });

  return {
    // 換用另一份假期表（例如合併了聯網資料）：狀態卡與月曆立即按新表重算。
    setTables,
  };
}
