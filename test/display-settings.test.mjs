// 畫面設定（Task 24）：全域性字號五檔 + 狀態卡五個顯隱開關。
// 這裡只測純行為：預設值不改畫面、舊存檔靜默相容、非法值逐欄位丟棄並回報、備份往返、錯誤原因的兩種語言。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULTS, FONT_SCALES, STATE_VERSION, STORAGE_KEY,
  defaultState, loadState, importState, exportState, saveState,
} from '../src/settings.js';
import { reasonText } from '../src/calc.js';
import { STRINGS } from '../src/strings.zh-CN.js';
import { STRINGS as TW } from '../src/strings.zh-TW.js';

const TOGGLES = ['showCardProgress', 'showCardMetrics', 'showCardDate', 'showCardPayday', 'showCardCheer'];

const fakeStorage = (init = {}) => {
  const m = new Map(Object.entries(init));
  const writes = [];
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { writes.push(k); m.set(k, String(v)); },
    _m: m,
    _writes: writes,
  };
};
const canonical = (over = {}) => ({
  region: 'CN',
  cfg: { ...DEFAULTS },
  salaries: { TW: 40000, CN: 6800 },
  marksByRegion: { TW: {}, CN: {} },
  ...over,
});

test('默认值：中号 + 五项全部显示（旧版画面不变）', () => {
  assert.equal(DEFAULTS.fontScale, 'm');
  for (const f of TOGGLES) assert.equal(DEFAULTS[f], true, `${f} 默认显示`);
  assert.deepEqual([...FONT_SCALES], ['xs', 's', 'm', 'l', 'xl']);
  // 新使用者的預設狀態與 DEFAULTS 同一份值：第一次開頁看到的卡與舊版一致。
  assert.equal(defaultState().cfg.fontScale, 'm');
  for (const f of TOGGLES) assert.equal(defaultState().cfg[f], true, f);
});

test('旧存档（缺这六个键）静默载入：套默认值，不产生任何丢弃报告', () => {
  const legacy = {
    version: 2, start: '09:00', end: '18:00', lunchOn: false,
    lunchStart: '12:00', lunchEnd: '13:00', weekends: true, payday: 10, cheer: '加油',
    showLunar: false, theme: 'blue', salary: 6800, marks: { '2026-05-04': 'rest' },
  };
  const st = fakeStorage({ [STORAGE_KEY]: JSON.stringify(legacy) });
  const r = loadState(st);
  assert.equal(r.corrupt, false);
  // 關鍵：不存在 ≠ 不合法。缺鍵絕不能變成面板上的「部分設定已改用預設值」警告。
  assert.deepEqual(r.dropped, []);
  assert.equal(r.state.cfg.fontScale, 'm');
  for (const f of TOGGLES) assert.equal(r.state.cfg[f], true, f);
  // 原值一個都不動
  assert.equal(r.state.cfg.start, '09:00');
  assert.equal(r.state.cfg.showLunar, false);
  assert.equal(r.state.cfg.theme, 'blue');
  assert.equal(r.state.cfg.weekends, true);
  assert.equal(r.state.salaries.CN, 6800);
  assert.deepEqual(st._writes, [], '读取不写回');
});

test('非法的字号被丢弃并回落到中号，原因可翻成两种语言', () => {
  const raw = JSON.stringify({ version: 3, region: 'CN', fontScale: 'huge', showCardDate: 'no' });
  const r = importState(raw, canonical());
  assert.equal(r.state.cfg.fontScale, 'm');
  assert.equal(r.state.cfg.showCardDate, true, '坏值不写入，保留现值');
  const fields = r.dropped.map((d) => d.field).sort();
  assert.deepEqual(fields, ['fontScale', 'showCardDate']);
  const byField = Object.fromEntries(r.dropped.map((d) => [d.field, d.reason]));
  assert.equal(byField.fontScale.code, 'fontScale');
  assert.equal(byField.showCardDate.code, 'switchValue');
  assert.equal(byField.showCardDate.params.field, 'showCardDate');
  assert.equal(reasonText(byField.fontScale, STRINGS), STRINGS.reasons.fontScale);
  assert.equal(reasonText(byField.showCardDate, STRINGS), '显示日期只能是开或关');
  assert.equal(reasonText(byField.fontScale, TW), TW.reasons.fontScale);
  assert.equal(reasonText(byField.showCardDate, TW), '顯示日期只能是開或關');
});

test('合法的新值逐项生效（五档都能存回来）', () => {
  for (const scale of FONT_SCALES) {
    const raw = JSON.stringify({ version: 3, region: 'TW', fontScale: scale });
    const r = importState(raw, canonical({ region: 'TW' }));
    assert.equal(r.state.cfg.fontScale, scale, scale);
    assert.deepEqual(r.dropped, []);
  }
  // 關掉兩個開關：只動這兩個，其餘保持現值
  const off = importState(
    JSON.stringify({ version: 3, showCardCheer: false, showCardMetrics: false }),
    canonical({ cfg: { ...DEFAULTS, showLunar: false } }),
  );
  assert.equal(off.state.cfg.showCardCheer, false);
  assert.equal(off.state.cfg.showCardMetrics, false);
  assert.equal(off.state.cfg.showCardProgress, true);
  assert.equal(off.state.cfg.showLunar, false, '其他字段不受影响');
  assert.deepEqual(off.dropped, []);
});

