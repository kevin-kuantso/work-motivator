// 臺灣假期表：純函式（狀態膠囊、日期計數、失敗代碼文字）＋匯入編排（假 storage，完全不連網）。
// 臺灣沒有線上檢查（單一離線檔案抓官方資料集會被 CORS 擋下），所以這裡不注入 fetch，也不驗任何網路行為：
// 只驗證匯入契約——優先序、整份拒絕、切區丟棄、儲存失敗仍在本次會話生效。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  dayCountsTw, statusModelTw, statusLineTw, reasonText, startHolidayUpdateTw,
} from '../src/ui/holiday-update-tw.js';
import { TW_HOLIDAYS_STORAGE_KEY, loadTwTables } from '../src/holiday-store-tw.js';
import { TW_BUILTIN_YEARS } from '../src/holidays-tw.js';
import { STRINGS as t } from '../src/strings.zh-TW.js';

const U = t.holidayUpdate;
const HEADER = '西元日期,星期,是否放假,備註';
const WD = ['日', '一', '二', '三', '四', '五', '六'];

const memStore = (init = {}) => {
  const m = { ...init };
  return {
    getItem: (k) => (k in m ? m[k] : null),
    setItem: (k, v) => { m[k] = String(v); },
    m,
  };
};

// 產生一整年的官方格式 CSV（含 BOM 與 CRLF）。off 是 { 'YYYY-MM-DD': 節名 }。
function csv(year, { off = {}, status = () => '0', skip = null, duplicate = null, weekday = null } = {}) {
  const rows = [HEADER];
  const days = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 366 : 365;
  for (let i = 0; i < days; i += 1) {
    const d = new Date(Date.UTC(year, 0, 1 + i));
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
    if (key === skip) continue;
    const token = key === weekday?.date ? weekday.token : WD[d.getUTCDay()];
    const name = off[key] ?? '';
    const st = key in off ? '2' : status(key);
    rows.push(`${key.replaceAll('-', '')},${token},${st},${name}`);
    if (key === duplicate) rows.push(`${key.replaceAll('-', '')},${token},${st},${name}`);
  }
  return `\uFEFF${rows.join('\r\n')}\r\n`;
}

// 呼叫端仍會傳中國版需要的鍵（fetchImpl／getTables／notify）：臺灣版必須完全不去碰它們，
// 所以測試也照樣傳，並在需要時斷言「沒有任何網路呼叫」。
const ctxOf = (over = {}) => {
  const storage = over.storage ?? memStore();
  const statuses = [];
  const notices = [];
  const tables = [];
  const fetches = [];
  const state = { tables: over.tables ?? {}, now: over.now ?? new Date('2026-11-10T03:00:00Z'), current: true };
  const api = startHolidayUpdateTw({
    storage,
    clock: () => state.now,
    fetchImpl: (...a) => { fetches.push(a); throw new Error('臺灣版不該連網'); },
    getTables: () => state.tables,
    onTables: (next) => { state.tables = next; tables.push(next); },
    notify: (msg, kind, against) => notices.push({ msg, kind, against }),
    onStatus: (s) => statuses.push(s),
    getStrings: () => t,
    isCurrent: () => state.current,
  });
  return { api, storage, statuses, notices, state, tables, fetches };
};

