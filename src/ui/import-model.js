// 纯函数：把 importState 的结果整理成导入报告（design-spec §8.2）。
// 「已导入 N 项」= 文件中通过验证并套用的设置字段数 + 月历标记数。
const CFG_FIELDS = ['salary', 'start', 'end', 'lunchOn', 'lunchStart', 'lunchEnd', 'weekends', 'payday', 'cheer', 'showLunar'];

export function fieldLabel(field, t) {
  if (field === 'marks') return t.importer.marksField;
  if (field.startsWith('marks.')) return t.importer.markField(field.slice(6));
  return t.settings[field] ?? field;
}

function valueText(field, state, t) {
  const im = t.importer;
  if (field === 'marks') return im.none;
  if (field.startsWith('marks.')) {
    const v = state.marks[field.slice(6)];
    return v ? im.keep(im.markValues[v]) : im.keep(im.unmarked);
  }
  const v = state.cfg[field];
  if (typeof v === 'boolean') return im.keep(v ? t.settings.on : t.settings.off);
  if (v === null || v === undefined || v === '') return im.keep(im.emptyValue);
  if (field === 'payday') return im.keep(t.settings.paydayOption(v));
  return im.keep(String(v));
}

export function importReport(obj, result, t) {
  const droppedFields = new Set(result.dropped.map((d) => d.field));
  let applied = 0;
  for (const k of CFG_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(obj, k) && !droppedFields.has(k)) applied++;
  }
  const m = obj.marks;
  if (m && typeof m === 'object' && !Array.isArray(m)) {
    for (const k of Object.keys(m)) if (!droppedFields.has(`marks.${k}`)) applied++;
  }
  const rows = [
    ...result.dropped.map((d) => ({
      field: d.field,
      label: fieldLabel(d.field, t),
      reason: d.reason,
      value: valueText(d.field, result.state, t),
    })),
    ...result.unknown.map((k) => ({ field: null, label: k, reason: t.importer.unknownReason, value: t.importer.none })),
  ];
  return { applied, rows, title: t.importer.reportTitle(applied, rows.length) };
}
