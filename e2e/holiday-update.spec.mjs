// Task 11：聯網更新假期 / 匯入假期表 / 自定義網址（spec §12.3、§13.5–13.7）。
// 網路：harness 預設中止所有外部請求並記錄；需要回應的測試用 page.route 在三個來源主機上提供 fixture。
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { startServer, launch, openAt, root, holidayIdle, expectedAutoUrls, isLocal, tipVisibleLines } from './harness.mjs';
import { HOLIDAYS_CN } from '../src/holidays-cn.js';

const JUNE = '2026-06-01T10:00:00+08:00'; // 11 月前：不應有任何外部請求
// 2027 已有官方內建表（2026-11 通知）：11 月起的自動檢查只會抓下一年（2028）
const NOV4 = '2027-11-04T10:00:00+08:00';
const JAN4 = '2028-01-04T10:00:00+08:00'; // 當年（2028）沒有內建表
const HOSTS = /^https:\/\/(raw\.githubusercontent\.com|cdn\.jsdelivr\.net|fastly\.jsdelivr\.net)\//;
// R37：預設來源順序 cdn.jsdelivr.net → fastly.jsdelivr.net → raw.githubusercontent.com
const CDN = (y) => `https://cdn.jsdelivr.net/gh/NateScarlet/holiday-cn@master/${y}.json`;
const TRAD = [...'設開時賺鐘勵週與請計錢進導電連線標題資儲歷這個們為麼來還說後點選擇關閉復讀寫據節農區塊網頁顯匯則數單項錯誤會發現狀態間預覽灣準備載檔記號啟離階動處無帶變當聯檢發佈'];
const TW_TERMS = ['预设', '进阶', '有薪假', '使用者', '选单', '滑鼠', '萤幕', '点选', '自订', '未套用', '套用', '尚未公布', '网络不通', '档案'];

const fx = (n) => readFileSync(join(root, 'test', 'fixtures', n), 'utf8');
const REAL_2026 = fx('holiday-cn-2026.json');
// 上游「該年還沒釋出」的形狀（年份相符、papers / days 都是空的）。2027 已內建，只能用下一年構造。
const EMPTY_2028 = JSON.stringify({ year: 2028, papers: [], days: [] });
// 測試用 2028 資料（虛構，不是官方安排）：元旦 1/1–1/3 放假，春節 2/6–2/12 放假、2/13（週日）調休上班
const day = (date, isOffDay, name) => ({ name, date, isOffDay });
const synth2028 = (patch = {}) => JSON.stringify({
  year: 2028,
  papers: ['https://www.gov.cn/zhengce/test-only-2028.htm'],
  days: [
    day('2028-01-01', true, '元旦'), day('2028-01-02', true, '元旦'), day('2028-01-03', true, '元旦'),
    ...['06', '07', '08', '09', '10', '11', '12'].map((d) => day(`2028-02-${d}`, true, '春节')),
    day('2028-02-13', false, '春节'),
  ],
  ...patch,
});

// 2027 已是內建年份：把內建錶轉成上游格式的「官方檔案」，用於「內建年份不被覆蓋 / 與內建不同」的測試。
// 只比較日期與型別（節日名稱不同不算差異），所以直接沿用內建表的名稱即可。
const fromTable = (year, table, papers) => JSON.stringify({
  year,
  papers,
  days: [
    ...Object.entries(table.off).map(([date, name]) => day(date, true, name)),
    ...Object.entries(table.makeup).map(([date, name]) => day(date, false, name)),
  ],
});
const official2027 = () => fromTable(2027, HOLIDAYS_CN[2027], ['https://www.gov.cn/zhengce/content/202611/content_7085101.htm']);
// 與內建 2027 有 2 天不同（少一天放假、少一天調休）：不採用，頁面級提示
const changed2027 = () => {
  const off = { ...HOLIDAYS_CN[2027].off };
  const makeup = { ...HOLIDAYS_CN[2027].makeup };
  delete off['2027-10-07'];
  delete makeup['2027-10-09'];
  return fromTable(2027, { off, makeup }, ['https://www.gov.cn/zhengce/test-only-2027.htm']);
};

// 本檔案斷言的是中國地區的假期來源、文案與金額：明確寫入舊版（v1，無地區）設定，
// 讓應用走「舊資料一律歸中國」的遷移路徑，不依賴應用當前的新使用者預設地區（臺灣）。
// 全檔案沒有 seed: false：首次提示要求 localStorage 裡沒有設定，與寫入中國設定互斥，
// 所以凡是需要頁面級提示的用例都直接斷言差異提示本身，不構造「排在首次提示之後」。
const CN_LEGACY = { version: 1, salary: 6800, start: '08:30', end: '17:00', lunchOn: true, lunchStart: '11:30', lunchEnd: '13:00', weekends: false, payday: null, cheer: '' };
const CN_SEED = `if (!sessionStorage.getItem('cn-seeded')) { localStorage.setItem('work-motivator-v1', ${JSON.stringify(JSON.stringify(CN_LEGACY))}); sessionStorage.setItem('cn-seeded', '1'); }`;
// 與既有的 init 組在一起：字串相加、函式轉成字串、{ content } 加字首、null / undefined 只留種子、{ path } 原樣。
const seeded = (init) => {
  if (init == null) return CN_SEED;
  if (typeof init === 'string') return `${CN_SEED}\n${init}`;
  if (typeof init === 'function') return `${CN_SEED}\n(${init.toString()})();`;
  if (typeof init.content === 'string') return { ...init, content: `${CN_SEED}\n${init.content}` };
  return init;
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

// routes：{ [year]: body | (url) => body | { status } }，只作用在三個預設來源主機上；其餘外部請求仍被 harness 中止
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
  const { routes, seed = true, ...rest } = opts;
  const log = [];
  const o = await openAt(browser, server.url, iso, { ...rest, init: seed ? seeded(rest.init) : rest.init, beforeGoto: routes ? (p) => serve(p, routes, log) : undefined });
  try {
    await fn(o.page, { ...o, log });
    assert.deepEqual(o.errors.map(String), [], 'no uncaught page errors');
    assert.deepEqual(o.consoleErrors, [], 'no console errors');
  } finally {
    await o.context.close();
  }
}

