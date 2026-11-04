// 固定宽度数字格（R33）：每个 0–9 放进等宽的 span.digit，宽度 = 当前字体里最宽的数字字形（量出来，不是猜的）。
// 这样不论字体本身数字是否等宽（Segoe UI Semibold、YaHei Light 等是比例数字），每 tick 变化的数字都不会左右抖动。
// 只用 el.ownerDocument 建节点 / 量宽度（主分页与 PiP 文件各自量各自的），从不碰全域 document。
// 文字一律走 textContent，不用 innerHTML。
export const DIGIT_FALLBACK = '0.62em';
const DIGITS = '0123456789';

export const isDigit = (c) => c >= '0' && c <= '9' && c.length === 1;

// 纯函数：从旧文字变到新文字，哪些位置要改、要追加哪些字符、从哪里开始删除。
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

// 影响数字字形宽度的所有计算样式。
const SIG_PROPS = ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontStretch', 'fontVariantNumeric', 'fontFeatureSettings', 'fontVariationSettings', 'letterSpacing'];
export const fontSignature = (cs) => SIG_PROPS.map((p) => cs[p] ?? '').join('|');

// 十个数字的宽度 → 最宽者；不完整或没排版（全 0）→ null。
export function widestDigit(widths) {
  if (!Array.isArray(widths) || widths.length !== DIGITS.length) return null;
  if (!widths.every((w) => Number.isFinite(w) && w > 0)) return null;
  return Math.max(...widths);
}

export function createWidthCache() {
  const m = new Map();
  return { get: (k) => m.get(k), set: (k, v) => m.set(k, v), clear: () => m.clear(), get size() { return m.size; } };
}

// 按签名查缓存，没有就量；只缓存成功的结果（元素暂时隐藏时量不到，下次显示再量）。
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
// 每个文件一份缓存；字体载入完成、视窗尺寸 / 缩放改变时清空（下次 render 重新量）。
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
    // 不支持 FontFaceSet：只靠签名变化重新量
  }
  doc.defaultView?.addEventListener?.('resize', () => c.clear());
  return c;
}

// 在同一个文件、同一个元素里放一个看不见的量尺：字体相关样式全部继承，量到的就是实际绘制用的字形宽度。
function measureIn(el) {
  if (typeof el.getClientRects !== 'function' || el.getClientRects().length === 0) return null; // 未显示
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

// 把文字画进 el（每个字符一个 span，数字带 class digit）；只改有变化的格子。返回改动的格子数。
export function renderDigits(el, text) {
  const doc = el.ownerDocument;
  let st = state.get(el);
  // 别人（例如测试）直接改了内容：重建
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
