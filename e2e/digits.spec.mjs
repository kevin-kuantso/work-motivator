// R33：每 tick 變化的數字用固定寬度數字格，與字型本身的數字是否等寬無關。
// 刻意換成本機上「比例數字」的字型組合（system-ui, sans-serif + font-variant-numeric: normal），
// 先用純文字證明它確實是比例數字（負對照），再證明數字格讓同長度字串寬度完全一樣；主分頁與 PiP stub 文件都測。
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { build } from 'esbuild';
import { startServer, launch, openAt, expectedAutoUrls, pipStub, root } from './harness.mjs';

const T1412 = '2026-11-03T14:12:00+08:00';

// 本文件斷言的是中國地區的數字格式（千分位、¥ 金額）：明確寫入舊版（v1，無地區）設定，
// 讓應用走「舊資料一律歸中國」的遷移路徑，不依賴當前的新使用者預設地區（臺灣）。
const CN_LEGACY = { version: 1, salary: 6800, start: '08:30', end: '17:00', lunchOn: true, lunchStart: '11:30', lunchEnd: '13:00', weekends: false, payday: null, cheer: '' };
const CN_SEED = `if (!sessionStorage.getItem('cn-seeded')) { localStorage.setItem('work-motivator-v1', ${JSON.stringify(JSON.stringify(CN_LEGACY))}); sessionStorage.setItem('cn-seeded', '1'); }`;
// 與既有的 init 組在一起：字串相加、函式轉成字串、{ content } 加字首、null / undefined 只留種子、{ path } 原樣。
const seeded = (init) => {
  if (init == null) return CN_SEED;
  if (typeof init === 'string') return `${CN_SEED}\n${init}`;
  if (typeof init === 'function') return `${CN_SEED}\n(${init.toString()})();`;
  if (typeof init.content === 'string') return { ...init, content: `${CN_SEED}\n${init.content}` };
  return init;
};
const GROUPS = [
  ['1,565.5456', '1,111.1111', '8,888.8888', '1,000.0000'],
  ['888.8888', '111.1111', '123.4567', '000.0000'],
  ['0.0000', '1.1111', '8.8888'],
];
// 本機上量到是比例數字的舊字型組合（Chrome 在 macOS 上取 .SF NS，不開 tnum）
const PROPORTIONAL_CSS = '#status-card .amount, #status-card .card-countdown, #status-card .card-progress-text { font-family: system-ui, sans-serif !important; font-variant-numeric: normal !important; }';

let server;
let browser;
let helperJs;
before(async () => {
  server = await startServer();
  browser = await launch();
  // 把同一份 digits.js 打包成 window.__digits，用來把指定字串畫進真實的卡片元素
  const out = await build({ entryPoints: [join(root, 'src/ui/digits.js')], bundle: true, format: 'iife', globalName: '__digits', write: false });
  helperJs = out.outputFiles[0].text;
});
after(async () => {
  await browser?.close();
  await server?.close();
});

async function withPage(iso, fn, opts) {
  const { context, page, errors, external, consoleErrors, autoUrls } = await openAt(browser, server.url, iso, { ...opts, init: seeded(opts?.init) });
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

// 在 ctx（主分頁或 PiP 的 frame）裡：純文字 vs 數字格，量 head + tail 的繪製寬度；同時獨立量出該文件裡最寬的數字
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
  // 負對照：沒有數字格時，這個字型的同長度字串寬度不同（證明它是比例數字）
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
    // 只在 PiP 文件裡換成比例字型（主文件維持原樣），並分別統計兩個文件建立的元素
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
    // 真實 tick（計時器在 PiP 視窗）：樣式變了 → 簽名變了 → 在 PiP 文件裡重新量
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
    // 指定字串（同一份 helper）：負對照 + 數字格；--digit-w 等於 PiP 文件裡量到的最寬數字
    const m = await frame.evaluate(measureGroups, GROUPS);
    assertGroups(m, 'pip');
    assert.equal(ticks[0].digitW, m.digitW, 'the app measured the same width in the PiP document');
    assert.equal(await page.evaluate(() => window.__mainCreates), 0, 'still nothing created in the main document');
  }, { init: { content: `(${pipStub})({})` } }));

