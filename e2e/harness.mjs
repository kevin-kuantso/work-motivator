// e2e 共用：以本機 node http 提供 dist/，用系統 Chrome（playwright-core，不下載瀏覽器）。
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { yearsToAutoCheck, DEFAULT_HOLIDAY_SOURCES, buildSourceUrl } from '../src/holiday-data.js';
import { HOLIDAYS_CN } from '../src/holidays-cn.js';

export const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

export async function startServer() {
  const server = createServer(async (req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (path.includes('..')) { res.writeHead(400).end(); return; }
    try {
      const body = await readFile(join(dist, path));
      res.writeHead(200, { 'content-type': path.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  return { url: `http://localhost:${port}/work-motivator.html`, close: () => new Promise((r) => server.close(r)) };
}

export const launch = () => chromium.launch({ channel: 'chrome', headless: true });

// 本機（e2e 伺服器）以外的 http(s) 請求一律中止並記錄（R19）：測試永遠不碰真實網路。
// 需要回應的測試用 page.route(...) 提供 fixture（page.route 優先於這裡的 context.route）。
// 只有 http / https 到 localhost / 127.0.0.1 才算本機（R32）；ws / wss、協議相對網址解析出的外部主機、其他一切都中止並計數。
export const isLocal = (u) => {
  try {
    const { protocol, hostname } = new URL(u);
    return (protocol === 'http:' || protocol === 'https:') && (hostname === 'localhost' || hostname === '127.0.0.1');
  } catch {
    return false;
  }
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 全新儲存、無自定義網址時，開頁自動檢查「應該」請求的網址（按北京時間的日期算，與頁面一致）。
export function expectedAutoUrls(iso, region = 'CN') {
  if (region === 'TW') return [];
  const [y, m, d] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date(iso)).split('-').map(Number);
  const now = new Date(y, m - 1, d, 12);
  return yearsToAutoCheck(now, HOLIDAYS_CN, null)
    .flatMap((yr) => DEFAULT_HOLIDAY_SOURCES.map((s) => buildSourceUrl(s, yr)));
}

// 等到假期資料檢查結束（「檢查更新」按鈕不再是檢查中）。用 Node 端輪詢：頁面時鐘被暫停時，頁內計時器不可靠。
export async function holidayIdle(page, timeout = 5000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const idle = await page.evaluate(() => {
      const b = document.getElementById('btn-holiday-check');
      return Boolean(b) && !b.hasAttribute('aria-disabled');
    });
    if (idle) return true;
    await sleep(20);
  }
  return false;
}

// 新 context = 清空的儲存；時區固定為北京時間，時鐘由 page.clock 控制。
// 返回 external：頁面發出的所有外部請求網址（含被中止的、被 page.route 回應的）；
// consoleErrors：console.error（被中止的外部請求在 Chrome 裡會記一條「Failed to load resource」，那一條單獨計入 blockedLogs，不算錯誤）。
// beforeGoto(page)：在載入前裝 page.route（讓開頁的自動檢查拿到 fixture）。
// autoUrls：開頁後、自動檢查結束時已發出的外部請求。
export async function openAt(browser, url, iso, { init, reducedMotion, viewport, beforeGoto } = {}) {
  const context = await browser.newContext({
    timezoneId: 'Asia/Shanghai',
    locale: 'zh-CN',
    viewport: viewport ?? { width: 1200, height: 900 },
    reducedMotion: reducedMotion ? 'reduce' : 'no-preference',
  });
  const external = [];
  context.on('request', (r) => { if (!isLocal(r.url())) external.push(r.url()); });
  await context.route((u) => !isLocal(u.href), (route) => route.abort('internetdisconnected'));
  // WebSocket 不走 route：另外攔截（記錄後直接關閉，不連到任何伺服器）
  await context.routeWebSocket((u) => !isLocal(u.href), (ws) => { external.push(ws.url()); ws.close(); });
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  const errors = [];
  const consoleErrors = [];
  const blockedLogs = [];
  page.on('pageerror', (e) => errors.push(e));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const loc = m.location()?.url ?? '';
    if (/^Failed to load resource/.test(m.text()) && (!isLocal(loc) || /\/favicon\.ico$/.test(loc))) blockedLogs.push(`${m.text()} ${loc}`);
    else consoleErrors.push(`${m.text()} ${loc}`);
  });
  if (init) await page.addInitScript(init);
  if (beforeGoto) await beforeGoto(page);
  // 先裝在目標時刻前 5 秒，載入後暫停在目標時刻，再觸發一次 visibilitychange
  // 讓畫面以「恰好」目標時刻重算（之後由 runFor / pauseAt 推進）。
  const at = new Date(iso);
  await page.clock.install({ time: new Date(at.getTime() - 5000) });
  await page.goto(url);
  await page.clock.pauseAt(at);
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  const idle = await holidayIdle(page);
  if (!idle) throw new Error('holiday auto-check did not finish after page load');
  return { context, page, errors, external, consoleErrors, blockedLogs, autoUrls: external.slice() };
}

// 懸浮小窗 stub（pip.spec / digits.spec 共用）：requestWindow 回傳一個 iframe 的 window（獨立 document），
// 其 setInterval / clearInterval（與 setTimeout / clearTimeout）轉給已被 page.clock 接管的主視窗計時器，並記錄存活的 id。
// 以 addInitScript 的 content 注入：`(${pipStub})(${JSON.stringify(opts)})`。
export function pipStub(opts) {
  const reg = { calls: [], wins: [] };
  window.__pip = reg;
  const dp = {
    window: null,
    async requestWindow(o) {
      reg.calls.push(o);
      if (opts.reject) throw new DOMException('denied', 'NotAllowedError');
      const f = document.createElement('iframe');
      f.className = 'pip-stub';
      f.style.cssText = `position:fixed;left:0;bottom:0;width:${o.width}px;height:${o.height}px;border:0;z-index:9`; // 尺寸 = 請求的視口
      document.documentElement.append(f);
      const w = f.contentWindow;
      const entry = { active: new Set(), closed: false };
      w.setInterval = (fn, ms) => {
        const id = window.setInterval(fn, ms);
        entry.active.add(id);
        return id;
      };
      w.clearInterval = (id) => {
        entry.active.delete(id);
        window.clearInterval(id);
      };
      // 減少動態模式的對齊計時（R46）用 setTimeout：同樣轉給主視窗，記錄在 timeouts（觸發或清除後移除）
      entry.timeouts = new Set();
      w.setTimeout = (fn, ms) => {
        const id = window.setTimeout(() => { entry.timeouts.delete(id); fn(); }, ms);
        entry.timeouts.add(id);
        return id;
      };
      w.clearTimeout = (id) => {
        entry.timeouts.delete(id);
        window.clearTimeout(id);
      };
      // 真實瀏覽器：close()（程式或按 X）都會觸發 pagehide
      w.close = () => {
        if (entry.closed) return;
        entry.closed = true;
        w.dispatchEvent(new Event('pagehide'));
        dp.window = null;
        f.remove();
      };
      // Document PiP 的 resizeTo 需要手勢、瀏覽器可能拒絕；stub 裡記錄呼叫並把 iframe 調成該尺寸，
      // 同時派發 resize（真實視窗大小改變也會派發），讓「記住使用者拉動的尺寸」邏輯有東西可量。
      entry.resizes = [];
      w.resizeTo = (width, height) => {
        entry.resizes.push({ width, height });
        f.style.width = `${width}px`;
        f.style.height = `${height}px`;
        w.dispatchEvent(new Event('resize'));
      };
      reg.wins.push(entry);
      dp.window = w;
      return w;
    },
  };
  Object.defineProperty(window, 'documentPictureInPicture', { value: dp, configurable: true });
}

// 提示的可見行（V1 裡計薪金額在窄格子會另起一行，innerText 會把「計薪 / 金額」拆開；這裡按行元素取 textContent）。
export const tipVisibleLines = (page) => page.evaluate(() => {
  const tip = document.querySelector('.day-tooltip');
  return [...tip.children].filter((x) => getComputedStyle(x).display !== 'none').map((x) => x.textContent);
});
