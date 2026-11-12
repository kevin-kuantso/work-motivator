import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DIGIT_FALLBACK, isDigit, planCells, fontSignature, widestDigit, createWidthCache, resolveDigitWidth, renderDigits,
} from '../src/ui/digits.js';

// ---- 極簡假 DOM：只實現 renderDigits 用到的部分（不引入 jsdom）----
class FakeNode {
  constructor(doc) { this.ownerDocument = doc; this.parentNode = null; this.childNodes = []; }
  append(...nodes) { for (const n of nodes) { n.parentNode?.removeChild(n); n.parentNode = this; this.childNodes.push(n); } }
  removeChild(n) { this.childNodes.splice(this.childNodes.indexOf(n), 1); n.parentNode = null; return n; }
  remove() { this.parentNode?.removeChild(this); }
  get lastChild() { return this.childNodes[this.childNodes.length - 1] ?? null; }
  get textContent() { return this.childNodes.map((c) => c.textContent).join(''); }
}
class FakeText extends FakeNode {
  constructor(doc, s) { super(doc); this.data = s; }
  get textContent() { return this.data; }
}
class FakeEl extends FakeNode {
  constructor(doc, tag) {
    super(doc);
    this.tagName = tag.toUpperCase();
    this.className = '';
    this.attrs = {};
    this.writes = 0;
    const props = {};
    this.style = { setProperty: (k, v) => { props[k] = v; }, getPropertyValue: (k) => props[k] ?? '', cssText: '' };
  }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getClientRects() { return []; } // 假 DOM 沒有排版：量不到寬度 → 回退 0.62em
  getBoundingClientRect() { return { width: 0 }; }
  get textContent() { return super.textContent; }
  set textContent(s) { this.writes += 1; this.childNodes = [new FakeText(this.ownerDocument, s)]; }
}
function fakeDoc() {
  const doc = {
    created: 0,
    createElement(tag) { doc.created += 1; return new FakeEl(doc, tag); },
    createTextNode(s) { return new FakeText(doc, s); },
    defaultView: {
      getComputedStyle: () => ({ fontFamily: 'X', fontSize: '20px', fontWeight: '600', fontStyle: 'normal', fontStretch: '100%', fontVariantNumeric: 'tabular-nums', fontFeatureSettings: 'normal', fontVariationSettings: 'normal', letterSpacing: 'normal' }),
      addEventListener() {},
    },
  };
  return doc;
}

test('isDigit: only ASCII 0–9', () => {
  assert.deepEqual([...'0129'].map(isDigit), [true, true, true, true]);
  assert.deepEqual([...'¥,. :a小'].map(isDigit), [false, false, false, false, false, false, false]);
});

test('planCells: only changed positions, appends and trailing removals', () => {
  assert.deepEqual(planCells('194.2857', '194.2858'), { change: [7], append: '', removeFrom: null });
  assert.deepEqual(planCells('', '0.00'), { change: [], append: '0.00', removeFrom: null });
  assert.deepEqual(planCells('99.99', '100.00'), { change: [0, 1, 2, 3, 4], append: '0', removeFrom: null });
  assert.deepEqual(planCells('100.00', '9.99'), { change: [0, 1, 2, 3], append: '', removeFrom: 4 });
  assert.deepEqual(planCells('abc', 'abc'), { change: [], append: '', removeFrom: null });
});

test('fontSignature covers every property that changes digit advances', () => {
  const base = { fontFamily: 'A', fontSize: '20px', fontWeight: '600', fontStyle: 'normal', fontStretch: '100%', fontVariantNumeric: 'normal', fontFeatureSettings: 'normal', fontVariationSettings: 'normal', letterSpacing: 'normal' };
  const s = fontSignature(base);
  for (const k of Object.keys(base)) assert.notEqual(fontSignature({ ...base, [k]: 'other' }), s, `${k} is part of the signature`);
  assert.equal(fontSignature({ ...base }), s, 'same values → same signature');
});

