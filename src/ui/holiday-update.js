// 聯網更新假期 / 匯入假期表文件（spec §12.3、§13.5–13.7）。
// 上半部是純函式（狀態行、結果模型、差異計數），下半部是流程編排（不碰 DOM；介面在 holiday-panel.js）。
// 規則：內建年份永不被覆蓋；聯網 / 匯入的資料都走 validateHolidayYear；自動檢查失敗時靜默，手動檢查才顯示原因；
// 同一時間只顯示一個結果；自動與手動檢查排隊依次執行，不併發。
import {
  fetchHolidayYear, mergeTables, validateHolidayYear, yearsToAutoCheck, sourcesWith, validateCustomUrl, buildSourceUrl, renderReason,
} from '../holiday-data.js';
import {
  loadOnlineTables, saveOnlineYear, loadLastCheck, saveLastCheck, loadCustomUrl, saveCustomUrl, FILE_SOURCE,
} from '../holiday-store.js';
import { STRINGS } from '../strings.zh-CN.js';

export { FILE_SOURCE };

// 受保護的年份（R30）：內建表與使用者匯入的文件，聯網資料只比較、從不覆蓋；只有聯網年份可被聯網新資料替換。
const isProtected = (tb) => tb?.source === 'builtin' || tb?.source === 'file';

const has = (o, k) => Boolean(o) && Object.prototype.hasOwnProperty.call(o, k);
const isPlainObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const pad2 = (n) => String(n).padStart(2, '0');

// 某一天在表裡的型別：'off'（放假）、'makeup'（調休上班）或 null
const kindOf = (table, date) => (has(table.off, date) ? 'off' : has(table.makeup, date) ? 'makeup' : null);

// 兩份表有幾個日期的型別不同。只比日期與型別，不比節日名（內建「清明」與聯網「清明節」不算不同，spec §13.7）。
export function diffCount(a, b) {
  const dates = new Set([a.off, a.makeup, b.off, b.makeup].flatMap((x) => Object.keys(x ?? {})));
  let n = 0;
  for (const d of dates) if (kindOf(a, d) !== kindOf(b, d)) n++;
  return n;
}

// 連節日名都相同（用來判斷聯網年份是否有新版本）
function sameTable(a, b) {
  const norm = (x) => JSON.stringify(Object.entries(x ?? {}).sort(([p], [q]) => (p < q ? -1 : 1)));
  return norm(a.off) === norm(b.off) && norm(a.makeup) === norm(b.makeup);
}

export function dayCounts(table) {
  return { off: Object.keys(table.off ?? {}).length, makeup: Object.keys(table.makeup ?? {}).length };
}

// 狀態（假期資料卡的年份膠囊）：當年；11 月起（或已經有下一年的表時）再加下一年；檢查過才附「上次檢查 MM/DD」。
// 匯入的年份只寫「已匯入文件」，不聲稱來源（文件可能來自任何地方，R30）。
// kind：builtin / online / file / missing（介面按 kind 上色：內建與聯網 / 匯入 = 有表，missing = 黃色）
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

// 同一狀態的一行文字（「2026 年 · 內建 · 2027 年 · 未內建 · 上次檢查 11/04」）：測試與無障礙名稱用
export function statusLine(now, tables, lastCheckMs, t) {
  const m = statusModel(now, tables, lastCheckMs, t);
  return [...m.chips.map((c) => c.text), ...(m.lastCheck ? [m.lastCheck] : [])].join(t.holidayUpdate.sep);
}

// 多個年份的檢查結果 → 只顯示一個。未受保護的年份優先（那才是使用者要的）；受保護年份（內建 / 匯入文件）只會「相同」或「失敗」，
// 與之不同的（diff）不套用，由頁面級提示另行告知，這裡按「已是最新」處理。
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

