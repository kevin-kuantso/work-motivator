// 版面重设计（spec §13）：实测四种视窗不滚动、提示条两条通道、分页键盘与 ARIA、PgUp / PgDn、
// 只列当月类型的图例、「回到今天」强调、摘要行、对比度（实算）、用语扫描、<1000px 上下排列、等宽数字。
// 量测结果以 `MEASURE {...}` 打印，供报告引用（数字都是本次实际量到的）。
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { startServer, launch, openAt, expectedAutoUrls, pipStub } from './harness.mjs';

// 截图只在设了 WM_SHOTS=目录 时才写（默认不写任何文件，Task 14 E3）
const SHOTS = process.env.WM_SHOTS || null;
async function shot(page, name) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, name) });
}

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
  const leftCol = document.querySelector('.card-col');
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
    // 左栏 = 状态卡（或占位卡）+「悬浮成小窗」按钮 + 按钮下的说明（R38）
    leftBottom: Math.round(r(leftCol).bottom * 10) / 10,
    floatBottom: Math.round(r(document.querySelector('#btn-float')).bottom * 10) / 10,
    banners: [...document.querySelectorAll('.notices .banner:not([hidden])')].map((b) => Math.round(r(b).height)),
    tablistVisible: tablist.top >= 0 && tablist.bottom <= innerHeight,
    // 分页本身 + 每一栏（两栏各自可内部滚动，决定 1）：默认状态都必须是 0
    settingsInnerOverflow: sp.hidden ? null : Math.max(sp.scrollHeight - sp.clientHeight, ...cols.map((c) => c.scrollHeight - c.clientHeight)),
    settingsColOverflow: sp.hidden ? null : cols.map((c) => c.scrollHeight - c.clientHeight),
    settingsColSlack: sp.hidden ? null : cols.map((c) => Math.round(r(sp).bottom - r(c.lastElementChild).bottom)),
  };
});

