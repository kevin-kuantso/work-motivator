import test from 'node:test';
import assert from 'node:assert/strict';
import { dayInfo, workdaysInMonth, nextWorkdayInDays } from '../src/calendar.js';

const cfg = { weekends: false };
const d = (y, m, day) => new Date(y, m - 1, day);

test('workdaysInMonth 2026', () => {
  assert.equal(workdaysInMonth(2026, 1, cfg, {}), 16);
  assert.equal(workdaysInMonth(2026, 8, cfg, {}), 22);
  assert.equal(workdaysInMonth(2026, 9, cfg, {}), 18);
  assert.equal(workdaysInMonth(2026, 10, cfg, {}), 21);
});

test('makeup / holiday / names', () => {
  const m = dayInfo(d(2026, 10, 10), cfg, {});
  assert.equal(m.reason, 'makeup');
  assert.equal(m.base, 'work');
  assert.equal(m.holidayName, '国庆');
  assert.equal(dayInfo(d(2026, 10, 3), cfg, {}).base, 'rest');
  assert.equal(dayInfo(d(2026, 10, 1), cfg, {}).holidayName, '国庆');
  assert.equal(dayInfo(d(2026, 10, 1), cfg, {}).reason, 'holiday');
});

test('year missing from table', () => {
  const i = dayInfo(d(2027, 1, 1), cfg, {});
  assert.equal(i.tableMissing, true);
  assert.equal(i.reason, 'weekday');
  assert.equal(i.base, 'work');
  assert.equal(i.holidayName, null);
});

test('marks and weekends', () => {
  const i = dayInfo(d(2026, 10, 1), cfg, { '2026-10-01': 'work' });
  assert.equal(i.base, 'work');
  assert.equal(i.reason, 'override');
  assert.equal(dayInfo(d(2026, 10, 3), { weekends: true }, {}).base, 'rest');
  assert.equal(dayInfo(d(2026, 11, 7), { weekends: true }, {}).base, 'work');
  assert.equal(dayInfo(d(2026, 11, 7), cfg, {}).base, 'rest');
});

test('leave marks keep base work', () => {
  const paid = dayInfo(d(2026, 11, 4), cfg, { '2026-11-04': 'paidLeave' });
  assert.equal(paid.base, 'work');
  assert.equal(paid.leave, 'paid');
  const unpaid = dayInfo(d(2026, 11, 4), cfg, { '2026-11-04': 'unpaidLeave' });
  assert.equal(unpaid.leave, 'unpaid');
  assert.equal(workdaysInMonth(2026, 10, cfg, { '2026-11-04': 'paidLeave' }), 21);
});

test('nextWorkdayInDays', () => {
  assert.equal(nextWorkdayInDays(d(2026, 9, 27), cfg, {}), 1);
  assert.equal(nextWorkdayInDays(d(2026, 10, 3), cfg, {}), 5);
  assert.equal(nextWorkdayInDays(d(2026, 11, 7), cfg, {}), 2);
});

test('weekends:true makes Saturday and Sunday ordinary workdays', () => {
  const w = { weekends: true };
  assert.equal(dayInfo(d(2026, 11, 8), w, {}).base, 'work'); // Sunday
  assert.equal(dayInfo(d(2026, 11, 8), cfg, {}).base, 'rest');
  assert.equal(workdaysInMonth(2026, 10, w, {}), 30);
  const h = dayInfo(d(2026, 10, 3), w, {}); // Saturday inside 国庆
  assert.equal(h.base, 'rest');
  assert.equal(h.reason, 'holiday');
});
