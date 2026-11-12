// 日期格悬停 / 聚焦提示（spec §12.2、§13；Task 18 · V1「白卡盖格」）：白底卡片直接盖在该格上（同样大小，inset:0），内容置中，
// 永远不会盖到下面或旁边的格子；纯视觉层：aria-hidden，屏幕阅读器经由格子的 aria-describedby 读取完整文字（含来源）；
// pointer-events: none，不拦截点击。行：日期｜农历｜状态｜来源｜计薪（金额为主角）。
// 实测各档位：先收紧、隐藏来源；格子可显示农历时可隐藏提示中的农历，然后继续缩字、隐藏星期，最后才隐藏状态。
// 窄到格子不显示农历时，提示仍保留农历。金额与 aria-describedby 中的完整文字始终保留。
import { h } from './dom.js';

const ALL = ['is-tight', 'is-compact', 'is-inline', 'is-mini', 'is-no-wd', 'is-lean', 'is-no-lunar', 'is-no-pay-label', 'is-currency-fit', 'is-no-status-name'];
const TIERS = [
  [], ['is-tight'], ['is-compact'], ['is-compact', 'is-tight'],
  ['is-inline'], ['is-inline', 'is-tight'], ['is-inline', 'is-compact'], ['is-inline', 'is-compact', 'is-tight'],
  ['is-no-lunar'], ['is-no-lunar', 'is-tight'], ['is-no-lunar', 'is-compact'], ['is-no-lunar', 'is-compact', 'is-tight'],
  ['is-no-lunar', 'is-inline'], ['is-no-lunar', 'is-inline', 'is-tight'], ['is-no-lunar', 'is-inline', 'is-compact'], ['is-no-lunar', 'is-inline', 'is-compact', 'is-tight'],
  ['is-no-lunar', 'is-compact', 'is-no-pay-label'], ['is-no-lunar', 'is-compact', 'is-tight', 'is-no-pay-label'],
  ['is-no-lunar', 'is-inline', 'is-compact', 'is-tight', 'is-no-pay-label'],
  ['is-no-lunar', 'is-inline', 'is-compact', 'is-tight', 'is-no-pay-label', 'is-currency-fit'],
  ['is-no-lunar', 'is-inline', 'is-compact', 'is-tight', 'is-no-pay-label', 'is-mini'],
  ['is-no-lunar', 'is-inline', 'is-compact', 'is-tight', 'is-no-pay-label', 'is-currency-fit', 'is-no-status-name'],
  ['is-no-lunar', 'is-inline', 'is-compact', 'is-tight', 'is-no-pay-label', 'is-mini', 'is-no-status-name'],
  ['is-no-lunar', 'is-inline', 'is-compact', 'is-tight', 'is-mini'],
  ['is-no-lunar', 'is-inline', 'is-compact', 'is-tight', 'is-mini', 'is-no-wd'],
  ['is-no-lunar', 'is-inline', 'is-compact', 'is-tight', 'is-mini', 'is-no-wd', 'is-lean'],
];

const kindOf = (btn) => ([...btn.classList].find((c) => c.startsWith('kind-')) ?? 'kind-workday').slice(5);

export function createDayTooltip(doc) {
  // 文字拆成不可再拆的「单位」：sep 给了就按它拆（日期 / 周X 之间的空格，拆开后补回空格）；没给就在每个「·」之后断开。
  // 标了 wd 的单位（「周X」）在倒数第二档 is-no-wd 里整个隐藏：先于「拿掉状态行」的最后手段，屏幕阅读器仍读得到（格子的 aria-describedby）
  const units = (text, sep, weekday) => (sep ? text.split(sep) : text.replace(/\s+/g, ' ').split(/(?<=·)/)).flatMap((u, i) => [i && sep ? sep : null, h(doc, 'span', { class: weekday && i === 1 ? 'u u-wd' : i ? 'u u-detail' : 'u', text: u })]);

  const win = doc.defaultView;
  const el = h(doc, 'div', { class: 'day-tooltip', 'aria-hidden': 'true', hidden: true });
  let timer = null;
  let last = null; // 目前显示的格子与模型：resize / 字体就绪后重选分级用

  function cancel() {
    if (timer !== null) win.clearTimeout(timer);
    timer = null;
  }

  // 依序试各档位，选第一个完全放得下的（高、宽都不溢出）；全都不行就停在最后一档（金额永远保留）
  function pick() {
    for (const tier of TIERS) {
      el.classList.remove(...ALL);
      el.classList.add(...tier);
      if (!over()) return;
    }
  }

  function show(btn, m) {
    cancel();
    const cell = btn.parentElement;
    if (!btn.isConnected || !cell) return;
    // 结构化字段（日期 / 星期 / 计薪说明 / 金额）来自 dayTooltipModel：排版只用这些，不解析翻译后的空白或分隔符（Task 14）。
    // 只有拿不到结构化字段的旧模型（不该出现）才退回按空白拆 payShort
    const legacy = m.payLabel === undefined && m.payAmount === undefined;
    const [legacyLabel, ...legacyRest] = legacy ? m.payShort.split(' ') : [''];
    const titleDate = m.titleDate ?? m.titleShort;
    const payLabel = legacy ? legacyLabel : m.payLabel;
    const payAmount = legacy ? legacyRest.join(' ') : m.payAmount;
    el.replaceChildren(
      // 「11月18日」「周三」各是不可拆的单位：窄格子换行时只在单位之间换（round 3）
      h(doc, 'span', { class: 'tip-title' },
        h(doc, 'span', { class: 'u', text: titleDate }),
        ...(m.titleWeekday ? [m.titleSep ?? ' ', h(doc, 'span', { class: 'u u-wd', text: m.titleWeekday })] : [])),
      ...(m.lunar ? [h(doc, 'span', { class: 'tip-lunar', text: m.lunar })] : []),
      // 状态与来源只在「·」处换行（「法定假日·」「劳动节」各是整体），名字中间不折行
      h(doc, 'span', { class: 'tip-status' }, units(m.statusShort)),
      h(doc, 'span', { class: 'tip-source' }, units(m.sourceLabel)),
      h(doc, 'span', { class: `tip-pay${m.payZero ? ' is-zero' : ''}` },
        h(doc, 'span', { class: 'pay-label', text: payLabel }),
        m.paySep ?? ' ',
        h(doc, 'span', { class: 'pay-amt', text: payAmount || m.payShort })));
    el.dataset.kind = kindOf(btn);
    el.classList.toggle('is-today', btn.classList.contains('is-today'));
    if (el.parentElement !== cell) cell.append(el);
    el.hidden = false;
    last = { btn, m };
    pick();
  }

  // 窗口 resize / 字体就绪后重选分级：格子大小或字体度量变了，原本可用的档位可能不再放得下（或反过来）。
  // 已隐藏的提示不复活；格子被重绘（render() 换掉节点）后不再重选
  function refit() {
    if (!last || el.hidden) return;
    if (!last.btn.isConnected || el.parentElement !== last.btn.parentElement) return;
    pick();
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
    last = null;
  }

  // 与 app.js 的参考宽度同步同一个套路：窗口 resize、字体就绪（fonts.ready）与字体载入完成（loadingdone）后重选分级。
  // 同步执行、不排 rAF：e2e 用 page.clock 控制时间，rAF 可能被模拟掉
  win.addEventListener('resize', refit);
  try {
    doc.fonts?.ready?.then?.(refit, () => {});
    doc.fonts?.addEventListener?.('loadingdone', refit);
  } catch { /* 旧的浏览器没有 FontFaceSet：忽略，show() 那一次分级仍有效 */ }

  return { el, show, later, hide };
}
