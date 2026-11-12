// 月历小菜单与悬停提示（spec §12.1 / §12.2 / §12.5）。
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, launch, openAt, expectedAutoUrls, tipVisibleLines } from './harness.mjs';

const T1412 = '2026-11-03T14:12:00+08:00';

// 本文件断言的是中国地区文案与年表：明确写入旧版（v1，无地区）设置，让应用走「旧数据一律归中国」的迁移路径，
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
const TRAD = [...'設開時賺鐘勵週與請計錢進導電連線標題資儲歷這個們為麼來還說後點選擇關閉復讀寫據節農區塊網頁顯匯則數單項錯誤會發現狀態間預覽灣準備載檔記號啟離階動處無帶變當'];
const TW_TERMS = ['预设', '进阶', '有薪假', '使用者', '选单', '滑鼠', '萤幕', '点选', '自订', '未套用'];

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
  const { context, page, errors, external, consoleErrors, autoUrls } = await openAt(browser, server.url, iso, { ...opts, init: seeded(opts?.init) });
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

// 提示新增「农历」行（日期之后、状态之前）。可见行里把它单独拆出来，其余行仍与原来的断言逐字比对；
// 放不下时整行不显示（完整农历始终在 aria-describedby 里），所以只在它出现时才检查。
const LUNAR_LINE = /^农历/;
const splitLunar = (lines) => ({ base: lines.filter((l) => !LUNAR_LINE.test(l)), lunar: lines.find((l) => LUNAR_LINE.test(l)), lunarAt: lines.findIndex((l) => LUNAR_LINE.test(l)) });

const card = '#status-card';
const text = (page, sel) => page.locator(sel).first().textContent().then((s) => (s ?? '').trim());
const cell = (page, label) => page.locator(`.cal-grid button[aria-label^="${label} "]`);
const menu = (page) => page.locator('.day-menu');
const item = (page, name) => page.getByRole('menuitemradio', { name });
const focused = (page) => page.evaluate(() => {
  const a = document.activeElement;
  return { key: a?.dataset?.key ?? null, role: a?.getAttribute('role') ?? null, text: (a?.textContent ?? '').trim() };
});
const daily = (page) => text(page, `${card} .metric-daily .metric-value`);
const tooltip = (page) => page.locator('.day-tooltip');

function assertMainland(s, where) {
  const hits = TRAD.filter((c) => s.includes(c));
  assert.deepEqual(hits, [], `Traditional characters in ${where}: ${hits.join('')}`);
  const terms = TW_TERMS.filter((w) => s.includes(w));
  assert.deepEqual(terms, [], `non-mainland terms in ${where}`);
}

async function openMenu(page, label) {
  await cell(page, label).click();
  await menu(page).waitFor({ state: 'visible' });
}

