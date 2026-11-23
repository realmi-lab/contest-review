// PDF를 쪽 그림으로 바꾸기(맥 PDFKit). 실제 osascript를 쓰므로 맥에서만 돈다(CI의 macOS에서 확인).
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { attachmentPages } from "../src/intake/attachment-pages.mjs";

// 빈 쪽 n개짜리 PDF
function blankPdf(n) {
  const kids = Array.from({ length: n }, (_, i) => `${3 + i} 0 R`).join(" ");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${kids}] /Count ${n} >>`,
    ...Array.from({ length: n }, () => "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >>"),
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = objects.map((body, i) => {
    const at = pdf.length;
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
    return at;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` + offsets.map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("");
  return pdf + `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
}

test("PDF는 쪽마다 PNG가 되고, 한 쪽만 달라고 하면 그 쪽만 준다", { skip: process.platform !== "darwin" && "맥에서만" }, async () => {
  const file = path.join(mkdtempSync(path.join(os.tmpdir(), "pdf-")), "제안서.pdf");
  writeFileSync(file, blankPdf(3));
  const pages = await attachmentPages(file);
  assert.equal(pages.length, 3);
  for (const page of pages) assert.equal(page.subarray(1, 4).toString(), "PNG");
  assert.equal((await attachmentPages(file, 2)).length, 1);
});