function assertFits(m, where) {
  assert.ok(m.panelBottom <= m.ih - 12, `${where}: panel bottom ${m.panelBottom} must be ≥ 12px above ${m.ih}`);
  assert.ok(m.scrollH <= m.ih, `${where}: no page scroll (scrollHeight ${m.scrollH} > innerHeight ${m.ih})`);
  assert.ok(m.cardBottom <= m.ih, `${where}: status card inside the viewport`);
  assert.ok(m.leftBottom <= m.ih - 12, `${where}: left column (card + float button) bottom ${m.leftBottom} ≥ 12px above ${m.ih}`);
  assert.ok(m.leftBottom <= m.panelBottom + 0.5, `${where}: left column ${m.leftBottom} does not reach below the panel ${m.panelBottom}`);
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

// R36：图例永远列出全部 7 种，排成一行（有 / 没有假日的月份都一样）；「重置本月标记」仅本月有手动标记时出现，在摘要行最右
const ALL_KINDS = ['weekend', 'holiday', 'makeup', 'paid', 'unpaid', 'today', 'manual'];
const legendLine = (page) => page.evaluate(() => {
  const l = document.querySelector('.cal-legend');
  const items = [...l.querySelectorAll('.legend-title, .legend-item')];
  const tops = new Set(items.map((e) => Math.round(e.getBoundingClientRect().top)));
  const hint = l.querySelector('.legend-hint');
  const lr = l.getBoundingClientRect();
  const hr = hint.getBoundingClientRect();
  return {
    h: Math.round(lr.height * 10) / 10, rows: tops.size,
    allInside: items.every((e) => e.getBoundingClientRect().right <= lr.right + 0.5 && e.getBoundingClientRect().bottom <= lr.bottom + 0.5),
    hintShown: hr.top >= lr.top - 0.5 && hr.bottom <= lr.bottom + 0.5, hintCut: hint.scrollWidth > hint.clientWidth + 0.5,
  };
});
test('legend always lists all 7 kinds on ONE line (months with and without holidays); 重置本月标记 only with manual marks', () =>
  withPage(T1412, async (page) => {
    const kinds = () => page.locator('.cal-legend .legend-item').evaluateAll((els) => els.map((e) => e.dataset.kind));
    const labels = () => page.locator('.cal-legend .legend-item').allTextContents();
    for (const [w, ht] of VIEWPORTS) {
      await page.setViewportSize({ width: w, height: ht });
      for (const [month, move] of [['2026-11', null], ['2026-10', /上月/], ['2026-11', /下月/]]) {
        if (move) await page.getByRole('button', { name: move }).click();
        assert.deepEqual(await kinds(), ALL_KINDS, `${month} @${w}`);
        const lg = await legendLine(page);
        console.log(`MEASURE ${JSON.stringify({ case: 'legend', month, w, ...lg })}`);
        assert.equal(lg.rows, 1, `${month} @${w}: one row`);
        assert.ok(lg.h <= 24, `${month} @${w}: legend single line (${lg.h}px)`);
        assert.equal(lg.allInside, true, `${month} @${w}: no legend item clipped`);
        assert.equal(lg.hintCut, false, 'the hint is either fully shown or not shown (never cut mid-sentence)');
        if (w >= 1280) assert.equal(lg.hintShown, true, `${month} @${w}: the right-hand hint fits and shows`);
      }
    }
    assert.deepEqual(await labels(), ['周末', '法定假日', '调休上班', '带薪假', '无薪假', '今天', '手动标记']);
    assert.equal(await text(page, '.legend-hint'), '点日期可标记：调休 · 带薪假 · 无薪假');
    assert.equal(await page.locator('.cal-legend [data-kind=holiday] svg.icon-holiday').count(), 1, 'same icon as the 假 tag');
    assert.equal(await page.locator('.cal-legend [data-kind=makeup] svg.icon-makeup').count(), 1);
    assert.equal(await page.locator('.cal-legend [data-kind=paid] svg.icon-paid').count(), 1);
    assert.equal(await page.locator('.cal-legend [data-kind=unpaid] svg.icon-unpaid').count(), 1);
    assert.equal(await page.locator('.cal-legend [data-kind=manual] .day-dot').count(), 1);
    // 重置本月标记
    await page.setViewportSize({ width: 1280, height: 585 });
    assert.equal(await page.getByRole('button', { name: '重置本月标记' }).isVisible(), false);
    await cell(page, '11月4日').click();
    await page.getByRole('menuitemradio', { name: /改为休息/ }).click();
    assert.deepEqual(await kinds(), ALL_KINDS, 'unchanged by a manual mark');
    const reset = page.locator('.cal-summary').getByRole('button', { name: '重置本月标记' });
    assert.equal(await reset.isVisible(), true, 'reset lives in the summary row');
    const [rb, sb] = await Promise.all([reset.boundingBox(), page.locator('.cal-summary').boundingBox()]);
    assert.ok(Math.abs(rb.x + rb.width - (sb.x + sb.width)) <= 1, 'reset at the far right of the summary row');
    const sh = await page.locator('.cal-summary').evaluate((e) => e.getBoundingClientRect().height);
    assert.ok(sh <= 30, `summary row (text + pill + reset) stays one line (${sh})`);
    await reset.click();
    assert.equal(await reset.isVisible(), false);
    // 极端月份：所有类型都出现时仍是一行
    await page.getByRole('button', { name: /上月/ }).click();
    for (const [label, re] of [['10月12日', /^带薪假/], ['10月13日', /^无薪假/], ['10月14日', /改为休息/]]) {
      await cell(page, label).click();
      await page.getByRole('menuitemradio', { name: re }).click();
    }
    const lg = await legendLine(page);
    assert.equal(lg.rows, 1);
    assert.equal(lg.hintShown, true, 'hint still fits at 1280');
    const sh2 = await page.locator('.cal-summary').evaluate((e) => e.getBoundingClientRect().height);
    assert.ok(sh2 <= 30, `Oct: summary row with pill + reset stays one line (${sh2})`);
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
    assert.equal(await page.locator('.cal-summary .cal-year-tag').getAttribute('title'), '2027 年假期表未内置：已按《放假办法》标出法定假日本身；补假、调休和延长的假日未标出');
    assert.ok((await text(page, '.cal-summary .cal-year-tag')).length <= 14, 'tag <= 14 chars');
    const h = await page.locator('.cal-summary').evaluate((e) => e.getBoundingClientRect().height);
    assert.ok(h <= 30, `summary row stays one line (${h})`);
    const m = await measure(page);
    console.log(`MEASURE ${JSON.stringify({ case: '2027-02 春节', tab: 'calendar', ...m })}`);
    assertFits(m, '2027-02 at 1280x585'); // 2027-02 只有 4 周，不是 6 周月份
    assert.equal(m.weeks, 4);
    assert.equal(m.lastRowInside, true);
    assert.equal(m.clippedCells, 0);
    await shot(page, 'task-16-feb2027.png');
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
    assert.match(await text(page, '.adv-summary'), /^自定义数据网址：未设置$/);
    await page.locator('#btn-example').click(); // Task 14 / R47：格式示例与说明也扫
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

// ---- Task 14（redesign-v3 落地）----

const OCT1 = '2026-10-01'; // 2026-10：5 周月份
const FLOAT_STUB = { content: `(${pipStub})(${JSON.stringify({})})` };
const NO_PIP = { content: 'delete Window.prototype.documentPictureInPicture; delete window.documentPictureInPicture;' };

test('header holds only the title (≈28px); no buttons in the header; the float button sits under the status card', () =>
  withPage(T1412, async (page) => {
    const hd = await page.evaluate(() => {
      const h = document.querySelector('header.app-header');
      return { kids: [...h.children].map((c) => c.tagName), text: h.textContent, buttons: h.querySelectorAll('button, a, input').length, height: h.getBoundingClientRect().height };
    });
    assert.deepEqual(hd.kids, ['H1']);
    assert.equal(hd.text, '上班鼓励器');
    assert.equal(hd.buttons, 0);
    assert.ok(Math.abs(hd.height - 28) <= 1, `header ≈ 28px (${hd.height})`);
    const g = await page.evaluate(() => {
      const c = document.querySelector('#card-slot').getBoundingClientRect();
      const b = document.querySelector('#btn-float').getBoundingClientRect();
      return { c: [c.left, c.right, c.bottom], b: [b.left, b.right, b.top], inCol: document.querySelector('.card-col').contains(document.querySelector('#btn-float')), bg: getComputedStyle(document.querySelector('#btn-float')).backgroundColor };
    });
    assert.equal(g.inCol, true, 'button in the left column');
    assert.ok(Math.abs(g.b[0] - g.c[0]) <= 0.5 && Math.abs(g.b[1] - g.c[1]) <= 0.5, `full column width (${g.b} vs ${g.c})`);
    assert.ok(g.b[2] >= g.c[2] && g.b[2] - g.c[2] <= 12, 'directly under the card');
    assert.equal(g.bg, 'rgb(21, 128, 61)', 'primary green (#15803D)');
  }, { init: FLOAT_STUB }));

// 三种悬浮状态 × 四种视窗 × 两个分页：左栏（状态卡 / 占位卡 + 按钮 + 说明）都放得下、页面不滚动
const floatStates = [
  ['default', FLOAT_STUB, async () => {}],
  ['floating', FLOAT_STUB, async (page) => {
    await page.locator('#btn-float').click();
    await page.frameLocator('iframe.pip-stub').locator('#status-card').waitFor();
    await page.evaluate(() => { document.querySelector('iframe.pip-stub').style.visibility = 'hidden'; }); // stub 视窗盖在页面左下：截图 / 量测时藏起来（不影响版面）
  }],
  ['unsupported', NO_PIP, async () => {}],
];
for (const [state, init, act] of floatStates) {
  test(`left column fits in the ${state} float state at four viewports (both tabs, first-run banner)`, () =>
    withPage(T1412, async (page) => {
      await act(page);
      const notes = await page.evaluate(() => [...document.querySelectorAll('.float-control .float-note')].filter((n) => !n.hidden).map((n) => n.textContent));
      const btn = await page.locator('#btn-float').evaluate((b) => ({ text: b.textContent, disabled: b.disabled || b.getAttribute('aria-disabled') === 'true', desc: b.getAttribute('aria-describedby') }));
      if (state === 'default') {
        assert.deepEqual(notes, []);
        assert.deepEqual(btn, { text: '悬浮成小窗', disabled: false, desc: null });
      } else if (state === 'floating') {
        assert.deepEqual(notes, ['请保持本页开启：关闭本页，小窗也会一起关闭']);
        assert.deepEqual(btn, { text: '收回小窗', disabled: false, desc: 'float-keep' });
        assert.equal(await page.locator('.pip-placeholder').isVisible(), true, 'dashed placeholder in place of the card');
        assert.equal(await page.locator('.pip-placeholder').evaluate((e) => getComputedStyle(e).borderTopStyle), 'dashed');
        assert.equal(await text(page, '.pip-placeholder-note'), '状态卡正显示在悬浮小窗里');
      } else {
        assert.deepEqual(notes, ['当前浏览器不支持悬浮小窗，请使用 Edge 或 Chrome（116 及以上）']);
        assert.deepEqual(btn, { text: '悬浮成小窗', disabled: true, desc: 'float-note' });
      }
      for (const [w, ht] of VIEWPORTS) {
        await page.setViewportSize({ width: w, height: ht });
        for (const tb of ['月历', '基本设置']) {
          await tab(page, tb).click();
          const m = await measure(page);
          console.log(`MEASURE ${JSON.stringify({ case: `float ${state}`, tab: tb, vw: w, ih: ht, leftBottom: m.leftBottom, floatBottom: m.floatBottom, panelBottom: m.panelBottom, slack: m.slack, scrollH: m.scrollH, inner: m.settingsInnerOverflow })}`);
          assertFits(m, `${state} ${w}x${ht} ${tb}`);
          if (tb === '基本设置') assert.equal(m.settingsInnerOverflow, 0, `${state} ${w}x${ht}: settings fit without internal scroll`);
        }
        if (w === 1280) await shot(page, `task-14-float-${state}-1280x585.png`);
      }
    }, { init }));
}

// 决定 2：提示盖在格子本身（±2px），5 周月份 4 行、6 周月份 3 行（不显示「来源」），不盖到下面的格子；键盘聚焦一样
async function tipCheck(page, label, lines, how) {
  const c = cell(page, label);
  if (how === 'hover') {
    await c.hover();
    await page.clock.runFor(450);
  } else {
    await c.focus(); // 程序聚焦不弹提示；用方向键走一格再走回来（键盘聚焦）
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowLeft');
  }
  const r = await c.evaluate((b) => {
    const tip = document.querySelector('.day-tooltip');
    const tr = tip.getBoundingClientRect();
    const cr = b.parentElement.getBoundingClientRect();
    const br = b.getBoundingClientRect();
    const row = b.closest('.cal-row');
    const below = row.nextElementSibling?.children[[...row.children].indexOf(b.parentElement)]?.getBoundingClientRect() ?? null;
    const shown = [...tip.children].filter((x) => getComputedStyle(x).display !== 'none');
    return {
      hidden: tip.hidden, inCell: tip.parentElement === b.parentElement,
      tip: [tr.left, tr.top, tr.right, tr.bottom].map((v) => Math.round(v * 10) / 10),
      cell: [br.left, br.top, br.right, br.bottom].map((v) => Math.round(v * 10) / 10),
      gridcell: [cr.left, cr.top, cr.right, cr.bottom].map((v) => Math.round(v * 10) / 10),
      belowTop: below ? Math.round(below.top * 10) / 10 : null,
      lines: shown.map((x) => x.textContent),
      clipped: tip.scrollHeight > tip.clientHeight + 0.5,
      lineBottoms: shown.map((x) => x.getBoundingClientRect().bottom),
    };
  });
  return { ...r, expect: lines };
}
for (const how of ['hover', 'keyboard']) {
  test(`tooltip on the ${how === 'hover' ? 'hovered' : 'keyboard-focused'} cell: inside the cell (±2px), 4 lines in a 5-week month, 3 lines in a 6-week month, never over the cell below — four viewports`, () =>
    withPage(T1412, async (page) => {
      for (const [w, ht] of VIEWPORTS) {
        await page.setViewportSize({ width: w, height: ht });
        for (const [month, label, lines] of [
          ['2026-11', '11月18日', ['11月18日 周三', '工作日', '计薪 ¥323.81']],
          ['2026-10', '10月1日', ['10月1日 周四', '法定假日·国庆', '内置·官方通知', '计薪 ¥0.00']],
        ]) {
          await page.locator('.cal-today').click();
          if (month === '2026-10') await page.getByRole('button', { name: /上月/ }).click();
          const r = await tipCheck(page, label, lines, how);
          console.log(`MEASURE ${JSON.stringify({ case: `tooltip ${how}`, month, w, ht, tip: r.tip, cell: r.cell, lines: r.lines.length, clipped: r.clipped, belowTop: r.belowTop })}`);
          assert.equal(r.hidden, false, `${month} @${w}: shown`);
          assert.equal(r.inCell, true, 'rendered inside the cell');
          for (let i = 0; i < 4; i++) assert.ok(Math.abs(r.tip[i] - r.cell[i]) <= 2, `${month} @${w}: tooltip edge ${i} ${r.tip[i]} within ±2px of the cell ${r.cell[i]}`);
          assert.deepEqual(r.lines, lines, `${month} @${w}: ${lines.length} lines`);
          assert.equal(r.clipped, false, `${month} @${w}: no line clipped`);
          assert.ok(r.lineBottoms.every((b) => b <= r.tip[3] + 0.5), 'every line inside the tooltip');
          if (r.belowTop !== null) assert.ok(r.tip[3] <= r.belowTop, `${month} @${w}: does not cover the cell below (${r.tip[3]} > ${r.belowTop})`);
          if (how === 'hover' && (w === 1280 || w === 1920)) await shot(page, `task-14-tooltip-${month === '2026-10' ? 'oct' : 'nov'}-${w}x${ht}.png`);
          await page.mouse.move(0, 0);
          await page.locator('.cal-summary-text').click();
        }
      }
    }));
}

test('tooltip with error + info banners at 1280×585: the 5-week cell is shorter — falls back to 3 lines, nothing clipped', () =>
  withPage(T1412, async (page) => {
    await page.setViewportSize({ width: 1280, height: 585 });
    await tab(page, '基本设置').click();
    await page.getByLabel('月薪').fill('7000');
    await page.getByLabel('月薪').fill('6800');
    assert.equal(await page.locator(errorBar).isVisible(), true);
    await tab(page, '月历').click();
    await page.getByRole('button', { name: /上月/ }).click();
    const r = await tipCheck(page, '10月1日', null, 'hover');
    console.log(`MEASURE ${JSON.stringify({ case: 'tooltip error+info', tip: r.tip, cell: r.cell, lines: r.lines, clipped: r.clipped })}`);
    assert.equal(r.clipped, false);
    assert.ok(r.lines.length === 3 || r.lines.length === 4, `${r.lines.length} lines`);
    assert.equal(r.lines.at(-1), '计薪 ¥0.00', 'the pay line is never dropped');
    for (let i = 0; i < 4; i++) assert.ok(Math.abs(r.tip[i] - r.cell[i]) <= 2);
  }, corruptThenQuota));

// 决定 4：摘要行情境胶囊——依据如实写；无表年份不声称官方来源
const pill = (page) => page.locator('.cal-summary .cal-note').evaluate((e) => ({
  text: e.textContent, tone: e.dataset.tone, title: e.title,
  check: Boolean(e.querySelector('.icon-check')), flag: Boolean(e.querySelector('.icon-holiday')),
  border: getComputedStyle(e).borderTopStyle, cut: [...e.children].some((c) => c.scrollWidth > c.clientWidth + 0.5),
}));
const tagText = (page) => page.locator('.cal-summary .cal-year-tag').evaluate((e) => (e.hidden ? null : e.textContent));
const summaryOneLine = (page) => page.locator('.cal-summary').evaluate((e) => e.getBoundingClientRect().height);

test('summary pill: 2026-11 (no holidays, built-in), 2026-10 (国庆 + make-up day), past no-table year 2025 (qualifier tag, no official claim)', () =>
  withPage(T1412, async (page) => {
    await page.setViewportSize({ width: 1280, height: 585 });
    const nov = await pill(page);
    assert.equal(nov.text, '本月没有法定假日· 依据 2026 年国务院放假通知');
    assert.deepEqual([nov.tone, nov.check, nov.border, nov.cut], ['none', true, 'dashed', false]);
    assert.equal(await tagText(page), null);
    await shot(page, 'task-14-calendar-nov-1280x585.png');
    await page.getByRole('button', { name: /上月/ }).click();
    const oct = await pill(page);
    assert.equal(oct.text, '国庆 10/1–10/7 放假，10/10 调休上班');
    assert.deepEqual([oct.tone, oct.flag, oct.border, oct.cut], ['holiday', true, 'solid', false]);
    assert.equal(oct.title, '国庆 10/1–10/7 放假，10/10 调休上班 · 依据 2026 年国务院放假通知');
    await shot(page, 'task-14-calendar-oct-1280x585.png');
    assert.ok(await summaryOneLine(page) <= 30);
    // 2025（无表、已过去，fixed 年份）：不显示缺表标签，胶囊说 app 只标了固定日期的法定假日（R49）
    for (let i = 0; i < 12; i++) await page.getByRole('button', { name: /上月/ }).click();
    assert.equal(await text(page, '.cal-title'), '2025 年 10 月');
    const past = await pill(page);
    // round 2：所有无表年份的「依据」都只放在 title（与当年以后的年份同一种写法）
    assert.equal(past.text, '国庆 10/1–10/3 放假');
    assert.equal(past.title, '国庆 10/1–10/3 放假 · 按《放假办法》只标出固定日期的法定假日；其余假日和补假、调休未标出');
    assert.equal(past.cut, false, 'fits at 1280');
    assert.doesNotMatch(past.text + past.title, /国务院|待公布|依据/);
    assert.equal(past.check, false);
    assert.equal(await tagText(page), '2025 年仅标固定日期的法定假日', 'round 3 (R41 amended): past no-table years show the visible qualifier too');
    assert.ok(await summaryOneLine(page) <= 30);
    await page.getByRole('button', { name: /上月/ }).click();
    assert.equal((await pill(page)).text, '本月没有已标出的法定假日');
    assert.equal((await pill(page)).title, '本月没有已标出的法定假日 · 按《放假办法》只标出固定日期的法定假日；其余假日和补假、调休未标出');
    assert.equal((await pill(page)).check, false, 'no ✓ without a table');
  }));

test('summary pill + tag: 2027-01 (fixed day) and 2027-02 (lunar days) with the clock in 2026; 2036-01 (other no-table year)', async () => {
  await withPage(T1412, async (page) => {
    await page.setViewportSize({ width: 1280, height: 585 });
    await page.getByRole('button', { name: /下月/ }).click();
    await page.getByRole('button', { name: /下月/ }).click();
    assert.equal(await text(page, '.cal-title'), '2027 年 1 月');
    const jan = await pill(page);
    assert.equal(jan.text, '元旦 1/1 放假');
    assert.equal(jan.title, '元旦 1/1 放假 · 按《放假办法》标出法定假日本身；补假、调休和延长的假日未标出');
    assert.equal(jan.check, false);
    assert.equal(await tagText(page), '2027 年仅标法定假日');
    assert.ok(await summaryOneLine(page) <= 30);
    await page.getByRole('button', { name: /下月/ }).click();
    assert.equal((await pill(page)).text, '春节 2/5–2/8 放假');
    assert.equal(await tagText(page), '2027 年仅标法定假日');
    await page.getByRole('button', { name: /下月/ }).click();
    const mar = await pill(page);
    assert.deepEqual([mar.text, mar.tone, mar.check, mar.border], ['本月没有已标出的法定假日', 'unknown', false, 'dashed']);
    assert.doesNotMatch(mar.text + mar.title, /国务院|依据/);
  });
  await withPage('2036-01-07T10:00:00+08:00', async (page) => {
    await page.setViewportSize({ width: 1280, height: 585 });
    assert.equal((await pill(page)).text, '元旦 1/1 放假');
    assert.equal(await tagText(page), '2036 年仅标固定日期的法定假日');
    assert.match(await page.locator('.cal-summary .cal-year-tag').getAttribute('title'), /只按《放假办法》标出固定日期的法定假日（元旦、劳动节、国庆）/);
    assert.equal(await text(page, '#status-card .card-year'), '2036 年仅标固定日期的法定假日', 'status card uses the same wording');
    assert.ok(await summaryOneLine(page) <= 30);
    await page.getByRole('button', { name: /下月/ }).click();
    assert.equal((await pill(page)).text, '本月没有已标出的法定假日', 'no lunar data for 2036: nothing claimed');
  });
});

// 联网 / 导入的年份：依据写数据的真实来源（自己开页面：联网成功时开页只会请求第一个来源，与 withPage 的「全部被中止」前提不同）
const FILE2027 = JSON.stringify({
  year: 2027, papers: ['https://www.gov.cn/zhengce/test-2027.htm'],
  days: [{ name: '元旦', date: '2027-01-01', isOffDay: true }, { name: '元旦', date: '2027-01-02', isOffDay: true }, { name: '元旦', date: '2027-01-03', isOffDay: true }],
}); // 虚构的测试数据，只为满足校验规则
test('summary pill for an online-table year and for an imported-file year: 「依据联网取得的…」 / 「依据导入的…」', async () => {
  for (const mode of ['online', 'file']) {
    const o = await openAt(browser, server.url, '2026-11-04T09:00:00+08:00', {
      viewport: { width: 1280, height: 585 },
      beforeGoto: (page) => (mode === 'online'
        ? page.route(/cdn\.jsdelivr\.net\/.*\/2027\.json/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: FILE2027, headers: { 'access-control-allow-origin': '*' } }))
        : Promise.resolve()),
    });
    try {
      const p = o.page;
      if (mode === 'file') {
        await tab(p, '基本设置').click();
        await p.locator('#holiday-file').setInputFiles({ name: '2027.json', mimeType: 'application/json', buffer: Buffer.from(FILE2027) });
        await p.locator('#holiday-result[data-tone="success"]').waitFor();
        await tab(p, '月历').click();
      }
      await p.getByRole('button', { name: /下月/ }).click();
      await p.getByRole('button', { name: /下月/ }).click();
      assert.equal((await pill(p)).text, '元旦 1/1–1/3 放假');
      assert.equal(await tagText(p), null, 'table present: no tag');
      await p.getByRole('button', { name: /下月/ }).click();
      const feb = await pill(p);
      assert.equal(feb.text, mode === 'online' ? '本月没有法定假日· 依据联网取得的 2027 年放假数据' : '本月没有法定假日· 依据导入的 2027 年假期表');
      assert.equal(feb.check, true);
      assert.doesNotMatch(feb.text, /国务院/);
      assert.deepEqual(o.errors.map(String), []);
      assert.deepEqual(o.consoleErrors, []);
    } finally {
      await o.context.close();
    }
  }
});

// 决定 1：默认状态两栏都不需要内部滚动；展开「格式示例」或「高级设置」后只有右栏内部滚动，展开的内容被带进视野，页面与分页标签不动
test('基本设置: no internal scroll by default; expanding 格式示例 / 高级设置 scrolls only the right column, content brought into view', () =>
  withPage(T1412, async (page) => {
    const cols = () => page.evaluate(() => {
      const sp = document.getElementById('panel-settings').getBoundingClientRect();
      const tl = document.querySelector('[role=tablist]').getBoundingClientRect();
      return {
        cols: [...document.querySelectorAll('.set-col')].map((c) => ({ over: c.scrollHeight - c.clientHeight, top: c.scrollTop })),
        pageScroll: document.documentElement.scrollHeight > innerHeight, tabs: tl.top >= 0 && tl.bottom <= innerHeight, sp: [sp.top, sp.bottom],
      };
    });
    const inView = (sel) => page.evaluate((s) => {
      const col = document.querySelectorAll('.set-col')[1].getBoundingClientRect();
      const e = document.querySelector(s).getBoundingClientRect();
      // 顶端在右栏视野内；放得下就整个在视野内（比右栏还高的示例：只要求从顶端开始看得到）
      const fits = e.height <= col.height;
      return e.height > 0 && e.top >= col.top - 0.5 && (fits ? e.bottom <= col.bottom + 0.5 : e.top < col.bottom);
    }, sel);
    for (const [w, ht] of VIEWPORTS) {
      await page.setViewportSize({ width: w, height: ht });
      await tab(page, '基本设置').click();
      const d = await cols();
      assert.deepEqual(d.cols.map((c) => c.over), [0, 0], `${w}x${ht}: both columns fit by default`);
      if (w === 1280) await shot(page, 'task-14-settings-1280x585.png');
      if (w === 1920) await shot(page, 'task-14-settings-1920x950.png');
      for (const [what, btn, body] of [['example', '#btn-example', '#holiday-example'], ['advanced', '#adv-toggle', '#f-custom-url']]) {
        await page.locator(btn).click();
        assert.equal(await page.locator(btn).getAttribute('aria-expanded'), 'true');
        const e = await cols();
        console.log(`MEASURE ${JSON.stringify({ case: `settings ${what} expanded`, w, ht, cols: e.cols, pageScroll: e.pageScroll })}`);
        assert.equal(e.pageScroll, false, `${what} @${w}: no page scroll`);
        assert.equal(e.tabs, true, 'tab labels stay visible');
        assert.equal(e.cols[0].over, 0, 'left column unaffected');
        assert.equal(e.cols[0].top, 0);
        assert.equal(await inView(body), true, `${what} @${w}: expanded content in view`);
        if (w === 1280) await shot(page, `task-14-settings-${what}-1280x585.png`);
        await page.locator(btn).click();
        assert.equal(await page.locator(btn).getAttribute('aria-expanded'), 'false');
      }
      const back = await cols();
      assert.deepEqual(back.cols.map((c) => c.over), [0, 0], 'collapsed again: no internal scroll');
      await tab(page, '月历').click();
      if (w === 1920) {
        await shot(page, 'task-14-calendar-nov-1920x950.png');
        await page.getByRole('button', { name: /上月/ }).click();
        await shot(page, 'task-14-calendar-oct-1920x950.png');
        await page.locator('.cal-today').click();
      }
    }
    // 键盘：两个展开钮都可用 Enter / Space 操作
    await tab(page, '基本设置').click();
    await page.locator('#btn-example').focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('#holiday-example').isVisible(), true);
    await page.keyboard.press(' ');
    assert.equal(await page.locator('#holiday-example').isVisible(), false);
    await page.locator('#adv-toggle').focus();
    await page.keyboard.press(' ');
    assert.equal(await page.locator('#f-custom-url').isVisible(), true);
  }));

test('基本设置 structure: two columns of <section aria-labelledby> cards with headings; labels on one vertical line; ids / aria kept', () =>
  withPage(T1412, async (page) => {
    await page.setViewportSize({ width: 1280, height: 585 });
    await tab(page, '基本设置').click();
    const st = await page.evaluate(() => {
      const cols = [...document.querySelectorAll('.set-col')];
      return cols.map((c) => [...c.querySelectorAll(':scope > section')].map((s) => {
        const h = document.getElementById(s.getAttribute('aria-labelledby'));
        return { heading: h?.closest('h2') ? h.closest('h2').tagName : h?.tagName, name: h?.textContent };
      }));
    });
    assert.deepEqual(st, [
      [{ heading: 'H2', name: '工资与上班时间' }],
      [{ heading: 'H2', name: '假期数据' }, { heading: 'H2', name: '数据与备份' }, { heading: 'H2', name: '高级设置' }],
    ]);
    // 标签对齐同一条竖线；控件从同一条竖线开始
    const lines = await page.evaluate(() => [...document.querySelectorAll('.section-pay .row')].filter((r) => !r.hidden).map((r) => [Math.round(r.querySelector('.row-label').getBoundingClientRect().left), Math.round(r.querySelector('.row-ctrl').getBoundingClientRect().left)]));
    assert.equal(new Set(lines.map((x) => x[0])).size, 1, `labels aligned: ${JSON.stringify(lines)}`);
    assert.equal(new Set(lines.map((x) => x[1])).size, 1, `controls aligned: ${JSON.stringify(lines)}`);
    assert.deepEqual(await page.locator('.section-pay .row-label').allTextContents(), ['月薪', '发薪日', '上下班时间', '午休', '午休时间', '周末上班', '鼓励语']);
    // 名称与描述
    assert.equal(await page.getByRole('textbox', { name: '月薪' }).count(), 1);
    assert.equal(await page.getByRole('combobox', { name: '发薪日' }).count(), 1);
    assert.equal(await page.getByRole('group', { name: '上下班时间' }).count(), 1);
    assert.equal(await page.getByRole('switch', { name: '周末上班' }).getAttribute('aria-describedby'), 'hint-weekends err-weekends');
    assert.equal(await page.locator('#f-payday').getAttribute('aria-describedby'), 'hint-payday err-payday');
    assert.equal(await text(page, '#hint-payday'), '设置后，状态卡会显示「距离发薪日 N 天」');
    assert.equal(await text(page, '#hint-cheer'), '会显示在左侧状态卡上');
    assert.equal(await page.locator('#f-cheer').getAttribute('aria-describedby'), 'hint-cheer err-cheer');
    assert.equal(await page.locator('#btn-holiday-check').getAttribute('aria-describedby'), 'hint-holiday-check');
    assert.equal(await text(page, '#hint-holiday-check'), '联网获取新公布的放假安排');
    assert.equal(await text(page, '#hint-holiday-import'), '连不上网时，用文件导入');
    assert.equal(await text(page, '.section-backup .scard-desc'), '设置只保存在这个浏览器里，不会上传。');
    assert.deepEqual(await page.locator('.section-backup .para').allTextContents(), ['导出备份：把月薪、上下班时间、月历标记保存成文件。换电脑或清除浏览数据前，请先导出。', '导入备份：用之前导出的文件恢复这些设置。', '备份不含联网取得或导入的假期表和自定义数据网址。']);
    assert.equal(await text(page, '.section-backup .warn-note'), '备份文件含月薪，请妥善保管');
    assert.equal(await text(page, '.adv-sub'), '一般不用改');
    assert.equal(await text(page, '.adv-summary'), '自定义数据网址：未设置');
    assert.deepEqual(await page.locator('#holiday-status .chip').allTextContents(), ['2026 年 · 内置', '2027 年 · 未内置']);
    // 格式示例：真实 2026 节选、GitHub 地址是文字不是链接
    await page.locator('#btn-example').click();
    assert.equal(await text(page, '#btn-example'), '▾收起导入文件的格式示例');
    assert.match(await page.locator('#holiday-example-code').textContent(), /"date":"2026-01-04",\s*"isOffDay":false/);
    assert.equal(await page.locator('#holiday-example a').count(), 0, 'no link');
    assert.equal(await text(page, '#holiday-example .mono'), 'github.com/NateScarlet/holiday-cn');
    // 高级设置展开：白话说明 + 输入框 + 格式提示
    await page.locator('#adv-toggle').click();
    assert.equal(await page.getByRole('textbox', { name: '自定义数据网址' }).getAttribute('aria-describedby'), 'explain-custom-url hint-custom-url err-custom-url');
    assert.equal(await text(page, '#hint-custom-url'), '必须以 https:// 开头，用 {year} 代表年份。网址返回的内容要和「格式示例」格式相同。');
    assert.equal(await text(page, '#explain-custom-url'), '默认先从 jsDelivr、再从 GitHub 获取假期数据。连不上时，可以填写你自己存放文件的网址。留空 = 使用默认来源。');
  }));

// R47「复制示例」：clipboard.writeText 成功 → 「已复制」（剪贴板里就是示例全文）；被拒绝（CDP 把 clipboard-write 设为 denied）
// 或不可用 → 选中整段示例并提示「已选中示例，请按 Ctrl+C 复制」
test('复制示例 (R47): granted → 「已复制」 and the clipboard holds the full example; denied / unavailable → selection + Ctrl+C note', async () => {
  for (const mode of ['granted', 'denied', 'unavailable']) {
    await withPage(T1412, async (page) => {
      const origin = new URL(server.url).origin;
      if (mode === 'granted') await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
      let cdp = null;
      if (mode === 'denied') {
        // 覆盖只在这个 CDP 会话存续期间有效：测试结束才 detach
        cdp = await browser.newBrowserCDPSession();
        const { browserContextIds } = await cdp.send('Target.getBrowserContexts');
        for (const id of browserContextIds) await cdp.send('Browser.setPermission', { permission: { name: 'clipboard-write' }, setting: 'denied', origin, browserContextId: id });
      }
      await tab(page, '基本设置').click();
      await page.locator('#btn-example').click();
      const code = await page.locator('#holiday-example-code').textContent();
      await page.locator('#btn-example-copy').click();
      // 结果先清空、100ms 后再写（连续复制会重新朗读）：让暂停的时钟走一点
      for (let i = 0; i < 40 && !(await text(page, '.example-copy-state')); i++) { await page.clock.runFor(50); await new Promise((r) => setTimeout(r, 25)); }
      const state = page.locator('.example-copy-state');
      assert.equal(await state.getAttribute('role'), 'status', 'one polite live message');
      if (mode === 'granted') {
        assert.equal(await text(page, '.example-copy-state'), '已复制');
        assert.equal(await page.evaluate(() => navigator.clipboard.readText()), code, 'clipboard = the example shown');
      } else {
        assert.equal(await text(page, '.example-copy-state'), '已选中示例，请按 Ctrl+C 复制');
        assert.equal(await page.evaluate(() => String(getSelection())), code, 'the whole example is selected');
      }
      assert.doesNotMatch(await text(page, '.example-copy-state'), /Cmd|⌘/);
      await cdp?.detach();
    }, mode === 'unavailable' ? { init: 'Object.defineProperty(Navigator.prototype, "clipboard", { get: () => undefined, configurable: true });' } : undefined);
  }
});

// R47：示例下方的白话说明（五行 + GitHub 地址 + 官方来源），地址与来源是可选取的文字、不是链接
test('R47: the format help under the example lists year / papers / days / off-day rule, the GitHub address and the official source as text', () =>
  withPage(T1412, async (page) => {
    await page.setViewportSize({ width: 1280, height: 585 });
    await tab(page, '基本设置').click();
    await page.locator('#btn-example').click();
    assert.deepEqual(await page.locator('#holiday-example .ex-line').allTextContents(), [
      '文件为 holiday-cn 格式的年度 JSON（例如 2027.json）。',
      'year：年份（数字，例如 2027）；days 里的日期都必须在这一年内。',
      'papers：官方放假通知的网址，必须以 https://www.gov.cn/ 开头，否则整份文件会被拒绝。',
      'days：每一天一条；isOffDay 为 true 表示放假，false 表示调休上班（调休上班日必须是周六或周日）。',
      '文件里至少要有一个放假日，否则会被拒绝。',
      '可从 github.com/NateScarlet/holiday-cn 下载（在大陆可能打不开，可请朋友下载后发给你）',
      '官方来源：中国政府网（gov.cn）每年发布的《关于 20XX 年部分节假日安排的通知》',
    ]);
    assert.equal(await page.locator('#holiday-example a, #holiday-example [href]').count(), 0, 'no links');
    assert.notEqual(await page.locator('#holiday-example .ex-official').evaluate((e) => getComputedStyle(e).userSelect), 'none', 'selectable');
    const m = await measure(page);
    assert.ok(m.scrollH <= m.ih, 'no page scroll with the example expanded');
    assert.equal(m.tablistVisible, true);
    assert.equal(m.settingsColOverflow[0], 0, 'left column unaffected');
  }));

// 新元素的对比度（浏览器实际算出的颜色）：文字 ≥ 4.5:1
test('contrast ≥ 4.5:1 for the new elements (chips, hints, pill, tag, tooltip lines, float notes, disabled float button, disclosure)', async () => {
  const bgOf = (el) => {
    for (let e = el; e; e = e.parentElement) {
      const c = getComputedStyle(e).backgroundColor;
      if (c && c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent') return c;
    }
    return 'rgb(255, 255, 255)';
  };
  const grab = (page, sels) => page.evaluate(({ sels, bgSrc }) => {
    const bgOf = new Function(`return (${bgSrc})`)();
    return sels.map((s) => {
      const e = document.querySelector(s);
      return e ? [s, getComputedStyle(e).color, bgOf(e)] : [s, null, null];
    });
  }, { sels, bgSrc: bgOf.toString() });
  const check = (rows) => {
    for (const [s, fg, bg] of rows) {
      assert.ok(fg, `${s} exists`);
      const r = ratio(fg, bg);
      console.log(`MEASURE ${JSON.stringify({ case: 'contrast', what: s, fg, bg, ratio: +r.toFixed(2) })}`);
      assert.ok(r >= 4.5, `${s}: ${fg} on ${bg} = ${r.toFixed(2)}`);
    }
  };
  await withPage(T1412, async (page) => {
    check(await grab(page, ['.cal-note-text', '.cal-note-sub', '.legend-hint', '.legend-item']));
    await page.getByRole('button', { name: /上月/ }).click();
    check(await grab(page, ['.cal-note[data-tone="holiday"] .cal-note-text']));
    await cell(page, '10月1日').hover();
    await page.clock.runFor(450);
    check(await grab(page, ['.day-tooltip .tip-title', '.day-tooltip .tip-status', '.day-tooltip .tip-source', '.day-tooltip .tip-pay']));
    await page.locator('.cal-today').click();
    await page.getByRole('button', { name: /下月/ }).click();
    await page.getByRole('button', { name: /下月/ }).click();
    check(await grab(page, ['.cal-summary .cal-year-tag', '.cal-note[data-tone="holiday"] .cal-note-text']));
    await tab(page, '基本设置').click();
    check(await grab(page, ['.chip-ok', '.chip-miss', '.chip-note', '.act-hint', '.scard-desc', '.scard-title', '.row-label', '.row-hint', '.para', '.para b', '.warn-note', '.disclosure', '.adv-sub', '.adv-summary', '.unit', '.switch-state']));
    await page.locator('#btn-example').click();
    await page.locator('#adv-toggle').click();
    check(await grab(page, ['.example-head span', '.code', '.ex-line', '.mono', '#hint-custom-url', '#explain-custom-url']));
    await page.locator('#btn-float').click();
    await page.frameLocator('iframe.pip-stub').locator('#status-card').waitFor();
    check(await grab(page, ['#float-keep', '.pip-placeholder-title', '.pip-placeholder-note', '#btn-float']));
  }, { init: FLOAT_STUB });
  await withPage(T1412, async (page) => {
    check(await grab(page, ['#float-note', '#btn-float']));
  }, { init: NO_PIP });
});

// ---- Task 14 fix round 1 · Block A（R51 / R52）----

// A1：1000–1199px 宽时设置分页变成单栏：所有卡片都必须能在分页内部滚动到（分页标签不动、页面不滚）
async function scrollSettingsToBottom(page) {
  return page.evaluate(() => {
    const sp = document.getElementById('panel-settings');
    for (const el of [sp, ...sp.querySelectorAll('*')]) if (el.scrollHeight > el.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(el).overflowY)) el.scrollTop = el.scrollHeight;
    const pr = sp.getBoundingClientRect();
    const adv = document.querySelector('.section-adv').getBoundingClientRect();
    const tl = document.querySelector('[role=tablist]').getBoundingClientRect();
    return {
      panel: [Math.round(pr.top), Math.round(pr.bottom)], adv: [Math.round(adv.top * 10) / 10, Math.round(adv.bottom * 10) / 10],
      advVisible: adv.top >= pr.top - 0.5 && adv.bottom <= pr.bottom + 0.5,
      tabs: tl.top >= 0 && tl.bottom <= innerHeight, pageScroll: document.documentElement.scrollHeight > innerHeight,
    };
  });
}
test('A1: at 1100×700, 1093×535 and 1000×600 every settings card is reachable by scrolling inside the panel; 1024×468 never scrolls the page', () =>
  withPage(T1412, async (page) => {
    for (const [w, ht] of [[1100, 700], [1093, 535], [1000, 600]]) {
      await page.setViewportSize({ width: w, height: ht });
      await tab(page, '基本设置').click();
      const r = await scrollSettingsToBottom(page);
      console.log(`MEASURE ${JSON.stringify({ case: 'A1 settings scroll to bottom', w, ht, ...r })}`);
      assert.equal(r.advVisible, true, `${w}x${ht}: 高级设置 fully visible after scrolling (adv ${r.adv} panel ${r.panel})`);
      assert.equal(r.tabs, true, `${w}x${ht}: tab labels visible`);
      assert.equal(r.pageScroll, false, `${w}x${ht}: page does not scroll`);
    }
    // 1024×468（设置分页）：页面不滚动。月历分页在这个高度放不下 6 行 × 40px 的最小行高（spec §13.1），只记录量测值
    await page.setViewportSize({ width: 1024, height: 468 });
    for (const tb of ['基本设置', '月历']) {
      await tab(page, tb).click();
      const s = await page.evaluate(() => ({ sh: document.documentElement.scrollHeight, ih: innerHeight }));
      console.log(`MEASURE ${JSON.stringify({ case: 'A1 1024x468', tab: tb, ...s })}`);
      if (tb === '基本设置') {
        assert.ok(s.sh <= s.ih, `1024x468 ${tb}: page does not scroll (${s.sh} > ${s.ih})`);
        const r = await scrollSettingsToBottom(page);
        assert.equal(r.advVisible, true, '1024x468: 高级设置 reachable');
      }
    }
  }));

// A2：Windows 常驻卷轴（12 / 17px）+ 错误条 + 信息条，1280×585 默认状态左栏不得溢出
for (const sb of [17, 12]) {
  test(`A2: classic ${sb}px scrollbars at 1280×585 with error + info banners: the left settings column does not overflow`, () =>
    withPage(T1412, async (page) => {
      await page.setViewportSize({ width: 1280, height: 585 });
      await page.addStyleTag({ content: `::-webkit-scrollbar{width:${sb}px;height:${sb}px;background:#eee}::-webkit-scrollbar-thumb{background:#999}` });
      await tab(page, '基本设置').click();
      await page.getByLabel('月薪').fill('7000');
      await page.getByLabel('月薪').fill('6800');
      assert.equal(await page.locator(errorBar).isVisible(), true);
      assert.equal(await page.locator(infoBar).isVisible(), true);
      const m = await measure(page);
      const heads = await page.evaluate(() => [...document.querySelectorAll('.scard-head')].map((h) => Math.round(h.getBoundingClientRect().height)));
      console.log(`MEASURE ${JSON.stringify({ case: `A2 scrollbar ${sb}px`, colOverflow: m.settingsColOverflow, colSlack: m.settingsColSlack, heads })}`);
      assert.deepEqual(m.settingsColOverflow, [0, 0], `${sb}px scrollbar: no column overflow`);
      assert.equal(await page.locator('#hint-cheer').evaluate((e) => {
        const c = e.closest('.set-col').getBoundingClientRect();
        return e.getBoundingClientRect().bottom <= c.bottom + 0.5;
      }), true, '#hint-cheer inside the column');
    }, corruptThenQuota));
}

// A3（R52）：悬浮中占位卡的高度跟着「此刻」卡片该有的高度（视窗跨过 640px 时不跳）；不支持时按钮是 aria-disabled 且可聚焦
test('A3: while floating the placeholder height follows the live card height across the 640px breakpoint (no jump on recall)', () =>
  withPage(T1412, async (page) => {
    await page.setViewportSize({ width: 1280, height: 700 });
    await page.locator('#btn-float').click();
    await page.frameLocator('iframe.pip-stub').locator('#status-card').waitFor();
    await page.evaluate(() => { document.querySelector('iframe.pip-stub').style.visibility = 'hidden'; }); // stub 视窗盖在左下，会挡住按钮的点击
    const ph = () => page.locator('.pip-placeholder').evaluate((e) => Math.round(e.getBoundingClientRect().height * 10) / 10);
    const tall = await ph();
    await page.setViewportSize({ width: 1280, height: 585 });
    await page.clock.runFor(100); // resize 事件在下一次渲染更新时派发：让暂停的时钟走一点
    await new Promise((r) => setTimeout(r, 100));
    const short = await ph();
    await page.locator('#btn-float').click(); // 收回
    const card = await page.locator('#status-card').evaluate((e) => Math.round(e.getBoundingClientRect().height * 10) / 10);
    console.log(`MEASURE ${JSON.stringify({ case: 'A3 placeholder height', tall, short, cardAfterRecall: card })}`);
    assert.ok(Math.abs(short - card) <= 1, `placeholder ${short} = card after recall ${card} (no jump)`);
    assert.ok(tall > short, 'the placeholder did follow the breakpoint');
  }, { init: FLOAT_STUB }));

test('A3: unsupported browser — float button is aria-disabled (not native disabled), keyboard-focusable, described by the reason; activating does nothing', () =>
  withPage(T1412, async (page) => {
    const b = page.locator('#btn-float');
    assert.equal(await b.evaluate((e) => e.disabled), false, 'not native disabled');
    assert.equal(await b.getAttribute('aria-disabled'), 'true');
    assert.equal(await b.getAttribute('aria-describedby'), 'float-note');
    await b.focus();
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'btn-float', 'focusable');
    await page.keyboard.press('Enter');
    await page.keyboard.press(' ');
    await b.click({ force: true }); // Playwright 把 aria-disabled 视为不可点：强制派发真实点击
    await b.evaluate((e) => e.click());
    assert.equal(await page.locator('#card-slot #status-card').count(), 1, 'nothing happened');
    assert.equal(await page.locator('.pip-placeholder').isVisible(), false);
    assert.equal(await page.locator('.toast').isVisible(), false, 'no failure toast');
    assert.equal(await b.textContent(), '悬浮成小窗');
  }, { init: NO_PIP }));

