import { appDir } from "./app-dir.mjs";
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

// AI 연결은 요약 설정 화면에서 정한다(키·연결 주소·모델). 주소를 비우면 Anthropic API에 직접 붙고, 회사망처럼
// LiteLLM(Bedrock) 주소를 넣으면 그 프록시의 Anthropic 형식 엔드포인트(/v1/messages)로 보낸다. 모델은 기본 Haiku 5.5.
// plainJson: 프록시나 Bedrock이 구조화 출력·생각 깊이 옵션을 거절하면 자동으로 켜져 JSON만 요청한다.
export const DEFAULT_MODEL = "claude-haiku-5-5";
export function aiSettings(raw = {}) {
  const custom = String(raw.baseUrl ?? "").trim().replace(/\/+$/, "");
  if (custom && !/^https?:\/\/[^\s/]+/.test(custom)) throw Error("연결 주소는 http:// 또는 https://로 시작해야 합니다.");
  const model = String(raw.model ?? "").trim() || DEFAULT_MODEL;
  return {
    provider: custom ? "litellm" : "anthropic",
    name: custom ? "LiteLLM" : "Anthropic",
    baseUrl: custom || "https://api.anthropic.com",
    custom, // 화면에 보여 줄 연결 주소(비면 Anthropic 직접)
    model,
    label: model === DEFAULT_MODEL ? "Haiku 5.5" : model,
    plainJson: raw.plainJson === true,
  };
}
const settingsDir = appDir("ContestReviewDesk");
const connectionFile = join(settingsDir, "ai.json");
export const ai = aiSettings(await readFile(connectionFile, "utf8").then((text) => JSON.parse(text)).catch(() => ({}))); // 없거나 깨졌으면 기본값
export let haiku = ai.model;
// 생각 깊이(effort). 쪽마다 사실을 옮기는 추출은 low, 요점 선택·분류·편집·인용 검토 같은 판단은 medium.
// (전 단계 xhigh 실측: 묶음당 생각 토큰 1.5만~3.5만, 46쪽 문서 약 $0.6·1시간 → 추출에는 과함)
export const haikuEffort = "medium";
export const extractEffort = "low";
export let haikuLabel = ai.label;
export const haikuEffortNote = "추출 " + extractEffort + " · 판단 " + haikuEffort;
// max_tokens에 더하는 생각 토큰 여유(쓴 만큼만 과금). high는 생각이 길어 넉넉히 준다
// (실측: 16000으로는 문서 전체 논리 점검이 한도에 걸려 처음부터 다시 쓰느라 출력 8만 토큰·9분이 들었다).
const THINKING_ROOM = { low: 16000, medium: 16000, high: 40000 };
const MAX_OUTPUT = 64000;
const context = new AsyncLocalStorage();
export const withHaiku = (key, fn, recordUsage) => context.run({ key, recordUsage }, fn);
// Haiku 요청 안에서 일부 단계만 다른 생각 깊이로 보낸다. 로컬 모델이면 그대로 실행한다.
export const withEffort = (effort, fn) => {
  const store = context.getStore();
  return store ? context.run({ ...store, effort }, fn) : fn();
};
export const activeHaikuKey = () => context.getStore()?.key;
const settingsFile = join(settingsDir, "anthropic.key");

export async function savedKey() {
  try { return (await readFile(settingsFile, "utf8")).trim(); }
  catch (error) { if (error.code === "ENOENT") return ""; throw error; }
}

// 확인을 마친 연결 설정을 저장하고 바로 쓴다(서버 재시작 불필요).
export async function saveConnection(next) {
  Object.assign(ai, next);
  haiku = ai.model;
  haikuLabel = ai.label;
  await mkdir(settingsDir, { recursive: true, mode: 0o700 });
  await writeFile(connectionFile, JSON.stringify({ baseUrl: ai.custom, model: ai.model, plainJson: ai.plainJson }), { mode: 0o600 });
}

