import test from 'node:test';
import assert from 'node:assert/strict';
import { dayInfo, workdaysInMonth, nextWorkdayInDays } from '../src/calendar.js';
import { HOLIDAYS_CN, STATUTORY_FIXED, STATUTORY_FIXED_FROM_YEAR } from '../src/holidays-cn.js';
import { STATUTORY_LUNAR, statutoryLunarName } from '../src/statutory-dates.js';
import { PROFILES } from '../src/profiles.js';
import { monthWage, snapshot } from '../src/calc.js';

const cfg = { weekends: false };
const d = (y, m, day) => new Date(y, m - 1, day);
const pad = (n) => String(n).padStart(2, '0');
const ymd = (y, m, day) => `${y}-${pad(m)}-${pad(day)}`;

test('Taiwan missing-year weekend and manual override update monthly wages without CN fallback', () => {
  const profile = PROFILES.TW.holidayProvider;
  const tw = { weekends: false, salary: 40000, start: '09:00', end: '18:00', lunchOn: false, holidayProvider: profile };
  const date = d(2028, 10, 1); // Sunday; also a CN statutory holiday.
  const ordinary = dayInfo(date, tw, {}, profile.tables);
  assert.deepEqual([ordinary.tableMissing, ordinary.base, ordinary.reason, ordinary.holidayName], [true, 'rest', 'weekend', null]);
  assert.equal(dayInfo(date, cfg, {}, {}).holidayName, '国庆');
  const marks = { '2028-10-01': 'work' };
  const manual = dayInfo(date, tw, marks, profile.tables);
  assert.deepEqual([manual.base, manual.reason, manual.source], ['work', 'override', 'manual']);
  assert.deepEqual(monthWage(2028, 9, tw, {}, profile.tables), { workdays: 22, dailyWage: 40000 / 22 });
  assert.deepEqual(monthWage(2028, 9, tw, marks, profile.tables), { workdays: 23, dailyWage: 40000 / 23 });
  const now = new Date(2028, 9, 1, 10);
  assert.equal(snapshot(now, tw, {}, profile.tables).status, 'restDay');
  const changed = snapshot(now, tw, marks, profile.tables);
  assert.equal(changed.status, 'working');
  assert.equal(changed.dailyWage, 40000 / 23);
});

// ---- P9：2027 年国办通知发布后内置整年日期表（2026-11 发布；保留无表年份的回退当兜底） ----
// https://www.gov.cn/zhengce/content/202611/content_7085101.htm
const OFF_2027 = [
  ['元旦', 1, 1, 1, 3],
  ['春节', 2, 5, 2, 13],
  ['清明', 4, 3, 4, 5],
  ['劳动节', 5, 1, 5, 5],
  ['端午', 6, 9, 6, 9],
  ['中秋', 9, 15, 9, 15],
  ['国庆', 10, 1, 10, 7],
];
const MAKEUP_2027 = [['春节', 1, 31], ['春节', 2, 14], ['劳动节', 5, 8], ['国庆', 9, 26], ['国庆', 10, 9]];

test('P9: 2027 built-in table is exactly the official notice — 29 rest days in 7 ranges, 5 makeup days', () => {
  const t = HOLIDAYS_CN[2027];
  assert.ok(t, '2027 must be built in');
  assert.equal(t.source, 'builtin');
  const expectedOff = {};
  for (const [name, m1, d1, m2, d2] of OFF_2027) {
    for (let x = new Date(2027, m1 - 1, d1); x <= new Date(2027, m2 - 1, d2); x = new Date(2027, x.getMonth(), x.getDate() + 1)) {
      expectedOff[ymd(2027, x.getMonth() + 1, x.getDate())] = name;
    }
  }
  assert.equal(Object.keys(expectedOff).length, 29);
  assert.deepEqual(t.off, expectedOff);
  const expectedMakeup = {};
  for (const [name, m, day] of MAKEUP_2027) expectedMakeup[ymd(2027, m, day)] = name;
  assert.deepEqual(t.makeup, expectedMakeup);
  // 调休上班日必须落在周六 / 周日（validator 的硬性要求），星期现算
  for (const key of Object.keys(t.makeup)) {
    const [y, m, day] = key.split('-').map(Number);
    assert.ok([0, 6].includes(new Date(y, m - 1, day).getDay()), `${key} must be a weekend`);
  }
  assert.equal(new Set([...Object.keys(t.off), ...Object.keys(t.makeup)]).size, 34, 'no day both rests and works');
});