test('click opens a menu with header, options and footer; keyboard moves; Esc returns focus to the cell', () =>
  withPage(T1412, async (page) => {
    const sat = cell(page, '11月7日');
    assert.equal(await sat.getAttribute('aria-haspopup'), 'menu');
    assert.match(await sat.getAttribute('aria-label'), /按回车打开菜单$/);
    assert.equal(await menu(page).isVisible(), false, 'no menu before click');
    await openMenu(page, '11月7日');
    assert.equal(await sat.getAttribute('aria-expanded'), 'true');
    assert.equal(await text(page, '.day-menu-header'), '11月7日 周六 · 休息日');
    assert.equal(await page.getByRole('menu').getAttribute('aria-labelledby'), await page.locator('.day-menu-header').getAttribute('id'));
    const items = page.getByRole('menuitemradio');
    assert.equal(await items.count(), 2);
    assert.match(await items.nth(0).textContent(), /恢复为休息日/);
    assert.equal(await items.nth(0).getAttribute('aria-checked'), 'true');
    assert.match(await items.nth(1).textContent(), /改为上班.*日薪 ¥323\.81 → ¥309\.09/);
    assert.equal(await items.nth(1).getAttribute('aria-checked'), 'false');
    assert.equal(await text(page, '.day-menu-footer'), '月薪固定，按当月上班天数平分');
    // 焦点在当前选中项；方向键 / Home / End
    assert.match((await focused(page)).text, /^恢复为休息日/);
    await page.keyboard.press('ArrowDown');
    assert.match((await focused(page)).text, /^改为上班/);
    await page.keyboard.press('ArrowDown');
    assert.match((await focused(page)).text, /^恢复为休息日/, 'wraps');
    await page.keyboard.press('ArrowUp');
    assert.match((await focused(page)).text, /^改为上班/);
    await page.keyboard.press('Home');
    assert.match((await focused(page)).text, /^恢复为休息日/);
    await page.keyboard.press('End');
    assert.match((await focused(page)).text, /^改为上班/);
    await page.keyboard.press('Escape');
    assert.equal(await menu(page).isVisible(), false);
    assert.equal((await focused(page)).key, '2026-11-07', 'focus back on the cell');
    assert.equal(await sat.getAttribute('aria-expanded'), 'false');
    // Enter 打开，Tab 关闭并回到格子
    await page.keyboard.press('Enter');
    assert.equal(await menu(page).isVisible(), true);
    assert.equal((await focused(page)).role, 'menuitemradio');
    await page.keyboard.press('Tab');
    assert.equal(await menu(page).isVisible(), false);
    assert.equal((await focused(page)).key, '2026-11-07');
    // Space 打开，选「改为上班」用 Enter 套用
    await page.keyboard.press(' ');
    assert.equal(await menu(page).isVisible(), true);
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    assert.equal(await menu(page).isVisible(), false);
    assert.equal(await daily(page), '¥309.09');
    assert.equal((await focused(page)).key, '2026-11-07', 'focus back on the cell after applying');
  }));

test('calendar undo remains available after the toast expires and reverses only the latest change', () =>
  withPage(T1412, async (page) => {
    const undo = page.locator('.cal-undo');
    assert.equal(await undo.getAttribute('aria-disabled'), 'true');
    await openMenu(page, '11月2日');
    await page.locator('.day-menu-item[data-option="paidLeave"]').click();
    await openMenu(page, '11月3日');
    await page.locator('.day-menu-item[data-option="unpaidLeave"]').click();
    await page.clock.runFor(5100);
    assert.equal(await page.locator('.toast').isVisible(), false);
    await undo.click();
    assert.match(await cell(page, '11月2日').getAttribute('aria-label'), /带薪假/);
    assert.doesNotMatch(await cell(page, '11月3日').getAttribute('aria-label'), /无薪假/);
    await undo.click();
    assert.doesNotMatch(await cell(page, '11月2日').getAttribute('aria-label'), /带薪假/);
    assert.equal(await undo.getAttribute('aria-disabled'), 'true');
  }));

test('click outside closes; clicking the same cell toggles; only one menu at a time', () =>
  withPage(T1412, async (page) => {
    await openMenu(page, '11月7日');
    await page.locator('.cal-summary-text').click();
    assert.equal(await menu(page).isVisible(), false, 'click outside closes');
    await openMenu(page, '11月7日');
    await cell(page, '11月7日').click();
    assert.equal(await menu(page).isVisible(), false, 'second click on the same cell closes');
    await openMenu(page, '11月7日');
    await openMenu(page, '11月2日'); // 不被 11/7 的菜单盖住的格子
    assert.equal(await page.locator('.day-menu:visible').count(), 1);
    assert.equal(await text(page, '.day-menu-header'), '11月2日 周一 · 工作日');
    assert.equal(await cell(page, '11月7日').getAttribute('aria-expanded'), 'false');
    // 切换月份时菜单关闭
    await page.getByRole('button', { name: /下月/ }).click();
    assert.equal(await menu(page).isVisible(), false);
  }));

