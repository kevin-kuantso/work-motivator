// 地区（臺灣 / 中國大陸）行为：一次切换整组语言、币别、月薪与月历标记。
// 只透过真实 UI 契约断言（设定面板、状态卡、月历、读屏摘要、localStorage 结构）；
// 网络一律由 harness 中止（两个地区在 2026-11 / 2027 都有内建年表，开页不会发任何外部请求）。
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, launch, openAt, holidayIdle } from './harness.mjs';

const T1412 = '2026-11-03T14:12:00+08:00';
const SETTINGS_KEY = 'work-motivator-v1';
const TW_HOLIDAYS_KEY = 'work-motivator-v1-holidays-TW';
const card = '#status-card';

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

// ---------------------------------------------------------------------------
// 小工具（和 main.spec 同构：页面计时器被 page.clock 接管，不能用 waitForFunction）
const text = (page, sel) => page.locator(sel).first().textContent().then((s) => (s ?? '').trim());
const value = (page, sel) => page.locator(sel).first().inputValue();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function until(page, sel, expected, ms = 3000) {
  let last;
  for (const end = Date.now() + ms; Date.now() < end;) {
    last = await page.locator(sel).first().textContent();
    if (last === expected) return;
    await sleep(50);
  }
  assert.fail(`${sel}: expected ${JSON.stringify(expected)}, last ${JSON.stringify(last)}`);
}

async function untilValue(page, sel, expected, ms = 3000) {
  let last;
  for (const end = Date.now() + ms; Date.now() < end;) {
    last = await page.locator(sel).first().inputValue();
    if (last === expected) return;
    await sleep(50);
  }
  assert.fail(`${sel} value: expected ${JSON.stringify(expected)}, last ${JSON.stringify(last)}`);
}

async function untilChecked(page, selector, expected) {
  for (const end = Date.now() + 5000; Date.now() < end;) {
    if (await page.locator(selector).isChecked() === expected) return;
    await sleep(50);
  }
  assert.fail(`${selector}: expected checked=${expected}`);
}

async function untilMatch(page, sel, re, ms = 3000) {
  let last;
  for (const end = Date.now() + ms; Date.now() < end;) {
    last = await page.locator(sel).first().textContent();
    if (re.test(last ?? '')) return last;
    await sleep(50);
  }
  assert.fail(`${sel}: ${re} not found in ${JSON.stringify(last)}`);
}

// 金额：货币符号与分隔符由 profile 决定，这里断言「符号正确 + 数值正确」。
async function amount(page, sel) {
  const raw = await text(page, sel);
  const n = Number(raw.replace(/[^\d.-]/g, ''));
  assert.ok(Number.isFinite(n), `amount not numeric: ${JSON.stringify(raw)}`);
  return { raw, n };
}

// 每次切区都会推进 1.2 秒计时器（让 ticker 重算卡片），已赚金额因此有 0.1 上下的漂移；
// 断言「同一量级、没做汇率换算」，不是逐位相等。
const near = (got, want, what) => assert.ok(Math.abs(got - want) < 1, `${what}: got ${got}, want ≈${want}`);

// 开页、跑断言、并确认没有额外外部请求 / 未捕获错误。
async function withPage(iso, fn, opts) {
  const { context, page, errors, external, consoleErrors } = await openAt(browser, server.url, iso, opts);
  try {
    await fn(page);
    assert.deepEqual(errors.map(String), [], 'no uncaught page errors');
    assert.deepEqual(consoleErrors, [], 'no console errors');
    assert.deepEqual(external, [], 'network is blocked: no external request (both regions have builtin tables)');
  } finally {
    await context.close();
  }
}

// 分页：基本设置 / 月历（两地文字不同，用正则同时匹配）
const settingsTab = (page) => page.getByRole('tab', { name: /^(基本设置|基本設定)$/ });
const calendarTab = (page) => page.getByRole('tab', { name: /^(月曆|月历)$/ });
const openSettings = (page) => settingsTab(page).click();
const openCalendar = (page) => calendarTab(page).click();
const activeTab = (page) => page.evaluate(() => document.querySelector('[role="tab"][aria-selected="true"]')?.getAttribute('aria-controls') ?? null);

