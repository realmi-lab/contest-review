import sharp from "sharp";
import { corroborateValues } from "./ocr-crops.mjs";
import { fileURLToPath } from "node:url";
import { needsDetail, reconcilePages, nativeTables } from "./ocr-quality.mjs";
// 이미지 변환은 페이지 작업 안에서도 한 스레드로 수행한다.
sharp.concurrency(1);
sharp.cache(false);
process.env.KORDOC_MODEL_CACHE = fileURLToPath(
  new URL("../../vendor/models", import.meta.url),
);
process.env.KORDOC_OFFLINE = "1";
const { parse } = await import("kordoc");
const chunks = [];
for await (const b of process.stdin) chunks.push(b);
const bytes = Buffer.concat(chunks);
async function recognize(side, rec) {
  const result = await parse(bytes, {
    ocr: true,
    ocrRec: rec,
    ocrDet: "mobile",
    ocrDetLongSide: side,
    ocrLines: "all",
  });
  if (!result.success || !result.ocrLines?.[0])
    throw Error(result.error?.message || "OCR 읽기 실패");
  return { page: result.ocrLines[0], blocks: result.blocks };
}
const { page, blocks } = await recognize(1600, "printed");
let second = null,
  detailFailed = false;
if (needsDetail(page)) {
  try {
    const primary = page.lines.filter((l) => !l.dropped);
    const mean =
      primary.reduce((s, l) => s + l.confidence, 0) /
      Math.max(1, primary.length);
    second = (await recognize(2304, mean < 0.85 ? "auto" : "printed")).page;
  } catch {
    detailFailed = true;
  }
}
const result = reconcilePages(page, second);
try {
  await corroborateValues(bytes, page, result.uncertain, parse);
} catch {
  detailFailed = true;
}

process.stdout.write(
  JSON.stringify({
    ...result,
    width: page.width,
    height: page.height,
    deskewAngle: page.deskewAngle,
    tables: nativeTables(blocks, result.lines),
    detailFailed,
    detailRead: !!second,
    dropped: page.lines.filter((l) => l.dropped).length,
  }),
);
