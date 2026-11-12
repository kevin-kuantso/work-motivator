// 月曆（spec §13.3）：工具列（切月、回到今天；PgUp / PgDn 只寫在切月按鈕的懸停提示裡）、
// 摘要行（應出勤天數、日薪、情境膠囊、缺表標籤、重置本月標記）、固定列出全部 7 種的單行圖例（R36）、彈性行高的格子；
// 點日期彈出小選單（修改即存），懸停 / 聚焦提示直接蓋在該格上（R35、Task 18）。
import { h, show, setText } from './dom.js';
import { icon } from './icons.js';
import { monthGrid } from './calendar-model.js';
import { monthWage } from '../calc.js';
import { applyOption, menuModel, dayTooltipModel, tooltipText } from './day-options.js';
import { createDayMenu } from './day-menu.js';
import { createDayTooltip } from './day-tooltip.js';
import { money, lunarText } from './format.js';
import { monthContext, missingTableTag } from './holiday-context.js';

const TAG_ICON = { holiday: 'holiday', makeup: 'makeup', paid: 'paid', unpaid: 'unpaid', rest: 'rest' };
const MARK_KIND = { paidLeave: 'paid', unpaidLeave: 'unpaid', work: 'makeup', rest: 'rest' };
// 圖例：永遠列出全部型別（R36），順序固定；「工作日」是普通格子，不列入
const LEGEND_KINDS = ['weekend', 'holiday', 'makeup', 'paid', 'unpaid'];
const HOVER_MS = 400;

