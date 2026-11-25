// 채점표 탭: 점수 없이 의견만 남긴다.
//   담당자에게 보내기(Slack 검색 → 보내기) · 담당자 의견([평가 답장하기], slack.mjs) · 메모(심사자가 적어 두는 한 칸, 의견으로 세지 않음)
import { esc } from "../lib/html.mjs";
import { slackPanel } from "./slack.mjs";
import { state } from "./state.mjs";

export function reportPane() {
  return `${slackPanel()}
    <section class="panel review-note"><h3>메모</h3>
      <form id="review-note" class="stack">
        <textarea name="note" rows="3" maxlength="4000" placeholder="심사하며 적어 둘 메모">${esc(state.work.reviewNote || "")}</textarea>
        <div><button class="primary">저장</button></div>
      </form>
    </section>`;
}
