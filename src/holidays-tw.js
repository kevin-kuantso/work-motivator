// 臺灣「政府行政機關辦公日曆表」內建年表（靜態資料，不連網）。
// 來源：行政院人事行政總處《中華民國政府行政機關辦公日曆表》，政府資料開放平臺資料集 14718。
//   2026（民國 115 年）https://www.dgpa.gov.tw/FileConversion?filename=dgpa/files/202506/a52331bd-a189-466b-b0f0-cae3062bbf74.csv&nfix=&name=115%e5%b9%b4%e4%b8%ad%e8%8f%af%e6%b0%91%e5%9c%8b%e6%94%bf%e5%ba%9c%e8%a1%8c%e6%94%bf%e6%a9%9f%e9%97%9c%e8%be%a6%e5%85%ac%e6%97%a5%e6%9b%86%e8%a1%a8.csv
//   2027（民國 116 年）https://www.dgpa.gov.tw/FileConversion?filename=dgpa/files/202607/f538b1ff-ba60-4c63-9477-10db8e6612d1.csv&nfix=&name=116%e5%b9%b4%e4%b8%ad%e8%8f%af%e6%b0%91%e5%9c%8b%e6%94%bf%e5%ba%9c%e8%a1%8c%e6%94%bf%e6%a9%9f%e9%97%9c%e8%be%a6%e5%85%ac%e6%97%a5%e6%9b%86%e8%a1%a8_utf8bom.csv
// 兩份 CSV 已逐日（365 天）比對過：只有「放假」且有名稱的日子寫進 off；兩年都沒有補班日
// （官方 CSV 每一列 status=0 都是沒有備註的平日），因此 makeup 為空。
// 節名一律保留官方原文；缺名的一般放假日才由字典補「放假」。
// 政府行政機關日曆不等同所有勞工的法定休假，薪資為估算；商業再散布的授權範圍尚待法務確認（legalReview）。
// 官方節名（繁體，保留原文；不從農曆顯示推測）。
const N = Object.freeze({
  founding: '開國紀念日',
  eve: '小年夜',
  newYearEve: '農曆除夕',
  spring: '春節',
  shift: '補假',
  peace: '和平紀念日',
  children: '兒童節',
  tomb: '清明節',
  labour: '勞動節',
  dragonBoat: '端午節',
  midAutumn: '中秋節',
  teachers: '孔子誕辰紀念日/教師節',
  national: '國慶日',
  retrocession: '臺灣光復暨金門古寧頭大捷紀念日',
  constitution: '行憲紀念日',
});

const pad = (n) => String(n).padStart(2, '0');

// days: [[月, 日, 節名], ...]；years 的每天都必須不重複（重複即為資料錯誤，這裡直接讓它覆寫前值會靜默出錯，
// 所以用 freeze 前的檢查把關）。
function build(year, offDays) {
  const off = {};
  for (const [month, day, name] of offDays) {
    const key = `${year}-${pad(month)}-${pad(day)}`;
    if (Object.prototype.hasOwnProperty.call(off, key)) throw new Error(`duplicate builtin TW date ${key}`);
    off[key] = name;
  }
  return Object.freeze({ off: Object.freeze(off), makeup: Object.freeze({}), source: 'builtin' });
}

// 2026：放假 22 天（含 6 個補假），無補班日。
const Y2026 = build(2026, [
  [1, 1, N.founding],
  [2, 15, N.eve],
  [2, 16, N.newYearEve],
  [2, 17, N.spring],
  [2, 18, N.spring],
  [2, 19, N.spring],
  [2, 20, N.shift],
  [2, 27, N.shift],
  [2, 28, N.peace],
  [4, 3, N.shift],
  [4, 4, N.children],
  [4, 5, N.tomb],
  [4, 6, N.shift],
  [5, 1, N.labour],
  [6, 19, N.dragonBoat],
  [9, 25, N.midAutumn],
  [9, 28, N.teachers],
  [10, 9, N.shift],
  [10, 10, N.national],
  [10, 25, N.retrocession],
  [10, 26, N.shift],
  [12, 25, N.constitution],
]);

