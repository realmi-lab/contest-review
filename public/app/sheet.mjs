// 채점표 탭: 항목 점수·결정, 채점 기준 고치기
import { readingViews } from "../lib/expanded-reading.mjs";
import { esc, join, seoulMinute } from "../lib/html.mjs";
import { tween } from "./interactions.mjs";
import { assignedEvaluators, columnHeaders } from "./list.mjs";
import { countText, issueCounts, issueList, shownIssues } from "./logic.mjs";
import { currentLogic, currentReading } from "./navigation.mjs";
import { state } from "./state.mjs";
import { $, button, claim, field, input } from "./ui.mjs";

/* ─────────────────────────── 채점표 탭 ─────────────────────────── */

// 확정 전에 다시 볼 항목: 다시 캡처할 부분, 계산으로 확인한 불일치
function openItems() {
  const items = [];
  for (const c of state.work.captures)
    if (c.issue)
      items.push({ text: `${c.label} · 다시 캡처: ${c.issue}`, refs: [] });
  for (const x of currentLogic()?.issues || [])
    if (x.status === "계산으로 확인")
      items.push({ text: `${x.type} · ${x.reason}`, refs: x.refs });
  return items;
}

// 선택지 묶음. radio는 하나를 꼭 고르고 checkbox는 해당하는 것만 고른다.
function choices(legend, name, options, type, picked = [], hint = "") {
  return `<fieldset class="choices"><legend>${esc(legend)}${hint ? `<small>${esc(hint)}</small>` : ""}</legend>${join(options, (o) =>
    `<label><input type="${type}" name="${name}" value="${esc(o)}" ${picked.includes(o) ? "checked" : ""} ${type === "radio" ? "required" : ""}>${esc(o)}</label>`)}</fieldset>`;
}
// 점수를 넣을 때마다 항목 막대와 합계(숫자·막대)를 갱신한다.
export function updateSheet(form) {
  let sum = 0;
  for (const field of form.querySelectorAll("[name=score]")) {
    const value = Math.min(Math.max(Number(field.value) || 0, 0), Number(field.max));
    sum += value;
    field.closest("td").querySelector(".meter i").style.setProperty("--fill", value / Number(field.max));
  }
  tween($("sheettotal"), Math.round(sum * 10) / 10);
  $("sheetmeter").style.setProperty("--fill", sum / 10);
}

// 채점 항목마다 판단에 쓰는 요약 줄. 기본 채점 기준의 이름으로 잇고, 이름을 바꾼 항목에는 붙이지 않는다.
// 뒤쪽 이름은 예전 형식(한 줄 요약 → 문제 → … → 한계)으로 저장된 요약의 줄이다.
const CRITERION_TOPICS = {
  "문제 정의": ["배경", "무엇이 문제인가"],
  "효과 크기": ["효과", "시사점과 활용"],
  "실행 가능성": ["내용", "어떻게 푸는가"],
  근거: ["결과·근거", "무엇을 얻었나", "한계·확인할 점"],
  차별성: ["무엇을 하려는가"],
};
function criterionSummary(name, terms) {
  const r = currentReading();
  if (!r || !CRITERION_TOPICS[name]) return "";
  const { brief, detail } = readingViews(r);
  const points = CRITERION_TOPICS[name].map((topic) => [...brief, ...detail].find((p) => p.topic === topic)).filter(Boolean);
  return points.length
    ? `<ul class="from-summary">${join(points, (p) => `<li data-topic="${esc(p.topic)}"><b>요약 · ${esc(p.topic)}</b>${claim(p, "div", "", terms)}</li>`)}</ul>`
    : "";
}

// 판단 기준은 첫 문장만 보이고, 나머지(높음·낮음 보기)는 펼쳐서 본다.
function guideView(guide) {
  const cut = guide.indexOf(". ") + 1;
  if (!cut) return `<small>${esc(guide)}</small>`;
  return `<details class="guide"><summary>${esc(guide.slice(0, cut))}</summary>${esc(guide.slice(cut).trim())}</details>`;
}

