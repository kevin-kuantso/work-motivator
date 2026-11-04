// 页面顶部的提示条（spec §13.2）：两条通道。
// 错误通道（储存失败、已保存设置损坏 / 部分无效）：永远显示、不被信息条压掉；同时发生就合并成一条，用「·」分隔。
// 信息通道（首次提示、备份建议）：同一时间只显示一条，首次提示优先；其余排队，前一条关闭后才显示，不丢弃。
import { h, show, setText } from './dom.js';

const ERROR_ORDER = ['storageFail', 'loadIssue'];
const INFO_ORDER = ['firstRun', 'backupNudge'];

// 纯函数：errors = Map<id, { content, dismissible, actions:[{key,label,...}] }> → 合并后的一条（或 null）
export function mergeErrors(errors, sep) {
  const ids = ERROR_ORDER.filter((id) => errors.has(id));
  if (!ids.length) return null;
  const parts = ids.map((id) => errors.get(id));
  const seen = new Set();
  const actions = parts.flatMap((p) => p.actions ?? []).filter((a) => !seen.has(a.key) && seen.add(a.key));
  return {
    ids,
    text: parts.map((p) => p.content).join(sep),
    dismissible: parts.some((p) => p.dismissible),
    actions,
  };
}

// 纯函数：queue = Set<id> → 现在该显示的那一条（或 null）
export function pickInfo(queue) {
  return INFO_ORDER.find((id) => queue.has(id)) ?? null;
}

export function createBanners(doc, t) {
  const b = t.banner;
  const errors = new Map();
  const infos = new Map();
  const queue = new Set();

  const actionButtons = (actions) => actions.map((a) =>
    h(doc, 'button', { type: 'button', class: `btn btn-xs ${a.link ? 'btn-link' : 'btn-secondary'}`, 'data-action': a.key, text: a.label, onclick: a.onClick }));
  const closeButton = (onclick) =>
    h(doc, 'button', { type: 'button', class: 'banner-close', 'aria-label': b.dismiss, title: b.dismiss, text: b.closeGlyph, onclick });

  const errorText = h(doc, 'span', { class: 'banner-text' });
  const errorActions = h(doc, 'span', { class: 'banner-actions' });
  const errorBar = h(doc, 'div', { class: 'banner banner-error', role: 'alert', hidden: true }, errorText, errorActions);
  const infoText = h(doc, 'span', { class: 'banner-text' });
  const infoActions = h(doc, 'span', { class: 'banner-actions' });
  const infoBar = h(doc, 'div', { class: 'banner banner-info', role: 'status', hidden: true }, infoText, infoActions);
  const root = h(doc, 'div', { class: 'notices' }, errorBar, infoBar);

  function dismissErrors() {
    for (const [id, e] of [...errors]) {
      if (!e.dismissible) continue;
      errors.delete(id);
      e.onDismiss?.();
    }
    renderErrors();
  }

  function renderErrors() {
    const m = mergeErrors(errors, b.sep);
    show(errorBar, Boolean(m));
    errorBar.dataset.ids = m ? m.ids.join(' ') : '';
    setText(errorText, m ? m.text : '');
    errorActions.replaceChildren(...(m ? actionButtons(m.actions) : []), ...(m?.dismissible ? [closeButton(dismissErrors)] : []));
  }

  let shownInfo = null;
  function renderInfo() {
    const id = pickInfo(queue);
    show(infoBar, id !== null);
    if (id === shownInfo) return;
    shownInfo = id;
    infoBar.dataset.id = id ?? '';
    const it = id ? infos.get(id) : null;
    setText(infoText, it ? it.content : '');
    infoActions.replaceChildren(...(it ? actionButtons(it.actions ?? []) : []),
      ...(it && it.closable !== false ? [closeButton(() => { dismissInfo(id); it.onDismiss?.(); })] : []));
  }

  function setError(id, content, opts = {}) {
    if (content === null || content === undefined) errors.delete(id);
    else errors.set(id, { content, dismissible: Boolean(opts.dismissible), actions: opts.actions ?? [], onDismiss: opts.onDismiss });
    renderErrors();
  }

  function queueInfo(id, content, opts = {}) {
    infos.set(id, { content, actions: opts.actions, closable: opts.closable, onDismiss: opts.onDismiss });
    queue.add(id);
    if (shownInfo === id) shownInfo = undefined; // 内容可能变了：重画
    renderInfo();
  }

  function dismissInfo(id) {
    queue.delete(id);
    renderInfo();
  }

  return { setError, queueInfo, dismissInfo, root };
}
