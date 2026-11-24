// 임시 점검: Edge 창 크기·배율에 따라 PDF가 어떻게 그려지는지 기록에 남긴다(설정을 고른 뒤 지운다).
import test from "node:test";
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import sharp from "sharp";

const skip = process.platform !== "win32" && "윈도우에서만";
const sample = fileURLToPath(new URL("../assets/self-check/sample.pdf", import.meta.url));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async (send, sessionId, name) => {
  const png = Buffer.from((await send("Page.captureScreenshot", { format: "png" }, sessionId)).data, "base64");
  const meta = await sharp(png).metadata();
  console.log(`PROBE ${name} shot=${meta.width}x${meta.height} ` + (await sharp(png).resize({ width: 300 }).jpeg({ quality: 50 }).toBuffer()).toString("base64"));
};
test("Edge PDF 보기 맞춤·인쇄 시험", { skip, timeout: 400_000 }, async () => {
  const { devtools, edgeExe, WINDOWS_SCRIPTS } = await import("../src/intake/pages-windows.mjs");
  const start = () => {
    const edge = spawn(edgeExe(), [`--user-data-dir=${mkdtempSync(path.join(os.tmpdir(), "probe-"))}`, "--remote-debugging-pipe", "--no-first-run",
      "--no-default-browser-check", "--window-position=-32000,-32000", "--window-size=1600,1100", "--disable-features=CalculateNativeWinOcclusion",
      "--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding", "about:blank"], { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] });
    return { edge, send: devtools(edge) };
  };
  const attach = async (send) => {
    await wait(2000);
    const tab = (await send("Target.getTargets")).targetInfos.find((t) => t.type === "page");
    return (await send("Target.attachToTarget", { targetId: tab.targetId, flatten: true })).sessionId;
  };
  const base = pathToFileURL(sample).href;
  for (const [name, hash] of [["zoom-page-fit", "#page=1&zoom=page-fit"], ["zoom-50", "#page=1&zoom=50"], ["view-FitV", "#page=1&view=FitV"], ["pagemode", "#page=2&zoom=40,0,0"]]) {
    const { edge, send } = start();
    try {
      const sessionId = await attach(send);
      await send("Page.navigate", { url: base + hash }, sessionId);
      await wait(6000);
      await shot(send, sessionId, name);
    } catch (e) { console.log(`PROBE ${name} 실패 ${e.message}`); } finally { await send("Browser.close").catch(() => {}); edge.kill(); }
  }
  { // 키보드 Ctrl+\ (페이지 맞춤 전환)
    const { edge, send } = start();
    try {
      const sessionId = await attach(send);
      await send("Page.navigate", { url: base + "#page=1" }, sessionId);
      await wait(6000);
      await send("Input.dispatchMouseEvent", { type: "mousePressed", x: 500, y: 350, button: "left", clickCount: 1 }, sessionId);
      await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: 500, y: 350, button: "left", clickCount: 1 }, sessionId);
      for (const round of [1, 2]) {
        await send("Input.dispatchKeyEvent", { type: "rawKeyDown", modifiers: 2, windowsVirtualKeyCode: 220, code: "Backslash", key: "\\" }, sessionId);
        await send("Input.dispatchKeyEvent", { type: "keyUp", modifiers: 2, windowsVirtualKeyCode: 220, code: "Backslash", key: "\\" }, sessionId);
        await wait(2500);
        await shot(send, sessionId, "ctrl-backslash-" + round);
      }
    } catch (e) { console.log(`PROBE key 실패 ${e.message}`); } finally { await send("Browser.close").catch(() => {}); edge.kill(); }
  }
  { // 인쇄(PDF로)
    const { edge, send } = start();
    try {
      const sessionId = await attach(send);
      await send("Page.navigate", { url: base }, sessionId);
      await wait(6000);
      const { data } = await send("Page.printToPDF", { printBackground: true, preferCSSPageSize: true }, sessionId);
      const pdf = Buffer.from(data, "base64");
      const file = path.join(mkdtempSync(path.join(os.tmpdir(), "print-")), "out.pdf");
      (await import("node:fs")).writeFileSync(file, pdf);
      const { documentPages } = await import("../src/intake/pages-windows.mjs");
      const pages = await documentPages("pdf", file, 0, {});
      const meta = await sharp(pages[0]).metadata();
      console.log(`PROBE print bytes=${pdf.length} pages=${pages.length} first=${meta.width}x${meta.height} ` + (await sharp(pages[0]).resize({ width: 300 }).jpeg({ quality: 50 }).toBuffer()).toString("base64"));
    } catch (e) { console.log(`PROBE print 실패 ${e.message}`); } finally { await send("Browser.close").catch(() => {}); edge.kill(); }
  }
});
