// R34：頁面被瀏覽器暫停 / 節流 / 凍結後恢復，數字按時鐘重算會一下子跳過去：給一個不打擾的提示。
// 間隔用 performance.now() 量（page.clock 也接管它）；fastForward 只觸發到期的計時器一次 = 一次真實的「暫停後恢復」。
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, launch, openAt, expectedAutoUrls, pipStub } from './harness.mjs';

const T1412 = '2026-11-03T14:12:00+08:00';
const NOTICE = '页面刚才被浏览器暂停了一段时间，数字已按当前时间校正';
const TW_NOTICE = '頁面剛才被瀏覽器暫停了一段時間，數字已按目前時間校正';

// 本文件斷言的是中國地區文案（暫停提示、日期選單、撤銷 toast）：明確寫入舊版（v1，無地區）設定，
// 讓應用走「舊資料一律歸中國」的遷移路徑，不依賴當前的新使用者預設地區（臺灣）。
// 唯一例外是第一條測試：它斷言「首次提示橫幅還在」，而首次提示的前提就是 localStorage 裡沒有設定，
// 所以那一條以 seed: false 明確保持全新使用者的臺灣預設（橫幅文字隨之不同）。
const CN_LEGACY = { version: 1, salary: 6800, start: '08:30', end: '17:00', lunchOn: true, lunchStart: '11:30', lunchEnd: '13:00', weekends: false, payday: null, cheer: '' };
const CN_SEED = `if (!sessionStorage.getItem('cn-seeded')) { localStorage.setItem('work-motivator-v1', ${JSON.stringify(JSON.stringify(CN_LEGACY))}); sessionStorage.setItem('cn-seeded', '1'); }`;
// 與既有的 init 組在一起：字串相加、函式轉成字串、{ content } 加字首、null / undefined 只留種子、{ path } 原樣。
const seeded = (init) => {
  if (init == null) return CN_SEED;
  if (typeof init === 'string') return `${CN_SEED}\n${init}`;
  if (typeof init === 'function') return `${CN_SEED}\n(${init.toString()})();`;
  if (typeof init.content === 'string') return { ...init, content: `${CN_SEED}\n${init.content}` };
  return init;
};

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
  const { seed = true, ...rest } = opts ?? {};
  const { context, page, errors, external, consoleErrors, autoUrls } = await openAt(browser, server.url, iso, { ...rest, init: seed ? seeded(rest.init) : rest.init });
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

// 記錄 toast 每一次「出現」時的文字（hidden 從有到無），用來數提示出現了幾次
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
const notices = async (page) => (await shown(page)).filter((s) => s === NOTICE || s === TW_NOTICE).length;
// 模擬分頁隱藏 / 回來（headless 永遠是 visible）
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
    assert.deepEqual(s, { visible: true, text: TW_NOTICE, undo: false }, 'quiet toast, no action button');
    assert.notEqual(await page.locator('#status-card .card-amount').textContent(), before, 'numbers re-derived from the clock');
    assert.equal(await notices(page), 1);
    await page.clock.runFor(5500);
    assert.equal((await toastState(page)).visible, false, 'auto-dismissed');
    await page.clock.fastForward(60000);
    await page.clock.runFor(200);
    assert.equal(await notices(page), 1, 'at most once per 10 minutes');
    assert.equal((await toastState(page)).visible, false);
    // 10 分鐘後再次暫停：可以再提示
    await page.clock.runFor(10 * 60 * 1000);
    await page.clock.fastForward(60000);
    assert.equal(await notices(page), 2, 'again after 10 minutes');
    // 橫幅不受影響（首次提示仍在）
    assert.equal(await page.getByText('目前按預設月薪 NT$40,000、09:00–18:00 計算，請改成你自己的').isVisible(), true, 'banners untouched');
  }, { seed: false })); // 例外：首次提示只在新使用者（localStorage 沒有設定）時出現，與「寫入舊版中國設定」互斥

test('the notice never replaces the calendar undo toast: it waits until the undo toast is gone', () =>
  withPage(T1412, async (page) => {
    await watchToasts(page);
    await page.locator('.cal-grid button[aria-label^="11月7日 "]').click();
    await page.getByRole('menuitemradio', { name: /改为上班/ }).click();
    const undo = await toastState(page);
    assert.equal(undo.undo, true);
    assert.match(undo.text, /11\/7 已标记为调休上班/);
    // Page Lifecycle：頁面從凍結恢復
    await page.evaluate(() => document.dispatchEvent(new Event('resume')));
    await page.clock.runFor(1000);
    assert.deepEqual(await toastState(page), undo, 'undo toast still there, unchanged');
    await page.clock.runFor(4500);
    assert.deepEqual(await toastState(page), { visible: true, text: NOTICE, undo: false }, 'notice shown after the undo toast');
    assert.equal(await notices(page), 1);
  }));

