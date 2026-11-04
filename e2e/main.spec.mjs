import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { startServer, launch, openAt, root, expectedAutoUrls } from './harness.mjs';

const T1412 = '2026-11-03T14:12:00+08:00';
// 常见繁体字（简体中不存在的字形）+ 台湾用语；成品中一个都不得出现。
const TRAD = [...'設開時賺鐘勵週與請計錢進導電連線標題資儲歷這個們為麼來還說後點選擇關閉復讀寫據節農區塊網頁顯匯則數單項錯誤會發現狀態間預覽灣準備載檔記號啟離階動處無帶'];
const TW_TERMS = ['预设', '进阶', '有薪假', '使用者', '尚未公布', '请改成你的月薪', '字串', '物件', 'JSON 文字', '选单', '滑鼠', '萤幕', '点选', '自订', '未套用'];
// dist 中即使有 \\uXXXX 转义也要还原后再扫描
const decode = (s) => s.replace(/\\u([0-9a-fA-F]{4})/g, (_, x) => String.fromCharCode(parseInt(x, 16)));
const VOID_NUMBERS = ['312.64', '44.66', '187.5862', '500.23', '6,565.52', '5,627.59', '21.75', '0.0124'];

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

const text = (page, sel) => page.locator(sel).first().textContent().then((s) => (s ?? '').trim());
const visible = (page, sel) => page.locator(sel).first().isVisible();
const card = '#status-card';
// 在 node 端轮询（页面的 rAF / setTimeout 都被 page.clock 接管且暂停，不能用 waitForFunction）
async function until(page, sel, expected, ms = 3000) {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) {
    last = await page.locator(sel).first().textContent();
    if (last === expected) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.fail(`${sel}: expected ${expected}, last ${last}`);
}
const bodyText = (page) => page.evaluate(() => document.body.innerText);

function assertNoTraditional(s, where) {
  const hits = TRAD.filter((c) => s.includes(c));
  assert.deepEqual(hits, [], `Traditional characters in ${where}: ${hits.join('')}`);
  const terms = TW_TERMS.filter((w) => s.includes(w));
  assert.deepEqual(terms, [], `non-mainland terms in ${where}: ${terms.join('、')}`);
}

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

// 设置在「基本设置」分页里：先切过去（spec §13.1）
const openSettings = (page) => page.getByRole('tab', { name: '基本设置' }).click();
const errorBar = '.notices .banner-error';
const infoBar = '.notices .banner-info';
const todayCell = (page, label) => page.locator(`.cal-grid button[aria-label^="${label} "]`);

test('fresh storage shows numbers derived from defaults, no setup card, no payday row', () =>
  withPage(T1412, async (page) => {
    assert.equal(await page.title(), '上班鼓励器');
    assert.equal(await text(page, `${card} .card-date`), '2026/11/03 周二');
    assert.equal(await text(page, `${card} .card-badge`), '上班中');
    assert.equal(await text(page, `${card} .card-label`), '今天已经赚了');
    assert.equal(await text(page, `${card} .card-amount`), '¥ 194.2857');
    assert.equal(await text(page, `${card} .metric-rate .metric-value`), '¥0.0128 /秒');
    assert.equal(await text(page, `${card} .metric-rate .metric-label`), '当前赚钱速度');
    assert.equal(await text(page, `${card} .metric-month .metric-value`), '¥518.10');
    assert.equal(await text(page, `${card} .metric-hourly .metric-value`), '¥46.26');
    assert.equal(await text(page, `${card} .metric-daily .metric-value`), '¥323.81');
    assert.equal(await text(page, `${card} .card-progress-text`), '已工作 4.20 / 7.00 小时');
    assert.equal(await text(page, `${card} .card-countdown`), '距下班 2小时48分0秒');
    assert.equal(await page.locator(`${card} [role=progressbar]`).getAttribute('aria-valuenow'), '60');
    assert.equal(await visible(page, `${card} .card-payday`), false, 'payday row hidden when payday empty');
    assert.equal(await visible(page, `${card} .card-cheer`), false, 'cheer row hidden when empty');
    assert.equal(await visible(page, `${card} .card-year`), false, 'no year note in 2026');
    const all = await bodyText(page);
    assert.ok(!all.includes('快速开始'), 'no quick-start card');
    for (const n of VOID_NUMBERS) assert.ok(!all.includes(n), `void ÷21.75 number ${n} must not appear`);
    assert.ok(!all.includes('发薪日：每月 5 号'));
    // 首次提示：可关闭、关闭后记住
    const hint = page.getByText('这是默认值，可在设置里修改');
    assert.equal(await hint.isVisible(), true);
    assert.equal(await page.locator(infoBar).getByRole('button', { name: '去修改' }).isVisible(), true);
    await page.getByRole('button', { name: '关闭提示' }).click();
    assert.equal(await hint.isVisible(), false);
    await page.reload();
    assert.equal(await page.getByText('这是默认值，可在设置里修改').isVisible(), false, 'dismissal remembered');
  }));