test('Saturday 11/7 → 改为上班: daily wage 309.09, manual dot, undo, survives reload, reopened menu shows current', () =>
  withPage(T1412, async (page) => {
    assert.equal(await daily(page), '¥323.81');
    await openMenu(page, '11月7日');
    await item(page, /改为上班/).click();
    assert.equal(await menu(page).isVisible(), false);
    assert.equal(await daily(page), '¥309.09');
    assert.match(await cell(page, '11月7日').getAttribute('aria-label'), /调休上班.*已手动标记/);
    assert.equal(await cell(page, '11月7日').locator('.day-dot').count(), 1);
    assert.match(await text(page, '.toast-text'), /11\/7 已标记为调休上班/);
    await page.getByRole('button', { name: '撤销', exact: true }).click();
    assert.equal(await daily(page), '¥323.81');
    assert.equal(await cell(page, '11月7日').locator('.day-dot').count(), 0);
    assert.match(await cell(page, '11月7日').getAttribute('aria-label'), /周末/);
    await openMenu(page, '11月7日');
    await item(page, /改为上班/).click();
    await page.reload();
    assert.equal(await daily(page), '¥309.09', 'persisted');
    await openMenu(page, '11月7日');
    assert.equal(await text(page, '.day-menu-header'), '11月7日 周六 · 调休上班');
    assert.equal(await item(page, /改为上班/).getAttribute('aria-checked'), 'true');
    assert.doesNotMatch(await item(page, /改为上班/).textContent(), /当前/);
    assert.match(await item(page, /恢复为休息日/).textContent(), /日薪 ¥309\.09 → ¥323\.81/);
    await item(page, /恢复为休息日/).click();
    assert.equal(await daily(page), '¥323.81');
    assert.match(await text(page, '.toast-text'), /11\/7 已恢复默认/);
    assert.equal(await page.getByRole('button', { name: '重置本月标记' }).isVisible(), false);
  }));

test('weekday → 改为休息 gives 340.00; leave options keep 323.81; today leave updates the card', () =>
  withPage(T1412, async (page) => {
    await openMenu(page, '11月4日');
    assert.match(await item(page, /改为休息/).textContent(), /月薪不变，每天 ¥323\.81 → ¥340\.00/);
    assert.match(await item(page, /^带薪假/).textContent(), /照常计薪/);
    assert.match(await item(page, /^无薪假/).textContent(), /这天不计薪（本月少 ¥323\.81）/);
    await item(page, /改为休息/).click();
    assert.equal(await daily(page), '¥340.00');
    assert.match(await cell(page, '11月4日').getAttribute('aria-label'), /休息日.*已手动标记/);
    assert.equal(await page.getByRole('button', { name: '重置本月标记' }).isVisible(), true);
    await page.getByRole('button', { name: '重置本月标记' }).click();
    assert.equal(await daily(page), '¥323.81');
    // 今天：带薪假 → 按全天计薪；无薪假 → 0
    await openMenu(page, '11月3日');
    await item(page, /^带薪假/).click();
    assert.equal(await daily(page), '¥323.81');
    assert.equal(await text(page, `${card} .card-badge`), '带薪假');
    assert.equal(await text(page, `${card} .card-amount`), '¥ 323.81');
    assert.equal(await text(page, `${card} .card-countdown`), '今天按全天计薪');
    assert.match(await text(page, '.toast-text'), /11\/3 已标记为带薪假/);
    await openMenu(page, '11月3日');
    assert.equal(await item(page, /^带薪假/).getAttribute('aria-checked'), 'true');
    await item(page, /^无薪假/).click();
    assert.equal(await text(page, `${card} .card-badge`), '无薪假');
    assert.equal(await page.locator(`${card} .card-amount`).isVisible(), false, 'Task 19 M1: no amount on unpaid leave');
    assert.equal(await daily(page), '¥323.81');
    assert.match(await cell(page, '11月3日').textContent(), /无薪/);
  }));

test('a day with an existing mark shows the options of its DEFAULT type (weekday marked rest)', () =>
  withPage(T1412, async (page) => {
    await openMenu(page, '11月5日');
    await item(page, /改为休息/).click();
    await openMenu(page, '11月5日');
    const items = page.getByRole('menuitemradio');
    assert.deepEqual((await items.allTextContents()).map((s) => s.match(/^(恢复为工作日|改为休息|带薪假|无薪假)/)?.[1]), ['恢复为工作日', '改为休息', '带薪假', '无薪假']);
    assert.equal(await item(page, /改为休息/).getAttribute('aria-checked'), 'true');
    assert.match(await item(page, /^带薪假/).textContent(), /照常计薪/);
    assert.match(await item(page, /^无薪假/).textContent(), /这天不计薪（本月少 ¥323\.81）/);
  }));

