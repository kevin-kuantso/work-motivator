import { validateSchedule, reason } from './calc.js';

export const STORAGE_KEY = 'work-motivator-v1';
export const STATE_VERSION = 4;

// 地區 ID 是穩定契約（TW / CN）：語言、幣種、假日 provider 都由 profile 決定，這裡只存 ID。
export const REGIONS = Object.freeze(['TW', 'CN']);
export const DEFAULT_REGION = 'TW';

// 共享設定（不含月薪）：月薪按地區放在 salaries 裡，避免同一份值存兩處互相矛盾。
export const DEFAULTS = Object.freeze({
  start: '08:30', end: '17:00', lunchOn: false, lunchStart: '12:00', lunchEnd: '13:00',
  weekends: false, payday: null, cheers: Object.freeze(['']), showLunar: true, theme: 'rainbow',
  // 畫面設定：全域性字號作用於狀態卡的訊息顯示；五個開關決定卡片上「可見資訊」的範圍。
  // 預設值與舊版畫面一致（中號、全部都顯示），所以舊存檔缺這些鍵時畫面不會變。
  fontScale: 'm',
  showCardProgress: true, showCardMetrics: true, showCardDate: true,
  showCardPayday: true, showCardCheer: true,
});

// 字號檔位：穩定 ID（存檔用）對應 CSS 的 px 級距由顯示端決定，這裡只負責取值白名單。
export const FONT_SCALES = Object.freeze(['xs', 's', 'm', 'l', 'xl']);

// 示例預設月薪（只對新使用者套用一次，絕不改寫已儲存的值）：
// TW 40000 = 主計總處 2025 年工業及服務業「本國籍全時受僱員工」每月經常性薪資中位數 39,890 元向上取整到千元；
// CN 5000 = 第三方推估 2024 年全國僱員月薪中位數 5,000–5,150 元取區間下限。兩者樣本與時期不同，不作比較。
export const SALARY_DEFAULTS = Object.freeze({ TW: 40000, CN: 5000 });

const MARKS = ['work', 'rest', 'paidLeave', 'unpaidLeave'];
const TIME_FIELDS = ['start', 'end', 'lunchStart', 'lunchEnd'];
const isTime = (v) => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
const isPlainObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const salaryDefault = (region) => SALARY_DEFAULTS[region] ?? SALARY_DEFAULTS[DEFAULT_REGION];

// 每個 cfg 欄位：返回 null 表示合格，否則返回 { code, params } 原因（不是譯文，顯示端才翻）。
// 嚴格校驗，絕不轉型。月薪單獨按地區校驗（salaryReason）。
// 時間 / 開關類原因的 params.field 是字典 labels 的鍵（與 cfg 欄位名同名）。
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
// 認不出的地區 ID 是對「地區的取值」不合法：結構本身沒問題，別用「檔案內容的結構不正確」硬套。
const regionReason = () => reason('region');

function markKeyReason(key) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return reason('markDate');
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  const real = dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
  return real ? null : reason('markNotReal');
}

// 給定地區的一套完整預設值（共享設定 + 該地區示例月薪）。cfg 仍是共享結構，salary 只在呼叫邊界附加。
export function defaultsFor(region) {
  return { ...DEFAULTS, cheers: [...DEFAULTS.cheers], salary: salaryDefault(region) };
}

// 規範狀態：{ region, cfg（共享設定，不含 salary）, salaries:{TW,CN}, marksByRegion:{TW,CN} }
export function defaultState() {
  return {
    region: DEFAULT_REGION,
    cfg: { ...DEFAULTS, cheers: [...DEFAULTS.cheers] },
    salaries: { ...SALARY_DEFAULTS },
    marksByRegion: { TW: {}, CN: {} },
  };
}

// 保守回退：儲存讀不到 / 內容損壞 / 未來版本時用 CN（沿用舊版行為），不覆寫原始資料。
export function conservativeState() {
  return { ...defaultState(), region: 'CN' };
}

// 複製成規範形狀：cfg 只留 DEFAULTS 的鍵（外部傳進來的雜鍵、活動 salary 一律不復制），
// salaries / marksByRegion 只留兩地；認不出的 region 落到 DEFAULT_REGION（呼叫方另有保守回退時以它為準）。
const cloneState = (state) => {
  const source = state ?? {};
  const shared = isPlainObject(source.cfg) ? source.cfg : {};
  const cfg = {};
  for (const key of Object.keys(DEFAULTS)) {
    cfg[key] = Object.prototype.hasOwnProperty.call(shared, key) ? shared[key] : DEFAULTS[key];
  }
  if (Array.isArray(cfg.cheers)) cfg.cheers = [...cfg.cheers];
  const salaries = { ...SALARY_DEFAULTS };
  // 與校驗同一把尺：不合法的子項回到該地區示例預設，不帶進後續計算。
  for (const rid of REGIONS) {
    const v = source.salaries?.[rid];
    if (!salaryReason(v)) salaries[rid] = v;
  }
  const marksByRegion = {};
  for (const rid of REGIONS) marksByRegion[rid] = isPlainObject(source.marksByRegion?.[rid]) ? { ...source.marksByRegion[rid] } : {};
  return { region: REGIONS.includes(source.region) ? source.region : DEFAULT_REGION, cfg, salaries, marksByRegion };
};

