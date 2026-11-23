import test from "node:test";
import assert from "node:assert/strict";
import { echoesInstructions } from "../src/summary/reading.mjs";
import { longBrief, pickFocused } from "../src/summary/long-brief.mjs";
import { haiku, withHaiku } from "../src/ai/claude-summary.mjs";

test("지시문을 되풀이한 요점은 걸러내고, 원문에 있는 같은 구절은 남긴다", () => {
  const evidence = {
    "S1.1": { text: "8 | 참고 자료/출처" },
    "S2.1": { text: "본 제안은 원문에 없는 조건을 채우지 않는 원칙으로 작성했다." },
  };
  assert.equal(echoesInstructions({ text: "원문에 없는 조건을 채우지 않으며, 판독 불확실한 기호는 복원하지 않습니다.", refs: ["S1.1"] }, evidence), true);
  assert.equal(echoesInstructions({ text: "원문에 없는 조건을 채우지 않는 원칙으로 작성했다.", refs: ["S2.1"] }, evidence), false);
  assert.equal(echoesInstructions({ text: "좌석 그룹별 가격 민감도를 추정한다.", refs: ["S1.1"] }, evidence), false);
});

test("긴 문서 요지의 핵심 제안·대표 결과는 같은 역할 항목만 놓고 따로 고른다", async (t) => {
  const points = Array.from({ length: 20 }, (_, i) => ({
    topic: i === 3 ? "제안 내용" : i === 9 ? "실측·관찰 결과" : "이용·운영 방식",
    text: i === 3 ? "좌석 그룹핑과 가격 산정을 투명하게 바꾸는 것을 목표로 한다." : i === 9 ? "시험 결과 정확도는 0.83이었다." : "세부 방법 " + i,
    refs: ["S" + (i + 1) + ".1"], mode: "요약",
  }));
  const prompts = [];
  t.mock.method(globalThis, "fetch", async (url, opts) => {
    const { messages, format } = JSON.parse(opts.body);
    prompts.push(messages.at(-1).content);
    const answer = format.required.length === 1
      ? { [format.required[0]]: format.required[0] === "purpose" ? 4 : 10 } // 역할별로 따로 묻는 질문
      : Object.fromEntries(format.required.map((k) => [k, k === "method" ? 2 : k === "purpose" ? 6 : 0])); // 그룹 선택은 엉뚱한 purpose
    return Response.json({ message: { content: JSON.stringify(answer) } });
  });
  const lead = await longBrief(points, "예시 문서", {});
  assert.equal(lead[0].text, points[3].text);
  assert.equal(lead[1].text, points[1].text);
  assert.ok(lead.some((p) => p.text === points[9].text)); // 대표 결과도 따로 골라 넣는다
  assert.ok(!lead.some((p) => p.text === points[5].text)); // 그룹 선택의 purpose는 대체된다
  const purposePrompt = prompts.find((p) => p.includes("'제안 내용'으로 분류된 항목"));
  assert.ok(purposePrompt.includes('[4,"[4쪽] 좌석 그룹핑'));   // 쪽 위치를 함께 보낸다
});

test("후보가 많으면 묶음마다 고른 뒤 다시 고르고, 방법·한계의 별도 선택은 로컬 모델에서만 한다", async (t) => {
  const long = "좌석 등급을 추정하기 위해 군집분석 알고리즘을 적용하고 그 결과를 공연별로 비교했다. ".repeat(4);
  const items = Array.from({ length: 80 }, (_, i) => ({ id: i + 1, text: long,
    point: { topic: "이용·운영 방식", text: long + i, refs: ["S" + (i + 1) + ".1"] } }));
  const asked = [];
  t.mock.method(globalThis, "fetch", async (url, opts) => {
    const { format } = JSON.parse(opts.body);
    const ids = format.properties.method.enum.slice(1);
    asked.push(ids.length);
    return Response.json({ message: { content: JSON.stringify({ method: ids.at(-1) }) } });
  });
  const chosen = await pickFocused("method", items, "예시 문서");
  assert.ok(asked.length >= 3 && asked.at(-1) === asked.length - 1); // 묶음 여러 번 + 묶음별 선택끼리 한 번
  assert.equal(chosen.id, 80);

  // Haiku에서는 그룹 선택만 쓰므로 방법·한계를 따로 묻지 않는다.
  const roles = [];
  const points = Array.from({ length: 20 }, (_, i) => ({ topic: "이용·운영 방식", text: "세부 방법 " + i, refs: ["S" + (i + 1) + ".1"], mode: "요약" }));
  t.mock.method(globalThis, "fetch", async (url, opts) => {
    const body = JSON.parse(opts.body), schema = body.output_config.format.schema;
    roles.push(schema.required.join(","));
    return Response.json({ model: haiku, stop_reason: "end_turn",
      content: [{ type: "text", text: JSON.stringify(Object.fromEntries(schema.required.map((k) => [k, 0]))) }] });
  });
  await withHaiku("test-key", () => longBrief(points, "예시 문서", {}));
  assert.ok(!roles.includes("method") && !roles.includes("limitation"));
});
