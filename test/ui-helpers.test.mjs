import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STRINGS as t } from '../src/strings.zh-CN.js';
import { money, heroParts, duration, hours, minutesCeil, dateLine, ymd } from '../src/ui/format.js';
import { cardModel, monthPercent } from '../src/ui/card-model.js';
import { cellKind, monthGrid } from '../src/ui/calendar-model.js';
import { importReport } from '../src/ui/import-model.js';
import { snapshot } from '../src/calc.js';
import { DEFAULTS, importState } from '../src/settings.js';

const cfg = { ...DEFAULTS };
const at = (m, d, h = 0, mi = 0, s = 0, y = 2026) => new Date(y, m - 1, d, h, mi, s);

test('money / hero formatting uses zh-CN grouping and fixed decimals', () => {
  assert.equal(money(6800), '6,800.00');
  assert.equal(money(0.0128496, 4), '0.0128');
  assert.equal(money(NaN), '0.00');
  assert.deepEqual(heroParts(194.2857142), { head: '194.28', tail: '57' });
  assert.deepEqual(heroParts(12345.6789), { head: '12,345.67', tail: '89' });
});

test('duration rounds up to whole seconds; hours and minutes', () => {
  assert.equal(duration(10080, t), '2小时48分0秒');
  assert.equal(duration(10079.4, t), '2小时48分0秒');
  assert.equal(duration(59, t), '0分59秒');
  assert.equal(duration(-3, t), '0分0秒');
  assert.equal(hours(15120), '4.20');
  assert.equal(minutesCeil(3600), 60);
  assert.equal(minutesCeil(3540.2), 60);
  assert.equal(dateLine(at(11, 3), t), '2026/11/03 周二');
  assert.equal(ymd(at(1, 5)), '2026-01-05');
});

test('card model at 2026-11-03 14:12 matches spec §11.13 sample (not ÷21.75)', () => {
  const m = cardModel(snapshot(at(11, 3, 14, 12), cfg, {}), cfg, t);
  assert.equal(m.badge, '上班中');
  assert.equal(m.daily, '¥323.81');
  assert.equal(m.hourly, '¥46.26');
  assert.equal(m.month, '¥518.10');
  assert.equal(m.rate, '¥0.0128 /秒');
  assert.equal(t.card.rate, '当前赚钱速度');
  assert.deepEqual(heroParts(m.amount), { head: '194.28', tail: '57' });
  assert.equal(m.secondary, '距下班 2小时48分0秒');
  assert.equal(m.progressText, '已工作 4.20 / 7.00 小时');
  assert.equal(m.progressPct, 60);
  assert.equal(m.payday, null, 'payday hidden when empty');
  assert.equal(m.cheer, null);
  assert.equal(cardModel({ ...snapshot(at(11, 3, 14, 12), cfg, {}), now: at(11, 3, 14, 12) }, cfg, t).yearNote, null);
});

test('card shows a year note when the holiday table is missing (R15)', () => {
  const now = at(1, 4, 10, 0, 0, 2027);
  const m = cardModel({ ...snapshot(now, cfg, {}), now }, cfg, t);
  assert.equal(m.yearNote, '2027 年仅标法定假日');
  assert.equal(m.yearTitle, '2027 年假期表未内置：已按《放假办法》标出法定假日本身；补假、调休和延长的假日未标出');
  assert.ok([...m.yearNote.replace(/[\d\s]/g, '')].length <= 14, 'short tag stays short');
});

