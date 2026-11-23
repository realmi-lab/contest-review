import { test } from "node:test";
import assert from "node:assert/strict";
import { diagramHint } from "../public/lib/diagram-hint.mjs";

const at = (text, x, y, w = 40, h = 14) => ({ text, box: { x, y, w, h } });
const years = [2019, 2020, 2021, 2022, 2023].map((t, i) => at(String(t), 100 + i * 80, 400));

test("연도 가로축만 있고 칸마다 값 라벨이 없으면 도식 검토를 추천한다", () => {
  assert.ok(diagramHint([...years, at("월별 매출 추이", 100, 50, 200)]));
});

test("칸마다 값 라벨이 붙은 막대그래프는 글자로 읽히므로 추천하지 않는다", () => {
  const labels = [120, 180, 150, 210, 240].map((v, i) => at(String(v), 100 + i * 80, 300 - i * 20));
  assert.equal(diagramHint([...years, ...labels]), "");
});

test("세로로 쌓인 고른 숫자 눈금(0~80)이 있으면 추천한다", () => {
  assert.ok(diagramHint([0, 20, 40, 60, 80].map((v, i) => at(String(v), 60, 400 - i * 60))));
});

test("표의 행 번호, 목차 번호, 같은 연도만 되풀이되는 줄은 축으로 보지 않는다", () => {
  const rows = [1, 2, 3, 4, 5].map((v, i) => at(String(v), 60, 100 + i * 40)).concat([1, 2, 3, 4, 5].map((v, i) => at("항목 " + v, 120, 100 + i * 40, 120)));
  assert.equal(diagramHint(rows), "");
  assert.equal(diagramHint(["01", "02", "03", "04"].map((t, i) => at(t, 100 + i * 200, 300))), "");
  assert.equal(diagramHint(["2000", "2000", "2000"].map((t, i) => at(t, 100 + i * 200, 300))), "");
});
