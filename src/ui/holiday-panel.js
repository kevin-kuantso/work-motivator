// 基本设置 › 假期数据（年份胶囊、「检查更新」「导入假期表文件」各带一行说明、单一结果区、可展开的格式示例）
// 与 高级设置 › 自定义数据网址。只负责画面；流程在 holiday-update.js。所有文字走 textContent（联网来的数据从不当 HTML）。
import { h, show, setText } from './dom.js';
import { icon } from './icons.js';

export function createHolidayPanel(doc, t, { onCheck, onImportText, onCustomUrl }) {
  const U = t.holidayUpdate;
  let checking = false;

  const win = doc.defaultView;
  // 年份胶囊 + 右侧「上次检查」。整行是一个具名分组，名称就是完整的一句（「假期数据状态：2026 年 · 内置 · …」），
  // 胶囊本身对读屏隐藏，避免相邻胶囊的文字连成一串
  const chips = h(doc, 'span', { class: 'hstatus-chips', 'aria-hidden': 'true' });
  const lastCheck = h(doc, 'span', { class: 'chip-note', 'aria-hidden': 'true' });
  const line = h(doc, 'div', { class: 'hstatus', id: 'holiday-status', role: 'group', 'aria-label': U.statusLabel }, chips, lastCheck);
  // 检查中用 aria-disabled 而不是 disabled：按钮保留焦点（disabled 会把键盘焦点丢到 body）
  const checkBtn = h(doc, 'button', {
    type: 'button', class: 'btn btn-secondary btn-s', id: 'btn-holiday-check', text: U.check, 'aria-describedby': 'hint-holiday-check',
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
    type: 'button', class: 'btn btn-secondary btn-s', id: 'btn-holiday-import', text: U.importFile, 'aria-describedby': 'hint-holiday-import',
    onclick: () => fileInput.click(),
  });
  // 结果文字用一个常驻的 Text 节点写，结果前的 ✓ 才能留在同一个 span 里不被 setText 清掉（L7）
  const resultText = h(doc, 'span', { class: 'holiday-result-text' });
  const resultTextNode = doc.createTextNode('');
  const resultCheck = icon(doc, 'check'); // 纯装饰（icon() 已 aria-hidden）；只有标了 check 的结果才加
  resultText.append(resultTextNode);
  const resultDetail = h(doc, 'span', { class: 'holiday-result-detail' });
  const result = h(doc, 'p', { class: 'holiday-result', id: 'holiday-result', role: 'status', 'aria-live': 'polite', hidden: true }, resultText, resultDetail);

  // 「查看导入文件的格式示例」：可复制的等宽示例（真实 2026 数据节选）+ 两行白话；GitHub 地址是可选取的文字，不是链接
  const code = h(doc, 'pre', { class: 'code', id: 'holiday-example-code', text: U.exampleCode });
  const copyState = h(doc, 'span', { class: 'example-copy-state', role: 'status' });
  const copyBtn = h(doc, 'button', { type: 'button', class: 'btn btn-secondary btn-xs', id: 'btn-example-copy', text: U.exampleCopy, onclick: copyExample });
  const example = h(doc, 'div', { class: 'example', id: 'holiday-example', hidden: true },
    h(doc, 'div', { class: 'example-head' }, h(doc, 'span', { text: U.exampleHead }), copyState, copyBtn),
    code,
    ...[U.exampleFormat, U.exampleYear, U.examplePapers, U.exampleDays, U.exampleNeedOff].map((x) => h(doc, 'p', { class: 'ex-line', text: x })),
    h(doc, 'p', { class: 'ex-line' }, U.exampleWhereBefore, h(doc, 'span', { class: 'mono', text: U.exampleWhereAddr }), U.exampleWhereAfter),
    h(doc, 'p', { class: 'ex-line ex-official', text: U.exampleOfficial }));
  const chev = h(doc, 'span', { class: 'chev', 'aria-hidden': 'true', text: t.settings.chevronClosed });
  const disclosureText = h(doc, 'span', { text: U.exampleShow });
  const disclosure = h(doc, 'button', {
    type: 'button', class: 'disclosure', id: 'btn-example', 'aria-expanded': 'false', 'aria-controls': 'holiday-example',
    onclick: () => setExample(example.hidden),
  }, chev, disclosureText);
  function setExample(open) {
    example.hidden = !open;
    disclosure.setAttribute('aria-expanded', String(open));
    setText(chev, open ? t.settings.chevronOpen : t.settings.chevronClosed);
    setText(disclosureText, open ? U.exampleHide : U.exampleShow);
    if (open) bringIntoView();
  }
  // 右栏需要内部滚动时，把展开的示例带进视野——但刚按下（有焦点）的展开钮不能被卷出去（WCAG 2.4.11）：
  // 示例比剩下的空间高时，改为把展开钮卷到栏顶，示例从它下面开始
  function bringIntoView() {
    example.scrollIntoView({ block: 'nearest' });
    // 最近的可滚动祖先：两栏时是右栏（.set-col），单栏（分页较窄）时是整个 .settings
    let col = disclosure.parentElement;
    while (col && !/(auto|scroll)/.test(win.getComputedStyle(col).overflowY)) col = col.parentElement;
    if (!col) return;
    const c = col.getBoundingClientRect();
    const b = disclosure.getBoundingClientRect();
    if (b.top < c.top || b.bottom > c.bottom) disclosure.scrollIntoView({ block: 'start' });
  }
  // 高级设置的格式提示：展开示例、带进右栏视野、焦点移到示例的展开钮
  function revealExample() {
    if (example.hidden) setExample(true);
    else bringIntoView();
    disclosure.focus({ preventScroll: true });
  }
  const showExampleBtn = (id) => h(doc, 'button', { type: 'button', class: 'btn btn-secondary btn-xs show-example', id, text: U.showExample, 'aria-controls': 'holiday-example', onclick: revealExample });

  function selectCode() {
    const sel = win.getSelection?.();
    if (!sel) return;
    const range = doc.createRange();
    range.selectNodeContents(code);
    sel.removeAllRanges();
    sel.addRange(range);
  }
  // 先清空、稍后再写：连续复制时读屏会再念一次（同一段文字不变时 live 区域不会重新朗读）
  let announceTimer = null;
  function announce(msg) {
    win.clearTimeout(announceTimer);
    setText(copyState, '');
    announceTimer = win.setTimeout(() => setText(copyState, msg), 100);
  }
  function copyExample() {
    const fail = () => {
      selectCode();
      announce(U.exampleCopyFail);
    };
    try {
      const p = win.navigator.clipboard?.writeText?.(code.textContent);
      if (!p || typeof p.then !== 'function') {
        fail();
        return;
      }
      p.then(() => announce(U.exampleCopied), fail);
    } catch {
      fail();
    }
  }

  const act = (btn, hintId, hint) => h(doc, 'div', { class: 'act' }, btn, h(doc, 'span', { class: 'act-hint', id: hintId, text: hint }));
  const body = h(doc, 'div', { class: 'holiday-body' },
    line,
    h(doc, 'div', { class: 'act-grid' }, act(checkBtn, 'hint-holiday-check', U.checkHint), act(importBtn, 'hint-holiday-import', U.importHint), fileInput),
    result,
    disclosure,
    example);

  // 高级设置 › 自定义网址：改完（change）才校验并保存；不合格显示具体原因、不保存
  const urlInput = h(doc, 'input', {
    type: 'url', id: 'f-custom-url', name: 'customUrl', autocomplete: 'off', spellcheck: 'false',
    placeholder: U.customUrlPlaceholder, 'aria-describedby': 'explain-custom-url hint-custom-url err-custom-url', class: 'inp inp-wide',
  });
  const urlError = h(doc, 'p', { class: 'field-error', id: 'err-custom-url', role: 'alert' });
  urlInput.addEventListener('change', () => {
    const r = onCustomUrl(urlInput.value);
    setText(urlError, r.ok ? '' : r.reason);
    if (r.ok) urlInput.removeAttribute('aria-invalid');
    else {
      urlInput.setAttribute('aria-invalid', 'true');
      urlError.scrollIntoView({ block: 'nearest' }); // 设置分页需要内部滚动时，错误也要看得到
    }
  });
  const advBody = h(doc, 'div', { class: 'field adv-field' },
    h(doc, 'label', { for: 'f-custom-url', class: 'field-label', text: U.customUrl }),
    h(doc, 'p', { class: 'para', id: 'explain-custom-url', text: U.customUrlExplain }),
    urlInput,
    h(doc, 'div', { class: 'adv-hint-row' },
      h(doc, 'p', { class: 'act-hint', id: 'hint-custom-url', text: U.customUrlHint }),
      showExampleBtn('btn-adv-example')),
    urlError);
  const advSummary = h(doc, 'span', { class: 'adv-summary' });

  function update(status) {
    checking = status.checking;
    const m = status.status;
    chips.replaceChildren(...m.chips.map((c) =>
      h(doc, 'span', { class: `chip ${c.kind === 'missing' ? 'chip-miss' : 'chip-ok'}`, 'data-kind': c.kind },
        c.kind === 'missing' ? null : icon(doc, 'check'), c.text)));
    setText(lastCheck, m.lastCheck ?? '');
    line.setAttribute('aria-label', U.statusAria(status.line)); // 只念这一份（胶囊与上次检查都 aria-hidden）
    show(lastCheck, Boolean(m.lastCheck));
    setText(checkBtn, checking ? U.checking : U.check);
    if (checking) checkBtn.setAttribute('aria-disabled', 'true');
    else checkBtn.removeAttribute('aria-disabled');
    const r = status.result;
    const nextText = r ? r.text : '';
    const changed = Boolean(r) && (result.hidden || resultTextNode.data !== nextText || resultDetail.textContent !== (r.detail ?? ''));
    show(result, Boolean(r));
    result.dataset.tone = r ? r.tone : '';
    if (resultTextNode.data !== nextText) resultTextNode.data = nextText;
    // ✓ 只加在标了 check 的结果前（L7：「已是最新」是成功，不是停用）；文字节点始终是最后一个子节点
    const wantCheck = Boolean(r && r.check);
    if (wantCheck && resultCheck.parentNode !== resultText) resultText.insertBefore(resultCheck, resultTextNode);
    else if (!wantCheck && resultCheck.parentNode === resultText) resultCheck.remove();
    setText(resultDetail, r && r.detail ? r.detail : '');
    if (changed && r?.formatHelp && example.hidden) setExample(true);
    // 新结果出现时确保看得到（极端情况下设置分页需要内部滚动）；分页隐藏时不动
    if (changed && result.offsetParent !== null) result.scrollIntoView({ block: 'nearest' });
    setText(advSummary, status.customSummary);
    // 正在编辑或显示错误时不覆盖用户的输入
    if (doc.activeElement !== urlInput && !urlError.textContent) urlInput.value = status.customUrl ?? '';
  }

  return { body, advBody, advSummary, update };
}
