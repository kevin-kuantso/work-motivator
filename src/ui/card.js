// 状态卡 StatusCard：主分页与 PiP 共用。只用 root.ownerDocument 建立节点（不依赖全域 document）。
// 结构只建一次（按 root 记住），之后每次 tick 只更新文字，避免闪烁与焦点丢失。
// 每 tick 变化的数字（主金额、本月累计、进度、倒数）画成固定宽度数字格（digits.js，R33）：
// 数字格本身 aria-hidden，旁边一个看不见的 .sr-text 放完整文字给读屏（不会逐个数字念）。
import { h, setText, show } from './dom.js';
import { icon } from './icons.js';
import { cardModel } from './card-model.js';
import { dateLine } from './format.js';
import { renderDigits } from './digits.js';

const built = new WeakMap();
const CELEBRATE_MS = 1200; // 与 style.css 的 .is-celebrating 动画时长一致
const CELEBRATE_GAP_MS = 5000; // 距上次绘制超过这么久（睡眠 / 后台暂停）就不算「当场收工」

function build(root, t) {
  const doc = root.ownerDocument;
  const c = t.card;
  const r = {};
  const sr = () => h(doc, 'span', { class: 'visually-hidden sr-text' });
  const metric = (cls, label, extra = '', cells = false) =>
    (r[`${cls}-box`] = h(doc, 'div', { class: `metric ${cls}${extra}` },
      (r[`${cls}-label`] = h(doc, 'div', { class: 'metric-label', text: label })),
      (r[cls] = h(doc, 'div', { class: `metric-value amount${cells ? ' digits' : ''}`, 'aria-hidden': cells ? 'true' : null })),
      cells ? (r[`${cls}-sr`] = sr()) : null));

  r.badgeIcon = h(doc, 'span', { class: 'badge-icon' });
  r.badgeText = h(doc, 'span', { class: 'badge-text' });
  r.gear = h(doc, 'button', { type: 'button', class: 'card-gear', 'aria-label': c.gear, title: c.gear }, icon(doc, 'gear'));
  r.fill = h(doc, 'div', { class: 'bar-fill' });
  r.bar = h(doc, 'div', { class: 'bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-label': c.progressLabel }, r.fill);
  root.replaceChildren(
    h(doc, 'div', { class: 'card-band', 'aria-hidden': 'true' }),
    h(doc, 'div', { class: 'card-head' },
      (r.date = h(doc, 'span', { class: 'card-date' })),
      h(doc, 'span', { class: 'card-badges' },
        (r.badge = h(doc, 'span', { class: 'card-badge' }, r.badgeIcon, r.badgeText)),
        (r.tag = h(doc, 'span', { class: 'card-tag', hidden: true }))),
      r.gear),
    (r.label = h(doc, 'div', { class: 'card-label' })),
    (r.amount = h(doc, 'div', { class: 'card-amount amount', 'aria-hidden': 'true' },
      t.currency + ' ',
      (r.head = h(doc, 'span', { class: 'amount-head digits' })),
      (r.tail = h(doc, 'span', { class: 'amount-tail digits' })))),
    (r.amountSr = sr()),
    (r.cheer = h(doc, 'div', { class: 'card-cheer', hidden: true })),
    (r.progress = h(doc, 'div', { class: 'card-progress' },
      // 头一行：左「工时进度」，右倒数（M4）；没有进度条的状态，倒数 / 说明单独一行放在 countdownSlot
      (r.progressHead = h(doc, 'div', { class: 'card-progress-head' },
        h(doc, 'span', { class: 'card-progress-title', text: c.progressLabel }),
        (r.headSlot = h(doc, 'span', { class: 'card-progress-aside' },
          // 已下班：✓ 今天工作满 7小时（进度头一行右侧）
          (r.done = h(doc, 'span', { class: 'card-done', hidden: true }, icon(doc, 'check'), (r.doneText = h(doc, 'span', { class: 'card-done-text' })))))))),
      r.bar,
      (r.progressText = h(doc, 'div', { class: 'card-progress-text digits', 'aria-hidden': 'true' })),
      (r.progressSr = sr()))),
    (r.countdownSlot = h(doc, 'div', { class: 'card-countdown-slot' },
      // 倒数外面一层：隐藏的「占位文本」（分、秒补成 88）与真实文字叠在同一格，真实文字靠左。
      // 格子宽度恒定 = 最宽形态，「距下班」不会在 10秒→9秒、0秒→59秒 时左右跳（R33）
      (r.cdWrap = h(doc, 'span', { class: 'cd-wrap' },
        (r.cdGhost = h(doc, 'span', { class: 'cd-ghost digits', 'aria-hidden': 'true' })),
        (r.countdown = h(doc, 'div', { class: 'card-countdown digits', 'aria-hidden': 'true' })),
        (r.countdownSr = sr()))))),
    h(doc, 'div', { class: 'card-metrics' },
      metric('metric-rate', c.rate),
      metric('metric-month', c.month, '', true),
      metric('metric-hourly', c.hourly, ' lg-only'),
      metric('metric-daily', c.dailyFull, ' lg-only')),
    (r.payday = h(doc, 'div', { class: 'card-payday', hidden: true })),
    (r.year = h(doc, 'div', { class: 'card-year', hidden: true })),
  );
  root.classList.add('status-card');
  r.iconTone = null;
  built.set(root, r);
  return r;
}