// tone：success（綠，「已是最新」也是成功，不是停用狀態 L7）/ info（藍，「暫未釋出」不是錯誤）/ warn（黃）
// check：只在「已是最新」的結果前加裝飾性 ✓（L7）；其餘結果保持原樣
// formatHelp：被拒絕的原因是格式 / 內容不合格時展開既有示例；連不上 / 超時 / 過大不展開
export function resultView(res, t) {
  if (!res) return null;
  const U = t.holidayUpdate;
  const reason = renderReason(res.reason, t.holidayData);
  const detail = reason ? U.detail(reason) : null;
  switch (res.outcome) {
    case 'added': return { tone: 'success', text: U.added(res.years), detail: null };
    case 'refreshed': return { tone: 'success', text: U.refreshed(res.years), detail: null };
    case 'unpublished': return { tone: 'info', text: U.unpublished(res.years[0]), detail: null };
    case 'network': return { tone: 'warn', text: U.network, detail: null };
    case 'invalid': return { tone: 'warn', text: U.invalid, detail, formatHelp: res.format === true };
    // 「已是最新」（L7）：綠底 + 文字前的 ✓，不是停用狀態。內建表有差異時由頁面級提示另行告知，
    // pickResult 已把受保護年份的 diff 歸一成 same，所以這裡只需要 same
    case 'same': return { tone: 'success', text: U.same, detail: null, check: true };
    // 未知結果不冒充成功：保持原來的灰底「已是最新」文字
    default: return { tone: 'muted', text: U.same, detail: null };
  }
}

export function customUrlSummary(url, t) {
  if (!url) return t.holidayUpdate.customUrlSummary(null);
  let host = null;
  try {
    host = new URL(buildSourceUrl(url, 2000)).host;
  } catch { /* 已校驗過，理論上不會發生 */ }
  return t.holidayUpdate.customUrlSummary(host);
}

