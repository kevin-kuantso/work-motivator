'use strict';

const path = require('node:path');
const { app, BrowserWindow, Menu, Tray, dialog, ipcMain, nativeImage, screen, shell } = require('electron');
const { filterSnapshot, readSnapshot, writeSnapshot } = require('./storage.cjs');
const { planWidgetLayout } = require('./widget-layout.cjs');
const { isLoginLaunch, readLoginEnabled, setLoginEnabled } = require('./login-item.cjs');
const repositoryInfo = require('./repository-info.cjs');

// Windows can start a second process at login while one instance already exists. Do not disturb it.
const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();

const APP_PAGE = path.join(__dirname, '..', 'app', 'work-motivator.html');
const ICON = path.join(__dirname, '..', 'assets', process.platform === 'win32' ? 'icon.ico' : 'icon.png');
let mainWindow; let widgetWindow; let tray; let widgetState = null; let settingWidgetBounds = false; let mainReady = Promise.resolve();
const snapshotPath = () => path.join(app.getPath('userData'), 'storage-snapshot.json');
const widgetStatePath = () => path.join(app.getPath('userData'), 'widget-state.json');
const locale = () => {
  try { return JSON.parse(readSnapshot(snapshotPath())['work-motivator-v1'] ?? '{}').region === 'CN' ? 'CN' : 'TW'; } catch { return 'TW'; }
};
const text = () => locale() === 'CN'
  ? { show: '显示主窗口', settings: '基本设置', widget: '打开悬浮窗', login: '开机自动启动并打开小窗', export: '导出设置', import: '导入设置', backup: '备份设置', about: '关于上班鼓励器', quit: '退出', cancel: '取消', chooseExport: '导出设置备份', chooseImport: '导入设置备份', confirmImport: '导入会替换目前设置，继续吗？', imported: '已导入设置。', exported: '已导出设置。', invalid: '备份文件无效，未修改现有设置。', failed: '操作失败，现有设置未被替换。' }
  : { show: '顯示主視窗', settings: '基本設定', widget: '開啟懸浮小窗', login: '開機自動啟動並開啟小窗', export: '匯出設定', import: '匯入設定', backup: '備份設定', about: '關於上班鼓勵器', quit: '結束', cancel: '取消', chooseExport: '匯出設定備份', chooseImport: '匯入設定備份', confirmImport: '匯入會取代目前設定，確定繼續嗎？', imported: '已匯入設定。', exported: '已匯出設定。', invalid: '備份檔無效，現有設定未變更。', failed: '操作失敗，現有設定未被取代。' };
