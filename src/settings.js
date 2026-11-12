import { validateSchedule, reason } from './calc.js';

export const STORAGE_KEY = 'work-motivator-v1';
export const STATE_VERSION = 4;

// 地区 ID 是稳定契约（TW / CN）：语言、币种、假日 provider 都由 profile 决定，这里只存 ID。
export const REGIONS = Object.freeze(['TW', 'CN']);
export const DEFAULT_REGION = 'TW';

// 共享设置（不含月薪）：月薪按地区放在 salaries 里，避免同一份值存两处互相矛盾。
export const DEFAULTS = Object.freeze({
  start: '08:30', end: '17:00', lunchOn: false, lunchStart: '12:00', lunchEnd: '13:00',
  weekends: false, payday: null, cheers: Object.freeze(['']), showLunar: true, theme: 'rainbow',
  // 画面设置：全局字号作用于状态卡的讯息显示；五个开关决定卡片上「可见信息」的范围。
  // 默认值与旧版画面一致（中号、全部都显示），所以旧存档缺这些键时画面不会变。
  fontScale: 'm',
  showCardProgress: true, showCardMetrics: true, showCardDate: true,
  showCardPayday: true, showCardCheer: true,
});

// 字号档位：稳定 ID（存盘用）对应 CSS 的 px 级距由显示端决定，这里只负责取值白名单。
export const FONT_SCALES = Object.freeze(['xs', 's', 'm', 'l', 'xl']);

// 示例默认月薪（只对新用户套用一次，绝不改写已保存的值）：
// TW 40000 = 主计总处 2025 年工业及服务业「本国籍全时受雇员工」每月经常性薪资中位数 39,890 元向上取整到千元；
// CN 5000 = 第三方推估 2024 年全国雇员月薪中位数 5,000–5,150 元取区间下限。两者样本与时期不同，不作比较。
export const SALARY_DEFAULTS = Object.freeze({ TW: 40000, CN: 5000 });

const MARKS = ['work', 'rest', 'paidLeave', 'unpaidLeave'];
const TIME_FIELDS = ['start', 'end', 'lunchStart', 'lunchEnd'];
const isTime = (v) => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
const isPlainObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const salaryDefault = (region) => SALARY_DEFAULTS[region] ?? SALARY_DEFAULTS[DEFAULT_REGION];

// 每个 cfg 字段：返回 null 表示合格，否则返回 { code, params } 原因（不是译文，显示端才翻）。
// 严格校验，绝不转型。月薪单独按地区校验（salaryReason）。
// 时间 / 开关类原因的 params.field 是字典 labels 的键（与 cfg 字段名同名）。
const timeRule = (label) => (v) => (isTime(v) ? null : reason('timeFormat', { field: label }));
const boolRule = (label) => (v) => (typeof v === 'boolean' ? null : reason('switchValue', { field: label }));
const CFG_RULES = {
  start: timeRule('start'),
  end: timeRule('end'),
  lunchStart: timeRule('lunchStart'),
  lunchEnd: timeRule('lunchEnd'),
  lunchOn: boolRule('lunchOn'),
  weekends: boolRule('weekends'),
  showLunar: boolRule('showLunar'),
  fontScale: (v) => (FONT_SCALES.includes(v) ? null : reason('fontScale')),
  showCardProgress: boolRule('showCardProgress'),
  showCardMetrics: boolRule('showCardMetrics'),
  showCardDate: boolRule('showCardDate'),
  showCardPayday: boolRule('showCardPayday'),
  showCardCheer: boolRule('showCardCheer'),
  theme: (v) => (['green', 'blue', 'orange', 'teal', 'rose', 'slate', 'rainbow'].includes(v) ? null : reason('theme')),
  payday: (v) => (v === null || (Number.isInteger(v) && v >= 1 && v <= 31) ? null : reason('payday')),
  cheers: (v) => {
    if (!Array.isArray(v) || !v.length || v.some((item) => typeof item !== 'string')) return reason('cheerType');
    return v.some((item) => [...item].length > 40) ? reason('cheerTooLong') : null;
  },
};

const salaryReason = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? null : reason('salary'));
// 认不出的地区 ID 是对「地区的取值」不合法：结构本身没问题，别用「文件内容的结构不正确」硬套。
const regionReason = () => reason('region');

function markKeyReason(key) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return reason('markDate');
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  const real = dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
  return real ? null : reason('markNotReal');
}