test('tooltip: hover after ~400ms, keyboard focus immediately, aria-describedby, hidden while menu open', () =>
  withPage(T1412, async (page) => {
    const sat = cell(page, '11月7日');
    await sat.hover();
    await page.clock.runFor(200);
    assert.equal(await tooltip(page).isVisible(), false, 'not before the hover delay');
    await page.clock.runFor(250);
    assert.equal(await tooltip(page).isVisible(), true);
    const tipText = await tooltip(page).innerText();
    // R35 / 决定 2：盖在格子上；2026-11 是 6 周月份 → 3 行（不显示「来源」），没有「点击修改」
    // Task 18：来源行只在放得下时出现（实测决定），完整文字始终在 aria-describedby
    const lines = await tipVisibleLines(page);
    // 农历行插在日期之后、状态之前；窄格子放不下时整行不显示（aria-describedby 始终有）
    const { base, lunar } = splitLunar(lines);
    assert.deepEqual([base[0], base[1], base.at(-1)], ['11月7日 周六', '休息日', '计薪 ¥0.00']);
    assert.ok(base.length === 3 || (base.length === 4 && base[2] === '按周末规则'), `lines: ${lines}`);
    if (lunar !== undefined) {
      assert.equal(lunar, '农历九月廿九', `lunar line: ${lines}`);
      assert.equal(base.indexOf(lunar), -1);
      assert.equal(lines[1], lunar, 'lunar sits right under the date line');
    }
    assert.doesNotMatch(tipText, /点击修改|来源/);
    assert.equal(await tooltip(page).evaluate((el) => getComputedStyle(el).pointerEvents), 'none');
    assert.equal(await tooltip(page).evaluate((el, b) => el.parentElement === b.parentElement, await sat.elementHandle()), true, 'rendered inside the hovered cell');
    // aria-describedby 内容（屏幕阅读器不用鼠标也拿得到）
    const desc = await sat.evaluate((b) => b.getAttribute('aria-describedby').split(' ').map((id) => document.getElementById(id).textContent).join(' '));
    assert.equal(desc, '11月7日 周六，农历九月廿九，休息日，来源：按周末规则，当日计薪 ¥0.00，点击修改');
    // 移开即隐藏
    await page.locator('.cal-summary-text').hover();
    assert.equal(await tooltip(page).isVisible(), false);
    // 菜单打开时不显示
    await sat.hover();
    await sat.click();
    await page.clock.runFor(600);
    assert.equal(await menu(page).isVisible(), true);
    assert.equal(await tooltip(page).isVisible(), false, 'hidden while menu open');
    await page.keyboard.press('Escape');
    // 键盘聚焦：立即显示
    await page.locator('.cal-summary-text').hover();
    await page.keyboard.press('ArrowLeft');
    assert.equal((await focused(page)).key, '2026-11-06');
    assert.equal(await tooltip(page).isVisible(), true, 'shows immediately on keyboard focus');
    const l6 = await tipVisibleLines(page);
    const l6s = splitLunar(l6);
    assert.deepEqual([l6s.base[0], l6s.base[1], l6s.base.at(-1)], ['11月6日 周五', '工作日', '计薪 ¥323.81']);
    if (l6s.lunar !== undefined) {
      assert.equal(l6s.lunar, '农历九月廿八', `keyboard tooltip lines: ${l6}`);
      assert.equal(l6[1], l6s.lunar, 'lunar sits right under the date line');
    }
    await page.keyboard.press('Escape');
    assert.equal(await tooltip(page).isVisible(), false, 'Esc hides');
    await page.keyboard.press('ArrowLeft');
    assert.equal(await tooltip(page).isVisible(), true);
    await page.locator('.cal-summary-text').click();
    assert.equal(await tooltip(page).isVisible(), false, 'blur hides');
    // 节日、调休上班、带薪假的提示
    await page.getByRole('button', { name: /上月/ }).click();
    assert.match(await cell(page, '10月1日').evaluate((b) => document.getElementById(b.getAttribute('aria-describedby')).textContent), /10月1日 周四，农历八月廿一，法定假日（国庆），来源：内置·官方通知，当日计薪 ¥0\.00/);
    assert.match(await cell(page, '10月10日').evaluate((b) => document.getElementById(b.getAttribute('aria-describedby')).textContent), /10月10日 周六，农历九月初一，调休上班（国庆），来源：内置·官方通知，当日计薪 ¥377\.78/);
    assertMainland(tipText, 'tooltip');
  }));

