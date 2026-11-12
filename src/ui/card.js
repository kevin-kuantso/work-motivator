// 狀態卡 StatusCard：主分頁與 PiP 共用。只用 root.ownerDocument 建立節點（不依賴全域 document）。
// 結構只建一次（按 root 記住），之後每次 tick 只更新文字，避免閃爍與焦點丟失。
// 每 tick 變化的數字（主金額、本月累計、進度、倒數）畫成固定寬度數字格（digits.js，R33）：
// 數字格本身 aria-hidden，旁邊一個看不見的 .sr-text 放完整文字給讀屏（不會逐個數字念）。
import { h, setText, show } from './dom.js';
import { icon } from './icons.js';
import { cardModel } from './card-model.js';
import { dateLine, lunarText } from './format.js';
import { renderDigits } from './digits.js';

const built = new WeakMap();
// 幣別與數字之間留一個空格（設計與 e2e 的「¥ 323.81」）；各地區符號本身的間距由 profile 決定
const cardCurrency = (t) => `${t.currency} `;
const CELEBRATE_MS = 1200; // 與 style.css 的 .is-celebrating 動畫時長一致
const CELEBRATE_GAP_MS = 5000; // 距上次繪製超過這麼久（睡眠 / 後臺暫停）就不算「當場收工」
// 多句鼓勵語輪播：每句停留約 8 秒，切換時柔和淡出 → 換字 → 淡入（Web Animations API，不改樣式表）。
// 卡片上永遠只有一個 .card-cheer 文位元組點，且樣式是單行省略，所以句子長短不影響卡片 / 小窗高度。
const CHEER_ROTATE_MS = 8000;
const CHEER_FADE_OUT_MS = 260;
const CHEER_FADE_IN_MS = 420;

const cheerHost = (root) => root.ownerDocument.defaultView ?? null;
const cheerReduced = (root) => Boolean(cheerHost(root)?.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

// 計時器一律掛在「當前所在文件」的 window 上（卡片會搬進 / 搬出 PiP），並記住是哪個 window 排的，
// 清理時用同一個 window 取消，避免搬家後留下孤兒計時器。
function clearCheerTimer(r) {
  if (r.cheerTimer !== null && r.cheerTimer !== undefined) {
    try { r.cheerTimerWin?.clearTimeout(r.cheerTimer); } catch { /* 舊文件已銷燬 */ }
    r.cheerTimer = null;
    r.cheerTimerWin = null;
  }
}

// 取消正在跑的淡入淡出：cancel() 會去掉 fill 的效果，opacity 自動回到樣式預設的 1，不會卡在中間值。
function cancelCheerAnim(r) {
  if (r.cheerAnim) {
    try { r.cheerAnim.cancel(); } catch { /* 舊文件已銷燬 */ }
    r.cheerAnim = null;
  }
}

// 停掉輪播：世代 +1 讓所有在途回撥失效（含已排隊但還沒跑的），再清計時器與動畫。
// 本來就沒在跑時不動世代號，避免每秒重畫都把計數推高。
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
    if (gen !== (r.cheerGen ?? 0)) return; // 已停 / 已換文件：舊結果直接丟棄
    fn();
  }, ms);
}

function paintCheer(r) {
  const text = r.cheerLines?.[r.cheerIndex] ?? '';
  setText(r.cheer, text);
  if (r.cheer.title !== text) r.cheer.title = text;
}

// 淡入 / 淡出一律走這裡：瀏覽器不支援 WAAPI（或 animate 拋錯）時回傳 null，呼叫方退回「直接換字」。
function fadeCheer(el, from, to, ms, easing) {
  if (typeof el.animate !== 'function') return null;
  try {
    return el.animate([{ opacity: from }, { opacity: to }], { duration: ms, easing, fill: 'forwards' });
  } catch {
    return null; // 舊文件已銷燬 / 動畫被停用：不做動畫，字照樣換
  }
}

