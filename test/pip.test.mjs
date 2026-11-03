import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPipSupported, PIP_SIZE } from '../src/pip.js';

test('isPipSupported: feature detection on documentPictureInPicture.requestWindow', () => {
  assert.equal(isPipSupported({ documentPictureInPicture: { requestWindow() {} } }), true);
  assert.equal(isPipSupported({}), false);
  assert.equal(isPipSupported({ documentPictureInPicture: null }), false);
  assert.equal(isPipSupported({ documentPictureInPicture: {} }), false);
  assert.equal(isPipSupported(null), false);
});

test('PiP window size is 340x280 (spec §11.15)', () => {
  assert.deepEqual(PIP_SIZE, { width: 340, height: 280 });
});
