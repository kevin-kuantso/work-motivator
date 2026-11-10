// Task 19 fix round 1：指标格同一个 y、悬浮按钮不跳、运行时量「上班中」卡高、倒数不左右跳、已下班进度头、V4–V6。
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, launch, openAt } from './harness.mjs';

const DEFAULTS = { version: 1, salary: 6800, start: '08:30', end: '17:00', lunchOn: true, lunchStart: '11:30', lunchEnd: '13:00', weekends: false, payday: null, cheer: '' };
const STATES = {
  working: ['2026-11-03T14:12:00+08:00'],
  lunch: ['2026-11-03T12:15:00+08:00'],
  before: ['2026-11-03T07:30:00+08:00'],
  after: ['2026-11-03T18:00:00+08:00'],
  rest: ['2026-11-07T10:00:00+08:00'],
  holiday: ['2026-10-02T10:00:00+08:00'],
  paid: ['2026-11-03T10:00:00+08:00', { '2026-11-03': 'paidLeave' }],
  unpaid: ['2026-11-03T10:00:00+08:00', { '2026-11-03': 'unpaidLeave' }],
  makeup: ['2026-10-10T10:00:00+08:00'],
};
const VPS = [[1280, 585], [1093, 535], [1366, 650], [1920, 950]];
const seed = (marks, extra = {}) => `if (!sessionStorage.getItem('seeded')) { localStorage.setItem('work-motivator-v1', ${JSON.stringify(JSON.stringify({ ...DEFAULTS, ...extra, marks: marks ?? {} }))}); sessionStorage.setItem('seeded','1'); }`;

let server;
let browser;
before(async () => { server = await startServer(); browser = await launch(); });
after(async () => { await browser?.close(); await server?.close(); });

async function withState(name, fn, { viewport = { width: 1280, height: 585 }, extra } = {}) {
  const [iso, marks] = STATES[name];
  const { context, page, errors } = await openAt(browser, server.url, iso, { viewport, init: seed(marks, extra) });
  try {
    await fn(page);
    assert.deepEqual(errors.map(String), [], 'no uncaught page errors');
  } finally {
    await context.close();
  }
}
const round = (v) => Math.round(v * 10) / 10;

test('V1: float button and metrics grid sit at the same y in all 9 states at four viewports; hero labels (32px) do not truncate', async () => {
  for (const [w, h] of VPS) {
    const ys = {};
    for (const name of Object.keys(STATES)) {
      await withState(name, async (page) => {
        ys[name] = await page.evaluate(() => {
          const top = (s) => Math.round(document.querySelector(s).getBoundingClientRect().top * 10) / 10;
          const lab = document.querySelector('#status-card .card-label');
          return { button: top('#btn-float'), metrics: Math.round(document.querySelector('#status-card .card-metrics').getBoundingClientRect().bottom * 10) / 10, labelSize: getComputedStyle(lab).fontSize, labelClipped: lab.scrollWidth > lab.clientWidth + 0.5 };
        });
      }, { viewport: { width: w, height: h } });
    }
    console.log(`MEASURE ${JSON.stringify({ case: 'V1 y', vp: `${w}x${h}`, ys })}`);
    assert.equal(new Set(Object.values(ys).map((v) => v.button)).size, 1, `float button y @${w}x${h}: ${JSON.stringify(ys)}`);
    assert.equal(new Set(Object.values(ys).map((v) => v.metrics)).size, 1, `metrics grid bottom @${w}x${h} (the two-cell grids are shorter, so compare the pinned bottom edge)`);
    for (const n of ['rest', 'holiday', 'unpaid']) {
      assert.equal(ys[n].labelSize, '32px', `${n} label is the hero`);
      assert.equal(ys[n].labelClipped, false);
    }
  }
});

test('V1: the minimum card height is measured at runtime from the 上班中 layout — a taller font makes every state follow (no hard-coded px)', async () => {
  const heights = {};
  for (const name of ['working', 'rest', 'unpaid']) {
    await withState(name, async (page) => {
      const base = await page.locator('#status-card').evaluate((e) => e.getBoundingClientRect().height);
      await page.addStyleTag({ content: '.status-card .card-amount { font-size: 72px !important; }' });
      await page.evaluate(() => window.dispatchEvent(new Event('resize')));
      await page.clock.runFor(300);
      const grown = await page.locator('#status-card').evaluate((e) => ({ h: e.getBoundingClientRect().height, ref: e.style.getPropertyValue('--card-ref-h') }));
      heights[name] = { base: round(base), grown: round(grown.h), ref: grown.ref };
    });
  }
  console.log(`MEASURE ${JSON.stringify({ case: 'runtime ref height', heights })}`);
  assert.equal(new Set(Object.values(heights).map((v) => v.base)).size, 1);
  assert.equal(new Set(Object.values(heights).map((v) => v.grown)).size, 1, 'all states follow the taller 上班中 layout');
  assert.ok(heights.rest.grown > heights.rest.base + 5, `grew (${heights.rest.base} -> ${heights.rest.grown})`);
  assert.match(heights.rest.ref, /px$/);
});

