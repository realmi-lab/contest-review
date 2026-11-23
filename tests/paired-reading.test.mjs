import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { collectEvidence, model } from "../model.mjs";
import { preservePairedTableValues, summarize } from "../reading.mjs";

test("표와 도식은 같은 쪽의 OCR·캡처만 함께 보내고, OCR 전용 결과는 다시 추출한다", async (t) => {
  const captures = ["그래프와 수요", "직원 휴게실 안내", "차트와 이용 시간"].map((text, i) => ({
    id: String(i), label: (i + 1) + "쪽", page: i + 1, total: 3, document: "자료",
    hash: String(i), lines: [{ text }],
  }));
  const work = { name: "검증", captures, complete: true };
  captures[0].lines = [{ text: "그래프와 수요 | 정기 | 비정기" }, { text: "예측치 | 18 | 25" }];
  captures[0].ocrInfo = { tables: [captures[0].lines.map(({ text }, i) => ({ text, indexes: [i] }))] };
  const seen = [];
  t.mock.method(globalThis, "fetch", async (url, opts) => {
    if (url.endsWith("/api/tags")) return Response.json({ models: [{ name: model, digest: "abc" }] });
    const { messages, format } = JSON.parse(opts.body);
    const msg = messages.at(-1);
    const ids = format.properties.context.items.properties.ref.enum;
    seen.push({ ids, text: msg.content, png: msg.images?.[0] });
    const answer = { points: [], context: ids.map((ref) => ({ ref, reason: "문서 제목·쪽번호" })) };
    return Response.json({ message: { content: JSON.stringify(answer) } });
  });
  const imageBytes = new Map();
  for (const [id, background] of [["0", "#123456"], ["2", "#abcdef"]]) {
    imageBytes.set(id, await sharp({ create: { width: 8, height: 8, channels: 3, background } }).png().toBuffer());
  }
  const imageFor = (id) => { assert.ok(imageBytes.has(id)); return imageBytes.get(id); };
  const run = (reading, image = imageFor) => summarize({ ...work, reading }, image, () => {});
  const result = await run();
  assert.deepEqual(seen.map((msg) => msg.ids), [["S1.1"], ["S2.1"], ["S3.1"]]);
  assert.deepEqual(seen.map((msg) => msg.png), [imageFor("0").toString("base64"), undefined, imageFor("2").toString("base64")]);
  assert.ok(seen.every((msg, i) => captures.every((c, j) => msg.text.includes(c.lines[0].text) === (i === j))));
  assert.ok(seen[0].text.includes('["정기","18"],["비정기","25"]'));
  assert.deepEqual(result.imageReading.pages.map((p) => [p.capture, p.withImage]), [["0", 1], ["2", 1]]);
  assert.equal((await run(result)).reusedExtraction, true);
  assert.equal(seen.length, 3);
  const legacy = { ...result, imageReading: undefined };
  const fallback = await run(legacy, (id) => id === "0" ? Buffer.from("bad png") : imageFor(id));
  assert.equal(fallback.reusedExtraction, false);
  assert.equal(fallback.imageReading.pages[0].withoutImage, 1);
  assert.ok(fallback.limits.some((line) => line.includes("OCR만 사용")));
  assert.equal((await run(fallback)).reusedExtraction, false);
  assert.equal(seen.length, 9);
  const disputed = { ...captures[0], ocrInfo: {}, lines: [{ text: "사용량 14", numericDispute: true }] };
  const { imagePages } = await collectEvidence([disputed], imageFor, () => {}, "layout", true);
  assert.ok(imagePages.get(disputed.id).noTrustedText);
  assert.equal((await collectEvidence(captures, imageFor, () => {}, "layout")).imagePages.size, 0);
});

test("편집에서 빠진 표의 항목·값만 확장 요약에 한 번 보존한다", () => {
  const reading = { lead: [{ refs: ["S1.3"] }], points: [] };
  const rows = new Map([["S1.3", [["S1.3", "정확도", [["가군", "0.85"], ["나군", "0.64"]]]]]]);
  const edition = { brief: [], detail: [] };
  const result = preservePairedTableValues(edition, rows, reading);
  assert.equal(result.detail[0].text, "정확도 · 가군 0.85, 나군 0.64.");
  assert.deepEqual(result.detail[0].refs, ["S1.3"]);
  assert.deepEqual(preservePairedTableValues(result, rows, reading), result);
  const inBrief = { brief: result.detail, detail: [] };
  assert.deepEqual(preservePairedTableValues(inBrief, rows, reading), inBrief);
  assert.deepEqual(preservePairedTableValues(edition, rows, { ...reading, visualChecks: [{ refs: ["S1.3"] }] }), edition);
});
