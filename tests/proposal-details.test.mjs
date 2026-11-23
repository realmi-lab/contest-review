import test from "node:test";
import assert from "node:assert/strict";
import { preserveProposalDetails as preserve } from "../src/summary/proposal-details.mjs";

const row = (text, capture = "page", kind = "OCR") => ({ capture, text, kind });
const point = (text, refs = ["S1.2"]) => ({ text, refs, topic: "제안 내용", mode: "요약" });
const base = { "S1.1": row("직원 편의 개선 제안") };

test("인용한 목록에서 양옆이 일치하는 빠진 명사구만 원래 자리에 복원한다", () => {
  const p = point("업무 범위는 신청 접수 및 결과 통지로 정한다.");
  const data = { ...base, "S1.2": row("1.업무 범위는 신청 접수, 증빙 서류 대조, 결과 통지로 정한다. 2.회신 담당자는 별도 지정한다.") };
  const points = [p], result = preserve(points, data);
  assert.deepEqual(result, [{ ...p, text: "업무 범위는 신청 접수, 증빙 서류 대조, 결과 통지로 정한다." }]);
  assert.equal(p.text, "업무 범위는 신청 접수 및 결과 통지로 정한다.");
  assert.equal(preserve(result, data), result);
});

test("선택된 일부 업무와 원문에 명시된 두 항목에는 중간 항목을 끼워 넣지 않는다", () => {
  const text = "업무 범위는 신청 접수, 증빙 서류 대조, 결과 통지로 정한다.";
  const data = { ...base, "S1.2": row(text), "S1.3": row("재신청 시에는 신청 접수 및 결과 통지로 처리한다.") };
  for (const p of [
    point("신청 접수 및 결과 통지로 한정한다."),
    point("재신청 시에는 신청 접수 및 결과 통지로 처리한다.", ["S1.2", "S1.3"]),
    point("증빙 서류 대조 및 결과 통지로 정한다.", ["S1.2"]),
  ]) {
    const points = [p];
    assert.equal(preserve(points, data), points);
  }
});

test("같은 원인의 생략된 결과를 되살리며 별도 근거의 다음 진술을 보존한다", () => {
  const p = point("점검 일정이 지연돼 준비 시간 부족, 야간 접수는 별도로 운영함.", ["S1.2", "S1.3"]);
  const body = "점검 일정이 지연돼 교대 인수인계와 안전 검토에 차질이 생김.";
  const data = { ...base, "S1.2": row("준비 시간 부족: " + body), "S1.3": row("야간 접수는 별도로 운영함.") };
  const points = [p], result = preserve(points, data);
  assert.deepEqual(result, [{ ...p, text: body + " 야간 접수는 별도로 운영함." }]);
  const outside = [point("내부 결정으로 점검 일정이 지연돼 준비 시간 부족.")];
  assert.equal(preserve(outside, data), outside);
});

test("단계가 빠진 짧은 운영 순서는 단일 인용 범위 안에서만 복원한다", () => {
  const source = "처리 절차 1.요청 접수 2.중복 신청 검증 3.결과 통지";
  const data = { ...base, "S1.2": row(source) };
  const p = point("요청 접수 및 결과 통지."), result = preserve([p], data);
  assert.deepEqual(result, [{ ...p, text: source, mode: "원문 발췌" }]);
  const scoped = [point("요청 접수 및 결과 통지만 수행함.")];
  assert.equal(preserve(scoped, data), scoped);
});

