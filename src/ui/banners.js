// 頁面頂部的提示條（spec §13.2）：兩條通道。
// 錯誤通道（儲存失敗、已儲存設定損壞 / 部分無效）：永遠顯示、不被資訊條壓掉；同時發生就合併成一條，用「·」分隔。
// 資訊通道（首次提示、聯網資料與內建表不同、備份建議）：同一時間只顯示一條，首次提示優先；其餘排隊，前一條關閉後才顯示，不丟棄。
import { h, show, setText } from './dom.js';
import { icon } from './icons.js';

const ERROR_ORDER = ['storageFail', 'loadIssue'];
// 聯網資料與內建表不同的提示是使用者按「檢查更新」的直接結果，排在備份建議之前
const INFO_ORDER = ['firstRun', 'holidayDiff', 'holidayDiffFile', 'backupNudge'];

// 純函式：errors = Map<id, { content, dismissible, actions:[{key,label,...}] }> → 合併後的一條（或 null）
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

// 純函式：queue = Set<id> → 現在該顯示的那一條（或 null）
export function pickInfo(queue) {
  return INFO_ORDER.find((id) => queue.has(id)) ?? null;
}

export function createBanners(doc, t) {
  let b = t.banner;
  const resolve = (value) => typeof value === 'function' ? value(t) : value;
  const errors = new Map();
  const infos = new Map();
  const queue = new Set();

  // M13：提示條裡的動作按鈕統一成 xs 描邊按鈕（不再有下劃線連結款式）
  const actionButtons = (actions) => actions.map((a) =>
    h(doc, 'button', { type: 'button', class: 'btn btn-xs btn-secondary', 'data-action': a.key, text: resolve(a.label), onclick: a.onClick }));
  const closeButton = (onclick) =>
    h(doc, 'button', { type: 'button', class: 'banner-close', 'aria-label': b.dismiss, title: b.dismiss, text: b.closeGlyph, onclick });

  // M13：錯誤條正文前加一個 12px 圖示（文字本身仍說明問題，圖示只是讓它更容易被掃到）
  const errorIcon = icon(doc, 'unpaid');
  errorIcon.classList.add('banner-icon');
  const errorText = h(doc, 'span', { class: 'banner-text' });
  const errorActions = h(doc, 'span', { class: 'banner-actions' });
  const errorClose = closeButton(dismissErrors);
  // 關閉鈕是橫幅的直接子項：動作與正文相鄰，關閉鈕靠右（.banner-close 的 margin-left:auto 才推得動）
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

  // 錯誤條的按鈕只在「按鈕組合」改變時才重建：焦點停在「匯出備份」等按鈕上時，
  // 儲存 / 其他分頁的事件觸發重畫不會把焦點丟到 body（R27）。按鈕點選時才查當下的處理函式。
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
    // 關閉鈕常駐 DOM（直接子項才能靠右），只在可關閉時顯示；errKeys 快取保證它在焦點裡時不重建
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
    if (shownInfo === id) shownInfo = undefined; // 內容可能變了：重畫
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
