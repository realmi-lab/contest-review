import test from "node:test";
import assert from "node:assert/strict";
import { directChecks, auditReport, withholdClaims } from "../grounding.mjs";
import { total } from "../review.mjs";
const cite = (text, refs = ["A"]) => ({ text, refs });
test("평균 절대 오차를 오차율로 바꾼 표 요약을 걸러낸다", () => {
  const source = { A: { text: "AVG MAE | 1.869" } };
  const check = (text) => directChecks(cite(text), source, { preserveDetails: true });
  assert.deepEqual(check("평균 절대 오차는 1.869입니다."), []);
  assert.ok(check("평균 오차율은 1.869입니다.").some((why) => why.includes("오차율")));
  source.A.text = "MAE 2.1, 평균 절대 백분율 오차(MAPE) 1.869";
  assert.deepEqual(check("MAPE는 1.869입니다."), []);
});
const evidence = {
  A: { text: "현관에 우산을 비치한다.", kind: "OCR" },
  B: { text: "대여료는 0원이다.", kind: "OCR" },
};
const spec = {
  categories: ["복지"],
  criteria: [{ name: "가치", weight: 10, guide: "목적 대비 편익" }],
};
function example() {
  return {
    category: "복지",
    summary: cite("현관에 우산을 비치한다."),
    strengths: [cite("현관에서 사용하기 쉽다.")],
    weaknesses: [cite("보관할 자리가 충분한지 확인할 필요가 있다.")],
    usability: cite("비 오는 날 편의를 줄 수 있다."),
    feasibility: cite("현관 공간을 사용한다."),
    questions: ["공간은 충분한가?"],
    criteria: {
      K1: {
        basis: "scored",
        level: 7,
        refs: ["A"],
        reason: "현관에서 무료로 이용한다.",
      },
    },
  };
}
test("무료의 긍정, 미확인 및 유료를 구분하고 실제 인용문만 사용", () => {
  assert.ok(directChecks(cite("무료로 빌린다."), evidence).length);
  assert.deepEqual(directChecks(cite("무료로 빌린다.", ["B"]), evidence), []);
  assert.deepEqual(
    directChecks(cite("무료인지 확인이 필요하다."), evidence),
    [],
  );
  assert.ok(
    directChecks(cite("무료 대여"), { A: { text: "무료로 제공하지 않는다." } })
      .length,
  );
});
test("인용문의 수치와 단위를 비교하고 계획을 실적으로 표현하면 지적", () => {
  const source = { A: { text: "목표는 20% 단축이다. 예산은 1,200만 원이다." } };
  assert.ok(directChecks(cite("20% 단축했다."), source).length);
  assert.ok(directChecks(cite("예산은 1200원이다."), source).length);
  assert.deepEqual(
    directChecks(cite("20% 단축이 목표이고 예산은 1200만원이다."), source),
    [],
  );
});
test("의미 대조 누락은 실패하며 미해결 판단의 점수와 근거 단정을 보류", async () => {
  const r = example();
  await assert.rejects(
    auditReport(r, spec, evidence, async () => ({})),
    /불완전/,
  );
  const audit = await auditReport(r, spec, evidence, async (_i, p) => ({
    defects: JSON.parse(p).some((f) => f.field === "weakness1")
      ? [
          {
            field: "weakness1",
            kind: "disproportionate",
            claimSpan: "보관할 자리",
            sourceSpan: "현관에",
            explanation: "공간에 대한 가정은 확인 질문으로 돌립니다.",
          },
        ]
      : [],
  }));
  assert.equal(audit.checked, 6);
  assert.deepEqual(
    audit.findings.map((x) => x.field),
    ["weakness1", "K1"],
  );
  withholdClaims(r, audit);
  assert.equal(r.criteria.K1.level, null);
  assert.equal(r.criteria.K1.basis, "review");
  assert.match(r.weaknesses[0].text, /심사자 확인 필요/);
  assert.equal(total(r, spec), null);
  assert.equal(r.summary.text, "현관에 우산을 비치한다.");
});

test("요약이 음수, 소수, 임계값의 방향과 경계 포함 여부를 보존한다", () => {
  const check = (source, claim) =>
    directChecks(
      cite(claim),
      { A: { text: source } },
      { preserveDetails: true },
    );
  assert.ok(check("수익률 −2.5%.", "수익률 2.5%.").length);
  assert.ok(
    check(
      "기온 28℃ 이상, 습도 70% 이하에 가동.",
      "기온 28°C 이하, 습도 70% 이상에 가동.",
    ).length,
  );
  assert.ok(check("습도 70% 이하", "습도 70% 미만").length);
  assert.deepEqual(
    check("기온 ≥ 28℃, 습도 ≤ 70%", "기온 28°C 이상, 습도 70% 이하"),
    [],
  );
  assert.ok(
    check(
      "만족도 68.8%가 목표다. 다른 조사 결과는 78.8%를 달성했다.",
      "만족도 68.8%를 달성했다.",
    ).length,
  );
});

test("요약이 교육 대상의 법 조항과 온라인 허용의 하위 조항을 하나로 합치면 지적한다", () => {
  const split =
    "가상법 제12조에 따른 직원 교육은, 가상법 시행규칙 제3조제2항에 따라 온라인으로 실시할 수 있다.";
  const joint =
    "가상법 제12조와 시행규칙 제3조제2항에 따라 직원 온라인 교육이 가능하다.";
  const check = (text, source) =>
    directChecks(
      cite(text),
      { A: { text: source } },
      { preserveDetails: true },
    );
  assert.match(check(joint, split).join(" "), /공동 근거/);
  assert.deepEqual(check(split, split), []);
  assert.deepEqual(check(joint, joint), []);
  assert.deepEqual(
    check("가상법 제12조와 시행규칙 제3조제2항을 함께 소개했다.", split),
    [],
  );
  assert.deepEqual(directChecks(cite(joint), { A: { text: split } }), []);
});

test("같은 술어의 조건부 부정과 확정된 부정을 구분한다", () => {
  const source = "인력이 부족하면 처리가 원활하지 않을 수 있습니다.";
  const check = (text, textSource = source) =>
    directChecks(
      cite(text),
      { A: { text: textSource } },
      { preserveDetails: true },
    );
  assert.match(
    check("처리가 원활하지 않으며 담당자는 도움을 받는다.").join(" "),
    /확정/,
  );
  assert.deepEqual(check(source), []);
  assert.deepEqual(check("처리가 원활하지 않다고 볼 수 있다."), []);
  assert.deepEqual(check("담당자가 배정되지 않는다."), []);
  assert.deepEqual(
    check(
      "휴일에는 처리가 원활하지 않다.",
      source + " 현장 점검 결과 휴일에는 처리가 원활하지 않다.",
    ),
    [],
  );
});
