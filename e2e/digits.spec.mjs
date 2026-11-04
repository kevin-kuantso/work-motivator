// R33：每 tick 变化的数字用固定宽度数字格，与字体本身的数字是否等宽无关。
// 刻意换成本机上「比例数字」的字体组合（system-ui, sans-serif + font-variant-numeric: normal），
// 先用纯文字证明它确实是比例数字（负对照），再证明数字格让同长度字符串宽度完全一样；主分页与 PiP stub 文件都测。
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { build } from 'esbuild';
import { startServer, launch, openAt, expectedAutoUrls, pipStub, root } from './harness.mjs';

const T1412 = '2026-11-03T14:12:00+08:00';
const GROUPS = [
  ['1,565.5456', '1,111.1111', '8,888.8888', '1,000.0000'],
  ['888.8888', '111.1111', '123.4567', '000.0000'],
  ['0.0000', '1.1111', '8.8888'],
];
// 本机上量到是比例数字的旧字体组合（Chrome 在 macOS 上取 .SF NS，不开 tnum）
const PROPORTIONAL_CSS = '#status-card .amount, #status-card .card-countdown, #status-card .card-progress-text { font-family: system-ui, sans-serif !important; font-variant-numeric: normal !important; }';

let server;
let browser;
let helperJs;
before(async () => {
  server = await startServer();
  browser = await launch();
  // 把同一份 digits.js 打包成 window.__digits，用来把指定字符串画进真实的卡片元素
  const out = await build({ entryPoints: [join(root, 'src/ui/digits.js')], bundle: true, format: 'iife', globalName: '__digits', write: false });
  helperJs = out.outputFiles[0].text;
});
after(async () => {
  await browser?.close();
  await server?.close();
});

async function withPage(iso, fn, opts) {
  const { context, page, errors, external, consoleErrors, autoUrls } = await openAt(browser, server.url, iso, opts);
  try {
    assert.deepEqual(autoUrls, expectedAutoUrls(iso), 'auto-check requests on load');
    await fn(page);
    assert.deepEqual(errors.map(String), [], 'no uncaught page errors');
    assert.deepEqual(consoleErrors, [], 'no console errors');
    assert.deepEqual(external, autoUrls, 'no external request besides the load-time auto-check');
  } finally {
    await context.close();
  }
}

const spread = (w) => Math.max(...w) - Math.min(...w);
const pipFrame = (page) => page.frames().find((f) => f !== page.mainFrame() && f.url() === 'about:blank');

// 在 ctx（主分页或 PiP 的 frame）里：纯文字 vs 数字格，量 head + tail 的绘制宽度；同时独立量出该文件里最宽的数字
function measureGroups(groups) {
  const head = document.querySelector('#status-card .amount-head');
  const tail = document.querySelector('#status-card .amount-tail');
  const w = () => head.getBoundingClientRect().width + tail.getBoundingClientRect().width;
  const plain = groups.map((g) => g.map((v) => { head.textContent = v.slice(0, -2); tail.textContent = v.slice(-2); return w(); }));
  const cells = groups.map((g) => g.map((v) => { window.top.__digits.renderDigits(head, v.slice(0, -2)); window.top.__digits.renderDigits(tail, v.slice(-2)); return w(); }));
  const probe = document.createElement('span');
  probe.style.cssText = 'position:absolute;visibility:hidden';
  head.append(probe);
  const widest = Math.max(...[...'0123456789'].map((d) => { probe.textContent = d; probe.style.display = 'inline-block'; return probe.getBoundingClientRect().width; }));
  probe.remove();
  const cellW = [...head.querySelectorAll('.digit')].map((s) => s.getBoundingClientRect().width);
  return { plain, cells, widest, digitW: head.style.getPropertyValue('--digit-w'), cellW, font: getComputedStyle(head).fontFamily, fvn: getComputedStyle(head).fontVariantNumeric };
}

function assertGroups(m, where) {
  console.log(`MEASURE ${JSON.stringify({ case: `digits-${where}`, font: m.font, fvn: m.fvn, widest: m.widest, digitW: m.digitW, plain: m.plain, cells: m.cells })}`);
  assert.equal(m.fvn, 'normal');
  // 负对照：没有数字格时，这个字体的同长度字符串宽度不同（证明它是比例数字）
  assert.ok(m.plain.some((g) => spread(g) > 1), `${where}: negative control — plain text must be proportional here: ${JSON.stringify(m.plain)}`);
  for (const [i, g] of m.cells.entries()) assert.ok(spread(g) < 0.01, `${where}: same width with digit cells for ${GROUPS[i].join(' / ')}: ${g.join(' / ')}`);
  assert.equal(m.digitW, `${m.widest}px`, `${where}: --digit-w is the widest digit measured in this document`);
  assert.ok(m.cellW.every((x) => Math.abs(x - m.widest) < 0.01), `${where}: every cell is exactly that wide`);
}

