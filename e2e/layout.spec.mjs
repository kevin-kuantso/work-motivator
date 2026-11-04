// 版面重设计（spec §13）：实测四种视窗不滚动、提示条两条通道、分页键盘与 ARIA、PgUp / PgDn、
// 只列当月类型的图例、「回到今天」强调、摘要行、对比度（实算）、用语扫描、<1000px 上下排列、等宽数字。
// 量测结果以 `MEASURE {...}` 打印，供报告引用（数字都是本次实际量到的）。
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, launch, openAt, expectedAutoUrls } from './harness.mjs';

const T1412 = '2026-11-03T14:12:00+08:00'; // 2026-11：周一为首共 6 周
const VIEWPORTS = [[1280, 585], [1366, 650], [1536, 730], [1920, 950]];
const TRAD = [...'設開時賺鐘勵週與請計錢進導電連線標題資儲歷這個們為麼來還說後點選擇關閉復讀寫據節農區塊網頁顯匯則數單項錯誤會發現狀態間預覽灣準備載檔記號啟離階動處無帶變當'];
const TW_TERMS = ['预设', '进阶', '有薪假', '使用者', '选单', '滑鼠', '萤幕', '点选', '自订', '未套用', '套用', '尚未公布'];

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

const text = (page, sel) => page.locator(sel).first().textContent().then((s) => (s ?? '').trim());
const cell = (page, label) => page.locator(`.cal-grid button[aria-label^="${label} "]`);
const tab = (page, name) => page.getByRole('tab', { name });
const focused = (page) => page.evaluate(() => ({ id: document.activeElement?.id ?? null, key: document.activeElement?.dataset?.key ?? null }));
const errorBar = '.notices .banner-error';
const infoBar = '.notices .banner-info';

// 在页面里量：面板底部、页面是否可滚动、格子最小行高、格子内容是否被裁切
const measure = (page) => page.evaluate(() => {
  const r = (el) => el.getBoundingClientRect();
  const panel = r(document.querySelector('.main-panel'));
  const rows = [...document.querySelectorAll('.cal-grid .cal-row:not(.cal-head)')];
  const days = [...document.querySelectorAll('.cal-grid .day')];
  const tablist = r(document.querySelector('[role=tablist]'));
  const sp = document.querySelector('#panel-settings');
  const cols = [...document.querySelectorAll('.settings-col')];
  return {
    vw: innerWidth,
    ih: innerHeight,
    scrollH: document.documentElement.scrollHeight,
    panelBottom: Math.round(panel.bottom * 10) / 10,
    slack: Math.round((innerHeight - panel.bottom) * 10) / 10,
    weeks: rows.length,
    rowMin: rows.length ? Math.round(Math.min(...rows.map((x) => r(x).height)) * 10) / 10 : null,
    lastRowInside: rows.length ? r(rows.at(-1)).bottom <= panel.bottom + 0.5 : null,
    clippedCells: days.filter((d) => d.scrollHeight > d.clientHeight + 0.5).length,
    cardBottom: Math.round(r(document.querySelector('#card-slot')).bottom),
    banners: [...document.querySelectorAll('.notices .banner:not([hidden])')].map((b) => Math.round(r(b).height)),
    tablistVisible: tablist.top >= 0 && tablist.bottom <= innerHeight,
    settingsInnerOverflow: sp.hidden ? null : sp.scrollHeight - sp.clientHeight,
    settingsColSlack: sp.hidden ? null : cols.map((c) => Math.round(r(sp).bottom - r(c.lastElementChild).bottom)),
  };
});

function assertFits(m, where) {
  assert.ok(m.panelBottom <= m.ih - 12, `${where}: panel bottom ${m.panelBottom} must be ≥ 12px above ${m.ih}`);
  assert.ok(m.scrollH <= m.ih, `${where}: no page scroll (scrollHeight ${m.scrollH} > innerHeight ${m.ih})`);
  assert.ok(m.cardBottom <= m.ih, `${where}: status card inside the viewport`);
}
function assertCalendarFits(m, where) {
  assertFits(m, where);
  assert.equal(m.weeks, 6, `${where}: 6-week month`);
  assert.ok(m.rowMin >= 40, `${where}: rows ≥ 40px (got ${m.rowMin})`);
  assert.equal(m.lastRowInside, true, `${where}: last week row inside the panel`);
  assert.equal(m.clippedCells, 0, `${where}: no clipped day cell`);
}
function assertSettingsFits(m, where) {
  assertFits(m, where);
  assert.equal(m.tablistVisible, true, `${where}: tab labels visible`);
}

