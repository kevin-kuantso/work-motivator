// e2e 共用：以本机 node http 提供 dist/，用系统 Chrome（playwright-core，不下载浏览器）。
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

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

// 新 context = 清空的储存；时区固定为北京时间，时钟由 page.clock 控制。
export async function openAt(browser, url, iso, { init, reducedMotion } = {}) {
  const context = await browser.newContext({
    timezoneId: 'Asia/Shanghai',
    locale: 'zh-CN',
    viewport: { width: 1200, height: 900 },
    reducedMotion: reducedMotion ? 'reduce' : 'no-preference',
  });
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e));
  if (init) await page.addInitScript(init);
  // 先装在目标时刻前 5 秒，载入后暂停在目标时刻，再触发一次 visibilitychange
  // 让画面以「恰好」目标时刻重算（之后由 runFor / pauseAt 推进）。
  const at = new Date(iso);
  await page.clock.install({ time: new Date(at.getTime() - 5000) });
  await page.goto(url);
  await page.clock.pauseAt(at);
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  return { context, page, errors };
}
