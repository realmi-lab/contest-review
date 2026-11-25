import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

// 실제 데이터 폴더·설정을 건드리지 않게 임시 폴더를 쓴다. Slack CLI 대신 가짜 slack 명령을 쓴다:
// 받은 인자를 calls.log에 적고, --datastore 이름의 내용(store-<이름>.jsonl)을 --to-file에 쓴다.
const temp = mkdtempSync(path.join(os.tmpdir(), "slack-test-"));
const cli = path.join(temp, "slack");
writeFileSync(cli, `#!/usr/bin/env node
const fs = require("node:fs"), path = require("node:path"), a = process.argv.slice(2), dir = ${JSON.stringify(temp)};
fs.appendFileSync(path.join(dir, "calls.log"), JSON.stringify(a) + "\\n");
const store = path.join(dir, "store-" + a[a.indexOf("--datastore") + 1] + ".jsonl");
if (fs.existsSync(store)) fs.copyFileSync(store, a[a.indexOf("--to-file") + 1]);
`);
chmodSync(cli, 0o755);
const setStore = (name, items) => writeFileSync(path.join(temp, `store-${name}.jsonl`), items.map((x) => JSON.stringify(x)).join("\n"));
const cliCalls = () => readFileSync(path.join(temp, "calls.log"), "utf8").trim().split("\n").map((l) => JSON.parse(l));

process.env.REVIEW_DATA_DIR = temp;
process.env.REVIEW_SITE_FILE = path.join(temp, "site.json");
writeFileSync(process.env.REVIEW_SITE_FILE, JSON.stringify({ slack: { reviewWebhook: "https://hooks.slack.com/triggers/T1/1/hook", reviewApp: "A1", cli } }));
const { collectReplies, sendHtml, slackPeople, slackReady } = await import("../src/slack.mjs");
const { load, newWork, save } = await import("../src/store.mjs");

test("담당자 검색은 앱 저장소의 사람 목록(쪽마다 JSON)을 CLI로 읽어 이름·직함으로 찾고, 10분 동안 기억한다", async () => {
  assert.equal(slackReady(), true);
  setStore("people", [
    { id: "1", list: JSON.stringify([{ id: "U2", name: "이영희", nick: "", title: "보안팀" }]) },
    { id: "0", list: JSON.stringify([{ id: "U1", name: "김철수", nick: "철수", title: "" }]) },
  ]);
  assert.deepEqual((await slackPeople("")).map((p) => p.id), ["U1", "U2"]);
  assert.deepEqual((await slackPeople("보안")).map((p) => p.name), ["이영희"]);
  const calls = cliCalls();
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].slice(0, 7), ["datastore", "query", "{}", "--datastore", "people", "--app", "A1"]);
});

test("보내기는 HTML을 평가 단추 앱 웹훅에 실어 보낸다(봇 토큰을 쓰지 않는다)", async () => {
  const before = globalThis.fetch, sent = [];
  globalThis.fetch = async (url, { body }) => (sent.push([url, JSON.parse(body)]), { ok: true, status: 200 });
  await sendHtml("U1", { workId: "W1", title: "작품", filename: "작품.html", html: "<p>안녕</p>", comment: "*작품*", ticket: "t-1" });
  globalThis.fetch = before;
  assert.deepEqual(sent, [["https://hooks.slack.com/triggers/T1/1/hook", { user_id: "U1", work_id: "W1", title: "작품", filename: "작품.html", comment: "*작품*", html: "<p>안녕</p>", ticket: "t-1" }]]);
});

test("받은 의견은 앱 저장소에서 읽어 최근에 보낸 작품에만 담고, 다시 읽어도 늘지 않는다", async () => {
  const at = new Date(Date.now() - 60_000).toISOString();
  const first = newWork("첫 작품"), second = newWork("둘째 작품");
  first.slackSent = [{ user: "U1", name: "김철수", at }];
  save(first);
  setStore("reviews", [
    { id: "r2", work_id: second.id, user_id: "U2", text: "보낸 적 없는 작품", at },
    { id: "r1", work_id: first.id, user_id: "U1", text: "첫째 좋아요", at },
  ]);
  await collectReplies();
  await collectReplies();
  assert.deepEqual(load(first.id).slackReplies.map((r) => [r.name, r.text]), [["김철수", "첫째 좋아요"]]);
  assert.equal(load(second.id).slackReplies, undefined);
  setStore("reviews", [{ id: "r1", work_id: first.id, user_id: "U1", text: "고쳤어요", at: new Date().toISOString() }]); // [답변 수정하기]
  await collectReplies();
  assert.deepEqual(load(first.id).slackReplies.map((r) => r.text), ["고쳤어요"]);
  const query = JSON.parse(cliCalls().at(-1)[2]);
  assert.equal(query.expression, "#at > :since"); // 최근 30일 것만 읽는다
});

test("slack.com에 닿지 못하면 원인 코드와 짐작되는 까닭을 함께 알린다", async () => {
  const before = globalThis.fetch;
  globalThis.fetch = async () => { throw Object.assign(new TypeError("fetch failed"), { cause: { code: "SELF_SIGNED_CERT_IN_CHAIN" } }); };
  await assert.rejects(sendHtml("U1", { workId: "W", title: "a", filename: "a.html", html: "a", comment: "" }), /SELF_SIGNED_CERT_IN_CHAIN · 회사 보안 장비의 인증서/);
  globalThis.fetch = before;
});
