import { mountApp } from './ui.js';

// 部分环境（隐私设置、file:// 限制）连读取 localStorage 属性都会抛例外：
// 改用一个必定失败的储存，让设置层回报「无法保存」而不是整页崩溃。
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
