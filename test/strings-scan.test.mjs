// Task 14：全部介面文案（含本次新增的說明、膠囊、標籤、格式示例）的繁體字 / 臺灣用語掃描。
// 函式型文案用樣本引數展開後再掃；與 e2e 的頁面掃描互補（頁面只掃得到當前狀態顯示出來的文字）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { STRINGS } from '../src/strings.zh-CN.js';
import { STRINGS as TW } from '../src/strings.zh-TW.js';

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
      } catch { /* 引數形狀不合：換下一組 */ }
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

test('Taiwan dictionary implements the mainland dictionary contract and uses Taiwanese terminology', () => {
  const compare = (cn, tw, path) => {
    for (const [key, value] of Object.entries(cn)) {
      const name = `${path}.${key}`;
      assert.ok(Object.hasOwn(tw, key), `missing ${name}`);
      assert.equal(typeof tw[key], typeof value, name);
      if (value && typeof value === 'object' && !Array.isArray(value)) compare(value, tw[key], name);
    }
  };
  compare(STRINGS, TW, 'strings');
  const all = [];
  collect(TW, 'TW', all);
  const forbidden = ['设置', '保存', '数据', '文件', '默认', '菜单', '联网', '鼠标', '屏幕', '带薪假', '调休'];
  const bad = all.flatMap(([path, text]) => forbidden.filter((word) => text.includes(word)).map((word) => `${path}: ${word}`));
  assert.deepEqual(bad, []);
});

test('the approved Task 14 copy is present verbatim', () => {
  const s = STRINGS.settings;
  assert.equal(s.backupDesc, '设置只保存在这个浏览器里，不会上传。');
  assert.equal(s.paydayHint, '设置后可显示发薪倒数；当月没有该日期时按月底计算。');
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

// Task 14 fix round 1 · Block B
test('B: no hard-coded disclosure glyphs outside strings; weekends switch uses one wording in UI, import report and reasons', async () => {
  const { readFileSync, readdirSync } = await import('node:fs');
  const dir = new URL('../src/ui/', import.meta.url);
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.js'))) {
    const code = readFileSync(new URL(f, dir), 'utf8').replace(/\/\/.*$/gm, '');
    assert.doesNotMatch(code, /[▸▾]/, `${f}: glyphs must come from strings`);
  }
  assert.equal(STRINGS.settings.chevronClosed, '▸');
  assert.equal(STRINGS.settings.chevronOpen, '▾');
  assert.equal(STRINGS.settings.weekends, '周末上班');
  assert.equal(STRINGS.reasons.labels.weekends, '周末上班');
  assert.equal(STRINGS.reasons.switchValue(STRINGS.reasons.labels.weekends), '周末上班只能是开或关');
  assert.equal(STRINGS.holidayUpdate.exampleYear, 'year：年份（数字，例如 2027）；days 里的日期都必须在这一年内。');
  assert.equal(STRINGS.holidayUpdate.importHint, '连不上网时，用文件导入');
  assert.doesNotMatch(STRINGS.holidayUpdate.customUrlExplain, /网络打不开/);
});
