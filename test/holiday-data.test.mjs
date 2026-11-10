import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  validateHolidayYear, mergeTables, fetchHolidayYear, yearsToAutoCheck, DEFAULT_HOLIDAY_SOURCES,
} from '../src/holiday-data.js';
import {
  loadOnlineTables, saveOnlineYear, loadLastCheck, saveLastCheck, HOLIDAYS_STORAGE_KEY,
} from '../src/holiday-store.js';
import { STRINGS } from '../src/strings.zh-CN.js';
import { HOLIDAYS_CN } from '../src/holidays-cn.js';
import { dayInfo, workdaysInMonth } from '../src/calendar.js';
import { snapshot } from '../src/calc.js';

const fx = (n) => JSON.parse(readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8'));
const real2026 = () => fx('holiday-cn-2026.json');
const cfg = { weekends: false };
const okFile = () => ({
  year: 2027, papers: ['https://www.gov.cn/a.htm'],
  days: [{ name: '元旦', date: '2027-01-01', isOffDay: true }, { name: '元旦', date: '2027-01-02', isOffDay: false }],
});
const fixDay = (d) => ({ name: '春节', date: '2027-02-06', isOffDay: true, ...d });

test('real 2026 file passes and equals built-in table day by day', () => {
  const r = validateHolidayYear(real2026(), 2026);
  assert.equal(r.ok, true);
  // 日期逐日一致（节日名称的叫法允许不同，例如「清明节」与「清明」）
  assert.deepEqual(Object.keys(r.table.off).sort(), Object.keys(HOLIDAYS_CN[2026].off).sort());
  assert.deepEqual(Object.keys(r.table.makeup).sort(), Object.keys(HOLIDAYS_CN[2026].makeup).sort());
  assert.equal(Object.keys(r.table.off).length, 33);
  assert.equal(Object.keys(r.table.makeup).length, 6);
  assert.deepEqual(r.papers, ['https://www.gov.cn/zhengce/zhengceku/202511/content_7047091.htm']);
});

test('empty 2027 file is rejected', () => {
  const r = validateHolidayYear(fx('holiday-cn-2027-empty.json'), 2027);
  assert.equal(r.ok, false);
  assert.ok(r.reason.length > 0);
});

test('rejections (no coercion, whole file)', () => {
  const rej = (mut, year = 2027) => {
    const j = okFile();
    mut(j);
    const r = validateHolidayYear(j, year);
    assert.equal(r.ok, false);
    assert.match(r.reason, /[一-鿿]/);
    assert.doesNotMatch(r.reason, /isOffDay|papers|undefined|\[object/);
    return r;
  };
  rej((j) => { j.papers = ['http://www.gov.cn/a']; });
  rej((j) => { j.papers = ['javascript:alert(1)']; });
  rej((j) => { j.papers = ['https://www.gov.cn.evil.com/a']; });
  rej((j) => { j.papers = ['https://evil.com/https://www.gov.cn/']; });
  rej((j) => { j.papers = [1]; });
  rej((j) => { j.papers = []; });
  rej((j) => { delete j.papers; });
  rej((j) => { j.days = []; });
  rej((j) => { delete j.days; });
  rej((j) => { j.year = '2027'; });
  rej((j) => { j.year = 2026; });
  rej((j) => { j.days[1].date = '2027-01-04'; }); // 周一调休
  rej((j) => { j.days[1].date = '2027-01-01'; }); // 重复
  rej((j) => { j.days[0].date = '2026-12-31'; });
  rej((j) => { j.days[0].date = '2027-02-30'; });
  rej((j) => { j.days[0].date = '2027-1-1'; });
  rej((j) => { j.days[0].date = 20270101; });
  rej((j) => { j.days[0].isOffDay = 'true'; });
  rej((j) => { j.days[0].isOffDay = 1; });
  rej((j) => { j.days[0].name = ''; });
  rej((j) => { j.days[0].name = '一二三四五六七八九十一'; });
  rej((j) => { j.days[0].name = 5; });
  rej((j) => { j.days[0] = null; });
  rej((j) => { j.days[0] = 'x'; });
  rej((j) => { j.days = {}; });
  rej((j) => { j.days[0].name = 'x'.repeat(1e6); });
  const ok = validateHolidayYear(okFile(), 2027);
  assert.equal(ok.ok, true); // 2027-01-02 是周六
});

test('file with only make-up days (no off days) is rejected with the specific reason', () => {
  const j = okFile();
  j.days = [{ name: '元旦', date: '2027-01-09', isOffDay: false }]; // 周六
  const r = validateHolidayYear(j, 2027);
  assert.equal(r.ok, false);
  assert.equal(r.reason, STRINGS.holidayData.noOffDays);
});

test('non-object and hostile inputs never throw', () => {
  for (const v of [null, undefined, 5, 'x', [], [1], true]) {
    assert.equal(validateHolidayYear(v, 2027).ok, false);
  }
  const hostile = JSON.parse('{"__proto__":{"x":1},"year":2027,"papers":["https://www.gov.cn/a"],"days":[{"__proto__":{},"name":"a","date":"2027-01-01","isOffDay":true}]}');
  const r = validateHolidayYear(hostile, 2027);
  assert.equal(r.ok, true);
  assert.equal(Object.getPrototypeOf(r.table.off), Object.prototype);
  assert.equal({}.x, undefined);
});

test('years 0-99 dates are handled as real dates', () => {
  const j = okFile();
  j.year = 50;
  j.days = [{ name: '元旦', date: '0050-01-01', isOffDay: true }];
  assert.equal(validateHolidayYear(j, 50).ok, true);
  j.days = [{ name: '元旦', date: '0050-02-29', isOffDay: true }];
  assert.equal(validateHolidayYear(j, 50).ok, false);
});

test('mergeTables: built-in wins, online fills other years, source preserved', () => {
  const b = { 2026: { off: { a: 'b' }, makeup: {}, source: 'builtin' } };
  const o = {
    2026: { off: {}, makeup: {}, source: 'online' },
    2027: { off: { c: 'd' }, makeup: {}, source: 'online' },
  };
  const m = mergeTables(b, o);
  assert.equal(m[2026].source, 'builtin');
  assert.equal(m[2027].source, 'online');
  assert.equal(HOLIDAYS_CN[2026].source, 'builtin');
});

// ---- fetch ----
const resp = (body, ok = true, status = 200) => ({ ok, status, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });
const SRC = ['https://a/{year}.json', 'https://b/{year}.json'];

test('fetch: first fails, second wins; no-store; source url returned', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push([url, init]);
    if (url.startsWith('https://a/')) throw new TypeError('net');
    return resp(okFile());
  };
  const r = await fetchHolidayYear(2027, { sources: SRC, fetchImpl });
  assert.equal(r.ok, true);
  assert.equal(r.source, 'https://b/2027.json');
  assert.deepEqual(calls.map((c) => c[0]), ['https://a/2027.json', 'https://b/2027.json']);
  assert.equal(calls[0][1].cache, 'no-store');
  assert.ok(calls[0][1].signal);
});

