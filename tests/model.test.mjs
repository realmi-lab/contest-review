import test from "node:test";
import assert from "node:assert/strict";
import { chat, endpoint, model, modelInfo } from "../model.mjs";
import { haiku, withEffort, withHaiku } from "../claude-summary.mjs";
import { newHaikuUsage, recordHaikuUsage, usageSnapshot } from "../haiku-usage.mjs";

test("하이쿠 응답이 잘리면 해당 호출의 출력 한도만 늘려 완전한 결과를 받는다", async (t) => {
  const calls = [];
  let alwaysTruncated = false;
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    calls.push(JSON.parse(options.body));
    const partial = calls.length === 1 || alwaysTruncated;
    return Response.json({ model: haiku, stop_reason: partial ? "max_tokens" : "end_turn",
      usage: { input_tokens: 12, output_tokens: partial ? 40 : 20, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      content: [{ type: "text", text: partial ? '{"text":' : '{"text":"완료"}' }] });
  });
  const usage = newHaikuUsage("retry");
  const run = () => withHaiku("test", () => chat("편집", "문서", { type: "object", properties: { text: { type: "string" } } }),
    (u) => recordHaikuUsage(usage, u));
  assert.deepEqual(await run(), { text: "완료" });
  assert.equal(calls.length, 2);
  assert.equal(usage.totalTokens, 84);
  assert.equal(usage.estimatedUsd, 0.0000324);
  assert.ok(calls[1].max_tokens > calls[0].max_tokens);
  assert.deepEqual(calls[1], { ...calls[0], max_tokens: calls[1].max_tokens });
  alwaysTruncated = true;
  await assert.rejects(run, /출력 한도/);
  assert.equal(calls.length, 4);
  assert.equal(usage.totalTokens, 188);
});

test("캐시를 포함한 요청별 10만 토큰 경계와 캐시 TTL 요금을 집계한다", () => {
  const usage = newHaikuUsage("pricing");
  const data = { input_tokens: 10000, output_tokens: 200, cache_read_input_tokens: 80000,
    cache_creation_input_tokens: 10000, cache_creation: { ephemeral_5m_input_tokens: 8000, ephemeral_1h_input_tokens: 2000 } };
  recordHaikuUsage(usage, data);
  assert.equal(usage.estimatedUsd, 0.0033);
  recordHaikuUsage(usage, { ...data, input_tokens: 10001 });
  assert.equal(usage.estimatedUsd, 0.0198005);
  assert.equal(usage.totalTokens, 200401);
  recordHaikuUsage(usage, null);
  assert.equal(usage.measured, 2);
  assert.equal(usage.requests, 3);
  recordHaikuUsage(usage, { ...data, cache_creation: null });
  assert.equal(usage.estimatedUsd, null);
  assert.equal(usage.totalTokens, 300601);
  const unknown = newHaikuUsage("missing");
  recordHaikuUsage(unknown, { input_tokens: 1, output_tokens: 1 });
  assert.equal(usageSnapshot(unknown).totalTokens, null);
  assert.equal(usageSnapshot(newHaikuUsage("no-api-calls"), true).totalTokens, 0);
});

test("응답 도중 연결이 끊기면 같은 로컬 요청만 다시 읽는다", async (t) => {
  const requests = [];
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    requests.push(options.body);
    if (requests.length === 1) {
      return {
        ok: true,
        json: async () => {
          throw new TypeError("socket closed");
        },
      };
    }
    return Response.json({ message: { content: '{"ok":true}' } });
  });
  assert.deepEqual(await chat("검토", "공개 자료", { type: "object" }), {
    ok: true,
  });
  assert.equal(requests.length, 2);
  assert.equal(requests[0], requests[1]);
});

test("AI 요청은 Haiku만 쓰고(판단 medium·추출 low) 실패해도 로컬로 보내지 않는다", async (t) => {
  const calls = [], efforts = [];
  const schema = { type: "object", properties: { text: { type: "string" } } };
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls.push(url);
    if (url === endpoint + "/api/tags") return Response.json({ models: [{ name: model }] });
    assert.equal(url, "https://api.anthropic.com/v1/messages");
    const b = JSON.parse(options.body);
    assert.equal(b.model, haiku);
    efforts.push(b.output_config.effort);
    assert.equal(b.thinking.type, "adaptive");
    assert.ok(b.max_tokens >= 16000);
    if (b.messages[0].content[0].type === "image") return Response.json({}, { status: 429 });
    return Response.json({ model: haiku, stop_reason: "end_turn", content: [{ type: "text", text: '{"text":"요약"}' }] });
  });
  await withHaiku("test", async () => {
    assert.equal((await modelInfo()).name, haiku);
    assert.equal((await chat("편집", "예제", schema)).text, "요약");
    assert.equal((await withEffort("low", () => chat("추출", "예제", schema))).text, "요약");
    await assert.rejects(chat("편집", "도식", schema, ["test"]), /429/);
  });
  assert.equal((await modelInfo()).name, model);
  assert.deepEqual(efforts, ["medium", "low", "medium"]);
  assert.equal(calls.filter((url) => url.includes("anthropic")).length, 3);
});
