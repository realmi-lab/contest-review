// 작품 화면의 틀: 왼쪽 메뉴, 단계 탭, 다음 할 일 버튼, 작업 진행 표시
import { esc, join } from "../lib/html.mjs";
import { autoCaptured, intakePane } from "./captures.mjs";
import { filteredWorks, formsNote, intakeHeadings, intakeValues, queueLabels, queueStage, sortWorks, workStatus } from "./list.mjs";
import { logicPane } from "./logic.mjs";
import { currentLogic, currentReading, splitName } from "./navigation.mjs";
import { reportPane } from "./sheet.mjs";
import { STEP_TABS, logicOn, shownSteps, state } from "./state.mjs";
import { readingPane, summaryUnavailable } from "./summary.mjs";
import { $, button, count, icon } from "./ui.mjs";

// 진행 단계. 끝나지 않은 첫 단계가 '다음 할 일'이다.
// 받은 의견 수: 담당자 의견(Slack 답장). 채점표의 메모는 세지 않는다.
const opinions = () => state.work.slackReplies?.length || 0;
// 오른쪽 위 버튼 하나: 탭마다 그 단계를 다시 하는 버튼(캡처 자료 → 다시 읽어오기, AI 요약 → AI 재요약, AI 논리점검 → AI 재점검).
// 채점표 탭은 이 버튼 없이 내보내기만 둔다.
function nextAction() {
  if (!state.work.captures.length) return autoCaptured() ? [] : ["upload", "캡처 올리기"]; // Forms 첨부는 서버가 캡처한다
  if (state.tab === "자료") return ["reread-captures", "다시 읽어오기"];
  if (state.tab === "결과") return [];
  if (state.tab === "요약") return currentReading() ? ["remake-summary", "AI 재요약"] : [];
  if (currentLogic()) return ["check-logic", "AI 재점검"];
  return currentReading() ? ["check-logic", "AI 논리점검 실행"] : ["open-summary", "AI 요약으로"];
}

// 단계별 완료 여부와 한 줄 설명 (왼쪽 메뉴의 단계 목록)
function stepStates() {
  const reading = currentReading();
  const logic = currentLogic();
  const missing = pageCoverage()?.missing.length;
  return {
    자료: {
      done: state.work.captures.length > 0,
      note: !state.work.captures.length
        ? autoCaptured() ? "첨부 캡처 중" : "캡처 전"
        : `${state.work.captures.length}장${missing ? ` · 빠진 쪽 ${missing}` : ""}`,
    },
    요약: {
      done: !!reading,
      note: reading ? "요약 완료" : "요약 전",
    },
    점검: {
      done: !!logic,
      note: logic ? "AI 의견" : "점검 전",
    },
    결과: {
      done: opinions() > 0,
      note: opinions() ? `의견 ${opinions()}건` : "의견 전",
    },
  };
}

function stepMarker(done, fallback = "") {
  return `<span class="stepno">${done ? icon("check", 14) : fallback}</span>`;
}

// 심사 단계 버튼들. 왼쪽 메뉴(선택한 작품 아래)와 오른쪽 작품 화면 위 탭이 같은 버튼을 쓴다.
function stepItems() {
  const states = stepStates();
  return join(shownSteps().map((key) => [key, STEP_TABS[key]]), ([key, label], i) =>
    `<button type="button" class="stepitem ${state.tab === key ? "active" : ""} ${states[key].done ? "done" : ""}" data-tab="${key}" ${state.tab === key ? 'aria-current="step"' : ""}>` +
    stepMarker(states[key].done, i + 1) +
    `<span class="steptext"><b>${label}</b><small>${esc(states[key].note)}</small></span></button>`);
}
const stepMenu = () => `<div class="stepnav" role="group" aria-label="심사 단계">${stepItems()}</div>`;
const stepTabs = () => `<nav class="steptabs no-print" aria-label="심사 단계">${stepItems()}</nav>`;

