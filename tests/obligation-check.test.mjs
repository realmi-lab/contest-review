import test from "node:test";
import assert from "node:assert/strict";
import { checkStrengthenedObligation as check } from "../obligation-check.mjs";

const point = { id: "P3", text: "신청자는 전자 서명 및 서면 확인 의무화를 제안한다.", refs: ["S1.3"] };
const source = "신청자는 전자 서명이나 서면 확인을 의무화하자고 제안했다.";
const row = text => ({ kind: "OCR", text });
const run = (text, claim = point.text) => check({...point, text:claim}, {"S1.3":row(text)});

test("같은 대상의 의무가 선택에서 동시 요구로 바뀐 구절만 정확히 연결한다", () => {
  const [issue] = run(source);
  assert.deepEqual(issue.claim, {id:"P3",quote:"전자 서명 및 서면 확인 의무화"});
  assert.deepEqual(issue.contrast, {id:"S1.3",quote:"전자 서명이나 서면 확인을 의무화"});
  assert.deepEqual(issue.refs, ["S1.3"]);
  assert.equal(issue.status, "확인 필요");
  assert.equal(run(source.replace("서명이나", "서명 또는")).length, 1);
});

test("조건·부정·다른 대상이나 인접한 두 문장·혼합 열거·일반 목록은 보류한다", () => {
  for (const candidate of [
    source.replace("신청자는", "담당자는"),
    source.replace("신청자는", "긴급한 경우 신청자는"),
    source.replace("의무화하자고 제안했다", "의무화하지는 않는다"),
    source.replace("의무화하자고 제안했다", "의무화하는 경우에는 재검토한다"),
    source.replace("의무화하자고 제안했다", "예로 든다"),
    source.replace("전자 서명이나", "초안 제출, 전자 서명이나"),
    source.replace("전자 서명이나", "초안 제출 및 전자 서명이나"),
    source.replace("전자 서명이나", "전자 서명이나 초안 제출 또는"),
    "전자 서명이나 서면 확인을 준비한다. 서면 확인을 의무화한다.",
    "신청자는 전자 서명 및 서면 확인을 의무화했다.",
  ]) assert.deepEqual(run(candidate), []);
  assert.deepEqual(run(source, point.text.replace("의무화를 제안한다", "의무화를 반대한다")), []);
  assert.deepEqual(run(source, point.text.replace("서면 확인", "서면 동의")), []);
});

test("다른 인용이 둘 다 요구하거나 원문 텍스트를 확인할 수 없으면 보류한다", () => {
  for (const other of [
    row("신청자는 전자 서명과 서면 확인을 모두 제출해야 한다."),
    row("전자 서명은 필수다. 서면 확인도 반드시 필요하다."),
    { kind:"OCR 수치 대조 필요",text:"원문 판독이 불확실함" },
  ]) assert.deepEqual(check({...point,refs:["S1.3","S1.4"]},{"S1.3":row(source),"S1.4":other}), []);
  assert.deepEqual(check({...point,refs:["S1.3","S1.4"]},{"S1.3":row(source)}), []);
});
