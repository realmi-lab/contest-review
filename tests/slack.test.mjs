import assert from "node:assert/strict";
import { test } from "node:test";

process.env.SLACK_BOT_TOKEN = "xoxb-test";
const { sendHtml, slackPeople } = await import("../src/slack.mjs");

const calls = [];
globalThis.fetch = async (url, { body, headers }) => {
  const method = url.split("/").pop();
  calls.push([method, body instanceof URLSearchParams ? Object.fromEntries(body) : body.length, headers?.Authorization]);
  const reply = {
    "users.list": body?.get?.("cursor")
      ? { ok: true, members: [{ id: "U2", profile: { real_name: "이영희", title: "보안팀" } }] }
      : { ok: true, members: [{ id: "U1", profile: { real_name: "김철수", display_name: "철수" } }, { id: "B1", is_bot: true, name: "봇" }, { id: "U3", deleted: true, name: "퇴사자" }], response_metadata: { next_cursor: "next" } },
    "conversations.open": { ok: true, channel: { id: "D9" } },
    "files.getUploadURLExternal": { ok: true, upload_url: "https://files.slack.com/upload/abc", file_id: "F1" },
    abc: { ok: true },
    "files.completeUploadExternal": { ok: true },
  }[method];
  return { ok: true, status: 200, json: async () => reply };
};

test("담당자 검색은 쪽을 넘겨 다 모으고, 나간 사람·봇은 빼며, 이름·직함으로 찾는다", async () => {
  assert.deepEqual((await slackPeople("")).map((p) => p.id), ["U1", "U2"]);
  assert.deepEqual((await slackPeople("보안")).map((p) => p.name), ["이영희"]);
  assert.equal(calls.filter(([m]) => m === "users.list").length, 2); // 두 번째 검색은 기억해 둔 목록을 쓴다
  assert.equal(calls[0][2], "Bearer xoxb-test");
});

test("보내기는 DM을 열고, 파일 올릴 주소에 HTML을 올린 뒤, 그 DM에 메시지와 함께 붙인다", async () => {
  calls.length = 0;
  await sendHtml("U1", { filename: "작품.html", html: "<p>안녕</p>", comment: "*작품*" });
  assert.deepEqual(calls.map(([m]) => m), ["conversations.open", "files.getUploadURLExternal", "abc", "files.completeUploadExternal"]);
  assert.equal(calls[1][1].length, String(Buffer.byteLength("<p>안녕</p>")));
  assert.deepEqual(calls[3][1], { files: JSON.stringify([{ id: "F1", title: "작품.html" }]), channel_id: "D9", initial_comment: "*작품*" });
});
