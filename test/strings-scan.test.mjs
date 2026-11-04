// Task 14：全部界面文案（含本次新增的说明、胶囊、标签、格式示例）的繁体字 / 台湾用语扫描。
// 函数型文案用样本参数展开后再扫；与 e2e 的页面扫描互补（页面只扫得到当前状态显示出来的文字）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { STRINGS } from '../src/strings.zh-CN.js';

const TRAD = [...'設開時賺鐘勵週與請計錢進導電連線標題資儲歷這個們為麼來還說後點選擇關閉復讀寫據節農區塊網頁顯匯則數單項錯誤會發現狀態間預覽灣準備載檔記號啟離階動處無帶變當內擷檢實際應該'];
const TW_TERMS = ['预设', '进阶', '有薪假', '使用者', '选单', '滑鼠', '萤幕', '点选', '自订', '未套用', '套用', '尚未公布', '字串', '物件', '档案', '网路', '资料', '设定', '储存', '复制贴上', '讯息', '登入'];

function collect(v, path, out) {
  if (typeof v === 'string') out.push([path, v]);
  else if (typeof v === 'function') {
    const samples = [
      [2027], ['2027', 3], [2027, 5, 1], [['元旦'], ['1/1']], ['国庆', ['10/1–10/7']], [{ month: 10, day: 1, weekday: '周四', kind: '法定假日', holidayName: '国庆', manual: true, today: true }],
    ];
    for (const args of samples) {
      try {
        const r = v(...args);
        if (typeof r === 'string') out.push([`${path}(${args.length})`, r]);
      } catch { /* 参数形状不合：换下一组 */ }
    }
  } else if (Array.isArray(v)) v.forEach((x, i) => collect(x, `${path}[${i}]`, out));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) collect(x, `${path}.${k}`, out);
}

test('every UI string (incl. Task 14 copy) is mainland Simplified: no Traditional characters, no Taiwan terms', () => {
  const all = [];
  collect(STRINGS, 'STRINGS', all);
  assert.ok(all.length > 300, `scanned ${all.length} strings`);
  const bad = [];
  for (const [path, s] of all) {
    const tr = TRAD.filter((c) => s.includes(c));
    const tw = TW_TERMS.filter((w) => s.includes(w));
    if (tr.length || tw.length) bad.push(`${path}: ${tr.join('')}${tw.join('、')} in 「${s}」`);
  }
  assert.deepEqual(bad, []);
});

test('the approved Task 14 copy is present verbatim', () => {
  const s = STRINGS.settings;
  assert.equal(s.backupDesc, '设置只保存在这个浏览器里，不会上传。');
  assert.equal(`${s.backup.importLead}${s.backup.importText}`, '导入备份：用之前导出的文件恢复这些设置。');
  assert.equal(s.paydayHint, '设置后，状态卡会显示「距离发薪日 N 天」');
  assert.equal(s.cheerHint, '会显示在左侧状态卡上');
  assert.equal(s.advancedSub, '一般不用改');
  assert.equal(STRINGS.float.keepOpen, '请保持本页开启：关闭本页，小窗也会一起关闭');
  assert.equal(STRINGS.float.unsupported, '当前浏览器不支持悬浮小窗，请使用 Edge 或 Chrome（116 及以上）');
  assert.equal(STRINGS.calendar.context.noHoliday, '本月没有法定假日');
  assert.equal(STRINGS.calendar.context.basis.builtin(2026), '依据 2026 年国务院放假通知');
  assert.equal(STRINGS.holidayUpdate.customUrlSummary(null), '自定义数据网址：未设置');
});

test('the format example is the real 2026 excerpt and passes the app\'s own shape rules (01-04 is a Sunday)', () => {
  const ex = JSON.parse(STRINGS.holidayUpdate.exampleCode);
  assert.equal(ex.year, 2026);
  assert.deepEqual(ex.days, [
    { name: '元旦', date: '2026-01-01', isOffDay: true },
    { name: '元旦', date: '2026-01-04', isOffDay: false },
  ]);
  assert.equal(new Date(2026, 0, 4).getDay(), 0, 'make-up day on a weekend (validation would reject a weekday)');
  assert.ok(ex.papers.every((u) => u.startsWith('https://www.gov.cn/')));
});
