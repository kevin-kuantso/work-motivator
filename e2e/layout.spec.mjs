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

// 本文件断言的是中国地区的版面文案、币别与年表：明确写入旧版（v1，无地区）设置，
// 让应用走「旧数据一律归中国」的迁移路径，不依赖应用当前的新用户默认地区（台湾）。
// 例外：断言首次提示横幅的测试必须让 localStorage 里没有设置，因此那些用例以 seed: false 保持全新用户。
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
const VIEWPORTS = [[1280, 585], [1366, 650], [1536, 730], [1920, 950]];
// Task 18：窄 / 矮视窗也是主要目标（1093×535 = 1366×768 @125%）；提示与格子标签的测试都要跑
const NARROW_VP = [[1000, 700], [1093, 535], [1100, 700], [1150, 700], [1200, 700]];
const ALL_VP = [...VIEWPORTS, ...NARROW_VP];
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
  const { seed = true, ...rest } = opts ?? {};
  const { context, page, errors, external, consoleErrors, autoUrls } = await openAt(browser, server.url, iso, { ...rest, init: seed ? seeded(rest.init) : rest.init });
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
// 提示新增的「农历」可见行（日期之后、状态之前）；格子放不下时整行不显示，完整农历始终在 aria-describedby
const LUNAR_LINE = /^农历/;
const cell = (page, label) => page.locator(`.cal-grid button[aria-label^="${label} "]`);
// 分页按钮的 id（#tab-settings / #tab-calendar）是稳定契约，与地区无关；role 名称会随字典变化
// （中国：基本设置 / 月历；台湾：基本設定 / 月曆），所以能认出来的名称一律换成 id 定位。
const TAB_LABELS = { settings: ['基本设置', '基本設定'], calendar: ['月历', '月曆'] };
const tab = (page, name) => {
  for (const [id, labels] of Object.entries(TAB_LABELS)) {
    if (typeof name === 'string' && labels.includes(name)) return page.locator(`#tab-${id}`);
    if (name instanceof RegExp && labels.some((label) => name.test(label))) return page.locator(`#tab-${id}`);
  }
  return page.getByRole('tab', { name });
};
const focused = (page) => page.evaluate(() => ({ id: document.activeElement?.id ?? null, key: document.activeElement?.dataset?.key ?? null }));
const errorBar = '.notices .banner-error';
const infoBar = '.notices .banner-info';

test('mobile settings navigation reaches each section with touch-sized actions in every theme', () =>
  withPage(T1412, async (page) => {
    await tab(page, '基本设置').click();
    for (const width of [320, 390, 768]) {
      await page.setViewportSize({ width, height: 844 });
      for (const theme of ['green', 'blue', 'orange', 'teal', 'rose', 'slate', 'rainbow']) {
        await page.locator('#f-theme').selectOption(theme);
        const sizes = await page.locator('#btn-holiday-check, #btn-holiday-import, #btn-example, #btn-export, #btn-import').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
        assert.ok(sizes.every((height) => height >= 44), `${width}/${theme}: ${sizes}`);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      }
      for (const [index, id] of [[0, 'card-pay-title'], [1, 'card-display-title'], [2, 'card-holiday-title'], [3, 'card-backup-title'], [4, 'adv-toggle']]) {
        await page.locator('.settings-nav-link').nth(index).click();
        assert.equal((await focused(page)).id, id);
        assert.equal(await page.locator(`#${id}`).isVisible(), true);
      }
      assert.equal(await page.locator('#adv-toggle').getAttribute('aria-expanded'), 'true');
    }
  }, { viewport: { width: 320, height: 844 } }));

test('save feedback restarts on successive valid edits and hides for invalid input', () =>
  withPage(T1412, async (page) => {
    await tab(page, '基本设置').click();
    await page.getByLabel('月薪').fill('7000');
    assert.equal(await page.locator('.autosave').isVisible(), true);
    await page.clock.runFor(1200);
    await page.getByLabel('月薪').fill('7100');
    await page.clock.runFor(500);
    assert.equal(await page.locator('.autosave').isVisible(), true, 'second save restarts the feedback');
    await page.getByLabel('月薪').fill('0');
    assert.equal(await page.locator('#f-salary').getAttribute('aria-invalid'), 'true');
    assert.equal(await page.locator('.autosave').isVisible(), false, 'invalid edit cannot appear saved');
    await page.getByLabel('月薪').fill('7200');
    assert.equal(await page.locator('.autosave').isVisible(), true);
  }));

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
      await page.locator('#f-theme').scrollIntoViewIfNeeded();
      assert.equal(await page.locator('#f-theme').isVisible(), true, `${w}x${ht}: theme remains reachable`);
    }
  }, { seed: false })); // 例外：首次提示横幅只在新用户（localStorage 没有设置）时出现，与写入旧版中国设置互斥

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
      await page.locator('#f-theme').scrollIntoViewIfNeeded();
      assert.equal(await page.locator('#f-theme').isVisible(), true, `${w}x${ht}: theme remains reachable with banners`);
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
    assert.equal(await page.locator('.autosave').isVisible(), false, 'failed write must not claim it was saved');
    await page.evaluate(() => { window.__fail = false; });
    await page.getByLabel('月薪').fill('7100');
    assert.equal(await page.locator(errorBar).isVisible(), false);
    assert.equal(await page.locator('.autosave').isVisible(), true, 'successful retry confirms the save');
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
  }, { seed: false })); // 例外：本用例要按首次提示的「去修改」按钮，首次提示只在新用户时出现

test('PgUp / PgDn on a day cell: switch month, focus same day (clamped to month end), preventDefault; ignored elsewhere — 2026-11 → 2027 内置年 → 2028 无内置表年（闰年 2/29）', () =>
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
    // 继续走进「无内置表」的年份（2028 起只有法定日期回退）：同号日期跨月照常，月底夹取仍按真实天数
    for (let i = 0; i < 10; i++) await page.keyboard.press('PageDown'); // 2027-03-28 … 2027-12-28
    assert.equal(await title(), '2027 年 12 月');
    assert.equal((await focused(page)).key, '2027-12-28');
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
    assert.equal((await focused(page)).key, '2027-12-31');
    await page.keyboard.press('PageDown');
    assert.equal(await title(), '2028 年 1 月');
    assert.equal((await focused(page)).key, '2028-01-31');
    await page.keyboard.press('PageDown');
    assert.equal(await title(), '2028 年 2 月');
    assert.equal((await focused(page)).key, '2028-02-29', '1/31 → 2/29 (clamped to the leap-year month end)');
    await page.keyboard.press('PageUp');
    assert.equal(await title(), '2028 年 1 月');
    assert.equal((await focused(page)).key, '2028-01-29', '29 日存在，不夹取');
    await page.keyboard.press('PageDown');
    assert.equal((await focused(page)).key, '2028-02-29');
    assert.equal(await page.evaluate(() => document.querySelectorAll('.cal-grid button[tabindex="0"]').length), 1);
    assert.equal(await page.locator('.cal-grid button[tabindex="0"]').getAttribute('data-key'), '2028-02-29', 'tab stop follows focus');
    assert.ok((await page.evaluate(() => window.__pg)).every(Boolean), 'all handled PgUp/PgDn were preventDefault-ed');
    // 修饰键：不处理
    await page.keyboard.press('Shift+PageUp');
    assert.equal(await title(), '2028 年 2 月');
    // 焦点不在日期格：不处理
    await page.locator('.cal-next').focus();
    await page.keyboard.press('PageDown');
    assert.equal(await title(), '2028 年 2 月');
    assert.equal((await page.evaluate(() => window.__pg)).at(-1), false);
    // R29：工具列不放可见的键盘提示；按键只写在「上月」「下月」的悬停提示里（无障碍名称仍是按钮文字）
    assert.equal(await page.locator('.cal-toolbar kbd, .cal-keys').count(), 0, 'no visible key hint in the toolbar');
    assert.doesNotMatch(await page.locator('.cal-toolbar').innerText(), /PgUp|PgDn|切换月份/);
    assert.equal(await page.locator('.cal-prev').getAttribute('title'), '上月（PgUp）');
    assert.equal(await page.locator('.cal-next').getAttribute('title'), '下月（PgDn）');
    assert.equal(await page.getByRole('button', { name: '‹ 上月', exact: true }).getAttribute('title'), '上月（PgUp）', 'accessible name = visible text; key in the description');
    assert.equal(await page.getByRole('button', { name: '下月 ›', exact: true }).getAttribute('title'), '下月（PgDn）');
  }));

