// 悬浮小窗（Document PiP）：以 stub 取代 documentPictureInPicture。
// stub 的 requestWindow 回传一个 iframe 的 window（独立 document），
// 其 setInterval / clearInterval 转给已被 page.clock 接管的主视窗计时器，并记录存活的 id，
// 用来检查「计时器跑在 PiP 视窗」与「关闭后没有残留计时器」。真实 PiP 留给 Task 7 实机验证。
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, launch, openAt, expectedAutoUrls, pipStub } from './harness.mjs';

const T1412 = '2026-11-03T14:12:00+08:00';
const T1830 = '2026-11-03T18:30:00+08:00';

const stub = (opts = {}) => ({ content: `(${pipStub})(${JSON.stringify(opts)})` });
const unsupported = {
  content: 'delete Window.prototype.documentPictureInPicture; delete window.documentPictureInPicture;',
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
  const { context, page, errors, external, consoleErrors, autoUrls } = await openAt(browser, server.url, iso, opts);
  try {
    // R19：开页只会请求「自动检查」该请求的网址（11 月前为 0 个）；一律被 harness 中止（离线）
    assert.deepEqual(autoUrls, expectedAutoUrls(iso), 'auto-check requests on load');
    await fn(page);
    assert.deepEqual(errors.map(String), [], 'no uncaught page errors');
    assert.deepEqual(consoleErrors, [], 'no console errors (blocked external requests are counted separately)');
    assert.deepEqual(external, autoUrls, 'no external request besides the load-time auto-check');
  } finally {
    await context.close();
  }
}

const pip = (page) => page.frameLocator('iframe.pip-stub');
const txt = (loc) => loc.first().textContent().then((s) => (s ?? '').trim());
const floatBtn = (page) => page.locator('#btn-float');
const placeholder = (page) => page.getByRole('button', { name: '已悬浮 · 点此收回' });

test('float moves the card into the PiP document (sm) and the X / pagehide brings it back', () =>
  withPage(T1412, async (page) => {
    assert.equal(await floatBtn(page).isEnabled(), true);
    assert.equal(await placeholder(page).isVisible(), false);
    await floatBtn(page).click();
    await pip(page).locator('#status-card').waitFor();
    assert.deepEqual(await page.evaluate(() => window.__pip.calls), [{ width: 340, height: 280 }]);
    assert.equal(await page.locator('#status-card').count(), 0, 'card left the main document');

    const c = pip(page).locator('#status-card');
    assert.equal(await c.getAttribute('data-size'), 'sm');
    assert.equal(await txt(c.locator('.card-date')), '2026/11/03 周二');
    assert.equal(await txt(c.locator('.card-badge')), '上班中');
    assert.equal(await txt(c.locator('.card-amount')), '¥ 194.2857');
    assert.equal(await txt(c.locator('.metric-rate .metric-value')), '¥0.0128/秒');
    assert.equal(await txt(c.locator('.metric-month .metric-value')), '¥518.10');
    assert.equal(await txt(c.locator('.card-progress-text')), '已工作 4小时12分 / 共 7小时');
    assert.equal(await c.locator('[role=progressbar]').isVisible(), true);
    assert.equal(await c.locator('.card-gear').isVisible(), true, 'gear shows in the small window');
    assert.equal(await c.locator('.metric-hourly').isVisible(), false, '时薪 only on the main page');
    assert.equal(await c.locator('.metric-daily').isVisible(), false, '今日满勤可得 only on the main page');
    // 样式与语言复制进 PiP 文档
    assert.equal(await pip(page).locator('html').getAttribute('lang'), 'zh-CN');
    assert.equal(await pip(page).locator('body').evaluate((b) => getComputedStyle(b).margin), '0px');

    // 主分页：占位卡出现，按钮文案变「收回小窗」
    assert.equal(await placeholder(page).isVisible(), true);
    assert.equal(await txt(page.locator('.pip-placeholder-note')), '状态卡正显示在悬浮小窗里');
    assert.equal(await placeholder(page).getAttribute('aria-describedby'), 'pip-placeholder-note');
    assert.equal(await txt(floatBtn(page)), '收回小窗');
    // R38：「请保持本页开启」在左栏按钮下方，悬浮时才出现，并作为按钮的描述
    assert.equal(await txt(page.locator('.card-col #float-keep')), '请保持本页开启：关闭本页，小窗也会一起关闭');
    assert.equal(await page.locator('#float-keep').isVisible(), true);
    assert.equal(await floatBtn(page).getAttribute('aria-describedby'), 'float-keep');
    assert.ok(!(await page.locator('#card-slot').innerText()).includes('194'), 'placeholder shows no amount');

    // 使用者按 PiP 的 X：浏览器触发 pagehide
    await page.evaluate(() => window.documentPictureInPicture.window.close());
    assert.equal(await page.locator('#card-slot #status-card').count(), 1, 'card back in the main page');
    assert.equal(await page.locator('#status-card').getAttribute('data-size'), 'lg');
    assert.equal(await placeholder(page).isVisible(), false);
    assert.equal(await txt(floatBtn(page)), '悬浮成小窗');
    assert.equal(await page.locator('#float-keep').isVisible(), false, 'keep-open note gone after closing');
    assert.equal(await floatBtn(page).getAttribute('aria-describedby'), null);
    assert.equal(await page.locator('#status-card .metric-hourly').isVisible(), true);
    assert.equal(await page.locator('#status-card .card-gear').isVisible(), false);
  }, { init: stub() }));

