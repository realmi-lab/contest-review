import { test } from "node:test";
import assert from "node:assert/strict";
import { markNumbers, sentences } from "../public/lib/html.mjs";

test("요약 문장은 마침표 뒤 빈칸에서만 나눈다", () => {
  assert.deepEqual(sentences("기준값 0.45가 가장 높았다. 군집은 4개다."), ["기준값 0.45가 가장 높았다.", "군집은 4개다."]);
  assert.deepEqual(sentences("한 문장"), ["한 문장"]);
});

test("수치는 단위·범위째 표시하고 영문에 붙은 숫자와 문자 참조는 두지 않는다", () => {
  assert.equal(markNumbers("2022년 3~5월 기록, f1-score 0.80249"),
    '<mark class="num">2022년</mark> <mark class="num">3~5월</mark> 기록, f1-score <mark class="num">0.80249</mark>');
  assert.equal(markNumbers("군집은 4개다."), '군집은 <mark class="num">4개</mark>다.');
  assert.equal(markNumbers("S2.9 쪽의 '설명'"), "S2.9 쪽의 &#39;설명&#39;");
  assert.equal(markNumbers("<b>"), "&lt;b&gt;");
  assert.equal(markNumbers("모델 1은 1차 군집, 17076명"), '모델 1은 1차 군집, <mark class="num">17076명</mark>');
});

import { markTerms, termsIn } from "../public/lib/glossary.mjs";
test("용어는 처음 나온 곳에만 풀이를 달고 태그 안은 건드리지 않는다", () => {
  const html = markTerms('앙상블과 앙상블 <button aria-label="API">2쪽</button> f1-score <mark class="num">0.8</mark>');
  assert.equal((html.match(/<abbr/g) || []).length, 2);
  assert.match(html, /<abbr class="term" title="[^"]+">앙상블<\/abbr>과 앙상블/);
  assert.match(html, /aria-label="API"/);
  assert.deepEqual(termsIn(["결측치는 MissForest로 채운다"]).map(([name]) => name), ["MissForest", "결측치"]);
  assert.deepEqual(termsIn(["시간과 장소에 상관없이 쓰고 업무 중요도가 높다"]), []);
});