// R36：图例永远列出全部 7 种，排成一行（有 / 没有假日的月份都一样）；「重置标记」仅本月有手动标记时出现，在摘要行最右
// M7：操作提示已移到工具列右端，量测对象跟着换（图例行内不再有提示）
const ALL_KINDS = ['weekend', 'holiday', 'makeup', 'paid', 'unpaid', 'today', 'manual'];
const legendLine = (page) => page.evaluate(() => {
  const l = document.querySelector('.cal-legend');
  const items = [...l.querySelectorAll('.legend-title, .legend-item')];
  const tops = new Set(items.map((e) => Math.round(e.getBoundingClientRect().top)));
  const lr = l.getBoundingClientRect();
  const hint = document.querySelector('.cal-toolbar .legend-hint');
  const tb = document.querySelector('.cal-toolbar').getBoundingClientRect();
  const hr = hint.getBoundingClientRect();
  const hcs = getComputedStyle(hint);
  const shown = hcs.display !== 'none' && hr.width > 0;
  return {
    h: Math.round(lr.height * 10) / 10, rows: tops.size,
    allInside: items.every((e) => e.getBoundingClientRect().right <= lr.right + 0.5 && e.getBoundingClientRect().bottom <= lr.bottom + 0.5),
    hintShown: shown && hr.top >= tb.top - 0.5 && hr.bottom <= tb.bottom + 0.5 && hr.right <= tb.right + 0.5,
    hintCut: shown && hint.scrollWidth > hint.clientWidth + 0.5,
    hintInToolbar: Boolean(hint.closest('.cal-toolbar')) && !hint.closest('.cal-legend'),
  };
});
test('legend always lists all 7 kinds on ONE line (months with and without holidays); 重置本月标记 only with manual marks', () =>
  withPage(T1412, async (page) => {
    const kinds = () => page.locator('.cal-legend .legend-item').evaluateAll((els) => els.map((e) => e.dataset.kind));
    const labels = () => page.locator('.cal-legend .legend-item').allTextContents();
    for (const [w, ht] of [[1093, 535], ...VIEWPORTS]) {
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
        if (w >= 1093) assert.equal(lg.hintShown, true, `${month} @${w}: the right-hand hint fits and shows`);
      }
    }
    assert.deepEqual(await labels(), ['周末', '法定假日', '调休上班', '带薪假', '无薪假', '今天', '手动标记']);
    assert.equal(await text(page, '.cal-toolbar .legend-hint'), '点日期可标记：调休上班 · 带薪假 · 无薪假');
    // M7：提示在工具列右端（图例行内不再有它），且贴右边缘（margin-left:auto）
    assert.equal(await page.locator('.cal-legend .legend-hint').count(), 0, 'the hint left the legend row');
    const hintRight = await page.evaluate(() => {
      const hint = document.querySelector('.cal-toolbar .legend-hint');
      const tb = document.querySelector('.cal-toolbar').getBoundingClientRect();
      const hr = hint.getBoundingClientRect();
      return { gap: Math.round((tb.right - hr.right) * 10) / 10, shown: getComputedStyle(hint).display !== 'none' };
    });
    assert.equal(hintRight.shown, true, 'at 1280×585 the hint has room');
    assert.ok(hintRight.gap <= 1, `the hint sits at the toolbar's right edge (gap ${hintRight.gap}px)`);
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
    await page.locator('.cal-prev').click();
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

test('reset control is compact and visibly bordered when a month has manual marks', () =>
  withPage(T1412, async (page) => {
    await page.setViewportSize({ width: 1280, height: 585 });
    await cell(page, '11月4日').click();
    await page.getByRole('menuitemradio', { name: /改为休息/ }).click();
    const reset = page.getByRole('button', { name: '重置本月标记' });
    const style = await reset.evaluate((b) => ({ border: getComputedStyle(b).borderTopStyle, width: getComputedStyle(b).borderTopWidth, color: getComputedStyle(b).borderTopColor, height: b.getBoundingClientRect().height }));
    assert.equal(style.border, 'solid', 'the reset action has a visible border');
    assert.equal(style.width, '1px');
    assert.notEqual(style.color, 'rgba(0, 0, 0, 0)', 'the border is not transparent');
    assert.ok(style.height <= 30, `reset stays compact (${style.height}px)`);
  }));

test('「回到今天」 is emphasised with the target month when viewing another month', () =>
  withPage(T1412, async (page) => {
    const btn = page.locator('.cal-today');
    assert.equal(await text(page, '.cal-today'), '回到今天');
    assert.equal(await btn.evaluate((b) => b.classList.contains('is-away')), false);
    // 用不带过渡的属性比较（背景色有过渡，而 page.clock 暂停时过渡不前进）
    const look = () => btn.evaluate((b) => `${getComputedStyle(b).color} ${getComputedStyle(b).fontWeight}`);
    const quiet = await look();
    await page.locator('.cal-next').click();
    assert.equal(await text(page, '.cal-today'), '回到今天 · 2026 年 11 月');
    assert.equal(await btn.evaluate((b) => b.classList.contains('is-away')), true);
    assert.notEqual(await look(), quiet, 'emphasis is visible');
    assert.equal(await btn.getAttribute('aria-disabled'), null, 'never disabled');
    await btn.click();
    assert.equal(await text(page, '.cal-title'), '2026 年 11 月');
    assert.equal(await text(page, '.cal-today'), '回到今天');
  }));

test('summary row: workdays and daily wage live; built-in 2027 has no tag; the 2028 fallback keeps the missing-table tag in the summary row', async () => {
  await withPage(T1412, async (page) => {
    assert.equal(await text(page, '.cal-summary-text'), '本月应出勤 21 天 · 日薪 ¥323.81');
    assert.equal(await page.locator('.cal-year-tag').isVisible(), false);
    await cell(page, '11月7日').click();
    await page.getByRole('menuitemradio', { name: /改为上班/ }).click();
    assert.equal(await text(page, '.cal-summary-text'), '本月应出勤 22 天 · 日薪 ¥309.09');
    await page.locator('.cal-prev').click();
    assert.equal(await text(page, '.cal-summary-text'), '本月应出勤 18 天 · 日薪 ¥377.78');
  });
  // 2027 是内置表（国务院通知）：照实算调休，摘要行不再挂「未内置」标签
  await withPage('2027-01-04T10:00:00+08:00', async (page) => {
    assert.equal(await text(page, '.cal-summary-text'), '本月应出勤 21 天 · 日薪 ¥323.81');
    assert.equal(await page.locator('.cal-year-tag').isVisible(), false, 'built-in year carries no missing-table tag');
    assert.equal(await page.locator('.cal-toolbar .cal-year-tag').count(), 0, 'not in the toolbar');
    assert.match(await cell(page, '1月31日').getAttribute('aria-label'), /^1月31日 周日，调休上班（春节）/);
    const h = await page.locator('.cal-summary').evaluate((e) => e.getBoundingClientRect().height);
    assert.ok(h <= 30, `summary row stays one line (${h})`);
    // 2027-02 是唯一的 4 周月份：内置表把春节连休 2/5–2/13 与 2/14 调休都算进去
    await page.setViewportSize({ width: 1280, height: 585 });
    await page.locator('.cal-next').click();
    assert.equal(await text(page, '.cal-title'), '2027 年 2 月');
    assert.equal(await text(page, '.cal-summary-text'), '本月应出勤 15 天 · 日薪 ¥453.33');
    assert.equal(await page.locator('.cal-year-tag').isVisible(), false);
    const m4 = await measure(page);
    console.log(`MEASURE ${JSON.stringify({ case: '2027-02 built-in', tab: 'calendar', ...m4 })}`);
    assertFits(m4, '2027-02 at 1280x585');
    assert.equal(m4.weeks, 4);
    // 2027-05 是 6 周月份：没有标签时 1280×585 也不滚动
    for (let i = 0; i < 3; i++) await page.locator('.cal-next').click();
    assert.equal(await text(page, '.cal-title'), '2027 年 5 月');
    const m = await measure(page);
    console.log(`MEASURE ${JSON.stringify({ case: '2027-05', tab: 'calendar', ...m })}`);
    assertCalendarFits(m, '2027-05 at 1280x585');
  });
  // 2028 没有年度表：只有法定日期回退，摘要行带标签；2028-01 本身是 6 周月份
  await withPage('2028-01-04T10:00:00+08:00', async (page) => {
    assert.equal(await text(page, '.cal-summary-text'), '本月应出勤 17 天 · 日薪 ¥400.00');
    assert.equal(await text(page, '.cal-summary .cal-year-tag'), '2028 年只标了法定假日，补假和调休未标出');
    assert.equal(await page.locator('.cal-summary .cal-year-tag').getAttribute('title'), '2028 年假期表未内置：已按《放假办法》标出法定假日本身；补假、调休和延长的假日未标出');
    assert.equal(await page.locator('.cal-toolbar .cal-year-tag').count(), 0, 'not in the toolbar');
    // 窄于 1280 时摘要行允许换行（style.css 的 @media (max-width:1279px)），所以这里不再要求单行，
    // 只要求标签完整可见、不被截断，且整块长在摘要行里（最多两行，不能无限长高把月历挤出去）
    const tag = await page.locator('.cal-summary .cal-year-tag').evaluate((e) => {
      const rowEl = e.closest('.cal-summary');
      const row = rowEl.getBoundingClientRect(), r = e.getBoundingClientRect();
      const kids = [...rowEl.children].filter((k) => !k.hidden && k.getBoundingClientRect().width > 0);
      const tallest = Math.max(...kids.map((k) => k.getBoundingClientRect().height));
      // 两行的上界：两倍最高子项 + CSS 里实际的 row-gap（不写死数值，跟着 style.css 走）
      const gap = parseFloat(getComputedStyle(rowEl).rowGap) || 0;
      return {
        visible: r.width > 0 && r.height > 0,
        cut: e.scrollWidth > e.clientWidth + 0.5,
        inside: r.left >= row.left - 0.5 && r.right <= row.right + 0.5 && r.top >= row.top - 0.5 && r.bottom <= row.bottom + 0.5,
        h: row.height, twoLines: 2 * tallest + gap,
      };
    });
    assert.equal(tag.visible, true, 'the missing-table tag shows at the default viewport');
    assert.equal(tag.cut, false, 'the missing-table tag is never truncated');
    assert.equal(tag.inside, true, 'the tag stays inside the summary row');
    assert.ok(tag.h <= tag.twoLines, `summary row stays at most two lines (${tag.h} <= ${tag.twoLines})`);
    // 宽到 1280 时摘要行必须回到单行（撤销按钮也进来后仍然成立）
    await page.setViewportSize({ width: 1280, height: 585 });
    const h = await page.locator('.cal-summary').evaluate((e) => e.getBoundingClientRect().height);
    assert.ok(h <= 30, `summary row stays one line at 1280 (${h})`);
    const m6 = await measure(page);
    console.log(`MEASURE ${JSON.stringify({ case: '2028-01 tag', tab: 'calendar', ...m6 })}`);
    assertCalendarFits(m6, '2028-01 at 1280x585');
    assert.equal(m6.weeks, 6);
    // 2028-07 也是 6 周月份：标签在时仍不滚动
    for (let i = 0; i < 6; i++) await page.locator('.cal-next').click();
    assert.equal(await text(page, '.cal-title'), '2028 年 7 月');
    assert.equal(await text(page, '.cal-summary-text'), '本月应出勤 21 天 · 日薪 ¥323.81');
    const m7 = await measure(page);
    console.log(`MEASURE ${JSON.stringify({ case: '2028-07 tag', tab: 'calendar', ...m7 })}`);
    assertCalendarFits(m7, '2028-07 at 1280x585');
    assert.equal(m7.weeks, 6);
  });
});

// R40：2028 年 1 月（无表）：春节 1/25–1/28 标旗子 + 「春节」，周末也标；补假 / 调休不猜（1/24、1/31 照常上班）
test('2028-01 (no table): 春节 1/25-1/28 marked, summary 17 days, tag text, 6 weeks fit at 1280x585', () =>
  withPage('2028-01-04T10:00:00+08:00', async (page) => {
    await page.setViewportSize({ width: 1280, height: 585 });
    assert.equal(await text(page, '.cal-title'), '2028 年 1 月');
    for (const [label, wd] of [['1月25日', '周二'], ['1月26日', '周三'], ['1月27日', '周四'], ['1月28日', '周五']]) {
      assert.match(await cell(page, label).getAttribute('aria-label'), new RegExp(`^${label} ${wd}，法定假日（春节）`), label);
      assert.equal(await cell(page, label).locator('.day-label').textContent(), '春节', `${label} badge: flag + name only (Task 18)`);
      assert.equal(await cell(page, label).locator('.day-label svg.icon-holiday').count(), 1, `${label} flag icon`);
    }
    assert.match(await cell(page, '1月24日').getAttribute('aria-label'), /^1月24日 周一，工作日/, 'no invented compensation day');
    assert.match(await cell(page, '1月31日').getAttribute('aria-label'), /^1月31日 周一，工作日/, 'no invented extended holiday');
    // 元旦由《放假办法》的固定日期给出
    assert.match(await cell(page, '1月1日').getAttribute('aria-label'), /^1月1日 周六，法定假日（元旦）/);
    assert.equal(await text(page, '.cal-summary-text'), '本月应出勤 17 天 · 日薪 ¥400.00');
    assert.equal(await text(page, '.cal-summary .cal-year-tag'), '2028 年只标了法定假日，补假和调休未标出');
    assert.equal(await page.locator('.cal-summary .cal-year-tag').getAttribute('title'), '2028 年假期表未内置：已按《放假办法》标出法定假日本身；补假、调休和延长的假日未标出');
    assert.ok((await text(page, '.cal-summary .cal-year-tag')).length <= 24, 'tag <= 24 chars (Task 19 L11/F1: truthful plain-language wording is longer; row still one line below)');
    const h = await page.locator('.cal-summary').evaluate((e) => e.getBoundingClientRect().height);
    assert.ok(h <= 30, `summary row stays one line (${h})`);
    const m = await measure(page);
    console.log(`MEASURE ${JSON.stringify({ case: '2028-01 春节', tab: 'calendar', ...m })}`);
    assertCalendarFits(m, '2028-01 at 1280x585'); // 2028-01 是 6 周月份
    await shot(page, 'task-16-jan2028.png');
  }));

// 2027 已是内置表：春节连休 2/5–2/13 与 2/14 调休上班都照国务院通知标出
test('2027-02 (built-in): 春节 2/5-2/13 marked, 2/14 调休上班, summary 15 days, no tag, 4 weeks fit', () =>
  withPage('2027-02-04T10:00:00+08:00', async (page) => {
    await page.setViewportSize({ width: 1280, height: 585 });
    assert.equal(await text(page, '.cal-title'), '2027 年 2 月');
    for (const [label, wd] of [['2月5日', '周五'], ['2月6日', '周六'], ['2月7日', '周日'], ['2月8日', '周一'], ['2月13日', '周六']]) {
      assert.match(await cell(page, label).getAttribute('aria-label'), new RegExp(`^${label} ${wd}，法定假日（春节）`), label);
      assert.equal(await cell(page, label).locator('.day-label').textContent(), '春节', `${label} badge: flag + name only (Task 18)`);
      assert.equal(await cell(page, label).locator('.day-label svg.icon-holiday').count(), 1, `${label} flag icon`);
    }
    // 2/14（周日）是调休上班：仍算工作日，「班」+ 节日名
    assert.match(await cell(page, '2月14日').getAttribute('aria-label'), /^2月14日 周日，调休上班（春节）/);
    assert.equal(await cell(page, '2月14日').locator('.day-tag').textContent(), '班');
    assert.match(await cell(page, '2月15日').getAttribute('aria-label'), /^2月15日 周一，工作日/, 'the extended holiday ends on 2/13');
    assert.equal(await text(page, '.cal-summary-text'), '本月应出勤 15 天 · 日薪 ¥453.33');
    assert.equal(await page.locator('.cal-year-tag').isVisible(), false, 'built-in year: no missing-table tag');
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
    await page.locator('.cal-prev').click();
    for (const [label, sel, what] of [['10月1日', '.day-num', 'holiday number'], ['10月1日', '.day-tag', 'holiday flag + name (no 假 tag)'], ['10月10日', '.day-tag', 'make-up tag 班']]) {
      const [fg, bg] = await pair(label, sel);
      const r = ratio(fg, bg);
      console.log(`MEASURE ${JSON.stringify({ case: 'contrast', what, fg, bg, ratio: +r.toFixed(2) })}`);
      assert.ok(r >= 4.5, `${what}: ${fg} on ${bg} = ${r.toFixed(2)}`);
    }
    await page.locator('.cal-next').click();
    const [fg, bg] = await pair('11月5日', '.day-tag');
    assert.ok(ratio(fg, bg) >= 4.5, `paid tag: ${fg} on ${bg}`);
  }));

// H5：手动改成休息的日子不只是一块灰底——要有「休」标签和它的图标，和周末区分开
test('H5: a manually-rested workday shows a visible 「休」 tag with its icon', () =>
  withPage(T1412, async (page) => {
    await page.setViewportSize({ width: 1280, height: 585 });
    const target = cell(page, '11月6日');
    assert.equal(await target.locator('.day-tag').count(), 0, 'plain workday: no tag before marking');
    await target.click();
    await page.getByRole('menuitemradio', { name: /改为休息/ }).click();
    const day = cell(page, '11月6日');
    assert.equal(await day.evaluate((b) => b.classList.contains('kind-rest')), true, 'workday turned into a manual rest day');
    assert.equal(await day.locator('.day-tag').textContent(), '休', 'H5: the tag says 休');
    assert.equal(await day.locator('.day-tag svg.icon-rest').count(), 1, 'H5: with the rest icon');
    const look = await day.locator('.day-tag').evaluate((e) => {
      const cs = getComputedStyle(e);
      return { h: e.getBoundingClientRect().height, lh: cs.lineHeight, svg: e.querySelector('svg')?.getBoundingClientRect().width };
    });
    console.log(`MEASURE ${JSON.stringify({ case: 'H5 rest tag', ...look })}`);
    assert.ok(look.h >= 12 && look.h <= 16, `same 14px label height as other tags (${look.h})`);
    assert.ok(look.svg >= 10 && look.svg <= 14, `icon rendered at label size (${look.svg})`);
    // 文字对底色仍 ≥ 4.5:1
    const [fg, bg] = await day.locator('.day-tag').evaluate((e) => {
      const b = e.closest('.day');
      return [getComputedStyle(e).color, getComputedStyle(b).backgroundColor];
    });
    const r = ratio(fg, bg);
    console.log(`MEASURE ${JSON.stringify({ case: 'H5 rest tag contrast', fg, bg, ratio: +r.toFixed(2) })}`);
    assert.ok(r >= 4.5, `休 tag: ${fg} on ${bg} = ${r.toFixed(2)}`);
  }));

// M9：旗子是「实心旗面 + 旗杆」，12px 下能认出是旗，不是「P」
test('M9: the holiday icon is a filled flag (solid banner + pole), legible at 12px in cells, legend and pill', () =>
  withPage(T1412, async (page) => {
    await page.setViewportSize({ width: 1280, height: 585 });
    await page.locator('.cal-prev').click(); // 2026-10：有法定假日
    const flag = (sel) => page.locator(sel).first().evaluate((svg) => {
      const w = svg.clientWidth || svg.getBoundingClientRect().width;
      const rects = [...svg.querySelectorAll('rect')].map((r) => {
        const b = r.getBBox();
        return { w: b.width, h: b.height, fill: getComputedStyle(r).fill, stroke: getComputedStyle(r).stroke };
      });
      const paths = [...svg.querySelectorAll('path')].map((p) => p.getBBox().height);
      return { px: Math.round(w), rects, poleH: Math.max(0, ...paths) };
    });
    for (const [sel, what] of [['.cal-grid button.kind-holiday .day-tag svg', 'cell'], ['.cal-legend [data-kind=holiday] svg', 'legend'], ['.cal-summary .cal-note svg', 'pill']]) {
      const f = await flag(sel);
      console.log(`MEASURE ${JSON.stringify({ case: 'M9 flag', what, ...f })}`);
      assert.equal(f.rects.length, 1, `${what}: the flag has one solid banner rect (not a stroked outline)`);
      const [r] = f.rects;
      // 16 viewBox 单位换算到实际像素：旗面在 12px 图标里至少 3.5px 宽、2px 高
      const scale = f.px / 16;
      assert.ok(r.w * scale >= 3.5 && r.h * scale >= 2, `${what}: banner is visible at ${f.px}px (${(r.w * scale).toFixed(1)}×${(r.h * scale).toFixed(1)}px)`);
      assert.notEqual(r.fill, 'none', `${what}: banner is filled`);
      assert.equal(r.stroke, 'none', `${what}: banner is not an outline`);
      assert.ok(f.poleH >= 10, `${what}: the pole spans the icon (${f.poleH})`);
    }
  }));

// L9：周末的栏头不加粗、不变色——和其它星期几完全一致
test('L9: weekend column headers look exactly like the other weekdays', () =>
  withPage(T1412, async (page) => {
    const heads = await page.locator('.cal-head .cal-colhead').evaluateAll((els) => els.map((e) => {
      const cs = getComputedStyle(e);
      return { text: e.textContent, w: cs.fontWeight, c: cs.color };
    }));
    console.log(`MEASURE ${JSON.stringify({ case: 'L9 colheads', heads })}`);
    assert.equal(heads.length, 7);
    const [first] = heads;
    for (const h of heads) {
      assert.equal(h.w, first.w, `${h.text}: same weight as Monday (${h.w})`);
      assert.equal(h.c, first.c, `${h.text}: same colour as Monday (${h.c})`);
    }
  }));

// L1：大格子（1920×950，格子 ≈163px 宽）日期数字放大到 15px，内边距放宽；小视窗不受影响
test('L1: in wide cells (≥140px) the date numeral grows to 15px with roomier padding; smaller viewports keep 13px', () =>
  withPage(T1412, async (page) => {
    const read = () => page.locator('.cal-grid button[data-key="2026-11-10"]').evaluate((b) => {
      const num = b.querySelector('.day-num');
      const cs = getComputedStyle(num);
      const bs = getComputedStyle(b);
      return { fs: cs.fontSize, numW: num.getBoundingClientRect().width, pad: bs.paddingTop, cellW: Math.round(b.getBoundingClientRect().width) };
    });
    for (const [w, ht] of [...VIEWPORTS].reverse()) {
      await page.setViewportSize({ width: w, height: ht });
      const r = await read();
      // 期望值由实测格子宽度决定（容器查询的阈值就是 140px）：宽格子必须放大，窄格子必须保持原样
      const wide = r.cellW >= 140;
      console.log(`MEASURE ${JSON.stringify({ case: 'L1 numeral', w, ht, ...r, wide })}`);
      assert.equal(r.fs, wide ? '15px' : '13px', `${w}×${ht}: cell ${r.cellW}px → numeral ${r.fs}`);
      if (w === 1920) assert.ok(wide, `1920×950 cells are wide (${r.cellW}px) — this is the only viewport that must exercise the rule`);
      if (wide) {
        assert.equal(r.pad, '6px', 'L1: roomier padding in wide cells');
        assert.equal(r.numW, 24, 'L1: the numeral box grows with the type so 2 digits keep their side room');
      } else {
        assert.equal(r.pad, '4px', 'base padding outside wide cells');
        assert.equal(r.numW, 20, 'base numeral box');
      }
    }
    // 大格里的 2 位数仍在圆内两侧留 ≥ 2px（用真实墨迹量，见 M6 round 2），这里守住不裁切
    await page.setViewportSize({ width: 1920, height: 950 });
    const clipped = await page.locator('.cal-grid button .day-num').evaluateAll((els) => els.filter((e) => e.scrollWidth > e.clientWidth + 0.5).length);
    assert.equal(clipped, 0, 'no numeral overflows its box at 1920×950');
  }));

// M7：未标记的格子悬停时给浅绿反馈；已经带状态的格子（放假 / 带薪 …）保持自己的底色，不被 hover 盖掉
test('M7: unmarked cells get a brand-50 hover wash, marked cells keep their own background', () =>
  withPage(T1412, async (page) => {
    await page.setViewportSize({ width: 1280, height: 585 });
    await page.locator('.cal-prev').click(); // 2026-10：同屏有放假格、调休格与普通工作日
    const bgOf = (key) => page.locator(`.cal-grid button[data-key="${key}"]`).evaluate((b) => getComputedStyle(b).backgroundColor);
    const hoverBg = async (key) => {
      await page.locator(`.cal-grid button[data-key="${key}"]`).hover();
      // 底色有 120ms 过渡；把过渡关掉再读，免得 page.clock 停住时读到中间值
      const v = await page.locator(`.cal-grid button[data-key="${key}"]`).evaluate((b) => {
        b.style.transition = 'none';
        const c = getComputedStyle(b).backgroundColor;
        b.style.transition = '';
        return c;
      });
      await page.mouse.move(0, 0);
      return v;
    };
    const rest = await bgOf('2026-10-09'); // 普通工作日
    const hovered = await hoverBg('2026-10-09');
    console.log(`MEASURE ${JSON.stringify({ case: 'M7 hover', rest, hovered })}`);
    assert.equal(rest, 'rgb(255, 255, 255)', 'a plain workday is white at rest');
    assert.equal(hovered, 'rgb(240, 253, 244)', 'hover paints brand-50 (#F0FDF4)');
    // 标记格的底色来自主题变量（默认主题已换成自然绿），所以对照变量值而不是写死十六进制
    const tokenBg = (name) => page.evaluate((n) => {
      const probe = document.createElement('span');
      probe.style.background = `var(${n})`;
      document.body.append(probe);
      const v = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return v;
    }, name);
    for (const [key, token, what] of [['2026-10-01', '--cal-holiday-bg', 'holiday'], ['2026-10-10', '--state-makeup-bg', 'make-up']]) {
      const atRest = await bgOf(key);
      const want = await tokenBg(token);
      console.log(`MEASURE ${JSON.stringify({ case: 'M7 rest', what, atRest, token, want })}`);
      assert.equal(atRest, want, `${what} cell keeps its token background (${token})`);
      assert.equal(await hoverBg(key), atRest, `${what} cell: hover must not wash over its状态 colour`);
    }
  }));

test('day menu: 「（调休）」 labels, check mark and type icon in separate columns, footer via aria-describedby', () =>
  withPage(T1412, async (page) => {
    await cell(page, '11月7日').click();
    assert.match(await page.getByRole('menuitemradio').nth(1).textContent(), /^改为上班（调休）/);
    const menu = page.getByRole('menu');
    const desc = await menu.getAttribute('aria-describedby');
    assert.equal(await page.locator(`#${desc}`).textContent(), '月薪固定，按当月上班天数平分');
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
        if (away) await page.locator('.cal-next').click();
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
        assert.equal(await page.locator('.pip-placeholder').isVisible(), true, 'placeholder in place of the card');
        assert.equal(await page.locator('.pip-placeholder').evaluate((e) => getComputedStyle(e).borderTopStyle), 'solid'); // Task 19 L5: solid, not dashed
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
          if (tb === '基本设置') {
            await page.locator('#f-theme').scrollIntoViewIfNeeded();
            assert.equal(await page.locator('#f-theme').isVisible(), true, `${state} ${w}x${ht}: theme remains reachable`);
          }
        }
        if (w === 1280) await shot(page, `task-14-float-${state}-1280x585.png`);
      }
    }, { init }));
}