// ---- Task 14 fix round 1 · Block B ----

// B1（WCAG 2.4.11）：按下「查看导入文件的格式示例」后，获得焦点的展开钮仍在右栏的可见范围内（示例比右栏高时也一样）
test('B1: after expanding the example the focused toggle stays inside the visible rect of every scroller around it (two-column 1280×585, 1366×650; single-column 1100×520, 1093×535, 1024×468)', () =>
  withPage(T1412, async (page) => {
    for (const [w, ht] of [[1280, 585], [1366, 650], [1100, 520], [1093, 535], [1024, 468]]) {
      await page.setViewportSize({ width: w, height: ht });
      await tab(page, '基本设置').click();
      for (const how of ['click', 'keyboard', 'help']) {
        if (how === 'click') await page.locator('#btn-example').click();
        else if (how === 'keyboard') { await page.locator('#btn-example').focus(); await page.keyboard.press('Enter'); }
        else { await page.locator('#adv-toggle').click(); await page.locator('#btn-adv-example').click(); }
        const r = await page.evaluate(() => {
          // 可见范围 = 视窗与所有可滚动祖先（两栏时是右栏，单栏时是 .settings）的交集
          const btn = document.getElementById('btn-example');
          let top = 0;
          let bottom = innerHeight;
          for (let e = btn.parentElement; e; e = e.parentElement) {
            if (/(auto|scroll|hidden)/.test(getComputedStyle(e).overflowY) && e.scrollHeight > e.clientHeight + 1 || /(auto|scroll)/.test(getComputedStyle(e).overflowY)) {
              const rr = e.getBoundingClientRect();
              top = Math.max(top, rr.top);
              bottom = Math.min(bottom, rr.bottom);
            }
          }
          const t = btn.getBoundingClientRect();
          return { focus: document.activeElement?.id, t: [Math.round(t.top), Math.round(t.bottom)], col: [Math.round(top), Math.round(bottom)], inView: t.top >= top - 0.5 && t.bottom <= bottom + 0.5, exH: Math.round(document.getElementById('holiday-example').getBoundingClientRect().height) };
        });
        console.log(`MEASURE ${JSON.stringify({ case: 'B1 toggle in view', w, ht, how, ...r })}`);
        assert.equal(r.focus, 'btn-example', `${w} ${how}: focus on the toggle`);
        assert.equal(r.inView, true, `${w} ${how}: focused toggle ${r.t} inside the column ${r.col}`);
        // 收起，回到初始状态
        await page.locator('#btn-example').click();
        if (how === 'help') await page.locator('#adv-toggle').click();
        await page.evaluate(() => document.querySelectorAll('.set-col, .settings').forEach((c) => { c.scrollTop = 0; }));
      }
    }
  }));

