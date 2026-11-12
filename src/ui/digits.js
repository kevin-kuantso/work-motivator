// 固定寬度數字格（R33）：每個 0–9 放進等寬的 span.digit，寬度 = 當前字型裡最寬的數字字形（量出來，不是猜的）。
// 這樣不論字型本身數字是否等寬（Segoe UI Semibold、YaHei Light 等是比例數字），每 tick 變化的數字都不會左右抖動。
// 只用 el.ownerDocument 建節點 / 量寬度（主分頁與 PiP 文件各自量各自的），從不碰全域 document。
// 文字一律走 textContent，不用 innerHTML。
export const DIGIT_FALLBACK = '0.62em';
const DIGITS = '0123456789';

export const isDigit = (c) => c >= '0' && c <= '9' && c.length === 1;

// 純函式：從舊文字變到新文字，哪些位置要改、要追加哪些字元、從哪裡開始刪除。
export function planCells(prev, next) {
  const n = Math.min(prev.length, next.length);
  const change = [];
  for (let i = 0; i < n; i += 1) if (prev[i] !== next[i]) change.push(i);
  return {
    change,
    append: next.length > prev.length ? next.slice(prev.length) : '',
    removeFrom: prev.length > next.length ? next.length : null,
  };
}

// 影響數字字形寬度的所有計算樣式。
const SIG_PROPS = ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontStretch', 'fontVariantNumeric', 'fontFeatureSettings', 'fontVariationSettings', 'letterSpacing'];
export const fontSignature = (cs) => SIG_PROPS.map((p) => cs[p] ?? '').join('|');

// 十個數字的寬度 → 最寬者；不完整或沒排版（全 0）→ null。
export function widestDigit(widths) {
  if (!Array.isArray(widths) || widths.length !== DIGITS.length) return null;
  if (!widths.every((w) => Number.isFinite(w) && w > 0)) return null;
  return Math.max(...widths);
}

export function createWidthCache() {
  const m = new Map();
  return { get: (k) => m.get(k), set: (k, v) => m.set(k, v), clear: () => m.clear(), get size() { return m.size; } };
}

// 按簽名查快取，沒有就量；只快取成功的結果（元素暫時隱藏時量不到，下次顯示再量）。
export function resolveDigitWidth(cache, sig, measure) {
  const hit = cache.get(sig);
  if (hit !== undefined) return hit;
  let w = null;
  try {
    w = widestDigit(measure());
  } catch {
    w = null;
  }
  if (w === null) return DIGIT_FALLBACK;
  const css = `${w}px`;
  cache.set(sig, css);
  return css;
}

// ---- DOM 部分 ----
// 每個文件一份快取；字型載入完成、視窗尺寸 / 縮放改變時清空（下次 render 重新量）。
const perDoc = new WeakMap();
function cacheFor(doc) {
  let c = perDoc.get(doc);
  if (c) return c;
  c = createWidthCache();
  perDoc.set(doc, c);
  const fonts = doc.fonts;
  try {
    fonts?.ready?.then?.(() => c.clear(), () => {});
    fonts?.addEventListener?.('loadingdone', () => c.clear());
  } catch {
    // 不支援 FontFaceSet：只靠簽名變化重新量
  }
  doc.defaultView?.addEventListener?.('resize', () => c.clear());
  return c;
}

// 在同一個文件、同一個元素裡放一個看不見的量尺：字型相關樣式全部繼承，量到的就是實際繪製用的字形寬度。
function measureIn(el) {
  if (typeof el.getClientRects !== 'function' || el.getClientRects().length === 0) return null; // 未顯示
  const doc = el.ownerDocument;
  const probe = doc.createElement('span');
  probe.setAttribute('aria-hidden', 'true');
  probe.style.cssText = 'position:absolute;left:0;top:0;visibility:hidden;white-space:pre;pointer-events:none';
  const cells = [];
  for (const d of DIGITS) {
    const s = doc.createElement('span');
    s.style.display = 'inline-block';
    s.textContent = d;
    probe.append(s);
    cells.push(s);
  }
  el.append(probe);
  try {
    return cells.map((s) => s.getBoundingClientRect().width);
  } finally {
    probe.remove();
  }
}

const state = new WeakMap(); // el → { text, cells, width }

function setCell(cell, ch) {
  cell.textContent = ch;
  cell.className = isDigit(ch) ? 'digit' : '';
}

function makeCell(doc, ch) {
  const s = doc.createElement('span');
  setCell(s, ch);
  return s;
}

// 把文字畫進 el（每個字元一個 span，數字帶 class digit）；只改有變化的格子。返回改動的格子數。
export function renderDigits(el, text) {
  const doc = el.ownerDocument;
  let st = state.get(el);
  // 別人（例如測試）直接改了內容：重建
  if (st && (st.cells.length !== el.childNodes.length || st.cells.some((c, i) => el.childNodes[i] !== c))) st = null;
  if (!st) {
    st = { text: '', cells: [], width: null };
    while (el.childNodes.length) el.removeChild(el.lastChild);
    state.set(el, st);
  }
  let touched = 0;
  if (st.text !== text) {
    const plan = planCells(st.text, text);
    for (const i of plan.change) setCell(st.cells[i], text[i]);
    touched += plan.change.length;
    if (plan.removeFrom !== null) {
      for (const c of st.cells.splice(plan.removeFrom)) el.removeChild(c);
    }
    for (const ch of plan.append) {
      const c = makeCell(doc, ch);
      el.append(c);
      st.cells.push(c);
      touched += 1;
    }
    st.text = text;
  }
  applyWidth(el, st);
  return touched;
}

function applyWidth(el, st) {
  if (!st.cells.some((c) => c.className === 'digit')) return;
  const view = el.ownerDocument.defaultView;
  let css = DIGIT_FALLBACK;
  try {
    const cs = view.getComputedStyle(el);
    css = resolveDigitWidth(cacheFor(el.ownerDocument), fontSignature(cs), () => measureIn(el));
  } catch {
    css = DIGIT_FALLBACK;
  }
  if (st.width !== css) {
    el.style.setProperty('--digit-w', css);
    st.width = css;
  }
}