test('ticks at 100ms and recomputes on visibilitychange', () =>
  withPage(T1412, async (page) => {
    const before = await text(page, `${card} .card-amount`);
    await page.clock.runFor(1000);
    assert.notEqual(await text(page, `${card} .card-amount`), before, 'amount moves while working');
    await page.clock.pauseAt(new Date('2026-11-03T14:12:01+08:00'));
    await page.clock.setSystemTime(new Date('2026-11-03T14:22:01+08:00'));
    // 时钟暂停：没有计时器触发，只有 visibilitychange 能让数字更新
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    assert.equal(await text(page, `${card} .card-amount`), '¥ 202.0083');
  }));

test('reduced motion: display updates at 1 Hz', () =>
  withPage(T1412, async (page) => {
    const a = await text(page, `${card} .card-amount`);
    await page.clock.runFor(500);
    assert.equal(await text(page, `${card} .card-amount`), a);
    await page.clock.runFor(600);
    assert.notEqual(await text(page, `${card} .card-amount`), a);
  }, { reducedMotion: true }));

// R46：减少动态模式（1 秒一跳）对齐墙上时钟的整秒：每次倒数变化都发生在整秒（Date.now() % 1000 < 20），
// 120 秒内秒数逐一递减，不跳号、不重复。打开时刻故意落在 .600（旧的 setInterval 版本相位 = 载入时刻，不在整秒上）。
test('R46: reduced-motion ticks align to wall-clock seconds; the countdown never skips or repeats over 120 s', () =>
  withPage('2026-11-03T14:12:00.600+08:00', async (page) => {
    const secs = (s) => {
      const m = s.match(/(?:(\d+)小时)?(\d+)分(\d+)秒/);
      return Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]);
    };
    await page.evaluate(() => {
      window.__cd = [];
      const el = document.querySelector('#status-card .card-countdown + .sr-text');
      new MutationObserver(() => window.__cd.push([Date.now(), el.textContent])).observe(el, { childList: true, characterData: true, subtree: true });
    });
    const start = secs(await text(page, `${card} .card-countdown + .sr-text`));
    assert.equal(start, 2 * 3600 + 48 * 60, '14:12:00.6 → ceil(10079.4) = 2:48:00');
    for (let i = 0; i < 24; i++) await page.clock.runFor(5000);
    const cd = await page.evaluate(() => window.__cd);
    const phases = cd.map(([ms]) => ms % 1000);
    const values = cd.map(([, s]) => secs(s));
    console.log(`MEASURE ${JSON.stringify({ case: 'R46 tick alignment', changes: cd.length, phases: [...new Set(phases)], first: values[0], last: values.at(-1) })}`);
    assert.ok(phases.every((p) => p < 20), `every change lands on a second boundary (phases ${[...new Set(phases)]})`);
    assert.equal(cd.length, 120, 'one change per second for 120 s');
    values.forEach((v, i) => assert.equal(v, start - 1 - i, `step ${i}: no skip / no repeat`));
  }, { reducedMotion: true }));

