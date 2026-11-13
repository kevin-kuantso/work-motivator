// 全部介面文案（中國大陸簡體）。其他源文件不得寫死介面文案。
export const STRINGS = {
  appTitle: '上班鼓励器',

  header: {
    float: '悬浮成小窗',
    repository: '在 GitHub 查看项目',
  },

  // 右側分頁
  tabs: {
    label: '主要内容',
    calendar: '月历',
    settings: '基本设置',
  },

  // 懸浮小窗（Document PiP）
  float: {
    recall: '收回小窗',
    placeholder: '已悬浮 · 点此收回',
    unsupported: '当前浏览器不支持悬浮小窗，请使用 Edge 或 Chrome（116 及以上）',
    placeholderNote: '状态卡正显示在悬浮小窗里',
    keepOpen: '请保持本页开启：关闭本页，小窗也会一起关闭',
    failed: '小窗没能打开，请再试一次',
    sizeLimited: '小窗没能自动调大（浏览器不允许程序改窗口大小）：内容可能要滚动才能看全，请手动把窗口拖大',
  },

  // 頁面被瀏覽器暫停（後臺節流、凍結、休眠）後恢復：數字會一下子按當前時間跳過去（R34）
  notice: {
    paused: '页面刚才被浏览器暂停了一段时间，数字已按当前时间校正',
  },

  // 法定節假日名稱（holidays-cn.js 引用）
  holidays: {
    newYear: '元旦', spring: '春节', qingming: '清明', labour: '劳动节',
    dragonBoat: '端午', midAutumn: '中秋', national: '国庆',
  },

  // 校驗原因（calc.js / settings.js 引用；使用者看得懂的描述，不出現欄位鍵名或列舉值）
  reasons: {
    salary: '月薪必须是大于 0 的数字',
    timeFormat: (label) => `${label}格式不正确，应为 24 小时制的「时:分」，例如 08:30`,
    endAfterStart: '下班时间必须晚于上班时间',
    lunchInShift: (label) => `${label}必须在上下班时间之间`,
    lunchOrder: '午休开始时间必须早于午休结束时间',
    switchValue: (label) => `${label}只能是开或关`,
    payday: '发薪日必须是 1 到 31 之间的整数，或者不设置',
    theme: '请选择支持的主题色',
    fontScale: '字号只能是 XS、S、M、L、XL 其中之一',
    cheerType: '鼓励语格式不正确',
    cheerTooLong: '鼓励语不能超过 40 个字',
    marksType: '月历标记的格式不正确',
    markDate: '日期格式不正确',
    markNotReal: '不是真实存在的日期',
    markValue: '标记类型无法识别',
    // 匯入備份（M19）：說人話，不出現文件格式名
    notJson: '这不是本工具导出的备份文件',
    notObject: '文件内容的结构不正确',
    region: '地区代码无法识别，仅支持台湾（TW）和中国大陆（CN）；已保留原值',
    salariesType: '各地区月薪的数据结构不正确，已保留原有月薪',
    futureVersion: '备份来自更新版本，无法导入；请更新本程序后重试',
    labels: {
      start: '上班时间', end: '下班时间', lunchStart: '午休开始时间', lunchEnd: '午休结束时间',
      lunchOn: '午休开关', weekends: '周末上班', showLunar: '显示农历',
      fontScale: '字号',
      showCardProgress: '显示进度条', showCardMetrics: '显示薪资明细', showCardDate: '显示日期',
      showCardPayday: '显示发薪提醒', showCardCheer: '显示鼓励内容',
    },
  },

  // 聯網獲取的假期資料校驗原因 / 抓取結果
  holidayData: {
    notObject: '假期数据的结构不正确',
    yearMismatch: (year) => `假期数据不是 ${year} 年的`,
    papersMissing: '假期数据缺少国务院放假通知的出处',
    papersBad: '假期数据的出处不是国务院官网（www.gov.cn）的链接',
    daysEmpty: '该年度的假期数据还没有发布',
    dayShape: '假期数据中有格式不正确的日期条目',
    dayName: '假期数据中有节日名称为空或过长',
    dayDate: '假期数据中有日期格式不正确',
    dayNotReal: '假期数据中有不是真实存在的日期',
    dayOutOfYear: (year) => `假期数据中有日期不在 ${year} 年内`,
    dayOffFlag: '假期数据中有放假标记不正确的条目',
    makeupNotWeekend: '假期数据中有调休上班日不在周六或周日',
    noOffDays: '文件里没有任何放假日，不像完整的年度放假安排',
    dayDuplicate: '假期数据中有重复的日期',
    notJson: '下载到的内容不是有效的 JSON 文本',
    tooLarge: '下载到的内容过大（超过 256 KB），不像假期数据',
    notHttps: '数据源跳转到了不安全（非 https）的地址',
    httpFail: (status) => `服务器返回了错误（${status}）`,
    timeout: '连接超时',
    network: '连接数据源失败',
    noSource: '没有可用的数据源',
    allFailed: (last) => `所有数据源都获取失败：${last}`,
  },

  // 「檢查更新」/「匯入假期表文件」/ 自定義網址（基本設定 › 假期資料、進階設定）
  holidayUpdate: {
    // 狀態膠囊（假期資料卡）：每個年份一枚
    builtin: (y) => `${y} 年 · 内置`,
    online: (y) => `${y} 年 · 联网更新`,
    importedYear: (y) => `${y} 年 · 已导入文件`,
    missing: (y) => `${y} 年 · 未内置`,
    lastCheck: (md) => `上次检查 ${md}`,
    statusLabel: '假期数据状态',
    statusAria: (line) => `假期数据状态：${line}`,
    sep: ' · ',
    check: '检查更新',
    checking: '检查中…',
    importFile: '导入假期表文件',
    checkHint: '联网获取新公布的放假安排',
    importHint: '连不上网时，用文件导入',
    // 「檢視匯入文件的格式示例」（R47）：示例是一份完整、能通過校驗的最小文件，內容取自 2026 年真實資料
    // （出處連結 = holiday-cn 2026.json 的 papers；01-01 元旦放假、01-04 週日調休上班）；複製的就是顯示的這份
    exampleShow: '查看导入文件的格式示例',
    exampleHide: '收起导入文件的格式示例',
    exampleHead: '文件内容示例（取自 2026 年真实数据，只列两天）',
    exampleCopy: '复制示例',
    exampleCopied: '已复制',
    exampleCopyFail: '已选中示例，请按 Ctrl+C 复制',
    exampleCode: '{"year":2026,\n "papers":[\n  "https://www.gov.cn/zhengce/zhengceku/202511/content_7047091.htm"],\n "days":[\n  {"name":"元旦","date":"2026-01-01",\n   "isOffDay":true},\n  {"name":"元旦","date":"2026-01-04",\n   "isOffDay":false}]}',
    exampleFormat: '文件为 holiday-cn 格式的年度 JSON（例如 2027.json）。',
    exampleYear: 'year：年份（数字，例如 2027）；days 里的日期都必须在这一年内。',
    examplePapers: 'papers：官方放假通知的网址，必须以 https://www.gov.cn/ 开头，否则整份文件会被拒绝。',
    exampleDays: 'days：每一天一条；isOffDay 为 true 表示放假，false 表示调休上班（调休上班日必须是周六或周日）。',
    exampleNeedOff: '文件里至少要有一个放假日，否则会被拒绝。',
    exampleOfficial: '官方来源：中国政府网（gov.cn）每年发布的《关于 20XX 年部分节假日安排的通知》',
    showExample: '查看格式示例',
    exampleWhereBefore: '可从 ',
    exampleWhereAddr: 'github.com/NateScarlet/holiday-cn',
    exampleWhereAfter: ' 下载（在大陆可能打不开，可请朋友下载后发给你）',
    added: (years) => `已更新：新增 ${years.join('、')} 年假期表`,
    refreshed: (years) => `已更新：${years.join('、')} 年联网数据有变化，已采用`,
    same: '已是最新 · 刚刚检查过',
    unpublished: (y) => `数据来源暂未发布 ${y} 年放假安排，发布后会自动更新。法定假日本身已标出，现在可以先在月历上自己标记补假和调休。`,
    network: '无法连接假期数据来源，请稍后重试，或使用「导入假期表文件」',
    invalid: '来源数据不完整，已拒绝，未采用',
    detail: (reason) => `原因：${reason}`,
    // M15：說清楚差別在哪、現在按什麼算；不寫「內建表」「未採用」這類內部說法，也不說「按國務院通知」（聯網資料同樣是通知，見 R49）
    diff: (n) => `网上的放假安排与本机内置的有 ${n} 天不同，暂按内置的计算`,
    diffFile: (n) => `网上的放假安排与你导入的文件有 ${n} 天不同，暂按导入的文件计算`,
    fetched: (years) => `已获取 ${years.join('、')} 年假期表`,
    importDone: (y, off, makeup) => `已导入 ${y} 年假期表（放假 ${off} 天，调休上班 ${makeup} 天）`,
    importNoYear: '文件里没有可用的年份和放假数据，未导入',
    importBuiltin: (y) => `${y} 年假期已内置，未采用导入的数据`,
    // 寫不進瀏覽器儲存（配額、隱私模式、記錄損壞）：本次會話仍可用，但關掉就沒了，備份也不含假期表
    sessionOnly: '这份假期表只留在当前页面，关掉就会消失（无法写入浏览器存储空间）；备份文件也不含假期表',
    customUrl: '自定义数据网址',
    customUrlExplain: '默认先从 jsDelivr、再从 GitHub 获取假期数据。连不上时，可以填写你自己存放文件的网址。留空则使用默认来源。',
    customUrlPlaceholder: 'https://example.com/{year}.json',
    customUrlHint: '必须以 https:// 开头，用 {year} 代表年份。网址返回的内容要和「格式示例」格式相同。',
    customUrlSummary: (host) => `自定义数据网址：${host ?? '未设置'}`,
    customUrlError: '网址必须以 https:// 开头，并包含 {year}',
    customUrlChars: '网址里只能用半角字母、数字和常见符号，不能有空格、不可见字符或中文',
    customUrlBackslash: '网址里不能有反斜杠（\\）',
    customUrlUserinfo: '网址里不能带用户名或密码（@ 前面的部分）',
    customUrlYearPlace: '{year} 必须写在网址的路径或查询参数里，不能写在域名、端口或 # 后面',
  },

  banner: {
    // 首次開啟（H1）：說清楚現在用的是哪些預設值（數字取自真實預設設定，不寫死）
    firstRun: (salary, start, end) => `现在按默认月薪 ${salary}、${start}–${end} 计算，请改成你自己的`,
    goFix: '去修改',
    sep: ' · ',
    dismiss: '关闭提示',
    closeGlyph: '×',
    backupNudge: '设置已自动保存在这个浏览器里。建议导出一份备份，以防清除浏览数据后丢失。',
    ok: '知道了',
    storageFail: '无法保存设置，关闭页面后会丢失。请先导出备份',
    loadCorrupt: '已保存的设置无法读取，现在使用的是默认值。如有备份，可用「导入备份」恢复。',
    // 最多列 3 項，其餘寫「…等 N 項」（R27：保證錯誤條最壞情況仍有餘量）
    loadPartial: (labels) => `已保存的设置中有部分项目无法使用，以下项目已改用默认值：${labels.slice(0, 3).join('、')}${labels.length > 3 ? `…等 ${labels.length} 项` : ''}`,
  },

  status: {
    working: '上班中',
    lunch: '午休中',
    beforeWork: '未上班',
    afterWork: '已下班',
    restDay: '休息日',
    holiday: '法定假日',
    paidLeave: '带薪假',
    unpaidLeave: '无薪假',
    makeupTag: '调休上班',
  },

  card: {
    earnedNow: '今天已经赚了',
    notStarted: '今天还没开始',
    // 未上班：金額是 0.00，標籤說明幾點開始計薪（時間取自設定）
    startPay: (hhmm) => `${hhmm} 开始计薪`,
    earnedTotal: '今天一共赚了',
    // 已下班（排定的工作日收工後）的正反饋：換掉標籤與「當前賺錢速度」格，不加行
    dayDone: '今天辛苦了，收工！',
    monthProgress: '已赚占月薪',
    monthProgressValue: (pct) => `${pct}%`,
    resting: '今天休息',
    restingHoliday: (name) => `今天休息 · ${name}`,
    toOff: (d) => `距下班 ${d}`,
    toStart: (d) => `距上班 ${d}`,
    resumeIn: (n) => `${n} 分钟后继续上班`,
    nextWorkday: (n) => `距下个工作日 ${n} 天`,
    paidNote: '今天按全天计薪',
    // 無薪假：不顯示金額，標籤就是結論
    unpaidLabel: '今天不计薪',
    // 工時：已工作 2小時0分 / 共 7小時（小時、分鐘由 format.js 拆出，單位寫在這裡）
    worked: (a, b) => `已工作 ${a} / 共 ${b}`,
    spanHM: (h, m) => (h > 0 ? `${h}小时${m}分` : `${m}分`),
    spanH: (h, m) => (m === 0 ? `${h}小时` : h > 0 ? `${h}小时${m}分` : `${m}分`),
    workedDone: (h, m) => `今天工作满 ${h}小时${m === 0 ? '' : `${m}分`}`,
    progressLabel: '工时进度',
    rate: '当前赚钱速度',
    rateUnit: '/秒',
    lunchEnds: '午休结束',
    month: '本月累计',
    hourly: '时薪',
    dailyFull: '今日满勤可得',
    payIn: (n) => `距发薪日 ${n} 天`,
    payToday: '今天发薪',
    // 缺假期表的標籤（R41）：只在當年與之後的年份顯示；措辭按該年實際標出的日子
    // lunar：2028–2035（含春節 / 清明 / 端午 / 中秋）；fixed：其他 ≥ 2025 的年份（只有六個固定日期）；none：< 2025（什麼都沒標）
    yearMissing: (year) => `${year} 年只标了法定假日，补假和调休未标出`,
    // R49：只說 app 知道什麼（未內建 / 未標出），不斷言放假安排是否已公佈
    yearMissingLong: (year) => `${year} 年假期表未内置：已按《放假办法》标出法定假日本身；补假、调休和延长的假日未标出`,
    // names = 實際標出的固定日期節日名（由 holidays-cn.js 的 STATUTORY_FIXED 取得，不在這裡寫死）
    yearMissingFixed: (year, names) => `${year} 年只标了${names.join('、')}`,
    yearMissingFixedLong: (year) => `${year} 年假期表未内置：只按《放假办法》标出固定日期的法定假日（元旦、劳动节、国庆）；其余假日和补假、调休未标出`,
    yearMissingNone: (year) => `${year} 年未标法定假日`,
    yearMissingNoneLong: (year) => `${year} 年假期表未内置，没有标出任何法定假日`,
    gear: '收回小窗并打开基本设置',
    srSummary: (badge, yuan) => `${badge}，今天已赚 ${yuan} 元`,
  },

  currency: '¥',
  // 倒數佔位文本：分、秒的數字補成兩位最寬（88），用來固定倒數格的寬度（card.js）
  durationWidest: (text) => text.replace(/\d+(?=[分秒])/g, '88'),
  duration: (h, m, s) => (h > 0 ? `${h}小时${m}分${s}秒` : `${m}分${s}秒`),
  weekdays: ['周日', '周一', '周二', '周三', '周四', '周五', '周六'],

  lunar: {
    months: ['正月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '冬月', '腊月'],
    digits: ['一', '二', '三', '四', '五', '六', '七', '八', '九'],
    leap: '闰', first: '初', ten: '十', twenty: '二十', twenties: '廿', thirty: '三十',
    full: (month, day) => `农历${month}${day}`,
  },

  settings: {
    region: {
      label: '地区',
      options: { TW: '台湾', CN: '中国大陆' },
      hint: '两地的月薪和月历标记分开保存，不做汇率换算。',
      salaryNote: {
        TW: { text: '示例月薪 NT$40,000 由主计总处 2025 年工业及服务业本国籍全时受雇员工每月经常性薪资中位数 39,890 元向上取整至千元，并非全体员工或总薪资中位数。请改成实际月薪。', sources: [{ label: '主计总处', href: 'https://www.dgbas.gov.tw/News_Content.aspx?n=3602&s=235863' }] },
        CN: { text: '示例月薪 ¥5,000 取第三方对 2024 年全国雇员月薪中位数 5,000–5,150 元估计区间的下限，按百元向上取整；非官方统计，原文无法读取，范围与方法未独立核实。请改成实际月薪。', sources: [{ label: '第三方估计', href: 'https://zhuanlan.zhihu.com/p/2015685656777609855' }] },
      },
      sourcesLabel: '来源：',
      lunchOffPay: '关闭后，午休时段仍计入工时和薪资。',
    },
    autosaved: '已自动保存',
    // 分割槽導航（窄面板 / 手機單欄才顯示）：名字與卡片標題一致，跳到已有的卡片
    navLabel: '跳到设置分区',
    sections: {
      pay: '工资与上班时间', holiday: '假期数据', backup: '数据与备份', other: '其他设置', advanced: '高级设置',
      display: '画面设置',
    },
    payDesc: '用来计算每天、每秒赚多少，修改后自动保存',
    // M12：只說卡里有什麼，一行放得下（聯網更新 / 匯入的說明已寫在按鈕下方）
    holidayDesc: (years) => `法定节假日与调休安排，已内置 ${years.join('、')} 年`,
    backupDesc: '设置只保存在这个浏览器里，不会上传。',
    advancedSub: '一般不用改',
    // 展開 / 收起的小三角（與 banner.closeGlyph 一樣放在文案裡）
    chevronClosed: '▸',
    chevronOpen: '▾',
    salaryUnit: '元 / 月',
    // 示例月薪的口徑與出處較長：預設收起，這句是輸入框旁展開鈕的文字
    salaryNoteToggle: '说明',
    // 讀屏用全名；不含「月薪」二字，避免與輸入框的 getByLabel 定位衝突
    salaryNoteToggleAria: '示例说明与来源',
    workTime: '上下班时间',
    lunchTime: '午休时间',
    to: '至',
    on: '开',
    off: '关',
    salary: '月薪',
    salaryError: '请输入大于 0 的数字，只用半角数字、不加逗号，例如 6800',
    start: '上班时间',
    end: '下班时间',
    lunchOn: '午休',
    showLunar: '显示农历',
    theme: '主题色',
    themeOptions: { green: '自然绿', blue: '海洋蓝', orange: '暖橙', teal: '湖水青', rose: '莓果红', slate: '沉稳灰', rainbow: '柔光彩虹' },
    lunarSource: '农历数据来源：香港天文台《公历与农历日期对照表》（2020–2060）。2057 年部分日期因历法边界不确定而不显示。',
    lunchOffHint: '关闭后，午休时段也计为工时',
    lunchStart: '午休开始时间',
    lunchEnd: '午休结束时间',
    cheer: '鼓励语',
    cheerPlaceholder: '写一句给自己的话',
    cheerHint: '会显示在左侧状态卡上',
    cheerCount: (n, max) => `${n}/${max}`,
    cheerAdd: '再加一句',
    cheerItemLabel: (n) => `第 ${n} 句鼓励的话`,
    cheerRemoveAria: (n) => `删除第 ${n} 句`,
    weekends: '周末上班',
    weekendsHint: '打开后，周六、周日也算工作日；个别调休上班日请在月历上标记',
    payday: '发薪日',
    paydayNone: '未设置',
    paydayHint: '设置后可显示发薪倒数；当月没有该日期时按月底计算。',
    paydayOption: (d) => `每月 ${d} 号`,
    // ---- 畫面設定：只管狀態卡顯示什麼，不改變任何計算 ----
    // 匯入報告按欄位名查標籤（import-model 的 t.settings[field]）：這些鍵在 settings 頂層也放一份，
    // 報告才不會顯示成生欄位名。介面上的標籤仍然用下面的 display.*（措辭為避開同名控制元件的歧義）。
    fontScale: '字号',
    showCardProgress: '显示进度条', showCardMetrics: '显示薪资明细', showCardDate: '显示日期',
    showCardPayday: '显示发薪提醒', showCardCheer: '显示鼓励内容',
    display: {
      desc: '状态卡显示哪些内容、字号多大；只影响显示，不改变任何计算',
      fontScale: '字号',
      fontScaleOptions: { xs: 'XS（特小）', s: 'S（小）', m: 'M（标准）', l: 'L（大）', xl: 'XL（特大）' },
      fontScaleHint: '默认中号，悬浮成小窗时也一样。',
      scope: '下面五个开关只决定状态卡显示什么，不会改变工时、薪资或月历的计算。',
      progress: '进度条',
      progressHint: '显示今天的进度与百分比。',
      metrics: '薪资明细',
      metricsHint: '显示本月累计、时薪等信息；不影响上方主要金额。',
      date: '日期',
      dateHint: '关闭后，农历日期也一起隐藏。',
      // 開關標籤不能與「發薪日」「鼓勵語」兩個輸入框的標籤同名：讀屏與 getByLabel 都按子串匹配，
      // 同名會讓「發薪日」一次命中兩個控制元件。這裡用「提醒 / 文字」區分「顯示的是什麼」，提示語裡再寫全稱。
      payday: '发薪提醒',
      paydayHint: '没设置发薪日时本来就不显示。',
      cheer: '鼓励内容',
      cheerHint: '那句鼓励语仍保存在设置里。',
      statusNote: '「上班中」「午休」「已下班」这些状态标签不受开关影响，始终显示。',
    },
    other: {
      desc: '桌面版与系统整合设置，不影响工时、薪资或月历计算。',
      loginItem: '开机自动启动并打开小窗',
      loginItemHint: '仅限桌面版；系统停用或要求批准时，请在系统设置中处理。此项不会导出到备份。',
      loginItemError: '无法更新开机启动设置，已恢复为系统当前状态。',
    },
    backup: {
      export: '导出备份',
      import: '导入备份',
      note: '备份文件含月薪，请妥善保管',
      // 一段說清「備份裡有什麼、什麼時候用、怎麼恢復」；按鈕就在下面，不再各寫一段導語
      summary: '备份文件含月薪、上下班时间、主题色和月历标记。换电脑或清除浏览数据前导出，之后用「导入备份」恢复。',
      // 只是說明現狀（備份內容不變，Kevin 2026-11-04）
      scope: '备份不含联网取得或导入的假期表和自定义数据网址。',
    },
  },

  calendar: {
    title: '月历',
    prev: '‹ 上月',
    next: '下月 ›',
    today: '回到今天',
    todayBack: (title) => `回到今天 · ${title}`,
    monthTitle: (y, m) => `${y} 年 ${m} 月`,
    // 「上月」「下月」按鈕的懸停提示：順帶說明焦點在日期格上時可按 PgUp / PgDn 切月（工具列不放鍵盤提示，R29）
    prevTitle: '上月（PgUp）',
    nextTitle: '下月（PgDn）',
    summary: (days, wage) => `本月应出勤 ${days} 天 · 日薪 ${wage}`,
    legendHint: '点日期可标记：调休上班 · 带薪假 · 无薪假',
    legendHintShort: '点日期可标记',
    // 摘要行的情境膠囊（R36 / 決定 4）：放假區間與調休上班日取自該月實際使用的表；「依據」按該年資料來源如實寫
    context: {
      noHoliday: '本月没有法定假日',
      noneMarked: '本月没有已标出的法定假日',
      noData: (y) => `没有 ${y} 年的假期数据，未标出假日`,
      range: (a, b) => (a === b ? a : `${a}–${b}`),
      md: (m, d) => `${m}/${d}`,
      // 按節日分組、按各組最早的日期排序；組內先放假後調休：「國慶 9/20 調休上班；中秋 9/25–9/27 放假」
      off: (ranges) => `${ranges.join('、')} 放假`,
      makeup: (days) => `${days.join('、')} 调休上班`,
      group: (name, parts) => `${name} ${parts.join('，')}`,
      join: (groups) => groups.join('；'),
      sub: (basis) => `· ${basis}`,
      basis: {
        builtin: (y) => `依据 ${y} 年国务院放假通知`,
        online: (y) => `依据联网取得的 ${y} 年放假数据`,
        file: (y) => `依据导入的 ${y} 年假期表`,
        // R49：無表年份按實際標出的日子分開寫（2028–2035 含農曆 / 節氣日；其他年份只有固定日期）
        lunar: '按《放假办法》标出法定假日本身；补假、调休和延长的假日未标出',
        fixed: '按《放假办法》只标出固定日期的法定假日；其余假日和补假、调休未标出',
      },
    },
    reset: '重置本月标记',
    undoMark: '撤销上次标记',
    legend: '图例',
    weekHeads: ['一', '二', '三', '四', '五', '六', '日'],
    kinds: {
      workday: '工作日',
      weekend: '周末',
      rest: '休息日',
      holiday: '法定假日',
      makeup: '调休上班',
      paid: '带薪假',
      unpaid: '无薪假',
    },
    todayLabel: '今天',
    manual: '手动标记',
    manualTitle: '已手动标记',
    // 法定假日格不再有文字標籤（只有旗子圖示 + 節日名，Task 18）
    tags: { makeup: '班', paid: '带薪', unpaid: '无薪', rest: '休' },
    cellAria: ({ month, day, weekday, kind, holidayName, manual, today }) =>
      `${month}月${day}日 ${weekday}，${today ? '今天，' : ''}${kind}${holidayName ? `（${holidayName}）` : ''}${manual ? '，已手动标记' : ''}，按回车打开菜单`,
    marked: (md, label) => `${md} 已标记为${label}`,
    cleared: (md) => `${md} 已恢复默认`,
    resetDone: '已重置本月标记',
    undo: '撤销',
    // 撤銷後（按鈕仍只寫「撤銷」，不提示快捷鍵）
    undoDone: '已撤销上一次标记',
    undoPartial: (done, skipped) => `已撤销 ${done} 天，另有 ${skipped} 天已在别处改过，保持不变`,
    undoStale: '上一次标记已在别处改过，没有撤销',
    // 標記沒寫進儲存：仍然給撤銷按鈕，但不謊稱已儲存
    unsaved: (msg) => `${msg}（未能保存，请先导出备份）`,
    dayTitle: (month, day, weekday) => `${month}月${day}日 ${weekday}`,
    todaySuffix: '（今天）',
    // 日期的狀態文字（選單標題與提示共用）
    status: {
      workday: '工作日',
      rest: '休息日',
      holiday: (name) => (name ? `法定假日（${name}）` : '法定假日'),
      makeup: (name) => (name ? `调休上班（${name}）` : '调休上班'),
      paid: '带薪假',
      unpaid: '无薪假',
    },
    // 點日期彈出的小選單
    menu: {
      header: (title, status) => `${title} · ${status}`,
      options: { work: '改为上班（调休）', rest: '改为休息（调休）', paidLeave: '带薪假', unpaidLeave: '无薪假' },
      // 「恢復預設」說清楚預設是哪一種（M18）：按這一天的預設型別給出三種之一
      defaultWork: '恢复为工作日',
      defaultRest: '恢复为休息日',
      defaultHoliday: '恢复为法定假日',
      preview: (from, to) => `日薪 ${from} → ${to}`,
      unchanged: '日薪不变',
      // 各項的說明（H7）：說結論，不用「日薪」這種內部說法
      paidNote: '照常计薪',
      unpaidNote: (yuan) => `这天不计薪（本月少 ${yuan}）`,
      restPreview: (before, after) => `月薪不变，每天 ${before} → ${after}`,
      noWorkdays: '本月没有上班日，不计薪',
      footer: '月薪固定，按当月上班天数平分',
    },
    // 懸停 / 聚焦提示
    tip: {
      source: (label) => `来源：${label}`,
      sources: { builtin: '内置·官方通知', online: '联网更新', file: '导入文件', manual: '手动标记', rule: '按周末规则', statutory: '法定日期（《放假办法》）', default: '按默认规则' },
      pay: (yuan) => `当日计薪 ${yuan}`,
      payShort: (yuan) => `计薪 ${yuan}`,
      // 蓋在格子上的提示（R50）：狀態不用括號、「今天」放進狀態行；來源用短寫（完整說法仍在 aria-describedby）
      statusShort: { holiday: (name) => (name ? `法定假日·${name}` : '法定假日'), makeup: (name) => (name ? `调休上班·${name}` : '调休上班') },
      todayTag: (status) => `${status}·今天`,
      sourcesShort: { statutory: '《放假办法》' },
      hint: '点击修改',
      join: (parts) => parts.join('，'),
    },
  },

  importer: {
    success: '导入成功',
    fail: '导入失败：无法识别这个文件。当前设置没有被修改。',
    failReason: (r) => `原因：${r}`,
    retry: '重新选择文件',
    reportTitle: (n, m) => `已导入 ${n} 项，${m} 项未导入`,
    cols: ['项目', '原因', '现在使用的值'],
    keep: (v) => `保留当前值 ${v}`,
    unknownReason: '无法识别的字段，已忽略',
    none: '—',
    emptyValue: '未设置',
    marksField: '月历标记',
    markField: (key) => `月历标记 ${key}`,
    markValues: { work: '调休上班', rest: '休息日', paidLeave: '带薪假', unpaidLeave: '无薪假' },
    unmarked: '未标记',
    ok: '知道了',
    goFix: '去设置里修改',
  },

  exporter: {
    done: '已导出 · 文件含月薪，请妥善保管',
    filename: (ymd) => `work-motivator-backup-${ymd}.json`,
  },
};
