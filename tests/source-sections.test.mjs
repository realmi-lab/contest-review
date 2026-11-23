import assert from "node:assert/strict";
import test from "node:test";
import { sourceSections, overviewItems, draftSections, includeSections, sectionLabel } from "../src/summary/source-sections.mjs";

const row = (capture, text, kind = "OCR") => ({ capture, text, kind });
const item = (topic, text, ...refs) => ({ topic, text, refs, mode: "요약" });

test("소개 페이지의 세 항목을 실제 원문에서 복원하고 판독이 갈린 문장을 제외한다", () => {
  const evidence = { A: row("opening", "제안 개요") };
  const table = [
    ["우산 대여", "안내 데스크에서 우산 대여 기록을 확인합니다."],
    ["휴게실", "직원은 빈 좌석을 선택하고 이용 시간을 기록합니다."],
    ["비품 신청", "담당자가 신청 내역을 확인하고 비품을 전달합니다."],
    ["지원 비용", "지원 비용이 총 345만 원으로 확정되었습니다."],
  ];
  const points = table.map(([name, text], i) => {
    evidence["H" + i] = row("opening", name);
    evidence["T" + i] = row("opening", text, i === 3 ? "OCR 수치 대조 필요" : "OCR");
    return item("제안", name + ": " + text, "H" + i, "T" + i);
  });
  const plan = sourceSections({ evidence }, new Set());
  assert.deepEqual(overviewItems(plan, points).map((p) => [p.topic, p.refs]), table.slice(0, 3).map(([name], i) => [name, ["H" + i, "T" + i]]));
  points[0].text += " 모든 절차는 실시간으로 자동 처리됩니다.";
  assert.deepEqual(overviewItems(plan, points), []);
});

test("다단 캡처의 같은 열 문장을 복원하고 다른 절 인용과 미지원 속성을 배제한다", async () => {
  const evidence = {}, lines = [];
  for (const [id, text, x, y] of [
    ["A", "운영 방식: 이용 신청", 20, 10], ["B", "이용자가 빈 좌석을 선택하면", 350, 100],
    ["X", "나중에 보기", 30, 120], ["C", "담당자가 신청 시간을 확인합니다.", 351, 128],
  ]) {
    evidence[id] = { ...row("one", text), indexes: [lines.length] };
    lines.push({ text, box: { x, y, w: 250, h: 22 } });
  }
  for (const [i, name] of ["휴게실 운영", "비품 운영"].entries()) {
    evidence["H" + i] = row(name, "운영 방식: " + name);
    evidence["T" + i] = row(name, "근무자는 이용 현황을 매일 확인합니다.");
  }
  evidence.Z = row("one", "판독이 갈린 345만원");
  const plan = sourceSections({ evidence }, new Set(["Z"]), [{ id: "one", ocrHeight: 900, lines }]);
  assert.equal(plan.explicit, true);
  let checked = false;
  const perRequest = [];
  const sections = await draftSections(plan, "", () => {}, async (_system, prompt) => {
    assert.doesNotMatch(prompt, /345만원/);
    perRequest.push(JSON.parse(prompt.split("\n").at(-1)).length);
    return Object.fromEntries(JSON.parse(prompt.split("\n").at(-1)).map((c) => {
      const index = c.문장.find(([_, text]) => text === "이용자가 빈 좌석을 선택하면 담당자가 신청 시간을 확인합니다.")?.[0];
      if (index) checked = true;
      return [c.절, { core: { quotes: index ? [index] : [], refs: [], text: "담당자가 실시간으로 신청을 자동 승인합니다." },
        detail: { quotes: [], refs: ["OTHER"], text: "다른 절의 내용입니다." } }];
    }));
  });
  assert.ok(checked);
  assert.deepEqual(perRequest, [2, 1]); // 한 요청에 절 2개까지
  assert.deepEqual(sections[0].coreQuote.refs, ["B", "C"]);
  assert.ok(sections[0].captureQuotes.includes(sections[0].coreQuote));
  assert.equal(sections[0].core, null);
  assert.equal(sections[0].detail, undefined);
});

test("핵심에는 원본 개요를, 확장에는 별도 근거와 이미 확인한 표 수치를 남긴다", () => {
  const lead = item("배경", "직원이 휴식 공간을 찾기 어렵다는 의견이 있었다.", "A");
  const metric = { ...item("측정 결과", "공간별 사용률은 각각 41%와 63%였다.", "T"), mode: "표의 열·값 대조" };
  const topics = [["예약", "근무자가 사용 시간을 직접 고른다."], ["대여", "대여한 비품은 담당 데스크에 반납한다."],
    ["담당자", "업무 담당자가 접수 상태를 확인한다."], ["설문", "직원이 원하는 개선 사항을 제출한다."]];
  const overview = topics.map(([label, text], i) => item(label, text, "O" + i));
  const details = topics.map(([label], i) => ({ core: overview[i], detail: item(label, label + "의 추가 절차를 설명하는 별도 문장이다.", "D" + i) }));
  const out = includeSections({ brief: [lead], detail: [metric] }, details, overview);
  assert.equal(out.brief.length, 4);
  assert.deepEqual(new Set(out.brief.flatMap((p) => p.refs)), new Set(["A", "O0", "O1", "O2", "O3"]));
  assert.deepEqual(out.detail.map((p) => p.refs[0]), ["T", "D0", "D1", "D2", "D3"]);
});

test("절 이름은 번호를 떼고, 잘린 문장이면 '본문 요지'로 대신한다", () => {
  assert.equal(sectionLabel("1.수익 최대화"), "수익 최대화");
  assert.equal(sectionLabel("6.1 공연 분류"), "공연 분류");
  assert.equal(sectionLabel("1. 예매 데이터와 좌석 데이터를 기반으로 만든 변수들 사이의 관계를 파악함으로써,각 변수들이 예매에 미치는"), "본문 요지");
  assert.equal(sectionLabel("좌석 특성을 정리했다"), "본문 요지");
  assert.equal(sectionLabel("원가격추정 mean under 25"), "본문 요지");
});

test("서로 다른 절의 핵심 문장은 핵심 요약에서 한 줄로 합치지 않는다", () => {
  const lead = item("제안 내용", "좌석 그룹핑과 가격 산정을 투명하게 하는 것이 목표다.", "A");
  const sections = [["선행 연구", "공연 상품은 가격 할인보다 좌석 미확보 위험이 더 크다."], ["원가격 추정", "스무딩 후 19%의 값이 바뀌었다."],
    ["수익 최대화", "좌석별 가격 민감도로 수익이 최대인 그룹과 가격을 찾는다."]]
    .map(([label, text], i) => ({ core: item(label, text, "S" + i), detail: null }));
  const out = includeSections({ brief: [lead], detail: [] }, sections);
  assert.equal(out.brief.length, 4);
  assert.ok(out.brief.every((p) => !p.topic.includes(" · ")));
  assert.deepEqual(out.brief.map((p) => p.refs), [["A"], ["S0"], ["S1"], ["S2"]]);
});
