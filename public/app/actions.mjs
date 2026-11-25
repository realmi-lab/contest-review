// 버튼 동작: 요약 실행 도우미와 data-action 이름 → 처리 함수
import { esc } from "../lib/html.mjs";
import { changeCapture, openScreen, snapScreen, suggestedVisual } from "./captures.mjs";
import { workRef } from "./forms.mjs";
import { filteredWorks, intakeInputs, openCreate } from "./list.mjs";
import { currentEvidence, select, sync } from "./navigation.mjs";
import { render } from "./render.mjs";
import { formsPick, openFormsSettings, openSelfCheck, openSummarySettings, showSelfCheck } from "./settings.mjs";
import { aiLabel, cloudScope, state, submittingSummaries } from "./state.mjs";
import { markSimilar, summaryUnavailable } from "./summary.mjs";
import { $, api, button, closeDialog, dialog, notify } from "./ui.mjs";
import { closeViewer, openCaptureGallery, showRef, showUncertain, zoomCaptureDetail } from "./viewer.mjs";
import { pageCoverage, showJob } from "./work-page.mjs";
import { pickPerson, sendToPerson } from "./slack.mjs";

// 요약과 AI 논리점검은 Claude Haiku로 실행한다. 요약을 만들면 서버가 점검까지 이어서 한다.
async function startJob(route, nextTab) {
  const summary = route === "summarize" || route === "check-logic";
  const target = workRef();
  if (summary) {
    const settings = await api("summary-settings");
    if (state.selected !== target.id || state.work?.rev !== target.rev) return;
    if (!settings.configured) return openSummarySettings();
    const scope = route === "summarize" ? "요약에 이어 AI 논리점검까지 실행합니다.\n" : "";
    if (!confirm(`${state.work.name}\n${scope}${cloudScope()}\n${aiLabel()}로 실행할까요?`)) return;
  }
  await api(route, target);
  if (state.selected !== target.id) return;
  if (route === "summarize") closeViewer();
  state.tab = nextTab;
  await sync(true);
}

async function runSummaryCommand(id) {
  if (summaryUnavailable(id)) return;
  submittingSummaries.add(id);
  try {
    if (state.selected !== id) await select(id);
    if (state.selected !== id || state.work?.id !== id) return;
    showJob();
    await startJob("summarize", "요약");
  } finally {
    submittingSummaries.delete(id);
    if (state.app) showJob();
  }
}

export async function setComplete(complete) {
  await api("settings", { ...workRef(), rubric: state.work.rubric, complete });
  await sync(true);
}

const actions = {
  "summary-settings": openSummarySettings,
  create: openCreate,
  "intake-sync": async () => {
    const v = await api("intake-sync", {});
    notify(v.error ? `가져오기 · ${v.error}` : "MS Forms 응답과 평가표를 다시 읽었습니다.", !!v.error);
    await sync(true);
  },
  "link-web-browser": async () => { location.assign((await api("summary-link", {})).url); },
  "slack-go": sendToPerson, // 채점표 탭의 담당자에게 보내기
  "edit-intake": () => dialog(
    "접수 정보 수정",
    `<form id="edit-intake" class="stack" data-id="${esc(state.work.id)}" data-version="${state.work.intakeVersion ?? 0}">
      ${intakeInputs(state.work)}
      <div><button class="primary">저장</button></div>
    </form>
    <div class="dangerzone"><span class="small muted">작품과 캡처·요약·채점표를 모두 지우며 되돌릴 수 없습니다.</span>${button("remove-work", "작품 삭제", "danger")}</div>`,
  ),
  sample: async () => select((await api("sample", { kind: "umbrella" })).id),
  "service-sample": async () =>
    select((await api("sample", { kind: "service" })).id),
  // 다음 할 일 버튼
  upload: async () => {
    await switchTab("자료");
    $("files").click();
  },
  // 캡처를 모두 지우면 빈 접수 칸(끌어 놓기·파일 선택)이 다시 나온다.
  "reset-captures": async () => {
    if (!confirm(`캡처 ${state.work.captures.length}장을 모두 지우고 새로 올립니다.\n지금의 요약·점검·확정 채점표는 새 자료로 다시 만들어야 합니다.`)) return;
    await api("reset-captures", workRef());
    closeViewer();
    await sync(true);
    notify("캡처를 모두 지웠습니다. 새 파일을 올려 주세요.");
  },
  "confirm-complete": async () => {
    const missing = pageCoverage()?.missing || [];
    if (
      missing.length &&
      !confirm(
        `빠진 쪽(${missing.slice(0, 8).join(", ")})이 있습니다. 그래도 빠짐없음으로 표시할까요?`,
      )
    )
      return;
    await setComplete(true);
  },
  "open-summary": () => switchTab("요약"),
  "reread-captures": async () => {
    if (!confirm(`캡처 ${state.work.captures.length}장을 원본 문서에서 다시 읽어 옵니다(원본이 없는 화면 캡처는 글자만 다시 읽습니다).\n지금의 요약·점검은 다시 만들어야 합니다.`)) return;
    await api("reread-captures", workRef());
    await sync(true);
  },
  "check-logic": () => startJob("check-logic", "점검"),
  "remake-summary": () => runSummaryCommand(state.work.id), // AI 요약 탭 머리의 'AI 재요약'
  screen: openScreen,
  snap: snapScreen,
  "mark-visual": async () => {
    const ids = suggestedVisual().map((c) => c.id);
    if (!ids.length || !confirm(`도식 검토 추천 ${ids.length}쪽을 도식 검토로 지정할까요?\n다음 요약부터 이 쪽들은 이미지도 AI에 보내 읽습니다. 지금의 요약·점검·확정 채점표는 다시 만들어야 합니다.`)) return;
    const { count } = await api("visual", { ...workRef(), captures: ids });
    notify(`${count}쪽을 도식 검토로 지정했습니다. AI 요약을 다시 만들면 반영됩니다.`);
    await sync(true);
  },
  "forms-settings": openFormsSettings,
  "self-check": openSelfCheck,
  "self-check-run": async () => {
    await api("self-check", {});
    await showSelfCheck();
  },
  "choose-source": async (b) => {
    const { path, label } = await api("forms-choose", { kind: b.dataset.pick });
    if (!path) return; // 선택 창에서 취소
    formsPick[b.dataset.pick] = path;
    $(b.dataset.pick + "-label").textContent = label;
    $(b.dataset.pick + "-label").className = "picked";
  },
  "remove-work": async () => {
    if (!confirm(`${state.work.name} 작품과 저장된 캡처 및 채점표를 삭제할까요?`))
      return;
    await api("remove-work", { id: state.work.id, rev: state.work.rev });
    await select("");
  },
};