// Node 端輪詢（頁面時鐘被暫停時，頁內的 rAF / 計時器輪詢不可靠）
async function until(page, fn, arg, timeout = 5000) {
  const t0 = Date.now();
  for (;;) {
    if (await page.evaluate(fn, arg)) return;
    if (Date.now() - t0 > timeout) throw new Error(`timeout waiting for ${fn}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}
// 分頁按鈕的 id（#tab-settings / #tab-calendar）是穩定契約；role 名稱隨地區字典變化
// （中國：基本設定 / 月曆；臺灣：基本設定 / 月曆），所以能認出來的名稱一律換成 id 定位。
const TAB_LABELS = { settings: ['基本设置', '基本設定'], calendar: ['月历', '月曆'] };
const tab = (page, name) => {
  for (const [id, labels] of Object.entries(TAB_LABELS)) {
    if (typeof name === 'string' && labels.includes(name)) return page.locator(`#tab-${id}`);
    if (name instanceof RegExp && labels.some((label) => name.test(label))) return page.locator(`#tab-${id}`);
  }
  return page.getByRole('tab', { name });
};
const text = (page, sel) => page.locator(sel).first().textContent().then((s) => (s ?? '').trim());
// 假期資料狀態（Task 14：年份膠囊 + 上次檢查）：可見膠囊的文字按順序以「 · 」連起來；分組的無障礙名稱必須是同一句
const statusLine = async (page) => {
  const r = await page.evaluate(() => {
    const el = document.getElementById('holiday-status');
    const parts = [...el.querySelectorAll('.chip, .chip-note')].filter((e) => !e.hidden).map((e) => e.textContent.trim());
    return { line: parts.join(' · '), aria: el.getAttribute('aria-label'), role: el.getAttribute('role') };
  });
  assert.equal(r.role, 'group');
  assert.equal(r.aria, `假期数据状态：${r.line}`, 'group name = the same sentence');
  return r.line;
};
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

test('before Nov 1: zero external requests on load and while using the app; status line lists both built-in years, no 上次检查', () =>
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
    assert.equal(await statusLine(page), '2026 年 · 内置 · 2027 年 · 内置', '2027 is builtin now, so it is listed early');
    assert.equal(await result(page), null);
    await page.reload();
    await holidayIdle(page);
    await page.clock.runFor(2000);
    assert.deepEqual(external, [], 'no external request at all');
  }));

test('from 2027-11-04: auto-check fetches 2028, applies it, quiet toast (no 「查看」), summary tag disappears, persists after reload', () =>
  withPage(NOV4, async (page, { external, autoUrls }) => {
    assert.deepEqual(autoUrls, [CDN(2028)], 'only 2028, first source (cdn.jsdelivr.net) answered');
    assert.equal(await text(page, '.toast .toast-text'), '已获取 2028 年假期表');
    assert.equal(await page.locator('.toast .toast-action').isVisible(), false, 'no 「查看」 / no action');
    await goMonth(page, 2); // 2028-01
    assert.equal(await yearTag(page).isVisible(), false, 'missing-table tag gone');
    assert.match(await text(page, '.cal-summary-text'), /^本月应出勤 20 天/, '1/1 is a holiday now');
    const name = await page.locator('.cal-grid button[data-key="2028-01-01"] .day-name').textContent();
    assert.equal(name, '元旦');
    await tab(page, '基本设置').click();
    assert.equal(await statusLine(page), '2027 年 · 内置 · 2028 年 · 联网更新 · 上次检查 11/04');
    assert.equal(await result(page), null, 'auto success: toast only');
    const rec = await holidayRecord(page);
    assert.deepEqual(Object.keys(rec.years), ['2028']);
    await page.reload();
    assert.ok(await holidayIdle(page));
    assert.equal(await statusLine(page), '2027 年 · 内置 · 2028 年 · 联网更新 · 上次检查 11/04');
    await goMonth(page, 2);
    assert.equal(await yearTag(page).isVisible(), false, 'still applied after reload');
    assert.deepEqual(external, [CDN(2028)], 'no second request the same day');
  }, { routes: { 2028: synth2028() } }));

