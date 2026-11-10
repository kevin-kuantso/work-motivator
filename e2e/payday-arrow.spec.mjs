import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, launch, openAt } from './harness.mjs';

let server, browser;
before(async () => { server = await startServer(); browser = await launch(); });
after(async () => { await browser?.close(); await server?.close(); });

test('payday selector arrow has breathing room and remains usable', async () => {
  for (const [width, height] of [[1280, 585], [1093, 535]]) {
    const { context, page, errors } = await openAt(browser, server.url, '2026-11-03T10:00:00+08:00', { viewport: { width, height } });
    try {
      await page.getByRole('tab', { name: '基本设置' }).click();
      const select = page.getByLabel('发薪日');
      const image = await select.screenshot();
      const ink = await page.evaluate(async (data) => {
        const img = new Image(); img.src = `data:image/png;base64,${data}`; await img.decode();
        const canvas = document.createElement('canvas'); canvas.width = img.width; canvas.height = img.height;
        const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0);
        const { data: pixels } = ctx.getImageData(0, 0, img.width, img.height);
        let right = -1;
        for (let y = 6; y < img.height - 6; y++) for (let x = img.width - 34; x < img.width - 2; x++) {
          const i = (y * img.width + x) * 4;
          if (Math.max(pixels[i], pixels[i + 1], pixels[i + 2]) < 160) right = Math.max(right, x);
        }
        return { right, gap: img.width - 1 - right };
      }, image.toString('base64'));
      assert.ok(ink.right >= 0 && ink.gap >= 11, `arrow should have at least 11px from its ink to the right edge: ${JSON.stringify(ink)}`);
      await select.selectOption('5');
      assert.equal(await page.locator('#status-card .card-payday').textContent(), '距发薪日 2 天');
      assert.deepEqual(errors.map(String), []);
    } finally { await context.close(); }
  }
});
