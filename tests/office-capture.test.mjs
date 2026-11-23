// Office 문서·보호 PDF 캡처 흐름(attachment-pages.mjs)을 가짜 Office·Edge·Acrobat Reader로 확인한다.
// osascript·open·screencapture를 흉내 내는 작은 프로그램을 PATH 앞에 두고, 앱을 열고 쪽을 넘기며 창을 캡처한 뒤
// 문서를 닫고 앱을 끄는 순서를 본다. 실제 Office·Edge·Reader의 동작은 회사 맥에서 확인해야 한다.
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";

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
if (tool === "open") {
  if (args[0] === "-Ra") done("", s.missing.includes(args[1]) ? 1 : 0); // 설치 확인
  s.opened = true;
  done();
}
if (tool === "screencapture") {
  s.log.push("capture " + args.find((a) => a.startsWith("-l")));
  // 마지막 화면 뒤로는 같은 화면. blank면 캡처가 막힌 것처럼 한 가지 색 그림을 준다
  fs.writeFileSync(args.at(-1), s.blank ? Buffer.from(s.blank, "base64") : "page " + Math.min(s.page, s.lastScreen));
  done();
}
const script = args[args.indexOf("-e") + 1], i = Number(args.at(-1));
if (script.includes("PDFKit")) { // 보호 PDF는 PDFKit이 열지 못한다. Edge가 저장한 사본("saved")은 연다
  const [pdf, out, only] = args.slice(-3);
  if (!fs.existsSync(pdf) || !fs.readFileSync(pdf, "utf8").startsWith("saved")) done("", 1);
  for (let n = 1; n <= s.pages; n++) if (!only || Number(only) === n) fs.writeFileSync(path.join(out, "00" + n + ".png"), "saved " + n);
  done(String(s.pages));
}
if (script.includes('"Microsoft Edge"')) { // Edge: 새 창에 #page=N으로 연다
  if (script.includes("make new window")) { s.edge = true; done("7"); }
  if (script.includes("key code 1 using command down")) { // 다른 이름으로 저장(⌘S): saveAs가 없으면 키를 보낼 권한이 없다
    if (!s.saveAs) done("", 1);
    fs.writeFileSync(path.join(args.at(-1), "보호 문서.pdf"), s.saveAs === "saved" ? "saved" : "still protected");
    done();
  }
  if (script.includes("loading of active tab")) done("false");
  if (script.includes('"#page="')) s.page = Number(args.at(-1));
  if (script.includes("close window id w")) { s.edge = false; s.log.push("close"); }
  if (/^ *quit$/m.test(script)) s.log.push("quit"); // 템플릿 글자 안이라 \\s 대신 공백을 쓴다
  done();
}
if (script.includes("CGWindowList") && args.at(-1) === "Microsoft Edge")
  done(JSON.stringify(s.edge ? [{ id: 50, area: 800, name: "보호 문서.pdf" }] : []));
if (script.includes("CGWindowList") && args.at(-1).includes("Acrobat"))
  done(JSON.stringify(s.opened && !s.closed ? [{ id: 30, area: 800, name: "보호 문서.pdf" }] : []));
if (script.includes('"System Events"')) { // Reader는 키보드로 넘긴다
  if (script.includes("key code 115")) s.page = 1;
  if (script.includes("key code 124")) s.page += 1;
  if (script.includes('keystroke "w"')) { s.closed = true; s.log.push("close"); }
  done();
}
if (/to quit$/.test(script.trim())) { s.log.push("quit"); done(); }
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
  writeFileSync(state, JSON.stringify({ export: false, show: false, page: 1, pages: 3, lastScreen: 99, missing: [], log: [], saveAs: "", ...office }));
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

test("보호 PDF: Edge 새 창에 쪽마다 열어 캡처하고, 같은 화면이 나오면 멈춘 뒤 그 창을 닫고 Edge를 끈다", { skip }, async () => {
  const { pages, log } = await run("보호 문서.pdf", { lastScreen: 3 });
  assert.deepEqual(pages, ["page 1", "page 2", "page 3"]);
  assert.deepEqual(log, ["capture -l50", "capture -l50", "capture -l50", "capture -l50", "close", "quit"]); // 4번째는 3쪽과 같은 화면
});

test("보호 PDF: Edge로 다시 캡처(한 쪽만)는 그 쪽을 바로 연다", { skip }, async () => {
  const { pages, log } = await run("보호 문서.pdf", {}, 2);
  assert.deepEqual(pages, ["page 2"]);
  assert.deepEqual(log, ["capture -l50", "close", "quit"]);
});

test("보호 PDF: Edge에서 '다른 이름으로 저장'한 사본이 열리면 화면 캡처 없이 그 사본의 쪽을 쓴다", { skip }, async () => {
  const { pages, log } = await run("보호 문서.pdf", { saveAs: "saved" });
  assert.deepEqual(pages, ["saved 1", "saved 2", "saved 3"]);
  assert.deepEqual(log, ["close", "quit"]);
});

test("보호 PDF: 저장한 사본도 보호되어 있으면 화면 캡처로 넘어간다", { skip }, async () => {
  const { pages } = await run("보호 문서.pdf", { saveAs: "protected", lastScreen: 2 });
  assert.deepEqual(pages, ["page 1", "page 2"]);
});

test("보호 PDF: Edge가 화면 캡처를 막아 검은 화면만 찍히면 저장이 안 된 까닭과 함께 알린다", { skip }, async () => {
  const black = await sharp({ create: { width: 40, height: 40, channels: 3, background: "#000" } }).png().toBuffer();
  await assert.rejects(run("보호 문서.pdf", { blank: black.toString("base64") }), /화면 캡처를 막았고.*저장하지 못했습니다/s);
});

const noEdge = ["Microsoft Edge"];
test("보호 PDF: Edge가 없으면 Acrobat Reader로 열어 키보드로 넘기며 캡처하고, 같은 화면이 나오면 멈춘 뒤 닫고 끈다", { skip }, async () => {
  const { pages, log } = await run("보호 문서.pdf", { lastScreen: 3, missing: noEdge });
  assert.deepEqual(pages, ["page 1", "page 2", "page 3"]);
  assert.deepEqual(log, ["capture -l30", "capture -l30", "capture -l30", "capture -l30", "close", "quit"]); // 4번째는 3쪽과 같은 화면
});

test("보호 PDF: Reader로 다시 캡처(한 쪽만)는 첫 쪽에서 그 쪽까지 넘겨 한 장만 받는다", { skip }, async () => {
  const { pages } = await run("보호 문서.pdf", { missing: noEdge }, 2);
  assert.deepEqual(pages, ["page 2"]);
});

test("보호 PDF: Edge도 Reader도 없으면 Edge 설치를 안내한다", { skip }, async () => {
  await assert.rejects(run("보호 문서.pdf", { missing: [...noEdge, "Adobe Acrobat Reader", "Adobe Acrobat Reader DC", "Adobe Acrobat"] }), /이 맥에 Edge가 없습니다/);
});

test("맥이 아니면 문서는 바꾸지 않고 그림은 그대로 받는다", async () => {
  const picture = path.join(dir, "그림.png");
  writeFileSync(picture, "png");
  assert.deepEqual((await attachmentPages(picture)).map(String), ["png"]);
  if (process.platform !== "darwin") await assert.rejects(attachmentPages(path.join(dir, "a.pdf")), /맥에서만/);
});
