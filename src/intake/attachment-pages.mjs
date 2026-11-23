// 첨부를 캡처(쪽 그림)로 바꾼다. 그림은 그대로 한 장, 문서는 이 PC의 앱으로 연다.
//   맥: pages-mac.mjs (PDFKit, Office·Edge를 AppleScript로)   윈도우: pages-windows.mjs (Windows PDF, Office·Edge를 PowerShell로)
import { readFile } from "node:fs/promises";
import path from "node:path";
import * as mac from "./pages-mac.mjs";
import * as windows from "./pages-windows.mjs";

export { cropToPage } from "./page-images.mjs";

const IMAGES = ["png", "jpg", "jpeg", "webp"];
const OFFICE = {
  doc: "word", docx: "word", ppt: "powerpoint", pptx: "powerpoint", xls: "excel", xlsx: "excel",
};
export const pageKind = (name) => {
  const ext = path.extname(name).slice(1).toLowerCase();
  return IMAGES.includes(ext) ? "image" : ext === "pdf" ? "pdf" : OFFICE[ext] ?? "";
};

// 문서의 쪽 이미지들. only(1부터)를 주면 그 쪽 한 장만 돌려준다(다시 캡처).
// options.secured: MS Forms 첨부처럼 보호 문서로 보고 PDF를 처음부터 Edge로 연다.
// options.how: 보호 PDF를 어떻게 읽었는지 적어 돌려준다(운영 맥 점검이 보여 준다).
export async function attachmentPages(file, only, options = {}) {
  const kind = pageKind(file);
  if (!kind) throw new Error("자동으로 읽지 않는 형식입니다. 회사 뷰어로 열어 캡처해 올려 주세요.");
  if (kind === "image") return [await readFile(file)];
  const app = { darwin: mac, win32: windows }[process.platform];
  if (!app) throw new Error("문서를 쪽 그림으로 바꾸는 기능은 맥·윈도우에서만 동작합니다. 화면을 캡처해 올려 주세요.");
  const pages = await app.documentPages(kind, file, only, options);
  if (!pages.length) throw new Error(only ? only + "쪽을 문서에서 찾지 못했습니다." : "문서에서 쪽을 찾지 못했습니다.");
  return pages;
}
