// 回归：设置面板的月薪输入框必须说清「怎么输入才对」（settings.salaryError），
// 而不是通用规则句（reasons.salary）。两者都是字典文案，选谁只由字段 + 语义 code 决定，
// 所以切地区 / 切语言后同一份语义状态仍能重译；导入报告等别的入口继续用 reasons.salary。
import test from 'node:test';
import assert from 'node:assert/strict';
import { fieldReasonText } from '../src/ui/settings-panel.js';
import { STRINGS as CN } from '../src/strings.zh-CN.js';
import { STRINGS as TW } from '../src/strings.zh-TW.js';
import { importReport } from '../src/ui/import-model.js';
import { DEFAULTS, importState } from '../src/settings.js';

// validateSchedule 对任何无效月薪都回传同一个语义原因：{ code: 'salary' }（见 calc.js）
const salaryReason = { code: 'salary' };

test('salary field shows the input-format copy; the semantic state itself stays language-neutral', () => {
  // 同一份原因对象，换字典就换说法：这正是 setProfile / retranslate 依赖的性质
  assert.equal(fieldReasonText('salary', salaryReason, CN, CN.settings), CN.settings.salaryError);
  assert.equal(fieldReasonText('salary', salaryReason, TW, TW.settings), TW.settings.salaryError);
  // 两本字典的具体说法都不是通用规则句，且各自给出当地示例金额
  assert.notEqual(CN.settings.salaryError, CN.reasons.salary);
  assert.notEqual(TW.settings.salaryError, TW.reasons.salary);
  assert.match(CN.settings.salaryError, /6800/);
  assert.match(TW.settings.salaryError, /40000/);
});

test('other fields keep their reasons.* wording (the salary override must not leak)', () => {
  assert.equal(fieldReasonText('end', { code: 'endAfterStart' }, CN, CN.settings), CN.reasons.endAfterStart);
  // 带参数的 code 仍走 labels 查表
  assert.equal(
    fieldReasonText('start', { code: 'timeFormat', params: { field: 'start' } }, CN, CN.settings),
    CN.reasons.timeFormat(CN.reasons.labels.start),
  );
  // 同一个对象按两个字段分别取词：措辞由「去处」决定，不由 code 决定
  assert.equal(fieldReasonText('salary', { code: 'timeFormat', params: { field: 'start' } }, CN, CN.settings),
    CN.reasons.timeFormat(CN.reasons.labels.start));
});

test('missing dictionary entries fall back to the generic reason instead of showing nothing', () => {
  assert.equal(fieldReasonText('salary', salaryReason, CN, {}), CN.reasons.salary);
  assert.equal(fieldReasonText('salary', salaryReason, CN, null), CN.reasons.salary);
  assert.equal(fieldReasonText('salary', { code: 'noSuchCode' }, CN, CN.settings), '');
  assert.equal(fieldReasonText('salary', { legacy: 'OLD-TEXT' }, CN, CN.settings), 'OLD-TEXT');
  assert.equal(fieldReasonText('salary', null, CN, CN.settings), '');
});

test('import reports keep the generic reasons.salary wording (mainland contract)', () => {
  const { salary, ...shared } = { ...DEFAULTS, salary: 6800 };
  const current = { region: 'CN', cfg: shared, salaries: { TW: 40000, CN: salary }, marksByRegion: { TW: {}, CN: {} } };
  const res = importState(JSON.stringify({ version: 1, salary: -5 }), current);
  const row = importReport(res, CN).rows.find((x) => x.label === '月薪 · 中国大陆');
  assert.equal(row.reason, CN.reasons.salary);
  assert.equal(row.value, '保留当前值 6800');
});
