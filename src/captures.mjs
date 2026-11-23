// 캡처 접수: 그림을 확인해 저장하고 글자 인식(OCR)을 줄 세운다. 문서는 쪽마다 그림으로 바꿔 접수한다.
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { directory, root } from "./config.mjs";
import { attachmentPages } from "./intake/attachment-pages.mjs";
import { schedule } from "./jobs.mjs";
import { atomic, changed, deleteImage, image, insertImage, list, load, save } from "./store.mjs";
import { bounded, err, integer } from "./validate.mjs";

// 올린 문서는 다시 캡처할 때 쓰려고 데이터 폴더에 둔다. MS Forms 첨부는 OneDrive의 작품 폴더에 있다.
export const uploadDir = (wid) => path.join(directory, "documents", wid);

// 글자 인식은 별도 프로세스(src/ocr/ocr.mjs)에서 한다. 그림을 표준 입력으로 주고 JSON을 받는다.
function runOcr(buffer) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(root, "src", "ocr", "ocr.mjs")], { stdio: ["pipe", "pipe", "pipe"] });
    const stdout = [],
      stderr = [];
    let bytes = 0;
    const timer = setTimeout(() => child.kill("SIGKILL"), 240000);
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.stdout.on("data", (x) => {
      bytes += x.length;
      if (bytes > 12e6) child.kill();
      else stdout.push(x);
    });
    child.stderr.on("data", (x) => {
      if (stderr.length < 15) stderr.push(x);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error("Kordoc OCR 실패 · " + Buffer.concat(stderr).toString().slice(-450)));
      try {
        resolve(JSON.parse(Buffer.concat(stdout).toString()));
      } catch {
        reject(new Error("OCR 응답을 읽을 수 없습니다."));
      }
    });
    child.stdin.on("error", () => {});
    child.stdin.end(buffer);
  });
}

export function enqueueOcr(wid, cid) {
  schedule("ocr-" + cid, wid, "Kordoc 문자 인식 중", async () => {
    let result, problem;
    try {
      result = await runOcr(image(cid));
    } catch (e) {
      problem = e.message;
    }
    const w = load(wid),
      c = w.captures.find((x) => x.id === cid);
    if (!c) return;
    c.lines = result?.lines ?? [];
    if (result)
      c.ocrInfo = {
        version: 2,
        deskewAngle: result.deskewAngle || 0,
        tables: result.tables || [],
        uncertain: result.uncertain || [],
        detailRead: !!result.detailRead,
        detailFailed: !!result.detailFailed,
        added: result.added || 0,
        dropped: result.dropped || 0,
      };
    else delete c.ocrInfo;
    c.ocrWidth = result?.width || c.width;
    c.ocrHeight = result?.height || c.height;
    c.status = problem ? "failed" : "ready";
    c.ocrError = problem || (!c.lines.length ? "인식한 문장이 없습니다. 확대 캡처 또는 도식 검토를 사용하세요." : "");
    changed(w);
    save(w);
  });
}

// 글자 인식 모델 파일이 준비됐는가(화면 왼쪽 아래 상태 표시). 없으면 npm run prepare:ocr
export async function ocrReady() {
  const files = await Promise.all(["det.onnx", "rec_korean.onnx", "rec_korean.yml"].map((x) =>
    stat(path.join(root, "vendor/models/ppocr", x)).catch(() => null)));
  return files.every(Boolean);
}

// 서버가 꺼지기 전에 줄 서 있던 글자 인식을 다시 줄 세운다.
export function requeueOcr() {
  for (const w of list()) for (const c of w.captures) if (c.status === "queued") enqueueOcr(w.id, c.id);
}

// 받은 그림을 확인해 흰 바탕 PNG로 맞춘다.
async function pngOf(bytes) {
  if (!bytes?.length || bytes.length > 14 * 1024 * 1024) err("한 장에 14MB 이하의 PNG, JPG 또는 WebP를 사용하세요.");
  const input = sharp(bytes, { limitInputPixels: 32e6, failOn: "error" });
  const meta = await input.metadata();
  if (!["png", "jpeg", "webp"].includes(meta.format) || (meta.pages || 1) > 1)
    err("PNG, JPG 또는 WebP 단일 이미지를 사용하세요.");
  return input.rotate().flatten({ background: "white" }).png().toBuffer({ resolveWithObject: true });
}
const sha256 = (data) => createHash("sha256").update(data).digest("hex");

// 그림 한 장을 캡처로 접수한다. b: { document, page, total, label, visual, issue }
export async function addImage(wid, b, bytes) {
  const { data, info } = await pngOf(bytes);
  const w = load(wid);
  if (w.captures.length >= 150) err("작품당 캡처는 150장까지입니다.");
  const document = bounded(b.document || "제안서", 100),
    page = integer(b.page),
    total = integer(b.total);
  if (page && total && page > total) err("현재 쪽이 전체 쪽수보다 큽니다.");
  const hash = sha256(data);
  if (w.captures.some((c) => c.hash === hash && c.document === document && c.page === page))
    err("같은 위치에 이미 접수한 화면입니다.", 409);
  const c = {
    id: randomUUID(),
    document,
    page,
    total,
    label: bounded(b.label || document + (page ? " " + page + "쪽" : ""), 180),
    hash,
    visual: b.visual === true,
    issue: bounded(b.issue || "", 300),
    lines: [],
    status: "queued",
    width: info.width,
    height: info.height,
  };
  w.captures.push(c);
  changed(w, true);
  atomic(() => {
    insertImage(c.id, w.id, data);
    save(w);
  });
  enqueueOcr(w.id, c.id);
  return c.id;
}

// 캡처 한 장을 새 그림으로 바꾸고 글자를 다시 읽는다(다시 캡처). 그림 주소가 id라 새 id를 준다(브라우저가 예전 그림을 기억한다).
export async function replaceImage(wid, cid, bytes) {
  const { data, info } = await pngOf(bytes);
  const w = load(wid),
    c = w.captures.find((x) => x.id === cid);
  if (!c) return;
  delete c.ocrInfo;
  Object.assign(c, { id: randomUUID(), hash: sha256(data), lines: [], status: "queued", issue: "", width: info.width, height: info.height });
  changed(w, true);
  atomic(() => {
    deleteImage(cid);
    insertImage(c.id, w.id, data);
    save(w);
  });
  enqueueOcr(w.id, c.id);
}

// 파일 하나를 쪽 그림으로 바꿔 캡처로 접수하고 쪽수를 돌려준다(그림은 그대로, PDF·Word·PowerPoint·Excel은 쪽마다).
export async function addPages(wid, name, file) {
  const pages = await attachmentPages(file);
  for (const [i, bytes] of pages.entries())
    await addImage(wid, { document: name, page: i + 1, total: pages.length }, bytes).catch((e) => {
      if (e.status !== 409) throw e; // 이미 접수한 같은 쪽
    });
  return pages.length;
}