test('menu is never clipped at the right or bottom edge (last column and last row)', () =>
  withPage(T1412, async (page) => {
    for (const label of ['11月1日', '11月29日', '11月30日', '11月28日']) {
      await openMenu(page, label);
      const r = await page.evaluate(() => {
        const m = document.querySelector('.day-menu').getBoundingClientRect();
        const c = document.querySelector('.calendar').getBoundingClientRect();
        return { m: { l: m.left, t: m.top, r: m.right, b: m.bottom }, c: { l: c.left, t: c.top, r: c.right, b: c.bottom }, vw: document.documentElement.clientWidth, vh: window.innerHeight };
      });
      assert.ok(r.m.r <= Math.min(r.c.r, r.vw) + 0.5, `${label}: right ${r.m.r} within ${Math.min(r.c.r, r.vw)}`);
      assert.ok(r.m.b <= Math.min(r.c.b, r.vh) + 0.5, `${label}: bottom ${r.m.b} within ${Math.min(r.c.b, r.vh)}`);
      assert.ok(r.m.l >= Math.max(r.c.l, 0) - 0.5, `${label}: left inside`);
      assert.ok(r.m.t >= Math.max(r.c.t, 0) - 0.5, `${label}: top inside`);
      // 菜单不盖住被点的格子
      const cb = await cell(page, label).boundingBox();
      const overlapX = Math.min(r.m.r, cb.x + cb.width) - Math.max(r.m.l, cb.x);
      assert.ok(overlapX <= 0.5, `${label}: menu sits beside the cell`);
      await page.keyboard.press('Escape');
    }
  }));

test('no leaked listeners (and no stray hover timer) after opening and closing 20 times', () =>
  withPage(T1412, async (page) => {
    const counts = () => page.evaluate(() => ({ ...window.__listeners }));
    await openMenu(page, '11月7日');
    await page.keyboard.press('Escape');
    const base = await counts();
    await openMenu(page, '11月7日');
    assert.equal((await counts())['doc:pointerdown'], (base['doc:pointerdown'] ?? 0) + 1, 'outside-click listener only while open');
    await page.keyboard.press('Escape');
    assert.deepEqual(await counts(), base);
    for (let i = 0; i < 20; i++) {
      await cell(page, i % 2 ? '11月7日' : '11月4日').hover();
      await openMenu(page, i % 2 ? '11月7日' : '11月4日');
      if (i % 3 === 0) await page.keyboard.press('Escape');
      else if (i % 3 === 1) await page.locator('.cal-summary-text').click();
      else await page.keyboard.press('Tab');
    }
    await page.locator('.cal-summary-text').hover();
    await page.locator('.cal-summary-text').click();
    assert.deepEqual(await counts(), base, 'document/window listener counts stable');
    await page.clock.runFor(1000);
    assert.equal(await tooltip(page).isVisible(), false, 'no pending hover timer fires after leaving');
  }, { init: () => {
    window.__listeners = {};
    for (const target of [Document.prototype, Window.prototype]) {
      const add = target.addEventListener;
      const remove = target.removeEventListener;
      const name = target === Document.prototype ? 'doc' : 'win';
      const seen = new Set();
      target.addEventListener = function (type, fn, opts) {
        const k = `${name}:${type}`;
        const id = fn;
        if (!seen.has(id)) { seen.add(id); window.__listeners[k] = (window.__listeners[k] ?? 0) + 1; }
        return add.call(this, type, fn, opts);
      };
      target.removeEventListener = function (type, fn, opts) {
        const k = `${name}:${type}`;
        if (seen.has(fn)) { seen.delete(fn); window.__listeners[k] -= 1; }
        return remove.call(this, type, fn, opts);
      };
    }
  } }));

