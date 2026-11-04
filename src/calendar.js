import { HOLIDAYS_CN, STATUTORY_FIXED_FROM_YEAR, STATUTORY_FIXED } from './holidays-cn.js';

const pad = (n) => String(n).padStart(2, '0');
// 本地时间 key，禁止 toISOString（UTC 会偏移日期）
const keyOf = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

export function dayInfo(date, cfg, marks, tables = HOLIDAYS_CN) {
  const key = keyOf(date);
  const table = tables[date.getFullYear()];
  const tableMissing = !table;
  // R39：无表的 2025 年起，只标 6 个固定日期的法定假日（其余待年度通知，不猜）
  const fixedName = !table && date.getFullYear() >= STATUTORY_FIXED_FROM_YEAR ? STATUTORY_FIXED[`${pad(date.getMonth() + 1)}-${pad(date.getDate())}`] ?? null : null;
  const holidayName = table ? (table.off[key] ?? table.makeup[key] ?? null) : fixedName;
  const mark = marks && marks[key];
  const inTable = !!table && (key in table.off || key in table.makeup);
  const source = mark ? 'manual' : inTable ? table.source : fixedName ? 'statutory' : 'rule';
  const out = (base, reason, leave = null) => ({ base, leave, reason, tableMissing, holidayName, source });

  if (mark === 'work') return out('work', 'override');
  if (mark === 'rest') return out('rest', 'override');
  if (mark === 'paidLeave') return out('work', 'override', 'paid');
  if (mark === 'unpaidLeave') return out('work', 'override', 'unpaid');
  if (table && table.makeup[key]) return out('work', 'makeup');
  if (table && table.off[key]) return out('rest', 'holiday');
  if (fixedName) return out('rest', 'holiday');
  const dow = date.getDay();
  if (!cfg.weekends && (dow === 0 || dow === 6)) return out('rest', 'weekend');
  return out('work', 'weekday');
}

export function nextWorkdayInDays(from, cfg, marks, tables) {
  for (let i = 1; i <= 366; i++) {
    const t = new Date(from.getFullYear(), from.getMonth(), from.getDate() + i);
    if (dayInfo(t, cfg, marks, tables).base === 'work') return i;
  }
  return null;
}

export function workdaysInMonth(year, monthIndex, cfg, marks, tables) {
  const n = new Date(year, monthIndex + 1, 0).getDate();
  let count = 0;
  for (let d = 1; d <= n; d++) {
    if (dayInfo(new Date(year, monthIndex, d), cfg, marks, tables).base === 'work') count++;
  }
  return count;
}
