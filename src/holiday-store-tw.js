// 台湾（TW）假期表的储存：独立键 work-motivator-v1-holidays-TW，与大陆的 work-motivator-v1-holidays
// 完全隔离（各自的 years 与 lastCheck；绝不读取、移动或覆写大陆键）。本模块只管保存 / 读取 / 校验，
// 不做下载、也不做流程编排（编排在 ui/holiday-update-tw.js，画面在 holiday-panel）。
//
// 记录（version 1，整份原子单键写入）：
//   { version: 1, lastCheck: number|null, years: { '2026': entry } }
//   entry = {
//     table: { off: { 'YYYY-MM-DD': 名称 }, makeup: { 'YYYY-MM-DD': 名称 } },
//     papers: [<最终官方 CSV 网址>],                    // 线上检查时用到的官方资源（导入时为空）
//     source: 'file' | <最终校验过的 https CSV 网址>,    // 'file' = 用户导入的官方 CSV；网址 = 线上发现并下载
//     fetchedAt: number,                                // 写入时的毫秒时间戳
//     resourceUpdatedAt?: string,                       // 线上取得时：资料集资源的更新时间（原样保留，供判断是否有新版）
//   }
// 内部一律使用这个正规化表（与大陆表同形：off / makeup），载入时逐字段重新校验，任何一年的表不合格就整年丢弃
// （其他年份照常载入）；未知版本、无法解析或不是对象的记录视为损坏：读出空表 + corrupt:true，且写入一律拒绝，
// 原始字节保持不动，只有用户明确要求时才用 resetTwStore() 重建。getItem 抛错（storageOk:false）同样拒绝写入，
// 因为无法安全合并原记录。
//
// 优先序（内置 > 导入 > 线上）不在这里执行：内置年份是静态资料、从不进储存；具体规则在编排层
// （holiday-update-tw.js 的 isProtected/rankOf）。本模块只如实保存来源，让编排层分得清导入文件与线上数据，
// 并且不提供自订网址（TW 没有这个功能，记录里也不会有 customUrl）。
//
// 所有失败都返回稳定的代码，不返回已翻译文字：'storage'（Web Storage 读写失败）、'corrupt'（记录损坏或版本未知）、
// 'invalid'（调用方给的年份 / 表 / 来源 / 时间不合格，detail 指出具体字段）。文字由界面按当前地区字典转。

export const TW_HOLIDAYS_STORAGE_KEY = 'work-motivator-v1-holidays-TW';
// 导入的官方 CSV 在记录里的 source 标记（线上取得时记录的是最终下载网址）。
// 与大陆 store 的 FILE_SOURCE 同名同值，方便编排层共用一套判断。
export const FILE_SOURCE = 'file';
export const TW_FILE_SOURCE = FILE_SOURCE;

const VERSION = 1;
export const TW_STORE_VERSION = VERSION;
const YEAR_KEY = /^\d{4}$/;
const DATE_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;
// 节名 / 补班名按码点计。台湾官方最长节名 15 字（「台湾光复暨金门古宁头大捷纪念日」），
// 官方备注也可能很长，所以给到 200：只挡垃圾，不替官方规定长度（完整性与状态 0/2 由 CSV 层检查）。
const MAX_NAME = 200;
const MAX_PAPERS = 8;
const MAX_SOURCE = 2048;
const MAX_UPDATED = 64;
const MIN_YEAR = 1000;
const MAX_YEAR = 9999;

const isPlainObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const isMs = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;
// 可以安全合并的记录：版本相符，而且 years 若存在必须是普通对象（数组等结构不可信，视为损坏）。
const isTrustedRecord = (rec) => isPlainObject(rec) && rec.version === VERSION
  && (!has(rec, 'years') || isPlainObject(rec.years));

