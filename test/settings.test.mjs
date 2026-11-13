import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STORAGE_KEY, STATE_VERSION, REGIONS, DEFAULT_REGION, DEFAULTS, SALARY_DEFAULTS,
  defaultsFor, defaultState, loadState, saveState, exportState, importState,
} from '../src/settings.js';

const KEY = 'work-motivator-v1';
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
// 規範狀態：cfg 不含 salary，月薪按地區放在 salaries，標記按地區放在 marksByRegion。
const canonical = (over = {}) => ({
  region: 'CN',
  cfg: { ...DEFAULTS },
  salaries: { TW: 40000, CN: 6800 },
  marksByRegion: { TW: {}, CN: {} },
  ...over,
});
const tw = () => defaultState();
const legacyRaw = (obj) => JSON.stringify(obj);

test('version 4 契约：键名不变、地区列表、共享设置不含月薪', () => {
  assert.equal(STORAGE_KEY, KEY);
  assert.equal(STATE_VERSION, 4);
  assert.deepEqual([...REGIONS], ['TW', 'CN']);
  assert.equal(DEFAULT_REGION, 'TW');
  assert.equal(Object.hasOwn(DEFAULTS, 'salary'), false, '共享设置不存月薪');
  assert.deepEqual(Object.keys(DEFAULTS).sort(), [
    'cheers', 'end', 'fontScale', 'lunchEnd', 'lunchOn', 'lunchStart', 'payday',
    'showCardCheer', 'showCardDate', 'showCardMetrics', 'showCardPayday', 'showCardProgress',
    'showLunar', 'start', 'theme', 'weekends',
  ]);
  // 畫面設定預設中號 + 全部顯示：與舊版畫面一致，舊存檔缺這些鍵時看得到的卡片不變。
  assert.equal(DEFAULTS.fontScale, 'm');
  for (const f of ['showCardProgress', 'showCardMetrics', 'showCardDate', 'showCardPayday', 'showCardCheer']) {
    assert.equal(DEFAULTS[f], true, `${f} defaults to visible`);
  }
  // 預設午休關閉（不預先把某個休息時段當成所有人的作息），但保留 12:00–13:00 的預填值。
  assert.equal(DEFAULTS.start, '09:00');
  assert.equal(DEFAULTS.end, '18:00');
  assert.equal(DEFAULTS.lunchOn, false);
  assert.equal(DEFAULTS.lunchStart, '12:00');
  assert.equal(DEFAULTS.lunchEnd, '13:00');
  assert.deepEqual({ ...SALARY_DEFAULTS }, { TW: 40000, CN: 5000 });
  assert.deepEqual(defaultsFor('TW'), { ...DEFAULTS, salary: 40000 });
  assert.deepEqual(defaultsFor('CN'), { ...DEFAULTS, salary: 5000 });
  assert.deepEqual(defaultsFor('TW').salary, 40000, '示例月薪整数，无小数');
});

test('没有储存 + 读取成功 = 新用户：TW、40000、午休关闭', () => {
  const st = fakeStorage();
  const r = loadState(st);
  assert.deepEqual(r, {
    state: {
      region: 'TW',
      cfg: { ...DEFAULTS },
      salaries: { TW: 40000, CN: 5000 },
      marksByRegion: { TW: {}, CN: {} },
    },
    storageOk: true,
    dropped: [],
    corrupt: false,
  });
  assert.equal(r.state.cfg.salary, undefined, '活动月薪只在边界组装，不在 cfg 里重复');
  assert.deepEqual(st._writes, [], '读取不写回');
});

test('new users get rainbow while existing themes and missing legacy theme are preserved', () => {
  assert.equal(loadState(fakeStorage()).state.cfg.theme, 'rainbow');
  for (const theme of ['green', 'blue', 'rainbow']) {
    assert.equal(loadState(fakeStorage({ [KEY]: JSON.stringify({ version: 3, theme }) })).state.cfg.theme, theme);
  }
  assert.equal(loadState(fakeStorage({ [KEY]: JSON.stringify({ version: 1, salary: 6800 }) })).state.cfg.theme, 'green');
});

