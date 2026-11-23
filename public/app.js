import { readingViews, representativeCaptures, explainOcr } from "./expanded-reading.mjs";
import { esc, join, markNumbers, sentences, seoulMinute } from "./html.mjs";
import { markTerms, termsIn } from "./glossary.mjs";
import { diagramHint } from "./diagram-hint.mjs";
import { evidencePeek, tiltPages, transition, tween } from "./interactions.mjs";

/* ─────────────────────────── 상수 ─────────────────────────── */

const MAX_IMAGE_BYTES = 14 * 1024 * 1024;
const DEFAULT_FIELDS = { document: "제안서" };
const STEP_TABS = {
  자료: "캡처 자료",
  요약: "내용 요약",
  점검: "사실·논리 점검",
  결과: "채점표",
};
const LINK_TABS = { report: "결과", summary: "요약", logic: "점검" }; // ?tab=
const POLL_BUSY_MS = 1500; // 진행 중인 작업이 있을 때
const POLL_IDLE_MS = 4000;

/* ─────────────────────────── 화면 상태 ─────────────────────────── */

let app = null; // /api/state: 작품 목록, 진행 작업, 엔진 상태
let jobsByWork = new Map();
let work = null; // 선택한 작품의 전체 데이터
const opened = readUrl(); // 주소로 지정한 작품·탭
const submittingSummaries = new Set();
// AI 연결(요약 설정에서 정한 모델·연결 주소): 요약과 사실·논리 점검은 이 모델로만 만든다
const aiLabel = () => app?.ai?.label || "Haiku 5.5";
const summaryModel = () => "AI · " + aiLabel();
const cloudScope = () => `AI 요약과 그 사실·논리 점검은 ${app?.ai?.provider === "litellm" ? "회사 LiteLLM(Bedrock)" : "Anthropic API"}를 사용합니다. OCR 텍스트와 ‘도식 검토’를 선택한 캡처 이미지를 전송합니다.`;
let selected = opened.work || localStorage.getItem("review.selected") || "";
let tab = opened.tab;
let viewer = null; // 오른쪽 원문 패널: { captureId, evidence, ref, snapshot }
let docFields = { ...DEFAULT_FIELDS }; // 캡처 추가 입력값 (다시 그려도 유지)
let shownWork = ""; // 화면에 그려진 작품 id
let shownTab = ""; // 화면에 그려진 단계
let shownKey = ""; // 화면에 그려진 작품 id + 수정 시각
let editingSheet = false; // 확정한 채점표를 고치는 중
let stampNext = false; // 방금 확정했으면 도장 찍히는 움직임을 한 번 보여 준다
let unsavedForm = false; // 저장하지 않은 폼 입력이 있으면 자동 갱신을 멈춤
let listQuery = { text: "", stage: "", sort: "todo" }; // 목록 화면 검색·필터
let syncTicket = 0;
let uploading = false;
let stream = null; // 문서 창 공유
let watchTimer, toastTimer;

/* ─────────────────────────── HTML 도우미 ─────────────────────────── */

const $ = (id) => document.getElementById(id);

