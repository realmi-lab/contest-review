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
// 빈 쪽 n개짜리 PDF(쪽 크기 w×h pt)
function blankPdf(n, w, h) {
  const kids = Array.from({ length: n }, (_, i) => `${3 + i} 0 R`).join(" ");
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", `<< /Type /Pages /Kids [${kids}] /Count ${n} >>`,
    ...Array.from({ length: n }, () => `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] >>`)];
  let pdf = "%PDF-1.4\n";
  const offsets = objects.map((body, i) => { const at = pdf.length; pdf += `${i + 1} 0 obj\n${body}\nendobj\n`; return at; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` + offsets.map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("");
  return pdf + `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
}
test("Edge 헤드리스 PDF 보기 시험", { skip, timeout: 400_000 }, async () => {
  const { devtools, edgeExe } = await import("../src/intake/pages-windows.mjs");
  const { cropToPage } = await import("../src/intake/page-images.mjs");
  const { writeFileSync } = await import("node:fs");
  const dir = mkdtempSync(path.join(os.tmpdir(), "probe-pdf-"));
  const slide = path.join(dir, "가로 슬라이드.pdf");
  writeFileSync(slide, blankPdf(3, 960, 540));
  for (const [name, flags, file, hash] of [
    ["headless-a4-p1", ["--headless=new"], sample, "#page=1&view=FitV"],
    ["headless-a4-p2", ["--headless=new"], sample, "#page=2&view=FitV"],
    ["headless-slide-p2", ["--headless=new"], slide, "#page=2&view=FitV"],
    ["headless-slide-p9", ["--headless=new"], slide, "#page=9&view=FitV"],
    ["headed-slide-p2", ["--window-position=-32000,-32000"], slide, "#page=2&view=FitV"],
  ]) {
    const edge = spawn(edgeExe(), [`--user-data-dir=${mkdtempSync(path.join(os.tmpdir(), "probe-"))}`, "--remote-debugging-pipe", "--no-first-run",
      "--no-default-browser-check", "--window-size=3200,1400", "--force-device-scale-factor=1.5", "--disable-features=CalculateNativeWinOcclusion",
      "--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding", ...flags, "about:blank"], { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] });
    const send = devtools(edge);
    try {
      await wait(2500);
      const tab = (await send("Target.getTargets")).targetInfos.find((t) => t.type === "page");
      const { sessionId } = await send("Target.attachToTarget", { targetId: tab.targetId, flatten: true });
      await send("Page.navigate", { url: pathToFileURL(file).href + hash }, sessionId);
      await wait(7000);
      const png = Buffer.from((await send("Page.captureScreenshot", { format: "png" }, sessionId)).data, "base64");
      const meta = await sharp(png).metadata();
      const cropped = await cropToPage(png);
      const cm = await sharp(cropped).metadata();
      console.log(`PROBE ${name} shot=${meta.width}x${meta.height} crop=${cm.width}x${cm.height} ` + (await sharp(png).resize({ width: 320 }).jpeg({ quality: 50 }).toBuffer()).toString("base64"));
    } catch (e) { console.log(`PROBE ${name} 실패 ${e.message}`); } finally { await send("Browser.close").catch(() => {}); edge.kill(); }
  }
});