test('备份往返：六个字段都写进文件、读回来一模一样（两地共用一份共享设置）', () => {
  const state = canonical({
    region: 'TW',
    cfg: { ...DEFAULTS, fontScale: 'xl', showCardProgress: false, showCardCheer: false, showLunar: false, theme: 'rainbow' },
  });
  const parsed = JSON.parse(exportState(state));
  assert.equal(parsed.version, STATE_VERSION);
  assert.equal(parsed.fontScale, 'xl');
  assert.equal(parsed.showCardProgress, false);
  assert.equal(parsed.showCardCheer, false);
  assert.equal(parsed.showCardMetrics, true);
  for (const f of TOGGLES) assert.equal(parsed[f], state.cfg[f], f);
  const back = importState(exportState(state), defaultState());
  for (const f of ['fontScale', ...TOGGLES]) assert.equal(back.state.cfg[f], state.cfg[f], f);
  assert.equal(back.state.cfg.theme, 'rainbow', '既有主题（含柔和彩虹）原样保留');
  assert.deepEqual(back.dropped, []);
});

test('备份不会产出自己读不回来的文件：坏字号写成中号', () => {
  const state = canonical({ cfg: { ...DEFAULTS, fontScale: 'giant', showCardDate: 'false' } });
  const parsed = JSON.parse(exportState(state));
  assert.equal(parsed.fontScale, 'm');
  assert.equal(parsed.showCardDate, true);
  assert.deepEqual(importState(exportState(state), defaultState()).dropped, []);
});

test('save -> load 保留画面设置（同一把键，不新增储存键）', () => {
  const st = fakeStorage();
  const state = canonical({
    region: 'CN',
    cfg: { ...DEFAULTS, fontScale: 'xs', showCardPayday: false, showCardDate: false },
  });
  assert.deepEqual(saveState(st, state), { ok: true });
  assert.deepEqual(st._writes, [STORAGE_KEY]);
  const r = loadState(st);
  assert.equal(r.state.cfg.fontScale, 'xs');
  assert.equal(r.state.cfg.showCardPayday, false);
  assert.equal(r.state.cfg.showCardDate, false);
  assert.equal(r.state.cfg.showCardMetrics, true);
  assert.deepEqual(r.dropped, []);
});

test('旧备份汇入缺键时保留现值，不会把画面设置重置成默认', () => {
  const current = canonical({ cfg: { ...DEFAULTS, fontScale: 'l', showCardCheer: false } });
  const r = importState(JSON.stringify({ version: 1, salary: 9000 }), current);
  assert.equal(r.state.cfg.fontScale, 'l');
  assert.equal(r.state.cfg.showCardCheer, false);
  assert.equal(r.state.salaries.CN, 9000);
  assert.deepEqual(r.dropped, []);
});

test('导入报告的标签：字典顶层能按字段名查到这六项（不显示生字段名）', () => {
  for (const dict of [STRINGS, TW]) {
    for (const f of ['fontScale', ...TOGGLES]) {
      const label = dict.settings[f];
      assert.equal(typeof label, 'string', f);
      assert.ok(label.length > 0, f);
    }
    // 報告裡的標籤與面板上的開關用同一套叫法（報告寫成「顯示進度條」、面板寫「進度條」是同一件事）
    const d = dict.settings.display;
    assert.equal(dict.settings.fontScale, d.fontScale);
    for (const [flat, field] of [
      ['showCardProgress', 'progress'], ['showCardMetrics', 'metrics'], ['showCardDate', 'date'],
      ['showCardPayday', 'payday'], ['showCardCheer', 'cheer'],
    ]) {
      assert.ok(dict.settings[flat].includes(d[field]), `${flat}: ${dict.settings[flat]} / ${d[field]}`);
    }
  }
});

test('开关标签不与既有输入框同名：发薪日 / 鼓励语只命中一个控件', () => {
  for (const dict of [STRINGS, TW]) {
    const { display, payday, cheer } = dict.settings;
    // 讀屏與 getByLabel 都按子串匹配：標籤裡出現「發薪日」「鼓勵語」會讓一組控制元件產生兩處命中
    assert.equal(display.payday.includes(payday), false, display.payday);
    assert.equal(display.cheer.includes(cheer), false, display.cheer);
    // 但提示文字仍要寫清楚顯示的是什麼，使用者不必猜
    assert.ok(display.paydayHint.includes(payday), display.paydayHint);
    assert.ok(display.cheerHint.includes(cheer), display.cheerHint);
  }
});

test('画面设置的说明把边界讲清楚：日期连带农历、状态标签始终显示、开关不影响计算', () => {
  for (const dict of [STRINGS, TW]) {
    const d = dict.settings.display;
    assert.match(d.dateHint, /农历|農曆/);
    assert.match(d.statusNote, /状态标签|狀態標籤/);
    assert.match(d.scope, /不会改变|不會改變/);
    assert.ok(d.fontScaleOptions.xs && d.fontScaleOptions.xl, '五档都有文字');
    // 農曆仍是獨立開關：畫面設定不能聲稱已取代它
    assert.equal(typeof dict.settings.showLunar, 'string');
  }
});
