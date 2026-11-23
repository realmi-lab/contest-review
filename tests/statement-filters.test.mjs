import test from "node:test";
import assert from "node:assert/strict";
import { describesDocument, describesFigure, looksLikeHeading, notStatement, plainVoice, withoutEventPreamble, claimsAbsence, unprintedNumbers } from "../statement-filters.mjs";

test("문서·쪽 구성만 설명하는 문장은 잡고 실제 내용 문장은 남긴다", () => {
  for (const meta of [
    "문서 제목은 'S18'이며, 본문은 4 가지 분석 단계를 포함하고 있습니다.",
    "제 11 회 빅콘테스트 참가팀 '제와제와 팀'이 제출한 제안서 페이지 22.",
    "제안서의 2 장은 '데이터 탐색'으로, 선행 연구를 포함합니다.",
    "제 11회 빅콘테스트, 7 페이지",
    "제 11 회 빅콘테스트 제안서 '2.2 제공 데이터' 페이지.",
    "분석 대상은 예술의전당이며, 제안자와 팀이 작성한 문서임.",
    "제공된 원문은 '제와제와팀'이라는 제출자가 작성한 것으로, 구체적인 제안 내용이나 데이터는 포함되어 있지 않습니다.",
    "제출자는 '2013. 08.'에 발표된 연구 제목만 제시하고, 연구의 방법이나 결과를 구체적으로 설명하지 않았습니다.",
  ]) assert.equal(describesDocument(meta), true, meta);
  for (const content of [
    "빅데이터 활용: 투명하고 합리적인 좌석 그룹핑 및 가격 산정을 목표로 함",
    "공연별 Accuracy 는 하위 25% 구간에서 0.8286 로 가장 높다.",
    "제안서는 직원 휴게실 예약제 도입을 제안한다.",
    "안내문 2쪽을 각 층 게시판에 붙이고 결과를 제출한 직원에게 보상한다.",
  ]) assert.equal(describesDocument(content), false, content);
});

test("서술어 없는 소제목만 소제목으로 본다", () => {
  assert.equal(looksLikeHeading("Customized Regression Model for Airbnb Dynamic Pricing"), true);
  assert.equal(looksLikeHeading("공연예술 및 가격 결정 관련 선행 연구/사례 분석"), true);
  assert.equal(looksLikeHeading("가격 모델 제시: 공연별 객단가를 선정해 공공성(공연 관계자 간 협력 관계 등)을 고려하여 수익을 최대화하는 방법 제시"), false);
  assert.equal(looksLikeHeading("공연예술상품은 가격할인보다 좌석미확보의 위험성이 더 크다."), false);
  assert.equal(looksLikeHeading("2023년 상반기 예매 현황"), false); // 숫자가 있으면 표 머리일 수 있어 남긴다
});

test("OCR 표 행은 요지 후보에서 빼고 열·값 짝 요약은 남긴다", () => {
  assert.equal(notStatement("티켓예매수(건) | 1,255,837 | 13.5 | 907,973 | (38.3%)"), true);
  assert.equal(notStatement("Accuracy · 하위25%이하 0.8286, 하위 25%~50% 0.7937."), false);
});

test("앞 문장에 기대는 문장은 요지 후보에서 뺀다", () => {
  assert.equal(notStatement("하지만, 그룹핑 하는 과정에서 다양한 특성을 고려하였기 때문에 지표로 활용될 수 있을 것이다."), true);
  assert.equal(notStatement("이용자는 앱으로 좌석을 신청한다."), false);
});

test("그림을 그렸다는 설명과 실제 결과 문장을 구분한다", () => {
  assert.equal(describesFigure("좌석 선호도는 예매까지 걸린 시간을 표준화하여 3 차원 산점도로 시각화했습니다."), true);
  assert.equal(describesFigure("연도별 평균 예매율 추이를 2018 년부터 2023 년까지 나타냄."), true);
  assert.equal(describesFigure("공연별 하위 25% 이하 구간에서 Accuracy 는 0.8286 이다."), false);
});

test("문서를 가리키는 말투는 걷어 내고 사실은 그대로 둔다", () => {
  assert.equal(plainVoice("원문 묶음은 원가격을 K-means 군집분석으로 추정하는 방법을 다루며, 등급을 나누어 추정한다고 적혀 있다."),
    "원가격을 K-means 군집분석으로 추정하는 방법을 다루며, 등급을 나누어 추정한다.");
  assert.equal(plainVoice("Accuracy는 하위 25% 이하 0.8286, 하위 75% 이상 0.6487로 표시되어 있다."), "Accuracy는 하위 25% 이하 0.8286, 하위 75% 이상 0.6487이다.");
  const plain = "KNN 회귀 모델을 이용하여 원가격을 추정했습니다.";
  assert.equal(plainVoice(plain), plain);
});

test("문장 앞에 붙은 행사명만 떼고 내용에 필요한 회차는 남긴다", () => {
  assert.equal(withoutEventPreamble("제 11 회 빅콘테스트 에서 좌석 등급을 추정하기 위해 K-means 군집분석 알고리즘을 사용함."),
    "좌석 등급을 추정하기 위해 K-means 군집분석 알고리즘을 사용함.");
  const kept = "제 3 회 시범 운영에서 참여자 120명 중 80%가 만족했다.";
  assert.equal(withoutEventPreamble(kept), kept);
});

test("날짜·시각을 풀어 쓴 숫자는 원문의 점·줄표 표기와 맞는 것으로 보고, 없는 숫자만 돌려준다", () => {
  assert.deepEqual(unprintedNumbers("2022년 1월부터 2022년 8월까지 테스트했다.", "test: 2022.01~2022.08"), []);
  assert.deepEqual(unprintedNumbers("2017년 1월부터 2021년 12월까지 학습했다.", "train 17.01~21.12"), []);
  assert.deepEqual(unprintedNumbers("2020년 6월 1일 편성", "2020-06-01 편성표"), []);
  assert.deepEqual(unprintedNumbers("평균 오차는 0.0928이다.", "model error | 0. 0928"), []); // 글자 인식이 넣은 공백
  assert.deepEqual(unprintedNumbers("Recall은 0.84, 정확도는 0.8387이다.", "Recall 0.8387"), ["0.84"]); // 반올림한 값은 없는 숫자
  assert.deepEqual(unprintedNumbers("8개 지역", "Accuracy 0.8387"), ["8"]); // 소수의 조각을 정수로 쓰지 않는다
});

test("무엇이 없다고 단정하는 문장을 알아본다", () => {
  assert.ok(claimsAbsence("자료에 예측 정확도가 제시되지 않았다."));
  assert.ok(claimsAbsence("측정 기간은 화면에 나타나지 않는다."));
  assert.ok(!claimsAbsence("결측치가 없는 변수만 사용했다."));
});
