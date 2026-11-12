// 台湾假期表储存（holiday-store-tw.js）：独立键、独立 years / lastCheck、载入逐字段重校验、损坏时保守处理。
// 大陆键 work-motivator-v1-holidays 在这里只是「别人的键」：本模块从不读、从不写。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TW_HOLIDAYS_STORAGE_KEY, FILE_SOURCE, TW_FILE_SOURCE, TW_STORE_VERSION,
  validateTwTable, loadTwTables, saveTwYear, loadTwLastCheck, saveTwLastCheck, mayReplaceTw, resetTwStore,
} from '../src/holiday-store-tw.js';

const CN_KEY = 'work-motivator-v1-holidays';
const CSV = 'https://www.dgpa.gov.tw/FileConversion?filename=dgpa/files/202506/115.csv';

const memStore = (init = {}) => {
  const m = { ...init };
  return { m, getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); } };
};
const throwingStore = () => ({
  getItem() { throw new Error('blocked'); },
  setItem() { throw new Error('blocked'); },
});

// 虚构的台湾表（非官方安排）：2026 有放假与补班，2027 只有放假——官方 115/116 年表本来就没有补班日。
const table2026 = () => ({
  off: {
    '2026-01-01': '中华民国开国纪念日',
    '2026-02-17': '春节',
    '2026-10-25': '台湾光复暨金门古宁头大捷纪念日',
  },
  makeup: { '2026-02-14': '补班' },
});
const table2027 = () => ({ off: { '2027-01-01': '中华民国开国纪念日', '2027-02-04': '小年夜' }, makeup: {} });
const rec = (over = {}) => ({ table: table2026(), papers: [CSV], source: CSV, fetchedAt: 1700000000000, ...over });

test('constants: dedicated TW key, file marker, no custom URL surface', () => {
  assert.equal(TW_HOLIDAYS_STORAGE_KEY, 'work-motivator-v1-holidays-TW');
  assert.notEqual(TW_HOLIDAYS_STORAGE_KEY, CN_KEY);
  assert.equal(FILE_SOURCE, 'file');
  assert.equal(TW_FILE_SOURCE, FILE_SOURCE);
});

test('validateTwTable: official-length names, empty makeup, 200-codepoint cap', () => {
  const v = validateTwTable(2026, table2026());
  assert.equal(v.ok, true);
  assert.deepEqual(v.counts, { off: 3, makeup: 1 });
  assert.equal([...v.table.off['2026-10-25']].length, 15, 'official name length must pass');
  assert.deepEqual(v.table.off, table2026().off);
  const p = validateTwTable(2027, table2027());
  assert.equal(p.ok, true);
  assert.deepEqual(p.table.makeup, {}, 'no make-up workdays is valid');
  assert.equal(validateTwTable(2026, { off: { '2026-01-01': '一'.repeat(200) }, makeup: {} }).ok, true);
  assert.equal(validateTwTable(2027, { off: {}, makeup: {} }).ok, false, 'an empty table is not a year');
});

