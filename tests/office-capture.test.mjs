// Office 문서 캡처 흐름(attachment-pages.mjs)을 가짜 Office로 확인한다.
// osascript·open·screencapture를 흉내 내는 작은 프로그램을 PATH 앞에 두고, 앱을 열고 쪽을 넘기며 창을 캡처한 뒤
// 문서를 닫고 앱을 끄는 순서를 본다. 실제 Office의 AppleScript 동작은 회사 맥에서 확인해야 한다.
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const skip = process.platform === "win32" && "가짜 도구가 셸 스크립트라 윈도우에서는 건너뛴다";
const dir = mkdtempSync(path.join(os.tmpdir(), "fake-office-"));
const state = path.join(dir, "state.json");
// 세 도구 모두 이 한 프로그램을 쓴다. 상태(열린 문서·슬라이드 쇼·지금 쪽·호출 기록)는 state.json에 둔다.
const fake = `#!/usr/bin/env node
const fs = require("fs"), path = require("path");
const file = ${JSON.stringify(state)};
const s = JSON.parse(fs.readFileSync(file, "utf8"));
const tool = path.basename(process.argv[1]), args = process.argv.slice(2);
const done = (out = "", code = 0) => { fs.writeFileSync(file, JSON.stringify(s)); if (out) console.log(out); process.exit(code); };
if (tool === "open") done();
if (tool === "screencapture") {
  s.log.push("capture " + args.find((a) => a.startsWith("-l")));
  fs.writeFileSync(args.at(-1), "page " + Math.min(s.page, s.lastScreen)); // 마지막 화면 뒤로는 같은 화면
  done();
}
const script = args[args.indexOf("-e") + 1], i = Number(args.at(-1));
if (script.includes("CGWindowList")) done(JSON.stringify([{ id: 10, area: 900 }, ...(s.show ? [{ id: 20, area: 400 }] : [])]));
if (script.includes("save as PNG")) {
  if (!s.export) done("", 1); // 보호 문서는 내보내기가 막힌다
  const target = args.at(-1);
  fs.mkdirSync(target, { recursive: true });
  for (let n = 1; n <= s.pages; n++) fs.writeFileSync(path.join(target, "Slide" + n + ".png"), "slide " + n);
  done();
}
if (script.includes("contains n then return")) done("yes");
if (script.includes("run slide show")) { s.show = true; s.page = 1; }
if (script.includes("exit slide show")) s.show = false;
if (/close (presentation|document|workbook) n/.test(script)) s.log.push("close");
if (script.includes("then quit")) s.log.push("quit");
if (/count of (slides|worksheets)|compute statistics/.test(script)) done(String(s.pages));
if (script.includes("go to next slide")) { if (i > 1) s.page += 1; if (s.page > s.pages) done("", 1); }
if (/activate object worksheet|goto absolute count/.test(script)) { if (i > s.pages) done("", 1); s.page = i; }
done();
`;
for (const tool of ["osascript", "open", "screencapture"]) {
  writeFileSync(path.join(dir, tool), fake);
  chmodSync(path.join(dir, tool), 0o755);
}
process.env.PATH = dir + path.delimiter + process.env.PATH;
process.env.HOME = dir; // PowerPoint 내보내기 폴더(~/Library/Group Containers/…)를 임시 폴더에 만든다
const { attachmentPages } = await import("../src/intake/attachment-pages.mjs");

// 가짜 Office 상태를 정하고 문서 하나를 캡처한다
async function run(name, office, only) {
  writeFileSync(state, JSON.stringify({ export: false, show: false, page: 1, pages: 3, lastScreen: 99, log: [], ...office }));
  Object.defineProperty(process, "platform", { value: "darwin", configurable: true });
  try {
    const pages = await attachmentPages(path.join(dir, name), only);
    return { pages: pages.map(String), log: JSON.parse(readFileSync(state, "utf8")).log };
  } finally {
    Object.defineProperty(process, "platform", { value: os.platform(), configurable: true });
  }
}

test("PowerPoint: 슬라이드를 내보낼 수 있으면 화면 캡처 없이 쓰고 문서를 닫은 뒤 앱을 끈다", { skip }, async () => {
  const { pages, log } = await run("발표.pptx", { export: true });
  assert.deepEqual(pages, ["slide 1", "slide 2", "slide 3"]);
  assert.deepEqual(log, ["close", "quit"]);
});

test("PowerPoint: 보호 문서라 내보내기가 막히면 창 모드 슬라이드 쇼의 새 창을 한 장씩 캡처한다", { skip }, async () => {
  const { pages, log } = await run("보호 발표.pptx", {});
  assert.deepEqual(pages, ["page 1", "page 2", "page 3"]);
  assert.deepEqual(log, ["capture -l20", "capture -l20", "capture -l20", "close", "quit"]); // 20: 쇼를 시작하며 생긴 창
});

test("Word: 쪽마다 가장 큰 창을 캡처하고, 같은 화면이 다시 나오면 멈춘다", { skip }, async () => {
  const { pages } = await run("제안서.docx", { pages: 30, lastScreen: 2 }); // 쪽수는 30으로 세지만 화면은 2쪽에서 더 넘어가지 않는다
  assert.deepEqual(pages, ["page 1", "page 2"]);
});

test("Excel: 다시 캡처(한 쪽만)는 그 시트로 바로 가서 한 장만 받는다", { skip }, async () => {
  const { pages, log } = await run("예산.xlsx", {}, 2);
  assert.deepEqual(pages, ["page 2"]);
  assert.deepEqual(log, ["capture -l10", "close", "quit"]);
});

test("맥이 아니면 문서는 바꾸지 않고 그림은 그대로 받는다", async () => {
  const picture = path.join(dir, "그림.png");
  writeFileSync(picture, "png");
  assert.deepEqual((await attachmentPages(picture)).map(String), ["png"]);
  if (process.platform !== "darwin") await assert.rejects(attachmentPages(path.join(dir, "a.pdf")), /맥에서만/);
});