test('B minors: chip group is announced once (aria-label only, no duplicate text); backup card documents what the backup excludes; 复制示例 re-announces on repeated copies', () =>
  withPage(T1412, async (page) => {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(server.url).origin });
    await page.setViewportSize({ width: 1280, height: 585 });
    await tab(page, '基本设置').click();
    const st = await page.locator('#holiday-status').evaluate((e) => ({
      aria: e.getAttribute('aria-label'), sr: e.querySelector('.visually-hidden')?.textContent ?? null,
      exposed: [...e.childNodes].filter((n) => n.nodeType === 1 && n.getAttribute('aria-hidden') !== 'true').map((n) => n.className),
    }));
    assert.equal(st.aria, '假期数据状态：2026 年 · 内置 · 2027 年 · 未内置 · 上次检查 11/03');
    // fix round 2：只保留一份（分组名称）；可见的胶囊对读屏隐藏，没有重复的隐藏文字
    assert.equal(st.sr, null, 'no visually-hidden duplicate of the group name');
    assert.deepEqual(st.exposed, [], 'chips / last-check are aria-hidden: the sentence is announced once');
    assert.equal(await text(page, '.section-backup .backup-scope'), '备份不含联网取得或导入的假期表和自定义数据网址。');
    await page.locator('#btn-example').click();
    await page.evaluate(() => {
      window.__cs = [];
      const el = document.querySelector('.example-copy-state');
      new MutationObserver(() => window.__cs.push(el.textContent)).observe(el, { childList: true, characterData: true, subtree: true });
    });
    for (let i = 0; i < 2; i++) {
      await page.locator('#btn-example-copy').click();
      for (let k = 0; k < 20; k++) { await page.clock.runFor(50); await new Promise((r) => setTimeout(r, 10)); }
    }
    const seq = (await page.evaluate(() => window.__cs)).filter((x, i, a) => i === 0 || x !== a[i - 1]);
    console.log(`MEASURE ${JSON.stringify({ case: 'B copy announcements', seq })}`);
    assert.deepEqual(seq.filter((x) => x === '已复制').length, 2, `announced twice: ${JSON.stringify(seq)}`);
    assert.ok(seq.includes(''), 'cleared between announcements');
    const m = await measure(page);
    assert.equal(m.scrollH <= m.ih, true);
  }));