test('main page: proportional font is proven proportional, digit cells make same-length strings identical in width', () =>
  withPage(T1412, async (page) => {
    await page.addStyleTag({ content: PROPORTIONAL_CSS });
    await page.addScriptTag({ content: helperJs });
    assertGroups(await page.evaluate(measureGroups, GROUPS), 'main');
  }));

test('PiP document: measured with the PiP document\'s own font and nodes, never the main document', () =>
  withPage(T1412, async (page) => {
    await page.addScriptTag({ content: helperJs });
    await page.locator('#btn-float').click();
    await page.frameLocator('iframe.pip-stub').locator('#status-card').waitFor();
    const frame = pipFrame(page);
    // 只在 PiP 文件里换成比例字体（主文件维持原样），并分别统计两个文件建立的元素
    await frame.addStyleTag({ content: PROPORTIONAL_CSS });
    await page.evaluate(() => {
      const count = (proto, key) => {
        const orig = proto.createElement;
        window[key] = 0;
        proto.createElement = function (...a) { window.top[key] += 1; return orig.apply(this, a); };
      };
      count(Document.prototype, '__mainCreates');
      count(document.querySelector('iframe.pip-stub').contentWindow.Document.prototype, '__pipCreates');
    });
    // 真实 tick（计时器在 PiP 视窗）：样式变了 → 签名变了 → 在 PiP 文件里重新量
    const ticks = [];
    for (let i = 0; i < 20; i += 1) {
      await page.clock.runFor(100);
      ticks.push(await frame.evaluate(() => {
        const a = document.querySelector('#status-card .card-amount');
        const r = document.createRange();
        r.selectNodeContents(a);
        return { w: r.getBoundingClientRect().width, text: a.textContent, digitW: a.querySelector('.amount-head').style.getPropertyValue('--digit-w') };
      }));
    }
    const creates = await page.evaluate(() => ({ main: window.__mainCreates, pip: window.__pipCreates }));
    console.log(`MEASURE ${JSON.stringify({ case: 'pip-ticks', creates, widths: [...new Set(ticks.map((t) => t.w))], texts: new Set(ticks.map((t) => t.text)).size, digitW: ticks[0].digitW })}`);
    assert.equal(creates.main, 0, 'no element created in the main document while the card ticks in PiP');
    assert.ok(creates.pip >= 11, `measurement probe (1 + 10 digits) built in the PiP document (${creates.pip})`);
    assert.ok(new Set(ticks.map((t) => t.text)).size >= 15, 'the amount really changed on (almost) every tick');
    assert.ok(spread(ticks.map((t) => t.w)) < 0.01, `PiP amount width constant over 20 ticks: ${[...new Set(ticks.map((t) => t.w))].join(' / ')}`);
    // 指定字符串（同一份 helper）：负对照 + 数字格；--digit-w 等于 PiP 文件里量到的最宽数字
    const m = await frame.evaluate(measureGroups, GROUPS);
    assertGroups(m, 'pip');
    assert.equal(ticks[0].digitW, m.digitW, 'the app measured the same width in the PiP document');
    assert.equal(await page.evaluate(() => window.__mainCreates), 0, 'still nothing created in the main document');
  }, { init: { content: `(${pipStub})({})` } }));

test('no layout shift: amount and 本月累计 rendered widths stay constant over 20 running ticks (proportional font)', () =>
  withPage(T1412, async (page) => {
    await page.addStyleTag({ content: PROPORTIONAL_CSS });
    await page.clock.runFor(100); // 字体换了：下一个 tick 重新量
    const rows = [];
    for (let i = 0; i < 20; i += 1) {
      await page.clock.runFor(100);
      rows.push(await page.evaluate(() => {
        const box = (sel) => {
          const el = document.querySelector(sel);
          const r = document.createRange();
          r.selectNodeContents(el);
          return { w: r.getBoundingClientRect().width, box: el.getBoundingClientRect().width, text: el.textContent };
        };
        return { amount: box('#status-card .card-amount'), month: box('#status-card .metric-month .metric-value') };
      }));
    }
    const amountTexts = new Set(rows.map((r) => r.amount.text));
    console.log(`MEASURE ${JSON.stringify({ case: 'no-shift', distinct: amountTexts.size, amountW: [...new Set(rows.map((r) => r.amount.w))], monthW: [...new Set(rows.map((r) => r.month.w))], months: [...new Set(rows.map((r) => r.month.text))] })}`);
    assert.ok(amountTexts.size >= 15, 'amount changed on (almost) every tick');
    assert.ok(spread(rows.map((r) => r.amount.w)) < 0.01, 'amount content width constant');
    assert.ok(spread(rows.map((r) => r.amount.box)) < 0.01, 'amount bounding box width constant');
    assert.ok(spread(rows.map((r) => r.month.w)) < 0.01, '本月累计 content width constant');
  }));