test("누락된 시행 범위와 결정 대안을 원문 한 줄의 정확한 위치로 연결한다", () => {
  const request = "상담 예약 창구를 한 개 부서에서 시범 운영하는 방안을 검토해 주시면 좋겠습니다.";
  const decision = "접수 기록에 따라 현장 수령 또는 택배 발송";
  const data = { ...base,
    "S1.2": row("상담 예약 창구의 시범 운영을 요청한다. 접수 기록에 따라 택배 발송을 운영한다."),
    "S1.3": row(request), "S1.4": row("·물품 수령 i.담당자가 보관함을 확인 ii." + decision),
  };
  const p1 = point("상담 예약 창구의 시범 운영을 요청한다."), p2 = point("접수 기록에 따라 택배 발송을 운영한다.");
  const result = preserve([p1, p2], data);
  assert.deepEqual(result, [p1, { text: request, topic: "제안 내용", refs: ["S1.3"], mode: "원문 발췌" },
    p2, { text: decision, topic: "이용·운영 방식", refs: ["S1.4"], mode: "원문 발췌" }]);
  assert.equal(preserve(result, data), result);
});

test("회복 후보가 셋이어도 저장된 결과를 재편집할 때 발췌가 계속 쌓이지 않는다", () => {
  const lines = [
    "상담 창구를 작은 규모에서 운영하는 방안을 검토해 주시면 좋겠습니다.",
    "야간 배송을 일부 지역에서 지원하는 방안을 검토해 주시면 좋겠습니다.",
    "방문 예약을 두 개 지점에서 시범 운영해 주시기 바랍니다.",
  ];
  const data = { ...base, "S1.2": row("상담 창구 운영, 야간 배송 지원, 방문 예약 시범 운영을 제안합니다."),
    ...Object.fromEntries(lines.map((s, i) => ["S1." + (i + 3), row(s)])),
  };
  const points = [point(data["S1.2"].text)], result = preserve(points, data);
  assert.equal(result.length, 3);
  const saved = JSON.parse(JSON.stringify(result));
  assert.equal(preserve(saved, data), saved);
  assert.equal(preserve(points, { ...data, "S1.3": row("제안자 휴무"), "S1.4": row("금액 산정 중") }).length, 2);
});

test("예시·조건부 문맥, 불확실한 OCR, 다른 캡처와 장문·시계열에는 요점을 추가하지 않는다", () => {
  const points = [point("상담 예약 창구의 시범 운영을 요청한다.")];
  const request = "상담 예약 창구를 일부 부서에서 시범 운영해 주시기 바랍니다.";
  const data = { ...base, "S1.2": row(points[0].text) };
  for (const candidate of [
    { "S1.3": row(request, "another page") },
    { "S1.3": row(request, "page", "OCR 수치 대조 필요") },
    { "S1.3": row("반대 의견:"), "S1.4": row(request) },
    { "S1.3": row("예를 들어 " + request) },
    { "S1.3": row(request), "S1.4": row("내용".repeat(3000)) },
  ]) assert.equal(preserve(points, { ...data, ...candidate }), points);
  const series = [...points, { ...points[0], mode: "표의 날짜·값 대조" }];
  assert.equal(preserve(series, { ...data, "S1.3": row(request) }), series);
});

test("같은 대상의 확인 기관을 바꿔 썼을 때는 실제 주체와 이어지는 결과를 함께 인용한다", () => {
  const p = point("본점에서 인증한 주문서만 접수를 보장함.");
  const data = { ...base, "S1.2": row("지점에서 인증한 주문서만 접수하기 때문에,"),
    "S1.3": row("별도 심사 없이 신청할 수 있습니다.") };
  const [fixed] = preserve([p], data);
  assert.deepEqual(fixed.refs, ["S1.2", "S1.3"]);
  assert.equal(fixed.text, "지점에서 인증한 주문서만 접수하기 때문에, 별도 심사 없이 신청할 수 있습니다.");
  const points = [point("본점에서 인증한 거래처만 접수를 보장함.")];
  assert.equal(preserve(points, data), points);
});

