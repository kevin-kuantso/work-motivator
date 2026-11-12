// 左栏状态卡下方的「悬浮成小窗」按钮（R38）、按钮下的说明（不支持的原因 / 悬浮时「请保持本页开启」）、
// 主分页占位卡，以及开 / 关小窗的状态同步。
// 小窗尺寸：宽度按字号档位，高度按内容（含时薪、今日满勤这些按内容出现的指标）；手动拉过的尺寸留给同档重开时使用。
// 切换字号时清除目标档位的旧尺寸，重设为该档默认；内容高度仍受 PIP_MAX_HEIGHT 限制。
// resizeTo 需要手势，浏览器可能静默拒绝：设完尺寸等一拍读回实际大小，确实放不下就如实说明（#float-size-note），
// 让使用者自己拉，而不是假装已经调好了。
import { isPipSupported, openFloat, measureSmallCard, pipWidth, pipHeight, pipFitsContent, PIP_MAX_HEIGHT } from '../pip.js';
import { h, setText, show } from './dom.js';
import { icon } from './icons.js';

export function createFloatControl(doc, initialT, { cardRoot, onOpen, onClose, onFail, getScale, getSize, rememberSize }) {
  const win = doc.defaultView;
  let t = initialT;
  let f = t.float;
  const supported = isPipSupported(win);
  let pipWin = null;
  let opening = false;
  let floating = false;
  let placeholderTitle = null;
  let placeholderNote = null;
  const scale = () => getScale?.() ?? 'm';
  const saved = (s) => getSize?.(s) ?? null;

  // 不支持：按钮停用 + 原因（黄字，常驻）；支持时悬浮中才显示「请保持本页开启」
  const note = h(doc, 'p', { class: 'float-note is-warn', id: 'float-note', hidden: supported, text: f.unsupported });
  const keepOpen = h(doc, 'p', { class: 'float-note', id: 'float-keep', hidden: true, text: f.keepOpen });
  // 尺寸提示（黄字）：浏览器拒绝了程序改窗口大小、内容又确实放不下时才出现（默认藏起来，不占版面）
  const sizeNote = h(doc, 'p', { class: 'float-note is-warn', id: 'float-size-note', role: 'status', hidden: true, text: f.sizeLimited });
  const label = h(doc, 'span', { class: 'float-label', text: t.header.float });
  // 不支持：aria-disabled（不用原生 disabled），按钮仍可聚焦、读屏读得到原因（R52）；按下什么都不做
  const button = h(doc, 'button', {
    type: 'button', class: 'btn btn-primary float-btn', id: 'btn-float',
    'aria-disabled': supported ? undefined : 'true', 'aria-describedby': supported ? undefined : 'float-note',
    onclick: () => { if (supported) toggle(); },
  }, icon(doc, 'pip'), label);
  // 整张占位卡是一个按钮；不显示金额，避免两处同时跳动与重复朗读（design §4.4）
  // 可访问名称 = 「已悬浮 · 点此收回」；说明作为描述
  const placeholder = h(doc, 'button', {
    type: 'button', class: 'pip-placeholder', hidden: true, onclick: close,
    'aria-labelledby': 'pip-placeholder-title', 'aria-describedby': 'pip-placeholder-note',
  },
  icon(doc, 'pip'),
  (placeholderTitle = h(doc, 'span', { class: 'pip-placeholder-title', id: 'pip-placeholder-title', text: f.placeholder })),
  (placeholderNote = h(doc, 'span', { class: 'pip-placeholder-note', id: 'pip-placeholder-note', text: f.placeholderNote })));
  const el = h(doc, 'div', { class: 'float-control' }, button, note, keepOpen, sizeNote);

  function toggle() {
    if (pipWin) close();
    else open();
  }

  // 按钮的描述 = 「请保持本页开启」（悬浮中）+ 放不下时的尺寸提示，两者都只在真的显示时才挂上去。
  // 不支持时按钮的 aria-describedby 是建的时候就写死的 float-note，别覆盖。
  function syncButtonDesc() {
    if (!supported) return;
    if (!floating) {
      button.removeAttribute('aria-describedby');
      return;
    }
    button.setAttribute('aria-describedby', sizeNote.hidden ? 'float-keep' : 'float-keep float-size-note');
  }

  function setSizeNote(on) {
    show(sizeNote, on);
    syncButtonDesc();
  }

  // 这行提示只说明一件事：「我们请浏览器调大小，浏览器没答应，内容确实放不下」。
  // 所以只有 syncSize 的确认能把它打开；这里只负责在已经在提示时复核、能放得下就收掉
  // （使用者把窗口拉大、内容变矮）。内容变高 / 使用者自己拉小都不该凭空冒出这行字。
  function refreshSizeNote() {
    if (sizeNote.hidden) return;
    setSizeNote(pipFitsContent(pipWin) === false);
  }

  // syncSize 的确认：设完尺寸等一拍，内容确实还放不下就是「浏览器没让我们调」，如实说明；
  // 放得下就撤掉。读不到（null）不表态，免得把没验证过的事说成失败。
  function confirmSizeNote(w) {
    const fits = pipFitsContent(w);
    if (fits === null) return;
    setSizeNote(!fits);
  }

  function setFloating(on) {
    floating = on;
    setText(label, on ? f.recall : t.header.float);
    show(keepOpen, on);
    if (!on) {
      cancelSizeCheck();
      setSizeNote(false);
    }
    syncButtonDesc();
  }

  // 卡片在主分页时该有的高度（R52）：悬浮中卡片在小窗里，用一份不可见的复本在占位位置量（同步，不会绘制）
  function liveCardHeight() {
    if (cardRoot.ownerDocument === doc && cardRoot.isConnected) return cardRoot.offsetHeight;
    const slot = placeholder.parentNode;
    if (!slot) return 0;
    const clone = cardRoot.cloneNode(true);
    for (const el of [clone, ...clone.querySelectorAll('[id]')]) el.removeAttribute('id');
    clone.dataset.size = 'lg';
    clone.setAttribute('aria-hidden', 'true');
    clone.style.cssText = 'position:absolute;visibility:hidden;left:0;top:0;width:100%';
    slot.append(clone);
    const height = clone.offsetHeight;
    clone.remove();
    return height;
  }
  function syncPlaceholder() {
    if (!pipWin) return;
    placeholder.style.minHeight = `${liveCardHeight()}px`;
  }
  win.addEventListener('resize', syncPlaceholder);
  // 只在相同寬度下的自然內容高度變化時適配，手動拖曳不視為內容變化。
  let cardObserver = null;
  let measured = null;
  function contentMeasure(pip) {
    const width = pip.innerWidth;
    if (!Number.isFinite(width) || width <= 0) return null;
    return { width, height: Math.ceil(measureSmallCard(cardRoot, width)) };
  }
  function watchCard(pip) {
    const RO = pip?.ResizeObserver ?? win.ResizeObserver;
    if (typeof RO !== 'function') return;
    measured = contentMeasure(pip);
    cardObserver = new RO(() => {
      syncPlaceholder();
      refreshSizeNote();
      const next = contentMeasure(pip);
      const changed = next && measured && next.width === measured.width && next.height !== measured.height;
      measured = next;
      if (changed && !programmatic) syncSize({ fit: true });
    });
    cardObserver.observe(cardRoot);
    for (const child of cardRoot.children) cardObserver.observe(child);
  }

  // 顯示開關適配目前視窗寬度；一般開窗／字級變更沿用各檔記憶寬度。
  function targetSize(fit = false) {
    const s = scale();
    const keep = saved(s);
    const width = fit && Number.isFinite(pipWin?.innerWidth) && pipWin.innerWidth > 0
      ? Math.round(pipWin.innerWidth)
      : Math.max(pipWidth(s), Number.isFinite(keep?.width) ? keep.width : 0);
    const natural = measureSmallCard(cardRoot, width);
    const content = pipHeight(natural);
    if (fit) measured = { width, height: Math.ceil(natural) };
    const height = !fit && keep && keep.height > content ? Math.min(PIP_MAX_HEIGHT, pipHeight(keep.height)) : content;
    return { width, height };
  }

  async function open() {
    if (opening) return;
    opening = true;
    const placeholderHeight = cardRoot.offsetHeight; // 占位卡高度 = 大卡片在主分页时的样子（与尺寸无关）
    const { width, height } = targetSize();
    let w;
    try {
      w = await openFloat(win, cardRoot, restored, { width, height });
    } catch {
      opening = false;
      onFail();
      return;
    }
    opening = false;
    pipWin = w;
    placeholder.style.minHeight = `${placeholderHeight}px`;
    show(placeholder, true);
    setFloating(true);
    watchCard(w);
    watchSize(w);
    onOpen(w);
  }

  // 使用者自己拉窗口（不是我们程序设的尺寸）：按当前档位记住，下次开窗沿用。
  // Document PiP 的窗口属性在多数实现上是只读的，所以「记住」只影响下一次开窗的 requestWindow。
  let programmatic = false;
  let programmaticTimer = null;
  let rememberTimer = null;
  function watchSize(w) {
    w.addEventListener('resize', () => {
      if (programmatic || !Number.isFinite(w.innerWidth) || w.innerWidth <= 0) return;
      measured = contentMeasure(w);
      // 拖动窗口会连续派发 resize：停下来 250 ms 再写一次，别把每次移动都变成一次储存写入
      clearTimeout(rememberTimer);
      rememberTimer = win.setTimeout(() => {
        rememberSize?.(scale(), { width: Math.round(w.innerWidth), height: Math.round(w.innerHeight) });
        refreshSizeNote(); // 使用者自己把窗口拉大了：放得下就把黄色提示收掉
      }, 250);
    });
  }

  // 字号档位 / 内容改了：小窗开着就同步一次尺寸。
  // resizeTo 需要使用者手势，浏览器可能静默拒绝（不抛异常、也没有返回值）：设完尺寸读回实际大小，
  // 确实放不下就如实说明（#float-size-note），让使用者自己拉；放得下 / 读不到就撤掉提示，不假装。
  let sizeTimer = null;
  function cancelSizeCheck() {
    if (sizeTimer === null) return;
    clearTimeout(sizeTimer);
    sizeTimer = null;
  }

  function syncSize({ fit = false } = {}) {
    if (!pipWin) return;
    clearTimeout(rememberTimer);
    rememberTimer = null;
    const w = pipWin;
    const { width, height } = targetSize(fit);
    placeholder.style.minHeight = `${liveCardHeight()}px`;
    cancelSizeCheck();
    programmatic = true;
    try {
      w.resizeTo?.(width, height);
    } catch {
      // 浏览器拒绝或没有 resizeTo：维持原尺寸，下面按读回的实际大小决定要不要说明
    }
    clearTimeout(programmaticTimer);
    // 计时器一律挂主视窗：小窗自己的计时器只有「减少动态」对齐整秒那一个，e2e 与真实行为都不该多出别的
    programmaticTimer = win.setTimeout(() => { programmatic = false; }, 350);
    // 先同步读回一次：已经放得下就立刻撤掉旧提示（换字号时不闪黄字）。放不下先别喊，等下面那一拍确认——
    // 真实浏览器的尺寸变更可能滞后，同步这一瞬间的读数不作数。
    if (pipFitsContent(w) === true) setSizeNote(false);
    // 再等一拍确认：拒绝是静默的，此时窗口没变、内容要卷动才看得全，只能请使用者自己拉大。
    // 计时器挂在主视窗上（不是小窗）：不干扰小窗自己的对齐计时，关闭后也不会留下东西。
    sizeTimer = win.setTimeout(() => {
      sizeTimer = null;
      if (pipWin !== w) return; // 期间已经收回 / 重开
      if (fit && pipFitsContent(w) === true && Math.abs(w.innerHeight - height) <= 2) {
        rememberSize?.(scale(), { width: Math.round(w.innerWidth), height: Math.round(w.innerHeight) });
      }
      confirmSizeNote(w);
    }, 200);
  }

  // pagehide 时调用（按 X、占位卡、按钮、齿轮都走这里）
  function restored() {
    const refocus = doc.activeElement === placeholder;
    cardObserver?.disconnect();
    measured = null;
    cardObserver = null;
    clearTimeout(programmaticTimer);
    programmaticTimer = null;
    clearTimeout(rememberTimer);
    rememberTimer = null;
    cancelSizeCheck();
    programmatic = false;
    pipWin = null;
    show(placeholder, false);
    setFloating(false);
    if (refocus) button.focus();
    onClose();
  }

  function close() {
    pipWin?.close();
  }

  // 切换地区：只换文字（按钮名称、说明、不支持的原因、尺寸提示、占位卡），按钮与占位状态原样保留
  function setProfile(nextT) {
    if (nextT === t) return;
    t = nextT;
    f = t.float;
    setText(note, f.unsupported);
    setText(keepOpen, f.keepOpen);
    setText(sizeNote, f.sizeLimited);
    setText(label, floating ? f.recall : t.header.float);
    setText(placeholderTitle, f.placeholder);
    setText(placeholderNote, f.placeholderNote);
  }

  return { el, button, placeholder, close, setProfile, syncSize, pipWindow: () => pipWin };
}
