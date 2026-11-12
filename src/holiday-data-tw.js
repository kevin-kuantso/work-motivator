// 臺灣辦公日曆 provider：官方 CSV 解析／驗證與合併。
// 只做「純資料」的事：不碰 DOM、不 import 任何中國模組、不寫死任何語言的句子。
// 失敗一律回穩定的 code（必要時附 params 物件），由畫面用當前字典翻譯；params 對應字典的 param(p, key)。
//
// 為什麼不連網：政府資料開放平臺資料集 14718（行政院人事行政總處
// 《中華民國政府行政機關辦公日曆表》）在實測本機 Chrome 單檔環境無法跨來源讀取；
// 其他環境未逐一驗證。因此不做線上檢查：2026／2027 內建，其他年度由使用者手動匯入官方 CSV。
// 匯入的 CSV 逐列嚴格驗證（全年逐日、不重複、星期與日期相符、狀態只有 0／2）才採用。
// 臺灣沒有中國那種「法定日期回退」：缺表就是缺表，不猜節日、不猜補班、不用中國資料代替。
import { TW_BUILTIN_TABLES } from './holidays-tw.js';

export { TW_BUILTIN_TABLES };

export const TW_MAX_BYTES = 256 * 1024; // 一年 CSV 約 6.5 KB；超過 256 KB 直接拒絕，不解析
export const TW_MAX_NAME = 200; // 節名長度上限（官方最長 15 字，留給未來更長的節名）
export const TW_MAX_ROWS = 3660; // 約 10 年的列數；即使沒超過位元組上限也不會無限解析
export const TW_CSV_HEADER = Object.freeze(['西元日期', '星期', '是否放假', '備註']);
// 官方沒有給名稱的放假日／補班日要用的一般文字。呼叫端可傳入當前字典的用語覆蓋。
export const DEFAULT_TW_LABELS = Object.freeze({ off: '放假', makeup: '補班' });

const STATUS_WORK = '0';
const STATUS_OFF = '2';
const WEEKDAY_TOKENS = Object.freeze(['日', '一', '二', '三', '四', '五', '六']); // 索引 = getUTCDay()

const DATE_RE = /^(\d{4})(\d{2})(\d{2})$/;
const DATE_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const YEAR_KEY_RE = /^\d{4}$/;
// 節名允許換行（標準 CSV 的引號欄位本來就可以跨行），但不允許其他控制字元。
const NAME_CONTROL_RE = /[\x00-\x09\x0B-\x1F\x7F]/;

const isPlainObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const pad2 = (n) => String(n).padStart(2, '0');

const fail = (kind, code, params, format) => ({
  ok: false, kind, code, params: params ?? null, format: format === true,
});

// 節名：不是空白、沒有前後空白、長度與可見字元都合格（換行允許，其他控制字元不行）。
function isValidName(name) {
  return typeof name === 'string' && name !== '' && name.trim() === name
    && [...name].length <= TW_MAX_NAME && !NAME_CONTROL_RE.test(name);
}

// UTF-8 位元組長度（不為了量長度而配置整個緩衝區）。
function utf8Length(text) {
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xD800 && c <= 0xDBFF && i + 1 < text.length
      && text.charCodeAt(i + 1) >= 0xDC00 && text.charCodeAt(i + 1) <= 0xDFFF) { n += 4; i += 1; } else n += 3;
  }
  return n;
}