// getTables：當前使用的假期表（app.js 持有，替換後呼叫 render 即可）。
// setProfile(t)：切換地區時原地換字典（不重掛載：不重建 DOM、不丟焦點與月份），靜態文字、圖例與模型一起重新整理。
export function createCalendar(doc, initialT, { getState, getTables, getToday, onMarks, onUndo }) {
  let t = initialT;
  let c = t.calendar;
  const today0 = getToday();
  let view = { y: today0.getFullYear(), m: today0.getMonth() };
  let lastTodayKey = null;
  let focusKey = null; // 下一次重繪後要聚焦的日期（套用選單、PgUp / PgDn）
  let rovingKey = null; // 月曆的 Tab 停靠點：跟著實際焦點走
  let quiet = false; // 程式聚焦（Esc 關選單、重繪後還原焦點）時不彈提示

  // 法定假日格只放旗子圖示 + 節日名（Task 18：不再有「假」字；無節日名時只剩旗子，格子的無障礙名稱仍寫明「法定假日」）
  const tag = (kind) =>
    TAG_ICON[kind] ? h(doc, 'span', { class: 'day-tag' }, icon(doc, TAG_ICON[kind]), c.tags[kind] ?? null) : null;

  const title = h(doc, 'span', { class: 'cal-title', id: 'cal-title', 'aria-live': 'polite' });
  const prevBtn = h(doc, 'button', { type: 'button', class: 'btn btn-s btn-secondary cal-prev', text: c.prev, title: c.prevTitle, onclick: () => move(-1) });
  const nextBtn = h(doc, 'button', { type: 'button', class: 'btn btn-s btn-secondary cal-next', text: c.next, title: c.nextTitle, onclick: () => move(1) });
  const todayBtn = h(doc, 'button', { type: 'button', class: 'btn btn-s btn-secondary cal-today', onclick: goToday });
  const summaryText = h(doc, 'span', { class: 'cal-summary-text' });
  const noteIcon = h(doc, 'span', { class: 'cal-note-icon' });
  const noteText = h(doc, 'span', { class: 'cal-note-text' });
  const note = h(doc, 'span', { class: 'cal-note' }, noteIcon, noteText);
  const yearTag = h(doc, 'span', { class: 'cal-year-tag', hidden: true });
  const reset = h(doc, 'button', { type: 'button', class: 'btn btn-s btn-secondary cal-reset', hidden: true, text: c.reset, onclick: resetMonth });
  const undo = h(doc, 'button', { type: 'button', class: 'btn btn-s btn-secondary cal-undo', text: c.undoMark, 'aria-disabled': 'true', onclick: () => { if (undo.getAttribute('aria-disabled') !== 'true') onUndo(); } });
  const legendTitle = h(doc, 'span', { class: 'legend-title', text: c.legend });
  const legendItems = h(doc, 'span', { class: 'legend-items' });
  const grid = h(doc, 'div', { class: 'cal-grid', role: 'grid', 'aria-labelledby': 'cal-title' });
  const hint = h(doc, 'span', { class: 'legend-hint', text: c.legendHint });
  const toolbar = h(doc, 'div', { class: 'cal-toolbar' }, prevBtn, title, nextBtn, todayBtn, hint);

  // 圖例色塊只放圖示（文字標籤已說明型別），省寬度以保持單行
  const legendItem = (kind, label) =>
    h(doc, 'span', { class: 'legend-item', 'data-kind': kind },
      h(doc, 'span', { class: `legend-swatch kind-${kind}` }, TAG_ICON[kind] ? icon(doc, TAG_ICON[kind]) : null), label);

  const el = h(doc, 'section', { class: 'calendar', 'aria-label': c.title },
    toolbar,
    h(doc, 'div', { class: 'cal-summary' }, summaryText, note, yearTag, undo, reset),
    h(doc, 'div', { class: 'cal-legend' }, legendTitle, legendItems),
    grid);
  const menu = createDayMenu(doc, el, { onChoose: apply, refocus: (btn) => focusQuietly(btn) });
  const tooltip = createDayTooltip(doc);
  el.append(menu.el);

  function focusQuietly(btn) {
    quiet = true;
    try {
      btn.focus();
    } finally {
      quiet = false;
    }
  }

  function show1(y, m) {
    view = { y, m };
    render();
  }

  function move(delta) {
    const d = new Date(view.y, view.m + delta, 1);
    show1(d.getFullYear(), d.getMonth());
  }

  function goToday() {
    const d = getToday();
    show1(d.getFullYear(), d.getMonth());
  }

  function resetMonth() {
    const { marks } = getState();
    const prefix = `${view.y}-${String(view.m + 1).padStart(2, '0')}-`;
    const next = Object.fromEntries(Object.entries(marks).filter(([k]) => !k.startsWith(prefix)));
    onMarks(next, (strings) => strings.calendar.resetDone, marks);
  }

  function apply(key, id) {
    const { marks } = getState();
    const [y, m, d] = key.split('-').map(Number);
    const next = applyOption(marks, new Date(y, m - 1, d), id);
    const mark = next[key];
    if (mark === marks[key]) return; // 選了當前項：不改動、不彈提示
    focusKey = key;
    const md = `${m}/${d}`;
    onMarks(next, (strings) => mark === undefined ? strings.calendar.cleared(md) : strings.calendar.marked(md, strings.calendar.kinds[MARK_KIND[mark]]), marks);
  }

  function toggleMenu(cell, btn) {
    tooltip.hide();
    if (menu.key() === cell.key) {
      menu.close(true);
      return;
    }
    const { cfg, marks } = getState();
    menu.open(btn, cell.key, menuModel(cell.date, cfg, marks, getTables(), t));
  }

  // 鍵盤聚焦才立即顯示；滑鼠點選後的程式聚焦不彈提示（懸停另有 0.4 秒延遲）
  const keyboardFocus = (btn) => {
    try {
      return btn.matches(':focus-visible');
    } catch {
      return true;
    }
  };

  function setRoving(btn) {
    rovingKey = btn.dataset.key;
    for (const b of grid.querySelectorAll('button[tabindex="0"]')) if (b !== btn) b.tabIndex = -1;
    btn.tabIndex = 0;
  }

  function onKey(e, cell) {
    if (e.key === 'Escape') {
      tooltip.hide();
      return;
    }
    if (e.key === 'PageUp' || e.key === 'PageDown') {
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      e.preventDefault();
      // APG 日期選擇器：切到上 / 下個月，焦點停在同號日期，沒有就落到月底
      const first = new Date(view.y, view.m + (e.key === 'PageUp' ? -1 : 1), 1);
      const last = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
      const target = new Date(first.getFullYear(), first.getMonth(), Math.min(cell.day, last));
      focusKey = keyOf(target);
      show1(first.getFullYear(), first.getMonth());
      return;
    }
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
    if (!step) return;
    e.preventDefault();
    const last = new Date(view.y, view.m + 1, 0).getDate();
    const day = Math.min(last, Math.max(1, cell.day + step));
    const target = grid.querySelector(`button[data-day="${day}"]`);
    if (target) target.focus();
  }

  const keyOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  // 圖例只隨地區變（不隨月份變）：切換地區時整體重建（文字全部來自字典）
  function buildLegend() {
    legendItems.replaceChildren(
      ...LEGEND_KINDS.map((k) => legendItem(k, c.kinds[k])),
      h(doc, 'span', { class: 'legend-item', 'data-kind': 'today' }, h(doc, 'span', { class: 'legend-swatch is-today' }), c.todayLabel),
      h(doc, 'span', { class: 'legend-item', 'data-kind': 'manual' }, h(doc, 'span', { class: 'legend-swatch' }, h(doc, 'span', { class: 'day-dot' })), c.manual));
  }
  buildLegend();

  function renderNote(tables, today, provider) {
    const m = monthContext(view.y, view.m, tables, today, t, provider);
    note.dataset.tone = m.tone;
    noteIcon.replaceChildren(m.check ? icon(doc, 'check') : m.tone === 'holiday' ? icon(doc, 'holiday') : '');
    show(noteIcon, m.check || m.tone === 'holiday');
    setText(noteText, m.text);
    if (note.title !== m.title) note.title = m.title;
  }

  // 優先完整提示；空間不夠時改短提示，再放不下才隱藏。切月、resize 與字型就緒都重算。
  function fitHint() {
    hint.hidden = false;
    setText(hint, c.legendHint);
    const bar = toolbar.getBoundingClientRect();
    if (!bar.width) return; // 隱藏的分頁（display:none）裡無從量測
    const last = todayBtn.getBoundingClientRect();
    const fits = () => {
      const r = hint.getBoundingClientRect();
      return r.width && r.right <= bar.right + 0.5 && r.left >= last.right + 8 - 0.5;
    };
    if (!fits()) {
      setText(hint, c.legendHintShort);
      if (!fits()) hint.hidden = true;
    }
  }

  function render() {
    const { cfg, marks } = getState();
    const today = getToday();
    const todayKey = `${today.getFullYear()}-${today.getMonth()}-${today.getDate()}`;
    // 跨日：原本停在「今天」所在月份時，跟著今天走
    if (lastTodayKey !== null && lastTodayKey !== todayKey) {
      const [py, pm] = lastTodayKey.split('-').map(Number);
      if (py === view.y && pm === view.m) view = { y: today.getFullYear(), m: today.getMonth() };
    }
    lastTodayKey = todayKey;

    const active = doc.activeElement;
    const refocus = focusKey ?? (active && grid.contains(active) ? active.dataset.key : null);
    focusKey = null;

    const tables = getTables();
    const model = monthGrid(view.y, view.m, cfg, marks, today, tables);
    tooltip.hide();
    const monthTitle = c.monthTitle(view.y, view.m + 1);
    setText(title, monthTitle);
    const isThisMonth = view.y === today.getFullYear() && view.m === today.getMonth();
    setText(todayBtn, isThisMonth ? c.today : c.todayBack(c.monthTitle(today.getFullYear(), today.getMonth() + 1)));
    todayBtn.classList.toggle('is-away', !isThisMonth);
    const wage = monthWage(view.y, view.m, cfg, marks, tables);
    setText(summaryText, c.summary(wage.workdays, `${t.currency}${money(wage.dailyWage, 2, t)}`));
    // R41：缺表標籤只在當年與之後的年份顯示，措辭按該年實際標出的日子
    const missing = missingTableTag(view.y, today, tables, t, cfg.holidayProvider);
    show(yearTag, Boolean(missing));
    setText(yearTag, missing ? missing.text : '');
    yearTag.title = missing ? missing.title : '';
    renderNote(tables, today, cfg.holidayProvider);
    show(reset, model.hasMarks);

    const head = h(doc, 'div', { class: 'cal-row cal-head', role: 'row' },
      c.weekHeads.map((w) => h(doc, 'span', { class: 'cal-colhead', role: 'columnheader', text: w })));
    const cells = model.weeks.flat().filter(Boolean);
    const inMonth = (k) => (k && cells.some((x) => x.key === k) ? k : null);
    const tabKey = inMonth(refocus) ?? inMonth(menu.key()) ?? inMonth(rovingKey) ?? cells.find((x) => x.today)?.key ?? cells[0].key;
    let toFocus = null;
    const rows = model.weeks.map((week) =>
      h(doc, 'div', { class: 'cal-row', role: 'row' },
        week.map((cell) => {
          if (!cell) return h(doc, 'span', { class: 'cal-cell is-empty', role: 'gridcell' });
          const tip = dayTooltipModel(cell.date, cfg, marks, tables, today, t);
          const lunar = cfg.showLunar ? lunarText(cell.date, t) : null;
          const descId = `day-desc-${cell.key}`;
          const btn = h(doc, 'button', {
            type: 'button',
            class: `day kind-${cell.kind}${cell.today ? ' is-today' : ''}${cell.manual ? ' is-manual' : ''}`,
            'data-key': cell.key,
            'data-day': String(cell.day),
            tabindex: cell.key === tabKey ? '0' : '-1',
            'aria-label': c.cellAria({
              month: cell.date.getMonth() + 1, day: cell.day, weekday: t.weekdays[cell.weekday],
              kind: c.kinds[cell.kind], holidayName: cell.holidayName, manual: cell.manual, today: cell.today,
            }),
            'aria-describedby': descId,
            'aria-haspopup': 'menu',
            'aria-expanded': 'false',
            onclick: () => toggleMenu(cell, btn),
            onkeydown: (e) => onKey(e, cell),
            onmouseenter: () => { if (!menu.isOpen()) tooltip.later(btn, tip, HOVER_MS); },
            onmouseleave: () => tooltip.hide(),
            onfocus: () => {
              setRoving(btn);
              if (!quiet && !menu.isOpen() && keyboardFocus(btn)) tooltip.show(btn, tip);
            },
            onblur: () => tooltip.hide(),
          },
          h(doc, 'span', { class: 'day-date' },
            h(doc, 'span', { class: 'day-num' }, h(doc, 'span', { class: 'day-num-ink', text: String(cell.day) })),
            lunar ? h(doc, 'span', { class: 'day-lunar', 'aria-hidden': 'true', text: lunar.short }) : null),
          cell.kind in TAG_ICON || cell.holidayName
            ? h(doc, 'span', { class: 'day-label' }, tag(cell.kind), cell.holidayName ? h(doc, 'span', { class: 'day-name', text: cell.holidayName }) : null)
            : null,
          cell.manual ? h(doc, 'span', { class: 'day-dot', title: c.manualTitle }) : null);
          if (cell.key === refocus) toFocus = btn;
          return h(doc, 'span', { class: 'cal-cell', role: 'gridcell' }, btn,
            h(doc, 'span', { id: descId, hidden: true, text: tooltipText(tip, t) }));
        })));
    const menuHadFocus = menu.hasFocus();
    grid.replaceChildren(head, ...rows);
    if (toFocus) focusQuietly(toFocus);
    // 選單開啟時重繪（跨日、其他分頁改了設定）：日期仍在畫面上就原地更新，否則關閉且不丟焦點
    if (menu.isOpen()) {
      const key = menu.key();
      const anchor = grid.querySelector(`button[data-key="${key}"]`);
      const cell = cells.find((x) => x.key === key);
      if (anchor && cell) {
        menu.refresh(anchor, menuModel(cell.date, cfg, marks, tables, t));
      } else {
        menu.close(false);
        if (menuHadFocus) focusQuietly(grid.querySelector('button[tabindex="0"]'));
      }
    }
    fitHint();
    centerTodayInk();
  }

  // 切換地區：字典換掉後原地重刷靜態文字、圖例與整月模型（焦點 / 月份 / 選單開合都由 render 自己保留）。
  // 不重建任何節點，也不重新掛載（mountApp 沒有 dispose，重掛會重複 listener 與 ticker）。
  function setProfile(nextT) {
    if (nextT === t) return;
    t = nextT;
    c = t.calendar;
    el.setAttribute('aria-label', c.title);
    setText(prevBtn, c.prev);
    prevBtn.title = c.prevTitle;
    setText(nextBtn, c.next);
    nextBtn.title = c.nextTitle;
    setText(reset, c.reset);
    setText(undo, c.undoMark);
    setText(legendTitle, c.legend);
    buildLegend();
    render(); // 內含 fitHint()：換了字典後提示文字變長／變短都重新量測
  }

  // 切換分頁時收起選單與提示（兩者都浮在月曆上）
  function hideOverlays() {
    tooltip.hide();
    menu.close(false);
  }

  // 把當天數字的實際墨跡中心對齊圓心；保留等寬數字，字型變化時重新量。
  function centerTodayInk() {
    const num = grid.querySelector('.day.is-today .day-num');
    const ink = num?.querySelector('.day-num-ink');
    if (!ink || !num.getClientRects().length) return;
    ink.style.removeProperty('transform');
    const circle = num.getBoundingClientRect();
    const cs = doc.defaultView.getComputedStyle(ink);
    const ctx = doc.createElement('canvas').getContext('2d');
    if (!ctx) return;
    ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    ctx.fontKerning = cs.fontKerning;
    // Canvas 不繼承等寬數字，依 DOM 中各數字的實際寬度測量。
    const node = ink.firstChild;
    const range = doc.createRange();
    let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
    for (let i = 0; i < node.length; i++) {
      range.setStart(node, i);
      range.setEnd(node, i + 1);
      const rect = range.getBoundingClientRect();
      const m = ctx.measureText(node.data[i]);
      if (![m.actualBoundingBoxLeft, m.actualBoundingBoxRight, m.actualBoundingBoxAscent, m.actualBoundingBoxDescent, m.fontBoundingBoxAscent].every(Number.isFinite)) return;
      const origin = rect.left + (rect.width - m.width) / 2;
      const baseline = rect.top + m.fontBoundingBoxAscent;
      left = Math.min(left, origin - m.actualBoundingBoxLeft);
      right = Math.max(right, origin + m.actualBoundingBoxRight);
      top = Math.min(top, baseline - m.actualBoundingBoxAscent);
      bottom = Math.max(bottom, baseline + m.actualBoundingBoxDescent);
    }
    if (left <= right && top <= bottom) ink.style.transform = `translate(${(circle.left + circle.right - left - right) / 2}px, ${(circle.top + circle.bottom - top - bottom) / 2}px)`;
  }

  // 提示的「放得下嗎」隨視窗寬度與字型度量變化：掛一次監聽，量測同步執行（不靠 rAF，測試裡的假時鐘不會吞掉）
  try {
    doc.defaultView?.addEventListener?.('resize', () => { fitHint(); centerTodayInk(); });
    doc.fonts?.ready?.then?.(() => { fitHint(); centerTodayInk(); }, () => {});
    doc.fonts?.addEventListener?.('loadingdone', () => { fitHint(); centerTodayInk(); });
  } catch {
    // 沒有 FontFaceSet：只靠 resize 與 render
  }

  return { el, render, setProfile, hideOverlays, setUndoAvailable: (available) => undo.setAttribute('aria-disabled', String(!available)), refreshLayout: () => { fitHint(); centerTodayInk(); } };
}