test('payday row appears after setting payday and persists', () =>
  withPage(T1412, async (page) => {
    await openSettings(page);
    // 发薪日 / 周末开关已从高级设置移到「周末与发薪日」组；高级设置折叠，只剩占位
    const adv = page.getByRole('button', { name: /高级设置/ });
    assert.equal(await adv.getAttribute('aria-expanded'), 'false');
    assert.match(await adv.textContent(), /自定义网址：未设置/);
    assert.equal(await page.getByLabel('发薪日').isVisible(), true, 'payday visible without expanding 高级设置');
    assert.equal(await page.getByRole('switch', { name: '周末计入上班日' }).isVisible(), true);
    await page.getByLabel('发薪日').selectOption({ label: '每月 5 号' });
    assert.equal(await text(page, `${card} .card-payday`), '距离发薪日 2 天');
    await page.getByLabel('发薪日').selectOption({ label: '每月 3 号' });
    assert.equal(await text(page, `${card} .card-payday`), '今天发薪');
    await page.reload();
    assert.equal(await text(page, `${card} .card-payday`), '今天发薪');
    await openSettings(page);
    assert.equal(await page.getByLabel('发薪日').inputValue(), '3');
  }));

test('salary edits reflect immediately; invalid input shows error and keeps last valid value', () =>
  withPage(T1412, async (page) => {
    await openSettings(page);
    const salary = page.getByLabel('月薪');
    assert.equal(await salary.inputValue(), '6800', '「¥」is decoration outside the input, not part of the value');
    assert.equal(await page.locator('.input-prefix-sign').textContent(), '¥');
    await salary.fill('7000');
    assert.equal(await text(page, `${card} .metric-daily .metric-value`), '¥333.33');
    assert.equal(await text(page, `${card} .card-amount`), '¥ 200.0000');
    assert.equal(await visible(page, '.autosave'), true, 'autosave indicator shown');
    // 不做任何转换：逗号、全角数字、句号一律拒绝（Kevin 的 no-coercion 规则）
    for (const bad of ['6,800', '６８００', '6800。', '']) {
      await salary.fill(bad);
      assert.equal(await text(page, '#err-salary'), '请输入大于 0 的数字，只用半角数字、不加逗号，例如 6800', `rejects ${JSON.stringify(bad)}`);
      assert.equal(await text(page, `${card} .metric-daily .metric-value`), '¥333.33', `${JSON.stringify(bad)} not salvaged`);
    }
    await salary.fill('0');
    assert.equal(await text(page, '#err-salary'), '请输入大于 0 的数字，只用半角数字、不加逗号，例如 6800');
    assert.equal(await salary.getAttribute('aria-invalid'), 'true');
    assert.equal(await text(page, `${card} .metric-daily .metric-value`), '¥333.33', 'last valid kept');
    await page.getByLabel('下班时间').fill('08:00');
    assert.equal(await text(page, '#err-end'), '下班时间必须晚于上班时间');
    assert.equal(await text(page, `${card} .card-countdown`), '距下班 2小时48分0秒');
    await page.getByLabel('下班时间').fill('18:00');
    assert.equal(await text(page, '#err-end'), '');
    await page.reload();
    await openSettings(page);
    assert.equal(await page.getByLabel('月薪').inputValue(), '7000', 'last valid value saved, not the invalid one');
    assert.equal(await page.getByLabel('下班时间').inputValue(), '18:00');
  }));

test('lunch toggle hides lunch fields; lunch off counts lunch as work time', () =>
  withPage(T1412, async (page) => {
    await openSettings(page);
    const sw = page.getByRole('switch', { name: '午休' });
    assert.equal(await page.getByLabel('午休开始时间').isVisible(), true);
    await sw.click();
    assert.equal(await page.getByLabel('午休开始时间').isVisible(), false);
    assert.equal(await text(page, `${card} .card-progress-text`), '已工作 5.70 / 8.50 小时');
  }));

