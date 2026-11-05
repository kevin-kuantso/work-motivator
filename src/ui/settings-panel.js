// 设置分区：自动保存，无保存按钮。验证失败的字段不写入，保留上一个有效值并就地显示错误。
import { validateSchedule } from '../calc.js';
import { h, show, setText } from './dom.js';
import { icon } from './icons.js';

const CHEER_MAX = 40;

function parseSalary(s) {
  const v = s.trim();
  return /^\d+(\.\d+)?$/.test(v) ? Number(v) : NaN;
}

// 版面（Task 14，redesign-v3）：两栏、有边框的卡片。左「工资与上班时间」（标签对齐同一条竖线）；
// 右「假期数据」「数据与备份」「高级设置」（折叠：整个卡头是展开按钮）。每张卡是 <section aria-labelledby> + 标题。
// holiday：{ body, advBody, advSummary }（假期数据卡的内容与高级设置里的自定义网址，见 holiday-panel.js）
export function createSettingsPanel(doc, t, { getCfg, onChange, onExport, onImport, report = null, holiday = null, builtinYears = [] }) {
  const s = t.settings;
  const win = doc.defaultView;
  const inputs = {};
  const errors = {};

  function fieldError(field) {
    errors[field] = h(doc, 'p', { class: 'field-error row-msg', id: `err-${field}`, role: 'alert' });
    return errors[field];
  }
  const hint = (id, text) => h(doc, 'p', { class: 'row-hint', id, text });
  const describe = (...ids) => ids.filter(Boolean).join(' ');

  function input(field, attrs = {}) {
    inputs[field] = h(doc, 'input', { id: `f-${field}`, name: field, 'aria-describedby': describe(attrs.hintId, `err-${field}`), ...attrs, hintId: undefined });
    return inputs[field];
  }

  // 一行：标签 | 控件；提示与错误放在控件下方（同一条竖线）
  const row = (labelEl, ctrl, ...below) => h(doc, 'div', { class: 'row' }, labelEl, h(doc, 'div', { class: 'row-ctrl' }, ctrl), ...below);
  const label = (field, text) => h(doc, 'label', { class: 'row-label', for: `f-${field}`, text });

  function switchRow(field, text, hintText) {
    const stateText = h(doc, 'span', { class: 'switch-state', 'aria-hidden': 'true' });
    inputs[field] = h(doc, 'input', {
      type: 'checkbox', role: 'switch', id: `f-${field}`, name: field, class: 'switch', 'aria-describedby': describe(hintText ? `hint-${field}` : null, `err-${field}`),
    });
    inputs[field].stateText = stateText;
    return row(label(field, text), [inputs[field], stateText], hintText ? hint(`hint-${field}`, hintText) : null, fieldError(field));
  }

  // 两个时间（上下班 / 午休）：一行一组；分组名称 = 行标签，输入框各有自己的名称
  function timePair(id, groupLabel, a, aLabel, b, bLabel) {
    const lab = h(doc, 'span', { class: 'row-label', id: `lbl-${id}`, text: groupLabel });
    const r = row(lab, [
      input(a, { type: 'time', class: 'inp inp-time', 'aria-label': aLabel }),
      h(doc, 'span', { class: 'to', 'aria-hidden': 'true', text: s.to }),
      input(b, { type: 'time', class: 'inp inp-time', 'aria-label': bLabel }),
    ], fieldError(a), fieldError(b));
    r.setAttribute('role', 'group');
    r.setAttribute('aria-labelledby', `lbl-${id}`);
    return r;
  }

  const card = (id, iconName, title, desc, ...body) =>
    h(doc, 'section', { class: `scard section-${id}`, 'aria-labelledby': `card-${id}-title` },
      h(doc, 'div', { class: 'scard-head' },
        h(doc, 'h2', { class: 'scard-title', id: `card-${id}-title` }, icon(doc, iconName), title),
        desc ? h(doc, 'p', { class: 'scard-desc', text: desc }) : null),
      h(doc, 'div', { class: 'scard-body' }, ...body));

  const cheerCount = h(doc, 'span', { class: 'cheer-count', 'aria-live': 'off' });
  const paydaySelect = h(doc, 'select', { id: 'f-payday', name: 'payday', class: 'sel', 'aria-describedby': 'hint-payday err-payday' },
    h(doc, 'option', { value: '', text: s.paydayNone }),
    Array.from({ length: 31 }, (_, i) => h(doc, 'option', { value: String(i + 1), text: s.paydayOption(i + 1) })));
  inputs.payday = paydaySelect;

  const autosave = h(doc, 'span', { class: 'autosave', hidden: true, role: 'status', text: s.autosaved });
  const lunchTimes = timePair('lunch', s.lunchTime, 'lunchStart', s.lunchStart, 'lunchEnd', s.lunchEnd);
  const sep = () => h(doc, 'div', { class: 'group-sep', 'aria-hidden': 'true' });

  // 高级设置（折叠，APG 手风琴：标题里放按钮）：卡头整个是按钮，右侧摘要「自定义数据网址：未设置 / 主机名」
  const advBody = h(doc, 'div', { class: 'scard-body adv-body', id: 'adv-body', hidden: true }, holiday ? holiday.advBody : null);
  const advChev = h(doc, 'span', { class: 'chev', 'aria-hidden': 'true', text: s.chevronClosed });
  const advCard = h(doc, 'section', { class: 'scard section-adv', 'aria-labelledby': 'adv-title' });
  const advToggle = h(doc, 'button', {
    type: 'button', class: 'adv-toggle adv-head', id: 'adv-toggle', 'aria-expanded': 'false', 'aria-controls': 'adv-body',
    onclick: () => {
      const open = advBody.hidden;
      advBody.hidden = !open;
      advToggle.setAttribute('aria-expanded', String(open));
      advCard.classList.toggle('is-open', open);
      setText(advChev, open ? s.chevronOpen : s.chevronClosed);
      if (open) advBody.scrollIntoView({ block: 'nearest' }); // 右栏需要内部滚动时，把展开的内容带进视野
    },
  }, advChev, h(doc, 'span', { class: 'adv-title', id: 'adv-title', text: s.sections.advanced }),
  h(doc, 'span', { class: 'adv-sub', text: s.advancedSub }), holiday ? holiday.advSummary : null);
  advCard.append(h(doc, 'h2', { class: 'adv-heading' }, advToggle), advBody);

  const b = s.backup;
  const el = h(doc, 'div', { class: 'settings', id: 'settings' },
    h(doc, 'div', { class: 'set-grid settings-cols' },
      h(doc, 'div', { class: 'set-col settings-col' },
        card('pay', 'wallet', s.sections.pay, s.payDesc,
          row(label('salary', s.salary), [
            h(doc, 'span', { class: 'input-prefix-sign', 'aria-hidden': 'true', text: t.currency }),
            // 「¥」是输入框外的装饰，不进 value（不猜测修补用户的输入）
            input('salary', { type: 'text', inputmode: 'decimal', autocomplete: 'off', class: 'inp inp-money' }),
            h(doc, 'span', { class: 'unit', 'aria-hidden': 'true', text: s.salaryUnit }),
          ], fieldError('salary')),
          row(label('payday', s.payday), paydaySelect, hint('hint-payday', s.paydayHint), fieldError('payday')),
          sep(),
          timePair('work', s.workTime, 'start', s.start, 'end', s.end),
          switchRow('lunchOn', s.lunchOn, s.lunchOffHint),
          lunchTimes,
          switchRow('weekends', s.weekends, s.weekendsHint),
          sep(),
          row(label('cheer', s.cheer), [
            input('cheer', { type: 'text', placeholder: s.cheerPlaceholder, autocomplete: 'off', class: 'inp inp-wide', hintId: 'hint-cheer' }),
            cheerCount,
          ], hint('hint-cheer', s.cheerHint), fieldError('cheer')))),
      h(doc, 'div', { class: 'set-col settings-col' },
        card('holiday', 'holiday', s.sections.holiday, s.holidayDesc(builtinYears), holiday ? holiday.body : null),
        card('backup', 'data', s.sections.backup, s.backupDesc,
          // H6：导入报告紧跟卡头，导入后不用滚到卡片最下面才看得到结果和按钮
          report,
          h(doc, 'p', { class: 'para' }, h(doc, 'b', { text: b.exportLead }), b.exportText),
          h(doc, 'p', { class: 'para' }, h(doc, 'b', { text: b.importLead }), b.importText),
          h(doc, 'p', { class: 'para backup-scope', text: b.scope }),
          h(doc, 'div', { class: 'btn-row backup-actions' },
            h(doc, 'button', { type: 'button', class: 'btn btn-secondary btn-s', id: 'btn-export', text: b.export, onclick: onExport }),
            h(doc, 'button', { type: 'button', class: 'btn btn-secondary btn-s', id: 'btn-import', text: b.import, onclick: onImport }),
            h(doc, 'span', { class: 'warn-note backup-note' }, icon(doc, 'lock'), b.note))),
        advCard)));

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

  // M16：单栏（窄视窗）时整个设置分页内部滚动，mac 没有常驻滚动条——内容没到底时给底部渐隐提示，滚到底就收起。
  // 宽视窗下两栏各自滚动，.settings 本身不滚动，这里不加提示（不加高度，也不影响布局）。
  function refreshFade() {
    const scrolls = win.getComputedStyle(el).overflowY === 'auto' && el.scrollHeight - el.clientHeight > 1;
    const more = scrolls && el.scrollTop + el.clientHeight < el.scrollHeight - 1;
    el.classList.toggle('is-cut', more);
  }
  el.addEventListener('scroll', refreshFade, { passive: true });
  // 内容高度和滚动容器尺寸都可能独立变化，需要同时观察。
  if (typeof win.ResizeObserver === 'function') {
    const observer = new win.ResizeObserver(refreshFade);
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
  }

  return { el, autosave, sync, flashSaved, focusField, refreshFade };
}