test('save -> load round trip（同一把键，v4 结构）', () => {
  const st = fakeStorage();
  const state = canonical({
    region: 'TW',
    cfg: { ...DEFAULTS, cheers: ['加油', '繼續努力'], payday: 10, weekends: true },
    salaries: { TW: 12345.5, CN: 6800 },
    marksByRegion: { TW: { '2026-05-04': 'rest' }, CN: { '2026-05-05': 'work' } },
  });
  assert.deepEqual(saveState(st, state), { ok: true });
  assert.deepEqual(st._writes, [KEY]);
  assert.deepEqual(loadState(st), { state, storageOk: true, dropped: [], corrupt: false });
  assert.equal(state.cfg.salary, undefined);
});

test('旧 v2 储存载入为 CN：月薪与标记归 CN，TW 独立取默认', () => {
  const raw = legacyRaw({
    version: 2, salary: 6800, start: '09:00', end: '18:00', lunchOn: true,
    lunchStart: '11:30', lunchEnd: '13:00', cheer: '冲', marks: { '2026-05-04': 'rest' },
  });
  const st = fakeStorage({ [KEY]: raw });
  const r = loadState(st);
  assert.equal(r.corrupt, false);
  assert.equal(r.storageOk, true);
  assert.deepEqual(r.dropped, []);
  assert.equal(r.state.region, 'CN');
  assert.equal(r.state.salaries.CN, 6800);
  assert.equal(r.state.salaries.TW, 40000, 'TW 用示例默认值初始化');
  assert.deepEqual(r.state.marksByRegion.CN, { '2026-05-04': 'rest' });
  assert.deepEqual(r.state.marksByRegion.TW, {});
  assert.deepEqual(r.state.cfg, {
    ...DEFAULTS, theme: 'green', start: '09:00', end: '18:00', lunchOn: true, lunchStart: '11:30', lunchEnd: '13:00', cheers: ['冲'],
  }, '旧午休设置原样保留，不被新默认值改写');
  assert.equal(st._m.get(KEY), raw, '只读不迁移：原始内容不变');
  assert.deepEqual(st._writes, []);
});

test('旧 v1 / 无版本储存同样载入为 CN', () => {
  for (const raw of ['{"version":1,"salary":9000}', '{"salary":9000,"marks":{"2026-05-04":"work"}}']) {
    const r = loadState(fakeStorage({ [KEY]: raw }));
    assert.equal(r.state.region, 'CN', raw);
    assert.equal(r.state.salaries.CN, 9000);
    assert.equal(r.state.cfg.start, '09:00');
    assert.equal(r.corrupt, false);
  }
});

test('load: 储存回传非字串（实作异常）-> 不算新用户，按损坏处理且不写回', () => {
  for (const raw of [undefined, 0, false, {}]) {
    const st = { getItem: () => raw, setItem() { throw new Error('should not write'); } };
    const r = loadState(st);
    assert.equal(r.storageOk, false, String(raw));
    assert.equal(r.corrupt, true, String(raw));
    assert.equal(r.state.region, 'CN');
    assert.equal(r.state.salaries.CN, 5000);
  }
});

test('load: 损坏内容 -> corrupt + CN 保守回退，不覆写原始数据', () => {
  for (const raw of ['not json', '[1,2]', 'null', '3', '']) {
    const st = fakeStorage({ [KEY]: raw });
    const r = loadState(st);
    assert.equal(r.corrupt, true, raw);
    assert.equal(r.storageOk, true);
    assert.equal(r.state.region, 'CN');
    assert.equal(r.state.salaries.CN, 5000, '损坏时按 CN 示例默认，不猜用户资料');
    assert.deepEqual(r.state.marksByRegion, { TW: {}, CN: {} });
    assert.equal(st._m.get(KEY), raw);
    assert.deepEqual(st._writes, []);
  }
});

test('load: 无法识别的未来版本整份拒绝（保守回退，不当旧版读）', () => {
  for (const raw of ['{"version":5,"salary":9000}', '{"version":"3","salary":9000}', '{"version":null}', '{"version":1.5}']) {
    const st = fakeStorage({ [KEY]: raw });
    const r = loadState(st);
    assert.equal(r.corrupt, true, raw);
    assert.equal(r.state.region, 'CN');
    assert.equal(r.state.salaries.CN, 5000, raw);
    assert.equal(r.state.cfg.start, '09:00');
    assert.equal(st._m.get(KEY), raw);
    assert.deepEqual(st._writes, []);
  }
});

