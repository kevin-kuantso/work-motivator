import { test } from 'node:test';
import assert from 'node:assert/strict';
import info from '../desktop/repository-info.cjs';

test('about info always links to the general-edition repository and includes the packaged version', () => {
  assert.equal(info.REPOSITORY_URL, 'https://github.com/kevin-kuantso/work-motivator');
  assert.match(info.aboutText('1.3.0', 'TW'), /1\.3\.0/);
  assert.match(info.aboutText('1.3.0', 'CN'), /GitHub/);
});
