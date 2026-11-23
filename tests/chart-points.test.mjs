import test from "node:test";
import assert from "node:assert/strict";
import { replaceChartPoints } from "../src/summary/reading.mjs";

test("도식 검토로 바뀐 쪽의 요점만 바꿔 끼운다", () => {
  const evidence = { "S1.1": {}, "S1.2": {}, "S2.V": {} };
  const prior = {
    points: [
      { topic: "방법", text: "본문 요점", refs: ["S1.1"] },
      { topic: "한계", text: "옛 판독 한계", refs: ["S1.2", "S2.V"] },
    ],
    lead: [{ topic: "방법", text: "본문 요점", refs: ["S1.1"] }],
    context: [{ ref: "S9.9", reason: "없어진 근거" }],
    unassigned: [],
    visualChecks: [],
  };
  const extra = { points: [{ topic: "결과", text: "약 13.8", refs: ["S2.V"] }], context: [] };
  const merged = replaceChartPoints(prior, extra, new Set(["S2.V"]), evidence);
  assert.deepEqual(merged.points.map((p) => p.text), ["본문 요점", "약 13.8"]);
  assert.equal(merged.lead.length, 1);
  assert.deepEqual(merged.unassigned, ["S1.2"]); // 지운 요점이 쓰던 본문 근거는 미배정으로 남긴다
  assert.deepEqual(merged.context, []);
  assert.equal(merged.included, 2);
});
