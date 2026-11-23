import test from "node:test";
import assert from "node:assert/strict";
import { mapLimit } from "../reading.mjs";

test("동시 실행은 지정한 개수를 넘지 않고, 결과는 입력 순서를 지킨다", async () => {
  let running = 0, peak = 0;
  const delays = [40, 5, 30, 10, 20, 1, 15];
  const out = await mapLimit(delays, 3, async (ms, i) => {
    running++; peak = Math.max(peak, running);
    await new Promise((r) => setTimeout(r, ms));
    running--;
    return i;
  });
  assert.deepEqual(out, [0, 1, 2, 3, 4, 5, 6]);
  assert.equal(peak, 3);
  assert.deepEqual(await mapLimit([1, 2], 1, async (x) => x * 2), [2, 4]);
});