test('validateTwTable: rejects bad shapes, dates, years, names and overlaps', () => {
  const rej = (year, table, code, date) => {
    const r = validateTwTable(year, table);
    assert.equal(r.ok, false, `${code} ${date ?? ''}`);
    assert.equal(r.reason.code, code);
    if (date !== undefined) assert.equal(r.reason.date, date);
  };
  rej(2026, null, 'table');
  rej(2026, [], 'table');
  rej(2026, { off: [], makeup: {} }, 'offShape');
  rej(2026, { off: {}, makeup: null }, 'makeupShape');
  rej('2026', table2026(), 'year');
  rej(2026.5, table2026(), 'year');
  rej(2026, { off: { '2026-1-02': 'x' }, makeup: {} }, 'dateKey', '2026-1-02');
  rej(2026, { off: { '2026-02-30': 'x' }, makeup: {} }, 'dateNotReal', '2026-02-30');
  rej(2026, { off: { '2027-01-01': 'x' }, makeup: {} }, 'dateOutOfYear', '2027-01-01');
  rej(2026, { off: { '2026-01-01': 'x' }, makeup: { '2026-01-01': 'y' } }, 'duplicate', '2026-01-01');
  rej(2026, { off: { '2026-01-01': '' }, makeup: {} }, 'name', '2026-01-01');
  rej(2026, { off: { '2026-01-01': ' x' }, makeup: {} }, 'name', '2026-01-01');
  rej(2026, { off: { '2026-01-01': 5 }, makeup: {} }, 'name', '2026-01-01');
  rej(2026, { off: { '2026-01-01': '一'.repeat(201) }, makeup: {} }, 'name', '2026-01-01');
  rej(2026, { off: { '2026-01-01': 'a\tb' }, makeup: {} }, 'name', '2026-01-01');
  rej(2026, { off: { '2026-01-01': 'a\r\nb' }, makeup: {} }, 'name', '2026-01-01');
  rej(2026, { off: {}, makeup: { '2026-01-01': 'x' } }, 'emptyOff');
  // 闰年 2 月 29 日是真的，平年不是
  assert.equal(validateTwTable(2028, { off: { '2028-02-29': 'x' }, makeup: {} }).ok, true);
  rej(2027, { off: { '2027-02-29': 'x' }, makeup: {} }, 'dateNotReal', '2027-02-29');
  // 平日补班不在这里禁止（周末/状态的语义由 CSV 层负责）
  assert.equal(validateTwTable(2026, { off: { '2026-01-01': 'x' }, makeup: { '2026-02-11': '补班' } }).ok, true);
});

test('roundtrip: table, provenance, lastCheck in ONE version-1 record', () => {
  const s = memStore();
  assert.deepEqual(saveTwYear(s, 2026, rec({ resourceUpdatedAt: '2025-06-30T15:10:00+08:00' })), { ok: true });
  assert.deepEqual(saveTwLastCheck(s, 1700000000123), { ok: true });
  const raw = JSON.parse(s.m[TW_HOLIDAYS_STORAGE_KEY]);
  assert.equal(raw.version, 1);
  assert.equal(raw.lastCheck, 1700000000123);
  assert.deepEqual(Object.keys(raw.years), ['2026']);
  assert.deepEqual(raw.years['2026'].table, table2026());
  assert.deepEqual(Object.keys(raw.years['2026']).sort(), ['fetchedAt', 'papers', 'resourceUpdatedAt', 'source', 'table'].sort());
  assert.equal('customUrl' in raw, false, 'TW has no custom URL');

  assert.equal(loadTwLastCheck(s), 1700000000123);
  const l = loadTwTables(s);
  assert.equal(l.storageOk, true);
  assert.equal(l.corrupt, false);
  assert.deepEqual(l.tables[2026], { ...table2026(), source: 'online' });
  assert.deepEqual(l.meta[2026], {
    source: CSV, origin: 'online', papers: [CSV], fetchedAt: 1700000000000, resourceUpdatedAt: '2025-06-30T15:10:00+08:00',
  });
  assert.equal(s.m[CN_KEY], undefined, 'CN key never created');
});

test('multiline CSV names survive storage without rewriting', () => {
  const s = memStore();
  const table = { off: { '2026-01-01': 'a\nb' }, makeup: {} };
  assert.deepEqual(saveTwYear(s, 2026, rec({ table })), { ok: true });
  assert.equal(loadTwTables(s).tables[2026].off['2026-01-01'], 'a\nb');
});

test('import is "file"; other years and lastCheck survive later writes', () => {
  const s = memStore();
  saveTwLastCheck(s, 99);
  saveTwYear(s, 2027, { table: table2027(), source: FILE_SOURCE, fetchedAt: 1 });
  saveTwYear(s, 2026, rec());
  const l = loadTwTables(s);
  assert.equal(l.tables[2027].source, 'file');
  assert.equal(l.meta[2027].origin, 'file');
  assert.deepEqual(l.meta[2027].papers, [], 'import records no papers');
  assert.equal(l.tables[2026].source, 'online');
  assert.equal(loadTwLastCheck(s), 99);
  const raw = JSON.parse(s.m[TW_HOLIDAYS_STORAGE_KEY]);
  assert.deepEqual(Object.keys(raw.years).sort(), ['2026', '2027']);
});

