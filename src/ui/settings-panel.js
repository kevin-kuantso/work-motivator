// 設定分割槽：自動儲存，無儲存按鈕。驗證失敗的欄位不寫入，保留上一個有效值並就地顯示錯誤。
// 地區只有這一個選擇入口：切換隻回撥父級（onRegionChange），父級提交後再用 applyState() 把權威設定同步回來。
import { validateSchedule, reasonText } from '../calc.js';
import { FONT_SCALES } from '../settings.js';
import { h, show, setText } from './dom.js';
import { icon } from './icons.js';

const CHEER_MAX = 40;
// 地區 ID 是穩定契約（TW / CN，與 settings 的 profile id 一致）。名稱、說明、來源連結都來自 profile / 字典，
// 下面只是沒有 profile 時的兜底文案：不寫任何統計數值，也不寫網址（網址只由 profile / 字典的後設資料提供）。
const REGION_IDS = Object.freeze(['TW', 'CN']);
const REGION_FALLBACK = Object.freeze({ label: '', options: {}, hint: '', salaryNote: '', sourcesLabel: '', lunchOffPay: '' });
// 幣種符號只由 profile 提供；沒有 profile 時按地區 ID 兜底（不寫死成單一「¥」）。
const REGION_CURRENCY = Object.freeze({ TW: 'NT$', CN: '¥' });

function parseSalary(s) {
  const v = s.trim();
  return /^\d+(\.\d+)?$/.test(v) ? Number(v) : NaN;
}

// 語義原因（code + params）→ 某個欄位真正顯示的文案。措辭按去處選，語義只有一份：
// 設定面板的月薪輸入框說清楚「怎麼輸入才對」（只用半形數字、不加逗號、給個示例），
// 其他入口（匯入報告的「月薪 · 中國大陸」、狀態卡提示）繼續用 reasons.salary 的通用說法。
// dict 與 settings 都由呼叫端傳入「當前」字典，所以切地區 / 切語言後重譯拿到的仍是本語言的說法；
// 字典缺 salaryError 時退回通用說法，絕不讓錯誤變成空白。
export function fieldReasonText(field, reason, dict, settings) {
  if (!reason) return '';
  const specific = field === 'salary' && reason.code === 'salary' ? settings?.salaryError : '';
  if (typeof specific === 'string' && specific) return specific;
  if (reason.code) return reasonText(reason, dict) || reason.legacy || '';
  return reason.legacy || '';
}

