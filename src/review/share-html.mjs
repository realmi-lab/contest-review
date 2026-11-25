// 내보내기(Slack으로도 보내는) HTML 한 파일: 탭 세 개(AI 요약 · AI 논리점검 · 캡처 자료)로 나눠 보여 준다.
// 탭은 스크립트 없이 라디오 단추와 CSS로만 바꾼다(스크립트를 막은 곳에서도 열린다).
// 세부 요약 줄 끝의 쪽 칩(1쪽·2쪽)을 누르면 그 쪽 캡처가 떠 인용 줄이 오렌지 상자로 보인다(작품 화면의 원문 패널처럼,
// 맨 아래 작은 스크립트. 스크립트를 막으면 칩만 보인다).
// 글꼴(빗썸 고딕)과 캡처 그림을 모두 파일 안에 넣어 인터넷 없이 브라우저에서 같은 모양으로 열린다. 보낸 순간의 내용이 그대로 남는다.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { boxPercent, evidenceBoxes } from "../../public/lib/boxes.mjs";
import { esc, join, noPeriod, sentences, seoulMinute } from "../../public/lib/html.mjs";
import { publicDir } from "../config.mjs";
import { image } from "../store.mjs";

// 쪽 칩을 누르면 그 쪽 캡처(캡처 자료 탭의 그림)를 띄우고 인용 줄에 오렌지 상자를 그린다. 바깥·닫기·Esc로 닫는다.
const VIEWER_SCRIPT = `
const viewer = document.getElementById("viewer");
document.addEventListener("click", (e) => {
  const chip = e.target.closest(".ref");
  if (chip) {
    const figure = document.getElementById(chip.dataset.cap);
    viewer.querySelector("img").src = figure.querySelector("img").src;
    viewer.querySelector(".viewer-label").textContent = figure.querySelector("figcaption").textContent;
    viewer.querySelector(".viewer-marks").innerHTML = JSON.parse(chip.dataset.boxes).map(([l, t, w, h, a]) =>
      '<i style="left:' + l + '%;top:' + t + '%;width:' + w + '%;height:' + h + '%;transform:rotate(' + -a + 'deg)"></i>').join("");
    viewer.hidden = false;
    viewer.querySelector(".viewer-marks i")?.scrollIntoView({ block: "center" });
  } else if (e.target === viewer || e.target.closest(".viewer-close")) viewer.hidden = true;
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape") viewer.hidden = true; });
`;
// 앱에서 내보내기를 열 때(새 탭) 쓰는 보안 정책: 파일 안의 글꼴·그림(data:)과 위 스크립트(해시)만 허락한다.
// 내려받아 연 파일에는 이 정책이 없어도 같은 스크립트가 돈다.
export const shareCsp = `default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'; script-src 'sha256-${createHash("sha256").update(VIEWER_SCRIPT).digest("base64")}'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`;

const bare = (text) => sentences(text).map(noPeriod).join(" "); // 요약 줄은 끝 마침표 없이(화면과 같게)
const font = readFile(path.join(publicDir, "fonts", "BithumbGothic-Basic.woff2")).then((b) => b.toString("base64"));

// 캡처를 너비 1200px JPEG로 줄여 넣는다(PNG 그대로면 파일이 몇 배 커진다).
async function pictures(captures) {
  const out = [];
  for (const c of captures) {
    const jpeg = await sharp(image(c.id)).resize({ width: 1200, withoutEnlargement: true }).jpeg({ quality: 72 }).toBuffer();
    out.push(`<figure id="cap-${esc(c.id)}"><img src="data:image/jpeg;base64,${jpeg.toString("base64")}" alt="${esc(c.label)}"><figcaption>${esc(c.label)}</figcaption></figure>`);
  }
  return out.join("");
}

const rows = (points, chips = () => "") => `<ul class="rows">${join(points, (p) => `<li><b>${esc(p.topic)}</b><span>${esc(bare(p.text))} ${chips(p)}</span></li>`)}</ul>`;

