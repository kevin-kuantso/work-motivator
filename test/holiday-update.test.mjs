// Task 11：联网更新假期 / 导入假期表 —— 纯函数层（URL、未发布判定、差异计数、状态行、结果模型）与流程编排（假 storage + 假 fetch）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildSourceUrl, validateCustomUrl, sourcesWith, isUnpublishedYear, fetchHolidayYear, DEFAULT_HOLIDAY_SOURCES, validateHolidayYear,
} from '../src/holiday-data.js';
import {
  loadCustomUrl, saveCustomUrl, saveOnlineYear, saveLastCheck, loadLastCheck, loadOnlineTables, HOLIDAYS_STORAGE_KEY,
} from '../src/holiday-store.js';
import {
  diffCount, dayCounts, statusLine, statusModel, pickResult, resultView, customUrlSummary, startHolidayUpdate,
} from '../src/ui/holiday-update.js';
import { HOLIDAYS_CN } from '../src/holidays-cn.js';
import { STRINGS as t } from '../src/strings.zh-CN.js';

const U = t.holidayUpdate;
const fx = (n) => JSON.parse(readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8'));
const memStore = (init = {}) => {
  const m = { ...init };
  return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, m };
};
// 测试用的 2027 年数据（虚构，不是官方安排；只为满足校验规则）
const file2027 = () => ({
  year: 2027,
  papers: ['https://www.gov.cn/zhengce/test-2027.htm'],
  days: [
    { name: '元旦', date: '2027-01-01', isOffDay: true },
    { name: '春节', date: '2027-02-06', isOffDay: true },
    { name: '春节', date: '2027-02-07', isOffDay: true },
    { name: '春节', date: '2027-02-13', isOffDay: false },
  ],
});
const resp = (body, ok = true, status = 200) => ({ ok, status, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });
// 2027 自 P9 起内置：这些流程测试要的是「该年没有表」的路径，所以显式注入不含 2027 的表集合
const NO_2027 = { 2026: HOLIDAYS_CN[2026] };

// ---- URL ----
test('buildSourceUrl replaces every {year}', () => {
  assert.equal(buildSourceUrl('https://a/{year}.json', 2027), 'https://a/2027.json');
  assert.equal(buildSourceUrl('https://a/{year}/{year}.json', 2027), 'https://a/2027/2027.json');
  assert.equal(buildSourceUrl(DEFAULT_HOLIDAY_SOURCES[0], 2026), 'https://cdn.jsdelivr.net/gh/NateScarlet/holiday-cn@master/2026.json');
});

test('validateCustomUrl: https:// + {year} required; no whitespace; must parse; no coercion', () => {
  assert.deepEqual(validateCustomUrl('https://example.org/h/{year}.json'), { ok: true, url: 'https://example.org/h/{year}.json' });
  for (const bad of ['http://example.org/{year}.json', 'https://example.org/2027.json', 'ftp://x/{year}', '{year}', 'https://', 'javascript:alert(1)//{year}', 'HTTPS://example.org/{year}']) {
    const r = validateCustomUrl(bad);
    assert.equal(r.ok, false, bad);
    assert.equal(r.reason, U.customUrlError, bad);
  }
  // R32：可见 ASCII 以外（空格、控制字符、零宽字符、中文）
  for (const bad of [' https://example.org/{year}.json', 'https://example.org/{year}.json ', 'https://exa mple.org/{year}', 'https://example.org/\u0001{year}', 'https://example.org/\u200b{year}.json', 'https://例子.cn/{year}.json', 'https://example.org/{year}\t']) {
    assert.equal(validateCustomUrl(bad).reason, U.customUrlChars, JSON.stringify(bad));
  }
  assert.equal(validateCustomUrl('https://example.org\\@evil.com/{year}').reason, U.customUrlBackslash);
  assert.equal(validateCustomUrl('https:\\\\evil.com/{year}').reason, U.customUrlBackslash);
  // 用户名 / 密码：看起来像 jsDelivr，实际主机是 evil.com
  assert.equal(validateCustomUrl('https://cdn.jsdelivr.net@evil.com/{year}.json').reason, U.customUrlUserinfo);
  assert.equal(validateCustomUrl('https://u:p@example.org/{year}.json').reason, U.customUrlUserinfo);
  // {year} 只能在路径或查询参数里
  for (const bad of ['https://{year}', 'https://{year}.example.org/a.json', 'https://example.org:{year}/a.json', 'https://example.org/a.json#{year}', 'https://example.org/a.json?x=1#y{year}']) {
    assert.equal(validateCustomUrl(bad).reason, U.customUrlYearPlace, bad);
  }
  assert.equal(validateCustomUrl('https://example.org/a.json?year={year}').ok, true, 'query is fine');
  assert.equal(validateCustomUrl(5).ok, false);
  assert.equal(validateCustomUrl(null).ok, false);
});

test('sourcesWith: custom first, then the three defaults; invalid custom ignored', () => {
  assert.deepEqual(sourcesWith(null), [...DEFAULT_HOLIDAY_SOURCES]);
  assert.deepEqual(sourcesWith('https://example.org/{year}.json'), ['https://example.org/{year}.json', ...DEFAULT_HOLIDAY_SOURCES]);
  assert.deepEqual(sourcesWith('http://bad/{year}'), [...DEFAULT_HOLIDAY_SOURCES]);
});

