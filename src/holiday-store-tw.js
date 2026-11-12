// 臺灣（TW）假期表的儲存：獨立鍵 work-motivator-v1-holidays-TW，與大陸的 work-motivator-v1-holidays
// 完全隔離（各自的 years 與 lastCheck；絕不讀取、移動或覆寫大陸鍵）。本模組只管儲存 / 讀取 / 校驗，
// 不做下載、也不做流程編排（編排在 ui/holiday-update-tw.js，畫面在 holiday-panel）。
//
// 記錄（version 1，整份原子單鍵寫入）：
//   { version: 1, lastCheck: number|null, years: { '2026': entry } }
//   entry = {
//     table: { off: { 'YYYY-MM-DD': 名稱 }, makeup: { 'YYYY-MM-DD': 名稱 } },
//     papers: [<最終官方 CSV 網址>],                    // 線上檢查時用到的官方資源（匯入時為空）
//     source: 'file' | <最終校驗過的 https CSV 網址>,    // 'file' = 使用者匯入的官方 CSV；網址 = 線上發現並下載
//     fetchedAt: number,                                // 寫入時的毫秒時間戳
//     resourceUpdatedAt?: string,                       // 線上取得時：資料集資源的更新時間（原樣保留，供判斷是否有新版）
//   }
// 內部一律使用這個正規化表（與大陸表同形：off / makeup），載入時逐欄位重新校驗，任何一年的表不合格就整年丟棄
// （其他年份照常載入）；未知版本、無法解析或不是物件的記錄視為損壞：讀出空表 + corrupt:true，且寫入一律拒絕，
// 原始位元組保持不動，只有使用者明確要求時才用 resetTwStore() 重建。getItem 拋錯（storageOk:false）同樣拒絕寫入，
// 因為無法安全合併原記錄。
//
// 優先序（內建 > 匯入 > 線上）不在這裡執行：內建年份是靜態資料、從不進儲存；具體規則在編排層
// （holiday-update-tw.js 的 isProtected/rankOf）。本模組只如實儲存來源，讓編排層分得清匯入檔案與線上資料，
// 並且不提供自訂網址（TW 沒有這個功能，記錄裡也不會有 customUrl）。
//
// 所有失敗都返回穩定的程式碼，不返回已翻譯文字：'storage'（Web Storage 讀寫失敗）、'corrupt'（記錄損壞或版本未知）、
// 'invalid'（呼叫方給的年份 / 表 / 來源 / 時間不合格，detail 指出具體欄位）。文字由介面按當前地區字典轉。

export const TW_HOLIDAYS_STORAGE_KEY = 'work-motivator-v1-holidays-TW';
// 匯入的官方 CSV 在記錄裡的 source 標記（線上取得時記錄的是最終下載網址）。
// 與大陸 store 的 FILE_SOURCE 同名同值，方便編排層共用一套判斷。
export const FILE_SOURCE = 'file';
export const TW_FILE_SOURCE = FILE_SOURCE;

const VERSION = 1;
export const TW_STORE_VERSION = VERSION;
const YEAR_KEY = /^\d{4}$/;
const DATE_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;
// 節名 / 補班名按碼點計。臺灣官方最長節名 15 字（「臺灣光復暨金門古寧頭大捷紀念日」），
// 官方備註也可能很長，所以給到 200：只擋垃圾，不替官方規定長度（完整性與狀態 0/2 由 CSV 層檢查）。
const MAX_NAME = 200;
const MAX_PAPERS = 8;
const MAX_SOURCE = 2048;
const MAX_UPDATED = 64;
const MIN_YEAR = 1000;
const MAX_YEAR = 9999;

const isPlainObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const isMs = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;
// 可以安全合併的記錄：版本相符，而且 years 若存在必須是普通物件（陣列等結構不可信，視為損壞）。
const isTrustedRecord = (rec) => isPlainObject(rec) && rec.version === VERSION
  && (!has(rec, 'years') || isPlainObject(rec.years));