// ---- 純函式 ----
test('statusModelTw: 內建／線上／匯入／缺表四種膠囊，11 月起含下一年，且沒有「上次檢查」', () => {
  const tables = { 2026: { off: {}, makeup: {}, source: 'builtin' }, 2027: { off: {}, makeup: { '2027-02-11': '補班' }, source: 'file' } };
  const m = statusModelTw(new Date('2026-11-10T12:00:00Z'), tables, t);
  assert.deepEqual(m.chips.map((c) => c.kind), ['builtin', 'file']);
  assert.equal(m.chips[0].text, U.builtin(2026));
  assert.equal(m.chips[1].text, U.importedYear(2027));
  // 臺灣不連網，沒有檢查時間可報：兩個欄位都必須是 null，面板才不會顯示假的「上次檢查」
  assert.equal(m.lastCheck, null);
  assert.equal(m.lastCheckAt, null);
  assert.equal(statusLineTw(new Date('2026-11-10T12:00:00Z'), tables, t), [U.builtin(2026), U.importedYear(2027)].join(U.sep));
  // 10 月以前只看當年；沒有表就是缺表
  const early = statusModelTw(new Date('2026-03-02T12:00:00Z'), {}, t);
  assert.deepEqual(early.chips.map((c) => c.kind), ['missing']);
  assert.deepEqual(early.chips.map((c) => c.year), [2026]);
  // 舊版程式存下來的線上表仍標成線上（資料確實來自當時的線上檢查），不聲稱是匯入的檔案
  assert.equal(statusModelTw(new Date('2026-03-02T12:00:00Z'), { 2026: { source: 'online' } }, t).chips[0].text, U.online(2026));
  // 11 月起即使下一年沒有表也要列出（提醒使用者該匯入了）
  assert.deepEqual(statusModelTw(new Date('2026-11-05T12:00:00Z'), {}, t).chips.map((c) => c.year), [2026, 2027]);
});

test('dayCountsTw：只數日期，不數節名', () => {
  assert.deepEqual(dayCountsTw({ off: { a: 1 }, makeup: { b: 2, c: 3 } }), { off: 1, makeup: 2 });
  assert.deepEqual(dayCountsTw({ off: {}, makeup: {} }), { off: 0, makeup: 0 });
  assert.deepEqual(dayCountsTw(undefined), { off: 0, makeup: 0 });
});

test('reasonText：字串／函式／物件參數與未知代碼都有話可說，絕不回 undefined', () => {
  assert.equal(reasonText('http', { status: 503 }, t), U.codes.http({ status: 503 }));
  assert.equal(reasonText('http', 503, t), U.codes.http({ status: 503 }));
  assert.equal(reasonText('badWeekday', { date: '2026-01-03' }, t), U.codes.badWeekday({ date: '2026-01-03' }));
  assert.equal(reasonText('noSuchCode', null, t), U.codeGeneric('noSuchCode'));
  assert.equal(reasonText(null, null, t), U.codeGeneric(null));
  // 字典沒有這張表時退回空字串，不吐 undefined（呼叫端會改用 text 退路）
  assert.equal(reasonText('badDay', null, {}), '');
});

// ---- 匯入 ----
test('匯入官方 CSV：非內建年份存成 file，內建年份只說明不採用', () => {
  const { api, storage, statuses, fetches, notices } = ctxOf();
  const year = TW_BUILTIN_YEARS[0];
  const r = api.importFile(csv(year, { off: { [`${year}-01-01`]: '開國紀念日' } }));
  assert.equal(r.ok, true);
  assert.deepEqual(r.years, []);
  assert.deepEqual(r.skipped, [year], '內建年份不可被檔案覆蓋');
  assert.equal(storage.getItem(TW_HOLIDAYS_STORAGE_KEY), null, '內建年份不寫入儲存');
  assert.match(statuses.at(-1).result.text, /已內建/);

  const other = 2029;
  const r2 = api.importFile(csv(other, { off: { [`${other}-01-01`]: '開國紀念日', [`${other}-02-28`]: '和平紀念日' } }));
  assert.deepEqual(r2, { ok: true, years: [other], skipped: [], saved: true });
  const stored = loadTwTables(storage).tables;
  assert.equal(stored[other].source, 'file');
  assert.equal(stored[other].off[`${other}-02-28`], '和平紀念日');
  assert.match(statuses.at(-1).result.text, /已匯入/);
  assert.equal(fetches.length, 0, '匯入不得連網');
  assert.equal(notices.length, 0, '臺灣沒有差異 banner 可發');
});

