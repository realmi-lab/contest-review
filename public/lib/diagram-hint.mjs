// 도식 검토 추천: 글자(OCR)만으로는 그래프 값을 알 수 없는 쪽을 찾는다(AI 없이, 글자 위치만 본다).
// 그래프 축(날짜·연도처럼 고른 간격으로 가로로 늘어선 눈금, 또는 같은 간격으로 세로로 쌓인 숫자 눈금)이 있는데
// 가로축 칸마다 값 라벨이 하나씩 붙어 있지 않으면, 값은 막대 길이나 선 높이로만 그려져 이미지에만 있다.
// (실측: 지난 공모 30건 1,008쪽에서 날짜 가로축 55개 중 칸마다 값 라벨이 붙은 그래프는 1개뿐이었고,
//  글자 위치로 값을 짝지으면 화면 캡처·표에서 엉뚱한 짝이 나와 값 복원은 하지 않는다.)
const NUMBER = /^[-+]?\d[\d,]*(?:\.\d+)?\s?(?:%|%p)?$/u;
const WHEN = /^(?:\d{1,2}월|(?:19|20)\d{2}(?:[.\-/]\d{1,2})?년?|\d{2}[.\-/]\d{1,2}|[1-4]분기|Q[1-4]|(?:19|20)\d{2}년\s?\d{1,2}월)$/u;
const value = (t) => Number(t.replace(/[,%p\s]/gu, ""));
const even = (xs) => { // 간격이 고른가(간격의 표준편차가 평균의 25% 이하)
  const gaps = xs.slice(1).map((x, i) => x - xs[i]);
  const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  return mean > 0 && Math.sqrt(gaps.reduce((a, g) => a + (g - mean) ** 2, 0) / gaps.length) <= 0.25 * mean;
};
// 숫자 눈금: 넷 이상 열다섯 이하가 정확히 같은 차이로 늘어선다(1000, 1500, 2000 …).
// 목차 번호(01, 02, 03)와 표의 행 번호(1, 2, 3 …)는 눈금이 아니다.
function ticks(cells) {
  if (cells.length < 4 || cells.length > 15 || !cells.every((c) => NUMBER.test(c.t) && !/^0\d/u.test(c.t))) return false;
  const values = cells.map((c) => value(c.t)).sort((a, b) => a - b);
  const gaps = values.slice(1).map((v, i) => v - values[i]);
  const step = gaps.slice().sort((a, b) => a - b)[Math.floor(gaps.length / 2)];
  return step > 0 && gaps.every((g) => Math.abs(g - step) <= 0.05 * step) && !(step === 1 && values[0] <= 1);
}

// 이 쪽의 OCR 줄(lines: [{text, box}])에서 이미지로만 읽을 수 있는 그래프가 보이면 이유를, 아니면 ""를 돌려준다.
export function diagramHint(lines) {
  const cells = (lines || []).filter((l) => l.box?.w > 0 && l.box?.h > 0)
    .map((l) => ({ t: String(l.text).trim(), cx: l.box.x + l.box.w / 2, right: l.box.x + l.box.w, cy: l.box.y + l.box.h / 2, h: l.box.h }))
    .sort((a, b) => a.cy - b.cy);
  const rows = [];
  for (const c of cells) {
    const row = rows.at(-1);
    if (row && Math.abs(row.cy - c.cy) <= 0.42 * Math.min(row.h, c.h)) row.cells.push(c);
    else rows.push({ cy: c.cy, h: c.h, cells: [c] });
  }
  // 가로축: 날짜·연도 눈금 셋 이상이나 숫자 눈금이 고른 간격으로 늘어선 줄
  for (const row of rows) {
    const axis = row.cells.filter((c) => WHEN.test(c.t) || NUMBER.test(c.t)).sort((a, b) => a.cx - b.cx);
    if (axis.length < 3 || !even(axis.map((c) => c.cx))) continue;
    const dates = axis.every((c) => WHEN.test(c.t)) && new Set(axis.map((c) => c.t)).size >= 3; // 같은 날짜만 되풀이되면 축이 아니다
    if (!dates && !ticks(axis)) continue;
    const step = (axis.at(-1).cx - axis[0].cx) / (axis.length - 1);
    const labels = cells.filter((c) => NUMBER.test(c.t) && !WHEN.test(c.t) && c.cy < row.cy && row.cy - c.cy < 4 * step);
    const labelled = axis.filter((a) => labels.filter((n) => Math.abs(n.cx - a.cx) <= step / 2).length === 1).length;
    if (labelled < 3 || labelled < 0.6 * axis.length) return "그래프 값이 글자로 적혀 있지 않음";
  }
  // 세로축: 같은 세로줄(오른쪽 끝이나 가운데가 맞는)에 고른 간격으로 쌓인 숫자 눈금
  const numbers = cells.filter((c) => NUMBER.test(c.t));
  for (const n of numbers) {
    const column = numbers.filter((m) => Math.abs(m.right - n.right) <= n.h || Math.abs(m.cx - n.cx) <= n.h);
    if (ticks(column) && even(column.map((m) => m.cy).sort((a, b) => a - b))) return "그래프 값이 글자로 적혀 있지 않음";
  }
  return "";
}
