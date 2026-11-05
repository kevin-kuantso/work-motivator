// Task 14：摘要行情境胶囊（决定 4）与缺假期表标签（R41）的纯函数。
import test from 'node:test';
import assert from 'node:assert/strict';
import { monthContext, monthHolidays, missingTableTag, noTableKind } from '../src/ui/holiday-context.js';
import { HOLIDAYS_CN } from '../src/holidays-cn.js';
import { STRINGS as t } from '../src/strings.zh-CN.js';

const NOW = new Date(2026, 10, 4, 10); // 注入的「今天」：2026-11-04
const ctx = (y, m, tables = HOLIDAYS_CN, today = NOW) => monthContext(y, m - 1, tables, today, t);
const online2027 = { off: { '2027-01-01': '元旦', '2027-01-02': '元旦', '2027-01-03': '元旦' }, makeup: {}, source: 'online' };

test('built-in year, month without holidays: dashed ✓ 「本月没有法定假日 · 依据 2026 年国务院放假通知」', () => {
  assert.deepEqual(ctx(2026, 11), {
    tone: 'none', check: true, text: '本月没有法定假日', sub: '· 依据 2026 年国务院放假通知',
    title: '本月没有法定假日 · 依据 2026 年国务院放假通知',
  });
  assert.equal(ctx(2026, 3).text, '本月没有法定假日');
});

test('built-in months with holidays: off ranges grouped by name, make-up days listed (name only when it differs)', () => {
  const oct = ctx(2026, 10);
  assert.equal(oct.text, '国庆 10/1–10/7 放假，10/10 调休上班');
  assert.equal(oct.tone, 'holiday');
  assert.equal(oct.check, false);
  assert.equal(oct.sub, null, 'mock: holiday months show only the ranges');
  assert.equal(oct.title, '国庆 10/1–10/7 放假，10/10 调休上班 · 依据 2026 年国务院放假通知');
  assert.equal(ctx(2026, 9).text, '国庆 9/20 调休上班；中秋 9/25–9/27 放假', 'date order; 9/20 belongs to 国庆, not 中秋');
  assert.equal(ctx(2026, 2).text, '春节 2/15–2/23 放假，2/14、2/28 调休上班');
  assert.equal(ctx(2026, 1).text, '元旦 1/1–1/3 放假，1/4 调休上班');
  assert.equal(ctx(2026, 5).text, '劳动节 5/1–5/5 放假，5/9 调休上班');
  assert.equal(ctx(2026, 4).text, '清明 4/4–4/6 放假');
  assert.equal(ctx(2026, 6).text, '端午 6/19–6/21 放假');
});

test('online and imported tables: the basis says where the data came from, never 「国务院」', () => {
  const on = ctx(2027, 3, { ...HOLIDAYS_CN, 2027: online2027 });
  assert.equal(on.sub, '· 依据联网取得的 2027 年放假数据');
  assert.equal(on.check, true);
  assert.equal(ctx(2027, 1, { ...HOLIDAYS_CN, 2027: online2027 }).text, '元旦 1/1–1/3 放假');
  const file = ctx(2027, 3, { ...HOLIDAYS_CN, 2027: { ...online2027, source: 'file' } });
  assert.equal(file.sub, '· 依据导入的 2027 年假期表');
  assert.doesNotMatch(file.title, /国务院/);
  // 来源不明（理论上不会出现）：不写任何依据，也不打 ✓
  const odd = ctx(2027, 3, { ...HOLIDAYS_CN, 2027: { ...online2027, source: 'weird' } });
  assert.deepEqual([odd.check, odd.sub, odd.title], [false, null, '本月没有法定假日']);
});

test('no-table current / future years (tag shown in the same row): ranges only, basis in title; never an official claim', () => {
  const jan = ctx(2027, 1);
  assert.equal(jan.text, '元旦 1/1 放假');
  assert.equal(jan.sub, null, 'the missing-table tag already explains it');
  assert.equal(jan.title, '元旦 1/1 放假 · 按《放假办法》标出法定假日本身；补假、调休和延长的假日未标出');
  assert.equal(jan.check, false);
  assert.equal(ctx(2027, 2).text, '春节 2/5–2/8 放假', 'R40 lunar days');
  const mar = ctx(2027, 3);
  assert.deepEqual([mar.tone, mar.check, mar.text], ['unknown', false, '本月没有已标出的法定假日']);
  assert.equal(ctx(2036, 1).text, '元旦 1/1 放假', '2036: fixed days only');
  assert.equal(ctx(2036, 2).text, '本月没有已标出的法定假日', '2036: no lunar data, nothing claimed');
  for (const [y, m] of [[2027, 1], [2027, 3], [2036, 1], [2036, 2]]) assert.doesNotMatch(ctx(y, m).title, /国务院|依据/, `${y}-${m}`);
});

