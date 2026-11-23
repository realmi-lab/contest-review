import test from "node:test";
import assert from "node:assert/strict";
import { classificationBatches } from "../reading.mjs";
import { withHaiku } from "../claude-summary.mjs";

test("역할 분류: 로컬 모델은 12개씩, Haiku는 글자 수 기준으로 묶는다", async () => {
  const points = Array.from({ length: 30 }, (_, i) => ({ text: "진술 " + (i + 1) }));
  const local = classificationBatches(points);
  assert.deepEqual(local.map((b) => b.length), [12, 12, 6]);
  assert.deepEqual(local.flat().map((x) => x.id), points.map((_, i) => i + 1));
  const cloud = await withHaiku("test-key", async () => classificationBatches(points));
  assert.deepEqual(cloud.map((b) => b.length), [30]);
});