test('P9: built-in 2027 drives dayInfo — rest days, makeup days, names, source', () => {
  const spring = dayInfo(d(2027, 2, 9), cfg, {});
  assert.deepEqual([spring.base, spring.reason, spring.holidayName, spring.source, spring.tableMissing], ['rest', 'holiday', '春节', 'builtin', false]);
  const span = [[2, 5], [2, 8], [2, 13], [4, 3], [5, 4], [6, 9], [9, 15], [10, 7]];
  for (const [m, day] of span) {
    const i = dayInfo(d(2027, m, day), cfg, {});
    assert.deepEqual([i.base, i.reason, i.source], ['rest', 'holiday', 'builtin'], `${m}-${day}`);
  }
  for (const [m, day] of [[1, 31], [2, 14], [5, 8], [9, 26], [10, 9]]) {
    const i = dayInfo(d(2027, m, day), cfg, {});
    assert.deepEqual([i.base, i.reason, i.holidayName, i.source], ['work', 'makeup', HOLIDAYS_CN[2027].makeup[ymd(2027, m, day)], 'builtin'], `${m}-${day}`);
  }
  // 假期之外恢复普通规则
  assert.deepEqual([dayInfo(d(2027, 2, 10), cfg, {}).reason], ['holiday']);
  assert.deepEqual([dayInfo(d(2027, 2, 15), cfg, {}).base, dayInfo(d(2027, 2, 15), cfg, {}).reason], ['work', 'weekday']);
  assert.deepEqual([dayInfo(d(2027, 4, 6), cfg, {}).base, dayInfo(d(2027, 4, 6), cfg, {}).reason], ['work', 'weekday']);
  assert.deepEqual([dayInfo(d(2027, 10, 8), cfg, {}).base, dayInfo(d(2027, 10, 8), cfg, {}).reason], ['work', 'weekday']);
  // 用户标记仍然优先
  const m = dayInfo(d(2027, 2, 9), cfg, { '2027-02-09': 'work' });
  assert.deepEqual([m.base, m.reason, m.source], ['work', 'override', 'manual']);
});

test('P9: built-in 2027 monthly workday counts', () => {
  assert.deepEqual(Array.from({ length: 12 }, (_, m) => workdaysInMonth(2027, m, cfg, {})),
    [21, 15, 23, 21, 19, 21, 22, 22, 22, 17, 22, 23]);
  const w = { weekends: true };
  assert.deepEqual(Array.from({ length: 12 }, (_, m) => workdaysInMonth(2027, m, w, {})),
    [28, 19, 31, 27, 26, 29, 31, 31, 29, 24, 30, 31]);
});

test('P9: the built-in table supersedes the lunar fallback for 2027; other no-table years keep it', () => {
  assert.equal(STATUTORY_LUNAR[2027], undefined, '2027 no longer needs the fallback data');
  assert.equal(statutoryLunarName('2027-02-05'), null);
  assert.equal(statutoryLunarName('2028-01-25'), 'spring', 'fallback data for later years is untouched');
  assert.deepEqual(Object.keys(STATUTORY_LUNAR).map(Number).sort((a, b) => a - b), [2028, 2029, 2030, 2031, 2032, 2033, 2034, 2035]);
  assert.equal(STATUTORY_FIXED_FROM_YEAR, 2025);
  assert.deepEqual(Object.keys(STATUTORY_FIXED).sort(), ['01-01', '05-01', '05-02', '10-01', '10-02', '10-03']);
  // 没有表时（显式注入不含 2027 的表集合）：只剩固定日回退，2027 不再有农历回退数据
  const only2026 = { 2026: HOLIDAYS_CN[2026] };
  const a = dayInfo(d(2027, 2, 5), cfg, {}, only2026);
  assert.deepEqual([a.base, a.reason, a.holidayName, a.source, a.tableMissing], ['work', 'weekday', null, 'rule', true]);
  const b = dayInfo(d(2027, 1, 1), cfg, {}, only2026);
  assert.deepEqual([b.base, b.reason, b.holidayName, b.source], ['rest', 'holiday', '元旦', 'statutory']);
  assert.equal(dayInfo(d(2027, 5, 2), cfg, {}, only2026).holidayName, '劳动节');
  assert.equal(workdaysInMonth(2027, 1, cfg, {}, only2026), 20);
  // 之后的年份：农历回退照常
  const c = dayInfo(d(2028, 1, 25), cfg, {}, only2026);
  assert.deepEqual([c.base, c.reason, c.holidayName, c.source, c.tableMissing], ['rest', 'holiday', '春节', 'statutory', true]);
});