test('calendar: day menu marks today as paid then unpaid leave; weekend → make-up work; undo', () =>
  withPage(T1412, async (page) => {
    const cell = todayCell(page, '11月3日');
    assert.match(await cell.getAttribute('aria-label'), /今天/);
    const choose = async (label, name) => {
      await todayCell(page, label).click();
      await page.getByRole('menuitemradio', { name }).click();
    };
    await choose('11月3日', /^带薪假/);
    assert.equal(await text(page, `${card} .card-badge`), '带薪假');
    assert.equal(await text(page, `${card} .card-amount`), '¥ 323.8095');
    assert.equal(await text(page, `${card} .card-countdown`), '今天按全天计薪');
    assert.match(await text(page, '.toast-text'), /11\/3 已标记为带薪假/);
    await choose('11月3日', /^无薪假/);
    assert.equal(await text(page, `${card} .card-badge`), '无薪假');
    assert.equal(await text(page, `${card} .card-amount`), '¥ 0.0000');
    assert.equal(await text(page, `${card} .metric-month .metric-value`), '¥323.81');
    assert.match(await todayCell(page, '11月3日').textContent(), /无薪/);
    await page.reload();
    assert.equal(await text(page, `${card} .card-badge`), '无薪假', 'marks persisted');
    await choose('11月3日', /^恢复默认/);
    assert.equal(await text(page, `${card} .card-badge`), '上班中', '恢复默认 returns to default');
    // 休息日：默认 → 调休上班 → 默认
    await choose('11月7日', /改为上班/);
    assert.match(await todayCell(page, '11月7日').getAttribute('aria-label'), /调休上班/);
    await choose('11月7日', /恢复默认/);
    assert.match(await todayCell(page, '11月7日').getAttribute('aria-label'), /周末/);
    // 撤销
    await choose('11月7日', /改为上班/);
    await page.getByRole('button', { name: '撤销' }).click();
    assert.match(await todayCell(page, '11月7日').getAttribute('aria-label'), /周末/);
  }));

test('calendar shows holiday names, legend, and a summary-row tag for years without a built-in table', () =>
  withPage('2026-10-01T10:00:00+08:00', async (page) => {
    assert.equal(await text(page, `${card} .card-badge`), '休息日');
    assert.equal(await text(page, `${card} .card-label`), '今天休息 · 国庆');
    assert.equal(await visible(page, `${card} .card-amount`), false);
    assert.equal(await text(page, `${card} .card-countdown`), '距下个工作日 7 天');
    assert.equal(await text(page, `${card} .metric-rate .metric-value`), '¥0.0000 /秒');
    assert.match(await todayCell(page, '10月1日').textContent(), /假.*国庆|国庆.*假/s);
    assert.match(await todayCell(page, '10月10日').textContent(), /班/);
    assert.match(await todayCell(page, '10月10日').getAttribute('aria-label'), /调休上班/);
    assert.match(await text(page, '.cal-legend'), /图例/);
    assert.equal(await page.getByText('年仅标法定假日').count(), 0);
    await page.getByRole('button', { name: /下月/ }).click();
    await page.getByRole('button', { name: /下月/ }).click();
    await page.getByRole('button', { name: /下月/ }).click();
    assert.equal(await text(page, '.cal-title'), '2027 年 1 月');
    assert.equal(await text(page, '.cal-summary .cal-year-tag'), '2027 年仅标法定假日');
    assertNoTraditional(await bodyText(page), 'rest day + 2027 view');
    await page.getByRole('button', { name: '回到今天' }).click();
    assert.equal(await text(page, '.cal-title'), '2026 年 10 月');
    assert.equal(await visible(page, '.cal-year-tag'), false);
  }));

test('2027 (no built-in holiday table): the status card says so', () =>
  withPage('2027-01-04T10:00:00+08:00', async (page) => {
    assert.equal(await visible(page, `${card} .card-year`), true);
    assert.equal(await text(page, `${card} .card-year`), '2027 年仅标法定假日');
    assert.equal(await page.locator(`${card} .card-year`).getAttribute('title'), '2027 年放假安排未公布：已按《放假办法》标出法定假日本身；补假、调休和延长的假日待公布');
    // R39：1/1 是固定法定假日 → 1 月 20 个工作日、日薪 340.00；10:00 已赚 340 × 5400/25200 = 72.8571
    assert.equal(await text(page, `${card} .card-amount`), '¥ 72.8571');
    assert.equal(await text(page, `${card} .metric-daily .metric-value`), '¥340.00');
    assert.equal(await text(page, `${card} .metric-month .metric-value`), '¥72.86');
    assert.equal(await text(page, '.cal-summary-text'), '本月应出勤 20 天 · 日薪 ¥340.00');
    assert.match(await page.locator('.cal-grid button[data-key="2027-01-01"]').getAttribute('aria-label'), /^1月1日 周五，法定假日（元旦）/);
    assertNoTraditional(await bodyText(page), '2027 card');
  }));