test('no layout shift: amount and 本月累计 rendered widths stay constant over 20 running ticks (proportional font)', () =>
  withPage(T1412, async (page) => {
    await page.addStyleTag({ content: PROPORTIONAL_CSS });
    await page.clock.runFor(100); // 字型換了：下一個 tick 重新量
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
        progress: pick(q('#status-card .card-progress-text')),
        countdown: pick(q('#status-card .card-countdown')),
        hidden: ['.card-amount', '.metric-month .metric-value', '.card-progress-text', '.card-countdown'].map((s) => q(`#status-card ${s}`).getAttribute('aria-hidden')),
        sr: [...document.querySelectorAll('#status-card .sr-text')].map((e) => e.textContent),
        digits: q('#status-card .card-amount').querySelectorAll('.digit').length,
      };
    });
    assert.equal(sel.amount, '¥ 194.2857');
    assert.equal(sel.month.replace(/\s+/g, ''), '本月累计¥518.10');
    assert.equal(sel.progress.trim(), '已工作 4小时12分 / 共 7小时', 'copied once (the sr copy is not selectable)');
    assert.equal(sel.countdown, '距下班 2小时48分0秒');
    assert.deepEqual(sel.hidden, ['true', 'true', 'true', 'true']);
    assert.deepEqual(sel.sr, ['¥ 194.2857', '距下班 2小时48分0秒', '已工作 4小时12分 / 共 7小时', '¥518.10']); // Task 19 M4: 倒數在進度頭一行，先於進度文字
    assert.equal(sel.digits, 7);
    const aria = await page.locator('#status-card').ariaSnapshot();
    for (const s of ['¥ 194.2857', '已工作 4小时12分 / 共 7小时', '距下班 2小时48分0秒', '¥518.10']) {
      assert.equal(aria.split(s).length - 1, 1, `accessible text "${s}" exactly once:\n${aria}`);
    }
    assert.ok(!/\b1 9 4\b/.test(aria), 'no digit-by-digit reading');
    // sr-only 副本不在任何 live region 裡（否則讀屏每 100 毫秒念一次）
    const live = await page.evaluate(() => [...document.querySelectorAll('#status-card .sr-text')].map((el) => {
      const hits = [];
      for (let n = el; n; n = n.parentElement) {
        if (n.hasAttribute('aria-live') || /^(status|alert|log|marquee|timer)$/.test(n.getAttribute('role') ?? '')) hits.push(n.className || n.tagName);
      }
      return hits;
    }));
    assert.deepEqual(live, [[], [], [], []], 'no sr-only copy has a live ancestor or a live role');
    // 開啟者的 polite 摘要（不變）：狀態不變時最多每 60 秒更新一次，而數字格每 100 毫秒在變
    const summary = page.locator('body > #app > div.visually-hidden[role=status][aria-live=polite]');
    assert.equal(await summary.textContent(), '上班中，今天已赚 194 元');
    await summary.evaluate((el) => {
      window.__ann = [];
      new MutationObserver(() => window.__ann.push([performance.now(), el.textContent])).observe(el, { childList: true, characterData: true, subtree: true });
    });
    await page.clock.runFor(130000);
    const ann = await page.evaluate(() => window.__ann);
    console.log(`MEASURE ${JSON.stringify({ case: 'polite-summary', ann })}`);
    assert.ok(ann.length >= 1 && ann.length <= 3, `1–3 updates in 130 s (1300 ticks), not per tick (${ann.length})`);
    for (let i = 1; i < ann.length; i += 1) assert.ok(ann[i][0] - ann[i - 1][0] >= 59999, 'at least 60 s apart');
    assert.match(ann.at(-1)[1], /^上班中，今天已赚 19\d 元$/);
  }));
