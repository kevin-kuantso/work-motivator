// Task 11：联网更新假期 / 导入假期表 / 自定义网址（spec §12.3、§13.5–13.7）。
// 网络：harness 默认中止所有外部请求并记录；需要回应的测试用 page.route 在三个来源主机上提供 fixture。
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { startServer, launch, openAt, root, holidayIdle, expectedAutoUrls, isLocal } from './harness.mjs';

const JUNE = '2026-06-01T10:00:00+08:00'; // 11 月前：不应有任何外部请求
const NOV4 = '2026-11-04T10:00:00+08:00'; // 11 月起：自动检查 2027
const JAN4 = '2027-01-04T10:00:00+08:00'; // 当年（2027）没有内置表
const HOSTS = /^https:\/\/(raw\.githubusercontent\.com|cdn\.jsdelivr\.net|fastly\.jsdelivr\.net)\//;
// R37：默认来源顺序 cdn.jsdelivr.net → fastly.jsdelivr.net → raw.githubusercontent.com
const CDN = (y) => `https://cdn.jsdelivr.net/gh/NateScarlet/holiday-cn@master/${y}.json`;
const TRAD = [...'設開時賺鐘勵週與請計錢進導電連線標題資儲歷這個們為麼來還說後點選擇關閉復讀寫據節農區塊網頁顯匯則數單項錯誤會發現狀態間預覽灣準備載檔記號啟離階動處無帶變當聯檢發佈'];
const TW_TERMS = ['预设', '进阶', '有薪假', '使用者', '选单', '滑鼠', '萤幕', '点选', '自订', '未套用', '套用', '尚未公布', '网络不通', '档案'];

const fx = (n) => readFileSync(join(root, 'test', 'fixtures', n), 'utf8');
const REAL_2026 = fx('holiday-cn-2026.json');
const EMPTY_2027 = fx('holiday-cn-2027-empty.json');
// 测试用 2027 数据（虚构，不是官方安排）：元旦 1/1–1/3 放假，春节 2/6–2/12 放假、2/13（周六）调休上班
const day = (date, isOffDay, name) => ({ name, date, isOffDay });
const synth2027 = (patch = {}) => JSON.stringify({
  year: 2027,
  papers: ['https://www.gov.cn/zhengce/test-only-2027.htm'],
  days: [
    day('2027-01-01', true, '元旦'), day('2027-01-02', true, '元旦'), day('2027-01-03', true, '元旦'),
    ...['06', '07', '08', '09', '10', '11', '12'].map((d) => day(`2027-02-${d}`, true, '春节')),
    day('2027-02-13', false, '春节'),
  ],
  ...patch,
});

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

// routes：{ [year]: body | (url) => body | { status } }，只作用在三个默认来源主机上；其余外部请求仍被 harness 中止
function serve(page, routes, log = []) {
  return page.route(HOSTS, async (route) => {
    const url = route.request().url();
    log.push(url);
    const year = /\/(\d{4})\.json$/.exec(url)?.[1];
    let body = routes[year];
    if (typeof body === 'function') body = await body(url);
    if (body === undefined) return route.abort('internetdisconnected');
    if (typeof body === 'object' && body.status) return route.fulfill({ status: body.status, body: '', headers: { 'access-control-allow-origin': '*' } });
    return route.fulfill({ status: 200, contentType: 'application/json', body, headers: { 'access-control-allow-origin': '*' } });
  });
}

async function withPage(iso, fn, opts = {}) {
  const { routes, ...rest } = opts;
  const log = [];
  const o = await openAt(browser, server.url, iso, { ...rest, beforeGoto: routes ? (p) => serve(p, routes, log) : undefined });
  try {
    await fn(o.page, { ...o, log });
    assert.deepEqual(o.errors.map(String), [], 'no uncaught page errors');
    assert.deepEqual(o.consoleErrors, [], 'no console errors');
  } finally {
    await o.context.close();
  }
}

