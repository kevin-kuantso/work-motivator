// 畫面設定（設定 › 顯示）：全域性字號 xs…xl 與狀態卡五個顯隱開關。
// 這裡只檢查「使用者看得到的後果」：整頁字號變、卡片區塊真的不見、日期開關不藏狀態標籤、
// 存檔後重開還在、懸浮小窗跟著換視窗尺寸。配色 / 對比度由 main.spec 與 card-polish.spec 負責。
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, launch, openAt, pipStub } from './harness.mjs';

const T1412 = '2026-11-03T14:12:00+08:00';
// 斷言的是中國大陸文案與金額：寫入舊版（v1、無地區）設定，讓應用走「舊資料歸中國」的遷移路徑。
const CN_LEGACY = { version: 1, salary: 6800, start: '08:30', end: '17:00', lunchOn: true, lunchStart: '11:30', lunchEnd: '13:00', weekends: false, payday: null, cheer: '', showLunar: true };
// 只在第一次注入：過載（page.reload）時不能把使用者剛存的設定蓋回舊檔，否則「重開還在」測不到。
const CN_SEED = { content: `if (!sessionStorage.getItem('display-seeded')) { localStorage.setItem('work-motivator-v1', ${JSON.stringify(JSON.stringify(CN_LEGACY))}); sessionStorage.setItem('display-seeded', '1'); }` };

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

// 種子指令碼要排在最前面：init 支援 { content }，多個內容按順序串起來。
function withPage(iso, fn, opts = {}) {
  const extra = opts.init?.content ? `\n${opts.init.content}` : '';
  const init = { content: `${CN_SEED.content}${extra}` };
  return openPage(iso, fn, { ...opts, init });
}

async function openPage(iso, fn, opts) {
  const { context, page, errors, consoleErrors } = await openAt(browser, server.url, iso, opts);
  try {
    await fn(page);
    assert.deepEqual(errors.map(String), [], 'no uncaught page errors');
    assert.deepEqual(consoleErrors, [], 'no console errors');
  } finally {
    await context.close();
  }
}

// 頁面的 rAF / setTimeout 都在 page.clock 下暫停，不能用 waitForFunction：在 node 端輪詢。
async function until(check, ms = 2000, label = 'condition') {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) {
    last = await check();
    if (last) return last;
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.fail(`${label}: still ${JSON.stringify(last)}`);
}

const openSettings = (page) => page.getByRole('tab', { name: /^(基本设置|基本設定)$/ }).click();
const pickScale = (page, scale) => page.locator('#f-fontScale').selectOption(scale);
const stored = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('work-motivator-v1')));
const fontSize = (page, sel) => page.evaluate((s) => parseFloat(getComputedStyle(document.querySelector(s)).fontSize), sel);
const attr = (page, name) => page.evaluate((n) => document.documentElement.getAttribute(n), name);
// 區塊開關寫在卡片根節點上（data-show-*），不是 <html>：與 card.js 的契約一致
const flag = (page, name) => page.evaluate((n) => document.querySelector('#status-card').dataset[n], `show${name[0].toUpperCase()}${name.slice(1)}`);
const shown = (page, sel) => page.evaluate((s) => {
  const el = document.querySelector(s);
  return Boolean(el) && !el.hidden && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().height > 0;
}, sel);

test('encouragement editor persists, rotates and keeps one empty input', () =>
  withPage(T1412, async (page) => {
    await openSettings(page);
    assert.equal(await page.locator('.cheer-remove').first().isVisible(), false);
    await page.locator('#f-cheer').fill('第一句');
    await page.locator('.cheer-add').click();
    assert.equal(await page.locator('.cheer-remove:visible').count(), 2);
    await page.locator('#f-cheer-2').fill('第二句');
    assert.deepEqual((await stored(page)).cheers, ['第一句', '第二句']);
    assert.equal(await page.locator('.card-cheer').textContent(), '第一句');
    await page.clock.runFor(9000);
    assert.equal(await page.locator('.card-cheer').textContent(), '第二句');
    await page.reload();
    await openSettings(page);
    assert.equal(await page.locator('#f-cheer').inputValue(), '第一句');
    assert.equal(await page.locator('#f-cheer-2').inputValue(), '第二句');
    await page.locator('.cheer-remove').last().click();
    assert.equal(await page.locator('.cheer-item input').count(), 1);
    assert.equal(await page.locator('.cheer-remove').first().isVisible(), false);
    assert.deepEqual((await stored(page)).cheers, ['第一句']);
    await page.locator('#f-cheer').fill('');
    assert.deepEqual((await stored(page)).cheers, ['']);
    assert.equal(await shown(page, '.card-cheer'), false);
  }));

