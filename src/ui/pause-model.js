// 纯函数：判断两次 tick 之间页面是否「停过」（R34 / R42 / R44）。
// 单调时钟（performance.now：后台节流、冻结）与墙上时钟（全域 Date.now：macOS 休眠时单调时钟可能不走）。
// 都不用可注入的 clock（测试会直接设定它）。
// - 可见时：两者间隔取较大者 > 5 秒 = 停过（R42）。
// - 隐藏时（两次 tick 任一在隐藏状态）：Chrome 的 intensive wake-up throttling 每分钟才跑一次计时器，
//   单调时钟的大间隔不代表画面过期（回来时 visibilitychange 立即重画），只有「墙上时钟比单调时钟多走 > 5 秒」
//   （= 机器睡过）才算（R44）。冻结则由 Page Lifecycle resume 事件另行处理。
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
