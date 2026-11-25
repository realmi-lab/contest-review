// 캡처 자료 탭: 캡처 목록, 다시 캡처·삭제, 그림·문서 올리기, 문서 창 공유
import { diagramHint } from "../lib/diagram-hint.mjs";
import { esc, join } from "../lib/html.mjs";
import { rememberFields, sync } from "./navigation.mjs";
import { MAX_IMAGE_BYTES, state } from "./state.mjs";
import { $, api, button, closeDialog, dialog, field, input, notify } from "./ui.mjs";
import { coverageText, showJob } from "./work-page.mjs";

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
export const suggestedVisual = () => state.work.captures.filter((c) => !c.visual && diagramHint(c.lines));

// MS Forms 첨부를 서버가 아직 캡처하는 중인가(동기화 대기·읽는 중이고 못 읽은 첨부는 없음). 이때는 직접 올리기를 보이지 않는다.
// 못 읽은 첨부가 있거나, 다 읽은 뒤 캡처를 지운 작품은 직접 올린다.
export const autoCaptured = () => {
  const s = state.work.source;
  const waiting = (name) => s.missing.includes(name) || !s.read?.[name];
  return !!s?.files.length && s.files.some(waiting) && !s.files.some((name) => s.read?.[name]?.error);
};

// MS Forms 첨부: 서버가 열어서 캡처로 자동 접수한 결과(파일마다). 못 읽은 파일만 심사자가 직접 캡처한다.
function formsFilesNote() {
  const s = state.work.source;
  if (!s?.files.length) return "";
  const folder = `${state.app.intake?.reviewDir ?? "심사 폴더"}/작품/${s.folder}`;
  const fileState = (name) => {
    const r = s.read?.[name];
    if (s.missing.includes(name)) return ["warn-text", "OneDrive 동기화 기다리는 중"];
    if (!r) return ["muted", "열어서 캡처하는 중"];
    if (r.manual) return ["muted", "직접 올린 캡처 사용"];
    return r.error ? ["warn-text", r.error] : ["ok-text", `${r.pages}장 자동 접수`];
  };
  const failed = s.files.some((n) => s.read?.[n]?.error);
  return `<div class="forms-files spaced"><p>MS Forms 첨부 ${s.files.length}개 · OneDrive <b>${esc(folder)}</b></p>
    <ul>${join(s.files, (name) => { const [cls, text] = fileState(name); return `<li><b>${esc(name)}</b><span class="${cls}">${esc(text)}</span></li>`; })}</ul>
    ${failed ? '<p class="small muted">목록 화면의 \'지금 가져오기\'를 누르면 못 읽은 파일을 다시 열어 봅니다. 그래도 안 되면 회사 뷰어로 열어 캡처해 올려 주세요.</p>' : ""}</div>`;
}

export function intakePane() {
  const { captures } = state.work;
  const coverage = coverageText();
  if (!captures.length && autoCaptured()) return formsFilesNote();
  if (!captures.length) return `${formsFilesNote()}
    <section class="panel">
      <div class="intake-document">
        ${field("문서 또는 시트 이름", input("document", state.docFields.document, "text", 'maxlength="100"'))}
      </div>
      <label id="drop" class="drop">
        <span><strong>캡처나 문서 파일을 끌어 놓거나 붙여넣으세요</strong>
        <span class="small muted">PNG·JPG·WebP 그림, PDF·Word·PowerPoint·Excel 문서(쪽마다 캡처로 접수). 여러 개는 선택한 순서대로 접수합니다.</span></span>
        <span class="pick">파일 선택</span>
        <input id="files" class="sr" type="file" accept="${UPLOAD_TYPES}" multiple>
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
  return `${formsFilesNote()}
    <section class="panel">
      ${suggested.length ? `<div class="diagram-note"><span><b>도식 검토 추천 ${suggested.length}쪽</b> · 그래프 값이 글자로 적혀 있지 않아 이미지로만 읽을 수 있습니다.</span>${button("mark-visual", "추천 쪽 도식 검토로 지정")}</div>` : ""}
      <div class="capgrid">${join(captures, captureCard)}</div>
      ${note ? `<p class="capture-note warn-text">${esc(note)}</p>` : ""}
      <details class="capture-tools">
        <summary>빠진 쪽 추가 · 자료 교체</summary>
        <div class="actions">
          <label class="button">빠진 파일 추가<input id="files" class="sr" type="file" accept="${UPLOAD_TYPES}" multiple></label>
          <span class="spacer"></span>${button("reset-captures", "캡처 모두 지우고 새로 올리기", "danger", true)}
        </div>
      </details>
    </section>`;
}

/* ─────────────────────────── 캡처 다시 캡처·삭제 ─────────────────────────── */

// 다시 캡처: 원본 문서에서 그 쪽만 다시 받아 바꿔 끼운다. 삭제: 그 캡처만 지운다.
export async function changeCapture(captureId, change) {
  if (change === "remove" && !confirm("선택한 캡처를 삭제할까요?")) return;
  if (change === "recapture" && !confirm("이 쪽만 원본 문서에서 다시 캡처할까요?\n다시 읽고 나면 AI 요약을 새로 만듭니다.")) return;
  await api("capture", {
    id: state.work.id,
    rev: state.work.rev,
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

// 올릴 수 있는 파일: 그림은 바로 캡처로, 문서는 서버가 열어 쪽마다 캡처로 접수한다(attachment-pages.mjs).
const DOCUMENT_EXT = /\.(pdf|docx?|pptx?|xlsx?)$/i;
const UPLOAD_TYPES = "image/png,image/jpeg,image/webp,.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx";
async function uploadDocuments(id, documents) {
  const failed = [];
  for (const file of documents) {
    try {
      if (file.size > MAX_DOCUMENT_BYTES) throw Error("문서는 40MB 이하만 올릴 수 있습니다.");
      await api("upload-document", { id, name: file.name, data: await asBase64(file) });
    } catch (e) {
      failed.push(`${file.name}: ${e.message}`);
    }
  }
  if (failed.length) notify(`문서 ${failed.length}개 실패 · ${failed.slice(0, 3).join(" / ")}`, true);
  else notify(`문서 ${documents.length}개를 쪽마다 캡처로 접수하는 중입니다.`);
}
const MAX_DOCUMENT_BYTES = 40 * 1024 * 1024;

export async function upload(files, fromWindow = false) {
  const documents = files.filter((f) => DOCUMENT_EXT.test(f.name || ""));
  const images = files.filter((f) => f.type.startsWith("image/"));
  if (files.length && !images.length && !documents.length)
    throw Error("PNG·JPG·WebP 그림이나 PDF·Word·PowerPoint·Excel 문서만 올릴 수 있습니다.");
  const id = state.selected; // 올리는 도중 다른 작품을 골라도 처음 작품에 저장
  if (!id || state.uploading) return;
  if (documents.length) {
    await uploadDocuments(id, documents);
    if (!images.length) {
      if ($("files")) $("files").value = "";
      return sync(true);
    }
  }
  if (!images.length) return;
  rememberFields();
  const fields = { ...state.docFields };
  state.uploading = true;
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
    state.uploading = false;
    if (!fromWindow && $("files")) $("files").value = "";
    await sync(true);
  }
}

export async function openScreen() {
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
  state.stream = shared;
  const video = $("live");
  video.srcObject = state.stream;
  await video.play();
  state.stream
    .getVideoTracks()[0]
    .addEventListener("ended", () => state.stream && closeDialog(), { once: true });
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
  state.watchTimer = setInterval(() => {
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

export async function snapScreen() {
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