// Node 端轮询（页面时钟被暂停时，页内的 rAF / 计时器轮询不可靠）
async function until(page, fn, arg, timeout = 5000) {
  const t0 = Date.now();
  for (;;) {
    if (await page.evaluate(fn, arg)) return;
    if (Date.now() - t0 > timeout) throw new Error(`timeout waiting for ${fn}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}
const tab = (page, name) => page.getByRole('tab', { name });
const text = (page, sel) => page.locator(sel).first().textContent().then((s) => (s ?? '').trim());
const statusLine = (page) => text(page, '#holiday-status');
const result = async (page) => {
  const el = page.locator('#holiday-result');
  if (!(await el.isVisible())) return null;
  return { tone: await el.getAttribute('data-tone'), text: await text(page, '.holiday-result-text'), detail: await text(page, '.holiday-result-detail') };
};
const checkBtn = (page) => page.locator('#btn-holiday-check');
async function checkNow(page) {
  await tab(page, '基本设置').click();
  await checkBtn(page).click();
  assert.ok(await holidayIdle(page), 'check finished');
}
const goMonth = async (page, n) => { for (let i = 0; i < n; i++) await page.getByRole('button', { name: '下月 ›' }).click(); };
const yearTag = (page) => page.locator('.cal-year-tag');
const holidayRecord = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('work-motivator-v1-holidays') ?? 'null'));
const importHoliday = (page, body, name = 'h.json') =>
  page.locator('#holiday-file').setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(body) });

test('before Nov 1: zero external requests on load and while using the app; status line 「2026 内置」, no 上次检查', () =>
  withPage(JUNE, async (page, { external, autoUrls }) => {
    assert.deepEqual(expectedAutoUrls(JUNE), []);
    assert.deepEqual(autoUrls, []);
    await page.clock.runFor(3000);
    await page.locator('.cal-grid button[data-key="2026-06-03"]').click();
    await page.getByRole('menuitemradio', { name: /带薪假/ }).click();
    await goMonth(page, 7);
    await tab(page, '基本设置').click();
    await page.getByLabel('月薪').fill('7000');
    await page.locator('.adv-toggle').click();
    assert.equal(await statusLine(page), '2026 内置');
    assert.equal(await result(page), null);
    await page.reload();
    await holidayIdle(page);
    await page.clock.runFor(2000);
    assert.deepEqual(external, [], 'no external request at all');
  }));

test('from 2026-11-04: auto-check fetches 2027, applies it, quiet toast (no 「查看」), summary tag disappears, persists after reload', () =>
  withPage(NOV4, async (page, { external, autoUrls }) => {
    assert.deepEqual(autoUrls, [CDN(2027)], 'only 2027, first source (cdn.jsdelivr.net) answered');
    assert.equal(await text(page, '.toast .toast-text'), '已获取 2027 年假期表');
    assert.equal(await page.locator('.toast .toast-action').isVisible(), false, 'no 「查看」 / no action');
    await goMonth(page, 2); // 2027-01
    assert.equal(await yearTag(page).isVisible(), false, 'missing-table tag gone');
    assert.match(await text(page, '.cal-summary-text'), /^本月应出勤 20 天/, '1/1 is a holiday now');
    const name = await page.locator('.cal-grid button[data-key="2027-01-01"] .day-name').textContent();
    assert.equal(name, '元旦');
    await tab(page, '基本设置').click();
    assert.equal(await statusLine(page), '2026 内置 · 2027 联网更新（来源：国办通知） · 上次检查 11/04');
    assert.equal(await result(page), null, 'auto success: toast only');
    const rec = await holidayRecord(page);
    assert.deepEqual(Object.keys(rec.years), ['2027']);
    await page.reload();
    assert.ok(await holidayIdle(page));
    assert.equal(await statusLine(page), '2026 内置 · 2027 联网更新（来源：国办通知） · 上次检查 11/04');
    await goMonth(page, 2);
    assert.equal(await yearTag(page).isVisible(), false, 'still applied after reload');
    assert.deepEqual(external, [CDN(2027)], 'no second request the same day');
  }, { routes: { 2027: synth2027() } }));

test('2027-01-04 (current year missing): status card year tag disappears once the table arrives', () =>
  withPage(JAN4, async (page) => {
    assert.equal(await page.locator('#status-card .card-year').isVisible(), false);
    assert.equal(await text(page, '#status-card .metric-value >> nth=3'), '¥340.00', '6800 / 20 (1/1 off)');
  }, { routes: { 2027: synth2027() } }));

test('2027-01-04 offline: the card shows the missing-table tag and the plain weekday rule (control for the test above)', () =>
  withPage(JAN4, async (page, { autoUrls }) => {
    assert.equal(autoUrls.length, 3, 'three mirrors tried, all aborted');
    assert.equal(await text(page, '#status-card .card-year'), '2027 年假期未内置');
    assert.equal(await text(page, '#status-card .metric-value >> nth=3'), '¥323.81');
  }));

test('empty upstream 2027 file → 「数据来源暂未发布」 info (not an error), nothing applied, no toast', () =>
  withPage(NOV4, async (page, { autoUrls }) => {
    assert.equal(autoUrls.length, 3, 'all three mirrors asked');
    assert.equal(await page.locator('.toast').isVisible(), false);
    await tab(page, '基本设置').click();
    assert.deepEqual(await result(page), { tone: 'info', text: '数据来源暂未发布 2027 年放假安排，发布后会自动更新。现在可以先在月历上自己标记。', detail: '' });
    const colors = await page.locator('#holiday-result').evaluate((e) => getComputedStyle(e).backgroundColor);
    assert.equal(colors, 'rgb(224, 242, 254)', 'info colour (#E0F2FE), not warn / error');
    assert.equal(await statusLine(page), '2026 内置 · 2027 未内置（可联网更新） · 上次检查 11/04');
    assert.equal(await page.locator('.notices .banner-error').isVisible(), false);
    await tab(page, '月历').click();
    await goMonth(page, 2);
    assert.equal(await text(page, '.cal-year-tag'), '2027 年假期未内置', 'never treated as "no holidays"');
    assert.deepEqual(await holidayRecord(page).then((r) => r.years), {}, 'nothing saved (only lastCheck)');
    // 手动检查同样是信息提示
    await checkNow(page);
    assert.equal((await result(page)).tone, 'info');
  }, { routes: { 2026: REAL_2026, 2027: EMPTY_2027 } }));

test('auto-check failure is silent; manual check shows the specific message (检查中… meanwhile, focus kept)', () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  return withPage(NOV4, async (page, { autoUrls }) => {
    assert.equal(autoUrls.length, 3);
    assert.equal(await page.locator('.toast').isVisible(), false, 'auto failure: no toast');
    await tab(page, '基本设置').click();
    assert.equal(await result(page), null, 'auto failure: no message');
    // 手动：第一个来源卡住 → 能看到「检查中…」
    await page.unrouteAll();
    await serve(page, { 2026: () => gate.then(() => undefined), 2027: undefined });
    await checkBtn(page).focus();
    await page.keyboard.press('Enter');
    await until(page, () => document.getElementById('btn-holiday-check').getAttribute('aria-disabled') === 'true');
    assert.equal(await text(page, '#btn-holiday-check'), '检查中…');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'btn-holiday-check', 'focus kept while checking');
    await page.keyboard.press('Enter'); // 检查中再按：忽略
    release();
    assert.ok(await holidayIdle(page));
    assert.equal(await text(page, '#btn-holiday-check'), '检查更新');
    const r = await result(page);
    assert.equal(r.tone, 'warn');
    assert.equal(r.text, '无法连接假期数据来源，请稍后重试，或使用「导入假期表文件」');
    assert.match(r.detail, /^原因：所有数据源都获取失败：连接数据源失败$/);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'btn-holiday-check');
  });
});

test('rejected sources (non-gov.cn papers, weekday make-up day, no off days): specific reason, existing data intact', async () => {
  let body2027 = synth2027();
  await withPage(NOV4, async (page) => {
    // 先拿到合法的 2027，并手动标记一天
    await goMonth(page, 2);
    await page.locator('.cal-grid button[data-key="2027-01-05"]').click();
    await page.getByRole('menuitemradio', { name: /带薪假/ }).click();
    const cases = [
      [synth2027({ papers: ['https://www.example.org/notice.htm'] }), /国务院官网（www\.gov\.cn）/],
      [JSON.stringify({ ...JSON.parse(synth2027()), days: [...JSON.parse(synth2027()).days, day('2027-01-06', false, '元旦')] }), /调休上班日不在周六或周日/],
      [JSON.stringify({ ...JSON.parse(synth2027()), days: [day('2027-02-13', false, '春节')] }), /没有任何放假日/],
    ];
    for (const [body, reason] of cases) {
      body2027 = body;
      await checkNow(page);
      const r = await result(page);
      assert.equal(r.text, '来源数据不完整，已拒绝，未采用');
      assert.equal(r.tone, 'warn');
      assert.match(r.detail, reason);
      const rec = await holidayRecord(page);
      assert.equal(rec.years['2027'].table.off['2027-01-01'], '元旦', 'previous 2027 table kept');
    }
    await tab(page, '月历').click();
    assert.equal(await yearTag(page).isVisible(), false);
    assert.match(await page.locator('.cal-grid button[data-key="2027-01-05"]').getAttribute('aria-label'), /带薪假.*已手动标记/);
    assert.match(await page.locator('.cal-grid button[data-key="2027-01-01"]').getAttribute('aria-label'), /法定假日/);
  }, { routes: { 2026: REAL_2026, 2027: () => body2027 } });
});

test('manual update does not clear manual marks; 「已更新：新增 2027 年假期表」 then 「已是最新」', () =>
  withPage(NOV4, async (page) => {
    await goMonth(page, 2);
    assert.equal(await yearTag(page).isVisible(), true);
    await page.locator('.cal-grid button[data-key="2027-01-01"]').click();
    await page.getByRole('menuitemradio', { name: /改为休息/ }).click();
    await page.locator('.cal-grid button[data-key="2027-01-04"]').click();
    await page.getByRole('menuitemradio', { name: /无薪假/ }).click();
    await page.unrouteAll();
    await serve(page, { 2026: REAL_2026, 2027: synth2027() });
    await checkNow(page);
    assert.deepEqual(await result(page), { tone: 'success', text: '已更新：新增 2027 年假期表', detail: '' });
    const marks = await page.evaluate(() => JSON.parse(localStorage.getItem('work-motivator-v1')).marks);
    assert.deepEqual(marks, { '2027-01-01': 'rest', '2027-01-04': 'unpaidLeave' });
    await tab(page, '月历').click();
    assert.equal(await yearTag(page).isVisible(), false);
    assert.match(await page.locator('.cal-grid button[data-key="2027-01-04"]').getAttribute('aria-label'), /无薪假.*已手动标记/);
    await checkNow(page);
    assert.deepEqual(await result(page), { tone: 'muted', text: '已是最新 · 刚刚检查过', detail: '' });
  }));

test('built-in year: real 2026 file (清明节 vs 清明) → no notice; changed file → page-level 「N 处不同，未采用」 queued behind the first-run hint; never applied', async () => {
  const changed = JSON.parse(REAL_2026);
  changed.days = changed.days.filter((d) => d.date !== '2026-10-07');
  changed.days.push(day('2026-10-11', false, '国庆节'));
  let body = REAL_2026;
  await withPage(JUNE, async (page) => {
    await checkNow(page);
    assert.deepEqual(await result(page), { tone: 'muted', text: '已是最新 · 刚刚检查过', detail: '' });
    assert.equal(await page.locator('.notices .banner-info').getAttribute('data-id'), 'firstRun');
    body = JSON.stringify(changed);
    await checkNow(page);
    // 信息通道：首次提示还在 → 差异提示排队，不丢弃（M4：经 createBanners 的真实路径）
    assert.equal(await page.locator('.notices .banner-info').getAttribute('data-id'), 'firstRun');
    await page.locator('.notices .banner-info').getByRole('button', { name: '关闭提示' }).click();
    assert.equal(await page.locator('.notices .banner-info').getAttribute('data-id'), 'holidayDiff');
    assert.equal(await text(page, '.notices .banner-info .banner-text'), '联网数据与内置表有 2 处不同，未采用');
    const btns = await page.locator('.notices .banner-info').getByRole('button').allTextContents();
    assert.deepEqual(btns, ['×'], 'dismissible; no 「查看差异」');
    await page.locator('.notices .banner-info').getByRole('button', { name: '关闭提示' }).click();
    assert.equal(await page.locator('.notices .banner-info').isVisible(), false);
    assert.equal(await statusLine(page), '2026 内置 · 上次检查 06/01');
    // 内置表没被覆盖：10/7 仍是法定假日，10/11 仍是周末
    await tab(page, '月历').click();
    await goMonth(page, 4);
    assert.match(await page.locator('.cal-grid button[data-key="2026-10-07"]').getAttribute('aria-label'), /法定假日/);
    assert.match(await page.locator('.cal-grid button[data-key="2026-10-11"]').getAttribute('aria-label'), /周末/);
    assert.deepEqual(await holidayRecord(page).then((r) => r.years), {});
  }, { routes: { 2026: () => body } });
});

test('import 假期表文件: success counts, rejection reason, missing year, built-in year', () =>
  withPage(NOV4, async (page) => {
    await tab(page, '基本设置').click();
    await importHoliday(page, synth2027());
    await until(page, () => document.getElementById('holiday-result').dataset.tone === 'success');
    assert.deepEqual(await result(page), { tone: 'success', text: '已导入 2027 年假期表（放假 10 天，调休上班 1 天）', detail: '' });
    assert.equal(await statusLine(page), '2026 内置 · 2027 已导入文件 · 上次检查 11/04');
    await tab(page, '月历').click();
    await goMonth(page, 2);
    assert.equal(await yearTag(page).isVisible(), false);
    await tab(page, '基本设置').click();
    const wait = (s) => until(page, (x) => document.querySelector('.holiday-result-text').textContent === x, s);
    await importHoliday(page, REAL_2026);
    await wait('2026 年假期已内置，未采用导入的数据');
    await importHoliday(page, JSON.stringify({ papers: [], days: [] }));
    await wait('文件里没有可用的年份和放假数据，未导入');
    await importHoliday(page, 'not json at all');
    await wait('文件里没有可用的年份和放假数据，未导入');
    await importHoliday(page, JSON.stringify({ ...JSON.parse(synth2027()), year: 2028, days: [day('2028-01-01', true, '元旦'), day('2028-01-03', false, '元旦')] }));
    await wait('假期数据中有调休上班日不在周六或周日');
    assert.equal((await result(page)).tone, 'warn');
    assert.deepEqual(Object.keys((await holidayRecord(page)).years), ['2027'], '2028 not saved; 2027 kept');
  }));

test('高级设置: aria-expanded toggles; invalid 自定义网址 rejected and not saved; valid one tried FIRST; not in the settings backup', () =>
  withPage(NOV4, async (page, { log }) => {
    await tab(page, '基本设置').click();
    const toggle = page.locator('.adv-toggle');
    assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
    assert.equal(await text(page, '.adv-summary'), '自定义网址：未设置');
    await toggle.click();
    assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
    const input = page.getByLabel('自定义网址');
    assert.equal(await input.isVisible(), true);
    assert.equal(await input.getAttribute('placeholder'), 'https://example.com/{year}.json');
    assert.equal(await text(page, '#hint-custom-url'), '用 {year} 代表年份');
    for (const bad of ['http://mirror.example.org/{year}.json', 'https://mirror.example.org/2027.json']) {
      await input.fill(bad);
      await input.press('Enter');
      await input.blur();
      assert.equal(await text(page, '#err-custom-url'), '网址必须以 https:// 开头，并包含 {year}');
      assert.equal(await input.getAttribute('aria-invalid'), 'true');
      assert.equal((await holidayRecord(page))?.customUrl, undefined, 'not saved');
      assert.equal(await text(page, '.adv-summary'), '自定义网址：未设置');
    }
    await input.fill('https://mirror.example.org/hc/{year}.json');
    await input.blur();
    assert.equal(await text(page, '#err-custom-url'), '');
    assert.equal(await input.getAttribute('aria-invalid'), null);
    assert.equal((await holidayRecord(page)).customUrl, 'https://mirror.example.org/hc/{year}.json');
    assert.equal(await text(page, '.adv-summary'), '自定义网址：mirror.example.org');
    await page.route('https://mirror.example.org/**', (route) => {
      log.push(route.request().url());
      const y = /(\d{4})\.json$/.exec(route.request().url())[1];
      return route.fulfill({ status: 200, contentType: 'application/json', body: y === '2027' ? synth2027() : REAL_2026, headers: { 'access-control-allow-origin': '*' } });
    });
    log.length = 0;
    await checkBtn(page).click();
    assert.ok(await holidayIdle(page));
    assert.deepEqual(log, ['https://mirror.example.org/hc/2026.json', 'https://mirror.example.org/hc/2027.json'], 'custom URL first; defaults not needed');
    assert.equal((await result(page)).text, '已更新：新增 2027 年假期表');
    const settingsRaw = await page.evaluate(() => localStorage.getItem('work-motivator-v1') ?? '');
    assert.doesNotMatch(settingsRaw, /mirror|customUrl/, 'not part of the settings / backup data');
    // 清空 = 未设置
    await input.fill('');
    await input.blur();
    assert.equal(await text(page, '.adv-summary'), '自定义网址：未设置');
    assert.equal((await holidayRecord(page)).customUrl, undefined);
  }));

test('two tabs: holidays key change in one tab refreshes the other (status line, summary tag) without writing', async () => {
  const count = `(() => {
    const orig = Storage.prototype.setItem;
    window.__hWrites = 0;
    Storage.prototype.setItem = function (k, v) { if (k === 'work-motivator-v1-holidays') window.__hWrites++; return orig.call(this, k, v); };
  })();`;
  const { context, page: p1, errors, consoleErrors } = await openAt(browser, server.url, NOV4, { init: count });
  try {
    const p2 = await context.newPage();
    p2.on('pageerror', (e) => errors.push(e));
    await p2.goto(server.url);
    assert.ok(await holidayIdle(p2));
    await goMonth(p2, 2);
    assert.equal(await yearTag(p2).isVisible(), true);
    const w0 = await p2.evaluate(() => window.__hWrites);
    await tab(p1, '基本设置').click();
    await importHoliday(p1, synth2027());
    await until(p2, () => document.querySelector('.cal-year-tag').hidden);
    await tab(p2, '基本设置').click();
    assert.equal(await statusLine(p2), '2026 内置 · 2027 已导入文件 · 上次检查 11/04');
    assert.equal(await p2.evaluate(() => window.__hWrites), w0, 'applying a remote change does not write');
    // 自定义网址也同步
    await p1.locator('.adv-toggle').click();
    await p1.getByLabel('自定义网址').fill('https://mirror.example.org/{year}.json');
    await p1.getByLabel('自定义网址').blur();
    await until(p2, () => document.querySelector('.adv-summary').textContent === '自定义网址：mirror.example.org');
    assert.equal(await p2.evaluate(() => window.__hWrites), w0);
    assert.deepEqual(errors.map(String), []);
    assert.deepEqual(consoleErrors, []);
  } finally {
    await context.close();
  }
});

test('offline (every external request aborted): money, menu, settings and import all keep working', () =>
  withPage(NOV4, async (page, { external }) => {
    const a = await text(page, '#status-card .card-amount');
    await page.clock.runFor(2000);
    assert.notEqual(await text(page, '#status-card .card-amount'), a, 'amount still ticks');
    await page.locator('.cal-grid button[data-key="2026-11-06"]').click();
    await page.getByRole('menuitemradio', { name: /带薪假/ }).click();
    assert.match(await text(page, '.toast .toast-text'), /已标记为带薪假/);
    await checkNow(page);
    assert.equal((await result(page)).tone, 'warn');
    await importHoliday(page, synth2027());
    await until(page, () => document.getElementById('holiday-result').dataset.tone === 'success');
    await page.getByLabel('月薪').fill('7000');
    assert.equal(await page.locator('.notices .banner-error').isVisible(), false);
    assert.ok(external.length >= 6 && external.every((u) => HOSTS.test(u)), 'only the holiday sources were ever attempted');
  }));

test('a11y + keyboard: the new controls have names and are reachable by Tab; mainland Simplified copy in every state', () =>
  withPage(NOV4, async (page) => {
    await tab(page, '基本设置').click();
    for (const name of ['检查更新', '导入假期表文件']) assert.equal(await page.getByRole('button', { name }).count(), 1, name);
    assert.equal(await page.getByRole('button', { name: /高级设置/ }).count(), 1);
    // Tab 顺序：……检查更新 → 导入假期表文件 → 导出备份 → 导入备份 → 高级设置 → 自定义网址
    await page.locator('#f-payday').focus();
    const seq = [];
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Tab');
      seq.push(await page.evaluate(() => document.activeElement.id || document.activeElement.className));
    }
    assert.deepEqual(seq.slice(0, 5), ['btn-holiday-check', 'btn-holiday-import', 'btn-export', 'btn-import', 'adv-toggle']);
    await page.keyboard.press('Shift+Tab'); // 回到 高级设置
    await page.keyboard.press('Enter');
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'f-custom-url');
    const acc = await page.getByRole('textbox', { name: '自定义网址' }).count();
    assert.equal(acc, 1);
    assert.deepEqual(await page.locator('#holiday-result').evaluate((e) => [e.getAttribute('role'), e.getAttribute('aria-live')]), ['status', 'polite'], 'result area is a live status region');
    // 每种状态的文字都扫一遍
    const texts = [];
    const grab = async () => texts.push(await page.locator('#panel-settings').innerText(), await page.locator('.notices').innerText());
    await grab();
    await checkNow(page);
    await grab();
    await importHoliday(page, synth2027());
    await until(page, () => document.getElementById('holiday-result').dataset.tone === 'success');
    await grab();
    await page.getByLabel('自定义网址').fill('x');
    await page.getByLabel('自定义网址').blur();
    await grab();
    const all = texts.join('\n');
    assert.deepEqual(TRAD.filter((c) => all.includes(c)), [], 'no Traditional characters');
    assert.deepEqual(TW_TERMS.filter((w) => all.includes(w)), [], 'no Taiwan terms');
    assert.doesNotMatch(all, /\b(undefined|null|NaN|holidayUpdate|customUrl)\b/, 'no raw keys');
  }));

test('1280×585: 基本设置 shows the holiday group in every state without page scroll; the result stays in view', async () => {
  const states = [
    ['never checked', JUNE, {}, async () => {}],
    ['unpublished', NOV4, { routes: { 2026: REAL_2026, 2027: EMPTY_2027 } }, async () => {}],
    ['network failure (2 lines + reason)', NOV4, {}, async (page) => checkNow(page)],
    ['updated', NOV4, { routes: { 2026: REAL_2026, 2027: synth2027() } }, async (page) => checkNow(page)],
  ];
  // 最坏情况：错误条（设置损坏）+ 信息条（与内置表不同）+ 3 行的失败结果：允许分页内部滚动，但页面不滚、结果在视野内
  const changed = JSON.parse(REAL_2026);
  changed.days = changed.days.filter((d) => d.date !== '2026-10-07');
  states.push(['worst: error + info + failure', NOV4, {
    routes: { 2026: JSON.stringify(changed) },
    init: `if (!sessionStorage.getItem('seeded')) { localStorage.setItem('work-motivator-v1', '{oops'); sessionStorage.setItem('seeded', '1'); }`,
  }, async (page) => {
    await checkNow(page);
    assert.equal(await page.locator('.notices .banner-error').isVisible(), true);
    assert.equal(await page.locator('.notices .banner-info').getAttribute('data-id'), 'holidayDiff');
    assert.equal((await result(page)).tone, 'warn');
  }]);
  for (const [what, iso, opts, act] of states) {
    await withPage(iso, async (page) => {
      await tab(page, '基本设置').click();
      await act(page);
      const m = await page.evaluate(() => {
        const sp = document.getElementById('panel-settings');
        const r = document.getElementById('holiday-result');
        const spr = sp.getBoundingClientRect();
        const rr = r.getBoundingClientRect();
        const tl = document.querySelector('[role=tablist]').getBoundingClientRect();
        return {
          scrollH: document.documentElement.scrollHeight, ih: innerHeight,
          inner: sp.scrollHeight - sp.clientHeight,
          resultShown: !r.hidden, resultInView: r.hidden || (rr.top >= spr.top && rr.bottom <= spr.bottom + 0.5),
          tablistVisible: tl.top >= 0 && tl.bottom <= innerHeight,
          status: document.getElementById('holiday-status').getBoundingClientRect().height,
        };
      });
      console.log(`MEASURE ${JSON.stringify({ case: `holiday ${what}`, ...m })}`);
      assert.ok(m.scrollH <= m.ih, `${what}: no page scroll`);
      assert.equal(m.tablistVisible, true);
      assert.equal(m.resultInView, true, `${what}: result visible inside the panel`);
    }, { ...opts, viewport: { width: 1280, height: 585 } });
  }
});

// ---- fix round 1（R30 / R32）----

test('R30: an imported year is labelled 「导入文件」 (tooltip, status line) and online data never overwrites it; online years are refreshed', async () => {
  let body2027 = synth2027();
  await withPage(NOV4, async (page) => {
    await tab(page, '基本设置').click();
    await importHoliday(page, synth2027());
    await until(page, () => document.getElementById('holiday-result').dataset.tone === 'success');
    assert.equal(await statusLine(page), '2026 内置 · 2027 已导入文件 · 上次检查 11/04');
    await tab(page, '月历').click();
    await goMonth(page, 2);
    const desc = await page.locator('#day-desc-2027-01-01').textContent();
    assert.match(desc, /来源：导入文件/);
    assert.doesNotMatch(desc, /联网更新|官方通知/, 'no claim of origin for a file');
    await page.locator('.cal-grid button[data-key="2027-01-01"]').hover();
    await page.clock.runFor(500); // 悬停 0.4 秒后出现提示
    assert.match(await page.locator('.day-tooltip').innerText(), /来源：导入文件/);
    // 联网有不同的 2027：不覆盖导入的文件，页面级提示
    const changed = JSON.parse(synth2027());
    changed.days = changed.days.filter((d) => d.date !== '2027-01-03');
    body2027 = JSON.stringify(changed);
    await checkNow(page);
    assert.equal(await text(page, '.notices .banner-info .banner-text'), '这是默认值，可在设置里修改', 'first-run hint first');
    await page.locator('.notices .banner-info').getByRole('button', { name: '关闭提示' }).click();
    assert.equal(await page.locator('.notices .banner-info').getAttribute('data-id'), 'holidayDiffFile');
    assert.equal(await text(page, '.notices .banner-info .banner-text'), '联网数据与导入的表有 1 处不同，未采用');
    assert.equal((await holidayRecord(page)).years['2027'].source, 'file');
    assert.equal((await holidayRecord(page)).years['2027'].table.off['2027-01-03'], '元旦', 'file table untouched');
  }, { routes: { 2026: REAL_2026, 2027: () => body2027 } });
});

test('R30: an ONLINE year is replaced by changed online data: 「已更新：2027 年联网数据有变化，已采用」', async () => {
  let body2027 = synth2027();
  await withPage(NOV4, async (page) => {
    assert.equal(await text(page, '.toast .toast-text'), '已获取 2027 年假期表');
    const changed = JSON.parse(synth2027());
    changed.days = changed.days.filter((d) => d.date !== '2027-01-03');
    body2027 = JSON.stringify(changed);
    await checkNow(page);
    assert.deepEqual(await result(page), { tone: 'success', text: '已更新：2027 年联网数据有变化，已采用', detail: '' });
    assert.equal((await holidayRecord(page)).years['2027'].table.off['2027-01-03'], undefined, 'replaced');
    assert.equal(await statusLine(page), '2026 内置 · 2027 联网更新（来源：国办通知） · 上次检查 11/04');
  }, { routes: { 2026: REAL_2026, 2027: () => body2027 } });
});

test('R32: 1280×585 with 高级设置 expanded + invalid 自定义网址: the error is visible in the panel and the tab labels stay visible', () =>
  withPage(NOV4, async (page) => {
    await tab(page, '基本设置').click();
    await page.locator('.adv-toggle').click();
    const input = page.getByLabel('自定义网址');
    await input.fill('https://cdn.jsdelivr.net@evil.com/{year}.json');
    await input.blur();
    assert.equal(await text(page, '#err-custom-url'), '网址里不能带用户名或密码（@ 前面的部分）');
    const m = await page.evaluate(() => {
      const sp = document.getElementById('panel-settings').getBoundingClientRect();
      const e = document.getElementById('err-custom-url').getBoundingClientRect();
      const tl = document.querySelector('[role=tablist]').getBoundingClientRect();
      const p = document.getElementById('panel-settings');
      return { inView: e.top >= sp.top && e.bottom <= sp.bottom + 0.5 && e.height > 0, tabs: tl.top >= 0 && tl.bottom <= innerHeight, pageScroll: document.documentElement.scrollHeight > innerHeight, inner: p.scrollHeight - p.clientHeight, scrolled: p.scrollTop };
    });
    console.log(`MEASURE ${JSON.stringify({ case: 'adv expanded + invalid url @1280x585', ...m })}`);
    assert.equal(m.inView, true, 'error message visible inside the panel');
    assert.equal(m.tabs, true, 'tab labels visible');
    assert.equal(m.pageScroll, false, 'no page scroll (panel-internal scroll only)');
    for (const [bad, msg] of [
      ['https://example.org/a.json#{year}', '{year} 必须写在网址的路径或查询参数里，不能写在域名、端口或 # 后面'],
      ['https://example.org\\x/{year}', '网址里不能有反斜杠（\\）'],
      ['https://example.org/​{year}', '网址里只能用半角字母、数字和常见符号，不能有空格、不可见字符或中文'],
    ]) {
      await input.fill(bad);
      await input.blur();
      assert.equal(await text(page, '#err-custom-url'), msg, bad);
    }
    assert.equal((await holidayRecord(page))?.customUrl, undefined, 'nothing saved');
  }, { viewport: { width: 1280, height: 585 } }));

test('harness self-check (R19/R32): protocol-relative //host, wss:// and ws:// are aborted and counted; only http(s) to localhost is local', async () => {
  for (const u of ['http://localhost:1/x', 'http://127.0.0.1:2/y', 'https://localhost/z']) assert.equal(isLocal(u), true, u);
  for (const u of ['ws://localhost:1/', 'wss://localhost/', 'https://evil.example/', 'wss://evil.example/s', '//evil.example/x', 'data:text/plain,x', 'ftp://localhost/', 'http://localhost.evil.example/']) assert.equal(isLocal(u), false, u);
  const o = await openAt(browser, server.url, JUNE);
  try {
    const r = await o.page.evaluate(async () => {
      const out = {};
      try { await fetch('//evil.example/x.js'); out.rel = 'loaded'; } catch { out.rel = 'blocked'; }
      out.ws = await new Promise((res) => {
        const ws = new WebSocket('wss://evil.example/s');
        ws.onopen = () => res('open');
        ws.onclose = () => res('closed');
        ws.onerror = () => {};
      });
      return out;
    });
    assert.deepEqual(r, { rel: 'blocked', ws: 'closed' });
    assert.ok(o.external.includes('http://evil.example/x.js'), `protocol-relative counted: ${o.external}`);
    assert.ok(o.external.includes('wss://evil.example/s'), `wss counted: ${o.external}`);
  } finally {
    await o.context.close();
  }
});