// AI는 채점하지 않는다. 채점 전에 볼 AI 사실·논리 점검 결과를 한 줄로 접어 둔다.
function logicNote() {
  const v = currentLogic();
  if (!v)
    return `<div class="provider-toolbar no-print"><span>AI 사실·논리 점검 전</span>${currentReading() ? button("check-logic", "점검 실행", "", true) : ""}</div>`;
  if (!shownIssues(v).length) return '<p class="ai-report muted">AI 사실·논리 점검 · 오류 후보 없음</p>';
  return `<details class="ai-report"><summary>AI 사실·논리 점검 · ${countText(issueCounts(v))}</summary>${issueList(v)}</details>`;
}

// 1차 심사 채점표: 사전 확인 → 항목별 점수 → 처리 방향. 사람이 채점한다.
// 확정한 채점표를 고칠 때는 앞서 낸 값으로 채운다.
function sheetForm() {
  const prior = state.work.final || {};
  const items = openItems();
  const evaluator = localStorage.getItem("review.evaluator") || "";
  const terms = new Set();
  const rows = join(state.work.rubric.criteria, (c, i) =>
    `<tr><td><b>${esc(c.name)}</b>${guideView(c.guide)}${criterionSummary(c.name, terms)}</td>
      <td class="number"><input name="score" type="number" min="0" max="${c.weight}" step="0.1" required aria-label="${esc(c.name)} 점수"
        value="${prior.scores?.[i] ?? ""}"> / ${c.weight.toFixed(1)}
        <span class="meter" aria-hidden="true"><i style="--fill:${(prior.scores?.[i] ?? 0) / c.weight}"></i></span></td></tr>`);
  return `
    ${
      items.length
        ? `<div class="warning"><b>확정 전에 확인할 항목 ${items.length}건</b><ul class="openitems">${join(items, (x) => claim(x, "li"))}</ul></div>`
        : ""
    }
    ${prior.by && prior.by !== evaluator ? `<div class="warning">${esc(prior.by)} 님이 확정한 채점표입니다. 다른 이름으로 저장하면 평가자가 바뀝니다.</div>` : ""}
    <form id="final" class="stack no-print" data-base="${esc(prior.when || "")}">
      ${choices("사전 확인", "check", state.app.sheet.checks, "checkbox", prior.checks, "감점 아님 · 담당 부서 확인용")}
      <table class="scoretable sheet"><thead><tr><th>항목</th><th>점수</th></tr></thead><tbody>${rows}
        <tr class="total"><td><b>합계</b></td><td class="number"><output id="sheettotal">${(prior.score ?? 0).toFixed(1)}</output> / 10.0
        <span class="meter total" aria-hidden="true"><i id="sheetmeter" style="--fill:${(prior.score ?? 0) / 10}"></i></span></td></tr></tbody></table>
      <div class="sheet-direction">
        ${choices("실행 규모", "scale", state.app.sheet.scales, "radio", [prior.scale])}
        ${choices("1차 결정", "decision", state.app.sheet.decisions, "radio", [prior.decision])}
        ${field("이관 부서", input("sheetdept", prior.department, "text", 'maxlength="80" placeholder="검토를 맡을 부서"'))}
      </div>
      ${field("제안자에게 전달할 의견", `<textarea id="sheetfeedback" maxlength="1000">${esc(prior.feedback || "")}</textarea>`)}
      ${field(items.length ? "확인한 내용과 심사 메모 · 필수" : "심사 메모 · 내부용", `<textarea id="finalnote" maxlength="2000" ${items.length ? "required" : ""}>${esc(prior.note || "")}</textarea>`)}
      ${field("평가자", input("sheetby", evaluator, "text", 'maxlength="40" required autocomplete="name" placeholder="이름"'))}
      <div><button class="primary">${items.length ? `${items.length}건 확인하고 확정` : "채점표 확정"}</button></div>
    </form>`;
}

