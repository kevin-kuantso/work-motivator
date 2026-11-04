// 中国大陆 2026 法定节假日（国办发明电〔2025〕7号），日期为本地 'YYYY-MM-DD'。
import { STRINGS } from './strings.zh-CN.js';

const H = STRINGS.holidays;
const pad = (n) => String(n).padStart(2, '0');

function expand(year, name, [m1, d1], [m2, d2], into) {
  const end = new Date(year, m2 - 1, d2);
  for (let t = new Date(year, m1 - 1, d1); t <= end; t = new Date(t.getFullYear(), t.getMonth(), t.getDate() + 1)) {
    into[`${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`] = name;
  }
}

function build(year, offRanges, makeupDays) {
  const off = {};
  const makeup = {};
  for (const [name, from, to] of offRanges) expand(year, name, from, to, off);
  for (const [name, m, d] of makeupDays) makeup[`${year}-${pad(m)}-${pad(d)}`] = name;
  return { off, makeup, source: 'builtin' };
}

export const HOLIDAYS_CN = {
  2026: build(
    2026,
    [
      [H.newYear, [1, 1], [1, 3]],
      [H.spring, [2, 15], [2, 23]],
      [H.qingming, [4, 4], [4, 6]],
      [H.labour, [5, 1], [5, 5]],
      [H.dragonBoat, [6, 19], [6, 21]],
      [H.midAutumn, [9, 25], [9, 27]],
      [H.national, [10, 1], [10, 7]],
    ],
    [
      [H.newYear, 1, 4],
      [H.spring, 2, 14],
      [H.spring, 2, 28],
      [H.labour, 5, 9],
      [H.national, 9, 20],
      [H.national, 10, 10],
    ],
  ),
};