const live = '#app > div.visually-hidden[role="status"]';
const readSettings = (page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || 'null'), SETTINGS_KEY);

// 地区切换：select 的 change 会走父层 commit → applyProfile → applyState（面板唯一的同步入口）。
// 时钟是暂停的，切完要推进一秒让 ticker 重算卡片与读屏摘要。
async function setRegion(page, id) {
  await page.locator('#f-region').selectOption(id);
  await untilValue(page, '#f-region', id);
  await page.clock.runFor(1200);
}

// 日期格用 data-key（YYYY-MM-DD）定位：与语言无关，也不解析 aria-label。
const dayCell = (page, key) => page.locator(`.cal-grid button[data-key="${key}"]`);

// 月历标题两种语言都是「2026 年 12 月」的形状；用它算出当前显示的月份。
async function shownMonth(page) {
  const title = await text(page, '#cal-title');
  const m = /(\d{4})\s*年\s*(\d{1,2})\s*月/.exec(title);
  assert.ok(m, `calendar title not parsed: ${JSON.stringify(title)}`);
  return { y: Number(m[1]), m: Number(m[2]) };
}

// 翻到指定月份（两个分页的「今天」可能不同，所以不依赖月份按钮次数）。
async function showMonth(page, y, m) {
  for (let i = 0; i < 48; i++) {
    const cur = await shownMonth(page);
    const diff = y * 12 + m - (cur.y * 12 + cur.m);
    if (diff === 0) return;
    await page.locator(diff > 0 ? '.cal-next' : '.cal-prev').click();
  }
  assert.fail(`cannot reach ${y}-${m} in the calendar`);
}

// 标记某一天：先翻到该日所在月，再点格子选单。
async function markDay(page, key, option) {
  await openCalendar(page);
  await showMonth(page, Number(key.slice(0, 4)), Number(key.slice(5, 7)));
  await dayCell(page, key).click();
  await page.locator(`.day-menu-item[data-option="${option}"]`).click();
}

// 等某一格的 aria-label 出现某段文字（远端 storage 套用后，标记才会出现在这里）。
async function untilAria(page, key, re, ms = 5000) {
  let last;
  for (const end = Date.now() + ms; Date.now() < end;) {
    last = await dayCell(page, key).getAttribute('aria-label');
    if (re.test(last ?? '')) return last;
    await sleep(50);
  }
  assert.fail(`${key} aria-label: ${re} not found in ${JSON.stringify(last)}`);
}

// 跨分页回归：计数器只算本分页自己写设定；远端套用绝不能写回，否则两个分页会互相触发。
const settingsWriteCounter = `(() => {
  window.__settingsWrites = 0;
  const orig = Storage.prototype.setItem;
  Storage.prototype.setItem = function (k, v) {
    if (k === ${JSON.stringify(SETTINGS_KEY)}) window.__settingsWrites += 1;
    return orig.apply(this, arguments);
  };
})();`;
const writes = (page) => page.evaluate(() => window.__settingsWrites);
const resetWrites = (page) => page.evaluate(() => { window.__settingsWrites = 0; });
const focusedId = (page) => page.evaluate(() => document.activeElement?.id ?? '');

// 第二个分页：同一 context ⇒ 共享 localStorage ⇒ storage 事件。它没有装 page.clock，用真实计时器。
async function openSecondTab(context, errors) {
  const other = await context.newPage();
  other.setDefaultTimeout(5000);
  other.on('pageerror', (e) => errors.push(e));
  await other.goto(server.url);
  await openSettings(other);
  return other;
}

