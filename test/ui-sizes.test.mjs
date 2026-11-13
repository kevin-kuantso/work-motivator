import test from 'node:test';
import assert from 'node:assert/strict';
import { readSizes } from '../src/ui/window-sizes.js';

test('readSizes preserves old dimensions as manual and keeps explicit automatic sizing', () => {
  assert.deepEqual(readSizes({
    m: { width: 340, height: 420 },
    xl: { width: 384, height: 355, manual: false },
  }), {
    m: { width: 340, height: 420, manual: true },
    xl: { width: 384, height: 355, manual: false },
  });
});
