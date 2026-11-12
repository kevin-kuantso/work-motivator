// 基本设置 › 假期数据（年份胶囊、「检查更新」「导入假期表文件」各带一行说明、单一结果区、可展开的格式示例）
// 与 高级设置 › 自定义数据网址。只负责画面；流程在 holiday-update.js。所有文字走 textContent（联网来的数据从不当 HTML）。
// profile（可选）：{ id, locale, currency, strings }。setProfile() 就地重画全部文案/ARIA/按钮/示例，不重建 DOM。
// getOperationToken（可选）：父级的地区代数 getter。文件读取开始时同步取一次，读完若已切区就整份丢弃。
// 地区差异：台湾没有线上检查（单一离线档跨来源抓官方资料集可能被 CORS 挡下；尚未逐一验证），
// 整列「检查更新」连同说明都藏起来，
// 只留手动汇入官方 CSV 并明说这条路；大陆保留「检查更新」原样（含检查中的焦点与状态）。
// 年份胶囊的 kind（builtin／online／file／missing）在两区共用：台湾先前存下的线上表仍标成线上，不改称汇入。
import { h, show, setText } from './dom.js';
import { TW_MAX_BYTES } from '../holiday-data-tw.js';
import { icon } from './icons.js';

// 地区 ID 是稳定契约；只在父级没给 profile / getRegion 时兜底。
const REGION_TW = 'TW';
const REGION_CN = 'CN';
// 文件选择器的可接受类型：台湾只接受官方 CSV，大陆沿用年度 JSON。
const ACCEPT = Object.freeze({ TW: '.csv,text/csv,application/csv', CN: '.json,application/json' });