function showMain() { if (!mainWindow) return; mainWindow.show(); mainWindow.focus(); }
function collectStorage(win) { return win.webContents.executeJavaScript(`Object.fromEntries(Object.keys(localStorage).filter(k => k === 'work-motivator-v1' || k.startsWith('work-motivator-v1-')).map(k => [k, localStorage.getItem(k)]))`); }
function replaceStorage(snapshot, reload = false) { return mainWindow.webContents.executeJavaScript(`(() => { for (const k of Object.keys(localStorage)) if (k === 'work-motivator-v1' || k.startsWith('work-motivator-v1-')) localStorage.removeItem(k); for (const [k,v] of Object.entries(${JSON.stringify(snapshot)})) localStorage.setItem(k,v); ${reload ? 'location.reload();' : ''} })()`); }
const notice = (message, type = 'info') => dialog.showMessageBox(mainWindow, { type, buttons: ['OK'], message });
async function showAbout() { const info = repositoryInfo.aboutInfo(app.getVersion(), locale()); const result = await dialog.showMessageBox(mainWindow, { type: 'info', buttons: [info.open, 'OK'], defaultId: 1, cancelId: 1, title: info.title, message: info.title, detail: info.detail }); if (result.response === 0) await shell.openExternal(repositoryInfo.REPOSITORY_URL); }
async function exportBackup() { showMain(); try { const result = await dialog.showSaveDialog(mainWindow, { title: text().chooseExport, defaultPath: 'work-motivator-backup.json' }); if (result.canceled || !result.filePath) return; writeSnapshot(result.filePath, filterSnapshot(await collectStorage(mainWindow))); await notice(text().exported); } catch { await notice(text().failed, 'error'); } }
async function importBackup() { showMain(); const picked = await dialog.showOpenDialog(mainWindow, { title: text().chooseImport, properties: ['openFile'], filters: [{ name: 'JSON', extensions: ['json'] }] }); if (picked.canceled || !picked.filePaths[0]) return; let incoming; try { incoming = filterSnapshot(readSnapshot(picked.filePaths[0])); } catch { await notice(text().invalid, 'error'); return; } const answer = await dialog.showMessageBox(mainWindow, { type: 'warning', buttons: [text().import, text().cancel], defaultId: 1, message: text().confirmImport }); if (answer.response !== 0) return; const before = filterSnapshot(await collectStorage(mainWindow)); try { writeSnapshot(path.join(app.getPath('userData'), 'restore-safety.json'), before); await replaceStorage(incoming, true); } catch { try { await replaceStorage(before, false); } catch {} await notice(text().failed, 'error'); return; } await notice(text().imported); }
function broadcastLogin(result) { mainWindow?.webContents.send('login-item:changed', result); refreshMenu(); }
function changeLogin(enabled) { const result = setLoginEnabled(app, enabled); broadcastLogin(result); return result; }
async function openSettings() { showMain(); if (widgetWindow && !widgetWindow.isDestroyed()) widgetWindow.close(); await mainReady; mainWindow?.webContents.send('desktop:open-settings'); }
function refreshMenu() { const labels = text(); const login = { label: labels.login, type: 'checkbox', checked: readLoginEnabled(app), click: (item) => changeLogin(item.checked) }; const template = [{ label: labels.backup, submenu: [{ label: labels.export, click: exportBackup }, { label: labels.import, click: importBackup }] }, { label: labels.settings, click: openSettings }, { label: labels.widget, click: openWidget }, login, { type: 'separator' }, { label: labels.about, click: showAbout }, { role: 'quit', label: labels.quit }]; Menu.setApplicationMenu(Menu.buildFromTemplate(template)); if (tray) tray.setContextMenu(Menu.buildFromTemplate([{ label: labels.show, click: showMain }, { label: labels.settings, click: openSettings }, { label: labels.widget, click: openWidget }, login, { type: 'separator' }, { label: labels.export, click: exportBackup }, { label: labels.import, click: importBackup }, { type: 'separator' }, { label: labels.about, click: showAbout }, { label: labels.quit, click: () => app.quit() }])); }
function saveWidgetState() { if (!widgetState) return; writeSnapshot(widgetStatePath(), { state: JSON.stringify(widgetState) }); }
function publishWidgetBounds(next) { mainWindow?.webContents.send('widget:bounds', next); }
function setWidgetBounds(next) { widgetState = { ...next }; saveWidgetState(); if (widgetWindow && !widgetWindow.isDestroyed()) { settingWidgetBounds = true; widgetWindow.setBounds(next); settingWidgetBounds = false; } publishWidgetBounds(next); }
function activeWorkArea(bounds) { return screen.getDisplayMatching(bounds ?? widgetState ?? screen.getPrimaryDisplay().bounds).workArea; }
function requestMainCardMeasure(reason = 'measure', scale) {
  const current = widgetState ?? {};
  const area = activeWorkArea(current);
  const width = planWidgetLayout({ current, reason: 'open', workArea: area, scale: scale ?? current.scale ?? 'm' }).width;
  mainWindow?.webContents.send('desktop:measure-main-card', { reason, width, scale: scale ?? current.scale ?? 'm' });
}
function applyWidgetMeasure(measured, reason = 'measure', scale) {
  if (!measured || typeof measured !== 'object') return;
  const current = widgetState ?? widgetWindow?.getBounds() ?? null;
  const area = activeWorkArea(current);
  const next = planWidgetLayout({ current, reason, workArea: area, scale: scale ?? current?.scale ?? 'm', measured });
  setWidgetBounds(next);
}
function openWidget() { if (widgetWindow && !widgetWindow.isDestroyed()) { widgetWindow.show(); widgetWindow.focus(); return; } const area = screen.getPrimaryDisplay().workArea; const bounds = planWidgetLayout({ current: widgetState, workArea: area, scale: widgetState?.scale ?? 'm' }); setWidgetBounds(bounds); widgetWindow = new BrowserWindow({ ...bounds, minWidth: 312, minHeight: 200, frame: false, alwaysOnTop: true, resizable: true, icon: ICON, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, additionalArguments: ['--work-motivator-widget'] } }); widgetWindow.loadFile(APP_PAGE); widgetWindow.on('resize', () => { if (settingWidgetBounds || !widgetWindow) return; const actual = widgetWindow.getBounds(); if (actual.width === widgetState?.width && actual.height === widgetState?.height && actual.x === widgetState?.x && actual.y === widgetState?.y) return; const areaNow = screen.getDisplayMatching(actual).workArea; setWidgetBounds(planWidgetLayout({ current: { ...actual, manual: true, scale: widgetState?.scale ?? 'm' }, reason: 'resize', workArea: areaNow, scale: widgetState?.scale ?? 'm' })); }); widgetWindow.on('closed', () => { widgetWindow = null; }); }
app.whenReady().then(() => { try { widgetState = JSON.parse(readSnapshot(widgetStatePath()).state); } catch {} const loginLaunch = isLoginLaunch({ argv: process.argv, loginSettings: app.getLoginItemSettings?.() }); mainWindow = new BrowserWindow({ width: 1180, height: 760, minWidth: 960, minHeight: 600, show: !loginLaunch, icon: ICON, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true } }); mainReady = new Promise((resolve) => mainWindow.webContents.once('did-finish-load', resolve)); mainWindow.loadFile(APP_PAGE); mainReady.then(() => { if (loginLaunch) openWidget(); else requestMainCardMeasure(); }); const trayIcon = nativeImage.createFromPath(ICON); tray = new Tray(process.platform === 'darwin' ? trayIcon.resize({ width: 18, height: 18 }) : trayIcon); tray.on('click', showMain); refreshMenu(); });
app.on('second-instance', (_event, argv) => { if (!isLoginLaunch({ argv, loginSettings: {} })) showMain(); });
ipcMain.handle('widget:open', openWidget); ipcMain.handle('widget:close', () => widgetWindow?.close()); ipcMain.handle('widget:focus-main', showMain);
ipcMain.handle('login-item:get', () => ({ enabled: readLoginEnabled(app) }));
ipcMain.handle('login-item:set', (_event, enabled) => changeLogin(enabled));
ipcMain.handle('main:open-settings', openSettings);
ipcMain.on('desktop:state', (_event, value) => { if (typeof value !== 'string') return; let parsed; try { parsed = JSON.parse(value); } catch { return; } if (!parsed || typeof parsed !== 'object') return; let prior = {}; try { prior = readSnapshot(snapshotPath()); } catch {} writeSnapshot(snapshotPath(), { ...prior, 'work-motivator-v1': value }); refreshMenu(); });
ipcMain.on('widget:measure', (_event, payload) => {
  const measured = payload?.measured ?? payload;
  const reason = payload?.reason === 'content' || payload?.reason === 'scale' ? payload.reason : 'measure';
  applyWidgetMeasure(measured, reason, payload?.scale);
});
ipcMain.on('desktop:main-card-changed', () => { if (!widgetWindow) requestMainCardMeasure('measure'); });
ipcMain.on('desktop:request-preview-fit', (_event, { scale } = {}) => {
  if (widgetWindow && !widgetWindow.isDestroyed()) widgetWindow.webContents.send('desktop:measure-widget-content', { reason: 'content', scale });
  else requestMainCardMeasure('content', scale);
});
ipcMain.on('widget:preview-size', (_event, size) => mainWindow?.webContents.send('widget:bounds', size));
app.on('window-all-closed', (event) => { if (process.platform !== 'darwin') event.preventDefault(); });
