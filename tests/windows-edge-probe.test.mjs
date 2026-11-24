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
const CASES = [
  ["plain-1600x1100", ["--window-size=1600,1100"], null],
  ["plain-1400x2000", ["--window-size=1400,2000"], null],
  ["dsf2-1600x1100", ["--window-size=1600,1100", "--force-device-scale-factor=2"], null],
  ["bounds-1400x2000", ["--window-size=800,600"], { width: 1400, height: 2000 }],
];
test("Edge 창 크기·배율 시험", { skip, timeout: 400_000 }, async () => {
  const { devtools, edgeExe } = await import("../src/intake/pages-windows.mjs");
  for (const [name, flags, bounds] of CASES) {
    const edge = spawn(edgeExe(), [`--user-data-dir=${mkdtempSync(path.join(os.tmpdir(), "probe-"))}`, "--remote-debugging-pipe", "--no-first-run",
      "--no-default-browser-check", "--window-position=-32000,-32000", "--disable-features=CalculateNativeWinOcclusion",
      "--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding", ...flags, "about:blank"], { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] });
    const send = devtools(edge);
    try {
      await wait(2000);
      const tab = (await send("Target.getTargets")).targetInfos.find((t) => t.type === "page");
      const { sessionId } = await send("Target.attachToTarget", { targetId: tab.targetId, flatten: true });
      if (bounds) {
        const { windowId } = await send("Browser.getWindowForTarget", { targetId: tab.targetId });
        await send("Browser.setWindowBounds", { windowId, bounds });
        console.log("BOUNDS " + name + " " + JSON.stringify(await send("Browser.getWindowBounds", { windowId })));
      }
      await send("Page.navigate", { url: pathToFileURL(sample).href + "#page=1&view=Fit&toolbar=0" }, sessionId);
      await wait(6000);
      const { result } = await send("Runtime.evaluate", { expression: "JSON.stringify([innerWidth, innerHeight, devicePixelRatio, screen.width, screen.height])", returnByValue: true }, sessionId);
      const png = Buffer.from((await send("Page.captureScreenshot", { format: "png" }, sessionId)).data, "base64");
      const meta = await sharp(png).metadata();
      console.log(`PROBE ${name} view=${result.value} shot=${meta.width}x${meta.height} ` + (await sharp(png).resize({ width: 300 }).jpeg({ quality: 50 }).toBuffer()).toString("base64"));
    } catch (e) {
      console.log(`PROBE ${name} 실패 ${e.message}`);
    } finally {
      await send("Browser.close").catch(() => {});
      edge.kill();
    }
  }
});