// 决定 2 + Task 18（V1）：提示盖在格子本身（±2px），内容置中；「来源」只在放得下时出现（不再按 5 / 6 周一刀切），不盖到下面的格子；键盘聚焦一样
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
      // 农历行（新）：单独取出，其余行仍按原文比对；格子放不下时整行不显示
      byClass: Object.fromEntries(['tip-title', 'tip-lunar', 'tip-status', 'tip-source', 'tip-pay'].map((c) => {
        const e = tip.querySelector(`.${c}`);
        return [c, e && getComputedStyle(e).display !== 'none' && e.getClientRects().length ? e.textContent : null];
      })),
      clipped: tip.scrollHeight > tip.clientHeight + 0.5,
      lineBottoms: shown.map((x) => x.getBoundingClientRect().bottom),
      align: getComputedStyle(tip).textAlign,
      border: { width: getComputedStyle(tip).borderTopWidth, color: getComputedStyle(tip).borderTopColor },
      expectBorder: getComputedStyle(tip.querySelector('.tip-status')).color,
      payInside: (() => { const a = tip.querySelector('.pay-amt').getBoundingClientRect(); return a.width > 0 && a.bottom <= tr.bottom - 1.5 && a.top >= tr.top + 1.5 && a.left >= tr.left + 1.5 && a.right <= tr.right - 1.5; })(),
      bg: getComputedStyle(tip).backgroundColor,
    };
  });
  return { ...r, expect: lines };
}
for (const how of ['hover', 'keyboard']) {
  test(`tooltip on the ${how === 'hover' ? 'hovered' : 'keyboard-focused'} cell: white card inside the cell (±2px), centred, status-colour border, source only when it fits, never over the cell below — all viewports incl. 1093×535`, () =>
    withPage(T1412, async (page) => {
      for (const [w, ht] of ALL_VP) {
        await page.setViewportSize({ width: w, height: ht });
        for (const [month, label, lines, lunarText] of [
          ['2026-11', '11月18日', ['11月18日 周三', '工作日', '按默认规则', '计薪 ¥323.81'], '农历十月初十'],
          ['2026-10', '10月1日', ['10月1日 周四', '法定假日·国庆', '内置·官方通知', '计薪 ¥0.00'], '农历八月廿一'],
        ]) {
          await page.locator('.cal-today').click();
          if (month === '2026-10') await page.locator('.cal-prev').click();
          const r = await tipCheck(page, label, lines, how);
          console.log(`MEASURE ${JSON.stringify({ case: `tooltip ${how}`, month, w, ht, tip: r.tip, cell: r.cell, lines: r.lines.length, lunar: r.byClass['tip-lunar'], clipped: r.clipped, belowTop: r.belowTop })}`);
          assert.equal(r.hidden, false, `${month} @${w}: shown`);
          assert.equal(r.inCell, true, 'rendered inside the cell');
          for (let i = 0; i < 4; i++) assert.ok(Math.abs(r.tip[i] - r.cell[i]) <= 2, `${month} @${w}: tooltip edge ${i} ${r.tip[i]} within ±2px of the cell ${r.cell[i]}`);
          // 新增的农历行（.tip-lunar）在日期之后；放不下时整行不显示 → 原样的三 / 四行断言仍逐字成立
          const base = r.lines.filter((l) => !LUNAR_LINE.test(l));
          const lunarShown = r.lines.length > base.length;
          assert.ok(!lunarShown || (r.lines.length === base.length + 1 && r.lines[1] === r.byClass['tip-lunar']), `${month} @${w}: one lunar line, right under the date (${JSON.stringify(r.lines)})`);
          if (lunarShown) assert.equal(r.byClass['tip-lunar'], lunarText, `${month} @${w}: lunar line text`);
          assert.deepEqual([base[0], base[1], base.at(-1)], [lines[0], lines[1], lines[3]], `${month} @${w}: date / status / pay lines`);
          if (base.length === 4) assert.equal(r.byClass['tip-source'], lines[2], `${month} @${w}: source line text`);
          assert.ok(base.length >= 3 && base.length <= 4, `${month} @${w}: ${base.length} lines (excluding lunar)`);
          // 5 周月份在 ≥ 1366 放得下第 4 行；那一行现在可能是来源，也可能是农历（来源先让位）
          if (month === '2026-10' && w >= 1366) assert.ok(r.lines.length >= 4, `${month} @${w}: 5-week month at ≥ 1366 has room for a 4th line: ${JSON.stringify(r.lines)}`);
          assert.equal(r.byClass['tip-title'], lines[0], `${month} @${w}: the date line is always shown`);
          assert.equal(r.byClass['tip-pay'], lines[3], `${month} @${w}: the pay line is always shown`);
          assert.equal(r.align, 'center');
          assert.equal(r.border.width, '2px');
          assert.equal(r.border.color, r.expectBorder, `${month} @${w}: border uses the status colour`);
          assert.ok(r.payInside, `${month} @${w}: the pay amount is fully inside the card`);
          assert.equal(r.bg, 'rgb(255, 255, 255)', 'white card');
          assert.ok(Math.abs((r.tip[0] + r.tip[2]) / 2 - (r.cell[0] + r.cell[2]) / 2) <= 0.5, 'centred on the cell');
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

test('tooltip with error + info banners at 1280×585: the 5-week cell is shorter — falls back to fewer lines / tighter spacing, nothing clipped', () =>
  withPage(T1412, async (page) => {
    await page.setViewportSize({ width: 1280, height: 585 });
    await tab(page, '基本设置').click();
    await page.getByLabel('月薪').fill('7000');
    await page.getByLabel('月薪').fill('6800');
    assert.equal(await page.locator(errorBar).isVisible(), true);
    await tab(page, '月历').click();
    await page.locator('.cal-prev').click();
    const r = await tipCheck(page, '10月1日', null, 'hover');
    console.log(`MEASURE ${JSON.stringify({ case: 'tooltip error+info', tip: r.tip, cell: r.cell, lines: r.lines, lunar: r.byClass['tip-lunar'], clipped: r.clipped })}`);
    assert.equal(r.clipped, false);
    const base = r.lines.filter((l) => !LUNAR_LINE.test(l));
    assert.ok(base.length === 3 || base.length === 4, `${base.length} lines (excluding lunar)`);
    assert.equal(base.at(-1), '计薪 ¥0.00', 'the pay line is never dropped');
    if (r.byClass['tip-lunar']) assert.equal(r.byClass['tip-lunar'], '农历八月廿一', 'lunar line text');
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
    assert.equal(nov.text, '本月没有法定假日', 'M10: basis is no longer appended to the visible text');
    assert.deepEqual([nov.tone, nov.check, nov.border, nov.cut], ['none', true, 'none', false], 'M10: plain grey text, no dashed box');
    assert.equal(nov.title, '本月没有法定假日 · 依据 2026 年国务院放假通知', 'the basis lives only in title');
    assert.equal(await tagText(page), null);
    await shot(page, 'task-14-calendar-nov-1280x585.png');
    await page.locator('.cal-prev').click();
    const oct = await pill(page);
    assert.equal(oct.text, '国庆 10/1–10/7 放假，10/10 调休上班');
    assert.deepEqual([oct.tone, oct.flag, oct.border, oct.cut], ['holiday', true, 'solid', false]);
    assert.equal(oct.title, '国庆 10/1–10/7 放假，10/10 调休上班 · 依据 2026 年国务院放假通知');
    await shot(page, 'task-14-calendar-oct-1280x585.png');
    assert.ok(await summaryOneLine(page) <= 30);
    // 2025（无表、已过去，fixed 年份）：不显示缺表标签，胶囊说 app 只标了固定日期的法定假日（R49）
    for (let i = 0; i < 12; i++) await page.locator('.cal-prev').click();
    assert.equal(await text(page, '.cal-title'), '2025 年 10 月');
    const past = await pill(page);
    // round 2：所有无表年份的「依据」都只放在 title（与当年以后的年份同一种写法）
    assert.equal(past.text, '国庆 10/1–10/3 放假');
    assert.equal(past.title, '国庆 10/1–10/3 放假 · 按《放假办法》只标出固定日期的法定假日；其余假日和补假、调休未标出');
    assert.equal(past.cut, false, 'fits at 1280');
    assert.doesNotMatch(past.text + past.title, /国务院|待公布|依据/);
    assert.equal(past.check, false);
    assert.equal(await tagText(page), '2025 年只标了元旦、劳动节、国庆', 'round 3 (R41 amended): past no-table years show the visible qualifier too');
    assert.ok(await summaryOneLine(page) <= 30);
    await page.locator('.cal-prev').click();
    assert.equal((await pill(page)).text, '本月没有已标出的法定假日');
    assert.equal((await pill(page)).title, '本月没有已标出的法定假日 · 按《放假办法》只标出固定日期的法定假日；其余假日和补假、调休未标出');
    assert.equal((await pill(page)).check, false, 'no ✓ without a table');
  }));

test('summary pill + tag: 2027 (built-in 国务院 notice: 元旦 + 春节调休, 劳动节, 中秋 / 国庆) and 2028 (no table: only the statutory dates)', async () => {
  // 2027 是内置表：照实说放假与调休，不再挂缺表标签
  await withPage(T1412, async (page) => {
    await page.setViewportSize({ width: 1280, height: 585 });
    await page.locator('.cal-next').click();
    await page.locator('.cal-next').click();
    assert.equal(await text(page, '.cal-title'), '2027 年 1 月');
    const jan = await pill(page);
    assert.equal(jan.text, '元旦 1/1–1/3 放假；春节 1/31 调休上班');
    assert.equal(jan.title, '元旦 1/1–1/3 放假；春节 1/31 调休上班 · 依据 2027 年国务院放假通知');
    assert.deepEqual([jan.tone, jan.flag, jan.border, jan.cut], ['holiday', true, 'solid', false]);
    assert.equal(await tagText(page), null, 'built-in year: no qualifier tag');
    assert.ok(await summaryOneLine(page) <= 30);
    await page.locator('.cal-next').click();
    const feb = await pill(page);
    assert.equal(feb.text, '春节 2/5–2/13 放假，2/14 调休上班');
    assert.equal(feb.title, '春节 2/5–2/13 放假，2/14 调休上班 · 依据 2027 年国务院放假通知');
    assert.equal(await tagText(page), null);
    await page.locator('.cal-next').click();
    const mar = await pill(page);
    assert.deepEqual([mar.text, mar.tone, mar.check, mar.border], ['本月没有法定假日', 'none', true, 'none'], 'a table month without holidays is a known 「none」, not 「unknown」');
    assert.equal(mar.title, '本月没有法定假日 · 依据 2027 年国务院放假通知');
    // 2027-05（6 周）与 2027-10：劳动节 / 国庆的长假 + 调休都在内置表里
    await page.locator('.cal-next').click();
    await page.locator('.cal-next').click();
    assert.equal(await text(page, '.cal-title'), '2027 年 5 月');
    const may = await pill(page);
    assert.equal(may.text, '劳动节 5/1–5/5 放假，5/8 调休上班');
    assert.equal(may.cut, false, 'fits at 1280');
    for (let i = 0; i < 5; i++) await page.locator('.cal-next').click();
    assert.equal(await text(page, '.cal-title'), '2027 年 10 月');
    assert.equal((await pill(page)).text, '国庆 10/1–10/7 放假，10/9 调休上班');
    assert.equal(await tagText(page), null);
  });
  // 2028 没有年度表：只标《放假办法》的法定日期，标签与胶囊都说清楚补假 / 调休未标出
  await withPage('2028-01-04T10:00:00+08:00', async (page) => {
    await page.setViewportSize({ width: 1280, height: 585 });
    const jan = await pill(page);
    assert.equal(jan.text, '元旦 1/1 放假；春节 1/25–1/28 放假');
    assert.equal(jan.title, '元旦 1/1 放假；春节 1/25–1/28 放假 · 按《放假办法》标出法定假日本身；补假、调休和延长的假日未标出');
    assert.equal(jan.check, false, 'no ✓ without a table');
    assert.equal(await tagText(page), '2028 年只标了法定假日，补假和调休未标出');
    assert.ok(await summaryOneLine(page) <= 30);
    await page.locator('.cal-next').click();
    const feb = await pill(page);
    assert.deepEqual([feb.text, feb.tone, feb.check, feb.border], ['本月没有已标出的法定假日', 'unknown', false, 'dashed']);
    assert.doesNotMatch(feb.text + feb.title, /国务院|依据/);
    assert.equal(await tagText(page), '2028 年只标了法定假日，补假和调休未标出');
    // 2028-10（6 周）只标国庆的前三天
    for (let i = 0; i < 8; i++) await page.locator('.cal-next').click();
    assert.equal(await text(page, '.cal-title'), '2028 年 10 月');
    const oct = await pill(page);
    assert.equal(oct.text, '国庆 10/1–10/3 放假');
    assert.equal(oct.title, '国庆 10/1–10/3 放假 · 按《放假办法》标出法定假日本身；补假、调休和延长的假日未标出');
    assert.equal(oct.cut, false, 'fits at 1280');
    assert.equal(await tagText(page), '2028 年只标了法定假日，补假和调休未标出');
  });
  await withPage('2036-01-07T10:00:00+08:00', async (page) => {
    await page.setViewportSize({ width: 1280, height: 585 });
    assert.equal((await pill(page)).text, '元旦 1/1 放假');
    assert.equal(await tagText(page), '2036 年只标了元旦、劳动节、国庆');
    assert.match(await page.locator('.cal-summary .cal-year-tag').getAttribute('title'), /只按《放假办法》标出固定日期的法定假日（元旦、劳动节、国庆）/);
    assert.equal(await text(page, '#status-card .card-year'), '2036 年只标了元旦、劳动节、国庆', 'status card uses the same wording');
    assert.ok(await summaryOneLine(page) <= 30);
    await page.locator('.cal-next').click();
    assert.equal((await pill(page)).text, '本月没有已标出的法定假日', 'no lunar data for 2036: nothing claimed');
  });
});

// 联网 / 导入的年份：依据写数据的真实来源（自己开页面：联网成功时开页只会请求第一个来源，与 withPage 的「全部被中止」前提不同）
// 2027 已内置，不会自动检查；2028 起才是「靠联网 / 导入拿到年度表」的年份
const FILE2028 = JSON.stringify({
  year: 2028, papers: ['https://www.gov.cn/zhengce/test-2028.htm'],
  days: [{ name: '元旦', date: '2028-01-01', isOffDay: true }, { name: '元旦', date: '2028-01-02', isOffDay: true }, { name: '元旦', date: '2028-01-03', isOffDay: true }],
}); // 虚构的测试数据，只为满足校验规则
test('summary pill for an online-table year and for an imported-file year: 「依据联网取得的…」 / 「依据导入的…」', async () => {
  for (const mode of ['online', 'file']) {
    const o = await openAt(browser, server.url, '2027-11-04T09:00:00+08:00', {
      viewport: { width: 1280, height: 585 },
      init: CN_SEED, // 中国地区才有「联网 / 导入」的年份来源（内置 + 国务院公告）
      beforeGoto: (page) => (mode === 'online'
        ? page.route(/cdn\.jsdelivr\.net\/.*\/2028\.json/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: FILE2028, headers: { 'access-control-allow-origin': '*' } }))
        : Promise.resolve()),
    });
    try {
      const p = o.page;
      if (mode === 'file') {
        await tab(p, '基本设置').click();
        await p.locator('#holiday-file').setInputFiles({ name: '2028.json', mimeType: 'application/json', buffer: Buffer.from(FILE2028) });
        await p.locator('#holiday-result[data-tone="success"]').waitFor();
        await tab(p, '月历').click();
      }
      await p.locator('.cal-next').click();
      await p.locator('.cal-next').click();
      assert.equal(await text(p, '.cal-title'), '2028 年 1 月');
      assert.equal((await pill(p)).text, '元旦 1/1–1/3 放假');
      assert.equal(await tagText(p), null, 'table present: no tag');
      await p.locator('.cal-next').click();
      const feb = await pill(p);
      assert.equal(feb.text, '本月没有法定假日', 'M10: the basis is only in title');
      assert.equal(
        feb.title,
        mode === 'online' ? '本月没有法定假日 · 依据联网取得的 2028 年放假数据' : '本月没有法定假日 · 依据导入的 2028 年假期表',
        'the basis moved to title');
      assert.equal(feb.border, 'none', 'M10: no dashed box for a month that really has no holiday');
      assert.equal(feb.check, true);
      assert.doesNotMatch(feb.text + feb.title, /国务院/);
      assert.deepEqual(o.errors.map(String), []);
      assert.deepEqual(o.consoleErrors, []);
    } finally {
      await o.context.close();
    }
  }
});

// 显示设置增加后右栏可滚动；展开内容仍须进入视野，左栏保持独立。
test('基本设置: expanding 格式示例 / 高级设置 scrolls only the right column, content brought into view', () =>
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
      await page.locator('#f-theme').scrollIntoViewIfNeeded();
      assert.equal(await page.locator('#f-theme').isVisible(), true, `${w}x${ht}: theme remains reachable`);
      await page.locator('.set-col').first().evaluate((col) => { col.scrollTop = 0; });
      if (w === 1280) await shot(page, 'task-14-settings-1280x585.png');
      if (w === 1920) await shot(page, 'task-14-settings-1920x950.png');
      for (const [what, btn, body] of [['example', '#btn-example', '#holiday-example'], ['advanced', '#adv-toggle', '#f-custom-url']]) {
        await page.locator(btn).click();
        assert.equal(await page.locator(btn).getAttribute('aria-expanded'), 'true');
        const e = await cols();
        console.log(`MEASURE ${JSON.stringify({ case: `settings ${what} expanded`, w, ht, cols: e.cols, pageScroll: e.pageScroll })}`);
        assert.equal(e.pageScroll, false, `${what} @${w}: no page scroll`);
        assert.equal(e.tabs, true, 'tab labels stay visible');
        assert.equal(e.cols[0].over, d.cols[0].over, 'expanding the right column does not change left overflow');
        assert.equal(e.cols[0].top, 0);
        assert.equal(await inView(body), true, `${what} @${w}: expanded content in view`);
        if (w === 1280) await shot(page, `task-14-settings-${what}-1280x585.png`);
        await page.locator(btn).click();
        assert.equal(await page.locator(btn).getAttribute('aria-expanded'), 'false');
      }
      assert.equal((await cols()).cols[0].over, d.cols[0].over, 'left column remains unaffected');
      await tab(page, '月历').click();
      if (w === 1920) {
        await shot(page, 'task-14-calendar-nov-1920x950.png');
        await page.locator('.cal-prev').click();
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
      [{ heading: 'H2', name: '工资与上班时间' }, { heading: 'H2', name: '画面设置' }],
      [{ heading: 'H2', name: '假期数据' }, { heading: 'H2', name: '数据与备份' }, { heading: 'H2', name: '高级设置' }],
    ]);
    // 标签对齐同一条竖线；控件从同一条竖线开始
    const lines = await page.evaluate(() => [...document.querySelectorAll('.section-pay .row')].filter((r) => !r.hidden).map((r) => [Math.round(r.querySelector('.row-label').getBoundingClientRect().left), Math.round(r.querySelector('.row-ctrl').getBoundingClientRect().left)]));
    assert.equal(new Set(lines.map((x) => x[0])).size, 1, `labels aligned: ${JSON.stringify(lines)}`);
    assert.equal(new Set(lines.map((x) => x[1])).size, 1, `controls aligned: ${JSON.stringify(lines)}`);
    // 行的顺序与名称（新增「地区」一行，两地月薪与标记分开保存）；标签文本来自当前地区字典
    assert.deepEqual(await page.locator('.section-pay .row-label').allTextContents(), ['地区', '月薪', '发薪日', '上下班时间', '午休', '午休时间', '周末上班']);
    assert.deepEqual((await page.locator('.section-display .row-label').allTextContents()).slice(0, 2), ['主题色', '鼓励语']);
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
    // 两段白话：备份里有什么 / 不包含什么（顺序即阅读顺序）
    assert.deepEqual(await page.locator('.section-backup .para').allTextContents(), [
      '备份文件含月薪、上下班时间、主题色和月历标记。换电脑或清除浏览数据前导出，之后用「导入备份」恢复。',
      '备份不含联网取得或导入的假期表和自定义数据网址。',
    ]);
    assert.equal(await text(page, '.section-backup .warn-note'), '备份文件含月薪，请妥善保管');
    assert.equal(await text(page, '.adv-sub'), '一般不用改');
    assert.equal(await text(page, '.adv-summary'), '自定义数据网址：未设置');
    assert.deepEqual(await page.locator('#holiday-status .chip').allTextContents(), ['2026 年 · 内置', '2027 年 · 内置']);
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
    assert.equal(await text(page, '#explain-custom-url'), '默认先从 jsDelivr、再从 GitHub 获取假期数据。连不上时，可以填写你自己存放文件的网址。留空则使用默认来源。');
    // 「显示农历」开关与农历数据来源说明都在高级设置里（不在工资卡、也不在假期数据卡本体）
    assert.equal(await page.locator('.section-pay').getByRole('switch', { name: '显示农历' }).count(), 0, 'not in the pay card');
    assert.equal(await page.locator('.section-holiday .scard-body').getByRole('switch', { name: '显示农历' }).count(), 0, 'not in the holiday card body');
    const lunarSwitch = page.locator('#adv-body').getByRole('switch', { name: '显示农历' });
    assert.equal(await lunarSwitch.count(), 1, 'the switch lives in the advanced body');
    assert.equal(await lunarSwitch.getAttribute('aria-describedby'), 'err-showLunar');
    assert.equal(await text(page, '#adv-body .adv-source'), '农历数据来源：香港天文台《公历与农历日期对照表》（2020–2060）。2057 年部分日期因历法边界不确定而不显示。');
    assert.equal(await page.locator('#adv-body').evaluate((b) => b.lastElementChild.className.includes('adv-source')), true, 'the source note is the last line of the advanced body');
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
    // 示例逐行说明由固定数量的节点复用（多出来的行带 hidden）；只比可见行，既能验证没有漏字，
    // 也不会把没用的占位节点当成空行。
    const lines = await page.locator('#holiday-example .ex-line:not([hidden])').allTextContents();
    assert.deepEqual(lines, [
      '文件为 holiday-cn 格式的年度 JSON（例如 2027.json）。',
      'year：年份（数字，例如 2027）；days 里的日期都必须在这一年内。',
      'papers：官方放假通知的网址，必须以 https://www.gov.cn/ 开头，否则整份文件会被拒绝。',
      'days：每一天一条；isOffDay 为 true 表示放假，false 表示调休上班（调休上班日必须是周六或周日）。',
      '文件里至少要有一个放假日，否则会被拒绝。',
      '可从 github.com/NateScarlet/holiday-cn 下载（在大陆可能打不开，可请朋友下载后发给你）',
      '官方来源：中国政府网（gov.cn）每年发布的《关于 20XX 年部分节假日安排的通知》',
    ]);
    assert.equal(await page.locator('#holiday-example .ex-line[hidden]').evaluateAll((els) => els.every((e) => e.textContent === '')), true, 'unused placeholders carry no text');
    assert.equal(await page.locator('#holiday-example a, #holiday-example [href]').count(), 0, 'no links');
    assert.notEqual(await page.locator('#holiday-example .ex-official').evaluate((e) => getComputedStyle(e).userSelect), 'none', 'selectable');
    const m = await measure(page);
    assert.ok(m.scrollH <= m.ih, 'no page scroll with the example expanded');
    assert.equal(m.tablistVisible, true);
    await page.locator('#f-theme').scrollIntoViewIfNeeded();
    assert.equal(await page.locator('#f-theme').isVisible(), true, 'theme remains reachable with example expanded');
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
    check(await grab(page, ['.cal-note-text', '.legend-hint', '.legend-item']));
    await page.locator('.cal-prev').click();
    check(await grab(page, ['.cal-note[data-tone="holiday"] .cal-note-text']));
    await cell(page, '10月1日').hover();
    await page.clock.runFor(450);
    check(await grab(page, ['.day-tooltip .tip-title', '.day-tooltip .tip-lunar', '.day-tooltip .tip-status', '.day-tooltip .tip-source', '.day-tooltip .pay-label', '.day-tooltip .pay-amt']));
    await page.locator('.cal-today').click();
    await page.locator('.cal-next').click();
    await page.locator('.cal-next').click();
    check(await grab(page, ['.cal-summary .cal-year-tag', '.cal-note[data-tone="holiday"] .cal-note-text']));
    await tab(page, '基本设置').click();
    check(await grab(page, ['.chip-ok', '.act-hint', '.scard-desc', '.scard-title', '.row-label', '.row-hint', '.para', '.warn-note', '.disclosure', '.adv-sub', '.adv-summary', '.unit', '.switch-state']));
    await page.locator('#btn-example').click();
    await page.locator('#adv-toggle').click();
    check(await grab(page, ['.example-head span', '.code', '.ex-line', '.mono', '#hint-custom-url', '#explain-custom-url']));
    await page.locator('#btn-float').click();
    await page.frameLocator('iframe.pip-stub').locator('#status-card').waitFor();
    check(await grab(page, ['#float-keep', '.pip-placeholder-title', '.pip-placeholder-note', '#btn-float']));
  }, { init: FLOAT_STUB });
  await withPage('2027-11-03T14:12:00+08:00', async (page) => {
    await tab(page, '基本设置').click();
    check(await grab(page, ['.chip-miss', '.chip-note']));
  });
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
      await page.locator('.settings-nav-link').nth(3).click();
      assert.equal((await focused(page)).id, 'card-backup-title');
      assert.equal(await page.locator('#card-backup-title').evaluate((e) => {
        const r = e.getBoundingClientRect(), p = document.querySelector('#panel-settings').getBoundingClientRect();
        return r.top >= p.top && r.bottom <= p.bottom;
      }), true, `${w}x${ht}: backup destination visible in settings panel`);
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
      await page.locator('#hint-cheer').scrollIntoViewIfNeeded();
      assert.equal(await page.locator('#hint-cheer').evaluate((e) => {
        const c = e.closest('.set-col').getBoundingClientRect();
        return e.getBoundingClientRect().bottom <= c.bottom + 0.5;
      }), true, '#hint-cheer inside the column');
      await page.locator('#f-theme').scrollIntoViewIfNeeded();
      assert.equal(await page.locator('#f-theme').isVisible(), true, 'theme reachable with a classic scrollbar');
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
    assert.equal(st.aria, '假期数据状态：2026 年 · 内置 · 2027 年 · 内置 · 上次检查 11/03');
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
  }, { init: `localStorage.setItem('work-motivator-v1-holidays', JSON.stringify({ version: 1, years: {}, lastCheck: Date.parse('2026-11-03T14:12:00+08:00') }));` }));

