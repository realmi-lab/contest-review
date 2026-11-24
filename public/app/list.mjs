// 목록 화면: 진행 현황, 작품 목록·검색·정렬, 직접 접수, MS Forms 공모 연동 현황
import { esc, join, seoulMinute } from "../lib/html.mjs";
import { select, splitName } from "./navigation.mjs";
import { costText } from "./render.mjs";
import { state } from "./state.mjs";
import { summaryActions } from "./summary.mjs";
import { $, button, count, dialog, emptyState, field, input } from "./ui.mjs";

/* ─────────────────────────── 상태 표시와 진행 단계 ─────────────────────────── */

export function showHealth() {
  // 이 맥에서 하는 일은 글자 인식(OCR)뿐이다. 요약과 점검은 AI(Haiku)가 한다.
  const { ocrReady } = state.app.health;
  $("health").className = ocrReady ? "online" : "";
  $("health").textContent = ocrReady ? "자료 읽기 준비됨" : "글자 인식 준비 필요";
  $("health").title = `글자 인식(Kordoc) ${ocrReady ? "준비" : "확인 필요"}`;
  $("build").textContent = state.app.build;
}

// 목록의 점 색과 보조 줄
// 목록에 쓰는 진행 단계
const STAGES = {
  new: "캡처 전",
  capt: "요약 전",
  read: "요약 완료",
  checked: "점검 완료",
  final: "심사 확정",
};
export function workStatus(x) {
  const key = x.final
    ? "final"
    : x.hasLogic
      ? "checked"
      : x.hasReading
        ? "read"
        : x.count
          ? "capt"
          : "new";
  const label = key === "final" ? `확정 ${x.score.toFixed(1)}점` : STAGES[key];
  return { key, label };
}

export function queueStage(id) {
  const job = state.jobsByWork.get(id);
  return job ? (job.running ? "run" : "wait") : "";
}

export const queueLabels = { run: "처리 중", wait: "대기" };

// 목록의 진행 상태: 캡처 → 요약 → 점검 → 채점 네 칸 눈금과 글자. 확정은 도장.
const STAGE_STEPS = { new: 0, capt: 1, read: 2, checked: 3 };
function stageMark(status) {
  if (status.key === "final") return `<span class="progress final">${esc(status.label)}</span>`;
  const done = STAGE_STEPS[status.key];
  const steps = [0, 1, 2, 3].map((i) => `<i${i < done ? ' class="on"' : ""}></i>`).join("");
  return `<span class="progress"><span class="steps" aria-hidden="true">${steps}</span>${esc(status.label)}</span>`;
}

// 같은 머리말("공개 추가검증 · …")이 2개 이상이면 묶음 제목으로 한 번만 보여 준다.
export function groupWorks(works) {
  const shared = new Map();
  for (const x of state.app.works) {
    const [prefix] = splitName(x.name);
    if (prefix) shared.set(prefix, (shared.get(prefix) || 0) + 1);
  }
  const groups = new Map();
  for (const x of works) {
    const [prefix, rest] = splitName(x.name);
    const key = shared.get(prefix) > 1 ? prefix : "";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ work: x, title: key ? rest : x.name });
  }
  return [...groups];
}

// 사이드바와 현황판이 같이 쓰는 검색·분야·정렬 결과
// 정렬: 처리할 순서(캡처 전 → 확정) · 접수순 · 확정점수순
export function sortWorks(works) {
  const stageOrder = Object.keys(STAGES);
  const list = [...works];
  if (state.listQuery.sort === "recent")
    list.sort((a, b) => (b.receivedOn || "").localeCompare(a.receivedOn || ""));
  if (state.listQuery.sort === "todo")
    list.sort(
      (a, b) =>
        stageOrder.indexOf(workStatus(a).key) -
        stageOrder.indexOf(workStatus(b).key),
    );
  if (state.listQuery.sort === "score")
    list.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  return list;
}

export function filteredWorks() {
  const needle = state.listQuery.text.toLowerCase();
  return sortWorks(
    state.app.works.filter(
      (x) => x.name.toLowerCase().includes(needle)),
  );
}

