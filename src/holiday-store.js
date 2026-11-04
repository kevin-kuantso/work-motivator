import { validateHolidayYear, validateCustomUrl } from './holiday-data.js';

export const HOLIDAYS_STORAGE_KEY = 'work-motivator-v1-holidays';
// 导入的假期表文件在记录里的 source 标记（联网获取的记录的是实际网址）
export const FILE_SOURCE = 'file';

const isPlainObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const DOWNLOAD_PREFIX = /^https:\/\/[^/\s]/;
const isKnownSource = (s) => s === FILE_SOURCE || (typeof s === 'string' && DOWNLOAD_PREFIX.test(s));

function readRecord(storage) {
  let raw;
  try {
    raw = storage.getItem(HOLIDAYS_STORAGE_KEY);
  } catch {
    return { record: null, storageOk: false };
  }
  if (typeof raw !== 'string') return { record: null, storageOk: true };
  try {
    const rec = JSON.parse(raw);
    if (isPlainObject(rec) && rec.version === 1) return { record: rec, storageOk: true };
  } catch { /* 视为空记录 */ }
  return { record: null, storageOk: true };
}

// 把已存的表还原成 holiday-cn 的形状，再走与联网下载完全相同的校验。
function toHolidayJson(year, entry) {
  if (!isPlainObject(entry) || !isPlainObject(entry.table)) return null;
  const { off, makeup } = entry.table;
  if (!isPlainObject(off) || !isPlainObject(makeup)) return null;
  const days = [];
  for (const [date, name] of Object.entries(off)) days.push({ name, date, isOffDay: true });
  for (const [date, name] of Object.entries(makeup)) days.push({ name, date, isOffDay: false });
  return { year, papers: entry.papers, days };
}

export function loadOnlineTables(storage) {
  const tables = {};
  const meta = {};
  const { record, storageOk } = readRecord(storage);
  if (record && isPlainObject(record.years)) {
    for (const key of Object.keys(record.years)) {
      if (!/^\d{4}$/.test(key)) continue;
      const year = Number(key);
      const entry = record.years[key];
      const json = toHolidayJson(year, entry);
      if (!json) continue;
      const v = validateHolidayYear(json, year);
      if (!v.ok) continue;
      // source 只接受导入文件标记 'file' 或以 https:// 开头的下载网址（区分大小写）；其他值丢弃该年，绝不默认为联网
      if (!isKnownSource(entry.source)) continue;
      if (typeof entry.fetchedAt !== 'number' || !Number.isFinite(entry.fetchedAt)) continue;
      // R30：导入的文件记为 'file'（不声称来源），其余（记录的是下载网址）为 'online'
      tables[year] = { off: v.table.off, makeup: v.table.makeup, source: entry.source === FILE_SOURCE ? 'file' : 'online' };
      meta[year] = { source: entry.source, papers: v.papers, fetchedAt: entry.fetchedAt };
    }
  }
  return { tables, meta, storageOk };
}

function update(storage, mutate) {
  try {
    const { record } = readRecord(storage);
    const next = {
      version: 1,
      years: record && isPlainObject(record.years) ? { ...record.years } : {},
      lastCheck: record && typeof record.lastCheck === 'number' ? record.lastCheck : null,
    };
    // 新增字段（自定义网址）在其他写入时保留；读取时另行校验
    if (record && typeof record.customUrl === 'string') next.customUrl = record.customUrl;
    mutate(next);
    storage.setItem(HOLIDAYS_STORAGE_KEY, JSON.stringify(next));
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

export function saveOnlineYear(storage, year, record) {
  return update(storage, (next) => {
    next.years[String(year)] = {
      table: { off: record.table.off, makeup: record.table.makeup },
      papers: record.papers,
      source: record.source,
      fetchedAt: record.fetchedAt,
    };
  });
}

export function loadLastCheck(storage) {
  const { record } = readRecord(storage);
  const v = record && record.lastCheck;
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
}

export function saveLastCheck(storage, ms) {
  return update(storage, (next) => { next.lastCheck = ms; });
}

// 「自定义网址」存在假期数据记录里（不进设置备份文件）；读取时重新校验，不合格视为未设置。
export function loadCustomUrl(storage) {
  const { record } = readRecord(storage);
  const v = record && record.customUrl;
  return typeof v === 'string' && validateCustomUrl(v).ok ? v : null;
}

export function saveCustomUrl(storage, url) {
  return update(storage, (next) => {
    if (url === null) delete next.customUrl;
    else next.customUrl = url;
  });
}
