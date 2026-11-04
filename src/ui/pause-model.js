// 纯函数：判断两次 tick 之间页面是否「停过」（R34 / R42）。
// 同时看单调时钟（performance.now：后台节流、冻结）与墙上时钟（全域 Date.now：macOS 休眠时单调时钟可能不走），取较大者。
// 都不用可注入的 clock（测试会直接设定它）。
export const STALL_MS = 5000;

export const readTicks = (perfNow, wallNow) => () => ({ perf: perfNow(), wall: wallNow() });

export function stallGap(prev, cur) {
  if (!prev) return 0;
  return Math.max(cur.perf - prev.perf, cur.wall - prev.wall);
}

export const isStall = (prev, cur) => stallGap(prev, cur) > STALL_MS;
