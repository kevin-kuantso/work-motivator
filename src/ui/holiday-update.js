// 联网更新假期 / 导入假期表文件（spec §12.3、§13.5–13.7）。
// 上半部是纯函数（状态行、结果模型、差异计数），下半部是流程编排（不碰 DOM；界面在 holiday-panel.js）。
// 规则：内置年份永不被覆盖；联网 / 导入的数据都走 validateHolidayYear；自动检查失败时静默，手动检查才显示原因；
// 同一时间只显示一个结果；自动与手动检查排队依次执行，不并发。
import {
  fetchHolidayYear, mergeTables, validateHolidayYear, yearsToAutoCheck, sourcesWith, validateCustomUrl, buildSourceUrl,
} from '../holiday-data.js';
import {
  loadOnlineTables, saveOnlineYear, loadLastCheck, saveLastCheck, loadCustomUrl, saveCustomUrl, FILE_SOURCE,
} from '../holiday-store.js';
import { STRINGS } from '../strings.zh-CN.js';

export { FILE_SOURCE };

// 受保护的年份（R30）：内置表与用户导入的文件，联网数据只比较、从不覆盖；只有联网年份可被联网新数据替换。
const isProtected = (tb) => tb?.source === 'builtin' || tb?.source === 'file';

const has = (o, k) => Boolean(o) && Object.prototype.hasOwnProperty.call(o, k);
const isPlainObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const pad2 = (n) => String(n).padStart(2, '0');

// 某一天在表里的类型：'off'（放假）、'makeup'（调休上班）或 null
const kindOf = (table, date) => (has(table.off, date) ? 'off' : has(table.makeup, date) ? 'makeup' : null);

// 两份表有几个日期的类型不同。只比日期与类型，不比节日名（内置「清明」与联网「清明节」不算不同，spec §13.7）。
export function diffCount(a, b) {
  const dates = new Set([a.off, a.makeup, b.off, b.makeup].flatMap((x) => Object.keys(x ?? {})));
  let n = 0;
  for (const d of dates) if (kindOf(a, d) !== kindOf(b, d)) n++;
  return n;
}

// 连节日名都相同（用来判断联网年份是否有新版本）
function sameTable(a, b) {
  const norm = (x) => JSON.stringify(Object.entries(x ?? {}).sort(([p], [q]) => (p < q ? -1 : 1)));
  return norm(a.off) === norm(b.off) && norm(a.makeup) === norm(b.makeup);
}

export function dayCounts(table) {
  return { off: Object.keys(table.off ?? {}).length, makeup: Object.keys(table.makeup ?? {}).length };
}

// 状态（假期数据卡的年份胶囊）：当年；11 月起（或已经有下一年的表时）再加下一年；检查过才附「上次检查 MM/DD」。
// 导入的年份只写「已导入文件」，不声称来源（文件可能来自任何地方，R30）。
// kind：builtin / online / file / missing（界面按 kind 上色：内置与联网 / 导入 = 有表，missing = 黄色）
export function statusModel(now, tables, lastCheckMs, t) {
  const U = t.holidayUpdate;
  const y = now.getFullYear();
  const years = [y];
  if (now.getMonth() >= 10 || has(tables, y + 1)) years.push(y + 1);
  const chips = years.map((yr) => {
    const tb = has(tables, yr) ? tables[yr] : null;
    if (!tb) return { year: yr, kind: 'missing', text: U.missing(yr) };
    if (tb.source === 'builtin') return { year: yr, kind: 'builtin', text: U.builtin(yr) };
    return tb.source === 'file' ? { year: yr, kind: 'file', text: U.importedYear(yr) } : { year: yr, kind: 'online', text: U.online(yr) };
  });
  let lastCheck = null;
  if (typeof lastCheckMs === 'number') {
    const d = new Date(lastCheckMs);
    lastCheck = U.lastCheck(`${pad2(d.getMonth() + 1)}/${pad2(d.getDate())}`);
  }
  return { chips, lastCheck };
}

// 同一状态的一行文字（「2026 年 · 内置 · 2027 年 · 未内置 · 上次检查 11/04」）：测试与无障碍名称用
export function statusLine(now, tables, lastCheckMs, t) {
  const m = statusModel(now, tables, lastCheckMs, t);
  return [...m.chips.map((c) => c.text), ...(m.lastCheck ? [m.lastCheck] : [])].join(t.holidayUpdate.sep);
}