test('placeholder click, the float button and gear all close the PiP; gear opens 基本设置', () =>
  withPage(T1412, async (page) => {
    await floatBtn(page).click();
    await pip(page).locator('#status-card').waitFor();
    await placeholder(page).click();
    assert.equal(await page.locator('#card-slot #status-card').count(), 1);
    assert.equal(await page.evaluate(() => window.documentPictureInPicture.window), null, 'PiP closed');
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'btn-float', 'focus not lost');

    await floatBtn(page).click();
    await pip(page).locator('#status-card').waitFor();
    await floatBtn(page).click(); // 「收回小窗」
    assert.equal(await page.locator('#card-slot #status-card').count(), 1);

    const settingsTab = page.getByRole('tab', { name: '基本设置' });
    assert.equal(await settingsTab.getAttribute('aria-selected'), 'false');
    await floatBtn(page).click();
    assert.equal(await pip(page).locator('#status-card .card-gear').getAttribute('aria-label'), '收回小窗并打开基本设置');
    await pip(page).locator('#status-card .card-gear').click();
    assert.equal(await page.locator('#card-slot #status-card').count(), 1, 'gear brings the card back');
    assert.equal(await page.evaluate(() => window.documentPictureInPicture.window), null);
    assert.equal(await settingsTab.getAttribute('aria-selected'), 'true', 'gear selects 基本设置');
    assert.equal(await page.getByLabel('月薪').isVisible(), true, 'settings panel shown');
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'tab-settings', 'focus on the 基本设置 tab');
  }, { init: stub() }));

// R45：齿轮先 window.focus()（开启者视窗，Chrome 123+ 在小窗内的点击手势下会把开启者带到前面），再收回小窗，再切到「基本设置」
async function gearOrder(page, focusImpl) {
  await page.evaluate((mode) => {
    window.__order = [];
    window.focus = () => {
      window.__order.push('focus');
      if (mode === 'throw') throw new Error('focus blocked');
    };
    const tab = document.getElementById('tab-settings');
    new MutationObserver(() => { if (tab.getAttribute('aria-selected') === 'true') window.__order.push('select'); })
      .observe(tab, { attributes: true, attributeFilter: ['aria-selected'] });
  }, focusImpl);
  await floatBtn(page).click();
  await pip(page).locator('#status-card').waitFor();
  await page.evaluate(() => {
    const w = window.documentPictureInPicture.window;
    const orig = w.close;
    w.close = () => { window.__order.push('close'); orig(); };
  });
  await pip(page).locator('#status-card .card-gear').click();
  await page.evaluate(() => new Promise((r) => queueMicrotask(r))); // MutationObserver 回调
  return page.evaluate(() => window.__order);
}

test('R45: gear calls window.focus() first, then closes the PiP, then selects 基本设置 (focused)', () =>
  withPage(T1412, async (page) => {
    assert.deepEqual(await gearOrder(page, 'ok'), ['focus', 'close', 'select']);
    assert.equal(await page.evaluate(() => window.documentPictureInPicture.window), null, 'PiP closed');
    assert.equal(await page.locator('#card-slot #status-card').count(), 1);
    assert.equal(await page.getByRole('tab', { name: '基本设置' }).getAttribute('aria-selected'), 'true');
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'tab-settings');
  }, { init: stub() }));

test('R45: a throwing window.focus() does not prevent closing the PiP and the tab switch', () =>
  withPage(T1412, async (page) => {
    assert.deepEqual(await gearOrder(page, 'throw'), ['focus', 'close', 'select']);
    assert.equal(await page.evaluate(() => window.documentPictureInPicture.window), null);
    assert.equal(await page.getByRole('tab', { name: '基本设置' }).getAttribute('aria-selected'), 'true');
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'tab-settings');
  }, { init: stub() }));

