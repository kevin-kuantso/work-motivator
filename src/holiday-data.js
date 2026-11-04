import { STRINGS } from './strings.zh-CN.js';

const R = STRINGS.holidayData;

// 默认数据源（{year} 会被替换为年份）。不使用任何第三方代理。
// 顺序（R37）：大陆 OONI 测量（2026-05 至 11 月）cdn.jsdelivr.net 大多可达、raw.githubusercontent.com 在电信约一半失败、
// fastly.jsdelivr.net 无数据——没有一个保证可达。jsDelivr @master 在 CDN 可能滞后最多 12 小时，
// 所以某个来源给出空文件 / 不合格数据时仍继续尝试下一个（新发布的年份可能先出现在 raw 上）。
export const DEFAULT_HOLIDAY_SOURCES = Object.freeze([
  'https://cdn.jsdelivr.net/gh/NateScarlet/holiday-cn@master/{year}.json',
  'https://fastly.jsdelivr.net/gh/NateScarlet/holiday-cn@master/{year}.json',
  'https://raw.githubusercontent.com/NateScarlet/holiday-cn/master/{year}.json',
]);

const PAPERS_PREFIX = 'https://www.gov.cn/';
const SCHEME = 'https://';
const YEAR_TOKEN = '{year}';
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_BODY = 256 * 1024; // 一年的假期表约 3 KB；超过 256 KB 直接拒绝，不解析
const byteLength = (str) => (typeof TextEncoder === 'function' ? new TextEncoder().encode(str).length : str.length);
const isPlainObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

// 真实日期检查；返回当天星期（0 = 周日），不是真实日期返回 null。
function weekdayOfRealDate(y, m, d) {
  const dt = new Date(Date.UTC(2000, m - 1, d));
  dt.setUTCFullYear(y); // 避开 Date.UTC 对 0-99 年的 +1900 映射
  const real = dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  return real ? dt.getUTCDay() : null;
}

// 把来源模板里的每个 {year} 换成年份。
export function buildSourceUrl(template, year) {
  return String(template).split(YEAR_TOKEN).join(String(year));
}

// 用户填的「自定义网址」：不去空格、不改大小写（不猜测修补）。规则（R32）：
// 只含可见 ASCII（拒绝空格、控制字符、零宽字符、中文等）；没有反斜杠；以 https:// 开头且含 {year}；
// 用两个不同的样例年份解析：协议必须是 https:，不带用户名 / 密码，{year} 只能影响路径或查询参数（主机、端口、# 后面都不能变）。
export function validateCustomUrl(s) {
  const C = STRINGS.holidayUpdate;
  const bad = (reason) => ({ ok: false, reason });
  if (typeof s !== 'string') return bad(C.customUrlError);
  if (!/^[\x21-\x7E]+$/.test(s)) return bad(C.customUrlChars);
  if (s.includes('\\')) return bad(C.customUrlBackslash);
  if (!s.startsWith(SCHEME) || !s.includes(YEAR_TOKEN)) return bad(C.customUrlError);
  let a;
  let b;
  try {
    a = new URL(buildSourceUrl(s, 2000));
    b = new URL(buildSourceUrl(s, 2001));
  } catch {
    return bad(C.customUrlError);
  }
  if (a.protocol !== 'https:' || !a.hostname) return bad(C.customUrlError);
  if (a.username || a.password) return bad(C.customUrlUserinfo);
  const fixed = (u) => [u.host, u.hash].join(' ');
  const varying = (u) => `${u.pathname}${u.search}`;
  if (fixed(a) !== fixed(b) || varying(a) === varying(b)) return bad(C.customUrlYearPlace);
  return { ok: true, url: s };
}

// 来源顺序：自定义网址（合法时）优先，再依次三个默认来源。
export function sourcesWith(customUrl) {
  const custom = customUrl && validateCustomUrl(customUrl).ok ? [customUrl] : [];
  return [...custom, ...DEFAULT_HOLIDAY_SOURCES];
}

// 上游「该年还没发布」的真实形状：年份相符、papers 与 days 都是空数组（2027 实测如此）。不是「该年没有假日」。
export function isUnpublishedYear(json, year) {
  return isPlainObject(json) && json.year === year
    && Array.isArray(json.papers) && json.papers.length === 0
    && Array.isArray(json.days) && json.days.length === 0;
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
  if (Object.keys(off).length === 0) return bad(R.noOffDays);
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
  const timeoutMs = opts.timeoutMs ?? 5000; // 每个来源 5 秒（R37）：三个来源最坏约 15 秒 / 年
  if (sources.length === 0 || !fetchImpl) return { ok: false, kind: 'network', reason: R.allFailed(R.noSource) };

  // 失败种类（多个来源时取最有信息量的）：invalid（拿到了但不合格）> unpublished（来源暂未发布）> network（连不上 / HTTP 错误）
  const RANK = { network: 0, unpublished: 1, invalid: 2 };
  let kind = 'network';
  let last = R.noSource;
  let lastOfKind = R.noSource;
  const note = (k, reason) => {
    last = reason;
    if (RANK[k] >= RANK[kind]) { kind = k; lastOfKind = reason; }
  };
  for (const template of sources) {
    const url = buildSourceUrl(template, year);
    const ctrl = new AbortController();
    let timedOut = false;
    let timer;
    // 墙钟兜底（R32）：不依赖 AbortSignal——即使 fetchImpl 不理会 signal，也会在 timeoutMs 后结束为「连接超时」
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => { timedOut = true; ctrl.abort(); reject(new Error('timeout')); }, timeoutMs);
    });
    const attempt = (async () => {
      const res = await fetchImpl(url, { cache: 'no-store', signal: ctrl.signal });
      if (!res || !res.ok) return { res };
      if (typeof res.url === 'string' && res.url !== '' && !res.url.startsWith(SCHEME)) return { res, notHttps: true };
      const len = Number(res.headers?.get?.('content-length'));
      if (Number.isFinite(len) && len > MAX_BODY) return { res, tooLarge: true };
      return { res, text: await res.text() };
    })();
    attempt.catch(() => {}); // 兜底先到时，迟到的失败不成为未处理的 rejection
    try {
      const { res, text, notHttps, tooLarge } = await Promise.race([attempt, deadline]);
      if (!res || !res.ok) {
        note('network', R.httpFail(res ? res.status : 0));
        continue;
      }
      if (notHttps) {
        note('invalid', R.notHttps);
        continue;
      }
      if (tooLarge || (typeof text === 'string' && byteLength(text) > MAX_BODY)) {
        note('invalid', R.tooLarge);
        continue;
      }
      let json;
      try {
        json = JSON.parse(text);
      } catch {
        note('invalid', R.notJson);
        continue;
      }
      const v = validateHolidayYear(json, year);
      if (v.ok) return { ok: true, table: v.table, papers: v.papers, source: url };
      note(isUnpublishedYear(json, year) ? 'unpublished' : 'invalid', v.reason);
    } catch {
      note('network', timedOut ? R.timeout : R.network);
    } finally {
      clearTimeout(timer);
    }
  }
  return { ok: false, kind, reason: R.allFailed(kind === 'network' ? last : lastOfKind) };
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
