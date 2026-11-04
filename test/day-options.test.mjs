import test from 'node:test';
import assert from 'node:assert/strict';
import { dayInfo } from '../src/calendar.js';
import { HOLIDAYS_CN } from '../src/holidays-cn.js';
import { DEFAULTS } from '../src/settings.js';
import {
  dayOptions, applyOption, previewDailyWage, menuModel, dayTooltipModel, tooltipText,
} from '../src/ui/day-options.js';

const cfg = { ...DEFAULTS };
const at = (m, d, y = 2026) => new Date(y, m - 1, d);
const plain = (date, c = cfg, tables = HOLIDAYS_CN) => dayInfo(date, c, {}, tables);
const ids = (opts) => opts.map((o) => o.id);
const checked = (opts) => opts.filter((o) => o.checked).map((o) => o.id);
const round2 = (v) => Math.round(v * 100) / 100;

test('dayOptions: default rest day → [default, work]; default workday → [default, rest, paidLeave, unpaidLeave]', () => {
  const sat = dayOptions(plain(at(11, 7)));
  assert.deepEqual(ids(sat), ['default', 'work']);
  assert.deepEqual(checked(sat), ['default']);
  assert.deepEqual(ids(dayOptions(plain(at(10, 1)))), ['default', 'work'], 'legal holiday is a rest default');
  const wd = dayOptions(plain(at(11, 3)));
  assert.deepEqual(ids(wd), ['default', 'rest', 'paidLeave', 'unpaidLeave']);
  assert.deepEqual(checked(wd), ['default']);
  assert.deepEqual(ids(dayOptions(plain(at(10, 10)))), ['default', 'rest', 'paidLeave', 'unpaidLeave'], 'official make-up day is a work default');
  assert.deepEqual(ids(dayOptions(plain(at(11, 7, 2026), { ...cfg, weekends: true }))), ['default', 'rest', 'paidLeave', 'unpaidLeave']);
  for (const o of wd) assert.equal(typeof o.labelKey, 'string');
});

test('dayOptions: a marked day keeps the options of its DEFAULT type, current one checked', () => {
  assert.deepEqual(checked(dayOptions(plain(at(11, 7)), 'work')), ['work']);
  assert.deepEqual(checked(dayOptions(plain(at(11, 3)), 'unpaidLeave')), ['unpaidLeave']);
  assert.deepEqual(checked(dayOptions(plain(at(11, 3)), 'rest')), ['rest']);
  assert.deepEqual(ids(dayOptions(plain(at(11, 3)), 'rest')), ['default', 'rest', 'paidLeave', 'unpaidLeave']);
});

test('dayOptions: 2027 without a table falls back to the plain weekend rule', () => {
  const tables = HOLIDAYS_CN;
  assert.equal(tables[2027], undefined);
  assert.deepEqual(ids(dayOptions(plain(at(1, 1, 2027)))), ['default', 'work'], '2027-01-01 is a statutory rest day (R39)');
  assert.deepEqual(ids(dayOptions(plain(at(1, 4, 2027)))), ['default', 'rest', 'paidLeave', 'unpaidLeave']);
  assert.deepEqual(ids(dayOptions(plain(at(1, 2, 2027)))), ['default', 'work']);
});

test('applyOption maps option ids to marks exactly and never mutates', () => {
  const marks = { '2026-11-05': 'paidLeave' };
  assert.deepEqual(applyOption(marks, at(11, 7), 'work'), { '2026-11-05': 'paidLeave', '2026-11-07': 'work' });
  assert.deepEqual(applyOption(marks, at(11, 3), 'rest'), { '2026-11-05': 'paidLeave', '2026-11-03': 'rest' });
  assert.deepEqual(applyOption(marks, at(11, 3), 'unpaidLeave'), { '2026-11-05': 'paidLeave', '2026-11-03': 'unpaidLeave' });
  assert.deepEqual(applyOption(marks, at(11, 5), 'default'), {});
  assert.deepEqual(marks, { '2026-11-05': 'paidLeave' });
  assert.throws(() => applyOption(marks, at(11, 5), 'holiday'));
});

