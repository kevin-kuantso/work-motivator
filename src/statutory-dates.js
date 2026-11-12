// R40：沒有假期表的年份（2028–2035）裡，依農曆 / 節氣定日的法定假日本身的日期。
// 依據：《全國年節及紀念日放假辦法》（國務院令第 795 號修訂，2025-01-01 起施行）第二條：
//   春節 4 天（除夕、正月初一至初三）、清明節 1 天（清明當日）、端午節 1 天（農曆五月初五）、中秋節 1 天（農曆八月十五）。
//   https://www.gov.cn/zhengce/zhengceku/202411/content_6986381.htm
// 生成日期：2026-11-04。三種方法交叉核對：
//   1) 天文計算（JPL DE440s 星曆，北京時間）；2) 香港天文臺公佈的公曆農曆對照表；3) ICU（Intl 中國農曆）。
// 注意：2030 年春節，ICU 的結果差一天（新月在北京時間零點前後幾分鐘內）；
//   該年採用天文計算與香港天文臺一致的日期。
// 只含日期與鍵名；名稱通過鍵名對映到 strings.zh-CN.js 的 holidays.*。不得在執行時用 Intl 計算農曆。
// 補假、調休上班日、延長假日要等國辦年度通知，這裡不包含、不猜。
// 年度通知釋出後，該年改為內建整年日期表（見 holidays-cn.js），這裡就刪掉，避免留下用不到的舊資料。
export const STATUTORY_LUNAR = {
  2028: { spring: ['2028-01-25', '2028-01-26', '2028-01-27', '2028-01-28'], qingming: ['2028-04-04'], dragonBoat: ['2028-05-28'], midAutumn: ['2028-10-03'] },
  2029: { spring: ['2029-02-12', '2029-02-13', '2029-02-14', '2029-02-15'], qingming: ['2029-04-04'], dragonBoat: ['2029-06-16'], midAutumn: ['2029-09-22'] },
  2030: { spring: ['2030-02-02', '2030-02-03', '2030-02-04', '2030-02-05'], qingming: ['2030-04-05'], dragonBoat: ['2030-06-05'], midAutumn: ['2030-09-12'] },
  2031: { spring: ['2031-01-22', '2031-01-23', '2031-01-24', '2031-01-25'], qingming: ['2031-04-05'], dragonBoat: ['2031-06-24'], midAutumn: ['2031-10-01'] },
  2032: { spring: ['2032-02-10', '2032-02-11', '2032-02-12', '2032-02-13'], qingming: ['2032-04-04'], dragonBoat: ['2032-06-12'], midAutumn: ['2032-09-19'] },
  2033: { spring: ['2033-01-30', '2033-01-31', '2033-02-01', '2033-02-02'], qingming: ['2033-04-04'], dragonBoat: ['2033-06-01'], midAutumn: ['2033-09-08'] },
  2034: { spring: ['2034-02-18', '2034-02-19', '2034-02-20', '2034-02-21'], qingming: ['2034-04-05'], dragonBoat: ['2034-06-20'], midAutumn: ['2034-09-27'] },
  2035: { spring: ['2035-02-07', '2035-02-08', '2035-02-09', '2035-02-10'], qingming: ['2035-04-05'], dragonBoat: ['2035-06-10'], midAutumn: ['2035-09-16'] },
};

// 'YYYY-MM-DD' -> holidays.* 的鍵名（spring / qingming / dragonBoat / midAutumn）；不在表內為 null
const INDEX = {};
for (const year of Object.keys(STATUTORY_LUNAR)) {
  for (const [name, days] of Object.entries(STATUTORY_LUNAR[year])) for (const day of days) INDEX[day] = name;
}
export function statutoryLunarName(key) {
  return INDEX[key] ?? null;
}
