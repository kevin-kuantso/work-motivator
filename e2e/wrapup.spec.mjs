// Task 17：已下班正反馈。文案 / 进度百分比 / 一次性高亮（实时转入才有；载入已下班、减少动态都没有）/ 版面不变 / PiP 宽度不截断。
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, launch, openAt, expectedAutoUrls, pipStub } from './harness.mjs';

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

const card = '#status-card';
const text = (page, sel) => page.locator(sel).first().textContent().then((s) => (s ?? '').trim());
const celebrating = (page) => page.evaluate(() => document.querySelector('#status-card .card-amount').classList.contains('is-celebrating'));

// 本文件断言的是中国地区文案与金额：明确写入旧版（v1，无地区）设置，让应用走「旧数据一律归中国」的迁移路径，
// 不依赖应用当前的新用户默认地区（台湾）。旧设置里午休 11:30–13:00 与「开启午休」是一组合法值。
const CN_LEGACY = { version: 1, salary: 6800, start: '08:30', end: '17:00', lunchOn: true, lunchStart: '11:30', lunchEnd: '13:00', weekends: false, payday: null, cheer: '' };
const CN_SEED = `if (!sessionStorage.getItem('cn-seeded')) { localStorage.setItem('work-motivator-v1', ${JSON.stringify(JSON.stringify(CN_LEGACY))}); sessionStorage.setItem('cn-seeded', '1'); }`;
// 与既有的 init 组在一起：字符串相加、函数转成字符串、{ content } 加前缀、null / undefined 只留种子、{ path } 原样。
const seeded = (init) => {
  if (init == null) return CN_SEED;
  if (typeof init === 'string') return `${CN_SEED}\n${init}`;
  if (typeof init === 'function') return `${CN_SEED}\n(${init.toString()})();`;
  if (typeof init.content === 'string') return { ...init, content: `${CN_SEED}\n${init.content}` };
  return init;
};

async function withPage(iso, fn, opts) {
  const { context, page, errors, external, consoleErrors, autoUrls } = await openAt(browser, server.url, iso, { ...opts, init: seeded(opts?.init) });
  try {
    assert.deepEqual(autoUrls, expectedAutoUrls(iso), 'auto-check requests on load');
    await fn(page);
    assert.deepEqual(errors.map(String), [], 'no uncaught page errors');
    assert.deepEqual(consoleErrors, [], 'no console errors');
    assert.deepEqual(external, autoUrls, 'no new external request (Task 17 adds none)');
  } finally {
    await context.close();
  }
}

// 载入时就是目标时刻（harness 会提前 5 秒载入，会被算成实时转入，所以这里自己开）
async function openLoadedAt(iso, reducedMotion = false) {
  const context = await browser.newContext({ timezoneId: 'Asia/Shanghai', locale: 'zh-CN', viewport: { width: 1200, height: 900 }, reducedMotion: reducedMotion ? 'reduce' : 'no-preference' });
  await context.route((u) => !/^(localhost|127\.0\.0\.1)$/.test(u.hostname), (route) => route.abort('internetdisconnected'));
  const page = await context.newPage();
  await page.addInitScript(CN_SEED);
  await page.clock.install({ time: new Date(iso) });
  await page.goto(server.url);
  await page.clock.pauseAt(new Date(new Date(iso).getTime() + 1000));
  return { context, page };
}

test('18:00 on the verification day: wrap-up label, 已赚占月薪 14%, amount and 本月累计 unchanged', () =>
  withPage('2026-11-04T18:00:00+08:00', async (page) => {
    assert.equal(await text(page, `${card} .card-badge`), '已下班');
    assert.equal(await text(page, `${card} .card-label`), '今天辛苦了，收工！');
    assert.equal(await text(page, `${card} .card-amount`), '¥ 323.81');
    assert.equal(await text(page, `${card} .metric-rate .metric-label`), '已赚占月薪');
    assert.equal(await text(page, `${card} .metric-rate .metric-value`), '14%');
    assert.equal(await text(page, `${card} .metric-month .metric-value`), '¥971.43');
    assert.equal(await text(page, `${card} .metric-month .metric-label`), '本月累计');
  }));

