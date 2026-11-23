import test from "node:test";
import assert from "node:assert/strict";
import { qualifyObservationDates } from "../layout.mjs";

const info = {
  text: "RATE | Unemployment Rate, Percent, Monthly, Seasonally Adjusted",
};
const table = {
  text: "observation_date | RATE\n2024-01-01 | 3.7\n2024-02-01 | 3.9\n2024-06-01 | 4.1",
};
const evidence = { info, table };
const point = {
  mode: "요약",
  refs: ["info", "table"],
  text: "계절 조정 후 실업률 (RATE)은 2024 년 1 월 1 일부터 6 월 1 일까지 매월 측정되었으며, 단위는 백분율이다.",
};

test("월별 시계열의 날짜 범위를 관측월로 표현하고 지표 성격과 인용을 보존한다", () => {
  const result = qualifyObservationDates(point, evidence);
  assert.equal(
    result.text,
    "계절 조정 후 실업률 (RATE)은 2024년 1월부터 2024년 6월까지 월별 관측값으로 제시되었으며, 단위는 백분율이다.",
  );
  assert.equal(result.refs, point.refs);
  assert.equal(qualifyObservationDates(result, evidence), result);
  const single = { ...point, text: "RATE는 2024-06-01에 측정됐다." };
  assert.equal(
    qualifyObservationDates(single, evidence).text,
    "RATE는 2024년 6월의 관측값으로 제시됐다.",
  );
});

test("기계로 대조한 표에서 관측월과 원래 값을 유지하고 빈 달을 만들지 않는다", () => {
  const row = {
    ...point,
    mode: "표의 날짜·값 대조",
    text: "RATE 기록. 2024-01-01 관측값 3.7%, 2024-02-01 관측값 3.9%, 2024-06-01 관측값 4.1%.",
  };
  assert.equal(
    qualifyObservationDates(row, evidence).text,
    "RATE 기록. 2024년 1월 관측값 3.7%, 2024년 2월 관측값 3.9%, 2024년 6월 관측값 4.1%.",
  );
});

test("표를 인용하지 않거나 빈도·지표가 다르거나 실제 측정 시점을 명시하면 원래 항목을 반환한다", () => {
  for (const sources of [
    { info },
    { table },
    { info: { text: "RATE | Quarterly" }, table },
    { info: { text: "OTHER | Monthly" }, table },
    {
      info,
      table: {
        text: table.text.replace("observation_date", "measurement_date"),
      },
    },
    { info: { text: info.text + "\n매월 1일에 조사를 실시했다." }, table },
    {
      info: {
        text:
          info.text +
          "\nMeasurements were collected on the first day of each month.",
      },
      table,
    },
    { info, table: { text: table.text.replace("2024-02-01", "2024-01-02") } },
  ])
    assert.equal(qualifyObservationDates(point, sources), point);
  for (const unchanged of [
    { ...point, refs: ["info"] },
    { ...point, text: point.text.replace("6 월 1 일", "6 월 5 일") },
    { ...point, mode: "원문 발췌" },
  ])
    assert.equal(qualifyObservationDates(unchanged, evidence), unchanged);
});