test('four viewports with the first-run banner: calendar and 基本设置 need no page scroll (≥ 12px bottom slack)', () =>
  withPage(T1412, async (page) => {
    assert.equal(await page.locator(infoBar).getAttribute('data-id'), 'firstRun');
    for (const [w, ht] of VIEWPORTS) {
      await page.setViewportSize({ width: w, height: ht });
      await tab(page, '月历').click();
      const m = await measure(page);
      console.log(`MEASURE ${JSON.stringify({ case: 'firstRun', tab: 'calendar', ...m })}`);
      assertCalendarFits(m, `${w}x${ht} calendar`);
      await tab(page, '基本设置').click();
      const s = await measure(page);
      console.log(`MEASURE ${JSON.stringify({ case: 'firstRun', tab: 'settings', ...s })}`);
      assertSettingsFits(s, `${w}x${ht} settings`);
      assert.equal(s.settingsInnerOverflow, 0, `${w}x${ht}: settings fit without internal scroll`);
    }
  }));

// 损坏的已存设置 + 第一次保存成功（出现备份建议）+ 之后储存失败（例如配额满）= 合并错误条 + 信息条同时出现
const corruptThenQuota = {
  init: `
    if (!sessionStorage.getItem('seeded')) { localStorage.setItem('work-motivator-v1', '{oops'); sessionStorage.setItem('seeded', '1'); }
    (() => {
      const orig = Storage.prototype.setItem;
      let n = 0;
      Storage.prototype.setItem = function (k, v) {
        if (this === localStorage && k === 'work-motivator-v1' && ++n > 1) throw new DOMException('quota', 'QuotaExceededError');
        return orig.call(this, k, v);
      };
    })();`,
};

test('error channel merges storage failure + corrupt settings into ONE bar; info bar still shows; layout still fits', () =>
  withPage(T1412, async (page) => {
    const corrupt = '已保存的设置无法读取，现在使用的是默认值。如有备份，可用「导入备份」恢复。';
    const fail = '无法保存设置，关闭页面后会丢失。请先导出备份';
    assert.equal(await text(page, `${errorBar} .banner-text`), corrupt);
    await tab(page, '基本设置').click();
    await page.getByLabel('月薪').fill('7000'); // 第 1 次保存成功 → 备份建议
    assert.equal(await page.locator(infoBar).getAttribute('data-id'), 'backupNudge');
    await page.getByLabel('月薪').fill('7100'); // 第 2 次失败 → 储存失败
    assert.equal(await page.locator(errorBar).count(), 1, 'one merged error bar');
    assert.equal(await text(page, `${errorBar} .banner-text`), `${fail} · ${corrupt}`);
    assert.equal(await page.locator(errorBar).getAttribute('role'), 'alert');
    const btns = await page.locator(errorBar).getByRole('button').allTextContents();
    assert.deepEqual(btns, ['导出备份', '导入备份', '×'], 'export / import once each + close for the dismissible part');
    // 信息条没有被错误条压掉，两条都在、错误条在上、都在分页之上
    assert.equal(await page.locator(infoBar).isVisible(), true);
    const y = await page.evaluate(() => ['.notices .banner-error', '.notices .banner-info', '[role=tablist]'].map((s) => document.querySelector(s).getBoundingClientRect().top));
    assert.ok(y[0] < y[1] && y[1] < y[2], `order error < info < tabs (${y})`);

    for (const [w, ht] of VIEWPORTS) {
      await page.setViewportSize({ width: w, height: ht });
      await tab(page, '月历').click();
      const m = await measure(page);
      console.log(`MEASURE ${JSON.stringify({ case: 'error+info', tab: 'calendar', ...m })}`);
      assert.equal(m.banners.length, 2);
      assertCalendarFits(m, `${w}x${ht} calendar (error + info)`);
      await tab(page, '基本设置').click();
      const s = await measure(page);
      console.log(`MEASURE ${JSON.stringify({ case: 'error+info', tab: 'settings', ...s })}`);
      assertSettingsFits(s, `${w}x${ht} settings (error + info)`);
      assert.equal(s.settingsInnerOverflow, 0, `${w}x${ht}: settings fit without internal scroll (error + info)`);
    }
    // 状态卡最高的常见情况（鼓励语 + 发薪日）也不让页面滚动
    await page.setViewportSize({ width: 1280, height: 585 });
    await page.getByLabel('鼓励语').fill('今天也要好好加油，下班吃顿好的');
    await page.getByLabel('发薪日').selectOption({ label: '每月 5 号' });
    const tall = await measure(page);
    console.log(`MEASURE ${JSON.stringify({ case: 'error+info+cheer+payday', tab: 'settings', ...tall })}`);
    assertSettingsFits(tall, '1280x585 settings, tall card');
    await tab(page, '月历').click();
    const tallCal = await measure(page);
    console.log(`MEASURE ${JSON.stringify({ case: 'error+info+cheer+payday', tab: 'calendar', ...tallCal })}`);
    assertCalendarFits(tallCal, '1280x585 calendar, tall card');
    await tab(page, '基本设置').click();

    // 关闭：只关掉可关闭的「设置损坏」部分；储存失败在恢复前不可关闭
    await page.locator(errorBar).getByRole('button', { name: '关闭提示' }).click();
    assert.equal(await text(page, `${errorBar} .banner-text`), fail);
    assert.equal(await page.locator(errorBar).getByRole('button', { name: '关闭提示' }).count(), 0);
    assert.equal(await page.locator(infoBar).isVisible(), true, 'info bar unaffected');
    // 信息条关闭后错误条仍在
    await page.locator(infoBar).getByRole('button', { name: '知道了' }).click();
    assert.equal(await page.locator(infoBar).isVisible(), false);
    assert.equal(await page.locator(errorBar).isVisible(), true);
  }, corruptThenQuota));

