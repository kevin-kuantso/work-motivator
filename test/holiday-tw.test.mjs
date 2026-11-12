// 台湾办公日历 provider（holiday-data-tw.js / holidays-tw.js）：内建年表与官方 CSV 逐日对照、
// 严格 CSV 验证、内建表合并。全部离線：只读本机 fixture，不连网（线上检查已移除）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  TW_BUILTIN_TABLES, TW_BUILTIN_YEARS, TW_BUILTIN_SOURCES, TW_DATASET,
} from '../src/holidays-tw.js';
import {
  TW_CSV_HEADER, TW_MAX_BYTES, DEFAULT_TW_LABELS,
  validateTwYear, parseTwCsv, mergeTwTables,
} from '../src/holiday-data-tw.js';

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url));
const fixtureText = (name) => fixture(name).toString('utf8');

// ---- 内建静态年表 ----

test('builtin tables: 2026 and 2027 only, frozen, flat date->name maps, empty makeup', () => {
  assert.deepEqual([...TW_BUILTIN_YEARS], [2026, 2027]);
  assert.deepEqual(Object.keys(TW_BUILTIN_TABLES), ['2026', '2027']);
  for (const year of TW_BUILTIN_YEARS) {
    const tb = TW_BUILTIN_TABLES[year];
    assert.equal(tb.source, 'builtin');
    assert.ok(Object.isFrozen(tb) && Object.isFrozen(tb.off) && Object.isFrozen(tb.makeup));
    assert.deepEqual(tb.makeup, {});
    assert.ok(Object.keys(tb.off).length > 0);
    for (const [date, name] of Object.entries(tb.off)) {
      assert.match(date, /^\d{4}-\d{2}-\d{2}$/);
      assert.equal(date.slice(0, 4), String(year));
      assert.equal(typeof name, 'string');
      assert.equal(name, name.trim());
      assert.notEqual(name, '');
    }
  }
  assert.equal(Object.keys(TW_BUILTIN_TABLES[2026].off).length, 22);
  assert.equal(Object.keys(TW_BUILTIN_TABLES[2027].off).length, 24);
});

test('builtin tables equal the official CSV day by day (2026 / 2027 fixtures)', () => {
  for (const [year, name] of [[2026, 'tw-2026-official.csv'], [2027, 'tw-2027-official.csv']]) {
    const parsed = parseTwCsv(fixtureText(name), { expectedYear: year });
    assert.equal(parsed.ok, true, `parse failed: ${parsed.code}`);
    assert.equal(parsed.years.length, 1);
    assert.equal(parsed.years[0], year);
    assert.deepEqual(parsed.tables[String(year)].off, TW_BUILTIN_TABLES[year].off);
    assert.deepEqual(parsed.tables[String(year)].makeup, TW_BUILTIN_TABLES[year].makeup);
  }
});

test('builtin spot checks: 2027-02-04 off, 2027-02-11 workday, 2027-04-30 makeup-holiday label, 2026 小年夜', () => {
  assert.equal(TW_BUILTIN_TABLES[2027].off['2027-02-04'], '小年夜');
  assert.equal(TW_BUILTIN_TABLES[2026].off['2026-02-15'], '小年夜');
  assert.equal(Object.hasOwn(TW_BUILTIN_TABLES[2027].off, '2027-02-11'), false);
  assert.equal(Object.hasOwn(TW_BUILTIN_TABLES[2027].makeup, '2027-02-11'), false);
  assert.equal(TW_BUILTIN_TABLES[2027].off['2027-04-30'], '補假');
  assert.equal(TW_BUILTIN_TABLES[2027].off['2027-02-28'], '和平紀念日');
  assert.equal(TW_BUILTIN_TABLES[2026].off['2026-10-25'], '臺灣光復暨金門古寧頭大捷紀念日');
});

