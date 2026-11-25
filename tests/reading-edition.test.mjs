import assert from "node:assert/strict";
import test from "node:test";
import { briefAnchors, composeEdition, restatesSource } from "../src/summary/reading-edition.mjs";
import { readingViews, representativeCaptures, explainOcr } from "../public/lib/expanded-reading.mjs";

const point = (topic, text, ref) => ({ topic, text, refs: [ref], mode: "요약" });

test("여러 작동 방식 때문에 제안의 실측과 한계가 핵심 네 자리에서 밀리지 않는다", () => {
  const lead = ["제안 내용","이용·운영 방식","이용·운영 방식","실측·관찰 결과","제출자가 밝힌 한계","목표·검증 계획"]
    .map((topic, i) => point(topic,"근거 " + i,"S" + i));
  lead[1].mode = "원문 발췌";
  assert.deepEqual(briefAnchors(lead), [lead[0],lead[2],lead[3],lead[4]]);
});

test("원문에 없는 연도를 붙인 문장은 배제하고 이견이 있는 OCR 숫자는 모델에 보내지 않는다", async () => {
  const good = point("제안 내용","우산을 공동으로 빌리는 방안을 제안한다.","A");
  good.mode = "원문 발췌";
  const disputed = point("예산","장비는 345만원이다.","B");
  const r = { lead:[good,disputed], points:[good,disputed], evidence:{
    A:{kind:"OCR",text:good.text}, B:{kind:"OCR 수치 대조 필요",text:disputed.text},
  }};
  const fake = async (_system, prompt, schema) => {
    assert.ok(!prompt.includes("345"));
    if (schema.properties.text) return {text:"2024년에 우산 공유 사업을 시행했다."};
    return {P1:false};
  };
  const edition = await composeEdition(r, () => {}, fake);
  assert.equal(edition.brief[0].text,good.text);
  assert.equal(edition.brief[0].mode,"원문 발췌");
  assert.deepEqual(edition.detail,[]);
});

test("저장된 요약 두 보기와 기존 자료에서 핵심 문장을 다시 세부 요점으로 노출하지 않는다", () => {
  const a=point("목적","공용 우산을 비치한다.","A"), b=point("절차","대여 기록은 안내 데스크에서 작성한다.","B");
  const r={lead:[a],points:[a,b],evidence:{A:{text:a.text,kind:"OCR"},B:{text:b.text,kind:"OCR"}}};
  assert.deepEqual(readingViews(r),{brief:[a],detail:[b]});
  assert.deepEqual(readingViews({...r,edition:{version:1,brief:[a],detail:[a,b]}}),{brief:[a],detail:[b]});
  assert.deepEqual(readingViews({...r,edition:{version:1,brief:[],detail:[]}}),{brief:[],detail:[]});
});

test("핵심 요약이 인용한 표의 수치 줄은 세부 내용에서 되풀이하지 않는다", () => {
  const a=point("결과","정확도는 0.83에서 0.65까지 낮아진다.","A");
  const table={...point("표에 기재된 수치","Accuracy · 하위 0.83, 상위 0.65.","A"),mode:"표의 열·값 대조"};
  const other={...point("표에 기재된 수치","예매수 · 2022년 120, 2023년 150.","B"),mode:"표의 열·값 대조"};
  const r={lead:[a],points:[a],evidence:{A:{text:"0.83 | 0.65",kind:"OCR"},B:{text:"120 | 150",kind:"OCR"}},
    edition:{version:1,brief:[a],detail:[table,other]}};
  assert.deepEqual(readingViews(r),{brief:[a],detail:[other]});
});

test("인용 검토 응답이 잘리면 같은 근거를 작은 묶음으로 나눠 끝까지 확인한다", async () => {
  const a = point("제안", "직원이 우산 대여를 신청할 수 있다.", "A");
  const b = point("절차", "안내 데스크에서 반납 일시를 기록한다.", "B");
  // 원문과 낱말이 다른 의역이어야 모델 검토로 넘어간다.
  const r = { points: [a, b], lead: [a, b], evidence: {
    A: { kind: "OCR", text: "임직원은 우산 대여 신청서를 낼 수 있다." }, B: { kind: "OCR", text: "반납한 날짜와 시각은 안내 데스크가 적는다." },
  } };
  const batches = [];
  const review = async (_, _prompt, schema) => {
    const keys = Object.keys(schema.properties);
    if (keys[0].startsWith("P")) batches.push(keys); // 인용 검토 요청만 센다 (이야기 요약 요청은 실패하면 기존 방식으로 간다)
    if (keys.length > 1) throw new Error("모델 응답이 길어 중단되었습니다.");
    return { [keys[0]]: true };
  };
  const edition = await composeEdition(r, () => {}, review);
  assert.deepEqual(batches, [["P1", "P2"], ["P1"], ["P2"]]);
  assert.deepEqual(edition.brief, [a, b]);
});