// 아이콘은 문자(✓ ✕ ‹ ›) 대신 같은 선 굵기의 SVG로 그린다.
const ICONS = {
  check: '<path d="M20 6 9 17l-5-5"/>',
  close: '<path d="M18 6 6 18M6 6l12 12"/>',
  prev: '<path d="m15 18-6-6 6-6"/>',
  next: '<path d="m9 18 6-6-6-6"/>',
  back: '<path d="M19 12H5M12 19l-7-7 7-7"/>',
  settings:
    '<path d="M21 4h-7M10 4H3M21 12h-9M8 12H3M21 20h-5M12 20H3M14 2v4M8 10v4M16 18v4"/>',
};
const icon = (name, size = 18) =>
  `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;

// engine: 로컬 모델이 필요한 버튼 (작업 중·모델 미연결이면 잠김)
const button = (action, label, cls = "", engine = false) =>
  `<button type="button" data-action="${action}" class="${cls}" ${engine ? "data-engine" : ""}>${esc(label)}</button>`;
const field = (label, control) =>
  `<label class="field">${esc(label)}${control}</label>`;
const input = (id, value = "", type = "text", extra = "") =>
  `<input id="${id}" type="${type}" value="${esc(value)}" ${extra}>`;
const count = (n) => (n ? ` <span class="count">${n}</span>` : "");
const panel = (title, body, cls = "") =>
  `<section class="panel ${cls}"><h2>${esc(title)}</h2>${body}</section>`;
const emptyState = (title, text, action = "") =>
  `<div class="empty"><strong>${esc(title)}</strong><p>${esc(text)}</p>${action}</div>`;

// 근거 칩. 심사자가 원문에서 바로 찾도록 쪽 번호로, 쪽 순서대로 보여 주고 같은 쪽은 한 번만 둔다.
// 누르면 그 쪽의 첫 근거가 원문 패널에 열리고, 머물면 그 부분이 미리보기 카드로 뜬다(interactions.mjs).
function refPage(id, source) {
  const page = findCapture(source?.capture)?.page || /^S(\d+)\./.exec(id)?.[1];
  return page ? page + "쪽" : id;
}
function refs(ids) {
  const sources = currentEvidence();
  const pages = new Map(); // 쪽 표시 → 그 쪽의 첫 근거
  for (const id of ids) {
    const label = refPage(id, sources?.[id]);
    if (!pages.has(label)) pages.set(label, id);
  }
  const order = ([label]) => parseInt(label) || 0; // 쪽 순서대로
  return join([...pages].sort((a, b) => order(a) - order(b)), ([label, id]) => {
    return `<button type="button" class="ref" data-ref="${esc(id)}" aria-label="${esc(label)} 원문 근거">${esc(label)}</button>`;
  });
}

const claimText = (p) =>
  p.sourceNote ? `${p.sourceNote} · ${p.text}` : p.text;

// 요점은 한 줄에 한 문장씩(시험지 답안 줄) 두고 수치와 전문 용어를 표시한다.
// 마지막 낱말과 근거 칩을 묶어 칩만 다음 줄로 떨어지지 않게 한다. terms를 넘기면 그 화면에서 용어를 처음 한 번만 표시한다.
function claim(p, tag = "div", after = "", terms = new Set()) {
  const lines = sentences(claimText(p));
  const last = lines.pop();
  const cut = last.lastIndexOf(" ") + 1;
  const body = join(lines, (line) => `<span class="line">${markNumbers(line)}</span> `) +
    `<span class="line">${markNumbers(last.slice(0, cut))}<span class="nowrap">${markNumbers(last.slice(cut))}${refs(p.refs)}</span></span>`;
  return `<${tag} class="claim">${markTerms(body, terms)}${after}</${tag}>`;
}
// 점검 이유처럼 내부 번호가 섞인 글: 한 줄에 한 문장, 수치·용어 표시.
// 원문 근거 번호(S27.29)는 누를 수 있는 쪽 칩으로, 요약 문장 번호(P201)는 '요약'으로 바꾸고,
// '쪽'·'요약'은 받침이 있어 뒤의 조사를 맞춘다(S27.29는 → 27쪽은, P201의 → 요약의).
const SOURCE_ID = /(?<![\w.])S\d+\.\d+(?!\w)(는|가|를|와|로)?/g;
const POINT_ID = /(?<![\w.])P\d+(?!\w)(는|가|를|와|로)?/g;
const AFTER_CONSONANT = { 는: "은", 가: "이", 를: "을", 와: "과", 로: "으로" };
const particle = (p) => (p ? AFTER_CONSONANT[p] : "");
function richText(text, terms = new Set()) {
  const readable = (line) => markNumbers(line)
    .replace(SOURCE_ID, (m, p) => refs([m.replace(p ?? "", "")]) + particle(p))
    .replace(POINT_ID, (m, p) => "요약" + particle(p));
  return markTerms(join(sentences(text), (line) => `<span class="line">${readable(line)}</span> `), terms);
}
// 요약에 나온 전문 용어 풀이 (요약 끝의 각주)
function glossaryNote(points) {
  const terms = termsIn(points.map(claimText));
  return terms.length
    ? `<aside class="glossary"><h3>용어 풀이</h3><dl>${join(terms, ([name, meaning]) => `<div><dt>${esc(name)}</dt><dd>${esc(meaning)}</dd></div>`)}</dl></aside>`
    : "";
}

/* ─────────────────────────── 서버·알림 ─────────────────────────── */

async function api(route, data) {
  const options =
    data === undefined
      ? {}
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        };
  const response = await fetch("/api/" + route, options).catch(() => {
    throw Error(
      "아이디어정리 서버에 연결하지 못했습니다. 서버 실행 상태를 확인하세요.",
    );
  });
  const body = await response.json().catch(() => ({}));
  if (response.status === 401 && route !== "login") askAccessCode();
  if (!response.ok) throw Error(body.error || "요청을 처리하지 못했습니다.");
  return body;
}

// 웹 주소는 접속 코드를 한 번 입력하면 이 브라우저에서 30일 유지된다.
function askAccessCode() {
  if ($("login")) return;
  dialog(
    "접속 코드 입력",
    `<form id="login" class="stack">
      <p class="small muted">심사 담당자에게 받은 접속 코드를 입력하세요. 이 브라우저에서 30일 동안 다시 묻지 않습니다.</p>
      ${field("접속 코드", input("accesscode", "", "text", 'required autocomplete="off" spellcheck="false" autocapitalize="characters" placeholder="XXXX-XXXX-XXXX"'))}
      <div><button class="primary">들어가기</button></div>
    </form>`,
  );
  $("accesscode").focus();
}

function notify(message, isError = false) {
  const box = $("notice");
  box.textContent = message;
  box.classList.toggle("error", isError);
  box.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (box.hidden = true), isError ? 9000 : 4000);
}

/* ─────────────────────────── 대화상자 ─────────────────────────── */

function stopCapture() {
  clearInterval(watchTimer);
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
}

function closeDialog() {
  stopCapture();
  $("dialog").close();
}

function dialog(title, html) {
  if ($("dialog").open) closeDialog();
  $("dialogtitle").textContent = title;
  $("dialogbody").innerHTML = html;
  $("dialog").showModal();
}

/* ─────────────────────────── 작품 선택·동기화 ─────────────────────────── */

// 요약과 그 점검은 Claude Haiku가 만든 것(cloudReading·cloudLogic)만 쓴다.
const currentReading = () => (work?.cloudReading?.rev === work?.rev ? work.cloudReading : null);
const currentLogic = () => {
  const r = currentReading();
  return r && work.cloudLogic?.reading === r.id ? work.cloudLogic : null;
};
// 근거 칩은 요약에 붙은 원문 근거를 연다.
const currentEvidence = () => currentReading()?.evidence;
const findCapture = (id) => work?.captures.find((c) => c.id === id);

// "공개 추가검증 · 실제 제목" → ["공개 추가검증", "실제 제목"]
function splitName(name) {
  const i = name.indexOf(" · ");
  return i > 0 ? [name.slice(0, i), name.slice(i + 3)] : ["", name];
}

function saveSelection() {
  if (selected) localStorage.setItem("review.selected", selected);
  else localStorage.removeItem("review.selected");
}

function chooseWork(id) {
  closeDialog();
  closeViewer();
  selected = id;
  editingSheet = false;
  docFields = { ...DEFAULT_FIELDS };
  tab = app?.works.find((x) => x.id === id)?.hasReading ? "요약" : "자료";
  saveSelection();
  syncUrl(true);
}

/* ─────────────────────────── 주소와 뒤로 가기 ───────────────────────────
   목록은 /, 작품은 /?work=<id>&tab=<summary|logic|report>.
   작품을 바꾸면 방문 기록을 쌓아 브라우저 '뒤로'가 이전 화면(목록·이전 작품)으로 가게 하고,
   같은 작품 안의 탭 이동은 주소만 바꾼다. 기록이 없으면 '뒤로'가 사이트 밖 빈 페이지로 나갔다. */
const TAB_LINKS = Object.fromEntries(Object.entries(LINK_TABS).map(([link, name]) => [name, link]));
function viewUrl() {
  if (!selected) return location.pathname;
  const query = new URLSearchParams({ work: selected });
  if (TAB_LINKS[tab]) query.set("tab", TAB_LINKS[tab]);
  return location.pathname + "?" + query;
}
function syncUrl(push = false) {
  const url = viewUrl();
  if (url !== location.pathname + location.search) history[push ? "pushState" : "replaceState"]({ inApp: true }, "", url);
}
// 주소에서 화면 상태(작품·탭)를 읽는다. 처음 열 때와 '뒤로·앞으로'에서 쓴다.
function readUrl() {
  const query = new URLSearchParams(location.search);
  return { work: query.get("work") || "", tab: LINK_TABS[query.get("tab")] ?? "자료" };
}
window.addEventListener("popstate", () => {
  closeDialog();
  closeViewer();
  ({ work: selected, tab } = readUrl());
  saveSelection();
  sync(true).catch((e) => notify(e.message, true));
});

async function select(id) {
  chooseWork(id);
  await sync(true);
}

// 캡처 추가 입력값은 화면을 다시 그려도 유지한다.
function rememberFields() {
  if (!$("document") || shownWork !== selected) return;
  docFields = {
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
  return $("dialog").open || unsavedForm || typing;
}

async function sync(force = false) {
  const ticket = ++syncTicket;
  const id = selected;
  const next = await api("state");
  const meta = next.works.find((x) => x.id === id);
  if (id && !meta) {
    // 다른 곳에서 삭제된 작품
    if (id !== selected) return;
    selected = "";
    saveSelection();
    return sync(true);
  }
  const nextWork = !id
    ? null
    : work?.id === id && work.updated === meta.updated
      ? work
      : await api("work/" + id);
  if (ticket !== syncTicket || id !== selected) return; // 더 최신 요청이 있음
  app = next;
  jobsByWork = new Map();
  for (const task of next.tasks) {
    const running = !task.label.startsWith("대기 · ");
    if (running || !jobsByWork.has(task.work))
      jobsByWork.set(task.work, { label: task.label, running });
  }
  work = nextWork;
  showHealth();
  renderSidebar();
  if (force || (viewKey() !== shownKey && !isEditing())) render();
  else showJob();
}

async function poll() {
  if (!document.hidden && !uploading) {
    try {
      await sync();
    } catch {
      $("health").className = "";
      $("health").textContent = $("login") ? "접속 코드 필요" : "로컬 서버 연결 확인 필요";
    }
  }
  setTimeout(poll, app?.tasks.length ? POLL_BUSY_MS : POLL_IDLE_MS);
}

/* ─────────────────────────── 상단·사이드바 ─────────────────────────── */

function showHealth() {
  // 이 맥에서 하는 일은 글자 인식(OCR)뿐이다. 요약과 점검은 AI(Haiku)가 한다.
  const { ocrReady } = app.health;
  $("health").className = ocrReady ? "online" : "";
  $("health").textContent = ocrReady ? "자료 읽기 준비됨" : "글자 인식 준비 필요";
  $("health").title = `글자 인식(Kordoc) ${ocrReady ? "준비" : "확인 필요"}`;
}

// 목록의 점 색과 보조 줄
// 목록에 쓰는 진행 단계. key는 필터 칩과 같다.
const STAGES = {
  new: "캡처 전",
  capt: "요약 전",
  read: "요약 완료",
  checked: "점검 완료",
  final: "심사 확정",
};
function workStatus(x) {
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

function queueStage(id) {
  const job = jobsByWork.get(id);
  return job ? (job.running ? "run" : "wait") : "";
}

const queueLabels = { run: "처리 중", wait: "대기" };

// 목록의 진행 상태: 캡처 → 요약 → 점검 → 채점 네 칸 눈금과 글자. 확정은 도장.
const STAGE_STEPS = { new: 0, capt: 1, read: 2, checked: 3 };
function stageMark(status) {
  if (status.key === "final") return `<span class="progress final">${esc(status.label)}</span>`;
  const done = STAGE_STEPS[status.key];
  const steps = [0, 1, 2, 3].map((i) => `<i${i < done ? ' class="on"' : ""}></i>`).join("");
  return `<span class="progress"><span class="steps" aria-hidden="true">${steps}</span>${esc(status.label)}</span>`;
}

// 같은 머리말("공개 추가검증 · …")이 2개 이상이면 묶음 제목으로 한 번만 보여 준다.
function groupWorks(works) {
  const shared = new Map();
  for (const x of app.works) {
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
function sortWorks(works) {
  const stageOrder = Object.keys(STAGES);
  const list = [...works];
  if (listQuery.sort === "recent")
    list.sort((a, b) => (b.receivedOn || "").localeCompare(a.receivedOn || ""));
  if (listQuery.sort === "todo")
    list.sort(
      (a, b) =>
        stageOrder.indexOf(workStatus(a).key) -
        stageOrder.indexOf(workStatus(b).key),
    );
  if (listQuery.sort === "score")
    list.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  return list;
}

function filteredWorks() {
  const needle = listQuery.text.toLowerCase();
  return sortWorks(
    app.works.filter(
      (x) =>
        x.name.toLowerCase().includes(needle) &&
        (!listQuery.stage || (listQuery.stage === "follow" ? !!x.followStage : workStatus(x).key === listQuery.stage)),
    ),
  );
}

/* ─────────────────────────── 본문 그리기 ─────────────────────────── */

// 화면을 다시 그려야 하는지 판단하는 값. 현황판은 목록·작업 상태가 바뀌면 다시 그린다.
function viewKey() {
  if (work) return work.id + work.updated;
  return (
    "overview" +
    JSON.stringify(app.works.map((x) => [x.id, x.receivedOn, x.intakeTeam,
      x.submitterName, x.name, x.count, x.hasReading, x.hasLogic, x.gist, x.final, x.score, x.decision, x.category,
      x.evalDone, x.evalAvg, x.followStage, x.followDue, x.stalled, x.duplicates])) + JSON.stringify(app.intake)
  );
}

// 화면을 다시 그린다. 작품이나 단계가 바뀌었으면 그 방향으로 넘기며 그린다(interactions.mjs).
// 다 그리면 끝나는 약속을 돌려준다.
function render() {
  const direction = movement();
  peek.hide();
  const draw = () => {
    rememberFields();
    shownWork = work?.id ?? "";
    shownTab = tab;
    shownKey = viewKey();
    unsavedForm = false;
    $("main").innerHTML = work ? workView() : overviewView();
    $("main").classList.toggle("entering", Boolean(direction)); // 요약 줄이 차례로 들어온다
    syncUrl();
    renderSidebar();
    refreshViewer();
    markActiveRef();
    showJob();
    showSimilar().catch(() => {}); // 비슷한 제안은 따로 불러와 채운다
  };
  if (!direction) {
    draw();
    return Promise.resolve();
  }
  return transition(draw, direction);
}

// 지난번에 그린 화면과 비교한 이동 방향: into(목록→작품) · back · turn-next·turn-prev(작품 넘김) · next·prev(단계).
// 처음 그릴 때와 같은 화면을 새 데이터로 다시 그릴 때는 "".
function movement() {
  if (!shownKey) return "";
  const id = work?.id ?? "";
  if (id !== shownWork) {
    if (!shownWork) return "into";
    if (!id) return "back";
    const order = filteredWorks().map((x) => x.id);
    return order.indexOf(id) > order.indexOf(shownWork) ? "turn-next" : "turn-prev";
  }
  if (tab === shownTab) return "";
  const steps = Object.keys(STEP_TABS);
  return steps.indexOf(tab) > steps.indexOf(shownTab) ? "next" : "prev";
}

function intakeInputs(record, isNew = false) {
  const prefix = isNew ? "new-" : "edit-";
  return `
    ${field("인입 날짜", input(prefix + "date", record.receivedOn, "date", 'name="receivedOn"' + (isNew ? " required" : "")))}
    ${field("접수 팀명", input(prefix + "team", record.intakeTeam, "text", 'name="intakeTeam" maxlength="80"'))}
    ${field("접수자 이름", input(prefix + "submitter", record.submitterName, "text", 'name="submitterName" maxlength="80"'))}`;
}

const intakeHeadings = ["인입일", "접수 팀명", "접수자"];
const columnHeaders = (names) => join(names, (label) => `<th scope="col">${esc(label)}</th>`);

// 접수 정보 세 값(intakeHeadings 순서). 목록 표와 작품 머리에서 함께 쓴다.
function intakeValues(record) {
  const date = record.receivedOn;
  return [
    date ? `<time datetime="${esc(date)}">${esc(date.replaceAll("-", "."))}</time>` : "—",
    esc(record.intakeTeam || "—"),
    esc(record.submitterName || "—"),
  ];
}
// MS Forms로 들어온 작품: 제안자 이메일과 간략 설명(작품 머리, 접수 정보 아래)
const formsNote = (source) => source?.formId && (source.email || source.description)
  ? `<p class="forms-note">${source.email ? `<a href="mailto:${esc(source.email)}">${esc(source.email)}</a>` : ""}${source.description ? `<span>${esc(source.description)}</span>` : ""}</p>`
  : "";
const intakeCells = (record) => join(intakeValues(record), (value) => `<td>${value}</td>`);

// 첫 화면: 전체 작품의 진행 현황
// 목록 화면: 진행 현황 + 작품 카드
// 목록 화면: 새 작품 접수 줄 + 단계 필터 + 작품 목록
// 직접 접수 칸. 작품이 없을 때는 목록 화면에, 있을 때는 '새 작품 접수' 대화상자에 둔다.
function createForm(layout) {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
  return `<form id="create" class="${layout}">
      ${intakeInputs({ receivedOn: today }, true)}
      ${field("새 작품명", input("name", "", "text", 'maxlength="140" required placeholder="작품명을 입력하세요"'))}
      <div><button class="primary">작품 접수</button></div>
    </form>`;
}

function overviewView() {
  const works = app.works;
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
  const byStage = (key) =>
    works.filter((x) => workStatus(x).key === key).length;
  const stageTab = (key, label, n) =>
    `<button type="button" class="stagetab" data-stage="${key}" aria-pressed="${listQuery.stage === key}">${label}<em>${n}</em></button>`;
  return `
    <section class="listhead">
      <h1>전체 작품${count(works.length)}</h1>
      <p id="queue-summary"></p>
      <span class="spacer"></span>
      ${button("export-all", "채점 결과 받기 (엑셀)")}
      ${button("batch-summary", "일괄 요약·점검")}
    </section>
    ${formsPanel()}
    <section class="card workboard">
      <div class="listbar">
        <div class="stagetabs" role="group" aria-label="진행 단계로 거르기">${stageTab("", "전체", works.length)}${join(Object.entries(STAGES), ([key, label]) => stageTab(key, label, byStage(key)))}${stageTab("follow", "실행 추적", works.filter((x) => x.followStage).length)}</div>
        <span class="spacer"></span>
        <input id="search" type="search" placeholder="작품명 검색" value="${esc(listQuery.text)}" aria-label="작품 검색">
        <select id="sort" aria-label="정렬">
          <option value="todo" ${listQuery.sort === "todo" ? "selected" : ""}>처리할 순서</option>
          <option value="recent" ${listQuery.sort === "recent" ? "selected" : ""}>접수순</option>
          <option value="score" ${listQuery.sort === "score" ? "selected" : ""}>확정점수순</option>
        </select>
      </div>
      <div id="worklist" class="worklist" role="region" aria-label="작품 목록" tabindex="0">${workListHtml()}</div>
    </section>`;
}

// 같은 머리말끼리 묶은 작품 카드
// 같은 머리말끼리 묶은 작품 목록 (한 줄에 한 작품)
function workListHtml() {
  const works = filteredWorks();
  if (!works.length)
    return emptyState(
      "조건에 맞는 작품이 없습니다",
      "검색어를 지우거나 ‘전체’를 눌러 보세요.",
    );
  const groups = groupWorks(works);
  return `<table class="works-table" aria-label="작품별 접수 정보">
    <thead><tr>${columnHeaders([...intakeHeadings, "작품명", "분야", "캡처", "진행 상태"])}</tr></thead>
    ${join(groups, ([prefix, items]) => `<tbody>${join(items, (item) => workRow(item, prefix))}</tbody>`)}
  </table>`;
}

function workRow({ work: x, title }, prefix) {
  const status = workStatus(x);
  const stage = queueStage(x.id);
  return `<tr class="workrow" data-work="${esc(x.id)}">
    ${intakeCells(x)}
    <th scope="row"><button class="rowtitle" type="button" data-work="${esc(x.id)}" title="${esc(x.name)}"><span>${esc(title)}</span></button>${x.gist ? `<small class="rowgist">${esc(x.gist)}</small>` : ""}</th>
    <td>${esc(x.category || prefix || "기타")}</td><td>${x.count}장</td>
    <td><span class="badges"><span data-queue="${stage}" class="badge" ${stage ? "" : "hidden"}>${queueLabels[stage] || ""}</span>${stageMark(status)}</span>${x.decision ? `<small>${esc(x.decision)} · ${esc(x.scale)}</small>` : ""}${evaluationNote(x)}${followNote(x)}${x.duplicates ? `<small class="warn-text">중복 판정 ${x.duplicates}건</small>` : ""}${x.hasReading ? "" : summaryActions(x)}</td>
  </tr>`;
}

// MS Forms 공모 연동 현황(설정: deploy/site.json의 forms). 응답은 1분마다 들어오고, 심사 배포는 버튼으로 한다.
const SHARE_BADGES = { "공유 완료": "badge-ok", "공유 대기": "badge-warn" };
function formsPanel() {
  const v = app.intake;
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
const assignedEvaluators = (x) => (x.formId ?? x.source?.formId) ? (app.intake?.evaluators ?? []).filter((e) => e.categories.includes(x.category)) : [];
// 목록의 평가 진행: 다 채운 평가표 수 / 배정 수 · 평균
function evaluationNote(x) {
  const assigned = assignedEvaluators(x).length;
  return assigned ? `<small>평가 ${x.evalDone} / ${assigned}${x.evalAvg != null ? ` · 평균 ${x.evalAvg}` : ""}</small>` : "";
}

// 목록의 실행 단계: 예정일, 멈췄으면(예정일 지남·30일 넘게 그대로) 표시
function followNote(x) {
  if (!x.followStage) return "";
  const due = x.followDue ? ` · 예정 ${x.followDue.slice(5).replace("-", ".")}` : "";
  return `<small${x.stalled ? ' class="warn-text"' : ""}>${esc(x.followStage)}${due}${x.stalled ? " · 멈춤" : ""}</small>`;
}

function openDistribute() {
  const v = app.intake;
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

// 상단 '새 작품 접수': 목록 화면의 접수 칸으로 이동
async function openCreate() {
  if (selected) await select("");
  if (!app.works.length) return $("name")?.focus();
  dialog("새 작품 접수", createForm("stack"));
  $("name").focus();
}

// 진행 단계. 끝나지 않은 첫 단계가 '다음 할 일'이다.
// 다음에 할 일 (오른쪽 위 버튼 하나)
function nextAction() {
  if (!work.captures.length) return ["upload", "캡처 올리기"];
  if (!work.complete) return ["confirm-complete", "빠짐없음 확인"];
  // 채점표 화면에서는 채점이 할 일이다.
  if (tab === "결과") return work.final ? ["next-work", "다음 작품"] : ["go-final", "채점하기"];
  if (!currentReading()) return tab === "요약" ? [] : ["open-summary", "내용 요약으로"];
  if (!currentLogic()) return ["check-logic", "사실·논리 점검 실행"];
  return work.final ? ["next-work", "다음 작품"] : ["open-report", "채점표 열기"];
}

// 단계별 완료 여부와 한 줄 설명 (왼쪽 메뉴의 단계 목록)
function stepStates() {
  const reading = currentReading();
  const logic = currentLogic();
  const missing = pageCoverage()?.missing.length;
  return {
    자료: {
      done: work.captures.length > 0 && !!work.complete,
      note: !work.captures.length
        ? "캡처 전"
        : work.complete
          ? `${work.captures.length}장 · 확인됨`
          : missing
            ? `${work.captures.length}장 · 빠진 쪽 ${missing}`
            : `${work.captures.length}장 · 확인 전`,
    },
    요약: {
      done: !!reading,
      note: reading ? `핵심 요점 ${readingViews(reading).brief.length}개` : "요약 전",
    },
    점검: {
      done: !!logic,
      note: logic ? "AI 의견" : "점검 전",
    },
    결과: {
      done: !!work.final,
      note: work.final
        ? `확정 ${work.final.score.toFixed(1)}점`
        : "채점 전",
    },
  };
}

function stepMarker(done, fallback = "") {
  return `<span class="stepno">${done ? icon("check", 14) : fallback}</span>`;
}

// 심사 단계 버튼들. 왼쪽 메뉴(선택한 작품 아래)와 오른쪽 작품 화면 위 탭이 같은 버튼을 쓴다.
function stepItems() {
  const states = stepStates();
  return join(Object.entries(STEP_TABS), ([key, label], i) =>
    `<button type="button" class="stepitem ${tab === key ? "active" : ""} ${states[key].done ? "done" : ""}" data-tab="${key}" ${tab === key ? 'aria-current="step"' : ""}>` +
    stepMarker(states[key].done, i + 1) +
    `<span class="steptext"><b>${label}</b><small>${esc(states[key].note)}</small></span></button>`);
}
const stepMenu = () => `<div class="stepnav" role="group" aria-label="심사 단계">${stepItems()}</div>`;
const stepTabs = () => `<nav class="steptabs no-print" aria-label="심사 단계">${stepItems()}</nav>`;

// 왼쪽 메뉴: 전체 작품 + 머리말별 작품 목록 (선택한 작품은 단계 메뉴가 펼쳐짐)
let sidenavHtml = "";
let sidenavScrolled = ""; // 메뉴를 마지막으로 맞춘 작품
function renderSidebar() {
  if (!app) return;
  const navWork = ({ work: x, title }) => {
    const status = workStatus(x);
    const active = x.id === selected;
    return (
      `<button type="button" class="navwork ${active ? "active" : ""}" data-work="${x.id}" title="${esc(x.name)}" ${active ? 'aria-current="page"' : ""}>` +
      `<i class="dot stage-${queueStage(x.id) || status.key}"></i><span class="nav-title">${esc(title)}</span></button>` +
      (active && work?.id === x.id ? stepMenu() : "")
    );
  };
  const html =
    `<button type="button" id="navall" class="navall ${selected ? "" : "active"}" ${selected ? "" : 'aria-current="page"'}>전체 작품${count(app.works.length)}</button>` +
    join(
      groupWorks(sortWorks(app.works)),
      ([prefix, items]) =>
        (prefix ? `<div class="navgroup"><span>${esc(prefix)}</span><em>${items.length}</em></div>` : "") +
        join(items, navWork),
    );
  // 바뀐 경우에만 다시 그려 포커스와 스크롤 위치를 지킨다.
  if (html !== sidenavHtml) $("sidenav").innerHTML = sidenavHtml = html;
  // 단계 목록은 왼쪽 메뉴에만 있으므로, 작품을 고르면 그 작품과 단계가 메뉴에서 보이게 한다.
  if (selected && selected !== sidenavScrolled) {
    sidenavScrolled = selected;
    $("sidenav").querySelector(".stepnav")?.scrollIntoView({ block: "nearest" });
  }
}

// 전체 쪽 수가 입력된 경우, 빠진 쪽 번호를 찾는다.
function pageCoverage() {
  const total = Math.max(0, ...work.captures.map((c) => c.total || 0));
  if (!total) return null;
  const have = new Set(work.captures.map((c) => c.page).filter(Boolean));
  const missing = [];
  for (let p = 1; p <= total; p++) if (!have.has(p)) missing.push(p);
  return { total, missing };
}

function coverageText() {
  const cov = pageCoverage();
  if (!cov?.missing.length) return "";
  const list = cov.missing.slice(0, 8).join(", ");
  return `전체 ${cov.total}쪽 중 빠진 쪽 ${list}${cov.missing.length > 8 ? " 외" : ""}`;
}

function workView() {
  const [action, label] = nextAction();
  const [prefix, title] = splitName(work.name);
  const list = filteredWorks();
  const index = list.findIndex((x) => x.id === work.id);
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
      <div class="detail-title"><h1 title="${esc(work.name)}">${esc(title)}</h1>
        <div class="intake-line">
          <dl class="intake-meta" aria-label="접수 정보">${join(intakeValues(work), (value, i) =>
            `<div><dt>${intakeHeadings[i]}</dt><dd>${value}</dd></div>`)}${work.category ? `<div><dt>분야</dt><dd>${esc(work.category)}</dd></div>` : ""}</dl>
          ${button("edit-intake", "접수 정보 수정", "link")}
          <div id="similar"></div>
        </div>
        ${formsNote(work.source)}
      </div>
      ${action ? `<button id="run" type="button" class="primary big" data-action="${action}">${label}</button>` : ""}
    </header>
    <div id="job" class="job" role="status"></div>
    <section id="content" class="content${tab === "요약" ? ` reading-content" data-summary-work="${esc(work.id)}` : ""}">
      <h2 class="panetitle">${STEP_TABS[tab]}</h2>
      ${panes[tab]()}
    </section>
    </article>`;
}

