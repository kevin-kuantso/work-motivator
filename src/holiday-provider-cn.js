import { HOLIDAYS_CN, STATUTORY_FIXED_FROM_YEAR, STATUTORY_FIXED, CN_HOLIDAY_NAMES } from './holidays-cn.js';
import { STATUTORY_LUNAR, statutoryLunarName } from './statutory-dates.js';

export const CN_HOLIDAY_PROVIDER = Object.freeze({
  tables: HOLIDAYS_CN,
  fixedNames: STATUTORY_FIXED,
  missingYearKind(year) {
    if (Object.hasOwn(STATUTORY_LUNAR, year)) return 'lunar';
    return year >= STATUTORY_FIXED_FROM_YEAR ? 'fixed' : 'none';
  },
  fallback(date, key) {
    if (date.getFullYear() < STATUTORY_FIXED_FROM_YEAR) return null;
    const md = `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const lunar = statutoryLunarName(key);
    return STATUTORY_FIXED[md] ?? (lunar ? CN_HOLIDAY_NAMES[lunar] : null);
  },
});