// 多个年份的检查结果 → 只显示一个。未受保护的年份优先（那才是用户要的）；受保护年份（内置 / 导入文件）只会「相同」或「失败」，
// 与之不同的（diff）不套用，由页面级提示另行告知，这里按「已是最新」处理。
const ORDER_OTHER = ['added', 'refreshed', 'invalid', 'network', 'unpublished', 'same'];
const ORDER_BUILTIN = ['invalid', 'network', 'same'];
export function pickResult(results) {
  const other = results.filter((r) => !r.protected);
  const pool = other.length ? other : results.map((r) => (r.outcome === 'diff' ? { ...r, outcome: 'same' } : r));
  for (const o of other.length ? ORDER_OTHER : ORDER_BUILTIN) {
    const hits = pool.filter((r) => r.outcome === o);
    if (hits.length) return { outcome: o, years: hits.map((r) => r.year), reason: hits.at(-1).reason ?? null, format: hits.at(-1).format === true };
  }
  return null;
}

// tone：success（绿，「已是最新」也是成功，不是停用状态 L7）/ info（蓝，「暂未发布」不是错误）/ warn（黄）
// check：只在「已是最新」的结果前加装饰性 ✓（L7）；其余结果保持原样
// formatHelp：被拒绝的原因是格式 / 内容不合格时展开既有示例；连不上 / 超时 / 过大不展开
export function resultView(res, t) {
  if (!res) return null;
  const U = t.holidayUpdate;
  const prefix = t.holidayData.allFailed('');
  const reason = res.reason?.startsWith(prefix) ? res.reason.slice(prefix.length) : res.reason;
  const detail = reason ? U.detail(reason) : null;
  switch (res.outcome) {
    case 'added': return { tone: 'success', text: U.added(res.years), detail: null };
    case 'refreshed': return { tone: 'success', text: U.refreshed(res.years), detail: null };
    case 'unpublished': return { tone: 'info', text: U.unpublished(res.years[0]), detail: null };
    case 'network': return { tone: 'warn', text: U.network, detail: null };
    case 'invalid': return { tone: 'warn', text: U.invalid, detail, formatHelp: res.format === true };
    // 「已是最新」（L7）：绿底 + 文字前的 ✓，不是停用状态。内置表有差异时由页面级提示另行告知，
    // pickResult 已把受保护年份的 diff 归一成 same，所以这里只需要 same
    case 'same': return { tone: 'success', text: U.same, detail: null, check: true };
    // 未知结果不冒充成功：保持原来的灰底「已是最新」文字
    default: return { tone: 'muted', text: U.same, detail: null };
  }
}

export function customUrlSummary(url, t) {
  if (!url) return t.holidayUpdate.customUrlSummary(null);
  let host = null;
  try {
    host = new URL(buildSourceUrl(url, 2000)).host;
  } catch { /* 已校验过，理论上不会发生 */ }
  return t.holidayUpdate.customUrlSummary(host);
}

