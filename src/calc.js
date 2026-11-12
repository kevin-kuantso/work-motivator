import { dayInfo, workdaysInMonth, nextWorkdayInDays } from './calendar.js';

// 校驗原因只回傳穩定的 code（必要時附引數），絕不寫死任何一種語言的句子：
// 顯示端（設定面板、匯入報告、小窗提示）在真正要顯示時用當時的字典翻成文字。
export function reason(code, params) {
  return params ? { code, params } : { code };
}


// { code, params } → 當前字典的一句話。鍵缺失回傳 ''，不回退到別的語言（翻譯缺失必須看得見）。
// params.field 是字典 labels 的鍵（start / lunchStart …），不是欄位路徑。
export function reasonText(r, t) {
  const table = t && t.reasons;
  if (!table || !r || typeof r.code !== 'string') return '';
  const entry = table[r.code];
  if (typeof entry === 'string') return entry;
  if (typeof entry !== 'function') return '';
  const key = r.params && typeof r.params.field === 'string' ? r.params.field : '';
  const label = key ? table.labels?.[key] ?? key : '';
  return entry(label) ?? '';
}

// 'HH:MM' -> 當日秒數；格式不合法返回 NaN
function parseHM(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(typeof s === 'string' ? s.trim() : '');
  if (!m) return NaN;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 23 || mi > 59) return NaN;
  return h * 3600 + mi * 60;
}

const validSalary = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0;
const overlap = (a1, a2, b1, b2) => Math.max(0, Math.min(a2, b2) - Math.max(a1, b1));

// 回傳 { ok:false, field, code, params }：field 是要掛錯誤的欄位，params.field 是字典 labels 的鍵
//（時間類原因要說出是哪個時間）；兩者通常一致，因為 cfg 的欄位名就是 labels 的鍵。
// 已翻譯的句子不出現在這裡：settings-panel 按 { code, params } 用當時的字典重譯。
export function validateSchedule(cfg) {
  const fail = (field, code, label = field) => ({ ok: false, field, code, params: { field: label } });
  if (!validSalary(cfg.salary)) return fail('salary', 'salary');
  const s = parseHM(cfg.start);
  const e = parseHM(cfg.end);
  if (Number.isNaN(s)) return fail('start', 'timeFormat');
  if (Number.isNaN(e)) return fail('end', 'timeFormat');
  if (e <= s) return fail('end', 'endAfterStart');
  if (cfg.lunchOn) {
    const ls = parseHM(cfg.lunchStart);
    const le = parseHM(cfg.lunchEnd);
    if (Number.isNaN(ls)) return fail('lunchStart', 'timeFormat');
    if (Number.isNaN(le)) return fail('lunchEnd', 'timeFormat');
    if (ls < s || ls > e) return fail('lunchStart', 'lunchInShift');
    if (le < s || le > e) return fail('lunchEnd', 'lunchInShift');
    if (ls >= le) return fail('lunchStart', 'lunchOrder');
  }
  return { ok: true };
}

const dayDiff = (a, b) =>
  Math.round(
    (Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) -
      Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / 86400000,
  );

function paydayIn(now, payday) {
  if (payday === null || payday === undefined) return null;
  if (!Number.isInteger(payday) || payday < 1 || payday > 31) return null;
  const y = now.getFullYear();
  const mo = now.getMonth();
  const target = (yy, mm) => new Date(yy, mm, Math.min(payday, new Date(yy, mm + 1, 0).getDate()));
  let t = target(y, mo);
  if (dayDiff(now, t) < 0) t = target(y, mo + 1); // Date 構造會處理 12 月進位
  return dayDiff(now, t);
}

// 日薪 = 月薪 ÷ 當月應出勤天數（spec §5）。狀態卡、月曆摘要行與選單預覽共用這一份公式。
export function monthWage(year, monthIndex, cfg, marks, tables) {
  const workdays = workdaysInMonth(year, monthIndex, cfg, marks, tables);
  return { workdays, dailyWage: validSalary(cfg.salary) && workdays > 0 ? cfg.salary / workdays : 0 };
}

export function snapshot(now, cfg, marks, tables) {
  const info = dayInfo(now, cfg, marks, tables);
  const year = now.getFullYear();
  const month = now.getMonth();

  const s = parseHM(cfg.start);
  const e = parseHM(cfg.end);
  const scheduleOk = Number.isFinite(s) && Number.isFinite(e) && e > s;
  const lunchOn = Boolean(cfg.lunchOn);
  let ls = parseHM(cfg.lunchStart);
  let le = parseHM(cfg.lunchEnd);
  const lunchOk = lunchOn && Number.isFinite(ls) && Number.isFinite(le) && scheduleOk && ls < le;
  if (!lunchOk) { ls = 0; le = 0; }

  const lunchSec = lunchOk ? overlap(ls, le, s, e) : 0;
  const totalSec = scheduleOk ? e - s - lunchSec : 0;

  const { dailyWage } = monthWage(year, month, cfg, marks, tables);
  const hourlyWage = totalSec > 0 ? dailyWage / (totalSec / 3600) : 0;
  const perSec = totalSec > 0 ? dailyWage / totalSec : 0;

  const sod = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds() + now.getMilliseconds() / 1000;

  let status;
  let earned = 0;
  let ratePerSec = 0;
  let workedSec = 0;
  let remainSec = 0;
  let resumeInSec = null;
  let nextDays = null;

  if (info.base === 'rest') {
    status = 'restDay';
    nextDays = nextWorkdayInDays(now, cfg, marks, tables);
  } else if (info.leave === 'paid') {
    status = 'paidLeave';
    earned = dailyWage;
  } else if (info.leave === 'unpaid') {
    status = 'unpaidLeave';
  } else if (!scheduleOk) {
    status = 'beforeWork'; // 時間配置無效：無法計時，金額保持 0
  } else if (sod < s) {
    status = 'beforeWork';
    remainSec = s - sod;
  } else if (sod >= e) {
    status = 'afterWork';
    workedSec = totalSec;
    earned = dailyWage;
  } else {
    const inLunch = lunchOk && sod >= ls && sod < le;
    status = inLunch ? 'lunch' : 'working';
    workedSec = sod - s - overlap(ls, le, s, sod);
    earned = perSec * workedSec;
    ratePerSec = inLunch ? 0 : perSec;
    remainSec = e - sod;
    if (inLunch) resumeInSec = le - sod;
  }

  // 本月已過各日金額
  let past = 0;
  if (dailyWage > 0) {
    for (let d = 1; d < now.getDate(); d++) {
      const di = dayInfo(new Date(year, month, d), cfg, marks, tables);
      if (di.base === 'work' && di.leave !== 'unpaid') past += dailyWage;
    }
  }

  return {
    status,
    makeupWork: info.base === 'work' && info.reason === 'makeup',
    earned,
    ratePerSec,
    workedSec,
    totalSec,
    remainSec,
    dailyWage,
    hourlyWage,
    monthTotal: past + earned,
    paydayInDays: paydayIn(now, cfg.payday),
    tableMissing: info.tableMissing,
    holidayName: info.holidayName,
    resumeInSec,
    nextWorkdayInDays: nextDays,
  };
}
