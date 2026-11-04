// 状态卡 StatusCard：主分页与 PiP 共用。只用 root.ownerDocument 建立节点（不依赖全域 document）。
// 结构只建一次（按 root 记住），之后每次 tick 只更新文字，避免闪烁与焦点丢失。
// 每 tick 变化的数字（主金额、本月累计、进度、倒数）画成固定宽度数字格（digits.js，R33）：
// 数字格本身 aria-hidden，旁边一个看不见的 .sr-text 放完整文字给读屏（不会逐个数字念）。
import { h, setText, show } from './dom.js';
import { icon } from './icons.js';
import { cardModel } from './card-model.js';
import { heroParts, dateLine, money } from './format.js';
import { renderDigits } from './digits.js';

const built = new WeakMap();

function build(root, t) {
  const doc = root.ownerDocument;
  const c = t.card;
  const r = {};
  const sr = () => h(doc, 'span', { class: 'visually-hidden sr-text' });
  const metric = (cls, label, extra = '', cells = false) =>
    h(doc, 'div', { class: `metric ${cls}${extra}` },
      h(doc, 'div', { class: 'metric-label', text: label }),
      (r[cls] = h(doc, 'div', { class: `metric-value amount${cells ? ' digits' : ''}`, 'aria-hidden': cells ? 'true' : null })),
      cells ? (r[`${cls}-sr`] = sr()) : null);

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
      r.bar,
      (r.progressText = h(doc, 'div', { class: 'card-progress-text digits', 'aria-hidden': 'true' })),
      (r.progressSr = sr()))),
    (r.countdown = h(doc, 'div', { class: 'card-countdown digits', 'aria-hidden': 'true' })),
    (r.countdownSr = sr()),
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
  const parts = heroParts(m.amount);
  renderDigits(r.head, parts.head);
  renderDigits(r.tail, parts.tail);
  setText(r.amountSr, `${t.currency} ${money(m.amount, 4)}`);

  show(r.cheer, Boolean(m.cheer));
  setText(r.cheer, m.cheer ?? '');
  if (r.cheer.title !== (m.cheer ?? '')) r.cheer.title = m.cheer ?? '';

  show(r.progress, m.showProgress);
  r.fill.style.width = `${m.progressPct}%`;
  const now = String(m.progressPct);
  if (r.bar.getAttribute('aria-valuenow') !== now) r.bar.setAttribute('aria-valuenow', now);
  renderDigits(r.progressText, m.progressText);
  setText(r.progressSr, m.progressText);
  show(r.countdown, m.secondary !== '');
  show(r.countdownSr, m.secondary !== '');
  renderDigits(r.countdown, m.secondary);
  setText(r.countdownSr, m.secondary);

  setText(r['metric-rate'], m.rate);
  renderDigits(r['metric-month'], m.month);
  setText(r['metric-month-sr'], m.month);
  setText(r['metric-hourly'], m.hourly);
  setText(r['metric-daily'], m.daily);

  show(r.payday, m.payday !== null);
  setText(r.payday, m.payday ?? '');
  show(r.year, m.yearNote !== null);
  setText(r.year, m.yearNote ?? '');
  r.year.title = m.yearTitle;
  return m;
}