test('匯入不合格的 CSV：整份拒絕，儲存原封不動，結果說明原因並展開範例', () => {
  const { api, storage, statuses } = ctxOf();
  const year = 2029;
  assert.equal(api.importFile(csv(year, { off: { [`${year}-01-01`]: '開國紀念日' } })).ok, true);
  const before = storage.getItem(TW_HOLIDAYS_STORAGE_KEY);

  for (const bad of [
    csv(year, { off: { [`${year}-01-01`]: '開國紀念日' }, skip: `${year}-07-04` }), // 缺日
    csv(year, { off: { [`${year}-01-01`]: '開國紀念日' }, duplicate: `${year}-05-05` }), // 重複
    csv(year, { off: { [`${year}-01-01`]: '開國紀念日' }, status: (k) => (k === `${year}-06-06` ? '1' : '0') }), // 未知狀態
    csv(year, { off: { [`${year}-01-01`]: '開國紀念日' }, weekday: { date: `${year}-03-05`, token: '六' } }), // 星期不符
    'not a csv', '', '\uFEFF西元日期,星期,是否放假,備註\r\n',
  ]) {
    const r = api.importFile(bad);
    assert.equal(r.ok, false, JSON.stringify(bad.slice(0, 40)));
    assert.equal(typeof r.code, 'string');
    assert.equal(storage.getItem(TW_HOLIDAYS_STORAGE_KEY), before, '壞檔案不得改動任何一年');
    const view = statuses.at(-1).result;
    assert.equal(view.tone, 'warn');
    assert.equal(view.key, 'importFailed');
    assert.equal(view.importHelp, true, '每一種失敗都要給下一步（匯入官方 CSV）');
    assert.equal(typeof view.detail.text, 'string');
  }
  // 內容層級的問題（漏日、重複、未知狀態、星期不符、不是 CSV）才展開格式範例；
  // 只有標題沒有資料列時是「找不到年度」，不必展開整份範例。
  assert.equal(api.importFile(csv(year, { off: { [`${year}-01-01`]: '開國紀念日' }, skip: `${year}-07-04` })).format, undefined);
  assert.equal(statuses.at(-1).result.formatHelp, true);
  assert.equal(api.importFile('not a csv').code, 'notCsv');
  assert.equal(statuses.at(-1).result.formatHelp, true);
  assert.equal(api.importFile(`\uFEFF${HEADER}\r\n`).code, 'noYear');
  assert.equal(statuses.at(-1).result.formatHelp, false);
  // 換一份字典呼叫同一個 detail：拿到的是新字典的文字（面板切語言後靠這段 params 重譯）
  api.importFile(csv(year, { off: { [`${year}-01-01`]: '開國紀念日' }, skip: `${year}-07-04` }));
  const spec = statuses.at(-1).result;
  assert.equal(spec.detail.key, 'detail');
  assert.deepEqual(spec.detail.params, [{ code: 'missingDay', params: { date: '2029-07-04' } }]);
  assert.equal(spec.detail.text, U.detail(U.codes.missingDay({ date: '2029-07-04' })));
  assert.equal(reasonText('missingDay', { date: '2029-07-04' }, t), U.codes.missingDay({ date: '2029-07-04' }));
});

test('匯入：舊版留下的線上表可被檔案替換（仍照常載入，只是不能再抓）', () => {
  const { api, storage, fetches } = ctxOf();
  const year = 2029;
  // 先手動塞一張線上表（模擬舊版程式從網路取得、已存在使用者瀏覽器裡）
  storage.setItem(TW_HOLIDAYS_STORAGE_KEY, JSON.stringify({
    version: 1,
    lastCheck: Date.parse('2026-02-01T00:00:00Z'),
    years: {
      [year]: {
        table: { off: { [`${year}-01-01`]: '開國紀念日' }, makeup: {} },
        source: 'https://www.dgpa.gov.tw/x.csv',
        fetchedAt: 1,
      },
    },
  }));
  // 開頁就讀得到（不被清掉），狀態標成線上
  api.reload();
  assert.equal(loadTwTables(storage).tables[year].source, 'online');
  assert.equal(fetches.length, 0);
  // 匯入同一年：檔案優先，蓋過線上表
  assert.equal(api.importFile(csv(year, { off: { [`${year}-01-01`]: '元旦', [`${year}-10-10`]: '國慶日' } })).ok, true);
  assert.equal(loadTwTables(storage).tables[year].source, 'file', '檔案可替換線上表');
  assert.equal(fetches.length, 0, '整段流程都不得連網');
});