test('load: 未知 region / 非法子项逐栏丢弃，不污染其他地区', () => {
  const raw = legacyRaw({
    version: 3,
    region: 'XX',
    salaries: { TW: 'abc', CN: 9000, XX: 1 },
    marksByRegion: { TW: { '2026-02-30': 'work', '2026-05-04': 'rest' }, CN: [1], XX: {} },
    start: '25:99',
  });
  const r = loadState(fakeStorage({ [KEY]: raw }));
  assert.equal(r.corrupt, false);
  assert.equal(r.state.region, 'CN', '无效 region 保留保守回退');
  assert.equal(r.state.salaries.TW, 40000);
  assert.equal(r.state.salaries.CN, 9000);
  assert.deepEqual(r.state.marksByRegion.TW, { '2026-05-04': 'rest' });
  assert.deepEqual(r.state.marksByRegion.CN, {});
  assert.deepEqual(r.dropped.map((d) => d.field).sort(), [
    'marksByRegion.CN', 'marksByRegion.TW.2026-02-30', 'marksByRegion.XX', 'region', 'salaries.TW', 'salaries.XX', 'start',
  ]);
  assert.ok(r.dropped.every((d) => typeof d.reason.code === 'string' && d.reason.code.length > 0));
});

test('load: 单栏位坏掉时其他栏位照常读出', () => {
  const raw = legacyRaw({ version: 2, salary: 9000, start: '09:00', end: '18:00', payday: 99, cheer: '冲' });
  const r = loadState(fakeStorage({ [KEY]: raw }));
  assert.deepEqual(r.dropped.map((d) => d.field), ['payday']);
  assert.equal(r.corrupt, false);
  assert.equal(r.state.salaries.CN, 9000);
  assert.deepEqual(r.state.cfg, { ...DEFAULTS, theme: 'green', start: '09:00', end: '18:00', cheers: ['冲'] });
});

test('getItem 抛错 -> storageOk false + CN 保守回退（不算新用户），不写回', () => {
  const st = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('should not write'); } };
  const r = loadState(st);
  assert.deepEqual(r, {
    state: canonical({ cfg: { ...DEFAULTS }, salaries: { TW: 40000, CN: 5000 } }),
    storageOk: false,
    dropped: [],
    corrupt: false,
  });
  assert.equal(r.state.region, 'CN');
});

test('setItem 抛错 -> {ok:false}', () => {
  const st = { getItem: () => null, setItem() { throw new Error('quota'); } };
  assert.deepEqual(saveState(st, tw()), { ok: false });
  assert.deepEqual(saveState(st, canonical()), { ok: false });
});

test('exportState: v4 结构，两地月薪与标记都在，没有活动月薪/标记的副本', () => {
  const o = JSON.parse(exportState(canonical({
    region: 'TW',
    salaries: { TW: 8888.8888, CN: 6800 },
    marksByRegion: { TW: { '2026-05-04': 'work' }, CN: { '2026-05-05': 'rest' } },
  })));
  assert.equal(o.version, STATE_VERSION);
  assert.equal(o.region, 'TW');
  assert.equal(o.salary, undefined, '不再有顶层 salary');
  assert.equal(o.marks, undefined, '不再有顶层 marks');
  assert.deepEqual(o.salaries, { TW: 8888.8888, CN: 6800 }, '不四舍五入使用者输入');
  assert.deepEqual(o.marksByRegion, { TW: { '2026-05-04': 'work' }, CN: { '2026-05-05': 'rest' } });
  for (const k of Object.keys(DEFAULTS)) assert.ok(k in o, `共享设置 ${k} 在备份里`);
  // 已經按舊形狀拼錯（cfg 裡帶 salary）也不會把活動月薪寫進備份
  const stray = JSON.parse(exportState({ ...canonical(), cfg: { ...DEFAULTS, salary: 12 } }));
  assert.equal(stray.salary, undefined);
  assert.equal(stray.salaries.TW, 40000);
});

