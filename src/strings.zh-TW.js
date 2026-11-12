// 全部介面文案（臺灣繁體，臺灣用語）。其他來源檔不得寫死介面文案。
// 本檔與 strings.zh-CN.js 的 key 與函式簽名一一對應（同層級、同 arity）；
// 臺灣專屬的補充文案放在 additive key（不改變 CN 既有 key 的形狀）。
export const STRINGS = {
  locale: 'zh-TW',
  appTitle: '上班鼓勵器',

  header: {
    float: '懸浮成小窗',
  },

  // 右側分頁
  tabs: {
    label: '主要內容',
    calendar: '月曆',
    settings: '基本設定',
  },

  // 懸浮小窗（Document PiP）
  float: {
    recall: '收回小窗',
    placeholder: '已懸浮 · 點此收回',
    unsupported: '目前瀏覽器不支援懸浮小窗，請使用 Edge 或 Chrome（116 以上）',
    placeholderNote: '狀態卡正顯示在懸浮小窗裡',
    keepOpen: '請保持本頁開啟：關閉本頁，小窗也會一起關閉',
    failed: '小窗沒能開啟，請再試一次',
    sizeLimited: '小窗沒能自動調大（瀏覽器不允許程式改視窗大小）：內容可能要捲動才能看全，請手動把視窗調大',
  },

  // 頁面被瀏覽器暫停（背景節流、凍結、休眠）後恢復：數字會一下子按目前時間跳過去（R34）
  notice: {
    paused: '頁面剛才被瀏覽器暫停了一段時間，數字已按目前時間校正',
  },

  // 國定假日名稱（與 CN 字典同一組 key；臺灣年表使用官方 CSV 的節名，不由這裡寫死）
  holidays: {
    newYear: '開國紀念日', spring: '春節', qingming: '清明節', labour: '勞動節',
    dragonBoat: '端午節', midAutumn: '中秋節', national: '國慶日',
  },

  // 驗證原因（calc.js / settings.js 引用；使用者看得懂的描述，不出現欄位鍵名或列舉值）
  reasons: {
    salary: '月薪必須是大於 0 的數字',
    timeFormat: (label) => `${label}格式不正確，應為 24 小時制的「時:分」，例如 08:30`,
    endAfterStart: '下班時間必須晚於上班時間',
    lunchInShift: (label) => `${label}必須在上下班時間之間`,
    lunchOrder: '午休開始時間必須早於午休結束時間',
    switchValue: (label) => `${label}只能是開或關`,
    payday: '發薪日必須是 1 到 31 之間的整數，或不設定',
    theme: '請選擇支援的主題色',
    fontScale: '字級只能是 XS、S、M、L、XL 其中之一',
    cheerType: '鼓勵語格式不正確',
    cheerTooLong: '鼓勵語不能超過 40 個字',
    marksType: '月曆標記的格式不正確',
    markDate: '日期格式不正確',
    markNotReal: '不是真實存在的日期',
    markValue: '標記類型無法辨識',
    // 匯入備份：說人話，不出現檔案格式名
    notJson: '這不是本工具匯出的備份檔案',
    notObject: '檔案內容的結構不正確',
    // 地區與月薪分區的結構問題：各自說清楚是哪一段不對，避免全部退回「結構不正確」
    region: '地區代碼無法辨識，只接受臺灣（TW）與中國大陸（CN），該欄已略過、保留原本的值',
    salariesType: '各地區月薪的資料結構不正確，應為臺灣與中國大陸各自的月薪數字，已保留原本的月薪',
    futureVersion: '這份備份來自較新版本的上班鼓勵器，無法讀入；請改用該版本開啟，或先更新本程式再匯入',
    labels: {
      start: '上班時間', end: '下班時間', lunchStart: '午休開始時間', lunchEnd: '午休結束時間',
      lunchOn: '午休開關', weekends: '週末上班', showLunar: '顯示農曆',
      fontScale: '字級',
      showCardProgress: '顯示進度條', showCardMetrics: '顯示薪資明細', showCardDate: '顯示日期',
      showCardPayday: '顯示發薪提醒', showCardCheer: '顯示鼓勵文字',
    },
  },

  // 線上取得假日資料的驗證原因 / 抓取結果（CN 資料來源的驗證路徑；臺灣走 holidayUpdate.codes）
  holidayData: {
    notObject: '假日資料的結構不正確',
    yearMismatch: (year) => `假日資料不是 ${year} 年的`,
    papersMissing: '假日資料缺少國務院放假通知的出處',
    papersBad: '假日資料的出處不是國務院官網（www.gov.cn）的連結',
    daysEmpty: '該年度的假日資料尚未發布',
    dayShape: '假日資料中有格式不正確的日期項目',
    dayName: '假日資料中有節日名稱為空或過長',
    dayDate: '假日資料中有日期格式不正確',
    dayNotReal: '假日資料中有不是真實存在的日期',
    dayOutOfYear: (year) => `假日資料中有日期不在 ${year} 年內`,
    dayOffFlag: '假日資料中有放假標記不正確的項目',
    makeupNotWeekend: '假日資料中有補班日不在星期六或星期日',
    noOffDays: '檔案裡沒有任何放假日，不像完整的年度放假安排',
    dayDuplicate: '假日資料中有重複的日期',
    notJson: '下載到的內容不是有效的 JSON 文字',
    tooLarge: '下載到的內容過大（超過 256 KB），不像假日資料',
    notHttps: '資料來源跳轉到不安全（非 https）的位址',
    httpFail: (status) => `伺服器回應了錯誤（${status}）`,
    timeout: '連線逾時',
    network: '連線資料來源失敗',
    noSource: '沒有可用的資料來源',
    allFailed: (last) => `所有資料來源都取得失敗：${last}`,
  },

  // 「檢查更新」/ 「匯入假日表檔案」/ 自訂網址（基本設定 › 假日資料、進階設定）
  holidayUpdate: {
    // 狀態膠囊（假日資料卡）：每個年度一枚
    builtin: (y) => `${y} 年 · 內建`,
    online: (y) => `${y} 年 · 線上更新`,
    importedYear: (y) => `${y} 年 · 已匯入檔案`,
    missing: (y) => `${y} 年 · 未內建`,
    lastCheck: (md) => `上次檢查 ${md}`,
    statusLabel: '假日資料狀態',
    statusAria: (line) => `假日資料狀態：${line}`,
    sep: ' · ',
    check: '檢查更新',
    checking: '檢查中…',
    importFile: '匯入假日表檔案',
    // 臺灣版沒有「檢查更新」這顆鈕（整列都藏起來），這兩句只為與大陸字典同構而留著，畫面上不會出現；
    // 內容也不承諾從線上取得，免得日後有人把鈕放回來就變成假的承諾。
    checkHint: '臺灣版不提供線上檢查，請自行下載官方 CSV 後用「匯入假日表檔案」匯入',
    importHint: '用官方年度 CSV（UTF-8，全年逐日）',
    // 臺灣限定的常駐說明（面板在「匯入」下方顯示，大陸不顯示）。
    // 連結只用字典裡的靜態 https 網址；人事行政總處公告頁只寫成可選取的文字，不做連結、不帶協定，
    // 因為它的 XLSX／PDF／ODS 不是本程式能匯入的格式，連過去只會誤導。
    twManualBefore: '臺灣沒有線上檢查：請自行下載官方年度 CSV，再用「匯入假日表檔案」手動匯入。官方資料集：',
    twManualLinkLabel: '政府資料開放平臺資料集 14718',
    twManualHref: 'https://data.gov.tw/dataset/14718',
    twManualAfter: '',
    twManualFormats: '人事行政總處的辦公日曆表公告頁（www.dgpa.gov.tw/information?uid=30&pid=12982）提供 XLSX／PDF／ODS，這幾種格式本程式不能直接匯入；請用上方資料集的年度 CSV（UTF-8、全年逐日），不要選 Google 行事曆專用格式。',
    // 「查看匯入檔案的格式範例」：範例取自 2026 年官方 CSV 的前三天，複製的就是顯示的這份
    exampleShow: '查看匯入檔案的格式範例',
    exampleHide: '收起匯入檔案的格式範例',
    exampleHead: '檔案內容範例（取自 2026 年官方資料，僅列前三天；實際檔案需全年逐日）',
    exampleCopy: '複製範例',
    exampleCopied: '已複製',
    exampleCopyFail: '已選取範例，請按 Ctrl+C 複製',
    exampleCode: '西元日期,星期,是否放假,備註\n20260101,四,2,開國紀念日\n20260102,五,0,\n20260103,六,2,',
    exampleFormat: '檔案為行政院人事行政總處「政府行政機關辦公日曆表」年度 CSV（UTF-8，可含 BOM；標準 CSV 引號與換行）。',
    exampleYear: '西元日期：8 碼西元年月日（例如 20260101）；整份檔案必須完整涵蓋該年度每一天、不重複，且星期與日期相符。',
    examplePapers: '備註：放假日的節名與補班說明，保留官方原文；本程式不自行推測節名。',
    exampleDays: '是否放假：0 表示上班、2 表示放假（僅接受這兩個值，其他值整份拒絕）。',
    exampleNeedOff: '檔案中至少要有一個放假日，且全年逐日不得缺漏。',
    exampleOfficial: '官方來源：行政院人事行政總處《中華民國政府行政機關辦公日曆表》（政府資料開放平臺資料集 14718）。',
    // 臺灣 CSV 的逐條說明（holiday-panel 優先採用；最多 6 行）
    exampleLines: [
      '檔案為行政院人事行政總處「政府行政機關辦公日曆表」年度 CSV（UTF-8，可含 BOM；標準 CSV 引號與換行）。',
      '西元日期為 8 碼西元年月日（例如 20260101）；整份檔案必須完整涵蓋該年度每一天、不重複，且星期與日期相符。',
      '是否放假：0 表示上班、2 表示放假（只接受這兩個值，其他值整份拒絕）。',
      '備註：放假日的節名與補班說明保留官方原文；本程式不自行推測節名。',
      '檔案中至少要有一個放假日；缺少任何一天都整份拒絕，並保留原本的假日表。',
      '請到政府資料開放平臺資料集 14718 自行下載對應年度的 CSV；匯入只讀本機檔案，程式不會連線下載。',
    ],
    showExample: '查看格式範例',
    exampleWhereBefore: '可從 ',
    exampleWhereAddr: 'data.gov.tw/dataset/14718',
    exampleWhereAfter: ' 自行下載對應年度的 CSV；匯入只讀本機檔案，程式不會連線下載',
    added: (years) => `已更新：新增 ${years.join('、')} 年假日表`,
    refreshed: (years) => `已更新：${years.join('、')} 年的資料有變化，已採用`,
    same: '沒有需要更新的內容',
    // 臺灣版不會自動檢查或自動更新（沒有線上檢查），這句即使目前走不到也不能承諾會自動更新
    unpublished: (y) => `資料來源尚未發布 ${y} 年的辦公日曆表。臺灣版不會自動檢查或更新，請自行到政府資料開放平臺下載該年度的 CSV 再匯入。這段期間僅依週末與手動標記試算，可在月曆上手動標記。`,
    network: '無法連線假日資料來源，請稍後再試，或使用「匯入假日表檔案」',
    invalid: '來源資料不完整，已拒絕，未採用',
    detail: (reason) => `原因：${reason}`,
    // 差異說明：講清楚差在哪、現在按什麼算
    diff: (n) => `外來的辦公日曆與本機內建的有 ${n} 天不同，暫按內建的計算`,
    diffFile: (n) => `外來的辦公日曆與你匯入的檔案有 ${n} 天不同，暫按匯入的檔案計算`,
    fetched: (years) => `已取得 ${years.join('、')} 年假日表`,
    importDone: (years, off, makeup) => `已匯入 ${yearList(years)} 年辦公日曆（放假 ${off} 天，補班 ${makeup} 天）`,
    importNoYear: '檔案裡沒有可用的年份與放假資料，未匯入',
    importBuiltin: (years) => `${yearList(years)} 年假日已內建，未採用匯入的資料`,
    customUrl: '自訂資料網址',
    customUrlExplain: '中國大陸版預設先從 jsDelivr、再從 GitHub 取得假日資料；連不上時可填入你自己存放檔案的網址，留空即使用預設來源。臺灣版不提供自訂資料網址。',
    customUrlPlaceholder: 'https://example.com/{year}.json',
    customUrlHint: '必須以 https:// 開頭，用 {year} 代表年份。網址回應的內容要和「格式範例」相同。',
    customUrlSummary: (host) => `自訂資料網址：${host ?? '未設定'}`,
    customUrlError: '網址必須以 https:// 開頭，並包含 {year}',
    customUrlChars: '網址裡只能用半形字母、數字與常見符號，不能有空格、不可見字元或中文',
    customUrlBackslash: '網址裡不能有反斜線（\\）',
    customUrlUserinfo: '網址裡不能帶使用者名稱或密碼（@ 前面的部分）',
    customUrlYearPlace: '{year} 必須寫在網址的路徑或查詢參數裡，不能寫在網域、連接埠或 # 後面',

    // ── 臺灣專屬補充（additive；CN 既有 key 未改動） ──
    // 臺灣不提供自訂網址：面板應隱藏自訂網址區塊，並可顯示這句
    customUrlUnavailable: '臺灣的辦公日曆只使用政府資料開放平臺的官方資料或手動匯入，不提供自訂資料網址。',
    listSep: '、',
    csvOff: '放假',
    csvMakeup: '補班',
    // 資源無法判定（同年多版本、無更新時間、不受信任跳轉）：需要使用者手動匯入
    blocked: '無法從官方資料集判定可用的年度檔案，已拒絕，未採用',
    importFailed: '這份檔案不符合臺灣官方 CSV 格式，未匯入',
    importSkipped: (yearsText) => `以下年份已內建，未採用檔案中的資料：${yearsText}`,
    // 儲存寫不進去（配額、隱私模式、紀錄損壞）：本次會話仍可用，但關掉就沒了，備份檔也不含假日表
    sessionOnly: '這份假日表只留在目前頁面，關掉就會消失（無法寫入瀏覽器儲存空間）；備份檔也不含假日表',
    sessionOnlySkipped: (yearsText) => `這份假日表只留在目前頁面，關掉就會消失（無法寫入瀏覽器儲存空間）；備份檔也不含假日表。以下年份已內建，未採用檔案中的資料：${yearsText}`,
    codeGeneric: (code) => `無法套用這份資料（${code ?? '未知原因'}）`,
    // 解析 / 抓取失敗代碼 → 文字（由 holiday-update-tw 的 reasonText 以 params 物件呼叫）。
    // params 可能是物件或是單一值，兩種都讀得懂，不會顯示 undefined。
    codes: {
      cors: '政府資料開放平臺可能不允許瀏覽器跨來源直接讀取（CORS，未逐一驗證），請改用「匯入假日表檔案」',
      network: '無法連線政府資料開放平臺',
      timeout: '連線政府資料開放平臺逾時',
      http: (p) => {
        const s = param(p, 'status');
        return s == null ? '政府資料開放平臺回應了錯誤' : `政府資料開放平臺回應了錯誤（${s}）`;
      },
      tooLarge: '檔案過大，超過允許的大小上限',
      notText: '檔案無法讀取，或不是文字檔（請確認是 UTF-8 的 CSV）',
      notCsv: '不是 CSV 檔，或欄位標題不是「西元日期,星期,是否放假,備註」',
      noYear: '檔案裡找不到可用的年度',
      wrongYear: (p) => {
        const y = param(p, 'year');
        return y == null ? '檔案的年度與要匯入的年度不同' : `檔案是 ${y} 年的資料，與要匯入的年度不同`;
      },
      missingDay: (p) => {
        const d = param(p, 'date');
        return d ? `檔案缺少 ${d} 的資料，未涵蓋全年逐日` : '檔案未涵蓋全年逐日';
      },
      duplicateDay: (p) => {
        const d = param(p, 'date');
        return d ? `檔案有重複的日期（${d}）` : '檔案有重複的日期';
      },
      badDate: (p) => {
        const d = param(p, 'date');
        return d ? `檔案中的日期不正確（${d}）` : '檔案中有格式不正確或不是真實存在的日期';
      },
      badWeekday: (p) => {
        const d = param(p, 'date');
        return d ? `檔案中的星期與日期不相符（${d}）` : '檔案中的星期與日期不相符';
      },
      unknownStatus: (p) => {
        const d = param(p, 'date');
        return d ? `檔案中的「是否放假」有 0、2 以外的值（${d}）` : '檔案中的「是否放假」有 0、2 以外的值';
      },
      incompleteYear: '檔案未涵蓋該年度每一天，整份拒絕',
      badRowShape: (p) => {
        const y = param(p, 'year');
        return y == null ? '檔案的欄位結構不完整，整份拒絕' : `${y} 年的欄位結構不完整，整份拒絕`;
      },
      ambiguousResource: '同年度的官方資源有多個版本，無法判定哪一份最新，請手動匯入',
      untrustedUrl: '資源網址不在允許的政府網域，或跳轉到不受信任的位址（含瀏覽器把跳轉藏成無法逐跳檢查的回應），請改用「匯入假日表檔案」',
      datasetUnavailable: '查不到政府資料開放平臺的資料集 14718',
      unreachable: '官方資源目前無法下載',
      // 儲存層的驗證（理論上不會出現；仍給出具體說明，不再退回通用文字）
      year: '檔案的年度不在可接受的範圍',
      table: '檔案內容的結構不正確',
      offShape: '放假日資料的結構不正確',
      makeupShape: '補班日資料的結構不正確',
      dateKey: (p) => {
        const d = param(p, 'date');
        return d ? `檔案中的日期格式不正確（${d}）` : '檔案中的日期格式不正確';
      },
      dateNotReal: (p) => {
        const d = param(p, 'date');
        return d ? `檔案中有不是真實存在的日期（${d}）` : '檔案中有不是真實存在的日期';
      },
      dateOutOfYear: (p) => {
        const d = param(p, 'date');
        return d ? `檔案中的日期不在該年度內（${d}）` : '檔案中的日期不在該年度內';
      },
      name: (p) => {
        const d = param(p, 'date');
        return d ? `檔案中的節名空白、過長或含有不可見字元（${d}）` : '檔案中的節名空白、過長或含有不可見字元';
      },
      duplicate: (p) => {
        const d = param(p, 'date');
        return d ? `同一天同時被標成放假與補班（${d}）` : '同一天同時被標成放假與補班';
      },
      emptyOff: '檔案裡沒有任何放假日，不像完整的年度辦公日曆',
      papers: '檔案缺少政府資料開放平臺的出處連結',
      resourceUpdatedAt: '檔案的資源更新時間格式不正確',
      record: '要儲存的年度資料結構不正確，未寫入',
      source: '資料來源不是允許的政府網址，未寫入',
      fetchedAt: '取得時間的格式不正確，未寫入',
      lastCheck: '上次檢查時間的格式不正確，未記錄',
      stale: '檢查期間已切換地區或重新載入，這次的結果已捨棄',
    },
    // 資料來源與授權（政府資料開放授權條款第 1 版；顯名聲明）
    license: {
      label: '資料來源與授權',
      dataset: '行政院人事行政總處《中華民國政府行政機關辦公日曆表》，政府資料開放平臺資料集 14718',
      attribution: '提供機關：行政院人事行政總處；年度：2026（民國 115 年）、2027（民國 116 年）；資料名稱：中華民國政府行政機關辦公日曆表；資料集編號 14718（識別碼 A58000000A-000166），資料集更新時間 2026-07-15 11:29:25',
      release: '內建的年度資料依「政府資料開放授權條款－第 1 版」公眾釋出。',
      href: 'https://data.gov.tw/license',
      linkLabel: '政府資料開放授權條款－第 1 版',
      commercial: '商業再散布與其他利用的授權範圍仍需另行法務確認，本程式不宣稱已完成確認。',
      obtained: (date) => `取得日期：${date}`,
    },
    // 缺表時的說明（臺灣沒有法定日期回退，只依週末與手動標記）
    fallback: (y) => `此年度尚無臺灣政府辦公日曆，僅依週末與手動標記試算，結果可能不準確`,
    // 行政機關日曆 ≠ 所有勞工法定休假；薪資為估算
    scope: '政府行政機關辦公日曆表不等同所有勞工的法定休假，各企業可能不同；可在月曆上手動標記調整。薪資為估算，不宣稱符合法定計薪。',
  },

  banner: {
    // 首次開啟：說清楚目前用的是哪些預設值（數字取自真實預設設定，不寫死）
    firstRun: (salary, start, end) => `目前按預設月薪 ${salary}、${start}–${end} 計算，請改成你自己的`,
    goFix: '去修改',
    sep: ' · ',
    dismiss: '關閉提示',
    closeGlyph: '×',
    backupNudge: '設定已自動儲存在這個瀏覽器裡。建議匯出一份備份，以防清除瀏覽資料後遺失。',
    ok: '知道了',
    storageFail: '無法儲存設定，關閉頁面後會遺失。請先匯出備份',
    loadCorrupt: '已儲存的設定無法讀取，目前使用的是預設值。如有備份，可用「匯入備份」還原。',
    // 最多列 3 項，其餘寫「…等 N 項」
    loadPartial: (labels) => `已儲存的設定中有部分項目無法使用，以下項目已改用預設值：${labels.slice(0, 3).join('、')}${labels.length > 3 ? `…等 ${labels.length} 項` : ''}`,
  },

  status: {
    working: '上班中',
    lunch: '午休中',
    beforeWork: '未上班',
    afterWork: '已下班',
    restDay: '休息日',
    holiday: '國定假日',
    paidLeave: '有薪假',
    unpaidLeave: '無薪假',
    makeupTag: '補班',
  },

  card: {
    earnedNow: '今天已經賺了',
    notStarted: '今天還沒開始',
    // 未上班：金額是 0.00，標籤說明幾點開始計薪（時間取自設定）
    startPay: (hhmm) => `${hhmm} 開始計薪`,
    earnedTotal: '今天一共賺了',
    // 已下班（排定的工作日收工後）的正向回饋：換掉標籤與「目前賺錢速度」格，不加列
    dayDone: '今天辛苦了，收工！',
    monthProgress: '已賺占月薪',
    monthProgressValue: (pct) => `${pct}%`,
    resting: '今天休息',
    restingHoliday: (name) => `今天休息 · ${name}`,
    toOff: (d) => `距下班 ${d}`,
    toStart: (d) => `距上班 ${d}`,
    resumeIn: (n) => `${n} 分鐘後繼續上班`,
    nextWorkday: (n) => `距下個工作日 ${n} 天`,
    paidNote: '今天按全天計薪',
    // 無薪假：不顯示金額，標籤就是結論
    unpaidLabel: '今天不計薪',
    // 工時：已工作 2小時0分 / 共 7小時（小時、分鐘由 format.js 拆出，單位寫在這裡）
    worked: (a, b) => `已工作 ${a} / 共 ${b}`,
    spanHM: (h, m) => (h > 0 ? `${h}小時${m}分` : `${m}分`),
    spanH: (h, m) => (m === 0 ? `${h}小時` : h > 0 ? `${h}小時${m}分` : `${m}分`),
    workedDone: (h, m) => `今天工作滿 ${h}小時${m === 0 ? '' : `${m}分`}`,
    progressLabel: '工時進度',
    rate: '目前賺錢速度',
    rateUnit: '/秒',
    lunchEnds: '午休結束',
    month: '本月累計',
    hourly: '時薪',
    dailyFull: '今日滿勤可得',
    payIn: (n) => `距發薪日 ${n} 天`,
    payToday: '今天發薪',
    // 缺假日表的標籤：臺灣沒有法定日期回退，只依週末與手動標記；三種措辭（lunar / fixed / none）
    // 都用同一組句子，不宣稱任何法定假日已標出（臺灣 provider 一律回報 none）。
    yearMissing: (year) => `${year} 年尚無臺灣政府辦公日曆，僅依週末與手動標記試算`,
    yearMissingLong: (year) => `${year} 年尚無臺灣政府辦公日曆，僅依週末與手動標記試算，結果可能不準確`,
    // names 由呼叫端傳入；臺灣沒有法定日期回退，不套用這些節名，只保留簽名
    yearMissingFixed: (year, names) => `${year} 年尚無臺灣政府辦公日曆，僅依週末與手動標記試算`,
    yearMissingFixedLong: (year) => `${year} 年尚無臺灣政府辦公日曆，僅依週末與手動標記試算，結果可能不準確`,
    yearMissingNone: (year) => `${year} 年尚無臺灣政府辦公日曆，僅依週末與手動標記試算`,
    yearMissingNoneLong: (year) => `${year} 年尚無臺灣政府辦公日曆，僅依週末與手動標記試算，結果可能不準確`,
    gear: '收回小窗並開啟基本設定',
    srSummary: (badge, yuan) => `${badge}，今天已賺 ${yuan} 元`,
  },

  currency: 'NT$',
  // 地區名稱（匯入報告會用；與設定面板的選項一致）
  regions: { TW: '臺灣', CN: '中國大陸' },
  // 倒數佔位文字：分、秒的數字補成兩位最寬（88），用來固定倒數格的寬度（card.js）
  durationWidest: (text) => text.replace(/\d+(?=[分秒])/g, '88'),
  duration: (h, m, s) => (h > 0 ? `${h}小時${m}分${s}秒` : `${m}分${s}秒`),
  weekdays: ['週日', '週一', '週二', '週三', '週四', '週五', '週六'],

  lunar: {
    months: ['正月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月'],
    digits: ['一', '二', '三', '四', '五', '六', '七', '八', '九'],
    leap: '閏', first: '初', ten: '十', twenty: '二十', twenties: '廿', thirty: '三十',
    full: (month, day) => `農曆${month}${day}`,
  },

  settings: {
    region: {
      label: '地區',
      options: { TW: '臺灣', CN: '中國大陸' },
      hint: '兩地的月薪與月曆標記分開儲存，不做匯率換算。',
      salaryNote: {
        TW: { text: '示例月薪 NT$40,000 由主計總處 2025 年工業及服務業本國籍全時受僱員工每月經常性薪資中位數 39,890 元向上取整至千元，並非全體員工或總薪資中位數。請改成實際月薪。', sources: [{ label: '主計總處', href: 'https://www.dgbas.gov.tw/News_Content.aspx?n=3602&s=235863' }] },
        CN: { text: '示例月薪 ¥5,000 取第三方對 2024 年全國雇員月薪中位數 5,000–5,150 元推估區間的下限，按百元向上取整；非官方統計，原文無法讀取，範圍與方法未經獨立核實。請改成實際月薪。', sources: [{ label: '第三方推估', href: 'https://zhuanlan.zhihu.com/p/2015685656777609855' }] },
      },
      sourcesLabel: '來源：',
      lunchOffPay: '關閉後，午休時段仍計入工時與薪資。',
    },
    autosaved: '已自動儲存',
    // 分區導覽（窄面板 / 手機單欄才顯示）：名稱與卡片標題一致，跳到既有的卡片
    navLabel: '跳到設定分區',
    sections: {
      pay: '薪資與上班時間', holiday: '假日資料', backup: '資料與備份', advanced: '進階設定',
      display: '畫面設定',
    },
    payDesc: '用來計算每天、每秒賺多少，修改後自動儲存',
    holidayDesc: (years) => `國定假日與補班安排，已內建 ${years.join('、')} 年`,
    backupDesc: '設定只儲存在這個瀏覽器裡，不會上傳。',
    advancedSub: '通常不用改',
    // 展開 / 收起的小三角（與 banner.closeGlyph 一樣放在文案裡）
    chevronClosed: '▸',
    chevronOpen: '▾',
    salaryUnit: '元 / 月',
    // 示例月薪的口徑與出處較長：預設收起，這句是輸入框旁展開鈕的文字
    salaryNoteToggle: '說明',
    // 讀屏用全名；不含「月薪」二字，避免與輸入框的 getByLabel 定位衝突
    salaryNoteToggleAria: '示例說明與來源',
    workTime: '上下班時間',
    lunchTime: '午休時間',
    to: '至',
    on: '開',
    off: '關',
    salary: '月薪',
    salaryError: '請輸入大於 0 的數字，只用半形數字、不加逗號，例如 40000',
    start: '上班時間',
    end: '下班時間',
    lunchOn: '午休',
    showLunar: '顯示農曆',
    theme: '主題色',
    themeOptions: { green: '自然綠', blue: '海洋藍', orange: '暖橙', teal: '湖水青', rose: '莓果紅', slate: '沉穩灰', rainbow: '柔光彩虹' },
    lunarSource: '農曆資料來源：香港天文台《公曆與農曆日期對照表》（2020–2060）。2057 年部分日期因曆法邊界不確定而不顯示。這份農曆資料的再散布權利尚未經法務確認，本程式不宣稱已取得授權。',
    lunchOffHint: '關閉後，午休時段也計為工時',
    lunchStart: '午休開始時間',
    lunchEnd: '午休結束時間',
    cheer: '鼓勵語',
    cheerPlaceholder: '寫一句給自己的話',
    cheerHint: '會顯示在左側狀態卡上',
    cheerCount: (n, max) => `${n}/${max}`,
    cheerAdd: '再加一句',
    cheerItemLabel: (n) => `第 ${n} 句鼓勵的話`,
    cheerRemoveAria: (n) => `刪除第 ${n} 句`,
    weekends: '週末上班',
    weekendsHint: '開啟後，星期六、星期日也算工作日；個別補班日請在月曆上標記',
    payday: '發薪日',
    paydayNone: '未設定',
    paydayHint: '設定後，狀態卡會顯示「距離發薪日 N 天」',
    paydayOption: (d) => `每月 ${d} 日`,
    // ---- 畫面設定：只管狀態卡顯示什麼，不改變任何計算 ----
    // 匯入報告按欄位名查標籤（import-model 的 t.settings[field]）：這些鍵在 settings 頂層也放一份，
    // 報告才不會顯示成生欄位名。介面上的標籤仍然用下面的 display.*（措辭為避開同名控件的歧義）。
    fontScale: '字級',
    showCardProgress: '顯示進度條', showCardMetrics: '顯示薪資明細', showCardDate: '顯示日期',
    showCardPayday: '顯示發薪提醒', showCardCheer: '顯示鼓勵文字',
    display: {
      desc: '狀態卡顯示哪些內容、字級多大；只影響顯示，不改變任何計算',
      fontScale: '字級',
      fontScaleOptions: { xs: 'XS（特小）', s: 'S（小）', m: 'M（標準）', l: 'L（大）', xl: 'XL（特大）' },
      fontScaleHint: '預設是中號，懸浮成小視窗時也一樣。',
      scope: '下面五個開關只決定狀態卡顯示什麼，不會改變工時、薪資或月曆的計算。',
      progress: '進度條',
      progressHint: '顯示今天的進度與百分比。',
      metrics: '薪資明細',
      metricsHint: '顯示本月累計、時薪等資訊；不影響上方主要金額。',
      date: '日期',
      dateHint: '關閉後，農曆日期也一併隱藏。',
      // 開關標籤不能與「發薪日」「鼓勵語」兩個輸入框的標籤同名：讀屏與 getByLabel 都按子串比對，
      // 同名會讓「發薪日」一次命中兩個控件。這裡用「提醒／文字」區分「顯示的是什麼」，提示語裡再寫全稱。
      payday: '發薪提醒',
      paydayHint: '沒設定發薪日時本來就不顯示。',
      cheer: '鼓勵文字',
      cheerHint: '那句鼓勵語仍儲存在設定裡。',
      statusNote: '「上班中」「午休」「已下班」這些狀態標籤不受開關影響，始終顯示。',
    },
    backup: {
      export: '匯出備份',
      import: '匯入備份',
      note: '備份檔案含月薪，請妥善保管',
      summary: '備份檔案含月薪、上下班時間、主題色與月曆標記。換電腦或清除瀏覽資料前匯出，之後用「匯入備份」還原。',
      scope: '備份不含線上取得或匯入的假日表，也不含自訂資料網址。',
    },
  },

  calendar: {
    title: '月曆',
    prev: '‹ 上月',
    next: '下月 ›',
    today: '回到今天',
    todayBack: (title) => `回到今天 · ${title}`,
    monthTitle: (y, m) => `${y} 年 ${m} 月`,
    prevTitle: '上月（PgUp）',
    nextTitle: '下月（PgDn）',
    summary: (days, wage) => `本月應出勤 ${days} 天 · 日薪 ${wage}`,
    legendHint: '點選日期可標記：補班 · 有薪假 · 無薪假',
    legendHintShort: '點選日期可標記',
    context: {
      noHoliday: '本月沒有國定假日',
      noneMarked: '本月沒有已標出的國定假日',
      noData: (y) => `沒有 ${y} 年的辦公日曆表，僅依週末與手動標記試算`,
      range: (a, b) => (a === b ? a : `${a}–${b}`),
      md: (m, d) => `${m}/${d}`,
      off: (ranges) => `${ranges.join('、')} 放假`,
      makeup: (days) => `${days.join('、')} 補班`,
      group: (name, parts) => `${name} ${parts.join('，')}`,
      join: (groups) => groups.join('；'),
      sub: (basis) => `· ${basis}`,
      basis: {
        builtin: (y) => `依據 ${y} 年行政院人事行政總處辦公日曆表`,
        online: (y) => `依據政府資料開放平臺取得的 ${y} 年辦公日曆表`,
        file: (y) => `依據匯入的 ${y} 年辦公日曆表`,
        // 臺灣沒有法定日期回退：無表年份只依週末與手動標記
        lunar: '尚無臺灣政府辦公日曆，僅依週末與手動標記試算',
        fixed: '尚無臺灣政府辦公日曆，僅依週末與手動標記試算',
      },
    },
    reset: '重設本月標記',
    undoMark: '復原上次標記',
    legend: '圖例',
    weekHeads: ['一', '二', '三', '四', '五', '六', '日'],
    kinds: {
      workday: '工作日',
      weekend: '週末',
      rest: '休息日',
      holiday: '國定假日',
      makeup: '補班',
      paid: '有薪假',
      unpaid: '無薪假',
    },
    todayLabel: '今天',
    manual: '手動標記',
    manualTitle: '已手動標記',
    tags: { makeup: '班', paid: '有薪', unpaid: '無薪', rest: '休' },
    cellAria: ({ month, day, weekday, kind, holidayName, manual, today }) =>
      `${month}月${day}日 ${weekday}，${today ? '今天，' : ''}${kind}${holidayName ? `（${holidayName}）` : ''}${manual ? '，已手動標記' : ''}，按 Enter 開啟選單`,
    marked: (md, label) => `${md} 已標記為${label}`,
    cleared: (md) => `${md} 已恢復預設`,
    resetDone: '已重設本月標記',
    undo: '復原',
    undoDone: '已復原上一次標記',
    undoPartial: (done, skipped) => `已復原 ${done} 天，另有 ${skipped} 天已在別處改過，保持不變`,
    undoStale: '上一次標記已在別處改過，沒有復原',
    unsaved: (msg) => `${msg}（未能儲存，請先匯出備份）`,
    dayTitle: (month, day, weekday) => `${month}月${day}日 ${weekday}`,
    todaySuffix: '（今天）',
    // 日期的狀態文字（選單標題與提示共用）
    status: {
      workday: '工作日',
      rest: '休息日',
      holiday: (name) => (name ? `國定假日（${name}）` : '國定假日'),
      makeup: (name) => (name ? `補班（${name}）` : '補班'),
      paid: '有薪假',
      unpaid: '無薪假',
    },
    menu: {
      header: (title, status) => `${title} · ${status}`,
      options: { work: '改為上班（補班）', rest: '改為休息（調整放假）', paidLeave: '有薪假', unpaidLeave: '無薪假' },
      defaultWork: '恢復為工作日',
      defaultRest: '恢復為休息日',
      defaultHoliday: '恢復為國定假日',
      preview: (from, to) => `日薪 ${from} → ${to}`,
      unchanged: '日薪不變',
      paidNote: '照常計薪',
      unpaidNote: (yuan) => `這天不計薪（本月少 ${yuan}）`,
      restPreview: (before, after) => `月薪不變，每天 ${before} → ${after}`,
      noWorkdays: '本月沒有上班日，不計薪',
      footer: '月薪固定，按當月上班天數平分',
    },
    tip: {
      source: (label) => `來源：${label}`,
      sources: { builtin: '內建·官方日曆', online: '線上更新', file: '匯入檔案', manual: '手動標記', rule: '依週末規則', statutory: '法定日期', default: '依預設規則' },
      pay: (yuan) => `當日計薪 ${yuan}`,
      payShort: (yuan) => `計薪 ${yuan}`,
      statusShort: { holiday: (name) => (name ? `國定假日·${name}` : '國定假日'), makeup: (name) => (name ? `補班·${name}` : '補班') },
      todayTag: (status) => `${status}·今天`,
      sourcesShort: { statutory: '法定日期' },
      hint: '點選修改',
      join: (parts) => parts.join('，'),
    },
  },

  importer: {
    success: '匯入成功',
    fail: '匯入失敗：無法辨識這個檔案。目前設定沒有被修改。',
    failReason: (r) => `原因：${r}`,
    retry: '重新選擇檔案',
    reportTitle: (n, m) => `已匯入 ${n} 項，${m} 項未匯入`,
    cols: ['項目', '原因', '目前使用的值'],
    keep: (v) => `保留目前值 ${v}`,
    unknownReason: '無法辨識的欄位，已忽略',
    none: '—',
    emptyValue: '未設定',
    marksField: '月曆標記',
    markField: (key) => `月曆標記 ${key}`,
    markValues: { work: '補班', rest: '休息日', paidLeave: '有薪假', unpaidLeave: '無薪假' },
    unmarked: '未標記',
    ok: '知道了',
    goFix: '到設定裡修改',
  },

  exporter: {
    done: '已匯出 · 檔案含月薪，請妥善保管',
    filename: (ymd) => `work-motivator-backup-${ymd}.json`,
  },
};

// 年份可以是單一數字或已串好的字串（匯入多年度 CSV 時為陣列）
function yearList(years) {
  if (Array.isArray(years)) return years.join('、');
  return String(years);
}

// 失敗代碼的 params 可能是物件（{ date }）或單一值（'2026-01-02'／400）；兩種都取得到值
function param(p, key) {
  if (p == null) return null;
  if (typeof p === 'object') return p[key] ?? null;
  return p;
}
