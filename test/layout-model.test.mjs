// 版面重设计（spec §13）的纯逻辑：提示条两条通道的合并 / 排队规则，以及月历格子颜色的对比度（实算）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
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

// WCAG 2.x 相对亮度与对比度：https://www.w3.org/TR/WCAG22/#dfn-contrast-ratio
const lum = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
export const contrast = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

const CSS = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'style.css'), 'utf8');
const tokens = Object.fromEntries([...CSS.matchAll(/(--[\w-]+)\s*:\s*(#[0-9A-Fa-f]{6})/g)].map((m) => [m[1], m[2]]));
const ruleUses = (selector, prop, token) => {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[},\\s])${esc}\\s*(,[^{]*)?\\{[^}]*${prop}\\s*:[^;}]*var\\(${token}\\)`, 'm').test(CSS);
};

test('contrast helper matches known values (sanity)', () => {
  assert.equal(contrast('#000000', '#FFFFFF').toFixed(2), '21.00');
  assert.equal(contrast('#6B7280', '#F3F4F6').toFixed(2), '4.39', 'the old failing pair from spec §13.3');
});

test('weekend / holiday day numbers have ≥ 4.5:1 contrast on their cell backgrounds (computed from style.css tokens)', () => {
  const pairs = [
    ['--cal-weekend-num', '--cal-weekend-bg', '.kind-weekend .day-num', '.kind-weekend'],
    ['--cal-holiday-num', '--cal-holiday-bg', '.kind-holiday .day-num', '.kind-holiday'],
    ['--cal-weekend-num', '--cal-rest-bg', '.kind-rest .day-num', '.kind-rest'],
  ];
  for (const [fg, bg, numSel, cellSel] of pairs) {
    assert.ok(tokens[fg] && tokens[bg], `${fg}/${bg} defined`);
    assert.ok(ruleUses(numSel, 'color', fg), `${numSel} uses ${fg}`);
    assert.ok(ruleUses(cellSel, 'background', bg), `${cellSel} uses ${bg}`);
    const r = contrast(tokens[fg], tokens[bg]);
    assert.ok(r >= 4.5, `${fg} ${tokens[fg]} on ${bg} ${tokens[bg]} = ${r.toFixed(2)}`);
  }
});

test('H4: holiday and weekend cells are visibly different states (contrast + hue separation, no shared grey)', () => {
  const hex = (k) => tokens[k];
  const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const holidayBg = rgb(hex('--cal-holiday-bg'));
  const weekendBg = rgb(hex('--cal-weekend-bg'));
  // 1) 周末必须是中性灰（三通道几乎相等），否则两格看起来是「两种绿」
  assert.ok(Math.max(...weekendBg) - Math.min(...weekendBg) <= 6, `weekend stays neutral grey: ${hex('--cal-weekend-bg')}`);
  // 2) 假日底必须是明显的绿/青：绿通道同时高于红、蓝
  const [hr, hg, hb] = holidayBg;
  assert.ok(hg - hr >= 60 && hg - hb >= 6, `holiday bg is clearly green/teal, not near-white grey: ${hex('--cal-holiday-bg')} (${holidayBg})`);
  // 3) 两个底色至少在一个通道上差 ≥ 30：一眼能分出「放假」和「周末」
  assert.ok(Math.max(...holidayBg.map((v, i) => Math.abs(v - weekendBg[i]))) >= 30, 'holiday and weekend backgrounds are far apart');
  // 4) 格子文字仍须 ≥ 4.5:1（诚实地用新 token 重算）
  for (const [fg, bg] of [['--cal-holiday-num', '--cal-holiday-bg'], ['--state-holiday-fg', '--cal-holiday-bg'], ['--color-text-900', '--cal-holiday-bg']]) {
    const r = contrast(hex(fg), hex(bg));
    assert.ok(r >= 4.5, `${fg} ${hex(fg)} on ${bg} ${hex(bg)} = ${r.toFixed(2)}`);
  }
  // 5) 假日格的文字色不再借「休息日」的灰（那是另一类状态）
  assert.ok(ruleUses('.kind-holiday', 'color', '--state-holiday-fg'), '.kind-holiday text uses the holiday token');
});

test('cell tag colours (假 / 班 / 带薪 / 无薪) have ≥ 4.5:1 contrast on their backgrounds', () => {
  const pairs = [
    ['--state-rest-fg', '--state-rest-bg'],
    ['--state-makeup-fg', '--state-makeup-bg'],
    ['--state-paid-fg', '--state-paid-bg'],
    ['--state-unpaid-fg', '--state-unpaid-bg'],
    ['--state-unpaid-fg', '--state-unpaid-stripe'],
  ];
  for (const [fg, bg] of pairs) {
    const r = contrast(tokens[fg], tokens[bg]);
    assert.ok(r >= 4.5, `${fg} ${tokens[fg]} on ${bg} ${tokens[bg]} = ${r.toFixed(2)}`);
  }
  assert.ok(ruleUses('.kind-unpaid', 'background', '--state-unpaid-stripe'), 'stripe colour comes from the token');
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
