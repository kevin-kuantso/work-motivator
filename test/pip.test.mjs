import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPipSupported, measureSmallCard, pipFitsContent, pipHeight, pipMinWidth, pipWidth, PIP_MAX_HEIGHT, PIP_MIN_HEIGHT, PIP_MIN_WIDTHS, PIP_WIDTH, PIP_WIDTHS } from '../src/pip.js';

test('isPipSupported: feature detection on documentPictureInPicture.requestWindow', () => {
  assert.equal(isPipSupported({ documentPictureInPicture: { requestWindow() {} } }), true);
  assert.equal(isPipSupported({}), false);
  assert.equal(isPipSupported({ documentPictureInPicture: null }), false);
  assert.equal(isPipSupported({ documentPictureInPicture: {} }), false);
  assert.equal(isPipSupported(null), false);
});

test('pipHeight: at least 200, grows with content, capped at 640', () => {
  assert.equal(PIP_WIDTH, 352);
  assert.deepEqual(PIP_WIDTHS, { xs: 328, s: 344, m: 352, l: 368, xl: 384 });
  assert.deepEqual(PIP_MIN_WIDTHS, { xs: 312, s: 328, m: 328, l: 344, xl: 344 });
  assert.equal(pipWidth('xl'), 384);
  assert.equal(pipWidth('unknown'), 352);
  assert.equal(pipMinWidth('xs'), 312);
  assert.equal(pipMinWidth('unknown'), 328);
  assert.equal(PIP_MIN_HEIGHT, 200);
  assert.equal(pipHeight(197.8), 200);
  assert.equal(pipHeight(280), 280);
  assert.equal(pipHeight(340.2), 341, 'rounds up so content is never clipped');
  assert.equal(pipHeight(520.2), 521);
  assert.equal(pipHeight(900), PIP_MAX_HEIGHT);
  assert.equal(pipHeight(NaN), 200);
  assert.equal(pipHeight(0), 200);
});

// 假卡片：只需要 measureSmallCard 真正碰到的東西（dataset / style / getBoundingClientRect）。
function fakeCard({ size, style = {}, height = 400, scrollHeight = 0 } = {}) {
  const card = {
    dataset: size === undefined ? {} : { size, other: 'x' },
    style: { width: '', height: '', minHeight: '', alignSelf: '', ...style },
    scrollHeight,
    rects: 0,
    // 量測期間看到的樣式：用來斷言「量之前已經改好」，不用猜順序
    seen: [],
    getBoundingClientRect() {
      card.rects += 1;
      card.seen.push({ size: card.dataset.size, width: card.style.width, height: card.style.height, minHeight: card.style.minHeight, alignSelf: card.style.alignSelf });
      return { height: typeof height === 'function' ? height(card) : height };
    },
  };
  return card;
}

test('measureSmallCard: measures at the target width in the small-card form, then restores everything', () => {
  const card = fakeCard({ size: 'md', style: { width: '55px', minHeight: '320px', alignSelf: 'stretch' }, height: 412.6 });
  assert.equal(measureSmallCard(card, 372), 412.6);
  assert.equal(card.rects, 1);
  // 量的時候：sm 形態 + 目標寬度 + 不被 pip-body 的 grid 拉滿（align-self:start）+ 不受大卡片 min-height 影響
  assert.deepEqual(card.seen[0], { size: 'sm', width: '372px', height: 'auto', minHeight: '0', alignSelf: 'start' });
  // 量完原樣還原
  assert.deepEqual(card.dataset, { size: 'md', other: 'x' });
  assert.deepEqual(card.style, { width: '55px', height: '', minHeight: '320px', alignSelf: 'stretch' });
});

test('measureSmallCard: restores an absent data-size by deleting it (no literal "undefined")', () => {
  const card = fakeCard({ height: 300 });
  assert.equal(measureSmallCard(card, 340), 300);
  assert.equal('size' in card.dataset, false);
  assert.equal(card.seen[0].width, '340px');
  assert.deepEqual(card.style, { width: '', height: '', minHeight: '', alignSelf: '' });
});

test('measureSmallCard: restores in finally, so a throwing measurement leaves no temporary style behind', () => {
  const card = fakeCard({ style: { minHeight: '300px', alignSelf: 'stretch' }, height: () => { throw new Error('layout unavailable'); } });
  assert.throws(() => measureSmallCard(card, 356), /layout unavailable/);
  assert.equal('size' in card.dataset, false);
  assert.deepEqual(card.style, { width: '', height: '', minHeight: '300px', alignSelf: 'stretch' });
});

test('measureSmallCard: respects scrollHeight after temporarily releasing a forced height', () => {
  const card = fakeCard({ style: { height: '200px' }, height: 200, scrollHeight: 284 });
  assert.equal(measureSmallCard(card, 352), 284);
  assert.equal(card.seen[0].height, 'auto');
  assert.equal(card.style.height, '200px');
});

test('measureSmallCard: default width is the m 档 width', () => {
  const card = fakeCard();
  measureSmallCard(card);
  assert.equal(card.seen[0].width, `${PIP_WIDTH}px`);
});

// 假的 PiP 視窗：只讀 scrollingElement 的 scrollHeight / clientHeight
function fakeWin(scrollHeight, clientHeight, scrollWidth = 300, clientWidth = 300) {
  return { document: { scrollingElement: { scrollHeight, clientHeight, scrollWidth, clientWidth } } };
}

test('pipFitsContent: true only when nothing needs scrolling; unknown readings say nothing', () => {
  assert.equal(pipFitsContent(fakeWin(500, 520)), true, 'content shorter than the viewport');
  assert.equal(pipFitsContent(fakeWin(520, 520)), true, 'exactly fits');
  assert.equal(pipFitsContent(fakeWin(520.8, 520)), true, '1px tolerance eats sub-pixel rounding');
  assert.equal(pipFitsContent(fakeWin(560, 520)), false, 'needs scrolling');
  assert.equal(pipFitsContent(fakeWin(500, 520, 330, 300)), false, 'horizontal overflow also means content is clipped');
  // 讀不到 → null（不報錯、也不亂說「放不下」）
  assert.equal(pipFitsContent(null), null);
  assert.equal(pipFitsContent({}), null);
  assert.equal(pipFitsContent({ document: {} }), null);
  assert.equal(pipFitsContent(fakeWin(NaN, 520)), null);
  assert.equal(pipFitsContent(fakeWin(500, NaN)), null);
  assert.equal(pipFitsContent(fakeWin(500, 0)), null, 'viewport not laid out yet (clientHeight 0)');
  assert.equal(pipFitsContent(fakeWin(500, 520, NaN, 300)), null, 'unknown horizontal measurement says nothing');
});