export function intakeInputs(record, isNew = false) {
  const prefix = isNew ? "new-" : "edit-";
  // 고칠 때는 제목도, MS Forms로 들어온 작품은 간략 설명도 고친다(저장하면 응답 엑셀에도 적는다)
  const fromForms = !!record.source?.formId;
  return `
    ${isNew ? "" : field("작품명", input("edit-name", record.name, "text", 'name="name" maxlength="140" required'))}
    ${fromForms ? field("간략 설명", `<textarea id="edit-description" name="description" rows="4" maxlength="4000">${esc(record.source.description ?? "")}</textarea>`)
      + `<p class="small muted">작품명과 간략 설명을 고치면 MS Forms 응답 엑셀의 그 칸도 함께 고칩니다.</p>` : ""}
    ${field("인입 날짜", input(prefix + "date", record.receivedOn, "date", 'name="receivedOn"' + (isNew ? " required" : "")))}
    ${field("팀", input(prefix + "team", record.intakeTeam, "text", 'name="intakeTeam" maxlength="80"'))}
    ${field("접수자 이름", input(prefix + "submitter", record.submitterName, "text", 'name="submitterName" maxlength="80"'))}`;
}

export const intakeHeadings = ["인입일", "팀", "접수자"];
export const columnHeaders = (names) => join(names, (label) => `<th scope="col">${esc(label)}</th>`);

// 접수 정보 세 값(intakeHeadings 순서). 목록 표와 작품 머리에서 함께 쓴다.
export function intakeValues(record) {
  const date = record.receivedOn;
  return [
    date ? `<time datetime="${esc(date)}">${esc(date.replaceAll("-", "."))}</time>` : "—",
    esc(record.intakeTeam || "—"),
    esc(record.submitterName || "—"),
  ];
}
// MS Forms로 들어온 작품: 제안자 이메일과 간략 설명(작품 머리, 접수 정보 아래)
export const formsNote = (source) => source?.formId && (source.email || source.description)
  ? `<p class="forms-note">${source.email ? `<a href="mailto:${esc(source.email)}">${esc(source.email)}</a>` : ""}${source.description ? `<span>${esc(source.description)}</span>` : ""}</p>`
  : "";
const intakeCells = (record) => join(intakeValues(record), (value) => `<td>${value}</td>`);

// 목록 화면: 새 작품 접수 줄 + 표 위의 탭(내용 요약 · 사실·논리 점검 · 채점표) + 작품 목록
// 직접 접수 칸. 작품이 없을 때는 목록 화면에, 있을 때는 '새 작품 접수' 대화상자에 둔다.
function createForm(layout) {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
  return `<form id="create" class="${layout}">
      ${intakeInputs({ receivedOn: today }, true)}
      ${field("새 작품명", input("name", "", "text", 'maxlength="140" required placeholder="작품명을 입력하세요"'))}
      <div><button class="primary">작품 접수</button></div>
    </form>`;
}

export function overviewView() {
  const works = state.app.works;
  const create = createForm("quickcreate");
  if (!works.length)
    return `
      <section class="listhead"><h1>전체 작품</h1></section>
      ${formsPanel()}
      ${create}
      <div class="welcome card">
        ${emptyState(
          "아직 접수한 작품이 없습니다",
          "위에 작품명을 적어 접수하거나, 실제 자료 없이 흐름을 보려면 합성 예제를 여세요.",
          `<div class="actions center">${button("sample", "공유 우산 예제")}${button("service-sample", "상담 개선 예제")}</div>`,
        )}
        ${howTo()}
      </div>`;
  // 표 위의 탭: 같은 작품 목록을 단계별 결과로 본다. 숫자는 그 단계를 마친 작품 수
  const viewTab = ([key, { label, done }]) =>
    `<button type="button" class="stagetab" data-list-view="${key}" aria-pressed="${state.listQuery.view === key}">${label}<em>${works.filter(done).length}</em></button>`;
  return `
    <section class="listhead">
      <h1>전체 작품${count(works.length)}</h1>
      <p id="queue-summary"></p>
      <span class="spacer"></span>
      <button type="button" class="link cost-note" data-action="summary-settings" title="토큰 수에 단가를 곱해 이 서버에서 계산한 추정값입니다. 누르면 날짜별로 봅니다.">${costText()}</button>
      ${button("create", "직접 접수")}
      ${button("export-all", "채점 결과 받기 (엑셀)")}
      ${button("batch-summary", "일괄 요약·점검")}
    </section>
    ${formsPanel()}
    <section class="card workboard">
      <div class="listbar">
        <div class="stagetabs" role="group" aria-label="표에 보여 줄 단계">${join(Object.entries(VIEWS), viewTab)}</div>
        <span class="spacer"></span>
        <input id="search" type="search" placeholder="작품명 검색" value="${esc(state.listQuery.text)}" aria-label="작품 검색">
        <select id="sort" aria-label="정렬">
          <option value="todo" ${state.listQuery.sort === "todo" ? "selected" : ""}>처리할 순서</option>
          <option value="recent" ${state.listQuery.sort === "recent" ? "selected" : ""}>접수순</option>
          <option value="score" ${state.listQuery.sort === "score" ? "selected" : ""}>확정점수순</option>
        </select>
      </div>
      <div id="worklist" class="worklist" role="region" aria-label="작품 목록" tabindex="0">${workListHtml()}</div>
    </section>`;
}

