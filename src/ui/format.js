// 纯函数：数字 / 时间 / 日期格式化（不碰 DOM，可在 node 测试）。
import { lunarDate } from '../lunar.js';

const fmtCache = new Map();
function nf(digits) {
  if (!fmtCache.has(digits)) {
    fmtCache.set(digits, new Intl.NumberFormat('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits }));
  }
  return fmtCache.get(digits);
}

const safe = (v) => (Number.isFinite(v) ? v : 0);

// 金额文字（不含货币符号），zh-CN 千分位。
export const money = (v, digits = 2) => nf(digits).format(safe(v));

// 主金额：4 位小数，拆出末两位以便降对比。
export function heroParts(v) {
  const s = money(v, 4);
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

// 倒数：向上取整到秒（14:12:00.4 距 17:00 显示 2小时48分0秒）。
export function duration(sec, t) {
  const total = Math.max(0, Math.ceil(safe(sec)));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  return t.duration(h, m, total % 60);
}

export const hours = (sec) => (safe(sec) / 3600).toFixed(2);

// 秒 → 整小时 + 整分钟（向下取整，分钟 0–59）：工时进度文字用（已工作 2小时0分 / 共 7小时）。
export function hourMinute(sec) {
  const total = Math.max(0, Math.floor(safe(sec) / 60));
  return { h: Math.floor(total / 60), m: total % 60 };
}

export const minutesCeil = (sec) => Math.max(0, Math.ceil(safe(sec) / 60));
