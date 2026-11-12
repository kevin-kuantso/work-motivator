// 分頁（WAI-ARIA APG Tabs，自動啟用）：tablist / tab / tabpanel、aria-controls、aria-selected、
// roving tabindex；←/→ 迴圈切換、Home / End 到首尾。非當前面板用 hidden（不可聚焦，DOM 與輸入值保留）。
import { h, setText } from './dom.js';

export function createTabs(doc, { tabs, initial, onChange, label }) {
  const btns = new Map();
  let cur = null;
  let tabLabel = label; // 可隨地區切換；按鈕文字由 setProfile 傳入的文字替換

  const root = h(doc, 'div', { class: 'tablist', role: 'tablist', 'aria-label': tabLabel });
  for (const tab of tabs) {
    const btn = h(doc, 'button', {
      type: 'button', role: 'tab', class: 'tab', id: `tab-${tab.id}`, 'aria-controls': `panel-${tab.id}`,
      'aria-selected': 'false', tabindex: '-1', text: tab.label,
      onclick: () => select(tab.id, { focus: true }),
      onkeydown: (e) => onKey(e, tab.id),
    });
    btns.set(tab.id, btn);
    root.append(btn);
    tab.panel.id = `panel-${tab.id}`;
    tab.panel.setAttribute('role', 'tabpanel');
    tab.panel.setAttribute('aria-labelledby', `tab-${tab.id}`);
    tab.panel.hidden = true;
  }
  const ids = tabs.map((x) => x.id);
  const original = new Map(tabs.map((x) => [x.id, x.label])); // 字典缺項時保留建構時的文字，不猜

  function onKey(e, id) {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const i = ids.indexOf(id);
    const to = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: ids.length - 1 }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    select(ids[(to + ids.length) % ids.length], { focus: true });
  }

  function select(id, { focus = false } = {}) {
    if (!btns.has(id)) return;
    const changed = id !== cur;
    cur = id;
    for (const tab of tabs) {
      const on = tab.id === id;
      const btn = btns.get(tab.id);
      btn.setAttribute('aria-selected', String(on));
      btn.tabIndex = on ? 0 : -1;
      tab.panel.hidden = !on;
    }
    if (focus) btns.get(id).focus();
    if (changed) onChange?.(id);
  }

  // 切換地區：只換文字與 aria-label（tablist 不重建，選中項、焦點與面板輸入都保留）
  function setProfile(t) {
    tabLabel = t.tabs.label;
    root.setAttribute('aria-label', tabLabel);
    for (const tab of tabs) setText(btns.get(tab.id), t.tabs[tab.id] ?? original.get(tab.id));
  }

  select(initial);
  return { select, current: () => cur, root, setProfile };
}