// 표 위의 탭마다 보여 주는 열. 접수 정보·작품명·진행 상태는 같고, 가운데 열이 그 단계의 결과다.
// done: 그 단계를 마친 작품인가(탭의 숫자) · heads: 가운데 열 이름 · cells: 가운데 칸들
const summaryCell = (x, brief) => `<td class="cell-wide">${x.hasReading
  ? `${x.title ? `<b class="rowsummary-title">${esc(x.title)}</b>` : ""}${brief && x.title ? "" : `<span class="rowsummary">${esc(x.gist || "요약을 열어 확인하세요.")}</span>`}`
  : `<span class="muted">${x.count ? "요약 전" : "캡처 전"}</span>${summaryActions(x)}`}</td>`;
const issuesCell = (x) => `<td class="cell-number">${x.hasLogic ? x.issues + "건" : "—"}</td>`;
const scoreCell = (x) => `<td class="cell-number">${x.final ? x.score.toFixed(1) + "점" : "—"}</td>`;
const VIEWS = {
  all: { label: "전체", done: () => true, heads: ["핵심 요약", "확인할 점", "확정 점수"],
    cells: (x) => summaryCell(x, true) + issuesCell(x) + scoreCell(x) },
  summary: { label: "내용 요약", done: (x) => x.hasReading, heads: ["핵심 요약"], cells: (x) => summaryCell(x, false) },
  check: { label: "사실·논리 점검", done: (x) => x.hasLogic, heads: ["AI 한마디 평", "확인할 점"],
    cells: (x) => `<td class="cell-wide">${x.hasLogic ? `<span class="rowsummary">${esc(x.take || "점검 결과를 열어 확인하세요.")}</span>`
      : `<span class="muted">${x.hasReading ? "점검 전" : "요약 전"}</span>`}</td>${issuesCell(x)}` },
  sheet: { label: "채점표", done: (x) => x.final, heads: ["분야", "심사자 평가", "확정 점수", "1차 결정"],
    cells: (x, prefix) => `<td class="cell-short">${esc(x.category || prefix || "기타")}</td><td>${evaluationNote(x) || "—"}</td>
      ${scoreCell(x)}<td>${x.decision ? `${esc(x.decision)}<small>${esc(x.scale)}</small>` : "—"}</td>` },
};

// 같은 머리말끼리 묶은 작품 목록 (한 줄에 한 작품)
export function workListHtml() {
  const works = filteredWorks();
  if (!works.length) return emptyState("조건에 맞는 작품이 없습니다", "검색어를 지워 보세요.");
  const view = VIEWS[state.listQuery.view];
  return `<table class="works-table view-${state.listQuery.view}" aria-label="작품별 ${view.label}">
    <thead><tr>${columnHeaders([...intakeHeadings, "작품명", ...view.heads, "진행 상태"])}</tr></thead>
    ${join(groupWorks(works), ([prefix, items]) => `<tbody>${join(items, (item) => workRow(item, prefix, view))}</tbody>`)}
  </table>`;
}

function workRow({ work: x, title }, prefix, view) {
  const stage = queueStage(x.id);
  return `<tr class="workrow" data-work="${esc(x.id)}">
    ${intakeCells(x)}
    <th scope="row"><button class="rowtitle" type="button" data-work="${esc(x.id)}" title="${esc(x.name)}"><span>${esc(title)}</span></button></th>
    ${view.cells(x, prefix)}
    <td><span class="badges"><span data-queue="${stage}" class="badge" ${stage ? "" : "hidden"}>${queueLabels[stage] || ""}</span>${stageMark(workStatus(x))}</span>${x.duplicates ? `<small class="warn-text">중복 판정 ${x.duplicates}건</small>` : ""}</td>
  </tr>`;
}

