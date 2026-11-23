import test from "node:test";
import assert from "node:assert/strict";
import {
  coverage,
  defaults,
  finalSheet,
  followupSheet,
  scoreRows,
  stalled,
  toCsv,
  rubric,
  sheet,
  total,
  validateReport,
  scopeConflicts,
} from "../review.mjs";

const ref = { text: "근거 있음", refs: ["S1.1"] };
function fixture() {
  return {
    category: "시설·비품·공간",
    summary: ref,
    strengths: [ref],
    weaknesses: [ref],
    usability: ref,
    feasibility: ref,
    questions: ["어디에 배치하는가?"],
    criteria: Object.fromEntries(
      defaults.criteria.map((_, i) => [
        "K" + (i + 1),
        { basis: "scored", level: 7, reason: "기록", refs: ["S1.1"] },
      ]),
    ),
  };
}
test("기본 분야는 회사 전체를 다루고 배점 합은 10점이다", () => {
  const r = rubric(defaults);
  assert.ok(r.categories.includes("조직문화·교류"));
  assert.equal(
    r.criteria.reduce((a, b) => a + b.weight, 0),
    10,
  );
  assert.throws(() =>
    rubric({
      ...defaults,
      criteria: [{ name: "편의", guide: "편익", weight: 8 }],
    }),
  );
});
test("필수 캡처 누락 및 판독 실패를 낮은 점수 대신 보류한다", () => {
  const c = {
    status: "ready",
    label: "발표 1",
    document: "발표",
    page: 1,
    total: 2,
    issue: "",
    lines: [{ text: "문장" }],
  };
  assert.deepEqual(coverage([c]), ["발표 · 누락된 쪽 2"]);
  assert.equal(total(fixture(), defaults, coverage([c])), null);
  assert.deepEqual(coverage([c, { ...c, page: 2 }]), []);
  assert.ok(coverage([{ ...c, status: "failed" }]).length);
});
test("허용된 실제 근거와 점수 범위를 확인한다", () => {
  const r = fixture();
  assert.equal(total(validateReport(r, defaults, ["S1.1"]), defaults), 7);
  r.criteria.K3.level = 8;
  assert.equal(total(r, defaults), 7.3);
  r.criteria.K3.basis = "recapture";
  validateReport(r, defaults, ["S1.1"]);
  assert.equal(total(r, defaults), null);
  r.summary = { text: "미확인", refs: ["S90.0"] };
  assert.throws(() => validateReport(r, defaults, ["S1.1"]));
});
test("비품 제안에 자료 밖의 신원확인 또는 거래 규제를 감점 근거로 강요하지 않는다", () => {
  const r = fixture();
  r.weaknesses = [
    { text: "방문객 신분 확인 절차가 없어 미흡하다.", refs: ["S1.1"] },
  ];
  assert.ok(scopeConflicts(r, "현관에서 우산을 대여한다.").length);
  assert.deepEqual(scopeConflicts(r, "방문객 신분 확인을 한다."), []);
  r.category = "거래·입출금·지갑";
  assert.deepEqual(scopeConflicts(r, "원화 출금"), []);
});