test("원문 낱말만으로 된 요약은 모델 검토 없이 받아들인다", async () => {
  const a = point("분석 방법", "예술의전당 의 좌석 등급 (C, B, A, S, R) 을 추정하기 위해 K-means 군집분석 알고리즘을 사용함.", "A");
  const r = { title: "예술의전당 콘서트홀의 효과적 가격 모델 수립", points: [a], lead: [a], evidence: {
    A: { kind: "OCR", text: "K-means 군집분석 알고리즘을 사용하여,공연별 좌석들의 등급(C,B,A,S,R)을 추정 | H" } } };
  assert.equal(restatesSource(a, r), true);
  assert.equal(restatesSource({ ...a, text: "K-means 군집분석으로 좌석 등급을 추정해 수익이 크게 늘었다." }, r), false);
  assert.equal(restatesSource({ ...a, text: "K-means 군집분석 알고리즘을 사용하지 않았다." }, r), false);
  const edition = await composeEdition(r, () => {}, async (_, _prompt, schema) => {
    // 이야기 요약은 쓰지 못한 것으로 하고, 인용 검토는 부르지 않아야 한다.
    if (Object.keys(schema.properties)[0] === "title") throw new Error("Haiku가 요약 양식에 맞게 응답하지 못했습니다.");
    throw new Error("인용 검토를 부르면 안 된다");
  });
  assert.deepEqual(edition.brief, [a]);
});

test("다시 쓴 결과 줄이 너무 길면 버리지 않고 편집 전 요점의 첫 문장을 쓴다", async () => {
  const first = "구간별 Accuracy는 하위 25% 이하 0.8286, 하위 25%~50% 0.7937, 하위 50%~75% 0.7624, 하위 75% 이상 0.6487로 측정되었다.";
  const result = point("실측·관찰 결과", first + " 구간 사이의 비교는 같은 모델이 낸 정확도 값을 나란히 놓은 것이다.", "A");
  const r = { points: [result], lead: [result], evidence: {
    A: { kind: "OCR", text: "Accuracy | 하위 25% 이하 0.8286 | 하위 25%~50% 0.7937 | 하위 50%~75% 0.7624 | 하위 75% 이상 0.6487" } } };
  const edition = await composeEdition(r, () => {}, async (_, _prompt, schema) =>
    schema.properties.text ? { text: "가".repeat(120) + "다." } : Object.fromEntries(Object.keys(schema.properties).map((k) => [k, true])));
  assert.deepEqual(edition.brief.map((p) => p.text), [first]);
});

