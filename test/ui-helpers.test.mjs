import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STRINGS as t } from '../src/strings.zh-CN.js';
import { money, heroParts, duration, hours, minutesCeil, dateLine, ymd } from '../src/ui/format.js';
import { cardModel } from '../src/ui/card-model.js';
import { nextMark, cellKind, monthGrid } from '../src/ui/calendar-model.js';
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
  assert.equal(m.yearNote, '2027 年假期未内置');
});

test('card model per status', () => {
  const lunch = cardModel(snapshot(at(11, 3, 12, 15), cfg, {}), cfg, t);
  assert.equal(lunch.secondary, '45 分钟后继续上班');
  assert.equal(lunch.rate, '¥0.0000 /秒');
  const before = cardModel(snapshot(at(11, 3, 7), cfg, {}), cfg, t);
  assert.equal(before.label, '今天还没开始');
  assert.equal(before.secondary, '距上班 1小时30分0秒');
  const after = cardModel(snapshot(at(11, 3, 18), cfg, {}), cfg, t);
  assert.equal(after.label, '今天一共赚了');
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

test('calendar click cycle depends on the unmarked base type', () => {
  const wd = at(11, 3);
  assert.equal(nextMark(wd, cfg, {}), 'paidLeave');
  assert.equal(nextMark(wd, cfg, { '2026-11-03': 'paidLeave' }), 'unpaidLeave');
  assert.equal(nextMark(wd, cfg, { '2026-11-03': 'unpaidLeave' }), undefined);
  assert.equal(nextMark(wd, cfg, { '2026-11-03': 'rest' }), undefined, 'foreign mark resets to default');
  const sat = at(11, 7);
  assert.equal(nextMark(sat, cfg, {}), 'work');
  assert.equal(nextMark(sat, cfg, { '2026-11-07': 'work' }), undefined);
  assert.equal(nextMark(at(10, 1), cfg, {}), 'work', 'holiday is a rest base');
  assert.equal(nextMark(at(9, 20), cfg, {}), 'paidLeave', 'makeup day is a work base');
  assert.equal(nextMark(sat, { ...cfg, weekends: true }, {}), 'paidLeave');
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
  for (const w of ['字串', '物件', '文字', '預', '预设', '进阶', '有薪假', '使用者', '档案']) {
    assert.ok(!code.includes(w), `forbidden term ${w}`);
  }
  const trad = [...'設開時賺鐘勵週與請計錢進導電連線標題預覽'].filter((c) => code.includes(c));
  assert.deepEqual(trad, []);
});
