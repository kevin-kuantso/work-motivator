// 纯校验：只回传稳定的 code（必要时附参数），绝不写死任何一种语言的句子。
// 显示端在真正要显示时用当时的字典翻成文字：text = typeof dict[code] === 'function' ? dict[code](params) : dict[code]
// 其中 dict 是 t.holidayData（年度数据）或 t.holidayUpdate（自定义网址）。params 是字典函数的唯一实参
//（年份 / HTTP 状态码这类纯量；没有参数的 code 不带 params），因此换语言、加地区都不必改这里。

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
  // code 对应 t.holidayUpdate 的同名键（都是无参数的句子）
  const bad = (code) => ({ ok: false, code });
  if (typeof s !== 'string') return bad('customUrlError');
  if (!/^[\x21-\x7E]+$/.test(s)) return bad('customUrlChars');
  if (s.includes('\\')) return bad('customUrlBackslash');
  if (!s.startsWith(SCHEME) || !s.includes(YEAR_TOKEN)) return bad('customUrlError');
  let a;
  let b;
  try {
    a = new URL(buildSourceUrl(s, 2000));
    b = new URL(buildSourceUrl(s, 2001));
  } catch {
    return bad('customUrlError');
  }
  if (a.protocol !== 'https:' || !a.hostname) return bad('customUrlError');
  if (a.username || a.password) return bad('customUrlUserinfo');
  const fixed = (u) => [u.host, u.hash].join(' ');
  const varying = (u) => `${u.pathname}${u.search}`;
  if (fixed(a) !== fixed(b) || varying(a) === varying(b)) return bad('customUrlYearPlace');
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

// 把 { code, params } 按传入的字典翻成文字（t.holidayData 或 t.holidayUpdate 整份传进来）。
// 字典函数收 params 本身；params 是数组时展开。没有对应的键就退回 reason.text（旧流程遗留的句子），否则空字符串。
// 与 calc.js 的 reasonText(reason, t) 分工不同：那个读 t.reasons 且有别名，这个的字典命名空间由调用端决定。
export function renderReason(reason, dict) {
  if (!reason) return '';
  if (typeof reason === 'string') return reason; // 旧流程遗留的整句：原样返回，不假设任何前缀
  const v = reason.code ? dict?.[reason.code] : undefined;
  if (typeof v === 'function') {
    const args = reason.params;
    return (Array.isArray(args) ? v(...args) : v(args)) ?? '';
  }
  if (typeof v === 'string') return v;
  return typeof reason.text === 'string' ? reason.text : '';
}

// 校验来自网络的不可信 JSON：任何一项不合格即整份拒绝，不转型、不挑拣。
// 失败时回传 { ok: false, code, params? }，code 是 t.holidayData 的键名；由调用方按当时的字典翻成文字。
export function validateHolidayYear(json, year) {
  const bad = (code, params) => (params === undefined ? { ok: false, code } : { ok: false, code, params });
  if (!isPlainObject(json)) return bad('notObject');
  if (json.year !== year) return bad('yearMismatch', year);
  const { papers, days } = json;
  if (!Array.isArray(papers) || papers.length === 0) return bad('papersMissing');
  if (!papers.every((p) => typeof p === 'string' && p.startsWith(PAPERS_PREFIX))) return bad('papersBad');
  if (!Array.isArray(days) || days.length === 0) return bad('daysEmpty');

  const off = {};
  const makeup = {};
  const seen = new Set();
  for (const day of days) {
    if (!isPlainObject(day)) return bad('dayShape');
    const { name, date, isOffDay } = day;
    if (typeof name !== 'string' || name.trim() === '' || [...name].length > 10) return bad('dayName');
    if (typeof date !== 'string') return bad('dayDate');
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
    if (!m) return bad('dayDate');
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const dow = weekdayOfRealDate(y, mo, d);
    if (dow === null) return bad('dayNotReal');
    if (y !== year) return bad('dayOutOfYear', year);
    if (typeof isOffDay !== 'boolean') return bad('dayOffFlag');
    if (!isOffDay && dow !== 0 && dow !== 6) return bad('makeupNotWeekend');
    if (seen.has(date)) return bad('dayDuplicate');
    seen.add(date);
    (isOffDay ? off : makeup)[date] = name;
  }
  if (Object.keys(off).length === 0) return bad('noOffDays');
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
  const NO_SOURCE = { code: 'noSource' };
  if (sources.length === 0 || !fetchImpl) return { ok: false, kind: 'network', reason: NO_SOURCE };

  // 失败种类（多个来源时取最有信息量的）：invalid（拿到了但不合格）> unpublished（来源暂未发布）> network（连不上 / HTTP 错误）
  const RANK = { network: 0, unpublished: 1, invalid: 2 };
  let kind = 'network';
  let last = NO_SOURCE;
  let lastOfKind = NO_SOURCE;
  let formatOfKind = false; // 选中的失败原因是否来自 validateHolidayYear（格式 / 内容不合格；R47：界面据此提供「查看格式示例」）
  const note = (k, reason, format = false) => {
    last = reason;
    if (RANK[k] >= RANK[kind]) { kind = k; lastOfKind = reason; formatOfKind = format; }
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
        note('network', { code: 'httpFail', params: res ? res.status : 0 });
        continue;
      }
      if (notHttps) {
        note('invalid', { code: 'notHttps' });
        continue;
      }
      if (tooLarge || (typeof text === 'string' && byteLength(text) > MAX_BODY)) {
        note('invalid', { code: 'tooLarge' });
        continue;
      }
      let json;
      try {
        json = JSON.parse(text);
      } catch {
        note('invalid', { code: 'notJson' });
        continue;
      }
      const v = validateHolidayYear(json, year);
      if (v.ok) return { ok: true, table: v.table, papers: v.papers, source: url };
      // validateHolidayYear 只给 code/params：这里原样转交（绝不要读 v.reason，它已不存在）
      const why = v.params === undefined ? { code: v.code } : { code: v.code, params: v.params };
      if (isUnpublishedYear(json, year)) note('unpublished', why);
      else note('invalid', why, true);
    } catch {
      note('network', { code: timedOut ? 'timeout' : 'network' });
    } finally {
      clearTimeout(timer);
    }
  }
  // reason 是「最有信息量的那一个来源」的失败本身（不是已经拼好的句子）：
  // 显示端自己决定要不要套上「所有数据源都获取失败：」之类的外框，换语言时整句一起重译。
  return { ok: false, kind, reason: kind === 'network' ? last : lastOfKind, format: kind === 'invalid' && formatOfKind };
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
