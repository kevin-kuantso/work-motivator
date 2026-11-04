// 版面重设计（spec §13）的纯逻辑：提示条两条通道的合并 / 排队规则，以及月历格子颜色的对比度（实算）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mergeErrors, pickInfo } from '../src/ui/banners.js';

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
