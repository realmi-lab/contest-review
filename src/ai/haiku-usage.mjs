// Standard Messages API rates, USD per million tokens, verified 2026-11-20.
// https://platform.claude.com/docs/en/models/haiku-5-5/overview
export function newHaikuUsage(runId) {
  return { runId, rateDate: "2026-11-20", requests: 0, measured: 0, inputTokens: 0,
    outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0, estimatedUsd: 0 };
}

const count = (n) => Number.isSafeInteger(n) && n >= 0;

function requestPrice(u, inputTotal) {
  const write = u.cache_creation_input_tokens;
  const five = u.cache_creation?.ephemeral_5m_input_tokens;
  const hour = u.cache_creation?.ephemeral_1h_input_tokens;
  if (write && (!count(five) || !count(hour) || five + hour !== write)) return null;
  if (u.service_tier && u.service_tier !== "standard") return null;
  if (u.speed && u.speed !== "standard") return null;
  if (u.inference_geo && !["global", "us"].includes(u.inference_geo)) return null;
  const amount = 0.10 * u.input_tokens + 0.50 * u.output_tokens + 0.01 * u.cache_read_input_tokens
    + (write ? 0.125 * five + 0.20 * hour : 0);
  const promptRate = inputTotal > 100_000 ? 5 : 1;
  const geoRate = u.inference_geo === "us" ? 1.1 : 1;
  return amount * promptRate * geoRate / 1_000_000;
}

export function recordHaikuUsage(total, u) {
  total.requests++;
  if (!u || ![u.input_tokens, u.output_tokens, u.cache_read_input_tokens, u.cache_creation_input_tokens].every(count)) return;
  const inputTotal = u.input_tokens + u.cache_creation_input_tokens + u.cache_read_input_tokens;
  total.measured++;
  total.inputTokens += u.input_tokens;
  total.outputTokens += u.output_tokens;
  total.cacheWriteTokens += u.cache_creation_input_tokens;
  total.cacheReadTokens += u.cache_read_input_tokens;
  total.totalTokens += inputTotal + u.output_tokens;
  const price = requestPrice(u, inputTotal);
  total.estimatedUsd = price === null || total.estimatedUsd === null ? null
    : Number((total.estimatedUsd + price).toFixed(12));
}

export function usageSnapshot(total, complete = false) {
  if (total.measured || (complete && total.requests === 0)) return { ...total };
  return { ...total, inputTokens: null, outputTokens: null, cacheReadTokens: null,
    cacheWriteTokens: null, totalTokens: null, estimatedUsd: null };
}

/* ── 실제 청구와 대조 ──
   앱은 응답마다 받은 사용량으로 비용을 추정한다. 이를 확인하려고 실행 기록을 날짜별로 더하고(dailyUsage),
   Anthropic이 직접 집계한 날짜별 토큰(usage_report)과 나란히 놓는다(reportedUsage). 둘 다 UTC 날짜 기준이다. */
const TOKEN_KINDS = ["inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens"];
const sumTokens = (d) => TOKEN_KINDS.reduce((n, k) => n + d[k], 0);

// entries: [{ at: 실행 시작 시각(ISO), usage: usageSnapshot }] → 날짜순 [{ day, runs, requests, measured, …토큰, totalTokens, estimatedUsd }]
export function dailyUsage(entries) {
  const days = new Map();
  for (const { at, usage: u } of entries) {
    const day = at.slice(0, 10);
    if (!days.has(day)) days.set(day, { day, runs: 0, requests: 0, measured: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, estimatedUsd: 0 });
    const d = days.get(day);
    d.runs++;
    d.requests += u.requests;
    d.measured += u.measured;
    for (const k of TOKEN_KINDS) d[k] += u[k] || 0;
    // 사용량은 받았는데 단가를 정하지 못한 실행이 하나라도 있으면 그날 비용은 확정하지 않는다.
    if (u.measured && u.estimatedUsd === null) d.estimatedUsd = null;
    else if (d.estimatedUsd !== null) d.estimatedUsd = Number((d.estimatedUsd + (u.estimatedUsd || 0)).toFixed(12));
  }
  return [...days.values()].map((d) => ({ ...d, totalTokens: sumTokens(d) })).sort((a, b) => a.day.localeCompare(b.day));
}

// Anthropic 사용량 보고서에서 한 모델의 날짜별 토큰을 꺼낸다. usd는 기본 단가(프롬프트 10만 토큰 이하)로 계산한 값이다.
export function reportedUsage(report, model) {
  const days = {};
  for (const bucket of report?.data || []) {
    const d = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, usd: 0 };
    for (const r of (bucket.results || []).filter((r) => r.model === model)) {
      const five = r.cache_creation?.ephemeral_5m_input_tokens || 0, hour = r.cache_creation?.ephemeral_1h_input_tokens || 0;
      d.inputTokens += r.uncached_input_tokens || 0;
      d.outputTokens += r.output_tokens || 0;
      d.cacheReadTokens += r.cache_read_input_tokens || 0;
      d.cacheWriteTokens += five + hour;
      d.usd += (0.10 * (r.uncached_input_tokens || 0) + 0.50 * (r.output_tokens || 0) + 0.01 * (r.cache_read_input_tokens || 0) + 0.125 * five + 0.20 * hour) / 1_000_000;
    }
    days[String(bucket.starting_at).slice(0, 10)] = { ...d, totalTokens: sumTokens(d), usd: Number(d.usd.toFixed(6)) };
  }
  return days;
}