test('匯入多年度檔案：任一年不合格就整份拒絕，不會留下半套資料', () => {
  const { api, storage } = ctxOf();
  const rows = [
    csv(2028, { off: { '2028-01-03': '假日' } }).replace(/^\uFEFF/, '').split('\r\n').filter(Boolean),
    csv(2029, { off: { '2029-01-03': '假日' }, skip: '2029-09-09' }).replace(/^\uFEFF/, '').split('\r\n').filter(Boolean).slice(1),
  ];
  const bad = `\uFEFF${rows.flat().join('\r\n')}\r\n`;
  const r = api.importFile(bad);
  assert.equal(r.ok, false, '後一年缺日 → 整份拒絕');
  assert.equal(storage.getItem(TW_HOLIDAYS_STORAGE_KEY), null, '前一年也不得先寫進去');
});

test('儲存失敗（quota／讀不到）：本次會話仍生效並通知 onTables，回報 saved:false 且結果改警示', () => {
  const storage = {
    getItem: () => { throw new Error('denied'); },
    setItem: () => { throw new Error('denied'); },
  };
  const seen = [];
  const statuses = [];
  const api = startHolidayUpdateTw({
    storage,
    clock: () => new Date('2026-11-10T00:00:00Z'),
    onTables: (next) => seen.push(next),
    onStatus: (s) => statuses.push(s),
    getStrings: () => t,
    isCurrent: () => true,
  });
  const year = 2029;
  const r = api.importFile(csv(year, { off: { [`${year}-01-01`]: '開國紀念日' } }));
  assert.equal(r.ok, true);
  assert.equal(r.saved, false, '寫不進儲存要說真話');
  assert.deepEqual(r.years, [year], '但本次會話仍可用');
  assert.equal(seen.at(-1)?.[year]?.source, 'file');
  // 使用者必須看得到「只留在這個頁面」：結果改成警示，並附上說明（不是只說「已匯入」）
  const view = statuses.at(-1)?.result ?? null;
  assert.ok(view, '要有可見的結果');
  assert.equal(view.tone, 'warn');
  assert.equal(view.key, 'importDone');
  assert.equal(view.detail?.key, 'sessionOnly');
  assert.equal(view.detail.text, U.sessionOnly);
  // 讀不到儲存也不能讓狀態查詢爆掉
  assert.doesNotThrow(() => api.refresh());
  assert.equal(statuses.at(-1).result.detail.key, 'sessionOnly', '重畫後仍是同一則警示');
});

test('多年度匯入儲存失敗時，同時說明只留本頁及內建年份未覆蓋', () => {
  const storage = { getItem: () => null, setItem: () => { throw new Error('denied'); } };
  const { api, statuses } = ctxOf({ storage });
  const text = csv(2026, { off: { '2026-01-01': '元旦' } })
    + csv(2029, { off: { '2029-01-01': '元旦' } }).split('\r\n').slice(1).join('\r\n');
  const result = api.importFile(text);
  assert.deepEqual(result.skipped, [2026]);
  assert.deepEqual(result.years, [2029]);
  assert.equal(result.saved, false);
  const detail = statuses.at(-1).result.detail;
  assert.equal(detail.key, 'sessionOnlySkipped');
  assert.equal(detail.text, U.sessionOnlySkipped('2026'));
});

test('紀錄損壞：不覆寫原始位元組，本次會話仍可用並說明只留在頁面', () => {
  const raw = '{壞掉的 JSON';
  const storage = memStore({ [TW_HOLIDAYS_STORAGE_KEY]: raw });
  const { api, statuses } = ctxOf({ storage });
  const year = 2029;
  const r = api.importFile(csv(year, { off: { [`${year}-01-01`]: '開國紀念日' } }));
  assert.equal(r.ok, true);
  assert.equal(r.saved, false);
  assert.equal(storage.getItem(TW_HOLIDAYS_STORAGE_KEY), raw, '損壞的紀錄原封不動');
  assert.equal(statuses.at(-1).result.detail.key, 'sessionOnly');
});