// ---- 未发布 ----
test('isUnpublishedYear: only the real empty upstream shape (papers [] and days [])', () => {
  assert.equal(isUnpublishedYear(fx('holiday-cn-2027-empty.json'), 2027), true);
  assert.equal(isUnpublishedYear({ year: 2027, papers: [], days: [] }, 2026), false, 'year must match');
  assert.equal(isUnpublishedYear({ year: 2027, papers: ['https://www.gov.cn/x'], days: [] }, 2027), false);
  assert.equal(isUnpublishedYear({ year: 2027, papers: [], days: [{}] }, 2027), false);
  assert.equal(isUnpublishedYear({ year: 2027 }, 2027), false);
  assert.equal(isUnpublishedYear(null, 2027), false);
  assert.equal(isUnpublishedYear([], 2027), false);
});

test('fetchHolidayYear failure kind: unpublished / invalid / network (invalid > unpublished > network)', async () => {
  const one = (body) => fetchHolidayYear(2027, { sources: ['https://a/{year}'], fetchImpl: async () => body });
  assert.equal((await one(resp(fx('holiday-cn-2027-empty.json')))).kind, 'unpublished');
  const inv = await one(resp({ ...file2027(), papers: ['https://evil.example/x'] }));
  assert.equal(inv.kind, 'invalid');
  assert.match(inv.reason, /www\.gov\.cn/);
  assert.equal((await one(resp('<html>'))).kind, 'invalid');
  assert.equal((await one(resp('', false, 404))).kind, 'network');
  const thrown = await fetchHolidayYear(2027, { sources: ['https://a/{year}'], fetchImpl: async () => { throw new TypeError('x'); } });
  assert.equal(thrown.kind, 'network');
  // 多个来源：只要有一个给了「不合格数据」就报 invalid；否则有「未发布」就报 unpublished
  const mixed = async (bodies) => {
    let i = 0;
    return fetchHolidayYear(2027, { sources: bodies.map((_, k) => `https://s${k}/{year}`), fetchImpl: async () => { const b = bodies[i++]; if (b instanceof Error) throw b; return b; } });
  };
  assert.equal((await mixed([new TypeError('x'), resp(fx('holiday-cn-2027-empty.json')), new TypeError('y')])).kind, 'unpublished');
  assert.equal((await mixed([resp(fx('holiday-cn-2027-empty.json')), resp({ ...file2027(), days: [{ name: 'x', date: '2027-01-04', isOffDay: false }, { name: '元旦', date: '2027-01-01', isOffDay: true }] })])).kind, 'invalid');
});

// ---- store：customUrl 是新增字段，不影响旧字段 ----
test('store: customUrl roundtrip; other writes keep it; invalid stored value ignored', () => {
  const s = memStore();
  assert.equal(loadCustomUrl(s), null);
  assert.deepEqual(saveCustomUrl(s, 'https://example.org/{year}.json'), { ok: true });
  assert.equal(loadCustomUrl(s), 'https://example.org/{year}.json');
  saveLastCheck(s, 5);
  saveOnlineYear(s, 2027, { table: validateHolidayYear(file2027(), 2027).table, papers: file2027().papers, source: 'https://example.org/2027.json', fetchedAt: 1 });
  assert.equal(loadCustomUrl(s), 'https://example.org/{year}.json', 'kept across other writes');
  assert.equal(loadLastCheck(s), 5);
  assert.ok(loadOnlineTables(s).tables[2027]);
  saveCustomUrl(s, null);
  assert.equal(loadCustomUrl(s), null);
  assert.equal(loadLastCheck(s), 5);
  const rec = JSON.parse(s.m[HOLIDAYS_STORAGE_KEY]);
  rec.customUrl = 'http://evil/{year}';
  s.m[HOLIDAYS_STORAGE_KEY] = JSON.stringify(rec);
  assert.equal(loadCustomUrl(s), null, 'stored value re-validated on load');
  const bad = { getItem() { throw new Error('x'); }, setItem() { throw new Error('x'); } };
  assert.equal(loadCustomUrl(bad), null);
  assert.deepEqual(saveCustomUrl(bad, 'https://example.org/{year}'), { ok: false });
});

// ---- 差异计数：只比日期与类型（放假 / 调休上班），不比节日名 ----
test('diffCount: real 2026 file vs built-in = 0 (names 清明 vs 清明节 ignored)', () => {
  const v = validateHolidayYear(fx('holiday-cn-2026.json'), 2026);
  assert.equal(v.ok, true);
  assert.notDeepEqual(v.table.off, HOLIDAYS_CN[2026].off, 'names really differ');
  assert.equal(diffCount(HOLIDAYS_CN[2026], v.table), 0);
});

test('diffCount: counts dates whose kind differs (added, removed, off<->makeup)', () => {
  const a = { off: { '2026-01-01': 'A', '2026-01-02': 'A' }, makeup: { '2026-01-04': 'A' } };
  assert.equal(diffCount(a, { off: { '2026-01-01': 'B', '2026-01-02': 'x' }, makeup: { '2026-01-04': 'y' } }), 0);
  assert.equal(diffCount(a, { off: { '2026-01-01': 'A' }, makeup: { '2026-01-04': 'A' } }), 1, 'removed off day');
  assert.equal(diffCount(a, { off: { '2026-01-01': 'A', '2026-01-02': 'A', '2026-01-03': 'A' }, makeup: { '2026-01-04': 'A' } }), 1, 'added off day');
  assert.equal(diffCount(a, { off: { '2026-01-01': 'A', '2026-01-02': 'A', '2026-01-04': 'A' }, makeup: {} }), 1, 'makeup -> off counts once');
  assert.equal(diffCount(a, { off: {}, makeup: {} }), 3);
});

test('dayCounts for the import summary', () => {
  assert.deepEqual(dayCounts(validateHolidayYear(fx('holiday-cn-2026.json'), 2026).table), { off: 33, makeup: 6 });
  assert.deepEqual(dayCounts(validateHolidayYear(file2027(), 2027).table), { off: 3, makeup: 1 });
});

