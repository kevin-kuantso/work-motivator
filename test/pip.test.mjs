import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPipSupported, pipHeight, PIP_WIDTH } from '../src/pip.js';

test('isPipSupported: feature detection on documentPictureInPicture.requestWindow', () => {
  assert.equal(isPipSupported({ documentPictureInPicture: { requestWindow() {} } }), true);
  assert.equal(isPipSupported({}), false);
  assert.equal(isPipSupported({ documentPictureInPicture: null }), false);
  assert.equal(isPipSupported({ documentPictureInPicture: {} }), false);
  assert.equal(isPipSupported(null), false);
});

test('pipHeight: at least 280, grows with content, capped at 520', () => {
  assert.equal(PIP_WIDTH, 340);
  assert.equal(pipHeight(277.8), 280);
  assert.equal(pipHeight(280), 280);
  assert.equal(pipHeight(340.2), 341, 'rounds up so content is never clipped');
  assert.equal(pipHeight(900), 520);
  assert.equal(pipHeight(NaN), 280);
  assert.equal(pipHeight(0), 280);
});