test('clock rollover while the menu is open keeps it usable; 2027 days come from the built-in official table (元旦 holiday, 春节 make-up day)', () =>
  withPage('2026-12-31T23:59:58+08:00', async (page) => {
    await openMenu(page, '12月26日');
    await page.clock.runFor(3000);
    assert.equal(await text(page, '.cal-title'), '2027 年 1 月', 'view follows today across the year');
    assert.equal(await menu(page).isVisible(), false, 'menu for a day no longer shown closes');
    const f = await focused(page);
    assert.notEqual(f.key, null, 'focus not lost: it is on a calendar cell');
    // 2027 内置表：1/2（周六）属于元旦连休，不再按周末规则
    await openMenu(page, '1月2日');
    assert.equal(await text(page, '.day-menu-header'), '1月2日 周六 · 法定假日（元旦）');
    assert.equal(await page.getByRole('menuitemradio').count(), 2);
    await page.keyboard.press('Escape');
    await openMenu(page, '1月1日');
    assert.equal(await text(page, '.day-menu-header'), '1月1日 周五 · 法定假日（元旦）', '2027 内置表: 元旦连休的第一天');
    assert.equal(await page.getByRole('menuitemradio').count(), 2);
    await page.keyboard.press('Escape');
    await openMenu(page, '1月4日');
    assert.equal(await text(page, '.day-menu-header'), '1月4日 周一 · 工作日');
    assert.equal(await page.getByRole('menuitemradio').count(), 4);
    await page.keyboard.press('Escape');
    // 1/31（周日）是春节调休上班：这一天算工作日，菜单给 4 项
    await openMenu(page, '1月31日');
    assert.equal(await text(page, '.day-menu-header'), '1月31日 周日 · 调休上班（春节）');
    assert.equal(await page.getByRole('menuitemradio').count(), 4);
    assert.match(await menu(page).innerText(), /恢复为工作日/);
    assertMainland(await menu(page).innerText(), '2027 menu');
  }));

