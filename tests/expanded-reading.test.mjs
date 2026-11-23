import assert from "node:assert/strict";
import test from "node:test";
import { expandedReading } from "../public/expanded-reading.mjs";

const source = (text, line, capture = "page-a", kind = "OCR") => ({
  text,
  capture,
  indexes: [line],
  kind,
});
const point = (text, ...refs) => ({
  text,
  refs,
  topic: "실측·관찰 결과",
  mode: "요약",
});

test("확장 요약에 새 세부 조건과 인용을 보존하고 주제나 원본 데이터를 변경하지 않는다", () => {
  const lead = point("사업을 시범 운영할 예정이다.", "A");
  const detail = point("재원 확보 시에만 추가 지점으로 확대한다.", "B");
  const r = {
    lead: [lead],
    points: [lead, detail, { ...detail }, point("끊긴 인용", "X")],
    evidence: { A: source(lead.text, 1), B: source(detail.text, 2) },
  };
  const saved = structuredClone(r);
  const output = expandedReading(r);
  assert.deepEqual(
    output.map((p) => [p.text, p.refs, p.topic]),
    [
      [lead.text, ["A"], "핵심 내용"],
      [detail.text, ["B"], "추가 요점"],
    ],
  );
  assert.deepEqual(saved, r);
});

test("관련된 원문의 이어지는 두 줄을 같이 인용하고 다른 화면의 문장과 결합하지 않는다", () => {
  const a = "여러 부서의 자료를 함께 볼 수 있고,";
  const b = "담당자가 직접 검토한 사례를 부서 안에서 공유할 수 있습니다.";
  const r = {
    lead: [],
    points: [],
    unassigned: ["B"],
    evidence: { A: source(a, 4), B: source(b, 5) },
  };
  assert.deepEqual(
    expandedReading(r).map((v) => [v.text, v.refs]),
    [[a + " " + b, ["A", "B"]]],
  );
  const continuation =
    "하지만 담당자가 직접 겪은 경험은 부서마다 조금씩 다릅니다.";
  const split = {
    ...r,
    evidence: { A: source(a, 4), B: source(continuation, 5, "page-b") },
  };
  assert.deepEqual(expandedReading(split), []);
});

test("확인 경고가 붙은 원문, 제목·참고문헌, 별도 수치 점검 자료는 보충 문단에서 제외한다", () => {
  const raw = "예산을 추가 확보할 경우에는 운영 지점을 넓힐 수 있습니다.";
  const r = {
    lead: [],
    points: [],
    unassigned: ["A", "B", "C"],
    context: [{ ref: "A" }],
    visualChecks: [{ refs: ["B"] }],
    evidence: {
      A: source(raw, 2),
      B: source(raw, 5),
      C: source(raw, 8, "page-c", "OCR 수치 대조 필요"),
    },
  };
  assert.deepEqual(expandedReading(r), []);
});

test("예시를 인용할 때 바로 앞의 소제목을 함께 표시한다", () => {
  const text =
    "이 기간에는 예시로 신청한 부서 중 한 곳에서만 운영할 수 있습니다.";
  const r = {
    points: [],
    lead: [],
    unassigned: ["B"],
    context: [{ ref: "A" }],
    evidence: { A: source("예시", 10), B: source(text, 11) },
  };
  assert.deepEqual(expandedReading(r)[0].refs, ["A", "B"]);
});

test("이미 인용한 기대효과에 구체적인 경로가 있으면 원문의 기대효과 표제와 함께 보인다", () => {
  const lead = point("제안자는 시설 이용에 따른 인식 개선을 기대함.", "B");
  const explanation =
    "주민 스스로 시설을 정비하는 경험을 통해 공동 공간을 돌보는 문화 정착";
  const r = {
    lead: [lead],
    points: [lead],
    unassigned: [],
    context: [{ ref: "A" }],
    evidence: { A: source("기대효과", 6), B: source(explanation, 7) },
  };
  const excerpt = expandedReading(r).at(-1);
  assert.equal(excerpt.text, "기대효과 " + explanation);
  assert.deepEqual(excerpt.refs, ["A", "B"]);
});