test('previewDailyWage with the defaults (6800, Nov 2026 = 21 workdays)', () => {
  assert.equal(round2(previewDailyWage(at(11, 7), cfg, {}, HOLIDAYS_CN, 'work')), 309.09, '6800 ÷ 22');
  assert.equal(round2(previewDailyWage(at(11, 3), cfg, {}, HOLIDAYS_CN, 'rest')), 340.00, '6800 ÷ 20');
  assert.equal(round2(previewDailyWage(at(11, 3), cfg, {}, HOLIDAYS_CN, 'paidLeave')), 323.81);
  assert.equal(round2(previewDailyWage(at(11, 3), cfg, {}, HOLIDAYS_CN, 'unpaidLeave')), 323.81);
  assert.equal(round2(previewDailyWage(at(11, 7), cfg, {}, HOLIDAYS_CN, 'default')), 323.81);
  assert.equal(round2(previewDailyWage(at(11, 7), cfg, { '2026-11-07': 'work' }, HOLIDAYS_CN, 'default')), 323.81, 'reverting a work mark');
  assert.equal(previewDailyWage(at(11, 3), { ...cfg, salary: 0 }, {}, HOLIDAYS_CN, 'rest'), 0);
});

test('menuModel: header, previews for denominator-changing options, footer', () => {
  const sat = menuModel(at(11, 7), cfg, {}, HOLIDAYS_CN);
  assert.equal(sat.header, '11月7日 周六 · 休息日');
  assert.deepEqual(sat.items.map((i) => [i.id, i.label, i.note, i.checked]), [
    ['default', '恢复默认', '当前', true],
    ['work', '改为上班（调休）', '日薪 ¥323.81 → ¥309.09', false],
  ]);
  assert.equal(sat.footer, '多一个上班日，日薪会变低；多一个休息日，日薪会变高（固定月薪 ÷ 当月应出勤天数）');
  const wd = menuModel(at(11, 3), cfg, {}, HOLIDAYS_CN);
  assert.equal(wd.header, '11月3日 周二 · 工作日');
  assert.deepEqual(wd.items.map((i) => [i.id, i.label, i.note]), [
    ['default', '恢复默认', '当前'],
    ['rest', '改为休息（调休）', '日薪 ¥323.81 → ¥340.00'],
    ['paidLeave', '带薪假', '日薪不变'],
    ['unpaidLeave', '无薪假', '日薪不变'],
  ]);
  assert.equal(menuModel(at(10, 1), cfg, {}, HOLIDAYS_CN).header, '10月1日 周四 · 法定假日（国庆）');
  assert.equal(menuModel(at(10, 10), cfg, {}, HOLIDAYS_CN).header, '10月10日 周六 · 调休上班（国庆）');
  const marked = menuModel(at(11, 7), cfg, { '2026-11-07': 'work' }, HOLIDAYS_CN);
  assert.equal(marked.header, '11月7日 周六 · 调休上班');
  assert.deepEqual(marked.items.map((i) => [i.id, i.note, i.checked]), [
    ['default', '日薪 ¥309.09 → ¥323.81', false],
    ['work', '当前', true],
  ]);
  assert.equal(menuModel(at(11, 3), cfg, { '2026-11-03': 'paidLeave' }, HOLIDAYS_CN).header, '11月3日 周二 · 带薪假');
  assert.equal(menuModel(at(11, 3), cfg, { '2026-11-03': 'rest' }, HOLIDAYS_CN).header, '11月3日 周二 · 休息日');
});

