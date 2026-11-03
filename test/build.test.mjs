import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

export function findExternalRefs(html) {
  const problems = [];
  if (/<script[^>]*\ssrc\s*=/i.test(html)) problems.push('external <script src>');
  if (/<link[^>]*rel\s*=\s*["']?stylesheet/i.test(html)) problems.push('<link rel=stylesheet>');
  const urls = html.match(/https?:\/\/[^\s"'<>)]*/gi) ?? [];
  for (const u of urls) {
    if (!u.startsWith('http://www.w3.org/')) problems.push(`URL: ${u}`);
  }
  return problems;
}

test('dist is one self-contained file', () => {
  execFileSync('node', ['build.mjs'], { cwd: root, stdio: 'pipe' });
  const html = readFileSync(join(root, 'dist/work-motivator.html'), 'utf8');
  assert.deepEqual(findExternalRefs(html), []);
  assert.match(html, /<script>[\s\S]+<\/script>/);
  assert.match(html, /<style>[\s\S]+<\/style>/);
});

test('checker flags injected external refs (negative check)', () => {
  assert.ok(findExternalRefs('<script src="a.js"></script>').length);
  assert.ok(findExternalRefs('<link rel="stylesheet" href="a.css">').length);
  assert.ok(findExternalRefs('<script>fetch("https://x.com")</script>').length);
  assert.ok(findExternalRefs('<script>fetch("http://x.com")</script>').length);
  assert.deepEqual(findExternalRefs('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), []);
});
