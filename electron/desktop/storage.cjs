'use strict';

const fs = require('node:fs');
const path = require('node:path');
const MAX_SNAPSHOT_BYTES = 1024 * 1024;

function normalizeSnapshot(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Snapshot must be an object.');
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== 'string') throw new TypeError('Snapshot values must be strings.');
    out[key] = item;
  }
  return out;
}
function filterSnapshot(value, prefix = 'work-motivator-v1') {
  const snapshot = normalizeSnapshot(value);
  return Object.fromEntries(Object.entries(snapshot).filter(([key]) => key === prefix || key.startsWith(`${prefix}-`)));
}
function createSnapshotWriter() {
  let sequence = 0;
  const queues = new Map();
  const enqueue = (file, fn) => {
    const prior = queues.get(file) ?? Promise.resolve();
    const next = prior.then(fn, fn);
    queues.set(file, next.catch(() => {}));
    return next;
  };
  return {
    writeJson(file, value) { return enqueue(file, () => Promise.resolve().then(() => writeSnapshot(file, value))); },
    readJson(file) { return enqueue(file, () => Promise.resolve().then(() => readSnapshot(file))); },
    async flush() { await Promise.all([...queues.values()]); },
    nextTemp(file) { sequence += 1; return `${file}.${process.pid}.${sequence}.tmp`; }
  };
}
function writeSnapshot(file, value) {
  const snapshot = normalizeSnapshot(value);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
  try { fs.writeFileSync(tmp, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8'); fs.renameSync(tmp, file); }
  catch (error) { try { fs.unlinkSync(tmp); } catch {} throw error; }
  return snapshot;
}
function readSnapshot(file, { maxBytes = MAX_SNAPSHOT_BYTES } = {}) {
  const stat = fs.statSync(file);
  if (!stat.isFile() || stat.size > maxBytes) throw new TypeError('Invalid snapshot file.');
  return normalizeSnapshot(JSON.parse(fs.readFileSync(file, 'utf8')));
}
module.exports = { MAX_SNAPSHOT_BYTES, normalizeSnapshot, filterSnapshot, createSnapshotWriter, writeSnapshot, readSnapshot };
