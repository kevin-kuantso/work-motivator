// 匯入檔案的讀檔順序：只把「最後一次選擇」的結果交給流程。
// 讀一個年度 CSV 要幾毫秒到幾百毫秒；這段期間又選了別的文件、或切到別的地區再選，
// 先開始的那次讀完不能蓋掉後來的選擇（成功、失敗、換區都一樣）。
// createImportReader 不碰 DOM，所以這裡用延遲 promise 決定誰先讀完，完全不依賴時鐘。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createImportReader } from '../src/ui/holiday-panel.js';

const HEADER = '西元日期,星期,是否放假,備註';
const TW_MAX_BYTES = 256 * 1024;

// 假的 File：arrayBuffer()／text() 都回傳一個可以由測試決定何時完成的 promise。
function fakeFile({ size = 32, body = `${HEADER}\r\n`, fail = false } = {}) {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const bytes = new TextEncoder().encode(body);
  return {
    size,
    release,
    arrayBuffer: async () => {
      await gate;
      if (fail) throw new Error('讀不到');
      return bytes.buffer;
    },
    text: async () => {
      await gate;
      if (fail) throw new Error('讀不到');
      return body;
    },
  };
}

// 單頁的狀態：region／generation 由測試明著改；token 在 select() 內同步取。
function harness({ region = 'TW', maxBytes = TW_MAX_BYTES } = {}) {
  const state = { region, generation: 1 };
  const delivered = [];
  const reader = createImportReader({
    getToken: () => ({ region: state.region, generation: state.generation, external: state.generation }),
    isStale: (token) => token.region !== state.region || token.generation !== state.generation,
    onImport: (text, readError) => delivered.push({ text, readError }),
    maxBytes,
  });
  return { reader, state, delivered };
}

test('期間又選了別的文件：只有最後一次選擇的結果會交給流程（先開始的先讀完也一樣）', async () => {
  const { reader, delivered } = harness();
  const slow = fakeFile({ body: `${HEADER}\r\n20260101,四,2,開國紀念日\r\n` });
  const fast = fakeFile({ body: `${HEADER}\r\n20260102,五,2,元旦補假\r\n` });

  const first = reader.select(slow);
  const second = reader.select(fast);
  fast.release();
  assert.deepEqual(await second, { delivered: true });
  assert.equal(delivered.length, 1, '後選的那份先讀完就先交出');
  slow.release();
  assert.deepEqual(await first, { delivered: false, superseded: true }, '先開始、後讀完的那份作廢');
  assert.equal(delivered.length, 1, '不會交出兩份');
  assert.match(delivered[0].text, /20260102/, '留下的是後選的那份');
});

test('先開始的讀檔失敗：不能拿它的失敗蓋掉後選的成功匯入', async () => {
  const { reader, delivered } = harness();
  const bad = fakeFile({ fail: true });
  const good = fakeFile({ body: `${HEADER}\r\n20260101,四,2,開國紀念日\r\n` });

  const first = reader.select(bad);
  const second = reader.select(good);
  good.release();
  bad.release();
  assert.deepEqual(await Promise.all([first, second]), [
    { delivered: false, superseded: true },
    { delivered: true },
  ]);
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0].readError, undefined);
  assert.match(delivered[0].text, /開國紀念日/);
});

test('讀檔期間切換地區：整份丟棄，不呼叫流程、不提示', async () => {
  const { reader, state, delivered } = harness({ region: 'TW' });
  const file = fakeFile();
  const pending = reader.select(file);
  file.release();
  state.region = 'CN';
  state.generation += 1;
  assert.deepEqual(await pending, { delivered: false, stale: true });
  assert.deepEqual(delivered, []);
});

test('臺灣：超過大小上限不讀檔、回報 tooLarge；不是 UTF-8 回報 null', async () => {
  const { reader, delivered } = harness();
  // 超過上限：連 arrayBuffer 都不該被呼叫
  let readCalls = 0;
  const huge = { size: TW_MAX_BYTES + 1, arrayBuffer: async () => { readCalls += 1; return new ArrayBuffer(0); } };
  assert.deepEqual(await reader.select(huge), { delivered: true });
  assert.deepEqual(delivered.at(-1), { text: null, readError: 'tooLarge' });
  assert.equal(readCalls, 0, '超過上限就不讀進記憶體');

  // 二進位內容：嚴格 UTF-8 解碼失敗，交出 null（流程會說「讀不到／不是 UTF-8 文字」）
  const binary = { size: 8, arrayBuffer: async () => Uint8Array.from([0xff, 0xfe, 0x00, 0x01]).buffer };
  assert.deepEqual(await reader.select(binary), { delivered: true });
  assert.deepEqual(delivered.at(-1), { text: null, readError: undefined });
});

test('大陸：沿用舊契約（file.text()，讀檔失敗交空字串、不受臺灣大小上限影響）', async () => {
  const { reader, delivered } = harness({ region: 'CN' });
  const big = fakeFile({ size: TW_MAX_BYTES * 4, body: '{"year":2026}' });
  big.release();
  assert.deepEqual(await reader.select(big), { delivered: true });
  assert.deepEqual(delivered.at(-1), { text: '{"year":2026}', readError: undefined });

  const broken = fakeFile({ fail: true });
  broken.release();
  assert.deepEqual(await reader.select(broken), { delivered: true });
  assert.deepEqual(delivered.at(-1), { text: '', readError: undefined });
});

test('沒有選到檔案：不取令牌、不動序號', async () => {
  const { reader, delivered } = harness();
  assert.deepEqual(await reader.select(undefined), { delivered: false, empty: true });
  assert.equal(reader.seq(), 0);
  assert.deepEqual(delivered, []);
});
