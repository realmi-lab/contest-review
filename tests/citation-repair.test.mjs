import test from "node:test";
import assert from "node:assert/strict";
import { repairExampleRefs } from "../citation-repair.mjs";
const row = (text, capture = "page") => ({ text, capture, kind: "OCR" });
const point = {
  text: "서울 이용 불편(교통카드 구매 어려움, 택시 바가지 요금)과 계절 제약(폭염, 한파).",
  refs: ["S1.1", "S1.2"],
  mode: "요약",
};
const ev = {
  "S1.1": row("서울 방문 불편"),
  "S1.2": row("1,100"),
  "S1.3": row(
    "외지 이용객은 교통카드를 구매할 장소를 찾기 어렵고, 택시의 바가지 요금도 경험했다.",
  ),
  "S1.4": row("계절별 영향에 따라 보행이 어렵다. 여름철에는 폭염이"),
  "S1.5": row("겨울에는 한파가 있어서 관광객이 걷기 어려운 날이 많다."),
};
test("두 목록의 구체어가 한 문장과 서로 인접한 원문 두 줄에 있고 인용이 유일하면 보강한다", () => {
  const q = repairExampleRefs(point, ev);
  assert.deepEqual(q.refs, ["S1.3", "S1.4", "S1.5", "S1.1"]);
  assert.equal(q.text, point.text);
  assert.equal(repairExampleRefs(q, ev), q);
});
test("낱말 하나, 숫자, 소제목, 다른 페이지, 중복 근거와 부족한 인용 공간은 원래 상태로 둔다", () => {
  for (const data of [
    {
      ...ev,
      "S1.3": row(
        "택시를 이용하기 전에 이용자가 보행 불편 내용을 미리 확인할 수 있다.",
      ),
    },
    {
      ...ev,
      "S1.3": row(
        "1. 교통카드 구매 어려움 및 택시 바가지 요금 관련 정책과 신청 안내",
      ),
    },
    { ...ev, "S1.3": row(ev["S1.3"].text, "elsewhere") },
    { ...ev, "S1.8": row(ev["S1.3"].text) },
    { ...ev, "S1.5": { ...ev["S1.5"], kind: "OCR 수치 대조 필요" } },
  ])
    assert.equal(repairExampleRefs(point, data), point);
  const nums = { ...point, text: "분기별 수치(3%, 9%)를 다룬다." };
  assert.equal(repairExampleRefs(nums, ev), nums);
  const capped = {
    ...point,
    text: "서울과 부산 이용 불편(교통카드 구매 어려움, 택시 바가지 요금)과 계절 제약(폭염, 한파).",
    refs: ["S1.1", "S1.7"],
  };
  assert.equal(
    repairExampleRefs(capped, { ...ev, "S1.7": row("부산 방문 불편") }),
    capped,
  );
});