test('reduced motion rotates nonblank encouragement without animation', () =>
  withPage(T1412, async (page) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openSettings(page);
    await page.locator('#f-cheer').fill('第一句');
    await page.locator('.cheer-add').click();
    await page.locator('#f-cheer-2').fill('   ');
    await page.locator('.cheer-add').click();
    await page.locator('#f-cheer-3').fill('第二句');
    await page.clock.runFor(8100);
    assert.equal(await page.locator('.card-cheer').textContent(), '第二句');
    assert.equal(await page.locator('.card-cheer').evaluate((el) => el.getAnimations().length), 0);
    await page.clock.runFor(8000);
    assert.equal(await page.locator('.card-cheer').textContent(), '第一句');
  }));

test('font scale changes the whole page at once and is remembered after reload', () =>
  withPage(T1412, async (page) => {
    await openSettings(page);
    // 預設中號：與未加這個設定時一致（屬性有值、整頁係數為 1）
    assert.equal(await attr(page, 'data-font-scale'), 'm');
    const base = await fontSize(page, '.card-label');

    await pickScale(page, 's');
    await until(async () => (await attr(page, 'data-font-scale')) === 's', 2000, 'scale s');
    const small = await fontSize(page, '.card-label');
    assert.ok(small < base, `s should be smaller: ${small} < ${base}`);

    await pickScale(page, 'xl');
    await until(async () => (await attr(page, 'data-font-scale')) === 'xl', 2000, 'scale xl');
    const xl = await fontSize(page, '.card-label');
    assert.ok(xl > base, `xl should be larger: ${xl} > ${base}`);

    // 存檔寫成穩定 ID（xs…xl），不是畫素或譯文
    assert.equal((await stored(page)).fontScale, 'xl');

    // 重開後照舊：檔位從存檔套用到 <html>，版面立刻是 xl
    await page.reload();
    await until(async () => (await attr(page, 'data-font-scale')) === 'xl', 3000, 'scale after reload');
    assert.equal(await fontSize(page, '.card-label'), xl);
  }));

test('each font scale applies the same ratio to representative page text and the main amount', () =>
  withPage(T1412, async (page) => {
    await openSettings(page);
    const selectors = ['.app-header h1', '.card-label', '.card-amount', '.metric-value', '.card-progress-title', '.scard-title', '#f-fontScale', '.tab'];
    const sizes = async () => page.evaluate((items) => items.map((s) => parseFloat(getComputedStyle(document.querySelector(s)).fontSize)), selectors);
    const base = await sizes();
    for (const [scale, ratio] of [['xs', .8], ['s', .9], ['m', 1], ['l', 1.1], ['xl', 1.2]]) {
      await pickScale(page, scale);
      const actual = await sizes();
      for (let i = 0; i < selectors.length; i++) {
        assert.ok(Math.abs(actual[i] - base[i] * ratio) < .05, `${scale} ${selectors[i]}: ${actual[i]} vs ${base[i] * ratio}`);
      }
    }
  }));

