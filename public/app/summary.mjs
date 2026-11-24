// AI 요약 탭: AI 요약, 사용량·비용, 비슷한 제안
import { explainOcr, readingViews, representativeCaptures } from "../lib/expanded-reading.mjs";
import { esc, join } from "../lib/html.mjs";
import { currentReading, splitName, sync } from "./navigation.mjs";
import { cloudScope, state, submittingSummaries } from "./state.mjs";
import { $, api, claim, emptyState, glossaryNote, refs } from "./ui.mjs";

/* ─────────────────────────── AI 요약 탭 ─────────────────────────── */

// 줄 목록 모양: 핵심 요약은 촘촘한 개조식(main), 세부 요약은 예전 핵심 요약처럼 크게(lead). 예전 형식은 핵심만 크게 보여 준다.
const listClass = (lead, former) => (former ? (lead ? " lead" : "") : lead ? " lead main" : " lead");
// 핵심 요약(제목 아래 한 줄 요약·배경·내용·효과)과 세부 요약(문제 → 목표 → 방법 → 결과 → 시사점), 두 묶음만 한 화면에 차례로 보여 준다.
const MAIN = "핵심 요약", TITLE = "제목";
function summaryGroups(r) {
  const { brief, detail } = readingViews(r);
  return [[MAIN, brief], ["세부 요약", detail]].filter(([, points]) => points.length);
}
const summaryPoints = (r) => summaryGroups(r).flatMap(([, points]) => points);

export function ocrDifference(c, issue, index) {
  const item = explainOcr(issue);
  const height = Number.isFinite(issue.box?.h) ? " · 판독 영역 높이 " + Math.round(issue.box.h) + "px" : "";
  return `<div class="ocr-difference"><button type="button" class="ref" data-capture="${esc(c.id)}" data-ocr-index="${index}">${esc(c.label)} · 위치 보기</button>
    <p>${esc(item.reason)}</p><dl><dt>기본</dt><dd>${esc(item.basic)}</dd><dt>정밀</dt><dd>${esc(item.fine)}</dd></dl>
    <small>${esc(item.crop + height)}</small></div>`;
}

// 요점 옆에 붙는 근거 그림. 누르면 원본 캡처를 연다.
function figureButton(img) {
  const url = "/api/image/" + esc(img.capture);
  const preview = img.viewBox
    ? `<svg class="summary-preview" aria-hidden="true" viewBox="${img.viewBox.join(" ")}"><image href="${url}" width="${img.width}" height="${img.height}"/></svg>`
    : `<img class="summary-preview" loading="lazy" src="${url}?size=thumb" alt="">`;
  return `<button type="button" class="summary-image" data-gallery="${esc(img.capture)}" data-source-ref="${esc(img.ref)}" aria-haspopup="dialog" title="${esc(img.label)} 원본 열기">
    ${preview}<small>${img.page ? esc(img.page) + "쪽" : esc(img.label)} · 원본 열기</small></button>`;
}

export function summaryUnavailable(id) {
  if (submittingSummaries.has(id) || state.jobsByWork.has(id)) return "이 작품의 작업이 끝나면 실행할 수 있습니다.";
  if (state.work?.id === id && state.uploading) return "캡처를 올리는 중입니다.";
  if (!state.app.works.find((x) => x.id === id)?.count) return "캡처를 먼저 추가하세요.";
  return "";
}

// 요약 만들기 버튼. [data-summary-work] 안에 두면 누를 수 없는 이유(작업 중 등)가 자동으로 반영된다(showJob).
function summaryCommand(workId, label, text = label, cls = "") {
  const reason = summaryUnavailable(workId);
  return `<button type="button" class="${cls}" data-summary-command="make" aria-label="${label}" title="${reason || label}" ${reason ? "disabled" : ""}>${text}</button>`;
}

// 전체 작품 목록에서 요약이 없는 작품에만 붙는 작은 요약 버튼. 다시 만들기는 작품 화면에서 한다.
export function summaryActions(record) {
  return `<div class="summary-actions no-print" data-summary-work="${esc(record.id)}">${
    summaryCommand(record.id, esc(record.name) + " 요약 만들기", "요약")}</div>`;
}

