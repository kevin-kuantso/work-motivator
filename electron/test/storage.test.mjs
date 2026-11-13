import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import storage from '../desktop/storage.cjs';

test('desktop storage filters to the v4 application namespace and writes a string-only snapshot', () => {
  const clean = storage.filterSnapshot({ 'work-motivator-v1': '{}', 'work-motivator-v1-ui': '{}', elsewhere: 'keep out' });
  assert.deepEqual(clean, { 'work-motivator-v1': '{}', 'work-motivator-v1-ui': '{}' });
  assert.throws(() => storage.filterSnapshot({ 'work-motivator-v1': {} }), /strings/);
  const file = join(mkdtempSync(join(tmpdir(), 'wm-storage-')), 'snapshot.json');
  storage.writeSnapshot(file, clean);
  assert.deepEqual(storage.readSnapshot(file), clean);
  assert.match(readFileSync(file, 'utf8'), /work-motivator-v1/);
});
