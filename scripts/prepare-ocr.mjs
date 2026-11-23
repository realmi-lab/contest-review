import { createHash, randomUUID } from "node:crypto";
import { readFile, mkdir, rename, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import {
  ALL_OCR_MODELS,
  OCR_HANDWRITING_REC_MODEL,
} from "../node_modules/kordoc/dist/chunk-BHYBZSOC.js";

const folder = fileURLToPath(
  new URL("../vendor/models/ppocr/", import.meta.url),
);
await mkdir(folder, { recursive: true });
const digest = (data) => createHash("sha256").update(data).digest("hex");
for (const spec of [...ALL_OCR_MODELS, OCR_HANDWRITING_REC_MODEL]) {
  const dest = join(folder, spec.filename);
  if (
    await readFile(dest).then(
      (x) => digest(x) === spec.sha256,
      () => false,
    )
  )
    continue;
  const temp = dest + "." + randomUUID();
  try {
    execFileSync("curl", [
      "--fail",
      "--location",
      "--retry",
      "2",
      "--silent",
      "--show-error",
      "-o",
      temp,
      spec.url,
    ]);
    if (digest(await readFile(temp)) !== spec.sha256)
      throw new Error(spec.filename + " 체크섬 불일치");
    await rename(temp, dest);
  } finally {
    await rm(temp, { force: true });
  }
}
console.log("Kordoc 한국어 OCR 모델과 사전 SHA-256 확인 완료");
