// 真實環境驗證（Mac Chrome，有頭）：以 file:// 開啟成品，經 CDP 送出「受信任」的滑鼠事件
// （Input.dispatchMouseEvent => 真實 user activation），驅動 Document Picture-in-Picture。
// 不屬於 npm test / npm run e2e；用 `npm run e2e:real` 執行。
// !! 不得與其他驅動 Chrome 的測試（npm run e2e、Playwright、另一個 e2e:real）同時執行：
//    併發時曾出現整段卡住約 25 分鐘、以及 documentPictureInPicture.window 為 null 的崩潰（受信任點選 / 視窗焦點被搶走）。
// 防護：整體硬性逾時（HARD_TIMEOUT_MS，預設 5 分鐘）→ 殺掉 Chrome、刪除臨時 profile、以非 0 結束；
//       每個 CDP 呼叫 / HTTP 請求都有單步逾時；PiP 視窗可能為 null 的地方一律判空並記為 FAIL，而不是拋 TypeError。
// 只量測、只回報：任何數字都是本次實際量到的，沒有量到的不會被聲稱。
//
// 測試用的措施（僅在 harness 內，不進成品）：
//  - init script 把頁面的 Date 平移到 2026-11-03(二) 14:12:00 本地時間後照真實速度往前走（本機現在是晚上，會不跳金額）。
//  - 網路（R19）：時鐘在 2026-11-03，app 開頁會檢查「還沒有內建表」的年份。2026 與 2027 都已內建
//    （2027 為國務院辦公廳 2026-11 通知），所以開頁不產生任何外部請求。為了不碰真實網路又保持確定性，
//    經 CDP Fetch 域攔截所有 http(s) 請求：一個都不回應，任何外部請求一律 failRequest 並記為 FAIL
//    （步驟 9 斷言整個過程 0 個請求）。
//  - init script 包裝 setInterval/clearInterval 以計算「存活的 100ms 計時器」數量；包裝 requestWindow 以記錄 app 要求的尺寸。
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const FILE_URL = pathToFileURL(join(root, 'dist', 'work-motivator.html')).href;
const SHOT_DIR = join(root, '.superpowers', 'sdd', 'plan');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9300 + Math.floor(Math.random() * 600);
const HIDDEN_MS = Number(process.env.HIDDEN_MS ?? 60000);
const HARD_TIMEOUT_MS = Number(process.env.HARD_TIMEOUT_MS ?? 5 * 60 * 1000);
const STEP_MS = 20000; // 單個 CDP 呼叫 / HTTP 請求的上限
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const withTimeout = (p, ms, what) => {
  let timer;
  return Promise.race([
    p,
    new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`step timeout after ${ms}ms: ${what}`)), ms); }),
  ]).finally(() => clearTimeout(timer));
};
// PiP 檔案的安全取法：視窗已關閉時得到 null（而不是拋錯）
// 只用於診斷：把「本該一個都沒有的假期資料請求」單獨點名（不回應任何請求）。
const HOLIDAY_HOSTS = /^https:\/\/(raw\.githubusercontent\.com\/NateScarlet\/holiday-cn\/master|cdn\.jsdelivr\.net\/gh\/NateScarlet\/holiday-cn@master|fastly\.jsdelivr\.net\/gh\/NateScarlet\/holiday-cn@master)\/\d{4}\.json$/;
// 每次 reload 前只清掉假期資料鍵（含 lastCheck）：2026 / 2027 都是內建表，清掉後仍應正常顯示內建資料、
// 且依舊不發任何請求——順帶覆蓋「本地沒有聯網記錄時內建表照樣夠用」。「每天最多一次」由 npm test / npm run e2e 覆蓋。設定鍵不受影響。
const CLEAR_HOLIDAYS = `localStorage.removeItem('work-motivator-v1-holidays')`;
const PIPDOC = '(documentPictureInPicture.window ? documentPictureInPicture.window.document : null)';

// ---------- 結果表 ----------
const rows = [];
function rec(item, status, name, detail) {
  rows.push({ item, status, name, detail });
  console.log(`[${status}] ${item} ${name} :: ${detail}`);
}
const pass = (item, name, detail) => rec(item, 'PASS', name, detail);
const fail = (item, name, detail) => rec(item, 'FAIL', name, detail);
const info = (item, name, detail) => rec(item, 'INFO', name, detail);
const check = (item, ok, name, detail) => (ok ? pass : fail)(item, name, detail);

// ---------- CDP ----------
async function http(path, method = 'GET') {
  const res = await fetch(`http://127.0.0.1:${PORT}${path}`, { method, signal: AbortSignal.timeout(5000) });
  return res.json();
}
async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await withTimeout(new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws error')); }), 5000, 'websocket open');
  let id = 0;
  const pending = new Map();
  const handlers = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } else if (m.method) handlers.forEach((h) => h(m));
  };
  return {
    ws,
    on: (h) => handlers.push(h),
    send: (method, params = {}) => withTimeout(new Promise((res, rej) => {
      const i = ++id;
      pending.set(i, (m) => (m.error ? rej(new Error(`${method}: ${m.error.message}`)) : res(m.result)));
      ws.send(JSON.stringify({ id: i, method, params }));
    }), STEP_MS, method),
  };
}
async function ev(c, expr) {
  const r = await c.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(`eval failed: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text} :: ${expr.slice(0, 120)}`);
  return r.result.value;
}
async function waitFor(c, expr, timeout = 5000, step = 25) {
  const t0 = Date.now();
  for (;;) {
    let v;
    try { v = await ev(c, expr); } catch { v = false; }
    if (v) return Date.now() - t0;
    if (Date.now() - t0 > timeout) return null;
    await sleep(step);
  }
}