// 本次會話的補位表只在「儲存裡那一年仍是寫不進去當下的樣子」時有效：
// 其他分頁之後成功寫入同一年（即使時間戳相同、甚至時鐘固定不動）一律以儲存為準。
test('會話補位只在儲存沒被改過時有效：其他分頁寫入同一年（同一時鐘刻度）就以儲存為準', () => {
  const deny = { on: true };
  const mem = memStore();
  const storage = {
    getItem: mem.getItem,
    setItem: (k, v) => {
      if (deny.on) throw new Error('quota');
      mem.m[k] = String(v);
    },
    m: mem.m,
  };
  const year = 2029;
  const seen = [];
  const api = startHolidayUpdateTw({
    storage,
    // 時鐘固定在同一個刻度：補位不能靠「時間比較」判斷新舊，否則同一毫秒就分不出來
    clock: () => new Date('2026-11-10T03:00:00Z'),
    onTables: (next) => seen.push(next),
    onStatus: () => {},
    getStrings: () => t,
    isCurrent: () => true,
  });
  const day = `${year}-01-01`;
  const stored = (name, fetchedAt, source = 'file') => JSON.stringify({
    version: 1,
    lastCheck: null,
    years: { [year]: { table: { off: { [day]: name }, makeup: {} }, source, fetchedAt } },
  });

  // 本頁匯入（存不進去，只在本次會話生效）
  assert.equal(api.importFile(csv(year, { off: { [day]: '本頁' } })).saved, false);
  assert.equal(seen.at(-1)[year].off[day], '本頁');

  // 儲存沒變 → 重畫（跨分頁 storage 事件、字典／地區重繪）仍看得到本頁的會話表
  api.refresh();
  assert.equal(seen.at(-1)[year].off[day], '本頁', '儲存原封不動時，會話表不得被自己清掉');

  // 其他分頁寫入同一年：時間戳與本頁寫不進去的那一刻完全相同，仍必須以儲存為準
  deny.on = false;
  storage.m[TW_HOLIDAYS_STORAGE_KEY] = stored('別頁', Date.parse('2026-11-10T03:00:00Z'));
  api.refresh();
  assert.equal(seen.at(-1)[year].off[day], '別頁', '同一時鐘刻度也分得出儲存被改過，較新的成功寫入勝出');

  // 之後本頁再匯入（又存不進去），儲存的內容仍是最新的：不能再被本頁的舊副本蓋回去
  deny.on = true;
  assert.equal(api.importFile(csv(year, { off: { [day]: '本頁第二次' } })).saved, false);
  storage.m[TW_HOLIDAYS_STORAGE_KEY] = stored('別頁更新', Date.parse('2026-11-10T03:00:00Z'));
  api.refresh();
  assert.equal(seen.at(-1)[year].off[day], '別頁更新');

  // 儲存裡只是舊版的線上表（較弱來源）：本頁存不進去的檔案仍優先，且來源標成匯入
  storage.m[TW_HOLIDAYS_STORAGE_KEY] = stored('線上舊資料', 1, 'https://www.dgpa.gov.tw/x.csv');
  assert.equal(api.importFile(csv(year, { off: { [day]: '本頁檔案' } })).saved, false);
  assert.equal(seen.at(-1)[year].off[day], '本頁檔案');
  assert.equal(seen.at(-1)[year].source, 'file', '會話表也帶著自己的來源，不能聲稱是線上資料');
});

test('匯入的檔案不是文字（讀檔端失敗）也要說得出下一步：tooLarge／notText', () => {
  const { api, storage, statuses } = ctxOf();
  const before = storage.getItem(TW_HOLIDAYS_STORAGE_KEY);
  // 面板先驗大小：超限時傳 null + 'tooLarge'
  const big = api.importFile(null, 'tooLarge');
  assert.equal(big.ok, false);
  assert.equal(big.code, 'tooLarge');
  let view = statuses.at(-1).result;
  assert.equal(view.key, 'importFailed');
  assert.equal(view.tone, 'warn');
  assert.deepEqual(view.detail.params, [{ code: 'tooLarge', params: null }]);
  assert.equal(view.detail.text, U.detail(U.codes.tooLarge));
  assert.equal(view.importHelp, true, '要給出可用的下一步（匯入官方 CSV）');
  assert.equal(view.formatHelp, false, '檔案根本沒讀進來，不必展開格式範例');

  // 解碼失敗（不是 UTF-8）或型別不對：一律 notText，也要有原因與匯入說明
  for (const [text, failure] of [[null, undefined], [null, null], [42, null], [{}, 'x']]) {
    const r = api.importFile(text, failure);
    assert.equal(r.ok, false);
    view = statuses.at(-1).result;
    assert.equal(view.detail.params[0].code, 'notText');
    assert.equal(view.detail.text, U.detail(U.codes.notText));
    assert.equal(view.importHelp, true);
  }
  assert.equal(storage.getItem(TW_HOLIDAYS_STORAGE_KEY), before, '讀不到檔案不得動到儲存');
});