test('card model per status', () => {
  const lunch = cardModel(snapshot(at(11, 3, 12, 15), cfg, {}), cfg, t);
  assert.equal(lunch.secondary, '45 分钟后继续上班');
  assert.equal(lunch.rate, '¥0.0000 /秒');
  const before = cardModel(snapshot(at(11, 3, 7), cfg, {}), cfg, t);
  assert.equal(before.label, '今天还没开始');
  assert.equal(before.secondary, '距上班 1小时30分0秒');
  const after = cardModel(snapshot(at(11, 3, 18), cfg, {}), cfg, t);
  assert.equal(after.label, '今天辛苦了，收工！'); // Task 17：已下班换成收工文案（带薪假仍是「今天一共赚了」，见下方 Task 17 测试）
  assert.equal(after.settled, true);
  const rest = cardModel(snapshot(at(11, 7, 10), cfg, {}), cfg, t);
  assert.equal(rest.badge, '休息日');
  assert.equal(rest.label, '今天休息');
  assert.equal(rest.showAmount, false);
  assert.equal(rest.secondary, '距下个工作日 2 天');
  const holiday = cardModel(snapshot(at(10, 1, 10), cfg, {}), cfg, t);
  assert.equal(holiday.label, '今天休息 · 国庆');
  const paid = cardModel(snapshot(at(11, 3, 10), cfg, { '2026-11-03': 'paidLeave' }), cfg, t);
  assert.equal(paid.badge, '带薪假');
  assert.equal(paid.secondary, '今天按全天计薪');
  const unpaid = cardModel(snapshot(at(11, 3, 10), cfg, { '2026-11-03': 'unpaidLeave' }), cfg, t);
  assert.equal(unpaid.badge, '无薪假');
  assert.equal(unpaid.amount, 0);
  const makeup = cardModel(snapshot(at(9, 20, 10), cfg, {}), cfg, t);
  assert.equal(makeup.badge, '上班中');
  assert.equal(makeup.tag, '调休');
  const payCfg = { ...cfg, payday: 5, cheer: '加油' };
  const pay = cardModel(snapshot(at(11, 3, 10), payCfg, {}), payCfg, t);
  assert.equal(pay.payday, '距离发薪日 2 天');
  assert.equal(pay.cheer, '加油');
  const payToday = { ...cfg, payday: 3 };
  assert.equal(cardModel(snapshot(at(11, 3, 10), payToday, {}), payToday, t).payday, '今天发薪');
});

test('calendar cell aria label says Enter opens the menu', () => {
  const s = t.calendar.cellAria({ month: 11, day: 7, weekday: '周六', kind: '周末', holidayName: null, manual: false, today: false });
  assert.equal(s, '11月7日 周六，周末，按回车打开菜单');
});

test('cell kinds', () => {
  assert.equal(cellKind(at(11, 3), cfg, {}), 'workday');
  assert.equal(cellKind(at(11, 7), cfg, {}), 'weekend');
  assert.equal(cellKind(at(10, 1), cfg, {}), 'holiday');
  assert.equal(cellKind(at(10, 10), cfg, {}), 'makeup');
  assert.equal(cellKind(at(11, 7), cfg, { '2026-11-07': 'work' }), 'makeup');
  assert.equal(cellKind(at(11, 3), cfg, { '2026-11-03': 'paidLeave' }), 'paid');
  assert.equal(cellKind(at(11, 3), cfg, { '2026-11-03': 'unpaidLeave' }), 'unpaid');
  assert.equal(cellKind(at(11, 3), cfg, { '2026-11-03': 'rest' }), 'rest');
  assert.equal(cellKind(at(11, 7), { ...cfg, weekends: true }, {}), 'workday');
});

test('month grid starts on Monday and flags missing holiday tables', () => {
  const g = monthGrid(2026, 10, cfg, { '2026-11-12': 'paidLeave' }, at(11, 3));
  assert.equal(g.weeks[0].filter(Boolean)[0].day, 1);
  assert.equal(g.weeks[0].indexOf(g.weeks[0].find(Boolean)), 6, '2026-11-01 is a Sunday → last column');
  assert.equal(g.weeks.flat().filter(Boolean).length, 30);
  assert.ok(g.weeks.every((w) => w.length === 7));
  assert.equal(g.weeks.flat().find((c) => c?.today).day, 3);
  assert.equal(g.hasMarks, true);
  assert.equal(g.tableMissing, false);
  assert.equal(monthGrid(2027, 0, cfg, {}, at(11, 3)).tableMissing, true);
  const oct = monthGrid(2026, 9, cfg, {}, null);
  assert.equal(oct.weeks.flat().find((c) => c?.day === 1).holidayName, '国庆');
  assert.equal(oct.hasMarks, false);
});

test('import report counts applied items and lists dropped + unknown with current values', () => {
  const obj = { version: 1, salary: -5, start: '9am', cheer: '加油', foo: 1, lunchOn: true,
    marks: { '2026-11-05': 'paidLeave', '2026-02-30': 'work' } };
  const current = { cfg: { ...cfg }, marks: { '2026-02-28': 'work' } };
  const res = importState(JSON.stringify(obj), current);
  const r = importReport(obj, res, t);
  assert.equal(r.applied, 3, 'cheer, lunchOn, one mark');
  assert.equal(r.title, '已导入 3 项，4 项未导入');
  const byLabel = Object.fromEntries(r.rows.map((x) => [x.label, x]));
  assert.equal(byLabel['月薪'].value, '保留当前值 6800');
  assert.equal(byLabel['上班时间'].value, '保留当前值 08:30');
  assert.equal(byLabel['月历标记 2026-02-30'].value, '保留当前值 未标记');
  assert.equal(byLabel.foo.reason, '无法识别的字段，已忽略');
  const bad = importState('{"marks":[]}', current);
  assert.equal(importReport({ marks: [] }, bad, t).rows[0].label, '月历标记');
});

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const stripComments = (code) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]);
}

