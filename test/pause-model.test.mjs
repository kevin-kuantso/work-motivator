import test from 'node:test';
import assert from 'node:assert/strict';
import { STALL_MS, readTicks, stallGap, sleptGap, isStall } from '../src/ui/pause-model.js';

const v = (perf, wall) => ({ perf, wall, hidden: false });
const hid = (perf, wall) => ({ perf, wall, hidden: true });

test('stallGap = max(monotonic gap, wall-clock gap); first tick has no gap', () => {
  assert.equal(stallGap(null, v(10, 10)), 0);
  assert.equal(stallGap(v(0, 0), v(100, 100)), 100);
  assert.equal(stallGap(v(0, 0), v(60000, 100)), 60000, 'throttled / frozen: monotonic gap');
  assert.equal(stallGap(v(0, 0), v(100, 60000)), 60000, 'macOS sleep: only the wall clock moved (R42)');
  assert.equal(stallGap(v(0, 0), v(100, -60000)), 100, 'wall clock set backwards is not a stall');
});

test('sleptGap = wall-clock delta minus monotonic delta (time the machine slept)', () => {
  assert.equal(sleptGap(null, v(1, 1)), 0);
  assert.equal(sleptGap(v(0, 0), v(60000, 60000)), 0, 'intensive throttling: both clocks moved together');
  assert.equal(sleptGap(v(0, 0), v(100, 60100)), 60000, 'sleep');
});

test('visible: isStall when max(perf gap, wall gap) > 5000 ms', () => {
  assert.equal(STALL_MS, 5000);
  assert.equal(isStall(v(0, 0), v(5000, 5000)), false);
  assert.equal(isStall(v(0, 0), v(5001, 5001)), true, 'visible 6 s stall');
  assert.equal(isStall(v(0, 0), v(5001, 0)), true);
  assert.equal(isStall(v(0, 0), v(0, 5001)), true, 'wall-only jump detected (fails without the wall term)');
  assert.equal(isStall(null, v(1e9, 1e9)), false, 'never on the first tick');
});

test('R44 hidden: a large monotonic gap alone (intensive wake-up throttling, 1/min) is NOT a stall; only sleep is', () => {
  assert.equal(isStall(hid(0, 0), hid(60000, 60000)), false, 'one tick per minute while hidden');
  assert.equal(isStall(v(0, 0), hid(60000, 60000)), false, 'gap ending in a hidden tick');
  assert.equal(isStall(hid(0, 0), v(60000, 60000)), false, 'first tick after returning measures the hidden span → hidden rule');
  assert.equal(isStall(hid(0, 0), hid(100, 5100)), false, 'slept exactly 5000 ms: not more than');
  assert.equal(isStall(hid(0, 0), hid(100, 5101)), true, 'slept > 5 s');
  assert.equal(isStall(hid(0, 0), hid(60000, 125000)), true, 'throttled and slept: wall − perf = 65 s');
});

test('readTicks reads the injected monotonic, wall and visibility readers', () => {
  let p = 1;
  let w = 2;
  let h = false;
  const read = readTicks(() => p, () => w, () => h);
  assert.deepEqual(read(), { perf: 1, wall: 2, hidden: false });
  p = 7; w = 9; h = true;
  assert.deepEqual(read(), { perf: 7, wall: 9, hidden: true });
});