// 버튼을 쓸 수 없는 이유 (없으면 빈 문자열)
function blockedReason(job, needsEngine) {
  if (uploading) return "캡처를 올리는 중입니다.";
  if (!needsEngine) return "";
  if (job) return job.running ? "진행 중인 작업이 끝나면 실행할 수 있습니다." : "이 작품의 대기 작업이 끝나면 실행할 수 있습니다.";
  if (!work.captures.length) return "캡처를 먼저 추가하세요.";
  return "";
}

function showJob() {
  for (const group of document.querySelectorAll("[data-summary-work]")) {
    const id = group.dataset.summaryWork;
    for (const b of group.querySelectorAll("[data-summary-command]")) {
      const reason = summaryUnavailable(id);
      b.disabled = !!reason;
      b.title = reason || b.getAttribute("aria-label");
    }
  }
  if (!work) {
    const summary = $("queue-summary");
    if (!summary) return;
    const running = [...jobsByWork.values()].filter((job) => job.running).length;
    const waiting = jobsByWork.size - running;
    const note = jobsByWork.size ? `처리 중 ${running}작품 · 대기 ${waiting}작품` : "처리 중인 작업 없음";
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
  const job = jobsByWork.get(work.id);
  const run = $("run");
  const runNeedsEngine = run?.dataset.action === "check-logic";
  const ocrPending =
    run?.dataset.action === "confirm-complete" &&
    work.captures.some((c) => c.status === "queued");
  const reason = ocrPending
    ? "글자 인식이 끝나면 확인할 수 있습니다."
    : blockedReason(job, runNeedsEngine);
  const failed = work.error && !job;
  box.textContent = job
    ? (job.running ? job.label : "처리 대기 · 앞선 작업이 끝나면 시작합니다.")
    : (failed ? "처리 오류 · " + work.error : reason);
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

/* ─────────────────────────── 캡처 자료 탭 ─────────────────────────── */

// 캡처 한 장. 도식 검토로 지정한 쪽과, 그래프 값이 글자로 없어 이미지로 읽어야 하는 쪽(추천)을 표시한다.
function captureCard(c) {
  const hint = c.visual ? "" : diagramHint(c.lines);
  const badge = c.visual ? '<em class="cap-badge on">도식 검토</em>' : hint ? '<em class="cap-badge">도식 검토 추천</em>' : "";
  return `<button type="button" class="capture-tile" data-gallery="${esc(c.id)}" aria-haspopup="dialog" aria-label="${esc(c.label)} 크게 보기" title="${esc(hint ? c.label + " · " + hint : c.label)}">
    <img alt="" loading="lazy" decoding="async" src="/api/image/${esc(c.id)}?size=thumb">
    <span>${esc(c.page ? c.page + "쪽" : c.label)}${badge}</span>
  </button>`;
}
// 도식 검토 추천 쪽: 그래프 축은 있는데 값이 글자로 적혀 있지 않은 캡처 (diagram-hint.mjs)
const suggestedVisual = () => work.captures.filter((c) => !c.visual && diagramHint(c.lines));

// MS Forms 첨부는 보호 문서라 내용을 직접 읽지 못한다. 어디에 있는지 알려 주고 캡처를 받는다.
function formsFilesNote() {
  const s = work.source;
  if (!s) return "";
  const folder = `${app.intake?.reviewDir ?? "심사 폴더"}/작품/${s.folder}`;
  return `<div class="warning spaced">MS Forms 첨부 ${s.files.length}개는 OneDrive <b>${esc(folder)}</b> 폴더에 있습니다. 보호 문서라 회사 뷰어로 열어 캡처해 올려 주세요.${
    s.missing.length ? ` 아직 동기화되지 않은 첨부: ${esc(s.missing.join(", "))}` : ""}</div>`;
}

function intakePane() {
  const { captures } = work;
  const coverage = coverageText();
  if (!captures.length) return `${formsFilesNote()}
    <section class="panel">
      <div class="intake-document">
        ${field("문서 또는 시트 이름", input("document", docFields.document, "text", 'maxlength="100"'))}
      </div>
      <label id="drop" class="drop">
        <span><strong>캡처 이미지를 끌어 놓거나 붙여넣으세요</strong>
        <span class="small muted">PNG·JPG·WebP, 여러 장은 선택한 순서대로 접수합니다.</span></span>
        <span class="pick">파일 선택</span>
        <input id="files" class="sr" type="file" accept="image/png,image/jpeg,image/webp" multiple>
      </label>
      <div class="actions">${button("screen", "문서 창에서 캡처")}</div>
    </section>`;
  const flagged = captures.filter((c) => c.issue).length;
  const note = [
    coverage,
    flagged ? `다시 캡처할 부분 ${flagged}건` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const suggested = suggestedVisual();
  return `
    <section class="panel">
      ${suggested.length ? `<div class="diagram-note"><span><b>도식 검토 추천 ${suggested.length}쪽</b> · 그래프 값이 글자로 적혀 있지 않아 이미지로만 읽을 수 있습니다.</span>${button("mark-visual", "추천 쪽 도식 검토로 지정")}</div>` : ""}
      <div class="capgrid">${join(captures, captureCard)}</div>
      <label class="completebar ${work.complete ? "on" : ""}">
        <input id="complete" type="checkbox" ${work.complete ? "checked" : ""}>
        <span><b>제출물이 빠짐없이 캡처되었음을 확인했습니다.</b>
        ${note ? `<small class="warn-text">${esc(note)}</small>` : ""}</span>
      </label>
    </section>`;
}

/* ─────────────────────────── 내용 요약 탭 ─────────────────────────── */

// 핵심 요약과 세부 내용을 한 화면에 차례로 보여 준다.
function summaryGroups(r) {
  const { brief, detail } = readingViews(r);
  return [["핵심 요약", brief], ["세부 내용", detail]].filter(([, points]) => points.length);
}
const summaryPoints = (r) => summaryGroups(r).flatMap(([, points]) => points);

function ocrDifference(c, issue, index) {
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

function summaryUnavailable(id) {
  if (submittingSummaries.has(id) || jobsByWork.has(id)) return "이 작품의 작업이 끝나면 실행할 수 있습니다.";
  if (work?.id === id && uploading) return "캡처를 올리는 중입니다.";
  if (!app.works.find((x) => x.id === id)?.count) return "캡처를 먼저 추가하세요.";
  return "";
}

// 요약 만들기 버튼. [data-summary-work] 안에 두면 누를 수 없는 이유(작업 중 등)가 자동으로 반영된다(showJob).
function summaryCommand(workId, label, text = label, cls = "") {
  const reason = summaryUnavailable(workId);
  return `<button type="button" class="${cls}" data-summary-command="make" aria-label="${label}" title="${reason || label}" ${reason ? "disabled" : ""}>${text}</button>`;
}

// 전체 작품 목록에서 요약이 없는 작품에만 붙는 작은 요약 버튼. 다시 만들기는 작품 화면에서 한다.
function summaryActions(record) {
  return `<div class="summary-actions no-print" data-summary-work="${esc(record.id)}">${
    summaryCommand(record.id, esc(record.name) + " 요약 만들기", "요약")}</div>`;
}

// 내용 요약 머리 오른쪽: 요약이 있으면 다시 만들기, 그리고 요약 설정
function summaryToolbar() {
  return `<div class="provider-toolbar no-print"><span class="spacer"></span>
    ${currentReading() ? summaryCommand(work.id, "요약 다시 만들기", "다시 만들기", "remake") : ""}
    ${button("summary-settings", "요약 설정", "link")}</div>`;
}
const usd = new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 8,
});
function haikuUsage(kind, result) {
  const noun = kind === "summary" ? "요약" : "점검";
  const last = work.lastHaikuUsage?.[kind];
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
  if (last && last.runId !== result?.usage?.runId && (kind === "summary" || last.readingId === work.cloudReading?.id))
    html += meter(last, "최근 " + noun + " 실행 확인분");
  // 토큰·비용은 관리용이라 결과 아래에 접어 둔다.
  return html ? `<details class="usage-fold no-print"><summary>AI 사용량·비용</summary>${html}</details>` : "";
}
function readingPane() {
  const controls = summaryToolbar();
  const r = currentReading();
  const usage = haikuUsage("summary", r); // 요약 아래에는 토큰 사용량과 비용만 둔다
  if (!r)
    return controls + emptyState("요약이 없습니다", cloudScope(),
      summaryCommand(work.id, "요약 만들기", "요약 만들기", "primary big")) + usage;
  const groups = summaryGroups(r);
  // 한 줄 요약은 문서 전체를 말하므로 특정 쪽의 그림을 붙이지 않는다.
  const gist = (p) => p.topic === "한 줄 요약";
  const figures = new Map(representativeCaptures(r, work.captures, summaryPoints(r).filter((p) => !gist(p))).map((f) => [f.point, f]));
  const terms = new Set();
  const item = (p, i) => {
    const figure = figures.get(p);
    const cls = [figure ? "with-figure" : "", gist(p) ? "gist" : ""].filter(Boolean).join(" ");
    return `<li${cls ? ` class="${cls}"` : ""} data-topic="${esc(p.topic)}" style="--i:${i}"><b>${esc(p.topic)}</b>${claim(p, "div", "", terms)}${figure ? figureButton(figure) : ""}</li>`;
  };
  // 비워 둔 물음. 다른 줄로 메우지 않고, 내용을 찾지 못했는지 쓴 문장이 원문 대조에서 떨어졌는지 심사자에게 알린다.
  const missing = (r.edition?.missing || []).map((m) => `${m.topic}(${m.why === "답 없음" ? "내용을 찾지 못함" : "원문 대조 미통과"})`);
  const unfilled = missing.length ? `<p class="summary-missing"><b>비워 둔 항목</b>${esc(missing.join(" · "))} — 원문에서 직접 확인하세요.</p>` : "";
  const summary = `<section class="read-section summary-edition">
    ${groups.length ? join(groups, ([title, points]) => {
      const lead = title === "핵심 요약";
      return `<h2>${title}</h2><ul class="summary-points${lead ? " lead" : ""}">${join(points, item)}</ul>${lead ? unfilled : ""}`;
    }) :
      "<h2>핵심 요약</h2><p>이 화면에 추가할 확인된 요점이 없습니다.</p>"}
    ${glossaryNote(summaryPoints(r))}
    ${r.edition?.version !== 1 ? '<small class="muted">이전 형식으로 저장된 요약입니다. 같은 모델로 다시 요약하면 새 형식으로 볼 수 있습니다.</small>' : ""}</section>`;
  const alerts = join(r.sourceAlerts || [], (a) =>
    `<p class="warning"><strong>원문 설명이 다른 부분</strong> · ${esc(a.reason)} ${refs(a.refs)}</p>`);
  return controls + summary + alerts + usage;
}

/* ─────────────────────────── 비슷한 제안 (similar.mjs) ─────────────────────────── */

let similarCache = { key: "", items: [] };
let similarOpenFor = ""; // 판정을 누른 작품은 다시 그려도 펼친 채로 둔다
async function showSimilar() {
  if (!work || !$("similar")) return;
  const key = work.id + work.updated;
  if (similarCache.key !== key) similarCache = { key, items: await api("similar/" + work.id) };
  if (work?.id + work?.updated === key && $("similar")) $("similar").innerHTML = similarHtml(similarCache.items);
}
const SIMILAR_MARKS = ["중복", "관련", "무관"];
function similarHtml(items) {
  if (!items.length) return "";
  const level = (score) => (score >= 0.35 ? "매우 비슷" : score >= 0.2 ? "비슷" : "조금 비슷");
  const duplicates = items.filter((x) => x.mark === "중복").length;
  return `<details class="similar no-print" ${similarOpenFor === work.id ? "open" : ""}>
    <summary>비슷한 제안 ${items.length}건${duplicates ? ` · 중복 판정 ${duplicates}건` : ""}</summary>
    <ul>${join(items, (x) => `<li>
      <span><button type="button" class="link" data-work="${esc(x.id)}">${esc(splitName(x.name)[1])}</button>
        <small>${level(x.score)} ${Math.round(x.score * 100)}% · 겹치는 말 ${esc(x.words.join(", "))}</small></span>
      <span class="marks" role="group" aria-label="판정">${join(SIMILAR_MARKS, (m) =>
        `<button type="button" data-similar-mark="${x.mark === m ? "" : m}" data-other="${esc(x.id)}" aria-pressed="${x.mark === m}">${m}</button>`)}</span>
    </li>`)}</ul></details>`;
}
async function markSimilar(other, mark) {
  similarOpenFor = work.id;
  await api("similar-mark", { id: work.id, other, mark });
  await sync(true);
}

/* ─────────────────────────── 사실·논리 점검 탭 ─────────────────────────── */

// 점검 결과 분류: 계산으로 확인 · 확인 필요(재검토로 확정) · 참고(재검토에서 확정하지 못한 후보)
const BADGES = { "계산으로 확인": "badge-danger", 참고: "badge-muted" };
// 참고는 평가자가 읽는 요약 문장에 대한 것만 보여 준다. 원문 안의 불일치·인과 해석은 평가자가 원문을 읽으며
// 직접 판단하고, 확정하지 못한 것은 대부분 소음이었다(30개 작품의 참고 63건 중 57건).
const shownIssues = (v) => v.issues.filter((i) => i.status !== "참고" || i.type === "요약과 원문 불일치");
// 참고가 아닌 항목 수와 참고 항목 수
const issueCounts = (v) => {
  const issues = shownIssues(v);
  const hints = issues.filter((i) => i.status === "참고").length;
  return { main: issues.length - hints, hints };
};
const countText = ({ main, hints }) => `확인할 항목 ${main}건${hints ? ` · 참고 ${hints}건` : ""}`;
// 점검 결과 목록. 참고는 소음이 되지 않게 아래에 접어 둔다.
function issueList(v) {
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

// 점검 맨 위 'AI가 본 이 아이디어' (idea-opinion.mjs). 점수·채택 판단은 하지 않는다.
function opinionPanel(o) {
  if (!o) return "";
  if (o.error) return `<p class="small muted">AI가 본 이 아이디어를 쓰지 못했습니다 · ${esc(o.error)}</p>`;
  const terms = new Set();
  const lines = (items) => join(items, (x) => claim(typeof x === "string" ? { text: x, refs: [] } : x, "li", "", terms));
  const block = (title, items, tag = "ul") => items.length ? `<div><h4>${title}</h4><${tag}>${lines(items)}</${tag}></div>` : "";
  return `<section class="opinion">
    <h3>AI가 본 이 아이디어</h3>
    ${o.take ? `<p class="opinion-take">${esc(o.take)}</p>` : ""}
    <div class="opinion-grid">${block("좋은 점", o.strengths)}${block("약한 점", o.weaknesses)}</div>
    <div class="opinion-grid">${block("제안자에게 물어볼 것", o.questions, "ol")}${block("우리 회사에 적용한다면", o.company)}</div>
    <small class="muted">AI 의견입니다. 점수와 채택 판단은 하지 않습니다.</small>
  </section>`;
}

function logicPane() {
  if (!currentReading())
    return emptyState(
      "요약이 먼저 필요합니다",
      "사실·논리 점검은 현재 자료의 내용 요약을 원문과 대조합니다.",
    );
  const v = currentLogic();
  const usage = haikuUsage("logic", v);
  if (!v)
    return emptyState(
      "요약을 아직 점검하지 않았습니다",
      "요약의 단정이 원문에 있는지, 같은 대상의 수치나 일정이 충돌하는지, 목표가 실적으로 바뀌었는지 점검합니다.",
      button("check-logic", "사실·논리 점검 실행", "primary", true),
    ) + usage;
  // 오류 후보 목록(계산으로 확인 · 원문 대조 필요 · 참고)은 오히려 헷갈려 보여 주지 않는다(2026-11-23 사용자 결정).
  return opinionPanel(v.opinion) + usage;
}

/* ─────────────────────────── 채점표 탭 ─────────────────────────── */

// 확정 전에 다시 볼 항목: 다시 캡처할 부분, 계산으로 확인한 불일치
function openItems() {
  const items = [];
  for (const c of work.captures)
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
function updateSheet(form) {
  let sum = 0;
  for (const field of form.querySelectorAll("[name=score]")) {
    const value = Math.min(Math.max(Number(field.value) || 0, 0), Number(field.max));
    sum += value;
    field.closest("td").querySelector(".meter i").style.setProperty("--fill", value / Number(field.max));
  }
  tween($("sheettotal"), Math.round(sum * 10) / 10);
  $("sheetmeter").style.setProperty("--fill", sum / 10);
}

// 채점 항목마다 판단에 쓰는 핵심 요약 항목. 기본 채점 기준의 이름으로 잇고, 이름을 바꾼 항목에는 붙이지 않는다.
const CRITERION_TOPICS = {
  "문제 정의": ["무엇이 문제인가"],
  "효과 크기": ["시사점과 활용"],
  "실행 가능성": ["어떻게 푸는가"],
  근거: ["무엇을 얻었나", "한계·확인할 점"],
  차별성: ["무엇을 하려는가"],
};
function criterionSummary(name, terms) {
  const r = currentReading();
  if (!r || !CRITERION_TOPICS[name]) return "";
  const brief = readingViews(r).brief;
  const points = CRITERION_TOPICS[name].map((topic) => brief.find((p) => p.topic === topic)).filter(Boolean);
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
  const prior = work.final || {};
  const items = openItems();
  const evaluator = localStorage.getItem("review.evaluator") || "";
  const terms = new Set();
  const rows = join(work.rubric.criteria, (c, i) =>
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
      ${choices("사전 확인", "check", app.sheet.checks, "checkbox", prior.checks, "감점 아님 · 담당 부서 확인용")}
      <table class="scoretable sheet"><thead><tr><th>항목</th><th>점수</th></tr></thead><tbody>${rows}
        <tr class="total"><td><b>합계</b></td><td class="number"><output id="sheettotal">${(prior.score ?? 0).toFixed(1)}</output> / 10.0
        <span class="meter total" aria-hidden="true"><i id="sheetmeter" style="--fill:${(prior.score ?? 0) / 10}"></i></span></td></tr></tbody></table>
      <div class="sheet-direction">
        ${choices("실행 규모", "scale", app.sheet.scales, "radio", [prior.scale])}
        ${choices("1차 결정", "decision", app.sheet.decisions, "radio", [prior.decision])}
        ${field("이관 부서", input("sheetdept", prior.department, "text", 'maxlength="80" placeholder="검토를 맡을 부서"'))}
      </div>
      ${field("제안자에게 전달할 의견", `<textarea id="sheetfeedback" maxlength="1000">${esc(prior.feedback || "")}</textarea>`)}
      ${field(items.length ? "확인한 내용과 심사 메모 · 필수" : "심사 메모 · 내부용", `<textarea id="finalnote" maxlength="2000" ${items.length ? "required" : ""}>${esc(prior.note || "")}</textarea>`)}
      ${field("평가자", input("sheetby", evaluator, "text", 'maxlength="40" required autocomplete="name" placeholder="이름"'))}
      <div><button class="primary">${items.length ? `${items.length}건 확인하고 확정` : "채점표 확정"}</button></div>
    </form>`;
}

function confirmedSheet() {
  const f = work.final;
  // 항목 점수는 시험지 채점란처럼 칸마다: 항목 이름 아래 색연필 점수 / 배점
  const scores = join(work.rubric.criteria, (c, i) =>
    `<div><dt>${esc(c.name)}</dt><dd><b>${f.scores[i].toFixed(1)}</b> / ${c.weight.toFixed(1)}</dd></div>`);
  const rows = [["1차 결정", f.decision], ["실행 규모", f.scale], ["이관 부서", f.department], ["사전 확인", f.checks.join(" · ")],
    ["제안자 의견", f.feedback], ["심사 메모", f.note], ["평가자", `${f.by} · ${seoulMinute(f.when)}`]].filter(([, value]) => value);
  const fresh = stampNext; // 방금 확정했을 때 한 번만 찍힌다
  stampNext = false;
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
  const assigned = assignedEvaluators(work);
  if (!assigned.length) return "";
  const criteria = app.defaults.criteria;
  const rows = join(assigned, (e) => {
    const x = work.evaluations?.[e.email];
    if (!x) return `<tr><td>${esc(e.name)}</td><td colspan="${criteria.length + 3}" class="muted">아직 적지 않음</td></tr>`;
    return `<tr><td>${esc(e.name)}</td>${join(x.scores, (s) => `<td class="number">${s ?? "—"}</td>`)}
      <td class="number"><b>${x.score ?? "—"}</b></td><td>${esc([x.scale, x.decision].filter(Boolean).join(" · "))}</td>
      <td>${x.complete ? esc(x.feedback) : `<span class="warn-text">고칠 칸 · ${esc(x.problems.join(", "))}</span>`}</td></tr>`;
  });
  const done = assigned.map((e) => work.evaluations?.[e.email]).filter((x) => x?.complete);
  const average = done.length ? (done.reduce((sum, x) => sum + x.score, 0) / done.length).toFixed(2) : "";
  return `<section class="panel evaluations">
    <div class="toolbar"><span><b>심사자 평가</b> · ${done.length} / ${assigned.length}명 완료${average ? ` · 평균 ${average}점` : ""}</span></div>
    <table class="scoretable"><thead><tr>${columnHeaders(["심사자", ...criteria.map((c) => c.name), "총점", "규모·결정", "의견"])}</tr></thead><tbody>${rows}</tbody></table>
  </section>`;
}

// 채택 검토로 확정한 작품의 실행 추적: 부서 검토 → 실행 중 → 효과 확인 (또는 실행 안 함)
function followupPanel() {
  if (work.final?.decision !== "채택 검토") return "";
  const f = work.followup ?? {};
  const history = (f.history ?? []).map((h) => `${h.stage} ${seoulMinute(h.at).slice(5, 10).replace("-", ".")}`).join(" → ");
  return `<section class="panel followup no-print">
    <div class="toolbar"><span><b>실행 추적</b>${history ? ` · ${esc(history)}` : ""}</span></div>
    <form id="followup" class="stack">
      ${choices("단계", "stage", app.sheet.stages, "radio", [f.stage ?? "부서 검토"])}
      <div class="formgrid">
        ${field("담당 부서", input("fdept", f.department ?? work.final.department, "text", 'maxlength="80"'))}
        ${field("담당자", input("fowner", f.owner, "text", 'maxlength="40"'))}
        ${field("예정일", input("fdue", f.due, "date"))}
      </div>
      ${field("실행 결과·효과", `<textarea id="feffect" maxlength="2000">${esc(f.effect ?? "")}</textarea>`)}
      <div><button class="primary">실행 추적 저장</button></div>
    </form>
  </section>`;
}

function reportPane() {
  return `${logicNote()}${evaluationsPanel()}
    <section class="panel" id="finalpanel">${work.final && !editingSheet ? confirmedSheet() : sheetForm()}</section>
    ${work.final && !editingSheet ? followupPanel() : ""}
    <div class="actions no-print">${button("print", "채점표 인쇄")}</div>
    ${rubricFold()}`;
}

/* ─────────────────────────── 채점 기준 고치기 ─────────────────────────── */

function criterionRow(c) {
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
  return `<details class="rubric-fold no-print"><summary>채점 기준 고치기 · 항목 ${work.rubric.criteria.length}개</summary>
    <form id="rubric">
      <p class="small muted">항목명, 배점(합계 10점), 판단 기준을 입력하세요. 판단 기준의 첫 문장이 채점표에 보입니다. 저장하면 이 작품의 확정 점수는 지워지고 요약은 그대로 남습니다.</p>
      <div id="criteria">${join(work.rubric.criteria, criterionRow)}</div>
      <div class="actions spaced">${button("add-criterion", "항목 추가")}<button class="primary">기준 저장</button></div>
    </form></details>`;
}

/* ─────────────────────────── 오른쪽 원문 패널 ─────────────────────────── */

// OCR 좌표(기울기 보정 전)를 화면 비율 좌표로 바꿔 상자를 그린다.
function outlineBox(c, b) {
  const angle = c.ocrInfo?.deskewAngle || 0;
  const theta = (angle * Math.PI) / 180;
  const cx = (c.ocrWidth - 1) / 2;
  const cy = (c.ocrHeight - 1) / 2;
  const dx = b.x + b.w / 2 - cx;
  const dy = b.y + b.h / 2 - cy;
  const x = cx + dx * Math.cos(theta) + dy * Math.sin(theta) - b.w / 2;
  const y = cy - dx * Math.sin(theta) + dy * Math.cos(theta) - b.h / 2;
  const pct = (value, size) => (value / size) * 100 + "%";
  return (
    `<i class="box" style="left:${pct(x, c.ocrWidth)};top:${pct(y, c.ocrHeight)};` +
    `width:${pct(b.w, c.ocrWidth)};height:${pct(b.h, c.ocrHeight)};transform:rotate(${-angle}deg)"></i>`
  );
}

function ocrNotes(c) {
  const info = c.ocrInfo;
  if (!info) return "";
  const uncertain = join(info.uncertain || [], (t, i) => ocrDifference(c, t, i));
  return (
    `<p class="muted small">${info.detailRead ? `기본·정밀 OCR 대조 · 추가 문장 ${info.added}개` : "기본 OCR"}` +
    ` · 셀 위치를 확인한 표 ${info.tables.length}개</p>` +
    (info.detailFailed
      ? '<p class="warning">정밀 판독을 완료하지 못했습니다.</p>'
      : "") +
    (info.uncertain.length
      ? `<details class="diag"><summary>확인이 필요한 숫자 ${info.uncertain.length}곳</summary><div class="diag-body">${uncertain}</div></details>`
      : "")
  );
}

let viewerOpener = null; // 패널을 닫으면 포커스를 돌려줄 버튼

function openViewer(captureId, evidence = null, ref = null) {
  const c = findCapture(captureId);
  if (!c) throw Error("현재 작품에서 근거 화면을 찾지 못했습니다.");
  if (!viewer) viewerOpener = document.activeElement;
  viewer = { captureId, evidence, ref, snapshot: JSON.stringify(c) };
  drawViewer(c);
  markActiveRef();
  $("evidence")
    .querySelector("[data-close-viewer]")
    .focus({ preventScroll: true });
}

function closeViewer() {
  if (!viewer) return;
  if ($("dialog").open && $("dialogbody").querySelector(".capture-stage")) closeDialog();
  viewer = null;
  $("evidence").hidden = true;
  $("evidence").innerHTML = "";
  document.body.classList.remove("has-evidence");
  markActiveRef();
  if (viewerOpener?.isConnected) viewerOpener.focus({ preventScroll: true });
  viewerOpener = null;
}

// 작품 데이터가 바뀌면 보고 있던 캡처만 다시 그린다.
function refreshViewer() {
  if (!viewer) return;
  const c = findCapture(viewer.captureId);
  if (!c) return closeViewer();
  const snapshot = JSON.stringify(c);
  if (snapshot === viewer.snapshot) return;
  viewer.snapshot = snapshot;
  drawViewer(c);
}

function captureOutlines(c, ev) {
  return (ev?.indexes || [])
    .map((i) => c.lines[i]?.box)
    .concat(ev?.boxes || [])
    .filter(Boolean)
    .map((b) => outlineBox(c, b))
    .join("");
}
function drawViewer(c) {
  const ev = viewer.evidence;
  const cited = new Set(ev?.indexes || []);
  const overlay = captureOutlines(c, ev);
  const pages = c.page ? `${c.page}${c.total ? " / " + c.total : ""}쪽` : "";
  const pane = $("evidence");
  pane.innerHTML = `
    <div class="viewer-head">
      ${viewer.ref ? `<span class="ref active">${esc(viewer.ref)}</span>` : ""}
      <strong title="${esc(c.label)}">${esc(c.label)}</strong>
      <small>${esc(pages)}</small>
      <span class="spacer"></span>
      <button type="button" class="iconbtn" data-close-viewer title="닫기 (Esc)" aria-label="원문 닫기">${icon("close")}</button>
    </div>
    ${ev ? `<p class="evidencequote"><strong>${esc(ev.kind === "OCR" ? "인식 문장" : ev.kind)}</strong> · ${esc(ev.text)}</p>` : ""}
    <div class="viewer-tools"><button type="button" data-image-zoom aria-haspopup="dialog">원본 확대</button></div>
    <div class="image-scroll"><button type="button" class="viewbox" data-image-zoom aria-haspopup="dialog" aria-label="${esc(c.label)} 확대" title="원본 확대"><img src="/api/image/${c.id}" alt="${esc(c.label)}" draggable="false">${overlay}</button></div>
    <h2>인식 문장</h2>
    ${ocrNotes(c)}
    <ol class="ocrlines">${join(c.lines, (l, i) => `<li class="${cited.has(i) ? "cited" : ""}">${esc(l.text)}</li>`)}</ol>
    ${c.ocrError ? `<p class="warning">${esc(c.ocrError)}</p>` : ""}
    ${c.sumCheck ? `<p class="warning">${esc(c.sumCheck.text)}</p>` : ""}
    ${sumForm(c)}
    <button type="button" data-edit="${esc(c.id)}">판독 정보 편집</button>`;
  pane.hidden = false;
  document.body.classList.add("has-evidence");
  pane.scrollTop = 0;
  // 본문의 읽던 위치를 유지하고 원문 패널 안에서만 인용 위치로 이동한다.
  const imageButton = pane.querySelector(".viewbox");
  imageButton.querySelector("img").decode().then(() => {
    const box = imageButton.querySelector(".box");
    if (!box || !imageButton.isConnected || $("dialog").open) return;
    const mark = box.getBoundingClientRect();
    pane.scrollTop += mark.top + mark.height / 2 - pane.getBoundingClientRect().top - pane.clientHeight / 2;
  }).catch(() => {});
}

// 패널에 열린 근거 칩과 그 요점을 강조한다.
function markActiveRef() {
  for (const el of document.querySelectorAll(
    "#main .ref.active, #main .claim.active",
  ))
    el.classList.remove("active");
  if (!viewer?.ref) return;
  for (const b of document.querySelectorAll(
    `#main .ref[data-ref="${CSS.escape(viewer.ref)}"]`,
  )) {
    b.classList.add("active");
    b.closest(".claim")?.classList.add("active");
  }
}

function showRef(refId) {
  const ref = currentEvidence()?.[refId];
  if (!ref) throw Error("현재 자료에서 원문을 찾을 수 없습니다.");
  openViewer(ref.capture, ref, refId);
}

function showUncertain(captureId, index) {
  const issue = findCapture(captureId)?.ocrInfo?.uncertain[index];
  if (!issue) return;
  const item = explainOcr(issue);
  openViewer(captureId, {
    kind: "OCR 판독 대조",
    text: [item.reason, "기본 · " + item.basic, "정밀 · " + item.fine, item.crop].join(" "),
    boxes: [issue.box],
  });
}

function openCaptureGallery(opener, captureId, evidence) {
  const captures = work.captures;
  let index = captures.findIndex((c) => c.id === captureId);
  if (index < 0 || $("dialog").open) return;
  opener.focus({ preventScroll: true });
  dialog(captures[index].label, `<div class="capture-stage"><button type="button" class="viewbox" data-zoom-detail></button><span role="status" hidden>이미지를 불러오지 못했습니다.</span></div>
    <nav class="capture-nav" aria-label="캡처 이동">
      <button type="button" class="iconbtn" data-gallery-step="-1" aria-label="이전 캡처" title="이전 캡처 (←)">${icon("prev", 24)}</button>
      <span aria-live="polite" aria-atomic="true"></span>
      <button type="button" class="iconbtn" data-gallery-step="1" aria-label="다음 캡처" title="다음 캡처 (→)">${icon("next", 24)}</button></nav>`);
  const body = $("dialogbody");
  const stage = body.querySelector(".capture-stage");
  const view = stage.querySelector(".viewbox");
  const error = stage.querySelector("[role=status]");
  const nav = body.querySelector(".capture-nav");
  const [prev, next] = nav.querySelectorAll("button");
  function showPage(i) {
    index = i;
    const c = captures[i];
    $("dialogtitle").textContent = c.label;
    nav.querySelector("span").textContent = `${i + 1} / ${captures.length}`;
    prev.disabled = i === 0;
    next.disabled = i === captures.length - 1;
    const img = new Image();
    img.alt = c.label;
    img.draggable = false;
    view.innerHTML = c.id === captureId ? captureOutlines(c, evidence) : "";
    view.prepend(img);
    view.style.width = "";
    view.setAttribute("aria-pressed", "false");
    view.setAttribute("aria-label", "세부 확대");
    view.title = "클릭한 부분 확대";
    view.hidden = true;
    error.hidden = true;
    stage.scrollTo(0, 0);
    img.onload = () => {
      if (!view.contains(img)) return;
      stage.style.setProperty("--page-ratio", img.naturalWidth / img.naturalHeight);
      stage.style.setProperty("--page-width", img.naturalWidth + "px");
      view.hidden = false;
    };
    img.onerror = () => { if (view.contains(img)) error.hidden = false; };
    img.src = "/api/image/" + encodeURIComponent(c.id);
  }
  prev.onclick = () => showPage(index - 1);
  next.onclick = () => showPage(index + 1);
  showPage(index);
}

function zoomCaptureDetail(view, event) {
  const stage = view.parentElement;
  const before = view.getBoundingClientRect();
  const enlarged = view.getAttribute("aria-pressed") !== "true";
  view.setAttribute("aria-pressed", String(enlarged));
  view.title = enlarged ? "쪽 전체 보기" : "클릭한 부분 확대";
  view.setAttribute("aria-label", enlarged ? "쪽 전체 보기" : "세부 확대");
  if (!enlarged) {
    view.style.width = "";
    return;
  }
  const anchor = view.querySelector(".box")?.getBoundingClientRect() ?? before;
  const x = event.detail ? event.clientX : anchor.left + anchor.width / 2;
  const y = event.detail ? event.clientY : anchor.top + anchor.height / 2;
  view.style.width = Math.max(view.querySelector("img").naturalWidth * 1.5, before.width * 2) + "px";
  stage.scrollTo(view.offsetLeft + (x - before.left) / before.width * view.offsetWidth - stage.clientWidth / 2,
    view.offsetTop + (y - before.top) / before.height * view.offsetHeight - stage.clientHeight / 2);
}

function sumForm(c) {
  if (!c.amounts?.length) return "";
  const label = (x) => esc(x.number + x.unit + " · " + c.lines[x.line].text);
  return `
    <details class="diag">
      <summary>화면에 보이는 수치 합계 검산</summary>
      <form class="stack diag-body" id="sumform" data-id="${c.id}">
        <p class="small muted">동일 단위인 항목만 선택하세요. 화면 밖 수식이나 숨은 행은 포함되지 않습니다.</p>
        ${join(c.amounts, (x) => `<label class="check"><input name="parts" type="checkbox" value="${esc(x.id)}">${label(x)}</label>`)}
        ${field("원문에 표시된 합계", `<select id="reported" required><option value="">선택</option>${join(c.amounts, (x) => `<option value="${esc(x.id)}">${label(x)}</option>`)}</select>`)}
        ${field("원문에서 확인한 공통 단위", input("amountunit", "", "text", 'required maxlength="16" placeholder="예: 만원"'))}
        <div><button>검산 결과 저장</button></div>
      </form>
    </details>`;
}

/* ─────────────────────────── 캡처 편집 ─────────────────────────── */

function editCapture(c) {
  dialog(
    "캡처 편집",
    `<form id="editcapture" data-id="${c.id}" class="stack">
      ${field("표시 이름", input("clabel", c.label, "text", 'required maxlength="180"'))}
      ${field("문서 또는 시트 이름", input("cdoc", c.document, "text", 'required maxlength="100"'))}
      <div class="actions">
        ${field("현재 쪽", input("cpage", c.page, "number", 'min="1" max="2000"'))}
        ${field("전체 쪽", input("ctotal", c.total, "number", 'min="1" max="2000"'))}
      </div>
      ${field("다시 캡처할 부분 · 선택", input("cissue", c.issue, "text", 'placeholder="예: 예산표 오른쪽 단위가 잘림"'))}
      <label class="check"><input type="checkbox" id="cvisual" ${c.visual ? "checked" : ""}>도식 검토 · 요약할 때 이 쪽은 이미지도 AI에 보내 읽기</label>
      <div class="actions">
        <button class="primary">저장</button>
        <button type="button" data-retry="${c.id}">OCR 다시 읽기</button>
        <button type="button" class="danger" data-remove="${c.id}">캡처 삭제</button>
      </div>
    </form>`,
  );
}

async function changeCapture(captureId, change) {
  if (change === "remove" && !confirm("선택한 캡처를 삭제할까요?")) return;
  await api("capture", {
    id: work.id,
    rev: work.rev,
    capture: captureId,
    action: change,
  });
  closeDialog();
  await sync(true);
}

/* ─────────────────────────── 캡처 올리기 ─────────────────────────── */

function asBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function upload(files, fromWindow = false) {
  const images = files.filter((f) => f.type.startsWith("image/"));
  if (files.length && !images.length)
    throw Error("PNG·JPG·WebP 이미지 파일만 추가할 수 있습니다.");
  const id = selected; // 올리는 도중 다른 작품을 골라도 처음 작품에 저장
  if (!id || !images.length || uploading) return;
  rememberFields();
  const fields = { ...docFields };
  uploading = true;
  showJob();
  // 한 장이 실패해도(중복·용량 초과 등) 나머지는 계속 올리고 끝에 함께 알린다.
  const failed = [];
  try {
    for (const [i, file] of images.entries()) {
      const name = file.name || "창 캡처";
      if (images.length > 1)
        notify(`캡처 올리는 중 ${i + 1} / ${images.length}`);
      try {
        if (file.size > MAX_IMAGE_BYTES)
          throw Error("한 장에 14MB 이하의 이미지를 사용하세요.");
        await api("upload", {
          id,
          document: fields.document,
          label: (fields.document || "제안서") + " · " + name,
          data: await asBase64(file),
        });
      } catch (e) {
        failed.push(`${name}: ${e.message}`);
      }
    }
    const done = images.length - failed.length;
    if (failed.length)
      notify(`${done}장 접수, ${failed.length}장 실패 · ${failed.slice(0, 3).join(" / ")}`, true);
    else notify(`${done}장 접수했습니다.`);
  } finally {
    uploading = false;
    if (!fromWindow && $("files")) $("files").value = "";
    await sync(true);
  }
}

async function openScreen() {
  if (!navigator.mediaDevices?.getDisplayMedia)
    throw Error(
      "이 브라우저는 창 공유를 지원하지 않습니다. 허용된 캡처 이미지를 추가하세요.",
    );
  const shared = await navigator.mediaDevices.getDisplayMedia({
    video: true,
    audio: false,
  });
  dialog(
    "문서 창 캡처",
    `<div class="cam">
      <video id="live" autoplay muted playsinline></video>
      <span id="detect" role="status">캡처할 화면을 확인하세요.</span>
      <div>${button("snap", "현재 화면 추가", "primary")}</div>
    </div>`,
  );
  stream = shared;
  const video = $("live");
  video.srcObject = stream;
  await video.play();
  stream
    .getVideoTracks()[0]
    .addEventListener("ended", () => stream && closeDialog(), { once: true });
  watchScreenChanges(video);
}

// 작은 축소판을 비교해 화면이 바뀐 뒤 멈추면 안내한다.
function watchScreenChanges(video) {
  const canvas = document.createElement("canvas");
  canvas.width = 48;
  canvas.height = 32;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  let prev = null;
  let changed = false;
  watchTimer = setInterval(() => {
    if (!video.videoWidth) return;
    ctx.drawImage(video, 0, 0, 48, 32);
    const frame = ctx.getImageData(0, 0, 48, 32).data;
    if (prev) {
      let delta = 0;
      for (let i = 0; i < frame.length; i += 4)
        delta += Math.abs(frame[i] - prev[i]);
      if (delta / (48 * 32) > 3) changed = true;
      else if (changed) {
        $("detect").textContent =
          "화면 변경 감지 · 준비되면 현재 화면을 추가하세요.";
        changed = false;
      }
    }
    prev = frame;
  }, 700);
}

async function snapScreen() {
  const video = $("live");
  if (!video?.videoWidth) return;
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext("2d").drawImage(video, 0, 0);
  const blob = await new Promise((resolve) =>
    canvas.toBlob(resolve, "image/png"),
  );
  if (!blob) throw Error("캡처 실패");
  await upload([blob], true);
  if ($("detect"))
    $("detect").textContent = "접수 완료. 다음 화면으로 이동하세요.";
}

/* ─────────────────────────── 버튼 동작 ─────────────────────────── */

/* ─────────────────────────── 일괄 요약·점검 ───────────────────────────
   여러 작품을 한 번에 대기열에 넣는다. 서버가 한 작품씩 차례로 처리하고, 요약을 만들면 점검까지 이어서 한다. */
// 쪽당 어림값(실측). 요약: 46쪽 $0.045·66쪽 $0.074, 3~4분. 점검: 20쪽 $0.005·25초, 61쪽 $0.021·100초.
const LOGIC_USD = 0.00035, LOGIC_SEC = 2;
const BATCH_PER_PAGE = { summarize: { usd: 0.0011 + LOGIC_USD, sec: 4 + LOGIC_SEC }, "check-logic": { usd: LOGIC_USD, sec: LOGIC_SEC } };
const BATCH_SCOPES = {
  todo: ["요약이나 점검이 없는 작품", () => app.works.filter((x) => !x.hasLogic)],
  shown: ["지금 목록에 보이는 작품 (요약부터 다시)", filteredWorks],
};
// 캡처가 있고 지금 작업 중이 아닌 작품만 넣을 수 있다.
const batchTargets = (scope) => BATCH_SCOPES[scope][1]().filter((x) => x.count > 0 && !jobsByWork.has(x.id));
// 할 일만 고르면 요약이 있는 작품은 점검만 하고, 그 밖에는 요약부터 한다.
const batchRoute = (scope, x) => (scope === "todo" && x.hasReading ? "check-logic" : "summarize");
function batchNote(scope) {
  const targets = batchTargets(scope);
  if (!targets.length) return "넣을 수 있는 작품이 없습니다.";
  const sum = (key) => targets.reduce((n, x) => n + x.count * BATCH_PER_PAGE[batchRoute(scope, x)][key], 0);
  const pages = targets.reduce((n, x) => n + x.count, 0);
  return `${targets.length}개 작품 · ${pages}쪽 · 예상 약 ${Math.max(1, Math.round(sum("sec") / 60))}분 · 예상 비용 약 $${sum("usd").toFixed(2)} (어림값)`;
}
function openBatchSummary() {
  dialog("일괄 요약·점검", `<form id="batch-summary" class="stack">
    ${field("대상", `<select name="scope">${join(Object.entries(BATCH_SCOPES), ([id, [label]]) => `<option value="${id}">${label}</option>`)}</select>`)}
    <p id="batch-note" class="small">${batchNote("todo")}</p>
    <p class="small muted">${cloudScope()}</p>
    <div class="actions"><button class="primary">대기열에 넣기</button></div></form>`);
}

// 최근 7일(UTC) 사용량 표: 앱이 응답마다 받은 사용량으로 적은 기록과 Anthropic이 직접 집계한 토큰을 나란히 놓는다.
// 두 토큰 수가 같으면 앱의 비용 추정을 믿을 수 있다. 같은 키를 다른 프로그램도 쓰면 Anthropic 쪽이 더 크게 나온다.
function usageCheck({ days, reported, reportError, recordingSince }) {
  const n = (v) => v.toLocaleString("ko-KR");
  const money = (v) => (v === null ? "확인 불가" : usd.format(Number(v.toFixed(4))));
  const rows = join(days, (d) => {
    const r = reported?.[d.day];
    const unmeasured = d.requests - d.measured;
    return `<tr><th scope="row">${d.day}</th><td>${d.runs}회${unmeasured ? ` <small>응답 없음 ${unmeasured}건</small>` : ""}</td>
      <td>${n(d.totalTokens)}</td><td>${money(d.estimatedUsd)}</td>
      ${reported ? `<td>${r ? n(r.totalTokens) : "—"}</td><td>${r ? money(r.usd) : "—"}</td>
        <td>${r ? (r.totalTokens === d.totalTokens ? "일치" : (r.totalTokens > d.totalTokens ? "+" : "") + n(r.totalTokens - d.totalTokens)) : "—"}</td>` : ""}</tr>`;
  });
  const source = app?.ai?.provider === "litellm" ? esc(reportError) : reported
    ? "Anthropic 집계는 이 키의 조직 전체 사용량이라, 같은 키를 다른 곳에서도 쓰면 앱 기록보다 큽니다."
    : `Anthropic 집계는 이 API 키로 조회할 수 없습니다(${esc(reportError)}). 조직용 Admin 키가 있어야 자동으로 대조되고, 지금은 Claude Console의 Cost·Usage 화면에서 같은 날짜(UTC)의 Haiku 5.5 금액과 비교하세요.`;
  return `<section class="usage-check"><h3>AI 사용량 확인 · 최근 7일(UTC)</h3>
    ${days.length ? `<table><thead><tr><th>날짜</th><th>실행</th><th>앱 기록 토큰</th><th>앱 추정 비용</th>
      ${reported ? "<th>Anthropic 집계 토큰</th><th>집계 기준 비용</th><th>토큰 차이</th>" : ""}</tr></thead><tbody>${rows}</tbody></table>` : '<p class="small muted">아직 기록된 실행이 없습니다.</p>'}
    <p class="small muted">${recordingSince ? `실행 기록은 ${esc(recordingSince.slice(0, 16).replace("T", " "))} UTC부터 남기기 시작했습니다. ` : "실행 기록은 지금부터 남습니다. "}${source}</p></section>`;
}

async function openSummarySettings() {
  const [info, cost] = await Promise.all([api("summary-settings"), api("haiku-cost")]);
  // 키·연결 주소·모델은 키를 등록한 브라우저(처음에는 아무 브라우저)에서 바꾼다. 저장할 때 서버가 그 설정으로 모델을 확인한다.
  const manage = info.canManageKey;
  dialog("요약 설정", `<form id="summary-config" class="stack">
    <p class="small">요약 모델 · ${summaryModel()}</p>
    <p class="small muted">${cloudScope()}</p>
    <p class="small">${info.configured ? aiLabel() + " · 서버에 저장된 키를 자동으로 사용합니다." : "API 키를 입력해 저장하면 AI 요약을 쓸 수 있습니다."}</p>
    ${manage ? `
      ${field(info.configured ? "API 키 · 바꿀 때만 입력" : "API 키", `<input type="password" name="token" maxlength="512" autocomplete="off" spellcheck="false" ${info.configured ? "" : "required"}>`)}
      ${field("연결 주소 · 회사 LiteLLM이면 입력, 비우면 Anthropic", input("aibase", info.endpoint, "url", 'maxlength="300" placeholder="https://litellm.회사주소"'))}
      ${field("모델 · 비우면 Haiku 5.5", input("aimodel", info.model === "claude-haiku-5-5" ? "" : info.model, "text", 'maxlength="100" placeholder="claude-haiku-5-5"'))}`
      : `${field("이 브라우저 연결 · 지금 등록된 API 키를 입력하면 여기서도 설정을 바꿀 수 있습니다", '<input type="password" name="token" maxlength="512" autocomplete="off" spellcheck="false" required>')}
        <input id="aibase" type="hidden" value="${esc(info.endpoint)}"><input id="aimodel" type="hidden" value="${esc(info.model)}">`}
    <div class="actions"><button class="primary">${manage ? "설정 저장" : "브라우저 연결"}</button>
    ${info.local && info.configured ? button("link-web-browser", "웹 브라우저에서 키 관리") : ""}</div></form>
    ${usageCheck(cost)}`);
}

// 공모 연동 설정: MS Forms 응답 엑셀과 첨부가 내려받아지는 OneDrive 폴더를 이 맥의 선택 창으로 고른다.
// 엑셀 열(A ID · C 완료 시간 · D 이메일 · E 이름 · G 소속 · H 제목 · I 간략 설명 · J 첨부 파일명)은 서버가 자동으로 맞춘다.
const formsPick = { workbook: "", attachments: "" };
async function openFormsSettings() {
  const info = await api("forms-settings");
  formsPick.workbook = info.workbook?.path ?? "";
  formsPick.attachments = info.attachments?.path ?? "";
  const source = (key, title, place, check) => `<section class="setup-step"><h3>${title}</h3><div class="source-row">
      <div><span id="${key}-label"${place ? "" : ' class="muted"'}>${esc(place?.label ?? "아직 고르지 않았습니다")}</span>
        ${check ? `<small class="${check.ok ? "ok-text" : "warn-text"}">${esc(check.text)}</small>` : ""}</div>
      <button type="button" data-action="choose-source" data-pick="${key}">찾아보기</button></div></section>`;
  dialog("공모 연동 설정", `<form id="forms-config" class="stack">
    ${info.error && !info.check ? `<p class="warn-text small">${esc(info.error)}</p>` : ""}
    ${source("workbook", "MS Forms 응답 엑셀", info.workbook, info.check?.workbook)}
    ${source("attachments", "첨부 파일 폴더", info.attachments, info.check?.attachments)}
    <p class="small muted">찾아보기를 누르면 서버 맥 화면에 선택 창이 열립니다. 엑셀의 인입일·접수 팀명·접수자·이메일·간략 설명·첨부 파일명은 열 위치로 자동으로 읽습니다.</p>
    <div class="actions"><button class="primary">설정 저장</button></div>
  </form>`);
}

// 요약과 사실·논리 점검은 Claude Haiku로 실행한다. 요약을 만들면 서버가 점검까지 이어서 한다.
async function startJob(route, nextTab) {
  const summary = route === "summarize" || route === "check-logic";
  const target = workRef();
  if (summary) {
    const settings = await api("summary-settings");
    if (selected !== target.id || work?.rev !== target.rev) return;
    if (!settings.configured) return openSummarySettings();
    const scope = route === "summarize" ? "요약에 이어 사실·논리 점검까지 실행합니다.\n" : "";
    if (!confirm(`${work.name}\n${scope}${cloudScope()}\n${aiLabel()}로 실행할까요?`)) return;
  }
  await api(route, { ...target, ...(summary ? { provider: "haiku" } : {}) });
  if (selected !== target.id) return;
  if (route === "summarize") closeViewer();
  tab = nextTab;
  await sync(true);
}

async function runSummaryCommand(id) {
  if (summaryUnavailable(id)) return;
  submittingSummaries.add(id);
  try {
    if (selected !== id) await select(id);
    if (selected !== id || work?.id !== id) return;
    showJob();
    await startJob("summarize", "요약");
  } finally {
    submittingSummaries.delete(id);
    if (app) showJob();
  }
}

async function setComplete(complete) {
  await api("settings", { ...workRef(), rubric: work.rubric, complete });
  await sync(true);
}

const actions = {
  "summary-settings": openSummarySettings,
  "batch-summary": openBatchSummary,
  "export-all": () => (location.href = "/api/export"), // 서버가 첨부 파일로 보내 화면은 그대로다
  "intake-sync": async () => {
    const v = await api("intake-sync", {});
    notify(v.error ? `가져오기 · ${v.error}` : "MS Forms 응답과 평가표를 다시 읽었습니다.", !!v.error);
    await sync(true);
  },
  distribute: openDistribute,
  "link-web-browser": async () => { location.assign((await api("summary-link", {})).url); },
  "edit-intake": () => dialog(
    "접수 정보 수정",
    `<form id="edit-intake" class="stack" data-id="${esc(work.id)}" data-version="${work.intakeVersion ?? 0}">
      ${intakeInputs(work)}
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
  "open-report": () => switchTab("결과"),
  "open-summary": () => switchTab("요약"),
  "go-final": () => {
    $("finalpanel")?.scrollIntoView({ behavior: "smooth", block: "start" });
    document.querySelector("#final [name=score]")?.focus({ preventScroll: true });
  },
  "next-work": () => stepWork(1),
  "check-logic": () => startJob("check-logic", "점검"),
  print: () => {
    for (const fold of document.querySelectorAll("#content details")) fold.open = true; // 접힌 내용도 인쇄한다
    window.print();
  },
  "edit-sheet": () => {
    editingSheet = true;
    render();
  },
  screen: openScreen,
  snap: snapScreen,
  "add-criterion": () => {
    $("criteria").insertAdjacentHTML(
      "beforeend",
      criterionRow({ name: "", weight: 1, guide: "" }),
    );
    unsavedForm = true;
  },
  "mark-visual": async () => {
    const ids = suggestedVisual().map((c) => c.id);
    if (!ids.length || !confirm(`도식 검토 추천 ${ids.length}쪽을 도식 검토로 지정할까요?\n다음 요약부터 이 쪽들은 이미지도 AI에 보내 읽습니다. 지금의 요약·점검·확정 채점표는 다시 만들어야 합니다.`)) return;
    const { count } = await api("visual", { ...workRef(), captures: ids });
    notify(`${count}쪽을 도식 검토로 지정했습니다. 내용 요약을 다시 만들면 반영됩니다.`);
    await sync(true);
  },
  "forms-settings": openFormsSettings,
  "choose-source": async (b) => {
    const { path, label } = await api("forms-choose", { kind: b.dataset.pick });
    if (!path) return; // 선택 창에서 취소
    formsPick[b.dataset.pick] = path;
    $(b.dataset.pick + "-label").textContent = label;
    $(b.dataset.pick + "-label").className = "picked";
  },
  "remove-work": async () => {
    if (!confirm(`${work.name} 작품과 저장된 캡처 및 채점표를 삭제할까요?`))
      return;
    await api("remove-work", { id: work.id, rev: work.rev });
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
function stepWork(delta) {
  const list = filteredWorks();
  const next = list[list.findIndex((x) => x.id === work.id) + delta];
  if (next) return select(next.id);
}

async function switchTab(next) {
  const from = document.activeElement?.closest(".steptabs") ? ".steptabs" : "#sidenav"; // 누른 쪽 탭에 포커스를 돌려준다
  tab = next;
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

async function onClick(e) {
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
  if (b.id === "new") return openCreate();
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
  if (d.summaryCommand) return runSummaryCommand(b.closest("[data-summary-work]").dataset.summaryWork);
  if ("stage" in d) {
    listQuery.stage = d.stage;
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
  if ("imageZoom" in d) return openCaptureGallery(b, viewer.captureId, viewer.evidence);
  if ("zoomDetail" in d) return zoomCaptureDetail(b, e);
  if (d.gallery) return openCaptureGallery(b, d.gallery, d.sourceRef ? currentEvidence()?.[d.sourceRef] : null);
  if ("ocrIndex" in d) return showUncertain(d.capture, Number(d.ocrIndex));
  if (d.ref) return showRef(d.ref);
  if (d.edit) return editCapture(findCapture(d.edit));
  if (d.remove) return changeCapture(d.remove, "remove");
  if (d.retry) return changeCapture(d.retry, "retry");
  if ("delk" in d) {
    b.closest(".rubedit").remove();
    unsavedForm = true;
  }
}

/* ─────────────────────────── 폼 제출 ─────────────────────────── */

const fieldValue = (id) => $(id).value;
const workRef = () => ({ id: work.id, rev: work.rev }); // 서버가 최신 판인지 확인
const readIntake = (form) => Object.fromEntries(new FormData(form));

const forms = {
  "batch-summary": async (form) => {
    if (!(await api("summary-settings")).configured) return openSummarySettings();
    const scope = form.elements.scope.value, targets = batchTargets(scope), failed = [];
    for (const x of targets)
      await api(batchRoute(scope, x), { id: x.id, rev: x.rev, provider: "haiku" }).catch((e) => failed.push(e.message));
    closeDialog();
    const queued = targets.length - failed.length;
    notify(`${queued}개 작품을 대기열에 넣었습니다.` + (failed.length ? ` ${failed.length}개는 넣지 못했습니다 · ${failed[0]}` : ""), !queued);
    await sync(true);
  },
  login: async () => {
    await api("login", { code: fieldValue("accesscode") });
    closeDialog();
    notify("접속했습니다.");
  },
  "forms-config": async (form) => {
    await api("forms-settings", formsPick);
    notify("공모 연동 설정을 저장했습니다.");
    await openFormsSettings(); // 고른 곳에서 읽은 결과를 바로 보여 준다
    await sync(true);
  },
  "summary-config": async (form) => {
    await api("summary-token", { key: form.elements.token.value.trim(), baseUrl: fieldValue("aibase"), model: fieldValue("aimodel") });
    closeDialog();
    notify("요약 설정을 저장했습니다.");
  },
  create: async (form) => {
    const { id } = await api("create", { name: fieldValue("name"), ...readIntake(form) });
    closeDialog();
    await chooseWork(id);
  },
  "edit-intake": async (form) => {
    await api("intake", {
      id: form.dataset.id,
      intakeVersion: Number(form.dataset.version),
      ...readIntake(form),
    });
    closeDialog();
    notify("접수 정보를 저장했습니다.");
  },
  rubric: async () => {
    const criteria = [...$("criteria").children].map((row) =>
      Object.fromEntries(
        [...row.querySelectorAll("[data-k]")].map((el) => [
          el.dataset.k,
          el.dataset.k === "weight" ? Number(el.value) : el.value,
        ]),
      ),
    );
    await api("settings", {
      ...workRef(),
      complete: work.complete,
      rubric: { categories: work.rubric.categories, criteria },
    });
    notify("이 작품의 기준을 저장했습니다.");
  },
  sumform: async (form) => {
    const result = await api("sum", {
      ...workRef(),
      capture: form.dataset.id,
      parts: [...form.querySelectorAll("[name=parts]:checked")].map(
        (x) => x.value,
      ),
      reported: fieldValue("reported"),
      unit: fieldValue("amountunit"),
    });
    notify(result.text);
  },
  editcapture: async (form) => {
    await api("capture", {
      ...workRef(),
      capture: form.dataset.id,
      label: fieldValue("clabel"),
      document: fieldValue("cdoc"),
      page: Number(fieldValue("cpage")) || null,
      total: Number(fieldValue("ctotal")) || null,
      visual: $("cvisual").checked,
      issue: fieldValue("cissue"),
    });
    closeDialog();
  },
  distribute: async () => {
    const { report } = await api("distribute", {});
    closeDialog();
    notify("심사 배포 · " + report.map((r) => `${r.name} ${r.assigned}건${r.added ? `(새 ${r.added}건)` : ""}`).join(" · "));
  },
  followup: async (form) => {
    await api("followup", {
      ...workRef(),
      stage: form.querySelector("[name=stage]:checked")?.value,
      department: fieldValue("fdept"),
      owner: fieldValue("fowner"),
      due: fieldValue("fdue"),
      effect: fieldValue("feffect"),
    });
    notify("실행 추적을 저장했습니다.");
  },
  final: async (form) => {
    const picked = (name) => [...form.querySelectorAll(`[name=${name}]:checked`)].map((x) => x.value);
    await api("final", {
      ...workRef(),
      scores: [...form.querySelectorAll("[name=score]")].map((x) => Number(x.value)),
      checks: picked("check"),
      scale: picked("scale")[0],
      decision: picked("decision")[0],
      department: fieldValue("sheetdept"),
      feedback: fieldValue("sheetfeedback"),
      note: fieldValue("finalnote"),
      by: fieldValue("sheetby"),
      base: form.dataset.base || null, // 연 뒤에 다른 평가자가 바꿨으면 서버가 거절한다
    });
    localStorage.setItem("review.evaluator", fieldValue("sheetby"));
    editingSheet = false;
    stampNext = true;
    notify("채점표를 확정했습니다.");
  },
};

async function onSubmit(e) {
  e.preventDefault();
  const submitter = e.submitter;
  if (submitter) submitter.disabled = true;
  try {
    await forms[e.target.id]?.(e.target);
    await sync(true);
  } finally {
    if (submitter) submitter.disabled = false;
  }
}

/* ─────────────────────────── 이벤트 연결 ─────────────────────────── */

async function onChange(e) {
  if (e.target.id === "files") return upload([...e.target.files]);
  if (e.target.id === "sort") {
    listQuery.sort = e.target.value;
    return render();
  }
  if (e.target.id === "complete") return setComplete(e.target.checked);
  if (e.target.form?.id === "batch-summary") $("batch-note").textContent = batchNote(e.target.value);
}

// 파일은 화면 어디에 놓아도 받는다. 브라우저가 이미지를 열어 버리는 것도 막는다.
function onDrag(e) {
  if (!e.dataTransfer?.types.includes("Files")) return;
  e.preventDefault();
  const drop = $("drop");
  drop?.classList.toggle("drag", e.type === "dragover");
  if (e.type !== "drop") return;
  if ($("dialog").open) return;
  if (!work || tab !== "자료") throw Error("캡처는 ‘캡처 자료’ 탭에서 추가할 수 있습니다.");
  return upload([...e.dataTransfer.files]);
}

function onPaste(e) {
  if (!work || tab !== "자료" || $("dialog").open) return;
  const files = [...e.clipboardData.files].filter((f) =>
    f.type.startsWith("image/"),
  );
  if (!files.length) return;
  e.preventDefault();
  return upload(files);
}

// 단축키: Esc 닫기, 1–4 단계 이동, J/K 다음·이전 작품 (입력 중에는 동작하지 않음)
function onKey(e) {
  if ($("dialog").open && !e.altKey && !e.ctrlKey && !e.metaKey && ["ArrowLeft", "ArrowRight"].includes(e.key)) {
    const step = e.key === "ArrowLeft" ? -1 : 1;
    const arrow = $("dialogbody").querySelector(`[data-gallery-step="${step}"]`);
    if (arrow) {
      e.preventDefault();
      arrow.click();
      return;
    }
  }
  if (e.key === "Escape") {
    if ($("dialog").open) return;
    const menu = $("menu-toggle");
    if (menu?.getAttribute("aria-expanded") === "true") {
      menu.setAttribute("aria-expanded", "false");
      menu.focus();
    } else if (viewer) closeViewer();
    return;
  }
  const el = document.activeElement;
  const typing = el.matches("input, textarea, select") || $("dialog").open;
  if (typing || e.metaKey || e.ctrlKey || e.altKey || !work) return;
  const steps = Object.keys(STEP_TABS);
  if (e.key >= "1" && e.key <= "4") return switchTab(steps[Number(e.key) - 1]);
  if (e.key === "j") return safe(stepWork)(1);
  if (e.key === "k") return safe(stepWork)(-1);
}

// 모든 이벤트 오류는 화면 아래 알림으로 보여 준다.
const safe =
  (fn) =>
  (...args) =>
    Promise.resolve(fn(...args)).catch((e) => notify(e.message, true));

document.addEventListener("click", safe(onClick));
// 근거 미리보기에 넘길 근거와 그 캡처
const peek = evidencePeek((id) => {
  const evidence = currentEvidence()?.[id];
  return evidence ? { evidence, capture: findCapture(evidence.capture) } : null;
});
tiltPages(".summary-image");
document.addEventListener("submit", safe(onSubmit));
document.addEventListener("change", safe(onChange));
document.addEventListener("paste", safe(onPaste));
document.addEventListener("keydown", onKey);
matchMedia("(max-width: 700px)").addEventListener("change", () => {
  $("menu-toggle")?.setAttribute("aria-expanded", "false");
});
for (const type of ["dragover", "dragleave", "drop"])
  document.addEventListener(type, safe(onDrag));
document.addEventListener("input", (e) => {
  if (e.target.id === "search") {
    // 입력칸은 그대로 두고 카드 목록만 다시 그린다.
    listQuery.text = e.target.value;
    $("worklist").innerHTML = workListHtml();
    return;
  }
  if (e.target.name === "score") updateSheet(e.target.form);
  if (e.target.form && $("main").contains(e.target)) unsavedForm = true;
});
$("close").onclick = closeDialog;
$("dialog").addEventListener("cancel", stopCapture); // Esc로 닫을 때
$("notice").onclick = () => ($("notice").hidden = true);

async function connectBrowser() {
  const code = new URLSearchParams(location.hash.slice(1)).get("connect");
  if (!code) return;
  history.replaceState(null, "", location.pathname + location.search);
  try {
    await api("summary-link", { code });
    notify("이 브라우저에서 " + aiLabel() + "를 사용할 수 있습니다.");
  } catch (e) { notify(e.message, true); }
}

// 작품 화면으로 바로 열렸으면(주소·지난번 선택) 그 아래에 목록을 한 칸 깔아 '뒤로'가 목록으로 가게 한다.
if (selected && !history.state?.inApp) {
  history.replaceState({ inApp: true }, "", location.pathname);
  history.pushState({ inApp: true }, "", viewUrl());
}

connectBrowser().then(() => sync(true))
  .catch((e) => {
    if ($("login")) throw e; // 접속 코드 전이면 고르던 작품을 그대로 둔다
    selected = "";
    saveSelection();
    return sync(true);
  })
  .catch((e) => $("login") || notify(e.message, true)) // 접속 코드 창이 떠 있으면 알림 생략
  .finally(() => setTimeout(poll, POLL_BUSY_MS));
