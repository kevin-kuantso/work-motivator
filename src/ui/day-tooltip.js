// 日期格悬停 / 聚焦提示（spec §12.2）。纯视觉层：aria-hidden，屏幕阅读器经由格子的
// aria-describedby 读取同一段文字；pointer-events: none，不拦截点击。
import { h } from './dom.js';

const GAP = 4;

export function createDayTooltip(doc, container) {
  const win = doc.defaultView;
  const el = h(doc, 'div', { class: 'day-tooltip', 'aria-hidden': 'true', hidden: true });
  let timer = null;

  function cancel() {
    if (timer !== null) win.clearTimeout(timer);
    timer = null;
  }

  function place(btn) {
    const c = container.getBoundingClientRect();
    const a = btn.getBoundingClientRect();
    const w = el.offsetWidth;
    const ht = el.offsetHeight;
    const right = Math.min(c.right, doc.documentElement.clientWidth) - GAP;
    const left = Math.max(c.left, 0) + GAP;
    const bottom = Math.min(c.bottom, win.innerHeight) - GAP;
    const x = Math.max(left, Math.min(a.left, right - w));
    let y = a.bottom + GAP;
    if (y + ht > bottom) y = a.top - GAP - ht;
    el.style.left = `${Math.round(x - c.left)}px`;
    el.style.top = `${Math.round(y - c.top)}px`;
  }

  function show(btn, m) {
    cancel();
    if (!btn.isConnected) return;
    el.replaceChildren(
      h(doc, 'strong', { class: 'tip-title', text: m.title }),
      h(doc, 'span', { class: 'tip-status', text: m.status }),
      h(doc, 'span', { class: 'tip-source', text: m.source }),
      h(doc, 'span', { class: 'tip-pay', text: m.pay }),
      h(doc, 'span', { class: 'tip-hint', text: m.hint }));
    el.hidden = false;
    place(btn);
  }

  function later(btn, m, ms) {
    cancel();
    timer = win.setTimeout(() => {
      timer = null;
      show(btn, m);
    }, ms);
  }

  function hide() {
    cancel();
    el.hidden = true;
  }

  return { el, show, later, hide };
}