test('storage failure bar disappears once saving works again', () =>
  withPage(T1412, async (page) => {
    await tab(page, '基本设置').click();
    await page.evaluate(() => { window.__fail = true; });
    await page.getByLabel('月薪').fill('7000');
    assert.equal(await page.locator(errorBar).isVisible(), true);
    await page.evaluate(() => { window.__fail = false; });
    await page.getByLabel('月薪').fill('7100');
    assert.equal(await page.locator(errorBar).isVisible(), false);
  }, { init: () => {
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) {
      if (window.__fail && k === 'work-motivator-v1') throw new DOMException('quota', 'QuotaExceededError');
      return orig.call(this, k, v);
    };
  } }));

test('tabs: tablist / tab / tabpanel ARIA, roving tabindex, ←/→/Home/End, hidden panel not focusable', () =>
  withPage(T1412, async (page) => {
    const info = () => page.evaluate(() => [...document.querySelectorAll('[role=tab]')].map((t) => {
      const p = document.getElementById(t.getAttribute('aria-controls'));
      return { id: t.id, sel: t.getAttribute('aria-selected'), ti: t.tabIndex, panelRole: p?.getAttribute('role'), labelledby: p?.getAttribute('aria-labelledby'), hidden: p?.hidden };
    }));
    assert.equal(await page.locator('[role=tablist]').count(), 1);
    assert.deepEqual(await info(), [
      { id: 'tab-calendar', sel: 'true', ti: 0, panelRole: 'tabpanel', labelledby: 'tab-calendar', hidden: false },
      { id: 'tab-settings', sel: 'false', ti: -1, panelRole: 'tabpanel', labelledby: 'tab-settings', hidden: true },
    ]);
    assert.equal(await page.locator('#f-salary').isVisible(), false, 'hidden panel content is not rendered / focusable');
    await page.locator('#tab-calendar').focus();
    await page.keyboard.press('Tab');
    assert.notEqual((await focused(page)).id, 'f-salary', 'Tab does not enter the hidden settings panel');
    assert.equal(await page.evaluate(() => document.activeElement.closest('#panel-calendar') !== null), true, 'Tab goes into the calendar panel');

    await page.locator('#tab-calendar').focus();
    const step = async (key, expect) => {
      await page.keyboard.press(key);
      const f = await focused(page);
      assert.equal(f.id, `tab-${expect}`, `${key} focuses ${expect}`);
      const st = await info();
      assert.deepEqual(st.map((x) => x.sel), st.map((x) => String(x.id === `tab-${expect}`)), `${key} selects ${expect}`);
      assert.deepEqual(st.map((x) => x.ti), st.map((x) => (x.id === `tab-${expect}` ? 0 : -1)), 'roving tabindex');
      assert.deepEqual(st.map((x) => x.hidden), st.map((x) => x.id !== `tab-${expect}`));
    };
    await step('ArrowRight', 'settings');
    await step('ArrowRight', 'calendar');
    await step('ArrowLeft', 'settings');
    await step('Home', 'calendar');
    await step('End', 'settings');

    // 首次提示「去修改」→ 切到基本设置，焦点在分页标签
    await tab(page, '月历').click();
    await page.locator(infoBar).getByRole('button', { name: '去修改' }).click();
    assert.equal(await tab(page, '基本设置').getAttribute('aria-selected'), 'true');
    assert.equal((await focused(page)).id, 'tab-settings');
    assert.equal(await page.getByLabel('月薪').isVisible(), true);

    // 切分页时收起日期菜单
    await tab(page, '月历').click();
    await cell(page, '11月7日').click();
    assert.equal(await page.locator('.day-menu').isVisible(), true);
    await page.keyboard.press('Escape');
    await page.locator('#tab-calendar').focus();
    await cell(page, '11月7日').click();
    await page.locator('#tab-settings').click();
    await tab(page, '月历').click();
    assert.equal(await page.locator('.day-menu').isVisible(), false);
  }));

