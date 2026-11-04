// 纯函数：Snapshot → 状态卡要显示的内容（design-spec §6.2）。
import { money, duration, hours, minutesCeil } from './format.js';
import { missingTableTag } from './holiday-context.js';

const TONE = {
  working: 'working', lunch: 'lunch', beforeWork: 'before', afterWork: 'after',
  restDay: 'rest', paidLeave: 'paid', unpaidLeave: 'unpaid',
};

// 已赚占月薪：本月累计 ÷ 设定月薪，四舍五入取整数百分比，夹在 0–100；月薪无效（≤0 / 非数）时为 0，不除以 0
export function monthPercent(monthTotal, salary) {
  if (!(Number.isFinite(monthTotal) && Number.isFinite(salary) && salary > 0)) return 0;
  return Math.min(100, Math.max(0, Math.round((monthTotal / salary) * 100)));
}

export function cardModel(snap, cfg, t) {
  const c = t.card;
  const s = snap.status;
  const timed = s === 'working' || s === 'lunch' || s === 'beforeWork' || s === 'afterWork';

  let label = c.earnedNow;
  let secondary = '';
  if (s === 'working') secondary = c.toOff(duration(snap.remainSec, t));
  if (s === 'lunch') secondary = c.resumeIn(minutesCeil(snap.resumeInSec));
  if (s === 'beforeWork') {
    label = c.notStarted;
    secondary = snap.totalSec > 0 ? c.toStart(duration(snap.remainSec, t)) : '';
  }
  if (s === 'afterWork' || s === 'paidLeave') label = c.earnedTotal;
  // 已下班：只有排定的工作日走到 afterWork（休息日 / 请假 / 未上班 / 午休 / 上班中都不会）
  const done = s === 'afterWork';
  if (done) label = c.dayDone;
  if (s === 'paidLeave') secondary = c.paidNote;
  if (s === 'unpaidLeave') secondary = c.unpaidNote;
  if (s === 'restDay') {
    label = snap.holidayName ? c.restingHoliday(snap.holidayName) : c.resting;
    secondary = snap.nextWorkdayInDays === null ? '' : c.nextWorkday(snap.nextWorkdayInDays);
  }

  const pct = snap.totalSec > 0 ? Math.min(100, Math.max(0, (snap.workedSec / snap.totalSec) * 100)) : 0;
  const cheer = typeof cfg.cheer === 'string' && cfg.cheer.trim() !== '' ? cfg.cheer : null;
  let payday = null;
  if (snap.paydayInDays === 0) payday = c.payToday;
  else if (Number.isInteger(snap.paydayInDays)) payday = c.payIn(snap.paydayInDays);

  const yearTag = snap.tableMissing && snap.now instanceof Date ? missingTableTag(snap.now.getFullYear(), snap.now, {}, t) : null;
  return {
    status: s,
    tone: TONE[s],
    badge: t.status[s],
    tag: snap.makeupWork && timed ? t.status.makeupTag : null,
    label,
    showAmount: s !== 'restDay',
    amount: snap.earned,
    // 已下班 / 带薪假：金额定格，末两位恢复正常对比（design-spec §6.4）
    settled: s === 'afterWork' || s === 'paidLeave',
    secondary,
    showProgress: timed && snap.totalSec > 0,
    progressPct: Math.round(pct),
    progressText: c.worked(hours(snap.workedSec), hours(snap.totalSec)),
    rateLabel: done ? c.monthProgress : c.rate,
    rate: done
      ? c.monthProgressValue(monthPercent(snap.monthTotal, cfg.salary))
      : `${t.currency}${money(s === 'working' ? snap.ratePerSec : 0, 4)}${c.rateUnit}`,
    month: `${t.currency}${money(snap.monthTotal)}`,
    hourly: `${t.currency}${money(snap.hourlyWage)}`,
    daily: `${t.currency}${money(snap.dailyWage)}`,
    payday,
    // 没有假期表的年份（R15 / R41）：卡片上要看得出来；措辞按该年实际标出的日子（状态卡永远是当年）
    yearNote: yearTag?.text ?? null,
    yearTitle: yearTag?.title ?? '',
    cheer,
    srSummary: c.srSummary(t.status[s], Math.floor(Number.isFinite(snap.earned) ? snap.earned : 0)),
  };
}
