// 臺灣行政機關辦公日曆：只做匯入官方 CSV（線上檢查已移除，見下方說明）。
// 只做流程編排，不碰 DOM（畫面在 holiday-panel.js）。規則：
// - 內建年份永不被覆蓋；匯入可替換非內建的線上表（舊版程式存下來的線上表仍照常載入、可被匯入蓋過）。
// - 臺灣沒有自訂資料網址，也不使用中國的來源、驗證或年表回退。
// - 單一離線檔案在本機 Chrome 無法直接讀取官方資料（跨來源限制），故只留「匯入官方 CSV」。
//   內建 2026／2027 已靜態打包；其他年度請自行下載 CSV 匯入。
//   因此這裡不發起任何網路請求、不記 lastCheck，也不排自動檢查。
// - 每次匯入開始時記下 generation；切換地區（reload() 換 generation，或 isCurrent() 變 false）後才完成的工作
//   一律丟棄：不儲存、不通知、不更新當前表。寫入前一律重新讀取來源地區目前表（含其他分頁的匯入），
//   再依保護規則寫入，所以舊結果不會覆蓋新資料，也不會寫錯地區。
// - 同一時間只顯示一個結果。
// - 本模組不 import 任何中國模組（狀態膠囊等純函式在此自帶一份，字典由呼叫端注入）。
import { parseTwCsv, TW_BUILTIN_TABLES, mergeTwTables } from '../holiday-data-tw.js';
import {
  loadTwTables, saveTwYear, mayReplaceTw, validateTwTable, FILE_SOURCE,
} from '../holiday-store-tw.js';
import { STRINGS as TW_STRINGS } from '../strings.zh-TW.js';

export { FILE_SOURCE, TW_BUILTIN_TABLES };

const isPlainObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const has = (o, k) => Boolean(o) && Object.prototype.hasOwnProperty.call(o, k);

// 存不進儲存、只能留在本次會話的表（year → { off, makeup, source, base }），按 storage 物件掛在整頁層級：
// 切到別的地區時 app 會重建這個流程物件（新 generation），若把補位表放在實例裡，切回臺灣就整份消失。
// 掛在 storage 上等於「這個頁面配這份儲存」，重開頁面自然歸零；不同的儲存物件（每個測試各自的假 storage）
// 互不影響。base 是「寫入失敗當下」儲存裡那一年的簽章，儲存成功就移除，所以儲存一直是真相來源。
const SESSION_TABLES = new WeakMap();
function sessionFor(storage) {
  const key = typeof storage === 'object' && storage !== null ? storage : null;
  if (!key) return new Map(); // 沒有 storage 物件時沒有可延續的頁面層級（正常流程不會走到）
  let m = SESSION_TABLES.get(key);
  if (!m) {
    m = new Map();
    SESSION_TABLES.set(key, m);
  }
  return m;
}

export function dayCountsTw(table) {
  return { off: Object.keys(table?.off ?? {}).length, makeup: Object.keys(table?.makeup ?? {}).length };
}

// 年份膠囊：當年；11 月起（或已經有下一年的表時）再加下一年。
// 沒有「上次檢查」：臺灣不連網，沒有檢查時間可報。
// 匯入的年份只寫「已匯入檔案」，不聲稱來源；舊版留下的線上表仍標成線上（資料確實來自當時的線上檢查）。
// kind：builtin／online／file／missing（畫面按 kind 上色）。
export function statusModelTw(now, tables, t) {
  const U = t.holidayUpdate;
  const y = now.getFullYear();
  const years = [y];
  if (now.getMonth() >= 10 || has(tables, y + 1)) years.push(y + 1);
  const chips = years.map((yr) => {
    const tb = has(tables, yr) ? tables[yr] : null;
    if (!tb) return { year: yr, kind: 'missing', text: U.missing(yr) };
    if (tb.source === 'builtin') return { year: yr, kind: 'builtin', text: U.builtin(yr) };
    return tb.source === 'file'
      ? { year: yr, kind: 'file', text: U.importedYear(yr) }
      : { year: yr, kind: 'online', text: U.online(yr) };
  });
  return { chips, lastCheck: null, lastCheckAt: null };
}