test('PgUp / PgDn on a day cell: switch month, focus same day (clamped to month end), preventDefault; ignored elsewhere', () =>
  withPage(T1412, async (page) => {
    await page.evaluate(() => {
      window.__pg = [];
      window.addEventListener('keydown', (e) => { if (e.key.startsWith('Page')) window.__pg.push(e.defaultPrevented); });
    });
    const title = () => text(page, '.cal-title');
    await cell(page, '11月30日').focus();
    await page.keyboard.press('PageUp');
    assert.equal(await title(), '2026 年 10 月');
    assert.equal((await focused(page)).key, '2026-10-30');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('PageDown');
    assert.equal(await title(), '2026 年 11 月');
    assert.equal((await focused(page)).key, '2026-11-30', '10/31 → 11/30 (clamped)');
    await page.keyboard.press('PageDown');
    await page.keyboard.press('ArrowRight');
    assert.equal((await focused(page)).key, '2026-12-31');
    await page.keyboard.press('PageDown');
    assert.equal((await focused(page)).key, '2027-01-31');
    await page.keyboard.press('PageDown');
    assert.equal(await title(), '2027 年 2 月');
    assert.equal((await focused(page)).key, '2027-02-28');
    assert.equal(await page.evaluate(() => document.querySelectorAll('.cal-grid button[tabindex="0"]').length), 1);
    assert.equal(await page.locator('.cal-grid button[tabindex="0"]').getAttribute('data-key'), '2027-02-28', 'tab stop follows focus');
    assert.ok((await page.evaluate(() => window.__pg)).every(Boolean), 'all handled PgUp/PgDn were preventDefault-ed');
    // 修饰键：不处理
    await page.keyboard.press('Shift+PageUp');
    assert.equal(await title(), '2027 年 2 月');
    // 焦点不在日期格：不处理
    await page.locator('.cal-next').focus();
    await page.keyboard.press('PageDown');
    assert.equal(await title(), '2027 年 2 月');
    assert.equal((await page.evaluate(() => window.__pg)).at(-1), false);
    // R29：工具列不放可见的键盘提示；按键只写在「上月」「下月」的悬停提示里（无障碍名称仍是按钮文字）
    assert.equal(await page.locator('.cal-toolbar kbd, .cal-keys').count(), 0, 'no visible key hint in the toolbar');
    assert.doesNotMatch(await page.locator('.cal-toolbar').innerText(), /PgUp|PgDn|切换月份/);
    assert.equal(await page.locator('.cal-prev').getAttribute('title'), '上月（PgUp）');
    assert.equal(await page.locator('.cal-next').getAttribute('title'), '下月（PgDn）');
    assert.equal(await page.getByRole('button', { name: '‹ 上月', exact: true }).getAttribute('title'), '上月（PgUp）', 'accessible name = visible text; key in the description');
    assert.equal(await page.getByRole('button', { name: '下月 ›', exact: true }).getAttribute('title'), '下月（PgDn）');
  }));

test('legend lists only the kinds present this month on one line; 手动标记 / 重置本月标记 only with manual marks', () =>
  withPage(T1412, async (page) => {
    const kinds = () => page.locator('.cal-legend .legend-item').evaluateAll((els) => els.map((e) => e.dataset.kind));
    assert.deepEqual(await kinds(), ['weekend', 'today'], '2026-11: 周末 / 今天 only');
    assert.equal(await text(page, '.legend-hint'), '点日期可标记：调休 · 带薪假 · 无薪假');
    assert.equal(await page.getByRole('button', { name: '重置本月标记' }).isVisible(), false);
    await cell(page, '11月4日').click();
    await page.getByRole('menuitemradio', { name: /改为休息/ }).click();
    assert.deepEqual(await kinds(), ['weekend', 'rest', 'today', 'manual']);
    assert.match(await text(page, '.cal-legend'), /手动标记/);
    const reset = page.locator('.cal-summary').getByRole('button', { name: '重置本月标记' });
    assert.equal(await reset.isVisible(), true, 'reset lives in the summary row');
    const [rb, sb] = await Promise.all([reset.boundingBox(), page.locator('.cal-summary').boundingBox()]);
    assert.ok(Math.abs(rb.x + rb.width - (sb.x + sb.width)) <= 1, 'reset at the far right of the summary row');
    await reset.click();
    assert.deepEqual(await kinds(), ['weekend', 'today']);

    await page.getByRole('button', { name: /上月/ }).click();
    const oct = await kinds();
    assert.deepEqual(oct, ['weekend', 'holiday', 'makeup'], '2026-10: 周末 / 法定假日 / 调休上班, no 今天');
    assert.equal(await text(page, '.cal-legend [data-kind=holiday]'), '法定假日', '假');
    assert.equal(await text(page, '.cal-legend [data-kind=makeup]'), '调休上班', '班');
    assert.equal(await page.locator('.cal-legend [data-kind=holiday] svg.icon-holiday').count(), 1, 'same icon as the 假 tag');
    // 极端月份：所有类型都出现时仍是一行，右侧提示不被截断（1280 宽）
    await page.setViewportSize({ width: 1280, height: 585 });
    for (const [label, re] of [['10月12日', /^带薪假/], ['10月13日', /^无薪假/], ['10月14日', /改为休息/]]) {
      await cell(page, label).click();
      await page.getByRole('menuitemradio', { name: re }).click();
    }
    assert.deepEqual(await kinds(), ['weekend', 'holiday', 'makeup', 'rest', 'paid', 'unpaid', 'manual']);
    const lg = await page.evaluate(() => {
      const l = document.querySelector('.cal-legend');
      const hint = document.querySelector('.legend-hint');
      return { h: l.getBoundingClientRect().height, hintCut: hint.scrollWidth > hint.clientWidth };
    });
    assert.ok(lg.h <= 24, `legend single line (${lg.h}px)`);
    assert.equal(lg.hintCut, false, 'hint not truncated at 1280');
  }));

