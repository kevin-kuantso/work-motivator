// 小圖示（內聯 SVG，以 doc 建立節點，可在 PiP 文件中使用）。純裝飾：aria-hidden。
const SVG_NS = 'http://www.w3.org/2000/svg';

const PATHS = {
  working: [['circle', { cx: 8, cy: 8, r: 4, fill: 'currentColor', stroke: 'none' }]],
  lunch: [['path', { d: 'M3 6h8v4a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3z' }], ['path', { d: 'M11 7h1.5a1.5 1.5 0 0 1 0 3H11' }]],
  before: [['circle', { cx: 8, cy: 8, r: 5.5 }], ['path', { d: 'M8 5v3.2l2 1.3' }]],
  after: [['circle', { cx: 8, cy: 8, r: 5.5 }], ['path', { d: 'M5.5 8.2l1.8 1.8 3.3-3.6' }]],
  rest: [['path', { d: 'M10.5 2.8A5.5 5.5 0 1 0 13.2 10 4.5 4.5 0 0 1 10.5 2.8z' }]],
  paid: [['circle', { cx: 8, cy: 8, r: 5.5 }], ['path', { d: 'M6 5l2 2.6L10 5M8 7.6V11.5M6.2 8.6h3.6' }]],
  unpaid: [['circle', { cx: 8, cy: 8, r: 5.5 }], ['path', { d: 'M4.2 11.8l7.6-7.6' }]],
  makeup: [['rect', { x: 2.5, y: 5, width: 11, height: 8, rx: 1.5 }], ['path', { d: 'M6 5V3.5h4V5M2.5 8.5h11' }]],
  // M9：12px 的描邊旗子在小尺寸下像字母「P」；改成實心小旗（旗面填色、更寬），小尺寸仍讀得出一面旗
  holiday: [['path', { d: 'M4 14V2.6' }], ['rect', { x: 5.1, y: 3.1, width: 7.4, height: 5.1, rx: 0.7, fill: 'currentColor', stroke: 'none' }]],
  check: [['path', { d: 'M3.5 8.5l3 3 6-7' }]],
  reset: [['path', { d: 'M3.2 8a4.8 4.8 0 1 0 1.4-3.4' }], ['path', { d: 'M4.2 2.2v2.6h2.6' }]],
  pip: [['rect', { x: 2, y: 3, width: 12, height: 10, rx: 1.5 }], ['rect', { x: 8, y: 8, width: 4.5, height: 3.5, rx: 0.8, fill: 'currentColor', stroke: 'none' }]],
  wallet: [['rect', { x: 2, y: 4, width: 12, height: 9, rx: 1.5 }], ['path', { d: 'M2 6.5h12M10.5 9.5h1' }]],
  data: [['ellipse', { cx: 8, cy: 4, rx: 5, ry: 2 }], ['path', { d: 'M3 4v8c0 1.1 2.2 2 5 2s5-.9 5-2V4M3 8c0 1.1 2.2 2 5 2s5-.9 5-2' }]],
  lock: [['rect', { x: 3.5, y: 7, width: 9, height: 6.5, rx: 1.2 }], ['path', { d: 'M5.5 7V5a2.5 2.5 0 0 1 5 0v2' }]],
  gear: [['circle', { cx: 8, cy: 8, r: 2.2 }], ['path', { d: 'M8 1.8v2M8 12.2v2M1.8 8h2M12.2 8h2M3.6 3.6 5 5M11 11l1.4 1.4M3.6 12.4 5 11M11 5l1.4-1.4' }]],
};

export function icon(doc, name) {
  const svg = doc.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('width', '14');
  svg.setAttribute('height', '14');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.5');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.classList.add('icon', `icon-${name}`);
  for (const [tag, attrs] of PATHS[name] ?? []) {
    const el = doc.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
    svg.append(el);
  }
  return svg;
}
