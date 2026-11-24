// 내보내기(나중에 Slack으로 보낼) HTML 한 파일: 핵심 요약 → 세부 요약 → AI 논리점검 → 원본 캡처.
// 글꼴(빗썸 고딕)과 캡처 그림을 모두 파일 안에 넣어 인터넷 없이 브라우저에서 같은 모양으로 열린다.
// 원문 근거 쪽 번호는 파일 안에서 누를 수 없어 넣지 않는다. 보낸 순간의 내용이 그대로 남는다.
import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { esc, join, noPeriod, sentences, seoulMinute } from "../../public/lib/html.mjs";
import { publicDir } from "../config.mjs";
import { image } from "../store.mjs";

const bare = (text) => sentences(text).map(noPeriod).join(" "); // 요약 줄은 끝 마침표 없이(화면과 같게)
const font = readFile(path.join(publicDir, "fonts", "BithumbGothic-Basic.woff2")).then((b) => b.toString("base64"));

// 캡처를 너비 1200px JPEG로 줄여 넣는다(PNG 그대로면 파일이 몇 배 커진다).
async function pictures(captures) {
  const out = [];
  for (const c of captures) {
    const jpeg = await sharp(image(c.id)).resize({ width: 1200, withoutEnlargement: true }).jpeg({ quality: 72 }).toBuffer();
    out.push(`<figure><img src="data:image/jpeg;base64,${jpeg.toString("base64")}" alt="${esc(c.label)}"><figcaption>${esc(c.label)}</figcaption></figure>`);
  }
  return out.join("");
}

const rows = (points) => `<ul class="rows">${join(points, (p) => `<li><b>${esc(p.topic)}</b><span>${esc(bare(p.text))}</span></li>`)}</ul>`;
const items = (list, tag = "ul") => `<${tag}>${join(list, (x) => `<li>${esc(typeof x === "string" ? x : x.text)}</li>`)}</${tag}>`;

function summaryPart(r) {
  if (!r) return '<section><h2>AI 요약</h2><p class="muted">요약이 없습니다.</p></section>';
  const brief = r.edition?.brief || [], detail = r.edition?.detail || [];
  const top = brief.find((p) => p.topic === "한 줄 요약") || brief.find((p) => p.topic === "제목");
  const missing = r.edition?.missing || [];
  return `<section><h2>핵심 요약</h2>${top ? `<p class="lead">${esc(bare(top.text))}</p>` : ""}
    ${rows(brief.filter((p) => p.topic !== "제목" && p.topic !== "한 줄 요약"))}</section>
    ${detail.length ? `<section class="detail"><h2>세부 요약</h2>${rows(detail)}</section>` : ""}
    ${missing.length ? `<p class="muted">비워 둔 항목 · ${esc(missing.map((m) => m.topic).join(" · "))} — 원문에서 직접 확인하세요</p>` : ""}`;
}

function logicPart(o) {
  if (!o || o.error) return '<section><h2>AI 논리점검</h2><p class="muted">점검 결과가 없습니다.</p></section>';
  const card = (cls, title, list, tag) => (list?.length ? `<div class="card ${cls}"><h3>${title}</h3>${items(list, tag)}</div>` : "");
  return `<section><h2>AI 논리점검</h2>${o.take ? `<p class="take">${esc(o.take)}</p>` : ""}
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
h1, h2, h3 { font-family: "Bithumb Gothic", sans-serif; letter-spacing: -0.02em; }
h1 { margin: 0 0 6px; font-size: 28px; line-height: 1.35; }
h2 { margin: 36px 0 12px; padding-bottom: 8px; border-bottom: 2px solid var(--text); font-size: 20px; }
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
figure { margin: 0 0 20px; } figure img { display: block; width: 100%; border: 1px solid var(--line); border-radius: 8px; }
figcaption { margin-top: 4px; color: var(--text-3); font-size: 13px; }
footer { margin-top: 32px; color: var(--text-3); font-size: 13px; }
</style></head><body><main>
<h1>${esc(w.name)}</h1>${meta ? `<p class="meta">${meta}</p>` : ""}
${summaryPart(reading)}
${logicPart(opinion)}
<section><h2>원본 캡처 · ${w.captures.length}쪽</h2>${await pictures(w.captures)}</section>
<footer>아이디어정리에서 내보냄 · ${seoulMinute(new Date().toISOString())}</footer>
</main></body></html>`;
}
