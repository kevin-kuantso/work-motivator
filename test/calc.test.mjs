import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSchedule, snapshot, monthWage } from '../src/calc.js';

const cfg = {
  salary: 6800, start: '08:30', end: '17:00', lunchOn: true,
  lunchStart: '11:30', lunchEnd: '13:00', weekends: false, payday: null, cheer: '',
};
const at = (m, d, h = 0, mi = 0, s = 0, ms = 0) => new Date(2026, m - 1, d, h, mi, s, ms);
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} !~ ${b}`);
const allFinite = (s) => {
  for (const k of ['earned', 'ratePerSec', 'workedSec', 'totalSec', 'remainSec', 'dailyWage', 'hourlyWage', 'monthTotal']) {
    assert.ok(Number.isFinite(s[k]), `${k} = ${s[k]}`);
  }
};

test('basic wage numbers on 2026-11-03', () => {
  const s = snapshot(at(11, 3, 9), cfg, {});
  assert.equal(s.totalSec, 25200);
  near(s.dailyWage, 6800 / 21, 1e-4);
  near(s.ratePerSec, 0.0128496, 1e-7);
  near(s.hourlyWage, 46.2585, 1e-3);
});

test('14:23:00 and 14:12:00', () => {
  const s = snapshot(at(11, 3, 14, 23), cfg, {});
  assert.equal(s.status, 'working');
  assert.equal(s.workedSec, 15780);
  near(s.earned, 202.77, 0.01);
  near(s.monthTotal, 526.58, 0.01);
  const t = snapshot(at(11, 3, 14, 12), cfg, {});
  near(t.earned, 194.2857, 0.001);
  near(t.monthTotal, 518.10, 0.01);
});

test('lunch excluded', () => {
  const s = snapshot(at(11, 3, 11, 45), cfg, {});
  assert.equal(s.status, 'lunch');
  assert.equal(s.ratePerSec, 0);
  assert.equal(s.workedSec, 10800);
  assert.equal(s.resumeInSec, 4500);
  assert.equal(snapshot(at(11, 3, 14), cfg, {}).resumeInSec, null);
});

test('lunchOff counts lunch as work time', () => {
  const c = { ...cfg, lunchOn: false };
  assert.equal(snapshot(at(11, 3, 11, 45), c, {}).status, 'working');
  assert.equal(snapshot(at(11, 3, 11, 45), c, {}).totalSec, 30600);
});

test('boundaries', () => {
  assert.equal(snapshot(at(11, 3, 8, 30, 0), cfg, {}).status, 'working');
  assert.equal(snapshot(at(11, 3, 8, 29, 59), cfg, {}).status, 'beforeWork');
  assert.equal(snapshot(at(11, 3, 11, 30, 0), cfg, {}).status, 'lunch');
  assert.equal(snapshot(at(11, 3, 13, 0, 0), cfg, {}).status, 'working');
  const e = snapshot(at(11, 3, 17, 0, 0), cfg, {});
  assert.equal(e.status, 'afterWork');
  assert.equal(e.earned, e.dailyWage);
  assert.equal(e.ratePerSec, 0);
  assert.equal(snapshot(at(11, 3, 8, 30, 0), cfg, {}).remainSec, 25200 + 5400);
  assert.equal(snapshot(at(11, 3, 8, 0, 0), cfg, {}).remainSec, 1800);
});

test('fractional seconds are used', () => {
  const a = snapshot(at(11, 3, 14, 23, 0), cfg, {});
  const b = snapshot(at(11, 3, 14, 23, 0, 500), cfg, {});
  near(b.earned - a.earned, a.ratePerSec * 0.5, 1e-9);
});

test('rest day and nextWorkdayInDays', () => {
  const sun = snapshot(at(11, 8, 10), cfg, {});
  assert.equal(sun.status, 'restDay');
  assert.equal(sun.earned, 0);
  assert.equal(sun.nextWorkdayInDays, 1);
  assert.equal(snapshot(at(11, 7, 10), cfg, {}).nextWorkdayInDays, 2);
  assert.equal(snapshot(at(11, 3, 10), cfg, {}).nextWorkdayInDays, null);
});

test('leave', () => {
  const p = snapshot(at(11, 3, 10), cfg, { '2026-11-03': 'paidLeave' });
  assert.equal(p.status, 'paidLeave');
  assert.equal(p.earned, p.dailyWage);
  assert.equal(p.ratePerSec, 0);
  const u = snapshot(at(11, 3, 10), cfg, { '2026-11-03': 'unpaidLeave' });
  assert.equal(u.status, 'unpaidLeave');
  assert.equal(u.earned, 0);
  near(u.monthTotal, 323.8095, 1e-3); // only 11/2; denominator unchanged
});

test('makeupWork flag', () => {
  const s = snapshot(at(10, 10, 10), cfg, {});
  assert.equal(s.makeupWork, true);
  assert.equal(s.holidayName, '国庆');
  assert.equal(snapshot(at(11, 3, 10), cfg, {}).makeupWork, false);
});

test('robustness: no NaN/Infinity', () => {
  for (const salary of [0, NaN, '', -5, undefined, Infinity]) {
    const s = snapshot(at(11, 3, 14), { ...cfg, salary }, {});
    allFinite(s);
    assert.equal(s.earned, 0);
    assert.equal(s.dailyWage, 0);
    assert.equal(s.monthTotal, 0);
  }
  const marks = {};
  for (let d = 1; d <= 30; d++) marks[`2026-11-${String(d).padStart(2, '0')}`] = 'rest';
  const s = snapshot(at(11, 3, 14), cfg, marks);
  allFinite(s);
  assert.equal(s.dailyWage, 0);
  assert.equal(s.monthTotal, 0);
  // garbage times
  allFinite(snapshot(at(11, 3, 14), { ...cfg, start: 'xx', end: '' }, {}));
});

test('midnight rollover', () => {
  const a = snapshot(at(11, 3, 23, 59, 59), cfg, {});
  const b = snapshot(at(11, 4, 0, 0, 0), cfg, {});
  assert.equal(a.status, 'afterWork');
  assert.equal(b.status, 'beforeWork');
  near(a.monthTotal, 2 * (6800 / 21), 1e-3);
  near(b.monthTotal, 2 * (6800 / 21), 1e-3);
  assert.equal(b.earned, 0);
  assert.equal(b.remainSec, 30600);
  const c = snapshot(at(11, 4, 17, 0, 0), cfg, {});
  near(c.monthTotal, 3 * (6800 / 21), 1e-3);
});

test('paydayInDays', () => {
  assert.equal(snapshot(at(11, 3, 10), cfg, {}).paydayInDays, null);
  const p = (m, d, payday) => snapshot(at(m, d, 10), { ...cfg, payday }, {}).paydayInDays;
  assert.equal(p(11, 3, 10), 7);
  assert.equal(p(11, 10, 10), 0);
  assert.equal(p(11, 11, 10), 29); // -> 12/10
  assert.equal(p(11, 3, 31), 27); // Nov has 30 days -> 11/30
  assert.equal(p(11, 30, 31), 0);
  assert.equal(p(1, 31, 15), 15); // 1/31 -> 2/15
  assert.equal(p(1, 31, 30), 28); // 2/28 (2026 not leap)
  assert.equal(p(3, 29, 28), 30); // 3/29 -> 4/28
});

test('paydayInDays invalid payday -> null, valid still works', () => {
  const p = (payday) => snapshot(at(11, 3, 10), { ...cfg, payday }, {}).paydayInDays;
  for (const bad of [NaN, 0, 32, 'abc', -1, Infinity, 1.5]) assert.equal(p(bad), null, String(bad));
  assert.equal(p(5), 2);
  assert.equal(p(31), 27);
});

test('validateSchedule', () => {
  assert.deepEqual(validateSchedule(cfg), { ok: true });
  const bad = (patch) => validateSchedule({ ...cfg, ...patch });
  assert.equal(bad({ salary: 0 }).ok, false);
  assert.equal(bad({ salary: 0 }).field, 'salary');
  assert.equal(bad({ salary: NaN }).field, 'salary');
  assert.equal(bad({ salary: '' }).field, 'salary');
  assert.equal(bad({ end: '08:30' }).field, 'end');
  assert.equal(bad({ end: '08:00' }).field, 'end');
  assert.equal(bad({ lunchStart: '08:00' }).field, 'lunchStart');
  assert.equal(bad({ lunchEnd: '17:30' }).field, 'lunchEnd');
  assert.equal(bad({ lunchStart: '13:00', lunchEnd: '13:00' }).ok, false);
  assert.equal(bad({ lunchStart: '14:00', lunchEnd: '13:00' }).ok, false);
  // 原因回传稳定 code + 参数，绝不是某种语言的句子：显示端才用当时的字典翻译
  assert.deepEqual(bad({ salary: 0 }).code, 'salary');
  assert.deepEqual(bad({ start: 'abc' }).code, 'timeFormat');
  assert.deepEqual(bad({ start: 'abc' }).params, { field: 'start' });
  assert.deepEqual(bad({ lunchEnd: '18:00' }).code, 'lunchInShift');
  assert.deepEqual(bad({ lunchEnd: '18:00' }).params, { field: 'lunchEnd' });
  assert.deepEqual(bad({ end: '08:00' }).code, 'endAfterStart');
  assert.equal(typeof bad({ salary: 0 }).reason, 'undefined');
  assert.equal(bad({ start: 'abc' }).field, 'start');
  // lunch ignored when off
  assert.equal(bad({ lunchOn: false, lunchStart: '20:00', lunchEnd: '21:00' }).ok, true);
});

test('reasonText: 同一份校验结果跟着字典换语言（新增地区只需注册字典）', async () => {
  const { reasonText } = await import('../src/calc.js');
  const { STRINGS: cn } = await import('../src/strings.zh-CN.js');
  // 合成的第二本字典：只要形状对（reasons + labels），不依赖 strings.zh-TW.js 是否已存在
  const other = { reasons: {
    salary: 'SALARY-TEXT',
    timeFormat: (label) => `TIME(${label})`,
    endAfterStart: 'END-AFTER-START',
    lunchInShift: (label) => `LUNCH-IN(${label})`,
    notObject: 'STRUCTURE',
    labels: { start: 'START-LABEL', lunchEnd: 'LUNCH-END-LABEL' },
  } };
  const v = bad => validateSchedule({ ...cfg, ...bad });
  // 渲染器只认 { code, params }：validateSchedule 的扁平结果与 dropped/error 的 { code, params } 都能直接用
  assert.equal(reasonText(v({ salary: 0 }), cn), cn.reasons.salary);
  assert.equal(reasonText(v({ start: 'abc' }), other), 'TIME(START-LABEL)');
  assert.equal(reasonText(v({ end: '08:00' }), other), 'END-AFTER-START');
  assert.equal(reasonText(v({ lunchEnd: '18:00' }), other), 'LUNCH-IN(LUNCH-END-LABEL)');
  // 缺键 / 未知 code / 旧形态：回传空字串，不回退到别的语言
  assert.equal(reasonText({ code: 'nope' }, other), '');
  assert.equal(reasonText({ code: 'salary' }, { reasons: {} }), '');
  assert.equal(reasonText('旧式已翻译字串', other), '');
  assert.equal(reasonText(null, other), '');
});

test('monthWage: shared daily-wage helper used by snapshot and the calendar previews', async () => {
  const { monthWage } = await import('../src/calc.js');
  const nov = monthWage(2026, 10, cfg, {});
  assert.equal(nov.workdays, 21);
  near(nov.dailyWage, 6800 / 21);
  near(snapshot(at(11, 3, 10), cfg, {}).dailyWage, nov.dailyWage);
  assert.equal(monthWage(2026, 10, cfg, { '2026-11-07': 'work' }).workdays, 22);
  assert.equal(monthWage(2026, 10, { ...cfg, salary: 0 }, {}).dailyWage, 0);
  assert.equal(monthWage(2026, 10, { ...cfg, salary: NaN }, {}).dailyWage, 0);
  assert.equal(monthWage(2026, 9, cfg, {}).workdays, 18);
});

// 2027 现在有内置表；无表路径用显式注入的不含 2027 的表集合覆盖（R39 / R40 回退语义照旧）
const NO_2027 = { 2026: { off: { '2026-01-01': '元旦' }, makeup: {}, source: 'builtin' } };

test('R39: 2027-01-04 10:00 (no table): Jan 1 is a statutory rest day -> 20 workdays, daily wage 340', () => {
  const s = snapshot(new Date(2027, 0, 4, 10, 0, 0), cfg, {}, NO_2027);
  assert.equal(s.tableMissing, true);
  near(s.dailyWage, 340, 1e-9);
  near(s.earned, 340 * 5400 / 25200, 1e-6); // 72.8571…
  near(s.monthTotal, 340 * 5400 / 25200, 1e-6); // Jan 1 rest -> 0; today = earned
  const f = snapshot(new Date(2027, 0, 1, 10, 0, 0), cfg, {}, NO_2027);
  assert.equal(f.status, 'restDay');
  assert.equal(f.earned, 0);
});

test('R39: 2027 with the built-in table: Jan 1-3 rest, Jan 4 work -> 21 workdays, daily wage 323.81', () => {
  const s = snapshot(new Date(2027, 0, 4, 10, 0, 0), cfg, {});
  assert.equal(s.tableMissing, false);
  near(s.dailyWage, 6800 / 21, 1e-9);
  near(s.dailyWage, 323.81, 0.005);
  near(s.earned, 6800 / 21 * 5400 / 25200, 1e-6);
  // 春节 2/14 调休上班：当月 15 个工作日
  near(monthWage(2027, 1, cfg, {}).dailyWage, 453.33, 0.005);
  assert.equal(monthWage(2027, 1, cfg, {}).workdays, 15);
});

test('R40: 2027 daily wages with the lunar / solar-term legal days (no table)', () => {
  const expected = { 0: 20, 1: 20, 5: 22, 9: 20 }; // month index -> workdays（只剩固定日 + 周末）
  for (const [m, n] of Object.entries(expected)) {
    const w = monthWage(2027, Number(m), cfg, {}, NO_2027);
    assert.equal(w.workdays, n, `month index ${m}`);
    near(w.dailyWage, 6800 / n, 1e-9);
  }
  near(monthWage(2027, 1, cfg, {}, NO_2027).dailyWage, 340, 0.005);
});

test('R40: 2027 daily wages with the built-in table (春节 / 劳动节 / 中秋)', () => {
  const expected = { 1: 15, 4: 19, 8: 22, 6: 22, 9: 17 }; // month index -> workdays
  for (const [m, n] of Object.entries(expected)) {
    const w = monthWage(2027, Number(m), cfg, {});
    assert.equal(w.workdays, n, `month index ${m}`);
    near(w.dailyWage, 6800 / n, 1e-9);
  }
  near(monthWage(2027, 1, cfg, {}).dailyWage, 453.33, 0.005);
  near(monthWage(2027, 4, cfg, {}).dailyWage, 357.89, 0.005);
  near(monthWage(2027, 9, cfg, {}).dailyWage, 400, 1e-9);
});
