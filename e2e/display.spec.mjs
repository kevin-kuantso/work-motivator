// 画面设置（设置 › 显示）：全局字号 xs…xl 与状态卡五个显隐开关。
// 这里只检查「使用者看得到的后果」：整页字号变、卡片区块真的不见、日期开关不藏状态标签、
// 存盘后重开还在、悬浮小窗跟着换窗口尺寸。配色 / 对比度由 main.spec 与 card-polish.spec 负责。
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, launch, openAt, pipStub } from './harness.mjs';

const T1412 = '2026-11-03T14:12:00+08:00';
// 断言的是中国大陆文案与金额：写入旧版（v1、无地区）设置，让应用走「旧数据归中国」的迁移路径。
const CN_LEGACY = { version: 1, salary: 6800, start: '08:30', end: '17:00', lunchOn: true, lunchStart: '11:30', lunchEnd: '13:00', weekends: false, payday: null, cheer: '', showLunar: true };
// 只在第一次注入：重载（page.reload）时不能把使用者刚存的设置盖回旧档，否则「重开还在」测不到。
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

// 种子脚本要排在最前面：init 支持 { content }，多个内容按顺序串起来。
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

// 页面的 rAF / setTimeout 都在 page.clock 下暂停，不能用 waitForFunction：在 node 端轮询。
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
// 区块开关写在卡片根节点上（data-show-*），不是 <html>：与 card.js 的契约一致
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
    // 默认中号：与未加这个设置时一致（属性有值、整页系数为 1）
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

    // 存盘写成稳定 ID（xs…xl），不是像素或译文
    assert.equal((await stored(page)).fontScale, 'xl');

    // 重开后照旧：档位从存档套用到 <html>，版面立刻是 xl
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
    // 默认全开：区块都在（进度条、指标、日期、鼓励语都在折算后的版面里）
    assert.equal(await flag(page, 'progress'), 'true');
    assert.ok(await shown(page, `${card} .card-date-group`), 'date group visible by default');

    const toggle = (field) => page.locator(`#f-${field}`).click();

    await toggle('showCardDate');
    assert.equal(await flag(page, 'date'), 'false');
    await until(async () => !(await shown(page, `${card} .card-date-group`)), 2000, 'date group hidden');
    // 日期开关只藏日期与农历：状态标签（上班中 / 午休 / 已下班）必须还在
    assert.ok(await shown(page, `${card} .card-badge`), 'status badge must stay visible');

    await toggle('showCardMetrics');
    await until(async () => !(await shown(page, `${card} .card-metrics`)), 2000, 'metrics hidden');
    assert.equal(await flag(page, 'metrics'), 'false');
    assert.ok(await shown(page, `${card} .card-amount`), 'the amount is not a switch target');

    await toggle('showCardProgress');
    await until(async () => !(await shown(page, `${card} .card-progress`)), 2000, 'progress hidden');
    // 收起进度条不能连倒数一起收掉：倒数只是换到另一行
    assert.ok(await shown(page, `${card} .card-countdown`), 'countdown survives hidden progress');

    await toggle('showCardPayday');
    await until(async () => (await flag(page, 'payday')) === 'false', 2000, 'payday off');
    await toggle('showCardCheer');
    await until(async () => (await flag(page, 'cheer')) === 'false', 2000, 'cheer off');
    // 发薪日与鼓励语在旧档里本来就可能是空的：开关关掉后无论如何都不能出现
    assert.ok(!(await shown(page, `${card} .card-payday`)), 'payday hidden');
    assert.ok(!(await shown(page, `${card} .card-cheer`)), 'cheer hidden');
    // 全部关掉后卡片仍然有内容（状态与金额），不会变成空框
    assert.ok(await shown(page, `${card} .card-badge`), 'badge still visible after hiding everything');
    assert.ok(await shown(page, `${card} .card-amount`), 'amount still visible after hiding everything');

    // 五个开关都写进存档，重开后保持
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
    // 中号开窗：宽度 340（与既有版本一致）
    assert.equal(await page.evaluate(() => window.__pip.calls[0].width), 340);
    // 小窗文件也要拿到同一档位（卡片字号由该文件的 <html> 决定）
    assert.equal(await page.evaluate(() => window.documentPictureInPicture.window?.document?.documentElement?.getAttribute('data-font-scale')), 'm');
    const initialAmountSize = await page.evaluate(() => parseFloat(getComputedStyle(window.documentPictureInPicture.window.document.querySelector('.card-amount')).fontSize));

    await openSettings(page);
    await pickScale(page, 'xl');
    // 小窗开着：字号换档同时把窗口改宽（best-effort：浏览器可能拒绝，stub 里会记录）
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