// ---- 流程编排 ----
// ctx: { storage, clock, fetchImpl?, getTables, onTables, notify(msg, kind:'info'|'success', against?:'builtin'|'file'), onStatus(status) }
// status: { checking, line, status:{chips,lastCheck}, result:{tone,text,detail}|null, customUrl, customSummary }
export function startHolidayUpdate(ctx) {
  const t = STRINGS;
  const U = t.holidayUpdate;
  const { storage, clock, getTables, onTables, notify, onStatus } = ctx;
  let result = null;
  // 结果区一次只显示一个，最新的用户操作优先（R32）：每次手动检查 / 导入把 seq 加一；
  // 检查结束时若期间已有更新的用户操作，不覆盖它的结果；后台自动检查从不覆盖用户操作的结果。
  let seq = 0;
  let pending = 0; // 排队中 + 执行中的检查数
  let chain = Promise.resolve();

  function emit() {
    const url = loadCustomUrl(storage);
    onStatus({
      checking: pending > 0,
      line: statusLine(clock(), getTables(), loadLastCheck(storage), t),
      status: statusModel(clock(), getTables(), loadLastCheck(storage), t),
      result,
      customUrl: url,
      customSummary: customUrlSummary(url, t),
    });
  }

  const builtinOnly = () => Object.fromEntries(Object.entries(getTables()).filter(([, v]) => v && v.source === 'builtin'));

  // 从储存重新读取联网 / 导入的表（开页、其他分页改了假期数据）；只读不写。
  function reload() {
    const l = loadOnlineTables(storage);
    onTables(mergeTables(builtinOnly(), l.tables));
    emit();
  }

  // source：联网时为下载网址，导入时为 FILE_SOURCE。内置年份永不覆盖；联网数据也不覆盖导入的文件。
  function apply(year, table, papers, source) {
    const cur = getTables()[year];
    const fromFile = source === FILE_SOURCE;
    if (cur?.source === 'builtin' || (!fromFile && cur?.source === 'file')) return;
    const fetchedAt = clock().getTime();
    saveOnlineYear(storage, year, { table, papers, source, fetchedAt }); // 储存失败也先在本次会话里生效
    onTables({ ...getTables(), [year]: { off: table.off, makeup: table.makeup, source: fromFile ? 'file' : 'online' } });
  }

  async function checkYears(years) {
    saveLastCheck(storage, clock().getTime()); // 每次尝试都记录（成功或失败），保证每天最多自动一次
    const sources = sourcesWith(loadCustomUrl(storage));
    const out = [];
    for (const year of years) {
      const r = await fetchHolidayYear(year, { sources, fetchImpl: ctx.fetchImpl });
      const cur = getTables()[year]; // 等待期间可能已被另一次检查 / 导入更新：以当下为准
      const prot = isProtected(cur);
      const base = { year, protected: prot, against: prot ? cur.source : null };
      if (!r.ok) out.push({ ...base, outcome: r.kind, reason: r.reason, format: r.format === true });
      else if (prot) {
        const n = diffCount(cur, r.table);
        out.push({ ...base, outcome: n ? 'diff' : 'same', n });
      } else if (cur && sameTable(cur, r.table)) out.push({ ...base, outcome: 'same' });
      else {
        apply(year, r.table, r.papers, r.source);
        out.push({ ...base, outcome: cur ? 'refreshed' : 'added' });
      }
    }
    return out;
  }

  // 自动与手动检查排队依次执行，不会同时下载、也不会重复套用同一年
  function serial(fn) {
    pending++;
    emit();
    const run = async () => {
      try {
        await fn();
      } finally {
        pending--;
        emit();
      }
    };
    const p = chain.then(run, run);
    chain = p.catch(() => {});
    return p;
  }

  function autoCheckIfNeeded() {
    if (!yearsToAutoCheck(clock(), getTables(), loadLastCheck(storage)).length) return Promise.resolve();
    const mine = seq;
    return serial(async () => {
      const years = yearsToAutoCheck(clock(), getTables(), loadLastCheck(storage));
      if (!years.length) return;
      const out = await checkYears(years);
      const got = out.filter((o) => o.outcome === 'added' || o.outcome === 'refreshed').map((o) => o.year);
      if (got.length) {
        notify(U.fetched(got), 'success'); // 不打扰的提示，不带「查看」（spec §13.7）
        return;
      }
      // 「暂未发布」不是失败：在假期数据区安静地说明；连不上 / 数据不合格则静默
      const unp = out.find((o) => o.outcome === 'unpublished');
      if (unp && seq === mine && result === null) result = resultView({ outcome: 'unpublished', years: [unp.year] }, t);
    });
  }

  function checkNow() {
    const mine = ++seq;
    result = null;
    return serial(async () => {
      const now = clock();
      const y = now.getFullYear();
      const out = await checkYears(now.getMonth() >= 10 ? [y, y + 1] : [y]);
      if (seq === mine) result = resultView(pickResult(out), t); // 期间用户又导入 / 再查：不覆盖更新的结果
      // 与受保护年份不同：页面级提示，内置与导入文件分别说明（两者都不会被覆盖）
      for (const against of ['builtin', 'file']) {
        const n = out.reduce((sum, o) => sum + (o.outcome === 'diff' && o.against === against ? o.n : 0), 0);
        if (n) notify(against === 'builtin' ? U.diff(n) : U.diffFile(n), 'info', against);
      }
    });
  }

  function importFile(text) {
    seq++;
    // format：文件格式 / 内容不合格（不是 JSON、没有年份、validateHolidayYear 不通过）→ 附「查看格式示例」；「已内置」不是格式问题
    const fail = (reason, year, format = true) => {
      result = { tone: 'warn', text: reason, detail: null, formatHelp: format };
      emit();
      return year === undefined ? { ok: false, reason } : { ok: false, reason, year };
    };
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
    // 目标年份 = 文件自己的 year 字段（不按当前查看的月份猜）
    const year = isPlainObject(json) ? json.year : undefined;
    if (!Number.isInteger(year) || year < 1000 || year > 9999) return fail(U.importNoYear);
    if (getTables()[year]?.source === 'builtin') return fail(U.importBuiltin(year), year, false);
    const v = validateHolidayYear(json, year);
    if (!v.ok) return fail(v.reason, year);
    apply(year, v.table, v.papers, FILE_SOURCE);
    const c = dayCounts(v.table);
    result = { tone: 'success', text: U.importDone(year, c.off, c.makeup), detail: null };
    emit();
    return { ok: true, year };
  }

  // 空字符串 = 清除；不合格的不保存，返回具体原因
  function setCustomUrl(value) {
    if (value === '') {
      saveCustomUrl(storage, null);
      emit();
      return { ok: true };
    }
    const v = validateCustomUrl(value);
    if (!v.ok) return { ok: false, reason: v.reason };
    saveCustomUrl(storage, v.url);
    emit();
    return { ok: true };
  }

  emit();
  return { checkNow, importFile, autoCheckIfNeeded, setCustomUrl, reload };
}
