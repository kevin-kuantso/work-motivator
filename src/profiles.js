import { STRINGS as CN } from './strings.zh-CN.js';
import { STRINGS as TW } from './strings.zh-TW.js';
import { CN_HOLIDAY_PROVIDER } from './holiday-provider-cn.js';
import { TW_BUILTIN_TABLES } from './holidays-tw.js';

const TW_HOLIDAY_PROVIDER = Object.freeze({ tables: TW_BUILTIN_TABLES, fallback: () => null });
export const PROFILES = Object.freeze({
  TW: Object.freeze({ id: 'TW', locale: 'zh-TW', currency: 'NT$', strings: TW, holidayProvider: TW_HOLIDAY_PROVIDER }),
  CN: Object.freeze({ id: 'CN', locale: 'zh-CN', currency: '¥', strings: CN, holidayProvider: CN_HOLIDAY_PROVIDER }),
});