test('other statuses keep the old copy (working, lunch, before, rest day, paid leave)', async () => {
  await withPage('2026-11-04T10:00:00+08:00', async (page) => {
    assert.equal(await text(page, `${card} .card-label`), '今天已经赚了');
    assert.equal(await text(page, `${card} .metric-rate .metric-label`), '当前赚钱速度');
  });
  await withPage('2026-11-04T12:00:00+08:00', async (page) => {
    assert.equal(await text(page, `${card} .card-label`), '今天已经赚了');
    assert.equal(await text(page, `${card} .metric-rate .metric-label`), '午休结束'); // Task 19 H2
  });
  await withPage('2026-11-04T07:00:00+08:00', async (page) => {
    assert.equal(await text(page, `${card} .card-label`), '08:30 开始计薪'); // Task 19 M1
    assert.equal(await text(page, `${card} .metric-rate .metric-label`), '已赚占月薪'); // Task 19 mini round (F6)
  });
  await withPage('2026-11-07T18:00:00+08:00', async (page) => { // 周六
    assert.equal(await text(page, `${card} .card-badge`), '休息日');
    const body = await page.evaluate(() => document.body.innerText);
    assert.ok(!body.includes('收工'), 'no wrap-up copy on a rest day');
    assert.equal(await text(page, `${card} .metric-rate .metric-label`), '已赚占月薪'); // Task 19 H2
  });
  const mark = (v) => ({ content: `localStorage.setItem('work-motivator-v1', JSON.stringify({ ...${JSON.stringify(CN_LEGACY)}, marks: { '2026-11-04': '${v}' } }))` });
  await withPage('2026-11-04T18:00:00+08:00', async (page) => {
    assert.equal(await text(page, `${card} .card-badge`), '带薪假');
    assert.equal(await text(page, `${card} .card-label`), '今天一共赚了');
    assert.equal(await text(page, `${card} .metric-rate .metric-label`), '已赚占月薪'); // Task 19 H2
    const body = await page.evaluate(() => document.body.innerText);
    assert.ok(!body.includes('收工'), 'no wrap-up copy on paid leave');
  }, { init: mark('paidLeave') });
  await withPage('2026-11-04T18:00:00+08:00', async (page) => {
    assert.equal(await text(page, `${card} .card-badge`), '无薪假');
    const body = await page.evaluate(() => document.body.innerText);
    assert.ok(!body.includes('收工'), 'no wrap-up copy on unpaid leave');
  }, { init: mark('unpaidLeave') });
});

test('transition 16:59:58 -> 17:00:02 applies the highlight class once, then removes it', () =>
  withPage('2026-11-04T16:59:58+08:00', async (page) => {
    assert.equal(await text(page, `${card} .card-badge`), '上班中');
    assert.equal(await celebrating(page), false);
    const seen = [];
    for (let i = 0; i < 40; i++) { // 4 s，每 100 ms 一格
      await page.clock.runFor(100);
      seen.push(await celebrating(page));
    }
    assert.equal(await text(page, `${card} .card-badge`), '已下班');
    assert.equal(await text(page, `${card} .card-label`), '今天辛苦了，收工！');
    const on = seen.indexOf(true);
    assert.ok(on >= 0, 'class applied after the transition');
    assert.ok(on >= 19, `not applied before 17:00:00 (first at step ${on})`);
    const off = seen.indexOf(false, on);
    assert.ok(off > on, 'class removed afterwards');
    assert.equal(seen.indexOf(true, off), -1, 'applied once only');
    assert.ok(off - on >= 11 && off - on <= 13, `about 1.2 s (${off - on} steps)`);
  }));

test('a >5 s clock jump across 17:00 (hidden tab / sleep) does not apply the highlight', () =>
  withPage('2026-11-04T16:59:58+08:00', async (page) => {
    assert.equal(await text(page, `${card} .card-badge`), '上班中');
    await page.clock.fastForward(10000); // 一次跳过 17:00，下一次绘制距上次 > 5 s
    await page.clock.runFor(100);
    assert.equal(await text(page, `${card} .card-badge`), '已下班');
    assert.equal(await text(page, `${card} .card-label`), '今天辛苦了，收工！');
    for (let i = 0; i < 25; i++) {
      assert.equal(await celebrating(page), false, `step ${i}`);
      await page.clock.runFor(100);
    }
  }));

