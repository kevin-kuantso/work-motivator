// Task 19 · Batch A（状态卡打磨）：九种状态 × 主要视窗的卡高稳定、文字不截断、倒数 / 进度头一行、进度条、法定假日色调、
// 小窗 340px 不截断且徽章不碰齿轮、卡片铺满小窗、数字格不抖；首次提示条 + 错误条同时出现时的左栏余量。
// 量测以 `MEASURE {...}` 打印。
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { startServer, launch, openAt, pipStub } from './harness.mjs';

const SHOTS = process.env.WM_SHOTS || null;
async function shot(loc, name) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await loc.screenshot({ path: join(SHOTS, name) });
}

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
const VPS = [[1280, 585], [1093, 535], [1366, 650], [1536, 730], [1920, 950]];
const seed = (marks, extra = {}) => `if (!sessionStorage.getItem('seeded')) { localStorage.setItem('work-motivator-v1', ${JSON.stringify(JSON.stringify({ ...DEFAULTS, ...extra, marks: marks ?? {} }))}); sessionStorage.setItem('seeded','1'); }`;
const stub = `(${pipStub})(${JSON.stringify({})})`;

let server;
let browser;
before(async () => { server = await startServer(); browser = await launch(); });
after(async () => { await browser?.close(); await server?.close(); });

async function withState(name, fn, { viewport = { width: 1280, height: 585 }, extra, pip = false } = {}) {
  const [iso, marks] = STATES[name];
  const init = `${seed(marks, extra)}\n${pip ? stub : ''}`;
  const { context, page, errors } = await openAt(browser, server.url, iso, { viewport, init });
  try {
    await fn(page);
    assert.deepEqual(errors.map(String), [], 'no uncaught page errors');
  } finally {
    await context.close();
  }
}

// 卡片里所有可见的文字元素是否被截断（横向溢出）；鼓励语是用户文字，本来就允许省略
const truncated = (root) => root.evaluate((c) => [...c.querySelectorAll('.card-label, .card-badge, .card-tag, .card-date, .badge-text, .badge-name, .card-progress-title, .card-progress-aside, .card-countdown, .card-progress-text, .metric-label, .metric-value, .card-payday, .card-year, .card-amount')]
  .filter((el) => el.offsetParent !== null && el.scrollWidth > el.clientWidth + 0.5).map((el) => `${el.className}: ${el.textContent}`));

