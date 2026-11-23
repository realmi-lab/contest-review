import test from "node:test";
import assert from "node:assert/strict";
import { assembleSummary, supportedIssue } from "../reading.mjs";
import { directChecks } from "../grounding.mjs";
const evidence = {
  A: { text: "우산 10개를 현관에 비치한다." },
  B: { text: "4주 시험 운영한 뒤 대여 횟수를 집계한다." },
  C: { text: "총무팀이 매주 관리한다." },
  D: { text: "1쪽" },
};
test("요약에서 누락된 자료와 제목을 분리하며 지어낸 수치와 잘못된 시점은 원문으로 복구한다", () => {
  const r = assembleSummary(
    [
      {
        ids: Object.keys(evidence),
        output: {
          points: [
            { topic: "제안 내용", text: "우산 20개를 비치한다.", refs: ["A"] },
            {
              topic: "수치·일정·자원",
              text: "시험 운영 기간 동안 대여 횟수를 집계한다.",
              refs: ["B"],
            },
          ],
          context: [{ ref: "D", reason: "문서 제목·쪽번호" }],
        },
      },
    ],
    evidence,
  );
  assert.equal(r.points[0].text, evidence.A.text);
  assert.equal(r.points[1].text, evidence.B.text);
  assert.deepEqual(r.unassigned, ["C"]);
  assert.equal(r.included, 2);
  assert.equal(r.context.length, 1);
  assert.deepEqual(
    directChecks({ text: evidence.B.text, refs: ["B"] }, evidence),
    [],
  );
});
test("요약에서 집계 시점이나 명시된 기록 항목이 빠지면 원문을 유지한다", () => {
  const refs = ["B", "E"];
  const cited = { ...evidence, E: { text: "대여일과 반납 여부를 기록한다." } };
  const points = [
    {
      topic: "수치·일정·자원",
      text: "4주 동안 운영하며 대여 횟수를 집계한다.",
      refs: ["B"],
    },
    {
      topic: "이용·운영 방식",
      text: "대여 및 반납 여부를 기록한다.",
      refs: ["E"],
    },
  ];
  const result = assembleSummary(
    [{ ids: refs, output: { points, context: [] } }],
    cited,
  );
  assert.deepEqual(
    result.points.map((p) => p.text),
    refs.map((r) => cited[r].text),
  );
});
test("논리 오류 후보에는 실제 두 구절이 있어야 하며 원문과 요약을 구분한다", () => {
  const rows = new Map([
    [
      "p",
      { id: "p", kind: "요약", text: "참여율 40%를 달성했다.", refs: ["a"] },
    ],
    [
      "a",
      { id: "a", kind: "원문", text: "목표 참여율은 40%이다.", refs: ["a"] },
    ],
  ]);
  const f = {
    type: "요약과 원문 불일치",
    reason: "목표를 실적으로 표현했다.",
    claim: { id: "p", quote: "40%를 달성했다" },
    contrast: { id: "a", quote: "목표 참여율은 40%" },
  };
  assert.equal(supportedIssue(f, rows).status, "확인 필요");
  assert.equal(
    supportedIssue({ ...f, contrast: { id: "a", quote: "달성했다" } }, rows),
    null,
  );
  assert.equal(supportedIssue({ ...f, type: "원문 안의 불일치" }, rows), null);
  const equivalent = new Map(
    [...rows].map(([k, r]) => [k, { ...r, text: "우산을 비치한다." }]),
  );
  assert.equal(
    supportedIssue(
      {
        ...f,
        claim: { id: "p", quote: "우산을 비치한다" },
        contrast: { id: "a", quote: "우산을 비치한다" },
      },
      equivalent,
    ),
    null,
  );
});
test("표본과 전체 직원의 비율을 혼동한 지적은 근거 부족으로 표시한다", () => {
  const rows = new Map([
    [
      "A",
      {
        id: "A",
        kind: "원문",
        text: "응답자 10명 중 8명이 찬성했다.",
        refs: ["A"],
      },
    ],
    [
      "B",
      { id: "B", kind: "원문", text: "전체 직원 80%가 찬성했다.", refs: ["B"] },
    ],
  ]);
  const issue = supportedIssue(
    {
      type: "목표·실적 혼동",
      reason: "응답자 비율을 전체 직원에게 일반화했다.",
      claim: { id: "B", quote: rows.get("B").text },
      contrast: { id: "A", quote: rows.get("A").text },
    },
    rows,
  );
  assert.equal(issue.type, "근거 부족·인과 비약");
});
test("인쇄된 표는 같은 행의 날짜·값을 복원하고 원본 셀 위치를 보존한다", async () => {
  const { readingBlocks } = await import("../layout.mjs");
  const cell = (text, x, y) => ({ text, box: { x, y, w: 35, h: 12 } });
  const blocks = readingBlocks([
    cell("3.7", 90, 20),
    cell("1월", 0, 20),
    cell("2월", 0, 40),
    cell("3.9", 90, 40),
  ]);
  assert.deepEqual(blocks, [
    { text: "1월 | 3.7\n2월 | 3.9", indexes: [1, 0, 2, 3] },
  ]);
  const refs = ["A", "B"];
  const ev = { A: { text: "단위: 퍼센트" }, B: blocks[0] };
  assert.deepEqual(
    directChecks({ text: "2월 3.9%", refs }, ev, { preserveDetails: true }),
    [],
  );
  assert(
    directChecks({ text: "2월 7.9%", refs }, ev, { preserveDetails: true })
      .length,
  );
});
test("시계열은 인접한 관측값과 날짜를 연결하고 빈 셀이나 겹친 날짜를 건너뛴다", async () => {
  const { observedSeries } = await import("../layout.mjs");
  const block = {
    id: "t",
    text: "날짜 | 지수\n2024-01-01 | 7.3\n2024-04-01 | 7.3\n2024-06-01 | 6.5",
  };
  const [point] = observedSeries([block]);
  assert.match(point.text, /2024-01-01·2024-04-01 관측값 7.3/);
  assert(!point.text.includes("%"));
  assert.deepEqual(
    observedSeries([
      { ...block, text: block.text.replace("2024-04-01", "2024-01-01") },
    ]),
    [],
  );
});