function isLeap(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year, month) {
  if (month === 2) return isLeap(year) ? 29 : 28;
  return [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 0;
}

// 真實日期檢查（用 UTC 構造避開時區），回傳 { dow, key }；不存在回傳 null。
function dateInfo(year, month, day) {
  if (!(month >= 1 && month <= 12) || !(day >= 1 && day <= 31)) return null;
  const dt = new Date(Date.UTC(2000, month - 1, day));
  dt.setUTCFullYear(year); // 避開 Date.UTC 對 0-99 年的 +1900 對映
  if (dt.getUTCFullYear() !== year || dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== day) return null;
  return { dow: dt.getUTCDay(), key: `${year}-${pad2(month)}-${pad2(day)}` };
}

// ---- CSV ----
// 標準 CSV：引號包住可含逗號與換行的欄位、"" 表示一個引號；CRLF／LF／CR 都接受。
// 收尾的引號後面只能接逗號、換行或檔尾，否則視為不合格（不猜使用者想表達什麼）。
// 回傳 rows 或 null（引號不成對等結構錯誤）。
function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  let afterQuote = false;
  let i = 0;
  const n = text.length;
  const endRow = () => {
    row.push(field);
    rows.push(row);
    row = [];
    field = '';
    afterQuote = false;
  };
  while (i < n) {
    const c = text.charAt(i);
    if (quoted) {
      if (c === '"') {
        if (text.charAt(i + 1) === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        afterQuote = true;
        i += 1;
        continue;
      }
      field += c;
      i += 1;
      continue;
    }
    if (afterQuote) {
      if (c === ',') { row.push(field); field = ''; afterQuote = false; i += 1; continue; }
      if (c === '\r') { if (text.charAt(i + 1) === '\n') i += 1; endRow(); i += 1; continue; }
      if (c === '\n') { endRow(); i += 1; continue; }
      return null;
    }
    if (c === '"') {
      if (field !== '') return null; // 引號只能出現在欄位開頭
      quoted = true;
      i += 1;
      continue;
    }
    if (c === ',') { row.push(field); field = ''; i += 1; continue; }
    if (c === '\r') { if (text.charAt(i + 1) === '\n') i += 1; endRow(); i += 1; continue; }
    if (c === '\n') { endRow(); i += 1; continue; }
    field += c;
    i += 1;
  }
  if (quoted) return null;
  if (afterQuote || field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

// 正規化表驗證（與儲存層的規則一致：真實日期、在該年內、有名稱、不重複、至少一天放假）。
// 回傳 { ok:true, table, counts } 或 { ok:false, code, params }。code 對應字典 holidayUpdate.codes。
export function validateTwYear(year, table) {
  const bad = (code, params) => ({ ok: false, code, params: params ?? null });
  if (!Number.isInteger(year) || year < 1000 || year > 9999) return bad('year');
  if (!isPlainObject(table)) return bad('table');
  if (!isPlainObject(table.off)) return bad('offShape');
  if (!isPlainObject(table.makeup)) return bad('makeupShape');
  const off = {};
  const makeup = {};
  const seen = new Set();
  const take = (map, isOff) => {
    for (const [date, name] of Object.entries(map)) {
      const m = DATE_KEY_RE.exec(date);
      if (!m) return bad('dateKey', { date });
      const y = Number(m[1]);
      const info = dateInfo(y, Number(m[2]), Number(m[3]));
      if (!info) return bad('dateNotReal', { date });
      if (y !== year) return bad('dateOutOfYear', { date });
      if (!isValidName(name)) return bad('name', { date });
      if (seen.has(date)) return bad('duplicate', { date }); // 同一天不能既是放假又是補班
      seen.add(date);
      (isOff ? off : makeup)[date] = name;
    }
    return null;
  };
  const failure = take(table.off, true) ?? take(table.makeup, false);
  if (failure) return failure;
  if (Object.keys(off).length === 0) return bad('emptyOff');
  return {
    ok: true,
    table: { off, makeup },
    counts: { off: Object.keys(off).length, makeup: Object.keys(makeup).length },
  };
}

function normalizeLabels(labels) {
  const out = { ...DEFAULT_TW_LABELS };
  if (isPlainObject(labels)) {
    if (isValidName(labels.off)) out.off = labels.off;
    if (isValidName(labels.makeup)) out.makeup = labels.makeup;
  }
  return out;
}

// 一年逐日：缺任何一天就整份拒絕（回傳第一個缺少的日期）；週末與狀態的語意集中在這裡：
//   狀態 2（放假）＋有名稱 → 放假（保留官方節名）
//   狀態 2（放假）＋無名稱且是平日 → 放假（一般「放假」文字）
//   狀態 2（放假）＋無名稱且是週末 → 不進表，交給週末規則（週末本來就是休假日，寫進表會讓週末變成不可依設定調整的假日）
//   狀態 0（上班）＋是週末 → 補班（用官方備註，沒有就用一般「補班」文字）
//   狀態 0（上班）＋是平日 → 不進表
function buildYearTable(year, days, labels) {
  const off = {};
  const makeup = {};
  for (let month = 1; month <= 12; month++) {
    const dim = daysInMonth(year, month);
    for (let day = 1; day <= dim; day++) {
      const info = dateInfo(year, month, day);
      const record = days.get(info.key);
      if (!record) return { ok: false, code: 'missingDay', params: { date: info.key } };
      const weekend = info.dow === 0 || info.dow === 6;
      const named = record.remark !== '';
      if (record.status === STATUS_OFF) {
        if (named) off[info.key] = record.remark;
        else if (!weekend) off[info.key] = labels.off;
      } else if (weekend) {
        makeup[info.key] = named ? record.remark : labels.makeup;
      }
    }
  }
  return { ok: true, value: { off, makeup } };
}

// 解析官方年度 CSV（可含多個年度，每個年度都必須完整）。
// opts.expectedYear：指定年份時，其他年份的列一律拒絕（wrongYear）。
// opts.labels：一般「放假」／「補班」文字（預設繁體）。
// 成功：{ ok:true, tables:{ 'YYYY': { off, makeup } }, years:[...], labels }。永不拋錯。
export function parseTwCsv(text, opts = {}) {
  if (typeof text !== 'string') return fail('invalid', 'notText', null, false);
  if (utf8Length(text) > TW_MAX_BYTES) return fail('invalid', 'tooLarge', null, false);
  const body = text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text; // 去掉 UTF-8 BOM 字元
  const rows = parseCsvRows(body);
  if (!rows) return fail('invalid', 'notCsv', null, true);
  if (rows.length > TW_MAX_ROWS) return fail('invalid', 'tooLarge', null, false);
  const lines = rows.filter((r) => !(r.length === 1 && r[0].trim() === '')); // 略過空行，其餘一律嚴格
  if (lines.length === 0) return fail('invalid', 'notCsv', null, true);
  const head = lines[0].map((c) => c.trim());
  if (head.length !== TW_CSV_HEADER.length || head.some((c, i) => c !== TW_CSV_HEADER[i])) {
    return fail('invalid', 'notCsv', null, true);
  }
  const expectedYear = Number.isInteger(opts.expectedYear) ? opts.expectedYear : null;
  const labels = normalizeLabels(opts.labels);

  const byYear = new Map();
  const seen = new Set();
  for (let i = 1; i < lines.length; i++) {
    const row = lines[i];
    if (row.length !== 4) return fail('invalid', 'badRowShape', expectedYear ? { year: expectedYear } : null, true);
    const rawDate = row[0].trim();
    const m = DATE_RE.exec(rawDate);
    if (!m) return fail('invalid', 'badDate', { date: rawDate }, true);
    const year = Number(m[1]);
    const info = dateInfo(year, Number(m[2]), Number(m[3]));
    if (!info) return fail('invalid', 'badDate', { date: rawDate }, true);
    if (expectedYear !== null && year !== expectedYear) {
      return fail('invalid', 'wrongYear', { year }, true);
    }
    const token = row[1].trim();
    const dow = WEEKDAY_TOKENS.indexOf(token);
    if (dow < 0 || dow !== info.dow) return fail('invalid', 'badWeekday', { date: info.key }, true);
    const status = row[2].trim();
    if (status !== STATUS_WORK && status !== STATUS_OFF) {
      return fail('invalid', 'unknownStatus', { date: info.key }, true);
    }
    if (seen.has(info.key)) return fail('invalid', 'duplicateDay', { date: info.key }, true);
    seen.add(info.key);
    const remark = row[3].replace(/\r\n?/g, '\n').trim(); // 跨行備註先統一成 LF，再驗證與儲存
    // 每一列的備註都先驗一次（含上班日與無名稱週末的備註），壞字元不會等到正規化後才被發現。
    if (remark !== '' && !isValidName(remark)) return fail('invalid', 'name', { date: info.key }, true);
    if (!byYear.has(year)) byYear.set(year, new Map());
    byYear.get(year).set(info.key, { status, remark });
  }
  if (byYear.size === 0) return fail('invalid', 'noYear', null, false);

  const tables = {};
  const years = [];
  for (const year of [...byYear.keys()].sort((a, b) => a - b)) {
    const built = buildYearTable(year, byYear.get(year), labels);
    if (!built.ok) return fail('invalid', built.code, built.params, true);
    const v = validateTwYear(year, built.value);
    if (!v.ok) return fail('invalid', v.code, v.params, true);
    tables[String(year)] = v.table;
    years.push(year);
  }
  return { ok: true, tables, years, labels };
}

// ---- 合併 ----

const STORE_SOURCES = Object.freeze(['file', 'online']);

// 內建優先；儲存的線上／匯入表逐筆驗證，壞的年份跳過（不連累其他年份），也不改動唯讀的內建表。
// 回傳 { 'YYYY': { off, makeup, source, fetchedAt? } }：與 calendar.js 讀的表同形。
export function mergeTwTables(builtin, stored) {
  const out = {};
  if (isPlainObject(stored)) {
    for (const [key, entry] of Object.entries(stored)) {
      if (!YEAR_KEY_RE.test(key) || !isPlainObject(entry)) continue;
      if (!STORE_SOURCES.includes(entry.source)) continue;
      const v = validateTwYear(Number(key), entry);
      if (!v.ok) continue;
      out[key] = {
        off: v.table.off,
        makeup: v.table.makeup,
        source: entry.source,
        ...(typeof entry.fetchedAt === 'number' && Number.isFinite(entry.fetchedAt) ? { fetchedAt: entry.fetchedAt } : {}),
      };
    }
  }
  if (isPlainObject(builtin)) {
    for (const [key, entry] of Object.entries(builtin)) {
      if (!YEAR_KEY_RE.test(key) || !isPlainObject(entry)) continue;
      if (!isPlainObject(entry.off) || !isPlainObject(entry.makeup)) continue;
      out[key] = { off: { ...entry.off }, makeup: { ...entry.makeup }, source: 'builtin' };
    }
  }
  return out;
}
