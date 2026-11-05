// 左栏状态卡下方的「悬浮成小窗」按钮（R38）、按钮下的说明（不支持的原因 / 悬浮时「请保持本页开启」）、
// 主分页占位卡，以及开 / 关小窗的状态同步。
import { isPipSupported, openFloat } from '../pip.js';
import { h, setText, show } from './dom.js';
import { icon } from './icons.js';

export function createFloatControl(doc, t, { cardRoot, onOpen, onClose, onFail }) {
  const win = doc.defaultView;
  const f = t.float;
  const supported = isPipSupported(win);
  let pipWin = null;
  let opening = false;

  // 不支持：按钮停用 + 原因（黄字，常驻）；支持时悬浮中才显示「请保持本页开启」
  const note = h(doc, 'p', { class: 'float-note is-warn', id: 'float-note', hidden: supported, text: f.unsupported });
  const keepOpen = h(doc, 'p', { class: 'float-note', id: 'float-keep', hidden: true, text: f.keepOpen });
  const label = h(doc, 'span', { class: 'float-label', text: t.header.float });
  // 不支持：aria-disabled（不用原生 disabled），按钮仍可聚焦、读屏读得到原因（R52）；按下什么都不做
  const button = h(doc, 'button', {
    type: 'button', class: 'btn btn-primary float-btn', id: 'btn-float',
    'aria-disabled': supported ? undefined : 'true', 'aria-describedby': supported ? undefined : 'float-note',
    onclick: () => { if (supported) toggle(); },
  }, icon(doc, 'pip'), label);
  // 整张占位卡是一个按钮；不显示金额，避免两处同时跳动与重复朗读（design §4.4）
  // 可访问名称 = 「已悬浮 · 点此收回」；说明作为描述
  const placeholder = h(doc, 'button', {
    type: 'button', class: 'pip-placeholder', hidden: true, onclick: close,
    'aria-labelledby': 'pip-placeholder-title', 'aria-describedby': 'pip-placeholder-note',
  },
  icon(doc, 'pip'),
  h(doc, 'span', { class: 'pip-placeholder-title', id: 'pip-placeholder-title', text: f.placeholder }),
  h(doc, 'span', { class: 'pip-placeholder-note', id: 'pip-placeholder-note', text: f.placeholderNote }));
  const el = h(doc, 'div', { class: 'float-control' }, button, note, keepOpen);

  function toggle() {
    if (pipWin) close();
    else open();
  }

  function setFloating(on) {
    setText(label, on ? f.recall : t.header.float);
    show(keepOpen, on);
    if (on) button.setAttribute('aria-describedby', 'float-keep');
    else button.removeAttribute('aria-describedby');
  }

  // 卡片在主分页时该有的高度（R52）：悬浮中卡片在小窗里，用一份不可见的复本在占位位置量（同步，不会绘制）
  function liveCardHeight() {
    if (cardRoot.ownerDocument === doc && cardRoot.isConnected) return cardRoot.offsetHeight;
    const slot = placeholder.parentNode;
    if (!slot) return 0;
    const clone = cardRoot.cloneNode(true);
    for (const el of [clone, ...clone.querySelectorAll('[id]')]) el.removeAttribute('id');
    clone.dataset.size = 'lg';
    clone.setAttribute('aria-hidden', 'true');
    clone.style.cssText = 'position:absolute;visibility:hidden;left:0;top:0;width:100%';
    slot.append(clone);
    const height = clone.offsetHeight;
    clone.remove();
    return height;
  }
  function syncPlaceholder() {
    if (!pipWin) return;
    placeholder.style.minHeight = `${liveCardHeight()}px`;
  }
  win.addEventListener('resize', syncPlaceholder);
  // 悬浮中卡片内容变高 / 变矮（鼓励语、发薪日、状态切换……）：小窗里的卡片尺寸一变就重新量（round 2）
  let cardObserver = null;
  function watchCard(pip) {
    const RO = pip?.ResizeObserver ?? win.ResizeObserver;
    if (typeof RO !== 'function') return;
    cardObserver = new RO(() => syncPlaceholder());
    cardObserver.observe(cardRoot);
    // 小窗里卡片铺满窗口（min-height: 100vh），内容变高只要还放得下，卡片本身的高度就不变；所以也观察每个内容块（鼓励语、发薪日出现 / 消失时它们的高度会变）
    for (const child of cardRoot.children) cardObserver.observe(child);
  }

  async function open() {
    if (opening) return;
    opening = true;
    const height = cardRoot.offsetHeight;
    let w;
    try {
      w = await openFloat(win, cardRoot, restored);
    } catch {
      opening = false;
      onFail();
      return;
    }
    opening = false;
    pipWin = w;
    placeholder.style.minHeight = `${height}px`;
    show(placeholder, true);
    setFloating(true);
    watchCard(w);
    onOpen(w);
  }

  // pagehide 时调用（按 X、占位卡、按钮、齿轮都走这里）
  function restored() {
    const refocus = doc.activeElement === placeholder;
    cardObserver?.disconnect();
    cardObserver = null;
    pipWin = null;
    show(placeholder, false);
    setFloating(false);
    if (refocus) button.focus();
    onClose();
  }

  function close() {
    pipWin?.close();
  }

  return { el, button, placeholder, close };
}