test('lunch, before-work and after-work states', async () => {
  await withPage('2026-11-03T12:00:00+08:00', async (page) => {
    assert.equal(await text(page, `${card} .card-badge`), '午休中');
    assert.equal(await text(page, `${card} .card-countdown`), '60 分钟后继续上班');
    assert.equal(await text(page, `${card} .metric-rate .metric-value`), '¥0.0000 /秒');
    assert.equal(await text(page, `${card} .card-amount`), '¥ 138.7755');
  });
  await withPage('2026-11-03T07:00:00+08:00', async (page) => {
    assert.equal(await text(page, `${card} .card-badge`), '未上班');
    assert.equal(await text(page, `${card} .card-label`), '今天还没开始');
    assert.equal(await text(page, `${card} .card-countdown`), '距上班 1小时30分0秒');
    assert.equal(await text(page, `${card} .card-amount`), '¥ 0.0000');
  });
  await withPage('2026-11-03T18:00:00+08:00', async (page) => {
    assert.equal(await text(page, `${card} .card-badge`), '已下班');
    assert.equal(await text(page, `${card} .card-label`), '今天一共赚了');
    assert.equal(await text(page, `${card} .card-amount`), '¥ 323.8095');
  });
  await withPage('2026-09-20T10:00:00+08:00', async (page) => {
    assert.equal(await text(page, `${card} .card-badge`), '上班中');
    assert.equal(await text(page, `${card} .card-tag`), '调休');
  });
});