test('page load after hours never applies the highlight', async () => {
  const { context, page } = await openLoadedAt('2026-11-04T18:00:00+08:00');
  try {
    assert.equal(await text(page, `${card} .card-badge`), '已下班');
    for (let i = 0; i < 30; i++) {
      assert.equal(await celebrating(page), false);
      await page.clock.runFor(100);
    }
  } finally {
    await context.close();
  }
});

test('prefers-reduced-motion: the highlight class is never applied', () =>
  withPage('2026-11-04T16:59:58+08:00', async (page) => {
    for (let i = 0; i < 12; i++) {
      await page.clock.runFor(500);
      assert.equal(await celebrating(page), false, `step ${i}`);
    }
    assert.equal(await text(page, `${card} .card-badge`), '已下班');
    assert.equal(await text(page, `${card} .card-label`), '今天辛苦了，收工！');
  }, { reducedMotion: true }));

test('the highlight style exists in the PiP document and is a real animation (none under reduced motion)', async () => {
  await withPage('2026-11-04T16:59:58+08:00', async (page) => {
    const css = await page.evaluate(() => [...document.querySelectorAll('style')].map((s) => s.textContent).join('\n'));
    const flat = css.replace(/\s+/g, '');
    assert.match(flat, /\.card-amount\.is-celebrating\{[^}]*animation:wm-cheer1\.2s/);
    assert.match(flat, /@keyframeswm-cheer/);
    assert.match(flat, /prefers-reduced-motion:reduce\)\{\.card-amount\.is-celebrating\{animation:none;?\}\}/);
    // 同一份 <style> 文字由 copyDocumentLook 原样复制到 PiP，所以 PiP 里也有；这里实测计算样式
    await page.evaluate(() => { document.querySelector('#status-card .card-amount').classList.add('is-celebrating'); });
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#status-card .card-amount')).animationName), 'wm-cheer');
  });
  await withPage('2026-11-04T16:59:58+08:00', async (page) => {
    await page.evaluate(() => { document.querySelector('#status-card .card-amount').classList.add('is-celebrating'); });
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#status-card .card-amount')).animationName), 'none');
  }, { reducedMotion: true });
});