// 왼쪽 메뉴: 전체 작품 + 작품 목록 (선택한 작품은 단계 메뉴가 펼쳐짐)
let sidenavHtml = "";
let sidenavScrolled = ""; // 메뉴를 마지막으로 맞춘 작품
export function renderSidebar() {
  if (!state.app) return;
  const navWork = (x) => {
    const title = splitName(x.name)[1]; // 공모전 이름(머리말)은 빼고 작품명만
    const status = workStatus(x);
    const active = x.id === state.selected;
    return (
      `<button type="button" class="navwork ${active ? "active" : ""}" data-work="${x.id}" title="${esc(x.name)}" ${active ? 'aria-current="page"' : ""}>` +
      `<i class="dot stage-${queueStage(x.id) || status.key}"></i><span class="nav-title">${esc(title)}</span></button>` +
      (active && state.work?.id === x.id ? stepMenu() : "")
    );
  };
  const html =
    `<button type="button" id="navall" class="navall ${state.selected ? "" : "active"}" ${state.selected ? "" : 'aria-current="page"'}>전체 작품${count(state.app.works.length)}</button>` +
    join(sortWorks(state.app.works), navWork);
  // 바뀐 경우에만 다시 그려 포커스와 스크롤 위치를 지킨다.
  if (html !== sidenavHtml) $("sidenav").innerHTML = sidenavHtml = html;
  // 단계 목록은 왼쪽 메뉴에만 있으므로, 작품을 고르면 그 작품과 단계가 메뉴에서 보이게 한다.
  if (state.selected && state.selected !== sidenavScrolled) {
    sidenavScrolled = state.selected;
    $("sidenav").querySelector(".stepnav")?.scrollIntoView({ block: "nearest" });
  }
}

// 전체 쪽 수가 입력된 경우, 빠진 쪽 번호를 찾는다.
export function pageCoverage() {
  const total = Math.max(0, ...state.work.captures.map((c) => c.total || 0));
  if (!total) return null;
  const have = new Set(state.work.captures.map((c) => c.page).filter(Boolean));
  const missing = [];
  for (let p = 1; p <= total; p++) if (!have.has(p)) missing.push(p);
  return { total, missing };
}

export function coverageText() {
  const cov = pageCoverage();
  if (!cov?.missing.length) return "";
  const list = cov.missing.slice(0, 8).join(", ");
  return `전체 ${cov.total}쪽 중 빠진 쪽 ${list}${cov.missing.length > 8 ? " 외" : ""}`;
}

export function workView() {
  if (state.tab === "점검" && !logicOn()) state.tab = "요약"; // 논리점검을 끈 뒤 남은 주소(?tab=logic)
  const [action, label] = nextAction();
  const [prefix, title] = splitName(state.work.name);
  const list = filteredWorks();
  const index = list.findIndex((x) => x.id === state.work.id);
  // AI 요약 탭은 제목 글자를 숨긴다(화면 읽기용으로만 남김).
  const panes = {
    자료: intakePane,
    요약: readingPane,
    점검: logicPane,
    결과: reportPane,
  };
  return `
    <div class="detailnav">
      <button type="button" class="link" id="back">${icon("back", 16)}전체 작품</button>
      ${prefix ? `<span class="crumbsep">/</span><span class="crumb">${esc(prefix)}</span>` : ""}
      <span class="spacer"></span>
      ${
        index >= 0
          ? `<button type="button" class="iconbtn" data-step-work="-1" ${index === 0 ? "disabled" : ""} aria-label="이전 작품" title="이전 작품 (K)">${icon("prev")}</button>
             <span class="small muted">${index + 1} / ${list.length}</span>
             <button type="button" class="iconbtn" data-step-work="1" ${index === list.length - 1 ? "disabled" : ""} aria-label="다음 작품" title="다음 작품 (J)">${icon("next")}</button>`
          : ""
      }
    </div>
    ${stepTabs()}
    <article class="sheet card">
    <header class="detailhead">
      <div class="detail-title"><h1 title="${esc(state.work.name)}">${esc(title)}</h1>
        <div class="intake-line">
          <dl class="intake-meta" aria-label="접수 정보">${join(intakeValues(state.work), (value, i) =>
            `<div><dt>${intakeHeadings[i]}</dt><dd>${value}</dd></div>`)}${state.work.category ? `<div><dt>분야</dt><dd>${esc(state.work.category)}</dd></div>` : ""}</dl>
          ${button("edit-intake", "접수 정보 수정", "link")}
          <div id="similar"></div>
        </div>
        ${formsNote(state.work.source)}
      </div>
      <div class="detail-actions">
        ${state.tab === "결과" && state.work.captures.length ? `<a class="button big" href="/api/share/${esc(state.work.id)}" target="_blank" rel="noopener" title="AI 요약·AI 논리점검·캡처 자료를 HTML 한 파일로 엽니다">내보내기</a>` : ""}
        ${action ? `<button id="run" type="button" class="primary big" data-action="${action}">${label}</button>` : ""}
      </div>
    </header>
    <div id="job" class="job" role="status"></div>
    <section id="content" class="content${state.tab === "요약" ? ` reading-content" data-summary-work="${esc(state.work.id)}` : ""}">
      <h2 class="panetitle${state.tab === "요약" ? " sr" : ""}">${STEP_TABS[state.tab]}</h2>
      ${panes[state.tab]()}
    </section>
    </article>`;
}