test('no-table PAST years: no tag; the pill states what the app marked (R49: fixed-only wording for 2025, never 「待公布」)', () => {
  const oct = ctx(2025, 10);
  assert.equal(oct.text, '国庆 10/1–10/3 放假');
  assert.equal(oct.sub, null, 'round 2: basis in title only, same as current / future years');
  assert.equal(oct.title, '国庆 10/1–10/3 放假 · 按《放假办法》只标出固定日期的法定假日；其余假日和补假、调休未标出');
  const mar = ctx(2025, 3);
  assert.equal(mar.text, '本月没有已标出的法定假日');
  assert.equal(mar.sub, null);
  assert.equal(mar.title, '本月没有已标出的法定假日 · 按《放假办法》只标出固定日期的法定假日；其余假日和补假、调休未标出');
  assert.doesNotMatch(oct.title + mar.title, /待公布|国务院/);
  // 2027 也会变成过去：今天是 2028 年时
  assert.equal(ctx(2027, 1, HOLIDAYS_CN, new Date(2028, 0, 5)).title, '元旦 1/1 放假 · 按《放假办法》标出法定假日本身；补假、调休和延长的假日未标出', 'a past lunar year keeps the lunar wording (title)');
});

test('years before 2025 without a table: nothing is marked and the pill says so', () => {
  // round 3：同一行有「2024 年未标法定假日」标签，胶囊只写本月事实，长说明在 title
  assert.deepEqual(ctx(2024, 10), { tone: 'unknown', check: false, text: '本月没有已标出的法定假日', sub: null, title: '没有 2024 年的假期数据，未标出假日' });
});

test('collisions and grouping: 2028-10-03 (国庆 + 中秋) once as 国庆; same name split into two runs; several names in a month', () => {
  assert.equal(ctx(2028, 10).text, '国庆 10/1–10/3 放假');
  assert.equal(ctx(2031, 10).text, '国庆 10/1–10/3 放假', '2031-10-01 中秋 collides with 国庆');
  const tb = {
    ...HOLIDAYS_CN,
    2027: {
      off: { '2027-05-01': '劳动节', '2027-05-02': '劳动节', '2027-05-05': '劳动节', '2027-05-31': '端午' },
      makeup: { '2027-05-08': '劳动节', '2027-05-29': '端午', '2027-05-30': '端午' },
      source: 'file',
    },
  };
  assert.equal(ctx(2027, 5, tb).text, '劳动节 5/1–5/2、5/5 放假，5/8 调休上班；端午 5/31 放假，5/29、5/30 调休上班');
  // 调休上班日只有、没有放假日的月份：写出节日名
  const only = { ...HOLIDAYS_CN, 2027: { off: { '2027-10-01': '国庆' }, makeup: { '2027-09-26': '国庆' }, source: 'online' } };
  assert.equal(ctx(2027, 9, only).text, '国庆 9/26 调休上班');
});