// ---- 流程編排 ----
// ctx: { storage, clock, fetchImpl?, getTables, onTables, notify(msg, kind:'info'|'success', against?:'builtin'|'file'), onStatus(status) }
// status: { checking, line, status:{chips,lastCheck}, result:{tone,text,detail}|null, customUrl, customSummary }
export function startHolidayUpdate(ctx) {
  const current = () => ctx.isCurrent?.() !== false;
  const getT = () => ctx.getStrings?.() ?? STRINGS;
  const U = new Proxy({}, { get: (_, key) => getT().holidayUpdate[key] });
  const { storage, clock, getTables, onTables, notify, onStatus } = ctx;
  let result = null;
  // 結果區一次只顯示一個，最新的使用者操作優先（R32）：每次手動檢查 / 匯入把 seq 加一；
  // 檢查結束時若期間已有更新的使用者操作，不覆蓋它的結果；後臺自動檢查從不覆蓋使用者操作的結果。
  let seq = 0;
  let pending = 0; // 排隊中 + 執行中的檢查數
  let chain = Promise.resolve();

  function emit() {
    if (!current()) return;
    const t = getT();
    const url = loadCustomUrl(storage);
    onStatus({
      checking: pending > 0,
      line: statusLine(clock(), getTables(), loadLastCheck(storage), t),
      status: statusModel(clock(), getTables(), loadLastCheck(storage), t),
      result: typeof result === 'function' ? result(t) : result,
      customUrl: url,
      customSummary: customUrlSummary(url, t),
    });
  }

  const builtinOnly = () => Object.fromEntries(Object.entries(getTables()).filter(([, v]) => v && v.source === 'builtin'));

  // 從儲存重新讀取聯網 / 匯入的表（開頁、其他分頁改了假期資料）；只讀不寫。
  function reload() {
    if (!current()) return;
    const l = loadOnlineTables(storage);
    onTables(mergeTables(builtinOnly(), l.tables));
    emit();
  }

  // source：聯網時為下載網址，匯入時為 FILE_SOURCE。內建年份永不覆蓋；聯網資料也不覆蓋匯入的文件。
  function apply(year, table, papers, source) {
    if (!current()) return;
    const cur = getTables()[year];
    const fromFile = source === FILE_SOURCE;
    if (cur?.source === 'builtin' || (!fromFile && cur?.source === 'file')) return;
    const fetchedAt = clock().getTime();
    saveOnlineYear(storage, year, { table, papers, source, fetchedAt }); // 儲存失敗也先在本次會話裡生效
    onTables({ ...getTables(), [year]: { off: table.off, makeup: table.makeup, source: fromFile ? 'file' : 'online' } });
  }

  async function checkYears(years) {
    saveLastCheck(storage, clock().getTime()); // 每次嘗試都記錄（成功或失敗），保證每天最多自動一次
    const sources = sourcesWith(loadCustomUrl(storage));
    const out = [];
    for (const year of years) {
      if (!current()) return out;
      const r = await fetchHolidayYear(year, { sources, fetchImpl: ctx.fetchImpl });
      if (!current()) return out;
      // Another tab may have imported this year during the request. Re-read before protecting or writing it.
      const stored = loadOnlineTables(storage).tables[year];
      const memory = getTables()[year];
      const cur = memory?.source === 'builtin' || memory?.source === 'file' ? memory : (stored ?? memory);
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

  // 自動與手動檢查排隊依次執行，不會同時下載、也不會重複套用同一年
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
    if (!current()) return Promise.resolve();
    return serial(async () => {
      if (!current()) return;
      const years = yearsToAutoCheck(clock(), getTables(), loadLastCheck(storage));
      if (!years.length) return;
      const out = await checkYears(years);
      if (!current()) return;
      const got = out.filter((o) => o.outcome === 'added' || o.outcome === 'refreshed').map((o) => o.year);
      if (got.length) {
        notify((strings) => strings.holidayUpdate.fetched(got), 'success'); // 不打擾的提示，不帶「檢視」（spec §13.7）
        return;
      }
      // 「暫未釋出」不是失敗：在假期資料區安靜地說明；連不上 / 資料不合格則靜默
      const unp = out.find((o) => o.outcome === 'unpublished');
      if (unp && seq === mine && result === null) result = (t) => resultView({ outcome: 'unpublished', years: [unp.year] }, t);
    });
  }

  function checkNow() {
    const mine = ++seq;
    result = null;
    return serial(async () => {
      const now = clock();
      if (!current()) return;
      const y = now.getFullYear();
      const out = await checkYears(now.getMonth() >= 10 ? [y, y + 1] : [y]);
      if (current() && seq === mine) {
        const picked = pickResult(out);
        result = (t) => resultView(picked, t);
      }
      // 與受保護年份不同：頁面級提示，內建與匯入文件分別說明（兩者都不會被覆蓋）
      if (!current() || seq !== mine) return;
      for (const against of ['builtin', 'file']) {
        const n = out.reduce((sum, o) => sum + (o.outcome === 'diff' && o.against === against ? o.n : 0), 0);
        if (n) notify((strings) => against === 'builtin' ? strings.holidayUpdate.diff(n) : strings.holidayUpdate.diffFile(n), 'info', against);
      }
    });
  }

  function importFile(text) {
    if (!current()) return { ok: false };
    seq++;
    // format：文件格式 / 內容不合格（不是 JSON、沒有年份、validateHolidayYear 不通過）→ 附「檢視格式示例」；「已內建」不是格式問題
    const fail = (reason, year, format = true) => {
      result = (t) => ({ tone: 'warn', text: renderReason(reason, reason.domain === 'update' ? t.holidayUpdate : t.holidayData), detail: null, formatHelp: format });
      emit();
      return year === undefined ? { ok: false, reason } : { ok: false, reason, year };
    };
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
    // 目標年份 = 文件自己的 year 欄位（不按當前檢視的月份猜）
    const year = isPlainObject(json) ? json.year : undefined;
    if (!Number.isInteger(year) || year < 1000 || year > 9999) return fail({ code: 'importNoYear', domain: 'update' });
    if (getTables()[year]?.source === 'builtin') return fail({ code: 'importBuiltin', params: year, domain: 'update' }, year, false);
    const v = validateHolidayYear(json, year);
    if (!v.ok) return fail({ code: v.code, params: v.params }, year);
    apply(year, v.table, v.papers, FILE_SOURCE);
    const c = dayCounts(v.table);
    result = (t) => ({ tone: 'success', text: t.holidayUpdate.importDone(year, c.off, c.makeup), detail: null });
    emit();
    return { ok: true, year };
  }

  // 空字串 = 清除；不合格的不儲存，返回具體原因
  function setCustomUrl(value) {
    if (!current()) return { ok: false };
    if (value === '') {
      saveCustomUrl(storage, null);
      emit();
      return { ok: true };
    }
    const v = validateCustomUrl(value);
    if (!v.ok) return { ok: false, code: v.code };
    saveCustomUrl(storage, v.url);
    emit();
    return { ok: true };
  }

  emit();
  return { checkNow, importFile, autoCheckIfNeeded, setCustomUrl, reload, refresh: emit };
}
