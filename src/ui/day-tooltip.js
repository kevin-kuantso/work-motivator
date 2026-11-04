// 日期格悬停 / 聚焦提示（spec §12.2、§13；Task 18 · V1「白卡盖格」）：白底卡片直接盖在该格上（同样大小，inset:0），内容置中，
// 永远不会盖到下面或旁边的格子；纯视觉层：aria-hidden，屏幕阅读器经由格子的 aria-describedby 读取完整文字（含来源）；
// pointer-events: none，不拦截点击。行：日期｜状态｜来源｜计薪（金额为主角）。
// 「来源」行不再按「6 周月份」一刀切，而是实测：放不下就先收紧行高（is-tight），还不行才拿掉来源（is-compact）。
import { h } from './dom.js';

const kindOf = (btn) => ([...btn.classList].find((c) => c.startsWith('kind-')) ?? 'kind-workday').slice(5);

export function createDayTooltip(doc) {
  const win = doc.defaultView;
  const el = h(doc, 'div', { class: 'day-tooltip', 'aria-hidden': 'true', hidden: true });
  let timer = null;

  function cancel() {
    if (timer !== null) win.clearTimeout(timer);
    timer = null;
  }

  function show(btn, m) {
    cancel();
    const cell = btn.parentElement;
    if (!btn.isConnected || !cell) return;
    const [payLabel, ...payRest] = m.payShort.split(' ');
    const amount = payRest.join(' ');
    el.replaceChildren(
      // 「11月18日」「周三」各是不可拆的单位：窄格子换行时只在单位之间换（round 3）
      h(doc, 'span', { class: 'tip-title' }, m.titleShort.split(' ').flatMap((u, i) => [i ? ' ' : null, h(doc, 'span', { class: 'u', text: u })])),
      h(doc, 'span', { class: 'tip-status', text: m.statusShort }),
      h(doc, 'span', { class: 'tip-source', text: m.sourceLabel }),
      h(doc, 'span', { class: `tip-pay${/^\D*0\.00$/.test(amount) ? ' is-zero' : ''}` },
        h(doc, 'span', { class: 'pay-label', text: payLabel }), ' ', h(doc, 'span', { class: 'pay-amt', text: amount })));
    el.dataset.kind = kindOf(btn);
    el.classList.toggle('is-today', btn.classList.contains('is-today'));
    el.classList.remove('is-tight', 'is-compact');
    if (el.parentElement !== cell) cell.append(el);
    el.hidden = false;
    // 格子比预期矮：先收紧行高保住 4 行；仍放不下才拿掉来源；再不行就拿掉来源 + 收紧。绝不裁掉计薪那一行
    const over = () => el.scrollHeight > el.clientHeight + 0.5;
    if (over()) el.classList.add('is-tight');
    if (over()) { el.classList.remove('is-tight'); el.classList.add('is-compact'); }
    if (over()) el.classList.add('is-tight');
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
