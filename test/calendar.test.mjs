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

test('year missing from table: plain rule, nothing invented', () => {
  const i = dayInfo(d(2027, 1, 4), cfg, {});
  assert.equal(i.tableMissing, true);
  assert.equal(i.reason, 'weekday');
  assert.equal(i.base, 'work');
  assert.equal(i.holidayName, null);
  assert.equal(i.source, 'rule');
});

test('R39: fixed-date statutory holidays for years >= 2025 without a table', () => {
  const fixed = [[1, 1, '元旦'], [5, 1, '劳动节'], [5, 2, '劳动节'], [10, 1, '国庆'], [10, 2, '国庆'], [10, 3, '国庆']];
  for (const y of [2027, 2028]) {
    for (const [m, day, name] of fixed) {
      const i = dayInfo(d(y, m, day), cfg, {});
      assert.deepEqual([i.base, i.reason, i.holidayName, i.source, i.tableMissing, i.leave], ['rest', 'holiday', name, 'statutory', true, null], `${y}-${m}-${day}`);
    }
  }
  // 周六 / 周日落在固定日：仍是休息日 / 法定假日，不凭空补假
  assert.equal(dayInfo(d(2027, 5, 1), cfg, {}).reason, 'holiday'); // Saturday
  assert.equal(dayInfo(d(2027, 5, 2), cfg, {}).reason, 'holiday'); // Sunday
  assert.equal(dayInfo(d(2027, 5, 3), cfg, {}).base, 'work', 'no invented compensation day');
  assert.equal(dayInfo(d(2027, 1, 4), cfg, {}).base, 'work');
  // 不猜：春节 / 清明 / 端午 / 中秋
  const sat = dayInfo(d(2027, 2, 6), cfg, {});
  assert.deepEqual([sat.reason, sat.holidayName, sat.source], ['weekend', null, 'rule'], '春节 2027-02-06 is a plain Saturday');
  assert.deepEqual([dayInfo(d(2027, 4, 5), cfg, {}).reason, dayInfo(d(2027, 4, 5), cfg, {}).holidayName], ['weekday', null]);
  assert.equal(dayInfo(d(2027, 4, 5), cfg, {}).base, 'work');
  // 2025 之前不受影响
  const old = dayInfo(d(2024, 1, 1), cfg, {});
  assert.deepEqual([old.base, old.reason, old.holidayName, old.source], ['work', 'weekday', null, 'rule']);
  // 有表的年份由表说了算（2026 不受影响）
  assert.equal(dayInfo(d(2026, 1, 1), cfg, {}).source, 'builtin');
  assert.equal(dayInfo(d(2026, 5, 1), cfg, {}).source, 'builtin');
  // 用户标记优先
  const m = dayInfo(d(2027, 1, 1), cfg, { '2027-01-01': 'work' });
  assert.deepEqual([m.base, m.reason, m.source], ['work', 'override', 'manual']);
  assert.equal(dayInfo(d(2027, 1, 1), cfg, { '2027-01-01': 'paidLeave' }).leave, 'paid');
  // 表存在时不再套用固定日规则（空表 = 表说了算）
  const empty = { 2027: { off: {}, makeup: {}, source: 'online' } };
  const e = dayInfo(d(2027, 1, 1), cfg, {}, empty);
  assert.deepEqual([e.base, e.tableMissing, e.source, e.holidayName], ['work', false, 'rule', null]);
  const online = { 2027: { off: { '2027-01-02': '元旦' }, makeup: {}, source: 'online' } };
  assert.equal(dayInfo(d(2027, 1, 1), cfg, {}, online).base, 'work', 'table is authoritative');
});

test('R39: Jan 2027 has 20 workdays', () => {
  assert.equal(workdaysInMonth(2027, 0, cfg, {}), 20);
  assert.equal(workdaysInMonth(2027, 1, cfg, {}), 20, 'Feb 2027: no guessing for 春节');
  assert.equal(workdaysInMonth(2027, 4, cfg, {}), 21, 'May 2027: 5/1-5/2 fall on the weekend');
  assert.equal(workdaysInMonth(2027, 9, cfg, {}), 20, 'Oct 2027: 10/1 (Fri) rest, 10/2-3 weekend');
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