import { amountTokens, checkSum } from "../amounts.mjs";
test("검산은 OCR 원문 수치와 같은 단위를 사용하며 중복 합산을 거부한다", () => {
  const lines = [
    { text: "우산 2.3만원" },
    { text: "거치대 1.1만원" },
    { text: "합계 3.4만원" },
  ];
  const [a, b, c] = amountTokens(lines).map((x) => x.id);
  assert.equal(checkSum(lines, [a, b], c, "만원").computed, "3.4");
  assert.throws(() => checkSum(lines, [a, b], c, "원"));
  assert.throws(() => checkSum(lines, [a, a], c, "만원"));
  assert.equal(checkSum(lines, [a], c, "만원").difference, "-1.1");
});
test("채점표는 항목 점수의 합을 확정 점수로 삼고 선택지 밖의 값은 받지 않는다", () => {
  const filled = { scores: [1.5, 2, 1.8, 1, 0.7], checks: ["규제 검토", "없는 표시"], scale: "과제화", decision: "채택 검토",
    department: " 준법감시팀 ", feedback: "", note: "확인함", by: " 김평가 " };
  assert.deepEqual(finalSheet(filled, defaults), { score: 7, scores: filled.scores, checks: ["규제 검토"], scale: "과제화",
    decision: "채택 검토", department: "준법감시팀", feedback: "", note: "확인함", by: "김평가" });
  assert.deepEqual([sheet.scales.length, sheet.decisions.length], [3, 3]);
  assert.throws(() => finalSheet({ ...filled, scores: [1.6, 2, 1.8, 1, 0.7] }, defaults)); // 배점 1.5를 넘음
  assert.throws(() => finalSheet({ ...filled, scores: [1.55, 2, 1.8, 1, 0.7] }, defaults)); // 0.1점 단위가 아님
  assert.throws(() => finalSheet({ ...filled, scores: [1.5, 2] }, defaults)); // 항목 수가 다름
  assert.throws(() => finalSheet({ ...filled, scale: "" }, defaults));
  assert.throws(() => finalSheet({ ...filled, decision: "탈락" }, defaults));
  assert.throws(() => finalSheet({ ...filled, by: " " }, defaults), /평가자/);
});
test("채점 결과 표는 채점한 작품을 총점 순으로 먼저 두고 항목 점수를 기준 이름으로 맞춘다", () => {
  const rubricOf = (names) => ({ criteria: names.map((name) => ({ name, weight: 5 })) });
  const works = [
    { name: "미채점 작품", receivedOn: "2026-11-20", rubric: rubricOf(["문제 정의", "효과 크기"]) },
    { name: "낮은 점수", rubric: rubricOf(["효과 크기", "문제 정의"]), final: { score: 3, scores: [1, 2], checks: [], scale: "과제화",
      decision: "보류", department: "", feedback: "", note: "", by: "김평가", when: "2026-11-22T01:30:00.000Z" } },
    { name: "높은 점수", rubric: rubricOf(["문제 정의", "효과 크기"]), final: { score: 8, scores: [4, 4], checks: ["규제 검토"],
      scale: "즉시 실행", decision: "채택 검토", department: "", feedback: "", note: "", by: "이평가", when: "2026-11-22T02:00:00.000Z" } },
  ];
  works[0].evaluations = { "a@x.com": { name: "박심사", complete: true, score: 6.5 }, "b@x.com": { name: "최심사", complete: false, score: null } };
  const [head, ...rows] = scoreRows(works, [{ name: "문제 정의" }, { name: "효과 크기" }]);
  assert.deepEqual(head.slice(0, 8), ["작품명", "분야", "인입일", "접수 팀명", "접수자", "문제 정의", "효과 크기", "총점"]);
  assert.deepEqual(rows.map((r) => r[0]), ["높은 점수", "낮은 점수", "미채점 작품"]);
  assert.deepEqual(rows[1].slice(5, 8), [2, 1, 3]); // 순서가 다른 기준도 이름으로 맞춘다
  assert.deepEqual(rows[0].slice(head.indexOf("평가자"), head.indexOf("평가자") + 2), ["이평가", "2026-11-22 11:00"]); // 서울 시간
  assert.equal(rows[2][head.indexOf("1차 결정")], "미채점");
  const at = (label) => head.indexOf(label);
  assert.deepEqual(rows[2].slice(at("심사자 평가 수"), at("심사자별 총점") + 1), [1, 6.5, "박심사 6.5 · 최심사 작성 중"]); // 심사자 평가표에서 모은 점수
});
test("CSV는 엑셀용 BOM을 붙이고 따옴표·쉼표를 감싸며 수식으로 시작하는 글은 실행되지 않게 한다", () => {
  const text = toCsv([["이름", "점수"], ['그 "제안", 하나', 7.5], ["=HYPERLINK(1)", -1]]);
  assert.equal(text, '\uFEFF이름,점수\r\n"그 ""제안"", 하나",7.5\r\n\'=HYPERLINK(1),-1\r\n');
});

test("실행 추적은 단계가 바뀔 때만 이력을 남기고, 예정일이 지났거나 30일 넘게 그대로면 멈춘 것으로 본다", () => {
  const first = followupSheet({ stage: "부서 검토", department: " 총무팀 ", due: "2026-12-01" });
  assert.equal(first.department, "총무팀");
  assert.equal(first.history.length, 1);
  const same = followupSheet({ stage: "부서 검토", due: "2026-12-01", effect: "메모" }, first);
  assert.equal(same.history.length, 1);
  const next = followupSheet({ stage: "실행 중" }, same);
  assert.deepEqual(next.history.map((h) => h.stage), ["부서 검토", "실행 중"]);
  assert.throws(() => followupSheet({ stage: "완료" }), /실행 단계/);
  assert.throws(() => followupSheet({ stage: "실행 중", due: "12/01" }), /예정일/);
  assert.equal(stalled({ ...first, updated: "2026-11-22T00:00:00Z" }, "2026-12-02"), true); // 예정일 지남
  assert.equal(stalled({ ...first, due: "", updated: "2026-10-01T00:00:00Z" }, "2026-11-22"), true); // 30일 넘게 그대로
  assert.equal(stalled({ ...first, due: "", updated: "2026-11-20T00:00:00Z" }, "2026-11-22"), false);
  assert.equal(stalled({ ...first, stage: "효과 확인", due: "2026-01-01" }, "2026-11-22"), false);
});