test("근거에 없는 대상 분류 대신 원문에 있는 두 가지 구체적인 이용 동작을 담는다", () => {
  const p = point("메뉴 구조, 표시 속도를 고려하여 연구·안전·환경 사용자가 모두 참여하게 설계함.", ["S1.2", "S1.3"]);
  const data = { ...base, "S1.2": row("메뉴 구조가 복잡하고 표시 속도가 빠르면 알아보기 어렵습니다."),
    "S1.3": row("처음 접하는 이용자들도 안내를 듣거나 그림을 고를 수 있게 배열해야 합니다.") };
  const [fixed] = preserve([p], data);
  assert.equal(fixed.text, "메뉴 구조, 표시 속도를 고려하여 처음 접하는 이용자들도 안내를 듣거나 그림을 고를 수 있게 배열해야 합니다.");
  assert.deepEqual(fixed.refs, p.refs);
});

test("산출 작업과 공개 작업의 주기를 각각 인용하고 이미 같이 명시된 주기는 유지한다", () => {
  const p = point("대여 기록을 활용하여 매월 도서 통계 집계 및 도서관에 게시", ["S1.3", "S1.4"]);
  const data = { ...base, "S1.2": row("이용 현황 지표 집계"), "S1.3": row("대여 기록을 활용"),
    "S1.4": row("매월 도서 통계를 공개, 도서관에 게시") };
  const [fixed] = preserve([p], data);
  assert.equal(fixed.text, "대여 기록을 활용하여 도서 통계 집계. 매월 도서 통계를 공개, 도서관에 게시");
  assert.deepEqual(fixed.refs, ["S1.3", "S1.4", "S1.2"]);
  const points = [p];
  assert.equal(preserve(points, { ...data, "S1.4": row("매월 도서 통계를 집계 및 공개, 도서관에 게시") }), points);
});

test("별도 표칸의 예상 금액과 배치 단위당 수량을 보존하고 다른 쪽이나 불확실한 수치에 붙이지 않는다", () => {
  const p = point("각 팀이 필요한 장비를 신청한다.");
  const data = { ...base, "S1.2": row("각 팀이 필요한 장비를 신청한다. 지점당 7개의 공구를 배치함."),
    "S1.3": row("운영비(예상)"), "S1.4": row("29,000원") };
  const out = preserve([p], data);
  assert.equal(out.length, 3);
  assert.deepEqual(out.slice(1).map(({text,refs}) => [text,refs]), [
    ["운영비(예상) 29,000원", ["S1.3","S1.4"]], ["지점당 7개의 공구를 배치함", ["S1.2"]],
  ]);
  assert.equal(preserve(out, data), out);
  for (const unsupported of [row("29,000원", "elsewhere"), row("29,000원", "page", "OCR 수치 대조 필요")])
    assert.equal(preserve([p], { ...data, "S1.4": unsupported }).length, 2);
  const conditional = [p];
  assert.equal(preserve(conditional, { ...base, "S1.2": row("재고가 남을 경우, 지점당 7개의 공구를 배치함.") }), conditional);
});

test("요청의 방향과 목격 서술, 기대효과 절의 상태를 각 문장 근거로 바로잡는다", () => {
  const data = { ...base, "S1.2": row("대학본부가 예약 시스템을 개발해 주세요."),
    "S1.3": row("야간 통근자가 귀가에 어려운 순간을 마주하게 됨. 이후 이동 계획을 다시 세운다."),
    "S1.4": row("2. 기대효과"), "S1.5": row("방문 예약 도입 → 방문객 만족도 향상") };
  const points = [point("학생이 대학본부로부터 예약 시스템 개발을 요청함."),
    point("야간 통근자가 귀가에 어려운 순간을 목격함.", ["S1.3"]),
    point("방문 예약을 도입하여 방문객 만족도 향상", ["S1.5"])];
  const out = preserve(points, data);
  assert.deepEqual(out.map(p=>p.text), ["학생이 대학본부에 예약 시스템 개발을 요청함.",
    "야간 통근자가 귀가에 어려운 순간을 마주하게 됨.", "방문 예약을 도입하여 방문객 만족도 향상을 기대함."]);
  assert.deepEqual(out[2].refs, ["S1.4","S1.5"]);
  assert.equal(preserve(out, data), out);
});
