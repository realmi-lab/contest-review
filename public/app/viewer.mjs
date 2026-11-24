// 오른쪽 원문 패널: 근거 칩을 누르면 그 캡처와 인용 위치를 보여 준다.
import { explainOcr } from "../lib/expanded-reading.mjs";
import { esc, join } from "../lib/html.mjs";
import { evidencePeek } from "./interactions.mjs";
import { currentEvidence, findCapture } from "./navigation.mjs";
import { state } from "./state.mjs";
import { ocrDifference } from "./summary.mjs";
import { $, closeDialog, dialog, icon } from "./ui.mjs";

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
  if (!state.viewer) viewerOpener = document.activeElement;
  state.viewer = { captureId, evidence, ref, snapshot: JSON.stringify(c) };
  drawViewer(c);
  markActiveRef();
  $("evidence")
    .querySelector("[data-close-viewer]")
    .focus({ preventScroll: true });
}

export function closeViewer() {
  if (!state.viewer) return;
  if ($("dialog").open && $("dialogbody").querySelector(".capture-stage")) closeDialog();
  state.viewer = null;
  $("evidence").hidden = true;
  $("evidence").innerHTML = "";
  document.body.classList.remove("has-evidence");
  markActiveRef();
  if (viewerOpener?.isConnected) viewerOpener.focus({ preventScroll: true });
  viewerOpener = null;
}

// 작품 데이터가 바뀌면 보고 있던 캡처만 다시 그린다.
export function refreshViewer() {
  if (!state.viewer) return;
  const c = findCapture(state.viewer.captureId);
  if (!c) return closeViewer();
  const snapshot = JSON.stringify(c);
  if (snapshot === state.viewer.snapshot) return;
  state.viewer.snapshot = snapshot;
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
  const ev = state.viewer.evidence;
  const cited = new Set(ev?.indexes || []);
  const overlay = captureOutlines(c, ev);
  const pages = c.page ? `${c.page}${c.total ? " / " + c.total : ""}쪽` : "";
  const pane = $("evidence");
  pane.innerHTML = `
    <div class="viewer-head">
      ${state.viewer.ref ? `<span class="ref active">${esc(state.viewer.ref)}</span>` : ""}
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
`;
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
export function markActiveRef() {
  for (const el of document.querySelectorAll(
    "#main .ref.active, #main .claim.active",
  ))
    el.classList.remove("active");
  if (!state.viewer?.ref) return;
  for (const b of document.querySelectorAll(
    `#main .ref[data-ref="${CSS.escape(state.viewer.ref)}"]`,
  )) {
    b.classList.add("active");
    b.closest(".claim")?.classList.add("active");
  }
}

export function showRef(refId) {
  const ref = currentEvidence()?.[refId];
  if (!ref) throw Error("현재 자료에서 원문을 찾을 수 없습니다.");
  openViewer(ref.capture, ref, refId);
}

export function showUncertain(captureId, index) {
  const issue = findCapture(captureId)?.ocrInfo?.uncertain[index];
  if (!issue) return;
  const item = explainOcr(issue);
  openViewer(captureId, {
    kind: "OCR 판독 대조",
    text: [item.reason, "기본 · " + item.basic, "정밀 · " + item.fine, item.crop].join(" "),
    boxes: [issue.box],
  });
}

export function openCaptureGallery(opener, captureId, evidence) {
  const captures = state.work.captures;
  let index = captures.findIndex((c) => c.id === captureId);
  if (index < 0 || $("dialog").open) return;
  opener.focus({ preventScroll: true });
  dialog(captures[index].label, `<div class="capture-stage"><button type="button" class="viewbox" data-zoom-detail></button><span role="status" hidden>이미지를 불러오지 못했습니다.</span></div>
    <nav class="capture-nav" aria-label="캡처 이동">
      <button type="button" class="iconbtn" data-gallery-step="-1" aria-label="이전 캡처" title="이전 캡처 (←)">${icon("prev", 24)}</button>
      <span aria-live="polite" aria-atomic="true"></span>
      <button type="button" class="iconbtn" data-gallery-step="1" aria-label="다음 캡처" title="다음 캡처 (→)">${icon("next", 24)}</button></nav>
    <div class="actions capture-actions"><button type="button" data-change="recapture">이 쪽 다시 캡처</button><button type="button" class="danger" data-change="remove">캡처 삭제</button></div>`);
  const body = $("dialogbody");
  const stage = body.querySelector(".capture-stage");
  const view = stage.querySelector(".viewbox");
  const error = stage.querySelector("[role=status]");
  const nav = body.querySelector(".capture-nav");
  const [prev, next] = nav.querySelectorAll("button");
  function showPage(i) {
    index = i;
    const c = captures[i];
    for (const b of body.querySelectorAll("[data-change]")) b.dataset.capture = c.id;
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

export function zoomCaptureDetail(view, event) {
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

// 근거 미리보기에 넘길 근거와 그 캡처
export const peek = evidencePeek((id) => {
  const evidence = currentEvidence()?.[id];
  return evidence ? { evidence, capture: findCapture(evidence.capture) } : null;
});