// ---- 状态行 ----
const online2027 = { off: { '2027-01-01': '元旦' }, makeup: {}, source: 'online' };
test('statusLine / statusModel: built-in / online / imported / missing chips; 上次检查 only when checked', () => {
  const nov = new Date(2026, 10, 20, 9);
  const file2027t = { ...online2027, source: 'file' };
  // P9：2027 从 2026-11 起内置，两个年份胶囊都是「内置」
  assert.equal(statusLine(nov, HOLIDAYS_CN, null, t), '2026 年 · 内置 · 2027 年 · 内置');
  assert.equal(statusLine(nov, HOLIDAYS_CN, new Date(2026, 10, 3, 8).getTime(), t), '2026 年 · 内置 · 2027 年 · 内置 · 上次检查 11/03');
  // 未内置仍要覆盖：注入不含 2027 的表集合
  assert.equal(statusLine(nov, NO_2027, null, t), '2026 年 · 内置 · 2027 年 · 未内置');
  assert.equal(statusLine(nov, NO_2027, new Date(2026, 10, 3, 8).getTime(), t), '2026 年 · 内置 · 2027 年 · 未内置 · 上次检查 11/03');
  assert.equal(statusLine(nov, { ...HOLIDAYS_CN, 2027: online2027 }, nov.getTime(), t),
    '2026 年 · 内置 · 2027 年 · 联网更新 · 上次检查 11/20');
  // R30：导入的年份不声称来源
  assert.equal(statusLine(nov, { ...HOLIDAYS_CN, 2027: file2027t }, null, t), '2026 年 · 内置 · 2027 年 · 已导入文件');
  // 11 月之前只列当年；有下一年的表时也列出（P9 后 2027 已内置，所以 6 月也列出来）
  assert.equal(statusLine(new Date(2026, 5, 1), HOLIDAYS_CN, null, t), '2026 年 · 内置 · 2027 年 · 内置');
  assert.equal(statusLine(new Date(2026, 5, 1), NO_2027, null, t), '2026 年 · 内置');
  assert.equal(statusLine(new Date(2026, 5, 1), { ...HOLIDAYS_CN, 2027: online2027 }, null, t), '2026 年 · 内置 · 2027 年 · 联网更新');
  assert.equal(statusLine(new Date(2027, 0, 4), HOLIDAYS_CN, null, t), '2027 年 · 内置');
  assert.equal(statusLine(new Date(2028, 0, 4), HOLIDAYS_CN, null, t), '2028 年 · 未内置');
  assert.deepEqual(statusModel(nov, { ...HOLIDAYS_CN, 2027: file2027t }, new Date(2026, 10, 3, 8).getTime(), t), {
    chips: [{ year: 2026, kind: 'builtin', text: '2026 年 · 内置' }, { year: 2027, kind: 'file', text: '2027 年 · 已导入文件' }],
    lastCheck: '上次检查 11/03',
  });
  assert.deepEqual(statusModel(nov, { ...HOLIDAYS_CN, 2027: online2027 }, null, t).chips.map((c) => c.kind), ['builtin', 'online']);
  assert.deepEqual(statusModel(nov, NO_2027, null, t).chips.map((c) => c.kind), ['builtin', 'missing']);
  assert.equal(statusModel(nov, HOLIDAYS_CN, null, t).lastCheck, null);
});

// ---- 结果模型：一次只显示一个结果 ----
test('pickResult + resultView: one result; non-built-in years first; priorities', () => {
  const v = (rs) => resultView(pickResult(rs), t);
  assert.deepEqual(v([{ year: 2026, protected: true, outcome: 'same' }, { year: 2027, protected: false, outcome: 'added' }]), { tone: 'success', text: '已更新：新增 2027 年假期表', detail: null });
  assert.deepEqual(v([{ year: 2026, protected: true, outcome: 'same' }, { year: 2027, protected: false, outcome: 'unpublished' }]),
    { tone: 'info', text: '数据来源暂未发布 2027 年放假安排，发布后会自动更新。法定假日本身已标出，现在可以先在月历上自己标记补假和调休。', detail: null });
  assert.deepEqual(v([{ year: 2026, protected: true, outcome: 'network', reason: 'r1' }, { year: 2027, protected: false, outcome: 'network', reason: 'r2' }]),
    { tone: 'warn', text: '无法连接假期数据来源，请稍后重试，或使用「导入假期表文件」', detail: null });
  assert.deepEqual(v([{ year: 2027, protected: false, outcome: 'invalid', reason: '所有数据源都获取失败：bad' }]), { tone: 'warn', text: '来源数据不完整，已拒绝，未采用', detail: '原因：bad', formatHelp: false });
  // R47：格式 / 内容不合格（validateHolidayYear）才附「查看格式示例」
  assert.equal(v([{ year: 2027, protected: false, outcome: 'invalid', reason: 'bad', format: true }]).formatHelp, true);
  // L7：「已是最新」是成功的结果（绿）并在前面加 ✓，不是停用的灰
  assert.deepEqual(v([{ year: 2026, protected: true, outcome: 'same' }]), { tone: 'success', text: '已是最新 · 刚刚检查过', detail: null, check: true });
  assert.deepEqual(v([{ year: 2026, protected: true, outcome: 'diff', n: 3 }]), { tone: 'success', text: '已是最新 · 刚刚检查过', detail: null, check: true }, 'built-in diff never applied; notice is page-level');
  assert.equal(pickResult([]), null);
  assert.equal(resultView(null, t), null);
  // invalid 胜过 network、network 胜过 unpublished（同为非内置年份）
  assert.equal(pickResult([{ year: 2027, protected: false, outcome: 'unpublished' }, { year: 2028, protected: false, outcome: 'invalid', reason: 'x' }]).outcome, 'invalid');
  assert.equal(pickResult([{ year: 2027, protected: false, outcome: 'unpublished' }, { year: 2028, protected: false, outcome: 'network', reason: 'x' }]).outcome, 'network');
});

