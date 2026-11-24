import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

// 실제 데이터 폴더·설정을 건드리지 않게 임시 폴더를 쓴다
const temp = mkdtempSync(path.join(os.tmpdir(), "slack-test-"));
process.env.SLACK_BOT_TOKEN = "xoxb-test";
process.env.REVIEW_DATA_DIR = temp;
process.env.REVIEW_SITE_FILE = path.join(temp, "site.json");
writeFileSync(process.env.REVIEW_SITE_FILE, JSON.stringify({ slack: { reviewWebhook: "https://hooks.slack.com/triggers/T1/1/hook" } }));
const { collectReplies, sendHtml, slackPeople } = await import("../src/slack.mjs");
const { load, newWork, save } = await import("../src/store.mjs");

const calls = [];
let replies = {};
globalThis.fetch = async (url, { body, headers }) => {
  const method = url.split("/").pop();
  const params = body instanceof URLSearchParams ? Object.fromEntries(body) : typeof body === "string" ? JSON.parse(body) : body.length;
  calls.push([method, params, headers?.Authorization]);
  const reply = {
    "users.list": params.cursor
      ? { ok: true, members: [{ id: "U2", profile: { real_name: "이영희", title: "보안팀" } }] }
      : { ok: true, members: [{ id: "U1", profile: { real_name: "김철수", display_name: "철수" } }, { id: "B1", is_bot: true, name: "봇" }, { id: "U3", deleted: true, name: "퇴사자" }], response_metadata: { next_cursor: "next" } },
    "conversations.open": { ok: true, channel: { id: "G9" } },
    hook: { ok: true },
    ...replies,
  }[method];
  return { ok: true, status: 200, json: async () => reply };
};

test("담당자 검색은 쪽을 넘겨 다 모으고, 나간 사람·봇은 빼며, 이름·직함으로 찾는다", async () => {
  assert.deepEqual((await slackPeople("")).map((p) => p.id), ["U1", "U2"]);
  assert.deepEqual((await slackPeople("보안")).map((p) => p.name), ["이영희"]);
  assert.equal(calls.filter(([m]) => m === "users.list").length, 2); // 두 번째 검색은 기억해 둔 목록을 쓴다
  assert.equal(calls[0][2], "Bearer xoxb-test");
});

test("보내기는 의견 자리(이 봇의 DM)만 열고, HTML은 평가 단추 앱 웹훅에 실어 보낸다", async () => {
  calls.length = 0;
  const sent = await sendHtml("U1", { workId: "W1", title: "작품", filename: "작품.html", html: "<p>안녕</p>", comment: "*작품*" });
  assert.deepEqual(calls.map(([m]) => m), ["conversations.open", "hook"]);
  assert.equal(calls[0][1].users, "U1");
  assert.deepEqual(calls[1][1], { user_id: "U1", work_id: "W1", title: "작품", reply_channel: "G9", filename: "작품.html", comment: "*작품*", html: "<p>안녕</p>" });
  assert.deepEqual(sent, { channel: "G9" });
});

test("평가 단추 앱이 남긴 의견 메시지만 그 작품에 담고(사람이 그냥 쓴 글은 받지 않음), 다시 읽어도 늘지 않는다", async () => {
  const at = new Date(Date.now() - 60_000).toISOString();
  const first = newWork("첫 작품"), second = newWork("둘째 작품");
  first.slackSent = [{ user: "U1", name: "김철수", at, channel: "G9" }];
  second.slackSent = [{ user: "U1", name: "김철수", at, channel: "G9" }];
  save(first);
  save(second);
  const review = (ts, work, text) => ({ ts, bot_id: "B2", blocks: [{ block_id: `review|${work}|U1`, text: { text: "✅" } }, { text: { type: "plain_text", text } }] });
  replies = { "conversations.history": { ok: true, messages: [
    review("1900000002.000001", second.id, "둘째는 근거가 약해요"),
    { ts: "1900000001.500000", user: "U1", text: "그냥 쓴 글" },
    review("1900000001.000001", first.id, "첫째 좋아요"),
  ] } };
  calls.length = 0;
  await collectReplies();
  await collectReplies();
  assert.equal(calls.filter(([m]) => m === "conversations.history").length, 2); // 같은 그룹 DM은 한 번에 읽는다
  assert.deepEqual(load(first.id).slackReplies.map((r) => [r.name, r.text]), [["김철수", "첫째 좋아요"]]);
  assert.deepEqual(load(second.id).slackReplies.map((r) => r.text), ["둘째는 근거가 약해요"]);
  assert.equal(load(first.id).slackSent[0].seen, "1900000002.000001"); // 다음에는 여기부터 읽는다
});

test("slack.com에 닿지 못하면 원인 코드와 짐작되는 까닭을 함께 알린다", async () => {
  const before = globalThis.fetch;
  globalThis.fetch = async () => { throw Object.assign(new TypeError("fetch failed"), { cause: { code: "SELF_SIGNED_CERT_IN_CHAIN" } }); };
  await assert.rejects(slackPeople("x").then(() => sendHtml("U1", { workId: "W", title: "a", filename: "a.html", html: "a", comment: "" })), /SELF_SIGNED_CERT_IN_CHAIN · 회사 보안 장비의 인증서/);
  globalThis.fetch = before;
});