// 给定地区的一套完整默认值（共享设置 + 该地区示例月薪）。cfg 仍是共享结构，salary 只在调用边界附加。
export function defaultsFor(region) {
  return { ...DEFAULTS, cheers: [...DEFAULTS.cheers], salary: salaryDefault(region) };
}

// 规范状态：{ region, cfg（共享设置，不含 salary）, salaries:{TW,CN}, marksByRegion:{TW,CN} }
export function defaultState() {
  return {
    region: DEFAULT_REGION,
    cfg: { ...DEFAULTS, cheers: [...DEFAULTS.cheers] },
    salaries: { ...SALARY_DEFAULTS },
    marksByRegion: { TW: {}, CN: {} },
  };
}

// 保守回退：储存读不到 / 内容损坏 / 未来版本时用 CN（沿用旧版行为），不覆写原始数据。
export function conservativeState() {
  return { ...defaultState(), region: 'CN' };
}

// 复制成规范形状：cfg 只留 DEFAULTS 的键（外部传进来的杂键、活动 salary 一律不复制），
// salaries / marksByRegion 只留两地；认不出的 region 落到 DEFAULT_REGION（调用方另有保守回退时以它为准）。
const cloneState = (state) => {
  const source = state ?? {};
  const shared = isPlainObject(source.cfg) ? source.cfg : {};
  const cfg = {};
  for (const key of Object.keys(DEFAULTS)) {
    cfg[key] = Object.prototype.hasOwnProperty.call(shared, key) ? shared[key] : DEFAULTS[key];
  }
  if (Array.isArray(cfg.cheers)) cfg.cheers = [...cfg.cheers];
  const salaries = { ...SALARY_DEFAULTS };
  // 与校验同一把尺：不合法的子项回到该地区示例默认，不带进后续计算。
  for (const rid of REGIONS) {
    const v = source.salaries?.[rid];
    if (!salaryReason(v)) salaries[rid] = v;
  }
  const marksByRegion = {};
  for (const rid of REGIONS) marksByRegion[rid] = isPlainObject(source.marksByRegion?.[rid]) ? { ...source.marksByRegion[rid] } : {};
  return { region: REGIONS.includes(source.region) ? source.region : DEFAULT_REGION, cfg, salaries, marksByRegion };
};

// v3 引入地区；v4 引入多句鼓励语。未知版本必须拒绝，避免旧版覆盖新数据。
const KNOWN_VERSIONS = [1, 2, 3, STATE_VERSION];
function fileVersion(obj) {
  if (!Object.prototype.hasOwnProperty.call(obj, 'version')) return 1;
  return KNOWN_VERSIONS.includes(obj.version) ? obj.version : null;
}

