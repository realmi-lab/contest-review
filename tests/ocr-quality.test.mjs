import test from "node:test";
import assert from "node:assert/strict";
import { needsDetail, reconcilePages, nativeTables } from "../src/ocr/ocr-quality.mjs";
import { preferNativeGroups } from "../src/ocr/layout.mjs";
const cell = (text, x, y, h = 12) => ({
  text,
  confidence: 0.98,
  box: { x, y, w: 32, h },
});
const page = (lines) => ({ lines, width: 400, height: 400, deskewAngle: 0 });
test("작은 글씨는 두 번 읽고 수치 충돌과 새 숫자를 확인 대상으로 유지한다", () => {
  const base = page([cell("2.5%", 20, 30), cell("매출", 10, 10)]);
  assert(needsDetail(base));
  const out = reconcilePages(
    base,
    page([cell("7.5%", 20, 30), cell("비용", 150, 30), cell("42%", 240, 30)]),
  );
  assert.equal(out.added, 1);
  assert.equal(out.uncertain.length, 2);
  assert(out.lines.some((l) => l.text === "2.5%" && l.numericDispute));
  assert(!out.lines.some((l) => l.text === "42%"));
});
test("Kordoc이 복원한 표는 실제 화면의 셀에 대응할 때 사용한다", () => {
  const cells = [
    cell("A", 0, 0),
    cell("10", 90, 0),
    cell("B", 0, 25),
    cell("20", 90, 25),
  ];
  const tbl = {
    type: "table",
    table: {
      cells: [
        ["A", "10"],
        ["B", "20"],
      ].map((row) => row.map((text) => ({ text }))),
    },
  };
  const result = nativeTables([tbl], cells);
  assert.equal(result.length, 1);
  const groups = cells.map((c, i) => ({ text: c.text, indexes: [i] }));
  assert.deepEqual(preferNativeGroups(groups, result), [
    { text: "A | 10\nB | 20", indexes: [0, 1, 2, 3] },
  ]);
  assert.deepEqual(nativeTables([tbl], [cells[0], cells[3]]), []);
});

test("숫자가 같아도 부호·비교 방향·단위가 달라지면 두 판독을 구분한다", () => {
  for (const [first, second] of [
    ["−2.5%", "2.5%"],
    ["≤ 28℃", "≥ 28℃"],
    ["2.0%p", "2.0%"],
    ["10만 원", "10원"],
  ]) {
    const result = reconcilePages(
      page([cell(first, 0, 0)]),
      page([cell(second, 0, 0)]),
    );
    assert.equal(result.uncertain[0]?.original, first);
    assert.equal(result.uncertain[0]?.text, second);
  }
  const same = reconcilePages(
    page([cell("−2.5％", 0, 0)]),
    page([cell("-2.5 %", 0, 0)]),
  );
  assert.equal(same.uncertain.length, 0);
});
