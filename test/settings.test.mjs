import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, loadState, saveState, exportState, importState } from '../src/settings.js';

const fakeStorage = (init = {}) => {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => void m.set(k, String(v)), _m: m };
};
const cur = () => ({ cfg: { ...DEFAULTS }, marks: {} });

test('DEFAULTS pinned', () => {
  assert.deepEqual(DEFAULTS, {
    salary: 6800, start: '08:30', end: '17:00', lunchOn: true, lunchStart: '11:30',
    lunchEnd: '13:00', weekends: false, payday: null, cheer: '',
  });
});

test('save -> load round trip', () => {
  const st = fakeStorage();
  const state = { cfg: { ...DEFAULTS, salary: 9000, cheer: '加油', payday: 10 }, marks: { '2026-05-04': 'rest' } };
  assert.deepEqual(saveState(st, state), { ok: true });
  assert.ok(st._m.has('work-motivator-v1'));
  assert.deepEqual(loadState(st), { state, storageOk: true });
});

test('load: empty / garbage storage -> defaults, storageOk true', () => {
  assert.deepEqual(loadState(fakeStorage()), { state: cur(), storageOk: true });
  assert.deepEqual(loadState(fakeStorage({ 'work-motivator-v1': 'not json' })), { state: cur(), storageOk: true });
});

test('load: invalid fields in storage dropped via same rules', () => {
  const raw = JSON.stringify({ version: 1, salary: 'abc', start: '25:99', cheer: 'hi', marks: { '2026-02-30': 'work', '2026-05-04': 'rest' } });
  const { state, storageOk } = loadState(fakeStorage({ 'work-motivator-v1': raw }));
  assert.equal(storageOk, true);
  assert.equal(state.cfg.salary, 6800);
  assert.equal(state.cfg.start, '08:30');
  assert.equal(state.cfg.cheer, 'hi');
  assert.deepEqual(state.marks, { '2026-05-04': 'rest' });
});

test('getItem throws -> storageOk false + DEFAULTS', () => {
  const st = { getItem() { throw new Error('denied'); }, setItem() {} };
  assert.deepEqual(loadState(st), { state: cur(), storageOk: false });
});

test('setItem throws -> {ok:false}', () => {
  const st = { getItem: () => null, setItem() { throw new Error('quota'); } };
  assert.deepEqual(saveState(st, cur()), { ok: false });
});

test('exportState contains version 1, cfg fields, marks', () => {
  const o = JSON.parse(exportState({ cfg: { ...DEFAULTS }, marks: { '2026-05-04': 'work' } }));
  assert.equal(o.version, 1);
  assert.equal(o.salary, 6800);
  assert.deepEqual(o.marks, { '2026-05-04': 'work' });
});

test('export -> import round trip', () => {
  const state = { cfg: { ...DEFAULTS, salary: 12345.5, weekends: true, payday: 31 }, marks: { '2026-05-04': 'paidLeave' } };
  const r = importState(exportState(state), cur());
  assert.deepEqual(r, { state, dropped: [], unknown: [] });
});

test('import: non-JSON / array / null / scalar -> error', () => {
  for (const t of ['not json', '[]', 'null', '3', '"x"', 'true']) {
    const r = importState(t, cur());
    assert.equal(typeof r.error, 'string', t);
    assert.equal(r.state, undefined);
  }
});

test('import: salary "abc" dropped, old value kept', () => {
  const c = { cfg: { ...DEFAULTS, salary: 7000 }, marks: {} };
  const r = importState('{"salary":"abc"}', c);
  assert.equal(r.state.cfg.salary, 7000);
  assert.equal(r.dropped.length, 1);
  assert.equal(r.dropped[0].field, 'salary');
  assert.equal(typeof r.dropped[0].reason, 'string');
});

test('import: unknown field reported, not applied', () => {
  const r = importState('{"foo":1,"salary":7000}', cur());
  assert.deepEqual(r.unknown, ['foo']);
  assert.equal(r.state.cfg.foo, undefined);
  assert.equal(r.state.cfg.salary, 7000);
});

test('import: start "25:99" dropped', () => {
  const r = importState('{"start":"25:99"}', cur());
  assert.equal(r.state.cfg.start, '08:30');
  assert.equal(r.dropped[0].field, 'start');
});

test('import: field rules are strict (no coercion)', () => {
  const bad = { salary: '7000', lunchOn: 'true', weekends: 1, payday: 0, start: '8:30', end: 1700, cheer: 5 };
  const r = importState(JSON.stringify(bad), cur());
  assert.deepEqual(r.state, cur());
  assert.deepEqual(r.dropped.map((d) => d.field).sort(), Object.keys(bad).sort());
  assert.equal(importState('{"payday":32}', cur()).dropped[0].field, 'payday');
  assert.equal(importState('{"payday":1.5}', cur()).dropped[0].field, 'payday');
  assert.equal(importState('{"salary":0}', cur()).dropped[0].field, 'salary');
  assert.equal(importState('{"salary":-1}', cur()).dropped[0].field, 'salary');
  assert.equal(importState('{"payday":null}', { cfg: { ...DEFAULTS, payday: 5 }, marks: {} }).state.cfg.payday, null);
  assert.equal(importState('{"payday":31}', cur()).state.cfg.payday, 31);
});

test('import: one bad marks key drops only that entry', () => {
  const t = JSON.stringify({ marks: { '2026-05-04': 'rest', '2026-02-30': 'work', 'x': 'work', '2026-05-05': 'bogus', '2026-05-06': 'unpaidLeave' } });
  const r = importState(t, cur());
  assert.deepEqual(r.state.marks, { '2026-05-04': 'rest', '2026-05-06': 'unpaidLeave' });
  assert.deepEqual(r.dropped.map((d) => d.field).sort(), ['marks.2026-02-30', 'marks.2026-05-05', 'marks.x']);
});

test('import: marks not an object -> field dropped, marks kept', () => {
  const c = { cfg: { ...DEFAULTS }, marks: { '2026-05-04': 'rest' } };
  const r = importState('{"marks":[1]}', c);
  assert.deepEqual(r.state.marks, c.marks);
  assert.equal(r.dropped[0].field, 'marks');
});

test('import: cheer > 40 chars dropped, exactly 40 kept, HTML kept verbatim', () => {
  const r = importState(JSON.stringify({ cheer: 'x'.repeat(41) }), cur());
  assert.equal(r.state.cfg.cheer, '');
  assert.equal(r.dropped[0].field, 'cheer');
  assert.equal(importState(JSON.stringify({ cheer: 'x'.repeat(40) }), cur()).state.cfg.cheer.length, 40);
  assert.equal(importState('{"cheer":"<script>x</script>"}', cur()).state.cfg.cheer, '<script>x</script>');
});

test('import (R7): jointly invalid times dropped together, reported with reason', () => {
  const r = importState('{"start":"18:00","end":"19:00"}', cur()); // lunch 11:30-13:00 now outside
  assert.equal(r.state.cfg.start, '08:30');
  assert.equal(r.state.cfg.end, '17:00');
  assert.deepEqual(r.dropped.map((d) => d.field).sort(), ['end', 'start']);
  assert.ok(r.dropped.every((d) => typeof d.reason === 'string' && d.reason.length > 0));
  const r2 = importState('{"start":"17:00","end":"09:00"}', cur());
  assert.deepEqual(r2.state.cfg, DEFAULTS);
  assert.equal(r2.dropped.length, 2);
});

test('import does not mutate current', () => {
  const c = cur();
  importState('{"salary":1,"marks":{"2026-05-04":"rest"}}', c);
  assert.deepEqual(c, cur());
});
