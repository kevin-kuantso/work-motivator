// 純函式：月曆小選單的選項、日薪預覽與懸停提示內容（spec §12.1 / §12.2）。
// 所有文字、幣別與數字格式都取自必填的字典 t（= profile.strings）：本檔案不繫結任何一種語言，
// 也不提供預設字典——漏傳 t 會立刻報錯，而不是悄悄顯示另一種語言。不得在本檔案寫死介面文案。
import { dayInfo } from '../calendar.js';
import { monthWage } from '../calc.js';
import { money, ymd, lunarText } from './format.js';

// 選項 id → 儲存的標記（'default' = 刪除標記）；與 settings.js 的 MARKS 一致，不改儲存格式。
const OPTION_MARK = { default: undefined, work: 'work', rest: 'rest', paidLeave: 'paidLeave', unpaidLeave: 'unpaidLeave' };
const REST_OPTIONS = ['default', 'work'];
const WORK_OPTIONS = ['default', 'rest', 'paidLeave', 'unpaidLeave'];

// 字典必填：呼叫方（app / 月曆 / 測試）一律注入當前地區的 t，避免任一處回退成簡中
const dict = (t) => {
  if (!t || typeof t !== 'object' || !t.calendar) throw new TypeError('day-options: missing region dictionary t (profile.strings)');
  return t;
};
// 金額：符號與千分位都按當前地區（t.currency / t.locale）
const amount = (v, t) => `${dict(t).currency}${money(v, 2, dict(t))}`;

// plain = 不含手動標記的 dayInfo（R18）：已標記的日子仍按其預設型別給選項。
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

// 該選項生效後的當月日薪（固定月薪 ÷ 當月應出勤天數；帶薪 / 無薪假不改變分母）。
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

// 蓋在格子上的提示用的短狀態（R50）：不帶括號
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

// 把「日期 周X」拆回可再排版的單位：定位我們自己傳進去的星期字串，不假設間隔符是什麼（各地區寫法不同）。
// 提示裡日期與星期各是不可拆的單位，窄格子只在兩者之間換行。
function titleParts(date, t) {
  const wd = dict(t).weekdays[date.getDay()] ?? '';
  const full = dayTitle(date, t);
  const at = wd ? full.lastIndexOf(wd) : -1;
  if (at < 0) return { full, date: full, weekday: '', sep: '' };
  const head = full.slice(0, at);
  const dateText = head.trimEnd();
  return { full, date: dateText, weekday: wd, sep: head.slice(dateText.length) };
}

// 把「<說明> <金額>」拆成說明與金額：同樣定位金額本身，不改寫字典的句子。
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
  // 'rule'：週末按週末規則；其他日子（含「週末計入」時的週末、無內建表年份的平日）按預設規則
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
    // 蓋在格子上的提示用短寫（設計稿）：來源只寫類別、「計薪 ¥x」；完整句子仍在 aria-describedby
    sourceLabel: C.tip.sourcesShort[sourceKey] ?? sourceLabel,
    payShort: pay.full,
    titleShort: title.full,
    statusShort: isToday ? C.tip.todayTag(statusShort) : statusShort,
    // 結構化欄位（Task 14）：提示排版直接用這些，不再解析翻譯後的空白或分隔符
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