// ---- Task 14 fix round 1 · Block C（R49 / R50）----

// R50：提示的每一行都不被省略号截断（scrollWidth ≤ clientWidth）：2026 年全部 7 个节日的放假 / 调休、今天、带薪 / 无薪 / 手动标记，
// 四种视窗；5 周月份用内置 2026 表，6 周月份（2027-05 内置、2028-07 用导入的测试表）都覆盖
const WIDTH2028 = JSON.stringify({
  year: 2028, papers: ['https://www.gov.cn/zhengce/test-width-2028.htm'],
  days: [
    ...['元旦', '春节', '清明', '劳动节', '端午', '中秋', '国庆'].map((n, i) => ({ name: n, date: `2028-07-${String(3 + i).padStart(2, '0')}`, isOffDay: true })),
    ...[['元旦', '01'], ['春节', '02'], ['清明', '15'], ['劳动节', '16'], ['端午', '22'], ['中秋', '23'], ['国庆', '29']].map(([n, d]) => ({ name: n, date: `2028-07-${d}`, isOffDay: false })),
  ],
}); // 2028-07-01 是周六；所有调休日都在周六 / 周日
async function tipLines(page, key) {
  const c = page.locator(`.cal-grid button[data-key="${key}"]`);
  await c.hover();
  await page.clock.runFor(450);
  const r = await c.evaluate((b) => {
    const tip = document.querySelector('.day-tooltip');
    const desc = document.getElementById(b.getAttribute('aria-describedby')).textContent;
    const tr = tip.getBoundingClientRect();
    const vis = [...tip.children].filter((x) => getComputedStyle(x).display !== 'none');
    const first = vis[0].getBoundingClientRect();
    const last = vis.at(-1).getBoundingClientRect();
    const off = vis.map((x) => {
      const rg = document.createRange();
      rg.selectNodeContents(x);
      const q = rg.getBoundingClientRect();
      return Math.abs((q.left + q.right) / 2 - (tr.left + tr.right) / 2);
    });
    const el = tip.querySelector('.tip-lunar');
    const lunarEl = el && getComputedStyle(el).display !== 'none' && el.getClientRects().length ? el.textContent : null;
    const descLunar = (desc.match(/，农历[^，]+，/) ?? [null])[0]?.replace(/^，|，$/g, '') ?? null;
    return {
      hidden: tip.hidden, desc, lunar: lunarEl, descLunar,
      vclip: tip.scrollHeight > tip.clientHeight + 0.5, hclip: tip.scrollWidth > tip.clientWidth + 0.5,
      padDiff: Math.abs((first.top - tr.top) - (tr.bottom - last.bottom)), maxOff: Math.max(...off),
      lines: vis.map((x) => ({ text: x.textContent, cut: x.scrollWidth > x.clientWidth || [...x.querySelectorAll('*')].some((c) => c.scrollWidth > c.clientWidth) })),
    };
  });
  await page.mouse.move(0, 0);
  return r;
}
test('R50: no tooltip line is truncated — every 2026 festival (off + make-up), today, leave / manual states; 5-week and 6-week months (built-in 2027-05, imported 2028-07); four viewports', () =>
  withPage(T1412, async (page) => {
    await tab(page, '基本设置').click();
    await page.locator('#holiday-file').setInputFiles({ name: '2028.json', mimeType: 'application/json', buffer: Buffer.from(WIDTH2028) });
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
      ['2027-05', ['2027-05-01', '2027-05-03', '2027-05-05', '2027-05-08']], // 6 周（内置表）：劳动节连休 + 5/8 调休上班，来源是长文案「内置·官方通知」
      ['2028-07', ['2028-07-03', '2028-07-04', '2028-07-05', '2028-07-06', '2028-07-07', '2028-07-08', '2028-07-09', '2028-07-01', '2028-07-02', '2028-07-15', '2028-07-16', '2028-07-22', '2028-07-23', '2028-07-29']], // 6 周：7 个节日名的放假与调休
    ];
    const go = async (ym) => {
      const [y, m] = ym.split('-').map(Number);
      await page.locator('.cal-today').click();
      const diff = (y - 2026) * 12 + (m - 11);
      for (let i = 0; i < Math.abs(diff); i++) await page.getByRole('button', { name: diff < 0 ? /上月/ : /下月/ }).click();
    };
    const cuts = [];
    let checked = 0;
    const geo = [];
    let minPadDiff = 0;
    let maxOff = 0;
    for (const [w, ht] of ALL_VP) {
      await page.setViewportSize({ width: w, height: ht });
      for (const [ym, keys] of months) {
        await go(ym);
        for (const key of keys) {
          const r = await tipLines(page, key);
          assert.equal(r.hidden, false, `${key} @${w}: shown`);
          checked++;
          for (const l of r.lines) if (l.cut) cuts.push(`${w}x${ht} ${key}: 「${l.text}」`);
          if (r.vclip || r.hclip) cuts.push(`${w}x${ht} ${key}: tooltip clipped (v ${r.vclip}, h ${r.hclip})`);
          if (r.padDiff > 1) geo.push(`${w}x${ht} ${key}: top/bottom padding differs by ${r.padDiff}`);
          if (r.maxOff > 1) geo.push(`${w}x${ht} ${key}: a line is ${r.maxOff} off-centre`);
          minPadDiff = Math.max(minPadDiff, r.padDiff);
          maxOff = Math.max(maxOff, r.maxOff);
          // 完整文字（含来源与「点击修改」）在 aria-describedby
          assert.match(r.desc, /来源：.+，当日计薪 .+，点击修改$/, `${key}: full text in aria-describedby`);
          // 农历始终在 aria-describedby；可见时与它逐字一致，且紧跟日期行
          assert.ok(r.descLunar, `${key} @${w}: lunar date in aria-describedby (${r.desc})`);
          if (r.lunar !== null) {
            assert.equal(r.lunar, r.descLunar, `${key} @${w}: visible lunar matches the accessible one`);
            assert.equal(r.lines[1].text, r.lunar, `${key} @${w}: lunar right under the date line`);
          }
        }
      }
    }
    console.log(`MEASURE ${JSON.stringify({ case: 'R50 tooltip widths', checked, cuts, geo, worstPadDiff: minPadDiff, worstOffCentre: maxOff })}`);
    assert.deepEqual(cuts, [], 'no truncated or clipped tooltip line');
    assert.deepEqual(geo, [], 'content centred: top / bottom padding differ ≤ 1px, every line centred ≤ 1px');
    // 状态行的短写（农历行单独取出后逐字比对；农历行出现时必须在日期之后，文字固定）
    const r50 = async (key) => {
      const r = await tipLines(page, key);
      const base = r.lines.map((l) => l.text).filter((t) => !LUNAR_LINE.test(t));
      const lunar = r.lines.map((l) => l.text).filter((t) => LUNAR_LINE.test(t));
      assert.ok(lunar.length <= 1, `${key}: at most one lunar line (${JSON.stringify(r.lines.map((l) => l.text))})`);
      if (lunar.length) assert.equal(r.lines[1].text, lunar[0], `${key}: lunar right under the date line`);
      return { base, lunar };
    };
    await page.setViewportSize({ width: 1280, height: 585 });
    await go('2026-05');
    const may1 = await r50('2026-05-01');
    // 2026-05 是 6 周月份、1280×585：日期 / 状态 / 计薪 必须都在；第 4 行若出现只能是来源（农历行已单独取出）
    assert.deepEqual([may1.base[0], may1.base[1], may1.base.at(-1)], ['5月1日 周五', '法定假日·劳动节', '计薪 ¥0.00'], `lines: ${JSON.stringify(may1.base)}`);
    assert.ok(may1.base.length === 3 || (may1.base.length === 4 && may1.base[2] === '内置·官方通知'), `lines: ${JSON.stringify(may1.base)}`);
    if (may1.lunar.length) assert.equal(may1.lunar[0], '农历三月十五', 'lunar line text');
    const may9 = await r50('2026-05-09');
    assert.equal(may9.base[1], '调休上班·劳动节');
    if (may9.lunar.length) assert.equal(may9.lunar[0], '农历三月廿三', 'lunar line text');
    await page.setViewportSize({ width: 1366, height: 650 });
    await go('2026-10');
    const oct1 = await r50('2026-10-01');
    // 5 周月份、1366×650：放得下第 4 行（来源，或先让位给农历）
    assert.deepEqual([oct1.base[0], oct1.base[1], oct1.base.at(-1)], ['10月1日 周四', '法定假日·国庆', '计薪 ¥0.00'], `lines: ${JSON.stringify(oct1.base)}`);
    assert.ok(oct1.base.length === 3 || (oct1.base.length === 4 && oct1.base[2] === '内置·官方通知'), `lines: ${JSON.stringify(oct1.base)}`);
    assert.ok(oct1.base.length + oct1.lunar.length >= 4, `5-week month has a 4th line at 1366×650: ${JSON.stringify(oct1.base)}`);
    if (oct1.lunar.length) assert.equal(oct1.lunar[0], '农历八月廿一', 'lunar line text');
    await page.setViewportSize({ width: 1280, height: 585 });
    await go('2026-11');
    const nov3 = await tipLines(page, '2026-11-03');
    assert.deepEqual(nov3.lines.map((l) => l.text).filter((t) => !LUNAR_LINE.test(t)).slice(0, 2), ['11月3日 周二', '工作日·今天']);
    if (nov3.lines.some((l) => LUNAR_LINE.test(l.text))) assert.equal(nov3.lines[1].text, '农历九月廿五', 'lunar line text');
  }));

