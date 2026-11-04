// e2e 共用：以本机 node http 提供 dist/，用系统 Chrome（playwright-core，不下载浏览器）。
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

// 本机（e2e 服务器）以外的 http(s) 请求一律中止并记录（R19）：测试永远不碰真实网络。
// 需要回应的测试用 page.route(...) 提供 fixture（page.route 优先于这里的 context.route）。
// 只有 http / https 到 localhost / 127.0.0.1 才算本机（R32）；ws / wss、协议相对网址解析出的外部主机、其他一切都中止并计数。
export const isLocal = (u) => {
  try {
    const { protocol, hostname } = new URL(u);
    return (protocol === 'http:' || protocol === 'https:') && (hostname === 'localhost' || hostname === '127.0.0.1');
  } catch {
    return false;
  }
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 全新储存、无自定义网址时，开页自动检查「应该」请求的网址（按北京时间的日期算，与页面一致）。
export function expectedAutoUrls(iso) {
  const [y, m, d] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date(iso)).split('-').map(Number);
  return yearsToAutoCheck(new Date(y, m - 1, d, 12), HOLIDAYS_CN, null)
    .flatMap((yr) => DEFAULT_HOLIDAY_SOURCES.map((s) => buildSourceUrl(s, yr)));
}

// 等到假期数据检查结束（「检查更新」按钮不再是检查中）。用 Node 端轮询：页面时钟被暂停时，页内计时器不可靠。
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

// 新 context = 清空的储存；时区固定为北京时间，时钟由 page.clock 控制。
// 返回 external：页面发出的所有外部请求网址（含被中止的、被 page.route 回应的）；
// consoleErrors：console.error（被中止的外部请求在 Chrome 里会记一条「Failed to load resource」，那一条单独计入 blockedLogs，不算错误）。
// beforeGoto(page)：在载入前装 page.route（让开页的自动检查拿到 fixture）。
// autoUrls：开页后、自动检查结束时已发出的外部请求。
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
  // WebSocket 不走 route：另外拦截（记录后直接关闭，不连到任何服务器）
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
  // 先装在目标时刻前 5 秒，载入后暂停在目标时刻，再触发一次 visibilitychange
  // 让画面以「恰好」目标时刻重算（之后由 runFor / pauseAt 推进）。
  const at = new Date(iso);
  await page.clock.install({ time: new Date(at.getTime() - 5000) });
  await page.goto(url);
  await page.clock.pauseAt(at);
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  const idle = await holidayIdle(page);
  if (!idle) throw new Error('holiday auto-check did not finish after page load');
  return { context, page, errors, external, consoleErrors, blockedLogs, autoUrls: external.slice() };
}

// 悬浮小窗 stub（pip.spec / digits.spec 共用）：requestWindow 回传一个 iframe 的 window（独立 document），
// 其 setInterval / clearInterval（与 setTimeout / clearTimeout）转给已被 page.clock 接管的主视窗计时器，并记录存活的 id。
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
      f.style.cssText = `position:fixed;left:0;bottom:0;width:${o.width}px;height:${o.height}px;border:0;z-index:9`; // 尺寸 = 请求的视口
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
      // 减少动态模式的对齐计时（R46）用 setTimeout：同样转给主视窗，记录在 timeouts（触发或清除后移除）
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
      // 真实浏览器：close()（程序或按 X）都会触发 pagehide
      w.close = () => {
        if (entry.closed) return;
        entry.closed = true;
        w.dispatchEvent(new Event('pagehide'));
        dp.window = null;
        f.remove();
      };
      reg.wins.push(entry);
      dp.window = w;
      return w;
    },
  };
  Object.defineProperty(window, 'documentPictureInPicture', { value: dp, configurable: true });
}