test('import with bad fields lists dropped items with reasons and unknown fields', () =>
  withPage(T1412, async (page) => {
    const file = JSON.stringify({
      version: 1, salary: -5, start: '9am', cheer: '加油', foo: 1,
      marks: { '2026-11-05': 'paidLeave', '2026-02-30': 'work' },
    });
    await page.locator('input[type=file]:not(#holiday-file)').setInputFiles({ name: 'b.json', mimeType: 'application/json', buffer: Buffer.from(file) });
    const report = page.locator('.import-report');
    await report.waitFor({ state: 'visible' });
    assert.equal(await page.getByRole('tab', { name: '基本设置' }).getAttribute('aria-selected'), 'true', 'report shown in 基本设置 › 数据与备份');
    assert.equal(await page.locator('.section-backup .import-report').count(), 1);
    assert.equal(await text(page, '.import-report h4'), '已导入 2 项，4 项未导入');
    assert.equal(await page.evaluate(() => document.activeElement?.tagName), 'H4', 'focus on the report title');
    const rows = await page.locator('.import-report tbody tr').allTextContents();
    const joined = rows.join('\n');
    assert.match(joined, /月薪.*月薪必须是大于 0 的数字.*保留当前值 6800/);
    assert.match(joined, /上班时间.*上班时间格式不正确.*保留当前值 08:30/);
    assert.doesNotMatch(joined, /paidLeave|unpaidLeave|true 或 false|null/, 'no raw keys / enum values');
    assert.match(joined, /月历标记 2026-02-30.*不是真实存在的日期/);
    assert.match(joined, /foo.*无法识别的字段，已忽略/);
    assert.equal(rows.length, 4);
    assert.equal(await text(page, `${card} .card-cheer`), '加油');
    assertNoTraditional(await bodyText(page), 'import report');
    await report.getByRole('button', { name: '知道了' }).click();
    assert.equal(await report.isVisible(), false);
    // 「去设置里修改」：在同一分页里聚焦对应字段
    await page.locator('input[type=file]:not(#holiday-file)').setInputFiles({ name: 'c.json', mimeType: 'application/json', buffer: Buffer.from('{"salary":-1}') });
    await report.waitFor({ state: 'visible' });
    await report.getByRole('button', { name: '去设置里修改' }).click();
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'f-salary');
    assert.equal(await visible(page, '.import-report'), false);

    await page.locator('input[type=file]:not(#holiday-file)').setInputFiles({ name: 'x.json', mimeType: 'application/json', buffer: Buffer.from('not json') });
    await report.waitFor({ state: 'visible' });
    assert.match(await text(page, '.import-report'), /导入失败：无法识别这个文件。当前设置没有被修改。/);
    assert.match(await text(page, '.import-report'), /原因：不是有效的 JSON 文本/);
    assertNoTraditional(await bodyText(page), 'import failure panel (non-JSON)');
    await page.locator('input[type=file]:not(#holiday-file)').setInputFiles({ name: 'y.json', mimeType: 'application/json', buffer: Buffer.from('[1]') });
    await page.getByText('原因：文件内容的结构不正确').waitFor();
    await page.locator('input[type=file]:not(#holiday-file)').setInputFiles({ name: 'z.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ cheer: 5, lunchOn: 'yes', payday: 0, marks: { '2026-11-09': 'holiday' } })) });
    await page.getByText('已导入 0 项，4 项未导入').waitFor();
    const partial = await text(page, '.import-report');
    assert.match(partial, /鼓励语格式不正确/);
    assert.match(partial, /午休开关只能是开或关/);
    assert.match(partial, /发薪日必须是 1 到 31 之间的整数/);
    assert.match(partial, /标记类型无法识别/);
    assert.doesNotMatch(partial, /holiday|true|false|null|marks/);
    assertNoTraditional(await bodyText(page), 'partial import report');
    assert.equal(await text(page, `${card} .card-cheer`), '加油', 'failed import changes nothing');

    await page.locator('input[type=file]:not(#holiday-file)').setInputFiles({ name: 'ok.json', mimeType: 'application/json', buffer: Buffer.from('{"version":1,"salary":7000}') });
    await page.getByText('导入成功').waitFor();
    assert.equal(await visible(page, '.import-report'), false);
    assert.equal(await text(page, '.toast-text'), '导入成功');
    assert.equal(await text(page, `${card} .metric-daily .metric-value`), '¥333.33');
  }));

test('export downloads a backup that round-trips', () =>
  withPage(T1412, async (page) => {
    assert.equal(await page.locator('header').getByRole('button', { name: /备份/ }).count(), 0, 'backup buttons are no longer in the header');
    await openSettings(page);
    assert.equal(await page.locator('.section-backup').getByText('备份文件含月薪，请妥善保管').isVisible(), true);
    assert.equal(await page.locator('.section-backup').getByRole('button', { name: '导入备份' }).isVisible(), true);
    await page.getByLabel('月薪').fill('7100');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('.section-backup').getByRole('button', { name: '导出备份' }).click()]);
    assert.match(dl.suggestedFilename(), /^work-motivator-backup-2026-11-03\.json$/);
    const body = JSON.parse(readFileSync(await dl.path(), 'utf8'));
    assert.equal(body.salary, 7100);
    assert.equal(body.version, 1);
    assert.match(await text(page, '.toast-text'), /已导出/);
  }));

test('cheer text is rendered literally, never as HTML', () =>
  withPage(T1412, async (page) => {
    await openSettings(page);
    await page.getByLabel('鼓励语').fill('<b>x</b>');
    assert.equal(await text(page, `${card} .card-cheer`), '<b>x</b>');
    assert.equal(await page.locator(`${card} .card-cheer b`).count(), 0);
    assert.equal(await text(page, '.cheer-count'), '8/40');
  }));