// Task 18：每一种提示（工作日 / 今天 / 周末 / 休息 / 法定假日 / 调休上班 / 带薪 / 无薪 / 手动标记 / 计薪为 0）的每个文字对白底 ≥ 4.5:1（由渲染后的颜色实算），
// 在最大（1920×950）与最窄（1000×700，最小字号）视窗各量一次
test('Task 18: tooltip text contrast ≥ 4.5:1 on its white card for every variant (computed from rendered colours)', () =>
  withPage(T1412, async (page) => {
    for (const [label, re] of [['11月5日', /^带薪假/], ['11月6日', /^无薪假/], ['11月7日', /改为上班/], ['11月9日', /改为休息/]]) {
      await cell(page, label).click();
      await page.getByRole('menuitemradio', { name: re }).click();
    }
    const variants = [
      ['workday', 0, '2026-11-18'], ['today', 0, '2026-11-03'], ['weekend', 0, '2026-11-14'], ['paid', 0, '2026-11-05'], ['unpaid', 0, '2026-11-06'],
      ['manual work (makeup colours)', 0, '2026-11-07'], ['manual rest', 0, '2026-11-09'], ['holiday (¥0.00)', -1, '2026-10-01'], ['makeup', -1, '2026-10-10'],
    ];
    let worst = Infinity;
    for (const [w, ht] of [[1920, 950], [1000, 700]]) {
      await page.setViewportSize({ width: w, height: ht });
      for (const [name, back, key] of variants) {
        await page.locator('.cal-today').click();
        if (back) await page.locator('.cal-prev').click();
        await page.locator(`.cal-grid button[data-key="${key}"]`).hover();
        await page.clock.runFor(450);
        const rows = await page.evaluate(() => {
          const tip = document.querySelector('.day-tooltip');
          const bg = getComputedStyle(tip).backgroundColor;
          return [...tip.querySelectorAll('.tip-title, .tip-lunar, .tip-status, .tip-source, .pay-label, .pay-amt')]
            .filter((e) => e.getClientRects().length)
            .map((e) => [e.className, getComputedStyle(e).color, bg]);
        });
        assert.ok(rows.length >= 4, `${name} @${w}: tooltip text found`);
        for (const [cls, fg, bg] of rows) {
          const r = ratio(fg, bg);
          worst = Math.min(worst, r);
          assert.ok(r >= 4.5, `${name} @${w} ${cls}: ${fg} on ${bg} = ${r.toFixed(2)}`);
        }
        await page.mouse.move(0, 0);
      }
    }
    console.log(`MEASURE ${JSON.stringify({ case: 'Task 18 tooltip contrast', variants: variants.length * 2, worst: +worst.toFixed(2) })}`);
  }));