// 真實（受信任）點選：先把元素捲進視窗，再送 mouseMoved / mousePressed / mouseReleased。
async function trustedClick(c, sel) {
  await c.send('Page.bringToFront');
  const p = await ev(c, `(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; e.scrollIntoView({ block: 'center' }); const b = e.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()`);
  if (!p) throw new Error(`no element ${sel}`);
  await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y });
  await c.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 1 });
  await c.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: 1 });
}

// ---------- 注入頁面的 harness ----------
const INIT = `(() => {
  if (!sessionStorage.getItem('realPipSeeded')) {
    localStorage.setItem('work-motivator-v1', JSON.stringify({version: 2, salary: 6800, lunchOn: true, lunchStart: '11:30', lunchEnd: '13:00'}));
    sessionStorage.setItem('realPipSeeded', '1');
  }
  const R = Date;
  const off = new R(2026, 10, 3, 14, 12, 0).getTime() - R.now();
  class D extends R {
    constructor(...a) { if (a.length === 0) super(R.now() + off); else super(...a); }
    static now() { return R.now() + off; }
  }
  window.Date = D;
  const track = (w) => {
    const si = w.setInterval.bind(w), ci = w.clearInterval.bind(w);
    w.__iv = new Map();
    w.setInterval = (fn, ms, ...a) => { const id = si(fn, ms, ...a); w.__iv.set(id, ms); return id; };
    w.clearInterval = (id) => { w.__iv.delete(id); return ci(id); };
  };
  track(window);
  window.__ivCount = (w, ms) => [...w.__iv.values()].filter((v) => v === ms).length;
  const dp = window.documentPictureInPicture;
  if (dp && dp.requestWindow) {
    const orig = dp.requestWindow.bind(dp);
    dp.requestWindow = async (o) => { window.__req = o; const w = await orig(o); track(w); return w; };
  }
  window.__watchAmount = (doc) => {
    window.__chg = [];
    window.__mo && window.__mo.disconnect();
    const el = doc.querySelector('#status-card .card-amount');
    let last = el.textContent;
    window.__mo = new MutationObserver(() => { const v = el.textContent; if (v !== last) { last = v; window.__chg.push([performance.now(), v]); } });
    window.__mo.observe(el, { subtree: true, childList: true, characterData: true });
  };
  window.__armBack = (useClick) => {
    window.__t = {};
    if (useClick) document.addEventListener('click', (e) => { if (e.target.closest && e.target.closest('.pip-placeholder')) window.__t.start = performance.now(); }, { capture: true, once: true });
    window.__bmo && window.__bmo.disconnect();
    window.__bmo = new MutationObserver(() => {
      if (window.__t.start !== undefined && window.__t.back === undefined && document.getElementById('status-card')) window.__t.back = performance.now();
    });
    window.__bmo.observe(document.getElementById('card-slot'), { childList: true, subtree: true });
  };
})();`;

const statsOf = (chg, windowMs) => {
  const ts = chg.map((x) => x[0]);
  const gaps = ts.slice(1).map((t, i) => t - ts[i]);
  return {
    n: chg.length,
    distinct: new Set(chg.map((x) => x[1])).size,
    maxGap: gaps.length ? Math.round(Math.max(...gaps)) : null,
    avgGap: gaps.length ? Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length) : null,
    perSec: +(chg.length / (windowMs / 1000)).toFixed(1),
  };
};

const PIP_INFO = `(() => {
  const w = documentPictureInPicture.window;
  if (!w) return null;
  const d = w.document, se = d.scrollingElement, card = d.getElementById('status-card');
  const vis = (s) => { const e = d.querySelector(s); return e ? w.getComputedStyle(e).display : null; };
  return {
    inner: [w.innerWidth, w.innerHeight], outer: [w.outerWidth, w.outerHeight], dpr: w.devicePixelRatio,
    req: window.__req ?? null,
    compat: d.compatMode, scrollH: se.scrollHeight, clientH: se.clientHeight, scrollW: se.scrollWidth, clientW: se.clientWidth,
    cardSize: card && card.dataset.size, cardH: card && card.getBoundingClientRect().height, cardW: card && card.getBoundingClientRect().width,
    text: d.body.innerText, vis: d.visibilityState,
    lgOnlyDisplay: vis('.lg-only'),
    iv100: w.__iv ? window.__ivCount(w, 100) : null,
    openerIv100: window.__ivCount(window, 100),
    mainHasCard: !!document.getElementById('status-card'),
    placeholderHidden: document.querySelector('.pip-placeholder').hidden,
    placeholderText: document.querySelector('.pip-placeholder-title').textContent,
    btn: document.getElementById('btn-float').textContent,
  };
})()`;

const MAIN_INFO = `(() => {
  const card = document.getElementById('status-card');
  const s = document.getElementById('settings');
  const st = document.getElementById('tab-settings');
  return {
    settingsSelected: st.getAttribute('aria-selected') === 'true', settingsPanelShown: !document.getElementById('panel-settings').hidden,
    focusId: document.activeElement ? document.activeElement.id : null,
    cardInMain: !!card, size: card && card.dataset.size, pipWin: !!documentPictureInPicture.window,
    placeholderHidden: document.querySelector('.pip-placeholder').hidden,
    btn: document.getElementById('btn-float').textContent, btnDisabled: document.getElementById('btn-float').disabled,
    iv100: window.__ivCount(window, 100), scrollY: Math.round(window.scrollY),
    settingsTop: Math.round(s.getBoundingClientRect().top), pageScrolls: document.documentElement.scrollHeight > innerHeight,
    maxScroll: Math.round(document.scrollingElement.scrollHeight - window.innerHeight),
    vis: document.visibilityState, amount: card && card.querySelector('.card-amount').textContent,
  };
})()`;

