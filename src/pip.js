// 悬浮小窗：Document Picture-in-Picture（Chrome / Edge 116+）。
// 只负责视窗本身：开窗、复制样式、把状态卡移进去，关闭（pagehide，含按 X 与程序 close()）时移回。
// 计时与界面状态由调用方处理。
// 宽度按全局字号档位给（字大一点窗就宽一点，卡片内容不会先被挤扁）；高度随内容（spec §4.2）。
// resizeTo 需要使用者手势，所以开窗前就要算好尺寸。
export const PIP_WIDTH = 340; // = m 档，既有行为不变
export const PIP_MIN_HEIGHT = 200;
// 小窗里最多四行指标 + 鼓励语 + 发薪日 + 缺表说明；xl 档（字号 1.2 倍）比 m 档高约两成，
// 520 会把这几种内容叠在一起时的下半截裁掉，所以放宽到 640。
export const PIP_MAX_HEIGHT = 640;
// 档位 → 窗口宽度：每个数字格都以 em 计，宽度跟着字号线性放大一点就够（xl 比 m 宽 32px）
export const PIP_WIDTHS = Object.freeze({ xs: 320, s: 330, m: PIP_WIDTH, l: 356, xl: 372 });

// 未知 / 缺省档位一律走 m：旧备份没有 fontScale 时窗口尺寸与以前一致
export function pipWidth(fontScale) {
  return PIP_WIDTHS[fontScale] ?? PIP_WIDTH;
}

export function pipHeight(measured) {
  if (!Number.isFinite(measured)) return PIP_MIN_HEIGHT;
  return Math.min(PIP_MAX_HEIGHT, Math.max(PIP_MIN_HEIGHT, Math.ceil(measured)));
}

// 同步量出状态卡在小窗里（data-size=sm、给定宽度）的高度，量完立即还原；中间不会绘制。
// 小窗的 body 无边距、卡片是 body 唯一子元素，所以卡片高度即所需视口高度。
// 三处会污染测量，量之前都要临时改掉，量完原样还原：
//   1. 大卡片形态带 min-height（--card-ref-h）→ 归零，否则会量到主分页的最小高度；
//   2. 宽度由我们自己定 → 写成目标宽度，字号 / 换行才和小窗里一致；
//   3. .pip-body 是 min-height:100vh 的 grid，卡片在小窗里会被拉满整个视口（stretch）→ align-self:start，
//      否则量出来的永远是「当前视口高度」，字号换档后窗口只会停在原高度（内容被裁）。
// 用 try/finally 还原：万一期间有异常，卡片也不会卡在测量用的临时样式里。
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

// 只读检查：小窗里的内容现在还需不需要卷动（resizeTo 被浏览器静默拒绝时，这是我们唯一能读到的事实）。1px 容差吃掉亚像素 / 取整误差。
// about:blank 是 quirks 模式，卷动元素可能是 body，所以用 scrollingElement。
export function pipFitsContent(win) {
  const doc = win?.document;
  const se = doc?.scrollingElement ?? doc?.documentElement;
  if (!se) return null;
  const scroll = se.scrollHeight;
  const client = se.clientHeight;
  if (!Number.isFinite(scroll) || !Number.isFinite(client) || client <= 0) return null;
  return scroll <= client + 1;
}

// 功能侦测（不比对 UA）。API 只在安全上下文暴露，非安全上下文下这里自然为 false。
export function isPipSupported(win) {
  const dp = win && 'documentPictureInPicture' in win ? win.documentPictureInPicture : null;
  return Boolean(dp && typeof dp.requestWindow === 'function');
}

// 语言 / 主题 / 标题 / 字号档位：开窗时随样式一起复制；切换地区、主题或字号时再单独同步一次（不重抄样式）。
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

// 成品的 CSS 内联在 <style> 里：直接复制文字，比逐条复制 cssRules 更不会漏掉浏览器暂不认识的规则。
export function copyDocumentLook(from, to) {
  syncDocumentLook(from, to);
  for (const s of from.querySelectorAll('style')) {
    const el = to.createElement('style');
    el.textContent = s.textContent;
    to.head.append(el);
  }
  to.body.classList.add('pip-body');
}

// requestWindow 必须在使用者手势内调用：这是本函数第一个 await，调用方须直接在 click 中调用。
// width / height 由调用方给（按当前字号档位与记住的窗口尺寸算好）；省略时退回 m 档的实测高度。
export async function openFloat(win, cardRoot, onClose, { width = PIP_WIDTH, height = null } = {}) {
  const h = height ?? pipHeight(measureSmallCard(cardRoot, width)); // 同步，在 await 之前，不会丢失手势
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