export async function saveKey(key) {
  await mkdir(dirname(settingsFile), { recursive: true, mode: 0o700 });
  const temporary = settingsFile + "." + randomBytes(12).toString("hex");
  await writeFile(temporary, key, { flag: "wx", mode: 0o600 });
  await rename(temporary, settingsFile);
}

export function matches(a, b) {
  const digest = (v) => createHash("sha256").update(v).digest();
  return !!a && !!b && timingSafeEqual(digest(a), digest(b));
}

function sign(key, purpose, payload) {
  return createHmac("sha256", key).update(purpose + ":" + payload).digest("hex");
}

export function ticket(key, purpose, seconds) {
  const payload = (Date.now() + seconds * 1000) + "." + randomBytes(16).toString("hex");
  return payload + "." + sign(key, purpose, payload);
}

export function validTicket(key, purpose, value) {
  const m = /^(\d{13})\.([a-f0-9]{32})\.([a-f0-9]{64})$/.exec(value || "");
  return !!key && !!m && Number(m[1]) > Date.now() && matches(m[3], sign(key, purpose, m[1] + "." + m[2]));
}

async function request(key, path, data, connection = ai) {
  let response;
  // LiteLLM은 Bearer 키를 쓴다. Anthropic 형식 엔드포인트는 x-api-key도 받으므로 둘 다 보낸다.
  const auth = connection.provider === "litellm" ? { authorization: "Bearer " + key, "x-api-key": key } : { "x-api-key": key };
  try {
    response = await fetch(connection.baseUrl + "/v1/" + path, {
      method: data ? "POST" : "GET", redirect: "error",
      headers: { ...auth, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: data ? JSON.stringify(data) : undefined,
      signal: AbortSignal.timeout(data ? 360000 : 15000),
    });
  } catch { throw Error(connection.name + " 서버에 연결하지 못했습니다. 연결 주소와 네트워크(회사망이면 프록시)를 확인하세요."); }
  if (!response.ok) {
    const messages = { 401: "API 키를 확인하세요.", 402: "API 크레딧을 확인하세요.", 403: "모델 사용 권한을 확인하세요.", 404: connection.label + " 모델을 사용할 수 없습니다.", 429: "사용 한도에 도달했습니다. 잠시 뒤 다시 실행하세요." };
    const detail = await response.json().catch(() => ({}));
    const reason = String(detail?.error?.message || detail?.detail || "");
    const note = /credit balance|billing/i.test(reason) ? messages[402] : messages[response.status];
    // 안내 문구가 없는 오류(주로 400)는 API가 알려 준 원인을 그대로 보여 준다.
    throw Object.assign(Error(connection.name + " " + response.status + " · " + (note || (reason || "요청 처리에 실패했습니다.").slice(0, 200))), { status: response.status });
  }
  return response.json();
}

// Anthropic이 직접 집계한 조직의 날짜별(UTC) 토큰 사용량. 앱이 추정한 비용을 실제 청구와 대조할 때 쓴다.
// Admin API라서 Admin 키나 워크스페이스에 묶이지 않은 키만 조회할 수 있고, 개인 계정 키로는 거절된다(error.status).
export async function usageReport(key, startingAt, endingAt) {
  if (ai.provider !== "anthropic") throw Error("LiteLLM 연결에서는 Anthropic 집계와 대조하지 않습니다. LiteLLM 사용량 화면에서 확인하세요.");
  const query = new URLSearchParams([["starting_at", startingAt], ["ending_at", endingAt], ["bucket_width", "1d"], ["group_by[]", "model"], ["limit", "31"]]);
  let response;
  try {
    response = await fetch("https://api.anthropic.com/v1/organizations/usage_report/messages?" + query, {
      redirect: "error", headers: { "x-api-key": key, "anthropic-version": "2026-10-21" }, signal: AbortSignal.timeout(15000),
    });
  } catch { throw Error("Anthropic 서버에 연결하지 못했습니다. 네트워크를 확인하세요."); }
  if (!response.ok) throw Object.assign(Error("Anthropic " + response.status), { status: response.status });
  return response.json();
}

// 저장하기 전에 키와 연결 설정이 맞는지 확인한다. LiteLLM은 모델 목록(/v1/models)에 그 모델이 있는지 본다.
export async function verifyKey(key, connection = ai) {
  if (connection.provider === "litellm") {
    const ids = ((await request(key, "models", undefined, connection)).data ?? []).map((m) => m.id);
    if (!ids.includes(connection.model)) throw Error(`LiteLLM에 '${connection.model}' 모델이 없습니다. 이 키로 쓸 수 있는 모델: ${ids.join(", ") || "없음"}`);
    return;
  }
  const result = await request(key, "models/" + connection.model, undefined, connection);
  if (result.id !== connection.model || [haikuEffort, extractEffort].some((e) => result.capabilities?.effort?.[e]?.supported === false))
    throw Error("이 키에서 " + connection.label + "를 사용할 수 없습니다.");
}

// Dynamic citation enums and length limits stay in the prompt. Stable structural
// schemas can be cached by the API across batches with different source IDs.
function structure(schema) {
  if (schema.type === "object") return {
    type: "object", additionalProperties: false, required: Object.keys(schema.properties),
    properties: Object.fromEntries(Object.entries(schema.properties).map(([k, v]) => [k, structure(v)])),
  };
  if (schema.type === "array") return { type: "array", items: structure(schema.items) };
  return { type: schema.type };
}

export async function haikuChat(key, system, prompt, schema, images, limit) {
  const content = (images || []).map((data) => ({ type: "image", source: { type: "base64", media_type: "image/png", data } }));
  content.push({ type: "text", text: prompt });
  const effort = context.getStore()?.effort || haikuEffort;
  const body = {
    model: haiku,
    ...(ai.plainJson ? {} : { thinking: { type: "adaptive" }, output_config: { effort, format: { type: "json_schema", schema: structure(schema) } } }),
    system: system + "\n응답은 다음 JSON 규격의 허용값과 범위를 따른다." + (ai.plainJson ? " JSON 하나만 출력한다." : "") + "\n" + JSON.stringify(schema),
    messages: [{ role: "user", content }],
  };
  const initial = Math.min(MAX_OUTPUT, Math.max(2048, Math.ceil(limit * 2)) + THINKING_ROOM[effort]);
  let reply;
  for (const maxTokens of new Set([initial, Math.min(MAX_OUTPUT, initial * 2)])) {
    const record = context.getStore()?.recordUsage;
    try {
      reply = await request(key, "messages", { ...body, max_tokens: maxTokens });
    } catch (error) {
      record?.(null);
      // LiteLLM·Bedrock이 구조화 출력·생각 깊이 옵션을 거절하면 JSON만 요청하는 방식으로 바꿔 다시 보낸다.
      if (ai.provider === "litellm" && !ai.plainJson && error.status === 400 && /output_config|thinking|effort|json_schema|format/i.test(error.message)) {
        await saveConnection({ plainJson: true });
        return haikuChat(key, system, prompt, schema, images, limit);
      }
      throw error;
    }
    // LiteLLM은 응답에 Bedrock 모델 ID를 돌려줄 수 있어 직접 연결일 때만 모델을 대조한다.
    const sameModel = ai.provider === "litellm" || reply.model === haiku;
    record?.(sameModel ? reply.usage : null);
    if (!sameModel) throw Error("요청한 Haiku 모델과 응답 모델이 다릅니다.");
    if (reply.stop_reason !== "max_tokens") break;
  }
  if (reply.stop_reason === "max_tokens") throw Error("Haiku 응답이 길어 중단되었습니다. 해당 단계의 출력 한도를 두 번 모두 소진했습니다.");
  if (reply.stop_reason !== "end_turn") throw Error("Haiku가 요약을 완료하지 못했습니다.");
  const text = reply.content.filter((p) => p.type === "text").map((p) => p.text).join("").trim();
  try { return JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, "")); } // plainJson이면 코드 블록으로 감쌀 수 있다
  catch { throw Error("Haiku가 요약 양식에 맞게 응답하지 못했습니다."); }
}
