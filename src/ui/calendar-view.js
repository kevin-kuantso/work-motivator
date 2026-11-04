// 月历（spec §13.3）：工具列（切月、回到今天；PgUp / PgDn 只写在切月按钮的悬停提示里）、
// 摘要行（应出勤天数、日薪、情境胶囊、缺表标签、重置本月标记）、固定列出全部 7 种的单行图例（R36）、弹性行高的格子；
// 点日期弹出小菜单（修改即存），悬停 / 聚焦提示直接盖在该格上（R35、Task 18）。
import { h, show, setText } from './dom.js';
import { icon } from './icons.js';
import { monthGrid } from './calendar-model.js';
import { monthWage } from '../calc.js';
import { applyOption, menuModel, dayTooltipModel, tooltipText } from './day-options.js';
import { createDayMenu } from './day-menu.js';
import { createDayTooltip } from './day-tooltip.js';
import { money } from './format.js';
import { monthContext, missingTableTag } from './holiday-context.js';

const TAG_ICON = { holiday: 'holiday', makeup: 'makeup', paid: 'paid', unpaid: 'unpaid' };
const MARK_KIND = { paidLeave: 'paid', unpaidLeave: 'unpaid', work: 'makeup', rest: 'rest' };
// 图例：永远列出全部类型（R36），顺序固定；「工作日」是普通格子，不列入
const LEGEND_KINDS = ['weekend', 'holiday', 'makeup', 'paid', 'unpaid'];
const HOVER_MS = 400;