// 共用的验证核心：load 与 import 皆走此处。
// 合并规则：共享设置逐字段；salaries 按地区逐字段；marksByRegion 按地区逐日；未提供者保留现值。
// 两套键按备份版本分流，互不越界：
// - 旧备份（无版本 / 1 / 2）的 salary / marks 一律并入 CN，不切换当前地区；地区键属过时键，回报未知。
// - v3 的 region / salaries / marksByRegion 才生效；顶层 salary / marks 属过时键，回报未知，不并入任何地区。
function applyParsed(obj, current, version) {
  const isV3 = version >= 3;
  // cloneState 只认两地：current 的 region 认不出来时已是 DEFAULT_REGION，调用方要别的回退就传别的 base。
  const state = cloneState(current);
  const dropped = [];
  const unknown = [];
  const applied = [];
  const appliedTimes = [];
  let lunchOnApplied = false;

  const markApplied = (field) => {
    if (!applied.includes(field)) applied.push(field);
  };

  const mergeMarks = (src, regionId, prefix) => {
    for (const mk of Object.keys(src)) {
      const bad = markKeyReason(mk) ?? (MARKS.includes(src[mk]) ? null : reason('markValue'));
      if (bad) dropped.push({ field: `${prefix}.${mk}`, reason: bad });
      else {
        state.marksByRegion[regionId][mk] = src[mk];
        markApplied(`${prefix}.${mk}`);
      }
    }
  };

  for (const key of Object.keys(obj)) {
    const v = obj[key];
    if (key === 'version') continue;
    if (key === 'cheer') {
      // 旧版单句迁移；新格式优先，避免两者同时存在时依键顺序覆盖。
      if (!Object.prototype.hasOwnProperty.call(obj, 'cheers')) {
        const bad = CFG_RULES.cheers([v]);
        if (bad) dropped.push({ field: 'cheer', reason: bad });
        else { state.cfg.cheers = [v]; markApplied('cheers'); }
      }
      continue;
    }

    if (key === 'region' || key === 'salaries' || key === 'marksByRegion') {
      if (!isV3) {
        unknown.push(key);
        continue;
      }
    } else if ((key === 'salary' || key === 'marks') && isV3) {
      unknown.push(key);
      continue;
    }

    if (key === 'region') {
      if (REGIONS.includes(v)) {
        state.region = v;
        markApplied('region');
      } else {
        dropped.push({ field: 'region', reason: regionReason() });
      }
      continue;
    }

    if (key === 'salaries') {
      if (!isPlainObject(v)) {
        // 整块不是对象：别拿「月薪必须是大于 0 的数字」这种具体规则去描述类型错误。
        dropped.push({ field: 'salaries', reason: reason('salariesType') });
        continue;
      }
      for (const rid of Object.keys(v)) {
        if (!REGIONS.includes(rid)) {
          dropped.push({ field: `salaries.${rid}`, reason: regionReason() });
          continue;
        }
        const bad = salaryReason(v[rid]);
        if (bad) dropped.push({ field: `salaries.${rid}`, reason: bad });
        else {
          state.salaries[rid] = v[rid];
          markApplied(`salaries.${rid}`);
        }
      }
      continue;
    }

    if (key === 'marksByRegion') {
      if (!isPlainObject(v)) {
        dropped.push({ field: 'marksByRegion', reason: reason('marksType') });
        continue;
      }
      for (const rid of Object.keys(v)) {
        if (!REGIONS.includes(rid)) {
          dropped.push({ field: `marksByRegion.${rid}`, reason: regionReason() });
          continue;
        }
        if (!isPlainObject(v[rid])) {
          dropped.push({ field: `marksByRegion.${rid}`, reason: reason('marksType') });
          continue;
        }
        mergeMarks(v[rid], rid, `marksByRegion.${rid}`);
      }
      continue;
    }

    // 旧版备份（无地区概念）：月薪与标记一律并入 CN，当前地区不变。
    if (key === 'salary') {
      const bad = salaryReason(v);
      if (bad) dropped.push({ field: 'salaries.CN', reason: bad });
      else {
        state.salaries.CN = v;
        markApplied('salaries.CN');
      }
      continue;
    }

    if (key === 'marks') {
      if (!isPlainObject(v)) {
        dropped.push({ field: 'marksByRegion.CN', reason: reason('marksType') });
        continue;
      }
      mergeMarks(v, 'CN', 'marksByRegion.CN');
      continue;
    }

    if (Object.prototype.hasOwnProperty.call(CFG_RULES, key)) {
      const bad = CFG_RULES[key](v);
      if (bad) {
        dropped.push({ field: key, reason: bad });
      } else {
        state.cfg[key] = v;
        markApplied(key);
        if (TIME_FIELDS.includes(key)) appliedTimes.push(key);
        if (key === 'lunchOn') lunchOnApplied = true;
      }
      continue;
    }

    unknown.push(key);
  }

  // R7 跨字段：单独合格但合起来不成立的时间字段一并丢弃，保留现值。
  // 月薪缺陷已在 salaries.* 上报，这里的探针只用来让跨字段检查跑完。
  const activeSalary = state.salaries[state.region];
  const probeSalary = salaryReason(activeSalary) ? 1 : activeSalary;
  const checkWith = () => validateSchedule({ ...state.cfg, salary: probeSalary });
  // validateSchedule 只回传 { code, params }：把原因整理成 dropped 的语义形状，不在这里翻成文字。
  const causeOf = (check) => reason(check.code, check.params);
  const revertTime = (f, check) => {
    state.cfg[f] = current.cfg?.[f] ?? DEFAULTS[f];
    const i = applied.indexOf(f);
    if (i >= 0) applied.splice(i, 1);
    const j = appliedTimes.indexOf(f);
    if (j >= 0) appliedTimes.splice(j, 1);
    dropped.push({ field: f, reason: causeOf(check) });
  };
  let check = checkWith();
  // 先只退被点名的那个字段（它确实来自备份时），尽量保住同一份备份里其他合格的值。
  while (!check.ok && appliedTimes.length) {
    const lone = appliedTimes.length === 1 ? appliedTimes[0] : appliedTimes.includes(check.field) ? check.field : null;
    if (!lone) break; // 冲突指向存档里原有的值：整组候选时间一起退回去
    revertTime(lone, check);
    check = checkWith();
  }
  if (!check.ok) {
    for (const f of [...appliedTimes]) revertTime(f, check);
    check = checkWith();
  }
  if (!check.ok && lunchOnApplied) {
    state.cfg.lunchOn = current.cfg?.lunchOn ?? DEFAULTS.lunchOn;
    const i = applied.indexOf('lunchOn');
    if (i >= 0) applied.splice(i, 1);
    dropped.push({ field: 'lunchOn', reason: causeOf(check) });
  }

  return { state, applied, dropped, unknown };
}