// 2027 已是內建年份（國務院 2026-11 通知）：載入時不聯網、不出現「未內建」，月曆按內建表標出春節區間與調休上班日，
// 每日工資按內建表算（2 月 15 個上班日）。這是內建表遷移後最直接的可視迴歸。
test('2027 built-in: no auto-check, 春节 range + 调休 cells, 日薪 from the built-in table, manual check still 「已是最新」', () =>
  withPage('2027-02-16T10:00:00+08:00', async (page, { external, autoUrls }) => {
    assert.deepEqual(expectedAutoUrls('2027-02-16T10:00:00+08:00'), [], 'built-in year: nothing to auto-check before Nov');
    assert.deepEqual(autoUrls, []);
    // 狀態卡：內建表 → 沒有「未內建」標籤；日薪按 15 個上班日（6800 / 15 = 453.33）
    assert.equal(await page.locator('#status-card .card-year').isVisible(), false, '2027 is built-in');
    assert.equal(await text(page, '#status-card .card-badge'), '上班中');
    assert.equal(await page.locator('#status-card .card-tag').isVisible(), false, '2/16 is not a make-up day');
    assert.equal(await text(page, '#status-card .metric-daily .metric-value'), '¥453.33', '6800 / 15 (春节 2/5–2/13 放假)');
    assert.equal(await text(page, '#status-card .metric-month .metric-value'), '¥2,817.14', '2 月累计到 2/16 10:00');
    // 月曆：春節區間 + 2/14 調休上班；「依據」寫在 note 的 title 裡
    await tab(page, '月历').click();
    assert.equal(await text(page, '.cal-title'), '2027 年 2 月');
    assert.equal(await yearTag(page).isVisible(), false, 'no 「未内置」 tag for a built-in year');
    assert.equal(await text(page, '.cal-summary-text'), '本月应出勤 15 天 · 日薪 ¥453.33');
    assert.equal(await text(page, '.cal-note-text'), '春节 2/5–2/13 放假，2/14 调休上班');
    assert.equal(await page.locator('.cal-note').getAttribute('data-tone'), 'holiday');
    assert.equal(await page.locator('.cal-note').getAttribute('title'), '春节 2/5–2/13 放假，2/14 调休上班 · 依据 2027 年国务院放假通知');
    const cell = (key) => page.locator(`.cal-grid button[data-key="${key}"]`);
    assert.match(await cell('2027-02-05').getAttribute('aria-label'), /^2月5日 周五，法定假日（春节）/);
    assert.equal(await text(page, '.cal-grid button[data-key="2027-02-05"] .day-name'), '春节');
    assert.match(await cell('2027-02-13').getAttribute('aria-label'), /^2月13日 周六，法定假日（春节）/, 'last day of the holiday run');
    assert.match(await cell('2027-02-14').getAttribute('aria-label'), /^2月14日 周日，调休上班（春节）/);
    assert.equal(await text(page, '.cal-grid button[data-key="2027-02-14"] .day-tag'), '班', 'make-up Sunday carries the 班 tag');
    assert.match(await cell('2027-02-16').getAttribute('aria-label'), /^2月16日 周二，今天，工作日/, 'an ordinary Tuesday stays a workday');
    // 上月：元旦區間與 1/31（週日）調休上班
    await page.locator('.cal-prev').click();
    assert.equal(await text(page, '.cal-title'), '2027 年 1 月');
    assert.equal(await text(page, '.cal-summary-text'), '本月应出勤 21 天 · 日薪 ¥323.81');
    assert.equal(await text(page, '.cal-note-text'), '元旦 1/1–1/3 放假；春节 1/31 调休上班');
    assert.match(await page.locator('.cal-grid button[data-key="2027-01-31"]').getAttribute('aria-label'), /^1月31日 周日，调休上班（春节）/);
    assert.equal(await text(page, '.cal-grid button[data-key="2027-01-31"] .day-tag'), '班');
    // 基本設定：只有當年一個膠囊（2 月還沒到 11 月，下一年也不內建）
    await tab(page, '基本设置').click();
    assert.equal(await statusLine(page), '2027 年 · 内置', 'no 上次检查 yet: nothing was fetched');
    // 手動檢查：受保護年份 → 「已是最新」；官方資料與內建表一致時不產生差異提示
    await checkNow(page);
    assert.deepEqual(await result(page), { tone: 'success', text: '已是最新 · 刚刚检查过', detail: '' });
    assert.equal(await page.locator('.notices .banner-info[data-id="holidayDiff"]').count(), 0, 'identical data: no diff banner');
    assert.equal(await statusLine(page), '2027 年 · 内置 · 上次检查 02/16');
    assert.deepEqual((await holidayRecord(page)).years, {}, 'built-in data is never copied into storage');
    assert.deepEqual(external, [CDN(2027)], 'only the manual check hit the network (first source answered)');
  }, { routes: { 2027: official2027() } }));

test('2028-01-04 (current year missing): status card year tag disappears once the table arrives', () =>
  withPage(JAN4, async (page) => {
    assert.equal(await page.locator('#status-card .card-year').isVisible(), false);
    assert.equal(await text(page, '#status-card .metric-value >> nth=3'), '¥340.00', '6800 / 20 (1/3 周一 off)');
  }, { routes: { 2028: synth2028() } }));

test('2028-01-04 offline: the card shows the missing-table tag and the plain weekday rule (control for the test above)', () =>
  withPage(JAN4, async (page, { autoUrls }) => {
    assert.equal(autoUrls.length, 3, 'three mirrors tried, all aborted');
    assert.equal(await text(page, '#status-card .card-year'), '2028 年只标了法定假日，补假和调休未标出');
    assert.equal(await text(page, '#status-card .metric-value >> nth=3'), '¥400.00', 'R39: 6800 / 17 (元旦 only; 补假未标出)');
  }));

