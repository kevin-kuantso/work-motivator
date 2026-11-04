// 计时调度（R46）：一般模式 100 ms 的 setInterval；减少动态模式（1 秒一跳）用自我校正的 setTimeout 链对齐墙上时钟的整秒
// （延迟 = 1000 − now % 1000，至少 20 ms），倒数秒数不跳号、不重复。计时器跑在 host 上（主视窗或小窗）。
// 不变式：任何时刻最多一个计时器。每次 start / stop 换一个世代号，过期的回调什么都不做；
// 链在每次触发后按「此刻」的 reduced() 决定下一步——matchMedia 已翻转、change 事件还没到时，也会自己交接给另一种模式，不会断。
export const TICK_MS = 100;
export const TICK_MS_REDUCED = 1000;
export const TICK_MIN_DELAY_MS = 20;

export function alignedDelay(nowMs) {
  return Math.max(TICK_MIN_DELAY_MS, TICK_MS_REDUCED - (nowMs % TICK_MS_REDUCED));
}

// tick：每次要做的事；reduced()：当下是否减少动态；now()：墙上时钟毫秒（全域 Date.now，不是可注入的 clock）
export function createTicker({ tick, reduced, now }) {
  let host = null;
  let interval = null;
  let timeout = null;
  let gen = 0;

  function stop() {
    if (host) {
      host.clearInterval(interval);
      host.clearTimeout(timeout);
    }
    interval = null;
    timeout = null;
    gen++;
  }

  function scheduleAligned(g) {
    timeout = host.setTimeout(() => {
      if (g !== gen) return;
      timeout = null;
      try {
        tick();
      } finally {
        // tick 里可能已经重启（例如搬到小窗）：世代号变了就不再接续
        if (g === gen && timeout === null && interval === null) {
          if (reduced()) scheduleAligned(g);
          else interval = host.setInterval(tick, TICK_MS); // 已不再减少动态：交接给 100 ms，不留空档
        }
      }
    }, alignedDelay(now()));
  }

  function start(nextHost = host) {
    stop();
    host = nextHost;
    if (!host) return;
    if (reduced()) scheduleAligned(gen);
    else interval = host.setInterval(tick, TICK_MS);
  }

  return { start, stop };
}
