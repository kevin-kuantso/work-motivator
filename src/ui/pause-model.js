// 純函式：判斷兩次 tick 之間頁面是否「停過」（R34 / R42 / R44）。
// 單調時鐘（performance.now：後臺節流、凍結）與牆上時鐘（全域 Date.now：macOS 休眠時單調時鐘可能不走）。
// 都不用可注入的 clock（測試會直接設定它）。
// - 可見時：兩者間隔取較大者 > 5 秒 = 停過（R42）。
// - 隱藏時（兩次 tick 任一在隱藏狀態）：Chrome 的 intensive wake-up throttling 每分鐘才跑一次計時器，
//   單調時鐘的大間隔不代表畫面過期（回來時 visibilitychange 立即重畫），只有「牆上時鐘比單調時鐘多走 > 5 秒」
//   （= 機器睡過）才算（R44）。凍結則由 Page Lifecycle resume 事件另行處理。
export const STALL_MS = 5000;

export const readTicks = (perfNow, wallNow, isHidden) => () => ({ perf: perfNow(), wall: wallNow(), hidden: Boolean(isHidden()) });

export function stallGap(prev, cur) {
  if (!prev) return 0;
  return Math.max(cur.perf - prev.perf, cur.wall - prev.wall);
}

export function sleptGap(prev, cur) {
  if (!prev) return 0;
  return (cur.wall - prev.wall) - (cur.perf - prev.perf);
}

export function isStall(prev, cur) {
  if (!prev) return false;
  if (prev.hidden || cur.hidden) return sleptGap(prev, cur) > STALL_MS;
  return stallGap(prev, cur) > STALL_MS;
}