test('attribution: dataset identity, licence, unresolved legal review, per-year source records', () => {
  assert.equal(TW_DATASET.id, 14718);
  assert.equal(TW_DATASET.identifier, 'A58000000A-000166');
  assert.equal(TW_DATASET.publisher, '行政院人事行政總處');
  assert.equal(TW_DATASET.legalReview, 'unresolved');
  assert.equal(TW_DATASET.license, '政府資料開放授權條款－第1版');
  assert.equal(TW_DATASET.licenseUrl, 'https://data.gov.tw/license'); // 只供畫面顯示與標示
  for (const year of TW_BUILTIN_YEARS) {
    const src = TW_BUILTIN_SOURCES[year];
    assert.equal(src.rocYear, year - 1911);
    assert.equal(src.rows, 365);
    assert.equal(src.encoding, 'UTF-8');
    assert.match(src.retrievedAt, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(src.updatedAt, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    // 出處網址只寫在資料裡供畫面顯示與使用者手動下載；程式不會去抓（線上檢查已移除）。
    assert.match(src.url, /^https:\/\/www\.dgpa\.gov\.tw\/FileConversion\?filename=dgpa\/files\/\d{6}\/[A-Za-z0-9-]+\.csv/);
  }
});

// ---- CSV 解析 ----

const TOKENS = ['日', '一', '二', '三', '四', '五', '六'];
const pad = (n) => String(n).padStart(2, '0');
// 造一份「全年逐日」的官方格式 CSV；decide(key, dow) 回 { status, remark }。
// 未指定的日子照官方慣例：週一到週五上班（0）、週六日放假（2，無名稱，交給週末規則）。
const defaultRow = (dow) => ({ status: dow === 0 || dow === 6 ? '2' : '0' });
function fullYearCsv(year, decide = () => null) {
  const lines = [TW_CSV_HEADER.join(',')];
  for (let d = new Date(Date.UTC(year, 0, 1)); d.getUTCFullYear() === year; d.setUTCDate(d.getUTCDate() + 1)) {
    const y = d.getUTCFullYear();
    const mo = d.getUTCMonth() + 1;
    const day = d.getUTCDate();
    const key = `${y}-${pad(mo)}-${pad(day)}`;
    const row = decide(key, d.getUTCDay()) ?? defaultRow(d.getUTCDay());
    lines.push([`${y}${pad(mo)}${pad(day)}`, TOKENS[d.getUTCDay()], row.status, row.remark ?? ''].join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
}
const fixtureLines = (name) => fixtureText(name).split('\r\n');
const joinLines = (lines) => lines.join('\r\n');

test('parseTwCsv: official CSV with BOM and CRLF is accepted; tables are year-keyed strings', () => {
  const text = fixtureText('tw-2026-official.csv');
  assert.equal(text.charCodeAt(0), 0xFEFF);
  assert.ok(text.includes('\r\n'));
  const r = parseTwCsv(text);
  assert.equal(r.ok, true);
  assert.deepEqual(r.years, [2026]);
  assert.deepEqual(Object.keys(r.tables), ['2026']);
  assert.deepEqual(r.labels, DEFAULT_TW_LABELS);
});

test('parseTwCsv: multiple years in one file are accepted, each must be complete', () => {
  const rows2026 = fixtureLines('tw-2026-official.csv').filter(Boolean);
  const rows2027 = fixtureLines('tw-2027-official.csv').filter(Boolean).slice(1); // 去掉重复的表头
  const text = joinLines([...rows2026, ...rows2027]) + '\r\n';
  const r = parseTwCsv(text);
  assert.equal(r.ok, true, `parse failed: ${r.code}`);
  assert.deepEqual(r.years, [2026, 2027]);
  assert.deepEqual(r.tables['2027'].off, TW_BUILTIN_TABLES[2027].off);
});

test('parseTwCsv: quoted remarks keep commas and line breaks (CRLF normalized to LF); other control chars are refused', () => {
  const comma = fullYearCsv(2028, (key) => (key === '2028-01-03'
    ? { status: '2', remark: '"A,B"' } : null));
  const ok = parseTwCsv(comma);
  assert.equal(ok.ok, true, `parse failed: ${ok.code}`);
  assert.equal(ok.tables['2028'].off['2028-01-03'], 'A,B');

  // 標準 CSV 的引號欄位本來就可以跨行（官方備註也可能這樣），換行一律正規化成 LF 後保留。
  const multiline = fullYearCsv(2028, (key) => (key === '2028-01-03'
    ? { status: '2', remark: '"A\r\nC"' } : null));
  const wrapped = parseTwCsv(multiline);
  assert.equal(wrapped.ok, true, `parse failed: ${wrapped.code}`);
  assert.equal(wrapped.tables['2028'].off['2028-01-03'], 'A\nC');

  // 其餘控制字元（TAB、ESC、DEL…）仍然不允許：整份拒絕，碼與儲存層一致。
  const tabbed = fullYearCsv(2028, (key) => (key === '2028-01-03'
    ? { status: '2', remark: '"A\tC"' } : null));
  const bad = parseTwCsv(tabbed);
  assert.equal(bad.ok, false);
  assert.equal(bad.code, 'name');
  assert.deepEqual(bad.params, { date: '2028-01-03' });
});

test('weekend/status semantics: unnamed weekend off stays out, weekend work becomes makeup, weekday off gets the label', () => {
  // 2028-01-01 是星期六、2028-01-02 是星期日、2028-01-03 是星期一。
  const text = fullYearCsv(2028, (key) => {
    if (key === '2028-01-01') return { status: '2' }; // 无名称且是周末 → 交给周末规则，不进表
    if (key === '2028-01-02') return { status: '0' }; // 周末上班 → 补班
    if (key === '2028-01-03') return { status: '2' }; // 平日放假、无名称 → 一般文字
    if (key === '2028-01-04') return { status: '0', remark: '補行上班' }; // 平日上班 → 不进表
    return null;
  });
  const r = parseTwCsv(text, { labels: { off: '放假囉', makeup: '要上班' } });
  assert.equal(r.ok, true, `parse failed: ${r.code}`);
  assert.deepEqual(r.tables['2028'].off, { '2028-01-03': '放假囉' });
  assert.deepEqual(r.tables['2028'].makeup, { '2028-01-02': '要上班' });
});

test('parseTwCsv rejects broken files with stable codes (never throws)', () => {
  const good = fixtureLines('tw-2026-official.csv');
  const body = good.slice(0, -2); // 去掉最后一行数据与结尾空行

  const missing = parseTwCsv(joinLines([...body, '']));
  assert.equal(missing.ok, false);
  assert.equal(missing.code, 'missingDay');
  assert.deepEqual(missing.params, { date: '2026-12-31' });

  const duplicate = parseTwCsv(joinLines([...good.slice(0, -1), good[good.length - 2], '']));
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.code, 'duplicateDay');
  assert.deepEqual(duplicate.params, { date: '2026-12-31' });

  const badDate = parseTwCsv(fixtureText('tw-2026-official.csv').replace('20260101', '20260230'));
  assert.equal(badDate.ok, false);
  assert.equal(badDate.code, 'badDate');
  assert.deepEqual(badDate.params, { date: '20260230' });

  const badWeekday = parseTwCsv(fixtureText('tw-2026-official.csv').replace('20260101,四,', '20260101,三,'));
  assert.equal(badWeekday.ok, false);
  assert.equal(badWeekday.code, 'badWeekday');
  assert.deepEqual(badWeekday.params, { date: '2026-01-01' });

  const unknownStatus = parseTwCsv(fixtureText('tw-2026-official.csv').replace('20260101,四,2,', '20260101,四,1,'));
  assert.equal(unknownStatus.ok, false);
  assert.equal(unknownStatus.code, 'unknownStatus');
  assert.deepEqual(unknownStatus.params, { date: '2026-01-01' });

  const wrongYear = parseTwCsv(fixtureText('tw-2027-official.csv'), { expectedYear: 2026 });
  assert.equal(wrongYear.ok, false);
  assert.equal(wrongYear.code, 'wrongYear');
  assert.deepEqual(wrongYear.params, { year: 2027 });

  const badHeader = parseTwCsv(fixtureText('tw-2026-official.csv').replace('西元日期', '日期'));
  assert.equal(badHeader.ok, false);
  assert.equal(badHeader.code, 'notCsv');

  const shortRow = parseTwCsv(fixtureText('tw-2026-official.csv').replace('20260101,四,2,開國紀念日', '20260101,四,2'));
  assert.equal(shortRow.ok, false);
  assert.equal(shortRow.code, 'badRowShape');

  const empty = parseTwCsv('');
  assert.equal(empty.ok, false);
  assert.equal(empty.code, 'notCsv');

  const notText = parseTwCsv(null);
  assert.equal(notText.ok, false);
  assert.equal(notText.code, 'notText');
  assert.equal(notText.format, false);

  const tooBig = parseTwCsv('x'.repeat(TW_MAX_BYTES + 1));
  assert.equal(tooBig.ok, false);
  assert.equal(tooBig.code, 'tooLarge');
  assert.equal(tooBig.format, false);

  const tooManyRows = parseTwCsv(['a', ...Array.from({ length: 3660 }, () => 'a')].join('\n'));
  assert.equal(tooManyRows.ok, false);
  assert.equal(tooManyRows.code, 'tooLarge');

  const noYear = parseTwCsv(TW_CSV_HEADER.join(','));
  assert.equal(noYear.ok, false);
  assert.equal(noYear.code, 'noYear');
});

test('validateTwYear reports the storage-compatible codes', () => {
  const ok = validateTwYear(2026, { off: { '2026-01-01': '開國紀念日' }, makeup: {} });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.counts, { off: 1, makeup: 0 });

  const code = (year, table) => {
    const r = validateTwYear(year, table);
    assert.equal(r.ok, false);
    return r.code;
  };
  assert.equal(code(26, { off: {}, makeup: {} }), 'year');
  assert.equal(code(2026, null), 'table');
  assert.equal(code(2026, { off: [], makeup: {} }), 'offShape');
  assert.equal(code(2026, { off: { '2026-01-01': 'x' }, makeup: [] }), 'makeupShape');
  assert.equal(code(2026, { off: { '2026/01/01': 'x' }, makeup: {} }), 'dateKey');
  assert.equal(code(2026, { off: { '2026-02-30': 'x' }, makeup: {} }), 'dateNotReal');
  assert.equal(code(2026, { off: { '2027-01-01': 'x' }, makeup: {} }), 'dateOutOfYear');
  assert.equal(code(2026, { off: { '2026-01-01': '  ' }, makeup: {} }), 'name');
  assert.equal(code(2026, { off: { '2026-01-01': 'x' }, makeup: { '2026-01-01': 'y' } }), 'duplicate');
  assert.equal(code(2026, { off: {}, makeup: { '2026-01-03': '補班' } }), 'emptyOff');
});

// ---- 合并 ----

test('mergeTwTables: builtin wins, stored tables validated one by one, builtin objects never mutated', () => {
  const before = JSON.stringify(TW_BUILTIN_TABLES);
  const stored = {
    2026: { off: { '2026-01-02': '線上版' }, makeup: {}, source: 'online', fetchedAt: 1 },
    2028: { off: { '2028-01-03': '放假' }, makeup: { '2028-01-08': '補班' }, source: 'file', fetchedAt: 42 },
    2029: { off: { '2030-01-01': '壞掉' }, makeup: {}, source: 'online' }, // 日期不屬於該年 → 丟棄
    2030: { off: {}, makeup: {}, source: 'online' },
    2031: { off: { '2031-01-01': '來源不明' }, makeup: {}, source: 'import' },
    abc: { off: { '2026-01-01': 'x' }, makeup: {}, source: 'online' },
    2032: null,
  };
  const merged = mergeTwTables(TW_BUILTIN_TABLES, stored);
  assert.equal(merged[2026].source, 'builtin');
  assert.deepEqual(merged[2026].off, TW_BUILTIN_TABLES[2026].off);
  assert.equal(merged[2027].source, 'builtin');
  assert.deepEqual(merged[2028], {
    off: { '2028-01-03': '放假' },
    makeup: { '2028-01-08': '補班' },
    source: 'file',
    fetchedAt: 42,
  });
  assert.equal(Object.hasOwn(merged, '2029'), false, 'bad table dropped');
  assert.equal(Object.hasOwn(merged, '2030'), false, 'empty off dropped');
  assert.equal(Object.hasOwn(merged, '2031'), false, 'unknown source dropped');
  assert.equal(Object.hasOwn(merged, 'abc'), false);
  assert.equal(Object.hasOwn(merged, '2032'), false);
  assert.equal(JSON.stringify(TW_BUILTIN_TABLES), before, 'builtin tables untouched');
  // 合并结果里的 map 是副本，改它不会改到内建表
  merged[2026].off['2026-12-31'] = '改壞';
  assert.equal(Object.hasOwn(TW_BUILTIN_TABLES[2026].off, '2026-12-31'), false);
});