function rotateCheer(root, r) {
  const lines = r.cheerLines;
  if (!lines || lines.length < 2 || r.cheer.hidden) return;
  if (!root.isConnected) { stopCheer(r); return; }
  // 頁面在後臺不推進，也不再排下一輪：後臺裡瀏覽器本來就會節流計時器，重排只是白醒。
  // 回到前臺後由下一次繪製重新排隊（armCheer 的前臺條件），節奏從那時重新起算。
  if (root.ownerDocument.visibilityState === 'hidden') return;
  const next = (r.cheerIndex + 1) % lines.length;
  const settle = () => {
    cancelCheerAnim(r);
    afterCheer(root, r, CHEER_ROTATE_MS - CHEER_FADE_OUT_MS - CHEER_FADE_IN_MS, () => rotateCheer(root, r));
  };
  // 沒有動畫可做（減少動態 / 不支援 / 拋錯）：直接換句，節奏不變
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
    // 計時器排隊之後卡片可能被移除（PiP 收回 / 整卡替換）：先確認還在文件裡，
    // 否則會在一個已經拿掉的節點上繼續換字並排下一輪，永遠停不下來。
    if (!root.isConnected) { stopCheer(r); return; }
    // 先換字再決定下一步：淡出已在 0，取消舊動畫也不會閃一幀全亮
    const out = r.cheerAnim;
    r.cheerAnim = null;
    r.cheerIndex = next;
    paintCheer(r);
    // 淡出途中使用者改成「減少動態」：這一句直接定住，不再淡入
    if (cheerReduced(root)) {
      if (out) { try { out.cancel(); } catch { /* 舊文件已銷燬 */ } }
      afterCheer(root, r, CHEER_ROTATE_MS - CHEER_FADE_OUT_MS, () => rotateCheer(root, r));
      return;
    }
    const anim = fadeCheer(r.cheer, 0, 1, CHEER_FADE_IN_MS, 'ease-out');
    if (out) { try { out.cancel(); } catch { /* 舊文件已銷燬 */ } }
    // 淡入動畫建不起來：此時 opacity 已回到 1（舊動畫被取消），直接按「已淡入」收尾
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

// 每次繪製都調：只有「該輪播、確實沒跑、且頁面在前臺」時才排一輪，所以每秒重畫不會重置節奏，
// 後臺也不會每隔 8 秒白醒一次（回前臺後的第一次繪製再排）。
function armCheer(root, r) {
  const needed = !r.cheer.hidden && (r.cheerLines?.length ?? 0) > 1 && root.isConnected
    && root.ownerDocument.visibilityState !== 'hidden';
  if (!needed) { stopCheer(r); return; }
  if (r.cheerTimer !== null) return;
  afterCheer(root, r, CHEER_ROTATE_MS, () => rotateCheer(root, r));
}

// 每 100 ms 都會進這裡：不做字串拼接，逐項比較就夠（句子最多幾十個）。
function sameLines(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// 每次繪製都調：句子集合、顯示開關或所在視窗變了才重排；否則只保證計時器仍在跑（每秒重畫不會重置節奏）。
function syncCheer(root, r, on, lines) {
  const win = cheerHost(root);
  if (r.cheerWin !== win) {
    // 卡片被搬進 / 搬出 PiP：舊視窗的計時器必須先停，否則會在原視窗繼續跑；
    // 新文件裡的節點要重畫一遍文字，所以把它當成「狀態未知」。
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
      // 幣別單獨一個文位元組點：切換地區時只改這一段，不動數字格（digits.js 的節點保持不變）
      (r.cur = doc.createTextNode(cardCurrency(t))),
      (r.head = h(doc, 'span', { class: 'amount-head digits' })),
      (r.tail = h(doc, 'span', { class: 'amount-tail digits' })))),
    (r.amountSr = sr()),
    (r.cheer = h(doc, 'div', { class: 'card-cheer', hidden: true })),
    (r.progress = h(doc, 'div', { class: 'card-progress' },
      // 頭一行：左「工時進度」，右倒數（M4）；沒有進度條的狀態，倒數 / 說明單獨一行放在 countdownSlot
      (r.progressHead = h(doc, 'div', { class: 'card-progress-head' },
        (r.progressTitle = h(doc, 'span', { class: 'card-progress-title', text: c.progressLabel })),
        (r.headSlot = h(doc, 'span', { class: 'card-progress-aside' },
          // 已下班：✓ 今天工作滿 7小時（進度頭一行右側）
          (r.done = h(doc, 'span', { class: 'card-done', hidden: true }, icon(doc, 'check'), (r.doneText = h(doc, 'span', { class: 'card-done-text' })))))))),
      r.bar,
      (r.progressText = h(doc, 'div', { class: 'card-progress-text digits', 'aria-hidden': 'true' })),
      (r.progressSr = sr()))),
    (r.countdownSlot = h(doc, 'div', { class: 'card-countdown-slot' },
      // 倒數外面一層：隱藏的「佔位文本」（分、秒補成 88）與真實文字疊在同一格，真實文字靠左。
      // 格子寬度恆定 = 最寬形態，「距下班」不會在 10秒→9秒、0秒→59秒 時左右跳（R33）
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
  // 輪播狀態：計時器 / 動畫 / 世代都隨卡片節點存續，切 PiP 只換它們所屬的 window
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

// 收工當下（直播狀態由上班中 / 午休轉入已下班）金額淡綠高亮一次：不是載入時就已下班，也不是睡眠醒來；
// 減少動態時完全不加類。用每次繪製時的時鐘判斷何時移除（不依賴計時器，主窗 / PiP 都適用）。
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

// 不隨 tick 變化的靜態文字（幣別、按鈕與進度條的 aria-label、指標格標題）：切換地區時原地更新，
// 不重建卡片（重建會丟焦點、動到數字格狀態，PiP 裡的也是同一個節點）
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

// 主金額放不下時縮一點（CSS 只有 --hero-fit 這一個扣扳機）：字號檔位、容器寬度與金額形狀一起定，量一次就夠。
// 簽名把數字全換成 0 —— 數字格等寬，金額每 tick 跳動（194.28→194.29）形狀沒變，不必重量；
// 位數變了、換了地區（幣別不同）、視窗或字號檔位變了才重新量。
// 數字格的寬是 digits.js 量出來的 px（--digit-w），所以縮放比例一改就得重畫一次數字格，
// 否則格子還是舊字號的寬度，金額既不會真的變窄、也會看起來字距過大。
function fitHero(r, cfg, redraw) {
  const el = r.amount;
  if (!el || el.hidden) return;
  const rects = el.getClientRects?.();
  if (!rects || rects.length === 0) return; // 還沒排版 / 卡片在別處：下一次 tick 再量
  const avail = el.clientWidth;
  if (!avail) return;
  const sig = `${el.textContent.replace(/[0-9]/g, '0')}|${avail}|${cfg.fontScale ?? 'm'}`;
  if (r.heroFitSig === sig) return;
  const set = (v) => {
    r.heroFit = v;
    if (v === null) el.style.removeProperty('--hero-fit');
    else el.style.setProperty('--hero-fit', String(v));
  };
  // 留 2% 餘量：數字格取整後常會差不到 1px，貼著邊反而更容易溢位
  const shrink = (ratio) => Math.max(0.6, Math.round(ratio * 100 - 2) / 100);
  set(null);
  redraw();
  const need = el.scrollWidth;
  if (need > avail + 0.5) {
    set(shrink(avail / need));
    redraw();
    const after = el.scrollWidth;
    if (after > avail + 0.5) {
      // 數字格按新字號重新取整後仍差一點：按實測量的比例再收一次（隻影響字形寬度，一次就夠）
      set(shrink((r.heroFit * avail) / after));
      redraw();
    }
  }
  // 只有實際量到放得下才記住簽名；仍溢位（字型或數字格寬度可能尚未穩定）就清掉，讓下一次 tick 重量，
  // 否則錯誤的縮放會被簽名鎖住，直到文字位數或視窗變化才重算
  r.heroFitSig = el.scrollWidth <= avail + 0.5 ? sig : null;
}

export function renderCard(root, snap, cfg, t) {
  const r = built.get(root) ?? build(root, t);
  if (r.t !== t) applyStatic(r, t);
  const m = cardModel(snap, cfg, t);
  const doc = root.ownerDocument;

  // 顯示開關（畫面設定）：只有明確的 false 才隱藏——舊備份缺這些欄位時保持原來的樣子。
  // 同時寫進 data-show-* 屬性，樣式與 e2e 都能直接讀，不必靠隱藏後的高度去猜。
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

  // 「日期」只藏日期與農曆這一組；狀態標籤（上班中 / 午休 / 已下班）永遠在
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

  // 多句鼓勵語：只有在「顯示開關開啟 + 至少一句非空白」時才佔位，隱藏時把節點整個收起（不留固定高度 / 空白行）。
  const cheerOn = flags.cheer && m.cheers.length > 0;
  show(r.cheer, cheerOn);
  syncCheer(root, r, cheerOn, m.cheers);

  // 進度條關掉時倒數仍要顯示：把它挪到獨立的 countdownSlot，而不是留在空的進度頭裡
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
  // 有進度條：倒數在頭一行右側；沒有：單獨一行（同一個節點搬家，數字格狀態不變）
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
  // 主金額放不下就縮一點：數字格寬度隨字號變，所以縮放後要重畫（見 fitHero）
  fitHero(r, cfg, () => {
    renderDigits(r.head, m.hero.head);
    renderDigits(r.tail, m.hero.tail);
  });
  celebrate(root, r, snap, m);
  return m;
}

// 大卡片的最小高度 = 「上班中」那張卡的高度（M11 / V1），在執行時用真實字型量出，不寫死畫素：
// 在狀態卡旁邊放一張看不見的複本，用「上班中」的內容（無鼓勵語、發薪日、缺表標籤）畫一遍，量高度，寫成 --card-ref-h。
// 載入、視窗尺寸改變（含跨過 640px 矮視窗斷點）與字型載入後各量一次（app.js 控制時機）；卡片在小窗裡（sm）時不量。
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