test('storage failure shows the warning bar and the app keeps working', () =>
  withPage(T1412, async (page) => {
    await openSettings(page);
    await page.getByLabel('月薪').fill('7000');
    assert.equal(await text(page, `${errorBar} .banner-text`), '无法保存设置，关闭页面后会丢失。请先导出备份');
    // 恢复前不可关闭；条内有导出 / 导入快捷按钮
    assert.equal(await page.locator(errorBar).getByRole('button', { name: '关闭提示' }).count(), 0);
    assert.equal(await page.locator(errorBar).getByRole('button', { name: '导出备份' }).isVisible(), true);
    assert.equal(await page.locator(errorBar).getByRole('button', { name: '导入备份' }).isVisible(), true);
    assert.equal(await page.locator(errorBar).getAttribute('role'), 'alert');
    assert.equal(await text(page, `${card} .metric-daily .metric-value`), '¥333.33');
    await page.clock.runFor(1000);
    assert.notEqual(await text(page, `${card} .card-amount`), '¥ 200.0000', 'still ticking');
  }, { init: () => { Storage.prototype.setItem = () => { throw new DOMException('quota', 'QuotaExceededError'); }; } }));

test('storage unreadable at load: warning bar from the start, defaults still tick', () =>
  withPage(T1412, async (page) => {
    assert.equal(await text(page, `${errorBar} .banner-text`), '无法保存设置，关闭页面后会丢失。请先导出备份');
    assert.equal(await text(page, `${card} .card-amount`), '¥ 194.2857');
  }, { init: () => { Storage.prototype.getItem = () => { throw new DOMException('denied', 'SecurityError'); }; } }));

const seed = (raw) => ({ init: `if (!sessionStorage.getItem('seeded')) { localStorage.setItem('work-motivator-v1', ${JSON.stringify(raw)}); sessionStorage.setItem('seeded', '1'); }` });

test('corrupt saved settings: visible dismissible notice, not a silent first run', () =>
  withPage(T1412, async (page) => {
    assert.equal(await text(page, `${errorBar} .banner-text`), '已保存的设置无法读取，现在使用的是默认值。如有备份，可用「导入备份」恢复。');
    assert.equal(await page.locator(errorBar).getByRole('button', { name: '导入备份' }).isVisible(), true, 'the bar offers the button its text refers to');
    assert.equal(await page.getByText('这是默认值，可在设置里修改').isVisible(), false, 'not treated as first run');
    assert.equal(await text(page, `${card} .card-amount`), '¥ 194.2857');
    assertNoTraditional(await bodyText(page), 'corrupt-load notice');
    await page.locator(errorBar).getByRole('button', { name: '关闭提示' }).click();
    assert.equal(await visible(page, errorBar), false);
  }, seed('{oops')));

test('partly invalid saved settings: notice lists field labels, other fields still loaded', () =>
  withPage(T1412, async (page) => {
    assert.equal(await text(page, `${errorBar} .banner-text`), '已保存的设置中有部分项目无法使用，以下项目已改用默认值：发薪日、月历标记 2026-02-30');
    assert.equal(await text(page, `${card} .metric-daily .metric-value`), '¥428.57', 'valid salary 9000 still loaded');
    assert.equal(await page.getByText('这是默认值，可在设置里修改').isVisible(), false);
  }, seed(JSON.stringify({ version: 1, salary: 9000, payday: 99, marks: { '2026-02-30': 'work' } }))));

