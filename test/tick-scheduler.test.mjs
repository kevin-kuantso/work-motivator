// Task 14 fix round 1 · Block D：计时调度（R46）。一般模式 100 ms setInterval；减少动态模式对齐整秒的 setTimeout 链。
// 用假的计时宿主（虚拟时钟）与可注入的 reduced() 测试：任何时刻最多一个计时器；matchMedia 翻转而 change 事件还没到时链不中断。
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
// 推进虚拟时钟，按时间顺序触发到期的计时器；每次触发后记录所有宿主上存活的计时器数
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
    } catch { /* 浏览器会报告例外，但计时器照常 */ }
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
  reduced = false; // matchMedia 已翻转，change 事件还没送到
  const live = [];
  run(clock, [h], 1500, (n) => live.push(n));
  assert.ok(live.every((n) => n === 1), `exactly one timer: ${live}`);
  const gaps = at.slice(1).map((x, i) => x - at[i]);
  assert.ok(Math.max(...gaps) <= 1000, `no gap > 1 s: ${gaps}`);
  assert.ok(at.filter((x) => x > 2000).length >= 4, 'now ticking at 100 ms');
  tk.start(); // change 事件终于到了：重启，仍只有一个计时器
  assert.equal(h.timers.size, 1);
});

test('D1: off → reduce flips and ticks run before the change event: interval keeps going; then aligned; never two timers', () => {
  const clock = { t: 50 };
  const h = fakeHost(clock);
  const at = [];
  let reduced = false;
  const tk = createTicker({ tick: () => at.push(clock.t), reduced: () => reduced, now: () => clock.t });
  tk.start(h);
  run(clock, [h], 300);
  reduced = true;
  const live = [];
  run(clock, [h], 450, (n) => live.push(n));
  assert.ok(live.every((n) => n === 1));
  tk.start();
  at.length = 0;
  run(clock, [h], 2000, (n) => live.push(n));
  assert.ok(live.every((n) => n === 1), `one timer: ${live}`);
  assert.ok(at.every((x) => x % 1000 === 0), `aligned after the change: ${at}`);
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
      if (n === 4) tk.start(b); // 例如小窗打开：计时搬到小窗
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