// 读档的先后顺序：每次选择都取一个单调递增的序号，只有「最后一次选择」才允许把结果交给流程。
// 读一个几百 KB 的 CSV 要几毫秒到几百毫秒；这段期间再选一个文件、或切到别的地区再选，
// 先开始的那次读完不能盖掉后来的选择（成功、失败、换区都算）。
// 令牌在 await 之前同步取：读完才知道期间有没有换区；序号则决定「谁是最新的选择」。
// 单独导出以便不依赖 DOM 验证这段顺序契约（面板本身只负责把选择器接上来）。
export function createImportReader({
  getToken, isStale, onImport, maxBytes = TW_MAX_BYTES, regionTw = REGION_TW,
}) {
  let seq = 0;
  async function readFile(file, region) {
    try {
      // 先看大小：台湾的官方 CSV 一年约 20～30 KB，超过上限不必读进内存
      if (region === regionTw && file.size > maxBytes) return { text: null, readError: 'tooLarge' };
      const text = region === regionTw
        ? new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer())
        : await file.text();
      return { text, readError: undefined };
    } catch {
      // 读档失败：台湾传 null（流程据此说「读不到／不是 UTF-8」），大陆沿用空字串的旧契约
      return { text: region === regionTw ? null : '', readError: undefined };
    }
  }
  async function select(file) {
    if (!file) return { delivered: false, empty: true };
    const mine = ++seq;
    const token = getToken();
    const region = token?.region ?? REGION_CN;
    const { text, readError } = await readFile(file, region);
    // 期间又选了别的文件（这台文件选择器一次只显示一个结果）：这次读数作废，不调用、不提示
    if (mine !== seq) return { delivered: false, superseded: true };
    // 已经切区/换代：这次读取属于旧地区，不调用、不提示、不写表（父级不必再判断）
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
  // 字典：profile 给了 holidayUpdate 就用它整份替换（完整键契约），否则退回构造时的字典。
  // 整份替换而不是逐键合并：繁体字典缺键时宁可留空，也不能把中国专用的节名、gov.cn 说明漏进台湾界面。
  const baseU = t?.holidayUpdate || {};
  const dictSettings = () => activeProfile?.strings?.settings || t?.settings || {};
  const dictU = () => activeProfile?.strings?.holidayUpdate || baseU;
  let U = dictU();
  // 上次的完整状态：切语言后按它重画，而不是解析已经译好的句子
  let lastStatus = null;

  // ---- 地区与代数（切换期间完成的异步工作一律丢弃） ----
  let lastRegion = REGION_CN;
  let generation = 0;
  function regionNow() {
    const live = getRegion?.();
    if (live) return live;
    // profile 可以带 region（父级也可以只用 id）：两者都是稳定 ID，不靠文案判断
    if (activeProfile?.region) return activeProfile.region;
    if (activeProfile?.id) return activeProfile.id;
    return lastRegion || REGION_CN;
  }
  // 每次真正换地区：本地代数 +1，让切换瞬间还在跑的文件读取全部作废。
  function noteRegion() {
    const r = regionNow();
    if (r !== lastRegion) {
      lastRegion = r;
      generation += 1;
    }
    return lastRegion;
  }
  lastRegion = regionNow();

  // 操作令牌：开始时同步捕获（地区 + 本地代数 + 父级代数），完成时用它判断是否已经属于旧地区。
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
  // 读档顺序：令牌同步取（读完才知道有没有换区），序号决定「谁是最新的一次选择」。
  const reader = createImportReader({
    getToken: tokenNow,
    isStale,
    onImport: (text, readError) => onImportText(text, readError),
  });

  // ---- 静态文案登记：每条闭包在 setProfile 时重跑一次 ----
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

  // 字典里的字符串或 (params) 函数统一取文字；缺键返回 ''，不回退到别的语言。
  // params 里的元素若是 { code, params }，就是流程层传来的「失败代码」规格：按 codes 表用当前字典翻，
  // 而不是沿用流程发出当时那句话（否则切语言后 detail 会新旧夹杂）。
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
    // 句子里的失败代码在这一版字典翻不出来（例如跨地区残留的规格）：整句不显示，不吐半句话
    if (list && list.some((p) => p && typeof p === 'object' && !Array.isArray(p) && p.code) && args.includes('')) return '';
    if (typeof v === 'function') return (Array.isArray(args) ? v(...args) : v(args)) ?? '';
    return typeof v === 'string' ? v : '';
  }
  // 结构化结果 { key, params, text }：优先按当前字典重译，其次用它自带的文字（旧流程形态）
  function specText(spec) {
    if (!spec) return '';
    // 旧式生产者的结果/细节是已经译好的字符串（大陆 updater 仍是这种形状）：原样显示，不解析
    if (typeof spec === 'string') return spec;
    const k = spec.key ?? spec.code;
    if (k && U[k] !== undefined) return dictText(k, spec.params);
    return typeof spec.text === 'string' ? spec.text : '';
  }

  // 年份胶囊 + 右侧「上次检查」。整行是一个具名分组，名称就是完整的一句（「假期数据状态：…」），
  // 胶囊本身对读屏隐藏，避免相邻胶囊的文字连成一串
  const chips = h(doc, 'span', { class: 'hstatus-chips', 'aria-hidden': 'true' });
  const lastCheck = h(doc, 'span', { class: 'chip-note', 'aria-hidden': 'true' });
  const line = h(doc, 'div', { class: 'hstatus', id: 'holiday-status', role: 'group' }, chips, lastCheck);
  // 没有状态时念字典的「状态」标签本身（与原实现一致），有状态才念拼好的整句。
  // update() 与 setProfile() 共用同一个写入口，避免两处写法漂移。
  const lineAriaText = () => (lastStatus ? (U.statusAria ? U.statusAria(lineText()) : lineText()) : U.statusLabel || '');
  const lineAria = () => line.setAttribute('aria-label', String(readText(lineAriaText) ?? ''));
  lineAria();
  bound.push(lineAria);
  // 检查中用 aria-disabled 而不是 disabled：按钮保留焦点（disabled 会把键盘焦点丢到 body）
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
      // 先清空选择器：同一个文件连续选两次也要能触发 change
      fileInput.value = '';
      if (!file) return;
      // 读档与顺序判定在 reader 里（readError／换区／期间又选了别的文件都在那里处理）
      await reader.select(file);
    },
  });
  const importBtn = h(doc, 'button', {
    type: 'button', class: 'btn btn-secondary btn-s', id: 'btn-holiday-import',
    'aria-describedby': 'hint-holiday-import',
    onclick: () => fileInput.click(),
  });
  bindText(importBtn, () => U.importFile);
  // 结果文字用一个常驻的 Text 节点写，结果前的 ✓ 才能留在同一个 span 里不被 setText 清掉（L7）
  const resultText = h(doc, 'span', { class: 'holiday-result-text' });
  const resultTextNode = doc.createTextNode('');
  const resultCheck = icon(doc, 'check'); // 纯装饰（icon() 已 aria-hidden）；只有标了 check 的结果才加
  resultText.append(resultTextNode);
  const resultDetail = h(doc, 'span', { class: 'holiday-result-detail' });
  const result = h(doc, 'p', { class: 'holiday-result', id: 'holiday-result', role: 'status', 'aria-live': 'polite', hidden: true }, resultText, resultDetail);

  // 「查看导入文件的格式示例」：可复制的等宽示例 + 两行白话；地址是可选取的文字，不是链接
  const code = h(doc, 'pre', { class: 'code', id: 'holiday-example-code' });
  const copyState = h(doc, 'span', { class: 'example-copy-state', role: 'status' });
  const copyBtn = h(doc, 'button', { type: 'button', class: 'btn btn-secondary btn-xs', id: 'btn-example-copy', onclick: copyExample });
  bindText(copyBtn, () => U.exampleCopy);
  const exampleHeadText = h(doc, 'span');
  // 逐行说明用固定数量的节点复用（`.example` 是 grid，外层再包一层会吃掉行距）：
  // 词典行数变多也不会插到「可从…下载」那行之后
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

  // 示例文案：字典给了 exampleLines（字符串数组，台湾 CSV 用）就用它，否则用大陆 JSON 的逐条说明。
  // 只渲染存在的键，缺的整行省略——绝不把另一地区的说明补进来。
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
    // 「可从 <地址> 下载（…）」这种拼接拆成三个节点，分隔符不靠翻译文本拼
    const before = U.exampleWhereBefore;
    const addr = U.exampleWhereAddr;
    const after = U.exampleWhereAfter;
    exampleWhere.replaceChildren(...(addr
      ? [typeof before === 'string' ? before : '', h(doc, 'span', { class: 'mono', text: addr }), typeof after === 'string' ? after : ''].filter(Boolean)
      : []));
    exampleWhere.hidden = !addr;
    exampleOfficial.hidden = !U.exampleOfficial;
  }

  // reveal=true 只由用户按下展开钮触发：切语言时重画不该把页面滚走
  function setExample(open, reveal = true) {
    example.hidden = !open;
    disclosure.setAttribute('aria-expanded', String(open));
    setText(chev, open ? (dictSettings().chevronOpen ?? '') : (dictSettings().chevronClosed ?? ''));
    setText(disclosureText, open ? (U.exampleHide ?? '') : (U.exampleShow ?? ''));
    if (open && reveal) bringIntoView();
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
  // 复制结果按「语义」保存：切语言后按当前字典重念，而不是留着旧语言的句子
  let announced = null; // 'ok' | 'fail' | null
  const announceText = () => (announced === 'ok' ? U.exampleCopied : announced === 'fail' ? U.exampleCopyFail : '');
  // 先清空、稍后再写：连续复制时读屏会再念一次（同一段文字不变时 live 区域不会重新朗读）
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
  // 年度下載連結常駐；格式限制放在可展開的範例中，避免預設畫面溢出。
  const twManualLead = h(doc, 'span');
  const twManualLink = h(doc, 'a', { target: '_blank', rel: 'noopener noreferrer' });
  const twManualTail = h(doc, 'span');
  const twManual = h(doc, 'p', { class: 'act-hint', id: 'hint-holiday-manual' }, twManualLead, twManualLink, twManualTail);
  const twManualFormats = h(doc, 'p', { class: 'act-hint', id: 'hint-holiday-formats' });
  // 公告頁網址可換行，避免窄欄水平溢出。
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
  // 资料来源与授权：正文长（名称 + 发布者 + 网址 + 取得日期 + 商业再散布备注），
  // 默认收起成一颗展开钮，避免矮视窗里把假期卡撑出栏外。文字仍是纯文本（不加链接），
  // 授权状态也不因收起而消失：展开就看得到全文。
  const licenseChev = h(doc, 'span', { class: 'chev', 'aria-hidden': 'true' });
  const licenseToggleText = h(doc, 'span');
  const licenseText = h(doc, 'p', { class: 'act-hint', id: 'holiday-license', hidden: true });
  let licenseOpen = false; // 展开状态是语义状态：切语言 / 切地区都不重置，只换文字
  const licenseToggle = h(doc, 'button', {
    type: 'button', class: 'disclosure', id: 'btn-license',
    'aria-expanded': 'false', 'aria-controls': 'holiday-license',
    onclick: () => setLicense(!licenseOpen),
  }, licenseChev, licenseToggleText);
  const licenseBlock = h(doc, 'div', { class: 'license-block', hidden: true }, licenseToggle, licenseText);
  const licenseBody = () => (U.license
    ? `${U.license.attribution}；${U.license.release} ${U.license.href} ${U.license.obtained('2026-11-10')} ${U.license.commercial}`
    : '');
  // 一次重画：钮的文字与箭头、正文、以及三者各自的显隐。
  // 字典没给标题就不折叠（正文一直显示）：宁可占版面，也不留一个没有文字的展开钮，
  // 更不会因为缺一个标签就把授权说明永久藏起来。
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
  bound.push(applyLicense); // retranslate() 时同步换语言
  const checkAct = act(checkBtn, 'hint-holiday-check', () => U.checkHint);
  const importAct = act(importBtn, 'hint-holiday-import', () => U.importHint);
  // 一整列（按钮 + 说明）一起藏：台湾没有线上检查这件事要在画面上一眼看得出来，
  // 不留一颗按不动的按钮，也不留一句说到线上取得的说明。
  // 只剩「导入」一个动作时栏数由 renderRegionChrome 用 inline gridTemplateColumns 收成一栏
  // （style.css 不归本切片，所以不动 CSS）。
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

  // 高级设置 › 自定义网址：改完（change）才校验并保存；不合格显示具体原因、不保存
  const urlInput = h(doc, 'input', {
    type: 'url', id: 'f-custom-url', name: 'customUrl', autocomplete: 'off', spellcheck: 'false',
    'aria-describedby': 'explain-custom-url hint-custom-url err-custom-url', class: 'inp inp-wide',
  });
  const urlError = h(doc, 'p', { class: 'field-error', id: 'err-custom-url', role: 'alert' });
  // 网址校验结果也按语义保存：{ code, params } 或旧式的 { reason }
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
    if (lastRegion === REGION_TW) return; // 台湾不提供自定义网址：不提交、不校验
    const r = onCustomUrl(urlInput.value);
    urlReason = r.ok ? null : (r.code ? { code: r.code, params: r.params } : { reason: r.reason });
    renderUrlError();
    if (!r.ok) urlError.scrollIntoView({ block: 'nearest' }); // 设置分页需要内部滚动时，错误也要看得到
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

  // 胶囊文字：结构化 { year, kind } 按当前字典重译；未知 kind 才用它自带文字
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
  // 读屏用的完整一句：由结构化胶囊与检查时间拼成，分隔符来自字典
  function lineText() {
    const m = lastStatus?.status;
    if (!m) return '';
    const parts = (m.chips || []).map(chipText).filter(Boolean);
    const lc = lastCheckText(m);
    if (lc) parts.push(lc);
    return parts.join(U.sep ?? ' ');
  }

  // 网址摘要按结构化数据重算（customUrl 才是真相；流程传来的 customSummary 是当时语言的句子）。
  // 主办方网址含 {year} 占位，用它拼一个样本再取主机名；解析不出来就退回流程给的句子。
  function summaryText(s) {
    const url = typeof s.customUrl === 'string' ? s.customUrl : '';
    if (typeof U.customUrlSummary === 'function') {
      if (!url) return U.customUrlSummary(null);
      try {
        return U.customUrlSummary(new URL(url.split('{year}').join('2000')).host);
      } catch { /* 交给流程的句子兜底 */ }
    }
    return typeof s.customSummary === 'string' ? s.customSummary : specText(s.customSummary);
  }

  // fresh=true 只由「新结果」触发：允许自动展开格式示例、把结果滚进视野。
  // 切语言时用 fresh=false 重说同一份状态，不制造这两个一次性动作。
  function renderStatus(fresh) {
    const s = lastStatus;
    if (!s) {
      setText(checkBtn, checking ? U.checking : U.check);
      if (checking) checkBtn.setAttribute('aria-disabled', 'true');
      else checkBtn.removeAttribute('aria-disabled');
      // 状态句与 aria-label 都交给登记过的闭包：这里不留第二份写法
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
    // 只念这一份（胶囊与上次检查都 aria-hidden）；写法与 setProfile 共用同一个闭包
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
    // ✓ 只加在标了 check 的结果前（L7：「已是最新」是成功，不是停用）；文字节点始终是最后一个子节点
    const wantCheck = Boolean(r && r.check);
    if (wantCheck && resultCheck.parentNode !== resultText) resultText.insertBefore(resultCheck, resultTextNode);
    else if (!wantCheck && resultCheck.parentNode === resultText) resultCheck.remove();
    setText(resultDetail, nextDetail);
    setText(advSummary, summaryText(s));
    // 输入框只跟生产者的新状态同步；正在编辑或显示错误时不覆盖用户的输入。
    // 换语言/地区重画（fresh=false）一律不碰输入框，没送出的值留给用户。
    if (fresh && doc.activeElement !== urlInput && !urlError.textContent) urlInput.value = s.customUrl ?? '';
    if (!fresh) return;
    if (changed && r?.formatHelp && example.hidden) setExample(true, false);
    // 新结果出现时确保看得到（极端情况下设置分页需要内部滚动）；分页隐藏时不动
    if (changed && result.offsetParent !== null) result.scrollIntoView({ block: 'nearest' });
  }

  // 台湾：没有自定义网址（隐藏整块，摘要也清空），文件选择器只收官方 CSV。
  // 只有真正换地区才清掉上一区的校验结果；输入框里没送出的值一律保留（切回大陆还在），
  // 不会因为换地区就替用户丢掉正在输入的内容。
  // 台湾：整列「检查更新」隐藏（含说明与 aria-describedby 的指向物）。焦点若正停在即将被藏起来的
  // 节点里（检查钮 / 说明 / 自定义网址那一块），交给「导入假日表文件」，不让焦点掉回 body。
  // 大陆：原样显示，不主动抢焦点。
  function renderRegionChrome(prevRegion) {
    const tw = lastRegion === REGION_TW;
    const changed = prevRegion != null && prevRegion !== lastRegion;
    const active = doc.activeElement;
    const willHide = [checkAct, advBody, advSummary].some((el) => el.contains(active));
    const keepFocus = tw && willHide;
    show(checkAct, !tw);
    // 只剩一颗按钮时不要留半格空白（.act-grid 是两栏）；清掉内联样式就回到样式表的默认
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
    // 别的地区的结果（父级带了 region）不收：切区期间旧操作完成的回调不能污染当前地区
    if (status && status.region && status.region !== lastRegion) return;
    lastStatus = status;
    renderStatus(true);
  }

  // 切换语言 / 地区：只重画文字与地区相关的显隐。保留：已展开的示例、正在输入的网址、
  // 结果区的语义状态、焦点；不重建节点、不重挂载，也不移动焦点。
  function setProfile(next) {
    if (next) activeProfile = next;
    U = dictU();
    const wasRegion = lastRegion;
    noteRegion(); // 地区变了就换代：此前开始的文件读取作废
    retranslate();
    renderExampleLines();
    setExample(!example.hidden, false);
    renderRegionChrome(wasRegion);
    renderUrlError();
    // 真换了地区：上一区 updater 发的状态（可能是已译好的句子、也可能没标 region）不能拿新字典重画，
    // 直接丢掉，等新地区的 updater 重新 emit。只换语言（地区不变）才保留并按结构化字段重译。
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
