import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, launch, openAt } from './harness.mjs';

let server, browser;
before(async () => { server = await startServer(); browser = await launch(); });
after(async () => { await browser?.close(); await server?.close(); });

test('lunar display follows its saved setting in card, calendar and accessible description', async () => {
  const { context, page, errors } = await openAt(browser, server.url, '2026-11-03T14:12:00+08:00', { viewport: { width: 1093, height: 535 } });
  try {
    assert.equal(await page.locator('#status-card .card-lunar').textContent(), '农历九月廿五');
    const cell = page.locator('.day[data-key="2026-11-03"]');
    assert.equal(await cell.locator('.day-lunar').textContent(), '廿五');
    assert.match(await page.locator('#day-desc-2026-11-03').textContent(), /农历九月廿五/);
    await page.getByRole('tab', { name: '基本设置' }).click();
    await page.locator('#adv-toggle').click();
    await page.getByRole('switch', { name: '显示农历' }).uncheck();
    assert.equal(await page.locator('#status-card .card-lunar').isVisible(), false);
    await page.reload();
    await page.getByRole('tab', { name: '基本设置' }).click();
    await page.locator('#adv-toggle').click();
    assert.equal(await page.getByRole('switch', { name: '显示农历' }).isChecked(), false);
    await page.getByRole('tab', { name: '月历' }).click();
    assert.equal(await page.locator('.day-lunar').count(), 0);
    assert.doesNotMatch(await page.locator('#day-desc-2026-11-03').textContent(), /农历/);
    await page.getByRole('tab', { name: '月历' }).focus();
    await page.keyboard.press('Tab');
    await page.locator('.day[data-key="2026-11-03"]').focus();
    assert.doesNotMatch(await page.locator('.day-tooltip').textContent(), /null|undefined/, 'disabled lunar does not introduce placeholder text');
    assert.deepEqual(errors.map(String), []);
  } finally { await context.close(); }
});

test('lunar tooltip stays fully visible without clipping at the supported window sizes', async () => {
  for (const viewport of [{ width: 1093, height: 535 }, { width: 1280, height: 585 }, { width: 1093, height: 700 }, { width: 1280, height: 700 }]) {
    const { context, page } = await openAt(browser, server.url, '2026-11-03T14:12:00+08:00', { viewport });
    try {
      await page.locator('.day[data-key="2026-11-03"]').focus();
      const tip = page.locator('.day-tooltip');
      await tip.waitFor({ state: 'visible' });
      assert.equal(await tip.locator('.tip-lunar').textContent(), '农历九月廿五');
      if (viewport.height === 700) assert.equal(await tip.locator('.tip-lunar').isVisible(), true, 'lunar date remains visible when space permits');
      assert.equal(await tip.locator('.tip-status').isVisible(), true, 'day status remains visible');
      const size = await tip.evaluate((e) => ({ sw: e.scrollWidth, cw: e.clientWidth, sh: e.scrollHeight, ch: e.clientHeight, children: [...e.children].filter(c => getComputedStyle(c).display !== 'none').map(c => ({ sw: c.scrollWidth, cw: c.clientWidth, rect: c.getBoundingClientRect().toJSON() })), rect: e.getBoundingClientRect().toJSON() }));
      assert.ok(size.sw <= size.cw && size.sh <= size.ch, JSON.stringify({ viewport, size }));
      for (const c of size.children) assert.ok(c.sw <= c.cw && c.rect.top >= size.rect.top && c.rect.bottom <= size.rect.bottom, JSON.stringify({ viewport, size }));
    } finally { await context.close(); }
  }
});

test('lunar date remains in the tooltip when a narrow cell hides its label', async () => {
  const { context, page } = await openAt(browser, server.url, '2026-11-03T14:12:00+08:00', { viewport: { width: 590, height: 700 } });
  try {
    const cell = page.locator('.day[data-key="2026-11-03"]');
    assert.equal(await cell.locator('.day-lunar').isVisible(), false);
    await cell.focus();
    const tip = page.locator('.day-tooltip');
    assert.equal(await tip.locator('.tip-lunar').isVisible(), true);
    assert.equal(await tip.locator('.tip-lunar').textContent(), '农历九月廿五');
    assert.match(await page.locator('#day-desc-2026-11-03').textContent(), /农历九月廿五/);
    assert.equal(await tip.evaluate((e) => e.scrollWidth <= e.clientWidth && e.scrollHeight <= e.clientHeight), true);
  } finally { await context.close(); }
});
