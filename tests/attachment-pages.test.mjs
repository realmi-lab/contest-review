import test from "node:test";
import assert from "node:assert/strict";
import { pageKind } from "../src/intake/attachment-pages.mjs";

test("첨부 형식마다 읽는 방법을 고른다", () => {
  assert.deepEqual(["a.PNG", "b.jpeg", "c.pdf", "d.docx", "e.pptx", "f.xlsx", "g.hwp", "Doc.aspx"].map(pageKind),
    ["image", "image", "pdf", "word", "powerpoint", "excel", "", ""]);
});
