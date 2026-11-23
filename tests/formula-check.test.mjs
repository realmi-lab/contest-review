import assert from "node:assert/strict";
import test from "node:test";
import { checkSubtractionDefinitions } from "../src/check/formula-check.mjs";

const compare = (a, b) =>
  checkSubtractionDefinitions({
    S1: { text: a, kind: "OCR" },
    S2: { text: b, kind: "OCR" },
  });

test("같은 지표의 수식과 반대 순서의 명시적 정의를 원문 구절로 대조한다", () => {
  const [issue] = compare(
    "차액(수입-지출 차이)을 설명한다.",
    "차액이란 지출에서 수입을 뺀 값이다.",
  );
  assert.equal(issue.claim.quote, "차액(수입-지출 차이)");
  assert.equal(issue.contrast.quote, "차액이란 지출에서 수입을 뺀 값");
  assert.deepEqual(issue.refs, ["S1", "S2"]);
  assert.match(issue.reason, /수입 − 지출/);
  assert.equal(compare("순재고(입고−출고)", "순재고(출고−입고)").length, 1);
});

test("명시적 기간·측정 단위·부문·지표 이름이 다르거나 계산이 불분명하면 보류한다", () => {
  for (const [a, b] of [
    ["차액(수입-지출)", "차액이란 수입에서 지출을 뺀 값이다."],
    ["전월 차액(수입-지출)", "당월 차액이란 지출에서 수입을 뺀 값이다."],
    ["2024년 순재고(입고-출고)", "2025년 순재고(출고-입고)"],
    ["영업 이익(수입-지출)", "투자 이익이란 지출에서 수입을 뺀 값이다."],
    ["차액(수입-지출)", "수당이란 지출에서 수입을 뺀 값이다."],
    ["차액(수입-지출)", "차액이란 해외 지출에서 국내 수입을 뺀 값이다."],
    ["차액(수입-지출)", "차액이란 지출 건수에서 수입 금액을 뺀 값이다."],
    ["차액(수입-지출)", "차액이란 지출에서 수입을 뺀 값에 세금을 더한 값이다."],
    ["차액(수입-지출)", "차액이란 지출에서 수입을 뺀 값이 아니다."],
    ["차액(수입-지출)", "차액은 지출과 수입의 차이다."],
    ["운영기간(2024-2025)", "운영기간(2025-2024)"],
    ["노선(서울-부산)", "노선(부산-서울)"],
    ["절감(운영-수혜)", "수혜액은 운영비가 감소할 때 증가한다."],
  ])
    assert.deepEqual(compare(a, b), [], a + " / " + b);
});

test("같은 대상의 한국어 수량 표현을 연결하고 OCR의 단어 내부 공백을 허용한다", () => {
  const [x] = compare(
    "향후 2시간 동안의 자전거 순유입량(대여-반납 차이)을 예측한다.",
    "대상은 향후 2시간 후의 자전거 수다.순유입량이란 해당 시간 동안 대여소에 반납된 자전거 대수에서 대 여되어 나간 자전거 대수를 뺀 값으로, 증감을 표시한다.",
  );
  assert.deepEqual(x.refs, ["S1", "S2"]);
  assert.match(x.contrast.quote, /대 여되어/);
});

test("서로 다른 문서나 미확인 OCR은 같은 지표의 원문 충돌로 표시하지 않는다", () => {
  const a = { text: "차액(수입-지출)", kind: "OCR", label: "문서 가 1쪽" };
  const b = {
    text: "차액이란 지출에서 수입을 뺀 값이다.",
    kind: "OCR",
    label: "문서 나 1쪽",
  };
  assert.deepEqual(checkSubtractionDefinitions({ A: a, B: b }), []);
  assert.deepEqual(
    checkSubtractionDefinitions({
      A: a,
      B: { ...b, label: "문서 가 2쪽", kind: "OCR 수치 대조 필요" },
    }),
    [],
  );
});

test("원문의 상반된 정의를 실제로 인용한 문장에만 표시한다", async () => {
  const { markDisputedDefinition } = await import("../src/check/formula-check.mjs");
  const alerts = compare(
    "차액(수입−지출 차이)을 집계한다.",
    "차액이란 지출에서 수입을 뺀 값이다.",
  );
  const point = {
    text: "월별 차액 (수입 - 지출 차이)을 집계한다.",
    refs: ["S1"],
  };
  const marked = markDisputedDefinition(point, alerts);
  assert.match(marked.sourceNote, /계산 방향/);
  assert.equal(markDisputedDefinition(marked, alerts), marked);
  for (const unrelated of [
    { ...point, refs: ["S9"] },
    { ...point, text: "월별 차액을 집계한다." },
  ])
    assert.equal(markDisputedDefinition(unrelated, alerts), unrelated);
});

test("긴 인용을 줄인 뒤 계산식이 빠지면 해당 문장의 계산 경고도 제거한다", async () => {
  const { markDisputedDefinition } = await import("../src/check/formula-check.mjs");
  const alerts = compare(
    "차액(수입−지출 차이)을 집계한다.",
    "차액이란 지출에서 수입을 뺀 값이다.",
  );
  const p = {
    text: "차액(수입−지출 차이)을 집계한다.",
    refs: ["S1"],
    sourceNote: "제출 자료",
  };
  const shorter = {
    ...markDisputedDefinition(p, alerts),
    text: "응답률을 조사했다.",
  };
  assert.equal(markDisputedDefinition(shorter, alerts).sourceNote, "제출 자료");
});