async function openPip(A) {
  await trustedClick(A, '#btn-float');
  return waitFor(A, `!!(${PIPDOC} && ${PIPDOC}.getElementById("status-card"))`, 5000);
}

async function shot(c, name) {
  try {
    const r = await c.send('Page.captureScreenshot', { format: 'png' });
    const p = join(SHOT_DIR, `task-7-${name}.png`);
    await writeFile(p, Buffer.from(r.data, 'base64'));
    return p;
  } catch (e) { return `ERR ${e.message}`; }
}

async function closeAndMeasure(A, how) {
  // how: 'placeholder' | 'gear' | 'x'
  await ev(A, `__armBack(${how === 'placeholder'})`);
  if (how === 'placeholder') await trustedClick(A, '.pip-placeholder');
  else if (how === 'gear') {
    const ok = await ev(A, `(() => { const d = ${PIPDOC}; if (!d) return false; __t.start = performance.now(); d.querySelector('.card-gear').click(); return true; })()`);
    if (!ok) return { ok: false, delay: null, why: 'PiP window was null before the gear click' };
  } else {
    const ok = await ev(A, `(() => { if (!documentPictureInPicture.window) return false; __t.start = performance.now(); documentPictureInPicture.window.close(); return true; })()`);
    if (!ok) return { ok: false, delay: null, why: 'PiP window was null before close()' };
  }
  const ok = await waitFor(A, '__t.back !== undefined', 5000, 10);
  const t = await ev(A, '__t');
  return { ok: ok !== null, delay: t.back !== undefined ? +(t.back - t.start).toFixed(1) : null };
}

// ---------- 主流程 ----------
let chrome = null;
let profile = null;
let exited = false;
async function cleanup() {
  if (chrome && !exited) chrome.kill('SIGTERM');
  for (let i = 0; i < 10 && chrome && !exited; i++) await sleep(100);
  if (chrome && !exited) chrome.kill('SIGKILL');
  if (profile) await rm(profile, { recursive: true, force: true }).catch(() => {});
}

