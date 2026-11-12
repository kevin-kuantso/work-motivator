// 设置分区：自动保存，无保存按钮。验证失败的字段不写入，保留上一个有效值并就地显示错误。
// 地区只有这一个选择入口：切换只回调父级（onRegionChange），父级提交后再用 applyState() 把权威设定同步回来。
import { validateSchedule, reasonText } from '../calc.js';
import { FONT_SCALES } from '../settings.js';
import { h, show, setText } from './dom.js';
import { icon } from './icons.js';

const CHEER_MAX = 40;
// 地区 ID 是稳定契约（TW / CN，与 settings 的 profile id 一致）。名称、说明、来源链接都来自 profile / 字典，
// 下面只是没有 profile 时的兜底文案：不写任何统计数值，也不写网址（网址只由 profile / 字典的元数据提供）。
const REGION_IDS = Object.freeze(['TW', 'CN']);
const REGION_FALLBACK = Object.freeze({ label: '', options: {}, hint: '', salaryNote: '', sourcesLabel: '', lunchOffPay: '' });
// 币种符号只由 profile 提供；没有 profile 时按地区 ID 兜底（不写死成单一「¥」）。
const REGION_CURRENCY = Object.freeze({ TW: 'NT$', CN: '¥' });

function parseSalary(s) {
  const v = s.trim();
  return /^\d+(\.\d+)?$/.test(v) ? Number(v) : NaN;
}

// 语义原因（code + params）→ 某个字段真正显示的文案。措辞按去处选，语义只有一份：
// 设置面板的月薪输入框说清楚「怎么输入才对」（只用半角数字、不加逗号、给个示例），
// 其他入口（导入报告的「月薪 · 中国大陆」、状态卡提示）继续用 reasons.salary 的通用说法。
// dict 与 settings 都由调用端传入「当前」字典，所以切地区 / 切语言后重译拿到的仍是本语言的说法；
// 字典缺 salaryError 时退回通用说法，绝不让错误变成空白。
export function fieldReasonText(field, reason, dict, settings) {
  if (!reason) return '';
  const specific = field === 'salary' && reason.code === 'salary' ? settings?.salaryError : '';
  if (typeof specific === 'string' && specific) return specific;
  if (reason.code) return reasonText(reason, dict) || reason.legacy || '';
  return reason.legacy || '';
}

