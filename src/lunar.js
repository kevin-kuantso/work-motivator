// Source: Hong Kong Observatory, Gregorian-Lunar Calendar Conversion Tables (2020–2060), AS IS.
// 压缩表每年首位为闰月，后四位按月份顺序编码大月；2019 年数据用于 2020 年初。
// 仅显示 2020–2060；2057 年存在历法边界不确定，整个月不显示。
const TABLE = '00c954152e0055600ab5215b2006d260ea5007250064b50c9700cab0055a30ad600b69b175200b5200b2561a4b00a4b004ab5055b005ad00b6a21b5200d9271d2500d2500a55514ad004b6005b530daa00ec981e9200e9200d2660a5600a5700556406d50075500749';
const DAY = 86400000;
const BASE = Date.UTC(2019, 1, 5);
const months = [];
let start = BASE;
for (let i = 0; i < TABLE.length; i += 5) {
  const leap = parseInt(TABLE[i], 16);
  const bits = parseInt(TABLE.slice(i + 1, i + 5), 16);
  for (let k = 0; k < (leap ? 13 : 12); k++) {
    const isLeap = Boolean(leap && k === leap);
    const month = leap && k >= leap ? k : k + 1;
    months.push({ start, month, leap: isLeap });
    start += ((bits >> k) & 1 ? 30 : 29) * DAY;
  }
}

export function lunarDate(date) {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) return null;
  const year = date.getFullYear();
  if (year < 2020 || year > 2060) return null;
  const time = Date.UTC(year, date.getMonth(), date.getDate());
  if (time >= Date.UTC(2057, 8, 28) && time < Date.UTC(2057, 9, 28)) return null;
  let lo = 0, hi = months.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (months[mid].start <= time) lo = mid + 1;
    else hi = mid;
  }
  if (!lo || time >= start) return null;
  const m = months[lo - 1];
  return { month: m.month, day: (time - m.start) / DAY + 1, leap: m.leap };
}