test('each card switch hides exactly its own block; dates never hide the status badge', () =>
  withPage(T1412, async (page) => {
    await openSettings(page);
    const card = '#status-card';
    // 預設全開：區塊都在（進度條、指標、日期、鼓勵語都在折算後的版面裡）
    assert.equal(await flag(page, 'progress'), 'true');
    assert.ok(await shown(page, `${card} .card-date-group`), 'date group visible by default');

    const toggle = (field) => page.locator(`#f-${field}`).click();

    await toggle('showCardDate');
    assert.equal(await flag(page, 'date'), 'false');
    await until(async () => !(await shown(page, `${card} .card-date-group`)), 2000, 'date group hidden');
    // 日期開關只藏日期與農曆：狀態標籤（上班中 / 午休 / 已下班）必須還在
    assert.ok(await shown(page, `${card} .card-badge`), 'status badge must stay visible');

    await toggle('showCardMetrics');
    await until(async () => !(await shown(page, `${card} .card-metrics`)), 2000, 'metrics hidden');
    assert.equal(await flag(page, 'metrics'), 'false');
    assert.ok(await shown(page, `${card} .card-amount`), 'the amount is not a switch target');

    await toggle('showCardProgress');
    await until(async () => !(await shown(page, `${card} .card-progress`)), 2000, 'progress hidden');
    // 收起進度條不能連倒數一起收掉：倒數只是換到另一行
    assert.ok(await shown(page, `${card} .card-countdown`), 'countdown survives hidden progress');

    await toggle('showCardPayday');
    await until(async () => (await flag(page, 'payday')) === 'false', 2000, 'payday off');
    await toggle('showCardCheer');
    await until(async () => (await flag(page, 'cheer')) === 'false', 2000, 'cheer off');
    // 發薪日與鼓勵語在舊檔裡本來就可能是空的：開關關掉後無論如何都不能出現
    assert.ok(!(await shown(page, `${card} .card-payday`)), 'payday hidden');
    assert.ok(!(await shown(page, `${card} .card-cheer`)), 'cheer hidden');
    // 全部關掉後卡片仍然有內容（狀態與金額），不會變成空框
    assert.ok(await shown(page, `${card} .card-badge`), 'badge still visible after hiding everything');
    assert.ok(await shown(page, `${card} .card-amount`), 'amount still visible after hiding everything');

    // 五個開關都寫進存檔，重開後保持
    const cfg = await stored(page);
    for (const k of ['showCardProgress', 'showCardMetrics', 'showCardDate', 'showCardPayday', 'showCardCheer']) {
      assert.equal(cfg[k], false, `${k} stored as false`);
    }
    await page.reload();
    await until(async () => (await flag(page, 'date')) === 'false', 3000, 'switches after reload');
    assert.ok(!(await shown(page, `${card} .card-date-group`)), 'date group still hidden after reload');
  }));

test('changing the scale while floating resizes the PiP window to that scale width', () => {
  const stub = { content: `(${pipStub})({})` };
  return withPage(T1412, async (page) => {
    await page.locator('#btn-float').click();
    await until(() => page.evaluate(() => (window.__pip?.calls ?? []).length > 0), 3000, 'pip opened');
    // 中號開窗：寬度 340（與既有版本一致）
    assert.equal(await page.evaluate(() => window.__pip.calls[0].width), 340);
    // 小窗文件也要拿到同一檔位（卡片字號由該文件的 <html> 決定）
    assert.equal(await page.evaluate(() => window.documentPictureInPicture.window?.document?.documentElement?.getAttribute('data-font-scale')), 'm');
    const initialAmountSize = await page.evaluate(() => parseFloat(getComputedStyle(window.documentPictureInPicture.window.document.querySelector('.card-amount')).fontSize));

    await openSettings(page);
    await pickScale(page, 'xl');
    // 小窗開著：字號換檔同時把視窗改寬（best-effort：瀏覽器可能拒絕，stub 裡會記錄）
    const resized = await until(
      () => page.evaluate(() => (window.__pip.wins[0].resizes ?? []).at(-1)?.width ?? 0),
      3000,
      'pip resize',
    );
    assert.equal(resized, 372);
    assert.equal(await page.evaluate(() => window.documentPictureInPicture.window?.document?.documentElement?.getAttribute('data-font-scale')), 'xl');
    const enlargedAmountSize = await page.evaluate(() => parseFloat(getComputedStyle(window.documentPictureInPicture.window.document.querySelector('.card-amount')).fontSize));
    assert.ok(Math.abs(enlargedAmountSize - initialAmountSize * 1.2) < .05, `PiP amount: ${initialAmountSize} → ${enlargedAmountSize}`);
  }, { init: stub });
});

test('floating height follows hidden and restored card sections', () => {
  const stub = { content: `(${pipStub})({})` };
  return withPage(T1412, async (page) => {
    await page.locator('#btn-float').click();
    await openSettings(page);
    const initial = await page.evaluate(() => window.__pip.calls[0].height);
    await page.locator('#f-showCardMetrics').click();
    await page.locator('#f-showCardProgress').click();
    await page.locator('#f-showCardDate').click();
    const compact = await page.evaluate(() => window.__pip.wins[0].resizes.at(-1).height);
    assert.ok(compact < initial, `hidden sections shrink ${initial} to ${compact}`);
    await page.locator('#f-showCardMetrics').click();
    await page.locator('#f-showCardProgress').click();
    await page.locator('#f-showCardDate').click();
    const restored = await page.evaluate(() => window.__pip.wins[0].resizes.at(-1).height);
    assert.equal(restored, initial, 'restored content restores the fitted height');
  }, { init: stub });
});