// 官方 CSV 的備註可以用引號包住跨行內容（人事總處的檔案就有這種情況）。
// 匯入要接受、原樣保留 LF，而且重新載入（新實例讀同一份儲存）仍拿得到同一句。
test('匯入含跨行引號備註的官方 CSV：接受並保留換行，重新載入仍在', () => {
  const year = 2029;
  const day = `${year}-01-02`;
  const remark = '開國紀念日\n連續放假';
  const token = WD[new Date(Date.UTC(year, 0, 2)).getUTCDay()];
  const base = csv(year, { off: { [day]: '開國紀念日' } });
  const text = base.replace(
    `${day.replaceAll('-', '')},${token},2,開國紀念日`,
    `${day.replaceAll('-', '')},${token},2,"${remark}"`,
  );
  assert.ok(text.includes('"開國紀念日\n連續放假"'), '測試資料本身要有跨行引號欄位');

  const { api, storage, statuses } = ctxOf();
  const r = api.importFile(text);
  assert.deepEqual(r, { ok: true, years: [year], skipped: [], saved: true });
  assert.equal(statuses.at(-1).result.tone, 'success');

  const stored = loadTwTables(storage).tables;
  assert.equal(stored[year].source, 'file');
  assert.equal(stored[year].off[day], remark, '跨行備註原樣保留（LF，不多也不少）');

  // 重新載入（另一個實例、同一份儲存）：讀回來的仍是同一句跨行備註
  const reloaded = ctxOf({ storage });
  reloaded.api.reload();
  assert.equal(reloaded.state.tables[year]?.source, 'file');
  assert.equal(reloaded.state.tables[year].off[day], remark, '重新載入後換行原樣保留');
  // 儲存內容本身也是 LF（不是 CRLF、也不是被壓成空白）
  assert.equal(JSON.parse(storage.getItem(TW_HOLIDAYS_STORAGE_KEY)).years[year].table.off[day], remark);
});

// ---- 地區切換與跨分頁 ----
test('匯入期間切到中國：不寫入、不相關的狀態也不更新', () => {
  const { api, storage, statuses, state } = ctxOf();
  state.current = false; // 已經切到 CN
  const mark = statuses.length;
  const r = api.importFile(csv(2029, { off: { '2029-01-01': '開國紀念日' } }));
  assert.deepEqual(r, { ok: false, code: 'stale' });
  assert.equal(storage.getItem(TW_HOLIDAYS_STORAGE_KEY), null, '切區後不得寫入臺灣的鍵');
  assert.equal(statuses.length, mark, '切區後不得更新當前的臺灣狀態');
});

test('reload：換 generation 並重讀儲存；切回臺灣時才回報狀態', () => {
  const storage = memStore({
    [TW_HOLIDAYS_STORAGE_KEY]: JSON.stringify({
      version: 1,
      lastCheck: null,
      years: { 2029: { table: { off: { '2029-01-01': '開國紀念日' }, makeup: {} }, source: 'file', fetchedAt: 1 } },
    }),
  });
  const { api, statuses, state } = ctxOf({ storage });
  api.reload();
  assert.equal(state.tables[2029]?.source, 'file', 'reload 重讀儲存並交給 onTables');
  assert.equal(statuses.at(-1).status.chips[0].kind, 'builtin');

  // 切到中國：reload 不碰 DOM、不發狀態；切回來再 reload 才恢復
  state.current = false;
  const mark = statuses.length;
  api.reload();
  assert.equal(statuses.length, mark);
  state.current = true;
  api.reload();
  assert.equal(statuses.length, mark + 1);
});

