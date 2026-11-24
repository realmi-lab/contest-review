// 작품 선택과 서버 동기화, 주소(?work=…&tab=…)와 브라우저 뒤로 가기
import { showHealth } from "./list.mjs";
import { render, viewKey } from "./render.mjs";
import { DEFAULT_FIELDS, LINK_TABS, POLL_BUSY_MS, POLL_IDLE_MS, state } from "./state.mjs";
import { $, api, closeDialog, notify } from "./ui.mjs";
import { closeViewer } from "./viewer.mjs";
import { renderSidebar, showJob } from "./work-page.mjs";

let syncTicket = 0; // 가장 최근 동기화 요청 번호

/* ─────────────────────────── 작품 선택·동기화 ─────────────────────────── */

// 요약과 그 점검은 Claude Haiku가 만든 것(cloudReading·cloudLogic)만 쓴다.
export const currentReading = () => (state.work?.cloudReading?.rev === state.work?.rev ? state.work.cloudReading : null);
export const currentLogic = () => {
  const r = currentReading();
  return r && state.work.cloudLogic?.reading === r.id ? state.work.cloudLogic : null;
};
// 근거 칩은 요약에 붙은 원문 근거를 연다.
export const currentEvidence = () => currentReading()?.evidence;
export const findCapture = (id) => state.work?.captures.find((c) => c.id === id);

// "2023 빅콘테스트 · 실제 제목" → ["2023 빅콘테스트", "실제 제목"]. 공모전 이름(머리말)은 연도로 시작하거나
// 여러 작품이 함께 쓸 때만 나눈다("비 오는 날 공유 우산 · 합성 예제"는 그대로 → ["", 전체]).
export function splitName(name) {
  const i = name.indexOf(" · ");
  if (i <= 0) return ["", name];
  const prefix = name.slice(0, i);
  const shared = (state.app?.works ?? []).filter((x) => x.name.startsWith(prefix + " · ")).length > 1;
  return /^\d{4}\s/.test(prefix) || shared ? [prefix, name.slice(i + 3)] : ["", name];
}

export function saveSelection() {
  if (state.selected) localStorage.setItem("review.selected", state.selected);
  else localStorage.removeItem("review.selected");
}

export function chooseWork(id) {
  closeDialog();
  closeViewer();
  state.selected = id;
  state.editingSheet = false;
  state.docFields = { ...DEFAULT_FIELDS };
  state.tab = state.app?.works.find((x) => x.id === id)?.hasReading ? "요약" : "자료";
  saveSelection();
  syncUrl(true);
}

/* ─────────────────────────── 주소와 뒤로 가기 ───────────────────────────
   목록은 /, 작품은 /?work=<id>&tab=<summary|logic|report>.
   작품을 바꾸면 방문 기록을 쌓아 브라우저 '뒤로'가 이전 화면(목록·이전 작품)으로 가게 하고,
   같은 작품 안의 탭 이동은 주소만 바꾼다. 기록이 없으면 '뒤로'가 사이트 밖 빈 페이지로 나갔다. */
const TAB_LINKS = Object.fromEntries(Object.entries(LINK_TABS).map(([link, name]) => [name, link]));
export function viewUrl() {
  if (!state.selected) return location.pathname;
  const query = new URLSearchParams({ work: state.selected });
  if (TAB_LINKS[state.tab]) query.set("tab", TAB_LINKS[state.tab]);
  return location.pathname + "?" + query;
}
export function syncUrl(push = false) {
  const url = viewUrl();
  if (url !== location.pathname + location.search) history[push ? "pushState" : "replaceState"]({ inApp: true }, "", url);
}
// 주소에서 화면 상태(작품·탭)를 읽는다. 처음 열 때와 '뒤로·앞으로'에서 쓴다.
function readUrl() {
  const query = new URLSearchParams(location.search);
  return { work: query.get("work") || "", tab: LINK_TABS[query.get("tab")] ?? "자료" };
}
// 처음 열 때: 주소로 지정한 작품·탭, 없으면 지난번에 고른 작품
const opened = readUrl();
state.selected = opened.work || localStorage.getItem("review.selected") || "";
state.tab = opened.tab;

window.addEventListener("popstate", () => {
  closeDialog();
  closeViewer();
  ({ work: state.selected, tab: state.tab } = readUrl());
  saveSelection();
  sync(true).catch((e) => notify(e.message, true));
});

export async function select(id) {
  chooseWork(id);
  await sync(true);
}

// 캡처 추가 입력값은 화면을 다시 그려도 유지한다.
export function rememberFields() {
  if (!$("document") || state.shownWork !== state.selected) return;
  state.docFields = {
    document: $("document").value,
  };
}

// 입력 중이거나 저장하지 않은 내용이 있으면 자동 갱신으로 화면을 바꾸지 않는다.
function isEditing() {
  const el = document.activeElement;
  const typing =
    $("main").contains(el) &&
    (el.matches("textarea, select") ||
      (el.tagName === "INPUT" && !["checkbox", "file"].includes(el.type)));
  return $("dialog").open || state.unsavedForm || typing;
}

export async function sync(force = false) {
  const ticket = ++syncTicket;
  const id = state.selected;
  const next = await api("state");
  const meta = next.works.find((x) => x.id === id);
  if (id && !meta) {
    // 다른 곳에서 삭제된 작품
    if (id !== state.selected) return;
    state.selected = "";
    saveSelection();
    return sync(true);
  }
  const nextWork = !id
    ? null
    : state.work?.id === id && state.work.updated === meta.updated
      ? state.work
      : await api("work/" + id);
  if (ticket !== syncTicket || id !== state.selected) return; // 더 최신 요청이 있음
  state.app = next;
  state.jobsByWork = new Map();
  for (const task of next.tasks) {
    const running = !task.label.startsWith("대기 · ");
    if (running || !state.jobsByWork.has(task.work))
      state.jobsByWork.set(task.work, { label: task.label, running, percent: task.percent });
  }
  state.work = nextWork;
  showHealth();
  renderSidebar();
  if (force || (viewKey() !== state.shownKey && !isEditing())) render();
  else showJob();
}

export async function poll() {
  if (!document.hidden && !state.uploading) {
    try {
      await sync();
    } catch {
      $("health").className = "";
      $("health").textContent = $("login") ? "접속 코드 필요" : "로컬 서버 연결 확인 필요";
    }
  }
  setTimeout(poll, state.app?.tasks.length ? POLL_BUSY_MS : POLL_IDLE_MS);
}