test('empty upstream 2028 file → 「数据来源暂未发布」 info (not an error), nothing applied, no toast', () =>
  withPage(NOV4, async (page, { autoUrls }) => {
    assert.equal(autoUrls.length, 3, 'all three mirrors asked');
    assert.equal(await page.locator('.toast').isVisible(), false);
    await tab(page, '基本设置').click();
    assert.deepEqual(await result(page), { tone: 'info', text: '数据来源暂未发布 2028 年放假安排，发布后会自动更新。法定假日本身已标出，现在可以先在月历上自己标记补假和调休。', detail: '' });
    // 資訊通道的顏色由主題令牌決定（--state-before-bg / --state-before-fg），不寫死某個主題的具體色值；
    // 關鍵契約仍然是：info 用的是「未上班」這一組語義色，而不是 warn / error 的告警色。
    const tones = await page.locator('#holiday-result').evaluate((e) => {
      const probe = document.createElement('span');
      probe.style.color = 'var(--state-before-bg)';
      const probe2 = document.createElement('span');
      probe2.style.color = 'var(--warning-bg)';
      document.body.append(probe, probe2);
      const beforeBg = getComputedStyle(probe).color;
      const warnBg = getComputedStyle(probe2).color;
      probe.remove(); probe2.remove();
      const s = getComputedStyle(e);
      return { bg: s.backgroundColor, fg: s.color, beforeBg, warnBg, beforeFg: (() => {
        const p = document.createElement('span');
        p.style.color = 'var(--state-before-fg)';
        document.body.append(p);
        const v = getComputedStyle(p).color;
        p.remove();
        return v;
      })() };
    });
    assert.equal(tones.bg, tones.beforeBg, 'info uses --state-before-bg, not warn / error');
    assert.equal(tones.fg, tones.beforeFg, 'info text uses --state-before-fg');
    assert.notEqual(tones.bg, tones.warnBg, 'not the warning colour');
    assert.equal(await page.locator('#holiday-result .holiday-result-text .icon-check').count(), 0, '✓ only on 「已是最新」(L7)');
    assert.equal(await statusLine(page), '2027 年 · 内置 · 2028 年 · 未内置 · 上次检查 11/04');
    assert.equal(await page.locator('.notices .banner-error').isVisible(), false);
    await tab(page, '月历').click();
    await goMonth(page, 2);
    assert.equal(await text(page, '.cal-year-tag'), '2028 年只标了法定假日，补假和调休未标出', 'never treated as "no holidays"');
    assert.deepEqual(await holidayRecord(page).then((r) => r.years), {}, 'nothing saved (only lastCheck)');
    // 手動檢查同樣是資訊提示（2027 已內建：連不上也算受保護年份的失敗，不影響非保護年份的結果）
    await checkNow(page);
    assert.equal((await result(page)).tone, 'info');
  }, { routes: { 2028: EMPTY_2028 } }));

test('auto-check failure is silent; manual check shows the specific message (检查中… meanwhile, focus kept)', () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  return withPage(NOV4, async (page, { autoUrls }) => {
    assert.equal(autoUrls.length, 3);
    assert.equal(await page.locator('.toast').isVisible(), false, 'auto failure: no toast');
    await tab(page, '基本设置').click();
    assert.equal(await result(page), null, 'auto failure: no message');
    // 手動：第一個年份（2027）的來源卡住 → 能看到「檢查中…」
    await page.unrouteAll();
    await serve(page, { 2027: () => gate.then(() => undefined), 2028: undefined });
    await checkBtn(page).focus();
    await page.keyboard.press('Enter');
    await until(page, () => document.getElementById('btn-holiday-check').getAttribute('aria-disabled') === 'true');
    assert.equal(await text(page, '#btn-holiday-check'), '检查中…');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'btn-holiday-check', 'focus kept while checking');
    await page.keyboard.press('Enter'); // 檢查中再按：忽略
    release();
    assert.ok(await holidayIdle(page));
    assert.equal(await text(page, '#btn-holiday-check'), '检查更新');
    const r = await result(page);
    assert.equal(r.tone, 'warn');
    assert.equal(r.text, '无法连接假期数据来源，请稍后重试，或使用「导入假期表文件」');
    assert.equal(r.detail, '');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'btn-holiday-check');
  });
});

test('rejected sources (non-gov.cn papers, weekday make-up day, no off days): specific reason, existing data intact', async () => {
  let body2028 = synth2028();
  await withPage(NOV4, async (page) => {
    // 先拿到合法的 2028，並手動標記一天
    await goMonth(page, 2);
    await page.locator('.cal-grid button[data-key="2028-01-05"]').click();
    await page.getByRole('menuitemradio', { name: /带薪假/ }).click();
    const cases = [
      [synth2028({ papers: ['https://www.example.org/notice.htm'] }), /国务院官网（www\.gov\.cn）/],
      [JSON.stringify({ ...JSON.parse(synth2028()), days: [...JSON.parse(synth2028()).days, day('2028-01-06', false, '元旦')] }), /调休上班日不在周六或周日/],
      [JSON.stringify({ ...JSON.parse(synth2028()), days: [day('2028-02-13', false, '春节')] }), /没有任何放假日/],
    ];
    for (const [body, reason] of cases) {
      body2028 = body;
      await checkNow(page);
      const r = await result(page);
      assert.equal(r.text, '来源数据不完整，已拒绝，未采用');
      assert.equal(r.tone, 'warn');
      assert.match(r.detail, reason);
      const rec = await holidayRecord(page);
      assert.equal(rec.years['2028'].table.off['2028-01-01'], '元旦', 'previous 2028 table kept');
    }
    await tab(page, '月历').click();
    assert.equal(await yearTag(page).isVisible(), false);
    assert.match(await page.locator('.cal-grid button[data-key="2028-01-05"]').getAttribute('aria-label'), /带薪假.*已手动标记/);
    assert.match(await page.locator('.cal-grid button[data-key="2028-01-01"]').getAttribute('aria-label'), /法定假日/);
  }, { routes: { 2028: () => body2028 } });
});

