import { test } from "node:test";
import assert from "node:assert/strict";
import { ideaOpinion } from "../src/check/idea-opinion.mjs";

test("AI 의견은 근거 요점 번호를 그 요점의 원문 근거로 잇고, 번호가 없는 좋은 점·약한 점은 버린다", async () => {
  const reading = {
    title: "공유 우산",
    edition: { brief: [{ topic: "무엇이 문제인가", text: "비 오는 날 우산이 없다.", refs: ["S2.1"] }], detail: [] },
    points: [{ topic: "실측·관찰 결과", text: "설문 30명 중 20명이 불편했다.", refs: ["S3.4", "S3.5"] }],
  };
  let sent = "";
  const run = async (system, content) => {
    sent = system + content;
    return {
      take: "작은 불편을 싸게 푼다.",
      strengths: [{ text: "대상과 상황이 분명하다.", ids: [1] }, { text: "근거 없는 칭찬", ids: [] }],
      weaknesses: [{ text: "표본이 작다.", ids: [2, 9] }],
      questions: ["분실은 어떻게 막나요?", " "],
      compliance: [{ area: "개인정보", text: "대여자 연락처 수집 동의와 보관 기간 확인.", ids: [] }, { area: "", text: " ", ids: [1] }],
    };
  };
  const out = await ideaOpinion(reading, [{ reason: "표본 수가 서로 다르다." }], run);
  assert.match(sent, /\[2쪽\] 비 오는 날/);
  assert.match(sent, /채택·보류·탈락 같은 결정이나 추천은 내지 않는다/);
  assert.deepEqual(out.strengths, [{ text: "대상과 상황이 분명하다.", refs: ["S2.1"] }]);
  assert.deepEqual(out.weaknesses, [{ text: "표본이 작다.", refs: ["S3.4", "S3.5"] }]);
  assert.deepEqual(out.questions, ["분실은 어떻게 막나요?"]);
  assert.equal(out.take, "작은 불편을 싸게 푼다.");
  // 법·컴플라이언스는 단정하지 않게 묻고, 근거 번호가 없어도 남기며 빈 줄은 버린다
  assert.match(sent, /위반이라고 단정하지 않고/);
  assert.deepEqual(out.compliance, [{ area: "개인정보", text: "대여자 연락처 수집 동의와 보관 기간 확인.", refs: [] }]);
});