test('V3: 「距下班」 and the digits keep their x position while the countdown goes 10秒→9秒, 0秒→59秒 and 10分→9分 (130 s)', async () => {
  await withState('working', async (page) => {
    const xs = [];
    for (let i = 0; i < 130; i += 1) {
      xs.push(await page.evaluate(() => {
        const c = document.querySelector('#status-card .card-countdown');
        const r = document.createRange();
        r.selectNodeContents(c);
        const first = c.firstChild.getBoundingClientRect();
        return { text: c.textContent, left: c.getBoundingClientRect().left, first: first.left, aside: document.querySelector('#status-card .card-progress-aside').getBoundingClientRect().right };
      }));
      await page.clock.runFor(1000);
    }
    const spread = (k) => Math.max(...xs.map((x) => x[k])) - Math.min(...xs.map((x) => x[k]));
    console.log(`MEASURE ${JSON.stringify({ case: 'V3 x', texts: [...new Set(xs.map((x) => x.text.length))], left: spread('left'), first: spread('first'), aside: spread('aside') })}`);
    assert.ok(new Set(xs.map((x) => x.text.length)).size >= 2, 'text length changed during the run');
    assert.ok(spread('left') < 0.01, `countdown left edge jitter ${spread('left')}`);
    assert.ok(spread('first') < 0.01, `「距」 glyph jitter ${spread('first')}`);
    assert.ok(spread('aside') < 0.01, 'right edge flush');
  });
});

test('V2: 已下班 — 「✓ 今天工作满 7小时」 in the head row (right), nothing under the bar; hidden elsewhere', async () => {
  await withState('after', async (page) => {
    const r = await page.evaluate(() => {
      const q = (s) => document.querySelector(`#status-card ${s}`);
      const b = (s) => q(s).getBoundingClientRect();
      return { done: q('.card-done').textContent.trim(), doneVisible: q('.card-done').offsetParent !== null, doneIcon: q('.card-done .icon-check') !== null,
        textVisible: q('.card-progress-text').offsetParent !== null, doneRight: b('.card-done').right, headRight: b('.card-progress-head').right,
        doneBottom: b('.card-done').bottom, barTop: b('.bar').top, color: getComputedStyle(q('.card-done')).color, sr: q('.card-progress-text + .sr-text').textContent };
    });
    assert.equal(r.done, '今天工作满 7小时');
    assert.equal(r.doneVisible, true);
    assert.equal(r.doneIcon, true);
    assert.equal(r.textVisible, false, 'no second line under the bar');
    assert.ok(Math.abs(r.doneRight - r.headRight) < 1, 'flush right');
    assert.ok(r.doneBottom <= r.barTop + 0.5);
    assert.equal(r.color, 'rgb(17, 94, 89)');
    assert.equal(r.sr, '今天工作满 7小时', 'screen readers still get it once');
  });
  await withState('working', async (page) => {
    assert.equal(await page.locator('#status-card .card-done').isVisible(), false);
    assert.equal(await page.locator('#status-card .card-progress-text').isVisible(), true);
  });
});

test('V4 / V5 / V6: lunch fill #B45309 (≥ 3:1 vs track and ≥ 4.5 vs white); 14px dark label above the amount; 国庆 once; 法定假日 badge', async () => {
  await withState('lunch', async (page) => {
    assert.equal(await page.locator('#status-card .bar-fill').evaluate((e) => getComputedStyle(e).backgroundColor), 'rgb(180, 83, 9)');
  });
  await withState('working', async (page) => {
    const l = await page.locator('#status-card .card-label').evaluate((e) => { const s = getComputedStyle(e); return { size: s.fontSize, color: s.color, weight: s.fontWeight }; });
    assert.deepEqual([l.size, l.color], ['14px', 'rgb(31, 41, 55)']);
  });
  await withState('holiday', async (page) => {
    const c = page.locator('#status-card');
    assert.equal((await c.locator('.card-badge').innerText()).trim(), '法定假日');
    assert.equal(await c.locator('.card-label').textContent(), '今天休息 · 国庆');
    assert.equal((await c.innerText()).split('国庆').length - 1, 1, '国庆 appears once on the card');
  });
});

test('今日满勤可得 is hidden on 休息日 / 法定假日 / 无薪假 and shown in the other six states; the grid stays aligned', async () => {
  for (const [name, shown] of Object.entries({ working: true, lunch: true, before: true, after: true, rest: false, holiday: false, paid: true, unpaid: false, makeup: true })) {
    await withState(name, async (page) => {
      assert.equal(await page.locator('#status-card .metric-daily').isVisible(), shown, name);
      assert.equal(await page.locator('#status-card .metric-hourly').isVisible(), shown, `${name}: 时薪 goes with 满勤 (two cells, one row)`);
      const cols = await page.evaluate(() => [...document.querySelectorAll('#status-card .card-metrics > .metric')].filter((e) => e.offsetParent !== null).map((e) => Math.round(e.getBoundingClientRect().left)));
      assert.ok(cols.every((x) => x === cols[0] || x === cols.find((y) => y !== cols[0])), `${name}: two columns only`);
      if (!shown) assert.equal(cols.length, 2, `${name}: exactly two cells, no orphan`);
    });
  }
});

test('F1: no-table years — the card says exactly what is marked (2025 fixed, 2028 lunar)', async () => {
  // 2027 已有内置表（gov.cn 2026-11 通知），缺表年的 lunar 用例改用第一个无表的 2028。
  for (const [iso, want] of [['2025-11-04T10:00:00+08:00', '2025 年只标了元旦、劳动节、国庆'], ['2028-01-04T10:00:00+08:00', '2028 年只标了法定假日，补假和调休未标出']]) {
    const { context, page } = await openAt(browser, server.url, iso, { viewport: { width: 1280, height: 585 }, init: seed({}) });
    try {
      assert.equal((await page.locator('#status-card .card-year').textContent()).trim(), want);
      assert.equal(await page.locator('.cal-summary .cal-year-tag').textContent(), want);
      assert.ok(await page.locator('#status-card .card-year').evaluate((e) => e.scrollWidth <= e.clientWidth + 0.5), 'not truncated');
    } finally {
      await context.close();
    }
  }
});
