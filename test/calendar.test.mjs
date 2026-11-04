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
  // 2025 与 2036 无春节等日期数据：只有这六天
  for (const y of [2025, 2027, 2028, 2036]) {
    for (const [m, day, name] of fixed) {
      const i = dayInfo(d(y, m, day), cfg, {});
      assert.deepEqual([i.base, i.reason, i.holidayName, i.source, i.tableMissing, i.leave], ['rest', 'holiday', name, 'statutory', true, null], `${y}-${m}-${day}`);
      // weekends:true 时它们仍是休息日（法定假日不受周末设置影响）
      const w = dayInfo(d(y, m, day), { weekends: true }, {});
      assert.deepEqual([w.base, w.reason, w.holidayName], ['rest', 'holiday', name], `weekends:true ${y}-${m}-${day}`);
    }
  }
  // 周六 / 周日落在固定日：仍是休息日 / 法定假日，不凭空补假
  assert.equal(dayInfo(d(2027, 5, 1), cfg, {}).reason, 'holiday'); // Saturday
  assert.equal(dayInfo(d(2027, 5, 2), cfg, {}).reason, 'holiday'); // Sunday
  assert.equal(dayInfo(d(2027, 5, 3), cfg, {}).base, 'work', 'no invented compensation day');
  assert.equal(dayInfo(d(2027, 1, 4), cfg, {}).base, 'work');
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

// R40：农历 / 节气定日的法定假日（独立抄录的期望值；星期由 Date 现算，不信任标签）
const WD = ['日', '一', '二', '三', '四', '五', '六'];
const LUNAR = {
  2027: [['春节', '02-05 五', '02-06 六', '02-07 日', '02-08 一'], ['清明', '04-05 一'], ['端午', '06-09 三'], ['中秋', '09-15 三']],
  2028: [['春节', '01-25 二', '01-26 三', '01-27 四', '01-28 五'], ['清明', '04-04 二'], ['端午', '05-28 日'], ['国庆', '10-03 二']],
  2029: [['春节', '02-12 一', '02-13 二', '02-14 三', '02-15 四'], ['清明', '04-04 三'], ['端午', '06-16 六'], ['中秋', '09-22 六']],
  2030: [['春节', '02-02 六', '02-03 日', '02-04 一', '02-05 二'], ['清明', '04-05 五'], ['端午', '06-05 三'], ['中秋', '09-12 四']],
  2031: [['春节', '01-22 三', '01-23 四', '01-24 五', '01-25 六'], ['清明', '04-05 六'], ['端午', '06-24 二'], ['国庆', '10-01 三']],
  2032: [['春节', '02-10 二', '02-11 三', '02-12 四', '02-13 五'], ['清明', '04-04 日'], ['端午', '06-12 六'], ['中秋', '09-19 日']],
  2033: [['春节', '01-30 日', '01-31 一', '02-01 二', '02-02 三'], ['清明', '04-04 一'], ['端午', '06-01 三'], ['中秋', '09-08 四']],
  2034: [['春节', '02-18 六', '02-19 日', '02-20 一', '02-21 二'], ['清明', '04-05 三'], ['端午', '06-20 二'], ['中秋', '09-27 三']],
  2035: [['春节', '02-07 三', '02-08 四', '02-09 五', '02-10 六'], ['清明', '04-05 四'], ['端午', '06-10 日'], ['中秋', '09-16 日']],
};

test('R40: every lunar / solar-term statutory day 2027-2035 is marked, weekday computed independently', () => {
  let n = 0;
  for (const [year, groups] of Object.entries(LUNAR)) {
    for (const [name, ...days] of groups) {
      for (const label of days) {
        const [md, wd] = label.split(' ');
        const [mm, dd] = md.split('-').map(Number);
        const date = d(Number(year), mm, dd);
        assert.equal(WD[date.getDay()], wd, `weekday label of ${year}-${md}`);
        const i = dayInfo(date, cfg, {});
        assert.deepEqual([i.base, i.reason, i.holidayName, i.source, i.tableMissing, i.leave], ['rest', 'holiday', name, 'statutory', true, null], `${year}-${md}`);
        assert.equal(dayInfo(date, { weekends: true }, {}).reason, 'holiday', `weekends:true ${year}-${md}`);
        n++;
      }
    }
  }
  assert.equal(n, 9 * 7);
});

