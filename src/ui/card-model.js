// 純函式：Snapshot → 狀態卡要顯示的內容（design-spec §6.2）。
import { money, heroParts, duration, hourMinute, minutesCeil } from './format.js';
import { missingTableTag } from './holiday-context.js';

const TONE = {
  working: 'working', lunch: 'lunch', beforeWork: 'before', afterWork: 'after',
  restDay: 'rest', paidLeave: 'paid', unpaidLeave: 'unpaid',
};

// 設定裡的時間（HH:MM）原樣顯示；格式不對就不顯示（不猜、不補）
const hhmm = (v) => (typeof v === 'string' && /^\d{1,2}:\d{2}$/.test(v.trim()) ? v.trim() : null);

// 已賺佔月薪：本月累計 ÷ 設定月薪，四捨五入取整數百分比，夾在 0–100；月薪無效（≤0 / 非數）時為 0，不除以 0
export function monthPercent(monthTotal, salary) {
  if (!(Number.isFinite(monthTotal) && Number.isFinite(salary) && salary > 0)) return 0;
  return Math.min(100, Math.max(0, Math.round((monthTotal / salary) * 100)));
}

// 多句鼓勵語：只保留非空白的字串，順序不變；空白句不佔位、不參與輪播（陣列本身由設定校驗保證至少一項）。
export function cheerLines(cfg) {
  const list = Array.isArray(cfg?.cheers) ? cfg.cheers : [];
  return list.filter((s) => typeof s === 'string' && s.trim() !== '');
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
  // 已下班：只有排定的工作日走到 afterWork（休息日 / 請假 / 未上班 / 午休 / 上班中都不會）
  const done = s === 'afterWork';
  if (done) label = c.dayDone;
  if (s === 'paidLeave') secondary = c.paidNote;
  if (s === 'unpaidLeave') label = c.unpaidLabel;
  if (s === 'restDay') {
    label = snap.holidayName ? c.restingHoliday(snap.holidayName) : c.resting;
    secondary = snap.nextWorkdayInDays === null ? '' : c.nextWorkday(snap.nextWorkdayInDays);
  }

  // 第一格（原「當前賺錢速度」）：只有上班中有速度可說；其餘狀態換成這一刻有意義的值（H2）
  const lunchEnd = hhmm(cfg.lunchEnd);
  let rateLabel = c.monthProgress;
  let rate = c.monthProgressValue(monthPercent(snap.monthTotal, cfg.salary));
  if (s === 'working') {
    rateLabel = c.rate;
    rate = `${t.currency}${money(snap.ratePerSec, 4, t)}${c.rateUnit}`;
  } else if (s === 'lunch' && lunchEnd) {
    rateLabel = c.lunchEnds;
    rate = lunchEnd;
  }

  // 進度文字：上班中 / 午休 / 未上班「已工作 2小時0分 / 共 7小時」；已下班「今天工作滿 7 小時」（時長取自設定）
  const worked = hourMinute(snap.workedSec);
  const total = hourMinute(snap.totalSec);
  const progressText = done
    ? c.workedDone(total.h, total.m)
    : c.worked(c.spanHM(worked.h, worked.m), c.spanH(total.h, total.m));

  const pct = snap.totalSec > 0 ? Math.min(100, Math.max(0, (snap.workedSec / snap.totalSec) * 100)) : 0;
  const cheers = cheerLines(cfg);
  let payday = null;
  if (snap.paydayInDays === 0) payday = c.payToday;
  else if (Number.isInteger(snap.paydayInDays)) payday = c.payIn(snap.paydayInDays);

  const fixedTwo = s === 'afterWork' || s === 'paidLeave' || s === 'beforeWork';
  // 缺表措辭按活動地區的 provider（cfg.holidayProvider）：臺灣缺表只說「僅依週末與手動標記試算」
  const yearTag = snap.tableMissing && snap.now instanceof Date
    ? missingTableTag(snap.now.getFullYear(), snap.now, cfg.holidayProvider?.tables ?? {}, t, cfg.holidayProvider)
    : null;
  return {
    status: s,
    tone: holiday ? 'holiday' : TONE[s],
    // 法定假日：徽章只寫「法定假日」，節日名只在標籤裡出現一次（「今天休息 · 國慶」）
    badge: holiday ? t.status.holiday : t.status[s],
    tag: snap.makeupWork && timed ? t.status.makeupTag : null,
    label,
    showAmount: s !== 'restDay' && s !== 'unpaidLeave',
    amount: snap.earned,
    // 已下班 / 帶薪假：金額定格，末兩位恢復正常對比（design-spec §6.4）
    settled: s === 'afterWork' || s === 'paidLeave',
    // 金額只顯示 2 位的狀態：定格的（已下班 / 帶薪假）與未上班的 0.00；上班中 / 午休照舊 4 位（末兩位降對比）
    hero: fixedTwo ? { head: money(snap.earned, 2, t), tail: '' } : heroParts(snap.earned, t),
    amountSrText: `${t.currency} ${money(snap.earned, fixedTwo ? 2 : 4, t)}`,
    secondary,
    showProgress: timed && snap.totalSec > 0,
    progressPct: Math.round(pct),
    progressText,
    // 已下班：進度文字挪到進度頭一行右側（帶 ✓），條下面那一行不再顯示（避免把「滿了」說兩遍）
    progressInHead: done,
    // 今日滿勤可得：休息日 / 法定假日 / 無薪假（今天不計薪）時與結論矛盾，不顯示
    showDaily: s !== 'restDay' && s !== 'unpaidLeave',
    // 時薪也一起隱藏：這三種狀態指標格只剩「已賺佔月薪 + 本月累計」兩格，排成一行，沒有落單的格子
    showHourly: s !== 'restDay' && s !== 'unpaidLeave',
    rateLabel,
    rate,
    month: `${t.currency}${money(snap.monthTotal, 2, t)}`,
    hourly: `${t.currency}${money(snap.hourlyWage, 2, t)}`,
    daily: `${t.currency}${money(snap.dailyWage, 2, t)}`,
    payday,
    // 沒有假期表的年份（R15 / R41）：卡片上要看得出來；措辭按該年實際標出的日子（狀態卡永遠是當年）
    yearNote: yearTag?.text ?? null,
    yearTitle: yearTag?.title ?? '',
    cheers,
    srSummary: c.srSummary(t.status[s], Math.floor(Number.isFinite(snap.earned) ? snap.earned : 0)),
  };
}
