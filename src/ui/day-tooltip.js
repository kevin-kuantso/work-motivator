// 日期格悬停 / 聚焦提示（spec §12.2，R35 / 决定 2）：直接盖在该格上（同样大小，inset:0，左上对齐），
// 永远不会盖到下面或旁边的格子；不再有「点击修改」一行。纯视觉层：aria-hidden，屏幕阅读器经由格子的
// aria-describedby 读取完整文字（含来源）；pointer-events: none，不拦截点击。
// 4 行：日期｜状态｜来源｜计薪；6 周月份（compact）或 4 行放不下时拿掉「来源」行，只剩 3 行。
import { h } from './dom.js';

export function createDayTooltip(doc) {
  const win = doc.defaultView;
  const el = h(doc, 'div', { class: 'day-tooltip', 'aria-hidden': 'true', hidden: true });
  let timer = null;

  function cancel() {
    if (timer !== null) win.clearTimeout(timer);
    timer = null;
  }

  function show(btn, m, compact = false) {
    cancel();
    const cell = btn.parentElement;
    if (!btn.isConnected || !cell) return;
    el.replaceChildren(
      // 「11月18日」「周三」各是不可拆的单位：窄格子换行时只在单位之间换（round 3）
      h(doc, 'span', { class: 'tip-title' }, m.titleShort.split(' ').flatMap((u, i) => [i ? ' ' : null, h(doc, 'span', { class: 'u', text: u })])),
      h(doc, 'span', { class: 'tip-status', text: m.statusShort }),
      h(doc, 'span', { class: 'tip-source', text: m.sourceLabel }),
      h(doc, 'span', { class: 'tip-pay', text: m.payShort }));
    el.classList.toggle('is-compact', compact);
    if (el.parentElement !== cell) cell.append(el);
    el.hidden = false;
    // 格子比预期矮（例如提示条很多时）：4 行放不下就退回 3 行，不裁掉计薪那一行
    if (!compact && el.scrollHeight > el.clientHeight + 1) el.classList.add('is-compact');
  }

  function later(btn, m, ms, compact) {
    cancel();
    timer = win.setTimeout(() => {
      timer = null;
      show(btn, m, compact);
    }, ms);
  }

  function hide() {
    cancel();
    el.hidden = true;
  }

  return { el, show, later, hide };
}
