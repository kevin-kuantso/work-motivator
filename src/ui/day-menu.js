// 月曆日期小選單（spec §12.1）：role=menu + menuitemradio；方向鍵 / Home / End 移動，
// Enter / Space 套用（按鈕原生行為），Esc / Tab 關閉並把焦點還給日期格，點選單外關閉。
// 全頁只有一個選單節點；只在開啟期間掛 document / window 監聽，關閉即移除。
import { h, setText } from './dom.js';
import { icon } from './icons.js';

const OPTION_ICON = { default: 'reset', work: 'makeup', rest: 'rest', paidLeave: 'paid', unpaidLeave: 'unpaid' };
const GAP = 4;

// refocus(btn)：把焦點還給日期格（呼叫方用來區分程式聚焦，避免 Esc 後立刻彈出提示）。
export function createDayMenu(doc, container, { onChoose, refocus = (btn) => btn.focus() }) {
  const win = doc.defaultView;
  const header = h(doc, 'p', { class: 'day-menu-header', id: 'day-menu-header' });
  const list = h(doc, 'div', { class: 'day-menu-list', id: 'day-menu', role: 'menu', 'aria-labelledby': 'day-menu-header', 'aria-describedby': 'day-menu-footer' });
  const footer = h(doc, 'p', { class: 'day-menu-footer', id: 'day-menu-footer' });
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

  // 優先放在格子右側、頂端對齊；放不下就翻到左側，再不行就貼邊；上下同樣夾在月曆與視窗之內。
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

  // 月曆重繪後：掛到新的格子上並更新內容，保留焦點所在的選項。
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
    if (returnFocus && a.isConnected) refocus(a);
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