test('manual update does not clear manual marks; 「已更新：新增 2028 年假期表」 then 「已是最新」', () =>
  withPage(NOV4, async (page) => {
    await goMonth(page, 2);
    assert.equal(await yearTag(page).isVisible(), true);
    await page.locator('.cal-grid button[data-key="2028-01-01"]').click();
    await page.getByRole('menuitemradio', { name: /改为上班/ }).click(); // R39: 1/1 is already a statutory rest day
    await page.locator('.cal-grid button[data-key="2028-01-04"]').click();
    await page.getByRole('menuitemradio', { name: /无薪假/ }).click();
    await page.unrouteAll();
    await serve(page, { 2027: official2027(), 2028: synth2028() });
    await checkNow(page);
    assert.deepEqual(await result(page), { tone: 'success', text: '已更新：新增 2028 年假期表', detail: '' });
    assert.equal(await page.locator('#holiday-result .holiday-result-text .icon-check').count(), 0, '✓ is only for 「已是最新」(L7)');
    const marks = await page.evaluate(() => JSON.parse(localStorage.getItem('work-motivator-v1')).marksByRegion.CN);
    assert.deepEqual(marks, { '2028-01-01': 'work', '2028-01-04': 'unpaidLeave' });
    await tab(page, '月历').click();
    assert.equal(await yearTag(page).isVisible(), false);
    assert.match(await page.locator('.cal-grid button[data-key="2028-01-04"]').getAttribute('aria-label'), /无薪假.*已手动标记/);
    await checkNow(page);
    assert.deepEqual(await result(page), { tone: 'success', text: '已是最新 · 刚刚检查过', detail: '' });
    // L7：成功的結果前有裝飾性 ✓（aria-hidden），文字本身不變
    const check = page.locator('#holiday-result .holiday-result-text .icon-check');
    assert.equal(await check.count(), 1);
    assert.equal(await check.isVisible(), true);
    assert.equal(await check.getAttribute('aria-hidden'), 'true');
  }));

