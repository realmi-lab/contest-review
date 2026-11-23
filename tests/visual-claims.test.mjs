import test from "node:test";
import assert from "node:assert/strict";
import { visualClaimProblem } from "../src/summary/visual-claims.mjs";

function check(text, sources, mode = "요약") {
  const evidence = Object.fromEntries(
    sources.map((s, i) => ["S1." + (i + 1), { capture: "pg", text: s }]),
  );
  return visualClaimProblem(
    { text, refs: Object.keys(evidence), mode },
    evidence,
  );
}

test("축·막대·단위의 대응이 없는 숫자와 한 글자 범례를 문장으로 확정하지 않는다", () => {
  assert.ok(
    check("2021년 96만 7천명에서 2024년 1,637만명으로 늘었다.", [
      "방문객 수",
      "967",
      "16,370",
      "2021 | 2022 | 2023 | 2024",
    ]),
  );
  assert.ok(check("2024년 775만명이 조사됐다.", ["7,742", "4,321 | 3,198"]));
  assert.ok(check("안건을 승인할 조직의 코드일 가능성이 큽니다.", ["N"]));
  assert.ok(
    check("문서 S1.1의 문구는 제안을 수용한다는 의사를 나타내는 표현이다.", [
      "은을 수니다",
    ]),
  );
  assert.ok(check("실험 성공률은 75%다.", ["75%"]));
});

test("제목과 행 값이 대응한 표, 날짜·값 묶음, 본문이 설명한 설문 결과는 유지한다", () => {
  assert.equal(
    check("응답자 16명 중 68.8%가 5점을 선택했다.", [
      "참여한 응답자는 16명이며 68.8%가 5점을 선택했다.",
      "68.8%",
    ]),
    null,
  );
  assert.equal(
    check("2024년 6월 실업률 4.1%.", [
      "관측일 | 실업률(%)",
      "2024-06-01 | 4.1",
    ]),
    null,
  );
  assert.equal(
    check(
      "1월 3.7%이며 6월에는 4.1%다.",
      ["2024-01-01 | 3.7", "2024-06-01 | 4.1"],
      "표의 날짜·값 대조",
    ),
    null,
  );
  assert.equal(
    check("강의와 실습을 병행한다.", ["강의와 실습을 병행한다."]),
    null,
  );
});

test("별도 분모를 발명한 수식은 보류하고 실제 사칙연산 표기와 줄바꿈을 보존한다", () => {
  const source = ["봄/여름 가중치", "cost | = L | + λ × (1 − S)p"];
  assert.ok(
    check("비용은 cost = L + λ × (1 − S)p / norm 으로 정한다.", source),
  );
  assert.equal(check("비용식은 cost = L + λ × (1 − S)p 이다.", source), null);
  assert.equal(check("비율은 r = a / b 이다.", ["r = a ÷ b"]), null);
  assert.equal(check("비율은 r = a / b 이다.", ["r = a", "/ b"]), null);
  assert.equal(
    check("비율은 r = a / b 이다.", ["a를 b로 나눈 값을 쓴다."]),
    null,
  );
});
