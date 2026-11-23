// 화면 시작점: 이벤트를 연결하고 첫 화면을 그린 뒤 주기적으로 서버 상태를 읽는다.
import { onClick, setComplete, stepWork, switchTab } from "./actions.mjs";
import { upload } from "./captures.mjs";
import { onSubmit } from "./forms.mjs";
import { tiltPages } from "./interactions.mjs";
import { workListHtml } from "./list.mjs";
import { poll, saveSelection, sync, viewUrl } from "./navigation.mjs";
import { render } from "./render.mjs";
import { batchNote } from "./settings.mjs";
import { updateSheet } from "./sheet.mjs";
import { POLL_BUSY_MS, STEP_TABS, aiLabel, state } from "./state.mjs";
import { $, api, closeDialog, notify, stopCapture } from "./ui.mjs";
import { closeViewer } from "./viewer.mjs";

async function onChange(e) {
  if (e.target.id === "files") return upload([...e.target.files]);
  if (e.target.id === "sort") {
    state.listQuery.sort = e.target.value;
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
  if (!state.work || state.tab !== "자료") throw Error("캡처는 ‘캡처 자료’ 탭에서 추가할 수 있습니다.");
  return upload([...e.dataTransfer.files]);
}

function onPaste(e) {
  if (!state.work || state.tab !== "자료" || $("dialog").open) return;
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
    } else if (state.viewer) closeViewer();
    return;
  }
  const el = document.activeElement;
  const typing = el.matches("input, textarea, select") || $("dialog").open;
  if (typing || e.metaKey || e.ctrlKey || e.altKey || !state.work) return;
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
    state.listQuery.text = e.target.value;
    $("worklist").innerHTML = workListHtml();
    return;
  }
  if (e.target.name === "score") updateSheet(e.target.form);
  if (e.target.form && $("main").contains(e.target)) state.unsavedForm = true;
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
if (state.selected && !history.state?.inApp) {
  history.replaceState({ inApp: true }, "", location.pathname);
  history.pushState({ inApp: true }, "", viewUrl());
}

connectBrowser().then(() => sync(true))
  .catch((e) => {
    if ($("login")) throw e; // 접속 코드 전이면 고르던 작품을 그대로 둔다
    state.selected = "";
    saveSelection();
    return sync(true);
  })
  .catch((e) => $("login") || notify(e.message, true)) // 접속 코드 창이 떠 있으면 알림 생략
  .finally(() => setTimeout(poll, POLL_BUSY_MS));