test("핵심 요약은 제목·한 줄 요약·배경·내용·효과로, 세부 요약은 문제·목표·방법·결과·시사점으로 새로 쓰고, 검증에서 떨어지거나 짧아진 물음만 한 번 다시 쓴다", async () => {
  const background = point("대상과 배경", "대출 비교 앱 이용자가 늘어 데이터가 많아졌다.", "S1.1");
  const goal = point("제안 내용", "홈 화면에 들어온 고객 중 대출을 신청할 고객을 예측한다.", "S2.1");
  const method = point("이용·운영 방식", "범주형 변수가 많아 CatBoost 분류 모델을 사용했다.", "S3.1");
  const result = point("실측·관찰 결과", "시험 데이터의 f1-score는 0.398이다.", "S4.1");
  const r = { title: "대출 신청 예측", points: [background, goal, method, result], lead: [goal, method, result],
    evidence: Object.fromEntries([background, goal, method, result].map((x) => [x.refs[0], { kind: "OCR", text: x.text }])) };
  const asked = [], rules = [];
  const none = { text: "", ids: [] };
  const run = async (_, prompt, schema) => {
    const keys = Object.keys(schema.properties);
    asked.push(keys[0]);
    if (keys[0] === "P1") rules.push(prompt.split("\n")[0]);
    // 인용 검토: 문장마다 묻는다. "범주형 변수 다수." 문장만 떨어뜨린다
    if (keys[0].startsWith("P")) return Object.fromEntries(JSON.parse(prompt.split("\n").at(-1)).map(([i, text]) => ["P" + i, !text.includes("범주형 변수 다수")]));
    if (keys[0] === "content") { // 다시 쓰기: 떨어진 물음과 대조에서 문장이 빠져 짧아진 핵심 요약 답만 묻고, 확정된 답과 초안을 함께 보낸다
      assert.deepEqual(keys, ["content", "effect", "problem", "goal", "method", "result", "meaning"]);
      const again = JSON.parse(prompt.split("\n").at(-2).replace(/^[^{]*/u, ""));
      assert.deepEqual(Object.keys(again.확정), ["title", "gist", "background"]);
      assert.equal(again.탈락.content.이유, "일부 문장 빠짐");
      assert.ok(again.탈락.content.빠진_문장.includes("범주형 변수 다수.")); // 빠진 문장을 알려 준다
      assert.match(again.탈락.result.답, /0\.912/);
      assert.deepEqual([again.탈락.effect.이유, again.탈락.result.이유, again.탈락.meaning.이유], ["답 없음", "수치 대조: 0.912", "답 없음"]); // 맞지 않은 숫자를 알려 준다
      // 번호를 잘못 달아도(1번에는 0.398이 없다) 그 숫자가 적힌 항목을 근거에 더한다
      return { content: { text: "홈 화면에 들어온 고객 중 대출을 신청할 고객을 예측. 범주형 변수가 많아 CatBoost 분류 모델 사용.", ids: [2, 3] },
        effect: none, problem: none, goal: none, method: none, result: { text: "시험 데이터 f1-score 0.398 확인.", ids: [1] }, meaning: none };
    }
    if (keys[0] !== "title") return schema.properties.text ? { text: "" } : Object.fromEntries(keys.map((k) => [k, true]));
    assert.match(prompt, /개조식/); // 명사형으로 끝내는 개조식으로 쓰게 한다
    const rows = JSON.parse(prompt.split("\n").at(-1)).항목; // 분류 이름 → [[번호, "[쪽] 문장"]]
    const ids = (topic) => rows[topic].map(([id]) => id);
    assert.match(rows["제안 내용"][0][1], /^\[\d+쪽\] /); // 쪽 위치를 함께 보낸다
    return {
      title: { text: "CatBoost 분류 모델을 통한 대출 신청 고객 예측 제안", ids: [...ids("제안 내용"), ...ids("이용·운영 방식")] },
      gist: { text: "대출 비교 앱 고객 중 대출 신청 고객을 분류 모델로 예측.", ids: ids("제안 내용") },
      background: { text: "대출 비교 앱 이용자 증가로 쌓인 데이터의 활용 필요.", ids: ids("대상과 배경") },
      // 200자를 넘는 답은 버리지 않고 한도 안의 앞 문장만 남긴다
      content: { text: "홈 화면에 들어온 고객 중 대출을 신청할 고객을 CatBoost 분류 모델로 예측. " + "범주형 변수 다수. ".repeat(20).trim(), ids: [...ids("제안 내용"), ...ids("이용·운영 방식")] },
      effect: none,
      problem: none, goal: none, method: none,
      result: { text: "시험 데이터에서 f1-score 0.912 확보.", ids: ids("실측·관찰 결과") }, // 근거에 없는 수치
      meaning: none,
    };
  };
  const edition = await composeEdition(r, () => {}, run);
  assert.deepEqual(edition.brief.map((x) => [x.topic, x.refs.join()]), [["제목", "S2.1,S3.1"], ["한 줄 요약", "S2.1"], ["배경", "S1.1"], ["내용", "S2.1,S3.1"]]);
  assert.ok(!("basis" in edition.brief[0])); // 검토용 문장은 저장하지 않는다
  // 200자를 넘는 답은 한도 안의 앞 문장만 남기고, 문장마다 대조해 떨어진 문장은 뺀다. 그래서 짧아진 답은 한 번 다시 써서 더 길게 통과하면 바꾼다
  assert.equal(edition.brief[3].text, "홈 화면에 들어온 고객 중 대출을 신청할 고객을 예측. 범주형 변수가 많아 CatBoost 분류 모델 사용.");
  // 세부 요약에는 새로 쓴 줄만 싣는다. 0.912를 쓴 답은 다시 써서 통과한 문장으로, 수치(0.398)가 적힌 근거가 앞에 온다
  assert.deepEqual(edition.detail.map((x) => [x.topic, x.text, x.refs.join()]), [["무엇을 얻었나", "시험 데이터 f1-score 0.398 확인.", "S4.1,S1.1"]]);
  // 끝내 못 쓴 줄은 다른 줄로 메우지 않고 이름과 이유를 남긴다
  assert.deepEqual(edition.missing.map((m) => m.topic), ["효과", "무엇이 문제인가", "무엇을 하려는가", "어떻게 푸는가", "시사점과 활용"]);
  assert.equal(asked[0], "title");
  assert.match(rules[0], /엮어 쓴 것이다/); // 새로 쓴 답은 엮어 쓴 문장의 기준으로 검토한다
});

test("분석 기법을 설명하는 줄은 '분석 방법'으로 보여 주고 문서를 가리키는 말투는 걷어 낸다", async () => {
  const method = point("이용·운영 방식", "원문 묶음은 KNN 회귀 모델로 원가격을 추정한다고 적혀 있다.", "A");
  const use = point("이용·운영 방식", "직원이 안내 데스크에서 우산을 빌린다.", "B");
  const r = { points: [method, use], lead: [method, use], evidence: {
    A: { kind: "OCR", text: "KNN 회귀 모델을 이용하여 원가격을 추정" }, B: { kind: "OCR", text: use.text },
  } };
  const edition = await composeEdition(r, () => {}, async (_, _prompt, schema) =>
    Object.fromEntries(Object.keys(schema.properties).map((k) => [k, true])));
  assert.deepEqual(edition.brief.map((p) => [p.topic, p.text]), [
    ["분석 방법", "KNN 회귀 모델로 원가격을 추정한다."], ["이용·운영 방식", use.text]]);
});

test("대표 이미지는 실제 인용 캡처에서 고르고 캡션 위치가 있으면 해당 주변을 보여 준다", () => {
  const p=point("작동 방식","운영 화면에서 혼잡 지역을 조회한다.","A");
  const r={evidence:{A:{kind:"OCR",text:p.text,capture:"c"},B:{kind:"OCR",text:"[그림 1] 운영 화면",capture:"c",indexes:[0]}}};
  const imgs=representativeCaptures(r,[{id:"x"},{id:"c",label:"운영 화면",ocrWidth:900,ocrHeight:1200,lines:[{box:{y:700}}]}],[p]);
  assert.deepEqual(imgs.map((i)=>[i.capture,i.ref]),[["c","B"]]);
  assert.ok(imgs[0].viewBox[1]<700 && imgs[0].viewBox[1]+imgs[0].viewBox[3]>700);
});

test("근거 그림은 그래프·표가 있는 쪽만 고르고 수치를 말하는 요점부터 그 영역을 잘라 붙인다", () => {
  const prose={id:"p",page:1,ocrWidth:1600,ocrHeight:900,lines:Array(13).fill({text:"빅데이터를 활용해 합리적인 좌석 가격을 산정한다",box:{x:100,y:300,w:900,h:30}})};
  const tick=(i)=>({text:"0."+i,box:{x:800+i*40,y:400+i*20,w:30,h:16}});
  const chart={id:"c",page:36,ocrWidth:1600,ocrHeight:900,lines:[{text:"36",box:{x:1500,y:860,w:20,h:16}},...[1,2,3,4,5].map(tick)]};
  const a=point("제안 내용","좌석 가격을 산정한다.","A"), b=point("방법","군집 결과를 스무딩했다.","B"), c=point("결과","19%가 바뀌었다.","C");
  const r={evidence:{A:{kind:"OCR",text:a.text,capture:"p"},B:{kind:"OCR",text:b.text,capture:"c"},C:{kind:"OCR",text:c.text,capture:"c"}}};
  const imgs=representativeCaptures(r,[prose,chart],[a,b,c]);
  assert.deepEqual(imgs.map((i)=>[i.point,i.capture,i.page]),[[c,"c",36]]);
  assert.deepEqual(imgs[0].viewBox,[648,330,574,276]); // 눈금 영역 + 여백. 쪽 번호 줄은 세지 않는다.
});

test("실제로 관측한 판독 차이와 확대 대조 결과를 구분한다", () => {
  const x=explainOcr({original:"10000",text:"100.0"});
  assert.match(x.reason,/소수점/);
  assert.match(x.crop,/기록되지/);
  const y=explainOcr({text:"113.1%",cropMatch:"정밀 판독"});
  assert.equal(y.basic,"대응 문장 없음");
  assert.match(y.crop,/정밀 판독과 일치/);
});

test("없다고 쓴 문장은 원문 전체와 대조해 원문에 있는 항목만 지우고, 다 있으면 문장을 빼 그 물음을 비워 둔다", async () => {
  const { correctAbsences } = await import("../src/summary/reading-edition.mjs");
  const r = { evidence: { "S8.3": { text: "train set 2019-01~2019-12" }, "S9.1": { text: "결과 표" } } };
  const edition = { version: 1, missing: [], brief: [
    { topic: "한계·확인할 점", text: "제출자는 신상품 대응을 한계로 들었다. 자료에 예측 정확도, 학습 데이터 기간이 제시되지 않았다.", refs: ["S9.1"] },
    { topic: "무엇을 얻었나", text: "학습 데이터 기간은 자료에 제시되지 않았다.", refs: ["S9.1"] },
  ], detail: [{ topic: "분석 방법", text: "모델은 LGBM이다.", refs: ["S9.1"] }] };
  const run = async (_system, prompt, schema) => {
    assert.deepEqual(Object.keys(schema.properties), ["A1", "A2"]); // 없다고 단정한 문장만 묻는다
    assert.deepEqual(JSON.parse(prompt.split("\n").at(-1)).원문, [["S8.3", "train set 2019-01~2019-12"], ["S9.1", "결과 표"]]);
    return {
      A1: { found: [{ item: "학습 데이터 기간", id: "S8.3" }], kept: "자료에 예측 정확도가 제시되지 않았다." },
      A2: { found: [{ item: "학습 데이터 기간", id: "S8.3" }], kept: "" },
    };
  };
  const fixed = await correctAbsences(edition, r, () => {}, run);
  assert.deepEqual(fixed.brief.map((p) => p.text), ["제출자는 신상품 대응을 한계로 들었다. 자료에 예측 정확도가 제시되지 않았다."]);
  assert.deepEqual(fixed.missing, [{ topic: "무엇을 얻었나", why: "원문 대조 미통과" }]);
  assert.deepEqual(fixed.detail, edition.detail);
  // 원문 ID로 뒷받침하지 못하면 그대로 두고, 새 말을 더해 고쳐 쓰면 그 문장을 뺀다
  const loose = await correctAbsences(edition, r, () => {}, async () => ({
    A1: { found: [{ item: "예측 정확도", id: "S99.9" }], kept: "" },
    A2: { found: [{ item: "학습 데이터 기간", id: "S8.3" }], kept: "학습 기간은 2019년 한 해다." },
  }));
  assert.deepEqual(loose.brief.map((p) => p.text), [edition.brief[0].text]);
  assert.equal(edition.missing.length, 0); // 받은 편집본은 바꾸지 않는다
});

import { shownRefs } from "../src/summary/reading-edition.mjs";
test("근거 칩은 문장의 수치가 적힌 문장을 먼저 남기고, 단 근거에 없으면 원문에서 한 곳뿐인 문장을 잇는다", () => {
  const evidence = {
    "S55.3": { text: "최종 군집 1번" }, "S40.6": { text: "Test f1-score : 0.376" },
    "S41.7": { text: "기준값 | 0.1 | 0.45 | 0.9 f1-score | 0.79793 | 0.80249" }, "S35.17": { text: "calculate error | 0. 0833" },
  };
  // 한 자리 수(1)만 든 근거보다 0.376이 적힌 근거가 앞선다
  assert.deepEqual(shownRefs({ text: "앙상블 1을 골랐고 f1은 0.376이다.", refs: ["S55.3", "S40.6"] }, evidence), ["S40.6", "S55.3"]);
  // 단 근거에 없는 0.80249는 원문에서 찾아 잇는다(글자 인식의 '0. 0833'도 같은 수로 본다)
  assert.deepEqual(shownRefs({ text: "기준값 0.45의 f1 0.80249, 오차 0.0833", refs: ["S55.3"] }, evidence), ["S41.7", "S35.17", "S55.3"]);
  // 다섯 개까지
  assert.equal(shownRefs({ text: "가", refs: ["a", "b", "c", "d", "e", "f"] }, {}).length, 5);
});