function parseObject(text) {
  let obj;
  try {
    obj = JSON.parse(text);
  } catch {
    return { error: reason('notJson') };
  }
  if (!isPlainObject(obj)) return { error: reason('notObject') };
  return { obj };
}

export function exportState(state) {
  const source = state ?? {};
  const { salary: _ignored, ...shared } = source.cfg ?? {};
  const out = {
    version: STATE_VERSION,
    region: REGIONS.includes(source.region) ? source.region : DEFAULT_REGION,
  };
  for (const key of Object.keys(DEFAULTS)) {
    // 与载入/汇入同一套校验：坏值写成默认，备份一定读得回来。
    const v = Object.prototype.hasOwnProperty.call(shared, key) ? shared[key] : DEFAULTS[key];
    out[key] = CFG_RULES[key](v) ? DEFAULTS[key] : v;
  }
  out.salaries = {};
  out.marksByRegion = {};
  for (const rid of REGIONS) {
    // 与载入/汇入同一套校验：不合法的月薪写成该地区示例默认，避免产出自己读不回来的备份。
    const salary = source.salaries?.[rid];
    out.salaries[rid] = salaryReason(salary) ? salaryDefault(rid) : salary;
    const marks = source.marksByRegion?.[rid];
    out.marksByRegion[rid] = {};
    if (isPlainObject(marks)) {
      for (const mk of Object.keys(marks)) {
        if (!markKeyReason(mk) && MARKS.includes(marks[mk])) out.marksByRegion[rid][mk] = marks[mk];
      }
    }
  }
  // 跨字段（R7）也要立得住：备份读回来才不会被判成部分无效。
  // 逐级让步，尽量保住用户实际填过的值：先关午休，再把午休时间退回默认。上下班时间不动（它们决定工时本身）。
  const valid = () => validateSchedule({ ...out, salary: out.salaries[out.region] }).ok;
  if (!valid() && out.lunchOn) out.lunchOn = DEFAULTS.lunchOn;
  if (!valid()) {
    out.lunchStart = DEFAULTS.lunchStart;
    out.lunchEnd = DEFAULTS.lunchEnd;
  }
  // 仍不成立（例如存档里的上下班时间本身倒挂）：整组时段退回默认，保证产物可以被自己读回。
  if (!valid()) {
    for (const key of [...TIME_FIELDS, 'lunchOn']) out[key] = DEFAULTS[key];
  }
  return JSON.stringify(out, null, 2);
}

export function importState(text, current) {
  const p = parseObject(text);
  if (p.error) return { error: p.error };
  const version = fileVersion(p.obj);
  // 认不出版本（含未来版本）的备份整份拒绝：不能当成旧版误读。
  if (version === null) return { error: reason('futureVersion') };
  const base = cloneState(current ?? defaultState());
  return applyParsed(p.obj, base, version);
}

// 读取只做校验与合并，绝不写回：迁移结果等下一次用户正常保存才落盘。
export function loadState(storage) {
  let raw;
  try {
    raw = storage.getItem(STORAGE_KEY);
  } catch {
    return { state: conservativeState(), storageOk: false, dropped: [], corrupt: false };
  }
  // 键不存在（Web Storage 回 null）且读取成功：只有这种情况才算新用户，套用 TW 默认值。
  // 其他非字串回传代表储存实作异常，按损坏读取，不当成全新用户。
  if (raw === null) return { state: defaultState(), storageOk: true, dropped: [], corrupt: false };
  if (typeof raw !== 'string') return { state: conservativeState(), storageOk: false, dropped: [], corrupt: true };
  const p = parseObject(raw);
  if (p.error) return { state: conservativeState(), storageOk: true, dropped: [], corrupt: true };
  const version = fileVersion(p.obj);
  if (version === null) return { state: conservativeState(), storageOk: true, dropped: [], corrupt: true };
  // 旧版（无版本 / 1 / 2）按 CN 保守回退读取，不覆写原始数据。
  // 已有存档若没有主题字段，维持旧默认绿；明确保存的主题照常载入。
  const base = conservativeState();
  base.cfg.theme = 'green';
  const r = applyParsed(p.obj, base, version);
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