test('fetch: HTTP error, non-JSON, empty file all fall through; all fail -> reason', async () => {
  const bodies = [resp('', false, 404), resp('<html>'), resp(fx('holiday-cn-2027-empty.json'))];
  let i = 0;
  const r = await fetchHolidayYear(2027, {
    sources: ['https://a/{year}', 'https://b/{year}', 'https://c/{year}'],
    fetchImpl: async () => bodies[i++],
  });
  assert.equal(r.ok, false);
  assert.match(r.reason, /[一-鿿]/);
  assert.equal(i, 3);
});

test('fetch: empty file rejected then next source accepted', async () => {
  const r = await fetchHolidayYear(2027, {
    sources: SRC,
    fetchImpl: async (u) => (u.startsWith('https://a/') ? resp(fx('holiday-cn-2027-empty.json')) : resp(okFile())),
  });
  assert.equal(r.ok, true);
  assert.equal(r.source, 'https://b/2027.json');
});

test('fetch: timeout aborts and moves on; never throws', async () => {
  const fetchImpl = (url, { signal }) => new Promise((resolve, reject) => {
    if (url.startsWith('https://b/')) return resolve(resp(okFile()));
    signal.addEventListener('abort', () => reject(new Error('aborted')));
  });
  const r = await fetchHolidayYear(2027, { sources: SRC, fetchImpl, timeoutMs: 20 });
  assert.equal(r.ok, true);
  assert.equal(r.source, 'https://b/2027.json');
  const r2 = await fetchHolidayYear(2027, { sources: [SRC[0]], fetchImpl, timeoutMs: 20 });
  assert.equal(r2.ok, false);
  assert.match(r2.reason, /超时/);
  const r3 = await fetchHolidayYear(2027, { sources: [], fetchImpl });
  assert.equal(r3.ok, false);
});

