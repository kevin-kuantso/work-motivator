import { dayInfo, workdaysInMonth, nextWorkdayInDays } from './calendar.js';
import { STRINGS } from './strings.zh-CN.js';

const R = STRINGS.reasons;

// 'HH:MM' -> 当日秒数；格式不合法返回 NaN
function parseHM(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(typeof s === 'string' ? s.trim() : '');
  if (!m) return NaN;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 23 || mi > 59) return NaN;
  return h * 3600 + mi * 60;
}

const validSalary = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0;
const overlap = (a1, a2, b1, b2) => Math.max(0, Math.min(a2, b2) - Math.max(a1, b1));

export function validateSchedule(cfg) {
  const fail = (field, reason) => ({ ok: false, field, reason });
  if (!validSalary(cfg.salary)) return fail('salary', R.salary);
  const s = parseHM(cfg.start);
  const e = parseHM(cfg.end);
  if (Number.isNaN(s)) return fail('start', R.timeFormat(R.labels.start));
  if (Number.isNaN(e)) return fail('end', R.timeFormat(R.labels.end));
  if (e <= s) return fail('end', R.endAfterStart);
  if (cfg.lunchOn) {
    const ls = parseHM(cfg.lunchStart);
    const le = parseHM(cfg.lunchEnd);
    if (Number.isNaN(ls)) return fail('lunchStart', R.timeFormat(R.labels.lunchStart));
    if (Number.isNaN(le)) return fail('lunchEnd', R.timeFormat(R.labels.lunchEnd));
    if (ls < s || ls > e) return fail('lunchStart', R.lunchInShift(R.labels.lunchStart));
    if (le < s || le > e) return fail('lunchEnd', R.lunchInShift(R.labels.lunchEnd));
    if (ls >= le) return fail('lunchStart', R.lunchOrder);
  }
  return { ok: true };
}

const dayDiff = (a, b) =>
  Math.round(
    (Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) -
      Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / 86400000,
  );

function paydayIn(now, payday) {
  if (payday === null || payday === undefined) return null;
  if (!Number.isInteger(payday) || payday < 1 || payday > 31) return null;
  const y = now.getFullYear();
  const mo = now.getMonth();
  const target = (yy, mm) => new Date(yy, mm, Math.min(payday, new Date(yy, mm + 1, 0).getDate()));
  let t = target(y, mo);
  if (dayDiff(now, t) < 0) t = target(y, mo + 1); // Date 构造会处理 12 月进位
  return dayDiff(now, t);
}

export function snapshot(now, cfg, marks) {
  const info = dayInfo(now, cfg, marks);
  const year = now.getFullYear();
  const month = now.getMonth();

  const s = parseHM(cfg.start);
  const e = parseHM(cfg.end);
  const scheduleOk = Number.isFinite(s) && Number.isFinite(e) && e > s;
  const lunchOn = Boolean(cfg.lunchOn);
  let ls = parseHM(cfg.lunchStart);
  let le = parseHM(cfg.lunchEnd);
  const lunchOk = lunchOn && Number.isFinite(ls) && Number.isFinite(le) && scheduleOk && ls < le;
  if (!lunchOk) { ls = 0; le = 0; }

  const lunchSec = lunchOk ? overlap(ls, le, s, e) : 0;
  const totalSec = scheduleOk ? e - s - lunchSec : 0;

  const denom = workdaysInMonth(year, month, cfg, marks);
  const dailyWage = validSalary(cfg.salary) && denom > 0 ? cfg.salary / denom : 0;
  const hourlyWage = totalSec > 0 ? dailyWage / (totalSec / 3600) : 0;
  const perSec = totalSec > 0 ? dailyWage / totalSec : 0;

  const sod = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds() + now.getMilliseconds() / 1000;

  let status;
  let earned = 0;
  let ratePerSec = 0;
  let workedSec = 0;
  let remainSec = 0;
  let resumeInSec = null;
  let nextDays = null;

  if (info.base === 'rest') {
    status = 'restDay';
    nextDays = nextWorkdayInDays(now, cfg, marks);
  } else if (info.leave === 'paid') {
    status = 'paidLeave';
    earned = dailyWage;
  } else if (info.leave === 'unpaid') {
    status = 'unpaidLeave';
  } else if (!scheduleOk) {
    status = 'beforeWork'; // 时间配置无效：无法计时，金额保持 0
  } else if (sod < s) {
    status = 'beforeWork';
    remainSec = s - sod;
  } else if (sod >= e) {
    status = 'afterWork';
    workedSec = totalSec;
    earned = dailyWage;
  } else {
    const inLunch = lunchOk && sod >= ls && sod < le;
    status = inLunch ? 'lunch' : 'working';
    workedSec = sod - s - overlap(ls, le, s, sod);
    earned = perSec * workedSec;
    ratePerSec = inLunch ? 0 : perSec;
    remainSec = e - sod;
    if (inLunch) resumeInSec = le - sod;
  }

  // 本月已过各日金额
  let past = 0;
  if (dailyWage > 0) {
    for (let d = 1; d < now.getDate(); d++) {
      const di = dayInfo(new Date(year, month, d), cfg, marks);
      if (di.base === 'work' && di.leave !== 'unpaid') past += dailyWage;
    }
  }

  return {
    status,
    makeupWork: info.base === 'work' && info.reason === 'makeup',
    earned,
    ratePerSec,
    workedSec,
    totalSec,
    remainSec,
    dailyWage,
    hourlyWage,
    monthTotal: past + earned,
    paydayInDays: paydayIn(now, cfg.payday),
    tableMissing: info.tableMissing,
    holidayName: info.holidayName,
    resumeInSec,
    nextWorkdayInDays: nextDays,
  };
}
