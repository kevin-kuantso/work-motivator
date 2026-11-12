// 計時排程（R46）：一般模式 100 ms 的 setInterval；減少動態模式（1 秒一跳）用自我校正的 setTimeout 鏈對齊牆上時鐘的整秒
// （延遲 = 1000 − now % 1000，至少 20 ms），倒數秒數不跳號、不重複。計時器跑在 host 上（主視窗或小窗）。
// 不變式：任何時刻最多一個計時器。每次 start / stop 換一個世代號，過期的回撥什麼都不做；
// 鏈在每次觸發後按「此刻」的 reduced() 決定下一步——matchMedia 已翻轉、change 事件還沒到時，也會自己交接給另一種模式，不會斷。
export const TICK_MS = 100;
export const TICK_MS_REDUCED = 1000;
export const TICK_MIN_DELAY_MS = 20;

export function alignedDelay(nowMs) {
  return Math.max(TICK_MIN_DELAY_MS, TICK_MS_REDUCED - (nowMs % TICK_MS_REDUCED));
}

// tick：每次要做的事；reduced()：當下是否減少動態；now()：牆上時鐘毫秒（全域 Date.now，不是可注入的 clock）
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
        // tick 裡可能已經重啟（例如搬到小窗）：世代號變了就不再接續
        if (g === gen && timeout === null && interval === null) {
          if (reduced()) scheduleAligned(g);
          else startInterval(g); // 已不再減少動態：交接給 100 ms，不留空檔
        }
      }
    }, alignedDelay(now()));
  }

  // 一般模式：每次 tick 後也按「此刻」的 reduced() 檢查（round 2，與上面的方向對稱）：
  // 已改成減少動態、change 事件還沒到時，清掉 interval，交接給對齊整秒的鏈
  function startInterval(g) {
    interval = host.setInterval(() => {
      if (g !== gen) return;
      try {
        tick();
      } finally {
        if (g === gen && interval !== null && reduced()) {
          host.clearInterval(interval);
          interval = null;
          scheduleAligned(g);
        }
      }
    }, TICK_MS);
  }

  function start(nextHost = host) {
    stop();
    host = nextHost;
    if (!host) return;
    if (reduced()) scheduleAligned(gen);
    else startInterval(gen);
  }

  return { start, stop };
}
