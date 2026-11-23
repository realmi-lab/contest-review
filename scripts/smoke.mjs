// 회귀 점검: 서버를 임시 데이터 폴더·임시 포트로 띄우고 주요 화면 파일과 API를 한 바퀴 돌린다. 실제 데이터와 설정은 건드리지 않는다.
//   node scripts/smoke.mjs   (npm run smoke)
// 직접 접수 → 그림 올리기 → 글자 인식 → 캡처 삭제, MS Forms 응답 엑셀 → 작품 생성 → 첨부 자동 접수, 설정·내보내기 API를 본다.
// AI 키가 없어 요약·점검(유료)은 실행하지 않는다.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { readSheet, writeWorkbook } from "../src/intake/xlsx.mjs";

const project = fileURLToPath(new URL("../", import.meta.url));
const temp = await mkdtemp(path.join(os.tmpdir(), "smoke-"));
const home = path.join(temp, "home");
// 가짜 OneDrive(맥·윈도우 위치 모두): 회사 Forms 열 구조의 응답 1건과 그림 첨부 1개
const oneDrive = path.join(home, "Library", "CloudStorage", "OneDrive-회사");
const attachments = path.join(oneDrive, "Apps", "Microsoft Forms", "제안", "질문");
await mkdir(attachments, { recursive: true });
const slide = (text) => sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="600">
  <rect width="100%" height="100%" fill="white"/><text x="60" y="200" font-size="72" font-family="Arial">${text}</text></svg>`)).png().toBuffer();
await writeFile(path.join(attachments, "제안서_홍길동.png"), await slide("Budget 2,500,000 KRW"));
const workbook = path.join(oneDrive, "응답.xlsx");
await writeFile(workbook, writeWorkbook([{ name: "Form1", rows: [
  ["ID", "시작 시간", "완료 시간", "이메일", "이름", "성함", "소속", "아이디어 제목", "간략 설명", "첨부"],
  [1, "2026-11-23 09:00", "2026-11-23 09:10", "gildong@example.com", "홍길동", "홍길동", "운영팀", "공유 우산", "비 오는 날 우산 대여",
    "https://x.sharepoint.com/_layouts/15/Doc.aspx?sourcedoc=%7B1%7D&file=" + encodeURIComponent("제안서_홍길동.png") + "&action=default"],
] }]));

const port = 18000 + Math.floor(Math.random() * 700);
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ["server.mjs"], { cwd: project, stdio: ["ignore", "ignore", "inherit"], env: { ...process.env,
  HOME: home, USERPROFILE: home, APPDATA: path.join(home, "AppData"), OneDriveCommercial: oneDrive, REVIEW_NAS_MODE: "",
  REVIEW_PORT: String(port), REVIEW_DATA_DIR: path.join(temp, "data"), REVIEW_SITE_FILE: path.join(temp, "site.json") } });

const get = (route) => fetch(base + route);
const post = async (route, data) => {
  const res = await fetch(base + "/api/" + route, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};
const work = (id) => get("/api/work/" + id).then((r) => r.json());
// 글자 인식이 끝날 때까지 기다리고, 실패했으면 그 이유를 보여 준다
async function recognized(id, what) {
  const w = await until(what, 180, async () => {
    const x = await work(id);
    return x.captures.length && x.captures.every((c) => c.status !== "queued") && x;
  });
  for (const c of w.captures) assert.equal(c.status, "ready", `${c.label}: ${c.ocrError}`);
  return w;
}
// 조건이 될 때까지(최대 seconds초) 기다린다
async function until(what, seconds, check) {
  for (let i = 0; i < seconds * 2; i++) {
    const value = await check().catch(() => null);
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  assert.fail(what + " — 시간 안에 되지 않았습니다");
}
let passed = 0;
async function step(name, run) {
  try { await run(); passed++; console.log("  ✓ " + name); }
  catch (e) { failed.push(name); console.log("  ✗ " + name + "\n      " + String(e.message).split("\n")[0]); }
}
const failed = [];

try {
  await until("서버 시작", 30, () => get("/api/state").then((r) => r.ok));
  await step("화면 파일을 내려 주고, public 폴더 밖과 없는 경로는 막는다", async () => {
    const index = await get("/").then((r) => r.text());
    const linked = [...index.matchAll(/(?:src|href)="(\/[^"]+)"/g)].map((m) => m[1]);
    assert.ok(linked.length >= 2, "index.html이 화면 파일을 불러온다");
    for (const file of [...linked, "/fonts/BithumbGothic-Basic.woff2"]) assert.equal((await get(file)).status, 200, file);
    for (const bad of ["/../src/server.mjs", "/%2e%2e/src/server.mjs", "/..%2fpackage.json", "/nothing.js", "/api/nothing"])
      assert.equal((await get(bad)).status, 404, bad);
    // localhost가 아닌 주소로 온 요청(fetch는 Host를 바꿀 수 없어 http로 보낸다)
    const otherHost = await new Promise((resolve, reject) =>
      http.get(base + "/api/state", { headers: { host: "example.com" } }, (res) => resolve(res.resume().statusCode)).on("error", reject));
    assert.equal(otherHost, 403);
  });
  await step("상태에 빌드 번호와 AI 비용이 있다", async () => {
    const state = await get("/api/state").then((r) => r.json());
    assert.equal(state.app, "contest-review-desk");
    assert.match(state.build, /^(빌드|버전) /);
    assert.deepEqual(Object.keys(state.cost), ["today", "week"]);
  });
  let id, capture;
  await step("직접 접수하고 그림을 올리면 글자를 읽는다", async () => {
    id = (await post("create", { name: "회귀 점검 작품", receivedOn: "2026-11-23", intakeTeam: "QA", submitterName: "점검" })).body.id;
    assert.ok(id);
    const up = await post("upload", { id, document: "제안서", data: (await slide("Regression 12345")).toString("base64") });
    assert.equal(up.status, 201);
    [capture] = (await recognized(id, "글자 인식")).captures;
    assert.match(capture.lines.map((l) => l.text).join(" "), /12345/);
  });
  await step("캡처 그림과 작은 그림을 내려 준다", async () => {
    assert.equal((await get("/api/image/" + capture.id)).headers.get("content-type"), "image/png");
    assert.equal((await get(`/api/image/${capture.id}?size=thumb`)).headers.get("content-type"), "image/webp");
  });
  await step("원본 문서가 없는 캡처는 다시 캡처를 거절하고, 삭제는 된다", async () => {
    const w = await work(id);
    const again = await post("capture", { id, rev: w.rev, capture: capture.id, action: "recapture" });
    assert.equal(again.status, 400);
    assert.match(again.body.error, /원본 문서가 없어/);
    assert.equal((await post("capture", { id, rev: w.rev, capture: capture.id, action: "bogus" })).status, 400); // 모르는 동작은 거절
    assert.equal((await post("capture", { id, rev: w.rev, capture: capture.id, action: "remove" })).status, 200);
    assert.equal((await work(id)).captures.length, 0);
  });
  await step("캡처를 모두 지우고 새로 올릴 수 있다", async () => {
    for (const [page, text] of [[1, "Reset 1"], [2, "Reset 2"]])
      assert.equal((await post("upload", { id, document: "제안서", page, data: (await slide(text)).toString("base64") })).status, 201);
    const w = await recognized(id, "글자 인식");
    const reset = await post("reset-captures", { id, rev: w.rev });
    assert.equal(reset.status, 200, reset.body.error);
    assert.equal((await work(id)).captures.length, 0);
    assert.equal((await get("/api/image/" + w.captures[0].id)).status, 404);
    const again = await post("upload", { id, document: "새 제안서", data: (await slide("New 3")).toString("base64") });
    assert.equal(again.status, 201);
    await recognized(id, "새 캡처 글자 인식");
  });
  await step("AI 키가 없으면 요약을 시작하지 않는다", async () => {
    const w = await work(id);
    assert.equal((await post("summarize", { id, rev: w.rev })).status, 503);
  });
  await step("공모 연동 설정을 저장하면 응답을 읽어 작품을 만들고 첨부를 자동 접수한다", async () => {
    const saved = await post("forms-settings", { workbook, attachments });
    assert.equal(saved.status, 200, saved.body.error);
    const settings = await get("/api/forms-settings").then((r) => r.json());
    assert.equal(settings.check.workbook.text, "응답 1건을 읽었습니다.");
    const state = await get("/api/state").then((r) => r.json());
    const form = state.works.find((w) => w.formId === "1");
    assert.deepEqual([form.name, form.receivedOn, form.intakeTeam, form.submitterName], ["공유 우산", "2026-11-23", "운영팀", "홍길동"]);
    const ready = await recognized(form.id, "첨부 자동 접수와 글자 인식");
    assert.deepEqual(ready.source.read, { "제안서_홍길동.png": { pages: 1 } });
    assert.equal(ready.source.email, "gildong@example.com");
    assert.match(ready.captures[0].lines.map((l) => l.text).join(" "), /2,500,000/);
  });
  await step("접수 정보에서 제목·설명을 고치면 응답 엑셀의 그 칸도 고친다", async () => {
    const state = await get("/api/state").then((r) => r.json());
    const form = await work(state.works.find((w) => w.formId === "1").id);
    const edited = await post("intake", { id: form.id, intakeVersion: form.intakeVersion, name: "공유 우산 2호", description: "역마다 <우산> & 반납함" });
    assert.equal(edited.status, 200, edited.body.error);
    assert.equal(edited.body.inExcel, true);
    const rows = readSheet(await readFile(workbook));
    assert.deepEqual([rows[1][0], rows[1][6], rows[1][7], rows[1][8]], [1, "운영팀", "공유 우산 2호", "역마다 <우산> & 반납함"]);
    const after = await work(form.id);
    assert.deepEqual([after.name, after.source.description, after.intakeTeam], ["공유 우산 2호", "역마다 <우산> & 반납함", "운영팀"]);
  });
  await step("지금 가져오기를 다시 눌러도 작품과 캡처가 늘지 않는다", async () => {
    const before = await get("/api/state").then((r) => r.json());
    assert.equal((await post("intake-sync", {})).status, 200);
    const after = await get("/api/state").then((r) => r.json());
    assert.deepEqual(after.works.map((w) => [w.id, w.count]), before.works.map((w) => [w.id, w.count]));
  });
  await step("설정·사용량·내보내기 API가 응답한다", async () => {
    for (const route of ["/api/summary-settings", "/api/haiku-cost", "/api/export"]) assert.equal((await get(route)).status, 200, route);
  });
  await step("작품을 삭제한다", async () => {
    const w = await work(id);
    assert.equal((await post("remove-work", { id, rev: w.rev })).status, 200);
    assert.equal((await get("/api/work/" + id)).status, 404);
  });
} finally {
  server.kill();
  await rm(temp, { recursive: true, force: true });
}
console.log(failed.length ? `\n실패 ${failed.length}건: ${failed.join(" · ")}` : `\n회귀 점검 ${passed}건 모두 통과`);
process.exit(failed.length ? 1 : 0);