// 真实日期检查（表用本机日期 key，这里用 UTC 构造只为避开时区偏移）。
function isRealDate(y, m, d) {
  const dt = new Date(Date.UTC(2000, m - 1, d));
  dt.setUTCFullYear(y); // 避开 Date.UTC 对 0-99 年的 +1900 映射
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

// 只接受可解析、有主机、不含凭据、无空白的 https 网址（大小写敏感，所以 http:// 与 HTTPS:// 都不算）。
// 不给方案加字面常量：用 startsWith('https:') + URL.protocol 判断。
// 主机白名单不在这里：官方网址的发现与每次 redirect 的最终网址校验在 TW provider，本模块只保证
// 「存进来的不是 http、javascript:、相对路径这类东西」；载入时再核一遍，被改成非法值的那一年就丢掉。
function isHttpsUrl(s) {
  if (typeof s !== 'string' || s.length === 0 || s.length > MAX_SOURCE) return false;
  // 必须写成 scheme 加双斜线（URL 会把 "https:/x" 补成 https://x/，那种不算我们存过的网址）。
  if (!s.startsWith('https:') || s.charAt(6) !== '/' || s.charAt(7) !== '/' || /\s/.test(s)) return false;
  try {
    const u = new URL(s);
    return u.protocol === 'https:' && u.hostname !== '' && u.username === '' && u.password === '';
  } catch {
    return false;
  }
}

const isKnownSource = (s) => s === FILE_SOURCE || isHttpsUrl(s);

// 正规化表校验：整份通过才回传，不做转型、不挑拣单日。表与 provider 输出同形（off / makeup）。
// 说明：不要求补班日必须是周末，也不要求 makeup 非空——115/116 年官方 CSV 本来就没有补班日，
// 周末与状态的语义由 provider 在 CSV 层负责；这里只保证存入的是「这一年内、真实日期、不重复、有名称的表」。
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
      if (seen.has(date)) return bad('duplicate', date); // 同一天不能既是放假又是补班
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

// 附属来源资料（papers / resourceUpdatedAt）：坏了只丢这个字段，不连累整年的表——表与 source /
// fetchedAt 才是要害，附属资料只用于来源说明。strict 用于写入：调用方是程序，塞垃圾就整份拒绝。
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

// 读记录（只读：不迁移、不写回、不抛错）。
function readRecord(storage) {
  let raw;
  try {
    raw = storage.getItem(TW_HOLIDAYS_STORAGE_KEY);
  } catch {
    return { record: null, storageOk: false, corrupt: false };
  }
  if (typeof raw !== 'string') return { record: null, storageOk: true, corrupt: false }; // 键不存在 = 空记录
  let rec;
  try {
    rec = JSON.parse(raw);
  } catch {
    return { record: null, storageOk: true, corrupt: true };
  }
  if (!isTrustedRecord(rec)) return { record: null, storageOk: true, corrupt: true };
  return { record: rec, storageOk: true, corrupt: false };
}

// 合并写入：保留其他年份与 lastCheck；记录损坏或读不到时拒绝，绝不覆盖未知内容。
// 有效记录里读不懂的年份以原样搬回（不解析、不丢弃），只有本次写入的年份被替换，整份一次 setItem。
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
    return { ok: false, reason: 'storage' }; // 例如 quota：编排层保留本次会话的表
  }
  return { ok: true };
}

// 读已存的台湾年份表（逐字段校验；坏的一年丢掉不连累其他年）。
// tables[year] = { off, makeup, source: 'file'|'online' }：给计算、月历、状态卡用（与大陆表同形）。
// meta[year]   = { source（原始标记或最终网址）, origin, papers, fetchedAt, resourceUpdatedAt? }：给来源说明用。
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

// 保存一年。record：{ table, papers?, source, fetchedAt, resourceUpdatedAt? }。
// 回传 { ok:true } | { ok:false, reason:'storage'|'corrupt'|'invalid', detail?:{code,date?} }，永不抛错。
// 只替换这一年；其他年份、其他年份的附属资料与 lastCheck 原样保留。
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

// lastCheck 只记台湾自己的（与大陆键分开，不会因为同一年份互相影响）。
export function loadTwLastCheck(storage) {
  const { record } = readRecord(storage);
  return record && isMs(record.lastCheck) ? record.lastCheck : null;
}

// 记录「本次尝试检查的时间」（成功或失败都记，保证 24 小时内不重复自动检查）。
export function saveTwLastCheck(storage, ms) {
  if (!isMs(ms)) return { ok: false, reason: 'invalid', detail: { code: 'lastCheck' } };
  return update(storage, (next) => {
    next.lastCheck = ms;
  });
}

// 优先序判断（真正的执行在编排层，这里只提供一致的规则）：
// 内置年份永不被覆盖；已导入的文件不被线上数据覆盖；线上数据可被线上或导入替换。
// current 传 tables[year]（可为 undefined）；incoming 传 FILE_SOURCE（导入）或线上 CSV 网址。
export function mayReplaceTw(current, incoming) {
  const cur = current?.source;
  if (cur === 'builtin') return false;
  if (cur === 'file' && incoming !== FILE_SOURCE) return false;
  return true;
}

// 记录损坏 / 版本未知时，写入一律被拒；只有用户明确要求修复才调用这里重建空记录。
// 回传 { ok:true } | { ok:false, reason:'storage' }。
export function resetTwStore(storage) {
  try {
    storage.setItem(TW_HOLIDAYS_STORAGE_KEY, JSON.stringify({ version: VERSION, years: {}, lastCheck: null }));
    return { ok: true };
  } catch {
    return { ok: false, reason: 'storage' };
  }
}