// Task 18：格子标签——法定假日只有旗子 + 节日名（没有「假」字）；调休上班保留「班」+ 节日名；任何格子的标签都不被截断（≥ 1000px 宽的各种视窗）；
// 无障碍名称不变（仍写「法定假日（春节）」）。2026-01…2028-12 每一格：2026 / 2027 用内置表，2028-07 用导入的虚构表把 7 个节日名各与「班」配一遍
test('Task 18: cell labels — flag + holiday name only (no 「假」 tag); 「班」 kept; no label truncated for 2026-01…2028-12 at 8 viewports; accessible names intact', () =>
  withPage(T1412, async (page) => {
    await tab(page, '基本设置').click();
    await page.locator('#holiday-file').setInputFiles({ name: '2028.json', mimeType: 'application/json', buffer: Buffer.from(WIDTH2028) });
    await page.locator('#holiday-result[data-tone="success"]').waitFor();
    await tab(page, '月历').click();
    const months = [];
    for (const y of [2026, 2027, 2028]) for (let m = 1; m <= 12; m++) months.push([y, m]);
    const go = async (y, m) => {
      await page.locator('.cal-today').click();
      const diff = (y - 2026) * 12 + (m - 11);
      for (let i = 0; i < Math.abs(diff); i++) await page.getByRole('button', { name: diff < 0 ? /上月/ : /下月/ }).click();
    };
    const bad = [];
    let cells = 0;
    let holidayCells = 0;
    let minSlack = Infinity;
    let minWhere = '';
    const names = new Set();
    for (const [w, ht] of ALL_VP) {
      await page.setViewportSize({ width: w, height: ht });
      for (const [y, m] of months) {
        await go(y, m);
        const r = await page.evaluate(() => [...document.querySelectorAll('.cal-grid .day')].map((b) => {
          const lab = b.querySelector('.day-label');
          const nm = b.querySelector('.day-name');
          const tag = b.querySelector('.day-tag');
          let slack = null;
          if (lab) {
            // 余量 = 标签盒内宽 − 内容（图示 + 间距 + 名字）实际所需宽度
            const kids = [...lab.children];
            const need = kids.reduce((a, k) => {
              if (k.classList.contains('day-name')) { const rg = document.createRange(); rg.selectNodeContents(k); return a + rg.getBoundingClientRect().width; }
              return a + k.getBoundingClientRect().width;
            }, 0) + Math.max(0, kids.length - 1) * parseFloat(getComputedStyle(lab).columnGap || 0);
            const cs = getComputedStyle(b);
            const avail = b.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
            slack = avail - need - parseFloat(getComputedStyle(lab).paddingRight);
          }
          return {
            key: b.dataset.key, kind: [...b.classList].find((c) => c.startsWith('kind-')),
            aria: b.getAttribute('aria-label'),
            label: lab ? lab.textContent : null, tagText: tag ? tag.textContent : null, name: nm ? nm.textContent : null,
            cut: [lab, nm, tag].some((e) => e && e.scrollWidth > e.clientWidth + 0.5), slack,
            holidayIcon: Boolean(b.querySelector('.day-tag svg.icon-holiday')),
            gap: lab ? parseFloat(getComputedStyle(lab).columnGap) : null, cw: b.parentElement.clientWidth,
          };
        }));
        for (const c of r) {
          cells++;
          if (c.cut) bad.push(`${w}x${ht} ${c.key}: truncated 「${c.label}」`);
          if (c.slack !== null && c.name) {
            names.add(`${c.tagText ? '班' : ''}${c.name}`);
            if (c.slack < minSlack) { minSlack = c.slack; minWhere = `${w}x${ht} ${c.key} 「${c.label}」`; }
          }
          if (c.kind === 'kind-holiday') {
            holidayCells++;
            if (c.tagText !== '' || !c.holidayIcon) bad.push(`${w}x${ht} ${c.key}: holiday label must be flag + name only (tag 「${c.tagText}」)`);
            if (/^假/.test(c.label ?? '') || /假/.test(c.tagText ?? '')) bad.push(`${c.key}: 「假」 prefix tag present`);
            if (!new RegExp(`法定假日（${c.name}）`).test(c.aria)) bad.push(`${c.key}: accessible name lost the holiday: ${c.aria}`);
          }
          if (c.kind === 'kind-makeup' && c.name && c.gap !== (c.cw <= 80 ? 1 : 3)) bad.push(`${w}x${ht} ${c.key}: 班 / name gap ${c.gap}px in a ${c.cw}px cell (want 3px, 1px only in the tightest tier)`);
          if (c.kind === 'kind-makeup' && c.name && c.tagText !== '班') bad.push(`${w}x${ht} ${c.key}: make-up keeps 「班」, got 「${c.tagText}」`);
        }
      }
    }
    console.log(`MEASURE ${JSON.stringify({ case: 'Task 18 cell labels', cells, holidayCells, bad: bad.slice(0, 10), minSlackPx: +minSlack.toFixed(2), minWhere, names: [...names] })}`);
    assert.deepEqual(bad, [], 'no truncated label, no 「假」 tag, accessible names intact');
    assert.ok(holidayCells > 50 && names.size >= 14, `covered ${holidayCells} holiday cells and ${names.size} name variants`);
    assert.ok(minSlack >= 6, `smallest label slack ${minSlack.toFixed(2)}px at ${minWhere} (need ≥ 6px for the wider 微软雅黑)`);
  }));

// Task 18 fix round 1：每一种格子 × 每一种视窗（含 1093×535 = 1366×768 @125%）× 有 / 没有首次提示条（存过设置 = 没有提示条，格子更高）：
// 提示完全放得下——计薪金额永远在卡片里、没有横纵向裁切、状态里的名字不在中间折行；大格子的金额至少是日期字号的 1.5 倍
const SAVED = { init: `localStorage.setItem('work-motivator-v1', JSON.stringify({ ...${JSON.stringify(CN_LEGACY)}, marks: { '2026-11-10': 'paidLeave', '2026-11-11': 'unpaidLeave', '2026-11-12': 'rest', '2026-11-14': 'work', '2026-10-14': 'paidLeave', '2026-10-15': 'unpaidLeave' } }));` };
for (const [state, opts] of [['first-run banner shown', { seed: false }], ['saved settings (no banner)', SAVED]]) {
  test(`Task 18 r1: tooltip fits every cell of 2026-05 / 2026-10 / 2026-11 at all 9 viewports incl. 1093×535 — ${state}: pay amount inside, no clip, no mid-name break, hero ≥ 1.5× date on ≥ 1280`, () =>
    withPage(T1412, async (page) => {
      const bad = [];
      const tiers = {};
      let hovers = 0;
      let minSlack = Infinity;
      let minWhere = '';
      let worstRatio = Infinity;
      for (const [w, ht] of ALL_VP) {
        await page.setViewportSize({ width: w, height: ht });
        for (const back of [0, 1, 6]) { // 2026-11（6 周）、2026-10（5 周）、2026-05（6 周）
          await page.locator('.cal-today').click();
          for (let i = 0; i < back; i++) await page.locator('.cal-prev').click();
          const keys = await page.locator('.cal-grid button[data-key]').evaluateAll((bs) => bs.map((b) => b.dataset.key));
          for (const key of keys) {
            await page.locator(`.cal-grid button[data-key="${key}"]`).hover();
            await page.clock.runFor(450);
            const r = await page.evaluate(() => {
              const tip = document.querySelector('.day-tooltip');
              const tr = tip.getBoundingClientRect();
              const kids = [...tip.children].filter((x) => getComputedStyle(x).display !== 'none');
              const amt = tip.querySelector('.pay-amt');
              const ar = amt.getBoundingClientRect();
              const split = [...tip.querySelectorAll('.u')].filter((u) => {
                const rg = document.createRange();
                rg.selectNodeContents(u);
                return new Set([...rg.getClientRects()].map((q) => Math.round(q.top))).size > 1;
              }).map((u) => u.textContent);
              const content = kids.at(-1).getBoundingClientRect().bottom - kids[0].getBoundingClientRect().top;
              return {
                hidden: tip.hidden, tier: [...tip.classList].filter((c) => c.startsWith('is-') && c !== 'is-today').join(' ') || 'full',
                vclip: tip.scrollHeight > tip.clientHeight + 0.5, hclip: tip.scrollWidth > tip.clientWidth + 0.5,
                cut: kids.filter((x) => x.scrollWidth > x.clientWidth + 0.5 || [...x.querySelectorAll('*')].some((c) => c.scrollWidth > c.clientWidth + 0.5)).map((x) => x.textContent),
                amtInside: ar.width > 0 && ar.bottom <= tr.bottom - 1.5 && ar.top >= tr.top + 1.5 && ar.left >= tr.left + 1.5 && ar.right <= tr.right - 1.5,
                amtText: amt.textContent, split, slack: tip.clientHeight - content,
                ratio: parseFloat(getComputedStyle(amt).fontSize) / parseFloat(getComputedStyle(tip.querySelector('.tip-title')).fontSize),
                status: kids.some((x) => x.classList.contains('tip-status')),
              };
            });
            hovers++;
            tiers[r.tier] = (tiers[r.tier] ?? 0) + 1;
            const where = `${w}x${ht} ${key}`;
            if (r.hidden || r.vclip || r.hclip || r.cut.length || !r.amtInside || !/(?:NT\$|¥)\s?\d/.test(r.amtText) || r.split.length) bad.push(`${where}: ${JSON.stringify(r)}`);
            if (!r.status) bad.push(`${where}: status line dropped (last resort used)`);
            if (r.slack < minSlack) { minSlack = r.slack; minWhere = where; }
            if (w >= 1280) { worstRatio = Math.min(worstRatio, r.ratio); if (r.ratio < 1.5 - 1e-6) bad.push(`${where}: amount only ${r.ratio.toFixed(2)}× the date line`); }
          }
          await page.mouse.move(0, 0);
        }
      }
      console.log(`MEASURE ${JSON.stringify({ case: `Task 18 r1 tooltip fits (${state})`, hovers, tiers, minSlackPx: +minSlack.toFixed(2), minWhere, worstHeroRatioAtLeast1280: +worstRatio.toFixed(2), bad: bad.slice(0, 8), nBad: bad.length })}`);
      assert.deepEqual(bad, []);
    }, opts));
}