test('「回到今天」 is emphasised with the target month when viewing another month', () =>
  withPage(T1412, async (page) => {
    const btn = page.locator('.cal-today');
    assert.equal(await text(page, '.cal-today'), '回到今天');
    assert.equal(await btn.evaluate((b) => b.classList.contains('is-away')), false);
    // 用不带过渡的属性比较（背景色有过渡，而 page.clock 暂停时过渡不前进）
    const look = () => btn.evaluate((b) => `${getComputedStyle(b).color} ${getComputedStyle(b).fontWeight}`);
    const quiet = await look();
    await page.getByRole('button', { name: /下月/ }).click();
    assert.equal(await text(page, '.cal-today'), '回到今天 · 2026 年 11 月');
    assert.equal(await btn.evaluate((b) => b.classList.contains('is-away')), true);
    assert.notEqual(await look(), quiet, 'emphasis is visible');
    assert.equal(await btn.getAttribute('aria-disabled'), null, 'never disabled');
    await btn.click();
    assert.equal(await text(page, '.cal-title'), '2026 年 11 月');
    assert.equal(await text(page, '.cal-today'), '回到今天');
  }));

test('summary row: workdays and daily wage live; missing-table tag in the summary row (2027 clock)', async () => {
  await withPage(T1412, async (page) => {
    assert.equal(await text(page, '.cal-summary-text'), '本月应出勤 21 天 · 日薪 ¥323.81');
    assert.equal(await page.locator('.cal-year-tag').isVisible(), false);
    await cell(page, '11月7日').click();
    await page.getByRole('menuitemradio', { name: /改为上班/ }).click();
    assert.equal(await text(page, '.cal-summary-text'), '本月应出勤 22 天 · 日薪 ¥309.09');
    await page.getByRole('button', { name: /上月/ }).click();
    assert.equal(await text(page, '.cal-summary-text'), '本月应出勤 18 天 · 日薪 ¥377.78');
  });
  await withPage('2027-01-04T10:00:00+08:00', async (page) => {
    assert.equal(await text(page, '.cal-summary-text'), '本月应出勤 20 天 · 日薪 ¥340.00');
    assert.equal(await text(page, '.cal-summary .cal-year-tag'), '2027 年仅标法定假日');
    assert.equal(await page.locator('.cal-toolbar .cal-year-tag').count(), 0, 'not in the toolbar');
    const h = await page.locator('.cal-summary').evaluate((e) => e.getBoundingClientRect().height);
    assert.ok(h <= 30, `summary row stays one line (${h})`);
    // 2027-05 是 6 周月份：带标签时 1280×585 仍不滚动
    await page.setViewportSize({ width: 1280, height: 585 });
    for (let i = 0; i < 4; i++) await page.getByRole('button', { name: /下月/ }).click();
    assert.equal(await text(page, '.cal-title'), '2027 年 5 月');
    const m = await measure(page);
    console.log(`MEASURE ${JSON.stringify({ case: '2027-05 tag', tab: 'calendar', ...m })}`);
    assertCalendarFits(m, '2027-05 at 1280x585');
  });
});