function confirmedSheet() {
  const f = state.work.final;
  // 항목 점수는 시험지 채점란처럼 칸마다: 항목 이름 아래 색연필 점수 / 배점
  const scores = join(state.work.rubric.criteria, (c, i) =>
    `<div><dt>${esc(c.name)}</dt><dd><b>${f.scores[i].toFixed(1)}</b> / ${c.weight.toFixed(1)}</dd></div>`);
  const rows = [["1차 결정", f.decision], ["실행 규모", f.scale], ["이관 부서", f.department], ["사전 확인", f.checks.join(" · ")],
    ["제안자 의견", f.feedback], ["심사 메모", f.note], ["평가자", `${f.by} · ${seoulMinute(f.when)}`]].filter(([, value]) => value);
  const fresh = state.stampNext; // 방금 확정했을 때 한 번만 찍힌다
  state.stampNext = false;
  return `
    <div class="confirmed">
      <span class="stamp${fresh ? " fresh" : ""}">심사 확정</span>
      <b>${f.score.toFixed(1)}점</b>
    </div>
    <dl class="score-cells" aria-label="항목별 점수">${scores}</dl>
    <dl class="sheet-result">${join(rows, ([name, value]) => `<div><dt>${name}</dt><dd>${esc(value)}</dd></div>`)}</dl>
    <div class="no-print">${button("edit-sheet", "채점표 수정")}</div>`;
}

// 심사자 평가표에서 읽은 점수 (MS Forms 연동 작품)
function evaluationsPanel() {
  const assigned = assignedEvaluators(state.work);
  if (!assigned.length) return "";
  const criteria = state.app.defaults.criteria;
  const rows = join(assigned, (e) => {
    const x = state.work.evaluations?.[e.email];
    if (!x) return `<tr><td>${esc(e.name)}</td><td colspan="${criteria.length + 3}" class="muted">아직 적지 않음</td></tr>`;
    return `<tr><td>${esc(e.name)}</td>${join(x.scores, (s) => `<td class="number">${s ?? "—"}</td>`)}
      <td class="number"><b>${x.score ?? "—"}</b></td><td>${esc([x.scale, x.decision].filter(Boolean).join(" · "))}</td>
      <td>${x.complete ? esc(x.feedback) : `<span class="warn-text">고칠 칸 · ${esc(x.problems.join(", "))}</span>`}</td></tr>`;
  });
  const done = assigned.map((e) => state.work.evaluations?.[e.email]).filter((x) => x?.complete);
  const average = done.length ? (done.reduce((sum, x) => sum + x.score, 0) / done.length).toFixed(2) : "";
  return `<section class="panel evaluations">
    <div class="toolbar"><span><b>심사자 평가</b> · ${done.length} / ${assigned.length}명 완료${average ? ` · 평균 ${average}점` : ""}</span></div>
    <table class="scoretable"><thead><tr>${columnHeaders(["심사자", ...criteria.map((c) => c.name), "총점", "규모·결정", "의견"])}</tr></thead><tbody>${rows}</tbody></table>
  </section>`;
}

export function reportPane() {
  return `${logicNote()}${evaluationsPanel()}
    <section class="panel" id="finalpanel">${state.work.final && !state.editingSheet ? confirmedSheet() : sheetForm()}</section>
    <div class="actions no-print">${button("print", "채점표 인쇄")}</div>
    ${rubricFold()}`;
}

/* ─────────────────────────── 채점 기준 고치기 ─────────────────────────── */

export function criterionRow(c) {
  return `
    <div class="rubedit">
      <input aria-label="항목명" data-k="name" value="${esc(c.name)}">
      <input type="number" aria-label="배점" min="0.1" step="0.1" data-k="weight" value="${esc(c.weight)}">
      <textarea aria-label="판단 기준" data-k="guide">${esc(c.guide)}</textarea>
      <button type="button" data-delk>삭제</button>
    </div>`;
}

// 채점표 끝에 접어 둔 채점 기준(항목·배점·판단 기준) 고치기
function rubricFold() {
  return `<details class="rubric-fold no-print"><summary>채점 기준 고치기 · 항목 ${state.work.rubric.criteria.length}개</summary>
    <form id="rubric">
      <p class="small muted">항목명, 배점(합계 10점), 판단 기준을 입력하세요. 판단 기준의 첫 문장이 채점표에 보입니다. 저장하면 이 작품의 확정 점수는 지워지고 요약은 그대로 남습니다.</p>
      <div id="criteria">${join(state.work.rubric.criteria, criterionRow)}</div>
      <div class="actions spaced">${button("add-criterion", "항목 추가")}<button class="primary">기준 저장</button></div>
    </form></details>`;
}

