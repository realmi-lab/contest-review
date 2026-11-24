// 화면 다시 그리기: 무엇이 바뀌었는지 보고 목록 또는 작품 화면을 그린다.
import { transition } from "./interactions.mjs";
import { filteredWorks, overviewView } from "./list.mjs";
import { rememberFields, syncUrl } from "./navigation.mjs";
import { STEP_TABS, state } from "./state.mjs";
import { showSimilar } from "./summary.mjs";
import { $ } from "./ui.mjs";
import { markActiveRef, peek, refreshViewer } from "./viewer.mjs";
import { renderSidebar, showJob, workView } from "./work-page.mjs";

let shownTab = ""; // 화면에 그려진 단계

// 화면을 다시 그려야 하는지 판단하는 값. 현황판은 목록·작업 상태가 바뀌면 다시 그린다.
export function viewKey() {
  if (state.work) return state.work.id + state.work.updated;
  return (
    "overview" +
    JSON.stringify(state.app.works.map((x) => [x.id, x.receivedOn, x.intakeTeam,
      x.submitterName, x.name, x.count, x.hasReading, x.hasLogic, x.gist, x.opinions, x.opinion, x.category,
      x.title, x.take, x.duplicates])) + JSON.stringify(state.app.intake)
  );
}

// 화면을 다시 그린다. 작품이나 단계가 바뀌었으면 그 방향으로 넘기며 그린다(interactions.mjs).
// 다 그리면 끝나는 약속을 돌려준다.
export function render() {
  const direction = movement();
  peek.hide();
  const draw = () => {
    rememberFields();
    state.shownWork = state.work?.id ?? "";
    shownTab = state.tab;
    state.shownKey = viewKey();
    state.unsavedForm = false;
    $("main").innerHTML = state.work ? workView() : overviewView();
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
  if (!state.shownKey) return "";
  const id = state.work?.id ?? "";
  if (id !== state.shownWork) {
    if (!state.shownWork) return "into";
    if (!id) return "back";
    const order = filteredWorks().map((x) => x.id);
    return order.indexOf(id) > order.indexOf(state.shownWork) ? "turn-next" : "turn-prev";
  }
  if (state.tab === shownTab) return "";
  const steps = Object.keys(STEP_TABS);
  return steps.indexOf(state.tab) > steps.indexOf(shownTab) ? "next" : "prev";
}