// 버튼을 쓸 수 없는 이유 (없으면 빈 문자열)
function blockedReason(job, needsEngine) {
  if (state.uploading) return "캡처를 올리는 중입니다.";
  if (!needsEngine) return "";
  if (job) return job.running ? "진행 중인 작업이 끝나면 실행할 수 있습니다." : "이 작품의 대기 작업이 끝나면 실행할 수 있습니다.";
  if (!state.work.captures.length) return "캡처를 먼저 추가하세요.";
  return "";
}

// AI 요약·점검이 도는 동안 진행 막대 위 문구를 2.4초마다 바꿔 배너처럼 돌린다(진행 단계 글은 그 옆에 작게 그대로).
// 새 요소로 바꿔 끼우면 들어오는 애니메이션(work.css .job-ticker)이 다시 돈다.
const TICKER = ["생각하는 중", "원문을 살피는 중", "확인하는 중", "정리하는 중"];
let tick = 0;
setInterval(() => {
  const shown = document.querySelector(".job-ticker i");
  if (!shown) return;
  tick = (tick + 1) % TICKER.length;
  shown.replaceWith(Object.assign(document.createElement("i"), { textContent: TICKER[tick] }));
}, 2400);

export function showJob() {
  for (const group of document.querySelectorAll("[data-summary-work]")) {
    const id = group.dataset.summaryWork;
    for (const b of group.querySelectorAll("[data-summary-command]")) {
      const reason = summaryUnavailable(id);
      b.disabled = !!reason;
      b.title = reason || b.getAttribute("aria-label");
    }
  }
  if (!state.work) {
    const summary = $("queue-summary");
    if (!summary) return;
    const running = [...state.jobsByWork.values()].filter((job) => job.running).length;
    const waiting = state.jobsByWork.size - running;
    const note = state.jobsByWork.size ? `처리 중 ${running}작품 · 대기 ${waiting}작품` : ""; // 할 일이 없으면 비운다
    if (summary.textContent !== note) summary.textContent = note;
    for (const badge of document.querySelectorAll(".workrow [data-queue]")) {
      const stage = queueStage(badge.closest("tr").dataset.work);
      if (badge.dataset.queue === stage) continue;
      badge.dataset.queue = stage;
      badge.hidden = !stage;
      badge.textContent = queueLabels[stage] || "";
    }
    return;
  }
  const box = $("job");
  if (!box) return;
  const job = state.jobsByWork.get(state.work.id);
  const run = $("run");
  const runNeedsEngine = ["check-logic", "remake-summary"].includes(run?.dataset.action);
  const reason = blockedReason(job, runNeedsEngine);
  const failed = state.work.error && !job;
  const text = job
    ? (job.running ? job.label : "처리 대기 · 앞선 작업이 끝나면 시작합니다.")
    : (failed ? "처리 오류 · " + state.work.error : reason);
  // 요약·점검은 진행률 막대(0~100%)를 함께 보여 준다.
  const percent = job?.running ? job.percent : null;
  const bar = box.querySelector(".job-bar i");
  const ticker = job?.running && job.ai ? `<span class="job-ticker"><i>${TICKER[tick]}</i></span>` : "";
  if (percent != null && bar && !box.querySelector(".job-ticker") === !ticker) { // 막대가 이미 있으면 글과 너비만 바꿔 부드럽게 늘어나게 한다
    box.querySelector(".job-label").textContent = text;
    box.querySelector(".job-line b").textContent = percent + "%";
    bar.style.width = percent + "%";
  } else box.innerHTML = percent == null ? esc(text)
    : `<span class="job-line">${ticker}<span class="job-label">${esc(text)}</span><b>${percent}%</b></span><span class="job-bar"><i style="width:${percent}%"></i></span>`;
  box.className = failed ? "job error" : job ? "job" : "job muted";
  if (run) {
    run.disabled = !!reason;
    run.title = reason;
  }
  // 탭 안의 '다시 만들기' 같은 버튼도 같은 조건으로 잠근다.
  for (const b of document.querySelectorAll("#content [data-engine]")) {
    const engineReason = blockedReason(job, true);
    b.disabled = !!engineReason;
    b.title = engineReason;
  }
}