test('R39: 2027 uses the built-in official table (「内置·官方通知」 source, 调休 included); 2028 falls back to 「法定日期（《放假办法》）」 and does not guess', async () => {
  // 2027：内置表——放假与调休都算，来源写「内置·官方通知」
  await withPage('2027-01-04T10:00:00+08:00', async (page) => {
    const desc = (label) => cell(page, label).evaluate((b) => document.getElementById(b.getAttribute('aria-describedby')).textContent);
    assert.equal(await desc('1月1日'), '1月1日 周五，农历冬月廿四，法定假日（元旦），来源：内置·官方通知，当日计薪 ¥0.00，点击修改');
    assert.match(await desc('1月4日'), /工作日，来源：按默认规则，当日计薪 ¥323\.81/);
    assert.match(await desc('1月4日'), /1月4日 周一（今天），农历冬月廿七，工作日，/, 'lunar date is in the accessible description');
    // 1/31（周日）调休上班：仍算工作日，但有节日名与来源
    assert.equal(await desc('1月31日'), '1月31日 周日，农历腊月廿四，调休上班（春节），来源：内置·官方通知，当日计薪 ¥323.81，点击修改');
    await cell(page, '1月1日').hover();
    await page.clock.runFor(450);
    // 2027-01 是 5 周月份：放得下时多一行来源（短写，不带「来源：」）；农历行插在日期之后，
    // 放不下时先让出来源那一行、再整行藏农历 —— 日期 / 状态 / 计薪 必须始终在
    const r39 = splitLunar(await tipVisibleLines(page));
    assert.deepEqual([r39.base[0], r39.base[1], r39.base.at(-1)], ['1月1日 周五', '法定假日·元旦', '计薪 ¥0.00'], `lines: ${JSON.stringify(r39.base)}`);
    assert.ok(r39.base.length === 3 || (r39.base.length === 4 && r39.base[2] === '内置·官方通知'), `lines: ${JSON.stringify(r39.base)}`);
    if (r39.lunar !== undefined) {
      assert.equal(r39.lunar, '农历冬月廿四');
      assert.equal(r39.base.indexOf(r39.lunar), -1);
    }
    await cell(page, '1月31日').hover();
    await page.clock.runFor(450);
    const makeup = splitLunar(await tipVisibleLines(page));
    assert.deepEqual([makeup.base[0], makeup.base[1], makeup.base.at(-1)], ['1月31日 周日', '调休上班·春节', '计薪 ¥323.81'], `lines: ${JSON.stringify(makeup.base)}`);
    assert.ok(makeup.base.length === 3 || (makeup.base.length === 4 && makeup.base[2] === '内置·官方通知'), `lines: ${JSON.stringify(makeup.base)}`);
    if (makeup.lunar !== undefined) assert.equal(makeup.lunar, '农历腊月廿四');
    // 春节：2/5–2/13 放假，2/14（周日）调休上班
    await page.getByRole('button', { name: /下月/ }).click();
    assert.equal(await desc('2月6日'), '2月6日 周六，农历正月初一，法定假日（春节），来源：内置·官方通知，当日计薪 ¥0.00，点击修改');
    assert.equal(await desc('2月14日'), '2月14日 周日，农历正月初九，调休上班（春节），来源：内置·官方通知，当日计薪 ¥453.33，点击修改');
    assert.match(await desc('2月15日'), /工作日，来源：按默认规则，当日计薪 ¥453\.33/);
  });
  // 2028：没有年度表——只标《放假办法》的法定日期，补假 / 调休不猜
  await withPage('2028-01-04T10:00:00+08:00', async (page) => {
    const desc = (label) => cell(page, label).evaluate((b) => document.getElementById(b.getAttribute('aria-describedby')).textContent);
    assert.equal(await desc('1月1日'), '1月1日 周六，农历腊月初五，法定假日（元旦），来源：法定日期（《放假办法》），当日计薪 ¥0.00，点击修改');
    assert.match(await desc('1月4日'), /工作日，来源：按默认规则，当日计薪 ¥400\.00/);
    assert.match(await desc('1月4日'), /1月4日 周二（今天），农历腊月初八，工作日，/, 'lunar date is in the accessible description');
    assert.equal(await desc('1月25日'), '1月25日 周二，农历腊月廿九，法定假日（春节），来源：法定日期（《放假办法》），当日计薪 ¥0.00，点击修改');
    assert.equal(await desc('1月28日'), '1月28日 周五，农历正月初三，法定假日（春节），来源：法定日期（《放假办法》），当日计薪 ¥0.00，点击修改');
    // 1/24 与 1/31 都不猜：普通工作日
    assert.match(await desc('1月24日'), /工作日，来源：按默认规则，当日计薪 ¥400\.00/, 'no invented compensation day');
    assert.match(await desc('1月31日'), /工作日，来源：按默认规则/, 'no invented extended holiday');
    await cell(page, '1月1日').hover();
    await page.clock.runFor(450);
    // 2028-01 是 6 周月份：只保证日期 / 状态 / 计薪 三行，来源与农历行可能被让出
    const r39 = splitLunar(await tipVisibleLines(page));
    assert.deepEqual([r39.base[0], r39.base[1], r39.base.at(-1)], ['1月1日 周六', '法定假日·元旦', '计薪 ¥0.00'], `lines: ${JSON.stringify(r39.base)}`);
    assert.ok(r39.base.length === 3 || (r39.base.length === 4 && r39.base[2] === '《放假办法》'), `lines: ${JSON.stringify(r39.base)}`);
    if (r39.lunar !== undefined) assert.equal(r39.lunar, '农历腊月初五');
  });
});

test('rollover inside the same month refreshes an open menu in place', () =>
  withPage('2026-11-03T23:59:58+08:00', async (page) => {
    await openMenu(page, '11月7日');
    await page.keyboard.press('ArrowDown');
    await page.clock.runFor(3000);
    assert.equal(await menu(page).isVisible(), true);
    assert.equal(await text(page, '.day-menu-header'), '11月7日 周六 · 休息日');
    assert.equal((await focused(page)).role, 'menuitemradio', 'focus stays in the menu');
    assert.match((await focused(page)).text, /^改为上班/);
  }));

test('menu and tooltip text: mainland Simplified only', () =>
  withPage(T1412, async (page) => {
    for (const label of ['11月7日', '11月4日']) {
      await openMenu(page, label);
      assertMainland(await menu(page).innerText(), `menu ${label}`);
      await page.keyboard.press('Escape');
    }
    await page.keyboard.press('ArrowLeft');
    assertMainland(await tooltip(page).innerText(), 'tooltip');
  }));