// 收工当下（直播状态由上班中 / 午休转入已下班）金额淡绿高亮一次：不是载入时就已下班，也不是睡眠醒来；
// 减少动态时完全不加类。用每次绘制时的时钟判断何时移除（不依赖计时器，主窗 / PiP 都适用）。
function celebrate(root, r, snap, m) {
  const nowMs = snap.now instanceof Date ? snap.now.getTime() : NaN;
  const prev = r.prevStatus ?? null;
  const gap = nowMs - (r.prevMs ?? NaN);
  r.prevStatus = m.status;
  r.prevMs = nowMs;
  const win = root.ownerDocument.defaultView;
  const reduced = Boolean(win?.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  const live = Number.isFinite(gap) && gap >= 0 && gap <= CELEBRATE_GAP_MS;
  if (m.status === 'afterWork' && (prev === 'working' || prev === 'lunch') && live && !reduced) {
    r.celebrateUntil = nowMs + CELEBRATE_MS;
    r.amount.classList.add('is-celebrating');
  } else if (r.amount.classList.contains('is-celebrating')
    && (m.status !== 'afterWork' || reduced || !(nowMs < r.celebrateUntil))) {
    r.amount.classList.remove('is-celebrating');
  }
}

export function renderCard(root, snap, cfg, t) {
  const r = built.get(root) ?? build(root, t);
  const m = cardModel(snap, cfg, t);
  const doc = root.ownerDocument;

  if (root.dataset.tone !== m.tone) root.dataset.tone = m.tone;
  root.classList.toggle('is-settled', m.settled);

  show(r.date, snap.now instanceof Date);
  if (snap.now instanceof Date) setText(r.date, dateLine(snap.now, t));
  if (r.iconTone !== m.tone) {
    r.badgeIcon.replaceChildren(icon(doc, m.tone));
    r.iconTone = m.tone;
  }
  setText(r.badgeText, m.badge);
  show(r.tag, Boolean(m.tag));
  setText(r.tag, m.tag ?? '');

  setText(r.label, m.label);
  show(r.amount, m.showAmount);
  show(r.amountSr, m.showAmount);
  renderDigits(r.head, m.hero.head);
  renderDigits(r.tail, m.hero.tail);
  setText(r.amountSr, m.amountSrText);

  show(r.cheer, Boolean(m.cheer));
  setText(r.cheer, m.cheer ?? '');
  if (r.cheer.title !== (m.cheer ?? '')) r.cheer.title = m.cheer ?? '';

  show(r.progress, m.showProgress);
  r.fill.style.width = `${m.progressPct}%`;
  const now = String(m.progressPct);
  if (r.bar.getAttribute('aria-valuenow') !== now) r.bar.setAttribute('aria-valuenow', now);
  show(r.progressText, !m.progressInHead);
  renderDigits(r.progressText, m.progressText);
  setText(r.progressSr, m.progressText);
  show(r.done, m.progressInHead);
  setText(r.doneText, m.progressInHead ? m.progressText : '');
  // 有进度条：倒数在头一行右侧；没有：单独一行（同一个节点搬家，数字格状态不变）
  const home = m.showProgress ? r.headSlot : r.countdownSlot;
  if (r.cdWrap.parentNode !== home) home.append(r.cdWrap);
  show(r.countdownSlot, !m.showProgress && m.secondary !== '');
  show(r.countdown, m.secondary !== '');
  show(r.countdownSr, m.secondary !== '');
  renderDigits(r.cdGhost, t.durationWidest(m.secondary));
  renderDigits(r.countdown, m.secondary);
  setText(r.countdownSr, m.secondary);

  setText(r['metric-rate-label'], m.rateLabel);
  setText(r['metric-rate'], m.rate);
  renderDigits(r['metric-month'], m.month);
  setText(r['metric-month-sr'], m.month);
  setText(r['metric-hourly'], m.hourly);
  setText(r['metric-daily'], m.daily);
  show(r['metric-daily-box'], m.showDaily);

  show(r.payday, m.payday !== null);
  setText(r.payday, m.payday ?? '');
  show(r.year, m.yearNote !== null);
  setText(r.year, m.yearNote ?? '');
  r.year.title = m.yearTitle;
  celebrate(root, r, snap, m);
  return m;
}

// 大卡片的最小高度 = 「上班中」那张卡的高度（M11 / V1），在运行时用真实字体量出，不写死像素：
// 在状态卡旁边放一张看不见的复本，用「上班中」的内容（无鼓励语、发薪日、缺表标签）画一遍，量高度，写成 --card-ref-h。
// 载入、视窗尺寸改变（含跨过 640px 矮视窗断点）与字体载入后各量一次（app.js 控制时机）；卡片在小窗里（sm）时不量。
const ghosts = new WeakMap();
export function syncReferenceHeight(root, snap, cfg, t) {
  const parent = root.parentNode;
  if (!parent || root.dataset.size !== 'lg') return null;
  const doc = root.ownerDocument;
  let g = ghosts.get(root);
  if (!g) {
    g = doc.createElement('div');
    g.setAttribute('aria-hidden', 'true');
    g.dataset.size = 'lg';
    g.style.cssText = 'position:absolute;left:0;top:0;width:100%;min-height:0;visibility:hidden;pointer-events:none';
    ghosts.set(root, g);
  }
  parent.append(g);
  const ref = { ...snap, status: 'working', holidayName: null, makeupWork: false, paydayInDays: null, tableMissing: false };
  renderCard(g, ref, { ...cfg, cheer: '' }, t);
  const height = g.getBoundingClientRect().height;
  g.remove();
  if (height > 0) root.style.setProperty('--card-ref-h', `${height}px`);
  return height;
}