test('built-in year: real 2026 file (清明节 vs 清明) → no notice; changed file → page-level 「N 处不同，未采用」; never applied', async () => {
  const changed = JSON.parse(REAL_2026);
  changed.days = changed.days.filter((d) => d.date !== '2026-10-07');
  changed.days.push(day('2026-10-11', false, '国庆节'));
  let body = REAL_2026;
  await withPage(JUNE, async (page) => {
    await checkNow(page);
    assert.deepEqual(await result(page), { tone: 'success', text: '已是最新 · 刚刚检查过', detail: '' });
    assert.equal(await page.locator('#holiday-result .holiday-result-text .icon-check').isVisible(), true);
    // 沒有差異時不發頁面級提示（資訊通道安靜）
    assert.equal(await page.locator('.notices .banner-info[data-id="holidayDiff"]').isVisible(), false);
    body = JSON.stringify(changed);
    await checkNow(page);
    // 資訊通道：差異提示直接出現（M4：經 createBanners 的真實路徑）。首次提示需要 localStorage 裡沒有設定，
    // 與本用例明確寫入的中國設定互斥，所以這裡不斷言也不能構造「排在首次提示之後」。
    assert.equal(await page.locator('.notices .banner-info').getAttribute('data-id'), 'holidayDiff');
    assert.equal(await text(page, '.notices .banner-info .banner-text'), '网上的放假安排与本机内置的有 2 天不同，暂按内置的计算');
    const btns = await page.locator('.notices .banner-info').getByRole('button').allTextContents();
    assert.deepEqual(btns, ['×'], 'dismissible; no 「查看差异」');
    await page.locator('.notices .banner-info').getByRole('button', { name: '关闭提示' }).click();
    assert.equal(await page.locator('.notices .banner-info').isVisible(), false);
    assert.equal(await statusLine(page), '2026 年 · 内置 · 2027 年 · 内置 · 上次检查 06/01');
    // 內建表沒被覆蓋：10/7 仍是法定假日，10/11 仍是週末
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
    await importHoliday(page, synth2028());
    await until(page, () => document.getElementById('holiday-result').dataset.tone === 'success');
    assert.deepEqual(await result(page), { tone: 'success', text: '已导入 2028 年假期表（放假 10 天，调休上班 1 天）', detail: '' });
    assert.equal(await statusLine(page), '2027 年 · 内置 · 2028 年 · 已导入文件 · 上次检查 11/04');
    await tab(page, '月历').click();
    await goMonth(page, 2);
    assert.equal(await yearTag(page).isVisible(), false);
    await tab(page, '基本设置').click();
    const wait = (s) => until(page, (x) => document.querySelector('.holiday-result-text').textContent === x, s);
    await importHoliday(page, REAL_2026);
    await wait('2026 年假期已内置，未采用导入的数据');
    await importHoliday(page, official2027());
    await wait('2027 年假期已内置，未采用导入的数据');
    await importHoliday(page, JSON.stringify({ papers: [], days: [] }));
    await wait('文件里没有可用的年份和放假数据，未导入');
    await importHoliday(page, 'not json at all');
    await wait('文件里没有可用的年份和放假数据，未导入');
    await importHoliday(page, JSON.stringify({ year: 2029, papers: ['https://www.gov.cn/zhengce/test-only-2029.htm'], days: [day('2029-01-01', true, '元旦'), day('2029-01-02', false, '元旦')] }));
    await wait('假期数据中有调休上班日不在周六或周日');
    assert.equal((await result(page)).tone, 'warn');
    assert.deepEqual(Object.keys((await holidayRecord(page)).years), ['2028'], '2029 not saved; 2028 kept');
  }));

test('高级设置: aria-expanded toggles; invalid 自定义网址 rejected and not saved; valid one tried FIRST; not in the settings backup', () =>
  withPage(NOV4, async (page, { log }) => {
    await tab(page, '基本设置').click();
    const toggle = page.locator('.adv-toggle');
    assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
    assert.equal(await text(page, '.adv-summary'), '自定义数据网址：未设置');
    await toggle.click();
    assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
    const input = page.getByLabel('自定义数据网址');
    assert.equal(await input.isVisible(), true);
    assert.equal(await input.getAttribute('placeholder'), 'https://example.com/{year}.json');
    assert.equal(await text(page, '#hint-custom-url'), '必须以 https:// 开头，用 {year} 代表年份。网址返回的内容要和「格式示例」格式相同。');
    for (const bad of ['http://mirror.example.org/{year}.json', 'https://mirror.example.org/2028.json']) {
      await input.fill(bad);
      await input.press('Enter');
      await input.blur();
      assert.equal(await text(page, '#err-custom-url'), '网址必须以 https:// 开头，并包含 {year}');
      assert.equal(await input.getAttribute('aria-invalid'), 'true');
      assert.equal((await holidayRecord(page))?.customUrl, undefined, 'not saved');
      assert.equal(await text(page, '.adv-summary'), '自定义数据网址：未设置');
    }
    await input.fill('https://mirror.example.org/hc/{year}.json');
    await input.blur();
    assert.equal(await text(page, '#err-custom-url'), '');
    assert.equal(await input.getAttribute('aria-invalid'), null);
    assert.equal((await holidayRecord(page)).customUrl, 'https://mirror.example.org/hc/{year}.json');
    assert.equal(await text(page, '.adv-summary'), '自定义数据网址：mirror.example.org');
    await page.route('https://mirror.example.org/**', (route) => {
      log.push(route.request().url());
      const y = /(\d{4})\.json$/.exec(route.request().url())[1];
      return route.fulfill({ status: 200, contentType: 'application/json', body: y === '2027' ? official2027() : synth2028(), headers: { 'access-control-allow-origin': '*' } });
    });
    log.length = 0;
    await checkBtn(page).click();
    assert.ok(await holidayIdle(page));
    assert.deepEqual(log, ['https://mirror.example.org/hc/2027.json', 'https://mirror.example.org/hc/2028.json'], 'custom URL first (both years); defaults not needed');
    assert.equal((await result(page)).text, '已更新：新增 2028 年假期表');
    const settingsRaw = await page.evaluate(() => localStorage.getItem('work-motivator-v1') ?? '');
    assert.doesNotMatch(settingsRaw, /mirror|customUrl/, 'not part of the settings / backup data');
    // 清空 = 未設定
    await input.fill('');
    await input.blur();
    assert.equal(await text(page, '.adv-summary'), '自定义数据网址：未设置');
    assert.equal((await holidayRecord(page)).customUrl, undefined);
  }));

test('two tabs: holidays key change in one tab refreshes the other (status line, summary tag) without writing', async () => {
  const count = `(() => {
    const orig = Storage.prototype.setItem;
    window.__hWrites = 0;
    Storage.prototype.setItem = function (k, v) { if (k === 'work-motivator-v1-holidays') window.__hWrites++; return orig.call(this, k, v); };
  })();`;
  const { context, page: p1, errors, consoleErrors } = await openAt(browser, server.url, NOV4, { init: seeded(count) });
  try {
    const p2 = await context.newPage();
    p2.on('pageerror', (e) => errors.push(e));
    await p2.goto(server.url);
    assert.ok(await holidayIdle(p2));
    await goMonth(p2, 2);
    assert.equal(await yearTag(p2).isVisible(), true);
    const w0 = await p2.evaluate(() => window.__hWrites);
    await tab(p1, '基本设置').click();
    await importHoliday(p1, synth2028());
    await until(p2, () => document.querySelector('.cal-year-tag').hidden);
    await tab(p2, '基本设置').click();
    assert.equal(await statusLine(p2), '2027 年 · 内置 · 2028 年 · 已导入文件 · 上次检查 11/04');
    assert.equal(await p2.evaluate(() => window.__hWrites), w0, 'applying a remote change does not write');
    // 自定義網址也同步
    await p1.locator('.adv-toggle').click();
    await p1.getByLabel('自定义数据网址').fill('https://mirror.example.org/{year}.json');
    await p1.getByLabel('自定义数据网址').blur();
    await until(p2, () => document.querySelector('.adv-summary').textContent === '自定义数据网址：mirror.example.org');
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
    await page.locator('.cal-grid button[data-key="2027-11-05"]').click();
    await page.getByRole('menuitemradio', { name: /带薪假/ }).click();
    assert.match(await text(page, '.toast .toast-text'), /已标记为带薪假/);
    await checkNow(page);
    assert.equal((await result(page)).tone, 'warn');
    await importHoliday(page, synth2028());
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
    // 進階設定可用鍵盤展開，並進入自定義網址輸入框。
    await page.locator('#adv-toggle').focus();
    await page.keyboard.press('Enter');
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'f-custom-url');
    const acc = await page.getByRole('textbox', { name: '自定义数据网址' }).count();
    assert.equal(acc, 1);
    assert.deepEqual(await page.locator('#holiday-result').evaluate((e) => [e.getAttribute('role'), e.getAttribute('aria-live')]), ['status', 'polite'], 'result area is a live status region');
    // 每種狀態的文字都掃一遍
    const texts = [];
    const grab = async () => texts.push(await page.locator('#panel-settings').innerText(), await page.locator('.notices').innerText());
    await grab();
    await checkNow(page);
    await grab();
    await importHoliday(page, synth2028());
    await until(page, () => document.getElementById('holiday-result').dataset.tone === 'success');
    await grab();
    await page.getByLabel('自定义数据网址').fill('x');
    await page.getByLabel('自定义数据网址').blur();
    await grab();
    const all = texts.join('\n');
    assert.deepEqual(TRAD.filter((c) => all.includes(c)), [], 'no Traditional characters');
    assert.deepEqual(TW_TERMS.filter((w) => all.includes(w)), [], 'no Taiwan terms');
    assert.doesNotMatch(all, /\b(undefined|null|NaN|holidayUpdate|customUrl)\b/, 'no raw keys');
  }));