// ---- Task 14 fix round 1 · Block C（R49 / R50）----

// R50：提示的每一行都不被省略号截断（scrollWidth ≤ clientWidth）：2026 年全部 7 个节日的放假 / 调休、今天、带薪 / 无薪 / 手动标记，
// 四种视窗；5 周月份用内置 2026 表，6 周月份（2027-05）用导入的测试表（7 个节日名都放进去，虚构数据只为测宽度）
const WIDTH2027 = JSON.stringify({
  year: 2027, papers: ['https://www.gov.cn/zhengce/test-width-2027.htm'],
  days: [
    ...['元旦', '春节', '清明', '劳动节', '端午', '中秋', '国庆'].map((n, i) => ({ name: n, date: `2027-05-${String(3 + i).padStart(2, '0')}`, isOffDay: true })),
    ...[['元旦', '01'], ['春节', '02'], ['清明', '15'], ['劳动节', '16'], ['端午', '22'], ['中秋', '23'], ['国庆', '29']].map(([n, d]) => ({ name: n, date: `2027-05-${d}`, isOffDay: false })),
  ],
}); // 2027-05-01 是周六；所有调休日都在周六 / 周日
async function tipLines(page, key) {
  const c = page.locator(`.cal-grid button[data-key="${key}"]`);
  await c.hover();
  await page.clock.runFor(450);
  const r = await c.evaluate((b) => {
    const tip = document.querySelector('.day-tooltip');
    const desc = document.getElementById(b.getAttribute('aria-describedby')).textContent;
    return { hidden: tip.hidden, desc, lines: [...tip.children].filter((x) => getComputedStyle(x).display !== 'none').map((x) => ({ text: x.textContent, cut: x.scrollWidth > x.clientWidth })) };
  });
  await page.mouse.move(0, 0);
  return r;
}
test('R50: no tooltip line is truncated — every 2026 festival (off + make-up), today, leave / manual states; 5-week and 6-week months; four viewports', () =>
  withPage(T1412, async (page) => {
    await tab(page, '基本设置').click();
    await page.locator('#holiday-file').setInputFiles({ name: '2027.json', mimeType: 'application/json', buffer: Buffer.from(WIDTH2027) });
    await page.locator('#holiday-result[data-tone="success"]').waitFor();
    await tab(page, '月历').click();
    // 手动标记：11/5 带薪假、11/6 无薪假、11/7（周六）改为上班、11/9 改为休息
    for (const [label, re] of [['11月5日', /^带薪假/], ['11月6日', /^无薪假/], ['11月7日', /改为上班/], ['11月9日', /改为休息/]]) {
      await cell(page, label).click();
      await page.getByRole('menuitemradio', { name: re }).click();
    }
    const builtin = [
      ['2026-01', ['2026-01-01', '2026-01-04']], ['2026-02', ['2026-02-15', '2026-02-14']], ['2026-04', ['2026-04-04']],
      ['2026-05', ['2026-05-01', '2026-05-09']], ['2026-06', ['2026-06-19']], ['2026-09', ['2026-09-25', '2026-09-20']], ['2026-10', ['2026-10-01', '2026-10-10']],
    ];
    const months = [
      ...builtin,
      ['2026-11', ['2026-11-03', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-09', '2026-11-18']], // 6 周：今天 / 带薪 / 无薪 / 手动上班 / 手动休息 / 工作日
      ['2027-05', ['2027-05-03', '2027-05-04', '2027-05-05', '2027-05-06', '2027-05-07', '2027-05-08', '2027-05-09', '2027-05-01', '2027-05-02', '2027-05-15', '2027-05-16', '2027-05-22', '2027-05-23', '2027-05-29']], // 6 周：7 个节日名的放假与调休
    ];
    const go = async (ym) => {
      const [y, m] = ym.split('-').map(Number);
      await page.locator('.cal-today').click();
      const diff = (y - 2026) * 12 + (m - 11);
      for (let i = 0; i < Math.abs(diff); i++) await page.getByRole('button', { name: diff < 0 ? /上月/ : /下月/ }).click();
    };
    const cuts = [];
    let checked = 0;
    for (const [w, ht] of VIEWPORTS) {
      await page.setViewportSize({ width: w, height: ht });
      for (const [ym, keys] of months) {
        await go(ym);
        for (const key of keys) {
          const r = await tipLines(page, key);
          assert.equal(r.hidden, false, `${key} @${w}: shown`);
          checked++;
          for (const l of r.lines) if (l.cut) cuts.push(`${w}x${ht} ${key}: 「${l.text}」`);
          // 完整文字（含来源与「点击修改」）在 aria-describedby
          assert.match(r.desc, /来源：.+，当日计薪 .+，点击修改$/, `${key}: full text in aria-describedby`);
        }
      }
    }
    console.log(`MEASURE ${JSON.stringify({ case: 'R50 tooltip widths', checked, cuts })}`);
    assert.deepEqual(cuts, [], 'no truncated tooltip line');
    // 状态行的短写
    await page.setViewportSize({ width: 1280, height: 585 });
    await go('2026-05');
    assert.deepEqual((await tipLines(page, '2026-05-01')).lines.map((l) => l.text), ['5月1日 周五', '法定假日·劳动节', '内置·官方通知', '计薪 ¥0.00']);
    assert.equal((await tipLines(page, '2026-05-09')).lines[1].text, '调休上班·劳动节');
    await go('2026-11');
    assert.deepEqual((await tipLines(page, '2026-11-03')).lines.map((l) => l.text).slice(0, 2), ['11月3日 周二', '工作日·今天']);
  }));

// C minor：周末图例色块在白底上看得出来（边框 ≥ 2.5:1，与其他色块的浅边框不同）
test('weekend legend swatch is distinguishable on white (visible border)', () =>
  withPage(T1412, async (page) => {
    const c = await page.locator('.cal-legend [data-kind=weekend] .legend-swatch').evaluate((e) => {
      const cs = getComputedStyle(e);
      return { border: cs.borderTopColor, width: cs.borderTopWidth, bg: cs.backgroundColor, panel: getComputedStyle(document.querySelector('.main-panel')).backgroundColor };
    });
    const r = ratio(c.border, c.panel);
    console.log(`MEASURE ${JSON.stringify({ case: 'weekend swatch', ...c, ratio: +r.toFixed(2) })}`);
    assert.ok(r >= 2.5, `weekend swatch border ${c.border} on ${c.panel} = ${r.toFixed(2)}`);
    assert.equal(c.width, '1px');
  }));

// ---- Task 14 fix round 1 · C3（Kevin 实机反馈）----

// 提示的内容块在卡片里垂直居中（上下留白差 ≤ 1px），日期行比其他行更醒目；四种视窗 + 一个很高的格子，5 周与 6 周月份
async function tipBalance(page, key) {
  const c = page.locator(`.cal-grid button[data-key="${key}"]`);
  await c.hover();
  await page.clock.runFor(450);
  const r = await page.evaluate(() => {
    const tip = document.querySelector('.day-tooltip');
    const tr = tip.getBoundingClientRect();
    const lines = [...tip.children].filter((x) => getComputedStyle(x).display !== 'none');
    const first = lines[0].getBoundingClientRect();
    const last = lines.at(-1).getBoundingClientRect();
    const fs = lines.map((x) => parseFloat(getComputedStyle(x).fontSize));
    const fw = lines.map((x) => getComputedStyle(x).fontWeight);
    return {
      top: Math.round((first.top - tr.top) * 10) / 10, bottom: Math.round((tr.bottom - last.bottom) * 10) / 10, h: Math.round(tr.height * 10) / 10,
      n: lines.length, fs, fw, cut: lines.some((x) => x.scrollWidth > x.clientWidth), payColor: getComputedStyle(lines.at(-1)).color,
    };
  });
  await page.mouse.move(0, 0);
  return r;
}
test('C3: tooltip content is vertically centred in the card (top/bottom space differ ≤ 1px) with a clear hierarchy — 4 viewports + a tall cell, 5- and 6-week months', () =>
  withPage(T1412, async (page) => {
    for (const [w, ht] of [...VIEWPORTS, [1920, 1300]]) {
      await page.setViewportSize({ width: w, height: ht });
      for (const [ym, key] of [['2026-11', '2026-11-03'], ['2026-11', '2026-11-18'], ['2026-10', '2026-10-01']]) {
        await page.locator('.cal-today').click();
        if (ym === '2026-10') await page.getByRole('button', { name: /上月/ }).click();
        const r = await tipBalance(page, key);
        console.log(`MEASURE ${JSON.stringify({ case: 'C3 tooltip balance', w, ht, key, ...r })}`);
        assert.ok(Math.abs(r.top - r.bottom) <= 1, `${key} @${w}x${ht}: top ${r.top} vs bottom ${r.bottom}`);
        assert.equal(r.cut, false, `${key} @${w}x${ht}: no truncated line`);
        assert.ok(r.fs[0] > r.fs[1], `date line larger (${r.fs})`);
        assert.ok(Number(r.fw[0]) >= 700 && Number(r.fw[1]) <= 500, `date bold, status normal (${r.fw})`);
        assert.equal(r.payColor, 'rgb(187, 247, 208)', 'pay line accent');
      }
      if (w === 1280 || w === 1920 && ht === 950) {
        await page.locator('.cal-today').click();
        await page.locator('.cal-grid button[data-key="2026-11-04"]').hover();
        await page.clock.runFor(450);
        await shot(page, `task-14-c3-tooltip-${w}x${ht}.png`);
        await page.mouse.move(0, 0);
      }
    }
  }));

// 今天的绿色圆圈：数字在圆里光学居中（字形墨迹框中心 vs 圆心 ≤ 1px），圆整个在格子里、距 2px 的今天边框 ≥ 2px；
// 1 位数与 2 位数日期；普通格子的数字位置与今天一致（同一行看起来整齐）
async function numGeometry(page, key) {
  return page.locator(`.cal-grid button[data-key="${key}"]`).evaluate((b) => {
    const num = b.querySelector('.day-num');
    const nr = num.getBoundingClientRect();
    const br = b.getBoundingClientRect();
    const bw = parseFloat(getComputedStyle(b).borderTopWidth);
    const range = document.createRange();
    range.selectNodeContents(num);
    const tr = range.getBoundingClientRect();
    const cs = getComputedStyle(num);
    const ctx = document.createElement('canvas').getContext('2d');
    ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const m = ctx.measureText(num.textContent);
    const baseline = tr.top + m.fontBoundingBoxAscent;
    const ink = { l: tr.left - m.actualBoundingBoxLeft, r: tr.left + m.actualBoundingBoxRight, t: baseline - m.actualBoundingBoxAscent, b: baseline + m.actualBoundingBoxDescent };
    const r1 = (v) => Math.round(v * 10) / 10;
    return {
      text: num.textContent, today: b.classList.contains('is-today'),
      dx: r1((ink.l + ink.r) / 2 - (nr.left + nr.right) / 2), dy: r1((ink.t + ink.b) / 2 - (nr.top + nr.bottom) / 2),
      clearTop: r1(nr.top - (br.top + bw)), clearLeft: r1(nr.left - (br.left + bw)),
      offTop: r1(nr.top - br.top), offLeft: r1(nr.left - br.left), circle: [r1(nr.width), r1(nr.height)],
    };
  });
}
test('C3: today circle — digit optically centred (≤ 1px), circle inside the cell with ≥ 2px clearance from the 2px border; 1- and 2-digit dates; consistent with other cells; four viewports', async () => {
  for (const [iso, todayKey, otherKey] of [['2026-11-04T10:00:00+08:00', '2026-11-04', '2026-11-05'], ['2026-11-18T10:00:00+08:00', '2026-11-18', '2026-11-19']]) {
    await withPage(iso, async (page) => {
      for (const [w, ht] of VIEWPORTS) {
        await page.setViewportSize({ width: w, height: ht });
        const t = await numGeometry(page, todayKey);
        const o = await numGeometry(page, otherKey);
        console.log(`MEASURE ${JSON.stringify({ case: 'C3 today circle', w, ht, today: t, other: o })}`);
        assert.equal(t.today, true);
        assert.ok(Math.abs(t.dx) <= 1 && Math.abs(t.dy) <= 1, `${t.text} @${w}: digit centred in the circle (dx ${t.dx}, dy ${t.dy})`);
        assert.ok(t.clearTop >= 2 && t.clearLeft >= 2, `${t.text} @${w}: ≥ 2px from the today border (top ${t.clearTop}, left ${t.clearLeft})`);
        assert.ok(t.circle[0] >= t.circle[1] - 0.5, 'round circle wide enough for 2 digits');
        assert.ok(Math.abs(t.offTop - o.offTop) <= 0.5 && Math.abs(t.offLeft - o.offLeft) <= 0.5, `today number at the same place as other cells (${t.offTop},${t.offLeft} vs ${o.offTop},${o.offLeft})`);
        assert.ok(Math.abs(o.dx) <= 1 && Math.abs(o.dy) <= 1, `other number centred in its box (dx ${o.dx}, dy ${o.dy})`);
        if ((w === 1280 || w === 1920) && todayKey === '2026-11-04') await shot(page, `task-14-c3-today-${w}x${ht}.png`);
      }
    });
  }
});

// ---- Task 14 fix round 2 · Block C ----

// 支持的最窄宽度（≥ 1000px）也不得截断：窄格子里允许换行 / 小一号字（≥ 1280 保持原样）；同时不得被纵向裁切
test('C round 2: tooltip never truncates or clips at 1000×700, 1100×700, 1150×700 (and the four target viewports)', () =>
  withPage(T1412, async (page) => {
    await cell(page, '11月5日').click();
    await page.getByRole('menuitemradio', { name: /^带薪假/ }).click();
    const sets = [
      ['2026-11', ['2026-11-03', '2026-11-05', '2026-11-18', '2026-11-28']],
      ['2026-10', ['2026-10-01', '2026-10-10', '2026-10-31']],
      ['2026-09', ['2026-09-20', '2026-09-25']],
      ['2026-05', ['2026-05-01', '2026-05-09']],
      ['2026-02', ['2026-02-14', '2026-02-15']],
    ];
    const bad = [];
    const sizes = [];
    for (const [w, ht] of [[1000, 700], [1100, 700], [1150, 700], ...VIEWPORTS]) {
      await page.setViewportSize({ width: w, height: ht });
      for (const [ym, keys] of sets) {
        const [y, m] = ym.split('-').map(Number);
        await page.locator('.cal-today').click();
        const diff = (y - 2026) * 12 + (m - 11);
        for (let i = 0; i < Math.abs(diff); i++) await page.getByRole('button', { name: diff < 0 ? /上月/ : /下月/ }).click();
        for (const key of keys) {
          const c = page.locator(`.cal-grid button[data-key="${key}"]`);
          await c.hover();
          await page.clock.runFor(450);
          const r = await page.evaluate(() => {
            const tip = document.querySelector('.day-tooltip');
            const lines = [...tip.children].filter((x) => getComputedStyle(x).display !== 'none');
            return {
              w: Math.round(tip.getBoundingClientRect().width), h: Math.round(tip.getBoundingClientRect().height),
              vclip: tip.scrollHeight > tip.clientHeight + 0.5,
              cut: lines.filter((x) => x.scrollWidth > x.clientWidth + 0.5).map((x) => x.textContent),
              last: lines.at(-1).textContent, n: lines.length, fs: getComputedStyle(lines[0]).fontSize,
            };
          });
          await page.mouse.move(0, 0);
          if (r.vclip || r.cut.length || !/^计薪/.test(r.last)) bad.push(`${w}x${ht} ${key}: ${JSON.stringify(r)}`);
          if (key === '2026-10-10') sizes.push({ w, ht, cell: [r.w, r.h], lines: r.n, dateFont: r.fs });
        }
      }
    }
    console.log(`MEASURE ${JSON.stringify({ case: 'C r2 narrow tooltip', sizes, bad })}`);
    assert.deepEqual(bad, [], 'no truncated / clipped tooltip at any supported width');
  }));

// 2 位数日期：数字两侧离圆边 ≥ 2px，圆仍是正圆，居中 ≤ 1px
test('C round 2: today circle with 2 digits has ≥ 2px side room, stays round and centred', async () => {
  for (const [iso, key] of [['2026-11-18T10:00:00+08:00', '2026-11-18'], ['2026-11-30T10:00:00+08:00', '2026-11-30'], ['2026-11-04T10:00:00+08:00', '2026-11-04']]) {
    await withPage(iso, async (page) => {
      for (const [w, ht] of VIEWPORTS) {
        await page.setViewportSize({ width: w, height: ht });
        const g = await numGeometry(page, key);
        const side = await page.locator(`.cal-grid button[data-key="${key}"] .day-num`).evaluate((num) => {
          const nr = num.getBoundingClientRect();
          const range = document.createRange();
          range.selectNodeContents(num);
          const tr = range.getBoundingClientRect();
          const cs = getComputedStyle(num);
          const ctx = document.createElement('canvas').getContext('2d');
          ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
          const m = ctx.measureText(num.textContent);
          return { l: tr.left - m.actualBoundingBoxLeft - nr.left, r: nr.right - (tr.left + m.actualBoundingBoxRight) };
        });
        console.log(`MEASURE ${JSON.stringify({ case: 'C r2 circle', w, key, ...g, side })}`);
        assert.ok(side.l >= 2 && side.r >= 2, `${key} @${w}: ink ≥ 2px from the circle edge (${side.l.toFixed(1)}, ${side.r.toFixed(1)})`);
        assert.ok(Math.abs(g.circle[0] - g.circle[1]) <= 0.5, `round (${g.circle})`);
        assert.ok(Math.abs(g.dx) <= 1 && Math.abs(g.dy) <= 1, `centred (${g.dx}, ${g.dy})`);
        assert.ok(g.clearTop >= 2 && g.clearLeft >= 2);
      }
    });
  }
});

// ---- Task 14 fix round 2 · Block A ----
// 悬浮中卡片内容变高（例如加了鼓励语、发薪日）：占位卡跟着变高，收回时不跳
test('A round 2: while floating, the placeholder follows the live card when its content grows (cheer + payday), no jump on recall', () =>
  withPage(T1412, async (page) => {
    await page.setViewportSize({ width: 1280, height: 700 });
    await page.locator('#btn-float').click();
    await page.frameLocator('iframe.pip-stub').locator('#status-card').waitFor();
    await page.evaluate(() => { document.querySelector('iframe.pip-stub').style.visibility = 'hidden'; });
    const ph = () => page.locator('.pip-placeholder').evaluate((e) => Math.round(e.getBoundingClientRect().height * 10) / 10);
    const before = await ph();
    await tab(page, '基本设置').click();
    await page.getByLabel('鼓励语').fill('今天也要好好加油，下班吃顿好的');
    await page.getByLabel('发薪日').selectOption({ label: '每月 5 号' });
    for (let i = 0; i < 4; i++) { await page.clock.runFor(100); await new Promise((r) => setTimeout(r, 50)); }
    const after = await ph();
    await page.locator('#btn-float').click(); // 收回
    const card = await page.locator('#status-card').evaluate((e) => Math.round(e.getBoundingClientRect().height * 10) / 10);
    console.log(`MEASURE ${JSON.stringify({ case: 'A r2 placeholder follows content', before, after, cardAfterRecall: card })}`);
    assert.ok(after > before, `placeholder grew (${before} → ${after})`);
    assert.ok(Math.abs(after - card) <= 1, `placeholder ${after} = card after recall ${card}`);
  }, { init: FLOAT_STUB }));

// ---- Task 14 fix round 3 · C ----

// 每个无表年份（过去或将来）摘要行都有看得见的简短标签；胶囊与标签都不被截断（1000×700 + 四种视窗）
test('C round 3: every no-table year (2024 / 2025 / 2027 / 2036) shows a visible qualifier tag in the summary row; nothing truncated at 1000×700 and the four viewports', () =>
  withPage(T1412, async (page) => {
    const cases = [
      ['2025-10', '2025 年仅标固定日期的法定假日'], ['2025-11', '2025 年仅标固定日期的法定假日'],
      ['2027-05', '2027 年仅标法定假日'], ['2036-10', '2036 年仅标固定日期的法定假日'], ['2024-05', '2024 年未标法定假日'],
    ];
    const rows = [];
    for (const [w, ht] of [[1000, 700], ...VIEWPORTS]) {
      await page.setViewportSize({ width: w, height: ht });
      for (const [ym, tagWant] of cases) {
        const [y, m] = ym.split('-').map(Number);
        await page.locator('.cal-today').click();
        const diff = (y - 2026) * 12 + (m - 11);
        for (let i = 0; i < Math.abs(diff); i++) await page.getByRole('button', { name: diff < 0 ? /上月/ : /下月/ }).click();
        const r = await page.evaluate(() => {
          const row = document.querySelector('.cal-summary');
          const tag = row.querySelector('.cal-year-tag');
          const note = row.querySelector('.cal-note');
          const cut = (e) => e.scrollWidth > e.clientWidth + 0.5 || [...e.querySelectorAll('*')].some((c) => c.scrollWidth > c.clientWidth + 0.5);
          const rr = row.getBoundingClientRect();
          const inside = (e) => { const b = e.getBoundingClientRect(); return b.right <= rr.right + 0.5 && b.bottom <= rr.bottom + 0.5; };
          return { tag: tag.hidden ? null : tag.textContent, tagCut: !tag.hidden && cut(tag), noteText: note.textContent, noteCut: cut(note), inside: inside(note) && (tag.hidden || inside(tag)), h: Math.round(rr.height) };
        });
        rows.push({ w, ym, ...r });
        assert.equal(r.tag, tagWant, `${ym} @${w}: visible qualifier`);
        assert.equal(r.tagCut, false, `${ym} @${w}: tag not truncated`);
        assert.equal(r.noteCut, false, `${ym} @${w}: pill not truncated (${r.noteText})`);
        assert.equal(r.inside, true, `${ym} @${w}: pill and tag inside the row`);
      }
    }
    console.log(`MEASURE ${JSON.stringify({ case: 'C r3 qualifier', rows })}`);
    const m = await measure(page);
    assert.ok(m.scrollH <= m.ih);
  }));

// 窄格子（< 1240px）里「周X」与「计薪 ¥…」是不可拆的单位：只在单位之间换行，仍不截断
test('C round 3: narrow tooltip wraps only between units — 「周X」 and 「计薪 ¥…」 never split; no truncation (1000×700, 1100×700)', () =>
  withPage(T1412, async (page) => {
    const bad = [];
    for (const [w, ht] of [[1000, 700], [1100, 700]]) {
      await page.setViewportSize({ width: w, height: ht });
      for (const [move, keys] of [[null, ['2026-11-03', '2026-11-18', '2026-11-28']], [/上月/, ['2026-10-10', '2026-10-01', '2026-10-17']]]) {
        await page.locator('.cal-today').click();
        if (move) await page.getByRole('button', { name: move }).click();
        for (const key of keys) {
          await page.locator(`.cal-grid button[data-key="${key}"]`).hover();
          await page.clock.runFor(450);
          const r = await page.evaluate(() => {
            const tip = document.querySelector('.day-tooltip');
            const lines = [...tip.children].filter((x) => getComputedStyle(x).display !== 'none');
            const title = lines[0];
            const wk = [...title.querySelectorAll('.u')].find((u) => /^周/.test(u.textContent));
            const pay = tip.querySelector('.tip-pay');
            return {
              weekday: wk ? wk.getClientRects().length : -1, pay: pay.getClientRects().length, payText: pay.textContent,
              cut: lines.filter((x) => x.scrollWidth > x.clientWidth + 0.5).map((x) => x.textContent), vclip: tip.scrollHeight > tip.clientHeight + 0.5,
            };
          });
          await page.mouse.move(0, 0);
          if (r.weekday !== 1 || r.pay !== 1 || r.cut.length || r.vclip) bad.push(`${w} ${key}: ${JSON.stringify(r)}`);
        }
      }
    }
    console.log(`MEASURE ${JSON.stringify({ case: 'C r3 units', bad })}`);
    assert.deepEqual(bad, []);
  }));