test('default sources', () => {
  assert.equal(DEFAULT_HOLIDAY_SOURCES.length, 3);
  for (const s of DEFAULT_HOLIDAY_SOURCES) assert.ok(s.startsWith('https://') && s.includes('{year}'));
  assert.ok(!DEFAULT_HOLIDAY_SOURCES.some((s) => /ghproxy/i.test(s)));
});

// ---- auto check ----
const only2026 = { 2026: HOLIDAYS_CN[2026] };
test('yearsToAutoCheck', () => {
  // P9：2027 已内置 → 2026-11 起不再为次年抓取
  assert.deepEqual(yearsToAutoCheck(new Date(2026, 10, 4), HOLIDAYS_CN, null), []);
  assert.deepEqual(yearsToAutoCheck(new Date(2027, 0, 4), HOLIDAYS_CN, null), []);
  assert.deepEqual(yearsToAutoCheck(new Date(2028, 0, 4), HOLIDAYS_CN, null), [2028]);
  assert.equal(HOLIDAYS_CN[2027].source, 'builtin');
  assert.deepEqual(yearsToAutoCheck(new Date(2026, 10, 4), only2026, null), [2027]);
  assert.deepEqual(yearsToAutoCheck(new Date(2026, 5, 1), only2026, null), []);
  assert.deepEqual(yearsToAutoCheck(new Date(2027, 0, 4), only2026, null), [2027]);
  const now = new Date(2026, 10, 4, 12);
  assert.deepEqual(yearsToAutoCheck(now, only2026, now.getTime() - 3600e3), []);
  assert.deepEqual(yearsToAutoCheck(now, only2026, now.getTime() - 25 * 3600e3), [2027]);
  assert.deepEqual(yearsToAutoCheck(new Date(2026, 10, 4), { ...only2026, 2027: { off: {}, makeup: {}, source: 'online' } }, null), []);
  assert.deepEqual(yearsToAutoCheck(new Date(2027, 0, 4), {}, null), [2027]);
});