// 세부 요약 줄 끝의 쪽 칩. 쪽마다 하나이고, 그 줄의 근거 가운데 그 쪽에 있는 인용 줄 상자(그림 대비 %)를 함께 싣는다.
function cites(p, captures, evidence) {
  const pages = new Map(); // 쪽 표시 → { cap: 캡처 id, boxes: [[왼쪽, 위, 너비, 높이, 기울기], …] }
  for (const id of p.refs || []) {
    const ev = evidence?.[id], c = captures.find((x) => x.id === ev?.capture);
    if (!c) continue;
    const label = c.page ? c.page + "쪽" : c.label;
    if (!pages.has(label)) pages.set(label, { cap: c.id, boxes: [] });
    if (c.ocrWidth) pages.get(label).boxes.push(...evidenceBoxes(c, ev).map((b) => {
      const { left, top, width, height, angle } = boxPercent(c, b);
      return [left, top, width, height, angle].map((v) => +v.toFixed(2));
    }));
  }
  const order = ([label]) => parseInt(label) || 0; // 쪽 순서대로
  return join([...pages].sort((a, b) => order(a) - order(b)), ([label, { cap, boxes }]) =>
    `<button type="button" class="ref" data-cap="cap-${esc(cap)}" data-boxes="${esc(JSON.stringify(boxes))}">${esc(label)}</button>`);
}
const items = (list, tag = "ul") => `<${tag}>${join(list, (x) => `<li>${esc(typeof x === "string" ? x : x.text)}</li>`)}</${tag}>`;

function summaryPart(r, captures) {
  if (!r) return '<p class="muted">요약이 없습니다.</p>';
  const brief = r.edition?.brief || [], detail = r.edition?.detail || [];
  const top = brief.find((p) => p.topic === "한 줄 요약") || brief.find((p) => p.topic === "제목");
  const missing = r.edition?.missing || [];
  return `<section><h2>핵심 요약</h2>${top ? `<p class="lead">${esc(bare(top.text))}</p>` : ""}
    ${rows(brief.filter((p) => p.topic !== "제목" && p.topic !== "한 줄 요약"))}</section>
    ${detail.length ? `<section class="detail"><h2>세부 요약</h2>${rows(detail, (p) => cites(p, captures, r.evidence))}</section>` : ""}
    ${missing.length ? `<p class="muted">비워 둔 항목 · ${esc(missing.map((m) => m.topic).join(" · "))} — 원문에서 직접 확인하세요</p>` : ""}`;
}

function logicPart(o) {
  if (!o || o.error) return '<p class="muted">점검 결과가 없습니다.</p>';
  const card = (cls, title, list, tag) => (list?.length ? `<div class="card ${cls}"><h3>${title}</h3>${items(list, tag)}</div>` : "");
  return `<section>${o.take ? `<p class="take">${esc(o.take)}</p>` : ""}
    <div class="pair">${card("good", "잘된 점", o.strengths)}${card("warn", "확인할 점", o.weaknesses)}</div>
    ${card("ask", "제안자에게 물어볼 것", o.questions, "ol")}
    ${o.compliance?.length ? `<div class="card legal"><h3>법·컴플라이언스 확인</h3><ul>${join(o.compliance, (x) => `<li><em>${esc(x.area)}</em>${esc(x.text)}</li>`)}</ul>
      <p class="muted">위반 여부 판단이 아니라 법무·컴플라이언스 담당이 확인할 점입니다</p></div>` : ""}
    <p class="muted">AI 의견입니다. 점수와 채택 판단은 하지 않습니다</p></section>`;
}

