import assert from "node:assert/strict";
import test from "node:test";
import { selectProposalBrief } from "../src/summary/proposal-brief.mjs";

const point = (text, ref, topic = "제안 내용") => ({
  text,
  refs: [ref],
  topic,
  mode: "요약",
});

test("현행·제안·우대·선발 원문을 구분하고 대체된 모집 설명을 다시 넣지 않는다", () => {
  const tagged = (text, ref, eligibilityRole) => ({
    ...point(text, ref),
    mode: "자격·선발 원문",
    eligibilityRole,
  });
  const title = "현장 실습 교육 신청 대상 확대 제안";
  const facts = [
    tagged("신청 시 소속기관 확인서를 제출한다.", "a", "proposed"),
    tagged("수료자를 우선 고려한다.", "b", "preference"),
    tagged("현재 재직 중인 사람만 신청한다.", "a", "current"),
    tagged("신청 기간은 접수 개시 후 2주다.", "c", "proposed"),
    tagged("선발 규모를 60명으로 확대한다.", "d", "quota"),
    tagged("증명서는 제출일에 유효해야 한다.", "e", "proposed"),
  ];
  const stale = point("현행 규모에서 60명을 더 선발하도록 지원해야 한다.", "d");
  const evidence = { title: { text: title } };
  for (const p of facts) evidence[p.refs[0]] = { text: p.text };
  const result = selectProposalBrief([stale], [stale, ...facts], evidence);
  assert.equal(result[0].text, title);
  assert.deepEqual(result[0].refs, ["title"]);
  assert.deepEqual(
    result.slice(1, 5).map((p) => p.sourceNote),
    ["현행 자격", "제안한 자격", "우대 기준", "선발 규모"],
  );
  assert.ok(!result.some((p) => p.text === stale.text));
  assert.equal(result.length, 6);
  assert.ok(facts.every((p) => !p.sourceNote));
});

test("예산, 지원 규모와 종류별 물량, 자격 확인 주체와 다른 접수처를 보존한다", () => {
  const request = point("작업복 지원 제도를 도입하자고 제안합니다.", "a");
  const background = point("기존 지원은 여러 불편을 겪는다.", "b");
  const benefit = point("직원 만족도가 높아질 것으로 기대된다.", "c");
  const cost = point("시행 예산은 총 320만 원으로 추정한다.", "d");
  const scale = point("시범 현장 3곳을 선정한다.", "e");
  const counts = point("현장당 방한복 8벌, 일반복 12벌을 배정한다.", "f");
  const verified = point(
    "교육기관이 자격을 확인한 견습생만 신청 가능하다.",
    "g",
  );
  const exception = point("현장 이외에 인사팀에서도 접수 가능하다.", "h");
  const all = [
    request,
    background,
    benefit,
    cost,
    scale,
    counts,
    verified,
    exception,
  ];
  const result = selectProposalBrief(all.slice(0, 3), all, {
    a: { text: "작업복 지원 제안" },
  });
  assert.deepEqual(
    new Set(result),
    new Set([request, cost, scale, counts, verified, exception]),
  );
});

test("시행 범위, 유지되는 예외, 예정된 검증을 반복되는 배경 앞에 둔다", () => {
  const main = point("직원 물품 대여 절차의 개선을 제안합니다.", "a");
  const generic = point(
    "여러 부서에서 공통적으로 느끼는 어려움이 있다.",
    "b",
    "대상과 배경",
  );
  const issue = point(
    "현재 야간 근무자는 물품을 받을 수 없어 불편하다.",
    "c",
    "대상과 배경",
  );
  const pilot = point("일부 지점에서만 무인 대여를 시범 운영한다.", "d");
  const keep = point("보관함 이용 자격은 현행대로 유지한다.", "d");
  const verification = point("운영 뒤 이용자 설문을 실시할 계획이다.", "e");
  const expected = point("대기 시간이 감소할 것으로 예상된다.", "f");
  const points = [main, generic, issue, pilot, keep, verification, expected];
  const evidence = { a: { text: "물품 대여 개선 제안" } };
  const result = selectProposalBrief([main, generic, issue], points, evidence);
  assert.equal(result[0], main);
  for (const p of [pilot, keep, verification, expected])
    assert.ok(result.includes(p));
  assert.ok(result.length <= 6);
  assert.deepEqual(pilot.refs, ["d"]);
});

test("같은 목록에서 나온 연속 요점만 원래 순서로 묶고 수치와 부정을 보존한다", () => {
  const request = point("점검 절차 도입 제안.", "title");
  const a = point("도착 시 온도를 측정한다.", "list");
  const b = point("1.2도 이상이면 자동 등록한다.", "list");
  const c = point("12도 이상이면 자동 등록하지 않는다.", "list");
  const treatment = point("종료 뒤 물품을 반납한다.", "other");
  const evidence = {
    title: { text: "보관 물품 점검 절차 도입 제안" },
    list: {
      text: "• 도착 시 측정 · 1.2도 이상 자동 등록 · 12도 이상 자동 등록 금지",
    },
    other: { text: treatment.text },
  };
  const points = [request, a, b, c, treatment];
  const lead = [request, b, b, treatment];
  const result = selectProposalBrief(lead, points, evidence);
  const list = result.filter((p) => p.refs.includes("list"));
  assert.equal(list.length, 1);
  assert.equal(list[0].text, [a.text, b.text, c.text].join(" "));
  assert.deepEqual(list[0].refs, ["list"]);
  assert.equal(lead.length, 4);

  const noList = {
    ...evidence,
    list: { text: "점검·기록·감사 부서 합의 내용" },
  };
  const separate = selectProposalBrief(lead, points, noList);
  assert.ok([a, b, c].every((p) => separate.includes(p)));
});

test("운영 제언을 포함하는 짧은 연구, 수치표, 장문은 기존 첫 화면을 유지한다", () => {
  const proposal = point("현장 적용도 검토해야 한다.", "a");
  const data = point("기존 지원의 효과를 측정했다.", "b");
  const points = [proposal, data];
  const lead = [data, proposal];
  assert.equal(
    selectProposalBrief(lead, points, {
      a: { text: "시설 연구 보고서 및 향후 지원 제안" },
    }),
    lead,
  );
  const evidence = { a: { text: "시설 지원 도입 제안" } };
  assert.equal(
    selectProposalBrief(
      lead,
      [...points, { ...data, mode: "표의 열·값 대조" }],
      evidence,
    ),
    lead,
  );
  assert.equal(selectProposalBrief(lead, points, evidence, 16), lead);
});
