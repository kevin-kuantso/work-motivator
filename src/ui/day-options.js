// 纯函数：月历小菜单的选项、日薪预览与悬停提示内容（spec §12.1 / §12.2）。
// 所有文字、币别与数字格式都取自必填的字典 t（= profile.strings）：本文件不绑定任何一种语言，
// 也不提供默认字典——漏传 t 会立刻报错，而不是悄悄显示另一种语言。不得在本文件写死界面文案。
import { dayInfo } from '../calendar.js';
import { monthWage } from '../calc.js';
import { money, ymd, lunarText } from './format.js';

// 选项 id → 存储的标记（'default' = 删除标记）；与 settings.js 的 MARKS 一致，不改存储格式。
const OPTION_MARK = { default: undefined, work: 'work', rest: 'rest', paidLeave: 'paidLeave', unpaidLeave: 'unpaidLeave' };
const REST_OPTIONS = ['default', 'work'];
const WORK_OPTIONS = ['default', 'rest', 'paidLeave', 'unpaidLeave'];

// 字典必填：调用方（app / 月历 / 测试）一律注入当前地区的 t，避免任一处回退成简中
const dict = (t) => {
  if (!t || typeof t !== 'object' || !t.calendar) throw new TypeError('day-options: missing region dictionary t (profile.strings)');
  return t;
};
// 金额：符号与千分位都按当前地区（t.currency / t.locale）
const amount = (v, t) => `${dict(t).currency}${money(v, 2, dict(t))}`;

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

export function statusText(info, plain, t) {
  const C = dict(t).calendar;
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

// 盖在格子上的提示用的短状态（R50）：不带括号
function statusShortText(info, plain, t) {
  const C = dict(t).calendar;
  const S = C.tip.statusShort;
  if (info.leave) return statusText(info, plain, t);
  if (info.base === 'work') {
    if (info.reason === 'makeup') return S.makeup(info.holidayName);
    return plain.base === 'rest' ? S.makeup(null) : C.status.workday;
  }
  if (info.reason === 'holiday') return S.holiday(info.holidayName);
  if (info.reason === 'override' && plain.reason === 'holiday') return S.holiday(plain.holidayName);
  return C.status.rest;
}

const dayTitle = (date, t) =>
  dict(t).calendar.dayTitle(date.getMonth() + 1, date.getDate(), dict(t).weekdays[date.getDay()]);

// 把「日期 周X」拆回可再排版的单位：定位我们自己传进去的星期字串，不假设间隔符是什么（各地区写法不同）。
// 提示里日期与星期各是不可拆的单位，窄格子只在两者之间换行。
function titleParts(date, t) {
  const wd = dict(t).weekdays[date.getDay()] ?? '';
  const full = dayTitle(date, t);
  const at = wd ? full.lastIndexOf(wd) : -1;
  if (at < 0) return { full, date: full, weekday: '', sep: '' };
  const head = full.slice(0, at);
  const dateText = head.trimEnd();
  return { full, date: dateText, weekday: wd, sep: head.slice(dateText.length) };
}

// 把「<说明> <金额>」拆成说明与金额：同样定位金额本身，不改写字典的句子。
function payParts(amountText, t) {
  const full = dict(t).calendar.tip.payShort(amountText);
  const at = amountText ? full.lastIndexOf(amountText) : -1;
  if (at < 0) return { full, label: full, amount: '', sep: '' };
  const head = full.slice(0, at);
  const label = head.trimEnd();
  return { full, label, amount: amountText, sep: head.slice(label.length) };
}

const cents = (v) => Math.round(v * 100);

export function menuModel(date, cfg, marks, tables, t) {
  const T = dict(t);
  const C = T.calendar;
  const info = dayInfo(date, cfg, marks, tables);
  const plain = dayInfo(date, cfg, {}, tables);
  const before = monthDailyWage(date, cfg, marks, tables);
  const items = dayOptions(plain, marks[ymd(date)]).map((o) => {
    const result = monthWage(date.getFullYear(), date.getMonth(), cfg, applyOption(marks, date, o.id), tables);
    const after = result.dailyWage;
    let note;
    if (o.id === 'paidLeave') note = C.menu.paidNote;
    else if (o.id === 'unpaidLeave') note = C.menu.unpaidNote(amount(after, T));
    else if (!result.workdays && (o.id === 'rest' || !o.checked)) note = C.menu.noWorkdays;
    else if (o.checked) note = '';
    else if (o.id === 'rest') note = C.menu.restPreview(amount(before, T), amount(after, T));
    else if (cents(after) === cents(before)) note = C.menu.unchanged;
    else note = C.menu.preview(amount(before, T), amount(after, T));
    const label = o.id === 'default'
      ? (plain.reason === 'holiday' ? C.menu.defaultHoliday : plain.base === 'work' ? C.menu.defaultWork : C.menu.defaultRest)
      : C.menu.options[o.labelKey];
    return { ...o, label, note };
  });
  return { header: C.menu.header(dayTitle(date, T), statusText(info, plain, T)), items, footer: C.menu.footer };
}

export function dayTooltipModel(date, cfg, marks, tables, now, t) {
  const T = dict(t);
  const C = T.calendar;
  const info = dayInfo(date, cfg, marks, tables);
  const plain = dayInfo(date, cfg, {}, tables);
  const paid = info.base === 'work' && info.leave !== 'unpaid';
  const isToday = now && ymd(now) === ymd(date);
  // 'rule'：周末按周末规则；其他日子（含「周末计入」时的周末、无内置表年份的平日）按默认规则
  const sourceKey = info.source === 'rule' && info.reason !== 'weekend' ? 'default' : info.source;
  const sourceLabel = C.tip.sources[sourceKey];
  const statusShort = statusShortText(info, plain, T);
  const wage = paid ? monthDailyWage(date, cfg, marks, tables) : 0;
  const title = titleParts(date, T);
  const pay = payParts(amount(wage, T), T);
  return {
    lunar: cfg.showLunar ? lunarText(date, T)?.full ?? null : null,
    title: `${title.full}${isToday ? C.todaySuffix : ''}`,
    status: statusText(info, plain, T),
    source: C.tip.source(sourceLabel),
    pay: C.tip.pay(amount(wage, T)),
    hint: C.tip.hint,
    // 盖在格子上的提示用短写（设计稿）：来源只写类别、「计薪 ¥x」；完整句子仍在 aria-describedby
    sourceLabel: C.tip.sourcesShort[sourceKey] ?? sourceLabel,
    payShort: pay.full,
    titleShort: title.full,
    statusShort: isToday ? C.tip.todayTag(statusShort) : statusShort,
    // 结构化字段（Task 14）：提示排版直接用这些，不再解析翻译后的空白或分隔符
    titleDate: title.date,
    titleWeekday: title.weekday,
    titleSep: title.sep,
    payLabel: pay.label,
    payAmount: pay.amount,
    paySep: pay.sep,
    payZero: cents(wage) === 0,
  };
}

export const tooltipText = (m, t) =>
  dict(t).calendar.tip.join([m.title, m.lunar, m.status, m.source, m.pay, m.hint].filter(Boolean));