test('exportState: 不合法的月薪改写成该地区示例默认，产物一定读得回来', () => {
  for (const bad of [Number.NaN, Infinity, 0, -1, '7000', null, undefined]) {
    const o = JSON.parse(exportState({
      ...canonical(),
      salaries: { TW: bad, CN: 6800 },
    }));
    assert.equal(o.salaries.TW, SALARY_DEFAULTS.TW, String(bad));
    assert.equal(o.salaries.CN, 6800);
    const back = loadState(fakeStorage({ [KEY]: exportState({ ...canonical(), salaries: { TW: bad, CN: 6800 } }) }));
    assert.equal(back.corrupt, false);
    assert.equal(back.dropped.length, 0);
    assert.equal(back.state.salaries.TW, SALARY_DEFAULTS.TW);
  }
});

test('exportState: 坏掉的共享设置与标记写回默认/剔除，产物零丢弃地读得回来', () => {
  const messy = {
    ...canonical(),
    cfg: { ...DEFAULTS, theme: 'purple', payday: 40, lunchOn: 'yes', cheers: ['x'.repeat(41)], start: '25:00' },
    marksByRegion: {
      TW: { '2026-02-30': 'work', '2026-05-04': 'sick', '2026-05-05': 'rest' },
      CN: 'not-an-object',
    },
  };
  const raw = exportState(messy);
  const o = JSON.parse(raw);
  assert.equal(o.theme, DEFAULTS.theme);
  assert.equal(o.payday, DEFAULTS.payday);
  assert.equal(o.lunchOn, DEFAULTS.lunchOn);
  assert.deepEqual(o.cheers, DEFAULTS.cheers);
  assert.equal(o.start, DEFAULTS.start);
  assert.deepEqual(o.marksByRegion, { TW: { '2026-05-05': 'rest' }, CN: {} });
  const back = loadState(fakeStorage({ [KEY]: raw }));
  assert.equal(back.corrupt, false);
  assert.deepEqual(back.dropped, []);
  assert.deepEqual(back.state.marksByRegion, { TW: { '2026-05-05': 'rest' }, CN: {} });
});

test('exportState: 时段与午休合起来不成立时逐级让步，产物零丢弃地读得回来', () => {
  // 午休落在上下班時間之外：先關午休，上下班時間不動。
  const lunchOutside = {
    ...canonical(),
    cfg: { ...DEFAULTS, lunchOn: true, lunchStart: '20:00', lunchEnd: '21:00' },
  };
  const a = JSON.parse(exportState(lunchOutside));
  assert.equal(a.start, DEFAULTS.start);
  assert.equal(a.end, DEFAULTS.end);
  assert.equal(a.lunchOn, false);
  assert.equal(loadState(fakeStorage({ [KEY]: exportState(lunchOutside) })).dropped.length, 0);

  // 午休順序倒掛但開關本來就是關的：時段仍然原樣保留。
  const offReversed = {
    ...canonical(),
    cfg: { ...DEFAULTS, lunchOn: false, lunchStart: '13:00', lunchEnd: '12:00' },
  };
  const b = JSON.parse(exportState(offReversed));
  assert.equal(b.lunchOn, false);
  assert.equal(b.lunchStart, '13:00');
  assert.equal(b.lunchEnd, '12:00');
  assert.deepEqual(loadState(fakeStorage({ [KEY]: exportState(offReversed) })).dropped, []);

  // 上下班時間本身倒掛：整組時段退回預設。
  const badShift = { ...canonical(), cfg: { ...DEFAULTS, start: '18:00', end: '09:00' } };
  const c = JSON.parse(exportState(badShift));
  assert.equal(c.start, DEFAULTS.start);
  assert.equal(c.end, DEFAULTS.end);
  assert.deepEqual(loadState(fakeStorage({ [KEY]: exportState(badShift) })).dropped, []);
});