// 真實日期檢查（表用本機日期 key，這裡用 UTC 構造只為避開時區偏移）。
function isRealDate(y, m, d) {
  const dt = new Date(Date.UTC(2000, m - 1, d));
  dt.setUTCFullYear(y); // 避開 Date.UTC 對 0-99 年的 +1900 對映
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

// 只接受可解析、有主機、不含憑據、無空白的 https 網址（大小寫敏感，所以 http:// 與 HTTPS:// 都不算）。
// 不給方案加字面常量：用 startsWith('https:') + URL.protocol 判斷。
// 主機白名單不在這裡：官方網址的發現與每次 redirect 的最終網址校驗在 TW provider，本模組只保證
// 「存進來的不是 http、javascript:、相對路徑這類東西」；載入時再核一遍，被改成非法值的那一年就丟掉。
function isHttpsUrl(s) {
  if (typeof s !== 'string' || s.length === 0 || s.length > MAX_SOURCE) return false;
  // 必須寫成 scheme 加雙斜線（URL 會把 "https:/x" 補成 https://x/，那種不算我們存過的網址）。
  if (!s.startsWith('https:') || s.charAt(6) !== '/' || s.charAt(7) !== '/' || /\s/.test(s)) return false;
  try {
    const u = new URL(s);
    return u.protocol === 'https:' && u.hostname !== '' && u.username === '' && u.password === '';
  } catch {
    return false;
  }
}

const isKnownSource = (s) => s === FILE_SOURCE || isHttpsUrl(s);

// 正規化表校驗：整份通過才回傳，不做轉型、不挑揀單日。表與 provider 輸出同形（off / makeup）。
// 說明：不要求補班日必須是週末，也不要求 makeup 非空——115/116 年官方 CSV 本來就沒有補班日，
// 週末與狀態的語義由 provider 在 CSV 層負責；這裡只保證存入的是「這一年內、真實日期、不重複、有名稱的表」。
export function validateTwTable(year, table) {
  const bad = (code, date) => ({ ok: false, reason: date ? { code, date } : { code } });
  if (!Number.isInteger(year) || year < MIN_YEAR || year > MAX_YEAR) return bad('year');
  if (!isPlainObject(table)) return bad('table');
  if (!isPlainObject(table.off)) return bad('offShape');
  if (!isPlainObject(table.makeup)) return bad('makeupShape');
  const off = {};
  const makeup = {};
  const seen = new Set();
  const take = (map, isOff) => {
    for (const [date, name] of Object.entries(map)) {
      const m = DATE_KEY.exec(date);
      if (!m) return bad('dateKey', date);
      const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
      if (!isRealDate(y, mo, d)) return bad('dateNotReal', date);
      if (y !== year) return bad('dateOutOfYear', date);
      if (typeof name !== 'string' || name === '' || name.trim() !== name
        || [...name].length > MAX_NAME || /[\x00-\x09\x0B-\x1F\x7F]/.test(name)) {
        return bad('name', date);
      }
      if (seen.has(date)) return bad('duplicate', date); // 同一天不能既是放假又是補班
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

// 附屬來源資料（papers / resourceUpdatedAt）：壞了只丟這個欄位，不連累整年的表——表與 source /
// fetchedAt 才是要害，附屬資料只用於來源說明。strict 用於寫入：呼叫方是程式，塞垃圾就整份拒絕。
function metaOf(record, strict) {
  const out = { papers: [] };
  if (has(record, 'papers') && record.papers !== undefined) {
    const ps = record.papers;
    const ok = Array.isArray(ps) && ps.length <= MAX_PAPERS && ps.every(isHttpsUrl);
    if (!ok) {
      if (strict) return { ok: false, reason: { code: 'papers' } };
    } else out.papers = [...ps];
  }
  if (has(record, 'resourceUpdatedAt') && record.resourceUpdatedAt !== undefined) {
    const s = record.resourceUpdatedAt;
    const ok = typeof s === 'string' && s.length > 0 && s.length <= MAX_UPDATED && !/[\x00-\x1F\x7F]/.test(s);
    if (!ok) {
      if (strict) return { ok: false, reason: { code: 'resourceUpdatedAt' } };
    } else out.resourceUpdatedAt = s;
  }
  return { ok: true, meta: out };
}

// 讀記錄（只讀：不遷移、不寫回、不拋錯）。
function readRecord(storage) {
  let raw;
  try {
    raw = storage.getItem(TW_HOLIDAYS_STORAGE_KEY);
  } catch {
    return { record: null, storageOk: false, corrupt: false };
  }
  if (typeof raw !== 'string') return { record: null, storageOk: true, corrupt: false }; // 鍵不存在 = 空記錄
  let rec;
  try {
    rec = JSON.parse(raw);
  } catch {
    return { record: null, storageOk: true, corrupt: true };
  }
  if (!isTrustedRecord(rec)) return { record: null, storageOk: true, corrupt: true };
  return { record: rec, storageOk: true, corrupt: false };
}

// 合併寫入：保留其他年份與 lastCheck；記錄損壞或讀不到時拒絕，絕不覆蓋未知內容。
// 有效記錄裡讀不懂的年份以原樣搬回（不解析、不丟棄），只有本次寫入的年份被替換，整份一次 setItem。
function update(storage, mutate) {
  let raw;
  try {
    raw = storage.getItem(TW_HOLIDAYS_STORAGE_KEY);
  } catch {
    return { ok: false, reason: 'storage' };
  }
  let rec = null;
  if (typeof raw === 'string') {
    try {
      rec = JSON.parse(raw);
    } catch {
      return { ok: false, reason: 'corrupt' };
    }
    if (!isTrustedRecord(rec)) return { ok: false, reason: 'corrupt' };
  }
  const next = {
    version: VERSION,
    lastCheck: rec && isMs(rec.lastCheck) ? rec.lastCheck : null,
    years: rec && isPlainObject(rec.years) ? { ...rec.years } : {},
  };
  const stopped = mutate(next);
  if (stopped && stopped.ok === false) return stopped;
  let text;
  try {
    text = JSON.stringify(next);
  } catch {
    return { ok: false, reason: 'invalid' };
  }
  try {
    storage.setItem(TW_HOLIDAYS_STORAGE_KEY, text);
  } catch {
    return { ok: false, reason: 'storage' }; // 例如 quota：編排層保留本次會話的表
  }
  return { ok: true };
}

// 讀已存的臺灣年份表（逐欄位校驗；壞的一年丟掉不連累其他年）。
// tables[year] = { off, makeup, source: 'file'|'online' }：給計算、月曆、狀態卡用（與大陸表同形）。
// meta[year]   = { source（原始標記或最終網址）, origin, papers, fetchedAt, resourceUpdatedAt? }：給來源說明用。
export function loadTwTables(storage) {
  const tables = {};
  const meta = {};
  const { record, storageOk, corrupt } = readRecord(storage);
  if (record && isPlainObject(record.years)) {
    for (const key of Object.keys(record.years)) {
      if (!YEAR_KEY.test(key)) continue;
      const year = Number(key);
      const entry = record.years[key];
      if (!isPlainObject(entry)) continue;
      const v = validateTwTable(year, entry.table);
      if (!v.ok) continue;
      if (!isKnownSource(entry.source) || !isMs(entry.fetchedAt)) continue;
      const origin = entry.source === FILE_SOURCE ? 'file' : 'online';
      tables[year] = { off: v.table.off, makeup: v.table.makeup, source: origin };
      meta[year] = { source: entry.source, origin, fetchedAt: entry.fetchedAt, ...metaOf(entry, false).meta };
    }
  }
  return { tables, meta, storageOk, corrupt };
}

// 儲存一年。record：{ table, papers?, source, fetchedAt, resourceUpdatedAt? }。
// 回傳 { ok:true } | { ok:false, reason:'storage'|'corrupt'|'invalid', detail?:{code,date?} }，永不拋錯。
// 只替換這一年；其他年份、其他年份的附屬資料與 lastCheck 原樣保留。
export function saveTwYear(storage, year, record) {
  if (!isPlainObject(record)) return { ok: false, reason: 'invalid', detail: { code: 'record' } };
  const v = validateTwTable(year, record.table);
  if (!v.ok) return { ok: false, reason: 'invalid', detail: v.reason };
  if (!isKnownSource(record.source)) return { ok: false, reason: 'invalid', detail: { code: 'source' } };
  if (!isMs(record.fetchedAt)) return { ok: false, reason: 'invalid', detail: { code: 'fetchedAt' } };
  const m = metaOf(record, true);
  if (!m.ok) return { ok: false, reason: 'invalid', detail: m.reason };
  return update(storage, (next) => {
    next.years[String(year)] = {
      table: v.table,
      papers: m.meta.papers,
      source: record.source,
      fetchedAt: record.fetchedAt,
      ...(m.meta.resourceUpdatedAt === undefined ? {} : { resourceUpdatedAt: m.meta.resourceUpdatedAt }),
    };
  });
}

// lastCheck 只記臺灣自己的（與大陸鍵分開，不會因為同一年份互相影響）。
export function loadTwLastCheck(storage) {
  const { record } = readRecord(storage);
  return record && isMs(record.lastCheck) ? record.lastCheck : null;
}

// 記錄「本次嘗試檢查的時間」（成功或失敗都記，保證 24 小時內不重複自動檢查）。
export function saveTwLastCheck(storage, ms) {
  if (!isMs(ms)) return { ok: false, reason: 'invalid', detail: { code: 'lastCheck' } };
  return update(storage, (next) => {
    next.lastCheck = ms;
  });
}

// 優先序判斷（真正的執行在編排層，這裡只提供一致的規則）：
// 內建年份永不被覆蓋；已匯入的檔案不被線上資料覆蓋；線上資料可被線上或匯入替換。
// current 傳 tables[year]（可為 undefined）；incoming 傳 FILE_SOURCE（匯入）或線上 CSV 網址。
export function mayReplaceTw(current, incoming) {
  const cur = current?.source;
  if (cur === 'builtin') return false;
  if (cur === 'file' && incoming !== FILE_SOURCE) return false;
  return true;
}

// 記錄損壞 / 版本未知時，寫入一律被拒；只有使用者明確要求修復才呼叫這裡重建空記錄。
// 回傳 { ok:true } | { ok:false, reason:'storage' }。
export function resetTwStore(storage) {
  try {
    storage.setItem(TW_HOLIDAYS_STORAGE_KEY, JSON.stringify({ version: VERSION, years: {}, lastCheck: null }));
    return { ok: true };
  } catch {
    return { ok: false, reason: 'storage' };
  }
}
