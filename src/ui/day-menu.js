// 月历日期小选单（spec §12.1）：role=menu + menuitemradio；方向键 / Home / End 移动，
// Enter / Space 套用（按钮原生行为），Esc / Tab 关闭并把焦点还给日期格，点选单外关闭。
// 全页只有一个选单节点；只在打开期间挂 document / window 监听，关闭即移除。
import { h, setText } from './dom.js';
import { icon } from './icons.js';

const OPTION_ICON = { default: 'reset', work: 'makeup', rest: 'rest', paidLeave: 'paid', unpaidLeave: 'unpaid' };
const GAP = 4;

export function createDayMenu(doc, container, { onChoose }) {
  const win = doc.defaultView;
  const header = h(doc, 'p', { class: 'day-menu-header', id: 'day-menu-header' });
  const list = h(doc, 'div', { class: 'day-menu-list', id: 'day-menu', role: 'menu', 'aria-labelledby': 'day-menu-header' });
  const footer = h(doc, 'p', { class: 'day-menu-footer' });
  const el = h(doc, 'div', { class: 'day-menu', hidden: true }, header, list, footer);
  let anchor = null;
  let openKey = null;

  const items = () => [...list.querySelectorAll('[role="menuitemradio"]')];

  function build(model) {
    setText(header, model.header);
    setText(footer, model.footer);
    list.replaceChildren(...model.items.map((it) =>
      h(doc, 'button', {
        type: 'button', role: 'menuitemradio', class: 'day-menu-item', tabindex: '-1',
        'aria-checked': it.checked ? 'true' : 'false', 'data-option': it.id,
        onclick: () => choose(it.id),
      },
      h(doc, 'span', { class: 'day-menu-check' }, it.checked ? icon(doc, 'check') : null),
      h(doc, 'span', { class: 'day-menu-icon' }, icon(doc, OPTION_ICON[it.id])),
      h(doc, 'span', { class: 'day-menu-label', text: it.label }),
      h(doc, 'span', { class: `day-menu-note${it.checked ? ' is-current' : ''}`, text: it.note }))));
  }

  // 优先放在格子右侧、顶端对齐；放不下就翻到左侧，再不行就贴边；上下同样夹在月历与视窗之内。
  function place() {
    const c = container.getBoundingClientRect();
    const a = anchor.getBoundingClientRect();
    const w = el.offsetWidth;
    const ht = el.offsetHeight;
    const right = Math.min(c.right, doc.documentElement.clientWidth) - GAP;
    const left = Math.max(c.left, 0) + GAP;
    const bottom = Math.min(c.bottom, win.innerHeight) - GAP;
    const top = Math.max(c.top, 0) + GAP;
    let x = a.right + GAP;
    if (x + w > right) x = a.left - GAP - w;
    if (x < left) x = Math.max(left, right - w);
    let y = a.top;
    if (y + ht > bottom) y = bottom - ht;
    if (y < top) y = top;
    el.style.left = `${Math.round(x - c.left)}px`;
    el.style.top = `${Math.round(y - c.top)}px`;
  }

  function focusAt(i) {
    const all = items();
    if (all.length) all[(i + all.length) % all.length].focus();
  }

  function onKey(e) {
    const all = items();
    const i = all.indexOf(doc.activeElement);
    if (e.key === 'ArrowDown') focusAt(i + 1);
    else if (e.key === 'ArrowUp') focusAt(i < 0 ? -1 : i - 1);
    else if (e.key === 'Home') focusAt(0);
    else if (e.key === 'End') focusAt(-1);
    else if (e.key === 'Escape' || e.key === 'Tab') close(true);
    else return;
    e.preventDefault();
    e.stopPropagation();
  }
  list.addEventListener('keydown', onKey);

  function onOutside(e) {
    if (el.contains(e.target) || (anchor && anchor.contains(e.target))) return;
    close(false);
  }
  const onResize = () => place();

  function setAnchor(btn) {
    anchor?.setAttribute('aria-expanded', 'false');
    anchor?.removeAttribute('aria-controls');
    anchor = btn;
    anchor.setAttribute('aria-expanded', 'true');
    anchor.setAttribute('aria-controls', 'day-menu');
  }

  function open(btn, key, model) {
    if (openKey !== null) close(false);
    openKey = key;
    build(model);
    setAnchor(btn);
    el.hidden = false;
    place();
    doc.addEventListener('pointerdown', onOutside, true);
    win.addEventListener('resize', onResize);
    const all = items();
    (all.find((b) => b.getAttribute('aria-checked') === 'true') ?? all[0])?.focus();
  }

  // 月历重绘后：挂到新的格子上并更新内容，保留焦点所在的选项。
  function refresh(btn, model) {
    const all = items();
    const had = all.indexOf(doc.activeElement);
    build(model);
    setAnchor(btn);
    place();
    if (had >= 0) focusAt(Math.min(had, items().length - 1));
  }

  function close(returnFocus) {
    if (openKey === null) return;
    openKey = null;
    el.hidden = true;
    doc.removeEventListener('pointerdown', onOutside, true);
    win.removeEventListener('resize', onResize);
    const a = anchor;
    a.setAttribute('aria-expanded', 'false');
    a.removeAttribute('aria-controls');
    anchor = null;
    if (returnFocus && a.isConnected) a.focus();
  }

  function choose(id) {
    const key = openKey;
    close(true);
    onChoose(key, id);
  }

  return {
    el,
    open,
    refresh,
    close,
    isOpen: () => openKey !== null,
    key: () => openKey,
    hasFocus: () => el.contains(doc.activeElement),
  };
}