test('customUrlSummary', () => {
  assert.equal(customUrlSummary(null, t), '自定义数据网址：未设置');
  assert.equal(customUrlSummary('https://example.org:8443/a/{year}.json', t), '自定义数据网址：example.org:8443');
});

// ---- 流程编排 ----
function harness({ now = new Date(2026, 10, 4, 9), storage = memStore(), fetchImpl, tables = HOLIDAYS_CN } = {}) {
  const calls = [];
  const notes = [];
  const statuses = [];
  let cur = tables;
  const tablesSeen = [];
  const api = startHolidayUpdate({
    storage,
    clock: () => now,
    fetchImpl: async (url, init) => { calls.push(url); return fetchImpl(url, init); },
    getTables: () => cur,
    onTables: (next) => { cur = next; tablesSeen.push(next); },
    notify: (msg, kind) => notes.push([kind, msg]),
    onStatus: (s) => statuses.push(s),
  });
  return { api, calls, notes, statuses, storage, tables: () => cur, tablesSeen, last: () => statuses.at(-1) };
}
const byHost = (map) => async (url) => {
  for (const [k, v] of Object.entries(map)) if (url.includes(k)) return typeof v === 'function' ? v(url) : v;
  throw new TypeError('blocked');
};

test('auto-check: before Nov 1 no request at all', async () => {
  const h = harness({ now: new Date(2026, 5, 1, 9), fetchImpl: async () => { throw new Error('should not fetch'); } });
  await h.api.autoCheckIfNeeded();
  assert.deepEqual(h.calls, []);
  assert.equal(loadLastCheck(h.storage), null, 'nothing to check -> lastCheck untouched');
});

test('auto-check: 2027 built in -> nothing to fetch in Nov 2026 either', async () => {
  // P9：2027 有了内置表，11 月起也不再为次年抓取
  const h = harness({ now: new Date(2026, 10, 4, 9), fetchImpl: async () => { throw new Error('should not fetch'); } });
  await h.api.autoCheckIfNeeded();
  assert.deepEqual(h.calls, []);
  assert.equal(loadLastCheck(h.storage), null, 'no attempt -> lastCheck untouched');
  assert.equal(h.tables()[2027], HOLIDAYS_CN[2027]);
  // 次年（2028）没有表时照常抓取（空文件会继续试下一个来源）
  const empty2028 = JSON.stringify({ year: 2028, papers: [], days: [] });
  const n = harness({ now: new Date(2027, 10, 4, 9), fetchImpl: byHost({ 'cdn.jsdelivr.net': resp(empty2028) }) });
  await n.api.autoCheckIfNeeded();
  assert.ok(n.calls.length >= 1);
  assert.ok(n.calls.every((u) => u.endsWith('/2028.json')), n.calls.join(', '));
});

test('R37: default order cdn.jsdelivr → fastly.jsdelivr → raw; 5 s per source by default', async (t) => {
  assert.deepEqual(DEFAULT_HOLIDAY_SOURCES.map((u) => new URL(buildSourceUrl(u, 2027)).host), ['cdn.jsdelivr.net', 'fastly.jsdelivr.net', 'raw.githubusercontent.com']);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const p = fetchHolidayYear(2027, { sources: ['https://a/{year}'], fetchImpl: () => new Promise(() => {}) });
  t.mock.timers.tick(4999);
  let done = false;
  p.then(() => { done = true; });
  await new Promise((r) => setImmediate(r));
  assert.equal(done, false, 'still waiting at 4999 ms');
  t.mock.timers.tick(1);
  assert.match((await p).reason, /连接超时/);
});

test('R37: a stale empty / invalid copy on jsDelivr does not hide the real file on raw (falls through)', async () => {
  const calls = [];
  const r = await fetchHolidayYear(2027, {
    fetchImpl: async (url) => {
      calls.push(new URL(url).host);
      if (url.includes('cdn.jsdelivr')) return resp(fx('holiday-cn-2027-empty.json'));
      if (url.includes('fastly')) return resp('<html>blocked</html>');
      return resp(file2027());
    },
  });
  assert.equal(r.ok, true);
  assert.equal(r.source, 'https://raw.githubusercontent.com/NateScarlet/holiday-cn/master/2027.json');
  assert.deepEqual(calls, ['cdn.jsdelivr.net', 'fastly.jsdelivr.net', 'raw.githubusercontent.com']);
});

test('auto-check from 2026-11-04: valid 2027 applied, persisted, quiet toast, lastCheck saved', async () => {
  const h = harness({ tables: NO_2027, fetchImpl: byHost({ 'cdn.jsdelivr.net': resp(file2027()) }) });
  await h.api.autoCheckIfNeeded();
  assert.deepEqual(h.calls, ['https://cdn.jsdelivr.net/gh/NateScarlet/holiday-cn@master/2027.json']);
  assert.equal(h.tables()[2027].source, 'online');
  assert.equal(h.tables()[2026].source, 'builtin');
  assert.ok(loadOnlineTables(h.storage).tables[2027]);
  assert.deepEqual(h.notes, [['success', '已获取 2027 年假期表']]);
  assert.equal(loadLastCheck(h.storage), new Date(2026, 10, 4, 9).getTime());
  assert.equal(h.last().result, null, 'auto success: toast only');
  assert.match(h.last().line, /2027 年 · 联网更新/);
  // 同一天第二次：不再请求
  await h.api.autoCheckIfNeeded();
  assert.equal(h.calls.length, 1);
});