// R40：2027 年 2 月（无表）：春节 2/5–2/8 标「假 春节」，周末也标；补假 / 调休不猜
test('2027-02 (no table): 春节 2/5-2/8 marked, summary 18 days, tag text, fits at 1280x585', () =>
  withPage('2027-02-04T10:00:00+08:00', async (page) => {
    await page.setViewportSize({ width: 1280, height: 585 });
    assert.equal(await text(page, '.cal-title'), '2027 年 2 月');
    for (const [label, wd] of [['2月5日', '周五'], ['2月6日', '周六'], ['2月7日', '周日'], ['2月8日', '周一']]) {
      assert.match(await cell(page, label).getAttribute('aria-label'), new RegExp(`^${label} ${wd}，法定假日（春节）`), label);
      assert.match(await cell(page, label).textContent(), /假.*春节|春节.*假/s, `${label} badge`);
    }
    assert.match(await cell(page, '2月9日').getAttribute('aria-label'), /^2月9日 周二，工作日/, 'no invented compensation day');
    assert.equal(await text(page, '.cal-summary-text'), '本月应出勤 18 天 · 日薪 ¥377.78');
    assert.equal(await text(page, '.cal-summary .cal-year-tag'), '2027 年仅标法定假日');
    assert.equal(await page.locator('.cal-summary .cal-year-tag').getAttribute('title'), '2027 年放假安排未公布：已按《放假办法》标出法定假日本身；补假、调休和延长的假日待公布');
    assert.ok((await text(page, '.cal-summary .cal-year-tag')).length <= 14, 'tag <= 14 chars');
    const h = await page.locator('.cal-summary').evaluate((e) => e.getBoundingClientRect().height);
    assert.ok(h <= 30, `summary row stays one line (${h})`);
    const m = await measure(page);
    console.log(`MEASURE ${JSON.stringify({ case: '2027-02 春节', tab: 'calendar', ...m })}`);
    assertFits(m, '2027-02 at 1280x585'); // 2027-02 只有 4 周，不是 6 周月份
    assert.equal(m.weeks, 4);
    assert.equal(m.lastRowInside, true);
    assert.equal(m.clippedCells, 0);
    await page.screenshot({ path: new URL('../.superpowers/sdd/plan/task-16-feb2027.png', import.meta.url).pathname });
  }));

