import assert from "node:assert/strict";
import { test } from "node:test";
import { withPercent } from "../src/summary/run.mjs";

test("요약 진행률은 단계 순서대로 0~99%로 늘고 뒤로 가지 않는다", () => {
  const seen = [];
  const progress = withPercent((text, percent) => seen.push(percent));
  for (const text of ["Haiku · 요약 준비", "요점 추출 · 1 / 4", "요점 추출 · 3 / 4", "핵심·세부 요약 작성 · …", "요점 추출 · 1 / 4",
    "원문과 논리 점검 · 2 / 2", "AI가 본 이 아이디어 쓰기"]) progress(text);
  assert.deepEqual(seen, [0, 8, 22, 48, 48, 81, 95]);
});

test("점검만 할 때는 점검 구간을 0~100%로 늘린다", () => {
  const seen = [];
  const progress = withPercent((text, percent) => seen.push(percent), 74);
  for (const text of ["원문과 논리 점검 · 1 / 2", "앞뒤 원문과 오류 후보 재대조 · 1 / 1", "AI가 본 이 아이디어 쓰기"]) progress(text);
  assert.deepEqual(seen, [0, 54, 81]);
});

test("AI 논리점검을 끄면 요약 구간을 0~100%로 늘린다", () => {
  const seen = [];
  const progress = withPercent((text, percent) => seen.push(percent), 0, 74);
  for (const text of ["요점 추출 · 1 / 4", "핵심·세부 요약 작성 · …", "없다고 쓴 내용 다시 대조"]) progress(text);
  assert.deepEqual(seen, [11, 65, 95]);
});