test('auto-check: empty 2027 -> 「暂未发布」 info result, nothing applied; failures silent; lastCheck saved', async () => {
  const h = harness({ tables: NO_2027, fetchImpl: byHost({ 'githubusercontent': resp(fx('holiday-cn-2027-empty.json')), 'jsdelivr': resp(fx('holiday-cn-2027-empty.json')) }) });
  await h.api.autoCheckIfNeeded();
  assert.equal(h.calls.length, 3, 'all three mirrors tried');
  assert.equal(h.tables()[2027], undefined);
  assert.deepEqual(h.notes, []);
  assert.equal(h.last().result.tone, 'info');
  assert.match(h.last().result.text, /^数据来源暂未发布 2027 年放假安排/);
  assert.ok(loadLastCheck(h.storage));

  const f = harness({ tables: NO_2027, fetchImpl: async () => { throw new TypeError('offline'); } });
  await f.api.autoCheckIfNeeded();
  assert.equal(f.calls.length, 3);
  assert.deepEqual(f.notes, []);
  assert.equal(f.last().result, null, 'auto-check failure is silent');
  assert.ok(loadLastCheck(f.storage), 'failed attempt still counts for the once-a-day rule');
});

test('custom URL is tried first (auto and manual)', async () => {
  const storage = memStore();
  saveCustomUrl(storage, 'https://mirror.example.org/hc/{year}.json');
  const h = harness({ storage, tables: NO_2027, fetchImpl: byHost({ 'mirror.example.org': resp(file2027()) }) });
  await h.api.autoCheckIfNeeded();
  assert.deepEqual(h.calls, ['https://mirror.example.org/hc/2027.json']);
  assert.equal(h.tables()[2027].source, 'online');
});

test('manual check: current year (built-in, compared) + next year in Nov; one result; built-in never overridden', async () => {
  const real = fx('holiday-cn-2026.json');
  const h = harness({ tables: NO_2027, fetchImpl: byHost({ '2026.json': resp(real), '2027.json': resp(fx('holiday-cn-2027-empty.json')) }) });
  const p = h.api.checkNow();
  assert.equal(h.last().checking, true, '检查中 while running');
  await p;
  assert.equal(h.last().checking, false);
  assert.ok(h.calls.some((u) => u.endsWith('/2026.json')) && h.calls.some((u) => u.endsWith('/2027.json')));
  assert.equal(h.last().result.tone, 'info', 'unpublished 2027 wins over 2026 same');
  assert.deepEqual(h.notes, [], 'names differ but dates/kinds equal -> no diff notice');
  assert.equal(h.tables()[2026], HOLIDAYS_CN[2026]);
});

test('manual check: built-in diff -> page-level info notice with N, not applied', async () => {
  const changed = fx('holiday-cn-2026.json');
  changed.days = changed.days.filter((d) => d.date !== '2026-10-07'); // 少一天放假
  changed.days.push({ name: '国庆节', date: '2026-10-11', isOffDay: false }); // 多一个调休（周日）
  const h = harness({ now: new Date(2026, 5, 1, 9), tables: NO_2027, fetchImpl: byHost({ '2026.json': resp(changed) }) });
  await h.api.checkNow();
  assert.deepEqual(h.notes, [['info', '网上的放假安排与本机内置的有 2 天不同，暂按内置的计算']]);
  assert.equal(h.tables()[2026], HOLIDAYS_CN[2026]);
  assert.equal(h.last().result.text, '已是最新 · 刚刚检查过');
  assert.equal(h.tablesSeen.length, 0, 'tables never replaced');
});

test('manual check: failure shows the specific message; invalid file rejected; existing data intact', async () => {
  const f = harness({ tables: NO_2027, fetchImpl: async () => { throw new TypeError('offline'); } });
  await f.api.checkNow();
  assert.equal(f.last().result.text, '无法连接假期数据来源，请稍后重试，或使用「导入假期表文件」');
  assert.equal(f.last().result.detail, null);
  assert.doesNotMatch(f.last().result.text, /网络不通/);

  const bad = file2027();
  bad.days.push({ name: '劳动节', date: '2027-05-06', isOffDay: false }); // 周四调休上班
  const storage = memStore();
  const i = harness({ storage, tables: NO_2027, fetchImpl: byHost({ '2027.json': resp(bad), '2026.json': resp(fx('holiday-cn-2026.json')) }) });
  await i.api.checkNow();
  assert.equal(i.last().result.text, '来源数据不完整，已拒绝，未采用');
  assert.match(i.last().result.detail, /调休上班日不在周六或周日/);
  assert.equal(i.tables()[2027], undefined);
  assert.equal(loadOnlineTables(storage).tables[2027], undefined);
});

test('manual check: added 2027 then same; online year refreshed when upstream changed', async () => {
  let body = file2027();
  const h = harness({ tables: NO_2027, fetchImpl: byHost({ '2027.json': () => resp(body), '2026.json': resp(fx('holiday-cn-2026.json')) }) });
  await h.api.checkNow();
  assert.equal(h.last().result.text, '已更新：新增 2027 年假期表');
  await h.api.checkNow();
  assert.equal(h.last().result.text, '已是最新 · 刚刚检查过');
  body = file2027();
  body.days.push({ name: '清明节', date: '2027-04-05', isOffDay: true });
  await h.api.checkNow();
  assert.equal(h.last().result.text, '已更新：2027 年联网数据有变化，已采用', 'online years may be replaced by newer online data');
  assert.equal(h.tables()[2027].off['2027-04-05'], '清明节');
});