// WCAG 对比度：由浏览器实际算出的颜色计算（rgb）
const ratio = (a, b) => {
  const lum = (s) => {
    const [r, g, bl] = s.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number).map((c) => c / 255)
      .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

test('contrast ≥ 4.5:1 for weekend / holiday numbers and cell tags (computed from rendered colours)', () =>
  withPage(T1412, async (page) => {
    const pair = (label, sel) => cell(page, label).evaluate((b, s) => {
      const fg = s ? b.querySelector(s) : b;
      return [getComputedStyle(fg).color, getComputedStyle(b).backgroundColor];
    }, sel);
    const checks = [['11月7日', '.day-num', 'weekend number'], ['11月8日', '.day-num', 'Sunday number']];
    for (const [label, sel, what] of checks) {
      const [fg, bg] = await pair(label, sel);
      const r = ratio(fg, bg);
      console.log(`MEASURE ${JSON.stringify({ case: 'contrast', what, fg, bg, ratio: +r.toFixed(2) })}`);
      assert.ok(r >= 4.5, `${what}: ${fg} on ${bg} = ${r.toFixed(2)}`);
    }
    await cell(page, '11月5日').click();
    await page.getByRole('menuitemradio', { name: /^带薪假/ }).click();
    await page.getByRole('button', { name: /上月/ }).click();
    for (const [label, sel, what] of [['10月1日', '.day-num', 'holiday number'], ['10月1日', '.day-tag', 'holiday tag 假'], ['10月10日', '.day-tag', 'make-up tag 班']]) {
      const [fg, bg] = await pair(label, sel);
      const r = ratio(fg, bg);
      console.log(`MEASURE ${JSON.stringify({ case: 'contrast', what, fg, bg, ratio: +r.toFixed(2) })}`);
      assert.ok(r >= 4.5, `${what}: ${fg} on ${bg} = ${r.toFixed(2)}`);
    }
    await page.getByRole('button', { name: /下月/ }).click();
    const [fg, bg] = await pair('11月5日', '.day-tag');
    assert.ok(ratio(fg, bg) >= 4.5, `paid tag: ${fg} on ${bg}`);
  }));

test('day menu: 「（调休）」 labels, check mark and type icon in separate columns, footer via aria-describedby', () =>
  withPage(T1412, async (page) => {
    await cell(page, '11月7日').click();
    assert.match(await page.getByRole('menuitemradio').nth(1).textContent(), /^改为上班（调休）/);
    const menu = page.getByRole('menu');
    const desc = await menu.getAttribute('aria-describedby');
    assert.equal(await page.locator(`#${desc}`).textContent(), '多一个上班日，日薪会变低；多一个休息日，日薪会变高（固定月薪 ÷ 当月应出勤天数）');
    const cols = await page.locator('.day-menu-item[aria-checked="true"]').evaluate((b) => {
      const c = b.querySelector('.day-menu-check').getBoundingClientRect();
      const i = b.querySelector('.day-menu-icon').getBoundingClientRect();
      return { check: c.left, checkSvg: !!b.querySelector('.day-menu-check svg'), icon: i.left, iconSvg: !!b.querySelector('.day-menu-icon svg'), checkRight: c.right };
    });
    assert.ok(cols.checkSvg && cols.iconSvg, 'both the check and the type icon are drawn');
    assert.ok(cols.icon >= cols.checkRight, 'separate columns');
    await page.keyboard.press('Escape');
    await cell(page, '11月4日').click();
    assert.match(await page.getByRole('menuitemradio').nth(1).textContent(), /^改为休息（调休）/);
  }));

test('Esc back to the cell shows no tooltip; roving tabindex follows the real focus (Esc, mouse-open, re-render)', () =>
  withPage(T1412, async (page) => {
    const tip = page.locator('.day-tooltip');
    const stops = () => page.locator('.cal-grid button[tabindex="0"]').evaluateAll((els) => els.map((e) => e.dataset.key));
    assert.deepEqual(await stops(), ['2026-11-03'], 'initial tab stop = today');
    await cell(page, '11月7日').click(); // 鼠标打开
    assert.deepEqual(await stops(), ['2026-11-07']);
    await page.keyboard.press('Escape');
    assert.equal((await focused(page)).key, '2026-11-07');
    assert.equal(await tip.isVisible(), false, 'no tooltip right after Esc');
    await page.clock.runFor(600);
    assert.equal(await tip.isVisible(), false, 'still none after the hover delay');
    assert.deepEqual(await stops(), ['2026-11-07']);
    // 键盘移动：提示照常立即出现
    await page.keyboard.press('ArrowLeft');
    assert.equal(await tip.isVisible(), true);
    assert.deepEqual(await stops(), ['2026-11-06']);
    // 用菜单套用（重绘）后，停靠点在套用的那天，且不弹提示
    await page.keyboard.press('Enter');
    await page.getByRole('menuitemradio', { name: /^带薪假/ }).click();
    assert.equal((await focused(page)).key, '2026-11-06');
    assert.deepEqual(await stops(), ['2026-11-06']);
    assert.equal(await tip.isVisible(), false);
    // 离开月历再 Tab 回来：回到同一格
    await page.keyboard.press('Shift+Tab');
    assert.equal((await focused(page)).key, null);
    await page.keyboard.press('Tab');
    assert.equal((await focused(page)).key, '2026-11-06');
  }));

test('mainland Simplified copy on both tabs (incl. 选单 / 自订 / 未套用), in text and accessible names', () =>
  withPage(T1412, async (page) => {
    const scan = async (where) => {
      const s = await page.evaluate(() => document.body.innerText + [...document.querySelectorAll('[aria-label],[title],[placeholder]')]
        .map((e) => [e.getAttribute('aria-label'), e.getAttribute('title'), e.getAttribute('placeholder')].join(' ')).join(' '));
      assert.deepEqual(TRAD.filter((c) => s.includes(c)), [], `Traditional characters in ${where}`);
      assert.deepEqual(TW_TERMS.filter((w) => s.includes(w)), [], `non-mainland terms in ${where}`);
    };
    await scan('calendar tab');
    await tab(page, '基本设置').click();
    await page.getByRole('button', { name: /高级设置/ }).click();
    assert.match(await text(page, '.adv-summary'), /^自定义网址：未设置$/);
    await scan('settings tab');
  }));

test('below 1000px the card and the panel stack vertically; at 1000px they sit side by side', () =>
  withPage(T1412, async (page) => {
    const boxes = () => page.evaluate(() => {
      const c = document.querySelector('.card-col').getBoundingClientRect();
      const p = document.querySelector('.main-panel').getBoundingClientRect();
      return { c: { l: c.left, r: c.right, b: c.bottom }, p: { l: p.left, t: p.top } };
    });
    await page.setViewportSize({ width: 990, height: 700 });
    let b = await boxes();
    assert.ok(b.p.t >= b.c.b - 0.5 && Math.abs(b.p.l - b.c.l) < 1, `stacked at 990 (${JSON.stringify(b)})`);
    await page.setViewportSize({ width: 1000, height: 700 });
    b = await boxes();
    assert.ok(b.p.l >= b.c.r, `side by side at 1000 (${JSON.stringify(b)})`);
    const m = await measure(page);
    console.log(`MEASURE ${JSON.stringify({ case: '1000x700', tab: 'calendar', ...m })}`);
    assertCalendarFits(m, '1000x700');
  }));

test('changing numbers use tabular digits in the font Chrome actually uses (same length → same width)', () =>
  withPage(T1412, async (page) => {
    const widths = (vals) => page.evaluate((list) => {
      const head = document.querySelector('#status-card .amount-head');
      const tail = document.querySelector('#status-card .amount-tail');
      return list.map((v) => {
        head.textContent = v.slice(0, -2);
        tail.textContent = v.slice(-2);
        return head.getBoundingClientRect().width + tail.getBoundingClientRect().width;
      });
    }, vals);
    for (const group of [['1,565.5456', '1,111.1111', '8,888.8888', '1,000.0000'], ['888.8888', '111.1111', '123.4567', '000.0000'], ['0.0000', '1.1111', '8.8888']]) {
      const w = await widths(group);
      console.log(`MEASURE ${JSON.stringify({ case: 'tabular', group, widths: w })}`);
      assert.ok(Math.max(...w) - Math.min(...w) < 0.01, `same width for ${group.join(' / ')}: ${w.join(' / ')}`);
    }
    const ff = await page.locator('#status-card .card-amount').evaluate((e) => [getComputedStyle(e).fontFamily, getComputedStyle(e).fontVariantNumeric]);
    assert.match(ff[0], /^"?Segoe UI"?, system-ui/);
    assert.equal(ff[1], 'tabular-nums');
    // 实际用到的字体（CDP CSS.getPlatformFontsForNode）
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('DOM.enable');
    await cdp.send('CSS.enable');
    const { root } = await cdp.send('DOM.getDocument', { depth: -1 });
    const fonts = {};
    for (const sel of ['#status-card .amount-head', '#status-card .metric-value', '.cal-grid .day-num', '.cal-summary-text', '.cal-legend']) {
      const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: sel });
      fonts[sel] = (await cdp.send('CSS.getPlatformFontsForNode', { nodeId })).fonts.map((f) => `${f.familyName} (${f.glyphCount})`);
    }
    console.log(`MEASURE ${JSON.stringify({ case: 'platformFonts', fonts })}`);
  }));

