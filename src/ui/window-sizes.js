export const UI_SCALES = Object.freeze(['xs', 's', 'm', 'l', 'xl']);

// 舊紀錄沒有 manual 旗標；它們只能來自使用者先前拉過的小窗，因此保守地保留為手動尺寸。
export function readSizes(value) {
  const out = {};
  if (!value || typeof value !== 'object') return out;
  for (const scale of UI_SCALES) {
    const item = value[scale];
    const width = Number(item?.width);
    const height = Number(item?.height);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) continue;
    out[scale] = {
      width: Math.round(width),
      height: Math.round(height),
      manual: item?.manual !== false,
    };
  }
  return out;
}