test('R40: collisions with fixed dates use the fixed-date name, marked once', () => {
  assert.equal(dayInfo(d(2028, 10, 3), cfg, {}).holidayName, '国庆');
  assert.equal(dayInfo(d(2031, 10, 1), cfg, {}).holidayName, '国庆');
  assert.equal(workdaysInMonth(2028, 9, cfg, {}), 20, '2028-10: 10/1-10/3 only once each');
});

test('R40: nothing else is invented around the legal days', () => {
  // 2027 春节周末不补假；02-09 仍是普通工作日
  assert.deepEqual([dayInfo(d(2027, 2, 9), cfg, {}).base, dayInfo(d(2027, 2, 9), cfg, {}).reason], ['work', 'weekday']);
  // 清明 2027-04-05 周一才是法定日；04-03 / 04-04 是普通周末
  for (const day of [3, 4]) {
    const i = dayInfo(d(2027, 4, day), cfg, {});
    assert.deepEqual([i.reason, i.holidayName, i.source], ['weekend', null, 'rule'], `2027-04-0${day}`);
  }
  for (const [m, day] of [[9, 14], [9, 16]]) {
    const i = dayInfo(d(2027, m, day), cfg, {});
    assert.deepEqual([i.base, i.reason, i.holidayName], ['work', 'weekday', null]);
  }
  // 数据范围之外：只有六个固定日
  assert.equal(dayInfo(d(2024, 1, 1), cfg, {}).holidayName, null);
  assert.equal(dayInfo(d(2036, 1, 1), cfg, {}).holidayName, '元旦');
  assert.equal(dayInfo(d(2036, 2, 7), cfg, {}).holidayName, null, '2036 has no lunar data');
  assert.equal(dayInfo(d(2025, 1, 29), cfg, {}).holidayName, null, '2025 春节 not guessed (no lunar data for 2025)');
  // 2026 有表：表说了算，不查回退
  assert.equal(dayInfo(d(2026, 6, 19), cfg, {}).source, 'builtin');
});

test('R40: a year with a table never consults the lunar fallback', () => {
  const online = { 2027: { off: { '2027-01-01': '元旦' }, makeup: {}, source: 'online' } }; // 没有春节
  for (const key of [[2027, 2, 5], [2027, 2, 8], [2027, 4, 5], [2027, 6, 9], [2027, 9, 15]]) {
    const i = dayInfo(d(...key), cfg, {}, online);
    assert.deepEqual([i.base, i.reason, i.holidayName, i.tableMissing], ['work', 'weekday', null, false], key.join('-'));
  }
  // 用户标记优先
  const m = dayInfo(d(2027, 2, 5), cfg, { '2027-02-05': 'work' });
  assert.deepEqual([m.base, m.reason, m.source], ['work', 'override', 'manual']);
  const r = dayInfo(d(2027, 2, 9), cfg, { '2027-02-09': 'rest' });
  assert.deepEqual([r.base, r.reason, r.source], ['rest', 'override', 'manual']);
});

test('R39 / R40: 2027 monthly workday counts, 2028 Jan and Oct', () => {
  const got = Array.from({ length: 12 }, (_, m) => workdaysInMonth(2027, m, cfg, {}));
  assert.deepEqual(got, [20, 18, 23, 21, 21, 21, 22, 22, 21, 20, 22, 23]);
  assert.equal(workdaysInMonth(2028, 0, cfg, {}), 17);
  assert.equal(workdaysInMonth(2028, 9, cfg, {}), 20);
  // weekends:true：只扣法定日
  const w = { weekends: true };
  assert.equal(workdaysInMonth(2027, 0, w, {}), 30);
  assert.equal(workdaysInMonth(2027, 4, w, {}), 29);
  assert.equal(workdaysInMonth(2027, 9, w, {}), 28);
});

test('R40: nextWorkdayInDays across the 2027 春节', () => {
  assert.equal(nextWorkdayInDays(d(2027, 2, 4), cfg, {}), 5); // Fri 2/5 + weekend + Mon 2/8 rest -> Tue 2/9
  assert.equal(nextWorkdayInDays(d(2027, 2, 8), cfg, {}), 1);
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