// ---- Task 12 遗留（在 Task 11 修）----

test('M6: 「回到今天」 quiet state looks clickable, not disabled: border ≥ 3:1 against the panel, pointer cursor, enabled', () =>
  withPage(T1412, async (page) => {
    const c = await page.locator('.cal-today').evaluate((b) => {
      const cs = getComputedStyle(b);
      return { border: cs.borderTopColor, bg: getComputedStyle(document.querySelector('.main-panel')).backgroundColor, btnBg: cs.backgroundColor, color: cs.color, cursor: cs.cursor, disabled: b.disabled, aria: b.getAttribute('aria-disabled') };
    });
    const r = ratio(c.border, c.bg);
    console.log(`MEASURE ${JSON.stringify({ case: 'contrast', what: '回到今天 quiet border', fg: c.border, bg: c.bg, ratio: +r.toFixed(2) })}`);
    assert.ok(r >= 3, `border contrast ${r.toFixed(2)} ≥ 3:1`);
    assert.ok(ratio(c.color, c.btnBg) >= 4.5, 'text contrast ≥ 4.5:1');
    assert.equal(c.cursor, 'pointer');
    assert.equal(c.disabled, false);
    assert.equal(c.aria, null);
  }));

test('M3 / R29: the calendar toolbar has no horizontal overflow at 1000px (this month and while viewing another month)', () =>
  withPage(T1412, async (page) => {
    for (const [w, ht] of [[1000, 700], [1280, 585]]) {
      await page.setViewportSize({ width: w, height: ht });
      await page.locator('.cal-today').click();
      for (const away of [false, true]) {
        if (away) await page.getByRole('button', { name: /下月/ }).click();
        const m = await page.evaluate(() => {
          const tb = document.querySelector('.cal-toolbar');
          const tr = tb.getBoundingClientRect();
          return { overflow: tb.scrollWidth - tb.clientWidth, lastRight: Math.round(tb.lastElementChild.getBoundingClientRect().right), tbRight: Math.round(tr.right), h: Math.round(tr.height) };
        });
        console.log(`MEASURE ${JSON.stringify({ case: 'toolbar', w, away, ...m })}`);
        assert.equal(m.overflow, 0, `${w}px away=${away}: toolbar does not overflow`);
        assert.ok(m.lastRight <= m.tbRight, 'last toolbar item inside the toolbar');
        assert.ok(m.h <= 32, `single line (${m.h}px)`);
      }
    }
  }));

test('M2: focus stays on the error-bar button when the bar re-renders (save attempt while storage fails)', () =>
  withPage(T1412, async (page) => {
    await tab(page, '基本设置').click();
    await page.evaluate(() => { window.__fail = true; });
    await page.getByLabel('月薪').fill('7000');
    const exportBtn = page.locator(`${errorBar} button[data-action="export"]`);
    assert.equal(await exportBtn.isVisible(), true);
    await exportBtn.focus();
    // 不移动焦点地触发一次保存（例如自动保存 / 其他分页事件）：错误条会重画
    await page.evaluate(() => {
      const i = document.getElementById('f-salary');
      i.value = '7100';
      i.dispatchEvent(new Event('input', { bubbles: true }));
    });
    assert.equal(await page.evaluate(() => document.activeElement?.dataset?.action ?? document.activeElement?.tagName), 'export', 'focus not lost to BODY');
    // 按钮组合真的变了才重建（储存恢复 → 错误条消失）
    await page.evaluate(() => { window.__fail = false; });
    await page.getByLabel('月薪').fill('7200');
    assert.equal(await page.locator(errorBar).isVisible(), false);
  }, { init: () => {
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) {
      if (window.__fail && k === 'work-motivator-v1') throw new DOMException('quota', 'QuotaExceededError');
      return orig.call(this, k, v);
    };
  } }));