test('one tick only touches the cells whose character changed', () =>
  withPage(T1412, async (page) => {
    const r = await page.evaluate(() => {
      const amount = document.querySelector('#status-card .card-amount');
      window.__mut = [];
      window.__before = amount.textContent;
      new MutationObserver((list) => window.__mut.push(...list.map((m) => ({ target: m.target === amount ? 'amount' : m.target.parentNode?.classList?.[0] ?? '?', type: m.type, added: m.addedNodes.length, i: [...m.target.parentNode.childNodes].indexOf(m.target) })))).observe(amount, { subtree: true, childList: true, characterData: true });
      return null;
    }).then(() => page.clock.runFor(100)).then(() => page.evaluate(() => ({ before: window.__before, after: document.querySelector('#status-card .card-amount').textContent, mut: window.__mut })));
    const diff = [...r.after].filter((c, i) => c !== r.before[i]).length;
    console.log(`MEASURE ${JSON.stringify({ case: 'diff', before: r.before, after: r.after, diff, mutations: r.mut.length })}`);
    assert.equal(r.before.length, r.after.length);
    assert.ok(diff >= 1, 'the amount changed');
    assert.ok(r.mut.every((m) => m.target === 'amount-head' || m.target === 'amount-tail'), 'only cell spans mutated, containers untouched');
    assert.equal(new Set(r.mut.map((m) => `${m.target}:${m.i}`)).size, diff, 'one mutated cell per changed character');
  }));

test('copy gives the plain number; screen readers get the full text once (visual cells aria-hidden)', () =>
  withPage(T1412, async (page) => {
    const sel = await page.evaluate(() => {
      const pick = (el) => {
        const r = document.createRange();
        r.selectNodeContents(el);
        const s = getSelection();
        s.removeAllRanges();
        s.addRange(r);
        return s.toString();
      };
      const q = (s) => document.querySelector(s);
      return {
        amount: pick(q('#status-card .card-amount')),
        month: pick(q('#status-card .metric-month')),
        progress: pick(q('#status-card .card-progress')),
        countdown: pick(q('#status-card .card-countdown')),
        hidden: ['.card-amount', '.metric-month .metric-value', '.card-progress-text', '.card-countdown'].map((s) => q(`#status-card ${s}`).getAttribute('aria-hidden')),
        sr: [...document.querySelectorAll('#status-card .sr-text')].map((e) => e.textContent),
        digits: q('#status-card .card-amount').querySelectorAll('.digit').length,
      };
    });
    assert.equal(sel.amount, '¥ 194.2857');
    assert.equal(sel.month.replace(/\s+/g, ''), '本月累计¥518.10');
    assert.equal(sel.progress.trim(), '已工作 4.20 / 7.00 小时', 'copied once (the sr copy is not selectable)');
    assert.equal(sel.countdown, '距下班 2小时48分0秒');
    assert.deepEqual(sel.hidden, ['true', 'true', 'true', 'true']);
    assert.deepEqual(sel.sr, ['¥ 194.2857', '已工作 4.20 / 7.00 小时', '距下班 2小时48分0秒', '¥518.10']);
    assert.equal(sel.digits, 7);
    const aria = await page.locator('#status-card').ariaSnapshot();
    for (const s of ['¥ 194.2857', '已工作 4.20 / 7.00 小时', '距下班 2小时48分0秒', '¥518.10']) {
      assert.equal(aria.split(s).length - 1, 1, `accessible text "${s}" exactly once:\n${aria}`);
    }
    assert.ok(!/\b1 9 4\b/.test(aria), 'no digit-by-digit reading');
    // 开启者的 polite 摘要照旧
    assert.match(await page.locator('body > #app > div.visually-hidden[role=status][aria-live=polite]').textContent(), /194/);
  }));
