// 迴歸：設定面板的月薪輸入框必須說清「怎麼輸入才對」（settings.salaryError），
// 而不是通用規則句（reasons.salary）。兩者都是字典文案，選誰只由欄位 + 語義 code 決定，
// 所以切地區 / 切語言後同一份語義狀態仍能重譯；匯入報告等別的入口繼續用 reasons.salary。
import test from 'node:test';
import assert from 'node:assert/strict';
import { fieldReasonText } from '../src/ui/settings-panel.js';
import { STRINGS as CN } from '../src/strings.zh-CN.js';
import { STRINGS as TW } from '../src/strings.zh-TW.js';
import { importReport } from '../src/ui/import-model.js';
import { DEFAULTS, importState } from '../src/settings.js';

// validateSchedule 對任何無效月薪都回傳同一個語義原因：{ code: 'salary' }（見 calc.js）
const salaryReason = { code: 'salary' };

test('salary field shows the input-format copy; the semantic state itself stays language-neutral', () => {
  // 同一份原因物件，換字典就換說法：這正是 setProfile / retranslate 依賴的性質
  assert.equal(fieldReasonText('salary', salaryReason, CN, CN.settings), CN.settings.salaryError);
  assert.equal(fieldReasonText('salary', salaryReason, TW, TW.settings), TW.settings.salaryError);
  // 兩本字典的具體說法都不是通用規則句，且各自給出當地示例金額
  assert.notEqual(CN.settings.salaryError, CN.reasons.salary);
  assert.notEqual(TW.settings.salaryError, TW.reasons.salary);
  assert.match(CN.settings.salaryError, /6800/);
  assert.match(TW.settings.salaryError, /40000/);
});

test('other fields keep their reasons.* wording (the salary override must not leak)', () => {
  assert.equal(fieldReasonText('end', { code: 'endAfterStart' }, CN, CN.settings), CN.reasons.endAfterStart);
  // 帶引數的 code 仍走 labels 查表
  assert.equal(
    fieldReasonText('start', { code: 'timeFormat', params: { field: 'start' } }, CN, CN.settings),
    CN.reasons.timeFormat(CN.reasons.labels.start),
  );
  // 同一個物件按兩個欄位分別取詞：措辭由「去處」決定，不由 code 決定
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