// 2027：放假 24 天（含 8 個補假），無補班日；2/11、2/12 為上班日（不在此表）。
const Y2027 = build(2027, [
  [1, 1, N.founding],
  [2, 4, N.eve],
  [2, 5, N.newYearEve],
  [2, 6, N.spring],
  [2, 7, N.spring],
  [2, 8, N.spring],
  [2, 9, N.shift],
  [2, 10, N.shift],
  [2, 28, N.peace],
  [3, 1, N.shift],
  [4, 4, N.children],
  [4, 5, N.tomb],
  [4, 6, N.shift],
  [4, 30, N.shift],
  [5, 1, N.labour],
  [6, 9, N.dragonBoat],
  [9, 15, N.midAutumn],
  [9, 28, N.teachers],
  [10, 10, N.national],
  [10, 11, N.shift],
  [10, 25, N.retrocession],
  [12, 24, N.shift],
  [12, 25, N.constitution],
  [12, 31, N.shift],
]);

// table[year] = { off, makeup, source:'builtin' }：與中國年表同形，calendar.js 直接讀。
// 整份唯讀：內建表不可被覆蓋（儲存層的 mayReplace 已擋，這裡再加一層，避免被就地改寫）。
export const TW_BUILTIN_TABLES = Object.freeze({ 2026: Y2026, 2027: Y2027 });

export const TW_BUILTIN_YEARS = Object.freeze([2026, 2027]);

// 資料集本身（畫面的「資料來源與授權」用；程式不連線抓取，臺灣只接受手動匯入的官方 CSV）。

// 每個內建年份的官方出處（畫面的「資料來源與授權」用；不改動表本身）。
// updatedAt 取自資料集資源的 resourceQualityCheckTime；dataModifiedAt 是資料集本身的 modifiedDate。
export const TW_DATASET = Object.freeze({
  id: 14718,
  identifier: 'A58000000A-000166',
  title: '中華民國政府行政機關辦公日曆表',
  publisher: '行政院人事行政總處',
  modifiedDate: '2026-07-15 11:29:25',
  coverageEndedDate: '2027-12-31',
  license: '政府資料開放授權條款－第1版',
  licenseUrl: 'https://data.gov.tw/license',
  licensePublishedAt: '2015-07-27',
  // 內建表內嵌散布的授權範圍（商業再散布）尚未經法務確認，畫面必須照實說明。
  legalReview: 'unresolved',
});

export const TW_BUILTIN_SOURCES = Object.freeze({
  2026: Object.freeze({
    rocYear: 115,
    description: '115年中華民國政府行政機關辦公日曆表',
    url: 'https://www.dgpa.gov.tw/FileConversion?filename=dgpa/files/202506/a52331bd-a189-466b-b0f0-cae3062bbf74.csv&nfix=&name=115%e5%b9%b4%e4%b8%ad%e8%8f%af%e6%b0%91%e5%9c%8b%e6%94%bf%e5%ba%9c%e8%a1%8c%e6%94%bf%e6%a9%9f%e9%97%9c%e8%be%a6%e5%85%ac%e6%97%a5%e6%9b%86%e8%a1%a8.csv',
    encoding: 'UTF-8',
    updatedAt: '2026-07-15 11:30:22',
    retrievedAt: '2026-11-10',
    rows: 365,
  }),
  2027: Object.freeze({
    rocYear: 116,
    description: '116年中華民國政府行政機關辦公日曆表',
    url: 'https://www.dgpa.gov.tw/FileConversion?filename=dgpa/files/202607/f538b1ff-ba60-4c63-9477-10db8e6612d1.csv&nfix=&name=116%e5%b9%b4%e4%b8%ad%e8%8f%af%e6%b0%91%e5%9c%8b%e6%94%bf%e5%ba%9c%e8%a1%8c%e6%94%bf%e6%a9%9f%e9%97%9c%e8%be%a6%e5%85%ac%e6%97%a5%e6%9b%86%e8%a1%a8_utf8bom.csv',
    encoding: 'UTF-8',
    updatedAt: '2026-07-15 11:30:30',
    retrievedAt: '2026-11-10',
    rows: 365,
  }),
});
