// 純函式：月曆格子模型（design-spec §7.2，週一為一週起始）。tables 預設時用內建假期表。
import { dayInfo } from '../calendar.js';
import { ymd } from './format.js';

function restKind(info) {
  if (info.reason === 'holiday') return 'holiday';
  if (info.reason === 'weekend') return 'weekend';
  return 'rest';
}

export function cellKind(date, cfg, marks, tables) {
  const info = dayInfo(date, cfg, marks, tables);
  if (info.leave === 'paid') return 'paid';
  if (info.leave === 'unpaid') return 'unpaid';
  const plain = dayInfo(date, cfg, {}, tables);
  if (info.base === 'work') {
    if (info.reason === 'makeup') return 'makeup';
    if (info.reason === 'override' && plain.base === 'rest') return 'makeup';
    return 'workday';
  }
  if (info.reason === 'override') return plain.base === 'rest' ? restKind(plain) : 'rest';
  return restKind(info);
}

export function monthGrid(year, monthIndex, cfg, marks, today, tables) {
  const first = new Date(year, monthIndex, 1);
  const days = new Date(year, monthIndex + 1, 0).getDate();
  const lead = (first.getDay() + 6) % 7; // 週一 = 0
  const todayKey = today ? ymd(today) : null;
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push(null);
  let hasMarks = false;
  for (let d = 1; d <= days; d++) {
    const date = new Date(year, monthIndex, d);
    const key = ymd(date);
    const info = dayInfo(date, cfg, marks, tables);
    const manual = Object.prototype.hasOwnProperty.call(marks, key);
    if (manual) hasMarks = true;
    cells.push({
      date, key, day: d, weekday: date.getDay(),
      kind: cellKind(date, cfg, marks, tables),
      holidayName: info.holidayName,
      manual,
      today: key === todayKey,
    });
  }
  while (cells.length % 7) cells.push(null);
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return { weeks, hasMarks, tableMissing: dayInfo(first, cfg, {}, tables).tableMissing };
}
