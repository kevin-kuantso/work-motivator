// 日期格悬停 / 聚焦提示（spec §12.2、§13；Task 18 · V1「白卡盖格」）：白底卡片直接盖在该格上（同样大小，inset:0），内容置中，
// 永远不会盖到下面或旁边的格子；纯视觉层：aria-hidden，屏幕阅读器经由格子的 aria-describedby 读取完整文字（含来源）；
// pointer-events: none，不拦截点击。行：日期｜状态｜来源｜计薪（金额为主角）。
// 「来源」行不再按「6 周月份」一刀切，而是实测：依序试各档位（收紧行距 → 拿掉来源 → 窄格子计薪回到一行 → 再小一号字 → 最后手段拿掉状态行），金额永远保留。
import { h } from './dom.js';

const ALL = ['is-tight', 'is-compact', 'is-inline', 'is-mini', 'is-lean'];
const TIERS = [
  [], ['is-tight'], ['is-compact'], ['is-compact', 'is-tight'],
  ['is-inline'], ['is-inline', 'is-tight'], ['is-inline', 'is-compact'], ['is-inline', 'is-compact', 'is-tight'],
  ['is-inline', 'is-compact', 'is-tight', 'is-mini'], ['is-inline', 'is-compact', 'is-tight', 'is-mini', 'is-lean'],
];

const kindOf = (btn) => ([...btn.classList].find((c) => c.startsWith('kind-')) ?? 'kind-workday').slice(5);

export function createDayTooltip(doc) {
  // 文字拆成不可再拆的「单位」：sep 给了就按它拆（日期 / 周X 之间的空格，拆开后补回空格）；没给就在每个「·」之后断开
  const units = (text, sep) => (sep ? text.split(sep) : text.split(/(?<=·)/)).flatMap((u, i) => [i && sep ? sep : null, h(doc, 'span', { class: 'u', text: u })]);

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
      h(doc, 'span', { class: 'tip-title' }, units(m.titleShort, ' ')),
      // 状态与来源只在「·」处换行（「法定假日·」「劳动节」各是整体），名字中间不折行
      h(doc, 'span', { class: 'tip-status' }, units(m.statusShort)),
      h(doc, 'span', { class: 'tip-source' }, units(m.sourceLabel)),
      h(doc, 'span', { class: `tip-pay${/^\D*0\.00$/.test(amount) ? ' is-zero' : ''}` },
        h(doc, 'span', { class: 'pay-label', text: payLabel }), ' ', h(doc, 'span', { class: 'pay-amt', text: amount })));
    el.dataset.kind = kindOf(btn);
    el.classList.toggle('is-today', btn.classList.contains('is-today'));
    if (el.parentElement !== cell) cell.append(el);
    el.hidden = false;
    // 依序试各档位，选第一个完全放得下的（高、宽都不溢出）；全都不行就停在最后一档（金额永远保留）
    for (const tier of TIERS) {
      el.classList.remove(...ALL);
      el.classList.add(...tier);
      if (!over()) return;
    }
  }

  const over = () => el.scrollHeight > el.clientHeight + 0.5 || el.scrollWidth > el.clientWidth + 0.5
    || [...el.children].some((c) => c.scrollWidth > c.clientWidth + 0.5);

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