// getTables：当前使用的假期表（app.js 持有，替换后调用 render 即可）。
export function createCalendar(doc, t, { getState, getTables, getToday, onMarks }) {
  const c = t.calendar;
  const today0 = getToday();
  let view = { y: today0.getFullYear(), m: today0.getMonth() };
  let lastTodayKey = null;
  let focusKey = null; // 下一次重绘后要聚焦的日期（套用菜单、PgUp / PgDn）
  let rovingKey = null; // 月历的 Tab 停靠点：跟着实际焦点走
  let quiet = false; // 程序聚焦（Esc 关菜单、重绘后还原焦点）时不弹提示

  // 法定假日格只放旗子图示 + 节日名（Task 18：不再有「假」字；无节日名时只剩旗子，格子的无障碍名称仍写明「法定假日」）
  const tag = (kind) =>
    TAG_ICON[kind] ? h(doc, 'span', { class: 'day-tag' }, icon(doc, TAG_ICON[kind]), c.tags[kind] ?? null) : null;

  const title = h(doc, 'span', { class: 'cal-title', id: 'cal-title', 'aria-live': 'polite' });
  const todayBtn = h(doc, 'button', { type: 'button', class: 'btn btn-s btn-secondary cal-today', onclick: goToday });
  const summaryText = h(doc, 'span', { class: 'cal-summary-text' });
  const noteIcon = h(doc, 'span', { class: 'cal-note-icon' });
  const noteText = h(doc, 'span', { class: 'cal-note-text' });
  const noteSub = h(doc, 'span', { class: 'cal-note-sub' });
  const note = h(doc, 'span', { class: 'cal-note' }, noteIcon, noteText, noteSub);
  const yearTag = h(doc, 'span', { class: 'cal-year-tag', hidden: true });
  const reset = h(doc, 'button', { type: 'button', class: 'btn btn-s btn-ghost cal-reset', hidden: true, text: c.reset, onclick: resetMonth });
  const legendItems = h(doc, 'span', { class: 'legend-items' });
  const grid = h(doc, 'div', { class: 'cal-grid', role: 'grid', 'aria-labelledby': 'cal-title' });

  // 图例色块只放图示（文字标签已说明类型），省宽度以保持单行
  const legendItem = (kind, label) =>
    h(doc, 'span', { class: 'legend-item', 'data-kind': kind },
      h(doc, 'span', { class: `legend-swatch kind-${kind}` }, TAG_ICON[kind] ? icon(doc, TAG_ICON[kind]) : null), label);

  const el = h(doc, 'section', { class: 'calendar', 'aria-label': c.title },
    h(doc, 'div', { class: 'cal-toolbar' },
      h(doc, 'button', { type: 'button', class: 'btn btn-s btn-secondary cal-prev', text: c.prev, title: c.prevTitle, onclick: () => move(-1) }),
      title,
      h(doc, 'button', { type: 'button', class: 'btn btn-s btn-secondary cal-next', text: c.next, title: c.nextTitle, onclick: () => move(1) }),
      todayBtn),
    h(doc, 'div', { class: 'cal-summary' }, summaryText, note, yearTag, reset),
    h(doc, 'div', { class: 'cal-legend' },
      h(doc, 'span', { class: 'legend-title', text: c.legend }),
      legendItems,
      h(doc, 'span', { class: 'legend-hint', text: c.legendHint })),
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
    onMarks(next, c.resetDone, marks);
  }

  function apply(key, id) {
    const { marks } = getState();
    const [y, m, d] = key.split('-').map(Number);
    const next = applyOption(marks, new Date(y, m - 1, d), id);
    const mark = next[key];
    if (mark === marks[key]) return; // 选了当前项：不改动、不弹提示
    focusKey = key;
    const md = `${m}/${d}`;
    onMarks(next, mark === undefined ? c.cleared(md) : c.marked(md, c.kinds[MARK_KIND[mark]]), marks);
  }

  function toggleMenu(cell, btn) {
    tooltip.hide();
    if (menu.key() === cell.key) {
      menu.close(true);
      return;
    }
    const { cfg, marks } = getState();
    menu.open(btn, cell.key, menuModel(cell.date, cfg, marks, getTables()));
  }

  // 键盘聚焦才立即显示；鼠标点击后的程序聚焦不弹提示（悬停另有 0.4 秒延迟）
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
      // APG 日期选择器：切到上 / 下个月，焦点停在同号日期，没有就落到月底
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

  // 图例只建一次（内容不随月份变）
  legendItems.replaceChildren(
    ...LEGEND_KINDS.map((k) => legendItem(k, c.kinds[k])),
    h(doc, 'span', { class: 'legend-item', 'data-kind': 'today' }, h(doc, 'span', { class: 'legend-swatch is-today' }), c.todayLabel),
    h(doc, 'span', { class: 'legend-item', 'data-kind': 'manual' }, h(doc, 'span', { class: 'legend-swatch' }, h(doc, 'span', { class: 'day-dot' })), c.manual));

  function renderNote(tables, today) {
    const m = monthContext(view.y, view.m, tables, today, t);
    note.dataset.tone = m.tone;
    noteIcon.replaceChildren(m.check ? icon(doc, 'check') : m.tone === 'holiday' ? icon(doc, 'holiday') : '');
    show(noteIcon, m.check || m.tone === 'holiday');
    setText(noteText, m.text);
    setText(noteSub, m.sub ?? '');
    show(noteSub, Boolean(m.sub));
    if (note.title !== m.title) note.title = m.title;
  }

  function render() {
    const { cfg, marks } = getState();
    const today = getToday();
    const todayKey = `${today.getFullYear()}-${today.getMonth()}-${today.getDate()}`;
    // 跨日：原本停在「今天」所在月份时，跟着今天走
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
    setText(summaryText, c.summary(wage.workdays, `${t.currency}${money(wage.dailyWage)}`));
    // R41：缺表标签只在当年与之后的年份显示，措辞按该年实际标出的日子
    const missing = missingTableTag(view.y, today, tables, t);
    show(yearTag, Boolean(missing));
    setText(yearTag, missing ? missing.text : '');
    yearTag.title = missing ? missing.title : '';
    renderNote(tables, today);
    show(reset, model.hasMarks);

    const head = h(doc, 'div', { class: 'cal-row cal-head', role: 'row' },
      c.weekHeads.map((w, i) => h(doc, 'span', { class: `cal-colhead${i >= 5 ? ' is-weekend' : ''}`, role: 'columnheader', text: w })));
    const cells = model.weeks.flat().filter(Boolean);
    const inMonth = (k) => (k && cells.some((x) => x.key === k) ? k : null);
    const tabKey = inMonth(refocus) ?? inMonth(menu.key()) ?? inMonth(rovingKey) ?? cells.find((x) => x.today)?.key ?? cells[0].key;
    let toFocus = null;
    const rows = model.weeks.map((week) =>
      h(doc, 'div', { class: 'cal-row', role: 'row' },
        week.map((cell) => {
          if (!cell) return h(doc, 'span', { class: 'cal-cell is-empty', role: 'gridcell' });
          const tip = dayTooltipModel(cell.date, cfg, marks, tables, today);
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
          h(doc, 'span', { class: 'day-num', text: String(cell.day) }),
          cell.kind in TAG_ICON || cell.holidayName
            ? h(doc, 'span', { class: 'day-label' }, tag(cell.kind), cell.holidayName ? h(doc, 'span', { class: 'day-name', text: cell.holidayName }) : null)
            : null,
          cell.manual ? h(doc, 'span', { class: 'day-dot', title: c.manualTitle }) : null);
          if (cell.key === refocus) toFocus = btn;
          return h(doc, 'span', { class: 'cal-cell', role: 'gridcell' }, btn,
            h(doc, 'span', { id: descId, hidden: true, text: tooltipText(tip) }));
        })));
    const menuHadFocus = menu.hasFocus();
    grid.replaceChildren(head, ...rows);
    if (toFocus) focusQuietly(toFocus);
    // 菜单打开时重绘（跨日、其他分页改了设置）：日期仍在画面上就原地更新，否则关闭且不丢焦点
    if (menu.isOpen()) {
      const key = menu.key();
      const anchor = grid.querySelector(`button[data-key="${key}"]`);
      const cell = cells.find((x) => x.key === key);
      if (anchor && cell) {
        menu.refresh(anchor, menuModel(cell.date, cfg, marks, tables));
      } else {
        menu.close(false);
        if (menuHadFocus) focusQuietly(grid.querySelector('button[tabindex="0"]'));
      }
    }
  }

  // 切换分页时收起菜单与提示（两者都浮在月历上）
  function hideOverlays() {
    tooltip.hide();
    menu.close(false);
  }

  return { el, render, hideOverlays };
}