test('save: source must be exactly "file" or a parseable https URL', () => {
  const s = memStore();
  const put = (year, source) => saveTwYear(s, year, { table: { off: { [`${year}-01-01`]: 'x' }, makeup: {} }, source, fetchedAt: 1 });
  for (const [i, bad] of ['', 'weird', 'FILE', 'File', 'http://www.dgpa.gov.tw/a.csv', ' https://a/b',
    'https://a/b ', 'https:/x', 'https://', 'javascript:alert(1)', 'data:text/csv,a', 'https://u:p@a/b',
    'https://a/b\n', '//data.gov.tw/a.csv', 42, null].entries()) {
    const r = put(2020 + i, bad);
    assert.equal(r.ok, false, String(bad));
    assert.equal(r.reason, 'invalid');
    assert.equal(r.detail.code, 'source', String(bad));
  }
  assert.equal(put(2026, CSV).ok, true);
  assert.equal(put(2027, FILE_SOURCE).ok, true);
  assert.deepEqual(Object.keys(loadTwTables(s).tables), ['2026', '2027']);
});

test('load: a tampered year is dropped on its own, the rest still loads', () => {
  const s = memStore();
  saveTwYear(s, 2026, rec());
  saveTwYear(s, 2027, { table: table2027(), source: FILE_SOURCE, fetchedAt: 2 });
  const raw = JSON.parse(s.m[TW_HOLIDAYS_STORAGE_KEY]);
  raw.years['2027'].table.off = { '2027-02-30': 'x' }; // 不存在的日期
  raw.years['2030'] = { table: { off: { '2030-01-01': 'x' }, makeup: {} }, source: 'ftp://x', fetchedAt: 1 };
  raw.years['2031'] = { table: { off: { '2031-01-01': 'x' }, makeup: {} }, source: CSV, fetchedAt: 'now' };
  raw.years['2032'] = { table: { off: { '2032-01-01': 'x' }, makeup: {} }, source: CSV, fetchedAt: 1, papers: ['http://x'] };
  raw.years['2033'] = { table: { off: { '2033-01-01': 'x' }, makeup: {} }, source: CSV, fetchedAt: 1, papers: 'nope' };
  raw.years['2034'] = { table: { off: { '2034-01-01': 'x' }, makeup: {} }, source: CSV, fetchedAt: 1, resourceUpdatedAt: 'x\n' };
  raw.years['2035'] = { table: { off: { '2035-01-01': 'x' }, makeup: { '2035-01-01': 'y' } }, source: CSV, fetchedAt: 1 };
  raw.years['2036'] = { table: { off: { '2036-01-01': 'x' }, makeup: {} }, source: CSV, fetchedAt: 1 };
  raw.years['2037'] = { table: { off: { '2037-10-10': '国庆日' }, makeup: {} }, source: CSV, fetchedAt: 1 };
  raw.years['abcd'] = { table: table2027(), source: FILE_SOURCE, fetchedAt: 1 };
  raw.years['2038'] = null;
  s.m[TW_HOLIDAYS_STORAGE_KEY] = JSON.stringify(raw);
  const l = loadTwTables(s);
  assert.deepEqual(Object.keys(l.tables).sort(), ['2026', '2032', '2033', '2034', '2036', '2037']);
  assert.equal(l.tables[2026].source, 'online');
  assert.deepEqual(l.meta[2032].papers, [], 'bad papers drop only that field');
  assert.deepEqual(l.meta[2033].papers, []);
  assert.equal(l.meta[2034].resourceUpdatedAt, undefined, 'a bad supplementary field drops only that field');
  assert.equal(l.corrupt, false, 'valid version with some bad years is not a corrupt record');
});

