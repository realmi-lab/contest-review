import test from "node:test";
import assert from "node:assert/strict";
import { preserveEligibility as preserve } from "../src/summary/proposal-eligibility.mjs";

const row = (text, capture = "first", kind = "OCR") => ({ text, capture, kind });
const point = (text, refs) => ({ text, refs, mode: "요약", topic: "제안 내용" });
const evidence = {
  "S1.1": row("공동 창작소 회원 선발 방법 개정 제안"),
  "S1.2": row("□ 신청 자격 ㅇ경력 요건 폐지: 경력 증명 제출 조항을 삭제해 신입도 지원 가능 ㅇ변경 후 신청 자격 (만 21세 이상 지원자):"),
  "S1.3": row("-증명서: R-52를 소지하고 2028.5.30.까지 유효한 자 -우대 기준: 지역 단체에서 2년 이상 활동한 사람에게 가점 부여"),
  "S1.4": row("□ 규모 변경 ㅇ선발 인원: 연간 선발 규모를 45명으로 증원"),
};
const points = [point("지원하려면 경력과 서류를 확인한다.", ["S1.2", "S1.3"]),
  point("이용 기회를 늘리고자 매년 45 명 증원한다.", ["S1.4"])];

test("신청 주체·자격 코드·기간·선호 기준을 원문 역할과 인용에 붙여 분리한다", () => {
  const out = preserve(points, evidence);
  const details = out.filter(p => p.mode === "자격·선발 원문");
  assert.equal(details.length, 4);
  const credential = details.find(p => p.text.includes("R-52"));
  assert.equal(credential.eligibilityRole, "proposed");
  assert.match(credential.text, /만 21세 이상.*R-52.*2028\.5\.30/u);
  assert.deepEqual(credential.refs, ["S1.2","S1.3"]);
  assert.doesNotMatch(credential.text, /2년|우대/u);
  assert.match(details.find(p=>p.eligibilityRole === "preference").text, /2년 이상.*가점/u);
  assert.match(details.find(p=>p.eligibilityRole === "quota").text, /연간 선발 규모를 45명으로 증원/u);
  assert.match(out.find(p=>p.mode==="요약" && p.refs.includes("S1.4")).text, /45 명으로 증원/u);
  assert.equal(preserve(out,evidence),out);
});

test("현행과 변경 표제, 실제 증분과 숫자의 자릿값을 구별한다", () => {
  const current = {...evidence, "S1.2": row("□ 신청 자격 ㅇ현행 기준: 현장 경험 3년 이상 ㅇ개정 기준: 현장 경험 1년 이상")};
  const out = preserve(points, current);
  assert.match(out.find(p => p.eligibilityRole === "current").text, /현행 기준.*3년/u);
  assert.match(out.find(p => p.eligibilityRole === "proposed").text, /개정 기준.*1년/u);
  const big = point("145명 증원", ["S1.4"]);
  assert.ok(preserve([big],evidence).includes(big));
  const additional = { ...evidence, "S1.4": row("□ 정원 변경 ㅇ선발 인원: 지난해보다 45명 추가 모집") };
  assert.ok(preserve(points,additional).includes(points[1]));
  for (const particle of ["로", "까지"]) {
    const data = { ...evidence, "S1.4": row("연간 선발 규모를 5개" + particle + " 확대") };
    assert.equal(preserve([point("연간 선발 규모를 5개 확대", ["S1.4"])], data)[0].text,
      "연간 선발 규모를 5개" + particle + " 확대");
  }
});

test("다른 쪽·누락된 인용번호·낮은 OCR 품질·참고 표에서는 자격 표제를 이어붙이지 않는다", () => {
  for (const sample of [
    {...evidence, "S1.3":row("-증명서: R-52를 제출", "other")},
    {"S1.1":evidence["S1.1"],"S1.2":evidence["S1.2"],"S1.4":row("-증명서: R-52를 제출")},
    {...evidence, "S1.3":row(evidence["S1.3"].text,"first","OCR 수치 대조 필요")},
    {...evidence, "S1.2":row("□ 참고 사례 ㅇ변경 후 신청 자격 (만 21세 이상 지원자):")},
  ]) assert.ok(!preserve(points,sample).some(p => p.eligibilityRole && p.text.includes("R-52")));
  const unrelated = { "S1.1": row("부서별 산책로 확장 제안. 도로 길이를 45미터로 확대.") };
  assert.equal(preserve(points,unrelated),points);
});
