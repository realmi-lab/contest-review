import assert from "node:assert/strict";
import { test } from "node:test";
import { fixNames } from "../src/text.mjs";

test("회사 이름 오타(빗섬·비썸)는 빗썸으로 고친다", () => {
  assert.equal(fixNames("빗섬 거래소와 비썸 앱, 빗썸 고객"), "빗썸 거래소와 빗썸 앱, 빗썸 고객");
});
