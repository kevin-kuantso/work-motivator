import { mountApp } from './ui.js';

// 部分環境（隱私設定、file:// 限制）連讀取 localStorage 屬性都會拋例外：
// 改用一個必定失敗的儲存，讓設定層回報「無法儲存」而不是整頁崩潰。
const unavailable = {
  getItem() { throw new Error('storage unavailable'); },
  setItem() { throw new Error('storage unavailable'); },
};
let storage;
try {
  storage = window.localStorage ?? unavailable;
} catch {
  storage = unavailable;
}

mountApp(document, storage, () => new Date());