test('load: 两套键按版本分流，过时键回报未知而不套用', () => {
  // v3 裡出現頂層 salary / marks：屬於過時鍵，不併入任何地區。
  const v3 = loadState(fakeStorage({ [KEY]: legacyRaw({ version: 3, salary: 9000, marks: { '2026-05-04': 'rest' } }) }));
  assert.equal(v3.corrupt, false);
  assert.deepEqual(v3.dropped, []);
  assert.deepEqual(v3.state.salaries, { TW: 40000, CN: 5000 });
  assert.deepEqual(v3.state.marksByRegion, { TW: {}, CN: {} });
  // 舊版裡出現地區鍵：沒有地區概念，不能當成 CN 或 TW 的資料。
  const old = loadState(fakeStorage({ [KEY]: legacyRaw({ version: 2, salaries: { CN: 9000 }, marksByRegion: { CN: { '2026-05-04': 'rest' } } }) }));
  assert.equal(old.corrupt, false);
  assert.deepEqual(old.dropped, []);
  assert.deepEqual(old.state.salaries, { TW: 40000, CN: 5000 });
  assert.deepEqual(old.state.marksByRegion, { TW: {}, CN: {} });
  assert.equal(old.state.region, 'CN', '旧版无地区信息，仍按 CN 保守回退');
});

test('export -> import round trip：两地资料原样回来', () => {
  const state = canonical({
    region: 'TW',
    cfg: { ...DEFAULTS, weekends: true, payday: 31, showLunar: false, theme: 'blue' },
    salaries: { TW: 12345.5, CN: 6800 },
    marksByRegion: { TW: { '2026-05-04': 'paidLeave' }, CN: { '2026-05-05': 'unpaidLeave' } },
  });
  const r = importState(exportState(state), tw());
  assert.deepEqual(r.state, state);
  assert.deepEqual(r.dropped, []);
  assert.deepEqual(r.unknown, []);
  assert.equal(r.applied.length, 1 + 2 + 1 + 1 + Object.keys(DEFAULTS).length, 'region + 两地月薪 + 两笔标记 + 共享设置');
});

test('import v3：只给部分地区时其余保留现值', () => {
  const current = canonical({ region: 'CN', salaries: { TW: 40000, CN: 6800 } });
  const r = importState('{"version":3,"salaries":{"CN":7500},"marksByRegion":{"TW":{"2026-05-04":"rest"}}}', current);
  assert.equal(r.state.salaries.CN, 7500);
  assert.equal(r.state.salaries.TW, 40000);
  assert.deepEqual(r.state.marksByRegion.TW, { '2026-05-04': 'rest' });
  assert.deepEqual(r.state.marksByRegion.CN, {});
  assert.equal(r.state.region, 'CN', '备份没写 region 就不切地区');
  assert.deepEqual(r.applied.sort(), ['marksByRegion.TW.2026-05-04', 'salaries.CN']);
});

test('import v3：region 有效即切换，两地资料各自保留', () => {
  const current = canonical({ region: 'CN', salaries: { TW: 40000, CN: 6800 } });
  const r = importState('{"version":3,"region":"TW","salaries":{"TW":52000}}', current);
  assert.equal(r.state.region, 'TW');
  assert.equal(r.state.salaries.TW, 52000);
  assert.equal(r.state.salaries.CN, 6800);
  assert.deepEqual(r.applied.sort(), ['region', 'salaries.TW']);
  const bad = importState('{"version":3,"region":"JP"}', current);
  assert.equal(bad.state.region, 'CN');
  assert.deepEqual(bad.dropped.map((d) => d.field), ['region']);
});

test('旧备份在 TW 汇入：salary / marks 一律写进 CN，当前地区不变', () => {
  const current = canonical({ region: 'TW', salaries: { TW: 40000, CN: 5000 } });
  const r = importState('{"version":2,"salary":6800,"marks":{"2026-05-04":"rest"},"cheer":"冲"}', current);
  assert.equal(r.state.region, 'TW', '旧备份不切换地区');
  assert.equal(r.state.salaries.CN, 6800);
  assert.equal(r.state.salaries.TW, 40000);
  assert.deepEqual(r.state.marksByRegion.CN, { '2026-05-04': 'rest' });
  assert.deepEqual(r.state.marksByRegion.TW, {});
  assert.deepEqual(r.state.cfg.cheers, ['冲']);
  assert.deepEqual(r.applied.sort(), ['cheers', 'marksByRegion.CN.2026-05-04', 'salaries.CN']);
});