// Task 18 fix round 1（视觉裁定）：无薪假不用刺眼的暗红边（边框中性灰，只有状态文字是红）；今天的提示带 brand-50 底色（和工作日不同，且不盖掉格子自己的今天框的辨识度）；
// 法定假日用青绿色组（和周末的中性灰不同）；周末 / 休息保持中性灰
test('Task 18 r1: tooltip colour coding — unpaid has a neutral border + red text, today is tinted brand-50, holiday is teal, weekend neutral; all text ≥ 4.5:1', () =>
  withPage(T1412, async (page) => {
    await cell(page, '11月5日').click();
    await page.getByRole('menuitemradio', { name: /^无薪假/ }).click();
    const read = async (key, back) => {
      await page.locator('.cal-today').click();
      if (back) await page.locator('.cal-prev').click();
      await page.locator(`.cal-grid button[data-key="${key}"]`).hover();
      await page.clock.runFor(450);
      const r = await page.evaluate(() => {
        const tip = document.querySelector('.day-tooltip');
        const cs = getComputedStyle(tip);
        return { ring: cs.borderTopColor, bg: cs.backgroundColor, status: getComputedStyle(tip.querySelector('.tip-status')).color, texts: [...tip.querySelectorAll('.tip-title, .tip-lunar, .tip-status, .tip-source, .pay-label, .pay-amt')].filter((e) => e.getClientRects().length).map((e) => getComputedStyle(e).color) };
      });
      await page.mouse.move(0, 0);
      for (const c of r.texts) assert.ok(ratio(c, r.bg) >= 4.5, `${key}: ${c} on ${r.bg}`);
      return r;
    };
    const unpaid = await read('2026-11-05', 0);
    assert.equal(unpaid.status, 'rgb(159, 18, 57)', 'status text stays red');
    assert.notEqual(unpaid.ring, unpaid.status, 'border is not the dark red');
    assert.equal(unpaid.ring, 'rgb(107, 114, 128)', 'neutral grey border');
    const today = await read('2026-11-03', 0);
    assert.equal(today.bg, 'rgb(240, 253, 244)', 'today tint = brand-50');
    assert.equal(today.ring, 'rgb(21, 128, 61)');
    const work = await read('2026-11-18', 0);
    assert.equal(work.bg, 'rgb(255, 255, 255)');
    const weekend = await read('2026-11-14', 0);
    const holiday = await read('2026-10-01', 1);
    assert.equal(holiday.ring, 'rgb(17, 94, 89)', 'holiday = teal');
    assert.equal(holiday.status, 'rgb(17, 94, 89)');
    assert.equal(weekend.ring, 'rgb(75, 85, 99)', 'weekend stays neutral grey');
    assert.notEqual(holiday.ring, weekend.ring);
  }));