// v3 引入地區；v4 引入多句鼓勵語。未知版本必須拒絕，避免舊版覆蓋新資料。
const KNOWN_VERSIONS = [1, 2, 3, STATE_VERSION];
function fileVersion(obj) {
  if (!Object.prototype.hasOwnProperty.call(obj, 'version')) return 1;
  return KNOWN_VERSIONS.includes(obj.version) ? obj.version : null;
}

// 共用的驗證核心：load 與 import 皆走此處。
// 合併規則：共享設定逐欄位；salaries 按地區逐欄位；marksByRegion 按地區逐日；未提供者保留現值。
// 兩套鍵按備份版本分流，互不越界：
// - 舊備份（無版本 / 1 / 2）的 salary / marks 一律併入 CN，不切換當前地區；地區鍵屬過時鍵，回報未知。
// - v3 的 region / salaries / marksByRegion 才生效；頂層 salary / marks 屬過時鍵，回報未知，不併入任何地區。
function applyParsed(obj, current, version) {
  const isV3 = version >= 3;
  // cloneState 只認兩地：current 的 region 認不出來時已是 DEFAULT_REGION，呼叫方要別的回退就傳別的 base。
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
      // 舊版單句遷移；新格式優先，避免兩者同時存在時依鍵順序覆蓋。
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
        // 整塊不是物件：別拿「月薪必須是大於 0 的數字」這種具體規則去描述型別錯誤。
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

    // 舊版備份（無地區概念）：月薪與標記一律併入 CN，當前地區不變。
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

  // R7 跨欄位：單獨合格但合起來不成立的時間欄位一併丟棄，保留現值。
  // 月薪缺陷已在 salaries.* 上報，這裡的探針只用來讓跨欄位檢查跑完。
  const activeSalary = state.salaries[state.region];
  const probeSalary = salaryReason(activeSalary) ? 1 : activeSalary;
  const checkWith = () => validateSchedule({ ...state.cfg, salary: probeSalary });
  // validateSchedule 只回傳 { code, params }：把原因整理成 dropped 的語義形狀，不在這裡翻成文字。
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
  // 先只退被點名的那個欄位（它確實來自備份時），儘量保住同一份備份裡其他合格的值。
  while (!check.ok && appliedTimes.length) {
    const lone = appliedTimes.length === 1 ? appliedTimes[0] : appliedTimes.includes(check.field) ? check.field : null;
    if (!lone) break; // 衝突指向存檔裡原有的值：整組候選時間一起退回去
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
    // 與載入/匯入同一套校驗：壞值寫成預設，備份一定讀得回來。
    const v = Object.prototype.hasOwnProperty.call(shared, key) ? shared[key] : DEFAULTS[key];
    out[key] = CFG_RULES[key](v) ? DEFAULTS[key] : v;
  }
  out.salaries = {};
  out.marksByRegion = {};
  for (const rid of REGIONS) {
    // 與載入/匯入同一套校驗：不合法的月薪寫成該地區示例預設，避免產出自己讀不回來的備份。
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
  // 跨欄位（R7）也要立得住：備份讀回來才不會被判成部分無效。
  // 逐級讓步，儘量保住使用者實際填過的值：先關午休，再把午休時間退回預設。上下班時間不動（它們決定工時本身）。
  const valid = () => validateSchedule({ ...out, salary: out.salaries[out.region] }).ok;
  if (!valid() && out.lunchOn) out.lunchOn = DEFAULTS.lunchOn;
  if (!valid()) {
    out.lunchStart = DEFAULTS.lunchStart;
    out.lunchEnd = DEFAULTS.lunchEnd;
  }
  // 仍不成立（例如存檔裡的上下班時間本身倒掛）：整組時段退回預設，保證產物可以被自己讀回。
  if (!valid()) {
    for (const key of [...TIME_FIELDS, 'lunchOn']) out[key] = DEFAULTS[key];
  }
  return JSON.stringify(out, null, 2);
}

export function importState(text, current) {
  const p = parseObject(text);
  if (p.error) return { error: p.error };
  const version = fileVersion(p.obj);
  // 認不出版本（含未來版本）的備份整份拒絕：不能當成舊版誤讀。
  if (version === null) return { error: reason('futureVersion') };
  const base = cloneState(current ?? defaultState());
  return applyParsed(p.obj, base, version);
}

// 讀取只做校驗與合併，絕不寫回：遷移結果等下一次使用者正常儲存才落盤。
export function loadState(storage) {
  let raw;
  try {
    raw = storage.getItem(STORAGE_KEY);
  } catch {
    return { state: conservativeState(), storageOk: false, dropped: [], corrupt: false };
  }
  // 鍵不存在（Web Storage 回 null）且讀取成功：只有這種情況才算新使用者，套用 TW 預設值。
  // 其他非字串回傳代表儲存實作異常，按損壞讀取，不當成全新使用者。
  if (raw === null) return { state: defaultState(), storageOk: true, dropped: [], corrupt: false };
  if (typeof raw !== 'string') return { state: conservativeState(), storageOk: false, dropped: [], corrupt: true };
  const p = parseObject(raw);
  if (p.error) return { state: conservativeState(), storageOk: true, dropped: [], corrupt: true };
  const version = fileVersion(p.obj);
  if (version === null) return { state: conservativeState(), storageOk: true, dropped: [], corrupt: true };
  // 舊版（無版本 / 1 / 2）按 CN 保守回退讀取，不覆寫原始資料。
  // 已有存檔若沒有主題欄位，維持舊預設綠；明確儲存的主題照常載入。
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