test('import v3 里混入旧 salary / marks 属过时键：回报未知，不并入任何地区', () => {
  const current = canonical({ region: 'CN' });
  const r = importState('{"version":3,"salary":7000,"marks":{"2026-05-05":"work"}}', current);
  assert.deepEqual(r.unknown.sort(), ['marks', 'salary']);
  assert.deepEqual(r.dropped, []);
  assert.deepEqual(r.applied, []);
  assert.equal(r.state.salaries.CN, current.salaries.CN);
  assert.deepEqual(r.state.marksByRegion, current.marksByRegion);
  assert.equal(r.state.cfg.salary, undefined);
});

test('import: 非法地区子项互相隔离，只丢该栏并报告原因', () => {
  const current = canonical();
  const raw = JSON.stringify({
    version: 3,
    salaries: { TW: 'abc', CN: 8000, XX: 1 },
    marksByRegion: { TW: [1], CN: { '2026-02-30': 'work', 'x': 'work', '2026-05-05': 'bogus', '2026-05-06': 'unpaidLeave' } },
  });
  const r = importState(raw, current);
  assert.equal(r.state.salaries.TW, 40000);
  assert.equal(r.state.salaries.CN, 8000);
  assert.deepEqual(r.state.marksByRegion.TW, {});
  assert.deepEqual(r.state.marksByRegion.CN, { '2026-05-06': 'unpaidLeave' });
  assert.deepEqual(r.dropped.map((d) => d.field).sort(), [
    'marksByRegion.CN.2026-02-30', 'marksByRegion.CN.2026-05-05', 'marksByRegion.CN.x',
    'marksByRegion.TW', 'salaries.TW', 'salaries.XX',
  ]);
  assert.deepEqual(r.applied, ['salaries.CN', 'marksByRegion.CN.2026-05-06']);
});

test('import: 容器不是物件时只丢容器的该地区，保留现值', () => {
  const current = canonical({ marksByRegion: { TW: { '2026-05-04': 'rest' }, CN: {} } });
  const r = importState('{"version":3,"salaries":[],"marksByRegion":[1]}', current);
  assert.deepEqual(r.state.salaries, current.salaries);
  assert.deepEqual(r.state.marksByRegion, current.marksByRegion);
  assert.deepEqual(r.dropped.map((d) => d.field).sort(), ['marksByRegion', 'salaries']);
  const legacy = importState('{"marks":[1]}', current);
  assert.deepEqual(legacy.dropped.map((d) => d.field), ['marksByRegion.CN']);
  assert.deepEqual(legacy.state.marksByRegion, current.marksByRegion);
});

test('import: 无法识别的未来版本整份拒绝', () => {
  for (const raw of ['{"version":5,"salary":9000}', '{"version":"3","region":"TW"}', '{"version":null}']) {
    const r = importState(raw, tw());
    assert.equal(typeof r.error.code, 'string', raw);
    assert.equal(r.error.code, 'futureVersion', raw);
    assert.equal(r.state, undefined, raw);
    assert.equal(r.dropped, undefined, raw);
  }
});

test('import: 非 JSON / 阵列 / null / 纯量 -> error（稳定 code，不带译文）', () => {
  const cases = [['not json', 'notJson'], ['[]', 'notObject'], ['null', 'notObject'], ['3', 'notObject'], ['"x"', 'notObject'], ['true', 'notObject']];
  for (const [text, code] of cases) {
    const r = importState(text, tw());
    assert.equal(r.error.code, code, text);
    assert.equal(typeof r.error.reason, 'undefined', `${text}: 不得回传已翻译的字串`);
    assert.equal(r.state, undefined);
  }
});

test('import: 非法的两地月薪逐栏丢弃，旧值保留', () => {
  const current = canonical({ salaries: { TW: 41000, CN: 7000 } });
  const r = importState('{"version":3,"salaries":{"TW":"abc","CN":0}}', current);
  assert.deepEqual(r.state.salaries, { TW: 41000, CN: 7000 });
  assert.deepEqual(r.dropped.map((d) => d.field).sort(), ['salaries.CN', 'salaries.TW']);
  assert.deepEqual(r.applied, []);
});

