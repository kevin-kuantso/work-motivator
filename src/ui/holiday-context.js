// 纯函数：月历摘要行的情境胶囊（R36 / 决定 4）与缺假期表标签（R41）。
// 胶囊的放假区间、调休上班日取自 dayInfo（= 该月实际使用的表，或无表年份按《放假办法》标出的法定假日），
// 「依据」按该年的数据来源如实写：内置 / 联网 / 导入文件 / 无表（不声称任何官方来源）。
import { dayInfo } from '../calendar.js';
import { STATUTORY_FIXED_FROM_YEAR, STATUTORY_FIXED } from '../holidays-cn.js';
import { STATUTORY_LUNAR } from '../statutory-dates.js';

const has = (o, k) => Boolean(o) && Object.prototype.hasOwnProperty.call(o, k);
const PLAIN = { weekends: false }; // 法定假日 / 调休与周末开关无关

// 无表年份实际标出了什么：'lunar'（2027–2035：固定日期 + 春节 / 清明 / 端午 / 中秋）、'fixed'（其他 ≥ 2025：六个固定日期）、'none'（< 2025：什么都没标）
export function noTableKind(year) {
  if (has(STATUTORY_LUNAR, year)) return 'lunar';
  return year >= STATUTORY_FIXED_FROM_YEAR ? 'fixed' : 'none';
}

// 缺表标签：只在「当年」与之后的年份显示（当年取自可注入的 clock，不是真实 Date）；过去的年份不显示、不声称任何事。
// 有表（内置 / 联网 / 导入）→ null。
export function missingTableTag(year, today, tables, t) {
  if (has(tables, year) && tables[year]) return null;
  // round 3：过去的无表年份也显示（不再「过去不显示」，R41 修订）——三种措辞都只说 app 标了什么，对过去同样成立
  if (!(today instanceof Date)) return null;
  const c = t.card;
  switch (noTableKind(year)) {
    case 'lunar': return { kind: 'lunar', text: c.yearMissing(year), title: c.yearMissingLong(year) };
    case 'fixed': return { kind: 'fixed', text: c.yearMissingFixed(year, [...new Set(Object.values(STATUTORY_FIXED))]), title: c.yearMissingFixedLong(year) };
    default: return { kind: 'none', text: c.yearMissingNone(year), title: c.yearMissingNoneLong(year) };
  }
}

// 把同名、日期相连的日子合并成区间：[{ name, days:[d…] }] → 「10/1–10/7」「2/14、2/28」
function groupRuns(days) {
  const runs = [];
  for (const x of days) {
    const last = runs.at(-1);
    if (last && last.name === x.name && x.day === last.to + 1) last.to = x.day;
    else runs.push({ name: x.name, from: x.day, to: x.day });
  }
  return runs;
}

// 月份内的法定假日与调休上班日（不含手动标记）：{ off:[{name,day}], makeup:[{name,day}] }，按日期排序
export function monthHolidays(year, monthIndex, tables) {
  const n = new Date(year, monthIndex + 1, 0).getDate();
  const off = [];
  const makeup = [];
  for (let d = 1; d <= n; d++) {
    const info = dayInfo(new Date(year, monthIndex, d), PLAIN, {}, tables);
    if (info.reason === 'holiday') off.push({ name: info.holidayName, day: d });
    else if (info.reason === 'makeup') makeup.push({ name: info.holidayName, day: d });
  }
  return { off, makeup };
}

// 胶囊模型：{ tone:'none'|'holiday'|'unknown', check:boolean, text, sub:string|null, title }
// tone none = 有表且本月真的没有（虚线 + ✓）；holiday = 本月有放假 / 调休；unknown = 无表且本月没有标出任何日子（虚线，不打 ✓）
// 缺表标签已在同一行显示时（当年 / 之后的无表年份），标签已说明只标了哪些日子，胶囊的「依据」改放 title，避免一行放不下
export function monthContext(year, monthIndex, tables, today, t) {
  const C = t.calendar.context;
  const m = monthIndex + 1;
  const md = (day) => C.md(m, day);
  const table = has(tables, year) ? tables[year] : null;
  const { off, makeup } = monthHolidays(year, monthIndex, tables);

  // 按节日分组；组内「放假」在前、「调休上班」在后；各组按自己最早的日期排序
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

  let basis;
  if (table) basis = typeof C.basis[table.source] === 'function' ? C.basis[table.source](year) : null; // 来源不明：不写依据
  else if (noTableKind(year) === 'none') basis = null;
  else basis = noTableKind(year) === 'lunar' ? C.basis.lunar : C.basis.fixed; // R49：说 app 标了什么，过去 / 将来同一句
  
  if (!table && noTableKind(year) === 'none') {
    // 同一行已有「{年} 年未标法定假日」标签：胶囊只写本月的事实，长说明放 title（round 3，窄视窗不截断）
    return { tone: 'unknown', check: false, text: C.noneMarked, sub: null, title: C.noData(year) };
  }
  const text = marked ? C.join(parts) : table ? C.noHoliday : C.noneMarked;
  // 有表的放假月份：照设计稿只写区间（「依据」放 title）；其余情况把「依据」写出来，缺表标签已显示时改放 title
  // 「依据」只在有表且本月真的没有假日时写进胶囊（「本月没有法定假日 · 依据 …」）；其余情况（有放假的月份、所有无表年份）
  // 一律放在 title（round 2：无表年份不再分「过去 / 当年以后」两种写法；当年以后同一行另有缺表标签）
  const showSub = basis !== null && Boolean(table) && !marked;
  return {
    tone: marked ? 'holiday' : table ? 'none' : 'unknown',
    check: Boolean(table) && !marked && basis !== null,
    text,
    sub: showSub ? C.sub(basis) : null,
    title: basis === null ? text : `${text} ${C.sub(basis)}`,
  };
}