// 실행하는 동안 버튼을 잠가 두 번 누르는 것을 막는다.
async function runAction(b, name) {
  b.disabled = true;
  try {
    await actions[name]?.(b);
  } finally {
    b.disabled = false;
  }
}

// 목록 순서대로 이전·다음 작품으로 이동
export function stepWork(delta) {
  const list = filteredWorks();
  const next = list[list.findIndex((x) => x.id === state.work.id) + delta];
  if (next) return select(next.id);
}

export async function switchTab(next) {
  const from = document.activeElement?.closest(".steptabs") ? ".steptabs" : "#sidenav"; // 누른 쪽 탭에 포커스를 돌려준다
  state.tab = next;
  await render();
  document.querySelector(`${from} [data-tab="${next}"]`)?.focus();
}

function acknowledgeHome(button) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const spark = button.querySelector(".brand-spark");
  if (!spark) return;
  for (const animation of spark.getAnimations()) animation.cancel();
  spark.animate([
    { opacity: 0, transform: "translate(-3px, 4px) scale(.65)" },
    { opacity: 1, transform: "translate(0, 0) scale(1.1)", offset: .4 },
    { opacity: 0, transform: "translate(2px, -4px) scale(.85)" },
  ], { duration: 320, easing: "ease-out" });
}

export async function onClick(e) {
  if (e.target.matches(".capture-stage, #dialog:has(.capture-stage)")) return closeDialog();
  const b = e.target.closest("button, tr.workrow");
  if (!b) return;
  const d = b.dataset;
  const menu = $("menu-toggle");
  const menuOpen = menu?.getAttribute("aria-expanded") === "true";
  if (b === menu) {
    menu.setAttribute("aria-expanded", String(!menuOpen));
    return;
  }
  const fromMobileNav = menuOpen && $("sidenav").contains(b);
  if (menuOpen) menu.setAttribute("aria-expanded", "false");
  if (b.id === "home") acknowledgeHome(b);
  if (["home", "back", "navall"].includes(b.id)) {
    await select("");
    $("main").focus();
    return;
  }
  if (fromMobileNav) {
    if (d.work) await select(d.work);
    else if (d.tab) switchTab(d.tab);
    $("main").focus();
    return;
  }
  if (d.stepWork) return stepWork(Number(d.stepWork));
  if (d.slackUser) return pickPerson(b);
  if (d.summaryCommand) return runSummaryCommand(b.closest("[data-summary-work]").dataset.summaryWork);
  if (d.listView) {
    state.listQuery.view = d.listView;
    return render();
  }
  if (d.work) {
    // 목록에서 고른 제목이 작품 화면의 제목 자리로 옮겨 가게 한다(style.css의 work-title).
    b.closest(".workrow")?.querySelector(".rowtitle")?.style.setProperty("view-transition-name", "work-title");
    return select(d.work);
  }
  if (d.tab) return switchTab(d.tab, b);
  if ("similarMark" in d) return markSimilar(d.other, d.similarMark);
  if (d.action) return runAction(b, d.action);
  if ("closeViewer" in d) return closeViewer();
  if ("imageZoom" in d) return openCaptureGallery(b, state.viewer.captureId, state.viewer.evidence);
  if ("zoomDetail" in d) return zoomCaptureDetail(b, e);
  if (d.gallery) return openCaptureGallery(b, d.gallery, d.sourceRef ? currentEvidence()?.[d.sourceRef] : null);
  if ("ocrIndex" in d) return showUncertain(d.capture, Number(d.ocrIndex));
  if (d.ref) return showRef(d.ref);
  if (d.capture && d.change) return changeCapture(d.capture, d.change);
  if ("delk" in d) {
    b.closest(".rubedit").remove();
    state.unsavedForm = true;
  }
}