test('two tabs: a change in one tab reaches the other without reload and is never reverted', async () => {
  // 只记录设置键的写入次数（测试用 init script，不是成品钩子）
  const count = () => {
    window.__settingsWrites = 0;
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) {
      if (k === 'work-motivator-v1') window.__settingsWrites++;
      return orig.call(this, k, v);
    };
  };
  const { context, page: p1, errors } = await openAt(browser, server.url, T1412, { init: count });
  try {
    const p2 = await context.newPage();
    p2.setDefaultTimeout(5000);
    p2.on('pageerror', (e) => errors.push(e));
    await p2.goto(server.url);
    await openSettings(p2);
    await openSettings(p1);
    await p2.getByLabel('月薪').fill('9000');
    assert.equal(await text(p2, `${card} .metric-daily .metric-value`), '¥428.57');
    // 第 1 页不重新整理：storage 事件到达后立即反映
    await until(p1, `${card} .metric-daily .metric-value`, '¥428.57');
    assert.equal(await p1.getByLabel('月薪').inputValue(), '9000', 'settings panel synced');
    assert.equal(await p1.evaluate(() => window.__settingsWrites), 0, 'applying a remote change does not write storage');
    // 第 1 页再改鼓励语：不得把第 2 页的月薪改回 6800
    await p1.getByLabel('鼓励语').fill('加油');
    const saved = JSON.parse(await p1.evaluate(() => localStorage.getItem('work-motivator-v1')));
    assert.equal(saved.salary, 9000);
    assert.equal(saved.cheer, '加油');
    await until(p2, `${card} .card-cheer`, '加油');
    assert.equal(await text(p2, `${card} .metric-daily .metric-value`), '¥428.57', 'tab 2 salary not reverted');
    // 月历标记同样同步
    await p2.getByRole('tab', { name: '月历' }).click();
    await p2.locator('.cal-grid button[aria-label^="11月3日 "]').click();
    await p2.getByRole('menuitemradio', { name: /^带薪假/ }).click();
    await until(p1, `${card} .card-badge .badge-text`, '带薪假');
    // 其他分页清空储存（key === null）：回到默认值
    await p2.evaluate(() => localStorage.clear());
    await until(p1, `${card} .metric-daily .metric-value`, '¥323.81');
    assert.deepEqual(errors.map(String), []);
  } finally {
    await context.close();
  }
});

test('first successful save shows one-time backup nudge and requests persistence (failure tolerated)', () =>
  withPage(T1412, async (page) => {
    assert.equal(await visible(page, infoBar), true, 'first-run hint');
    await openSettings(page);
    await page.getByLabel('月薪').fill('7000');
    assert.match(await text(page, infoBar), /建议导出/);
    assert.equal(await page.locator(infoBar).getAttribute('data-id'), 'backupNudge', 'first-run hint gave way to the nudge');
    assert.equal(await page.locator(infoBar).getByRole('button', { name: '导出备份' }).isVisible(), true);
    assert.equal(await page.evaluate(() => window.__persistCalls), 1);
    assert.equal(await text(page, `${card} .metric-daily .metric-value`), '¥333.33');
    await page.locator(infoBar).getByRole('button', { name: '知道了' }).click();
    assert.equal(await visible(page, infoBar), false);
    await page.reload();
    await openSettings(page);
    await page.getByLabel('月薪').fill('7100');
    assert.equal(await visible(page, infoBar), false, 'nudge is one-time');
  }, { init: () => {
    window.__persistCalls = 0;
    Object.defineProperty(navigator.storage, 'persist', { value: () => { window.__persistCalls++; return Promise.reject(new Error('nope')); } });
  } }));

test('crossing 00:00 switches the date', () =>
  withPage('2026-11-03T23:59:59+08:00', async (page) => {
    assert.equal(await text(page, `${card} .card-date`), '2026/11/03 周二');
    await page.clock.runFor(2000);
    assert.equal(await text(page, `${card} .card-date`), '2026/11/04 周三');
    assert.equal(await text(page, `${card} .card-badge`), '未上班');
    assert.match(await todayCell(page, '11月4日').getAttribute('aria-label'), /今天/);
    assert.doesNotMatch(await todayCell(page, '11月3日').getAttribute('aria-label'), /今天/);
  }));

test('no Traditional characters in visible text or in the shipped file', () =>
  withPage(T1412, async (page) => {
    assertNoTraditional(await bodyText(page), 'default page');
    await openSettings(page);
    assertNoTraditional(await bodyText(page), '基本设置');
    await page.getByRole('button', { name: /高级设置/ }).click();
    assertNoTraditional(await bodyText(page), 'advanced settings open');
    const html = readFileSync(join(root, 'dist/work-motivator.html'), 'utf8');
    assert.ok(html.includes('这是默认值，可在设置里修改'), 'dist keeps raw UTF-8 Chinese (charset utf8)');
    assertNoTraditional(decode(html), 'dist/work-motivator.html (decoded)');
  }));