// ---------------------------------------------------------------------------
test('Taiwan missing years never request updates and mainland check remains available', async () => {
  const { context, page, external } = await openAt(browser, server.url, '2028-06-06T14:12:00+08:00');
  try {
    await openCalendar(page);
    await showMonth(page, 2028, 10);
    assert.match(await text(page, '.cal-year-tag'), /尚無臺灣政府辦公日曆.*週末與手動標記/);
    const sunday = await dayCell(page, '2028-10-01').getAttribute('aria-label');
    assert.match(sunday, /週末/);
    assert.doesNotMatch(sunday, /國慶/);
    await openSettings(page);
    assert.equal(await page.locator('#btn-holiday-check').isVisible(), false);
    assert.equal(await page.locator('#btn-holiday-import').isVisible(), true);
    await page.waitForTimeout(200);
    assert.deepEqual(external, [], 'missing Taiwan year must not start a network check');
    await setRegion(page, 'CN');
    assert.equal(await page.locator('#btn-holiday-check').isVisible(), true);
    assert.equal(await holidayIdle(page), true);
    await setRegion(page, 'TW');
    const afterCn = external.length;
    await page.waitForTimeout(200);
    assert.equal(external.length, afterCn, 'switching back to Taiwan must not start a network check');
    assert.equal(await page.locator('#btn-holiday-check').isVisible(), false);
  } finally {
    await context.close();
  }
});

test('a fresh profile is Taiwan: zh-TW copy, NT$ 40,000 sample salary, lunch defaulting to off', () =>
  withPage(T1412, async (page) => {
    assert.equal(await page.title(), '上班鼓勵器');
    assert.equal(await page.evaluate(() => document.documentElement.lang), 'zh-TW');
    assert.deepEqual(
      (await page.getByRole('tab').allTextContents()).map((s) => s.trim()),
      ['月曆', '基本設定'],
      'TW tab labels',
    );
    assert.equal(
      await page.locator('[role="tablist"]').first().getAttribute('aria-label'),
      '主要內容',
      'TW tablist label',
    );

    await openSettings(page);
    await untilValue(page, '#f-region', 'TW');
    assert.deepEqual(await page.locator('#f-region option').evaluateAll((els) => els.map((el) => el.value)), ['TW', 'CN']);
    await untilValue(page, '#f-salary', '40000');
    assert.equal(await text(page, '.input-prefix-sign'), 'NT$');
    assert.equal(await text(page, '#err-salary'), '', 'sample salary must validate');
    // 午休预设：关闭，但时段已预填 12:00–13:00，且关闭时仍计入工时
    assert.equal(await page.locator('#f-lunchOn').isChecked(), false);
    await untilValue(page, '#f-lunchStart', '12:00');
    await untilValue(page, '#f-lunchEnd', '13:00');
    const hint = await text(page, '#hint-lunchOn');
    assert.match(hint, /午休/, 'TW lunch hint is localised');

    // 状态卡：TW 40,000 / 21 个工作日 = 日薪 1,904.76，14:12 已赚 1,277.3109
    await untilMatch(page, `${card} .card-amount`, /NT\$\s*1,?277\.31/);
    const earned = await amount(page, `${card} .card-amount`);
    near(earned.n, 1277.3109, 'TW earned');
    assert.equal(await text(page, `${card} .card-badge`), '上班中');
    near((await amount(page, `${card} .metric-daily .metric-value`)).n, 1904.76, 'TW daily');
    const summary = await text(page, '.cal-summary-text');
    assert.match(summary, /21/, 'TW calendar summary counts 21 workdays');
    assert.match(summary, /NT\$1,904\.76/, 'TW calendar summary uses NT$');

    // 读屏即时摘要（role=status live region）也是繁中
    await untilMatch(page, live, /^上班中，今天已賺 1277 元$/);

    // ---- 切到中国大陆：整组文案、币别与月薪一起换 ----
    await setRegion(page, 'CN');
    assert.deepEqual(await page.locator('#f-region option').evaluateAll((els) => els.map((el) => el.value)), ['CN', 'TW']);
    assert.equal(await page.title(), '上班鼓励器');
    assert.equal(await page.evaluate(() => document.documentElement.lang), 'zh-CN');
    assert.deepEqual(
      (await page.getByRole('tab').allTextContents()).map((s) => s.trim()),
      ['月历', '基本设置'],
      'CN tab labels',
    );
    assert.equal(
      await page.locator('[role="tablist"]').first().getAttribute('aria-label'),
      '主要内容',
      'CN tablist label',
    );
    await untilValue(page, '#f-salary', '5000');
    assert.equal(await text(page, '.input-prefix-sign'), '¥');
    await untilMatch(page, live, /^上班中，今天已赚 159 元$/, 3000);
    const cnEarned = await amount(page, `${card} .card-amount`);
    assert.match(cnEarned.raw, /^¥/, 'CN currency symbol');
    near(cnEarned.n, 159.6639, 'CN earned');
    near((await amount(page, `${card} .metric-daily .metric-value`)).n, 238.10, 'CN daily');

    // ---- 切回台湾：月薪与文案回到 TW 自己的值（不做汇率换算） ----
    await setRegion(page, 'TW');
    assert.deepEqual(await page.locator('#f-region option').evaluateAll((els) => els.map((el) => el.value)), ['TW', 'CN']);
    assert.equal(await page.title(), '上班鼓勵器');
    await untilValue(page, '#f-salary', '40000');
    assert.equal(await text(page, '.input-prefix-sign'), 'NT$');
    await untilMatch(page, live, /^上班中，今天已賺 1277 元$/);
    near((await amount(page, `${card} .card-amount`)).n, 1277.3109, 'TW earned after round trip');

    const s = await readSettings(page);
    assert.equal(s.version, 4);
    assert.equal(s.region, 'TW');
    assert.deepEqual(s.salaries, { TW: 40000, CN: 5000 }, 'both region salaries persisted, no conversion');
  }));

