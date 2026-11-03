import { validateSchedule } from './calc.js';

export const STORAGE_KEY = 'work-motivator-v1';

export const DEFAULTS = Object.freeze({
  salary: 6800, start: '08:30', end: '17:00', lunchOn: true,
  lunchStart: '11:30', lunchEnd: '13:00', weekends: false, payday: null, cheer: '',
});

const MARKS = ['work', 'rest', 'paidLeave', 'unpaidLeave'];
const TIME_FIELDS = ['start', 'end', 'lunchStart', 'lunchEnd'];
const isTime = (v) => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
const isPlainObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

// 每个 cfg 字段：返回 null 表示合格，否则返回原因。严格校验，绝不转型。
const timeRule = (label) => (v) => (isTime(v) ? null : `${label}必须是 24 小时制 HH:MM（00:00–23:59）`);
const boolRule = (label) => (v) => (typeof v === 'boolean' ? null : `${label}必须是 true 或 false`);
const CFG_RULES = {
  salary: (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? null : '月薪必须是大于 0 的有限数字'),
  start: timeRule('上班时间'),
  end: timeRule('下班时间'),
  lunchStart: timeRule('午休开始时间'),
  lunchEnd: timeRule('午休结束时间'),
  lunchOn: boolRule('午休开关'),
  weekends: boolRule('周末开关'),
  payday: (v) => (v === null || (Number.isInteger(v) && v >= 1 && v <= 31) ? null : '发薪日必须是 1–31 的整数或 null'),
  cheer: (v) => {
    if (typeof v !== 'string') return '鼓励语必须是字串';
    return [...v].length > 40 ? '鼓励语不能超过 40 个字' : null;
  },
};

function markKeyReason(key) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return '日期格式应为 YYYY-MM-DD';
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  const real = dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
  return real ? null : '不是真实存在的日期';
}

// 共用的验证核心：load 与 import 皆走此处。
function applyParsed(obj, current) {
  const cfg = { ...current.cfg };
  const marks = { ...current.marks };
  const dropped = [];
  const unknown = [];
  const appliedTimes = [];
  let lunchOnApplied = false;

  for (const key of Object.keys(obj)) {
    const v = obj[key];
    if (key === 'version') continue;
    if (key === 'marks') {
      if (!isPlainObject(v)) {
        dropped.push({ field: 'marks', reason: 'marks 必须是物件' });
        continue;
      }
      for (const mk of Object.keys(v)) {
        const reason = markKeyReason(mk) ?? (MARKS.includes(v[mk]) ? null : `标记必须是 ${MARKS.join('/')} 之一`);
        if (reason) dropped.push({ field: `marks.${mk}`, reason });
        else marks[mk] = v[mk];
      }
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(CFG_RULES, key)) {
      const reason = CFG_RULES[key](v);
      if (reason) {
        dropped.push({ field: key, reason });
      } else {
        cfg[key] = v;
        if (TIME_FIELDS.includes(key)) appliedTimes.push(key);
        if (key === 'lunchOn') lunchOnApplied = true;
      }
      continue;
    }
    unknown.push(key);
  }

  // R7 跨字段：单独合格但合起来不成立的时间字段一并丢弃，保留现值。
  let check = validateSchedule(cfg);
  if (!check.ok && appliedTimes.length) {
    for (const f of appliedTimes) {
      cfg[f] = current.cfg[f];
      dropped.push({ field: f, reason: check.reason });
    }
    check = validateSchedule(cfg);
  }
  if (!check.ok && lunchOnApplied) {
    cfg.lunchOn = current.cfg.lunchOn;
    dropped.push({ field: 'lunchOn', reason: check.reason });
  }
  return { state: { cfg, marks }, dropped, unknown };
}

function parseObject(text) {
  let obj;
  try {
    obj = JSON.parse(text);
  } catch {
    return { error: '不是有效的 JSON 文字' };
  }
  if (!isPlainObject(obj)) return { error: '内容必须是 JSON 物件' };
  return { obj };
}

const defaultState = () => ({ cfg: { ...DEFAULTS }, marks: {} });

export function exportState(state) {
  return JSON.stringify({ version: 1, ...state.cfg, marks: state.marks }, null, 2);
}

export function importState(text, current) {
  const p = parseObject(text);
  if (p.error) return { error: p.error };
  return applyParsed(p.obj, current);
}

export function loadState(storage) {
  let raw;
  try {
    raw = storage.getItem(STORAGE_KEY);
  } catch {
    return { state: defaultState(), storageOk: false };
  }
  if (typeof raw !== 'string') return { state: defaultState(), storageOk: true };
  const p = parseObject(raw);
  if (p.error) return { state: defaultState(), storageOk: true };
  return { state: applyParsed(p.obj, defaultState()).state, storageOk: true };
}

export function saveState(storage, state) {
  try {
    storage.setItem(STORAGE_KEY, exportState(state));
    return { ok: true };
  } catch {
    return { ok: false };
  }
}