// 版面（Task 14，redesign-v3）：两栏、有边框的卡片。左「工资与上班时间」（标签对齐同一条竖线）；
// 右「假期数据」「数据与备份」「高级设置」（折叠：整个卡头是展开按钮）。每张卡是 <section aria-labelledby> + 标题。
// holiday：{ body, advBody, advSummary }（假期数据卡的内容与高级设置里的自定义网址，见 holiday-panel.js）
// profile（可选）：{ id, currency, strings }，由父级在地区切换后传入当前地区的 profile。
// 地区名称/说明/示例出处来自字典（profile.strings 或构造时的 t）的 settings.region；
// 本文件只保留不含统计数值与网址的兜底文案。
export function createSettingsPanel(doc, t, {
  getCfg, getRegion = null, onRegionChange = null, onChange, onExport, onImport,
  report = null, holiday = null, builtinYears = [], profile = null,
}) {
  // s = 当前生效的 settings 文案。构造时用传入字典，setProfile 后与 profile.strings.settings 逐键合并：
  // 合并而非整体替换，profile 字典缺键时仍退回构造时的字典，不让一句文案缺失打断切换。
  const baseSettings = t.settings;
  const mergeSettings = (over) => {
    const o = over || {};
    return {
      ...baseSettings,
      ...o,
      sections: { ...baseSettings.sections, ...(o.sections || {}) },
      themeOptions: { ...baseSettings.themeOptions, ...(o.themeOptions || {}) },
      display: {
        ...baseSettings.display,
        ...(o.display || {}),
        // 档位文字的键集合不随语言变，但字典新增档位时也要能合并进来
        fontScaleOptions: { ...baseSettings.display?.fontScaleOptions, ...(o.display?.fontScaleOptions || {}) },
      },
      backup: { ...baseSettings.backup, ...(o.backup || {}) },
    };
  };
  let activeProfile = profile;
  let s = mergeSettings(activeProfile?.strings?.settings);
  // 已内建年份也跟着当前地区走：切地区后说明里的年份不能留在上一区（父级传入的只作兜底）
  const builtinYearsNow = () => {
    const tables = activeProfile?.holidayProvider?.tables;
    if (tables && typeof tables === 'object') {
      return Object.keys(tables)
        .filter((y) => tables[y] && tables[y].source === 'builtin')
        .map(Number)
        .filter((y) => Number.isFinite(y))
        .sort((a, b) => a - b);
    }
    return builtinYears;
  };
  const win = doc.defaultView;
  const inputs = {};
  const errors = {};
  const fieldReasons = {}; // field -> 语义化的校验结果（不是译文）：切语言后按当前字典重译
  const hints = {}; // field -> 提示节点：地区/字典切换后只改文案，不重建节点

  // 静态文案 / ARIA 登记：每条是一个「重画一次」的闭包。setProfile 只跑这些闭包：
  // 不重建行、不碰输入值、不移动焦点、不动折叠状态。
  const bound = []; // () => void
  const readText = (v) => (typeof v === 'function' ? v() : v);
  const bindText = (el, value) => {
    setText(el, readText(value));
    bound.push(() => setText(el, readText(value)));
    return el;
  };
  const bindAttr = (el, name, value) => {
    const apply = () => el.setAttribute(name, String(readText(value)));
    apply();
    bound.push(apply);
    return el;
  };
  // 建一个只放文案的节点，并登记它的文案来源（字符串或取当前字典的函数）
  const boundText = (tag, props, value) => bindText(h(doc, tag, props), value);
  function retranslate() {
    for (const f of bound) f();
  }

  function fieldError(field) {
    errors[field] = h(doc, 'p', { class: 'field-error row-msg', id: `err-${field}`, role: 'alert' });
    return errors[field];
  }
  const hint = (id, value) => boundText('p', { class: 'row-hint', id }, value);
  const describe = (...ids) => ids.filter(Boolean).join(' ');

  // 当前生效的字典：profile.strings 优先，其次构造时传入的字典。
  const activeDict = () => activeProfile?.strings || t;

  // 当前地区的文案：只用当前生效字典的 settings.region，缺的键回落到本文件的常量兜底。
  function regionCopy() {
    const fromDict = activeDict().settings?.region || {};
    return {
      ...REGION_FALLBACK,
      ...fromDict,
      options: { ...REGION_FALLBACK.options, ...(fromDict.options || {}) },
    };
  }

  function currentRegion() {
    const live = getRegion?.();
    if (REGION_IDS.includes(live)) return live;
    if (REGION_IDS.includes(inputs.region?.value)) return inputs.region.value;
    return 'CN';
  }

  // 出处链接必须是真的 https 绝对网址：原始字符串前 8 个字符是 https 加两个斜线（new URL 会把
  // 「https:foo」正规化成主机 foo，只靠解析会放过它），并且解析后协议为 https、有主机名、无账号密码。
  // 这里用字符比较而不是协议正则字面量：成品里只允许 holiday-store 的那一处协议正则（测试按次数核对）。
  function isHttpsUrl(s) {
    if (typeof s !== 'string' || s.length <= 8) return false;
    if (!s.startsWith('https') || s[5] !== ':' || s[6] !== '/' || s[7] !== '/') return false;
    try {
      const u = new URL(s);
      return u.protocol === 'https:' && Boolean(u.hostname) && !u.username && !u.password;
    } catch {
      return false;
    }
  }

  // 示例月薪的出处：只渲染结构化元数据 { text, sources:[{ label, href }] }（也接受按地区分组的
  // { TW: {...}, CN: {...} } 或纯字符串），从不推断数字或拼网址。不安全或缺失的条目整条丢弃。
  // 没有元数据时只显示本文件的通用兜底文案，绝不显示未经确认的统计值或链接。
  function normalizeNote(note) {
    if (typeof note === 'string') return { text: note, sources: [] };
    if (!note || typeof note !== 'object') return { text: REGION_FALLBACK.salaryNote, sources: [] };
    const sources = (Array.isArray(note.sources) ? note.sources : [])
      .filter((x) => x && typeof x.label === 'string' && x.label && isHttpsUrl(x.href));
    return { text: note.text || REGION_FALLBACK.salaryNote, sources };
  }

  function salaryNoteFor(region) {
    const notes = [activeDict().settings?.region?.salaryNote, activeDict().settings?.salaryNote];
    for (const note of notes) {
      if (typeof note === 'string') return normalizeNote(note);
      if (note && typeof note === 'object' && note[region]) return normalizeNote(note[region]);
      if (note && typeof note === 'object' && ('text' in note || 'sources' in note)) return normalizeNote(note);
    }
    return normalizeNote(null);
  }

  // 午休关闭时的说明：必须讲清「午休仍计入工时与薪资」。旧的 lunchOffHint 只提工时，因此优先用
  // 新的 lunchOffPay（字典或 profile 提供），没有时用本文件的完整兜底文案。
  const lunchHintText = () => activeProfile?.strings?.settings?.region?.lunchOffPay
    || activeDict().settings?.lunchOffPay
    || activeDict().settings?.region?.lunchOffPay
    || REGION_FALLBACK.lunchOffPay;

  // 币种符号：profile 明确给出且就是当前地区时用它，否则按地区 ID 兜底（兜底只是符号，不含统计信息；
  // 不借字典顶层的 currency，否则切到 TW 会显示成人民币符号）。
  function currencyFor(region) {
    const p = activeProfile;
    if (p?.currency && (!p.id || p.id === region)) return p.currency;
    return REGION_CURRENCY[region] || '';
  }

  function input(field, attrs = {}) {
    // hintId 允许一个 id 或 id 数组：多个说明节点按顺序拼接（顺序即读屏朗读顺序）
    const { hintId, ...rest } = attrs;
    const described = describe(...[].concat(hintId ?? []).filter(Boolean), `err-${field}`);
    inputs[field] = h(doc, 'input', { id: `f-${field}`, name: field, 'aria-describedby': described, ...rest });
    return inputs[field];
  }

  // 一行：标签 | 控件；提示与错误放在控件下方（同一条竖线）
  const row = (labelEl, ctrl, ...below) => h(doc, 'div', { class: 'row' }, labelEl, h(doc, 'div', { class: 'row-ctrl' }, ctrl), ...below);
  const label = (field, value) => bindText(h(doc, 'label', { class: 'row-label', for: `f-${field}` }), value);

  function switchRow(field, text, hintText) {
    const stateText = h(doc, 'span', { class: 'switch-state', 'aria-hidden': 'true' });
    inputs[field] = h(doc, 'input', {
      type: 'checkbox', role: 'switch', id: `f-${field}`, name: field, class: 'switch', 'aria-describedby': describe(hintText ? `hint-${field}` : null, `err-${field}`),
    });
    inputs[field].stateText = stateText;
    // 提示节点记下来：地区/字典切换后只改文案，不重建行（保留焦点与折叠状态）
    if (hintText) hints[field] = hint(`hint-${field}`, hintText);
    return row(label(field, text), [inputs[field], stateText], hints[field] || null, fieldError(field));
  }

  // 两个时间（上下班 / 午休）：一行一组；分组名称 = 行标签，输入框各有自己的名称
  // 组名与两个输入框的名称都登记进 bound：切语言后重新赋值，aria-label 不会留在旧语言。
  function timePair(id, groupLabel, a, aLabel, b, bLabel) {
    const lab = bindText(h(doc, 'span', { class: 'row-label', id: `lbl-${id}` }), groupLabel);
    const r = row(lab, [
      input(a, { type: 'time', class: 'inp inp-time', 'aria-label': aLabel }),
      boundText('span', { class: 'to', 'aria-hidden': 'true' }, () => s.to),
      input(b, { type: 'time', class: 'inp inp-time', 'aria-label': bLabel }),
    ], fieldError(a), fieldError(b));
    bindAttr(inputs[a], 'aria-label', aLabel);
    bindAttr(inputs[b], 'aria-label', bLabel);
    r.setAttribute('role', 'group');
    r.setAttribute('aria-labelledby', `lbl-${id}`);
    return r;
  }

  // id = 分区的稳定锚点（scard-*），供窄屏的分区导航跳转用；标题可被脚本聚焦（tabindex=-1），跳转后读屏从卡头读起。
  // title / desc 都登记重画：卡片标题与说明随语言切换，节点本身不重建。
  const card = (id, iconName, title, desc, ...body) =>
    h(doc, 'section', { class: `scard section-${id}`, id: `scard-${id}`, 'aria-labelledby': `card-${id}-title` },
      h(doc, 'div', { class: 'scard-head' },
        h(doc, 'h2', { class: 'scard-title', id: `card-${id}-title`, tabindex: '-1' }, icon(doc, iconName), bindText(h(doc, 'span'), title)),
        desc ? h(doc, 'p', { class: 'scard-desc' }, bindText(h(doc, 'span'), desc)) : null),
      h(doc, 'div', { class: 'scard-body' }, ...body));

  // 鼓励语：一句一个输入框，对应 cfg.cheers（字符串数组，允许空字符串——空串照样保存，但状态卡不显示）。
  // 至少保留一行：删到只剩一行时只清空该行内容，行本身不消失，焦点也留在原地。
  // 第一行沿用 <label for> 命名；第二行起用 aria-label 区分。所有行共用 hint-cheer / err-cheer 的描述。
  const cheerRows = []; // { input, count, remove, wrap }
  const cheerLen = (v) => [...(typeof v === 'string' ? v : '')].length;
  const cheerList = h(doc, 'div', { class: 'cheer-list' });
  const cheerAdd = h(doc, 'button', { type: 'button', class: 'btn btn-secondary btn-xs cheer-add' },
    bindText(h(doc, 'span'), () => s.cheerAdd));
  const cheerLabel = bindText(h(doc, 'label', { class: 'row-label', for: 'f-cheer' }), () => s.cheer);
  errors.cheers = h(doc, 'p', { class: 'field-error row-msg', id: 'err-cheer', role: 'alert' });
  const cheerRowEl = h(doc, 'div', { class: 'row row-cheer' },
    cheerLabel,
    h(doc, 'div', { class: 'row-ctrl' }, h(doc, 'div', { class: 'cheer-editor' }, cheerList, cheerAdd)),
    hint('hint-cheer', () => s.cheerHint),
    errors.cheers);
  cheerAdd.addEventListener('click', () => addCheer());

  function createCheerRow(value) {
    const rowInput = h(doc, 'input', {
      type: 'text', name: 'cheers', autocomplete: 'off', class: 'inp',
      'aria-describedby': 'hint-cheer err-cheer',
    });
    rowInput.value = typeof value === 'string' ? value : '';
    const count = h(doc, 'span', { class: 'cheer-count', 'aria-live': 'off' });
    const remove = h(doc, 'button', { type: 'button', class: 'btn btn-ghost btn-xs cheer-remove', text: '×' });
    const wrap = h(doc, 'div', { class: 'cheer-item' }, rowInput, count, remove);
    const r = { input: rowInput, count, remove, wrap };
    // 输入先刷本行计数，再把整个数组交给统一校验（逐句 40 字上限）
    rowInput.addEventListener('input', () => {
      setText(count, s.cheerCount(cheerLen(rowInput.value), CHEER_MAX));
      handle('cheers');
    });
    remove.addEventListener('click', () => removeCheer(cheerRows.indexOf(r)));
    cheerRows.push(r);
    cheerList.append(wrap);
    return r;
  }

  // id 是外部契约：#f-cheer 永远是第一个输入框，其余按顺序编号
  function renumber() {
    cheerRows.forEach((r, i) => { r.input.id = i === 0 ? 'f-cheer' : `f-cheer-${i + 1}`; });
  }

  function syncCounts() {
    for (const r of cheerRows) setText(r.count, s.cheerCount(cheerLen(r.input.value), CHEER_MAX));
  }

  // 占位符、行名与删除钮名称都来自当前字典：切语言后重画这几个属性，不重建行、不动焦点与值
  function applyRowCopy() {
    const itemLabel = (n) => (typeof s.cheerItemLabel === 'function' ? s.cheerItemLabel(n) : '');
    const removeLabel = (n) => (typeof s.cheerRemoveAria === 'function' ? s.cheerRemoveAria(n) : '');
    cheerRows.forEach((r, i) => {
      r.remove.hidden = cheerRows.length === 1;
      r.input.setAttribute('placeholder', typeof s.cheerPlaceholder === 'string' ? s.cheerPlaceholder : '');
      // 第一行由 <label for> 命名，不再加 aria-label（否则同一个框有两个名字）
      const name = i === 0 ? '' : itemLabel(i + 1);
      if (name) r.input.setAttribute('aria-label', name);
      else r.input.removeAttribute('aria-label');
      const rm = removeLabel(i + 1);
      if (rm) r.remove.setAttribute('aria-label', rm);
      else r.remove.removeAttribute('aria-label');
    });
    syncCounts();
  }

  function addCheer() {
    const r = createCheerRow('');
    renumber();
    applyRowCopy();
    r.input.focus();
    const end = r.input.value.length;
    try { r.input.setSelectionRange(end, end); } catch { /* 不支持选区时忽略 */ }
    handle('cheers');
  }

  function removeCheer(index) {
    const r = cheerRows[index];
    if (!r || cheerRows.length === 1) return;
    const hadFocus = r.wrap.contains(doc.activeElement);
    cheerRows.splice(index, 1);
    r.wrap.remove();
    renumber();
    applyRowCopy();
    // 删掉的正是焦点所在行：把焦点交给相邻的一行，别让键盘用户掉到 body
    if (hadFocus) cheerRows[Math.min(index, cheerRows.length - 1)].input.focus();
    handle('cheers');
  }

  function normalizeCheer(value) {
    const list = Array.isArray(value) ? value : [];
    const out = list.map((v) => (typeof v === 'string' ? v : ''));
    return out.length ? out : [''];
  }

  // 权威值 → 输入框行。只增删末尾的行并改写真的变了的框（改写会重设光标、打断 IME）。
  function writeCheer(value) {
    const want = normalizeCheer(value);
    const focusIdx = cheerRows.findIndex((r) => r.wrap.contains(doc.activeElement));
    let changed = false;
    while (cheerRows.length > want.length) {
      cheerRows.pop().wrap.remove();
      changed = true;
    }
    while (cheerRows.length < want.length) {
      createCheerRow('');
      changed = true;
    }
    want.forEach((v, i) => {
      if (cheerRows[i].input.value === v) return;
      cheerRows[i].input.value = v;
      changed = true;
    });
    if (!changed) return false;
    renumber();
    applyRowCopy();
    // 只有焦点所在的行被裁掉时才搬焦点（元素已不在文档里）；其余情况保持原焦点与光标
    if (focusIdx >= cheerRows.length) cheerRows[cheerRows.length - 1].input.focus();
    return true;
  }

  createCheerRow('');
  renumber();
  applyRowCopy();
  bound.push(applyRowCopy); // 切语言：重画占位符、行名、删除钮名称与计数
  // 下拉选项的文字是 locale 文案：选项节点保留（选中值、焦点、展开状态都不受影响），
  // 切语言后只重写每个 <option> 的 text。发薪日与主题色的取值集合不随语言变化。
  const paydayNoneEl = h(doc, 'option', { value: '' });
  const paydayOptEls = Array.from({ length: 31 }, (_, i) => h(doc, 'option', { value: String(i + 1) }));
  const bindOption = (el, value) => {
    bound.push(() => setText(el, readText(value)));
    setText(el, readText(value));
    return el;
  };
  bindOption(paydayNoneEl, () => s.paydayNone);
  paydayOptEls.forEach((el, i) => bindOption(el, () => s.paydayOption(i + 1)));
  const paydaySelect = h(doc, 'select', { id: 'f-payday', name: 'payday', class: 'sel', 'aria-describedby': 'hint-payday err-payday' },
    paydayNoneEl, ...paydayOptEls);
  inputs.payday = paydaySelect;
  const themeOptEls = Object.keys(s.themeOptions).map((value) => h(doc, 'option', { value }));
  // 主题键是稳定的储存契约；文案由字典提供。
  themeOptEls.forEach((el) => bindOption(el, () => s.themeOptions[el.value] ?? el.value));
  inputs.theme = h(doc, 'select', { id: 'f-theme', name: 'theme', class: 'sel', 'aria-describedby': 'err-theme' }, themeOptEls);

  // 地区：面板里唯一的地区入口（语言/币种/假日随它整组切换，不另设语言选择）。
  // 只回调 onRegionChange，配置由父级提交；父级不接受时这里把选择拨回父级状态，焦点不动。
  const regionLabelEl = h(doc, 'label', { class: 'row-label', for: 'f-region' });
  const regionOptionEls = Object.fromEntries(REGION_IDS.map((id) => [id, h(doc, 'option', { value: id })]));
  inputs.region = h(doc, 'select', {
    id: 'f-region', name: 'region', class: 'sel', 'aria-describedby': 'hint-region',
  }, REGION_IDS.map((id) => regionOptionEls[id]));
  // 地区名称、说明由 renderRegion 按当前字典写入，因此不进 bound（否则重译会被空值覆盖）
  const regionHint = h(doc, 'p', { class: 'row-hint', id: 'hint-region' });
  inputs.region.addEventListener('change', () => {
    const next = inputs.region.value;
    onRegionChange?.(next);
    renderRegion(); // 以父级状态为准：没被接受就停在原来的地区
  });

  // 币种符号与单位：随地区切换，符号只来自 profile（兜底表不含统计信息）。
  // 两者都是视觉装饰（aria-hidden），另外用一段视觉隐藏文字把「币种 + 单位」挂在输入框的描述里，
  // 否则读屏只知道字段叫「月薪」，不知道是 NT$ 还是人民币。
  const currencySign = h(doc, 'span', { class: 'input-prefix-sign', 'aria-hidden': 'true' });
  const unitEl = h(doc, 'span', { class: 'unit', 'aria-hidden': 'true' });
  const salaryUnitA11y = h(doc, 'span', { class: 'visually-hidden', id: 'hint-salary-unit' });
  // 示例月薪说明：文案与出处链接只由 profile / 字典的结构化元数据渲染，本文件不拼网址、不写统计数值
  const salaryNoteText = h(doc, 'span');
  const salarySources = h(doc, 'span', { class: 'salary-sources' });
  const salarySep = h(doc, 'span', { 'aria-hidden': 'true', hidden: true, text: ' ' });
  const salaryNote = h(doc, 'p', { class: 'row-hint', id: 'hint-salary' }, salaryNoteText, salarySep, salarySources);
  // 示例月薪的口径与出处要两三行：默认收起，输入框右边给一个展开钮。说明节点始终是 aria-describedby 的目标，
  // 收起时读屏仍念得到全文；展开钮只控制视觉占位，不复制文案。
  const salaryNoteChev = h(doc, 'span', { class: 'chev', 'aria-hidden': 'true' });
  const salaryNoteToggleText = h(doc, 'span');
  let salaryNoteOpen = false; // 展开状态是语义状态：切地区 / 切语言都不重置
  let salaryNoteHas = false; // 当前地区有没有说明（由 renderRegion 写入）
  const salaryNoteToggle = h(doc, 'button', {
    type: 'button', class: 'disclosure', id: 'btn-salary-note',
    'aria-expanded': 'false', 'aria-controls': 'hint-salary', hidden: true,
    onclick: () => setSalaryNote(!salaryNoteOpen),
  }, salaryNoteChev, salaryNoteToggleText);
  // 展开钮文案缺键时（只给了说明、没给标题的字典）就不折叠：宁可占版面，也不留一个无从展开的空白。
  const salaryToggleCopy = () => (typeof s.salaryNoteToggle === 'string' ? s.salaryNoteToggle : '');

  function applySalaryNote() {
    const collapsible = salaryNoteHas && Boolean(salaryToggleCopy());
    show(salaryNoteToggle, collapsible);
    show(salaryNote, salaryNoteHas && (!collapsible || salaryNoteOpen));
  }
  function applySalaryToggleCopy() {
    setText(salaryNoteChev, salaryNoteOpen ? (s.chevronOpen ?? '') : (s.chevronClosed ?? ''));
    setText(salaryNoteToggleText, salaryToggleCopy());
    // 读屏全名（含可见的「说明」二字，满足 WCAG 2.5.3）；字典没给就退回只用可见文字
    const aria = typeof s.salaryNoteToggleAria === 'string' ? s.salaryNoteToggleAria : '';
    if (aria) salaryNoteToggle.setAttribute('aria-label', aria);
    else salaryNoteToggle.removeAttribute('aria-label');
  }
  function setSalaryNote(open) {
    salaryNoteOpen = open;
    salaryNoteToggle.setAttribute('aria-expanded', String(open));
    applySalaryToggleCopy();
    applySalaryNote();
  }
  // 语言 / 地区切换后重画：箭头字形换成当前字典的，展开状态与焦点都不动。
  bound.push(() => {
    applySalaryToggleCopy();
    applySalaryNote();
  });

  // 把当前地区的选择、名称、说明、币种、示例出处与午休说明重画一遍。只动这些节点：
  // 不重建行、不碰其他输入框的 value，也不移动焦点（地区切换时用户可能正在改别的字段）。
  function renderRegion() {
    const copy = regionCopy();
    const region = currentRegion();
    // 当前地区排在前面；只移动现有 option，保留 select 与焦点。
    if (inputs.region.firstElementChild !== regionOptionEls[region]) {
      inputs.region.insertBefore(regionOptionEls[region], inputs.region.firstElementChild);
    }
    inputs.region.value = region;
    setText(regionLabelEl, copy.label);
    for (const id of REGION_IDS) setText(regionOptionEls[id], copy.options[id] || id);
    setText(regionHint, copy.hint);
    const cur = currencyFor(region);
    const unit = activeDict().settings?.salaryUnit || s.salaryUnit;
    setText(currencySign, cur);
    setText(unitEl, unit);
    setText(salaryUnitA11y, [cur, unit].filter(Boolean).join(' '));
    const note = salaryNoteFor(region);
    setText(salaryNoteText, note.text);
    const links = note.sources.map((src) => h(doc, 'a', {
      href: src.href, target: '_blank', rel: 'noopener noreferrer', text: src.label,
    }));
    // 「来源：」+ 链接，链接以空格分隔（不靠翻译文本拼接分隔符）
    salarySources.replaceChildren(...(links.length
      ? [h(doc, 'span', { text: copy.sourcesLabel }), ...links.flatMap((a, i) => (i ? [' ', a] : [a]))]
      : []));
    salarySources.hidden = links.length === 0;
    salarySep.hidden = !(note.text && links.length);
    // 有没有说明是「当前地区」的事实；显示与否还要看折叠状态与字典有没有展开钮的文案
    salaryNoteHas = Boolean(note.text || links.length);
    applySalaryNote();
    if (hints.lunchOn) setText(hints.lunchOn, lunchHintText());
  }

  const autosave = boundText('span', { class: 'autosave', hidden: true, role: 'status' }, () => s.autosaved);
  const lunchTimes = timePair('lunch', () => s.lunchTime, 'lunchStart', () => s.lunchStart, 'lunchEnd', () => s.lunchEnd);
  const sep = () => h(doc, 'div', { class: 'group-sep', 'aria-hidden': 'true' });

  // 高级设置（折叠，APG 手风琴：标题里放按钮）：卡头整个是按钮，右侧摘要「自定义数据网址：未设置 / 主机名」
  // 农历开关与来源说明也放在这里：默认折叠不占版面，避免两栏在矮视窗里溢出
  const advBody = h(doc, 'div', { class: 'scard-body adv-body', id: 'adv-body', hidden: true },
    holiday ? holiday.advBody : null,
    holiday ? sep() : null,
    switchRow('showLunar', () => s.showLunar),
    boundText('p', { class: 'para adv-source' }, () => s.lunarSource));
  const advChev = h(doc, 'span', { class: 'chev', 'aria-hidden': 'true' });
  const advCard = h(doc, 'section', { class: 'scard section-adv', id: 'scard-adv', 'aria-labelledby': 'adv-title' });
  const advToggle = h(doc, 'button', {
    type: 'button', class: 'adv-toggle adv-head', id: 'adv-toggle', 'aria-expanded': 'false', 'aria-controls': 'adv-body',
    onclick: () => {
      const open = advBody.hidden;
      setAdvOpen(open);
      if (open) advBody.scrollIntoView({ block: 'nearest' }); // 右栏需要内部滚动时，把展开的内容带进视野
    },
  }, advChev, boundText('span', { class: 'adv-title', id: 'adv-title' }, () => s.sections.advanced),
  boundText('span', { class: 'adv-sub' }, () => s.advancedSub), holiday ? holiday.advSummary : null);
  advCard.append(h(doc, 'h2', { class: 'adv-heading' }, advToggle), advBody);

  function setAdvOpen(open) {
    advBody.hidden = !open;
    advToggle.setAttribute('aria-expanded', String(open));
    advCard.classList.toggle('is-open', open);
    setText(advChev, open ? s.chevronOpen : s.chevronClosed);
  }

  // 画面设置：全局字号 + 五个显隐开关。只决定状态卡显示什么，不参与任何计算。
  // 档位是稳定 ID（xs…xl，存盘契约），文字由字典提供；选项节点保留，切语言只重写文字。
  const fontScaleOptEls = FONT_SCALES.map((value) => h(doc, 'option', { value }));
  fontScaleOptEls.forEach((el) => bindOption(el, () => s.display.fontScaleOptions?.[el.value] ?? el.value));
  inputs.fontScale = h(doc, 'select', {
    id: 'f-fontScale', name: 'fontScale', class: 'sel', 'aria-describedby': 'hint-fontScale err-fontScale',
  }, fontScaleOptEls);

  const displayCard = card('display', 'pip', () => s.sections.display, () => s.display.desc,
    row(label('theme', () => s.theme), inputs.theme, fieldError('theme')),
    cheerRowEl,
    sep(),
    row(label('fontScale', () => s.display.fontScale), inputs.fontScale,
      hint('hint-fontScale', () => s.display.fontScaleHint), fieldError('fontScale')),
    boundText('p', { class: 'para display-scope' }, () => s.display.scope),
    switchRow('showCardProgress', () => s.display.progress, () => s.display.progressHint),
    switchRow('showCardMetrics', () => s.display.metrics, () => s.display.metricsHint),
    switchRow('showCardDate', () => s.display.date, () => s.display.dateHint),
    switchRow('showCardPayday', () => s.display.payday, () => s.display.paydayHint),
    switchRow('showCardCheer', () => s.display.cheer, () => s.display.cheerHint),
    boundText('p', { class: 'para display-status-note' }, () => s.display.statusNote));

  const grid = h(doc, 'div', { class: 'set-grid settings-cols' },
    h(doc, 'div', { class: 'set-col settings-col' },
      card('pay', 'wallet', () => s.sections.pay, () => s.payDesc,
        row(regionLabelEl, inputs.region, regionHint),
        sep(),
        row(label('salary', () => s.salary), [
          currencySign,
          // 币种符号是输入框外的装饰，不进 value（不猜测修补用户的输入）
          input('salary', {
            type: 'text', inputmode: 'decimal', autocomplete: 'off', class: 'inp inp-money',
            hintId: ['hint-salary-unit', 'hint-salary'],
          }),
          unitEl,
          salaryNoteToggle,
        ], salaryUnitA11y, salaryNote, fieldError('salary')),
        row(label('payday', () => s.payday), paydaySelect, hint('hint-payday', () => s.paydayHint), fieldError('payday')),
        sep(),
        timePair('work', () => s.workTime, 'start', () => s.start, 'end', () => s.end),
        switchRow('lunchOn', () => s.lunchOn, () => s.lunchOffHint),
        lunchTimes,
        switchRow('weekends', () => s.weekends, () => s.weekendsHint)),
      displayCard),
    h(doc, 'div', { class: 'set-col settings-col' },
      card('holiday', 'holiday', () => s.sections.holiday, () => s.holidayDesc(builtinYearsNow()), holiday ? holiday.body : null),
      card('backup', 'data', () => s.sections.backup, () => s.backupDesc,
        // H6：导入报告紧跟卡头，导入后不用滚到卡片最下面才看得到结果和按钮
        report,
        // 一段说清备份内容 / 时机 / 恢复方式，按钮就在下面，不再各写一段导语
        boundText('p', { class: 'para backup-summary' }, () => s.backup.summary),
        boundText('p', { class: 'para backup-scope' }, () => s.backup.scope),
        h(doc, 'div', { class: 'btn-row backup-actions' },
          boundText('button', { type: 'button', class: 'btn btn-secondary btn-s', id: 'btn-export', onclick: onExport }, () => s.backup.export),
          boundText('button', { type: 'button', class: 'btn btn-secondary btn-s', id: 'btn-import', onclick: onImport }, () => s.backup.import),
          h(doc, 'span', { class: 'warn-note backup-note' }, icon(doc, 'lock'), bindText(h(doc, 'span'), () => s.backup.note)))),
      advCard));

  // 分区导航：显示与否完全交给 CSS（.settings-nav 桌面 display:none，窄屏才出现），所以这里不加 hidden、
  // 也不在 JS 里另判一次断点——display:none 的元素不会进 Tab 顺序，桌面两栏的体验与改动前一致。
  // 只跳转、不写 hash（避免历史与页面跳动），跳完把焦点交给该卡标题，读屏从卡头读起。
  function jumpTo(section) {
    if (section === 'adv') setAdvOpen(true); // 折叠着就滚到一行按钮：先展开
    const target = section === 'adv' ? advToggle : doc.getElementById(`card-${section}-title`);
    if (!target) return;
    target.focus({ preventScroll: true });
    (section === 'adv' ? advCard : doc.getElementById(`scard-${section}`))?.scrollIntoView({ block: 'start' });
    refreshFade();
  }
  // 导航链接的文字与卡头一致（section 键是稳定契约，adv 用 advanced）
  const navLinkText = (section) => () => s.sections[section === 'adv' ? 'advanced' : section];
  // 导航顺序与单栏卡片顺序一致。
  const nav = bindAttr(h(doc, 'nav', { class: 'settings-nav' },
    ['pay', 'display', 'holiday', 'backup', 'adv'].map((section) =>
      h(doc, 'a', {
        class: 'settings-nav-link', href: `#scard-${section}`,
        onclick: (e) => { e.preventDefault(); jumpTo(section); },
      }, bindText(h(doc, 'span'), navLinkText(section))))), 'aria-label', () => s.navLabel);

  const el = h(doc, 'div', { class: 'settings', id: 'settings' }, grid);
  grid.prepend(nav);

  const readers = {
    salary: (i) => parseSalary(i.value),
    start: (i) => i.value, end: (i) => i.value, lunchStart: (i) => i.value, lunchEnd: (i) => i.value,
    // 鼓励语是数组：忽略传入的单个输入框，永远从当前所有行取值（逐字段重试也用同一份真相）
    cheers: () => cheerRows.map((r) => r.input.value),
    lunchOn: (i) => i.checked, weekends: (i) => i.checked, showLunar: (i) => i.checked,
    // 画面设置：下拉只能选出白名单里的值，这里仍兜一层 —— 坏存档里的怪值不该让整个面板卡在无法保存。
    // 校验（丢值 + 回报）是 settings.js 的职责，面板只保证送出去的值永远合法。
    fontScale: (i) => (FONT_SCALES.includes(i.value) ? i.value : 'm'),
    showCardProgress: (i) => i.checked, showCardMetrics: (i) => i.checked,
    showCardDate: (i) => i.checked, showCardPayday: (i) => i.checked, showCardCheer: (i) => i.checked,
    payday: (i) => (i.value === '' ? null : Number(i.value)),
    theme: (i) => i.value,
  };

  // 校验结果 → 当前语言的文字。check() 回传结构化原因（code + params），绝不回传已翻译的句子：
  // 这样错误在显示时、切语言后、以及逐字段重试时都能按当时的字典重新措辞。
  // 翻译统一交给 calc 的 reasonText（同一份 code → 字典键映射，含 labels 查表与尚未补键的别名），
  // 本文件不再自己维护一份 switch：两边各写一份迟早会漂移。
  // 唯一的例外是月薪输入框的输入格式说明（settings.salaryError）——它讲的是「这个框怎么填」，
  // 比 reasons.salary 更具体；按 code 选措辞，所以仍然跟着当前字典重译，语义状态不变。
  // validateSchedule 若还回传旧式 reason 文字（迁移不同步时的过渡），就退化为原样显示，避免错误消失。
  function msgOf(field, reason) {
    return fieldReasonText(field, reason, activeDict(), s);
  }

  function setError(field, reason) {
    if (!errors[field]) return; // 不认识的字段：不凭空建节点，也不抛错
    fieldReasons[field] = reason ?? null;
    const msg = msgOf(field, reason);
    setText(errors[field], msg);
    // 鼓励语一字段多框：只把超长的那几行标成无效，其余行不受牵连
    if (field === 'cheers') {
      for (const r of cheerRows) {
        if (msg && cheerLen(r.input.value) > CHEER_MAX) r.input.setAttribute('aria-invalid', 'true');
        else r.input.removeAttribute('aria-invalid');
      }
      return;
    }
    if (msg) inputs[field].setAttribute('aria-invalid', 'true');
    else inputs[field].removeAttribute('aria-invalid');
  }

  function decorate(cfg) {
    lunchTimes.hidden = !cfg.lunchOn;
    // 开关右侧的状态字也随语言切换：地区/profile 变了以后不能还留着旧语言的「开 / 关」
    for (const f of ['lunchOn', 'weekends', 'showLunar',
      'showCardProgress', 'showCardMetrics', 'showCardDate', 'showCardPayday', 'showCardCheer']) {
      setText(inputs[f].stateText, inputs[f].checked ? s.on : s.off);
    }
    // 计数按输入框现况重算：校验失败、切语言、套用权威值时计数都要跟着当下看到的文字走
    syncCounts();
  }

  // 「已自动保存」用 CSS 的一次性淡出动画：同一个元素第二次显示时动画不会重播，先隐藏再强制重排一次，
  // 让动画从头开始（否则第二次以后的保存看起来像没保存）。失败时只隐藏，由储存警告条说明原因。
  let savedTimer = null;
  function flashSaved(ok = true) {
    win.clearTimeout(savedTimer);
    if (!ok) {
      show(autosave, false);
      return;
    }
    show(autosave, false);
    void autosave.offsetWidth; // 重排：重启动画
    show(autosave, true);
    savedTimer = win.setTimeout(() => show(autosave, false), 1500);
  }

  // validateSchedule 的结果 → 语义原因。
  // 新契约：{ ok:false, field, code, params:{ field } }（field 是出错字段，params.field 是字典 labels 的键）。
  // 旧契约：{ ok:false, field, reason }，reason 已是当时字典翻译好的句子 —— 保留为 legacy，仍然显示得出来，
  // 只是它不随语言重译（这是过渡形态；calc 已改为回传 code，正常路径不会走到这里）。
  // field 始终保留：错误要挂在真正出错的那个字段下，而不是用户刚编辑的那个。
  function checkReason(v) {
    if (v.code) return { field: v.field, code: v.code, params: v.params || (v.field ? { field: v.field } : undefined) };
    return { field: v.field, legacy: typeof v.reason === 'string' ? v.reason : '' };
  }

  function check(cfg) {
    // 鼓励语：一句话一项的字符串数组，每句最多 CHEER_MAX 个字符（按码点算，emoji 不会被拆成两个）。
    // 缺字段（undefined/null）按「一句空白」处理而不是报错：面板每行都会送出值，缺字段只可能是
    // 别的入口递进来的旧结构，报错会让整份设定永远存不进去（连带开关、月薪全部同步失败）。
    const cheers = cfg.cheers == null ? [''] : cfg.cheers;
    if (!Array.isArray(cheers) || cheers.length === 0) return { field: 'cheers', code: 'cheerType' };
    for (const item of cheers) {
      if (typeof item !== 'string') return { field: 'cheers', code: 'cheerType' };
      if ([...item].length > CHEER_MAX) return { field: 'cheers', code: 'cheerTooLong' };
    }
    const v = validateSchedule(cfg);
    if (v.ok) return null;
    return checkReason(v);
  }

  // 错误显示在哪个字段：校验回传的字段优先（认得才用），否则退回刚编辑的字段
  function errorFieldOf(reason, fallback) {
    return reason?.field && errors[reason.field] ? reason.field : fallback;
  }

  function handle(field) {
    const cur = getCfg();
    let next = { ...cur, [field]: readers[field](inputs[field]) };
    // 改的是别的字段、而当前设定里根本没有鼓励语（缺字段或是被别的入口塞进来的空数组）时，
    // 把面板里的这一组框一起带上：否则第一次改开关就会把鼓励语整段写丢，或者被一个永远补不上的
    // 校验错误（空数组不是合法数组）卡住，连带开关、月薪全部存不进去。
    if (field !== 'cheers' && (next.cheers == null || (Array.isArray(next.cheers) && !next.cheers.length))) {
      next = { ...next, cheers: readers.cheers() };
    }
    const reason = check(next);
    const target = errorFieldOf(reason, field);
    // 刚编辑的字段先清旧错误，再把新错误挂到真正出错的字段（可能不是它自己）
    setError(field, target === field ? reason : null);
    if (target !== field) setError(target, reason);
    if (reason) {
      flashSaved(false);
      decorate({ ...cur, lunchOn: inputs.lunchOn.checked });
      return;
    }
    // 其他仍显示错误的字段：在新值基础上再试一次（例如改上班时间后，原本无效的下班时间变得有效）。
    // 仍然无效时只在它自己仍是出错字段时更新，避免把别的字段的原因挂过来。
    for (const f of Object.keys(errors)) {
      if (f === field || !fieldReasons[f]) continue;
      const retry = { ...next, [f]: readers[f](inputs[f]) };
      const m = check(retry);
      if (!m) next = retry;
      if (!m) setError(f, null);
      else if (m.field === f) setError(f, m);
    }
    decorate(next);
    onChange(next);
    // 送出去了：这份值现在是权威值，记进快照，免得下次同步把它当成还没送出的草稿。
    // 仍是草稿的字段（值有效但整份设定当时还无效、没能送出）不在 next 里，自然继续算草稿。
    if (applied) for (const f of Object.keys(readers)) applied[f] = next[f];
  }

  for (const field of Object.keys(readers)) {
    // 鼓励语没有单一控件：每一行在自己的 createCheerRow 里接了 input 监听
    if (!inputs[field]) continue;
    const evt = inputs[field].type === 'checkbox' || inputs[field].tagName === 'SELECT' ? 'change' : 'input';
    inputs[field].addEventListener(evt, () => handle(field));
  }

  // 外部来源（本地切区、汇入备份、远端 storage、开页）唯一的同步入口。
  // 逐个输入框比较三份值：输入框现值、上次写入的权威值（applied）、这次要套用的权威值（cfg）。
  // 现值既不等于上次权威值、也不等于新权威值时，它就是用户还没送出的草稿 —— 原样保留（连同它已显示的
  // 校验原因），只改写其余的框。这样远端改设定、汇入备份都不会吃掉正在输入的内容，
  // 也不必为每个字段维护「脏标记」：handle() 送出成功后把 applied 更新成提交值即可。
  let applied = null; // field -> 上次写入输入框的权威值；null = 还没同步过
  let appliedRegion = null; // 上次套用的地区：用来分辨这次是不是换了地区

  // NaN 走 Object.is 会判为相等（Object.is(NaN, NaN) === true），但月薪空/乱填都是 NaN，
  // 这里要的是「两个 NaN 视为同一份无效值」，所以显式写上。
  // 数组字段（鼓励语）要逐项比较：同一个数组对象以外，内容相同也算同一份值
  const sameValue = (a, b) => {
    if (Array.isArray(a) && Array.isArray(b)) {
      return a.length === b.length && a.every((v, i) => sameValue(v, b[i]));
    }
    return Object.is(a, b) || (Number.isNaN(a) && Number.isNaN(b));
  };

  function isDraft(field, cfg) {
    if (!applied) return false;
    const cur = readers[field](inputs[field]);
    return !sameValue(cur, applied[field]) && !sameValue(cur, cfg[field]);
  }

  // 权威值 → 输入框能表示的值。字号只接受白名单：坏存档 / 被手改成怪值的备份按中号显示，
  // 不要让下拉落在一个不存在的选项上（那样 select.value 会是空字串，看起来像「没有字号」）。
  // 快照（applied）与写值共用这一层：两边不一致时，非法值会被永远当成「还没送出的草稿」，面板再也同步不动。
  const normalizeValue = (field, value) => {
    if (field === 'cheers') return normalizeCheer(value);
    return field === 'fontScale' && !FONT_SCALES.includes(value) ? 'm' : value;
  };

  // 写值只在真的变了的时候动手：改写会重设光标位置，还会打断 IME，等于把焦点挖走一半。
  // 回传 true 表示输入框的内容确实被权威值替换了（该字段的旧校验原因随之作废）。
  function writeValue(field, value) {
    // 鼓励语是一组框：只增删末尾的行、只改写内容真的变了的框
    if (field === 'cheers') return writeCheer(value);
    const input = inputs[field];
    if (input.type === 'checkbox') {
      const want = Boolean(value);
      if (input.checked === want) return false;
      input.checked = want;
      return true;
    }
    // 字号只接受白名单：坏存档 / 被手改成怪值的备份按中号显示
    const norm = normalizeValue(field, value);
    const str = norm === null || norm === undefined ? '' : String(norm);
    if (input.value === str) return false;
    input.value = str;
    return true;
  }

  function applyState(cfg, region = null) {
    const nextRegion = REGION_IDS.includes(region) ? region : currentRegion();
    // 用自己记下的上次地区判断，而不是 getRegion()：父级在调用前就已经把 state.region 改成新值了。
    const regionChanged = appliedRegion !== null && nextRegion !== appliedRegion;
    if (inputs.region.value !== nextRegion) inputs.region.value = nextRegion;
    const eff = {}; // 由输入框现况组成的生效设定：保留草稿后，面板里的实际状态
    let drafts = 0;
    for (const field of Object.keys(readers)) {
      // 月薪属于地区而不是共享偏好：换地区时一律换成新地区的值，
      // 旧地区的草稿（或未送出的数字）不能留在新地区的月薪框里。
      const forced = field === 'salary' && regionChanged;
      if (!forced && isDraft(field, cfg)) {
        drafts++;
        eff[field] = readers[field](inputs[field]);
        continue; // 草稿：值与错误都保持原样
      }
      const rewritten = writeValue(field, cfg[field]);
      eff[field] = readers[field](inputs[field]);
      // 只有内容真的被权威值替换，这个框自己的错误才作废。「值没变」不构成作废理由：
      // 跨字段的原因可能挂在没被改写的框上（上班时间改成比下班还晚，原因挂在下班时间上），
      // 而那份原因此刻仍然成立（草稿还在）。
      if (rewritten || forced) setError(field, null);
    }
    // 一个草稿都不剩：任何还留着的错误都是陈旧状态，整批清掉。
    if (drafts === 0) for (const field of Object.keys(errors)) setError(field, null);
    // 快照记的是权威值，不是输入框现值：否则保留下来的草稿会在下一次同步时被当成已套用。
    // 也必须与 writeValue 用同一层正规化：非法字号写进框里是「m」，快照若留原值，
    // 这个字段会永远被判成草稿，整块面板再也同步不到新设定。
    applied = {};
    for (const field of Object.keys(readers)) applied[field] = normalizeValue(field, cfg[field]);
    appliedRegion = nextRegion;
    decorate(eff);
    renderRegion();
  }

  // 语言（字典）与地区 profile 切换的唯一入口：先换字典，再重画本文件拥有的一切静态文案、ARIA、
  // 选项文字、地区说明和字段错误。全部是就地改写文本，不重建 DOM、不重挂载、不碰输入值、不移动焦点，
  // 也不改变已展开的高级设置与下拉框的当前值。
  function setProfile(next) {
    if (next) activeProfile = next;
    s = mergeSettings(activeDict().settings);
    if (REGION_IDS.includes(next?.id || '')) inputs.region.value = next.id;
    retranslate(); // 标签、提示、按钮、选项文字、卡片标题、导航与 ARIA
    // 已显示的错误按新字典重译（语义原因才是真相，节点文字只是投影）
    for (const f of Object.keys(fieldReasons)) setError(f, fieldReasons[f]);
    // 地区文案、币种、单位与示例出处
    renderRegion();
    // 开关状态字、鼓励语计数、午休时段行的显隐
    decorate({ ...getCfg(), lunchOn: inputs.lunchOn.checked });
    setText(advChev, advBody.hidden ? s.chevronClosed : s.chevronOpen);
    return { ok: true, profileId: activeProfile?.id || null, locale: activeProfile?.locale || null };
  }

  function focusField(field) {
    // 鼓励语：优先把焦点交给超长的那一行（导入报告/校验失败指到的就是它）
    if (field === 'cheer' || field === 'cheers') {
      const bad = cheerRows.find((r) => cheerLen(r.input.value) > CHEER_MAX);
      (bad || cheerRows[0]).input.focus();
      return;
    }
    const salaryRegion = field.startsWith('salaries.') ? field.slice('salaries.'.length) : null;
    const input = salaryRegion ? (salaryRegion === currentRegion() ? inputs.salary : inputs.region) : inputs[field];
    if (!input) return;
    // 农历开关在折叠的高级设置里：先把容器展开，否则 focus 落在不可见元素上
    if (advBody.contains(input)) setAdvOpen(true);
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

  setAdvOpen(false); // 折叠是初始状态：先给箭头写上字典文字，别等到第一次展开才有内容
  applySalaryToggleCopy(); // 同上：先给示例说明的展开钮写上字典文字与箭头
  renderRegion(); // 构造时先按当前地区画一遍（父级的 applyState 随后会填上权威值）

  return { el, autosave, applyState, setProfile, flashSaved, focusField, refreshFade };
}
