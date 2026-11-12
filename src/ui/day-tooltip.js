// 日期格懸停 / 聚焦提示（spec §12.2、§13；Task 18 · V1「白卡蓋格」）：白底卡片直接蓋在該格上（同樣大小，inset:0），內容置中，
// 永遠不會蓋到下面或旁邊的格子；純視覺層：aria-hidden，螢幕閱讀器經由格子的 aria-describedby 讀取完整文字（含來源）；
// pointer-events: none，不攔截點選。行：日期｜農曆｜狀態｜來源｜計薪（金額為主角）。
// 實測各檔位：先收緊、隱藏來源；格子可顯示農曆時可隱藏提示中的農曆，然後繼續縮字、隱藏星期，最後才隱藏狀態。
// 窄到格子不顯示農曆時，提示仍保留農曆。金額與 aria-describedby 中的完整文字始終保留。
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
  // 文字拆成不可再拆的「單位」：sep 給了就按它拆（日期 / 周X 之間的空格，拆開後補回空格）；沒給就在每個「·」之後斷開。
  // 標了 wd 的單位（「周X」）在倒數第二檔 is-no-wd 裡整個隱藏：先於「拿掉狀態行」的最後手段，螢幕閱讀器仍讀得到（格子的 aria-describedby）
  const units = (text, sep, weekday) => (sep ? text.split(sep) : text.replace(/\s+/g, ' ').split(/(?<=·)/)).flatMap((u, i) => [i && sep ? sep : null, h(doc, 'span', { class: weekday && i === 1 ? 'u u-wd' : i ? 'u u-detail' : 'u', text: u })]);

  const win = doc.defaultView;
  const el = h(doc, 'div', { class: 'day-tooltip', 'aria-hidden': 'true', hidden: true });
  let timer = null;
  let last = null; // 目前顯示的格子與模型：resize / 字型就緒後重選分級用

  function cancel() {
    if (timer !== null) win.clearTimeout(timer);
    timer = null;
  }

  // 依序試各檔位，選第一個完全放得下的（高、寬都不溢位）；全都不行就停在最後一檔（金額永遠保留）
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
    // 結構化欄位（日期 / 星期 / 計薪說明 / 金額）來自 dayTooltipModel：排版只用這些，不解析翻譯後的空白或分隔符（Task 14）。
    // 只有拿不到結構化欄位的舊模型（不該出現）才退回按空白拆 payShort
    const legacy = m.payLabel === undefined && m.payAmount === undefined;
    const [legacyLabel, ...legacyRest] = legacy ? m.payShort.split(' ') : [''];
    const titleDate = m.titleDate ?? m.titleShort;
    const payLabel = legacy ? legacyLabel : m.payLabel;
    const payAmount = legacy ? legacyRest.join(' ') : m.payAmount;
    el.replaceChildren(
      // 「11月18日」「週三」各是不可拆的單位：窄格子換行時只在單位之間換（round 3）
      h(doc, 'span', { class: 'tip-title' },
        h(doc, 'span', { class: 'u', text: titleDate }),
        ...(m.titleWeekday ? [m.titleSep ?? ' ', h(doc, 'span', { class: 'u u-wd', text: m.titleWeekday })] : [])),
      ...(m.lunar ? [h(doc, 'span', { class: 'tip-lunar', text: m.lunar })] : []),
      // 狀態與來源只在「·」處換行（「法定假日·」「勞動節」各是整體），名字中間不折行
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

  // 視窗 resize / 字型就緒後重選分級：格子大小或字型度量變了，原本可用的檔位可能不再放得下（或反過來）。
  // 已隱藏的提示不復活；格子被重繪（render() 換掉節點）後不再重選
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

  // 與 app.js 的參考寬度同步同一個套路：視窗 resize、字型就緒（fonts.ready）與字型載入完成（loadingdone）後重選分級。
  // 同步執行、不排 rAF：e2e 用 page.clock 控制時間，rAF 可能被模擬掉
  win.addEventListener('resize', refit);
  try {
    doc.fonts?.ready?.then?.(refit, () => {});
    doc.fonts?.addEventListener?.('loadingdone', refit);
  } catch { /* 舊的瀏覽器沒有 FontFaceSet：忽略，show() 那一次分級仍有效 */ }

  return { el, show, later, hide };
}
