// 月历：切换月份、图例常驻、点日期弹出小选单（修改即存）、悬停 / 聚焦提示、无内置假期表的年份显示提示条。
import { h, show, setText } from './dom.js';
import { icon } from './icons.js';
import { monthGrid } from './calendar-model.js';
import { applyOption, menuModel, dayTooltipModel, tooltipText } from './day-options.js';
import { createDayMenu } from './day-menu.js';
import { createDayTooltip } from './day-tooltip.js';

const TAG_ICON = { holiday: 'holiday', makeup: 'makeup', paid: 'paid', unpaid: 'unpaid' };
const MARK_KIND = { paidLeave: 'paid', unpaidLeave: 'unpaid', work: 'makeup', rest: 'rest' };
const HOVER_MS = 400;

// getTables：当前使用的假期表（app.js 持有，替换后调用 render 即可）。
export function createCalendar(doc, t, { getState, getTables, getToday, onMarks }) {
  const c = t.calendar;
  const today0 = getToday();
  let view = { y: today0.getFullYear(), m: today0.getMonth() };
  let lastTodayKey = null;
  let focusKey = null;

  const tag = (kind) =>
    TAG_ICON[kind] ? h(doc, 'span', { class: 'day-tag' }, icon(doc, TAG_ICON[kind]), c.tags[kind]) : null;

  const banner = h(doc, 'p', { class: 'banner banner-notice year-banner', role: 'status', hidden: true });
  const title = h(doc, 'span', { class: 'cal-title', id: 'cal-title', 'aria-live': 'polite' });
  const reset = h(doc, 'button', { type: 'button', class: 'btn btn-ghost cal-reset', hidden: true, text: c.reset, onclick: resetMonth });
  const grid = h(doc, 'div', { class: 'cal-grid', role: 'grid', 'aria-labelledby': 'cal-title' });

  const legendItem = (kind, label, extra = null) =>
    h(doc, 'span', { class: 'legend-item' },
      h(doc, 'span', { class: `legend-swatch kind-${kind}` }, tag(kind), extra), label);
  const legend = h(doc, 'div', { class: 'cal-legend' },
    h(doc, 'span', { class: 'legend-title', text: c.legend }),
    ['workday', 'weekend', 'holiday', 'makeup', 'paid', 'unpaid'].map((k) => legendItem(k, c.kinds[k])),
    h(doc, 'span', { class: 'legend-item' }, h(doc, 'span', { class: 'legend-swatch is-today' }), c.todayLabel),
    h(doc, 'span', { class: 'legend-item' }, h(doc, 'span', { class: 'legend-swatch' }, h(doc, 'span', { class: 'day-dot' })), c.manual));

  const el = h(doc, 'section', { class: 'panel calendar', 'aria-labelledby': 'cal-heading' },
    h(doc, 'h2', { id: 'cal-heading', text: c.title }),
    banner,
    h(doc, 'div', { class: 'cal-toolbar' },
      h(doc, 'button', { type: 'button', class: 'btn btn-ghost', text: c.prev, onclick: () => move(-1) }),
      title,
      h(doc, 'button', { type: 'button', class: 'btn btn-ghost', text: c.next, onclick: () => move(1) }),
      h(doc, 'button', { type: 'button', class: 'btn btn-ghost', text: c.today, onclick: goToday }),
      reset),
    legend,
    grid);
  const menu = createDayMenu(doc, el, { onChoose: apply });
  const tooltip = createDayTooltip(doc, el);
  el.append(menu.el, tooltip.el);

  function move(delta) {
    const d = new Date(view.y, view.m + delta, 1);
    view = { y: d.getFullYear(), m: d.getMonth() };
    render();
  }

  function goToday() {
    const d = getToday();
    view = { y: d.getFullYear(), m: d.getMonth() };
    render();
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

  function onKey(e, cell) {
    if (e.key === 'Escape') {
      tooltip.hide();
      return;
    }
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
    if (!step) return;
    e.preventDefault();
    const last = new Date(view.y, view.m + 1, 0).getDate();
    const day = Math.min(last, Math.max(1, cell.day + step));
    const target = grid.querySelector(`button[data-day="${day}"]`);
    if (target) {
      for (const b of grid.querySelectorAll('button[tabindex="0"]')) b.tabIndex = -1;
      target.tabIndex = 0;
      target.focus();
    }
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
    const refocus = active && grid.contains(active) ? active.dataset.key : focusKey;
    focusKey = null;

    const tables = getTables();
    const model = monthGrid(view.y, view.m, cfg, marks, today, tables);
    tooltip.hide();
    setText(title, c.monthTitle(view.y, view.m + 1));
    show(banner, model.tableMissing);
    setText(banner, model.tableMissing ? t.banner.yearMissing(view.y) : '');
    show(reset, model.hasMarks);

    const head = h(doc, 'div', { class: 'cal-row cal-head', role: 'row' },
      c.weekHeads.map((w, i) => h(doc, 'span', { class: `cal-colhead${i >= 5 ? ' is-weekend' : ''}`, role: 'columnheader', text: w })));
    const cells = model.weeks.flat().filter(Boolean);
    const tabKey = cells.find((x) => x.key === refocus)?.key ?? cells.find((x) => x.today)?.key ?? cells[0].key;
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
            onfocus: () => { if (!menu.isOpen() && keyboardFocus(btn)) tooltip.show(btn, tip); },
            onblur: () => tooltip.hide(),
          },
          h(doc, 'span', { class: 'day-num', text: String(cell.day) }),
          tag(cell.kind),
          cell.holidayName ? h(doc, 'span', { class: 'day-name', text: cell.holidayName }) : null,
          cell.manual ? h(doc, 'span', { class: 'day-dot', title: c.manualTitle }) : null);
          if (cell.key === refocus) toFocus = btn;
          return h(doc, 'span', { class: 'cal-cell', role: 'gridcell' }, btn,
            h(doc, 'span', { id: descId, hidden: true, text: tooltipText(tip) }));
        })));
    const menuHadFocus = menu.hasFocus();
    grid.replaceChildren(head, ...rows);
    if (toFocus) toFocus.focus();
    // 选单打开时重绘（跨日、其他分页改了设置）：日期仍在画面上就原地更新，否则关闭且不丢焦点
    if (menu.isOpen()) {
      const key = menu.key();
      const anchor = grid.querySelector(`button[data-key="${key}"]`);
      const cell = cells.find((x) => x.key === key);
      if (anchor && cell) {
        menu.refresh(anchor, menuModel(cell.date, cfg, marks, tables));
      } else {
        menu.close(false);
        if (menuHadFocus) grid.querySelector('button[tabindex="0"]')?.focus();
      }
    }
  }

  return { el, render };
}