// M8：图例色块直接用真实格子的 token——周末色块与周末格子同色，且与法定假日色块不同色系（不再靠加深边框区分）
test('legend swatches use the real cell tokens (weekend ≠ holiday, no special border)', () =>
  withPage(T1412, async (page) => {
    await page.getByRole('button', { name: '上月' }).click(); // 2026-10：有法定假日，同屏可比
    const read = (sel) => page.locator(sel).first().evaluate((e) => {
      const cs = getComputedStyle(e);
      return { bg: cs.backgroundColor, border: cs.borderTopColor, width: cs.borderTopWidth };
    });
    const sw = {
      weekend: await read('.cal-legend [data-kind=weekend] .legend-swatch'),
      holiday: await read('.cal-legend [data-kind=holiday] .legend-swatch'),
      cellWeekend: await read('.cal-grid button.kind-weekend'),
      cellHoliday: await read('.cal-grid button.kind-holiday'),
    };
    console.log(`MEASURE ${JSON.stringify({ case: 'legend swatch tokens', ...sw })}`);
    assert.equal(sw.weekend.bg, sw.cellWeekend.bg, 'weekend swatch = weekend cell background');
    assert.equal(sw.holiday.bg, sw.cellHoliday.bg, 'holiday swatch = holiday cell background');
    assert.notEqual(sw.weekend.bg, sw.holiday.bg, 'weekend and holiday must not share a background');
    assert.equal(sw.weekend.width, '1px', 'no thickened border at 1px');
    assert.equal(sw.weekend.border, sw.holiday.border, 'both swatches keep the same subtle border');
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
    const amt = tip.querySelector('.pay-amt');
    const status = tip.querySelector('.tip-status');
    const fs = [parseFloat(getComputedStyle(lines[0]).fontSize), parseFloat(getComputedStyle(amt).fontSize)];
    const fw = [getComputedStyle(lines[0]).fontWeight, getComputedStyle(status).fontWeight, getComputedStyle(amt).fontWeight];
    return {
      top: Math.round((first.top - tr.top) * 10) / 10, bottom: Math.round((tr.bottom - last.bottom) * 10) / 10, h: Math.round(tr.height * 10) / 10,
      n: lines.length, fs, fw, cut: lines.some((x) => x.scrollWidth > x.clientWidth), payColor: getComputedStyle(amt).color, align: getComputedStyle(tip).textAlign,
    };
  });
  await page.mouse.move(0, 0);
  return r;
}
test('C3 / Task 18: tooltip content is vertically centred in the card (top/bottom space differ ≤ 1px) with a clear hierarchy (pay amount is the hero) — 4 viewports + a tall cell, 5- and 6-week months', () =>
  withPage(T1412, async (page) => {
    for (const [w, ht] of [...ALL_VP, [1920, 1300]]) {
      await page.setViewportSize({ width: w, height: ht });
      for (const [ym, key] of [['2026-11', '2026-11-03'], ['2026-11', '2026-11-18'], ['2026-10', '2026-10-01']]) {
        await page.locator('.cal-today').click();
        if (ym === '2026-10') await page.locator('.cal-prev').click();
        const r = await tipBalance(page, key);
        console.log(`MEASURE ${JSON.stringify({ case: 'C3 tooltip balance', w, ht, key, ...r })}`);
        assert.ok(Math.abs(r.top - r.bottom) <= 1, `${key} @${w}x${ht}: top ${r.top} vs bottom ${r.bottom}`);
        assert.equal(r.cut, false, `${key} @${w}x${ht}: no truncated line`);
        assert.ok(r.fs[1] > r.fs[0], `pay amount is the hero: larger than the date line (${r.fs})`);
        assert.ok(Number(r.fw[0]) >= 600 && Number(r.fw[2]) >= 700, `date semibold, amount bold (${r.fw})`);
        assert.ok(Number(r.fw[1]) <= 500, `status weight ≤ 500 (${r.fw[1]})`);
        assert.equal(r.align, 'center');
        assert.ok(['rgb(22, 101, 52)', 'rgb(75, 85, 99)'].includes(r.payColor), `amount uses brand-700 (or grey for ¥0.00): ${r.payColor}`);
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

// 今天的绿色圆圈（M6）：22px 正圆；字形墨迹中心与圆心水平、垂直偏差均 ≤ 0.5px；
// 圆距 2px 的今天边框 ≥ 3px；日期方框位置与普通格子一致。
async function numGeometry(page, key) {
  return page.locator(`.cal-grid button[data-key="${key}"]`).evaluate((b) => {
    const num = b.querySelector('.day-num');
    const nr = num.getBoundingClientRect();
    const br = b.getBoundingClientRect();
    const bw = parseFloat(getComputedStyle(b).borderTopWidth);
    const textNode = num.querySelector('.day-num-ink').firstChild;
    const range = document.createRange();
    const cs = getComputedStyle(num);
    const ctx = document.createElement('canvas').getContext('2d');
    ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const ink = { l: Infinity, r: -Infinity, t: Infinity, b: -Infinity };
    for (let i = 0; i < textNode.length; i++) {
      range.setStart(textNode, i); range.setEnd(textNode, i + 1);
      const tr = range.getBoundingClientRect();
      const m = ctx.measureText(textNode.data[i]);
      const origin = tr.left + (tr.width - m.width) / 2;
      const baseline = tr.top + m.fontBoundingBoxAscent;
      ink.l = Math.min(ink.l, origin - m.actualBoundingBoxLeft);
      ink.r = Math.max(ink.r, origin + m.actualBoundingBoxRight);
      ink.t = Math.min(ink.t, baseline - m.actualBoundingBoxAscent);
      ink.b = Math.max(ink.b, baseline + m.actualBoundingBoxDescent);
    }
    const r1 = (v) => Math.round(v * 10) / 10;
    return {
      text: num.textContent, today: b.classList.contains('is-today'),
      dx: r1((ink.l + ink.r) / 2 - (nr.left + nr.right) / 2), dy: r1((ink.t + ink.b) / 2 - (nr.top + nr.bottom) / 2),
      side: { l: ink.l - nr.left, r: nr.right - ink.r },
      clearTop: r1(nr.top - (br.top + bw)), clearLeft: r1(nr.left - (br.left + bw)),
      offTop: r1(nr.top - br.top), offLeft: r1(nr.left - br.left), circle: [r1(nr.width), r1(nr.height)],
    };
  });
}
test('M6: today circle — ink centre within 0.5px in both axes, ≥ 3px border clearance and alignment with other cells', async () => {
  for (const [iso, todayKey, otherKey] of [['2026-11-01T10:00:00+08:00', '2026-11-01', '2026-11-02'], ['2026-11-04T10:00:00+08:00', '2026-11-04', '2026-11-05'], ['2026-11-11T10:00:00+08:00', '2026-11-11', '2026-11-12'], ['2026-11-18T10:00:00+08:00', '2026-11-18', '2026-11-19']]) {
    await withPage(iso, async (page) => {
      for (const [w, ht] of VIEWPORTS) {
        await page.setViewportSize({ width: w, height: ht });
        const t = await numGeometry(page, todayKey);
        const o = await numGeometry(page, otherKey);
        console.log(`MEASURE ${JSON.stringify({ case: 'C3 today circle', w, ht, today: t, other: o })}`);
        assert.equal(t.today, true);
        assert.ok(t.clearTop >= 3 && t.clearLeft >= 3, `${t.text} @${w}: ≥ 3px clear of the 2px today border (top ${t.clearTop}, left ${t.clearLeft})`);
        assert.deepEqual(t.circle, [22, 22], `${t.text} @${w}: the today disc is a 22px circle (${t.circle})`);
        assert.ok(Math.abs(t.offTop - o.offTop) <= 0.5 && Math.abs(t.offLeft - o.offLeft) <= 0.5, `today number at the same place as other cells (${t.offTop},${t.offLeft} vs ${o.offTop},${o.offLeft})`);
        // 旧的普通日期墨迹检查保留原来的 05 / 19 样本；11 的相邻 12 因等宽字形左右留白不对称。
        if (todayKey === '2026-11-04' || todayKey === '2026-11-18') assert.ok(Math.abs(o.dx) <= 1 && Math.abs(o.dy) <= 1, `other number centred in its box (dx ${o.dx}, dy ${o.dy})`);
        if ((w === 1280 || w === 1920) && todayKey === '2026-11-04') await shot(page, `task-14-c3-today-${w}x${ht}.png`);
      }
    });
  }
});

test('today circle fits and centres single and double digit dates at every font scale', async () => {
  for (const day of [1, 11, 30]) {
    const key = `2026-11-${String(day).padStart(2, '0')}`;
    await withPage(`${key}T10:00:00+08:00`, async (page) => {
      for (const [width, height] of [[1093, 535], [1920, 950]]) {
        await page.setViewportSize({ width, height });
        for (const scale of ['xs', 's', 'm', 'l', 'xl']) {
          await tab(page, '基本设置').click();
          await page.locator('#f-fontScale').selectOption(scale);
          await tab(page, '月历').click();
          const g = await numGeometry(page, key);
          const expectedSize = 22 * ({ xs: 1, s: 1, m: 1, l: 1.1, xl: 1.2 }[scale]);
          assert.ok(Math.abs(g.circle[0] - expectedSize) < .15 && Math.abs(g.circle[0] - g.circle[1]) < .1, `${scale}: circle ${g.circle}`);
          assert.ok(Math.abs(g.dx) <= .6 && Math.abs(g.dy) <= .6, `${day} ${scale} @${width}: centred ink (${g.dx}, ${g.dy})`);
          assert.ok(g.side.l >= 2 && g.side.r >= 2, `${day} ${scale} @${width}: ink has clearance (${g.side.l}, ${g.side.r})`);
        }
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
    for (const [w, ht] of ALL_VP) {
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

// 2 位数日期（M6）：墨迹两侧离圆边 ≥ 2px，圆是 22px 正圆，垂直居中 ≤ 0.5px，离 2px 绿框 ≥ 3px
test('M6 round 2: today circle with 2 digits has ≥ 2px side room, is a 22px circle, vertically centred within 0.5px', async () => {
  for (const [iso, key] of [['2026-11-18T10:00:00+08:00', '2026-11-18'], ['2026-11-30T10:00:00+08:00', '2026-11-30'], ['2026-11-04T10:00:00+08:00', '2026-11-04']]) {
    await withPage(iso, async (page) => {
      for (const [w, ht] of VIEWPORTS) {
        await page.setViewportSize({ width: w, height: ht });
        const g = await numGeometry(page, key);
        const side = g.side;
        console.log(`MEASURE ${JSON.stringify({ case: 'C r2 circle', w, key, ...g, side })}`);
        assert.ok(side.l >= 2 && side.r >= 2, `${key} @${w}: ink ≥ 2px from the circle edge (${side.l.toFixed(1)}, ${side.r.toFixed(1)})`);
        assert.deepEqual(g.circle, [22, 22], `${key} @${w}: the disc is a 22px circle (${g.circle})`);
        assert.ok(Math.abs(g.dy) <= 0.5, `${key} @${w}: ink vertically centred within 0.5px (dy ${g.dy})`);
        assert.ok(Math.abs(g.dx) <= 0.5, `${key} @${w}: ink horizontally centred within 0.5px (dx ${g.dx})`);
        assert.ok(g.clearTop >= 3 && g.clearLeft >= 3, `${key} @${w}: ≥ 3px clear of the today border (top ${g.clearTop}, left ${g.clearLeft})`);
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
test('C round 3: every no-table year (2024 / 2025 / 2028 / 2036) shows a visible qualifier tag in the summary row; nothing truncated at 1000×700 and the four viewports', () =>
  withPage(T1412, async (page) => {
    const cases = [
      ['2025-10', '2025 年只标了元旦、劳动节、国庆'], ['2025-11', '2025 年只标了元旦、劳动节、国庆'],
      ['2028-10', '2028 年只标了法定假日，补假和调休未标出'], ['2036-10', '2036 年只标了元旦、劳动节、国庆'], ['2024-05', '2024 年未标法定假日'],
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
test('C round 3: narrow tooltip wraps only between units — 「周X」 and 「计薪 ¥…」 never split; no truncation (1000×700 … 1200×700 incl. 1093×535); the holiday status breaks only at 「·」, never inside a name', () =>
  withPage(T1412, async (page) => {
    const bad = [];
    for (const [w, ht] of NARROW_VP) {
      await page.setViewportSize({ width: w, height: ht });
      for (const [move, keys] of [[0, ['2026-11-03', '2026-11-18', '2026-11-28']], [1, ['2026-10-10', '2026-10-01', '2026-10-17']], [2, ['2026-09-20', '2026-09-25']], [6, ['2026-05-01', '2026-05-09']]]) {
        await page.locator('.cal-today').click();
        for (let i = 0; i < move; i++) await page.locator('.cal-prev').click();
        for (const key of keys) {
          await page.locator(`.cal-grid button[data-key="${key}"]`).hover();
          await page.clock.runFor(450);
          const r = await page.evaluate(() => {
            const tip = document.querySelector('.day-tooltip');
            const lines = [...tip.children].filter((x) => getComputedStyle(x).display !== 'none');
            const title = lines[0];
            const wk = [...title.querySelectorAll('.u')].find((u) => /^周/.test(u.textContent));
            const pay = tip.querySelector('.tip-pay');
            // 每个「单位」（日期 / 周X / 状态里的 「法定假日·」「劳动节」…）的文字都在同一行上（Range 的矩形只有一个 top）：不会在名字中间折行
            const split = [...tip.querySelectorAll('.u')].filter((u) => {
              const rg = document.createRange();
              rg.selectNodeContents(u);
              return new Set([...rg.getClientRects()].map((q) => Math.round(q.top))).size > 1;
            }).map((u) => u.textContent);
            const amt = tip.querySelector('.pay-amt').getBoundingClientRect();
            const tr = tip.getBoundingClientRect();
            return {
              split, amtInside: amt.width > 0 && amt.bottom <= tr.bottom && amt.top >= tr.top,
              weekday: wk ? wk.getClientRects().length : -1, noWd: tip.classList.contains('is-no-wd'),
              statusShown: [...tip.children].some((c) => c.classList.contains('tip-status') && getComputedStyle(c).display !== 'none' && c.getClientRects().length > 0),
              pay: pay.getClientRects().length, payText: pay.textContent,
              cut: lines.filter((x) => x.scrollWidth > x.clientWidth + 0.5).map((x) => x.textContent), vclip: tip.scrollHeight > tip.clientHeight + 0.5,
            };
          });
          await page.mouse.move(0, 0);
          // P1：放不下时倒数第二档先藏「周X」（屏幕阅读器仍读得到），之后才是拿掉状态行。所以「周X」要么完整一行，要么在这一档被藏起来
          const wdOk = r.weekday === 1 || (r.weekday === 0 && r.noWd && r.statusShown);
          if (!wdOk || r.pay !== 1 || r.cut.length || r.vclip || r.split.length || !r.amtInside) bad.push(`${w} ${key}: ${JSON.stringify(r)}`);
        }
      }
    }
    console.log(`MEASURE ${JSON.stringify({ case: 'C r3 units', bad })}`);
    assert.deepEqual(bad, []);
  }));

test('calendar toolbar refits its hint after resizing while settings is open', () =>
  withPage(T1412, async (page) => {
    await tab(page, /设置/).click();
    await page.setViewportSize({ width: 340, height: 585 });
    await tab(page, /月历/).click();
    const hint = page.locator('.cal-toolbar .legend-hint');
    // 提示有三档：完整句 → 短句 → 不显示（fitHint 逐档试）。340px 下工具列会换行（.cal-toolbar 在
    // ≤480px 折行），所以短句常常放得下；这里不预设哪一档，只要求「重新量过」的结果自洽：
    // 要么不显示，要么是短句、完整不截断、留在工具列内、且不与「回到今天」重叠。
    const state = () => hint.evaluate((e) => {
      const barEl = e.closest('.cal-toolbar');
      const bar = barEl.getBoundingClientRect(), r = e.getBoundingClientRect();
      const today = barEl.querySelector('.cal-today').getBoundingClientRect();
      const shown = !e.hidden && r.width > 0 && r.height > 0;
      return {
        shown,
        text: e.textContent.trim(),
        contained: !shown || (r.left >= bar.left - 0.5 && r.right <= bar.right + 0.5 && r.top >= bar.top - 0.5 && r.bottom <= bar.bottom + 0.5),
        cut: shown && e.scrollWidth > e.clientWidth + 0.5,
        overlapsToday: shown
          && Math.min(r.right, today.right) - Math.max(r.left, today.left) > 0.5
          && Math.min(r.bottom, today.bottom) - Math.max(r.top, today.top) > 0.5,
      };
    });
    const narrow = await state();
    assert.ok(!narrow.shown || narrow.text === '点日期可标记', `340px: the hint steps down to the short form instead of overflowing (${narrow.text})`);
    assert.equal(narrow.contained, true, '340px: a shown hint stays inside the wrapped toolbar');
    assert.equal(narrow.cut, false, '340px: a shown hint is never cut mid-sentence');
    assert.equal(narrow.overlapsToday, false, '340px: the hint never sits on top of 回到今天');
    await page.setViewportSize({ width: 1280, height: 585 });
    // 340px 时提示本来就已经可见（短句），waitFor({state:'visible'}) 会立刻返回、等不到重新排版；
    // resize 事件要到下一次渲染更新才派发（与 A3 同一套做法），所以边推进暂停的时钟边等到目标状态：
    // 完整句回来、而且在工具列里放得下。等不到就是这次重构真的没发生，下面的断言会失败。
    const FULL = '点日期可标记：调休上班 · 带薪假 · 无薪假';
    let wide = await state();
    for (let i = 0; i < 20 && !(wide.shown && wide.text === FULL && wide.contained); i++) {
      await page.clock.runFor(50);
      await new Promise((r) => setTimeout(r, 25));
      wide = await state();
    }
    assert.equal(await hint.isVisible(), true, 'hint returns when the toolbar has room');
    assert.equal(wide.text, FULL, 'the full hint is back at 1280');
    assert.equal(wide.contained, true, 'visible hint fits after resizing');
    assert.equal(wide.cut, false, 'the full hint is not truncated at 1280');
  }));

test('an open tooltip refits on resize and font loading without reviving after Escape', () =>
  withPage(T1412, async (page) => {
    await page.setViewportSize({ width: 1920, height: 950 });
    const day = page.locator('.cal-grid button[data-key="2026-11-03"]');
    await day.focus();
    const tip = page.locator('.day-tooltip');
    assert.equal(await tip.isVisible(), true);
    assert.equal(await tip.locator('.tip-source').isVisible(), true);
    const style = await page.addStyleTag({ content: '.day-tooltip .tip-source { height: 200px !important; }' });
    await page.evaluate(() => window.dispatchEvent(new Event('resize')));
    assert.equal(await tip.locator('.tip-source').isVisible(), false, 'overflowing source is removed on resize');
    await style.evaluate((e) => e.remove());
    await page.evaluate(() => document.fonts.dispatchEvent(new Event('loadingdone')));
    assert.equal(await tip.locator('.tip-source').isVisible(), true, 'source returns after font metrics change');
    const description = await day.getAttribute('aria-describedby');
    assert.match(await page.locator(`#${description}`).textContent(), /周二/);
    await page.keyboard.press('Escape');
    assert.equal(await tip.isVisible(), false);
    await page.evaluate(() => { window.dispatchEvent(new Event('resize')); document.fonts.dispatchEvent(new Event('loadingdone')); });
    assert.equal(await tip.isVisible(), false, 'hidden tooltip is not revived');
  }));

test('tooltip hides the weekday before the status and keeps the full accessible description', () =>
  withPage(T1412, async (page) => {
    await page.setViewportSize({ width: 1093, height: 535 });
    await page.addStyleTag({ content: '.day-tooltip .tip-title .u:last-child { width: 200px; }' });
    const day = page.locator('.cal-grid button[data-key="2026-11-03"]');
    await day.focus();
    const tip = page.locator('.day-tooltip');
    assert.equal(await tip.locator('.tip-title .u').last().isVisible(), false, 'weekday is hidden to make room');
    assert.equal(await tip.locator('.tip-status').isVisible(), true);
    assert.equal(await tip.locator('.pay-amt').isVisible(), true);
    const description = await day.getAttribute('aria-describedby');
    const full = await page.locator(`#${description}`).textContent();
    assert.match(full, /周二/);
    assert.match(full, /工作日/);
  }));

test('single-column settings shows a bottom fade until scrolled to the end', () =>
  withPage(T1412, async (page) => {
    await page.setViewportSize({ width: 1093, height: 535 });
    await tab(page, /设置/).click();
    const settings = page.locator('.settings');
    const fade = () => page.locator('.tabpanel-settings').evaluate((el) => getComputedStyle(el, '::after').content);
    assert.notEqual(await fade(), 'none', 'scrollable content has a visible fade');
    await settings.evaluate((el) => { el.scrollTop = el.scrollHeight; });
    await page.waitForFunction(() => !document.querySelector('.settings').classList.contains('is-cut'));
    assert.equal(await fade(), 'none', 'fade disappears at the bottom');
    await settings.evaluate((el) => { el.scrollTop = 0; });
    await page.waitForFunction(() => document.querySelector('.settings').classList.contains('is-cut'));
    assert.notEqual(await fade(), 'none', 'fade returns when scrolling up');
  }));

test('settings fade tracks changes in viewport height', () =>
  withPage(T1412, async (page) => {
    await page.setViewportSize({ width: 1093, height: 2000 });
    await tab(page, /设置/).click();
    const settings = page.locator('.settings');
    assert.equal(await settings.evaluate((el) => el.classList.contains('is-cut')), false);
    await page.setViewportSize({ width: 1093, height: 900 });
    await page.waitForTimeout(250);
    assert.equal(await settings.evaluate((el) => el.classList.contains('is-cut')), true, 'fade appears when the panel becomes scrollable');
  }));

test('settings input focus outline does not cross the encouragement hint', () =>
  withPage(T1412, async (page) => {
    await page.setViewportSize({ width: 1093, height: 535 });
    await tab(page, /设置/).click();
    await page.locator('#f-cheer').focus();
    const gap = await page.evaluate(() => {
      const input = document.querySelector('#f-cheer');
      const hint = document.querySelector('#hint-cheer');
      const style = getComputedStyle(input);
      return hint.getBoundingClientRect().top - input.getBoundingClientRect().bottom -
        parseFloat(style.outlineOffset) - parseFloat(style.outlineWidth);
    });
    assert.ok(gap >= 0, `focus outline must not overlap the hint (gap ${gap}px)`);
  }));