test("통계표의 첫 화면에 지표 설명과 날짜·값을 먼저 놓고 이용 약관은 상세에 남긴다", async () => {
  const { prioritizeSeries } = await import("../reading.mjs");
  const policy = { text: "원자료의 이용 약관을 확인한다." };
  const unit = { text: "물가지수의 단위는 지수 포인트다." };
  const row = {
    text: "물가지수 기록. 2024-01-01 관측값 101.",
    mode: "표의 날짜·값 대조",
  };
  assert.deepEqual(prioritizeSeries([policy, unit], [policy, unit, row]), [
    unit,
    row,
  ]);
  assert.deepEqual(prioritizeSeries([policy], [policy]), [policy]);
});

test("오류 후보는 묶어서 한 번에 재검토하고, 같은 캡처의 앞뒤 근거를 주어 충돌로 확인된 것만 남긴다", async () => {
  const { issueContext, verifyLogicCandidates } = await import("../reading.mjs");
  const evidence = {
    A: { capture: "1", text: "검토를 요청한다." },
    B: { capture: "1", text: "시 단위로 시범 적용한다." },
    C: { capture: "2", text: "다른 문서다." },
  };
  const claim = { id: "P1", quote: "시 단위" },
    contrast = { id: "A", quote: "검토" },
    issue = { claim, contrast, refs: ["A"] },
    other = { ...issue, claim: { id: "P1", quote: "적용" } };
  const rows = new Map([
    ["P1", { text: "시 단위로 적용을 검토한다." }],
    ["A", evidence.A],
  ]);
  assert.deepEqual(
    issueContext(issue, evidence).map(([id]) => id),
    ["A", "B"],
  );
  let calls = 0;
  const infer = async (_system, prompt, schema) => {
    calls++;
    assert.deepEqual(Object.keys(schema.properties), ["C1", "C2"]); // 두 후보를 한 번에 묻는다
    const sent = JSON.parse(prompt.split("\n").at(-1));
    assert.deepEqual(sent.주변원문, { A: "검토를 요청한다.", B: "시 단위로 시범 적용한다." }); // 겹치는 원문은 한 번만
    assert.deepEqual(sent.후보.C1.문장, ["시 단위로 적용을 검토한다.", "검토를 요청한다."]);
    return {
      C1: { verdict: "원문이 뒷받침함", reason: "다음 문장에 범위가 있다." },
      C2: { verdict: "명시적인 충돌", reason: "기재한 조건이 다르다." },
    };
  };
  const { confirmed, uncertain, dismissed } = await verifyLogicCandidates([issue, other], rows, evidence, infer);
  assert.equal(calls, 1);
  assert.deepEqual(confirmed, [{ ...other, reason: "기재한 조건이 다르다." }]);
  assert.deepEqual(dismissed, [{ ...issue, why: "다음 문장에 범위가 있다." }]);
  assert.deepEqual(uncertain, []);
  // 확정도 기각도 못 한 후보는 재검토 이유와 함께 따로 돌려준다
  const unsure = await verifyLogicCandidates([issue], rows, evidence, async () => ({ C1: { verdict: "근거 불충분", reason: "같은 대상인지 불분명하다." } }));
  assert.deepEqual(unsure.uncertain, [{ ...issue, review: "같은 대상인지 불분명하다." }]);
  assert.deepEqual(await verifyLogicCandidates([], rows, evidence, infer), { confirmed: [], uncertain: [], dismissed: [] }); // 후보가 없으면 묻지 않는다
  assert.equal(calls, 1);
});

