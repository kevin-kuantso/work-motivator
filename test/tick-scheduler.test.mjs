// Task 14 fix round 1 · Block D：計時排程（R46）。一般模式 100 ms setInterval；減少動態模式對齊整秒的 setTimeout 鏈。
// 用假的計時宿主（虛擬時鐘）與可注入的 reduced() 測試：任何時刻最多一個計時器；matchMedia 翻轉而 change 事件還沒到時鏈不中斷。
import test from 'node:test';
import assert from 'node:assert/strict';
import { alignedDelay, createTicker, TICK_MS, TICK_MIN_DELAY_MS } from '../src/ui/tick-scheduler.js';

function fakeHost(clock) {
  const timers = new Map();
  let id = 0;
  const host = {
    timers,
    setTimeout(fn, ms) { const i = ++id; timers.set(i, { fn, at: clock.t + ms, every: null }); return i; },
    setInterval(fn, ms) { const i = ++id; timers.set(i, { fn, at: clock.t + ms, every: ms }); return i; },
    clearTimeout(i) { timers.delete(i); },
    clearInterval(i) { timers.delete(i); },
  };
  return host;
}
// 推進虛擬時鐘，按時間順序觸發到期的計時器；每次觸發後記錄所有宿主上存活的計時器數
function run(clock, hosts, ms, onFire = () => {}) {
  const end = clock.t + ms;
  for (;;) {
    let next = null;
    for (const h of hosts) for (const [i, x] of h.timers) if (x.at <= end && (!next || x.at < next.x.at)) next = { h, i, x };
    if (!next) break;
    clock.t = next.x.at;
    if (next.x.every) next.x.at += next.x.every;
    else next.h.timers.delete(next.i);
    try {
      next.x.fn();
    } catch { /* 瀏覽器會報告例外，但計時器照常 */ }
    onFire(hosts.reduce((n, h) => n + h.timers.size, 0));
  }
  clock.t = end;
}

test('alignedDelay: next wall-clock second, clamped to ≥ 20 ms', () => {
  assert.equal(alignedDelay(0), 1000);
  assert.equal(alignedDelay(1500), 500);
  assert.equal(alignedDelay(12345), 655);
  assert.equal(alignedDelay(979), 21);
  assert.equal(alignedDelay(980), TICK_MIN_DELAY_MS);
  assert.equal(alignedDelay(999), TICK_MIN_DELAY_MS, '1 ms before the boundary → clamp');
  assert.equal(alignedDelay(1000), 1000, 'exactly on the boundary → a full second');
});

test('reduced mode: ticks land on whole seconds; normal mode: 100 ms interval; exactly one timer', () => {
  const clock = { t: 600 };
  const h = fakeHost(clock);
  const at = [];
  let reduced = true;
  const tk = createTicker({ tick: () => at.push(clock.t), reduced: () => reduced, now: () => clock.t });
  tk.start(h);
  const live = [];
  run(clock, [h], 5000, (n) => live.push(n));
  assert.deepEqual(at, [1000, 2000, 3000, 4000, 5000]);
  assert.ok(live.every((n) => n === 1), `one timer at every observation: ${live}`);
  reduced = false;
  tk.start();
  at.length = 0;
  run(clock, [h], 300);
  assert.deepEqual(at, [5700, 5800, 5900], "100 ms after the restart at 5600");
  assert.equal(h.timers.size, 1);
  assert.equal([...h.timers.values()][0].every, TICK_MS);
});

test('D1: reduce → off flips and a tick lands BEFORE the change event: the chain hands over to the 100 ms interval (no gap, one timer)', () => {
  const clock = { t: 0 };
  const h = fakeHost(clock);
  const at = [];
  let reduced = true;
  const tk = createTicker({ tick: () => at.push(clock.t), reduced: () => reduced, now: () => clock.t });
  tk.start(h);
  run(clock, [h], 1000); // 1 次整秒 tick
  reduced = false; // matchMedia 已翻轉，change 事件還沒送到
  const live = [];
  run(clock, [h], 1500, (n) => live.push(n));
  assert.ok(live.every((n) => n === 1), `exactly one timer: ${live}`);
  const gaps = at.slice(1).map((x, i) => x - at[i]);
  assert.ok(Math.max(...gaps) <= 1000, `no gap > 1 s: ${gaps}`);
  assert.ok(at.filter((x) => x > 2000).length >= 4, 'now ticking at 100 ms');
  tk.start(); // change 事件終於到了：重啟，仍只有一個計時器
  assert.equal(h.timers.size, 1);
});