test('P9: nextWorkdayInDays across the built-in 2027 春节, and the fallback path for 2028', () => {
  assert.equal(nextWorkdayInDays(d(2027, 2, 4), cfg, {}), 10); // 2/5-2/13 rest -> Sun 2/14 调休上班
  assert.equal(nextWorkdayInDays(d(2027, 2, 13), cfg, {}), 1, '2/14 makeup day is a workday');
  const only2026 = { 2026: HOLIDAYS_CN[2026] };
  assert.equal(nextWorkdayInDays(d(2026, 12, 31), cfg, {}, only2026), 4, 'no table: 1/1 fixed statutory + weekend');
  assert.equal(nextWorkdayInDays(d(2028, 1, 24), cfg, {}, only2026), 7); // 1/25-1/28 spring + weekend -> Mon 1/31
});

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

const noTable2027 = { 2026: HOLIDAYS_CN[2026] }; // 显式的不含 2027 表集合：覆盖「没有假期表」的回退路径

test('year missing from table: plain rule, nothing invented', () => {
  const i = dayInfo(d(2027, 1, 4), cfg, {}, noTable2027);
  assert.equal(i.tableMissing, true);
  assert.equal(i.reason, 'weekday');
  assert.equal(i.base, 'work');
  assert.equal(i.holidayName, null);
  assert.equal(i.source, 'rule');
});

