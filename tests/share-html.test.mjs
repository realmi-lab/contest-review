import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import sharp from "sharp";

// 실제 데이터 폴더를 건드리지 않게 임시 폴더를 쓴다
process.env.REVIEW_DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "share-test-"));
const { insertImage, newWork, save } = await import("../src/store.mjs");
const { shareHtml } = await import("../src/review/share-html.mjs");

test("내보내기 HTML은 AI 요약 · AI 논리점검 · 캡처 자료 순서이고, 세부 요약 줄 끝 쪽 칩에 띄울 캡처와 인용 줄 상자(%)를 싣는다", async () => {
  const w = newWork("공유 우산");
  const png = await sharp({ create: { width: 200, height: 100, channels: 3, background: "#fff" } }).png().toBuffer();
  const c = { id: "c1", document: "제안서", page: 2, total: 2, label: "제안서 2쪽", lines: [{ text: "우산을 빌린다", box: { x: 20, y: 10, w: 100, h: 20 } }],
    status: "done", width: 200, height: 100, ocrWidth: 200, ocrHeight: 100 };
  w.captures = [c];
  insertImage(c.id, w.id, png);
  w.cloudReading = { id: "r1", rev: w.rev, evidence: { "S2.1": { capture: c.id, label: c.label, text: "우산을 빌린다", indexes: [0] } },
    edition: { brief: [{ topic: "한 줄 요약", text: "우산을 빌려 쓰는 제안.", refs: [] }], detail: [{ topic: "어떻게 푸는가", text: "역에서 우산을 빌린다.", refs: ["S2.1"] }] } };
  save(w);
  const html = await shareHtml(w);
  assert.match(html, /<label for="tab-1">AI 요약<\/label><label for="tab-2">AI 논리점검<\/label><label for="tab-3">캡처 자료 · 1쪽<\/label>/);
  assert.match(html, /<figure id="cap-c1"><img src="data:image\/jpeg;base64,/);
  // 2쪽 칩: 띄울 그림(cap-c1)과 인용 줄 상자(왼쪽 10%, 위 10%, 너비 50%, 높이 20%, 기울기 0)
  assert.match(html, /<button type="button" class="ref" data-cap="cap-c1" data-boxes="\[\[10,10,50,20,0\]\]">2쪽<\/button>/);
  assert.equal(html.match(/class="ref"/g).length, 1); // 핵심 요약 줄에는 칩을 붙이지 않는다
  assert.doesNotMatch(html, /id="reply"/); // 앱의 내보내기에는 의견 칸이 없다
  // Slack으로 보낼 때는 받는 사람과 HTML 의견 받기 웹훅을 담은 [의견 보내기] 칸을 넣는다
  const sent = await shareHtml(w, { reply: { url: "https://hooks.slack.com/triggers/T1/2/html", user: "U1" } });
  assert.match(sent, /<section id="reply" class="reply" data-url="https:\/\/hooks.slack.com\/triggers\/T1\/2\/html" data-work="[^"]+" data-user="U1" data-title="공유 우산">/);
});
