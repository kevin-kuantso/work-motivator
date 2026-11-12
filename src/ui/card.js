// 状态卡 StatusCard：主分页与 PiP 共用。只用 root.ownerDocument 建立节点（不依赖全域 document）。
// 结构只建一次（按 root 记住），之后每次 tick 只更新文字，避免闪烁与焦点丢失。
// 每 tick 变化的数字（主金额、本月累计、进度、倒数）画成固定宽度数字格（digits.js，R33）：
// 数字格本身 aria-hidden，旁边一个看不见的 .sr-text 放完整文字给读屏（不会逐个数字念）。
import { h, setText, show } from './dom.js';
import { icon } from './icons.js';
import { cardModel } from './card-model.js';
import { dateLine, lunarText } from './format.js';
import { renderDigits } from './digits.js';

const built = new WeakMap();
// 币别与数字之间留一个空格（设计与 e2e 的「¥ 323.81」）；各地区符号本身的间距由 profile 决定
const cardCurrency = (t) => `${t.currency} `;
const CELEBRATE_MS = 1200; // 与 style.css 的 .is-celebrating 动画时长一致
const CELEBRATE_GAP_MS = 5000; // 距上次绘制超过这么久（睡眠 / 后台暂停）就不算「当场收工」
// 多句鼓励语轮播：每句停留约 8 秒，切换时柔和淡出 → 换字 → 淡入（Web Animations API，不改样式表）。
// 卡片上永远只有一个 .card-cheer 文字节点，且样式是单行省略，所以句子长短不影响卡片 / 小窗高度。
const CHEER_ROTATE_MS = 8000;
const CHEER_FADE_OUT_MS = 260;
const CHEER_FADE_IN_MS = 420;