test('dayTooltipModel: status, source label and pay for every day type', () => {
  const tip = (date, marks = {}, tables = HOLIDAYS_CN, c = cfg) => dayTooltipModel(date, c, marks, tables, at(11, 3));
  const wd = tip(at(11, 4));
  assert.deepEqual(wd, { title: '11月4日 周三', status: '工作日', source: '来源：按默认规则', pay: '当日计薪 ¥323.81', hint: '点击修改' });
  assert.equal(tip(at(11, 3)).title, '11月3日 周二（今天）');
  const sat = tip(at(11, 7));
  assert.equal(sat.status, '休息日');
  assert.equal(sat.pay, '当日计薪 ¥0.00');
  const hol = tip(at(10, 1));
  assert.equal(hol.status, '法定假日（国庆）');
  assert.equal(hol.source, '来源：内置·官方通知');
  assert.equal(hol.pay, '当日计薪 ¥0.00');
  const mk = tip(at(10, 10));
  assert.equal(mk.status, '调休上班（国庆）');
  assert.equal(mk.source, '来源：内置·官方通知');
  assert.equal(mk.pay, '当日计薪 ¥377.78', 'Oct 2026: 6800 ÷ 18');
  const manualWork = tip(at(11, 7), { '2026-11-07': 'work' });
  assert.equal(manualWork.status, '调休上班');
  assert.equal(manualWork.source, '来源：手动标记');
  assert.equal(manualWork.pay, '当日计薪 ¥309.09');
  const paid = tip(at(11, 5), { '2026-11-05': 'paidLeave' });
  assert.equal(paid.status, '带薪假');
  assert.equal(paid.pay, '当日计薪 ¥323.81', 'paid leave = full daily wage');
  const unpaid = tip(at(11, 5), { '2026-11-05': 'unpaidLeave' });
  assert.equal(unpaid.status, '无薪假');
  assert.equal(unpaid.pay, '当日计薪 ¥0.00');
  const rest = tip(at(11, 5), { '2026-11-05': 'rest' });
  assert.equal(rest.status, '休息日');
  assert.equal(rest.pay, '当日计薪 ¥0.00');
  assert.equal(tip(at(11, 4), { '2026-11-05': 'rest' }).pay, '当日计薪 ¥340.00', 'other days see the new denominator');
  // 联网表：source 'online'
  const online = { 2027: { off: { '2027-01-01': '元旦' }, makeup: { '2027-01-09': '元旦' }, source: 'online' } };
  assert.equal(tip(at(1, 1, 2027), {}, online).source, '来源：联网更新·官方通知');
  // R30：导入的文件只写「导入文件」，不声称官方来源
  const file = { 2027: { ...online[2027], source: 'file' } };
  assert.equal(tip(at(1, 1, 2027), {}, file).source, '来源：导入文件');
  assert.equal(tip(at(1, 1, 2027), {}, online).status, '法定假日（元旦）');
  assert.equal(tip(at(1, 9, 2027), {}, online).status, '调休上班（元旦）');
  assert.equal(tip(at(1, 4, 2027)).source, '来源：按默认规则', 'no table, weekday → default rule');
  const fixed = tip(at(1, 1, 2027));
  assert.equal(fixed.source, '来源：法定日期（《放假办法》）');
  assert.equal(fixed.status, '法定假日（元旦）');
  assert.equal(fixed.pay, '当日计薪 ¥0.00');
  assert.match(tooltipText(fixed), /来源：法定日期（《放假办法》）/);
  assert.equal(tip(at(1, 1, 2027), { '2027-01-01': 'work' }).source, '来源：手动标记', 'user mark wins');
  assert.equal(tip(at(1, 2, 2027)).source, '来源：按周末规则', 'no table, Saturday → weekend rule');
  assert.equal(tip(at(11, 7), {}, HOLIDAYS_CN, { ...cfg, weekends: true }).source, '来源：按默认规则', 'weekend counted as workday');
  assert.equal(tip(at(1, 4, 2027)).status, '工作日');
});

test('tooltipText joins the same lines used by the visual tooltip', () => {
  const m = dayTooltipModel(at(11, 7), cfg, {}, HOLIDAYS_CN, at(11, 3));
  assert.equal(tooltipText(m), '11月7日 周六，休息日，来源：按周末规则，当日计薪 ¥0.00，点击修改');
});