test('monthHolidays ignores manual marks and the weekends switch (pure table / statutory data)', () => {
  const h = monthHolidays(2026, 9, HOLIDAYS_CN);
  assert.deepEqual(h.off.map((x) => x.day), [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(h.makeup, [{ name: '国庆', day: 10 }]);
});

test('R41 (amended round 3) missing-table tag: every no-table year, past or future; wording follows what is actually marked', () => {
  assert.equal(missingTableTag(2026, NOW, HOLIDAYS_CN, t), null, 'has a table');
  assert.equal(missingTableTag(2025, NOW, HOLIDAYS_CN, t).text, '2025 年调休安排未内置，只标了节日', 'past year: visible qualifier too (round 3)');
  assert.deepEqual(missingTableTag(2027, NOW, HOLIDAYS_CN, t), {
    kind: 'lunar', text: '2027 年调休安排未内置，只标了节日',
    title: '2027 年假期表未内置：已按《放假办法》标出法定假日本身；补假、调休和延长的假日未标出',
  });
  assert.equal(missingTableTag(2027, NOW, { ...HOLIDAYS_CN, 2027: online2027 }, t), null, 'online table');
  const f = missingTableTag(2036, NOW, HOLIDAYS_CN, t);
  assert.equal(f.kind, 'fixed');
  assert.equal(f.text, '2036 年调休安排未内置，只标了节日');
  assert.match(f.title, /元旦、劳动节、国庆/);
  assert.ok([...f.text].filter((c) => /\p{Script=Han}/u.test(c)).length <= 14, '≤ 14 CJK characters');
  assert.equal(missingTableTag(2035, new Date(2035, 5, 1), HOLIDAYS_CN, t).kind, 'lunar');
  assert.equal(missingTableTag(2027, new Date(2028, 0, 1), HOLIDAYS_CN, t).kind, 'lunar', 'a past lunar year keeps its tag');
  assert.equal(missingTableTag(2025, new Date(2025, 5, 1), HOLIDAYS_CN, t).kind, 'fixed', '2025 current (clock in 2025): fixed days only');
  assert.equal(missingTableTag(2024, new Date(2024, 5, 1), HOLIDAYS_CN, t).text, '2024 年未标法定假日');
  assert.deepEqual([2024, 2025, 2026, 2027, 2035, 2036].map(noTableKind), ['none', 'fixed', 'fixed', 'lunar', 'lunar', 'fixed']);
});

// R49（fix round 1 · C1）：说 app 知道什么（未内置 / 未标出），不说世界的状态（未公布 / 待公布）；fixed 与 lunar 年份措辞分开；
// 胶囊、title、标签彼此一致
test('R49: 2025-01 / 2025-10 / 2036-01 / 2036-05 / 2036-07 — pill, title and tag agree; fixed years never claim lunar days', () => {
  const all = [];
  for (const [y, m, today, text, tagKind] of [
    [2025, 1, NOW, '元旦 1/1 放假', 'fixed'],
    [2025, 10, NOW, '国庆 10/1–10/3 放假', 'fixed'],
    [2036, 1, NOW, '元旦 1/1 放假', 'fixed'],
    [2036, 5, NOW, '劳动节 5/1–5/2 放假', 'fixed'],
    [2036, 7, NOW, '本月没有已标出的法定假日', 'fixed'],
    [2025, 2, new Date(2025, 1, 3), '本月没有已标出的法定假日', 'fixed'],
  ]) {
    const c = ctx(y, m, HOLIDAYS_CN, today);
    const tag = missingTableTag(y, today, HOLIDAYS_CN, t);
    assert.equal(c.text, text, `${y}-${m}`);
    assert.equal(tag?.kind ?? null, tagKind, `${y}-${m} tag`);
    assert.match(c.title, /只标出固定日期的法定假日；其余假日和补假、调休未标出$/, `${y}-${m} title`);
    assert.equal(c.sub, null, 'basis in title for every no-table kind (round 2)');
    if (tag) {
      assert.equal(tag.text, `${y} 年调休安排未内置，只标了节日`);
      assert.match(tag.title, /只按《放假办法》标出固定日期的法定假日（元旦、劳动节、国庆）/);
    }
    all.push(c.title, c.sub ?? '', tag?.title ?? '', tag?.text ?? '');
  }
  const joined = all.join('|');
  assert.doesNotMatch(joined, /未公布|待公布|国务院|依据/);
  assert.doesNotMatch(joined, /标出法定假日本身/, 'fixed years do not use the lunar sentence');
  // 2027（lunar）对照：用 lunar 句子
  assert.match(ctx(2027, 2).title, /标出法定假日本身；补假、调休和延长的假日未标出$/);
  assert.doesNotMatch(missingTableTag(2027, NOW, HOLIDAYS_CN, t).title + missingTableTag(2036, NOW, HOLIDAYS_CN, t).title + missingTableTag(2024, new Date(2024, 0, 1), HOLIDAYS_CN, t).title, /未公布|待公布/);
});