test('region switch keeps per-region salary and marks apart while shared preferences stay shared', () =>
  withPage(T1412, async (page) => {
    // TW：改月薪、主题、上班时间（后两者是共享偏好），并在 11/5 手动标记有薪假
    await openSettings(page);
    await page.locator('#f-salary').fill('45000');
    await untilValue(page, '#f-salary', '45000');
    await page.locator('#f-theme').selectOption('blue');
    await page.locator('#f-start').fill('09:15');
    await untilValue(page, '#f-start', '09:15');
    await markDay(page, '2026-11-05', 'paidLeave');
    assert.equal(await page.locator('.cal-undo').getAttribute('aria-disabled'), 'false', 'TW local mark enables undo');

    // 月历视图：翻到 12 月，检查切区后不被重置
    await openCalendar(page);
    await page.locator('.cal-next').click();
    const twDecember = await text(page, '#cal-title');
    assert.match(twDecember, /12/, 'calendar moved to December');
    assert.equal(await activeTab(page), 'panel-calendar');

    // TW → CN：月薪换成 CN 自己的值，共享偏好不动，TW 标记不外流
    await openSettings(page);
    await setRegion(page, 'CN');
    await untilValue(page, '#f-salary', '5000');
    await untilValue(page, '#f-start', '09:15');
    assert.equal(await value(page, '#f-theme'), 'blue', 'theme is a shared preference');
    assert.equal(await page.locator('.cal-undo').getAttribute('aria-disabled'), 'true', 'region switch drops the TW undo');
    assert.match(await text(page, '#cal-title'), /12/, 'calendar month survives the region switch');

    // CN：改月薪并标记 11/6 无薪假（同日 TW 的标记不影响这里）
    await page.locator('#f-salary').fill('6100');
    await untilValue(page, '#f-salary', '6100');
    await markDay(page, '2026-11-06', 'unpaidLeave');
    // 标记会把月历带回 11 月；再翻回 12 月，稍后比对 TW 的月份标题
    await page.locator('.cal-next').click();
    assert.match(await text(page, '#cal-title'), /12/, 'back to December after marking');

    let s = await readSettings(page);
    assert.equal(s.region, 'CN');
    assert.equal(s.salaries.TW, 45000, 'TW salary kept while CN is active');
    assert.equal(s.salaries.CN, 6100, 'CN salary saved');
    assert.deepEqual(s.marksByRegion.TW, { '2026-11-05': 'paidLeave' });
    assert.deepEqual(s.marksByRegion.CN, { '2026-11-06': 'unpaidLeave' });
    assert.equal(s.start, '09:15');
    assert.equal(s.theme, 'blue');

    // CN → TW：TW 的月薪与标记回来，CN 的留在 CN
    await openSettings(page);
    await setRegion(page, 'TW');
    await untilValue(page, '#f-salary', '45000');
    assert.equal(await text(page, '.input-prefix-sign'), 'NT$');
    await untilValue(page, '#f-start', '09:15');
    assert.equal(await text(page, '#cal-title'), twDecember, 'TW December title restored verbatim');
    assert.equal(await page.locator('.cal-undo').getAttribute('aria-disabled'), 'true', 'stale CN undo is not reused in TW');

    s = await readSettings(page);
    assert.equal(s.region, 'TW');
    assert.equal(s.salaries.TW, 45000);
    assert.equal(s.salaries.CN, 6100);
    assert.deepEqual(s.marksByRegion.TW, { '2026-11-05': 'paidLeave' });
    assert.deepEqual(s.marksByRegion.CN, { '2026-11-06': 'unpaidLeave' });
  }));

