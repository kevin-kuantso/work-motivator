// 页面顶部的提示条（spec §13.2）：两条通道。
// 错误通道（储存失败、已保存设置损坏 / 部分无效）：永远显示、不被信息条压掉；同时发生就合并成一条，用「·」分隔。
// 信息通道（首次提示、联网数据与内置表不同、备份建议）：同一时间只显示一条，首次提示优先；其余排队，前一条关闭后才显示，不丢弃。
import { h, show, setText } from './dom.js';
import { icon } from './icons.js';

const ERROR_ORDER = ['storageFail', 'loadIssue'];
// 联网数据与内置表不同的提示是用户按「检查更新」的直接结果，排在备份建议之前
const INFO_ORDER = ['firstRun', 'holidayDiff', 'holidayDiffFile', 'backupNudge'];

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
  let b = t.banner;
  const resolve = (value) => typeof value === 'function' ? value(t) : value;
  const errors = new Map();
  const infos = new Map();
  const queue = new Set();

  // M13：提示条里的动作按钮统一成 xs 描边按钮（不再有下划线链接款式）
  const actionButtons = (actions) => actions.map((a) =>
    h(doc, 'button', { type: 'button', class: 'btn btn-xs btn-secondary', 'data-action': a.key, text: resolve(a.label), onclick: a.onClick }));
  const closeButton = (onclick) =>
    h(doc, 'button', { type: 'button', class: 'banner-close', 'aria-label': b.dismiss, title: b.dismiss, text: b.closeGlyph, onclick });

  // M13：错误条正文前加一个 12px 图示（文字本身仍说明问题，图示只是让它更容易被扫到）
  const errorIcon = icon(doc, 'unpaid');
  errorIcon.classList.add('banner-icon');
  const errorText = h(doc, 'span', { class: 'banner-text' });
  const errorActions = h(doc, 'span', { class: 'banner-actions' });
  const errorClose = closeButton(dismissErrors);
  // 关闭钮是横幅的直接子项：动作与正文相邻，关闭钮靠右（.banner-close 的 margin-left:auto 才推得动）
  const errorBar = h(doc, 'div', { class: 'banner banner-error', role: 'alert', hidden: true }, errorIcon, errorText, errorActions, errorClose);
  const infoText = h(doc, 'span', { class: 'banner-text' });
  const infoActions = h(doc, 'span', { class: 'banner-actions' });
  const infoClose = closeButton(() => { const id = shownInfo; if (id == null) return; dismissInfo(id); infos.get(id)?.onDismiss?.(); });
  const infoBar = h(doc, 'div', { class: 'banner banner-info', role: 'status', hidden: true }, infoText, infoActions, infoClose);
  const root = h(doc, 'div', { class: 'notices' }, errorBar, infoBar);

  function dismissErrors() {
    for (const [id, e] of [...errors]) {
      if (!e.dismissible) continue;
      errors.delete(id);
      e.onDismiss?.();
    }
    renderErrors();
  }

  // 错误条的按钮只在「按钮组合」改变时才重建：焦点停在「导出备份」等按钮上时，
  // 保存 / 其他分页的事件触发重画不会把焦点丢到 body（R27）。按钮点击时才查当下的处理函数。
  const errHandlers = new Map();
  let errKeys = null;
  function renderErrors() {
    const resolved = new Map([...errors].map(([id, value]) => [id, { ...value, content: resolve(value.content), actions: value.actions.map((a) => ({ ...a, label: resolve(a.label) })) }]));
    const m = mergeErrors(resolved, b.sep);
    show(errorBar, Boolean(m));
    errorBar.dataset.ids = m ? m.ids.join(' ') : '';
    setText(errorText, m ? m.text : '');
    errHandlers.clear();
    for (const a of m ? m.actions : []) errHandlers.set(a.key, a.onClick);
    const keys = m ? [...m.actions.map((a) => a.key), m.dismissible ? 'close' : ''].join('|') : '';
    if (keys === errKeys) {
      for (const a of m?.actions ?? []) setText(errorActions.querySelector(`[data-action="${a.key}"]`), a.label);
      return;
    }
    errKeys = keys;
    const buttons = m ? actionButtons(m.actions.map((a) => ({ ...a, onClick: (e) => errHandlers.get(a.key)?.(e) }))) : [];
    // 关闭钮常驻 DOM（直接子项才能靠右），只在可关闭时显示；errKeys 缓存保证它在焦点里时不重建
    errorClose.hidden = !m?.dismissible;
    errorActions.replaceChildren(...buttons);
  }

  let shownInfo = null;
  function renderInfo() {
    const id = pickInfo(queue);
    show(infoBar, id !== null);
    if (id === shownInfo) return;
    shownInfo = id;
    infoBar.dataset.id = id ?? '';
    const it = id ? infos.get(id) : null;
    setText(infoText, it ? resolve(it.content) : '');
    infoClose.hidden = !(it && it.closable !== false);
    infoActions.replaceChildren(...(it ? actionButtons(it.actions ?? []) : []));
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
  function setProfile(profile) {
    t = profile.strings;
    b = t.banner;
    for (const button of [errorClose, infoClose]) {
      button.setAttribute('aria-label', b.dismiss);
      button.title = b.dismiss;
      setText(button, b.closeGlyph);
    }
    renderErrors();
    const it = shownInfo ? infos.get(shownInfo) : null;
    if (it) {
      setText(infoText, resolve(it.content));
      for (const a of it.actions ?? []) setText(infoActions.querySelector(`[data-action="${a.key}"]`), resolve(a.label));
    }
  }


  return { setError, queueInfo, dismissInfo, setProfile, root };
}
