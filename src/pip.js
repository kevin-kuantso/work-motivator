// 悬浮小窗：Document Picture-in-Picture（Chrome / Edge 116+）。
// 只负责视窗本身：开窗、复制样式、把状态卡移进去，关闭（pagehide，含按 X 与程序 close()）时移回。
// 计时与界面状态由调用方处理。
export const PIP_SIZE = { width: 340, height: 280 };

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
  const pipWin = await win.documentPictureInPicture.requestWindow(PIP_SIZE);
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