test('refresh：其他分頁匯入後同步，且不換 generation（同一地區的狀態刷新）', () => {
  const { api, storage, statuses, state } = ctxOf();
  api.reload();
  // 其他分頁寫入了 2029 年
  storage.setItem(TW_HOLIDAYS_STORAGE_KEY, JSON.stringify({
    version: 1,
    lastCheck: null,
    years: { 2029: { table: { off: { '2029-01-01': '開國紀念日' }, makeup: {} }, source: 'file', fetchedAt: 1 } },
  }));
  api.refresh();
  assert.equal(state.tables[2029]?.source, 'file', '跨分頁的匯入要讀進來');
  assert.equal(statuses.at(-1).status.chips[0].kind, 'builtin');
  // refresh 之後仍可正常匯入（generation 沒被換掉，不會誤丟自己的工作）
  assert.equal(api.importFile(csv(2030, { off: { '2030-01-01': '開國紀念日' } })).ok, true);
  assert.equal(loadTwTables(storage).tables[2030].source, 'file');
});

// ---- 對外契約 ----
test('對外只提供 importFile／reload／refresh：沒有線上檢查、沒有自訂網址', () => {
  const { api } = ctxOf();
  assert.deepEqual(Object.keys(api).sort(), ['importFile', 'refresh', 'reload']);
  assert.equal(api.checkNow, undefined, '臺灣不連網，沒有手動檢查');
  assert.equal(api.autoCheckIfNeeded, undefined, '臺灣不自動更新');
  assert.equal(api.setCustomUrl, undefined, '臺灣沒有自訂資料網址');
});

test('狀態物件：checking 恆為 false、lastCheck 恆為 null、customUrl 恆為 null（面板據此隱藏檢查列）', () => {
  const { api, statuses } = ctxOf();
  api.refresh();
  const s = statuses.at(-1);
  assert.equal(s.region, 'TW');
  assert.equal(s.checking, false);
  assert.equal(s.status.lastCheck, null);
  assert.equal(s.status.lastCheckAt, null);
  assert.equal(s.customUrl, null);
  assert.equal(s.customSummary, null);
  assert.equal(typeof s.line, 'string');
  assert.ok(Array.isArray(s.status.chips) && s.status.chips.length >= 1);
});

// ---- 存不進儲存的匯入表：整頁生命週期（切到中國再切回臺灣仍在） ----
// app 在切換地區時會重建臺灣的流程物件；補位表因此不能放在實例裡，否則切回臺灣就整份消失，
// 但使用者的檔案明明在這次開頁時匯入過（而且儲存真的寫不進去）。這裡用「兩個實例共用同一份 storage」
// 模擬一次切區往返。任何時候都不得改寫儲存的原始位元組。
test('儲存失敗的匯入切到中國、切回臺灣仍然有效，並重新說明只留在本頁', () => {
  const writes = [];
  const storage = {
    getItem: () => null,
    setItem: (k, v) => { writes.push([k, v]); throw new Error('quota'); },
  };
  const year = 2029;
  const day = `${year}-01-01`;

  const first = ctxOf({ storage });
  first.api.reload();
  assert.equal(first.api.importFile(csv(year, { off: { [day]: '開國紀念日' } })).saved, false);
  assert.equal(first.state.tables[year]?.source, 'file');
  const counts = dayCountsTw(first.state.tables[year]);

  // 切到中國：舊實例的 generation 作廢，什麼都不能做
  first.state.current = false;
  const marks = first.statuses.length;
  first.api.reload();
  first.api.refresh();
  assert.equal(first.statuses.length, marks, '切區後舊實例不得更新狀態');
  assert.deepEqual(first.api.importFile(csv(2030, { off: { '2030-01-01': '假日' } })), { ok: false, code: 'stale' });

  // 切回臺灣：全新實例、同一份儲存（模擬 app 重建流程物件）
  const back = ctxOf({ storage });
  back.api.reload();
  assert.equal(back.state.tables[year]?.source, 'file', '切回臺灣時會話表仍在');
  assert.equal(back.state.tables[year].off[day], '開國紀念日');
  const view = back.statuses.at(-1)?.result;
  assert.ok(view, '重新載入後結果區不能空著');
  assert.equal(view.tone, 'warn');
  assert.equal(view.key, 'importDone');
  assert.deepEqual(view.params, [[year], counts.off, counts.makeup]);
  assert.equal(view.text, U.importDone([year], counts.off, counts.makeup));
  assert.equal(view.detail?.key, 'sessionOnly', '要再說一次「這份表關掉就沒了」');
  assert.equal(view.detail.text, U.sessionOnly);

  // 再往返一次也還在（每次開頁都存不進去，就每次都不該消失）
  back.state.current = false;
  const again = ctxOf({ storage });
  again.api.reload();
  assert.equal(again.state.tables[year]?.off[day], '開國紀念日');
  assert.equal(again.statuses.at(-1).result.detail.key, 'sessionOnly');
  assert.ok(writes.length >= 1, '匯入時真的試過寫入（失敗）');
  assert.deepEqual([...new Set(writes.map(([k]) => k))], [TW_HOLIDAYS_STORAGE_KEY]);
});