test('1280×585: 基本设置 shows the holiday group in every state without page scroll; the result stays in view', async () => {
  const states = [
    ['never checked', JUNE, {}, async () => {}],
    ['unpublished', NOV4, { routes: { 2028: EMPTY_2028 } }, async () => {}],
    ['network failure (2 lines + reason)', NOV4, {}, async (page) => checkNow(page)],
    ['updated', NOV4, { routes: { 2027: official2027(), 2028: synth2028() } }, async (page) => checkNow(page)],
  ];
  // 最壞情況：錯誤條（設定損壞）+ 資訊條（與內建表不同）+ 3 行的失敗結果：允許分頁內部滾動，但頁面不滾、結果在視野內
  states.push(['worst: error + info + failure', NOV4, {
    routes: { 2027: changed2027(), 2028: undefined },
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
  let body2028 = synth2028();
  await withPage(NOV4, async (page) => {
    await tab(page, '基本设置').click();
    await importHoliday(page, synth2028());
    await until(page, () => document.getElementById('holiday-result').dataset.tone === 'success');
    assert.equal(await statusLine(page), '2027 年 · 内置 · 2028 年 · 已导入文件 · 上次检查 11/04');
    await tab(page, '月历').click();
    await goMonth(page, 2);
    const desc = await page.locator('#day-desc-2028-01-01').textContent();
    assert.match(desc, /来源：导入文件/);
    assert.match(desc, /1月1日 周六，农历腊月初五，法定假日（元旦），来源：导入文件，/, 'lunar date is in the accessible description');
    assert.doesNotMatch(desc, /联网更新|官方通知/, 'no claim of origin for a file');
    // 蓋在格子上的提示用短寫：2028-02 是 5 周月份，放得下 4 行（含來源）
    await goMonth(page, 1);
    await page.locator('.cal-grid button[data-key="2028-02-06"]').hover();
    await page.clock.runFor(500); // 懸停 0.4 秒後出現提示
    // 農曆行插在日期之後；格子放不下時整行不顯示（aria-describedby 仍有，見上）
    const lines = await tipVisibleLines(page);
    const base = lines.filter((l) => !l.startsWith('农历'));
    const lunar = lines.find((l) => l.startsWith('农历'));
    assert.deepEqual(base, ['2月6日 周日', '法定假日·春节', '导入文件', '计薪 ¥0.00'], `date / status / source / pay lines: ${JSON.stringify(lines)}`);
    assert.equal(lunar, '农历正月十二');
    assert.equal(lines[1], lunar, 'lunar line right under the date');
    // 聯網有不同的 2028：不覆蓋匯入的檔案，頁面級提示
    const changed = JSON.parse(synth2028());
    changed.days = changed.days.filter((d) => d.date !== '2028-01-03');
    body2028 = JSON.stringify(changed);
    await checkNow(page);
    // 頁面級提示直接就是檔案差異這一條：首次提示需要 localStorage 裡沒有設定，與本用例明確寫入的中國設定互斥
    assert.equal(await page.locator('.notices .banner-info').getAttribute('data-id'), 'holidayDiffFile');
    assert.equal(await text(page, '.notices .banner-info .banner-text'), '网上的放假安排与你导入的文件有 1 天不同，暂按导入的文件计算');
    assert.equal((await holidayRecord(page)).years['2028'].source, 'file');
    assert.equal((await holidayRecord(page)).years['2028'].table.off['2028-01-03'], '元旦', 'file table untouched');
  }, { routes: { 2027: official2027(), 2028: () => body2028 } });
});

test('R30: an ONLINE year is replaced by changed online data: 「已更新：2028 年联网数据有变化，已采用」', async () => {
  let body2028 = synth2028();
  await withPage(NOV4, async (page) => {
    assert.equal(await text(page, '.toast .toast-text'), '已获取 2028 年假期表');
    const changed = JSON.parse(synth2028());
    changed.days = changed.days.filter((d) => d.date !== '2028-01-03');
    body2028 = JSON.stringify(changed);
    await checkNow(page);
    assert.deepEqual(await result(page), { tone: 'success', text: '已更新：2028 年联网数据有变化，已采用', detail: '' });
    assert.equal((await holidayRecord(page)).years['2028'].table.off['2028-01-03'], undefined, 'replaced');
    assert.equal(await statusLine(page), '2027 年 · 内置 · 2028 年 · 联网更新 · 上次检查 11/04');
  }, { routes: { 2027: official2027(), 2028: () => body2028 } });
});

test('R32: 1280×585 with 高级设置 expanded + invalid 自定义网址: the error is visible in the panel and the tab labels stay visible', () =>
  withPage(NOV4, async (page) => {
    await tab(page, '基本设置').click();
    await page.locator('.adv-toggle').click();
    const input = page.getByLabel('自定义数据网址');
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

// R47 / M14：格式錯誤展開唯一的示例入口，進階設定仍可導航到示例。
async function revealedByHelp(page, btnSel) {
  await page.locator(btnSel).click();
  return page.evaluate(() => {
    const col = document.querySelectorAll('.set-col')[1].getBoundingClientRect();
    const ex = document.getElementById('holiday-example');
    const t = document.getElementById('btn-example').getBoundingClientRect();
    return {
      expanded: document.getElementById('btn-example').getAttribute('aria-expanded'), shown: !ex.hidden,
      focus: document.activeElement?.id, toggleInView: t.top >= col.top - 0.5 && t.bottom <= col.bottom + 0.5,
      exTopInView: ex.getBoundingClientRect().top >= col.top - 0.5 && ex.getBoundingClientRect().top < col.bottom,
      pageScroll: document.documentElement.scrollHeight > innerHeight,
    };
  });
}
const REVEALED = { expanded: 'true', shown: true, focus: 'btn-example', toggleInView: true, exTopInView: true, pageScroll: false };

test('R47: import format errors show the example without a duplicate action', () =>
  withPage(NOV4, async (page) => {
    await tab(page, '基本设置').click();
    const wait = (s) => until(page, (x) => document.querySelector('.holiday-result-text').textContent === x, s);
    const one = () => page.evaluate(() => document.querySelectorAll('#holiday-result:not([hidden])').length);
    await importHoliday(page, synth2028({ papers: ['https://example.org/notice.htm'] }));
    await wait('假期数据的出处不是国务院官网（www.gov.cn）的链接');
    assert.equal(await page.locator('#holiday-example').isVisible(), true, 'format failure reveals the example');
    assert.equal(await page.locator('#btn-result-example').count(), 0, 'no duplicate example button');
    assert.equal(await one(), 1, 'still exactly one result message');
    await importHoliday(page, 'not json at all');
    await wait('文件里没有可用的年份和放假数据，未导入');
    assert.equal(await page.locator('#holiday-example').isVisible(), true, 'not JSON also reveals the example');
    await importHoliday(page, REAL_2026);
    await wait('2026 年假期已内置，未采用导入的数据');
    assert.equal(await page.locator('#btn-result-example').count(), 0);
    await importHoliday(page, synth2028({ days: [day('2028-01-01', true, '元旦'), day('2028-01-04', false, '元旦')] })); // 1/4 是週二
    await wait('假期数据中有调休上班日不在周六或周日');
    assert.equal(await page.locator('#holiday-example').isVisible(), true);
    assert.equal(await page.locator('#btn-example').getAttribute('aria-expanded'), 'true');
    await importHoliday(page, synth2028());
    await until(page, () => document.getElementById('holiday-result').dataset.tone === 'success');
    assert.equal(await page.locator('#btn-result-example').count(), 0);
  }));

test('R47: online format error reveals the example; network failure / unpublished do not', async () => {
  const badMakeup = synth2028({ days: [day('2028-01-01', true, '元旦'), day('2028-01-04', false, '元旦')] });
  await withPage(NOV4, async (page) => {
    await checkNow(page);
    const r = await result(page);
    assert.equal(r.tone, 'warn');
    assert.equal(r.text, '来源数据不完整，已拒绝，未采用');
    assert.match(r.detail, /调休上班日不在周六或周日/);
    assert.equal(await page.locator('#holiday-example').isVisible(), true);
    assert.equal(await page.locator('#btn-result-example').count(), 0);
  }, { routes: { 2027: official2027(), 2028: badMakeup } });
  await withPage(NOV4, async (page) => {
    await checkNow(page);
    assert.equal((await result(page)).text, '无法连接假期数据来源，请稍后重试，或使用「导入假期表文件」');
    assert.equal(await page.locator('#holiday-example').isVisible(), false, 'network failure: no format help');
  });
  await withPage(NOV4, async (page) => {
    await checkNow(page);
    assert.equal((await result(page)).tone, 'info');
    assert.equal(await page.locator('#holiday-example').isVisible(), false, 'unpublished: no format help');
  }, { routes: { 2028: EMPTY_2028 } });
  await withPage(NOV4, async (page) => {
    await checkNow(page);
    assert.match((await result(page)).detail, /不是有效的 JSON 文本/);
    assert.equal(await page.locator('#holiday-example').isVisible(), false, 'server non-JSON is not a file-format problem');
  }, { routes: { 2028: '<html>blocked</html>' } });
});

test('R47: 高级设置 hint + 「查看格式示例」 expands the example in 假期数据, brings it into view and focuses its toggle', () =>
  withPage(NOV4, async (page) => {
    await page.setViewportSize({ width: 1280, height: 585 });
    await tab(page, '基本设置').click();
    await page.locator('.adv-toggle').click();
    assert.equal(await text(page, '#hint-custom-url'), '必须以 https:// 开头，用 {year} 代表年份。网址返回的内容要和「格式示例」格式相同。');
    assert.equal(await page.locator('#btn-adv-example').textContent(), '查看格式示例');
    assert.equal(await page.locator('#holiday-example').isVisible(), false);
    assert.deepEqual(await revealedByHelp(page, '#btn-adv-example'), REVEALED);
    // 再按一次：已展開時仍只是帶進視野、聚焦，不會收起
    await page.locator('#adv-toggle').scrollIntoViewIfNeeded();
    assert.deepEqual(await revealedByHelp(page, '#btn-adv-example'), REVEALED);
  }));
