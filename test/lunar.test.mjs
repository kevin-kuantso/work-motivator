import test from 'node:test';
import assert from 'node:assert/strict';
import { lunarDate } from '../src/lunar.js';
import { readFileSync } from 'node:fs';

// HKO Gregorian-Lunar Calendar Conversion Tables, 2020–2060, AS IS.
const monthStarts = JSON.parse(readFileSync(new URL('./lunar-month-starts.json', import.meta.url), 'utf8'));

const localDate = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d, 12); };

test('lunar conversion handles new years, leap months and known ICU disagreements', () => {
  for (const [date, expected] of [
    ['2020-01-01', { month: 12, day: 7, leap: false }],
    ['2020-01-25', { month: 1, day: 1, leap: false }],
    ['2020-05-23', { month: 4, day: 1, leap: true }],
    ['2026-11-03', { month: 9, day: 25, leap: false }],
    ['2027-02-06', { month: 1, day: 1, leap: false }],
    ['2030-02-03', { month: 1, day: 1, leap: false }],
  ]) assert.deepEqual(lunarDate(localDate(date)), expected, date);
});

test('every supported HKO month start, including all 41 lunar new years', () => {
  assert.equal(monthStarts.length, 506);
  assert.equal(monthStarts.filter(([, month, leap]) => month === 1 && !leap).length, 41);
  for (const [date, month, leap] of monthStarts) {
    assert.deepEqual(lunarDate(localDate(date)), { month, day: 1, leap: Boolean(leap) }, date);
  }
});

test('lunar coverage excludes the unsupported range and uncertain 2057 month', () => {
  assert.equal(lunarDate(localDate('2019-12-31')), null);
  assert.equal(lunarDate(localDate('2061-01-01')), null);
  assert.notEqual(lunarDate(localDate('2057-09-27')), null);
  assert.equal(lunarDate(localDate('2057-09-28')), null);
  assert.equal(lunarDate(localDate('2057-10-27')), null);
  assert.notEqual(lunarDate(localDate('2057-10-28')), null);
  assert.equal(lunarDate(new Date(NaN)), null);
});
