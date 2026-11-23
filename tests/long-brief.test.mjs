import assert from "node:assert/strict";
import test from "node:test";
import { excerptSentences } from "../long-brief.mjs";

test("긴 발췌에서 소수와 단위를 보존한 실제 원문 문장만 선택할 수 있다", () => {
  const source =
    "첫 번째 조사에서 원문에 기록한 수치는 68.8%였다.두 번째 조사에서는 후속 검증을 진행할 예정이다.";
  const sentences = excerptSentences(source);
  assert.equal(sentences.length, 2);
  assert.match(sentences[0], /68\.8%였다\.$/);
  assert.match(sentences[1], /예정이다\.$/);
  assert(sentences.every((sentence) => source.includes(sentence)));
});

test("앞자리 0이 생략된 소수의 크기를 발췌 과정에서 바꾸지 않는다", () => {
  const input =
    "이 조건에서 측정된 누락 비율은 .85% of total submissions across all departments.";
  assert.deepEqual(excerptSentences(input), [input]);
});

test("같은 설문에서 바로 앞에 명시된 표본을 백분율과 함께 보존한다", async () => {
  const { attachSurveyContext } = await import("../long-brief.mjs");
  const s = { text: "방문자 16명을 대상으로 설문을 진행했다.", refs: ["A"] };
  const result = { text: "전체 응답자의 68.8%가 만족했다.", refs: ["B"] };
  const evidence = {
    A: { capture: "x", text: s.text },
    B: { capture: "x", text: "설문 결과는 68.8%였다." },
  };
  const [p] = attachSurveyContext([result], [s, result], evidence);
  assert.equal(p.text, s.text + " " + result.text);
  assert.deepEqual(p.refs, ["A", "B"]);
  assert.deepEqual(
    attachSurveyContext([result], [s, result], {
      ...evidence,
      B: { ...evidence.B, capture: "y" },
    }),
    [result],
  );
});

test("정성 평가 직전 원문에 단일 설문의 표본과 실제 결과가 있으면 수치로 표현한다", async () => {
  const { attachSurveyContext } = await import("../long-brief.mjs");
  const sample = { text: "방문자 16명을 대상으로 설문했다.", refs: ["A"] };
  const result = {
    text: "설문에서 전체 응답자의 68.8%가 만족했다.",
    refs: ["B"],
  };
  const qualitative = { text: "참여자에게 긍정적으로 평가됐다.", refs: ["C"] };
  const evidence = Object.fromEntries(
    [sample, result, qualitative].map((p) => [
      p.refs[0],
      { text: p.text, capture: "x" },
    ]),
  );
  const [lead] = attachSurveyContext(
    [qualitative],
    [sample, result, qualitative],
    evidence,
  );
  assert.deepEqual(lead.refs, ["A", "B"]);
  assert(lead.text.includes("16명") && lead.text.includes("68.8%"));
});

test("같은 원문 근거의 같은 후속 활동에 구체적인 시행 주기가 있으면 선택한다", async () => {
  const { preferScheduledPlan } = await import("../long-brief.mjs");
  const item = (text, ref, id) => ({ id, point: { text, refs: [ref] } });
  const plan = item(
    "향후 설비 점검 및 시설 관리 대장을 정비할 계획입니다.",
    "S1",
    1,
  );
  const cycle = item("설비 점검은 3개월 주기로 시행할 예정입니다.", "S1", 2);
  const other = item("교육은 2개월 주기로 실시할 예정입니다.", "S2", 3);
  const done = item("설비 점검은 2개월 주기로 시행했습니다.", "S1", 4);
  assert.equal(preferScheduledPlan(plan, [plan, cycle, other, done]), cycle);
  assert.equal(preferScheduledPlan(plan, [plan, done, other]), plan);
  assert.equal(
    preferScheduledPlan(plan, [
      plan,
      cycle,
      item("설비 점검을 2주마다 실시할 계획입니다.", "S1", 5),
    ]),
    plan,
  );
});

test("다른 근거의 두 방법과 각각의 목적을 온전한 원문 문장으로 짝짓는다", async () => {
  const { pairedMethods } = await import("../long-brief.mjs");
  const a =
    "이 사업에서 채택한 주요 방식은 표본 추출입니다.측정 대상은 입고 물량입니다.";
  const b =
    "검사 방법으로는 전수 검사를 사용했습니다.검사 목표는 품질 기준 확인입니다.";
  const raw = (text) => ({ text, kind: "OCR" });
  const point = { text: a + b, refs: ["A", "B"], mode: "원문 발췌" };
  const good = pairedMethods(point, { A: raw(a), B: raw(b) });
  assert.deepEqual(good.refs, ["A", "B"]);
  assert.ok(good.text.includes("품질 기준") && good.text.includes("입고 물량"));
  assert.equal(
    pairedMethods(point, {
      A: raw(a),
      B: raw(b.replace("사용했습니다.", "사용했습니다.예시입니다.")),
    }),
    null,
  );
});