test('import: 未知栏位回报，不套用', () => {
  const r = importState('{"version":3,"foo":1,"salaries":{"CN":7000}}', tw());
  assert.deepEqual(r.unknown, ['foo']);
  assert.equal(r.state.cfg.foo, undefined);
  assert.equal(r.state.salaries.CN, 7000);
  // 舊版備份裡的地區鍵同屬無法識別的過時鍵：不套用、不汙染其他地區。
  const legacy = importState('{"salaries":{"TW":1},"marksByRegion":{"TW":{}}}', tw());
  assert.deepEqual(legacy.unknown.sort(), ['marksByRegion', 'salaries']);
  assert.deepEqual(legacy.state, tw());
});

test('import: 严格校验，绝不转型（含两地结构与开关）', () => {
  const bad = {
    version: 3,
    start: '8:30', end: 1700, lunchOn: 'true', weekends: 1, payday: 0, cheer: 5,
    region: 1, salaries: { TW: '7000' }, marksByRegion: { CN: 'x' },
  };
  const r = importState(JSON.stringify(bad), tw());
  assert.deepEqual(r.state, tw());
  assert.deepEqual(r.dropped.map((d) => d.field).sort(), [
    'cheer', 'end', 'lunchOn', 'marksByRegion.CN', 'payday', 'region', 'salaries.TW', 'start', 'weekends',
  ]);
  assert.equal(importState('{"payday":32}', tw()).dropped[0].field, 'payday');
  assert.equal(importState('{"payday":1.5}', tw()).dropped[0].field, 'payday');
  assert.equal(importState('{"payday":null}', canonical({ cfg: { ...DEFAULTS, payday: 5 } })).state.cfg.payday, null);
  assert.equal(importState('{"payday":31}', tw()).state.cfg.payday, 31);
  assert.deepEqual(importState('{"cheer":"<script>x</script>"}', tw()).state.cfg.cheers, ['<script>x</script>']);
});

test('import: 鼓励语长度上限', () => {
  const r = importState(JSON.stringify({ cheer: 'x'.repeat(41) }), tw());
  assert.deepEqual(r.state.cfg.cheers, ['']);
  assert.equal(r.dropped[0].field, 'cheer');
  assert.equal(importState(JSON.stringify({ cheer: 'x'.repeat(40) }), tw()).state.cfg.cheers[0].length, 40);
});

test('multi-cheer migration, validation and backup preserve all entries', () => {
  const legacy = loadState(fakeStorage({ [KEY]: JSON.stringify({ version: 3, region: 'TW', cheer: '原句' }) }));
  assert.deepEqual(legacy.state.cfg.cheers, ['原句']);
  const current = defaultState();
  const r = importState(JSON.stringify({ version: 4, cheers: ['第一句', '', '第二句'] }), current);
  assert.deepEqual(r.state.cfg.cheers, ['第一句', '', '第二句']);
  assert.deepEqual(importState(exportState(r.state), current).state.cfg.cheers, ['第一句', '', '第二句']);
  for (const invalid of [[], [4], ['ok', 'x'.repeat(41)]]) {
    const bad = importState(JSON.stringify({ version: 4, cheers: invalid }), r.state);
    assert.deepEqual(bad.state.cfg.cheers, r.state.cfg.cheers);
    assert.equal(bad.dropped[0].field, 'cheers');
  }
});

test('import: 农历与主题各自保留现值，非法值只丢该栏', () => {
  const current = canonical({ cfg: { ...DEFAULTS, showLunar: false, theme: 'blue' } });
  assert.equal(importState(exportState(current), tw()).state.cfg.showLunar, false);
  assert.equal(importState(exportState(current), tw()).state.cfg.theme, 'blue');
  assert.equal(importState('{"version":1,"salary":9000}', current).state.cfg.showLunar, false);
  const invalid = importState('{"showLunar":"false","theme":"other"}', current);
  assert.equal(invalid.state.cfg.showLunar, false);
  assert.equal(invalid.state.cfg.theme, 'blue');
  assert.deepEqual(invalid.dropped.map((d) => d.field).sort(), ['showLunar', 'theme']);
});