test('auto + manual concurrently: run one after the other, 2027 applied once', async () => {
  let n = 0;
  const h = harness({ tables: NO_2027, fetchImpl: byHost({ '2027.json': () => { n++; return resp(file2027()); }, '2026.json': resp(fx('holiday-cn-2026.json')) }) });
  const a = h.api.autoCheckIfNeeded();
  const b = h.api.checkNow();
  await Promise.all([a, b]);
  assert.equal(h.last().result.text, '已是最新 · 刚刚检查过', 'manual ran after auto and found nothing new');
  assert.equal(h.tablesSeen.filter((x) => x[2027]).length, 1, 'applied once');
  assert.equal(n, 2);
});

test('importFile: success / rejected / no year / built-in year / not JSON', () => {
  const storage = memStore();
  const h = harness({ storage, tables: NO_2027, fetchImpl: async () => { throw new Error('no'); } });
  assert.deepEqual(h.api.importFile(JSON.stringify(file2027())), { ok: true, year: 2027 });
  assert.equal(h.last().result.text, '已导入 2027 年假期表（放假 3 天，调休上班 1 天）');
  assert.equal(h.last().result.tone, 'success');
  assert.equal(h.tables()[2027].source, 'file', 'R30: imported years are tagged file');
  assert.equal(loadOnlineTables(storage).meta[2027].source, 'file');
  assert.equal(loadOnlineTables(storage).tables[2027].source, 'file', 'persisted and read back as file');
  assert.match(h.last().line, /2027 年 · 已导入文件$/);
  assert.doesNotMatch(h.last().line, /国办通知/, 'no claim of origin for a file');

  const bad = file2027();
  bad.papers = ['https://evil.example/x'];
  const r = h.api.importFile(JSON.stringify({ ...bad, year: 2028, days: bad.days.map((d) => ({ ...d, date: d.date.replace('2027', '2028') })) }));
  assert.equal(r.ok, false);
  assert.equal(r.reason, t.holidayData.papersBad);
  assert.equal(h.last().result.text, t.holidayData.papersBad);
  assert.equal(h.last().result.tone, 'warn');

  for (const txt of ['{"papers":[],"days":[]}', '{"year":"2027"}', '{"year":27.5}', 'not json', '[]', 'null']) {
    const x = h.api.importFile(txt);
    assert.equal(x.ok, false, txt);
    assert.equal(x.reason, '文件里没有可用的年份和放假数据，未导入', txt);
  }
  const b = h.api.importFile(JSON.stringify(fx('holiday-cn-2026.json')));
  assert.deepEqual(b, { ok: false, reason: '2026 年假期已内置，未采用导入的数据', year: 2026 });
  assert.equal(h.tables()[2026], HOLIDAYS_CN[2026]);
  // 空文件（未发布）导入：按校验拒绝，不当作「该年没有假日」
  const e = h.api.importFile(JSON.stringify({ year: 2029, papers: [], days: [] }));
  assert.equal(e.ok, false);
  assert.equal(h.tables()[2029], undefined);
});

test('setCustomUrl: invalid not saved; empty clears; status summary follows', () => {
  const storage = memStore();
  const h = harness({ storage, fetchImpl: async () => { throw new Error('no'); } });
  assert.equal(h.last().customSummary, '自定义数据网址：未设置');
  assert.deepEqual(h.api.setCustomUrl('http://x/{year}'), { ok: false, reason: '网址必须以 https:// 开头，并包含 {year}' });
  assert.equal(loadCustomUrl(storage), null);
  assert.deepEqual(h.api.setCustomUrl('https://mirror.example.org/{year}.json'), { ok: true });
  assert.equal(loadCustomUrl(storage), 'https://mirror.example.org/{year}.json');
  assert.equal(h.last().customSummary, '自定义数据网址：mirror.example.org');
  assert.equal(h.last().customUrl, 'https://mirror.example.org/{year}.json');
  assert.deepEqual(h.api.setCustomUrl(''), { ok: true });
  assert.equal(loadCustomUrl(storage), null);
});

test('reload (other tab changed the holidays key): re-read tables, no storage write', () => {
  const storage = memStore();
  const h = harness({ storage, tables: NO_2027, fetchImpl: async () => { throw new Error('no'); } });
  const other = memStore();
  saveOnlineYear(other, 2027, { table: validateHolidayYear(file2027(), 2027).table, papers: file2027().papers, source: 'https://example.org/2027.json', fetchedAt: 1 });
  storage.m[HOLIDAYS_STORAGE_KEY] = other.m[HOLIDAYS_STORAGE_KEY];
  let writes = 0;
  const set = storage.setItem;
  storage.setItem = (...a) => { writes++; return set(...a); };
  h.api.reload();
  assert.equal(h.tables()[2027].source, 'online');
  assert.equal(writes, 0);
  delete storage.m[HOLIDAYS_STORAGE_KEY];
  h.api.reload();
  assert.equal(h.tables()[2027], undefined);
  assert.equal(h.tables()[2026], HOLIDAYS_CN[2026]);
});

// ---- R30：导入的文件年份受保护 ----
test('R30: online data never overwrites an imported (file) year; differing data -> 「联网数据与导入的表有 N 处不同，未采用」', async () => {
  const storage = memStore();
  const body = file2027();
  body.days.push({ name: '清明节', date: '2027-04-05', isOffDay: true }); // 多 1 天
  const notes = [];
  let cur = NO_2027;
  const api = startHolidayUpdate({
    storage, clock: () => new Date(2026, 10, 4, 9),
    fetchImpl: byHost({ '2027.json': resp(body), '2026.json': resp(fx('holiday-cn-2026.json')) }),
    getTables: () => cur, onTables: (n) => { cur = n; },
    notify: (msg, kind, against) => notes.push([kind, msg, against]), onStatus: () => {},
  });
  assert.equal(api.importFile(JSON.stringify(file2027())).ok, true);
  const before = cur[2027];
  await api.checkNow();
  assert.equal(cur[2027], before, 'file year untouched');
  assert.equal(cur[2027].source, 'file');
  assert.equal(loadOnlineTables(storage).meta[2027].source, 'file', 'storage untouched too');
  assert.deepEqual(notes, [['info', '网上的放假安排与你导入的文件有 1 天不同，暂按导入的文件计算', 'file']]);
  // 相同的数据：不提示
  notes.length = 0;
  const api2 = startHolidayUpdate({
    storage, clock: () => new Date(2026, 10, 4, 9),
    fetchImpl: byHost({ '2027.json': resp(file2027()), '2026.json': resp(fx('holiday-cn-2026.json')) }),
    getTables: () => cur, onTables: (n) => { cur = n; },
    notify: (msg, kind, against) => notes.push([kind, msg, against]), onStatus: () => {},
  });
  await api2.checkNow();
  assert.deepEqual(notes, []);
  // 用户可以再次导入覆盖自己的文件年份
  assert.equal(api2.importFile(JSON.stringify(body)).ok, true);
  assert.equal(cur[2027].off['2027-04-05'], '清明节');
});

