import test from 'node:test';
import assert from 'node:assert/strict';
import { STALL_MS, readTicks, stallGap, isStall } from '../src/ui/pause-model.js';

test('stallGap = max(monotonic gap, wall-clock gap); first tick has no gap', () => {
  assert.equal(stallGap(null, { perf: 10, wall: 10 }), 0);
  assert.equal(stallGap({ perf: 0, wall: 0 }, { perf: 100, wall: 100 }), 100);
  assert.equal(stallGap({ perf: 0, wall: 0 }, { perf: 60000, wall: 100 }), 60000, 'throttled / frozen: monotonic gap');
  assert.equal(stallGap({ perf: 0, wall: 0 }, { perf: 100, wall: 60000 }), 60000, 'macOS sleep: only the wall clock moved (R42)');
  assert.equal(stallGap({ perf: 0, wall: 0 }, { perf: 100, wall: -60000 }), 100, 'wall clock set backwards is not a stall');
});

test('isStall: strictly more than 5000 ms on either clock', () => {
  assert.equal(STALL_MS, 5000);
  assert.equal(isStall({ perf: 0, wall: 0 }, { perf: 5000, wall: 5000 }), false);
  assert.equal(isStall({ perf: 0, wall: 0 }, { perf: 5001, wall: 0 }), true);
  assert.equal(isStall({ perf: 0, wall: 0 }, { perf: 0, wall: 5001 }), true, 'wall-only jump detected (fails without the wall term)');
  assert.equal(isStall(null, { perf: 1e9, wall: 1e9 }), false, 'never on the first tick');
});

test('readTicks reads the injected monotonic and wall readers', () => {
  let p = 1;
  let w = 2;
  const read = readTicks(() => p, () => w);
  assert.deepEqual(read(), { perf: 1, wall: 2 });
  p = 7; w = 9;
  assert.deepEqual(read(), { perf: 7, wall: 9 });
});
