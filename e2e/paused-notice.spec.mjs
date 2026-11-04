// R34：页面被浏览器暂停 / 节流 / 冻结后恢复，数字按时钟重算会一下子跳过去：给一个不打扰的提示。
// 间隔用 performance.now() 量（page.clock 也接管它）；fastForward 只触发到期的计时器一次 = 一次真实的「暂停后恢复」。
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, launch, openAt, expectedAutoUrls, pipStub } from './harness.mjs';

const T1412 = '2026-11-03T14:12:00+08:00';
const NOTICE = '页面刚才被浏览器暂停了一段时间，数字已按当前时间校正';

let server;
let browser;
before(async () => {
  server = await startServer();
  browser = await launch();
});
after(async () => {
  await browser?.close();
  await server?.close();
});

async function withPage(iso, fn, opts) {
  const { context, page, errors, external, consoleErrors, autoUrls } = await openAt(browser, server.url, iso, opts);
  try {
    assert.deepEqual(autoUrls, expectedAutoUrls(iso), 'auto-check requests on load');
    await fn(page);
    assert.deepEqual(errors.map(String), [], 'no uncaught page errors');
    assert.deepEqual(consoleErrors, [], 'no console errors');
    assert.deepEqual(external, autoUrls, 'no external request besides the load-time auto-check');
  } finally {
    await context.close();
  }
}

// 记录 toast 每一次「出现」时的文字（hidden 从有到无），用来数提示出现了几次
const watchToasts = (page) => page.evaluate(() => {
  const el = document.querySelector('.toast');
  window.__shown = el.hidden ? [] : [el.querySelector('.toast-text').textContent];
  new MutationObserver(() => {
    const visible = !el.hidden;
    if (visible && !window.__wasVisible) window.__shown.push(el.querySelector('.toast-text').textContent);
    if (visible && window.__wasVisible && window.__shown.at(-1) !== el.querySelector('.toast-text').textContent) window.__shown.push(el.querySelector('.toast-text').textContent);
    window.__wasVisible = visible;
  }).observe(el, { attributes: true, subtree: true, childList: true, characterData: true });
  window.__wasVisible = !el.hidden;
});
const shown = (page) => page.evaluate(() => window.__shown);
const toastState = (page) => page.evaluate(() => {
  const el = document.querySelector('.toast');
  return { visible: !el.hidden, text: el.querySelector('.toast-text').textContent, undo: !el.querySelector('.toast-action').hidden };
});
const notices = async (page) => (await shown(page)).filter((s) => s === NOTICE).length;
// 模拟分页隐藏 / 回来（headless 永远是 visible）
const setVisibility = (page, state) => page.evaluate((s) => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => s });
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => s === 'hidden' });
  document.dispatchEvent(new Event('visibilitychange'));
}, state);

test('first tick and normal-pace ticks show nothing; one 60 s jump shows exactly one notice; a second jump within 10 min does not', () =>
  withPage(T1412, async (page) => {
    await watchToasts(page);
    assert.equal((await toastState(page)).visible, false, 'no notice on the first tick (nor after the harness\' load-time jump)');
    await page.clock.runFor(3000);
    assert.equal(await notices(page), 0, 'normal pace: nothing');
    const before = await page.locator('#status-card .card-amount').textContent();
    await page.clock.fastForward(60000);
    const s = await toastState(page);
    assert.deepEqual(s, { visible: true, text: NOTICE, undo: false }, 'quiet toast, no action button');
    assert.notEqual(await page.locator('#status-card .card-amount').textContent(), before, 'numbers re-derived from the clock');
    assert.equal(await notices(page), 1);
    await page.clock.runFor(5500);
    assert.equal((await toastState(page)).visible, false, 'auto-dismissed');
    await page.clock.fastForward(60000);
    await page.clock.runFor(200);
    assert.equal(await notices(page), 1, 'at most once per 10 minutes');
    assert.equal((await toastState(page)).visible, false);
    // 10 分钟后再次暂停：可以再提示
    await page.clock.runFor(10 * 60 * 1000);
    await page.clock.fastForward(60000);
    assert.equal(await notices(page), 2, 'again after 10 minutes');
    // 横幅不受影响（首次提示仍在）
    assert.equal(await page.getByText('这是默认值，可在设置里修改').isVisible(), true, 'banners untouched');
  }));

test('the notice never replaces the calendar undo toast: it waits until the undo toast is gone', () =>
  withPage(T1412, async (page) => {
    await watchToasts(page);
    await page.locator('.cal-grid button[aria-label^="11月7日 "]').click();
    await page.getByRole('menuitemradio', { name: /改为上班/ }).click();
    const undo = await toastState(page);
    assert.equal(undo.undo, true);
    assert.match(undo.text, /11\/7 已标记为调休上班/);
    // Page Lifecycle：页面从冻结恢复
    await page.evaluate(() => document.dispatchEvent(new Event('resume')));
    await page.clock.runFor(1000);
    assert.deepEqual(await toastState(page), undo, 'undo toast still there, unchanged');
    await page.clock.runFor(4500);
    assert.deepEqual(await toastState(page), { visible: true, text: NOTICE, undo: false }, 'notice shown after the undo toast');
    assert.equal(await notices(page), 1);
  }));

test('tab hidden > 5 s: notice on return (not while hidden); a tick gap while hidden is shown once on return', async () => {
  await withPage(T1412, async (page) => {
    await watchToasts(page);
    await setVisibility(page, 'hidden');
    await page.clock.runFor(6000);
    assert.equal(await notices(page), 0);
    await setVisibility(page, 'visible');
    assert.equal(await notices(page), 1);
  });
  await withPage(T1412, async (page) => {
    await watchToasts(page);
    await setVisibility(page, 'hidden');
    await page.clock.fastForward(60000);
    assert.equal((await toastState(page)).visible, false, 'not shown while hidden');
    await setVisibility(page, 'visible');
    assert.deepEqual(await toastState(page), { visible: true, text: NOTICE, undo: false });
    assert.equal(await notices(page), 1, 'gap + visibility on the same return → one notice');
  });
  await withPage(T1412, async (page) => {
    await watchToasts(page);
    await setVisibility(page, 'hidden');
    await page.clock.runFor(3000);
    await setVisibility(page, 'visible');
    assert.equal(await notices(page), 0, 'short hide: nothing');
  });
});

test('PiP: opening / closing and hiding the opener while the card ticks in PiP show no notice', () =>
  withPage(T1412, async (page) => {
    await watchToasts(page);
    await page.locator('#btn-float').click();
    await page.frameLocator('iframe.pip-stub').locator('#status-card').waitFor();
    await setVisibility(page, 'hidden');
    await page.clock.runFor(8000);
    await setVisibility(page, 'visible');
    await page.evaluate(() => window.documentPictureInPicture.window.close());
    await page.clock.runFor(1000);
    assert.deepEqual(await shown(page), [], 'no toast at all');
  }, { init: { content: `(${pipStub})({})` } }));