test('store: source file read as file; an https:// source as online; empty source dropped', () => {
  const s = memStore();
  const v = validateHolidayYear(file2027(), 2027);
  saveOnlineYear(s, 2027, { table: v.table, papers: v.papers, source: 'file', fetchedAt: 1 });
  saveOnlineYear(s, 2028, { table: { off: { '2028-01-01': '元旦' }, makeup: {} }, papers: ['https://www.gov.cn/x'], source: 'https://raw.githubusercontent.com/NateScarlet/holiday-cn/master/2028.json', fetchedAt: 1 });
  saveOnlineYear(s, 2029, { table: { off: { '2029-01-01': '元旦' }, makeup: {} }, papers: ['https://www.gov.cn/x'], source: '', fetchedAt: 1 });
  const l = loadOnlineTables(s);
  assert.equal(l.tables[2027].source, 'file');
  assert.equal(l.tables[2028].source, 'online');
  assert.equal(l.tables[2029], undefined);
});

// Task 14 E1：已存年份的 source 只接受 'file' 或以 https:// 开头的下载网址；其他一律丢弃该年（绝不默默变成 'online'）
test('store: a stored source must be exactly \'file\' or start with https:// — anything else drops the year', () => {
  const s = memStore();
  const v = validateHolidayYear(file2027(), 2027);
  const put = (year, source) => {
    const off = { [`${year}-01-01`]: '元旦' };
    saveOnlineYear(s, year, { table: year === 2027 ? v.table : { off, makeup: {} }, papers: ['https://www.gov.cn/x'], source, fetchedAt: 1 });
  };
  put(2027, 'https://cdn.jsdelivr.net/gh/NateScarlet/holiday-cn@master/2027.json');
  put(2028, 'weird');
  put(2029, 'FILE');
  put(2030, 'http://evil/x');
  put(2031, 'file');
  put(2032, ' https://a/b');
  put(2033, 'https:/x');
  put(2034, 42);
  put(2035, 'HTTPS://A/B');
  const l = loadOnlineTables(s);
  assert.equal(l.tables[2027].source, 'online');
  assert.equal(l.tables[2031].source, 'file');
  for (const y of [2028, 2029, 2030, 2032, 2033, 2034, 2035]) {
    assert.equal(l.tables[y], undefined, `${y} dropped`);
    assert.equal(l.meta[y], undefined, `${y} no meta`);
  }
  assert.deepEqual(Object.keys(l.tables).sort(), ['2027', '2031']);
});

// ---- R32：结果区一次一个，最新的用户操作优先 ----
test('R32: an in-flight manual check does not overwrite a newer import result; auto-check never replaces a user result', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const h = harness({ tables: NO_2027, fetchImpl: async (url) => { await gate; throw new TypeError(`offline ${url}`); } });
  const p = h.api.checkNow();
  assert.equal(h.api.importFile(JSON.stringify(file2027())).ok, true);
  assert.match(h.last().result.text, /^已导入 2027 年假期表/);
  release();
  await p;
  assert.match(h.last().result.text, /^已导入 2027 年假期表/, 'import result kept after the older check finished');
  assert.equal(h.last().checking, false);

  // 后台自动检查（暂未发布）不替换刚显示的导入结果
  let rel2;
  const gate2 = new Promise((r) => { rel2 = r; });
  const a = harness({ tables: NO_2027, fetchImpl: async () => { await gate2; return resp(fx('holiday-cn-2027-empty.json')); } });
  const auto = a.api.autoCheckIfNeeded();
  a.api.importFile('not json');
  rel2();
  await auto;
  assert.equal(a.last().result.text, '文件里没有可用的年份和放假数据，未导入');
  // 手动检查之后再按一次：最新那次的结果
  const m = harness({ tables: NO_2027, fetchImpl: byHost({ '2026.json': resp(fx('holiday-cn-2026.json')), '2027.json': resp(fx('holiday-cn-2027-empty.json')) }) });
  await Promise.all([m.api.checkNow(), m.api.checkNow()]);
  assert.equal(m.last().result.tone, 'info');
});

// ---- R32：抓取加固 ----
test('R32: wall-clock backstop: a fetch that ignores the signal still ends as 连接超时 and frees the queue', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const never = () => new Promise(() => {}); // 不理会 AbortSignal、永远不结束
  const p = fetchHolidayYear(2027, { sources: ['https://a/{year}'], fetchImpl: never, timeoutMs: 8000 });
  t.mock.timers.tick(8000);
  const r = await p;
  assert.equal(r.ok, false);
  assert.equal(r.kind, 'network');
  assert.match(r.reason, /连接超时/);
  // 经由流程：按钮不会停在「检查中…」，之后的检查照常排队执行
  const h = harness({ now: new Date(2026, 5, 1, 9), fetchImpl: never });
  const c1 = h.api.checkNow();
  for (let i = 0; i < 3; i++) { await Promise.resolve(); t.mock.timers.tick(5000); await new Promise((res) => setImmediate(res)); }
  await c1;
  assert.equal(h.last().checking, false);
  assert.equal(h.last().result.detail, null);
});

