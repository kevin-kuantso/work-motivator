// 纯函数：月历小菜单的选项、日薪预览与悬停提示内容（spec §12.1 / §12.2）。
import { dayInfo } from '../calendar.js';
import { monthWage } from '../calc.js';
import { STRINGS } from '../strings.zh-CN.js';
import { money, ymd } from './format.js';

const C = STRINGS.calendar;
const yuan = (v) => `${STRINGS.currency}${money(v)}`;

// 选项 id → 存储的标记（'default' = 删除标记）；与 settings.js 的 MARKS 一致，不改存储格式。
const OPTION_MARK = { default: undefined, work: 'work', rest: 'rest', paidLeave: 'paidLeave', unpaidLeave: 'unpaidLeave' };
const REST_OPTIONS = ['default', 'work'];
const WORK_OPTIONS = ['default', 'rest', 'paidLeave', 'unpaidLeave'];

// plain = 不含手动标记的 dayInfo（R18）：已标记的日子仍按其默认类型给选项。
export function dayOptions(plain, current) {
  const currentId = current === undefined ? 'default' : current;
  return (plain.base === 'rest' ? REST_OPTIONS : WORK_OPTIONS)
    .map((id) => ({ id, labelKey: id, checked: id === currentId }));
}

export function applyOption(marks, date, optionId) {
  if (!Object.prototype.hasOwnProperty.call(OPTION_MARK, optionId)) throw new Error(`unknown day option: ${optionId}`);
  const next = { ...marks };
  const key = ymd(date);
  const mark = OPTION_MARK[optionId];
  if (mark === undefined) delete next[key];
  else next[key] = mark;
  return next;
}

const monthDailyWage = (date, cfg, marks, tables) =>
  monthWage(date.getFullYear(), date.getMonth(), cfg, marks, tables).dailyWage;

// 该选项生效后的当月日薪（固定月薪 ÷ 当月应出勤天数；带薪 / 无薪假不改变分母）。
export function previewDailyWage(date, cfg, marks, tables, optionId) {
  return monthDailyWage(date, cfg, applyOption(marks, date, optionId), tables);
}

function statusText(info, plain) {
  if (info.leave === 'paid') return C.status.paid;
  if (info.leave === 'unpaid') return C.status.unpaid;
  if (info.base === 'work') {
    if (info.reason === 'makeup') return C.status.makeup(info.holidayName);
    if (plain.base === 'rest') return C.status.makeup(null);
    return C.status.workday;
  }
  if (info.reason === 'holiday') return C.status.holiday(info.holidayName);
  if (info.reason === 'override' && plain.reason === 'holiday') return C.status.holiday(plain.holidayName);
  return C.status.rest;
}

const dayTitle = (date) => C.dayTitle(date.getMonth() + 1, date.getDate(), STRINGS.weekdays[date.getDay()]);
const cents = (v) => Math.round(v * 100);

export function menuModel(date, cfg, marks, tables) {
  const info = dayInfo(date, cfg, marks, tables);
  const plain = dayInfo(date, cfg, {}, tables);
  const before = monthDailyWage(date, cfg, marks, tables);
  const items = dayOptions(plain, marks[ymd(date)]).map((o) => {
    const after = previewDailyWage(date, cfg, marks, tables, o.id);
    let note;
    if (o.checked) note = C.menu.current;
    else if (cents(after) === cents(before)) note = C.menu.unchanged;
    else note = C.menu.preview(yuan(before), yuan(after));
    return { ...o, label: C.menu.options[o.labelKey], note };
  });
  return { header: C.menu.header(dayTitle(date), statusText(info, plain)), items, footer: C.menu.footer };
}

export function dayTooltipModel(date, cfg, marks, tables, now) {
  const info = dayInfo(date, cfg, marks, tables);
  const plain = dayInfo(date, cfg, {}, tables);
  const paid = info.base === 'work' && info.leave !== 'unpaid';
  const isToday = now && ymd(now) === ymd(date);
  return {
    title: `${dayTitle(date)}${isToday ? C.todaySuffix : ''}`,
    status: statusText(info, plain),
    // 'rule'：周末按周末规则；其他日子（含「周末计入」时的周末、无内置表年份的平日）按默认规则
    source: C.tip.source(C.tip.sources[info.source === 'rule' && info.reason !== 'weekend' ? 'default' : info.source]),
    pay: C.tip.pay(yuan(paid ? monthDailyWage(date, cfg, marks, tables) : 0)),
    hint: C.tip.hint,
  };
}

export const tooltipText = (m) => C.tip.join([m.title, m.status, m.source, m.pay, m.hint]);