test('an unsent, invalid input keeps its raw value and focus while its error is retranslated', () =>
  withPage(T1412, async (page) => {
    await openSettings(page);
    const long = 'x'.repeat(41);
    await page.locator('#f-cheer').fill(long);
    await until(page, '#err-cheer', '鼓勵語不能超過 40 個字');
    assert.equal(await page.locator('#f-cheer').getAttribute('aria-invalid'), 'true');

    // 焦点在地区选择上时切区：不能清掉正在输入/无效的值，也不能移动焦点
    await page.locator('#f-region').focus();
    await setRegion(page, 'CN');

    assert.equal(await value(page, '#f-cheer'), long, 'uncommitted input value preserved');
    assert.equal(await page.locator('#f-cheer').getAttribute('aria-invalid'), 'true', 'error state preserved');
    await until(page, '#err-cheer', '鼓励语不能超过 40 个字');
    assert.equal(await page.evaluate(() => document.activeElement?.id ?? ''), 'f-region', 'focus is not moved by the region switch');
    // 无效值没有写进储存
    const s = await readSettings(page);
    assert.equal(s.region, 'CN');
    assert.ok(!s.cheers.includes(long), 'invalid cheer was never committed');
    assert.equal(s.salaries.CN, 5000);
  }));

test('cross-tab: one remote commit that switches region also applies the changed shared settings, keeping an unsent draft', async () => {
  let context;
  try {
    const opened = await openAt(browser, server.url, T1412, { init: settingsWriteCounter });
    context = opened.context;
    const page1 = opened.page;
    const { errors, external, consoleErrors } = opened;

    await openSettings(page1);
    const long = 'x'.repeat(41);
    await page1.locator('#f-cheer').fill(long);
    await until(page1, '#err-cheer', '鼓勵語不能超過 40 個字');
    assert.equal(await page1.locator('#f-cheer').getAttribute('aria-invalid'), 'true');

    const page2Errors = [];
    const page2 = await openSecondTab(context, page2Errors);
    await resetWrites(page1);
    // 必须用「一次写入」同时换区并改共享设定：分成两次写，本分页会先按同区收到共享设定的远端更新，
    // 换区那一次即使漏同步共享设定也看不出来 —— 回归就失效了。汇入备份正好是一次 commit。
    const backup = JSON.stringify({
      version: 3, region: 'CN', start: '09:15', theme: 'blue',
      salaries: { TW: 40000, CN: 5000 }, marksByRegion: { TW: {}, CN: {} },
    });
    await page2.locator('input[type=file]:not(#holiday-file)').setInputFiles({ name: 'b.json', mimeType: 'application/json', buffer: Buffer.from(backup) });
    await untilValue(page2, '#f-region', 'CN');

    // 换区后共享设定跟着换：上班时间与主题都要套用，不能只剩月薪被同步
    await untilValue(page1, '#f-region', 'CN', 4000);
    await untilValue(page1, '#f-start', '09:15', 4000);
    await untilValue(page1, '#f-theme', 'blue', 4000);
    await untilValue(page1, '#f-salary', '5000', 4000);
    assert.equal(await page1.title(), '上班鼓励器', '远端换区后整个文件跟着换语言');
    assert.equal(await page1.evaluate(() => document.documentElement.lang), 'zh-CN');
    assert.equal(await text(page1, '.input-prefix-sign'), '¥');
    assert.equal(await page1.evaluate(() => document.documentElement.dataset.theme), 'blue');

    // 没送出的鼓励语连同它的无效状态留在原地，错误按新地区语言重译
    assert.equal(await value(page1, '#f-cheer'), long, '未送出的输入不被远端设定覆盖');
    assert.equal(await page1.locator('#f-cheer').getAttribute('aria-invalid'), 'true');
    await until(page1, '#err-cheer', '鼓励语不能超过 40 个字', 4000);
    assert.equal(await focusedId(page1), 'f-cheer', '远端套用不移动焦点');
    assert.equal(await writes(page1), 0, '远端套用不写回储存（否则两个分页互相触发）');

    const s = await readSettings(page1);
    assert.equal(s.region, 'CN');
    assert.equal(s.start, '09:15');
    assert.equal(s.theme, 'blue');
    assert.ok(!s.cheers.includes(long), '无效的鼓励语从未写进储存');

    assert.deepEqual(page2Errors.map(String), [], 'no uncaught errors in the second tab');
    assert.deepEqual(errors.map(String), [], 'no uncaught errors in the first tab');
    assert.deepEqual(consoleErrors, [], 'no console errors in the first tab');
    assert.deepEqual(external, [], 'no external requests in either region');
  } finally {
    await context?.close();
  }
});

