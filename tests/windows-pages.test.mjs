// 윈도우에서 첨부를 쪽 그림으로 바꾸기(pages-windows.mjs)와 Excel 앱 스크립트(excel-app.mjs). 실제 PowerShell·Edge를 쓰므로
// 윈도우에서만 돈다(CI의 windows-latest). Office는 CI에 없어 스크립트 문법만 확인하고, 실제 Office·보호 문서는 회사 PC에서 확인한다.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const skip = process.platform !== "win32" && "윈도우에서만";
const sample = fileURLToPath(new URL("../assets/self-check/sample.pdf", import.meta.url));
const load = async () => ({
  ...(await import("../src/intake/pages-windows.mjs")),
  ...(await import("../src/intake/excel-app.mjs")),
  ...(await import("../src/intake/scripting.mjs")),
});

test("PowerShell 스크립트(PDF·Office·Excel)는 문법 오류가 없다", { skip }, async () => {
  const { WINDOWS_SCRIPTS, EXCEL_SCRIPTS, powershell } = await load();
  for (const [name, script] of Object.entries({ ...WINDOWS_SCRIPTS, ...EXCEL_SCRIPTS })) {
    const errors = await powershell(
      "$e = $null; [void][Management.Automation.Language.Parser]::ParseInput($env:CR_SCRIPT, [ref]$null, [ref]$e); ($e | ForEach-Object { $_.Message }) -join ' / '",
      { CR_SCRIPT: script }, "문법 확인");
    assert.equal(errors, "", name);
  }
});

test("PowerShell 실행: 한글을 그대로 주고받고, 오류는 메시지만 알린다", { skip }, async () => {
  const { powershell } = await load();
  assert.equal(await powershell("'받은 값: ' + $env:CR_TEXT", { CR_TEXT: "공유 우산" }, "출력"), "받은 값: 공유 우산");
  await assert.rejects(powershell("throw '일부러 낸 오류'", {}, "점검"), /^Error: 점검: 일부러 낸 오류$/);
});

test("PDF는 Windows PDF 기능으로 쪽마다 PNG가 되고, 한 쪽만·없는 쪽도 다룬다", { skip }, async () => {
  const { documentPages } = await load();
  const pages = await documentPages("pdf", sample, 0, {});
  assert.equal(pages.length, 2);
  for (const page of pages) assert.equal(page.subarray(1, 4).toString(), "PNG");
  assert.equal((await documentPages("pdf", sample, 2, {})).length, 1);
});

test("Forms 첨부 PDF는 이 앱 전용 Edge 프로필을 화면 밖에 열어 쪽마다 캡처하고 쪽만 잘라 낸다", { skip, timeout: 240_000 }, async () => {
  process.env.REVIEW_EDGE_PROFILE = mkdtempSync(path.join(os.tmpdir(), "edge-profile-"));
  const { documentPages } = await load();
  const options = { secured: true };
  const pages = await documentPages("pdf", sample, 0, options);
  mkdirSync("test-output", { recursive: true }); // CI가 산출물로 올린다(실제 Edge 화면 확인용)
  pages.forEach((page, i) => writeFileSync(`test-output/edge-page-${i + 1}.png`, page));
  // 기록에서도 볼 수 있게 첫 쪽을 작게 남긴다
  console.log("EDGE_PAGE_JPEG " + (await sharp(pages[0]).resize({ width: 600 }).jpeg({ quality: 55 }).toBuffer()).toString("base64"));
  assert.equal(options.how, "Edge 화면 캡처(이 앱 전용 Edge 프로필)");
  assert.equal(pages.length, 2);
  for (const page of pages) {
    const { width, height } = await sharp(page).metadata();
    const { channels } = await sharp(page).stats();
    assert.ok(width < 3000 && height > width, `쪽만 남아야 한다: ${width}x${height}`); // 세로 A4 쪽
    assert.ok(channels.some((c) => c.stdev > 10), "빈 화면이 아니어야 한다");
  }
});
