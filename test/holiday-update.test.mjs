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
  diffCount, dayCounts, statusLine, pickResult, resultView, customUrlSummary, startHolidayUpdate,
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

// ---- URL ----
test('buildSourceUrl replaces every {year}', () => {
  assert.equal(buildSourceUrl('https://a/{year}.json', 2027), 'https://a/2027.json');
  assert.equal(buildSourceUrl('https://a/{year}/{year}.json', 2027), 'https://a/2027/2027.json');
  assert.equal(buildSourceUrl(DEFAULT_HOLIDAY_SOURCES[1], 2026), 'https://cdn.jsdelivr.net/gh/NateScarlet/holiday-cn@master/2026.json');
});

test('validateCustomUrl: https:// + {year} required; no whitespace; must parse; no coercion', () => {
  assert.deepEqual(validateCustomUrl('https://example.org/h/{year}.json'), { ok: true, url: 'https://example.org/h/{year}.json' });
  for (const bad of ['http://example.org/{year}.json', 'https://example.org/2027.json', 'ftp://x/{year}', '{year}', 'https://', 'https://{year}', 'javascript:alert(1)//{year}', 'HTTPS://example.org/{year}']) {
    const r = validateCustomUrl(bad);
    assert.equal(r.ok, false, bad);
    assert.equal(r.reason, U.customUrlError, bad);
  }
  for (const bad of [' https://example.org/{year}.json', 'https://example.org/{year}.json ', 'https://exa mple.org/{year}']) {
    assert.equal(validateCustomUrl(bad).reason, U.customUrlSpace, JSON.stringify(bad));
  }
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
  saveOnlineYear(s, 2027, { table: validateHolidayYear(file2027(), 2027).table, papers: file2027().papers, source: 'x', fetchedAt: 1 });
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
test('statusLine: built-in / online / imported / missing; 上次检查 only when checked', () => {
  const nov = new Date(2026, 10, 20, 9);
  assert.equal(statusLine(nov, HOLIDAYS_CN, {}, null, t), '2026 内置 · 2027 未内置（可联网更新）');
  assert.equal(statusLine(nov, HOLIDAYS_CN, {}, new Date(2026, 10, 3, 8).getTime(), t), '2026 内置 · 2027 未内置（可联网更新） · 上次检查 11/03');
  assert.equal(statusLine(nov, { ...HOLIDAYS_CN, 2027: online2027 }, { 2027: { source: 'https://x/2027.json' } }, nov.getTime(), t),
    '2026 内置 · 2027 联网更新（来源：国办通知） · 上次检查 11/20');
  assert.equal(statusLine(nov, { ...HOLIDAYS_CN, 2027: online2027 }, { 2027: { source: 'file' } }, null, t), '2026 内置 · 2027 已导入文件（来源：国办通知）');
  // 11 月之前只列当年；有下一年的表时也列出
  assert.equal(statusLine(new Date(2026, 5, 1), HOLIDAYS_CN, {}, null, t), '2026 内置');
  assert.equal(statusLine(new Date(2026, 5, 1), { ...HOLIDAYS_CN, 2027: online2027 }, {}, null, t), '2026 内置 · 2027 联网更新（来源：国办通知）');
  assert.equal(statusLine(new Date(2027, 0, 4), HOLIDAYS_CN, {}, null, t), '2027 未内置（可联网更新）');
});

// ---- 结果模型：一次只显示一个结果 ----
test('pickResult + resultView: one result; non-built-in years first; priorities', () => {
  const v = (rs) => resultView(pickResult(rs), t);
  assert.deepEqual(v([{ year: 2026, builtin: true, outcome: 'same' }, { year: 2027, builtin: false, outcome: 'added' }]), { tone: 'success', text: '已更新：新增 2027 年假期表', detail: null });
  assert.deepEqual(v([{ year: 2026, builtin: true, outcome: 'same' }, { year: 2027, builtin: false, outcome: 'unpublished' }]),
    { tone: 'info', text: '数据来源暂未发布 2027 年放假安排，发布后会自动更新。现在可以先在月历上自己标记。', detail: null });
  assert.deepEqual(v([{ year: 2026, builtin: true, outcome: 'network', reason: 'r1' }, { year: 2027, builtin: false, outcome: 'network', reason: 'r2' }]),
    { tone: 'warn', text: '无法连接假期数据来源，请稍后重试，或使用「导入假期表文件」', detail: '原因：r2' });
  assert.deepEqual(v([{ year: 2027, builtin: false, outcome: 'invalid', reason: 'bad' }]), { tone: 'warn', text: '来源数据不完整，已拒绝，未采用', detail: '原因：bad' });
  assert.deepEqual(v([{ year: 2026, builtin: true, outcome: 'same' }]), { tone: 'muted', text: '已是最新 · 刚刚检查过', detail: null });
  assert.deepEqual(v([{ year: 2026, builtin: true, outcome: 'diff', n: 3 }]), { tone: 'muted', text: '已是最新 · 刚刚检查过', detail: null }, 'built-in diff never applied; notice is page-level');
  assert.equal(pickResult([]), null);
  assert.equal(resultView(null, t), null);
  // invalid 胜过 network、network 胜过 unpublished（同为非内置年份）
  assert.equal(pickResult([{ year: 2027, builtin: false, outcome: 'unpublished' }, { year: 2028, builtin: false, outcome: 'invalid', reason: 'x' }]).outcome, 'invalid');
  assert.equal(pickResult([{ year: 2027, builtin: false, outcome: 'unpublished' }, { year: 2028, builtin: false, outcome: 'network', reason: 'x' }]).outcome, 'network');
});

test('customUrlSummary', () => {
  assert.equal(customUrlSummary(null, t), '自定义网址：未设置');
  assert.equal(customUrlSummary('https://example.org:8443/a/{year}.json', t), '自定义网址：example.org:8443');
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

test('auto-check from 2026-11-04: valid 2027 applied, persisted, quiet toast, lastCheck saved', async () => {
  const h = harness({ fetchImpl: byHost({ 'raw.githubusercontent.com': resp(file2027()) }) });
  await h.api.autoCheckIfNeeded();
  assert.deepEqual(h.calls, ['https://raw.githubusercontent.com/NateScarlet/holiday-cn/master/2027.json']);
  assert.equal(h.tables()[2027].source, 'online');
  assert.equal(h.tables()[2026].source, 'builtin');
  assert.ok(loadOnlineTables(h.storage).tables[2027]);
  assert.deepEqual(h.notes, [['success', '已获取 2027 年假期表']]);
  assert.equal(loadLastCheck(h.storage), new Date(2026, 10, 4, 9).getTime());
  assert.equal(h.last().result, null, 'auto success: toast only');
  assert.match(h.last().line, /2027 联网更新/);
  // 同一天第二次：不再请求
  await h.api.autoCheckIfNeeded();
  assert.equal(h.calls.length, 1);
});

test('auto-check: empty 2027 -> 「暂未发布」 info result, nothing applied; failures silent; lastCheck saved', async () => {
  const h = harness({ fetchImpl: byHost({ 'githubusercontent': resp(fx('holiday-cn-2027-empty.json')), 'jsdelivr': resp(fx('holiday-cn-2027-empty.json')) }) });
  await h.api.autoCheckIfNeeded();
  assert.equal(h.calls.length, 3, 'all three mirrors tried');
  assert.equal(h.tables()[2027], undefined);
  assert.deepEqual(h.notes, []);
  assert.equal(h.last().result.tone, 'info');
  assert.match(h.last().result.text, /^数据来源暂未发布 2027 年放假安排/);
  assert.ok(loadLastCheck(h.storage));

  const f = harness({ fetchImpl: async () => { throw new TypeError('offline'); } });
  await f.api.autoCheckIfNeeded();
  assert.equal(f.calls.length, 3);
  assert.deepEqual(f.notes, []);
  assert.equal(f.last().result, null, 'auto-check failure is silent');
  assert.ok(loadLastCheck(f.storage), 'failed attempt still counts for the once-a-day rule');
});

test('custom URL is tried first (auto and manual)', async () => {
  const storage = memStore();
  saveCustomUrl(storage, 'https://mirror.example.org/hc/{year}.json');
  const h = harness({ storage, fetchImpl: byHost({ 'mirror.example.org': resp(file2027()) }) });
  await h.api.autoCheckIfNeeded();
  assert.deepEqual(h.calls, ['https://mirror.example.org/hc/2027.json']);
  assert.equal(h.tables()[2027].source, 'online');
});

test('manual check: current year (built-in, compared) + next year in Nov; one result; built-in never overridden', async () => {
  const real = fx('holiday-cn-2026.json');
  const h = harness({ fetchImpl: byHost({ '2026.json': resp(real), '2027.json': resp(fx('holiday-cn-2027-empty.json')) }) });
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
  const h = harness({ now: new Date(2026, 5, 1, 9), fetchImpl: byHost({ '2026.json': resp(changed) }) });
  await h.api.checkNow();
  assert.deepEqual(h.notes, [['info', '联网数据与内置表有 2 处不同，未采用']]);
  assert.equal(h.tables()[2026], HOLIDAYS_CN[2026]);
  assert.equal(h.last().result.text, '已是最新 · 刚刚检查过');
  assert.equal(h.tablesSeen.length, 0, 'tables never replaced');
});

test('manual check: failure shows the specific message; invalid file rejected; existing data intact', async () => {
  const f = harness({ fetchImpl: async () => { throw new TypeError('offline'); } });
  await f.api.checkNow();
  assert.equal(f.last().result.text, '无法连接假期数据来源，请稍后重试，或使用「导入假期表文件」');
  assert.match(f.last().result.detail, /网络连接失败/);
  assert.doesNotMatch(f.last().result.text, /网络不通/);

  const bad = file2027();
  bad.days.push({ name: '劳动节', date: '2027-05-06', isOffDay: false }); // 周四调休上班
  const storage = memStore();
  const i = harness({ storage, fetchImpl: byHost({ '2027.json': resp(bad), '2026.json': resp(fx('holiday-cn-2026.json')) }) });
  await i.api.checkNow();
  assert.equal(i.last().result.text, '来源数据不完整，已拒绝，未采用');
  assert.match(i.last().result.detail, /调休上班日不在周六或周日/);
  assert.equal(i.tables()[2027], undefined);
  assert.equal(loadOnlineTables(storage).tables[2027], undefined);
});

test('manual check: added 2027 then same; online year refreshed when upstream changed', async () => {
  let body = file2027();
  const h = harness({ fetchImpl: byHost({ '2027.json': () => resp(body), '2026.json': resp(fx('holiday-cn-2026.json')) }) });
  await h.api.checkNow();
  assert.equal(h.last().result.text, '已更新：新增 2027 年假期表');
  await h.api.checkNow();
  assert.equal(h.last().result.text, '已是最新 · 刚刚检查过');
  body = file2027();
  body.days.push({ name: '清明节', date: '2027-04-05', isOffDay: true });
  await h.api.checkNow();
  assert.equal(h.last().result.text, '已更新：2027 年假期表有新版本，已采用');
  assert.equal(h.tables()[2027].off['2027-04-05'], '清明节');
});

test('auto + manual concurrently: run one after the other, 2027 applied once', async () => {
  let n = 0;
  const h = harness({ fetchImpl: byHost({ '2027.json': () => { n++; return resp(file2027()); }, '2026.json': resp(fx('holiday-cn-2026.json')) }) });
  const a = h.api.autoCheckIfNeeded();
  const b = h.api.checkNow();
  await Promise.all([a, b]);
  assert.equal(h.last().result.text, '已是最新 · 刚刚检查过', 'manual ran after auto and found nothing new');
  assert.equal(h.tablesSeen.filter((x) => x[2027]).length, 1, 'applied once');
  assert.equal(n, 2);
});

test('importFile: success / rejected / no year / built-in year / not JSON', () => {
  const storage = memStore();
  const h = harness({ storage, fetchImpl: async () => { throw new Error('no'); } });
  assert.deepEqual(h.api.importFile(JSON.stringify(file2027())), { ok: true, year: 2027 });
  assert.equal(h.last().result.text, '已导入 2027 年假期表（放假 3 天，调休上班 1 天）');
  assert.equal(h.last().result.tone, 'success');
  assert.equal(h.tables()[2027].source, 'online');
  assert.equal(loadOnlineTables(storage).meta[2027].source, 'file');
  assert.match(h.last().line, /2027 已导入文件/);

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
  assert.equal(h.last().customSummary, '自定义网址：未设置');
  assert.deepEqual(h.api.setCustomUrl('http://x/{year}'), { ok: false, reason: '网址必须以 https:// 开头，并包含 {year}' });
  assert.equal(loadCustomUrl(storage), null);
  assert.deepEqual(h.api.setCustomUrl('https://mirror.example.org/{year}.json'), { ok: true });
  assert.equal(loadCustomUrl(storage), 'https://mirror.example.org/{year}.json');
  assert.equal(h.last().customSummary, '自定义网址：mirror.example.org');
  assert.equal(h.last().customUrl, 'https://mirror.example.org/{year}.json');
  assert.deepEqual(h.api.setCustomUrl(''), { ok: true });
  assert.equal(loadCustomUrl(storage), null);
});

test('reload (other tab changed the holidays key): re-read tables, no storage write', () => {
  const storage = memStore();
  const h = harness({ storage, fetchImpl: async () => { throw new Error('no'); } });
  const other = memStore();
  saveOnlineYear(other, 2027, { table: validateHolidayYear(file2027(), 2027).table, papers: file2027().papers, source: 'x', fetchedAt: 1 });
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