// ---- tables param ----
const t2027 = { 2027: { off: { '2027-01-01': '元旦' }, makeup: { '2027-01-02': '元旦' }, source: 'online' } };
test('tables param drives dayInfo / workdaysInMonth / snapshot; default unchanged', () => {
  const d = new Date(2027, 0, 1);
  assert.equal(dayInfo(d, cfg, {}, only2026).tableMissing, true);
  assert.equal(dayInfo(d, cfg, {}, only2026).source, 'statutory');
  assert.equal(dayInfo(d, cfg, {}, only2026).base, 'rest');
  assert.equal(dayInfo(new Date(2027, 0, 4), cfg, {}, only2026).source, 'rule');
  // 默认（内置 2027 表）：表在，但 1/4 不在表内 → 普通工作日，source 仍是 rule
  assert.equal(dayInfo(d, cfg, {}).source, 'builtin');
  const w = dayInfo(new Date(2027, 0, 4), cfg, {});
  assert.deepEqual([w.tableMissing, w.base, w.reason, w.source], [false, 'work', 'weekday', 'rule']);
  const i = dayInfo(d, cfg, {}, t2027);
  assert.equal(i.base, 'rest');
  assert.equal(i.source, 'online');
  assert.equal(dayInfo(new Date(2027, 0, 2), cfg, {}, t2027).base, 'work');
  assert.equal(dayInfo(d, cfg, { '2027-01-01': 'work' }, t2027).source, 'manual');
  assert.equal(dayInfo(new Date(2026, 0, 1), cfg, {}).source, 'builtin');
  assert.equal(dayInfo(new Date(2026, 0, 5), cfg, {}).source, 'rule');
  assert.notEqual(workdaysInMonth(2027, 0, cfg, {}, t2027), workdaysInMonth(2027, 0, cfg, {}, { 2027: { ...t2027[2027], makeup: {} } }));
  assert.equal(snapshot(new Date(2027, 0, 1, 10), { salary: 6800, start: '08:30', end: '17:00', lunchOn: true, lunchStart: '11:30', lunchEnd: '13:00', weekends: false, payday: null, cheer: '' }, {}, t2027).status, 'restDay');
});

// ---- store ----
const memStore = (init = {}) => {
  const m = { ...init };
  return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = v; }, m };
};
test('store: save/load roundtrip, lastCheck, bad data discarded', () => {
  const s = memStore();
  const v = validateHolidayYear(okFile(), 2027);
  assert.deepEqual(saveOnlineYear(s, 2027, { table: v.table, papers: v.papers, source: 'https://b/2027.json', fetchedAt: 123 }), { ok: true });
  assert.deepEqual(saveLastCheck(s, 456), { ok: true });
  assert.equal(loadLastCheck(s), 456);
  const l = loadOnlineTables(s);
  assert.equal(l.tables[2027].source, 'online');
  assert.deepEqual(l.tables[2027].off, v.table.off);
  assert.deepEqual(l.meta[2027], { source: 'https://b/2027.json', papers: v.papers, fetchedAt: 123 });
  // 另存一年不丢 lastCheck 与旧年份
  saveOnlineYear(s, 2028, { table: { off: { '2028-01-01': '元旦' }, makeup: {} }, papers: ['https://www.gov.cn/x'], source: 'https://b/2028.json', fetchedAt: 1 });
  assert.equal(loadLastCheck(s), 456);
  assert.ok(loadOnlineTables(s).tables[2027] && loadOnlineTables(s).tables[2028]);
  // 坏年份单独丢弃
  const rec = JSON.parse(s.m[HOLIDAYS_STORAGE_KEY]);
  rec.years['2027'].papers = ['http://evil'];
  rec.years['2028'].table.makeup = { '2028-01-03': 'x' }; // 周一调休
  rec.years['abcd'] = {};
  rec.years['2029'] = null;
  s.m[HOLIDAYS_STORAGE_KEY] = JSON.stringify(rec);
  assert.deepEqual(loadOnlineTables(s).tables, {});
});

test('store: junk / throwing storage never throws', () => {
  for (const raw of ['not json', '[]', '{"version":2}', '{"version":1,"years":5}', 'null']) {
    const s = memStore({ [HOLIDAYS_STORAGE_KEY]: raw });
    assert.deepEqual(loadOnlineTables(s).tables, {});
    assert.equal(loadLastCheck(s), null);
    assert.deepEqual(saveLastCheck(s, 5), { ok: true });
    assert.equal(loadLastCheck(s), 5);
  }
  const bad = { getItem() { throw new Error('x'); }, setItem() { throw new Error('x'); } };
  const l = loadOnlineTables(bad);
  assert.deepEqual(l.tables, {});
  assert.equal(l.storageOk, false);
  assert.equal(loadLastCheck(bad), null);
  assert.deepEqual(saveLastCheck(bad, 1), { ok: false });
  assert.deepEqual(saveOnlineYear(bad, 2027, { table: { off: {}, makeup: {} }, papers: [], source: 's', fetchedAt: 1 }), { ok: false });
});
