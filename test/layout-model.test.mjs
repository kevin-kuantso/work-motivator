// 版面重设计（spec §13）的纯逻辑：提示条两条通道的合并 / 排队规则，以及月历格子颜色的对比度（实算）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeErrors, pickInfo } from '../src/ui/banners.js';
import { STRINGS } from '../src/strings.zh-CN.js';

const SEP = ' · ';

test('error channel: both errors merge into one bar, in a fixed order, joined with 「·」', () => {
  const errors = new Map([
    ['loadIssue', { content: 'B', dismissible: true, actions: [{ key: 'import', label: '导入' }] }],
    ['storageFail', { content: 'A', dismissible: false, actions: [{ key: 'export', label: '导出' }, { key: 'import', label: '导入' }] }],
  ]);
  const m = mergeErrors(errors, SEP);
  assert.deepEqual(m.ids, ['storageFail', 'loadIssue']);
  assert.equal(m.text, `A${SEP}B`);
  assert.equal(m.dismissible, true, 'the dismissible part can be closed');
  assert.deepEqual(m.actions.map((a) => a.key), ['export', 'import'], 'actions de-duplicated');
  assert.equal(mergeErrors(new Map(), SEP), null);
  const only = mergeErrors(new Map([['storageFail', { content: 'A', dismissible: false, actions: [] }]]), SEP);
  assert.equal(only.text, 'A');
  assert.equal(only.dismissible, false, 'storage failure alone cannot be dismissed');
});

test('info channel: one at a time, firstRun before backupNudge, queued (not dropped)', () => {
  assert.equal(pickInfo(new Set()), null);
  assert.equal(pickInfo(new Set(['backupNudge'])), 'backupNudge');
  assert.equal(pickInfo(new Set(['backupNudge', 'firstRun'])), 'firstRun', 'priority independent of queue order');
  const q = new Set(['firstRun', 'backupNudge']);
  q.delete(pickInfo(q));
  assert.equal(pickInfo(q), 'backupNudge', 'the nudge waits and then shows');
});


test('M1 / R27: partial-invalid banner lists at most 3 labels, then 「…等 N 项」', () => {
  const f = STRINGS.banner.loadPartial;
  assert.equal(f(['月薪']), '已保存的设置中有部分项目无法使用，以下项目已改用默认值：月薪');
  assert.equal(f(['A', 'B', 'C']), '已保存的设置中有部分项目无法使用，以下项目已改用默认值：A、B、C');
  assert.equal(f(['A', 'B', 'C', 'D', 'E']), '已保存的设置中有部分项目无法使用，以下项目已改用默认值：A、B、C…等 5 项');
});

test('info channel: holiday diff notice sits between firstRun and backupNudge, queued', () => {
  assert.equal(pickInfo(new Set(['backupNudge', 'holidayDiff'])), 'holidayDiff');
  assert.equal(pickInfo(new Set(['holidayDiff', 'firstRun'])), 'firstRun');
});