test('PiP timer keeps updating while the opener is hidden; no ghost timers after reopen', () =>
  withPage(T1412, async (page) => {
    // 在主视窗计时器上加记录（所有存活的 interval id，包括 stub 转来的 PiP 计时器）
    await page.evaluate(() => {
      const live = new Set();
      const si = window.setInterval.bind(window);
      const ci = window.clearInterval.bind(window);
      window.setInterval = (fn, ms) => { const id = si(fn, ms); live.add(id); return id; };
      window.clearInterval = (id) => { live.delete(id); ci(id); };
      window.__live = live;
    });
    // 让主分页重建一次计时器，使它进入记录
    for (const v of ['reduce', 'no-preference']) {
      await page.evaluate(() => {
        window.__mq = new Promise((r) => matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', r, { once: true }));
      });
      await page.emulateMedia({ reducedMotion: v });
      await page.evaluate(() => window.__mq); // change 事件是异步派发的
    }
    const state = () => page.evaluate(() => ({
      live: [...window.__live],
      pip: window.__pip.wins.map((w) => [...w.active]),
    }));
    let s = await state();
    assert.equal(s.live.length, 1, 'one opener timer before floating');

    for (let round = 0; round < 2; round++) {
      await floatBtn(page).click();
      await pip(page).locator('#status-card').waitFor();
      s = await state();
      assert.equal(s.live.length, 1, `round ${round}: exactly one live timer while floating`);
      assert.deepEqual(s.pip[round], s.live, `round ${round}: the live timer belongs to the PiP window`);

      // 主分页进入背景：PiP 计时器照常更新
      await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', { get: () => 'hidden', configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
      });
      const c = pip(page).locator('#status-card .card-amount');
      const before = await txt(c);
      await page.clock.runFor(1000);
      assert.notEqual(await txt(c), before, `round ${round}: PiP amount advanced while opener hidden`);
      await page.evaluate(() => {
        delete document.visibilityState;
        document.dispatchEvent(new Event('visibilitychange'));
      });

      await page.evaluate(() => window.documentPictureInPicture.window.close());
      s = await state();
      assert.equal(s.live.length, 1, `round ${round}: one opener timer after closing`);
      assert.ok(s.pip.every((a) => a.length === 0), `round ${round}: no PiP timers left`);
      assert.ok(!s.pip.flat().includes(s.live[0]));
    }
    // 收回后主分页计时器仍在跑
    const main = page.locator('#status-card .card-amount');
    const before = await txt(main);
    await page.clock.runFor(1000);
    assert.notEqual(await txt(main), before);
  }, { init: stub() }));

// R46：减少动态模式下，悬浮时由小窗的 setTimeout 对齐整秒驱动；收回后小窗不留计时器，主分页接手
test('reduced motion while floating: the PiP window drives aligned 1 s ticks; nothing left behind after closing', () =>
  withPage('2026-11-03T14:12:00.600+08:00', async (page) => {
    await floatBtn(page).click();
    await pip(page).locator('#status-card').waitFor();
    const c = pip(page).locator('#status-card .card-countdown + .sr-text');
    await page.evaluate(() => {
      window.__cd = [];
      const el = window.documentPictureInPicture.window.document.querySelector('#status-card .card-countdown + .sr-text');
      new MutationObserver(() => window.__cd.push([Date.now(), el.textContent])).observe(el, { childList: true, characterData: true, subtree: true });
    });
    assert.equal(await txt(c), '距下班 2小时48分0秒');
    await page.clock.runFor(10000);
    const cd = await page.evaluate(() => window.__cd);
    assert.equal(cd.length, 10, 'one change per second');
    assert.ok(cd.every(([ms]) => ms % 1000 < 20), `aligned to whole seconds: ${cd.map(([ms]) => ms % 1000)}`);
    assert.equal(cd.at(-1)[1], '距下班 2小时47分50秒');
    const pending = await page.evaluate(() => window.__pip.wins[0].timeouts.size);
    assert.equal(pending, 1, 'exactly one pending aligned timeout, owned by the PiP window');
    await page.evaluate(() => window.documentPictureInPicture.window.close());
    assert.equal(await page.evaluate(() => window.__pip.wins[0].timeouts.size), 0, 'PiP timeout cleared on close');
    const main = page.locator('#status-card .card-countdown + .sr-text');
    const before = await txt(main);
    await page.clock.runFor(1000);
    assert.notEqual(await txt(main), before, 'main page ticks again');
  }, { init: stub(), reducedMotion: true }));

