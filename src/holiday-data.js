// 純校驗：只回傳穩定的 code（必要時附引數），絕不寫死任何一種語言的句子。
// 顯示端在真正要顯示時用當時的字典翻成文字：text = typeof dict[code] === 'function' ? dict[code](params) : dict[code]
// 其中 dict 是 t.holidayData（年度資料）或 t.holidayUpdate（自定義網址）。params 是字典函式的唯一實參
//（年份 / HTTP 狀態碼這類純量；沒有引數的 code 不帶 params），因此換語言、加地區都不必改這裡。

// 預設資料來源（{year} 會被替換為年份）。不使用任何第三方代理。
// 順序（R37）：大陸 OONI 測量（2026-05 至 11 月）cdn.jsdelivr.net 大多可達、raw.githubusercontent.com 在電信約一半失敗、
// fastly.jsdelivr.net 無資料——沒有一個保證可達。jsDelivr @master 在 CDN 可能滯後最多 12 小時，
// 所以某個來源給出空檔案 / 不合格資料時仍繼續嘗試下一個（新發布的年份可能先出現在 raw 上）。
export const DEFAULT_HOLIDAY_SOURCES = Object.freeze([
  'https://cdn.jsdelivr.net/gh/NateScarlet/holiday-cn@master/{year}.json',
  'https://fastly.jsdelivr.net/gh/NateScarlet/holiday-cn@master/{year}.json',
  'https://raw.githubusercontent.com/NateScarlet/holiday-cn/master/{year}.json',
]);

const PAPERS_PREFIX = 'https://www.gov.cn/';
const SCHEME = 'https://';
const YEAR_TOKEN = '{year}';
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_BODY = 256 * 1024; // 一年的假期表約 3 KB；超過 256 KB 直接拒絕，不解析
const byteLength = (str) => (typeof TextEncoder === 'function' ? new TextEncoder().encode(str).length : str.length);
const isPlainObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

// 真實日期檢查；返回當天星期（0 = 週日），不是真實日期返回 null。
function weekdayOfRealDate(y, m, d) {
  const dt = new Date(Date.UTC(2000, m - 1, d));
  dt.setUTCFullYear(y); // 避開 Date.UTC 對 0-99 年的 +1900 對映
  const real = dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  return real ? dt.getUTCDay() : null;
}

// 把來源模板裡的每個 {year} 換成年份。
export function buildSourceUrl(template, year) {
  return String(template).split(YEAR_TOKEN).join(String(year));
}

// 使用者填的「自定義網址」：不去空格、不改大小寫（不猜測修補）。規則（R32）：
// 只含可見 ASCII（拒絕空格、控制字元、零寬字元、中文等）；沒有反斜槓；以 https:// 開頭且含 {year}；
// 用兩個不同的樣例年份解析：協議必須是 https:，不帶使用者名稱 / 密碼，{year} 只能影響路徑或查詢引數（主機、埠、# 後面都不能變）。
export function validateCustomUrl(s) {
  // code 對應 t.holidayUpdate 的同名鍵（都是無引數的句子）
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

// 來源順序：自定義網址（合法時）優先，再依次三個預設來源。
export function sourcesWith(customUrl) {
  const custom = customUrl && validateCustomUrl(customUrl).ok ? [customUrl] : [];
  return [...custom, ...DEFAULT_HOLIDAY_SOURCES];
}

// 上游「該年還沒釋出」的真實形狀：年份相符、papers 與 days 都是空陣列（2027 實測如此）。不是「該年沒有假日」。
export function isUnpublishedYear(json, year) {
  return isPlainObject(json) && json.year === year
    && Array.isArray(json.papers) && json.papers.length === 0
    && Array.isArray(json.days) && json.days.length === 0;
}

// 把 { code, params } 按傳入的字典翻成文字（t.holidayData 或 t.holidayUpdate 整份傳進來）。
// 字典函式收 params 本身；params 是陣列時展開。沒有對應的鍵就退回 reason.text（舊流程遺留的句子），否則空字串。
// 與 calc.js 的 reasonText(reason, t) 分工不同：那個讀 t.reasons 且有別名，這個的字典名稱空間由呼叫端決定。
export function renderReason(reason, dict) {
  if (!reason) return '';
  if (typeof reason === 'string') return reason; // 舊流程遺留的整句：原樣返回，不假設任何字首
  const v = reason.code ? dict?.[reason.code] : undefined;
  if (typeof v === 'function') {
    const args = reason.params;
    return (Array.isArray(args) ? v(...args) : v(args)) ?? '';
  }
  if (typeof v === 'string') return v;
  return typeof reason.text === 'string' ? reason.text : '';
}

// 校驗來自網路的不可信 JSON：任何一項不合格即整份拒絕，不轉型、不挑揀。
// 失敗時回傳 { ok: false, code, params? }，code 是 t.holidayData 的鍵名；由呼叫方按當時的字典翻成文字。
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

// 內建年份優先；online 只補充內建沒有的年份。
export function mergeTables(builtin, online) {
  const out = {};
  for (const y of Object.keys(online ?? {})) out[y] = online[y];
  for (const y of Object.keys(builtin ?? {})) out[y] = builtin[y];
  return out;
}

export async function fetchHolidayYear(year, opts = {}) {
  const sources = Array.isArray(opts.sources) ? opts.sources : [...DEFAULT_HOLIDAY_SOURCES];
  const fetchImpl = opts.fetchImpl ?? (typeof fetch === 'function' ? fetch : null);
  const timeoutMs = opts.timeoutMs ?? 5000; // 每個來源 5 秒（R37）：三個來源最壞約 15 秒 / 年
  const NO_SOURCE = { code: 'noSource' };
  if (sources.length === 0 || !fetchImpl) return { ok: false, kind: 'network', reason: NO_SOURCE };

  // 失敗種類（多個來源時取最有資訊量的）：invalid（拿到了但不合格）> unpublished（來源暫未釋出）> network（連不上 / HTTP 錯誤）
  const RANK = { network: 0, unpublished: 1, invalid: 2 };
  let kind = 'network';
  let last = NO_SOURCE;
  let lastOfKind = NO_SOURCE;
  let formatOfKind = false; // 選中的失敗原因是否來自 validateHolidayYear（格式 / 內容不合格；R47：介面據此提供「檢視格式示例」）
  const note = (k, reason, format = false) => {
    last = reason;
    if (RANK[k] >= RANK[kind]) { kind = k; lastOfKind = reason; formatOfKind = format; }
  };
  for (const template of sources) {
    const url = buildSourceUrl(template, year);
    const ctrl = new AbortController();
    let timedOut = false;
    let timer;
    // 牆鍾兜底（R32）：不依賴 AbortSignal——即使 fetchImpl 不理會 signal，也會在 timeoutMs 後結束為「連線超時」
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
    attempt.catch(() => {}); // 兜底先到時，遲到的失敗不成為未處理的 rejection
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
      // validateHolidayYear 只給 code/params：這裡原樣轉交（絕不要讀 v.reason，它已不存在）
      const why = v.params === undefined ? { code: v.code } : { code: v.code, params: v.params };
      if (isUnpublishedYear(json, year)) note('unpublished', why);
      else note('invalid', why, true);
    } catch {
      note('network', { code: timedOut ? 'timeout' : 'network' });
    } finally {
      clearTimeout(timer);
    }
  }
  // reason 是「最有資訊量的那一個來源」的失敗本身（不是已經拼好的句子）：
  // 顯示端自己決定要不要套上「所有資料來源都獲取失敗：」之類的外框，換語言時整句一起重譯。
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