export const usd = new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 8,
});
export function haikuUsage(kind, result) {
  const noun = kind === "summary" ? "요약" : "점검";
  const last = state.work.lastHaikuUsage?.[kind];
  function meter(u, label) {
    if (u.totalTokens === null)
      return `<p class="small muted">${label} · ${u.requests ? "API 응답에서 사용량을 확인할 수 없습니다." : "사용량 응답 대기 중"}</p>`;
    const cells = [["일반 입력", u.inputTokens], ["출력", u.outputTokens],
      ["캐시 읽기", u.cacheReadTokens], ["캐시 쓰기", u.cacheWriteTokens]];
    const coverage = u.measured < u.requests ? ` · 사용량이 확인된 ${u.measured}/${u.requests}회 합계` : ` · API ${u.requests}회`;
    return `<div class="haiku-usage" aria-label="${label}"><div><strong>${label}</strong>
      <span>총 ${u.totalTokens.toLocaleString("ko-KR")} 토큰${coverage}</span>
      <span>예상 비용 <b>${u.estimatedUsd === null ? "확인 불가" : usd.format(u.estimatedUsd)}</b></span></div>
      <dl>${join(cells, ([name, n]) => `<div><dt>${name}</dt><dd>${n.toLocaleString("ko-KR")}</dd></div>`)}</dl>
      </div>`;
  }
  let html = result?.usage ? meter(result.usage, "이번 " + noun + "의 하이쿠 사용량")
    : result ? `<p class="small muted">하이쿠 사용량 · 기록 기능 도입 전 ${noun}으로 토큰과 비용 기록이 없습니다.</p>` : "";
  if (result?.usage && result.reusedExtraction)
    html += '<p class="small muted">이전 요점을 재사용했고 이번 실행의 API 호출만 합산했습니다.</p>';
  if (last && last.runId !== result?.usage?.runId && (kind === "summary" || last.readingId === state.work.cloudReading?.id))
    html += meter(last, "최근 " + noun + " 실행 확인분");
  // 토큰·비용은 관리용이라 결과 아래에 접어 둔다.
  return html ? `<details class="usage-fold no-print"><summary>AI 사용량·비용</summary>${html}</details>` : "";
}
export function readingPane() {
  const r = currentReading(); // 요약이 있으면 다시 만드는 'AI 재요약'은 작품 머리의 버튼이다(work-page.mjs)
  const usage = haikuUsage("summary", r); // 요약 아래에는 토큰 사용량과 비용만 둔다
  if (!r)
    return emptyState("요약이 없습니다", cloudScope(),
      summaryCommand(state.work.id, "요약 만들기", "요약 만들기", "primary big")) + usage;
  const groups = summaryGroups(r);
  const former = !summaryPoints(r).some((p) => p.topic === TITLE) && summaryPoints(r).some((p) => p.topic === "한 줄 요약"); // 예전 형식(한 줄 요약 → 문제 → … → 한계)으로 저장된 요약
  const lastWeek = summaryPoints(r).some((p) => p.topic === "결과·근거"); // 세부 요약이 결과·근거 → 한계였던 형식
  const gist = (p) => p.topic === "한 줄 요약";
  // 근거 그림은 세부 요약에만 붙인다(핵심 요약은 글만 촘촘하게). 예전 형식은 전처럼 한 줄 요약만 빼고 붙인다.
  const pictured = former ? summaryPoints(r).filter((p) => !gist(p)) : readingViews(r).detail;
  const figures = new Map(representativeCaptures(r, state.work.captures, pictured).map((f) => [f.point, f]));
  const terms = new Set();
  // 핵심 요약 줄에는 쪽 번호를 붙이지 않는다(글만 촘촘하게). 세부 요약·예전 형식은 쪽 번호로 원문을 찾아간다.
  const item = (lead) => (p, i) => {
    const figure = figures.get(p);
    const shown = lead && !former ? { ...p, refs: [] } : p;
    const cls = [figure ? "with-figure" : "", gist(p) ? "gist" : ""].filter(Boolean).join(" ");
    return `<li${cls ? ` class="${cls}"` : ""} data-topic="${esc(p.topic)}" style="--i:${i}"><b>${esc(p.topic)}</b>${claim(shown, "div", "", terms)}${figure ? figureButton(figure) : ""}</li>`;
  };
  // 비워 둔 물음. 다른 줄로 메우지 않고, 내용을 찾지 못했는지 쓴 문장이 원문 대조에서 떨어졌는지 심사자에게 알린다.
  const missing = (r.edition?.missing || []).map((m) => `${m.topic}(${m.why === "답 없음" ? "내용을 찾지 못함" : "원문 대조 미통과"})`);
  const unfilled = missing.length ? `<p class="summary-missing"><b>비워 둔 항목</b>${esc(missing.join(" · "))} — 원문에서 직접 확인하세요.</p>` : "";
  const summary = `<section class="read-section summary-edition">
    ${groups.length ? join(groups, ([heading, points]) => {
      const lead = heading === MAIN;
      // 핵심 요약의 제목은 줄 목록 위에 따로 크게 둔다(문서 전체를 말하므로 근거 쪽은 붙이지 않는다).
      const title = lead && points.find((p) => p.topic === TITLE);
      return `<div class="summary-group${lead ? "" : " summary-detail"}"><h2>${heading}</h2>${title ? `<p class="summary-title">${esc(title.text)}</p>` : ""}
        <ul class="summary-points${listClass(lead, former)}">${join(points.filter((p) => p !== title), item(lead))}</ul></div>`;
    }) :
      `<h2>${MAIN}</h2><p>이 화면에 추가할 확인된 요점이 없습니다.</p>`}
    ${unfilled}
    ${glossaryNote(summaryPoints(r))}
    ${former || lastWeek ? '<small class="muted">예전 형식의 요약입니다. AI 재요약을 누르면 핵심 요약(제목·배경·내용·효과)과 세부 요약(문제·목표·방법·결과·시사점)으로 바뀝니다.</small>' : ""}
    ${r.edition?.version !== 1 ? '<small class="muted">이전 형식으로 저장된 요약입니다. 같은 모델로 다시 요약하면 새 형식으로 볼 수 있습니다.</small>' : ""}</section>`;
  const alerts = join(r.sourceAlerts || [], (a) =>
    `<p class="warning"><strong>원문 설명이 다른 부분</strong> · ${esc(a.reason)} ${refs(a.refs)}</p>`);
  return summary + alerts + usage;
}

