// 純函式：月曆摘要行的情境膠囊（R36 / 決定 4）與缺假期表標籤（R41）。
// 膠囊的放假區間、調休上班日取自 dayInfo（= 該月實際使用的表，或該地區在無表年份仍標出的法定假日），
// 「依據」按該年的資料來源如實寫：內建 / 聯網 / 匯入文件 / 無表（不聲稱任何官方來源）。
// 地區差異只在 provider：CN 無表年份按《放假辦法》標出法定假日，TW 無表年份什麼都不標（只用週末 + 手動標記）。
import { dayInfo } from '../calendar.js';
import { CN_HOLIDAY_PROVIDER } from '../holiday-provider-cn.js';

const has = (o, k) => Boolean(o) && Object.prototype.hasOwnProperty.call(o, k);
// 只有物件才算 provider（`[2024,…].map(noTableKind)` 之類會把索引傳進來：一律按 CN 處理，不誤判成「沒有回退」）
const providerOf = (provider) => (provider && typeof provider === 'object' ? provider : CN_HOLIDAY_PROVIDER);
// A provider without missing-year metadata has no statutory fallback.
// 法定假日 / 調休與週末開關無關；provider 決定無表年份的回退
const plainCfg = (provider) => ({ weekends: false, holidayProvider: providerOf(provider) });

// 無表年份實際標出了什麼：'lunar'（2028–2035：固定日期 + 春節 / 清明 / 端午 / 中秋）、
// 'fixed'（其他 ≥ 2025：六個固定日期）、'none'（< 2025，或該地區沒有法定日期回退）
export function noTableKind(year, provider) {
  const p = providerOf(provider);
  return typeof p.missingYearKind === 'function' ? p.missingYearKind(year) : 'none';
}

// 該年無表時「標出了哪些固定日期」的節日名（CN 是《放假辦法》的六個固定日期；其他地區由 provider 提供）
function fixedNames(provider) {
  return [...new Set(Object.values(providerOf(provider).fixedNames ?? {}))];
}

// 缺表標籤：只在「當年」與之後的年份顯示（當年取自可注入的 clock，不是真實 Date）；過去的年份不顯示、不聲稱任何事。
// 有表（內建 / 聯網 / 匯入）→ null。措辭全部取自當前地區的字典，兩邊共用同一批 key。
export function missingTableTag(year, today, tables, t, provider) {
  if (has(tables, year) && tables[year]) return null;
  // round 3：過去的無表年份也顯示（不再「過去不顯示」，R41 修訂）——三種措辭都只說 app 標了什麼，對過去同樣成立
  if (!(today instanceof Date)) return null;
  const c = t.card;
  switch (noTableKind(year, provider)) {
    case 'lunar': return { kind: 'lunar', text: c.yearMissing(year), title: c.yearMissingLong(year) };
    case 'fixed': return { kind: 'fixed', text: c.yearMissingFixed(year, fixedNames(provider)), title: c.yearMissingFixedLong(year) };
    default: return { kind: 'none', text: c.yearMissingNone(year), title: c.yearMissingNoneLong(year) };
  }
}

// 把同名、日期相連的日子合併成區間：[{ name, days:[d…] }] → 「10/1–10/7」「2/14、2/28」
function groupRuns(days) {
  const runs = [];
  for (const x of days) {
    const last = runs.at(-1);
    if (last && last.name === x.name && x.day === last.to + 1) last.to = x.day;
    else runs.push({ name: x.name, from: x.day, to: x.day });
  }
  return runs;
}

// 月份內的法定假日與調休上班日（不含手動標記）：{ off:[{name,day}], makeup:[{name,day}] }，按日期排序
export function monthHolidays(year, monthIndex, tables, provider) {
  const n = new Date(year, monthIndex + 1, 0).getDate();
  const cfg = plainCfg(provider);
  const off = [];
  const makeup = [];
  for (let d = 1; d <= n; d++) {
    const info = dayInfo(new Date(year, monthIndex, d), cfg, {}, tables);
    if (info.reason === 'holiday') off.push({ name: info.holidayName, day: d });
    else if (info.reason === 'makeup') makeup.push({ name: info.holidayName, day: d });
  }
  return { off, makeup };
}

// 膠囊模型：{ tone:'none'|'holiday'|'unknown', check:boolean, text, sub:string|null, title }
// tone none = 有表且本月真的沒有（虛線 + ✓）；holiday = 本月有放假 / 調休；unknown = 無表且本月沒有標出任何日子（虛線，不打 ✓）
// 缺表標籤已在同一行顯示時（當年 / 之後的無表年份），標籤已說明只標了哪些日子，膠囊的「依據」改放 title，避免一行放不下
export function monthContext(year, monthIndex, tables, today, t, provider) {
  const C = t.calendar.context;
  const m = monthIndex + 1;
  const md = (day) => C.md(m, day);
  const table = has(tables, year) ? tables[year] : null;
  const { off, makeup } = monthHolidays(year, monthIndex, tables, provider);

  // 按節日分組；組內「放假」在前、「調休上班」在後；各組按自己最早的日期排序
  const groups = new Map();
  const groupOf = (name) => {
    if (!groups.has(name)) groups.set(name, { name, first: Infinity, off: [], makeup: [] });
    return groups.get(name);
  };
  for (const r of groupRuns(off)) {
    const g = groupOf(r.name);
    g.off.push(C.range(md(r.from), md(r.to)));
    g.first = Math.min(g.first, r.from);
  }
  for (const r of groupRuns(makeup)) {
    const g = groupOf(r.name);
    for (let d = r.from; d <= r.to; d++) g.makeup.push(md(d));
    g.first = Math.min(g.first, r.from);
  }
  const parts = [...groups.values()].sort((a, b) => a.first - b.first)
    .map((g) => C.group(g.name, [g.off.length ? C.off(g.off) : null, g.makeup.length ? C.makeup(g.makeup) : null].filter(Boolean)));
  const marked = parts.length > 0;

  const kind = noTableKind(year, provider);
  let basis;
  if (table) basis = typeof C.basis[table.source] === 'function' ? C.basis[table.source](year) : null; // 來源不明：不寫依據
  else if (kind === 'none') basis = null;
  else basis = kind === 'lunar' ? C.basis.lunar : C.basis.fixed; // R49：說 app 標了什麼，過去 / 將來同一句

  if (!table && kind === 'none') {
    // 同一行已有「{年} 年未標法定假日」標籤：膠囊只寫本月的事實，長說明放 title（round 3，窄視窗不截斷）
    return { tone: 'unknown', check: false, text: C.noneMarked, title: C.noData(year) };
  }
  const text = marked ? C.join(parts) : table ? C.noHoliday : C.noneMarked;
  // 「依據」只放 title（M10）：本月沒有假日的膠囊是純說明文字，不再在後面接一段小字
  return {
    tone: marked ? 'holiday' : table ? 'none' : 'unknown',
    check: Boolean(table) && !marked && basis !== null,
    text,
    title: basis === null ? text : `${text} ${C.sub(basis)}`,
  };
}
