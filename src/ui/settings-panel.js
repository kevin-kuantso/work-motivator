// 设置分区：自动保存，无保存按钮。验证失败的字段不写入，保留上一个有效值并就地显示错误。
import { validateSchedule } from '../calc.js';
import { h, show, setText } from './dom.js';

const CHEER_MAX = 40;

function parseSalary(s) {
  const v = s.trim();
  return /^\d+(\.\d+)?$/.test(v) ? Number(v) : NaN;
}

export function createSettingsPanel(doc, t, { getCfg, onChange }) {
  const s = t.settings;
  const win = doc.defaultView;
  const inputs = {};
  const errors = {};

  function fieldError(field) {
    errors[field] = h(doc, 'p', { class: 'field-error', id: `err-${field}`, role: 'alert' });
    return errors[field];
  }

  function textField(field, label, attrs = {}, extra = null) {
    inputs[field] = h(doc, 'input', { id: `f-${field}`, name: field, 'aria-describedby': `err-${field}`, ...attrs });
    return h(doc, 'div', { class: 'field' },
      h(doc, 'label', { for: `f-${field}`, text: label }),
      attrs['data-prefix'] ? h(doc, 'div', { class: 'input-prefix' }, h(doc, 'span', { 'aria-hidden': 'true', text: t.currency }), inputs[field]) : inputs[field],
      extra,
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

  const cheerCount = h(doc, 'span', { class: 'cheer-count', 'aria-live': 'off' });
  const paydaySelect = h(doc, 'select', { id: 'f-payday', name: 'payday', 'aria-describedby': 'err-payday' },
    h(doc, 'option', { value: '', text: s.paydayNone }),
    Array.from({ length: 31 }, (_, i) => h(doc, 'option', { value: String(i + 1), text: s.paydayOption(i + 1) })));
  inputs.payday = paydaySelect;

  const autosave = h(doc, 'span', { class: 'autosave', hidden: true, role: 'status', text: s.autosaved });
  const lunchTimes = h(doc, 'div', { class: 'field-row' },
    textField('lunchStart', s.lunchStart, { type: 'time' }),
    textField('lunchEnd', s.lunchEnd, { type: 'time' }));
  const advSummary = h(doc, 'span', { class: 'adv-summary' });
  const advBody = h(doc, 'div', { class: 'adv-body', id: 'adv-body', hidden: true },
    switchField('weekends', s.weekends, s.weekendsHint),
    h(doc, 'div', { class: 'field' },
      h(doc, 'label', { for: 'f-payday', text: s.payday }), paydaySelect, fieldError('payday')));
  const advToggle = h(doc, 'button', {
    type: 'button', class: 'adv-toggle', 'aria-expanded': 'false', 'aria-controls': 'adv-body',
    onclick: () => {
      const open = advBody.hidden;
      advBody.hidden = !open;
      advToggle.setAttribute('aria-expanded', String(open));
    },
  }, h(doc, 'span', { class: 'adv-title', text: s.sections.advanced }), advSummary);

  const el = h(doc, 'section', { class: 'panel settings', id: 'settings', 'aria-labelledby': 'settings-title' },
    h(doc, 'div', { class: 'panel-head' }, h(doc, 'h2', { id: 'settings-title', text: s.title }), autosave),
    h(doc, 'fieldset', { class: 'section' },
      h(doc, 'legend', { text: s.sections.pay }),
      textField('salary', s.salary, { type: 'text', inputmode: 'decimal', autocomplete: 'off', 'data-prefix': '1' }),
      h(doc, 'div', { class: 'field-row' },
        textField('start', s.start, { type: 'time' }),
        textField('end', s.end, { type: 'time' }))),
    h(doc, 'fieldset', { class: 'section' },
      h(doc, 'legend', { text: s.sections.lunch }),
      switchField('lunchOn', s.lunchOn, s.lunchOffHint),
      lunchTimes),
    h(doc, 'fieldset', { class: 'section' },
      h(doc, 'legend', { text: s.sections.cheer }),
      textField('cheer', s.cheer, { type: 'text', placeholder: s.cheerPlaceholder, autocomplete: 'off' }, cheerCount)),
    h(doc, 'div', { class: 'section section-adv' }, advToggle, advBody));

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
    setText(advSummary, s.advancedSummary(cfg.weekends, cfg.payday === null ? s.paydayNone : s.paydayOption(cfg.payday)));
  }

  let savedTimer = null;
  function flashSaved() {
    show(autosave, true);
    win.clearTimeout(savedTimer);
    savedTimer = win.setTimeout(() => show(autosave, false), 1500);
  }

  function check(cfg) {
    if ([...cfg.cheer].length > CHEER_MAX) return s.cheerTooLong;
    const v = validateSchedule(cfg);
    return v.ok ? null : v.reason;
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
    if (advBody.contains(input) && advBody.hidden) advToggle.click();
    input.focus();
  }

  return { el, sync, flashSaved, focusField };
}
