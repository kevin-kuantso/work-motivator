// 純函式：數字 / 時間 / 日期格式化（不碰 DOM，可在 node 測試）。
import { lunarDate } from '../lunar.js';

const FALLBACK_LOCALE = 'zh-CN';
const fmtCache = new Map();

// 取 locale：直接給 locale 字串，或給 profile / strings（兩者都帶 locale）。預設沿用 zh-CN，既有呼叫不改行為。
export function localeOf(x) {
  if (typeof x === 'string' && x !== '') return x;
  const loc = x && typeof x === 'object' ? x.locale : null;
  return typeof loc === 'string' && loc !== '' ? loc : FALLBACK_LOCALE;
}

function nf(digits, locale) {
  const key = `${locale}|${digits}`;
  if (!fmtCache.has(key)) {
    fmtCache.set(key, new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits }));
  }
  return fmtCache.get(key);
}

const safe = (v) => (Number.isFinite(v) ? v : 0);

// 金額文字（不含貨幣符號），千分位按 locale 決定。
export const money = (v, digits = 2, locale) => nf(digits, localeOf(locale)).format(safe(v));

// 主金額：4 位小數，拆出末兩位以便降對比。
export function heroParts(v, locale) {
  const s = money(v, 4, locale);
  return { head: s.slice(0, -2), tail: s.slice(-2) };
}

export const pad2 = (n) => String(n).padStart(2, '0');
export const ymd = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

export function dateLine(d, t) {
  return `${d.getFullYear()}/${pad2(d.getMonth() + 1)}/${pad2(d.getDate())} ${t.weekdays[d.getDay()]}`;
}

export function lunarText(date, t) {
  const l = lunarDate(date);
  if (!l) return null;
  const s = t.lunar;
  const month = (l.leap ? s.leap : '') + s.months[l.month - 1];
  const day = l.day < 10 ? s.first + s.digits[l.day - 1]
    : l.day === 10 ? s.first + s.ten
      : l.day < 20 ? s.ten + s.digits[l.day - 11]
        : l.day === 20 ? s.twenty
          : l.day < 30 ? s.twenties + s.digits[l.day - 21] : s.thirty;
  return { full: s.full(month, day), short: l.day === 1 ? month : day };
}

// 倒數：向上取整到秒（14:12:00.4 距 17:00 顯示 2小時48分0秒）。
export function duration(sec, t) {
  const total = Math.max(0, Math.ceil(safe(sec)));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  return t.duration(h, m, total % 60);
}

export const hours = (sec) => (safe(sec) / 3600).toFixed(2);

// 秒 → 整小時 + 整分鐘（向下取整，分鐘 0–59）：工時進度文字用（已工作 2小時0分 / 共 7小時）。
export function hourMinute(sec) {
  const total = Math.max(0, Math.floor(safe(sec) / 60));
  return { h: Math.floor(total / 60), m: total % 60 };
}

export const minutesCeil = (sec) => Math.max(0, Math.ceil(safe(sec) / 60));