test('corrupt record: empty load, corrupt:true, every write refused, bytes untouched', () => {
  for (const raw of ['not json', '[]', 'null', '"x"', '0', '{"version":2,"years":{}}', '{"years":{}}', '{"version":"1"}', '{"version":1,"years":[]}']) {
    const s = memStore({ [TW_HOLIDAYS_STORAGE_KEY]: raw });
    const l = loadTwTables(s);
    assert.deepEqual(l.tables, {}, raw);
    assert.deepEqual(l.meta, {}, raw);
    assert.equal(l.corrupt, true, raw);
    assert.equal(l.storageOk, true, raw);
    assert.equal(loadTwLastCheck(s), null, raw);
    assert.deepEqual(saveTwYear(s, 2026, rec()), { ok: false, reason: 'corrupt' }, raw);
    assert.deepEqual(saveTwLastCheck(s, 5), { ok: false, reason: 'corrupt' }, raw);
    assert.equal(s.m[TW_HOLIDAYS_STORAGE_KEY], raw, 'never overwritten');
  }
  // 显式重建是唯一出路；重建后可以正常写
  const s = memStore({ [TW_HOLIDAYS_STORAGE_KEY]: 'garbage' });
  assert.deepEqual(resetTwStore(s), { ok: true });
  assert.deepEqual(JSON.parse(s.m[TW_HOLIDAYS_STORAGE_KEY]), { version: 1, years: {}, lastCheck: null });
  assert.equal(saveTwYear(s, 2026, rec()).ok, true);
  assert.equal(loadTwTables(s).corrupt, false);
});

test('unreadable / unwritable storage: no throw, storageOk:false, writes refused', () => {
  const bad = throwingStore();
  const l = loadTwTables(bad);
  assert.deepEqual(l.tables, {});
  assert.equal(l.storageOk, false);
  assert.equal(l.corrupt, false);
  assert.equal(loadTwLastCheck(bad), null);
  assert.deepEqual(saveTwYear(bad, 2026, rec()), { ok: false, reason: 'storage' });
  assert.deepEqual(saveTwLastCheck(bad, 1), { ok: false, reason: 'storage' });
  assert.deepEqual(resetTwStore(bad), { ok: false, reason: 'storage' });
  // 读得到、写不进（quota）：返回 storage，不当成功，内容不变
  const full = memStore();
  const before = full.m[TW_HOLIDAYS_STORAGE_KEY];
  full.setItem = () => { throw new Error('QuotaExceededError'); };
  assert.deepEqual(saveTwYear(full, 2026, rec()), { ok: false, reason: 'storage' });
  assert.deepEqual(saveTwLastCheck(full, 1), { ok: false, reason: 'storage' });
  assert.equal(full.m[TW_HOLIDAYS_STORAGE_KEY], before);
});

test('invalid save input is refused without touching storage', () => {
  const s = memStore();
  const before = s.m[TW_HOLIDAYS_STORAGE_KEY];
  assert.equal(saveTwYear(s, 2026, null).detail.code, 'record');
  assert.equal(saveTwYear(s, 2026, rec({ table: { off: {}, makeup: {} } })).detail.code, 'emptyOff');
  assert.equal(saveTwYear(s, 2026, rec({ table: null })).detail.code, 'table');
  assert.equal(saveTwYear(s, '2026', rec()).detail.code, 'year');
  assert.equal(saveTwYear(s, 2026, rec({ fetchedAt: NaN })).detail.code, 'fetchedAt');
  assert.equal(saveTwYear(s, 2026, rec({ fetchedAt: '1' })).detail.code, 'fetchedAt');
  assert.equal(saveTwYear(s, 2026, rec({ papers: ['nope'] })).detail.code, 'papers');
  assert.equal(saveTwYear(s, 2026, rec({ papers: Array(9).fill(CSV) })).detail.code, 'papers');
  assert.equal(saveTwYear(s, 2026, rec({ resourceUpdatedAt: 'a\nb' })).detail.code, 'resourceUpdatedAt');
  assert.equal(saveTwYear(s, 2026, rec({ resourceUpdatedAt: 'x'.repeat(65) })).detail.code, 'resourceUpdatedAt');
  assert.equal(saveTwLastCheck(s, -1).detail.code, 'lastCheck');
  assert.equal(saveTwLastCheck(s, '5').reason, 'invalid');
  assert.equal(s.m[TW_HOLIDAYS_STORAGE_KEY], before, 'storage untouched');
});

