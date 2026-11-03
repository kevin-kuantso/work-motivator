// 悬浮小窗（Document PiP）：以 stub 取代 documentPictureInPicture。
// stub 的 requestWindow 回传一个 iframe 的 window（独立 document），
// 其 setInterval / clearInterval 转给已被 page.clock 接管的主视窗计时器，并记录存活的 id，
// 用来检查「计时器跑在 PiP 视窗」与「关闭后没有残留计时器」。真实 PiP 留给 Task 7 实机验证。
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, launch, openAt } from './harness.mjs';

const T1412 = '2026-11-03T14:12:00+08:00';
const T1830 = '2026-11-03T18:30:00+08:00';

function pipStub(opts) {
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
  const { context, page, errors } = await openAt(browser, server.url, iso, opts);
  try {
    await fn(page);
    assert.deepEqual(errors.map(String), [], 'no uncaught page errors');
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
    assert.equal(await txt(c.locator('.metric-rate .metric-value')), '¥0.0128 /秒');
    assert.equal(await txt(c.locator('.metric-month .metric-value')), '¥518.10');
    assert.equal(await txt(c.locator('.card-progress-text')), '已工作 4.20 / 7.00 小时');
    assert.equal(await c.locator('[role=progressbar]').isVisible(), true);
    assert.equal(await c.locator('.card-gear').isVisible(), true, 'gear shows in the small window');
    assert.equal(await c.locator('.metric-hourly').isVisible(), false, '时薪 only on the main page');
    assert.equal(await c.locator('.metric-daily').isVisible(), false, '今日满勤可得 only on the main page');
    // 样式与语言复制进 PiP 文档
    assert.equal(await pip(page).locator('html').getAttribute('lang'), 'zh-CN');
    assert.equal(await pip(page).locator('body').evaluate((b) => getComputedStyle(b).margin), '0px');

    // 主分页：占位卡出现，按钮文案变「收回小窗」
    assert.equal(await placeholder(page).isVisible(), true);
    assert.equal(await txt(floatBtn(page)), '收回小窗');
    assert.ok(!(await page.locator('#card-slot').innerText()).includes('194'), 'placeholder shows no amount');

    // 使用者按 PiP 的 X：浏览器触发 pagehide
    await page.evaluate(() => window.documentPictureInPicture.window.close());
    assert.equal(await page.locator('#card-slot #status-card').count(), 1, 'card back in the main page');
    assert.equal(await page.locator('#status-card').getAttribute('data-size'), 'lg');
    assert.equal(await placeholder(page).isVisible(), false);
    assert.equal(await txt(floatBtn(page)), '悬浮成小窗');
    assert.equal(await page.locator('#status-card .metric-hourly').isVisible(), true);
    assert.equal(await page.locator('#status-card .card-gear').isVisible(), false);
  }, { init: stub() }));

test('placeholder click, header button and gear all close the PiP; gear scrolls to settings', () =>
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

    await page.evaluate(() => window.scrollTo(0, 0));
    await page.setViewportSize({ width: 1200, height: 300 });
    await floatBtn(page).click();
    await pip(page).locator('#status-card .card-gear').click();
    assert.equal(await page.locator('#card-slot #status-card').count(), 1, 'gear brings the card back');
    assert.equal(await page.evaluate(() => window.documentPictureInPicture.window), null);
    const top = await page.locator('#settings').evaluate((el) => el.getBoundingClientRect().top);
    assert.ok(Math.abs(top) < 2, `settings scrolled into view (top=${top})`);
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
  await page.getByLabel('鼓励语').fill('今天也要好好加油，下班吃顿好的');
  await page.getByRole('button', { name: /高级设置/ }).click();
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

test('unsupported browser: float button disabled with explanatory text', () =>
  withPage(T1412, async (page) => {
    assert.equal(await page.evaluate(() => 'documentPictureInPicture' in window), false);
    assert.equal(await floatBtn(page).isDisabled(), true);
    const note = page.getByText('请使用 Edge 或 Chrome（116 以上）');
    assert.equal(await note.isVisible(), true);
    const id = await note.getAttribute('id');
    assert.equal(await floatBtn(page).getAttribute('aria-describedby'), id);
  }, { init: unsupported }));

test('supported browser: no explanatory note', () =>
  withPage(T1412, async (page) => {
    assert.equal(await page.getByText('请使用 Edge 或 Chrome（116 以上）').isVisible(), false);
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
