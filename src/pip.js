// 悬浮小窗：Document Picture-in-Picture（Chrome / Edge 116+）。
// 只负责视窗本身：开窗、复制样式、把状态卡移进去，关闭（pagehide，含按 X 与程序 close()）时移回。
// 计时与界面状态由调用方处理。
// 宽度固定 340；高度随内容（spec §4.2）。resizeTo 需要使用者手势，所以开窗前就要算好高度。
export const PIP_WIDTH = 340;
export const PIP_MIN_HEIGHT = 280;
export const PIP_MAX_HEIGHT = 520;

export function pipHeight(measured) {
  if (!Number.isFinite(measured)) return PIP_MIN_HEIGHT;
  return Math.min(PIP_MAX_HEIGHT, Math.max(PIP_MIN_HEIGHT, Math.ceil(measured)));
}

// 同步量出状态卡在小窗里（data-size=sm、宽 340）的高度，量完立即还原；中间不会绘制。
// 小窗的 body 无边距、卡片是 body 唯一子元素，所以卡片高度即所需视口高度。
export function measureSmallCard(cardRoot) {
  const size = cardRoot.dataset.size;
  const width = cardRoot.style.width;
  cardRoot.dataset.size = 'sm';
  cardRoot.style.width = `${PIP_WIDTH}px`;
  const height = cardRoot.getBoundingClientRect().height;
  cardRoot.dataset.size = size;
  cardRoot.style.width = width;
  return height;
}

// 功能侦测（不比对 UA）。API 只在安全上下文暴露，非安全上下文下这里自然为 false。
export function isPipSupported(win) {
  const dp = win && 'documentPictureInPicture' in win ? win.documentPictureInPicture : null;
  return Boolean(dp && typeof dp.requestWindow === 'function');
}

// 成品的 CSS 内联在 <style> 里：直接复制文字，比逐条复制 cssRules 更不会漏掉浏览器暂不认识的规则。
export function copyDocumentLook(from, to) {
  to.documentElement.lang = from.documentElement.lang;
  to.title = from.title;
  for (const s of from.querySelectorAll('style')) {
    const el = to.createElement('style');
    el.textContent = s.textContent;
    to.head.append(el);
  }
  to.body.classList.add('pip-body');
}

// requestWindow 必须在使用者手势内调用：这是本函数第一个 await，调用方须直接在 click 中调用。
export async function openFloat(win, cardRoot, onClose) {
  const height = pipHeight(measureSmallCard(cardRoot)); // 同步，在 await 之前，不会丢失手势
  const pipWin = await win.documentPictureInPicture.requestWindow({ width: PIP_WIDTH, height });
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