test('widestDigit: max of ten positive finite advances, else null', () => {
  assert.equal(widestDigit([10, 7.5, 10, 10, 10, 10, 10, 10, 10, 10.25]), 10.25);
  assert.equal(widestDigit([10, 10, 10]), null, 'needs all ten');
  assert.equal(widestDigit([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), null, 'not rendered');
  assert.equal(widestDigit([NaN, 1, 1, 1, 1, 1, 1, 1, 1, 1]), null);
  assert.equal(widestDigit(null), null);
});

test('resolveDigitWidth: measures once per signature, caches only successes, clear() forces a re-measure', () => {
  const cache = createWidthCache();
  let calls = 0;
  const good = () => { calls += 1; return [9, 7, 9, 9, 9, 9, 9, 9, 9, 9.5]; };
  assert.equal(resolveDigitWidth(cache, 'sig-a', good), '9.5px');
  assert.equal(resolveDigitWidth(cache, 'sig-a', good), '9.5px');
  assert.equal(calls, 1, 'cached by signature');
  assert.equal(resolveDigitWidth(cache, 'sig-b', good), '9.5px');
  assert.equal(calls, 2, 'new signature → new measurement');
  cache.clear();
  resolveDigitWidth(cache, 'sig-a', good);
  assert.equal(calls, 3, 'cleared (fonts loaded / resize) → re-measured');
  let bad = 0;
  const fail = () => { bad += 1; return null; };
  assert.equal(resolveDigitWidth(cache, 'sig-c', fail), DIGIT_FALLBACK);
  assert.equal(resolveDigitWidth(cache, 'sig-c', fail), DIGIT_FALLBACK);
  assert.equal(bad, 2, 'failures are not cached (retried when the element becomes visible)');
  const thrower = () => { throw new Error('boom'); };
  assert.equal(resolveDigitWidth(cache, 'sig-d', thrower), DIGIT_FALLBACK);
  assert.equal(DIGIT_FALLBACK, '0.62em');
});

test('renderDigits: one span per character, digits get class digit; text round trip', () => {
  const doc = fakeDoc();
  const el = doc.createElement('div');
  renderDigits(el, '¥1,565.5456');
  assert.equal(el.textContent, '¥1,565.5456', 'container text equals input');
  assert.equal(el.childNodes.length, 11);
  assert.deepEqual(el.childNodes.map((c) => c.className), ['', 'digit', '', 'digit', 'digit', 'digit', '', 'digit', 'digit', 'digit', 'digit']);
  assert.equal(el.style.getPropertyValue('--digit-w'), DIGIT_FALLBACK, 'no layout in the fake DOM → fallback width');
  renderDigits(el, '距下班 2小时48分0秒');
  assert.equal(el.textContent, '距下班 2小时48分0秒');
  renderDigits(el, '');
  assert.equal(el.textContent, '');
  assert.equal(el.childNodes.length, 0);
});

test('renderDigits: 194.2857 → 194.2858 touches exactly one span; the others are the same nodes, untouched', () => {
  const doc = fakeDoc();
  const el = doc.createElement('span');
  renderDigits(el, '194.2857');
  const before = [...el.childNodes];
  const writes = before.map((s) => s.writes);
  const created = doc.created;
  assert.equal(renderDigits(el, '194.2858'), 1, 'one cell touched');
  assert.deepEqual(el.childNodes, before, 'same span objects (no re-render)');
  assert.deepEqual(el.childNodes.map((s, i) => s.writes - writes[i]), [0, 0, 0, 0, 0, 0, 0, 1]);
  assert.equal(doc.created, created, 'no new element');
  assert.equal(el.textContent, '194.2858');
  assert.equal(renderDigits(el, '194.2858'), 0, 'unchanged text → nothing touched');
});

test('renderDigits: a digit cell that becomes a separator loses the digit class (and back)', () => {
  const doc = fakeDoc();
  const el = doc.createElement('span');
  renderDigits(el, '9.99');
  renderDigits(el, '10.00');
  assert.equal(el.textContent, '10.00');
  assert.deepEqual(el.childNodes.map((c) => c.className), ['digit', 'digit', '', 'digit', 'digit']);
});

test('renderDigits: rebuilds when someone else replaced the container content', () => {
  const doc = fakeDoc();
  const el = doc.createElement('span');
  renderDigits(el, '12.34');
  el.textContent = 'xx';
  renderDigits(el, '12.35');
  assert.equal(el.textContent, '12.35');
  assert.equal(el.childNodes.length, 5);
});

test('renderDigits creates nodes only with the container\'s own document', () => {
  const main = fakeDoc();
  const pip = fakeDoc();
  const el = pip.createElement('span');
  const before = main.created;
  renderDigits(el, '518.10');
  assert.equal(main.created, before, 'never the other document');
  assert.ok(pip.created > 1);
});
