// 顶栏「悬浮成小窗」按钮、不支援说明、主分页占位卡，以及开 / 关小窗的状态同步。
import { isPipSupported, openFloat } from '../pip.js';
import { h, setText, show } from './dom.js';

export function createFloatControl(doc, t, { cardRoot, onOpen, onClose, onFail }) {
  const win = doc.defaultView;
  const f = t.float;
  const supported = isPipSupported(win);
  let pipWin = null;
  let opening = false;

  const note = h(doc, 'span', { class: 'float-note', id: 'float-note', hidden: supported, text: f.unsupported });
  const button = h(doc, 'button', {
    type: 'button', class: 'btn btn-primary', id: 'btn-float', text: t.header.float,
    disabled: !supported, 'aria-describedby': supported ? undefined : 'float-note', onclick: toggle,
  });
  // 整张占位卡是一个按钮；不显示金额，避免两处同时跳动与重复朗读（design §4.4）
  // 可访问名称 = 「已悬浮 · 点此收回」；说明（小窗依附本页，spec §3）作为描述
  const placeholder = h(doc, 'button', {
    type: 'button', class: 'pip-placeholder', hidden: true, onclick: close,
    'aria-labelledby': 'pip-placeholder-title', 'aria-describedby': 'pip-placeholder-note',
  },
  h(doc, 'span', { class: 'pip-placeholder-title', id: 'pip-placeholder-title', text: f.placeholder }),
  h(doc, 'span', { class: 'pip-placeholder-note', id: 'pip-placeholder-note', text: f.placeholderNote }));

  function toggle() {
    if (pipWin) close();
    else open();
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
    setText(button, f.recall);
    onOpen(w);
  }

  // pagehide 时调用（按 X、占位卡、顶栏按钮、齿轮都走这里）
  function restored() {
    const refocus = doc.activeElement === placeholder;
    pipWin = null;
    show(placeholder, false);
    setText(button, t.header.float);
    if (refocus) button.focus();
    onClose();
  }

  function close() {
    pipWin?.close();
  }

  return { button, note, placeholder, close };
}