test('curated themes survive storage and backup round trips', () => {
  for (const theme of ['teal', 'rose', 'slate', 'rainbow']) {
    const state = canonical({ cfg: { ...DEFAULTS, theme } });
    const storage = fakeStorage();
    assert.equal(saveState(storage, state).ok, true);
    assert.equal(loadState(storage).state.cfg.theme, theme);
    const backup = exportState(state);
    assert.equal(importState(backup, tw()).state.cfg.theme, theme);
  }
});


test('import (R7): 时间合起来不成立时一并丢弃，用旧午休 fixture', () => {
  const current = canonical({
    cfg: { ...DEFAULTS, lunchOn: true, lunchStart: '11:30', lunchEnd: '13:00' },
  });
  const r = importState('{"start":"18:00","end":"19:00"}', current); // 舊午休 11:30–13:00 落在這段時間之外
  assert.equal(r.state.cfg.start, '09:00');
  assert.equal(r.state.cfg.end, '18:00');
  assert.deepEqual(r.dropped.map((d) => d.field).sort(), ['end', 'start']);
  assert.ok(r.dropped.every((d) => typeof d.reason.code === 'string' && d.reason.code.length > 0));
  assert.deepEqual(r.applied, []);
  const r2 = importState('{"start":"17:00","end":"09:00"}', current);
  assert.deepEqual(r2.state, current);
  assert.equal(r2.dropped.length, 2);
});

test('import (R7): 时段与午休合起来不成立时回退时段，只留合法的开关', () => {
  const current = canonical({ cfg: { ...DEFAULTS, start: '08:30', end: '17:00', lunchOn: false, lunchStart: '12:00', lunchEnd: '13:00' } });
  const r = importState('{"start":"14:00","end":"18:00","lunchOn":true,"lunchStart":"08:00","lunchEnd":"09:00"}', current);
  assert.deepEqual(r.state.cfg, { ...current.cfg, lunchOn: true });
  assert.deepEqual(r.dropped.map((d) => d.field).sort(), ['end', 'lunchEnd', 'lunchStart', 'start']);
  assert.deepEqual(r.applied, ['lunchOn'], '开关本身合法，保留并计入已导入');
});

test('import (R7): 时段与时区内的午休一起合法时全部套用', () => {
  const current = canonical({ cfg: { ...DEFAULTS, lunchOn: false } });
  const r = importState('{"start":"09:00","end":"18:00","lunchOn":true,"lunchStart":"12:00","lunchEnd":"13:00"}', current);
  assert.equal(r.state.cfg.start, '09:00');
  assert.equal(r.state.cfg.end, '18:00');
  assert.equal(r.state.cfg.lunchOn, true);
  assert.deepEqual(r.dropped, []);
  assert.deepEqual(r.applied.sort(), ['end', 'lunchEnd', 'lunchOn', 'lunchStart', 'start']);
});

test('import 不修改 current（含两地结构）', () => {
  const c = canonical({
    region: 'TW',
    cfg: { ...DEFAULTS, cheers: ['冲'] },
    salaries: { TW: 9000, CN: 6800 },
    marksByRegion: { TW: { '2026-05-04': 'rest' }, CN: {} },
  });
  const snapshot = JSON.parse(JSON.stringify(c));
  importState('{"version":3,"region":"CN","salaries":{"TW":1,"CN":2},"marksByRegion":{"CN":{"2026-05-05":"work"}},"cheer":"改"}', c);
  assert.deepEqual(c, snapshot);
  importState('{"salary":1,"marks":{"2026-05-04":"rest"}}', c);
  assert.deepEqual(c, snapshot);
});

test('储存失败 / 内容损坏都不覆写原始内容', () => {
  const raw = legacyRaw({ version: 2, salary: 6800, marks: { '2026-05-04': 'rest' } });
  const st = fakeStorage({ [KEY]: raw });
  st.setItem = () => { throw new Error('quota'); };
  loadState(st);
  assert.equal(st._m.get(KEY), raw);
  const denied = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  assert.equal(loadState(denied).storageOk, false);
});