test('visibility change fits a previously manually enlarged floating window', () => {
  const stub = { content: `(${pipStub})({})` };
  return withPage(T1412, async (page) => {
    await page.locator('#btn-float').click();
    await openSettings(page);
    await page.clock.runFor(400); // 等開窗時的程式調整保護期結束
    await page.evaluate(() => window.documentPictureInPicture.window.resizeTo(400, 550));
    await page.clock.runFor(300);
    await page.locator('#f-showCardMetrics').uncheck();
    const size = await page.evaluate(() => window.__pip.wins[0].resizes.at(-1));
    assert.equal(size.width, 400);
    assert.ok(size.height < 550, `visibility change fits height: ${size.height}`);
    assert.equal(await page.evaluate(() => {
      const w = window.documentPictureInPicture.window;
      return w.document.documentElement.scrollHeight <= w.innerHeight + 1;
    }), true);
  }, { init: stub });
});

test('content changes refit while unchanged content preserves a manual size', () => {
  const stub = { content: `(${pipStub})({})` };
  return withPage(T1412, async (page) => {
    await page.locator('#btn-float').click();
    await openSettings(page);
    await page.clock.runFor(400);
    await page.evaluate(() => window.documentPictureInPicture.window.resizeTo(400, 550));
    await page.clock.runFor(1000);
    assert.equal(await page.evaluate(() => window.documentPictureInPicture.window.innerHeight), 550);
    await page.locator('#f-cheer').fill('加油');
    const expanded = await page.evaluate(() => window.documentPictureInPicture.window.innerHeight);
    assert.ok(expanded < 550);
    await page.locator('#f-cheer').fill('');
    const compact = await page.evaluate(() => window.documentPictureInPicture.window.innerHeight);
    assert.ok(compact < expanded, `${expanded} → ${compact}`);
    await page.clock.runFor(400);
    await page.locator('#btn-float').click();
    await page.locator('#btn-float').click();
    assert.equal(await page.evaluate(() => window.documentPictureInPicture.window.innerHeight), compact);
  }, { init: stub });
});

test('PiP fits every visibility setting and ignores absent cheer and payday', () => {
  const stub = { content: `(${pipStub})({})` };
  return withPage(T1412, async (page) => {
    await openSettings(page);
    await page.locator('#f-showCardMetrics').click();
    await page.locator('#btn-float').click();
    const requested = await page.evaluate(() => window.__pip.calls[0].height);
    const height = () => page.evaluate(() => window.__pip.wins[0].resizes.at(-1)?.height ?? window.__pip.calls[0].height);
    const fits = () => page.evaluate(() => {
      const d = window.documentPictureInPicture.window.document;
      return d.documentElement.scrollHeight <= d.defaultView.innerHeight + 1;
    });
    assert.ok(await fits(), `opening with metrics hidden fits at ${requested}px`);
    for (const field of ['showCardCheer', 'showCardPayday']) {
      const before = await height();
      await page.locator(`#f-${field}`).click();
      assert.equal(await height(), before, `${field} does not reserve space for absent content`);
      await page.locator(`#f-${field}`).click();
    }
    await page.locator('#f-showCardMetrics').click();
    await page.locator('#f-payday').selectOption('15');
    await page.locator('#f-cheer').fill('今天也要加油');
    assert.ok(await fits(), 'new cheer and payday content fit without toggling');
    for (const field of ['showCardProgress', 'showCardMetrics', 'showCardDate', 'showCardPayday', 'showCardCheer']) {
      await page.locator(`#f-${field}`).click();
      const hidden = await height();
      assert.ok(await fits(), `${field} hidden fits`);
      await page.locator(`#f-${field}`).click();
      assert.ok(await height() >= hidden, `${field} restored does not shrink`);
      assert.ok(await fits(), `${field} restored fits`);
    }
  }, { init: stub });
});