const lum = (rgb) => {
  const [r, g, b] = rgb.match(/\d+(\.\d+)?/g).slice(0, 3).map((v) => { const x = Number(v) / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

test('M11: every one of the 9 states has the same card height (= 上班中) at five viewports; no page scroll; no truncated text', async () => {
  for (const [w, h] of VPS) {
    const heights = {};
    for (const name of Object.keys(STATES)) {
      await withState(name, async (page) => {
        const card = page.locator('#status-card');
        heights[name] = await card.evaluate((c) => Math.round(c.getBoundingClientRect().height * 10) / 10);
        assert.deepEqual(await truncated(card), [], `${name} @${w}x${h}`);
        assert.equal(await page.evaluate(() => document.documentElement.scrollHeight > innerHeight), false, `${name} @${w}x${h}: no page scroll`);
        await shot(card, `card-${name}-${w}x${h}.png`);
      }, { viewport: { width: w, height: h } });
    }
    console.log(`MEASURE ${JSON.stringify({ case: 'card heights', vp: `${w}x${h}`, heights })}`);
    const set = new Set(Object.values(heights));
    assert.equal(set.size, 1, `all states share one card height @${w}x${h}: ${JSON.stringify(heights)}`);
  }
});

test('M4 / M3 / M5: progress head row — 「工时进度」 left, countdown right (14px, dark); worked text below the bar; bar 8px, no border; lunch fill #D97706', async () => {
  await withState('working', async (page) => {
    const r = await page.evaluate(() => {
      const q = (s) => document.querySelector(`#status-card ${s}`);
      const b = (s) => q(s).getBoundingClientRect();
      const bar = q('.bar'); const bcs = getComputedStyle(bar);
      return {
        title: q('.card-progress-title').textContent, aside: q('.card-countdown').textContent,
        titleLeft: b('.card-progress-title').left, asideRight: b('.card-progress-aside').right, headLeft: b('.card-progress-head').left, headRight: b('.card-progress-head').right,
        headBottom: b('.card-progress-head').bottom, barTop: b('.bar').top, barBottom: b('.bar').bottom, textTop: b('.card-progress-text').top,
        cdSize: getComputedStyle(q('.card-countdown')).fontSize, cdColor: getComputedStyle(q('.card-countdown')).color,
        barH: b('.bar').height, border: bcs.borderTopWidth, text: q('.card-progress-text').textContent,
        standaloneVisible: !q('.card-countdown-slot').hidden && q('.card-countdown-slot').offsetParent !== null,
      };
    });
    assert.equal(r.title, '工时进度');
    assert.equal(r.aside, '距下班 2小时48分0秒');
    assert.ok(Math.abs(r.titleLeft - r.headLeft) < 1 && Math.abs(r.headRight - r.asideRight) < 1, 'title flush left, countdown flush right');
    assert.ok(r.headBottom <= r.barTop + 0.5 && r.barBottom <= r.textTop + 0.5, 'order: head, bar, worked text');
    assert.equal(r.cdSize, '14px');
    assert.equal(r.cdColor, 'rgb(31, 41, 55)');
    assert.equal(r.barH, 8);
    assert.equal(r.border, '0px');
    assert.equal(r.text, '已工作 4小时12分 / 共 7小时');
    assert.equal(r.standaloneVisible, false, 'no second countdown line while the bar is shown');
  });
  await withState('lunch', async (page) => {
    assert.equal(await page.locator('#status-card .bar-fill').evaluate((e) => getComputedStyle(e).backgroundColor), 'rgb(217, 119, 6)');
    assert.equal(await page.locator('#status-card .card-countdown').textContent(), '45 分钟后继续上班');
  });
  // 没有进度条的状态：倒数 / 说明是单独一行，进度头不出现
  await withState('rest', async (page) => {
    assert.equal(await page.locator('#status-card .card-progress').isVisible(), false);
    assert.equal(await page.locator('#status-card .card-countdown-slot').isVisible(), true);
    assert.equal(await page.locator('#status-card .card-countdown').textContent(), '距下个工作日 2 天');
  });
});

test('M5: bar fill keeps ≥ 3:1 against the white card, and ≥ 2.5:1 against the track, for every tone that shows a bar', async () => {
  const out = {};
  for (const name of ['working', 'lunch', 'before', 'after']) {
    await withState(name, async (page) => {
      const c = await page.evaluate(() => {
        const fill = getComputedStyle(document.querySelector('#status-card .bar-fill')).backgroundColor;
        const track = getComputedStyle(document.querySelector('#status-card .bar')).backgroundColor;
        return { fill, track };
      });
      out[name] = { vsWhite: ratio(c.fill, 'rgb(255, 255, 255)'), vsTrack: ratio(c.fill, c.track) };
      assert.ok(out[name].vsWhite >= 3, `${name} fill vs white card ${out[name].vsWhite}`);
      assert.ok(out[name].vsTrack >= 2.5, `${name} fill vs track ${out[name].vsTrack}`);
    });
  }
  console.log(`MEASURE ${JSON.stringify({ case: 'bar contrast', out })}`);
});

test('H3 / H8 / M1 / H2: per-state card content and look (tone colours, strong 20px label, amount, first metric cell)', async () => {
  await withState('holiday', async (page) => {
    const c = page.locator('#status-card');
    assert.equal(await c.getAttribute('data-tone'), 'holiday');
    assert.equal((await c.locator('.card-badge').textContent()).trim(), '法定假日 · 国庆');
    assert.equal(await c.locator('.card-badge .icon-holiday').count(), 1, 'flag icon, not the moon');
    const k = await c.locator('.card-badge').evaluate((e) => { const s = getComputedStyle(e); return { fg: s.color, bg: s.backgroundColor }; });
    assert.notEqual(k.bg, 'rgb(243, 244, 246)', 'not the plain-weekend grey');
    assert.ok(ratio(k.fg, k.bg) >= 4.5, `holiday badge contrast ${ratio(k.fg, k.bg)}`);
    assert.equal(await c.locator('.card-label').evaluate((e) => getComputedStyle(e).fontSize), '20px');
    assert.equal(await c.locator('.metric-rate .metric-label').textContent(), '已赚占月薪');
  });
  await withState('rest', async (page) => {
    const c = page.locator('#status-card');
    assert.equal(await c.getAttribute('data-tone'), 'rest');
    assert.equal((await c.locator('.card-badge').textContent()).trim(), '休息日');
  });
  await withState('after', async (page) => {
    const c = page.locator('#status-card');
    const l = await c.locator('.card-label').evaluate((e) => { const s = getComputedStyle(e); return { size: s.fontSize, weight: s.fontWeight, color: s.color }; });
    assert.equal(l.size, '20px');
    assert.equal(l.color, 'rgb(17, 94, 89)', 'tone colour');
    assert.ok(Number(l.weight) >= 600);
    assert.equal(await c.locator('.card-amount').textContent(), '¥ 323.81');
    assert.equal(await c.locator('.amount-tail').textContent(), '');
    assert.equal(await c.locator('.card-progress-text').textContent(), '今天工作满 7 小时');
    assert.equal(await c.locator('.metric-rate .metric-label').textContent(), '已赚占月薪');
  });
  await withState('before', async (page) => {
    const c = page.locator('#status-card');
    assert.equal(await c.locator('.card-amount').textContent(), '¥ 0.00');
    assert.equal(await c.locator('.card-label').textContent(), '08:30 开始计薪');
    assert.equal(await c.locator('.metric-rate .metric-label').textContent(), '上班时间');
    assert.equal(await c.locator('.metric-rate .metric-value').textContent(), '08:30');
  });
  await withState('unpaid', async (page) => {
    const c = page.locator('#status-card');
    assert.equal(await c.locator('.card-amount').isVisible(), false);
    assert.equal(await c.locator('.card-label').textContent(), '今天不计薪');
    assert.equal(await c.locator('.card-label').evaluate((e) => getComputedStyle(e).fontSize), '20px');
  });
  // 值取自设置，不写死
  await withState('before', async (page) => {
    assert.equal(await page.locator('#status-card .card-label').textContent(), '09:15 开始计薪');
    assert.equal(await page.locator('#status-card .metric-rate .metric-value').textContent(), '09:15');
  }, { extra: { start: '09:15' } });
  await withState('lunch', async (page) => {
    assert.equal(await page.locator('#status-card .metric-rate .metric-value').textContent(), '13:30');
  }, { extra: { lunchEnd: '13:30' } });
});

test('R33: countdown (head row), worked text and amount keep one width for the same text length while ticking, across a minute boundary', async () => {
  await withState('working', async (page) => {
    const seen = new Map(); // 文字长度 → 宽度（同一长度必须同一宽度；位数变了（如 10秒 → 9秒）是文字本身变短，不算抖动）
    for (let i = 0; i < 130; i += 1) {
      const r = await page.evaluate(() => ['.card-countdown', '.card-progress-text', '.card-amount'].map((s) => {
        const e = document.querySelector(`#status-card ${s}`);
        return [e.textContent.length, e.getBoundingClientRect().width];
      }));
      r.forEach(([len, w], k) => {
        const key = `${k}:${len}`;
        if (seen.has(key)) assert.ok(Math.abs(seen.get(key) - w) < 0.01, `${key} width ${w} vs ${seen.get(key)}`);
        else seen.set(key, w);
      });
      await page.clock.runFor(1000);
    }
    assert.ok([...seen.keys()].filter((k) => k.startsWith('0:')).length >= 2, 'countdown showed more than one text length (0秒 → 59秒 → 9秒)');
  });
});

test('M4: first-run + error banners at 1280×585 leave ≥ 12px page slack and the left column ends above the bottom edge', async () => {
  const init = `Storage.prototype.setItem = function () { throw new DOMException('quota', 'QuotaExceededError'); };`;
  const { context, page, errors } = await openAt(browser, server.url, '2026-11-03T14:12:00+08:00', { viewport: { width: 1280, height: 585 }, init });
  try {
    await page.getByRole('tab', { name: '基本设置' }).click();
    await page.getByLabel('月薪').fill('7000'); // 触发储存失败 → 错误条
    await page.getByRole('tab', { name: '月历' }).click();
    const m = await page.evaluate(() => ({
      banners: document.querySelectorAll('.notices .banner').length,
      error: document.querySelectorAll('.notices .banner-error').length,
      info: document.querySelectorAll('.notices .banner-info').length,
      slack: innerHeight - document.querySelector('.main-panel').getBoundingClientRect().bottom,
      leftSlack: innerHeight - document.querySelector('.card-col').getBoundingClientRect().bottom,
      scroll: document.documentElement.scrollHeight - innerHeight,
    }));
    console.log(`MEASURE ${JSON.stringify({ case: 'M4 both banners', ...m })}`);
    assert.equal(m.error, 1);
    assert.equal(m.info, 1);
    assert.ok(m.slack >= 12, `page slack ${m.slack}`);
    assert.ok(m.leftSlack >= 12, `left column slack ${m.leftSlack}`);
    assert.ok(m.scroll <= 0, 'no page scroll');
  } finally {
    assert.deepEqual(errors.map(String), []);
    await context.close();
  }
});

// ---- 小窗（340px，stub 的 iframe 视口 = 请求的 340 × 高度）----
const pipCard = (page) => page.frameLocator('iframe.pip-stub').locator('#status-card');

test('float 340px: every state — no truncated text, badges end before the gear (≥ 4px), holiday badge only 「法定假日」, card fills the window', async () => {
  for (const name of Object.keys(STATES)) {
    await withState(name, async (page) => {
      await page.locator('#btn-float').click();
      await pipCard(page).waitFor();
      const c = pipCard(page);
      assert.equal(await c.getAttribute('data-size'), 'sm');
      assert.deepEqual(await truncated(c), [], `${name}: nothing truncated at 340`);
      const g = await c.evaluate((el) => {
        const r = (s) => el.querySelector(s).getBoundingClientRect();
        const badges = r('.card-badges');
        const gear = r('.card-gear');
        const date = r('.card-date');
        const win = el.ownerDocument.defaultView;
        const rect = el.getBoundingClientRect();
        return { badgesRight: badges.right, gearLeft: gear.left, dateRight: date.right, badgesLeft: badges.left, badgeText: el.querySelector('.card-badge').innerText.trim(), tag: el.querySelector('.card-tag').hidden ? '' : el.querySelector('.card-tag').textContent,
          cardH: rect.height, winH: win.innerHeight, cardW: rect.width, winW: win.innerWidth, scroll: el.ownerDocument.documentElement.scrollHeight - win.innerHeight, badgeRows: el.querySelector('.card-badges').getBoundingClientRect().height };
      });
      console.log(`MEASURE ${JSON.stringify({ case: 'float340', name, ...g })}`);
      assert.ok(g.gearLeft - g.badgesRight >= 4, `${name}: badges end ${g.badgesRight}, gear starts ${g.gearLeft}`);
      assert.ok(g.badgesLeft - g.dateRight >= 4, `${name}: date and badges apart`);
      assert.ok(g.badgeRows <= 26, `${name}: badges on one row (${g.badgeRows})`);
      if (name === 'holiday') assert.equal(g.badgeText, '法定假日');
      if (name === 'makeup') assert.equal(g.tag, '调休上班');
      assert.ok(Math.abs(g.cardH - g.winH) <= 1 || g.cardH > g.winH, `${name}: card ${g.cardH} fills window ${g.winH}`);
      assert.equal(g.cardW, g.winW);
      await shot(c, `float340-${name}.png`);
    }, { pip: true });
  }
});

test('L3 / L5: while floating the placeholder is a solid-border card with a 24px icon', async () => {
  await withState('working', async (page) => {
    await page.locator('#btn-float').click();
    await pipCard(page).waitFor();
    const r = await page.locator('.pip-placeholder').evaluate((e) => {
      const s = getComputedStyle(e); const i = e.querySelector('.icon').getBoundingClientRect();
      return { style: s.borderTopStyle, w: s.borderTopWidth, color: s.borderTopColor, bg: s.backgroundColor, iw: i.width, ih: i.height };
    });
    assert.equal(r.style, 'solid');
    assert.equal(r.w, '1px');
    assert.equal(r.color, 'rgb(229, 231, 235)');
    assert.equal(r.bg, 'rgb(248, 250, 251)');
    assert.deepEqual([r.iw, r.ih], [24, 24]);
  }, { pip: true });
});
