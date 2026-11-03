import { HOLIDAYS_CN } from './holidays-cn.js';

const pad = (n) => String(n).padStart(2, '0');
// 本地时间 key，禁止 toISOString（UTC 会偏移日期）
const keyOf = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

export function dayInfo(date, cfg, marks) {
  const key = keyOf(date);
  const table = HOLIDAYS_CN[date.getFullYear()];
  const tableMissing = !table;
  const holidayName = table ? (table.off[key] ?? table.makeup[key] ?? null) : null;
  const mark = marks && marks[key];
  const out = (base, reason, leave = null) => ({ base, leave, reason, tableMissing, holidayName });

  if (mark === 'work') return out('work', 'override');
  if (mark === 'rest') return out('rest', 'override');
  if (mark === 'paidLeave') return out('work', 'override', 'paid');
  if (mark === 'unpaidLeave') return out('work', 'override', 'unpaid');
  if (table && table.makeup[key]) return out('work', 'makeup');
  if (table && table.off[key]) return out('rest', 'holiday');
  const dow = date.getDay();
  if (dow === 0 || (dow === 6 && !cfg.weekends)) return out('rest', 'weekend');
  return out('work', 'weekday');
}

export function nextWorkdayInDays(from, cfg, marks) {
  for (let i = 1; i <= 366; i++) {
    const t = new Date(from.getFullYear(), from.getMonth(), from.getDate() + i);
    if (dayInfo(t, cfg, marks).base === 'work') return i;
  }
  return null;
}

export function workdaysInMonth(year, monthIndex, cfg, marks) {
  const n = new Date(year, monthIndex + 1, 0).getDate();
  let count = 0;
  for (let d = 1; d <= n; d++) {
    if (dayInfo(new Date(year, monthIndex, d), cfg, marks).base === 'work') count++;
  }
  return count;
}