test('會話表已經不可能生效時就清掉：別的分頁成功寫入同一年後，切區往返不得讓舊副本復活', () => {
  const deny = { on: true };
  const mem = memStore();
  const storage = {
    getItem: mem.getItem,
    setItem: (k, v) => { if (deny.on) throw new Error('quota'); mem.m[k] = String(v); },
    m: mem.m,
  };
  const year = 2029;
  const day = `${year}-01-01`;

  const first = ctxOf({ storage });
  assert.equal(first.api.importFile(csv(year, { off: { [day]: '本頁' } })).saved, false);
  assert.equal(first.statuses.at(-1).result.detail.key, 'sessionOnly', '存不進去時先說清楚只留在本頁');
  // 其他分頁成功寫入同一年（同強度、不同內容）：依規則以儲存為準
  storage.m[TW_HOLIDAYS_STORAGE_KEY] = JSON.stringify({
    version: 1,
    lastCheck: null,
    years: { [year]: { table: { off: { [day]: '別頁' }, makeup: {} }, source: 'file', fetchedAt: 1 } },
  });
  first.api.refresh();
  assert.equal(first.state.tables[year].off[day], '別頁');
  // 同一個實例：那句話不能繼續掛在結果區（會話表已清除，這裡沒有任何只留在本頁的資料）
  const live = first.statuses.at(-1).result;
  assert.notEqual(live?.detail?.key, 'sessionOnly', '別人寫進儲存後就不再是「只留在本頁」');
  assert.equal(live, null, '那一次匯入的結果也一併換掉，不留誤導的舊訊息');

  // 切區往返：清掉的補位表不得復活成「本頁」；儲存裡的成功寫入勝出
  first.state.current = false;
  deny.on = false;
  const back = ctxOf({ storage });
  back.api.reload();
  assert.equal(back.state.tables[year].off[day], '別頁');
  assert.equal(back.statuses.at(-1).result, null, '沒有只留在本頁的表時，結果區不該再留一則警示');
});

test('內建年份的補位一律無效：匯入內建年份不會留下會話表，切區往返也沒有殘留', () => {
  const storage = { getItem: () => null, setItem: () => { throw new Error('quota'); } };
  const year = TW_BUILTIN_YEARS[0];
  const first = ctxOf({ storage });
  const r = first.api.importFile(csv(year, { off: { [`${year}-01-01`]: '開國紀念日' } }));
  assert.deepEqual(r.years, [], '內建年份不可被檔案覆蓋');
  const back = ctxOf({ storage });
  back.api.reload();
  assert.equal(back.state.tables[year]?.source, 'builtin', '切回臺灣仍是內建表');
  assert.equal(back.statuses.at(-1).result, null);
});

test('寫得進儲存時以儲存為準：會話補位立刻移除，切區往返不會蓋掉較新的儲存', () => {
  const storage = memStore();
  const year = 2029;
  const day = `${year}-01-01`;
  const first = ctxOf({ storage });
  assert.equal(first.api.importFile(csv(year, { off: { [day]: '開國紀念日' } })).saved, true);
  assert.equal(first.statuses.at(-1).result.detail, null, '存成功就不該說「只留在本頁」');

  const back = ctxOf({ storage });
  back.api.reload();
  assert.equal(back.state.tables[year].off[day], '開國紀念日');
  assert.equal(back.state.tables[year].source, 'file');
  assert.equal(back.statuses.at(-1).result, null);
});
