// 懸浮小窗：Document Picture-in-Picture（Chrome / Edge 116+）。
// 只負責視窗本身：開窗、複製樣式、把狀態卡移進去，關閉（pagehide，含按 X 與程式 close()）時移回。
// 計時與介面狀態由呼叫方處理。
// 寬度按全域性字號檔位給（字大一點窗就寬一點，卡片內容不會先被擠扁）；高度隨內容（spec §4.2）。
// resizeTo 需要使用者手勢，所以開窗前就要算好尺寸。
export const PIP_WIDTH = 340; // = m 檔，既有行為不變
export const PIP_MIN_HEIGHT = 200;
// 小窗裡最多四行指標 + 鼓勵語 + 發薪日 + 缺表說明；xl 檔（字號 1.2 倍）比 m 檔高約兩成，
// 520 會把這幾種內容疊在一起時的下半截裁掉，所以放寬到 640。
export const PIP_MAX_HEIGHT = 640;
// 檔位 → 視窗寬度：每個數字格都以 em 計，寬度跟著字號線性放大一點就夠（xl 比 m 寬 32px）
export const PIP_WIDTHS = Object.freeze({ xs: 320, s: 330, m: PIP_WIDTH, l: 356, xl: 372 });

// 未知 / 預設檔位一律走 m：舊備份沒有 fontScale 時視窗尺寸與以前一致
export function pipWidth(fontScale) {
  return PIP_WIDTHS[fontScale] ?? PIP_WIDTH;
}

export function pipHeight(measured) {
  if (!Number.isFinite(measured)) return PIP_MIN_HEIGHT;
  return Math.min(PIP_MAX_HEIGHT, Math.max(PIP_MIN_HEIGHT, Math.ceil(measured)));
}

// 同步量出狀態卡在小窗裡（data-size=sm、給定寬度）的高度，量完立即還原；中間不會繪製。
// 小窗的 body 無邊距、卡片是 body 唯一子元素，所以卡片高度即所需視口高度。
// 三處會汙染測量，量之前都要臨時改掉，量完原樣還原：
//   1. 大卡片形態帶 min-height（--card-ref-h）→ 歸零，否則會量到主分頁的最小高度；
//   2. 寬度由我們自己定 → 寫成目標寬度，字號 / 換行才和小窗裡一致；
//   3. .pip-body 是 min-height:100vh 的 grid，卡片在小窗裡會被拉滿整個視口（stretch）→ align-self:start，
//      否則量出來的永遠是「當前視口高度」，字號換檔後窗口只會停在原高度（內容被裁）。
// 用 try/finally 還原：萬一期間有異常，卡片也不會卡在測量用的臨時樣式裡。
export function measureSmallCard(cardRoot, width = PIP_WIDTH) {
  const { size } = cardRoot.dataset;
  const prev = { width: cardRoot.style.width, minHeight: cardRoot.style.minHeight, alignSelf: cardRoot.style.alignSelf };
  try {
    cardRoot.dataset.size = 'sm';
    cardRoot.style.alignSelf = 'start';
    cardRoot.style.width = `${width}px`;
    cardRoot.style.minHeight = '0';
    return cardRoot.getBoundingClientRect().height;
  } finally {
    if (size === undefined) delete cardRoot.dataset.size;
    else cardRoot.dataset.size = size;
    cardRoot.style.width = prev.width;
    cardRoot.style.minHeight = prev.minHeight;
    cardRoot.style.alignSelf = prev.alignSelf;
  }
}

// 只讀檢查：小窗裡的內容現在還需不需要捲動（resizeTo 被瀏覽器靜默拒絕時，這是我們唯一能讀到的事實）。1px 容差吃掉亞畫素 / 取整誤差。
// about:blank 是 quirks 模式，捲動元素可能是 body，所以用 scrollingElement。
export function pipFitsContent(win) {
  const doc = win?.document;
  const se = doc?.scrollingElement ?? doc?.documentElement;
  if (!se) return null;
  const scroll = se.scrollHeight;
  const client = se.clientHeight;
  if (!Number.isFinite(scroll) || !Number.isFinite(client) || client <= 0) return null;
  return scroll <= client + 1;
}

// 功能偵測（不比對 UA）。API 只在安全上下文暴露，非安全上下文下這裡自然為 false。
export function isPipSupported(win) {
  const dp = win && 'documentPictureInPicture' in win ? win.documentPictureInPicture : null;
  return Boolean(dp && typeof dp.requestWindow === 'function');
}

// 語言 / 主題 / 標題 / 字號檔位：開窗時隨樣式一起復制；切換地區、主題或字號時再單獨同步一次（不重抄樣式）。
export function syncDocumentLook(from, to) {
  if (!from || !to) return;
  to.documentElement.lang = from.documentElement.lang;
  const theme = from.documentElement.dataset.theme ?? '';
  if (theme) to.documentElement.dataset.theme = theme;
  else delete to.documentElement.dataset.theme;
  const scale = from.documentElement.dataset.fontScale ?? '';
  if (scale) to.documentElement.dataset.fontScale = scale;
  else delete to.documentElement.dataset.fontScale;
  to.title = from.title;
}

// 成品的 CSS 內聯在 <style> 裡：直接複製文字，比逐條複製 cssRules 更不會漏掉瀏覽器暫不認識的規則。
export function copyDocumentLook(from, to) {
  syncDocumentLook(from, to);
  for (const s of from.querySelectorAll('style')) {
    const el = to.createElement('style');
    el.textContent = s.textContent;
    to.head.append(el);
  }
  to.body.classList.add('pip-body');
}

// requestWindow 必須在使用者手勢內呼叫：這是本函式第一個 await，呼叫方須直接在 click 中呼叫。
// width / height 由呼叫方給（按當前字號檔位與記住的視窗尺寸算好）；省略時退回 m 檔的實測高度。
export async function openFloat(win, cardRoot, onClose, { width = PIP_WIDTH, height = null } = {}) {
  const h = height ?? pipHeight(measureSmallCard(cardRoot, width)); // 同步，在 await 之前，不會丟失手勢
  const pipWin = await win.documentPictureInPicture.requestWindow({ width, height: h });
  const home = cardRoot.parentNode;
  const next = cardRoot.nextSibling;
  const size = cardRoot.dataset.size;
  copyDocumentLook(win.document, pipWin.document);
  cardRoot.dataset.size = 'sm';
  pipWin.document.body.append(cardRoot);

  pipWin.addEventListener('pagehide', () => {
    cardRoot.dataset.size = size;
    home.insertBefore(cardRoot, next && next.parentNode === home ? next : null);
    onClose();
  }, { once: true });
  return pipWin;
}
