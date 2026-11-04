// R40：没有假期表的年份（2027–2035）里，依农历 / 节气定日的法定假日本身的日期。
// 依据：《全国年节及纪念日放假办法》（国务院令第 795 号修订，2025-01-01 起施行）第二条：
//   春节 4 天（除夕、正月初一至初三）、清明节 1 天（清明当日）、端午节 1 天（农历五月初五）、中秋节 1 天（农历八月十五）。
//   https://www.gov.cn/zhengce/zhengceku/202411/content_6986381.htm
// 生成日期：2026-11-04。三种方法交叉核对：
//   1) 天文计算（JPL DE440s 星历，北京时间）；2) 香港天文台公布的公历农历对照表；3) ICU（Intl 中国农历）。
// 注意：2027 与 2030 年春节，ICU 的结果差一天（新月在北京时间零点前后几分钟内）；
//   这两年采用天文计算与香港天文台一致的日期。
// 只含日期与键名；名称通过键名映射到 strings.zh-CN.js 的 holidays.*。不得在运行时用 Intl 计算农历。
// 补假、调休上班日、延长假日要等国办年度通知，这里不包含、不猜。
export const STATUTORY_LUNAR = {
  2027: { spring: ['2027-02-05', '2027-02-06', '2027-02-07', '2027-02-08'], qingming: ['2027-04-05'], dragonBoat: ['2027-06-09'], midAutumn: ['2027-09-15'] },
  2028: { spring: ['2028-01-25', '2028-01-26', '2028-01-27', '2028-01-28'], qingming: ['2028-04-04'], dragonBoat: ['2028-05-28'], midAutumn: ['2028-10-03'] },
  2029: { spring: ['2029-02-12', '2029-02-13', '2029-02-14', '2029-02-15'], qingming: ['2029-04-04'], dragonBoat: ['2029-06-16'], midAutumn: ['2029-09-22'] },
  2030: { spring: ['2030-02-02', '2030-02-03', '2030-02-04', '2030-02-05'], qingming: ['2030-04-05'], dragonBoat: ['2030-06-05'], midAutumn: ['2030-09-12'] },
  2031: { spring: ['2031-01-22', '2031-01-23', '2031-01-24', '2031-01-25'], qingming: ['2031-04-05'], dragonBoat: ['2031-06-24'], midAutumn: ['2031-10-01'] },
  2032: { spring: ['2032-02-10', '2032-02-11', '2032-02-12', '2032-02-13'], qingming: ['2032-04-04'], dragonBoat: ['2032-06-12'], midAutumn: ['2032-09-19'] },
  2033: { spring: ['2033-01-30', '2033-01-31', '2033-02-01', '2033-02-02'], qingming: ['2033-04-04'], dragonBoat: ['2033-06-01'], midAutumn: ['2033-09-08'] },
  2034: { spring: ['2034-02-18', '2034-02-19', '2034-02-20', '2034-02-21'], qingming: ['2034-04-05'], dragonBoat: ['2034-06-20'], midAutumn: ['2034-09-27'] },
  2035: { spring: ['2035-02-07', '2035-02-08', '2035-02-09', '2035-02-10'], qingming: ['2035-04-05'], dragonBoat: ['2035-06-10'], midAutumn: ['2035-09-16'] },
};

// 'YYYY-MM-DD' -> holidays.* 的键名（spring / qingming / dragonBoat / midAutumn）；不在表内为 null
const INDEX = {};
for (const year of Object.keys(STATUTORY_LUNAR)) {
  for (const [name, days] of Object.entries(STATUTORY_LUNAR[year])) for (const day of days) INDEX[day] = name;
}
export function statutoryLunarName(key) {
  return INDEX[key] ?? null;
}
