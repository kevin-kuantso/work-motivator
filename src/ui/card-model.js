// 纯函数：Snapshot → 状态卡要显示的内容（design-spec §6.2）。
import { money, heroParts, duration, hourMinute, minutesCeil } from './format.js';
import { missingTableTag } from './holiday-context.js';

const TONE = {
  working: 'working', lunch: 'lunch', beforeWork: 'before', afterWork: 'after',
  restDay: 'rest', paidLeave: 'paid', unpaidLeave: 'unpaid',
};

// 设置里的时间（HH:MM）原样显示；格式不对就不显示（不猜、不补）
const hhmm = (v) => (typeof v === 'string' && /^\d{1,2}:\d{2}$/.test(v.trim()) ? v.trim() : null);

// 已赚占月薪：本月累计 ÷ 设定月薪，四舍五入取整数百分比，夹在 0–100；月薪无效（≤0 / 非数）时为 0，不除以 0
export function monthPercent(monthTotal, salary) {
  if (!(Number.isFinite(monthTotal) && Number.isFinite(salary) && salary > 0)) return 0;
  return Math.min(100, Math.max(0, Math.round((monthTotal / salary) * 100)));
}

export function cardModel(snap, cfg, t) {
  const c = t.card;
  const s = snap.status;
  const timed = s === 'working' || s === 'lunch' || s === 'beforeWork' || s === 'afterWork';

  const holiday = s === 'restDay' && Boolean(snap.holidayName);
  const start = hhmm(cfg.start);
  let label = c.earnedNow;
  let secondary = '';
  if (s === 'working') secondary = c.toOff(duration(snap.remainSec, t));
  if (s === 'lunch') secondary = c.resumeIn(minutesCeil(snap.resumeInSec));
  if (s === 'beforeWork') {
    label = start ? c.startPay(start) : c.notStarted;
    secondary = snap.totalSec > 0 ? c.toStart(duration(snap.remainSec, t)) : '';
  }
  if (s === 'afterWork' || s === 'paidLeave') label = c.earnedTotal;
  // 已下班：只有排定的工作日走到 afterWork（休息日 / 请假 / 未上班 / 午休 / 上班中都不会）
  const done = s === 'afterWork';
  if (done) label = c.dayDone;
  if (s === 'paidLeave') secondary = c.paidNote;
  if (s === 'unpaidLeave') label = c.unpaidLabel;
  if (s === 'restDay') {
    label = snap.holidayName ? c.restingHoliday(snap.holidayName) : c.resting;
    secondary = snap.nextWorkdayInDays === null ? '' : c.nextWorkday(snap.nextWorkdayInDays);
  }

  // 第一格（原「当前赚钱速度」）：只有上班中有速度可说；其余状态换成这一刻有意义的值（H2）
  const lunchEnd = hhmm(cfg.lunchEnd);
  let rateLabel = c.monthProgress;
  let rate = c.monthProgressValue(monthPercent(snap.monthTotal, cfg.salary));
  if (s === 'working') {
    rateLabel = c.rate;
    rate = `${t.currency}${money(snap.ratePerSec, 4)}${c.rateUnit}`;
  } else if (s === 'lunch' && lunchEnd) {
    rateLabel = c.lunchEnds;
    rate = lunchEnd;
  } else if (s === 'beforeWork' && start) {
    rateLabel = c.startsAt;
    rate = start;
  }

  // 进度文字：上班中 / 午休 / 未上班「已工作 2小时0分 / 共 7小时」；已下班「今天工作满 7 小时」（时长取自设置）
  const worked = hourMinute(snap.workedSec);
  const total = hourMinute(snap.totalSec);
  const progressText = done
    ? c.workedDone(total.h, total.m)
    : c.worked(c.spanHM(worked.h, worked.m), c.spanH(total.h, total.m));

  const pct = snap.totalSec > 0 ? Math.min(100, Math.max(0, (snap.workedSec / snap.totalSec) * 100)) : 0;
  const cheer = typeof cfg.cheer === 'string' && cfg.cheer.trim() !== '' ? cfg.cheer : null;
  let payday = null;
  if (snap.paydayInDays === 0) payday = c.payToday;
  else if (Number.isInteger(snap.paydayInDays)) payday = c.payIn(snap.paydayInDays);

  const fixedTwo = s === 'afterWork' || s === 'paidLeave' || s === 'beforeWork';
  const yearTag = snap.tableMissing && snap.now instanceof Date ? missingTableTag(snap.now.getFullYear(), snap.now, {}, t) : null;
  return {
    status: s,
    tone: holiday ? 'holiday' : TONE[s],
    // 法定假日：大卡片徽章写「法定假日 · 国庆」，小窗只写「法定假日」（badgeName 由样式在小窗里隐藏）
    badge: holiday ? t.status.holiday : t.status[s],
    badgeName: holiday ? t.status.holidayName(snap.holidayName) : '',
    tag: snap.makeupWork && timed ? t.status.makeupTag : null,
    label,
    showAmount: s !== 'restDay' && s !== 'unpaidLeave',
    amount: snap.earned,
    // 已下班 / 带薪假：金额定格，末两位恢复正常对比（design-spec §6.4）
    settled: s === 'afterWork' || s === 'paidLeave',
    // 金额只显示 2 位的状态：定格的（已下班 / 带薪假）与未上班的 0.00；上班中 / 午休照旧 4 位（末两位降对比）
    hero: fixedTwo ? { head: money(snap.earned, 2), tail: '' } : heroParts(snap.earned),
    amountSrText: `${t.currency} ${money(snap.earned, fixedTwo ? 2 : 4)}`,
    secondary,
    showProgress: timed && snap.totalSec > 0,
    progressPct: Math.round(pct),
    progressText,
    rateLabel,
    rate,
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
