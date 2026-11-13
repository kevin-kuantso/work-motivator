'use strict';

const WIDTHS = Object.freeze({ xs: 328, s: 344, m: 352, l: 368, xl: 384 });
const MIN_WIDTHS = Object.freeze({ xs: 312, s: 328, m: 328, l: 344, xl: 344 });
const MIN_HEIGHT = 200;
const GAP = 16;

const finite = (value, fallback) => Number.isFinite(value) && value > 0 ? Math.round(value) : fallback;
function clamp(value, low, high) { return Math.max(low, Math.min(value, high)); }

function planWidgetLayout({ current = null, reason = 'open', workArea, scale = 'm', measured = null } = {}) {
  const area = workArea ?? { x: 0, y: 0, width: 1280, height: 800 };
  const minWidth = MIN_WIDTHS[scale] ?? MIN_WIDTHS.m;
  const fallbackWidth = WIDTHS[scale] ?? WIDTHS.m;
  const manual = Boolean(current?.manual);
  const width = clamp(finite(current?.width, fallbackWidth), minWidth, Math.max(minWidth, area.width - GAP * 2));
  const naturalHeight = finite(measured?.height, MIN_HEIGHT);
  // A passive ResizeObserver measurement must never undo a height the person dragged.
  // Explicit content/scale changes are different: their new layout is allowed to refit,
  // including after the widget was closed and recreated on the next launch.
  const refitContent = reason === 'measure' ? !manual : reason === 'content' || reason === 'scale';
  const height = clamp(
    refitContent ? naturalHeight : finite(current?.height, naturalHeight),
    MIN_HEIGHT,
    Math.max(MIN_HEIGHT, area.height - GAP * 2)
  );
  const x = clamp(finite(current?.x, area.x + area.width - width - GAP), area.x + GAP, area.x + area.width - width - GAP);
  const y = clamp(finite(current?.y, area.y + area.height - height - GAP), area.y + GAP, area.y + area.height - height - GAP);
  return { x, y, width, height, manual: refitContent ? false : manual, scale };
}
module.exports = { WIDTHS, MIN_WIDTHS, MIN_HEIGHT, planWidgetLayout };