export async function shareHtml(w) {
  const reading = w.cloudReading?.rev === w.rev ? w.cloudReading : null;
  const opinion = reading && w.cloudLogic?.reading === reading.id ? w.cloudLogic.opinion : null;
  const meta = [w.receivedOn, w.intakeTeam, w.submitterName, w.category].filter(Boolean).map(esc).join(" · ");
  return `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(w.name)}</title><style>
@font-face { font-family: "Bithumb Gothic"; src: url(data:font/woff2;base64,${await font}) format("woff2"); font-weight: 700; }
:root { --orange: #ff6c00; --fill: #f3f4f6; --line: #e2e4e8; --text: #1a1c1f; --text-2: #3c3f44; --text-3: #63666b; }
body { margin: 0; background: #e9eaec; color: var(--text); font: 16px/1.7 "Pretendard Variable", Pretendard, -apple-system, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif; }
main { max-width: 920px; margin: 32px auto; padding: 40px 48px; border-radius: 16px; background: #fff; }
/* 탭: 눈에 잘 띄게 큰 단추 세 개로 나란히 두고, 고른 탭은 오렌지. 내려 읽어도 위에 붙어 있어 언제든 바꿀 수 있다 */
.tabs { position: sticky; top: 0; z-index: 5; display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin: 24px 0 8px; padding: 10px 0; border-bottom: 2px solid var(--text); background: #fff; }
.tabs label { padding: 14px 12px; border: 2px solid var(--line); border-radius: 12px; background: var(--fill); color: var(--text-2); font-family: "Bithumb Gothic", sans-serif; font-size: 18px; text-align: center; cursor: pointer; }
.tabs label:hover { border-color: var(--orange); color: var(--orange); }
.pane, input[name="tab"] { display: none; }
#tab-1:checked ~ .tabs [for="tab-1"], #tab-2:checked ~ .tabs [for="tab-2"], #tab-3:checked ~ .tabs [for="tab-3"] { border-color: var(--orange); background: var(--orange); color: #fff; box-shadow: 0 4px 12px rgba(255, 108, 0, 0.3); }
#tab-1:checked ~ .p1, #tab-2:checked ~ .p2, #tab-3:checked ~ .p3 { display: block; }
h1, h2, h3 { font-family: "Bithumb Gothic", sans-serif; letter-spacing: -0.02em; }
h1 { margin: 0 0 6px; font-size: 28px; line-height: 1.35; }
h2 { margin: 28px 0 12px; padding-bottom: 8px; border-bottom: 2px solid var(--text); font-size: 20px; }
h3 { margin: 0 0 8px; font-size: 16px; }
.meta, .muted { color: var(--text-3); font-size: 14px; }
.lead { margin: 0 0 12px; color: var(--orange); font-family: "Bithumb Gothic", sans-serif; font-size: 20px; line-height: 1.5; }
.rows { margin: 0; padding: 0; list-style: none; }
.rows li { display: grid; grid-template-columns: 9em 1fr; gap: 16px; padding: 10px 0; border-top: 1px solid var(--line); }
.rows b { font-family: "Bithumb Gothic", sans-serif; }
.detail { margin-top: 28px; padding: 4px 24px 12px; border-radius: 12px; background: var(--fill); }
.detail h2 { margin-top: 16px; border-bottom-color: var(--line); }
.take { padding: 14px 18px; border-left: 4px solid var(--orange); border-radius: 10px; background: var(--fill); font-weight: 700; }
.pair { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.card { margin-bottom: 14px; padding: 14px 18px; border-radius: 12px; background: var(--fill); }
.card ul, .card ol { margin: 0; padding-left: 20px; }
.good { background: #e3f6ec; } .good h3 { color: #0a6440; }
.warn { background: #fff5d6; } .warn h3 { color: #7f5a00; }
.legal { background: #fff; box-shadow: inset 0 0 0 1px var(--line); }
.legal ul { list-style: none; padding: 0; }
.legal em { display: inline-block; min-width: 8em; margin-right: 10px; color: var(--text-2); font-style: normal; font-weight: 700; }
figure { margin: 20px 0; } figure img { display: block; width: 100%; border: 1px solid var(--line); border-radius: 8px; }
figcaption { margin-top: 4px; color: var(--text-3); font-size: 13px; }
footer { margin-top: 32px; color: var(--text-3); font-size: 13px; }
.ref { margin-left: 4px; padding: 0 7px; border: 1px solid var(--orange); border-radius: 999px; background: #fff; color: var(--orange); font: inherit; font-size: 12px; line-height: 1.6; cursor: pointer; vertical-align: 1px; }
.ref:hover { background: var(--orange); color: #fff; }
.viewer { position: fixed; inset: 0; z-index: 10; overflow: auto; padding: 32px 16px; background: rgba(0, 0, 0, 0.6); }
.viewer[hidden] { display: none; }
.viewer-box { position: relative; max-width: 1000px; margin: 0 auto; padding: 16px; border-radius: 12px; background: #fff; }
.viewer-close { float: right; margin-bottom: 8px; padding: 4px 12px; border: 0; border-radius: 8px; background: var(--fill); font: inherit; cursor: pointer; }
.viewer-stage { position: relative; clear: both; } .viewer-stage img { display: block; width: 100%; }
.viewer-marks i { position: absolute; border: 2px solid var(--orange); border-radius: 3px; background: rgba(255, 108, 0, 0.15); }
.viewer-label { margin: 8px 0 0; color: var(--text-3); font-size: 13px; }
</style></head><body><main>
<h1>${esc(w.name)}</h1>${meta ? `<p class="meta">${meta}</p>` : ""}
<input type="radio" name="tab" id="tab-1" checked><input type="radio" name="tab" id="tab-2"><input type="radio" name="tab" id="tab-3">
<nav class="tabs"><label for="tab-1">AI 요약</label><label for="tab-2">AI 논리점검</label><label for="tab-3">캡처 자료 · ${w.captures.length}쪽</label></nav>
<div class="pane p1">${summaryPart(reading, w.captures)}</div>
<div class="pane p2">${logicPart(opinion)}</div>
<div class="pane p3">${await pictures(w.captures)}</div>
<div id="viewer" class="viewer" hidden><div class="viewer-box"><button type="button" class="viewer-close" aria-label="닫기">닫기</button>
  <div class="viewer-stage"><img alt=""><span class="viewer-marks"></span></div><p class="viewer-label"></p></div></div>
<footer>아이디어정리에서 내보냄 · ${seoulMinute(new Date().toISOString())}</footer>
</main><script>${VIEWER_SCRIPT}</script></body></html>`;
}
