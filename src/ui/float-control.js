// 左欄狀態卡下方的「懸浮成小窗」按鈕（R38）、按鈕下的說明（不支援的原因 / 懸浮時「請保持本頁開啟」）、
// 主分頁佔位卡，以及開 / 關小窗的狀態同步。
// 小窗尺寸：寬度按字號檔位（手動拉過的寬度留給同檔重開）；一般更新保留手動高度，
// 只有內容區塊變動才回到自然高度。切換字號時清除目標檔位的舊尺寸，重設為該檔預設。
// resizeTo 需要手勢，瀏覽器可能靜默拒絕：設完尺寸等一拍讀回實際大小，確實放不下就如實說明（#float-size-note），
// 讓使用者自己拉，而不是假裝已經調好了。
import { isPipSupported, openFloat, measureSmallCard, pipWidth, pipMinWidth, pipHeight, pipFitsContent, PIP_MAX_HEIGHT } from '../pip.js';
import { h, setText, show } from './dom.js';
import { icon } from './icons.js';

export function createFloatControl(doc, initialT, { cardRoot, onOpen, onClose, onFail, onPreviewSize, getScale, getSize, rememberSize }) {
  const win = doc.defaultView;
  let t = initialT;
  let f = t.float;
  const supported = isPipSupported(win);
  let pipWin = null;
  let opening = false;
  let floating = false;
  let placeholderTitle = null;
  let placeholderNote = null;
  let preview = null;
  const scale = () => getScale?.() ?? 'm';
  const saved = (s) => getSize?.(s) ?? null;

  // 不支援：按鈕停用 + 原因（黃字，常駐）；支援時懸浮中才顯示「請保持本頁開啟」
  const note = h(doc, 'p', { class: 'float-note is-warn', id: 'float-note', hidden: supported, text: f.unsupported });
  const keepOpen = h(doc, 'p', { class: 'float-note', id: 'float-keep', hidden: true, text: f.keepOpen });
  // 尺寸提示（黃字）：瀏覽器拒絕了程式改視窗大小、內容又確實放不下時才出現（預設藏起來，不佔版面）
  const sizeNote = h(doc, 'p', { class: 'float-note is-warn', id: 'float-size-note', role: 'status', hidden: true, text: f.sizeLimited });
  const label = h(doc, 'span', { class: 'float-label', text: t.header.float });
  // 不支援：aria-disabled（不用原生 disabled），按鈕仍可聚焦、讀屏讀得到原因（R52）；按下什麼都不做
  const button = h(doc, 'button', {
    type: 'button', class: 'btn btn-primary float-btn', id: 'btn-float',
    'aria-disabled': supported ? undefined : 'true', 'aria-describedby': supported ? undefined : 'float-note',
    onclick: () => { if (supported) toggle(); },
  }, icon(doc, 'pip'), label);
  // 整張佔位卡是一個按鈕；不顯示金額，避免兩處同時跳動與重複朗讀（design §4.4）
  // 可訪問名稱 = 「已懸浮 · 點此收回」；說明作為描述
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

  // 按鈕的描述 = 「請保持本頁開啟」（懸浮中）+ 放不下時的尺寸提示，兩者都只在真的顯示時才掛上去。
  // 不支援時按鈕的 aria-describedby 是建的時候就寫死的 float-note，別覆蓋。
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

  // 這行提示只說明一件事：「我們請瀏覽器調大小，瀏覽器沒答應，內容確實放不下」。
  // 所以只有 syncSize 的確認能把它開啟；這裡只負責在已經在提示時複核、能放得下就收掉
  // （使用者把視窗拉大、內容變矮）。內容變高 / 使用者自己拉小都不該憑空冒出這行字。
  function refreshSizeNote() {
    if (sizeNote.hidden) return;
    setSizeNote(pipFitsContent(pipWin) === false);
  }

  // syncSize 的確認：設完尺寸等一拍，內容確實還放不下就是「瀏覽器沒讓我們調」，如實說明；
  // 放得下就撤掉。讀不到（null）不表態，免得把沒驗證過的事說成失敗。
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

  // 卡片在主分頁時該有的高度（R52）：懸浮中卡片在小窗裡，用一份不可見的複本在佔位位置量（同步，不會繪製）
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

  function syncPreview() {
    if (!pipWin) return;
    const next = cardRoot.cloneNode(true);
    next.classList.add('pip-preview');
    next.removeAttribute('id');
    next.setAttribute('aria-hidden', 'true');
    for (const el of next.querySelectorAll('[id], button, a, input, select, textarea, [tabindex], [role="status"], [aria-live]')) {
      if (el.matches('button, a, input, select, textarea, [tabindex]')) el.remove();
      else {
        el.removeAttribute('id');
        el.removeAttribute('role');
        el.removeAttribute('aria-live');
      }
    }
    const width = Math.round(pipWin.innerWidth);
    const height = Math.round(pipWin.innerHeight);
    if (Number.isFinite(width) && width > 0) next.style.width = `${width}px`;
    if (Number.isFinite(height) && height > 0) next.style.height = `${height}px`;
    preview?.replaceWith(next);
    if (!preview) placeholder.before(next);
    preview = next;
    onPreviewSize?.({ width, height });
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
      : Math.max(pipMinWidth(s), Number.isFinite(keep?.width) ? keep.width : pipWidth(s));
    const natural = measureSmallCard(cardRoot, width);
    const content = pipHeight(natural);
    if (fit) measured = { width, height: Math.ceil(natural) };
    // 一般 render / tick 尊重使用者手動高度；只有確實改變內容區塊（fit）時才回到自然高度。
    // 舊紀錄在 readSizes 已視為 manual:true，避免升級後把使用者的手動視窗壓回內容高度。
    const rememberedHeight = Number(keep?.height);
    const height = !fit && keep?.manual && Number.isFinite(rememberedHeight) && rememberedHeight > 0
      ? Math.round(rememberedHeight)
      : content;
    return { width, height };
  }

  async function open() {
    if (opening) return;
    opening = true;
    const placeholderHeight = cardRoot.offsetHeight; // 佔位卡高度 = 大卡片在主分頁時的樣子（與尺寸無關）
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
    syncPreview();
    setFloating(true);
    watchCard(w);
    watchSize(w);
    onOpen(w);
  }

  // 使用者自己拉視窗（不是我們程式設的尺寸）：按當前檔位記住，下次開窗沿用。
  // Document PiP 的視窗屬性在多數實現上是隻讀的，所以「記住」隻影響下一次開窗的 requestWindow。
  let programmatic = false;
  let programmaticTimer = null;
  let rememberTimer = null;
  function watchSize(w) {
    w.addEventListener('resize', () => {
      if (programmatic || !Number.isFinite(w.innerWidth) || w.innerWidth <= 0) return;
      measured = contentMeasure(w);
      // 拖動視窗會連續派發 resize：停下來 250 ms 再寫一次，別把每次移動都變成一次儲存寫入
      clearTimeout(rememberTimer);
      rememberTimer = win.setTimeout(() => {
        rememberSize?.(scale(), { width: Math.round(w.innerWidth), height: Math.round(w.innerHeight), manual: true });
        syncPreview();
        refreshSizeNote(); // 使用者自己把視窗拉大了：放得下就把黃色提示收掉
      }, 250);
    });
  }

  // 字號檔位 / 內容改了：小窗開著就同步一次尺寸。
  // resizeTo 需要使用者手勢，瀏覽器可能靜默拒絕（不拋異常、也沒有返回值）：設完尺寸讀回實際大小，
  // 確實放不下就如實說明（#float-size-note），讓使用者自己拉；放得下 / 讀不到就撤掉提示，不假裝。
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
    syncPreview();
    cancelSizeCheck();
    programmatic = true;
    try {
      w.resizeTo?.(width, height);
    } catch {
      // 瀏覽器拒絕或沒有 resizeTo：維持原尺寸，下面按讀回的實際大小決定要不要說明
    }
    clearTimeout(programmaticTimer);
    // 計時器一律掛主視窗：小窗自己的計時器只有「減少動態」對齊整秒那一個，e2e 與真實行為都不該多出別的
    programmaticTimer = win.setTimeout(() => { programmatic = false; }, 350);
    // 先同步讀回一次：已經放得下就立刻撤掉舊提示（換字號時不閃黃字）。放不下先別喊，等下面那一拍確認——
    // 真實瀏覽器的尺寸變更可能滯後，同步這一瞬間的讀數不作數。
    if (pipFitsContent(w) === true) setSizeNote(false);
    // 再等一拍確認：拒絕是靜默的，此時視窗沒變、內容要捲動才看得全，只能請使用者自己拉大。
    // 計時器掛在主視窗上（不是小窗）：不干擾小窗自己的對齊計時，關閉後也不會留下東西。
    sizeTimer = win.setTimeout(() => {
      sizeTimer = null;
      if (pipWin !== w) return; // 期間已經收回 / 重開
      if (fit && pipFitsContent(w) === true && Math.abs(w.innerHeight - height) <= 2) {
        rememberSize?.(scale(), { width: Math.round(w.innerWidth), height: Math.round(w.innerHeight), manual: false });
      }
      syncPreview();
      confirmSizeNote(w);
    }, 200);
  }

  // pagehide 時呼叫（按 X、佔位卡、按鈕、齒輪都走這裡）
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
    preview?.remove();
    preview = null;
    show(placeholder, false);
    setFloating(false);
    if (refocus) button.focus();
    onClose();
  }

  function close() {
    pipWin?.close();
  }

  // 切換地區：只換文字（按鈕名稱、說明、不支援的原因、尺寸提示、佔位卡），按鈕與佔位狀態原樣保留
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

  return { el, button, placeholder, close, setProfile, syncPreview, syncSize, pipWindow: () => pipWin };
}
