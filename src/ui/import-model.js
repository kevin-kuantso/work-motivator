// 纯函数：把 importState 的结果整理成导入报告（design-spec §8.2）。
// 「已导入 N 项」= importState 实际套用的字段数（共享设置 + 按地区的月薪 + 按地区的月历标记）。
// 字段路径带地区（salaries.CN、marksByRegion.TW.2026-05-04）时，报告要写明是哪一地的数据。
import { reasonText } from '../calc.js';

// 地区名称：优先用字典的专用映射（t.regions），其次用设置面板的地区选项文案，最后退回稳定 ID。
function regionName(t, id) {
  const fromMap = t.regions?.[id];
  if (typeof fromMap === 'string') return fromMap;
  const copy = t.settings?.region;
  const fromOptions = typeof copy === 'object' ? copy.options?.[id] : null;
  return typeof fromOptions === 'string' ? fromOptions : id;
}

function regionFieldLabel(t) {
  const copy = t.settings?.region;
  const fromDict = typeof copy === 'string' ? copy : copy?.label;
  return fromDict ?? 'region';
}

// 「月薪 · 中国大陆」：地区与字段用 ASCII 分隔符拼起来，不依赖任何一种语言的标点。
const withRegion = (label, name) => `${label} · ${name}`;

const SALARY_PREFIX = 'salaries.';
const MARKS_REGION_PREFIX = 'marksByRegion.';

export function fieldLabel(field, t) {
  const im = t.importer;
  if (field === 'region') return regionFieldLabel(t);
  if (field === 'cheer' || field === 'cheers') return t.settings.cheer;
  if (field === 'salaries') return t.settings.salary;
  if (field.startsWith(SALARY_PREFIX)) {
    return withRegion(t.settings.salary, regionName(t, field.slice(SALARY_PREFIX.length)));
  }
  if (field === 'marksByRegion') return im.marksField;
  if (field.startsWith(MARKS_REGION_PREFIX)) {
    const rest = field.slice(MARKS_REGION_PREFIX.length);
    const dot = rest.indexOf('.');
    if (dot < 0) return withRegion(im.marksField, regionName(t, rest));
    const id = rest.slice(0, dot);
    return withRegion(im.markField(rest.slice(dot + 1)), regionName(t, id));
  }
  return t.settings[field] ?? field;
}

function valueText(field, state, t) {
  const im = t.importer;
  if (field === 'region') return im.keep(regionName(t, state.region));
  if (field === 'salaries' || field === 'marksByRegion') return im.none;
  if (field.startsWith(SALARY_PREFIX)) {
    const v = state.salaries?.[field.slice(SALARY_PREFIX.length)];
    return im.keep(v === undefined ? im.emptyValue : String(v));
  }
  if (field.startsWith(MARKS_REGION_PREFIX)) {
    const rest = field.slice(MARKS_REGION_PREFIX.length);
    const dot = rest.indexOf('.');
    if (dot < 0) return im.none;
    const v = state.marksByRegion?.[rest.slice(0, dot)]?.[rest.slice(dot + 1)];
    return v ? im.keep(im.markValues[v] ?? String(v)) : im.keep(im.unmarked);
  }
  const v = state.cfg[field === 'cheer' ? 'cheers' : field];
  if (typeof v === 'boolean') return im.keep(v ? t.settings.on : t.settings.off);
  if (v === null || v === undefined || v === '') return im.keep(im.emptyValue);
  if (field === 'payday') return im.keep(t.settings.paydayOption(v));
  if (field === 'theme') return im.keep(t.settings.themeOptions[v] ?? String(v));
  if (field === 'fontScale') return im.keep(t.settings.display?.fontScaleOptions?.[v] ?? String(v));
  return im.keep(String(v));
}

// 已导入的项由 importState 判定（它知道跨字段校验和旧备份并入哪一地），这里只数结果。
export function importReport(result, t) {
  const applied = Array.isArray(result.applied) ? result.applied.length : 0;
  const rows = [
    ...result.dropped.map((d) => ({
      field: d.field,
      label: fieldLabel(d.field, t),
      reason: reasonText(d.reason, t),
      value: valueText(d.field, result.state, t),
    })),
    ...result.unknown.map((k) => ({ field: null, label: k, reason: t.importer.unknownReason, value: t.importer.none })),
  ];
  return { applied, rows, title: t.importer.reportTitle(applied, rows.length) };
}