test('D1 (round 2): off → reduce flips and ticks run before the change event: the interval hands over to the aligned chain at its next tick; never two timers', () => {
  const clock = { t: 50 };
  const h = fakeHost(clock);
  const at = [];
  let reduced = false;
  const tk = createTicker({ tick: () => at.push(clock.t), reduced: () => reduced, now: () => clock.t });
  tk.start(h);
  run(clock, [h], 300);
  reduced = true; // matchMedia 已翻轉，change 事件被扣住
  at.length = 0;
  const live = [];
  run(clock, [h], 3000, (n) => live.push(n));
  assert.ok(live.every((n) => n === 1), `one timer: ${live}`);
  assert.equal([...h.timers.values()][0].every, null, 'now an aligned setTimeout, not the 100 ms interval');
  assert.ok(at.slice(1).every((x) => x % 1000 === 0), `after the first (handover) tick everything is on whole seconds: ${at}`);
  assert.ok(at.length <= 4, `no more 100 ms ticks (${at.length})`);
  tk.start(); // change 事件終於到了
  assert.equal(h.timers.size, 1);
});

// 世代號守衛（tick-scheduler.js 回撥開頭與 finally 裡的 g === gen）：在 tick 裡呼叫 stop()，之後不能再有計時器；
// 已經派發出去的過期回撥（clear 時已在事件迴圈裡排隊）也不能再 tick
test('generation guard: stop() inside a tick ends everything; a stale callback that still fires after stop/start does nothing', () => {
  for (const mode of [true, false]) {
    const clock = { t: 0 };
    const h = fakeHost(clock);
    let n = 0;
    let tk;
    tk = createTicker({ tick: () => { n++; if (n === 2) tk.stop(); }, reduced: () => mode, now: () => clock.t });
    tk.start(h);
    const live = [];
    run(clock, [h], 5000, (k) => live.push(k));
    assert.equal(n, 2, `${mode ? 'aligned' : 'interval'}: no tick after stop()`);
    assert.equal(live[1], 0, `${mode ? 'aligned' : 'interval'}: zero timers right after the tick that called stop() (${live})`);
    assert.equal(h.timers.size, 0, `${mode ? 'aligned' : 'interval'}: no timer left after stop() inside a tick`);
  }
  // 過期回撥：記下第一次排定的回撥，stop + start 之後手動再執行它（模擬 clear 時它已排進任務佇列）
  const clock = { t: 0 };
  const h = fakeHost(clock);
  let n = 0;
  const tk = createTicker({ tick: () => { n++; }, reduced: () => true, now: () => clock.t });
  tk.start(h);
  const stale = [...h.timers.values()][0].fn;
  tk.start(h);
  stale();
  assert.equal(n, 0, 'stale callback must not tick');
  assert.equal(h.timers.size, 1, 'stale callback must not schedule another timer');
});

test('a throwing tick never ends the aligned chain; moving the timer to another host (PiP) inside a tick leaves exactly one timer', () => {
  const clock = { t: 0 };
  const a = fakeHost(clock);
  const b = fakeHost(clock);
  let n = 0;
  let tk;
  tk = createTicker({
    tick: () => {
      n++;
      if (n === 2) throw new Error('boom');
      if (n === 4) tk.start(b); // 例如小窗開啟：計時搬到小窗
    },
    reduced: () => true,
    now: () => clock.t,
  });
  tk.start(a);
  const live = [];
  run(clock, [a, b], 6000, (k) => live.push(k));
  assert.ok(n >= 6, `chain survived the exception (${n} ticks)`);
  assert.ok(live.every((k) => k === 1), `one timer across both hosts: ${live}`);
  assert.equal(a.timers.size, 0);
  assert.equal(b.timers.size, 1);
  tk.stop();
  assert.equal(b.timers.size, 0);
});
