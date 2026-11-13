import { test } from 'node:test';
import assert from 'node:assert/strict';
import layout from '../desktop/widget-layout.cjs';

test('widget opens inside the work area at the generic card dimensions', () => {
  const result = layout.planWidgetLayout({ workArea: { x: 0, y: 0, width: 1440, height: 900 }, scale: 'm' });
  assert.deepEqual(result, { x: 1072, y: 684, width: 352, height: 200, manual: false, scale: 'm' });
});

test('widget clamps a manually widened/tall window to the current display without losing manual height', () => {
  const result = layout.planWidgetLayout({ current: { x: 900, y: 800, width: 800, height: 700, manual: true }, reason: 'measure', measured: { height: 240 }, scale: 'xs', workArea: { x: 0, y: 0, width: 700, height: 500 } });
  assert.equal(result.width, 668);
  assert.equal(result.height, 468);
  assert.equal(result.x, 16);
  assert.equal(result.y, 16);
  assert.equal(result.manual, true);
});

test('an automatic widget adopts measured content height', () => {
  const result = layout.planWidgetLayout({ current: { width: 352, height: 500, manual: false }, reason: 'measure', measured: { height: 312 }, workArea: { x: 0, y: 0, width: 1000, height: 800 } });
  assert.equal(result.height, 312);
  assert.equal(result.width, 352);
});

test('a content change refits a manually resized widget, while ordinary measurements preserve it', () => {
  const args = { current: { x: 400, y: 200, width: 500, height: 620, manual: true }, measured: { height: 276 }, scale: 'm', workArea: { x: 0, y: 0, width: 1200, height: 900 } };
  assert.equal(layout.planWidgetLayout({ ...args, reason: 'measure' }).height, 620);
  const refit = layout.planWidgetLayout({ ...args, reason: 'content' });
  assert.equal(refit.height, 276);
  assert.equal(refit.width, 500);
  assert.equal(refit.manual, false);
});

test('content measurement keeps a saved off-screen widget inside the active display work area', () => {
  const result = layout.planWidgetLayout({
    current: { x: -90, y: 900, width: 400, height: 600, manual: false },
    reason: 'content', measured: { height: 240 }, scale: 'l', workArea: { x: -1440, y: 0, width: 1440, height: 820 },
  });
  assert.deepEqual(result, { x: -416, y: 564, width: 400, height: 240, manual: false, scale: 'l' });
});

test('a fresh widget uses the changed font-scale width before it has ever been opened', () => {
  const result = layout.planWidgetLayout({ reason: 'content', measured: { height: 230 }, scale: 'xl', workArea: { x: 0, y: 0, width: 1440, height: 900 } });
  assert.equal(result.width, 384);
  assert.equal(result.height, 230);
  assert.equal(result.scale, 'xl');
});

test('a manual resize at the display edge is clamped back into the work area and remains manual', () => {
  const result = layout.planWidgetLayout({ current: { x: 1212, y: 680, width: 640, height: 200, manual: true }, reason: 'resize', scale: 'm', workArea: { x: 0, y: 0, width: 1512, height: 900 } });
  assert.deepEqual(result, { x: 856, y: 680, width: 640, height: 200, manual: true, scale: 'm' });
});
