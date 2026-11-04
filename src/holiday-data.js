import { STRINGS } from './strings.zh-CN.js';

const R = STRINGS.holidayData;

// 默认数据源（{year} 会被替换为年份）。不使用任何第三方代理。
export const DEFAULT_HOLIDAY_SOURCES = Object.freeze([
  'https://raw.githubusercontent.com/NateScarlet/holiday-cn/master/{year}.json',
  'https://cdn.jsdelivr.net/gh/NateScarlet/holiday-cn@master/{year}.json',
  'https://fastly.jsdelivr.net/gh/NateScarlet/holiday-cn@master/{year}.json',
]);

const PAPERS_PREFIX = 'https://www.gov.cn/';
const DAY_MS = 24 * 60 * 60 * 1000;
const isPlainObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

// 真实日期检查；返回当天星期（0 = 周日），不是真实日期返回 null。
function weekdayOfRealDate(y, m, d) {
  const dt = new Date(Date.UTC(2000, m - 1, d));
  dt.setUTCFullYear(y); // 避开 Date.UTC 对 0-99 年的 +1900 映射
  const real = dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  return real ? dt.getUTCDay() : null;
}

// 校验来自网络的不可信 JSON：任何一项不合格即整份拒绝，不转型、不挑拣。
export function validateHolidayYear(json, year) {
  const bad = (reason) => ({ ok: false, reason });
  if (!isPlainObject(json)) return bad(R.notObject);
  if (json.year !== year) return bad(R.yearMismatch(year));
  const { papers, days } = json;
  if (!Array.isArray(papers) || papers.length === 0) return bad(R.papersMissing);
  if (!papers.every((p) => typeof p === 'string' && p.startsWith(PAPERS_PREFIX))) return bad(R.papersBad);
  if (!Array.isArray(days) || days.length === 0) return bad(R.daysEmpty);

  const off = {};
  const makeup = {};
  const seen = new Set();
  for (const day of days) {
    if (!isPlainObject(day)) return bad(R.dayShape);
    const { name, date, isOffDay } = day;
    if (typeof name !== 'string' || name.trim() === '' || [...name].length > 10) return bad(R.dayName);
    if (typeof date !== 'string') return bad(R.dayDate);
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
    if (!m) return bad(R.dayDate);
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const dow = weekdayOfRealDate(y, mo, d);
    if (dow === null) return bad(R.dayNotReal);
    if (y !== year) return bad(R.dayOutOfYear(year));
    if (typeof isOffDay !== 'boolean') return bad(R.dayOffFlag);
    if (!isOffDay && dow !== 0 && dow !== 6) return bad(R.makeupNotWeekend);
    if (seen.has(date)) return bad(R.dayDuplicate);
    seen.add(date);
    (isOffDay ? off : makeup)[date] = name;
  }
  return { ok: true, table: { off, makeup }, papers: [...papers] };
}

// 内置年份优先；online 只补充内置没有的年份。
export function mergeTables(builtin, online) {
  const out = {};
  for (const y of Object.keys(online ?? {})) out[y] = online[y];
  for (const y of Object.keys(builtin ?? {})) out[y] = builtin[y];
  return out;
}

export async function fetchHolidayYear(year, opts = {}) {
  const sources = Array.isArray(opts.sources) ? opts.sources : [...DEFAULT_HOLIDAY_SOURCES];
  const fetchImpl = opts.fetchImpl ?? (typeof fetch === 'function' ? fetch : null);
  const timeoutMs = opts.timeoutMs ?? 8000;
  if (sources.length === 0 || !fetchImpl) return { ok: false, reason: R.allFailed(R.noSource) };

  let last = R.noSource;
  for (const template of sources) {
    const url = String(template).split('{year}').join(String(year));
    const ctrl = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, timeoutMs);
    try {
      const res = await fetchImpl(url, { cache: 'no-store', signal: ctrl.signal });
      if (!res || !res.ok) {
        last = R.httpFail(res ? res.status : 0);
        continue;
      }
      const text = await res.text();
      let json;
      try {
        json = JSON.parse(text);
      } catch {
        last = R.notJson;
        continue;
      }
      const v = validateHolidayYear(json, year);
      if (v.ok) return { ok: true, table: v.table, papers: v.papers, source: url };
      last = v.reason;
    } catch {
      last = timedOut ? R.timeout : R.network;
    } finally {
      clearTimeout(timer);
    }
  }
  return { ok: false, reason: R.allFailed(last) };
}

export function yearsToAutoCheck(now, tables, lastCheckMs) {
  if (typeof lastCheckMs === 'number' && Number.isFinite(lastCheckMs)) {
    const age = now.getTime() - lastCheckMs;
    if (age >= 0 && age < DAY_MS) return [];
  }
  const t = tables ?? {};
  const year = now.getFullYear();
  const out = [];
  if (!has(t, year)) out.push(year);
  if (now.getMonth() >= 10 && !has(t, year + 1)) out.push(year + 1);
  return out;
}