test('cross-tab: visibility switches synchronize without overwriting each other', async () => {
  const { context, page: first, errors, consoleErrors } = await openAt(browser, server.url, T1412, { init: settingsWriteCounter });
  try {
    await openSettings(first);
    const secondErrors = [];
    const second = await openSecondTab(context, secondErrors);
    const progress = '#f-showCardProgress';
    const metrics = '#f-showCardMetrics';
    await first.locator(progress).uncheck();
    await untilChecked(second, progress, false);
    await second.locator(metrics).uncheck();
    await untilChecked(first, metrics, false);
    for (const page of [first, second]) {
      assert.equal(await page.locator(progress).isChecked(), false);
      assert.equal(await page.locator(metrics).isChecked(), false);
      assert.equal(await page.locator('#status-card').getAttribute('data-show-progress'), 'false');
      assert.equal(await page.locator('#status-card').getAttribute('data-show-metrics'), 'false');
    }
    await second.locator(progress).check();
    await untilChecked(first, progress, true);
    assert.equal(await first.locator(metrics).isChecked(), false);
    assert.equal(await first.locator('#status-card').getAttribute('data-show-progress'), 'true');
    assert.deepEqual(errors.map(String), []);
    assert.deepEqual(secondErrors.map(String), []);
    assert.deepEqual(consoleErrors, []);
  } finally {
    await context.close();
  }
});

test('cross-tab: a same-region remote change applies that control and leaves an unsent invalid draft untouched', async () => {
  let context;
  try {
    const opened = await openAt(browser, server.url, T1412, { init: settingsWriteCounter });
    context = opened.context;
    const page1 = opened.page;
    const { errors, external, consoleErrors } = opened;

    await openSettings(page1);
    const long = 'y'.repeat(41);
    await page1.locator('#f-cheer').fill(long);
    await until(page1, '#err-cheer', '鼓勵語不能超過 40 個字');

    const page2Errors = [];
    const page2 = await openSecondTab(context, page2Errors);
    await resetWrites(page1);
    await page2.locator('#f-theme').selectOption('orange');
    await untilValue(page2, '#f-theme', 'orange');

    await untilValue(page1, '#f-theme', 'orange', 4000);
    assert.equal(await page1.evaluate(() => document.documentElement.dataset.theme), 'orange');
    // 同区的远端改动只套用被改的控件：草稿的值、错误与焦点都不该被整批重写
    assert.equal(await value(page1, '#f-cheer'), long, '未送出的输入不被远端设定覆盖');
    assert.equal(await page1.locator('#f-cheer').getAttribute('aria-invalid'), 'true', '错误状态保留');
    assert.equal(await text(page1, '#err-cheer'), '鼓勵語不能超過 40 個字', '地区没变：错误用原地区语言原样保留');
    assert.equal(await focusedId(page1), 'f-cheer', '远端套用不移动焦点');
    assert.equal(await value(page1, '#f-region'), 'TW');
    assert.equal(await value(page1, '#f-salary'), '40000');
    assert.equal(await writes(page1), 0, '远端套用不写回储存（否则两个分页互相触发）');

    const s = await readSettings(page1);
    assert.equal(s.region, 'TW');
    assert.equal(s.theme, 'orange');
    assert.ok(!s.cheers.includes(long), '草稿没有被当成有效值写进储存');

    assert.deepEqual(page2Errors.map(String), [], 'no uncaught errors in the second tab');
    assert.deepEqual(errors.map(String), [], 'no uncaught errors in the first tab');
    assert.deepEqual(consoleErrors, [], 'no console errors in the first tab');
    assert.deepEqual(external, [], 'no external requests in either region');
  } finally {
    await context?.close();
  }
});

