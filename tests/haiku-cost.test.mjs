import test from "node:test";
import assert from "node:assert/strict";
import { dailyUsage, newHaikuUsage, recordHaikuUsage, reportedUsage, usageSnapshot } from "../haiku-usage.mjs";

const run = (at, ...responses) => {
  const usage = newHaikuUsage(at);
  for (const r of responses) recordHaikuUsage(usage, r);
  return { at, usage: usageSnapshot(usage, true) };
};
const tokens = (input, output, read = 0) => ({ input_tokens: input, output_tokens: output, cache_read_input_tokens: read, cache_creation_input_tokens: 0 });

test("실행 기록을 UTC 날짜별로 더하고, 사용량을 못 받은 요청은 따로 센다", () => {
  const days = dailyUsage([
    run("2026-11-21T00:10:00.000Z", tokens(80_000, 0, 10_000), null), // 두 번째 요청은 응답을 받지 못함
    run("2026-11-20T23:50:00.000Z", tokens(50_000, 10_000)),
    run("2026-11-21T03:00:00.000Z", tokens(0, 20_000)),
    run("2026-11-22T01:00:00.000Z", tokens(200_000, 10_000)), // 프롬프트 10만 토큰 초과: 단가 5배
  ]);
  assert.deepEqual(days.map((d) => [d.day, d.runs, d.requests, d.measured, d.totalTokens, d.estimatedUsd]), [
    ["2026-11-20", 1, 1, 1, 60_000, 0.01],
    ["2026-11-21", 2, 3, 2, 110_000, 0.0181],
    ["2026-11-22", 1, 1, 1, 210_000, 0.125],
  ]);
});

test("Anthropic 사용량 보고서에서 한 모델의 날짜별 토큰과 기본 단가 비용을 꺼낸다", () => {
  const report = { data: [{ starting_at: "2026-11-21T00:00:00Z", results: [
    { model: "claude-haiku-5-5", uncached_input_tokens: 1_000_000, output_tokens: 200_000, cache_read_input_tokens: 500_000,
      cache_creation: { ephemeral_5m_input_tokens: 100_000, ephemeral_1h_input_tokens: 0 } },
    { model: "claude-opus-5-5", uncached_input_tokens: 9, output_tokens: 9 },
  ] }] };
  assert.deepEqual(reportedUsage(report, "claude-haiku-5-5"), { "2026-11-21": {
    inputTokens: 1_000_000, outputTokens: 200_000, cacheReadTokens: 500_000, cacheWriteTokens: 100_000, totalTokens: 1_800_000, usd: 0.2175 } });
  assert.deepEqual(reportedUsage(null, "claude-haiku-5-5"), {});
});