// MS Forms 공모 연동 현황(설정: deploy/site.json의 forms). 응답은 1분마다 들어오고, 심사 배포는 버튼으로 한다.
const SHARE_BADGES = { "공유 완료": "badge-ok", "공유 대기": "badge-warn" };
function formsPanel() {
  const v = state.app.intake;
  if (!v?.configured) return v?.error ? `<div class="warning spaced">MS Forms 연동 설정 · ${esc(v.error)}</div>` : "";
  const gaps = Object.entries(v.unassigned);
  const rows = join(v.evaluators, (e) => `<tr>
    <td><b>${esc(e.name)}</b><small>${esc(e.email)}</small></td><td>${esc(e.categories.join(" · "))}</td><td class="number">${e.assigned}건</td>
    <td><span class="badge ${SHARE_BADGES[e.share] || "badge-muted"}">${esc(e.share)}</span></td>
    <td class="number">${e.done} / ${e.assigned}${e.fix ? `<small class="warn-text">고칠 칸 ${e.fix}건</small>` : ""}${e.error ? `<small class="warn-text">${esc(e.error)}</small>` : ""}</td>
    <td>${e.readAt ? esc(seoulMinute(e.readAt).slice(5)) : "—"}</td></tr>`);
  return `<section class="card forms-intake">
    <div class="toolbar"><h2 class="cardtitle">MS Forms 공모</h2><span class="muted">응답 ${v.responses}건${v.waiting ? ` · 첨부 동기화 대기 ${v.waiting}건` : ""}${v.checkedAt ? ` · ${esc(seoulMinute(v.checkedAt).slice(11))} 확인` : ""}</span>
      <span class="spacer"></span>${button("intake-sync", "지금 가져오기")}${button("distribute", "심사 배포")}</div>
    ${v.error ? `<p class="warn-text small">${esc(v.error)}</p>` : ""}
    ${gaps.length ? `<p class="warn-text small">심사자가 없는 분야 · ${esc(gaps.map(([c, n]) => `${c} ${n}건`).join(" · "))}</p>` : ""}
    ${v.evaluators.length ? `<table class="scoretable evaluators"><thead><tr>${columnHeaders(["심사자", "담당 분야", "배정", "공유", "평가 완료", "평가표 읽음"])}</tr></thead><tbody>${rows}</tbody></table>`
      : '<p class="small muted">연동 설정에 심사자(evaluators)를 적으면 분야별로 배정합니다.</p>'}
  </section>`;
}
// MS Forms 작품의 담당 심사자(분야로 배정)
export const assignedEvaluators = (x) => (x.formId ?? x.source?.formId) ? (state.app.intake?.evaluators ?? []).filter((e) => e.categories.includes(x.category)) : [];
// 목록의 평가 진행: 다 채운 평가표 수 / 배정 수 · 평균
function evaluationNote(x) {
  const assigned = assignedEvaluators(x).length;
  return assigned ? `평가 ${x.evalDone} / ${assigned}${x.evalAvg != null ? ` · 평균 ${x.evalAvg}` : ""}` : "";
}

export function openDistribute() {
  const v = state.app.intake;
  dialog("심사 배포", `<form id="distribute" class="stack">
    <p>심사자 ${v.evaluators.length}명에게 담당 분야의 작품을 배정합니다. OneDrive에 심사자 폴더를 만들어 첨부와 평가표 엑셀을 넣고, Power Automate가 폴더를 공유하도록 요청 파일을 남깁니다.</p>
    <p class="small muted">이미 만든 평가표는 새로 배정된 작품이 있을 때만 다시 쓰고, 심사자가 적은 값은 그대로 둡니다. 공유한 심사자에게는 다시 요청하지 않습니다.</p>
    <div class="actions"><button class="primary">배포</button></div></form>`);
}

function howTo() {
  return `
    <ol class="howto">
      <li><b>캡처 자료</b>제출 문서의 화면을 이미지로 올리고 빠짐없이 들어왔는지 확인합니다.</li>
      <li><b>내용 요약</b>AI가 핵심 내용을 정리하고 원문 근거를 연결합니다.</li>
      <li><b>사실·논리 점검</b>요약에 이어 AI가 수치·조건 불일치와 논리 비약을 찾습니다.</li>
      <li><b>채점표</b>항목별 점수와 처리 방향을 남기고 확정합니다.</li>
    </ol>`;
}

// 목록의 '직접 접수': 작품이 없으면 목록 화면의 접수 칸으로, 있으면 대화상자로
export async function openCreate() {
  if (state.selected) await select("");
  if (!state.app.works.length) return $("name")?.focus();
  dialog("새 작품 접수", createForm("stack"));
  $("name").focus();
}

