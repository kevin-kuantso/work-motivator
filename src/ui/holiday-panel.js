// 基本設定 › 假期資料（年份膠囊、「檢查更新」「匯入假期表文件」各帶一行說明、單一結果區、可展開的格式示例）
// 與 進階設定 › 自定義資料網址。只負責畫面；流程在 holiday-update.js。所有文字走 textContent（聯網來的資料從不當 HTML）。
// profile（可選）：{ id, locale, currency, strings }。setProfile() 就地重畫全部文案/ARIA/按鈕/示例，不重建 DOM。
// getOperationToken（可選）：父級的地區代數 getter。文件讀取開始時同步取一次，讀完若已切區就整份丟棄。
// 地區差異：臺灣沒有線上檢查（單一離線檔跨來源抓官方資料集可能被 CORS 擋下；尚未逐一驗證），
// 整列「檢查更新」連同說明都藏起來，
// 只留手動匯入官方 CSV 並明說這條路；大陸保留「檢查更新」原樣（含檢查中的焦點與狀態）。
// 年份膠囊的 kind（builtin／online／file／missing）在兩區共用：臺灣先前存下的線上表仍標成線上，不改稱匯入。
import { h, show, setText } from './dom.js';
import { TW_MAX_BYTES } from '../holiday-data-tw.js';
import { icon } from './icons.js';

// 地區 ID 是穩定契約；只在父級沒給 profile / getRegion 時兜底。
const REGION_TW = 'TW';
const REGION_CN = 'CN';
// 文件選擇器的可接受型別：臺灣只接受官方 CSV，大陸沿用年度 JSON。
const ACCEPT = Object.freeze({ TW: '.csv,text/csv,application/csv', CN: '.json,application/json' });

// 讀檔的先後順序：每次選擇都取一個單調遞增的序號，只有「最後一次選擇」才允許把結果交給流程。
// 讀一個幾百 KB 的 CSV 要幾毫秒到幾百毫秒；這段期間再選一個文件、或切到別的地區再選，
// 先開始的那次讀完不能蓋掉後來的選擇（成功、失敗、換區都算）。
// 令牌在 await 之前同步取：讀完才知道期間有沒有換區；序號則決定「誰是最新的選擇」。
// 單獨匯出以便不依賴 DOM 驗證這段順序契約（面板本身只負責把選擇器接上來）。
export function createImportReader({
  getToken, isStale, onImport, maxBytes = TW_MAX_BYTES, regionTw = REGION_TW,
}) {
  let seq = 0;
  async function readFile(file, region) {
    try {
      // 先看大小：臺灣的官方 CSV 一年約 20～30 KB，超過上限不必讀進記憶體
      if (region === regionTw && file.size > maxBytes) return { text: null, readError: 'tooLarge' };
      const text = region === regionTw
        ? new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer())
        : await file.text();
      return { text, readError: undefined };
    } catch {
      // 讀檔失敗：臺灣傳 null（流程據此說「讀不到／不是 UTF-8」），大陸沿用空字串的舊契約
      return { text: region === regionTw ? null : '', readError: undefined };
    }
  }
  async function select(file) {
    if (!file) return { delivered: false, empty: true };
    const mine = ++seq;
    const token = getToken();
    const region = token?.region ?? REGION_CN;
    const { text, readError } = await readFile(file, region);
    // 期間又選了別的文件（這臺文件選擇器一次只顯示一個結果）：這次讀數作廢，不呼叫、不提示
    if (mine !== seq) return { delivered: false, superseded: true };
    // 已經切區/換代：這次讀取屬於舊地區，不呼叫、不提示、不寫表（父級不必再判斷）
    if (isStale(token)) return { delivered: false, stale: true };
    onImport(text, readError);
    return { delivered: true };
  }
  return { select, seq: () => seq };
}