test('R32: bodies over 256 KB rejected before JSON.parse; a redirect to non-https rejected', async () => {
  let parsed = 0;
  const orig = JSON.parse;
  JSON.parse = (...a) => { parsed++; return orig(...a); };
  try {
    const big = 'x'.repeat(256 * 1024 + 1);
    const r = await fetchHolidayYear(2027, { sources: ['https://a/{year}'], fetchImpl: async () => resp(big) });
    assert.equal(r.kind, 'invalid');
    assert.match(r.reason, /超过 256 KB/);
    const r2 = await fetchHolidayYear(2027, { sources: ['https://a/{year}'], fetchImpl: async () => ({ ...resp(file2027()), headers: { get: (k) => (k === 'content-length' ? String(300 * 1024) : null) } }) });
    assert.match(r2.reason, /超过 256 KB/, 'content-length checked before reading');
    assert.equal(parsed, 0, 'never parsed');
  } finally {
    JSON.parse = orig;
  }
  const r3 = await fetchHolidayYear(2027, { sources: ['https://a/{year}'], fetchImpl: async () => ({ ...resp(file2027()), url: 'http://a/2027.json' }) });
  assert.equal(r3.kind, 'invalid');
  assert.match(r3.reason, /非 https/);
  const ok = await fetchHolidayYear(2027, { sources: ['https://a/{year}'], fetchImpl: async () => ({ ...resp(file2027()), url: 'https://b/2027.json' }) });
  assert.equal(ok.ok, true, 'https redirect target is fine');
});

// ---- R47：「查看格式示例」只跟着格式 / 内容不合格的拒绝出现 ----
test('R47: fetchHolidayYear marks validateHolidayYear failures as format:true; size / not-JSON / not-https / network are not', async () => {
  const body = (text, extra = {}) => ({ ok: true, status: 200, url: 'https://a/2027.json', headers: { get: () => null }, text: async () => text, ...extra });
  const one = (b) => fetchHolidayYear(2027, { sources: ['https://a/{year}'], fetchImpl: async () => b });
  const badMakeup = { ...file2027(), days: [...file2027().days, { name: '元旦', date: '2027-01-04', isOffDay: false }] }; // 2027-01-04 是周一
  const r1 = await one(body(JSON.stringify(badMakeup)));
  assert.deepEqual([r1.ok, r1.kind, r1.format], [false, 'invalid', true]);
  assert.match(r1.reason, /调休上班日不在周六或周日/);
  const r2 = await one(body(JSON.stringify({ ...file2027(), papers: ['https://example.org/x'] })));
  assert.deepEqual([r2.kind, r2.format], ['invalid', true]);
  for (const [what, b] of [
    ['not JSON', body('<html>')],
    ['too large', body('x'.repeat(300 * 1024))],
    ['not https', body('{}', { url: 'http://a/2027.json' })],
  ]) {
    const r = await one(b);
    assert.deepEqual([r.kind, r.format], ['invalid', false], what);
  }
  const net = await fetchHolidayYear(2027, { sources: ['https://a/{year}'], fetchImpl: async () => { throw new TypeError('x'); } });
  assert.deepEqual([net.kind, net.format], ['network', false]);
  const unp = await one(body(JSON.stringify({ year: 2027, papers: [], days: [] })));
  assert.deepEqual([unp.kind, unp.format], ['unpublished', false]);
});

test('R47: importFile result carries formatHelp for format failures only (not for 「已内置」 or success)', () => {
  const h = harness({ tables: NO_2027, fetchImpl: async () => { throw new Error('offline'); } });
  const r = () => h.last().result;
  h.api.importFile('not json');
  assert.equal(r().formatHelp, true, 'not JSON / no year');
  h.api.importFile(JSON.stringify({ ...file2027(), papers: ['https://example.org/x'] }));
  assert.equal(r().formatHelp, true, 'validateHolidayYear failure');
  h.api.importFile(JSON.stringify({ ...file2027(), year: 2026, days: [{ name: '元旦', date: '2026-01-01', isOffDay: true }] }));
  assert.equal(r().text, '2026 年假期已内置，未采用导入的数据');
  assert.equal(r().formatHelp, false, 'built-in year is not a format problem');
  h.api.importFile(JSON.stringify(file2027()));
  assert.equal(r().tone, 'success');
  assert.ok(!r().formatHelp, 'success: no help button');
});

test('R47: the format example shown (and copied) is a complete file the validator accepts; a non-gov.cn paper is rejected', () => {
  const text = t.holidayUpdate.exampleCode;
  const json = JSON.parse(text);
  const v = validateHolidayYear(json, json.year);
  assert.equal(v.ok, true, v.reason);
  assert.deepEqual(v.table, { off: { '2026-01-01': '元旦' }, makeup: { '2026-01-04': '元旦' } });
  // 内容就是 holiday-cn 2026.json 的真实数据（出处链接与这两天）
  const real = fx('holiday-cn-2026.json');
  assert.deepEqual(json.papers, real.papers);
  for (const d of json.days) assert.ok(real.days.some((x) => x.date === d.date && x.name === d.name && x.isOffDay === d.isOffDay), d.date);
  const bad = validateHolidayYear({ ...json, papers: ['https://example.org/notice.htm'] }, json.year);
  assert.equal(bad.ok, false);
  assert.equal(bad.reason, '假期数据的出处不是国务院官网（www.gov.cn）的链接');
});
