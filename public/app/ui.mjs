// 화면 공통 도구: HTML 조각(버튼·입력칸·아이콘), 서버 요청(api), 알림, 대화상자
import { markTerms, termsIn } from "../lib/glossary.mjs";
import { esc, join, markNumbers, noPeriod, sentences } from "../lib/html.mjs";
import { currentEvidence, findCapture } from "./navigation.mjs";
import { state } from "./state.mjs";

let toastTimer;

/* ─────────────────────────── HTML 도우미 ─────────────────────────── */

export const $ = (id) => document.getElementById(id);

// 아이콘은 문자(✓ ✕ ‹ ›) 대신 같은 선 굵기의 SVG로 그린다.
const ICONS = {
  check: '<path d="M20 6 9 17l-5-5"/>',
  close: '<path d="M18 6 6 18M6 6l12 12"/>',
  prev: '<path d="m15 18-6-6 6-6"/>',
  next: '<path d="m9 18 6-6-6-6"/>',
  back: '<path d="M19 12H5M12 19l-7-7 7-7"/>',
  alert: '<path d="M12 3 2 21h20L12 3z"/><path d="M12 10v4M12 17.5h.01"/>',
  help: '<circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01"/>',
  shield: '<path d="M12 22s8-3.5 8-10V5l-8-3-8 3v7c0 6.5 8 10 8 10z"/>',
  bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z"/>',
  settings:
    '<path d="M21 4h-7M10 4H3M21 12h-9M8 12H3M21 20h-5M12 20H3M14 2v4M8 10v4M16 18v4"/>',
};
export const icon = (name, size = 18) =>
  `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;

// engine: 작업을 시작하는 버튼 (이 작품의 작업이 진행·대기 중이면 잠김)
export const button = (action, label, cls = "", engine = false) =>
  `<button type="button" data-action="${action}" class="${cls}" ${engine ? "data-engine" : ""}>${esc(label)}</button>`;
export const field = (label, control) =>
  `<label class="field">${esc(label)}${control}</label>`;
export const input = (id, value = "", type = "text", extra = "") =>
  `<input id="${id}" type="${type}" value="${esc(value)}" ${extra}>`;
export const count = (n) => (n ? ` <span class="count">${n}</span>` : "");
const panel = (title, body, cls = "") =>
  `<section class="panel ${cls}"><h2>${esc(title)}</h2>${body}</section>`;
export const emptyState = (title, text, action = "") =>
  `<div class="empty"><strong>${esc(title)}</strong><p>${esc(text)}</p>${action}</div>`;

// 근거 칩. 심사자가 원문에서 바로 찾도록 쪽 번호로, 쪽 순서대로 보여 주고 같은 쪽은 한 번만 둔다.
// 누르면 그 쪽의 첫 근거가 원문 패널에 열리고, 머물면 그 부분이 미리보기 카드로 뜬다(interactions.mjs).
function refPage(id, source) {
  const page = findCapture(source?.capture)?.page || /^S(\d+)\./.exec(id)?.[1];
  return page ? page + "쪽" : id;
}
export function refs(ids) {
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
export { noPeriod };
// bare: 문장 끝 마침표를 뺀다(요약 줄은 개조식이라 점 없이 보여 준다). 문장은 한 줄씩 나뉘어 있어 읽기에 지장이 없다.
export function claim(p, tag = "div", after = "", terms = new Set(), bare = false) {
  const lines = sentences(claimText(p)).map((line) => (bare ? noPeriod(line) : line));
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
export function richText(text, terms = new Set()) {
  const readable = (line) => markNumbers(line)
    .replace(SOURCE_ID, (m, p) => refs([m.replace(p ?? "", "")]) + particle(p))
    .replace(POINT_ID, (m, p) => "요약" + particle(p));
  return markTerms(join(sentences(text), (line) => `<span class="line">${readable(line)}</span> `), terms);
}
// 요약에 나온 전문 용어 풀이 (요약 끝의 각주)
export function glossaryNote(points) {
  const terms = termsIn(points.map(claimText));
  return terms.length
    ? `<aside class="glossary"><h3>용어 풀이</h3><dl>${join(terms, ([name, meaning]) => `<div><dt>${esc(name)}</dt><dd>${esc(meaning)}</dd></div>`)}</dl></aside>`
    : "";
}

/* ─────────────────────────── 서버·알림 ─────────────────────────── */

export async function api(route, data) {
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

export function notify(message, isError = false) {
  const box = $("notice");
  box.textContent = message;
  box.classList.toggle("error", isError);
  box.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (box.hidden = true), isError ? 9000 : 4000);
}

/* ─────────────────────────── 대화상자 ─────────────────────────── */

export function stopCapture() {
  clearInterval(state.watchTimer);
  state.stream?.getTracks().forEach((t) => t.stop());
  state.stream = null;
}

export function closeDialog() {
  stopCapture();
  $("dialog").close();
}

export function dialog(title, html) {
  if ($("dialog").open) closeDialog();
  $("dialogtitle").textContent = title;
  $("dialogbody").innerHTML = html;
  $("dialog").showModal();
}

