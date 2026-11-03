// 月历：切换月份、图例常驻、点日期循环切换（修改即存）、无内置假期表的年份显示提示条。
import { h, show, setText } from './dom.js';
import { icon } from './icons.js';
import { monthGrid, nextMark } from './calendar-model.js';

const TAG_ICON = { holiday: 'holiday', makeup: 'makeup', paid: 'paid', unpaid: 'unpaid' };
const MARK_KIND = { paidLeave: 'paid', unpaidLeave: 'unpaid', work: 'makeup' };

export function createCalendar(doc, t, { getState, getToday, onMarks }) {
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

  function cycle(cell) {
    const { cfg, marks } = getState();
    const mark = nextMark(cell.date, cfg, marks);
    const next = { ...marks };
    if (mark === undefined) delete next[cell.key];
    else next[cell.key] = mark;
    const md = `${cell.date.getMonth() + 1}/${cell.day}`;
    focusKey = cell.key;
    onMarks(next, mark === undefined ? c.cleared(md) : c.marked(md, c.kinds[MARK_KIND[mark]]), marks);
  }

  function onKey(e, cell) {
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

    const model = monthGrid(view.y, view.m, cfg, marks, today);
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
            onclick: () => cycle(cell),
            onkeydown: (e) => onKey(e, cell),
          },
          h(doc, 'span', { class: 'day-num', text: String(cell.day) }),
          tag(cell.kind),
          cell.holidayName ? h(doc, 'span', { class: 'day-name', text: cell.holidayName }) : null,
          cell.manual ? h(doc, 'span', { class: 'day-dot', title: c.manualTitle }) : null);
          if (cell.key === refocus) toFocus = btn;
          return h(doc, 'span', { class: 'cal-cell', role: 'gridcell' }, btn);
        })));
    grid.replaceChildren(head, ...rows);
    if (toFocus) toFocus.focus();
  }

  return { el, render };
}
