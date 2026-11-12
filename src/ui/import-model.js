// 純函式：把 importState 的結果整理成匯入報告（design-spec §8.2）。
// 「已匯入 N 項」= importState 實際套用的欄位數（共享設定 + 按地區的月薪 + 按地區的月曆標記）。
// 欄位路徑帶地區（salaries.CN、marksByRegion.TW.2026-05-04）時，報告要寫明是哪一地的資料。
import { reasonText } from '../calc.js';

// 地區名稱：優先用字典的專用對映（t.regions），其次用設定面板的地區選項文案，最後退回穩定 ID。
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

// 「月薪 · 中國大陸」：地區與欄位用 ASCII 分隔符拼起來，不依賴任何一種語言的標點。
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

// 已匯入的項由 importState 判定（它知道跨欄位校驗和舊備份併入哪一地），這裡只數結果。
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