// 高度随内容（spec §4.2）：开窗前量好，小窗内不出现卷轴
async function floatFits(page) {
  await floatBtn(page).click();
  await pip(page).locator('#status-card').waitFor();
  const [req] = await page.evaluate(() => window.__pip.calls);
  assert.equal(req.width, 340, 'width fixed');
  assert.ok(req.height >= 280, `height >= 280 (got ${req.height})`);
  // about:blank 文档是 quirks 模式：卷动元素是 body，不是 html，故用 scrollingElement
  const m = await pip(page).locator('html').evaluate((el) => {
    const se = el.ownerDocument.scrollingElement;
    return { sh: se.scrollHeight, ch: se.clientHeight, card: el.ownerDocument.getElementById('status-card').getBoundingClientRect().height };
  });
  assert.ok(m.sh <= m.ch, `PiP content fits without scrolling (scrollHeight ${m.sh} > clientHeight ${m.ch})`);
  assert.ok(m.card <= req.height, `card ${m.card} fits requested height ${req.height}`);
  return { req, m };
}
async function setCheerAndPayday(page) {
  await page.getByRole('tab', { name: '基本设置' }).click();
  await page.getByLabel('鼓励语').fill('今天也要好好加油，下班吃顿好的');
  await page.getByLabel('发薪日').selectOption({ label: '每月 5 号' });
}

test('PiP height: default requests 280 and fits', () =>
  withPage(T1412, async (page) => {
    const { req } = await floatFits(page);
    assert.equal(req.height, 280);
  }, { init: stub() }));

test('PiP height grows with cheer + payday (working) and fits', () =>
  withPage(T1412, async (page) => {
    await setCheerAndPayday(page);
    const { req } = await floatFits(page);
    assert.ok(req.height > 280, `taller than default (got ${req.height})`);
    assert.equal(await pip(page).locator('.card-cheer').isVisible(), true);
    assert.equal(await pip(page).locator('.card-payday').isVisible(), true);
  }, { init: stub() }));

test('PiP height with cheer + payday after work fits', () =>
  withPage(T1830, async (page) => {
    await setCheerAndPayday(page);
    await floatFits(page);
    assert.equal(await txt(pip(page).locator('.card-badge')), '已下班');
    assert.equal(await pip(page).locator('.card-payday').isVisible(), true);
  }, { init: stub() }));

test('2027: year note shows in the PiP card and the window is not clipped', () =>
  withPage('2027-01-04T10:00:00+08:00', async (page) => {
    await setCheerAndPayday(page);
    await floatFits(page);
    assert.equal(await pip(page).locator('.card-year').isVisible(), true);
    assert.equal(await txt(pip(page).locator('.card-year')), '2027 年只标了法定假日，补假和调休未标出');
  }, { init: stub() }));

test('2027-02 春节: PiP card shows the shortened year note and the window is not clipped', () =>
  withPage('2027-02-05T10:00:00+08:00', async (page) => {
    await setCheerAndPayday(page);
    await floatFits(page);
    assert.equal(await pip(page).locator('.card-badge').innerText(), '法定假日', 'Task 19 H3: float badge never shows the holiday name (innerText: the hidden part is not rendered)');
    assert.equal(await txt(pip(page).locator('.card-year')), '2027 年只标了法定假日，补假和调休未标出');
    assert.equal(await txt(pip(page).locator('.card-label')), '今天休息 · 春节');
  }, { init: stub() }));

test('2026: no year note in the PiP card', () =>
  withPage(T1412, async (page) => {
    await floatFits(page);
    assert.equal(await pip(page).locator('.card-year').isVisible(), false);
  }, { init: stub() }));

test('unsupported browser: float button disabled with explanatory text', () =>
  withPage(T1412, async (page) => {
    assert.equal(await page.evaluate(() => 'documentPictureInPicture' in window), false);
    // R52：aria-disabled（仍可聚焦、读得到原因），不是原生 disabled
    assert.equal(await floatBtn(page).getAttribute('aria-disabled'), 'true');
    assert.equal(await floatBtn(page).evaluate((b) => b.disabled), false);
    const note = page.getByText('当前浏览器不支持悬浮小窗，请使用 Edge 或 Chrome（116 及以上）');
    assert.equal(await note.isVisible(), true);
    const id = await note.getAttribute('id');
    assert.equal(await floatBtn(page).getAttribute('aria-describedby'), id);
  }, { init: unsupported }));

test('supported browser: no explanatory note', () =>
  withPage(T1412, async (page) => {
    assert.equal(await page.getByText('当前浏览器不支持悬浮小窗，请使用 Edge 或 Chrome（116 及以上）').isVisible(), false);
    assert.equal(await floatBtn(page).getAttribute('aria-describedby'), null);
  }, { init: stub() }));

test('rejected request: message shown, card stays in the main page', () =>
  withPage(T1412, async (page) => {
    await floatBtn(page).click();
    await page.getByText('小窗没能打开，请再试一次').waitFor();
    assert.equal(await page.locator('#card-slot #status-card').count(), 1);
    assert.equal(await placeholder(page).isVisible(), false);
    assert.equal(await txt(floatBtn(page)), '悬浮成小窗');
    assert.equal(await floatBtn(page).isEnabled(), true);
  }, { init: stub({ reject: true }) }));