test("같은 글자의 셀 좌표가 바뀌어 열이 없어지면 캐시된 요약과 첫 화면을 함께 갱신한다", async () => {
  const { replaceAlignedColumns } = await import("../reading.mjs");
  const old = { text: "과제 15%", refs: ["S1.1"], mode: "표의 열·값 대조" };
  const result = replaceAlignedColumns(
    {
      points: [old],
      lead: [old],
      context: [{ ref: "S1.2", reason: "제목" }],
      unassigned: [],
      included: 1,
    },
    [],
    { "S1.1": {}, "S1.2": {} },
  );
  assert.deepEqual(result.lead, []);
  assert.deepEqual(result.points, []);
  assert.deepEqual(result.unassigned, ["S1.1"]);
  assert.equal(result.included, 0);
});

test("표의 칸 구분자 없이 인용한 구절도 원문 줄과 맞는 것으로 본다", () => {
  const row = { id: "S8.6", kind: "원문", refs: ["S8.6"], text: "train에서 마더코드의 unique개수 | 687\ntrain에는 있으나 test에는 없는 마더코드의 unique개수 | 116" };
  const issue = supportedIssue({
    type: "원문 안의 불일치",
    claim: { id: "S8.6", quote: "train에서 마더코드의 unique개수 687\\ntrain에는 있으나" }, // 줄바꿈을 \\n 글자로 옮겨도 맞다
    contrast: { id: "S8.6", quote: "test에는 없는 마더코드의 unique개수: 116" },
    reason: "train 687개 중 test에 없는 것이 116개면 test와 겹치는 개수가 맞지 않는다.",
  }, new Map([["S8.6", row]]));
  assert.equal(issue?.type, "원문 안의 불일치");
});

test("표를 열 순서로 읽거나 떨어진 칸을 이어 붙인 인용도 그 줄의 인용으로 보되, 다른 줄의 구절은 받지 않는다", () => {
  const table = { id: "S32.10", kind: "원문", refs: ["S32.10"], text: "WRC/27과WOBA사이 | OPs, 장타율, 출루율을 | 위 과정을xgboost와\n다중공선성 존재 우려 | 각각 예측하는 모델 생성 | RF모델로 반복해서 수행" };
  const other = { id: "S8.6", kind: "원문", refs: ["S8.6"], text: "test에서 마더코드의 unique개수 | 201\ntest에는 있으나 train에는 없는 마더코드의 비율 | 0.577" };
  const rows = new Map([[table.id, table], [other.id, other]]);
  const ask = (claim, contrast) => supportedIssue({ type: "원문 안의 불일치", reason: "두 구절이 맞지 않는다.", claim, contrast }, rows);
  assert.ok(ask({ id: "S32.10", quote: "위 과정을xgboost와 RF모델로 반복해서 수행" },
    { id: "S8.6", quote: "test에서 마더코드의 unique개수 | 201 / test에는 있으나 train에는 없는 마더코드의 비율 | 0.577" }));
  assert.equal(ask({ id: "S32.10", quote: "LightGBM 모델로 10회 교차검증을 수행" }, { id: "S8.6", quote: "unique개수 | 201" }), null);
});
