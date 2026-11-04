// 基本设置 › 假期数据（状态行、「检查更新」「导入假期表文件」、单一结果区）与 高级设置 › 自定义网址。
// 只负责画面；流程在 holiday-update.js。所有文字走 textContent（联网来的数据从不当 HTML）。
import { h, show, setText } from './dom.js';

export function createHolidayPanel(doc, t, { onCheck, onImportText, onCustomUrl }) {
  const U = t.holidayUpdate;
  let checking = false;

  const line = h(doc, 'p', { class: 'holiday-status', id: 'holiday-status' });
  // 检查中用 aria-disabled 而不是 disabled：按钮保留焦点（disabled 会把键盘焦点丢到 body）
  const checkBtn = h(doc, 'button', {
    type: 'button', class: 'btn btn-secondary btn-s', id: 'btn-holiday-check', text: U.check,
    onclick: () => { if (!checking) onCheck(); },
  });
  const fileInput = h(doc, 'input', {
    type: 'file', accept: '.json,application/json', class: 'visually-hidden', tabindex: '-1', 'aria-hidden': 'true', id: 'holiday-file',
    onchange: async () => {
      const file = fileInput.files && fileInput.files[0];
      fileInput.value = '';
      if (!file) return;
      let text;
      try {
        text = await file.text();
      } catch {
        text = '';
      }
      onImportText(text);
    },
  });
  const importBtn = h(doc, 'button', {
    type: 'button', class: 'btn btn-secondary btn-s', id: 'btn-holiday-import', text: U.importFile,
    onclick: () => fileInput.click(),
  });
  const resultText = h(doc, 'span', { class: 'holiday-result-text' });
  const resultDetail = h(doc, 'span', { class: 'holiday-result-detail' });
  const result = h(doc, 'p', { class: 'holiday-result', id: 'holiday-result', role: 'status', 'aria-live': 'polite', hidden: true }, resultText, resultDetail);
  const body = h(doc, 'div', { class: 'holiday-body' },
    line,
    h(doc, 'div', { class: 'holiday-actions' }, checkBtn, importBtn, fileInput),
    result);

  // 高级设置 › 自定义网址：改完（change）才校验并保存；不合格显示具体原因、不保存
  const urlInput = h(doc, 'input', {
    type: 'url', id: 'f-custom-url', name: 'customUrl', autocomplete: 'off', spellcheck: 'false',
    placeholder: U.customUrlPlaceholder, 'aria-describedby': 'hint-custom-url err-custom-url',
  });
  const urlError = h(doc, 'p', { class: 'field-error', id: 'err-custom-url', role: 'alert' });
  urlInput.addEventListener('change', () => {
    const r = onCustomUrl(urlInput.value);
    setText(urlError, r.ok ? '' : r.reason);
    if (r.ok) urlInput.removeAttribute('aria-invalid');
    else urlInput.setAttribute('aria-invalid', 'true');
  });
  const advBody = h(doc, 'div', { class: 'field' },
    h(doc, 'label', { for: 'f-custom-url', text: U.customUrl }),
    urlInput,
    h(doc, 'p', { class: 'field-hint', id: 'hint-custom-url', text: U.customUrlHint }),
    urlError);
  const advSummary = h(doc, 'span', { class: 'adv-summary' });

  function update(status) {
    checking = status.checking;
    setText(line, status.line);
    setText(checkBtn, checking ? U.checking : U.check);
    if (checking) checkBtn.setAttribute('aria-disabled', 'true');
    else checkBtn.removeAttribute('aria-disabled');
    const r = status.result;
    const changed = Boolean(r) && (result.hidden || resultText.textContent !== r.text || resultDetail.textContent !== (r.detail ?? ''));
    show(result, Boolean(r));
    result.dataset.tone = r ? r.tone : '';
    setText(resultText, r ? r.text : '');
    setText(resultDetail, r && r.detail ? r.detail : '');
    // 新结果出现时确保看得到（极端情况下设置分页需要内部滚动）；分页隐藏时不动
    if (changed && result.offsetParent !== null) result.scrollIntoView({ block: 'nearest' });
    setText(advSummary, status.customSummary);
    // 正在编辑或显示错误时不覆盖用户的输入
    if (doc.activeElement !== urlInput && !urlError.textContent) urlInput.value = status.customUrl ?? '';
  }

  return { body, advBody, advSummary, update };
}
