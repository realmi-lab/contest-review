import test from "node:test";
import assert from "node:assert/strict";
import { documentOf, similarWorks } from "../src/review/similar.mjs";

const work = (id, name, ...brief) => ({ id, name, cloudReading: { edition: { brief: brief.map((text, i) => ({ topic: i ? "무엇을 하려는가" : "한 줄 요약", text })) } } });

test("비슷한 제안은 제목·요약의 겹치는 말로 찾고, 묶음 머리말과 [표시]는 비교에서 뺀다", () => {
  const works = [
    work("a", "2024 공모 · 사내 공유 우산 대여함", "비 오는 날 직원이 우산을 빌리고 반납하는 대여함을 층마다 둔다."),
    work("b", "2025 공모 · 우산 대여 무인함 설치", "갑자기 비가 올 때 직원이 우산을 빌릴 수 있게 무인 대여함을 설치한다."),
    work("c", "2024 공모 · 출금 지연 안내 문자", "출금이 늦어질 때 고객에게 예상 시각을 문자로 알린다."),
    work("d", "[QA 예시] 2024 공모 · 회의실 예약 알림", "회의 10분 전 예약자에게 알림을 보낸다."),
  ];
  const found = similarWorks(works, "a", 3, 0.05);
  assert.equal(found[0].id, "b");
  assert.ok(found[0].score > 0.2);
  assert.ok(found[0].words.some((w) => w.includes("우산")));
  assert.ok(!found.some((x) => x.id === "c" && x.score > found[0].score));
  assert.ok(!documentOf(works[3]).includes("QA")); // [표시]는 뺀다
  assert.deepEqual(similarWorks(works, "없음"), []);
});
