import { validateHolidayYear } from './holiday-data.js';

export const HOLIDAYS_STORAGE_KEY = 'work-motivator-v1-holidays';

const isPlainObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

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
      if (typeof entry.source !== 'string') continue;
      if (typeof entry.fetchedAt !== 'number' || !Number.isFinite(entry.fetchedAt)) continue;
      tables[year] = { off: v.table.off, makeup: v.table.makeup, source: 'online' };
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
