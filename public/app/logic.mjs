// AI 논리점검 탭: 점검 결과와 'AI가 본 이 아이디어'
import { esc, join, markNumbers, sentences } from "../lib/html.mjs";
import { currentLogic, currentReading } from "./navigation.mjs";
import { haikuUsage } from "./summary.mjs";
import { button, claim, emptyState, icon, refs, richText } from "./ui.mjs";

// 점검 결과 분류: 계산으로 확인 · 확인 필요(재검토로 확정) · 참고(재검토에서 확정하지 못한 후보)
const BADGES = { "계산으로 확인": "badge-danger", 참고: "badge-muted" };
// 참고는 평가자가 읽는 요약 문장에 대한 것만 보여 준다. 원문 안의 불일치·인과 해석은 평가자가 원문을 읽으며
// 직접 판단하고, 확정하지 못한 것은 대부분 소음이었다(30개 작품의 참고 63건 중 57건).
export const shownIssues = (v) => v.issues.filter((i) => i.status !== "참고" || i.type === "요약과 원문 불일치");
// 참고가 아닌 항목 수와 참고 항목 수
export const issueCounts = (v) => {
  const issues = shownIssues(v);
  const hints = issues.filter((i) => i.status === "참고").length;
  return { main: issues.length - hints, hints };
};
export const countText = ({ main, hints }) => `확인할 항목 ${main}건${hints ? ` · 참고 ${hints}건` : ""}`;
// 점검 결과 목록. 참고는 소음이 되지 않게 아래에 접어 둔다.
export function issueList(v) {
  const issues = shownIssues(v);
  const hints = issues.filter((i) => i.status === "참고");
  const terms = new Set();
  return join(issues.filter((i) => i.status !== "참고"), (x, i) => issueCard(x, terms, i + 1)) + (hints.length
    ? `<details class="hints"><summary>참고 ${hints.length}건 · 재검토에서 확정하지 못한 요약 문장</summary>${join(hints, (x) => issueCard(x, terms))}</details>`
    : "");
}

// 점검 항목 하나: 시험지 문항처럼 번호 · 상태 · 종류, 이유, 서로 맞지 않는 두 구절(쪽 칩과 수치 표시)
function issueCard(x, terms, no) {
  // 원문 구절은 쪽 칩을, 요약 문장(P 번호)은 '요약 구절'이라는 이름을 단다
  const quote = (label, q, cls = "") => {
    const fromSummary = /^P\d/.test(q.id ?? "");
    return `<blockquote${cls}><small>${fromSummary ? "요약 구절" : label}${/^S\d/.test(q.id ?? "") ? refs([q.id]) : ""}</small>“${markNumbers(q.quote)}”</blockquote>`;
  };
  const quotes = x.claim
    ? `<div class="quotes">${quote("검토 구절", x.claim)}${quote("대조 구절", x.contrast, ' class="contrast"')}</div>`
    : "";
  return `
    <article class="issue${x.status === "계산으로 확인" ? " confirmed-issue" : ""}">
      ${no ? `<b class="issue-no">${no}</b>` : ""}
      <div class="issue-head">
        <span class="badge ${BADGES[x.status] || "badge-warn"}">${esc(x.status)}</span>
        <span class="issue-type">${esc(x.type)}</span>
        ${x.claim ? "" : `<span class="spacer"></span>${refs(x.refs)}`}
      </div>
      <p class="issue-reason">${richText(x.reason, terms)}</p>${quotes}
      ${x.review ? `<p class="issue-review"><b>재검토</b>${richText(x.review, terms)}</p>` : ""}
    </article>`;
}

// 점검 탭의 'AI가 본 이 아이디어'(idea-opinion.mjs)를 한눈에 보는 카드로 보여 준다:
// 한마디 평 → 잘된 점(초록)·확인할 점(노랑) → 제안자에게 물어볼 것 → 법·컴플라이언스 확인(흰 카드). 점수·채택 판단은 하지 않는다.
// 글자: 제목은 빗썸 고딕, 내용은 Pretendard, 크기는 모두 본문 크기 하나.
// 잘된 점·확인할 점은 줄마다 첫 문장을 굵은 제목으로, 나머지를 작은 설명으로 둬 훑어보기 쉽게 한다.
function opinionPanel(o) {
  if (!o) return "";
  if (o.error) return `<p class="small muted">AI가 본 이 아이디어를 쓰지 못했습니다 · ${esc(o.error)}</p>`;
  const terms = new Set();
  const asPoint = (x) => (typeof x === "string" ? { text: x, refs: [] } : x);
  const headed = (x) => {
    const p = asPoint(x);
    const [head, ...rest] = sentences(p.text);
    return `<li><b>${esc(head)}${rest.length ? "" : refs(p.refs)}</b>${rest.length ? claim({ ...p, text: rest.join(" ") }, "div", "", terms) : ""}</li>`;
  };
  const plain = (x) => claim(asPoint(x), "li", "", terms);
  const card = (cls, mark, title, items, line, tag = "ul") => items.length
    ? `<section class="opinion-card ${cls}"><h4>${icon(mark, 18)}${title}<em>${items.length}</em></h4><${tag}>${join(items, line)}</${tag}></section>` : "";
  return `<section class="opinion">
    <h3>AI가 본 이 아이디어</h3>
    ${o.take ? `<p class="opinion-take">${esc(o.take)}</p>` : ""}
    <div class="opinion-grid">${card("good", "check", "잘된 점", o.strengths, headed)}${card("warn", "alert", "확인할 점", o.weaknesses, headed)}</div>
    ${card("ask", "help", "제안자에게 물어볼 것", o.questions, plain, "ol")}
    ${complianceCard(o.compliance, terms)}
    <small class="muted">AI 의견입니다. 점수와 채택 판단은 하지 않습니다.</small>
  </section>`;
}

// 법·컴플라이언스 확인(맨 아래): 분야 이름표와 담당 부서가 확인할 점. 위반 판단이 아니다. 이 항목이 생기기 전에 점검한 작품은 다시 점검하면 나온다.
function complianceCard(items, terms) {
  if (!items) return '<p class="small muted">법·컴플라이언스 확인은 AI 논리점검을 다시 실행하면 나옵니다.</p>';
  if (!items.length) return "";
  return `<section class="opinion-card legal"><h4>${icon("shield", 18)}법·컴플라이언스 확인<em>${items.length}</em></h4>
    <ul>${join(items, (x) => `<li><span class="legal-area">${esc(x.area)}</span>${claim(x, "div", "", terms)}</li>`)}</ul>
    <small class="muted">위반 여부 판단이 아니라 법무·컴플라이언스 담당이 확인할 점입니다.</small></section>`;
}

export function logicPane() {
  if (!currentReading())
    return emptyState(
      "요약이 먼저 필요합니다",
      "AI 논리점검은 현재 자료의 AI 요약을 원문과 대조합니다.",
    );
  const v = currentLogic();
  const usage = haikuUsage("logic", v);
  if (!v)
    return emptyState(
      "요약을 아직 점검하지 않았습니다",
      "요약의 단정이 원문에 있는지, 같은 대상의 수치나 일정이 충돌하는지, 목표가 실적으로 바뀌었는지 점검합니다.",
      button("check-logic", "AI 논리점검 실행", "primary", true),
    ) + usage;
  // 오류 후보 목록(계산으로 확인 · 원문 대조 필요 · 참고)은 오히려 헷갈려 보여 주지 않는다(2026-11-23 사용자 결정).
  return opinionPanel(v.opinion) + usage;
}