test('importing a backup that switches region re-syncs every control and keeps an unsent draft', () =>
  withPage(T1412, async (page) => {
    await openSettings(page);
    const long = 'z'.repeat(41);
    await page.locator('#f-cheer').fill(long);
    await until(page, '#err-cheer', '鼓勵語不能超過 40 個字');

    const backup = JSON.stringify({
      version: 3, region: 'CN', start: '10:00', theme: 'blue',
      salaries: { TW: 40000, CN: 8800 }, marksByRegion: { TW: {}, CN: {} },
    });
    await page.locator('input[type=file]:not(#holiday-file)').setInputFiles({ name: 'v3.json', mimeType: 'application/json', buffer: Buffer.from(backup) });

    // 汇入也换区：地区、月薪、币别、共享设定一次全部套上
    await untilValue(page, '#f-region', 'CN', 4000);
    await untilValue(page, '#f-salary', '8800', 4000);
    await untilValue(page, '#f-start', '10:00', 4000);
    assert.equal(await value(page, '#f-theme'), 'blue');
    assert.equal(await text(page, '.input-prefix-sign'), '¥');
    assert.equal(await page.title(), '上班鼓励器');
    // 全部合法：没有需要报告的行 ⇒ 报告不出现（也就不会把焦点搬到报告标题）
    assert.equal(await page.locator('.import-report').isVisible(), false);

    // 正在输入的内容不被汇入结果吃掉，错误按汇入后的地区语言重译
    assert.equal(await value(page, '#f-cheer'), long, '未送出的输入不被汇入结果覆盖');
    assert.equal(await page.locator('#f-cheer').getAttribute('aria-invalid'), 'true');
    await until(page, '#err-cheer', '鼓励语不能超过 40 个字', 4000);

    const s = await readSettings(page);
    assert.equal(s.region, 'CN');
    assert.equal(s.start, '10:00');
    assert.equal(s.theme, 'blue');
    assert.deepEqual(s.salaries, { TW: 40000, CN: 8800 });
    assert.ok(!s.cheers.includes(long), '无效的鼓励语没有随汇入写进储存');
  }));