/* ─────────────────────────── 비슷한 제안 (similar.mjs) ─────────────────────────── */

let similarCache = { key: "", items: [] };
let similarOpenFor = ""; // 판정을 누른 작품은 다시 그려도 펼친 채로 둔다
export async function showSimilar() {
  if (!state.work || !$("similar")) return;
  const key = state.work.id + state.work.updated;
  if (similarCache.key !== key) similarCache = { key, items: await api("similar/" + state.work.id) };
  if (state.work?.id + state.work?.updated === key && $("similar")) $("similar").innerHTML = similarHtml(similarCache.items);
}
const SIMILAR_MARKS = ["중복", "관련", "무관"];
function similarHtml(items) {
  if (!items.length) return "";
  const level = (score) => (score >= 0.35 ? "매우 비슷" : score >= 0.2 ? "비슷" : "조금 비슷");
  const duplicates = items.filter((x) => x.mark === "중복").length;
  return `<details class="similar no-print" ${similarOpenFor === state.work.id ? "open" : ""}>
    <summary>비슷한 제안 ${items.length}건${duplicates ? ` · 중복 판정 ${duplicates}건` : ""}</summary>
    <ul>${join(items, (x) => `<li>
      <span><button type="button" class="link" data-work="${esc(x.id)}">${esc(splitName(x.name)[1])}</button>
        <small>${level(x.score)} ${Math.round(x.score * 100)}% · 겹치는 말 ${esc(x.words.join(", "))}</small></span>
      <span class="marks" role="group" aria-label="판정">${join(SIMILAR_MARKS, (m) =>
        `<button type="button" data-similar-mark="${x.mark === m ? "" : m}" data-other="${esc(x.id)}" aria-pressed="${x.mark === m}">${m}</button>`)}</span>
    </li>`)}</ul></details>`;
}
export async function markSimilar(other, mark) {
  similarOpenFor = state.work.id;
  await api("similar-mark", { id: state.work.id, other, mark });
  await sync(true);
}