// 版面（Task 14，redesign-v3）：兩欄、有邊框的卡片。左「工資與上班時間」（標籤對齊同一條豎線）；
// 右「假期資料」「資料與備份」「進階設定」（摺疊：整個卡頭是展開按鈕）。每張卡是 <section aria-labelledby> + 標題。
// holiday：{ body, advBody, advSummary }（假期資料卡的內容與進階設定裡的自定義網址，見 holiday-panel.js）
// profile（可選）：{ id, currency, strings }，由父級在地區切換後傳入當前地區的 profile。
// 地區名稱/說明/示例出處來自字典（profile.strings 或構造時的 t）的 settings.region；
// 本檔案只保留不含統計數值與網址的兜底文案。
export function createSettingsPanel(doc, t, {
  getCfg, getRegion = null, onRegionChange = null, onChange, onExport, onImport,
  report = null, holiday = null, builtinYears = [], profile = null,
}) {
  // s = 當前生效的 settings 文案。構造時用傳入字典，setProfile 後與 profile.strings.settings 逐鍵合併：
  // 合併而非整體替換，profile 字典缺鍵時仍退回構造時的字典，不讓一句文案缺失打斷切換。
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
        // 檔位文字的鍵集合不隨語言變，但字典新增檔位時也要能合併進來
        fontScaleOptions: { ...baseSettings.display?.fontScaleOptions, ...(o.display?.fontScaleOptions || {}) },
      },
      backup: { ...baseSettings.backup, ...(o.backup || {}) },
    };
  };
  let activeProfile = profile;
  let s = mergeSettings(activeProfile?.strings?.settings);
  // 已內建年份也跟著當前地區走：切地區後說明裡的年份不能留在上一區（父級傳入的只作兜底）
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
  const fieldReasons = {}; // field -> 語義化的校驗結果（不是譯文）：切語言後按當前字典重譯
  const hints = {}; // field -> 提示節點：地區/字典切換後只改文案，不重建節點

  // 靜態文案 / ARIA 登記：每條是一個「重畫一次」的閉包。setProfile 只跑這些閉包：
  // 不重建行、不碰輸入值、不移動焦點、不動摺疊狀態。
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
  // 建一個只放文案的節點，並登記它的文案來源（字串或取當前字典的函式）
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

  // 當前生效的字典：profile.strings 優先，其次構造時傳入的字典。
  const activeDict = () => activeProfile?.strings || t;

  // 當前地區的文案：只用當前生效字典的 settings.region，缺的鍵回落到本檔案的常量兜底。
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

  // 出處連結必須是真的 https 絕對網址：原始字串前 8 個字元是 https 加兩個斜線（new URL 會把
  // 「https:foo」正規化成主機 foo，只靠解析會放過它），並且解析後協議為 https、有主機名、無賬號密碼。
  // 這裡用字元比較而不是協議正則字面量：成品裡只允許 holiday-store 的那一處協議正則（測試按次數核對）。
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

  // 示例月薪的出處：只渲染結構化後設資料 { text, sources:[{ label, href }] }（也接受按地區分組的
  // { TW: {...}, CN: {...} } 或純字串），從不推斷數字或拼網址。不安全或缺失的條目整條丟棄。
  // 沒有後設資料時只顯示本檔案的通用兜底文案，絕不顯示未經確認的統計值或連結。
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

  // 午休關閉時的說明：必須講清「午休仍計入工時與薪資」。舊的 lunchOffHint 只提工時，因此優先用
  // 新的 lunchOffPay（字典或 profile 提供），沒有時用本檔案的完整兜底文案。
  const lunchHintText = () => activeProfile?.strings?.settings?.region?.lunchOffPay
    || activeDict().settings?.lunchOffPay
    || activeDict().settings?.region?.lunchOffPay
    || REGION_FALLBACK.lunchOffPay;

  // 幣種符號：profile 明確給出且就是當前地區時用它，否則按地區 ID 兜底（兜底只是符號，不含統計資訊；
  // 不借字典頂層的 currency，否則切到 TW 會顯示成人民幣符號）。
  function currencyFor(region) {
    const p = activeProfile;
    if (p?.currency && (!p.id || p.id === region)) return p.currency;
    return REGION_CURRENCY[region] || '';
  }

  function input(field, attrs = {}) {
    // hintId 允許一個 id 或 id 陣列：多個說明節點按順序拼接（順序即讀屏朗讀順序）
    const { hintId, ...rest } = attrs;
    const described = describe(...[].concat(hintId ?? []).filter(Boolean), `err-${field}`);
    inputs[field] = h(doc, 'input', { id: `f-${field}`, name: field, 'aria-describedby': described, ...rest });
    return inputs[field];
  }

  // 一行：標籤 | 控制元件；提示與錯誤放在控制元件下方（同一條豎線）
  const row = (labelEl, ctrl, ...below) => h(doc, 'div', { class: 'row' }, labelEl, h(doc, 'div', { class: 'row-ctrl' }, ctrl), ...below);
  const label = (field, value) => bindText(h(doc, 'label', { class: 'row-label', for: `f-${field}` }), value);

  function switchRow(field, text, hintText) {
    const stateText = h(doc, 'span', { class: 'switch-state', 'aria-hidden': 'true' });
    inputs[field] = h(doc, 'input', {
      type: 'checkbox', role: 'switch', id: `f-${field}`, name: field, class: 'switch', 'aria-describedby': describe(hintText ? `hint-${field}` : null, `err-${field}`),
    });
    inputs[field].stateText = stateText;
    // 提示節點記下來：地區/字典切換後只改文案，不重建行（保留焦點與摺疊狀態）
    if (hintText) hints[field] = hint(`hint-${field}`, hintText);
    return row(label(field, text), [inputs[field], stateText], hints[field] || null, fieldError(field));
  }

  // 兩個時間（上下班 / 午休）：一行一組；分組名稱 = 行標籤，輸入框各有自己的名稱
  // 組名與兩個輸入框的名稱都登記進 bound：切語言後重新賦值，aria-label 不會留在舊語言。
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

  // id = 分割槽的穩定錨點（scard-*），供窄屏的分割槽導航跳轉用；標題可被指令碼聚焦（tabindex=-1），跳轉後讀屏從卡頭讀起。
  // title / desc 都登記重畫：卡片標題與說明隨語言切換，節點本身不重建。
  const card = (id, iconName, title, desc, ...body) =>
    h(doc, 'section', { class: `scard section-${id}`, id: `scard-${id}`, 'aria-labelledby': `card-${id}-title` },
      h(doc, 'div', { class: 'scard-head' },
        h(doc, 'h2', { class: 'scard-title', id: `card-${id}-title`, tabindex: '-1' }, icon(doc, iconName), bindText(h(doc, 'span'), title)),
        desc ? h(doc, 'p', { class: 'scard-desc' }, bindText(h(doc, 'span'), desc)) : null),
      h(doc, 'div', { class: 'scard-body' }, ...body));

  // 鼓勵語：一句一個輸入框，對應 cfg.cheers（字串陣列，允許空字串——空串照樣儲存，但狀態卡不顯示）。
  // 至少保留一行：刪到只剩一行時只清空該行內容，行本身不消失，焦點也留在原地。
  // 第一行沿用 <label for> 命名；第二行起用 aria-label 區分。所有行共用 hint-cheer / err-cheer 的描述。
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
    // 輸入先刷本行計數，再把整個陣列交給統一校驗（逐句 40 字上限）
    rowInput.addEventListener('input', () => {
      setText(count, s.cheerCount(cheerLen(rowInput.value), CHEER_MAX));
      handle('cheers');
    });
    remove.addEventListener('click', () => removeCheer(cheerRows.indexOf(r)));
    cheerRows.push(r);
    cheerList.append(wrap);
    return r;
  }

  // id 是外部契約：#f-cheer 永遠是第一個輸入框，其餘按順序編號
  function renumber() {
    cheerRows.forEach((r, i) => { r.input.id = i === 0 ? 'f-cheer' : `f-cheer-${i + 1}`; });
  }

  function syncCounts() {
    for (const r of cheerRows) setText(r.count, s.cheerCount(cheerLen(r.input.value), CHEER_MAX));
  }

  // 佔位符、行名與刪除鈕名稱都來自當前字典：切語言後重畫這幾個屬性，不重建行、不動焦點與值
  function applyRowCopy() {
    const itemLabel = (n) => (typeof s.cheerItemLabel === 'function' ? s.cheerItemLabel(n) : '');
    const removeLabel = (n) => (typeof s.cheerRemoveAria === 'function' ? s.cheerRemoveAria(n) : '');
    cheerRows.forEach((r, i) => {
      r.remove.hidden = cheerRows.length === 1;
      r.input.setAttribute('placeholder', typeof s.cheerPlaceholder === 'string' ? s.cheerPlaceholder : '');
      // 第一行由 <label for> 命名，不再加 aria-label（否則同一個框有兩個名字）
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
    try { r.input.setSelectionRange(end, end); } catch { /* 不支援選區時忽略 */ }
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
    // 刪掉的正是焦點所在行：把焦點交給相鄰的一行，別讓鍵盤使用者掉到 body
    if (hadFocus) cheerRows[Math.min(index, cheerRows.length - 1)].input.focus();
    handle('cheers');
  }

  function normalizeCheer(value) {
    const list = Array.isArray(value) ? value : [];
    const out = list.map((v) => (typeof v === 'string' ? v : ''));
    return out.length ? out : [''];
  }

  // 權威值 → 輸入框行。只增刪末尾的行並改寫真的變了的框（改寫會重設游標、打斷 IME）。
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
    // 只有焦點所在的行被裁掉時才搬焦點（元素已不在文件裡）；其餘情況保持原焦點與游標
    if (focusIdx >= cheerRows.length) cheerRows[cheerRows.length - 1].input.focus();
    return true;
  }

  createCheerRow('');
  renumber();
  applyRowCopy();
  bound.push(applyRowCopy); // 切語言：重畫佔位符、行名、刪除鈕名稱與計數
  // 下拉選項的文字是 locale 文案：選項節點保留（選中值、焦點、展開狀態都不受影響），
  // 切語言後只重寫每個 <option> 的 text。發薪日與主題色的取值集合不隨語言變化。
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
  // 主題鍵是穩定的儲存契約；文案由字典提供。
  themeOptEls.forEach((el) => bindOption(el, () => s.themeOptions[el.value] ?? el.value));
  inputs.theme = h(doc, 'select', { id: 'f-theme', name: 'theme', class: 'sel', 'aria-describedby': 'err-theme' }, themeOptEls);

  // 地區：面板裡唯一的地區入口（語言/幣種/假日隨它整組切換，不另設語言選擇）。
  // 只回調 onRegionChange，配置由父級提交；父級不接受時這裡把選擇撥回父級狀態，焦點不動。
  const regionLabelEl = h(doc, 'label', { class: 'row-label', for: 'f-region' });
  const regionOptionEls = Object.fromEntries(REGION_IDS.map((id) => [id, h(doc, 'option', { value: id })]));
  inputs.region = h(doc, 'select', {
    id: 'f-region', name: 'region', class: 'sel', 'aria-describedby': 'hint-region',
  }, REGION_IDS.map((id) => regionOptionEls[id]));
  // 地區名稱、說明由 renderRegion 按當前字典寫入，因此不進 bound（否則重譯會被空值覆蓋）
  const regionHint = h(doc, 'p', { class: 'row-hint', id: 'hint-region' });
  inputs.region.addEventListener('change', () => {
    const next = inputs.region.value;
    onRegionChange?.(next);
    renderRegion(); // 以父級狀態為準：沒被接受就停在原來的地區
  });

  // 幣種符號與單位：隨地區切換，符號只來自 profile（兜底表不含統計資訊）。
  // 兩者都是視覺裝飾（aria-hidden），另外用一段視覺隱藏文字把「幣種 + 單位」掛在輸入框的描述裡，
  // 否則讀屏只知道欄位叫「月薪」，不知道是 NT$ 還是人民幣。
  const currencySign = h(doc, 'span', { class: 'input-prefix-sign', 'aria-hidden': 'true' });
  const unitEl = h(doc, 'span', { class: 'unit', 'aria-hidden': 'true' });
  const salaryUnitA11y = h(doc, 'span', { class: 'visually-hidden', id: 'hint-salary-unit' });
  // 示例月薪說明：文案與出處連結只由 profile / 字典的結構化後設資料渲染，本檔案不拼網址、不寫統計數值
  const salaryNoteText = h(doc, 'span');
  const salarySources = h(doc, 'span', { class: 'salary-sources' });
  const salarySep = h(doc, 'span', { 'aria-hidden': 'true', hidden: true, text: ' ' });
  const salaryNote = h(doc, 'p', { class: 'row-hint', id: 'hint-salary' }, salaryNoteText, salarySep, salarySources);
  // 示例月薪的口徑與出處要兩三行：預設收起，輸入框右邊給一個展開鈕。說明節點始終是 aria-describedby 的目標，
  // 收起時讀屏仍念得到全文；展開鈕只控制視覺佔位，不復制文案。
  const salaryNoteChev = h(doc, 'span', { class: 'chev', 'aria-hidden': 'true' });
  const salaryNoteToggleText = h(doc, 'span');
  let salaryNoteOpen = false; // 展開狀態是語義狀態：切地區 / 切語言都不重置
  let salaryNoteHas = false; // 當前地區有沒有說明（由 renderRegion 寫入）
  const salaryNoteToggle = h(doc, 'button', {
    type: 'button', class: 'disclosure', id: 'btn-salary-note',
    'aria-expanded': 'false', 'aria-controls': 'hint-salary', hidden: true,
    onclick: () => setSalaryNote(!salaryNoteOpen),
  }, salaryNoteChev, salaryNoteToggleText);
  // 展開鈕文案缺鍵時（只給了說明、沒給標題的字典）就不折疊：寧可佔版面，也不留一個無從展開的空白。
  const salaryToggleCopy = () => (typeof s.salaryNoteToggle === 'string' ? s.salaryNoteToggle : '');

  function applySalaryNote() {
    const collapsible = salaryNoteHas && Boolean(salaryToggleCopy());
    show(salaryNoteToggle, collapsible);
    show(salaryNote, salaryNoteHas && (!collapsible || salaryNoteOpen));
  }
  function applySalaryToggleCopy() {
    setText(salaryNoteChev, salaryNoteOpen ? (s.chevronOpen ?? '') : (s.chevronClosed ?? ''));
    setText(salaryNoteToggleText, salaryToggleCopy());
    // 讀屏全名（含可見的「說明」二字，滿足 WCAG 2.5.3）；字典沒給就退回只用可見文字
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
  // 語言 / 地區切換後重畫：箭頭字形換成當前字典的，展開狀態與焦點都不動。
  bound.push(() => {
    applySalaryToggleCopy();
    applySalaryNote();
  });

  // 把當前地區的選擇、名稱、說明、幣種、示例出處與午休說明重畫一遍。只動這些節點：
  // 不重建行、不碰其他輸入框的 value，也不移動焦點（地區切換時使用者可能正在改別的欄位）。
  function renderRegion() {
    const copy = regionCopy();
    const region = currentRegion();
    // 當前地區排在前面；只移動現有 option，保留 select 與焦點。
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
    // 「來源：」+ 連結，連結以空格分隔（不靠翻譯文本拼接分隔符）
    salarySources.replaceChildren(...(links.length
      ? [h(doc, 'span', { text: copy.sourcesLabel }), ...links.flatMap((a, i) => (i ? [' ', a] : [a]))]
      : []));
    salarySources.hidden = links.length === 0;
    salarySep.hidden = !(note.text && links.length);
    // 有沒有說明是「當前地區」的事實；顯示與否還要看摺疊狀態與字典有沒有展開鈕的文案
    salaryNoteHas = Boolean(note.text || links.length);
    applySalaryNote();
    if (hints.lunchOn) setText(hints.lunchOn, lunchHintText());
  }

  const autosave = boundText('span', { class: 'autosave', hidden: true, role: 'status' }, () => s.autosaved);
  const lunchTimes = timePair('lunch', () => s.lunchTime, 'lunchStart', () => s.lunchStart, 'lunchEnd', () => s.lunchEnd);
  const sep = () => h(doc, 'div', { class: 'group-sep', 'aria-hidden': 'true' });

  // 進階設定（摺疊，APG 手風琴：標題裡放按鈕）：卡頭整個是按鈕，右側摘要「自定義資料網址：未設定 / 主機名」
  // 農曆開關與來源說明也放在這裡：預設摺疊不佔版面，避免兩欄在矮視窗裡溢位
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
      if (open) advBody.scrollIntoView({ block: 'nearest' }); // 右欄需要內部滾動時，把展開的內容帶進視野
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

  // 畫面設定：全域性字號 + 五個顯隱開關。只決定狀態卡顯示什麼，不參與任何計算。
  // 檔位是穩定 ID（xs…xl，存檔契約），文字由字典提供；選項節點保留，切語言只重寫文字。
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
          // 幣種符號是輸入框外的裝飾，不進 value（不猜測修補使用者的輸入）
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
        // H6：匯入報告緊跟卡頭，匯入後不用滾到卡片最下面才看得到結果和按鈕
        report,
        // 一段說清備份內容 / 時機 / 恢復方式，按鈕就在下面，不再各寫一段導語
        boundText('p', { class: 'para backup-summary' }, () => s.backup.summary),
        boundText('p', { class: 'para backup-scope' }, () => s.backup.scope),
        h(doc, 'div', { class: 'btn-row backup-actions' },
          boundText('button', { type: 'button', class: 'btn btn-secondary btn-s', id: 'btn-export', onclick: onExport }, () => s.backup.export),
          boundText('button', { type: 'button', class: 'btn btn-secondary btn-s', id: 'btn-import', onclick: onImport }, () => s.backup.import),
          h(doc, 'span', { class: 'warn-note backup-note' }, icon(doc, 'lock'), bindText(h(doc, 'span'), () => s.backup.note)))),
      advCard));

  // 分割槽導航：顯示與否完全交給 CSS（.settings-nav 桌面 display:none，窄屏才出現），所以這裡不加 hidden、
  // 也不在 JS 裡另判一次斷點——display:none 的元素不會進 Tab 順序，桌面兩欄的體驗與改動前一致。
  // 只跳轉、不寫 hash（避免歷史與頁面跳動），跳完把焦點交給該卡標題，讀屏從卡頭讀起。
  function jumpTo(section) {
    if (section === 'adv') setAdvOpen(true); // 摺疊著就滾到一行按鈕：先展開
    const target = section === 'adv' ? advToggle : doc.getElementById(`card-${section}-title`);
    if (!target) return;
    target.focus({ preventScroll: true });
    (section === 'adv' ? advCard : doc.getElementById(`scard-${section}`))?.scrollIntoView({ block: 'start' });
    refreshFade();
  }
  // 導航連結的文字與卡頭一致（section 鍵是穩定契約，adv 用 advanced）
  const navLinkText = (section) => () => s.sections[section === 'adv' ? 'advanced' : section];
  // 導航順序與單欄卡片順序一致。
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
    // 鼓勵語是陣列：忽略傳入的單個輸入框，永遠從當前所有行取值（逐欄位重試也用同一份真相）
    cheers: () => cheerRows.map((r) => r.input.value),
    lunchOn: (i) => i.checked, weekends: (i) => i.checked, showLunar: (i) => i.checked,
    // 畫面設定：下拉只能選出白名單裡的值，這裡仍兜一層 —— 壞存檔裡的怪值不該讓整個面板卡在無法儲存。
    // 校驗（丟值 + 回報）是 settings.js 的職責，面板只保證送出去的值永遠合法。
    fontScale: (i) => (FONT_SCALES.includes(i.value) ? i.value : 'm'),
    showCardProgress: (i) => i.checked, showCardMetrics: (i) => i.checked,
    showCardDate: (i) => i.checked, showCardPayday: (i) => i.checked, showCardCheer: (i) => i.checked,
    payday: (i) => (i.value === '' ? null : Number(i.value)),
    theme: (i) => i.value,
  };

  // 校驗結果 → 當前語言的文字。check() 回傳結構化原因（code + params），絕不回傳已翻譯的句子：
  // 這樣錯誤在顯示時、切語言後、以及逐欄位重試時都能按當時的字典重新措辭。
  // 翻譯統一交給 calc 的 reasonText（同一份 code → 字典鍵對映，含 labels 查表與尚未補鍵的別名），
  // 本檔案不再自己維護一份 switch：兩邊各寫一份遲早會漂移。
  // 唯一的例外是月薪輸入框的輸入格式說明（settings.salaryError）——它講的是「這個框怎麼填」，
  // 比 reasons.salary 更具體；按 code 選措辭，所以仍然跟著當前字典重譯，語義狀態不變。
  // validateSchedule 若還回傳舊式 reason 文字（遷移不同步時的過渡），就退化為原樣顯示，避免錯誤消失。
  function msgOf(field, reason) {
    return fieldReasonText(field, reason, activeDict(), s);
  }

  function setError(field, reason) {
    if (!errors[field]) return; // 不認識的欄位：不憑空建節點，也不拋錯
    fieldReasons[field] = reason ?? null;
    const msg = msgOf(field, reason);
    setText(errors[field], msg);
    // 鼓勵語一欄位多框：只把超長的那幾行標成無效，其餘行不受牽連
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
    // 開關右側的狀態字也隨語言切換：地區/profile 變了以後不能還留著舊語言的「開 / 關」
    for (const f of ['lunchOn', 'weekends', 'showLunar',
      'showCardProgress', 'showCardMetrics', 'showCardDate', 'showCardPayday', 'showCardCheer']) {
      setText(inputs[f].stateText, inputs[f].checked ? s.on : s.off);
    }
    // 計數按輸入框現況重算：校驗失敗、切語言、套用權威值時計數都要跟著當下看到的文字走
    syncCounts();
  }

  // 「已自動儲存」用 CSS 的一次性淡出動畫：同一個元素第二次顯示時動畫不會重播，先隱藏再強制重排一次，
  // 讓動畫從頭開始（否則第二次以後的儲存看起來像沒儲存）。失敗時只隱藏，由儲存警告條說明原因。
  let savedTimer = null;
  function flashSaved(ok = true) {
    win.clearTimeout(savedTimer);
    if (!ok) {
      show(autosave, false);
      return;
    }
    show(autosave, false);
    void autosave.offsetWidth; // 重排：重啟動畫
    show(autosave, true);
    savedTimer = win.setTimeout(() => show(autosave, false), 1500);
  }

  // validateSchedule 的結果 → 語義原因。
  // 新契約：{ ok:false, field, code, params:{ field } }（field 是出錯欄位，params.field 是字典 labels 的鍵）。
  // 舊契約：{ ok:false, field, reason }，reason 已是當時字典翻譯好的句子 —— 保留為 legacy，仍然顯示得出來，
  // 只是它不隨語言重譯（這是過渡形態；calc 已改為回傳 code，正常路徑不會走到這裡）。
  // field 始終保留：錯誤要掛在真正出錯的那個欄位下，而不是使用者剛編輯的那個。
  function checkReason(v) {
    if (v.code) return { field: v.field, code: v.code, params: v.params || (v.field ? { field: v.field } : undefined) };
    return { field: v.field, legacy: typeof v.reason === 'string' ? v.reason : '' };
  }

  function check(cfg) {
    // 鼓勵語：一句話一項的字串陣列，每句最多 CHEER_MAX 個字元（按碼點算，emoji 不會被拆成兩個）。
    // 缺欄位（undefined/null）按「一句空白」處理而不是報錯：面板每行都會送出值，缺欄位只可能是
    // 別的入口遞進來的舊結構，報錯會讓整份設定永遠存不進去（連帶開關、月薪全部同步失敗）。
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

  // 錯誤顯示在哪個欄位：校驗回傳的欄位優先（認得才用），否則退回剛編輯的欄位
  function errorFieldOf(reason, fallback) {
    return reason?.field && errors[reason.field] ? reason.field : fallback;
  }

  function handle(field) {
    const cur = getCfg();
    let next = { ...cur, [field]: readers[field](inputs[field]) };
    // 改的是別的欄位、而當前設定里根本沒有鼓勵語（缺欄位或是被別的入口塞進來的空陣列）時，
    // 把面板裡的這一組框一起帶上：否則第一次改開關就會把鼓勵語整段寫丟，或者被一個永遠補不上的
    // 校驗錯誤（空陣列不是合法陣列）卡住，連帶開關、月薪全部存不進去。
    if (field !== 'cheers' && (next.cheers == null || (Array.isArray(next.cheers) && !next.cheers.length))) {
      next = { ...next, cheers: readers.cheers() };
    }
    const reason = check(next);
    const target = errorFieldOf(reason, field);
    // 剛編輯的欄位先清舊錯誤，再把新錯誤掛到真正出錯的欄位（可能不是它自己）
    setError(field, target === field ? reason : null);
    if (target !== field) setError(target, reason);
    if (reason) {
      flashSaved(false);
      decorate({ ...cur, lunchOn: inputs.lunchOn.checked });
      return;
    }
    // 其他仍顯示錯誤的欄位：在新值基礎上再試一次（例如改上班時間後，原本無效的下班時間變得有效）。
    // 仍然無效時只在它自己仍是出錯欄位時更新，避免把別的欄位的原因掛過來。
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
    // 送出去了：這份值現在是權威值，記進快照，免得下次同步把它當成還沒送出的草稿。
    // 仍是草稿的欄位（值有效但整份設定當時還無效、沒能送出）不在 next 裡，自然繼續算草稿。
    if (applied) for (const f of Object.keys(readers)) applied[f] = next[f];
  }

  for (const field of Object.keys(readers)) {
    // 鼓勵語沒有單一控制元件：每一行在自己的 createCheerRow 裡接了 input 監聽
    if (!inputs[field]) continue;
    const evt = inputs[field].type === 'checkbox' || inputs[field].tagName === 'SELECT' ? 'change' : 'input';
    inputs[field].addEventListener(evt, () => handle(field));
  }

  // 外部來源（本地切區、匯入備份、遠端 storage、開頁）唯一的同步入口。
  // 逐個輸入框比較三份值：輸入框現值、上次寫入的權威值（applied）、這次要套用的權威值（cfg）。
  // 現值既不等於上次權威值、也不等於新權威值時，它就是使用者還沒送出的草稿 —— 原樣保留（連同它已顯示的
  // 校驗原因），只改寫其餘的框。這樣遠端改設定、匯入備份都不會吃掉正在輸入的內容，
  // 也不必為每個欄位維護「髒標記」：handle() 送出成功後把 applied 更新成提交值即可。
  let applied = null; // field -> 上次寫入輸入框的權威值；null = 還沒同步過
  let appliedRegion = null; // 上次套用的地區：用來分辨這次是不是換了地區

  // NaN 走 Object.is 會判為相等（Object.is(NaN, NaN) === true），但月薪空/亂填都是 NaN，
  // 這裡要的是「兩個 NaN 視為同一份無效值」，所以顯式寫上。
  // 陣列欄位（鼓勵語）要逐項比較：同一個陣列物件以外，內容相同也算同一份值
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

  // 權威值 → 輸入框能表示的值。字號只接受白名單：壞存檔 / 被手改成怪值的備份按中號顯示，
  // 不要讓下拉落在一個不存在的選項上（那樣 select.value 會是空字串，看起來像「沒有字號」）。
  // 快照（applied）與寫值共用這一層：兩邊不一致時，非法值會被永遠當成「還沒送出的草稿」，面板再也同步不動。
  const normalizeValue = (field, value) => {
    if (field === 'cheers') return normalizeCheer(value);
    return field === 'fontScale' && !FONT_SCALES.includes(value) ? 'm' : value;
  };

  // 寫值只在真的變了的時候動手：改寫會重設游標位置，還會打斷 IME，等於把焦點挖走一半。
  // 回傳 true 表示輸入框的內容確實被權威值替換了（該欄位的舊校驗原因隨之作廢）。
  function writeValue(field, value) {
    // 鼓勵語是一組框：只增刪末尾的行、只改寫內容真的變了的框
    if (field === 'cheers') return writeCheer(value);
    const input = inputs[field];
    if (input.type === 'checkbox') {
      const want = Boolean(value);
      if (input.checked === want) return false;
      input.checked = want;
      return true;
    }
    // 字號只接受白名單：壞存檔 / 被手改成怪值的備份按中號顯示
    const norm = normalizeValue(field, value);
    const str = norm === null || norm === undefined ? '' : String(norm);
    if (input.value === str) return false;
    input.value = str;
    return true;
  }

  function applyState(cfg, region = null) {
    const nextRegion = REGION_IDS.includes(region) ? region : currentRegion();
    // 用自己記下的上次地區判斷，而不是 getRegion()：父級在呼叫前就已經把 state.region 改成新值了。
    const regionChanged = appliedRegion !== null && nextRegion !== appliedRegion;
    if (inputs.region.value !== nextRegion) inputs.region.value = nextRegion;
    const eff = {}; // 由輸入框現況組成的生效設定：保留草稿後，面板裡的實際狀態
    let drafts = 0;
    for (const field of Object.keys(readers)) {
      // 月薪屬於地區而不是共享偏好：換地區時一律換成新地區的值，
      // 舊地區的草稿（或未送出的數字）不能留在新地區的月薪框裡。
      const forced = field === 'salary' && regionChanged;
      if (!forced && isDraft(field, cfg)) {
        drafts++;
        eff[field] = readers[field](inputs[field]);
        continue; // 草稿：值與錯誤都保持原樣
      }
      const rewritten = writeValue(field, cfg[field]);
      eff[field] = readers[field](inputs[field]);
      // 只有內容真的被權威值替換，這個框自己的錯誤才作廢。「值沒變」不構成作廢理由：
      // 跨欄位的原因可能掛在沒被改寫的框上（上班時間改成比下班還晚，原因掛在下班時間上），
      // 而那份原因此刻仍然成立（草稿還在）。
      if (rewritten || forced) setError(field, null);
    }
    // 一個草稿都不剩：任何還留著的錯誤都是陳舊狀態，整批清掉。
    if (drafts === 0) for (const field of Object.keys(errors)) setError(field, null);
    // 快照記的是權威值，不是輸入框現值：否則保留下來的草稿會在下一次同步時被當成已套用。
    // 也必須與 writeValue 用同一層正規化：非法字號寫進框裡是「m」，快照若留原值，
    // 這個欄位會永遠被判成草稿，整塊面板再也同步不到新設定。
    applied = {};
    for (const field of Object.keys(readers)) applied[field] = normalizeValue(field, cfg[field]);
    appliedRegion = nextRegion;
    decorate(eff);
    renderRegion();
  }

  // 語言（字典）與地區 profile 切換的唯一入口：先換字典，再重畫本檔案擁有的一切靜態文案、ARIA、
  // 選項文字、地區說明和欄位錯誤。全部是就地改寫文本，不重建 DOM、不重掛載、不碰輸入值、不移動焦點，
  // 也不改變已展開的進階設定與下拉框的當前值。
  function setProfile(next) {
    if (next) activeProfile = next;
    s = mergeSettings(activeDict().settings);
    if (REGION_IDS.includes(next?.id || '')) inputs.region.value = next.id;
    retranslate(); // 標籤、提示、按鈕、選項文字、卡片標題、導航與 ARIA
    // 已顯示的錯誤按新字典重譯（語義原因才是真相，節點文字只是投影）
    for (const f of Object.keys(fieldReasons)) setError(f, fieldReasons[f]);
    // 地區文案、幣種、單位與示例出處
    renderRegion();
    // 開關狀態字、鼓勵語計數、午休時段行的顯隱
    decorate({ ...getCfg(), lunchOn: inputs.lunchOn.checked });
    setText(advChev, advBody.hidden ? s.chevronClosed : s.chevronOpen);
    return { ok: true, profileId: activeProfile?.id || null, locale: activeProfile?.locale || null };
  }

  function focusField(field) {
    // 鼓勵語：優先把焦點交給超長的那一行（匯入報告/校驗失敗指到的就是它）
    if (field === 'cheer' || field === 'cheers') {
      const bad = cheerRows.find((r) => cheerLen(r.input.value) > CHEER_MAX);
      (bad || cheerRows[0]).input.focus();
      return;
    }
    const salaryRegion = field.startsWith('salaries.') ? field.slice('salaries.'.length) : null;
    const input = salaryRegion ? (salaryRegion === currentRegion() ? inputs.salary : inputs.region) : inputs[field];
    if (!input) return;
    // 農曆開關在摺疊的進階設定裡：先把容器展開，否則 focus 落在不可見元素上
    if (advBody.contains(input)) setAdvOpen(true);
    input.focus();
  }

  // M16：單欄（窄視窗）時整個設定分頁內部滾動，mac 沒有常駐捲軸——內容沒到底時給底部漸隱提示，滾到底就收起。
  // 寬視窗下兩欄各自滾動，.settings 本身不滾動，這裡不加提示（不加高度，也不影響佈局）。
  function refreshFade() {
    const scrolls = win.getComputedStyle(el).overflowY === 'auto' && el.scrollHeight - el.clientHeight > 1;
    const more = scrolls && el.scrollTop + el.clientHeight < el.scrollHeight - 1;
    el.classList.toggle('is-cut', more);
  }
  el.addEventListener('scroll', refreshFade, { passive: true });
  // 內容高度和滾動容器尺寸都可能獨立變化，需要同時觀察。
  if (typeof win.ResizeObserver === 'function') {
    const observer = new win.ResizeObserver(refreshFade);
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
  }

  setAdvOpen(false); // 摺疊是初始狀態：先給箭頭寫上字典文字，別等到第一次展開才有內容
  applySalaryToggleCopy(); // 同上：先給示例說明的展開鈕寫上字典文字與箭頭
  renderRegion(); // 構造時先按當前地區畫一遍（父級的 applyState 隨後會填上權威值）

  return { el, autosave, applyState, setProfile, flashSaved, focusField, refreshFade };
}