// R43：只是切走分頁再回來、tick 照常 → 不提示；只有真的停過（tick 間隔 > 5 秒或 resume）才提示
test('R43: 8 s hidden with ticks still firing normally → no notice on return', () =>
  withPage(T1412, async (page) => {
    await watchToasts(page);
    await setVisibility(page, 'hidden');
    await page.clock.runFor(8000);
    await setVisibility(page, 'visible');
    await page.clock.runFor(200);
    assert.equal(await notices(page), 0, 'plain tab switch: nothing');
  }));

// R44：分頁隱藏超過 5 分鐘後 Chrome 每分鐘才喚醒一次計時器——單調時鐘的大間隔不算停過（回來時畫面立即重畫）
test('R44: hidden 10 minutes with one tick per minute (intensive throttling) → NO notice', () =>
  withPage(T1412, async (page) => {
    await watchToasts(page);
    await setVisibility(page, 'hidden');
    for (let i = 0; i < 10; i += 1) await page.clock.fastForward(60000);
    await setVisibility(page, 'visible');
    await page.clock.runFor(500);
    assert.equal(await notices(page), 0, 'no notice for throttled wake-ups');
  }));

test('R44: hidden + wall-clock-only jump (machine slept) → nothing while hidden, exactly one notice on becoming visible', () =>
  withPage(T1412, async (page) => {
    await watchToasts(page);
    await setVisibility(page, 'hidden');
    const wall = await page.evaluate(() => Date.now());
    await page.clock.setSystemTime(new Date(wall + 60000)); // 只動牆上時鐘
    await page.clock.runFor(1000);
    assert.equal((await toastState(page)).visible, false, 'not shown while hidden');
    assert.equal(await notices(page), 0);
    await setVisibility(page, 'visible');
    assert.deepEqual(await toastState(page), { visible: true, text: NOTICE, undo: false }, 'shown on becoming visible');
    await page.clock.runFor(500);
    assert.equal(await notices(page), 1);
  }));

test('R44: visible 6 s stall → immediate notice', () =>
  withPage(T1412, async (page) => {
    await watchToasts(page);
    await page.clock.fastForward(6000);
    assert.deepEqual(await toastState(page), { visible: true, text: NOTICE, undo: false });
    assert.equal(await notices(page), 1);
  }));

test('R43/R44: hidden + resume event → held, one notice on becoming visible', () =>
  withPage(T1412, async (page) => {
    await watchToasts(page);
    await setVisibility(page, 'hidden');
    await page.evaluate(() => document.dispatchEvent(new Event('resume')));
    assert.equal(await notices(page), 0);
    await setVisibility(page, 'visible');
    assert.equal(await notices(page), 1);
  }));

test('R43: stall while visible → immediate notice; two stalls within 10 min → one notice', () =>
  withPage(T1412, async (page) => {
    await watchToasts(page);
    await page.clock.fastForward(30000);
    assert.equal(await notices(page), 1, 'immediate');
    await page.clock.runFor(60000);
    await page.clock.fastForward(30000);
    assert.equal(await notices(page), 1, 'second stall within 10 min: no second notice');
  }));

// R42：macOS 休眠時 performance.now() 可能不走，但牆上時鐘走了：只跳 Date（setSystemTime 不動 performance.now）也要提示
test('R42: wall-clock-only jump (monotonic clock not advanced) is detected as a stall', () =>
  withPage(T1412, async (page) => {
    await watchToasts(page);
    const p0 = await page.evaluate(() => [performance.now(), Date.now()]);
    await page.clock.setSystemTime(new Date(p0[1] + 60000));
    const p1 = await page.evaluate(() => [performance.now(), Date.now()]);
    assert.ok(p1[0] - p0[0] < 1000, `performance.now did not jump (${p1[0] - p0[0]})`);
    assert.ok(p1[1] - p0[1] >= 60000, 'Date.now jumped');
    await page.clock.runFor(100);
    assert.deepEqual(await toastState(page), { visible: true, text: NOTICE, undo: false });
    assert.equal(await notices(page), 1);
  }));

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