async function main() {
  profile = await mkdtemp(join(tmpdir(), 'wm-real-pip-'));
  await mkdir(SHOT_DIR, { recursive: true });
  chrome = spawn(CHROME, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
    'about:blank',
  ], { stdio: 'ignore' });
  chrome.on('exit', () => { exited = true; });

  const consoleMsgs = [];
  try {
    for (let i = 0; i < 60; i++) { try { await http('/json/version'); break; } catch { await sleep(250); } }
    const ver = await http('/json/version');
    info('0', 'browser', `${ver.Browser} (headed, profile ${profile}, UA platform ${/Mac/.test(ver['User-Agent']) ? 'Mac' : 'other'})`);

    const tab = (await http('/json')).find((t) => t.type === 'page');
    const A = await connect(tab.webSocketDebuggerUrl);
    A.on((m) => {
      if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning', 'assert'].includes(m.params.type)) {
        consoleMsgs.push(`console.${m.params.type}: ${m.params.args.map((a) => a.value ?? a.description).join(' ')}`);
      } else if (m.method === 'Runtime.exceptionThrown') {
        consoleMsgs.push(`exception: ${m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text}`);
      } else if (m.method === 'Log.entryAdded' && ['error', 'warning'].includes(m.params.entry.level)) {
        consoleMsgs.push(`log.${m.params.entry.level}: ${m.params.entry.text} ${m.params.entry.url ?? ''}`);
      }
    });
    // ---- 網路：攔截全部 http(s)，一個都不回應（不碰真實網路）；2026 / 2027 已內建，本該一個請求都沒有 ----
    const refused = [];
    A.on((m) => {
      if (m.method !== 'Fetch.requestPaused') return;
      const { requestId, request } = m.params;
      refused.push(HOLIDAY_HOSTS.test(request.url) ? `holiday-data! ${request.url}` : request.url);
      A.send('Fetch.failRequest', { requestId, errorReason: 'InternetDisconnected' }).catch(() => {});
    });
    await A.send('Fetch.enable', { patterns: [{ urlPattern: 'http://*' }, { urlPattern: 'https://*' }] });
    await A.send('Runtime.enable');
    await A.send('Log.enable');
    await A.send('Page.enable');
    await A.send('Page.addScriptToEvaluateOnNewDocument', { source: INIT });
    await A.send('Page.navigate', { url: FILE_URL });
    await waitFor(A, 'document.readyState === "complete" && !!document.getElementById("btn-float")', 10000);
    await A.send('Page.bringToFront');
    await sleep(500);

    // ===== 9 假期資料：2026 與 2027 都已內建 → 開頁不發任何請求，也不出現「暫未釋出」資訊 =====
    const idle9 = await waitFor(A, '!!document.getElementById("btn-holiday-check") && !document.getElementById("btn-holiday-check").hasAttribute("aria-disabled") && (document.getElementById("holiday-status").getAttribute("aria-label") || "").includes("2027 年 · 内置")', 10000);
    const h9 = await ev(A, `(() => { const r = document.getElementById('holiday-result'); return { hidden: r.hidden, tone: r.dataset.tone, text: r.querySelector('.holiday-result-text').textContent, line: document.getElementById('holiday-status').getAttribute('aria-label').replace(/^假期数据状态：/, ''), tagHidden: [...document.querySelectorAll('.cal-year-tag')].map((e) => e.hidden), rec: localStorage.getItem('work-motivator-v1-holidays'), errBar: !document.querySelector('.notices .banner-error').hidden, toast: !document.querySelector('.toast').hidden }; })()`);
    check('9', idle9 !== null && refused.length === 0, '2026 / 2027 都已内置 -> 开页不请求任何假期数据（CDP Fetch 仍全量拦截，0 个请求）', `refused=${JSON.stringify(refused)} idle after ~${idle9}ms`);
    check('9', h9.hidden === true && h9.text === '' && h9.tone === '' && !h9.errBar && !h9.toast, '自动检查无事可做 -> 结果区保持隐藏（没有「暂未发布」、不是错误、无 toast）', JSON.stringify({ hidden: h9.hidden, tone: h9.tone, text: h9.text, errBar: h9.errBar, toast: h9.toast }));
    check('9', h9.line === '2026 年 · 内置 · 2027 年 · 内置' && h9.rec === null && h9.tagHidden.length === 1 && h9.tagHidden[0] === true, '状态行显示两年都已内置、没有写入联网记录、月历没有缺表年标签', `line="${h9.line}" record=${h9.rec} tags=${JSON.stringify(h9.tagHidden)}`);
    info('0', 'opener 视窗', `innerWidth x innerHeight = ${await ev(A, 'innerWidth + "x" + innerHeight')}; outer = ${await ev(A, 'outerWidth + "x" + outerHeight')}`);
    info('0', 'page', `${await ev(A, 'location.href')} ; app Date = ${await ev(A, 'new Date().toString()')} ; reduced-motion=${await ev(A, 'matchMedia("(prefers-reduced-motion: reduce)").matches')}`);
    await shot(A, 'main-before');

    // ===== 1 開啟 =====
    const enabled = await ev(A, '!document.getElementById("btn-float").disabled && document.getElementById("btn-float").getAttribute("aria-disabled") !== "true"');
    check('1', enabled, '悬浮按钮可用 (PiP supported)', `disabled=${!enabled}`);
    const openMs = await openPip(A);
    check('1', openMs !== null, '受信任点击 -> documentPictureInPicture.window 出现', `ready after ~${openMs}ms`);
    if (openMs === null) throw new Error('PiP did not open; cannot continue');
    await sleep(300);
    const p1 = await ev(A, PIP_INFO);
    if (!p1) { fail('1', 'PiP 视窗在开启后变成 null', 'documentPictureInPicture.window === null right after opening'); throw new Error('PiP window vanished'); }
    check('1', p1.placeholderText === '已悬浮 · 点此收回' && !p1.placeholderHidden && !p1.mainHasCard, '主页面显示占位卡「已悬浮 · 点此收回」，卡片不在主文件', `placeholder="${p1.placeholderText}" hidden=${p1.placeholderHidden} mainHasCard=${p1.mainHasCard}`);
    check('1', p1.cardSize === 'sm', 'PiP 内 #status-card data-size="sm"', `data-size=${p1.cardSize}`);
    check('1', /今天已经赚了/.test(p1.text) && /¥\s*[\d,]+\.\d+/.test(p1.text), 'PiP 含今日已赚金额', `text has label+amount; amount="${await ev(A, `(${PIPDOC} || { querySelector: () => ({ textContent: 'PiP null' }) }).querySelector(".card-amount").textContent`)}"`);
    check('1', /当前赚钱速度/.test(p1.text), 'PiP 含「当前赚钱速度」', 'present');
    check('1', !/时薪/.test(p1.text) && !/今日满勤可得/.test(p1.text), 'PiP 不含「时薪」「今日满勤可得」(innerText)', `lg-only computed display=${p1.lgOnlyDisplay}`);
    check('1', p1.openerIv100 === 0 && p1.iv100 === 1, '计时器已移到 PiP（开启者 0 个、PiP 1 个 100ms interval）', `opener=${p1.openerIv100} pip=${p1.iv100}`);

    // 地區切換不重建卡片：實際 PiP 與主檔案必須同步語言、幣別和主題。
    const switchRegion = async (region) => ev(A, `(() => { const el = document.getElementById('f-region'); el.value = '${region}'; el.dispatchEvent(new Event('change', {bubbles:true})); })()`);
    await switchRegion('TW');
    await sleep(300);
    const twProfile = await ev(A, `(() => { const d = ${PIPDOC}; return { mainLang: document.documentElement.lang, pipLang: d?.documentElement.lang, mainTitle: document.title, pipTitle: d?.title, mainTheme: document.documentElement.dataset.theme, pipTheme: d?.documentElement.dataset.theme, text: d?.getElementById('status-card')?.textContent, height: d?.documentElement.scrollHeight, viewport: d?.documentElement.clientHeight }; })()`);
    check('regional', twProfile.mainLang === 'zh-TW' && twProfile.pipLang === 'zh-TW' && twProfile.mainTitle === twProfile.pipTitle && twProfile.mainTheme === twProfile.pipTheme && twProfile.text?.includes('NT$') && twProfile.height <= twProfile.viewport, '切換臺灣時 PiP 語言、標題、主題、幣別一致且不裁切', JSON.stringify(twProfile));
    await switchRegion('CN');
    await sleep(300);
    const cnProfile = await ev(A, `(() => { const d = ${PIPDOC}; return { mainLang: document.documentElement.lang, pipLang: d?.documentElement.lang, mainTitle: document.title, pipTitle: d?.title, mainTheme: document.documentElement.dataset.theme, pipTheme: d?.documentElement.dataset.theme, text: d?.getElementById('status-card')?.textContent }; })()`);
    check('regional', cnProfile.mainLang === 'zh-CN' && cnProfile.pipLang === 'zh-CN' && cnProfile.mainTitle === cnProfile.pipTitle && cnProfile.mainTheme === cnProfile.pipTheme && cnProfile.text?.includes('¥'), '切回中國時 PiP 語言、標題、主題與幣別一致', JSON.stringify(cnProfile));
    info('1', 'PiP 窗口 vis / 按钮文字', `pip visibilityState=${p1.vis}; btn="${p1.btn}"`);

    // ===== 2 尺寸 =====
    const reqH = p1.req && p1.req.height;
    info('2', '要求尺寸 (app -> requestWindow)', JSON.stringify(p1.req));
    info('2', '实际 innerWidth x innerHeight', `${p1.inner[0]} x ${p1.inner[1]} (dpr ${p1.dpr})`);
    info('2', '实际 outerWidth x outerHeight', `${p1.outer[0]} x ${p1.outer[1]}`);
    check('2', p1.req && p1.inner[0] === p1.req.width && p1.inner[1] === p1.req.height, 'width/height 即内容视口尺寸 (inner == 要求)', `req ${p1.req && p1.req.width}x${reqH} vs inner ${p1.inner.join('x')} (diff h=${p1.inner[1] - reqH})`);
    info('2', '卡片实际尺寸', `card ${p1.cardW} x ${p1.cardH}`);
    check('2', p1.scrollH <= p1.clientH && p1.scrollW <= p1.clientW, '未被裁切 (scrollingElement scrollHeight<=clientHeight)', `scrollH=${p1.scrollH} clientH=${p1.clientH} scrollW=${p1.scrollW} clientW=${p1.clientW}`);
    info('2', 'PiP document.compatMode', p1.compat);
    const h1 = p1.inner[1];

    // ===== 8a 截圖 =====
    const targets = await http('/json/list');
    info('8', 'CDP targets (PiP 开启时)', targets.map((t) => `${t.type}:${t.url.slice(0, 50)}`).join(' | '));
    info('8', '开启者页面截图', await shot(A, 'opener-with-pip'));
    const pipTarget = targets.find((t) => t.id !== tab.id && t.type === 'page');
    let pipShot = null;
    if (pipTarget) {
      try {
        const P = await connect(pipTarget.webSocketDebuggerUrl);
        const r = await P.send('Page.captureScreenshot', { format: 'png' });
        const pth = join(SHOT_DIR, 'task-7-pip-window.png');
        await writeFile(pth, Buffer.from(r.data, 'base64'));
        pipShot = pth;
        P.ws.close();
      } catch (e) { pipShot = `ERR ${e.message}`; }
    }
    info('8', 'PiP 窗口截图 (经 /json 目标)', pipTarget ? `target ${pipTarget.type} url=${pipTarget.url.slice(0, 40)} -> ${pipShot}` : '未找到 PiP 的 CDP page 目标，无法截图');

    // ===== 3 跳動 =====
    if (!(await ev(A, `(() => { const d = ${PIPDOC}; if (!d) return false; __watchAmount(d); return true; })()`))) throw new Error('PiP window null before the foreground tick check');
    await sleep(5000);
    const s5 = statsOf(await ev(A, '__chg'), 5000);
    check('3', s5.distinct >= 20, 'PiP 金额 5s 内变化 (前景)', `changes=${s5.n} distinct=${s5.distinct} avgGap=${s5.avgGap}ms maxGap=${s5.maxGap}ms (~${s5.perSec}/s)`);

    const Tinfo = await http('/json/new?about:blank', 'PUT');
    const T = await connect(Tinfo.webSocketDebuggerUrl);
    await T.send('Page.bringToFront');
    const hiddenAfter = await waitFor(A, 'document.visibilityState === "hidden"', 5000, 50);
    const visStart = await ev(A, 'document.visibilityState');
    check('3', visStart === 'hidden', '开启者进入后台 (visibilityState==="hidden")', `visibilityState=${visStart} after ~${hiddenAfter}ms`);
    if (!(await ev(A, `(() => { const d = ${PIPDOC}; if (!d) return false; __watchAmount(d); return true; })()`))) throw new Error('PiP window null before the background tick check');
    const t0 = Date.now();
    await sleep(HIDDEN_MS);
    const winMs = Date.now() - t0;
    const chg = await ev(A, '__chg');
    const visEnd = await ev(A, 'document.visibilityState');
    const sh = statsOf(chg, winMs);
    const expected = winMs / 100;
    check('3', sh.n >= expected * 0.8 && sh.maxGap !== null && sh.maxGap <= 500, `后台 ${Math.round(winMs / 1000)}s PiP 金额持续约 100ms 跳动`, `changes=${sh.n} (expected ~${Math.round(expected)}) distinct=${sh.distinct} avgGap=${sh.avgGap}ms maxGap=${sh.maxGap}ms; opener visibility start=${visStart} end=${visEnd}`);
    info('3', 'PiP 内部 visibilityState (后台期间)', await ev(A, `(${PIPDOC} || { visibilityState: 'PiP null' }).visibilityState`));
    await A.send('Page.bringToFront');
    await fetch(`http://127.0.0.1:${PORT}/json/close/${Tinfo.id}`).catch(() => {});
    T.ws.close();
    await sleep(500);

    // ===== 4 佔位卡收回 =====
    await ev(A, 'window.scrollTo(0, 0)');
    const c4 = await closeAndMeasure(A, 'placeholder');
    check('4', c4.ok, '受信任点击占位卡后卡片回到主文件', `delay click->card back in main doc = ${c4.delay}ms (in-page performance.now; pagehide is async after close())`);
    await sleep(200);
    const m4 = await ev(A, MAIN_INFO);
    check('4', m4.placeholderHidden && m4.btn === '悬浮成小窗' && !m4.pipWin, '占位卡消失、按钮文字还原、PiP 已关', `placeholderHidden=${m4.placeholderHidden} btn="${m4.btn}" pipWin=${m4.pipWin}`);
    check('4', m4.cardInMain && m4.size === 'lg', '卡片回到 #status-card 且 data-size="lg"', `inMain=${m4.cardInMain} data-size=${m4.size}`);
    await ev(A, '__watchAmount(document)');
    await sleep(3000);
    const s4 = statsOf(await ev(A, '__chg'), 3000);
    const m4b = await ev(A, MAIN_INFO);
    check('4', s4.perSec >= 8 && s4.perSec <= 11 && m4b.iv100 === 1, '收回后金额续跳且只有一个计时来源', `changes/s=${s4.perSec} (3s window, maxGap=${s4.maxGap}ms) active 100ms intervals in opener=${m4b.iv100}`);

    // ===== 5 齒輪 / X =====
    const o5 = await openPip(A);
    check('5', o5 !== null, '重开 PiP (受信任点击)', `~${o5}ms`);
    await sleep(300);
    await ev(A, 'window.scrollTo(0, 0)');
    await sleep(100);
    const before = await ev(A, MAIN_INFO);
    const c5 = await closeAndMeasure(A, 'gear');
    await sleep(900);
    const after = await ev(A, MAIN_INFO);
    check('5', c5.ok && after.cardInMain && after.size === 'lg' && after.placeholderHidden, 'PiP 内齿轮(页内 click) -> 卡片回主文件', `delay=${c5.delay}ms; inMain=${after.cardInMain} size=${after.size} placeholderHidden=${after.placeholderHidden}${c5.why ? ` (${c5.why})` : ''} (gear click was dispatched via element.click() inside the PiP document, no Chrome block observed)`);
    // 新版面（spec §13.1）：齒輪 = 切到「基本設定」分頁並把焦點放在分頁標籤（取代舊的「捲到設定區」）
    check('5', !before.settingsSelected && after.settingsSelected && after.settingsPanelShown && after.focusId === 'tab-settings' && after.settingsTop >= 0 && !after.pageScrolls, '齿轮后切到「基本设置」分页、焦点在分页标签、设置区在视窗内',
      `selected ${before.settingsSelected} -> ${after.settingsSelected}; panel shown=${after.settingsPanelShown}; focus=${after.focusId}; settings top=${after.settingsTop}px; page scrolls=${after.pageScrolls}`);
    await ev(A, `document.getElementById('tab-calendar').click()`);
    await ev(A, 'window.scrollTo(0, 0)');
    const o5b = await openPip(A);
    await sleep(300);
    const c5x = await closeAndMeasure(A, 'x');
    await sleep(300);
    const afterX = await ev(A, MAIN_INFO);
    check('5', o5b !== null && c5x.ok && afterX.cardInMain && afterX.size === 'lg' && afterX.placeholderHidden && afterX.iv100 === 1, 'documentPictureInPicture.window.close() (模拟 X) -> 同样还原', `delay=${c5x.delay}ms; inMain=${afterX.cardInMain} size=${afterX.size} placeholderHidden=${afterX.placeholderHidden} btn="${afterX.btn}" activeIv100=${afterX.iv100}`);

    // ===== 6 鼓勵語 + 發薪日 =====
    await ev(A, `localStorage.setItem('work-motivator-v1', JSON.stringify({ version: 1, cheer: '今天也要加油，下班就能吃好吃的！', payday: 15 }))`);
    await ev(A, CLEAR_HOLIDAYS);
    await A.send('Page.reload');
    await waitFor(A, 'document.readyState === "complete" && !!document.getElementById("btn-float")', 10000);
    await A.send('Page.bringToFront');
    await sleep(500);
    info('6', '设置方式', '写入 localStorage["work-motivator-v1"] = {cheer, payday:15} 后 reload（非经 UI 输入框）');
    const cheerShown = await ev(A, 'document.querySelector("#status-card .card-cheer").textContent');
    const paydayShown = await ev(A, 'document.querySelector("#status-card .card-payday").textContent');
    info('6', '主页面卡片', `cheer="${cheerShown}" payday="${paydayShown}"`);
    const o6 = await openPip(A);
    check('6', o6 !== null, '设置后重开 PiP', `~${o6}ms`);
    await sleep(400);
    const p6 = await ev(A, PIP_INFO);
    if (!p6) { fail('6', 'PiP 视窗在重开后变成 null', 'documentPictureInPicture.window === null'); throw new Error('PiP window vanished (step 6)'); }
    info('6', '要求尺寸 vs 实际', `req ${JSON.stringify(p6.req)} ; inner ${p6.inner.join('x')} ; outer ${p6.outer.join('x')} ; card ${p6.cardW}x${p6.cardH}`);
    check('6', p6.req && p6.req.height > reqH, '要求高度比无鼓励语/发薪日时增加', `before ${reqH} -> after ${p6.req && p6.req.height}; inner height ${h1} -> ${p6.inner[1]}`);
    check('6', p6.scrollH <= p6.clientH, '未被裁切', `scrollH=${p6.scrollH} clientH=${p6.clientH} (compat=${p6.compat})`);
    check('6', /今天也要加油/.test(p6.text) && /发薪日/.test(p6.text), 'PiP 含鼓励语与发薪日行', `text has cheer=${/今天也要加油/.test(p6.text)} payday=${/发薪日/.test(p6.text)}`);
    info('8', 'PiP 内容(第二次)', `开启者截图 -> ${await shot(A, 'opener-with-pip-cheer')}`);
    const pt2 = (await http('/json/list')).find((t) => t.id !== tab.id && t.type === 'page');
    if (pt2) {
      try {
        const P = await connect(pt2.webSocketDebuggerUrl);
        const r = await P.send('Page.captureScreenshot', { format: 'png' });
        await writeFile(join(SHOT_DIR, 'task-7-pip-window-cheer.png'), Buffer.from(r.data, 'base64'));
        P.ws.close();
        info('8', 'PiP 窗口截图(第二次)', 'task-7-pip-window-cheer.png');
      } catch (e) { info('8', 'PiP 窗口截图(第二次)', `ERR ${e.message}`); }
    }

    // ===== 7 PiP 開著時 reload =====
    const tgtBefore = (await http('/json/list')).filter((t) => t.id !== tab.id && t.type === 'page').map((t) => `${t.type}:${t.url.slice(0, 40)}`);
    await ev(A, CLEAR_HOLIDAYS);
    await A.send('Page.reload');
    await waitFor(A, 'document.readyState === "complete" && !!document.getElementById("btn-float")', 10000);
    await sleep(800);
    const tgtAfter = (await http('/json/list')).filter((t) => t.id !== tab.id && t.type === 'page').map((t) => `${t.type}:${t.url.slice(0, 40)}`);
    const m7 = await ev(A, MAIN_INFO);
    info('7', 'reload 前后非主分页 CDP 目标', `before=[${tgtBefore.join(' | ')}] after=[${tgtAfter.join(' | ')}]`);
    check('7', tgtBefore.length > 0 && tgtAfter.length === 0 && !m7.pipWin, 'reload 后 PiP 窗口已关闭 (无残留 page 目标)', `PiP targets ${tgtBefore.length} -> ${tgtAfter.length}; new doc documentPictureInPicture.window=${m7.pipWin}`);
    check('7', m7.cardInMain && m7.size === 'lg' && m7.placeholderHidden && !m7.btnDisabled && m7.btn === '悬浮成小窗' && m7.iv100 === 1, 'reload 后页面干净恢复', JSON.stringify(m7));
    await ev(A, '__watchAmount(document)');
    await sleep(2000);
    const s7 = statsOf(await ev(A, '__chg'), 2000);
    check('7', s7.perSec >= 8, 'reload 后金额照常跳动', `changes/s=${s7.perSec}`);
    // 本指令碼共載入 3 次（開頁、步驟 6 reload、步驟 7 reload），每次之前都清掉假期資料鍵；
    // 2026 / 2027 都是內建表 → 3 次載入合計仍應是 0 個外部請求，且結果區始終隱藏。
    await waitFor(A, '!document.getElementById("btn-holiday-check").hasAttribute("aria-disabled") && (document.getElementById("holiday-status").getAttribute("aria-label") || "").includes("2027 年 · 内置")', 5000);
    const h9bAll = await ev(A, `(() => { const r = document.getElementById('holiday-result'); return { hidden: r.hidden, tone: r.dataset.tone, line: document.getElementById('holiday-status').getAttribute('aria-label').replace(/^假期数据状态：/, ''), busy: document.getElementById('btn-holiday-check').getAttribute('aria-disabled'), rec: localStorage.getItem('work-motivator-v1-holidays'), now: Date.now() }; })()`);
    info('9', 'reload 后假期数据区', JSON.stringify(h9bAll));
    check('9', refused.length === 0 && h9bAll.hidden === true && h9bAll.tone === '' && h9bAll.line === '2026 年 · 内置 · 2027 年 · 内置' && h9bAll.rec === null, '三次载入（含 2 次 reload，之前清掉假期数据键）都不发请求、不写联网记录、结果区保持隐藏', `refused=${refused.length} ${JSON.stringify(refused)} hidden=${h9bAll.hidden} tone=${h9bAll.tone} line="${h9bAll.line}" rec=${h9bAll.rec}`);
    const o7 = await openPip(A);
    await sleep(300);
    const c7 = await closeAndMeasure(A, 'x');
    check('7', o7 !== null && c7.ok, 'reload 后可再次开启并关闭 PiP', `open ~${o7}ms; close delay=${c7.delay}ms${c7.why ? ` (${c7.why})` : ''}`);
    info('8', '收回后主页面截图', await shot(A, 'main-after'));

    // ===== 10 R45：開啟者在後臺時按 PiP 齒輪 → window.focus() 把開啟者帶回前面並切到「基本設定」=====
    await ev(A, `document.getElementById('tab-calendar').click()`);
    const o10 = await openPip(A);
    check('10', o10 !== null, '重开 PiP（受信任点击）', `~${o10}ms`);
    if (o10 !== null) {
      await sleep(300);
      const T2info = await withTimeout(http('/json/new?about:blank', 'PUT'), STEP_MS, '/json/new');
      const T2 = await connect(T2info.webSocketDebuggerUrl);
      let P10 = null;
      try {
        await T2.send('Page.bringToFront');
        const hid10 = await waitFor(A, 'document.visibilityState === "hidden"', 5000, 50);
        const pre = await ev(A, '({ vis: document.visibilityState, focus: document.hasFocus(), pip: !!documentPictureInPicture.window, selected: document.getElementById("tab-settings").getAttribute("aria-selected") })');
        check('10', pre.vis === 'hidden' && pre.pip && pre.selected === 'false', '前提：另一个分页在前面，开启者 visibilityState==="hidden"，PiP 开着，「基本设置」未选中', `${JSON.stringify(pre)} after ~${hid10}ms`);
        const pipT = (await withTimeout(http('/json/list'), STEP_MS, '/json/list')).find((t) => t.id !== tab.id && t.id !== T2info.id && t.type === 'page');
        let how = null;
        if (!pipT) info('10', 'PiP CDP 目标', '在 /json/list 中找不到 PiP 的 page 目标');
        else {
          try {
            P10 = await connect(pipT.webSocketDebuggerUrl);
            const g = await ev(P10, `(() => { const e = document.querySelector('#status-card .card-gear'); if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()`);
            if (!g) throw new Error('gear not found in the PiP target');
            await P10.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: g.x, y: g.y });
            await P10.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: g.x, y: g.y, button: 'left', clickCount: 1 });
            await P10.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: g.x, y: g.y, button: 'left', clickCount: 1 });
            if ((await waitFor(A, '!documentPictureInPicture.window', 3000, 25)) !== null) how = 'trusted';
            else info('10', '受信任点击', `CDP Input.dispatchMouseEvent 到 PiP 目标 (${g.x.toFixed(1)}, ${g.y.toFixed(1)}) 后 3 秒内 PiP 未关闭`);
          } catch (e) {
            info('10', '受信任点击', `Chrome 不接受 CDP 输入到 PiP 目标：${e.message}`);
          }
        }
        if (how === null) {
          const ok = await ev(A, `(() => { const d = ${PIPDOC}; if (!d) return false; d.querySelector('.card-gear').click(); return true; })()`);
          how = ok ? 'SYNTHETIC element.click() (no user gesture: window.focus() is expected NOT to raise the tab)' : 'none (PiP null)';
          info('10', '点击方式', `fallback: ${how}`);
        } else info('10', '点击方式', 'trusted CDP mouse press/release in the PiP target');
        const back10 = await waitFor(A, 'document.getElementById("tab-settings").getAttribute("aria-selected") === "true" && !documentPictureInPicture.window && !!document.querySelector("#card-slot #status-card")', 5000, 25);
        const front10 = await waitFor(A, 'document.visibilityState === "visible" && document.hasFocus()', 5000, 50);
        const m10 = await ev(A, '({ selected: document.getElementById("tab-settings").getAttribute("aria-selected"), pip: !!documentPictureInPicture.window, card: !!document.querySelector("#card-slot #status-card"), vis: document.visibilityState, focus: document.hasFocus(), active: document.activeElement && document.activeElement.id })');
        check('10', back10 !== null && m10.selected === 'true' && !m10.pip && m10.card, '齿轮后「基本设置」选中、PiP 已关、卡片回到 #status-card', `${JSON.stringify(m10)} after ~${back10}ms (click: ${how})`);
        check('10', front10 !== null && m10.vis === 'visible' && m10.focus, '开启者分页被带到前面（visibilityState==="visible" 且 document.hasFocus()）', `vis=${m10.vis} hasFocus=${m10.focus} after ~${front10}ms (click: ${how})`);
      } finally {
        P10?.ws.close();
        await fetch(`http://127.0.0.1:${PORT}/json/close/${T2info.id}`, { signal: AbortSignal.timeout(5000) }).catch(() => {});
        T2.ws.close();
        await A.send('Page.bringToFront').catch(() => {});
        await sleep(300);
      }
    }

    // ===== console =====
    const uniq = [...new Set(consoleMsgs)];
    check('7', uniq.length === 0, '整个流程开启者 console error/warning/exception', uniq.length ? `${uniq.length} 条: ${uniq.join(' || ')}` : '0 条');
    A.ws.close();
  } finally {
    await cleanup();
  }
}

