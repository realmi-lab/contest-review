import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.SLACK_BOT_TOKEN = "xoxb-test";
process.env.REVIEW_DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "slack-test-")); // 실제 데이터 폴더를 건드리지 않게
const { collectReplies, sendHtml, slackPeople } = await import("../src/slack.mjs");
const { load, newWork, save } = await import("../src/store.mjs");

const calls = [];
let replies = {};
globalThis.fetch = async (url, { body, headers }) => {
  const method = url.split("/").pop();
  const params = body instanceof URLSearchParams ? Object.fromEntries(body) : body.length;
  calls.push([method, params, headers?.Authorization]);
  const reply = {
    "users.list": params.cursor
      ? { ok: true, members: [{ id: "U2", profile: { real_name: "이영희", title: "보안팀" } }] }
      : { ok: true, members: [{ id: "U1", profile: { real_name: "김철수", display_name: "철수" } }, { id: "B1", is_bot: true, name: "봇" }, { id: "U3", deleted: true, name: "퇴사자" }], response_metadata: { next_cursor: "next" } },
    "conversations.open": { ok: true, channel: { id: "D9" } },
    "files.getUploadURLExternal": { ok: true, upload_url: "https://files.slack.com/upload/abc", file_id: "F1" },
    abc: { ok: true },
    "files.completeUploadExternal": { ok: true },
    "chat.postMessage": { ok: true, ts: "100.000001" },
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

test("보내기는 DM을 열고, HTML을 올려 붙인 뒤, 의견 요청 메시지를 보내고 그 자리를 돌려준다", async () => {
  calls.length = 0;
  const at = await sendHtml("U1", { filename: "작품.html", html: "<p>안녕</p>", comment: "*작품*" });
  assert.deepEqual(calls.map(([m]) => m), ["conversations.open", "files.getUploadURLExternal", "abc", "files.completeUploadExternal", "chat.postMessage"]);
  assert.equal(calls[1][1].length, String(Buffer.byteLength("<p>안녕</p>")));
  assert.deepEqual(calls[3][1], { files: JSON.stringify([{ id: "F1", title: "작품.html" }]), channel_id: "D9", initial_comment: "*작품*" });
  assert.deepEqual(at, { channel: "D9", ts: "100.000001" });
});

test("DM 답장은 그보다 먼저 보낸 가장 최근 작품에, 스레드 답글은 그 작품에 담고, 다시 읽어도 늘지 않는다", async () => {
  const at = new Date().toISOString();
  const first = newWork("첫 작품"), second = newWork("둘째 작품");
  first.slackSent = [{ user: "U1", name: "김철수", at, channel: "D9", ts: "100.000001" }];
  second.slackSent = [{ user: "U1", name: "김철수", at, channel: "D9", ts: "200.000001" }];
  save(first);
  save(second);
  replies = {
    "conversations.history": { ok: true, messages: [
      { ts: "300.1", user: "U1", text: "둘째는 좋아요" },
      { ts: "200.000001", bot_id: "B", text: "의견 요청", reply_count: 1 },
      { ts: "150.1", user: "U1", text: "첫째는 근거가 약해요" },
      { ts: "100.000001", bot_id: "B", text: "의견 요청" },
    ] },
    "conversations.replies": { ok: true, messages: [{ ts: "200.000001", bot_id: "B" }, { ts: "310.1", user: "U1", text: "둘째 추가 의견", thread_ts: "200.000001" }] },
  };
  await collectReplies();
  await collectReplies();
  assert.deepEqual(load(first.id).slackReplies.map((r) => r.text), ["첫째는 근거가 약해요"]);
  assert.deepEqual(load(second.id).slackReplies.map((r) => [r.name, r.text]), [["김철수", "둘째는 좋아요"], ["김철수", "둘째 추가 의견"]]);
  assert.equal(load(first.id).slackSent[0].seen, "310.1"); // 다음에는 여기부터 읽는다
});

test("slack.com에 닿지 못하면 원인 코드와 짐작되는 까닭을 함께 알린다", async () => {
  const before = globalThis.fetch;
  globalThis.fetch = async () => { throw Object.assign(new TypeError("fetch failed"), { cause: { code: "SELF_SIGNED_CERT_IN_CHAIN" } }); };
  await assert.rejects(sendHtml("U1", { filename: "a.html", html: "a", comment: "" }), /SELF_SIGNED_CERT_IN_CHAIN · 회사 보안 장비의 인증서/);
  globalThis.fetch = before;
});