export function createHolidayPanel(doc, t, {
  onCheck, onImportText, onCustomUrl, getOperationToken = null, getRegion = null, profile = null,
}) {
  const win = doc.defaultView;
  let checking = false;
  let activeProfile = profile;
  // 字典：profile 給了 holidayUpdate 就用它整份替換（完整鍵契約），否則退回構造時的字典。
  // 整份替換而不是逐鍵合併：繁體字典缺鍵時寧可留空，也不能把中國專用的節名、gov.cn 說明漏進臺灣介面。
  const baseU = t?.holidayUpdate || {};
  const dictSettings = () => activeProfile?.strings?.settings || t?.settings || {};
  const dictU = () => activeProfile?.strings?.holidayUpdate || baseU;
  let U = dictU();
  // 上次的完整狀態：切語言後按它重畫，而不是解析已經譯好的句子
  let lastStatus = null;

  // ---- 地區與代數（切換期間完成的非同步工作一律丟棄） ----
  let lastRegion = REGION_CN;
  let generation = 0;
  function regionNow() {
    const live = getRegion?.();
    if (live) return live;
    // profile 可以帶 region（父級也可以只用 id）：兩者都是穩定 ID，不靠文案判斷
    if (activeProfile?.region) return activeProfile.region;
    if (activeProfile?.id) return activeProfile.id;
    return lastRegion || REGION_CN;
  }
  // 每次真正換地區：本地代數 +1，讓切換瞬間還在跑的文件讀取全部作廢。
  function noteRegion() {
    const r = regionNow();
    if (r !== lastRegion) {
      lastRegion = r;
      generation += 1;
    }
    return lastRegion;
  }
  lastRegion = regionNow();

  // 操作令牌：開始時同步捕獲（地區 + 本地代數 + 父級代數），完成時用它判斷是否已經屬於舊地區。
  function tokenNow() {
    // 先確認地區：父級可能還沒呼叫 setProfile 就已經換了地區（狀態由 getRegion 讀得到），
    // 這時也要換代，免得這次讀檔用舊地區的規則（例如把臺灣的 CSV 當大陸 JSON 讀）。
    const region = noteRegion();
    return { region, generation, external: getOperationToken ? getOperationToken() : null };
  }
  function isStale(token) {
    if (!token || typeof token !== 'object') return false;
    if (token.region !== regionNow() || token.generation !== generation) return true;
    if (getOperationToken && getOperationToken() !== token.external) return true;
    return false;
  }
  // 讀檔順序：令牌同步取（讀完才知道有沒有換區），序號決定「誰是最新的一次選擇」。
  const reader = createImportReader({
    getToken: tokenNow,
    isStale,
    onImport: (text, readError) => onImportText(text, readError),
  });

  // ---- 靜態文案登記：每條閉包在 setProfile 時重跑一次 ----
  const bound = [];
  const readText = (v) => (typeof v === 'function' ? v() : v);
  function bindText(el, value) {
    const apply = () => setText(el, readText(value) ?? '');
    apply();
    bound.push(apply);
    return el;
  }
  function bindAttr(el, name, value) {
    const apply = () => el.setAttribute(name, String(readText(value) ?? ''));
    apply();
    bound.push(apply);
    return el;
  }
  const boundText = (tag, props, value) => bindText(h(doc, tag, props), value);
  function retranslate() {
    for (const f of bound) f();
  }

  // 字典裡的字串或 (params) 函式統一取文字；缺鍵返回 ''，不回退到別的語言。
  // params 裡的元素若是 { code, params }，就是流程層傳來的「失敗程式碼」規格：按 codes 表用當前字典翻，
  // 而不是沿用流程發出當時那句話（否則切語言後 detail 會新舊夾雜）。
  function paramText(v) {
    if (!v || typeof v !== 'object' || Array.isArray(v) || !v.code) return v;
    const table = U.codes;
    const f = table && table[v.code];
    if (typeof f === 'function') return f(v.params ?? {});
    if (typeof f === 'string' && f) return f;
    return typeof U.codeGeneric === 'function' ? U.codeGeneric(v.code) : '';
  }
  function dictText(key, params) {
    const v = U[key];
    const list = Array.isArray(params) ? params : null;
    const args = list ? list.map(paramText) : params;
    // 句子裡的失敗程式碼在這一版字典翻不出來（例如跨地區殘留的規格）：整句不顯示，不吐半句話
    if (list && list.some((p) => p && typeof p === 'object' && !Array.isArray(p) && p.code) && args.includes('')) return '';
    if (typeof v === 'function') return (Array.isArray(args) ? v(...args) : v(args)) ?? '';
    return typeof v === 'string' ? v : '';
  }
  // 結構化結果 { key, params, text }：優先按當前字典重譯，其次用它自帶的文字（舊流程形態）
  function specText(spec) {
    if (!spec) return '';
    // 舊式生產者的結果/細節是已經譯好的字串（大陸 updater 仍是這種形狀）：原樣顯示，不解析
    if (typeof spec === 'string') return spec;
    const k = spec.key ?? spec.code;
    if (k && U[k] !== undefined) return dictText(k, spec.params);
    return typeof spec.text === 'string' ? spec.text : '';
  }

  // 年份膠囊 + 右側「上次檢查」。整行是一個具名分組，名稱就是完整的一句（「假期資料狀態：…」），
  // 膠囊本身對讀屏隱藏，避免相鄰膠囊的文字連成一串
  const chips = h(doc, 'span', { class: 'hstatus-chips', 'aria-hidden': 'true' });
  const lastCheck = h(doc, 'span', { class: 'chip-note', 'aria-hidden': 'true' });
  const line = h(doc, 'div', { class: 'hstatus', id: 'holiday-status', role: 'group' }, chips, lastCheck);
  // 沒有狀態時念字典的「狀態」標籤本身（與原實現一致），有狀態才念拼好的整句。
  // update() 與 setProfile() 共用同一個寫入口，避免兩處寫法漂移。
  const lineAriaText = () => (lastStatus ? (U.statusAria ? U.statusAria(lineText()) : lineText()) : U.statusLabel || '');
  const lineAria = () => line.setAttribute('aria-label', String(readText(lineAriaText) ?? ''));
  lineAria();
  bound.push(lineAria);
  // 檢查中用 aria-disabled 而不是 disabled：按鈕保留焦點（disabled 會把鍵盤焦點丟到 body）
  const checkBtn = h(doc, 'button', {
    type: 'button', class: 'btn btn-secondary btn-s', id: 'btn-holiday-check',
    'aria-describedby': 'hint-holiday-check',
    onclick: () => { if (!checking) onCheck(); },
  });
  bindText(checkBtn, () => (checking ? U.checking : U.check));
  const fileInput = h(doc, 'input', {
    type: 'file', accept: ACCEPT[lastRegion] || ACCEPT.CN, class: 'visually-hidden', tabindex: '-1', 'aria-hidden': 'true', id: 'holiday-file',
    onchange: async () => {
      const file = fileInput.files && fileInput.files[0];
      // 先清空選擇器：同一個文件連續選兩次也要能觸發 change
      fileInput.value = '';
      if (!file) return;
      // 讀檔與順序判定在 reader 裡（readError／換區／期間又選了別的文件都在那裡處理）
      await reader.select(file);
    },
  });
  const importBtn = h(doc, 'button', {
    type: 'button', class: 'btn btn-secondary btn-s', id: 'btn-holiday-import',
    'aria-describedby': 'hint-holiday-import',
    onclick: () => fileInput.click(),
  });
  bindText(importBtn, () => U.importFile);
  // 結果文字用一個常駐的 Text 節點寫，結果前的 ✓ 才能留在同一個 span 裡不被 setText 清掉（L7）
  const resultText = h(doc, 'span', { class: 'holiday-result-text' });
  const resultTextNode = doc.createTextNode('');
  const resultCheck = icon(doc, 'check'); // 純裝飾（icon() 已 aria-hidden）；只有標了 check 的結果才加
  resultText.append(resultTextNode);
  const resultDetail = h(doc, 'span', { class: 'holiday-result-detail' });
  const result = h(doc, 'p', { class: 'holiday-result', id: 'holiday-result', role: 'status', 'aria-live': 'polite', hidden: true }, resultText, resultDetail);

  // 「檢視匯入文件的格式示例」：可複製的等寬示例 + 兩行白話；地址是可選取的文字，不是連結
  const code = h(doc, 'pre', { class: 'code', id: 'holiday-example-code' });
  const copyState = h(doc, 'span', { class: 'example-copy-state', role: 'status' });
  const copyBtn = h(doc, 'button', { type: 'button', class: 'btn btn-secondary btn-xs', id: 'btn-example-copy', onclick: copyExample });
  bindText(copyBtn, () => U.exampleCopy);
  const exampleHeadText = h(doc, 'span');
  // 逐行說明用固定數量的節點複用（`.example` 是 grid，外層再包一層會吃掉行距）：
  // 詞典行數變多也不會插到「可從…下載」那行之後
  const exampleLineEls = Array.from({ length: 6 }, () => h(doc, 'p', { class: 'ex-line', hidden: true }));
  const exampleWhere = h(doc, 'p', { class: 'ex-line' });
  const exampleOfficial = h(doc, 'p', { class: 'ex-line ex-official' });
  const example = h(doc, 'div', { class: 'example', id: 'holiday-example', hidden: true },
    h(doc, 'div', { class: 'example-head' }, bindText(exampleHeadText, () => U.exampleHead), copyState, copyBtn),
    bindText(code, () => U.exampleCode),
    ...exampleLineEls,
    exampleWhere,
    bindText(exampleOfficial, () => U.exampleOfficial));
  const chev = h(doc, 'span', { class: 'chev', 'aria-hidden': 'true' });
  const disclosureText = h(doc, 'span');
  const disclosure = h(doc, 'button', {
    type: 'button', class: 'disclosure', id: 'btn-example', 'aria-expanded': 'false', 'aria-controls': 'holiday-example',
    onclick: () => setExample(example.hidden),
  }, chev, disclosureText);

  // 示例文案：字典給了 exampleLines（字串陣列，臺灣 CSV 用）就用它，否則用大陸 JSON 的逐條說明。
  // 只渲染存在的鍵，缺的整行省略——絕不把另一地區的說明補進來。
  function renderExampleLines() {
    const list = Array.isArray(U.exampleLines)
      ? U.exampleLines
      : ['exampleFormat', 'exampleYear', 'examplePapers', 'exampleDays', 'exampleNeedOff'].map((k) => U[k]);
    const lines = list.filter((x) => typeof x === 'string' && x);
    exampleLineEls.forEach((el, i) => {
      const text = lines[i] || '';
      setText(el, text);
      el.hidden = !text;
    });
    // 「可從 <地址> 下載（…）」這種拼接拆成三個節點，分隔符不靠翻譯文本拼
    const before = U.exampleWhereBefore;
    const addr = U.exampleWhereAddr;
    const after = U.exampleWhereAfter;
    exampleWhere.replaceChildren(...(addr
      ? [typeof before === 'string' ? before : '', h(doc, 'span', { class: 'mono', text: addr }), typeof after === 'string' ? after : ''].filter(Boolean)
      : []));
    exampleWhere.hidden = !addr;
    exampleOfficial.hidden = !U.exampleOfficial;
  }

  // reveal=true 只由使用者按下展開鈕觸發：切語言時重畫不該把頁面滾走
  function setExample(open, reveal = true) {
    example.hidden = !open;
    disclosure.setAttribute('aria-expanded', String(open));
    setText(chev, open ? (dictSettings().chevronOpen ?? '') : (dictSettings().chevronClosed ?? ''));
    setText(disclosureText, open ? (U.exampleHide ?? '') : (U.exampleShow ?? ''));
    if (open && reveal) bringIntoView();
  }
  // 右欄需要內部滾動時，把展開的示例帶進視野——但剛按下（有焦點）的展開鈕不能被卷出去（WCAG 2.4.11）：
  // 示例比剩下的空間高時，改為把展開鈕捲到欄頂，示例從它下面開始
  function bringIntoView() {
    example.scrollIntoView({ block: 'nearest' });
    // 最近的可滾動祖先：兩欄時是右欄（.set-col），單欄（分頁較窄）時是整個 .settings
    let col = disclosure.parentElement;
    while (col && !/(auto|scroll)/.test(win.getComputedStyle(col).overflowY)) col = col.parentElement;
    if (!col) return;
    const c = col.getBoundingClientRect();
    const b = disclosure.getBoundingClientRect();
    if (b.top < c.top || b.bottom > c.bottom) disclosure.scrollIntoView({ block: 'start' });
  }
  // 進階設定的格式提示：展開示例、帶進右欄視野、焦點移到示例的展開鈕
  function revealExample() {
    if (example.hidden) setExample(true);
    else bringIntoView();
    disclosure.focus({ preventScroll: true });
  }
  const showExampleBtn = (id) => {
    const btn = h(doc, 'button', { type: 'button', class: 'btn btn-secondary btn-xs show-example', id, 'aria-controls': 'holiday-example', onclick: revealExample });
    return bindText(btn, () => U.showExample);
  };

  function selectCode() {
    const sel = win.getSelection?.();
    if (!sel) return;
    const range = doc.createRange();
    range.selectNodeContents(code);
    sel.removeAllRanges();
    sel.addRange(range);
  }
  // 複製結果按「語義」儲存：切語言後按當前字典重念，而不是留著舊語言的句子
  let announced = null; // 'ok' | 'fail' | null
  const announceText = () => (announced === 'ok' ? U.exampleCopied : announced === 'fail' ? U.exampleCopyFail : '');
  // 先清空、稍後再寫：連續複製時讀屏會再念一次（同一段文字不變時 live 區域不會重新朗讀）
  let announceTimer = null;
  function announce(kind) {
    announced = kind;
    win.clearTimeout(announceTimer);
    setText(copyState, '');
    announceTimer = win.setTimeout(() => setText(copyState, announceText()), 100);
  }
  function copyExample() {
    const fail = () => {
      selectCode();
      announce('fail');
    };
    try {
      const p = win.navigator.clipboard?.writeText?.(code.textContent);
      if (!p || typeof p.then !== 'function') {
        fail();
        return;
      }
      p.then(() => announce('ok'), fail);
    } catch {
      fail();
    }
  }

  const act = (btn, hintId, hint) => h(doc, 'div', { class: 'act' }, btn, boundText('span', { class: 'act-hint', id: hintId }, hint));

  // 臺灣限定的說明：沒有線上檢查，只留「自己下載官方 CSV 再匯入」這一條路，
  // 並講清楚人事行政總處公告頁的 XLSX／PDF／ODS 不是本程式能匯入的格式。
  // 年度下載連結常駐；格式限制放在可展開的範例中，避免預設畫面溢位。
  const twManualLead = h(doc, 'span');
  const twManualLink = h(doc, 'a', { target: '_blank', rel: 'noopener noreferrer' });
  const twManualTail = h(doc, 'span');
  const twManual = h(doc, 'p', { class: 'act-hint', id: 'hint-holiday-manual' }, twManualLead, twManualLink, twManualTail);
  const twManualFormats = h(doc, 'p', { class: 'act-hint', id: 'hint-holiday-formats' });
  // 公告頁網址可換行，避免窄欄水平溢位。
  twManualFormats.style.overflowWrap = 'anywhere';
  example.append(twManualFormats);
  // 網址只從字典來（靜態字串），仍驗一次：非 https 就當作沒有連結，寧可只剩文字
  function httpsHref(v) {
    if (typeof v !== 'string' || !v) return '';
    try {
      const u = new URL(v);
      return u.protocol === 'https:' ? u.href : '';
    } catch {
      return '';
    }
  }
  function renderTwGuide(tw = lastRegion === REGION_TW) {
    const href = httpsHref(U.twManualHref);
    const label = typeof U.twManualLinkLabel === 'string' ? U.twManualLinkLabel : '';
    const linked = Boolean(href && label);
    const before = typeof U.twManualBefore === 'string' ? U.twManualBefore : '';
    const after = typeof U.twManualAfter === 'string' ? U.twManualAfter : '';
    setText(twManualLead, before);
    setText(twManualLink, linked ? label : '');
    if (linked) twManualLink.setAttribute('href', href);
    else twManualLink.removeAttribute('href');
    show(twManualLink, linked);
    setText(twManualTail, after);
    show(twManual, tw && Boolean(before || linked || after));
    const formats = typeof U.twManualFormats === 'string' ? U.twManualFormats : '';
    setText(twManualFormats, formats);
    show(twManualFormats, tw && Boolean(formats));
  }
  // 資料來源與授權：正文長（名稱 + 釋出者 + 網址 + 取得日期 + 商業再散佈備註），
  // 預設收起成一顆展開鈕，避免矮視窗裡把假期卡撐出欄外。文字仍是純文本（不加連結），
  // 授權狀態也不因收起而消失：展開就看得到全文。
  const licenseChev = h(doc, 'span', { class: 'chev', 'aria-hidden': 'true' });
  const licenseToggleText = h(doc, 'span');
  const licenseText = h(doc, 'p', { class: 'act-hint', id: 'holiday-license', hidden: true });
  let licenseOpen = false; // 展開狀態是語義狀態：切語言 / 切地區都不重置，只換文字
  const licenseToggle = h(doc, 'button', {
    type: 'button', class: 'disclosure', id: 'btn-license',
    'aria-expanded': 'false', 'aria-controls': 'holiday-license',
    onclick: () => setLicense(!licenseOpen),
  }, licenseChev, licenseToggleText);
  const licenseBlock = h(doc, 'div', { class: 'license-block', hidden: true }, licenseToggle, licenseText);
  const licenseBody = () => (U.license
    ? `${U.license.attribution}；${U.license.release} ${U.license.href} ${U.license.obtained('2026-11-10')} ${U.license.commercial}`
    : '');
  // 一次重畫：鈕的文字與箭頭、正文、以及三者各自的顯隱。
  // 字典沒給標題就不折疊（正文一直顯示）：寧可佔版面，也不留一個沒有文字的展開鈕，
  // 更不會因為缺一個標籤就把授權說明永久藏起來。
  function applyLicense() {
    const bodyText = licenseBody();
    const label = typeof U.license?.label === 'string' ? U.license.label : '';
    const has = Boolean(bodyText);
    const collapsible = has && Boolean(label);
    setText(licenseChev, licenseOpen ? (dictSettings().chevronOpen ?? '') : (dictSettings().chevronClosed ?? ''));
    setText(licenseToggleText, label);
    setText(licenseText, bodyText);
    show(licenseToggle, collapsible);
    show(licenseBlock, has);
    show(licenseText, has && (!collapsible || licenseOpen));
  }
  function setLicense(open) {
    licenseOpen = open;
    licenseToggle.setAttribute('aria-expanded', String(open));
    applyLicense();
  }
  bound.push(applyLicense); // retranslate() 時同步換語言
  const checkAct = act(checkBtn, 'hint-holiday-check', () => U.checkHint);
  const importAct = act(importBtn, 'hint-holiday-import', () => U.importHint);
  // 一整列（按鈕 + 說明）一起藏：臺灣沒有線上檢查這件事要在畫面上一眼看得出來，
  // 不留一顆按不動的按鈕，也不留一句說到線上取得的說明。
  // 只剩「匯入」一個動作時欄數由 renderRegionChrome 用 inline gridTemplateColumns 收成一欄
  // （style.css 不歸本切片，所以不動 CSS）。
  const actGrid = h(doc, 'div', { class: 'act-grid' }, checkAct, importAct, fileInput);
  const body = h(doc, 'div', { class: 'holiday-body' },
    line,
    actGrid,
    twManual,
    boundText('p', { class: 'act-hint' }, () => U.scope),
    licenseBlock,
    result,
    disclosure,
    example);

  // 進階設定 › 自定義網址：改完（change）才校驗並儲存；不合格顯示具體原因、不儲存
  const urlInput = h(doc, 'input', {
    type: 'url', id: 'f-custom-url', name: 'customUrl', autocomplete: 'off', spellcheck: 'false',
    'aria-describedby': 'explain-custom-url hint-custom-url err-custom-url', class: 'inp inp-wide',
  });
  const urlError = h(doc, 'p', { class: 'field-error', id: 'err-custom-url', role: 'alert' });
  // 網址校驗結果也按語義儲存：{ code, params } 或舊式的 { reason }
  let urlReason = null;
  function urlErrorText() {
    if (!urlReason) return '';
    if (urlReason.code) return dictText(urlReason.code, urlReason.params) || urlReason.reason || '';
    return urlReason.reason || '';
  }
  function renderUrlError() {
    const msg = urlErrorText();
    setText(urlError, msg);
    if (msg) urlInput.setAttribute('aria-invalid', 'true');
    else urlInput.removeAttribute('aria-invalid');
  }
  urlInput.addEventListener('change', () => {
    if (lastRegion === REGION_TW) return; // 臺灣不提供自定義網址：不提交、不校驗
    const r = onCustomUrl(urlInput.value);
    urlReason = r.ok ? null : (r.code ? { code: r.code, params: r.params } : { reason: r.reason });
    renderUrlError();
    if (!r.ok) urlError.scrollIntoView({ block: 'nearest' }); // 設定分頁需要內部滾動時，錯誤也要看得到
  });
  const advBody = h(doc, 'div', { class: 'field adv-field' },
    boundText('label', { for: 'f-custom-url', class: 'field-label' }, () => U.customUrl),
    boundText('p', { class: 'para', id: 'explain-custom-url' }, () => U.customUrlExplain),
    urlInput,
    h(doc, 'div', { class: 'adv-hint-row' },
      boundText('p', { class: 'act-hint', id: 'hint-custom-url' }, () => U.customUrlHint),
      showExampleBtn('btn-adv-example')),
    urlError);
  const advSummary = h(doc, 'span', { class: 'adv-summary' });
  bindAttr(urlInput, 'placeholder', () => U.customUrlPlaceholder);

  // 膠囊文字：結構化 { year, kind } 按當前字典重譯；未知 kind 才用它自帶文字
  function chipText(c) {
    const k = c.kind;
    if (k === 'builtin') return dictText('builtin', c.year) || c.text || '';
    if (k === 'online') return dictText('online', c.year) || c.text || '';
    if (k === 'file') return dictText('importedYear', c.year) || c.text || '';
    if (k === 'missing') return dictText('missing', c.year) || c.text || '';
    return c.text || '';
  }
  function lastCheckText(m) {
    if (m.lastCheckAt) return dictText('lastCheck', m.lastCheckAt) || m.lastCheck || '';
    return m.lastCheck || '';
  }
  // 讀屏用的完整一句：由結構化膠囊與檢查時間拼成，分隔符來自字典
  function lineText() {
    const m = lastStatus?.status;
    if (!m) return '';
    const parts = (m.chips || []).map(chipText).filter(Boolean);
    const lc = lastCheckText(m);
    if (lc) parts.push(lc);
    return parts.join(U.sep ?? ' ');
  }

  // 網址摘要按結構化資料重算（customUrl 才是真相；流程傳來的 customSummary 是當時語言的句子）。
  // 主辦方網址含 {year} 佔位，用它拼一個樣本再取主機名；解析不出來就退回流程給的句子。
  function summaryText(s) {
    const url = typeof s.customUrl === 'string' ? s.customUrl : '';
    if (typeof U.customUrlSummary === 'function') {
      if (!url) return U.customUrlSummary(null);
      try {
        return U.customUrlSummary(new URL(url.split('{year}').join('2000')).host);
      } catch { /* 交給流程的句子兜底 */ }
    }
    return typeof s.customSummary === 'string' ? s.customSummary : specText(s.customSummary);
  }

  // fresh=true 只由「新結果」觸發：允許自動展開格式示例、把結果滾進視野。
  // 切語言時用 fresh=false 重說同一份狀態，不製造這兩個一次性動作。
  function renderStatus(fresh) {
    const s = lastStatus;
    if (!s) {
      setText(checkBtn, checking ? U.checking : U.check);
      if (checking) checkBtn.setAttribute('aria-disabled', 'true');
      else checkBtn.removeAttribute('aria-disabled');
      // 狀態句與 aria-label 都交給登記過的閉包：這裡不留第二份寫法
      if (typeof lineAria === 'function') lineAria();
      return;
    }
    const m = s.status || {};
    checking = s.checking;
    chips.replaceChildren(...(m.chips || []).map((c) =>
      h(doc, 'span', { class: `chip ${c.kind === 'missing' ? 'chip-miss' : 'chip-ok'}`, 'data-kind': c.kind },
        c.kind === 'missing' ? null : icon(doc, 'check'), chipText(c))));
    const lc = lastCheckText(m);
    setText(lastCheck, lc);
    show(lastCheck, Boolean(lc));
    // 只念這一份（膠囊與上次檢查都 aria-hidden）；寫法與 setProfile 共用同一個閉包
    if (typeof lineAria === 'function') lineAria();
    setText(checkBtn, checking ? U.checking : U.check);
    if (checking) checkBtn.setAttribute('aria-disabled', 'true');
    else checkBtn.removeAttribute('aria-disabled');

    const r = s.result;
    const nextText = specText(r);
    const nextDetail = r ? specText(r.detail) : '';
    const changed = Boolean(r) && (result.hidden || resultTextNode.data !== nextText || resultDetail.textContent !== nextDetail);
    show(result, Boolean(r));
    result.dataset.tone = r ? r.tone : '';
    if (resultTextNode.data !== nextText) resultTextNode.data = nextText;
    // ✓ 只加在標了 check 的結果前（L7：「已是最新」是成功，不是停用）；文位元組點始終是最後一個子節點
    const wantCheck = Boolean(r && r.check);
    if (wantCheck && resultCheck.parentNode !== resultText) resultText.insertBefore(resultCheck, resultTextNode);
    else if (!wantCheck && resultCheck.parentNode === resultText) resultCheck.remove();
    setText(resultDetail, nextDetail);
    setText(advSummary, summaryText(s));
    // 輸入框只跟生產者的新狀態同步；正在編輯或顯示錯誤時不覆蓋使用者的輸入。
    // 換語言/地區重畫（fresh=false）一律不碰輸入框，沒送出的值留給使用者。
    if (fresh && doc.activeElement !== urlInput && !urlError.textContent) urlInput.value = s.customUrl ?? '';
    if (!fresh) return;
    if (changed && r?.formatHelp && example.hidden) setExample(true, false);
    // 新結果出現時確保看得到（極端情況下設定分頁需要內部滾動）；分頁隱藏時不動
    if (changed && result.offsetParent !== null) result.scrollIntoView({ block: 'nearest' });
  }

  // 臺灣：沒有自定義網址（隱藏整塊，摘要也清空），文件選擇器只收官方 CSV。
  // 只有真正換地區才清掉上一區的校驗結果；輸入框裡沒送出的值一律保留（切回大陸還在），
  // 不會因為換地區就替使用者丟掉正在輸入的內容。
  // 臺灣：整列「檢查更新」隱藏（含說明與 aria-describedby 的指向物）。焦點若正停在即將被藏起來的
  // 節點裡（檢查鈕 / 說明 / 自定義網址那一塊），交給「匯入假日表文件」，不讓焦點掉回 body。
  // 大陸：原樣顯示，不主動搶焦點。
  function renderRegionChrome(prevRegion) {
    const tw = lastRegion === REGION_TW;
    const changed = prevRegion != null && prevRegion !== lastRegion;
    const active = doc.activeElement;
    const willHide = [checkAct, advBody, advSummary].some((el) => el.contains(active));
    const keepFocus = tw && willHide;
    show(checkAct, !tw);
    // 只剩一顆按鈕時不要留半格空白（.act-grid 是兩欄）；清掉內聯樣式就回到樣式表的預設
    actGrid.style.gridTemplateColumns = tw ? '1fr' : '';
    // 說明只在臺灣出現；內容整段由字典決定（缺鍵就整段不顯示，不留空段落）
    renderTwGuide(tw);
    show(advBody, !tw);
    show(advSummary, !tw);
    fileInput.setAttribute('accept', ACCEPT[lastRegion] || ACCEPT.CN);
    if (keepFocus) importBtn.focus({ preventScroll: true });
    if (changed) {
      urlReason = null;
      renderUrlError();
    }
  }

  function update(status) {
    // 別的地區的結果（父級帶了 region）不收：切區期間舊操作完成的回撥不能汙染當前地區
    if (status && status.region && status.region !== lastRegion) return;
    lastStatus = status;
    renderStatus(true);
  }

  // 切換語言 / 地區：只重畫文字與地區相關的顯隱。保留：已展開的示例、正在輸入的網址、
  // 結果區的語義狀態、焦點；不重建節點、不重掛載，也不移動焦點。
  function setProfile(next) {
    if (next) activeProfile = next;
    U = dictU();
    const wasRegion = lastRegion;
    noteRegion(); // 地區變了就換代：此前開始的文件讀取作廢
    retranslate();
    renderExampleLines();
    setExample(!example.hidden, false);
    renderRegionChrome(wasRegion);
    renderUrlError();
    // 真換了地區：上一區 updater 發的狀態（可能是已譯好的句子、也可能沒標 region）不能拿新字典重畫，
    // 直接丟掉，等新地區的 updater 重新 emit。只換語言（地區不變）才保留並按結構化欄位重譯。
    if (lastRegion !== wasRegion) lastStatus = null;
    else if (lastStatus && lastStatus.region && lastStatus.region !== lastRegion) lastStatus = null;
    if (announced) setText(copyState, announceText());
    renderStatus(false);
    return { ok: true, profileId: activeProfile?.id || null, locale: activeProfile?.locale || null, region: lastRegion, generation };
  }

  retranslate();
  renderExampleLines();
  setExample(false, false);
  renderRegionChrome();

  return { body, advBody, advSummary, update, setProfile, isStale, getToken: tokenNow };
}