console.log(`e2e:real — do NOT run concurrently with other Chrome-driven tests (npm run e2e, Playwright, another e2e:real). Hard timeout ${Math.round(HARD_TIMEOUT_MS / 1000)}s.`);
// 硬性逾時：不論卡在哪一步，都殺掉 Chrome、刪 profile，並以非 0 結束（不會再卡 25 分鐘）
const hard = setTimeout(async () => {
  console.error(`\n[FAIL] X harness hard timeout: no completion after ${Math.round(HARD_TIMEOUT_MS / 1000)}s — killing Chrome (was another Chrome-driven test running concurrently?)`);
  await cleanup();
  process.exit(2);
}, HARD_TIMEOUT_MS);
process.on('SIGINT', async () => { await cleanup(); process.exit(130); });

let crashed = null;
try { await main(); } catch (e) { crashed = e; fail('X', 'harness 中途失败', e.stack ?? String(e)); } finally { await cleanup(); clearTimeout(hard); }

console.log('\n===== SUMMARY =====');
const count = (s) => rows.filter((r) => r.status === s).length;
console.log(`PASS=${count('PASS')} FAIL=${count('FAIL')} INFO=${count('INFO')}`);
console.log('NOT VERIFIED (never claimed): Windows, Microsoft Edge, Edge Sleeping Tabs, minimized window, any run longer than the hidden-tab window above (HIDDEN_MS default 60000).');
process.exit(count('FAIL') > 0 || crashed ? 1 : 0);
