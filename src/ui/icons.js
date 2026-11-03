// 小图示（内联 SVG，以 doc 建立节点，可在 PiP 文件中使用）。纯装饰：aria-hidden。
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
  holiday: [['path', { d: 'M4 14V2.5' }], ['path', { d: 'M4 3h7.5l-1.8 2.5 1.8 2.5H4' }]],
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