test('R39: fixed-date statutory holidays for years >= 2025 without a table', () => {
  const fixed = [[1, 1, '元旦'], [5, 1, '劳动节'], [5, 2, '劳动节'], [10, 1, '国庆'], [10, 2, '国庆'], [10, 3, '国庆']];
  // 2025 与 2036 无春节等日期数据：只有这六天（2027 已有内置表，走表）
  for (const y of [2025, 2028, 2036]) {
    for (const [m, day, name] of fixed) {
      const i = dayInfo(d(y, m, day), cfg, {}, noTable2027);
      assert.deepEqual([i.base, i.reason, i.holidayName, i.source, i.tableMissing, i.leave], ['rest', 'holiday', name, 'statutory', true, null], `${y}-${m}-${day}`);
      // weekends:true 时它们仍是休息日（法定假日不受周末设置影响）
      const w = dayInfo(d(y, m, day), { weekends: true }, {}, noTable2027);
      assert.deepEqual([w.base, w.reason, w.holidayName], ['rest', 'holiday', name], `weekends:true ${y}-${m}-${day}`);
    }
  }
  // 周六 / 周日落在固定日：仍是法定假日，不凭空补假（2028-01-01 六）
  assert.equal(dayInfo(d(2028, 1, 1), cfg, {}, noTable2027).reason, 'holiday');
  // 01-02 不是固定日（元旦 3 天要靠年度通知），只算普通周日
  assert.deepEqual([dayInfo(d(2028, 1, 2), cfg, {}, noTable2027).base, dayInfo(d(2028, 1, 2), cfg, {}, noTable2027).reason], ['rest', 'weekend']);
  assert.equal(dayInfo(d(2028, 1, 3), cfg, {}, noTable2027).base, 'work', 'no invented compensation day');
  assert.equal(dayInfo(d(2028, 1, 4), cfg, {}, noTable2027).base, 'work');
  // 2025 之前不受影响
  const old = dayInfo(d(2024, 1, 1), cfg, {}, noTable2027);
  assert.deepEqual([old.base, old.reason, old.holidayName, old.source], ['work', 'weekday', null, 'rule']);
  // 有表的年份由表说了算（2026 / 2027 都是内置表）
  assert.equal(dayInfo(d(2026, 1, 1), cfg, {}).source, 'builtin');
  assert.equal(dayInfo(d(2026, 5, 1), cfg, {}).source, 'builtin');
  assert.equal(dayInfo(d(2027, 1, 1), cfg, {}).source, 'builtin');
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
  2028: [['春节', '01-25 二', '01-26 三', '01-27 四', '01-28 五'], ['清明', '04-04 二'], ['端午', '05-28 日'], ['国庆', '10-03 二']],
  2029: [['春节', '02-12 一', '02-13 二', '02-14 三', '02-15 四'], ['清明', '04-04 三'], ['端午', '06-16 六'], ['中秋', '09-22 六']],
  2030: [['春节', '02-02 六', '02-03 日', '02-04 一', '02-05 二'], ['清明', '04-05 五'], ['端午', '06-05 三'], ['中秋', '09-12 四']],
  2031: [['春节', '01-22 三', '01-23 四', '01-24 五', '01-25 六'], ['清明', '04-05 六'], ['端午', '06-24 二'], ['国庆', '10-01 三']],
  2032: [['春节', '02-10 二', '02-11 三', '02-12 四', '02-13 五'], ['清明', '04-04 日'], ['端午', '06-12 六'], ['中秋', '09-19 日']],
  2033: [['春节', '01-30 日', '01-31 一', '02-01 二', '02-02 三'], ['清明', '04-04 一'], ['端午', '06-01 三'], ['中秋', '09-08 四']],
  2034: [['春节', '02-18 六', '02-19 日', '02-20 一', '02-21 二'], ['清明', '04-05 三'], ['端午', '06-20 二'], ['中秋', '09-27 三']],
  2035: [['春节', '02-07 三', '02-08 四', '02-09 五', '02-10 六'], ['清明', '04-05 四'], ['端午', '06-10 日'], ['中秋', '09-16 日']],
};

test('R40: every lunar / solar-term statutory day 2028-2035 without a table is marked, weekday computed independently', () => {
  let n = 0;
  for (const [year, groups] of Object.entries(LUNAR)) {
    for (const [name, ...days] of groups) {
      for (const label of days) {
        const [md, wd] = label.split(' ');
        const [mm, dd] = md.split('-').map(Number);
        const date = d(Number(year), mm, dd);
        assert.equal(WD[date.getDay()], wd, `weekday label of ${year}-${md}`);
        const i = dayInfo(date, cfg, {}, noTable2027);
        assert.deepEqual([i.base, i.reason, i.holidayName, i.source, i.tableMissing, i.leave], ['rest', 'holiday', name, 'statutory', true, null], `${year}-${md}`);
        assert.equal(dayInfo(date, { weekends: true }, {}, noTable2027).reason, 'holiday', `weekends:true ${year}-${md}`);
        n++;
      }
    }
  }
  assert.equal(n, 8 * 7);
});

test('R40: collisions with fixed dates use the fixed-date name, marked once', () => {
  assert.equal(dayInfo(d(2028, 10, 3), cfg, {}).holidayName, '国庆');
  assert.equal(dayInfo(d(2031, 10, 1), cfg, {}).holidayName, '国庆');
  assert.equal(workdaysInMonth(2028, 9, cfg, {}), 20, '2028-10: 10/1-10/3 only once each');
});

test('R40: nothing else is invented around the legal days', () => {
  // 2028（无表）：春节周末不补假；01-29 / 01-30 是普通周末，01-24（除夕前一天）是工作日
  for (const day of [29, 30]) {
    const i = dayInfo(d(2028, 1, day), cfg, {}, noTable2027);
    assert.deepEqual([i.reason, i.holidayName, i.source], ['weekend', null, 'rule'], `2028-01-${day}`);
  }
  assert.deepEqual([dayInfo(d(2028, 1, 24), cfg, {}, noTable2027).base, dayInfo(d(2028, 1, 24), cfg, {}, noTable2027).reason], ['work', 'weekday']);
  // 清明 2028-04-04 周二才是法定日；04-01 / 04-02 是普通周末
  for (const day of [1, 2]) {
    const i = dayInfo(d(2028, 4, day), cfg, {}, noTable2027);
    assert.deepEqual([i.reason, i.holidayName, i.source], ['weekend', null, 'rule'], `2028-04-0${day}`);
  }
  for (const [m, day] of [[5, 26], [5, 29]]) {
    const i = dayInfo(d(2028, m, day), cfg, {}, noTable2027);
    assert.deepEqual([i.base, i.reason, i.holidayName], ['work', 'weekday', null]);
  }
  // 数据范围之外：只有六个固定日
  assert.equal(dayInfo(d(2024, 1, 1), cfg, {}, noTable2027).holidayName, null);
  assert.equal(dayInfo(d(2036, 1, 1), cfg, {}, noTable2027).holidayName, '元旦');
  assert.equal(dayInfo(d(2036, 2, 7), cfg, {}, noTable2027).holidayName, null, '2036 has no lunar data');
  assert.equal(dayInfo(d(2025, 1, 29), cfg, {}, noTable2027).holidayName, null, '2025 春节 not guessed (no lunar data for 2025)');
  // 2026 / 2027 有内置表：表说了算，不查回退
  assert.equal(dayInfo(d(2026, 6, 19), cfg, {}).source, 'builtin');
  assert.equal(dayInfo(d(2027, 2, 5), cfg, {}).source, 'builtin');
});

test('R40: a year with a table never consults the lunar fallback', () => {
  // 2028 注入一张只有元旦的表：农历日期不再回退
  const online = { 2028: { off: { '2028-01-01': '元旦' }, makeup: {}, source: 'online' } };
  for (const key of [[2028, 1, 25], [2028, 1, 28], [2028, 4, 4], [2028, 5, 26], [2028, 10, 3]]) {
    const i = dayInfo(d(...key), cfg, {}, online);
    assert.deepEqual([i.base, i.reason, i.holidayName, i.tableMissing], ['work', 'weekday', null, false], key.join('-'));
  }
  // 用户标记优先
  const m = dayInfo(d(2028, 2, 5), cfg, { '2028-02-05': 'work' });
  assert.deepEqual([m.base, m.reason, m.source], ['work', 'override', 'manual']);
  const r = dayInfo(d(2028, 2, 9), cfg, { '2028-02-09': 'rest' });
  assert.deepEqual([r.base, r.reason, r.source], ['rest', 'override', 'manual']);
});

test('R39 / R40: 2027 built-in monthly workday counts, no-table fallback, 2028 Jan and Oct', () => {
  const got = Array.from({ length: 12 }, (_, m) => workdaysInMonth(2027, m, cfg, {}));
  assert.deepEqual(got, [21, 15, 23, 21, 19, 21, 22, 22, 22, 17, 22, 23]);
  // weekends:true：只扣法定日
  const w = { weekends: true };
  assert.deepEqual(Array.from({ length: 12 }, (_, m) => workdaysInMonth(2027, m, w, {})), [28, 19, 31, 27, 26, 29, 31, 31, 29, 24, 30, 31]);
  // 无表回退（显式注入不含 2027 的表集合）：只扣法定日，不猜调休
  assert.deepEqual(Array.from({ length: 12 }, (_, m) => workdaysInMonth(2027, m, cfg, {}, noTable2027)), [20, 20, 23, 22, 21, 22, 22, 22, 22, 20, 22, 23]);
  assert.deepEqual(Array.from({ length: 12 }, (_, m) => workdaysInMonth(2027, m, w, {}, noTable2027)), [30, 28, 31, 30, 29, 30, 31, 31, 30, 28, 30, 31]);
  // 2028 无表：农历回退照常
  assert.equal(workdaysInMonth(2028, 0, cfg, {}), 17);
  assert.equal(workdaysInMonth(2028, 9, cfg, {}), 20);
});

test('R40: nextWorkdayInDays across the 2027 春节', () => {
  // 内置表：2/5-2/13 放假，2/14（周日）调休上班
  assert.equal(nextWorkdayInDays(d(2027, 2, 4), cfg, {}), 10);
  assert.equal(nextWorkdayInDays(d(2027, 2, 8), cfg, {}), 6);
  // 无表回退：2027 已无农历数据，只剩固定日
  assert.equal(nextWorkdayInDays(d(2027, 2, 4), cfg, {}, noTable2027), 1);
  assert.equal(nextWorkdayInDays(d(2027, 2, 8), cfg, {}, noTable2027), 1);
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
