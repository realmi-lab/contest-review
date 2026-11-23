import test from "node:test";
import assert from "node:assert/strict";
import { alignedPercentColumns } from "../src/ocr/aligned-tables.mjs";
import { readingBlocks } from "../src/ocr/layout.mjs";

const line = (text, x, y, w = 52) => ({
  text,
  confidence: 0.99,
  box: { x, y, w, h: 18 },
});
const labels = () => [
  line("과제", 14, 0),
  line("시험", 154, 2),
  line("프로젝트", 294, 1),
];

function points(lines) {
  const groups = readingBlocks(lines);
  const evidence = Object.fromEntries(
    groups.map((g, i) => [
      "S1." + (i + 1),
      {
        capture: "slide",
        indexes: g.indexes,
        text: g.text,
        kind: g.indexes.some((k) => lines[k].numericDispute)
          ? "OCR 수치 대조 필요"
          : "OCR",
      },
    ]),
  );
  return alignedPercentColumns([{ id: "slide", lines }], evidence);
}

test("빈 셀이 있는 발표자료에서 소제목과 비율을 원래 열에 연결한다", () => {
  const result = points([
    ...labels(),
    line("1 - 10%", 288, 40),
    line("•1- 15%", 150, 38),
    line("·15%", 10, 39),
    line("2-10%", 286, 79),
    line("2-15%", 148, 63),
    line("Final - 15%", 288, 108),
    line("Final - 20%", 148, 94),
  ]);
  assert.deepEqual(
    result.map((p) => p.text),
    [
      "과제 항목은 15%입니다.",
      "시험 항목은 1번 15%, 2번 15%, Final 20%입니다.",
      "프로젝트 항목은 1번 10%, 2번 10%, Final 15%입니다.",
    ],
  );
  assert(result.every((p) => p.refs.includes("S1.1")));
  assert(result[1].refs.length >= 2);
});

test("음수와 %p를 보존하고 표 너머의 값이나 보이지 않은 날짜를 추가하지 않는다", () => {
  const result = points([
    ...labels(),
    line("−2.5%p", 12, 39),
    line("성장 -15%", 150, 40),
    line("+10%", 288, 42),
    line("일정", 10, 68),
    line("7", 140, 68),
    line("3%", 150, 95),
  ]);
  assert.deepEqual(
    result.map((p) => p.text),
    [
      "과제 항목은 −2.5%p입니다.",
      "시험 항목은 성장 -15%입니다.",
      "프로젝트 항목은 +10%입니다.",
    ],
  );
  assert.deepEqual(
    points([
      ...labels(),
      line("1", 12, 39),
      line("복습·시험", 150, 39),
      line("읽기", 288, 39),
    ]),
    [],
  );
});

test("범위·불확실한 OCR·열 경계에 걸친 셀은 소속을 단정하지 않는다", () => {
  const range = line("10–15%", 12, 39);
  const uncertain = { ...line("2%", 150, 40), numericDispute: true };
  const separated = points([
    ...labels(),
    range,
    uncertain,
    line("5%", 288, 53),
  ]);
  assert.deepEqual(
    separated.map((p) => p.text),
    ["프로젝트 항목은 5%입니다."],
  );
  assert.deepEqual(
    points([
      ...labels(),
      line("2%", 12, 39),
      line("8%", 100, 40, 75),
      line("5%", 288, 41),
    ]),
    [],
  );
});