test('layout: 已下班 card height equals the old-copy card at 4 viewports, no scroll; 340 px card text not truncated', async () => {
  for (const [w, h] of [[1280, 585], [1366, 650], [1536, 730], [1920, 950]]) {
    await withPage('2026-11-04T18:00:00+08:00', async (page) => {
      const r = await page.evaluate(() => {
        const c = document.querySelector('#status-card');
        const label = c.querySelector('.card-label');
        const rateLabel = c.querySelector('.metric-rate .metric-label');
        const rate = c.querySelector('.metric-rate .metric-value');
        const ht = () => c.getBoundingClientRect().height;
        const wrap = ht();
        const [l, rl, rv] = [label.textContent, rateLabel.textContent, rate.textContent];
        label.textContent = '今天一共赚了';
        rateLabel.textContent = '当前赚钱速度';
        rate.textContent = '¥0.0000 /秒';
        const old = ht();
        label.textContent = l; rateLabel.textContent = rl; rate.textContent = rv;
        const amt = c.querySelector('.card-amount');
        const posBefore = amt.getBoundingClientRect();
        const textLeft = (() => { const g = document.createRange(); g.selectNodeContents(amt); return g.getBoundingClientRect().left; })();
        amt.classList.add('is-celebrating');
        const box = amt.getBoundingClientRect();
        const withClass = ht();
        const inset = textLeft - box.left;
        const shifted = Math.abs(box.left - posBefore.left) > 6.01 || Math.abs(textLeft - (() => { const g = document.createRange(); g.selectNodeContents(amt); return g.getBoundingClientRect().left; })()) > 0.01;
        amt.classList.remove('is-celebrating');
        const de = document.documentElement;
        return { withClass, inset, shifted, wrap, old, scrollX: de.scrollWidth > de.clientWidth, scrollY: de.scrollHeight > de.clientHeight };
      });
      assert.equal(r.wrap, r.old, `card height unchanged at ${w}x${h}`);
      assert.equal(r.withClass, r.wrap, `highlight does not change card height at ${w}x${h}`);
      assert.ok(r.inset >= 6, `highlight box leaves >= 6px inset (${r.inset}) at ${w}x${h}`);
      assert.equal(r.shifted, false, `text does not move when highlight is applied at ${w}x${h}`);
      assert.equal(r.scrollX || r.scrollY, false, `no page scroll at ${w}x${h}`);
    }, { viewport: { width: w, height: h } });
  }
  await withPage('2026-11-04T18:00:00+08:00', async (page) => {
    const r = await page.evaluate(() => {
      const c = document.querySelector('#status-card');
      c.dataset.size = 'sm';
      c.style.width = '340px';
      const ht = () => c.getBoundingClientRect().height;
      const trunc = () => [...c.querySelectorAll('.card-label, .metric-label, .metric-value')]
        .filter((el) => el.offsetParent !== null && el.scrollWidth > el.clientWidth + 0.5).map((el) => el.textContent);
      const label = c.querySelector('.card-label');
      const rateLabel = c.querySelector('.metric-rate .metric-label');
      const rate = c.querySelector('.metric-rate .metric-value');
      const amt = c.querySelector('.card-amount');
      const tl = () => { const g = document.createRange(); g.selectNodeContents(amt); return g.getBoundingClientRect().left; };
      const t0 = tl();
      amt.classList.add('is-celebrating');
      const cel = { hc: ht(), inset: t0 - amt.getBoundingClientRect().left, moved: Math.abs(tl() - t0) > 0.01 };
      amt.classList.remove('is-celebrating');
      const wrap = { cel, h: ht(), trunc: trunc(), single: label.getBoundingClientRect().height < 30 && rateLabel.getBoundingClientRect().height < 24 };
      const [l, rl, rv] = [label.textContent, rateLabel.textContent, rate.textContent];
      label.textContent = '今天一共赚了'; rateLabel.textContent = '当前赚钱速度'; rate.textContent = '¥0.0000 /秒';
      const old = ht();
      label.textContent = l; rateLabel.textContent = rl; rate.textContent = rv;
      return { ...wrap, old };
    });
    assert.deepEqual(r.trunc, [], 'nothing truncated at 340 px');
    assert.equal(r.single, true, 'label and metric label stay on one line');
    assert.equal(r.h, r.old, 'PiP-width card height unchanged');
    assert.equal(r.cel.hc, r.h, 'highlight keeps 340 px card height');
    assert.ok(r.cel.inset >= 6, `340 px inset ${r.cel.inset}`);
    assert.equal(r.cel.moved, false, 'text does not move at 340 px');
  });
});

test('PiP: celebration runs in the floating window (class lands on the moved card; style cloned)', () =>
  withPage('2026-11-04T16:59:58+08:00', async (page) => {
    await page.locator('#btn-float').click();
    await page.frameLocator('iframe.pip-stub').locator('#status-card').waitFor();
    const inPip = await page.evaluate(() => Boolean(document.querySelector('iframe.pip-stub')?.contentDocument?.querySelector('#status-card')));
    assert.equal(inPip, true, 'card moved into the stub PiP document');
    let got = false;
    for (let i = 0; i < 40 && !got; i++) {
      await page.clock.runFor(100);
      got = await page.evaluate(() => document.querySelector('iframe.pip-stub').contentDocument.querySelector('#status-card .card-amount').classList.contains('is-celebrating'));
    }
    assert.equal(got, true, 'class applied inside PiP');
    const style = await page.evaluate(() => /wm-cheer/.test([...document.querySelector('iframe.pip-stub').contentDocument.querySelectorAll('style')].map((s) => s.textContent).join('')));
    assert.equal(style, true, 'celebrate keyframes cloned into PiP');
  }, { init: { content: `(${pipStub})(${JSON.stringify({})})` } }));