test('cross-tab: another tab switches region and marks days without a write-back loop, invalidating undo', async () => {
  let context;
  let page1;
  try {
    const opened = await openAt(browser, server.url, T1412, { init: settingsWriteCounter });
    context = opened.context;
    page1 = opened.page;
    const { errors, external, consoleErrors } = opened;

    await openSettings(page1);
    await page1.locator('#f-salary').fill('45000');
    await untilValue(page1, '#f-salary', '45000');
    // 本分页停在月历的 12 月，远端改区不能把这个视图冲掉
    await openCalendar(page1);
    await page1.locator('.cal-next').click();
    assert.equal(await activeTab(page1), 'panel-calendar');
    const tabBefore = await activeTab(page1);

    // 第二个分页：同一 context ⇒ 共享 localStorage ⇒ storage 事件
    const page2 = await context.newPage();
    page2.setDefaultTimeout(5000);
    const page2Errors = [];
    page2.on('pageerror', (e) => page2Errors.push(e));
    await page2.goto(server.url);
    await openSettings(page2);

    // 远端把地区改成中国：本分页跟着换语言、月薪，且不写回储存
    await page1.evaluate(() => { window.__settingsWrites = 0; });
    await page2.locator('#f-region').selectOption('CN');
    await untilValue(page2, '#f-region', 'CN');
    await untilValue(page1, '#f-region', 'CN', 4000);
    assert.equal(await page1.title(), '上班鼓励器', 'remote region change retranslates the document');
    await untilValue(page1, '#f-salary', '5000', 4000);
    await untilMatch(page1, live, /今天已赚 159 元/, 4000);
    assert.equal(await activeTab(page1), tabBefore, 'remote apply keeps the current tab');
    assert.match(await text(page1, '#cal-title'), /12/, 'remote apply keeps the calendar month');
    assert.equal(await page1.evaluate(() => window.__settingsWrites), 0, 'remote apply must not write storage back (no loop)');

    // 本分页在 CN 标记 11/5 → undo 可用；远端再改标记 → 前提变了，undo 作废
    await markDay(page1, '2026-11-05', 'paidLeave');
    assert.equal(await page1.locator('.cal-undo').getAttribute('aria-disabled'), 'false', 'local mark enables undo');
    await page1.evaluate(() => { window.__settingsWrites = 0; });

    // 第二个分页必须先看到 11/5 的标记再写 11/6：否则它可能用切区时的旧快照把 11/5 覆盖掉
    await openCalendar(page2);
    await showMonth(page2, 2026, 11);
    await untilAria(page2, '2026-11-05', /带薪假|已手动标记/, 5000);

    await markDay(page2, '2026-11-06', 'unpaidLeave');
    await untilAria(page1, '2026-11-06', /无薪假|已手动标记/, 5000);
    let disabled;
    for (const end = Date.now() + 4000; Date.now() < end;) {
      disabled = await page1.locator('.cal-undo').getAttribute('aria-disabled');
      if (disabled === 'true') break;
      await sleep(50);
    }
    assert.equal(disabled, 'true', 'remote mark change invalidates the local undo');
    assert.equal(await page1.evaluate(() => window.__settingsWrites), 0, 'still no write-back after remote marks');

    const s = await readSettings(page1);
    assert.equal(s.region, 'CN');
    assert.deepEqual(s.marksByRegion.CN, { '2026-11-05': 'paidLeave', '2026-11-06': 'unpaidLeave' });
    assert.equal(s.salaries.TW, 45000, 'TW salary untouched by the CN tab');

    assert.deepEqual(page2Errors.map(String), [], 'no uncaught errors in the second tab');
    assert.deepEqual(errors.map(String), [], 'no uncaught errors in the first tab');
    assert.deepEqual(consoleErrors, [], 'no console errors in the first tab');
    assert.deepEqual(external, [], 'no external requests in either region');
  } finally {
    await context?.close();
  }
});

test('a malformed UTF-8 Taiwan CSV is rejected and leaves the stored Taiwan table untouched', () =>
  withPage(T1412, async (page) => {
    const before = await page.evaluate((k) => localStorage.getItem(k), TW_HOLIDAYS_KEY);
    await openSettings(page);
    // 0xE4 0xB8 0x41：截断的 3 字节序列 ⇒ 严格 UTF-8 解码失败 ⇒ 读取即判失败
    await page.locator('#holiday-file').setInputFiles({
      name: 'tw.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from([0xe4, 0xb8, 0x41]),
    });
    const result = await (async () => {
      let last = null;
      for (const end = Date.now() + 4000; Date.now() < end;) {
        last = await page.evaluate(() => {
          const el = document.getElementById('holiday-result');
          return el ? { hidden: Boolean(el.hidden), text: el.textContent || '' } : null;
        });
        if (last && last.hidden === false) return last;
        await sleep(50);
      }
      assert.fail(`holiday result never shown, last ${JSON.stringify(last)}`);
    })();
    assert.match(result.text, /未匯入/, `rejection is announced: ${result.text}`);
    assert.match(result.text, /檔案無法讀取/, 'reason names the unreadable/UTF-8 problem');

    const after = await page.evaluate((k) => localStorage.getItem(k), TW_HOLIDAYS_KEY);
    assert.equal(after, before, 'Taiwan holiday store is byte-identical after a rejected import');
    // 月历与状态卡仍按内建 TW 年表计算（2026-11-05 是普通工作日，不是假日）
    await untilMatch(page, `${card} .card-amount`, /NT\$/, 3000);
  }));
