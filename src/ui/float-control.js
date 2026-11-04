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
  const button = h(doc, 'button', {
    type: 'button', class: 'btn btn-primary float-btn', id: 'btn-float',
    disabled: !supported, 'aria-describedby': supported ? undefined : 'float-note', onclick: toggle,
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
    onOpen(w);
  }

  // pagehide 时调用（按 X、占位卡、按钮、齿轮都走这里）
  function restored() {
    const refocus = doc.activeElement === placeholder;
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
