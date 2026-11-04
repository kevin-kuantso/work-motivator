// 设置分区：自动保存，无保存按钮。验证失败的字段不写入，保留上一个有效值并就地显示错误。
import { validateSchedule } from '../calc.js';
import { h, show, setText } from './dom.js';

const CHEER_MAX = 40;

function parseSalary(s) {
  const v = s.trim();
  return /^\d+(\.\d+)?$/.test(v) ? Number(v) : NaN;
}

// holiday：{ body, advBody, advSummary }（假期数据组的内容与高级设置里的自定义网址，见 holiday-panel.js）
export function createSettingsPanel(doc, t, { getCfg, onChange, onExport, onImport, report = null, holiday = null }) {
  const s = t.settings;
  const win = doc.defaultView;
  const inputs = {};
  const errors = {};

  function fieldError(field) {
    errors[field] = h(doc, 'p', { class: 'field-error', id: `err-${field}`, role: 'alert' });
    return errors[field];
  }

  function textField(field, label, attrs = {}, extra = null) {
    const { prefix, ...rest } = attrs;
    inputs[field] = h(doc, 'input', { id: `f-${field}`, name: field, 'aria-describedby': `err-${field}`, ...rest });
    // extra（字数计数）放在输入框右侧；有 extra 的字段，组标题已写明用途，标签只给屏幕阅读器（省一行高度）
    return h(doc, 'div', { class: 'field' },
      h(doc, 'label', { for: `f-${field}`, class: extra ? 'visually-hidden' : undefined, text: label }),
      // 「¥」是输入框外的装饰，不进 value（不猜测修补用户的输入）
      prefix ? h(doc, 'div', { class: 'input-prefix' }, h(doc, 'span', { class: 'input-prefix-sign', 'aria-hidden': 'true', text: prefix }), inputs[field])
        : extra ? h(doc, 'div', { class: 'input-with-extra' }, inputs[field], extra) : inputs[field],
      fieldError(field));
  }

  function switchField(field, label, hint) {
    const stateText = h(doc, 'span', { class: 'switch-state', 'aria-hidden': 'true' });
    inputs[field] = h(doc, 'input', { type: 'checkbox', role: 'switch', id: `f-${field}`, name: field, class: 'switch', 'aria-describedby': hint ? `hint-${field}` : undefined });
    inputs[field].stateText = stateText;
    return h(doc, 'div', { class: 'field field-switch' },
      h(doc, 'label', { for: `f-${field}`, text: label }),
      h(doc, 'span', { class: 'switch-wrap' }, inputs[field], stateText),
      hint ? h(doc, 'p', { class: 'field-hint', id: `hint-${field}`, text: hint }) : null,
      fieldError(field));
  }

  const group = (title, ...children) =>
    h(doc, 'fieldset', { class: 'section' }, h(doc, 'legend', { text: title }), ...children);
  const block = (cls, title, ...children) =>
    h(doc, 'section', { class: `section ${cls}`, 'aria-labelledby': `${cls}-title` },
      h(doc, 'h3', { class: 'section-title', id: `${cls}-title`, text: title }), ...children);

  const cheerCount = h(doc, 'span', { class: 'cheer-count', 'aria-live': 'off' });
  const paydaySelect = h(doc, 'select', { id: 'f-payday', name: 'payday', 'aria-describedby': 'err-payday' },
    h(doc, 'option', { value: '', text: s.paydayNone }),
    Array.from({ length: 31 }, (_, i) => h(doc, 'option', { value: String(i + 1), text: s.paydayOption(i + 1) })));
  inputs.payday = paydaySelect;

  const autosave = h(doc, 'span', { class: 'autosave', hidden: true, role: 'status', text: s.autosaved });
  const lunchTimes = h(doc, 'div', { class: 'field-row' },
    textField('lunchStart', s.lunchStart, { type: 'time' }),
    textField('lunchEnd', s.lunchEnd, { type: 'time' }));
  // 高级设置（折叠）：自定义网址；标题旁显示「自定义网址：未设置 / 主机名」
  const advBody = h(doc, 'div', { class: 'adv-body', id: 'adv-body', hidden: true }, holiday ? holiday.advBody : null);
  const advToggle = h(doc, 'button', {
    type: 'button', class: 'adv-toggle', 'aria-expanded': 'false', 'aria-controls': 'adv-body',
    onclick: () => {
      const open = advBody.hidden;
      advBody.hidden = !open;
      advToggle.setAttribute('aria-expanded', String(open));
    },
  }, h(doc, 'span', { class: 'adv-title', text: s.sections.advanced }), holiday ? holiday.advSummary : null);

  const el = h(doc, 'div', { class: 'settings', id: 'settings' },
    autosave,
    h(doc, 'div', { class: 'settings-cols' },
      h(doc, 'div', { class: 'settings-col' },
        group(s.sections.pay,
          textField('salary', s.salary, { type: 'text', inputmode: 'decimal', autocomplete: 'off', prefix: t.currency }),
          h(doc, 'div', { class: 'field-row' },
            textField('start', s.start, { type: 'time' }),
            textField('end', s.end, { type: 'time' }))),
        group(s.sections.lunch,
          switchField('lunchOn', s.lunchOn, s.lunchOffHint),
          lunchTimes),
        group(s.sections.cheer,
          textField('cheer', s.cheer, { type: 'text', placeholder: s.cheerPlaceholder, autocomplete: 'off' }, cheerCount))),
      h(doc, 'div', { class: 'settings-col' },
        group(s.sections.weekPay,
          switchField('weekends', s.weekends, s.weekendsHint),
          h(doc, 'div', { class: 'field' },
            h(doc, 'label', { for: 'f-payday', text: s.payday }), paydaySelect, fieldError('payday'))),
        block('section-holiday', s.sections.holiday, holiday ? holiday.body : null),
        block('section-backup', s.sections.backup,
          // 旁注与按钮同一行（放不下时自动换行），省一行高度给假期数据的结果区
          h(doc, 'div', { class: 'backup-actions' },
            h(doc, 'button', { type: 'button', class: 'btn btn-secondary btn-s', id: 'btn-export', text: s.backup.export, onclick: onExport }),
            h(doc, 'button', { type: 'button', class: 'btn btn-secondary btn-s', id: 'btn-import', text: s.backup.import, onclick: onImport }),
            h(doc, 'p', { class: 'field-hint backup-note', text: s.backup.note })),
          report),
        h(doc, 'div', { class: 'section section-adv' }, advToggle, advBody))));

  const readers = {
    salary: (i) => parseSalary(i.value),
    start: (i) => i.value, end: (i) => i.value, lunchStart: (i) => i.value, lunchEnd: (i) => i.value,
    cheer: (i) => i.value,
    lunchOn: (i) => i.checked, weekends: (i) => i.checked,
    payday: (i) => (i.value === '' ? null : Number(i.value)),
  };

  function setError(field, msg) {
    setText(errors[field], msg);
    if (msg) inputs[field].setAttribute('aria-invalid', 'true');
    else inputs[field].removeAttribute('aria-invalid');
  }

  function decorate(cfg) {
    lunchTimes.hidden = !cfg.lunchOn;
    for (const f of ['lunchOn', 'weekends']) setText(inputs[f].stateText, inputs[f].checked ? s.on : s.off);
    setText(cheerCount, s.cheerCount([...inputs.cheer.value].length, CHEER_MAX));
  }

  let savedTimer = null;
  function flashSaved() {
    show(autosave, true);
    win.clearTimeout(savedTimer);
    savedTimer = win.setTimeout(() => show(autosave, false), 1500);
  }

  function check(cfg) {
    if ([...cfg.cheer].length > CHEER_MAX) return t.reasons.cheerTooLong;
    const v = validateSchedule(cfg);
    if (v.ok) return null;
    return v.field === 'salary' ? s.salaryError : v.reason;
  }

  function handle(field) {
    const cur = getCfg();
    let next = { ...cur, [field]: readers[field](inputs[field]) };
    const msg = check(next);
    setError(field, msg ?? '');
    if (msg) {
      decorate({ ...cur, lunchOn: inputs.lunchOn.checked });
      return;
    }
    // 其他仍显示错误的字段：在新值基础上再试一次（例如改上班时间后，原本无效的下班时间变得有效）。
    for (const f of Object.keys(errors)) {
      if (f === field || !errors[f].textContent) continue;
      const retry = { ...next, [f]: readers[f](inputs[f]) };
      const m = check(retry);
      if (!m) next = retry;
      setError(f, m ?? '');
    }
    decorate(next);
    onChange(next);
  }

  for (const field of Object.keys(readers)) {
    const evt = inputs[field].type === 'checkbox' || inputs[field].tagName === 'SELECT' ? 'change' : 'input';
    inputs[field].addEventListener(evt, () => handle(field));
  }

  function sync(cfg) {
    inputs.salary.value = String(cfg.salary);
    for (const f of ['start', 'end', 'lunchStart', 'lunchEnd', 'cheer']) inputs[f].value = cfg[f];
    inputs.lunchOn.checked = cfg.lunchOn;
    inputs.weekends.checked = cfg.weekends;
    inputs.payday.value = cfg.payday === null ? '' : String(cfg.payday);
    for (const f of Object.keys(errors)) setError(f, '');
    decorate(cfg);
  }

  function focusField(field) {
    const input = inputs[field];
    if (!input) return;
    input.focus();
  }

  return { el, sync, flashSaved, focusField };
}
