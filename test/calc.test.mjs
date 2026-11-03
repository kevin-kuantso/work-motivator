import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSchedule, snapshot } from '../src/calc.js';

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
  assert.equal(typeof bad({ salary: 0 }).reason, 'string');
  assert.equal(bad({ start: 'abc' }).field, 'start');
  // lunch ignored when off
  assert.equal(bad({ lunchOn: false, lunchStart: '20:00', lunchEnd: '21:00' }).ok, true);
});
