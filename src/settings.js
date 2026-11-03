import { validateSchedule } from './calc.js';
import { STRINGS } from './strings.zh-CN.js';

const R = STRINGS.reasons;

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
const timeRule = (label) => (v) => (isTime(v) ? null : R.timeFormat(label));
const boolRule = (label) => (v) => (typeof v === 'boolean' ? null : R.switchValue(label));
const CFG_RULES = {
  salary: (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? null : R.salary),
  start: timeRule(R.labels.start),
  end: timeRule(R.labels.end),
  lunchStart: timeRule(R.labels.lunchStart),
  lunchEnd: timeRule(R.labels.lunchEnd),
  lunchOn: boolRule(R.labels.lunchOn),
  weekends: boolRule(R.labels.weekends),
  payday: (v) => (v === null || (Number.isInteger(v) && v >= 1 && v <= 31) ? null : R.payday),
  cheer: (v) => {
    if (typeof v !== 'string') return R.cheerType;
    return [...v].length > 40 ? R.cheerTooLong : null;
  },
};

function markKeyReason(key) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return R.markDate;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  const real = dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
  return real ? null : R.markNotReal;
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
        dropped.push({ field: 'marks', reason: R.marksType });
        continue;
      }
      for (const mk of Object.keys(v)) {
        const reason = markKeyReason(mk) ?? (MARKS.includes(v[mk]) ? null : R.markValue);
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
    return { error: R.notJson };
  }
  if (!isPlainObject(obj)) return { error: R.notObject };
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
    return { state: defaultState(), storageOk: false, dropped: [], corrupt: false };
  }
  if (typeof raw !== 'string') return { state: defaultState(), storageOk: true, dropped: [], corrupt: false };
  const p = parseObject(raw);
  if (p.error) return { state: defaultState(), storageOk: true, dropped: [], corrupt: true };
  const r = applyParsed(p.obj, defaultState());
  return { state: r.state, storageOk: true, dropped: r.dropped, corrupt: false };
}

export function saveState(storage, state) {
  try {
    storage.setItem(STORAGE_KEY, exportState(state));
    return { ok: true };
  } catch {
    return { ok: false };
  }
}