test('save keeps unreadable sibling years byte-preserved', () => {
  const s = memStore({
    [TW_HOLIDAYS_STORAGE_KEY]: JSON.stringify({ version: 1, lastCheck: null, years: { '2026': { junk: true }, '2027': 5 } }),
  });
  assert.deepEqual(loadTwTables(s).tables, {}, 'unreadable years are not served');
  assert.equal(saveTwYear(s, 2028, { table: { off: { '2028-01-01': 'x' }, makeup: {} }, source: FILE_SOURCE, fetchedAt: 1 }).ok, true);
  const raw = JSON.parse(s.m[TW_HOLIDAYS_STORAGE_KEY]);
  assert.deepEqual(raw.years['2026'], { junk: true }, 'not silently deleted');
  assert.equal(raw.years['2027'], 5);
  assert.equal(raw.years['2028'].source, 'file');
});

test('CN key is untouched by TW reads and writes', () => {
  const cn = { version: 1, years: { 2027: { table: { off: { '2027-10-01': '国庆节' }, makeup: {} }, papers: [CSV], source: 'file', fetchedAt: 1 } }, lastCheck: 7 };
  const s = memStore({ [CN_KEY]: JSON.stringify(cn) });
  loadTwTables(s);
  loadTwLastCheck(s);
  saveTwYear(s, 2026, rec());
  saveTwLastCheck(s, 8);
  resetTwStore(s);
  assert.deepEqual(JSON.parse(s.m[CN_KEY]), cn, 'CN record byte-equivalent');
  assert.equal(loadTwLastCheck(s), null);
  const raw = JSON.parse(s.m[TW_HOLIDAYS_STORAGE_KEY]);
  assert.deepEqual(Object.keys(raw).sort(), ['lastCheck', 'version', 'years']);
  assert.deepEqual(raw.years, {});
});

test('mayReplaceTw: builtin wins, imported beats online, online only fills unprotected years', () => {
  assert.equal(mayReplaceTw({ source: 'builtin' }, CSV), false);
  assert.equal(mayReplaceTw({ source: 'builtin' }, FILE_SOURCE), false);
  assert.equal(mayReplaceTw({ source: 'file' }, CSV), false);
  assert.equal(mayReplaceTw({ source: 'file' }, FILE_SOURCE), true);
  assert.equal(mayReplaceTw({ source: 'online' }, CSV), true);
  assert.equal(mayReplaceTw({ source: 'online' }, FILE_SOURCE), true);
  assert.equal(mayReplaceTw(undefined, CSV), true);
  assert.equal(mayReplaceTw(null, FILE_SOURCE), true);
});

test('load: entry without optional fields still yields sane meta defaults', () => {
  const s = memStore({
    [TW_HOLIDAYS_STORAGE_KEY]: JSON.stringify({
      version: 1,
      lastCheck: 3,
      years: { 2026: { table: { off: { '2026-01-01': '元旦' }, makeup: {} }, source: FILE_SOURCE, fetchedAt: 9 } },
    }),
  });
  const l = loadTwTables(s);
  assert.deepEqual(l.meta[2026], { source: 'file', origin: 'file', papers: [], fetchedAt: 9 });
  assert.equal('resourceUpdatedAt' in l.meta[2026], false);
  assert.equal(TW_STORE_VERSION, 1);
  // 版本不符的记录一定被当成损坏，不会被误读成 v1
  const v2 = memStore({ [TW_HOLIDAYS_STORAGE_KEY]: JSON.stringify({ version: 2, lastCheck: 3, years: {} }) });
  assert.equal(loadTwTables(v2).corrupt, true);
  assert.deepEqual(loadTwTables(v2).tables, {});
});