const cheerHost = (root) => root.ownerDocument.defaultView ?? null;
const cheerReduced = (root) => Boolean(cheerHost(root)?.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

// 计时器一律挂在「当前所在文档」的 window 上（卡片会搬进 / 搬出 PiP），并记住是哪个 window 排的，
// 清理时用同一个 window 取消，避免搬家后留下孤儿计时器。
function clearCheerTimer(r) {
  if (r.cheerTimer !== null && r.cheerTimer !== undefined) {
    try { r.cheerTimerWin?.clearTimeout(r.cheerTimer); } catch { /* 旧文档已销毁 */ }
    r.cheerTimer = null;
    r.cheerTimerWin = null;
  }
}

// 取消正在跑的淡入淡出：cancel() 会去掉 fill 的效果，opacity 自动回到样式默认的 1，不会卡在中间值。
function cancelCheerAnim(r) {
  if (r.cheerAnim) {
    try { r.cheerAnim.cancel(); } catch { /* 旧文档已销毁 */ }
    r.cheerAnim = null;
  }
}

// 停掉轮播：世代 +1 让所有在途回调失效（含已排队但还没跑的），再清计时器与动画。
// 本来就没在跑时不动世代号，避免每秒重画都把计数推高。
function stopCheer(r) {
  if (r.cheerTimer === null && r.cheerTimerWin === null && !r.cheerAnim) return;
  r.cheerGen = (r.cheerGen ?? 0) + 1;
  clearCheerTimer(r);
  cancelCheerAnim(r);
}

function afterCheer(root, r, ms, fn) {
  const win = cheerHost(root);
  clearCheerTimer(r);
  if (!win) return;
  const gen = r.cheerGen ?? 0;
  r.cheerTimerWin = win;
  r.cheerTimer = win.setTimeout(() => {
    r.cheerTimer = null;
    r.cheerTimerWin = null;
    if (gen !== (r.cheerGen ?? 0)) return; // 已停 / 已换文档：旧结果直接丢弃
    fn();
  }, ms);
}

function paintCheer(r) {
  const text = r.cheerLines?.[r.cheerIndex] ?? '';
  setText(r.cheer, text);
  if (r.cheer.title !== text) r.cheer.title = text;
}

// 淡入 / 淡出一律走这里：浏览器不支持 WAAPI（或 animate 抛错）时回传 null，调用方退回「直接换字」。
function fadeCheer(el, from, to, ms, easing) {
  if (typeof el.animate !== 'function') return null;
  try {
    return el.animate([{ opacity: from }, { opacity: to }], { duration: ms, easing, fill: 'forwards' });
  } catch {
    return null; // 旧文档已销毁 / 动画被禁用：不做动画，字照样换
  }
}

function rotateCheer(root, r) {
  const lines = r.cheerLines;
  if (!lines || lines.length < 2 || r.cheer.hidden) return;
  if (!root.isConnected) { stopCheer(r); return; }
  // 页面在后台不推进，也不再排下一轮：后台里浏览器本来就会节流计时器，重排只是白醒。
  // 回到前台后由下一次绘制重新排队（armCheer 的前台条件），节奏从那时重新起算。
  if (root.ownerDocument.visibilityState === 'hidden') return;
  const next = (r.cheerIndex + 1) % lines.length;
  const settle = () => {
    cancelCheerAnim(r);
    afterCheer(root, r, CHEER_ROTATE_MS - CHEER_FADE_OUT_MS - CHEER_FADE_IN_MS, () => rotateCheer(root, r));
  };
  // 没有动画可做（减少动态 / 不支持 / 抛错）：直接换句，节奏不变
  const swap = () => {
    r.cheerIndex = next;
    paintCheer(r);
    afterCheer(root, r, CHEER_ROTATE_MS, () => rotateCheer(root, r));
  };
  if (cheerReduced(root)) { swap(); return; }
  cancelCheerAnim(r);
  r.cheerAnim = fadeCheer(r.cheer, 1, 0, CHEER_FADE_OUT_MS, 'ease-in');
  if (!r.cheerAnim) { swap(); return; }
  afterCheer(root, r, CHEER_FADE_OUT_MS, () => {
    // 计时器排队之后卡片可能被移除（PiP 收回 / 整卡替换）：先确认还在文档里，
    // 否则会在一个已经拿掉的节点上继续换字并排下一轮，永远停不下来。
    if (!root.isConnected) { stopCheer(r); return; }
    // 先换字再决定下一步：淡出已在 0，取消旧动画也不会闪一帧全亮
    const out = r.cheerAnim;
    r.cheerAnim = null;
    r.cheerIndex = next;
    paintCheer(r);
    // 淡出途中用户改成「减少动态」：这一句直接定住，不再淡入
    if (cheerReduced(root)) {
      if (out) { try { out.cancel(); } catch { /* 旧文档已销毁 */ } }
      afterCheer(root, r, CHEER_ROTATE_MS - CHEER_FADE_OUT_MS, () => rotateCheer(root, r));
      return;
    }
    const anim = fadeCheer(r.cheer, 0, 1, CHEER_FADE_IN_MS, 'ease-out');
    if (out) { try { out.cancel(); } catch { /* 旧文档已销毁 */ } }
    // 淡入动画建不起来：此时 opacity 已回到 1（旧动画被取消），直接按「已淡入」收尾
    if (!anim) {
      afterCheer(root, r, CHEER_ROTATE_MS - CHEER_FADE_OUT_MS, () => rotateCheer(root, r));
      return;
    }
    r.cheerAnim = anim;
    afterCheer(root, r, CHEER_FADE_IN_MS, () => {
      if (!root.isConnected) { stopCheer(r); return; }
      settle();
    });
  });
}

// 每次绘制都调：只有「该轮播、确实没跑、且页面在前台」时才排一轮，所以每秒重画不会重置节奏，
// 后台也不会每隔 8 秒白醒一次（回前台后的第一次绘制再排）。
function armCheer(root, r) {
  const needed = !r.cheer.hidden && (r.cheerLines?.length ?? 0) > 1 && root.isConnected
    && root.ownerDocument.visibilityState !== 'hidden';
  if (!needed) { stopCheer(r); return; }
  if (r.cheerTimer !== null) return;
  afterCheer(root, r, CHEER_ROTATE_MS, () => rotateCheer(root, r));
}

// 每 100 ms 都会进这里：不做字符串拼接，逐项比较就够（句子最多几十个）。
function sameLines(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// 每次绘制都调：句子集合、显示开关或所在窗口变了才重排；否则只保证计时器仍在跑（每秒重画不会重置节奏）。
function syncCheer(root, r, on, lines) {
  const win = cheerHost(root);
  if (r.cheerWin !== win) {
    // 卡片被搬进 / 搬出 PiP：旧窗口的计时器必须先停，否则会在原窗口继续跑；
    // 新文档里的节点要重画一遍文字，所以把它当成「状态未知」。
    stopCheer(r);
    r.cheerWin = win;
    r.cheerIndex = 0;
    r.cheerOn = null;
  }
  if (r.cheerOn === on && (!on || sameLines(r.cheerLines, lines))) { armCheer(root, r); return; }
  r.cheerOn = on;
  r.cheerLines = lines.slice();
  r.cheerIndex = 0;
  stopCheer(r);
  if (!on) {
    setText(r.cheer, '');
    r.cheer.title = '';
    return;
  }
  paintCheer(r);
  armCheer(root, r);
}

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
      (r.dateGroup = h(doc, 'span', { class: 'card-date-group' },
        (r.date = h(doc, 'span', { class: 'card-date' })),
        (r.lunar = h(doc, 'span', { class: 'card-lunar' })))),
      h(doc, 'span', { class: 'card-badges' },
        (r.badge = h(doc, 'span', { class: 'card-badge' }, r.badgeIcon, r.badgeText)),
        (r.tag = h(doc, 'span', { class: 'card-tag', hidden: true }))),
      r.gear),
    (r.label = h(doc, 'div', { class: 'card-label' })),
    (r.amount = h(doc, 'div', { class: 'card-amount amount', 'aria-hidden': 'true' },
      // 币别单独一个文字节点：切换地区时只改这一段，不动数字格（digits.js 的节点保持不变）
      (r.cur = doc.createTextNode(cardCurrency(t))),
      (r.head = h(doc, 'span', { class: 'amount-head digits' })),
      (r.tail = h(doc, 'span', { class: 'amount-tail digits' })))),
    (r.amountSr = sr()),
    (r.cheer = h(doc, 'div', { class: 'card-cheer', hidden: true })),
    (r.progress = h(doc, 'div', { class: 'card-progress' },
      // 头一行：左「工时进度」，右倒数（M4）；没有进度条的状态，倒数 / 说明单独一行放在 countdownSlot
      (r.progressHead = h(doc, 'div', { class: 'card-progress-head' },
        (r.progressTitle = h(doc, 'span', { class: 'card-progress-title', text: c.progressLabel })),
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
    (r.metrics = h(doc, 'div', { class: 'card-metrics' },
      metric('metric-rate', c.rate),
      metric('metric-month', c.month, '', true),
      metric('metric-hourly', c.hourly),
      metric('metric-daily', c.dailyFull))),
    (r.payday = h(doc, 'div', { class: 'card-payday', hidden: true })),
    (r.year = h(doc, 'div', { class: 'card-year', hidden: true })),
  );
  root.classList.add('status-card');
  r.iconTone = null;
  r.t = t;
  // 轮播状态：计时器 / 动画 / 世代都随卡片节点存续，切 PiP 只换它们所属的 window
  r.cheerWin = cheerHost(root);
  r.cheerLines = null;
  r.cheerOn = null;
  r.cheerIndex = 0;
  r.cheerGen = 0;
  r.cheerTimer = null;
  r.cheerTimerWin = null;
  r.cheerAnim = null;
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

// 不随 tick 变化的静态文字（币别、按钮与进度条的 aria-label、指标格标题）：切换地区时原地更新，
// 不重建卡片（重建会丢焦点、动到数字格状态，PiP 里的也是同一个节点）
function applyStatic(r, t) {
  const c = t.card;
  if (r.cur.data !== cardCurrency(t)) r.cur.data = cardCurrency(t);
  r.gear.setAttribute('aria-label', c.gear);
  if (r.gear.title !== c.gear) r.gear.title = c.gear;
  r.bar.setAttribute('aria-label', c.progressLabel);
  setText(r.progressTitle, c.progressLabel);
  setText(r['metric-rate-label'], c.rate);
  setText(r['metric-month-label'], c.month);
  setText(r['metric-hourly-label'], c.hourly);
  setText(r['metric-daily-label'], c.dailyFull);
  r.t = t;
}

// 主金额放不下时缩一点（CSS 只有 --hero-fit 这一个扣扳机）：字号档位、容器宽度与金额形状一起定，量一次就够。
// 签名把数字全换成 0 —— 数字格等宽，金额每 tick 跳动（194.28→194.29）形状没变，不必重量；
// 位数变了、换了地区（币别不同）、视窗或字号档位变了才重新量。
// 数字格的宽是 digits.js 量出来的 px（--digit-w），所以缩放比例一改就得重画一次数字格，
// 否则格子还是旧字号的宽度，金额既不会真的变窄、也会看起来字距过大。
function fitHero(r, cfg, redraw) {
  const el = r.amount;
  if (!el || el.hidden) return;
  const rects = el.getClientRects?.();
  if (!rects || rects.length === 0) return; // 还没排版 / 卡片在别处：下一次 tick 再量
  const avail = el.clientWidth;
  if (!avail) return;
  const sig = `${el.textContent.replace(/[0-9]/g, '0')}|${avail}|${cfg.fontScale ?? 'm'}`;
  if (r.heroFitSig === sig) return;
  const set = (v) => {
    r.heroFit = v;
    if (v === null) el.style.removeProperty('--hero-fit');
    else el.style.setProperty('--hero-fit', String(v));
  };
  // 留 2% 余量：数字格取整后常会差不到 1px，贴着边反而更容易溢出
  const shrink = (ratio) => Math.max(0.6, Math.round(ratio * 100 - 2) / 100);
  set(null);
  redraw();
  const need = el.scrollWidth;
  if (need > avail + 0.5) {
    set(shrink(avail / need));
    redraw();
    const after = el.scrollWidth;
    if (after > avail + 0.5) {
      // 数字格按新字号重新取整后仍差一点：按实测量的比例再收一次（只影响字形宽度，一次就够）
      set(shrink((r.heroFit * avail) / after));
      redraw();
    }
  }
  // 只有实际量到放得下才记住签名；仍溢出（字体或数字格宽度可能尚未稳定）就清掉，让下一次 tick 重量，
  // 否则错误的缩放会被签名锁住，直到文字位数或视窗变化才重算
  r.heroFitSig = el.scrollWidth <= avail + 0.5 ? sig : null;
}

export function renderCard(root, snap, cfg, t) {
  const r = built.get(root) ?? build(root, t);
  if (r.t !== t) applyStatic(r, t);
  const m = cardModel(snap, cfg, t);
  const doc = root.ownerDocument;

  // 显示开关（画面设置）：只有明确的 false 才隐藏——旧备份缺这些字段时保持原来的样子。
  // 同时写进 data-show-* 属性，样式与 e2e 都能直接读，不必靠隐藏后的高度去猜。
  const flags = {
    progress: cfg.showCardProgress !== false,
    metrics: cfg.showCardMetrics !== false,
    date: cfg.showCardDate !== false,
    payday: cfg.showCardPayday !== false,
    cheer: cfg.showCardCheer !== false,
  };
  for (const [k, on] of Object.entries(flags)) {
    const next = on ? 'true' : 'false';
    if (root.dataset[`show${k[0].toUpperCase()}${k.slice(1)}`] !== next) {
      root.dataset[`show${k[0].toUpperCase()}${k.slice(1)}`] = next;
    }
  }

  if (root.dataset.tone !== m.tone) root.dataset.tone = m.tone;
  root.classList.toggle('is-settled', m.settled);

  // 「日期」只藏日期与农历这一组；状态标签（上班中 / 午休 / 已下班）永远在
  show(r.dateGroup, flags.date && snap.now instanceof Date);
  if (snap.now instanceof Date) setText(r.date, dateLine(snap.now, t));
  const lunar = flags.date && cfg.showLunar && snap.now instanceof Date ? lunarText(snap.now, t) : null;
  show(r.lunar, Boolean(lunar));
  setText(r.lunar, lunar?.full ?? '');
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

  // 多句鼓励语：只有在「显示开关打开 + 至少一句非空白」时才占位，隐藏时把节点整个收起（不留固定高度 / 空白行）。
  const cheerOn = flags.cheer && m.cheers.length > 0;
  show(r.cheer, cheerOn);
  syncCheer(root, r, cheerOn, m.cheers);

  // 进度条关掉时倒数仍要显示：把它挪到独立的 countdownSlot，而不是留在空的进度头里
  const progressVisible = flags.progress && m.showProgress;
  show(r.progress, progressVisible);
  r.fill.style.width = `${m.progressPct}%`;
  const now = String(m.progressPct);
  if (r.bar.getAttribute('aria-valuenow') !== now) r.bar.setAttribute('aria-valuenow', now);
  show(r.progressText, !m.progressInHead);
  renderDigits(r.progressText, m.progressText);
  setText(r.progressSr, m.progressText);
  show(r.done, m.progressInHead);
  setText(r.doneText, m.progressInHead ? m.progressText : '');
  // 有进度条：倒数在头一行右侧；没有：单独一行（同一个节点搬家，数字格状态不变）
  const home = progressVisible ? r.headSlot : r.countdownSlot;
  if (r.cdWrap.parentNode !== home) home.append(r.cdWrap);
  show(r.countdownSlot, !progressVisible && m.secondary !== '');
  show(r.countdown, m.secondary !== '');
  show(r.countdownSr, m.secondary !== '');
  renderDigits(r.cdGhost, t.durationWidest(m.secondary));
  renderDigits(r.countdown, m.secondary);
  setText(r.countdownSr, m.secondary);

  show(r.metrics, flags.metrics);
  setText(r['metric-rate-label'], m.rateLabel);
  setText(r['metric-rate'], m.rate);
  renderDigits(r['metric-month'], m.month);
  setText(r['metric-month-sr'], m.month);
  setText(r['metric-hourly'], m.hourly);
  setText(r['metric-daily'], m.daily);
  show(r['metric-daily-box'], m.showDaily);
  show(r['metric-hourly-box'], m.showHourly);

  show(r.payday, flags.payday && m.payday !== null);
  setText(r.payday, m.payday ?? '');
  show(r.year, m.yearNote !== null);
  setText(r.year, m.yearNote ?? '');
  r.year.title = m.yearTitle;
  // 主金额放不下就缩一点：数字格宽度随字号变，所以缩放后要重画（见 fitHero）
  fitHero(r, cfg, () => {
    renderDigits(r.head, m.hero.head);
    renderDigits(r.tail, m.hero.tail);
  });
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
  renderCard(g, ref, { ...cfg, cheers: [] }, t);
  const height = g.getBoundingClientRect().height;
  g.remove();
  if (height > 0) root.style.setProperty('--card-ref-h', `${height}px`);
  return height;
}