// 同一狀態的一行文字（測試與無障礙名稱用）
export function statusLineTw(now, tables, t) {
  const m = statusModelTw(now, tables, t);
  return m.chips.map((c) => c.text).join(t.holidayUpdate.sep);
}

// 解析失敗代碼 → 目前字典的文字。字典缺該代碼時退回 codeGeneric，不顯示 undefined。
export function reasonText(code, params, t) {
  const U = t?.holidayUpdate;
  const f = code && U?.codes ? U.codes[code] : null;
  if (typeof f === 'function') return f(params ?? {});
  if (typeof f === 'string' && f) return f;
  const g = U?.codeGeneric;
  if (typeof g === 'function') return g(code);
  return typeof g === 'string' ? g : '';
}

// 結果一律帶 { key, params }（面板按當前字典重譯）＋ text（沒有字典時的退路）。
// detail 的 params 放「失敗代碼規格」{ code, params }：面板會用當前字典的 codes 表重譯，
// 切語言後不會殘留發出當時那句翻譯（text 只是沒有字典時的退路）。
function detailSpec(code, params, t) {
  const reason = reasonText(code, params, t);
  return { key: 'detail', params: [{ code, params: params ?? null }], text: t.holidayUpdate.detail(reason) };
}

// ---- 流程編排 ----
// ctx: {
//   storage, clock,
//   onTables: (tables) => void,
//   onStatus: (status) => void,
//   getStrings?: () => 目前字典,
//   isCurrent?: () => boolean（目前地區仍是臺灣；切到中國後為 false）,
// }
// 呼叫端仍可能傳 fetchImpl／getTables／notify（中國版需要）：臺灣不連網、不發差異 banner，這裡一律不讀。
// status: { region:'TW', checking:false, line, status:{chips,lastCheck,lastCheckAt}, result, customUrl:null, customSummary:null }
// 臺灣沒有線上檢查，checking 恆為 false、lastCheck 恆為 null（面板據此隱藏檢查按鈕與提示列）。
// 臺灣沒有自訂資料網址：customUrl／customSummary 一律為 null，畫面必須隱藏該欄位。
export function startHolidayUpdateTw(ctx) {
  const current = () => ctx.isCurrent?.() !== false;
  const getT = () => ctx.getStrings?.() ?? TW_STRINGS;
  const { storage, clock, onTables, onStatus } = ctx;
  let gen = 0;
  const alive = (g) => g === gen && current();

  let result = null; // 存成 (t) => view：切換字典後重譯，不把已翻譯的文字留在狀態裡

  // 儲存失敗但仍要在本次會話生效的表：整頁共用（見檔頭 SESSION_TABLES），切地區重建流程物件也不會消失。
  const unsaved = sessionFor(storage);

  // 一年的簽章（來源＋寫入時間＋內容）。只用來判斷「寫入失敗之後，儲存是否被別人改過」，
  // 不比時鐘大小：同一個時鐘刻度（固定 clock、同一毫秒）也分得出是不是同一份資料。
  const entrySig = (tb, meta) => (tb
    ? `${tb.source}|${meta?.fetchedAt ?? ''}|${JSON.stringify(tb.off)}|${JSON.stringify(tb.makeup)}`
    : null);

  // 來源地區（臺灣）目前的表：內建 > 本次會話未存成功的表 > 儲存（含其他分頁）。
  // 內建優先於儲存的線上 / 匯入表，由 mergeTwTables 決定。會話補位按來源強弱與「儲存是否被別人改過」決定：
  //   1. 比儲存更強（檔案勝過舊版線上表）→ 一律用會話表，不管儲存後來變成什麼；
  //   2. 同強度（都是檔案）→ 只有儲存那一年仍是寫入失敗當下的同一份（簽章相同，別人沒寫過）才用會話表；
  //      別人後來成功寫入的一律以儲存為準，本頁存不進去的舊副本不得蓋回去，也不必比較時鐘（同一毫秒也分得出來）。
  const RANK = { builtin: 3, file: 2, online: 1 };
  const storedState = () => {
    const loaded = loadTwTables(storage);
    return { tables: loaded.tables ?? {}, meta: loaded.meta ?? {} };
  };
  // 第二次算出來的表，補位表依規則決定是否生效。生效的年份收進 inEffect（重畫時據此說明「只留在本頁」），
  // 確定永遠不會生效的（內建擋下、儲存更強、別的分頁已寫入同一年）就地清掉，免得切區後還被當成資料。
  function liveTablesFrom(stored, inEffect = null) {
    const out = mergeTwTables(TW_BUILTIN_TABLES, stored.tables);
    for (const [year, session] of [...unsaved]) {
      const cut = out[year];
      const mine = RANK[session.source] ?? 0;
      const theirs = RANK[cut?.source] ?? 0;
      const taken = cut?.source !== 'builtin' && mine >= theirs
        && !(mine === theirs && entrySig(stored.tables[year], stored.meta[year]) !== session.base);
      if (!taken) {
        unsaved.delete(year);
        continue;
      }
      out[year] = { off: session.off, makeup: session.makeup, source: session.source };
      if (inEffect) inEffect.push(year);
    }
    if (inEffect) inEffect.sort((a, b) => a - b);
    return out;
  }
  const liveTables = () => liveTablesFrom(storedState());

  // 只留在本頁的匯入（切回臺灣時原本那句結果已經不在）：重新說一次「這份表關掉就沒了」。
  // 沒有這種表就回 null，不佔用結果區。
  function sessionOnlySpec(tables, years, t, previous = null) {
    if (!years.length) return null;
    const V = t.holidayUpdate;
    const counts = years.reduce((a, y) => {
      const c = dayCountsTw(tables[y]);
      return { off: a.off + c.off, makeup: a.makeup + c.makeup };
    }, { off: 0, makeup: 0 });
    const skipped = previous?.detail?.key === 'sessionOnlySkipped' ? previous.detail.params : null;
    const detail = skipped && typeof V.sessionOnlySkipped === 'function'
      ? { key: 'sessionOnlySkipped', params: skipped, text: V.sessionOnlySkipped(...skipped) }
      : { key: 'sessionOnly', params: [], text: V.sessionOnly };
    return {
      tone: 'warn',
      key: 'importDone',
      params: [years, counts.off, counts.makeup],
      text: V.importDone(years, counts.off, counts.makeup),
      detail,
    };
  }

  function emit(g = gen) {
    if (!alive(g)) return;
    const t = getT();
    const now = clock();
    const inEffect = [];
    const tables = liveTablesFrom(storedState(), inEffect);
    const view = typeof result === 'function' ? result(t) : result;
    // 上一次匯入留下的「只留在本頁」說明不沿用：那句話連年份與天數一起記在 closure 裡，
    // 別的分頁寫入同一年或那份表被內建擋下後就過期了。每次重畫都依「現在真的還生效的會話表」重組一句，
    // 沒有這種表就整則收掉（回 null），不留誤導的舊訊息。
    const sessionDetail = view?.detail?.key === 'sessionOnly' || view?.detail?.key === 'sessionOnlySkipped';
    const kept = sessionDetail ? null : view;
    onStatus?.({
      region: 'TW',
      checking: false,
      line: statusLineTw(now, tables, t),
      status: statusModelTw(now, tables, t),
      result: kept ?? sessionOnlySpec(tables, inEffect, t, view),
      customUrl: null,
      customSummary: null,
    });
  }

  // 從儲存重新讀取內建＋（舊版留下的）線上／匯入的表（開頁、切回臺灣、跨日）；只讀不寫。
  // 換 generation：切區前開始的非同步工作完成後一律丟棄，不儲存、不通知、不更新當前表。
  function reload() {
    gen += 1;
    const g = gen;
    if (!current()) return;
    onTables?.(liveTables());
    emit(g);
  }

  // 同一地區的狀態刷新（其他分頁改了臺灣資料、字典／地區設定剛換過）：重新讀取儲存並回報狀態。
  // 不換 generation。
  function refresh() {
    if (!current()) return;
    onTables?.(liveTables());
    emit();
  }

  // source：匯入時為 FILE_SOURCE。內建年份永不覆蓋；舊版留下的線上表可被匯入取代。
  // 回傳 { applied, saved }：已採用（儲存失敗也先在本次會話生效）／是否真的寫進儲存。
  // 內容本身不合格（儲存層驗證不通過）時 applied 為 false 並帶 code／params——絕不把壞資料放進會話表。
  function apply(g, year, table, source, meta = {}) {
    if (!alive(g)) return { applied: false, saved: false, code: 'stale', params: null };
    const before = storedState();
    const cur = liveTablesFrom(before)[year];
    // 優先序只有一份定義（儲存模組的 mayReplaceTw）：內建永不被覆蓋。
    if (!mayReplaceTw(cur, source)) return { applied: false, saved: false, blocked: true, code: null, params: null };
    const base = entrySig(before.tables[year], before.meta[year]);
    const fetchedAt = meta.fetchedAt ?? clock().getTime();
    const res = saveTwYear(storage, year, {
      table,
      papers: meta.papers ?? [],
      source,
      fetchedAt,
    });
    if (res?.ok === false && res.reason === 'invalid') {
      const d = res.detail;
      return { applied: false, saved: false, code: d?.code ?? 'table', params: d?.date ? { date: d.date } : null };
    }
    const saved = res?.ok !== false;
    if (saved) unsaved.delete(year);
    else {
      // 記下「寫不進去時」儲存長什麼樣：之後只有儲存仍是同一份（別人沒寫過）時才用這份會話表。
      unsaved.set(year, { off: table.off, makeup: table.makeup, source, base });
    }
    onTables?.(liveTables()); // 重讀：儲存成功時就等於儲存內容，失敗時靠上面的會話補位
    return { applied: true, saved };
  }

  // 匯入官方 CSV（UTF-8／BOM、標準 CSV 引號與換行由 parseTwCsv 處理）。整份不合格即拒絕、保留原表。
  // 只採用到非內建的年份；全部被內建擋下時不採用任何資料並說明。
  // 讀檔端（面板）先自己驗大小與嚴格 UTF-8 解碼，失敗時傳 null 並用 failure 說明是哪一種：
  // 'tooLarge' 是「超過大小上限」，其他一律當「讀不到／不是 UTF-8 文字」。
  // 結果存成 (t) => 規格：切換字典／地區後重譯，不留下任何已翻譯的文字。
  function importFile(text, failure = null) {
    const g = gen;
    if (!current()) return { ok: false, code: 'stale' };
    const U = getT().holidayUpdate;
    const fail = (code, params, format = true) => {
      result = (tt) => {
        const V = tt.holidayUpdate;
        return {
          tone: 'warn',
          key: 'importFailed',
          params: [],
          text: V.importFailed,
          detail: detailSpec(code, params, tt),
          formatHelp: format,
          importHelp: true,
        };
      };
      emit(g);
      return { ok: false, code, params: params ?? null };
    };
    // 讀檔端已經失敗（null）：說清楚是「檔案過大」還是「讀不到／不是 UTF-8 文字」，
    // 兩種都給出匯入說明；只有內容層級的問題才展開格式範例。
    if (typeof text !== 'string') {
      return failure === 'tooLarge' ? fail('tooLarge', null, false) : fail('notText', null, false);
    }
    let parsed;
    try {
      parsed = parseTwCsv(text, { labels: { off: U.csvOff, makeup: U.csvMakeup } });
    } catch {
      return fail('notText', null);
    }
    if (!parsed || !parsed.ok) return fail(parsed?.code ?? 'notText', parsed?.params ?? null, parsed?.format !== false);

    const years = Array.isArray(parsed.years) ? parsed.years.filter((y) => Number.isInteger(y)).sort((a, b) => a - b) : [];
    if (!years.length) return fail('noYear', null);

    // 先驗證整份檔案再寫任何一年：多年度檔案只要有一年不合格，整份拒絕、原表全部不動
    // （不能先寫入前一年、後一年才失敗，留下半套資料）。內建年份本來就不採用，不參與驗證。
    const plan = [];
    const skipped = [];
    for (const year of years) {
      if (liveTables()[year]?.source === 'builtin') { skipped.push(year); continue; }
      const table = parsed.tables?.[String(year)] ?? parsed.tables?.[year];
      if (!isPlainObject(table) || !isPlainObject(table.off) || !isPlainObject(table.makeup)) {
        return fail('badRowShape', { year });
      }
      const v = validateTwTable(year, table);
      if (!v.ok) return fail(v.reason?.code ?? 'table', v.reason?.date ? { date: v.reason.date } : null);
      plan.push({ year, table: v.table });
    }

    const applied = [];
    let savedAll = true;
    for (const { year, table } of plan) {
      if (!alive(g)) return { ok: false, code: 'stale' };
      const taken = apply(g, year, table, FILE_SOURCE, { fetchedAt: clock().getTime() });
      if (!alive(g)) return { ok: false, code: 'stale' };
      if (!taken.applied) {
        if (taken.blocked) { skipped.push(year); continue; } // 期間冒出內建表：不覆蓋，只說明
        // 儲存層仍拒絕（讀不到儲存、紀錄損壞）：內容已驗證過，這裡只會是儲存側問題，原表不動
        return fail(taken.code ?? 'table', taken.params ?? null);
      }
      if (!taken.saved) savedAll = false;
      applied.push(year);
    }
    if (!applied.length) {
      result = (tt) => {
        const V = tt.holidayUpdate;
        const yearsText = skipped.join(V.listSep ?? '、');
        return { tone: 'muted', key: 'importBuiltin', params: [yearsText], text: V.importBuiltin(yearsText), detail: null };
      };
      emit(g);
      return { ok: true, years: [], skipped, saved: true };
    }
    const counts = applied.reduce((a, y) => {
      const c = dayCountsTw(liveTables()[y]);
      return { off: a.off + c.off, makeup: a.makeup + c.makeup };
    }, { off: 0, makeup: 0 });
    const doneYears = [...applied];
    const doneSkipped = [...skipped];
    // 匯入完成後仍要交代的事一次只顯示一句（面板只有一個 detail）：
    // 存不進儲存最要緊（關掉就沒了），被內建擋下的年份其次；兩者同時發生時用加法句一起講，
    // 不把其中一項吞掉。字典缺這句（切到別的字典）時退回只說儲存問題，絕不吐出 undefined。
    result = (tt) => {
      const V = tt.holidayUpdate;
      const skippedText = doneSkipped.length ? doneSkipped.join(V.listSep ?? '、') : null;
      const kept = !savedAll;
      const detail = kept
        ? (skippedText && typeof V.sessionOnlySkipped === 'function'
          ? { key: 'sessionOnlySkipped', params: [skippedText], text: V.sessionOnlySkipped(skippedText) }
          : { key: 'sessionOnly', params: [], text: V.sessionOnly })
        : (skippedText
          ? { key: 'importSkipped', params: [skippedText], text: V.importSkipped(skippedText) }
          : null);
      return {
        tone: kept ? 'warn' : 'success',
        key: 'importDone',
        params: [doneYears, counts.off, counts.makeup],
        text: V.importDone(doneYears, counts.off, counts.makeup),
        detail,
      };
    };
    emit(g);
    return { ok: true, years: applied, skipped, saved: savedAll };
  }

  emit();
  // 臺灣沒有自訂資料網址，也沒有線上檢查，所以刻意不提供 setCustomUrl／checkNow／autoCheckIfNeeded。
  return { importFile, reload, refresh };
}