test('no CJK literals anywhere in src/ outside strings.zh-CN.js (comments excluded)', () => {
  const files = walk(SRC).filter((f) => /\.(js|css)$/.test(f) && !f.endsWith('strings.zh-CN.js'));
  assert.ok(files.length >= 15, 'scanned all source files');
  for (const f of files) {
    assert.doesNotMatch(stripComments(readFileSync(f, 'utf8')), /[一-鿿]/, `CJK literal in ${f}`);
  }
});

test('strings.zh-CN.js: no Taiwan-only terms or Traditional characters', () => {
  const code = stripComments(readFileSync(join(SRC, 'strings.zh-CN.js'), 'utf8'));
  for (const w of ['字串', '物件', '文字', '預', '预设', '进阶', '有薪假', '使用者', '档案', '选单', '滑鼠', '萤幕', '点选', '自订', '未套用', '套用']) {
    assert.ok(!code.includes(w), `forbidden term ${w}`);
  }
  const trad = [...'設開時賺鐘勵週與請計錢進導電連線標題預覽'].filter((c) => code.includes(c));
  assert.deepEqual(trad, []);
});

test('Task 17: 已下班 gets the wrap-up label and 已赚占月薪; every other status keeps the old copy', () => {
  const d = (m, day, h, mi = 0) => {
    const now = at(m, day, h, mi);
    return cardModel({ ...snapshot(now, cfg, {}), now }, cfg, t);
  };
  const done = d(11, 4, 18); // 2026-11-04 周三 18:00：今天 323.8095、本月累计 971.43
  assert.equal(done.status, 'afterWork');
  assert.equal(done.label, '今天辛苦了，收工！');
  assert.equal(done.rateLabel, '已赚占月薪');
  assert.equal(done.rate, '14%');
  assert.equal(done.month, '¥971.43');
  assert.equal(done.amount.toFixed(4), '323.8095');
  const old = { rateLabel: '当前赚钱速度' };
  const working = d(11, 4, 10);
  assert.equal(working.label, '今天已经赚了');
  assert.equal(working.rateLabel, old.rateLabel);
  assert.match(working.rate, /^¥\d+\.\d{4} \/秒$/);
  const lunch = d(11, 4, 12, 15);
  assert.equal(lunch.label, '今天已经赚了');
  assert.equal(lunch.rate, '¥0.0000 /秒');
  const before = d(11, 4, 7);
  assert.equal(before.label, '今天还没开始');
  assert.equal(before.rateLabel, old.rateLabel);
  assert.equal(before.rate, '¥0.0000 /秒');
  const rest = d(11, 7, 18);
  assert.equal(rest.label, '今天休息');
  assert.equal(rest.rateLabel, old.rateLabel);
  const holiday = d(10, 1, 18);
  assert.equal(holiday.label, '今天休息 · 国庆');
  assert.equal(holiday.rateLabel, old.rateLabel);
  const now = at(11, 4, 18);
  const paid = cardModel({ ...snapshot(now, cfg, { '2026-11-04': 'paidLeave' }), now }, cfg, t);
  assert.equal(paid.label, '今天一共赚了');
  assert.equal(paid.rateLabel, old.rateLabel);
  const unpaid = cardModel({ ...snapshot(now, cfg, { '2026-11-04': 'unpaidLeave' }), now }, cfg, t);
  assert.equal(unpaid.rateLabel, old.rateLabel);
  assert.equal(unpaid.rate, '¥0.0000 /秒');
  // 调休上班日（排定的工作日）收工后同样适用
  const makeup = d(9, 20, 18);
  assert.equal(makeup.status, 'afterWork');
  assert.equal(makeup.label, '今天辛苦了，收工！');
});

test('Task 17: monthPercent rounds, clamps to 0–100 and guards salary 0', () => {
  assert.equal(monthPercent(0, 6800), 0);
  assert.equal(monthPercent(971.43, 6800), 14);
  assert.equal(monthPercent(34, 6800), 1); // 0.5% 四舍五入进位
  assert.equal(monthPercent(33.99, 6800), 0); // 刚好低于 0.5%
  assert.equal(monthPercent(6800, 6800), 100);
  assert.equal(monthPercent(9999, 6800), 100);
  assert.equal(monthPercent(-5, 6800), 0);
  assert.equal(monthPercent(500, 0), 0);
  assert.equal(monthPercent(500, NaN), 0);
  assert.equal(monthPercent(NaN, 6800), 0);
  assert.equal(monthPercent(500, undefined), 0);
});
